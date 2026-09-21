import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { CSGObject, V3, MeshFace } from '../types';
import { convertImportedToCSG } from './modifiers_advanced';
import { createBaseGeometry } from './csg';
import { fromThreeGeometry } from './modifiers';

/**
 * Comprueba si un objeto CSGObject posee sub-objetos o figuras.
 */
export function hasChildrenOrSubObjects(obj: CSGObject | null): boolean {
  if (!obj) return false;
  if (obj.meshData) {
    return true;
  }
  if (obj.vertices && obj.vertices.length > 0 && obj.faces && obj.faces.length > 0) {
    return true;
  }
  return false;
}

/**
 * Agrupa islas / partes basándose en la distancia MÍNIMA entre sus puntos/vértices reales (no solo AABB).
 * Utiliza Kruskal MST y detecta el salto de distancia (gap) que separa figuras distintas.
 */
export function clusterIslandsByPoints(islandPoints: THREE.Vector3[][]): number[][] {
  const n = islandPoints.length;
  if (n === 0) return [];
  if (n === 1) return [[0]];

  // Downsample de puntos por isla para un cálculo ultra-rápido y preciso
  const sampledPoints: THREE.Vector3[][] = islandPoints.map((pts) => {
    if (pts.length <= 40) return pts;
    const step = Math.floor(pts.length / 40);
    const res: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length; i += step) {
      res.push(pts[i]);
      if (res.length >= 40) break;
    }
    return res;
  });

  // Distancia euclidiana mínima real entre dos islas de puntos
  function minDistanceBetweenIslands(i: number, j: number): number {
    const ptsA = sampledPoints[i];
    const ptsB = sampledPoints[j];
    let minD = Infinity;
    for (let a = 0; a < ptsA.length; a++) {
      const pA = ptsA[a];
      for (let b = 0; b < ptsB.length; b++) {
        const d = pA.distanceTo(ptsB[b]);
        if (d < minD) {
          minD = d;
          if (minD < 0.0001) return 0;
        }
      }
    }
    return minD;
  }

  // MST mediante Kruskal
  interface Edge { u: number; v: number; w: number; }
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push({ u: i, v: j, w: minDistanceBetweenIslands(i, j) });
    }
  }
  edges.sort((a, b) => a.w - b.w);

  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] === i) return i;
    return parent[i] = find(parent[i]);
  }

  const mstEdges: Edge[] = [];
  for (const e of edges) {
    const rootU = find(e.u);
    const rootV = find(e.v);
    if (rootU !== rootV) {
      parent[rootU] = rootV;
      mstEdges.push(e);
      if (mstEdges.length === n - 1) break;
    }
  }

  // Analizar pesos del MST para encontrar la brecha o salto adaptativo entre objetos
  const mstWeights = mstEdges.map((e) => e.w).sort((a, b) => a - b);
  const maxW = mstWeights[mstWeights.length - 1] || 0;

  // Si la distancia máxima en el MST es insignificante (< 0.015), es 1 solo objeto unificado
  if (maxW < 0.015) {
    return [Array.from({ length: n }, (_, i) => i)];
  }

  // Buscar el mayor salto (gap) significativo entre distancias inter-islas
  let cutThreshold = Infinity;
  let maxScore = 0;

  for (let i = 0; i < mstWeights.length - 1; i++) {
    const w1 = mstWeights[i];
    const w2 = mstWeights[i + 1];
    const gap = w2 - w1;

    // Evaluamos el salto si w2 supera un mínimo perceptible (p. ej. 0.02)
    if (w2 > 0.02 && gap > 0.03) {
      // Score combina el salto absoluto y la proporción relativa
      const ratio = w2 / Math.max(w1, 0.005);
      const score = gap * ratio;

      if (score > maxScore) {
        maxScore = score;
        cutThreshold = (w1 + w2) / 2;
      }
    }
  }

  // Si no se detectó ningún salto relevante de separación entre figuras,
  // todas las islas forman 1 solo objeto unificado.
  if (cutThreshold === Infinity) {
    return [Array.from({ length: n }, (_, i) => i)];
  }

  // Re-conectar usando únicamente aristas de distancia menor a cutThreshold
  const clusterParent = Array.from({ length: n }, (_, i) => i);
  function findCluster(i: number): number {
    if (clusterParent[i] === i) return i;
    return clusterParent[i] = findCluster(clusterParent[i]);
  }

  for (const e of mstEdges) {
    if (e.w < cutThreshold) {
      const rU = findCluster(e.u);
      const rV = findCluster(e.v);
      if (rU !== rV) {
        clusterParent[rU] = rV;
      }
    }
  }

  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = findCluster(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(i);
  }

  return Array.from(clusterMap.values());
}

/**
 * Agrupa cajas delimitadoras (Bounding Boxes) en figuras principales independientes
 */
export function clusterIslandsIntoFigures(boxes: THREE.Box3[]): number[][] {
  const n = boxes.length;
  if (n === 0) return [];
  if (n === 1) return [[0]];

  // Convertir cada Box3 a 8 puntos de esquinas para poder usar el clustering de puntos real
  const islandPoints: THREE.Vector3[][] = boxes.map((b) => [
    new THREE.Vector3(b.min.x, b.min.y, b.min.z),
    new THREE.Vector3(b.max.x, b.min.y, b.min.z),
    new THREE.Vector3(b.min.x, b.max.y, b.min.z),
    new THREE.Vector3(b.max.x, b.max.y, b.min.z),
    new THREE.Vector3(b.min.x, b.min.y, b.max.z),
    new THREE.Vector3(b.max.x, b.min.y, b.max.z),
    new THREE.Vector3(b.min.x, b.max.y, b.max.z),
    new THREE.Vector3(b.max.x, b.max.y, b.max.z),
  ]);

  return clusterIslandsByPoints(islandPoints);
}

/**
 * Desagrupar / Separar Conjunto (Ungroup / Separate Objects)
 * Analiza el objeto seleccionado (archivo 3D importado GLTF/OBJ/STL o malla CSG).
 * Agrupa inteligentemente submallas e islas geométricas por proximidad para extraer las
 * FIGURAS PRINCIPALES INTACTAS (por ejemplo, 3 naves completas independientes).
 */
export async function ungroupObject(obj: CSGObject): Promise<{
  success: boolean;
  objects?: CSGObject[];
  message: string;
}> {
  if (!obj) {
    return { success: false, message: 'No hay ningún objeto seleccionado.' };
  }

  let workingObj = obj;
  if (workingObj.meshData) {
    try {
      workingObj = await convertImportedToCSG(workingObj);
    } catch (e) {
      console.error('Error convirtiendo modelo para desagrupar:', e);
    }
  }

  return await ungroupCSGObjectBySpatialIslands(workingObj);
}

/**
 * Desagrupa un CSGObject (malla geométrica) separando sus islas desconectadas
 * y agrupándolas por proximidad espacial MST para extraer figuras completas independientes.
 */
async function ungroupCSGObjectBySpatialIslands(obj: CSGObject): Promise<{
  success: boolean;
  objects?: CSGObject[];
  message: string;
}> {
  let workingObj = obj;

  if (workingObj.meshData) {
    try {
      workingObj = await convertImportedToCSG(workingObj);
    } catch (e) {
      console.error('Error convirtiendo modelo a CSG para desagrupar:', e);
    }
  }

  let vertices = workingObj.vertices || [];
  let faces = workingObj.faces || [];

  if (!vertices.length || !faces.length) {
    try {
      const geo = createBaseGeometry(workingObj);
      const res = fromThreeGeometry(geo);
      vertices = res.vertices;
      faces = res.faces;
    } catch (e) {
      console.error('Error extrayendo geometría base para desagrupar:', e);
    }
  }

  if (!vertices.length || !faces.length) {
    return {
      success: false,
      message: 'El objeto seleccionado no posee caras o vértices válidos para desagrupar.',
    };
  }

  // 1. Matriz de transformación global para calcular posiciones del mundo
  const pos = workingObj.transform.position;
  const rot = workingObj.transform.rotation;
  const sca = workingObj.transform.scale;

  const worldMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ')),
    new THREE.Vector3(sca[0], sca[1], sca[2])
  );

  // 2. Mapeo espacial de vértices para identificar islas continuas
  const vertexToKey = (v: V3): string => `${v[0].toFixed(4)}_${v[1].toFixed(4)}_${v[2].toFixed(4)}`;
  const vertexKeyMap = new Map<number, string>();
  vertices.forEach((v, idx) => {
    vertexKeyMap.set(idx, vertexToKey(v));
  });

  const keyToFaces = new Map<string, number[]>();
  faces.forEach((face, faceIdx) => {
    face.indices.forEach((vIdx) => {
      const key = vertexKeyMap.get(vIdx);
      if (key) {
        if (!keyToFaces.has(key)) keyToFaces.set(key, []);
        keyToFaces.get(key)!.push(faceIdx);
      }
    });
  });

  const faceVisited = new Array(faces.length).fill(false);
  const looseIslands: number[][] = [];

  for (let i = 0; i < faces.length; i++) {
    if (faceVisited[i]) continue;
    const island: number[] = [];
    const queue: number[] = [i];
    faceVisited[i] = true;

    while (queue.length > 0) {
      const currFaceIdx = queue.pop()!;
      island.push(currFaceIdx);

      const face = faces[currFaceIdx];
      for (const vIdx of face.indices) {
        const key = vertexKeyMap.get(vIdx);
        if (!key) continue;
        const neighborFaces = keyToFaces.get(key) || [];
        for (const neighborIdx of neighborFaces) {
          if (!faceVisited[neighborIdx]) {
            faceVisited[neighborIdx] = true;
            queue.push(neighborIdx);
          }
        }
      }
    }
    looseIslands.push(island);
  }

  if (looseIslands.length <= 1) {
    return {
      success: false,
      message: 'El objeto seleccionado consta de una sola figura continua y no se puede desagrupar.',
    };
  }

  // 3. Calcular Bounding Box y puntos de cada isla en coordenadas del mundo
  const islandBoxes: THREE.Box3[] = [];
  const islandPoints: THREE.Vector3[][] = [];

  looseIslands.forEach((island) => {
    const box = new THREE.Box3();
    const pts: THREE.Vector3[] = [];
    const vSet = new Set<number>();
    island.forEach((fIdx) => faces[fIdx].indices.forEach((vIdx) => vSet.add(vIdx)));

    vSet.forEach((vIdx) => {
      const localV = vertices[vIdx];
      const worldV = new THREE.Vector3(localV[0], localV[1], localV[2]).applyMatrix4(worldMatrix);
      box.expandByPoint(worldV);
      pts.push(worldV);
    });
    islandBoxes.push(box);
    islandPoints.push(pts);
  });

  // 4. Agrupar islas por brechas espaciales adaptativas usando distancias entre vértices reales (MST)
  const clusters = clusterIslandsByPoints(islandPoints);

  if (clusters.length <= 1) {
    return {
      success: false,
      message: `El objeto seleccionado es una sola figura unida continua. (Contiene ${looseIslands.length} piezas sueltas que puedes separar con "Separar por partes sueltas").`,
    };
  }

  // 5. Construir un objeto CSGObject independiente por cada figura principal detectada
  const newObjects: CSGObject[] = [];

  for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
    const islandIndices = clusters[cIdx];

    const clusterBox = new THREE.Box3();
    islandIndices.forEach((iIdx) => clusterBox.union(islandBoxes[iIdx]));
    const clusterCenter = clusterBox.getCenter(new THREE.Vector3());

    const clusterFaceIndicesSet = new Set<number>();
    islandIndices.forEach((iIdx) => {
      looseIslands[iIdx].forEach((fIdx) => clusterFaceIndicesSet.add(fIdx));
    });

    const usedLocalVertexIndices = new Set<number>();
    clusterFaceIndicesSet.forEach((fIdx) => {
      faces[fIdx].indices.forEach((vIdx) => usedLocalVertexIndices.add(vIdx));
    });

    const oldToNewVertexMap = new Map<number, number>();
    const newVertices: V3[] = [];

    usedLocalVertexIndices.forEach((vIdx) => {
      const origV = vertices[vIdx];
      const worldV = new THREE.Vector3(origV[0], origV[1], origV[2]).applyMatrix4(worldMatrix);

      const relX = worldV.x - clusterCenter.x;
      const relY = worldV.y - clusterCenter.y;
      const relZ = worldV.z - clusterCenter.z;

      oldToNewVertexMap.set(vIdx, newVertices.length);
      newVertices.push([relX, relY, relZ]);
    });

    const newFaces: MeshFace[] = [];
    clusterFaceIndicesSet.forEach((fIdx) => {
      const oldFace = faces[fIdx];
      const newIndices = oldFace.indices.map((vIdx) => oldToNewVertexMap.get(vIdx)!);
      newFaces.push({
        ...oldFace,
        indices: newIndices,
      });
    });

    newObjects.push({
      id: Math.random().toString(36).substring(2, 11),
      name: `${obj.name}_figura_${cIdx + 1}`,
      type: 'MESH',
      operation: 'ADD',
      transform: {
        position: [
          parseFloat(clusterCenter.x.toFixed(4)),
          parseFloat(clusterCenter.y.toFixed(4)),
          parseFloat(clusterCenter.z.toFixed(4)),
        ],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      parameters: {},
      vertices: newVertices,
      faces: newFaces,
      color: obj.color || '#ffffff',
      opacity: obj.opacity ?? 1,
      visible: true,
      keyframes: [],
      stats: {
        vertices: newVertices.length,
        faces: newFaces.length,
      },
    });
  }

  return {
    success: true,
    objects: newObjects,
    message: `¡Éxito! Se desagruparon ${newObjects.length} figuras independientes en la escena.`,
  };
}
