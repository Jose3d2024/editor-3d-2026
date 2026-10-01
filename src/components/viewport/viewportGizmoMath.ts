import * as THREE from 'three';

export interface GizmoDir {
  nx: number;
  ny: number;
  color: string;
  sign: number;
  dot: number;
  worldDir: THREE.Vector3;
}

export interface GizmoRotArc {
  pts: { x: number; y: number }[];
  handlePt: { x: number; y: number };
  arcColor: string;
  sphereColor: string;
}

export interface GizmoLayout {
  cx: number;
  cy: number;
  AXIS_LEN: number;
  dirs: Record<string, GizmoDir>;
  rotArcs: Record<string, GizmoRotArc>;
}

export const computeGizmoLayout = (
  gizmoPos: THREE.Vector3,
  camera: THREE.Camera,
  w: number,
  h: number,
  transformSpace: string = 'world',
  selObj?: any,
  customAxisLen?: number,
  transformMode: string = 'universal'
): GizmoLayout | null => {
  const projected = gizmoPos.clone().project(camera);
  if (projected.z > 2 || projected.z < -2) return null;
  const cx = (projected.x * 0.5 + 0.5) * w;
  const cy = (-projected.y * 0.5 + 0.5) * h;
  const AXIS_LEN = customAxisLen || Math.max(75, Math.min(Math.min(w, h) * 0.20, 120));

  const isOrtho = (camera as any).isOrthographicCamera;
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  const eyeDir = isOrtho ? camDir.clone().negate() : camera.position.clone().sub(gizmoPos).normalize();

  let vX = new THREE.Vector3(1, 0, 0);
  let vY = new THREE.Vector3(0, 1, 0);
  let vZ = new THREE.Vector3(0, 0, 1);

  if (transformSpace === 'local' && selObj && selObj.transform) {
    const euler = new THREE.Euler(selObj.transform.rotation[0], selObj.transform.rotation[1], selObj.transform.rotation[2], 'XYZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    vX.applyQuaternion(q);
    vY.applyQuaternion(q);
    vZ.applyQuaternion(q);
  }

  const axes = [
    { axis: 'X', vec: vX, color: '#ef4444' },
    { axis: 'Y', vec: vY, color: '#22c55e' },
    { axis: 'Z', vec: vZ, color: '#3b82f6' }
  ];

  const dirs: Record<string, GizmoDir> = {};

  const orthoCam = isOrtho ? (camera as THREE.OrthographicCamera) : null;
  const worldPerPixel = orthoCam ? Math.abs(orthoCam.top - orthoCam.bottom) / ((orthoCam.zoom || 1) * Math.max(h, 1)) : 0.05;
  const dist = camera.position.distanceTo(gizmoPos);
  const worldScale = isOrtho ? worldPerPixel * AXIS_LEN : Math.max(0.1, dist * 0.12);

  for (const { axis, vec, color } of axes) {
    const dot = eyeDir.dot(vec);
    const sign = (!isOrtho && dot < -0.05) ? -1 : 1;
    const visVec = vec.clone().multiplyScalar(sign);

    const projEnd = gizmoPos.clone().addScaledVector(visVec, worldScale).project(camera);
    const ex = (projEnd.x * 0.5 + 0.5) * w;
    const ey = (-projEnd.y * 0.5 + 0.5) * h;
    const sdx = ex - cx;
    const sdy = ey - cy;
    const len = Math.sqrt(sdx * sdx + sdy * sdy);

    const nx = len > 0.5 ? (sdx / len) * AXIS_LEN : 0;
    const ny = len > 0.5 ? (sdy / len) * AXIS_LEN : 0;

    dirs[axis] = { nx, ny, color, sign, dot, worldDir: vec.clone() };
  }

  const rotArcs: Record<string, GizmoRotArc> = {};

  const arcConfigs = [
    { rotAxis: 'Z', norm: vZ, color: '#3b82f6', sphereColor: '#60a5fa' },
    { rotAxis: 'X', norm: vX, color: '#ef4444', sphereColor: '#f87171' },
    { rotAxis: 'Y', norm: vY, color: '#22c55e', sphereColor: '#4ade80' }
  ];

  const rotRadiusRatio = transformMode === 'rotate' ? 1.05 : 0.72;
  const radius3D = isOrtho ? worldPerPixel * (AXIS_LEN * rotRadiusRatio) : Math.max(0.12, dist * 0.12 * rotRadiusRatio);

  for (const { rotAxis, norm, color, sphereColor } of arcConfigs) {
    let projEye = eyeDir.clone().sub(norm.clone().multiplyScalar(eyeDir.dot(norm)));
    if (projEye.lengthSq() < 1e-6) {
      projEye = Math.abs(norm.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      projEye.sub(norm.clone().multiplyScalar(projEye.dot(norm)));
    }
    projEye.normalize();

    const tangent = new THREE.Vector3().crossVectors(norm, projEye).normalize();

    const pts: { x: number; y: number }[] = [];
    const numSteps = 24;
    for (let i = 0; i <= numSteps; i++) {
      const theta = -Math.PI / 2 + (Math.PI * i) / numSteps;
      const pt3D = gizmoPos.clone()
        .addScaledVector(projEye, Math.cos(theta) * radius3D)
        .addScaledVector(tangent, Math.sin(theta) * radius3D);
      const proj = pt3D.project(camera);
      pts.push({
        x: (proj.x * 0.5 + 0.5) * w,
        y: (-proj.y * 0.5 + 0.5) * h
      });
    }

    const frontPt3D = gizmoPos.clone().addScaledVector(projEye, radius3D);
    const frontProj = frontPt3D.project(camera);
    const handlePt = {
      x: (frontProj.x * 0.5 + 0.5) * w,
      y: (-frontProj.y * 0.5 + 0.5) * h
    };

    rotArcs[rotAxis] = { pts, handlePt, arcColor: color, sphereColor };
  }

  return { cx, cy, AXIS_LEN, dirs, rotArcs };
};
