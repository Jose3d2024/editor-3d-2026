/**
 * geometry.ts — generatePrimitive
 *
 * Returns { vertices: V3[], faces: MeshFace[] } for every primitive type.
 *
 * KEY DESIGN RULE: flat primitives (PLANE, RING, CIRCLE) use QUAD faces so the
 * wireframe overlay never shows the internal triangulation diagonal.
 * For solid 3-D primitives we extract from Three.js and merge triangle pairs
 * back into quads wherever BoxGeometry emits them in the standard (a,b,d)+(b,c,d) pattern.
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { V3, MeshFace, BezierHandle } from '../types';
import {
  createDefaultNurbsCurve,
  createDefaultNurbsCircle,
  createDefaultNurbsSurface,
  createDefaultNurbsCylinder,
  createDefaultNurbsCone,
  createDefaultNurbsSphere,
  createDefaultNurbsTorus,
  tessellateNurbsSurface,
  tessellateNurbsCurveToMesh,
} from './nurbs';
import {
  DEFAULT_PARTICLE_CONFIG,
  DEFAULT_SPACE_WARP_CONFIG,
  buildParticleEmitterGizmo,
  buildSpaceWarpGizmo,
} from './particleSystem';
import {
  DEFAULT_GPGPU_SWARM_CONFIG,
  buildGpgpuSwarmGizmo,
} from './gpgpuSwarm';

// PrimitiveType is a union string – we avoid importing the enum to keep this file lightweight.
type PT = string;
interface PrimitiveGeom { vertices: V3[]; faces: MeshFace[]; }

// ─── helpers ────────────────────────────────────────────────────────────────

/** Round float to 6 decimal places to avoid floating-point duplicates */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Deduplicate vertices and remap face indices */
function weldVertices(rawVerts: V3[], faces: MeshFace[]): PrimitiveGeom {
  const map = new Map<string, number>();
  const verts: V3[] = [];
  const remap = rawVerts.map(v => {
    const key = `${r6(v[0])},${r6(v[1])},${r6(v[2])}`;
    if (!map.has(key)) { map.set(key, verts.length); verts.push(v); }
    return map.get(key)!;
  });
  return {
    vertices: verts,
    faces: faces.map(f => ({ ...f, indices: f.indices.map(i => remap[i]) })),
  };
}

/**
 * Merge coplanar triangles in a triangulated mesh to create clean quads/polygons
 * without internal crossed/diagonal lines.
 */
function mergeCoplanarTriangles(rawVerts: V3[], rawFaces: MeshFace[]): PrimitiveGeom {
  const welded = weldVertices(rawVerts, rawFaces);
  const { vertices, faces } = welded;

  // Group adjacent faces by coplanar normal and plane distance
  const faceNormals: (THREE.Vector3 | null)[] = faces.map(f => {
    if (f.indices.length < 3) return null;
    const p0 = vertices[f.indices[0]];
    const p1 = vertices[f.indices[1]];
    const p2 = vertices[f.indices[2]];
    if (!p0 || !p1 || !p2) return null;
    const v0 = new THREE.Vector3(...p0);
    const v1 = new THREE.Vector3(...p1);
    const v2 = new THREE.Vector3(...p2);
    const n = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v1, v0), new THREE.Vector3().subVectors(v2, v0));
    if (n.lengthSq() < 1e-10) return null;
    return n.normalize();
  });

  const planeKey = (idx: number) => {
    const n = faceNormals[idx];
    if (!n) return `null_${idx}`;
    const p = vertices[faces[idx].indices[0]];
    const d = -n.dot(new THREE.Vector3(...p));
    return `${r6(n.x)},${r6(n.y)},${r6(n.z)},${r6(d)}`;
  };

  const planeGroups = new Map<string, number[]>();
  faces.forEach((_, idx) => {
    const key = planeKey(idx);
    let g = planeGroups.get(key);
    if (!g) { g = []; planeGroups.set(key, g); }
    g.push(idx);
  });

  const finalFaces: MeshFace[] = [];

  planeGroups.forEach((faceIndices) => {
    if (faceIndices.length === 1) {
      finalFaces.push(faces[faceIndices[0]]);
      return;
    }

    // Extract all directed half-edges of the coplanar group
    const edgeCount = new Map<string, { from: number; to: number; count: number }>();
    const keyEdge = (a: number, b: number) => `${a}->${b}`;

    faceIndices.forEach(fIdx => {
      const f = faces[fIdx];
      for (let i = 0; i < f.indices.length; i++) {
        const a = f.indices[i];
        const b = f.indices[(i + 1) % f.indices.length];
        const k = keyEdge(a, b);
        const cur = edgeCount.get(k) || { from: a, to: b, count: 0 };
        cur.count++;
        edgeCount.set(k, cur);
      }
    });

    // Boundary edges: edges whose reverse does not exist in the same coplanar group
    const boundaryEdges: { from: number; to: number }[] = [];
    edgeCount.forEach((info) => {
      const revKey = keyEdge(info.to, info.from);
      if (!edgeCount.has(revKey)) {
        boundaryEdges.push({ from: info.from, to: info.to });
      }
    });

    if (boundaryEdges.length === 0) {
      faceIndices.forEach(fIdx => finalFaces.push(faces[fIdx]));
      return;
    }

    // Reconstruct outer boundary loops
    const adj = new Map<number, number>();
    boundaryEdges.forEach(e => { adj.set(e.from, e.to); });

    const visited = new Set<number>();
    boundaryEdges.forEach(e => {
      if (visited.has(e.from)) return;
      const loop: number[] = [];
      let curr = e.from;
      let safeCount = 0;
      while (curr !== undefined && !visited.has(curr) && safeCount < 500) {
        visited.add(curr);
        loop.push(curr);
        curr = adj.get(curr)!;
        if (curr === e.from) break;
        safeCount++;
      }
      if (loop.length >= 3) {
        finalFaces.push({ indices: loop });
      }
    });
  });

  return { vertices, faces: finalFaces.length > 0 ? finalFaces : faces };
}

/**
 * Extract vertices + triangle faces from a Three.js indexed geometry,
 * then merge coplanar triangle pairs into clean quads and polygons.
 */
function extractAndMergeQuads(geo: THREE.BufferGeometry): PrimitiveGeom {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
  const rawVerts: V3[] = [];
  for (let i = 0; i < pos.count; i++) rawVerts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);

  const faces: MeshFace[] = [];
  const idx = geo.index;

  const getUVs = (indices: number[]) => {
    if (!uvAttr) return undefined;
    return indices.map(i => [uvAttr.getX(i), uvAttr.getY(i)] as [number, number]);
  };

  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i+1), c = idx.getX(i+2);
      faces.push({ indices: [a, b, c], uvs: getUVs([a, b, c]) });
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const indices = [i, i+1, i+2];
      faces.push({ indices, uvs: getUVs(indices) });
    }
  }

  return mergeCoplanarTriangles(rawVerts, faces);
}

// ─── Pristine 3D Primitives with 100% Clean Non-Crossed Quad Faces ──────────

/**
 * CUBE / BOX: 8 vertices, 6 pure Quad faces (no crossed diagonals)
 * Or subdivided N×N quads per face if segments > 1.
 */
function buildCube(N: number, size: number = 1.0): PrimitiveGeom {
  N = Math.max(1, Math.round(N));
  const s = size / 2;

  if (N === 1) {
    const vertices: V3[] = [
      [-s, -s,  s], // 0: front bottom-left
      [ s, -s,  s], // 1: front bottom-right
      [ s,  s,  s], // 2: front top-right
      [-s,  s,  s], // 3: front top-left
      [-s, -s, -s], // 4: back bottom-left
      [ s, -s, -s], // 5: back bottom-right
      [ s,  s, -s], // 6: back top-right
      [-s,  s, -s], // 7: back top-left
    ];

    const faces: MeshFace[] = [
      { indices: [0, 1, 2, 3], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Front  (+Z)
      { indices: [5, 4, 7, 6], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Back   (-Z)
      { indices: [3, 2, 6, 7], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Top    (+Y)
      { indices: [4, 5, 1, 0], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Bottom (-Y)
      { indices: [1, 5, 6, 2], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Right  (+X)
      { indices: [4, 0, 3, 7], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, // Left   (-X)
    ];

    return { vertices, faces };
  }

  // Subdivided cube with NxN pure quads on each of the 6 sides
  const rawVerts: V3[] = [];
  const rawFaces: MeshFace[] = [];

  const addSide = (uDir: V3, vDir: V3, origin: V3) => {
    const baseIdx = rawVerts.length;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = j / N;
        rawVerts.push([
          origin[0] + uDir[0] * u + vDir[0] * v,
          origin[1] + uDir[1] * u + vDir[1] * v,
          origin[2] + uDir[2] * u + vDir[2] * v,
        ]);
      }
    }
    const stride = N + 1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = baseIdx + j * stride + i;
        const b = a + 1;
        const c = a + stride + 1;
        const d = a + stride;
        rawFaces.push({ indices: [a, b, c, d] });
      }
    }
  };

  // 6 sides
  addSide([size, 0, 0], [0, size, 0], [-s, -s, s]);   // Front
  addSide([-size, 0, 0], [0, size, 0], [s, -s, -s]);  // Back
  addSide([size, 0, 0], [0, 0, -size], [-s, s, s]);   // Top
  addSide([size, 0, 0], [0, 0, size], [-s, -s, -s]);  // Bottom
  addSide([0, 0, -size], [0, size, 0], [s, -s, s]);   // Right
  addSide([0, 0, size], [0, size, 0], [-s, -s, -s]);  // Left

  return weldVertices(rawVerts, rawFaces);
}

/**
 * PYRAMID: Clean quad base (no crossed diagonals) + 4 triangular sides
 */
function buildPyramid(heightSegments: number = 1, radius: number = 0.5, height: number = 1.0): PrimitiveGeom {
  const halfH = height / 2;
  const verts: V3[] = [
    [-radius, -halfH,  radius], // 0: base front-left
    [ radius, -halfH,  radius], // 1: base front-right
    [ radius, -halfH, -radius], // 2: base back-right
    [-radius, -halfH, -radius], // 3: base back-left
    [0, halfH, 0],              // 4: apex
  ];

  const faces: MeshFace[] = [
    { indices: [3, 2, 1, 0] }, // Base (clean Quad, no diagonal)
    { indices: [0, 1, 4] },    // Front side
    { indices: [1, 2, 4] },    // Right side
    { indices: [2, 3, 4] },    // Back side
    { indices: [3, 0, 4] },    // Left side
  ];

  return { vertices: verts, faces };
}

/**
 * PRISM (Triangular): 2 clean triangle caps + 3 clean quad sides (no crossed diagonals)
 */
function buildPrism(heightSegments: number = 1, radius: number = 0.5, height: number = 1.0): PrimitiveGeom {
  const halfH = height / 2;
  const verts: V3[] = [];

  // 3 top vertices, 3 bottom vertices
  for (let i = 0; i < 3; i++) {
    const theta = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const cos = Math.cos(theta) * radius;
    const sin = Math.sin(theta) * radius;
    verts.push([cos, halfH, sin]);  // 0, 1, 2 (Top)
    verts.push([cos, -halfH, sin]); // 3, 4, 5 (Bottom)
  }

  const faces: MeshFace[] = [
    { indices: [0, 2, 4] },    // Top cap
    { indices: [5, 3, 1] },    // Bottom cap
    { indices: [0, 1, 3, 2] }, // Side 0 (clean Quad)
    { indices: [2, 3, 5, 4] }, // Side 1 (clean Quad)
    { indices: [4, 5, 1, 0] }, // Side 2 (clean Quad)
  ];

  return weldVertices(verts, faces);
}

/**
 * CYLINDER: Clean quad sides (no crossed diagonals) + 2 clean cap polygons
 */
function buildCylinder(segments: number = 16, heightSegments: number = 1, radius: number = 0.5, height: number = 1.0): PrimitiveGeom {
  segments = Math.max(3, Math.round(segments));
  heightSegments = Math.max(1, Math.round(heightSegments));
  const halfH = height / 2;
  const verts: V3[] = [];

  for (let h = 0; h <= heightSegments; h++) {
    const y = halfH - (h / heightSegments) * height;
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      verts.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
    }
  }

  const faces: MeshFace[] = [];

  // Top cap (clean polygon)
  const topIndices = Array.from({ length: segments }, (_, i) => i);
  faces.push({ indices: topIndices });

  // Bottom cap (clean polygon)
  const botBase = heightSegments * segments;
  const botIndices = Array.from({ length: segments }, (_, i) => botBase + (segments - 1 - i));
  faces.push({ indices: botIndices });

  // Sides (pure Quads)
  for (let h = 0; h < heightSegments; h++) {
    const r0 = h * segments;
    const r1 = (h + 1) * segments;
    for (let i = 0; i < segments; i++) {
      const nextI = (i + 1) % segments;
      faces.push({ indices: [r0 + i, r0 + nextI, r1 + nextI, r1 + i] });
    }
  }

  return weldVertices(verts, faces);
}

/**
 * CONE: Clean triangular sides + 1 clean base polygon
 */
function buildCone(segments: number = 16, heightSegments: number = 1, radius: number = 0.5, height: number = 1.0): PrimitiveGeom {
  segments = Math.max(3, Math.round(segments));
  const halfH = height / 2;
  const verts: V3[] = [[0, halfH, 0]]; // 0: Apex

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    verts.push([Math.cos(theta) * radius, -halfH, Math.sin(theta) * radius]);
  }

  const faces: MeshFace[] = [];

  // Base cap (clean polygon)
  const baseIndices = Array.from({ length: segments }, (_, i) => segments - i);
  faces.push({ indices: baseIndices });

  // Sides (triangles connecting apex to base ring)
  for (let i = 0; i < segments; i++) {
    const curr = 1 + i;
    const next = 1 + ((i + 1) % segments);
    faces.push({ indices: [0, curr, next] });
  }

  return weldVertices(verts, faces);
}

/**
 * TORUS: Pure clean quad grid across all rings
 */
function buildTorus(radius: number = 0.5, tube: number = 0.2, radialSegments: number = 16, tubularSegments: number = 32): PrimitiveGeom {
  radialSegments = Math.max(3, Math.round(radialSegments));
  tubularSegments = Math.max(4, Math.round(tubularSegments));
  const verts: V3[] = [];

  for (let j = 0; j < radialSegments; j++) {
    const u = (j / radialSegments) * Math.PI * 2;
    for (let i = 0; i < tubularSegments; i++) {
      const v = (i / tubularSegments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = tube * Math.sin(v);
      const z = (radius + tube * Math.cos(v)) * Math.sin(u);
      verts.push([x, y, z]);
    }
  }

  const faces: MeshFace[] = [];
  for (let j = 0; j < radialSegments; j++) {
    const nextJ = (j + 1) % radialSegments;
    for (let i = 0; i < tubularSegments; i++) {
      const nextI = (i + 1) % tubularSegments;
      const a = j * tubularSegments + i;
      const b = nextJ * tubularSegments + i;
      const c = nextJ * tubularSegments + nextI;
      const d = j * tubularSegments + nextI;
      faces.push({ indices: [a, b, c, d] });
    }
  }

  return weldVertices(verts, faces);
}

// ─── Flat primitives with hand-built quad topology ──────────────────────────

/** PLANE: (N+1)×(N+1) grid in XZ plane (y=0), N×N quads */
function buildPlane(N: number): PrimitiveGeom {
  N = Math.max(1, N);
  const verts: V3[] = [];
  for (let row = 0; row <= N; row++) {
    for (let col = 0; col <= N; col++) {
      verts.push([col / N - 0.5, 0, row / N - 0.5]);
    }
  }
  const stride = N + 1;
  const faces: MeshFace[] = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const a = row * stride + col;
      const b = a + 1;
      const c = a + stride + 1;
      const d = a + stride;
      faces.push({ indices: [a, b, c, d] });
    }
  }
  return { vertices: verts, faces };
}

/** RING: N quads connecting inner ring to outer ring */
function buildRing(inner: number, outer: number, N: number): PrimitiveGeom {
  N = Math.max(3, N);
  const verts: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * Math.PI * 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    verts.push([cos * inner, 0, sin * inner]); // inner
    verts.push([cos * outer, 0, sin * outer]); // outer
  }
  const faces: MeshFace[] = [];
  for (let i = 0; i < N; i++) {
    const i0 = i * 2, o0 = i * 2 + 1;
    const i1 = (i + 1) * 2, o1 = (i + 1) * 2 + 1;
    faces.push({ indices: [i0, o0, o1, i1] });
  }
  return weldVertices(verts, faces);
}

/** CIRCLE: N triangular sectors (fan) */
function buildCircle(radius: number, N: number): PrimitiveGeom {
  N = Math.max(3, N);
  const verts: V3[] = [[0, 0, 0]]; // center at 0
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * Math.PI * 2;
    verts.push([Math.cos(theta) * radius, 0, Math.sin(theta) * radius]);
  }
  const faces: MeshFace[] = [];
  for (let i = 0; i < N; i++) {
    faces.push({ indices: [0, i + 1, i + 2] });
  }
  return weldVertices(verts, faces);
}

/** TUBE: 3D hollow pipe with inner/outer walls and ring caps */
function buildTube(inner: number, outer: number, height: number, N: number): PrimitiveGeom {
  N = Math.max(3, N);
  const halfH = height / 2;
  const verts: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * Math.PI * 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    verts.push([cos * outer, halfH, sin * outer]); // top outer
    verts.push([cos * inner, halfH, sin * inner]); // top inner
    verts.push([cos * outer, -halfH, sin * outer]); // bottom outer
    verts.push([cos * inner, -halfH, sin * inner]); // bottom inner
  }
  const faces: MeshFace[] = [];
  for (let i = 0; i < N; i++) {
    const oT0 = i * 4,     iT0 = i * 4 + 1;
    const oB0 = i * 4 + 2, iB0 = i * 4 + 3;
    const oT1 = (i + 1) * 4,     iT1 = (i + 1) * 4 + 1;
    const oB1 = (i + 1) * 4 + 2, iB1 = (i + 1) * 4 + 3;

    faces.push({ indices: [oT0, oT1, iT1, iT0] }); // top cap
    faces.push({ indices: [oB0, iB0, iB1, oB1] }); // bottom cap
    faces.push({ indices: [oT0, oB0, oB1, oT1] }); // outer wall
    faces.push({ indices: [iT0, iT1, iB1, iB0] }); // inner wall
  }
  return weldVertices(verts, faces);
}

/** WEDGE: 3D ramp / triangular prism */
function buildWedge(): PrimitiveGeom {
  const verts: V3[] = [
    [-0.5, -0.5,  0.5], // 0: bottom-left-front
    [ 0.5, -0.5,  0.5], // 1: bottom-right-front
    [-0.5,  0.5,  0.5], // 2: top-left-front
    [-0.5, -0.5, -0.5], // 3: bottom-left-back
    [ 0.5, -0.5, -0.5], // 4: bottom-right-back
    [-0.5,  0.5, -0.5], // 5: top-left-back
  ];
  const faces: MeshFace[] = [
    { indices: [0, 1, 4, 3] }, // Bottom
    { indices: [0, 3, 5, 2] }, // Back
    { indices: [1, 2, 5, 4] }, // Ramp
    { indices: [0, 2, 1] },    // Front
    { indices: [3, 4, 5] },    // Back triangle
  ];
  return weldVertices(verts, faces);
}

/** ARC: 3D hollow pipe segment spanning specified degrees (0° - 360°) */
function buildArc(inner: number, outer: number, arcAngleDeg: number, height: number, N: number): PrimitiveGeom {
  N = Math.max(3, N);
  const angleRad = (Math.max(1, Math.min(360, arcAngleDeg)) * Math.PI) / 180;
  const isClosedLoop = Math.abs(arcAngleDeg - 360) < 0.1;
  const halfH = height / 2;

  const verts: V3[] = [];
  for (let i = 0; i <= N; i++) {
    const theta = (i / N) * angleRad;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    verts.push([cos * outer, halfH, sin * outer]);  // top outer
    verts.push([cos * inner, halfH, sin * inner]);  // top inner
    verts.push([cos * outer, -halfH, sin * outer]); // bottom outer
    verts.push([cos * inner, -halfH, sin * inner]); // bottom inner
  }

  const faces: MeshFace[] = [];
  for (let i = 0; i < N; i++) {
    const oT0 = i * 4,     iT0 = i * 4 + 1;
    const oB0 = i * 4 + 2, iB0 = i * 4 + 3;
    const oT1 = (i + 1) * 4,     iT1 = (i + 1) * 4 + 1;
    const oB1 = (i + 1) * 4 + 2, iB1 = (i + 1) * 4 + 3;

    faces.push({ indices: [oT0, oT1, iT1, iT0] }); // top cap
    faces.push({ indices: [oB0, iB0, iB1, oB1] }); // bottom cap
    faces.push({ indices: [oT0, oB0, oB1, oT1] }); // outer wall
    faces.push({ indices: [iT0, iT1, iB1, iB0] }); // inner wall
  }

  if (!isClosedLoop) {
    faces.push({ indices: [0, 1, 3, 2] });
    const n4 = N * 4;
    faces.push({ indices: [n4, n4 + 2, n4 + 3, n4 + 1] });
  }

  return weldVertices(verts, faces);
}

/** STAR: 3D extruded star with customizable number of points (puntas) */
function buildStar(points: number, inner: number, outer: number, height: number): PrimitiveGeom {
  points = Math.max(3, Math.round(points));
  const numVerts = points * 2;
  const halfH = height / 2;
  const verts: V3[] = [];

  const topCenterIdx = 0;
  const bottomCenterIdx = 1;
  verts.push([0, halfH, 0]);  // 0: top center
  verts.push([0, -halfH, 0]); // 1: bottom center

  for (let i = 0; i < numVerts; i++) {
    const theta = (i / numVerts) * Math.PI * 2;
    const r = (i % 2 === 0) ? outer : inner;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    verts.push([cos * r, halfH, sin * r]);  // top ring vertex
    verts.push([cos * r, -halfH, sin * r]); // bottom ring vertex
  }

  const faces: MeshFace[] = [];
  for (let i = 0; i < numVerts; i++) {
    const nextI = (i + 1) % numVerts;
    const topCurr = 2 + i * 2;
    const botCurr = 2 + i * 2 + 1;
    const topNext = 2 + nextI * 2;
    const botNext = 2 + nextI * 2 + 1;

    // Tapa superior (visto desde +Y hacia abajo, sentido antihorario: centro -> siguiente -> actual)
    faces.push({ indices: [topCenterIdx, topNext, topCurr] });
    // Tapa inferior (visto desde -Y hacia arriba, sentido antihorario: centro -> actual -> siguiente)
    faces.push({ indices: [bottomCenterIdx, botCurr, botNext] });
    // Pared exterior (normal hacia afuera del objeto: actual arriba -> siguiente arriba -> siguiente abajo -> actual abajo)
    faces.push({ indices: [topCurr, topNext, botNext, botCurr] });
  }

  return weldVertices(verts, faces);
}

/**
 * Extrude a 2D profile along an axis.
 * If profileBezierHandles is provided, it samples the curve first.
 */
function buildExtrusion(p: Record<string, any>): PrimitiveGeom {
  const depth = p.extrusionDepth ?? 0;
  const axis = p.extrusionAxis ?? 'y';
  const closed = p.closed ?? false;
  const segments = Math.max(1, Math.round(p.segments ?? 16));
  
  let profile: V3[] = p.profileVertices ?? [];
  const handles: BezierHandle[] = p.profileBezierHandles ?? [];

  // ── Sample Bezier if needed ─────────────────────────────────────────────
  const hasHandles = handles.length > 0 && handles.some(h => 
    h.out[0] !== 0 || h.out[1] !== 0 || h.out[2] !== 0 || 
    h.in[0] !== 0 || h.in[1] !== 0 || h.in[2] !== 0
  );

  if (hasHandles && profile.length >= 2) {
    const ctrlPts = profile.map(v => new THREE.Vector3(v[0], v[1], v[2]));
    const allPts: THREE.Vector3[] = [];
    const segCount = closed ? ctrlPts.length : ctrlPts.length - 1;
    
    for (let i = 0; i < segCount; i++) {
      const i1 = (i + 1) % ctrlPts.length;
      const p0 = ctrlPts[i];
      const hOut = handles[i]?.out ?? [0,0,0];
      const hIn = handles[i1]?.in ?? [0,0,0];
      
      const p1 = p0.clone().add(new THREE.Vector3(...hOut));
      const p3 = ctrlPts[i1];
      const p2 = p3.clone().add(new THREE.Vector3(...hIn));
      
      // If both handles are zero, it's a straight line
      if (hOut[0] === 0 && hOut[1] === 0 && hOut[2] === 0 && 
          hIn[0] === 0 && hIn[1] === 0 && hIn[2] === 0) {
        allPts.push(p0);
      } else {
        const seg = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
        const pts = seg.getPoints(segments);
        if (allPts.length > 0) pts.shift();
        allPts.push(...pts);
      }
    }
    // Add last point for non-closed
    if (!closed) {
      allPts.push(ctrlPts[ctrlPts.length - 1]);
    }
    
    // Remove duplicate endpoint if closed
    if (closed && allPts.length > 1 && allPts[0].distanceTo(allPts[allPts.length - 1]) < 0.001)
      allPts.pop();
    profile = allPts.map(pt => [pt.x, pt.y, pt.z] as V3);
  }

  const n = profile.length;
  if (n < 3) return { vertices: [], faces: [] };

  // ── Build 3D mesh ───────────────────────────────────────────────────────
  const depthSegments = Math.max(1, Math.round(p.depthSegments ?? 1));
  const vertices: V3[] = [];
  
  for (let s = 0; s <= depthSegments; s++) {
    const t = s / depthSegments;
    profile.forEach(v => {
      const newV: V3 = [...v];
      const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      newV[idx] += depth * t;
      vertices.push(newV);
    });
  }

  const faces: MeshFace[] = [];
  // Bottom cap
  faces.push({ indices: Array.from({ length: n }, (_, i) => n - 1 - i) });
  // Top cap
  const topStart = depthSegments * n;
  faces.push({ indices: Array.from({ length: n }, (_, i) => topStart + i) });
  
  // Side quads
  for (let s = 0; s < depthSegments; s++) {
    const r0 = s * n;
    const r1 = (s + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push({ indices: [r0 + i, r0 + j, r1 + j, r1 + i] });
    }
  }

  return { vertices, faces };
}

/**
 * 3ds Max GEOSPHERE: Geodesic Sphere based on Regular Polyhedra (Icosahedron, Octahedron, Tetrahedron).
 * Subdivides triangular faces evenly into geodesic frequency N and projects all vertices onto sphere surface.
 * Supports hemisphere geodesic dome, baseToPivot alignment, and clean polygonal faces.
 */
function buildGeoSphere(p: Record<string, any>): PrimitiveGeom {
  const radius = p.radius ?? 0.5;
  const baseType = (p.geodesicBaseType || 'ICOSAHEDRON').toUpperCase();
  const freq = Math.max(1, Math.min(32, Math.round(p.geodesicFrequency ?? p.segments ?? 4)));
  const isHemisphere = !!p.geodesicHemisphere || (p.hemisphere && p.hemisphere > 0.4);
  const baseToPivot = !!p.baseToPivot;

  let baseVerts: THREE.Vector3[] = [];
  let baseFaces: [number, number, number][] = [];

  if (baseType === 'TETRAHEDRON') {
    // 4 Vertices, 4 Triangles
    const a = 1.0 / Math.sqrt(3);
    baseVerts = [
      new THREE.Vector3(a, a, a),
      new THREE.Vector3(-a, -a, a),
      new THREE.Vector3(-a, a, -a),
      new THREE.Vector3(a, -a, -a),
    ];
    baseFaces = [
      [0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]
    ];
  } else if (baseType === 'OCTAHEDRON') {
    // 6 Vertices, 8 Triangles
    baseVerts = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ];
    baseFaces = [
      [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2],
      [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5]
    ];
  } else {
    // ICOSAHEDRON (Default 3ds Max 20-face regular geodesic)
    const phi = (1 + Math.sqrt(5)) / 2;
    const invLen = 1.0 / Math.sqrt(1 + phi * phi);
    const norm1 = 1.0 * invLen;
    const normPhi = phi * invLen;

    baseVerts = [
      new THREE.Vector3(-norm1,  normPhi, 0),
      new THREE.Vector3( norm1,  normPhi, 0),
      new THREE.Vector3(-norm1, -normPhi, 0),
      new THREE.Vector3( norm1, -normPhi, 0),
      new THREE.Vector3(0, -norm1,  normPhi),
      new THREE.Vector3(0,  norm1,  normPhi),
      new THREE.Vector3(0, -norm1, -normPhi),
      new THREE.Vector3(0,  norm1, -normPhi),
      new THREE.Vector3( normPhi, 0, -norm1),
      new THREE.Vector3( normPhi, 0,  norm1),
      new THREE.Vector3(-normPhi, 0, -norm1),
      new THREE.Vector3(-normPhi, 0,  norm1),
    ];
    baseFaces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];
  }

  // Geodesic Tessellation: subdivide each triangle into freq x freq subtriangles
  const rawVerts: V3[] = [];
  const rawFaces: MeshFace[] = [];

  const getSubdividedIndex = (
    vA: THREE.Vector3, vB: THREE.Vector3, vC: THREE.Vector3,
    i: number, j: number, k: number
  ): V3 => {
    const wA = i / freq;
    const wB = j / freq;
    const wC = k / freq;
    const p = new THREE.Vector3()
      .addScaledVector(vA, wA)
      .addScaledVector(vB, wB)
      .addScaledVector(vC, wC)
      .normalize()
      .multiplyScalar(radius);
    
    let y = p.y;
    if (baseToPivot) {
      y += radius;
    }
    return [p.x, y, p.z];
  };

  baseFaces.forEach(([iA, iB, iC]) => {
    const vA = baseVerts[iA];
    const vB = baseVerts[iB];
    const vC = baseVerts[iC];

    const faceVertexIndices: number[][] = [];
    for (let i = 0; i <= freq; i++) {
      faceVertexIndices[i] = [];
      for (let j = 0; j <= freq - i; j++) {
        const k = freq - i - j;
        const pt = getSubdividedIndex(vA, vB, vC, i, j, k);
        const vIdx = rawVerts.length;
        rawVerts.push(pt);
        faceVertexIndices[i][j] = vIdx;
      }
    }

    // Connect subtriangles
    for (let i = 0; i < freq; i++) {
      for (let j = 0; j < freq - i; j++) {
        const v0 = faceVertexIndices[i][j];
        const v1 = faceVertexIndices[i + 1][j];
        const v2 = faceVertexIndices[i][j + 1];
        rawFaces.push({ indices: [v0, v1, v2] });

        if (j < freq - i - 1) {
          const v3 = faceVertexIndices[i + 1][j + 1];
          rawFaces.push({ indices: [v1, v3, v2] });
        }
      }
    }
  });

  let geom = weldVertices(rawVerts, rawFaces);

  if (isHemisphere) {
    const cutY = baseToPivot ? radius : 0.0;
    const keepFaces: MeshFace[] = [];

    geom.faces.forEach(f => {
      const allAbove = f.indices.every(idx => geom.vertices[idx][1] >= cutY - 0.001);
      if (allAbove) {
        keepFaces.push(f);
      }
    });

    if (keepFaces.length > 0) {
      geom = { vertices: geom.vertices, faces: keepFaces };
    }
  }

  return geom;
}

/**
 * 3ds Max SPHERE PRIMITIVE:
 * Full UV Sphere parametric generation with:
 * - radius
 * - segments (longitude) & heightSegments (latitude)
 * - hemisphere (0.0 to 1.0)
 * - chopSquash ('chop' clips vertices & caps, 'squash' compresses latitude rings towards base)
 * - sliceOn (boolean) with sliceFrom and sliceTo degrees & pie wedge caps
 * - baseToPivot (moves bottom pole to Y=0)
 */
function buildSphereAdvanced(p: Record<string, any>): PrimitiveGeom {
  const radius = p.radius ?? 0.5;
  const segments = Math.max(3, Math.round(p.segments ?? 32));
  const heightSegments = Math.max(2, Math.round(p.heightSegments ?? Math.round(segments / 2)));
  const hemisphere = Math.max(0.0, Math.min(1.0, p.hemisphere ?? 0.0));
  const chopSquash = p.chopSquash || 'chop';
  const sliceOn = !!p.sliceOn;
  const sliceFrom = ((p.sliceFrom ?? 0) * Math.PI) / 180;
  const sliceTo = ((p.sliceTo ?? 360) * Math.PI) / 180;
  const baseToPivot = !!p.baseToPivot;

  const phiStart = sliceOn ? sliceFrom : 0;
  let phiLength = sliceOn ? sliceTo - sliceFrom : Math.PI * 2;
  if (phiLength <= 0) phiLength += Math.PI * 2;

  const thetaStart = 0;
  let thetaLength = Math.PI;

  if (hemisphere > 0.0) {
    if (chopSquash === 'chop') {
      thetaLength = Math.PI * (1.0 - hemisphere);
    }
  }

  const verts: V3[] = [];
  const uvs: [number, number][] = [];
  const grid: number[][] = [];

  for (let iy = 0; iy <= heightSegments; iy++) {
    const vRow: number[] = [];
    const v = iy / heightSegments;
    let theta: number;

    if (hemisphere > 0.0 && chopSquash === 'squash') {
      theta = Math.PI * (1.0 - hemisphere) * v;
    } else {
      theta = thetaStart + v * thetaLength;
    }

    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let ix = 0; ix <= segments; ix++) {
      const u = ix / segments;
      const phi = phiStart + u * phiLength;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = -radius * cosPhi * sinTheta;
      let y = radius * cosTheta;
      const z = radius * sinPhi * sinTheta;

      if (baseToPivot) {
        y += radius;
      }

      verts.push([x, y, z]);
      uvs.push([u, 1 - v]);
      vRow.push(verts.length - 1);
    }
    grid.push(vRow);
  }

  const faces: MeshFace[] = [];

  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < segments; ix++) {
      const p00 = grid[iy][ix];         // Top-left
      const p01 = grid[iy][ix + 1];     // Top-right
      const p10 = grid[iy + 1][ix];     // Bottom-left
      const p11 = grid[iy + 1][ix + 1]; // Bottom-right

      if (iy === 0) {
        // Top pole: p00 and p01 collapse to the same pole point.
        // Triangle with 1 pole vertex and 2 ring vertices below with outward normal:
        faces.push({ indices: [p00, p11, p10], uvs: [uvs[p00], uvs[p11], uvs[p10]] });
      } else if (iy === heightSegments - 1 && hemisphere === 0.0) {
        // Bottom pole: p10 and p11 collapse to the same pole point.
        // Triangle with 2 ring vertices above and 1 pole vertex below with outward normal:
        faces.push({ indices: [p00, p01, p10], uvs: [uvs[p00], uvs[p01], uvs[p10]] });
      } else {
        // Quad for intermediate latitude rings with outward normal:
        faces.push({ indices: [p00, p01, p11, p10], uvs: [uvs[p00], uvs[p01], uvs[p11], uvs[p10]] });
      }
    }
  }

  // Base cap for chopped hemisphere
  if (hemisphere > 0.0 && chopSquash === 'chop') {
    const bottomRing = grid[heightSegments];
    const centerIdx = verts.length;
    const bottomY = baseToPivot 
      ? radius + radius * Math.cos(thetaLength)
      : radius * Math.cos(thetaLength);
    verts.push([0, bottomY, 0]);
    uvs.push([0.5, 0.5]);

    for (let ix = 0; ix < segments; ix++) {
      faces.push({ indices: [centerIdx, bottomRing[ix], bottomRing[ix + 1]] });
    }
  }

  // Pie slice wedge side caps
  if (sliceOn && Math.abs(phiLength - Math.PI * 2) > 0.01) {
    for (let iy = 0; iy < heightSegments; iy++) {
      const pTop = grid[iy][0];
      const pBot = grid[iy + 1][0];
      const cTopIdx = verts.length;
      verts.push([0, verts[pTop][1], 0]);
      uvs.push([0, 1 - iy / heightSegments]);
      const cBotIdx = verts.length;
      verts.push([0, verts[pBot][1], 0]);
      uvs.push([0, 1 - (iy + 1) / heightSegments]);

      faces.push({ indices: [cTopIdx, pTop, pBot, cBotIdx] });
    }
    for (let iy = 0; iy < heightSegments; iy++) {
      const pTop = grid[iy][segments];
      const pBot = grid[iy + 1][segments];
      const cTopIdx = verts.length;
      verts.push([0, verts[pTop][1], 0]);
      uvs.push([1, 1 - iy / heightSegments]);
      const cBotIdx = verts.length;
      verts.push([0, verts[pBot][1], 0]);
      uvs.push([1, 1 - (iy + 1) / heightSegments]);

      faces.push({ indices: [cTopIdx, cBotIdx, pBot, pTop] });
    }
  }

  return weldVertices(verts, faces);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generatePrimitive(type: PT, params: Record<string, any>): PrimitiveGeom {
  const p = params ?? {};

  switch (type) {
    // ── Flat 2D (explicit quad/fan topology) ────────────────────────────────
    case 'PLANE':
      return buildPlane(Math.max(1, Math.round(p.segments ?? 1)));

    case 'VOLUME_CLOUD':
      return extractAndMergeQuads(new THREE.BoxGeometry(1, 1, 1));

    case 'PARTICLE_SYSTEM':
      return buildParticleEmitterGizmo(p.particleConfig ?? DEFAULT_PARTICLE_CONFIG);

    case 'SPACE_WARP':
      return buildSpaceWarpGizmo(p.warpConfig ?? DEFAULT_SPACE_WARP_CONFIG);

    case 'GPGPU_SWARM':
      return buildGpgpuSwarmGizmo(p.gpgpuSwarmConfig ?? DEFAULT_GPGPU_SWARM_CONFIG);

    case 'RING':
      return buildRing(
        p.innerRadius ?? 0.25,
        p.outerRadius ?? 0.5,
        Math.max(3, Math.round(p.thetaSegments ?? 16)),
      );

    case 'CIRCLE':
      return buildCircle(0.5, Math.max(3, Math.round(p.segments ?? 16)));

    // ── Solid 3D — pristine clean topology (no crossed internal diagonals) ──
    case 'CUBE': {
      const N = Math.max(1, Math.round(p.segments ?? 1));
      return buildCube(N);
    }
    case 'GEOSPHERE': {
      return buildGeoSphere(p);
    }
    case 'SPHERE': {
      const sphereType = p.sphereType || 'UV';
      if (sphereType === 'ICO') {
        return buildGeoSphere({ ...p, geodesicBaseType: 'ICOSAHEDRON', geodesicFrequency: p.detail ?? p.segments ?? 2 });
      }
      return buildSphereAdvanced(p);
    }
    case 'CYLINDER': {
      const S = Math.max(3, Math.round(p.segments ?? 16));
      const H = Math.max(1, Math.round(p.heightSegments ?? 1));
      return buildCylinder(S, H);
    }
    case 'CONE': {
      const S = Math.max(3, Math.round(p.segments ?? 16));
      const H = Math.max(1, Math.round(p.heightSegments ?? 1));
      return buildCone(S, H);
    }
    case 'TORUS': {
      return buildTorus(
        p.radius ?? 0.5, p.tube ?? 0.2,
        Math.max(3,  Math.round(p.radialSegments  ?? 16)),
        Math.max(6,  Math.round(p.tubularSegments ?? 32)),
      );
    }
    case 'ICOSAHEDRON':
      return extractAndMergeQuads(new THREE.IcosahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0))));
    case 'DODECAHEDRON':
      return extractAndMergeQuads(new THREE.DodecahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0))));
    case 'PYRAMID': {
      const H = Math.max(1, Math.round(p.heightSegments ?? 1));
      return buildPyramid(H);
    }
    case 'PRISM': {
      const H = Math.max(1, Math.round(p.heightSegments ?? 1));
      return buildPrism(H);
    }
    case 'CAPSULE': {
      const S = Math.max(4, Math.round(p.segments ?? 16));
      return extractAndMergeQuads(new THREE.CapsuleGeometry(0.25, 0.5, 8, S));
    }
    case 'TETRAHEDRON':
      return extractAndMergeQuads(new THREE.TetrahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0))));
    case 'OCTAHEDRON':
      return extractAndMergeQuads(new THREE.OctahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0))));
    case 'TUBE': {
      return buildTube(
        p.innerRadius ?? 0.25,
        p.outerRadius ?? 0.5,
        1.0,
        Math.max(3, Math.round(p.segments ?? 16))
      );
    }
    case 'WEDGE':
      return buildWedge();
    case 'ARC': {
      return buildArc(
        p.innerRadius ?? 0.25,
        p.outerRadius ?? 0.5,
        p.arcAngle ?? 180,
        p.height ?? 0.5,
        Math.max(4, Math.round(p.segments ?? 32))
      );
    }
    case 'STAR': {
      return buildStar(
        Math.max(3, Math.round(p.starPoints ?? p.points ?? 5)),
        p.innerRadius ?? 0.25,
        p.outerRadius ?? 0.5,
        p.height ?? 0.5
      );
    }
    case 'HEMISPHERE': {
      const S = Math.max(4, Math.round(p.segments ?? 16));
      const sphereGeo = new THREE.SphereGeometry(0.5, S, Math.max(2, Math.round(S / 2)), 0, Math.PI * 2, 0, Math.PI / 2);
      const circleGeo = new THREE.CircleGeometry(0.5, S);
      circleGeo.rotateX(Math.PI / 2);
      try {
        const merged = BufferGeometryUtils.mergeGeometries([sphereGeo, circleGeo]);
        return extractAndMergeQuads(merged);
      } catch {
        return extractAndMergeQuads(sphereGeo);
      }
    }

    // ── NURBS Primitives ──────────────────────────────────────────────────
    case 'NURBS_CURVE': {
      const curve = p.nurbsCurve ?? createDefaultNurbsCurve();
      return tessellateNurbsCurveToMesh(curve, Math.max(16, p.segments ?? 32), p.radius ?? 0.03);
    }
    case 'NURBS_CIRCLE': {
      const circle = p.nurbsCurve ?? createDefaultNurbsCircle(p.radius ?? 1.0);
      return tessellateNurbsCurveToMesh(circle, Math.max(24, p.segments ?? 48), p.tube ?? 0.03);
    }
    case 'NURBS_SURFACE': {
      const surface = p.nurbsSurface ?? createDefaultNurbsSurface(p.height ?? 2.0);
      return tessellateNurbsSurface(surface, p.nurbsResolutionU ?? 16, p.nurbsResolutionV ?? 16);
    }
    case 'NURBS_CYLINDER': {
      const surface = p.nurbsSurface ?? createDefaultNurbsCylinder(p.radius ?? 0.8, p.height ?? 2.0);
      return tessellateNurbsSurface(surface, p.nurbsResolutionU ?? 16, p.nurbsResolutionV ?? 32);
    }
    case 'NURBS_CONE': {
      const surface = p.nurbsSurface ?? createDefaultNurbsCone(p.radius ?? 1.0, p.height ?? 2.0);
      return tessellateNurbsSurface(surface, p.nurbsResolutionU ?? 16, p.nurbsResolutionV ?? 32);
    }
    case 'NURBS_SPHERE': {
      const surface = p.nurbsSurface ?? createDefaultNurbsSphere(p.radius ?? 1.0);
      return tessellateNurbsSurface(surface, p.nurbsResolutionU ?? 24, p.nurbsResolutionV ?? 32);
    }
    case 'NURBS_TORUS': {
      const surface = p.nurbsSurface ?? createDefaultNurbsTorus(p.radius ?? 1.0, p.tube ?? 0.35);
      return tessellateNurbsSurface(surface, p.nurbsResolutionU ?? 24, p.nurbsResolutionV ?? 32);
    }

    // ── SHAPE / custom — return empty (will be populated by drawing) ─────────
    case 'SHAPE':
      if (p.extrusionDepth !== undefined) {
        return buildExtrusion(p);
      }
      return { vertices: [], faces: [] };

    case 'MESH':
      return { vertices: [], faces: [] };

    default: {
      // Fallback: simple unit cube
      return extractAndMergeQuads(new THREE.BoxGeometry(1, 1, 1));
    }
  }
}
