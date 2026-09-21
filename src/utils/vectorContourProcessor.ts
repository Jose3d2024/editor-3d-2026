/**
 * vectorContourProcessor.ts
 * 
 * Pipeline de Vectorización y Denoising de Alto Rendimiento para Three.js:
 * 1. Extracción de bordes/siluetas desde Canvas (Marching Squares / Detección de contornos).
 * 2. Limpieza de ruido Ramer-Douglas-Peucker (filtra micro-temblores y dientes de sierra).
 * 3. Ajuste de Curvas Bézier Cúbicas de Philip J. Schneider (Graphics Gems I).
 * 4. Conversión directa a THREE.Shape, THREE.BufferGeometry y THREE.LineLoop / THREE.Mesh.
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INTERSECTION, Evaluator, Brush } from 'three-bvh-csg';

// ─── Tipos y Estructuras ───────────────────────────────────────────────────────

export type Point2D = [number, number];

export interface CubicBezierCurve2D {
  p0: Point2D;
  c1: Point2D;
  c2: Point2D;
  p3: Point2D;
}

export type ContourSegment = 
  | { type: 'line'; p0: Point2D; p1: Point2D }
  | { type: 'bezier'; p0: Point2D; c1: Point2D; c2: Point2D; p3: Point2D };

export type VectorContourMode = 'BEZIER_SMOOTH' | 'HARD_SURFACE_RDP' | 'ORTHO_POLY' | 'ROUNDED_ADAPTIVE';

export interface DenoiseAndFitOptions {
  /** Modo de trazado: Bézier continuo, Superficie Dura RDP o Aproximación Ortogonal */
  contourMode?: VectorContourMode;
  /** Tolerancia de simplificación previa Douglas-Peucker en píxeles/unidades (def: 1.5) */
  rdpEpsilon?: number;
  /** Tolerancia máxima de error para el ajuste Bézier de Schneider (def: 2.0) */
  maxFittingError?: number;
  /** Umbral en grados para detectar esquinas vivas/vértices angulares (def: 50°) */
  cornerAngleThresholdDeg?: number;
  /** Número de iteraciones Newton-Raphson para refinar parámetros u (def: 4) */
  reparameterizeIterations?: number;
  /** Si es true, une el último punto con el primero cerrando el loop */
  closedLoop?: boolean;
}

export interface SilhouetteExtractionOptions {
  /** Umbral de luminancia (0..255) para separar silueta del fondo (Threshold en ImagR) */
  threshold?: number;
  /** Invertir detección (true si la silueta es clara sobre fondo oscuro) */
  invert?: boolean;
  /** Canal alfa mínimo para considerar píxel no transparente */
  minAlpha?: number;
  /** Si es true, normaliza las coordenadas al rango [-1, 1] centrado */
  normalizeRange?: boolean;
  /** Filtro de desenfoque previo en píxeles (Blur en ImagR) para fusionar dientes de sierra */
  blur?: number;
  /** Tolerancia Douglas-Peucker (Simplify en ImagR, ej: 6.5) */
  simplify?: number;
  /** Umbral angular en grados para protección de esquinas vivas (Curve en ImagR, ej: 75°) */
  cornerAngle?: number;
  /** Desplazamiento perimetral / dilatación de borde en píxeles (Border Offset en ImagR) */
  borderOffset?: number;
  /** Modo de trazado de contorno */
  contourMode?: VectorContourMode;
}

// ─── Helpers Vectoriales 2D ────────────────────────────────────────────────────

function distSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.sqrt(distSq(a, b));
}

function dot(a: Point2D, b: Point2D): number {
  return a[0] * b[0] + a[1] * b[1];
}

function norm(v: Point2D): Point2D {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-9 ? [v[0] / len, v[1] / len] : [0, 0];
}

function add(a: Point2D, b: Point2D): Point2D {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a: Point2D, b: Point2D): Point2D {
  return [a[0] - b[0], a[1] - b[1]];
}

function mul(a: Point2D, s: number): Point2D {
  return [a[0] * s, a[1] * s];
}

// ─── 1. PASO 1: Ramer-Douglas-Peucker (Filtro de Ruido Inicial) ────────────────

function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-9) return dist(p, a);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / mag;
}

/**
 * Algoritmo Ramer-Douglas-Peucker para cadenas de puntos abiertas.
 * Elimina micro-temblores y fluctuaciones de píxel menores que epsilon.
 */
export function ramerDouglasPeucker(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 2 || epsilon <= 0) return points;

  let dmax = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], start, end);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [start, end];
  }
}

/**
 * Ramer-Douglas-Peucker optimizado para polígonos y bucles cerrados.
 */
export function simplifyClosedContourRDP(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 4 || epsilon <= 0) return points;

  // Encontrar el punto más alejado del origen para dividir el bucle en 2 arcos
  const p0 = points[0];
  let maxD = 0;
  let splitIdx = Math.floor(points.length / 2);

  for (let i = 1; i < points.length; i++) {
    const d = distSq(points[i], p0);
    if (d > maxD) {
      maxD = d;
      splitIdx = i;
    }
  }

  const arc1 = ramerDouglasPeucker(points.slice(0, splitIdx + 1), epsilon);
  const arc2 = ramerDouglasPeucker([...points.slice(splitIdx), points[0]], epsilon);

  const merged: Point2D[] = [
    ...arc1.slice(0, -1),
    ...arc2.slice(0, -1)
  ];

  return merged.length >= 3 ? merged : points;
}

// ─── 2. PASO 2: Algoritmo de Philip J. Schneider (Bézier Curve Fitting) ────────

function evaluateCubicBezier(p0: Point2D, c1: Point2D, c2: Point2D, p3: Point2D, t: number): Point2D {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return [
    uuu * p0[0] + 3 * uu * t * c1[0] + 3 * u * tt * c2[0] + ttt * p3[0],
    uuu * p0[1] + 3 * uu * t * c1[1] + 3 * u * tt * c2[1] + ttt * p3[1]
  ];
}

function evaluateCubicBezierPrime(p0: Point2D, c1: Point2D, c2: Point2D, p3: Point2D, t: number): Point2D {
  const u = 1 - t;
  return [
    3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]),
    3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1])
  ];
}

function evaluateCubicBezierPrimePrime(p0: Point2D, c1: Point2D, c2: Point2D, p3: Point2D, t: number): Point2D {
  const u = 1 - t;
  return [
    6 * u * (c2[0] - 2 * c1[0] + p0[0]) + 6 * t * (p3[0] - 2 * c2[0] + c1[0]),
    6 * u * (c2[1] - 2 * c1[1] + p0[1]) + 6 * t * (p3[1] - 2 * c2[1] + c1[1])
  ];
}

/**
 * Parametriza una secuencia de puntos por longitud de cuerda (Chord Length Parametrization).
 */
function chordLengthParameterize(points: Point2D[], first: number, last: number): number[] {
  const u: number[] = [0];
  for (let i = first + 1; i <= last; i++) {
    u.push(u[u.length - 1] + dist(points[i], points[i - 1]));
  }
  const total = u[u.length - 1];
  if (total > 1e-9) {
    for (let i = 0; i < u.length; i++) {
      u[i] /= total;
    }
  } else {
    for (let i = 0; i < u.length; i++) {
      u[i] = i / (last - first);
    }
  }
  return u;
}

/**
 * Genera puntos de control Bézier candidato resolviendo el sistema de mínimos cuadrados 2x2.
 */
function generateBezierCandidate(
  points: Point2D[],
  first: number,
  last: number,
  uPrime: number[],
  tan1: Point2D,
  tan2: Point2D
): CubicBezierCurve2D {
  const p0 = points[first];
  const p3 = points[last];

  const c: [[number, number], [number, number]] = [[0, 0], [0, 0]];
  const x: [number, number] = [0, 0];

  const nPts = last - first + 1;

  for (let i = 0; i < nPts; i++) {
    const u = uPrime[i];
    const b0 = Math.pow(1 - u, 3);
    const b1 = 3 * u * Math.pow(1 - u, 2);
    const b2 = 3 * u * u * (1 - u);
    const b3 = u * u * u;

    const a1 = mul(tan1, b1);
    const a2 = mul(tan2, b2);

    c[0][0] += dot(a1, a1);
    c[0][1] += dot(a1, a2);
    c[1][0] = c[0][1];
    c[1][1] += dot(a2, a2);

    // Vector residual
    const target = points[first + i];
    const origin = add(add(mul(p0, b0), mul(p0, b1)), add(mul(p3, b2), mul(p3, b3)));
    const residual = sub(target, origin);

    x[0] += dot(residual, a1);
    x[1] += dot(residual, a2);
  }

  // Determinante del sistema 2x2
  const det_c0_c1 = c[0][0] * c[1][1] - c[1][0] * c[0][1];
  const det_c0_x = c[0][0] * x[1] - c[1][0] * x[0];
  const det_x_c1 = x[0] * c[1][1] - x[1] * c[0][1];

  let alpha1 = 0;
  let alpha2 = 0;

  if (Math.abs(det_c0_c1) > 1e-9) {
    alpha1 = det_x_c1 / det_c0_c1;
    alpha2 = det_c0_x / det_c0_c1;
  }

  // Heurística de respaldo si alpha es negativo o degenerado
  const segDist = dist(p0, p3);
  if (alpha1 <= 1e-6 || alpha2 <= 1e-6 || isNaN(alpha1) || isNaN(alpha2)) {
    const d = segDist / 3.0;
    return {
      p0,
      c1: add(p0, mul(tan1, d)),
      c2: add(p3, mul(tan2, d)),
      p3
    };
  }

  return {
    p0,
    c1: add(p0, mul(tan1, alpha1)),
    c2: add(p3, mul(tan2, alpha2)),
    p3
  };
}

/**
 * Encuentra el error máximo entre los puntos digitalizados y la curva Bézier propuesta.
 */
function computeMaxError(
  points: Point2D[],
  first: number,
  last: number,
  curve: CubicBezierCurve2D,
  u: number[]
): { maxError: number; splitPoint: number } {
  let maxError = 0;
  let splitPoint = Math.floor((last - first + 1) / 2);

  for (let i = first + 1; i < last; i++) {
    const pt = evaluateCubicBezier(curve.p0, curve.c1, curve.c2, curve.p3, u[i - first]);
    const d = distSq(pt, points[i]);
    if (d > maxError) {
      maxError = d;
      splitPoint = i;
    }
  }

  return { maxError: Math.sqrt(maxError), splitPoint };
}

/**
 * Refina las posiciones de los parámetros u mediante el método de Newton-Raphson.
 */
function reparameterize(
  points: Point2D[],
  first: number,
  last: number,
  u: number[],
  curve: CubicBezierCurve2D
): number[] {
  const result: number[] = [];
  for (let i = first; i <= last; i++) {
    const uOld = u[i - first];
    const pt = points[i];
    const q_u = evaluateCubicBezier(curve.p0, curve.c1, curve.c2, curve.p3, uOld);
    const qprime_u = evaluateCubicBezierPrime(curve.p0, curve.c1, curve.c2, curve.p3, uOld);
    const qprimeprime_u = evaluateCubicBezierPrimePrime(curve.p0, curve.c1, curve.c2, curve.p3, uOld);

    const diff = sub(q_u, pt);
    const num = dot(diff, qprime_u);
    const den = dot(qprime_u, qprime_u) + dot(diff, qprimeprime_u);

    if (Math.abs(den) > 1e-9) {
      const uNew = uOld - num / den;
      result.push(Math.max(0, Math.min(1, uNew)));
    } else {
      result.push(uOld);
    }
  }
  return result;
}

/**
 * Calcula tangentes unitarias iniciales y finales.
 */
function computeLeftTangent(points: Point2D[], end: number): Point2D {
  return norm(sub(points[end + 1], points[end]));
}

function computeRightTangent(points: Point2D[], end: number): Point2D {
  return norm(sub(points[end - 1], points[end]));
}

function computeCenterTangent(points: Point2D[], center: number): Point2D {
  const v1 = sub(points[center - 1], points[center]);
  const v2 = sub(points[center], points[center + 1]);
  return norm([(v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2]);
}

/**
 * Ajuste recursivo de Philip J. Schneider para un tramo de puntos.
 */
function fitCubicSection(
  points: Point2D[],
  first: number,
  last: number,
  tan1: Point2D,
  tan2: Point2D,
  maxError: number,
  reparamIters: number,
  curves: CubicBezierCurve2D[]
): void {
  const nPts = last - first + 1;

  // Si solo hay 2 puntos, unirlos con una curva Bézier recta lineal
  if (nPts === 2) {
    const d = dist(points[first], points[last]) / 3.0;
    curves.push({
      p0: points[first],
      c1: add(points[first], mul(tan1, d)),
      c2: add(points[last], mul(tan2, d)),
      p3: points[last]
    });
    return;
  }

  // 1. Parametrización inicial por longitud de cuerda
  let u = chordLengthParameterize(points, first, last);

  // 2. Generar primer candidato Bézier
  let candidate = generateBezierCandidate(points, first, last, u, tan1, tan2);
  let errorInfo = computeMaxError(points, first, last, candidate, u);

  if (errorInfo.maxError < maxError) {
    curves.push(candidate);
    return;
  }

  // 3. Si no pasa la tolerancia, refinar con Newton-Raphson
  for (let iter = 0; iter < reparamIters; iter++) {
    u = reparameterize(points, first, last, u, candidate);
    candidate = generateBezierCandidate(points, first, last, u, tan1, tan2);
    errorInfo = computeMaxError(points, first, last, candidate, u);
    if (errorInfo.maxError < maxError) {
      curves.push(candidate);
      return;
    }
  }

  // 4. Si aún excede el error, dividir en el punto de error máximo (splitPoint)
  const splitPoint = errorInfo.splitPoint;
  const tanCenter = computeCenterTangent(points, splitPoint);

  fitCubicSection(points, first, splitPoint, tan1, tanCenter, maxError, reparamIters, curves);
  fitCubicSection(points, splitPoint, last, mul(tanCenter, -1), tan2, maxError, reparamIters, curves);
}

/**
 * Detecta esquinas angulares (cambios bruscos de dirección).
 */
function findCornerIndices(points: Point2D[], angleThresholdDeg: number, isClosed: boolean = true): number[] {
  const corners: number[] = [0];
  const thresholdRad = (angleThresholdDeg * Math.PI) / 180;
  const n = points.length;

  for (let i = 1; i < n - 1; i++) {
    const v1 = norm(sub(points[i], points[i - 1]));
    const v2 = norm(sub(points[i + 1], points[i]));
    const dotVal = Math.max(-1, Math.min(1, dot(v1, v2)));
    const angle = Math.acos(dotVal);

    if (angle > thresholdRad) {
      corners.push(i);
    }
  }

  // Si es un bucle cerrado, comprobar también la esquina en el punto de cierre (índice 0 / n-1)
  if (isClosed && n >= 4) {
    const vEnd = norm(sub(points[n - 1], points[n - 2]));
    const vStart = norm(sub(points[1], points[0]));
    const dotVal = Math.max(-1, Math.min(1, dot(vEnd, vStart)));
    const angle = Math.acos(dotVal);
    if (angle > thresholdRad && !corners.includes(0)) {
      corners.push(0);
    }
  }

  if (corners[corners.length - 1] !== n - 1) {
    corners.push(n - 1);
  }
  return corners;
}

/**
 * Algoritmo Completo de Schneider para convertir una secuencia de puntos en curvas Bézier continuas.
 * 1. Limpieza de ruido con Ramer-Douglas-Peucker
 * 2. Segmentación en esquinas angulares (líneas rectas) y tramos fluidos (curvas Bézier cúbicas)
 * 3. Ajuste por mínimos cuadrados y refinamiento Newton-Raphson
 */
export function fitBezierCurvesSchneider(
  points: Point2D[],
  options: DenoiseAndFitOptions = {}
): CubicBezierCurve2D[] {
  const {
    rdpEpsilon = 0.015,
    maxFittingError = 0.05,
    cornerAngleThresholdDeg = 80,
    reparameterizeIterations = 4,
    closedLoop = true
  } = options;

  if (points.length < 2) return [];

  // Paso 1: Filtro Ramer-Douglas-Peucker para eliminar micro-ruido de píxel
  let cleanPts = closedLoop
    ? simplifyClosedContourRDP(points, rdpEpsilon)
    : ramerDouglasPeucker(points, rdpEpsilon);

  if (cleanPts.length <= 2) {
    const p0 = cleanPts[0];
    const p1 = cleanPts[cleanPts.length - 1];
    const d = dist(p0, p1) / 3;
    const tan = norm(sub(p1, p0));
    return [{
      p0,
      c1: add(p0, mul(tan, d)),
      c2: sub(p1, mul(tan, d)),
      p3: p1
    }];
  }

  // Asegurar que el contorno cerrado tenga el punto final coincidente con el inicial para el recorrido
  let workingPts: Point2D[] = cleanPts;
  if (closedLoop) {
    const pFirst = cleanPts[0];
    const pLast = cleanPts[cleanPts.length - 1];
    if (distSq(pFirst, pLast) > 1e-6) {
      workingPts = [...cleanPts, pFirst];
    }
  }

  // Paso 2: Identificar esquinas angulares y dividir en tramos continuos
  const corners = findCornerIndices(workingPts, cornerAngleThresholdDeg, closedLoop);
  const curves: CubicBezierCurve2D[] = [];

  for (let c = 0; c < corners.length - 1; c++) {
    const first = corners[c];
    const last = corners[c + 1];
    if (last - first < 1) continue;

    const tan1 = computeLeftTangent(workingPts, first);
    const tan2 = computeRightTangent(workingPts, last);

    fitCubicSection(
      workingPts,
      first,
      last,
      tan1,
      tan2,
      maxFittingError,
      reparameterizeIterations,
      curves
    );
  }

  return curves;
}

// ─── 3. PASO 3: Extracción de Puntos con Ruido desde Canvas ──────────────────

/**
 * PASO 1 CORREGIDO: Rastreador Perimetral Moore-Neighbor para Imágenes con Fondo Blanco.
 * Rodea las almenas y entrantes de la torre de forma milimétrica ignorando el falso alfa.
 */
export function obtenerPuntosConRuido(
  canvas: HTMLCanvasElement,
  options: SilhouetteExtractionOptions = {}
): Point2D[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const {
    threshold = 230, // 💡 Para fondo blanco puro, un umbral de 230-240 es perfecto para detectar la piedra
    invert = false,
    normalizeRange = false,
    blur = 1 // Filtro de desenfoque previo (Blur en ImagR) para fusionar dientes de sierra
  } = options;

  const W = canvas.width;
  const H = canvas.height;

  // Paso 0: Aplicar Blur si está configurado para fusionar los dientes de sierra del píxel
  let imgData: ImageData;
  if (blur && blur > 0 && typeof document !== 'undefined') {
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = W;
    blurCanvas.height = H;
    const blurCtx = blurCanvas.getContext('2d');
    if (blurCtx) {
      blurCtx.filter = `blur(${blur}px)`;
      blurCtx.drawImage(canvas, 0, 0);
      blurCtx.filter = 'none';
      imgData = blurCtx.getImageData(0, 0, W, H);
    } else {
      imgData = ctx.getImageData(0, 0, W, H);
    }
  } else {
    imgData = ctx.getImageData(0, 0, W, H);
  }

  const data = imgData.data;

  // Función ultra-precisa para discriminar el fondo blanco nuclear de la piedra
  const isFg = (x: number, y: number): boolean => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const idx = (y * W + x) * 4;

    // Ignoramos el canal alfa (data[idx+3]) porque la imagen tiene fondo blanco sólido
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Calculamos la luminancia del píxel (0 = Negro absoluto, 255 = Blanco absoluto)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Si el píxel es prácticamente blanco (ej: > 240), es fondo 100%.
    // Si es más oscuro, es la piedra texturizada de la torre.
    const esPiedraObjeto = lum < threshold;
    return invert ? !esPiedraObjeto : esPiedraObjeto;
  };

  // 1. ENCONTRAR EL PRIMER PUNTO DE LA TORRE (Escaneando desde arriba hacia abajo)
  let startX = -1;
  let startY = -1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFg(x, y)) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) return []; // No se detectó la torre

  // 2. ALGORITMO DE CAMINANTE PERIMETRAL (Evita el colapso de las columnas vacías)
  const rawContour: Point2D[] = [];
  let cx = startX;
  let cy = startY;
  let dirEntrada = 3; // Comenzamos buscando desde la izquierda

  // Direcciones: 0=Arriba, 1=Derecha, 2=Abajo, 3=Izquierda
  const offsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const maxPasos = W * H * 2;
  let pasos = 0;

  do {
    rawContour.push([cx, cy]);
    let encontradoSiguiente = false;

    for (let i = 0; i < 4; i++) {
      const evalDir = (dirEntrada + i) % 4;
      const nX = cx + offsets[evalDir][0];
      const nY = cy + offsets[evalDir][1];

      if (isFg(nX, nY)) {
        cx = nX;
        cy = nY;
        dirEntrada = (evalDir + 3) % 4; // Reorientar el compás de giro
        encontradoSiguiente = true;
        break;
      }
    }

    if (!encontradoSiguiente) break;
    pasos++;
    if (pasos > maxPasos) break; // Seguro contra bucles infinitos

  } while (cx !== startX || cy !== startY);

  // 3. NORMALIZACIÓN AL RANGO DE THREE.JS COHERENTE CON EL LIENZO 2D
  if (!normalizeRange) return rawContour;

  // Calculamos las dimensiones estrictas de la imagen real para no descentrarla
  const centroImagenX = W / 2;
  const centroImagenY = H / 2;

  // El factor de escala debe basarse en el tamaño total del lienzo (W o H) 
  // para mantener una correspondencia exacta 1:1 al des-normalizar en el canvas 2D
  const dimensionMaxima = Math.max(W, H) / 2;

  return rawContour.map(([px, py]) => {
    // Convertimos las coordenadas para que el centro (0,0) sea el medio exacto del lienzo
    // e invertimos el eje Y de forma simétrica sin alterar el offset
    const xNormalizado = (px - centroImagenX) / dimensionMaxima;
    const yNormalizado = -((py - centroImagenY) / dimensionMaxima);

    return [xNormalizado, yNormalizado] as Point2D;
  });
}

// ─── 4. Conversión a THREE.Shape y Renderizado Vectorial ───────────────────────

/**
 * Suavizado Laplaciano del contorno poligonal (n iteraciones).
 * Promedia cada punto con sus vecinos adyacentes para limar el efecto escalera de píxeles.
 */
export function smoothPolygon(pts: Point2D[], iters: number = 3): Point2D[] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const n = p.length;
    if (n <= 2) return p;
    p = p.map((pt, i) => {
      const prev = p[(i - 1 + n) % n];
      const next = p[(i + 1) % n];
      return [(prev[0] + pt[0] * 2 + next[0]) / 4, (prev[1] + pt[1] * 2 + next[1]) / 4];
    });
  }
  return p;
}

/**
 * Ajusta ángulos casi ortogonales (0°, 45°, 90°, 135°, 180°...) para almenas y arquitectura perfecta
 */
export function snapToOrthogonalOrDiagonal(puntos: Point2D[], toleranceRad: number = 0.15): Point2D[] {
  if (puntos.length < 3) return puntos;
  const n = puntos.length;
  const resultado: Point2D[] = [...puntos];

  for (let i = 0; i < n; i++) {
    const prev = resultado[(i - 1 + n) % n];
    const curr = resultado[i];
    const next = resultado[(i + 1) % n];

    // Vector segmento prev -> curr
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-5) continue;

    const angle = Math.atan2(dy, dx);
    // Cuantizar a múltiplos de PI/4 (45°) o PI/2 (90°)
    const snapStep = Math.PI / 4;
    const nearestSnap = Math.round(angle / snapStep) * snapStep;
    const diff = Math.abs(angle - nearestSnap);

    if (diff < toleranceRad) {
      // Ajustar curr a lo largo del ángulo cuantizado preservando la distancia
      const newX = prev[0] + Math.cos(nearestSnap) * len;
      const newY = prev[1] + Math.sin(nearestSnap) * len;
      resultado[i] = [newX, newY];
    }
  }

  return resultado;
}

/**
 * Convierte una lista de puntos en un objeto `THREE.Shape` limpio y libre de ruido.
 * Soporta modo 'HARD_SURFACE_RDP' / 'ORTHO_POLY' (segmentos rectos con RDP puro, perfecto para almenas y torres)
 * y modo 'BEZIER_SMOOTH' (curvas Bézier fluidas de Schneider para formas orgánicas).
 */
export function simplificarSiluetaAThreeShape(
  puntos: Point2D[],
  options: DenoiseAndFitOptions = {}
): THREE.Shape {
  const shape = new THREE.Shape();
  if (puntos.length === 0) return shape;

  const mode = options.contourMode ?? 'HARD_SURFACE_RDP';

  // 1. MODO HARD SURFACE / POLÍGONO ORTOGONAL / SILUETA REDONDEADA ADAPTATIVA (LINE_TO)
  // Salta por completo el ajuste Bézier de Schneider que deforma arcos y genera picos imprevistos.
  if (mode === 'HARD_SURFACE_RDP' || mode === 'ORTHO_POLY' || mode === 'ROUNDED_ADAPTIVE') {
    const rdpEps = options.rdpEpsilon ?? 0.014;
    let ptsSimplificados = mode === 'ROUNDED_ADAPTIVE' ? puntos : simplifyClosedContourRDP(puntos, rdpEps);

    if (mode === 'ORTHO_POLY') {
      ptsSimplificados = snapToOrthogonalOrDiagonal(ptsSimplificados, 0.18);
    }

    if (ptsSimplificados.length < 3) return shape;

    shape.moveTo(ptsSimplificados[0][0], ptsSimplificados[0][1]);
    for (let i = 1; i < ptsSimplificados.length; i++) {
      shape.lineTo(ptsSimplificados[i][0], ptsSimplificados[i][1]);
    }
    shape.closePath();
    return shape;
  }

  // 2. MODO BÉZIER CONTINUO (SCHNEIDER FITTING)
  // Ejecutar el pipeline de Schneider con valores adaptados al espacio normalizado
  const curves = fitBezierCurvesSchneider(puntos, {
    rdpEpsilon: options.rdpEpsilon ?? 0.015,
    maxFittingError: options.maxFittingError ?? 0.05,
    cornerAngleThresholdDeg: options.cornerAngleThresholdDeg ?? 80,
    reparameterizeIterations: options.reparameterizeIterations ?? 4,
    closedLoop: options.closedLoop ?? true
  });

  if (curves.length === 0) {
    shape.moveTo(puntos[0][0], puntos[0][1]);
    for (let i = 1; i < puntos.length; i++) {
      shape.lineTo(puntos[i][0], puntos[i][1]);
    }
    shape.closePath();
    return shape;
  }

  // Construir la ruta Bézier de Three.js
  const first = curves[0];
  shape.moveTo(first.p0[0], first.p0[1]);

  for (let i = 0; i < curves.length; i++) {
    const c = curves[i];
    shape.bezierCurveTo(c.c1[0], c.c1[1], c.c2[0], c.c2[1], c.p3[0], c.p3[1]);
  }

  shape.closePath();
  return shape;
}

/**
 * 3. CONTROLADOR PRINCIPAL Y RENDER DEL CONTORNO EN THREE.JS
 * 
 * Toma un canvas con una imagen/silueta pixelada, ejecuta el pipeline completo:
 * [Silueta Pixelada] ➔ [1. Douglas-Peucker] ➔ [2. Schneider Bézier] ➔ [3. Three.js LineLoop]
 * y añade el contorno vectorial ultra limpio a la escena 3D.
 */
export function procesarImagenYRenderizarLinea(
  canvasImagen: HTMLCanvasElement,
  escenaThreeJS: THREE.Scene,
  options: {
    color?: number | string;
    curveSegments?: number;
    fitOptions?: DenoiseAndFitOptions;
    extractOptions?: SilhouetteExtractionOptions;
    autoCenter?: boolean;
    scale?: number;
  } = {}
): { shape: THREE.Shape; line: THREE.LineLoop; points: THREE.Vector2[] } | null {
  const {
    color = 0x00ff88,
    curveSegments = 64,
    fitOptions = {},
    extractOptions = { normalizeRange: true },
    autoCenter = true,
    scale = 1.0
  } = options;

  // Paso 1: Extraer los puntos iniciales con ruido del canvas
  let puntosSucios = obtenerPuntosConRuido(canvasImagen, extractOptions);
  if (puntosSucios.length === 0) return null;

  if (puntosSucios.length > 4) {
    puntosSucios = smoothPolygon(puntosSucios, 3);
  }

  // Paso 2: Limpiar ruido y estructurar la forma vectorial (Genera curvas Bézier fluidas)
  const siluetaLimpiaShape = simplificarSiluetaAThreeShape(puntosSucios, fitOptions);

  // Paso 3: CORRECCIÓN DE DENSIDAD DE PUNTOS:
  // En lugar de usar getPoints puro (que fragmenta en base a curveSegments),
  // usamos 'getSpacedPoints' con un valor bajo para forzar a que la interfaz 
  // pinte únicamente un número limitado y equidistante de puntos de control interactivos.
  const puntosDeLaCurva = siluetaLimpiaShape.getSpacedPoints(12); // Limita a solo 12 puntos de control en el círculo

  // Paso 4: Crear la geometría de líneas de Three.js
  const geometriaLinea = new THREE.BufferGeometry().setFromPoints(puntosDeLaCurva);
  if (autoCenter) {
    geometriaLinea.center();
  }
  if (scale !== 1.0) {
    geometriaLinea.scale(scale, scale, scale);
  }

  // Paso 5: Crear el material para la línea
  const materialLinea = new THREE.LineBasicMaterial({
    color: typeof color === 'string' ? new THREE.Color(color) : color,
    linewidth: 2
  });

  // Usamos LineLoop para cerrar suavemente el contorno
  const siluetaContorno = new THREE.LineLoop(geometriaLinea, materialLinea);
  siluetaContorno.name = 'VectorSilhouette_Schneider_Denoised';

  // Añadir a la escena 3D
  escenaThreeJS.add(siluetaContorno);

  return {
    shape: siluetaLimpiaShape,
    line: siluetaContorno,
    points: puntosDeLaCurva
  };
}

// ─── 5. Normalización y Acople Automático de Siluetas ─────────────────────────

export interface SiluetaProportions {
  ancho: number;
  alto: number;
  profundidad: number;
  escalaGlobalX: number;
  escalaLateralX: number;
  escalaLateralY: number;
  escalaSuperiorX: number;
  escalaSuperiorY: number;
}

/**
 * Normaliza y acopla matemáticamente las 3 siluetas vectoriales (Frontal, Lateral, Superior)
 * para que sus dimensiones coincidan exactamente en el espacio 3D sin deformación.
 * 
 * Reglas de acople:
 * - Ancho Frontal = Ancho Superior
 * - Alto Frontal = Alto Lateral
 * - Ancho Lateral = Alto (Profundidad) Superior
 */
export function normalizarYAlinearSiluetas(
  shapeFrontal: THREE.Shape,
  shapeLateral: THREE.Shape,
  shapeSuperior: THREE.Shape,
  tamanoReferencia: number = 100
): SiluetaProportions {
  const puntosF = shapeFrontal.getPoints();
  const puntosL = shapeLateral.getPoints();
  const puntosS = shapeSuperior.getPoints();

  const boxF = new THREE.Box2().setFromPoints(puntosF);
  const boxL = new THREE.Box2().setFromPoints(puntosL);
  const boxS = new THREE.Box2().setFromPoints(puntosS);

  const dimF = new THREE.Vector2(); boxF.getSize(dimF);
  const dimL = new THREE.Vector2(); boxL.getSize(dimL);
  const dimS = new THREE.Vector2(); boxS.getSize(dimS);

  const safeF_x = Math.max(dimF.x, 1e-4);
  const safeF_y = Math.max(dimF.y, 1e-4);
  const safeL_x = Math.max(dimL.x, 1e-4);
  const safeL_y = Math.max(dimL.y, 1e-4);
  const safeS_x = Math.max(dimS.x, 1e-4);
  const safeS_y = Math.max(dimS.y, 1e-4);

  // Escala global basada en la vista frontal
  const escalaGlobalX = tamanoReferencia / safeF_x;
  const altoFinalDeseado = safeF_y * escalaGlobalX;
  const profundidadFinalDeseada = (safeS_y / safeS_x) * tamanoReferencia;

  // Escalar curvas internas de cada Shape
  const escalarCurvasDeShape = (shape: THREE.Shape, sx: number, sy: number) => {
    for (const c of shape.curves) {
      const anyC = c as any;
      if (anyC.v0) { anyC.v0.x *= sx; anyC.v0.y *= sy; }
      if (anyC.v1) { anyC.v1.x *= sx; anyC.v1.y *= sy; }
      if (anyC.v2) { anyC.v2.x *= sx; anyC.v2.y *= sy; }
      if (anyC.v3) { anyC.v3.x *= sx; anyC.v3.y *= sy; }
      if (anyC.aX !== undefined) { anyC.aX *= sx; anyC.aY *= sy; anyC.xRadius *= sx; anyC.yRadius *= sy; }
    }
  };

  // 1. Escalar vista Frontal
  escalarCurvasDeShape(shapeFrontal, escalaGlobalX, escalaGlobalX);

  // 2. Escalar vista Lateral (Alto coincide con Frontal, Ancho representa Profundidad 3D)
  const escalaLateralX = profundidadFinalDeseada / safeL_x;
  const escalaLateralY = altoFinalDeseado / safeL_y;
  escalarCurvasDeShape(shapeLateral, escalaLateralX, escalaLateralY);

  // 3. Escalar vista Superior (Ancho coincide con Frontal, Alto representa Profundidad)
  const escalaSuperiorX = tamanoReferencia / safeS_x;
  const escalaSuperiorY = profundidadFinalDeseada / safeS_y;
  escalarCurvasDeShape(shapeSuperior, escalaSuperiorX, escalaSuperiorY);

  return {
    ancho: tamanoReferencia,
    alto: altoFinalDeseado,
    profundidad: profundidadFinalDeseada,
    escalaGlobalX,
    escalaLateralX,
    escalaLateralY,
    escalaSuperiorX,
    escalaSuperiorY
  };
}

// ─── 6. Mapeado de Texturas Triplanar Automatizado en Shader ───────────────────

export interface TriplanarMaterialOptions {
  /** Factor de escala de la textura en el espacio 3D (def: 0.01) */
  escalaTextura?: number;
  /** Exponente de nitidez de mezcla en aristas (def: 8.0) */
  blendingSharpness?: number;
  /** Color base de tinte */
  baseColor?: number | string;
  /** Vector de dirección de luz */
  luzDireccion?: THREE.Vector3;
  /** Opacidad general (0..1) */
  opacity?: number;
  /** Si es true, activa transparencia */
  transparent?: boolean;
}

/**
 * Crea un material Triplanar proyectado en tiempo real desde las 3 vistas ortogonales.
 * No requiere UV Unwrapping manual y proyecta automáticamente cada vista en su eje correspondiente:
 * - Frontal: Eje Z (XY)
 * - Lateral: Eje X (ZY)
 * - Superior: Eje Y (XZ)
 */
export function crearMaterialTriplanar(
  texFrontal: THREE.Texture,
  texLateral: THREE.Texture,
  texSuperior: THREE.Texture,
  options: TriplanarMaterialOptions = {}
): THREE.ShaderMaterial {
  const {
    escalaTextura = 0.01,
    blendingSharpness = 8.0,
    baseColor = 0xffffff,
    luzDireccion = new THREE.Vector3(1, 1.5, 1).normalize(),
    opacity = 1.0,
    transparent = false
  } = options;

  [texFrontal, texLateral, texSuperior].forEach(tex => {
    if (tex) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
  });

  const c = typeof baseColor === 'string' ? new THREE.Color(baseColor) : new THREE.Color(baseColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      tFrontal: { value: texFrontal },
      tLateral: { value: texLateral },
      tSuperior: { value: texSuperior },
      escalaTextura: { value: escalaTextura },
      blendingSharpness: { value: blendingSharpness },
      baseColor: { value: c },
      luzDireccion: { value: luzDireccion },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D tFrontal;
      uniform sampler2D tLateral;
      uniform sampler2D tSuperior;
      uniform float escalaTextura;
      uniform float blendingSharpness;
      uniform vec3 baseColor;
      uniform vec3 luzDireccion;
      uniform float uOpacity;

      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        // 1. Pesos de proyección por normal
        vec3 blending = abs(vNormal);
        blending = pow(blending, vec3(blendingSharpness));
        float total = blending.x + blending.y + blending.z;
        blending = total > 0.0001 ? blending / total : vec3(0.3333);

        // 2. Coordenadas de textura proyectadas ortogonalmente centradas
        vec2 uvX = vec2(vWorldPosition.z, vWorldPosition.y) * escalaTextura + 0.5;
        vec2 uvY = vec2(vWorldPosition.x, -vWorldPosition.z) * escalaTextura + 0.5;
        vec2 uvZ = vec2(vWorldPosition.x, vWorldPosition.y) * escalaTextura + 0.5;

        // 3. Muestreo de las 3 texturas de referencia
        vec4 colX = texture2D(tLateral, uvX);
        vec4 colY = texture2D(tSuperior, uvY);
        vec4 colZ = texture2D(tFrontal, uvZ);

        // 4. Mezcla ponderada por orientación de cara
        vec4 colorFinal = colX * blending.x + colY * blending.y + colZ * blending.z;
        colorFinal.rgb *= baseColor;

        // 5. Sombreado Lambert + luz de relleno
        float nDotL = max(dot(normalize(vNormal), normalize(luzDireccion)), 0.0);
        float iluminacion = 0.35 + 0.65 * nDotL;

        gl_FragColor = vec4(colorFinal.rgb * iluminacion, colorFinal.a * uOpacity);
      }
    `,
    transparent: transparent || opacity < 1.0,
    side: THREE.DoubleSide
  });
}

// ─── 7. Generador de Malla 3D CSG con Complejidad Variable ─────────────────────

export type PolygonComplexityMode = 'low' | 'medium' | 'high' | 'ultra';

export interface GenerarMallaOptions {
  /** Modo de poligonización: 'low' (Low Poly facetado), 'medium', 'high' (Suave), 'ultra' */
  modoDetalle?: PolygonComplexityMode;
  /** Tamaño de referencia en unidades 3D (def: 100) */
  tamanoReferencia?: number;
  /** Color para material estándar (si no se usa triplanar) */
  color?: number | string;
  /** Material personalizado opcional */
  materialCustom?: THREE.Material;
  /** Ángulo para calcular toCreasedNormals en radianes (def: Math.PI / 6 = 30°) */
  creaseAngleRad?: number;
  /** Habilitar bisel en extrusiones (def: false para caras nítidas) */
  bevelEnabled?: boolean;
}

/**
 * Genera la malla 3D final realizando extrusiones ortogonales en los 3 ejes
 * e intersectándolas con three-bvh-csg (Visual Hull booleano).
 */
export function generarMallaConComplejidadVariable(
  shapeFrontal: THREE.Shape,
  shapeLateral: THREE.Shape,
  shapeSuperior: THREE.Shape,
  options: GenerarMallaOptions = {}
): THREE.Mesh {
  const {
    modoDetalle = 'medium',
    tamanoReferencia = 100,
    color = 0x4f46e5,
    materialCustom,
    creaseAngleRad = Math.PI / 6,
    bevelEnabled = false
  } = options;

  // 1. Acoplar proporciones de las siluetas vectoriales
  const dim = normalizarYAlinearSiluetas(shapeFrontal, shapeLateral, shapeSuperior, tamanoReferencia);

  // 2. Parámetros según nivel de detalle
  let resolucionCurva = 24;
  let usarFlatShading = false;
  let aplicarSuavizadoCreased = false;

  switch (modoDetalle.toLowerCase() as PolygonComplexityMode) {
    case 'low':
      resolucionCurva = 6;
      usarFlatShading = true;
      aplicarSuavizadoCreased = false;
      break;
    case 'medium':
      resolucionCurva = 24;
      usarFlatShading = false;
      aplicarSuavizadoCreased = false;
      break;
    case 'high':
      resolucionCurva = 48;
      usarFlatShading = false;
      aplicarSuavizadoCreased = true;
      break;
    case 'ultra':
      resolucionCurva = 64;
      usarFlatShading = false;
      aplicarSuavizadoCreased = true;
      break;
  }

  const optExtrudeBase = {
    bevelEnabled,
    curveSegments: resolucionCurva
  };

  // 3. Crear geometrías extruidas con profundidad de corte generosa
  const geoF = new THREE.ExtrudeGeometry(shapeFrontal, {
    ...optExtrudeBase,
    depth: dim.profundidad * 1.5
  });
  const geoL = new THREE.ExtrudeGeometry(shapeLateral, {
    ...optExtrudeBase,
    depth: dim.ancho * 1.5
  });
  const geoS = new THREE.ExtrudeGeometry(shapeSuperior, {
    ...optExtrudeBase,
    depth: dim.alto * 1.5
  });

  geoF.center();
  geoL.center();
  geoS.center();

  // 4. Material base
  const mat = materialCustom || new THREE.MeshStandardMaterial({
    color: typeof color === 'string' ? new THREE.Color(color) : color,
    flatShading: usarFlatShading,
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide
  });

  const brushF = new Brush(geoF, mat);
  const brushL = new Brush(geoL, mat);
  const brushS = new Brush(geoS, mat);

  // Orientación ortogonal exacta
  brushL.rotation.set(0, Math.PI / 2, 0);
  brushS.rotation.set(Math.PI / 2, 0, 0);

  brushF.updateMatrixWorld();
  brushL.updateMatrixWorld();
  brushS.updateMatrixWorld();

  // 5. Intersección CSG consecutiva
  const evaluator = new Evaluator();
  const parcial = evaluator.evaluate(brushF, brushL, INTERSECTION);
  const mallaFinal = evaluator.evaluate(parcial, brushS, INTERSECTION);

  // 6. Suavizado creased avanzado para alta definición orgánica con aristas vivas
  if (aplicarSuavizadoCreased && mallaFinal.geometry) {
    try {
      const geomCreased = BufferGeometryUtils.toCreasedNormals(mallaFinal.geometry, creaseAngleRad);
      mallaFinal.geometry.dispose();
      mallaFinal.geometry = geomCreased;
    } catch (e) {
      console.warn('Suavizado toCreasedNormals no aplicado:', e);
    }
  }

  // Centrar la malla resultante
  mallaFinal.geometry.computeBoundingBox();
  mallaFinal.geometry.center();
  mallaFinal.geometry.computeVertexNormals();

  mallaFinal.castShadow = true;
  mallaFinal.receiveShadow = true;
  mallaFinal.name = `BlueprintModel_${modoDetalle.toUpperCase()}`;

  return mallaFinal;
}

// ─── 8. Pipeline Completo Automatizado desde Imágenes de Referencia ────────────

export interface CrearModelo3DAutoOptions {
  frontImage: HTMLCanvasElement | HTMLImageElement | string;
  sideImage: HTMLCanvasElement | HTMLImageElement | string;
  topImage: HTMLCanvasElement | HTMLImageElement | string;
  modoDetalle?: PolygonComplexityMode;
  topologia?: string;
  contourMode?: VectorContourMode;
  autoTexturizadoTriplanar?: boolean;
  tamanoReferencia?: number;
  color?: number | string;
  rdpEpsilon?: number;
  maxFittingError?: number;
  threshold?: number;
  blur?: number;
  simplify?: number;
  cornerAngle?: number;
}

/**
 * Carga una imagen o canvas como THREE.Texture
 */
async function cargarTexturaDesdeFuente(fuente: HTMLCanvasElement | HTMLImageElement | string): Promise<THREE.Texture> {
  if (fuente instanceof HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(fuente);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }
  
  const url = typeof fuente === 'string' ? fuente : fuente.src;
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      tex => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        resolve(tex);
      },
      undefined,
      err => reject(err)
    );
  });
}

/**
 * Extrae canvas 2D desde string URL, imagen o canvas existente
 */
async function fuenteACanvas(fuente: HTMLCanvasElement | HTMLImageElement | string): Promise<HTMLCanvasElement> {
  if (fuente instanceof HTMLCanvasElement) return fuente;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width || 512;
      c.height = img.height || 512;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(c);
      } else {
        reject(new Error('No se pudo crear contexto de canvas 2D'));
      }
    };
    img.onerror = () => reject(new Error('Error al cargar imagen para silueta'));
    img.src = typeof fuente === 'string' ? fuente : fuente.src;
  });
}

/**
 * Proceso 100% automatizado:
 * [3 Imágenes] ➔ [Denoising Schneider] ➔ [3 Siluetas Shape] ➔ [Auto-Acople CSG] ➔ [Triplanar Texture] ➔ THREE.Mesh
 */
export async function crearModelo3DDesdeReferenciasOImagenes(
  options: CrearModelo3DAutoOptions
): Promise<{ mesh: THREE.Mesh; proportions: SiluetaProportions; material: THREE.Material }> {
  const {
    frontImage,
    sideImage,
    topImage,
    modoDetalle = 'medium',
    topologia,
    contourMode,
    autoTexturizadoTriplanar = true,
    tamanoReferencia = 100,
    color = 0x4f46e5,
    rdpEpsilon,
    maxFittingError,
    threshold = 230,
    blur = 1,
    simplify = 6.5,
    cornerAngle = 75
  } = options;

  // 1. Convertir fuentes a Canvas 2D
  const [canvF, canvL, canvS] = await Promise.all([
    fuenteACanvas(frontImage),
    fuenteACanvas(sideImage),
    fuenteACanvas(topImage)
  ]);

  // 2. Extraer contornos y aplicar denoising
  let ptsF = obtenerPuntosConRuido(canvF, { threshold, blur, normalizeRange: true });
  let ptsL = obtenerPuntosConRuido(canvL, { threshold, blur, normalizeRange: true });
  let ptsS = obtenerPuntosConRuido(canvS, { threshold, blur, normalizeRange: true });

  // 🌟 Suavizado Laplaciano por Vecindad (Vecinos más cercanos)
  // Limamos la escalera de píxel preservando la geometría macro
  if (ptsF.length > 4) ptsF = smoothPolygon(ptsF, 2);
  if (ptsL.length > 4) ptsL = smoothPolygon(ptsL, 2);
  if (ptsS.length > 4) ptsS = smoothPolygon(ptsS, 2);

  // Si el usuario seleccionó topología Low-Poly / Hard-Surface o especificó modo HARD_SURFACE / ORTHO:
  const esHardSurface = contourMode === 'HARD_SURFACE_RDP' || contourMode === 'ORTHO_POLY' || modoDetalle === 'low' || (topologia && topologia.includes('Low-Poly'));

  // Sincronización precisa de opciones de ajuste
  const fitOpt: DenoiseAndFitOptions = {
    contourMode: contourMode ?? (esHardSurface ? 'HARD_SURFACE_RDP' : 'BEZIER_SMOOTH'),
    // Tolerancia RDP óptima (0.014 colapsa las almenas e ignora la textura de piedra)
    rdpEpsilon: rdpEpsilon ?? (esHardSurface ? 0.014 : ((simplify ?? 6.5) * 0.003)),
    maxFittingError: maxFittingError ?? 0.1,
    cornerAngleThresholdDeg: cornerAngle ?? (esHardSurface ? 35 : 75),
    reparameterizeIterations: 4,
    closedLoop: true
  };

  // Generamos las formas vectoriales limpias para Three.js libres de ruido de píxel
  const shapeF = simplificarSiluetaAThreeShape(ptsF.length ? ptsF : [[0,0],[10,0],[10,10],[0,10]], fitOpt);
  const shapeL = simplificarSiluetaAThreeShape(ptsL.length ? ptsL : [[0,0],[10,0],[10,10],[0,10]], fitOpt);
  const shapeS = simplificarSiluetaAThreeShape(ptsS.length ? ptsS : [[0,0],[10,0],[10,10],[0,10]], fitOpt);

  // 3. Crear texturas si se activa Triplanar Auto-Texturing
  let matFinal: THREE.Material;

  if (autoTexturizadoTriplanar) {
    const [texF, texL, texS] = await Promise.all([
      cargarTexturaDesdeFuente(frontImage),
      cargarTexturaDesdeFuente(sideImage),
      cargarTexturaDesdeFuente(topImage)
    ]);
    matFinal = crearMaterialTriplanar(texF, texL, texS, {
      escalaTextura: 1 / tamanoReferencia,
      blendingSharpness: modoDetalle === 'low' ? 12.0 : 8.0
    });
  } else {
    matFinal = new THREE.MeshStandardMaterial({
      color: typeof color === 'string' ? new THREE.Color(color) : color,
      flatShading: modoDetalle === 'low',
      roughness: 0.4,
      metalness: 0.1
    });
  }

  // 4. Generar malla 3D CSG
  const mesh = generarMallaConComplejidadVariable(shapeF, shapeL, shapeS, {
    modoDetalle,
    tamanoReferencia,
    materialCustom: matFinal
  });

  const proportions = normalizarYAlinearSiluetas(shapeF, shapeL, shapeS, tamanoReferencia);

  return {
    mesh,
    proportions,
    material: matFinal
  };
}

/**
 * Convierte un THREE.BufferGeometry (indexado o no indexado) a la estructura { vertices: V3[], faces: MeshFace[] }
 * con deduplicación de vértices por proximidad.
 */
export function bufferGeometryToVerticesAndFaces(geometry: THREE.BufferGeometry): {
  vertices: [number, number, number][];
  faces: { indices: number[] }[];
} {
  const geom = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return { vertices: [], faces: [] };

  const vertices: [number, number, number][] = [];
  const faces: { indices: number[] }[] = [];
  const vertMap = new Map<string, number>();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    let vIdx = vertMap.get(key);
    if (vIdx === undefined) {
      vIdx = vertices.length;
      vertices.push([x, y, z]);
      vertMap.set(key, vIdx);
    }
  }

  for (let i = 0; i < posAttr.count; i += 3) {
    const k0 = `${posAttr.getX(i).toFixed(4)},${posAttr.getY(i).toFixed(4)},${posAttr.getZ(i).toFixed(4)}`;
    const k1 = `${posAttr.getX(i+1).toFixed(4)},${posAttr.getY(i+1).toFixed(4)},${posAttr.getZ(i+1).toFixed(4)}`;
    const k2 = `${posAttr.getX(i+2).toFixed(4)},${posAttr.getY(i+2).toFixed(4)},${posAttr.getZ(i+2).toFixed(4)}`;

    const idx0 = vertMap.get(k0);
    const idx1 = vertMap.get(k1);
    const idx2 = vertMap.get(k2);

    if (idx0 !== undefined && idx1 !== undefined && idx2 !== undefined && idx0 !== idx1 && idx1 !== idx2 && idx0 !== idx2) {
      faces.push({ indices: [idx0, idx1, idx2] });
    }
  }

  return { vertices, faces };
}
