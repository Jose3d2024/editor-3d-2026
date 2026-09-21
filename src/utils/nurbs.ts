/**
 * nurbs.ts — Complete Mathematical NURBS (Non-Uniform Rational B-Splines) Engine
 *
 * Implements:
 * - Cox-de Boor basis evaluation for arbitrary degree and knot vectors
 * - Rational homogeneous coordinates (wx, wy, wz, w)
 * - Curve and Surface evaluation (points, tangents, normals)
 * - Exact rational primitives (NURBS Curve, Circle, Surface Patch, Cylinder, Sphere, Torus)
 * - Non-destructive operations: Extrude, Revolve/Lathe, Loft/Skin, Subdivide (Knot insertion),
 *   Switch Direction, Set Degree, Set Weights
 * - Conversion to standard CSG / Polygon Mesh with configurable resolution
 */

import type { V3, MeshFace } from '../types';

export interface NurbsControlPoint {
  point: V3;
  weight: number; // Rational weight w > 0 (standard: 1.0)
  radius?: number; // Local bevel/tube thickness factor (standard: 1.0)
  tilt?: number; // Local normal tilt/twist angle in degrees (standard: 0.0)
}

export type NurbsKnotType = 'ENDPOINT' | 'UNIFORM' | 'BEZIER';

export interface NurbsCurveData {
  degree: number; // Degree p (Order = degree + 1)
  knots?: number[];
  knotsType?: NurbsKnotType;
  endpoint?: boolean; // Clamp endpoints (touch start/end CPs)
  controlPoints: NurbsControlPoint[];
  closed?: boolean; // Cyclic curve
  radius?: number; // Global base tube radius
}

export interface NurbsSurfaceData {
  degreeU: number; // Degree in U (Order U = degreeU + 1)
  degreeV: number; // Degree in V (Order V = degreeV + 1)
  knotsU?: number[];
  knotsV?: number[];
  knotsTypeU?: NurbsKnotType;
  knotsTypeV?: NurbsKnotType;
  endpointU?: boolean; // Endpoint clamp in U
  endpointV?: boolean; // Endpoint clamp in V
  // 2D grid: controlPoints[uIndex][vIndex]
  controlPoints: NurbsControlPoint[][];
  closedU?: boolean; // Cyclic in U
  closedV?: boolean; // Cyclic in V
  resolutionU?: number;
  resolutionV?: number;
}

// ─── KNOT VECTOR UTILITIES (BLENDER COMPLIANT) ──────────────────────────────

/**
 * Generate standard clamped (open/endpoint) knot vector:
 * Repeats 0 (degree+1) times at start and 1 (degree+1) times at end.
 */
export function generateClampedKnots(numPoints: number, degree: number): number[] {
  const p = Math.max(1, Math.min(degree, numPoints - 1));
  const n = numPoints - 1;
  const m = n + p + 1;
  const knots: number[] = [];

  for (let i = 0; i <= p; i++) knots.push(0);

  const numInterior = m - 2 * (p + 1) + 1;
  if (numInterior > 0) {
    for (let i = 1; i <= numInterior; i++) {
      knots.push(i / (numInterior + 1));
    }
  }

  for (let i = 0; i <= p; i++) knots.push(1);
  return knots;
}

/**
 * Generate uniform open knot vector without clamping endpoints.
 */
export function generateUniformKnots(numPoints: number, degree: number): number[] {
  const p = Math.max(1, Math.min(degree, numPoints - 1));
  const n = numPoints - 1;
  const m = n + p + 1;
  const knots: number[] = [];
  for (let i = 0; i <= m; i++) {
    knots.push(i / m);
  }
  return knots;
}

/**
 * Generate periodic (uniform) knot vector for closed (cyclic) curves/surfaces.
 */
export function generatePeriodicKnots(numPoints: number, degree: number): number[] {
  const p = Math.max(1, Math.min(degree, numPoints - 1));
  const n = numPoints - 1;
  const m = n + p + 1;
  const knots: number[] = [];
  for (let i = 0; i <= m; i++) {
    knots.push(i / m);
  }
  return knots;
}

/**
 * Generate Bézier clamped knot vector (multiplicity p at internal knots).
 */
export function generateBezierKnots(numPoints: number, degree: number): number[] {
  const p = Math.max(1, Math.min(degree, numPoints - 1));
  const n = numPoints - 1;
  const m = n + p + 1;
  const knots: number[] = [];

  for (let i = 0; i <= p; i++) knots.push(0);

  const numSpans = Math.floor((numPoints - 1) / p);
  if (numSpans > 1) {
    for (let s = 1; s < numSpans; s++) {
      for (let k = 0; k < p; k++) {
        knots.push(s / numSpans);
      }
    }
  }

  while (knots.length < m + 1) {
    knots.push(1);
  }
  return knots;
}

/**
 * Computes effective knot vector given structural parameters.
 */
export function buildKnots(
  numPoints: number,
  degree: number,
  isClosed = false,
  isEndpoint = true,
  knotType: NurbsKnotType = 'ENDPOINT'
): number[] {
  const p = Math.max(1, Math.min(degree, numPoints - 1));
  if (isClosed) {
    return generatePeriodicKnots(numPoints, p);
  }
  if (knotType === 'BEZIER') {
    return generateBezierKnots(numPoints, p);
  }
  if (knotType === 'UNIFORM' || !isEndpoint) {
    return generateUniformKnots(numPoints, p);
  }
  return generateClampedKnots(numPoints, p);
}

// ─── COX-DE BOOR BASIS FUNCTIONS ────────────────────────────────────────────

/**
 * Evaluates the i-th B-spline basis function N_{i,p}(u) recursively.
 * Handles open, clamped, periodic, and Bézier knot spans with numerical stability.
 */
export function evaluateBasis(i: number, p: number, u: number, knots: number[]): number {
  if (p === 0) {
    const uLast = knots[knots.length - 1];
    // Right endpoint condition: if u is at maximum knot value, evaluate 1 on the last non-empty span
    if (u >= uLast - 1e-9) {
      return (knots[i + 1] >= uLast - 1e-9 && knots[i] < uLast - 1e-9) ? 1.0 : 0.0;
    }
    if (u >= knots[i] && u < knots[i + 1]) return 1.0;
    return 0.0;
  }

  let c1 = 0;
  const denom1 = knots[i + p] - knots[i];
  if (Math.abs(denom1) > 1e-9) {
    c1 = ((u - knots[i]) / denom1) * evaluateBasis(i, p - 1, u, knots);
  }

  let c2 = 0;
  const denom2 = knots[i + p + 1] - knots[i + 1];
  if (Math.abs(denom2) > 1e-9) {
    c2 = ((knots[i + p + 1] - u) / denom2) * evaluateBasis(i + 1, p - 1, u, knots);
  }

  return c1 + c2;
}

// ─── NURBS CURVE EVALUATION ─────────────────────────────────────────────────

export interface EvaluatedCurvePoint {
  point: V3;
  radius: number;
  tilt: number;
}

/**
 * Evaluates a 3D point C(u) on a NURBS curve for parameter u in [0, 1].
 */
export function evaluateNurbsCurvePoint(curve: NurbsCurveData, u: number): V3 {
  return evaluateNurbsCurvePointWithAttrs(curve, u).point;
}

/**
 * Evaluates a 3D point C(u) along with interpolated radius and tilt.
 */
export function evaluateNurbsCurvePointWithAttrs(curve: NurbsCurveData, u: number): EvaluatedCurvePoint {
  const pts = curve.controlPoints;
  const n = pts.length - 1;
  const p = Math.max(1, Math.min(curve.degree, n));
  const knots = curve.knots && curve.knots.length === n + p + 2
    ? curve.knots
    : buildKnots(pts.length, p, curve.closed, curve.endpoint !== false, curve.knotsType);

  const uClamped = Math.max(knots[0], Math.min(knots[knots.length - 1], u));

  let x = 0, y = 0, z = 0, wSum = 0;
  let radSum = 0, tiltSum = 0;

  for (let i = 0; i <= n; i++) {
    const N = evaluateBasis(i, p, uClamped, knots);
    if (N <= 0) continue;
    const w = pts[i].weight ?? 1.0;
    const r = pts[i].radius ?? 1.0;
    const t = pts[i].tilt ?? 0.0;
    const pt = pts[i].point;
    const Nw = N * w;

    x += pt[0] * Nw;
    y += pt[1] * Nw;
    z += pt[2] * Nw;
    radSum += r * Nw;
    tiltSum += t * Nw;
    wSum += Nw;
  }

  if (Math.abs(wSum) < 1e-9) wSum = 1.0;
  return {
    point: [x / wSum, y / wSum, z / wSum],
    radius: Math.max(0.01, radSum / wSum),
    tilt: tiltSum / wSum,
  };
}

/**
 * Evaluates points along a NURBS curve sampled with N segments.
 */
export function sampleNurbsCurve(curve: NurbsCurveData, segments = 32): V3[] {
  return sampleNurbsCurveWithAttrs(curve, segments).map(item => item.point);
}

/**
 * Evaluates points and attributes along a NURBS curve sampled with N segments.
 */
export function sampleNurbsCurveWithAttrs(curve: NurbsCurveData, segments = 32): EvaluatedCurvePoint[] {
  const segs = Math.max(4, segments);
  const out: EvaluatedCurvePoint[] = [];
  const pts = curve.controlPoints;
  const p = Math.max(1, Math.min(curve.degree, pts.length - 1));
  const knots = curve.knots && curve.knots.length === pts.length + p + 1
    ? curve.knots
    : buildKnots(pts.length, p, curve.closed, curve.endpoint !== false, curve.knotsType);

  const uMin = knots[0];
  const uMax = knots[knots.length - 1];

  for (let i = 0; i <= segs; i++) {
    const u = uMin + (i / segs) * (uMax - uMin);
    out.push(evaluateNurbsCurvePointWithAttrs(curve, u));
  }
  return out;
}

// ─── NURBS SURFACE EVALUATION ───────────────────────────────────────────────

/**
 * Evaluates a 3D point S(u, v) on a NURBS surface.
 */
export function evaluateNurbsSurfacePoint(surface: NurbsSurfaceData, u: number, v: number): V3 {
  const grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU === 0 || numV === 0) return [0, 0, 0];

  const pU = Math.max(1, Math.min(surface.degreeU, numU - 1));
  const pV = Math.max(1, Math.min(surface.degreeV, numV - 1));

  const knotsU = surface.knotsU && surface.knotsU.length === numU + pU + 1
    ? surface.knotsU
    : buildKnots(numU, pU, surface.closedU, surface.endpointU !== false, surface.knotsTypeU);

  const knotsV = surface.knotsV && surface.knotsV.length === numV + pV + 1
    ? surface.knotsV
    : buildKnots(numV, pV, surface.closedV, surface.endpointV !== false, surface.knotsTypeV);

  const uClamped = Math.max(knotsU[0], Math.min(knotsU[knotsU.length - 1], u));
  const vClamped = Math.max(knotsV[0], Math.min(knotsV[knotsV.length - 1], v));

  let x = 0, y = 0, z = 0, wSum = 0;

  for (let i = 0; i < numU; i++) {
    const Nu = evaluateBasis(i, pU, uClamped, knotsU);
    if (Nu <= 0) continue;

    for (let j = 0; j < numV; j++) {
      const Nv = evaluateBasis(j, pV, vClamped, knotsV);
      if (Nv <= 0) continue;

      const cp = grid[i][j];
      const w = cp.weight ?? 1.0;
      const Nw = Nu * Nv * w;

      x += cp.point[0] * Nw;
      y += cp.point[1] * Nw;
      z += cp.point[2] * Nw;
      wSum += Nw;
    }
  }

  if (Math.abs(wSum) < 1e-9) wSum = 1.0;
  return [x / wSum, y / wSum, z / wSum];
}

/**
 * Calculates the surface normal vector at (u, v) using central finite differences.
 */
export function evaluateNurbsSurfaceNormal(surface: NurbsSurfaceData, u: number, v: number): V3 {
  const eps = 1e-3;
  const grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU === 0 || numV === 0) return [0, 1, 0];

  const pU = Math.max(1, Math.min(surface.degreeU, numU - 1));
  const pV = Math.max(1, Math.min(surface.degreeV, numV - 1));
  const knotsU = surface.knotsU && surface.knotsU.length === numU + pU + 1
    ? surface.knotsU
    : buildKnots(numU, pU, surface.closedU, surface.endpointU !== false, surface.knotsTypeU);
  const knotsV = surface.knotsV && surface.knotsV.length === numV + pV + 1
    ? surface.knotsV
    : buildKnots(numV, pV, surface.closedV, surface.endpointV !== false, surface.knotsTypeV);

  const uMin = knotsU[0], uMax = knotsU[knotsU.length - 1];
  const vMin = knotsV[0], vMax = knotsV[knotsV.length - 1];

  const uA = Math.max(uMin, u - eps);
  const uB = Math.min(uMax, u + eps);
  const vA = Math.max(vMin, v - eps);
  const vB = Math.min(vMax, v + eps);

  const pU1 = evaluateNurbsSurfacePoint(surface, uA, v);
  const pU2 = evaluateNurbsSurfacePoint(surface, uB, v);
  const pV1 = evaluateNurbsSurfacePoint(surface, u, vA);
  const pV2 = evaluateNurbsSurfacePoint(surface, u, vB);

  const duStep = Math.max(1e-6, uB - uA);
  const dvStep = Math.max(1e-6, vB - vA);

  const du: V3 = [(pU2[0] - pU1[0]) / duStep, (pU2[1] - pU1[1]) / duStep, (pU2[2] - pU1[2]) / duStep];
  const dv: V3 = [(pV2[0] - pV1[0]) / dvStep, (pV2[1] - pV1[1]) / dvStep, (pV2[2] - pV1[2]) / dvStep];

  let nx = du[1] * dv[2] - du[2] * dv[1];
  let ny = du[2] * dv[0] - du[0] * dv[2];
  let nz = du[0] * dv[1] - du[1] * dv[0];

  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-6) {
    nx /= len;
    ny /= len;
    nz /= len;
  } else {
    // Fallback normal for poles/singularities
    if (u <= uMin + 1e-4) return [0, -1, 0];
    if (u >= uMax - 1e-4) return [0, 1, 0];
    const p0 = evaluateNurbsSurfacePoint(surface, u, v);
    const p0Len = Math.hypot(p0[0], p0[1], p0[2]);
    if (p0Len > 1e-4) {
      return [p0[0] / p0Len, p0[1] / p0Len, p0[2] / p0Len];
    }
    return [0, 1, 0];
  }
  return [nx, ny, nz];
}

// ─── TESSELLATION / CONVERT TO MESH ─────────────────────────────────────────

/**
 * Tessellates a NURBS Surface into standard mesh vertices and quad/triangle faces.
 */
export function tessellateNurbsSurface(
  surface: NurbsSurfaceData,
  resU = 20,
  resV = 20
): { vertices: V3[]; faces: MeshFace[] } {
  const uSteps = Math.max(3, surface.resolutionU ?? resU);
  const vSteps = Math.max(3, surface.resolutionV ?? resV);

  const grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU < 2 || numV < 2) return { vertices: [], faces: [] };

  const pU = Math.max(1, Math.min(surface.degreeU, numU - 1));
  const pV = Math.max(1, Math.min(surface.degreeV, numV - 1));

  const knotsU = surface.knotsU && surface.knotsU.length === numU + pU + 1
    ? surface.knotsU
    : buildKnots(numU, pU, surface.closedU, surface.endpointU !== false, surface.knotsTypeU);

  const knotsV = surface.knotsV && surface.knotsV.length === numV + pV + 1
    ? surface.knotsV
    : buildKnots(numV, pV, surface.closedV, surface.endpointV !== false, surface.knotsTypeV);

  const uMin = knotsU[0], uMax = knotsU[knotsU.length - 1];
  const vMin = knotsV[0], vMax = knotsV[knotsV.length - 1];

  const vertices: V3[] = [];
  const uvs: [number, number][] = [];
  const normals: V3[] = [];

  for (let i = 0; i <= uSteps; i++) {
    const uNorm = i / uSteps;
    const u = uMin + uNorm * (uMax - uMin);

    for (let j = 0; j <= vSteps; j++) {
      const vNorm = j / vSteps;
      const v = vMin + vNorm * (vMax - vMin);

      const pt = evaluateNurbsSurfacePoint(surface, u, v);
      const n = evaluateNurbsSurfaceNormal(surface, u, v);

      vertices.push(pt);
      uvs.push([vNorm, uNorm]);
      normals.push(n);
    }
  }

  const faces: MeshFace[] = [];
  const stride = vSteps + 1;

  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const idxA = i * stride + j;
      const idxB = (i + 1) * stride + j;
      const idxC = (i + 1) * stride + (j + 1);
      const idxD = i * stride + (j + 1);

      // Quad face [idxA, idxB, idxC, idxD]
      faces.push({
        indices: [idxA, idxB, idxC, idxD],
        uvs: [uvs[idxA], uvs[idxB], uvs[idxC], uvs[idxD]],
        normal: normals[idxA],
      });
    }
  }

  return { vertices, faces };
}

/**
 * Generates Float32 vertex coordinates (line pairs) of mathematical U and V
 * isoparametric curves (Isoparms / Isocurves) across a NURBS surface.
 */
export function generateNurbsSurfaceIsoparms(
  surface: NurbsSurfaceData,
  isoparmsU = 12,
  isoparmsV = 12,
  samplesPerCurve = 36
): number[] {
  const lineVerts: number[] = [];
  const grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU < 2 || numV < 2) return lineVerts;

  const pU = Math.max(1, Math.min(surface.degreeU, numU - 1));
  const pV = Math.max(1, Math.min(surface.degreeV, numV - 1));
  const knotsU = surface.knotsU && surface.knotsU.length === numU + pU + 1
    ? surface.knotsU
    : buildKnots(numU, pU, surface.closedU, surface.endpointU !== false, surface.knotsTypeU);
  const knotsV = surface.knotsV && surface.knotsV.length === numV + pV + 1
    ? surface.knotsV
    : buildKnots(numV, pV, surface.closedV, surface.endpointV !== false, surface.knotsTypeV);

  const uMin = knotsU[0], uMax = knotsU[knotsU.length - 1];
  const vMin = knotsV[0], vMax = knotsV[knotsV.length - 1];

  const numIsoU = Math.max(2, isoparmsU);
  const numIsoV = Math.max(2, isoparmsV);
  const samples = Math.max(12, samplesPerCurve);

  // 1. U-Isoparms (curves of constant v parameter, sampled along u)
  for (let i = 0; i <= numIsoU; i++) {
    const v = vMin + (vMax - vMin) * (i / numIsoU);
    let prevPt: V3 | null = null;
    for (let s = 0; s <= samples; s++) {
      const u = uMin + (uMax - uMin) * (s / samples);
      const pt = evaluateNurbsSurfacePoint(surface, u, v);
      if (prevPt) {
        lineVerts.push(prevPt[0], prevPt[1], prevPt[2], pt[0], pt[1], pt[2]);
      }
      prevPt = pt;
    }
  }

  // 2. V-Isoparms (curves of constant u parameter, sampled along v)
  for (let j = 0; j <= numIsoV; j++) {
    const u = uMin + (uMax - uMin) * (j / numIsoV);
    let prevPt: V3 | null = null;
    for (let s = 0; s <= samples; s++) {
      const v = vMin + (vMax - vMin) * (s / samples);
      const pt = evaluateNurbsSurfacePoint(surface, u, v);
      if (prevPt) {
        lineVerts.push(prevPt[0], prevPt[1], prevPt[2], pt[0], pt[1], pt[2]);
      }
      prevPt = pt;
    }
  }

  return lineVerts;
}

/**
 * Tessellates a NURBS Curve into a renderable spline with tubular thickness or polygon strip.
 * Supports per-point radius, local normal tilt/twist, seamless cyclic closure, and end capping.
 */
export function tessellateNurbsCurveToMesh(
  curve: NurbsCurveData,
  segments = 32,
  radius = 0.03,
  radialSegments = 12
): { vertices: V3[]; faces: MeshFace[] } {
  const isClosed = !!curve.closed;
  const curvePts = sampleNurbsCurveWithAttrs(curve, segments);
  if (curvePts.length < 2) return { vertices: [], faces: [] };

  const numPts = curvePts.length;
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];
  const uvs: [number, number][] = [];
  const rings: number[][] = [];

  // Compute Bishop / Rotation-Minimizing Frames along the curve for zero twist
  let prevNormal: V3 = [0, 1, 0];
  let prevBinormal: V3 = [1, 0, 0];

  const ringCount = isClosed ? numPts - 1 : numPts;

  for (let i = 0; i < ringCount; i++) {
    const curObj = curvePts[i];
    const cur = curObj.point;

    // Tangent vector
    let tx: number, ty: number, tz: number;
    if (isClosed) {
      const prevIdx = (i - 1 + ringCount) % ringCount;
      const nextIdx = (i + 1) % ringCount;
      const pPrev = curvePts[prevIdx].point;
      const pNext = curvePts[nextIdx].point;
      tx = pNext[0] - pPrev[0];
      ty = pNext[1] - pPrev[1];
      tz = pNext[2] - pPrev[2];
    } else {
      const prev = curvePts[Math.max(0, i - 1)].point;
      const next = curvePts[Math.min(numPts - 1, i + 1)].point;
      tx = next[0] - prev[0];
      ty = next[1] - prev[1];
      tz = next[2] - prev[2];
    }

    const tLen = Math.hypot(tx, ty, tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;

    let nx: number, ny: number, nz: number;
    let bx: number, by: number, bz: number;

    if (i === 0) {
      // Pick initial normal perpendicular to tangent
      const up: V3 = Math.abs(ty) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      bx = ty * up[2] - tz * up[1];
      by = tz * up[0] - tx * up[2];
      bz = tx * up[1] - ty * up[0];
      const bLen = Math.hypot(bx, by, bz) || 1;
      bx /= bLen; by /= bLen; bz /= bLen;

      nx = by * tz - bz * ty;
      ny = bz * tx - bx * tz;
      nz = bx * ty - by * tx;
    } else {
      // Parallel transport previous normal to current tangent plane
      const dot = prevNormal[0] * tx + prevNormal[1] * ty + prevNormal[2] * tz;
      nx = prevNormal[0] - dot * tx;
      ny = prevNormal[1] - dot * ty;
      nz = prevNormal[2] - dot * tz;
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen > 1e-4) {
        nx /= nLen; ny /= nLen; nz /= nLen;
      } else {
        nx = prevNormal[0]; ny = prevNormal[1]; nz = prevNormal[2];
      }
      bx = ty * nz - tz * ny;
      by = tz * nx - tx * nz;
      bz = tx * ny - ty * nx;
      const bLen = Math.hypot(bx, by, bz) || 1;
      bx /= bLen; by /= bLen; bz /= bLen;
    }

    prevNormal = [nx, ny, nz];
    prevBinormal = [bx, by, bz];

    // Apply local tilt rotation around tangent axis (Blender Curve Tilt)
    if (Math.abs(curObj.tilt) > 1e-4) {
      const tiltRad = (curObj.tilt * Math.PI) / 180;
      const cosT = Math.cos(tiltRad);
      const sinT = Math.sin(tiltRad);

      const rnx = nx * cosT - bx * sinT;
      const rny = ny * cosT - by * sinT;
      const rnz = nz * cosT - bz * sinT;

      const rbx = nx * sinT + bx * cosT;
      const rby = ny * sinT + by * cosT;
      const rbz = nz * sinT + bz * cosT;

      nx = rnx; ny = rny; nz = rnz;
      bx = rbx; by = rby; bz = rbz;
    }

    const ringIndices: number[] = [];
    const u = i / (numPts - 1);
    const effRadius = Math.max(0.002, radius * curObj.radius);

    for (let s = 0; s < radialSegments; s++) {
      const angle = (s / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const vx = cur[0] + effRadius * (nx * cos + bx * sin);
      const vy = cur[1] + effRadius * (ny * cos + by * sin);
      const vz = cur[2] + effRadius * (nz * cos + bx * sin);

      ringIndices.push(vertices.length);
      vertices.push([vx, vy, vz]);
      uvs.push([u, s / radialSegments]);
    }
    rings.push(ringIndices);
  }

  // Connect tubular rings
  const totalRings = rings.length;
  const loopCount = isClosed ? totalRings : totalRings - 1;

  for (let i = 0; i < loopCount; i++) {
    const ringA = rings[i];
    const ringB = rings[(i + 1) % totalRings];

    for (let s = 0; s < radialSegments; s++) {
      const nextS = (s + 1) % radialSegments;
      const a = ringA[s];
      const b = ringB[s];
      const c = ringB[nextS];
      const d = ringA[nextS];

      faces.push({
        indices: [a, b, c, d],
        uvs: [uvs[a], uvs[b], uvs[c], uvs[d]],
      });
    }
  }

  // Add solid end caps for open curves
  if (!isClosed && rings.length >= 2) {
    // Start cap
    const startCenterIdx = vertices.length;
    vertices.push([...curvePts[0].point]);
    uvs.push([0, 0.5]);
    const firstRing = rings[0];
    for (let s = 0; s < radialSegments; s++) {
      const nextS = (s + 1) % radialSegments;
      faces.push({
        indices: [startCenterIdx, firstRing[nextS], firstRing[s]],
        uvs: [uvs[startCenterIdx], uvs[firstRing[nextS]], uvs[firstRing[s]]],
      });
    }

    // End cap
    const endCenterIdx = vertices.length;
    const lastPt = curvePts[numPts - 1].point;
    vertices.push([...lastPt]);
    uvs.push([1, 0.5]);
    const lastRing = rings[rings.length - 1];
    for (let s = 0; s < radialSegments; s++) {
      const nextS = (s + 1) % radialSegments;
      faces.push({
        indices: [endCenterIdx, lastRing[s], lastRing[nextS]],
        uvs: [uvs[endCenterIdx], uvs[lastRing[s]], uvs[lastRing[nextS]]],
      });
    }
  }

  return { vertices, faces };
}

// ─── NURBS PRIMITIVES GENERATORS ────────────────────────────────────────────

/**
 * Standard 3D NURBS Curve (Degree 3 cubic curve with 4 control points).
 */
export function createDefaultNurbsCurve(): NurbsCurveData {
  return {
    degree: 3,
    controlPoints: [
      { point: [-1.5, 0, -0.5], weight: 1.0 },
      { point: [-0.5, 1.2, 0.5], weight: 1.0 },
      { point: [0.5, -0.8, -0.5], weight: 1.0 },
      { point: [1.5, 0.5, 0.5], weight: 1.0 },
    ],
    closed: false,
  };
}

export function createDefaultNurbsCircle(radius = 1.0): NurbsCurveData {
  const r = radius;
  const w = Math.SQRT1_2; // 0.7071067811865475

  return {
    degree: 2,
    knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
    controlPoints: [
      { point: [r, 0, 0], weight: 1.0 },
      { point: [r, 0, r], weight: w },
      { point: [0, 0, r], weight: 1.0 },
      { point: [-r, 0, r], weight: w },
      { point: [-r, 0, 0], weight: 1.0 },
      { point: [-r, 0, -r], weight: w },
      { point: [0, 0, -r], weight: 1.0 },
      { point: [r, 0, -r], weight: w },
      { point: [r, 0, 0], weight: 1.0 },
    ],
    closed: true,
  };
}

/**
 * Standard NURBS Surface Patch (4x4 control grid, cubic in U and V).
 */
export function createDefaultNurbsSurface(size = 2.0): NurbsSurfaceData {
  const half = size / 2;
  const grid: NurbsControlPoint[][] = [];

  for (let i = 0; i < 4; i++) {
    const row: NurbsControlPoint[] = [];
    const u = (i / 3) * size - half;

    for (let j = 0; j < 4; j++) {
      const v = (j / 3) * size - half;
      // Slight elevation for inner points to show 3D curvature
      const isInner = (i === 1 || i === 2) && (j === 1 || j === 2);
      const y = isInner ? 0.6 : 0.0;
      row.push({ point: [u, y, v], weight: 1.0 });
    }
    grid.push(row);
  }

  return {
    degreeU: 3,
    degreeV: 3,
    controlPoints: grid,
    resolutionU: 16,
    resolutionV: 16,
    closedU: false,
    closedV: false,
  };
}

/**
 * Exact Rational NURBS Cylinder (Rhino 3D standard).
 * Degree 1 (linear) in height U x Degree 2 (quadratic rational) in circle revolution V.
 */
export function createDefaultNurbsCylinder(radius = 0.8, height = 2.0): NurbsSurfaceData {
  const r = radius;
  const w = Math.SQRT1_2;
  const halfH = height / 2;

  const rowBottom: NurbsControlPoint[] = [
    { point: [r, -halfH, 0], weight: 1.0 },
    { point: [r, -halfH, r], weight: w },
    { point: [0, -halfH, r], weight: 1.0 },
    { point: [-r, -halfH, r], weight: w },
    { point: [-r, -halfH, 0], weight: 1.0 },
    { point: [-r, -halfH, -r], weight: w },
    { point: [0, -halfH, -r], weight: 1.0 },
    { point: [r, -halfH, -r], weight: w },
    { point: [r, -halfH, 0], weight: 1.0 },
  ];

  const rowTop: NurbsControlPoint[] = [
    { point: [r, halfH, 0], weight: 1.0 },
    { point: [r, halfH, r], weight: w },
    { point: [0, halfH, r], weight: 1.0 },
    { point: [-r, halfH, r], weight: w },
    { point: [-r, halfH, 0], weight: 1.0 },
    { point: [-r, halfH, -r], weight: w },
    { point: [0, halfH, -r], weight: 1.0 },
    { point: [r, halfH, -r], weight: w },
    { point: [r, halfH, 0], weight: 1.0 },
  ];

  return {
    degreeU: 1,
    degreeV: 2,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
    controlPoints: [rowBottom, rowTop],
    resolutionU: 16,
    resolutionV: 32,
    closedV: true,
  };
}

/**
 * Exact Rational NURBS Sphere (Rhino 3D standard revolution).
 * Uses 5 profile levels from South Pole to North Pole x 9 circular points with exact rational weights.
 */
export function createDefaultNurbsSphere(radius = 1.0): NurbsSurfaceData {
  const R = radius;
  const w = Math.SQRT1_2;

  // 5 profile levels in U (South Pole to North Pole)
  // Level 0 (South Pole): y = -R, r = 0, weight = 1
  // Level 1 (South Tangent): y = -R, r = R, weight = w
  // Level 2 (Equator): y = 0, r = R, weight = 1
  // Level 3 (North Tangent): y = R, r = R, weight = w
  // Level 4 (North Pole): y = R, r = 0, weight = 1
  const levels: { y: number; r: number; uWeight: number }[] = [
    { y: -R, r: 0, uWeight: 1.0 },
    { y: -R, r: R, uWeight: w },
    { y: 0, r: R, uWeight: 1.0 },
    { y: R, r: R, uWeight: w },
    { y: R, r: 0, uWeight: 1.0 },
  ];

  const circleDirs: [number, number, number][] = [
    [1, 0, 1.0],
    [1, 1, w],
    [0, 1, 1.0],
    [-1, 1, w],
    [-1, 0, 1.0],
    [-1, -1, w],
    [0, -1, 1.0],
    [1, -1, w],
    [1, 0, 1.0],
  ];

  const grid: NurbsControlPoint[][] = [];

  for (let i = 0; i < levels.length; i++) {
    const { y, r, uWeight } = levels[i];
    const row: NurbsControlPoint[] = [];

    for (let j = 0; j < circleDirs.length; j++) {
      const [cx, cz, vWeight] = circleDirs[j];
      row.push({
        point: [r * cx, y, r * cz],
        weight: uWeight * vWeight,
      });
    }
    grid.push(row);
  }

  return {
    degreeU: 2,
    degreeV: 2,
    knotsU: [0, 0, 0, 0.5, 0.5, 1, 1, 1],
    knotsV: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
    controlPoints: grid,
    resolutionU: 24,
    resolutionV: 32,
    closedV: true,
  };
}

/**
 * Exact Rational NURBS Cone (Rhino 3D standard).
 */
export function createDefaultNurbsCone(radius = 1.0, height = 2.0): NurbsSurfaceData {
  const R = radius;
  const w = Math.SQRT1_2;
  const halfH = height / 2;

  const rowBase: NurbsControlPoint[] = [
    { point: [R, -halfH, 0], weight: 1.0 },
    { point: [R, -halfH, R], weight: w },
    { point: [0, -halfH, R], weight: 1.0 },
    { point: [-R, -halfH, R], weight: w },
    { point: [-R, -halfH, 0], weight: 1.0 },
    { point: [-R, -halfH, -R], weight: w },
    { point: [0, -halfH, -R], weight: 1.0 },
    { point: [R, -halfH, -R], weight: w },
    { point: [R, -halfH, 0], weight: 1.0 },
  ];

  const rowApex: NurbsControlPoint[] = [
    { point: [0, halfH, 0], weight: 1.0 },
    { point: [0, halfH, 0], weight: w },
    { point: [0, halfH, 0], weight: 1.0 },
    { point: [0, halfH, 0], weight: w },
    { point: [0, halfH, 0], weight: 1.0 },
    { point: [0, halfH, 0], weight: w },
    { point: [0, halfH, 0], weight: 1.0 },
    { point: [0, halfH, 0], weight: w },
    { point: [0, halfH, 0], weight: 1.0 },
  ];

  return {
    degreeU: 1,
    degreeV: 2,
    knotsU: [0, 0, 1, 1],
    knotsV: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
    controlPoints: [rowBase, rowApex],
    resolutionU: 16,
    resolutionV: 32,
    closedV: true,
  };
}

/**
 * Exact Rational NURBS Torus (Rhino 3D standard revolution).
 */
export function createDefaultNurbsTorus(majorRadius = 1.0, minorRadius = 0.35): NurbsSurfaceData {
  const R = majorRadius;
  const r = minorRadius;
  const w = Math.SQRT1_2;

  // 9 cross-section circle points around (R, 0)
  const crossOffsets: { x: number; y: number; uWeight: number }[] = [
    { x: r, y: 0, uWeight: 1.0 },
    { x: r, y: r, uWeight: w },
    { x: 0, y: r, uWeight: 1.0 },
    { x: -r, y: r, uWeight: w },
    { x: -r, y: 0, uWeight: 1.0 },
    { x: -r, y: -r, uWeight: w },
    { x: 0, y: -r, uWeight: 1.0 },
    { x: r, y: -r, uWeight: w },
    { x: r, y: 0, uWeight: 1.0 },
  ];

  const circleDirs: [number, number, number][] = [
    [1, 0, 1.0],
    [1, 1, w],
    [0, 1, 1.0],
    [-1, 1, w],
    [-1, 0, 1.0],
    [-1, -1, w],
    [0, -1, 1.0],
    [1, -1, w],
    [1, 0, 1.0],
  ];

  const grid: NurbsControlPoint[][] = [];

  for (let i = 0; i < crossOffsets.length; i++) {
    const { x, y, uWeight } = crossOffsets[i];
    const ringRadius = R + x;
    const row: NurbsControlPoint[] = [];

    for (let j = 0; j < circleDirs.length; j++) {
      const [cx, cz, vWeight] = circleDirs[j];
      row.push({
        point: [ringRadius * cx, y, ringRadius * cz],
        weight: uWeight * vWeight,
      });
    }
    grid.push(row);
  }

  const knots9 = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1];

  return {
    degreeU: 2,
    degreeV: 2,
    knotsU: [...knots9],
    knotsV: [...knots9],
    controlPoints: grid,
    resolutionU: 24,
    resolutionV: 32,
    closedU: true,
    closedV: true,
  };
}

// ─── ADVANCED NURBS OPERATIONS ──────────────────────────────────────────────

/**
 * Extrudes a NURBS Curve along an offset vector, turning it into a NURBS Surface.
 */
export function extrudeNurbsCurve(
  curve: NurbsCurveData,
  offset: V3 = [0, 1.5, 0],
  steps = 2
): NurbsSurfaceData {
  const row0 = curve.controlPoints.map(cp => ({
    point: [...cp.point] as V3,
    weight: cp.weight ?? 1.0,
  }));

  const grid: NurbsControlPoint[][] = [];
  const numSteps = Math.max(2, steps);

  for (let s = 0; s < numSteps; s++) {
    const factor = s / (numSteps - 1);
    const row: NurbsControlPoint[] = row0.map(cp => ({
      point: [
        cp.point[0] + offset[0] * factor,
        cp.point[1] + offset[1] * factor,
        cp.point[2] + offset[2] * factor,
      ],
      weight: cp.weight,
    }));
    grid.push(row);
  }

  return {
    degreeU: numSteps > 3 ? 3 : Math.min(curve.degree, numSteps - 1),
    degreeV: curve.degree,
    knotsV: curve.knots ? [...curve.knots] : undefined,
    controlPoints: grid,
    closedV: curve.closed,
    resolutionU: 12,
    resolutionV: 20,
  };
}

/**
 * Revolves / Lathes a NURBS Curve around an axis (default Y).
 */
export function revolveNurbsCurve(
  curve: NurbsCurveData,
  angleDeg = 360,
  axis: 'x' | 'y' | 'z' = 'y'
): NurbsSurfaceData {
  const pts = curve.controlPoints;
  const numPts = pts.length;
  const w = Math.SQRT1_2;

  // 9 radial sections for 360 degree revolve (4 quarter arcs of 90 degrees)
  const isFull360 = Math.abs(angleDeg - 360) < 0.1;

  const circleDirs: [number, number, number][] = [
    [1, 0, 1.0],
    [1, 1, w],
    [0, 1, 1.0],
    [-1, 1, w],
    [-1, 0, 1.0],
    [-1, -1, w],
    [0, -1, 1.0],
    [1, -1, w],
    [1, 0, 1.0],
  ];

  const grid: NurbsControlPoint[][] = [];

  for (let i = 0; i < numPts; i++) {
    const cp = pts[i];
    const [px, py, pz] = cp.point;
    const ptW = cp.weight ?? 1.0;
    const row: NurbsControlPoint[] = [];

    for (let j = 0; j < circleDirs.length; j++) {
      const [cx, cz, vWeight] = circleDirs[j];
      let rx = px, ry = py, rz = pz;
      if (axis === 'y') {
        const radius = Math.hypot(px, pz);
        rx = radius * cx;
        rz = radius * cz;
      } else if (axis === 'x') {
        const radius = Math.hypot(py, pz);
        ry = radius * cx;
        rz = radius * cz;
      } else if (axis === 'z') {
        const radius = Math.hypot(px, py);
        rx = radius * cx;
        ry = radius * cz;
      }

      row.push({
        point: [rx, ry, rz],
        weight: ptW * vWeight,
      });
    }
    grid.push(row);
  }

  const knotsV = isFull360
    ? [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1]
    : generateClampedKnots(9, 2);

  return {
    degreeU: curve.degree,
    degreeV: 2,
    knotsU: curve.knots ? [...curve.knots] : undefined,
    knotsV,
    controlPoints: grid,
    closedU: curve.closed,
    closedV: isFull360,
    resolutionU: 18,
    resolutionV: 28,
  };
}

/**
 * Lofts / Skins multiple NURBS Curves to create a continuous NURBS Surface.
 */
export function loftNurbsCurves(curves: NurbsCurveData[]): NurbsSurfaceData {
  if (curves.length === 0) return createDefaultNurbsSurface();
  if (curves.length === 1) return extrudeNurbsCurve(curves[0]);

  // Match control point count across all curves (resample if needed)
  const maxPts = Math.max(...curves.map(c => c.controlPoints.length));
  const grid: NurbsControlPoint[][] = [];

  for (const c of curves) {
    if (c.controlPoints.length === maxPts) {
      grid.push(c.controlPoints.map(cp => ({ point: [...cp.point], weight: cp.weight ?? 1.0 })));
    } else {
      // Sample curve to match point count
      const sampled = sampleNurbsCurve(c, maxPts - 1);
      grid.push(sampled.map(pt => ({ point: pt, weight: 1.0 })));
    }
  }

  const degU = Math.max(1, Math.min(3, curves.length - 1));
  const degV = Math.max(1, Math.min(3, maxPts - 1));

  return {
    degreeU: degU,
    degreeV: degV,
    controlPoints: grid,
    resolutionU: 16,
    resolutionV: 24,
  };
}

/**
 * Subdivides a NURBS Curve by inserting midpoints into its control polygon.
 */
export function subdivideNurbsCurve(curve: NurbsCurveData): NurbsCurveData {
  const pts = curve.controlPoints;
  if (pts.length < 2) return curve;

  const newPts: NurbsControlPoint[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    newPts.push({ point: [...a.point], weight: a.weight });

    // Midpoint
    const midPoint: V3 = [
      (a.point[0] + b.point[0]) / 2,
      (a.point[1] + b.point[1]) / 2,
      (a.point[2] + b.point[2]) / 2,
    ];
    const midWeight = (a.weight + b.weight) / 2;
    newPts.push({ point: midPoint, weight: midWeight });
  }

  // Last point or closed wrap
  const last = pts[pts.length - 1];
  newPts.push({ point: [...last.point], weight: last.weight });

  if (curve.closed) {
    const first = pts[0];
    const midPoint: V3 = [
      (last.point[0] + first.point[0]) / 2,
      (last.point[1] + first.point[1]) / 2,
      (last.point[2] + first.point[2]) / 2,
    ];
    newPts.push({ point: midPoint, weight: (last.weight + first.weight) / 2 });
  }

  return {
    ...curve,
    controlPoints: newPts,
    knots: generateClampedKnots(newPts.length, curve.degree),
  };
}

/**
 * Subdivides a NURBS Surface grid along U, V, or both.
 */
export function subdivideNurbsSurface(
  surface: NurbsSurfaceData,
  direction: 'U' | 'V' | 'BOTH' = 'BOTH'
): NurbsSurfaceData {
  let grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU < 2 || numV < 2) return surface;

  // Subdivide along U
  if (direction === 'U' || direction === 'BOTH') {
    const newGridU: NurbsControlPoint[][] = [];
    for (let i = 0; i < numU - 1; i++) {
      newGridU.push(grid[i]);
      const midRow: NurbsControlPoint[] = [];
      for (let j = 0; j < numV; j++) {
        const a = grid[i][j];
        const b = grid[i + 1][j];
        midRow.push({
          point: [
            (a.point[0] + b.point[0]) / 2,
            (a.point[1] + b.point[1]) / 2,
            (a.point[2] + b.point[2]) / 2,
          ],
          weight: (a.weight + b.weight) / 2,
        });
      }
      newGridU.push(midRow);
    }
    newGridU.push(grid[numU - 1]);
    grid = newGridU;
  }

  // Subdivide along V
  if (direction === 'V' || direction === 'BOTH') {
    const curU = grid.length;
    const curV = grid[0].length;
    const newGridV: NurbsControlPoint[][] = [];

    for (let i = 0; i < curU; i++) {
      const newRow: NurbsControlPoint[] = [];
      for (let j = 0; j < curV - 1; j++) {
        const a = grid[i][j];
        const b = grid[i][j + 1];
        newRow.push(a);
        newRow.push({
          point: [
            (a.point[0] + b.point[0]) / 2,
            (a.point[1] + b.point[1]) / 2,
            (a.point[2] + b.point[2]) / 2,
          ],
          weight: (a.weight + b.weight) / 2,
        });
      }
      newRow.push(grid[i][curV - 1]);
      newGridV.push(newRow);
    }
    grid = newGridV;
  }

  return {
    ...surface,
    controlPoints: grid,
    knotsU: generateClampedKnots(grid.length, surface.degreeU),
    knotsV: generateClampedKnots(grid[0].length, surface.degreeV),
  };
}

/**
 * Extends / Extrudes a boundary row of a NURBS surface (e.g. key E in Blender).
 */
export function extrudeNurbsSurfaceRow(
  surface: NurbsSurfaceData,
  uOrV: 'U' | 'V' = 'U',
  side: 'START' | 'END' = 'END',
  delta: V3 = [0, 0.5, 0]
): NurbsSurfaceData {
  const grid = surface.controlPoints.map(row => row.map(cp => ({ ...cp, point: [...cp.point] as V3 })));
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU === 0 || numV === 0) return surface;

  if (uOrV === 'U') {
    const baseRow = side === 'END' ? grid[numU - 1] : grid[0];
    const newRow = baseRow.map(cp => ({
      point: [cp.point[0] + delta[0], cp.point[1] + delta[1], cp.point[2] + delta[2]] as V3,
      weight: cp.weight,
    }));
    if (side === 'END') grid.push(newRow);
    else grid.unshift(newRow);
  } else {
    for (let i = 0; i < numU; i++) {
      const basePt = side === 'END' ? grid[i][numV - 1] : grid[i][0];
      const newPt = {
        point: [basePt.point[0] + delta[0], basePt.point[1] + delta[1], basePt.point[2] + delta[2]] as V3,
        weight: basePt.weight,
      };
      if (side === 'END') grid[i].push(newPt);
      else grid[i].unshift(newPt);
    }
  }

  return {
    ...surface,
    controlPoints: grid,
    knotsU: generateClampedKnots(grid.length, surface.degreeU),
    knotsV: generateClampedKnots(grid[0].length, surface.degreeV),
  };
}

/**
 * Reverses direction of a NURBS Curve or Surface (Switch Direction).
 */
export function switchNurbsDirection(
  data: NurbsCurveData | NurbsSurfaceData,
  dir: 'U' | 'V' = 'U'
): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    let grid = s.controlPoints.map(r => [...r]);
    if (dir === 'U') {
      grid = grid.reverse();
    } else {
      grid = grid.map(r => r.reverse());
    }
    return {
      ...s,
      controlPoints: grid,
    };
  } else {
    const c = data as NurbsCurveData;
    return {
      ...c,
      controlPoints: [...c.controlPoints].reverse(),
    };
  }
}

// ─── BLENDER CURVE & SURFACE STRUCTURE OPERATORS ─────────────────────────────

/**
 * Smooths NURBS Curve control points using Laplacian relaxation.
 */
export function smoothNurbsCurve(curve: NurbsCurveData, factor = 0.5): NurbsCurveData {
  const pts = curve.controlPoints;
  const n = pts.length;
  if (n < 3) return curve;

  const newPts: NurbsControlPoint[] = pts.map(cp => ({ ...cp, point: [...cp.point] as V3 }));

  const startIdx = curve.closed ? 0 : 1;
  const endIdx = curve.closed ? n : n - 1;

  for (let i = startIdx; i < endIdx; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const pPrev = pts[prevIdx].point;
    const pCur = pts[i].point;
    const pNext = pts[nextIdx].point;

    const avgX = (pPrev[0] + pNext[0]) / 2;
    const avgY = (pPrev[1] + pNext[1]) / 2;
    const avgZ = (pPrev[2] + pNext[2]) / 2;

    newPts[i].point = [
      pCur[0] + (avgX - pCur[0]) * factor,
      pCur[1] + (avgY - pCur[1]) * factor,
      pCur[2] + (avgZ - pCur[2]) * factor,
    ];
  }

  return {
    ...curve,
    controlPoints: newPts,
  };
}

/**
 * Smooths NURBS Surface control grid using 2D Laplacian relaxation.
 */
export function smoothNurbsSurface(surface: NurbsSurfaceData, factor = 0.5): NurbsSurfaceData {
  const grid = surface.controlPoints;
  const numU = grid.length;
  const numV = grid[0]?.length ?? 0;
  if (numU < 3 || numV < 3) return surface;

  const newGrid: NurbsControlPoint[][] = grid.map(row =>
    row.map(cp => ({ ...cp, point: [...cp.point] as V3 }))
  );

  const startU = surface.closedU ? 0 : 1;
  const endU = surface.closedU ? numU : numU - 1;
  const startV = surface.closedV ? 0 : 1;
  const endV = surface.closedV ? numV : numV - 1;

  for (let u = startU; u < endU; u++) {
    for (let v = startV; v < endV; v++) {
      const uPrev = (u - 1 + numU) % numU;
      const uNext = (u + 1) % numU;
      const vPrev = (v - 1 + numV) % numV;
      const vNext = (v + 1) % numV;

      const pCur = grid[u][v].point;
      const p1 = grid[uPrev][v].point;
      const p2 = grid[uNext][v].point;
      const p3 = grid[u][vPrev].point;
      const p4 = grid[u][vNext].point;

      const avgX = (p1[0] + p2[0] + p3[0] + p4[0]) / 4;
      const avgY = (p1[1] + p2[1] + p3[1] + p4[1]) / 4;
      const avgZ = (p1[2] + p2[2] + p3[2] + p4[2]) / 4;

      newGrid[u][v].point = [
        pCur[0] + (avgX - pCur[0]) * factor,
        pCur[1] + (avgY - pCur[1]) * factor,
        pCur[2] + (avgZ - pCur[2]) * factor,
      ];
    }
  }

  return {
    ...surface,
    controlPoints: newGrid,
  };
}

/**
 * Resets all rational weights to 1.0 (Uniform B-Spline).
 */
export function resetNurbsWeights(data: NurbsCurveData | NurbsSurfaceData): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    return {
      ...s,
      controlPoints: s.controlPoints.map(row =>
        row.map(cp => ({ ...cp, weight: 1.0 }))
      ),
    };
  } else {
    const c = data as NurbsCurveData;
    return {
      ...c,
      controlPoints: c.controlPoints.map(cp => ({ ...cp, weight: 1.0 })),
    };
  }
}

/**
 * Resets per-point radii to 1.0 and tilt angles to 0°.
 */
export function resetNurbsTiltsAndRadii(data: NurbsCurveData | NurbsSurfaceData): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    return {
      ...s,
      controlPoints: s.controlPoints.map(row =>
        row.map(cp => ({ ...cp, radius: 1.0, tilt: 0 }))
      ),
    };
  } else {
    const c = data as NurbsCurveData;
    return {
      ...c,
      controlPoints: c.controlPoints.map(cp => ({ ...cp, radius: 1.0, tilt: 0 })),
    };
  }
}

/**
 * Sets NURBS Order (Order = Degree + 1; e.g. Order 2=Linear, 3=Quadratic, 4=Cubic, 5=Quartic, 6=Quintic).
 */
export function setNurbsOrder(
  data: NurbsCurveData | NurbsSurfaceData,
  orderU: number,
  orderV?: number
): any {
  const oU = Math.max(2, Math.min(6, Math.round(orderU)));
  const degreeU = oU - 1;

  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    const oV = Math.max(2, Math.min(6, Math.round(orderV ?? oU)));
    const degreeV = oV - 1;
    const maxDegU = Math.max(1, s.controlPoints.length - 1);
    const maxDegV = Math.max(1, (s.controlPoints[0]?.length || 4) - 1);
    const validDegU = Math.min(degreeU, maxDegU);
    const validDegV = Math.min(degreeV, maxDegV);

    return {
      ...s,
      degreeU: validDegU,
      degreeV: validDegV,
      knotsU: buildKnots(s.controlPoints.length, validDegU, s.closedU, s.endpointU !== false, s.knotsTypeU),
      knotsV: buildKnots(s.controlPoints[0]?.length || 4, validDegV, s.closedV, s.endpointV !== false, s.knotsTypeV),
    };
  } else {
    const c = data as NurbsCurveData;
    const maxDeg = Math.max(1, c.controlPoints.length - 1);
    const validDeg = Math.min(degreeU, maxDeg);
    return {
      ...c,
      degree: validDeg,
      knots: buildKnots(c.controlPoints.length, validDeg, c.closed, c.endpoint !== false, c.knotsType),
    };
  }
}

/**
 * Toggles Endpoint Clamping (forces curve/surface to touch boundary control points).
 */
export function toggleNurbsEndpoint(
  data: NurbsCurveData | NurbsSurfaceData,
  dir: 'U' | 'V' = 'U'
): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    const endpointU = dir === 'U' ? (s.endpointU === false ? true : false) : (s.endpointU !== false);
    const endpointV = dir === 'V' ? (s.endpointV === false ? true : false) : (s.endpointV !== false);
    return {
      ...s,
      endpointU,
      endpointV,
      knotsU: buildKnots(s.controlPoints.length, s.degreeU, s.closedU, endpointU, s.knotsTypeU),
      knotsV: buildKnots(s.controlPoints[0]?.length || 4, s.degreeV, s.closedV, endpointV, s.knotsTypeV),
    };
  } else {
    const c = data as NurbsCurveData;
    const endpoint = c.endpoint === false ? true : false;
    return {
      ...c,
      endpoint,
      knots: buildKnots(c.controlPoints.length, c.degree, c.closed, endpoint, c.knotsType),
    };
  }
}

/**
 * Toggles Cyclic property (closed loop in U or V direction).
 */
export function toggleNurbsCyclic(
  data: NurbsCurveData | NurbsSurfaceData,
  dir: 'U' | 'V' = 'U'
): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    const closedU = dir === 'U' ? !s.closedU : !!s.closedU;
    const closedV = dir === 'V' ? !s.closedV : !!s.closedV;
    return {
      ...s,
      closedU,
      closedV,
      knotsU: buildKnots(s.controlPoints.length, s.degreeU, closedU, s.endpointU !== false, s.knotsTypeU),
      knotsV: buildKnots(s.controlPoints[0]?.length || 4, s.degreeV, closedV, s.endpointV !== false, s.knotsTypeV),
    };
  } else {
    const c = data as NurbsCurveData;
    const closed = !c.closed;
    return {
      ...c,
      closed,
      knots: buildKnots(c.controlPoints.length, c.degree, closed, c.endpoint !== false, c.knotsType),
    };
  }
}

/**
 * Sets Knot Vector distribution type (ENDPOINT, UNIFORM, BEZIER).
 */
export function setNurbsKnotType(
  data: NurbsCurveData | NurbsSurfaceData,
  knotType: NurbsKnotType,
  dir: 'U' | 'V' = 'U'
): any {
  if ('degreeU' in data) {
    const s = data as NurbsSurfaceData;
    const knotsTypeU = dir === 'U' ? knotType : (s.knotsTypeU || 'ENDPOINT');
    const knotsTypeV = dir === 'V' ? knotType : (s.knotsTypeV || 'ENDPOINT');
    return {
      ...s,
      knotsTypeU,
      knotsTypeV,
      knotsU: buildKnots(s.controlPoints.length, s.degreeU, s.closedU, s.endpointU !== false, knotsTypeU),
      knotsV: buildKnots(s.controlPoints[0]?.length || 4, s.degreeV, s.closedV, s.endpointV !== false, knotsTypeV),
    };
  } else {
    const c = data as NurbsCurveData;
    return {
      ...c,
      knotsType: knotType,
      knots: buildKnots(c.controlPoints.length, c.degree, c.closed, c.endpoint !== false, knotType),
    };
  }
}

/**
 * Transpose a NURBS surface (swaps U and V parameters and control point grid).
 */
export function transposeNurbsSurface(surf: NurbsSurfaceData): NurbsSurfaceData {
  const numU = surf.controlPoints.length;
  const numV = surf.controlPoints[0]?.length || 0;
  const newCP: NurbsControlPoint[][] = [];

  for (let v = 0; v < numV; v++) {
    const row: NurbsControlPoint[] = [];
    for (let u = 0; u < numU; u++) {
      row.push({ ...surf.controlPoints[u][v] });
    }
    newCP.push(row);
  }

  return {
    degreeU: surf.degreeV,
    degreeV: surf.degreeU,
    knotsU: surf.knotsV ? [...surf.knotsV] : undefined,
    knotsV: surf.knotsU ? [...surf.knotsU] : undefined,
    knotsTypeU: surf.knotsTypeV,
    knotsTypeV: surf.knotsTypeU,
    endpointU: surf.endpointV,
    endpointV: surf.endpointU,
    closedU: surf.closedV,
    closedV: surf.closedU,
    resolutionU: surf.resolutionV,
    resolutionV: surf.resolutionU,
    controlPoints: newCP
  };
}

/**
 * Reverse the U parametric direction of a NURBS surface.
 */
export function reverseNurbsSurfaceU(surf: NurbsSurfaceData): NurbsSurfaceData {
  const newCP = [...surf.controlPoints].reverse().map(row => row.map(cp => ({ ...cp })));
  let newKnotsU: number[] | undefined;
  if (surf.knotsU && surf.knotsU.length > 0) {
    const maxK = surf.knotsU[surf.knotsU.length - 1];
    newKnotsU = surf.knotsU.slice().reverse().map(k => maxK - k);
  }
  return {
    ...surf,
    knotsU: newKnotsU,
    controlPoints: newCP
  };
}

/**
 * Reverse the V parametric direction of a NURBS surface.
 */
export function reverseNurbsSurfaceV(surf: NurbsSurfaceData): NurbsSurfaceData {
  const newCP = surf.controlPoints.map(row => [...row].reverse().map(cp => ({ ...cp })));
  let newKnotsV: number[] | undefined;
  if (surf.knotsV && surf.knotsV.length > 0) {
    const maxK = surf.knotsV[surf.knotsV.length - 1];
    newKnotsV = surf.knotsV.slice().reverse().map(k => maxK - k);
  }
  return {
    ...surf,
    knotsV: newKnotsV,
    controlPoints: newCP
  };
}

/**
 * Align extreme edge of slave surface to master surface (G0 continuity).
 * Snaps the boundary control points and weights in the transversal V direction.
 */
export function alignSurfacesG0(
  master: NurbsSurfaceData,
  slave: NurbsSurfaceData,
  options: { edgeMaster?: 'START' | 'END'; edgeSlave?: 'START' | 'END' } = { edgeMaster: 'END', edgeSlave: 'START' }
): NurbsSurfaceData {
  const uMaster = options.edgeMaster === 'START' ? 0 : master.controlPoints.length - 1;
  const uSlave = options.edgeSlave === 'START' ? 0 : slave.controlPoints.length - 1;

  const pointsMaster = master.controlPoints[uMaster];
  const pointsSlave = slave.controlPoints[uSlave];

  if (!pointsMaster || !pointsSlave || pointsMaster.length !== pointsSlave.length) {
    throw new Error("Las superficies deben tener el mismo número de puntos de control en la dirección transversal V.");
  }

  const updatedSlave: NurbsSurfaceData = {
    ...slave,
    controlPoints: slave.controlPoints.map(row => row.map(cp => ({ ...cp })))
  };

  for (let v = 0; v < pointsMaster.length; v++) {
    updatedSlave.controlPoints[uSlave][v].point = [...pointsMaster[v].point];
    updatedSlave.controlPoints[uSlave][v].weight = pointsMaster[v].weight;
    if (pointsMaster[v].radius !== undefined) updatedSlave.controlPoints[uSlave][v].radius = pointsMaster[v].radius;
    if (pointsMaster[v].tilt !== undefined) updatedSlave.controlPoints[uSlave][v].tilt = pointsMaster[v].tilt;
  }

  return updatedSlave;
}

/**
 * Automatically orient slave and master along their closest adjacent boundary edges,
 * then align G0.
 */
export function alignSurfacesG0Auto(
  master: NurbsSurfaceData,
  slaveIn: NurbsSurfaceData
): { master: NurbsSurfaceData; slave: NurbsSurfaceData } {
  let slave = {
    ...slaveIn,
    controlPoints: slaveIn.controlPoints.map(r => r.map(c => ({ ...c, point: [...c.point] as [number, number, number] })))
  };

  const getRowPoints = (s: NurbsSurfaceData, uIdx: number) => s.controlPoints[uIdx].map(c => c.point);
  const getColPoints = (s: NurbsSurfaceData, vIdx: number) => s.controlPoints.map(r => r[vIdx].point);

  const avgDist = (ptsA: [number, number, number][], ptsB: [number, number, number][]) => {
    if (ptsA.length !== ptsB.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < ptsA.length; i++) {
      const dx = ptsA[i][0] - ptsB[i][0];
      const dy = ptsA[i][1] - ptsB[i][1];
      const dz = ptsA[i][2] - ptsB[i][2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return sum / ptsA.length;
  };

  const uEndMaster = master.controlPoints.length - 1;
  const uEndSlave = slave.controlPoints.length - 1;
  const vEndMaster = (master.controlPoints[0]?.length || 1) - 1;
  const vEndSlave = (slave.controlPoints[0]?.length || 1) - 1;

  // Check configurations
  // Case A: Master along U, Slave along U
  let bestDist = Infinity;
  let bestConfig = { transposeM: false, transposeS: false, reverseMU: false, reverseMV: false, reverseSU: false, reverseSV: false };

  const masterVariations = [
    { surf: master, trans: false }
  ];

  const slaveVariations = [
    { surf: slave, trans: false, revU: false, revV: false },
    { surf: reverseNurbsSurfaceU(slave), trans: false, revU: true, revV: false },
    { surf: reverseNurbsSurfaceV(slave), trans: false, revU: false, revV: true },
    { surf: reverseNurbsSurfaceV(reverseNurbsSurfaceU(slave)), trans: false, revU: true, revV: true },
    // Transposed variations
    { surf: transposeNurbsSurface(slave), trans: true, revU: false, revV: false },
    { surf: reverseNurbsSurfaceU(transposeNurbsSurface(slave)), trans: true, revU: true, revV: false },
    { surf: reverseNurbsSurfaceV(transposeNurbsSurface(slave)), trans: true, revU: false, revV: true },
    { surf: reverseNurbsSurfaceV(reverseNurbsSurfaceU(transposeNurbsSurface(slave))), trans: true, revU: true, revV: true }
  ];

  let bestMaster = master;
  let bestSlave = slave;

  for (const sVar of slaveVariations) {
    if (sVar.surf.controlPoints[0]?.length === master.controlPoints[0]?.length) {
      // Connect Master END (U_max) with Slave START (U_0)
      const d = avgDist(
        getRowPoints(master, master.controlPoints.length - 1),
        getRowPoints(sVar.surf, 0)
      );
      if (d < bestDist) {
        bestDist = d;
        bestSlave = sVar.surf;
        bestMaster = master;
      }
    }
  }

  // Perform G0 alignment along Master END and Slave START
  const alignedSlave = alignSurfacesG0(bestMaster, bestSlave, { edgeMaster: 'END', edgeSlave: 'START' });
  return { master: bestMaster, slave: alignedSlave };
}

/**
 * Merge two NURBS surfaces along the U parametric direction into a single continuous NurbsSurfaceData entity.
 * Handles control points stitching and knot vector extension.
 */
export function mergeSurfacesU(master: NurbsSurfaceData, slave: NurbsSurfaceData): NurbsSurfaceData {
  if (master.degreeU !== slave.degreeU || master.degreeV !== slave.degreeV) {
    throw new Error("No se pueden fusionar superficies con diferentes grados polinomiales (degrees).");
  }
  if (!master.controlPoints[0] || !slave.controlPoints[0] || master.controlPoints[0].length !== slave.controlPoints[0].length) {
    throw new Error("La resolución de puntos de control en la dirección transversal V debe ser idéntica.");
  }

  // Combine 2D control point matrices (omitting slave's first row which is snapped to master's last row)
  const masterPointsCopy = master.controlPoints.map(row => row.map(cp => ({ ...cp })));
  const slavePointsCopy = slave.controlPoints.slice(1).map(row => row.map(cp => ({ ...cp })));
  const combinedControlPoints: NurbsControlPoint[][] = [...masterPointsCopy, ...slavePointsCopy];

  // Extend and build continuous Knot Vector in U
  let combinedKnotsU: number[] | undefined;
  if (master.knotsU && slave.knotsU) {
    const lastMasterKnot = master.knotsU[master.knotsU.length - 1];
    const firstSlaveKnot = slave.knotsU[0];
    const offset = lastMasterKnot - firstSlaveKnot;
    const p = master.degreeU;
    const continuousSlaveKnots = slave.knotsU.slice(p + 1).map(k => k + offset);
    combinedKnotsU = [...master.knotsU, ...continuousSlaveKnots];
  } else {
    combinedKnotsU = buildKnots(combinedControlPoints.length, master.degreeU, false, master.endpointU !== false, master.knotsTypeU);
  }

  const combinedKnotsV = master.knotsV
    ? [...master.knotsV]
    : buildKnots(combinedControlPoints[0].length, master.degreeV, master.closedV, master.endpointV !== false, master.knotsTypeV);

  return {
    degreeU: master.degreeU,
    degreeV: master.degreeV,
    knotsU: combinedKnotsU,
    knotsV: combinedKnotsV,
    knotsTypeU: master.knotsTypeU,
    knotsTypeV: master.knotsTypeV,
    endpointU: master.endpointU,
    endpointV: master.endpointV,
    closedU: false,
    closedV: master.closedV,
    resolutionU: (master.resolutionU || 16) + (slave.resolutionU || 16),
    resolutionV: master.resolutionV || 16,
    controlPoints: combinedControlPoints
  };
}

/**
 * Creates a Ruled NURBS Surface connecting two 3D boundary curves linearly (3ds Max Ruled Surface).
 */
export function createNurbsRuledSurface(
  curveA: NurbsCurveData,
  curveB: NurbsCurveData,
  uSteps = 4
): NurbsSurfaceData {
  const numPts = Math.max(curveA.controlPoints.length, curveB.controlPoints.length);
  const ptsA = curveA.controlPoints.length === numPts
    ? curveA.controlPoints.map(cp => ({ ...cp, point: [...cp.point] as V3 }))
    : sampleNurbsCurve(curveA, numPts - 1).map(p => ({ point: p, weight: 1.0 }));

  const ptsB = curveB.controlPoints.length === numPts
    ? curveB.controlPoints.map(cp => ({ ...cp, point: [...cp.point] as V3 }))
    : sampleNurbsCurve(curveB, numPts - 1).map(p => ({ point: p, weight: 1.0 }));

  const grid: NurbsControlPoint[][] = [];
  const steps = Math.max(2, uSteps);

  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const row: NurbsControlPoint[] = [];
    for (let i = 0; i < numPts; i++) {
      const pa = ptsA[i].point;
      const pb = ptsB[i].point;
      const wa = ptsA[i].weight ?? 1.0;
      const wb = ptsB[i].weight ?? 1.0;
      row.push({
        point: [
          pa[0] * (1 - t) + pb[0] * t,
          pa[1] * (1 - t) + pb[1] * t,
          pa[2] * (1 - t) + pb[2] * t,
        ],
        weight: wa * (1 - t) + wb * t,
      });
    }
    grid.push(row);
  }

  return {
    degreeU: steps > 3 ? 3 : 1,
    degreeV: Math.max(1, Math.min(3, numPts - 1)),
    controlPoints: grid,
    resolutionU: 16,
    resolutionV: 24,
    closedV: curveA.closed && curveB.closed,
  };
}

/**
 * Creates a Cap Surface for a closed NURBS Curve (3ds Max Cap Surface).
 */
export function createNurbsCapSurface(curve: NurbsCurveData): NurbsSurfaceData {
  const pts = curve.controlPoints;
  const numPts = pts.length;
  // Calculate center of mass
  let cx = 0, cy = 0, cz = 0;
  for (const cp of pts) {
    cx += cp.point[0];
    cy += cp.point[1];
    cz += cp.point[2];
  }
  cx /= numPts; cy /= numPts; cz /= numPts;

  const centerRow: NurbsControlPoint[] = pts.map(() => ({
    point: [cx, cy, cz] as V3,
    weight: 1.0,
  }));

  const midRow: NurbsControlPoint[] = pts.map(cp => ({
    point: [
      (cp.point[0] + cx) * 0.5,
      (cp.point[1] + cy) * 0.5,
      (cp.point[2] + cz) * 0.5,
    ] as V3,
    weight: cp.weight ?? 1.0,
  }));

  const boundaryRow: NurbsControlPoint[] = pts.map(cp => ({
    point: [...cp.point] as V3,
    weight: cp.weight ?? 1.0,
  }));

  return {
    degreeU: 2,
    degreeV: curve.degree,
    knotsU: [0, 0, 0, 1, 1, 1],
    knotsV: curve.knots ? [...curve.knots] : undefined,
    controlPoints: [centerRow, midRow, boundaryRow],
    resolutionU: 12,
    resolutionV: 24,
    closedV: true,
  };
}

