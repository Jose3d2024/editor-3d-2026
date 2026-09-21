/**
 * modifiers.ts — Mesh modification utilities
 *
 * All operations work on the CSGObject data model (vertices: V3[], faces: MeshFace[])
 * and return a new { vertices, faces } pair without mutating the input.
 */

import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { CSGObject, MeshFace, V3, CSGOperation } from '../types';
import { generatePrimitive } from './geometry';
import { createBaseGeometry } from './csg';
import { repairMesh, fillHoles, capSelectedFaces, dissolveCoplanarFaces } from './meshUtils';
import {
  bevelMeshAdvanced,
  type BevelConfig,
  type BevelAffect,
  type BevelWidthType,
  type BevelMiter,
  type BevelLimitMethod,
  type BevelProfilePreset
} from './bevel';
export {
  bevelMeshAdvanced,
  type BevelConfig,
  type BevelAffect,
  type BevelWidthType,
  type BevelMiter,
  type BevelLimitMethod,
  type BevelProfilePreset
};
import {
  smartUVProject,
  cubeUVProject,
  cylinderSphereUVProject,
  lightmapPack,
  projectFromViewUV
} from './uvUnwrap';

// 2. Registrar las funciones aceleradoras en el motor
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

// ─── helpers ─────────────────────────────────────────────────────────────────

function vecAdd(a: V3, b: V3): V3      { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vecScale(v: V3, s: number): V3 { return [v[0]*s, v[1]*s, v[2]*s]; }
function vecDist(a: V3, b: V3): number  {
  const dx=a[0]-b[0], dy=a[1]-b[1], dz=a[2]-b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/** Build adjacency list: vertex → list of connected vertex indices (through face edges) */
function buildAdjacency(verts: V3[], faces: MeshFace[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < verts.length; i++) adj.set(i, new Set());
  for (const face of faces) {
    const n = face.indices.length;
    for (let i = 0; i < n; i++) {
      const a = face.indices[i], b = face.indices[(i + 1) % n];
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }
  return adj;
}

/** Convert CSGObject vertices+faces to an indexed Three.js BufferGeometry with UV support */
function toThreeGeometry(obj: { vertices: V3[]; faces: MeshFace[] }): THREE.BufferGeometry {
  const hasUVs = obj.faces.some(f => f.uvs && f.uvs.length > 0);
  const indices: number[] = [];
  const finalPositions: number[] = [];
  const finalUvs: number[] = [];
  const vertMap = new Map<string, number>();

  if (hasUVs) {
    obj.faces.forEach(face => {
      if (!face || !face.indices || face.indices.length < 3) return;
      const faceIndices: number[] = [];
      face.indices.forEach((posIdx, i) => {
        const uv = face.uvs?.[i] || [0, 0];
        const key = `${posIdx}_${uv[0].toFixed(4)}_${uv[1].toFixed(4)}`;
        if (vertMap.has(key)) {
          faceIndices.push(vertMap.get(key)!);
        } else {
          const newIdx = finalPositions.length / 3;
          const v = obj.vertices[posIdx] || [0, 0, 0];
          finalPositions.push(v[0], v[1], v[2]);
          finalUvs.push(uv[0], uv[1]);
          vertMap.set(key, newIdx);
          faceIndices.push(newIdx);
        }
      });
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    });
  } else {
    const positions: number[] = [];
    for (const v of obj.vertices) {
      if (v) positions.push(v[0], v[1], v[2]);
    }
    obj.faces.forEach(face => {
      if (!face || !face.indices || face.indices.length < 3) return;
      for (let i = 1; i < face.indices.length - 1; i++) {
        indices.push(face.indices[0], face.indices[i], face.indices[i + 1]);
      }
    });
    finalPositions.push(...positions);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
  if (hasUVs) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(finalUvs, 2));
  }
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Convert a Three.js BufferGeometry back to {vertices, faces} (triangles) with UV support */
export function fromThreeGeometry(geo: THREE.BufferGeometry): { vertices: V3[]; faces: MeshFace[] } {
  if (!geo.getAttribute('position')) {
    return { vertices: [], faces: [] };
  }

  // Make sure it's indexed
  if (!geo.index) {
    geo = BufferGeometryUtils.mergeVertices(geo, 1e-6);
  }
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const vertices: V3[] = [];
  for (let i = 0; i < pos.count; i++) vertices.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);

  const faces: MeshFace[] = [];
  if (geo.index) {
    for (let i = 0; i < geo.index.count; i += 3) {
      const i1 = geo.index.getX(i);
      const i2 = geo.index.getX(i + 1);
      const i3 = geo.index.getX(i + 2);
      const face: MeshFace = { indices: [i1, i2, i3] };
      if (uv) {
        face.uvs = [
          [uv.getX(i1), uv.getY(i1)],
          [uv.getX(i2), uv.getY(i2)],
          [uv.getX(i3), uv.getY(i3)]
        ];
      }
      faces.push(face);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const face: MeshFace = { indices: [i, i + 1, i + 2] };
      if (uv) {
        face.uvs = [
          [uv.getX(i), uv.getY(i)],
          [uv.getX(i + 1), uv.getY(i + 1)],
          [uv.getX(i + 2), uv.getY(i + 2)]
        ];
      }
      faces.push(face);
    }
  }
  return { vertices, faces };
}

// ─── Smooth ───────────────────────────────────────────────────────────────────

/**
 * Fast spatial clustering using Disjoint Set Union (DSU) to group coincident vertices.
 * Ensures un-welded or duplicated face boundary vertices remain topologically locked together.
 */
function getCoincidentClusters(
  vertices: V3[],
  tol: number = 0.0005,
): { vertToCluster: number[]; clusters: number[][] } {
  const n = vertices.length;
  if (n === 0) return { vertToCluster: [], clusters: [] };

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const effectiveTol = Math.max(tol, 0.0001);
  const cellSize = effectiveTol;

  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const gx = Math.floor(v[0] / cellSize);
    const gy = Math.floor(v[1] / cellSize);
    const gz = Math.floor(v[2] / cellSize);
    const key = `${gx}_${gy}_${gz}`;
    let list = grid.get(key);
    if (!list) {
      list = [];
      grid.set(key, list);
    }
    list.push(i);
  }

  const tolSq = effectiveTol * effectiveTol;

  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const gx = Math.floor(v[0] / cellSize);
    const gy = Math.floor(v[1] / cellSize);
    const gz = Math.floor(v[2] / cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${gx + dx}_${gy + dy}_${gz + dz}`;
          const candidates = grid.get(key);
          if (candidates) {
            for (const j of candidates) {
              if (j > i) {
                const vj = vertices[j];
                const d0 = v[0] - vj[0];
                const d1 = v[1] - vj[1];
                const d2 = v[2] - vj[2];
                if (d0 * d0 + d1 * d1 + d2 * d2 <= tolSq) {
                  union(i, j);
                }
              }
            }
          }
        }
      }
    }
  }

  const rootToClusterIdx = new Map<number, number>();
  const clusters: number[][] = [];
  const vertToCluster = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const r = find(i);
    let cIdx = rootToClusterIdx.get(r);
    if (cIdx === undefined) {
      cIdx = clusters.length;
      rootToClusterIdx.set(r, cIdx);
      clusters.push([]);
    }
    clusters[cIdx].push(i);
    vertToCluster[i] = cIdx;
  }

  return { vertToCluster, clusters };
}

/**
 * Cluster-Synchronized Laplacian smoothing:
 * Groups coincident/un-welded vertices so adjacent polygons remain attached without tearing.
 * @param factor  0–1: how much to move toward neighbor average
 * @param iterations  number of smoothing passes
 */
export function smoothMesh(
  obj: { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  factor: number,
  iterations: number = 1,
): { vertices: V3[]; faces: MeshFace[] } {
  if (!obj.vertices || obj.vertices.length === 0) {
    return { vertices: [], faces: obj.faces || [] };
  }

  // Bake vertex offsets if any
  const currentVerts = obj.vertices.map((v, i) => {
    const off = obj.vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
  });
  const faces = obj.faces;
  const f = Math.max(0, Math.min(1, factor));

  // Find coincident vertex clusters
  const { vertToCluster, clusters } = getCoincidentClusters(currentVerts);
  const numClusters = clusters.length;

  // Build cluster-level adjacency
  const clusterAdj = new Array<Set<number>>(numClusters);
  for (let c = 0; c < numClusters; c++) clusterAdj[c] = new Set<number>();

  for (const face of faces) {
    const n = face.indices.length;
    for (let i = 0; i < n; i++) {
      const idxA = face.indices[i];
      const idxB = face.indices[(i + 1) % n];
      const cA = vertToCluster[idxA];
      const cB = vertToCluster[idxB];
      if (cA !== undefined && cB !== undefined && cA !== cB) {
        clusterAdj[cA].add(cB);
        clusterAdj[cB].add(cA);
      }
    }
  }

  // Initial average position of each cluster
  const clusterPos: V3[] = new Array(numClusters);
  for (let c = 0; c < numClusters; c++) {
    const vertIndices = clusters[c];
    let sx = 0, sy = 0, sz = 0;
    for (const idx of vertIndices) {
      const v = currentVerts[idx];
      sx += v[0]; sy += v[1]; sz += v[2];
    }
    const len = vertIndices.length;
    clusterPos[c] = [sx / len, sy / len, sz / len];
  }

  for (let iter = 0; iter < iterations; iter++) {
    const nextClusterPos: V3[] = new Array(numClusters);

    for (let c = 0; c < numClusters; c++) {
      const neighbors = Array.from(clusterAdj[c]);
      if (neighbors.length === 0) {
        nextClusterPos[c] = [...clusterPos[c]];
      } else {
        let avgX = 0, avgY = 0, avgZ = 0;
        for (const nIdx of neighbors) {
          const np = clusterPos[nIdx];
          avgX += np[0]; avgY += np[1]; avgZ += np[2];
        }
        const nLen = neighbors.length;
        avgX /= nLen; avgY /= nLen; avgZ /= nLen;

        const cp = clusterPos[c];
        nextClusterPos[c] = [
          cp[0] + (avgX - cp[0]) * f,
          cp[1] + (avgY - cp[1]) * f,
          cp[2] + (avgZ - cp[2]) * f,
        ];
      }
    }

    for (let c = 0; c < numClusters; c++) {
      clusterPos[c] = nextClusterPos[c];
    }
  }

  // Assign updated cluster positions back to all vertices
  const nextVertices: V3[] = new Array(currentVerts.length);
  for (let c = 0; c < numClusters; c++) {
    const pos = clusterPos[c];
    for (const idx of clusters[c]) {
      nextVertices[idx] = [...pos];
    }
  }

  return { vertices: nextVertices, faces };
}

// ─── Subdivide ─────────────────────────────────────────────────────────────────

/**
 * Simple subdivision: splits each face into smaller faces by adding a vertex at the center
 * and at the midpoint of each edge.
 *
 * ⚠️ BUG FIX NOTE — vertex selection after subdivision:
 *   After calling this function, the store MUST reset `vertexOffsets: {}` on the
 *   updated object. If the Viewport renders vertex handles by iterating the keys of
 *   `vertexOffsets` instead of the full `vertices` array, only the original vertices
 *   will appear selectable. Resetting vertexOffsets forces a full rebuild.
 *   In Toolbar.tsx the subdivision button already handles this:
 *     subdivideFaces(id, faces);
 *     updateObject(id, { vertexOffsets: {} });
 */
export function subdivideMesh(
  obj: { vertices: V3[]; faces: MeshFace[] },
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = obj.vertices.map(v => [...v] as V3);
  const faces = obj.faces;
  
  const edgeMidpoints = new Map<string, number>();
  const getEdgeKey = (v1: number, v2: number) => Math.min(v1, v2) + '_' + Math.max(v1, v2);
  
  const newFaces: MeshFace[] = [];
  
  faces.forEach(face => {
    const n = face.indices.length;
    if (n < 3) return;
    
    let cx = 0, cy = 0, cz = 0;
    face.indices.forEach(vIdx => {
      const base = vertices[vIdx];
      cx += base[0]; cy += base[1]; cz += base[2];
    });
    cx /= n; cy /= n; cz /= n;
    
    const centerIdx = vertices.length;
    vertices.push([cx, cy, cz]);
    
    const midIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      const v1 = face.indices[i];
      const v2 = face.indices[(i + 1) % n];
      const edgeKey = getEdgeKey(v1, v2);
      
      if (edgeMidpoints.has(edgeKey)) {
        midIndices.push(edgeMidpoints.get(edgeKey)!);
      } else {
        const b1 = vertices[v1];
        const b2 = vertices[v2];
        const mx = (b1[0] + b2[0]) / 2;
        const my = (b1[1] + b2[1]) / 2;
        const mz = (b1[2] + b2[2]) / 2;
        
        const midIdx = vertices.length;
        vertices.push([mx, my, mz]);
        edgeMidpoints.set(edgeKey, midIdx);
        midIndices.push(midIdx);
      }
    }
    
    for (let i = 0; i < n; i++) {
      const v1 = face.indices[i];
      const m1 = midIndices[i];
      const mPrev = midIndices[(i - 1 + n) % n];
      newFaces.push({ indices: [v1, m1, centerIdx, mPrev] });
    }
  });

  // NO smoothing — preserve vertex positions exactly.
  // Use 'Suavizar malla' separately if you want smoothing.
  return { vertices, faces: newFaces };
}

// ─── Optimize (decimate) ──────────────────────────────────────────────────────

export type DecimateMode = 'COLLAPSE' | 'UNSUBDIVIDE' | 'PLANAR';

export interface DecimateOptions {
  mode: DecimateMode;
  ratio?: number;            // For COLLAPSE (0.01 to 0.99, default 0.5)
  iterations?: number;       // For UNSUBDIVIDE (1 to 4, default 1)
  angleLimitDeg?: number;    // For PLANAR (1 to 45 deg, default 15)
}

/**
 * Revierte niveles de subdivisión previos (ideal para mallas procedentes de Subsurf)
 * reduciendo la densidad según potencias de subdivisión sin distorsionar la geometría.
 */
export function unsubdivideMesh(
  obj: CSGObject,
  iterations: number = 1
): { vertices: V3[]; faces: MeshFace[] } {
  const safeIters = Math.max(1, Math.min(4, Math.floor(iterations)));
  const targetRatio = Math.max(0.04, 1.0 / Math.pow(4, safeIters));
  return optimizeMesh(obj, targetRatio);
}

/**
 * Modificador Decimate (Decimar) idéntico a Blender con sus tres modos canónicos:
 * 1. Collapse: reduce por porcentaje/ratio conservando silueta y curvatura.
 * 2. Unsubdivide: revierte subdivisiones previas conservando la regularidad.
 * 3. Planar: disuelve aristas y vértices en superficies planas según un ángulo límite.
 */
export function decimateMesh(
  obj: CSGObject,
  options: DecimateOptions
): { vertices: V3[]; faces: MeshFace[] } {
  if (options.mode === 'UNSUBDIVIDE') {
    return unsubdivideMesh(obj, options.iterations ?? 1);
  } else if (options.mode === 'PLANAR') {
    const angle = options.angleLimitDeg ?? 15.0;
    const res = dissolveCoplanarFaces(obj, angle);
    return { vertices: res.vertices, faces: res.faces };
  } else {
    // COLLAPSE
    const ratio = Math.max(0.01, Math.min(0.99, options.ratio ?? 0.5));
    return optimizeMesh(obj, ratio);
  }
}

/**
 * Mesh optimization using SimplifyModifier (Quadric Error Metric edge collapse)
 * with pre-welding of duplicate vertices to protect topology and prevent getting stuck.
 * @param ratio Target proportion of original faces to retain (0.1 = keep 10%)
 */
export function optimizeMesh(
  obj: CSGObject,
  ratio: number,
): { vertices: V3[]; faces: MeshFace[] } {
  if (!obj.vertices || obj.vertices.length === 0) return { vertices: [], faces: [] };

  try {
    // 1. Convert to indexed Three.js geometry
    let geometry = toThreeGeometry(obj);

    // 2. Pre-weld vertices to connect seams and unblock topology
    geometry = BufferGeometryUtils.mergeVertices(geometry, 1e-4);

    const totalOriginalFaces = geometry.index ? geometry.index.count / 3 : 0;
    if (totalOriginalFaces < 10) return { vertices: obj.vertices, faces: obj.faces };

    // 3. Calculate target face count and amount to remove
    const targetCount = Math.max(4, Math.floor(totalOriginalFaces * Math.max(0.01, Math.min(0.99, ratio))));
    const amountToRemove = totalOriginalFaces - targetCount;

    if (amountToRemove <= 0) return { vertices: obj.vertices, faces: obj.faces };

    // 4. Advanced edge collapse simplification
    const modifier = new SimplifyModifier();
    const optimizedGeo = modifier.modify(geometry, amountToRemove);

    if (optimizedGeo.hasAttribute('normal')) {
      optimizedGeo.deleteAttribute('normal');
    }
    optimizedGeo.computeVertexNormals();

    return fromThreeGeometry(optimizedGeo);
  } catch (e) {
    console.error('El optimizador avanzado SimplifyModifier falló, usando fallback adaptativo:', e);
    return optimizeMeshFallback(obj, ratio);
  }
}

function optimizeMeshFallback(
  obj: CSGObject,
  ratio: number,
): { vertices: V3[]; faces: MeshFace[] } {
  if (!obj.vertices || obj.vertices.length === 0) return { vertices: [], faces: [] };

  let minX=Infinity, minY=Infinity, minZ=Infinity, maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  for (const [x,y,z] of obj.vertices) {
    if (x<minX) minX=x; if (y<minY) minY=y; if (z<minZ) minZ=z;
    if (x>maxX) maxX=x; if (y>maxY) maxY=y; if (z>maxZ) maxZ=z;
  }
  const diag = Math.sqrt((maxX-minX)**2+(maxY-minY)**2+(maxZ-minZ)**2);
  const threshold = Math.max(0.0001, diag * ratio * 0.08);

  const remap: number[] = new Array(obj.vertices.length).fill(-1);
  const newVerts: V3[] = [];

  for (let i = 0; i < obj.vertices.length; i++) {
    if (remap[i] !== -1) continue;
    remap[i] = newVerts.length;
    newVerts.push([...obj.vertices[i]] as V3);
    for (let j = i + 1; j < obj.vertices.length; j++) {
      if (remap[j] !== -1) continue;
      if (vecDist(obj.vertices[i], obj.vertices[j]) <= threshold) {
        remap[j] = remap[i];
      }
    }
  }

  const newFaces: MeshFace[] = [];
  for (const face of obj.faces) {
    const remapped = face.indices.map(i => remap[i]);
    const unique = [...new Set(remapped)];
    if (unique.length < 3) continue;
    newFaces.push({ ...face, indices: remapped });
  }

  const used = new Set<number>();
  for (const f of newFaces) for (const i of f.indices) used.add(i);
  const compact: number[] = new Array(newVerts.length).fill(-1);
  const finalVerts: V3[] = [];
  const sortedUsed = [...used].sort((a,b)=>a-b);
  for (const i of sortedUsed) {
    compact[i] = finalVerts.length;
    finalVerts.push(newVerts[i]);
  }
  const finalFaces = newFaces.map(f => ({
    ...f,
    indices: f.indices.map(i => compact[i])
  }));

  return { vertices: finalVerts, faces: finalFaces };
}

// Point-to-triangle distance squared in 3D (Real-Time Collision Detection algorithm)
function distSqToTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const x = apx - v * abx, y = apy - v * aby, z = apz - v * abz;
    return x * x + y * y + z * z;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const x = apx - w * acx, y = apy - w * acy, z = apz - w * acz;
    return x * x + y * y + z * z;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const x = bpx - w * (cx - bx), y = bpy - w * (cy - by), z = bpz - w * (cz - bz);
    return x * x + y * y + z * z;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const x = apx - v * abx - w * acx;
  const y = apy - v * aby - w * acy;
  const z = apz - v * abz - w * acz;
  return x * x + y * y + z * z;
}

/**
 * Transfiere pesos de animación y coordenadas UV a la velocidad máxima admitida por la CPU.
 * Utiliza fraccionamiento de tareas (Time-Slicing) para mantener el editor a 60 FPS.
 */
export async function optimizarYTransferirDatos(
  meshOriginal: THREE.SkinnedMesh | THREE.Mesh,
  meshSkinNueva: THREE.Mesh,
  onProgreso?: (porcentaje: number) => void
): Promise<THREE.SkinnedMesh | THREE.Mesh> {
  const geomOriginal = meshOriginal.geometry;
  const geomSkin = meshSkinNueva.geometry;

  // Generar la aceleración espacial indexada por BVH
  if (geomOriginal.computeBoundsTree) {
    geomOriginal.computeBoundsTree();
  } else {
    computeBoundsTree.call(geomOriginal);
  }

  const posOriginal = geomOriginal.attributes.position;
  const indexOriginal = geomOriginal.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const weightOriginal = geomOriginal.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const uvOriginal = geomOriginal.attributes.uv as THREE.BufferAttribute | undefined;

  const posSkin = geomSkin.attributes.position;

  // Inicializar contenedores de datos tipados
  const nuevosSkinIndices = indexOriginal ? new Float32Array(posSkin.count * 4) : null;
  const nuevosSkinWeights = weightOriginal ? new Float32Array(posSkin.count * 4) : null;
  const nuevasUVs = uvOriginal ? new Float32Array(posSkin.count * 2) : null;

  const raycaster = new THREE.Raycaster();
  (raycaster as any).firstHitOnly = true; // Configuración crítica de rendimiento para el árbol BVH

  const puntoSkin = new THREE.Vector3();
  const direccion = new THREE.Vector3();

  // Calcular el centro geométrico para proyectar de afuera hacia adentro
  const boundingBox = new THREE.Box3().setFromObject(meshOriginal);
  const centroObjeto = new THREE.Vector3();
  boundingBox.getCenter(centroObjeto);

  // Rendimiento: Fragmentación del bucle pesado para proteger los FPS de tu UI
  const tamanoBloque = 400;
  let iteracionesUltimoFrame = 0;

  for (let i = 0; i < posSkin.count; i++) {
    // Si alcanzamos el límite del bloque, cedemos el control al navegador para refrescar la pantalla
    if (iteracionesUltimoFrame >= tamanoBloque) {
      iteracionesUltimoFrame = 0;
      if (onProgreso) onProgreso(Math.round((i / posSkin.count) * 100));
      await new Promise((resolve) => {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => resolve(null));
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
    iteracionesUltimoFrame++;

    puntoSkin.fromBufferAttribute(posSkin, i);

    // Calcular dirección del rayo hacia el núcleo del modelo
    direccion.copy(puntoSkin).sub(centroObjeto).negate().normalize();
    raycaster.set(puntoSkin, direccion);

    // Búsqueda instantánea en el árbol BVH
    const colisiones = raycaster.intersectObject(meshOriginal);

    if (colisiones.length > 0) {
      const golpe = colisiones[0];

      // A. Mapeo de Texturas (UV) instantáneo interpolado
      if (golpe.uv && nuevasUVs) {
        nuevasUVs[i * 2 + 0] = golpe.uv.x;
        nuevasUVs[i * 2 + 1] = golpe.uv.y;
      }

      // B. Mapeo de Animación (Huesos) localizado al triángulo impactado
      const cara = golpe.face;
      if (cara && indexOriginal && weightOriginal && nuevosSkinIndices && nuevosSkinWeights) {
        const indicesTriangulo = [cara.a, cara.b, cara.c];

        let distMin = Infinity;
        let idxVerticeMasCercano = indicesTriangulo[0];
        const vTemp = new THREE.Vector3();

        // Buscamos cuál de los 3 vértices de esa cara específica está más cerca de nuestra piel
        for (const idx of indicesTriangulo) {
          vTemp.fromBufferAttribute(posOriginal, idx);
          const dist = puntoSkin.distanceToSquared(vTemp);
          if (dist < distMin) {
            distMin = dist;
            idxVerticeMasCercano = idx;
          }
        }

        // Transferir los índices y pesos del esqueleto original
        for (let k = 0; k < 4; k++) {
          nuevosSkinIndices[i * 4 + k] = indexOriginal.array[idxVerticeMasCercano * 4 + k];
          nuevosSkinWeights[i * 4 + k] = weightOriginal.array[idxVerticeMasCercano * 4 + k];
        }
      }
    }
  }

  // Asignar los atributos calculados a la nueva malla de bajo poligonaje
  if (nuevosSkinIndices && nuevosSkinWeights) {
    geomSkin.setAttribute('skinIndex', new THREE.BufferAttribute(nuevosSkinIndices, 4));
    geomSkin.setAttribute('skinWeight', new THREE.BufferAttribute(nuevosSkinWeights, 4));
  }
  if (nuevasUVs) {
    geomSkin.setAttribute('uv', new THREE.BufferAttribute(nuevasUVs, 2));
  }

  let finalMesh: THREE.Mesh | THREE.SkinnedMesh;
  if ((meshOriginal as any).isSkinnedMesh && (meshOriginal as THREE.SkinnedMesh).skeleton) {
    const skinnedOriginal = meshOriginal as THREE.SkinnedMesh;
    const skinnedMeshFinal = new THREE.SkinnedMesh(geomSkin, meshOriginal.material);
    skinnedMeshFinal.bind(skinnedOriginal.skeleton, skinnedOriginal.bindMatrix);
    finalMesh = skinnedMeshFinal;
  } else {
    finalMesh = new THREE.Mesh(geomSkin, meshOriginal.material);
  }

  // Notificar fin de proceso y limpiar RAM del árbol
  if (onProgreso) onProgreso(100);
  if (geomOriginal.disposeBoundsTree) {
    geomOriginal.disposeBoundsTree();
  }

  return finalMesh;
}

export { repairMesh, fillHoles, capSelectedFaces };

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  vertexCount: number;
  faceCount: number;
  edgeCount: number;
  duplicateVertices: number;
  degenerateFaces: number;
  openEdges: number;           // Edges shared by only 1 face (non-manifold boundary)
  nonManifoldEdges: number;    // Edges shared by >2 faces
  issues: string[];
  suggestions: string[];
}

export function validateMesh(obj: CSGObject): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    vertexCount: obj.vertices.length,
    faceCount: obj.faces.length,
    edgeCount: 0,
    duplicateVertices: 0,
    degenerateFaces: 0,
    openEdges: 0,
    nonManifoldEdges: 0,
    issues: [],
    suggestions: [],
  };

  if (obj.vertices.length === 0) {
    result.isValid = false;
    result.issues.push('Sin vértices');
    return result;
  }

  // Check duplicate vertices
  const vMap = new Map<string, number>();
  for (const v of obj.vertices) {
    const k = `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
    vMap.set(k, (vMap.get(k) ?? 0) + 1);
  }
  result.duplicateVertices = [...vMap.values()].reduce((s,c) => s + (c > 1 ? c - 1 : 0), 0);
  if (result.duplicateVertices > 0) {
    result.isValid = false;
    result.issues.push(`${result.duplicateVertices} vértices duplicados`);
    result.suggestions.push('Usar "Reparar" para fusionar vértices duplicados');
  }

  // Edge manifold check
  const edgeFaceCount = new Map<string, number>();
  for (const face of obj.faces) {
    const n = face.indices.length;
    if (n < 3) { result.degenerateFaces++; continue; }
    for (let i = 0; i < n; i++) {
      const a = face.indices[i], b = face.indices[(i+1)%n];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1);
    }
  }
  result.edgeCount = edgeFaceCount.size;

  for (const [, count] of edgeFaceCount) {
    if (count === 1) result.openEdges++;
    else if (count > 2) result.nonManifoldEdges++;
  }

  if (result.degenerateFaces > 0) {
    result.isValid = false;
    result.issues.push(`${result.degenerateFaces} caras degeneradas`);
    result.suggestions.push('Usar "Reparar" para eliminar caras degeneradas');
  }
  if (result.openEdges > 0) {
    result.isValid = false;
    result.issues.push(`${result.openEdges} aristas abiertas (malla no cerrada)`);
    result.suggestions.push('La malla tiene huecos — revisar antes de imprimir en 3D');
  }
  if (result.nonManifoldEdges > 0) {
    result.isValid = false;
    result.issues.push(`${result.nonManifoldEdges} aristas no-manifold (>2 caras)`);
    result.suggestions.push('Usar "Reparar" para limpiar geometría no-manifold');
  }

  return result;
}

/**
 * Generates UV coordinates for a mesh using box projection.
 * Normalizes coordinates to [0, 1] range based on bounding box.
 */
export function generateUVs(obj: { vertices: V3[]; faces: MeshFace[] }): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = obj.vertices;
  if (!vertices || vertices.length === 0 || !obj.faces) return obj;

  // Calculate bounding box for normalization
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach(v => {
    if (!v) return;
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  });

  const size = [
    max[0] - min[0] || 1,
    max[1] - min[1] || 1,
    max[2] - min[2] || 1
  ];

  const maxSize = Math.max(size[0], size[1], size[2]) || 1;

  const faces = obj.faces.map(face => {
    if (!face || !face.indices) return face;

    const i0 = face.indices[0];
    const i1 = face.indices[1];
    const i2 = face.indices[2];
    const vert0 = i0 !== undefined ? vertices[i0] : null;
    const vert1 = i1 !== undefined ? vertices[i1] : null;
    const vert2 = i2 !== undefined ? vertices[i2] : null;

    let absX = 0, absY = 1, absZ = 0;
    if (vert0 && vert1 && vert2) {
      const v0 = new THREE.Vector3(...vert0);
      const v1 = new THREE.Vector3(...vert1);
      const v2 = new THREE.Vector3(...vert2);
      const normal = new THREE.Vector3().crossVectors(
        v1.clone().sub(v0),
        v2.clone().sub(v0)
      ).normalize();

      if (normal.lengthSq() > 1e-6) {
        absX = Math.abs(normal.x);
        absY = Math.abs(normal.y);
        absZ = Math.abs(normal.z);
      }
    }

    const uvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y, z] = v;
      
      let u = 0, uvY = 0;
      if (absY >= absX && absY >= absZ) {
        u = (x - min[0]) / maxSize;
        uvY = (z - min[2]) / maxSize;
      } else if (absX >= absY && absX >= absZ) {
        u = (z - min[2]) / maxSize;
        uvY = (y - min[1]) / maxSize;
      } else {
        u = (x - min[0]) / maxSize;
        uvY = (y - min[1]) / maxSize;
      }
      return [u, uvY] as [number, number];
    });

    return { ...face, uvs };
  });

  return { vertices, faces };
}

/**
 * Applies a specific UVW mapping projection to the mesh.
 * Supported: 'BOX', 'TRIPLANAR', 'SMART_UV', 'UV', 'SPHERICAL', 'CYLINDRICAL', 'PLANAR', 'LIGHTMAP'
 */
export function applyUVWMapping(
  obj: { vertices: V3[]; faces: MeshFace[] },
  type: string,
  options?: { angleThresholdDeg?: number; islandMargin?: number; relaxIterations?: number }
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = obj.vertices;
  if (!vertices || vertices.length === 0 || !obj.faces) return obj;

  if (type === 'SMART_UV' || type === 'UV' || type === 'SMART') {
    return smartUVProject(obj, {
      angleThresholdDeg: options?.angleThresholdDeg ?? 66,
      islandMargin: options?.islandMargin ?? 0.02,
      relaxIterations: options?.relaxIterations ?? 6
    });
  }

  if (type === 'LIGHTMAP') {
    return lightmapPack(obj, options?.islandMargin ?? 0.03);
  }

  if (type === 'SPHERICAL' || type === 'CYLINDRICAL') {
    return cylinderSphereUVProject(obj, type);
  }

  if (type === 'BOX' || type === 'TRIPLANAR') {
    return cubeUVProject(obj, 1.0);
  }

  // Calculate bounding box for normalization
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach(v => {
    if (!v) return;
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  });

  const size = [
    Math.max(1e-6, max[0] - min[0]),
    Math.max(1e-6, max[1] - min[1]),
    Math.max(1e-6, max[2] - min[2])
  ];

  const faces = obj.faces.map(face => {
    if (!face || !face.indices) return face;
    const uvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y] = v;
      const u = (x - min[0]) / size[0];
      const uvY = (y - min[1]) / size[1];
      return [u, uvY] as [number, number];
    });
    return { ...face, uvs };
  });

  return { vertices, faces };
}

// ─── Boolean (wrapper around three-csg-ts) ────────────────────────────────────

export function applyBooleanOperation(
  target: CSGObject,
  tool: CSGObject,
  operation: CSGOperation,
): { vertices: V3[]; faces: MeshFace[] } | null {
  try {
    const matA = new THREE.MeshStandardMaterial();
    const matB = new THREE.MeshStandardMaterial();

    const geoA = toThreeGeometry(target).toNonIndexed();
    const geoB = toThreeGeometry(tool).toNonIndexed();

    const meshA = new THREE.Mesh(geoA, matA);
    meshA.position.set(...target.transform.position);
    meshA.rotation.set(...target.transform.rotation);
    meshA.scale.set(...target.transform.scale);
    meshA.updateMatrixWorld(true);

    const meshB = new THREE.Mesh(geoB, matB);
    meshB.position.set(...tool.transform.position);
    meshB.rotation.set(...tool.transform.rotation);
    meshB.scale.set(...tool.transform.scale);
    meshB.updateMatrixWorld(true);

    const csgA = CSG.fromMesh(meshA);
    const csgB = CSG.fromMesh(meshB);

    let resultCSG;
    if (operation === 'ADD')           resultCSG = csgA.union(csgB);
    else if (operation === 'SUBTRACT') resultCSG = csgA.subtract(csgB);
    else                               resultCSG = csgA.intersect(csgB);

    const resultMesh = CSG.toMesh(resultCSG, new THREE.Matrix4(), matA);
    return fromThreeGeometry(resultMesh.geometry);

  } catch (e) {
    console.error('Boolean operation failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GENERATIVE TOOLS ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Polígono regular ─────────────────────────────────────────────────────────

/**
 * Genera un polígono regular plano (triángulo, hexágono, octógono, etc.)
 * en el plano XZ con la cara mirando hacia arriba (+Y).
 *
 * @param sides   Número de lados (mínimo 3)
 * @param radius  Radio exterior
 * @param height  Altura Y del polígono
 */
export function generatePolygon(
  sides: number,
  radius: number = 1,
  height: number = 0,
): { vertices: V3[]; faces: MeshFace[] } {
  sides = Math.max(3, Math.round(sides));
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];

  // Vértices del perímetro
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    vertices.push([Math.cos(angle) * radius, height, Math.sin(angle) * radius]);
  }
  // Centro
  const centerIdx = vertices.length;
  vertices.push([0, height, 0]);

  // Caras triangulares desde el centro
  for (let i = 0; i < sides; i++) {
    faces.push({ indices: [centerIdx, (i + 1) % sides, i] });
  }

  return { vertices, faces };
}

// ─── Arco / Tarta ─────────────────────────────────────────────────────────────

/**
 * Genera un arco o sector circular en el plano XZ.
 *
 * @param radius        Radio
 * @param startAngleDeg Ángulo inicial en grados
 * @param endAngleDeg   Ángulo final en grados
 * @param segments      Número de segmentos de la curva
 * @param filled        true = sector/tarta (con cara); false = sólo arco (línea)
 */
export function generateArc(
  radius: number = 1,
  startAngleDeg: number = 0,
  endAngleDeg: number = 360,
  segments: number = 32,
  filled: boolean = true,
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];

  const startRad = (startAngleDeg * Math.PI) / 180;
  const endRad   = (endAngleDeg   * Math.PI) / 180;

  // Vértices del arco
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startRad + (endRad - startRad) * t;
    vertices.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
  }

  if (filled) {
    // Centro
    const centerIdx = vertices.length;
    vertices.push([0, 0, 0]);
    for (let i = 0; i < segments; i++) {
      faces.push({ indices: [centerIdx, i, i + 1] });
    }
  }

  return { vertices, faces };
}

// ─── Torno / Lathe ────────────────────────────────────────────────────────────

/**
 * Perfiles predefinidos para el torno.
 * Cada punto es [radio, altura] donde altura 0 = base y 1 = cima (se escala).
 */
export const LATHE_PRESETS: Record<string, Array<[number, number]>> = {
  columna:  [[0.30,0],[0.32,0.05],[0.25,0.35],[0.25,0.75],[0.32,0.90],[0.30,1]],
  jarra:    [[0.05,0],[0.40,0.10],[0.45,0.45],[0.35,0.80],[0.20,0.92],[0.15,1]],
  botella:  [[0.05,0],[0.05,0.12],[0.32,0.30],[0.30,0.72],[0.18,0.88],[0.18,1]],
  copa:     [[0.05,0],[0.30,0.12],[0.40,0.32],[0.10,0.60],[0.10,0.78],[0.32,0.90],[0.30,1]],
  tazón:    [[0,0],[0.40,0.10],[0.45,0.52],[0.35,0.82],[0.30,0.90]],
  columnaD: [[0.28,0],[0.35,0.04],[0.20,0.12],[0.20,0.86],[0.35,0.94],[0.28,1]],
};

/**
 * Genera una superficie de revolución girando un perfil 2D alrededor del eje Y.
 *
 * @param profile    Array de [radio, altura] — radio >= 0, altura en [0,1] (se escala a `totalHeight`)
 * @param segments   Divisiones angulares (8 = low-poly, 24 = suave)
 * @param totalHeight Escala del eje Y
 * @param startAngle Ángulo inicial en radianes (0 = completo)
 * @param endAngle   Ángulo final en radianes (2π = completo)
 */
export function latheMesh(
  profile: Array<[number, number]>,
  segments: number = 16,
  totalHeight: number = 2,
  startAngle: number = 0,
  endAngle: number = Math.PI * 2,
): { vertices: V3[]; faces: MeshFace[] } {
  if (profile.length < 2) return { vertices: [], faces: [] };

  const vertices: V3[] = [];
  const faces: MeshFace[] = [];
  const n = profile.length;
  const fullCircle = Math.abs(endAngle - startAngle - Math.PI * 2) < 0.001;
  const ringCount  = fullCircle ? segments : segments + 1;

  // Generar anillos de vértices
  for (let s = 0; s < ringCount; s++) {
    const t     = s / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    const cos   = Math.cos(angle);
    const sin   = Math.sin(angle);
    for (const [r, h] of profile) {
      vertices.push([r * cos, h * totalHeight, r * sin]);
    }
  }

  // Generar caras cuadriláteras entre anillos
  for (let s = 0; s < segments; s++) {
    const nextS = fullCircle ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < n - 1; p++) {
      const a = s     * n + p;
      const b = s     * n + (p + 1);
      const c = nextS * n + (p + 1);
      const d = nextS * n + p;
      faces.push({ indices: [a, b, c, d] });
    }
  }

  // Tapas superior e inferior si el perfil empieza/termina en radio 0
  const topR    = profile[0][1];
  const bottomR = profile[n - 1][1];

  if (profile[0][0] < 0.001) {
    // Tapa superior: abanico desde el primer vértice de cada anillo
    for (let s = 0; s < segments; s++) {
      const nextS = fullCircle ? (s + 1) % ringCount : s + 1;
      faces.push({ indices: [s * n, nextS * n, s * n] }); // degenerate — skip
    }
  }

  return { vertices, faces };
}

// ─── Sweep (extrusión a lo largo de un camino) ────────────────────────────────

/**
 * Perfiles 2D predefinidos para Sweep.
 * Puntos [x, y] en espacio local de la sección transversal.
 */
export const SWEEP_PROFILES: Record<string, Array<[number, number]>> = {
  círculo: Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [Math.cos(a) * 0.15, Math.sin(a) * 0.15] as [number, number];
  }),
  cuadrado:  [[-0.15,-0.15],[0.15,-0.15],[0.15,0.15],[-0.15,0.15]],
  triángulo: [[0,0.20],[-0.17,-0.10],[0.17,-0.10]],
  moldura:   [[-0.10,0],[-0.15,0.05],[-0.15,0.15],[-0.10,0.20],[0.10,0.20],[0.15,0.15],[0.15,0.05],[0.10,0]],
  L:         [[-0.15,-0.15],[0.15,-0.15],[0.15,0.00],[-0.05,0.00],[-0.05,0.15],[-0.15,0.15]],
};

/**
 * Caminos predefinidos para Sweep.
 */
export function makeStraightPath(length: number = 2, segments: number = 8): V3[] {
  return Array.from({ length: segments + 1 }, (_, i) => [0, 0, (i / segments) * length] as V3);
}

export function makeArcPath(
  radius: number = 1.5,
  angleDeg: number = 180,
  segments: number = 16,
): V3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t     = i / segments;
    const angle = (angleDeg * t * Math.PI) / 180;
    return [Math.cos(angle) * radius - radius, 0, Math.sin(angle) * radius] as V3;
  });
}

export function makeHelixPath(
  radius: number = 1,
  height: number = 3,
  turns: number = 2,
  segments: number = 32,
): V3[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t     = i / segments;
    const angle = t * turns * Math.PI * 2;
    return [Math.cos(angle) * radius, t * height, Math.sin(angle) * radius] as V3;
  });
}

/**
 * Barre un perfil 2D a lo largo de un camino 3D (extrusión de trayectoria).
 * Ideal para molduras, marcos, tuberías, cadenas, barandillas.
 *
 * @param profile       Puntos 2D [x, y] de la sección transversal
 * @param path          Puntos 3D que definen el camino
 * @param closedProfile true = perfil cerrado (tubo); false = perfil abierto (moldura)
 */
export function sweepMesh(
  profile: Array<[number, number]>,
  path: V3[],
  closedProfile: boolean = true,
): { vertices: V3[]; faces: MeshFace[] } {
  if (path.length < 2 || profile.length < 2) return { vertices: [], faces: [] };

  const vertices: V3[] = [];
  const faces: MeshFace[] = [];
  const n = profile.length;

  // Genera un frame de Frenet-Serret estabilizado para cada punto del camino
  let prevRight = new THREE.Vector3(1, 0, 0);

  for (let pi = 0; pi < path.length; pi++) {
    const curr = new THREE.Vector3(...path[pi]);

    // Tangente
    let tangent: THREE.Vector3;
    if (pi === 0) {
      tangent = new THREE.Vector3(...path[1]).sub(curr).normalize();
    } else if (pi === path.length - 1) {
      tangent = curr.clone().sub(new THREE.Vector3(...path[pi - 1])).normalize();
    } else {
      tangent = new THREE.Vector3(...path[pi + 1]).sub(new THREE.Vector3(...path[pi - 1])).normalize();
    }

    // Parallel transport para evitar giro del perfil
    const right = prevRight.clone().sub(
      tangent.clone().multiplyScalar(tangent.dot(prevRight))
    ).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    prevRight = right.clone();

    for (const [px, py] of profile) {
      const v = curr.clone()
        .addScaledVector(right, px)
        .addScaledVector(up, py);
      vertices.push([v.x, v.y, v.z]);
    }
  }

  // Caras entre secciones
  for (let pi = 0; pi < path.length - 1; pi++) {
    for (let i = 0; i < n; i++) {
      const nextI = closedProfile ? (i + 1) % n : i + 1;
      if (!closedProfile && i === n - 1) continue;
      const a = pi       * n + i;
      const b = pi       * n + nextI;
      const c = (pi + 1) * n + nextI;
      const d = (pi + 1) * n + i;
      faces.push({ indices: [a, b, c, d] });
    }
  }

  return { vertices, faces };
}

// ─── Loft (solevado) ─────────────────────────────────────────────────────────

/**
 * Crea una superficie interpolando entre múltiples secciones transversales.
 * Las secciones deben tener el mismo número de vértices.
 * Permite pasar de un círculo a un cuadrado a una estrella, etc.
 *
 * @param sections      Array de secciones; cada sección es un array de V3
 * @param closedProfile true = el último vértice conecta con el primero (perfil cerrado)
 */
export function loftMesh(
  sections: V3[][],
  closedProfile: boolean = true,
): { vertices: V3[]; faces: MeshFace[] } {
  if (sections.length < 2) return { vertices: [], faces: [] };

  const n = sections[0].length;
  // Asegurar que todas las secciones tienen el mismo número de puntos
  const normalizedSections = sections.map(sec => {
    if (sec.length === n) return sec;
    // Re-muestrear si difiere (interpolación simple)
    return Array.from({ length: n }, (_, i) => {
      const t   = i / n;
      const idx = t * (sec.length - 1);
      const lo  = Math.floor(idx);
      const hi  = Math.min(lo + 1, sec.length - 1);
      const f   = idx - lo;
      return [
        sec[lo][0] + (sec[hi][0] - sec[lo][0]) * f,
        sec[lo][1] + (sec[hi][1] - sec[lo][1]) * f,
        sec[lo][2] + (sec[hi][2] - sec[lo][2]) * f,
      ] as V3;
    });
  });

  const vertices: V3[] = normalizedSections.flat();
  const faces: MeshFace[] = [];

  for (let s = 0; s < normalizedSections.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const nextI = closedProfile ? (i + 1) % n : i + 1;
      if (!closedProfile && i === n - 1) continue;
      const a = s       * n + i;
      const b = s       * n + nextI;
      const c = (s + 1) * n + nextI;
      const d = (s + 1) * n + i;
      faces.push({ indices: [a, b, c, d] });
    }
  }

  // Tapas (fan triangulation)
  const capSection = (sectionOffset: number, reversed: boolean) => {
    const center: V3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      center[0] += vertices[sectionOffset + i][0] / n;
      center[1] += vertices[sectionOffset + i][1] / n;
      center[2] += vertices[sectionOffset + i][2] / n;
    }
    const ci = vertices.length;
    vertices.push(center);
    for (let i = 0; i < n; i++) {
      const a = sectionOffset + i;
      const b = sectionOffset + (i + 1) % n;
      faces.push({ indices: reversed ? [ci, b, a] : [ci, a, b] });
    }
  };

  capSection(0, true);
  capSection((normalizedSections.length - 1) * n, false);

  return { vertices, faces };
}

/**
 * Utilidad: genera una sección circular (para usar en loftMesh / sweepMesh).
 */
export function circleSection(
  radius: number,
  y: number,
  segments: number = 8,
  offsetAngle: number = 0,
): V3[] {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2 + offsetAngle;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as V3;
  });
}

/**
 * Utilidad: genera una sección cuadrada.
 */
export function squareSection(size: number, y: number): V3[] {
  const h = size / 2;
  return [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]] as V3[];
}

/**
 * Utilidad: genera una sección en forma de estrella.
 */
export function starSection(
  outerR: number,
  innerR: number,
  points: number,
  y: number,
): V3[] {
  const verts: V3[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r     = i % 2 === 0 ? outerR : innerR;
    verts.push([Math.cos(angle) * r, y, Math.sin(angle) * r]);
  }
  return verts;
}

// ─── Bisel / Bevel ────────────────────────────────────────────────────────────

/**
 * Aplica un bisel por inserción (face inset): cada cara es reemplazada
 * por una versión más pequeña centrada, rodeada de caras laterales trapezoidales.
 * Equivale a un "inset" de Blender.
 *
 * @param obj    Objeto fuente
 * @param amount Cantidad de bisel (0 = sin cambio, 1 = colapsa al centro)
 * @param offset Desplazamiento Y opcional de la cara interior (para efecto chamfer)
 */
export function roundAnglesMesh(
  obj: CSGObject | { type?: string; vertices?: V3[]; faces?: MeshFace[]; vertexOffsets?: Record<number, V3>; parameters?: any },
  radius: number = 0.08,
  segments: number = 3,
  angleThresholdDeg: number = 35,
): { vertices: V3[]; faces: MeshFace[] } {
  return bevelMeshAdvanced(obj, {
    affect: 'EDGES',
    widthType: 'OFFSET',
    width: radius,
    segments,
    profile: 0.5,
    profilePreset: 'SUPERELLIPSE',
    miterOuter: 'SHARP',
    limitMethod: 'ANGLE',
    angleThresholdDeg,
    clampOverlap: true,
    hardenNormals: true,
  });
}

export function bevelMesh(
  obj: CSGObject,
  amount: number = 0.08,
  offset: number = 0,
): { vertices: V3[]; faces: MeshFace[] } {
  return bevelMeshAdvanced(obj, {
    affect: 'EDGES',
    widthType: 'OFFSET',
    width: amount > 0 ? amount : 0.08,
    segments: 3,
    profile: 0.5,
    profilePreset: 'SUPERELLIPSE',
    miterOuter: 'SHARP',
    limitMethod: 'ANGLE',
    angleThresholdDeg: 30,
    clampOverlap: true,
    hardenNormals: true,
  });
}

// ─── PathDeform ───────────────────────────────────────────────────────────────

/**
 * Deforma un objeto existente doblándolo para seguir una curva/camino.
 * Funciona en el eje Z local del objeto: redistribuye los vértices
 * proyectando su coordenada Z a lo largo del camino.
 *
 * @param obj   Objeto a deformar
 * @param path  Camino 3D de puntos (debe cubrir el rango Z del objeto)
 */
export function pathDeformMesh(
  obj: CSGObject,
  path: V3[],
): { vertices: V3[]; faces: MeshFace[] } {
  if (path.length < 2 || obj.vertices.length === 0) return { vertices: obj.vertices, faces: obj.faces };

  // Calcular longitud total del camino
  const lengths: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    lengths.push(lengths[i - 1] + vecDist(path[i - 1], path[i]));
  }
  const totalLength = lengths[lengths.length - 1];

  // Rango Z del objeto
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of obj.vertices) {
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const rangeZ = maxZ - minZ || 1;

  const newVerts: V3[] = obj.vertices.map(v => {
    // Normalizar Z a [0,1] → posición en el camino
    const t  = ((v[2] - minZ) / rangeZ) * totalLength;

    // Encontrar segmento del camino
    let seg = 0;
    for (let i = 1; i < lengths.length; i++) {
      if (lengths[i] >= t) { seg = i - 1; break; }
    }
    seg = Math.min(seg, path.length - 2);

    const segLen = lengths[seg + 1] - lengths[seg];
    const localT = segLen > 0 ? (t - lengths[seg]) / segLen : 0;

    const p0 = new THREE.Vector3(...path[seg]);
    const p1 = new THREE.Vector3(...path[seg + 1]);

    // Tangente en el punto
    const tangent = p1.clone().sub(p0).normalize();
    const worldUp = Math.abs(tangent.y) < 0.999 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right   = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    const up      = new THREE.Vector3().crossVectors(right, tangent).normalize();

    // Posición en el camino + desplazamiento XY local
    const pathPos = p0.clone().lerp(p1, localT);
    const result  = pathPos
      .addScaledVector(right, v[0])
      .addScaledVector(up,    v[1]);

    return [result.x, result.y, result.z] as V3;
  });

  return { vertices: newVerts, faces: obj.faces };
}
