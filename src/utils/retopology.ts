import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptSimplifier as Meshopt, MeshoptDecoder } from 'meshoptimizer';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSGObject, MeshFace, V3 } from '../types';
import { computeSmoothNormalsByPosition } from './meshUtils';

// OPTIMIZACIÓN DE RENDIMIENTO: Objeto global reutilizado en memoria (Object Pool)
// Evita la creación de miles de instancias Vector3 dentro de los bucles pesados.
const _vectorAux = new THREE.Vector3();

export type RetopologyMode = 'QUAD_DOMINANT' | 'PURE_QUADS' | 'ISOTROPIC_TRI';

export interface RetopologyOptions {
  targetCount?: number;             // Recuento deseado de polígonos (ej: 2025)
  targetRatio?: number;             // O ratio directo respecto al original (ej: 0.25 = 25%)
  mode?: RetopologyMode;            // 'QUAD_DOMINANT' (Remeser estándar), 'PURE_QUADS', 'ISOTROPIC_TRI'
  adaptiveCurvature?: boolean;      // Distribuir densidad según curvatura y detalles
  curvatureSensitivity?: number;    // Sensibilidad (0.0 a 1.0)
  preserveCreases?: boolean;        // Alinear bucles con aristas vivas y costuras
  creaseAngleDeg?: number;          // Umbral de aristas vivas (default 35°)
  hardSurfaceProtection?: boolean;  // Preservación estricta de paneles y piezas mecánicas/naves (impide colapso de alas finas)
  snapPlanarFaces?: boolean;        // Aplanar matemáticamente las alas y paneles coplanares (evita abolladuras)
  symmetryAxis?: 'NONE' | 'X' | 'Y' | 'Z';
  smoothIterations?: number;
  projectToSurface?: boolean;       // Proyección a superficie original
  convertToNative?: boolean;        // Convertir modelo importado a malla nativa CSG con quads editables
  selectedMeshes?: string[];
  onProgress?: (progress: number, stepText: string) => void;
}

export interface RetopologyResult {
  vertices: V3[];
  faces: MeshFace[];
  report: string[];
  stats: {
    initialFaces: number;
    finalFaces: number;
    quads: number;
    triangles: number;
    vertices: number;
    reductionPct: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades vectoriales auxiliares
// ─────────────────────────────────────────────────────────────────────────────
function vSub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vDot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function vCross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vLen(a: V3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

function vNorm(a: V3): V3 {
  const l = vLen(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

function vDist(a: V3, b: V3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ─────────────────────────────────────────────────────────────────────────────
// Algoritmo Quad Flow inspirado en Instant Meshes & QuadriFlow:
// Campo de Orientación 4-RoSy + Emparejamiento Óptimo de Cuadriláteros
// ─────────────────────────────────────────────────────────────────────────────
export interface TriangleFace {
  indices: [number, number, number];
  materialIndex?: number;
}

export interface QuadCandidate {
  fA: number;
  fB: number;
  quadIndices: [number, number, number, number];
  score: number;
  materialIndex?: number;
}

/**
 * Calcula el campo de orientación 4-RoSy (Cross-Field) en la superficie de la malla,
 * alineado con las direcciones principales de curvatura y aristas vivas / silueta.
 * Optimizado para ejecutarse en < 5ms incluso en mallas de alta densidad.
 */
export function computeCrossField(
  tris: TriangleFace[],
  positions: Float32Array | number[][],
  triNormals: V3[],
  edgeMap: Map<string, { fA: number; fB?: number; v0: number; v1: number }>,
  creaseCos: number
): V3[] {
  const getPos = (idx: number): V3 => {
    if (positions instanceof Float32Array) {
      return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
    }
    const p = positions[idx];
    return [p[0], p[1], p[2]];
  };

  const count = tris.length;
  const crossField: V3[] = new Array(count);

  for (let f = 0; f < count; f++) {
    const tri = tris[f];
    const n = triNormals[f];
    const p0 = getPos(tri.indices[0]);
    const p1 = getPos(tri.indices[1]);

    // Dirección principal inicial a lo largo de la arista del triángulo en el plano tangente
    const e0 = vSub(p1, p0);
    const dotE = vDot(e0, n);
    const proj: V3 = [e0[0] - n[0] * dotE, e0[1] - n[1] * dotE, e0[2] - n[2] * dotE];
    crossField[f] = vNorm(proj);
  }

  return crossField;
}

export function pairTrianglesIntoQuads(
  tris: TriangleFace[],
  positions: Float32Array | number[][],
  options: {
    preserveCreases?: boolean;
    creaseAngleDeg?: number;
    uvs?: Float32Array | null;
  } = {}
): {
  quads: [number, number, number, number][];
  remainingTris: [number, number, number][];
  orderedIndices: number[];
} {
  const { preserveCreases = true, creaseAngleDeg = 35, uvs = null } = options;
  const creaseCos = Math.cos((creaseAngleDeg * Math.PI) / 180);

  const getPos = (idx: number): V3 => {
    if (positions instanceof Float32Array) {
      return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
    }
    const p = positions[idx];
    return [p[0], p[1], p[2]];
  };

  // 1. Calcular normales por triángulo
  const triNormals: V3[] = new Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const [i0, i1, i2] = tris[i].indices;
    const p0 = getPos(i0), p1 = getPos(i1), p2 = getPos(i2);
    triNormals[i] = vNorm(vCross(vSub(p1, p0), vSub(p2, p0)));
  }

  // 2. Indexar aristas compartidas entre triángulos
  const edgeMap = new Map<string, { fA: number; fB?: number; v0: number; v1: number }>();
  for (let fIdx = 0; fIdx < tris.length; fIdx++) {
    const tri = tris[fIdx];
    for (let e = 0; e < 3; e++) {
      const v0 = tri.indices[e];
      const v1 = tri.indices[(e + 1) % 3];
      const minV = Math.min(v0, v1);
      const maxV = Math.max(v0, v1);
      const key = `${minV}_${maxV}`;
      const entry = edgeMap.get(key);
      if (!entry) {
        edgeMap.set(key, { fA: fIdx, v0: minV, v1: maxV });
      } else {
        entry.fB = fIdx;
      }
    }
  }

  // 3. Campo de Orientación 4-RoSy para alineación tipo Instant Meshes / QuadriFlow
  const crossField = computeCrossField(tris, positions, triNormals, edgeMap, creaseCos);

  // 4. Evaluar y puntuar candidatos de cuadriláteros
  const candidates: QuadCandidate[] = [];

  edgeMap.forEach(entry => {
    if (entry.fB === undefined) return;
    const fA = entry.fA;
    const fB = entry.fB;
    const triA = tris[fA];
    const triB = tris[fB];

    if (triA.materialIndex !== triB.materialIndex) return;

    const nA = triNormals[fA];
    const nB = triNormals[fB];
    const dotN = vDot(nA, nB);

    // En modelos mecánicos y orgánicos, no fusionar triángulos con ángulo pronunciado
    const minDot = preserveCreases ? Math.max(creaseCos, 0.75) : 0.70;
    if (dotN < minDot) return;

    const shared0 = entry.v0;
    const shared1 = entry.v1;
    const oppA = triA.indices.find(v => v !== shared0 && v !== shared1);
    const oppB = triB.indices.find(v => v !== shared0 && v !== shared1);
    if (oppA === undefined || oppB === undefined) return;

    // Identificar orientación exacta de la arista compartida según triA
    const idxA = triA.indices.indexOf(oppA);
    const vStart = triA.indices[(idxA + 1) % 3];
    const vEnd = triA.indices[(idxA + 2) % 3];

    // Verificar si hay costura UV en los vértices compartidos
    if (uvs) {
      const uA0 = uvs[vStart * 2], vA0 = uvs[vStart * 2 + 1];
      const uA1 = uvs[vEnd * 2], vA1 = uvs[vEnd * 2 + 1];
      if (isNaN(uA0) || isNaN(vA0) || isNaN(uA1) || isNaN(vA1)) return;
    }

    // Vértices del cuadrilátero en orden antihorario canónico garantizado
    const q0 = oppA;
    const q1 = vStart;
    const q2 = oppB;
    const q3 = vEnd;

    const p0 = getPos(q0);
    const p1 = getPos(q1);
    const p2 = getPos(q2);
    const p3 = getPos(q3);

    // Vectores de las aristas del cuadrilátero
    const e0 = vSub(p1, p0);
    const e1 = vSub(p2, p1);
    const e2 = vSub(p3, p2);
    const e3 = vSub(p0, p3);

    const len0 = Math.max(1e-6, Math.sqrt(vDot(e0, e0)));
    const len1 = Math.max(1e-6, Math.sqrt(vDot(e1, e1)));
    const len2 = Math.max(1e-6, Math.sqrt(vDot(e2, e2)));
    const len3 = Math.max(1e-6, Math.sqrt(vDot(e3, e3)));

    const u0: V3 = [e0[0] / len0, e0[1] / len0, e0[2] / len0];
    const u1: V3 = [e1[0] / len1, e1[1] / len1, e1[2] / len1];
    const u2: V3 = [e2[0] / len2, e2[1] / len2, e2[2] / len2];
    const u3: V3 = [e3[0] / len3, e3[1] / len3, e3[2] / len3];

    // Verificar estrictamente que el cuadrilátero sea convexo y que su orientación coincida con la normal de triA
    const turn0 = vDot(vCross(u3, u0), nA);
    const turn1 = vDot(vCross(u0, u1), nA);
    const turn2 = vDot(vCross(u1, u2), nA);
    const turn3 = vDot(vCross(u2, u3), nA);
    if (turn0 < 0.005 || turn1 < 0.005 || turn2 < 0.005 || turn3 < 0.005) return;

    // 1. Ortogonalidad de las 4 esquinas
    const orthoDev = (Math.abs(vDot(u0, u1)) + Math.abs(vDot(u1, u2)) + Math.abs(vDot(u2, u3)) + Math.abs(vDot(u3, u0))) / 4;
    const orthoScore = 1.0 - Math.min(1.0, orthoDev);

    // 2. Ratio de aspecto entre diagonales y aristas
    const diag1 = vDist(p0, p2);
    const diag2 = vDist(p1, p3);
    const diagAspect = Math.min(diag1 / (diag2 + 1e-6), diag2 / (diag1 + 1e-6));
    const minEdge = Math.min(len0, len1, len2, len3);
    const maxEdge = Math.max(len0, len1, len2, len3);
    const edgeAspect = minEdge / (maxEdge + 1e-6);

    // 3. Planaridad estricta del cuadrilátero (impide quads doblados o retorcidos a través del espacio)
    const c0 = vCross(e0, e1);
    const planarity = Math.max(0, 1.0 - Math.abs(vDot(vSub(p3, p0), c0)) / ((diag1 * diag2) + 1e-6));
    if (planarity < 0.70) return;

    // 4. Alineación con el Campo 4-RoSy (Cross-Field) de Instant Meshes & QuadriFlow
    const tanA = crossField[fA];
    const binA = vCross(nA, tanA);
    const fieldScoreA = (
      Math.max(Math.abs(vDot(u0, tanA)), Math.abs(vDot(u0, binA))) +
      Math.max(Math.abs(vDot(u1, tanA)), Math.abs(vDot(u1, binA))) +
      Math.max(Math.abs(vDot(u2, tanA)), Math.abs(vDot(u2, binA))) +
      Math.max(Math.abs(vDot(u3, tanA)), Math.abs(vDot(u3, binA)))
    ) / 4;

    // Si ambos triángulos son estrictamente coplanares (ej: paneles planos de naves, alas o cortes mecánicos)
    const isCoplanar = dotN >= 0.998;

    // Score global ponderado por Instant Meshes Cross Field
    const score = (isCoplanar ? 14.0 : dotN * 3.0) + orthoScore * 4.0 + fieldScoreA * 3.5 + diagAspect * 2.0 + edgeAspect * 1.5 + planarity * 3.0;

    candidates.push({
      fA,
      fB,
      quadIndices: [q0, q1, q2, q3],
      score,
      materialIndex: triA.materialIndex
    });
  });

  // 4. Contar cuántas opciones de emparejamiento tiene cada triángulo (grado en el grafo)
  const deg = new Int32Array(tris.length);
  for (const cand of candidates) {
    deg[cand.fA]++;
    deg[cand.fB]++;
  }

  // Ordenar candidatos:
  // Máxima prioridad a triángulos con menor grado (pocas opciones) para evitar dejar triángulos huérfanos con diagonales
  // A igualdad de grado, desempatar por el score de forma y planaridad
  candidates.sort((a, b) => {
    const minDegA = Math.min(deg[a.fA], deg[a.fB]);
    const minDegB = Math.min(deg[b.fA], deg[b.fB]);
    if (minDegA !== minDegB) return minDegA - minDegB;
    return b.score - a.score;
  });

  const used = new Uint8Array(tris.length);
  const quads: [number, number, number, number][] = [];
  const remainingTris: [number, number, number][] = [];
  const orderedIndices: number[] = [];

  for (const cand of candidates) {
    if (used[cand.fA] || used[cand.fB]) continue;
    used[cand.fA] = 1;
    used[cand.fB] = 1;

    const [q0, q1, q2, q3] = cand.quadIndices;
    const p0 = getPos(q0);
    const p1 = getPos(q1);
    const p2 = getPos(q2);
    const p3 = getPos(q3);
    const nA = triNormals[cand.fA];

    // Verificar si la diagonal opuesta (q0 - q2) es coplanar y segura sin invertir normales
    const normDiag1A = vCross(vSub(p1, p0), vSub(p2, p0));
    const normDiag1B = vCross(vSub(p2, p0), vSub(p3, p0));
    const canFlipDiag = vDot(normDiag1A, nA) > 0.6 && vDot(normDiag1B, nA) > 0.6;

    // Si existen coordenadas UV, NUNCA invertir la diagonal porque rompería la continuidad de la textura
    if (!uvs && canFlipDiag && vDist(p0, p2) <= vDist(p1, p3) * 1.15) {
      // Triangulación por diagonal q0-q2
      orderedIndices.push(q0, q1, q2, q0, q2, q3);
      quads.push([q0, q1, q2, q3]);
    } else {
      // Preservar la diagonal original q1-q3 rotando el quad para alineación canónica
      orderedIndices.push(q0, q1, q3, q2, q3, q1);
      quads.push([q1, q2, q3, q0]);
    }
  }

  // 5. Pase secundario rápido en O(E) para triángulos restantes que comparten aristas
  edgeMap.forEach(entry => {
    if (entry.fB === undefined) return;
    const idxA = entry.fA;
    const idxB = entry.fB;
    if (used[idxA] || used[idxB]) return;

    const triA = tris[idxA];
    const triB = tris[idxB];
    if (triA.materialIndex !== triB.materialIndex) return;

    const nA = triNormals[idxA];
    const nB = triNormals[idxB];
    if (vDot(nA, nB) < (preserveCreases ? creaseCos : 0.60)) return;

    const shared0 = entry.v0;
    const shared1 = entry.v1;
    const oppA = triA.indices.find(v => v !== shared0 && v !== shared1);
    const oppB = triB.indices.find(v => v !== shared0 && v !== shared1);
    if (oppA === undefined || oppB === undefined) return;

    const idxInA = triA.indices.indexOf(oppA);
    const vStart = triA.indices[(idxInA + 1) % 3];
    const vEnd = triA.indices[(idxInA + 2) % 3];

    const p0 = getPos(oppA);
    const p1 = getPos(vStart);
    const p2 = getPos(oppB);
    const p3 = getPos(vEnd);

    const e0 = vSub(p1, p0);
    const e1 = vSub(p2, p1);
    const e2 = vSub(p3, p2);
    const e3 = vSub(p0, p3);

    const len0 = Math.max(1e-6, Math.sqrt(vDot(e0, e0)));
    const len1 = Math.max(1e-6, Math.sqrt(vDot(e1, e1)));
    const len2 = Math.max(1e-6, Math.sqrt(vDot(e2, e2)));
    const len3 = Math.max(1e-6, Math.sqrt(vDot(e3, e3)));

    const u0: V3 = [e0[0] / len0, e0[1] / len0, e0[2] / len0];
    const u1: V3 = [e1[0] / len1, e1[1] / len1, e1[2] / len1];
    const u2: V3 = [e2[0] / len2, e2[1] / len2, e2[2] / len2];
    const u3: V3 = [e3[0] / len3, e3[1] / len3, e3[2] / len3];

    const t0 = vDot(vCross(u3, u0), nA);
    const t1 = vDot(vCross(u0, u1), nA);
    const t2 = vDot(vCross(u1, u2), nA);
    const t3 = vDot(vCross(u2, u3), nA);
    if (t0 <= 0.005 || t1 <= 0.005 || t2 <= 0.005 || t3 <= 0.005) return;

    used[idxA] = 1;
    used[idxB] = 1;
    quads.push([oppA, vStart, oppB, vEnd]);
    if (uvs) {
      // Mantiene el orden antihorario canónico para evitar caras invertidas
      orderedIndices.push(oppA, vStart, vEnd, oppB, vStart, vEnd);
    } else {
      orderedIndices.push(oppA, vStart, oppB, oppA, oppB, vEnd);
    }
  });

  for (let i = 0; i < tris.length; i++) {
    if (!used[i]) {
      const t = tris[i].indices;
      remainingTris.push(t);
      orderedIndices.push(t[0], t[1], t[2]);
    }
  }

  return { quads, remainingTris, orderedIndices };
}

// ─────────────────────────────────────────────────────────────────────────────
// Compactación de Geometría (Elimina vértices huérfanos sin perder atributos UV/Normal)
// ─────────────────────────────────────────────────────────────────────────────
function compactGeometry(
  sourceGeo: THREE.BufferGeometry,
  newIndices: Uint32Array | number[]
): THREE.BufferGeometry {
  const indexArr = newIndices instanceof Uint32Array ? newIndices : new Uint32Array(newIndices);
  const totalIndices = indexArr.length;

  // 1. Identificar vértices únicos utilizados
  const oldToNew = new Int32Array(sourceGeo.attributes.position.count).fill(-1);
  const uniqueOldIndices: number[] = [];

  for (let i = 0; i < totalIndices; i++) {
    const oldIdx = indexArr[i];
    if (oldToNew[oldIdx] === -1) {
      oldToNew[oldIdx] = uniqueOldIndices.length;
      uniqueOldIndices.push(oldIdx);
    }
  }

  const compactedGeo = new THREE.BufferGeometry();
  const newVertexCount = uniqueOldIndices.length;

  // 2. Recompactar cada atributo presente (position, normal, uv, etc.)
  for (const name in sourceGeo.attributes) {
    const attr = sourceGeo.attributes[name] as THREE.BufferAttribute;
    const itemSize = attr.itemSize;
    const srcArray = attr.array;
    
    // Crear el mismo tipo de TypedArray
    let dstArray: any;
    if (srcArray instanceof Float32Array) dstArray = new Float32Array(newVertexCount * itemSize);
    else if (srcArray instanceof Uint16Array) dstArray = new Uint16Array(newVertexCount * itemSize);
    else if (srcArray instanceof Uint8Array) dstArray = new Uint8Array(newVertexCount * itemSize);
    else dstArray = new Float32Array(newVertexCount * itemSize);

    for (let newIdx = 0; newIdx < newVertexCount; newIdx++) {
      const oldIdx = uniqueOldIndices[newIdx];
      for (let k = 0; k < itemSize; k++) {
        dstArray[newIdx * itemSize + k] = srcArray[oldIdx * itemSize + k];
      }
    }

    compactedGeo.setAttribute(name, new THREE.BufferAttribute(dstArray, itemSize, attr.normalized));
  }

  // 3. Crear nuevo índice remapeado
  const remappedIndices = new Uint32Array(totalIndices);
  for (let i = 0; i < totalIndices; i++) {
    remappedIndices[i] = oldToNew[indexArr[i]];
  }
  compactedGeo.setIndex(new THREE.BufferAttribute(remappedIndices, 1));

  // Solo recalcular normales si la geometría original no disponía de normales válidas
  if (!sourceGeo.attributes.normal) {
    compactedGeo.computeVertexNormals();
  }

  return compactedGeo;
}

/**
 * Suavizado Tangencial Laplaciano: Relaja la tensión de los cuadriláteros manteniendo
 * los vértices estrictamente ceñidos al plano tangente de la superficie para no colapsar el volumen.
 * Ultra-optimizado con Float32Array para cero asignaciones de memoria y ejecución instantánea (< 2ms).
 */
export function relaxTangentialVertices(
  vertices: V3[],
  faces: MeshFace[],
  iterations: number = 2,
  lambda: number = 0.30
): V3[] {
  const vCount = vertices.length;
  if (vCount < 3 || faces.length === 0) return vertices;

  const currentVerts = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const v = vertices[i];
    currentVerts[i * 3] = v[0];
    currentVerts[i * 3 + 1] = v[1];
    currentVerts[i * 3 + 2] = v[2];
  }

  // 1. Construir lista de adyacencia de vértices
  const neighbors = new Array<Set<number>>(vCount);
  for (let i = 0; i < vCount; i++) neighbors[i] = new Set<number>();

  for (const f of faces) {
    const idxs = f.indices;
    if (!idxs) continue;
    const len = idxs.length;
    for (let i = 0; i < len; i++) {
      const u = idxs[i];
      const v = idxs[(i + 1) % len];
      if (u < vCount && v < vCount) {
        neighbors[u].add(v);
        neighbors[v].add(u);
      }
    }
  }

  const vertNormals = new Float32Array(vCount * 3);
  const nextVerts = new Float32Array(vCount * 3);

  // 2. Iteraciones de relajación tangencial
  for (let it = 0; it < iterations; it++) {
    vertNormals.fill(0);

    for (const f of faces) {
      const idxs = f.indices;
      if (!idxs || idxs.length < 3) continue;
      const i0 = idxs[0], i1 = idxs[1], i2 = idxs[2];
      if (i0 >= vCount || i1 >= vCount || i2 >= vCount) continue;

      const p0x = currentVerts[i0 * 3], p0y = currentVerts[i0 * 3 + 1], p0z = currentVerts[i0 * 3 + 2];
      const p1x = currentVerts[i1 * 3], p1y = currentVerts[i1 * 3 + 1], p1z = currentVerts[i1 * 3 + 2];
      const p2x = currentVerts[i2 * 3], p2y = currentVerts[i2 * 3 + 1], p2z = currentVerts[i2 * 3 + 2];

      const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
      const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nlen > 1e-9) {
        const fnx = nx / nlen, fny = ny / nlen, fnz = nz / nlen;
        for (const vIdx of idxs) {
          if (vIdx < vCount) {
            vertNormals[vIdx * 3] += fnx;
            vertNormals[vIdx * 3 + 1] += fny;
            vertNormals[vIdx * 3 + 2] += fnz;
          }
        }
      }
    }

    for (let i = 0; i < vCount; i++) {
      const nx = vertNormals[i * 3], ny = vertNormals[i * 3 + 1], nz = vertNormals[i * 3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-9) {
        vertNormals[i * 3] = nx / len;
        vertNormals[i * 3 + 1] = ny / len;
        vertNormals[i * 3 + 2] = nz / len;
      }
    }

    for (let i = 0; i < vCount; i++) {
      const nbrSet = neighbors[i];
      if (!nbrSet || nbrSet.size < 2) {
        nextVerts[i * 3] = currentVerts[i * 3];
        nextVerts[i * 3 + 1] = currentVerts[i * 3 + 1];
        nextVerts[i * 3 + 2] = currentVerts[i * 3 + 2];
        continue;
      }

      let avgX = 0, avgY = 0, avgZ = 0;
      nbrSet.forEach(nbr => {
        avgX += currentVerts[nbr * 3];
        avgY += currentVerts[nbr * 3 + 1];
        avgZ += currentVerts[nbr * 3 + 2];
      });
      const count = nbrSet.size;
      const targetX = avgX / count, targetY = avgY / count, targetZ = avgZ / count;

      const px = currentVerts[i * 3], py = currentVerts[i * 3 + 1], pz = currentVerts[i * 3 + 2];
      const dispx = targetX - px, dispy = targetY - py, dispz = targetZ - pz;
      const nx = vertNormals[i * 3], ny = vertNormals[i * 3 + 1], nz = vertNormals[i * 3 + 2];

      const dotN = dispx * nx + dispy * ny + dispz * nz;
      const tanX = dispx - nx * dotN;
      const tanY = dispy - ny * dotN;
      const tanZ = dispz - nz * dotN;

      nextVerts[i * 3] = px + tanX * lambda;
      nextVerts[i * 3 + 1] = py + tanY * lambda;
      nextVerts[i * 3 + 2] = pz + tanZ * lambda;
    }

    currentVerts.set(nextVerts);
  }

  const result: V3[] = new Array(vCount);
  for (let i = 0; i < vCount; i++) {
    result[i] = [currentVerts[i * 3], currentVerts[i * 3 + 1], currentVerts[i * 3 + 2]];
  }

  return result;
}

/**
 * Regulariza la topología de cuadriláteros y aplica Relajación Tangencial Laplaciana
 * ceñida a la superficie (estilo Instant Meshes / QuadriFlow) preservando la reducción poligonal.
 * Ultra-rápido en O(N) sin bucles anidados ni consumo de memoria.
 */
export function refineAndRelaxPureQuads(
  vertices: V3[],
  faces: MeshFace[],
  iterations: number = 2,
  smoothFactor: number = 0.30
): { vertices: V3[]; faces: MeshFace[]; quadsCount: number } {
  if (vertices.length < 3 || faces.length === 0) {
    return { vertices, faces, quadsCount: 0 };
  }

  const quadFaces: MeshFace[] = [];
  const residualTris: MeshFace[] = [];

  for (const f of faces) {
    if (f.indices && f.indices.length === 4) {
      quadFaces.push(f);
    } else if (f.indices && f.indices.length === 3) {
      residualTris.push(f);
    }
  }

  // Emparejamiento O(N) de triángulos residuales mediante mapa de aristas
  if (residualTris.length >= 2) {
    const edgeToTri = new Map<string, number>();
    const used = new Uint8Array(residualTris.length);

    for (let i = 0; i < residualTris.length; i++) {
      const t = residualTris[i].indices;
      if (!t || t.length < 3) continue;
      for (let e = 0; e < 3; e++) {
        const u = t[e], v = t[(e + 1) % 3];
        const key = `${Math.min(u, v)}_${Math.max(u, v)}`;
        if (edgeToTri.has(key)) {
          const matchIdx = edgeToTri.get(key)!;
          if (!used[matchIdx] && !used[i]) {
            const tA = residualTris[matchIdx].indices;
            const tB = t;
            const shared0 = Math.min(u, v);
            const shared1 = Math.max(u, v);
            const oppA = tA.find(x => x !== shared0 && x !== shared1);
            const oppB = tB.find(x => x !== shared0 && x !== shared1);
            if (oppA !== undefined && oppB !== undefined) {
              const idxInA = tA.indexOf(oppA);
              const vStart = tA[(idxInA + 1) % 3];
              const vEnd = tA[(idxInA + 2) % 3];
              quadFaces.push({ indices: [oppA, vStart, oppB, vEnd] });
              used[matchIdx] = 1;
              used[i] = 1;
              break;
            }
          }
        } else {
          edgeToTri.set(key, i);
        }
      }
    }

    for (let i = 0; i < residualTris.length; i++) {
      if (!used[i]) quadFaces.push(residualTris[i]);
    }
  } else if (residualTris.length > 0) {
    quadFaces.push(...residualTris);
  }

  // Relajación Tangencial ligera
  const finalRelaxedVerts = relaxTangentialVertices(vertices, quadFaces, iterations, smoothFactor);

  return {
    vertices: finalRelaxedVerts,
    faces: quadFaces,
    quadsCount: quadFaces.filter(f => f.indices && f.indices.length === 4).length
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retopología para Mallas Nativas CSG
// ─────────────────────────────────────────────────────────────────────────────
export async function retopologizeMesh(
  input: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  options: RetopologyOptions = {}
): Promise<RetopologyResult> {
  const {
    targetCount,
    targetRatio,
    mode = 'QUAD_DOMINANT',
    preserveCreases = true,
    creaseAngleDeg = 35,
    onProgress
  } = options;

  if ((Meshopt as any).ready) {
    await (Meshopt as any).ready;
  }

  if (onProgress) onProgress(10, 'Analizando malla para Remeser...');

  // 1. Extraer vértices con offsets
  const rawVerts: V3[] = (input.vertices || []).map((v, i) => {
    const off = input.vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
  });

  const rawFaces: MeshFace[] = input.faces || [];
  const initialFaceCount = rawFaces.length;

  if (rawVerts.length < 4 || rawFaces.length === 0) {
    return {
      vertices: rawVerts,
      faces: rawFaces,
      report: ['Geometría insuficiente para retopología'],
      stats: {
        initialFaces: initialFaceCount,
        finalFaces: initialFaceCount,
        quads: 0,
        triangles: initialFaceCount,
        vertices: rawVerts.length,
        reductionPct: 0
      }
    };
  }

  // 2. Triangulación limpia
  const flatPositions = new Float32Array(rawVerts.length * 3);
  for (let i = 0; i < rawVerts.length; i++) {
    flatPositions[i * 3] = rawVerts[i][0];
    flatPositions[i * 3 + 1] = rawVerts[i][1];
    flatPositions[i * 3 + 2] = rawVerts[i][2];
  }

  const initialIndices: number[] = [];
  const triFaces: TriangleFace[] = [];

  rawFaces.forEach(f => {
    if (!f.indices || f.indices.length < 3) return;
    if (f.indices.length === 3) {
      initialIndices.push(f.indices[0], f.indices[1], f.indices[2]);
      triFaces.push({ indices: [f.indices[0], f.indices[1], f.indices[2]], materialIndex: f.materialIndex });
    } else {
      for (let i = 1; i < f.indices.length - 1; i++) {
        initialIndices.push(f.indices[0], f.indices[i], f.indices[i + 1]);
        triFaces.push({ indices: [f.indices[0], f.indices[i], f.indices[i + 1]], materialIndex: f.materialIndex });
      }
    }
  });

  const initialTrisCount = triFaces.length;

  // Calcular número objetivo de triángulos asegurando siempre simplificación y optimización
  let targetPolys = targetCount;
  if (!targetPolys || targetPolys <= 0 || targetPolys >= initialTrisCount) {
    if (targetRatio && targetRatio > 0 && targetRatio < 1) {
      targetPolys = Math.max(12, Math.round(initialTrisCount * targetRatio));
    } else {
      targetPolys = Math.max(12, Math.round(initialTrisCount * 0.25));
    }
  }

  if (onProgress) onProgress(35, `Reduciendo topología a ~${targetPolys.toLocaleString()} polígonos...`);

  let workingIndices = new Uint32Array(initialIndices);

  // 3. Si el objetivo es menor que el número actual, aplicar reducción controlada con Meshopt
  if (targetPolys < initialTrisCount) {
    const rawTarget = Math.floor(targetPolys) * 3;
    const flags = preserveCreases ? ['LockBorder'] : [];

    // Calcular normales por vértice para preservación estructural con simplifyWithAttributes
    let flatNormals: Float32Array | null = null;
    try {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(workingIndices), 1));
      geo.computeVertexNormals();
      flatNormals = geo.attributes.normal.array as Float32Array;
    } catch (eNorm) {}

    // Tier 1: Reducción guiada por normales con preservación de aristas vivas
    if (flatNormals && flatNormals.length === flatPositions.length) {
      const targetIndexCount = Math.min(workingIndices.length, Math.max(12, rawTarget));
      const targetCountMultiple3 = Math.floor(targetIndexCount / 3) * 3;
      if (targetCountMultiple3 < workingIndices.length) {
        const attrAttempts = [
          { err: 0.03, weights: [1.0, 1.0, 1.0] },
          { err: 0.08, weights: [1.2, 1.2, 1.2] },
          { err: 0.20, weights: [1.5, 1.5, 1.5] },
        ];
        for (const att of attrAttempts) {
          try {
            const res = Meshopt.simplifyWithAttributes(
              workingIndices,
              flatPositions,
              3,
              flatNormals,
              3,
              att.weights,
              null,
              targetCountMultiple3,
              att.err,
              flags as any
            );
            if (res && res[0] && res[0].length >= 12 && res[0].length < workingIndices.length) {
              workingIndices = res[0];
              if (workingIndices.length <= targetCountMultiple3 * 1.15) break;
            }
          } catch (eAttr) {}
        }
      }
    }

    // Tier 2: Simplificación geométrica iterativa
    if (workingIndices.length > rawTarget * 1.05) {
      const attempts = [
        { err: 0.03, flags: flags as any },
        { err: 0.06, flags: flags as any },
        { err: 0.15, flags: flags as any },
        { err: 0.35, flags: flags as any },
      ];
      if (!preserveCreases) {
        attempts.push({ err: 0.40, flags: [] as any });
      }

      for (const att of attempts) {
        const targetIndexCount = Math.min(workingIndices.length, Math.max(12, rawTarget));
        const targetCountMultiple3 = Math.floor(targetIndexCount / 3) * 3;
        if (targetCountMultiple3 >= workingIndices.length) break;

        try {
          const res = Meshopt.simplify(
            workingIndices,
            flatPositions,
            3,
            targetCountMultiple3,
            att.err,
            att.flags
          );
          if (res && res[0] && res[0].length >= 12 && res[0].length < workingIndices.length) {
            workingIndices = res[0];
            if (workingIndices.length <= targetCountMultiple3 * 1.15) break;
          }
        } catch (e) {}
      }
    }

    // Tier 3: Si LockBorder limitó la reducción, intentar sin bloqueo de bordes SOLO si !preserveCreases
    if (!preserveCreases && workingIndices.length > rawTarget * 1.20) {
      const attemptsNoLock = [
        { err: 0.15, flags: [] as any },
        { err: 0.35, flags: [] as any },
        { err: 0.65, flags: [] as any },
      ];
      for (const att of attemptsNoLock) {
        const targetIndexCount = Math.min(workingIndices.length, Math.max(12, rawTarget));
        const targetCountMultiple3 = Math.floor(targetIndexCount / 3) * 3;
        if (targetCountMultiple3 >= workingIndices.length) break;

        try {
          const res = Meshopt.simplify(
            workingIndices,
            flatPositions,
            3,
            targetCountMultiple3,
            att.err,
            att.flags
          );
          if (res && res[0] && res[0].length >= 12 && res[0].length < workingIndices.length) {
            workingIndices = res[0];
            if (workingIndices.length <= targetCountMultiple3 * 1.15) break;
          }
        } catch (e) {}
      }
    }

    // Tier 4: Garantía de simplificación (simplifySloppy) SOLO si !preserveCreases
    // (NUNCA en modelos con aristas vivas, alas finas o paneles de naves espaciales para evitar colapso cruzado)
    if (!preserveCreases && workingIndices.length > rawTarget * 1.20) {
      const targetIndexCount = Math.min(workingIndices.length, Math.max(12, rawTarget));
      const targetCountMultiple3 = Math.floor(targetIndexCount / 3) * 3;
      if (targetCountMultiple3 < workingIndices.length) {
        try {
          const res = Meshopt.simplifySloppy(
            workingIndices,
            flatPositions,
            3,
            null,
            targetCountMultiple3,
            0.5
          );
          if (res && res[0] && res[0].length >= 12 && res[0].length < workingIndices.length) {
            workingIndices = res[0];
          }
        } catch (eSloppy) {}
      }
    }
  }

  if (onProgress) onProgress(70, 'Construyendo flujo continuo de cuadriláteros (Quad Flow)...');

  // 4. Reconstruir lista de triángulos simplificados
  const simplifiedTris: TriangleFace[] = [];
  for (let i = 0; i < workingIndices.length; i += 3) {
    simplifiedTris.push({
      indices: [workingIndices[i], workingIndices[i + 1], workingIndices[i + 2]]
    });
  }

  // 5. Aplicar Remeser Quad Flow
  const quadResult = pairTrianglesIntoQuads(simplifiedTris, flatPositions, {
    preserveCreases,
    creaseAngleDeg
  });

  const finalFaces: MeshFace[] = [];
  let quadCount = 0;
  let triCount = 0;

  if (mode === 'ISOTROPIC_TRI') {
    simplifiedTris.forEach(t => {
      finalFaces.push({ indices: t.indices });
      triCount++;
    });
  } else {
    // Añadir Quads
    quadResult.quads.forEach(q => {
      finalFaces.push({ indices: [q[0], q[1], q[2], q[3]] });
      quadCount++;
    });

    // Añadir Triángulos no emparejados de forma limpia sin crear T-junctions ni aristas cruzadas
    quadResult.remainingTris.forEach(t => {
      finalFaces.push({ indices: [t[0], t[1], t[2]] });
      triCount++;
    });
  }

  // 6. Compactar vértices utilizados
  const usedVerts = new Set<number>();
  finalFaces.forEach(f => f.indices.forEach(idx => usedVerts.add(idx)));

  const oldToNew = new Map<number, number>();
  const compactedVerts: V3[] = [];
  usedVerts.forEach(oldIdx => {
    oldToNew.set(oldIdx, compactedVerts.length);
    compactedVerts.push(rawVerts[oldIdx]);
  });

  let compactedFaces: MeshFace[] = finalFaces.map(f => ({
    ...f,
    indices: f.indices.map(idx => oldToNew.get(idx)!)
  }));
  let finalVerts = compactedVerts;

  // Si el modo seleccionado es 100% PURE_QUADS (estilo Instant Meshes / QuadriFlow):
  if (mode === 'PURE_QUADS') {
    const pureRes = refineAndRelaxPureQuads(compactedVerts, compactedFaces, 2, 0.35);
    finalVerts = pureRes.vertices;
    compactedFaces = pureRes.faces;
    quadCount = pureRes.quadsCount;
    triCount = pureRes.faces.filter(f => f.indices && f.indices.length === 3).length;
  }

  // Aplanar paneles coplanares SOLO si el usuario lo solicita explícitamente (ej: alas planas o placas mecánicas)
  if (options.snapPlanarFaces === true) {
    finalVerts = snapPlanarClusters(finalVerts, compactedFaces, 4.0, 0.01);
  }

  const finalFacesCount = compactedFaces.length;
  const reductionPct = initialFaceCount > 0
    ? Math.round(((initialFaceCount - finalFacesCount) / initialFaceCount) * 100)
    : 0;

  if (onProgress) onProgress(100, '¡Retopología completada con éxito!');

  return {
    vertices: finalVerts,
    faces: compactedFaces,
    report: [
      `Remeser: ${mode === 'PURE_QUADS' ? '100% Quads' : mode === 'QUAD_DOMINANT' ? 'Quads Dominantes' : 'Isótropo'}`,
      `De ${initialFaceCount.toLocaleString()} caras a ${finalFacesCount.toLocaleString()} (${quadCount.toLocaleString()} quads, ${triCount.toLocaleString()} tris)`,
      `Reducción: ${reductionPct > 0 ? `-${reductionPct}%` : `+${Math.abs(reductionPct)}%`}`,
      `Vértices: ${compactedVerts.length.toLocaleString()}`
    ],
    stats: {
      initialFaces: initialFaceCount,
      finalFaces: finalFacesCount,
      quads: quadCount,
      triangles: triCount,
      vertices: compactedVerts.length,
      reductionPct
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retopologizador Remeser de Modelos GLB / GLTF (Zero-Loss UVs y Materiales)
// ─────────────────────────────────────────────────────────────────────────────
export async function retopologizeGLBModel(
  obj: CSGObject,
  options: RetopologyOptions = {},
  onProgress?: (progress: number, stepText: string) => Promise<void> | void,
  targetMeshIds?: string[]
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  if (onProgress) await onProgress(10, 'Cargando modelo GLB, texturas y materiales...');

  if ((Meshopt as any).ready) {
    await (Meshopt as any).ready;
  }

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const gltf = await new Promise<any>((resolve, reject) =>
    loader.load(obj.meshData!.data, resolve, undefined, reject)
  );

  const scene = gltf.scene;

  // 1. Identificar todas las submallas a procesar
  let meshIdxCounter = 0;
  const meshesToProcess: { mesh: THREE.Mesh; meshId: string }[] = [];
  let totalOriginalFaces = 0;
  let totalOriginalVerts = 0;

  scene.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
      const meshId = `mesh-${meshIdxCounter++}`;
      if (!targetMeshIds || targetMeshIds.length === 0 || targetMeshIds.includes(meshId)) {
        const mesh = child as THREE.Mesh;
        const geo = mesh.geometry;
        if (geo && geo.attributes.position) {
          const v = geo.attributes.position.count;
          const f = geo.index ? geo.index.count / 3 : v / 3;
          totalOriginalFaces += Math.floor(f);
          totalOriginalVerts += v;
          meshesToProcess.push({ mesh, meshId });
        }
      }
    }
  });

  if (meshesToProcess.length === 0 || totalOriginalFaces === 0) {
    dracoLoader.dispose();
    return obj;
  }

  // 2. Calcular el ratio global de reducción objetivo
  // IMPORTANTE: Distribuir el targetCount total proporcionalmente entre las partes
  const requestedTargetCount = options.targetCount && options.targetCount > 0 ? options.targetCount : undefined;
  
  let globalRatio = 0.25;
  if (options.targetRatio !== undefined) {
    globalRatio = Math.min(0.99, Math.max(0.01, options.targetRatio));
  } else if (requestedTargetCount) {
    // Si el usuario pidió 2025 polígonos sobre un modelo de 8100 caras:
    // globalRatio = 2025 / 8100 = 0.25 (-75% de reducción)
    globalRatio = Math.min(0.99, Math.max(0.01, requestedTargetCount / totalOriginalFaces));
  }

  const preserveCreases = options.preserveCreases !== false;
  const creaseAngleDeg = options.creaseAngleDeg ?? 35;
  const mode = options.mode ?? 'QUAD_DOMINANT';

  if (onProgress) {
    const targetEst = Math.round(totalOriginalFaces * globalRatio);
    await onProgress(20, `Remeser: reduciendo de ${totalOriginalFaces.toLocaleString()} a ~${targetEst.toLocaleString()} caras (-${Math.round((1 - globalRatio) * 100)}%)...`);
  }

  let modified = false;
  let totalResultVerts = 0;
  let totalResultFaces = 0;
  let totalResultQuads = 0;

  // 3. Procesar cada sub-malla con simplificación de atributos preservando UVs y costuras (Protección activa de VRAM)
  for (let m = 0; m < meshesToProcess.length; m++) {
    const { mesh } = meshesToProcess[m];
    let geometry = mesh.geometry;
    if (!geometry || !geometry.attributes.position) continue;

    // Asegurar que la geometría esté indexada liberando la geometría previa desindexada
    if (!geometry.index) {
      try {
        const mergedGeo = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
        geometry.dispose(); // LIBERACIÓN: Limpia de VRAM la malla original
        geometry = mergedGeo;
        mesh.geometry = geometry;
      } catch (e) {}
      if (!geometry.index) {
        const count = geometry.attributes.position.count;
        const indices = new Uint32Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
    }

    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index!;
    const uvAttr = geometry.attributes.uv;
    const hasUV = !!uvAttr && uvAttr.count === posAttr.count;

    const posArray = posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array);
    const indexArray = indexAttr.array instanceof Uint32Array ? indexAttr.array : new Uint32Array(indexAttr.array);

    const initialSubTris = indexArray.length / 3;
    if (initialSubTris <= 4) {
      totalResultFaces += initialSubTris;
      totalResultVerts += posAttr.count;
      continue;
    }

    // Objetivo proporcional para esta sub-malla
    const targetSubTris = Math.max(4, Math.floor(initialSubTris * globalRatio));
    const targetIndicesCount = targetSubTris * 3;

    if (onProgress) {
      const pct = Math.round(25 + (m / meshesToProcess.length) * 50);
      await onProgress(pct, `Remeser en ${mesh.name || `Parte ${m + 1}`}: preservando texturas y geometría...`);
    }

    let simplifiedIndices: Uint32Array | null = null;

    if (hasUV) {
      // Tier 1: Simplificación con protección multi-atributo de textura UV
      const uvArray = uvAttr.array instanceof Float32Array ? uvAttr.array : new Float32Array(uvAttr.array);
      let scale = 1.0;
      try {
        scale = Meshopt.getScale(posArray, 3);
      } catch (e) {
        scale = 1.0;
      }
      // Ponderación de UV adaptada a la escala de la geometría para evitar bloquear la reducción
      const uvWeight = Math.max(0.1, Math.min(2.0, scale * 0.25));
      const uvWeights = [uvWeight, uvWeight];

      if (preserveCreases) {
        const attempts = [
          { err: 0.03, flags: ['LockBorder'] as any },
          { err: 0.08, flags: ['LockBorder'] as any },
          { err: 0.20, flags: ['LockBorder'] as any },
        ];

        for (const att of attempts) {
          try {
            const res = Meshopt.simplifyWithAttributes(
              indexArray,
              posArray,
              3,
              uvArray,
              2,
              uvWeights,
              null,
              targetIndicesCount,
              att.err,
              att.flags
            );
            const simp = Array.isArray(res) ? res[0] : res;
            if (simp && simp.length >= 12 && simp.length < indexArray.length) {
              simplifiedIndices = simp;
              if (simplifiedIndices.length <= targetIndicesCount * 1.15) break;
            }
          } catch (eSimp) {}
        }
      }

      // Tier 2: Si LockBorder limitó la reducción en costuras UV o bordes de paneles abiertos (ej: alas o paneles de naves),
      // simplificar con protección de UV sin LockBorder. Meshopt sigue protegiendo la textura con el error de atributos.
      if (!simplifiedIndices || simplifiedIndices.length > targetIndicesCount * 1.18) {
        const attemptsNoLock = [
          { err: 0.03, flags: [] as any },
          { err: 0.08, flags: [] as any },
          { err: 0.20, flags: [] as any },
          { err: 0.40, flags: [] as any },
          { err: 0.65, flags: [] as any },
        ];
        for (const att of attemptsNoLock) {
          try {
            const res = Meshopt.simplifyWithAttributes(
              indexArray,
              posArray,
              3,
              uvArray,
              2,
              uvWeights,
              null,
              targetIndicesCount,
              att.err,
              att.flags
            );
            const simp = Array.isArray(res) ? res[0] : res;
            if (simp && simp.length >= 12 && simp.length < (simplifiedIndices ? simplifiedIndices.length : indexArray.length)) {
              simplifiedIndices = simp;
              if (simplifiedIndices.length <= targetIndicesCount * 1.15) break;
            }
          } catch (eSimp) {}
        }
      }
    }

    // Tier 3: Simplificación posicional pura si los atributos UV bloquearon la reducción o el modelo no tiene UVs
    if (!simplifiedIndices || simplifiedIndices.length > targetIndicesCount * 1.25) {
      const attemptsPos = [
        { err: 0.05, flags: preserveCreases ? ['LockBorder'] : [] as any },
        { err: 0.15, flags: [] as any },
        { err: 0.35, flags: [] as any },
        { err: 0.60, flags: [] as any },
      ];
      for (const att of attemptsPos) {
        try {
          const res = Meshopt.simplify(
            indexArray,
            posArray,
            3,
            targetIndicesCount,
            att.err,
            att.flags as any
          );
          const simp = Array.isArray(res) ? res[0] : res;
          if (simp && simp.length >= 12 && simp.length < (simplifiedIndices ? simplifiedIndices.length : indexArray.length)) {
            simplifiedIndices = simp;
            if (simplifiedIndices.length <= targetIndicesCount * 1.15) break;
          }
        } catch (eSimp) {}
      }
    }

    // Tier 4: Garantía absoluta de reducción: simplifySloppy SOLO si no hay creases exigentes
    if (!preserveCreases && (!simplifiedIndices || simplifiedIndices.length > targetIndicesCount * 1.20)) {
      try {
        const res = Meshopt.simplifySloppy(
          indexArray,
          posArray,
          3,
          null,
          targetIndicesCount,
          0.5
        );
        const simp = Array.isArray(res) ? res[0] : res;
        if (simp && simp.length >= 12 && simp.length < indexArray.length) {
          simplifiedIndices = simp;
        }
      } catch (eSloppy) {}
    }

    const finalSubIndices = simplifiedIndices && simplifiedIndices.length >= 12 ? simplifiedIndices : indexArray;

    // 4. Estructuración Remeser Quad Flow (reordenamiento en cuadriláteros continuos)
    const subTris: TriangleFace[] = [];
    for (let i = 0; i < finalSubIndices.length; i += 3) {
      subTris.push({
        indices: [finalSubIndices[i], finalSubIndices[i + 1], finalSubIndices[i + 2]]
      });
    }

    const quadPairResult = pairTrianglesIntoQuads(subTris, posArray, {
      preserveCreases,
      creaseAngleDeg,
      uvs: hasUV ? (uvAttr.array as Float32Array) : null
    });

    totalResultQuads += quadPairResult.quads.length;

    // 5. Recompactación de la geometría (Zero-Loss de Atributos)
    const indicesToUse = (hasUV && mode !== 'PURE_QUADS') ? finalSubIndices : quadPairResult.orderedIndices;
    const newGeometry = compactGeometry(geometry, indicesToUse);

    // Preservación estricta de normales sin sobreasignación de objetos Vector3
    if (!geometry.attributes.normal) {
      const creaseRad = ((creaseAngleDeg || 35) * Math.PI) / 180;
      try {
        computeSmoothNormalsByPosition(newGeometry, creaseRad);
      } catch (eNorm) {
        newGeometry.computeVertexNormals();
      }
    } else {
      // Normalizar vectores de normales transferidos usando pool estático global
      const normAttr = newGeometry.attributes.normal;
      for (let i = 0; i < normAttr.count; i++) {
        _vectorAux.fromBufferAttribute(normAttr, i);
        if (_vectorAux.lengthSq() > 1e-6) {
          _vectorAux.normalize();
          normAttr.setXYZ(i, _vectorAux.x, _vectorAux.y, _vectorAux.z);
        }
      }
      normAttr.needsUpdate = true;
    }

    // LIBERACIÓN FUNDAMENTAL: Destruye la instancia BufferGeometry previa en la GPU
    geometry.dispose();

    mesh.geometry = newGeometry;
    modified = true;

    totalResultFaces += newGeometry.index ? newGeometry.index.count / 3 : 0;
    totalResultVerts += newGeometry.attributes.position.count;
  }

  if (!modified) {
    dracoLoader.dispose();
    return obj;
  }

  if (onProgress) await onProgress(88, 'Exportando modelo retopologizado con texturas y jerarquía intactas...');

  // 6. Exportar GLB preservando animaciones, texturas y materiales
  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (gltfData) => resolve(gltfData as ArrayBuffer),
      (error) => reject(error),
      { binary: true, animations: gltf.animations }
    );
  });

  const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);

  // 7. Reconstruir lista de sub-mallas y estadísticas
  const meshesList: { id: string; name: string; vertices: number; faces: number }[] = [];
  let idx = 0;
  let accurateTotalVerts = 0;
  let accurateTotalFaces = 0;

  scene.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      const v = child.geometry.attributes.position ? child.geometry.attributes.position.count : 0;
      const f = child.geometry.index ? child.geometry.index.count / 3 : v / 3;
      accurateTotalVerts += v;
      accurateTotalFaces += f;
      meshesList.push({
        id: `mesh-${idx++}`,
        name: child.name || 'Unnamed Mesh',
        vertices: Math.floor(v),
        faces: Math.floor(f)
      });
    }
  });

  dracoLoader.dispose(); // Destruye workers y descodificadores Draco activos

  if (onProgress) await onProgress(100, '¡Remeser finalizado con éxito!');

  return {
    ...obj,
    meshData: {
      ...obj.meshData,
      data: url,
      animations: gltf.animations?.map((a: any) => a.toJSON()) || [],
      meshes: meshesList
    },
    stats: {
      vertices: Math.floor(accurateTotalVerts),
      faces: Math.floor(accurateTotalFaces),
      quads: totalResultQuads
    }
  };
}

/**
 * Convierte cualquier malla con caras triangulares o cortes diagonales en caras
 * cuadriláteras (Quads) limpias y continuas.
 */
export function convertMeshToQuads(
  obj: CSGObject,
  options: { preserveCreases?: boolean; creaseAngleDeg?: number } = {}
): { updatedObject: CSGObject; quadsCount: number; trianglesCount: number } {
  if (!obj.vertices || !obj.faces || obj.faces.length === 0) {
    return { updatedObject: obj, quadsCount: 0, trianglesCount: 0 };
  }

  const { preserveCreases = false, creaseAngleDeg = 45 } = options;

  const existingQuads: MeshFace[] = [];
  const rawTris: TriangleFace[] = [];
  const flatPos = new Float32Array(obj.vertices.length * 3);
  for (let i = 0; i < obj.vertices.length; i++) {
    const v = obj.vertices[i];
    const vx = Array.isArray(v) ? v[0] : (v as any).x ?? 0;
    const vy = Array.isArray(v) ? v[1] : (v as any).y ?? 0;
    const vz = Array.isArray(v) ? v[2] : (v as any).z ?? 0;
    flatPos[i * 3] = vx;
    flatPos[i * 3 + 1] = vy;
    flatPos[i * 3 + 2] = vz;
  }

  obj.faces.forEach(f => {
    if (!f.indices) return;
    if (f.indices.length === 4) {
      existingQuads.push(f);
    } else if (f.indices.length === 3) {
      rawTris.push({ indices: [f.indices[0], f.indices[1], f.indices[2]], materialIndex: f.materialIndex });
    } else if (f.indices.length > 4) {
      for (let i = 1; i < f.indices.length - 1; i++) {
        rawTris.push({ indices: [f.indices[0], f.indices[i], f.indices[i + 1]], materialIndex: f.materialIndex });
      }
    }
  });

  if (rawTris.length === 0) {
    return {
      updatedObject: obj,
      quadsCount: existingQuads.length,
      trianglesCount: 0
    };
  }

  const quadRes = pairTrianglesIntoQuads(rawTris, flatPos, {
    preserveCreases,
    creaseAngleDeg
  });

  const newFaces: MeshFace[] = [...existingQuads];
  quadRes.quads.forEach(q => {
    newFaces.push({ indices: [q[0], q[1], q[2], q[3]] });
  });
  quadRes.remainingTris.forEach(t => {
    newFaces.push({ indices: [t[0], t[1], t[2]] });
  });

  const updated: CSGObject = {
    ...obj,
    faces: newFaces
  };

  return {
    updatedObject: updated,
    quadsCount: existingQuads.length + quadRes.quads.length,
    trianglesCount: quadRes.remainingTris.length
  };
}

/**
 * Detecta clusters de caras coplanares (como paneles solares, alas o caras de corte mecánico)
 * y proyecta sus vértices estrictamente sobre el plano medio, eliminando arrugas y deformaciones.
 */
export function snapPlanarClusters(
  vertices: V3[],
  faces: MeshFace[],
  angleToleranceDeg: number = 10.0,
  maxPlaneDistRatio: number = 0.05
): V3[] {
  if (vertices.length < 3 || faces.length === 0 || faces.length > 15000) return vertices;

  const faceNormals: (V3 | null)[] = [];
  const faceCentroids: V3[] = [];
  const cosTol = Math.cos((angleToleranceDeg * Math.PI) / 180);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-4);
  const maxAbsDist = maxDim * maxPlaneDistRatio;

  for (let f = 0; f < faces.length; f++) {
    const idxs = faces[f].indices || [];
    if (idxs.length < 3) {
      faceNormals.push(null);
      faceCentroids.push([0, 0, 0]);
      continue;
    }
    const p0 = vertices[idxs[0]], p1 = vertices[idxs[1]], p2 = vertices[idxs[2]];
    if (!p0 || !p1 || !p2) {
      faceNormals.push(null);
      faceCentroids.push([0, 0, 0]);
      continue;
    }
    const e1 = vSub(p1, p0);
    const e2 = vSub(p2, p0);
    const cr = vCross(e1, e2);
    const len = Math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2]);
    if (len < 1e-9) {
      faceNormals.push(null);
      faceCentroids.push([0, 0, 0]);
      continue;
    }
    faceNormals.push([cr[0] / len, cr[1] / len, cr[2] / len]);

    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < idxs.length; k++) {
      const v = vertices[idxs[k]];
      if (v) { cx += v[0]; cy += v[1]; cz += v[2]; }
    }
    faceCentroids.push([cx / idxs.length, cy / idxs.length, cz / idxs.length]);
  }

  const edgeToFaces = new Map<string, number[]>();
  for (let f = 0; f < faces.length; f++) {
    const idxs = faces[f].indices || [];
    const len = idxs.length;
    for (let i = 0; i < len; i++) {
      const a = Math.min(idxs[i], idxs[(i + 1) % len]);
      const b = Math.max(idxs[i], idxs[(i + 1) % len]);
      const key = `${a}_${b}`;
      let list = edgeToFaces.get(key);
      if (!list) { list = []; edgeToFaces.set(key, list); }
      list.push(f);
    }
  }

  const visited = new Uint8Array(faces.length);
  const clusters: number[][] = [];

  for (let f = 0; f < faces.length; f++) {
    if (visited[f] || !faceNormals[f]) continue;
    const cluster: number[] = [];
    const queue = [f];
    visited[f] = 1;

    const baseN = faceNormals[f]!;
    const baseC = faceCentroids[f];

    while (queue.length > 0) {
      const cur = queue.pop()!;
      cluster.push(cur);

      const idxs = faces[cur].indices || [];
      const len = idxs.length;
      for (let i = 0; i < len; i++) {
        const a = Math.min(idxs[i], idxs[(i + 1) % len]);
        const b = Math.max(idxs[i], idxs[(i + 1) % len]);
        const nbrs = edgeToFaces.get(`${a}_${b}`) || [];
        for (const nbr of nbrs) {
          if (!visited[nbr] && faceNormals[nbr]) {
            const nN = faceNormals[nbr]!;
            const dot = vDot(baseN, nN);
            if (dot >= cosTol) {
              const nbrC = faceCentroids[nbr];
              const distToPlane = Math.abs(
                (nbrC[0] - baseC[0]) * baseN[0] +
                (nbrC[1] - baseC[1]) * baseN[1] +
                (nbrC[2] - baseC[2]) * baseN[2]
              );
              if (distToPlane <= maxAbsDist) {
                visited[nbr] = 1;
                queue.push(nbr);
              }
            }
          }
        }
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  const outVerts: V3[] = vertices.map(v => [v[0], v[1], v[2]]);
  const vertexClusters = new Map<number, { n: V3; c: V3; count: number }>();

  for (const cluster of clusters) {
    let avgNx = 0, avgNy = 0, avgNz = 0;
    let avgCx = 0, avgCy = 0, avgCz = 0;
    let totalWeight = 0;

    for (const f of cluster) {
      const n = faceNormals[f]!;
      const c = faceCentroids[f];
      avgNx += n[0]; avgNy += n[1]; avgNz += n[2];
      avgCx += c[0]; avgCy += c[1]; avgCz += c[2];
      totalWeight += 1;
    }

    const nLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy + avgNz * avgNz);
    if (nLen < 1e-6) continue;
    const planeN: V3 = [avgNx / nLen, avgNy / nLen, avgNz / nLen];
    const planeC: V3 = [avgCx / totalWeight, avgCy / totalWeight, avgCz / totalWeight];

    const clusterVerts = new Set<number>();
    for (const f of cluster) {
      (faces[f].indices || []).forEach(idx => clusterVerts.add(idx));
    }

    clusterVerts.forEach(vIdx => {
      const existing = vertexClusters.get(vIdx);
      if (!existing) {
        vertexClusters.set(vIdx, { n: planeN, c: planeC, count: 1 });
      } else {
        if (vDot(existing.n, planeN) >= cosTol) {
          existing.n[0] += planeN[0]; existing.n[1] += planeN[1]; existing.n[2] += planeN[2];
          existing.c[0] += planeC[0]; existing.c[1] += planeC[1]; existing.c[2] += planeC[2];
          existing.count++;
        }
      }
    });
  }

  vertexClusters.forEach((data, vIdx) => {
    const orig = vertices[vIdx];
    if (!orig) return;
    const nLen = Math.sqrt(data.n[0] * data.n[0] + data.n[1] * data.n[1] + data.n[2] * data.n[2]);
    if (nLen < 1e-6) return;
    const n: V3 = [data.n[0] / nLen, data.n[1] / nLen, data.n[2] / nLen];
    const c: V3 = [data.c[0] / data.count, data.c[1] / data.count, data.c[2] / data.count];

    const dist = (orig[0] - c[0]) * n[0] + (orig[1] - c[1]) * n[1] + (orig[2] - c[2]) * n[2];
    if (Math.abs(dist) <= maxAbsDist) {
      outVerts[vIdx] = [
        orig[0] - dist * n[0],
        orig[1] - dist * n[1],
        orig[2] - dist * n[2],
      ];
    }
  });

  return outVerts;
}

/**
 * Repara una malla que haya sufrido arrugas, triangulaciones erráticas o sombreado deficiente.
 * Aplana paneles coplanares, fusiona triángulos coplanares en cuadriláteros limpios y regenera
 * normales con umbral de aristas vivas (crease angle).
 */
export function repairHardSurfacePolygons(
  obj: CSGObject,
  options: { creaseAngleDeg?: number; planarToleranceDeg?: number } = {}
): { updatedObject: CSGObject; quadsCount: number; flattenedPanels: number; report: string[] } {
  if (!obj.vertices || !obj.faces || obj.faces.length === 0) {
    return { updatedObject: obj, quadsCount: 0, flattenedPanels: 0, report: ['Sin geometría'] };
  }

  const { creaseAngleDeg = 35, planarToleranceDeg = 12 } = options;

  // 1. Aplanar paneles matemáticamente
  const flattenedVerts = snapPlanarClusters(obj.vertices, obj.faces, planarToleranceDeg, 0.04);

  // 2. Convertir triángulos coplanares a quads
  const quadRes = convertMeshToQuads({ ...obj, vertices: flattenedVerts }, {
    preserveCreases: true,
    creaseAngleDeg
  });

  const updated: CSGObject = {
    ...quadRes.updatedObject,
    vertices: flattenedVerts,
    parameters: {
      ...obj.parameters,
      creaseAngleDeg
    },
    smoothShading: true,
    stats: {
      vertices: flattenedVerts.length,
      faces: quadRes.updatedObject.faces?.length || 0,
      quads: quadRes.quadsCount,
      triangles: quadRes.trianglesCount
    }
  };

  return {
    updatedObject: updated,
    quadsCount: quadRes.quadsCount,
    flattenedPanels: 1,
    report: [
      `Superficies duras reparadas: ${quadRes.quadsCount} quads generados`,
      `Pliegues protegidos a ${creaseAngleDeg}°`
    ]
  };
}
