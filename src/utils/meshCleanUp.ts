import * as THREE from 'three';
import type { V3, MeshFace } from '../types';

export interface CleanUpReport {
  success: boolean;
  message: string;
  removedFaces: number;
  removedVertices: number;
  remainingFaces: number;
  remainingVertices: number;
  islandsCount?: number;
}

/**
 * Calcula un mapa de equivalencia canónica espacial para un conjunto de vértices,
 * conectando vértices geométricamente coincidentes (incluso si tienen UVs o normales divididas).
 * Utiliza búsqueda espacial de 3x3x3 celdas adyacentes para garantizar que vértices cercanos
 * no queden separados por fronteras de celda.
 */
export function buildSpatialCanonicalMap(
  vertices: V3[],
  customTolerance?: number,
  vertexOffsets?: Record<number, V3>
): {
  canonicalVert: Int32Array;
  bboxDiag: number;
  tol: number;
  bakedVerts: V3[];
} {
  const numVerts = vertices ? vertices.length : 0;
  const canonicalVert = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) canonicalVert[i] = i;
  if (numVerts === 0) return { canonicalVert, bboxDiag: 1.0, tol: 0.001, bakedVerts: [] };

  const bakedVerts: V3[] = new Array(numVerts);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < numVerts; i++) {
    const v = vertices[i];
    const off = vertexOffsets?.[i] || [0, 0, 0];
    const bx = (v?.[0] ?? 0) + off[0];
    const by = (v?.[1] ?? 0) + off[1];
    const bz = (v?.[2] ?? 0) + off[2];
    bakedVerts[i] = [bx, by, bz];

    if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (bz < minZ) minZ = bz; if (bz > maxZ) maxZ = bz;
  }

  const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
  const tol = customTolerance ?? Math.max(1e-5, bboxDiag * 0.0005);
  const tolSq = tol * tol;
  const cellSize = tol;

  // DSU para unir vértices espacialmente coincidentes
  const parent = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) parent[i] = i;
  const findRoot = (i: number): number => {
    let root = i;
    while (root !== parent[root]) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  };
  const union = (i: number, j: number) => {
    const rootI = findRoot(i);
    const rootJ = findRoot(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) parent[rootJ] = rootI;
      else parent[rootI] = rootJ;
    }
  };

  // Rejilla espacial 3D con búsqueda en vecindario 3x3x3
  const grid = new Map<string, number[]>();

  for (let i = 0; i < numVerts; i++) {
    const v = bakedVerts[i];
    const gx = Math.floor(v[0] / cellSize);
    const gy = Math.floor(v[1] / cellSize);
    const gz = Math.floor(v[2] / cellSize);

    // Buscar en 27 celdas adyacentes
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${gx + dx}_${gy + dy}_${gz + dz}`;
          const candidates = grid.get(key);
          if (candidates) {
            for (let c = 0; c < candidates.length; c++) {
              const candIdx = candidates[c];
              const cv = bakedVerts[candIdx];
              const d0 = v[0] - cv[0];
              const d1 = v[1] - cv[1];
              const d2 = v[2] - cv[2];
              if (d0 * d0 + d1 * d1 + d2 * d2 <= tolSq) {
                union(i, candIdx);
              }
            }
          }
        }
      }
    }

    const selfKey = `${gx}_${gy}_${gz}`;
    let list = grid.get(selfKey);
    if (!list) {
      list = [];
      grid.set(selfKey, list);
    }
    list.push(i);
  }

  for (let i = 0; i < numVerts; i++) {
    canonicalVert[i] = findRoot(i);
  }

  return { canonicalVert, bboxDiag, tol, bakedVerts };
}

/**
 * Agrupa todas las caras de la malla en islas/componentes conexos basándose
 * en la conectividad topológica espacial (aristas y vértices compartidos).
 * Devuelve un array de islas ordenadas de mayor a menor número de caras.
 */
export function findConnectedIslands(
  vertices: V3[],
  faces: MeshFace[],
  vertexOffsets?: Record<number, V3>
): number[][] {
  if (!faces || faces.length === 0) return [];

  const numFaces = faces.length;
  const numVerts = vertices ? vertices.length : 0;
  const { canonicalVert } = buildSpatialCanonicalMap(vertices, undefined, vertexOffsets);

  // Mapear cada arista canónica y vértice a las caras que lo contienen
  const edgeToFaces = new Map<string, number[]>();
  const vertToFaces = new Map<number, number[]>();

  for (let fi = 0; fi < numFaces; fi++) {
    const indices = faces[fi].indices;
    if (!indices || indices.length < 2) continue;
    const len = indices.length;

    for (let k = 0; k < len; k++) {
      const v0 = indices[k];
      const v1 = indices[(k + 1) % len];
      const c0 = v0 < numVerts ? canonicalVert[v0] : v0;
      const c1 = v1 < numVerts ? canonicalVert[v1] : v1;

      // Vértice -> caras
      let vList = vertToFaces.get(c0);
      if (!vList) { vList = []; vertToFaces.set(c0, vList); }
      vList.push(fi);

      // Arista -> caras (orden canónico)
      if (c0 !== c1) {
        const edgeKey = c0 < c1 ? `${c0}_${c1}` : `${c1}_${c0}`;
        let eList = edgeToFaces.get(edgeKey);
        if (!eList) { eList = []; edgeToFaces.set(edgeKey, eList); }
        eList.push(fi);
      }
    }
  }

  // DSU de caras para agrupar en componentes conexos
  const faceParent = new Int32Array(numFaces);
  for (let i = 0; i < numFaces; i++) faceParent[i] = i;
  const findFaceRoot = (i: number): number => {
    let root = i;
    while (root !== faceParent[root]) root = faceParent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = faceParent[curr];
      faceParent[curr] = root;
      curr = nxt;
    }
    return root;
  };
  const unionFaces = (i: number, j: number) => {
    const rootI = findFaceRoot(i);
    const rootJ = findFaceRoot(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) faceParent[rootJ] = rootI;
      else faceParent[rootI] = rootJ;
    }
  };

  // 1. Unir caras que comparten aristas canónicas (conectividad superficial principal)
  edgeToFaces.forEach(fList => {
    if (fList.length > 1) {
      const first = fList[0];
      for (let i = 1; i < fList.length; i++) {
        unionFaces(first, fList[i]);
      }
    }
  });

  // 2. Unir caras que comparten vértices canónicos (asegura fans en conos, polos de esferas y bordes)
  vertToFaces.forEach(fList => {
    if (fList.length > 1) {
      const first = fList[0];
      for (let i = 1; i < fList.length; i++) {
        unionFaces(first, fList[i]);
      }
    }
  });

  // Agrupar caras por raíz de componente
  const islandMap = new Map<number, number[]>();
  for (let i = 0; i < numFaces; i++) {
    const root = findFaceRoot(i);
    let list = islandMap.get(root);
    if (!list) {
      list = [];
      islandMap.set(root, list);
    }
    list.push(i);
  }

  const islands = Array.from(islandMap.values());
  // Ordenar de mayor a menor número de caras
  islands.sort((a, b) => b.length - a.length);
  return islands;
}

/**
 * Reconstruye la malla conservando sólo las caras permitidas y eliminando
 * todos los vértices huérfanos resultantes con remapeo de índices y UVs intactos.
 */
export function filterFacesAndCompact(
  vertices: V3[],
  faces: MeshFace[],
  keepFaceIndices: Set<number>,
  vertexOffsets?: Record<number, V3>
): { vertices: V3[]; faces: MeshFace[]; removedFaces: number; removedVerts: number } {
  const bakedVerts: V3[] = vertices.map((v, i) => {
    const off = vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
  });

  const keptFaces: MeshFace[] = [];
  const usedVerts = new Set<number>();

  for (let fi = 0; fi < faces.length; fi++) {
    if (keepFaceIndices.has(fi)) {
      const face = faces[fi];
      keptFaces.push(face);
      for (let k = 0; k < face.indices.length; k++) {
        usedVerts.add(face.indices[k]);
      }
    }
  }

  const remap = new Map<number, number>();
  const finalVerts: V3[] = [];

  for (let i = 0; i < bakedVerts.length; i++) {
    if (usedVerts.has(i)) {
      remap.set(i, finalVerts.length);
      finalVerts.push(bakedVerts[i]);
    }
  }

  const finalFaces: MeshFace[] = keptFaces.map(f => ({
    ...f,
    indices: f.indices.map(i => remap.get(i) ?? 0)
  }));

  return {
    vertices: finalVerts,
    faces: finalFaces,
    removedFaces: faces.length - finalFaces.length,
    removedVerts: vertices.length - finalVerts.length
  };
}

/**
 * Calcula el área exacta 3D de una cara poligonal (soporta triángulos, quads y N-gons).
 */
export function computeFaceArea(face: MeshFace, vertices: V3[]): number {
  const len = face.indices?.length || 0;
  if (len < 3) return 0;
  const p0 = vertices[face.indices[0]];
  if (!p0) return 0;

  let totalArea = 0;
  for (let i = 1; i < len - 1; i++) {
    const p1 = vertices[face.indices[i]];
    const p2 = vertices[face.indices[i + 1]];
    if (!p1 || !p2) continue;

    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    totalArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  }
  return isNaN(totalArea) ? 0 : totalArea;
}

/**
 * Elimina fragmentos desconectados, esquirlas y polígonos flotantes de la malla.
 * - keepOnlyLargest: true -> Mantiene únicamente el cuerpo 3D principal y borra todo el escombro.
 * - minFacesThreshold: número mínimo de caras que debe tener una pieza para conservarse.
 */
export function purgeFloatingIslands(
  vertices: V3[],
  faces: MeshFace[],
  options: { keepOnlyLargest?: boolean; minFacesThreshold?: number } = { keepOnlyLargest: true },
  vertexOffsets?: Record<number, V3>
): {
  vertices: V3[];
  faces: MeshFace[];
  report: CleanUpReport;
} {
  if (!faces || faces.length === 0) {
    return {
      vertices,
      faces,
      report: {
        success: false,
        message: 'El objeto no tiene caras poligonales para analizar.',
        removedFaces: 0,
        removedVertices: 0,
        remainingFaces: 0,
        remainingVertices: vertices ? vertices.length : 0
      }
    };
  }

  const islands = findConnectedIslands(vertices, faces, vertexOffsets);

  if (islands.length <= 1) {
    return {
      vertices,
      faces,
      report: {
        success: true,
        message: 'La malla es una única pieza continua (no hay islas flotantes desconectadas).',
        removedFaces: 0,
        removedVertices: 0,
        remainingFaces: faces.length,
        remainingVertices: vertices.length,
        islandsCount: 1
      }
    };
  }

  const keepFaceIndices = new Set<number>();

  if (options.keepOnlyLargest) {
    // Conservar únicamente la isla más grande (islands[0])
    const mainIsland = islands[0];
    for (let k = 0; k < mainIsland.length; k++) {
      keepFaceIndices.add(mainIsland[k]);
    }
  } else {
    // Conservar islas que superen el umbral de caras
    const minThreshold = options.minFacesThreshold || Math.max(5, Math.floor(faces.length * 0.02));
    for (let i = 0; i < islands.length; i++) {
      if (islands[i].length >= minThreshold) {
        for (let k = 0; k < islands[i].length; k++) {
          keepFaceIndices.add(islands[i][k]);
        }
      }
    }
    // Si ninguna superó el umbral, conservar al menos la principal
    if (keepFaceIndices.size === 0) {
      for (let k = 0; k < islands[0].length; k++) {
        keepFaceIndices.add(islands[0][k]);
      }
    }
  }

  const compacted = filterFacesAndCompact(vertices, faces, keepFaceIndices, vertexOffsets);
  const discardedIslandsCount = islands.length - (options.keepOnlyLargest ? 1 : islands.filter(isl => isl.length >= (options.minFacesThreshold || 5)).length);

  return {
    vertices: compacted.vertices,
    faces: compacted.faces,
    report: {
      success: true,
      message: `¡${discardedIslandsCount} fragmento(s) flotante(s) eliminados! Se purgaron ${compacted.removedFaces} polígonos inservibles y ${compacted.removedVerts} vértices.`,
      removedFaces: compacted.removedFaces,
      removedVertices: compacted.removedVerts,
      remainingFaces: compacted.faces.length,
      remainingVertices: compacted.vertices.length,
      islandsCount: islands.length
    }
  };
}

/**
 * Selecciona todas las caras y vértices conectados a la selección actual (Select Linked / Isla).
 * Atraviesa costuras UV y normales divididas utilizando equivalencia espacial canónica 3D.
 */
export function getLinkedSelection(
  vertices: V3[],
  faces: MeshFace[],
  selectedFaceIndices: number[] = [],
  selectedVertexIndices: number[] = [],
  vertexOffsets?: Record<number, V3>
): { linkedFaceIndices: number[]; linkedVertexIndices: number[] } {
  if (!faces || faces.length === 0) {
    return { linkedFaceIndices: [], linkedVertexIndices: [] };
  }

  const numFaces = faces.length;
  const numVerts = vertices ? vertices.length : 0;
  const { canonicalVert } = buildSpatialCanonicalMap(vertices, undefined, vertexOffsets);

  // Identificar semillas iniciales
  const seedFaces = new Set<number>();
  (selectedFaceIndices || []).forEach(fi => {
    if (fi >= 0 && fi < numFaces) seedFaces.add(fi);
  });

  if (selectedVertexIndices && selectedVertexIndices.length > 0) {
    const selCanonVerts = new Set<number>();
    selectedVertexIndices.forEach(vi => {
      if (vi >= 0 && vi < numVerts) {
        selCanonVerts.add(canonicalVert[vi]);
      }
    });

    for (let fi = 0; fi < numFaces; fi++) {
      const face = faces[fi];
      if (!face.indices) continue;
      for (let k = 0; k < face.indices.length; k++) {
        const vi = face.indices[k];
        const cv = vi < numVerts ? canonicalVert[vi] : vi;
        if (selCanonVerts.has(cv)) {
          seedFaces.add(fi);
          break;
        }
      }
    }
  }

  if (seedFaces.size === 0) {
    return { linkedFaceIndices: [], linkedVertexIndices: [] };
  }

  // Construir mapa de adyacencia espacial: vértice canónico -> caras
  const vertToFaces = new Map<number, number[]>();
  for (let fi = 0; fi < numFaces; fi++) {
    const indices = faces[fi].indices;
    if (!indices) continue;
    for (let k = 0; k < indices.length; k++) {
      const vi = indices[k];
      const canonVi = vi < numVerts ? canonicalVert[vi] : vi;
      let list = vertToFaces.get(canonVi);
      if (!list) {
        list = [];
        vertToFaces.set(canonVi, list);
      }
      list.push(fi);
    }
  }

  const visitedFaces = new Set<number>();
  const visitedVerts = new Set<number>();
  const queue: number[] = Array.from(seedFaces);

  for (const sf of queue) visitedFaces.add(sf);

  while (queue.length > 0) {
    const fi = queue.pop()!;
    const indices = faces[fi].indices;
    if (!indices) continue;
    for (let k = 0; k < indices.length; k++) {
      const vi = indices[k];
      visitedVerts.add(vi);
      const canonVi = vi < numVerts ? canonicalVert[vi] : vi;
      const neighborFaces = vertToFaces.get(canonVi);
      if (neighborFaces) {
        for (let n = 0; n < neighborFaces.length; n++) {
          const nf = neighborFaces[n];
          if (!visitedFaces.has(nf)) {
            visitedFaces.add(nf);
            queue.push(nf);
          }
        }
      }
    }
  }

  return {
    linkedFaceIndices: Array.from(visitedFaces).sort((a, b) => a - b),
    linkedVertexIndices: Array.from(visitedVerts).sort((a, b) => a - b)
  };
}

/**
 * Poda profunda de escombros:
 * 1. Elimina caras degeneradas (< 3 índices o con vértices colapsados)
 * 2. Elimina caras de área nula / astillas microscópicas (área adaptativa < minArea)
 * 3. Elimina caras duplicadas idénticas (Z-fighting coplanar) con firma espacial canónica
 * 4. Elimina caras flotantes aisladas
 * 5. Purga todos los vértices huérfanos sin caras
 */
export function purgeDebrisMesh(
  vertices: V3[],
  faces: MeshFace[],
  minArea: number = 1e-6,
  vertexOffsets?: Record<number, V3>
): {
  vertices: V3[];
  faces: MeshFace[];
  report: CleanUpReport;
} {
  if (!faces || faces.length === 0 || !vertices || vertices.length === 0) {
    return {
      vertices: vertices || [],
      faces: faces || [],
      report: {
        success: false,
        message: 'Malla vacía o sin geometría poligonal.',
        removedFaces: 0,
        removedVertices: 0,
        remainingFaces: 0,
        remainingVertices: 0
      }
    };
  }

  const initialFacesCount = faces.length;
  const initialVertsCount = vertices.length;

  const { canonicalVert, bboxDiag, bakedVerts } = buildSpatialCanonicalMap(vertices, undefined, vertexOffsets);
  const adaptiveMinArea = Math.min(minArea, bboxDiag * bboxDiag * 1e-8);

  const validFaces: MeshFace[] = [];
  const faceSignatures = new Set<string>();

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    if (!f.indices || f.indices.length < 3) continue;

    // Limpiar índices repetidos consecutivos en la misma cara manteniendo UVs alineados
    const cleanIndices: number[] = [];
    const cleanUVs: [number, number][] = [];
    const hasUvs = f.uvs && f.uvs.length >= f.indices.length;

    for (let k = 0; k < f.indices.length; k++) {
      const idx = f.indices[k];
      if (cleanIndices.length === 0 || cleanIndices[cleanIndices.length - 1] !== idx) {
        cleanIndices.push(idx);
        if (hasUvs && f.uvs) cleanUVs.push(f.uvs[k]);
      }
    }
    if (cleanIndices.length > 1 && cleanIndices[0] === cleanIndices[cleanIndices.length - 1]) {
      cleanIndices.pop();
      if (hasUvs) cleanUVs.pop();
    }

    if (cleanIndices.length < 3) continue;

    // Comprobar que no todos los vértices canónicos sean iguales
    const canonIndices = cleanIndices.map(vi => vi < canonicalVert.length ? canonicalVert[vi] : vi);
    const uniqueCanon = new Set(canonIndices);
    if (uniqueCanon.size < 3) continue;

    // Comprobar área adaptativa
    const area = computeFaceArea({ ...f, indices: cleanIndices }, bakedVerts);
    if (area <= adaptiveMinArea || isNaN(area)) continue;

    // Comprobar duplicado coplanar ordenando índices canónicos espaciales
    const canSig = [...canonIndices].sort((a, b) => a - b).join(',');
    if (faceSignatures.has(canSig)) continue;
    faceSignatures.add(canSig);

    validFaces.push({
      ...f,
      indices: cleanIndices,
      ...(hasUvs && cleanUVs.length === cleanIndices.length ? { uvs: cleanUVs } : {})
    });
  }

  // Eliminar vértices huérfanos
  const usedVerts = new Set<number>();
  for (let i = 0; i < validFaces.length; i++) {
    for (let k = 0; k < validFaces[i].indices.length; k++) {
      usedVerts.add(validFaces[i].indices[k]);
    }
  }

  const remap = new Map<number, number>();
  const finalVerts: V3[] = [];
  for (let i = 0; i < bakedVerts.length; i++) {
    if (usedVerts.has(i)) {
      remap.set(i, finalVerts.length);
      finalVerts.push(bakedVerts[i]);
    }
  }

  const finalFaces: MeshFace[] = validFaces.map(f => ({
    ...f,
    indices: f.indices.map(i => remap.get(i) ?? 0)
  }));

  const removedFaces = initialFacesCount - finalFaces.length;
  const removedVerts = initialVertsCount - finalVerts.length;

  return {
    vertices: finalVerts,
    faces: finalFaces,
    report: {
      success: true,
      message: removedFaces > 0 || removedVerts > 0
        ? `¡Poda de escombros completada! Purgadas ${removedFaces} caras inservibles/duplicadas y ${removedVerts} vértices huérfanos.`
        : 'La malla ya estaba limpia; no se detectaron polígonos degradados ni caras duplicadas.',
      removedFaces,
      removedVertices: removedVerts,
      remainingFaces: finalFaces.length,
      remainingVertices: finalVerts.length
    }
  };
}
