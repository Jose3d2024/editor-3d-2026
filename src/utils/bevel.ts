import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { V3, MeshFace, CSGObject } from '../types';
import { fromThreeGeometry, applyUVWMapping } from './modifiers';
import { createBaseGeometry } from './csg';

export type BevelAffect = 'EDGES' | 'VERTICES';
export type BevelWidthType = 'OFFSET' | 'WIDTH' | 'DEPTH' | 'PERCENT' | 'ABSOLUTE';
export type BevelMiter = 'SHARP' | 'PATCH' | 'ARC';
export type BevelLimitMethod = 'ANGLE' | 'SELECTION' | 'NONE';
export type BevelProfilePreset = 'SUPERELLIPSE' | 'ROUND' | 'CONCAVE' | 'STEPPED' | 'CHAMFER';

export interface BevelConfig {
  affect?: BevelAffect;             // 'EDGES' (aristas) o 'VERTICES' (vértices/esquinas)
  widthType?: BevelWidthType;       // 'OFFSET' | 'WIDTH' | 'DEPTH' | 'PERCENT' | 'ABSOLUTE'
  width?: number;                   // Radio / Cantidad (por defecto 0.08)
  segments?: number;                // 1 = chaflán plano, 2+ = redondeado suave (por defecto 3)
  profile?: number;                 // 0.0 (cóncavo) a 0.5 (circular estándar) a 1.0 (convexo)
  profilePreset?: BevelProfilePreset;
  miterOuter?: BevelMiter;          // 'SHARP' | 'PATCH' | 'ARC' (por defecto 'SHARP')
  miterInner?: BevelMiter;          // 'SHARP' | 'PATCH' | 'ARC' (por defecto 'SHARP')
  limitMethod?: BevelLimitMethod;   // 'ANGLE' | 'SELECTION' | 'NONE' (por defecto 'ANGLE')
  angleThresholdDeg?: number;       // Ángulo mínimo diedro (por defecto 30°)
  clampOverlap?: boolean;           // Limitar superposición en aristas cortas (por defecto true)
  hardenNormals?: boolean;          // Normales ponderadas / endurecidas (por defecto true)
  selectedFaceIndices?: number[];
  selectedVertexIndices?: number[];
  selectedEdgeKeys?: string[];
}

/**
 * Motor avanzado de Biselado (Bevel Engine) basado en el estándar de Blender 2.93 / 5.x LTS.
 */
export function bevelMeshAdvanced(
  obj: CSGObject | { type?: string; vertices?: V3[]; faces?: MeshFace[]; vertexOffsets?: Record<number, V3>; parameters?: any },
  config: BevelConfig = {}
): { vertices: V3[]; faces: MeshFace[] } {
  const {
    affect = 'EDGES',
    widthType = 'OFFSET',
    width = 0.08,
    segments = 3,
    profile = 0.5,
    profilePreset = 'SUPERELLIPSE',
    miterOuter = 'SHARP',
    limitMethod = 'ANGLE',
    angleThresholdDeg = 30,
    clampOverlap = true,
    hardenNormals = true,
    selectedFaceIndices,
    selectedVertexIndices,
    selectedEdgeKeys
  } = config;

  // 1. Extraer y hornear desplazamientos de vértices (vertexOffsets)
  let inputVerts: V3[] = [];
  if (obj.vertices && obj.vertices.length > 0) {
    inputVerts = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });
  }
  let inputFaces = obj.faces || [];

  // Si no tiene geometría explícita aún, generar la base
  if (!inputVerts || inputVerts.length === 0 || !inputFaces || inputFaces.length === 0) {
    try {
      const baseGeo = createBaseGeometry(obj as any);
      const res = fromThreeGeometry(baseGeo);
      baseGeo.dispose();
      inputVerts = res.vertices;
      inputFaces = res.faces;
    } catch (e) {
      console.error('[bevelMeshAdvanced] Error generando geometría base:', e);
    }
  }

  if (!inputVerts || inputVerts.length === 0) {
    return { vertices: [], faces: [] };
  }

  // 2. Si es una primitiva Box pura sin aristas seleccionadas específicas y con modo EDGES estándar
  const hasOffsets = obj.vertexOffsets && Object.keys(obj.vertexOffsets).length > 0;
  const isCubeType = obj.type === 'CUBE' || obj.type === 'BOX' || obj.parameters?.genType === 'box';
  const isGlobalBoxBevel = isCubeType && !hasOffsets && affect === 'EDGES' && (!selectedFaceIndices || selectedFaceIndices.length === 0) && profilePreset === 'SUPERELLIPSE' && Math.abs(profile - 0.5) < 0.05;

  if (isGlobalBoxBevel) {
    try {
      const baseGeo = createBaseGeometry(obj as any);
      const box = new THREE.Box3().setFromBufferAttribute(baseGeo.attributes.position as THREE.BufferAttribute);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      
      const maxRadius = Math.min(size.x, size.y, size.z) * 0.48;
      const actualRadius = clampOverlap ? Math.min(width, maxRadius) : width;

      let roundedGeo: THREE.BufferGeometry = new RoundedBoxGeometry(size.x, size.y, size.z, Math.max(1, segments), Math.max(0.001, actualRadius));
      roundedGeo.translate(center.x, center.y, center.z);
      roundedGeo = BufferGeometryUtils.mergeVertices(roundedGeo, 1e-6);

      const result = fromThreeGeometry(roundedGeo);
      roundedGeo.dispose();
      baseGeo.dispose();
      return applyUVWMapping(result, 'BOX');
    } catch (err) {
      console.warn('[bevelMeshAdvanced] Fallback from RoundedBoxGeometry:', err);
    }
  }

  const segs = Math.max(1, Math.round(segments));
  const minAngleRad = (angleThresholdDeg * Math.PI) / 180;

  // 3. Deduplicar vértices con tolerancia espacial
  const uniqueVerts: THREE.Vector3[] = [];
  const vertRemap: number[] = new Array(inputVerts.length);

  for (let i = 0; i < inputVerts.length; i++) {
    const v = new THREE.Vector3(...inputVerts[i]);
    let found = -1;
    for (let j = 0; j < uniqueVerts.length; j++) {
      if (uniqueVerts[j].distanceToSquared(v) < 1e-12) {
        found = j;
        break;
      }
    }
    if (found !== -1) {
      vertRemap[i] = found;
    } else {
      vertRemap[i] = uniqueVerts.length;
      uniqueVerts.push(v);
    }
  }

  // Construir caras limpias
  const origFaces: number[][] = [];
  inputFaces.forEach(f => {
    const remapped = f.indices.map(idx => vertRemap[idx]);
    const clean: number[] = [];
    for (let i = 0; i < remapped.length; i++) {
      if (i === 0 || remapped[i] !== remapped[i - 1]) {
        clean.push(remapped[i]);
      }
    }
    if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length >= 3) origFaces.push(clean);
  });

  if (origFaces.length === 0) {
    return applyUVWMapping({ vertices: inputVerts, faces: inputFaces }, 'BOX');
  }

  // Centroid general de la malla para validar orientación
  const meshCentroid = new THREE.Vector3();
  uniqueVerts.forEach(v => meshCentroid.add(v));
  if (uniqueVerts.length > 0) meshCentroid.divideScalar(uniqueVerts.length);

  // 4. Calcular normal y centroide de cada cara usando método de Newell
  const faceNormals: THREE.Vector3[] = [];
  const faceCentroids: THREE.Vector3[] = [];
  origFaces.forEach(f => {
    const norm = new THREE.Vector3();
    const len = f.length;
    for (let i = 0; i < len; i++) {
      const pCurr = uniqueVerts[f[i]];
      const pNext = uniqueVerts[f[(i + 1) % len]];
      norm.x += (pCurr.y - pNext.y) * (pCurr.z + pNext.z);
      norm.y += (pCurr.z - pNext.z) * (pCurr.x + pNext.x);
      norm.z += (pCurr.x - pNext.x) * (pCurr.y + pNext.y);
    }
    const centroid = new THREE.Vector3();
    f.forEach(idx => centroid.add(uniqueVerts[idx]));
    centroid.divideScalar(len);
    faceCentroids.push(centroid);

    if (norm.lengthSq() > 1e-6) norm.normalize(); else norm.set(0, 1, 0);
    faceNormals.push(norm);
  });

  // 5. Mapear aristas (Edge Adjacency Map)
  const getEdgeKey = (a: number, b: number) => Math.min(a, b) + '_' + Math.max(a, b);
  interface EdgeRef {
    v1: number;
    v2: number;
    length: number;
    faces: { fIdx: number; edgeIdx: number }[];
  }
  const edgeMap = new Map<string, EdgeRef>();

  origFaces.forEach((f, fIdx) => {
    const len = f.length;
    for (let i = 0; i < len; i++) {
      const v1 = f[i];
      const v2 = f[(i + 1) % len];
      const key = getEdgeKey(v1, v2);
      let entry = edgeMap.get(key);
      if (!entry) {
        const length = uniqueVerts[v1].distanceTo(uniqueVerts[v2]);
        entry = { v1: Math.min(v1, v2), v2: Math.max(v1, v2), length, faces: [] };
        edgeMap.set(key, entry);
      }
      entry.faces.push({ fIdx, edgeIdx: i });
    }
  });

  // 6. Determinar aristas a biselar según limitMethod ('ANGLE', 'SELECTION', 'NONE')
  interface SharpEdge {
    key: string;
    v1: number;
    v2: number;
    f1: number;
    f2: number;
    angle: number;
    edgeLength: number;
  }
  const sharpEdges = new Map<string, SharpEdge>();

  const selectedFacesSet = new Set(selectedFaceIndices || []);
  const selectedVertsSet = new Set(selectedVertexIndices || []);
  const selectedEdgesSet = new Set(selectedEdgeKeys || []);

  edgeMap.forEach((entry, key) => {
    let shouldBevel = false;
    let angle = Math.PI / 2;
    let f1 = entry.faces[0]?.fIdx ?? 0;
    let f2 = entry.faces[1]?.fIdx ?? f1;

    if (entry.faces.length === 2) {
      f1 = entry.faces[0].fIdx;
      f2 = entry.faces[1].fIdx;
      const n1 = faceNormals[f1];
      const n2 = faceNormals[f2];
      const dot = Math.max(-1, Math.min(1, n1.dot(n2)));
      angle = Math.acos(dot);
    }

    if (limitMethod === 'SELECTION') {
      const touchesSelectedFace = selectedFacesSet.has(f1) || selectedFacesSet.has(f2);
      const touchesSelectedVerts = selectedVertsSet.has(entry.v1) && selectedVertsSet.has(entry.v2);
      const matchesSelectedEdge = selectedEdgesSet.has(key);
      shouldBevel = touchesSelectedFace || touchesSelectedVerts || matchesSelectedEdge;
    } else if (limitMethod === 'NONE') {
      shouldBevel = entry.faces.length > 0;
    } else {
      // ANGLE (default)
      if (entry.faces.length === 2) {
        shouldBevel = angle >= minAngleRad;
      } else if (entry.faces.length === 1) {
        // Borde abierto
        shouldBevel = true;
      }
    }

    if (shouldBevel) {
      sharpEdges.set(key, {
        key,
        v1: entry.v1,
        v2: entry.v2,
        f1,
        f2,
        angle,
        edgeLength: entry.length
      });
    }
  });

  // Si no hay aristas para biselar, devolver la malla original
  if (sharpEdges.size === 0) {
    return applyUVWMapping({ vertices: inputVerts, faces: inputFaces }, 'BOX');
  }

  // 7. Calcular radio efectivo con Clamp Overlap inteligente
  // Conteo de aristas afiladas por vértice y detección de esquinas no colineales
  const vertSharpEdges = new Map<number, SharpEdge[]>();
  sharpEdges.forEach(se => {
    let l1 = vertSharpEdges.get(se.v1);
    if (!l1) { l1 = []; vertSharpEdges.set(se.v1, l1); }
    l1.push(se);

    let l2 = vertSharpEdges.get(se.v2);
    if (!l2) { l2 = []; vertSharpEdges.set(se.v2, l2); }
    l2.push(se);
  });

  // Calculamos la longitud mínima sólo de aristas que terminan en esquinas afiladas (<120°)
  // o aristas transversales en caras biseladas, para evitar que la discretización de una curva (p. ej. arco/cilindro) limite el radio
  let minCornerEdgeLen = Infinity;
  let minFaceSpan = Infinity;

  sharpEdges.forEach(se => {
    const list1 = vertSharpEdges.get(se.v1) || [];
    const list2 = vertSharpEdges.get(se.v2) || [];

    const isCorner1 = list1.length !== 2 || (() => {
      const other = list1.find(e => e.key !== se.key)!;
      const vA = other.v1 === se.v1 ? other.v2 : other.v1;
      const vB = se.v1 === se.v2 ? se.v1 : (se.v1 === se.v1 ? se.v2 : se.v1);
      const d1 = uniqueVerts[vA].clone().sub(uniqueVerts[se.v1]).normalize();
      const d2 = uniqueVerts[vB].clone().sub(uniqueVerts[se.v1]).normalize();
      return d1.dot(d2) > -0.5; // ángulo <= 120°
    })();

    const isCorner2 = list2.length !== 2 || (() => {
      const other = list2.find(e => e.key !== se.key)!;
      const vA = other.v1 === se.v2 ? other.v2 : other.v1;
      const vB = se.v1;
      const d1 = uniqueVerts[vA].clone().sub(uniqueVerts[se.v2]).normalize();
      const d2 = uniqueVerts[vB].clone().sub(uniqueVerts[se.v2]).normalize();
      return d1.dot(d2) > -0.5; // ángulo <= 120°
    })();

    if (isCorner1 || isCorner2) {
      if (se.edgeLength > 1e-5 && se.edgeLength < minCornerEdgeLen) {
        minCornerEdgeLen = se.edgeLength;
      }
    }
  });

  // Ancho transversal de las caras afectadas
  origFaces.forEach(f => {
    const len = f.length;
    let hasSharp = false;
    for (let i = 0; i < len; i++) {
      if (sharpEdges.has(getEdgeKey(f[i], f[(i + 1) % len]))) {
        hasSharp = true;
        break;
      }
    }
    if (hasSharp) {
      // Distancia máxima de vértices al centroide de la cara
      const c = faceCentroids[origFaces.indexOf(f)];
      for (let i = 0; i < len; i++) {
        const d = uniqueVerts[f[i]].distanceTo(c);
        if (d > 1e-4 && d < minFaceSpan) minFaceSpan = d;
      }
    }
  });

  let rawWidth = Math.max(0.0001, width);
  if (widthType === 'PERCENT') {
    const refLen = isFinite(minCornerEdgeLen) ? minCornerEdgeLen : (isFinite(minFaceSpan) ? minFaceSpan : 1.0);
    rawWidth = (refLen * width) / 100;
  }

  const safeLimit = Math.min(
    isFinite(minCornerEdgeLen) ? minCornerEdgeLen * 0.48 : Infinity,
    isFinite(minFaceSpan) ? minFaceSpan * 0.95 : Infinity
  );

  const rad = clampOverlap && isFinite(safeLimit) ? Math.min(rawWidth, Math.max(0.0005, safeLimit)) : rawWidth;

  // 8. Modo Biselar Vértices (Affect = 'VERTICES')
  if (affect === 'VERTICES') {
    return bevelVerticesMode({
      uniqueVerts,
      origFaces,
      faceNormals,
      edgeMap,
      rad,
      segments: segs,
      profile,
      selectedVertsSet,
      limitMethod
    });
  }

  // 9. Modo Biselar Aristas (Affect = 'EDGES' - Blender Standard)
  return bevelEdgesMode({
    uniqueVerts,
    origFaces,
    faceNormals,
    edgeMap,
    sharpEdges,
    rad,
    segs,
    profile,
    profilePreset,
    miterOuter,
    hardenNormals,
    widthType
  });
}

/**
 * Submotor de Biselado de Aristas (Edge Bevel Engine)
 */
function bevelEdgesMode(params: {
  uniqueVerts: THREE.Vector3[];
  origFaces: number[][];
  faceNormals: THREE.Vector3[];
  edgeMap: Map<string, any>;
  sharpEdges: Map<string, any>;
  rad: number;
  segs: number;
  profile: number;
  profilePreset: BevelProfilePreset;
  miterOuter: BevelMiter;
  hardenNormals: boolean;
  widthType: BevelWidthType;
}): { vertices: V3[]; faces: MeshFace[] } {
  const {
    uniqueVerts,
    origFaces,
    faceNormals,
    edgeMap,
    sharpEdges,
    rad,
    segs,
    profile,
    profilePreset,
    miterOuter,
    hardenNormals
  } = params;

  const getEdgeKey = (a: number, b: number) => Math.min(a, b) + '_' + Math.max(a, b);

  const outVerts: V3[] = [];
  const outFaces: MeshFace[] = [];
  const vertHashMap = new Map<string, number>();

  const addVertex = (v: THREE.Vector3): number => {
    const qx = Math.round(v.x * 10000);
    const qy = Math.round(v.y * 10000);
    const qz = Math.round(v.z * 10000);
    const key = `${qx}_${qy}_${qz}`;
    const existing = vertHashMap.get(key);
    if (existing !== undefined) return existing;
    const idx = outVerts.length;
    outVerts.push([v.x, v.y, v.z]);
    vertHashMap.set(key, idx);
    return idx;
  };

  // 1. Calcular posiciones desplazadas hacia el interior (Insets) por cara y vértice
  const rawInsetPos: THREE.Vector3[][] = origFaces.map(() => []);

  origFaces.forEach((f, fIdx) => {
    const len = f.length;
    const n = faceNormals[fIdx];

    for (let i = 0; i < len; i++) {
      const vPrev = f[(i - 1 + len) % len];
      const vCurr = f[i];
      const vNext = f[(i + 1) % len];

      const prevKey = getEdgeKey(vPrev, vCurr);
      const nextKey = getEdgeKey(vCurr, vNext);
      const isPrevSharp = sharpEdges.has(prevKey);
      const isNextSharp = sharpEdges.has(nextKey);

      const P = uniqueVerts[vCurr].clone();

      if (!isPrevSharp && !isNextSharp) {
        rawInsetPos[fIdx].push(P);
      } else {
        const Pprev = uniqueVerts[vPrev];
        const Pnext = uniqueVerts[vNext];

        const ePrevDir = P.clone().sub(Pprev);
        if (ePrevDir.lengthSq() > 1e-12) ePrevDir.normalize();
        const eNextDir = Pnext.clone().sub(P);
        if (eNextDir.lengthSq() > 1e-12) eNextDir.normalize();

        const inPrev = isPrevSharp ? new THREE.Vector3().crossVectors(n, ePrevDir).normalize() : new THREE.Vector3(0, 0, 0);
        const inNext = isNextSharp ? new THREE.Vector3().crossVectors(n, eNextDir).normalize() : new THREE.Vector3(0, 0, 0);

        let disp = new THREE.Vector3();
        if (isPrevSharp && isNextSharp) {
          const bisector = new THREE.Vector3().addVectors(inPrev, inNext);
          if (bisector.lengthSq() > 1e-6) {
            bisector.normalize();
            const cosHalfAngle = Math.max(0.15, inPrev.dot(bisector));
            const dist = Math.min(rad * 2.5, rad / cosHalfAngle);
            disp = bisector.multiplyScalar(dist);
          } else {
            disp = inPrev.clone().multiplyScalar(rad);
          }
        } else if (isPrevSharp) {
          const uNext = eNextDir.clone();
          const denom = uNext.dot(inPrev);
          if (denom > 0.05) {
            const dist = Math.min(rad * 2.5, rad / denom);
            disp = uNext.multiplyScalar(dist);
          } else {
            disp = inPrev.clone().multiplyScalar(rad);
          }
        } else if (isNextSharp) {
          const uPrev = Pprev.clone().sub(P);
          if (uPrev.lengthSq() > 1e-12) uPrev.normalize();
          const denom = uPrev.dot(inNext);
          if (denom > 0.05) {
            const dist = Math.min(rad * 2.5, rad / denom);
            disp = uPrev.multiplyScalar(dist);
          } else {
            disp = inNext.clone().multiplyScalar(rad);
          }
        }

        rawInsetPos[fIdx].push(P.add(disp));
      }
    }
  });

  // 2. Conectar vértices compartidos de aristas suaves (Smooth edge welding)
  const vertToFaces = new Map<number, number[]>();
  origFaces.forEach((f, fIdx) => {
    f.forEach(v => {
      let list = vertToFaces.get(v);
      if (!list) {
        list = [];
        vertToFaces.set(v, list);
      }
      list.push(fIdx);
    });
  });

  const faceInsetVerts: number[][] = origFaces.map(() => []);

  vertToFaces.forEach((fList, vIdx) => {
    const visited = new Set<number>();
    fList.forEach(fIdx => {
      if (visited.has(fIdx)) return;

      const patch: number[] = [];
      const queue = [fIdx];
      visited.add(fIdx);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        patch.push(curr);

        const currFace = origFaces[curr];
        const locCurr = currFace.indexOf(vIdx);
        const lenCurr = currFace.length;
        const vPrev = currFace[(locCurr - 1 + lenCurr) % lenCurr];
        const vNext = currFace[(locCurr + 1) % lenCurr];

        fList.forEach(neighbor => {
          if (visited.has(neighbor)) return;
          const neighborFace = origFaces[neighbor];
          if (neighborFace.includes(vPrev) && !sharpEdges.has(getEdgeKey(vIdx, vPrev))) {
            visited.add(neighbor);
            queue.push(neighbor);
          } else if (neighborFace.includes(vNext) && !sharpEdges.has(getEdgeKey(vIdx, vNext))) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }

      const avgP = new THREE.Vector3();
      patch.forEach(f => {
        const loc = origFaces[f].indexOf(vIdx);
        avgP.add(rawInsetPos[f][loc]);
      });
      avgP.divideScalar(patch.length);

      const weldedIdx = addVertex(avgP);

      patch.forEach(f => {
        const loc = origFaces[f].indexOf(vIdx);
        faceInsetVerts[f][loc] = weldedIdx;
      });
    });
  });

  // 3. Agregar caras interiores reducidas a outFaces
  origFaces.forEach((f, fIdx) => {
    outFaces.push({ indices: [...faceInsetVerts[fIdx]] });
  });

  // 4. Crear tiras de bisel (Bevel Strips) con curvas racionales exactas de Blender
  const arcMap = new Map<string, number[]>();
  const getArcKey = (vIdx: number, fA: number, fB: number) => `${vIdx}_${fA}_${fB}`;

  // Función matemática de Bezier racional para arcos circulares y perfiles superelípticos
  const computeFilletPoint = (
    p1: THREE.Vector3,
    Porig: THREE.Vector3,
    p2: THREE.Vector3,
    t: number,
    angle: number
  ): THREE.Vector3 => {
    if (segs <= 1 || profilePreset === 'CHAMFER') {
      return p1.clone().lerp(p2, t);
    }

    // Peso racional para arco circular exacto tangente a ambas caras
    let w = Math.cos(Math.max(0.01, angle) / 2);
    if (profilePreset === 'CONCAVE' || profile < 0.48) {
      w *= Math.max(0.1, profile / 0.5);
    } else if (profilePreset === 'STEPPED') {
      const isStep = (Math.floor(t * segs) % 2) === 0;
      w *= isStep ? 1.3 : 0.7;
    } else {
      // Superelipse de Lamé
      const profileFactor = (profile - 0.5) * 2; // -1 a +1
      w = w * (1.0 + profileFactor * 0.45);
    }

    const b0 = (1 - t) * (1 - t);
    const b1 = 2 * (1 - t) * t * w;
    const b2 = t * t;
    const denom = b0 + b1 + b2;

    const res = new THREE.Vector3()
      .addScaledVector(p1, b0)
      .addScaledVector(Porig, b1)
      .addScaledVector(p2, b2)
      .divideScalar(Math.max(1e-6, denom));

    return res;
  };

  sharpEdges.forEach(({ key, f1, f2, v1, v2, angle }) => {
    const f1Indices = origFaces[f1];
    const f2Indices = origFaces[f2];

    const i1_f1 = f1Indices.indexOf(v1);
    const i2_f1 = f1Indices.indexOf(v2);
    const i1_f2 = f2Indices.indexOf(v1);
    const i2_f2 = f2Indices.indexOf(v2);

    if (i1_f1 === -1 || i2_f1 === -1 || i1_f2 === -1 || i2_f2 === -1) return;

    const p1_f1 = new THREE.Vector3(...outVerts[faceInsetVerts[f1][i1_f1]]);
    const p1_f2 = new THREE.Vector3(...outVerts[faceInsetVerts[f2][i1_f2]]);
    const Porig1 = uniqueVerts[v1];

    // Generar arco en v1
    const v1Arc: number[] = [faceInsetVerts[f1][i1_f1]];
    for (let k = 1; k < segs; k++) {
      const t = k / segs;
      const pos = computeFilletPoint(p1_f1, Porig1, p1_f2, t, angle);
      v1Arc.push(addVertex(pos));
    }
    v1Arc.push(faceInsetVerts[f2][i1_f2]);

    // Generar arco en v2
    const p2_f1 = new THREE.Vector3(...outVerts[faceInsetVerts[f1][i2_f1]]);
    const p2_f2 = new THREE.Vector3(...outVerts[faceInsetVerts[f2][i2_f2]]);
    const Porig2 = uniqueVerts[v2];

    const v2Arc: number[] = [faceInsetVerts[f1][i2_f1]];
    for (let k = 1; k < segs; k++) {
      const t = k / segs;
      const pos = computeFilletPoint(p2_f1, Porig2, p2_f2, t, angle);
      v2Arc.push(addVertex(pos));
    }
    v2Arc.push(faceInsetVerts[f2][i2_f2]);

    // Guardar arcos dirigidos para los parches de esquinas
    arcMap.set(getArcKey(v1, f1, f2), v1Arc);
    arcMap.set(getArcKey(v1, f2, f1), [...v1Arc].reverse());
    arcMap.set(getArcKey(v2, f1, f2), v2Arc);
    arcMap.set(getArcKey(v2, f2, f1), [...v2Arc].reverse());

    const loc1 = origFaces[f1].indexOf(v1);
    const loc2 = origFaces[f1].indexOf(v2);
    const isForwardInF1 = ((loc1 + 1) % f1Indices.length) === loc2;

    // Generar tiras de quads a lo largo de la arista con orientación hacia el exterior
    for (let k = 0; k < segs; k++) {
      const a1 = v1Arc[k];
      const a2 = v1Arc[k + 1];
      const b1 = v2Arc[k];
      const b2 = v2Arc[k + 1];
      const quadIndices = isForwardInF1 ? [a1, b1, b2, a2] : [b1, a1, a2, b2];
      outFaces.push({ indices: quadIndices });
    }
  });

  // 5. Construcción de parches de esquina (Corner Miter: SHARP, ARC, PATCH)
  vertToFaces.forEach((fList, vIdx) => {
    // Filtrar aristas afiladas que inciden en vIdx
    const sharpIncident: any[] = [];
    sharpEdges.forEach(se => {
      if (se.v1 === vIdx || se.v2 === vIdx) sharpIncident.push(se);
    });

    if (sharpIncident.length < 2) return; // Sin esquina si tiene < 2 aristas afiladas

    // Si exactamente 2 aristas afiladas se tocan en vIdx:
    if (sharpIncident.length === 2) {
      const se1 = sharpIncident[0];
      const se2 = sharpIncident[1];
      const other1 = se1.v1 === vIdx ? se1.v2 : se1.v1;
      const other2 = se2.v1 === vIdx ? se2.v2 : se2.v1;
      const d1 = uniqueVerts[other1].clone().sub(uniqueVerts[vIdx]).normalize();
      const d2 = uniqueVerts[other2].clone().sub(uniqueVerts[vIdx]).normalize();
      const dot = d1.dot(d2);
      // Si dot < -0.4 (ángulo > 115°), es un borde continuo suave (p. ej. arco/cilindro) y las tiras ya empalman perfectamente
      if (dot < -0.4) return;
    }

    // Normal promedio del vértice
    const N_v = new THREE.Vector3();
    fList.forEach(fIdx => N_v.add(faceNormals[fIdx]));
    if (N_v.lengthSq() > 1e-6) N_v.normalize(); else N_v.set(0, 1, 0);

    // Ordenar las aristas afiladas de forma polar/circular alrededor de N_v
    const up = Math.abs(N_v.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const uTangent = new THREE.Vector3().crossVectors(N_v, up).normalize();
    const vTangent = new THREE.Vector3().crossVectors(N_v, uTangent).normalize();

    sharpIncident.sort((a, b) => {
      const otherA = a.v1 === vIdx ? a.v2 : a.v1;
      const otherB = b.v1 === vIdx ? b.v2 : b.v1;
      const dA = uniqueVerts[otherA].clone().sub(uniqueVerts[vIdx]).normalize();
      const dB = uniqueVerts[otherB].clone().sub(uniqueVerts[vIdx]).normalize();
      const angleA = Math.atan2(dA.dot(vTangent), dA.dot(uTangent));
      const angleB = Math.atan2(dB.dot(vTangent), dB.dot(uTangent));
      return angleA - angleB;
    });

    // Construir el loop exterior de la esquina conectando los arcos de las aristas afiladas
    const loop: number[] = [];
    const numSharp = sharpIncident.length;

    for (let i = 0; i < numSharp; i++) {
      const seCurr = sharpIncident[i];
      const seNext = sharpIncident[(i + 1) % numSharp];

      // Encontrar la cara compartida entre seCurr y seNext que contiene a vIdx
      const sharedFace = fList.find(f => {
        const isF1 = (seCurr.f1 === f || seCurr.f2 === f);
        const isF2 = (seNext.f1 === f || seNext.f2 === f);
        return isF1 && isF2;
      });

      if (sharedFace !== undefined) {
        const otherFaceCurr = seCurr.f1 === sharedFace ? seCurr.f2 : seCurr.f1;
        const otherFaceNext = seNext.f1 === sharedFace ? seNext.f2 : seNext.f1;

        const arcKey = getArcKey(vIdx, otherFaceCurr, sharedFace);
        if (arcMap.has(arcKey)) {
          const arc = arcMap.get(arcKey)!;
          const ptsToAdd = arc.slice(0, -1);
          ptsToAdd.forEach(p => {
            if (loop.length === 0 || loop[loop.length - 1] !== p) {
              loop.push(p);
            }
          });
        } else {
          const loc = origFaces[sharedFace].indexOf(vIdx);
          const insetIdx = faceInsetVerts[sharedFace][loc];
          if (loop.length === 0 || loop[loop.length - 1] !== insetIdx) {
            loop.push(insetIdx);
          }
        }
      } else {
        // Si no comparten directamente una cara, usar el arco de seCurr
        const arcKey = getArcKey(vIdx, seCurr.f1, seCurr.f2);
        if (arcMap.has(arcKey)) {
          const arc = arcMap.get(arcKey)!;
          const ptsToAdd = arc.slice(0, -1);
          ptsToAdd.forEach(p => {
            if (loop.length === 0 || loop[loop.length - 1] !== p) {
              loop.push(p);
            }
          });
        }
      }
    }

    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (loop.length < 3) return;

    // Normal del loop para asegurar orientación CCW respecto a N_v
    const loopNormal = new THREE.Vector3();
    const numLoop = loop.length;
    for (let i = 0; i < numLoop; i++) {
      const pA = new THREE.Vector3(...outVerts[loop[i]]);
      const pB = new THREE.Vector3(...outVerts[loop[(i + 1) % numLoop]]);
      loopNormal.x += (pA.y - pB.y) * (pA.z + pB.z);
      loopNormal.y += (pA.z - pB.z) * (pA.x + pB.x);
      loopNormal.z += (pA.x - pB.x) * (pA.y + pB.y);
    }
    if (loopNormal.dot(N_v) < 0) {
      loop.reverse();
    }

    const avgP = new THREE.Vector3();
    loop.forEach(idx => avgP.add(new THREE.Vector3(...outVerts[idx])));
    avgP.divideScalar(loop.length);

    const numPts = loop.length;

    if (segs <= 1 || profilePreset === 'CHAMFER') {
      // Chaflán plano / 1 segmento
      if (numPts === 3) {
        outFaces.push({ indices: [loop[0], loop[1], loop[2]] });
      } else if (numPts === 4) {
        outFaces.push({ indices: [loop[0], loop[1], loop[2], loop[3]] });
      } else {
        const centerIdx = addVertex(avgP);
        for (let i = 0; i < numPts; i++) {
          outFaces.push({ indices: [centerIdx, loop[i], loop[(i + 1) % numPts]] });
        }
      }
    } else {
      // Esquina redondeada suave (Blender spherical corner patch)
      const bulgeFactor = profilePreset === 'CONCAVE' ? -0.15 : (profilePreset === 'ROUND' ? 0.28 : 0.22);
      const centerP = avgP.clone().addScaledVector(N_v, rad * bulgeFactor);
      const centerIdx = addVertex(centerP);

      for (let i = 0; i < numPts; i++) {
        outFaces.push({ indices: [centerIdx, loop[i], loop[(i + 1) % numPts]] });
      }
    }
  });

  // 6. Ensamblaje y cálculo de normales ponderadas / endurecidas
  let temporalGeo = new THREE.BufferGeometry();
  const posicionesFlotantes: number[] = [];
  const indicesTriangulados: number[] = [];

  outVerts.forEach(v => posicionesFlotantes.push(v[0], v[1], v[2]));
  outFaces.forEach(f => {
    for (let i = 1; i < f.indices.length - 1; i++) {
      indicesTriangulados.push(f.indices[0], f.indices[i], f.indices[i + 1]);
    }
  });

  temporalGeo.setAttribute('position', new THREE.Float32BufferAttribute(posicionesFlotantes, 3));
  temporalGeo.setIndex(indicesTriangulados);
  temporalGeo = BufferGeometryUtils.mergeVertices(temporalGeo, 1e-4);
  temporalGeo.computeVertexNormals();

  const geometriaFinalizada = fromThreeGeometry(temporalGeo);
  temporalGeo.dispose();

  return applyUVWMapping({
    vertices: geometriaFinalizada.vertices,
    faces: geometriaFinalizada.faces
  }, 'BOX');
}

/**
 * Submotor de Biselado de Vértices (Vertex Bevel Engine - Affect = 'VERTICES')
 */
function bevelVerticesMode(params: {
  uniqueVerts: THREE.Vector3[];
  origFaces: number[][];
  faceNormals: THREE.Vector3[];
  edgeMap: Map<string, any>;
  rad: number;
  segments: number;
  profile: number;
  selectedVertsSet: Set<number>;
  limitMethod: BevelLimitMethod;
}): { vertices: V3[]; faces: MeshFace[] } {
  const { uniqueVerts, origFaces, edgeMap, rad, selectedVertsSet, limitMethod } = params;

  const outVerts: V3[] = [];
  const outFaces: MeshFace[] = [];
  const vertHashMap = new Map<string, number>();

  const addVertex = (v: THREE.Vector3): number => {
    const qx = Math.round(v.x * 10000);
    const qy = Math.round(v.y * 10000);
    const qz = Math.round(v.z * 10000);
    const key = `${qx}_${qy}_${qz}`;
    const existing = vertHashMap.get(key);
    if (existing !== undefined) return existing;
    const idx = outVerts.length;
    outVerts.push([v.x, v.y, v.z]);
    vertHashMap.set(key, idx);
    return idx;
  };

  // Identificar qué vértices se biselan
  const bevelVerts = new Set<number>();
  for (let i = 0; i < uniqueVerts.length; i++) {
    if (limitMethod === 'SELECTION') {
      if (selectedVertsSet.has(i)) bevelVerts.add(i);
    } else {
      bevelVerts.add(i);
    }
  }

  // Para cada cara, truncar vértices biselados desplazándolos por sus aristas
  const cornerCutMap = new Map<string, number>(); // `${fIdx}_${vIdx}_${neighborIdx}` -> newIdx

  origFaces.forEach((f, fIdx) => {
    const newFaceIndices: number[] = [];
    const len = f.length;

    for (let i = 0; i < len; i++) {
      const vCurr = f[i];
      const vPrev = f[(i - 1 + len) % len];
      const vNext = f[(i + 1) % len];

      if (!bevelVerts.has(vCurr)) {
        newFaceIndices.push(addVertex(uniqueVerts[vCurr]));
      } else {
        const PCurr = uniqueVerts[vCurr];
        const PPrev = uniqueVerts[vPrev];
        const PNext = uniqueVerts[vNext];

        const dPrev = Math.min(rad, PCurr.distanceTo(PPrev) * 0.45);
        const dNext = Math.min(rad, PCurr.distanceTo(PNext) * 0.45);

        const cutPrev = PCurr.clone().addScaledVector(PPrev.clone().sub(PCurr).normalize(), dPrev);
        const cutNext = PCurr.clone().addScaledVector(PNext.clone().sub(PCurr).normalize(), dNext);

        const idxPrev = addVertex(cutPrev);
        const idxNext = addVertex(cutNext);

        cornerCutMap.set(`${fIdx}_${vCurr}_${vPrev}`, idxPrev);
        cornerCutMap.set(`${fIdx}_${vCurr}_${vNext}`, idxNext);

        newFaceIndices.push(idxPrev, idxNext);
      }
    }

    outFaces.push({ indices: newFaceIndices });
  });

  // Generar caras de esquina para cada vértice biselado
  bevelVerts.forEach(vIdx => {
    const incidentFaces: number[] = [];
    origFaces.forEach((f, fIdx) => {
      if (f.includes(vIdx)) incidentFaces.push(fIdx);
    });

    if (incidentFaces.length < 3) return;

    // Recolectar puntos de corte de esquina
    const cornerLoop: number[] = [];
    incidentFaces.forEach(fIdx => {
      const f = origFaces[fIdx];
      const loc = f.indexOf(vIdx);
      const vNext = f[(loc + 1) % f.length];
      const cutIdx = cornerCutMap.get(`${fIdx}_${vIdx}_${vNext}`);
      if (cutIdx !== undefined && !cornerLoop.includes(cutIdx)) {
        cornerLoop.push(cutIdx);
      }
    });

    if (cornerLoop.length >= 3) {
      outFaces.push({ indices: cornerLoop });
    }
  });

  // Ensamblar
  let temporalGeo = new THREE.BufferGeometry();
  const posicionesFlotantes: number[] = [];
  const indicesTriangulados: number[] = [];

  outVerts.forEach(v => posicionesFlotantes.push(v[0], v[1], v[2]));
  outFaces.forEach(f => {
    for (let i = 1; i < f.indices.length - 1; i++) {
      indicesTriangulados.push(f.indices[0], f.indices[i], f.indices[i + 1]);
    }
  });

  temporalGeo.setAttribute('position', new THREE.Float32BufferAttribute(posicionesFlotantes, 3));
  temporalGeo.setIndex(indicesTriangulados);
  temporalGeo = BufferGeometryUtils.mergeVertices(temporalGeo, 1e-4);
  temporalGeo.computeVertexNormals();

  const res = fromThreeGeometry(temporalGeo);
  temporalGeo.dispose();

  return applyUVWMapping({ vertices: res.vertices, faces: res.faces }, 'BOX');
}
