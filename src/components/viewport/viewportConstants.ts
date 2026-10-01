import * as THREE from 'three';

export const createVertexPointTexture = (shape: 'circle' | 'cross' = 'circle'): THREE.CanvasTexture => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  if (shape === 'cross') {
    // Crisp cross '+' / 'x' marker with high-contrast outline
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#09090b';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15, 15); ctx.lineTo(49, 49);
    ctx.moveTo(49, 15); ctx.lineTo(15, 49);
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(15, 15); ctx.lineTo(49, 49);
    ctx.moveTo(49, 15); ctx.lineTo(15, 49);
    ctx.stroke();
  } else {
    // Crisp circular dot with high-contrast dark border
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#09090b';
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
};

export const VERTEX_DOT_TEXTURE = typeof document !== 'undefined' ? createVertexPointTexture('circle') : null;
export const VERTEX_CROSS_TEXTURE = typeof document !== 'undefined' ? createVertexPointTexture('cross') : null;
if (VERTEX_DOT_TEXTURE) VERTEX_DOT_TEXTURE.userData = { isShared: true };
if (VERTEX_CROSS_TEXTURE) VERTEX_CROSS_TEXTURE.userData = { isShared: true };

export const SHARED_VERTEX_GEO = new THREE.SphereGeometry(1, 6, 5);
SHARED_VERTEX_GEO.userData = { isShared: true };
export const SHARED_PICK_GEO = new THREE.SphereGeometry(1, 6, 4);
SHARED_PICK_GEO.userData = { isShared: true };
export const SHARED_SNAP_RING_GEO = new THREE.RingGeometry(0.02, 0.032, 16);
SHARED_SNAP_RING_GEO.userData = { isShared: true };

export const SHARED_WHITE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
SHARED_WHITE_MAT.userData = { isShared: true };
export const SHARED_SELECTED_MAT = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
SHARED_SELECTED_MAT.userData = { isShared: true };
export const SHARED_START_MAT = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false });
SHARED_START_MAT.userData = { isShared: true };
export const SHARED_ACTIVE_MAT = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
SHARED_ACTIVE_MAT.userData = { isShared: true };
export const SHARED_OUT_MAT = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
SHARED_OUT_MAT.userData = { isShared: true };
export const SHARED_IN_MAT = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
SHARED_IN_MAT.userData = { isShared: true };
export const SHARED_SNAP_MAT = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
SHARED_SNAP_MAT.userData = { isShared: true };
export const SHARED_SNAP_DOT_MAT = new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false });
SHARED_SNAP_DOT_MAT.userData = { isShared: true };
export const SHARED_PICK_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
SHARED_PICK_MAT.userData = { isShared: true };
export const SHARED_CYAN_MAT = new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false });
SHARED_CYAN_MAT.userData = { isShared: true };

export const SHARED_POINTS_MAT = new THREE.PointsMaterial({
  size: 7.5,
  sizeAttenuation: false,
  map: VERTEX_DOT_TEXTURE ?? undefined,
  vertexColors: true,
  transparent: true,
  alphaTest: 0.05,
  depthTest: false,
});
SHARED_POINTS_MAT.userData = { isShared: true };

export const SHARED_SEL_POINTS_MAT = new THREE.PointsMaterial({
  size: 9.5,
  sizeAttenuation: false,
  map: VERTEX_DOT_TEXTURE ?? undefined,
  color: 0xf59e0b,
  transparent: true,
  alphaTest: 0.05,
  depthTest: false,
});
SHARED_SEL_POINTS_MAT.userData = { isShared: true };

export const SNAP_ANGLES_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360];

export const snapAngleToPresets = (angleRad: number): number => {
  let deg = (angleRad * 180) / Math.PI;
  const sign = Math.sign(deg) || 1;
  let absDeg = Math.abs(deg);
  const k = Math.floor(absDeg / 360);
  const remDeg = absDeg - k * 360;

  let closest = SNAP_ANGLES_DEG[0];
  let minDiff = Math.abs(remDeg - closest);
  for (let i = 1; i < SNAP_ANGLES_DEG.length; i++) {
    const diff = Math.abs(remDeg - SNAP_ANGLES_DEG[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = SNAP_ANGLES_DEG[i];
    }
  }
  const snappedAbs = k * 360 + closest;
  return sign * snappedAbs * (Math.PI / 180);
};

export const getAdaptiveHandleScale = (
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  viewportHeight: number,
  pixelRadius: number,
  minScale = 0.0005,
  maxScale = 0.05
) => {
  if ((camera as any).isPerspectiveCamera) {
    const pCam = camera as THREE.PerspectiveCamera;
    const dist = camera.position.distanceTo(worldPos);
    const vFov = THREE.MathUtils.degToRad(pCam.fov);
    const worldPerPixel = (2 * dist * Math.tan(vFov * 0.5)) / Math.max(200, viewportHeight || 800);
    return Math.max(minScale, Math.min(maxScale, worldPerPixel * pixelRadius));
  } else if ((camera as any).isOrthographicCamera) {
    const oCam = camera as THREE.OrthographicCamera;
    const worldPerPixel = (oCam.top - oCam.bottom) / (Math.max(200, viewportHeight || 800) * (oCam.zoom || 1));
    return Math.max(minScale, Math.min(maxScale, worldPerPixel * pixelRadius));
  }
  return 0.012;
};
