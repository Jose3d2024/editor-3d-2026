/**
 * silhouettes.ts — "Del Plano a la Realidad"
 *
 * El usuario sube 3 imágenes (alzado, perfil, planta).
 * Este módulo extrae la silueta de cada imagen y genera una malla 3D
 * por intersección CSG de tres prismas extruidos.
 *
 * Coordenadas del mundo:
 *   X = derecha,  Y = arriba,  Z = profundidad (hacia cámara)
 *
 * Vista Alzado  (frontal):  imagen X → mundo X,  imagen Y↑ → mundo Y
 * Vista Perfil  (lateral):  imagen X → mundo Z,  imagen Y↑ → mundo Y
 * Vista Planta  (superior): imagen X → mundo X,  imagen Y↓ → mundo Z
 *                           (↓ porque en imagen 2D "arriba" = lejos)
 */

import type { V3, MeshFace, CSGObject } from '../types';
import { applyBooleanOperation } from './modifiers';
import { simplifyClosedPolygon } from './blueprintCarver';
import {
  simplificarSiluetaAThreeShape,
  fitBezierCurvesSchneider,
  simplifyClosedContourRDP,
  obtenerPuntosConRuido,
  procesarImagenYRenderizarLinea
} from './vectorContourProcessor';

export {
  simplificarSiluetaAThreeShape,
  fitBezierCurvesSchneider,
  simplifyClosedContourRDP,
  obtenerPuntosConRuido,
  procesarImagenYRenderizarLinea
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SilhouetteContour = [number, number][];  // puntos en [-1, 1]

export interface SilhouetteImages {
  front: string | null;
  back:  string | null;
  left:  string | null;
  right: string | null;
  top:   string | null;
  bottom:string | null;
}

export interface ExtractionOptions {
  numPoints:  number;  // puntos del polígono resultante (16..128)
  threshold:  number;  // 0..255, umbral para separar silueta del fondo
  invert:     boolean; // true si la silueta es clara sobre fondo oscuro
}

// ─── Extracción de silueta desde imagen ──────────────────────────────────────

/**
 * Carga una imagen (URL o dataURL) en un canvas offscreen y extrae su contorno.
 * 
 * Algoritmo:
 *  1. Detecta automáticamente si el fondo es claro u oscuro (muestreo esquinas).
 *  2. Para cada columna de píxeles, encuentra el píxel más alto y más bajo
 *     perteneciente a la silueta.
 *  3. Construye un polígono cerrado: perfil superior izq→der + perfil inferior der→izq.
 *  4. Simplifica a `numPoints` puntos equiespaciados por longitud de arco.
 *  5. Normaliza a [-1, 1] centrando en el bounding box de la silueta.
 *
 * @returns Polígono de contorno normalizado, o null si no hay silueta detectada.
 */
export async function extractSilhouetteFromImage(
  imageUrl: string,
  options: Partial<ExtractionOptions> = {},
): Promise<SilhouetteContour | null> {
  const {
    numPoints = 48,
    threshold = 128,
    invert    = false,
  } = options;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // Limitar resolución para rendimiento
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const W = Math.round(img.width  * scale);
      const H = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, W, H);

      const data = ctx.getImageData(0, 0, W, H).data;

      // ── 1. Auto-detectar fondo ──────────────────────────────────────────
      const cornerPixels = [
        data[0], data[4], data[8],                             // top-left
        data[(W - 3) * 4], data[(W - 2) * 4], data[(W - 1) * 4], // top-right
        data[(H - 1) * W * 4], data[((H - 1) * W + 1) * 4],   // bottom-left
        data[((H - 1) * W + W - 1) * 4],                       // bottom-right
      ];
      const avgCorner = cornerPixels.reduce((a, b) => a + b, 0) / cornerPixels.length;
      // Si el fondo es claro (> 160), la silueta es oscura (luminancia < threshold)
      const bgIsLight = avgCorner > 160;
      const isFg = (r: number, g: number, b: number, a: number): boolean => {
        if (a < 64) return false;  // transparente = fondo
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const fg = bgIsLight ? lum < threshold : lum > threshold;
        return invert ? !fg : fg;
      };

      // ── 2. Encontrar el punto de partida (primer píxel del contorno) ─────
      let startX = -1;
      let startY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (isFg(data[i], data[i+1], data[i+2], data[i+3])) {
            startX = x;
            startY = y;
            break;
          }
        }
        if (startX !== -1) break;
      }

      if (startX === -1) {
        // Sin silueta detectada — devolver rectángulo por defecto
        resolve([[-1,-1],[1,-1],[1,1],[-1,1]]);
        return;
      }

      // ── 3. Rastrear contorno exterior con algoritmo Moore-Neighbor ─────────
      const rawContourPx: [number, number][] = [];
      let cx = startX;
      let cy = startY;
      const dirOffsets: [number, number][] = [
        [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]
      ];
      let backtrackDir = 6;
      let secondX = -1;
      let secondY = -1;
      const maxIterations = W * H * 2;
      let step = 0;

      do {
        rawContourPx.push([cx, cy]);
        let foundNext = false;
        let nextX = cx;
        let nextY = cy;
        let nextBacktrack = 0;

        for (let i = 0; i < 8; i++) {
          const checkDir = (backtrackDir + i) % 8;
          const nx = cx + dirOffsets[checkDir][0];
          const ny = cy + dirOffsets[checkDir][1];

          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            const idx = (ny * W + nx) * 4;
            if (isFg(data[idx], data[idx+1], data[idx+2], data[idx+3])) {
              nextX = nx;
              nextY = ny;
              nextBacktrack = (checkDir + 5) % 8;
              foundNext = true;
              break;
            }
          }
        }

        if (!foundNext) break;

        step++;
        if (step === 1) {
          secondX = nextX;
          secondY = nextY;
        } else if (cx === startX && cy === startY && nextX === secondX && nextY === secondY) {
          break;
        }

        if (step > maxIterations) break;

        cx = nextX;
        cy = nextY;
        backtrackDir = nextBacktrack;
      } while (cx !== startX || cy !== startY);

      if (rawContourPx.length < 3) {
        resolve([[-1,-1],[1,-1],[1,1],[-1,1]]);
        return;
      }

      // ── 4. Normalizar contorno al rango [-1, 1] de Three.js coherente con el lienzo 2D ──
      const centerWorldX = W / 2;
      const centerWorldY = H / 2;
      const maxSpan = Math.max(W, H) / 2;

      const rawPolygon: [number, number][] = rawContourPx.map(([px, py]) => [
        (px - centerWorldX) / (maxSpan || 1),
        -((py - centerWorldY) / (maxSpan || 1)) // invertir eje Y
      ]);

      // ── 5. Asegurar winding CCW y aplicar Vectorización Adaptativa de Alta Fidelidad ───────────────
      const ccw = ensureCCW(rawPolygon);
      const optimizedPolygon = simplifyClosedPolygon(ccw, 0.005);
      resolve(ensureCCW(optimizedPolygon));
    };

    img.onerror = () => {
      console.warn('extractSilhouetteFromImage: error loading image');
      resolve(null);
    };

    img.src = imageUrl;
  });
}

// ─── Helpers de geometría 2D ──────────────────────────────────────────────────

/** Área con signo del polígono (positivo = CCW, negativo = CW) */
export function signedArea(pts: [number,number][]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area += (x1 - x0) * (y1 + y0);
  }
  return area / 2; // negativo = CCW en coords Y-up (Shoelace con signo)
}

/**
 * Asegura que el polígono esté en sentido antihorario (CCW) en coords estándar Y-up.
 * Si el área con signo es positiva (CW), invierte el orden.
 */
export function ensureCCW(pts: [number,number][]): [number,number][] {
  // Shoelace formula: positivo en Y-down (imagen), negativo en Y-up
  // Nuestros puntos ya están en Y-up (invertimos Y al extraer), así que:
  //   area < 0 → CCW en Y-up → correcto
  //   area > 0 → CW en Y-up → invertir
  const area = signedArea(pts);
  return area > 0 ? [...pts].reverse() : pts;
}

/** Suavizado Laplaciano del polígono (n iteraciones) */
function smoothPolygon(pts: [number,number][], iters: number): [number,number][] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const n = p.length;
    p = p.map((pt, i) => {
      const prev = p[(i - 1 + n) % n];
      const next = p[(i + 1) % n];
      return [(prev[0] + pt[0]*2 + next[0]) / 4, (prev[1] + pt[1]*2 + next[1]) / 4];
    });
  }
  return p;
}

/** Re-muestrea el polígono a exactamente N puntos equiespaciados por arco */
function resamplePolygon(pts: [number,number][], n: number): [number,number][] {
  if (pts.length <= 2) return pts;

  // Calcular longitud total del polígono cerrado
  const totalLen = pts.reduce((sum, pt, i) => {
    const next = pts[(i + 1) % pts.length];
    return sum + Math.hypot(next[0] - pt[0], next[1] - pt[1]);
  }, 0);

  const step = totalLen / n;
  const result: [number,number][] = [];
  let accumulated = 0;
  let segIdx = 0;
  let segPos = 0;

  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (segIdx < pts.length) {
      const a = pts[segIdx];
      const b = pts[(segIdx + 1) % pts.length];
      const segLen = Math.hypot(b[0]-a[0], b[1]-a[1]);
      if (accumulated + segLen - segPos >= target - (accumulated + 0) || segLen === 0) {
        break;
      }
      accumulated += segLen - segPos;
      segPos = 0;
      segIdx = (segIdx + 1) % pts.length;
    }
    const a = pts[segIdx % pts.length];
    const b = pts[(segIdx + 1) % pts.length];
    const segLen = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const t = segLen > 0 ? Math.min(1, (target - accumulated + segPos) / segLen) : 0;
    result.push([a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])]);
  }

  return result;
}

// ─── Extrusión de contorno 2D → prisma 3D ────────────────────────────────────

/**
 * Extrude un contorno 2D en un prisma 3D.
 *
 * El eje de extrusión determina cómo se interpretan las coordenadas uv:
 *   axis='z': u→X, v→Y, extrude en Z   (Alzado frontal)
 *   axis='x': u→Z, v→Y, extrude en X   (Perfil lateral)
 *   axis='y': u→X, v→Z, extrude en Y   (Planta superior)
 */
export function extrudeContour2D(
  pts2D: SilhouetteContour,
  axis:  'x' | 'y' | 'z',
  boxSize: number = 2,
): { vertices: V3[]; faces: MeshFace[] } | null {
  if (pts2D.length < 3) return null;

  const n    = pts2D.length;
  const half = boxSize / 2;

  const mapVertex = (u: number, v: number, depth: number): V3 => {
    switch (axis) {
      case 'z': return [u, v,  depth];  // Alzado: (X, Y, Z_depth)
      case 'x': return [depth, v, u];   // Perfil: (X_depth, Y, Z)
      case 'y': return [u, depth, -v];  // Planta: (X, Y_depth, -Z) — invertir Z para que "arriba imagen = lejos"
    }
  };

  const bottomVerts: V3[] = pts2D.map(([u,v]) => mapVertex(u, v, -half));
  const topVerts:    V3[] = pts2D.map(([u,v]) => mapVertex(u, v,  half));

  const vertices: V3[] = [...bottomVerts, ...topVerts];
  const faces: MeshFace[] = [];

  // Tapa inferior (normal hacia −eje → winding invertido)
  faces.push({ indices: Array.from({ length: n }, (_, i) => n - 1 - i) });
  // Tapa superior (normal hacia +eje)
  faces.push({ indices: Array.from({ length: n }, (_, i) => n + i) });
  // Caras laterales
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ indices: [i, j, j + n, i + n] });
  }

  return { vertices, faces };
}

// ─── CSG helper ──────────────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).substr(2, 9);

function makeCSGObj(vertices: V3[], faces: MeshFace[]): CSGObject {
  return {
    id: genId(), name: 'tmp', type: 'CUBE', operation: 'INTERSECT',
    transform: { position:[0,0,0], rotation:[0,0,0], scale:[1,1,1] },
    parameters: {}, vertices, faces,
    color: '#ffffff', opacity: 1, visible: true, keyframes: [], vertexOffsets: {},
  };
}

// ─── Algoritmo principal ──────────────────────────────────────────────────────

/**
 * Genera una malla 3D intersecando prismas extruidos desde los contornos disponibles.
 * Soporta hasta 6 vistas (Front, Back, Left, Right, Top, Bottom).
 */
export function silhouettesToMesh(
  silhouettes: {
    front?: SilhouetteContour | null;
    back?:  SilhouetteContour | null;
    left?:  SilhouetteContour | null;
    right?: SilhouetteContour | null;
    top?:   SilhouetteContour | null;
    bottom?:SilhouetteContour | null;
  },
  boxSize: number = 2,
): { vertices: V3[]; faces: MeshFace[] } | null {
  const prisms: CSGObject[] = [];

  // Helper para añadir prismas
  const addPrism = (contour: SilhouetteContour | null | undefined, axis: 'x' | 'y' | 'z') => {
    if (contour && contour.length >= 3) {
      const ccw = ensureCCW(contour);
      const geo = extrudeContour2D(ccw, axis, boxSize);
      if (geo) prisms.push(makeCSGObj(geo.vertices, geo.faces));
    }
  };

  addPrism(silhouettes.front, 'z');
  addPrism(silhouettes.back,  'z');
  addPrism(silhouettes.left,  'x');
  addPrism(silhouettes.right, 'x');
  addPrism(silhouettes.top,   'y');
  addPrism(silhouettes.bottom,'y');

  if (prisms.length === 0) return null;

  try {
    let result = prisms[0];
    for (let i = 1; i < prisms.length; i++) {
      const next = prisms[i];
      const intersected = applyBooleanOperation(
        result,
        { ...next, operation: 'INTERSECT' },
        'INTERSECT'
      );
      if (intersected) {
        result = makeCSGObj(intersected.vertices, intersected.faces);
      }
    }
    return { vertices: result.vertices, faces: result.faces };
  } catch (err) {
    console.error('silhouettesToMesh error:', err);
    return null;
  }
}

// ─── Utilidades de imagen ────────────────────────────────────────────────────

/** Carga un File de imagen y devuelve su dataURL */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target!.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Dibuja una imagen con su contorno superpuesto en un canvas.
 * Para previsualización en el panel de la herramienta.
 */
export function drawContourOnCanvas(
  canvas: HTMLCanvasElement,
  imageUrl: string,
  contour: SilhouetteContour | null,
  color: string = '#ff4444',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (!contour || contour.length < 3) return;

    // Transformar de [-1,1] a coordenadas canvas
    const toCanvas = (u: number, v: number): [number, number] => [
      (u + 1) / 2 * canvas.width,
      (1 - (v + 1) / 2) * canvas.height,  // invertir Y para canvas
    ];

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 2]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    const [x0, y0] = toCanvas(contour[0][0], contour[0][1]);
    ctx.moveTo(x0, y0);
    contour.slice(1).forEach(([u, v]) => {
      const [x, y] = toCanvas(u, v);
      ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    // Puntos de vértice
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    contour.forEach(([u, v]) => {
      const [x, y] = toCanvas(u, v);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  };
  img.src = imageUrl;
}
