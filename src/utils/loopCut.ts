import type { CSGObject, MeshFace, V3 } from '../types';

export interface LoopCutResult {
  success: boolean;
  message: string;
  newObj?: CSGObject;
  newVertexIndices?: number[];
}

export interface LoopCutPreviewSegment {
  p1: V3;
  p2: V3;
  start: V3;
  end: V3;
}

interface QuadLoopStep {
  faceIndex: number;
  // In the quad face [v0, v1, v2, v3], edgeA is (v0, v1) and edgeB is (v3, v2) (opposite)
  // or appropriate indices relative to the face array
  edgeA: [number, number]; // [startVtx, endVtx]
  edgeB: [number, number]; // [oppositeStartVtx, oppositeEndVtx]
}

/**
 * Helper to get the baked vertex position taking offsets into account.
 */
function getBakedVertex(obj: CSGObject, idx: number): V3 {
  const v = obj.vertices[idx];
  if (!v) return [0, 0, 0];
  const off = obj.vertexOffsets?.[idx] || [0, 0, 0];
  return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
}

function lerp(a: V3, b: V3, t: number): V3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Finds the sequence of quad faces and opposing edge pairs that form a continuous edge loop.
 */
export function findQuadLoop(obj: CSGObject, startEdge: [number, number]): {
  steps: QuadLoopStep[];
  isClosed: boolean;
} | null {
  if (!obj.faces || obj.faces.length === 0 || !obj.vertices || obj.vertices.length < 4) {
    return null;
  }

  const [eA, eB] = startEdge;

  // Build edge -> face map
  const edgeToFaces = new Map<string, number[]>();
  obj.faces.forEach((face, fIdx) => {
    const len = face.indices.length;
    for (let i = 0; i < len; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % len];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const list = edgeToFaces.get(key) || [];
      list.push(fIdx);
      edgeToFaces.set(key, list);
    }
  });

  const startKey = eA < eB ? `${eA},${eB}` : `${eB},${eA}`;
  const initialFaces = edgeToFaces.get(startKey);
  if (!initialFaces || initialFaces.length === 0) return null;

  // Analyze a quad face to find its opposing edge given one edge
  function analyzeQuad(faceIdx: number, edgeStart: number, edgeEnd: number): QuadLoopStep | null {
    const face = obj.faces[faceIdx];
    if (!face || face.indices.length !== 4) return null; // Loops specifically propagate across quad topology

    const idxs = face.indices;
    let pos = -1;
    for (let i = 0; i < 4; i++) {
      const a = idxs[i];
      const b = idxs[(i + 1) % 4];
      if ((a === edgeStart && b === edgeEnd) || (a === edgeEnd && b === edgeStart)) {
        pos = i;
        break;
      }
    }

    if (pos === -1) return null;

    // In a quad [0, 1, 2, 3]:
    // If edge is at pos (idxs[pos] -> idxs[(pos+1)%4]),
    // the opposing edge is at (pos+2)%4 -> (pos+3)%4
    const v0 = idxs[pos];
    const v1 = idxs[(pos + 1) % 4];
    const v2 = idxs[(pos + 2) % 4];
    const v3 = idxs[(pos + 3) % 4];

    // Maintain consistent orientation across the quad:
    // v0 corresponds to v3 (left side), v1 corresponds to v2 (right side)
    // If given edgeStart == v0, then edgeA = [v0, v1] and edgeB = [v3, v2]
    if (v0 === edgeStart && v1 === edgeEnd) {
      return {
        faceIndex: faceIdx,
        edgeA: [v0, v1],
        edgeB: [v3, v2],
      };
    } else {
      return {
        faceIndex: faceIdx,
        edgeA: [v1, v0],
        edgeB: [v2, v3],
      };
    }
  }

  // Walk in forward direction from first face
  const firstFace = initialFaces[0];
  const firstStep = analyzeQuad(firstFace, eA, eB);
  if (!firstStep) return null;

  const steps: QuadLoopStep[] = [firstStep];
  const visitedFaces = new Set<number>([firstFace]);
  let isClosed = false;

  // Forward traversal
  let currentStep = firstStep;
  while (true) {
    const [oppA, oppB] = currentStep.edgeB;
    const oppKey = oppA < oppB ? `${oppA},${oppB}` : `${oppB},${oppA}`;
    const neighborFaces = edgeToFaces.get(oppKey) || [];

    const nextFace = neighborFaces.find(f => !visitedFaces.has(f));
    if (nextFace === undefined) {
      // Check if it wrapped back to start
      if (neighborFaces.includes(firstFace) && steps.length > 2) {
        isClosed = true;
      }
      break;
    }

    const nextStep = analyzeQuad(nextFace, oppA, oppB);
    if (!nextStep) break;

    visitedFaces.add(nextFace);
    steps.push(nextStep);
    currentStep = nextStep;
  }

  // If not closed and there was a second face adjacent to the start edge, walk backwards
  if (!isClosed && initialFaces.length > 1) {
    const secondFace = initialFaces[1];
    if (!visitedFaces.has(secondFace)) {
      const backFirst = analyzeQuad(secondFace, eA, eB);
      if (backFirst) {
        visitedFaces.add(secondFace);
        const backSteps: QuadLoopStep[] = [backFirst];
        let curBack = backFirst;

        while (true) {
          const [oppA, oppB] = curBack.edgeB;
          const oppKey = oppA < oppB ? `${oppA},${oppB}` : `${oppB},${oppA}`;
          const neighborFaces = edgeToFaces.get(oppKey) || [];
          const nextFace = neighborFaces.find(f => !visitedFaces.has(f));
          if (nextFace === undefined) break;

          const nextStep = analyzeQuad(nextFace, oppA, oppB);
          if (!nextStep) break;

          visitedFaces.add(nextFace);
          backSteps.push(nextStep);
          curBack = nextStep;
        }

        // Prepend reversed backSteps
        steps.unshift(...backSteps.reverse());
      }
    }
  }

  return { steps, isClosed };
}

/**
 * Generates 3D line segments for the loop cut preview to display in the viewport.
 */
export function getLoopCutPreview(
  obj: CSGObject,
  edge: [number, number],
  cuts: number = 1,
  slide: number = 0.5
): LoopCutPreviewSegment[] {
  const loopInfo = findQuadLoop(obj, edge);
  if (!loopInfo || loopInfo.steps.length === 0) {
    // Fallback: at least preview the cut across the single edge
    const pA = getBakedVertex(obj, edge[0]);
    const pB = getBakedVertex(obj, edge[1]);
    const mid = lerp(pA, pB, Math.max(0.01, Math.min(0.99, slide)));
    return [{ p1: pA, p2: pB, start: pA, end: pB }];
  }

  const clampedCuts = Math.max(1, Math.min(16, cuts));
  const segments: LoopCutPreviewSegment[] = [];

  for (let c = 0; c < clampedCuts; c++) {
    // Calculate factor t for this cut
    let t = 0.5;
    if (clampedCuts === 1) {
      t = Math.max(0.02, Math.min(0.98, slide));
    } else {
      const baseT = (c + 1) / (clampedCuts + 1);
      const slideOffset = (slide - 0.5) * 0.8;
      t = Math.max(0.02, Math.min(0.98, baseT + slideOffset));
    }

    loopInfo.steps.forEach(step => {
      const pA0 = getBakedVertex(obj, step.edgeA[0]);
      const pA1 = getBakedVertex(obj, step.edgeA[1]);
      const pB0 = getBakedVertex(obj, step.edgeB[0]);
      const pB1 = getBakedVertex(obj, step.edgeB[1]);

      const cutStart = lerp(pA0, pA1, t);
      const cutEnd = lerp(pB0, pB1, t);

      segments.push({ p1: cutStart, p2: cutEnd, start: cutStart, end: cutEnd });
    });
  }

  return segments;
}

/**
 * Executes Blender-style Loop Cut and Slide on the specified mesh and edge.
 */
export function executeLoopCut(
  obj: CSGObject,
  edge: [number, number],
  cuts: number = 1,
  slide: number = 0.5
): LoopCutResult {
  const loopInfo = findQuadLoop(obj, edge);
  if (!loopInfo || loopInfo.steps.length === 0) {
    return {
      success: false,
      message: 'No se encontró un bucle de caras cuadriláteras (Quads) conectadas para cortar.',
    };
  }

  const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
  newObj.type = 'MESH';
  newObj.vertices = newObj.vertices.map((_, i) => getBakedVertex(obj, i));
  newObj.vertexOffsets = {};

  const clampedCuts = Math.max(1, Math.min(16, cuts));

  // Map to reuse split vertices along shared edges:
  // key: "minVtx,maxVtx,cutIndex" -> new vertex index
  const edgeCutVertexMap = new Map<string, number>();
  const createdVertexIndices: number[] = [];

  function getOrCreateSplitVertex(vStart: number, vEnd: number, cutT: number, cutIndex: number): number {
    const minV = Math.min(vStart, vEnd);
    const maxV = Math.max(vStart, vEnd);
    const key = `${minV},${maxV},${cutIndex}`;

    if (edgeCutVertexMap.has(key)) {
      return edgeCutVertexMap.get(key)!;
    }

    const p0 = getBakedVertex(obj, vStart);
    const p1 = getBakedVertex(obj, vEnd);
    const splitPos = lerp(p0, p1, cutT);

    const newIdx = newObj.vertices.length;
    newObj.vertices.push(splitPos);
    edgeCutVertexMap.set(key, newIdx);
    createdVertexIndices.push(newIdx);
    return newIdx;
  }

  const loopFaceIndices = new Set<number>(loopInfo.steps.map(s => s.faceIndex));
  const newFaces: MeshFace[] = [];

  // Retain all non-loop faces
  obj.faces.forEach((face, fIdx) => {
    if (!loopFaceIndices.has(fIdx)) {
      newFaces.push(face);
    }
  });

  // For each quad in the loop, subdivide into (cuts + 1) quads
  loopInfo.steps.forEach(step => {
    const face = obj.faces[step.faceIndex];
    if (!face || face.indices.length !== 4) return;

    const [v0, v1] = step.edgeA;
    const [v3, v2] = step.edgeB;

    // Collect all ladder vertices from edgeA to edgeB
    const topChain: number[] = [v0];
    const botChain: number[] = [v3];

    for (let c = 0; c < clampedCuts; c++) {
      let t = 0.5;
      if (clampedCuts === 1) {
        t = Math.max(0.02, Math.min(0.98, slide));
      } else {
        const baseT = (c + 1) / (clampedCuts + 1);
        const slideOffset = (slide - 0.5) * 0.8;
        t = Math.max(0.02, Math.min(0.98, baseT + slideOffset));
      }

      // top vertex on (v0 -> v1)
      const topVtx = getOrCreateSplitVertex(v0, v1, t, c);
      topChain.push(topVtx);

      // bottom vertex on (v3 -> v2)
      const botVtx = getOrCreateSplitVertex(v3, v2, t, c);
      botChain.push(botVtx);
    }

    topChain.push(v1);
    botChain.push(v2);

    // Build the sub-quads
    for (let i = 0; i < topChain.length - 1; i++) {
      const subQuad: MeshFace = {
        indices: [topChain[i], topChain[i + 1], botChain[i + 1], botChain[i]],
        materialIndex: face.materialIndex,
      };
      newFaces.push(subQuad);
    }
  });

  newObj.faces = newFaces;
  delete newObj.wireframeEdges;
  newObj.vertexOffsets = {};
  newObj.parameters = {};

  return {
    success: true,
    message: `Corte en Bucle (Loop Cut) aplicado con éxito: ${clampedCuts} bucle(s) insertado(s) a través de ${loopInfo.steps.length} caras.`,
    newObj,
    newVertexIndices: createdVertexIndices,
  };
}
