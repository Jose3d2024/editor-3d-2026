import * as THREE from 'three';
import { CameraObject, CSGObject, V3 } from '../types';

/** Helper to linearly interpolate vectors */
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Interpolates keyframed object transform at a given time */
export function getInterpolatedTransformAtTime(obj: CSGObject, time: number) {
  const kfs = obj.keyframes;
  if (!kfs || kfs.length === 0) return obj.transform;
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].transform;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
  let prev = sorted[0], next = sorted[0];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i]; next = sorted[i + 1]; break;
    }
  }
  const t = (time - prev.time) / (next.time - prev.time);
  return {
    position: [0, 1, 2].map(i => lerp(prev.transform.position[i], next.transform.position[i], t)) as V3,
    rotation: [0, 1, 2].map(i => lerp(prev.transform.rotation[i], next.transform.rotation[i], t)) as V3,
    scale:    [0, 1, 2].map(i => lerp(prev.transform.scale[i],    next.transform.scale[i],    t)) as V3,
  };
}

/** Gets world space position of an object at a given time */
export function getObjectWorldPositionAtTime(obj: CSGObject, time: number): THREE.Vector3 {
  const tr = getInterpolatedTransformAtTime(obj, time);
  const pos = new THREE.Vector3().fromArray(tr.position);

  // If object has vertices, calculate local centroid to account for vertex offsets or custom geometry
  if (obj.vertices && obj.vertices.length > 0) {
    let cx = 0, cy = 0, cz = 0;
    const n = obj.vertices.length;
    for (let i = 0; i < n; i++) {
      const v = obj.vertices[i];
      const off = obj.vertexOffsets?.[i] || [0, 0, 0];
      cx += v[0] + off[0];
      cy += v[1] + off[1];
      cz += v[2] + off[2];
    }
    cx /= n; cy /= n; cz /= n;

    // If local centroid is non-zero, transform it to world space
    if (Math.abs(cx) > 0.001 || Math.abs(cy) > 0.001 || Math.abs(cz) > 0.001) {
      const localCentroid = new THREE.Vector3(cx, cy, cz);
      const mat = new THREE.Matrix4().compose(
        pos,
        new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(tr.rotation)),
        new THREE.Vector3().fromArray(tr.scale)
      );
      return localCentroid.applyMatrix4(mat);
    }
  }

  return pos;
}

/**
  Samples a point on a CSGObject path curve/line in world coordinates at progress t (0.0 to 1.0)
 */
export function samplePathObjectAtProgress(pathObj: CSGObject, progress: number, time: number = 0): THREE.Vector3 {
  const t = Math.max(0, Math.min(1, progress));
  const tr = getInterpolatedTransformAtTime(pathObj, time);
  
  // Matrix transformation for path object
  const mat = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(tr.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(tr.rotation)),
    new THREE.Vector3().fromArray(tr.scale)
  );

  // Extract vertices
  let localVertices: V3[] = pathObj.vertices || [];

  // Fallback if no vertices exist (e.g. primitive shapes, circle, torus)
  if (localVertices.length < 2) {
    const radius = pathObj.parameters?.radius || 5;
    const height = pathObj.parameters?.height || 0;
    const numPts = 36;
    localVertices = [];
    for (let i = 0; i < numPts; i++) {
      const ang = (i / numPts) * Math.PI * 2;
      localVertices.push([Math.cos(ang) * radius, height / 2, Math.sin(ang) * radius]);
    }
  }

  // Convert to world points
  const worldPoints = localVertices.map(v => {
    const pt = new THREE.Vector3(v[0], v[1], v[2]);
    if (pathObj.vertexOffsets) {
      // Add vertex offsets if present
      const idx = localVertices.indexOf(v);
      const off = pathObj.vertexOffsets[idx];
      if (off) pt.add(new THREE.Vector3(off[0], off[1], off[2]));
    }
    return pt.applyMatrix4(mat);
  });

  if (worldPoints.length < 2) {
    return new THREE.Vector3().fromArray(tr.position);
  }

  // Build CatmullRomCurve3
  const isClosed = pathObj.parameters?.closed ?? (pathObj.type === 'CIRCLE' || pathObj.type === 'RING' || pathObj.type === 'TORUS');
  const curve = new THREE.CatmullRomCurve3(worldPoints, isClosed, 'catmullrom', 0.5);
  
  return curve.getPointAt(t);
}

export interface EvaluatedCamera {
  position: THREE.Vector3;
  target: THREE.Vector3 | null;
  fov: number;
}

/**
  Evaluates complete camera state (position & target orientation)
  considering target object tracking and path curve movement.
 */
export function evaluateCameraTransform(
  camera: CameraObject,
  objects: CSGObject[],
  currentTime: number,
  duration: number
): EvaluatedCamera {
  const fov = camera.fov || 45;

  // Default camera position and target
  let camPos = new THREE.Vector3().fromArray(camera.transform.position);
  let targetPos: THREE.Vector3 | null = null;

  // 1. PATH MOVEMENT
  if (camera.pathObjectId) {
    const pathObj = objects.find(o => o.id === camera.pathObjectId);
    if (pathObj) {
      let progress = camera.pathProgress ?? 0;
      const followAnim = camera.followPathAnimation ?? true;
      if (followAnim && duration > 0) {
        progress = (currentTime % duration) / duration;
      }
      camPos = samplePathObjectAtProgress(pathObj, progress, currentTime);
    }
  }

  // Add camera offset if set
  if (camera.cameraOffset) {
    camPos.add(new THREE.Vector3().fromArray(camera.cameraOffset));
  }

  // 2. TARGET TRACKING
  if (camera.targetObjectId) {
    const targetObj = objects.find(o => o.id === camera.targetObjectId);
    if (targetObj) {
      targetPos = getObjectWorldPositionAtTime(targetObj, currentTime);
    }
  }

  return {
    position: camPos,
    target: targetPos,
    fov,
  };
}

/**
  Helper to create a new Camera Path CSGObject (Orbit Circle or Bezier Curve)
  that surrounds the scene or a target object.
 */
export function createCameraPathObject(
  name: string = 'Ruta Cámara (Curva)',
  center: V3 = [0, 2, 0],
  radius: number = 6,
  type: 'CIRCLE' | 'SPIRAL' | 'SINE' = 'CIRCLE'
): CSGObject {
  const vertices: V3[] = [];
  const segments = 48;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = t * Math.PI * 2;
    let x = center[0] + Math.cos(angle) * radius;
    let z = center[2] + Math.sin(angle) * radius;
    let y = center[1];

    if (type === 'SPIRAL') {
      y = center[1] + (t - 0.5) * 4;
    } else if (type === 'SINE') {
      y = center[1] + Math.sin(angle * 2) * 1.5;
    }

    vertices.push([x, y, z]);
  }

  const newPath: CSGObject = {
    id: `camera_path_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    type: 'SHAPE',
    operation: 'ADD',
    keyframes: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    parameters: {
      shapeType: 'line',
      closed: type === 'CIRCLE',
      radius,
      isCameraPath: true,
    },
    vertices,
    faces: [],
    color: '#3b82f6', // Light blue path
    visible: true,
    smoothShading: true,
  };

  return newPath;
}
