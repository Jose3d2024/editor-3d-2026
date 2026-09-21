import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ViewportType, V3, BezierHandle, CSGObject } from '../types';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { loadOptimizedEnvironmentTexture } from '../utils/hdrLoader';
import { setupSceneEnvironment } from '../utils/environmentHelper';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { useStore } from '../store/useStore';
import { performCSG, createPrimitiveMesh } from '../utils/csg';
import { generateUVs, applyUVWMapping } from '../utils/modifiers';
import { computeSmoothNormalsByPosition } from '../utils/meshUtils';
import { createParallaxMaterial } from '../utils/ParallaxMaterial';
import { setupTriplanarMaterial } from '../utils/TriplanarMaterial';
import { createPBRMaterial, updateORMUniforms } from '../utils/materialUtils';
import { createRaymarchedCloudMaterial } from '../utils/volumetricRaymarch';
import { createGpgpuSwarmMesh, DEFAULT_GPGPU_SWARM_CONFIG } from '../utils/gpgpuSwarm';
import {
  ParticleSimulator,
  DEFAULT_PARTICLE_CONFIG,
  DEFAULT_SPACE_WARP_CONFIG,
  SpaceWarpObjectData
} from '../utils/particleSystem';
import { getUVDebugTexture } from '../utils/proceduralTextures';
import { evaluateCameraTransform } from '../utils/cameraPathHelper';
import { generateNurbsSurfaceIsoparms } from '../utils/nurbs';
import { Plus, Minus, ChevronDown, Globe, Camera, Target, Eye, X, Magnet } from 'lucide-react';
import { fileToDataURL } from '../utils/silhouettes';
import { extractUniqueEdges, extractEdgesFromBufferGeometry } from '../utils/wireframeMesh';
import { getLoopCutPreview } from '../utils/loopCut';
import { safeFixed, safeNum } from '../utils/numberUtils';
import { projectVerticesToFaces, snapPointToSurfaces, alignObjectRotationToNormal, getObjectBaseExtentAlongNormal } from '../utils/faceSnap';

interface ViewportProps {
  type: ViewportType;
  title: string;
}

// Initialize RectAreaLightUniformsLib globally
RectAreaLightUniformsLib.init();

const SNAP_ANGLES_DEG = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 360];

const snapAngleToPresets = (angleRad: number): number => {
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

const safeLookAt = (object: THREE.Object3D, target: THREE.Vector3) => {
  const isCamera = (object as THREE.Camera).isCamera;
  // Standard THREE.Camera looks down its local -Z axis when lookAt is called.
  // Standard THREE.Object3D/Group points its local +Z axis at target when lookAt is called.
  // For non-Camera visual helpers (like camGroup) whose geometry is constructed pointing down local -Z,
  // we invert the target point relative to position so that local -Z points directly at target.
  const effectiveTarget = isCamera
    ? target
    : new THREE.Vector3().subVectors(object.position.clone().multiplyScalar(2), target);

  const dir = new THREE.Vector3().subVectors(effectiveTarget, object.position);
  if (dir.lengthSq() < 0.000001) return;
  dir.normalize();

  // If direction is nearly parallel to default Y-up axis, temporarily switch UP vector to avoid Gimbal Lock singularity
  const dotY = Math.abs(dir.dot(new THREE.Vector3(0, 1, 0)));
  if (dotY > 0.999) {
    object.up.set(0, 0, dir.y > 0 ? -1 : 1);
  } else {
    object.up.set(0, 1, 0);
  }

  object.lookAt(effectiveTarget);
};

const computeGizmoLayout = (
  gizmoPos: THREE.Vector3,
  camera: THREE.Camera,
  w: number,
  h: number,
  transformSpace: string = 'world',
  selObj?: any,
  customAxisLen?: number,
  transformMode: string = 'universal'
) => {
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

  const dirs: Record<string, { nx: number; ny: number; color: string; sign: number; dot: number; worldDir: THREE.Vector3 }> = {};

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

  const rotArcs: Record<string, { pts: { x: number; y: number }[]; handlePt: { x: number; y: number }; arcColor: string; sphereColor: string }> = {};

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

// ── Shared Reusable Geometries and Materials (Ultra-low memory, zero per-frame allocation, compact micro-precision) ──
const createVertexPointTexture = (shape: 'circle' | 'cross' = 'circle'): THREE.CanvasTexture => {
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

const VERTEX_DOT_TEXTURE = typeof document !== 'undefined' ? createVertexPointTexture('circle') : null;
const VERTEX_CROSS_TEXTURE = typeof document !== 'undefined' ? createVertexPointTexture('cross') : null;

const SHARED_VERTEX_GEO = new THREE.SphereGeometry(1, 6, 5);
const SHARED_PICK_GEO = new THREE.SphereGeometry(1, 6, 4);
const SHARED_SNAP_RING_GEO = new THREE.RingGeometry(0.02, 0.032, 16);

const SHARED_WHITE_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
const SHARED_SELECTED_MAT = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
const SHARED_START_MAT = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false });
const SHARED_ACTIVE_MAT = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
const SHARED_OUT_MAT = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
const SHARED_IN_MAT = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
const SHARED_SNAP_MAT = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
const SHARED_SNAP_DOT_MAT = new THREE.MeshBasicMaterial({ color: 0x00ffcc, depthTest: false });
const SHARED_PICK_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const SHARED_CYAN_MAT = new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false });

// Screen-space 2D Points Materials with constant pixel size (virtually 0 CPU/GPU cost, never scales up on zoom)
const SHARED_POINTS_MAT = new THREE.PointsMaterial({
  size: 7.5,
  sizeAttenuation: false,
  map: VERTEX_DOT_TEXTURE ?? undefined,
  vertexColors: true,
  transparent: true,
  alphaTest: 0.05,
  depthTest: false,
});

const SHARED_SEL_POINTS_MAT = new THREE.PointsMaterial({
  size: 9.5,
  sizeAttenuation: false,
  map: VERTEX_DOT_TEXTURE ?? undefined,
  color: 0xf59e0b,
  transparent: true,
  alphaTest: 0.05,
  depthTest: false,
});

/**
 * Calcula un tamaño de escala constante en píxeles de pantalla para punteros, indicadores y halos
 * independientemente de si el usuario hace zoom extremo (acercarse o alejarse)
 */
const getAdaptiveHandleScale = (
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

export const Viewport: React.FC<ViewportProps> = ({ type: initialType, title: initialTitle }) => {
  const [type, setType] = React.useState<ViewportType | 'CAMERA'>(initialType);
  const [title, setTitle] = React.useState(initialTitle);
  const [viewCameraId, setViewCameraId] = React.useState<string | null>(null);
  const [showViewDropdown, setShowViewDropdown] = React.useState(false);

  // Sync with prop if it changes (e.g. from MultiViewport)
  useEffect(() => {
    setType(initialType);
    setTitle(initialTitle);
    setViewCameraId(null);
    setShowViewDropdown(false);
  }, [initialType, initialTitle]);

  const containerRef = useRef<HTMLDivElement>(null);
  const gizmoCanvasRef = useRef<HTMLCanvasElement>(null);
  const gizmoDisplayRef = useRef<HTMLDivElement>(null);  // numeric value overlay

  const sceneRef = useRef<THREE.Scene>(new THREE.Scene());
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const bgTextureRef = useRef<THREE.Texture | null>(null);
  const envTextureRef = useRef<THREE.Texture | null>(null);
  const groupRef = useRef<THREE.Group>(new THREE.Group());
  const primitivesGroupRef = useRef<THREE.Group>(new THREE.Group());
  const siluetaGroupRef = useRef<THREE.Group>(new THREE.Group());
  const hoverGroupRef = useRef<THREE.Group>(new THREE.Group());
  const meshesRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const particleSimulatorsRef = useRef<Map<string, ParticleSimulator>>(new Map());
  const vertexPointsRef = useRef<THREE.Points | null>(null);

  const getObjectMesh = (id: string | null | undefined): THREE.Mesh | undefined => {
    if (!id) return undefined;
    return (meshesRef.current.get(id) ||
      groupRef.current?.children.find((c: any) => c.userData?.id === id) ||
      primitivesGroupRef.current?.children.find((c: any) => c.userData?.id === id)) as THREE.Mesh | undefined;
  };

  const getAllObjectMeshes = (id: string | null | undefined): THREE.Mesh[] => {
    if (!id) return [];
    const results: THREE.Mesh[] = [];
    const main = meshesRef.current.get(id);
    if (main) {
      main.updateMatrixWorld(true);
      if ((main as THREE.Mesh).isMesh) {
        results.push(main as THREE.Mesh);
      } else {
        main.traverse((child: any) => {
          if (child.isMesh && !child.userData?.isWireOverlay && child.visible !== false) {
            results.push(child);
          }
        });
      }
    }
    // Also check primitivesGroup for proxy meshes if main didn't yield meshes
    if (results.length === 0 && primitivesGroupRef.current) {
      primitivesGroupRef.current.updateMatrixWorld(true);
      primitivesGroupRef.current.children.forEach((c: any) => {
        if (c.userData?.id === id && (c as THREE.Mesh).isMesh) {
          results.push(c as THREE.Mesh);
        }
      });
    }
    // Also check groupRef
    if (results.length === 0 && groupRef.current) {
      groupRef.current.updateMatrixWorld(true);
      groupRef.current.children.forEach((c: any) => {
        if (c.userData?.id === id) {
          if ((c as THREE.Mesh).isMesh) results.push(c as THREE.Mesh);
          else {
            c.traverse((ch: any) => {
              if (ch.isMesh && !ch.userData?.isWireOverlay && ch.visible !== false) {
                results.push(ch);
              }
            });
          }
        }
      });
    }
    return results;
  };

  const getObjectRealBox = (id: string | null | undefined): THREE.Box3 | null => {
    if (!id) return null;
    const meshes = getAllObjectMeshes(id);
    if (meshes.length === 0) return null;
    const box = new THREE.Box3();
    const tempPt = new THREE.Vector3();

    meshes.forEach(m => {
      m.updateMatrixWorld(true);
      const isSkinned = (m as any).isSkinnedMesh &&
        (m as THREE.SkinnedMesh).skeleton &&
        m.geometry?.attributes?.skinIndex &&
        m.geometry?.attributes?.skinWeight;

      if (isSkinned) {
        const sm = m as THREE.SkinnedMesh;
        if (sm.skeleton) sm.skeleton.update();
        const pos = sm.geometry.attributes.position;
        if (pos) {
          for (let i = 0; i < pos.count; i++) {
            tempPt.fromBufferAttribute(pos, i);
            try {
              if (typeof (sm as any).applyBoneTransform === 'function') {
                (sm as any).applyBoneTransform(i, tempPt);
              }
            } catch {}
            tempPt.applyMatrix4(sm.matrixWorld);
            if (isFinite(tempPt.x) && isFinite(tempPt.y) && isFinite(tempPt.z)) {
              box.expandByPoint(tempPt);
            }
          }
        }
      } else {
        const meshBox = new THREE.Box3().setFromObject(m);
        if (!meshBox.isEmpty() && isFinite(meshBox.min.x) && isFinite(meshBox.max.x)) {
          box.union(meshBox);
        }
      }
    });
    return box.isEmpty() ? null : box;
  };

  (window as any).__getObjectMesh = getObjectMesh;
  (window as any).__getAllObjectMeshes = getAllObjectMeshes;
  (window as any).__getObjectRealBox = getObjectRealBox;
  (window as any).__viewportCamera = () => cameraRef.current;

  const getCoincidentVertices = (geometry: THREE.BufferGeometry, index: number): number[] => {
    const pos = geometry.getAttribute('position');
    if (!pos || index >= pos.count) return [index];
    const x = pos.getX(index), y = pos.getY(index), z = pos.getZ(index);
    const out: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - x) < 0.0001 && Math.abs(pos.getY(i) - y) < 0.0001 && Math.abs(pos.getZ(i) - z) < 0.0001) {
        out.push(i);
      }
    }
    return out.length > 0 ? out : [index];
  };
  
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const selectedVertexIndexRef = useRef<number | null>(null);
  const selectedVertexIndicesRef = useRef<number[]>([]);
  const isDraggingRef = useRef(false);

  const drawingPointsRef = useRef<THREE.Vector3[]>([]);
  const drawingHandlesRef = useRef<BezierHandle[]>([]);
  const drawingObjectIdRef = useRef<string | null>(null);
  const drawingMeshRef = useRef<THREE.Object3D | null>(null);
  const drawingPreviewPointRef = useRef<THREE.Vector3 | null>(null);
  const isDrawingHandleRef = useRef(false);
  const finishStrokeRef = useRef<((snapResult: any) => void) | null>(null);
  const updatePreviewRef = useRef<(() => void) | null>(null);

  const gizmoStateRef = useRef<{
    hoveredAxis: string | null;
    activeAxis: string | null;
    startMouseWorld: THREE.Vector3;
    startPos: [number,number,number];
    startRot: [number,number,number];
    startScale: [number,number,number];
    startScreenPos: {x:number, y:number};
    startVertexOffsets: Record<number, [number,number,number]>;
    dragHandleType?: 'anchor' | 'bezierOut' | 'bezierIn';
    dragAnchorIdx?: number;
    startTransforms: Record<string, { position: [number,number,number], rotation: [number,number,number], scale: [number,number,number] }>;
    startWorldGizmoPos?: THREE.Vector3;
  }>({
    hoveredAxis: null,
    activeAxis: null,
    startMouseWorld: new THREE.Vector3(),
    startPos: [0,0,0],
    startRot: [0,0,0],
    startScale: [1,1,1],
    startScreenPos: {x:0,y:0},
    startVertexOffsets: {},
    startTransforms: {},
  });

  const initialTransformRef = useRef<{
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
    basePositions: { [index: number]: THREE.Vector3 };
    initialOffsets: { [index: number]: [number, number, number] };
    meshMatrix: THREE.Matrix4;
  } | null>(null);

  const { 
    project, currentTime, viewMode, setViewMode, selectedObjectId, selectedObjectIds, selectObject,
    selectedLightId, selectLight, selectedCameraId, selectCamera,
    toggleObjectSelection, editMode, transformMode, setTransformMode, transformSpace,
    drawMode, setDrawMode, addShape, updateBezierHandle,
    updateVertexOffset, updateVertexOffsets, updateObject, updateObjects,
    activeViewport, setActiveViewport, selectedVertexIndices, setSelectedVertexIndices,
    addSelectedVertexIndices, selectedFaceIndices, setSelectedFaceIndices,
    selectedEdgeIndices, setSelectedEdgeIndices, selectedGLTFMeshes, setSelectedGLTFMeshes,
    isolateGLTFSelection, clearSelection,
    maximizedViewport, setMaximizedViewport, saveHistory,
    gridSnapEnabled, setGridSnapEnabled, isRecording,
    faceSnapConfig, setFaceSnapConfig, toggleFaceSnap,
    setSilueta, moveReferenceMode, setReference,
    addMaterial, assignMaterialToObjects,
    insertVertexMode, setInsertVertexMode,
    loopCutMode, setLoopCutMode,
    loopCutCuts, setLoopCutCuts,
    loopCutSlide, setLoopCutSlide,
    applyLoopCut, extrudeManifold,
    orthoDrawMode, setOrthoDrawMode,
    drawLockAxis, setDrawLockAxis
  } = useStore();
  const silueta = project?.silueta || ({} as any);

  // Silueta interaction refs
  const siluetaDragRef = useRef<{ planeKey: 'front'|'back'|'left'|'right'|'top'|'bottom'; pointIndex: number } | null>(null);
  const refDragRef = useRef<{ viewKey: 'top'|'bottom'|'front'|'back'|'left'|'right'; startPos: [number,number,number]; startMouse: THREE.Vector3 } | null>(null);
  const siluetaRef = useRef(silueta);
  const marqueeRef = useRef<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  // Pending marquee: records mousedown position but doesn't start selection until drag > 5px
  const pendingMarqueeRef = useRef<{ x: number; y: number } | null>(null);

  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { siluetaRef.current = silueta; }, [silueta]);

  const textureCacheRef = useRef<Map<string, THREE.Texture>>(new Map());

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getPoint = (e: PointerEvent | MouseEvent, skipSnap = false) => {
    if (!rendererRef.current || !cameraRef.current) return null;
    const canvas = rendererRef.current.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);
    
    const drawPlaneNormal =
      (type === 'FRONT' || type === 'BACK') ? new THREE.Vector3(0, 0, 1) :
      (type === 'LEFT' || type === 'RIGHT') ? new THREE.Vector3(1, 0, 0) :
                                              new THREE.Vector3(0, 1, 0);
    const plane = new THREE.Plane(drawPlaneNormal, 0);
    const target = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, target)) return null;
    
    if (skipSnap) return target;

    const p = target.clone();
    if (gridSnapEnabled) {
      const gs = 0.1;
      if (type === 'FRONT' || type === 'BACK') {
        p.x = Math.round(p.x / gs) * gs;
        p.y = Math.round(p.y / gs) * gs;
      } else if (type === 'LEFT' || type === 'RIGHT') {
        p.z = Math.round(p.z / gs) * gs;
        p.y = Math.round(p.y / gs) * gs;
      } else {
        p.x = Math.round(p.x / gs) * gs;
        p.z = Math.round(p.z / gs) * gs;
      }
    }

    const { orthoDrawMode, drawLockAxis } = useStore.getState();
    const isOrtho = !!(e.shiftKey || orthoDrawMode || drawLockAxis === 'ORTHO_90');

    if (drawingPointsRef.current.length > 0) {
      const last = drawingPointsRef.current[drawingPointsRef.current.length - 1];

      if (drawLockAxis === 'X') {
        if (type === 'FRONT' || type === 'BACK') {
          p.y = last.y;
        } else if (type === 'LEFT' || type === 'RIGHT') {
          p.z = last.z;
        } else {
          p.z = last.z;
        }
        (drawingPreviewPointRef as any)._guideAxis = 'X';
      } else if (drawLockAxis === 'Y') {
        if (type === 'FRONT' || type === 'BACK') {
          p.x = last.x;
        } else if (type === 'LEFT' || type === 'RIGHT') {
          p.z = last.z;
        } else {
          // In Top/Bottom Y is plane normal, lock to X
          p.z = last.z;
        }
        (drawingPreviewPointRef as any)._guideAxis = 'Y';
      } else if (drawLockAxis === 'Z') {
        if (type === 'LEFT' || type === 'RIGHT') {
          p.y = last.y;
        } else {
          p.x = last.x;
        }
        (drawingPreviewPointRef as any)._guideAxis = 'Z';
      } else if (isOrtho) {
        // Escuadra (90° Snap relativo al punto previo)
        const dx = Math.abs(p.x - last.x);
        const dy = Math.abs(p.y - last.y);
        const dz = Math.abs(p.z - last.z);

        if (type === 'FRONT' || type === 'BACK') {
          if (dx > dy) {
            p.y = last.y;
            (drawingPreviewPointRef as any)._guideAxis = 'X';
          } else {
            p.x = last.x;
            (drawingPreviewPointRef as any)._guideAxis = 'Y';
          }
        } else if (type === 'LEFT' || type === 'RIGHT') {
          if (dz > dy) {
            p.y = last.y;
            (drawingPreviewPointRef as any)._guideAxis = 'Z';
          } else {
            p.z = last.z;
            (drawingPreviewPointRef as any)._guideAxis = 'Y';
          }
        } else {
          // TOP / BOTTOM / PERSPECTIVE
          if (dx > dz) {
            p.z = last.z;
            (drawingPreviewPointRef as any)._guideAxis = 'X';
          } else {
            p.x = last.x;
            (drawingPreviewPointRef as any)._guideAxis = 'Z';
          }
        }
      } else {
        (drawingPreviewPointRef as any)._guideAxis = null;
      }
    } else {
      (drawingPreviewPointRef as any)._guideAxis = null;
    }
    return p;
  };

  const getInterpolatedTransform = (obj: any, time: number) => {
    const kfs = obj.keyframes;
    if (!kfs || kfs.length === 0) return obj.transform;
    const sorted = [...kfs].sort((a, b) => a.time - b.time);
    if (time <= sorted[0].time) return sorted[0].transform;
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
    let prev = sorted[0], next = sorted[0];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time <= sorted[i+1].time) {
        prev = sorted[i]; next = sorted[i+1]; break;
      }
    }
    const t = (time - prev.time) / (next.time - prev.time);
    const lerp = (a: number, b: number) => a + (b - a) * t;
    return {
      position: [lerp(prev.transform.position[0], next.transform.position[0]),
                 lerp(prev.transform.position[1], next.transform.position[1]),
                 lerp(prev.transform.position[2], next.transform.position[2])] as [number, number, number],
      rotation: [lerp(prev.transform.rotation[0], next.transform.rotation[0]),
                 lerp(prev.transform.rotation[1], next.transform.rotation[1]),
                 lerp(prev.transform.rotation[2], next.transform.rotation[2])] as [number, number, number],
      scale:    [lerp(prev.transform.scale[0], next.transform.scale[0]),
                 lerp(prev.transform.scale[1], next.transform.scale[1]),
                 lerp(prev.transform.scale[2], next.transform.scale[2])] as [number, number, number],
    };
  };

  const scaleSelection = (factor: number) => {
    if (!selectedObjectId || selectedVertexIndices.length === 0) return;
    const mesh = getObjectMesh(selectedObjectId);
    const selectedObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
    if (!mesh || !selectedObj) return;
    const positions = mesh.geometry.getAttribute('position');
    const centroid = new THREE.Vector3();
    selectedVertexIndices.forEach(idx => {
      centroid.add(new THREE.Vector3(positions.getX(idx), positions.getY(idx), positions.getZ(idx)));
    });
    centroid.divideScalar(selectedVertexIndices.length);
    const updates = selectedVertexIndices.map(idx => {
      const currentPos = new THREE.Vector3(positions.getX(idx), positions.getY(idx), positions.getZ(idx));
      const currentOffset = selectedObj.vertexOffsets?.[idx] || [0, 0, 0];
      const toVertex = currentPos.clone().sub(centroid);
      const scaledToVertex = toVertex.multiplyScalar(factor);
      const newPos = centroid.clone().add(scaledToVertex);
      const delta = newPos.sub(currentPos);
      return { index: idx, offset: [currentOffset[0]+delta.x, currentOffset[1]+delta.y, currentOffset[2]+delta.z] as [number,number,number] };
    });
    updateVertexOffsets(selectedObjectId, updates);
    saveHistory();
  };

  const handleRecenter = () => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam) return;

    // Filter target objects: selected objects if available, otherwise all visible objects
    const selIds = selectedObjectIds.length > 0 ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
    const targets = selIds.length > 0
      ? projectRef.current.objects.filter(o => selIds.includes(o.id) && o.visible)
      : projectRef.current.objects.filter(o => o.visible);
    
    const activeObjects = targets.length > 0 ? targets : projectRef.current.objects.filter(o => o.visible);
    if (activeObjects.length === 0) return;

    const box = new THREE.Box3();
    let expanded = false;

    // 1. Primary method: calculate exact world-space bounding box using actual rendered Object3Ds in meshesRef
    activeObjects.forEach(obj => {
      let object3D = meshesRef.current.get(obj.id);
      if (!object3D && primitivesGroupRef.current) {
        object3D = primitivesGroupRef.current.children.find(c => c.userData.id === obj.id);
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

    // 2. Fallback: calculate bounding box from procedural vertices
    if (!expanded) {
      activeObjects.forEach(obj => {
        const _interp = getInterpolatedTransform(obj, currentTime);
        const mat4 = new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(_interp.position),
          new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
          new THREE.Vector3().fromArray(_interp.scale),
        );
        obj.vertices?.forEach((v, i) => {
          const off = obj.vertexOffsets?.[i] ?? [0,0,0];
          const worldPt = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
          box.expandByPoint(worldPt);
          expanded = true;
        });
      });
    }

    if (box.isEmpty() || !expanded) { box.set(new THREE.Vector3(-1,-1,-1), new THREE.Vector3(1,1,1)); }

    const center = new THREE.Vector3();
    const size   = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.5);

    if (type === 'PERSPECTIVE') {
      const persCam = cam as THREE.PerspectiveCamera;
      const fov    = persCam.fov * (Math.PI / 180);
      const dist   = Math.max((maxDim * 0.5 / Math.tan(fov * 0.5)) * 1.5, 1.0);

      if (persCam.far < dist * 10) {
        persCam.far = Math.max(persCam.far, dist * 10);
        persCam.updateProjectionMatrix();
      }

      if (controls) {
        // Safe direction vector from center to current camera position
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
      orthoCam.far  = distOffset * 2;
      orthoCam.lookAt(center);

      // Adjust orthographic zoom to fit bounding box
      const renderer = rendererRef.current;
      const w = renderer?.domElement.clientWidth  || 1;
      const h = renderer?.domElement.clientHeight || 1;
      const asp = w / h;
      const halfH = 5;
      const halfW = halfH * asp;

      let viewW = 1, viewH = 1;
      if (type === 'TOP' || type === 'BOTTOM') {
        viewW = size.x; viewH = size.z;
      } else if (type === 'FRONT' || type === 'BACK') {
        viewW = size.x; viewH = size.y;
      } else if (type === 'LEFT' || type === 'RIGHT') {
        viewW = size.z; viewH = size.y;
      }

      const neededH = Math.max(viewW / asp, viewH) * 0.65;
      const neededW = Math.max(viewW, viewH * asp) * 0.65;
      const fitZoom  = Math.min(halfH / (neededH || 0.001), halfW / (neededW || 0.001));

      orthoCam.zoom = Math.max(0.00001, fitZoom);

      if (controls) {
        controls.target.copy(center);
        controls.update();
      }
      orthoCam.updateProjectionMatrix();
    }
  };

  const handleResetView = () => {
    const cam = cameraRef.current;
    const controls = controlsRef.current;
    if (!cam || !controls) return;

    if (type === 'PERSPECTIVE') {
      cam.position.set(10, 10, 10);
      controls.target.set(0, 0, 0);
      cam.up.set(0, 1, 0);
    } else {
      controls.target.set(0, 0, 0);
      switch(type) {
        case 'TOP':    cam.position.set(0, 20, 0); break;
        case 'BOTTOM': cam.position.set(0, -20, 0); break;
        case 'FRONT':  cam.position.set(0, 0, 20); break;
        case 'BACK':   cam.position.set(0, 0, -20); break;
        case 'LEFT':   cam.position.set(-20, 0, 0); break;
        case 'RIGHT':  cam.position.set(20, 0, 0); break;
      }
    }
    controls.update();
  };

  const handleToggleHdriBg = () => {
    const env = project.environment;
    const isCurrentlyHdri = (env.backgroundMode === 'HDRI' && env.backgroundVisible !== false);
    useStore.getState().updateEnvironment({
      backgroundMode: isCurrentlyHdri ? 'GRADIENT' : 'HDRI',
      backgroundVisible: !isCurrentlyHdri,
    });
    useStore.getState().saveHistory();
  };

  const handleAlignToAxes = () => {
    const ids = selectedObjectIds.length > 0 ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
    if (ids.length === 0) return;
    
    // Snap rotation to nearest 90 degrees (Math.PI / 2)
    const snap = (val: number) => Math.round(val / (Math.PI / 2)) * (Math.PI / 2);
    
    ids.forEach(id => {
      const obj = project.objects.find(o => o.id === id);
      if (obj) {
        useStore.getState().updateObject(id, {
          transform: {
            ...obj.transform,
            rotation: [
              snap(obj.transform.rotation[0]),
              snap(obj.transform.rotation[1]),
              snap(obj.transform.rotation[2])
            ]
          }
        });
      }
    });
    useStore.getState().saveHistory();
  };

  const handleAlignToFloor = () => {
    const ids = selectedObjectIds.length > 0 ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
    if (ids.length === 0) return;

    ids.forEach(id => {
      const obj = project.objects.find(o => o.id === id);
      if (!obj) return;

      let posOffset = 0;
      // Attempt exact bounding box calculation from rendered mesh
      const mesh = getObjectMesh(id);
      if (mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        if (isFinite(box.min.y)) {
          posOffset = 0 - box.min.y;
        }
      } else if (obj.vertices && obj.vertices.length > 0) {
        const euler = new THREE.Euler(obj.transform.rotation[0], obj.transform.rotation[1], obj.transform.rotation[2]);
        const scale = new THREE.Vector3(...obj.transform.scale);
        let min = Infinity;
        obj.vertices.forEach((v, idx) => {
          const off = obj.vertexOffsets?.[idx] ?? [0,0,0];
          const p = new THREE.Vector3((v[0]+off[0])*scale.x, (v[1]+off[1])*scale.y, (v[2]+off[2])*scale.z).applyEuler(euler);
          if (p.y < min) min = p.y;
        });
        if (isFinite(min)) {
          posOffset = 0 - (obj.transform.position[1] + min);
        }
      }

      useStore.getState().updateObject(id, {
        transform: {
          ...obj.transform,
          position: [
            obj.transform.position[0],
            obj.transform.position[1] + posOffset,
            obj.transform.position[2]
          ]
        }
      });
    });
    useStore.getState().saveHistory();
  };

  const handleRecenterPivot = () => {
    useStore.getState().recenterPivotObject();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !rendererRef.current || !cameraRef.current || !sceneRef.current) return;

    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);

    // Raycast against the scene
    const intersects = raycaster.intersectObjects(sceneRef.current.children, true);
    
    // Find the first object with an ID in userData
    const hit = intersects.find(i => i.object.userData.id);
    const targetId = hit ? hit.object.userData.id : selectedObjectId;

    if (!targetId) return;

    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const data = JSON.parse(jsonData);
        if (data.materialId) {
          // Assign existing material from manager
          assignMaterialToObjects([targetId], data.materialId);
          saveHistory();
          return;
        } else if (data.name) {
          // Import and assign new material (from example materials)
          const newId = Math.random().toString(36).substr(2, 9);
          addMaterial({ ...data, id: newId });
          assignMaterialToObjects([targetId], newId);
          saveHistory();
          return;
        }
      } catch (err) {
        console.error('Error parsing drop data:', err);
      }
    }

    const textureUrl = e.dataTransfer.getData('application/x-texture-url');
    const textureType = e.dataTransfer.getData('application/x-texture-type') || 'map';

    if (textureUrl) {
      // Apply existing texture
      const obj = project.objects.find(o => o.id === targetId);
      if (obj) {
        const m = obj.material || {};
        updateObject(targetId, { material: { ...m, [textureType]: textureUrl } });
        setViewMode('TEXTURED');
        saveHistory();
      }
    } else if (e.dataTransfer.files.length > 0) {
      // Handle file drop
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        const url = await fileToDataURL(file);
        const obj = project.objects.find(o => o.id === targetId);
        if (obj) {
          const m = obj.material || {};
          updateObject(targetId, { material: { ...m, map: url } });
          setViewMode('TEXTURED');
          saveHistory();
        }
      }
    }
  };

  const handleZoomIn = () => {
    const cam = cameraRef.current;
    if (!cam) return;
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = Math.min(cam.zoom * 1.25, 20);
      cam.updateProjectionMatrix();
    } else if (controlsRef.current) {
      const dist = cam.position.distanceTo(controlsRef.current.target);
      const dir  = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).normalize();
      cam.position.copy(controlsRef.current.target).add(dir.multiplyScalar(dist * 0.75));
      controlsRef.current.update();
    }
  };

  const handleZoomOut = () => {
    const cam = cameraRef.current;
    if (!cam) return;
    if (cam instanceof THREE.OrthographicCamera) {
      cam.zoom = Math.max(cam.zoom / 1.25, 0.05);
      cam.updateProjectionMatrix();
    } else if (controlsRef.current) {
      const dist = cam.position.distanceTo(controlsRef.current.target);
      const dir  = new THREE.Vector3().subVectors(cam.position, controlsRef.current.target).normalize();
      cam.position.copy(controlsRef.current.target).add(dir.multiplyScalar(dist * 1.33));
      controlsRef.current.update();
    }
  };

  useEffect(() => {
    if (!sceneRef.current) return;
    const grid = sceneRef.current.getObjectByName('scene-grid');
    if (grid) grid.visible = project.showGrid !== false;
  }, [project.showGrid]);

  useEffect(() => {
    meshesRef.current.forEach((meshOrGroup) => {
      meshOrGroup.traverse((child) => {
        if (child.userData.isSkeletonHelper) {
          child.visible = !!project.showSkeleton;
        }
      });
    });
  }, [project.showSkeleton]);

  // ── 1. Initialization ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth || 300;
    const height = containerRef.current.clientHeight || 300;

    const scene = sceneRef.current;
    scene.background = new THREE.Color(0x1a1a1a);
    scene.clear();
    scene.add(groupRef.current);
    scene.add(primitivesGroupRef.current);
    scene.add(siluetaGroupRef.current);
    scene.add(hoverGroupRef.current);

    // Luz de Edición por Defecto (Visor en tiempo real):
    // Luz ambiental suave para trabajar en el visor
    const editorAmbient = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(editorAmbient);

    const grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    grid.name = 'scene-grid';
    if (type==='FRONT' || type==='BACK') grid.rotation.x = Math.PI/2;
    if (type==='LEFT' || type==='RIGHT') grid.rotation.z = Math.PI/2;
    scene.add(grid);
    grid.visible = projectRef.current.showGrid !== false;

    let camera: THREE.Camera;
    let initialCamTarget: THREE.Vector3 | null = null;
    if (type === 'CAMERA' && viewCameraId) {
      const camData = projectRef.current.cameras?.find(c => c.id === viewCameraId);
      if (camData) {
        if (camData.type === 'PERSPECTIVE') {
          camera = new THREE.PerspectiveCamera(camData.fov, width/height, camData.near, camData.far);
          (camera as THREE.PerspectiveCamera).filmGauge = camData.filmGauge || 35;
        } else {
          const asp = width/height, size = camData.fov || 10;
          camera = new THREE.OrthographicCamera(-size*asp/2, size*asp/2, size/2, -size/2, camData.near, camData.far);
        }
        camera.position.fromArray(camData.transform.position);
        camera.rotation.fromArray(camData.transform.rotation);
        camera.scale.fromArray(camData.transform.scale);

        const dir = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
        initialCamTarget = new THREE.Vector3().copy(camera.position).addScaledVector(dir, 5);
      } else {
        camera = new THREE.PerspectiveCamera(50, width/height, 0.1, 1000);
        camera.position.set(5,5,5);
      }
    } else if (type === 'PERSPECTIVE') {
      camera = new THREE.PerspectiveCamera(50, width/height, 0.1, 1000);
      camera.position.set(5,5,5);
    } else {
      const asp = width/height, size = 10;
      camera = new THREE.OrthographicCamera(-size*asp/2, size*asp/2, size/2, -size/2, 0.1, 1000);
      if (type==='TOP')    { camera.position.set(0,10,0);  (camera as any).up.set(0,0,-1); camera.lookAt(0,0,0); }
      if (type==='BOTTOM') { camera.position.set(0,-10,0); (camera as any).up.set(0,0,1);  camera.lookAt(0,0,0); }
      if (type==='FRONT')  { camera.position.set(0,0,10);  camera.lookAt(0,0,0); }
      if (type==='BACK')   { camera.position.set(0,0,-10); camera.lookAt(0,0,0); }
      if (type==='LEFT')   { camera.position.set(-10,0,0); camera.lookAt(0,0,0); }
      if (type==='RIGHT')  { camera.position.set(10,0,0);  camera.lookAt(0,0,0); }
    }
    cameraRef.current = camera;
    if (type === 'CAMERA') {
      camera.layers.set(0);
    } else {
      camera.layers.enable(0);
      camera.layers.enable(1);
    }

    // Luz Direccional vinculada a la cámara (Headlight de edición que se mueve con la cámara)
    const editorHeadlight = new THREE.DirectionalLight(0xffffff, 0.65);
    editorHeadlight.position.set(0.5, 1.5, 2);
    camera.add(editorHeadlight);
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance', preserveDrawingBuffer:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x1a1a1a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    if (containerRef.current) {
      while (containerRef.current.firstChild) containerRef.current.removeChild(containerRef.current.firstChild);
      containerRef.current.appendChild(renderer.domElement);
      renderer.domElement.id = 'main-viewport-canvas';
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    }
    rendererRef.current = renderer;

    scene.background = new THREE.Color(0x1a1a1a);

    // ALL viewports get OrbitControls — perspective, orthographic, and camera views get full rotate+pan+zoom
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.1;
    controls.enableRotate   = true;
    controls.mouseButtons   = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.screenSpacePanning = true;
    if (initialCamTarget) {
      controls.target.copy(initialCamTarget);
      controls.update();
    }
    
    controlsRef.current = controls;

    // Restore camera state if exists
    if (type !== 'CAMERA') {
      const savedCam = useStore.getState().viewportCameras[type];
      if (savedCam) {
        camera.position.fromArray(savedCam.position);
        controls.target.fromArray(savedCam.target);
        if ((camera as any).isOrthographicCamera || (camera as any).isPerspectiveCamera) {
          if ((camera as any).isOrthographicCamera) (camera as any).zoom = savedCam.zoom;
          (camera as any).updateProjectionMatrix();
        }
        controls.update();
      }
    }

    // Update last camera state for rendering and persistence
    const updateCamState = () => {
      const state = useStore.getState();
      const pos = camera.position.toArray() as V3;
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'XYZ');
      const rot: V3 = [euler.x, euler.y, euler.z];
      
      if (type === 'CAMERA' && viewCameraId) {
        const camData = state.project.cameras?.find(c => c.id === viewCameraId);
        if (camData) {
          const updates: any = {
            transform: {
              ...camData.transform,
              position: pos,
              ...(camData.targetObjectId ? {} : { rotation: rot })
            }
          };
          state.updateCamera(viewCameraId, updates);
        }
        return;
      }
      
      const target = controls.target.toArray() as V3;
      const zoom = (camera as any).zoom || 1;
      const pFov = (camera as THREE.PerspectiveCamera).fov || 45;
      const cameraState = { position: pos, target, zoom, fov: pFov };

      if (state.activeViewport === type || state.maximizedViewport === type || type === 'PERSPECTIVE') {
        state.setLastCameraState(cameraState);
      }
      state.setViewportCamera(type, cameraState);
    };

    // Emit initial camera state
    updateCamState();

    controls.addEventListener('change', updateCamState);

    renderer.render(scene, camera);
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
        rendererRef.current.domElement.remove();
        rendererRef.current = null;
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }
    };
  }, [type, viewCameraId]);

  // ── 1.4 Lights Rendering ────────────────────────────────────────────────
  const lightsRef = useRef<Map<string, THREE.Object3D>>(new Map());
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Cleanup old lights
    lightsRef.current.forEach(l => scene.remove(l));
    lightsRef.current.clear();

    project.lights.forEach(lData => {
      if (!lData.visible) return;

      let light: THREE.Light;
      switch (lData.type) {
        case 'POINT':
          light = new THREE.PointLight(lData.color, lData.intensity, lData.distance ?? 0, lData.decay ?? 2);
          break;
        case 'DIRECTIONAL':
          light = new THREE.DirectionalLight(lData.color, lData.intensity);
          break;
        case 'SPOT':
          light = new THREE.SpotLight(
            lData.color,
            lData.intensity,
            lData.distance ?? 0,
            lData.angle ?? Math.PI / 3,
            lData.penumbra ?? 0.25,
            lData.decay ?? 2
          );
          break;
        case 'RECTAREA':
          light = new THREE.RectAreaLight(lData.color, lData.intensity, lData.width ?? 5, lData.height ?? 5);
          break;
        case 'AMBIENT':
          if (lData.groundColor) {
            light = new THREE.HemisphereLight(lData.color, lData.groundColor, lData.intensity);
          } else {
            light = new THREE.AmbientLight(lData.color, lData.intensity);
          }
          break;
        default:
          return;
      }

      light.position.fromArray(lData.transform.position);
      light.rotation.fromArray(lData.transform.rotation);
      
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
        const target = new THREE.Object3D();
        target.position.set(0, 0, -1);
        light.add(target);
        light.target = target;
      }
      
      light.castShadow = !!lData.castShadow;
      const l = light as any;
      if (l.shadow) {
        l.shadow.bias = lData.shadowBias ?? -0.0001;
        l.shadow.normalBias = lData.shadowNormalBias ?? 0.05;
        l.shadow.radius = lData.shadowRadius ?? 1.5;
        const mapSize = lData.shadowMapSize ?? 2048;
        l.shadow.mapSize.set(mapSize, mapSize);
        if (l instanceof THREE.DirectionalLight) {
          const camSize = lData.shadowCameraSize ?? 20;
          l.shadow.camera.left = -camSize;
          l.shadow.camera.right = camSize;
          l.shadow.camera.top = camSize;
          l.shadow.camera.bottom = -camSize;
          l.shadow.camera.near = 0.1;
          l.shadow.camera.far = 100;
          l.shadow.camera.updateProjectionMatrix();
        } else if (l instanceof THREE.SpotLight) {
          l.shadow.camera.near = 0.1;
          l.shadow.camera.far = Math.max(50, (lData.distance || 50));
          l.shadow.camera.updateProjectionMatrix();
        } else if (l instanceof THREE.PointLight) {
          l.shadow.camera.near = 0.1;
          l.shadow.camera.far = Math.max(50, (lData.distance || 50));
          l.shadow.camera.updateProjectionMatrix();
        }
      }
      scene.add(light);
      lightsRef.current.set(lData.id, light);

      // Add a small selectable gizmo for the light
      const gizmoGeo = new THREE.SphereGeometry(0.2, 8, 8);
      const gizmoMat = new THREE.MeshBasicMaterial({ color: lData.color, wireframe: true, transparent: true, opacity: 0.5 });
      const gizmo = new THREE.Mesh(gizmoGeo, gizmoMat);
      gizmo.position.copy(light.position);
      gizmo.rotation.copy(light.rotation);
      gizmo.userData = { id: lData.id, isLight: true };
      scene.add(gizmo);
      lightsRef.current.set(`${lData.id}-gizmo`, gizmo);

      // Add helper if selected
      if (selectedLightId === lData.id) {
        let helper: THREE.Object3D | null = null;
        if (light instanceof THREE.PointLight) helper = new THREE.PointLightHelper(light, 0.5);
        if (light instanceof THREE.DirectionalLight) helper = new THREE.DirectionalLightHelper(light, 1);
        if (light instanceof THREE.SpotLight) helper = new THREE.SpotLightHelper(light);
        if (light instanceof THREE.RectAreaLight) helper = new RectAreaLightHelper(light);
        
        if (helper) {
          helper.userData = { id: lData.id, isLight: true };
          scene.add(helper);
          lightsRef.current.set(`${lData.id}-helper`, helper);
        }
      }
    });

    return () => {
      lightsRef.current.forEach(l => scene.remove(l));
    };
  }, [project.lights, selectedLightId]);

  // ── 1.1b Cámaras ─────────────────────────────────────────────────────────
  const camerasRef = useRef<Map<string, THREE.Object3D>>(new Map());
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Cleanup old cameras
    camerasRef.current.forEach(c => scene.remove(c));
    camerasRef.current.clear();

    (project.cameras || []).forEach(cData => {
      const { selectedCameraId } = useStore.getState();
      const isSelected = selectedCameraId === cData.id;

      // Create visual group for the camera
      const camGroup = new THREE.Group();
      
      // Lightweight Camera Body (Cuerpo liviano de la cámara)
      const bodyGeom = new THREE.BoxGeometry(0.36, 0.24, 0.35);
      const bodyMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x4f46e5 : 0x27272a });
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.z = 0.175; // Extends back from z=0 to z=+0.35
      body.userData = { id: cData.id, isCamera: true };
      camGroup.add(body);

      // Body Wireframe Outline (Contorno limpio)
      const bodyWireMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0xc7d2fe : 0x71717a, wireframe: true });
      const bodyWire = new THREE.Mesh(bodyGeom, bodyWireMat);
      bodyWire.position.z = 0.175;
      camGroup.add(bodyWire);

      // Single Simple Lens (Objetivo cilíndrico liviano apuntando a -Z)
      const lensGeom = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 32);
      const lensMat = new THREE.MeshBasicMaterial({ color: isSelected ? 0x6366f1 : 0x3f3f46 });
      const lens = new THREE.Mesh(lensGeom, lensMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -0.1;
      lens.userData = { id: cData.id, isCamera: true };
      camGroup.add(lens);

      // Glass Lens Element
      const glassGeom = new THREE.CircleGeometry(0.1, 32);
      const glassMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
      const glass = new THREE.Mesh(glassGeom, glassMat);
      glass.position.z = -0.201;
      glass.userData = { id: cData.id, isCamera: true };
      camGroup.add(glass);

      // FOV Frustum Wireframe Pyramid (Vista de pirámide limpia)
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

      // Target Tracking Ray & Crosshair Reticle Group
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

      // 2D Canvas Badge Tag (Floating 3D label above camera with icon and camera name)
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
        ctx.fillText(cData.name.length > 15 ? cData.name.substring(0, 15) + '…' : cData.name, 60, 42);
      }
      const badgeTex = new THREE.CanvasTexture(canvas);
      badgeTex.minFilter = THREE.LinearFilter;
      const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, depthTest: false, transparent: true });
      const badgeSprite = new THREE.Sprite(badgeMat);
      badgeSprite.renderOrder = 999;
      badgeSprite.scale.set(2.0, 0.52, 1);
      badgeSprite.position.set(0, 0.65, 0.1);
      camGroup.add(badgeSprite);

      const evalCam = evaluateCameraTransform(cData, project.objects, currentTime, project.duration || 5);
      camGroup.position.copy(evalCam.position);
      if (evalCam.target) {
        safeLookAt(camGroup, evalCam.target);
        targetGroup.visible = true;
        const dist = evalCam.position.distanceTo(evalCam.target);
        targetLine.geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, -0.20),
          new THREE.Vector3(0, 0, -dist)
        ]);
        (targetLine as any).computeLineDistances();
        reticleGroup.position.set(0, 0, -dist);
      } else {
        camGroup.rotation.fromArray(cData.transform.rotation);
        targetGroup.visible = false;
      }
      camGroup.scale.fromArray(cData.transform.scale);
      
      camGroup.userData = { id: cData.id, isCamera: true };
      camGroup.visible = type !== 'CAMERA';
      camGroup.traverse((child) => child.layers.set(1));
      scene.add(camGroup);
      camerasRef.current.set(cData.id, camGroup);

      // Sync viewport camera if this is the active camera view
      if (type === 'CAMERA' && viewCameraId === cData.id && cameraRef.current) {
        const cam = cameraRef.current;
        cam.position.copy(evalCam.position);
        if (evalCam.target) {
          safeLookAt(cam, evalCam.target);
          if (controlsRef.current) {
            controlsRef.current.target.copy(evalCam.target);
          }
        } else {
          cam.rotation.fromArray(cData.transform.rotation);
        }
        cam.scale.fromArray(cData.transform.scale);
        if (cData.type === 'PERSPECTIVE' && (cam as any).isPerspectiveCamera) {
          const pCam = cam as THREE.PerspectiveCamera;
          pCam.fov = cData.fov;
          pCam.filmGauge = cData.filmGauge || 35;
          pCam.near = cData.near;
          pCam.far = cData.far;
          pCam.updateProjectionMatrix();
        } else if (cData.type === 'ORTHOGRAPHIC' && (cam as any).isOrthographicCamera) {
          const oCam = cam as THREE.OrthographicCamera;
          const size = cData.fov || 10;
          const asp = oCam.right / oCam.top; // Keep current aspect ratio
          oCam.left = -size * asp / 2;
          oCam.right = size * asp / 2;
          oCam.top = size / 2;
          oCam.bottom = -size / 2;
          oCam.near = cData.near;
          oCam.far = cData.far;
          oCam.updateProjectionMatrix();
        }
      }
    });

    return () => {
      camerasRef.current.forEach(c => scene.remove(c));
    };
  }, [project.cameras, selectedCameraId, type, viewCameraId]);

  // ── 1.2 Resize Observer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
        const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight;
        if (!w || !h) return;
        rendererRef.current.setSize(w, h, false);
        if (cameraRef.current instanceof THREE.PerspectiveCamera) {
          cameraRef.current.aspect = w/h; cameraRef.current.updateProjectionMatrix();
        } else if (cameraRef.current instanceof THREE.OrthographicCamera) {
          const asp = w/h;
          let size = 10;
          if (type === 'CAMERA' && viewCameraId) {
            const camData = useStore.getState().project.cameras?.find(c => c.id === viewCameraId);
            if (camData && camData.type === 'ORTHOGRAPHIC') size = camData.fov || 10;
          }
          cameraRef.current.left=-size*asp/2; cameraRef.current.right=size*asp/2;
          cameraRef.current.top=size/2; cameraRef.current.bottom=-size/2;
          cameraRef.current.updateProjectionMatrix();
        }
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [type]);

  // ── 1.5 Animation Loop ───────────────────────────────────────────────────
  useEffect(() => {
    let id: number;
    const clock = new THREE.Clock();
    const animate = () => {
      id = requestAnimationFrame(animate);
      try {
        // LEER SIEMPRE LAS INSTANCIAS ACTUALES DESDE LAS REFERENCIAS MUTABLES
        const currentRenderer = rendererRef.current;
        const currentScene = sceneRef.current;
        const currentCamera = cameraRef.current;
        const currentControls = controlsRef.current;

        if (currentRenderer && currentCamera && currentScene) {
          // 1. Actualizar OrbitControls si no es la vista de la cámara activa
          if (type !== 'CAMERA' && currentControls) {
            currentControls.update();
          }

          const { project, currentTime, isPlaying, isScrubbing } = useStore.getState();

          // 2. CONTROL DINÁMICO DE LA VISTA DE CÁMARA ACTIVA
          if (type === 'CAMERA') {
            // Desactivar OrbitControls si la línea de tiempo está reproduciéndose o se está haciendo scrubbing
            if (currentControls) {
              currentControls.enabled = !isPlaying && !isScrubbing;
            }

            const activeCamId = viewCameraId || project.cameras?.[0]?.id;
            const camData = project.cameras?.find(c => c.id === activeCamId);

            if (camData) {
              // Calcular la posición exacta en el tiempo actual según la elipse/ruta
              const evalCam = evaluateCameraTransform(camData, project.objects, currentTime, project.duration || 5);
              
              // ¡CRUCIAL! Mover la cámara real que se está renderizando en este instante
              currentCamera.position.copy(evalCam.position);

              if (evalCam.target) {
                // Orientar la cámara real al Cubo Base u objetivo de seguimiento
                safeLookAt(currentCamera, evalCam.target);
                
                if (currentControls) {
                  currentControls.target.copy(evalCam.target);
                  // Si la línea de tiempo está parada y no estamos haciendo scrubbing, dejamos que actualice
                  if (!isPlaying && !isScrubbing) {
                    currentControls.update();
                  }
                }
              } else {
                currentCamera.rotation.fromArray(camData.transform.rotation);
                if (currentControls) {
                  const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler().fromArray(camData.transform.rotation));
                  currentControls.target.copy(evalCam.position.clone().add(fwd));
                  if (!isPlaying && !isScrubbing) {
                    currentControls.update();
                  }
                }
              }

              // Mantener actualizado el FOV y la matriz de proyección de la cámara activa
              if (currentCamera instanceof THREE.PerspectiveCamera) {
                const targetFov = camData.fov || 45;
                if (currentCamera.fov !== targetFov) {
                  currentCamera.fov = targetFov;
                  currentCamera.updateProjectionMatrix();
                }
              }
            }
          }

          // 3. Actualizar la posición de los Gizmos/Dibujos de las cámaras en las otras escenas
          (project.cameras || []).forEach(cData => {
            const cg = camerasRef.current.get(cData.id);
            if (cg) {
              cg.visible = type !== 'CAMERA';
              const evalCam = evaluateCameraTransform(cData, project.objects, currentTime, project.duration || 5);
              cg.position.copy(evalCam.position);
              
              const targetGroup = cg.getObjectByName('targetTrackingGroup');
              if (evalCam.target) {
                safeLookAt(cg, evalCam.target);
                if (targetGroup) {
                  targetGroup.visible = type !== 'CAMERA';
                  const dist = evalCam.position.distanceTo(evalCam.target);
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
                        new THREE.Vector3(0, 0, -dist)
                      ]);
                      (line as any).computeLineDistances?.();
                    }
                  }
                  const reticle = targetGroup.getObjectByName('targetReticle');
                  if (reticle) {
                    reticle.position.set(0, 0, -dist);
                  }
                }
              } else {
                cg.rotation.fromArray(cData.transform.rotation);
                if (targetGroup) targetGroup.visible = false;
              }
            }
          });

          // 4. Actualizar la posición de la cámara y uniforms en materiales de paralaje y shaders volumétricos
          const elapsedTime = performance.now() * 0.001;
          const mainLight = currentScene.getObjectByName('editorDirectionalLight') as THREE.DirectionalLight;
          const lightPos = mainLight ? mainLight.position : new THREE.Vector3(5, 10, 5);

          currentScene.traverse((child) => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              materials.forEach((mat: any) => {
                if (mat && mat.uniforms) {
                  if (mat.uniforms.uCameraPos) {
                    mat.uniforms.uCameraPos.value.copy(currentCamera.position);
                  }
                  if (mat.uniforms.uTime) {
                    mat.uniforms.uTime.value = elapsedTime;
                  }
                  if (mat.uniforms.uLightPosition) {
                    mat.uniforms.uLightPosition.value.copy(lightPos);
                  }
                  if (mat.uniforms.uLightPos) {
                    mat.uniforms.uLightPos.value.copy(lightPos);
                  }
                  if (mat.uniforms.uModelInverse) {
                    mat.uniforms.uModelInverse.value.copy(child.matrixWorld).invert();
                  }
                  if (mat.uniforms.uInteractiveMouse && mat.uniforms.uInteractiveMouse.value === 1 && mat.uniforms.uMousePos) {
                    const ray = new THREE.Ray();
                    ray.origin.copy(currentCamera.position);
                    const ndc = new THREE.Vector3(mouseRef.current.x, mouseRef.current.y, 0.5).unproject(currentCamera);
                    ray.direction.copy(ndc.sub(currentCamera.position).normalize());
                    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -child.position.y);
                    const target = new THREE.Vector3();
                    if (ray.intersectPlane(plane, target)) {
                      const localTarget = target.applyMatrix4(new THREE.Matrix4().copy(child.matrixWorld).invert());
                      mat.uniforms.uMousePos.value.copy(localTarget);
                    }
                  }
                }
                if (mat && mat.userData?.shader?.uniforms) {
                  const sh = mat.userData.shader.uniforms;
                  if (sh.uTime) sh.uTime.value = elapsedTime;
                  if (sh.uGlassTime) sh.uGlassTime.value = elapsedTime;
                  if (sh.uCameraPos) sh.uCameraPos.value.copy(currentCamera.position);
                  if (sh.uLightPos) sh.uLightPos.value.copy(lightPos);
                }
              });
            }
          });

          // 5. Actualizar simuladores de partículas (Particle Systems y Space Warps)
          const dt = clock.getDelta();
          const spaceWarpsData: SpaceWarpObjectData[] = [];
          (project.objects || []).forEach(o => {
            const isWarp = o.type === 'SPACE_WARP' || o.isSpaceWarp || o.parameters?.isSpaceWarp;
            if (isWarp) {
              const warpCfg = { ...DEFAULT_SPACE_WARP_CONFIG, ...(o.parameters?.spaceWarpConfig || {}), ...(o.spaceWarpConfig || {}) };
              const interp = getInterpolatedTransform(o, currentTime);
              const pos = new THREE.Vector3(interp.position[0], interp.position[1], interp.position[2]);
              const eul = new THREE.Euler(interp.rotation[0], interp.rotation[1], interp.rotation[2], 'XYZ');
              const quat = new THREE.Quaternion().setFromEuler(eul);
              spaceWarpsData.push({
                id: o.id,
                type: warpCfg.warpType || 'WIND',
                position: pos,
                quaternion: quat,
                config: warpCfg
              });
            }
          });

          particleSimulatorsRef.current.forEach((sim, emitterId) => {
            const emitterObj = project.objects.find(o => o.id === emitterId);
            if (!emitterObj) return;

            const interp = getInterpolatedTransform(emitterObj, currentTime);
            const pos = new THREE.Vector3(interp.position[0], interp.position[1], interp.position[2]);
            const eul = new THREE.Euler(interp.rotation[0], interp.rotation[1], interp.rotation[2], 'XYZ');
            const quat = new THREE.Quaternion().setFromEuler(eul);
            const scale = new THREE.Vector3(interp.scale[0], interp.scale[1], interp.scale[2]);

            if (isScrubbing) {
              sim.seekToTime(
                currentTime,
                (t) => {
                  const tr = getInterpolatedTransform(emitterObj, t);
                  return {
                    position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
                    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
                    scale: new THREE.Vector3(tr.scale[0], tr.scale[1], tr.scale[2])
                  };
                },
                (t) => {
                  const warps: SpaceWarpObjectData[] = [];
                  (project.objects || []).forEach(o => {
                    if (o.type === 'SPACE_WARP' || o.isSpaceWarp || o.parameters?.isSpaceWarp) {
                      const wCfg = { ...DEFAULT_SPACE_WARP_CONFIG, ...(o.parameters?.spaceWarpConfig || {}), ...(o.spaceWarpConfig || {}) };
                      const tr = getInterpolatedTransform(o, t);
                      warps.push({
                        id: o.id,
                        type: wCfg.warpType || 'WIND',
                        position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
                        quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
                        config: wCfg
                      });
                    }
                  });
                  return warps;
                }
              );
            } else {
              const effectiveDt = dt > 0 ? Math.min(dt, 0.05) : 0.016;
              sim.update(effectiveDt, { position: pos, quaternion: quat, scale: scale }, spaceWarpsData, isPlaying ? currentTime : elapsedTime);
            }
          });

          // RENDERIZAR LA ESCENA USANDO LA CÁMARA REAL CAPTURADA EN ESTE FRAME
          currentRenderer.render(currentScene, currentCamera);
        }
      } catch (e) {
        console.error("Error en bucle de animación:", e);
      }
    };
    animate();
    return () => cancelAnimationFrame(id);
  }, [type, viewCameraId]);

  // ── 1.5b Disable OrbitControls while draw mode is active ────────────────
  // OrbitControls and drawing listeners share the same canvas element.
  // Without this, every pointer drag in draw mode ALSO pans/rotates the camera,
  // causing: (a) Bézier handles not working, (b) points placed at wrong coords.
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    
    const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
      silueta.activePlane.toUpperCase() === type.toUpperCase()
    );

    ctrl.enabled = !drawMode && !isSiluetaActiveInThisViewport && !moveReferenceMode;
    return () => { if (controlsRef.current) controlsRef.current.enabled = true; };
  }, [drawMode, silueta.activePlane, type, moveReferenceMode]);

  // ── 1.6 Reference Image ──────────────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current) return;
    const existing = sceneRef.current.getObjectByName('reference-plane');

    const viewKey = type.toLowerCase() as 'top'|'bottom'|'front'|'back'|'left'|'right';
    if (!['top','bottom','front','back','left','right'].includes(viewKey)) {
      if (existing) sceneRef.current.remove(existing);
      return;
    }
    const refData = project?.references ? project.references[viewKey] : undefined;
    if (!refData?.url) {
      if (existing) sceneRef.current.remove(existing);
      return;
    }

    new THREE.TextureLoader().load(refData.url, tex => {
      const old = sceneRef.current?.getObjectByName('reference-plane');
      if (old) sceneRef.current!.remove(old);
      const aspect = tex.image ? (tex.image.width / tex.image.height) : 1;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1,1),
        new THREE.MeshBasicMaterial({ map:tex, transparent:true, opacity:refData.opacity, side:THREE.DoubleSide, depthWrite:false })
      );
      plane.name = 'reference-plane';
      plane.userData = { aspect, baseScale: refData.scale };
      
      const s = refData.scale[1] || refData.scale[0] || 5;
      const flipScaleX = (s * aspect) * (refData.flipX ? -1 : 1);
      const flipScaleY = s * (refData.flipY ? -1 : 1);
      plane.scale.set(flipScaleX, flipScaleY, 1);
      
      const pos = refData.position || [0, 0, 0];
      plane.position.set(pos[0], pos[1], pos[2]);

      const angleRad = ((refData.angle || 0) * Math.PI) / 180;

      if (type === 'TOP' || type === 'BOTTOM') {
        plane.rotation.x = -Math.PI/2;
        if (type === 'BOTTOM') plane.rotation.x = Math.PI/2;
        plane.rotation.z = angleRad;
      } else if (type === 'FRONT' || type === 'BACK') {
        plane.rotation.y = type === 'BACK' ? Math.PI : 0;
        plane.rotation.z = angleRad;
      } else if (type === 'LEFT' || type === 'RIGHT') {
        plane.rotation.y = type === 'LEFT' ? -Math.PI/2 : Math.PI/2;
        plane.rotation.z = angleRad;
      }
      sceneRef.current?.add(plane);
    });
  }, [project.references, type]);

  // ── 1.8 Environment Update ──────────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const env = project.environment;

    let isCancelled = false;

    setupSceneEnvironment(scene, renderer, env).then(res => {
      if (isCancelled) return;
      if (bgTextureRef.current && bgTextureRef.current !== res.bgTexture && bgTextureRef.current !== res.envTexture) {
        bgTextureRef.current.dispose();
      }
      if (envTextureRef.current && envTextureRef.current !== res.envTexture && envTextureRef.current !== res.pmremTexture) {
        envTextureRef.current.dispose();
      }
      bgTextureRef.current = res.bgTexture || res.envTexture;
      envTextureRef.current = res.pmremTexture || res.envTexture;
    }).catch(err => {
      console.error('Error updating environment:', err);
    });

    return () => {
      isCancelled = true;
    };
  }, [
    project.environment?.hdriUrl,
    project.environment?.backgroundMode,
    project.environment?.backgroundVisible,
    project.environment?.backgroundColor,
    project.environment?.backgroundBlur,
    project.environment?.backgroundIntensity,
    project.environment?.rotation,
    project.environment?.intensity,
    project.environment?.exposure,
    project.environment?.maxResolution
  ]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = project.environment?.exposure ?? 1.1;
    }
  }, [project.environment?.exposure]);

  // ── 1.7 Silueta Reference Image ──────────────────────────────────────────
  useEffect(() => {
    if (!sceneRef.current) return;
    const existing = sceneRef.current.getObjectByName('silueta-reference-plane');
    if (existing) sceneRef.current.remove(existing);

    if (!silueta.activePlane) return;

    const viewKey = type.toLowerCase() as 'top'|'bottom'|'front'|'back'|'left'|'right';
    if (!['top','bottom','front','back','left','right'].includes(viewKey)) return;
    
    const imageUrl = silueta[`${viewKey}Image` as keyof typeof silueta] as string | null;
    if (!imageUrl) return;

    new THREE.TextureLoader().load(imageUrl, tex => {
      const old = sceneRef.current?.getObjectByName('silueta-reference-plane');
      if (old) sceneRef.current!.remove(old);
      
      const aspect = tex.image ? (tex.image.width / tex.image.height) : 1;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map:tex, transparent:true, opacity:0.4, side:THREE.DoubleSide, depthWrite:false })
      );
      plane.name = 'silueta-reference-plane';
      plane.scale.set(aspect, 1, 1);
      
      if (type === 'TOP' || type === 'BOTTOM') {
        plane.rotation.x = -Math.PI/2;
        if (type === 'BOTTOM') plane.rotation.x = Math.PI/2;
        plane.position.y = (type === 'TOP' ? -0.01 : 0.01);
      } else if (type === 'FRONT' || type === 'BACK') {
        if (type === 'BACK') plane.rotation.y = Math.PI;
        plane.position.z = (type === 'FRONT' ? -0.01 : 0.01);
      } else if (type === 'LEFT' || type === 'RIGHT') {
        plane.rotation.y = Math.PI/2;
        if (type === 'LEFT') plane.rotation.y = -Math.PI/2;
        plane.position.x = (type === 'RIGHT' ? -0.01 : 0.01);
      }

      sceneRef.current?.add(plane);
    });
  }, [silueta.activePlane, silueta.frontImage, silueta.backImage, silueta.leftImage, silueta.rightImage, silueta.topImage, silueta.bottomImage, type]);

  // ── Silueta Rendering ───────────────────────────────────────────────────
  useEffect(() => {
    const group = siluetaGroupRef.current;
    if (!group) return;
    group.clear();

    // If silueta tool is active (any plane), we show the contours in their respective viewports
    if (!silueta.activePlane) return;
    
    let planeKey: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | null = null;
    const t = type.toLowerCase() as any;
    if (['front','back','left','right','top','bottom'].includes(t)) {
      planeKey = t;
    }
    
    if (!planeKey) return;

    const contour = silueta[planeKey] || [];
    if (contour.length === 0) return;

    // Render lines
    const points: THREE.Vector3[] = [];
    contour.forEach(p => {
      if (planeKey === 'front' || planeKey === 'back') points.push(new THREE.Vector3(p[0], p[1], 0));
      else if (planeKey === 'left' || planeKey === 'right') points.push(new THREE.Vector3(0, p[1], p[0]));
      else if (planeKey === 'top' || planeKey === 'bottom') points.push(new THREE.Vector3(p[0], 0, -p[1]));
    });
    
    if (points.length > 1) {
      // Close loop for visualization
      const closedPoints = [...points, points[0]];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(closedPoints);
      const color = (planeKey === 'front' || planeKey === 'back') ? 0xff0000 : ((planeKey === 'left' || planeKey === 'right') ? 0x22d3ee : 0x22c55e);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color, linewidth: 2 }));
      group.add(line);
    }

    // Render points
    contour.forEach((p, idx) => {
      const dotGeom = new THREE.SphereGeometry(0.04, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const dot = new THREE.Mesh(dotGeom, dotMat);
      dot.userData.siluetaIdx = idx;   // ← needed for raycaster hit detection
      if (planeKey === 'front' || planeKey === 'back') dot.position.set(p[0], p[1], 0);
      else if (planeKey === 'left' || planeKey === 'right') dot.position.set(0, p[1], p[0]);
      else if (planeKey === 'top' || planeKey === 'bottom') dot.position.set(p[0], 0, -p[1]);
      group.add(dot);
    });
  }, [silueta, type]);

  const mixersRef = useRef<Map<string, THREE.AnimationMixer>>(new Map());
  const gltfCacheRef = useRef<Map<string, { scene: THREE.Object3D, animations: THREE.AnimationClip[] }>>(new Map());

  // ── 2. Scene sync — builds geometry from vertices/faces (unified mesh) ───
  useEffect(() => {
    let isEffectCancelled = false;
    const group = groupRef.current;
    const primitivesGroup = primitivesGroupRef.current;
    if (!group || !primitivesGroup) return;
    group.clear();
    primitivesGroup.clear();
    meshesRef.current.clear();
    vertexPointsRef.current = null;

    const getMaterialForObject = (obj: CSGObject, mData: any) => {
      // Ensure mData has defaults from obj if not present, avoiding getting stuck on blueprint dark navy
      const baseObjColor = (obj as any).originalColor || (obj.color === '#08182b' ? '#e2e8f0' : (obj.color || '#ffffff'));
      let finalMData = {
        ...mData,
        color: mData.color || baseObjColor,
        opacity: mData.opacity ?? obj.opacity ?? 1,
        transparent: (mData.opacity ?? obj.opacity ?? 1) < 1,
      };

      // En modo Sólido y modos no texturizados, no mostrar texturas (albedo, normales, rugosidad, etc.) y mostrar solo el color sólido de Apariencia
      if (viewMode !== 'TEXTURED' && viewMode !== 'TEXTURED_WIREFRAME') {
        finalMData = {
          ...finalMData,
          color: mData.color || baseObjColor,
          map: undefined,
          mapAlbedo: undefined,
          normalMap: undefined,
          mapNormal: undefined,
          roughnessMap: undefined,
          mapRoughness: undefined,
          metalnessMap: undefined,
          mapMetalness: undefined,
          aoMap: undefined,
          mapAO: undefined,
          emissiveMap: undefined,
          mapEmissive: undefined,
          displacementMap: undefined,
          mapDisplacement: undefined,
          transmissionMap: undefined,
          thicknessMap: undefined,
          clearcoatMap: undefined,
          clearcoatRoughnessMap: undefined,
          clearcoatNormalMap: undefined,
          sheenColorMap: undefined,
          sheenRoughnessMap: undefined,
          iridescenceMap: undefined,
          iridescenceThicknessMap: undefined,
          anisotropyMap: undefined,
          ormMap: undefined,
          bumpMap: undefined,
          useParallax: false,
          uvDebug: false,
          triplanarBlend: undefined,
        };
      } else if (obj.uvDebug || mData.uvDebug) {
        finalMData = {
          ...finalMData,
          color: '#ffffff',
          map: getUVDebugTexture(),
          normalMap: undefined,
          roughnessMap: undefined,
          metalnessMap: undefined,
          aoMap: undefined,
          displacementMap: undefined,
          useParallax: false,
          roughness: 0.2,
          metalness: 0.0,
        };
      }

      if (finalMData.useParallax && (viewMode === 'TEXTURED' || viewMode === 'TEXTURED_WIREFRAME')) {
        const loader = new THREE.TextureLoader();
        const loadTex = (url: string | undefined, isColor = false) => {
          if (!url) return undefined;
          const tex = loader.load(url, (loadedTex) => {
            loadedTex.flipY = finalMData.flipY ?? true;
            loadedTex.needsUpdate = true;
          });
          if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = finalMData.flipY ?? true;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          if (finalMData.mapRepeat) tex.repeat.set(finalMData.mapRepeat[0], finalMData.mapRepeat[1]);
          if (finalMData.mapOffset) tex.offset.set(finalMData.mapOffset[0], finalMData.mapOffset[1]);
          if (finalMData.mapRotation !== undefined) tex.rotation = (finalMData.mapRotation * Math.PI) / 180;
          return tex;
        };

        const maps = {
          albedo: loadTex(finalMData.map, true),
          normal: loadTex(finalMData.normalMap),
          roughness: loadTex(finalMData.roughnessMap),
          metallic: loadTex(finalMData.metalnessMap),
          ao: loadTex(finalMData.aoMap),
          displacement: loadTex(finalMData.displacementMap),
        };
        return createParallaxMaterial(maps, {
          scale: finalMData.parallaxScale ?? 0.1,
          steps: finalMData.parallaxSteps ?? 32,
          tiling: finalMData.mapRepeat ?? [1, 1],
          color: finalMData.color,
          roughness: finalMData.roughness ?? 0.5,
          metalness: finalMData.metalness ?? 0,
          opacity: finalMData.opacity,
          transparent: finalMData.transparent,
          normalScale: finalMData.normalScale ?? 1,
        });
      }

      // ── VOLUMETRIC RAYMARCHING MATERIAL ──
      const isVolumetricObj = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || obj.parameters?.isVolumetric || finalMData.isVolumetric || finalMData.volumetric?.enabled;
      if (isVolumetricObj) {
        const volCfg = {
          ...(obj.parameters?.volumetric || {}),
          ...(obj.volumetric || {}),
          ...(finalMData.volumetric || {}),
          color: finalMData.color || obj.color || '#ffffff',
        };
        return createRaymarchedCloudMaterial(volCfg);
      }

      // ── LA MEJORA MAESTRA: CREAR EL MATERIAL PBR BASE ──
      const mat = createPBRMaterial(finalMData);

      // DETECTOR INTELIGENTE TRIPLANAR AUTOMÁTICO:
      // Si estamos en vista texturizada, forzamos el mapeado triplanar para maderas y piedras,
      // eliminando las costuras de forma masiva en el cubo biselado.
      const nombreMat = (finalMData.name || '').toLowerCase();
      const uvMapping = finalMData.uvwMapping || 'BOX';
      const requiereTriplanar = uvMapping === 'TRIPLANAR' || nombreMat.includes('triplanar') || typeof finalMData.triplanarBlend === 'number';

      if (requiereTriplanar) {
        setupTriplanarMaterial(mat, finalMData);
      }

      return mat;
    };

    project.objects.forEach(obj => {
      if (!obj.visible) return;
      
      const isCameraPath = Boolean(obj.parameters?.isCameraPath || obj.id.startsWith('camera_path') || obj.name.includes('Ruta_Camara'));
      if (type === 'CAMERA' && isCameraPath) return;

      const _interpTransform = getInterpolatedTransform(obj, currentTime);
      const initialPos = new THREE.Vector3(..._interpTransform.position);
      const initialRot = new THREE.Euler(..._interpTransform.rotation);
      const initialScale = new THREE.Vector3(..._interpTransform.scale);
      const mat4 = new THREE.Matrix4().compose(
        initialPos,
        new THREE.Quaternion().setFromEuler(initialRot),
        initialScale
      );

      // Handle GLTF/STL/OBJ objects specifically
      if (obj.meshData) {
        const isSelected = (selectedObjectIds ?? [selectedObjectId]).includes(obj.id);
        
        // Resolve material: priority is inline material > materialId > default
        const projectMaterials = project.materials || [];
        const referencedMaterial = obj.materialId ? projectMaterials.find(m => m.id === obj.materialId) : null;
        
        // For imported 3D models (GLTF/OBJ), use custom replacement material only if explicitly customized by user:
        const hasCustomOverride = Boolean(
          obj.uvDebug ||
          (referencedMaterial && referencedMaterial.category !== 'imported' && !referencedMaterial.id.startsWith('mat_imp_')) ||
          (obj.material && (obj.material as any).userModified)
        );

        let customMaterial: THREE.Material | null = null;
        if (hasCustomOverride) {
          const mData = referencedMaterial
            ? { ...referencedMaterial, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
            : (obj.material || {});
          customMaterial = getMaterialForObject(obj, mData);
        }

        const applyViewModeToImported = (object3D: THREE.Object3D) => {
          // 1. Remove and dispose of any existing wireframe overlays first
          const oldOverlays: THREE.Object3D[] = [];
          object3D.traverse((child) => {
            if (child.userData?.isWireOverlay) {
              oldOverlays.push(child);
            }
          });
          oldOverlays.forEach((overlay) => {
            if (overlay.parent) overlay.parent.remove(overlay);
            if ((overlay as THREE.Mesh).material) {
              const m = (overlay as THREE.Mesh).material;
              if (Array.isArray(m)) m.forEach(x => x.dispose());
              else m.dispose();
            }
          });

          // 2. Collect genuine model meshes to avoid mutating hierarchy during traversal
          let meshIdx = 0;
          const contentMeshes: THREE.Mesh[] = [];
          object3D.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && !child.userData?.isWireOverlay) {
              contentMeshes.push(child as THREE.Mesh);
            }
            if (child.userData?.isSkeletonHelper) {
              child.visible = !!project.showSkeleton;
            }
          });

          // 3. Configure materials and wireframe overlays safely on the collected meshes
          for (const mesh of contentMeshes) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Preserve initial imported base materials if not cached yet (never cache blueprint material)
            if (!mesh.userData.initialBaseMaterials && mesh.material && !(mesh.material as any).isBlueprintMaterial) {
              if (Array.isArray(mesh.material)) {
                mesh.userData.initialBaseMaterials = mesh.material.map(m => m.clone());
              } else if (mesh.material) {
                mesh.userData.initialBaseMaterials = mesh.material.clone();
              }
            }

            const rawBaseMaterials = mesh.userData.initialBaseMaterials || mesh.material;

            const isBlueprintActive = viewMode === 'BLUEPRINT';

            if (isBlueprintActive) {
              const blueprintMat = new THREE.MeshStandardMaterial({
                color: 0x091b33, // High-contrast technical blueprint navy
                roughness: 0.85,
                metalness: 0.15,
                side: THREE.DoubleSide,
                flatShading: true,
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1,
              });
              (blueprintMat as any).isBlueprintMaterial = true;
              mesh.material = blueprintMat;
            } else if (customMaterial) {
              const m = customMaterial.clone();
              m.side = THREE.DoubleSide;
              (m as any).shadowSide = THREE.DoubleSide;
              (m as any).wireframe = false;
              m.visible = viewMode !== 'WIREFRAME';
              mesh.material = m;
            } else {
              const mapMaterial = (sourceMat: THREE.Material) => {
                const projMat = projectMaterials.find(m => m.id === sourceMat.userData?.csgMaterialId);
                if (projMat && (projMat as any).userModified) {
                  const m = getMaterialForObject(obj, projMat);
                  m.side = THREE.DoubleSide;
                  (m as any).shadowSide = THREE.DoubleSide;
                  (m as any).wireframe = false;
                  m.visible = viewMode !== 'WIREFRAME';
                  return m;
                }

                // Cloned from pristine base material so textures/visibility are always restored reliably
                const activeMat = (sourceMat as any).clone();
                activeMat.side = THREE.DoubleSide;
                activeMat.shadowSide = THREE.DoubleSide;
                activeMat.wireframe = false;

                if (viewMode === 'WIREFRAME') {
                  activeMat.visible = false;
                } else if (viewMode === 'SOLID') {
                  // Strips textures in SOLID mode while ensuring base surface visibility is true
                  activeMat.visible = true;
                  activeMat.map = null;
                  activeMat.normalMap = null;
                  activeMat.roughnessMap = null;
                  activeMat.metalnessMap = null;
                  activeMat.aoMap = null;
                  activeMat.emissiveMap = null;
                  activeMat.displacementMap = null;
                  activeMat.bumpMap = null;
                  const displayColor = (obj.color && obj.color !== '#ffffff' && obj.color !== '#08182b') ? obj.color : null;
                  if (displayColor && activeMat.color) {
                    activeMat.color.set(displayColor);
                  }
                  activeMat.needsUpdate = true;
                } else {
                  // TEXTURED or TEXTURED_WIREFRAME: Full material with restored textures and visibility
                  activeMat.visible = true;
                  activeMat.needsUpdate = true;
                }

                return activeMat;
              };

              if (Array.isArray(rawBaseMaterials)) {
                mesh.material = rawBaseMaterials.map(mapMaterial);
              } else if (rawBaseMaterials) {
                mesh.material = mapMaterial(rawBaseMaterials);
              }
            }
            
            const meshId = `mesh-${meshIdx++}`;
            const isMeshSelected = isSelected && selectedGLTFMeshes && selectedGLTFMeshes.includes(meshId);
            
            // Isolation mode: solo aislar si está activado Y realmente hay partes seleccionadas en la lista.
            // Si la selección está vacía o el usuario no seleccionó sub-mallas, NUNCA ocultar el modelo: mostrar todo.
            if (isSelected && isolateGLTFSelection && selectedGLTFMeshes && selectedGLTFMeshes.length > 0) {
              mesh.visible = isMeshSelected;
            } else {
              mesh.visible = true;
            }

            // If TEXTURED_WIREFRAME, WIREFRAME, isBlueprintActive, or showWireframe: add clean topology edge overlay
            const shouldShowWire = viewMode === 'TEXTURED_WIREFRAME' || viewMode === 'WIREFRAME' || isBlueprintActive || (!!obj.showWireframe && viewMode !== 'SOLID' && viewMode !== 'TEXTURED');
            if (shouldShowWire) {
              const isSkinned = !!(mesh as any).isSkinnedMesh;
              const isWireOnly = viewMode === 'WIREFRAME';
              const wireColor = isBlueprintActive
                ? 0x00f0ff // Glowing cyan technical blueprint lines
                : (isWireOnly
                    ? (isSelected ? 0x4f8ef7 : 0x22dd44)
                    : (isSelected ? 0x38bdf8 : 0x0284c7));

              if (isSkinned) {
                // MODELO ARTICULADO CON ESQUELETO Y HUESOS (ej. AT-AT Walker):
                // En Three.js, LineSegments NO soporta skinning por GPU y se quedaría congelado en el suelo en bind pose.
                // Para una SkinnedMesh creamos un SkinnedMesh compañero vinculado al mismo esqueleto para que camine y
                // se mueva 100% en sincronía con los huesos sin ningún duplicado estático tirado en el suelo.
                const skinned = mesh as THREE.SkinnedMesh;
                const wireMat = new THREE.MeshBasicMaterial({
                  color: wireColor,
                  wireframe: true,
                  transparent: true,
                  opacity: isBlueprintActive ? 0.95 : (isWireOnly ? 1.0 : 0.85),
                  depthTest: true,
                  depthWrite: false,
                  polygonOffset: true,
                  polygonOffsetFactor: -1,
                  polygonOffsetUnits: -4,
                });

                const wireSkinned = new THREE.SkinnedMesh(skinned.geometry, wireMat);
                if (skinned.skeleton) {
                  wireSkinned.bind(skinned.skeleton, skinned.bindMatrix);
                }
                wireSkinned.position.set(0, 0, 0);
                wireSkinned.rotation.set(0, 0, 0);
                wireSkinned.scale.set(1, 1, 1);
                wireSkinned.userData.isWireOverlay = true;
                wireSkinned.renderOrder = 2;
                mesh.add(wireSkinned);
              } else {
                const edgeGeo = extractEdgesFromBufferGeometry(mesh.geometry, {
                  dissolveCoplanars: true,
                  coplanarAngleDeg: isBlueprintActive || obj.silhouetteOnly ? Math.max(35.0, obj.creaseAngle ?? 35.0) : (obj.creaseAngle ?? 15.0),
                  silhouetteOnly: isBlueprintActive || !!obj.silhouetteOnly,
                });

                if (edgeGeo && edgeGeo.attributes.position && edgeGeo.attributes.position.count > 0) {
                  const edgeMat = new THREE.LineBasicMaterial({
                    color: wireColor,
                    transparent: true,
                    opacity: isBlueprintActive ? 0.95 : (isWireOnly ? 1.0 : 0.85),
                    depthTest: true,
                    depthWrite: false,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -4,
                  });

                  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
                  edgeLines.position.set(0, 0, 0);
                  edgeLines.rotation.set(0, 0, 0);
                  edgeLines.scale.set(1, 1, 1);
                  edgeLines.userData.isWireOverlay = true;
                  edgeLines.renderOrder = 2;
                  mesh.add(edgeLines);
                }
              }
            }
          }
        };

        const cacheKey = obj.meshData.data;
        const cached = gltfCacheRef.current.get(cacheKey);
        
        if (cached) {
          const clonedScene = SkeletonUtils.clone(cached.scene);
          clonedScene.position.copy(initialPos);
          clonedScene.rotation.copy(initialRot);
          clonedScene.scale.copy(initialScale);
          clonedScene.updateMatrixWorld(true);
          clonedScene.userData.id = obj.id;
          
          let meshIdx = 0;
          let hasBones = false;
          clonedScene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              
              // Add invisible raycasting proxy for each mesh
              const pickMesh = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
              mesh.updateMatrixWorld(true);
              pickMesh.applyMatrix4(mesh.matrixWorld);
              pickMesh.userData.id = obj.id;
              pickMesh.userData.meshId = `mesh-${meshIdx++}`;
              primitivesGroup.add(pickMesh);
            }
            if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
              hasBones = true;
            }
          });
          if (hasBones) {
            const helper = new THREE.SkeletonHelper(clonedScene);
            helper.userData.isSkeletonHelper = true;
            helper.visible = !!project.showSkeleton;
            clonedScene.add(helper);
          }

          applyViewModeToImported(clonedScene);

          if (cached.animations && cached.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(clonedScene);
            cached.animations.forEach(clip => {
              mixer.clipAction(clip).play();
            });
            mixer.setTime(currentTime);
            mixersRef.current.set(obj.id, mixer);
          }

          group.add(clonedScene);
          meshesRef.current.set(obj.id, clonedScene);
          return;
        }

        if (obj.meshData.type === 'gltf') {
          const loader = new GLTFLoader();
          const dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
          loader.setDRACOLoader(dracoLoader);
          loader.setMeshoptDecoder(MeshoptDecoder);
          loader.load(obj.meshData.data, (gltf) => {
            if (isEffectCancelled) return;
            const currentObj = useStore.getState().project.objects.find(o => o.id === obj.id);
            if (!currentObj || currentObj.meshData?.data !== cacheKey) return;

            const scene = gltf.scene;
            
            // Cache the original loaded scene and animations
            gltfCacheRef.current.set(cacheKey, { scene: scene, animations: gltf.animations || [] });
            
            // Clone it for this instance
            const clonedScene = SkeletonUtils.clone(scene);
            clonedScene.position.copy(initialPos);
            clonedScene.rotation.copy(initialRot);
            clonedScene.scale.copy(initialScale);
            clonedScene.updateMatrixWorld(true);
            clonedScene.userData.id = obj.id;
            
            let meshIdx = 0;
            let hasBones = false;
            clonedScene.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (!mesh.geometry.attributes.normal) {
                  mesh.geometry.computeVertexNormals();
                }

                // Add invisible raycasting proxy for each mesh
                const pickMesh = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
                mesh.updateMatrixWorld(true);
                pickMesh.applyMatrix4(mesh.matrixWorld);
                pickMesh.userData.id = obj.id;
                pickMesh.userData.meshId = `mesh-${meshIdx++}`;
                primitivesGroup.add(pickMesh);
              }
              if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
                hasBones = true;
              }
            });
            if (hasBones) {
              const helper = new THREE.SkeletonHelper(clonedScene);
              helper.userData.isSkeletonHelper = true;
              helper.visible = !!project.showSkeleton;
              clonedScene.add(helper);
            }

            applyViewModeToImported(clonedScene);

            if (gltf.animations && gltf.animations.length > 0) {
              const mixer = new THREE.AnimationMixer(clonedScene);
              gltf.animations.forEach(clip => {
                mixer.clipAction(clip).play();
              });
              mixer.setTime(currentTime);
              mixersRef.current.set(obj.id, mixer);
            }

            group.add(clonedScene);
            meshesRef.current.set(obj.id, clonedScene);
          }, undefined, (error) => {
            console.error(`❌ Error loading GLTF for object ${obj.id}:`, error);
          });
          return;
        } else if (obj.meshData.type === 'stl') {
          new STLLoader().load(obj.meshData.data, (geometry) => {
            if (isEffectCancelled) return;
            const currentObj = useStore.getState().project.objects.find(o => o.id === obj.id);
            if (!currentObj || currentObj.meshData?.data !== cacheKey) return;

            const material = new THREE.MeshPhysicalMaterial({ color: obj.color || '#ffffff' });
            const mesh = new THREE.Mesh(geometry, material);
            
            gltfCacheRef.current.set(cacheKey, { scene: mesh, animations: [] });
            
            const clonedMesh = mesh.clone();
            clonedMesh.position.copy(initialPos);
            clonedMesh.rotation.copy(initialRot);
            clonedMesh.scale.copy(initialScale);
            clonedMesh.updateMatrixWorld(true);
            clonedMesh.userData.id = obj.id;
            applyViewModeToImported(clonedMesh);
            
            group.add(clonedMesh);
            meshesRef.current.set(obj.id, clonedMesh);
          });
          return;
        } else if (obj.meshData.type === 'obj') {
          new OBJLoader().load(obj.meshData.data, (object) => {
            if (isEffectCancelled) return;
            const currentObj = useStore.getState().project.objects.find(o => o.id === obj.id);
            if (!currentObj || currentObj.meshData?.data !== cacheKey) return;

            gltfCacheRef.current.set(cacheKey, { scene: object, animations: [] });
            
            const clonedObject = object.clone();
            clonedObject.position.copy(initialPos);
            clonedObject.rotation.copy(initialRot);
            clonedObject.scale.copy(initialScale);
            clonedObject.updateMatrixWorld(true);
            clonedObject.userData.id = obj.id;
            applyViewModeToImported(clonedObject);
            
            group.add(clonedObject);
            meshesRef.current.set(obj.id, clonedObject);
          });
          return;
        }
      }

      if ((obj.type === 'SHAPE' || isCameraPath) && (!obj.faces || obj.faces.length === 0 || isCameraPath)) {
          const isBezier = obj.parameters.shapeType === 'bezier';
          const isSelected = (selectedObjectIds ?? [selectedObjectId]).includes(obj.id);
          const inEditMode = isSelected && editMode !== 'OBJECT';
          const objColor = isSelected ? 0xffff00 : new THREE.Color(obj.color).getHex();

          // Control points with offsets applied
          const ctrlPts = obj.vertices.map((v, i) => {
            const off = obj.vertexOffsets?.[i] ?? [0,0,0];
            return new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
          });

          // ── Build display curve ───────────────────────────────────────────
          let curveLine: THREE.Object3D;
          if (isBezier && ctrlPts.length >= 2 && obj.bezierHandles) {
            // Cubic Bezier chain: each segment uses anchor[i], anchor[i]+out[i],
            // anchor[i+1]+in[i+1], anchor[i+1]
            const allCurvePoints: THREE.Vector3[] = [];
            const count = obj.parameters.closed ? ctrlPts.length : ctrlPts.length - 1;
            for (let i = 0; i < count; i++) {
              const i1 = (i + 1) % ctrlPts.length;
              const h = obj.bezierHandles;
              if (!h[i] || !h[i1]) continue;
              const p0 = ctrlPts[i];
              const p1 = p0.clone().add(new THREE.Vector3(...h[i].out));
              const p3 = ctrlPts[i1];
              const p2 = p3.clone().add(new THREE.Vector3(...h[i1].in));
              const seg = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
              const pts = seg.getPoints(obj.parameters.segments ?? 20);
              if (allCurvePoints.length > 0) pts.shift(); // avoid duplicate junction
              allCurvePoints.push(...pts);
            }
            const geo = new THREE.BufferGeometry().setFromPoints(allCurvePoints);
            curveLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: objColor, linewidth: 2 }));
          } else if (isBezier && ctrlPts.length >= 2) {
            // FIX: For bezier without handles yet, auto-smooth and render as proper bezier
            // (no more CatmullRom fallback that produces wrong curves)
            const allCurvePoints2: THREE.Vector3[] = [];
            const segCount = obj.parameters.segments ?? 20;
            const handles2 = obj.bezierHandles!;
            const loopCount = obj.parameters.closed ? ctrlPts.length : ctrlPts.length - 1;
            for (let i = 0; i < loopCount; i++) {
              const i1 = (i + 1) % ctrlPts.length;
              const hOut = handles2[i]?.out   ?? [0,0,0];
              const hIn  = handles2[i1]?.in   ?? [0,0,0];
              const p0   = ctrlPts[i];
              const p1   = p0.clone().add(new THREE.Vector3(...hOut));
              const p3   = ctrlPts[i1];
              const p2   = p3.clone().add(new THREE.Vector3(...hIn));
              const seg2 = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
              const pts2 = seg2.getPoints(segCount);
              if (allCurvePoints2.length > 0) pts2.shift();
              allCurvePoints2.push(...pts2);
            }
            const geo2 = new THREE.BufferGeometry().setFromPoints(allCurvePoints2);
            curveLine = new THREE.Line(geo2, new THREE.LineBasicMaterial({ color: objColor, linewidth: 2 }));
          } else {
            const geo = new THREE.BufferGeometry().setFromPoints(ctrlPts);
            curveLine = obj.parameters.closed
              ? new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: objColor }))
              : new THREE.Line(geo, new THREE.LineBasicMaterial({ color: objColor }));
          }
          curveLine.position.copy(initialPos);
          curveLine.rotation.copy(initialRot);
          curveLine.scale.copy(initialScale);
          curveLine.updateMatrixWorld(true);
          curveLine.userData.id = obj.id;
          group.add(curveLine);
          meshesRef.current.set(obj.id, curveLine);

          if (inEditMode) {
            const pickLine = curveLine.clone() as THREE.Line;
            pickLine.material = new THREE.LineBasicMaterial({ visible: false });
            pickLine.userData.id = obj.id;
            pickLine.userData.handleType = 'curveLine';
            primitivesGroup.add(pickLine);
          }

          // ── Anchors and Bezier handles (only in edit mode) ───────────────────────────
          if (inEditMode && obj.vertices) {
            const selectedSet = new Set(selectedVertexIndices);
            ctrlPts.forEach((anchor, i) => {
              const h = obj.bezierHandles?.[i];
              const anchorWorld = anchor.clone().applyMatrix4(mat4);
              const isAnchorSel = selectedSet.has(i);

              // ── Anchor point (Crisp screen-space 2D point with fixed pixel size) ──
              const anchorGeo = new THREE.BufferGeometry().setFromPoints([anchorWorld]);
              const anchorPts = new THREE.Points(
                anchorGeo,
                new THREE.PointsMaterial({
                  size: isAnchorSel ? 9.5 : 7.5,
                  sizeAttenuation: false,
                  map: VERTEX_DOT_TEXTURE ?? undefined,
                  color: isAnchorSel ? 0xf59e0b : 0xffffff,
                  transparent: true,
                  alphaTest: 0.05,
                  depthTest: false,
                })
              );
              anchorPts.renderOrder = 40;
              group.add(anchorPts);

              // Show handles only for selected anchors (or all if in edit mode)
              const showHandles = inEditMode && isBezier && h;
              if (showHandles) {
                // ── OUT handle (blue) ──
                const MIN_H = 0.18;
                const rawOut = new THREE.Vector3(...h.out);
                const outPos = rawOut.length() > 0.001 ? rawOut : new THREE.Vector3(MIN_H, 0, 0);
                const outWorld = anchor.clone().add(outPos).applyMatrix4(mat4);
                // Arm line anchor→out
                const outLineGeo = new THREE.BufferGeometry().setFromPoints([anchorWorld, outWorld]);
                const outLine = new THREE.Line(outLineGeo, new THREE.LineBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.7, depthTest: false }));
                outLine.userData.id = obj.id;
                group.add(outLine);
                // Handle 2D point
                const outGeo = new THREE.BufferGeometry().setFromPoints([outWorld]);
                const isOutSel = selectedSet.has(i + 10000);
                const outPts = new THREE.Points(
                  outGeo,
                  new THREE.PointsMaterial({
                    size: 6.5,
                    sizeAttenuation: false,
                    map: VERTEX_DOT_TEXTURE ?? undefined,
                    color: isOutSel ? 0xf59e0b : 0x3b82f6,
                    transparent: true,
                    alphaTest: 0.05,
                    depthTest: false,
                  })
                );
                outPts.renderOrder = 42;
                group.add(outPts);

                // ── IN handle (green) ──
                const rawIn = new THREE.Vector3(...h.in);
                const inPos = rawIn.length() > 0.001 ? rawIn : new THREE.Vector3(-MIN_H, 0, 0);
                const inWorld = anchor.clone().add(inPos).applyMatrix4(mat4);
                const inLineGeo = new THREE.BufferGeometry().setFromPoints([anchorWorld, inWorld]);
                const inLine = new THREE.Line(inLineGeo, new THREE.LineBasicMaterial({ color: 0x44cc44, transparent: true, opacity: 0.7, depthTest: false }));
                inLine.userData.id = obj.id;
                group.add(inLine);
                const inGeo = new THREE.BufferGeometry().setFromPoints([inWorld]);
                const isInSel = selectedSet.has(i + 20000);
                const inPts = new THREE.Points(
                  inGeo,
                  new THREE.PointsMaterial({
                    size: 6.5,
                    sizeAttenuation: false,
                    map: VERTEX_DOT_TEXTURE ?? undefined,
                    color: isInSel ? 0xf59e0b : 0x22c55e,
                    transparent: true,
                    alphaTest: 0.05,
                    depthTest: false,
                  })
                );
                inPts.renderOrder = 42;
                group.add(inPts);
              }

              // Invisible pick sphere for anchor
              const pickSphere = new THREE.Mesh(
                SHARED_PICK_GEO,
                SHARED_PICK_MAT
              );
              pickSphere.scale.setScalar(0.045);
              pickSphere.position.copy(anchorWorld);
              pickSphere.userData.id = obj.id;
              pickSphere.userData.handleType = 'anchor';
              pickSphere.userData.anchorIdx = i;
              primitivesGroup.add(pickSphere);

              // Invisible pick spheres for handles
              if (showHandles) {
                const outPos2 = anchor.clone().add(new THREE.Vector3(...h.out)).applyMatrix4(mat4);
                const outPick = new THREE.Mesh(SHARED_PICK_GEO, SHARED_PICK_MAT);
                outPick.scale.setScalar(0.035);
                outPick.position.copy(outPos2);
                outPick.userData.id = obj.id;
                outPick.userData.handleType = 'bezierOut';
                outPick.userData.anchorIdx = i;
                primitivesGroup.add(outPick);

                const inPos2 = anchor.clone().add(new THREE.Vector3(...h.in)).applyMatrix4(mat4);
                const inPick = new THREE.Mesh(SHARED_PICK_GEO, SHARED_PICK_MAT);
                inPick.scale.setScalar(0.035);
                inPick.position.copy(inPos2);
                inPick.userData.id = obj.id;
                inPick.userData.handleType = 'bezierIn';
                inPick.userData.anchorIdx = i;
                primitivesGroup.add(inPick);
              }
            });
          }

          // ── Invisible pick line for object selection ──────────────────────
          const pickLine = obj.parameters.closed && !isBezier
            ? new THREE.LineLoop((curveLine as THREE.Line).geometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
            : new THREE.Line((curveLine as THREE.Line).geometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
          pickLine.applyMatrix4(mat4);
          pickLine.userData.id = obj.id;
          primitivesGroup.add(pickLine);

          if (isCameraPath) {
            group.traverse(child => child.layers.set(1));
            primitivesGroup.traverse(child => child.layers.set(1));
          }

          return;
      }

      // ── Build Geometry with UV support ──────────────────────────────────
      let meshData = { vertices: obj.vertices, faces: obj.faces };
      const hasUVs = obj.faces?.some(f => f.uvs && f.uvs.length > 0);
      
      // Resolve material: priority is inline material > materialId > default
      const projectMaterials = project.materials || [];
      const referencedMaterial = obj.materialId ? projectMaterials.find(m => m.id === obj.materialId) : null;
      const mData = (referencedMaterial
        ? { ...referencedMaterial, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
        : (obj.material || {})) as any;

      if (!hasUVs && obj.vertices && obj.faces) {
        meshData = generateUVs(meshData);
      }

      // Apply UVW Mapping overrides if specified
      if (mData.uvwMapping && obj.vertices && obj.faces) {
        if (mData.uvwMapping === 'UV') {
          if (!hasUVs) {
            meshData = generateUVs(meshData);
          }
        } else {
          meshData = { ...meshData, faces: meshData.faces.map(f => ({ ...f, uvs: undefined })) }; // Clear existing UVs for re-projection
          meshData = applyUVWMapping(meshData, mData.uvwMapping);
        }
      }

      const indices: number[] = [];
      const finalPos: number[] = [];
      const finalUv: number[] = [];
      const vertMap = new Map<string, number>();
      const faceMap: number[] = [];
      const vertexMap: number[] = []; // Maps finalPos index to obj.vertices index

      // We also need a flat position array for the wireframe (based on original indices)
      const posArr: number[] = [];
      meshData.vertices.forEach((v, i) => {
        const off = obj.vertexOffsets?.[i] || [0,0,0];
        posArr.push(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
      });

      const isSmooth = obj.smoothShading === true;

      meshData.faces?.forEach((face, fIdx) => {
        const faceIndices: number[] = [];
        face.indices.forEach((posIdx, i) => {
          const uv = face.uvs?.[i] || [0, 0];
          // Create a unique vertex for each position + UV combination to handle seams
          const key = isSmooth
            ? `${posIdx}_${safeFixed(uv?.[0], 6)}_${safeFixed(uv?.[1], 6)}`
            : `${posIdx}_f${fIdx}`;
          
          if (vertMap.has(key)) {
            faceIndices.push(vertMap.get(key)!);
          } else {
            const newIdx = finalPos.length / 3;
            const v = meshData.vertices[posIdx];
            const off = obj.vertexOffsets?.[posIdx] || [0,0,0];
            finalPos.push(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
            finalUv.push(uv[0], uv[1]);
            vertMap.set(key, newIdx);
            faceIndices.push(newIdx);
            vertexMap.push(posIdx);
          }
        });

        // Triangulate face for WebGL buffer (keeps logical N-gon / Quad intact in CSGObject.faces)
        if (faceIndices.length === 3) {
          indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
          faceMap.push(fIdx);
        } else if (faceIndices.length === 4) {
          indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
          indices.push(faceIndices[0], faceIndices[2], faceIndices[3]);
          faceMap.push(fIdx, fIdx);
        } else if (faceIndices.length > 4) {
          // Triangulate N-gon using 2D projection
          const p0 = new THREE.Vector3(finalPos[faceIndices[0]*3], finalPos[faceIndices[0]*3+1], finalPos[faceIndices[0]*3+2]);
          const p1 = new THREE.Vector3(finalPos[faceIndices[1]*3], finalPos[faceIndices[1]*3+1], finalPos[faceIndices[1]*3+2]);
          const p2 = new THREE.Vector3(finalPos[faceIndices[2]*3], finalPos[faceIndices[2]*3+1], finalPos[faceIndices[2]*3+2]);
          const normal = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(p1, p0), new THREE.Vector3().subVectors(p2, p0)).normalize();
          
          let uAxis = new THREE.Vector3();
          if (Math.abs(normal.y) < 0.9) {
            uAxis.crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
          } else {
            uAxis.crossVectors(normal, new THREE.Vector3(1, 0, 0)).normalize();
          }
          const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();

          const pts2D = faceIndices.map(idx => {
            const pt = new THREE.Vector3(finalPos[idx*3], finalPos[idx*3+1], finalPos[idx*3+2]);
            const d = new THREE.Vector3().subVectors(pt, p0);
            return new THREE.Vector2(d.dot(uAxis), d.dot(vAxis));
          });

          const tris = THREE.ShapeUtils.triangulateShape(pts2D, []);
          if (tris && tris.length > 0) {
            tris.forEach(([a, b, c]) => {
              indices.push(faceIndices[a], faceIndices[b], faceIndices[c]);
              faceMap.push(fIdx);
            });
          } else {
            for (let i = 1; i < faceIndices.length - 1; i++) {
              indices.push(faceIndices[0], faceIndices[i], faceIndices[i+1]);
              faceMap.push(fIdx);
            }
          }
        }
      });

      let geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPos, 3));
      if (hasUVs || (!hasUVs && obj.vertices && obj.faces)) {
        const uvAttr = new THREE.Float32BufferAttribute(finalUv, 2);
        geometry.setAttribute('uv', uvAttr);
        geometry.setAttribute('uv2', uvAttr);
      }
      geometry.setIndex(indices);
      if (isSmooth) {
        computeSmoothNormalsByPosition(geometry, Math.PI / 3);
      } else {
        geometry.computeVertexNormals();
      }
      if (mData.useParallax) {
        geometry.computeTangents();
      }

      const isSelected = (selectedObjectIds ?? [selectedObjectId]).includes(obj.id);
      const isBlueprintActive = viewMode === 'BLUEPRINT';
      const isGpgpu = obj.type === 'GPGPU_SWARM' || obj.isGpgpuSwarm || obj.parameters?.isGpgpuSwarm;
      const isParticle = obj.type === 'PARTICLE_SYSTEM' || obj.isParticleSystem || obj.parameters?.isParticleSystem;

      // ── Solid mesh / GPGPU Swarm / Particle System ─────────────────────────
      if (isGpgpu) {
        const swarmCfg = { ...DEFAULT_GPGPU_SWARM_CONFIG, ...(obj.parameters?.gpgpuSwarmConfig || {}), ...(obj.gpgpuSwarmConfig || {}) };
        const swarmMesh = createGpgpuSwarmMesh(swarmCfg, obj.id);
        swarmMesh.position.copy(initialPos);
        swarmMesh.rotation.copy(initialRot);
        swarmMesh.scale.copy(initialScale);
        swarmMesh.updateMatrixWorld(true);
        group.add(swarmMesh);
        meshesRef.current.set(obj.id, swarmMesh);

        // Invisible pick proxy sphere for raycast selection in viewport
        const pickProxy = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(1.0, (swarmCfg.boundingRadius || 6) * 0.45), 12, 12),
          new THREE.MeshBasicMaterial({ visible: false, depthWrite: false })
        );
        pickProxy.position.copy(initialPos);
        pickProxy.rotation.copy(initialRot);
        pickProxy.scale.copy(initialScale);
        pickProxy.userData.id = obj.id;
        group.add(pickProxy);
      } else if (isParticle) {
        const pCfg = { ...DEFAULT_PARTICLE_CONFIG, ...(obj.parameters?.particleConfig || {}), ...(obj.particleConfig || {}) };
        let sim = particleSimulatorsRef.current.get(obj.id);
        if (!sim) {
          sim = new ParticleSimulator(obj.id, pCfg);
          particleSimulatorsRef.current.set(obj.id, sim);
        } else {
          sim.updateConfig(pCfg);
        }
        group.add(sim.points);
        meshesRef.current.set(obj.id, sim.points);

        // Pick proxy for easy selection in viewport
        const pickProxy = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.6, (pCfg.particleSize || 0.2) * 4), 12, 12),
          new THREE.MeshBasicMaterial({ visible: false, depthWrite: false })
        );
        pickProxy.position.copy(initialPos);
        pickProxy.rotation.copy(initialRot);
        pickProxy.scale.copy(initialScale);
        pickProxy.userData.id = obj.id;
        group.add(pickProxy);
      } else if (viewMode !== 'WIREFRAME') {
        const opacity = obj.opacity ?? 1;
        
          // Resolve material: priority is inline material > materialId > default
          const projectMaterials = project.materials || [];
          const referencedMaterial = obj.materialId ? projectMaterials.find(m => m.id === obj.materialId) : null;
        
          // Use referenced material cleanly, only applying inline overrides if explicitly user-modified
          const m = (referencedMaterial
            ? { ...referencedMaterial, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
            : (obj.material || {})) as any;

          const finalMaterial = isBlueprintActive
            ? new THREE.MeshStandardMaterial({
              color: 0x091b33,
              roughness: 0.85,
              metalness: 0.15,
              side: THREE.DoubleSide,
              flatShading: true,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            })
          : getMaterialForObject(obj, m);

        const isVol = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || obj.parameters?.isVolumetric || m.isVolumetric || m.volumetric?.enabled;
        const solidMesh = new THREE.Mesh(geometry, finalMaterial);
        solidMesh.castShadow = !isVol;
        solidMesh.receiveShadow = !isVol;
        solidMesh.position.copy(initialPos);
        solidMesh.rotation.copy(initialRot);
        solidMesh.scale.copy(initialScale);
        solidMesh.updateMatrixWorld(true);
        solidMesh.userData.id = obj.id;
        group.add(solidMesh);
        meshesRef.current.set(obj.id, solidMesh);
      }

      // ── Wireframe overlay (Topology-based) ───────────────────────────────
      const uniqueEdges = (obj.faces && obj.faces.length > 0) || (obj.wireframeEdges && obj.wireframeEdges.length > 0)
        ? extractUniqueEdges(obj, {
            dissolveCoplanars: true,
            coplanarAngleDeg: isBlueprintActive || obj.silhouetteOnly ? Math.max(35.0, obj.creaseAngle ?? 35.0) : (obj.creaseAngle ?? 15.0),
            silhouetteOnly: isBlueprintActive || !!obj.silhouetteOnly,
          })
        : [];

      const edgePositions: number[] = [];

      if (uniqueEdges.length > 0) {
        for (const [a, b] of uniqueEdges) {
          if (posArr[a*3] !== undefined && posArr[b*3] !== undefined) {
            edgePositions.push(
              posArr[a*3], posArr[a*3+1], posArr[a*3+2],
              posArr[b*3], posArr[b*3+1], posArr[b*3+2]
            );
          }
        }
      } else if (posArr.length >= 6) {
        // Fallback: connect vertices sequentially
        for (let i = 0; i < (posArr.length / 3) - 1; i++) {
          edgePositions.push(
            posArr[i*3], posArr[i*3+1], posArr[i*3+2],
            posArr[(i+1)*3], posArr[(i+1)*3+1], posArr[(i+1)*3+2]
          );
        }
      }

      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));

      const isWireOnly = obj.isWireframeOnly || !obj.faces || obj.faces.length === 0;
      const shouldShowEdges = isWireOnly || viewMode === 'WIREFRAME' || viewMode === 'TEXTURED_WIREFRAME' || viewMode === 'FACES_VERTICES' || isBlueprintActive || editMode !== 'OBJECT' || (!!obj.showWireframe && viewMode !== 'SOLID' && viewMode !== 'TEXTURED');

      const wireColor = isBlueprintActive
        ? 0x00f0ff
        : (isWireOnly
            ? (isSelected ? 0x60a5fa : 0x4ade80)
            : (viewMode === 'WIREFRAME' 
                ? (isSelected ? 0x4f8ef7 : 0x22dd44) 
                : (viewMode === 'TEXTURED_WIREFRAME'
                    ? (isSelected ? 0x38bdf8 : 0x0284c7)
                    : (viewMode === 'FACES_VERTICES' ? (isSelected ? 0x38bdf8 : 0x64748b) : 0x444444))));

      const edgeLines = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({
          color: wireColor,
          opacity: isBlueprintActive ? 0.95 : (isWireOnly ? 0.95 : (viewMode === 'WIREFRAME' ? 1 : (viewMode === 'TEXTURED_WIREFRAME' ? 0.85 : (viewMode === 'FACES_VERTICES' ? 0.85 : (editMode !== 'OBJECT' ? (isSelected ? 0.5 : 0.05) : 0))))),
          transparent: true,
          visible: shouldShowEdges,
          depthTest: !isWireOnly && viewMode !== 'WIREFRAME', 
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -4,
        })
      );
      edgeLines.position.copy(initialPos);
      edgeLines.rotation.copy(initialRot);
      edgeLines.scale.copy(initialScale);
      edgeLines.updateMatrixWorld(true);
      edgeLines.renderOrder = 1; // Ensure it renders on top of the solid mesh
      edgeLines.userData.id = obj.id;
      group.add(edgeLines);

      // ── Render NURBS Isoparms / Isocurves ────────────────────────────────
      if (obj.nurbsSurface) {
        const isoVerts = generateNurbsSurfaceIsoparms(
          obj.nurbsSurface,
          obj.parameters.isoparmsU ?? 10,
          obj.parameters.isoparmsV ?? 10,
          32
        );
        if (isoVerts.length > 0) {
          const isoGeo = new THREE.BufferGeometry();
          isoGeo.setAttribute('position', new THREE.Float32BufferAttribute(isoVerts, 3));
          const isoMat = new THREE.LineBasicMaterial({
            color: isSelected ? 0x00e5ff : 0x0284c7,
            transparent: true,
            opacity: isSelected ? (editMode === 'VERTEX' ? 0.9 : 0.65) : 0.35,
            depthTest: true
          });
          const isoLines = new THREE.LineSegments(isoGeo, isoMat);
          isoLines.position.copy(initialPos);
          isoLines.rotation.copy(initialRot);
          isoLines.scale.copy(initialScale);
          isoLines.renderOrder = 3;
          group.add(isoLines);
        }
      }

      // ── Sub-object edit helpers & NURBS Control Cage ─────────────────────
      const isNurbsObj = !!(obj.nurbsSurface || obj.nurbsCurve || obj.isNurbs || obj.type.startsWith('NURBS_'));
      if (isSelected && (isNurbsObj || editMode !== 'OBJECT')) {
        const posAttr = geometry.getAttribute('position');

        if (obj.nurbsSurface) {
          const surf = obj.nurbsSurface;
          const cps = surf.controlPoints;
          const uCount = cps.length;
          const vCount = cps[0]?.length || 0;
          const selCPs = obj.selectedNurbsControlPoints?.length
            ? obj.selectedNurbsControlPoints
            : (obj.selectedNurbsControlPoint ? [obj.selectedNurbsControlPoint] : []);
          const selSet = new Set(selCPs.map(p => `${p.u},${p.v ?? 0}`));

          // 1. Control Cage / Hull Lines (La Rejilla NURBS)
          const lineVerts: number[] = [];
          for (let u = 0; u < uCount; u++) {
            for (let v = 0; v < vCount; v++) {
              const pt = cps[u][v].point;
              if (u + 1 < uCount) {
                const nextU = cps[u + 1][v].point;
                lineVerts.push(pt[0], pt[1], pt[2], nextU[0], nextU[1], nextU[2]);
              }
              if (v + 1 < vCount) {
                const nextV = cps[u][v + 1].point;
                lineVerts.push(pt[0], pt[1], pt[2], nextV[0], nextV[1], nextV[2]);
              }
            }
          }
          if (lineVerts.length > 0) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
            const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
              color: 0x06b6d4,
              transparent: true,
              opacity: 0.85,
              depthTest: false
            }));
            lines.position.copy(initialPos);
            lines.rotation.copy(initialRot);
            lines.scale.copy(initialScale);
            lines.renderOrder = 5;
            group.add(lines);
          }

          // 2. Control Point nodes (crisp screen-space 2D points + invisible pick proxies)
          const cpCoords: number[] = [];
          const cpColors: number[] = [];
          for (let u = 0; u < uCount; u++) {
            for (let v = 0; v < vCount; v++) {
              const cp = cps[u][v];
              const isSel = selSet.has(`${u},${v}`);
              const world = new THREE.Vector3(cp.point[0], cp.point[1], cp.point[2])
                .multiply(initialScale)
                .applyEuler(initialRot)
                .add(initialPos);
              cpCoords.push(world.x, world.y, world.z);
              if (isSel) {
                cpColors.push(0.96, 0.62, 0.04);
              } else {
                cpColors.push(0.02, 0.71, 0.83);
              }

              // Invisible picking proxy
              const pickDot = new THREE.Mesh(SHARED_PICK_GEO, SHARED_PICK_MAT);
              pickDot.scale.setScalar(0.045);
              pickDot.position.copy(world);
              pickDot.userData = { id: obj.id, isNurbsControlPoint: true, u, v };
              group.add(pickDot);
            }
          }

          if (cpCoords.length > 0) {
            const cpGeo = new THREE.BufferGeometry();
            cpGeo.setAttribute('position', new THREE.Float32BufferAttribute(cpCoords, 3));
            cpGeo.setAttribute('color', new THREE.Float32BufferAttribute(cpColors, 3));
            const cpPts = new THREE.Points(
              cpGeo,
              new THREE.PointsMaterial({
                size: 8.0,
                sizeAttenuation: false,
                map: VERTEX_DOT_TEXTURE ?? undefined,
                vertexColors: true,
                transparent: true,
                alphaTest: 0.05,
                depthTest: false,
              })
            );
            cpPts.renderOrder = 35;
            group.add(cpPts);
          }
        } else if (obj.nurbsCurve) {
          const curve = obj.nurbsCurve;
          const cps = curve.controlPoints;
          const selCPs = obj.selectedNurbsControlPoints?.length
            ? obj.selectedNurbsControlPoints
            : (obj.selectedNurbsControlPoint ? [obj.selectedNurbsControlPoint] : []);
          const selSet = new Set(selCPs.map(p => p.u));

          // 1. Control polygon lines
          const lineVerts: number[] = [];
          for (let i = 0; i < cps.length - 1; i++) {
            const p1 = cps[i].point;
            const p2 = cps[i + 1].point;
            lineVerts.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
          }
          if (curve.closed && cps.length > 2) {
            const p1 = cps[cps.length - 1].point;
            const p2 = cps[0].point;
            lineVerts.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
          }
          if (lineVerts.length > 0) {
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
            const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
              color: 0x06b6d4,
              transparent: true,
              opacity: 0.85,
              depthTest: false
            }));
            lines.position.copy(initialPos);
            lines.rotation.copy(initialRot);
            lines.scale.copy(initialScale);
            lines.renderOrder = 5;
            group.add(lines);
          }

          // 2. Control Point nodes (crisp screen-space 2D points + invisible pick proxies)
          const cpCurveCoords: number[] = [];
          const cpCurveColors: number[] = [];
          for (let i = 0; i < cps.length; i++) {
            const cp = cps[i];
            const isSel = selSet.has(i);
            const world = new THREE.Vector3(cp.point[0], cp.point[1], cp.point[2])
              .multiply(initialScale)
              .applyEuler(initialRot)
              .add(initialPos);
            cpCurveCoords.push(world.x, world.y, world.z);
            if (isSel) {
              cpCurveColors.push(0.96, 0.62, 0.04);
            } else {
              cpCurveColors.push(0.02, 0.71, 0.83);
            }

            const pickDot = new THREE.Mesh(SHARED_PICK_GEO, SHARED_PICK_MAT);
            pickDot.scale.setScalar(0.045);
            pickDot.position.copy(world);
            pickDot.userData = { id: obj.id, isNurbsControlPoint: true, u: i, v: 0 };
            group.add(pickDot);
          }

          if (cpCurveCoords.length > 0) {
            const cpCurveGeo = new THREE.BufferGeometry();
            cpCurveGeo.setAttribute('position', new THREE.Float32BufferAttribute(cpCurveCoords, 3));
            cpCurveGeo.setAttribute('color', new THREE.Float32BufferAttribute(cpCurveColors, 3));
            const cpCurvePts = new THREE.Points(
              cpCurveGeo,
              new THREE.PointsMaterial({
                size: 8.0,
                sizeAttenuation: false,
                map: VERTEX_DOT_TEXTURE ?? undefined,
                vertexColors: true,
                transparent: true,
                alphaTest: 0.05,
                depthTest: false,
              })
            );
            cpCurvePts.renderOrder = 35;
            group.add(cpCurvePts);
          }
        } else if (editMode === 'VERTEX' || viewMode === 'FACES_VERTICES') {
            const pointGeo = new THREE.BufferGeometry();
            const logicalVerts: number[] = [];
            const vertColors: number[] = [];
            const selectedSet = new Set(selectedVertexIndices);

            if (obj.vertices) {
              obj.vertices.forEach((v, i) => {
                const off = obj.vertexOffsets?.[i] || [0,0,0];
                logicalVerts.push(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
                const isSel = isSelected && selectedSet.has(i);
                if (isSel) {
                  // Vibrant selected vertex color (amber-gold / orange)
                  vertColors.push(0.96, 0.62, 0.04);
                } else if (viewMode === 'FACES_VERTICES' && !isSelected) {
                  // Cyan for unselected in faces+vertices mode
                  vertColors.push(0.02, 0.71, 0.83);
                } else {
                  // Clean crisp white with dark border
                  vertColors.push(1.0, 1.0, 1.0);
                }
              });
            }

            pointGeo.setAttribute('position', new THREE.Float32BufferAttribute(logicalVerts, 3));
            pointGeo.setAttribute('color', new THREE.Float32BufferAttribute(vertColors, 3));
            pointGeo.computeBoundingSphere();

            // Main screen-space 2D points (crisp 7.5px circular dot with outline, fixed screen size, zero GPU waste)
            const pts = new THREE.Points(pointGeo, SHARED_POINTS_MAT);
            pts.position.copy(initialPos);
            pts.rotation.copy(initialRot);
            pts.scale.copy(initialScale);
            pts.updateMatrixWorld(true);
            pts.renderOrder = 40;
            group.add(pts);

            if (isSelected || editMode === 'VERTEX') {
              vertexPointsRef.current = pts;
            }

            // If any vertices are selected, render a prominent highlighted cross/dot layer
            if (isSelected && selectedVertexIndices.length > 0 && obj.vertices) {
              const selVerts: number[] = [];
              selectedVertexIndices.forEach(idx => {
                if (idx < (obj.vertices?.length || 0)) {
                  const v = obj.vertices![idx];
                  const off = obj.vertexOffsets?.[idx] || [0,0,0];
                  selVerts.push(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
                }
              });
              if (selVerts.length > 0) {
                const selGeo = new THREE.BufferGeometry();
                selGeo.setAttribute('position', new THREE.Float32BufferAttribute(selVerts, 3));
                const selPts = new THREE.Points(selGeo, SHARED_SEL_POINTS_MAT);
                selPts.position.copy(initialPos);
                selPts.rotation.copy(initialRot);
                selPts.scale.copy(initialScale);
                selPts.updateMatrixWorld(true);
                selPts.renderOrder = 55;
                group.add(selPts);
              }
            }

            // Invisible picking proxies for fast click & drag detection (only for meshes with <= 300 vertices)
            const totalVerts = obj.vertices?.length || 0;
            if (totalVerts <= 300) {
              for (let i = 0; i < totalVerts; i++) {
                const pickDot = new THREE.Mesh(SHARED_PICK_GEO, SHARED_PICK_MAT);
                pickDot.scale.setScalar(0.045);
                const v = obj.vertices![i];
                const off = obj.vertexOffsets?.[i] || [0,0,0];
                const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2])
                  .multiply(initialScale)
                  .applyEuler(initialRot)
                  .add(initialPos);
                pickDot.position.copy(world);
                pickDot.userData = {
                  id: obj.id,
                  isVertexHandle: true,
                  vertexIndex: i
                };
                group.add(pickDot);
              }
            }
          } else if (editMode === 'EDGE' || editMode === 'FACE') {
            // Render subtle landmark dots only for small meshes (<= 60 vertices) to prevent lag
            if (obj.vertices && obj.vertices.length > 0 && obj.vertices.length <= 60) {
              const logicalVerts: number[] = [];
              obj.vertices.forEach((v, i) => {
                const off = obj.vertexOffsets?.[i] || [0,0,0];
                logicalVerts.push(v[0]+off[0], v[1]+off[1], v[2]+off[2]);
              });
              const pGeo = new THREE.BufferGeometry();
              pGeo.setAttribute('position', new THREE.Float32BufferAttribute(logicalVerts, 3));
              const pMat = new THREE.PointsMaterial({
                size: 6.0,
                sizeAttenuation: false,
                map: VERTEX_DOT_TEXTURE ?? undefined,
                color: 0x06b6d4,
                transparent: true,
                alphaTest: 0.05,
                depthTest: false,
              });
              const landmarkPts = new THREE.Points(pGeo, pMat);
              landmarkPts.position.copy(initialPos);
              landmarkPts.rotation.copy(initialRot);
              landmarkPts.scale.copy(initialScale);
              landmarkPts.renderOrder = 30;
              group.add(landmarkPts);
            }
          }

        if (editMode === 'FACE' && selectedFaceIndices.length > 0) {
          selectedFaceIndices.forEach(faceIdx => {
            const face = obj.faces[faceIdx];
            if (!face) return;
            const faceVerts: number[] = [];
            const perimeterVerts: THREE.Vector3[] = [];
            face.indices.forEach(vi => {
              const baseV = obj.vertices[vi];
              const off = obj.vertexOffsets?.[vi] || [0, 0, 0];
              perimeterVerts.push(new THREE.Vector3(baseV[0] + off[0], baseV[1] + off[1], baseV[2] + off[2]));
            });
            for (let i = 1; i < face.indices.length - 1; i++) {
              [perimeterVerts[0], perimeterVerts[i], perimeterVerts[i + 1]].forEach(p => {
                faceVerts.push(p.x, p.y, p.z);
              });
            }
            const fGeo = new THREE.BufferGeometry();
            fGeo.setAttribute('position', new THREE.Float32BufferAttribute(faceVerts, 3));
            fGeo.computeVertexNormals();
            const fm = new THREE.Mesh(fGeo, new THREE.MeshBasicMaterial({
              color: 0xf97316, transparent: true, opacity: 0.58, side: THREE.DoubleSide, 
              depthTest: true,
              polygonOffset: true,
              polygonOffsetFactor: -1.5,
              polygonOffsetUnits: -1.5
            }));
            fm.position.copy(initialPos);
            fm.rotation.copy(initialRot);
            fm.scale.copy(initialScale);
            fm.updateMatrixWorld(true);
            fm.renderOrder = 20;
            fm.userData.id = obj.id;
            group.add(fm);

            // Add perimeter boundary line for selected face
            if (perimeterVerts.length >= 3) {
              const loop = [...perimeterVerts, perimeterVerts[0]];
              const loopPoints: number[] = [];
              loop.forEach(p => loopPoints.push(p.x, p.y, p.z));
              const pGeo = new THREE.BufferGeometry();
              pGeo.setAttribute('position', new THREE.Float32BufferAttribute(loopPoints, 3));
              const pLine = new THREE.Line(pGeo, new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3, depthTest: false }));
              pLine.position.copy(initialPos);
              pLine.rotation.copy(initialRot);
              pLine.scale.copy(initialScale);
              pLine.updateMatrixWorld(true);
              pLine.renderOrder = 25;
              pLine.userData.id = obj.id;
              group.add(pLine);
            }
          });
        }

        if (editMode === 'EDGE' && selectedEdgeIndices.length > 0) {
          const edgePos: number[] = [];
          const edgeVertDots: THREE.Vector3[] = [];
          for (let i = 0; i < selectedEdgeIndices.length; i += 2) {
            const a = selectedEdgeIndices[i], b = selectedEdgeIndices[i + 1];
            if (obj.vertices && a < obj.vertices.length && b < obj.vertices.length) {
              const va = obj.vertices[a];
              const vb = obj.vertices[b];
              const offA = obj.vertexOffsets?.[a] || [0, 0, 0];
              const offB = obj.vertexOffsets?.[b] || [0, 0, 0];
              const pA = new THREE.Vector3(va[0] + offA[0], va[1] + offA[1], va[2] + offA[2]);
              const pB = new THREE.Vector3(vb[0] + offB[0], vb[1] + offB[1], vb[2] + offB[2]);
              edgePos.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
              edgeVertDots.push(pA, pB);
            }
          }
          if (edgePos.length) {
            const eGeo = new THREE.BufferGeometry();
            eGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
            const el = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 4, depthTest: false }));
            el.position.copy(initialPos);
            el.rotation.copy(initialRot);
            el.scale.copy(initialScale);
            el.updateMatrixWorld(true);
            el.renderOrder = 30;
            el.userData.id = obj.id;
            group.add(el);

            // Selected edge vertices marked with active dots
            edgeVertDots.forEach(p => {
              const dot = new THREE.Mesh(SHARED_VERTEX_GEO, SHARED_ACTIVE_MAT);
              dot.scale.setScalar(0.016);
              const world = p.clone().multiply(initialScale).applyEuler(initialRot).add(initialPos);
              dot.position.copy(world);
              dot.renderOrder = 35;
              dot.userData.id = obj.id;
              group.add(dot);
            });
          }
        }
      }

      // ── Invisible raycasting proxy ───────────────────────────────────────
      const pickMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible:false, side:THREE.DoubleSide }));
      pickMesh.position.copy(initialPos);
      pickMesh.rotation.copy(initialRot);
      pickMesh.scale.copy(initialScale);
      pickMesh.updateMatrixWorld(true);
      pickMesh.userData.id = obj.id;
      pickMesh.userData.faceMap = faceMap;
      pickMesh.userData.vertexMap = vertexMap;
      primitivesGroup.add(pickMesh);
    });
    return () => {
      isEffectCancelled = true;
      // Dispose of materials and textures to prevent memory leaks
      const disposeObject = (obj: THREE.Object3D) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach(mat => {
              mat.dispose();
              // Dispose of textures too
              Object.keys(mat).forEach(key => {
                const val = (mat as any)[key];
                if (val && val.isTexture) val.dispose();
              });
            });
          }
        }
        obj.children.forEach(disposeObject);
      };
      group.children.forEach(disposeObject);
      primitivesGroup.children.forEach(disposeObject);

      // Clean up deleted particle simulators
      const currentObjectIds = new Set(project.objects.map(o => o.id));
      particleSimulatorsRef.current.forEach((sim, id) => {
        if (!currentObjectIds.has(id)) {
          sim.dispose();
          particleSimulatorsRef.current.delete(id);
        }
      });
    };
  }, [project, viewMode, selectedObjectId, selectedObjectIds, editMode, selectedVertexIndices, selectedFaceIndices, selectedEdgeIndices, selectedGLTFMeshes, isolateGLTFSelection]);

  // Update transforms when currentTime changes
  useEffect(() => {
    project.objects.forEach(obj => {
      const mesh = meshesRef.current.get(obj.id);
      if (mesh) {
        const transform = getInterpolatedTransform(obj, currentTime);
        mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
        mesh.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
        mesh.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
        mesh.updateMatrixWorld(true);
      }
      
      // Update GLTF mixers
      const mixer = mixersRef.current.get(obj.id);
      if (mixer) {
        mixer.setTime(currentTime);
      }
    });
  }, [currentTime, project.objects]);

  // ── Drawing Logic ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!drawMode) {
        if (drawingMeshRef.current) {
            sceneRef.current?.remove(drawingMeshRef.current);
            drawingMeshRef.current.traverse((child) => {
              if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
                child.geometry?.dispose();
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => m?.dispose());
                } else {
                  child.material?.dispose();
                }
              }
            });
            drawingMeshRef.current = null;
        }
        drawingPointsRef.current = [];
        drawingHandlesRef.current = [];
        drawingObjectIdRef.current = null;
        drawingPreviewPointRef.current = null;
        return;
    }

    if (!containerRef.current || !sceneRef.current || !cameraRef.current) return;

    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;

    // Snap a world point to grid intersections (axes depend on view)
    const toV3 = (p: THREE.Vector3): [number,number,number] => {
      if (type === 'FRONT' || type === 'BACK') return [p.x, p.y, 0];
      if (type === 'LEFT' || type === 'RIGHT')  return [0,   p.y, p.z];
      return [p.x, 0, p.z]; // TOP, BOTTOM or PERSPECTIVE
    };

    const updatePreview = () => {
      if (!sceneRef.current) return;
      
      // Clean up previous preview
      if (drawingMeshRef.current) {
        sceneRef.current.remove(drawingMeshRef.current);
        drawingMeshRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m?.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
        drawingMeshRef.current = null;
      }

      const points = [...drawingPointsRef.current];
      const handles = [...drawingHandlesRef.current];
      
      if (drawingPreviewPointRef.current && !isDrawingHandleRef.current) {
        if (drawMode === 'rect' && points.length === 1) {
            const p1 = points[0];
            const p2 = drawingPreviewPointRef.current;
            if (type === 'FRONT' || type === 'BACK') {
              points.push(new THREE.Vector3(p2.x, p1.y, 0));
              points.push(new THREE.Vector3(p2.x, p2.y, 0));
              points.push(new THREE.Vector3(p1.x, p2.y, 0));
            } else if (type === 'LEFT' || type === 'RIGHT') {
              points.push(new THREE.Vector3(0, p1.y, p2.z));
              points.push(new THREE.Vector3(0, p2.y, p2.z));
              points.push(new THREE.Vector3(0, p2.y, p1.z));
            } else {
              points.push(new THREE.Vector3(p2.x, 0, p1.z));
              points.push(new THREE.Vector3(p2.x, 0, p2.z));
              points.push(new THREE.Vector3(p1.x, 0, p2.z));
            }
            points.push(p1);
        } else {
            points.push(drawingPreviewPointRef.current);
            if (drawMode === 'bezier') {
              handles.push({ out: [0,0,0], in: [0,0,0], broken: false });
            }
        }
      }

      if (points.length > 0) {
        const group = new THREE.Group();
        
        // ── Ortho / Axis Guide Lines ──
        const guideAxis = (drawingPreviewPointRef as any)._guideAxis as string | null;
        if (guideAxis && points.length >= 2) {
          const prev = points[points.length - 2];
          const curr = points[points.length - 1];
          const dir = curr.clone().sub(prev);
          const len = dir.length();
          if (len > 0.001) {
            dir.normalize();
            const guideP1 = prev.clone().sub(dir.clone().multiplyScalar(5));
            const guideP2 = curr.clone().add(dir.clone().multiplyScalar(5));
            const guideGeo = new THREE.BufferGeometry().setFromPoints([guideP1, guideP2]);
            const guideColor = guideAxis === 'X' ? 0xff4444 : guideAxis === 'Y' ? 0x44ff44 : guideAxis === 'Z' ? 0x4488ff : 0xffcc00;
            const guideMat = new THREE.LineDashedMaterial({
              color: guideColor,
              dashSize: 0.15,
              gapSize: 0.1,
              depthTest: false,
              transparent: true,
              opacity: 0.85
            });
            const guideLine = new THREE.Line(guideGeo, guideMat);
            guideLine.computeLineDistances();
            guideLine.renderOrder = 5;
            group.add(guideLine);

            // Escuadra 90° symbol (corner mark) at prev point
            if (points.length >= 3) {
              const prevPrev = points[points.length - 3];
              const seg1 = prev.clone().sub(prevPrev).normalize();
              const seg2 = curr.clone().sub(prev).normalize();
              const dot = Math.abs(seg1.dot(seg2));
              if (dot < 0.15) {
                // Perpendicular: Draw small 90° square at prev
                const cornerSize = 0.15;
                const c1 = prev.clone().add(seg1.clone().multiplyScalar(-cornerSize));
                const c2 = prev.clone().add(seg1.clone().multiplyScalar(-cornerSize)).add(seg2.clone().multiplyScalar(cornerSize));
                const c3 = prev.clone().add(seg2.clone().multiplyScalar(cornerSize));
                const sqGeo = new THREE.BufferGeometry().setFromPoints([c1, c2, c3]);
                const sqLine = new THREE.Line(sqGeo, new THREE.LineBasicMaterial({ color: 0x00ffcc, depthTest: false }));
                sqLine.renderOrder = 6;
                group.add(sqLine);
              }
            }
          }
        }

        let curveLine;
        if (handles.length > 0 && points.length > 1) {
            const allCurvePoints: THREE.Vector3[] = [];
            const count = points.length - 1;
            for (let i = 0; i < count; i++) {
              const p0 = points[i];
              const p3 = points[i+1];
              const hOut = handles[i]?.out ?? [0,0,0];
              const hIn = handles[i+1]?.in ?? [0,0,0];
              
              if (hOut[0] === 0 && hOut[1] === 0 && hOut[2] === 0 && 
                  hIn[0] === 0 && hIn[1] === 0 && hIn[2] === 0) {
                allCurvePoints.push(p0);
              } else {
                const p1 = p0.clone().add(new THREE.Vector3(...hOut));
                const p2 = p3.clone().add(new THREE.Vector3(...hIn));
                const seg = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
                const pts = seg.getPoints(20);
                if (allCurvePoints.length > 0) pts.shift();
                allCurvePoints.push(...pts);
              }
            }
            allCurvePoints.push(points[points.length - 1]);
            const geometry = new THREE.BufferGeometry().setFromPoints(allCurvePoints);
            curveLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffff00 }));
        } else {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            curveLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffff00 }));
        }
        group.add(curveLine);

        // Draw handles and anchors for visual feedback (Ultra-compact, crisp and lightweight)
        points.forEach((p, i) => {
          // Scale handle dots gently by camera distance so they remain micro-sharp and never oversized
          const camDist = cameraRef.current instanceof THREE.OrthographicCamera
            ? 1 / Math.max(0.01, (cameraRef.current as THREE.OrthographicCamera).zoom)
            : cameraRef.current?.position.distanceTo(p) ?? 5;
          const anchorR = Math.min(0.020, Math.max(0.007, camDist * 0.0016));
          const handleR = Math.min(0.014, Math.max(0.005, camDist * 0.0011));

          const isFirst = i === 0;
          const isLastCommitted = i === drawingPointsRef.current.length - 1;
          const anchorMat = (isFirst && points.length > 1)
            ? SHARED_START_MAT
            : isLastCommitted
            ? SHARED_ACTIVE_MAT
            : SHARED_WHITE_MAT;

          const anchor = new THREE.Mesh(SHARED_VERTEX_GEO, anchorMat);
          anchor.scale.setScalar(anchorR);
          anchor.position.copy(p);
          group.add(anchor);

          if (drawMode === 'bezier' && handles[i]) {
            const h = handles[i];
            const outVec = new THREE.Vector3(...h.out);
            const hasOut = outVec.length() > 0.001;
            if (hasOut) {
              const outPos = p.clone().add(outVec);
              const lineGeo = new THREE.BufferGeometry().setFromPoints([p, outPos]);
              group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x4488ff, depthTest: false })));
              const dot = new THREE.Mesh(SHARED_VERTEX_GEO, SHARED_OUT_MAT);
              dot.scale.setScalar(handleR);
              dot.position.copy(outPos);
              group.add(dot);
            }
            const inVec = new THREE.Vector3(...h.in);
            const hasIn = inVec.length() > 0.001;
            if (hasIn) {
              const inPos = p.clone().add(inVec);
              const lineGeo = new THREE.BufferGeometry().setFromPoints([p, inPos]);
              group.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x44cc44, depthTest: false })));
              const dot = new THREE.Mesh(SHARED_VERTEX_GEO, SHARED_IN_MAT);
              dot.scale.setScalar(handleR);
              dot.position.copy(inPos);
              group.add(dot);
            }
          }
        });

        // ── Snap indicator: subtle green ring when snapping to start or endpoint ──
        if ((drawingPreviewPointRef as any)._snapping && drawingPreviewPointRef.current) {
          const ring = new THREE.Mesh(SHARED_SNAP_RING_GEO, SHARED_SNAP_MAT);
          ring.position.copy(drawingPreviewPointRef.current);
          ring.renderOrder = 10;
          group.add(ring);

          const innerDot = new THREE.Mesh(SHARED_VERTEX_GEO, SHARED_SNAP_DOT_MAT);
          innerDot.scale.setScalar(0.012);
          innerDot.position.copy(drawingPreviewPointRef.current);
          innerDot.renderOrder = 11;
          group.add(innerDot);
        }

        drawingMeshRef.current = group as any;
        sceneRef.current.add(group);
      }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Screen-space endpoint snapping
    // Snaps to the start of the current stroke or to any open shape endpoint
    // ─────────────────────────────────────────────────────────────────────────
    type SnapResult = { objId: string; anchorIdx: number; worldPos: THREE.Vector3; isOwnStart: boolean };

    const findSnapEndpoint = (clientX: number, clientY: number, pxThresh = 24): SnapResult | null => {
      const cam = cameraRef.current;
      const rnd = rendererRef.current;
      if (!cam || !rnd) return null;

      const rect = rnd.domElement.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const w  = rect.width;
      const h  = rect.height;

      let best: SnapResult | null = null;
      let bestDist = pxThresh;

      // 1. Check in-progress stroke's first point (start point to close/weld)
      if (drawingPointsRef.current.length >= 2) {
        const firstPt = drawingPointsRef.current[0];
        const ndc = firstPt.clone().project(cam);
        if (ndc.z <= 1) {
          const px = (ndc.x * 0.5 + 0.5) * w;
          const py = (ndc.y * -0.5 + 0.5) * h;
          const d = Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
          if (d < bestDist) {
            bestDist = d;
            best = { objId: drawingObjectIdRef.current || '__CURRENT__', anchorIdx: 0, worldPos: firstPt.clone(), isOwnStart: true };
          }
        }
      }

      // 2. Check all open SHAPE objects in project
      for (const obj of projectRef.current.objects) {
        if (obj.type !== 'SHAPE' || obj.parameters.closed || obj.vertices.length < 1) continue;

        const _interp = getInterpolatedTransform(obj, currentTime);
        const mat4 = new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(_interp.position),
          new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
          new THREE.Vector3().fromArray(_interp.scale),
        );

        const checkVertex = (vi: number) => {
          const v   = obj.vertices[vi];
          const off = obj.vertexOffsets?.[vi] ?? [0, 0, 0];
          const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
          const ndc   = world.clone().project(cam);
          if (ndc.z > 1) return; // behind camera
          const px = (ndc.x *  0.5 + 0.5) * w;
          const py = (ndc.y * -0.5 + 0.5) * h;
          const d  = Math.sqrt((px - sx) ** 2 + (py - sy) ** 2);
          if (d < bestDist) {
            bestDist = d;
            const isOwnStart = (obj.id === drawingObjectIdRef.current && vi === 0) || (drawingObjectIdRef.current === '__CURRENT__' && vi === 0);
            best = { objId: obj.id, anchorIdx: vi, worldPos: world, isOwnStart };
          }
        };

        checkVertex(0);
        if (obj.vertices.length > 1) checkVertex(obj.vertices.length - 1);
      }

      return best;
    };

    // Shared finish-stroke helper
    const finishStroke = (snapResult: SnapResult | null) => {
      let pts  = [...drawingPointsRef.current];
      let hnds = [...drawingHandlesRef.current];

      let closeShape = false;

      if (snapResult) {
        // If snapping to the start point of this stroke or shape -> close and weld
        if (snapResult.isOwnStart || snapResult.objId === '__CURRENT__' || (pts.length > 0 && pts[0].distanceTo(snapResult.worldPos) < 0.35)) {
          closeShape = true;
          // Drop trailing points if user clicked near start point
          if (pts.length >= 2 && pts[pts.length - 1].distanceTo(pts[0]) < 0.25) {
            pts.pop();
            hnds.pop();
          }
        } else {
          pts.push(snapResult.worldPos.clone());
          hnds.push({ out: [0,0,0], in: [0,0,0], broken: false });
        }
      }

      // Auto-weld/close if last point is within 0.35 units of start point
      if (!closeShape && pts.length >= 3 && pts[0].distanceTo(pts[pts.length - 1]) < 0.35) {
        pts.pop();
        hnds.pop();
        closeShape = true;
      }

      if (pts.length < 2) {
        drawingPointsRef.current       = [];
        drawingHandlesRef.current      = [];
        drawingObjectIdRef.current     = null;
        drawingPreviewPointRef.current = null;
        updatePreview();
        useStore.getState().setDrawMode(null);
        return;
      }

      const vertices = pts.map(p => toV3(p));
      const handles  = hnds;

      if (drawingObjectIdRef.current && drawingObjectIdRef.current !== '__CURRENT__') {
        const existObj = projectRef.current.objects.find(o => o.id === drawingObjectIdRef.current);
        useStore.getState().updateObject(drawingObjectIdRef.current, {
          vertices,
          bezierHandles: handles,
          parameters: { ...existObj?.parameters, closed: closeShape, shapeType: drawMode as any },
        } as any);
      } else {
        addShape(drawMode as 'line' | 'bezier', vertices, closeShape, handles);
      }

      drawingPointsRef.current       = [];
      drawingHandlesRef.current      = [];
      drawingObjectIdRef.current     = null;
      drawingPreviewPointRef.current = null;
      updatePreview();
      useStore.getState().setDrawMode(null);
      useStore.getState().saveHistory();
    };

    finishStrokeRef.current = finishStroke;
    updatePreviewRef.current = updatePreview;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      // ── SILUETA mode ──────────────────────────────────────────────────────
      const isSiluetaActive = !!(silueta.activePlane && 
        silueta.activePlane.toUpperCase() === type.toUpperCase()
      );

      if (isSiluetaActive) {
        // Force disable controls to be absolutely sure
        if (controlsRef.current) controlsRef.current.enabled = false;
        
        e.stopPropagation();
        e.preventDefault();
        
        const pointRaw = getPoint(e, true);
        if (!pointRaw) return;

        const planeKey = silueta.activePlane!;
        const contour = silueta[planeKey] || [];
        
        const u = (silueta.activePlane === 'left' || silueta.activePlane === 'right') ? pointRaw.z : pointRaw.x;
        const v = (silueta.activePlane === 'top' || silueta.activePlane === 'bottom') ? -pointRaw.z : pointRaw.y;
        
        // Find nearest point (using unsnapped coords for precision)
        let nearestIdx = -1;
        let minDist = 0.25; 
        contour.forEach((p, i) => {
          const d = Math.hypot(u - p[0], v - p[1]);
          if (d < minDist) { minDist = d; nearestIdx = i; }
        });

        // Deletion with Alt key
        if (e.altKey && nearestIdx >= 0) {
          const next = [...contour];
          next.splice(nearestIdx, 1);
          setSilueta({ [planeKey]: next });
          return;
        }

        if (nearestIdx >= 0) {
          // Drag existing point
          gizmoStateRef.current.activeAxis = 'FREE';
          gizmoStateRef.current.dragAnchorIdx = nearestIdx;
          isDraggingRef.current = true;
          try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
        } else {
          // Use snapped point for adding/inserting
          const point = getPoint(e);
          if (!point) return;
          const su = (silueta.activePlane === 'left' || silueta.activePlane === 'right') ? point.z : point.x;
          const sv = (silueta.activePlane === 'top' || silueta.activePlane === 'bottom') ? -point.z : point.y;

          // Try to insert point on a segment
          let insertIdx = -1;
          let minSegDist = 0.15;
          for (let i = 0; i < contour.length; i++) {
            const p1 = contour[i];
            const p2 = contour[(i + 1) % contour.length];
            
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) continue;
            
            let t = ((su - p1[0]) * dx + (sv - p1[1]) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            
            const projX = p1[0] + t * dx;
            const projY = p1[1] + t * dy;
            const d = Math.hypot(su - projX, sv - projY);
            
            if (d < minSegDist) {
              minSegDist = d;
              insertIdx = i + 1;
            }
          }

          if (insertIdx >= 0) {
            const next = [...contour];
            next.splice(insertIdx, 0, [su, sv]);
            setSilueta({ [planeKey]: next });
            gizmoStateRef.current.activeAxis = 'FREE';
            gizmoStateRef.current.dragAnchorIdx = insertIdx;
            isDraggingRef.current = true;
            try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
          } else {
            const next = [...contour, [su, sv] as [number, number]];
            setSilueta({ [planeKey]: next });
            gizmoStateRef.current.activeAxis = 'FREE';
            gizmoStateRef.current.dragAnchorIdx = next.length - 1;
            isDraggingRef.current = true;
            try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
          }
        }
        return;
      }

      if (!drawMode) return;

      // Stop OrbitControls from seeing this event (we're in capture phase)
      e.stopPropagation();
      e.preventDefault();
      const now = Date.now();
      const last = (onPointerDown as any)._lastMs as number ?? 0;
      (onPointerDown as any)._lastMs = now;
      if (now - last < 260) { (onPointerDown as any)._skipOne = true; return; }
      if ((onPointerDown as any)._skipOne) { (onPointerDown as any)._skipOne = false; return; }

      // ── RECT mode ─────────────────────────────────────────────────────────
      if (drawMode === 'rect') {
        const point = getPoint(e);
        if (!point) return;
        if (drawingPointsRef.current.length === 0) {
          drawingPointsRef.current.push(point);
        } else {
          const p1 = drawingPointsRef.current[0];
          const p2 = point;
          let vertices: [number,number,number][];
          if (type === 'FRONT' || type === 'BACK')     vertices = [[p1.x,p1.y,0],[p2.x,p1.y,0],[p2.x,p2.y,0],[p1.x,p2.y,0]];
          else if (type === 'LEFT' || type === 'RIGHT') vertices = [[0,p1.y,p1.z],[0,p1.y,p2.z],[0,p2.y,p2.z],[0,p2.y,p1.z]];
          else                      vertices = [[p1.x,0,p1.z],[p2.x,0,p1.z],[p2.x,0,p2.z],[p1.x,0,p2.z]];
          addShape('rect', vertices, true);
          drawingPointsRef.current       = [];
          drawingHandlesRef.current      = [];
          drawingPreviewPointRef.current = null;
          updatePreview();
        }
        return;
      }

      // ── LINE / BEZIER mode ────────────────────────────────────────────────
      const snap = findSnapEndpoint(e.clientX, e.clientY);

      // ── CASE A: Nothing drawn yet — start from a snap point OR free click ──
      if (drawingPointsRef.current.length === 0) {
        if (snap) {
          // Continue from an existing endpoint: load the shape into drawing buffers
          const existObj = projectRef.current.objects.find(o => o.id === snap.objId)!;
          drawingObjectIdRef.current = snap.objId;

          const verts = existObj.vertices.map(v => new THREE.Vector3(...v));
          const handles: BezierHandle[] = existObj.bezierHandles
            ? existObj.bezierHandles.map(h => ({ out: [...h.out] as [number,number,number], in: [...h.in] as [number,number,number], broken: h.broken }))
            : existObj.vertices.map(() => ({ out: [0,0,0] as [number,number,number], in: [0,0,0] as [number,number,number], broken: false }));

          if (snap.anchorIdx === 0) {
            // Clicked start → reverse so we draw from the tail
            drawingPointsRef.current  = [...verts].reverse();
            drawingHandlesRef.current = [...handles].reverse().map(h => ({
              out: [...h.in]  as [number,number,number],
              in:  [...h.out] as [number,number,number],
              broken: h.broken,
            }));
          } else {
            drawingPointsRef.current  = verts;
            drawingHandlesRef.current = handles;
          }
          updatePreview();
          return;
        }

        // Free first point
        const point = getPoint(e);
        if (!point) return;
        drawingPointsRef.current.push(point);
        drawingHandlesRef.current.push({ out: [0,0,0], in: [0,0,0], broken: false });
        if (drawMode === 'bezier') {
          isDrawingHandleRef.current = true;
          // Capture pointer: mousemove keeps firing even outside the canvas
          try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
        }
        return;
      }

      // ── CASE B: Stroke in progress — snap click closes/connects, else add point ──
      if (snap) {
        // Need at least 2 committed points before we can close/connect
        if (drawingPointsRef.current.length >= 1) {
          finishStroke(snap);
          return;
        }
      }

      // Free click — add a regular point
      const point = getPoint(e);
      if (!point) return;

      drawingPointsRef.current.push(point);
      drawingHandlesRef.current.push({ out: [0,0,0], in: [0,0,0], broken: false });
      if (drawMode === 'bezier') {
        // Auto-init: set a small handle in the direction of travel so it's
        // immediately visible and the user can refine by dragging.
        const lastIdx = drawingPointsRef.current.length - 1;
        if (lastIdx >= 1) {
          const prev = drawingPointsRef.current[lastIdx - 1];
          const curr = drawingPointsRef.current[lastIdx];
          const dir = curr.clone().sub(prev);
          const len = dir.length();
          if (len > 0.001) {
            dir.normalize().multiplyScalar(len * 0.35);
            drawingHandlesRef.current[lastIdx].out = [dir.x, dir.y, dir.z];
            drawingHandlesRef.current[lastIdx].in  = [-dir.x, -dir.y, -dir.z];
            // Also smooth previous point outHandle toward this direction
            drawingHandlesRef.current[lastIdx - 1].out = [dir.x, dir.y, dir.z];
            if (!drawingHandlesRef.current[lastIdx - 1].broken) {
              drawingHandlesRef.current[lastIdx - 1].in = [-dir.x, -dir.y, -dir.z];
            }
          }
        }
        isDrawingHandleRef.current = true;
        try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      // ── SILUETA mode ──────────────────────────────────────────────────────
      const isSiluetaActive = !!(silueta.activePlane && 
        silueta.activePlane.toUpperCase() === type.toUpperCase()
      );

      if (isSiluetaActive && gizmoStateRef.current.activeAxis === 'FREE' && gizmoStateRef.current.dragAnchorIdx !== undefined) {
        e.stopPropagation();
        e.preventDefault();
        const point = getPoint(e);
        if (!point) return;
        const planeKey = silueta.activePlane!;
        const contour = [...(silueta[planeKey] || [])];
        const u = (silueta.activePlane === 'left' || silueta.activePlane === 'right') ? point.z : point.x;
        const v = (silueta.activePlane === 'top' || silueta.activePlane === 'bottom') ? -point.z : point.y;
        contour[gizmoStateRef.current.dragAnchorIdx] = [u, v];
        setSilueta({ [planeKey]: contour });
        return;
      }

      if (isDrawingHandleRef.current && drawMode === 'bezier') {
        e.stopPropagation();
        const point = getPoint(e);
        if (!point) return;
        const lastIdx = drawingPointsRef.current.length - 1;
        const anchor  = drawingPointsRef.current[lastIdx];
        const diff    = point.clone().sub(anchor);
        drawingHandlesRef.current[lastIdx].out = [diff.x, diff.y, diff.z];
        drawingHandlesRef.current[lastIdx].in  = [-diff.x, -diff.y, -diff.z];
        updatePreview();
        return;
      }

      if (!drawMode) return;
      e.stopPropagation();

      // Show snap-to-endpoint highlight, or plain cursor position
      const snap = findSnapEndpoint(e.clientX, e.clientY, 22);
      if (snap) {
        drawingPreviewPointRef.current = snap.worldPos.clone();
        (drawingPreviewPointRef as any)._snapping = true;
      } else {
        const point = getPoint(e);
        if (point) drawingPreviewPointRef.current = point;
        (drawingPreviewPointRef as any)._snapping = false;
      }
      updatePreview();
    };

    const onPointerUp = (_e: PointerEvent) => {
      // ── SILUETA mode ──────────────────────────────────────────────────────
      if (gizmoStateRef.current.activeAxis === 'FREE') {
        _e.stopPropagation();
        gizmoStateRef.current.activeAxis = null;
        gizmoStateRef.current.dragAnchorIdx = undefined;
        isDraggingRef.current = false;
        try { (_e.target as Element).releasePointerCapture(_e.pointerId); } catch {}
        
        // Restore controls state based on global tool state
        if (controlsRef.current) {
          const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
            silueta.activePlane.toUpperCase() === type.toUpperCase()
          );
          controlsRef.current.enabled = !drawMode && !isSiluetaActiveInThisViewport;
        }
        return;
      }

      if (!drawMode) return;
      _e.stopPropagation();

      if (isDrawingHandleRef.current) {
        isDrawingHandleRef.current = false;
        updatePreview();
      }
    };

    const onDblClick = (_e: PointerEvent) => {
      if ((drawMode === 'line' || drawMode === 'bezier') && drawingPointsRef.current.length > 1) {
        // Reset double-click guard
        (onPointerDown as any)._lastMs  = 0;
        (onPointerDown as any)._skipOne = false;

        const pts  = [...drawingPointsRef.current];
        const hnds = [...drawingHandlesRef.current];

        // Remove duplicate last point if it's too close to the previous (dblclick artifact)
        if (pts.length >= 2 && pts[pts.length-1].distanceTo(pts[pts.length-2]) < 0.15) {
          pts.pop();
          hnds.pop();
        }
        if (pts.length < 2) {
          drawingPointsRef.current       = [];
          drawingHandlesRef.current      = [];
          drawingObjectIdRef.current     = null;
          drawingPreviewPointRef.current = null;
          updatePreview();
          return;
        }
        // Temporarily swap refs so finishStroke reads the cleaned pts
        drawingPointsRef.current  = pts;
        drawingHandlesRef.current = hnds;
        finishStroke(null); // no snap — just finish open
      }
    };

    const handleCustomFinish = () => {
      const pts = drawingPointsRef.current;
      if (pts.length >= 2) {
        const first = pts[0];
        finishStroke({ objId: '__CURRENT__', anchorIdx: 0, worldPos: first, isOwnStart: true });
      }
    };

    const handleCustomCancel = () => {
      drawingPointsRef.current = [];
      drawingHandlesRef.current = [];
      drawingObjectIdRef.current = null;
      drawingPreviewPointRef.current = null;
      updatePreview();
    };

    window.addEventListener('csg-finish-drawing-stroke', handleCustomFinish);
    window.addEventListener('csg-cancel-drawing-stroke', handleCustomCancel);

    // ── Register in CAPTURE phase ──────────────────────────────────────────
    // OrbitControls registers its listeners in bubble phase (default).
    // By using capture:true here our handlers run FIRST, and calling
    // e.stopPropagation() prevents OrbitControls from ever seeing the event.
    // This fixes: Bézier handles dragging the camera, and points placed at wrong coords.
    const CAPTURE = { capture: true } as const;
    canvas.addEventListener('pointerdown', onPointerDown, CAPTURE);
    canvas.addEventListener('pointermove', onPointerMove, CAPTURE);
    canvas.addEventListener('pointerup',   onPointerUp,   CAPTURE);
    canvas.addEventListener('dblclick',    onDblClick,    CAPTURE);

    return () => {
      window.removeEventListener('csg-finish-drawing-stroke', handleCustomFinish);
      window.removeEventListener('csg-cancel-drawing-stroke', handleCustomCancel);
      canvas.removeEventListener('pointerdown', onPointerDown, CAPTURE);
      canvas.removeEventListener('pointermove', onPointerMove, CAPTURE);
      canvas.removeEventListener('pointerup',   onPointerUp,   CAPTURE);
      canvas.removeEventListener('dblclick',    onDblClick,    CAPTURE);
    };
  }, [drawMode, addShape, type, silueta, setSilueta]);

  // ── 5. Interaction Handlers ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const getAxisHit = (mx: number, my: number): string | null => {
      if (!selectedObjectId && !selectedLightId && !selectedCameraId) return null;
      const selObj = selectedObjectId ? projectRef.current.objects.find(o=>o.id===selectedObjectId) : null;
      const selLight = selectedLightId ? projectRef.current.lights.find(l=>l.id===selectedLightId) : null;
      const selCam = selectedCameraId ? projectRef.current.cameras?.find(c=>c.id===selectedCameraId) : null;
      
      if (!selObj && !selLight && !selCam) return null;
      const camera=cameraRef.current, renderer=rendererRef.current;
      if (!camera||!renderer) return null;
      const w=renderer.domElement.clientWidth, h=renderer.domElement.clientHeight;

      let objPos = new THREE.Vector3();
      const isNurbsCpSelected = !!(
        selObj &&
        (selObj.nurbsSurface || selObj.nurbsCurve) &&
        (selObj.selectedNurbsControlPoint || selObj.selectedNurbsControlPoints?.length)
      );
      if (selLight) {
        objPos.fromArray(selLight.transform.position);
      } else if (selCam) {
        const evalCam = evaluateCameraTransform(selCam, projectRef.current.objects, currentTime, projectRef.current.duration || 5);
        objPos.copy(evalCam.position);
      } else if (selObj) {
        if (isNurbsCpSelected) {
          const selCPs = selObj.selectedNurbsControlPoints?.length
            ? selObj.selectedNurbsControlPoints
            : (selObj.selectedNurbsControlPoint ? [selObj.selectedNurbsControlPoint] : []);
          const centroidLocal = new THREE.Vector3();
          let validCount = 0;
          selCPs.forEach(cp => {
            let pt: [number, number, number] | null = null;
            if (selObj.nurbsSurface) {
              pt = selObj.nurbsSurface.controlPoints[cp.u]?.[cp.v ?? 0]?.point || null;
            } else if (selObj.nurbsCurve) {
              pt = selObj.nurbsCurve.controlPoints[cp.u]?.point || null;
            }
            if (pt) {
              centroidLocal.add(new THREE.Vector3(...pt));
              validCount++;
            }
          });
          if (validCount > 0) centroidLocal.divideScalar(validCount);

          const mesh = getObjectMesh(selectedObjectId);
          if (mesh && validCount > 0) {
            objPos = centroidLocal.applyMatrix4(mesh.matrixWorld);
          } else if (validCount > 0) {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            objPos = centroidLocal
              .multiply(new THREE.Vector3(..._interp.scale))
              .applyEuler(new THREE.Euler(..._interp.rotation))
              .add(new THREE.Vector3(..._interp.position));
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            objPos.fromArray(_interp.position);
          }
        } else if (editMode==='OBJECT') {
          const mesh = getObjectMesh(selectedObjectId);
          if (mesh) {
            mesh.getWorldPosition(objPos);
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            objPos.fromArray(_interp.position);
          }
        } else {
          if (!selectedVertexIndices.length) return null;
          const mesh = getObjectMesh(selectedObjectId);

          const isShape = selObj.type === 'SHAPE';
          const isBezier = isShape && selObj.parameters?.shapeType === 'bezier';

          if (isBezier && selectedVertexIndices.some(idx => idx >= 10000)) {
            const idx = selectedVertexIndices[0];
            const anchorIdx = idx >= 20000 ? idx - 20000 : idx - 10000;
            const side = idx >= 20000 ? 'in' : 'out';
            const anchor = new THREE.Vector3(...selObj.vertices[anchorIdx]);
            const handleRel = new THREE.Vector3(...(selObj.bezierHandles?.[anchorIdx]?.[side] ?? [0,0,0]));
            if (mesh) {
              objPos = anchor.add(handleRel).applyMatrix4(mesh.matrixWorld);
            } else {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              objPos = anchor.add(handleRel)
                .multiply(new THREE.Vector3(..._interp.scale))
                .applyEuler(new THREE.Euler(..._interp.rotation))
                .add(new THREE.Vector3(..._interp.position));
            }
          } else {
            const centroid = new THREE.Vector3();
            let count = 0;
            selectedVertexIndices.forEach(idx => {
              if (selObj.vertices && idx < selObj.vertices.length) {
                const v = selObj.vertices[idx];
                const off = selObj.vertexOffsets?.[idx] ?? [0,0,0];
                centroid.add(new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]));
                count++;
              }
            });
            if (count > 0) {
              centroid.divideScalar(count);
              if (mesh) {
                objPos = centroid.applyMatrix4(mesh.matrixWorld);
              } else {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                objPos = centroid
                  .multiply(new THREE.Vector3(..._interp.scale))
                  .applyEuler(new THREE.Euler(..._interp.rotation))
                  .add(new THREE.Vector3(..._interp.position));
              }
            } else {
              return null;
            }
          }
        }
      }

      const layout = computeGizmoLayout(objPos, camera, w, h, transformSpace, selObj, isNurbsCpSelected ? 50 : undefined, transformMode);
      if (!layout) return null;
      const { cx, cy, AXIS_LEN, dirs, rotArcs } = layout;
      const distCenter = Math.sqrt((mx - cx)**2 + (my - cy)**2);

      // 1. Center FREE handle (small clean dot)
      if (distCenter < (isNurbsCpSelected ? 14 : 12)) return 'FREE';

      // 2. Check Scale Cubes FIRST before Translation Arrow shafts (disabled when a NURBS control point is selected)
      if (!isNurbsCpSelected && (transformMode === 'scale' || transformMode === 'universal')) {
        const scaleDistRatio = transformMode === 'universal' ? 0.72 : 1.0;
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const cubeX = cx + d.nx * scaleDistRatio;
          const cubeY = cy + d.ny * scaleDistRatio;
          // Hit radius for scale cube box
          if (Math.sqrt((mx - cubeX)**2 + (my - cubeY)**2) < 20) {
            return `SCALE_${axis}`;
          }
        }
      }

      // 3. Check Axis Translation Arrows / Arrowheads / Badges (Translate / Universal)
      if (isNurbsCpSelected || transformMode === 'translate' || transformMode === 'universal') {
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const tipX = cx + d.nx, tipY = cy + d.ny;
          const labelDistRatio = 1.22;
          const badgeX = cx + d.nx * labelDistRatio;
          const badgeY = cy + d.ny * labelDistRatio;

          // Tip or badge click
          if (Math.sqrt((mx - tipX)**2 + (my - tipY)**2) < 20 || Math.sqrt((mx - badgeX)**2 + (my - badgeY)**2) < 18) {
            return axis;
          }

          // Shaft check
          const bx = tipX - cx, by = tipY - cy, bLen = Math.sqrt(bx*bx + by*by);
          if (bLen >= 5) {
            const t = Math.max(0, Math.min(1, ((mx - cx)*bx + (my - cy)*by)/(bLen * bLen)));
            const dist = Math.sqrt((mx - cx - t*bx)**2 + (my - cy - t*by)**2);
            if (dist < 15 && t > 0.15) return axis;
          }
        }
      }

      // 4. Check 2D Translation Planes for easy corner grabbing
      if (isNurbsCpSelected || transformMode === 'translate' || transformMode === 'universal') {
        const checkPlane = (a1: string, a2: string, planeName: string) => {
          const d1 = dirs[a1], d2 = dirs[a2];
          if (!d1 || !d2) return false;
          const l1 = Math.sqrt(d1.nx*d1.nx + d1.ny*d1.ny);
          const l2 = Math.sqrt(d2.nx*d2.nx + d2.ny*d2.ny);
          if (l1 < 5 || l2 < 5) return false;

          // Check coordinate in 2D basis
          const u = ((mx - cx) * d1.nx + (my - cy) * d1.ny) / (l1 * l1);
          const v = ((mx - cx) * d2.nx + (my - cy) * d2.ny) / (l2 * l2);
          if (u >= 0.10 && u <= 0.50 && v >= 0.10 && v <= 0.50) return true;

          const poly = [
            {x: cx + d1.nx*0.12, y: cy + d1.ny*0.12},
            {x: cx + d1.nx*0.48, y: cy + d1.ny*0.48},
            {x: cx + (d1.nx + d2.nx)*0.48, y: cy + (d1.ny + d2.ny)*0.48},
            {x: cx + d2.nx*0.48, y: cy + d2.ny*0.48},
            {x: cx + d2.nx*0.12, y: cy + d2.ny*0.12}
          ];
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            const intersect = ((yi > my) !== (yj > my)) && (mx < (xj - xi) * (my - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }
          return inside;
        };

        if (checkPlane('X', 'Y', 'XY')) return 'XY';
        if (checkPlane('Y', 'Z', 'YZ')) return 'YZ';
        if (checkPlane('X', 'Z', 'XZ')) return 'XZ';
      }

      // 5. Check Rotation Arcs & Spheres (disabled when a NURBS control point is selected)
      if (!isNurbsCpSelected && (transformMode === 'rotate' || transformMode === 'universal')) {
        for (const rotAxis of ['Z', 'X', 'Y']) {
          const arc = rotArcs[rotAxis];
          if (!arc) continue;
          if (Math.sqrt((mx - arc.handlePt.x)**2 + (my - arc.handlePt.y)**2) < 14) {
            return `ROT_${rotAxis}`;
          }
          for (const p of arc.pts) {
            if (Math.sqrt((mx - p.x)**2 + (my - p.y)**2) < 8) {
              return `ROT_${rotAxis}`;
            }
          }
        }
      }

      // 6. Outer View Ring (disabled when a NURBS control point is selected)
      if (!isNurbsCpSelected) {
        const OUTER_R = AXIS_LEN * 1.15;
        if (Math.abs(distCenter - OUTER_R) < 14) {
          return transformMode === 'scale' ? 'SCALE_UNIFORM' : 'ROT_VIEW';
        }
      }

      return null;
    };

    const handleMouseDown = (event: PointerEvent) => {
      if (event.button === 2) {
        // Right click expansion: first try to select what's under the cursor if nothing is selected or if we want to expand from here
        // We'll let the normal raycasting happen but trigger expansion after
        (mouseRef.current as any)._pendingExpand = true;
        // Don't return yet, let it raycast to select the element under the cursor
      }
      // ── Silueta interaction ───────────────────────────────────────────────
      const siluetaNow = siluetaRef.current;
      const isSiluetaViewport = !!(siluetaNow.activePlane &&
        siluetaNow.activePlane === type.toLowerCase());
      if (isSiluetaViewport && event.button === 0) {
        const planeKey = type.toLowerCase() as 'front'|'back'|'left'|'right'|'top'|'bottom';
        const contour = siluetaNow[planeKey] || [];
        if (!rendererRef.current || !cameraRef.current) return;
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

        // Hit-test existing silueta point spheres
        const siluetaHits = raycasterRef.current.intersectObjects(siluetaGroupRef.current.children, false);
        const sphereHit = siluetaHits.find(h => (h.object as THREE.Mesh).userData?.siluetaIdx !== undefined);

        if (sphereHit) {
          const idx = (sphereHit.object as THREE.Mesh).userData.siluetaIdx as number;
          if (event.altKey) {
            // Alt+click → delete point
            const newContour = contour.filter((_, i) => i !== idx);
            setSilueta({ [planeKey]: newContour });
          } else {
            // Start drag
            siluetaDragRef.current = { planeKey, pointIndex: idx };
            if (controlsRef.current) controlsRef.current.enabled = false;
          }
          event.stopPropagation(); event.preventDefault();
          return;
        }

        // Click on empty space → add / insert point (ignore Alt)
        if (!event.altKey) {
          const worldPt = new THREE.Vector3(mouseRef.current.x, mouseRef.current.y, 0)
            .unproject(cameraRef.current);
          let u: number, v: number;
          if (planeKey === 'front' || planeKey === 'back')     { u = worldPt.x; v =  worldPt.y; }
          else if (planeKey === 'left' || planeKey === 'right') { u = worldPt.z; v =  worldPt.y; }
          else                                                  { u = worldPt.x; v = -worldPt.z; }
          u = Math.max(-1, Math.min(1, u));
          v = Math.max(-1, Math.min(1, v));

          // Insert near closest segment, or append
          let bestIdx = contour.length;
          if (contour.length >= 2) {
            let bestDist = Infinity;
            for (let k = 0; k < contour.length; k++) {
              const k1 = (k + 1) % contour.length;
              const ax = contour[k][0], ay = contour[k][1];
              const bx = contour[k1][0], by = contour[k1][1];
              const ddx = bx - ax, ddy = by - ay;
              const len2 = ddx*ddx + ddy*ddy;
              const t = len2 > 0 ? Math.max(0, Math.min(1, ((u-ax)*ddx + (v-ay)*ddy)/len2)) : 0;
              const d = (ax + t*ddx - u)**2 + (ay + t*ddy - v)**2;
              if (d < bestDist) { bestDist = d; bestIdx = k + 1; }
            }
          }
          const newContour = [...contour];
          newContour.splice(bestIdx, 0, [u, v] as [number, number]);
          setSilueta({ [planeKey]: newContour });
          event.stopPropagation(); event.preventDefault();
        }
        return;
      }

      // ── Reference Image drag ──────────────────────────────────────────────
      if (moveReferenceMode && event.button === 0) {
        const viewKey = type.toLowerCase() as 'top'|'bottom'|'front'|'back'|'left'|'right';
        if (['top','bottom','front','back','left','right'].includes(viewKey)) {
          const refData = project?.references ? project.references[viewKey] : undefined;
          if (refData?.url) {
            const point = getPoint(event, true);
            if (point) {
              refDragRef.current = {
                viewKey,
                startPos: [...(refData.position || [0,0,0])] as [number,number,number],
                startMouse: point.clone()
              };
              if (controlsRef.current) controlsRef.current.enabled = false;
              event.stopPropagation();
              event.preventDefault();
              return;
            }
          }
        }
      }

      if (drawMode) return;
      if (!containerRef.current||!cameraRef.current||!rendererRef.current) return;
      setActiveViewport(type);
      const rect=rendererRef.current.domElement.getBoundingClientRect();
      if (event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) return;
      const mx=event.clientX-rect.left, my=event.clientY-rect.top;

      // Store start position for drag detection
      gizmoStateRef.current.startScreenPos = { x: event.clientX, y: event.clientY };

      // Gizmo hit
      const gizmoHit=getAxisHit(mx,my);
      const { selectedCameraId } = useStore.getState();
      if (gizmoHit && (selectedObjectId || selectedLightId || selectedCameraId) && event.button === 0) {
        event.stopPropagation();
        event.preventDefault();
        if (controlsRef.current) controlsRef.current.enabled = false;
        
        const selObj = selectedObjectId ? projectRef.current.objects.find(o=>o.id===selectedObjectId) : null;
        const selLight = selectedLightId ? projectRef.current.lights.find(l=>l.id===selectedLightId) : null;
        const selCam = selectedCameraId ? projectRef.current.cameras?.find(c=>c.id===selectedCameraId) : null;

        if (selObj || selLight || selCam) {
          isDraggingRef.current=true;
          gizmoStateRef.current.activeAxis=gizmoHit;
          // startScreenPos already set above
          
          // Store start gizmo world position
          let gizmoWorldPos = new THREE.Vector3();
          const isNurbsCp = !!(selObj && (selObj.nurbsSurface || selObj.nurbsCurve) && selObj.selectedNurbsControlPoint);
          if (selLight) {
            gizmoWorldPos.fromArray(selLight.transform.position);
          } else if (selCam) {
            const evalCam = evaluateCameraTransform(selCam, projectRef.current.objects, currentTime, projectRef.current.duration || 5);
            gizmoWorldPos.copy(evalCam.position);
          } else if (selObj) {
            if (isNurbsCp) {
              let cpLocal: [number, number, number] | null = null;
              if (selObj.nurbsSurface) {
                const u = selObj.selectedNurbsControlPoint!.u;
                const v = selObj.selectedNurbsControlPoint!.v ?? 0;
                cpLocal = selObj.nurbsSurface.controlPoints[u]?.[v]?.point || null;
              } else if (selObj.nurbsCurve) {
                const u = selObj.selectedNurbsControlPoint!.u;
                cpLocal = selObj.nurbsCurve.controlPoints[u]?.point || null;
              }
              const mesh = getObjectMesh(selectedObjectId);
              if (cpLocal && mesh) {
                gizmoWorldPos = new THREE.Vector3(...cpLocal).applyMatrix4(mesh.matrixWorld);
              } else if (cpLocal) {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                gizmoWorldPos = new THREE.Vector3(...cpLocal)
                  .multiply(new THREE.Vector3(..._interp.scale))
                  .applyEuler(new THREE.Euler(..._interp.rotation))
                  .add(new THREE.Vector3(..._interp.position));
              } else {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                gizmoWorldPos.fromArray(_interp.position);
              }
            } else if (editMode === 'OBJECT') {
              const mesh = getObjectMesh(selectedObjectId);
              if (mesh) {
                mesh.getWorldPosition(gizmoWorldPos);
              } else {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                gizmoWorldPos.fromArray(_interp.position);
              }
            } else {
              const mesh = getObjectMesh(selectedObjectId);
              const centroid = new THREE.Vector3();
              let count = 0;
              selectedVertexIndices.forEach(idx => {
                if (selObj.vertices && idx < selObj.vertices.length) {
                  const v = selObj.vertices[idx];
                  const off = selObj.vertexOffsets?.[idx] ?? [0,0,0];
                  centroid.add(new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]));
                  count++;
                }
              });
              if (count > 0) {
                centroid.divideScalar(count);
                if (mesh) {
                  gizmoWorldPos = centroid.applyMatrix4(mesh.matrixWorld);
                } else {
                  const _interp = getInterpolatedTransform(selObj, currentTime);
                  gizmoWorldPos = centroid
                    .multiply(new THREE.Vector3(..._interp.scale))
                    .applyEuler(new THREE.Euler(..._interp.rotation))
                    .add(new THREE.Vector3(..._interp.position));
                }
              } else {
                const _interp = getInterpolatedTransform(selObj, currentTime);
                gizmoWorldPos.fromArray(_interp.position);
              }
            }
          }
          gizmoStateRef.current.startWorldGizmoPos = gizmoWorldPos;

          if (selLight) {
            gizmoStateRef.current.startPos=[...selLight.transform.position];
            gizmoStateRef.current.startRot=[...selLight.transform.rotation];
            gizmoStateRef.current.startScale=[...selLight.transform.scale];
          } else if (selCam) {
            gizmoStateRef.current.startPos=[...selCam.transform.position];
            gizmoStateRef.current.startRot=[...selCam.transform.rotation];
            gizmoStateRef.current.startScale=[...selCam.transform.scale];
          } else if (selObj) {
            if (isNurbsCp) {
              const activeCPs = selObj.selectedNurbsControlPoints?.length
                ? selObj.selectedNurbsControlPoints
                : (selObj.selectedNurbsControlPoint ? [selObj.selectedNurbsControlPoint] : []);
              const startCPs: { u: number; v?: number; point: V3 }[] = [];
              activeCPs.forEach(cp => {
                let pt: V3 | null = null;
                if (selObj.nurbsSurface) {
                  pt = selObj.nurbsSurface.controlPoints[cp.u]?.[cp.v ?? 0]?.point || null;
                } else if (selObj.nurbsCurve) {
                  pt = selObj.nurbsCurve.controlPoints[cp.u]?.point || null;
                }
                if (pt) startCPs.push({ u: cp.u, v: cp.v, point: [...pt] as V3 });
              });
              (gizmoStateRef.current as any).startNurbsCPs = startCPs;
              const firstPt = startCPs[0]?.point || [0, 0, 0];
              gizmoStateRef.current.startPos = [...firstPt];
              (gizmoStateRef.current as any).startNurbsCP = [...firstPt];
            } else {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              gizmoStateRef.current.startPos=[..._interp.position] as [number, number, number];
              gizmoStateRef.current.startRot=[..._interp.rotation] as [number, number, number];
              gizmoStateRef.current.startScale=[..._interp.scale] as [number, number, number];
            }
          }

          // Store handle world direction & start transforms for all selected objects
          const cam = cameraRef.current;
          let visVecX = new THREE.Vector3(1, 0, 0);
          let visVecY = new THREE.Vector3(0, 1, 0);
          let visVecZ = new THREE.Vector3(0, 0, 1);

          if (transformSpace === 'local' && selObj && selObj.transform) {
            const euler = new THREE.Euler(selObj.transform.rotation[0], selObj.transform.rotation[1], selObj.transform.rotation[2], 'XYZ');
            const q = new THREE.Quaternion().setFromEuler(euler);
            visVecX.applyQuaternion(q);
            visVecY.applyQuaternion(q);
            visVecZ.applyQuaternion(q);
          }

          if (cam) {
            const isOrtho = (cam as any).isOrthographicCamera;
            const camDir = new THREE.Vector3();
            cam.getWorldDirection(camDir);
            const eyeDir = isOrtho ? camDir.negate() : cam.position.clone().sub(gizmoWorldPos).normalize();
            if (!isOrtho && eyeDir.dot(visVecX) < -0.05) visVecX.negate();
            if (!isOrtho && eyeDir.dot(visVecY) < -0.05) visVecY.negate();
            if (!isOrtho && eyeDir.dot(visVecZ) < -0.05) visVecZ.negate();
          }

          const handleWorldDir = { X: visVecX, Y: visVecY, Z: visVecZ };

          const activeObjectIds = (selectedObjectIds && selectedObjectIds.length > 0)
            ? selectedObjectIds
            : (selectedObjectId ? [selectedObjectId] : []);

          const startTransforms: Record<string, any> = {};
          activeObjectIds.forEach(id => {
            const o = projectRef.current.objects.find(obj => obj.id === id);
            if (o) {
              const interp = getInterpolatedTransform(o, currentTime);

              const localSize: [number, number, number] = [1, 1, 1];
              const mesh = primitivesGroupRef.current?.children.find((ch: any) => ch.userData.id === id) as THREE.Mesh | undefined;
              if (mesh && mesh.geometry) {
                if (!mesh.geometry.boundingBox) {
                  mesh.geometry.computeBoundingBox();
                }
                if (mesh.geometry.boundingBox) {
                  const box = mesh.geometry.boundingBox;
                  localSize[0] = Math.max(0.001, box.max.x - box.min.x);
                  localSize[1] = Math.max(0.001, box.max.y - box.min.y);
                  localSize[2] = Math.max(0.001, box.max.z - box.min.z);
                }
              }

              startTransforms[id] = {
                position: [...interp.position],
                rotation: [...interp.rotation],
                scale: [...interp.scale],
                localSize,
                handleWorldDir
              };
            }
          });
          if (selectedLightId) {
            const l = projectRef.current.lights.find(l => l.id === selectedLightId);
            if (l) {
              startTransforms[selectedLightId] = {
                position: [...l.transform.position],
                rotation: [...l.transform.rotation],
                scale: [...l.transform.scale]
              };
            }
          }
          if (selectedCameraId) {
            const c = projectRef.current.cameras?.find(c => c.id === selectedCameraId);
            if (c) {
              startTransforms[selectedCameraId] = {
                position: [...c.transform.position],
                rotation: [...c.transform.rotation],
                scale: [...c.transform.scale]
              };
            }
          }
          gizmoStateRef.current.startTransforms = startTransforms;
          if (selObj?.nurbsSurface) {
            const uSel = selObj.selectedNurbsControlPoint?.u ?? 0;
            const vSel = selObj.selectedNurbsControlPoint?.v ?? 0;
            const pt = selObj.nurbsSurface.controlPoints[uSel]?.[vSel]?.point;
            if (pt) (gizmoStateRef.current as any).startNurbsCP = [...pt];
          } else if (selObj?.nurbsCurve) {
            const uSel = selObj.selectedNurbsControlPoint?.u ?? 0;
            const pt = selObj.nurbsCurve.controlPoints[uSel]?.point;
            if (pt) (gizmoStateRef.current as any).startNurbsCP = [...pt];
          }

          if (editMode!=='OBJECT') {
            const offsets: Record<number,[number,number,number]>={};
            if (selObj.type === 'SHAPE') {
              const cht = gizmoStateRef.current.dragHandleType;
              const cai = gizmoStateRef.current.dragAnchorIdx;
              if ((cht === 'bezierOut' || cht === 'bezierIn') && cai !== undefined && selObj.bezierHandles) {
                // Capture handle position as start
                const h = selObj.bezierHandles[cai];
                const hKey = cht === 'bezierOut' ? cai+10000 : cai+20000;
                offsets[hKey] = cht === 'bezierOut' ? [...h.out] as [number,number,number] : [...h.in] as [number,number,number];
              } else {
                // Anchor drag: capture vertex offsets
                selectedVertexIndices.forEach(idx => {
                  if (idx < 10000) offsets[idx] = [...(selObj.vertexOffsets?.[idx] ?? [0,0,0])] as [number,number,number];
                });
              }
            } else {
              selectedVertexIndices.forEach(idx => {
                offsets[idx] = [...(selObj.vertexOffsets?.[idx] || [0,0,0])] as [number,number,number];
              });
            }
            gizmoStateRef.current.startVertexOffsets = offsets;
          }
          if (controlsRef.current) controlsRef.current.enabled=false;
          return;
        }
      }

      mouseRef.current.x=((event.clientX-rect.left)/rect.width)*2-1;
      mouseRef.current.y=-((event.clientY-rect.top)/rect.height)*2+1;
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      raycasterRef.current.params.Points.threshold=0.1;
      raycasterRef.current.params.Line.threshold=0.1;

      let hitSomething=false;

      // Check NURBS control points raycasting in all modes
      const potentialGroups = [groupRef.current, primitivesGroupRef.current].filter(Boolean) as THREE.Group[];
      if (potentialGroups.length > 0) {
        const sphereHits = raycasterRef.current.intersectObjects(potentialGroups, true);
        const nurbsHit = sphereHits.find(h => h.object.userData?.isNurbsControlPoint);
        if (nurbsHit) {
          event.stopPropagation();
          event.preventDefault();
          hitSomething = true;
          const { u, v, id } = nurbsHit.object.userData;
          const targetObj = projectRef.current.objects.find(o => o.id === id);

          if (selectedObjectId !== id) {
            useStore.getState().selectObject(id);
          }

          if (event.shiftKey) {
            useStore.getState().selectNurbsControlPoint(id, u, v, true);
          } else {
            const existingGroup = targetObj?.selectedNurbsControlPoints || [];
            const isAlreadyInGroup = existingGroup.some(p => p.u === u && (p.v ?? 0) === (v ?? 0));
            if (!isAlreadyInGroup || existingGroup.length <= 1) {
              useStore.getState().selectNurbsControlPoint(id, u, v, false);
            }
          }

          const currentObj = useStore.getState().project.objects.find(o => o.id === id);
          const activeCPs = currentObj?.selectedNurbsControlPoints?.length
            ? currentObj.selectedNurbsControlPoints
            : (currentObj?.selectedNurbsControlPoint ? [currentObj.selectedNurbsControlPoint] : [{ u, v }]);

          const startCPs: { u: number; v?: number; point: V3 }[] = [];
          activeCPs.forEach(cp => {
            let pt: V3 | null = null;
            if (currentObj?.nurbsSurface) {
              pt = currentObj.nurbsSurface.controlPoints[cp.u]?.[cp.v ?? 0]?.point || null;
            } else if (currentObj?.nurbsCurve) {
              pt = currentObj.nurbsCurve.controlPoints[cp.u]?.point || null;
            }
            if (pt) startCPs.push({ u: cp.u, v: cp.v, point: [...pt] as V3 });
          });

          (gizmoStateRef.current as any).startNurbsCPs = startCPs;
          const firstPt = startCPs[0]?.point || [0, 0, 0];
          (gizmoStateRef.current as any).startNurbsCP = [...firstPt];
          gizmoStateRef.current.startPos = [...firstPt];

          gizmoStateRef.current.activeAxis = 'FREE';
          gizmoStateRef.current.startScreenPos = { x: event.clientX, y: event.clientY };
          gizmoStateRef.current.startWorldGizmoPos = nurbsHit.object.position.clone();
          isDraggingRef.current = true;
          if (controlsRef.current) controlsRef.current.enabled = false;
          return;
        }
      }

      if (editMode==='VERTEX') {
        const selObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
        const isShape = selObj?.type === 'SHAPE';
        
        if (isShape && primitivesGroupRef.current) {
          const sphereHits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, false);
          const sh = sphereHits.find(h => h.object.userData.handleType !== undefined);
          
          if (sh) {
            event.stopPropagation();
            event.preventDefault();
            hitSomething = true;
            const ht = sh.object.userData.handleType as string;
            const ai = sh.object.userData.anchorIdx as number;
            
            // Start drag immediately for vertices/handles
            gizmoStateRef.current.dragHandleType = ht as any;
            gizmoStateRef.current.dragAnchorIdx = ai;
            gizmoStateRef.current.activeAxis = 'FREE';
            gizmoStateRef.current.startScreenPos = { x: event.clientX, y: event.clientY };
            gizmoStateRef.current.startWorldGizmoPos = sh.point.clone();
            isDraggingRef.current = true;

            if (selObj) {
              const offsets: Record<number,[number,number,number]> = {};
              if (ht === 'bezierOut' || ht === 'bezierIn') {
                const h = selObj.bezierHandles?.[ai];
                if (h) {
                  const hKey = ht === 'bezierOut' ? ai + 10000 : ai + 20000;
                  offsets[hKey] = ht === 'bezierOut' ? [...h.out] as [number,number,number] : [...h.in] as [number,number,number];
                }
              } else {
                const selectedIdxs = (!event.shiftKey && !selectedVertexIndices.includes(ai)) ? [ai] : selectedVertexIndices.includes(ai) ? selectedVertexIndices : [...selectedVertexIndices, ai];
                selectedIdxs.forEach(idx => {
                  if (idx < 10000) offsets[idx] = [...(selObj.vertexOffsets?.[idx] ?? [0,0,0])] as [number,number,number];
                });
              }
              gizmoStateRef.current.startVertexOffsets = offsets;
            }
            
            if (ht === 'anchor') {
              if (!event.shiftKey && !selectedVertexIndices.includes(ai)) {
                setSelectedVertexIndices([ai]);
              } else if (event.shiftKey) {
                addSelectedVertexIndices([ai]);
              }
            } else if (ht === 'bezierOut') {
              setSelectedVertexIndices([ai + 10000]);
            } else if (ht === 'bezierIn') {
              setSelectedVertexIndices([ai + 20000]);
            }

            if (controlsRef.current) controlsRef.current.enabled = false;
          } else {
            // Click on the curve line → insert a new control point
            const lineHits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, false);
            const lh = lineHits.find(h => h.object.userData.handleType === 'curveLine');
            const shapeObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (lh && shapeObj) {
              event.stopPropagation();
              event.preventDefault();
              hitSomething = true;
              const clickPt = lh.point.clone();
              const _interp = getInterpolatedTransform(shapeObj, currentTime);
              const mat = new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
              const localPt = clickPt.clone().applyMatrix4(mat.invert());
              const verts = shapeObj.vertices;
              const offsets = shapeObj.vertexOffsets ?? {};
              let bestIdx = verts.length;
              
              if (lh.index !== undefined) {
                const segCount = shapeObj.parameters.segments ?? 20;
                bestIdx = Math.floor(lh.index / segCount) + 1;
              } else {
                let bestDist = Infinity;
                const loopCount = shapeObj.parameters.closed ? verts.length : verts.length - 1;
                for (let k = 0; k < loopCount; k++) {
                  const k1 = (k + 1) % verts.length;
                  const offA = offsets[k] ?? [0,0,0];
                  const offB = offsets[k1] ?? [0,0,0];
                  const a = new THREE.Vector3(verts[k][0]+offA[0], verts[k][1]+offA[1], verts[k][2]+offA[2]);
                  const b = new THREE.Vector3(verts[k1][0]+offB[0], verts[k1][1]+offB[1], verts[k1][2]+offB[2]);
                  const seg = new THREE.Line3(a, b);
                  const closest = new THREE.Vector3();
                  seg.closestPointToPoint(localPt, true, closest);
                  const d = closest.distanceTo(localPt);
                  if (d < bestDist) { bestDist = d; bestIdx = k + 1; }
                }
              }
              const newVerts = [...verts];
              newVerts.splice(bestIdx, 0, [localPt.x, localPt.y, localPt.z] as [number,number,number]);
              const newHandles = shapeObj.bezierHandles ? [...shapeObj.bezierHandles] : [];
              if (newHandles.length > 0) newHandles.splice(bestIdx, 0, { out: [0,0,0], in: [0,0,0], broken: false });
              const newOffsets: Record<number,[number,number,number]> = {};
              Object.entries(shapeObj.vertexOffsets ?? {}).forEach(([k,v]) => {
                const ki = parseInt(k);
                if (ki >= bestIdx) newOffsets[ki+1] = v as [number,number,number];
                else newOffsets[ki] = v as [number,number,number];
              });
              useStore.getState().updateObject(selectedObjectId!, { 
                vertices: newVerts,
                bezierHandles: newHandles.length > 0 ? newHandles : undefined,
                vertexOffsets: newOffsets
              } as any);
              setSelectedVertexIndices([bestIdx]);
              saveHistory();
              if (controlsRef.current) controlsRef.current.enabled = false;
            }
          }
        } else if (selObj && (vertexPointsRef.current || groupRef.current)) {
          // ── Direct Click & Drag for 3D Mesh Vertices ─────────────────────
          let hitVtxIdx: number | null = null;
          let coincidentIndices: number[] = [];
          let hitWorldPos: THREE.Vector3 | null = null;

          // 1. Raycast against Points geometry
          if (vertexPointsRef.current) {
            if (cameraRef.current instanceof THREE.PerspectiveCamera) {
              const camDist = cameraRef.current.position.distanceTo(vertexPointsRef.current.position);
              raycasterRef.current.params.Points.threshold = Math.max(0.18, camDist * 0.035);
            } else {
              raycasterRef.current.params.Points.threshold = 0.5;
            }
            const hits = raycasterRef.current.intersectObject(vertexPointsRef.current);
            if (hits.length > 0 && hits[0].index !== undefined) {
              hitVtxIdx = hits[0].index;
              hitWorldPos = hits[0].point.clone();
              coincidentIndices = getCoincidentVertices(vertexPointsRef.current.geometry, hitVtxIdx);
            }
          }

          // 2. Raycast against visual vertex dot spheres
          if (hitVtxIdx === null && groupRef.current) {
            const sphereHits = raycasterRef.current.intersectObjects(groupRef.current.children, false);
            const vh = sphereHits.find(h => h.object.userData?.isVertexHandle && h.object.userData?.id === selectedObjectId);
            if (vh && vh.object.userData.vertexIndex !== undefined) {
              hitVtxIdx = vh.object.userData.vertexIndex;
              hitWorldPos = vh.point.clone();
              coincidentIndices = vertexPointsRef.current ? getCoincidentVertices(vertexPointsRef.current.geometry, hitVtxIdx) : [hitVtxIdx];
            }
          }

          // 3. Screen-space proximity fallback for 3D Mesh vertices
          if (hitVtxIdx === null && selObj && selObj.vertices && selObj.vertices.length > 0) {
            const meshObj = primitivesGroupRef.current?.children.find(c => (c as any).userData?.id === selectedObjectId) as THREE.Mesh | undefined;
            const mat4 = meshObj ? meshObj.matrixWorld : (() => {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              return new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
            })();

            const rect = rendererRef.current!.domElement.getBoundingClientRect();
            const clickScreenX = event.clientX - rect.left;
            const clickScreenY = event.clientY - rect.top;

            let closestDist = 18;
            let closestIdx: number | null = null;
            let closestWorldPt: THREE.Vector3 | null = null;

            for (let i = 0; i < selObj.vertices.length; i++) {
              const v = selObj.vertices[i];
              const off = selObj.vertexOffsets?.[i] || [0, 0, 0];
              const worldPt = new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]).applyMatrix4(mat4);
              const p_ndc = worldPt.clone().project(cameraRef.current!);
              if (p_ndc.z > 1) continue;

              const sx = (p_ndc.x * 0.5 + 0.5) * rect.width;
              const sy = (p_ndc.y * -0.5 + 0.5) * rect.height;
              const dist = Math.hypot(clickScreenX - sx, clickScreenY - sy);

              if (dist < closestDist) {
                closestDist = dist;
                closestIdx = i;
                closestWorldPt = worldPt;
              }
            }

            if (closestIdx !== null && closestWorldPt) {
              hitVtxIdx = closestIdx;
              hitWorldPos = closestWorldPt.clone();
              if (vertexPointsRef.current) {
                coincidentIndices = getCoincidentVertices(vertexPointsRef.current.geometry, hitVtxIdx);
              } else {
                coincidentIndices = [hitVtxIdx];
              }
            }
          }

          if (hitVtxIdx !== null && hitWorldPos) {
            event.stopPropagation();
            event.preventDefault();
            hitSomething = true;

            const isCtrl = event.ctrlKey || event.metaKey;
            const isShift = event.shiftKey;
            const curSet = new Set(selectedVertexIndices);
            const isAlreadySelected = coincidentIndices.some(idx => curSet.has(idx));

            let newIndices: number[] = [];

            if (isCtrl || isShift) {
              if (isAlreadySelected) {
                newIndices = selectedVertexIndices.filter(i => !coincidentIndices.includes(i));
              } else {
                newIndices = Array.from(new Set([...selectedVertexIndices, ...coincidentIndices]));
              }
              setSelectedVertexIndices(newIndices);
            } else if (!isAlreadySelected) {
              // Clicked an unselected vertex -> select it
              newIndices = [...coincidentIndices];
              setSelectedVertexIndices(newIndices);
            } else {
              // Clicked an already-selected vertex -> retain active selection for group dragging
              newIndices = [...selectedVertexIndices];
            }

            // Start FREE dragging on all active selected vertices immediately
            if (newIndices.length > 0) {
              gizmoStateRef.current.activeAxis = 'FREE';
              gizmoStateRef.current.startScreenPos = { x: event.clientX, y: event.clientY };

              const mesh = getObjectMesh(selectedObjectId);
              const centroid = new THREE.Vector3();
              let count = 0;
              const offsets: Record<number, [number, number, number]> = {};
              newIndices.forEach(idx => {
                if (selObj.vertices && idx < selObj.vertices.length) {
                  const v = selObj.vertices[idx];
                  const off = selObj.vertexOffsets?.[idx] ?? [0, 0, 0];
                  centroid.add(new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]));
                  offsets[idx] = [...off] as [number, number, number];
                  count++;
                }
              });

              if (count > 0) {
                centroid.divideScalar(count);
                if (mesh) {
                  gizmoStateRef.current.startWorldGizmoPos = centroid.applyMatrix4(mesh.matrixWorld);
                } else {
                  const _interp = getInterpolatedTransform(selObj, currentTime);
                  gizmoStateRef.current.startWorldGizmoPos = centroid
                    .multiply(new THREE.Vector3(..._interp.scale))
                    .applyEuler(new THREE.Euler(..._interp.rotation))
                    .add(new THREE.Vector3(..._interp.position));
                }
              } else {
                gizmoStateRef.current.startWorldGizmoPos = hitWorldPos;
              }

              gizmoStateRef.current.startVertexOffsets = offsets;
              isDraggingRef.current = true;
              if (rendererRef.current) rendererRef.current.domElement.style.cursor = 'grabbing';
            }

            if (controlsRef.current) controlsRef.current.enabled = false;
            return;
          }
        }
      }

      if (!hitSomething && event.button === 0) {
        // Record pending marquee start — actual marquee only activates after 5px drag
        pendingMarqueeRef.current = { x: mx, y: my };
        (mouseRef.current as any)._pendingDeselect = true;
        (mouseRef.current as any).pointerDownPos = { x: event.clientX, y: event.clientY };
        gizmoStateRef.current.startScreenPos = { x: event.clientX, y: event.clientY };
      }

      if ((mouseRef.current as any)._pendingExpand) {
        (mouseRef.current as any)._pendingExpand = false;
        useStore.getState().expandSelection();
      }
    };

    const handleMouseMove = (event: PointerEvent) => {
      // ── Reference Image drag ──────────────────────────────────────────────
      if (refDragRef.current) {
        const { viewKey, startPos, startMouse } = refDragRef.current;
        const point = getPoint(event, true);
        if (point) {
          const diff = point.clone().sub(startMouse);
          const newPos: [number,number,number] = [startPos[0], startPos[1], startPos[2]];
          if (viewKey === 'front' || viewKey === 'back') {
            newPos[0] += diff.x;
            newPos[1] += diff.y;
          } else if (viewKey === 'left' || viewKey === 'right') {
            newPos[2] += diff.z;
            newPos[1] += diff.y;
          } else {
            newPos[0] += diff.x;
            newPos[2] += diff.z;
          }
          setReference(viewKey, { position: newPos });
        }
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      // ── Silueta drag ──────────────────────────────────────────────────────
      if (siluetaDragRef.current && rendererRef.current && cameraRef.current) {
        const { planeKey, pointIndex } = siluetaDragRef.current;
        const contour = [...(siluetaRef.current[planeKey] || [])];
        if (pointIndex < contour.length) {
          const rect = rendererRef.current.domElement.getBoundingClientRect();
          const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          const worldPt = new THREE.Vector3(nx, ny, 0).unproject(cameraRef.current);
          let u: number, v: number;
          if (planeKey === 'front' || planeKey === 'back')     { u = worldPt.x; v =  worldPt.y; }
          else if (planeKey === 'left' || planeKey === 'right') { u = worldPt.z; v =  worldPt.y; }
          else                                                  { u = worldPt.x; v = -worldPt.z; }
          u = Math.max(-1, Math.min(1, u));
          v = Math.max(-1, Math.min(1, v));
          contour[pointIndex] = [u, v];
          setSilueta({ [planeKey]: contour });
        }
        event.stopPropagation(); event.preventDefault();
        return;
      }

      // ── Marquee selection ────────────────────────────────────────────────
      if (pendingMarqueeRef.current && rendererRef.current) {
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const dx = mx - pendingMarqueeRef.current.x;
        const dy = my - pendingMarqueeRef.current.y;
        
        // Marquee only activates if Shift or Ctrl is held OR if we are in a specific mode
        // This allows default left-drag to be used for OrbitControls (rotation)
        const isMarqueeKey = event.shiftKey || event.ctrlKey || event.metaKey;
        
        if (isMarqueeKey && Math.sqrt(dx*dx + dy*dy) > 5) {
          // Threshold crossed — activate marquee and lock out OrbitControls
          marqueeRef.current = { start: { ...pendingMarqueeRef.current }, end: { x: mx, y: my } };
          pendingMarqueeRef.current = null;
          if (controlsRef.current) controlsRef.current.enabled = false;
        }
      }

      if (marqueeRef.current && rendererRef.current) {
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        marqueeRef.current = { ...marqueeRef.current, end: { x: mx, y: my } };
        event.stopPropagation();
        event.preventDefault();
        return;
      }

      const gs=gizmoStateRef.current, camera=cameraRef.current;
      if (!camera) return;
      if (!gs.activeAxis && rendererRef.current) {
        const rect=rendererRef.current.domElement.getBoundingClientRect();
        gs.hoveredAxis=getAxisHit(event.clientX-rect.left, event.clientY-rect.top);
        if (gs.hoveredAxis) {
          rendererRef.current.domElement.style.cursor = 'grab';
          if (hoverGroupRef.current) hoverGroupRef.current.clear();
        } else {
          // Real-time hover detection and highlight for EDGE, FACE, and VERTEX edit modes
          const hoverGroup = hoverGroupRef.current;
          if (hoverGroup) hoverGroup.clear();

          const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);

          if (editMode === 'EDGE') {
            let hitEdge = false;
            if (primitivesGroupRef.current && hoverGroup) {
              const hits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, true);
              if (hits.length && hits[0].face) {
                const intersect = hits[0];
                const mesh = intersect.object as THREE.Mesh;
                const clickedId = mesh.userData.id;
                const selObj = projectRef.current.objects.find(o => o.id === clickedId);
                if (selObj && selObj.vertices && selObj.vertices.length > 0) {
                  const pt = intersect.point;
                  const validEdges = extractUniqueEdges(selObj);
                  let bestEdge: [number, number] | null = null;
                  let bestDist = Infinity;
                  const pStart = new THREE.Vector3();
                  const pEnd = new THREE.Vector3();

                  for (const [v1, v2] of validEdges) {
                    const vert1 = selObj.vertices[v1];
                    const vert2 = selObj.vertices[v2];
                    if (!vert1 || !vert2) continue;
                    const off1 = selObj.vertexOffsets?.[v1] || [0, 0, 0];
                    const off2 = selObj.vertexOffsets?.[v2] || [0, 0, 0];
                    const pa = new THREE.Vector3(vert1[0] + off1[0], vert1[1] + off1[1], vert1[2] + off1[2]).applyMatrix4(mesh.matrixWorld);
                    const pb = new THREE.Vector3(vert2[0] + off2[0], vert2[1] + off2[1], vert2[2] + off2[2]).applyMatrix4(mesh.matrixWorld);
                    const dist = new THREE.Line3(pa, pb).closestPointToPoint(pt, true, new THREE.Vector3()).distanceTo(pt);
                    if (dist < bestDist) {
                      bestDist = dist;
                      bestEdge = [v1, v2];
                      pStart.copy(pa);
                      pEnd.copy(pb);
                    }
                  }

                  if (bestEdge) {
                    const logVA = bestEdge[0];
                    const logVB = bestEdge[1];

                    let isSel = false;
                    for (let i = 0; i < selectedEdgeIndices.length; i += 2) {
                      const e1 = selectedEdgeIndices[i], e2 = selectedEdgeIndices[i + 1];
                      if ((e1 === logVA && e2 === logVB) || (e1 === logVB && e2 === logVA)) {
                        isSel = true;
                        break;
                      }
                    }

                    const eGeo = new THREE.BufferGeometry().setFromPoints([pStart, pEnd]);
                    const hoverColor = isSel ? 0xef4444 : 0xfacc15;
                    const edgeLine = new THREE.Line(
                      eGeo,
                      new THREE.LineBasicMaterial({
                        color: hoverColor,
                        linewidth: 5,
                        depthTest: false,
                        transparent: true,
                        opacity: 0.95
                      })
                    );
                    edgeLine.renderOrder = 60;
                    hoverGroup.add(edgeLine);

                    [pStart, pEnd].forEach(p => {
                      const dot = new THREE.Mesh(
                        SHARED_VERTEX_GEO,
                        isSel ? SHARED_ACTIVE_MAT : SHARED_SELECTED_MAT
                      );
                      const edgeDotScale = getAdaptiveHandleScale(p, camera, rect.height, isSel ? 5.5 : 4.5, 0.0006, 0.025);
                      dot.scale.setScalar(edgeDotScale);
                      dot.position.copy(p);
                      dot.renderOrder = 65;
                      hoverGroup.add(dot);
                    });

                    rendererRef.current.domElement.style.cursor = isSel ? 'grab' : 'pointer';
                    hitEdge = true;
                  }
                }
              }
            }
            if (!hitEdge) {
              rendererRef.current.domElement.style.cursor = 'default';
            }
          } else if (editMode === 'FACE') {
            let hitFace = false;
            if (primitivesGroupRef.current && hoverGroup) {
              const hits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, true);
              if (hits.length && hits[0].faceIndex !== undefined) {
                const intersect = hits[0];
                const mesh = intersect.object as THREE.Mesh;
                const clickedId = mesh.userData.id;
                const selObj = projectRef.current.objects.find(o => o.id === clickedId);
                const faceMap = mesh.userData.faceMap as number[] | undefined;
                if (selObj && selObj.faces && faceMap && intersect.faceIndex < faceMap.length) {
                  const logicalFaceIdx = faceMap[intersect.faceIndex];
                  const face = selObj.faces[logicalFaceIdx];
                  if (face) {
                    const isSel = selectedFaceIndices.includes(logicalFaceIdx);
                    const faceWorldVerts: THREE.Vector3[] = [];
                    const perimeterWorldVerts: THREE.Vector3[] = [];
                    const mat4 = mesh.matrixWorld;

                    face.indices.forEach(vi => {
                      const baseV = selObj.vertices[vi];
                      const off = selObj.vertexOffsets?.[vi] || [0, 0, 0];
                      const wPos = new THREE.Vector3(baseV[0] + off[0], baseV[1] + off[1], baseV[2] + off[2]).applyMatrix4(mat4);
                      perimeterWorldVerts.push(wPos);
                    });

                    for (let i = 1; i < face.indices.length - 1; i++) {
                      [perimeterWorldVerts[0], perimeterWorldVerts[i], perimeterWorldVerts[i + 1]].forEach(p => {
                        faceWorldVerts.push(p);
                      });
                    }

                    if (faceWorldVerts.length > 0) {
                      const fGeo = new THREE.BufferGeometry().setFromPoints(faceWorldVerts);
                      fGeo.computeVertexNormals();
                      const hoverFaceMesh = new THREE.Mesh(
                        fGeo,
                        new THREE.MeshBasicMaterial({
                          color: isSel ? 0xf97316 : 0x38bdf8,
                          transparent: true,
                          opacity: isSel ? 0.6 : 0.45,
                          side: THREE.DoubleSide,
                          depthTest: false,
                          polygonOffset: true,
                          polygonOffsetFactor: -3,
                          polygonOffsetUnits: -3
                        })
                      );
                      hoverFaceMesh.renderOrder = 55;
                      hoverGroup.add(hoverFaceMesh);

                      const closedPerimeter = [...perimeterWorldVerts, perimeterWorldVerts[0]];
                      const pGeo = new THREE.BufferGeometry().setFromPoints(closedPerimeter);
                      const perimeterLine = new THREE.Line(
                        pGeo,
                        new THREE.LineBasicMaterial({
                          color: isSel ? 0xef4444 : 0x0284c7,
                          linewidth: 3,
                          depthTest: false
                        })
                      );
                      perimeterLine.renderOrder = 56;
                      hoverGroup.add(perimeterLine);
                    }

                    rendererRef.current.domElement.style.cursor = isSel ? 'grab' : 'pointer';
                    hitFace = true;
                  }
                }
              }
            }
            if (!hitFace) {
              rendererRef.current.domElement.style.cursor = 'default';
            }
          } else if (editMode === 'VERTEX' || insertVertexMode) {
            let vtxHovered = false;
            let isHoveredSelected = false;
            let hitPos: THREE.Vector3 | null = null;
            let hoveredVertexIdx: number | null = null;

            // 1. Raycast against Points geometry
            if (vertexPointsRef.current) {
              if (camera instanceof THREE.PerspectiveCamera) {
                const camDist = camera.position.distanceTo(vertexPointsRef.current.position);
                raycasterRef.current.params.Points.threshold = Math.max(0.20, camDist * 0.04);
              } else {
                raycasterRef.current.params.Points.threshold = 0.5;
              }
              const hits = raycasterRef.current.intersectObject(vertexPointsRef.current);
              if (hits.length > 0 && hits[0].index !== undefined) {
                vtxHovered = true;
                hoveredVertexIdx = hits[0].index;
                isHoveredSelected = selectedVertexIndices.includes(hits[0].index);
                hitPos = hits[0].point.clone();
              }
            }

            // 2. Raycast against visual vertex dot spheres
            if (!vtxHovered && groupRef.current) {
              const sphereHits = raycasterRef.current.intersectObjects(groupRef.current.children, false);
              const vh = sphereHits.find(h => h.object.userData?.isVertexHandle && h.object.userData?.id === selectedObjectId);
              if (vh && vh.object.userData.vertexIndex !== undefined) {
                vtxHovered = true;
                hoveredVertexIdx = vh.object.userData.vertexIndex;
                isHoveredSelected = selectedVertexIndices.includes(vh.object.userData.vertexIndex);
                hitPos = vh.point.clone();
              }
            }

            // 3. Raycast against 2D Shape handles if it's a SHAPE
            if (!vtxHovered && primitivesGroupRef.current) {
              const sphereHits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, false);
              const sh = sphereHits.find(h => h.object.userData?.handleType === 'anchor');
              if (sh && sh.object.userData.anchorIdx !== undefined) {
                vtxHovered = true;
                hoveredVertexIdx = sh.object.userData.anchorIdx;
                isHoveredSelected = selectedVertexIndices.includes(sh.object.userData.anchorIdx);
                hitPos = sh.point.clone();
              }
            }

            // 4. Screen-space proximity fallback for existing vertices (16px threshold)
            if (!vtxHovered && selectedObjectId) {
              const selObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
              if (selObj && selObj.vertices && selObj.vertices.length > 0) {
                const meshObj = primitivesGroupRef.current?.children.find(c => (c as any).userData?.id === selectedObjectId) as THREE.Mesh | undefined;
                const mat4 = meshObj ? meshObj.matrixWorld : (() => {
                  const _interp = getInterpolatedTransform(selObj, currentTime);
                  return new THREE.Matrix4().compose(
                    new THREE.Vector3().fromArray(_interp.position),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                    new THREE.Vector3().fromArray(_interp.scale)
                  );
                })();

                const mouseScreenX = event.clientX - rect.left;
                const mouseScreenY = event.clientY - rect.top;

                for (let i = 0; i < selObj.vertices.length; i++) {
                  const v = selObj.vertices[i];
                  const off = selObj.vertexOffsets?.[i] || [0, 0, 0];
                  const worldPt = new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]).applyMatrix4(mat4);
                  const p_ndc = worldPt.clone().project(camera);
                  if (p_ndc.z > 1) continue;

                  const sx = (p_ndc.x * 0.5 + 0.5) * rect.width;
                  const sy = (p_ndc.y * -0.5 + 0.5) * rect.height;
                  const dist = Math.hypot(mouseScreenX - sx, mouseScreenY - sy);

                  if (dist <= 16) {
                    vtxHovered = true;
                    hoveredVertexIdx = i;
                    isHoveredSelected = selectedVertexIndices.includes(i);
                    hitPos = worldPt.clone();
                    break;
                  }
                }
              }
            }

            if (vtxHovered && hitPos && hoverGroup) {
              // Existing vertex hover styling (crisp 2D point/cross with fixed screen pixels):
              const dotColor = isHoveredSelected ? 0xef4444 : 0xf59e0b;

              const hoverGeo = new THREE.BufferGeometry();
              hoverGeo.setAttribute('position', new THREE.Float32BufferAttribute([hitPos.x, hitPos.y, hitPos.z], 3));
              const hoverMat = new THREE.PointsMaterial({
                size: isHoveredSelected ? 11.5 : 9.5,
                sizeAttenuation: false,
                map: VERTEX_CROSS_TEXTURE ?? undefined,
                color: dotColor,
                transparent: true,
                alphaTest: 0.05,
                depthTest: false,
              });
              const hoverDot = new THREE.Points(hoverGeo, hoverMat);
              hoverDot.renderOrder = 65;
              hoverGroup.add(hoverDot);

              // Hovering over an existing vertex allows moving (grab) or selecting for deletion
              rendererRef.current.domElement.style.cursor = isHoveredSelected ? 'grab' : 'pointer';
            } else if (selectedObjectId && hoverGroup) {
              // Hovering over a border/edge: allows creating new vertices!
              const selObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
              if (selObj && selObj.vertices && selObj.vertices.length >= 2) {
                const meshObj = primitivesGroupRef.current?.children.find(c => (c as any).userData?.id === selectedObjectId) as THREE.Mesh | undefined;
                const mat4 = meshObj ? meshObj.matrixWorld : (() => {
                  const _interp = getInterpolatedTransform(selObj, currentTime);
                  return new THREE.Matrix4().compose(
                    new THREE.Vector3().fromArray(_interp.position),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                    new THREE.Vector3().fromArray(_interp.scale)
                  );
                })();

                const validEdges: Array<[number, number]> = selObj.type === 'SHAPE'
                  ? (() => {
                      const edges: Array<[number, number]> = [];
                      const count = selObj.parameters?.closed ? selObj.vertices.length : selObj.vertices.length - 1;
                      for (let i = 0; i < count; i++) {
                        edges.push([i, (i + 1) % selObj.vertices.length]);
                      }
                      return edges;
                    })()
                  : extractUniqueEdges(selObj, { dissolveCoplanars: false });

                let bestEdgeDist = 24; // 24px screen distance threshold anywhere along the edge
                let bestEdge: [number, number] | null = null;
                let bestWorldPt: THREE.Vector3 | null = null;
                const mouseScreenX = event.clientX - rect.left;
                const mouseScreenY = event.clientY - rect.top;

                for (const [v1, v2] of validEdges) {
                  const vert1 = selObj.vertices[v1];
                  const vert2 = selObj.vertices[v2];
                  if (!vert1 || !vert2) continue;
                  const off1 = selObj.vertexOffsets?.[v1] || [0, 0, 0];
                  const off2 = selObj.vertexOffsets?.[v2] || [0, 0, 0];
                  const pa = new THREE.Vector3(vert1[0] + off1[0], vert1[1] + off1[1], vert1[2] + off1[2]).applyMatrix4(mat4);
                  const pb = new THREE.Vector3(vert2[0] + off2[0], vert2[1] + off2[1], vert2[2] + off2[2]).applyMatrix4(mat4);

                  const pA_ndc = pa.clone().project(camera);
                  const pB_ndc = pb.clone().project(camera);
                  if (pA_ndc.z > 1 && pB_ndc.z > 1) continue;

                  const sAx = (pA_ndc.x * 0.5 + 0.5) * rect.width;
                  const sAy = (pA_ndc.y * -0.5 + 0.5) * rect.height;
                  const sBx = (pB_ndc.x * 0.5 + 0.5) * rect.width;
                  const sBy = (pB_ndc.y * -0.5 + 0.5) * rect.height;

                  const distToA = Math.hypot(mouseScreenX - sAx, mouseScreenY - sAy);
                  const distToB = Math.hypot(mouseScreenX - sBx, mouseScreenY - sBy);
                  if (distToA <= 16 || distToB <= 16) continue; // Skip edge creation if hovering near endpoints

                  const dx = sBx - sAx;
                  const dy = sBy - sAy;
                  const lenSq = dx * dx + dy * dy;
                  if (lenSq === 0) continue;

                  let t = ((mouseScreenX - sAx) * dx + (mouseScreenY - sAy) * dy) / lenSq;
                  if (t < 0.04 || t > 0.96) continue; // Keep clear margin from endpoints

                  const projX = sAx + t * dx;
                  const projY = sAy + t * dy;
                  const screenDist = Math.hypot(mouseScreenX - projX, mouseScreenY - projY);

                  if (screenDist < bestEdgeDist) {
                    bestEdgeDist = screenDist;
                    bestEdge = [v1, v2];
                    bestWorldPt = pa.clone().lerp(pb, t);
                  }
                }

                if (bestEdge && bestWorldPt) {
                  if (loopCutMode && selObj.faces && selObj.faces.length > 0) {
                    // Render Blender-style Loop Cut and Slide preview loop
                    const loopPreviewSegs = getLoopCutPreview(selObj, bestEdge, loopCutCuts, loopCutSlide);
                    
                    if (loopPreviewSegs.length > 0) {
                      const allLoopPoints: THREE.Vector3[] = [];
                      loopPreviewSegs.forEach(seg => {
                        const pStart = new THREE.Vector3(...seg.start).applyMatrix4(mat4);
                        const pEnd = new THREE.Vector3(...seg.end).applyMatrix4(mat4);
                        allLoopPoints.push(pStart, pEnd);

                        // Small vertex preview dot at each cut point
                        const cutDot = new THREE.Mesh(
                          SHARED_VERTEX_GEO,
                          new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false })
                        );
                        const cutDotScale = getAdaptiveHandleScale(pStart, camera, rect.height, 4.0, 0.0005, 0.025);
                        cutDot.scale.setScalar(cutDotScale);
                        cutDot.position.copy(pStart);
                        cutDot.renderOrder = 85;
                        hoverGroup.add(cutDot);
                      });

                      const loopGeo = new THREE.BufferGeometry().setFromPoints(allLoopPoints);
                      const loopMat = new THREE.LineBasicMaterial({
                        color: 0x06b6d4,
                        depthTest: false,
                        linewidth: 2,
                      });
                      const loopLineSegments = new THREE.LineSegments(loopGeo, loopMat);
                      loopLineSegments.renderOrder = 80;
                      hoverGroup.add(loopLineSegments);
                    }

                    // Main cursor preview dot on the hovered edge
                    const previewDot = new THREE.Mesh(
                      SHARED_VERTEX_GEO,
                      new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false, transparent: true, opacity: 0.95 })
                    );
                    const loopPrevScale = getAdaptiveHandleScale(bestWorldPt, camera, rect.height, 5.5, 0.0007, 0.035);
                    previewDot.scale.setScalar(loopPrevScale);
                    previewDot.position.copy(bestWorldPt);
                    previewDot.renderOrder = 90;
                    hoverGroup.add(previewDot);
                  } else {
                    // Show the preview circle for creating a new vertex right on the edge!
                    const previewDot = new THREE.Mesh(
                      SHARED_VERTEX_GEO,
                      new THREE.MeshBasicMaterial({ color: 0x06b6d4, depthTest: false, transparent: true, opacity: 0.95 })
                    );
                    const prevScale = getAdaptiveHandleScale(bestWorldPt, camera, rect.height, 5.5, 0.0007, 0.035);
                    previewDot.scale.setScalar(prevScale);
                    previewDot.position.copy(bestWorldPt);
                    previewDot.renderOrder = 70;
                    hoverGroup.add(previewDot);
                  }

                  rendererRef.current.domElement.style.cursor = 'crosshair';
                } else {
                  rendererRef.current.domElement.style.cursor = 'default';
                }
              } else {
                rendererRef.current.domElement.style.cursor = 'default';
              }
            } else {
              rendererRef.current.domElement.style.cursor = 'default';
            }
          } else {
            rendererRef.current.domElement.style.cursor = 'default';
          }
        }
      } else if (gs.activeAxis && rendererRef.current) {
        if (hoverGroupRef.current) hoverGroupRef.current.clear();
        rendererRef.current.domElement.style.cursor = 'grabbing';
      }
      if (!gs.activeAxis||(!selectedObjectId && !selectedLightId && !selectedCameraId)) return;
      
      event.stopPropagation();
      event.preventDefault();
      
      const selObj = selectedObjectId ? projectRef.current.objects.find(o=>o.id===selectedObjectId) : null;
      const selLight = selectedLightId ? projectRef.current.lights.find(l=>l.id===selectedLightId) : null;
      const selCam = selectedCameraId ? projectRef.current.cameras?.find(c=>c.id===selectedCameraId) : null;

      if (!selObj && !selLight && !selCam) return;
      const dx=event.clientX-gs.startScreenPos.x, dy=event.clientY-gs.startScreenPos.y;

      if (gs.activeAxis) {
        const ax = gs.activeAxis;
        const isRotateAction = ax.startsWith('ROT_') || (transformMode === 'rotate' && ['X','Y','Z'].includes(ax));
        const isScaleAction = ax.startsWith('SCALE_') || (transformMode === 'scale' && ['X','Y','Z','XY','YZ','XZ'].includes(ax));

        const rect = rendererRef.current!.domElement.getBoundingClientRect();
        const startWorldPos = gs.startWorldGizmoPos || new THREE.Vector3(...gs.startPos);
        const projPos = startWorldPos.clone().project(camera);
        const cxScreen = (projPos.x * 0.5 + 0.5) * rect.width;
        const cyScreen = (-projPos.y * 0.5 + 0.5) * rect.height;

        if (isRotateAction) {
          const rotAxis = ax.startsWith('ROT_') ? ax.replace('ROT_', '') : ax;
          let dAngle = 0;

          if (rotAxis === 'VIEW') {
            const startAng = Math.atan2(gs.startScreenPos.y - (cyScreen + rect.top), gs.startScreenPos.x - (cxScreen + rect.left));
            const curAng = Math.atan2(event.clientY - (cyScreen + rect.top), event.clientX - (cxScreen + rect.left));
            dAngle = curAng - startAng;
          } else {
            const axisVec = rotAxis === 'X' ? new THREE.Vector3(1,0,0) : rotAxis === 'Y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisVec, startWorldPos);
            
            const raycaster = new THREE.Raycaster();
            const sx = ((gs.startScreenPos.x - rect.left) / rect.width) * 2 - 1;
            const sy = -((gs.startScreenPos.y - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(new THREE.Vector2(sx, sy), camera);
            const startHit = new THREE.Vector3();
            const hasStartHit = raycaster.ray.intersectPlane(plane, startHit);

            const cxNorm = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            const cyNorm = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(new THREE.Vector2(cxNorm, cyNorm), camera);
            const curHit = new THREE.Vector3();
            const hasCurHit = raycaster.ray.intersectPlane(plane, curHit);

            if (hasStartHit && hasCurHit) {
              const v0 = startHit.clone().sub(startWorldPos);
              const v1 = curHit.clone().sub(startWorldPos);
              if (v0.lengthSq() > 1e-6 && v1.lengthSq() > 1e-6) {
                const cross = new THREE.Vector3().crossVectors(v0, v1).dot(axisVec);
                const dot = v0.dot(v1);
                dAngle = Math.atan2(cross, dot);
              }
            }
            if (dAngle === 0) {
              const startAng = Math.atan2(gs.startScreenPos.y - (cyScreen + rect.top), gs.startScreenPos.x - (cxScreen + rect.left));
              const curAng = Math.atan2(event.clientY - (cyScreen + rect.top), event.clientX - (cxScreen + rect.left));
              dAngle = curAng - startAng;
            }
          }

          const isSnap = event.shiftKey || gridSnapEnabled;

          const applyRotationAngle = (startAngle: number, delta: number, isApplied: boolean) => {
            if (!isApplied) return startAngle;
            const newAng = startAngle + delta;
            return isSnap ? snapAngleToPresets(newAng) : newAng;
          };

          if (selectedLightId) {
            const start = gs.startTransforms[selectedLightId];
            if (start) {
              const r = [...start.rotation] as [number,number,number];
              const rx = applyRotationAngle(r[0], dAngle, rotAxis === 'X');
              const ry = applyRotationAngle(r[1], dAngle, rotAxis === 'Y');
              const rz = applyRotationAngle(r[2], dAngle, rotAxis === 'Z' || rotAxis === 'VIEW');
              useStore.getState().updateLight(selectedLightId, {
                transform: {
                  ...start,
                  rotation: [rx, ry, rz]
                }
              });
            }
          } else if (selectedCameraId) {
            const camId = selectedCameraId;
            const start = gs.startTransforms[camId];
            if (start) {
              const r = [...start.rotation] as [number,number,number];
              const rx = applyRotationAngle(r[0], dAngle, rotAxis === 'X');
              const ry = applyRotationAngle(r[1], dAngle, rotAxis === 'Y');
              const rz = applyRotationAngle(r[2], dAngle, rotAxis === 'Z' || rotAxis === 'VIEW');
              useStore.getState().updateCamera(camId, {
                transform: {
                  ...start,
                  rotation: [rx, ry, rz]
                }
              });
            }
          } else {
            updateObjects(selectedObjectIds, (id) => {
              const start = gs.startTransforms[id];
              if (!start) return {};
              const r = [...start.rotation] as [number,number,number];
              const rx = applyRotationAngle(r[0], dAngle, rotAxis === 'X');
              const ry = applyRotationAngle(r[1], dAngle, rotAxis === 'Y');
              const rz = applyRotationAngle(r[2], dAngle, rotAxis === 'Z' || rotAxis === 'VIEW');
              return {
                transform: {
                  ...start,
                  rotation: [rx, ry, rz]
                }
              };
            });
          }
        } else if (isScaleAction) {
          const scaleAxis = ax.startsWith('SCALE_') ? ax.replace('SCALE_', '') : ax;
          let scaleX = 1, scaleY = 1, scaleZ = 1;

          if (scaleAxis === 'UNIFORM' || scaleAxis === 'FREE') {
            const startDist = Math.sqrt((gs.startScreenPos.x - (cxScreen + rect.left))**2 + (gs.startScreenPos.y - (cyScreen + rect.top))**2);
            const curDist = Math.sqrt((event.clientX - (cxScreen + rect.left))**2 + (event.clientY - (cyScreen + rect.top))**2);
            const factor = startDist > 0 ? curDist / startDist : 1;
            scaleX = scaleY = scaleZ = Math.max(0.01, factor);
          } else {
            const axisVec = scaleAxis === 'X' ? new THREE.Vector3(1,0,0) : scaleAxis === 'Y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
            const tipProj = startWorldPos.clone().add(axisVec).project(camera);
            const tipX = (tipProj.x * 0.5 + 0.5) * rect.width;
            const tipY = (-tipProj.y * 0.5 + 0.5) * rect.height;
            const screenDir = new THREE.Vector2(tipX - cxScreen, tipY - cyScreen);
            const screenLen = screenDir.length();
            let factor = 1;
            if (screenLen > 1) {
              screenDir.normalize();
              const projDrag = dx * screenDir.x + dy * screenDir.y;
              factor = Math.max(0.01, 1 + projDrag * 0.01);
            } else {
              factor = Math.max(0.01, 1 + (dx - dy) * 0.005);
            }
            scaleX = (scaleAxis === 'X' || scaleAxis === 'XY' || scaleAxis === 'XZ') ? factor : 1;
            scaleY = (scaleAxis === 'Y' || scaleAxis === 'XY' || scaleAxis === 'YZ') ? factor : 1;
            scaleZ = (scaleAxis === 'Z' || scaleAxis === 'XZ' || scaleAxis === 'YZ') ? factor : 1;
          }

          if (editMode==='OBJECT') {
            updateObjects(selectedObjectIds, (id) => {
              const start = gs.startTransforms[id];
              if (!start) return {};
              const s = [...start.scale] as [number,number,number];
              const newScaleX = Math.max(0.01, s[0] * scaleX);
              const newScaleY = Math.max(0.01, s[1] * scaleY);
              const newScaleZ = Math.max(0.01, s[2] * scaleZ);

              return {
                transform: {
                  ...start,
                  position: [...start.position],
                  scale: [
                    newScaleX,
                    newScaleY,
                    newScaleZ
                  ]
                }
              };
            });
          } else {
            const mesh = primitivesGroupRef.current?.children.find((ch:any)=>ch.userData.id===selectedObjectId) as THREE.Mesh|undefined;
            const curSelObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (curSelObj && curSelObj.vertices) {
              const idxs = Object.keys(gs.startVertexOffsets).map(Number);
              const startPositions: Record<number, THREE.Vector3> = {};
              const centroid = new THREE.Vector3();
              idxs.forEach(idx => {
                const baseV = curSelObj.vertices[idx];
                if (baseV) {
                  const s = (gs.startVertexOffsets[idx] || [0, 0, 0]) as [number, number, number];
                  const p = new THREE.Vector3(baseV[0] + s[0], baseV[1] + s[1], baseV[2] + s[2]);
                  startPositions[idx] = p;
                  centroid.add(p);
                }
              });
              if (idxs.length) centroid.divideScalar(idxs.length);

              // Check if in FACE mode with a face selected to align scaling with face normal and plane
              let faceAxes: { T: THREE.Vector3; B: THREE.Vector3; N: THREE.Vector3 } | null = null;
              if (editMode === 'FACE' && selectedFaceIndices.length === 1 && curSelObj.faces) {
                const face = curSelObj.faces[selectedFaceIndices[0]];
                if (face && face.indices.length >= 3) {
                  const p0 = startPositions[face.indices[0]];
                  const p1 = startPositions[face.indices[1]];
                  const p2 = startPositions[face.indices[2]];
                  if (p0 && p1 && p2) {
                    const edge1 = new THREE.Vector3().subVectors(p1, p0);
                    const edge2 = new THREE.Vector3().subVectors(p2, p0);
                    const N = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
                    const T = edge1.clone().normalize();
                    const B = new THREE.Vector3().crossVectors(N, T).normalize();
                    faceAxes = { T, B, N };
                  }
                }
              }

              const newOffsets = idxs.map(idx => {
                const baseV = curSelObj.vertices[idx];
                const p = startPositions[idx];
                if (!baseV || !p) return { index: idx, offset: (curSelObj.vertexOffsets?.[idx] || [0, 0, 0]) as [number, number, number] };

                const fromCenter = new THREE.Vector3().subVectors(p, centroid);
                let scaledPos: THREE.Vector3;

                if (scaleAxis === 'UNIFORM' || scaleAxis === 'FREE' || (!faceAxes && scaleX === scaleY && scaleY === scaleZ)) {
                  // Uniform scale expands all 4 sides outwards uniformly and symmetrically!
                  const factor = scaleX;
                  scaledPos = centroid.clone().addScaledVector(fromCenter, factor);
                } else if (faceAxes) {
                  // Face-aligned scaling: expand symmetrically along width (T), height (B), and depth (N)
                  const u = fromCenter.dot(faceAxes.T);
                  const v = fromCenter.dot(faceAxes.B);
                  const w = fromCenter.dot(faceAxes.N);
                  const scaledVec = faceAxes.T.clone().multiplyScalar(u * scaleX)
                    .addScaledVector(faceAxes.B, v * scaleY)
                    .addScaledVector(faceAxes.N, w * scaleZ);
                  scaledPos = centroid.clone().add(scaledVec);
                } else {
                  // General axis-aligned scaling
                  const scaledVec = new THREE.Vector3(fromCenter.x * scaleX, fromCenter.y * scaleY, fromCenter.z * scaleZ);
                  scaledPos = centroid.clone().add(scaledVec);
                }

                return {
                  index: idx,
                  offset: [
                    scaledPos.x - baseV[0],
                    scaledPos.y - baseV[1],
                    scaledPos.z - baseV[2]
                  ] as [number, number, number]
                };
              });

              updateVertexOffsets(selectedObjectId, newOffsets);
            }
          }
        } else if (gs.activeAxis==='FREE') {
          // Raycast onto camera-facing plane for smooth screen-plane translation
          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, startWorldPos);
          
          const raycaster = new THREE.Raycaster();
          const sx = ((gs.startScreenPos.x - rect.left) / rect.width) * 2 - 1;
          const sy = -((gs.startScreenPos.y - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(new THREE.Vector2(sx, sy), camera);
          const startHit = new THREE.Vector3();
          const hasStartHit = raycaster.ray.intersectPlane(plane, startHit);
          
          const cx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const cy = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(new THREE.Vector2(cx, cy), camera);
          const curHit = new THREE.Vector3();
          const hasCurHit = raycaster.ray.intersectPlane(plane, curHit);
          
          let mov = new THREE.Vector3();
          if (hasStartHit && hasCurHit) {
            mov = curHit.sub(startHit);
          } else {
            const dist = camera.position.distanceTo(startWorldPos);
            const ms = 0.0025 * Math.max(dist, 1);
            const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
            const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
            mov.addScaledVector(right, dx * ms).addScaledVector(up, -dy * ms);
          }
          
          const curSelObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
          const isNurbsCp = !!(
            curSelObj &&
            (curSelObj.nurbsSurface || curSelObj.nurbsCurve) &&
            (curSelObj.selectedNurbsControlPoint || curSelObj.selectedNurbsControlPoints?.length)
          );

          if (isNurbsCp) {
            const mesh = (meshesRef.current.get(selectedObjectId!) || primitivesGroupRef.current?.children.find((c: any) => c.userData.id === selectedObjectId)) as THREE.Mesh | undefined;
            let movLocal = mov.clone();
            if (mesh) {
              const invMat = new THREE.Matrix4().copy(mesh.matrixWorld).setPosition(0, 0, 0).invert();
              movLocal.applyMatrix4(invMat);
            } else if (curSelObj) {
              const _interp = getInterpolatedTransform(curSelObj, currentTime);
              const invMat = new THREE.Matrix4()
                .makeRotationFromEuler(new THREE.Euler(..._interp.rotation))
                .scale(new THREE.Vector3(..._interp.scale))
                .invert();
              movLocal.applyMatrix4(invMat);
            }

            const startCPs: { u: number; v?: number; point: V3 }[] = (gs as any).startNurbsCPs || [];
            if (startCPs.length > 0) {
              const updates = startCPs.map(scp => ({
                u: scp.u,
                v: scp.v,
                point: [
                  scp.point[0] + movLocal.x,
                  scp.point[1] + movLocal.y,
                  scp.point[2] + movLocal.z
                ] as V3
              }));
              useStore.getState().updateNurbsControlPoints(curSelObj.id, updates);
            } else if (curSelObj?.nurbsSurface) {
              const surf = curSelObj.nurbsSurface;
              const uSel = curSelObj.selectedNurbsControlPoint?.u ?? 0;
              const vSel = curSelObj.selectedNurbsControlPoint?.v ?? 0;
              const startPt = (gs as any).startNurbsCP || surf.controlPoints[uSel]?.[vSel]?.point;
              if (startPt) {
                useStore.getState().updateNurbsControlPoint(curSelObj.id, uSel, vSel, [
                  startPt[0] + movLocal.x,
                  startPt[1] + movLocal.y,
                  startPt[2] + movLocal.z
                ]);
              }
            } else if (curSelObj?.nurbsCurve) {
              const curve = curSelObj.nurbsCurve;
              const uSel = curSelObj.selectedNurbsControlPoint?.u ?? 0;
              const startPt = (gs as any).startNurbsCP || curve.controlPoints[uSel]?.point;
              if (startPt) {
                useStore.getState().updateNurbsControlPoint(curSelObj.id, uSel, 0, [
                  startPt[0] + movLocal.x,
                  startPt[1] + movLocal.y,
                  startPt[2] + movLocal.z
                ]);
              }
            }
          } else if (editMode==='OBJECT') {
            if (selectedLightId) {
              const start = gs.startTransforms[selectedLightId];
              if (start) {
                useStore.getState().updateLight(selectedLightId, {
                  transform: {
                    ...start,
                    position: [start.position[0] + mov.x, start.position[1] + mov.y, start.position[2] + mov.z]
                  }
                });
              }
            } else if (selectedCameraId) {
              const camId = selectedCameraId;
              const start = gs.startTransforms[camId];
              if (start) {
                useStore.getState().updateCamera(camId, {
                  transform: {
                    ...start,
                    position: [start.position[0] + mov.x, start.position[1] + mov.y, start.position[2] + mov.z]
                  }
                });
              }
            } else {
              const faceSnap = useStore.getState().faceSnapConfig;
              updateObjects(selectedObjectIds, (id) => {
                const start = gs.startTransforms[id];
                if (!start) return {};
                let newPos = new THREE.Vector3(
                  start.position[0] + mov.x,
                  start.position[1] + mov.y,
                  start.position[2] + mov.z
                );
                let newRot = [...start.rotation] as [number, number, number];

                if (faceSnap?.enabled) {
                  const targetMeshes: THREE.Object3D[] = [];
                  if (faceSnap.targetObjectId) {
                    const tgt = meshesRef.current.get(faceSnap.targetObjectId);
                    if (tgt) targetMeshes.push(tgt);
                  } else {
                    meshesRef.current.forEach((m, mId) => {
                      if (!selectedObjectIds.includes(mId)) targetMeshes.push(m);
                    });
                  }

                  if (targetMeshes.length > 0) {
                    const snapRes = snapPointToSurfaces(newPos, targetMeshes, camera, faceSnap.offset);
                    if (snapRes.hit) {
                      newPos = snapRes.snappedPoint;
                      const curObj = projectRef.current.objects.find(o => o.id === id);
                      const alignAxis = faceSnap.alignmentAxis || '+Y';
                      if (faceSnap.alignRotationToTarget) {
                        newRot = alignObjectRotationToNormal(start.rotation, snapRes.normal, alignAxis);
                      }
                      // If snapBaseToSurface is active (default true), offset along the normal so the accessory base touches the surface rather than its center sinking inside
                      if (curObj && faceSnap.snapBaseToSurface !== false) {
                        const baseDist = getObjectBaseExtentAlongNormal(curObj, snapRes.normal, alignAxis);
                        newPos.addScaledVector(snapRes.normal, baseDist);
                      }
                    }
                  }
                }

                return {
                  transform: {
                    ...start,
                    position: [newPos.x, newPos.y, newPos.z],
                    rotation: newRot,
                  }
                };
              });
            }
          } else {
            const mesh = (meshesRef.current.get(selectedObjectId!) || primitivesGroupRef.current?.children.find((c: any) => c.userData.id === selectedObjectId)) as THREE.Mesh | undefined;
            let movLocal = mov.clone();
            if (mesh) {
              const invMat = new THREE.Matrix4().copy(mesh.matrixWorld).setPosition(0, 0, 0).invert();
              movLocal.applyMatrix4(invMat);
            }
            const cht = gs.dragHandleType;
            const cai = gs.dragAnchorIdx;

            const applyFaceSnappingOffsets = (
              objId: string,
              startOffsets: Record<string, [number, number, number]>,
              deltaLocal: THREE.Vector3
            ) => {
              const curObj = projectRef.current.objects.find(o => o.id === objId);
              const faceSnap = useStore.getState().faceSnapConfig;

              if (faceSnap?.enabled && curObj?.vertices) {
                const targetMeshes: THREE.Object3D[] = [];
                if (faceSnap.targetObjectId) {
                  const tgt = meshesRef.current.get(faceSnap.targetObjectId);
                  if (tgt) targetMeshes.push(tgt);
                } else {
                  meshesRef.current.forEach((m, id) => {
                    if (id !== objId) targetMeshes.push(m);
                  });
                }

                if (targetMeshes.length > 0) {
                  const targetMesh = (meshesRef.current.get(objId) || primitivesGroupRef.current?.children.find((c: any) => c.userData.id === objId)) as THREE.Mesh | undefined;
                  const meshMatrixWorld = targetMesh ? targetMesh.matrixWorld : new THREE.Matrix4();

                  const verticesWithOffsets = Object.entries(startOffsets).map(([idxStr, so]) => {
                    const idx = parseInt(idxStr);
                    const baseV = curObj.vertices[idx] || [0, 0, 0];
                    const candLocal = new THREE.Vector3(
                      baseV[0] + so[0] + deltaLocal.x,
                      baseV[1] + so[1] + deltaLocal.y,
                      baseV[2] + so[2] + deltaLocal.z
                    );
                    const candWorld = candLocal.clone().applyMatrix4(meshMatrixWorld);
                    return {
                      index: idx,
                      candidateWorldPos: candWorld,
                      baseLocalPos: new THREE.Vector3(baseV[0], baseV[1], baseV[2])
                    };
                  });

                  const { updates } = projectVerticesToFaces(
                    verticesWithOffsets,
                    targetMeshes,
                    meshMatrixWorld,
                    camera,
                    {
                      projectIndividualElements: faceSnap.projectIndividualElements,
                      offset: faceSnap.offset
                    }
                  );
                  updateVertexOffsets(objId, updates);
                  return;
                }
              }

              updateVertexOffsets(objId, Object.entries(startOffsets).map(([idx, so]) => ({
                index: parseInt(idx),
                offset: [so[0] + deltaLocal.x, so[1] + deltaLocal.y, so[2] + deltaLocal.z] as [number, number, number]
              })));
            };

            if (curSelObj?.type === 'SHAPE' && (cht === 'bezierOut' || cht === 'bezierIn') && cai !== undefined) {
              const side = cht === 'bezierOut' ? 'out' : 'in';
              const startRel = gs.startVertexOffsets[cht === 'bezierOut' ? cai+10000 : cai+20000] ?? [0,0,0];
              const newRel: V3 = [startRel[0] + movLocal.x, startRel[1] + movLocal.y, startRel[2] + movLocal.z];
              const breakIt = event.altKey;
              useStore.getState().updateBezierHandle(selectedObjectId, cai, side, newRel, breakIt);
            } else {
              applyFaceSnappingOffsets(selectedObjectId, gs.startVertexOffsets, movLocal);
            }
          }
        } else {
          let move = new THREE.Vector3();
          const isOrtho = (camera as any).isOrthographicCamera;
          const sx0 = ((gs.startScreenPos.x - rect.left) / rect.width) * 2 - 1;
          const sy0 = -((gs.startScreenPos.y - rect.top) / rect.height) * 2 + 1;
          const sx1 = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const sy1 = -((event.clientY - rect.top) / rect.height) * 2 + 1;

          const pt0 = new THREE.Vector3(sx0, sy0, 0).unproject(camera);
          const pt1 = new THREE.Vector3(sx1, sy1, 0).unproject(camera);
          const screenWorldDelta = pt1.clone().sub(pt0);

          const camDir = new THREE.Vector3();
          camera.getWorldDirection(camDir);
          const startWorldPt = gs.startWorldGizmoPos ? gs.startWorldGizmoPos.clone() : new THREE.Vector3(...gs.startPos);
          const curSelObjForTrans = projectRef.current.objects.find(o => o.id === selectedObjectId);

          if (gs.activeAxis === 'FREE') {
            if (isOrtho) {
              move = screenWorldDelta.clone();
            } else {
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, startWorldPt);
              const raycaster = new THREE.Raycaster();
              raycaster.setFromCamera(new THREE.Vector2(sx0, sy0), camera);
              const startHit = new THREE.Vector3();
              const hasStart = raycaster.ray.intersectPlane(plane, startHit);
              raycaster.setFromCamera(new THREE.Vector2(sx1, sy1), camera);
              const curHit = new THREE.Vector3();
              const hasCur = raycaster.ray.intersectPlane(plane, curHit);
              if (hasStart && hasCur) {
                move = curHit.sub(startHit);
              } else {
                move = screenWorldDelta.clone();
              }
            }
          } else if (['XY', 'YZ', 'XZ'].includes(gs.activeAxis)) {
            const ax = gs.activeAxis;
            const normal = ax === 'XY' ? new THREE.Vector3(0,0,1) : ax === 'YZ' ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
            if (isOrtho) {
              move = screenWorldDelta.clone();
              if (ax === 'XY') move.z = 0;
              if (ax === 'YZ') move.x = 0;
              if (ax === 'XZ') move.y = 0;
            } else {
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startWorldPt);
              const raycaster = new THREE.Raycaster();
              raycaster.setFromCamera(new THREE.Vector2(sx0, sy0), camera);
              const startHit = new THREE.Vector3();
              const hasStart = raycaster.ray.intersectPlane(plane, startHit);
              raycaster.setFromCamera(new THREE.Vector2(sx1, sy1), camera);
              const curHit = new THREE.Vector3();
              const hasCur = raycaster.ray.intersectPlane(plane, curHit);
              if (hasStart && hasCur) {
                move = curHit.sub(startHit);
              } else {
                move = screenWorldDelta.clone();
                if (ax === 'XY') move.z = 0;
                if (ax === 'YZ') move.x = 0;
                if (ax === 'XZ') move.y = 0;
              }
            }
          } else {
            const ax = gs.activeAxis;
            let axisVec = ax === 'X' ? new THREE.Vector3(1,0,0) : ax === 'Y' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,1);
            if (transformSpace === 'local' && curSelObjForTrans && curSelObjForTrans.transform) {
              const euler = new THREE.Euler(curSelObjForTrans.transform.rotation[0], curSelObjForTrans.transform.rotation[1], curSelObjForTrans.transform.rotation[2], 'XYZ');
              axisVec.applyEuler(euler).normalize();
            }

            if (isOrtho) {
              const distOnAxis = screenWorldDelta.dot(axisVec);
              move = axisVec.clone().multiplyScalar(distOnAxis);
            } else {
              let planeNormal = new THREE.Vector3().crossVectors(camDir, axisVec).cross(axisVec);
              if (planeNormal.lengthSq() < 1e-5) {
                planeNormal = new THREE.Vector3().crossVectors(camera.up, axisVec);
                if (planeNormal.lengthSq() < 1e-5) {
                  planeNormal = new THREE.Vector3(1,0,0);
                }
              }
              planeNormal.normalize();
              
              const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, startWorldPt);
              const raycaster = new THREE.Raycaster();
              raycaster.setFromCamera(new THREE.Vector2(sx0, sy0), camera);
              const startHit = new THREE.Vector3();
              const hasStartHit = raycaster.ray.intersectPlane(plane, startHit);
              
              raycaster.setFromCamera(new THREE.Vector2(sx1, sy1), camera);
              const curHit = new THREE.Vector3();
              const hasCurHit = raycaster.ray.intersectPlane(plane, curHit);
              
              if (hasStartHit && hasCurHit) {
                const rawDelta = curHit.sub(startHit);
                const distOnAxis = rawDelta.dot(axisVec);
                move = axisVec.clone().multiplyScalar(distOnAxis);
              } else {
                const distOnAxis = screenWorldDelta.dot(axisVec);
                move = axisVec.clone().multiplyScalar(distOnAxis);
              }
            }
          }

          if (event.shiftKey || gridSnapEnabled) {
            const snapVal = (v: number) => Math.round(v * 2) / 2;
            move.x = snapVal(move.x);
            move.y = snapVal(move.y);
            move.z = snapVal(move.z);
          }

          const curSelObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
          const isNurbsCp = !!(
            curSelObj &&
            (curSelObj.nurbsSurface || curSelObj.nurbsCurve) &&
            (curSelObj.selectedNurbsControlPoint || curSelObj.selectedNurbsControlPoints?.length)
          );

          if (isNurbsCp) {
            const mesh = (meshesRef.current.get(selectedObjectId!) || primitivesGroupRef.current?.children.find((c: any) => c.userData.id === selectedObjectId)) as THREE.Mesh | undefined;
            let moveLocal = move.clone();
            if (mesh) {
              const invMat = new THREE.Matrix4().copy(mesh.matrixWorld).setPosition(0, 0, 0).invert();
              moveLocal.applyMatrix4(invMat);
            } else if (curSelObj) {
              const _interp = getInterpolatedTransform(curSelObj, currentTime);
              const invMat = new THREE.Matrix4()
                .makeRotationFromEuler(new THREE.Euler(..._interp.rotation))
                .scale(new THREE.Vector3(..._interp.scale))
                .invert();
              moveLocal.applyMatrix4(invMat);
            }

            const startCPs: { u: number; v?: number; point: V3 }[] = (gs as any).startNurbsCPs || [];
            if (startCPs.length > 0) {
              const updates = startCPs.map(scp => ({
                u: scp.u,
                v: scp.v,
                point: [
                  scp.point[0] + moveLocal.x,
                  scp.point[1] + moveLocal.y,
                  scp.point[2] + moveLocal.z
                ] as V3
              }));
              useStore.getState().updateNurbsControlPoints(curSelObj.id, updates);
            } else if (curSelObj?.nurbsSurface) {
              const surf = curSelObj.nurbsSurface;
              const uSel = curSelObj.selectedNurbsControlPoint?.u ?? 0;
              const vSel = curSelObj.selectedNurbsControlPoint?.v ?? 0;
              const startPt = (gs as any).startNurbsCP || surf.controlPoints[uSel]?.[vSel]?.point;
              if (startPt) {
                useStore.getState().updateNurbsControlPoint(curSelObj.id, uSel, vSel, [
                  startPt[0] + moveLocal.x,
                  startPt[1] + moveLocal.y,
                  startPt[2] + moveLocal.z
                ]);
              }
            } else if (curSelObj?.nurbsCurve) {
              const curve = curSelObj.nurbsCurve;
              const uSel = curSelObj.selectedNurbsControlPoint?.u ?? 0;
              const startPt = (gs as any).startNurbsCP || curve.controlPoints[uSel]?.point;
              if (startPt) {
                useStore.getState().updateNurbsControlPoint(curSelObj.id, uSel, 0, [
                  startPt[0] + moveLocal.x,
                  startPt[1] + moveLocal.y,
                  startPt[2] + moveLocal.z
                ]);
              }
            }
          } else if (editMode==='OBJECT') {
            if (selectedLightId) {
              const start = gs.startTransforms[selectedLightId];
              if (start) {
                useStore.getState().updateLight(selectedLightId, {
                  transform: {
                    ...start,
                    position: [start.position[0] + move.x, start.position[1] + move.y, start.position[2] + move.z]
                  }
                });
              }
            } else if (selectedCameraId) {
              const camId = selectedCameraId;
              const start = gs.startTransforms[camId];
              if (start) {
                useStore.getState().updateCamera(camId, {
                  transform: {
                    ...start,
                    position: [start.position[0] + move.x, start.position[1] + move.y, start.position[2] + move.z]
                  }
                });
              }
            } else {
              const activeObjectIds = (selectedObjectIds && selectedObjectIds.length > 0)
                ? selectedObjectIds
                : (selectedObjectId ? [selectedObjectId] : []);
              updateObjects(activeObjectIds, (id) => {
                const start = gs.startTransforms[id];
                const o = projectRef.current.objects.find(obj => obj.id === id);
                const pos = start ? start.position : (o ? getInterpolatedTransform(o, currentTime).position : [0,0,0]);
                const currentTrans = start || o?.transform || { position: [0, 0, 0] as V3, rotation: [0, 0, 0] as V3, scale: [1, 1, 1] as V3 };
                return {
                  transform: {
                    ...currentTrans,
                    position: [pos[0] + move.x, pos[1] + move.y, pos[2] + move.z] as V3
                  }
                };
              });
            }
          } else {
            const mesh = getObjectMesh(selectedObjectId);
            let moveLocal = move.clone();
            if (mesh) {
              const invMat = new THREE.Matrix4().copy(mesh.matrixWorld).setPosition(0, 0, 0).invert();
              moveLocal.applyMatrix4(invMat);
            } else if (curSelObj) {
              const _interp = getInterpolatedTransform(curSelObj, currentTime);
              const invMat = new THREE.Matrix4()
                .makeRotationFromEuler(new THREE.Euler(..._interp.rotation))
                .scale(new THREE.Vector3(..._interp.scale))
                .invert();
              moveLocal.applyMatrix4(invMat);
            }
            const cht = gs.dragHandleType;
            const cai = gs.dragAnchorIdx;
            if (curSelObj?.type === 'SHAPE' && (cht === 'bezierOut' || cht === 'bezierIn') && cai !== undefined) {
              const anchor = curSelObj.vertices[cai];
              const hCur = curSelObj.bezierHandles?.[cai];
              if (hCur && anchor) {
                const side = cht === 'bezierOut' ? 'out' : 'in';
                const startRel = gs.startVertexOffsets[cht === 'bezierOut' ? cai+10000 : cai+20000] ?? [0,0,0];
                const newRel: V3 = [startRel[0] + moveLocal.x, startRel[1] + moveLocal.y, startRel[2] + moveLocal.z];
                const breakIt = event.altKey;
                useStore.getState().updateBezierHandle(selectedObjectId, cai, side, newRel, breakIt);
              }
            } else {
              // Apply face snapping if active
              const faceSnap = useStore.getState().faceSnapConfig;
              if (faceSnap?.enabled && curSelObj?.vertices) {
                const targetMeshes: THREE.Object3D[] = [];
                if (faceSnap.targetObjectId) {
                  const tgt = meshesRef.current.get(faceSnap.targetObjectId);
                  if (tgt) targetMeshes.push(tgt);
                } else {
                  meshesRef.current.forEach((m, id) => {
                    if (id !== selectedObjectId) targetMeshes.push(m);
                  });
                }

                if (targetMeshes.length > 0) {
                  const targetMesh = (meshesRef.current.get(selectedObjectId!) || primitivesGroupRef.current?.children.find((c: any) => c.userData.id === selectedObjectId)) as THREE.Mesh | undefined;
                  const meshMatrixWorld = targetMesh ? targetMesh.matrixWorld : new THREE.Matrix4();

                  const verticesWithOffsets = Object.entries(gs.startVertexOffsets).map(([idxStr, so]) => {
                    const idx = parseInt(idxStr);
                    const baseV = curSelObj.vertices[idx] || [0, 0, 0];
                    const candLocal = new THREE.Vector3(
                      baseV[0] + so[0] + moveLocal.x,
                      baseV[1] + so[1] + moveLocal.y,
                      baseV[2] + so[2] + moveLocal.z
                    );
                    const candWorld = candLocal.clone().applyMatrix4(meshMatrixWorld);
                    return {
                      index: idx,
                      candidateWorldPos: candWorld,
                      baseLocalPos: new THREE.Vector3(baseV[0], baseV[1], baseV[2])
                    };
                  });

                  const { updates } = projectVerticesToFaces(
                    verticesWithOffsets,
                    targetMeshes,
                    meshMatrixWorld,
                    camera,
                    {
                      projectIndividualElements: faceSnap.projectIndividualElements,
                      offset: faceSnap.offset
                    }
                  );
                  updateVertexOffsets(selectedObjectId, updates);
                } else {
                  updateVertexOffsets(selectedObjectId, Object.entries(gs.startVertexOffsets).map(([idx,so])=>({
                    index:parseInt(idx), offset:[so[0] + moveLocal.x, so[1] + moveLocal.y, so[2] + moveLocal.z] as [number,number,number]
                  })));
                }
              } else {
                updateVertexOffsets(selectedObjectId, Object.entries(gs.startVertexOffsets).map(([idx,so])=>({
                  index:parseInt(idx), offset:[so[0] + moveLocal.x, so[1] + moveLocal.y, so[2] + moveLocal.z] as [number,number,number]
                })));
              }
            }
          }
        }
      }

      // ── Update numeric gizmo display ─────────────────────────────────────
      if (gizmoDisplayRef.current && gs.activeAxis) {
        let display = '';
        const ax = gs.activeAxis;
        if (transformMode === 'translate') {
          const cur = projectRef.current.objects.find(o => o.id === selectedObjectId);
          if (cur && ['X', 'Y', 'Z'].includes(ax)) {
            const axIdx = ax === 'X' ? 0 : ax === 'Y' ? 1 : 2;
            display = `${ax}: ${safeFixed(cur.transform.position[axIdx], 3)}`;
          } else if (cur) {
            display = ax;
          }
        } else if (transformMode === 'rotate' && ax !== 'FREE') {
          const angleDeg = ((dx + dy) * 0.01 * 180 / Math.PI);
          display = `${ax}: ${safeFixed(angleDeg, 1)}°`;
        } else if (transformMode === 'scale') {
          const delta = 1 + (dx - dy) * 0.005;
          display = `${ax}: ×${safeFixed(delta, 3)}`;
        }
        if (display) {
          gizmoDisplayRef.current.style.display = 'block';
          gizmoDisplayRef.current.textContent = display;
        } else {
          gizmoDisplayRef.current.style.display = 'none';
        }
      }
    };

    const handleMouseUp = (event: PointerEvent) => {
      // Always clear pending marquee on release
      pendingMarqueeRef.current = null;

      // ── Marquee selection end ─────────────────────────────────────────────
      if (marqueeRef.current && rendererRef.current && cameraRef.current) {
        const rect = rendererRef.current.domElement.getBoundingClientRect();
        const box = {
          x1: Math.min(marqueeRef.current.start.x, marqueeRef.current.end.x),
          y1: Math.min(marqueeRef.current.start.y, marqueeRef.current.end.y),
          x2: Math.max(marqueeRef.current.start.x, marqueeRef.current.end.x),
          y2: Math.max(marqueeRef.current.start.y, marqueeRef.current.end.y)
        };
        
        const width = rect.width;
        const height = rect.height;
        const isMulti = event.shiftKey || event.ctrlKey || event.metaKey;
        
        if (Math.abs(box.x2 - box.x1) > 5 || Math.abs(box.y2 - box.y1) > 5) {
          // Box selection logic
          if (editMode === 'OBJECT') {
            const newSelection = isMulti ? [...selectedObjectIds] : [];
            projectRef.current.objects.forEach(obj => {
              if (!obj.visible) return;
              const _interp = getInterpolatedTransform(obj, currentTime);
              const mat4 = new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
              
              // Check origin first
              const originWorld = new THREE.Vector3(0,0,0).applyMatrix4(mat4);
              const originNDC = originWorld.project(cameraRef.current!);
              const osx = (originNDC.x * 0.5 + 0.5) * width;
              const osy = (originNDC.y * -0.5 + 0.5) * height;
              
              let hit = (osx >= box.x1 && osx <= box.x2 && osy >= box.y1 && osy <= box.y2);
              
              if (!hit) {
                // Check vertices if origin is not in box
                for (let i = 0; i < obj.vertices.length; i++) {
                  const v = obj.vertices[i];
                  const off = obj.vertexOffsets?.[i] ?? [0,0,0];
                  const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
                  const ndc = world.project(cameraRef.current!);
                  const sx = (ndc.x * 0.5 + 0.5) * width;
                  const sy = (ndc.y * -0.5 + 0.5) * height;
                  if (sx >= box.x1 && sx <= box.x2 && sy >= box.y1 && sy <= box.y2) {
                    hit = true; break;
                  }
                }
              }
              if (hit && !newSelection.includes(obj.id)) newSelection.push(obj.id);
            });
            
            if (newSelection.length > 0 || !isMulti) {
              useStore.setState({ 
                selectedObjectIds: newSelection, 
                selectedObjectId: newSelection[newSelection.length-1] ?? null 
              });
            }
          } else if (editMode === 'VERTEX' && selectedObjectId) {
            const obj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (obj) {
              const _interp = getInterpolatedTransform(obj, currentTime);
              const mat4 = new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
              const newIndices = isMulti ? [...selectedVertexIndices] : [];
              obj.vertices.forEach((v, i) => {
                const off = obj.vertexOffsets?.[i] ?? [0,0,0];
                const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
                const ndc = world.project(cameraRef.current!);
                const sx = (ndc.x * 0.5 + 0.5) * width;
                const sy = (ndc.y * -0.5 + 0.5) * height;
                if (sx >= box.x1 && sx <= box.x2 && sy >= box.y1 && sy <= box.y2) {
                  if (!newIndices.includes(i)) newIndices.push(i);
                }
              });
              setSelectedVertexIndices(newIndices);
            }
          } else if (editMode === 'FACE' && selectedObjectId) {
            const obj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (obj && obj.faces) {
              const _interp = getInterpolatedTransform(obj, currentTime);
              const mat4 = new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
              const newFaces = isMulti ? [...selectedFaceIndices] : [];
              const newVerts = isMulti ? new Set(selectedVertexIndices) : new Set<number>();
              
              obj.faces.forEach((face, fi) => {
                // Check if ALL vertices of the face are within the box
                let allIn = true;
                for (const vi of face.indices) {
                  const v = obj.vertices[vi];
                  const off = obj.vertexOffsets?.[vi] ?? [0,0,0];
                  const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
                  const ndc = world.project(cameraRef.current!);
                  const sx = (ndc.x * 0.5 + 0.5) * width;
                  const sy = (ndc.y * -0.5 + 0.5) * height;
                  if (!(sx >= box.x1 && sx <= box.x2 && sy >= box.y1 && sy <= box.y2)) {
                    allIn = false; break;
                  }
                }
                if (allIn) {
                  if (!newFaces.includes(fi)) {
                    newFaces.push(fi);
                    face.indices.forEach(vi => newVerts.add(vi));
                  }
                }
              });
              setSelectedFaceIndices(newFaces);
              setSelectedVertexIndices(Array.from(newVerts));
            }
          } else if (editMode === 'EDGE' && selectedObjectId) {
            const obj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (obj && obj.faces) {
              const _interp = getInterpolatedTransform(obj, currentTime);
              const mat4 = new THREE.Matrix4().compose(
                new THREE.Vector3().fromArray(_interp.position),
                new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                new THREE.Vector3().fromArray(_interp.scale)
              );
              const newEdges = isMulti ? [...selectedEdgeIndices] : [];
              const newVerts = isMulti ? new Set(selectedVertexIndices) : new Set<number>();
              
              // Extract all unique edges
              const edgeSet = new Set<string>();
              obj.faces.forEach(face => {
                for (let i = 0; i < face.indices.length; i++) {
                  const v1 = face.indices[i];
                  const v2 = face.indices[(i + 1) % face.indices.length];
                  const key = [v1, v2].sort().join(',');
                  if (!edgeSet.has(key)) {
                    edgeSet.add(key);
                    // Check if both vertices are in the box
                    const pts = [v1, v2].map(vi => {
                      const v = obj.vertices[vi];
                      const off = obj.vertexOffsets?.[vi] ?? [0,0,0];
                      const world = new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(mat4);
                      const ndc = world.project(cameraRef.current!);
                      return { sx: (ndc.x * 0.5 + 0.5) * width, sy: (ndc.y * -0.5 + 0.5) * height };
                    });
                    if (pts.every(p => p.sx >= box.x1 && p.sx <= box.x2 && p.sy >= box.y1 && p.sy <= box.y2)) {
                      newEdges.push(v1, v2);
                      newVerts.add(v1); newVerts.add(v2);
                    }
                  }
                }
              });
              setSelectedEdgeIndices(newEdges);
              setSelectedVertexIndices(Array.from(newVerts));
            }
          }
          (mouseRef.current as any)._pendingDeselect = false;
        }

        marqueeRef.current = null;
        if (controlsRef.current) {
          const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
            silueta.activePlane.toUpperCase() === type.toUpperCase()
          );
          controlsRef.current.enabled = !drawMode && !isSiluetaActiveInThisViewport && !moveReferenceMode;
        }
        event.stopPropagation();
        return;
      }

      // ── Reference Image drag end ──────────────────────────────────────────
      if (refDragRef.current) {
        refDragRef.current = null;
        saveHistory();
        event.stopPropagation();
        
        if (controlsRef.current) {
          const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
            silueta.activePlane.toUpperCase() === type.toUpperCase()
          );
          controlsRef.current.enabled = !drawMode && !isSiluetaActiveInThisViewport && !moveReferenceMode;
        }
        return;
      }

      // ── Silueta drag end ──────────────────────────────────────────────────
      if (siluetaDragRef.current) {
        siluetaDragRef.current = null;
        if (controlsRef.current) {
          const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
            silueta.activePlane.toUpperCase() === type.toUpperCase()
          );
          controlsRef.current.enabled = !drawMode && !isSiluetaActiveInThisViewport && !moveReferenceMode;
        }
        event.stopPropagation();
        return;
      }

      if (gizmoStateRef.current.activeAxis!==null) { 
        gizmoStateRef.current.activeAxis=null; 
        saveHistory(); 
        event.stopPropagation();
      }
      if (gizmoDisplayRef.current) gizmoDisplayRef.current.style.display = 'none';
      
      if ((mouseRef.current as any)._pendingDeselect) {
        const startPos = (mouseRef.current as any).pointerDownPos || gizmoStateRef.current.startScreenPos || { x: event.clientX, y: event.clientY };
        const dx = event.clientX - startPos.x;
        const dy = event.clientY - startPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 5) {
          // It was a click, not a drag. Perform selection raycast here.
          const rect = rendererRef.current!.domElement.getBoundingClientRect();
          mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current!);
          
          let hitSomething = false;

          if (editMode === 'VERTEX' && vertexPointsRef.current) {
            if (cameraRef.current instanceof THREE.PerspectiveCamera) {
              const dist = cameraRef.current.position.distanceTo(vertexPointsRef.current.position);
              raycasterRef.current.params.Points.threshold = Math.max(0.1, dist * 0.02);
            } else {
              raycasterRef.current.params.Points.threshold = 0.5;
            }
            const hits = raycasterRef.current.intersectObject(vertexPointsRef.current);
            if (hits.length) {
              hitSomething = true;
              const index = hits[0].index;
              if (index !== undefined) {
                const indices = getCoincidentVertices(vertexPointsRef.current.geometry, index);
                const isCtrl = event.ctrlKey || event.metaKey || event.shiftKey;
                if (isCtrl) {
                  const cur = new Set(selectedVertexIndices);
                  if (indices.every(i => cur.has(i))) setSelectedVertexIndices(selectedVertexIndices.filter(i => !indices.includes(i)));
                  else addSelectedVertexIndices(indices);
                } else setSelectedVertexIndices(indices);
              }
            }
          } else if (editMode === 'FACE' && primitivesGroupRef.current) {
            const hits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, true);
            if (hits.length) {
              hitSomething = true;
              const intersect = hits[0];
              if (intersect.face) {
                const mesh = intersect.object as THREE.Mesh;
                const clickedId = mesh.userData.id;
                if (clickedId && clickedId !== selectedObjectId) selectObject(clickedId);
                if (clickedId) {
                  const faceMap = mesh.userData.faceMap as number[] | undefined;
                  const faceIndex = intersect.faceIndex;
                  if (faceMap && faceIndex !== undefined && faceIndex < faceMap.length) {
                    const logicalFaceIdx = faceMap[faceIndex];
                    const isCtrl = event.ctrlKey || event.metaKey || event.shiftKey;
                    let newFaces: number[];
                    if (isCtrl) {
                      const cur = new Set(selectedFaceIndices);
                      if (cur.has(logicalFaceIdx)) newFaces = selectedFaceIndices.filter(f => f !== logicalFaceIdx);
                      else newFaces = [...selectedFaceIndices, logicalFaceIdx];
                    } else newFaces = [logicalFaceIdx];
                    setSelectedFaceIndices(newFaces);

                    const vSet = new Set<number>();
                    const selObj = projectRef.current.objects.find(o => o.id === clickedId);
                    if (selObj && selObj.faces) {
                      newFaces.forEach(fIdx => {
                        const face = selObj.faces[fIdx];
                        if (face) face.indices.forEach(vi => vSet.add(vi));
                      });
                    }
                    setSelectedVertexIndices(Array.from(vSet));
                  }
                }
              }
            }
          } else if (editMode === 'EDGE' && primitivesGroupRef.current) {
            const hits = raycasterRef.current.intersectObjects(primitivesGroupRef.current.children, true);
            if (hits.length) {
              hitSomething = true;
              const intersect = hits[0];
              if (intersect.face) {
                const mesh = intersect.object as THREE.Mesh;
                const clickedId = mesh.userData.id;
                if (clickedId && clickedId !== selectedObjectId) selectObject(clickedId);
                const selObj = projectRef.current.objects.find(o => o.id === (clickedId || selectedObjectId));
                if (selObj && selObj.vertices && selObj.vertices.length > 0) {
                  const pt = intersect.point;
                  const validEdges = extractUniqueEdges(selObj);
                  let bestEdge: [number, number] | null = null;
                  let bestDist = Infinity;

                  for (const [v1, v2] of validEdges) {
                    const vert1 = selObj.vertices[v1];
                    const vert2 = selObj.vertices[v2];
                    if (!vert1 || !vert2) continue;
                    const off1 = selObj.vertexOffsets?.[v1] || [0, 0, 0];
                    const off2 = selObj.vertexOffsets?.[v2] || [0, 0, 0];
                    const pa = new THREE.Vector3(vert1[0] + off1[0], vert1[1] + off1[1], vert1[2] + off1[2]).applyMatrix4(mesh.matrixWorld);
                    const pb = new THREE.Vector3(vert2[0] + off2[0], vert2[1] + off2[1], vert2[2] + off2[2]).applyMatrix4(mesh.matrixWorld);
                    const dist = new THREE.Line3(pa, pb).closestPointToPoint(pt, true, new THREE.Vector3()).distanceTo(pt);
                    if (dist < bestDist) {
                      bestDist = dist;
                      bestEdge = [v1, v2];
                    }
                  }

                  if (bestEdge) {
                    const edge = bestEdge;
                    const isCtrl = event.ctrlKey || event.metaKey || event.shiftKey;
                    let ne: number[] = [];
                    if (isCtrl) {
                      const edgeExists = (v1: number, v2: number) => {
                        for (let i = 0; i < selectedEdgeIndices.length; i += 2)
                          if ((selectedEdgeIndices[i] === v1 && selectedEdgeIndices[i + 1] === v2) || (selectedEdgeIndices[i] === v2 && selectedEdgeIndices[i + 1] === v1)) return true;
                        return false;
                      };
                      if (edgeExists(edge[0], edge[1])) {
                        for (let i = 0; i < selectedEdgeIndices.length; i += 2) {
                          const v1 = selectedEdgeIndices[i], v2 = selectedEdgeIndices[i + 1];
                          if (!((v1 === edge[0] && v2 === edge[1]) || (v1 === edge[1] && v2 === edge[0]))) ne.push(v1, v2);
                        }
                      } else {
                        ne = [...selectedEdgeIndices, edge[0], edge[1]];
                      }
                    } else {
                      ne = [edge[0], edge[1]];
                    }
                    setSelectedEdgeIndices(ne);
                    setSelectedVertexIndices(Array.from(new Set(ne)));
                  }
                }
              }
            }
          } else if (editMode === 'OBJECT') {
            // Adaptive line threshold based on viewport & zoom
            if (cameraRef.current instanceof THREE.PerspectiveCamera) {
              const camDist = cameraRef.current.position.length();
              raycasterRef.current.params.Line.threshold = Math.max(0.2, (camDist * Math.tan((cameraRef.current.fov * Math.PI) / 360) / rect.height) * 20);
            } else if (cameraRef.current instanceof THREE.OrthographicCamera) {
              const cam = cameraRef.current;
              const worldPerPixel = (cam.top - cam.bottom) / (cam.zoom * rect.height);
              raycasterRef.current.params.Line.threshold = Math.max(0.25, worldPerPixel * 20);
            } else {
              raycasterRef.current.params.Line.threshold = 0.25;
            }

            const targets = [
              ...groupRef.current.children,
              ...(Array.from(lightsRef.current.values()) as THREE.Object3D[]),
              ...(Array.from(camerasRef.current.values()) as THREE.Object3D[])
            ];
            const hits = raycasterRef.current.intersectObjects(targets, true);
            if (hits.length) {
              hitSomething = true;
              const hit = hits[0];
              
              // Find the closest parent that has an ID
              let currentObj: THREE.Object3D | null = hit.object;
              let clickedId = null;
              let isLight = false;
              let isCamera = false;
              
              while (currentObj) {
                if (currentObj.userData?.id) {
                  clickedId = currentObj.userData.id;
                  isLight = !!currentObj.userData.isLight;
                  isCamera = !!currentObj.userData.isCamera;
                  break;
                }
                // Check if it's a helper (they usually have the original object as a property or we can infer from name/type)
                if (currentObj.type.includes('Helper') && currentObj.parent?.userData?.id) {
                   clickedId = currentObj.parent.userData.id;
                   isLight = !!currentObj.parent.userData.isLight;
                   isCamera = !!currentObj.parent.userData.isCamera;
                   break;
                }
                currentObj = currentObj.parent;
              }
              
              if (clickedId) {
                if (isLight) {
                  selectLight(clickedId);
                } else if (isCamera) {
                  selectCamera(clickedId);
                } else {
                  const isCtrl = event.shiftKey || event.ctrlKey || event.metaKey;
                  if (isCtrl && toggleObjectSelection) toggleObjectSelection(clickedId, true);
                  else selectObject(clickedId);
                }
              }
            } else {
              // Screen-space 2D fallback selection for lines / shapes
              const clickScreenX = event.clientX - rect.left;
              const clickScreenY = event.clientY - rect.top;
              const cam = cameraRef.current;
              let closestShapeId: string | null = null;
              let minPixelDist = 22; // 22px generous hit target for lines

              if (cam) {
                projectRef.current.objects.forEach(o => {
                  if (!o.visible) return;
                  if (o.type === 'SHAPE' && o.vertices && o.vertices.length >= 2) {
                    const _t = getInterpolatedTransform(o, currentTime);
                    const pos = new THREE.Vector3(..._t.position);
                    const rot = new THREE.Euler(..._t.rotation);
                    const scl = new THREE.Vector3(..._t.scale);
                    const objMat = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), scl);

                    const rawVerts = o.vertices.map((v, i) => {
                      const off = o.vertexOffsets?.[i] ?? [0,0,0];
                      return new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]).applyMatrix4(objMat);
                    });

                    const samplePts: THREE.Vector3[] = [];
                    const isBez = o.parameters?.shapeType === 'bezier' && o.bezierHandles;
                    if (isBez && rawVerts.length >= 2) {
                      const loopCount = o.parameters?.closed ? rawVerts.length : rawVerts.length - 1;
                      for (let i = 0; i < loopCount; i++) {
                        const i1 = (i + 1) % rawVerts.length;
                        const h = o.bezierHandles!;
                        if (!h[i] || !h[i1]) continue;
                        const p0 = rawVerts[i];
                        const p1 = p0.clone().add(new THREE.Vector3(...h[i].out).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).multiply(scl));
                        const p3 = rawVerts[i1];
                        const p2 = p3.clone().add(new THREE.Vector3(...h[i1].in).applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)).multiply(scl));
                        const seg = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
                        samplePts.push(...seg.getPoints(12));
                      }
                    } else {
                      samplePts.push(...rawVerts);
                      if (o.parameters?.closed && rawVerts.length > 2) {
                        samplePts.push(rawVerts[0]);
                      }
                    }

                    for (let i = 0; i < samplePts.length - 1; i++) {
                      const pA = samplePts[i].clone().project(cam);
                      const pB = samplePts[i+1].clone().project(cam);
                      if (pA.z > 1 && pB.z > 1) continue;

                      const sAx = ((pA.x + 1) / 2) * rect.width;
                      const sAy = ((-pA.y + 1) / 2) * rect.height;
                      const sBx = ((pB.x + 1) / 2) * rect.width;
                      const sBy = ((-pB.y + 1) / 2) * rect.height;

                      const ldx = sBx - sAx;
                      const ldy = sBy - sAy;
                      const lSq = ldx * ldx + ldy * ldy;
                      let d = Infinity;
                      if (lSq === 0) {
                        d = Math.hypot(clickScreenX - sAx, clickScreenY - sAy);
                      } else {
                        let t = ((clickScreenX - sAx) * ldx + (clickScreenY - sAy) * ldy) / lSq;
                        t = Math.max(0, Math.min(1, t));
                        const projX = sAx + t * ldx;
                        const projY = sAy + t * ldy;
                        d = Math.hypot(clickScreenX - projX, clickScreenY - projY);
                      }

                      if (d < minPixelDist) {
                        minPixelDist = d;
                        closestShapeId = o.id;
                      }
                    }
                  }
                });
              }

              if (closestShapeId) {
                hitSomething = true;
                const isCtrl = event.shiftKey || event.ctrlKey || event.metaKey;
                if (isCtrl && toggleObjectSelection) toggleObjectSelection(closestShapeId, true);
                else selectObject(closestShapeId);
              } else if (event.button === 0) {
                selectObject(null);
                selectLight(null);
                selectCamera(null);
              }
            }
          }
          
          if ((editMode === 'VERTEX' || editMode === 'EDGE' || insertVertexMode || loopCutMode) && selectedObjectId && !hitSomething) {
            const obj = projectRef.current.objects.find(o => o.id === selectedObjectId);
            if (obj && obj.vertices && obj.vertices.length >= 2) {
              const meshObj = primitivesGroupRef.current?.children.find(c => (c as any).userData?.id === selectedObjectId) as THREE.Mesh | undefined;
              const mat4 = meshObj ? meshObj.matrixWorld : (() => {
                const _interp = getInterpolatedTransform(obj, currentTime);
                return new THREE.Matrix4().compose(
                  new THREE.Vector3().fromArray(_interp.position),
                  new THREE.Quaternion().setFromEuler(new THREE.Euler().fromArray(_interp.rotation)),
                  new THREE.Vector3().fromArray(_interp.scale)
                );
              })();
              const invMat = mat4.clone().invert();

              const width = rendererRef.current!.domElement.clientWidth;
              const height = rendererRef.current!.domElement.clientHeight;
              const rect = rendererRef.current!.domElement.getBoundingClientRect();
              const sx = event.clientX - rect.left;
              const sy = event.clientY - rect.top;

              if (obj.type === 'SHAPE') {
                const rawVerts = obj.vertices.map((v, i) => {
                  const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
                  return new THREE.Vector3(v[0] + off[0], v[1] + off[1], v[2] + off[2]).applyMatrix4(mat4);
                });

                let minSegDist = 24; // 24px screen distance threshold
                let bestSeg = -1;
                let bestWorldPt: THREE.Vector3 | null = null;

                const isClosed = !!obj.parameters?.closed;
                const segCount = isClosed ? rawVerts.length : rawVerts.length - 1;

                for (let i = 0; i < segCount; i++) {
                  const p1 = rawVerts[i];
                  const p2 = rawVerts[(i + 1) % rawVerts.length];
                  const ndc1 = p1.clone().project(cameraRef.current!);
                  const ndc2 = p2.clone().project(cameraRef.current!);
                  if (ndc1.z > 1 && ndc2.z > 1) continue;

                  const s1 = { x: (ndc1.x * 0.5 + 0.5) * width, y: (ndc1.y * -0.5 + 0.5) * height };
                  const s2 = { x: (ndc2.x * 0.5 + 0.5) * width, y: (ndc2.y * -0.5 + 0.5) * height };

                  const distTo1 = Math.hypot(sx - s1.x, sy - s1.y);
                  const distTo2 = Math.hypot(sx - s2.x, sy - s2.y);
                  if (distTo1 <= 16 || distTo2 <= 16) continue;

                  const dx = s2.x - s1.x;
                  const dy = s2.y - s1.y;
                  const lenSq = dx * dx + dy * dy;
                  if (lenSq === 0) continue;

                  let t = ((sx - s1.x) * dx + (sy - s1.y) * dy) / lenSq;
                  if (t < 0.04 || t > 0.96) continue;

                  const projX = s1.x + t * dx;
                  const projY = s1.y + t * dy;
                  const dist = Math.hypot(sx - projX, sy - projY);

                  if (dist < minSegDist) {
                    minSegDist = dist;
                    bestSeg = i;
                    bestWorldPt = p1.clone().lerp(p2, t);
                  }
                }

                if (bestSeg >= 0 && bestWorldPt) {
                  const localPt = bestWorldPt.clone().applyMatrix4(invMat);
                  useStore.getState().insertShapeVertexAtPoint(selectedObjectId, [localPt.x, localPt.y, localPt.z], bestSeg);
                  hitSomething = true;
                }
              } else {
                // 3D Mesh edge insertion / loop cut
                const validEdges = extractUniqueEdges(obj, { dissolveCoplanars: false });
                let minEdgeDist = 24; // 24px screen distance threshold
                let bestEdge: [number, number] | null = null;
                let bestWorldPt: THREE.Vector3 | null = null;

                for (const [v1, v2] of validEdges) {
                  const vert1 = obj.vertices[v1];
                  const vert2 = obj.vertices[v2];
                  if (!vert1 || !vert2) continue;
                  const off1 = obj.vertexOffsets?.[v1] || [0, 0, 0];
                  const off2 = obj.vertexOffsets?.[v2] || [0, 0, 0];
                  const pa = new THREE.Vector3(vert1[0] + off1[0], vert1[1] + off1[1], vert1[2] + off1[2]).applyMatrix4(mat4);
                  const pb = new THREE.Vector3(vert2[0] + off2[0], vert2[1] + off2[1], vert2[2] + off2[2]).applyMatrix4(mat4);

                  const pA_ndc = pa.clone().project(cameraRef.current!);
                  const pB_ndc = pb.clone().project(cameraRef.current!);
                  if (pA_ndc.z > 1 && pB_ndc.z > 1) continue;

                  const sAx = (pA_ndc.x * 0.5 + 0.5) * width;
                  const sAy = (pA_ndc.y * -0.5 + 0.5) * height;
                  const sBx = (pB_ndc.x * 0.5 + 0.5) * width;
                  const sBy = (pB_ndc.y * -0.5 + 0.5) * height;

                  const distToA = Math.hypot(sx - sAx, sy - sAy);
                  const distToB = Math.hypot(sx - sBx, sy - sBy);
                  if (distToA <= 16 || distToB <= 16) continue;

                  const dx = sBx - sAx;
                  const dy = sBy - sAy;
                  const lenSq = dx * dx + dy * dy;
                  if (lenSq === 0) continue;

                  let t = ((sx - sAx) * dx + (sy - sAy) * dy) / lenSq;
                  if (t < 0.04 || t > 0.96) continue;

                  const projX = sAx + t * dx;
                  const projY = sAy + t * dy;
                  const dist = Math.hypot(sx - projX, sy - projY);

                  if (dist < minEdgeDist) {
                    minEdgeDist = dist;
                    bestEdge = [v1, v2];
                    bestWorldPt = pa.clone().lerp(pb, t);
                  }
                }

                if (bestEdge && bestWorldPt) {
                  if (loopCutMode && obj.faces && obj.faces.length > 0) {
                    // Execute Loop Cut on the clicked edge
                    useStore.getState().applyLoopCut(
                      selectedObjectId,
                      [bestEdge[0], bestEdge[1]],
                      loopCutCuts,
                      loopCutSlide
                    );
                    hitSomething = true;
                  } else {
                    const localPt = bestWorldPt.clone().applyMatrix4(invMat);
                    useStore.getState().insertVertexOnEdge(
                      selectedObjectId,
                      [bestEdge[0], bestEdge[1]],
                      [localPt.x, localPt.y, localPt.z]
                    );
                    hitSomething = true;
                  }
                }
              }
            }
          }

          if (!hitSomething && event.button === 0) {
            // Clicking outside figure resets gizmo to normal (universal) state and deselects
            setTransformMode('universal');
            gizmoStateRef.current.activeAxis = null;
            if (editMode === 'OBJECT') {
              selectObject(null);
              selectLight(null);
              selectCamera(null);
            } else {
              const curObj = projectRef.current.objects.find(o => o.id === selectedObjectId);
              const hasSubSelection =
                selectedVertexIndices.length > 0 ||
                selectedFaceIndices.length > 0 ||
                selectedEdgeIndices.length > 0 ||
                !!(curObj?.selectedNurbsControlPoint || (curObj?.selectedNurbsControlPoints && curObj.selectedNurbsControlPoints.length > 0));
              if (hasSubSelection) {
                clearSelection();
              } else {
                selectObject(null);
                selectLight(null);
                selectCamera(null);
              }
            }
          }
        }
        (mouseRef.current as any)._pendingDeselect = false;
      }
      
      // Always re-enable controls so pan/orbit is never permanently stuck
      if (controlsRef.current) {
        const isSiluetaActiveInThisViewport = !!(silueta.activePlane && 
          silueta.activePlane.toUpperCase() === type.toUpperCase()
        );
        controlsRef.current.enabled = !drawMode && !isSiluetaActiveInThisViewport && !moveReferenceMode;
      }
      if (isDraggingRef.current) {
        saveHistory();
        isDraggingRef.current = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      // ── Global Undo / Redo in Viewport ───────────────────────────────
      if (event.ctrlKey || event.metaKey) {
        const k = event.key.toLowerCase();
        if (k === 'z') {
          event.preventDefault();
          if (event.shiftKey) useStore.getState().redo();
          else useStore.getState().undo();
          return;
        }
        if (k === 'y') {
          event.preventDefault();
          useStore.getState().redo();
          return;
        }
      }

      // ── SHAPE / CURVE editing hotkeys ────────────────────────────────
      const shapeObj = selectedObjectId
        ? useStore.getState().project.objects.find(o => o.id === selectedObjectId)
        : null;
      const isShapeSelected = shapeObj?.type === 'SHAPE';

      // Delete selected control point / vertices (VERTEX mode on a SHAPE or MESH)
      if (selectedObjectId && editMode === 'VERTEX' &&
          (event.key === 'Delete' || event.key === 'Backspace' || event.key === 'x' || event.key === 'X') &&
          selectedVertexIndices.length > 0) {
        event.preventDefault();
        useStore.getState().deleteSelectedVertices(selectedObjectId, selectedVertexIndices);
        return;
      }

      // Toggle close/open curve (C key on a SHAPE)
      if (isShapeSelected && (event.key === 'c' || event.key === 'C') && !event.ctrlKey) {
        event.preventDefault();
        const obj = shapeObj!;
        useStore.getState().updateObject(selectedObjectId!, {
          parameters: { ...obj.parameters, closed: !obj.parameters.closed }
        });
        saveHistory();
        return;
      }

      // Weld vertices (W key on SHAPE or MESH)
      if ((event.key === 'w' || event.key === 'W') && !event.ctrlKey && selectedObjectId && (editMode === 'VERTEX' || isShapeSelected)) {
        event.preventDefault();
        useStore.getState().weldSelectedVertices(selectedObjectId, selectedVertexIndices);
        return;
      }

      // Subdivide segment / line in 2 (D key on a SHAPE)
      if (isShapeSelected && (event.key === 'd' || event.key === 'D') && !event.ctrlKey) {
        event.preventDefault();
        useStore.getState().subdivideShapeSegment(selectedObjectId!);
        return;
      }

      // Toggle insert vertex mode (I key)
      if (isShapeSelected && (event.key === 'i' || event.key === 'I') && !event.ctrlKey) {
        event.preventDefault();
        useStore.getState().setInsertVertexMode(!insertVertexMode);
        return;
      }

      // Toggle Escuadra 90° / Ortho drawing mode (Q key)
      if (drawMode && (event.key === 'q' || event.key === 'Q') && !event.ctrlKey) {
        event.preventDefault();
        useStore.getState().setOrthoDrawMode(!useStore.getState().orthoDrawMode);
        return;
      }


      // ── Sub-element Edit Mode Switchers (1 = Object, 2 = Face, 3 = Edge, 4 = Vertex) ──
      if (event.key === '1') { event.preventDefault(); useStore.getState().setEditMode('OBJECT'); return; }
      if (event.key === '2') { event.preventDefault(); useStore.getState().setEditMode('FACE'); return; }
      if (event.key === '3') { event.preventDefault(); useStore.getState().setEditMode('EDGE'); return; }
      if (event.key === '4') { event.preventDefault(); useStore.getState().setEditMode('VERTEX'); return; }

      // ── VERTEX MODE OPERATIONS ──
      if (editMode === 'VERTEX' && selectedObjectId) {
        // Delete Vertices (Delete / Backspace)
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedVertexIndices.length > 0) {
            event.preventDefault();
            useStore.getState().deleteSelectedVertices(selectedObjectId, selectedVertexIndices);
            return;
          }
        }
        // Connect Vertices with Line / Split Face (J key)
        if ((event.key === 'j' || event.key === 'J') && !event.ctrlKey) {
          event.preventDefault();
          useStore.getState().connectVertices(selectedObjectId, selectedVertexIndices);
          return;
        }
        // Create Face / Fill Polygon from Vertices (F key)
        if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey) {
          event.preventDefault();
          useStore.getState().createFaceFromVertices(selectedObjectId, selectedVertexIndices);
          return;
        }
        // Extrude Vertices into new Segments (E key)
        if ((event.key === 'e' || event.key === 'E') && !event.ctrlKey && selectedVertexIndices.length > 0) {
          event.preventDefault();
          useStore.getState().extrudeSelectedVertices(selectedObjectId, selectedVertexIndices);
          return;
        }
        // Weld Selected Vertices (W key without Ctrl)
        if ((event.key === 'w' || event.key === 'W') && !event.ctrlKey && selectedVertexIndices.length >= 2) {
          event.preventDefault();
          useStore.getState().weldSelectedVertices(selectedObjectId, selectedVertexIndices, 0.05);
          return;
        }
      }

      // ── FACE MODE OPERATIONS ──
      if (editMode === 'FACE' && selectedObjectId) {
        // Delete Faces (Delete / Backspace)
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedFaceIndices.length > 0) {
            event.preventDefault();
            useStore.getState().deleteSelectedFaces(selectedObjectId, selectedFaceIndices);
            return;
          }
        }
        // Extrude (E or Ctrl+E)
        if ((event.key === 'e' || event.key === 'E') && selectedFaceIndices.length > 0) {
          event.preventDefault();
          useStore.getState().extrudeFaces(selectedObjectId, selectedFaceIndices, 0.35);
          return;
        }
        // Inset (I)
        if ((event.key === 'i' || event.key === 'I') && !event.ctrlKey && selectedFaceIndices.length > 0) {
          event.preventDefault();
          useStore.getState().insetFaces(selectedObjectId, selectedFaceIndices, 0.2);
          return;
        }
        // Subdivide Faces (D without Ctrl)
        if ((event.key === 'd' || event.key === 'D') && !event.ctrlKey && !event.metaKey && selectedFaceIndices.length > 0) {
          event.preventDefault();
          useStore.getState().subdivideFaces(selectedObjectId, selectedFaceIndices);
          return;
        }
        // Merge / Dissolve Faces (M)
        if ((event.key === 'm' || event.key === 'M') && !event.ctrlKey && selectedFaceIndices.length >= 2) {
          event.preventDefault();
          useStore.getState().mergeFaces(selectedObjectId, selectedFaceIndices);
          return;
        }
        // Cap / Tapar Hueco (F)
        if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey) {
          event.preventDefault();
          useStore.getState().capSelectedFacesObject(selectedObjectId);
          return;
        }
      }

      // ── EDGE MODE OPERATIONS ──
      if (editMode === 'EDGE' && selectedObjectId) {
        // Delete Edge (Delete / Backspace)
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedEdgeIndices.length >= 2) {
            event.preventDefault();
            useStore.getState().deleteSelectedEdges(selectedObjectId, selectedEdgeIndices);
            return;
          }
        }
        // Dissolve Edge (X)
        if ((event.key === 'x' || event.key === 'X') && !event.ctrlKey && selectedEdgeIndices.length >= 2) {
          event.preventDefault();
          useStore.getState().dissolveSelectedEdges(selectedObjectId, selectedEdgeIndices);
          return;
        }
        // Bevel / Chaflán (B)
        if ((event.key === 'b' || event.key === 'B') && !event.ctrlKey && selectedEdgeIndices.length >= 2) {
          event.preventDefault();
          useStore.getState().bevelSelectedEdges(selectedObjectId, selectedEdgeIndices, 0.1, 3);
          return;
        }
        // Subdivide Edge at Midpoint (D without Ctrl)
        if ((event.key === 'd' || event.key === 'D') && !event.ctrlKey && !event.metaKey && selectedEdgeIndices.length >= 2) {
          event.preventDefault();
          useStore.getState().subdivideSelectedEdges(selectedObjectId, selectedEdgeIndices);
          return;
        }
        // Bridge / Crear Cara (F)
        if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && selectedEdgeIndices.length >= 4) {
          event.preventDefault();
          useStore.getState().bridgeSelectedEdges(selectedObjectId, selectedEdgeIndices);
          return;
        }
      }

      // ── GLOBAL EDIT MODE SHORTCUTS ──
      // Dissolve Selection (Ctrl + X / Cmd + X) — Blender style: disuelve sin romper la malla
      if ((event.ctrlKey || event.metaKey) && (event.key === 'x' || event.key === 'X') && selectedObjectId) {
        event.preventDefault();
        if (editMode === 'VERTEX' && selectedVertexIndices.length > 0) {
          useStore.getState().dissolveSelectedVerticesAction(selectedObjectId, selectedVertexIndices);
          return;
        } else if (editMode === 'EDGE' && selectedEdgeIndices.length >= 2) {
          useStore.getState().dissolveSelectedEdges(selectedObjectId, selectedEdgeIndices);
          return;
        } else if (editMode === 'FACE' && selectedFaceIndices.length > 0) {
          useStore.getState().dissolveSelectedFacesAction(selectedObjectId, selectedFaceIndices);
          return;
        } else {
          useStore.getState().dissolveCoplanarObject(selectedObjectId, 10.0);
          return;
        }
      }

      // Collapse Selection (Alt + X) — Colapsa vértices, aristas o caras a un único punto central
      if (event.altKey && (event.key === 'x' || event.key === 'X') && selectedObjectId) {
        event.preventDefault();
        useStore.getState().collapseSelectedAction(selectedObjectId);
        return;
      }

      // Quad Remesh (Ctrl + Alt + R) — Blender Quadriflow shortcut
      if ((event.ctrlKey || event.metaKey) && event.altKey && (event.key === 'r' || event.key === 'R') && selectedObjectId) {
        event.preventDefault();
        useStore.getState().retopologizeObject(selectedObjectId, { targetCount: 2000, mode: 'QUAD_DOMINANT' });
        return;
      }

      // Voxel Remesh (Ctrl + Shift + R) — Blender Voxel Remesher shortcut
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'r' || event.key === 'R') && selectedObjectId) {
        event.preventDefault();
        useStore.getState().applyVoxelRemeshToObject(selectedObjectId, { voxelResolution: 64 });
        return;
      }

      // Merge by Distance / Weld (M key in Vertex Mode)
      if ((event.key === 'm' || event.key === 'M') && !event.ctrlKey && !event.metaKey && selectedObjectId && editMode === 'VERTEX') {
        event.preventDefault();
        if (selectedVertexIndices.length >= 2) {
          useStore.getState().weldSelectedVertices(selectedObjectId, selectedVertexIndices, 0.05);
        } else {
          useStore.getState().mergeVerticesByDistanceAction(selectedObjectId, 0.001);
        }
        return;
      }

      // Loop Cut & Slide (Ctrl + R / Cmd + R)
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        const currentLoopCut = useStore.getState().loopCutMode;
        useStore.setState({ loopCutMode: !currentLoopCut });
        return;
      }

      // Extrude Manifold (Alt + E)
      if (event.altKey && (event.key === 'e' || event.key === 'E')) {
        event.preventDefault();
        const { selectedObjectId, selectedFaceIndices, editMode } = useStore.getState();
        if (selectedObjectId && editMode === 'FACE' && selectedFaceIndices.length > 0) {
          useStore.getState().extrudeManifold(selectedObjectId, selectedFaceIndices, 0.4);
        }
        return;
      }

      switch(event.key.toLowerCase()) {
        case 'g': case 'w': 
          setTransformMode(transformMode === 'translate' ? 'universal' : 'translate'); 
          break;
        case 'r': 
          setTransformMode(transformMode === 'rotate' ? 'universal' : 'rotate'); 
          break;
        case 's': 
          setTransformMode(transformMode === 'scale' ? 'universal' : 'scale'); 
          break;
        case 'u':
          setTransformMode('universal');
          break;
        case 'a': if (event.ctrlKey || event.metaKey) { event.preventDefault(); useStore.getState().selectAll(); } break;
        case 'd': if (event.ctrlKey || event.metaKey) { event.preventDefault(); useStore.getState().duplicateSelected(); } break;
        case 'e': 
          if (event.ctrlKey || event.metaKey) { 
            event.preventDefault(); 
            const { selectedObjectId, selectedFaceIndices, editMode } = useStore.getState();
            if (selectedObjectId && editMode === 'FACE' && selectedFaceIndices.length > 0) {
              useStore.getState().extrudeFaces(selectedObjectId, selectedFaceIndices, 0.3);
            }
          } else {
            setTransformMode(transformMode === 'rotate' ? 'universal' : 'rotate');
          }
          break;
      }
      if (event.key === 'Escape') {
        setTransformMode('universal');
        useStore.getState().deselectAll();
      }
    };

    const handlePointerLeave = () => {
      if (hoverGroupRef.current) hoverGroupRef.current.clear();
      if (rendererRef.current) rendererRef.current.domElement.style.cursor = 'default';
    };

    const canvas=rendererRef.current?.domElement;
    if (canvas) { 
      canvas.addEventListener('pointerdown',handleMouseDown, { capture: true }); 
      canvas.addEventListener('pointermove',handleMouseMove, { capture: true }); 
      canvas.addEventListener('pointerleave',handlePointerLeave);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('pointerup',handleMouseUp, { capture: true });
    window.addEventListener('keydown',handleKeyDown);
    return () => {
      if (canvas) { 
        canvas.removeEventListener('pointerdown',handleMouseDown, { capture: true }); 
        canvas.removeEventListener('pointermove',handleMouseMove, { capture: true }); 
        canvas.removeEventListener('pointerleave',handlePointerLeave);
      }
      window.removeEventListener('pointerup',handleMouseUp, { capture: true });
      window.removeEventListener('keydown',handleKeyDown);
    };
  }, [editMode, transformMode, selectedObjectId, selectedObjectIds, selectObject, toggleObjectSelection, setTransformMode, project, updateVertexOffsets, updateObject, updateObjects, activeViewport, setActiveViewport, selectedVertexIndices, selectedFaceIndices, selectedEdgeIndices, setSelectedVertexIndices, setSelectedFaceIndices, setSelectedEdgeIndices, addSelectedVertexIndices, saveHistory, silueta, setSilueta, drawMode, selectedLightId, selectedCameraId]);

  // ── Draw 2D Canvas Gizmo ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas=gizmoCanvasRef.current;
    if (!canvas) return;
    const ctx=canvas.getContext('2d');
    if (!ctx) return;

    const drawGizmo = () => {
      const renderer=rendererRef.current;
      const w=renderer?renderer.domElement.clientWidth:canvas.width;
      const h=renderer?renderer.domElement.clientHeight:canvas.height;
      canvas.width=w||canvas.width; canvas.height=h||canvas.height;
      ctx.clearRect(0,0,canvas.width,canvas.height);

      // ── Draw marquee selection box (always, regardless of selection state) ──
      if (marqueeRef.current) {
        const mb = marqueeRef.current;
        ctx.save();
        ctx.strokeStyle = '#4488ff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(mb.start.x, mb.start.y, mb.end.x - mb.start.x, mb.end.y - mb.start.y);
        ctx.fillStyle = 'rgba(68, 136, 255, 0.08)';
        ctx.fillRect(mb.start.x, mb.start.y, mb.end.x - mb.start.x, mb.end.y - mb.start.y);
        ctx.restore();
      }

      if (!selectedObjectId && !selectedLightId && !selectedCameraId) return;

      const selObj = selectedObjectId ? projectRef.current.objects.find(o=>o.id===selectedObjectId) : null;
      let gizmoPos = new THREE.Vector3();
      
      if (selectedLightId) {
        const l = projectRef.current.lights.find(l => l.id === selectedLightId);
        if (!l || !cameraRef.current || !renderer) return;
        gizmoPos.fromArray(l.transform.position);
      } else if (selectedCameraId) {
        const c = projectRef.current.cameras?.find(c => c.id === selectedCameraId);
        if (!c || !cameraRef.current || !renderer) return;
        const evalCam = evaluateCameraTransform(c, projectRef.current.objects, currentTime, projectRef.current.duration || 5);
        gizmoPos.copy(evalCam.position);
      } else if (selectedObjectId) {
        if (!selObj||!cameraRef.current||!renderer) return;

        const mesh = getObjectMesh(selectedObjectId);

      if (selObj.nurbsSurface || selObj.nurbsCurve) {
        const isNurbsCp = !!(selObj.selectedNurbsControlPoint || selObj.selectedNurbsControlPoints?.length);
        if (isNurbsCp && (editMode === 'VERTEX' || isNurbsCp)) {
          const selCPs = selObj.selectedNurbsControlPoints?.length
            ? selObj.selectedNurbsControlPoints
            : (selObj.selectedNurbsControlPoint ? [selObj.selectedNurbsControlPoint] : []);
          const centroidLocal = new THREE.Vector3();
          let validCount = 0;
          selCPs.forEach(cp => {
            let pt: [number, number, number] | null = null;
            if (selObj.nurbsSurface) {
              pt = selObj.nurbsSurface.controlPoints[cp.u]?.[cp.v ?? 0]?.point || null;
            } else if (selObj.nurbsCurve) {
              pt = selObj.nurbsCurve.controlPoints[cp.u]?.point || null;
            }
            if (pt) {
              centroidLocal.add(new THREE.Vector3(...pt));
              validCount++;
            }
          });
          if (validCount > 0) centroidLocal.divideScalar(validCount);
          if (mesh && validCount > 0) {
            gizmoPos = centroidLocal.applyMatrix4(mesh.matrixWorld);
          } else if (validCount > 0) {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            gizmoPos = centroidLocal
              .multiply(new THREE.Vector3(..._interp.scale))
              .applyEuler(new THREE.Euler(..._interp.rotation))
              .add(new THREE.Vector3(..._interp.position));
          } else if (mesh) {
            mesh.getWorldPosition(gizmoPos);
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            gizmoPos.fromArray(_interp.position);
          }
        } else if (mesh) {
          mesh.getWorldPosition(gizmoPos);
        } else {
          const _interp = getInterpolatedTransform(selObj, currentTime);
          gizmoPos.fromArray(_interp.position);
        }
      } else if (['VERTEX','FACE','EDGE'].includes(editMode)) {
        if (!selectedVertexIndices.length) return;

        const isShape = selObj.type === 'SHAPE';
        const isBezier = isShape && selObj.parameters?.shapeType === 'bezier';

        if (isBezier && selectedVertexIndices.some(idx => idx >= 10000)) {
          const idx = selectedVertexIndices[0];
          const anchorIdx = idx >= 20000 ? idx - 20000 : idx - 10000;
          const side = idx >= 20000 ? 'in' : 'out';
          const anchor = new THREE.Vector3(...selObj.vertices[anchorIdx]);
          const handleRel = new THREE.Vector3(...(selObj.bezierHandles?.[anchorIdx]?.[side] ?? [0,0,0]));
          if (mesh) {
            gizmoPos = anchor.add(handleRel).applyMatrix4(mesh.matrixWorld);
          } else {
            const _interp = getInterpolatedTransform(selObj, currentTime);
            gizmoPos = anchor.add(handleRel)
              .multiply(new THREE.Vector3(..._interp.scale))
              .applyEuler(new THREE.Euler(..._interp.rotation))
              .add(new THREE.Vector3(..._interp.position));
          }
        } else {
          const centroid=new THREE.Vector3();
          let count = 0;
          selectedVertexIndices.forEach(idx => {
            if (selObj.vertices && idx < selObj.vertices.length) {
              const v = selObj.vertices[idx];
              const off = selObj.vertexOffsets?.[idx] ?? [0,0,0];
              centroid.add(new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]));
              count++;
            }
          });
          if (count > 0) {
            centroid.divideScalar(count);
            if (mesh) {
              gizmoPos = centroid.applyMatrix4(mesh.matrixWorld);
            } else {
              const _interp = getInterpolatedTransform(selObj, currentTime);
              gizmoPos = centroid
                .multiply(new THREE.Vector3(..._interp.scale))
                .applyEuler(new THREE.Euler(..._interp.rotation))
                .add(new THREE.Vector3(..._interp.position));
            }
          } else {
            return;
          }
        }
      } else {
        // OBJECT mode: Use the mesh's world position which is already interpolated in Scene sync
        if (mesh) {
          mesh.getWorldPosition(gizmoPos);
        } else {
          const _interp = getInterpolatedTransform(selObj, currentTime);
          gizmoPos.fromArray(_interp.position);
        }
      }
      }

      const isNurbsCpSelected = !!(
        selObj &&
        (selObj.nurbsSurface || selObj.nurbsCurve) &&
        (selObj.selectedNurbsControlPoint || selObj.selectedNurbsControlPoints?.length)
      );

      const layout = computeGizmoLayout(gizmoPos, cameraRef.current, w, h, transformSpace, selObj, isNurbsCpSelected ? 50 : undefined, transformMode);
      if (!layout) return;
      const { cx, cy, AXIS_LEN, dirs, rotArcs } = layout;
      const gs = gizmoStateRef.current;

      const showTranslate = isNurbsCpSelected ? true : (transformMode === 'translate' || transformMode === 'universal');
      const showRotate = isNurbsCpSelected ? false : (transformMode === 'rotate' || transformMode === 'universal');
      const showScale = isNurbsCpSelected ? false : (transformMode === 'scale' || transformMode === 'universal');
      const showPlanes = isNurbsCpSelected ? true : (transformMode === 'translate' || transformMode === 'universal');
      const showOuterRing = !isNurbsCpSelected && (transformMode === 'rotate' || transformMode === 'universal' || transformMode === 'scale');

      // 1. Draw 2D translation corner plane handles (small, neat, non-cluttering)
      if (showPlanes) {
        const drawPlane = (a1: string, a2: string, planeName: string, color: string) => {
          const d1 = dirs[a1], d2 = dirs[a2];
          if (!d1 || !d2) return;
          const isHov = gs.hoveredAxis === planeName || gs.activeAxis === planeName;
          ctx.save();
          ctx.globalAlpha = isHov ? 0.5 : 0.18;
          ctx.fillStyle = color;
          ctx.beginPath();
          const p1x = cx + d1.nx * 0.2, p1y = cy + d1.ny * 0.2;
          const p2x = cx + d1.nx * 0.42, p2y = cy + d1.ny * 0.42;
          const p3x = cx + (d1.nx + d2.nx) * 0.42, p3y = cy + (d1.ny + d2.ny) * 0.42;
          const p4x = cx + d2.nx * 0.42, p4y = cy + d2.ny * 0.42;
          const p5x = cx + d2.nx * 0.2, p5y = cy + d2.ny * 0.2;
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.lineTo(p3x, p3y);
          ctx.lineTo(p4x, p4y);
          ctx.lineTo(p5x, p5y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = isHov ? '#ffffff' : color;
          ctx.lineWidth = 1.0;
          ctx.stroke();
          ctx.restore();
        };

        drawPlane('X', 'Y', 'XY', '#f59e0b');
        drawPlane('Y', 'Z', 'YZ', '#06b6d4');
        drawPlane('X', 'Z', 'XZ', '#ec4899');
      }

      // 2. Draw Rotation Arcs (fine 1.2px arcs, camera-facing)
      if (showRotate) {
        for (const rotAxis of ['Z', 'X', 'Y']) {
          const arc = rotArcs[rotAxis];
          if (!arc || !arc.pts.length) continue;
          const isHov = gs.hoveredAxis === `ROT_${rotAxis}` || gs.activeAxis === `ROT_${rotAxis}`;

          ctx.save();
          ctx.globalAlpha = isHov ? 1.0 : 0.85;
          ctx.strokeStyle = arc.arcColor;
          ctx.lineWidth = isHov ? 2.0 : 1.2;

          ctx.beginPath();
          ctx.moveTo(arc.pts[0].x, arc.pts[0].y);
          for (let i = 1; i < arc.pts.length; i++) {
            ctx.lineTo(arc.pts[i].x, arc.pts[i].y);
          }
          ctx.stroke();

          // Spherical node handle on arc frontmost point
          const nodeR = isHov ? 6.5 : 4.5;
          ctx.fillStyle = arc.sphereColor;
          ctx.beginPath();
          ctx.arc(arc.handlePt.x, arc.handlePt.y, nodeR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.0;
          ctx.stroke();

          ctx.restore();
        }
      }

      // 3. Draw Axis Lines & Shafts (Translate / Scale)
      if (showTranslate || showScale) {
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const tipX = cx + d.nx, tipY = cy + d.ny;
          const isHov = gs.hoveredAxis === axis || gs.activeAxis === axis;

          ctx.save();
          ctx.globalAlpha = isHov ? 1.0 : 0.9;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = isHov ? 2.0 : 1.2;
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(tipX, tipY);
          ctx.stroke();

          // Arrowheads for Translate / Universal
          if (showTranslate) {
            const angle = Math.atan2(d.ny, d.nx);
            const al = 7.5;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - al * Math.cos(angle - 0.35), tipY - al * Math.sin(angle - 0.35));
            ctx.lineTo(tipX - al * Math.cos(angle + 0.35), tipY - al * Math.sin(angle + 0.35));
            ctx.closePath();
            ctx.fillStyle = d.color;
            ctx.fill();
          }

          // Clean, unblocked axis label badge positioned past all handles
          const labelDistRatio = 1.22;
          const labelX = cx + d.nx * labelDistRatio;
          const labelY = cy + d.ny * labelDistRatio;

          ctx.save();
          ctx.beginPath();
          ctx.arc(labelX, labelY, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = isHov ? d.color : 'rgba(20, 20, 24, 0.88)';
          ctx.fill();
          ctx.strokeStyle = isHov ? '#ffffff' : d.color;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          ctx.font = 'bold 9.5px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isHov ? '#ffffff' : d.color;
          ctx.fillText(axis, labelX, labelY + 0.5);
          ctx.restore();

          ctx.restore();
        }
      }

      // 4. Draw Scale Cubes
      if (showScale) {
        for (const axis of ['X', 'Y', 'Z']) {
          const d = dirs[axis];
          if (!d) continue;
          const scaleName = `SCALE_${axis}`;
          const isHov = gs.hoveredAxis === scaleName || gs.activeAxis === scaleName || (transformMode === 'scale' && (gs.hoveredAxis === axis || gs.activeAxis === axis));
          const scaleDistRatio = transformMode === 'universal' ? 0.72 : 1.0;
          const cubeX = cx + d.nx * scaleDistRatio;
          const cubeY = cy + d.ny * scaleDistRatio;
          const sz = isHov ? 9.5 : 7.0;
          ctx.save();
          ctx.fillStyle = d.color;
          ctx.fillRect(cubeX - sz/2, cubeY - sz/2, sz, sz);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(cubeX - sz/2, cubeY - sz/2, sz, sz);
          ctx.restore();
        }
      }

      // 5. Draw Outer Trackball Ring
      if (showOuterRing) {
        const OUTER_R = AXIS_LEN * 1.15;
        const isOuterHov = gs.hoveredAxis === 'ROT_VIEW' || gs.activeAxis === 'ROT_VIEW' || gs.hoveredAxis === 'SCALE_UNIFORM' || gs.activeAxis === 'SCALE_UNIFORM';
        ctx.save();
        ctx.globalAlpha = isOuterHov ? 0.85 : 0.25;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isOuterHov ? 1.5 : 0.9;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cx, cy, OUTER_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Draw center FREE handle
      const isFreeHov = gs.hoveredAxis === 'FREE' || gs.activeAxis === 'FREE';
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, isFreeHov ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isFreeHov ? '#ffffff' : '#e4e4e7';
      ctx.fill();
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    let rafId: number;
    const loop=()=>{drawGizmo();rafId=requestAnimationFrame(loop);};
    loop();
    return ()=>cancelAnimationFrame(rafId);
  }, [selectedObjectId, editMode, transformMode, project, selectedVertexIndices]);

  // ── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={`relative w-full h-full border overflow-hidden bg-zinc-900 transition-colors touch-none ${
        silueta?.activePlane ? (
          (type === 'FRONT') ? `border-red-500 shadow-[inset_0_0_0_${silueta.activePlane === 'front' ? '3px' : '1px'}_rgba(239,68,68,1)]` :
          (type === 'LEFT' || type === 'RIGHT') ? `border-cyan-400 shadow-[inset_0_0_0_${silueta.activePlane === type.toLowerCase() ? '3px' : '1px'}_rgba(34,211,238,1)]` :
          (type === 'TOP') ? `border-green-500 shadow-[inset_0_0_0_${silueta.activePlane === 'top' ? '3px' : '1px'}_rgba(34,197,94,1)]` :
          'border-zinc-800'
        ) : (
          activeViewport===type ? (isRecording ? 'border-red-500 shadow-[inset_0_0_0_2px_rgba(239,68,68,1)]' : 'border-blue-500 shadow-[inset_0_0_0_1px_rgba(59,130,246,1)]') : 'border-zinc-800'
        )
      }`}
      onPointerDown={()=>setActiveViewport(type)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="absolute top-1 left-1 sm:top-2 sm:left-2 z-40 flex items-center gap-1.5 flex-wrap">
        <div
          className="px-1.5 py-0.5 sm:px-2 sm:py-1 bg-black/50 hover:bg-black/70 text-[8px] sm:text-xs text-white rounded font-mono uppercase tracking-wider cursor-pointer hover:text-indigo-300 select-none border border-white/10 hover:border-white/30 flex items-center gap-1.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] transition-all backdrop-blur-sm"
          onPointerDown={e=>e.stopPropagation()}
          onClick={e=>{e.stopPropagation();setMaximizedViewport(maximizedViewport===type?null:type);}}
        >
          {viewCameraId ? (
            <Camera size={13} className="text-indigo-400 shrink-0 animate-pulse" />
          ) : type === 'PERSPECTIVE' ? (
            <Globe size={13} className="text-indigo-300 shrink-0" />
          ) : (
            <Eye size={13} className="text-zinc-400 shrink-0" />
          )}
          <span>{title} {maximizedViewport===type?'[-]':'[+]'}</span>
          {maximizedViewport === type && (
            <div 
              className="ml-2 px-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[8px] font-bold"
              onClick={(e) => { e.stopPropagation(); setMaximizedViewport(null); }}
            >
              RESTAURAR 4 VISTAS
            </div>
          )}
        </div>

        {/* Camera Target Status Badge when viewing through a Camera */}
        {type === 'CAMERA' && viewCameraId && (
          <div className="bg-indigo-950/80 border border-indigo-500/40 text-indigo-200 px-2 py-0.5 rounded text-[9px] font-mono flex items-center gap-1.5 shadow-lg backdrop-blur-sm select-none">
            <Camera size={11} className="text-indigo-400 shrink-0" />
            <span className="font-bold text-indigo-300">VISTA CÁMARA</span>
            {(() => {
              const activeCam = project.cameras?.find(c => c.id === viewCameraId);
              if (activeCam?.targetObjectId) {
                const targetObj = project.objects.find(o => o.id === activeCam.targetObjectId);
                return (
                  <span className="text-indigo-200 text-[9px] border-l border-indigo-500/40 pl-1.5 flex items-center gap-1">
                    <Target size={10} className="text-indigo-400 shrink-0" />
                    <span>Objetivo: <strong className="text-white font-bold">{targetObj?.name || 'Objeto'}</strong></span>
                  </span>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* View Selector Dropdown */}
        <div 
          className="relative" 
          onPointerDown={e => e.stopPropagation()}
          onMouseEnter={() => setShowViewDropdown(true)}
          onMouseLeave={() => setShowViewDropdown(false)}
        >
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowViewDropdown(prev => !prev);
            }}
            className="p-1 sm:p-1.5 bg-black/50 hover:bg-zinc-800 text-white rounded border border-white/20 hover:border-indigo-400 transition-colors drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1 cursor-pointer"
            title="Seleccionar Visor"
          >
            <ChevronDown size={12} className={`transition-transform duration-150 ${showViewDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showViewDropdown && (
            <div className="absolute top-full left-0 pt-1 min-w-[150px] z-[100] max-h-[220px] sm:max-h-[260px]">
              <div className="bg-zinc-900/98 backdrop-blur-md border border-white/20 rounded-md shadow-2xl overflow-y-auto max-h-[210px] sm:max-h-[250px] py-1 custom-scrollbar scrollbar-thin scrollbar-thumb-zinc-700">
                <div className="px-3 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider border-b border-white/10 sticky top-0 bg-zinc-900 z-10">
                  Visores 3D
                </div>
                {(['PERSPECTIVE', 'TOP', 'BOTTOM', 'FRONT', 'BACK', 'LEFT', 'RIGHT'] as ViewportType[]).map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setType(v);
                      setTitle(v.charAt(0) + v.slice(1).toLowerCase());
                      setViewCameraId(null);
                      setShowViewDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-between cursor-pointer ${type === v && !viewCameraId ? 'text-indigo-400 font-bold bg-indigo-950/50' : 'text-zinc-200'}`}
                  >
                    <span>{v}</span>
                    {type === v && !viewCameraId && <span className="text-[9px] text-indigo-300">✓</span>}
                  </button>
                ))}
                {project.cameras && project.cameras.length > 0 && (
                  <>
                    <div className="h-px bg-white/10 my-1" />
                    <div className="px-3 py-1 text-[9px] font-bold text-zinc-400 uppercase tracking-wider border-b border-white/10">
                      Cámaras
                    </div>
                    {project.cameras.map(cam => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setType('CAMERA');
                          setTitle(cam.name);
                          setViewCameraId(cam.id);
                          setShowViewDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-between cursor-pointer ${viewCameraId === cam.id ? 'text-indigo-400 font-bold bg-indigo-950/50' : 'text-zinc-200'}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Camera size={12} className={viewCameraId === cam.id ? "text-indigo-400 shrink-0" : "text-zinc-400 shrink-0"} />
                          <span className="truncate max-w-[100px]">{cam.name}</span>
                        </div>
                        {viewCameraId === cam.id && <span className="text-[9px] text-indigo-300 shrink-0">✓</span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {isRecording && activeViewport === type && (
          <span className="flex items-center gap-1 text-red-500 animate-pulse bg-black/60 px-2 py-1 rounded border border-red-500/30 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            REC
          </span>
        )}
      </div>

      <div className="absolute top-10 left-1 sm:top-12 sm:left-2 z-40 flex flex-col gap-2">
        {[
          {fn:handleZoomIn,  title:'Acercar',  icon:<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>},
          {fn:handleZoomOut, title:'Alejar', icon:<line x1="5" y1="12" x2="19" y2="12"/>},
          {fn:handleRecenter,title:'Recentrar',  icon:<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></>},
          {fn:handleResetView,title:'Reset Vista', icon:<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></>},
          {
            fn: handleToggleHdriBg,
            title: (project.environment?.backgroundMode === 'HDRI' && project.environment?.backgroundVisible !== false)
              ? 'Mapa HDRI de fondo: VISIBLE (Haz clic para ocultar del visor)'
              : 'Mapa HDRI de fondo: OCULTO (Haz clic para mostrar mapa HDRI en el visor)',
            rawIcon: <Globe size={16} />,
            active: (project.environment?.backgroundMode === 'HDRI' && project.environment?.backgroundVisible !== false)
          },
          ...(selectedObjectId ? [
            {fn:handleRecenterPivot, title:'Centrar Pivote / Origen al Objeto', icon:<><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></>},
            {fn:handleAlignToAxes, title:'Alinear a Ejes (90°)', icon:<><path d="M4 20h16"/><path d="M4 4v16"/><path d="M14 10l-4-4-4 4"/><path d="M10 14l4 4 4-4"/></>},
            {fn:handleAlignToFloor, title:'Alinear al Suelo (Y=0)', icon:<><path d="M2 22h20"/><path d="M12 2v14"/><path d="m7 11 5 5 5-5"/></>}
          ] : []),
        ].map(({fn,title:t,icon,rawIcon,active})=>(
          <button key={t} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();fn();}}
            className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border ${
              active
                ? 'bg-amber-600/90 border-amber-400 text-white shadow-amber-500/20'
                : 'bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700'
            }`} title={t}>
            {rawIcon ? rawIcon : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>}
          </button>
        ))}
        {/* Grid snap toggle — only useful when drawMode is active */}
        {drawMode && (
          <button
            onPointerDown={e=>e.stopPropagation()}
            onClick={e=>{e.stopPropagation(); setGridSnapEnabled(!gridSnapEnabled);}}
            className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none transition-colors border text-[10px] font-bold leading-none
              ${gridSnapEnabled
                ? 'bg-indigo-600 border-indigo-400 text-white'
                : 'bg-zinc-800/95 border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
            title={gridSnapEnabled ? 'Snap a cuadrícula: ON' : 'Snap a cuadrícula: OFF'}
          >
            ⊞
          </button>
        )}

        {/* Face Snap / Snapping to geometry (Retopology magnet) */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            toggleFaceSnap?.();
          }}
          className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none transition-colors border text-[10px] font-bold leading-none flex items-center justify-center ${
            faceSnapConfig?.enabled
              ? 'bg-amber-500 border-amber-300 text-black shadow-amber-500/40 ring-1 ring-amber-400 font-black'
              : 'bg-zinc-800/95 border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white'
          }`}
          title={
            faceSnapConfig?.enabled
              ? `Imán Ajuste a Caras: ACTIVADO (Offset: ${faceSnapConfig?.offset ?? 0.005}, Proy. Individual: ${faceSnapConfig?.projectIndividualElements ? 'SÍ' : 'NO'})`
              : 'Activar Imán Ajuste a Caras (Snapping para Retopología)'
          }
        >
          <Magnet size={14} className={faceSnapConfig?.enabled ? 'text-black' : 'text-zinc-400'} />
        </button>
      </div>

      {activeViewport===type && (project.objects || []).find(o=>o.id===selectedObjectId) && (
        <div className="absolute bottom-1 left-1 z-30 px-1.5 py-0.5 bg-black/50 text-[10px] text-white font-mono rounded pointer-events-none">
          {(()=>{
            const obj = (project.objects || []).find(o=>o.id===selectedObjectId);
            if (!obj) return null;
            const _interp = getInterpolatedTransform(obj, currentTime);
            const pos = _interp?.position || [0, 0, 0];
            return `X:${safeFixed(pos[0], 2)} Y:${safeFixed(pos[1], 2)} Z:${safeFixed(pos[2], 2)}${obj.keyframes?.length ? ` [${obj.keyframes.length}kf]` : ''}`;
          })()}
        </div>
      )}

      {/* Gizmo numeric value display — shown while dragging an axis */}
      <div
        ref={gizmoDisplayRef}
        className="absolute top-1/2 left-1/2 z-50 pointer-events-none hidden font-mono text-sm text-white bg-black/85 border border-indigo-500 rounded px-3 py-1.5 shadow-lg"
        style={{ transform: 'translate(-50%, calc(-50% - 60px))', minWidth: '110px', textAlign: 'center' }}
      />

      <div 
        ref={containerRef} 
        onContextMenu={e => e.preventDefault()}
        className={`w-full h-full ${moveReferenceMode ? 'cursor-move' : ''}`}
      />
      <canvas ref={gizmoCanvasRef} className="absolute inset-0 w-full h-full" style={{zIndex:20,pointerEvents:'none'}} width={600} height={400}/>
    </div>
  );
};