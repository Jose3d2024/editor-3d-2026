import { V3, BezierHandle } from '../types';

/**
 * Calculates perpendicular distance from a 3D point P to a line segment AB.
 */
function pointToSegmentDistance(p: V3, a: V3, b: V3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const lenSq = dx * dx + dy * dy + dz * dz;

  if (lenSq < 1e-10) {
    return Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
  }

  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const projZ = a[2] + t * dz;

  return Math.hypot(p[0] - projX, p[1] - projY, p[2] - projZ);
}

/**
 * Recursive 3D Ramer-Douglas-Peucker (RDP) algorithm.
 * Reduces dense vertices while preserving the overall shape within an epsilon tolerance.
 */
export function simplifyPolylineRDP(points: V3[], epsilon: number = 0.08): V3[] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = pointToSegmentDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolylineRDP(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolylineRDP(points.slice(maxIdx), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  }

  return [first, last];
}

/**
 * Calculates continuous smooth Bézier tangent handles (C1 continuity) for vertices.
 */
export function generateSmoothBezierHandles(
  vertices: V3[],
  closed: boolean = false,
  smoothFactor: number = 0.35
): BezierHandle[] {
  const n = vertices.length;
  if (n === 0) return [];
  if (n === 1) return [{ out: [0, 0, 0], in: [0, 0, 0], broken: false }];

  const handles: BezierHandle[] = [];

  for (let i = 0; i < n; i++) {
    const curr = vertices[i];

    if (!closed && i === 0) {
      const next = vertices[1];
      const d = Math.hypot(next[0] - curr[0], next[1] - curr[1], next[2] - curr[2]) || 1;
      const s = d * smoothFactor;
      handles.push({
        out: [((next[0] - curr[0]) / d) * s, ((next[1] - curr[1]) / d) * s, ((next[2] - curr[2]) / d) * s],
        in: [0, 0, 0],
        broken: false,
      });
      continue;
    }

    if (!closed && i === n - 1) {
      const prev = vertices[i - 1];
      const d = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2]) || 1;
      const s = d * smoothFactor;
      handles.push({
        in: [((prev[0] - curr[0]) / d) * s, ((prev[1] - curr[1]) / d) * s, ((prev[2] - curr[2]) / d) * s],
        out: [0, 0, 0],
        broken: false,
      });
      continue;
    }

    const pi = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const ni = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const prev = vertices[pi];
    const next = vertices[ni];

    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const dz = next[2] - prev[2];
    const mag = Math.hypot(dx, dy, dz) || 1;

    const dPrev = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2]);
    const dNext = Math.hypot(next[0] - curr[0], next[1] - curr[1], next[2] - curr[2]);
    const s = Math.min(dPrev, dNext) * smoothFactor;

    handles.push({
      out: [(dx / mag) * s, (dy / mag) * s, (dz / mag) * s],
      in: [(-dx / mag) * s, (-dy / mag) * s, (-dz / mag) * s],
      broken: false,
    });
  }

  return handles;
}

/**
 * Optimizes a dense polyline or raw freehand curve:
 * 1. Filters collinear or close micro-vertices using RDP.
 * 2. Generates smooth, continuous Bézier handles for the simplified key anchors.
 */
export function optimizeAndFitSmoothCurve(
  rawPoints: V3[],
  closed: boolean = false,
  tolerance: number = 0.09
): { vertices: V3[]; handles: BezierHandle[] } {
  if (rawPoints.length <= 2) {
    const handles = generateSmoothBezierHandles(rawPoints, closed);
    return { vertices: rawPoints, handles };
  }

  let simplified: V3[];
  if (closed && rawPoints.length > 3) {
    // For closed curves, preserve the start/end junction and simplify internal loop
    const first = rawPoints[0];
    const rest = rawPoints.slice(0, rawPoints.length);
    simplified = simplifyPolylineRDP(rest, tolerance);
    if (simplified.length < 3) {
      simplified = rawPoints.filter((_, idx) => idx % Math.max(1, Math.floor(rawPoints.length / 8)) === 0);
    }
    if (simplified.length > 0 && Math.hypot(simplified[0][0] - first[0], simplified[0][1] - first[1], simplified[0][2] - first[2]) > 0.001) {
      simplified.unshift(first);
    }
  } else {
    simplified = simplifyPolylineRDP(rawPoints, tolerance);
  }

  // Safety: If tolerance was too aggressive and reduced below 2 points, keep evenly spaced samples
  if (simplified.length < 2) {
    simplified = [rawPoints[0], rawPoints[rawPoints.length - 1]];
  }

  const handles = generateSmoothBezierHandles(simplified, closed, 0.35);
  return { vertices: simplified, handles };
}
