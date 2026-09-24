import * as THREE from 'three';
import { V3, MeshFace } from '../types';

export interface LimitedDissolveOptions {
  /** Umbral angular máximo en grados para considerar normales coplanares (default: 5.0) */
  maxAngleDeg?: number;
  /** Umbral angular para colapso de vértices colineales de grado 2 en los bucles de borde (default: maxAngleDeg * 0.8) */
  collinearAngleDeg?: number;
  /** Proteger costuras de coordenadas UV (evitar fusionar triángulos con saltos de UV) (default: true) */
  protectUVSeams?: boolean;
  /** Proteger delimitaciones entre diferentes materiales o subgrupos de la geometría (default: true) */
  protectMaterialBoundaries?: boolean;
  /** Ajustar matemáticamente los vértices al plano promedio del cluster coplanar (default: false) */
  snapToPlane?: boolean;
  /** Intentar emparejar pares de triángulos coplanares en quads cuando sea posible (default: false) */
  quadMerge?: boolean;
}

export interface LimitedDissolveResult {
  modified: boolean;
  initialFaces: number;
  finalFaces: number;
  facesReduced: number;
  processedObjects: number;
}

/**
 * 2D Ear-Clipping y Shape Triangulator para polígonos N-gon proyectados sobre su plano coplanar.
 * Evita diagonales superpuestas y usa la diagonal óptima para quads.
 */
function triangulate2D(points2D: { x: number; y: number }[]): [number, number, number][] {
  const n = points2D.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Calcular área firmada para saber la orientación del polígono (CCW > 0)
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea += points2D[i].x * points2D[j].y - points2D[j].x * points2D[i].y;
  }
  const isCCW = signedArea >= 0;

  if (n === 4) {
    // Quad geométrico exacto: evaluar ambas diagonales (0-2 y 1-3)
    const p0 = points2D[0], p1 = points2D[1], p2 = points2D[2], p3 = points2D[3];
    const cross2D = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

    // Diagonal 0-2 es válida si p2 está entre p1 y p3 respecto a p0
    const c0_12 = cross2D(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y);
    const c0_23 = cross2D(p0.x, p0.y, p2.x, p2.y, p3.x, p3.y);
    const diag02Valid = isCCW ? (c0_12 > 1e-9 && c0_23 > 1e-9) : (c0_12 < -1e-9 && c0_23 < -1e-9);

    // Diagonal 1-3 es válida si p3 está entre p2 y p0 respecto a p1
    const c1_23 = cross2D(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    const c1_30 = cross2D(p1.x, p1.y, p3.x, p3.y, p0.x, p0.y);
    const diag13Valid = isCCW ? (c1_23 > 1e-9 && c1_30 > 1e-9) : (c1_23 < -1e-9 && c1_30 < -1e-9);

    const d02 = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const d13 = Math.hypot(p3.x - p1.x, p3.y - p1.y);

    let use02 = true;
    if (diag02Valid && diag13Valid) {
      use02 = d02 <= d13;
    } else if (diag13Valid) {
      use02 = false;
    }

    if (use02) {
      return isCCW ? [[0, 1, 2], [0, 2, 3]] : [[0, 2, 1], [0, 3, 2]];
    } else {
      return isCCW ? [[0, 1, 3], [1, 2, 3]] : [[0, 3, 1], [1, 3, 2]];
    }
  }

  // Utilizar el algoritmo canónico de Three.js si es CCW
  try {
    const contour = (isCCW ? points2D : [...points2D].reverse()).map(p => new THREE.Vector2(p.x, p.y));
    const shapeTris = THREE.ShapeUtils.triangulateShape(contour, []);
    if (shapeTris && shapeTris.length > 0) {
      if (isCCW) {
        return shapeTris as [number, number, number][];
      } else {
        const revIdx = (idx: number) => n - 1 - idx;
        return shapeTris.map(([a, b, c]) => [revIdx(a), revIdx(c), revIdx(b)]) as [number, number, number][];
      }
    }
  } catch (_) {}

  const indices: number[] = Array.from({ length: n }, (_, i) => i);
  const tris: [number, number, number][] = [];

  const isPointInTri = (
    px: number, py: number,
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number
  ) => {
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const v2x = px - ax, v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-12);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return u >= 0 && v >= 0 && u + v <= 1;
  };

  const isEar = (prevIdx: number, currIdx: number, nextIdx: number, list: number[]) => {
    const a = points2D[prevIdx];
    const b = points2D[currIdx];
    const c = points2D[nextIdx];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (isCCW ? cross <= 1e-9 : cross >= -1e-9) return false;

    for (let k = 0; k < list.length; k++) {
      const idx = list[k];
      if (idx === prevIdx || idx === currIdx || idx === nextIdx) continue;
      const p = points2D[idx];
      if (isPointInTri(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y)) {
        return false;
      }
    }
    return true;
  };

  let count = indices.length;
  let iter = 0;
  const maxIter = count * count * 2;

  while (count > 3 && iter < maxIter) {
    iter++;
    let earFound = false;

    for (let i = 0; i < count; i++) {
      const prev = indices[(i - 1 + count) % count];
      const curr = indices[i];
      const next = indices[(i + 1) % count];

      if (isEar(prev, curr, next, indices)) {
        tris.push([prev, curr, next]);
        indices.splice(i, 1);
        count--;
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      break;
    }
  }

  if (count === 3) {
    tris.push([indices[0], indices[1], indices[2]]);
  } else if (count > 3) {
    for (let i = 1; i < count - 1; i++) {
      tris.push([indices[0], indices[i], indices[i + 1]]);
    }
  }

  return tris;
}

/**
 * Resuelve la transformación afín 2D (u, v) = (a*x + b*y + c0, d*x + e*y + c1) para interpolar UVs
 */
function solveAffineUV(
  pA: { u: number; v: number }, uvA: [number, number],
  pB: { u: number; v: number }, uvB: [number, number],
  pC: { u: number; v: number }, uvC: [number, number]
): ((u: number, v: number) => [number, number]) | null {
  const det = (pB.u - pA.u) * (pC.v - pA.v) - (pC.u - pA.u) * (pB.v - pA.v);
  if (Math.abs(det) < 1e-10) return null;

  const duB = uvB[0] - uvA[0];
  const duC = uvC[0] - uvA[0];
  const dvB = uvB[1] - uvA[1];
  const dvC = uvC[1] - uvA[1];

  const dxB = pB.u - pA.u;
  const dxC = pC.u - pA.u;
  const dyB = pB.v - pA.v;
  const dyC = pC.v - pA.v;

  const a = (duB * dyC - duC * dyB) / det;
  const b = (dxB * duC - dxC * duB) / det;
  const d = (dvB * dyC - dvC * dyB) / det;
  const e = (dxB * dvC - dxC * dvB) / det;

  return (u: number, v: number): [number, number] => {
    const du = u - pA.u;
    const dv = v - pA.v;
    return [uvA[0] + a * du + b * dv, uvA[1] + d * du + e * dv];
  };
}

/**
 * Ejecuta el algoritmo Limited Dissolve (BMesh Topological Dissolve de 3 fases) sobre un THREE.BufferGeometry.
 */
export function limitedDissolveGeometry(
  geometry: THREE.BufferGeometry,
  options?: LimitedDissolveOptions
): { modified: boolean; initialFaces: number; finalFaces: number; facesReduced: number } {
  const posAttr = geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) {
    return { modified: false, initialFaces: 0, finalFaces: 0, facesReduced: 0 };
  }

  const initialTris = geometry.index ? geometry.index.count / 3 : posAttr.count / 3;
  if (initialTris <= 2) {
    return { modified: false, initialFaces: initialTris, finalFaces: initialTris, facesReduced: 0 };
  }

  const maxAngleDeg = options?.maxAngleDeg ?? 5.0;
  const collinearTolDeg = options?.collinearAngleDeg ?? Math.max(2.0, maxAngleDeg * 0.8);
  const protectUVSeams = options?.protectUVSeams ?? true;
  const protectMaterialBoundaries = options?.protectMaterialBoundaries ?? true;
  const snapToPlane = options?.snapToPlane ?? false;

  const uvAttr = geometry.attributes.uv;
  const count = posAttr.count;
  const hasUV = !!uvAttr && uvAttr.count === count;

  // 1. Calcular caja delimitadora y factor de cuantización espacial
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const px = posAttr.getX(i), py = posAttr.getY(i), pz = posAttr.getZ(i);
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }
  const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
  const quantizeScale = Math.min(100000, Math.max(1000, Math.round(10000 / bboxDiag)));

  // Unificar vértices geométricamente coincidentes por posición 3D (Spatial Welding)
  const keyMap = new Map<string, number>();
  const remap = new Uint32Array(count);
  const newPositions: V3[] = [];
  const vertUVs: ([number, number] | undefined)[] = [];
  
  // Preservar atributos de esqueleto y huesos (skinIndex y skinWeight) para modelos articulados
  const skinIndexAttr = geometry.attributes.skinIndex;
  const skinWeightAttr = geometry.attributes.skinWeight;
  const hasSkin = !!skinIndexAttr && !!skinWeightAttr;
  const vertSkinIndices: [number, number, number, number][] = [];
  const vertSkinWeights: [number, number, number, number][] = [];

  let uniqueCount = 0;

  for (let i = 0; i < count; i++) {
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);

    const qx = Math.round(px * quantizeScale);
    const qy = Math.round(py * quantizeScale);
    const qz = Math.round(pz * quantizeScale);
    const k = `${qx}_${qy}_${qz}`;

    let idx = keyMap.get(k);
    if (idx === undefined) {
      idx = uniqueCount++;
      keyMap.set(k, idx);
      newPositions.push([px, py, pz]);
      if (hasUV) vertUVs.push([uvAttr.getX(i), uvAttr.getY(i)]);
      if (hasSkin) {
        vertSkinIndices.push([
          skinIndexAttr.getX(i),
          skinIndexAttr.getY(i),
          skinIndexAttr.getZ(i),
          skinIndexAttr.getW(i),
        ]);
        vertSkinWeights.push([
          skinWeightAttr.getX(i),
          skinWeightAttr.getY(i),
          skinWeightAttr.getZ(i),
          skinWeightAttr.getW(i),
        ]);
      }
    }
    remap[i] = idx;
  }

  // Extraer caras y grupos de material
  const faces: MeshFace[] = [];
  const faceGroupIndices: number[] = [];

  const groups = geometry.groups && geometry.groups.length > 0 ? geometry.groups : null;

  if (geometry.index) {
    const idxAttr = geometry.index;
    for (let f = 0; f < idxAttr.count; f += 3) {
      const orig0 = idxAttr.getX(f);
      const orig1 = idxAttr.getX(f + 1);
      const orig2 = idxAttr.getX(f + 2);
      const i0 = remap[orig0];
      const i1 = remap[orig1];
      const i2 = remap[orig2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;

      let groupMat = 0;
      if (groups && protectMaterialBoundaries) {
        for (let g = 0; g < groups.length; g++) {
          if (f >= groups[g].start && f < groups[g].start + groups[g].count) {
            groupMat = groups[g].materialIndex ?? g;
            break;
          }
        }
      }

      faces.push({
        indices: [i0, i1, i2],
        uvs: hasUV ? [
          [uvAttr.getX(orig0), uvAttr.getY(orig0)],
          [uvAttr.getX(orig1), uvAttr.getY(orig1)],
          [uvAttr.getX(orig2), uvAttr.getY(orig2)]
        ] : undefined
      });
      faceGroupIndices.push(groupMat);
    }
  } else {
    for (let f = 0; f < count; f += 3) {
      const i0 = remap[f];
      const i1 = remap[f + 1];
      const i2 = remap[f + 2];
      if (i0 === i1 || i1 === i2 || i2 === i0) continue;

      let groupMat = 0;
      if (groups && protectMaterialBoundaries) {
        for (let g = 0; g < groups.length; g++) {
          if (f >= groups[g].start && f < groups[g].start + groups[g].count) {
            groupMat = groups[g].materialIndex ?? g;
            break;
          }
        }
      }

      faces.push({
        indices: [i0, i1, i2],
        uvs: hasUV ? [
          [uvAttr.getX(f), uvAttr.getY(f)],
          [uvAttr.getX(f + 1), uvAttr.getY(f + 1)],
          [uvAttr.getX(f + 2), uvAttr.getY(f + 2)]
        ] : undefined
      });
      faceGroupIndices.push(groupMat);
    }
  }

  if (faces.length === 0) {
    return { modified: false, initialFaces: initialTris, finalFaces: initialTris, facesReduced: 0 };
  }

  // =========================================================================
  // FASE 1: FILTRADO POR UMBRAL DE ÁNGULO (Cálculo de Producto Escalar)
  // =========================================================================
  const cosTol = Math.cos((maxAngleDeg * Math.PI) / 180);
  const faceNormals: (THREE.Vector3 | null)[] = [];
  const faceCenters: (THREE.Vector3 | null)[] = [];

  const vertVectors = newPositions.map(v => new THREE.Vector3(v[0], v[1], v[2]));

  faces.forEach((f) => {
    const [i0, i1, i2] = f.indices;
    const v0 = vertVectors[i0];
    const v1 = vertVectors[i1];
    const v2 = vertVectors[i2];
    const d1 = new THREE.Vector3().subVectors(v1, v0);
    const d2 = new THREE.Vector3().subVectors(v2, v0);
    const norm = new THREE.Vector3().crossVectors(d1, d2);
    const len = norm.length();
    if (len > 1e-9) {
      norm.divideScalar(len);
      faceNormals.push(norm);
      faceCenters.push(new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3));
    } else {
      faceNormals.push(null);
      faceCenters.push(null);
    }
  });

  // Mapear aristas compartidas entre caras
  const edgeToFaces = new Map<string, number[]>();
  faces.forEach((f, fIdx) => {
    const [i0, i1, i2] = f.indices;
    const edges = [
      [Math.min(i0, i1), Math.max(i0, i1)],
      [Math.min(i1, i2), Math.max(i1, i2)],
      [Math.min(i2, i0), Math.max(i2, i0)]
    ];
    edges.forEach(([u, v]) => {
      const key = `${u}_${v}`;
      let list = edgeToFaces.get(key);
      if (!list) {
        list = [];
        edgeToFaces.set(key, list);
      }
      list.push(fIdx);
    });
  });

  // Disjoint Set Union (DSU) para agrupar caras coplanares contiguas
  const parent = Array.from({ length: faces.length }, (_, i) => i);
  const find = (i: number): number => {
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
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  };

  edgeToFaces.forEach((sharedFaces) => {
    if (sharedFaces.length !== 2) return;
    const [f1, f2] = sharedFaces;

    // Protección de grupos de material
    if (protectMaterialBoundaries && faceGroupIndices[f1] !== faceGroupIndices[f2]) return;

    // Protección de costuras UV reales si protectUVSeams está activo
    if (protectUVSeams && hasUV) {
      const f1Obj = faces[f1];
      const f2Obj = faces[f2];
      if (f1Obj.uvs && f2Obj.uvs) {
        // Encontrar los 2 vértices geométricos compartidos
        for (let a = 0; a < 3; a++) {
          const vA = f1Obj.indices[a];
          const b = f2Obj.indices.indexOf(vA);
          if (b !== -1) {
            const uv1 = f1Obj.uvs[a];
            const uv2 = f2Obj.uvs[b];
            // Solo considerar corte si hay una discontinuidad UV mayor (islas separadas en atlas)
            if (Math.abs(uv1[0] - uv2[0]) > 0.15 || Math.abs(uv1[1] - uv2[1]) > 0.15) {
              return;
            }
          }
        }
      }
    }

    const n1 = faceNormals[f1];
    const n2 = faceNormals[f2];
    if (!n1 || !n2) return;

    // Producto escalar entre normales
    const dot = n1.dot(n2);
    if (dot < cosTol) return;

    // Test de distancia punto-plano relativo a la escala de la geometría y tolerancia angular
    const c1 = faceCenters[f1]!;
    const c2 = faceCenters[f2]!;
    const diff = new THREE.Vector3().subVectors(c2, c1);
    const planeDist = Math.abs(diff.dot(n1));
    const angleRad = (maxAngleDeg * Math.PI) / 180;
    const maxPlaneDist = Math.max(0.012, bboxDiag * 0.035 * Math.max(0.1, Math.sin(angleRad)));
    if (planeDist > maxPlaneDist) return;

    union(f1, f2);
  });

  // Agrupar caras por cluster coplanar
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < faces.length; i++) {
    const root = find(i);
    let list = clusters.get(root);
    if (!list) {
      list = [];
      clusters.set(root, list);
    }
    list.push(i);
  }

  // =========================================================================
  // FASE 2: FUSIÓN TOPOLÓGICA DE BMESH (Edge Dissolve + Bucles de Frontera)
  // =========================================================================
  interface ClusterInfo {
    root: number;
    faceIndices: number[];
    loops: number[][];
    clusterNormal: THREE.Vector3;
    U: THREE.Vector3;
    V: THREE.Vector3;
    vertUVMap: Map<number, [number, number]>;
    affineEvaluator: ((u: number, v: number) => [number, number]) | null;
    materialIndex: number;
  }

  const clusterInfoList: ClusterInfo[] = [];

  clusters.forEach((fIndices, root) => {
    if (fIndices.length === 1) {
      // Cara aislada que no requiere fusión
      return;
    }

    // Normal promedio del cluster coplanar
    const avgNormal = new THREE.Vector3();
    let validNormCount = 0;
    fIndices.forEach(fi => {
      const n = faceNormals[fi];
      if (n) {
        avgNormal.add(n);
        validNormCount++;
      }
    });
    if (validNormCount === 0) return;
    avgNormal.normalize();

    // Base ortonormal 2D (U, V) perpendicular a la normal del cluster
    const helper = Math.abs(avgNormal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const U = new THREE.Vector3().crossVectors(avgNormal, helper).normalize();
    const V = new THREE.Vector3().crossVectors(avgNormal, U).normalize();

    // Contar aristas dirigidas en el cluster.
    // Las aristas internas compartidas aparecen en direcciones opuestas y se eliminan (Edge Dissolve).
    const directedEdges = new Map<string, { from: number; to: number }>();
    const edgeCounts = new Map<string, number>();

    fIndices.forEach(fi => {
      const [i0, i1, i2] = faces[fi].indices;
      const faceDirEdges = [
        { from: i0, to: i1 },
        { from: i1, to: i2 },
        { from: i2, to: i0 }
      ];
      faceDirEdges.forEach(e => {
        const undirectedKey = `${Math.min(e.from, e.to)}_${Math.max(e.from, e.to)}`;
        edgeCounts.set(undirectedKey, (edgeCounts.get(undirectedKey) || 0) + 1);
        directedEdges.set(`${e.from}->${e.to}`, e);
      });
    });

    // Las aristas perimetrales del N-gon son aquellas con conteo = 1 dentro del cluster
    const adjOut = new Map<number, number[]>();
    directedEdges.forEach(e => {
      const undirectedKey = `${Math.min(e.from, e.to)}_${Math.max(e.from, e.to)}`;
      if (edgeCounts.get(undirectedKey) === 1) {
        let list = adjOut.get(e.from);
        if (!list) {
          list = [];
          adjOut.set(e.from, list);
        }
        list.push(e.to);
      }
    });

    // Reconstruir bucles cerrados (loops)
    const visitedEdges = new Set<string>();
    const loops: number[][] = [];

    adjOut.forEach((targets, startVert) => {
      for (const initialTarget of targets) {
        const initialEdgeKey = `${startVert}->${initialTarget}`;
        if (visitedEdges.has(initialEdgeKey)) continue;

        const loop: number[] = [startVert];
        visitedEdges.add(initialEdgeKey);
        let curr = initialTarget;
        let prev = startVert;
        let loopOk = false;

        const maxSteps = directedEdges.size + 10;
        let steps = 0;

        while (steps++ < maxSteps) {
          if (curr === startVert) {
            loopOk = true;
            break;
          }
          loop.push(curr);

          const nextCandidates = adjOut.get(curr);
          if (!nextCandidates || nextCandidates.length === 0) break;

          let chosenNext = -1;
          if (nextCandidates.length === 1) {
            chosenNext = nextCandidates[0];
          } else {
            // Si hay bifurcación en el mismo vértice, seleccionar el giro más hacia la izquierda (CCW)
            const pPrev = vertVectors[prev];
            const pCurr = vertVectors[curr];
            const inUx = pCurr.dot(U) - pPrev.dot(U);
            const inVy = pCurr.dot(V) - pPrev.dot(V);
            const inAngle = Math.atan2(inVy, inUx);

            let bestAngleDiff = -Infinity;
            for (const cand of nextCandidates) {
              const edgeK = `${curr}->${cand}`;
              if (visitedEdges.has(edgeK) && cand !== startVert) continue;
              const pCand = vertVectors[cand];
              const outUx = pCand.dot(U) - pCurr.dot(U);
              const outVy = pCand.dot(V) - pCurr.dot(V);
              const outAngle = Math.atan2(outVy, outUx);
              let diff = outAngle - inAngle;
              while (diff <= -Math.PI) diff += 2 * Math.PI;
              while (diff > Math.PI) diff -= 2 * Math.PI;
              if (diff > bestAngleDiff) {
                bestAngleDiff = diff;
                chosenNext = cand;
              }
            }
            if (chosenNext === -1) chosenNext = nextCandidates[0];
          }

          const chosenEdgeKey = `${curr}->${chosenNext}`;
          if (visitedEdges.has(chosenEdgeKey)) break;
          visitedEdges.add(chosenEdgeKey);

          prev = curr;
          curr = chosenNext;
        }

        if (loopOk && loop.length >= 3) {
          // Asegurar orden CCW respecto a la normal del cluster
          let area2D = 0;
          for (let i = 0; i < loop.length; i++) {
            const j = (i + 1) % loop.length;
            const p1 = vertVectors[loop[i]];
            const p2 = vertVectors[loop[j]];
            area2D += (p1.dot(U) * p2.dot(V) - p2.dot(U) * p1.dot(V));
          }
          if (area2D < 0) {
            loop.reverse();
          }
          loops.push(loop);
        }
      }
    });

    if (loops.length === 0) return;

    // Recolectar mapa de UVs originales
    const vertUVMap = new Map<number, [number, number]>();
    let bestTriUVs: { pA: { u: number; v: number }; uvA: [number, number]; pB: { u: number; v: number }; uvB: [number, number]; pC: { u: number; v: number }; uvC: [number, number] } | null = null;

    fIndices.forEach(fi => {
      const face = faces[fi];
      if (face.uvs && face.uvs.length === 3) {
        face.indices.forEach((vIdx, k) => {
          if (!vertUVMap.has(vIdx)) {
            vertUVMap.set(vIdx, face.uvs![k]);
          }
        });
        if (!bestTriUVs) {
          const [i0, i1, i2] = face.indices;
          const v0 = vertVectors[i0];
          const v1 = vertVectors[i1];
          const v2 = vertVectors[i2];
          bestTriUVs = {
            pA: { u: v0.dot(U), v: v0.dot(V) }, uvA: face.uvs[0],
            pB: { u: v1.dot(U), v: v1.dot(V) }, uvB: face.uvs[1],
            pC: { u: v2.dot(U), v: v2.dot(V) }, uvC: face.uvs[2],
          };
        }
      }
    });

    const affineEvaluator = bestTriUVs ? solveAffineUV(bestTriUVs.pA, bestTriUVs.uvA, bestTriUVs.pB, bestTriUVs.uvB, bestTriUVs.pC, bestTriUVs.uvC) : null;

    clusterInfoList.push({
      root,
      faceIndices: fIndices,
      loops,
      clusterNormal: avgNormal,
      U,
      V,
      vertUVMap,
      affineEvaluator,
      materialIndex: faceGroupIndices[fIndices[0]] ?? 0
    });
  });

  // =========================================================================
  // FASE 3: LIMPIEZA DE VÉRTICES DE GRADO 2 Y TESELADO (Ear-Clipping 2D)
  // =========================================================================
  const cosCollinear = Math.cos((collinearTolDeg * Math.PI) / 180);

  const vertIsCollinearInLoop = (v: number, loop: number[]): boolean => {
    const n = loop.length;
    const idx = loop.indexOf(v);
    if (idx === -1) return false;
    const prev = loop[(idx - 1 + n) % n];
    const next = loop[(idx + 1) % n];
    const pA = vertVectors[prev];
    const pB = vertVectors[v];
    const pC = vertVectors[next];
    const d1 = new THREE.Vector3().subVectors(pB, pA).normalize();
    const d2 = new THREE.Vector3().subVectors(pC, pB).normalize();
    return d1.dot(d2) >= cosCollinear;
  };

  const allLoopVerts = new Set<number>();
  clusterInfoList.forEach(ci => ci.loops.forEach(l => l.forEach(v => allLoopVerts.add(v))));

  const allDissolvedFaces = new Set<number>();
  clusterInfoList.forEach(ci => ci.faceIndices.forEach(fi => allDissolvedFaces.add(fi)));

  // Mapa de caras incidentes en cada vértice
  const vertToFaces = new Map<number, Set<number>>();
  faces.forEach((f, fIdx) => {
    f.indices.forEach(v => {
      let set = vertToFaces.get(v);
      if (!set) {
        set = new Set();
        vertToFaces.set(v, set);
      }
      set.add(fIdx);
    });
  });

  const removableVerts = new Set<number>();
  allLoopVerts.forEach(v => {
    // Vértices de grado 2 en la frontera perimetral (exactamente 1 arista entrante y 1 saliente)
    const loopsWithV: number[][] = [];
    let perimeterDegree = 0;
    clusterInfoList.forEach(ci => {
      ci.loops.forEach(l => {
        let countInLoop = 0;
        for (let i = 0; i < l.length; i++) {
          if (l[i] === v) countInLoop++;
        }
        if (countInLoop > 0) {
          loopsWithV.push(l);
          perimeterDegree += countInLoop * 2;
        }
      });
    });

    const incidentFaces = vertToFaces.get(v);
    const hasOnlyDissolvedFaces = !incidentFaces || Array.from(incidentFaces).every(f => allDissolvedFaces.has(f));
    const isCollinearInAllLoops = loopsWithV.length > 0 && loopsWithV.every(l => vertIsCollinearInLoop(v, l));
    const isSafeDegree = perimeterDegree === 2 || (loopsWithV.length === 2 && perimeterDegree === 4);

    if (isSafeDegree && hasOnlyDissolvedFaces && isCollinearInAllLoops) {
      removableVerts.add(v);
    }
  });

  // Generar nuevas caras trianguladas
  const processedClusterRoots = new Set<number>();
  const finalTriangles: { indices: [number, number, number]; uvs?: [number, number][]; materialIndex: number }[] = [];

  clusterInfoList.forEach(ci => {
    processedClusterRoots.add(ci.root);
    const { loops, U, V, vertUVMap, affineEvaluator, materialIndex } = ci;

    const getVertexUV = (vIdx: number): [number, number] | undefined => {
      if (vertUVMap.has(vIdx)) return vertUVMap.get(vIdx)!;
      if (affineEvaluator) {
        const p = vertVectors[vIdx];
        return affineEvaluator(p.dot(U), p.dot(V));
      }
      return vertUVs[vIdx];
    };

    loops.forEach(rawLoop => {
      // Eliminar vértices redundantes de grado 2
      let cleanLoop = rawLoop.filter(v => !removableVerts.has(v));
      if (cleanLoop.length < 3) cleanLoop = rawLoop;

      if (cleanLoop.length === 3) {
        finalTriangles.push({
          indices: [cleanLoop[0], cleanLoop[1], cleanLoop[2]],
          uvs: hasUV ? [getVertexUV(cleanLoop[0]) || [0, 0], getVertexUV(cleanLoop[1]) || [0, 0], getVertexUV(cleanLoop[2]) || [0, 0]] : undefined,
          materialIndex
        });
        return;
      }

      // Proyección 2D para Ear Clipping
      const points2D = cleanLoop.map(vIdx => {
        const p = vertVectors[vIdx];
        return { x: p.dot(U), y: p.dot(V) };
      });

      const earTris = triangulate2D(points2D);
      earTris.forEach(([t0, t1, t2]) => {
        const i0 = cleanLoop[t0];
        const i1 = cleanLoop[t1];
        const i2 = cleanLoop[t2];
        finalTriangles.push({
          indices: [i0, i1, i2],
          uvs: hasUV ? [getVertexUV(i0) || [0, 0], getVertexUV(i1) || [0, 0], getVertexUV(i2) || [0, 0]] : undefined,
          materialIndex
        });
      });
    });
  });

  // Conservar las caras que no formaron parte de ningún cluster disuelto
  faces.forEach((f, fIdx) => {
    const root = find(fIdx);
    if (!processedClusterRoots.has(root)) {
      finalTriangles.push({
        indices: [f.indices[0], f.indices[1], f.indices[2]],
        uvs: f.uvs && f.uvs.length === 3 ? [f.uvs[0], f.uvs[1], f.uvs[2]] : undefined,
        materialIndex: faceGroupIndices[fIdx] ?? 0
      });
    }
  });

  if (finalTriangles.length >= faces.length) {
    return { modified: false, initialFaces: initialTris, finalFaces: initialTris, facesReduced: 0 };
  }

  // Si snapToPlane está activo, asegurar planitud matemática proyectando al plano del cluster
  if (snapToPlane) {
    clusterInfoList.forEach(ci => {
      const planeNormal = ci.clusterNormal;
      const refPoint = vertVectors[ci.loops[0][0]];
      ci.loops.forEach(loop => {
        loop.forEach(vIdx => {
          const v = vertVectors[vIdx];
          const dist = new THREE.Vector3().subVectors(v, refPoint).dot(planeNormal);
          v.addScaledVector(planeNormal, -dist);
        });
      });
    });
  }

  // =========================================================================
  // RECONSTRUCCIÓN FINAL DE ATRIBUTOS EN BUFFERGEOMETRY
  // =========================================================================
  const usedVertMap = new Map<string, number>();
  const finalPositions: number[] = [];
  const finalUVs: number[] = [];
  const finalSkinIndices: number[] = [];
  const finalSkinWeights: number[] = [];
  const finalIndices: number[] = [];

  // Ordenar por materialIndex si hay grupos
  if (protectMaterialBoundaries && groups) {
    finalTriangles.sort((a, b) => a.materialIndex - b.materialIndex);
  }

  const newGroups: { start: number; count: number; materialIndex: number }[] = [];
  let currentMatIndex = -1;
  let groupStart = 0;
  let groupCount = 0;

  for (const tri of finalTriangles) {
    if (protectMaterialBoundaries && groups) {
      if (tri.materialIndex !== currentMatIndex) {
        if (groupCount > 0) {
          newGroups.push({ start: groupStart, count: groupCount, materialIndex: currentMatIndex });
        }
        currentMatIndex = tri.materialIndex;
        groupStart = finalIndices.length;
        groupCount = 0;
      }
    }

    for (let k = 0; k < 3; k++) {
      const vIdx = tri.indices[k];
      const uv = tri.uvs ? tri.uvs[k] : (vertUVs[vIdx] || [0, 0]);
      const uvKey = hasUV ? `${Math.round(uv[0] * 10000)}_${Math.round(uv[1] * 10000)}` : '0_0';
      const key = `${vIdx}_${uvKey}`;

      let newIdx = usedVertMap.get(key);
      if (newIdx === undefined) {
        newIdx = usedVertMap.size;
        usedVertMap.set(key, newIdx);
        const p = vertVectors[vIdx];
        finalPositions.push(p.x, p.y, p.z);
        if (hasUV) {
          finalUVs.push(uv[0], uv[1]);
        }
        if (hasSkin) {
          const si = vertSkinIndices[vIdx] || [0, 0, 0, 0];
          const sw = vertSkinWeights[vIdx] || [1, 0, 0, 0];
          finalSkinIndices.push(si[0], si[1], si[2], si[3]);
          finalSkinWeights.push(sw[0], sw[1], sw[2], sw[3]);
        }
      }
      finalIndices.push(newIdx);
      groupCount++;
    }
  }

  if (protectMaterialBoundaries && groups && groupCount > 0) {
    newGroups.push({ start: groupStart, count: groupCount, materialIndex: currentMatIndex });
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
  if (hasUV) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(finalUVs, 2));
  }
  if (hasSkin) {
    const isUint8 = skinIndexAttr.array instanceof Uint8Array;
    const isUint16 = skinIndexAttr.array instanceof Uint16Array;
    const typedIndices = isUint8
      ? new Uint8Array(finalSkinIndices)
      : (isUint16 ? new Uint16Array(finalSkinIndices) : new Uint32Array(finalSkinIndices));
    const newSkinIndex = new THREE.BufferAttribute(typedIndices as any, 4);
    newSkinIndex.normalized = skinIndexAttr.normalized;
    geometry.setAttribute('skinIndex', newSkinIndex);

    // Normalizar pesos para que la suma sea exactamente 1.0 por vértice
    for (let wIdx = 0; wIdx < finalSkinWeights.length; wIdx += 4) {
      const sum = finalSkinWeights[wIdx] + finalSkinWeights[wIdx + 1] + finalSkinWeights[wIdx + 2] + finalSkinWeights[wIdx + 3];
      if (sum > 1e-6) {
        finalSkinWeights[wIdx] /= sum;
        finalSkinWeights[wIdx + 1] /= sum;
        finalSkinWeights[wIdx + 2] /= sum;
        finalSkinWeights[wIdx + 3] /= sum;
      } else {
        finalSkinWeights[wIdx] = 1.0;
        finalSkinWeights[wIdx + 1] = 0;
        finalSkinWeights[wIdx + 2] = 0;
        finalSkinWeights[wIdx + 3] = 0;
      }
    }
    const newSkinWeight = new THREE.BufferAttribute(new Float32Array(finalSkinWeights), 4);
    geometry.setAttribute('skinWeight', newSkinWeight);
  }
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(finalIndices), 1));

  if (newGroups.length > 0) {
    geometry.clearGroups();
    newGroups.forEach(g => geometry.addGroup(g.start, g.count, g.materialIndex));
  }

  try {
    geometry.computeVertexNormals();
  } catch (_) {}

  const finalFaceCount = finalTriangles.length;
  return {
    modified: true,
    initialFaces: initialTris,
    finalFaces: finalFaceCount,
    facesReduced: initialTris - finalFaceCount
  };
}

/**
 * Función de utilidad de procesamiento de mallas universal Limited Dissolve.
 * Acepta directamente un THREE.Mesh, THREE.BufferGeometry o un THREE.Object3D con jerarquías/grupos.
 * Recorre las aristas y caras del objeto, filtra por ángulo (producto escalar de normales),
 * fusiona bucles de aristas coplanares mediante BMesh Edge Dissolve y colapsa vértices colineales de grado 2.
 *
 * @param target Objeto Three.js objetivo (THREE.Mesh, THREE.BufferGeometry, o THREE.Object3D)
 * @param options Opciones de configuración de ángulo y preservación de fronteras
 */
export function limitedDissolve(
  target: THREE.Object3D | THREE.Mesh | THREE.BufferGeometry,
  options?: LimitedDissolveOptions
): LimitedDissolveResult {
  if (!target) {
    return { modified: false, initialFaces: 0, finalFaces: 0, facesReduced: 0, processedObjects: 0 };
  }

  // 1. Caso BufferGeometry directo
  if (target instanceof THREE.BufferGeometry) {
    const res = limitedDissolveGeometry(target, options);
    return {
      modified: res.modified,
      initialFaces: res.initialFaces,
      finalFaces: res.finalFaces,
      facesReduced: res.facesReduced,
      processedObjects: 1
    };
  }

  // 2. Caso THREE.Mesh directo
  if (target instanceof THREE.Mesh && target.geometry instanceof THREE.BufferGeometry) {
    const res = limitedDissolveGeometry(target.geometry, options);
    return {
      modified: res.modified,
      initialFaces: res.initialFaces,
      finalFaces: res.finalFaces,
      facesReduced: res.facesReduced,
      processedObjects: 1
    };
  }

  // 3. Caso THREE.Object3D jerárquico (Group, Scene, o jerarquías complejas)
  let totalInitial = 0;
  let totalFinal = 0;
  let totalReduced = 0;
  let modifiedCount = 0;
  let meshCount = 0;

  target.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BufferGeometry) {
      meshCount++;
      const res = limitedDissolveGeometry(child.geometry, options);
      totalInitial += res.initialFaces;
      totalFinal += res.finalFaces;
      totalReduced += res.facesReduced;
      if (res.modified) modifiedCount++;
    }
  });

  return {
    modified: modifiedCount > 0,
    initialFaces: totalInitial,
    finalFaces: totalFinal,
    facesReduced: totalReduced,
    processedObjects: meshCount
  };
}
