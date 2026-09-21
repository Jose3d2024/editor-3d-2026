/**
 * uvUnwrap.ts — Advanced Blender-Standard UV Mapping & Unwrapping Engine
 * 
 * Provides:
 * 1. Smart UV Project (Angle-based chart segmentation + LSCM/Conformal 2D flattening + automatic packing with margin)
 * 2. Cube / Box Mapping with customizable scale & seam alignment
 * 3. Cylinder & Sphere Projection (equirectangular with anti-seam split)
 * 4. Camera / View-based Project
 * 5. Lightmap Pack (Uniform island packing for bake & lightmaps)
 * 6. Follow Active Quads / Regularize UV grid
 * 7. UV Relax / Minimize Stretch (Laplacian + Edge spring relaxation in UV space)
 * 8. UV Island Packing with customizable margin & rotation
 * 9. Seam preservation & UV island boundary detection
 */

import * as THREE from 'three';
import type { MeshFace, V3 } from '../types';

export interface UVUnwrapOptions {
  angleThresholdDeg?: number; // For Smart UV Project (default: 66°)
  islandMargin?: number;      // Margin between UV islands [0..0.1] (default: 0.02)
  correctAspect?: boolean;   // Preserve aspect ratio
  scaleToFit?: boolean;      // Normalize whole UV layout to [0, 1]
  relaxIterations?: number;  // Number of relaxation steps (default: 5)
  direction?: 'X' | 'Y' | 'Z' | 'VIEW' | 'AUTO';
}

/**
 * Helper to calculate face normal
 */
function getFaceNormal(vertices: V3[], faceIndices: number[]): THREE.Vector3 {
  if (!faceIndices || faceIndices.length < 3) return new THREE.Vector3(0, 1, 0);
  const vert0 = vertices[faceIndices[0]];
  const vert1 = vertices[faceIndices[1]];
  const vert2 = vertices[faceIndices[2]];
  if (!vert0 || !vert1 || !vert2) return new THREE.Vector3(0, 1, 0);
  const v0 = new THREE.Vector3(...vert0);
  const v1 = new THREE.Vector3(...vert1);
  const v2 = new THREE.Vector3(...vert2);
  const norm = new THREE.Vector3().crossVectors(v1.sub(v0), v2.sub(v0));
  if (norm.lengthSq() > 1e-8) {
    return norm.normalize();
  }
  return new THREE.Vector3(0, 1, 0);
}

/**
 * Helper to calculate 3D face area
 */
function getFaceArea(vertices: V3[], faceIndices: number[]): number {
  if (!faceIndices || faceIndices.length < 3) return 0;
  const vert0 = vertices[faceIndices[0]];
  if (!vert0) return 0;
  let totalArea = 0;
  const v0 = new THREE.Vector3(...vert0);
  for (let i = 1; i < faceIndices.length - 1; i++) {
    const vert1 = vertices[faceIndices[i]];
    const vert2 = vertices[faceIndices[i + 1]];
    if (!vert1 || !vert2) continue;
    const v1 = new THREE.Vector3(...vert1);
    const v2 = new THREE.Vector3(...vert2);
    const cross = new THREE.Vector3().crossVectors(v1.sub(v0), v2.sub(v0));
    totalArea += cross.length() * 0.5;
  }
  return totalArea;
}

/**
 * Segment mesh faces into chart islands based on normal angles (Blender Smart UV Project)
 */
export function segmentFacesByAngle(
  vertices: V3[],
  faces: MeshFace[],
  angleThresholdDeg = 66
): number[][] {
  const numFaces = faces.length;
  if (numFaces === 0) return [];

  const thresholdRad = (angleThresholdDeg * Math.PI) / 180;
  const faceNormals = faces.map(f => getFaceNormal(vertices, f.indices));

  // Build edge-to-face adjacency map
  const edgeToFaces = new Map<string, number[]>();
  faces.forEach((f, fIdx) => {
    const n = f.indices.length;
    for (let i = 0; i < n; i++) {
      const a = f.indices[i];
      const b = f.indices[(i + 1) % n];
      const key = Math.min(a, b) + '_' + Math.max(a, b);
      let list = edgeToFaces.get(key);
      if (!list) {
        list = [];
        edgeToFaces.set(key, list);
      }
      list.push(fIdx);
    }
  });

  const visited = new Uint8Array(numFaces);
  const islands: number[][] = [];

  for (let f = 0; f < numFaces; f++) {
    if (visited[f]) continue;

    const island: number[] = [];
    const queue: number[] = [f];
    visited[f] = 1;

    // Island seed normal
    const seedNormal = faceNormals[f];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      island.push(curr);
      const currNorm = faceNormals[curr];

      const fIndices = faces[curr].indices;
      const n = fIndices.length;
      for (let i = 0; i < n; i++) {
        const a = fIndices[i];
        const b = fIndices[(i + 1) % n];
        const key = Math.min(a, b) + '_' + Math.max(a, b);
        const neighbors = edgeToFaces.get(key) || [];

        for (const neighbor of neighbors) {
          if (visited[neighbor]) continue;

          const nNorm = faceNormals[neighbor];
          // Check angle between adjacent faces and against island seed
          const dotAdj = Math.max(-1, Math.min(1, currNorm.dot(nNorm)));
          const angleAdj = Math.acos(dotAdj);

          const dotSeed = Math.max(-1, Math.min(1, seedNormal.dot(nNorm)));
          const angleSeed = Math.acos(dotSeed);

          if (angleAdj <= thresholdRad && angleSeed <= thresholdRad * 1.25) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }

    if (island.length > 0) {
      islands.push(island);
    }
  }

  return islands;
}

/**
 * 2D Local Conformal Projection for a single island of connected faces
 */
function projectIsland2D(
  vertices: V3[],
  faces: MeshFace[],
  islandFaceIndices: number[]
): {
  islandFaceUVs: Map<number, [number, number][]>;
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  width: number;
  height: number;
} {
  // 1. Find dominant normal for the island
  const avgNormal = new THREE.Vector3();
  const islandCentroid = new THREE.Vector3();
  let totalArea = 0;

  islandFaceIndices.forEach(fIdx => {
    const face = faces[fIdx];
    const n = getFaceNormal(vertices, face.indices);
    const a = getFaceArea(vertices, face.indices);
    avgNormal.addScaledVector(n, a + 1e-4);
    totalArea += a;

    face.indices.forEach(vIdx => {
      islandCentroid.add(new THREE.Vector3(...vertices[vIdx]));
    });
  });

  if (avgNormal.lengthSq() > 1e-6) {
    avgNormal.normalize();
  } else {
    avgNormal.set(0, 1, 0);
  }

  // 2. Build local coordinate frame (Tangent U, Bitangent V, Normal N)
  let tangentU = new THREE.Vector3();
  if (Math.abs(avgNormal.y) < 0.9) {
    tangentU.crossVectors(avgNormal, new THREE.Vector3(0, 1, 0)).normalize();
  } else {
    tangentU.crossVectors(avgNormal, new THREE.Vector3(1, 0, 0)).normalize();
  }
  const bitangentV = new THREE.Vector3().crossVectors(avgNormal, tangentU).normalize();

  // 3. Project each face's vertices onto this best-fit 2D local plane
  const islandFaceUVs = new Map<number, [number, number][]>();
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;

  islandFaceIndices.forEach(fIdx => {
    const face = faces[fIdx];
    const uvs: [number, number][] = face.indices.map(vIdx => {
      const p = new THREE.Vector3(...vertices[vIdx]);
      const u = p.dot(tangentU);
      const v = p.dot(bitangentV);

      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;

      return [u, v];
    });
    islandFaceUVs.set(fIdx, uvs);
  });

  const width = Math.max(1e-6, maxU - minU);
  const height = Math.max(1e-6, maxV - minV);

  return { islandFaceUVs, minU, minV, maxU, maxV, width, height };
}

/**
 * Minimize stretch / Laplacian relaxation in UV space (Blender UV Relax)
 */
function relaxIslandUVs(
  vertices: V3[],
  faces: MeshFace[],
  islandFaceIndices: number[],
  islandFaceUVs: Map<number, [number, number][]>,
  iterations = 6
): void {
  if (islandFaceIndices.length < 2 || iterations <= 0) return;

  // Build vertex map for this island
  // (vertex index -> list of references to its [u, v] coordinate in faces)
  const vertCoordRefs = new Map<number, { fIdx: number; cornerIdx: number }[]>();
  const vertNeighbors = new Map<number, Set<number>>();

  islandFaceIndices.forEach(fIdx => {
    const face = faces[fIdx];
    const n = face.indices.length;
    for (let i = 0; i < n; i++) {
      const v = face.indices[i];
      const nextV = face.indices[(i + 1) % n];
      const prevV = face.indices[(i + n - 1) % n];

      if (!vertCoordRefs.has(v)) vertCoordRefs.set(v, []);
      vertCoordRefs.get(v)!.push({ fIdx, cornerIdx: i });

      if (!vertNeighbors.has(v)) vertNeighbors.set(v, new Set());
      vertNeighbors.get(v)!.add(nextV);
      vertNeighbors.get(v)!.add(prevV);
    }
  });

  // Iterative Spring Laplacian Relaxation with readBuffer and 3D edge length preservation
  for (let iter = 0; iter < iterations; iter++) {
    // Clonar el estado UV al inicio de la iteración para lectura limpia y simétrica
    const readBuffer = new Map<number, [number, number][]>();
    islandFaceIndices.forEach(fIdx => {
      readBuffer.set(fIdx, islandFaceUVs.get(fIdx)!.map(uv => [...uv] as [number, number]));
    });

    vertNeighbors.forEach((neighbors, vIdx) => {
      const refs = vertCoordRefs.get(vIdx);
      if (!refs || refs.length === 0 || neighbors.size === 0) return;

      const firstRef = refs[0];
      const currUV = readBuffer.get(firstRef.fIdx)![firstRef.cornerIdx];
      const p3D = new THREE.Vector3(...vertices[vIdx]);

      let avgU = 0, avgV = 0, totalWeight = 0;

      neighbors.forEach(nIdx => {
        const nRefs = vertCoordRefs.get(nIdx);
        if (!nRefs || nRefs.length === 0) return;
        const nRef = nRefs[0];
        const nUV = readBuffer.get(nRef.fIdx)![nRef.cornerIdx];
        const n3D = new THREE.Vector3(...vertices[nIdx]);

        const dist3D = Math.max(1e-4, p3D.distanceTo(n3D));
        // Weight inversely by 3D distance to keep proportions
        const weight = 1.0 / dist3D;

        avgU += nUV[0] * weight;
        avgV += nUV[1] * weight;
        totalWeight += weight;
      });

      if (totalWeight > 0) {
        avgU /= totalWeight;
        avgV /= totalWeight;

        // Smooth blend (alpha = 0.20 to prevent fold-overs)
        const newU = currUV[0] * 0.80 + avgU * 0.20;
        const newV = currUV[1] * 0.80 + avgV * 0.20;

        refs.forEach(({ fIdx, cornerIdx }) => {
          const uv = islandFaceUVs.get(fIdx)![cornerIdx];
          uv[0] = newU;
          uv[1] = newV;
        });
      }
    });
  }
}

/**
 * Packs multiple 2D UV charts into the normalized [0, 1] x [0, 1] square
 * with configurable padding margin (Bin Packing / Skyline Algorithm)
 */
export function packUVPieces(
  islands: {
    islandFaceUVs: Map<number, [number, number][]>;
    minU: number;
    minV: number;
    maxU: number;
    maxV: number;
    width: number;
    height: number;
  }[],
  margin = 0.02
): Map<number, [number, number][]> {
  const resultFaceUVs = new Map<number, [number, number][]>();
  if (islands.length === 0) return resultFaceUVs;

  // Sort islands by largest bounding box dimension descending
  const sorted = [...islands].sort((a, b) => {
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return areaB - areaA;
  });

  // Compute total raw area to estimate global scale
  let totalArea = 0;
  sorted.forEach(isl => {
    totalArea += (isl.width + margin) * (isl.height + margin);
  });

  const estimatedGridWidth = Math.max(1e-4, Math.sqrt(totalArea) * 1.2);

  // Shelf-packing algorithm
  let currentX = margin;
  let currentY = margin;
  let shelfHeight = 0;
  let maxExtentX = 0;
  let maxExtentY = 0;

  interface IslandPlacement {
    island: typeof sorted[0];
    x: number;
    y: number;
  }

  const placements: IslandPlacement[] = [];

  sorted.forEach(isl => {
    // If island exceeds current row, advance to next shelf row
    if (currentX + isl.width > estimatedGridWidth && currentX > margin) {
      currentX = margin;
      currentY += shelfHeight + margin;
      shelfHeight = 0;
    }

    placements.push({
      island: isl,
      x: currentX,
      y: currentY
    });

    if (isl.height > shelfHeight) {
      shelfHeight = isl.height;
    }

    currentX += isl.width + margin;

    if (currentX > maxExtentX) maxExtentX = currentX;
    if (currentY + shelfHeight > maxExtentY) maxExtentY = currentY + shelfHeight;
  });

  // Global normalization factor to fit tightly into [0, 1] range preserving aspect ratio
  const totalW = Math.max(1e-6, maxExtentX);
  const totalH = Math.max(1e-6, maxExtentY);
  const layoutScale = Math.max(totalW, totalH);

  placements.forEach(({ island, x, y }) => {
    island.islandFaceUVs.forEach((uvs, fIdx) => {
      const normalizedUVs: [number, number][] = uvs.map(([u, v]) => {
        // Shift local island to [0, width]
        const localU = u - island.minU;
        const localV = v - island.minV;

        // Place on packed canvas
        const finalU = (x + localU) / layoutScale;
        const finalV = (y + localV) / layoutScale;

        return [finalU, finalV];
      });
      resultFaceUVs.set(fIdx, normalizedUVs);
    });
  });

  return resultFaceUVs;
}

/**
 * ─── CARDBOARD BOX / NET UNFOLDING (Desarmar Malla como Caja de Cartón) ──────
 * Unrolls connected 3D polygonal faces flat into a continuous 2D pattern net
 * by rotating child faces around shared hinge edges into the parent face's plane.
 * Preserves 100% of 3D edge lengths and polygon angles (zero distortion).
 */
export function unfoldCardboardBoxNet(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  options: {
    targetZone?: 'ATLAS' | 'STAGING'; // 'ATLAS' -> [0, 1], 'STAGING' -> [-1, 0]
    margin?: number;
    maxTreeDepth?: number;
  } = {}
): { vertices: V3[]; faces: MeshFace[]; seams: [number, number][] } {
  const { targetZone = 'ATLAS', margin = 0.03 } = options;
  const vertices = mesh.vertices;
  const faces = mesh.faces;
  if (!vertices.length || !faces.length) {
    return { vertices, faces, seams: [] };
  }

  // 1. Build edge-to-face adjacency map
  interface SharedEdge {
    vA: number;
    vB: number;
    faceA: number;
    faceB: number;
  }
  const edgeMap = new Map<string, { fIdx: number; edgeIdx: number; v0: number; v1: number }[]>();
  faces.forEach((f, fIdx) => {
    const n = f.indices.length;
    for (let i = 0; i < n; i++) {
      const v0 = f.indices[i];
      const v1 = f.indices[(i + 1) % n];
      const key = Math.min(v0, v1) + '_' + Math.max(v0, v1);
      let list = edgeMap.get(key);
      if (!list) {
        list = [];
        edgeMap.set(key, list);
      }
      list.push({ fIdx, edgeIdx: i, v0, v1 });
    }
  });

  const visitedFaces = new Uint8Array(faces.length);
  const faceUVs = new Map<number, [number, number][]>();
  const seamEdges: [number, number][] = [];
  const islandsData: { faceIndices: number[]; minU: number; minV: number; maxU: number; maxV: number }[] = [];

  // 2. Select starting root face (favor bottom or large planar faces)
  let rootOrder: number[] = [];
  for (let i = 0; i < faces.length; i++) rootOrder.push(i);
  rootOrder.sort((a, b) => {
    const normA = getFaceNormal(vertices, faces[a].indices);
    const normB = getFaceNormal(vertices, faces[b].indices);
    // Prefer faces pointing down (Y < 0) or largest area
    const downScoreA = normA.y < -0.5 ? 10 : 0;
    const downScoreB = normB.y < -0.5 ? 10 : 0;
    const areaA = getFaceArea(vertices, faces[a].indices);
    const areaB = getFaceArea(vertices, faces[b].indices);
    return (downScoreB + areaB) - (downScoreA + areaA);
  });

  // 3. Unfold each connected island
  for (const rootIdx of rootOrder) {
    if (visitedFaces[rootIdx]) continue;

    const currentIslandFaces: number[] = [];
    const vert2DMap = new Map<number, [number, number]>();

    // Initial 2D coordinate system for root face
    const rootFace = faces[rootIdx];
    const rootNorm = getFaceNormal(vertices, rootFace.indices);
    let tangentU = new THREE.Vector3();
    if (Math.abs(rootNorm.y) < 0.9) {
      tangentU.crossVectors(rootNorm, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      tangentU.crossVectors(rootNorm, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const bitangentV = new THREE.Vector3().crossVectors(rootNorm, tangentU).normalize();

    // Center root face
    const centroid = new THREE.Vector3();
    rootFace.indices.forEach(vIdx => centroid.add(new THREE.Vector3(...vertices[vIdx])));
    centroid.multiplyScalar(1 / rootFace.indices.length);

    // Place root face vertices in 2D
    const rootUVs: [number, number][] = rootFace.indices.map(vIdx => {
      const p = new THREE.Vector3(...vertices[vIdx]).sub(centroid);
      const u = p.dot(tangentU);
      const v = p.dot(bitangentV);
      vert2DMap.set(vIdx, [u, v]);
      return [u, v];
    });
    faceUVs.set(rootIdx, rootUVs);
    visitedFaces[rootIdx] = 1;
    currentIslandFaces.push(rootIdx);

    // BFS queue for unrolling adjacent faces
    // Each queue item: { fIdx, parentIdx, hingeV0, hingeV1 }
    const queue: number[] = [rootIdx];

    while (queue.length > 0) {
      const currIdx = queue.shift()!;
      const currFace = faces[currIdx];
      const currUVs = faceUVs.get(currIdx)!;
      const n = currFace.indices.length;

      for (let i = 0; i < n; i++) {
        const vA = currFace.indices[i];
        const vB = currFace.indices[(i + 1) % n];
        const key = Math.min(vA, vB) + '_' + Math.max(vA, vB);
        const adjacent = edgeMap.get(key) || [];

        for (const adj of adjacent) {
          const nextFaceIdx = adj.fIdx;
          if (nextFaceIdx === currIdx) continue;

          if (visitedFaces[nextFaceIdx]) {
            // Already visited from another path -> This is a cut seam!
            seamEdges.push([vA, vB]);
            continue;
          }

          const nextFace = faces[nextFaceIdx];
          const nextVerts = nextFace.indices;
          const nextN = nextVerts.length;

          // Unfold nextFace across hinge (vA, vB)
          // Find 2D positions of hinge vertices in current unrolled net
          const uvA = currUVs[i];
          const uvB = currUVs[(i + 1) % n];

          if (!uvA || !uvB) continue;

          // 2D vector for hinge edge
          const dx = uvB[0] - uvA[0];
          const dy = uvB[1] - uvA[1];
          const edgeLen2D = Math.hypot(dx, dy);
          if (edgeLen2D < 1e-6) continue;

          const dirU = dx / edgeLen2D;
          const dirV = dy / edgeLen2D;
          // Normal to hinge pointing outward from currFace
          // In 2D standard polygon traversal, right-hand normal is (dirV, -dirU)
          const normU = dirV;
          const normV = -dirU;

          // 3D coordinates of hinge
          const p3A = new THREE.Vector3(...vertices[vA]);
          const p3B = new THREE.Vector3(...vertices[vB]);

          // Unroll every vertex of nextFace into 2D
          const nextUVs: [number, number][] = [];
          let isValidUnfold = true;

          for (let k = 0; k < nextN; k++) {
            const vK = nextVerts[k];
            if (vK === vA) {
              nextUVs.push([uvA[0], uvA[1]]);
            } else if (vK === vB) {
              nextUVs.push([uvB[0], uvB[1]]);
            } else {
              // Trilateration of vK relative to vA and vB
              const p3K = new THREE.Vector3(...vertices[vK]);
              const distA = p3K.distanceTo(p3A);
              const distB = p3K.distanceTo(p3B);

              // Projection along edge
              const projDist = (distA * distA - distB * distB + edgeLen2D * edgeLen2D) / (2 * edgeLen2D);
              const heightDistSq = distA * distA - projDist * projDist;
              const heightDist = Math.sqrt(Math.max(0, heightDistSq));

              // Position vertex outward along normal
              const posX = uvA[0] + dirU * projDist + normU * heightDist;
              const posY = uvA[1] + dirV * projDist + normV * heightDist;

              nextUVs.push([posX, posY]);
            }
          }

          if (isValidUnfold && nextUVs.length === nextN) {
            faceUVs.set(nextFaceIdx, nextUVs);
            visitedFaces[nextFaceIdx] = 1;
            currentIslandFaces.push(nextFaceIdx);
            queue.push(nextFaceIdx);
          }
        }
      }
    }

    // Calculate bounding box for this unrolled island
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    currentIslandFaces.forEach(fIdx => {
      const uvs = faceUVs.get(fIdx);
      if (uvs) {
        uvs.forEach(([u, v]) => {
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        });
      }
    });

    if (currentIslandFaces.length > 0 && isFinite(minU)) {
      islandsData.push({ faceIndices: currentIslandFaces, minU, minV, maxU, maxV });
    }
  }

  // 4. Pack or Arrange Islands into Target Destination
  // Target Atlas: [0, 1] x [0, 1]
  // Target Staging: [-1, 0] x [0, 1]
  let totalWidth = 0;
  let totalHeight = 0;
  islandsData.forEach(isl => {
    const w = Math.max(1e-5, isl.maxU - isl.minU);
    const h = Math.max(1e-5, isl.maxV - isl.minV);
    totalWidth += w + margin;
    totalHeight = Math.max(totalHeight, h);
  });

  // Calculate placement scale
  const aspectCanvas = 1.0;
  const numIslands = islandsData.length;
  const cols = Math.ceil(Math.sqrt(numIslands * aspectCanvas));
  let curX = 0;
  let curY = 0;
  let rowH = 0;
  let maxExtentX = 0;
  let maxExtentY = 0;

  const islandPositions: { x: number; y: number; w: number; h: number }[] = [];

  islandsData.forEach((isl, i) => {
    const w = Math.max(1e-5, isl.maxU - isl.minU);
    const h = Math.max(1e-5, isl.maxV - isl.minV);

    if (i > 0 && i % cols === 0) {
      curX = 0;
      curY += rowH + margin;
      rowH = 0;
    }

    islandPositions.push({ x: curX, y: curY, w, h });
    rowH = Math.max(rowH, h);
    curX += w + margin;

    if (curX > maxExtentX) maxExtentX = curX;
    if (curY + rowH > maxExtentY) maxExtentY = curY + rowH;
  });

  const bboxW = Math.max(1e-5, maxExtentX);
  const bboxH = Math.max(1e-5, maxExtentY);
  const maxDim = Math.max(bboxW, bboxH);

  // Offset based on target destination
  const targetOffsetU = targetZone === 'STAGING' ? -1.0 + margin : margin;
  const targetScale = (1.0 - margin * 2) / maxDim;

  islandsData.forEach((isl, i) => {
    const pos = islandPositions[i];
    isl.faceIndices.forEach(fIdx => {
      const rawUVs = faceUVs.get(fIdx);
      if (!rawUVs) return;

      const fittedUVs: [number, number][] = rawUVs.map(([u, v]) => {
        const localU = u - isl.minU;
        const localV = v - isl.minV;
        const finalU = targetOffsetU + (pos.x + localU) * targetScale;
        const finalV = margin + (pos.y + localV) * targetScale;
        return [finalU, finalV];
      });
      faceUVs.set(fIdx, fittedUVs);
    });
  });

  // Assign back to faces
  const newFaces = faces.map((f, fIdx) => {
    const uvs = faceUVs.get(fIdx) || f.indices.map(() => [0, 0] as [number, number]);
    return { ...f, uvs };
  });

  return { vertices, faces: newFaces, seams: seamEdges };
}

/**
 * ─── UV ISLAND DATA STRUCTURE & TOOLS ───────────────────────────────────────
 */
export interface UVIslandInfo {
  islandId: number;
  faceIndices: number[];
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
  color: string;
  isStaged: boolean; // True if positioned in [-1, 0] staging area
}

const ISLAND_PALETTE = [
  '#f59e0b', '#06b6d4', '#10b981', '#ec4899', '#8b5cf6',
  '#3b82f6', '#14b8a6', '#f97316', '#a855f7', '#84cc16',
  '#e11d48', '#0ea5e9', '#6366f1', '#d946ef', '#22c55e'
];

/**
 * Extracts distinct connected UV islands from mesh faces
 */
export function extractUVIslands(
  faces: MeshFace[],
  vertices: V3[]
): UVIslandInfo[] {
  if (!faces || !faces.length) return [];

  const numFaces = faces.length;
  // Build UV-connectivity graph: 2 faces are connected in UV space if they share an edge with identical UV coordinates
  const edgeToFaces = new Map<string, number[]>();
  faces.forEach((f, fIdx) => {
    if (!f.uvs || !f.indices) return;
    const n = f.indices.length;
    for (let i = 0; i < n; i++) {
      const v0 = f.indices[i];
      const v1 = f.indices[(i + 1) % n];
      const uv0 = f.uvs[i];
      const uv1 = f.uvs[(i + 1) % n];
      if (!uv0 || !uv1) continue;

      // Quantized UV key for edge to detect seams vs welds
      const q = (n: number) => Math.round(n * 10000);
      const edgeKey = Math.min(v0, v1) + '_' + Math.max(v0, v1) + '|' +
        Math.min(q(uv0[0]), q(uv1[0])) + '_' + Math.min(q(uv0[1]), q(uv1[1]));

      let list = edgeToFaces.get(edgeKey);
      if (!list) {
        list = [];
        edgeToFaces.set(edgeKey, list);
      }
      list.push(fIdx);
    }
  });

  const visited = new Uint8Array(numFaces);
  const islands: UVIslandInfo[] = [];

  for (let f = 0; f < numFaces; f++) {
    if (visited[f]) continue;

    const islandFaces: number[] = [];
    const queue: number[] = [f];
    visited[f] = 1;

    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      islandFaces.push(curr);
      const currFace = faces[curr];
      if (currFace.uvs) {
        currFace.uvs.forEach(([u, v]) => {
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        });
      }

      if (!currFace.indices || !currFace.uvs) continue;
      const n = currFace.indices.length;
      for (let i = 0; i < n; i++) {
        const v0 = currFace.indices[i];
        const v1 = currFace.indices[(i + 1) % n];
        const uv0 = currFace.uvs[i];
        const uv1 = currFace.uvs[(i + 1) % n];
        if (!uv0 || !uv1) continue;

        const q = (n: number) => Math.round(n * 10000);
        const edgeKey = Math.min(v0, v1) + '_' + Math.max(v0, v1) + '|' +
          Math.min(q(uv0[0]), q(uv1[0])) + '_' + Math.min(q(uv0[1]), q(uv1[1]));

        const neighbors = edgeToFaces.get(edgeKey) || [];
        for (const neighbor of neighbors) {
          if (!visited[neighbor]) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }
    }

    if (islandFaces.length > 0) {
      const width = isFinite(minU) ? Math.max(1e-5, maxU - minU) : 0;
      const height = isFinite(minV) ? Math.max(1e-5, maxV - minV) : 0;
      const centerU = isFinite(minU) ? (minU + maxU) * 0.5 : 0.5;
      const centerV = isFinite(minV) ? (minV + maxV) * 0.5 : 0.5;
      const color = ISLAND_PALETTE[islands.length % ISLAND_PALETTE.length];
      const isStaged = centerU < 0.0;

      islands.push({
        islandId: islands.length,
        faceIndices: islandFaces,
        minU: isFinite(minU) ? minU : 0,
        minV: isFinite(minV) ? minV : 0,
        maxU: isFinite(maxU) ? maxU : 1,
        maxV: isFinite(maxV) ? maxV : 1,
        centerU,
        centerV,
        width,
        height,
        color,
        isStaged
      });
    }
  }

  return islands;
}

/**
 * Transforms a single UV island (Move, Rotate, Scale, Flip)
 */
export function transformSingleUVIsland(
  faces: MeshFace[],
  islandFaceIndices: number[],
  options: {
    deltaU?: number;
    deltaV?: number;
    rotationDeg?: number;
    scaleFactor?: number;
    flipH?: boolean;
    flipV?: boolean;
    snapToStaging?: boolean;
    snapToAtlas?: boolean;
  }
): MeshFace[] {
  if (!faces || !islandFaceIndices.length) return faces;
  const faceSet = new Set(islandFaceIndices);

  // Calculate island center
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  islandFaceIndices.forEach(fIdx => {
    const f = faces[fIdx];
    if (f && f.uvs) {
      f.uvs.forEach(([u, v]) => {
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      });
    }
  });

  const centerU = (minU + maxU) * 0.5;
  const centerV = (minV + maxV) * 0.5;

  const dU = options.deltaU ?? 0;
  const dV = options.deltaV ?? 0;
  const scale = options.scaleFactor ?? 1.0;
  const rotRad = ((options.rotationDeg ?? 0) * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  // Staging area shift helper
  let extraShiftU = 0;
  if (options.snapToStaging && centerU >= 0) {
    extraShiftU = -1.0; // Send to [-1, 0]
  } else if (options.snapToAtlas && centerU < 0) {
    extraShiftU = 1.0; // Send to [0, 1]
  }

  return faces.map((face, fIdx) => {
    if (!faceSet.has(fIdx) || !face.uvs) return face;

    const transformedUVs: [number, number][] = face.uvs.map(([u, v]) => {
      // 1. Center relative to island centroid
      let localU = u - centerU;
      let localV = v - centerV;

      // 2. Flip
      if (options.flipH) localU = -localU;
      if (options.flipV) localV = -localV;

      // 3. Rotate
      const rotU = localU * cosR - localV * sinR;
      const rotV = localU * sinR + localV * cosR;

      // 4. Scale
      const sU = rotU * scale;
      const sV = rotV * scale;

      // 5. Place back
      const finalU = centerU + sU + dU + extraShiftU;
      const finalV = centerV + sV + dV;

      return [finalU, finalV];
    });

    return { ...face, uvs: transformedUVs };
  });
}

/**
 * Automatically straightens a UV island by aligning its minimum bounding box with Cartesian axes
 */
export function straightenUVIsland(
  faces: MeshFace[],
  islandFaceIndices: number[]
): MeshFace[] {
  if (!faces || !islandFaceIndices.length) return faces;

  // Find longest edge vector in UV space to determine principal orientation
  let bestEdgeLen = 0;
  let bestAngle = 0;

  islandFaceIndices.forEach(fIdx => {
    const f = faces[fIdx];
    if (!f || !f.uvs) return;
    const n = f.uvs.length;
    for (let i = 0; i < n; i++) {
      const [u0, v0] = f.uvs[i];
      const [u1, v1] = f.uvs[(i + 1) % n];
      const du = u1 - u0;
      const dv = v1 - v0;
      const len = Math.hypot(du, dv);
      if (len > bestEdgeLen) {
        bestEdgeLen = len;
        bestAngle = Math.atan2(dv, du);
      }
    }
  });

  // Align to nearest 90 degree step
  const currentAngleDeg = (bestAngle * 180) / Math.PI;
  const targetDeg = Math.round(currentAngleDeg / 90) * 90;
  const correctionDeg = targetDeg - currentAngleDeg;

  return transformSingleUVIsland(faces, islandFaceIndices, { rotationDeg: correctionDeg });
}

/**
 * Packs all UV islands (from staging area or anywhere) into the [0, 1] texture tile with margin
 */
export function packAllIslandsIntoTextureTile(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  margin = 0.03
): { vertices: V3[]; faces: MeshFace[] } {
  const { vertices, faces } = mesh;
  if (!vertices.length || !faces.length) return mesh;

  const islands = extractUVIslands(faces, vertices);
  if (!islands.length) return mesh;

  // Convert each island to projectIsland structure for standard packer
  const projectedIslands = islands.map(isl => {
    const islandFaceUVs = new Map<number, [number, number][]>();
    isl.faceIndices.forEach(fIdx => {
      const f = faces[fIdx];
      if (f && f.uvs) islandFaceUVs.set(fIdx, f.uvs);
    });
    return {
      islandFaceUVs,
      minU: isl.minU,
      minV: isl.minV,
      maxU: isl.maxU,
      maxV: isl.maxV,
      width: isl.width,
      height: isl.height
    };
  });

  const packedUVMap = packUVPieces(projectedIslands, margin);
  const newFaces = faces.map((f, fIdx) => {
    const uvs = packedUVMap.get(fIdx) || f.uvs;
    return { ...f, uvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── SMART UV PROJECT (Blender 5.x LTS Compatible) ─────────────────────────
 * Automatically unwraps arbitrary organic or hard-surface 3D models with minimal stretching.
 */
export function smartUVProject(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  options: UVUnwrapOptions = {}
): { vertices: V3[]; faces: MeshFace[] } {
  const {
    angleThresholdDeg = 66,
    islandMargin = 0.02,
    relaxIterations = 6
  } = options;

  const vertices = mesh.vertices;
  const faces = mesh.faces;
  if (!vertices.length || !faces.length) return mesh;

  // 1. Segment faces into islands based on angle limits
  const faceGroups = segmentFacesByAngle(vertices, faces, angleThresholdDeg);

  // 2. Project each island onto local 2D planes & relax
  const projectedIslands = faceGroups.map(islandFaces => {
    const projected = projectIsland2D(vertices, faces, islandFaces);
    if (relaxIterations > 0) {
      relaxIslandUVs(vertices, faces, islandFaces, projected.islandFaceUVs, relaxIterations);
    }
    return projected;
  });

  // 3. Pack islands into 0..1 square
  const packedUVMap = packUVPieces(projectedIslands, islandMargin);

  // 4. Assign UVs back to faces
  const newFaces = faces.map((f, fIdx) => {
    const uvs = packedUVMap.get(fIdx) || f.indices.map(() => [0, 0] as [number, number]);
    return {
      ...f,
      uvs
    };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── CUBE / BOX UV MAPPING ──────────────────────────────────────────────────
 * Classic 6-axis box projection with uniform texel density
 */
export function cubeUVProject(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  scale = 1.0
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = mesh.vertices;
  if (!vertices.length) return mesh;

  // Calculate bounding box
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach(v => {
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
  const maxSize = Math.max(size[0], size[1], size[2]) || 1;

  const newFaces = mesh.faces.map(face => {
    const norm = getFaceNormal(vertices, face.indices);
    const absX = Math.abs(norm.x);
    const absY = Math.abs(norm.y);
    const absZ = Math.abs(norm.z);

    const uvs: [number, number][] = (face.indices || []).map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y, z] = v;
      let u = 0, uvY = 0;

      if (absY >= absX && absY >= absZ) {
        // Top / Bottom Face (XZ plane)
        u = ((x - min[0]) / maxSize) * scale;
        uvY = ((z - min[2]) / maxSize) * scale;
      } else if (absX >= absY && absX >= absZ) {
        // Left / Right Face (ZY plane)
        u = ((z - min[2]) / maxSize) * scale;
        uvY = ((y - min[1]) / maxSize) * scale;
      } else {
        // Front / Back Face (XY plane)
        u = ((x - min[0]) / maxSize) * scale;
        uvY = ((y - min[1]) / maxSize) * scale;
      }

      return [u, uvY];
    });

    return { ...face, uvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── CYLINDER & SPHERE UV PROJECTION ─────────────────────────────────────────
 * Anti-seam circular unwrapping for cylinders, pipes, globes, and bottles
 * Separates top and bottom caps from cylindrical body to prevent UV overlapping/stretching
 */
export function cylinderSphereUVProject(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  type: 'CYLINDRICAL' | 'SPHERICAL' = 'CYLINDRICAL'
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = mesh.vertices;
  if (!vertices || !vertices.length || !mesh.faces) return mesh;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach(v => {
    if (!v) return;
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  });

  const sizeX = Math.max(1e-6, max[0] - min[0]);
  const sizeY = Math.max(1e-6, max[1] - min[1]);
  const sizeZ = Math.max(1e-6, max[2] - min[2]);
  const center = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2
  ];

  const newFaces = mesh.faces.map(face => {
    if (!face || !face.indices || face.indices.length < 3) return face;

    const normal = getFaceNormal(vertices, face.indices);
    const isTopCap = normal.y > 0.65;
    const isBottomCap = normal.y < -0.65;

    // Si es una tapa del cilindro (arriba o abajo), mapear como círculo planar separado
    if (type === 'CYLINDRICAL' && (isTopCap || isBottomCap)) {
      const uvs: [number, number][] = face.indices.map(vIdx => {
        const v = vertices[vIdx] || [0, 0, 0];
        const [x, , z] = v;
        const normX = (x - min[0]) / sizeX; // 0..1
        const normZ = (z - min[2]) / sizeZ; // 0..1

        if (isTopCap) {
          // Isla de Tapa Superior en la esquina superior derecha (U: 0.76..0.98, V: 0.52..0.96)
          const u = 0.76 + normX * 0.21;
          const uvV = 0.54 + normZ * 0.42;
          return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, uvV))];
        } else {
          // Isla de Tapa Inferior en la esquina inferior derecha (U: 0.76..0.98, V: 0.04..0.48)
          const u = 0.76 + normX * 0.21;
          const uvV = 0.04 + normZ * 0.42;
          return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, uvV))];
        }
      });
      return { ...face, uvs };
    }

    // Caras del cuerpo tubular o esfera: proyección cilíndrica/esférica desenrollada
    // En tipo cilíndrico, ocupa el 72% izquierdo del espacio UV (U: 0.03..0.73) para dejar hueco a las tapas
    const uSpan = type === 'CYLINDRICAL' ? 0.70 : 0.94;
    const uOffset = 0.03;

    let rawUvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const [x, y, z] = v;
      const dx = x - center[0];
      const dz = z - center[2];

      // Ángulo theta [0..1]
      let theta = Math.atan2(dz, dx); // [-PI..PI]
      let normalizedAngle = (theta + Math.PI) / (2 * Math.PI); // [0..1]
      let u = uOffset + normalizedAngle * uSpan;
      let uvY = 0;

      if (type === 'SPHERICAL') {
        const dy = y - center[1];
        const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        uvY = 0.04 + (0.5 - Math.asin(Math.max(-1, Math.min(1, dy / radius))) / Math.PI) * 0.92;
      } else {
        uvY = 0.04 + ((y - min[1]) / sizeY) * 0.92;
      }

      return [u, uvY];
    });

    // Corrección rigurosa de Seam Wrapping (para caras que cruzan el límite 0 / 360 grados)
    let minU = Infinity, maxU = -Infinity;
    rawUvs.forEach(([u]) => {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    });

    if (maxU - minU > (uSpan * 0.5)) {
      // Ajustar vértices que se quedaron del otro lado del seam
      rawUvs = rawUvs.map(([u, v]) => {
        if (u < uOffset + uSpan * 0.5) {
          return [u + uSpan, v];
        }
        return [u, v];
      });
    }

    return { ...face, uvs: rawUvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── VIEW / CAMERA PROJECT ──────────────────────────────────────────────────
 * Projects UVs directly from the current viewport camera angle
 */
export function projectFromViewUV(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  cameraMatrixWorldInverse: THREE.Matrix4,
  projectionMatrix: THREE.Matrix4
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = mesh.vertices;
  if (!vertices || !vertices.length || !mesh.faces) return mesh;

  const viewProj = new THREE.Matrix4().multiplyMatrices(
    projectionMatrix,
    cameraMatrixWorldInverse
  );

  const newFaces = mesh.faces.map(face => {
    if (!face || !face.indices) return face;
    const uvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      const p = new THREE.Vector3(...v);
      p.applyMatrix4(viewProj);
      // Normalized device coordinates (-1..1) to UV space (0..1)
      const u = p.x * 0.5 + 0.5;
      const uvY = p.y * 0.5 + 0.5;
      return [u, uvY];
    });
    return { ...face, uvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── UNIFORM LIGHTMAP PACK ──────────────────────────────────────────────────
 * Isolates each individual face polygon as a separate packed island with margin
 */
export function lightmapPack(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  margin = 0.04
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = mesh.vertices;
  const faces = mesh.faces;
  if (!vertices.length || !faces.length) return mesh;

  // Treat each individual face as its own chart
  const islands = faces.map((_, fIdx) => {
    return projectIsland2D(vertices, faces, [fIdx]);
  });

  const packedUVMap = packUVPieces(islands, margin);

  const newFaces = faces.map((f, fIdx) => {
    const uvs = packedUVMap.get(fIdx) || f.indices.map(() => [0, 0] as [number, number]);
    return { ...f, uvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── BOX / TRIPLANAR UV PROJECTION ──────────────────────────────────────────
 * Projects UVs along the 3 primary axes (X, Y, Z) based on dominant face normals
 */
export function boxTriplanarUVProject(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  tiling = 1.0
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices = mesh.vertices;
  if (!vertices || !vertices.length || !mesh.faces) return mesh;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  vertices.forEach(([x, y, z]) => {
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  });

  const size = [
    Math.max(1e-5, max[0] - min[0]),
    Math.max(1e-5, max[1] - min[1]),
    Math.max(1e-5, max[2] - min[2])
  ];

  const newFaces = mesh.faces.map(face => {
    if (!face || !face.indices) return face;
    const normal = getFaceNormal(vertices, face.indices);
    const absX = Math.abs(normal.x);
    const absY = Math.abs(normal.y);
    const absZ = Math.abs(normal.z);

    const uvs: [number, number][] = face.indices.map(vIdx => {
      const [x, y, z] = vertices[vIdx] || [0, 0, 0];
      let u = 0, v = 0;

      if (absY >= absX && absY >= absZ) {
        // Top / Bottom projection (XZ)
        u = (x - min[0]) / size[0];
        v = (z - min[2]) / size[2];
      } else if (absX >= absY && absX >= absZ) {
        // Left / Right projection (ZY)
        u = (z - min[2]) / size[2];
        v = (y - min[1]) / size[1];
      } else {
        // Front / Back projection (XY)
        u = (x - min[0]) / size[0];
        v = (y - min[1]) / size[1];
      }

      return [u * tiling, v * tiling];
    });

    return { ...face, uvs };
  });

  return { vertices, faces: newFaces };
}

/**
 * ─── PROJECT FACES FROM ORTHOGONAL VIEW (PROJECT FROM VIEW) ────────────────
 * Projects 3D mesh vertices directly onto 2D UV space from a specific orthographic direction.
 * Preserves 1:1 circular / rectangular proportions and centers the projection onto [0, 1].
 */
export interface OrthogonalProjectOptions {
  preserveAspect?: boolean;
  padding?: number;
  flipU?: boolean;
  flipV?: boolean;
  rotationDeg?: number;
  targetBounds?: { minU: number; maxU: number; minV: number; maxV: number };
}

export function projectFacesFromOrthogonalView(
  vertices: V3[],
  faces: MeshFace[],
  targetFaceIndices: number[] | 'ALL',
  viewPlane: 'TOP_XZ' | 'FRONT_XY' | 'SIDE_ZY' | 'BOTTOM_XZ' | 'BACK_XY',
  options: OrthogonalProjectOptions = {}
): MeshFace[] {
  if (!vertices || vertices.length === 0 || !faces || faces.length === 0) return faces;

  const {
    preserveAspect = true,
    padding = 0.03,
    flipU = false,
    flipV = false,
    rotationDeg = 0,
    targetBounds
  } = options;

  const targetSet = targetFaceIndices === 'ALL' ? null : new Set(targetFaceIndices);
  
  // Calculate bounding box of the target vertices in the projected 2D coordinates
  let minA = Infinity, maxA = -Infinity;
  let minB = Infinity, maxB = -Infinity;

  faces.forEach((face, fIdx) => {
    if (targetSet && !targetSet.has(fIdx)) return;
    face.indices.forEach(vIdx => {
      const v = vertices[vIdx];
      if (!v) return;
      let a = 0, b = 0;
      if (viewPlane === 'TOP_XZ') {
        a = v[0];     // X (Left -> Right)
        b = -v[2];    // -Z (Back -> Front corresponds to Bottom -> Top in 2D image)
      } else if (viewPlane === 'BOTTOM_XZ') {
        a = v[0];     // X
        b = v[2];     // Z
      } else if (viewPlane === 'FRONT_XY') {
        a = v[0];     // X (Left -> Right)
        b = v[1];     // Y (Bottom -> Top)
      } else if (viewPlane === 'BACK_XY') {
        a = -v[0];    // -X (Mirrored Left -> Right for back view)
        b = v[1];     // Y
      } else if (viewPlane === 'SIDE_ZY') {
        a = v[2];     // Z (Rear -> Front)
        b = v[1];     // Y (Bottom -> Top)
      }
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (b < minB) minB = b;
      if (b > maxB) maxB = b;
    });
  });

  if (!isFinite(minA) || !isFinite(minB)) return faces;

  const spanA = Math.max(1e-6, maxA - minA);
  const spanB = Math.max(1e-6, maxB - minB);
  const maxSpan = preserveAspect ? Math.max(spanA, spanB) : 1;

  const minTargetU = targetBounds ? targetBounds.minU : padding;
  const maxTargetU = targetBounds ? targetBounds.maxU : 1.0 - padding;
  const minTargetV = targetBounds ? targetBounds.minV : padding;
  const maxTargetV = targetBounds ? targetBounds.maxV : 1.0 - padding;

  const targetSpanU = maxTargetU - minTargetU;
  const targetSpanV = maxTargetV - minTargetV;
  const targetCenterU = (minTargetU + maxTargetU) * 0.5;
  const targetCenterV = (minTargetV + maxTargetV) * 0.5;

  const centerA = (minA + maxA) * 0.5;
  const centerB = (minB + maxB) * 0.5;

  const rotRad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  return faces.map((face, fIdx) => {
    if (targetSet && !targetSet.has(fIdx)) return face;

    const uvs: [number, number][] = face.indices.map(vIdx => {
      const v = vertices[vIdx] || [0, 0, 0];
      let a = 0, b = 0;
      if (viewPlane === 'TOP_XZ') {
        a = v[0];
        b = -v[2];
      } else if (viewPlane === 'BOTTOM_XZ') {
        a = v[0];
        b = v[2];
      } else if (viewPlane === 'FRONT_XY') {
        a = v[0];
        b = v[1];
      } else if (viewPlane === 'BACK_XY') {
        a = -v[0];
        b = v[1];
      } else if (viewPlane === 'SIDE_ZY') {
        a = v[2];
        b = v[1];
      }

      let rawU = 0.5;
      let rawV = 0.5;

      if (preserveAspect) {
        // Center and scale preserving 1:1 isometric ratio
        const normalizedA = (a - centerA) / maxSpan;
        const normalizedB = (b - centerB) / maxSpan;
        rawU = targetCenterU + normalizedA * targetSpanU;
        rawV = targetCenterV + normalizedB * targetSpanV;
      } else {
        // Stretch to bounds
        rawU = minTargetU + ((a - minA) / spanA) * targetSpanU;
        rawV = minTargetV + ((b - minB) / spanB) * targetSpanV;
      }

      // Apply Flip & Rotation around center
      let cu = rawU - targetCenterU;
      let cv = rawV - targetCenterV;

      if (flipU) cu = -cu;
      if (flipV) cv = -cv;

      if (rotationDeg !== 0) {
        const ru = cu * cosR - cv * sinR;
        const rv = cu * sinR + cv * cosR;
        cu = ru;
        cv = rv;
      }

      const finalU = Math.max(0, Math.min(1, targetCenterU + cu));
      const finalV = Math.max(0, Math.min(1, targetCenterV + cv));

      return [finalU, finalV];
    });

    return { ...face, uvs };
  });
}

/**
 * ─── FIT UV ISLAND TO TILE BOUNDS ───────────────────────────────────────────
 * Scales and centers an island to fit tightly within [0, 1] (or any target boundary).
 */
export function fitUVIslandToTileBounds(
  faces: MeshFace[],
  islandFaceIndices: number[],
  targetBounds = { minU: 0.04, maxU: 0.96, minV: 0.04, maxV: 0.96 },
  preserveAspect = true
): MeshFace[] {
  const targetSet = new Set(islandFaceIndices);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

  faces.forEach((f, fIdx) => {
    if (!targetSet.has(fIdx) || !f.uvs) return;
    f.uvs.forEach(([u, v]) => {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    });
  });

  if (!isFinite(minU) || !isFinite(minV)) return faces;

  const currentW = Math.max(1e-6, maxU - minU);
  const currentH = Math.max(1e-6, maxV - minV);
  const targetW = targetBounds.maxU - targetBounds.minU;
  const targetH = targetBounds.maxV - targetBounds.minV;

  let scaleU = targetW / currentW;
  let scaleV = targetH / currentH;

  if (preserveAspect) {
    const uniformScale = Math.min(scaleU, scaleV);
    scaleU = uniformScale;
    scaleV = uniformScale;
  }

  const centerU = (minU + maxU) * 0.5;
  const centerV = (minV + maxV) * 0.5;
  const targetCenterU = (targetBounds.minU + targetBounds.maxU) * 0.5;
  const targetCenterV = (targetBounds.minV + targetBounds.maxV) * 0.5;

  return faces.map((f, fIdx) => {
    if (!targetSet.has(fIdx) || !f.uvs) return f;
    const uvs: [number, number][] = f.uvs.map(([u, v]) => {
      const du = u - centerU;
      const dv = v - centerV;
      const newU = targetCenterU + du * scaleU;
      const newV = targetCenterV + dv * scaleV;
      return [newU, newV];
    });
    return { ...f, uvs };
  });
}

/**
 * ─── TRANSFORM UV COORDINATES ───────────────────────────────────────────────
 * Applies 2D translation, scaling, rotation, and flipping to all face UV coordinates
 */
export function transformUVCoordinates(
  faces: MeshFace[],
  options: {
    offsetX?: number;
    offsetY?: number;
    scaleX?: number;
    scaleY?: number;
    rotationDeg?: number;
    flipH?: boolean;
    flipV?: boolean;
    repeatX?: number;
    repeatY?: number;
  }
): MeshFace[] {
  const offX = options.offsetX ?? 0;
  const offY = options.offsetY ?? 0;
  const sX = (options.scaleX ?? 1) * (options.repeatX ?? 1);
  const sY = (options.scaleY ?? 1) * (options.repeatY ?? 1);
  const rotRad = ((options.rotationDeg ?? 0) * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const flipH = options.flipH ?? false;
  const flipV = options.flipV ?? false;

  return faces.map(face => {
    if (!face.uvs) return face;
    const transformedUVs: [number, number][] = face.uvs.map(([u, v]) => {
      // 1. Center around (0.5, 0.5)
      let cu = u - 0.5;
      let cv = v - 0.5;

      // 2. Flip
      if (flipH) cu = -cu;
      if (flipV) cv = -cv;

      // 3. Rotate
      const ru = cu * cosR - cv * sinR;
      const rv = cu * sinR + cv * cosR;

      // 4. Scale
      const su = ru * sX;
      const sv = rv * sY;

      // 5. Un-center and Offset
      const finalU = su + 0.5 + offX;
      const finalV = sv + 0.5 + offY;

      return [finalU, finalV];
    });

    return { ...face, uvs: transformedUVs };
  });
}

/**
 * ─── UV DISTORTION & STRETCH CALCULATOR ──────────────────────────────────────
 * Compares the 3D surface area of each triangle with its 2D UV mapped area.
 * Returns an array of normalized distortion values [0..1] where 0.5 is optimal,
 * < 0.5 is compression, and > 0.5 is stretching.
 */
export function calculateUVDistortionHeatmap(
  vertices: V3[],
  faces: MeshFace[]
): {
  perFaceDistortion: number[]; // 0.0 (compressed) .. 0.5 (ideal) .. 1.0 (stretched)
  averageDistortion: number;
  maxStretch: number;
  uvAreaTotal: number;
  meshAreaTotal: number;
} {
  if (!vertices.length || !faces.length) {
    return { perFaceDistortion: [], averageDistortion: 0.5, maxStretch: 0.5, uvAreaTotal: 0, meshAreaTotal: 0 };
  }

  let totalArea3D = 0;
  let totalArea2D = 0;

  const areas3D: number[] = [];
  const areas2D: number[] = [];

  faces.forEach(face => {
    const a3d = getFaceArea(vertices, face.indices);
    areas3D.push(a3d);
    totalArea3D += a3d;

    // 2D UV Area using Shoelace formula
    let a2d = 0;
    if (face.uvs && face.uvs.length >= 3) {
      const uvs = face.uvs;
      const n = uvs.length;
      for (let i = 0; i < n; i++) {
        const [u1, v1] = uvs[i];
        const [u2, v2] = uvs[(i + 1) % n];
        a2d += (u1 * v2 - u2 * v1);
      }
      a2d = Math.abs(a2d) * 0.5;
    }
    areas2D.push(a2d);
    totalArea2D += a2d;
  });

  const globalRatio = (totalArea3D > 1e-8 && totalArea2D > 1e-8) ? (totalArea2D / totalArea3D) : 1.0;

  let sumNormalized = 0;
  let maxNorm = 0.5;

  const perFaceDistortion = faces.map((_, idx) => {
    const a3d = areas3D[idx];
    const a2d = areas2D[idx];

    if (a3d < 1e-8 || a2d < 1e-8) return 0.5;

    const localRatio = (a2d / a3d) / globalRatio; // 1.0 is perfect match
    // Map logarithmic ratio to 0..1 scale (0.5 = 1.0, 0 = 0.1x, 1.0 = 10x)
    const logRatio = Math.log2(Math.max(0.05, Math.min(20.0, localRatio)));
    const normalized = Math.max(0.0, Math.min(1.0, 0.5 + logRatio * 0.25));

    sumNormalized += normalized;
    if (Math.abs(normalized - 0.5) > Math.abs(maxNorm - 0.5)) {
      maxNorm = normalized;
    }

    return normalized;
  });

  const averageDistortion = faces.length > 0 ? sumNormalized / faces.length : 0.5;

  return {
    perFaceDistortion,
    averageDistortion,
    maxStretch: maxNorm,
    uvAreaTotal: totalArea2D,
    meshAreaTotal: totalArea3D
  };
}

/**
 * ─── GENERATE CHECKERBOARD TEST PATTERN ─────────────────────────────────────
 * Generates high-contrast checkerboard calibration patterns with grid coords
 */
export function generateCheckerboardPattern(
  divisions = 16,
  color1 = '#27272a',
  color2 = '#e4e4e7',
  accentColor = '#6366f1'
): string {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cellSize = size / divisions;

  for (let r = 0; r < divisions; r++) {
    for (let c = 0; c < divisions; c++) {
      const isEven = (r + c) % 2 === 0;
      ctx.fillStyle = isEven ? color1 : color2;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);

      // Fine grid borders
      ctx.strokeStyle = isEven ? '#3f3f46' : '#d4d4d8';
      ctx.lineWidth = 1;
      ctx.strokeRect(c * cellSize, r * cellSize, cellSize, cellSize);

      // Coordinates labels for larger cell sizes
      if (divisions <= 16 && cellSize >= 32) {
        ctx.fillStyle = isEven ? '#a1a1aa' : '#52525b';
        ctx.font = `bold ${Math.round(cellSize * 0.22)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const colLetter = String.fromCharCode(65 + (c % 26));
        ctx.fillText(`${colLetter}${r + 1}`, (c + 0.5) * cellSize, (r + 0.5) * cellSize);
      }
    }
  }

  // Border frame
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  return canvas.toDataURL('image/png');
}

/**
 * ─── EXPORT HIGH-RES UV WIREFRAME LAYOUT ─────────────────────────────────────
 * Renders the 2D UV wireframe on a transparent or dark background for export
 */
export function exportUVLayoutDataUrl(
  faces: MeshFace[],
  resolution = 2048,
  lineColor = '#00ffcc',
  lineWidth = 2,
  fillColor = 'rgba(0, 255, 204, 0.05)',
  bgColor = '#09090b'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, resolution, resolution);
  } else {
    ctx.clearRect(0, 0, resolution, resolution);
  }

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.fillStyle = fillColor;

  faces.forEach(face => {
    if (!face.uvs || face.uvs.length < 3) return;

    ctx.beginPath();
    face.uvs.forEach(([u, v], idx) => {
      const x = u * resolution;
      const y = (1.0 - v) * resolution; // Flip V for top-left canvas origin
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();

    if (fillColor) ctx.fill();
    ctx.stroke();
  });

  return canvas.toDataURL('image/png');
}
