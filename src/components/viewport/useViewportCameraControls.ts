import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewportType, V3 } from '../../types';
import { useStore } from '../../store/useStore';
import { getInterpolatedTransform } from '../../utils/cameraPathHelper';

interface UseViewportCameraControlsOptions {
  type: ViewportType | 'CAMERA';
  viewCameraId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  rendererRef: React.RefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  projectRef: React.RefObject<any>;
  meshesRef: React.RefObject<Map<string, THREE.Object3D>>;
  primitivesGroupRef: React.RefObject<THREE.Group>;
  currentTime: number;
  selectedObjectIds: string[];
  selectedObjectId: string | null;
}

export const createViewportCamera = (
  type: ViewportType | 'CAMERA',
  width: number,
  height: number,
  viewCameraId: string | null,
  projectCameras?: any[]
): { camera: THREE.Camera; initialCamTarget: THREE.Vector3 | null } => {
  let camera: THREE.Camera;
  let initialCamTarget: THREE.Vector3 | null = null;

  if (type === 'CAMERA' && viewCameraId) {
    const camData = projectCameras?.find(c => c.id === viewCameraId);
    if (camData) {
      if (camData.type === 'PERSPECTIVE') {
        camera = new THREE.PerspectiveCamera(camData.fov || 50, width / height, camData.near || 0.1, camData.far || 1000);
        (camera as THREE.PerspectiveCamera).filmGauge = camData.filmGauge || 35;
      } else {
        const asp = width / height;
        const size = camData.fov || 10;
        camera = new THREE.OrthographicCamera(-size * asp / 2, size * asp / 2, size / 2, -size / 2, camData.near || 0.1, camData.far || 1000);
      }
      camera.position.fromArray(camData.transform.position);
      camera.rotation.fromArray(camData.transform.rotation);
      camera.scale.fromArray(camData.transform.scale);

      const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
      initialCamTarget = new THREE.Vector3().copy(camera.position).addScaledVector(dir, 5);
    } else {
      camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
      camera.position.set(5, 5, 5);
    }
  } else if (type === 'PERSPECTIVE') {
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(5, 5, 5);
  } else {
    const asp = width / height;
    const size = 10;
    camera = new THREE.OrthographicCamera(-size * asp / 2, size * asp / 2, size / 2, -size / 2, 0.1, 1000);
    if (type === 'TOP') { camera.position.set(0, 10, 0); (camera as any).up.set(0, 0, -1); camera.lookAt(0, 0, 0); }
    if (type === 'BOTTOM') { camera.position.set(0, -10, 0); (camera as any).up.set(0, 0, 1); camera.lookAt(0, 0, 0); }
    if (type === 'FRONT') { camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); }
    if (type === 'BACK') { camera.position.set(0, 0, -10); camera.lookAt(0, 0, 0); }
    if (type === 'LEFT') { camera.position.set(-10, 0, 0); camera.lookAt(0, 0, 0); }
    if (type === 'RIGHT') { camera.position.set(10, 0, 0); camera.lookAt(0, 0, 0); }
  }

  if (type === 'CAMERA') {
    camera.layers.set(0);
  } else {
    camera.layers.enable(0);
    camera.layers.enable(1);
  }

  return { camera, initialCamTarget };
};

export const handleFocusAllObjects = (
  type: ViewportType | 'CAMERA',
  cam: THREE.Camera | null,
  controls: OrbitControls | null,
  renderer: THREE.WebGLRenderer | null,
  project: any,
  meshesRef: React.RefObject<Map<string, THREE.Object3D>>,
  primitivesGroupRef: React.RefObject<THREE.Group>,
  currentTime: number,
  selectedObjectIds: string[],
  selectedObjectId: string | null
) => {
  if (!cam || !project?.objects?.length) return;

  const targetIds = selectedObjectIds.length > 0 ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
  const activeObjects = targetIds.length > 0
    ? project.objects.filter((o: any) => targetIds.includes(o.id) && o.visible !== false)
    : project.objects.filter((o: any) => o.visible !== false);

  if (activeObjects.length === 0) return;

  const box = new THREE.Box3();
  let expanded = false;

  activeObjects.forEach((obj: any) => {
    let object3D = meshesRef.current?.get(obj.id);
    if (!object3D && primitivesGroupRef.current) {
      object3D = primitivesGroupRef.current.children.find((c: any) => c.userData.id === obj.id);
    }
    if (object3D) {
      object3D.updateMatrixWorld(true);
      const meshBox = new THREE.Box3().setFromObject(object3D);
      if (!meshBox.isEmpty() && isFinite(meshBox.min.x) && isFinite(meshBox.max.x)) {
        box.union(meshBox);
        expanded = true;
      }
    }
  });

  if (!expanded) {
    activeObjects.forEach((obj: any) => {
      const _interp = getInterpolatedTransform(obj, currentTime);
      const mat4 = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(_interp.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
        new THREE.Vector3().fromArray(_interp.scale),
      );
      obj.vertices?.forEach((v: any, i: number) => {
        const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
        const worldPt = new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]).applyMatrix4(mat4);
        box.expandByPoint(worldPt);
        expanded = true;
      });
    });
  }

  if (box.isEmpty() || !expanded) {
    box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.5);

  if (type === 'PERSPECTIVE') {
    const persCam = cam as THREE.PerspectiveCamera;
    const fov = persCam.fov * (Math.PI / 180);
    const dist = Math.max((maxDim * 0.5 / Math.tan(fov * 0.5)) * 1.5, 1.0);

    if (persCam.far < dist * 10) {
      persCam.far = Math.max(persCam.far, dist * 10);
      persCam.updateProjectionMatrix();
    }

    if (controls) {
      const dir = new THREE.Vector3().subVectors(cam.position, controls.target);
      if (dir.lengthSq() < 0.0001) {
        dir.set(0.6, 0.5, 1);
      }
      dir.normalize();

      controls.target.copy(center);
      cam.position.copy(center).add(dir.multiplyScalar(dist));
      controls.update();
    }
  } else {
    const orthoCam = cam as THREE.OrthographicCamera;
    const distOffset = Math.max(maxDim * 3, 50);

    if (type === 'TOP') {
      orthoCam.position.set(center.x, center.y + distOffset, center.z);
      orthoCam.up.set(0, 0, -1);
    } else if (type === 'BOTTOM') {
      orthoCam.position.set(center.x, center.y - distOffset, center.z);
      orthoCam.up.set(0, 0, 1);
    } else if (type === 'FRONT') {
      orthoCam.position.set(center.x, center.y, center.z + distOffset);
      orthoCam.up.set(0, 1, 0);
    } else if (type === 'BACK') {
      orthoCam.position.set(center.x, center.y, center.z - distOffset);
      orthoCam.up.set(0, 1, 0);
    } else if (type === 'LEFT') {
      orthoCam.position.set(center.x - distOffset, center.y, center.z);
      orthoCam.up.set(0, 1, 0);
    } else if (type === 'RIGHT') {
      orthoCam.position.set(center.x + distOffset, center.y, center.z);
      orthoCam.up.set(0, 1, 0);
    }

    orthoCam.near = -distOffset * 2;
    orthoCam.far = distOffset * 2;
    orthoCam.lookAt(center);

    const w = renderer?.domElement.clientWidth || 1;
    const h = renderer?.domElement.clientHeight || 1;
    const asp = w / h;
    const halfH = 5;
    const halfW = halfH * asp;

    let viewW = 1;
    let viewH = 1;
    if (type === 'TOP' || type === 'BOTTOM') {
      viewW = size.x;
      viewH = size.z;
    } else if (type === 'FRONT' || type === 'BACK') {
      viewW = size.x;
      viewH = size.y;
    } else if (type === 'LEFT' || type === 'RIGHT') {
      viewW = size.z;
      viewH = size.y;
    }

    const neededH = Math.max(viewW / asp, viewH) * 0.65;
    const neededW = Math.max(viewW, viewH * asp) * 0.65;
    const fitZoom = Math.min(halfH / (neededH || 0.001), halfW / (neededW || 0.001));

    orthoCam.zoom = Math.max(0.00001, fitZoom);

    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    orthoCam.updateProjectionMatrix();
  }
};
