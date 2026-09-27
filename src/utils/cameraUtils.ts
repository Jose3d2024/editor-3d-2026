import * as THREE from 'three';
import { CameraObject, V3 } from '../types';

const _vDir = new THREE.Vector3();
const _vUp = new THREE.Vector3();
const _mLookAt = new THREE.Matrix4();
const _qResult = new THREE.Quaternion();

/**
 * Computes the exact Quaternion for a camera (or camera-aligned visual object)
 * at `position` looking directly at `target`, using standard Three.js camera conventions
 * (local -Z as forward, +Y as up, +X as right).
 *
 * Avoids gimbal lock singularities when looking straight up or straight down.
 */
export function computeCameraLookAtQuaternion(
  position: THREE.Vector3,
  target: THREE.Vector3,
  up: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
): THREE.Quaternion {
  _vDir.subVectors(position, target); // In Three.js lookAt matrix: eye - target produces the +Z eye vector
  if (_vDir.lengthSq() < 1e-8) {
    return _qResult.identity();
  }
  _vDir.normalize();

  // If direction is nearly parallel to UP, adjust UP temporarily to avoid NaN/singularity
  _vUp.copy(up);
  const dotY = Math.abs(_vDir.dot(_vUp));
  if (dotY > 0.999) {
    _vUp.set(0, 0, _vDir.y > 0 ? 1 : -1);
  }

  // Construct LookAt rotation matrix (eye -> target, standard camera basis)
  _mLookAt.lookAt(position, target, _vUp);
  _qResult.setFromRotationMatrix(_mLookAt);
  return _qResult.clone();
}

/**
 * Applies unified camera orientation towards `target` on any Object3D or Camera.
 * Guarantees 100% identical orientation between the actual camera and its visual representation.
 */
export function applyCameraLookAt(
  object: THREE.Object3D,
  target: THREE.Vector3,
  up: THREE.Vector3 = new THREE.Vector3(0, 1, 0)
): void {
  const q = computeCameraLookAtQuaternion(object.position, target, up);
  object.quaternion.copy(q);
}

/**
 * Factory that creates the 3D visual representation (helper, body, lens, frustum, reticle, tag)
 * of a camera in the scene.
 */
export function createCameraVisualGroup(
  cameraData: CameraObject,
  isSelected: boolean
): THREE.Group {
  const camGroup = new THREE.Group();
  camGroup.userData = { id: cameraData.id, isCamera: true };

  // 1. Lightweight Camera Body (centered around +Z so lens points down -Z)
  const bodyGeom = new THREE.BoxGeometry(0.36, 0.24, 0.35);
  const bodyMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x4f46e5 : 0x27272a });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.z = 0.175;
  body.userData = { id: cameraData.id, isCamera: true };
  camGroup.add(body);

  // Body Outline
  const bodyWireMat = new THREE.MeshBasicMaterial({
    color: isSelected ? 0xc7d2fe : 0x71717a,
    wireframe: true,
  });
  const bodyWire = new THREE.Mesh(bodyGeom, bodyWireMat);
  bodyWire.position.z = 0.175;
  camGroup.add(bodyWire);

  // 2. Camera Lens (cylinder pointing towards -Z)
  const lensGeom = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 32);
  const lensMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x6366f1 : 0x3f3f46 });
  const lens = new THREE.Mesh(lensGeom, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.1;
  lens.userData = { id: cameraData.id, isCamera: true };
  camGroup.add(lens);

  // 3. Front Glass Element
  const glassGeom = new THREE.CircleGeometry(0.1, 32);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(glassGeom, glassMat);
  glass.position.z = -0.201;
  glass.userData = { id: cameraData.id, isCamera: true };
  camGroup.add(glass);

  // 4. Frustum Wireframe Pyramid
  const frustumGroup = new THREE.Group();
  const frustumGeo = new THREE.BufferGeometry();
  const frustumVerts = new Float32Array([
    // Rear lens rectangle (z = -0.20)
    -0.10,  0.07, -0.20,   0.10,  0.07, -0.20,
     0.10,  0.07, -0.20,   0.10, -0.07, -0.20,
     0.10, -0.07, -0.20,  -0.10, -0.07, -0.20,
    -0.10, -0.07, -0.20,  -0.10,  0.07, -0.20,

    // Front view frame rectangle (z = -1.20)
    -0.45,  0.30, -1.20,   0.45,  0.30, -1.20,
     0.45,  0.30, -1.20,   0.45, -0.30, -1.20,
     0.45, -0.30, -1.20,  -0.45, -0.30, -1.20,
    -0.45, -0.30, -1.20,  -0.45,  0.30, -1.20,

    // Connecting corner edges
    -0.10,  0.07, -0.20,  -0.45,  0.30, -1.20,
     0.10,  0.07, -0.20,   0.45,  0.30, -1.20,
     0.10, -0.07, -0.20,   0.45, -0.30, -1.20,
    -0.10, -0.07, -0.20,  -0.45, -0.30, -1.20,
  ]);
  frustumGeo.setAttribute('position', new THREE.BufferAttribute(frustumVerts, 3));
  const frustumMat = new THREE.LineBasicMaterial({
    color: isSelected ? 0x818cf8 : 0x6366f1,
    transparent: true,
    opacity: isSelected ? 0.95 : 0.6,
  });
  const frustumLines = new THREE.LineSegments(frustumGeo, frustumMat);
  frustumGroup.add(frustumLines);
  camGroup.add(frustumGroup);

  // 5. Target Tracking Ray & Crosshair Reticle Group
  const targetGroup = new THREE.Group();
  targetGroup.name = 'targetTrackingGroup';

  const targetLineGeom = new THREE.BufferGeometry();
  const targetLineMat = new THREE.LineDashedMaterial({
    color: 0x22d3ee,
    dashSize: 0.3,
    gapSize: 0.15,
    scale: 1,
  });
  const targetLine = new THREE.Line(targetLineGeom, targetLineMat);
  targetLine.name = 'targetLine';
  targetGroup.add(targetLine);

  const reticleGroup = new THREE.Group();
  reticleGroup.name = 'targetReticle';
  const ringGeom = new THREE.RingGeometry(0.25, 0.35, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  reticleGroup.add(ring);

  const xHairGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(0.45, 0, 0),
    new THREE.Vector3(0, -0.45, 0), new THREE.Vector3(0, 0.45, 0),
  ]);
  const xHairMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, linewidth: 2 });
  reticleGroup.add(new THREE.LineSegments(xHairGeo, xHairMat));

  targetGroup.add(reticleGroup);
  camGroup.add(targetGroup);

  // 6. 2D Canvas Badge Tag (Floating label above camera)
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isSelected ? 'rgba(79, 70, 229, 0.95)' : 'rgba(24, 24, 27, 0.9)';
    ctx.strokeStyle = isSelected ? '#a5b4fc' : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(4, 4, 272, 64, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('📷', 16, 44);

    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(
      cameraData.name.length > 15 ? cameraData.name.substring(0, 15) + '…' : cameraData.name,
      60,
      42
    );
  }
  const badgeTex = new THREE.CanvasTexture(canvas);
  badgeTex.minFilter = THREE.LinearFilter;
  const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, depthTest: false, transparent: true });
  const badgeSprite = new THREE.Sprite(badgeMat);
  badgeSprite.renderOrder = 999;
  badgeSprite.scale.set(2.0, 0.52, 1);
  badgeSprite.position.set(0, 0.65, 0.1);
  camGroup.add(badgeSprite);

  // Set layers so camera helpers only render in non-camera viewports
  camGroup.traverse((child) => child.layers.set(1));

  return camGroup;
}

/**
 * Updates the target line and reticle of a camera visual group
 */
export function updateCameraTrackingVisual(camGroup: THREE.Object3D, targetPos: THREE.Vector3): void {
  const targetGroup = camGroup.getObjectByName('targetTrackingGroup');
  if (!targetGroup) return;

  targetGroup.visible = true;
  const dist = camGroup.position.distanceTo(targetPos);
  const line = targetGroup.getObjectByName('targetLine') as THREE.Line;
  if (line) {
    const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (posAttr && posAttr.count >= 2) {
      posAttr.setXYZ(0, 0, 0, -0.20);
      posAttr.setXYZ(1, 0, 0, -dist);
      posAttr.needsUpdate = true;
      (line as any).computeLineDistances?.();
    } else {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -0.20),
        new THREE.Vector3(0, 0, -dist),
      ]);
      (line as any).computeLineDistances?.();
    }
  }

  const reticle = targetGroup.getObjectByName('targetReticle');
  if (reticle) {
    reticle.position.set(0, 0, -dist);
  }
}
