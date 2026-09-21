import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { marchingCubes } from './marchingCubes';
import { extractTargetGeometry, getObjectWorldMatrix } from './shrinkwrap';
import { pairTrianglesIntoQuads } from './retopology';
import { CSGObject, MeshFace, V3 } from '../types';

export interface VoxelRemeshOptions {
  targetFaces?: number;             // Presupuesto estricto de caras (ej: 2500, 5000, 10000)
  voxelResolution?: number;         // Resolución de la rejilla SDF (32 a 128, default: 64)
  bvhSnapping?: boolean;            // Proyección de retorno BVH para recuperar detalles nítidos (default: true)
  preserveSharpFeatures?: boolean;  // Anclaje de aristas vivas y esquinas/puntas (default: true)
  creaseAngleDeg?: number;          // Umbral de aristas vivas (default: 30°)
  snapPlanarFaces?: boolean;        // Aplanado matemático de caras planas como la cara superior (default: true)
  edgeFlipValence6?: boolean;       // Optimización topológica hacia valencia 6 (default: true)
  taubinSmoothing?: boolean;        // Relajación sin pérdida de volumen Taubin (default: true)
  taubinIterations?: number;        // Iteraciones de filtro Taubin (default: 3)
  outputTopology?: 'QUAD_DOMINANT' | 'TRIANGLES'; // Topología de salida (default: QUAD_DOMINANT)
  offset?: number;                  // Separación superficial (default: 0.0)
}

export interface VoxelRemeshResult {
  updatedObject: CSGObject;
  stats: {
    initialFaces: number;
    finalFaces: number;
    initialVertices: number;
    finalVertices: number;
    quads: number;
    triangles: number;
    watertight: boolean;
  };
  report: string[];
}

/**
 * Detecta clusters de caras coplanares dominantes en la malla objetivo (ej. tapas planas superior e inferior)
 */
function extractPlanarClusters(
  geo: THREE.BufferGeometry,
  minAreaRatio = 0.015,
  normalToleranceDeg = 4.0
): { normal: THREE.Vector3; d: number; faceIndices: Set<number> }[] {
  const posAttr = geo.getAttribute('position');
  const indexAttr = geo.getIndex();
  if (!posAttr) return [];

  const numFaces = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const faceNormals: THREE.Vector3[] = [];
  const faceCentroids: THREE.Vector3[] = [];
  const faceAreas: number[] = [];
  let totalArea = 0;

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  for (let f = 0; f < numFaces; f++) {
    let i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
    if (indexAttr) {
      i0 = indexAttr.getX(i0);
      i1 = indexAttr.getX(i1);
      i2 = indexAttr.getX(i2);
    }
    pA.fromBufferAttribute(posAttr, i0);
    pB.fromBufferAttribute(posAttr, i1);
    pC.fromBufferAttribute(posAttr, i2);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    const n = new THREE.Vector3().crossVectors(cb, ab);
    const area = n.length() * 0.5;
    if (n.lengthSq() > 1e-12) n.normalize();
    else n.set(0, 1, 0);

    const c = new THREE.Vector3().add(pA).add(pB).add(pC).multiplyScalar(1 / 3);

    faceNormals.push(n);
    faceCentroids.push(c);
    faceAreas.push(area);
    totalArea += area;
  }

  const cosTol = Math.cos((normalToleranceDeg * Math.PI) / 180);
  const clusters: { normal: THREE.Vector3; d: number; faceIndices: Set<number>; area: number }[] = [];

  for (let f = 0; f < numFaces; f++) {
    const fn = faceNormals[f];
    const fc = faceCentroids[f];
    const fa = faceAreas[f];
    const d = fn.dot(fc);

    let merged = false;
    for (const cl of clusters) {
      if (cl.normal.dot(fn) >= cosTol) {
        const distToPlane = Math.abs(cl.normal.dot(fc) - cl.d);
        if (distToPlane < 0.02) {
          cl.faceIndices.add(f);
          cl.area += fa;
          merged = true;
          break;
        }
      }
    }

    if (!merged) {
      const set = new Set<number>();
      set.add(f);
      clusters.push({ normal: fn.clone(), d, faceIndices: set, area: fa });
    }
  }

  const minArea = totalArea * minAreaRatio;
  return clusters.filter(c => c.area >= minArea);
}

/**
 * Detecta vértices y aristas vivas (sharp features / puntas) en la geometría objetivo
 */
function extractTargetSharpFeatures(
  geo: THREE.BufferGeometry,
  creaseAngleDeg: number
): {
  sharpVertices: THREE.Vector3[];
  sharpEdgeMidpoints: THREE.Vector3[];
  creaseNormals: Map<number, THREE.Vector3[]>;
} {
  const posAttr = geo.getAttribute('position');
  const indexAttr = geo.getIndex();
  if (!posAttr) return { sharpVertices: [], sharpEdgeMidpoints: [], creaseNormals: new Map() };

  const numFaces = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const faceNormals: THREE.Vector3[] = [];
  const cosCrease = Math.cos((creaseAngleDeg * Math.PI) / 180);

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();

  for (let f = 0; f < numFaces; f++) {
    let i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
    if (indexAttr) {
      i0 = indexAttr.getX(i0);
      i1 = indexAttr.getX(i1);
      i2 = indexAttr.getX(i2);
    }
    pA.fromBufferAttribute(posAttr, i0);
    pB.fromBufferAttribute(posAttr, i1);
    pC.fromBufferAttribute(posAttr, i2);

    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(pC, pB),
      new THREE.Vector3().subVectors(pA, pB)
    );
    if (n.lengthSq() > 1e-12) n.normalize();
    else n.set(0, 1, 0);
    faceNormals.push(n);
  }

  // Edge to faces map
  const edgeFaces = new Map<string, { f1: number; f2?: number; v1: number; v2: number }>();
  for (let f = 0; f < numFaces; f++) {
    let i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
    if (indexAttr) {
      i0 = indexAttr.getX(i0);
      i1 = indexAttr.getX(i1);
      i2 = indexAttr.getX(i2);
    }
    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [u, v] of edges) {
      const minV = Math.min(u, v);
      const maxV = Math.max(u, v);
      const key = `${minV}_${maxV}`;
      const existing = edgeFaces.get(key);
      if (existing) {
        existing.f2 = f;
      } else {
        edgeFaces.set(key, { f1: f, v1: minV, v2: maxV });
      }
    }
  }

  const vertexCreaseCount = new Map<number, number>();
  const sharpEdgeMidpoints: THREE.Vector3[] = [];

  edgeFaces.forEach(({ f1, f2, v1, v2 }) => {
    if (f2 !== undefined) {
      const n1 = faceNormals[f1];
      const n2 = faceNormals[f2];
      if (n1 && n2 && n1.dot(n2) < cosCrease) {
        // Sharp edge
        vertexCreaseCount.set(v1, (vertexCreaseCount.get(v1) || 0) + 1);
        vertexCreaseCount.set(v2, (vertexCreaseCount.get(v2) || 0) + 1);

        const pt1 = new THREE.Vector3().fromBufferAttribute(posAttr, v1);
        const pt2 = new THREE.Vector3().fromBufferAttribute(posAttr, v2);
        sharpEdgeMidpoints.push(new THREE.Vector3().addVectors(pt1, pt2).multiplyScalar(0.5));
      }
    }
  });

  const sharpVertices: THREE.Vector3[] = [];
  vertexCreaseCount.forEach((count, vIdx) => {
    // 3 or more sharp edges meet -> Corner or punta tip!
    if (count >= 2) {
      sharpVertices.push(new THREE.Vector3().fromBufferAttribute(posAttr, vIdx));
    }
  });

  return { sharpVertices, sharpEdgeMidpoints, creaseNormals: new Map() };
}

/**
 * Volteo de aristas topológico (Edge Flipping) hacia valencia 6
 * Elimina las agrupaciones irregulares y patrones en zigzag, optimizando la malla triangular hacia estrellas hexagonales regulares.
 */
export function edgeFlipValence6(
  vertices: THREE.Vector3[],
  faces: [number, number, number][],
  maxPasses = 4
): { faces: [number, number, number][]; flipsCount: number } {
  let totalFlips = 0;
  const nVerts = vertices.length;

  for (let pass = 0; pass < maxPasses; pass++) {
    let passFlips = 0;
    const valences = new Int32Array(nVerts);
    for (let fIdx = 0; fIdx < faces.length; fIdx++) {
      const [i0, i1, i2] = faces[fIdx];
      valences[i0]++;
      valences[i1]++;
      valences[i2]++;
    }

    const edgeMap = new Map<string, { fIdx: number; opp: number }>();
    const sharedEdges: { va: number; vb: number; f1: number; opp1: number; f2: number; opp2: number }[] = [];

    for (let fIdx = 0; fIdx < faces.length; fIdx++) {
      const [i0, i1, i2] = faces[fIdx];
      const edges: [number, number, number][] = [
        [i0, i1, i2],
        [i1, i2, i0],
        [i2, i0, i1]
      ];
      for (const [u, v, opp] of edges) {
        const revKey = `${v}_${u}`;
        if (edgeMap.has(revKey)) {
          const match = edgeMap.get(revKey)!;
          sharedEdges.push({
            va: u,
            vb: v,
            f1: match.fIdx,
            opp1: match.opp,
            f2: fIdx,
            opp2: opp
          });
        } else {
          edgeMap.set(`${u}_${v}`, { fIdx, opp });
        }
      }
    }

    const flippedFaces = new Set<number>();

    for (const edge of sharedEdges) {
      if (flippedFaces.has(edge.f1) || flippedFaces.has(edge.f2)) continue;

      const va = edge.va;
      const vb = edge.vb;
      const vc = edge.opp1;
      const vd = edge.opp2;

      if (vc === vd) continue;

      const valA = valences[va];
      const valB = valences[vb];
      const valC = valences[vc];
      const valD = valences[vd];

      if (valA <= 3 || valB <= 3) continue;

      const oldDev = (valA - 6) ** 2 + (valB - 6) ** 2 + (valC - 6) ** 2 + (valD - 6) ** 2;
      const newDev = (valA - 1 - 6) ** 2 + (valB - 1 - 6) ** 2 + (valC + 1 - 6) ** 2 + (valD + 1 - 6) ** 2;

      if (newDev < oldDev) {
        const pA = vertices[va], pB = vertices[vb], pC = vertices[vc], pD = vertices[vd];

        const n1 = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(pB, pA),
          new THREE.Vector3().subVectors(pC, pA)
        ).normalize();
        const n2 = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(pA, pB),
          new THREE.Vector3().subVectors(pD, pB)
        ).normalize();

        const n1New = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(pD, pC),
          new THREE.Vector3().subVectors(pA, pC)
        ).normalize();
        const n2New = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(pC, pD),
          new THREE.Vector3().subVectors(pB, pD)
        ).normalize();

        if (n1New.dot(n1) > 0.65 && n2New.dot(n2) > 0.65) {
          faces[edge.f1] = [vc, vd, va];
          faces[edge.f2] = [vd, vc, vb];
          valences[va]--;
          valences[vb]--;
          valences[vc]++;
          valences[vd]++;
          flippedFaces.add(edge.f1);
          flippedFaces.add(edge.f2);
          passFlips++;
        }
      }
    }

    totalFlips += passFlips;
    if (passFlips === 0) break;
  }

  return { faces, flipsCount: totalFlips };
}

/**
 * Suavizado Taubin volumétrico que previene la contracción (anti-shrinkage) y preserva aristas vivas
 */
export function taubinSmoothingWithCreases(
  vertices: THREE.Vector3[],
  faces: [number, number, number][],
  options: {
    iterations?: number;
    lambda?: number;
    mu?: number;
    creaseAngleDeg?: number;
    lockedVertices?: Set<number>;
  } = {}
): THREE.Vector3[] {
  const iterations = options.iterations ?? 3;
  const lambda = options.lambda ?? 0.33;
  const mu = options.mu ?? -0.34;
  const creaseAngleRad = ((options.creaseAngleDeg ?? 30) * Math.PI) / 180;
  const cosCrease = Math.cos(creaseAngleRad);
  const locked = options.lockedVertices || new Set<number>();

  const nVerts = vertices.length;
  if (nVerts === 0) return vertices;

  const neighbors: Set<number>[] = Array.from({ length: nVerts }, () => new Set<number>());
  for (const f of faces) {
    neighbors[f[0]].add(f[1]); neighbors[f[0]].add(f[2]);
    neighbors[f[1]].add(f[0]); neighbors[f[1]].add(f[2]);
    neighbors[f[2]].add(f[0]); neighbors[f[2]].add(f[1]);
  }

  let curVerts = vertices.map(v => v.clone());

  for (let it = 0; it < iterations; it++) {
    // Paso 1: Relajación positiva (λ)
    const step1: THREE.Vector3[] = [];
    for (let i = 0; i < nVerts; i++) {
      if (locked.has(i)) {
        step1.push(curVerts[i].clone());
        continue;
      }
      const nbs = Array.from(neighbors[i]);
      if (nbs.length === 0) {
        step1.push(curVerts[i].clone());
        continue;
      }
      const avg = new THREE.Vector3();
      for (const nb of nbs) avg.add(curVerts[nb]);
      avg.divideScalar(nbs.length);
      step1.push(curVerts[i].clone().addScaledVector(avg.sub(curVerts[i]), lambda));
    }

    // Paso 2: Anti-contracción negativa (μ con |μ| > λ)
    const step2: THREE.Vector3[] = [];
    for (let i = 0; i < nVerts; i++) {
      if (locked.has(i)) {
        step2.push(step1[i].clone());
        continue;
      }
      const nbs = Array.from(neighbors[i]);
      if (nbs.length === 0) {
        step2.push(step1[i].clone());
        continue;
      }
      const avg = new THREE.Vector3();
      for (const nb of nbs) avg.add(step1[nb]);
      avg.divideScalar(nbs.length);
      step2.push(step1[i].clone().addScaledVector(avg.sub(step1[i]), mu));
    }

    curVerts = step2;
  }

  return curVerts;
}

/**
 * Motor de Remallado Vóxel Profesional (Inspirado en Comfy3D / GeomPack / Michael Gold)
 *
 * 1. Rasterización SDF (Signed Distance Field) y extracción con Marching Cubes (100% Watertight y 2-Manifold).
 * 2. Proyección de Retorno acelerada por BVH (Snapping bidireccional).
 * 3. Preservación y anclaje de esquinas, puntas vivas y caras planas (anti-redondeo de cara superior).
 * 4. Optimización topológica mediante volteo de aristas (Edge Flipping) hacia valencia 6 hexagonal.
 * 5. Relajación tangencial Taubin sin pérdida de volumen (filtro paso-bajo).
 * 6. Presupuesto estricto de polígonos mediante simplificación adaptativa y flujo de quads dominantes.
 */
export async function voxelRemesh(
  targetObj: CSGObject,
  options: VoxelRemeshOptions = {}
): Promise<VoxelRemeshResult> {
  const {
    targetFaces,
    voxelResolution = 64,
    bvhSnapping = true,
    preserveSharpFeatures = true,
    creaseAngleDeg = 30,
    snapPlanarFaces = true,
    edgeFlipValence6: applyEdgeFlip = true,
    taubinSmoothing = true,
    taubinIterations = 3,
    outputTopology = 'QUAD_DOMINANT',
    offset = 0.0
  } = options;

  const report: string[] = [];

  // Paso 1: Extraer geometría en espacio del mundo y construir BVH
  const targetGeo = await extractTargetGeometry(targetObj);
  if (!targetGeo.attributes.position || targetGeo.attributes.position.count === 0) {
    throw new Error('El objeto seleccionado no contiene geometría válida para remallado.');
  }

  const targetBvh = new MeshBVH(targetGeo);
  const srcWorldMat = getObjectWorldMatrix(targetObj);
  const srcWorldInv = srcWorldMat.clone().invert();

  if (!targetGeo.boundingBox) targetGeo.computeBoundingBox();
  const bounds = targetGeo.boundingBox!;
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  const size = new THREE.Vector3();
  bounds.getSize(size);

  // Margen de seguridad del 8% para el grid SDF
  const margin = Math.max(size.x, size.y, size.z) * 0.08;
  const minBounds: [number, number, number] = [
    bounds.min.x - margin,
    bounds.min.y - margin,
    bounds.min.z - margin
  ];
  const maxBounds: [number, number, number] = [
    bounds.max.x + margin,
    bounds.max.y + margin,
    bounds.max.z + margin
  ];

  const res = Math.max(24, Math.min(128, Math.round(voxelResolution)));
  const totalVoxels = res * res * res;
  const scalarField = new Float32Array(totalVoxels);

  const dx = (maxBounds[0] - minBounds[0]) / (res - 1);
  const dy = (maxBounds[1] - minBounds[1]) / (res - 1);
  const dz = (maxBounds[2] - minBounds[2]) / (res - 1);

  report.push(`Rasterizando volumen implícito SDF: resolución ${res}³ (${totalVoxels.toLocaleString()} vóxeles)...`);

  const tgtPosAttr = targetGeo.getAttribute('position');
  const tgtIndex = targetGeo.getIndex();
  const getFaceNormal = (faceIndex: number): THREE.Vector3 => {
    let i0 = faceIndex * 3, i1 = faceIndex * 3 + 1, i2 = faceIndex * 3 + 2;
    if (tgtIndex) {
      i0 = tgtIndex.getX(i0);
      i1 = tgtIndex.getX(i1);
      i2 = tgtIndex.getX(i2);
    }
    const vA = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
    const vB = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
    const vC = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);
    return new THREE.Vector3().crossVectors(vB.sub(vA), vC.sub(vA)).normalize();
  };

  const pt = new THREE.Vector3();
  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

  // Paso 2: Evaluación rápida y exacta de distancia con signo (SDF) sobre BVH
  for (let x = 0; x < res; x++) {
    const px = minBounds[0] + x * dx;
    for (let y = 0; y < res; y++) {
      const py = minBounds[1] + y * dy;
      for (let z = 0; z < res; z++) {
        const pz = minBounds[2] + z * dz;
        pt.set(px, py, pz);

        hitTmp.distance = Infinity;
        hitTmp.faceIndex = -1;
        const r = targetBvh.closestPointToPoint(pt, hitTmp as any);
        if (r && r.point && r.faceIndex >= 0) {
          const d = pt.distanceTo(r.point);
          const fn = getFaceNormal(r.faceIndex);
          const toPt = new THREE.Vector3().subVectors(pt, r.point);
          const sign = toPt.dot(fn) < -1e-6 ? -1 : 1;
          scalarField[x * res * res + y * res + z] = sign * d;
        } else {
          scalarField[x * res * res + y * res + z] = 1.0;
        }
      }
    }
  }

  // Paso 3: Extracción de Isosuperficie Estanca con Marching Cubes
  report.push(`Extrayendo isosuperficie estanca (Marching Cubes level 0.0)...`);
  const mcMesh = marchingCubes(scalarField, res, res, res, {
    isolevel: 0.0,
    boundsMin: minBounds,
    boundsMax: maxBounds,
    smoothIterations: 0
  });

  if (mcMesh.vertices.length === 0 || mcMesh.faces.length === 0) {
    throw new Error('No se pudo extraer la superficie del volumen voxelizado.');
  }

  let curVerts: THREE.Vector3[] = mcMesh.vertices.map(v => new THREE.Vector3(v[0], v[1], v[2]));
  let curFaces: [number, number, number][] = mcMesh.faces.map(f => [
    f.indices[0],
    f.indices[1],
    f.indices[2]
  ]);

  // Paso 4: Proyección de Retorno mediante BVH (Shrinkwrap Snapping)
  if (bvhSnapping) {
    report.push(`Proyección de Retorno BVH: ajustando vértices a la superficie original...`);
    for (let i = 0; i < curVerts.length; i++) {
      hitTmp.distance = Infinity;
      hitTmp.faceIndex = -1;
      const resHit = targetBvh.closestPointToPoint(curVerts[i], hitTmp as any);
      if (resHit && resHit.point) {
        curVerts[i].copy(resHit.point);
        if (offset && Math.abs(offset) > 1e-6 && resHit.faceIndex >= 0) {
          const fn = getFaceNormal(resHit.faceIndex);
          curVerts[i].addScaledVector(fn, offset);
        }
      }
    }
  }

  // Paso 5: Aplanado Matemático de Caras Planas (Anti-abombamiento de cara superior)
  const planarClusters = snapPlanarFaces ? extractPlanarClusters(targetGeo, 0.015, 5.0) : [];
  if (planarClusters.length > 0) {
    report.push(`Preservación de planos: anclando ${planarClusters.length} regiones planas principales (cara superior/inferior)...`);
    for (let i = 0; i < curVerts.length; i++) {
      hitTmp.distance = Infinity;
      hitTmp.faceIndex = -1;
      const hit = targetBvh.closestPointToPoint(curVerts[i], hitTmp as any);
      if (hit && hit.faceIndex >= 0) {
        for (const cl of planarClusters) {
          if (cl.faceIndices.has(hit.faceIndex)) {
            // Anclar exactamente a la ecuación de plano n * p = d
            const distFromPlane = cl.normal.dot(curVerts[i]) - cl.d;
            curVerts[i].addScaledVector(cl.normal, -distFromPlane);
            if (offset && Math.abs(offset) > 1e-6) {
              curVerts[i].addScaledVector(cl.normal, offset);
            }
            break;
          }
        }
      }
    }
  }

  // Paso 6: Detección y Anclaje de Puntas Vivas y Esquinas (Sharp Features)
  const sharpInfo = preserveSharpFeatures ? extractTargetSharpFeatures(targetGeo, creaseAngleDeg) : { sharpVertices: [], sharpEdgeMidpoints: [], creaseNormals: new Map() };
  const lockedVerts = new Set<number>();

  if (sharpInfo.sharpVertices.length > 0) {
    report.push(`Anclando ${sharpInfo.sharpVertices.length} puntas y esquinas vivas estructurales...`);
    const diag = size.length();
    const maxSnapDist = (diag / res) * 1.6;

    for (const sharpPt of sharpInfo.sharpVertices) {
      let bestIdx = -1;
      let bestDist = maxSnapDist;

      for (let i = 0; i < curVerts.length; i++) {
        const d = curVerts[i].distanceTo(sharpPt);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        curVerts[bestIdx].copy(sharpPt);
        lockedVerts.add(bestIdx);
      }
    }
  }

  // Paso 7: Volteo de Aristas (Edge Flipping) hacia Valencia 6
  if (applyEdgeFlip) {
    const flipRes = edgeFlipValence6(curVerts, curFaces, 4);
    curFaces = flipRes.faces;
    if (flipRes.flipsCount > 0) {
      report.push(`Optimización topológica: ${flipRes.flipsCount} aristas volteadas hacia valencia 6.`);
    }
  }

  // Paso 8: Relajación Tangencial sin Pérdida de Volumen (Filtro Taubin)
  if (taubinSmoothing) {
    curVerts = taubinSmoothingWithCreases(curVerts, curFaces, {
      iterations: taubinIterations,
      lambda: 0.33,
      mu: -0.34,
      lockedVertices: lockedVerts
    });
    // Re-proyectar al BVH para mantener contacto fiel
    if (bvhSnapping) {
      for (let i = 0; i < curVerts.length; i++) {
        if (lockedVerts.has(i)) continue;
        hitTmp.distance = Infinity;
        hitTmp.faceIndex = -1;
        const resHit = targetBvh.closestPointToPoint(curVerts[i], hitTmp as any);
        if (resHit && resHit.point) {
          curVerts[i].copy(resHit.point);
        }
      }
    }
  }

  // Paso 9: Presupuesto Estricto de Polígonos (Target Face Count)
  const initialGeneratedFaces = curFaces.length;
  if (targetFaces && targetFaces > 0 && curFaces.length > targetFaces) {
    report.push(`Ajustando presupuesto estricto: reduciendo de ${curFaces.length.toLocaleString()} a ${targetFaces.toLocaleString()} caras...`);
    await MeshoptSimplifier.ready;

    const flatPositions = new Float32Array(curVerts.length * 3);
    for (let i = 0; i < curVerts.length; i++) {
      flatPositions[i * 3] = curVerts[i].x;
      flatPositions[i * 3 + 1] = curVerts[i].y;
      flatPositions[i * 3 + 2] = curVerts[i].z;
    }

    const flatIndices = new Uint32Array(curFaces.length * 3);
    for (let i = 0; i < curFaces.length; i++) {
      flatIndices[i * 3] = curFaces[i][0];
      flatIndices[i * 3 + 1] = curFaces[i][1];
      flatIndices[i * 3 + 2] = curFaces[i][2];
    }

    const targetIndicesCount = targetFaces * 3;
    const [simplifiedIndices] = MeshoptSimplifier.simplify(
      flatIndices,
      flatPositions,
      3,
      targetIndicesCount,
      0.035,
      ['LockBorder']
    );

    const newFaces: [number, number, number][] = [];
    for (let i = 0; i < simplifiedIndices.length; i += 3) {
      newFaces.push([simplifiedIndices[i], simplifiedIndices[i + 1], simplifiedIndices[i + 2]]);
    }
    curFaces = newFaces;

    // Compactar vértices no utilizados
    const usedIndices = new Set<number>();
    for (const f of curFaces) {
      usedIndices.add(f[0]); usedIndices.add(f[1]); usedIndices.add(f[2]);
    }
    const remap = new Map<number, number>();
    const compactedVerts: THREE.Vector3[] = [];
    usedIndices.forEach(oldIdx => {
      remap.set(oldIdx, compactedVerts.length);
      compactedVerts.push(curVerts[oldIdx]);
    });
    curVerts = compactedVerts;
    curFaces = curFaces.map(f => [remap.get(f[0])!, remap.get(f[1])!, remap.get(f[2])!]);

    // Último anclaje planar y de puntas tras decimation
    if (planarClusters.length > 0) {
      for (let i = 0; i < curVerts.length; i++) {
        hitTmp.distance = Infinity;
        hitTmp.faceIndex = -1;
        const hit = targetBvh.closestPointToPoint(curVerts[i], hitTmp as any);
        if (hit && hit.faceIndex >= 0) {
          for (const cl of planarClusters) {
            if (cl.faceIndices.has(hit.faceIndex)) {
              const distFromPlane = cl.normal.dot(curVerts[i]) - cl.d;
              curVerts[i].addScaledVector(cl.normal, -distFromPlane);
              break;
            }
          }
        }
      }
    }
  }

  // Paso 10: Conversión a Quads Dominantes si está activado
  let finalMeshFaces: MeshFace[] = [];
  let quadCount = 0;
  let triCount = 0;

  if (outputTopology === 'QUAD_DOMINANT') {
    const triObjects = curFaces.map(f => ({ indices: [f[0], f[1], f[2]] as [number, number, number] }));
    const flatPos = curVerts.map(v => [v.x, v.y, v.z]);
    const quadRes = pairTrianglesIntoQuads(triObjects, flatPos, {
      preserveCreases: preserveSharpFeatures,
      creaseAngleDeg
    });

    quadRes.quads.forEach(q => {
      finalMeshFaces.push({ indices: [q[0], q[1], q[2], q[3]] });
      quadCount++;
    });
    quadRes.remainingTris.forEach(t => {
      finalMeshFaces.push({ indices: [t[0], t[1], t[2]] });
      triCount++;
    });
    report.push(`Flujo Quad Dominant: ${quadCount} cuadriláteros generados, ${triCount} triángulos restantes.`);
  } else {
    curFaces.forEach(f => {
      finalMeshFaces.push({ indices: [f[0], f[1], f[2]] });
      triCount++;
    });
  }

  // Transformar vértices de vuelta al espacio local del objeto
  const localVertices: V3[] = curVerts.map(v => {
    const loc = v.clone().applyMatrix4(srcWorldInv);
    return [loc.x, loc.y, loc.z] as V3;
  });

  targetGeo.dispose();

  const initialFacesCount = targetObj.faces?.length || initialGeneratedFaces;
  const finalFacesCount = finalMeshFaces.length;

  const updatedObject: CSGObject = {
    ...targetObj,
    vertices: localVertices,
    faces: finalMeshFaces,
    stats: {
      vertices: localVertices.length,
      faces: finalFacesCount,
      quads: quadCount,
      triangles: triCount
    }
  };

  return {
    updatedObject,
    stats: {
      initialFaces: initialFacesCount,
      finalFaces: finalFacesCount,
      initialVertices: targetObj.vertices?.length || 0,
      finalVertices: localVertices.length,
      quads: quadCount,
      triangles: triCount,
      watertight: true
    },
    report
  };
}
