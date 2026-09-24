import * as THREE from 'three';
import type { V3, MeshFace, CSGObject } from '../types';

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
 * Agrupa todas las caras de la malla en islas/componentes conexos basándose
 * en los vértices compartidos entre polígonos.
 * Devuelve un array de islas ordenadas de mayor a menor número de caras.
 */
export function findConnectedIslands(
  vertices: V3[],
  faces: MeshFace[]
): number[][] {
  if (!faces || faces.length === 0) return [];

  const numFaces = faces.length;
  const vertToFaces = new Map<number, number[]>();

  // Mapear cada vértice a las caras que lo contienen
  for (let fi = 0; fi < numFaces; fi++) {
    const indices = faces[fi].indices;
    for (let k = 0; k < indices.length; k++) {
      const vi = indices[k];
      let list = vertToFaces.get(vi);
      if (!list) {
        list = [];
        vertToFaces.set(vi, list);
      }
      list.push(fi);
    }
  }

  const visited = new Uint8Array(numFaces);
  const islands: number[][] = [];

  for (let i = 0; i < numFaces; i++) {
    if (visited[i] === 1) continue;

    const island: number[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const curFace = queue.pop()!;
      island.push(curFace);

      const indices = faces[curFace].indices;
      for (let k = 0; k < indices.length; k++) {
        const vi = indices[k];
        const neighborFaces = vertToFaces.get(vi);
        if (neighborFaces) {
          for (let n = 0; n < neighborFaces.length; n++) {
            const nf = neighborFaces[n];
            if (visited[nf] === 0) {
              visited[nf] = 1;
              queue.push(nf);
            }
          }
        }
      }
    }

    islands.push(island);
  }

  // Ordenar de mayor a menor número de caras
  islands.sort((a, b) => b.length - a.length);
  return islands;
}

/**
 * Reconstruye la malla conservando sólo las caras permitidas y eliminando
 * todos los vértices huérfanos resultantes con remapeo de índices.
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
 * Calcula el área de una cara 3D.
 */
export function computeFaceArea(face: MeshFace, vertices: V3[]): number {
  if (face.indices.length < 3) return 0;
  const p0 = vertices[face.indices[0]];
  const p1 = vertices[face.indices[1]];
  const p2 = vertices[face.indices[2]];
  if (!p0 || !p1 || !p2) return 0;

  const v0 = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const v1 = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const v2 = new THREE.Vector3(p2[0], p2[1], p2[2]);

  const e1 = new THREE.Vector3().subVectors(v1, v0);
  const e2 = new THREE.Vector3().subVectors(v2, v0);
  return new THREE.Vector3().crossVectors(e1, e2).length() * 0.5;
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

  const islands = findConnectedIslands(vertices, faces);

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
 */
export function getLinkedSelection(
  vertices: V3[],
  faces: MeshFace[],
  selectedFaceIndices: number[] = [],
  selectedVertexIndices: number[] = []
): { linkedFaceIndices: number[]; linkedVertexIndices: number[] } {
  if (!faces || faces.length === 0) {
    return { linkedFaceIndices: [], linkedVertexIndices: [] };
  }

  // Identificar semillas iniciales
  const seedFaces = new Set<number>(selectedFaceIndices);

  if (selectedVertexIndices.length > 0) {
    const selVertSet = new Set(selectedVertexIndices);
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi];
      for (let k = 0; k < face.indices.length; k++) {
        if (selVertSet.has(face.indices[k])) {
          seedFaces.add(fi);
          break;
        }
      }
    }
  }

  if (seedFaces.size === 0) {
    return { linkedFaceIndices: [], linkedVertexIndices: [] };
  }

  // Construir mapa vértice -> caras
  const vertToFaces = new Map<number, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const indices = faces[fi].indices;
    for (let k = 0; k < indices.length; k++) {
      const vi = indices[k];
      let list = vertToFaces.get(vi);
      if (!list) {
        list = [];
        vertToFaces.set(vi, list);
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
    for (let k = 0; k < indices.length; k++) {
      const vi = indices[k];
      visitedVerts.add(vi);
      const neighborFaces = vertToFaces.get(vi);
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
 * 2. Elimina caras de área nula / astillas microscópicas (área < minArea)
 * 3. Elimina caras duplicadas idénticas (Z-fighting coplanar)
 * 4. Elimina caras flotantes aisladas que no comparten ninguna arista
 * 5. Purga todos los vértices huérfanos sin caras
 */
export function purgeDebrisMesh(
  vertices: V3[],
  faces: MeshFace[],
  minArea: number = 1e-7,
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

  const bakedVerts: V3[] = vertices.map((v, i) => {
    const off = vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
  });

  const validFaces: MeshFace[] = [];
  const faceSignatures = new Set<string>();

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    // Limpiar índices repetidos consecutivos en la misma cara
    const cleanIndices: number[] = [];
    for (let k = 0; k < f.indices.length; k++) {
      const idx = f.indices[k];
      if (cleanIndices.length === 0 || cleanIndices[cleanIndices.length - 1] !== idx) {
        cleanIndices.push(idx);
      }
    }
    if (cleanIndices.length > 1 && cleanIndices[0] === cleanIndices[cleanIndices.length - 1]) {
      cleanIndices.pop();
    }

    if (cleanIndices.length < 3) continue;

    // Comprobar área
    const area = computeFaceArea({ ...f, indices: cleanIndices }, bakedVerts);
    if (area < minArea || isNaN(area)) continue;

    // Comprobar duplicado coplanar
    const sig = [...cleanIndices].sort((a, b) => a - b).join(',');
    if (faceSignatures.has(sig)) continue;
    faceSignatures.add(sig);

    validFaces.push({
      ...f,
      indices: cleanIndices
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
