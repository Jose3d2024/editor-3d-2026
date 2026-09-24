import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { V3, MeshFace, CSGObject } from '../types';
import { pairTrianglesIntoQuads, type TriangleFace } from './retopology';

/**
 * Repair mesh issues and weld duplicate/coincident vertices across gaps:
 * 1. Merge duplicate/coincident vertices within spatial tolerance (using 3x3x3 grid search)
 * 2. Remove degenerate faces (< 3 unique verts)
 * 3. Remove duplicate faces
 */
export function repairMesh(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  tolerance: number = 0.001
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const report: string[] = [];
  if (!obj.vertices || obj.vertices.length === 0) return { vertices: [], faces: [], report: ['Sin vértices'] };

  // 0. Bake vertex offsets if they exist
  const baseVertices = obj.vertices.map((v, i) => {
    const off = (obj as any).vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
  });

  // 1. Weld duplicates with spatial grid search across 3x3x3 neighborhood
  const n = baseVertices.length;
  const tol = Math.max(0.00001, tolerance);
  const tolSq = tol * tol;
  const cellSize = tol;

  const gridMap = new Map<string, number[]>();
  const weldedVerts: V3[] = [];
  const remap: number[] = new Array(n);
  let mergedCount = 0;

  for (let i = 0; i < n; i++) {
    const v = baseVertices[i];
    const gx = Math.floor(v[0] / cellSize);
    const gy = Math.floor(v[1] / cellSize);
    const gz = Math.floor(v[2] / cellSize);

    let foundIdx = -1;

    for (let dx = -1; dx <= 1 && foundIdx === -1; dx++) {
      for (let dy = -1; dy <= 1 && foundIdx === -1; dy++) {
        for (let dz = -1; dz <= 1 && foundIdx === -1; dz++) {
          const key = `${gx + dx}_${gy + dy}_${gz + dz}`;
          const candidates = gridMap.get(key);
          if (candidates) {
            for (const candIdx of candidates) {
              const cv = weldedVerts[candIdx];
              const d0 = v[0] - cv[0];
              const d1 = v[1] - cv[1];
              const d2 = v[2] - cv[2];
              if (d0 * d0 + d1 * d1 + d2 * d2 <= tolSq) {
                foundIdx = candIdx;
                break;
              }
            }
          }
        }
      }
    }

    if (foundIdx !== -1) {
      remap[i] = foundIdx;
      mergedCount++;
    } else {
      const newIdx = weldedVerts.length;
      remap[i] = newIdx;
      weldedVerts.push([...v] as V3);

      const key = `${gx}_${gy}_${gz}`;
      let list = gridMap.get(key);
      if (!list) {
        list = [];
        gridMap.set(key, list);
      }
      list.push(newIdx);
    }
  }

  if (mergedCount > 0) report.push(`${mergedCount} vértices fusionados/soldados (distancia <= ${tol})`);

  // 2. Remap + remove degenerate faces
  let degenerateCount = 0, dupFaceCount = 0;
  const faceSet = new Set<string>();
  const cleanFaces: MeshFace[] = [];

  for (const face of obj.faces) {
    const remapped = face.indices.map(i => remap[i]);
    const filtered: number[] = [];
    const filteredUVs: [number, number][] = [];
    for (let k = 0; k < remapped.length; k++) {
      if (k === 0 || remapped[k] !== remapped[k - 1]) {
        filtered.push(remapped[k]);
        if (face.uvs && face.uvs[k]) {
          filteredUVs.push(face.uvs[k]);
        }
      }
    }
    if (filtered.length > 1 && filtered[0] === filtered[filtered.length - 1]) {
      filtered.pop();
      if (filteredUVs.length > filtered.length) {
        filteredUVs.pop();
      }
    }
    if (filtered.length < 3) { degenerateCount++; continue; }
    const key = [...filtered].sort((a,b)=>a-b).join(',');
    if (faceSet.has(key)) { dupFaceCount++; continue; }
    faceSet.add(key);
    cleanFaces.push({
      ...face,
      indices: filtered,
      ...(face.uvs && filteredUVs.length === filtered.length ? { uvs: filteredUVs } : {})
    });
  }
  if (degenerateCount > 0) report.push(`${degenerateCount} caras degeneradas eliminadas`);
  if (dupFaceCount > 0)     report.push(`${dupFaceCount} caras duplicadas eliminadas`);

  // 3. Remove unused vertices
  const used = new Set<number>();
  for (const f of cleanFaces) for (const i of f.indices) used.add(i);
  const compact: number[] = new Array(weldedVerts.length).fill(-1);
  const finalVerts: V3[] = [];
  const sortedUsed = [...used].sort((a,b)=>a-b);
  for (const i of sortedUsed) {
    compact[i] = finalVerts.length;
    finalVerts.push(weldedVerts[i]);
  }
  const finalFaces = cleanFaces.map(f => ({ 
    ...f,
    indices: f.indices.map(i => compact[i]) 
  }));

  if (report.length === 0) report.push('Malla limpia');

  return { vertices: finalVerts, faces: finalFaces, report };
}

export const weldMesh = repairMesh;

/**
 * Fills holes based on a selection of faces.
 * It finds the boundary edges of the selected faces and fills the loops.
 */
export function capSelectedFaces(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  selectedFaceIndices: number[]
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  if (selectedFaceIndices.length === 0) return { ...obj, report: ['No hay caras seleccionadas'] };

  const report: string[] = [];
  const vertices = [...obj.vertices];
  const faces = [...obj.faces];

  // 1. Find boundary edges of the selection
  const edgeMap = new Map<string, { a: number, b: number, count: number }>();
  selectedFaceIndices.forEach(fIdx => {
    const face = faces[fIdx];
    if (!face) return;
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const entry = edgeMap.get(key) || { a, b, count: 0 };
      entry.count++;
      edgeMap.set(key, entry);
    }
  });

  // Boundary edges of the selection are those that appear only once in the selection
  const boundaryEdges = Array.from(edgeMap.values()).filter(e => e.count === 1);
  
  // 2. Chain edges into loops
  // (Similar logic to fillHoles but restricted to selection boundary)
  const adj = new Map<number, number[]>();
  boundaryEdges.forEach(e => {
    // We need to find which face this edge belongs to in the selection to get orientation
    for (const fIdx of selectedFaceIndices) {
      const face = faces[fIdx];
      for(let i=0; i<face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i+1)%face.indices.length];
        if ((a === e.a && b === e.b) || (a === e.b && b === e.a)) {
          // In the selection, the edge goes a -> b.
          // To "cap" it, we should go b -> a.
          if (!adj.has(b)) adj.set(b, []);
          adj.get(b)!.push(a);
        }
      }
    }
  });

  // ... rest of the loop detection and filling logic is the same as fillHoles ...
  // I'll refactor fillHoles to use a common loop-filling helper.
  return fillHolesFromAdj(vertices, faces, adj, report);
}

function fillHolesFromAdj(vertices: V3[], faces: MeshFace[], adj: Map<number, number[]>, report: string[]): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  // 1. Trace closed boundary loops with subcycle detection
  const visitedEdges = new Set<string>();
  const loops: number[][] = [];

  for (const [startNode, neighbors] of adj.entries()) {
    for (const neighbor of neighbors) {
      const edgeKey = `${startNode}->${neighbor}`;
      if (visitedEdges.has(edgeKey)) continue;

      let path: number[] = [startNode];
      visitedEdges.add(edgeKey);
      let current = neighbor;

      while (true) {
        const cycleIdx = path.indexOf(current);
        if (cycleIdx !== -1) {
          const cycle = path.slice(cycleIdx);
          if (cycle.length >= 3) {
            loops.push(cycle);
          }
          path = path.slice(0, cycleIdx);
          if (path.length === 0) break;
          current = path[path.length - 1];
        } else {
          path.push(current);
        }

        const nextNeighbors = adj.get(current);
        if (!nextNeighbors) break;

        let foundNext = false;
        for (const next of nextNeighbors) {
          const nextKey = `${current}->${next}`;
          if (!visitedEdges.has(nextKey)) {
            visitedEdges.add(nextKey);
            current = next;
            foundNext = true;
            break;
          }
        }
        if (!foundNext) break;
      }
    }
  }

  let holesFilled = 0;
  loops.forEach(loop => {
    if (loop.length < 3) return;
    const loopVerts = loop.map(idx => new THREE.Vector3(...vertices[idx]));
    const normal = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < loopVerts.length; i++) {
      const curr = loopVerts[i];
      const next = loopVerts[(i + 1) % loopVerts.length];
      normal.x += (curr.y - next.y) * (curr.z + next.z);
      normal.y += (curr.z - next.z) * (curr.x + next.x);
      normal.z += (curr.x - next.x) * (curr.y + next.y);
    }
    if (normal.lengthSq() > 1e-8) {
      normal.normalize();
    }
    let maxHoleDiamSq = 0;
    const numLpVerts = loopVerts.length;
    for (let i = 0; i < numLpVerts; i++) {
      for (let j = i + 1; j < numLpVerts; j++) {
        const dSq = loopVerts[i].distanceToSquared(loopVerts[j]);
        if (dSq > maxHoleDiamSq) maxHoleDiamSq = dSq;
      }
    }
    const maxDiam = Math.sqrt(maxHoleDiamSq);

    // Calculate centroid of the boundary loop
    const center = new THREE.Vector3();
    loopVerts.forEach(v => center.add(v));
    center.divideScalar(numLpVerts);

    let maxPlaneDev = 0;
    for (const v of loopVerts) {
      const dev = Math.abs(normal.dot(v.clone().sub(center)));
      if (dev > maxPlaneDev) maxPlaneDev = dev;
    }

    const isNearPlanar = maxPlaneDev <= maxDiam * 0.28 && numLpVerts <= 120 && normal.lengthSq() > 1e-4;
    let triangles: number[][] = [];

    if (isNearPlanar) {
      const absX = Math.abs(normal.x), absY = Math.abs(normal.y), absZ = Math.abs(normal.z);
      let uAxis: 'x' | 'y' | 'z', vAxis: 'x' | 'y' | 'z';
      if (absX > absY && absX > absZ) { uAxis = 'y'; vAxis = 'z'; }
      else if (absY > absX && absY > absZ) { uAxis = 'x'; vAxis = 'z'; }
      else { uAxis = 'x'; vAxis = 'y'; }

      const points2D = loopVerts.map(v => new THREE.Vector2(v[uAxis], v[vAxis]));
      try {
        triangles = THREE.ShapeUtils.triangulateShape(points2D, []);
      } catch (e) {
        triangles = [];
      }
    }

    // ── 🛡️ SELLADO 3D ROBUSTO (CENTROID FAN FALLBACK) ──
    if (!triangles || triangles.length === 0) {
      const centerIdx = vertices.length;
      vertices.push([center.x, center.y, center.z]);
      for (let i = 0; i < numLpVerts; i++) {
        const vA = loop[i];
        const vB = loop[(i + 1) % numLpVerts];
        faces.push({
          indices: [vA, vB, centerIdx]
        });
      }
      holesFilled++;
      return;
    }

    const loopUVs = loop.map(vIdx => {
      for (const f of faces) {
        const idx = f.indices.indexOf(vIdx);
        if (idx !== -1 && f.uvs && f.uvs[idx]) return f.uvs[idx];
      }
      return [0, 0] as [number, number];
    });

    triangles.forEach(tri => {
      faces.push({
        indices: [loop[tri[0]], loop[tri[1]], loop[tri[2]]],
        uvs: [loopUVs[tri[0]], loopUVs[tri[1]], loopUVs[tri[2]]]
      });
    });
    holesFilled++;
  });

  // 2. Verificación y Cierre Universal Exhaustivo de cualquier borde abierto remanente
  const edgeMapRem = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((face, fIdx) => {
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeMapRem.has(key)) edgeMapRem.set(key, { a, b, faces: [] });
      edgeMapRem.get(key)!.faces.push(fIdx);
    }
  });

  const remainingBoundaries = Array.from(edgeMapRem.values()).filter(e => e.faces.length === 1);
  if (remainingBoundaries.length > 0) {
    const directedEdges: { from: number; to: number }[] = [];
    remainingBoundaries.forEach(e => {
      const face = faces[e.faces[0]];
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i];
        const b = face.indices[(i + 1) % face.indices.length];
        if ((a === e.a && b === e.b) || (a === e.b && b === e.a)) {
          directedEdges.push({ from: b, to: a });
          break;
        }
      }
    });

    // Agrupar en componentes conexos mediante DSU (Union-Find)
    const parent = new Map<number, number>();
    function findRoot(i: number): number {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) !== i) parent.set(i, findRoot(parent.get(i)!));
      return parent.get(i)!;
    }
    function unionNodes(i: number, j: number) {
      const ri = findRoot(i);
      const rj = findRoot(j);
      if (ri !== rj) parent.set(ri, rj);
    }
    directedEdges.forEach(e => unionNodes(e.from, e.to));

    const components = new Map<number, { from: number; to: number }[]>();
    directedEdges.forEach(e => {
      const r = findRoot(e.from);
      if (!components.has(r)) components.set(r, []);
      components.get(r)!.push(e);
    });

    for (const [, compEdges] of components.entries()) {
      const vertSet = new Set<number>();
      compEdges.forEach(e => { vertSet.add(e.from); vertSet.add(e.to); });

      const compCenter = new THREE.Vector3();
      vertSet.forEach(vIdx => {
        const v = vertices[vIdx];
        compCenter.add(new THREE.Vector3(v[0], v[1], v[2]));
      });
      compCenter.divideScalar(vertSet.size);

      const compCenterIdx = vertices.length;
      vertices.push([compCenter.x, compCenter.y, compCenter.z]);

      compEdges.forEach(e => {
        faces.push({ indices: [e.from, e.to, compCenterIdx] });
      });
      holesFilled++;
    }
  }

  // 3. Limpieza final de vértices duplicados y caras degeneradas
  const cleanRep = repairMesh({ vertices, faces }, 0.0005);
  if (holesFilled > 0) report.push(`¡Sellado completo! ${holesFilled} aberturas/huecos tapados (malla 100% estanca).`);
  return { vertices: cleanRep.vertices, faces: cleanRep.faces, report };
}

/**
 * Detects open boundaries (edges shared by only one face) and fills them.
 */
export function fillHoles(obj: CSGObject | { vertices: V3[]; faces: MeshFace[] }): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const repaired = repairMesh(obj);
  const report: string[] = [...repaired.report];
  const vertices = [...repaired.vertices];
  const faces = [...repaired.faces];

  const edgeMap = new Map<string, { a: number, b: number, faces: number[] }>();
  faces.forEach((face, fIdx) => {
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { a, b, faces: [] });
      edgeMap.get(key)!.faces.push(fIdx);
    }
  });

  const boundaryEdges = Array.from(edgeMap.values()).filter(e => e.faces.length === 1);
  if (boundaryEdges.length === 0) return { vertices, faces, report: ['No se detectaron huecos (malla cerrada)'] };

  const adj = new Map<number, number[]>();
  boundaryEdges.forEach(e => {
    const face = faces[e.faces[0]];
    for(let i=0; i<face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i+1)%face.indices.length];
      if ((a === e.a && b === e.b) || (a === e.b && b === e.a)) {
        if (!adj.has(b)) adj.set(b, []);
        adj.get(b)!.push(a);
        break;
      }
    }
  });

  return fillHolesFromAdj(vertices, faces, adj, report);
}

/**
 * Computes smooth vertex normals across split vertices sharing the same 3D spatial position.
 * Prevents shading seams and artifacts on bevels, rounded boxes, and smooth primitives
 * where vertices were split for distinct UVs or seams.
 */
export function computeSmoothNormalsByPosition(
  geometry: THREE.BufferGeometry,
  creaseAngleRad: number = Math.PI / 3 // Default 60 degrees threshold
): void {
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const indexAttr = geometry.getIndex();
  if (!posAttr) return;

  const count = posAttr.count;
  const normals = new Float32Array(count * 3);

  // Group vertex indices by spatial position
  const posMap = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const key = `${Math.round(x * 100000)}_${Math.round(y * 100000)}_${Math.round(z * 100000)}`;
    let list = posMap.get(key);
    if (!list) {
      list = [];
      posMap.set(key, list);
    }
    list.push(i);
  }

  // Compute face normals and face vertex connections
  const faceNormals: THREE.Vector3[] = [];
  const faceIndices: [number, number, number][] = [];

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  const numTriangles = indexAttr ? indexAttr.count / 3 : count / 3;

  for (let f = 0; f < numTriangles; f++) {
    let iA = f * 3;
    let iB = f * 3 + 1;
    let iC = f * 3 + 2;
    if (indexAttr) {
      iA = indexAttr.getX(f * 3);
      iB = indexAttr.getX(f * 3 + 1);
      iC = indexAttr.getX(f * 3 + 2);
    }

    pA.fromBufferAttribute(posAttr, iA);
    pB.fromBufferAttribute(posAttr, iB);
    pC.fromBufferAttribute(posAttr, iC);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    const norm = new THREE.Vector3().crossVectors(cb, ab);
    if (norm.lengthSq() > 1e-12) {
      faceNormals.push(norm); // Area weighted
    } else {
      faceNormals.push(new THREE.Vector3(0, 1, 0));
    }
    faceIndices.push([iA, iB, iC]);
  }

  // Map each vertex index to the face indices using it
  const vertToFaces: number[][] = Array.from({ length: count }, () => []);
  for (let f = 0; f < faceIndices.length; f++) {
    const [iA, iB, iC] = faceIndices[f];
    vertToFaces[iA].push(f);
    vertToFaces[iB].push(f);
    vertToFaces[iC].push(f);
  }

  const cosMaxAngle = Math.cos(creaseAngleRad);
  const tempNormal = new THREE.Vector3();
  const normA = new THREE.Vector3();
  const normB = new THREE.Vector3();

  posMap.forEach((vertIndices) => {
    // Gather all faces touching any vertex at this spatial location
    const touchingFaces: number[] = [];
    vertIndices.forEach((vi) => {
      vertToFaces[vi].forEach((fi) => {
        if (!touchingFaces.includes(fi)) touchingFaces.push(fi);
      });
    });

    vertIndices.forEach((vi) => {
      const myFaces = vertToFaces[vi];
      if (myFaces.length === 0) return;

      normA.copy(faceNormals[myFaces[0]]).normalize();
      tempNormal.set(0, 0, 0);

      touchingFaces.forEach((fi) => {
        normB.copy(faceNormals[fi]).normalize();
        if (normA.dot(normB) >= cosMaxAngle) {
          tempNormal.add(faceNormals[fi]);
        }
      });

      if (tempNormal.lengthSq() > 1e-12) {
        tempNormal.normalize();
      } else {
        tempNormal.copy(normA);
      }

      normals[vi * 3] = tempNormal.x;
      normals[vi * 3 + 1] = tempNormal.y;
      normals[vi * 3 + 2] = tempNormal.z;
    });
  });

  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
}

/**
 * Remove disconnected floating shells/islands (noise pieces in 3D space)
 * Keeps the largest component(s) or any shell containing at least minRatio of the maximum shell's faces.
 */
export function removeDisconnectedIslands(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  minFaceRatio: number = 0.05,
  minAbsoluteFaces: number = 6
): { vertices: V3[]; faces: MeshFace[]; removedShells: number; report: string[] } {
  const repaired = repairMesh(obj);
  const { vertices, faces } = repaired;
  if (faces.length === 0) return { vertices, faces, removedShells: 0, report: ['Sin caras para analizar'] };

  // 1. Mapeo espacial de vértices para conectar triángulos que comparten posición en 3D
  // aunque tengan índices separados por UVs, costuras o normales duras
  const precision = 1e-3;
  const posMap = new Map<string, number>();
  const vertToSpatialId = new Int32Array(vertices.length);

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const x = Math.round(v[0] / precision);
    const y = Math.round(v[1] / precision);
    const z = Math.round(v[2] / precision);
    const key = `${x}_${y}_${z}`;
    let id = posMap.get(key);
    if (id === undefined) {
      id = posMap.size;
      posMap.set(key, id);
    }
    vertToSpatialId[i] = id;
  }

  // 2. Construir grafo de adyacencia usando aristas espaciales
  const edgeToFaces = new Map<string, number[]>();
  faces.forEach((face, fIdx) => {
    const len = face.indices.length;
    for (let i = 0; i < len; i++) {
      const a = vertToSpatialId[face.indices[i]];
      const b = vertToSpatialId[face.indices[(i + 1) % len]];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let list = edgeToFaces.get(key);
      if (!list) {
        list = [];
        edgeToFaces.set(key, list);
      }
      list.push(fIdx);
    }
  });

  const faceAdj: number[][] = Array.from({ length: faces.length }, () => []);
  edgeToFaces.forEach(fIndices => {
    if (fIndices.length > 1) {
      for (let i = 0; i < fIndices.length; i++) {
        for (let j = i + 1; j < fIndices.length; j++) {
          faceAdj[fIndices[i]].push(fIndices[j]);
          faceAdj[fIndices[j]].push(fIndices[i]);
        }
      }
    }
  });

  // 3. Descubrir componentes conexos (conchas continuas)
  const visited = new Uint8Array(faces.length);
  const shells: number[][] = [];

  for (let i = 0; i < faces.length; i++) {
    if (visited[i]) continue;
    const shell: number[] = [];
    const queue = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const curr = queue.pop()!;
      shell.push(curr);
      for (const neighbor of faceAdj[curr]) {
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    shells.push(shell);
  }

  if (shells.length <= 1) {
    return { vertices, faces, removedShells: 0, report: ['Malla continua (1 sola concha sólida)'] };
  }

  // 4. Calcular Bounding Box total del objeto
  const objMin = [Infinity, Infinity, Infinity];
  const objMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    for (let d = 0; d < 3; d++) {
      if (v[d] < objMin[d]) objMin[d] = v[d];
      if (v[d] > objMax[d]) objMax[d] = v[d];
    }
  }
  const objDiag = Math.hypot(objMax[0] - objMin[0], objMax[1] - objMin[1], objMax[2] - objMin[2]) || 1.0;

  // 5. Calcular métricas físicas de cada concha
  let totalMeshArea = 0;
  const shellMetrics = shells.map(shell => {
    const sMin = [Infinity, Infinity, Infinity];
    const sMax = [-Infinity, -Infinity, -Infinity];
    let sArea = 0;

    for (const fIdx of shell) {
      const f = faces[fIdx];
      for (const vIdx of f.indices) {
        const v = vertices[vIdx];
        for (let d = 0; d < 3; d++) {
          if (v[d] < sMin[d]) sMin[d] = v[d];
          if (v[d] > sMax[d]) sMax[d] = v[d];
        }
      }
      if (f.indices.length >= 3) {
        const p0 = vertices[f.indices[0]];
        const p1 = vertices[f.indices[1]];
        const p2 = vertices[f.indices[2]];
        const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
        const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
        const cx = ay * bz - az * by;
        const cy = az * bx - ax * bz;
        const cz = ax * by - ay * bx;
        sArea += Math.hypot(cx, cy, cz) * 0.5;
      }
    }
    totalMeshArea += sArea;
    const sDiag = Math.hypot(sMax[0] - sMin[0], sMax[1] - sMin[1], sMax[2] - sMin[2]);
    return { sDiag, sArea };
  });

  // 6. Criterio de seguridad:
  // Piezas con tamaño físico real >= 1.5% del objeto, con más de 8 caras o área apreciable
  // NUNCA son eliminadas (paneles, compuertas, visores, cañones).
  const keptFacesList: MeshFace[] = [];
  let removedCount = 0;
  let potentialRemovedFaces = 0;

  for (let sIdx = 0; sIdx < shells.length; sIdx++) {
    const shell = shells[sIdx];
    const { sDiag, sArea } = shellMetrics[sIdx];
    const diagRatio = sDiag / objDiag;

    const isNoiseSpeck =
      diagRatio < 0.015 &&
      shell.length <= 8 &&
      (totalMeshArea === 0 || sArea < totalMeshArea * 0.0005);

    if (isNoiseSpeck) {
      removedCount++;
      potentialRemovedFaces += shell.length;
    } else {
      for (const fIdx of shell) {
        keptFacesList.push(faces[fIdx]);
      }
    }
  }

  // Salvaguarda: si se borraría más del 2% del total de caras, abortar y preservar todo
  if (potentialRemovedFaces > faces.length * 0.02 || removedCount === 0 || keptFacesList.length === 0) {
    return { vertices, faces, removedShells: 0, report: [`${shells.length} conchas principales conservadas (sin ruido)`] };
  }

  // 7. Re-indexar y compactar vértices
  const cleanRepaired = repairMesh({ vertices, faces: keptFacesList });
  return {
    vertices: cleanRepaired.vertices,
    faces: cleanRepaired.faces,
    removedShells: removedCount,
    report: [`${removedCount} fragmento(s) flotante(s) de ruido eliminados`]
  };
}

/**
 * Tangential Laplacian Regularizer (Feature-Preserving Mesh Regularization).
 * Equalizes triangle sizes and relaxes vertices along the tangent surface plane
 * to turn irregular/stretched triangles into regular, equilateral topology without shrinking volume.
 */
export function regularizeMeshTopology(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  options: {
    strength?: number; // 0.1 to 1.0
    iterations?: number; // 1 to 10
    featureAngleDeg?: number; // threshold angle to preserve sharp mechanical edges (e.g. 35-45 deg)
    equalizeEdgeLengths?: boolean;
  } = {}
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const strength = Math.max(0.01, Math.min(1.0, options.strength ?? 0.6));
  const iterations = Math.max(1, Math.min(20, options.iterations ?? 3));
  const featureAngleRad = ((options.featureAngleDeg ?? 40) * Math.PI) / 180;
  const cosFeature = Math.cos(featureAngleRad);

  const repaired = repairMesh(obj);
  let currentVerts = repaired.vertices.map(v => new THREE.Vector3(v[0], v[1], v[2]));
  const faces = repaired.faces;
  const nVerts = currentVerts.length;
  if (nVerts === 0 || faces.length === 0) return { vertices: repaired.vertices, faces: repaired.faces, report: ['Malla vacía'] };

  // 1. Build vertex-to-faces and vertex-to-neighbors adjacency
  const vertNeighbors: Set<number>[] = Array.from({ length: nVerts }, () => new Set<number>());
  const vertFaces: number[][] = Array.from({ length: nVerts }, () => []);

  faces.forEach((face, fIdx) => {
    const len = face.indices.length;
    for (let i = 0; i < len; i++) {
      const idxA = face.indices[i];
      const idxB = face.indices[(i + 1) % len];
      if (idxA < nVerts && idxB < nVerts) {
        vertNeighbors[idxA].add(idxB);
        vertNeighbors[idxB].add(idxA);
        vertFaces[idxA].push(fIdx);
      }
    }
  });

  // Calculate face normals and areas
  const faceNormals: THREE.Vector3[] = [];
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  const updateFaceNormals = () => {
    faceNormals.length = 0;
    for (let f = 0; f < faces.length; f++) {
      const idxs = faces[f].indices;
      if (idxs.length < 3) {
        faceNormals.push(new THREE.Vector3(0, 1, 0));
        continue;
      }
      pA.copy(currentVerts[idxs[0]]);
      pB.copy(currentVerts[idxs[1]]);
      pC.copy(currentVerts[idxs[2]]);
      cb.subVectors(pC, pB);
      ab.subVectors(pA, pB);
      const fn = new THREE.Vector3().crossVectors(cb, ab);
      if (fn.lengthSq() > 1e-12) fn.normalize();
      else fn.set(0, 1, 0);
      faceNormals.push(fn);
    }
  };

  // Detect feature edges (creases) and boundaries to constrain vertex motion
  const edgeFaces = new Map<string, number[]>();
  faces.forEach((face, fIdx) => {
    const len = face.indices.length;
    for (let i = 0; i < len; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % len];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let list = edgeFaces.get(key);
      if (!list) { list = []; edgeFaces.set(key, list); }
      list.push(fIdx);
    }
  });

  const safeStrength = Math.min(0.35, Math.max(0.05, strength));

  for (let iter = 0; iter < iterations; iter++) {
    updateFaceNormals();

    // Compute smooth vertex normal and crease constraints
    const nextVerts = currentVerts.map(v => v.clone());
    const vertNormal = new THREE.Vector3();
    const neighborCenter = new THREE.Vector3();
    const disp = new THREE.Vector3();

    for (let i = 0; i < nVerts; i++) {
      const neighbors = Array.from(vertNeighbors[i]);
      if (neighbors.length === 0) continue;

      const myFaceIndices = vertFaces[i];
      vertNormal.set(0, 0, 0);
      for (const fi of myFaceIndices) {
        if (faceNormals[fi]) vertNormal.add(faceNormals[fi]);
      }
      if (vertNormal.lengthSq() > 1e-12) vertNormal.normalize();
      else vertNormal.set(0, 1, 0);

      // Check boundary vs crease edges
      const boundaryNeighbors: number[] = [];
      const creaseNeighbors: number[] = [];
      for (const nIdx of neighbors) {
        const key = i < nIdx ? `${i}_${nIdx}` : `${nIdx}_${i}`;
        const sharingFaces = edgeFaces.get(key);
        if (sharingFaces) {
          if (sharingFaces.length === 1) {
            boundaryNeighbors.push(nIdx);
          } else if (sharingFaces.length === 2) {
            const fn1 = faceNormals[sharingFaces[0]];
            const fn2 = faceNormals[sharingFaces[1]];
            if (fn1 && fn2 && fn1.dot(fn2) < cosFeature) {
              creaseNeighbors.push(nIdx);
            }
          }
        }
      }

      // Boundary handling
      if (boundaryNeighbors.length > 0) {
        if (boundaryNeighbors.length === 2) {
          // Slide along open boundary perimeter
          const p1 = currentVerts[boundaryNeighbors[0]];
          const p2 = currentVerts[boundaryNeighbors[1]];
          const lineDir = new THREE.Vector3().subVectors(p2, p1).normalize();
          const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
          const toMid = new THREE.Vector3().subVectors(midPoint, currentVerts[i]);
          const proj = lineDir.clone().multiplyScalar(toMid.dot(lineDir));
          const maxMove = currentVerts[i].distanceTo(p1) * 0.2;
          if (proj.length() > maxMove) proj.setLength(maxMove);
          nextVerts[i].addScaledVector(proj, safeStrength * 0.35);
        }
        continue;
      }

      if (creaseNeighbors.length === 2) {
        // Vertex is on a continuous crease line: relax only ALONG the crease line (1D projection)
        const p1 = currentVerts[creaseNeighbors[0]];
        const p2 = currentVerts[creaseNeighbors[1]];
        const lineDir = new THREE.Vector3().subVectors(p2, p1).normalize();
        const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const toMid = new THREE.Vector3().subVectors(midPoint, currentVerts[i]);
        const proj = lineDir.clone().multiplyScalar(toMid.dot(lineDir));
        const maxMove = currentVerts[i].distanceTo(p1) * 0.2;
        if (proj.length() > maxMove) proj.setLength(maxMove);
        nextVerts[i].addScaledVector(proj, safeStrength * 0.35);
      } else if (creaseNeighbors.length > 2) {
        // Corner / junction vertex: keep fixed to preserve corner sharpness
        continue;
      } else {
        // Smooth interior or gentle surface: Tangential Laplacian relaxation
        neighborCenter.set(0, 0, 0);
        let totalWeight = 0;
        let minEdgeDist = Infinity;

        for (const nIdx of neighbors) {
          const np = currentVerts[nIdx];
          const dist = currentVerts[i].distanceTo(np);
          if (dist < minEdgeDist) minEdgeDist = dist;
          const weight = dist > 1e-6 ? 1.0 : 0.0;
          neighborCenter.addScaledVector(np, weight);
          totalWeight += weight;
        }

        if (totalWeight > 0) {
          neighborCenter.multiplyScalar(1 / totalWeight);
          disp.subVectors(neighborCenter, currentVerts[i]);
          
          // Project displacement onto tangent plane (remove normal component)
          const normalComp = disp.dot(vertNormal);
          disp.addScaledVector(vertNormal, -normalComp);

          // Clamping
          const maxDisp = isFinite(minEdgeDist) && minEdgeDist > 1e-5 ? minEdgeDist * 0.2 : 0.01;
          if (disp.length() > maxDisp) disp.setLength(maxDisp);

          // Apply tangential relaxation step
          nextVerts[i].addScaledVector(disp, safeStrength);
        }
      }
    }

    currentVerts = nextVerts;
  }

  const finalVertices: V3[] = currentVerts.map(v => [v.x, v.y, v.z]);
  return {
    vertices: finalVertices,
    faces,
    report: [`Malla regularizada con ${iterations} pasadas tangenciales (conservación de bordes ${options.featureAngleDeg ?? 40}°)`]
  };
}

/**
 * Isotropic Uniform Remesher (Re-topologizador Uniforme).
 * Re-muestrea la superficie de la geometría para crear una red triangular equilibrada y uniforme.
 * Divide aristas largas excesivas y colapsa aristas microscópicas para mantener o reducir el recuento
 * de caras sin sobrepasar nunca el presupuesto de polígonos del modelo (ideal post-optimización).
 */
export function isotropicRemesh(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  targetEdgeLength?: number,
  iterations: number = 3,
  options?: {
    maxFaces?: number;
    maintainFaceBudget?: boolean;
  }
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  // 1. Reparar y preparar entrada
  const repaired = repairMesh(obj);
  let verts: V3[] = repaired.vertices.map(v => [...v]);
  let faces: MeshFace[] = repaired.faces.map(f => ({ ...f, indices: [...f.indices] }));

  // Triangular n-gonos iniciales
  const triFaces: MeshFace[] = [];
  faces.forEach(f => {
    if (f.indices.length === 3) {
      triFaces.push(f);
    } else {
      for (let i = 1; i < f.indices.length - 1; i++) {
        triFaces.push({
          indices: [f.indices[0], f.indices[i], f.indices[i + 1]],
          uvs: f.uvs ? [f.uvs[0], f.uvs[i], f.uvs[i + 1]] : undefined
        });
      }
    }
  });
  faces = triFaces;

  if (verts.length < 4 || faces.length === 0) {
    return { vertices: verts, faces, report: ['Malla insuficiente para remallado'] };
  }

  const initialFaceCount = faces.length;
  // Límite estricto de caras: por defecto NUNCA superar el recuento actual del modelo
  const maxAllowedFaces = options?.maxFaces ?? initialFaceCount;

  // 2. Calcular área superficial total y longitud promedio de aristas
  let totalArea = 0;
  let totalEdgeLen = 0;
  let edgeCount = 0;

  faces.forEach(f => {
    const p0 = verts[f.indices[0]], p1 = verts[f.indices[1]], p2 = verts[f.indices[2]];
    if (!p0 || !p1 || !p2) return;

    for (let i = 0; i < 3; i++) {
      const a = verts[f.indices[i]];
      const b = verts[f.indices[(i + 1) % 3]];
      if (a && b) {
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        totalEdgeLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
        edgeCount++;
      }
    }

    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    totalArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
  });

  const avgEdgeLen = edgeCount > 0 ? totalEdgeLen / edgeCount : 0.1;
  // Longitud teórica para una rejilla de triángulos equiláteros con maxAllowedFaces caras
  const idealEquilateralL = Math.sqrt((4 * Math.max(1e-5, totalArea)) / (Math.sqrt(3) * Math.max(4, maxAllowedFaces)));
  const targetL = targetEdgeLength && targetEdgeLength > 0 ? targetEdgeLength : Math.max(avgEdgeLen, idealEquilateralL);

  const minL = targetL * 0.75;
  const maxL = targetL * 1.45;
  const minLSq = minL * minL;
  const maxLSq = maxL * maxL;

  // Helper para calcular la normal de una cara triangular
  const getFaceNormal = (i0: number, i1: number, i2: number, vertList: V3[]): THREE.Vector3 => {
    const v0 = vertList[i0], v1 = vertList[i1], v2 = vertList[i2];
    if (!v0 || !v1 || !v2) return new THREE.Vector3(0, 1, 0);
    const ab = new THREE.Vector3(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
    const ac = new THREE.Vector3(v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]);
    const n = new THREE.Vector3().crossVectors(ab, ac);
    const len = n.length();
    return len > 1e-8 ? n.multiplyScalar(1 / len) : new THREE.Vector3(0, 1, 0);
  };

  // Pasadas de remallado isótropo: Colapso -> División controlada -> Regularización
  for (let pass = 0; pass < iterations; pass++) {
    // ─── PASO 1: Colapso de aristas microscópicas (< minL) ───
    // Este paso es crucial para eliminar triángulos redundantes o aristas apretadas y evitar inflación de polígonos
    const edgeCollapses = new Map<number, number>(); // vFrom -> vTo
    const collapsedFaces: MeshFace[] = [];

    // Mapear caras por vértice para comprobaciones rápidas de inversión de normales
    const vFaces = new Map<number, number[]>();
    faces.forEach((f, fIdx) => {
      f.indices.forEach(idx => {
        let list = vFaces.get(idx);
        if (!list) { list = []; vFaces.set(idx, list); }
        list.push(fIdx);
      });
    });

    const processedEdges = new Set<string>();

    for (let fIdx = 0; fIdx < faces.length; fIdx++) {
      const f = faces[fIdx];
      if (!f) continue;
      const [i0, i1, i2] = f.indices;

      const pairs: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]];
      for (const [va, vb] of pairs) {
        if (va === vb) continue;
        const eKey = va < vb ? `${va}_${vb}` : `${vb}_${va}`;
        if (processedEdges.has(eKey)) continue;
        processedEdges.add(eKey);

        const pa = verts[va], pb = verts[vb];
        if (!pa || !pb) continue;
        const dSq = (pa[0]-pb[0])**2 + (pa[1]-pb[1])**2 + (pa[2]-pb[2])**2;

        if (dSq < minLSq && !edgeCollapses.has(va) && !edgeCollapses.has(vb)) {
          // Evaluar si colapsar vb en va no invierte las normales de las caras adyacentes a vb
          const vbSharing = vFaces.get(vb) || [];
          let canCollapse = true;

          const midPoint: V3 = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];

          for (const sFi of vbSharing) {
            const sf = faces[sFi];
            if (!sf) continue;
            // Si la cara contiene ambos (va y vb), se convertirá en degenerada y desaparecerá (válido)
            if (sf.indices.includes(va)) continue;

            const oldN = getFaceNormal(sf.indices[0], sf.indices[1], sf.indices[2], verts);
            // Simular nueva normal con vb sustituido por el punto medio en va
            const simIndices = sf.indices.map(idx => idx === vb ? va : idx);
            const tempVerts = verts.map((v, i) => i === va ? midPoint : v);
            const newN = getFaceNormal(simIndices[0], simIndices[1], simIndices[2], tempVerts);

            if (oldN.dot(newN) < 0.2) {
              canCollapse = false;
              break;
            }
          }

          if (canCollapse) {
            verts[va] = midPoint;
            edgeCollapses.set(vb, va);
          }
        }
      }
    }

    if (edgeCollapses.size > 0) {
      // Aplicar resolución de enlaces de colapso
      const resolveTarget = (idx: number): number => {
        let curr = idx;
        let depth = 0;
        while (edgeCollapses.has(curr) && depth < 10) {
          curr = edgeCollapses.get(curr)!;
          depth++;
        }
        return curr;
      };

      faces.forEach(f => {
        const n0 = resolveTarget(f.indices[0]);
        const n1 = resolveTarget(f.indices[1]);
        const n2 = resolveTarget(f.indices[2]);
        // Si no colapsó a una línea/punto (no degenerado), conservamos la cara
        if (n0 !== n1 && n1 !== n2 && n2 !== n0) {
          collapsedFaces.push({ indices: [n0, n1, n2], uvs: f.uvs });
        }
      });
      faces = collapsedFaces;
    }

    // ─── PASO 2: División selectiva de aristas largas (> maxL) ───
    // Determinación global previa de aristas a dividir para garantizar que triángulos adyacentes compartan la subdivisión (sin T-junctions)
    const newFaces: MeshFace[] = [];
    const edgeMidMap = new Map<string, number>();

    const getMidpoint = (idxA: number, idxB: number): number => {
      const key = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
      if (edgeMidMap.has(key)) return edgeMidMap.get(key)!;
      const va = verts[idxA];
      const vb = verts[idxB];
      const mid: V3 = [(va[0] + vb[0]) * 0.5, (va[1] + vb[1]) * 0.5, (va[2] + vb[2]) * 0.5];
      const midIdx = verts.length;
      verts.push(mid);
      edgeMidMap.set(key, midIdx);
      return midIdx;
    };

    const edgeKey = (a: number, b: number) => a < b ? `${a}_${b}` : `${b}_${a}`;
    const edgesToSplit = new Set<string>();

    // Solo marcar aristas si aún estamos dentro del margen presupuestario
    if (faces.length < maxAllowedFaces) {
      for (const f of faces) {
        const [i0, i1, i2] = f.indices;
        const v0 = verts[i0], v1 = verts[i1], v2 = verts[i2];
        if (!v0 || !v1 || !v2) continue;
        if ((v0[0]-v1[0])**2 + (v0[1]-v1[1])**2 + (v0[2]-v1[2])**2 > maxLSq) edgesToSplit.add(edgeKey(i0, i1));
        if ((v1[0]-v2[0])**2 + (v1[1]-v2[1])**2 + (v1[2]-v2[2])**2 > maxLSq) edgesToSplit.add(edgeKey(i1, i2));
        if ((v2[0]-v0[0])**2 + (v2[1]-v0[1])**2 + (v2[2]-v0[2])**2 > maxLSq) edgesToSplit.add(edgeKey(i2, i0));
      }
    }

    faces.forEach(f => {
      const [i0, i1, i2] = f.indices;
      const v0 = verts[i0], v1 = verts[i1], v2 = verts[i2];
      if (!v0 || !v1 || !v2) return;

      const s01 = edgesToSplit.has(edgeKey(i0, i1));
      const s12 = edgesToSplit.has(edgeKey(i1, i2));
      const s20 = edgesToSplit.has(edgeKey(i2, i0));

      if (s01 && s12 && s20) {
        const m01 = getMidpoint(i0, i1);
        const m12 = getMidpoint(i1, i2);
        const m20 = getMidpoint(i2, i0);
        newFaces.push({ indices: [i0, m01, m20] });
        newFaces.push({ indices: [i1, m12, m01] });
        newFaces.push({ indices: [i2, m20, m12] });
        newFaces.push({ indices: [m01, m12, m20] });
      } else if (s01 && s12) {
        const m01 = getMidpoint(i0, i1);
        const m12 = getMidpoint(i1, i2);
        newFaces.push({ indices: [i0, m01, i2] });
        newFaces.push({ indices: [m01, i1, m12] });
        newFaces.push({ indices: [m01, m12, i2] });
      } else if (s12 && s20) {
        const m12 = getMidpoint(i1, i2);
        const m20 = getMidpoint(i2, i0);
        newFaces.push({ indices: [i1, m12, i0] });
        newFaces.push({ indices: [m12, i2, m20] });
        newFaces.push({ indices: [m12, m20, i0] });
      } else if (s20 && s01) {
        const m20 = getMidpoint(i2, i0);
        const m01 = getMidpoint(i0, i1);
        newFaces.push({ indices: [i2, m20, i1] });
        newFaces.push({ indices: [m20, i0, m01] });
        newFaces.push({ indices: [m20, m01, i1] });
      } else if (s01) {
        const m01 = getMidpoint(i0, i1);
        newFaces.push({ indices: [i0, m01, i2] });
        newFaces.push({ indices: [m01, i1, i2] });
      } else if (s12) {
        const m12 = getMidpoint(i1, i2);
        newFaces.push({ indices: [i1, m12, i0] });
        newFaces.push({ indices: [m12, i2, i0] });
      } else if (s20) {
        const m20 = getMidpoint(i2, i0);
        newFaces.push({ indices: [i2, m20, i1] });
        newFaces.push({ indices: [m20, i0, i1] });
      } else {
        newFaces.push(f);
      }
    });

    faces = newFaces;

    // ─── PASO 3: Relajación tangencial para equilibrar ángulos ───
    const regResult = regularizeMeshTopology(
      { vertices: verts, faces },
      { strength: 0.60, iterations: 1, featureAngleDeg: 40 }
    );
    verts = regResult.vertices;
    faces = regResult.faces;
  }

  // Si tras el proceso el número de caras superase el presupuesto estricto, simplificar geométricamente con Meshopt
  // NUNCA rebanar caras aleatoriamente (slicing) porque crearía agujeros en la malla
  if (faces.length > maxAllowedFaces) {
    try {
      const posFlat = new Float32Array(verts.length * 3);
      for (let i = 0; i < verts.length; i++) {
        posFlat[i * 3] = verts[i][0];
        posFlat[i * 3 + 1] = verts[i][1];
        posFlat[i * 3 + 2] = verts[i][2];
      }
      const idxFlat = new Uint32Array(faces.length * 3);
      for (let i = 0; i < faces.length; i++) {
        idxFlat[i * 3] = faces[i].indices[0];
        idxFlat[i * 3 + 1] = faces[i].indices[1];
        idxFlat[i * 3 + 2] = faces[i].indices[2];
      }
      const targetCount = maxAllowedFaces * 3;
      const res = MeshoptSimplifier.simplify(idxFlat, posFlat, 3, targetCount, 0.02, ['LockBorder'] as any);
      if (res && res[0] && res[0].length >= 12 && res[0].length <= idxFlat.length) {
        const simpIdx = res[0];
        const newF: MeshFace[] = [];
        for (let i = 0; i < simpIdx.length; i += 3) {
          newF.push({ indices: [simpIdx[i], simpIdx[i + 1], simpIdx[i + 2]] });
        }
        faces = newF;
      }
    } catch (e) {
      console.warn('Meshopt simplification fallback en isotropicRemesh:', e);
    }
  }

  const finalClean = repairMesh({ vertices: verts, faces });
  const finalFaceCount = finalClean.faces.length;
  const diff = finalFaceCount - initialFaceCount;
  const diffStr = diff <= 0 ? `(${finalFaceCount.toLocaleString()} caras · 0 caras extra)` : `(${finalFaceCount.toLocaleString()} caras)`;

  return {
    vertices: finalClean.vertices,
    faces: finalClean.faces,
    report: [`Remallado isótropo uniforme completado ${diffStr}`]
  };
}

/**
 * Dissolves coplanar adjacent triangles into simplified, clean planar quad/polygon surfaces.
 * Identifies connected planar regions, removes redundant interior vertices and collinear boundary vertices,
 * and re-triangulates flat surfaces with minimal polygon density (like Blender's Limited Dissolve).
 */
export interface PlanarDecimationOptions {
  angleToleranceDeg?: number;
  snapToPlane?: boolean;
  collinearToleranceDeg?: number;
  maxPlaneDistRatio?: number;
}

export function flattenAndSimplifyPlanarFaces(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  options: PlanarDecimationOptions = {}
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const {
    angleToleranceDeg = 12.0,
    snapToPlane = true,
    collinearToleranceDeg = 4.5,
    maxPlaneDistRatio = 0.015
  } = options;

  return dissolveCoplanarFaces(obj, angleToleranceDeg, {
    snapToPlane,
    collinearToleranceDeg,
    maxPlaneDistRatio
  });
}

export function dissolveCoplanarFaces(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  angleToleranceDeg: number = 4.0,
  extraOptions?: { snapToPlane?: boolean; collinearToleranceDeg?: number; maxPlaneDistRatio?: number }
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const hadUVs = ((obj as any).faces && (obj as any).faces.some((f: MeshFace) => f.uvs && f.uvs.length > 0)) || false;
  let vertices: V3[];
  let inputFaces: MeshFace[];

  if (hadUVs) {
    // Para mallas con texturas/UVs: NO soldar vértices ciegamente por distancia 3D,
    // ya que eso funde vértices a ambos lados de las costuras UV y destruye el texturizado.
    vertices = (obj.vertices || []).map((v, i) => {
      const off = (obj as any).vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });
    inputFaces = (obj.faces || []).filter(f => f.indices && f.indices.length >= 3);
  } else {
    const repaired = repairMesh(obj);
    vertices = repaired.vertices;
    inputFaces = repaired.faces;
  }

  if (vertices.length === 0 || inputFaces.length === 0) {
    return { vertices, faces: inputFaces, report: ['Malla sin caras'] };
  }

  const snapToPlane = extraOptions?.snapToPlane ?? false;
  const collinearTolDeg = extraOptions?.collinearToleranceDeg ?? Math.max(4.0, angleToleranceDeg * 0.6);
  const maxPlaneDistRatio = extraOptions?.maxPlaneDistRatio ?? 0.001;

  // Convert any quads or n-gons into uniform triangles first with UV tracking
  interface TriFaceItem {
    indices: [number, number, number];
    uvs?: [number, number][];
    materialIndex?: number;
  }
  const triFaces: TriFaceItem[] = [];
  inputFaces.forEach(f => {
    if (f.indices.length === 3) {
      triFaces.push({
        indices: [f.indices[0], f.indices[1], f.indices[2]],
        uvs: f.uvs && f.uvs.length >= 3 ? [f.uvs[0], f.uvs[1], f.uvs[2]] : undefined,
        materialIndex: f.materialIndex
      });
    } else if (f.indices.length > 3) {
      for (let i = 1; i < f.indices.length - 1; i++) {
        triFaces.push({
          indices: [f.indices[0], f.indices[i], f.indices[i + 1]],
          uvs: f.uvs && f.uvs.length >= f.indices.length ? [f.uvs[0], f.uvs[i], f.uvs[i + 1]] : undefined,
          materialIndex: f.materialIndex
        });
      }
    }
  });

  const numFaces = triFaces.length;
  const vertVectors = vertices.map(v => new THREE.Vector3(v[0], v[1], v[2]));

  // Compute bounding box diagonal to scale distance tolerances appropriately
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  vertVectors.forEach(v => {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  });
  const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
  const maxPlaneDist = Math.max(1e-4, bboxDiag * maxPlaneDistRatio);

  const cosAngleTol = Math.cos((angleToleranceDeg * Math.PI) / 180);

  // Mapeo canónico espacial para identificar aristas compartidas incluso con vértices desoldados
  const quant = Math.max(200, Math.min(60000, Math.round(3000 / bboxDiag)));
  const spatialMap = new Map<string, number>();
  const canVert: number[] = new Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const key = `${Math.round(v[0] * quant)}_${Math.round(v[1] * quant)}_${Math.round(v[2] * quant)}`;
    let c = spatialMap.get(key);
    if (c === undefined) {
      c = i;
      spatialMap.set(key, c);
    }
    canVert[i] = c;
  }

  // Compute normals, areas, and plane offsets for each triangle
  const fNormals: THREE.Vector3[] = [];
  const fAreas: number[] = [];
  const fCenters: THREE.Vector3[] = [];
  const fPlaneD: number[] = [];

  const cb = new THREE.Vector3(), ab = new THREE.Vector3();
  triFaces.forEach(({ indices: [i0, i1, i2] }) => {
    const p0 = vertVectors[i0], p1 = vertVectors[i1], p2 = vertVectors[i2];
    cb.subVectors(p2, p1);
    ab.subVectors(p0, p1);
    const cross = new THREE.Vector3().crossVectors(cb, ab);
    const area = cross.length() * 0.5;
    const norm = area > 1e-12 ? cross.normalize() : new THREE.Vector3(0, 1, 0);
    const center = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
    const d = norm.dot(p0);

    fNormals.push(norm);
    fAreas.push(area);
    fCenters.push(center);
    fPlaneD.push(d);
  });

  // Build vertex-to-face adjacency map to protect shared boundary vertices
  const vertToFaces = new Map<number, Set<number>>();
  triFaces.forEach(({ indices: [i0, i1, i2] }, fIdx) => {
    [i0, i1, i2].forEach(v => {
      let set = vertToFaces.get(v);
      if (!set) { set = new Set(); vertToFaces.set(v, set); }
      set.add(fIdx);
    });
  });

  // Build edge-to-face adjacency map utilizando índices canónicos espaciales
  const edgeToFaces = new Map<string, number[]>();
  triFaces.forEach(({ indices: [i0, i1, i2] }, fIdx) => {
    const c0 = canVert[i0] ?? i0;
    const c1 = canVert[i1] ?? i1;
    const c2 = canVert[i2] ?? i2;
    const edges = [
      c0 < c1 ? `${c0}_${c1}` : `${c1}_${c0}`,
      c1 < c2 ? `${c1}_${c2}` : `${c2}_${c1}`,
      c2 < c0 ? `${c2}_${c0}` : `${c0}_${c2}`,
    ];
    edges.forEach(k => {
      let list = edgeToFaces.get(k);
      if (!list) { list = []; edgeToFaces.set(k, list); }
      list.push(fIdx);
    });
  });

  // Cluster connected coplanar faces using Disjoint Set Union (DSU)
  const parent = Array.from({ length: numFaces }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i: number, j: number) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  };

  edgeToFaces.forEach((facesWithEdge) => {
    if (facesWithEdge.length >= 2) {
      for (let i = 0; i < facesWithEdge.length; i++) {
        for (let j = i + 1; j < facesWithEdge.length; j++) {
          const fA = facesWithEdge[i];
          const fB = facesWithEdge[j];

          // Never cluster across different material IDs
          if (triFaces[fA].materialIndex !== triFaces[fB].materialIndex) continue;

          // Never cluster across UV seams
          const uvA = triFaces[fA].uvs;
          const uvB = triFaces[fB].uvs;
          if (uvA && uvB) {
            const indA = triFaces[fA].indices;
            const indB = triFaces[fB].indices;
            let uvMatch = true;
            for (let vA = 0; vA < 3; vA++) {
              const idxA = indA[vA];
              const vB = indB.indexOf(idxA);
              if (vB !== -1) {
                const uDiff = Math.abs(uvA[vA][0] - uvB[vB][0]);
                const vDiff = Math.abs(uvA[vA][1] - uvB[vB][1]);
                if (uDiff > 0.005 || vDiff > 0.005) {
                  uvMatch = false;
                  break;
                }
              }
            }
            if (!uvMatch) continue;
          }

          const nA = fNormals[fA];
          const nB = fNormals[fB];

          if (nA && nB && nA.dot(nB) >= cosAngleTol) {
            // Check plane distance: center of B relative to plane A, and vice-versa
            const distBtoA = Math.abs(nA.dot(fCenters[fB]) - fPlaneD[fA]);
            const distAtoB = Math.abs(nB.dot(fCenters[fA]) - fPlaneD[fB]);
            const allowedDist = Math.max(maxPlaneDist, Math.max(Math.sqrt(fAreas[fA] || 0.01), Math.sqrt(fAreas[fB] || 0.01)) * Math.sin((Math.max(1, angleToleranceDeg) * Math.PI) / 180));
            if (distBtoA <= allowedDist && distAtoB <= allowedDist) {
              union(fA, fB);
            }
          }
        }
      }
    }
  });

  // Group face indices by cluster root
  const clusters = new Map<number, number[]>();
  for (let f = 0; f < numFaces; f++) {
    const root = find(f);
    let list = clusters.get(root);
    if (!list) { list = []; clusters.set(root, list); }
    list.push(f);
  }

  // Pre-pass: Compute cluster planes and snap planar vertices to eliminate voxel waviness
  const clusterPlanes = new Map<number, { normal: THREE.Vector3; center: THREE.Vector3; d: number }>();
  if (snapToPlane) {
    clusters.forEach((faceIndices, root) => {
      if (faceIndices.length < 2) return;
      const cNormal = new THREE.Vector3();
      const cCenter = new THREE.Vector3();
      let totalArea = 0;

      faceIndices.forEach(fi => {
        const a = fAreas[fi];
        cNormal.addScaledVector(fNormals[fi], a);
        cCenter.addScaledVector(fCenters[fi], a);
        totalArea += a;
      });

      if (totalArea > 1e-12 && cNormal.lengthSq() > 1e-12) {
        cNormal.normalize();
        cCenter.multiplyScalar(1 / totalArea);
        const d = cNormal.dot(cCenter);
        clusterPlanes.set(root, { normal: cNormal, center: cCenter, d });
      }
    });

    // Map vertex to all clusters it belongs to
    const vertClusters = new Map<number, Set<number>>();
    clusters.forEach((faceIndices, root) => {
      faceIndices.forEach(fi => {
        const [i0, i1, i2] = triFaces[fi].indices;
        [i0, i1, i2].forEach(v => {
          let s = vertClusters.get(v);
          if (!s) { s = new Set(); vertClusters.set(v, s); }
          s.add(root);
        });
      });
    });

    // Snap vertices to cluster plane (or intersection of planes)
    vertClusters.forEach((cSet, vIdx) => {
      const p = vertVectors[vIdx];
      const validPlanes = Array.from(cSet)
        .map(root => clusterPlanes.get(root))
        .filter((pl): pl is { normal: THREE.Vector3; center: THREE.Vector3; d: number } => !!pl);

      if (validPlanes.length === 1) {
        // Project vertex onto single plane
        const pl = validPlanes[0];
        const dist = pl.normal.dot(p) - pl.d;
        if (Math.abs(dist) <= maxPlaneDist * 1.5) {
          p.addScaledVector(pl.normal, -dist);
          vertices[vIdx] = [p.x, p.y, p.z];
        }
      } else if (validPlanes.length === 2) {
        // Vertex lies on sharp edge between 2 planar clusters: project onto the intersection line
        const pl1 = validPlanes[0];
        const pl2 = validPlanes[1];
        const cross = new THREE.Vector3().crossVectors(pl1.normal, pl2.normal);
        if (cross.lengthSq() > 0.05) { // Non-parallel planes
          const dist1 = pl1.normal.dot(p) - pl1.d;
          const dist2 = pl2.normal.dot(p) - pl2.d;
          if (Math.abs(dist1) <= maxPlaneDist * 1.5 && Math.abs(dist2) <= maxPlaneDist * 1.5) {
            const n1 = pl1.normal, n2 = pl2.normal;
            const dot12 = n1.dot(n2);
            const denom = 1 - dot12 * dot12;
            if (denom > 1e-4) {
              const k1 = (dist1 - dist2 * dot12) / denom;
              const k2 = (dist2 - dist1 * dot12) / denom;
              p.sub(new THREE.Vector3().addScaledVector(n1, k1).addScaledVector(n2, k2));
              vertices[vIdx] = [p.x, p.y, p.z];
            }
          }
        }
      }
    });
  }

  // 2D Ear Clipping Triangulator Helper
  const triangulate2D = (points2D: { x: number; y: number }[]): [number, number, number][] => {
    const n = points2D.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];
    if (n === 4) {
      // Quad fast convex split
      const cross1 = (points2D[1].x - points2D[0].x) * (points2D[2].y - points2D[1].y) - (points2D[1].y - points2D[0].y) * (points2D[2].x - points2D[1].x);
      const cross2 = (points2D[2].x - points2D[1].x) * (points2D[3].y - points2D[2].y) - (points2D[2].y - points2D[1].y) * (points2D[3].x - points2D[2].x);
      const cross3 = (points2D[3].x - points2D[2].x) * (points2D[0].y - points2D[3].y) - (points2D[3].y - points2D[2].y) * (points2D[0].x - points2D[3].x);
      const cross4 = (points2D[0].x - points2D[3].x) * (points2D[1].y - points2D[0].y) - (points2D[0].y - points2D[3].y) * (points2D[1].x - points2D[0].x);
      const isConvex = (cross1 > 0 && cross2 > 0 && cross3 > 0 && cross4 > 0) || (cross1 < 0 && cross2 < 0 && cross3 < 0 && cross4 < 0);
      if (isConvex) {
        return [[0, 1, 2], [0, 2, 3]];
      }
    }

    // Compute polygon signed area
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      signedArea += points2D[i].x * points2D[j].y - points2D[j].x * points2D[i].y;
    }
    const isCCW = signedArea > 0;

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
        // Fallback: fan clip from index 0
        const prev = indices[count - 1];
        const curr = indices[0];
        const next = indices[1];
        tris.push([prev, curr, next]);
        indices.splice(0, 1);
        count--;
      }
    }

    if (indices.length === 3) {
      tris.push([indices[0], indices[1], indices[2]]);
    }

    return tris;
  };

  const finalFaces: MeshFace[] = [];
  let simplifiedClusterCount = 0;

  // 1. Pre-extract boundary loops and UVs for all clusters
  interface ClusterInfo {
    root: number;
    faceIndices: number[];
    loops: number[][];
    clusterNormal: THREE.Vector3;
    U: THREE.Vector3;
    V: THREE.Vector3;
    vertUVMap: Map<number, [number, number]>;
    affineEvaluator: ((x: number, y: number) => [number, number]) | null;
  }

  const clusterInfoList: ClusterInfo[] = [];

  clusters.forEach((faceIndices, root) => {
    if (faceIndices.length <= 1) return;

    // Multi-triangle cluster: extract directed boundary edges using canonical spatial vertices
    const directedEdgeCount = new Map<string, { from: number; to: number; count: number }>();
    faceIndices.forEach(fi => {
      const [i0, i1, i2] = triFaces[fi].indices;
      const c0 = canVert[i0] ?? i0;
      const c1 = canVert[i1] ?? i1;
      const c2 = canVert[i2] ?? i2;
      const triHalfEdges = [[c0, c1], [c1, c2], [c2, c0]];
      triHalfEdges.forEach(([u, v]) => {
        if (u === v) return;
        const key = `${u}_${v}`;
        const existing = directedEdgeCount.get(key);
        if (existing) existing.count++;
        else directedEdgeCount.set(key, { from: u, to: v, count: 1 });
      });
    });

    const boundaryHalfEdges: { from: number; to: number }[] = [];
    directedEdgeCount.forEach(({ from: u, to: v, count }) => {
      const rev = directedEdgeCount.get(`${v}_${u}`);
      if (!rev) {
        for (let c = 0; c < count; c++) boundaryHalfEdges.push({ from: u, to: v });
      }
    });

    if (boundaryHalfEdges.length < 3) return;

    const adjOut = new Map<number, number[]>();
    boundaryHalfEdges.forEach(({ from: u, to: v }) => {
      let list = adjOut.get(u);
      if (!list) { list = []; adjOut.set(u, list); }
      list.push(v);
    });

    const visitedEdges = new Set<string>();
    const loops: number[][] = [];

    boundaryHalfEdges.forEach(({ from: startU }) => {
      const outList = adjOut.get(startU);
      if (!outList) return;

      for (const startV of outList) {
        const edgeKey = `${startU}_${startV}`;
        if (visitedEdges.has(edgeKey)) continue;

        const loop: number[] = [startU];
        visitedEdges.add(edgeKey);
        let curr = startV;
        let safety = 0;
        const maxSafety = boundaryHalfEdges.length * 2;

        while (curr !== startU && safety < maxSafety) {
          safety++;
          loop.push(curr);
          const nextTargets = adjOut.get(curr);
          if (!nextTargets || nextTargets.length === 0) break;

          let foundNext = -1;
          for (const nextV of nextTargets) {
            const nextKey = `${curr}_${nextV}`;
            if (!visitedEdges.has(nextKey)) {
              visitedEdges.add(nextKey);
              foundNext = nextV;
              break;
            }
          }
          if (foundNext === -1) break;
          curr = foundNext;
        }

        if (loop.length >= 3 && curr === startU) {
          loops.push(loop);
        }
      }
    });

    if (loops.length === 0) return;

    const clusterNormal = new THREE.Vector3();
    faceIndices.forEach(fi => {
      clusterNormal.addScaledVector(fNormals[fi], fAreas[fi]);
    });
    if (clusterNormal.lengthSq() > 1e-12) clusterNormal.normalize();
    else clusterNormal.set(0, 1, 0);

    let U = new THREE.Vector3();
    if (Math.abs(clusterNormal.y) < 0.9) {
      U.crossVectors(clusterNormal, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      U.crossVectors(clusterNormal, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const V = new THREE.Vector3().crossVectors(clusterNormal, U).normalize();

    const vertUVMap = new Map<number, [number, number]>();
    faceIndices.forEach(fi => {
      const tf = triFaces[fi];
      if (tf.uvs && tf.uvs.length === 3) {
        vertUVMap.set(tf.indices[0], tf.uvs[0]);
        vertUVMap.set(tf.indices[1], tf.uvs[1]);
        vertUVMap.set(tf.indices[2], tf.uvs[2]);
      }
    });

    let affineEvaluator: ((x: number, y: number) => [number, number]) | null = null;
    if (vertUVMap.size >= 3) {
      const knownEntries = Array.from(vertUVMap.entries());
      for (let i = 0; i < knownEntries.length && !affineEvaluator; i++) {
        for (let j = i + 1; j < knownEntries.length && !affineEvaluator; j++) {
          for (let k = j + 1; k < knownEntries.length && !affineEvaluator; k++) {
            const [v0, uv0] = knownEntries[i];
            const [v1, uv1] = knownEntries[j];
            const [v2, uv2] = knownEntries[k];
            const p0 = vertVectors[v0], p1 = vertVectors[v1], p2 = vertVectors[v2];
            const x0 = p0.dot(U), y0 = p0.dot(V);
            const x1 = p1.dot(U), y1 = p1.dot(V);
            const x2 = p2.dot(U), y2 = p2.dot(V);
            const dx1 = x1 - x0, dy1 = y1 - y0;
            const dx2 = x2 - x0, dy2 = y2 - y0;
            const det = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(det) > 1e-7) {
              const du1 = uv1[0] - uv0[0], dv1 = uv1[1] - uv0[1];
              const du2 = uv2[0] - uv0[0], dv2 = uv2[1] - uv0[1];
              const invDet = 1 / det;
              const au = (du1 * dy2 - du2 * dy1) * invDet;
              const bu = (du2 * dx1 - du1 * dx2) * invDet;
              const av = (dv1 * dy2 - dv2 * dy1) * invDet;
              const bv = (dv2 * dx1 - dv1 * dx2) * invDet;
              affineEvaluator = (x: number, y: number): [number, number] => {
                const u = uv0[0] + au * (x - x0) + bu * (y - y0);
                const v = uv0[1] + av * (x - x0) + bv * (y - y0);
                return [u, v];
              };
            }
          }
        }
      }
    }

    clusterInfoList.push({
      root,
      faceIndices,
      loops,
      clusterNormal,
      U,
      V,
      vertUVMap,
      affineEvaluator
    });
  });

  // 2. Colapso de vértices colineales de grado 2 en bucles perimetrales
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

    if (perimeterDegree === 2 && hasOnlyDissolvedFaces && loopsWithV.every(l => vertIsCollinearInLoop(v, l))) {
      removableVerts.add(v);
    }
  });

  // 3. Process each cluster into faces
  const processedRoots = new Set<number>();

  clusterInfoList.forEach(ci => {
    processedRoots.add(ci.root);
    const { faceIndices, loops, clusterNormal, U, V, vertUVMap, affineEvaluator } = ci;

    const getVertexUV = (vIdx: number): [number, number] | undefined => {
      if (vertUVMap.has(vIdx)) return vertUVMap.get(vIdx)!;
      if (affineEvaluator) {
        const p = vertVectors[vIdx];
        return affineEvaluator(p.dot(U), p.dot(V));
      }
      return undefined;
    };

    const hasAnyUV = vertUVMap.size > 0;
    const clusterMat = triFaces[faceIndices[0]]?.materialIndex;
    const clusterNewFaces: MeshFace[] = [];

    loops.forEach(rawLoop => {
      const simplifiedLoop = rawLoop.filter(v => !removableVerts.has(v));
      if (simplifiedLoop.length < 3) return;

      // Compute normal of simplified loop using Newell's method
      const loopNormal = new THREE.Vector3(0, 0, 0);
      const n = simplifiedLoop.length;
      for (let i = 0; i < n; i++) {
        const p1 = vertVectors[simplifiedLoop[i]];
        const p2 = vertVectors[simplifiedLoop[(i + 1) % n]];
        loopNormal.x += (p1.y - p2.y) * (p1.z + p2.z);
        loopNormal.y += (p1.z - p2.z) * (p1.x + p2.x);
        loopNormal.z += (p1.x - p2.x) * (p1.y + p2.y);
      }
      if (loopNormal.lengthSq() > 1e-12) loopNormal.normalize();

      const orientedIndices = loopNormal.dot(clusterNormal) >= 0
        ? [...simplifiedLoop]
        : [...simplifiedLoop].reverse();

      if (orientedIndices.length === 3 || orientedIndices.length === 4) {
        clusterNewFaces.push({
          indices: orientedIndices,
          uvs: hasAnyUV ? orientedIndices.map(vi => getVertexUV(vi) || [0, 0]) : undefined,
          materialIndex: clusterMat
        });
      } else {
        // N-gons: 2D planar ear-clipping triangulator, then pair triangles into quads!
        const pts2D = orientedIndices.map(vi => {
          const p = vertVectors[vi];
          return { x: p.dot(U), y: p.dot(V) };
        });
        const triIndices = triangulate2D(pts2D);
        if (triIndices.length > 0) {
          const subTris: TriangleFace[] = triIndices.map(([t0, t1, t2]) => ({
            indices: [orientedIndices[t0], orientedIndices[t1], orientedIndices[t2]] as [number, number, number],
            uvs: hasAnyUV ? [orientedIndices[t0], orientedIndices[t1], orientedIndices[t2]].map(vi => getVertexUV(vi) || [0, 0]) : undefined,
            materialIndex: clusterMat
          }));

          // Try merging pairs of triangles into clean quads
          const flatPosLocal: number[] = [];
          for (let vi = 0; vi < vertices.length; vi++) {
            flatPosLocal.push(vertices[vi][0], vertices[vi][1], vertices[vi][2]);
          }
          const quadPairRes = pairTrianglesIntoQuads(subTris, new Float32Array(flatPosLocal), {
            preserveCreases: true,
            creaseAngleDeg: 1.0
          });

          quadPairRes.quads.forEach(q => {
            clusterNewFaces.push({
              indices: [q[0], q[1], q[2], q[3]],
              uvs: hasAnyUV ? [q[0], q[1], q[2], q[3]].map(vi => getVertexUV(vi) || [0, 0]) : undefined,
              materialIndex: clusterMat
            });
          });

          quadPairRes.remainingTris.forEach(t => {
            clusterNewFaces.push({
              indices: [t[0], t[1], t[2]],
              uvs: hasAnyUV ? [t[0], t[1], t[2]].map(vi => getVertexUV(vi) || [0, 0]) : undefined,
              materialIndex: clusterMat
            });
          });
        } else {
          clusterNewFaces.push({
            indices: orientedIndices,
            uvs: hasAnyUV ? orientedIndices.map(vi => getVertexUV(vi) || [0, 0]) : undefined,
            materialIndex: clusterMat
          });
        }
      }
    });

    // STRICT CHECK: Only accept simplification if it actually reduced the face count!
    if (clusterNewFaces.length > 0 && clusterNewFaces.length < faceIndices.length) {
      clusterNewFaces.forEach(f => finalFaces.push(f));
      simplifiedClusterCount++;
    } else {
      faceIndices.forEach(fi => finalFaces.push({
        indices: [...triFaces[fi].indices],
        uvs: triFaces[fi].uvs ? [...triFaces[fi].uvs!] : undefined,
        materialIndex: triFaces[fi].materialIndex
      }));
    }
  });

  // Keep all unsimplified clusters and single triangles
  clusters.forEach((faceIndices, root) => {
    if (!processedRoots.has(root)) {
      faceIndices.forEach(fi => finalFaces.push({
        indices: [...triFaces[fi].indices],
        uvs: triFaces[fi].uvs ? [...triFaces[fi].uvs!] : undefined,
        materialIndex: triFaces[fi].materialIndex
      }));
    }
  });

  let cleanVertices = vertices;
  let cleanFaces = finalFaces;
  if (!hadUVs) {
    const clean = repairMesh({ vertices, faces: finalFaces });
    cleanVertices = clean.vertices;
    cleanFaces = clean.faces;
  } else {
    // Para mallas con texturas/UVs: eliminar solo caras degeneradas (índices idénticos) sin soldar vértices entre costuras UV
    cleanFaces = finalFaces.filter(f => {
      if (!f.indices || f.indices.length < 3) return false;
      const [i0, i1, i2] = f.indices;
      return i0 !== i1 && i1 !== i2 && i2 !== i0;
    });
  }

  const initialCount = triFaces.length;
  const finalCount = cleanFaces.length;
  const savedFaces = Math.max(0, initialCount - finalCount);
  const reductionPct = initialCount > 0 ? Math.round((savedFaces / initialCount) * 100) : 0;

  return {
    vertices: cleanVertices,
    faces: cleanFaces,
    report: [
      `Disueltas caras coplanares en ${simplifiedClusterCount} superficies planas`,
      `De ${initialCount.toLocaleString()} a ${finalCount.toLocaleString()} caras (-${reductionPct}%)`
    ]
  };
}

// Exportación canónica de la utilidad Limited Dissolve BMesh
export { limitedDissolve, limitedDissolveGeometry } from './limitedDissolve';
export type { LimitedDissolveOptions, LimitedDissolveResult } from './limitedDissolve';

/**
 * ─── HERRAMIENTAS DE LIMPIEZA (CLEAN UP ESTILO BLENDER) ─────────────────────────
 */

/**
 * 1. Delete Loose (Borrar sueltos):
 * Elimina vértices o aristas flotantes/huérfanos que no forman ninguna cara en el modelo.
 */
export function deleteLooseElements(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] }
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  if (!obj.vertices || obj.vertices.length === 0) {
    return { vertices: [], faces: [], report: ['Sin vértices en el objeto'] };
  }
  const used = new Set<number>();
  for (const f of obj.faces || []) {
    for (const i of f.indices) {
      if (i >= 0 && i < obj.vertices.length) used.add(i);
    }
  }
  const looseCount = obj.vertices.length - used.size;
  const compact: number[] = new Array(obj.vertices.length).fill(-1);
  const finalVerts: V3[] = [];
  for (let i = 0; i < obj.vertices.length; i++) {
    if (used.has(i)) {
      compact[i] = finalVerts.length;
      finalVerts.push([...obj.vertices[i]] as V3);
    }
  }
  const finalFaces = (obj.faces || []).map(f => ({
    ...f,
    indices: f.indices.map(i => compact[i]).filter(i => i !== -1)
  })).filter(f => f.indices.length >= 3);

  return {
    vertices: finalVerts,
    faces: finalFaces,
    report: looseCount > 0 ? [`${looseCount} vértice(s) suelto(s) o aislado(s) eliminado(s)`] : ['No se encontraron vértices sueltos']
  };
}

/**
 * 2. Degenerate Dissolve:
 * Elimina caras o aristas de área cero o colapsadas que no aportan geometría real al modelo.
 */
export function dissolveDegenerateElements(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  minArea: number = 1e-7
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  if (!obj.vertices || obj.vertices.length === 0) {
    return { vertices: [], faces: [], report: ['Sin vértices'] };
  }
  const verts = obj.vertices;
  let degenerateCount = 0;
  const keptFaces: MeshFace[] = [];

  for (const f of obj.faces || []) {
    if (!f.indices || f.indices.length < 3) {
      degenerateCount++;
      continue;
    }
    const filtered: number[] = [];
    for (let k = 0; k < f.indices.length; k++) {
      const idx = f.indices[k];
      if (k === 0 || idx !== f.indices[k - 1]) filtered.push(idx);
    }
    if (filtered.length > 1 && filtered[0] === filtered[filtered.length - 1]) filtered.pop();
    if (filtered.length < 3) {
      degenerateCount++;
      continue;
    }

    // Calcular área poligonal en 3D
    let totalArea = 0;
    const p0 = verts[filtered[0]];
    if (!p0) { degenerateCount++; continue; }
    for (let i = 1; i < filtered.length - 1; i++) {
      const p1 = verts[filtered[i]];
      const p2 = verts[filtered[i + 1]];
      if (!p1 || !p2) continue;
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      totalArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    }

    if (totalArea <= minArea || isNaN(totalArea)) {
      degenerateCount++;
      continue;
    }

    keptFaces.push({ ...f, indices: filtered });
  }

  const looseClean = deleteLooseElements({ vertices: verts, faces: keptFaces });
  return {
    vertices: looseClean.vertices,
    faces: looseClean.faces,
    report: degenerateCount > 0 ? [`${degenerateCount} cara(s) degeneradas o con área nula disuelta(s)`] : ['No se detectaron caras degeneradas']
  };
}

/**
 * 3. Merge Vertices by Distance (Fusionar por distancia):
 * Fusión limpia de vértices idénticos o separados por menos del radio de tolerancia.
 */
export function mergeVerticesByDistance(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[]; vertexOffsets?: Record<number, V3> },
  distance: number = 0.001
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  return repairMesh(obj, distance);
}

/**
 * 4. Dissolve Selected Vertices:
 * Disuelve vértices sin romper la malla, fusionando los bucles de caras incidentes.
 */
export function dissolveSelectedVertices(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  selectedVertIndices: number[]
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  if (!selectedVertIndices || selectedVertIndices.length === 0) {
    return { vertices: obj.vertices || [], faces: obj.faces || [], report: ['No hay vértices seleccionados para disolver'] };
  }
  const toDissolve = new Set(selectedVertIndices);
  const newFaces: MeshFace[] = [];
  let dissolvedCount = 0;

  for (const face of obj.faces || []) {
    const hasDissolved = face.indices.some(i => toDissolve.has(i));
    if (!hasDissolved) {
      newFaces.push(face);
      continue;
    }
    const filteredIndices = face.indices.filter(i => !toDissolve.has(i));
    if (filteredIndices.length >= 3) {
      dissolvedCount++;
      newFaces.push({
        ...face,
        indices: filteredIndices,
        uvs: face.uvs ? face.uvs.filter((_, idx) => !toDissolve.has(face.indices[idx])) : undefined
      });
    } else {
      dissolvedCount++;
      // Si el triángulo queda colapsado por disolver uno de sus vértices, se absorbe en el conjunto
    }
  }

  const clean = repairMesh({ vertices: obj.vertices || [], faces: newFaces }, 0.00001);
  return {
    vertices: clean.vertices,
    faces: clean.faces,
    report: [`${dissolvedCount} vértice(s) disuelto(s) integrando la geometría adyacente`]
  };
}

/**
 * 5. Dissolve Selected Faces:
 * Disuelve las caras seleccionadas fusionándolas en un polígono continuo eliminando bordes internos.
 */
export function dissolveSelectedFaces(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  selectedFaceIndices: number[]
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  if (!selectedFaceIndices || selectedFaceIndices.length === 0) {
    return { vertices: obj.vertices || [], faces: obj.faces || [], report: ['No hay caras seleccionadas para disolver'] };
  }
  const selSet = new Set(selectedFaceIndices);
  const facesToKeep = (obj.faces || []).filter((_, idx) => !selSet.has(idx));
  const facesToDissolve = (obj.faces || []).filter((_, idx) => selSet.has(idx));

  // Extraer aristas de las caras seleccionadas
  const edgeCount = new Map<string, { a: number; b: number; count: number }>();
  for (const f of facesToDissolve) {
    const len = f.indices.length;
    for (let i = 0; i < len; i++) {
      const a = f.indices[i], b = f.indices[(i + 1) % len];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const e = edgeCount.get(key) || { a, b, count: 0 };
      e.count++;
      edgeCount.set(key, e);
    }
  }

  // Las aristas que aparecen 1 sola vez forman el contorno exterior
  const boundaryEdges = Array.from(edgeCount.values()).filter(e => e.count === 1);
  if (boundaryEdges.length >= 3) {
    // Encadenar aristas en un bucle
    const adj = new Map<number, number>();
    for (const f of facesToDissolve) {
      const len = f.indices.length;
      for (let i = 0; i < len; i++) {
        const a = f.indices[i], b = f.indices[(i + 1) % len];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (edgeCount.get(key)?.count === 1) {
          adj.set(a, b);
        }
      }
    }

    const startNode = boundaryEdges[0].a;
    const loop: number[] = [startNode];
    let curr = adj.get(startNode);
    const visited = new Set<number>([startNode]);
    while (curr !== undefined && !visited.has(curr) && loop.length <= boundaryEdges.length) {
      loop.push(curr);
      visited.add(curr);
      curr = adj.get(curr);
    }

    if (loop.length >= 3) {
      facesToKeep.push({
        indices: loop,
        materialIndex: facesToDissolve[0]?.materialIndex
      });
    }
  }

  const clean = repairMesh({ vertices: obj.vertices || [], faces: facesToKeep }, 0.00001);
  return {
    vertices: clean.vertices,
    faces: clean.faces,
    report: [`${selectedFaceIndices.length} cara(s) seleccionadas disueltas en un único polígono unificado`]
  };
}

/**
 * 6. Collapse Selected Elements:
 * Colapsa vértices, aristas o caras seleccionadas en su baricentro / centroide común.
 */
export function collapseSelectedElements(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  selection: { vertexIndices?: number[]; edgeIndices?: number[]; faceIndices?: number[] }
): { vertices: V3[]; faces: MeshFace[]; report: string[] } {
  const affected = new Set<number>();
  const verts = obj.vertices || [];

  if (selection.vertexIndices) {
    selection.vertexIndices.forEach(i => affected.add(i));
  }
  if (selection.edgeIndices) {
    for (let i = 0; i < selection.edgeIndices.length; i += 2) {
      affected.add(selection.edgeIndices[i]);
      affected.add(selection.edgeIndices[i + 1]);
    }
  }
  if (selection.faceIndices) {
    selection.faceIndices.forEach(fi => {
      const f = obj.faces?.[fi];
      if (f) f.indices.forEach(i => affected.add(i));
    });
  }

  if (affected.size < 2) {
    return { vertices: verts, faces: obj.faces || [], report: ['Se requieren al menos 2 vértices o 1 arista para colapsar'] };
  }

  const affectedArr = Array.from(affected);
  let cx = 0, cy = 0, cz = 0;
  for (const idx of affectedArr) {
    const v = verts[idx];
    if (v) {
      cx += v[0]; cy += v[1]; cz += v[2];
    }
  }
  cx /= affectedArr.length;
  cy /= affectedArr.length;
  cz /= affectedArr.length;

  const targetIdx = Math.min(...affectedArr);
  const newVerts = verts.map((v, i) => i === targetIdx ? [cx, cy, cz] as V3 : [...v] as V3);

  const remap = new Map<number, number>();
  for (const idx of affectedArr) remap.set(idx, targetIdx);

  const newFaces: MeshFace[] = [];
  for (const f of obj.faces || []) {
    const remapped = f.indices.map(i => remap.get(i) ?? i);
    const filtered: number[] = [];
    for (let k = 0; k < remapped.length; k++) {
      if (k === 0 || remapped[k] !== remapped[k - 1]) filtered.push(remapped[k]);
    }
    if (filtered.length > 1 && filtered[0] === filtered[filtered.length - 1]) filtered.pop();
    if (filtered.length >= 3) {
      newFaces.push({ ...f, indices: filtered });
    }
  }

  const clean = deleteLooseElements({ vertices: newVerts, faces: newFaces });
  return {
    vertices: clean.vertices,
    faces: clean.faces,
    report: [`${affected.size} elementos colapsados en su centroide común`]
  };
}

/**
 * Convierte pares de triángulos adyacentes coplanares o con curvatura suave en cuadriláteros limpios (Tris to Quads),
 * disolviendo la diagonal interior para eliminar las líneas cruzadas que dividen polígonos y caras.
 */
export function convertTrisToQuads(
  obj: CSGObject | { vertices: V3[]; faces: MeshFace[] },
  maxAngleToleranceDeg: number = 32.0
): { vertices: V3[]; faces: MeshFace[]; convertedQuads: number; report: string[] } {
  const rawVerts = obj.vertices || [];
  const inFaces = obj.faces || [];
  if (rawVerts.length < 4 || inFaces.length < 2) {
    return { vertices: rawVerts, faces: inFaces, convertedQuads: 0, report: ['Malla insuficiente para conversión'] };
  }

  const verts = rawVerts;
  const cosTol = Math.cos((maxAngleToleranceDeg * Math.PI) / 180);

  // Mapeo canónico espacial para identificar vértices compartidos en mallas desoldadas
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    if (v[0] < minX) minX = v[0]; if (v[1] < minY) minY = v[1]; if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0]; if (v[1] > maxY) maxY = v[1]; if (v[2] > maxZ) maxZ = v[2];
  }
  const bboxDiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1.0;
  const quant = Math.max(200, Math.min(60000, Math.round(3000 / bboxDiag)));
  const spatialMap = new Map<string, number>();
  const canVert: number[] = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const key = `${Math.round(v[0] * quant)}_${Math.round(v[1] * quant)}_${Math.round(v[2] * quant)}`;
    let c = spatialMap.get(key);
    if (c === undefined) {
      c = i;
      spatialMap.set(key, c);
    }
    canVert[i] = c;
  }

  // Precalcular normales y áreas de triángulos
  const faceNormals: (THREE.Vector3 | null)[] = [];
  const triFaces: { origIdx: number; indices: [number, number, number]; mat?: number; uvs?: [number, number][] }[] = [];
  const nonTriFaces: MeshFace[] = [];

  for (let i = 0; i < inFaces.length; i++) {
    const f = inFaces[i];
    if (f.indices && f.indices.length === 3) {
      const [i0, i1, i2] = f.indices;
      const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
      if (p0 && p1 && p2) {
        const v0 = new THREE.Vector3(...p0);
        const v1 = new THREE.Vector3(...p1);
        const v2 = new THREE.Vector3(...p2);
        const norm = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v1, v0), new THREE.Vector3().subVectors(v2, v0));
        if (norm.lengthSq() > 1e-12) norm.normalize(); else norm.set(0, 1, 0);
        faceNormals.push(norm);
        triFaces.push({ origIdx: i, indices: [i0, i1, i2], mat: f.materialIndex, uvs: f.uvs });
        continue;
      }
    }
    nonTriFaces.push(f);
  }

  // Agrupar aristas compartidas entre triángulos usando índices espaciales
  const edgeMap = new Map<string, { triIdx: number; edgeOrder: [number, number]; oppVert: number }[]>();
  for (let t = 0; t < triFaces.length; t++) {
    const [i0, i1, i2] = triFaces[t].indices;
    const triEdges: [number, number, number][] = [
      [i0, i1, i2],
      [i1, i2, i0],
      [i2, i0, i1]
    ];
    for (const [va, vb, opp] of triEdges) {
      const cA = canVert[va] ?? va;
      const cB = canVert[vb] ?? vb;
      if (cA === cB) continue;
      const minV = Math.min(cA, cB);
      const maxV = Math.max(cA, cB);
      const k = `${minV}_${maxV}`;
      let list = edgeMap.get(k);
      if (!list) {
        list = [];
        edgeMap.set(k, list);
      }
      list.push({ triIdx: t, edgeOrder: [va, vb], oppVert: opp });
    }
  }

  // Identificar candidatos a Quads y puntuarlos
  interface CandidatePair {
    tA: number;
    tB: number;
    quadIndices: [number, number, number, number];
    score: number;
    mat?: number;
  }

  const candidates: CandidatePair[] = [];

  edgeMap.forEach((sharedList) => {
    if (sharedList.length === 2) {
      const { triIdx: tA, edgeOrder: [a1, b1], oppVert: oppA } = sharedList[0];
      const { triIdx: tB, edgeOrder: [a2, b2], oppVert: oppB } = sharedList[1];

      if (tA === tB || oppA === oppB) return;
      if (triFaces[tA].mat !== triFaces[tB].mat) return;

      const nA = faceNormals[tA];
      const nB = faceNormals[tB];
      if (!nA || !nB) return;

      const dot = nA.dot(nB);
      if (dot < cosTol) return;

      const vA = a1;
      const vB = b1;
      const pA = verts[vA], pB = verts[vB], pC = verts[oppA], pD = verts[oppB];
      if (!pA || !pB || !pC || !pD) return;

      // Ordenar los 4 vértices para formar un ciclo continuo alrededor del perímetro del quad
      // tA tiene vértices [vA, vB, oppA]. El orden perimetral desde oppA es oppA -> vA -> oppB -> vB
      // Verificamos cuál orientación respeta la normal
      const quadIndices: [number, number, number, number] = [oppA, vA, oppB, vB];

      // Verificar convexidad del quad en su plano medio
      const nAvg = new THREE.Vector3().addVectors(nA, nB).normalize();
      const pOppA = new THREE.Vector3(...pC);
      const pVA = new THREE.Vector3(...pA);
      const pOppB = new THREE.Vector3(...pD);
      const pVB = new THREE.Vector3(...pB);

      const e0 = new THREE.Vector3().subVectors(pVA, pOppA);
      const e1 = new THREE.Vector3().subVectors(pOppB, pVA);
      const e2 = new THREE.Vector3().subVectors(pVB, pOppB);
      const e3 = new THREE.Vector3().subVectors(pOppA, pVB);

      const c0 = new THREE.Vector3().crossVectors(e0, e1).dot(nAvg);
      const c1 = new THREE.Vector3().crossVectors(e1, e2).dot(nAvg);
      const c2 = new THREE.Vector3().crossVectors(e2, e3).dot(nAvg);
      const c3 = new THREE.Vector3().crossVectors(e3, e0).dot(nAvg);

      const allPositive = c0 > 1e-6 && c1 > 1e-6 && c2 > 1e-6 && c3 > 1e-6;
      const allNegative = c0 < -1e-6 && c1 < -1e-6 && c2 < -1e-6 && c3 < -1e-6;

      if (!allPositive && !allNegative) {
        // Cuadrilátero cóncavo o auto-intersecante: no unir
        return;
      }

      const finalIndices: [number, number, number, number] = allPositive
        ? [oppA, vA, oppB, vB]
        : [oppA, vB, oppB, vA];

      // Puntuación: mayor score para ángulos diedros más planos y quads más regulares
      const score = dot * 2.0;
      candidates.push({
        tA,
        tB,
        quadIndices: finalIndices,
        score,
        mat: triFaces[tA].mat
      });
    }
  });

  // Ordenar candidatos por mejor calidad descendente
  candidates.sort((a, b) => b.score - a.score);

  const usedTriangles = new Uint8Array(triFaces.length);
  const newQuadFaces: MeshFace[] = [];
  let convertedCount = 0;

  for (const cand of candidates) {
    if (usedTriangles[cand.tA] === 0 && usedTriangles[cand.tB] === 0) {
      usedTriangles[cand.tA] = 1;
      usedTriangles[cand.tB] = 1;
      newQuadFaces.push({
        indices: cand.quadIndices,
        materialIndex: cand.mat
      });
      convertedCount++;
    }
  }

  // Conservar triángulos que no se pudieron unir en quads
  const remainingTriFaces: MeshFace[] = [];
  for (let t = 0; t < triFaces.length; t++) {
    if (usedTriangles[t] === 0) {
      remainingTriFaces.push(inFaces[triFaces[t].origIdx]);
    }
  }

  const finalFaces: MeshFace[] = [...nonTriFaces, ...newQuadFaces, ...remainingTriFaces];

  return {
    vertices: verts,
    faces: finalFaces,
    convertedQuads: convertedCount,
    report: [
      `Convertidos ${convertedCount * 2} triángulos en ${convertedCount} cuadriláteros limpios`,
      `Eliminadas ${convertedCount} diagonales cruzadas internas`
    ]
  };
}


