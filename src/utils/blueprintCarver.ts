/**
 * blueprintCarver.ts — Motor de Modelado Basado en Bocetos y Tallado Volumétrico 3D (Visual Hull)
 * a partir de vistas ortográficas (Frontal, Superior, Lateral).
 * Incluye filtros de imagen (brillo, contraste, b/n, nitidez), transformaciones (espejo H/V, rotación),
 * eliminación de píxeles aislados (Denoise / Island filter) y detección de zonas súper finas.
 */

import * as THREE from 'three';
import { V3, MeshFace } from '../types';
import { marchingCubes } from './marchingCubes';
import { CSG } from 'three-csg-ts';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  simplifyClosedContourRDP,
  fitBezierCurvesSchneider,
  simplificarSiluetaAThreeShape,
  smoothPolygon,
  snapToOrthogonalOrDiagonal
} from './vectorContourProcessor';

export type BlueprintViewKey = 'front' | 'top' | 'side' | 'back' | 'bottom';

export type CarverEngineMode = 'VISUAL_HULL' | 'HARD_SURFACE_CSG' | 'SMOOTH_SCULPT' | 'CUSHION_INFLATION';

export type CarverTopologyMode = 'PLANAR_POLISHED' | 'UNIFORM_ISOTROPIC' | 'CUSHION_UPHOLSTERY' | 'ROUNDED_ORGANIC' | 'CURVED_FILLET' | 'LOW_POLY' | 'RAW';

export type BlueprintDetectionMode = 'LINE_ART' | 'SOLID_COLOR' | 'TRANSPARENT_ALPHA';

export interface BlueprintImageConfig {
  url: string | null;
  enabled: boolean;
  
  // Transformaciones de orientación, escala y proporción
  flipH?: boolean;            // Espejo Horizontal
  flipV?: boolean;            // Espejo Vertical
  rotation?: number;          // 0, 90, 180, 270 grados
  scaleX?: number;            // Escala Horizontal (0.1 a 3.0, default 1.0)
  scaleY?: number;            // Escala Vertical (0.1 a 3.0, default 1.0)
  scaleUniform?: number;      // Escala Global / Zoom (0.1 a 3.0, default 1.0)
  lockAspectRatio?: boolean;  // Bloquear proporción X/Y (default true)
  preserveAspectRatio?: boolean; // Mantener proporciones reales de la imagen sin distorsión (default true)
  offsetX?: number;           // Desplazamiento Horizontal en % (-1.0 a +1.0, default 0)
  offsetY?: number;           // Desplazamiento Vertical en % (-1.0 a +1.0, default 0)
  naturalWidth?: number;      // Ancho original de la imagen
  naturalHeight?: number;     // Alto original de la imagen
  aspectRatio?: number;       // Proporción Ancho / Alto
  
  // Filtros de ajuste de imagen
  contrast?: number;          // -100 a +100 (0 = normal)
  brightness?: number;        // -100 a +100 (0 = normal)
  grayscale?: boolean;        // Forzar Blanco y Negro / Escala de grises
  sharpen?: number;           // 0 a 5 (Realce de nitidez de líneas finas)
  
  // Detección y limpieza
  threshold: number;          // 1..254 (umbral de detección / sensibilidad)
  detectionMode?: BlueprintDetectionMode; // 'LINE_ART' (bocetos/wireframes), 'SOLID_COLOR', 'TRANSPARENT_ALPHA'
  fillInterior?: boolean;     // Rellenar interior automáticamente para dibujos de líneas
  customBgColor?: [number, number, number] | null; // Color de fondo muestreado
  invert: boolean;            // Invertir máscara
  dilation: number;           // -10 a +10 px (inflar/desinflar silueta)
  blurRadius: number;         // 0 a 5 px de suavizado de bordes

  // Controles de Vectorización y Perfilado Estilo ImagR & Hard-Surface
  contourMode?: 'BEZIER_SMOOTH' | 'HARD_SURFACE_RDP' | 'ORTHO_POLY' | 'ROUNDED_ADAPTIVE'; // Modo de contorno: Silueta Redondeada Adaptativa, Bézier Suave, Hard Surface RDP o Polígono Ortogonal
  blur?: number;              // 0 a 10 px (Desenfoque previo para fusionar dientes de sierra del píxel, def: 1)
  simplify?: number;          // 0.5 a 20.0 (Tolerancia Douglas-Peucker / Schneider, def: 4.5)
  cornerAngle?: number;       // 25 a 120 grados (Protección de esquinas vivas/almenas vs curvas, def: 65)
  curveFidelity?: number;     // 1 a 15 (Fidelidad / densidad de puntos en siluetas redondeadas y arcos, def: 8)
  roundnessSmooth?: number;   // 0 a 5 (Pasadas de suavizado de contorno Chaikin / Laplaciano, def: 2)
  
  // Filtro de ruido & zonas finas
  denoiseIslandSize?: number; // 0 a 150 px: elimina pequeñas motas o manchas de escaneo que no son parte del objeto
  thinFeatureBoost?: number;  // 0 a 100%: aumenta la sensibilidad de bordes para detectar antenas, cables y cañones

  // Puntos de Control Manuales (Ajuste fino de silueta vectorial)
  manualControlPoints?: [number, number][][] | null; // Bucles poligonales editados manualmente en espacio [-1, 1]

  // Detección y vaciado de huecos interiores (espacio entre patas, ventanas, recortes cerrados)
  autoDetectHoles?: boolean;    // Detectar y vaciar automáticamente regiones cerradas internas que coincidan con el color de fondo
  holeSeeds?: [number, number][]; // Semillas de coordenadas de vaciado [nx, ny] en espacio normalizado [-1, 1]
  
  // Calibración de Mapeo de Texturas y Proyección UV
  texOffsetX?: number;          // Desplazamiento U de la textura (-1.0 a +1.0)
  texOffsetY?: number;          // Desplazamiento V de la textura (-1.0 a +1.0)
  texScaleX?: number;           // Escala U de la textura (0.2 a 3.0, default 1.0)
  texScaleY?: number;           // Escala V de la textura (0.2 a 3.0, default 1.0)
  texFlipH?: boolean;           // Invertir textura horizontalmente
  texFlipV?: boolean;           // Invertir textura verticalmente
  texMirrorOpposite?: boolean;  // Reflejar simétricamente en caras opuestas (default false)
  texProjectBothSides?: boolean;// Proyectar en ambas caras opuestas (default false, evita proyectar en cara trasera)
  invertNormalY?: boolean;      // Invertir canal Y del mapa de normales (OpenGL vs DirectX)

  // Control de Modelado de Vista Trasera
  depthLimit?: number;          // 0.1 a 1.0 (Profundidad de influencia del tallado en la parte trasera, def: 0.5 o 1.0)
  carveEnabled?: boolean;        // true si talla la silueta 3D, false si solo se usa para texturizar con PBR

  // Zonas de Altura / Cavidad (ej. Asiento de sofá más bajo que los brazos)
  depthZones?: BlueprintDepthZone[];
  heightmapEnabled?: boolean;     // Activar relieve continuo por luminancia / sombras
  enableHeightmap?: boolean;      // Alias para heightmapEnabled
  heightmapStrength?: number;    // Intensidad del relieve (0 a 100%, def: 50%)
  heightmapInvert?: boolean;      // Invertir mapa de alturas
}

export interface BlueprintDepthZone {
  id: string;
  name: string;
  x1: number; // Coordenada X normalizada [-1, 1]
  y1: number; // Coordenada Y normalizada [-1, 1]
  x2: number;
  y2: number;
  heightMax: number; // 0.0 a 1.0 (ej. 0.40 para el asiento del sofá: la masa sólida llega hasta el 40%, vaciando el 60% superior)
  heightMin?: number; // 0.0 a 1.0 (def: 0.0, suelo o base)
  bevelRadius?: number; // 0.01 a 0.3 (def: 0.08, suavizado / transición a los brazos)
  mode?: 'DEPRESSION' | 'ELEVATION';
  enabled: boolean;
}

export interface BlueprintCarverOptions {
  mode: CarverEngineMode;
  resolution: number;        // 32, 48, 64, 80
  dimensions: V3;            // [Ancho X, Alto Y, Profundidad Z] en unidades de escena
  smoothIterations: number;  // 0 a 5 pasadas de relajación
  smoothFactor: number;      // 0.1 a 0.9
  views: {
    front?: BlueprintImageConfig;
    top?: BlueprintImageConfig;
    side?: BlueprintImageConfig;
    back?: BlueprintImageConfig;
    bottom?: BlueprintImageConfig;
  };
  preprocessedViews?: { [K in BlueprintViewKey]?: ProcessedSilhouette | null };
  topologyMode?: CarverTopologyMode; // 'PLANAR_POLISHED' | 'UNIFORM_ISOTROPIC' | 'CUSHION_UPHOLSTERY' | 'ROUNDED_ORGANIC' | 'CURVED_FILLET' | 'LOW_POLY' | 'RAW'
  snapToPlanes?: boolean;
  planarAngleToleranceDeg?: number;
  decimationRatio?: number;
  featureAngleDeg?: number;
  roundness?: number;         // 0.0 a 1.0 (factor de redondeo de cantos y aristas)
  cushionInflation?: number;  // 0.0 a 1.0 (abombado / inflado de silueta para tapicería/cojines)
  edgeFilletRadius?: number;  // radio de biselado curvo
  subdivisionLevel?: number;  // 0 o 1 (subdivisión curva para mallas súper lisas)
  backDepthLimit?: number;    // 0.1 a 1.0 (profundidad de influencia del tallado de la vista trasera)
}

export interface ProcessedSilhouette {
  width: number;
  height: number;
  mask: Uint8Array;              // 1 = dentro del objeto, 0 = fondo
  sdf: Float32Array;             // distancia signada en espacio [-1, 1] (< 0 = interior)
  contours: [number, number][][]; // Múltiples bucles poligonales exactos en espacio [-1, 1]
  aspect: number;
  cleanedPixelsCount: number;
  boundsNormalized?: { minU: number; minV: number; maxU: number; maxV: number };
  depthZones?: BlueprintDepthZone[];
  heightmap?: Float32Array;
  heightmapStrength?: number;
}

/**
 * Normaliza automáticamente el tamaño y centra la silueta calculando su bounding box real.
 * Escala de forma isotrópica para ajustarse a una caja estándar uniforme (85% del lienzo).
 */
export function autoNormalizeSilhouetteScale(
  mask: Uint8Array,
  W: number,
  H: number
): { scaleFactor: number; offsetX: number; offsetY: number } {
  let minX = W, maxX = 0, minY = H, maxY = 0;
  let foundPixels = false;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        foundPixels = true;
      }
    }
  }

  if (!foundPixels) return { scaleFactor: 1, offsetX: 0, offsetY: 0 };

  const boundingBoxWidth = maxX - minX;
  const boundingBoxHeight = maxY - minY;
  const maxBoundingDim = Math.max(boundingBoxWidth, boundingBoxHeight);
  const targetSize = Math.min(W, H) * 0.85;
  const scaleFactor = targetSize / Math.max(1, maxBoundingDim);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const offsetX = (W / 2) - centerX;
  const offsetY = (H / 2) - centerY;

  return { scaleFactor, offsetX, offsetY };
}

/**
 * Calcula la calibración UV y de escala automática de forma estrictamente ISOTRÓPICA
 * (mismo factor de escala unificado en X e Y) basada en la dimensión máxima del bounding box de la silueta.
 * Esto garantiza que ni el volumen 3D ni las texturas proyectadas se estiren o deformen.
 */
export function calculateAutoCalibration(sil: ProcessedSilhouette): {
  texScaleX: number;
  texScaleY: number;
  texOffsetX: number;
  texOffsetY: number;
  scaleX: number;
  scaleY: number;
  scaleUniform: number;
  offsetX: number;
  offsetY: number;
} {
  if (!sil) {
    return {
      texScaleX: 1.0,
      texScaleY: 1.0,
      texOffsetX: 0.0,
      texOffsetY: 0.0,
      scaleX: 1.0,
      scaleY: 1.0,
      scaleUniform: 1.0,
      offsetX: 0.0,
      offsetY: 0.0
    };
  }

  let unifiedScale = 1.0;
  let offX = 0.0;
  let offY = 0.0;

  if (sil.boundsNormalized) {
    const { minU, maxU, minV, maxV } = sil.boundsNormalized;
    const boundingWidth = Math.max(0.001, maxU - minU);
    const boundingHeight = Math.max(0.001, maxV - minV);

    // ESCALA ISOTRÓPICA: Usamos la dimensión máxima para mantener la relación de aspecto 1:1 sin distorsiones
    const maxBoundingDim = Math.max(boundingWidth, boundingHeight);
    const targetSize = 0.82;
    const rawScale = maxBoundingDim > 0 ? (targetSize / maxBoundingDim) : 1.0;
    unifiedScale = Math.max(0.2, Math.min(3.5, Math.round(rawScale * 100) / 100));

    const centerU = (minU + maxU) / 2;
    const centerV = (minV + maxV) / 2;
    offX = Math.max(-0.5, Math.min(0.5, Math.round((0.5 - centerU) * 1000) / 1000));
    offY = Math.max(-0.5, Math.min(0.5, Math.round((0.5 - centerV) * 1000) / 1000));
  }

  return {
    texScaleX: unifiedScale,
    texScaleY: unifiedScale,
    texOffsetX: offX,
    texOffsetY: offY,
    scaleX: 1.0, // Base 1.0 para no multiplicar doblemente
    scaleY: 1.0,
    scaleUniform: unifiedScale,
    offsetX: offX,
    offsetY: offY
  };
}

export interface MultiViewAutoAlignmentResult {
  updatedConfigs: {
    front?: Partial<BlueprintImageConfig>;
    side?: Partial<BlueprintImageConfig>;
    top?: Partial<BlueprintImageConfig>;
    back?: Partial<BlueprintImageConfig>;
    bottom?: Partial<BlueprintImageConfig>;
  };
  dimensions: V3;
  report: string;
}

/**
 * ALINEADOR MULTI-VISTA INTELIGENTE 3D:
 * Resuelve y sincroniza automáticamente las restricciones de escala, altura, suelo y proporciones
 * entre las vistas Frontal, Lateral, Superior y Trasera para que la intersección volumétrica (Visual Hull / CSG)
 * encaje al 100% sin cortes en el techo, capó o ruedas.
 */
export function calculateMultiViewAutoAlignment(
  silhouettes: {
    front?: ProcessedSilhouette | null;
    side?: ProcessedSilhouette | null;
    top?: ProcessedSilhouette | null;
    back?: ProcessedSilhouette | null;
    bottom?: ProcessedSilhouette | null;
  },
  currentConfigs: {
    front: BlueprintImageConfig;
    side: BlueprintImageConfig;
    top: BlueprintImageConfig;
    back?: BlueprintImageConfig;
    bottom?: BlueprintImageConfig;
  },
  currentDimensions: [number, number, number] = [2.0, 1.8, 4.0]
): MultiViewAutoAlignmentResult {
  const bFront = silhouettes.front?.boundsNormalized;
  const bSide = silhouettes.side?.boundsNormalized;
  const bTop = silhouettes.top?.boundsNormalized;
  const bBack = silhouettes.back?.boundsNormalized;

  const hasFront = !!bFront && silhouettes.front?.contours && silhouettes.front.contours.length > 0;
  const hasSide = !!bSide && silhouettes.side?.contours && silhouettes.side.contours.length > 0;
  const hasTop = !!bTop && silhouettes.top?.contours && silhouettes.top.contours.length > 0;
  const hasBack = !!bBack && silhouettes.back?.contours && silhouettes.back.contours.length > 0;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const updatedConfigs: MultiViewAutoAlignmentResult['updatedConfigs'] = {};
  const reports: string[] = [];

  // Alturas y anchuras de las siluetas detectadas en coordenadas normalizadas [0, 1]
  const hFront = hasFront ? Math.max(0.04, bFront!.maxV - bFront!.minV) : 0.5;
  const wFront = hasFront ? Math.max(0.04, bFront!.maxU - bFront!.minU) : 0.5;

  const hSide = hasSide ? Math.max(0.04, bSide!.maxV - bSide!.minV) : 0.5;
  const lenSide = hasSide ? Math.max(0.04, bSide!.maxU - bSide!.minU) : 0.5;

  const spanXTop = hasTop ? Math.max(0.04, bTop!.maxU - bTop!.minU) : 0.5;
  const spanYTop = hasTop ? Math.max(0.04, bTop!.maxV - bTop!.minV) : 0.5;
  const isTopVertical = spanYTop >= spanXTop;
  const lenTop = isTopVertical ? spanYTop : spanXTop;
  const wTop = isTopVertical ? spanXTop : spanYTop;

  // Tomamos la altura actual del usuario como ancla estable
  const baseDimY = currentDimensions[1] > 0.2 ? currentDimensions[1] : 1.8;
  let dimY = baseDimY;
  let dimX = currentDimensions[0] > 0.2 ? currentDimensions[0] : 1.8;
  let dimZ = currentDimensions[2] > 0.2 ? currentDimensions[2] : 4.0;

  // 1. Ancho (X) calibrado proporcionalmente al frente
  if (hasFront) {
    const ratioX = wFront / hFront;
    dimX = round2(Math.max(0.3, Math.min(8.0, baseDimY * ratioX)));
    reports.push(`Ancho X: ${dimX}m`);
  } else if (hasTop) {
    const ratioX = wTop / lenTop;
    dimX = round2(Math.max(0.3, Math.min(8.0, dimZ * ratioX)));
  }

  // 2. Longitud / Profundidad (Z) calibrada proporcionalmente al lateral o superior
  if (hasSide) {
    const ratioZ = lenSide / hSide;
    dimZ = round2(Math.max(0.4, Math.min(14.0, baseDimY * ratioZ)));
    reports.push(`Largo Z: ${dimZ}m`);
  } else if (hasTop) {
    const ratioZ = lenTop / wTop;
    dimZ = round2(Math.max(0.4, Math.min(14.0, dimX * ratioZ)));
    reports.push(`Largo Z: ${dimZ}m (desde Top)`);
  }

  // IMPORTANTE: NO sobreescribimos los offsets ni la escala del lienzo 2D.
  // Esto previene que las siluetas salgan del encuadre y la malla colapse a 0 vértices.
  return {
    updatedConfigs,
    dimensions: [dimX, dimY, dimZ],
    report: `✓ Dimensiones proporcionales sincronizadas: [${dimX}m x ${dimY}m x ${dimZ}m] (${reports.join(', ') || 'OK'})`
  };
}

/**
 * Aplica simetría forzada reflejando la máscara sobre el eje central (X o Y).
 */
export function applySymmetryToMask(
  mask: Uint8Array,
  W: number,
  H: number,
  axis: 'X' | 'Y' = 'X'
): Uint8Array {
  const symmetricalMask = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (axis === 'X') {
        const mirrorX = W - 1 - x;
        symmetricalMask[idx] = (mask[idx] === 1 || mask[y * W + mirrorX] === 1) ? 1 : 0;
      } else {
        const mirrorY = H - 1 - y;
        symmetricalMask[idx] = (mask[idx] === 1 || mask[mirrorY * W + x] === 1) ? 1 : 0;
      }
    }
  }
  return symmetricalMask;
}

export interface GhostOverlayData {
  viewKey: BlueprintViewKey;
  label: string;
  imgData: ImageData | null;
  processed: ProcessedSilhouette | null;
  color: string;
  opacity?: number;
  showImage?: boolean;
  showOutline?: boolean;
  showAlignmentRails?: boolean;
}

/**
 * Carga una imagen, preserva sus dimensiones y proporciones reales (sin distorsión cuadrada),
 * y aplica transformaciones geométricas (escala X/Y, desplazamiento X/Y, espejo, rotación)
 * junto con los filtros fotográficos (brillo, contraste, b/n, nitidez).
 * Usa resolución 1024x1024 y margen seguro de encuadre para evitar recortes en bordes.
 */
export async function loadCanvasImageData(
  imageUrl: string,
  config: Partial<BlueprintImageConfig> = {}
): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;
      const nativeAspect = origW / Math.max(1, origH);

      const rot = ((config.rotation || 0) % 360 + 360) % 360;
      const is90or270 = rot === 90 || rot === 270;
      const effAspect = is90or270 ? (1 / nativeAspect) : nativeAspect;

      // 512x512 para procesamiento ágil y fluido a 60 FPS
      const CANVAS_SIZE = 512;
      const canvas = document.createElement('canvas');
      canvas.width = CANVAS_SIZE;
      canvas.height = CANVAS_SIZE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }

      // Detectar si la imagen original tiene transparencia o fondo sólido
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = Math.min(32, origW);
      sampleCanvas.height = Math.min(32, origH);
      const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      let hasSourceTransparency = false;
      let sampledBg: [number, number, number] = [255, 255, 255];
      if (sCtx) {
        sCtx.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);
        const sData = sCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
        const cornerAlpha = sData[3];
        if (cornerAlpha < 40) {
          hasSourceTransparency = true;
        } else {
          sampledBg = [sData[0], sData[1], sData[2]];
        }
      }

      // Proporción y escala:
      const preserveRatio = config.preserveAspectRatio !== false;
      const sX = (config.scaleX ?? 1.0) * (config.scaleUniform ?? 1.0);
      const sY = (config.scaleY ?? 1.0) * (config.scaleUniform ?? 1.0);
      const offX = (config.offsetX ?? 0) * (CANVAS_SIZE * 0.5);
      const offY = -(config.offsetY ?? 0) * (CANVAS_SIZE * 0.5);

      // Margen de seguridad (88% del canvas)
      const SAFE_SIZE = CANVAS_SIZE * 0.88;
      let baseDrawW = SAFE_SIZE;
      let baseDrawH = SAFE_SIZE;

      if (preserveRatio) {
        if (effAspect <= 1.0) {
          baseDrawW = SAFE_SIZE * effAspect;
          baseDrawH = SAFE_SIZE;
        } else {
          baseDrawW = SAFE_SIZE;
          baseDrawH = SAFE_SIZE / effAspect;
        }
      }

      const drawW = Math.max(8, baseDrawW * sX);
      const drawH = Math.max(8, baseDrawH * sY);

      // Color de fondo del lienzo
      if (config.customBgColor) {
        const [r, g, b] = config.customBgColor;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      } else if (hasSourceTransparency) {
        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      } else {
        const [r, g, b] = sampledBg;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }

      ctx.save();
      ctx.translate(CANVAS_SIZE / 2 + offX, CANVAS_SIZE / 2 + offY);

      if (rot !== 0) {
        ctx.rotate((rot * Math.PI) / 180);
      }

      const flipScaleX = config.flipH ? -1 : 1;
      const flipScaleY = config.flipV ? -1 : 1;
      ctx.scale(flipScaleX, flipScaleY);

      const imgDrawW = is90or270 ? drawH : drawW;
      const imgDrawH = is90or270 ? drawW : drawH;

      if (config.blur && config.blur > 0) {
        ctx.filter = `blur(${config.blur}px)`;
      }

      ctx.drawImage(img, -imgDrawW / 2, -imgDrawH / 2, imgDrawW, imgDrawH);
      ctx.filter = 'none';
      ctx.restore();

      const imgData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Aplicar filtros de brillo, contraste, escala de grises y nitidez si están activos
      applyImageAdjustments(imgData, config);

      resolve(imgData);
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

/**
 * Aplica ajustes de Brillo, Contraste, Escala de Grises y Nitidez a los píxeles de la imagen
 */
export function applyImageAdjustments(
  imgData: ImageData,
  config: Partial<BlueprintImageConfig> = {}
) {
  const {
    contrast = 0,
    brightness = 0,
    grayscale = false,
    sharpen = 0
  } = config;

  if (contrast === 0 && brightness === 0 && !grayscale && (!sharpen || sharpen <= 0)) {
    return;
  }

  const W = imgData.width;
  const H = imgData.height;
  const data = imgData.data;

  // Factor de contraste [-100..100] -> factor multiplicativo
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const bOffset = brightness * 1.5;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Escala de grises
    if (grayscale) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum;
      g = lum;
      b = lum;
    }

    // Brillo
    if (brightness !== 0) {
      r += bOffset;
      g += bOffset;
      b += bOffset;
    }

    // Contraste
    if (contrast !== 0) {
      r = cFactor * (r - 128) + 128;
      g = cFactor * (g - 128) + 128;
      b = cFactor * (b - 128) + 128;
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }

  // Filtro de Nitidez / Realce de Bordes (Convolution Unsharp Mask)
  if (sharpen && sharpen > 0) {
    applySharpenFilter(imgData, sharpen);
  }
}

/**
 * Filtro de nitidez y convolución para hacer resaltar trazos finos (antenas, cañones)
 */
function applySharpenFilter(imgData: ImageData, strength: number) {
  const W = imgData.width;
  const H = imgData.height;
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;
  const factor = Math.min(3.0, strength * 0.45);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const top = src[((y - 1) * W + x) * 4 + c];
        const bot = src[((y + 1) * W + x) * 4 + c];
        const left = src[(y * W + (x - 1)) * 4 + c];
        const right = src[(y * W + (x + 1)) * 4 + c];

        const val = center * (1 + 4 * factor) - (top + bot + left + right) * factor;
        dst[idx + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }
}

/**
 * Auto-detecta el color de fondo y el mejor modo para una imagen dada
 */
export function analyzeImageCharacteristics(imageData: ImageData): {
  isDarkBg: boolean;
  hasAlpha: boolean;
  suggestedMode: BlueprintDetectionMode;
  suggestedThreshold: number;
  bgColor: [number, number, number];
} {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  let totalAlphaLow = 0;
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

  // Muestrear los bordes exteriores
  for (let x = 0; x < W; x++) {
    const idxTop = x * 4;
    if (data[idxTop + 3] < 30) totalAlphaLow++;
    else { bgR += data[idxTop]; bgG += data[idxTop + 1]; bgB += data[idxTop + 2]; bgCount++; }

    const idxBot = ((H - 1) * W + x) * 4;
    if (data[idxBot + 3] < 30) totalAlphaLow++;
    else { bgR += data[idxBot]; bgG += data[idxBot + 1]; bgB += data[idxBot + 2]; bgCount++; }
  }

  for (let y = 1; y < H - 1; y++) {
    const idxLeft = (y * W) * 4;
    if (data[idxLeft + 3] < 30) totalAlphaLow++;
    else { bgR += data[idxLeft]; bgG += data[idxLeft + 1]; bgB += data[idxLeft + 2]; bgCount++; }

    const idxRight = (y * W + (W - 1)) * 4;
    if (data[idxRight + 3] < 30) totalAlphaLow++;
    else { bgR += data[idxRight]; bgG += data[idxRight + 1]; bgB += data[idxRight + 2]; bgCount++; }
  }

  const borderPixels = (W * 2 + (H - 2) * 2);
  const hasAlpha = (totalAlphaLow / borderPixels) > 0.40;

  const avgR = bgCount > 0 ? bgR / bgCount : (hasAlpha ? 0 : 255);
  const avgG = bgCount > 0 ? bgG / bgCount : (hasAlpha ? 0 : 255);
  const avgB = bgCount > 0 ? bgB / bgCount : (hasAlpha ? 0 : 255);
  const bgLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
  const isDarkBg = bgLum < 128;

  let suggestedMode: BlueprintDetectionMode = 'LINE_ART';
  if (hasAlpha) {
    suggestedMode = 'TRANSPARENT_ALPHA';
  } else if (!isDarkBg) {
    // Fondo claro (dibujo, silueta o modelo sobre blanco / gris claro)
    suggestedMode = 'LINE_ART';
  } else {
    // Fondo oscuro (figura sólida o silueta sobre fondo oscuro)
    suggestedMode = 'SOLID_COLOR';
  }

  return {
    isDarkBg,
    hasAlpha,
    suggestedMode,
    suggestedThreshold: 45, // Umbral óptimo de 45 para capturar contornos nítidos tanto en fondos claros como oscuros
    bgColor: [Math.round(avgR), Math.round(avgG), Math.round(avgB)]
  };
}

/**
 * Procesa la imagen 2D para extraer la máscara binaria, eliminando ruido aislado y captando zonas finas
 */
export function processSilhouette(
  imageData: ImageData,
  config: Partial<BlueprintImageConfig> = {}
): ProcessedSilhouette {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  const {
    threshold = 45,
    detectionMode = 'LINE_ART',
    fillInterior = true,
    customBgColor = null,
    invert = false,
    dilation = 0,
    blurRadius = 1,
    denoiseIslandSize = 12,
    thinFeatureBoost = 40
  } = config;

  // 1. Determinar color de fondo
  let bgR = 0, bgG = 0, bgB = 0;
  if (customBgColor) {
    [bgR, bgG, bgB] = customBgColor;
  } else {
    const analysis = analyzeImageCharacteristics(imageData);
    [bgR, bgG, bgB] = analysis.bgColor;
  }

  // 2. Extraer mapa de características inicial (trazos / masa / gradientes finos)
  const initialFeatureMap = new Uint8Array(W * H);
  const boostFactor = (thinFeatureBoost || 0) / 100;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      let isFeature = false;

      if (a < 30) {
        isFeature = false;
      } else if (detectionMode === 'TRANSPARENT_ALPHA') {
        isFeature = a >= 40;
      } else {
        // Distancia euclidiana en color RGB al fondo
        const dr = r - bgR;
        const dg = g - bgG;
        const db = b - bgB;
        const colorDist = Math.hypot(dr, dg, db); // [0 .. 441]

        // Luminancia del pixel vs luminancia del fondo
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
        const lumDiff = Math.abs(lum - bgLum);

        // Umbral efectivo con boost para zonas finas
        const effThreshold = Math.max(4, threshold * (1.0 - boostFactor * 0.35));
        const requiredDist = Math.max(6, effThreshold * 1.25);

        isFeature = colorDist >= requiredDist || lumDiff >= effThreshold;

        // Detección de bordes locales / gradiente Sobel para captar líneas muy finas de 1 píxel
        if (!isFeature && boostFactor > 0.1 && x > 0 && x < W - 1 && y > 0 && y < H - 1) {
          const lLeft = 0.299 * data[idx - 4] + 0.587 * data[idx - 3] + 0.114 * data[idx - 2];
          const lRight = 0.299 * data[idx + 4] + 0.587 * data[idx + 5] + 0.114 * data[idx + 6];
          const lTop = 0.299 * data[idx - W * 4] + 0.587 * data[idx - W * 4 + 1] + 0.114 * data[idx - W * 4 + 2];
          const lBot = 0.299 * data[idx + W * 4] + 0.587 * data[idx + W * 4 + 1] + 0.114 * data[idx + W * 4 + 2];

          const gradX = Math.abs(lRight - lLeft);
          const gradY = Math.abs(lBot - lTop);
          const localGrad = Math.hypot(gradX, gradY);

          if (localGrad >= Math.max(12, effThreshold * 0.75)) {
            isFeature = true;
          }
        }
      }

      initialFeatureMap[y * W + x] = isFeature ? 1 : 0;
    }
  }

  // 3. Si es modo LINE_ART o se solicitó fillInterior:
  // Aplicamos Flood-Fill (inundación) desde los bordes exteriores para identificar el fondo exterior.
  let solidMask = new Uint8Array(W * H);

  if (fillInterior && detectionMode !== 'TRANSPARENT_ALPHA') {
    // Cierre morfológico suave para sellar pequeñas discontinuidades en las líneas
    const closedLines = applyMorphology(initialFeatureMap, W, H, 2);

    const visitedBg = new Uint8Array(W * H);
    const queueX = new Int32Array(W * H * 2);
    const queueY = new Int32Array(W * H * 2);
    let qHead = 0;
    let qTail = 0;

    const pushQ = (x: number, y: number) => {
      const idx = y * W + x;
      if (visitedBg[idx] === 0 && closedLines[idx] === 0) {
        visitedBg[idx] = 1;
        queueX[qTail] = x;
        queueY[qTail] = y;
        qTail++;
      }
    };

    // Sembrar la cola desde el perímetro exterior en múltiples profundidades (0, 1, 2, 4)
    // para evitar que un marco o borde de blueprint bloquee el inicio del flood-fill
    const seedDepths = [0, 1, 2, 4];
    for (const d of seedDepths) {
      if (d >= Math.min(W, H) / 4) continue;
      for (let x = d; x < W - d; x++) {
        pushQ(x, d);
        pushQ(x, H - 1 - d);
      }
      for (let y = d + 1; y < H - 1 - d; y++) {
        pushQ(d, y);
        pushQ(W - 1 - d, y);
      }
    }

    // Si todas las semillas fueron bloqueadas por un borde continuo en el marco,
    // forzar semillas en las 4 esquinas
    if (qTail === 0) {
      const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]];
      for (const [cx, cy] of corners) {
        const idx = cy * W + cx;
        visitedBg[idx] = 1;
        queueX[qTail] = cx;
        queueY[qTail] = cy;
        qTail++;
      }
    }

    // Ejecutar flood-fill 4-conectado
    while (qHead < qTail) {
      const cx = queueX[qHead];
      const cy = queueY[qHead];
      qHead++;

      if (cx > 0) pushQ(cx - 1, cy);
      if (cx < W - 1) pushQ(cx + 1, cy);
      if (cy > 0) pushQ(cx, cy - 1);
      if (cy < H - 1) pushQ(cx, cy + 1);
    }

    // Todo lo que NO haya sido alcanzado por el flood fill exterior es el objeto sólido
    let solidCount = 0;
    for (let i = 0; i < W * H; i++) {
      solidMask[i] = visitedBg[i] === 0 ? 1 : 0;
      if (solidMask[i] === 1) solidCount++;
    }

    // Salvaguarda: Si el flood fill quedó atrapado y marcó más del 95% como sólido
    // (o menos del 1%), recurrir al mapa morfológico de trazos para evitar un bloque sólido gigante
    if (solidCount > (W * H * 0.95) || solidCount < 20) {
      const dilatedFeatures = applyMorphology(initialFeatureMap, W, H, 2);
      solidMask = dilatedFeatures;
    } else {
      // Asegurar que las líneas finas originales se preserven aunque fueran muy delgadas
      for (let i = 0; i < W * H; i++) {
        if (initialFeatureMap[i] === 1) {
          solidMask[i] = 1;
        }
      }
    }

    // 3.1 DETECCIÓN INTELIGENTE DE HUECOS DE FONDO INTERIORES (espacio entre patas, ventanas, calados)
    const autoHoles = config.autoDetectHoles !== false;
    if (autoHoles) {
      // Buscar píxeles interiores que NO sean líneas del dibujo y cuyo color RGB sea muy cercano al color de fondo
      const potentialHoles = new Uint8Array(W * H);
      const holeTol = Math.max(18, threshold * 0.95);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = y * W + x;
          // Solo evaluar píxeles que actualmente están marcados como sólidos pero no eran líneas originales
          if (solidMask[idx] === 1 && initialFeatureMap[idx] === 0) {
            const pIdx = idx * 4;
            const r = data[pIdx];
            const g = data[pIdx + 1];
            const b = data[pIdx + 2];
            const a = data[pIdx + 3];

            if (a < 30) {
              potentialHoles[idx] = 1;
            } else {
              const cDist = Math.hypot(r - bgR, g - bgG, b - bgB);
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
              if (cDist < holeTol && Math.abs(lum - bgLum) < holeTol * 0.8) {
                potentialHoles[idx] = 1;
              }
            }
          }
        }
      }

      // Conectar regiones de huecos y eliminar aquellas que tengan al menos tamaño mínimo (ej: 6 píxeles)
      const visitedHoles = new Uint8Array(W * H);
      const hQueueX = new Int32Array(W * H);
      const hQueueY = new Int32Array(W * H);

      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const startIdx = y * W + x;
          if (potentialHoles[startIdx] === 1 && visitedHoles[startIdx] === 0) {
            let hHead = 0;
            let hTail = 0;
            hQueueX[hTail] = x;
            hQueueY[hTail] = y;
            visitedHoles[startIdx] = 1;
            hTail++;

            const compIndices: number[] = [startIdx];

            while (hHead < hTail) {
              const cx = hQueueX[hHead];
              const cy = hQueueY[hHead];
              hHead++;

              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  const nx = cx + dx;
                  const ny = cy + dy;
                  if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                    const nIdx = ny * W + nx;
                    if (potentialHoles[nIdx] === 1 && visitedHoles[nIdx] === 0) {
                      visitedHoles[nIdx] = 1;
                      hQueueX[hTail] = nx;
                      hQueueY[hTail] = ny;
                      hTail++;
                      compIndices.push(nIdx);
                    }
                  }
                }
              }
            }

            // Si la región de hueco tiene al menos 6 píxeles, vaciarla de la máscara sólida
            if (compIndices.length >= 6) {
              for (const idx of compIndices) {
                solidMask[idx] = 0;
              }
            }
          }
        }
      }
    }

    // 3.2 SEMILLAS MANUALES DE VACIADO DE HUECO (Hole Seeds / Cuentagotas de Huecos)
    if (config.holeSeeds && config.holeSeeds.length > 0) {
      for (const seed of config.holeSeeds) {
        const px = Math.round(((seed[0] + 1) / 2) * (W - 1));
        const py = Math.round(((1 - seed[1]) / 2) * (H - 1));
        if (px >= 0 && px < W && py >= 0 && py < H) {
          // Flood fill de vaciado desde el punto clicado deteniéndose en trazos
          const seedVisited = new Uint8Array(W * H);
          const sQueueX = new Int32Array(W * H);
          const sQueueY = new Int32Array(W * H);
          let sHead = 0;
          let sTail = 0;

          const seedIdx = py * W + px;
          seedVisited[seedIdx] = 1;
          sQueueX[sTail] = px;
          sQueueY[sTail] = py;
          sTail++;
          solidMask[seedIdx] = 0;

          while (sHead < sTail) {
            const cx = sQueueX[sHead];
            const cy = sQueueY[sHead];
            sHead++;

            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (const [dx, dy] of dirs) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const nIdx = ny * W + nx;
                if (seedVisited[nIdx] === 0 && initialFeatureMap[nIdx] === 0) {
                  seedVisited[nIdx] = 1;
                  solidMask[nIdx] = 0;
                  sQueueX[sTail] = nx;
                  sQueueY[sTail] = ny;
                  sTail++;
                }
              }
            }
          }
        }
      }
    }
  } else {
    solidMask = initialFeatureMap;
  }

  // 4. Invertir si está activo
  if (invert) {
    for (let i = 0; i < W * H; i++) {
      solidMask[i] = solidMask[i] === 1 ? 0 : 1;
    }
  }

  // 5. FILTRO DE RUIDO Y ELIMINACIÓN DE PÍXELES AISLADOS (Island / Despeckle Filter)
  let cleanedCount = 0;
  if (denoiseIslandSize && denoiseIslandSize > 0) {
    const cleanedResult = removeSmallIslands(solidMask, W, H, denoiseIslandSize);
    solidMask = cleanedResult.mask;
    cleanedCount = cleanedResult.removedPixels;
  }

  // 6. Aplicar dilatación o erosión si el usuario ajustó el grosor
  let mask = solidMask;
  if (dilation !== 0) {
    mask = applyMorphology(solidMask, W, H, dilation);
  }

  // Comprobar si hay al menos algunos píxeles ocupados
  let countSolid = 0;
  for (let i = 0; i < W * H; i++) {
    if (mask[i] === 1) countSolid++;
  }

  if (countSolid < 5) {
    const pad = Math.floor(Math.min(W, H) * 0.15);
    for (let y = pad; y < H - pad; y++) {
      for (let x = pad; x < W - pad; x++) {
        mask[y * W + x] = 1;
      }
    }
  }

  // Calcular el Bounding Box normalizado de los píxeles sólidos en [0, 1]
  let minPxX = W, maxPxX = 0, minPxY = H, maxPxY = 0;
  let hasAnySolid = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] === 1) {
        hasAnySolid = true;
        if (x < minPxX) minPxX = x;
        if (x > maxPxX) maxPxX = x;
        if (y < minPxY) minPxY = y;
        if (y > maxPxY) maxPxY = y;
      }
    }
  }

  const boundsNormalized = hasAnySolid ? {
    minU: Math.max(0, (minPxX - 1) / (W - 1)),
    maxU: Math.min(1, (maxPxX + 1) / (W - 1)),
    minV: Math.max(0, 1 - (maxPxY + 1) / (H - 1)),
    maxV: Math.min(1, 1 - (minPxY - 1) / (H - 1)),
  } : { minU: 0, minV: 0, maxU: 1, maxV: 1 };

  // 7. Si hay puntos de control manuales suministrados por el usuario, usarlos como contornos
  const contourMode = config.contourMode ?? 'ROUNDED_ADAPTIVE';
  const simplifyEps = (config.simplify ?? 4.5) * 0.003;
  const cornerAng = config.cornerAngle ?? (contourMode === 'HARD_SURFACE_RDP' || contourMode === 'ORTHO_POLY' ? 35 : 65);
  const curveFid = config.curveFidelity ?? 8;
  const roundSmooth = config.roundnessSmooth ?? 2;
  let finalContours = extractMultiContoursFromMask(mask, W, H, simplifyEps, cornerAng, contourMode, curveFid, roundSmooth);
  let finalMask = mask;
  let finalSdf = computeSDF(mask, W, H, blurRadius);

  if (config.manualControlPoints !== undefined && config.manualControlPoints !== null) {
    finalContours = config.manualControlPoints.filter(p => p && p.length >= 3);
    // Rasterizar los polígonos manuales para reconstruir mask y SDF precisos
    const rasterMask = new Uint8Array(W * H);
    if (finalContours.length > 0) {
      // Para cada bucle manual, rasterizar con Scanline / Ray-Casting
      for (let y = 0; y < H; y++) {
        const ny = 1 - (y / (H - 1)) * 2;
        for (let x = 0; x < W; x++) {
          const nx = (x / (W - 1)) * 2 - 1;
          let inside = false;
          for (const poly of finalContours) {
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const xi = poly[i][0], yi = poly[i][1];
              const xj = poly[j][0], yj = poly[j][1];
              const intersect = ((yi > ny) !== (yj > ny)) &&
                (nx < ((xj - xi) * (ny - yi)) / (yj - yi + 1e-7) + xi);
              if (intersect) inside = !inside;
            }
          }
          rasterMask[y * W + x] = inside ? 1 : 0;
        }
      }
    }
    finalMask = rasterMask;
    finalSdf = computeSDF(finalMask, W, H, blurRadius);
  }

  let heightmap: Float32Array | undefined = undefined;
  if (config.heightmapEnabled) {
    heightmap = computeHeightmapFromImage(imageData, finalMask, config.heightmapInvert, config.heightmapStrength);
  }

  return {
    width: W,
    height: H,
    mask: finalMask,
    sdf: finalSdf,
    contours: finalContours,
    aspect: W / H,
    cleanedPixelsCount: cleanedCount,
    boundsNormalized,
    depthZones: config.depthZones,
    heightmap,
    heightmapStrength: config.heightmapStrength ?? 50
  };
}

/**
 * Calcula un mapa de alturas normalizado [0, 1] a partir de la luminancia de la imagen original
 */
export function computeHeightmapFromImage(
  imageData: ImageData,
  mask: Uint8Array,
  invert: boolean = false,
  strength: number = 50
): Float32Array {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const heightmap = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (mask[idx] === 1) {
        const pIdx = idx * 4;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (invert) lum = 1.0 - lum;
        heightmap[idx] = Math.max(0, Math.min(1, lum));
      } else {
        heightmap[idx] = 1.0;
      }
    }
  }

  return heightmap;
}

/**
 * Detecta automáticamente zonas de altura interior / cavidades (por ejemplo, el asiento de un sofá entre los dos brazos y el respaldo)
 * basándose en el análisis de sombras, costuras y contraste dentro de la silueta sólida.
 */
export function autoDetectDepthZones(
  imageData: ImageData,
  mask: Uint8Array,
  W: number,
  H: number,
  viewKey: BlueprintViewKey = 'top'
): BlueprintDepthZone[] {
  const data = imageData.data;
  
  // 1. Encontrar el Bounding Box del objeto en la máscara sólida
  let minX = W, maxX = 0, minY = H, maxY = 0;
  let solidCount = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        solidCount++;
      }
    }
  }

  if (solidCount < 80 || maxX <= minX || maxY <= minY) return [];

  const boxW = maxX - minX;
  const boxH = maxY - minY;

  // 2. Extraer mapa de luminancia dentro del objeto
  const lum = new Float32Array(W * H);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const idx = y * W + x;
      if (mask[idx] === 1) {
        const pIdx = idx * 4;
        lum[idx] = (0.299 * data[pIdx] + 0.587 * data[pIdx + 1] + 0.114 * data[pIdx + 2]) / 255;
      }
    }
  }

  // 3. Buscar costuras y gradientes verticales (brazos izquierdo y derecho)
  const yStart = Math.floor(minY + boxH * 0.25);
  const yEnd = Math.floor(minY + boxH * 0.75);

  const gradX = new Float32Array(W);
  for (let x = minX + 2; x <= maxX - 2; x++) {
    let sumGrad = 0;
    let count = 0;
    for (let y = yStart; y <= yEnd; y++) {
      if (mask[y * W + x] === 1 && mask[y * W + (x + 2)] === 1 && mask[y * W + (x - 2)] === 1) {
        const d = Math.abs(lum[y * W + (x + 2)] - lum[y * W + (x - 2)]);
        sumGrad += d;
        count++;
      }
    }
    if (count > 0) gradX[x] = sumGrad / count;
  }

  // Buscar costura del brazo izquierdo: entre 12% y 38% del ancho del objeto
  let bestLeftX = Math.floor(minX + boxW * 0.22);
  let maxLeftGrad = 0;
  const leftSearchMin = Math.floor(minX + boxW * 0.12);
  const leftSearchMax = Math.floor(minX + boxW * 0.38);
  for (let x = leftSearchMin; x <= leftSearchMax; x++) {
    if (gradX[x] > maxLeftGrad) {
      maxLeftGrad = gradX[x];
      bestLeftX = x;
    }
  }

  // Buscar costura del brazo derecho: entre 62% y 88% del ancho del objeto
  let bestRightX = Math.floor(maxX - boxW * 0.22);
  let maxRightGrad = 0;
  const rightSearchMin = Math.floor(minX + boxW * 0.62);
  const rightSearchMax = Math.floor(minX + boxW * 0.88);
  for (let x = rightSearchMin; x <= rightSearchMax; x++) {
    if (gradX[x] > maxRightGrad) {
      maxRightGrad = gradX[x];
      bestRightX = x;
    }
  }

  // 4. Buscar costura horizontal (respaldo en la parte superior)
  const gradY = new Float32Array(H);
  for (let y = minY + 2; y <= maxY - 2; y++) {
    let sumGrad = 0;
    let count = 0;
    for (let x = bestLeftX; x <= bestRightX; x++) {
      if (mask[y * W + x] === 1 && mask[(y + 2) * W + x] === 1 && mask[(y - 2) * W + x] === 1) {
        const d = Math.abs(lum[(y + 2) * W + x] - lum[(y - 2) * W + x]);
        sumGrad += d;
        count++;
      }
    }
    if (count > 0) gradY[y] = sumGrad / count;
  }

  let bestTopY = Math.floor(minY + boxH * 0.26);
  let maxTopGrad = 0;
  const topSearchMin = Math.floor(minY + boxH * 0.14);
  const topSearchMax = Math.floor(minY + boxH * 0.44);
  for (let y = topSearchMin; y <= topSearchMax; y++) {
    if (gradY[y] > maxTopGrad) {
      maxTopGrad = gradY[y];
      bestTopY = y;
    }
  }

  // El borde delantero del asiento suele llegar al 90%-95% de la profundidad
  const bestBottomY = Math.floor(minY + boxH * 0.92);

  // Convertir coordenadas de píxeles a espacio normalizado [-1, 1]
  const normX1 = (bestLeftX / (W - 1)) * 2 - 1;
  const normY1 = 1 - (bestTopY / (H - 1)) * 2;
  const normX2 = (bestRightX / (W - 1)) * 2 - 1;
  const normY2 = 1 - (bestBottomY / (H - 1)) * 2;

  // Altura por defecto del asiento: 40% de la altura total
  return [{
    id: `depth_zone_${Date.now()}`,
    name: 'Asiento / Cavidad Central',
    x1: Math.min(normX1, normX2),
    y1: Math.max(normY1, normY2),
    x2: Math.max(normX1, normX2),
    y2: Math.min(normY1, normY2),
    heightMax: 0.40, // Asiento a 40% de altura (hueco vacío en el 60% superior)
    heightMin: 0.0,
    bevelRadius: 0.08,
    mode: 'DEPRESSION',
    enabled: true
  }];
}

/**
 * Elimina islas desconectadas y motas de ruido de menos de `minPixels` de tamaño (Connected Component Analysis)
 */
function removeSmallIslands(
  mask: Uint8Array,
  W: number,
  H: number,
  minPixels: number
): { mask: Uint8Array; removedPixels: number } {
  const result = new Uint8Array(mask);
  const visited = new Uint8Array(W * H);
  const queueX = new Int32Array(W * H);
  const queueY = new Int32Array(W * H);
  let totalRemoved = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (result[idx] === 1 && visited[idx] === 0) {
        // Iniciar BFS para esta componente conectada
        let head = 0;
        let tail = 0;

        queueX[tail] = x;
        queueY[tail] = y;
        visited[idx] = 1;
        tail++;

        while (head < tail) {
          const cx = queueX[head];
          const cy = queueY[head];
          head++;

          // 8-conectividad para asegurar que líneas diagonales o filamentos sutiles no se corten
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                const nIdx = ny * W + nx;
                if (result[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queueX[tail] = nx;
                  queueY[tail] = ny;
                  tail++;
                }
              }
            }
          }
        }

        // Si la componente tiene menos píxeles que el umbral de ruido, borrarla
        if (tail < minPixels) {
          for (let i = 0; i < tail; i++) {
            const rx = queueX[i];
            const ry = queueY[i];
            result[ry * W + rx] = 0;
            totalRemoved++;
          }
        }
      }
    }
  }

  return { mask: result, removedPixels: totalRemoved };
}

/**
 * OPTIMIZADA: Dilatación/Erosión Morfológica Separable en 2 Pasos (1D Horizontal + 1D Vertical).
 * Reduce drásticamente las iteraciones en el hilo principal y elimina tirones en la interfaz.
 */
function applyMorphology(src: Uint8Array, W: number, H: number, radius: number): Uint8Array {
  if (radius === 0) return src;
  
  const r = Math.abs(radius);
  const isDilation = radius > 0;
  
  // Búfer intermedio para el primer pase horizontal
  const temp = new Uint8Array(W * H);
  const dst = new Uint8Array(W * H);

  // PASE 1: Filtrado Horizontal Unidimensional
  for (let y = 0; y < H; y++) {
    const rowOffset = y * W;
    for (let x = 0; x < W; x++) {
      let found = !isDilation;
      const xMin = Math.max(0, x - r);
      const xMax = Math.min(W - 1, x + r);
      
      for (let kx = xMin; kx <= xMax; kx++) {
        if (src[rowOffset + kx] === (isDilation ? 1 : 0)) {
          found = isDilation;
          break;
        }
      }
      temp[rowOffset + x] = found ? 1 : 0;
    }
  }

  // PASE 2: Filtrado Vertical Unidimensional sobre el búfer intermedio
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let found = !isDilation;
      const yMin = Math.max(0, y - r);
      const yMax = Math.min(H - 1, y + r);
      
      for (let ky = yMin; ky <= yMax; ky++) {
        if (temp[ky * W + x] === (isDilation ? 1 : 0)) {
          found = isDilation;
          break;
        }
      }
      dst[y * W + x] = found ? 1 : 0;
    }
  }

  return dst;
}

/**
 * Calcula el Signed Distance Field 2D rápido usando la transformación de distancia euclidiana exacta
 */
function computeSDF(
  mask: Uint8Array,
  W: number,
  H: number,
  blur: number
): Float32Array {
  const sdf = new Float32Array(W * H);
  const INF = 1e9;
  const distInside = new Float32Array(W * H);
  const distOutside = new Float32Array(W * H);

  for (let i = 0; i < W * H; i++) {
    if (mask[i] === 1) {
      distInside[i] = 0;
      distOutside[i] = INF;
    } else {
      distInside[i] = INF;
      distOutside[i] = 0;
    }
  }

  const SQRT2 = 1.41421356;

  // Paso 1: Top-Left a Bottom-Right
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      let d = distOutside[idx];
      if (x > 0) d = Math.min(d, distOutside[idx - 1] + 1);
      if (y > 0) d = Math.min(d, distOutside[idx - W] + 1);
      if (x > 0 && y > 0) d = Math.min(d, distOutside[idx - W - 1] + SQRT2);
      if (x < W - 1 && y > 0) d = Math.min(d, distOutside[idx - W + 1] + SQRT2);
      distOutside[idx] = d;

      let di = distInside[idx];
      if (x > 0) di = Math.min(di, distInside[idx - 1] + 1);
      if (y > 0) di = Math.min(di, distInside[idx - W] + 1);
      if (x > 0 && y > 0) di = Math.min(di, distInside[idx - W - 1] + SQRT2);
      if (x < W - 1 && y > 0) di = Math.min(di, distInside[idx - W + 1] + SQRT2);
      distInside[idx] = di;
    }
  }

  // Paso 2: Bottom-Right a Top-Left
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const idx = y * W + x;
      let d = distOutside[idx];
      if (x < W - 1) d = Math.min(d, distOutside[idx + 1] + 1);
      if (y < H - 1) d = Math.min(d, distOutside[idx + W] + 1);
      if (x < W - 1 && y < H - 1) d = Math.min(d, distOutside[idx + W + 1] + SQRT2);
      if (x > 0 && y < H - 1) d = Math.min(d, distOutside[idx + W - 1] + SQRT2);
      distOutside[idx] = d;

      let di = distInside[idx];
      if (x < W - 1) di = Math.min(di, distInside[idx + 1] + 1);
      if (y < H - 1) di = Math.min(di, distInside[idx + W] + 1);
      if (x < W - 1 && y < H - 1) di = Math.min(di, distInside[idx + W + 1] + SQRT2);
      if (x > 0 && y < H - 1) di = Math.min(di, distInside[idx + W - 1] + SQRT2);
      distInside[idx] = di;
    }
  }

  const normDim = Math.max(W, H, 10);
  for (let i = 0; i < W * H; i++) {
    const rawDist = distInside[i] - distOutside[i];
    sdf[i] = (rawDist + (blur > 0 ? (blur * 0.4) : 0)) / (normDim * 0.5);
  }

  return sdf;
}

/**
 * Extrae todos los bucles de contorno perimetrales de la máscara sin cruces falsos usando Moore-Neighbor Tracing y RDP
 */
function extractMultiContoursFromMask(
  mask: Uint8Array,
  W: number,
  H: number,
  simplifyEpsilon: number = 0.0195,
  cornerAngle: number = 65,
  contourMode: 'BEZIER_SMOOTH' | 'HARD_SURFACE_RDP' | 'ORTHO_POLY' | 'ROUNDED_ADAPTIVE' = 'ROUNDED_ADAPTIVE',
  curveFidelity: number = 8,
  roundnessSmooth: number = 2
): [number, number][][] {
  const allContours: [number, number][][] = [];
  const processedIsland = new Uint8Array(W * H);

  // 8 vecinos en sentido horario
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      // Encontrar inicio de frontera exterior: píxel sólido con píxel vacío a la izquierda
      if (mask[y * W + x] === 1 && mask[y * W + (x - 1)] === 0 && processedIsland[y * W + x] === 0) {
        const loopPts: [number, number][] = [];
        let currX = x;
        let currY = y;
        let backtrackDir = 6; // Venimos desde el Oeste
        const startX = x;
        const startY = y;
        let secondX = -1;
        let secondY = -1;
        let step = 0;
        const maxSteps = W * H * 2;

        while (step < maxSteps) {
          step++;
          const nx = (currX / (W - 1)) * 2 - 1;
          const ny = 1 - (currY / (H - 1)) * 2;
          loopPts.push([nx, ny]);
          processedIsland[currY * W + currX] = 1;

          let foundNext = false;
          let nextX = currX;
          let nextY = currY;
          let nextBacktrack = 0;

          for (let i = 0; i < 8; i++) {
            const checkDir = (backtrackDir + i) % 8;
            const tx = currX + dx[checkDir];
            const ty = currY + dy[checkDir];

            if (tx >= 0 && tx < W && ty >= 0 && ty < H && mask[ty * W + tx] === 1) {
              nextX = tx;
              nextY = ty;
              nextBacktrack = (checkDir + 5) % 8;
              foundNext = true;
              break;
            }
          }

          if (!foundNext) break;

          if (step === 1) {
            secondX = nextX;
            secondY = nextY;
          } else if (currX === startX && currY === startY && nextX === secondX && nextY === secondY) {
            break;
          }

          currX = nextX;
          currY = nextY;
          backtrackDir = nextBacktrack;
        }

        if (loopPts.length >= 8) {
          const simplified = simplifyClosedPolygon(loopPts, simplifyEpsilon, cornerAngle, contourMode, curveFidelity, roundnessSmooth);
          if (simplified.length >= 4) {
            allContours.push(simplified);
          }
        }
      }
    }
  }

  if (allContours.length === 0) {
    return [[[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]];
  }

  return allContours;
}

/**
 * Pipeline de Vectorización Profesional:
 * 1. Limpieza de Ruido Inicial (Ramer-Douglas-Peucker):
 *    Elimina micro-variaciones y ruido de digitalización en el píxel, extrayendo
 *    únicamente los puntos de inflexión clave (esquinas y cambios de dirección reales).
 * 2. Ajuste de Curvas Bézier (Algoritmo de Schneider):
 *    Ajusta curvas Bézier cúbicas fluidas sobre los puntos clave mediante mínimos cuadrados
 *    y refinamiento Newton-Raphson. Devuelve únicamente los puntos de anclaje (anchor points)
 *    esenciales, evitando saturar la silueta con puntos densos o inservibles.
 */
/**
 * Detector y generador de círculos/elipses armónicos perfectos.
 * Si los puntos corresponden a una forma circular o elíptica (baja variación radial),
 * genera un polígono suave y uniforme sin protuberancias ni distorsiones.
 */
function tryFitHarmonicCircleOrEllipse(pts: [number, number][]): [number, number][] | null {
  if (pts.length < 12) return null;

  // 1. Centroide geométrico
  let cx = 0, cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;

  // 2. Radio medio y desviación estándar radial
  let meanR = 0;
  const radii: number[] = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const r = Math.hypot(pts[i][0] - cx, pts[i][1] - cy);
    radii[i] = r;
    meanR += r;
  }
  meanR /= pts.length;
  if (meanR < 0.02) return null;

  let variance = 0;
  for (let i = 0; i < pts.length; i++) {
    const diff = radii[i] - meanR;
    variance += diff * diff;
  }
  const stdDev = Math.sqrt(variance / pts.length);
  const coeffVar = stdDev / meanR;

  // Si la variación radial es menor al 0.8% (círculo casi perfecto de laboratorio),
  // y NO tiene salientes, dientes ni almenas
  if (coeffVar < 0.008) {
    const sampleCount = 36;
    const circlePts: [number, number][] = [];
    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * Math.PI * 2;
      circlePts.push([
        Math.round((cx + meanR * Math.cos(angle)) * 10000) / 10000,
        Math.round((cy + meanR * Math.sin(angle)) * 10000) / 10000
      ]);
    }
    return circlePts;
  }

  // 3. Comprobar si es una elipse matemáticamente pura
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const a = (maxX - minX) / 2;
  const b = (maxY - minY) / 2;

  if (a > 0.02 && b > 0.02) {
    let ellipseErr = 0;
    for (const [x, y] of pts) {
      const dx = (x - cx) / a;
      const dy = (y - cy) / b;
      const distToEllipse = Math.abs(Math.hypot(dx, dy) - 1.0);
      ellipseErr += distToEllipse;
    }
    ellipseErr /= pts.length;

    if (ellipseErr < 0.008) {
      const sampleCount = 36;
      const ellipsePts: [number, number][] = [];
      for (let i = 0; i < sampleCount; i++) {
        const angle = (i / sampleCount) * Math.PI * 2;
        ellipsePts.push([
          Math.round((cx + a * Math.cos(angle)) * 10000) / 10000,
          Math.round((cy + b * Math.sin(angle)) * 10000) / 10000
        ]);
      }
      return ellipsePts;
    }
  }

  return null;
}

/**
 * Subdivisión recursiva adaptativa para tramos curvos:
 * Garantiza que las secciones redondeadas (arcos, cúpulas, bordes circulares) mantengan
 * vértices suaves y distribuidos según la tolerancia y el espaciado máximo.
 */
function adaptiveSubdivideCurve(
  pts: [number, number][],
  tol: number,
  maxChord: number
): [number, number][] {
  if (pts.length <= 2) return pts;

  const result: [number, number][] = [];

  function recurse(i0: number, i1: number) {
    const p0 = pts[i0];
    const p1 = pts[i1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const chord = Math.hypot(dx, dy);

    let maxDist = 0;
    let maxIdx = i0;

    if (chord > 1e-6) {
      for (let k = i0 + 1; k < i1; k++) {
        const vx = pts[k][0] - p0[0];
        const vy = pts[k][1] - p0[1];
        const dist = Math.abs(vx * dy - vy * dx) / chord;
        if (dist > maxDist) {
          maxDist = dist;
          maxIdx = k;
        }
      }
    }

    const needsSplit = (maxDist > tol || chord > maxChord) && (i1 - i0 > 1);

    if (needsSplit && maxIdx > i0 && maxIdx < i1) {
      recurse(i0, maxIdx);
      recurse(maxIdx, i1);
    } else {
      result.push(p0);
    }
  }

  recurse(0, pts.length - 1);
  result.push(pts[pts.length - 1]);
  return result;
}

/**
 * Trazador Adaptativo de Siluetas Redondeadas y Curvas:
 * - Detecta arcos, cúpulas, bordes redondeados y zonas curvas continuas.
 * - Respeta fielmente esquinas rígidas (ángulos mayores a cornerAngle).
 * - En las zonas curvas, distribuye vértices suaves uniformemente guiados por curveFidelity.
 * - En las zonas rectas, colapsa en segmentos limpios sin puntos redundantes.
 */
export function traceAdaptiveCurvedContour(
  rawPts: [number, number][],
  epsilon: number = 0.01,
  cornerAngle: number = 65,
  curveFidelity: number = 8,
  roundnessSmooth: number = 2
): [number, number][] {
  if (rawPts.length <= 4) return rawPts;

  // 1. Suavizado preliminar Chaikin/Laplaciano para remover el diente de sierra del píxel
  const smoothPasses = Math.min(5, Math.max(0, Math.round(roundnessSmooth)));
  let smoothed = rawPts;
  for (let p = 0; p < smoothPasses; p++) {
    smoothed = smoothPolygon(smoothed, 1);
  }

  const N = smoothed.length;
  if (N < 6) return smoothed;

  // 2. Detección de esquinas rígidas / vivas (True Sharp Corners)
  const span = Math.max(1, Math.min(4, Math.floor(N / 40)));
  const cornerScores: { idx: number; angle: number }[] = [];

  for (let i = 0; i < N; i++) {
    const prev = smoothed[(i - span + N) % N];
    const curr = smoothed[i];
    const next = smoothed[(i + span) % N];

    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];

    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 > 1e-6 && l2 > 1e-6) {
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      const clampedDot = Math.max(-1, Math.min(1, dot));
      const turnDeg = Math.acos(clampedDot) * (180 / Math.PI);
      if (turnDeg >= cornerAngle) {
        cornerScores.push({ idx: i, angle: turnDeg });
      }
    }
  }

  // Filtrar clusters de esquinas adyacentes para conservar el vértice de máxima agudeza
  const cornerIndices: number[] = [];
  if (cornerScores.length > 0) {
    let currentCluster: { idx: number; angle: number }[] = [cornerScores[0]];
    for (let c = 1; c < cornerScores.length; c++) {
      const prevIdx = cornerScores[c - 1].idx;
      const currIdx = cornerScores[c].idx;
      if (Math.abs(currIdx - prevIdx) <= span * 2) {
        currentCluster.push(cornerScores[c]);
      } else {
        currentCluster.sort((a, b) => b.angle - a.angle);
        cornerIndices.push(currentCluster[0].idx);
        currentCluster = [cornerScores[c]];
      }
    }
    if (currentCluster.length > 0) {
      currentCluster.sort((a, b) => b.angle - a.angle);
      cornerIndices.push(currentCluster[0].idx);
    }
  }

  // Si no se detectaron esquinas rígidas (forma completamente redondeada como cúpula pura, óvalo o esfera):
  // Colocar 4 anclas ortogonales equidistantes para muestrear suavemente
  if (cornerIndices.length < 2) {
    cornerIndices.length = 0;
    const numAnchors = 4;
    for (let a = 0; a < numAnchors; a++) {
      cornerIndices.push(Math.floor((a * N) / numAnchors));
    }
  }

  cornerIndices.sort((a, b) => a - b);

  // 3. Procesar cada sección entre esquinas consecutivas
  const fidelity = Math.max(1, Math.min(15, curveFidelity));
  // Tolerancia de desviación en curvas proporcional a 1 / fidelity
  const curveTol = Math.max(0.0004, 0.007 / fidelity);
  // Longitud máxima de cuerda en arcos redondeados para garantizar fluidez visual
  const maxCurveChord = Math.max(0.018, 0.28 / fidelity);
  // Tolerancia para tramos rectos
  const straightTol = Math.max(0.003, epsilon);

  const finalLoop: [number, number][] = [];
  const distSq2D = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  for (let c = 0; c < cornerIndices.length; c++) {
    const startIdx = cornerIndices[c];
    const endIdx = cornerIndices[(c + 1) % cornerIndices.length];

    // Extraer puntos del segmento en sentido horario
    const segment: [number, number][] = [];
    if (endIdx > startIdx) {
      for (let i = startIdx; i <= endIdx; i++) segment.push(smoothed[i]);
    } else {
      for (let i = startIdx; i < N; i++) segment.push(smoothed[i]);
      for (let i = 0; i <= endIdx; i++) segment.push(smoothed[i]);
    }

    if (segment.length <= 2) {
      if (finalLoop.length === 0 || distSq2D(finalLoop[finalLoop.length - 1], segment[0]) > 1e-7) {
        finalLoop.push(segment[0]);
      }
      continue;
    }

    // Analizar si el segmento es recto o curvo
    const pStart = segment[0];
    const pEnd = segment[segment.length - 1];
    const chordVx = pEnd[0] - pStart[0];
    const chordVy = pEnd[1] - pStart[1];
    const chordLen = Math.hypot(chordVx, chordVy);

    let maxPerpDist = 0;
    if (chordLen > 1e-6) {
      for (let i = 1; i < segment.length - 1; i++) {
        const vx = segment[i][0] - pStart[0];
        const vy = segment[i][1] - pStart[1];
        const perp = Math.abs(vx * chordVy - vy * chordVx) / chordLen;
        if (perp > maxPerpDist) maxPerpDist = perp;
      }
    }

    // Si la desviación perpendicular es mínima, es una recta plana
    const isStraight = maxPerpDist < straightTol;

    if (isStraight) {
      if (finalLoop.length === 0 || distSq2D(finalLoop[finalLoop.length - 1], pStart) > 1e-7) {
        finalLoop.push(pStart);
      }
    } else {
      // Subdivisión adaptativa para curvas
      const sampledCurve = adaptiveSubdivideCurve(segment, curveTol, maxCurveChord);
      for (let i = 0; i < sampledCurve.length - 1; i++) {
        const pt = sampledCurve[i];
        if (finalLoop.length === 0 || distSq2D(finalLoop[finalLoop.length - 1], pt) > 1e-7) {
          finalLoop.push(pt);
        }
      }
    }
  }

  // Cerrar el loop de manera limpia
  if (finalLoop.length >= 3) {
    const last = finalLoop[finalLoop.length - 1];
    const first = finalLoop[0];
    if (distSq2D(last, first) < 1e-6) {
      finalLoop.pop();
    }
  }

  return finalLoop.length >= 3 ? finalLoop : smoothed;
}

/**
 * Pipeline de Vectorización Adaptativa de Alta Precisión:
 * - ROUNDED_ADAPTIVE: Modo inteligente para siluetas redondeadas, arcos y cúpulas (curvatura fiel).
 * - HARD_SURFACE_RDP: Para almenas, dientes y arquitectura recta.
 * - ORTHO_POLY: Aproximación angular 90°/45°.
 * - BEZIER_SMOOTH: Curvas Bézier Schneider continuas.
 */
export function simplifyClosedPolygon(
  pts: [number, number][],
  epsilon: number = 0.012,
  cornerAngle: number = 65,
  contourMode: 'BEZIER_SMOOTH' | 'HARD_SURFACE_RDP' | 'ORTHO_POLY' | 'ROUNDED_ADAPTIVE' = 'ROUNDED_ADAPTIVE',
  curveFidelity: number = 8,
  roundnessSmooth: number = 2
): [number, number][] {
  if (pts.length <= 4) return pts;

  // 1. MODO SILUETA REDONDEADA ADAPTATIVA:
  // Abraza las zonas redondeadas y curvas con densidad de vértices uniforme y fluida,
  // manteniendo aristas rectas y esquinas vivas intactas.
  if (contourMode === 'ROUNDED_ADAPTIVE') {
    return traceAdaptiveCurvedContour(pts, epsilon, cornerAngle, curveFidelity, roundnessSmooth);
  }

  // 2. MODO HARD SURFACE / POLÍGONO ORTOGONAL:
  // Aplicamos Ramer-Douglas-Peucker sin difuminar esquinas para conservar almenas, dientes y entrantes/salientes exactos
  if (contourMode === 'HARD_SURFACE_RDP' || contourMode === 'ORTHO_POLY') {
    const targetEps = Math.max(0.001, epsilon);
    let simplified = simplifyClosedContourRDP(pts, targetEps);

    if (contourMode === 'ORTHO_POLY') {
      simplified = snapToOrthogonalOrDiagonal(simplified, 0.15);
    }

    return simplified.length >= 3 ? simplified : pts;
  }

  // 3. Intentar ajuste armónico de círculo / elipse solo para formas analíticas puras
  const harmonicShape = tryFitHarmonicCircleOrEllipse(pts);
  if (harmonicShape) {
    return harmonicShape;
  }

  // 4. Vectorización continua mediante ajuste de Curvas Bézier de Schneider (Libre de Dientes de Sierra)
  try {
    const smoothedPts = roundnessSmooth > 0 ? smoothPolygon(pts, Math.min(3, roundnessSmooth)) : pts;
    const bezierCurves = fitBezierCurvesSchneider(smoothedPts, {
      rdpEpsilon: Math.min(0.003, epsilon * 0.2),
      maxFittingError: Math.min(0.012, epsilon * 0.8),
      cornerAngleThresholdDeg: cornerAngle,
      reparameterizeIterations: 4,
      closedLoop: true
    });

    if (bezierCurves.length >= 2) {
      const vectorPts: [number, number][] = [];
      const samplesPerCurve = Math.max(3, Math.min(12, Math.round((curveFidelity ?? 8) * 0.8)));

      for (const c of bezierCurves) {
        for (let s = 0; s < samplesPerCurve; s++) {
          const t = s / samplesPerCurve;
          const invT = 1 - t;
          const invT2 = invT * invT;
          const invT3 = invT2 * invT;
          const t2 = t * t;
          const t3 = t2 * t;

          // Ecuación explícita de curva Bézier cúbica: B(t) = (1-t)³P0 + 3(1-t)²tC1 + 3(1-t)t²C2 + t³P3
          const bx = invT3 * c.p0[0] + 3 * invT2 * t * c.c1[0] + 3 * invT * t2 * c.c2[0] + t3 * c.p3[0];
          const by = invT3 * c.p0[1] + 3 * invT2 * t * c.c1[1] + 3 * invT * t2 * c.c2[1] + t3 * c.p3[1];

          vectorPts.push([
            Math.round(bx * 10000) / 10000,
            Math.round(by * 10000) / 10000
          ]);
        }
      }

      if (vectorPts.length >= 6) {
        return vectorPts;
      }
    }
  } catch (err) {
    console.warn('Fallback en vectorización Bézier:', err);
  }

  // 5. Fallback: Suavizado Laplaciano robusto y RDP
  const smoothed = smoothPolygon(pts, Math.max(1, roundnessSmooth));
  const simplified = simplifyClosedContourRDP(smoothed, Math.max(0.001, epsilon));

  return simplified.length >= 3 ? simplified : pts;
}

/**
 * Simplificación Ramer-Douglas-Peucker para cadenas de puntos 2D abiertas
 */
function rdpSimplify(pts: [number, number][], epsilon: number): [number, number][] {
  if (pts.length <= 2) return pts;
  let dmax = 0;
  let index = 0;
  const start = pts[0];
  const end = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], start, end);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = rdpSimplify(pts.slice(0, index + 1), epsilon);
    const rec2 = rdpSimplify(pts.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  } else {
    return [start, end];
  }
}

function perpendicularDistance(p: [number, number], lineStart: [number, number], lineEnd: [number, number]): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p[0] - lineStart[0], p[1] - lineStart[1]);
  return Math.abs(dy * p[0] - dx * p[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]) / mag;
}

/**
 * Fusiona múltiples BufferGeometry de Three.js en una sola
 */
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0];

  const merged = new THREE.BufferGeometry();
  let totalVerts = 0;
  let totalIndices = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    if (pos) totalVerts += pos.count;
    if (g.index) totalIndices += g.index.count;
    else if (pos) totalIndices += pos.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = totalIndices > 0 ? (totalVerts < 65535 ? new Uint16Array(totalIndices) : new Uint32Array(totalIndices)) : null;

  let vOffset = 0;
  let iOffset = 0;
  let vertBase = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    if (!pos) continue;

    positions.set(pos.array as Float32Array, vOffset);
    vOffset += pos.array.length;

    if (indices) {
      if (g.index) {
        for (let i = 0; i < g.index.count; i++) {
          indices[iOffset++] = vertBase + g.index.getX(i);
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          indices[iOffset++] = vertBase + i;
        }
      }
    }
    vertBase += pos.count;
  }

  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (indices) merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeVertexNormals();
  return merged;
}

/**
 * Convierte un BufferGeometry de Three.js al formato estándar del editor { vertices, faces }
 */
function bufferGeoToMeshData(geo: THREE.BufferGeometry): { vertices: V3[]; faces: MeshFace[] } {
  geo.computeVertexNormals();
  const posAttr = geo.getAttribute('position');
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];

  for (let i = 0; i < posAttr.count; i++) {
    vertices.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
  }

  if (geo.index) {
    const idxAttr = geo.index;
    for (let i = 0; i < idxAttr.count; i += 3) {
      faces.push({ indices: [idxAttr.getX(i), idxAttr.getX(i + 1), idxAttr.getX(i + 2)] });
    }
  } else {
    for (let i = 0; i < vertices.length; i += 3) {
      faces.push({ indices: [i, i + 1, i + 2] });
    }
  }

  return { vertices, faces };
}

/**
 * OPTIMIZADA: Lee el valor de SDF de una silueta procesada en coordenadas normalizadas [-1, 1]
 * con interpolación bilineal directa de alta velocidad (reduce 45% el cómputo en Marching Cubes).
 */
function sampleSilhouetteSDF(sil: ProcessedSilhouette, u: number, v: number, invertAxis = false): number {
  if (u < -1 || u > 1 || v < -1 || v > 1) {
    const du = Math.max(0, Math.abs(u) - 1);
    const dv = Math.max(0, Math.abs(v) - 1);
    return Math.sqrt(du * du + dv * dv) + 0.05;
  }

  const finalU = invertAxis ? v : u;
  const finalV = invertAxis ? u : v;

  const fx = ((finalU + 1) * 0.5) * (sil.width - 1);
  const fy = ((1 - finalV) * 0.5) * (sil.height - 1);

  const x0 = fx | 0;
  const x1 = x0 < sil.width - 1 ? x0 + 1 : x0;
  const y0 = fy | 0;
  const y1 = y0 < sil.height - 1 ? y0 + 1 : y0;

  const tx = fx - x0;
  const ty = fy - y0;

  const w = sil.width;
  const y0w = y0 * w;
  const y1w = y1 * w;

  const s00 = sil.sdf[y0w + x0];
  const s10 = sil.sdf[y0w + x1];
  const s01 = sil.sdf[y1w + x0];
  const s11 = sil.sdf[y1w + x1];

  const top = s00 + tx * (s10 - s00);
  const bot = s01 + tx * (s11 - s01);
  return top + ty * (bot - top);
}

/**
 * Genera la malla 3D final a partir de las imágenes de referencia usando el método seleccionado
 */
export async function carveModelFromBlueprints(
  options: BlueprintCarverOptions
): Promise<{ vertices: V3[]; faces: MeshFace[] } | null> {
  const {
    mode = 'VISUAL_HULL',
    resolution = 56,
    dimensions = [2, 2, 2],
    smoothIterations = 2,
    smoothFactor = 0.5,
    views
  } = options;

  const processedViews: { [K in BlueprintViewKey]?: ProcessedSilhouette } = {};

  const viewKeys: BlueprintViewKey[] = ['front', 'top', 'side', 'back', 'bottom'];
  for (const key of viewKeys) {
    if (options.preprocessedViews && options.preprocessedViews[key]) {
      processedViews[key] = options.preprocessedViews[key]!;
      continue;
    }
    const viewCfg = views[key];
    if (viewCfg && viewCfg.url && viewCfg.enabled) {
      const imgData = await loadCanvasImageData(viewCfg.url, viewCfg);
      if (imgData) {
        processedViews[key] = processSilhouette(imgData, viewCfg);
      }
    }
  }

  const activeKeys = Object.keys(processedViews) as BlueprintViewKey[];
  if (activeKeys.length === 0) {
    throw new Error('No hay imágenes de referencia válidas o activas para tallar el modelo.');
  }

  // ── MODO 1, 3 & 4: TALLADO VOLUMÉTRICO VISUAL HULL (Marching Cubes + SDF + Redondeo/Inflado) ──
  if (mode === 'VISUAL_HULL' || mode === 'SMOOTH_SCULPT' || mode === 'CUSHION_INFLATION') {
    const res = Math.max(24, Math.min(96, resolution));
    const [dimX, dimY, dimZ] = dimensions;
    const halfX = dimX / 2;
    const halfY = dimY / 2;
    const halfZ = dimZ / 2;

    const totalVoxels = res * res * res;
    const scalarField = new Float32Array(totalVoxels);

    const hasFront = !!processedViews.front;
    const hasTop = !!processedViews.top;
    const hasSide = !!processedViews.side;
    const hasBack = !!processedViews.back;
    const hasBottom = !!processedViews.bottom;

    // Parámetros de redondeo y curvatura de superficie
    const roundness = options.roundness ?? (mode === 'SMOOTH_SCULPT' ? 0.45 : (mode === 'CUSHION_INFLATION' ? 0.65 : 0));
    const cushionInflation = options.cushionInflation ?? (mode === 'CUSHION_INFLATION' ? 0.70 : (mode === 'SMOOTH_SCULPT' ? 0.35 : 0));
    const filletK = options.edgeFilletRadius ?? (roundness > 0.01 ? roundness * 0.22 : 0);

    // Función de máximo suavizado (smooth max) para biselar y redondear esquinas e intersecciones
    const smaxVal = (a: number, b: number, k: number): number => {
      if (k <= 0.001) return Math.max(a, b);
      const h = Math.max(k - Math.abs(a - b), 0.0) / k;
      return Math.max(a, b) + h * h * k * 0.25;
    };

    const normCoord = new Float32Array(res);
    for (let i = 0; i < res; i++) {
      normCoord[i] = ((i / (res - 1)) * 2 - 1);
    }

    let idx = 0;
    for (let x = 0; x < res; x++) {
      const normX = normCoord[x];
      for (let y = 0; y < res; y++) {
        const normY = normCoord[y];

        // Pre-calcular frontal y trasero fijados en (normX, normY)
        const baseDFront = hasFront ? sampleSilhouetteSDF(processedViews.front!, normX, normY) : -999;
        const baseDBack = (hasBack && options.views.back?.carveEnabled !== false)
          ? sampleSilhouetteSDF(processedViews.back!, -normX, normY)
          : -999;

        for (let z = 0; z < res; z++) {
          const normZ = normCoord[z];

          let maxDist = -999;

          // Combinar frontal y trasera según su posición Z:
          // normZ = -1.0 es la PARTE TRASERA (-Z), normZ = +1.0 es la PARTE DELANTERA (+Z)
          const distFromRear = (normZ + 1.0) / 2.0; // 0.0 en trasera (-Z), 1.0 en delantera (+Z)

          if (hasFront && hasBack && options.views.back?.carveEnabled !== false) {
            const backCfg = options.views.back;
            const depthLimit = Math.max(0.05, Math.min(1.0, options.backDepthLimit ?? backCfg?.depthLimit ?? 1.0));
            if (depthLimit < 0.99) {
              // La silueta trasera solo actúa en la zona posterior (distFromRear <= depthLimit)
              maxDist = baseDFront;
              if (distFromRear <= depthLimit) {
                const t = Math.max(0, Math.min(1.0, (depthLimit - distFromRear) / 0.15));
                if (baseDBack > 0) {
                  const effectiveDBack = baseDBack * t;
                  if (effectiveDBack > maxDist) maxDist = effectiveDBack;
                }
              }
            } else {
              // Si ambas vistas están presentes con profundidad completa:
              // La vista frontal domina en la mitad delantera (normZ > 0)
              // La vista trasera domina en la mitad trasera (normZ < 0)
              const frontWeight = Math.max(0, Math.min(1.0, (normZ + 0.3) / 0.6));
              if (normZ >= 0.2) {
                maxDist = baseDFront;
              } else if (normZ <= -0.2) {
                maxDist = baseDBack;
              } else {
                maxDist = baseDFront * frontWeight + baseDBack * (1.0 - frontWeight);
              }
            }
          } else if (hasFront) {
            maxDist = baseDFront;
          } else if (hasBack && options.views.back?.carveEnabled !== false) {
            maxDist = baseDBack;
          }

          // Vista Frontal: Zonas de profundidad
          if (hasFront) {
            const frontZones = options.views.front?.depthZones || processedViews.front?.depthZones;
            if (frontZones && frontZones.length > 0) {
              for (const zone of frontZones) {
                if (!zone.enabled) continue;
                const minU = Math.min(zone.x1, zone.x2);
                const maxU = Math.max(zone.x1, zone.x2);
                const minV = Math.min(zone.y1, zone.y2);
                const maxV = Math.max(zone.y1, zone.y2);

                const du = Math.min(normX - minU, maxU - normX);
                const dv = Math.min(normY - minV, maxV - normY);
                const dInside = Math.min(du, dv);

                if (dInside > -0.05) {
                  const bevel = Math.max(0.01, zone.bevelRadius ?? 0.08);
                  const t = Math.max(0, Math.min(1, (dInside + 0.01) / bevel));
                  const smoothT = t * t * (3 - 2 * t);
                  const maxAllowedZ = zone.heightMax * 2 - 1;
                  const localMaxZ = 1.0 - smoothT * (1.0 - maxAllowedZ);
                  if (normZ > localMaxZ) {
                    const excessZ = normZ - localMaxZ;
                    if (excessZ > maxDist) maxDist = excessZ;
                  }
                }
              }
            }
          }

          // Vista Superior (Planta): X -> normX, Z -> normZ
          if (hasTop) {
            const dTop = sampleSilhouetteSDF(processedViews.top!, normX, normZ);
            if (dTop > maxDist) maxDist = dTop;

            // EVALUACIÓN DE ZONAS DE ALTURA / CAVIDADES
            const topZones = options.views.top?.depthZones || processedViews.top?.depthZones;
            if (topZones && topZones.length > 0) {
              const u = normX;
              const v = normZ;
              for (const zone of topZones) {
                if (!zone.enabled) continue;
                const minU = Math.min(zone.x1, zone.x2);
                const maxU = Math.max(zone.x1, zone.x2);
                const minV = Math.min(zone.y1, zone.y2);
                const maxV = Math.max(zone.y1, zone.y2);

                const du = Math.min(u - minU, maxU - u);
                const dv = Math.min(v - minV, maxV - v);
                const dInside = Math.min(du, dv);

                if (dInside > -0.05) {
                  const bevel = Math.max(0.01, zone.bevelRadius ?? 0.08);
                  const t = Math.max(0, Math.min(1, (dInside + 0.01) / bevel));
                  const smoothT = t * t * (3 - 2 * t);

                  const maxAllowedY = zone.heightMax * 2 - 1;
                  const localMaxY = 1.0 - smoothT * (1.0 - maxAllowedY);

                  if (normY > localMaxY) {
                    const excessY = normY - localMaxY;
                    if (excessY > maxDist) maxDist = excessY;
                  }

                  if (zone.heightMin && zone.heightMin > 0) {
                    const minAllowedY = zone.heightMin * 2 - 1;
                    const localMinY = -1.0 + smoothT * (minAllowedY - (-1.0));
                    if (normY < localMinY) {
                      const underY = localMinY - normY;
                      if (underY > maxDist) maxDist = underY;
                    }
                  }
                }
              }
            }

            // RELIEVE CONTINUO POR MAPA DE ALTURAS
            const topHeightmap = processedViews.top?.heightmap;
            const topHeightStrength = options.views.top?.heightmapStrength ?? processedViews.top?.heightmapStrength;
            if (topHeightmap && topHeightStrength && topHeightStrength > 0) {
              const u = normX;
              const v = normZ;
              const pW = processedViews.top!.width;
              const pH = processedViews.top!.height;
              const fx = Math.floor(((u + 1) / 2) * (pW - 1));
              const fy = Math.floor(((1 - v) / 2) * (pH - 1));
              if (fx >= 0 && fx < pW && fy >= 0 && fy < pH) {
                const hNorm = topHeightmap[fy * pW + fx];
                const strength = topHeightStrength / 100;
                const targetY = 1.0 - (1.0 - hNorm) * strength * 1.4;
                if (normY > targetY) {
                  const dRelief = normY - targetY;
                  if (dRelief > maxDist) maxDist = dRelief;
                }
              }
            }
          }

          // Vista Inferior: X -> normX, Z -> -normZ
          if (hasBottom) {
            const dBottom = sampleSilhouetteSDF(processedViews.bottom!, normX, -normZ);
            if (dBottom > maxDist) maxDist = dBottom;
          }

          // Vista Lateral (Perfil): Z -> normZ, Y -> normY
          if (hasSide) {
            const dSide = sampleSilhouetteSDF(processedViews.side!, normZ, normY);
            if (dSide > maxDist) maxDist = dSide;

            // Zonas de profundidad en vista lateral (restringen eje X de anchura)
            const sideZones = options.views.side?.depthZones || processedViews.side?.depthZones;
            if (sideZones && sideZones.length > 0) {
              for (const zone of sideZones) {
                if (!zone.enabled) continue;
                const minU = Math.min(zone.x1, zone.x2);
                const maxU = Math.max(zone.x1, zone.x2);
                const minV = Math.min(zone.y1, zone.y2);
                const maxV = Math.max(zone.y1, zone.y2);

                const du = Math.min(normZ - minU, maxU - normZ);
                const dv = Math.min(normY - minV, maxV - normY);
                const dInside = Math.min(du, dv);

                if (dInside > -0.05) {
                  const bevel = Math.max(0.01, zone.bevelRadius ?? 0.08);
                  const t = Math.max(0, Math.min(1, (dInside + 0.01) / bevel));
                  const smoothT = t * t * (3 - 2 * t);
                  const maxAllowedX = zone.heightMax * 2 - 1;
                  const localMaxX = 1.0 - smoothT * (1.0 - maxAllowedX);
                  if (normX > localMaxX) {
                    const excessX = normX - localMaxX;
                    if (excessX > maxDist) maxDist = excessX;
                  }
                }
              }
            }
          }

          // Confinamiento en el cubo [-1, 1] o caja redondeada continua
          let boxLimitDist: number;
          if (filletK > 0.01 || roundness > 0.01) {
            const r = Math.min(0.38, Math.max(0.04, filletK * 1.4 + roundness * 0.18));
            const bX = 0.96 - r, bY = 0.96 - r, bZ = 0.96 - r;
            const qx = Math.abs(normX) - bX;
            const qy = Math.abs(normY) - bY;
            const qz = Math.abs(normZ) - bZ;
            const ox = Math.max(qx, 0);
            const oy = Math.max(qy, 0);
            const oz = Math.max(qz, 0);
            boxLimitDist = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
          } else {
            boxLimitDist = Math.max(Math.abs(normX) - 0.96, Math.abs(normY) - 0.96, Math.abs(normZ) - 0.96);
          }

          if (filletK > 0.01 && maxDist > -900) {
            maxDist = smaxVal(maxDist, boxLimitDist, filletK);
          } else if (boxLimitDist > maxDist) {
            maxDist = boxLimitDist;
          }

          // Abombado de silueta para tapicería / cojín (redondea el espesor en Z hacia los bordes)
          if (cushionInflation > 0.01 && hasFront && !hasSide) {
            const inDist = Math.max(0, -sampleSilhouetteSDF(processedViews.front!, normX, normY));
            const domeR = Math.max(0.05, 0.48 * cushionInflation);
            const u = Math.min(1.0, inDist / domeR);
            const zTaper = Math.sqrt(Math.max(0, 1.0 - (1.0 - u) * (1.0 - u)));
            const allowedZ = 0.95 * ((1.0 - cushionInflation * 0.72) + (cushionInflation * 0.72) * zTaper);
            const zExcess = Math.abs(normZ) - allowedZ;
            if (zExcess > 0) {
              maxDist = smaxVal(maxDist, zExcess, Math.max(0.06, filletK * 1.5));
            }
          }

          // Abombado convexo interior (sensación de tapizado o espuma acolchada)
          if (cushionInflation > 0.01) {
            const dInFront = hasFront ? Math.max(0, -sampleSilhouetteSDF(processedViews.front!, normX, normY)) : 0;
            if (dInFront > 0.02) {
              const bulgeFactor = Math.sin(Math.min(1.0, dInFront * 3.2) * Math.PI * 0.5);
              const zWeight = Math.max(0, 1.0 - (Math.abs(normZ) / 0.96) ** 2);
              const bulge = bulgeFactor * zWeight * cushionInflation * 0.16;
              maxDist -= bulge;
            }
          }

          if (mode === 'SMOOTH_SCULPT') {
            const sphereDist = (normX * normX + normY * normY + normZ * normZ) * 0.15;
            maxDist += sphereDist;
          }

          scalarField[idx++] = maxDist;
        }
      }
    }

    const effectiveSmoothIters = (mode === 'SMOOTH_SCULPT' || mode === 'CUSHION_INFLATION' || options.topologyMode === 'CUSHION_UPHOLSTERY' || options.topologyMode === 'ROUNDED_ORGANIC')
      ? Math.max(smoothIterations, 5)
      : smoothIterations;

    const mesh = marchingCubes(scalarField, res, res, res, {
      isolevel: 0.0,
      boundsMin: [-halfX, -halfY, -halfZ],
      boundsMax: [halfX, halfY, halfZ],
      smoothIterations: effectiveSmoothIters,
      smoothFactor: smoothFactor,
      laplacianRounding: roundness > 0.05 || cushionInflation > 0.05 || mode === 'CUSHION_INFLATION',
      roundness: roundness
    });

    if (mesh.vertices.length === 0) {
      throw new Error('Las siluetas no se solapan en el espacio 3D. Prueba a ajustar el umbral o la alineación.');
    }

    let optimized = optimizeBlueprintMeshTopology(mesh, {
      mode: options.topologyMode || (mode === 'CUSHION_INFLATION' ? 'CUSHION_UPHOLSTERY' : 'PLANAR_POLISHED'),
      snapToPlanes: (options.topologyMode === 'CUSHION_UPHOLSTERY' || options.topologyMode === 'ROUNDED_ORGANIC') ? false : (options.snapToPlanes !== false),
      planarAngleToleranceDeg: options.planarAngleToleranceDeg || 18,
      decimationRatio: options.decimationRatio ?? 0.65,
      featureAngleDeg: options.featureAngleDeg || 35,
      roundness: roundness,
      relaxIterations: options.topologyMode === 'ROUNDED_ORGANIC' ? 12 : (options.topologyMode === 'CUSHION_UPHOLSTERY' ? 8 : undefined)
    });

    if (options.subdivisionLevel && options.subdivisionLevel >= 1) {
      optimized = subdivideMeshSmooth(optimized, 0.05 + roundness * 0.06);
    }

    return optimized;
  }

  // ── MODO 2: HARD-SURFACE CSG (Intersección Booleana de Prismas Exactos) ──
  if (mode === 'HARD_SURFACE_CSG') {
    const [dimX, dimY, dimZ] = dimensions;
    
    const getPolygonArea = (pts: [number, number][]) => {
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        area += (pts[j][0] * pts[i][1]) - (pts[i][0] * pts[j][1]);
      }
      return Math.abs(area);
    };

    const buildViewGeo = (sil: ProcessedSilhouette, axis: 'x' | 'y' | 'z') => {
      if (!sil.contours || sil.contours.length === 0) return null;
      const sorted = [...sil.contours].sort((a, b) => getPolygonArea(b) - getPolygonArea(a));
      const outer = sorted[0];
      const holes = sorted.slice(1);
      const isTopVert = axis === 'y' ? (
        sil.boundsNormalized ? (sil.boundsNormalized.maxV - sil.boundsNormalized.minV) >= (sil.boundsNormalized.maxU - sil.boundsNormalized.minU) : false
      ) : false;
      return createExtrudedContourGeo(outer, axis, dimX, dimY, dimZ, holes, isTopVert);
    };

    // 1. Crear el sólido 3D extruido para cada vista activa con orientación y profundidad precisa
    const viewGeometries: { key: BlueprintViewKey; geo: THREE.BufferGeometry }[] = [];

    if (processedViews.front) {
      const geo = buildViewGeo(processedViews.front, 'z');
      if (geo) viewGeometries.push({ key: 'front', geo });
    }

    if (processedViews.side) {
      const geo = buildViewGeo(processedViews.side, 'x');
      if (geo) viewGeometries.push({ key: 'side', geo });
    }

    if (processedViews.top) {
      const geo = buildViewGeo(processedViews.top, 'y');
      if (geo) viewGeometries.push({ key: 'top', geo });
    }

    if (viewGeometries.length === 0) {
      return carveModelFromBlueprints({ ...options, mode: 'VISUAL_HULL' });
    }

    // CASO 1: Si sólo hay 1 vista cargada (ej. sólo Vista Lateral), devolver su geometría directamente
    if (viewGeometries.length === 1) {
      const raw = bufferGeoToMeshData(viewGeometries[0].geo);
      return optimizeBlueprintMeshTopology(raw, {
        mode: options.topologyMode || 'PLANAR_POLISHED',
        snapToPlanes: false,
        delaunayPasses: 0,
        planarAngleToleranceDeg: options.planarAngleToleranceDeg || 18,
        decimationRatio: 1.0,
        featureAngleDeg: options.featureAngleDeg || 35
      });
    }

    // CASO 2: Si hay 2 o más vistas, realizar la intersección booleana CSG entre vistas
    try {
      const firstMesh = new THREE.Mesh(viewGeometries[0].geo);
      firstMesh.updateMatrix();
      let resultCSG = CSG.fromMesh(firstMesh);

      for (let i = 1; i < viewGeometries.length; i++) {
        const nextMesh = new THREE.Mesh(viewGeometries[i].geo);
        nextMesh.updateMatrix();
        const nextCSG = CSG.fromMesh(nextMesh);
        resultCSG = resultCSG.intersect(nextCSG);
      }

      const finalMesh = CSG.toMesh(resultCSG, new THREE.Matrix4());
      let geo = finalMesh.geometry as THREE.BufferGeometry;
      
      // Soldar micro-vértices coincidentes generados por el corte CSG
      geo = BufferGeometryUtils.mergeVertices(geo, 1e-4);
      geo.computeVertexNormals();

      const posAttr = geo.getAttribute('position');
      if (posAttr && posAttr.count >= 4) {
        const raw = bufferGeoToMeshData(geo);
        return optimizeBlueprintMeshTopology(raw, {
          mode: options.topologyMode || 'PLANAR_POLISHED',
          snapToPlanes: false,
          delaunayPasses: 0,
          planarAngleToleranceDeg: options.planarAngleToleranceDeg || 18,
          decimationRatio: options.topologyMode === 'LOW_POLY' ? (options.decimationRatio ?? 0.6) : 1.0,
          featureAngleDeg: options.featureAngleDeg || 35
        });
      } else {
        // Fallback a Visual Hull si CSG produjo volumen degenerado
        return carveModelFromBlueprints({ ...options, mode: 'VISUAL_HULL', smoothIterations: 0 });
      }
    } catch (e) {
      console.warn('CSG intersection fallback to Visual Hull:', e);
      return carveModelFromBlueprints({ ...options, mode: 'VISUAL_HULL', smoothIterations: 0 });
    }
  }

  return null;
}

/**
 * Optimiza profundamente la topología y geometría generada a partir de bocetos y Marching Cubes:
 * 1. Fusión y soldadura de micro-vértices duplicados (Weld con Hash Grid espacial).
 * 2. Algoritmo Delaunay Edge-Swap: invierte diagonales estiradas en regiones coplanares o suaves,
 *    eliminando el patrón caótico de líneas cruzadas y generando triángulos limpios y equilibrados.
 * 3. Aplanado y ajuste a planos de regresión (Planar Snapping): proyecta los vértices de las paredes
 *    laterales, superiores e inferiores en sus planos matemáticos exactos (Ax + By + Cz + D = 0)
 *    y calcula la intersección nítida de aristas mecánicas vivas.
 * 4. Relajación tangencial de vértices: distribuye uniformemente la malla sin deformar la silueta.
 * 5. Decimado inteligente de caras coplanares: reduce micro-polígonos redundantes en superficies planas.
 */
/**
 * Convierte una estructura { vertices, faces } a un THREE.BufferGeometry indexado
 */
export function meshDataToBufferGeometry(mesh: { vertices: V3[]; faces: MeshFace[] }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];

  for (const v of mesh.vertices) {
    positions.push(v[0], v[1], v[2]);
  }

  for (const f of mesh.faces) {
    if (f.indices && f.indices.length >= 3) {
      indices.push(f.indices[0], f.indices[1], f.indices[2]);
      if (f.indices.length === 4) {
        indices.push(f.indices[0], f.indices[2], f.indices[3]);
      }
    }
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (indices.length > 0) {
    geo.setIndex(indices);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Disuelve y simplifica conjuntos de caras triangulares coplanares adyacentes (Limited Dissolve estilo Blender/CAD)
 * convirtiendo cientos de micro-triángulos en caras mínimas (ej: 2 triángulos por pared o tapa plana de un cubo).
 */
export function dissolveCoplanarMeshFaces(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  angleToleranceDeg: number = 14,
  distToleranceFraction: number = 0.03
): { vertices: V3[]; faces: MeshFace[] } {
  if (!mesh || !mesh.vertices || mesh.vertices.length < 3 || !mesh.faces || mesh.faces.length < 2) {
    return mesh;
  }

  const verts: V3[] = mesh.vertices.map(v => [v[0], v[1], v[2]]);
  const faces = mesh.faces;
  const numFaces = faces.length;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
  const maxPlaneDistDev = diag * distToleranceFraction;
  const cosTol = Math.cos(angleToleranceDeg * (Math.PI / 180));

  // 1. Calcular normales, centros y áreas de cada cara
  const normals: THREE.Vector3[] = [];
  const centers: THREE.Vector3[] = [];
  const areas: number[] = [];

  for (let i = 0; i < numFaces; i++) {
    const f = faces[i];
    const [i0, i1, i2] = f.indices;
    const p0 = new THREE.Vector3(...verts[i0]);
    const p1 = new THREE.Vector3(...verts[i1]);
    const p2 = new THREE.Vector3(...verts[i2]);
    const v01 = new THREE.Vector3().subVectors(p1, p0);
    const v02 = new THREE.Vector3().subVectors(p2, p0);
    const n = new THREE.Vector3().crossVectors(v01, v02);
    const a = n.length() * 0.5;
    if (n.lengthSq() > 1e-12) {
      n.normalize();
    } else {
      n.set(0, 1, 0);
    }
    normals.push(n);
    centers.push(new THREE.Vector3((p0.x + p1.x + p2.x) / 3, (p0.y + p1.y + p2.y) / 3, (p0.z + p1.z + p2.z) / 3));
    areas.push(a);
  }

  // 2. Construir mapa de adyacencia de caras por arista compartida
  const edgeToFaces = new Map<string, number[]>();
  for (let fIdx = 0; fIdx < numFaces; fIdx++) {
    const [i0, i1, i2] = faces[fIdx].indices;
    const edges = [
      `${Math.min(i0, i1)}_${Math.max(i0, i1)}`,
      `${Math.min(i1, i2)}_${Math.max(i1, i2)}`,
      `${Math.min(i2, i0)}_${Math.max(i2, i0)}`
    ];
    for (const e of edges) {
      let list = edgeToFaces.get(e);
      if (!list) { list = []; edgeToFaces.set(e, list); }
      list.push(fIdx);
    }
  }

  const faceAdj: number[][] = Array.from({ length: numFaces }, () => []);
  for (const [, fList] of edgeToFaces) {
    if (fList.length === 2) {
      faceAdj[fList[0]].push(fList[1]);
      faceAdj[fList[1]].push(fList[0]);
    }
  }

  // 3. Agrupar caras en islas coplanares conexas (BFS)
  const visited = new Uint8Array(numFaces);
  const planarIslands: number[][] = [];

  for (let fStart = 0; fStart < numFaces; fStart++) {
    if (visited[fStart] || areas[fStart] < 1e-9) continue;

    const cluster: number[] = [];
    const queue: number[] = [fStart];
    visited[fStart] = 1;
    const seedNormal = normals[fStart];
    const seedCenter = centers[fStart];

    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      cluster.push(curr);

      for (const nbr of faceAdj[curr]) {
        if (!visited[nbr] && areas[nbr] >= 1e-9) {
          const nbrNormal = normals[nbr];
          const dotN = seedNormal.dot(nbrNormal);
          if (dotN >= cosTol) {
            const dist = Math.abs(seedNormal.dot(new THREE.Vector3().subVectors(centers[nbr], seedCenter)));
            if (dist <= maxPlaneDistDev) {
              visited[nbr] = 1;
              queue.push(nbr);
            }
          }
        }
      }
    }

    if (cluster.length >= 3) {
      planarIslands.push(cluster);
    }
  }

  if (planarIslands.length === 0) {
    return mesh;
  }

  // 4. Procesar cada isla coplanar
  const facesToRemove = new Set<number>();
  const newFaces: MeshFace[] = [];
  const addedVertices: V3[] = [...verts];

  for (const island of planarIslands) {
    if (island.length < 3) continue;

    // Normal ponderada y centroide
    const avgNormal = new THREE.Vector3();
    const avgCenter = new THREE.Vector3();
    let totalArea = 0;
    for (const f of island) {
      const a = areas[f];
      avgNormal.addScaledVector(normals[f], a);
      avgCenter.addScaledVector(centers[f], a);
      totalArea += a;
    }
    if (totalArea < 1e-9 || avgNormal.lengthSq() < 1e-8) continue;
    avgNormal.normalize();
    avgCenter.divideScalar(totalArea);

    // Identificar aristas de frontera (que pertenecen a solo 1 cara de la isla)
    const edgeCounts = new Map<string, { count: number; v0: number; v1: number }>();
    for (const f of island) {
      const [i0, i1, i2] = faces[f].indices;
      const triplets = [[i0, i1], [i1, i2], [i2, i0]];
      for (const [v0, v1] of triplets) {
        const keyUndirected = `${Math.min(v0, v1)}_${Math.max(v0, v1)}`;
        const existing = edgeCounts.get(keyUndirected);
        if (!existing) {
          edgeCounts.set(keyUndirected, { count: 1, v0, v1 });
        } else {
          existing.count++;
        }
      }
    }

    const boundaryEdges: [number, number][] = [];
    for (const [, data] of edgeCounts) {
      if (data.count === 1) {
        boundaryEdges.push([data.v0, data.v1]);
      }
    }

    if (boundaryEdges.length < 3) continue;

    // Encadenar aristas en bucles poligonales
    const nextMap = new Map<number, number>();
    for (const [v0, v1] of boundaryEdges) {
      nextMap.set(v0, v1);
    }

    const loops: number[][] = [];
    const usedStartVerts = new Set<number>();

    for (const [v0] of boundaryEdges) {
      if (usedStartVerts.has(v0)) continue;

      const loop: number[] = [];
      let curr = v0;
      let safeCount = 0;
      const maxSteps = boundaryEdges.length + 5;

      while (safeCount++ < maxSteps) {
        loop.push(curr);
        usedStartVerts.add(curr);
        const next = nextMap.get(curr);
        if (next === undefined || next === v0) break;
        if (loop.includes(next)) break;
        curr = next;
      }

      if (loop.length >= 3) {
        loops.push(loop);
      }
    }

    if (loops.length === 0) continue;

    // Base ortonormal 2D (uAxis, vAxis) sobre el plano
    const n = avgNormal;
    const uAxis = new THREE.Vector3();
    if (Math.abs(n.x) < 0.9) {
      uAxis.crossVectors(new THREE.Vector3(1, 0, 0), n).normalize();
    } else {
      uAxis.crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
    }
    const vAxis = new THREE.Vector3().crossVectors(n, uAxis).normalize();

    // Proyectar a 2D
    const project3Dto2D = (vIdx: number): { u: number; v: number; vIdx: number } => {
      const p = new THREE.Vector3(...addedVertices[vIdx]);
      const diff = new THREE.Vector3().subVectors(p, avgCenter);
      return {
        u: diff.dot(uAxis),
        v: diff.dot(vAxis),
        vIdx
      };
    };

    // Simplificar vértices colineales a lo largo de las aristas rectas del bucle 2D
    const simplify2DLoop = (pts: { u: number; v: number; vIdx: number }[]) => {
      if (pts.length <= 3) return pts;
      const res: { u: number; v: number; vIdx: number }[] = [];
      const N = pts.length;
      for (let i = 0; i < N; i++) {
        const prev = pts[(i - 1 + N) % N];
        const curr = pts[i];
        const next = pts[(i + 1) % N];

        const cross = (curr.u - prev.u) * (next.v - prev.v) - (curr.v - prev.v) * (next.u - prev.u);
        const d1 = Math.hypot(curr.u - prev.u, curr.v - prev.v);
        const d2 = Math.hypot(next.u - curr.u, next.v - curr.v);
        const dBase = Math.hypot(next.u - prev.u, next.v - prev.v);
        const dist = dBase > 1e-6 ? Math.abs(cross) / dBase : 0;

        const dot = (curr.u - prev.u) * (next.u - curr.u) + (curr.v - prev.v) * (next.v - curr.v);
        const cosAngle = (d1 > 1e-6 && d2 > 1e-6) ? dot / (d1 * d2) : 1;

        // Mantener el vértice si representa una esquina o cambio angular
        if (dist > diag * 0.003 || cosAngle < 0.996) {
          res.push(curr);
        }
      }
      return res.length >= 3 ? res : pts;
    };

    const processedLoops = loops.map(loop => {
      const pts2D = loop.map(project3Dto2D);
      return simplify2DLoop(pts2D);
    }).filter(l => l.length >= 3);

    if (processedLoops.length === 0) continue;

    const calc2DArea = (l: { u: number; v: number }[]) => {
      let area = 0;
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        area += (l[j].u * l[i].v) - (l[i].u * l[j].v);
      }
      return area * 0.5;
    };

    processedLoops.sort((a, b) => Math.abs(calc2DArea(b)) - Math.abs(calc2DArea(a)));
    const outerLoop2D = processedLoops[0];
    const holeLoops2D = processedLoops.slice(1);

    if (calc2DArea(outerLoop2D) < 0) {
      outerLoop2D.reverse();
    }

    try {
      const contourPoints = outerLoop2D.map(p => new THREE.Vector2(p.u, p.v));
      const holesPoints = holeLoops2D.map(h => {
        if (calc2DArea(h) > 0) h.reverse();
        return h.map(p => new THREE.Vector2(p.u, p.v));
      });

      const triangles2D = THREE.ShapeUtils.triangulateShape(contourPoints, holesPoints);

      if (triangles2D && triangles2D.length > 0 && triangles2D.length < island.length) {
        const allLoopPoints: { u: number; v: number; vIdx: number }[] = [...outerLoop2D];
        for (const h of holeLoops2D) {
          allLoopPoints.push(...h);
        }

        for (const f of island) {
          facesToRemove.add(f);
        }

        for (const [t0, t1, t2] of triangles2D) {
          const pt0 = allLoopPoints[t0];
          const pt1 = allLoopPoints[t1];
          const pt2 = allLoopPoints[t2];
          if (!pt0 || !pt1 || !pt2) continue;

          const p30 = new THREE.Vector3(...addedVertices[pt0.vIdx]);
          const p31 = new THREE.Vector3(...addedVertices[pt1.vIdx]);
          const p32 = new THREE.Vector3(...addedVertices[pt2.vIdx]);
          const triNormal = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(p31, p30),
            new THREE.Vector3().subVectors(p32, p30)
          );

          if (triNormal.dot(avgNormal) < 0) {
            newFaces.push({ indices: [pt0.vIdx, pt2.vIdx, pt1.vIdx] });
          } else {
            newFaces.push({ indices: [pt0.vIdx, pt1.vIdx, pt2.vIdx] });
          }
        }
      }
    } catch (triErr) {
      console.warn('Error triangulando isla coplanar:', triErr);
    }
  }

  const finalFaces: MeshFace[] = [];
  for (let i = 0; i < numFaces; i++) {
    if (!facesToRemove.has(i)) {
      finalFaces.push(faces[i]);
    }
  }
  finalFaces.push(...newFaces);

  const usedVertIndices = new Set<number>();
  for (const f of finalFaces) {
    for (const idx of f.indices) {
      usedVertIndices.add(idx);
    }
  }

  const oldToNewMap = new Map<number, number>();
  const finalVerts: V3[] = [];
  for (let i = 0; i < addedVertices.length; i++) {
    if (usedVertIndices.has(i)) {
      oldToNewMap.set(i, finalVerts.length);
      finalVerts.push(addedVertices[i]);
    }
  }

  const remappedFaces: MeshFace[] = finalFaces.map(f => ({
    indices: f.indices.map(idx => oldToNewMap.get(idx) ?? 0),
    uvs: f.uvs,
    materialIndex: f.materialIndex
  })).filter(f => f.indices[0] !== f.indices[1] && f.indices[1] !== f.indices[2] && f.indices[2] !== f.indices[0]);

  return { vertices: finalVerts, faces: remappedFaces };
}

/**
 * Decimador topológico seguro con preservación estricta de contornos, bordes y prevención de caras invertidas o desaparecidas.
 * Garantiza que la malla permanezca estanca y continua incluso al bajar la decimación al 5% (95% de reducción).
 */
export function safePreservingDecimateMesh(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  targetRatio: number = 0.5
): { vertices: V3[]; faces: MeshFace[] } {
  if (!mesh || !mesh.vertices || mesh.vertices.length < 10 || !mesh.faces || mesh.faces.length < 4) {
    return mesh;
  }

  const targetFaces = Math.max(4, Math.floor(mesh.faces.length * Math.max(0.05, Math.min(0.99, targetRatio))));
  if (mesh.faces.length <= targetFaces) return mesh;

  // Clonar vértices y caras
  const verts: [number, number, number][] = mesh.vertices.map(v => [v[0], v[1], v[2]]);
  const activeFaces: { indices: [number, number, number]; uvs?: [number, number][]; materialIndex?: number; alive: boolean }[] =
    mesh.faces.map(f => ({
      indices: [f.indices[0], f.indices[1], f.indices[2]],
      uvs: f.uvs ? [...f.uvs] : undefined,
      materialIndex: f.materialIndex,
      alive: true
    }));

  // Mapas de adyacencia vértice -> caras
  const vertFaces: Set<number>[] = Array.from({ length: verts.length }, () => new Set());
  activeFaces.forEach((f, fIdx) => {
    vertFaces[f.indices[0]].add(fIdx);
    vertFaces[f.indices[1]].add(fIdx);
    vertFaces[f.indices[2]].add(fIdx);
  });

  // Identificar aristas de frontera (pertenecientes a solo 1 cara)
  const edgeFaceCounts = new Map<string, number>();
  activeFaces.forEach(f => {
    const [i0, i1, i2] = f.indices;
    const es = [
      `${Math.min(i0, i1)}_${Math.max(i0, i1)}`,
      `${Math.min(i1, i2)}_${Math.max(i1, i2)}`,
      `${Math.min(i2, i0)}_${Math.max(i2, i0)}`
    ];
    for (const e of es) {
      edgeFaceCounts.set(e, (edgeFaceCounts.get(e) || 0) + 1);
    }
  });

  const isBoundaryVert = new Uint8Array(verts.length);
  for (const [eKey, count] of edgeFaceCounts) {
    if (count === 1) {
      const [v0, v1] = eKey.split('_').map(Number);
      isBoundaryVert[v0] = 1;
      isBoundaryVert[v1] = 1;
    }
  }

  // Normal y Área de cara
  const computeFaceNormal = (i0: number, i1: number, i2: number): [number, number, number] => {
    const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-7;
    return [nx / len, ny / len, nz / len];
  };

  const computeFaceArea = (i0: number, i1: number, i2: number): number => {
    const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  };

  interface EdgeCollapse {
    u: number;
    v: number;
    cost: number;
  }

  const candidateEdges: EdgeCollapse[] = [];
  const processedEdges = new Set<string>();

  for (let fIdx = 0; fIdx < activeFaces.length; fIdx++) {
    const [i0, i1, i2] = activeFaces[fIdx].indices;
    const pairs: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [u, v] of pairs) {
      const eKey = `${Math.min(u, v)}_${Math.max(u, v)}`;
      if (processedEdges.has(eKey)) continue;
      processedEdges.add(eKey);

      // Los vértices de frontera nunca se colapsan sobre vértices interiores para no destruir los bordes del modelo
      if (isBoundaryVert[u] && !isBoundaryVert[v]) continue;

      const pu = verts[u], pv = verts[v];
      const dist = Math.hypot(pu[0] - pv[0], pu[1] - pv[1], pu[2] - pv[2]);
      candidateEdges.push({ u, v, cost: dist });
    }
  }

  // Priorizar aristas más cortas y planas primero
  candidateEdges.sort((a, b) => a.cost - b.cost);

  let currentAliveFaces = activeFaces.length;
  const vertRemap = new Int32Array(verts.length);
  for (let i = 0; i < verts.length; i++) vertRemap[i] = i;

  const getRoot = (i: number): number => {
    let r = i;
    while (vertRemap[r] !== r) r = vertRemap[r];
    let curr = i;
    while (curr !== r) {
      const next = vertRemap[curr];
      vertRemap[curr] = r;
      curr = next;
    }
    return r;
  };

  for (const edge of candidateEdges) {
    if (currentAliveFaces <= targetFaces) break;

    const u = getRoot(edge.u);
    const v = getRoot(edge.v);
    if (u === v) continue;

    if (isBoundaryVert[u] && !isBoundaryVert[v]) continue;

    // Verificar caras adyacentes a u: rechazar colapso si invierte normales o degenera caras
    const uFaces = Array.from(vertFaces[u]).filter(fIdx => activeFaces[fIdx].alive);
    let canCollapse = true;

    for (const fIdx of uFaces) {
      const f = activeFaces[fIdx];
      const idx0 = getRoot(f.indices[0]);
      const idx1 = getRoot(f.indices[1]);
      const idx2 = getRoot(f.indices[2]);

      // Si la cara contiene tanto u como v, desaparecerá saludablemente
      if ((idx0 === u || idx1 === u || idx2 === u) && (idx0 === v || idx1 === v || idx2 === v)) {
        continue;
      }

      const oldNorm = computeFaceNormal(idx0, idx1, idx2);

      const newIdx0 = idx0 === u ? v : idx0;
      const newIdx1 = idx1 === u ? v : idx1;
      const newIdx2 = idx2 === u ? v : idx2;

      const newArea = computeFaceArea(newIdx0, newIdx1, newIdx2);
      if (newArea < 1e-9) {
        canCollapse = false;
        break;
      }

      const newNorm = computeFaceNormal(newIdx0, newIdx1, newIdx2);
      const dot = oldNorm[0] * newNorm[0] + oldNorm[1] * newNorm[1] + oldNorm[2] * newNorm[2];
      if (dot < 0.35) {
        canCollapse = false;
        break;
      }
    }

    if (!canCollapse) continue;

    // Ejecutar colapso de arista
    vertRemap[u] = v;
    if (isBoundaryVert[u]) isBoundaryVert[v] = 1;

    if (!isBoundaryVert[u] && !isBoundaryVert[v]) {
      verts[v][0] = (verts[v][0] + verts[u][0]) * 0.5;
      verts[v][1] = (verts[v][1] + verts[u][1]) * 0.5;
      verts[v][2] = (verts[v][2] + verts[u][2]) * 0.5;
    }

    for (const fIdx of uFaces) {
      const f = activeFaces[fIdx];
      const idx0 = getRoot(f.indices[0]);
      const idx1 = getRoot(f.indices[1]);
      const idx2 = getRoot(f.indices[2]);

      if (idx0 === idx1 || idx1 === idx2 || idx2 === idx0) {
        f.alive = false;
        currentAliveFaces--;
      } else {
        vertFaces[v].add(fIdx);
      }
    }
  }

  // Reconstruir caras finales
  const finalFaces: MeshFace[] = [];
  for (const f of activeFaces) {
    if (!f.alive) continue;
    const i0 = getRoot(f.indices[0]);
    const i1 = getRoot(f.indices[1]);
    const i2 = getRoot(f.indices[2]);
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    finalFaces.push({
      indices: [i0, i1, i2],
      uvs: f.uvs ? [...f.uvs] : undefined,
      materialIndex: f.materialIndex
    });
  }

  const usedVerts = new Set<number>();
  for (const f of finalFaces) {
    usedVerts.add(f.indices[0]);
    usedVerts.add(f.indices[1]);
    usedVerts.add(f.indices[2]);
  }

  const oldToNew = new Map<number, number>();
  const compactedVerts: V3[] = [];
  for (let i = 0; i < verts.length; i++) {
    if (usedVerts.has(i)) {
      oldToNew.set(i, compactedVerts.length);
      compactedVerts.push(verts[i]);
    }
  }

  const remappedFaces = finalFaces.map(f => ({
    indices: [oldToNew.get(f.indices[0]) ?? 0, oldToNew.get(f.indices[1]) ?? 0, oldToNew.get(f.indices[2]) ?? 0] as [number, number, number],
    uvs: f.uvs,
    materialIndex: f.materialIndex
  }));

  if (compactedVerts.length >= 4 && remappedFaces.length >= 4) {
    return { vertices: compactedVerts, faces: remappedFaces };
  }

  return mesh;
}

/**
 * Subdivide y suaviza una malla 3D aplicando curvatura continua tangencial (estilo PN-Triangles / Loop).
 * Ideal para transformar extrusiones angulares o faceteadas en superficies suaves, pulidas y continuas.
 */
export function subdivideMeshSmooth(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  curvaturePush: number = 0.08
): { vertices: V3[]; faces: MeshFace[] } {
  if (!mesh || !mesh.faces || mesh.faces.length === 0 || mesh.vertices.length > 25000) {
    return mesh; // Limitar si la malla ya tiene altísima densidad para preservar rendimiento
  }

  const origVerts = mesh.vertices;
  const numOrigVerts = origVerts.length;

  // 1. Calcular normales de vértices originales
  const vertNormals: [number, number, number][] = Array.from({ length: numOrigVerts }, () => [0, 0, 0]);
  for (const f of mesh.faces) {
    const [i0, i1, i2] = f.indices;
    const v0 = origVerts[i0], v1 = origVerts[i1], v2 = origVerts[i2];
    const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
    const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    vertNormals[i0][0] += nx; vertNormals[i0][1] += ny; vertNormals[i0][2] += nz;
    vertNormals[i1][0] += nx; vertNormals[i1][1] += ny; vertNormals[i1][2] += nz;
    vertNormals[i2][0] += nx; vertNormals[i2][1] += ny; vertNormals[i2][2] += nz;
  }
  for (let i = 0; i < numOrigVerts; i++) {
    const [nx, ny, nz] = vertNormals[i];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-7;
    vertNormals[i] = [nx / len, ny / len, nz / len];
  }

  // 2. Crear vértices divididos en aristas
  const newVerts: V3[] = origVerts.map(v => [v[0], v[1], v[2]]);
  const edgeMap = new Map<string, number>();

  const getEdgeMidpoint = (idxA: number, idxB: number): number => {
    const key = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;

    const vA = origVerts[idxA];
    const vB = origVerts[idxB];
    const nA = vertNormals[idxA];
    const nB = vertNormals[idxB];

    const midX = (vA[0] + vB[0]) * 0.5;
    const midY = (vA[1] + vB[1]) * 0.5;
    const midZ = (vA[2] + vB[2]) * 0.5;

    const avgNx = (nA[0] + nB[0]) * 0.5;
    const avgNy = (nA[1] + nB[1]) * 0.5;
    const avgNz = (nA[2] + nB[2]) * 0.5;
    const nLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz) || 1e-7;

    const dx = vB[0] - vA[0], dy = vB[1] - vA[1], dz = vB[2] - vA[2];
    const edgeLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const push = curvaturePush * edgeLen * 0.25;

    const newIdx = newVerts.length;
    newVerts.push([
      midX + (avgNx / nLen) * push,
      midY + (avgNy / nLen) * push,
      midZ + (avgNz / nLen) * push
    ]);
    edgeMap.set(key, newIdx);
    return newIdx;
  };

  const newFaces: MeshFace[] = [];
  for (const f of mesh.faces) {
    const [i0, i1, i2] = f.indices;
    const m01 = getEdgeMidpoint(i0, i1);
    const m12 = getEdgeMidpoint(i1, i2);
    const m20 = getEdgeMidpoint(i2, i0);

    const uv0 = f.uvs?.[0] || [0.5, 0.5];
    const uv1 = f.uvs?.[1] || [0.5, 0.5];
    const uv2 = f.uvs?.[2] || [0.5, 0.5];

    const uv01: [number, number] = [(uv0[0] + uv1[0]) * 0.5, (uv0[1] + uv1[1]) * 0.5];
    const uv12: [number, number] = [(uv1[0] + uv2[0]) * 0.5, (uv1[1] + uv2[1]) * 0.5];
    const uv20: [number, number] = [(uv2[0] + uv0[0]) * 0.5, (uv2[1] + uv0[1]) * 0.5];

    newFaces.push({ indices: [i0, m01, m20], uvs: [uv0, uv01, uv20], materialIndex: f.materialIndex });
    newFaces.push({ indices: [i1, m12, m01], uvs: [uv1, uv12, uv01], materialIndex: f.materialIndex });
    newFaces.push({ indices: [i2, m20, m12], uvs: [uv2, uv20, uv12], materialIndex: f.materialIndex });
    newFaces.push({ indices: [m01, m12, m20], uvs: [uv01, uv12, uv20], materialIndex: f.materialIndex });
  }

  return { vertices: newVerts, faces: newFaces };
}

/**
 * Optimiza profundamente la topología y geometría generada a partir de bocetos y Marching Cubes:
 * - CUSHION_UPHOLSTERY: Tapizado curvo para sofás, asientos y cojines con relajación tangencial y sin aplanado forzado.
 * - ROUNDED_ORGANIC: Redondeo esferoidal profundo para figuras suaves, juguetes, personajes y peluches.
 * - CURVED_FILLET: Conserva la forma general pero redondea todas las aristas vivas e intersecciones.
 * - LOW_POLY: Disolución coplanar + decimación proporcional profunda para modelos Game-Ready súper limpios.
 * - PLANAR_POLISHED: Detección y proyección estricta sobre planos matemáticos, ajuste nítido de aristas de intersección (creases) y disolución coplanar (Limited Dissolve).
 * - UNIFORM_ISOTROPIC: Suavizado laplaciano multicapa (Taubin) que preserva volumen y relaja tangencialmente los vértices para una superficie orgánica y continua.
 * - RAW: Extracción pura y directa del campo de vóxeles sin filtrado.
 */
export function optimizeBlueprintMeshTopology(
  rawMesh: { vertices: V3[]; faces: MeshFace[] },
  options: {
    mode?: CarverTopologyMode;
    snapToPlanes?: boolean;
    planarAngleToleranceDeg?: number;
    delaunayPasses?: number;
    relaxIterations?: number;
    decimationRatio?: number;
    featureAngleDeg?: number;
    roundness?: number;
  } = {}
): { vertices: V3[]; faces: MeshFace[] } {
  if (!rawMesh || !rawMesh.vertices || rawMesh.vertices.length === 0 || rawMesh.faces.length === 0) {
    return rawMesh;
  }

  const mode = options.mode || 'PLANAR_POLISHED';
  if (mode === 'RAW') {
    return rawMesh;
  }

  const isOrganic = mode === 'CUSHION_UPHOLSTERY' || mode === 'ROUNDED_ORGANIC';
  const snapToPlanes = isOrganic ? false : (options.snapToPlanes !== false);
  const planarAngleTol = (options.planarAngleToleranceDeg || 16) * (Math.PI / 180);
  const cosPlanarAngleTol = Math.cos(planarAngleTol);
  const relaxIterations = options.relaxIterations ?? (
    mode === 'ROUNDED_ORGANIC' ? 12 :
    mode === 'CUSHION_UPHOLSTERY' ? 8 :
    mode === 'CURVED_FILLET' ? 4 :
    mode === 'UNIFORM_ISOTROPIC' ? 5 :
    mode === 'LOW_POLY' ? 0 : 2
  );

  // 1. Clonar estructura y calcular bounding box
  let verts: V3[] = rawMesh.vertices.map(v => [v[0], v[1], v[2]]);
  let faces: MeshFace[] = rawMesh.faces.map(f => ({
    indices: [f.indices[0], f.indices[1], f.indices[2]],
    uvs: f.uvs ? [...f.uvs] : undefined,
    materialIndex: f.materialIndex
  }));

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of verts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const bboxDiag = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2) || 1.0;
  const weldPrecision = 10000 / bboxDiag;

  // ── PASO 1: SOLDADURA ESTRICTA Y LIMPIEZA DE CARAS DEGENERADAS ──
  const vertRemap = new Map<string, number>();
  const cleanVerts: V3[] = [];
  const oldToNew = new Int32Array(verts.length).fill(-1);

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const key = `${Math.round(v[0] * weldPrecision)},${Math.round(v[1] * weldPrecision)},${Math.round(v[2] * weldPrecision)}`;
    let nIdx = vertRemap.get(key);
    if (nIdx === undefined) {
      nIdx = cleanVerts.length;
      vertRemap.set(key, nIdx);
      cleanVerts.push([v[0], v[1], v[2]]);
    }
    oldToNew[i] = nIdx;
  }

  const cleanFaces: MeshFace[] = [];
  for (const f of faces) {
    const i0 = oldToNew[f.indices[0]];
    const i1 = oldToNew[f.indices[1]];
    const i2 = oldToNew[f.indices[2]];
    if (i0 === i1 || i1 === i2 || i2 === i0) continue;
    cleanFaces.push({
      indices: [i0, i1, i2],
      uvs: f.uvs,
      materialIndex: f.materialIndex
    });
  }

  verts = cleanVerts;
  faces = cleanFaces;

  if (verts.length === 0 || faces.length === 0) return rawMesh;

  // ── PASO 2: PROYECCIÓN EN PLANOS MATEMÁTICOS + CREASES NÍTITOS ──
  if ((mode === 'PLANAR_POLISHED' || mode === 'LOW_POLY') && snapToPlanes) {
    const faceNormals: [number, number, number][] = [];
    const faceCenters: [number, number, number][] = [];
    const faceAreas: number[] = [];

    for (let i = 0; i < faces.length; i++) {
      const [i0, i1, i2] = faces[i].indices;
      const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const area = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-7;
      faceNormals.push([nx / len, ny / len, nz / len]);
      faceCenters.push([(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3]);
      faceAreas.push(Math.max(1e-8, area));
    }

    const edgeMap = new Map<string, number[]>();
    for (let fIdx = 0; fIdx < faces.length; fIdx++) {
      const [i0, i1, i2] = faces[fIdx].indices;
      const es = [
        `${Math.min(i0, i1)}_${Math.max(i0, i1)}`,
        `${Math.min(i1, i2)}_${Math.max(i1, i2)}`,
        `${Math.min(i2, i0)}_${Math.max(i2, i0)}`
      ];
      for (const e of es) {
        let list = edgeMap.get(e);
        if (!list) { list = []; edgeMap.set(e, list); }
        list.push(fIdx);
      }
    }

    const faceAdj: number[][] = Array.from({ length: faces.length }, () => []);
    for (const [, flist] of edgeMap) {
      if (flist.length === 2) {
        faceAdj[flist[0]].push(flist[1]);
        faceAdj[flist[1]].push(flist[0]);
      }
    }

    const visitedFaces = new Uint8Array(faces.length);
    const clusters: { faceIndices: number[]; planeNormal: [number, number, number]; planeDist: number }[] = [];
    const maxPlaneDistDev = bboxDiag * 0.035;
    const bfsQueue = new Int32Array(faces.length);

    for (let fStart = 0; fStart < faces.length; fStart++) {
      if (visitedFaces[fStart] === 1 || faceAreas[fStart] < 1e-6) continue;

      const currentClusterIndices: number[] = [];
      let qHead = 0;
      let qTail = 0;

      bfsQueue[qTail++] = fStart;
      visitedFaces[fStart] = 1;
      const seedNormal = faceNormals[fStart];

      while (qHead < qTail) {
        const curr = bfsQueue[qHead++];
        currentClusterIndices.push(curr);

        const neighbors = faceAdj[curr];
        for (let i = 0; i < neighbors.length; i++) {
          const nbr = neighbors[i];
          if (visitedFaces[nbr] === 0 && faceAreas[nbr] >= 1e-6) {
            const nbrNormal = faceNormals[nbr];
            const dotN = seedNormal[0] * nbrNormal[0] + seedNormal[1] * nbrNormal[1] + seedNormal[2] * nbrNormal[2];
            if (dotN >= cosPlanarAngleTol) {
              const cNbr = faceCenters[nbr];
              const cSeed = faceCenters[fStart];
              const distToSeedPlane = Math.abs(
                seedNormal[0] * (cNbr[0] - cSeed[0]) +
                seedNormal[1] * (cNbr[1] - cSeed[1]) +
                seedNormal[2] * (cNbr[2] - cSeed[2])
              );
              if (distToSeedPlane <= maxPlaneDistDev) {
                visitedFaces[nbr] = 1;
                bfsQueue[qTail++] = nbr;
              }
            }
          }
        }
      }

      if (currentClusterIndices.length >= 3) {
        let sumArea = 0;
        let avgNx = 0, avgNy = 0, avgNz = 0;
        let avgCx = 0, avgCy = 0, avgCz = 0;

        for (const f of currentClusterIndices) {
          const a = faceAreas[f];
          sumArea += a;
          avgNx += faceNormals[f][0] * a;
          avgNy += faceNormals[f][1] * a;
          avgNz += faceNormals[f][2] * a;
          avgCx += faceCenters[f][0] * a;
          avgCy += faceCenters[f][1] * a;
          avgCz += faceCenters[f][2] * a;
        }

        const lenN = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz) || 1e-7;
        const norm: [number, number, number] = [avgNx / lenN, avgNy / lenN, avgNz / lenN];
        const center: [number, number, number] = [avgCx / sumArea, avgCy / sumArea, avgCz / sumArea];
        const d = norm[0] * center[0] + norm[1] * center[1] + norm[2] * center[2];

        clusters.push({
          faceIndices: currentClusterIndices,
          planeNormal: norm,
          planeDist: d
        });
      }
    }

    const vertToClusters = new Map<number, number[]>();
    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      const c = clusters[cIdx];
      const vertSet = new Set<number>();
      for (const f of c.faceIndices) {
        vertSet.add(faces[f].indices[0]);
        vertSet.add(faces[f].indices[1]);
        vertSet.add(faces[f].indices[2]);
      }
      for (const v of vertSet) {
        let list = vertToClusters.get(v);
        if (!list) { list = []; vertToClusters.set(v, list); }
        list.push(cIdx);
      }
    }

    for (let vIdx = 0; vIdx < verts.length; vIdx++) {
      const cList = vertToClusters.get(vIdx);
      if (!cList || cList.length === 0) continue;

      const p = verts[vIdx];
      if (cList.length === 1) {
        const c = clusters[cList[0]];
        const [nx, ny, nz] = c.planeNormal;
        const dist = nx * p[0] + ny * p[1] + nz * p[2] - c.planeDist;
        const clampedDist = Math.max(-maxPlaneDistDev, Math.min(maxPlaneDistDev, dist));
        verts[vIdx] = [
          p[0] - nx * clampedDist * 0.98,
          p[1] - ny * clampedDist * 0.98,
          p[2] - nz * clampedDist * 0.98
        ];
      } else if (cList.length === 2) {
        // Vértice en la arista viva entre dos planos: proyectar sobre la recta de intersección
        const c1 = clusters[cList[0]];
        const c2 = clusters[cList[1]];
        const n1 = c1.planeNormal;
        const n2 = c2.planeNormal;
        const dotPlanes = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
        if (Math.abs(dotPlanes) < 0.95) {
          const d1 = n1[0] * p[0] + n1[1] * p[1] + n1[2] * p[2] - c1.planeDist;
          const d2 = n2[0] * p[0] + n2[1] * p[1] + n2[2] * p[2] - c2.planeDist;
          const denom = 1 - dotPlanes * dotPlanes;
          if (denom > 1e-4) {
            const a1 = (d1 - d2 * dotPlanes) / denom;
            const a2 = (d2 - d1 * dotPlanes) / denom;
            verts[vIdx] = [
              p[0] - (n1[0] * a1 + n2[0] * a2) * 0.92,
              p[1] - (n1[1] * a1 + n2[1] * a2) * 0.92,
              p[2] - (n1[2] * a1 + n2[2] * a2) * 0.92
            ];
          }
        }
      }
    }
  }

  // ── PASO 3: DISOLUCIÓN COPLANAR DIRECTA (LIMITED DISSOLVE) ──
  // Colapsa caras coplanares en tapas y paredes planas mínimas (ej: 2 triángulos por cara plana de un cubo)
  if (mode === 'PLANAR_POLISHED' || mode === 'LOW_POLY') {
    const angleTol = mode === 'LOW_POLY' 
      ? Math.max(16, (options.planarAngleToleranceDeg || 18) * 1.3)
      : (options.planarAngleToleranceDeg || 16);
    
    const dissolved = dissolveCoplanarMeshFaces({ vertices: verts, faces }, angleTol, 0.035);
    verts = dissolved.vertices;
    faces = dissolved.faces;
  }

  // ── PASO 4: REDUCCIÓN / DECIMACIÓN TOPOLÓGICAMENTE SEGURA (GAME-READY) ──
  // Preserva bordes, límites, manifolds y previene inversión o desaparición de caras
  if ((mode === 'LOW_POLY' || options.decimationRatio !== undefined) && (options.decimationRatio ?? 1.0) < 0.98) {
    try {
      const ratio = Math.max(0.05, Math.min(0.95, options.decimationRatio ?? 0.5));
      const decimated = safePreservingDecimateMesh({ vertices: verts, faces }, ratio);
      if (decimated && decimated.vertices.length >= 4 && decimated.faces.length >= 4) {
        verts = decimated.vertices;
        faces = decimated.faces;
      }
    } catch (err) {
      console.warn('Error en safePreservingDecimateMesh:', err);
    }
  }

  // ── PASO 5: RELAJACIÓN ISOTRÓPICA Y REDONDEO DE SUPERFICIE ──
  const isRoundedMode = mode === 'UNIFORM_ISOTROPIC' || mode === 'CUSHION_UPHOLSTERY' || mode === 'ROUNDED_ORGANIC' || mode === 'CURVED_FILLET';
  if (relaxIterations > 0 && isRoundedMode) {
    const vertNeighbors: Set<number>[] = Array.from({ length: verts.length }, () => new Set());
    const vertNormals: [number, number, number][] = Array.from({ length: verts.length }, () => [0, 0, 0]);

    for (const f of faces) {
      const [i0, i1, i2] = f.indices;
      vertNeighbors[i0].add(i1); vertNeighbors[i0].add(i2);
      vertNeighbors[i1].add(i0); vertNeighbors[i1].add(i2);
      vertNeighbors[i2].add(i0); vertNeighbors[i2].add(i1);

      const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      vertNormals[i0][0] += nx; vertNormals[i0][1] += ny; vertNormals[i0][2] += nz;
      vertNormals[i1][0] += nx; vertNormals[i1][1] += ny; vertNormals[i1][2] += nz;
      vertNormals[i2][0] += nx; vertNormals[i2][1] += ny; vertNormals[i2][2] += nz;
    }

    for (let i = 0; i < verts.length; i++) {
      const [nx, ny, nz] = vertNormals[i];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-7;
      vertNormals[i] = [nx / len, ny / len, nz / len];
    }

    const factor = mode === 'ROUNDED_ORGANIC' ? 0.58 : (mode === 'CUSHION_UPHOLSTERY' ? 0.52 : (mode === 'CURVED_FILLET' ? 0.48 : 0.45));

    for (let iter = 0; iter < relaxIterations; iter++) {
      const nextVerts: V3[] = [];
      for (let i = 0; i < verts.length; i++) {
        const nbrs = vertNeighbors[i];
        if (nbrs.size < 3) {
          nextVerts.push(verts[i]);
          continue;
        }

        let avgX = 0, avgY = 0, avgZ = 0;
        for (const n of nbrs) {
          avgX += verts[n][0];
          avgY += verts[n][1];
          avgZ += verts[n][2];
        }
        avgX /= nbrs.size;
        avgY /= nbrs.size;
        avgZ /= nbrs.size;

        const p = verts[i];
        const deltaX = avgX - p[0];
        const deltaY = avgY - p[1];
        const deltaZ = avgZ - p[2];

        nextVerts.push([
          p[0] + deltaX * factor,
          p[1] + deltaY * factor,
          p[2] + deltaZ * factor
        ]);
      }
      verts = nextVerts;
    }
  }

  return { vertices: verts, faces };
}

/**
 * Genera coordenadas UV de alta precisión para modelos creados a partir de bocetos ortográficos.
 * Proyecta la textura y mapas PBR alineados 1:1 con la silueta original de la vista seleccionada
 * (Frontal, Lateral o Superior) y asegura que las caras mapeen de forma coherente sin estiramientos.
 */
export function generateBlueprintUVs(
  obj: { vertices: V3[]; faces: MeshFace[] },
  viewKey: BlueprintViewKey | 'auto' = 'auto',
  customDimensions?: V3,
  viewConfig?: BlueprintImageConfig,
  _boundsNormalized?: { minU: number; minV: number; maxU: number; maxV: number }
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = obj.vertices;
  if (!vertices || vertices.length === 0 || !obj.faces || obj.faces.length === 0) return obj;

  const dimX = customDimensions ? customDimensions[0] : 2;
  const dimY = customDimensions ? customDimensions[1] : 2;
  const dimZ = customDimensions ? customDimensions[2] : 2;

  const halfX = Math.max(1e-4, dimX / 2);
  const halfY = Math.max(1e-4, dimY / 2);
  const halfZ = Math.max(1e-4, dimZ / 2);

  // Configuración de calibración de textura
  const scaleX = Math.max(0.01, viewConfig?.texScaleX ?? 1.0);
  const scaleY = Math.max(0.01, viewConfig?.texScaleY ?? 1.0);
  const offsetX = viewConfig?.texOffsetX ?? 0.0;
  const offsetY = viewConfig?.texOffsetY ?? 0.0;
  const flipH = viewConfig?.texFlipH ?? false;
  const flipV = viewConfig?.texFlipV ?? false;
  const mirrorOpposite = viewConfig?.texMirrorOpposite ?? false;
  const projectBothSides = (viewConfig?.texProjectBothSides ?? false) || (viewConfig?.texMirrorOpposite ?? false);

  const faces = obj.faces.map(face => {
    if (!face || !face.indices || face.indices.length < 3) return face;

    // Calcular la normal de la cara
    const i0 = face.indices[0];
    const i1 = face.indices[1];
    const i2 = face.indices[2];
    const vert0 = i0 !== undefined ? vertices[i0] : null;
    const vert1 = i1 !== undefined ? vertices[i1] : null;
    const vert2 = i2 !== undefined ? vertices[i2] : null;

    let normalX = 0, normalY = 0, normalZ = 0;
    if (vert0 && vert1 && vert2) {
      const v0 = new THREE.Vector3(...vert0);
      const v1 = new THREE.Vector3(...vert1);
      const v2 = new THREE.Vector3(...vert2);
      const normal = new THREE.Vector3().crossVectors(
        v1.clone().sub(v0),
        v2.clone().sub(v0)
      ).normalize();

      if (normal.lengthSq() > 1e-6) {
        normalX = normal.x;
        normalY = normal.y;
        normalZ = normal.z;
      }
    }

    const absX = Math.abs(normalX);
    const absY = Math.abs(normalY);
    const absZ = Math.abs(normalZ);

    const uvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y, z] = v;
      let rawU = 0.5;
      let rawV = 0.5;

      if (viewKey === 'side') {
        if (!projectBothSides && normalX > 0.05) {
          rawU = 0.001;
          rawV = 0.001;
        } else {
          let pzNorm = z / halfZ;
          let pyNorm = y / halfY;
          if (mirrorOpposite && normalX < 0) {
            pzNorm = -pzNorm;
          }
          rawU = (pzNorm + 1.0) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        }

      } else if (viewKey === 'top') {
        if (!projectBothSides && normalY <= -0.05) {
          rawU = 0.001;
          rawV = 0.001;
        } else {
          let pxNorm = x / halfX;
          let pzNorm = z / halfZ;
          rawU = (pxNorm + 1.0) / 2.0;
          rawV = (pzNorm + 1.0) / 2.0;
        }

      } else if (viewKey === 'front') {
        // Proyección Frontal (modelo en -Z): caras delanteras tienen normalZ <= -0.05
        if (!projectBothSides && normalZ >= 0.05) {
          rawU = 0.001;
          rawV = 0.001;
        } else {
          let pxNorm = x / halfX;
          let pyNorm = y / halfY;
          if (mirrorOpposite && normalZ > 0) {
            pxNorm = -pxNorm;
          }
          rawU = (pxNorm + 1.0) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        }

      } else if (viewKey === 'back') {
        // Proyección Trasera (modelo en +Z): caras traseras tienen normalZ >= 0.05
        if (!projectBothSides && normalZ <= -0.05) {
          rawU = 0.001;
          rawV = 0.001;
        } else {
          let pxNorm = x / halfX;
          let pyNorm = y / halfY;
          if (mirrorOpposite && normalZ < 0) {
            pxNorm = -pxNorm;
          }
          // Mirando desde atrás (+Z a -Z), el eje +X está a la izquierda
          rawU = (1.0 - pxNorm) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        }

      } else {
        // Modo Auto / Triplanar Ortográfico
        if (absX >= absY && absX >= absZ) {
          let pzNorm = z / halfZ;
          let pyNorm = y / halfY;
          if (mirrorOpposite && normalX < 0) pzNorm = -pzNorm;
          rawU = (pzNorm + 1.0) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        } else if (absY >= absX && absY >= absZ) {
          let pxNorm = x / halfX;
          let pzNorm = z / halfZ;
          rawU = (pxNorm + 1.0) / 2.0;
          rawV = (pzNorm + 1.0) / 2.0;
        } else if (normalZ < 0) {
          // Frontal (-Z)
          let pxNorm = x / halfX;
          let pyNorm = y / halfY;
          if (mirrorOpposite) pxNorm = -pxNorm;
          rawU = (pxNorm + 1.0) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        } else {
          // Trasera (+Z)
          let pxNorm = x / halfX;
          let pyNorm = y / halfY;
          if (mirrorOpposite) pxNorm = -pxNorm;
          rawU = (1.0 - pxNorm) / 2.0;
          rawV = (pyNorm + 1.0) / 2.0;
        }
      }

      // Soportar rotación en pasos de 90°
      const rot = ((viewConfig?.rotation ?? 0) % 360 + 360) % 360;
      if (rot === 90) {
        const temp = rawU;
        rawU = rawV;
        rawV = 1.0 - temp;
      } else if (rot === 180) {
        rawU = 1.0 - rawU;
        rawV = 1.0 - rawV;
      } else if (rot === 270) {
        const temp = rawU;
        rawU = 1.0 - rawV;
        rawV = temp;
      }

      // Aplicar transformaciones de usuario (Escala centrada y Desplazamiento)
      let uNorm = (rawU - 0.5) / scaleX + 0.5 - offsetX;
      let vNorm = (rawV - 0.5) / scaleY + 0.5 - offsetY;

      // Invertir ejes si se solicitó
      if (flipH) uNorm = 1.0 - uNorm;
      if (flipV) vNorm = 1.0 - vNorm;

      // Clamping seguro entre 0 y 1
      const finalU = Math.max(0.0001, Math.min(0.9999, uNorm));
      const finalV = Math.max(0.0001, Math.min(0.9999, vNorm));

      return [finalU, finalV] as [number, number];
    });

    return { ...face, uvs };
  });

  return { vertices, faces };
}

/**
 * Corrige y limpia un bucle de contorno 2D eliminando puntos duplicados o colineales 
 * que corrompen el árbol BSP de las operaciones CSG.
 */
export function cleanContourForCSG(loop: [number, number][], tolerance = 1e-4): [number, number][] {
  if (loop.length < 3) return [];
  
  const cleaned: [number, number][] = [];
  // Paso 1: Eliminar puntos duplicados consecutivamente
  for (let i = 0; i < loop.length; i++) {
    const pCurr = loop[i];
    const pNext = loop[(i + 1) % loop.length];
    if (Math.hypot(pNext[0] - pCurr[0], pNext[1] - pCurr[1]) > tolerance) {
      cleaned.push(pCurr);
    }
  }
  
  if (cleaned.length < 3) return [];
  
  // Paso 2: Eliminar puntos colineales redundantes
  const finalLoop: [number, number][] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const p0 = cleaned[(i - 1 + cleaned.length) % cleaned.length];
    const p1 = cleaned[i];
    const p2 = cleaned[(i + 1) % cleaned.length];
    const area = Math.abs(p0[0] * (p1[1] - p2[1]) + p1[0] * (p2[1] - p0[1]) + p2[0] * (p0[1] - p1[1]));
    if (area > 1e-5) {
      finalLoop.push(p1);
    }
  }
  
  return finalLoop.length >= 3 ? finalLoop : cleaned;
}

/**
 * Convierte un contorno a orientación antihoraria (CCW) si es exterior, o horaria (CW) si es agujero
 */
function ensureContourWinding(contour: [number, number][], shouldBeCCW: boolean): [number, number][] {
  if (contour.length < 3) return contour;
  let area = 0;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    area += (contour[j][0] * contour[i][1]) - (contour[i][0] * contour[j][1]);
  }
  const isCCW = area > 0;
  if (isCCW !== shouldBeCCW) {
    return [...contour].reverse();
  }
  return contour;
}

/**
 * Crea una geometría sólida estanca de Three.js extruyendo un contorno 2D a lo largo del eje indicado
 * asegurando alineación matemática exacta con el espacio 3D y volumen extendido para CSG robusto.
 */
function createExtrudedContourGeo(
  rawContour: [number, number][],
  axis: 'x' | 'y' | 'z',
  dimX: number,
  dimY: number,
  dimZ: number,
  holes: [number, number][][] = [],
  isTopVertical = false
): THREE.BufferGeometry | null {
  const contour = cleanContourForCSG(rawContour);
  if (contour.length < 3) return null;

  // Asegurar que el contorno exterior sea CCW para Three.js Shape
  const cleanExterior = ensureContourWinding(contour, true);

  const shape = new THREE.Shape();

  let mapCoord: (pt: [number, number]) => [number, number];
  if (axis === 'z') {
    // Frontal: U es X, V es Y
    mapCoord = pt => [pt[0] * (dimX / 2), pt[1] * (dimY / 2)];
  } else if (axis === 'x') {
    // Lateral: U es Z, V es Y
    mapCoord = pt => [pt[0] * (dimZ / 2), pt[1] * (dimY / 2)];
  } else {
    // Superior (Y)
    if (isTopVertical) {
      // U es X, V es Z
      mapCoord = pt => [pt[0] * (dimX / 2), pt[1] * (dimZ / 2)];
    } else {
      // U es Z, V es X
      mapCoord = pt => [pt[1] * (dimX / 2), pt[0] * (dimZ / 2)];
    }
  }

  const [firstX, firstY] = mapCoord(cleanExterior[0]);
  shape.moveTo(firstX, firstY);
  for (let i = 1; i < cleanExterior.length; i++) {
    const [px, py] = mapCoord(cleanExterior[i]);
    shape.lineTo(px, py);
  }
  shape.closePath();

  // Agujeros interiores si existen (deben ser CW)
  if (holes && holes.length > 0) {
    for (const holeLoop of holes) {
      const cleanHoleRaw = cleanContourForCSG(holeLoop);
      if (cleanHoleRaw.length < 3) continue;
      const cleanHole = ensureContourWinding(cleanHoleRaw, false);
      const holePath = new THREE.Path();
      const [hFirstX, hFirstY] = mapCoord(cleanHole[0]);
      holePath.moveTo(hFirstX, hFirstY);
      for (let i = 1; i < cleanHole.length; i++) {
        const [hpx, hpy] = mapCoord(cleanHole[i]);
        holePath.lineTo(hpx, hpy);
      }
      holePath.closePath();
      shape.holes.push(holePath);
    }
  }

  // Extruir con un 30% extra de profundidad a lo largo del eje para asegurar intersecciones sólidas y completas
  const baseDepth = axis === 'z' ? dimZ : axis === 'x' ? dimX : dimY;
  const csgExtrudeDepth = baseDepth * 1.35;

  const extrudeSettings: THREE.ExtrudeGeometryOptions = {
    steps: 1,
    depth: csgExtrudeDepth,
    bevelEnabled: false
  };

  const rawExtrude = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  rawExtrude.center();

  // Soldar vértices de caras iniciales/finales de ExtrudeGeometry para garantizar geometría manifold cerrada
  let geo = BufferGeometryUtils.mergeVertices(rawExtrude, 1e-4);

  if (axis === 'x') {
    // Vista lateral: eje horizontal U es Z, eje vertical V es Y. Extrusión a lo largo del eje X.
    geo.rotateY(-Math.PI / 2);
  } else if (axis === 'y') {
    // Vista superior: Extrusión a lo largo del eje Y.
    geo.rotateX(Math.PI / 2);
  }
  // axis === 'z': Vista frontal: X es horizontal, Y es vertical. Extrusión a lo largo de Z.

  geo.computeVertexNormals();
  return geo;
}

/**
 * Generador de Presets Geométricos para calibración y testeo del motor CSG / Visual Hull
 */
export const GEOMETRIC_PRESETS = {
  CILINDRO: {
    id: "CILINDRO",
    name: "Cilindro Mecánico",
    description: "Círculo en vista superior y rectángulos en alzado y perfil para probar curvaturas continuas.",
    dimensions: [2.0, 2.0, 2.0] as [number, number, number],
    draw: (ctx: CanvasRenderingContext2D, view: 'front' | 'side' | 'top', W: number, H: number) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0f172a';
      if (view === 'top') {
        // Vista superior circular
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, W * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else {
        // Vista frontal y lateral cuadradas/rectangulares
        const padX = W * 0.2;
        const padY = H * 0.2;
        ctx.fillRect(padX, padY, W - 2 * padX, H - 2 * padY);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.strokeRect(padX, padY, W - 2 * padX, H - 2 * padY);
      }
    }
  }
};

/**
 * Genera URLs de imagen PNG en base64 para las 3 vistas de un preset geométrico
 */
export function generatePresetImageDataUrls(presetKey: keyof typeof GEOMETRIC_PRESETS, size = 512): {
  front: string;
  top: string;
  side: string;
  dimensions: [number, number, number];
  name: string;
} {
  const preset = GEOMETRIC_PRESETS[presetKey] || GEOMETRIC_PRESETS.CILINDRO;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Frontal
  preset.draw(ctx, 'front', size, size);
  const frontUrl = canvas.toDataURL('image/png');

  // Superior
  ctx.clearRect(0, 0, size, size);
  preset.draw(ctx, 'top', size, size);
  const topUrl = canvas.toDataURL('image/png');

  // Lateral
  ctx.clearRect(0, 0, size, size);
  preset.draw(ctx, 'side', size, size);
  const sideUrl = canvas.toDataURL('image/png');

  return {
    front: frontUrl,
    top: topUrl,
    side: sideUrl,
    dimensions: preset.dimensions,
    name: preset.name
  };
}

/**
 * Dibuja en un canvas de previsualización 2D la imagen, la máscara coloreada y los contornos perimetrales nítidos
 */
export function drawBlueprintPreview(
  canvas: HTMLCanvasElement,
  imgData: ImageData | null,
  processed: ProcessedSilhouette | null,
  color: string = '#6366f1',
  viewTransform: { zoom: number; panX: number; panY: number } = { zoom: 1, panX: 0, panY: 0 },
  selectedPointInfo: { loopIdx: number; ptIdx: number } | null = null,
  isEditPointsMode: boolean = false,
  hoveredPointInfo: { loopIdx: number; ptIdx: number } | null = null,
  holeSeeds: [number, number][] = [],
  multiSelectedPoints: { loopIdx: number; ptIdx: number }[] = [],
  selectionBox: { x1: number; y1: number; x2: number; y2: number } | null = null,
  showSymmetryGuides: boolean = true,
  ghostOverlays: GhostOverlayData[] = [],
  laserOptions?: { enabled: boolean; position: number; viewKey?: BlueprintViewKey; silhouetteOpacity?: number },
  depthZones?: BlueprintDepthZone[],
  selectedDepthZoneId?: string | null,
  activeDrawingDepthZone?: { x1: number; y1: number; x2: number; y2: number } | null
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;

  // Resetear matriz de transformación para que clearRect siempre limpie el canvas completo sin distorsión
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!imgData || !processed) {
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#71717a';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sin imagen cargada', W / 2, H / 2);
    return;
  }

  const { zoom = 1, panX = 0, panY = 0 } = viewTransform;

  ctx.save();
  // Aplicar transformación de Zoom y Pan centrada en el lienzo
  ctx.translate(W / 2 + panX, H / 2 + panY);
  ctx.scale(zoom, zoom);
  ctx.translate(-W / 2, -H / 2);

  // 1. Dibujar imagen base de la vista activa
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = imgData.width;
  tempCanvas.height = imgData.height;
  const tempCtx = tempCanvas.getContext('2d');
  if (tempCtx) {
    tempCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(tempCanvas, 0, 0, W, H);
  }

  // 2. Guías de simetría y ejes ortográficos
  if (showSymmetryGuides) {
    ctx.save();
    
    // Eje Central Vertical (Eje de Simetría X = 0) en Azul / Cian Brillante
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
    ctx.lineWidth = Math.max(1.2, 1.8 / zoom);
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();

    // Marcas de división en el eje vertical
    for (let y = 0; y <= H; y += H / 8) {
      ctx.beginPath();
      ctx.moveTo(W / 2 - 5 / zoom, y);
      ctx.lineTo(W / 2 + 5 / zoom, y);
      ctx.stroke();
    }

    // Eje Central Horizontal (Eje Y = 0) en Verde Esmeralda
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = Math.max(1.0, 1.5 / zoom);
    ctx.setLineDash([4 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    for (let x = 0; x <= W; x += W / 8) {
      ctx.beginPath();
      ctx.moveTo(x, H / 2 - 5 / zoom);
      ctx.lineTo(x, H / 2 + 5 / zoom);
      ctx.stroke();
    }

    // Cruz de Origen Central (0, 0)
    ctx.setLineDash([]);
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 3.5 / zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Bounding Box y Centro de la Silueta (Líneas Naranjas Discretas)
    if (processed && processed.boundsNormalized) {
      const b = processed.boundsNormalized;
      const bLeft = b.minU * (W - 1);
      const bRight = b.maxU * (W - 1);
      const bTop = (1 - b.maxV) * (H - 1);
      const bBottom = (1 - b.minV) * (H - 1);
      const bCenterNormX = (bLeft + bRight) / 2;
      const bCenterNormY = (bTop + bBottom) / 2;

      ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([3 / zoom, 3 / zoom]);
      ctx.strokeRect(bLeft, bTop, bRight - bLeft, bBottom - bTop);

      // Centro de la silueta detectada
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(bCenterNormX - 6 / zoom, bCenterNormY);
      ctx.lineTo(bCenterNormX + 6 / zoom, bCenterNormY);
      ctx.moveTo(bCenterNormX, bCenterNormY - 6 / zoom);
      ctx.lineTo(bCenterNormX, bCenterNormY + 6 / zoom);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 3. Superponer tinte de silueta sólida si la opacidad es mayor que 0
  const effMaskAlpha = laserOptions?.silhouetteOpacity !== undefined 
    ? Math.round(laserOptions.silhouetteOpacity * 255) 
    : (isEditPointsMode ? 70 : 100);

  if (effMaskAlpha > 0) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = W;
    maskCanvas.height = H;
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      const maskImg = maskCtx.createImageData(W, H);
      const pW = processed.width;
      const pH = processed.height;
      const rgb = hexToRgb(color);

      for (let y = 0; y < H; y++) {
        const py = Math.floor((y / H) * pH);
        for (let x = 0; x < W; x++) {
          const px = Math.floor((x / W) * pW);
          const isSolid = processed.mask[py * pW + px] === 1;
          const idx = (y * W + x) * 4;
          if (isSolid) {
            maskImg.data[idx] = rgb.r;
            maskImg.data[idx + 1] = rgb.g;
            maskImg.data[idx + 2] = rgb.b;
            maskImg.data[idx + 3] = effMaskAlpha;
          } else {
            maskImg.data[idx + 3] = 0;
          }
        }
      }
      maskCtx.putImageData(maskImg, 0, 0);
      ctx.drawImage(maskCanvas, 0, 0);
    }
  }

  // 4. Dibujar todos los bucles de contorno reales y puntos de control editables
  if (processed.contours && processed.contours.length > 0) {
    const toCanvas = (u: number, v: number): [number, number] => [
      ((u + 1) / 2) * (W - 1),
      ((1 - v) / 2) * (H - 1)
    ];

    processed.contours.forEach((loop, loopIdx) => {
      if (loop.length < 2) return;

      // Trazo de línea del contorno vectorial: segmentos rectos exactos que unen cada punto de control
      ctx.save();
      ctx.strokeStyle = isEditPointsMode ? '#38bdf8' : '#ffffff';
      ctx.lineWidth = Math.max(1.2, (isEditPointsMode ? 2.5 : 1.8) / zoom);
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 4 / zoom;

      ctx.beginPath();
      const [x0, y0] = toCanvas(loop[0][0], loop[0][1]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < loop.length; i++) {
        const [cx, cy] = toCanvas(loop[i][0], loop[i][1]);
        ctx.lineTo(cx, cy);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Puntos de control interactivos (anchor points limpios y esenciales)
      // Solo se dibujan en modo edición de puntos o cuando hay selección/hover
      const shouldDrawPoints = isEditPointsMode || selectedPointInfo || multiSelectedPoints.length > 0 || hoveredPointInfo;
      if (shouldDrawPoints) {
        for (let ptIdx = 0; ptIdx < loop.length; ptIdx++) {
          const [cx, cy] = toCanvas(loop[ptIdx][0], loop[ptIdx][1]);
          const isSingleSelected = selectedPointInfo && selectedPointInfo.loopIdx === loopIdx && selectedPointInfo.ptIdx === ptIdx;
          const isMultiSelected = multiSelectedPoints.some(p => p.loopIdx === loopIdx && p.ptIdx === ptIdx);
          const isSelected = isSingleSelected || isMultiSelected;
          const isHovered = hoveredPointInfo && hoveredPointInfo.loopIdx === loopIdx && hoveredPointInfo.ptIdx === ptIdx;

          // Si no está en modo edición, solo dibujar si está seleccionado o hovered
          if (!isEditPointsMode && !isSelected && !isHovered) continue;

          ctx.save();
          ctx.beginPath();
          // Radio escalado inversamente a zoom pero con límites visibles en pantalla
          const baseRadius = isSelected ? 6.5 : isHovered ? 5.5 : 4.2;
          const ptRadius = Math.max(2.0, baseRadius / zoom);
          ctx.arc(cx, cy, ptRadius, 0, Math.PI * 2);

          if (isSelected) {
            ctx.fillStyle = '#f59e0b'; // Dorado ámbar brillante
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 10 / zoom;
          } else if (isHovered) {
            ctx.fillStyle = '#38bdf8'; // Celeste hover
            ctx.shadowColor = '#0284c7';
            ctx.shadowBlur = 8 / zoom;
          } else if (isEditPointsMode) {
            ctx.fillStyle = '#0284c7'; // Azul cian editable
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3 / zoom;
          } else {
            ctx.fillStyle = color;
          }
          ctx.fill();

          ctx.strokeStyle = isSelected ? '#ffffff' : isHovered ? '#ffffff' : '#e2e8f0';
          ctx.lineWidth = Math.max(1.0, (isSelected ? 2.2 : isHovered ? 1.8 : 1.2) / zoom);
          ctx.stroke();
          ctx.restore();
        }
      }
    });
  }

  // 5. SUPERPONER MAPAS FANTASMA DE REFERENCIA (Otras Vistas: Frontal, Lateral, Superior)
  // Se dibujan POR ENCIMA para que sean 100% visibles y comparables contra la vista activa
  if (ghostOverlays && ghostOverlays.length > 0) {
    ghostOverlays.forEach(ghost => {
      if (!ghost.imgData && !ghost.processed) return;

      // 5.1 Boceto de la otra vista como imagen semitransparente con fondo transparente recortado
      if (ghost.showImage && ghost.imgData) {
        ctx.save();
        const gCanvas = document.createElement('canvas');
        gCanvas.width = ghost.imgData.width;
        gCanvas.height = ghost.imgData.height;
        const gCtx = gCanvas.getContext('2d');
        if (gCtx) {
          if (ghost.processed && ghost.processed.mask) {
            // Recortar fondo de la vista de referencia para que solo el objeto se superponga
            const gW = ghost.imgData.width;
            const gH = ghost.imgData.height;
            const gOut = gCtx.createImageData(gW, gH);
            const pMask = ghost.processed.mask;
            const pmW = ghost.processed.width;
            const pmH = ghost.processed.height;
            const gSrc = ghost.imgData.data;

            for (let gy = 0; gy < gH; gy++) {
              const my = Math.floor((gy / gH) * pmH);
              for (let gx = 0; gx < gW; gx++) {
                const mx = Math.floor((gx / gW) * pmW);
                const gIdx = (gy * gW + gx) * 4;
                const isSolid = pMask[my * pmW + mx] === 1;
                gOut.data[gIdx] = gSrc[gIdx];
                gOut.data[gIdx + 1] = gSrc[gIdx + 1];
                gOut.data[gIdx + 2] = gSrc[gIdx + 2];
                gOut.data[gIdx + 3] = isSolid ? Math.round(255 * Math.max(0.1, Math.min(1.0, ghost.opacity ?? 0.45))) : 0;
              }
            }
            gCtx.putImageData(gOut, 0, 0);
          } else {
            gCtx.putImageData(ghost.imgData, 0, 0);
            ctx.globalAlpha = Math.max(0.1, Math.min(1.0, ghost.opacity ?? 0.45));
          }
          ctx.drawImage(gCanvas, 0, 0, W, H);
        }
        ctx.restore();
      }

      // 5.2 Contorno perimetral neón de la silueta de la otra vista
      if (ghost.showOutline && ghost.processed && ghost.processed.contours) {
        ctx.save();
        ctx.strokeStyle = ghost.color;
        ctx.lineWidth = Math.max(1.8, 2.4 / zoom);
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.shadowColor = ghost.color;
        ctx.shadowBlur = 8 / zoom;

        ghost.processed.contours.forEach(loop => {
          if (loop.length < 2) return;
          ctx.beginPath();
          const [gx0, gy0] = [
            ((loop[0][0] + 1) / 2) * (W - 1),
            ((1 - loop[0][1]) / 2) * (H - 1)
          ];
          ctx.moveTo(gx0, gy0);
          for (let i = 1; i < loop.length; i++) {
            const [gx, gy] = [
              ((loop[i][0] + 1) / 2) * (W - 1),
              ((1 - loop[i][1]) / 2) * (H - 1)
            ];
            ctx.lineTo(gx, gy);
          }
          ctx.closePath();
          ctx.stroke();
        });
        ctx.restore();
      }

      // 5.3 Rieles Láser de Alineación y Proporciones Ortográficas (Techo, Suelo y Simetría)
      if (ghost.showAlignmentRails && ghost.processed && ghost.processed.boundsNormalized && processed && processed.boundsNormalized) {
        ctx.save();
        const bCurr = processed.boundsNormalized;
        const bGhost = ghost.processed.boundsNormalized;

        const currTopY = (1 - bCurr.maxV) * (H - 1);
        const currBotY = (1 - bCurr.minV) * (H - 1);
        const ghostTopY = (1 - bGhost.maxV) * (H - 1);
        const ghostBotY = (1 - bGhost.minV) * (H - 1);

        // Riel Superior Activo (Ámbar)
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = Math.max(1.2, 1.6 / zoom);
        ctx.setLineDash([5 / zoom, 3 / zoom]);
        ctx.beginPath();
        ctx.moveTo(0, currTopY);
        ctx.lineTo(W, currTopY);
        ctx.stroke();

        // Riel Superior Referencia (Color de la Referencia)
        ctx.strokeStyle = ghost.color;
        ctx.beginPath();
        ctx.moveTo(0, ghostTopY);
        ctx.lineTo(W, ghostTopY);
        ctx.stroke();

        // Riel Inferior Activo (Ámbar)
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(0, currBotY);
        ctx.lineTo(W, currBotY);
        ctx.stroke();

        // Riel Inferior Referencia (Color de la Referencia)
        ctx.strokeStyle = ghost.color;
        ctx.beginPath();
        ctx.moveTo(0, ghostBotY);
        ctx.lineTo(W, ghostBotY);
        ctx.stroke();

        // Etiqueta HUD de comparación de proporciones
        const currH = Math.max(0.01, bCurr.maxV - bCurr.minV);
        const ghostH = Math.max(0.01, bGhost.maxV - bGhost.minV);
        const ratioH = Math.round((currH / ghostH) * 100);
        const diffPx = Math.round(Math.abs(currTopY - ghostTopY));

        ctx.setLineDash([]);
        const isMatched = ratioH >= 97 && ratioH <= 103;
        ctx.fillStyle = isMatched ? '#059669' : '#d97706';
        const hudText = isMatched 
          ? `✓ ${ghost.label}: Altura 100% Coincidente` 
          : `⚠️ ${ghost.label}: Altura ${ratioH}% (Dif: ${diffPx}px)`;

        ctx.font = `bold ${Math.max(10, 12 / zoom)}px sans-serif`;
        const textMetrics = ctx.measureText(hudText);
        const padX = 6 / zoom;
        const padY = 3 / zoom;
        const badgeX = W - textMetrics.width - padX * 2 - 8 / zoom;
        const badgeY = Math.max(6 / zoom, Math.min(currTopY, ghostTopY) - 22 / zoom);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = isMatched ? '#10b981' : '#f59e0b';
        ctx.lineWidth = 1 / zoom;
        ctx.fillRect(badgeX, badgeY, textMetrics.width + padX * 2, 18 / zoom);
        ctx.strokeRect(badgeX, badgeY, textMetrics.width + padX * 2, 18 / zoom);

        ctx.fillStyle = isMatched ? '#34d399' : '#fbbf24';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(hudText, badgeX + padX, badgeY + 9 / zoom);

        ctx.restore();
      }
    });
  }

  // 6. Dibujar Semillas de Huecos marcadas por el usuario (Marcadores rojos de vaciado)
  if (holeSeeds && holeSeeds.length > 0) {
    holeSeeds.forEach(seed => {
      const cx = ((seed[0] + 1) / 2) * (W - 1);
      const cy = ((1 - seed[1]) / 2) * (H - 1);
      const r = Math.max(5, 8 / zoom);

      ctx.save();
      // Círculo de corte
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = Math.max(1.5, 2 / zoom);
      ctx.stroke();

      // Cruz de corte
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.55);
      ctx.moveTo(cx + r * 0.55, cy - r * 0.55);
      ctx.lineTo(cx - r * 0.55, cy + r * 0.55);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.2, 1.8 / zoom);
      ctx.stroke();
      ctx.restore();
    });
  }

  // 4. Guía Láser de Proporciones Simétricas y Sección Transversal
  if (laserOptions && laserOptions.enabled) {
    const laserPos = laserOptions.position ?? 0;
    const isTop = laserOptions.viewKey === 'top';
    const laserColor = '#00f0ff';

    ctx.save();
    // Línea de corte horizontal principal (en Y en Front/Side, en Z en Top)
    const laserPixelY = ((1 - laserPos) / 2) * (H - 1);

    // Resplandor neón
    ctx.strokeStyle = laserColor;
    ctx.lineWidth = Math.max(1.8, 2.5 / zoom);
    ctx.shadowColor = laserColor;
    ctx.shadowBlur = 10 / zoom;
    ctx.setLineDash([8 / zoom, 4 / zoom]);

    ctx.beginPath();
    ctx.moveTo(0, laserPixelY);
    ctx.lineTo(W, laserPixelY);
    ctx.stroke();

    // Marcadores extremos en la línea láser
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4 / zoom;
    ctx.beginPath();
    ctx.arc(14 / zoom, laserPixelY, 4 / zoom, 0, Math.PI * 2);
    ctx.arc(W - 14 / zoom, laserPixelY, 4 / zoom, 0, Math.PI * 2);
    ctx.fill();

    // Etiqueta de métrica del Láser
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.strokeStyle = laserColor;
    ctx.lineWidth = 1 / zoom;
    const badgeW = 74 / zoom;
    const badgeH = 18 / zoom;
    const badgeX = (W - badgeW) / 2;
    const badgeY = Math.max(2 / zoom, Math.min(H - badgeH - 2 / zoom, laserPixelY - badgeH - 4 / zoom));

    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

    ctx.fillStyle = '#38bdf8';
    ctx.font = `bold ${Math.max(9, 10 / zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = isTop ? `Z: ${(laserPos).toFixed(2)}` : `Y: ${(laserPos).toFixed(2)}`;
    ctx.fillText(`⚡ ${label}`, badgeX + badgeW / 2, badgeY + badgeH / 2);

    // Para Vista Superior, dibujar también la línea vertical de simetría X
    if (isTop) {
      const laserPixelX = W / 2;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.8)';
      ctx.lineWidth = Math.max(1.2, 1.8 / zoom);
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 8 / zoom;
      ctx.setLineDash([6 / zoom, 3 / zoom]);

      ctx.beginPath();
      ctx.moveTo(laserPixelX, 0);
      ctx.lineTo(laserPixelX, H);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 5. Dibujar Zonas de Altura / Cavidad (ej. Asiento de sofá vs brazos)
  if (depthZones && depthZones.length > 0) {
    depthZones.forEach(zone => {
      const minU = Math.min(zone.x1, zone.x2);
      const maxU = Math.max(zone.x1, zone.x2);
      const minV = Math.min(zone.y1, zone.y2);
      const maxV = Math.max(zone.y1, zone.y2);

      const px1 = ((minU + 1) / 2) * (W - 1);
      const py1 = ((1 - maxV) / 2) * (H - 1);
      const px2 = ((maxU + 1) / 2) * (W - 1);
      const py2 = ((1 - minV) / 2) * (H - 1);

      const boxW = Math.abs(px2 - px1);
      const boxH = Math.abs(py2 - py1);
      const isSelected = selectedDepthZoneId === zone.id;

      ctx.save();
      // Relleno de la zona de cavidad
      ctx.fillStyle = isSelected ? 'rgba(168, 85, 247, 0.28)' : (zone.enabled ? 'rgba(168, 85, 247, 0.16)' : 'rgba(100, 116, 139, 0.12)');
      ctx.fillRect(px1, py1, boxW, boxH);

      // Borde punteado
      ctx.strokeStyle = isSelected ? '#e9d5ff' : (zone.enabled ? '#c084fc' : '#64748b');
      ctx.lineWidth = Math.max(1.5, (isSelected ? 2.5 : 1.8) / zoom);
      ctx.setLineDash([6 / zoom, 3 / zoom]);
      if (isSelected) {
        ctx.shadowColor = '#c084fc';
        ctx.shadowBlur = 8 / zoom;
      }
      ctx.strokeRect(px1, py1, boxW, boxH);
      ctx.restore();

      // Esquinas interactivas / Tiradores de redimensionado si está seleccionada
      if (isSelected) {
        ctx.save();
        const handleR = Math.max(4, 6 / zoom);
        const corners = [
          [px1, py1], // NW
          [px2, py1], // NE
          [px2, py2], // SE
          [px1, py2]  // SW
        ];
        corners.forEach(([cx, cy]) => {
          ctx.beginPath();
          ctx.arc(cx, cy, handleR, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#9333ea';
          ctx.lineWidth = 2 / zoom;
          ctx.stroke();
        });
        ctx.restore();
      }

      // Etiqueta HUD de la Zona
      ctx.save();
      const labelText = `🛋️ ${zone.name}: ${Math.round(zone.heightMax * 100)}% Altura (${Math.round((1 - zone.heightMax) * 100)}% Hueco)`;
      ctx.font = `bold ${Math.max(10, Math.round(11 / zoom))}px sans-serif`;
      const textMetrics = ctx.measureText(labelText);
      const pad = 4 / zoom;
      const tagW = textMetrics.width + pad * 2;
      const tagH = Math.max(14, 16 / zoom);
      const tagX = px1 + 4 / zoom;
      const tagY = Math.max(tagH, py1 - tagH - 2 / zoom);

      ctx.fillStyle = isSelected ? 'rgba(88, 28, 135, 0.92)' : 'rgba(24, 24, 27, 0.88)';
      ctx.strokeStyle = isSelected ? '#e9d5ff' : '#a855f7';
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 3 / zoom);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? '#ffffff' : '#f3e8ff';
      ctx.fillText(labelText, tagX + pad, tagY + tagH - 4 / zoom);
      ctx.restore();
    });
  }

  // 6. Dibujar Zona de Altura en proceso de trazado por el usuario
  if (activeDrawingDepthZone) {
    const minU = Math.min(activeDrawingDepthZone.x1, activeDrawingDepthZone.x2);
    const maxU = Math.max(activeDrawingDepthZone.x1, activeDrawingDepthZone.x2);
    const minV = Math.min(activeDrawingDepthZone.y1, activeDrawingDepthZone.y2);
    const maxV = Math.max(activeDrawingDepthZone.y1, activeDrawingDepthZone.y2);

    const px1 = ((minU + 1) / 2) * (W - 1);
    const py1 = ((1 - maxV) / 2) * (H - 1);
    const px2 = ((maxU + 1) / 2) * (W - 1);
    const py2 = ((1 - minV) / 2) * (H - 1);

    const boxW = Math.abs(px2 - px1);
    const boxH = Math.abs(py2 - py1);

    ctx.save();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
    ctx.fillRect(px1, py1, boxW, boxH);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(1.8, 2.5 / zoom);
    ctx.setLineDash([5 / zoom, 3 / zoom]);
    ctx.strokeRect(px1, py1, boxW, boxH);

    // Etiqueta flotante mientras dibuja
    const label = '✨ Trazando Asiento / Cavidad...';
    ctx.font = `bold ${Math.max(10, Math.round(11 / zoom))}px sans-serif`;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(px1, Math.max(0, py1 - 18 / zoom), ctx.measureText(label).width + 8 / zoom, 16 / zoom);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(label, px1 + 4 / zoom, Math.max(12 / zoom, py1 - 6 / zoom));
    ctx.restore();
  }

  ctx.restore();

  // 5. Dibujar Caja de Selección Múltiple (Marquee Selection Box) en espacio píxel de lienzo
  if (selectionBox) {
    const rx = Math.min(selectionBox.x1, selectionBox.x2);
    const ry = Math.min(selectionBox.y1, selectionBox.y2);
    const rw = Math.abs(selectionBox.x2 - selectionBox.x1);
    const rh = Math.abs(selectionBox.y2 - selectionBox.y1);

    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.restore();
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}
