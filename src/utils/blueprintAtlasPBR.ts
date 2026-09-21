import * as THREE from 'three';
import { V3, MeshFace } from '../types';
import { GeneratedPBRSet, generateFullPBRMapsFromSource } from './textureColorUtils';
import { BlueprintImageConfig, BlueprintViewKey, loadCanvasImageData } from './blueprintCarver';

export interface ViewPBRData {
  alignedImageUrl: string;
  pbrSet: GeneratedPBRSet;
}

export interface MultiViewAtlasResult {
  materialId: string;
  materialName: string;
  albedoAtlasUrl: string;
  normalAtlasUrl: string;
  displacementAtlasUrl: string;
  roughnessAtlasUrl: string;
  aoAtlasUrl: string;
  metalnessAtlasUrl: string;
  activeViews: BlueprintViewKey[];
}

/**
 * Cuadrantes normalizados del Atlas [uMin, vMin, uMax, vMax] (Espacio UV [0,1])
 * - Frontal: Superior Izquierda [0, 0.5, 0.5, 1.0]
 * - Lateral: Superior Derecha   [0.5, 0.5, 1.0, 1.0]
 * - Superior: Inferior Izquierda [0, 0, 0.5, 0.5]
 * - Detalle / Trasera: Inferior Derecha [0.5, 0, 1.0, 0.5]
 */
export const ATLAS_QUADRANTS: Record<BlueprintViewKey, { uMin: number; vMin: number; uMax: number; vMax: number }> = {
  front:  { uMin: 0.0, vMin: 0.5, uMax: 0.5, vMax: 1.0 },
  side:   { uMin: 0.5, vMin: 0.5, uMax: 1.0, vMax: 1.0 },
  top:    { uMin: 0.0, vMin: 0.0, uMax: 0.5, vMax: 0.5 },
  back:   { uMin: 0.5, vMin: 0.0, uMax: 1.0, vMax: 0.5 },
  bottom: { uMin: 0.5, vMin: 0.0, uMax: 1.0, vMax: 0.5 },
};

/**
 * Carga una imagen de forma asíncrona a un objeto HTMLImageElement
 */
function loadImageAsync(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Compone un Atlas 2D combinando las imágenes de las diferentes vistas en sus respectivos cuadrantes
 * con corrección de V-Flip e inyección de sangrado perimetral (Bleeding) para evitar costuras.
 */
async function compositeAtlasChannel(
  images: { viewKey: BlueprintViewKey; url: string }[],
  atlasSize = 2048,
  defaultFillColor = '#ffffff'
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Rellenar con color base por defecto
  ctx.fillStyle = defaultFillColor;
  ctx.fillRect(0, 0, atlasSize, atlasSize);

  // 2. Dibujar cada imagen en su cuadrante
  for (const item of images) {
    if (!item.url) continue;
    const img = await loadImageAsync(item.url);
    if (!img) continue;

    const quad = ATLAS_QUADRANTS[item.viewKey] || ATLAS_QUADRANTS.side;
    const dx = quad.uMin * atlasSize;
    // En Canvas 2D Y crece hacia abajo, mientras que en UV V=0 es abajo y V=1 es arriba
    const dy = (1.0 - quad.vMax) * atlasSize;
    const dw = (quad.uMax - quad.uMin) * atlasSize;
    const dh = (quad.vMax - quad.vMin) * atlasSize;

    ctx.save();
    // Patrón de sangrado (Bleed): sombra difuminada para que el mipmapping de WebGL no recoja el color del fondo
    ctx.shadowColor = defaultFillColor;
    ctx.shadowBlur = 4;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

export interface AtlasGenerationOptions {
  atlasResolution?: number;
  baseMetalness?: number; // 0.0 a 1.0
  baseRoughness?: number; // 0.0 a 1.0
  baseMeshColor?: string; // Color base para disimular costuras y fondo del atlas
}

/**
 * Genera el conjunto completo de texturas Atlas PBR unificando todas las vistas ortográficas disponibles
 */
export async function buildUnifiedMultiViewPBRAtlas(
  viewDataMap: Partial<Record<BlueprintViewKey, ViewPBRData>>,
  options: number | AtlasGenerationOptions = 2048,
  extraOptions?: AtlasGenerationOptions
): Promise<MultiViewAtlasResult | null> {
  const activeKeys = (['front', 'side', 'top', 'back'] as BlueprintViewKey[]).filter(k => !!viewDataMap[k]);
  if (activeKeys.length === 0) return null;

  const atlasResolution = typeof options === 'number' ? (extraOptions?.atlasResolution ?? options) : (options.atlasResolution ?? 2048);
  const baseMetalness = typeof options === 'object' ? (options.baseMetalness ?? 0.0) : (extraOptions?.baseMetalness ?? 0.0);
  const baseRoughness = typeof options === 'object' ? (options.baseRoughness ?? 0.5) : (extraOptions?.baseRoughness ?? 0.5);
  const baseMeshColor = typeof options === 'object' ? options.baseMeshColor : extraOptions?.baseMeshColor;

  const metalByte = Math.max(0, Math.min(255, Math.round(baseMetalness * 255))).toString(16).padStart(2, '0');
  const roughByte = Math.max(0, Math.min(255, Math.round(baseRoughness * 255))).toString(16).padStart(2, '0');
  const metalHexColor = `#${metalByte}${metalByte}${metalByte}`;
  const roughHexColor = `#${roughByte}${roughByte}${roughByte}`;

  // 1. Recolectar URLs de cada canal
  const albedoList: { viewKey: BlueprintViewKey; url: string }[] = [];
  const normalList: { viewKey: BlueprintViewKey; url: string }[] = [];
  const bumpList: { viewKey: BlueprintViewKey; url: string }[] = [];
  const roughList: { viewKey: BlueprintViewKey; url: string }[] = [];
  const aoList: { viewKey: BlueprintViewKey; url: string }[] = [];
  const metalList: { viewKey: BlueprintViewKey; url: string }[] = [];

  for (const k of activeKeys) {
    const data = viewDataMap[k];
    if (!data) continue;
    if (data.alignedImageUrl) albedoList.push({ viewKey: k, url: data.alignedImageUrl });
    if (data.pbrSet.normalMap) normalList.push({ viewKey: k, url: data.pbrSet.normalMap });
    if (data.pbrSet.displacementMap) bumpList.push({ viewKey: k, url: data.pbrSet.displacementMap });
    if (data.pbrSet.roughnessMap) roughList.push({ viewKey: k, url: data.pbrSet.roughnessMap });
    if (data.pbrSet.aoMap) aoList.push({ viewKey: k, url: data.pbrSet.aoMap });
    if (data.pbrSet.metalnessMap) metalList.push({ viewKey: k, url: data.pbrSet.metalnessMap });
  }

  // 2. Componer cada mapa Atlas en paralelo
  const [
    albedoAtlasUrl,
    normalAtlasUrl,
    displacementAtlasUrl,
    roughnessAtlasUrl,
    aoAtlasUrl,
    metalnessAtlasUrl
  ] = await Promise.all([
    compositeAtlasChannel(albedoList, atlasResolution, baseMeshColor || '#e2e8f0'),
    compositeAtlasChannel(normalList, atlasResolution, '#8080ff'), // Normal neutra tangente
    compositeAtlasChannel(bumpList, atlasResolution, '#808080'),   // Bump neutral 50% gris
    compositeAtlasChannel(roughList, atlasResolution, roughHexColor),  // Rugosidad dinámica
    compositeAtlasChannel(aoList, atlasResolution, '#ffffff'),     // AO blanco sin sombras
    compositeAtlasChannel(metalList, atlasResolution, metalHexColor),  // Metalizado dinámico
  ]);

  const materialId = 'mat_atlas_pbr_' + Math.random().toString(36).substring(2, 9);
  const viewNames = activeKeys.map(k => k === 'front' ? 'Frontal' : k === 'top' ? 'Superior' : k === 'side' ? 'Lateral' : 'Trasera').join('+');

  return {
    materialId,
    materialName: `Material PBR - Atlas Multi-Vista (${viewNames})`,
    albedoAtlasUrl,
    normalAtlasUrl,
    displacementAtlasUrl,
    roughnessAtlasUrl,
    aoAtlasUrl,
    metalnessAtlasUrl,
    activeViews: activeKeys,
  };
}

/**
 * Genera coordenadas UV mapeando cada cara de la malla 3D al cuadrante correspondiente en el Atlas Multi-Vista.
 * 
 * Regla de Asignación de Cuadrantes según la normal de cada cara con escala isotrópica (maxHalf):
 * - Caras Laterales (|Nx| dominante): proyectadas en plano Z-Y y mapeadas al cuadrante `side`
 * - Caras Superiores/Inferiores (|Ny| dominante): proyectadas en plano X-Z y mapeadas al cuadrante `top`
 * - Caras Frontales/Posteriores (|Nz| dominante): proyectadas en plano X-Y y mapeadas al cuadrante `front`
 */
export function generateMultiViewAtlasUVs(
  obj: { vertices: V3[]; faces: MeshFace[] },
  activeViews: BlueprintViewKey[] = ['side', 'top', 'front'],
  customDimensions?: V3,
  viewsConfig?: Partial<Record<BlueprintViewKey, BlueprintImageConfig>>,
  _boundsMap?: Partial<Record<BlueprintViewKey, { minU: number; minV: number; maxU: number; maxV: number }>>
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = obj.vertices;
  if (!vertices || vertices.length === 0 || !obj.faces || obj.faces.length === 0) return obj;

  // 1. Bounding box global y escala isotrópica
  const dimX = customDimensions ? customDimensions[0] : 2;
  const dimY = customDimensions ? customDimensions[1] : 2;
  const dimZ = customDimensions ? customDimensions[2] : 2;

  const halfX = Math.max(1e-4, dimX / 2);
  const halfY = Math.max(1e-4, dimY / 2);
  const halfZ = Math.max(1e-4, dimZ / 2);
  const maxHalf = Math.max(halfX, halfY, halfZ);

  // Determinar vistas activas para fallback
  const hasSide = activeViews.includes('side');
  const hasTop = activeViews.includes('top');
  const hasFront = activeViews.includes('front');
  const hasBack = activeViews.includes('back');

  const faces = obj.faces.map(face => {
    if (!face || !face.indices || face.indices.length < 3) return face;

    // Calcular vector normal de la cara
    const i0 = face.indices[0];
    const i1 = face.indices[1];
    const i2 = face.indices[2];
    const v0Arr = vertices[i0];
    const v1Arr = vertices[i1];
    const v2Arr = vertices[i2];

    let normalX = 0, normalY = 0, normalZ = 0;
    if (v0Arr && v1Arr && v2Arr) {
      const v0 = new THREE.Vector3(...v0Arr);
      const v1 = new THREE.Vector3(...v1Arr);
      const v2 = new THREE.Vector3(...v2Arr);
      const norm = new THREE.Vector3().crossVectors(
        v1.clone().sub(v0),
        v2.clone().sub(v0)
      ).normalize();

      if (norm.lengthSq() > 1e-6) {
        normalX = norm.x;
        normalY = norm.y;
        normalZ = norm.z;
      }
    }

    const absX = Math.abs(normalX);
    const absY = Math.abs(normalY);
    const absZ = Math.abs(normalZ);

    // Seleccionar cuadrante según la normal dominante y disponibilidad
    let dominantView: BlueprintViewKey = 'side';
    let skipProjection = false;

    // Vista Superior (cubre caras horizontales y cojines/asientos/tapizados abombados con normalY > 0.45)
    const isTopDominant = (absY >= absX && absY >= absZ) || (normalY > 0.45 && normalY >= absX * 0.8 && normalY >= absZ * 0.75);
    if (isTopDominant && hasTop) {
      dominantView = 'top';
      const cfgTop = viewsConfig?.top;
      const projectBothSidesTop = (cfgTop?.texProjectBothSides ?? false) || (cfgTop?.texMirrorOpposite ?? false);
      if (!projectBothSidesTop && normalY < -0.05) skipProjection = true;
    } else if (absZ >= absX && absZ >= absY) {
      // Normal Z dominante (Frontal en -Z vs Trasera en +Z)
      if (normalZ < -0.05) {
        if (hasFront) {
          dominantView = 'front';
        } else {
          const cfgBack = viewsConfig?.back;
          const projectBothSides = (cfgBack?.texProjectBothSides ?? false) || (cfgBack?.texMirrorOpposite ?? false);
          if (hasBack && projectBothSides) {
            dominantView = 'back';
          } else {
            skipProjection = true;
          }
        }
      } else {
        if (hasBack) {
          dominantView = 'back';
        } else {
          const cfgFront = viewsConfig?.front;
          const projectBothSides = (cfgFront?.texProjectBothSides ?? false) || (cfgFront?.texMirrorOpposite ?? false);
          if (hasFront && projectBothSides) {
            dominantView = 'front';
          } else {
            skipProjection = true;
          }
        }
      }
    } else if (hasSide) {
      dominantView = 'side';
      const cfgSide = viewsConfig?.side;
      const projectBothSidesSide = (cfgSide?.texProjectBothSides ?? false) || (cfgSide?.texMirrorOpposite ?? false);
      if (!projectBothSidesSide && normalX > 0.05) skipProjection = true;
    } else if (hasTop) {
      dominantView = 'top';
    } else if (hasFront) {
      dominantView = 'front';
    } else if (hasBack) {
      dominantView = 'back';
    }

    const quad = ATLAS_QUADRANTS[dominantView] || ATLAS_QUADRANTS.side;
    const quadWidth = quad.uMax - quad.uMin;
    const quadHeight = quad.vMax - quad.vMin;

    const cfg = viewsConfig?.[dominantView];

    const scaleX = Math.max(0.01, cfg?.texScaleX ?? 1.0);
    const scaleY = Math.max(0.01, cfg?.texScaleY ?? 1.0);
    const offsetX = cfg?.texOffsetX ?? 0.0;
    const offsetY = cfg?.texOffsetY ?? 0.0;
    const flipH = cfg?.texFlipH ?? false;
    const flipV = cfg?.texFlipV ?? false;
    const mirrorOpposite = cfg?.texMirrorOpposite ?? false;

    const uvs: [number, number][] = face.indices.map(vIdx => {
      if (skipProjection) {
        return [quad.uMin + 0.001, quad.vMin + 0.001] as [number, number];
      }

      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y, z] = v;
      let rawU = 0.5;
      let rawV = 0.5;

      // Proyección centrada directamente en las proporciones de la vista [halfX, halfY, halfZ]
      if (dominantView === 'side') {
        let pzNorm = z / halfZ;
        let pyNorm = y / halfY;
        if (mirrorOpposite && normalX < 0) pzNorm = -pzNorm;
        rawU = (pzNorm + 1.0) / 2.0;
        rawV = (pyNorm + 1.0) / 2.0;
      } else if (dominantView === 'top') {
        let pxNorm = x / halfX;
        let pzNorm = z / halfZ;
        rawU = (pxNorm + 1.0) / 2.0;
        // Delantera (+Z) corresponde a la parte superior de la imagen (V = 1.0)
        rawV = (pzNorm + 1.0) / 2.0;
      } else if (dominantView === 'back') {
        let pxNorm = x / halfX;
        let pyNorm = y / halfY;
        if (mirrorOpposite && normalZ < 0) pxNorm = -pxNorm;
        rawU = (1.0 - pxNorm) / 2.0;
        rawV = (pyNorm + 1.0) / 2.0;
      } else {
        // Frontal
        let pxNorm = x / halfX;
        let pyNorm = y / halfY;
        if (mirrorOpposite && normalZ > 0) pxNorm = -pxNorm;
        rawU = (pxNorm + 1.0) / 2.0;
        rawV = (pyNorm + 1.0) / 2.0;
      }

      // Soportar rotación de vista (90°, 180°, 270°)
      const rot = ((cfg?.rotation ?? 0) % 360 + 360) % 360;
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

      // Aplicar escala y offset
      let uNorm = (rawU - 0.5) / scaleX + 0.5 - offsetX;
      let vNorm = (rawV - 0.5) / scaleY + 0.5 - offsetY;

      if (flipH) uNorm = 1.0 - uNorm;
      if (flipV) vNorm = 1.0 - vNorm;

      const subU = Math.max(0.001, Math.min(0.999, uNorm));
      const subV = Math.max(0.001, Math.min(0.999, vNorm));

      // Mapear al espacio global del Atlas [0, 1] en espacio de texturas WebGL
      const atlasU = quad.uMin + subU * quadWidth;
      const atlasV = quad.vMin + subV * quadHeight;

      return [atlasU, atlasV] as [number, number];
    });

    return { ...face, uvs };
  });

  return { vertices, faces };
}

/**
 * Prepara los datos PBR de una vista ortográfica extrayendo el lienzo alineado y sintetizando sus mapas
 */
export async function prepareViewPBRData(
  url: string,
  cfg: BlueprintImageConfig,
  normalStrength = 1.2
): Promise<ViewPBRData | null> {
  if (!url) return null;
  const imgData = await loadCanvasImageData(url, cfg);
  let alignedUrl = url;
  if (imgData) {
    const c = document.createElement('canvas');
    c.width = imgData.width;
    c.height = imgData.height;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.putImageData(imgData, 0, 0);
      alignedUrl = c.toDataURL('image/png');
    }
  }

  const pbrSet = await generateFullPBRMapsFromSource(alignedUrl, normalStrength, !!cfg.invertNormalY);
  return {
    alignedImageUrl: alignedUrl,
    pbrSet,
  };
}
