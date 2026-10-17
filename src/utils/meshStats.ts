import { CSGObject } from '../types';

/**
 * Retorna el número exacto o estimado de caras / polígonos de cualquier CSGObject,
 * soportando mallas nativas MESH, modelos importados GLTF / GLB / OBJ / STL,
 * y primitivas paramétricas.
 */
export function getObjectFaceCount(obj: CSGObject | null | undefined): number {
  if (!obj) return 0;

  // 1. Caras poligonales explícitas en el objeto
  if (obj.faces && Array.isArray(obj.faces) && obj.faces.length > 0) {
    return obj.faces.length;
  }

  // 2. Estadísticas cacheadas en el objeto (p. ej. tras importar o retopologizar)
  if (obj.stats?.faces !== undefined && obj.stats.faces > 0) {
    return obj.stats.faces;
  }

  // 3. Modelos importados GLTF con submallas
  if (obj.meshData?.type === 'gltf' && obj.meshData.meshes && obj.meshData.meshes.length > 0) {
    const total = obj.meshData.meshes.reduce((acc, m) => acc + (m.faces || 0), 0);
    if (total > 0) return total;
  }

  // 4. Conteo de caras en meshData genérico
  if ((obj.meshData as any)?.facesCount !== undefined && (obj.meshData as any).facesCount > 0) {
    return (obj.meshData as any).facesCount;
  }
  if ((obj.meshData as any)?.faces && Array.isArray((obj.meshData as any).faces)) {
    return (obj.meshData as any).faces.length;
  }

  // 5. Estimación por buffer de vértices (triángulos)
  if (obj.vertices && obj.vertices.length > 0) {
    return Math.max(1, Math.floor(obj.vertices.length / 3));
  }

  // 6. Primitivas paramétricas nativas
  const segs = Math.max(1, Math.round(obj.parameters?.segments ?? 16));
  switch (obj.type) {
    case 'CUBE': {
      const s = Math.max(1, Math.round(obj.parameters?.segments ?? 1));
      return 6 * s * s * 2; // 12 triángulos por defecto (o 6 quads)
    }
    case 'SPHERE': {
      const s = Math.max(3, Math.round(obj.parameters?.segments ?? 16));
      return (s * (s - 1)) * 2;
    }
    case 'CYLINDER': {
      const radial = Math.max(3, Math.round(obj.parameters?.segments ?? 16));
      const hSegs = Math.max(1, Math.round(obj.parameters?.heightSegments ?? 1));
      return (radial * hSegs) * 2 + radial * 2;
    }
    case 'CONE': {
      const radial = Math.max(3, Math.round(obj.parameters?.segments ?? 16));
      return radial * 2 + radial;
    }
    case 'TORUS': {
      const rad = Math.max(3, Math.round(obj.parameters?.radialSegments ?? 16));
      const tub = Math.max(3, Math.round(obj.parameters?.tubularSegments ?? 32));
      return rad * tub * 2;
    }
    case 'PLANE': {
      const s = Math.max(1, Math.round(obj.parameters?.segments ?? 1));
      return s * s * 2;
    }
    case 'CIRCLE':
      return Math.max(3, Math.round(obj.parameters?.segments ?? 16));
    case 'ICOSAHEDRON': return 20;
    case 'DODECAHEDRON': return 36;
    case 'OCTAHEDRON': return 8;
    case 'TETRAHEDRON': return 4;
    case 'PYRAMID': return (obj.parameters?.heightSegments ?? 1) * 8 + 2;
    case 'PRISM': return 8;
    case 'CAPSULE': return 48;
    case 'RING': return (obj.parameters?.thetaSegments ?? 16) * 2;
    default:
      return 0;
  }
}

/**
 * Retorna el número de vértices de un objeto.
 */
export function getObjectVertexCount(obj: CSGObject | null | undefined): number {
  if (!obj) return 0;
  if (obj.vertices && obj.vertices.length > 0) return obj.vertices.length;
  if (obj.stats?.vertices !== undefined && obj.stats.vertices > 0) return obj.stats.vertices;
  if ((obj.meshData as any)?.verticesCount !== undefined) return (obj.meshData as any).verticesCount;
  if (obj.meshData?.type === 'gltf' && obj.meshData.meshes) {
    return obj.meshData.meshes.reduce((acc, m) => acc + (m.vertices || 0), 0);
  }
  return getObjectFaceCount(obj) * 3;
}
