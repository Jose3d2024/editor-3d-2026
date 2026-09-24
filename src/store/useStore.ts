import { create } from 'zustand';
import * as THREE from 'three';
import { createORMMap } from '../utils/materialUtils';
import { AppState, Project, CSGObject, CSGOperation, PrimitiveType, ViewportType, ReferenceImage, MeshFace, V3, BezierHandle, SilhouetteState, ViewMode, MaterialData, CameraState, LightType, LightObject, CameraObject, TransformMode, NurbsCurveData, NurbsSurfaceData, HistoryStep } from '../types';
import { generatePrimitive } from '../utils/geometry';
import { createBaseGeometry } from '../utils/csg';
import { applyBooleanOperation, smoothMesh, roundAnglesMesh, subdivideMesh, optimizeMesh, repairMesh, fillHoles, capSelectedFaces } from '../utils/modifiers';
import { bevelMeshAdvanced } from '../utils/bevel';
import { simplifyMesh, convertImportedToCSG } from '../utils/modifiers_advanced';
import { applyNoiseToMesh, type NoiseDeformConfig } from '../utils/meshNoise';
import { executeUnifiedBoolean, BooleanExecuteOptions, BooleanResult, UnifiedBooleanOp } from '../utils/booleanOperations';
import { getDefaultMaterials } from '../utils/defaultMaterials';
import { DEFAULT_VOLUMETRIC_CONFIG } from '../utils/volumetricRaymarch';
import { DEFAULT_PARTICLE_CONFIG, DEFAULT_SPACE_WARP_CONFIG } from '../utils/particleSystem';
import { DEFAULT_GPGPU_SWARM_CONFIG } from '../utils/gpgpuSwarm';
import { convertToWireframeModel, createWireframeTubesGeometry, extractUniqueEdges, type WireframeOptions } from '../utils/wireframeMesh';
import { executeLoopCut } from '../utils/loopCut';
import { executeExtrudeManifold } from '../utils/extrudeManifold';
import {
  createDefaultNurbsCurve,
  createDefaultNurbsCircle,
  createDefaultNurbsSurface,
  createDefaultNurbsCylinder,
  createDefaultNurbsCone,
  createDefaultNurbsSphere,
  createDefaultNurbsTorus,
  extrudeNurbsCurve,
  revolveNurbsCurve,
  loftNurbsCurves,
  subdivideNurbsCurve,
  subdivideNurbsSurface,
  switchNurbsDirection,
  extrudeNurbsSurfaceRow,
  tessellateNurbsSurface,
  tessellateNurbsCurveToMesh,
  smoothNurbsCurve,
  smoothNurbsSurface,
  resetNurbsWeights,
  resetNurbsTiltsAndRadii,
  setNurbsOrder,
  toggleNurbsEndpoint,
  toggleNurbsCyclic,
  setNurbsKnotType,
  alignSurfacesG0,
  alignSurfacesG0Auto,
  mergeSurfacesU,
} from '../utils/nurbs';
import type { NurbsKnotType } from '../utils/nurbs';
import { snapPointToSurfaces, alignObjectRotationToNormal, getObjectBaseExtentAlongNormal } from '../utils/faceSnap';
import { getLinkedSelection } from '../utils/meshCleanUp';

const DEFAULT_CUBE_GEOM = generatePrimitive('CUBE', { segments: 1 });

const DEFAULT_PROJECT: Project = {
  name: 'Nuevo Proyecto',
  objects: [
    {
      id: 'base-cube',
      name: 'Cubo Base',
      type: 'CUBE',
      operation: 'ADD',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parameters: { segments: 1 },
      vertices: DEFAULT_CUBE_GEOM.vertices,
      faces: DEFAULT_CUBE_GEOM.faces,
      vertexOffsets: {},
      color: '#4f46e5',
      opacity: 1,
      visible: true,
      keyframes: [],
    },
  ],
  lights: [
    {
      id: 'default-light',
      name: 'Luz Principal',
      type: 'DIRECTIONAL',
      color: '#ffffff',
      intensity: 1,
      transform: { position: [5, 10, 7.5], rotation: [-Math.PI/4, Math.PI/4, 0], scale: [1, 1, 1] },
      visible: true,
      castShadow: true
    }
  ],
  cameras: [],
  materials: getDefaultMaterials(),
  duration: 5,
  fps: 30,
  references: {
    top:    { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
    bottom: { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
    front:  { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
    back:   { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
    left:   { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
    right:  { url: null, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], opacity: 0.5, locked: false },
  },
  silueta: {
    front: null,
    back:  null,
    left:  null,
    right: null,
    top:   null,
    bottom:null,
    frontImage: null,
    backImage:  null,
    leftImage:  null,
    rightImage: null,
    topImage:   null,
    bottomImage:null,
    activePlane: null,
  },
  environment: {
    hdriUrl: 'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr',
    backgroundMode: 'GRADIENT',
    backgroundVisible: true,
    backgroundColor: '#16171d',
    backgroundBlur: 0,
    backgroundIntensity: 1.0,
    rotation: 0,
    intensity: 1.2,
    exposure: 1.1,
    maxResolution: 2048,
  },
  showGrid: true,
  showSkeleton: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────
const genId = () => Math.random().toString(36).substr(2, 9);

const computeNormal = (verts: V3[], indices: number[]): V3 => {
  const v0 = verts[indices[0]], v1 = verts[indices[1]], v2 = verts[indices[2]];
  if (!v0 || !v1 || !v2) return [0, 1, 0];
  const ax = v1[0]-v0[0], ay = v1[1]-v0[1], az = v1[2]-v0[2];
  const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];
  const nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return [nx/len, ny/len, nz/len];
};

// ── FIX: Sample a bezier chain into a polyline ─────────────────────────────
// Used by extrudeShape to convert a bezier SHAPE into a polygon before extrusion.
const sampleBezierCurve = (
  verts: V3[],
  handles: BezierHandle[],
  closed: boolean,
  segments: number = 20
): V3[] => {
  if (verts.length < 2) return [...verts];
  const pts: THREE.Vector3[] = [];
  const count = closed ? verts.length : verts.length - 1;

  for (let i = 0; i < count; i++) {
    const i1 = (i + 1) % verts.length;
    const p0  = new THREE.Vector3(...verts[i]);
    const hOut = handles[i]?.out   ?? [0, 0, 0];
    const hIn  = handles[i1]?.in   ?? [0, 0, 0];
    const p1   = p0.clone().add(new THREE.Vector3(...hOut));
    const p3   = new THREE.Vector3(...verts[i1]);
    const p2   = p3.clone().add(new THREE.Vector3(...hIn));
    const segPts = new THREE.CubicBezierCurve3(p0, p1, p2, p3).getPoints(segments);
    if (pts.length > 0) segPts.shift(); // remove duplicate junction
    pts.push(...segPts);
  }

  // Remove closing duplicate
  if (closed && pts.length > 1) {
    if (pts[0].distanceTo(pts[pts.length - 1]) < 0.0001) pts.pop();
  }

  return pts.map(p => [p.x, p.y, p.z] as V3);
};

// ── FIX: Auto-generate smooth bezier handles for zero-handle anchors ───────
// Handles already set manually (non-zero) are preserved.
// This fixes the bug where clicking without dragging produces straight lines.
const autoSmoothBezierHandles = (
  vertices: V3[],
  handles: BezierHandle[],
  closed: boolean
): BezierHandle[] => {
  const isZero = (v: V3) => v[0] === 0 && v[1] === 0 && v[2] === 0;
  const n   = vertices.length;
  const out = handles.map(h => ({
    broken: h.broken,
    out: [...h.out] as V3,
    in:  [...h.in]  as V3,
  }));

  for (let i = 0; i < n; i++) {
    if (!isZero(out[i].out) || !isZero(out[i].in)) continue; // already set

    const curr = vertices[i];

    if (!closed && i === 0) {
      if (n < 2) continue;
      const next = vertices[1];
      const d = Math.sqrt((next[0]-curr[0])**2 + (next[1]-curr[1])**2 + (next[2]-curr[2])**2) || 1;
      const s = d * 0.35;
      out[i].out = [(next[0]-curr[0])/d*s, (next[1]-curr[1])/d*s, (next[2]-curr[2])/d*s];
      out[i].in  = [0, 0, 0];
      continue;
    }
    if (!closed && i === n - 1) {
      if (n < 2) continue;
      const prev = vertices[i - 1];
      const d = Math.sqrt((curr[0]-prev[0])**2 + (curr[1]-prev[1])**2 + (curr[2]-prev[2])**2) || 1;
      const s = d * 0.35;
      out[i].in  = [(prev[0]-curr[0])/d*s, (prev[1]-curr[1])/d*s, (prev[2]-curr[2])/d*s];
      out[i].out = [0, 0, 0];
      continue;
    }

    const pi = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const ni = closed ? (i + 1) % n     : Math.min(n - 1, i + 1);
    const prev = vertices[pi];
    const next = vertices[ni];

    const dx = next[0] - prev[0], dy = next[1] - prev[1], dz = next[2] - prev[2];
    const mag = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const d1  = Math.sqrt((curr[0]-prev[0])**2 + (curr[1]-prev[1])**2 + (curr[2]-prev[2])**2) || 1;
    const d2  = Math.sqrt((next[0]-curr[0])**2  + (next[1]-curr[1])**2  + (next[2]-curr[2])**2)  || 1;
    const s   = Math.min(d1, d2) * 0.35;

    out[i].out = [ dx/mag*s,  dy/mag*s,  dz/mag*s];
    out[i].in  = [-dx/mag*s, -dy/mag*s, -dz/mag*s];
  }

  return out;
};

// ── Store interface ────────────────────────────────────────────────────────
interface Store extends AppState {
  resetProject: () => void;
  setProject: (project: Project) => void;
  addObject: (type: PrimitiveType | CSGObject) => void;
  addLight: (type: LightType, initialProps?: Partial<LightObject>) => LightObject;
  removeLight: (id: string) => void;
  updateLight: (id: string, updates: Partial<LightObject>) => void;
  selectLight: (id: string | null) => void;
  addCamera: (type: 'PERSPECTIVE' | 'ORTHOGRAPHIC') => void;
  removeCamera: (id: string) => void;
  updateCamera: (id: string, updates: Partial<CameraObject>) => void;
  selectCamera: (id: string | null) => void;
  addShape: (type: 'line' | 'rect' | 'bezier', vertices: V3[], closed: boolean, handles?: BezierHandle[]) => void;
  addShapeVertices: (id: string, vertices: V3[], handles: BezierHandle[]) => void;
  updateObject: (id: string, updates: Partial<CSGObject>) => void;
  updateObjects: (ids: string[], updates: Partial<CSGObject> | ((id: string) => Partial<CSGObject>)) => void;
  updateParameters: (id: string, params: Partial<CSGObject['parameters']>) => void;
  updateVertexOffset: (id: string, vertexIndex: number, offset: V3) => void;
  updateVertexOffsets: (id: string, updates: { index: number; offset: V3 }[]) => void;
  updateBezierHandle: (id: string, index: number, side: 'in' | 'out', offset: V3, broken?: boolean) => void;
  removeObject: (id: string) => void;
  removeObjects: (ids: string[]) => void;
  duplicateObject: (id: string) => void;
  moveObjectUp: (id: string) => void;
  moveObjectDown: (id: string) => void;
  selectObject: (id: string | null) => void;
  toggleObjectSelection: (id: string, multi: boolean) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setIsScrubbing: (isScrubbing: boolean) => void;
  setIsRecording: (isRecording: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setShowCSG: (show: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setShowSkeleton: (show: boolean) => void;
  toggleShowSkeleton: () => void;
  setGridSnapEnabled: (enabled: boolean) => void;
  faceSnapConfig: import('../types').FaceSnapConfig;
  setFaceSnapConfig: (cfg: Partial<import('../types').FaceSnapConfig>) => void;
  toggleFaceSnap: () => void;
  setMoveReferenceMode: (enabled: boolean) => void;
  setEditMode: (mode: 'OBJECT' | 'VERTEX' | 'FACE' | 'EDGE') => Promise<void>;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: 'world' | 'local') => void;
  setDrawMode: (mode: 'line' | 'rect' | 'bezier' | null) => void;
  setDrawColor: (color: string) => void;
  setActiveViewport: (viewport: ViewportType) => void;
  setSelectedVertexIndices: (indices: number[]) => void;
  setSelectedFaceIndices: (indices: number[]) => void;
  setSelectedEdgeIndices: (indices: number[]) => void;
  setSelectedGLTFMeshes: (meshes: string[]) => void;
  toggleGLTFMeshSelection: (meshId: string) => void;
  setIsolateGLTFSelection: (isolate: boolean) => void;
  clearSelection: () => void;
  setMaximizedViewport: (viewport: ViewportType | null) => void;
  setViewportCamera: (viewport: string, cameraState: CameraState) => void;
  addSelectedVertexIndices: (indices: number[]) => void;
  expandSelection: () => void;
  addKeyframe: (objectId: string, time: number) => void;
  removeKeyframe: (objectId: string, keyframeId: string) => void;
  clearAllKeyframes: (objectId: string) => void;
  setReference: (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', updates: Partial<ReferenceImage>) => void;
  undo: () => void;
  redo: () => void;
  saveHistory: (actionLabel?: string, category?: HistoryStep['category']) => void;
  jumpToHistory: (targetIndex: number) => void;
  clearHistory: () => void;
  historySteps: HistoryStep[];
  setSilueta: (patch: Partial<SilhouetteState>) => void;
  updateEnvironment: (updates: Partial<Project['environment']>) => void;
  addMaterial: (material: Omit<MaterialData, 'id'> & { id?: string }) => void;
  updateMaterial: (id: string, updates: Partial<MaterialData>) => void;
  generateORM: (id: string) => Promise<void>;
  removeMaterial: (id: string) => void;
  assignMaterialToObjects: (objectIds: string[], materialId: string | null) => void;
  setLastCameraState: (cameraState: CameraState) => void;

  selectAll: () => void;
  deselectAll: () => void;
  invertSelection: () => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  mirrorSelected: (axis: 'x' | 'y' | 'z') => void;

  subdivideFaces: (id: string, faceIndices: number[]) => void;
  mergeFaces: (id: string, faceIndices: number[]) => void;

  clipboard: CSGObject | null;
  copyObject: () => void;
  pasteObject: () => void;
  mirrorObject: (id: string, axis: 'x' | 'y' | 'z') => void;
  extrudeFaces: (id: string, faceIndices: number[], distance: number) => void;
  capSelectedFacesObject: (id: string) => Promise<void>;
  extrudeShape: (id: string, depth: number, axis?: 'x' | 'y' | 'z') => void;

  isBooleanModalOpen: boolean;
  booleanModalTargetId: string | null;
  booleanModalToolId: string | null;
  openBooleanModal: (targetId?: string | null, toolId?: string | null) => void;
  closeBooleanModal: () => void;

  isBlueprintModalOpen: boolean;
  openBlueprintModal: () => void;
  closeBlueprintModal: () => void;

  isFaceSnapDemoModalOpen: boolean;
  openFaceSnapDemoModal: () => void;
  closeFaceSnapDemoModal: () => void;
  executeExplicitBoolean: (options: BooleanExecuteOptions) => Promise<BooleanResult>;
  applyBoolean: (op?: CSGOperation) => Promise<void>;
  smoothObject: (id: string, factor: number, iterations?: number) => Promise<void>;
  roundAnglesObject: (id: string, radius?: number, segments?: number, angleThresholdDeg?: number) => Promise<void>;
  subdivideObject: (id: string) => Promise<void>;
  applyNoiseObject: (id: string, config: NoiseDeformConfig) => Promise<void>;
  optimizeObject: (id: string, ratio: number, selectedMeshes?: string[], options?: { preserveCreases?: boolean }) => Promise<void>;
  regularizeObject: (id: string, strength?: number, iterations?: number, featureAngleDeg?: number) => Promise<void>;
  isotropicRemeshObject: (id: string, targetEdgeLength?: number, iterations?: number) => Promise<void>;
  applyShrinkwrapToObject: (sourceId: string, targetId: string, config: import('../types').ShrinkwrapConfig) => Promise<void>;
  applySilhouetteVacuumWrapToObject: (sourceId: string, targetId: string, config?: import('../utils/shrinkwrap').SilhouetteVacuumWrapConfig) => Promise<void>;
  optimizeConformedMeshToObject: (sourceId: string, targetId?: string, options?: import('../utils/shrinkwrap').OptimizeConformedMeshOptions) => Promise<void>;
  pruneAirBridgingFacesToObject: (sourceId: string, targetId: string, options?: import('../utils/shrinkwrap').PruneAirFacesOptions) => Promise<void>;
  cleanSpikesObject: (sourceId: string, targetId?: string) => Promise<void>;
  solidifyObject: (id: string, thickness?: number, offset?: number) => Promise<void>;
  applyVoxelRemeshToObject: (id: string, options?: import('../utils/voxelRemesher').VoxelRemeshOptions) => Promise<void>;
  retopologizeObject: (id: string, options?: import('../utils/retopology').RetopologyOptions & { selectedMeshes?: string[]; convertToNative?: boolean }) => Promise<void>;
  convertMeshToQuadsObject: (id: string, options?: { preserveCreases?: boolean; creaseAngleDeg?: number }) => Promise<void>;
  repairHardSurfaceObject: (id: string, options?: { creaseAngleDeg?: number; planarToleranceDeg?: number }) => Promise<void>;
  dissolveCoplanarObject: (id: string, angleToleranceDeg?: number, options?: { selectedMeshes?: string[]; protectUVSeams?: boolean; snapToPlane?: boolean; collinearAngleDeg?: number }) => Promise<void>;
  applyLowPolyBlueprint: (id: string, options?: { creaseAngleDeg?: number; targetFaceRatio?: number; silhouetteOnly?: boolean; forceNativeConversion?: boolean }) => Promise<{ success: boolean; message: string }>;
  removeBlueprintStyle: (id: string) => void;
  optimizeCurvedObject: (id: string, ratio?: number, options?: { preserveCreases?: boolean; creaseAngleDeg?: number; smoothNormals?: boolean; selectedMeshes?: string[] }) => Promise<void>;
  cleanIslandsObject: (id: string, minRatio?: number) => Promise<void>;
  repairNormalsObject: (id: string, options?: { creaseAngleDeg?: number; snapPlanar?: boolean; flipAll?: boolean }) => Promise<void>;
  flipObjectNormals: (id: string) => Promise<void>;
  offsetObject: (id: string, distance: number) => Promise<void>;
  repairObject: (id: string, tolerance?: number) => Promise<void>;
  weldObject: (id: string, tolerance?: number) => Promise<void>;
  healObject: (id: string) => Promise<void>;
  fillHolesObject: (id: string) => Promise<void>;
  separateLoosePartsObject: (id: string) => Promise<{ success: boolean; message: string; count?: number }>;
  ungroupSelectedObject: (id: string) => Promise<{ success: boolean; message: string; count?: number }>;
  recenterPivotObject: (idInput?: string) => Promise<void>;
  alignToGrid: (id: string) => void;
  alignToGround: (id: string) => void;
  alignToSurface: (id?: string) => Promise<boolean>;
  loadFaceSnapDemoScene: (replaceScene?: boolean) => void;

  // NURBS Methods
  addNurbsObject: (type: 'NURBS_CURVE' | 'NURBS_CIRCLE' | 'NURBS_SURFACE' | 'NURBS_CYLINDER' | 'NURBS_CONE' | 'NURBS_SPHERE' | 'NURBS_TORUS') => void;
  updateNurbsControlPoint: (id: string, uIndex: number, vIndex: number | undefined, point: V3, weight?: number) => void;
  updateNurbsControlPoints: (id: string, updates: { u: number; v?: number; point: V3; weight?: number }[]) => void;
  selectNurbsControlPoint: (id: string, uIndex: number | null, vIndex?: number | null, multi?: boolean) => void;
  selectNurbsControlPoints: (id: string, points: { u: number; v?: number }[]) => void;
  subdivideNurbsObject: (id: string, dir?: 'U' | 'V' | 'BOTH') => void;
  extrudeNurbsObject: (id: string, delta?: V3) => void;
  revolveNurbsObject: (id: string, angleDeg?: number, axis?: 'x' | 'y' | 'z') => void;
  loftNurbsObjects: (ids: string[]) => void;
  fillNurbsObject: (id: string) => void;
  switchNurbsDirectionObject: (id: string, dir?: 'U' | 'V') => void;
  alignNurbsSurfaces: (masterId: string, slaveId: string, edgeMaster?: 'START' | 'END', edgeSlave?: 'START' | 'END') => void;
  mergeNurbsSurfaces: (masterId: string, slaveId: string) => void;
  convertNurbsToMesh: (id: string) => void;
  setNurbsDegree: (id: string, degreeU: number, degreeV?: number) => void;
  setNurbsResolution: (id: string, resU: number, resV?: number) => void;
  setNurbsControlPointWeight: (id: string, uIndex: number, vIndex: number | undefined, weight: number) => void;

  // Vertex & Shape Tools
  weldShapeVertices: (id: string, vertexIndices?: number[], tolerance?: number) => { success: boolean; message: string };
  weldSelectedVertices: (id: string, vertexIndices?: number[], tolerance?: number) => Promise<{ success: boolean; message: string }>;
  subdivideShapeSegment: (id: string, vertexIndex1?: number, vertexIndex2?: number) => { success: boolean; message: string };
  insertShapeVertexAtPoint: (id: string, point: V3, segmentIndex?: number) => { success: boolean; message: string };
  connectVertices: (id: string, vertexIndices?: number[]) => { success: boolean; message: string };
  createFaceFromVertices: (id: string, vertexIndices?: number[]) => { success: boolean; message: string };
  extrudeSelectedVertices: (id: string, vertexIndices?: number[], offset?: V3) => { success: boolean; message: string };
  deleteSelectedVertices: (id: string, vertexIndices?: number[]) => { success: boolean; message: string };
  symmetrizeVertices: (
    id: string,
    vertexIndices?: number[],
    options?: {
      axis?: 'x' | 'y' | 'z';
      direction?: '+to-' | '-to+' | 'selected_to_opposite' | 'both';
      centerSnap?: boolean;
      snapThreshold?: number;
      searchThreshold?: number;
    }
  ) => { success: boolean; message: string; modifiedCount?: number };
  toggleShapeClosed: (id: string) => void;
  reverseShapeDirection: (id: string) => void;

  // Face & Edge Tools
  deleteSelectedFaces: (id: string, faceIndices?: number[]) => { success: boolean; message: string };
  removeAllFaces: (id: string) => { success: boolean; message: string };
  convertToWireframe: (id: string, options?: WireframeOptions) => { success: boolean; message: string; newObjectId?: string };
  insetFaces: (id: string, faceIndices?: number[], amount?: number) => { success: boolean; message: string };
  flipSelectedFaceNormals: (id: string, faceIndices?: number[]) => { success: boolean; message: string };
  deleteSelectedEdges: (id: string, edgeIndices?: number[]) => { success: boolean; message: string };
  dissolveSelectedEdges: (id: string, edgeIndices?: number[]) => Promise<{ success: boolean; message: string }> | { success: boolean; message: string };
  dissolveSelectedVerticesAction: (id: string, vertexIndices?: number[]) => Promise<{ success: boolean; message: string }>;
  dissolveSelectedFacesAction: (id: string, faceIndices?: number[]) => Promise<{ success: boolean; message: string }>;
  collapseSelectedAction: (id: string, targetType?: 'VERTEX' | 'EDGE' | 'FACE') => Promise<{ success: boolean; message: string }>;
  applyDecimateModifier: (id: string, options: import('../utils/modifiers').DecimateOptions) => Promise<{ success: boolean; message: string }>;
  applyProVoxelQuadRemesh: (id: string, options?: { voxelResolution?: number; targetQuads?: number }) => Promise<{ success: boolean; message: string }>;
  deleteLooseGeometry: (id: string) => Promise<{ success: boolean; message: string }>;
  dissolveDegenerateGeometry: (id: string, minArea?: number) => Promise<{ success: boolean; message: string }>;
  mergeVerticesByDistanceAction: (id: string, distance?: number) => Promise<{ success: boolean; message: string }>;
  purgeMeshIslandsAction: (id: string, options?: { keepOnlyLargest?: boolean; minFacesThreshold?: number }) => Promise<{ success: boolean; message: string }>;
  purgeDebrisPolygonsAction: (id: string, minArea?: number) => Promise<{ success: boolean; message: string }>;
  selectLinkedAction: (id?: string) => { success: boolean; message: string };
  invertSelectionAction: () => { success: boolean; message: string };
  subdivideSelectedEdges: (id: string, edgeIndices?: number[]) => { success: boolean; message: string };
  insertVertexOnEdge: (id: string, edgeIndices?: number[], point?: V3) => { success: boolean; message: string };
  bridgeSelectedEdges: (id: string, edgeIndices?: number[]) => { success: boolean; message: string };
  bevelSelectedEdges: (id: string, edgeIndices?: number[], width?: number, segments?: number) => { success: boolean; message: string };
  applyLoopCut: (id: string, edge?: [number, number], cuts?: number, slide?: number) => { success: boolean; message: string };
  extrudeManifold: (id: string, faceIndices?: number[], distance?: number) => Promise<{ success: boolean; message: string }>;
}

function solidExtrudeMesh(
  obj: CSGObject,
  depth: number,
  axis: 'x' | 'y' | 'z',
): { vertices: V3[]; faces: MeshFace[] } | null {
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  // Bake vertex offsets
  const bottomVerts: V3[] = obj.vertices.map((v, i) => {
    const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
  });

  const n = bottomVerts.length;
  const sign = depth < 0 ? -1 : 1;

  // Top ring
  const topVerts: V3[] = bottomVerts.map(v => {
    const nv = [...v] as V3;
    nv[axisIdx] += depth;
    return nv;
  });

  const allVerts: V3[] = [...bottomVerts, ...topVerts];
  const faces: MeshFace[] = [];

  // Bottom cap (reverse winding so normal faces −axis)
  obj.faces.forEach(face => {
    faces.push({ indices: [...face.indices].reverse() });
  });

  // Top cap (forward winding so normal faces +axis), indices shifted by n
  obj.faces.forEach(face => {
    faces.push({ indices: face.indices.map(i => i + n) });
  });

  // ── Detect boundary edges ─────────────────────────────────────
  // An edge is a boundary if it appears in exactly one face.
  const edgeInfo = new Map<string, { a: number; b: number; faceOrder: [number, number] }>();

  obj.faces.forEach(face => {
    const m = face.indices.length;
    for (let i = 0; i < m; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % m];
      const fwd = `${a}:${b}`;
      const rev = `${b}:${a}`;
      // If the reversed edge already exists, this is an interior edge — remove it
      if (edgeInfo.has(rev)) {
        edgeInfo.delete(rev);
      } else {
        edgeInfo.set(fwd, { a, b, faceOrder: [a, b] });
      }
    }
  });

  // Add side quads for each boundary edge
  edgeInfo.forEach(({ a, b }) => {
    if (depth >= 0) {
      // Normal extrude direction: winding so normals face outward
      faces.push({ indices: [a, b, b + n, a + n] });
    } else {
      // Negative depth: flip winding
      faces.push({ indices: [a, a + n, b + n, b] });
    }
  });

  return { vertices: allVerts, faces };
}

// ── Store ──────────────────────────────────────────────────────────────────
export const useStore = create<Store>()((set, get) => ({
  project: DEFAULT_PROJECT,
  meshProcessing: null,
  closeMeshProcessing: () => set({ meshProcessing: null }),
  selectedObjectId: null,
  selectedObjectIds: [] as string[],
  currentTime: 0,
  isPlaying: false,
  isScrubbing: false,
  isRecording: false,
  viewMode: 'SOLID',
  showCSG: false,
  gridSnapEnabled: false,
  faceSnapConfig: {
    enabled: false,
    targetType: 'FACE',
    projectIndividualElements: true,
    offset: 0.002,
    targetObjectId: null,
  },
  editMode: 'OBJECT',
  transformMode: 'universal',
  transformSpace: 'world',
  drawMode: null,
  drawColor: '#ffffff',
  orthoDrawMode: false,
  setOrthoDrawMode: (enabled) => set({ orthoDrawMode: enabled }),
  drawLockAxis: 'FREE',
  setDrawLockAxis: (axis) => set({ drawLockAxis: axis }),
  insertVertexMode: false,
  setInsertVertexMode: (enabled) => set({ insertVertexMode: enabled }),
  loopCutMode: false,
  setLoopCutMode: (enabled) => set({ loopCutMode: enabled }),
  loopCutCuts: 1,
  setLoopCutCuts: (cuts) => set({ loopCutCuts: cuts }),
  loopCutSlide: 0.5,
  setLoopCutSlide: (slide) => set({ loopCutSlide: slide }),
  moveReferenceMode: false,
  history: [DEFAULT_PROJECT],
  historySteps: [
    {
      id: 'step-init',
      label: 'Escena Inicial',
      timestamp: Date.now(),
      objectName: DEFAULT_PROJECT.objects[0]?.name || 'Cubo Base',
      objectId: DEFAULT_PROJECT.objects[0]?.id,
      objectCount: DEFAULT_PROJECT.objects.length,
      faceCount: DEFAULT_PROJECT.objects[0]?.faces?.length || 6,
      vertexCount: DEFAULT_PROJECT.objects[0]?.vertices?.length || 8,
      totalSceneFaces: 6,
      totalSceneVertices: 8,
      category: 'general',
    }
  ],
  historyIndex: 0,
  activeViewport: 'PERSPECTIVE',
  selectedVertexIndices: [],
  selectedFaceIndices: [],
  selectedEdgeIndices: [],
  selectedGLTFMeshes: [],
  isolateGLTFSelection: false,
  maximizedViewport: null,
  viewportCameras: {},
  viewportConfig: {
    preset: 'QUAD',
    splitX: 0.5,
    splitY: 0.5,
    customResizeMode: false,
    snapStep: 0.5,
  },
  clipboard: null,
  isMaterialStudioOpen: false,
  materialStudioMaterialId: null,
  openMaterialStudio: (materialId) => {
    const state = get();
    let targetId = materialId;
    if (!targetId) {
      const selObj = state.project.objects.find(o => o.id === state.selectedObjectId);
      if (selObj?.materialId) {
        targetId = selObj.materialId;
      } else if (state.project.materials.length > 0) {
        targetId = state.project.materials[0].id;
      } else {
        const newMat: MaterialData = {
          id: 'mat_' + Math.random().toString(36).substr(2, 9),
          name: 'Nuevo Material PBR',
          color: '#ffffff',
          roughness: 0.4,
          metalness: 0.1,
          emissive: '#000000',
          emissiveIntensity: 1,
          opacity: 1,
          transparent: false,
          ior: 1.5,
          transmission: 0,
          thickness: 0,
        };
        state.addMaterial(newMat);
        targetId = newMat.id;
      }
    }
    set({
      isMaterialStudioOpen: true,
      materialStudioMaterialId: targetId || null,
    });
  },
  closeMaterialStudio: () => set({ isMaterialStudioOpen: false }),
  setMaterialStudioMaterialId: (id) => set({ materialStudioMaterialId: id }),
  isBooleanModalOpen: false,
  booleanModalTargetId: null,
  booleanModalToolId: null,
  openBooleanModal: (targetId, toolId) => set({ isBooleanModalOpen: true, booleanModalTargetId: targetId || null, booleanModalToolId: toolId || null }),
  closeBooleanModal: () => set({ isBooleanModalOpen: false, booleanModalTargetId: null, booleanModalToolId: null }),

  isBlueprintModalOpen: false,
  openBlueprintModal: () => set({ isBlueprintModalOpen: true }),
  closeBlueprintModal: () => set({ isBlueprintModalOpen: false }),

  isFaceSnapDemoModalOpen: false,
  openFaceSnapDemoModal: () => set({ isFaceSnapDemoModalOpen: true }),
  closeFaceSnapDemoModal: () => set({ isFaceSnapDemoModalOpen: false }),

  resetProject: () => {
    const freshProject: Project = JSON.parse(JSON.stringify(DEFAULT_PROJECT));
    set({
      project: freshProject,
      selectedObjectId: null,
      selectedLightId: null,
      selectedCameraId: null,
      selectedVertexIndices: [],
      selectedFaceIndices: [],
      selectedEdgeIndices: [],
      selectedGLTFMeshes: [],
      history: [freshProject],
      historySteps: [
        {
          id: `step-reset-${Date.now()}`,
          label: 'Nuevo Proyecto',
          timestamp: Date.now(),
          objectCount: freshProject.objects.length,
          category: 'general',
        }
      ],
      historyIndex: 0,
      currentTime: 0,
      isPlaying: false,
    });
  },

  setProject: (project) => {
    const { project: currentProject } = get();
    const mergedProject = { 
      ...DEFAULT_PROJECT, 
      ...project, 
      lights: project.lights || currentProject.lights || DEFAULT_PROJECT.lights,
      cameras: project.cameras || currentProject.cameras || DEFAULT_PROJECT.cameras,
      references: { ...DEFAULT_PROJECT.references, ...(project.references || {}) },
      silueta: { ...DEFAULT_PROJECT.silueta, ...(project.silueta || {}) } 
    };
    set({ project: mergedProject });
  },

  addLight: (type, initialProps) => {
    const newLight: LightObject = {
      id: genId(),
      name: `Luz ${type} ${get().project.lights.length + 1}`,
      type,
      color: '#ffffff',
      intensity: 1,
      transform: { position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      castShadow: true,
      ...(type === 'SPOT' ? { angle: Math.PI / 3, penumbra: 0.1 } : {}),
      ...(type === 'RECTAREA' ? { width: 1, height: 1 } : {}),
      ...(initialProps || {}),
    };
    const project = { ...get().project, lights: [...get().project.lights, newLight] };
    set({ project });
    set({ selectedLightId: newLight.id, selectedObjectId: null });
    get().saveHistory();
    return newLight;
  },

  removeLight: (id) => {
    const project = { ...get().project, lights: get().project.lights.filter(l => l.id !== id) };
    set({ project });
    if (get().selectedLightId === id) set({ selectedLightId: null });
    get().saveHistory();
  },

  updateLight: (id, updates) => {
    const project = {
      ...get().project,
      lights: get().project.lights.map(l => l.id === id ? { ...l, ...updates } : l)
    };
    set({ project });
  },

  selectLight: (id) => {
    const { project } = get();
    set({
      selectedLightId: id,
      selectedObjectId: id ? null : get().selectedObjectId,
      selectedCameraId: null,
      ...(id ? {
        project: {
          ...project,
          objects: project.objects.map(o =>
            (o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0))
              ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
              : o
          )
        }
      } : {})
    });
  },

  addCamera: (type) => {
    const newCamera: CameraObject = {
      id: genId(),
      name: `Cámara ${type === 'PERSPECTIVE' ? 'Perspectiva' : 'Ortográfica'} ${get().project.cameras?.length + 1 || 1}`,
      type,
      transform: { position: [0, 2, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      fov: 45,
      near: 0.1,
      far: 100,
      zoom: 1,
    };
    const project = { ...get().project, cameras: [...(get().project.cameras || []), newCamera] };
    set({ project });
    set({ selectedCameraId: newCamera.id, selectedObjectId: null, selectedLightId: null, selectedObjectIds: [] });
    get().saveHistory();
  },

  removeCamera: (id) => {
    const project = { ...get().project, cameras: (get().project.cameras || []).filter(c => c.id !== id) };
    set({ project });
    if (get().selectedCameraId === id) set({ selectedCameraId: null });
    get().saveHistory();
  },

  updateCamera: (id, updates) => {
    const project = { ...get().project, cameras: (get().project.cameras || []).map(c => c.id === id ? { ...c, ...updates } : c) };
    set({ project });
  },

  selectCamera: (id) => {
    const { project } = get();
    set({
      selectedCameraId: id,
      selectedObjectId: null,
      selectedLightId: null,
      selectedObjectIds: [],
      project: {
        ...project,
        objects: project.objects.map(o =>
          (o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0))
            ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
            : o
        )
      }
    });
  },

  setSilueta: (patch) => set((state) => ({ project: { ...state.project, silueta: { ...state.project.silueta, ...patch } } })),
  updateEnvironment: (updates) => set((state) => ({ project: { ...state.project, environment: { ...state.project.environment, ...updates } } })),

  addMaterial: (material) => {
    const { project } = get();
    const newMaterial = { ...material, id: material.id || genId() } as MaterialData;
    set({ project: { ...project, materials: [...project.materials, newMaterial] } });
    get().saveHistory();
  },

  updateMaterial: (id, updates) => {
    const { project } = get();
    const mat = project.materials.find(m => m.id === id);
    if (!mat) return;

    const newMat = { ...mat, ...updates };
    
    // If any ORM channel changed and useORM is true, we should ideally regenerate.
    // But since createORMMap is async, we'll trigger it separately or handle it here.
    const ormChannelsChanged = 
      'aoMap' in updates || 
      'roughnessMap' in updates || 
      'metalnessMap' in updates;

    set({ project: { ...project, materials: project.materials.map(m => m.id === id ? newMat : m) } });
    
    if (ormChannelsChanged && newMat.useORM) {
      get().generateORM(id);
    }
    
    get().saveHistory();
  },

  generateORM: async (id) => {
    const { project, updateMaterial } = get();
    const mat = project.materials.find(m => m.id === id);
    if (!mat) return;

    const ormUrl = await createORMMap(
      mat.aoMap || null,
      mat.roughnessMap || null,
      mat.metalnessMap || null
    );

    if (ormUrl) {
      // Use set directly to avoid infinite loop if updateMaterial calls generateORM
      set(state => ({
        project: {
          ...state.project,
          materials: state.project.materials.map(m => m.id === id ? { ...m, ormMap: ormUrl } : m)
        }
      }));
    }
  },

  removeMaterial: (id) => {
    const { project } = get();
    set({
      project: {
        ...project,
        materials: project.materials.filter(m => m.id !== id),
        objects: project.objects.map(o => o.materialId === id ? { ...o, materialId: undefined } : o)
      }
    });
    get().saveHistory();
  },

  assignMaterialToObjects: (objectIds, materialId) => {
    const { project } = get();
    const assignedMat = materialId ? project.materials.find(m => m.id === materialId) : null;
    set({
      project: {
        ...project,
        objects: project.objects.map(o => {
          if (!objectIds.includes(o.id)) return o;
          const updated: CSGObject = {
            ...o,
            materialId: materialId ?? undefined,
            material: undefined, // Clear previous inline material overrides to prevent mixing/blending with old textures
          };
          if (assignedMat?.color) {
            updated.color = assignedMat.color;
          }
          return updated;
        })
      }
    });
    get().saveHistory();
  },

  selectObject: (id) => {
    const { project } = get();
    set({
      selectedObjectId: id,
      selectedObjectIds: id ? [id] : [],
      selectedGLTFMeshes: [],
      selectedCameraId: null,
      selectedLightId: null,
      ...(id === null
        ? {
            project: {
              ...project,
              objects: project.objects.map(o =>
                (o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0))
                  ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
                  : o
              )
            }
          }
        : {})
    });
  },

  toggleObjectSelection: (id, multi) => {
    const { selectedObjectIds } = get();
    const newIds = multi
      ? selectedObjectIds.includes(id)
        ? selectedObjectIds.filter(i => i !== id)
        : [...selectedObjectIds, id]
      : [id];
    set({ selectedObjectIds: newIds, selectedObjectId: newIds[newIds.length - 1] ?? null, selectedGLTFMeshes: [], selectedCameraId: null, selectedLightId: null });
  },

  setActiveViewport: (viewport) => set({ activeViewport: viewport }),
  setSelectedVertexIndices: (indices) => set({ selectedVertexIndices: indices }),
  setSelectedFaceIndices:   (indices) => set({ selectedFaceIndices: indices }),
  setSelectedEdgeIndices:   (indices) => set({ selectedEdgeIndices: indices }),
  setSelectedGLTFMeshes:    (meshes) => set({ selectedGLTFMeshes: meshes }),
  toggleGLTFMeshSelection: (meshId) => {
    const { selectedGLTFMeshes } = get();
    const newMeshes = selectedGLTFMeshes.includes(meshId)
      ? selectedGLTFMeshes.filter(id => id !== meshId)
      : [...selectedGLTFMeshes, meshId];
    set({ selectedGLTFMeshes: newMeshes });
  },
  setIsolateGLTFSelection: (isolate) => set({ isolateGLTFSelection: isolate }),
  clearSelection: () => {
    const { project } = get();
    set({ 
      selectedVertexIndices: [], 
      selectedFaceIndices: [], 
      selectedEdgeIndices: [], 
      selectedGLTFMeshes: [],
      isolateGLTFSelection: false,
      project: {
        ...project,
        objects: project.objects.map(o =>
          (o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0))
            ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
            : o
        )
      }
    });
  },
  setMaximizedViewport: (viewport) => set({ maximizedViewport: viewport }),
  setViewportCamera: (viewport, cameraState) => set((state) => ({
    viewportCameras: { ...state.viewportCameras, [viewport]: cameraState }
  })),
  setViewportPreset: (preset) => set((state) => ({
    viewportConfig: { ...state.viewportConfig, preset },
    maximizedViewport: null
  })),
  setViewportSplits: (splitX, splitY) => set((state) => ({
    viewportConfig: {
      ...state.viewportConfig,
      splitX: Math.max(0.15, Math.min(0.85, splitX)),
      splitY: Math.max(0.15, Math.min(0.85, splitY)),
    }
  })),
  setCustomResizeMode: (active) => set((state) => ({
    viewportConfig: { ...state.viewportConfig, customResizeMode: active }
  })),
  setSnapStep: (step) => set((state) => ({
    viewportConfig: { ...state.viewportConfig, snapStep: step }
  })),
  resetViewportSplits: () => set((state) => ({
    viewportConfig: { ...state.viewportConfig, splitX: 0.5, splitY: 0.5 }
  })),
  addSelectedVertexIndices: (indices) => {
    set({ selectedVertexIndices: Array.from(new Set([...get().selectedVertexIndices, ...indices])) });
  },
  expandSelection: () => {
    const { editMode, selectedObjectId, project, selectedVertexIndices, selectedFaceIndices, selectedEdgeIndices } = get();
    if (!selectedObjectId) return;
    const obj = project.objects.find(o => o.id === selectedObjectId);
    if (!obj || !obj.faces) return;

    if (editMode === 'VERTEX') {
      const newIndices = new Set<number>(selectedVertexIndices);
      selectedVertexIndices.forEach(vi => {
        obj.faces.forEach(face => {
          if (face.indices.includes(vi)) {
            face.indices.forEach(idx => newIndices.add(idx));
          }
        });
      });
      set({ selectedVertexIndices: Array.from(newIndices) });
    } else if (editMode === 'FACE') {
      const newIndices = new Set<number>(selectedFaceIndices);
      selectedFaceIndices.forEach(fi => {
        const face = obj.faces[fi];
        obj.faces.forEach((otherFace, ofi) => {
          if (newIndices.has(ofi)) return;
          const shared = otherFace.indices.filter(idx => face.indices.includes(idx));
          if (shared.length >= 2) {
            newIndices.add(ofi);
          }
        });
      });
      set({ selectedFaceIndices: Array.from(newIndices) });
    } else if (editMode === 'EDGE') {
      const newEdges = new Set<string>();
      const currentEdges: [number, number][] = [];
      for (let i = 0; i < selectedEdgeIndices.length; i += 2) {
        currentEdges.push([selectedEdgeIndices[i], selectedEdgeIndices[i+1]]);
        newEdges.add(`${Math.min(selectedEdgeIndices[i], selectedEdgeIndices[i+1])}-${Math.max(selectedEdgeIndices[i], selectedEdgeIndices[i+1])}`);
      }

      currentEdges.forEach(([v1, v2]) => {
        obj.faces.forEach(face => {
          const len = face.indices.length;
          for (let i = 0; i < len; i++) {
            const a = face.indices[i];
            const b = face.indices[(i + 1) % len];
            if ((a === v1 && b === v2) || (a === v2 && b === v1)) {
              for (let j = 0; j < len; j++) {
                const vA = face.indices[j];
                const vB = face.indices[(j + 1) % len];
                newEdges.add(`${Math.min(vA, vB)}-${Math.max(vA, vB)}`);
              }
            }
          }
        });
      });

      const result: number[] = [];
      newEdges.forEach(s => {
        const [a, b] = s.split('-').map(Number);
        result.push(a, b);
      });
      set({ selectedEdgeIndices: result });
    }
  },
  setShowCSG: (show) => set({ showCSG: show }),
  setShowGrid: (show) => set((state) => ({ project: { ...state.project, showGrid: show } })),
  setShowSkeleton: (show) => set((state) => ({ project: { ...state.project, showSkeleton: show } })),
  toggleShowSkeleton: () => set((state) => ({ project: { ...state.project, showSkeleton: !state.project.showSkeleton } })),
  setGridSnapEnabled: (enabled) => set({ gridSnapEnabled: enabled }),
  setFaceSnapConfig: (cfg) => set(s => ({ faceSnapConfig: { ...s.faceSnapConfig, ...cfg } })),
  toggleFaceSnap: () => set(s => ({ faceSnapConfig: { ...s.faceSnapConfig, enabled: !s.faceSnapConfig.enabled } })),
  setMoveReferenceMode: (enabled) => set({ moveReferenceMode: enabled }),

  setReference: (view, updates) => {
    const { project } = get();
    set({ project: { ...project, references: {
      ...project.references,
      [view]: { ...project.references[view], ...updates },
    }}});
  },

  // ── History ───────────────────────────────────────────────────────────────
  saveHistory: (actionLabel?: string, category?: HistoryStep['category']) => {
    const { history, historySteps, historyIndex, project, selectedObjectId } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    const newSteps = (historySteps || []).slice(0, historyIndex + 1);

    const totalSceneFaces = project.objects.reduce((acc: number, o: any) => acc + (o.faces?.length || o.stats?.faces || (o.meshData as any)?.facesCount || 0), 0);
    const totalSceneVertices = project.objects.reduce((acc: number, o: any) => acc + (o.vertices?.length || o.stats?.vertices || (o.meshData as any)?.verticesCount || 0), 0);

    const selObj = selectedObjectId ? project.objects.find((o: any) => o.id === selectedObjectId) : null;
    const fCount = selObj ? (selObj.faces?.length || selObj.stats?.faces || (selObj.meshData as any)?.facesCount || 0) : totalSceneFaces;
    const vCount = selObj ? (selObj.vertices?.length || selObj.stats?.vertices || (selObj.meshData as any)?.verticesCount || 0) : totalSceneVertices;

    // Previous step comparison
    const prevStep = newSteps.length > 0 ? newSteps[newSteps.length - 1] : null;
    let prevFaceCount: number | undefined = undefined;
    let prevVertexCount: number | undefined = undefined;
    let deltaFaces: number | undefined = undefined;
    let deltaVertices: number | undefined = undefined;

    if (prevStep) {
      if (selObj && prevStep.objectId === selObj.id && prevStep.faceCount !== undefined) {
        prevFaceCount = prevStep.faceCount;
        prevVertexCount = prevStep.vertexCount;
      } else if (prevStep.faceCount !== undefined && ((prevStep.objectCount === 1 && project.objects.length === 1) || !prevStep.objectId)) {
        prevFaceCount = prevStep.faceCount;
        prevVertexCount = prevStep.vertexCount;
      } else if (prevStep.totalSceneFaces !== undefined) {
        prevFaceCount = prevStep.totalSceneFaces;
        prevVertexCount = prevStep.totalSceneVertices;
      } else if (prevStep.faceCount !== undefined) {
        prevFaceCount = prevStep.faceCount;
        prevVertexCount = prevStep.vertexCount;
      }

      if (prevFaceCount !== undefined) {
        deltaFaces = fCount - prevFaceCount;
      }
      if (prevVertexCount !== undefined) {
        deltaVertices = vCount - prevVertexCount;
      }
    }

    let label = actionLabel;
    let cat = category || 'general';
    if (!label) {
      const prevProj = newHistory[newHistory.length - 1];
      const processingTitle = get().meshProcessing?.title;

      if (processingTitle) {
        label = processingTitle;
        cat = 'retopo';
      } else if (!prevProj) {
        label = 'Modificación de Proyecto';
      } else if (project.objects.length > prevProj.objects.length) {
        label = `Añadir ${selObj?.name || 'Objeto'}`;
        cat = 'create';
      } else if (project.objects.length < prevProj.objects.length) {
        label = 'Eliminar Objeto';
        cat = 'delete';
      } else if (selObj) {
        const prevObj = prevProj.objects.find((o: any) => o.id === selObj.id);
        if (prevObj) {
          const prevVerts = prevObj.vertices?.length ?? (prevObj.stats?.vertices ?? 0);
          const curVerts = vCount;
          const prevFaces = prevObj.faces?.length ?? (prevObj.stats?.faces ?? 0);
          const curFaces = fCount;

          if (curFaces !== prevFaces && curFaces > 0 && prevFaces > 0) {
            if (curFaces < prevFaces) {
              label = `Poda de Malla (-${(prevFaces - curFaces).toLocaleString()} caras)`;
              cat = 'retopo';
            } else {
              label = `Subdivisión / Relleno (+${(curFaces - prevFaces).toLocaleString()} caras)`;
              cat = 'edit';
            }
          } else if (curVerts !== prevVerts && curVerts > 0 && prevVerts > 0) {
            label = `Edición de Malla (${curVerts > prevVerts ? '+' : ''}${curVerts - prevVerts} v)`;
            cat = 'edit';
          } else if (
            prevObj.transform && selObj.transform &&
            (prevObj.transform.position.some((p: number, i: number) => Math.abs(p - selObj.transform.position[i]) > 1e-4) ||
             prevObj.transform.rotation.some((r: number, i: number) => Math.abs(r - selObj.transform.rotation[i]) > 1e-4) ||
             prevObj.transform.scale.some((s: number, i: number) => Math.abs(s - selObj.transform.scale[i]) > 1e-4))
          ) {
            label = 'Transformar: Mover / Rotar';
            cat = 'transform';
          } else if (JSON.stringify(prevObj.material) !== JSON.stringify(selObj.material) || prevObj.color !== selObj.color) {
            label = 'Material y Color';
            cat = 'material';
          } else {
            label = 'Edición de Malla';
            cat = 'edit';
          }
        } else {
          label = `Edición de ${selObj.name || selObj.type}`;
          cat = 'edit';
        }
      } else {
        label = 'Modificación de Escena';
      }
    }

    const step: HistoryStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      label,
      timestamp: Date.now(),
      objectName: selObj?.name || (project.objects.length === 1 ? project.objects[0]?.name : (project.objects.length > 0 ? `${project.objects.length} objetos` : 'Escena')),
      objectId: selObj?.id || (project.objects.length === 1 ? project.objects[0]?.id : undefined),
      objectCount: project.objects.length,
      faceCount: fCount,
      vertexCount: vCount,
      prevFaceCount,
      prevVertexCount,
      deltaFaces,
      deltaVertices,
      totalSceneFaces,
      totalSceneVertices,
      category: cat,
    };

    newHistory.push(JSON.parse(JSON.stringify(project)));
    newSteps.push(step);
    if (newHistory.length > 60) {
      newHistory.shift();
      newSteps.shift();
    }
    set({
      history: newHistory,
      historySteps: newSteps,
      historyIndex: newHistory.length - 1
    });
  },
  setLastCameraState: (cameraState) => set({ lastCameraState: cameraState }),

  undo: () => {
    const { historyIndex, history, selectedObjectId } = get();
    if (historyIndex > 0) {
      const prevProject = JSON.parse(JSON.stringify(history[historyIndex - 1]));
      const selObj = selectedObjectId ? prevProject.objects.find((o: any) => o.id === selectedObjectId) : null;
      const vCount = selObj?.vertices?.length ?? 0;
      const fCount = selObj?.faces?.length ?? 0;
      const curVerts = get().selectedVertexIndices;
      const curFaces = get().selectedFaceIndices;
      const curEdges = get().selectedEdgeIndices;

      set({
        historyIndex: historyIndex - 1,
        project: prevProject,
        selectedVertexIndices: curVerts.filter(i => i < 10000 ? i < vCount : true),
        selectedFaceIndices: curFaces.filter(i => i < fCount),
        selectedEdgeIndices: curEdges.filter(i => i < vCount)
      });
    }
  },
  redo: () => {
    const { historyIndex, history, selectedObjectId } = get();
    if (historyIndex < history.length - 1) {
      const nextProject = JSON.parse(JSON.stringify(history[historyIndex + 1]));
      const selObj = selectedObjectId ? nextProject.objects.find((o: any) => o.id === selectedObjectId) : null;
      const vCount = selObj?.vertices?.length ?? 0;
      const fCount = selObj?.faces?.length ?? 0;
      const curVerts = get().selectedVertexIndices;
      const curFaces = get().selectedFaceIndices;
      const curEdges = get().selectedEdgeIndices;

      set({
        historyIndex: historyIndex + 1,
        project: nextProject,
        selectedVertexIndices: curVerts.filter(i => i < 10000 ? i < vCount : true),
        selectedFaceIndices: curFaces.filter(i => i < fCount),
        selectedEdgeIndices: curEdges.filter(i => i < vCount)
      });
    }
  },
  jumpToHistory: (targetIndex: number) => {
    const { history, historyIndex, selectedObjectId } = get();
    if (targetIndex >= 0 && targetIndex < history.length && targetIndex !== historyIndex) {
      const targetProject = JSON.parse(JSON.stringify(history[targetIndex]));
      const selObj = selectedObjectId ? targetProject.objects.find((o: any) => o.id === selectedObjectId) : null;
      const vCount = selObj?.vertices?.length ?? 0;
      const fCount = selObj?.faces?.length ?? 0;
      const curVerts = get().selectedVertexIndices;
      const curFaces = get().selectedFaceIndices;
      const curEdges = get().selectedEdgeIndices;

      set({
        historyIndex: targetIndex,
        project: targetProject,
        selectedVertexIndices: curVerts.filter(i => i < 10000 ? i < vCount : true),
        selectedFaceIndices: curFaces.filter(i => i < fCount),
        selectedEdgeIndices: curEdges.filter(i => i < vCount)
      });
    }
  },
  clearHistory: () => {
    const { project, selectedObjectId } = get();
    const selObj = selectedObjectId ? project.objects.find((o: any) => o.id === selectedObjectId) : null;
    const totalSceneFaces = project.objects.reduce((acc: number, o: any) => acc + (o.faces?.length || o.stats?.faces || (o.meshData as any)?.facesCount || 0), 0);
    const totalSceneVertices = project.objects.reduce((acc: number, o: any) => acc + (o.vertices?.length || o.stats?.vertices || (o.meshData as any)?.verticesCount || 0), 0);
    const fCount = selObj ? (selObj.faces?.length || selObj.stats?.faces || (selObj.meshData as any)?.facesCount || 0) : totalSceneFaces;
    const vCount = selObj ? (selObj.vertices?.length || selObj.stats?.vertices || (selObj.meshData as any)?.verticesCount || 0) : totalSceneVertices;
    set({
      history: [JSON.parse(JSON.stringify(project))],
      historySteps: [
        {
          id: `step-${Date.now()}`,
          label: 'Estado Consolidado',
          timestamp: Date.now(),
          objectName: selObj?.name || 'Escena',
          objectId: selObj?.id,
          objectCount: project.objects.length,
          faceCount: fCount,
          vertexCount: vCount,
          totalSceneFaces,
          totalSceneVertices,
          category: 'general'
        }
      ],
      historyIndex: 0
    });
  },
  deleteHistoryStep: (targetIndex: number) => {
    const { history, historySteps, historyIndex, selectedObjectId } = get();
    if (history.length <= 1 || targetIndex < 0 || targetIndex >= history.length) {
      get().clearHistory();
      return;
    }

    const newHistory = history.filter((_, idx) => idx !== targetIndex);
    const newSteps = historySteps.filter((_, idx) => idx !== targetIndex);

    let newIndex = historyIndex;
    if (targetIndex < historyIndex) {
      newIndex = historyIndex - 1;
    } else if (targetIndex === historyIndex) {
      newIndex = Math.min(targetIndex, newHistory.length - 1);
    }

    const targetProject = JSON.parse(JSON.stringify(newHistory[newIndex]));
    const selObj = selectedObjectId ? targetProject.objects.find((o: any) => o.id === selectedObjectId) : null;
    const vCount = selObj?.vertices?.length ?? 0;
    const fCount = selObj?.faces?.length ?? 0;
    const curVerts = get().selectedVertexIndices;
    const curFaces = get().selectedFaceIndices;
    const curEdges = get().selectedEdgeIndices;

    set({
      history: newHistory,
      historySteps: newSteps,
      historyIndex: newIndex,
      project: targetProject,
      selectedVertexIndices: curVerts.filter(i => i < 10000 ? i < vCount : true),
      selectedFaceIndices: curFaces.filter(i => i < fCount),
      selectedEdgeIndices: curEdges.filter(i => i < vCount)
    });
  },
  deleteFutureHistory: () => {
    const { history, historySteps, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;
    const newHistory = history.slice(0, historyIndex + 1);
    const newSteps = historySteps.slice(0, historyIndex + 1);
    set({
      history: newHistory,
      historySteps: newSteps
    });
  },
  deletePastHistory: () => {
    const { history, historySteps, historyIndex } = get();
    if (historyIndex <= 0) return;
    const newHistory = history.slice(historyIndex);
    const newSteps = historySteps.slice(historyIndex);
    set({
      history: newHistory,
      historySteps: newSteps,
      historyIndex: 0
    });
  },
  deleteHistoryRange: (fromIndex: number, toIndex: number) => {
    const { history, historySteps, historyIndex, selectedObjectId } = get();
    const minIdx = Math.max(0, Math.min(fromIndex, toIndex));
    const maxIdx = Math.min(history.length - 1, Math.max(fromIndex, toIndex));

    const newHistory = history.filter((_, idx) => idx < minIdx || idx > maxIdx);
    const newSteps = historySteps.filter((_, idx) => idx < minIdx || idx > maxIdx);

    if (newHistory.length === 0) {
      get().clearHistory();
      return;
    }

    let newIndex = historyIndex;
    if (historyIndex > maxIdx) {
      newIndex = historyIndex - (maxIdx - minIdx + 1);
    } else if (historyIndex >= minIdx && historyIndex <= maxIdx) {
      newIndex = Math.min(minIdx, newHistory.length - 1);
    }

    const targetProject = JSON.parse(JSON.stringify(newHistory[newIndex]));
    const selObj = selectedObjectId ? targetProject.objects.find((o: any) => o.id === selectedObjectId) : null;
    const vCount = selObj?.vertices?.length ?? 0;
    const fCount = selObj?.faces?.length ?? 0;
    const curVerts = get().selectedVertexIndices;
    const curFaces = get().selectedFaceIndices;
    const curEdges = get().selectedEdgeIndices;

    set({
      history: newHistory,
      historySteps: newSteps,
      historyIndex: newIndex,
      project: targetProject,
      selectedVertexIndices: curVerts.filter(i => i < 10000 ? i < vCount : true),
      selectedFaceIndices: curFaces.filter(i => i < fCount),
      selectedEdgeIndices: curEdges.filter(i => i < vCount)
    });
  },

  // ── Add object ────────────────────────────────────────────────────────────
  addObject: (typeOrObj) => {
    const state = get();
    if (typeof typeOrObj === 'object' && typeOrObj !== null) {
      set({
        project: { ...state.project, objects: [...state.project.objects, typeOrObj] },
        selectedObjectId: typeOrObj.id,
        selectedObjectIds: [typeOrObj.id],
      });
      get().saveHistory();
      return;
    }
    const type = typeOrObj as PrimitiveType;
    const p: CSGObject['parameters'] = {};
    switch (type) {
      case 'GEOSPHERE':
        p.radius = 0.5;
        p.geodesicBaseType = 'ICOSAHEDRON';
        p.geodesicFrequency = 4;
        p.geodesicHemisphere = false;
        p.baseToPivot = false;
        break;
      case 'SPHERE':
        p.radius = 0.5;
        p.segments = 32;
        p.heightSegments = 16;
        p.sphereType = 'UV';
        p.hemisphere = 0.0;
        p.chopSquash = 'chop';
        p.sliceOn = false;
        p.sliceFrom = 0;
        p.sliceTo = 360;
        p.baseToPivot = false;
        break;
      case 'PARTICLE_SYSTEM':
        p.isParticleSystem = true;
        p.particleConfig = { ...DEFAULT_PARTICLE_CONFIG };
        break;
      case 'SPACE_WARP':
        p.isSpaceWarp = true;
        p.warpConfig = { ...DEFAULT_SPACE_WARP_CONFIG };
        break;
      case 'GPGPU_SWARM':
        p.isGpgpuSwarm = true;
        p.gpgpuSwarmConfig = { ...DEFAULT_GPGPU_SWARM_CONFIG };
        break;
      case 'CYLINDER':     p.segments = 32; break;
      case 'CONE':         p.segments = 32; break;
      case 'TORUS':        p.radialSegments = 16; p.tubularSegments = 100; p.radius = 0.5; p.tube = 0.2; break;
      case 'ICOSAHEDRON':  p.detail = 0; break;
      case 'DODECAHEDRON': p.detail = 0; break;
      case 'TETRAHEDRON':  p.detail = 0; break;
      case 'OCTAHEDRON':   p.detail = 0; break;
      case 'PYRAMID':      p.segments = 4; p.heightSegments = 1; break;
      case 'PRISM':        p.segments = 3; p.heightSegments = 1; break;
      case 'CAPSULE':      p.segments = 16; break;
      case 'TUBE':         p.innerRadius = 0.25; p.outerRadius = 0.5; p.segments = 32; break;
      case 'ARC':          p.innerRadius = 0.25; p.outerRadius = 0.5; p.arcAngle = 180; p.height = 0.5; p.segments = 32; break;
      case 'STAR':         p.starPoints = 5; p.innerRadius = 0.25; p.outerRadius = 0.5; p.height = 0.5; break;
      case 'HEMISPHERE':   p.segments = 32; break;
      case 'CIRCLE':       p.segments = 32; break;
      case 'RING':         p.innerRadius = 0.25; p.outerRadius = 0.5; p.thetaSegments = 32; break;
      case 'NURBS_CURVE':
        p.nurbsCurve = createDefaultNurbsCurve();
        p.segments = 32;
        p.radius = 0.03;
        break;
      case 'NURBS_CIRCLE':
        p.nurbsCurve = createDefaultNurbsCircle(1.0);
        p.segments = 48;
        p.tube = 0.03;
        break;
      case 'NURBS_SURFACE':
        p.nurbsSurface = createDefaultNurbsSurface(2.0);
        p.nurbsResolutionU = 16;
        p.nurbsResolutionV = 16;
        break;
      case 'NURBS_CYLINDER':
        p.nurbsSurface = createDefaultNurbsCylinder(0.8, 2.0);
        p.nurbsResolutionU = 16;
        p.nurbsResolutionV = 32;
        break;
      case 'NURBS_CONE':
        p.nurbsSurface = createDefaultNurbsCone(1.0, 2.0);
        p.nurbsResolutionU = 16;
        p.nurbsResolutionV = 32;
        break;
      case 'NURBS_SPHERE':
        p.nurbsSurface = createDefaultNurbsSphere(1.0);
        p.nurbsResolutionU = 24;
        p.nurbsResolutionV = 32;
        break;
      case 'NURBS_TORUS':
        p.nurbsSurface = createDefaultNurbsTorus(1.0, 0.35);
        p.nurbsResolutionU = 24;
        p.nurbsResolutionV = 32;
        break;
      case 'VOLUME_CLOUD':
        p.isVolumetric = true;
        p.volumetric = { ...DEFAULT_VOLUMETRIC_CONFIG };
        break;
      default:             p.segments = 1;
    }
    const geom = generatePrimitive(type, p);
    const names: Record<string,string> = {
      CUBE:'Cubo',SPHERE:'Esfera',GEOSPHERE:'GeoEsfera',CYLINDER:'Cilindro',CONE:'Cono',TORUS:'Toroide',
      ICOSAHEDRON:'Icosaedro',DODECAHEDRON:'Dodecaedro',PYRAMID:'Pirámide',PRISM:'Prisma',
      CAPSULE:'Cápsula',TETRAHEDRON:'Tetraedro',OCTAHEDRON:'Octaedro',TUBE:'Tubo',
      ARC:'Arco 3D',STAR:'Estrella 3D',
      WEDGE:'Cuña',HEMISPHERE:'Hemisferio',PLANE:'Plano',CIRCLE:'Círculo',RING:'Anillo',SHAPE:'Forma',
      VOLUME_CLOUD:'Cubo Volumétrico (Nube 3D)',
      PARTICLE_SYSTEM:'Sistema de Partículas (PF Source)',
      SPACE_WARP:'Deformador Espacial (Space Warp)',
      GPGPU_SWARM:'Enjambre GPGPU (GPU Swarm)',
      NURBS_CURVE:'Curva NURBS',NURBS_CIRCLE:'Círculo NURBS',NURBS_SURFACE:'Superficie NURBS',
      NURBS_CYLINDER:'Cilindro NURBS',NURBS_CONE:'Cono NURBS',NURBS_SPHERE:'Esfera NURBS',NURBS_TORUS:'Toroide NURBS'
    };
    const isNurbsType = type.startsWith('NURBS_');
    const isVol = type === 'VOLUME_CLOUD' || p.isVolumetric === true;
    const isParticle = type === 'PARTICLE_SYSTEM' || p.isParticleSystem === true;
    const isWarp = type === 'SPACE_WARP' || p.isSpaceWarp === true;
    const isGpgpu = type === 'GPGPU_SWARM' || p.isGpgpuSwarm === true;
    const newObj: CSGObject = {
      id: genId(),
      name: `${names[type] ?? type} ${state.project.objects.length + 1}`,
      type, operation: 'ADD',
      transform: { position:[0,0,0], rotation:[0,0,0], scale:[1,1,1] },
      parameters: p,
      nurbsCurve: p.nurbsCurve,
      nurbsSurface: p.nurbsSurface,
      isNurbs: isNurbsType,
      isVolumetric: isVol,
      volumetric: isVol ? { ...DEFAULT_VOLUMETRIC_CONFIG, ...(p.volumetric || {}) } : undefined,
      isParticleSystem: isParticle,
      particleConfig: isParticle ? { ...DEFAULT_PARTICLE_CONFIG, ...(p.particleConfig || {}) } : undefined,
      isSpaceWarp: isWarp,
      warpConfig: isWarp ? { ...DEFAULT_SPACE_WARP_CONFIG, ...(p.warpConfig || {}) } : undefined,
      isGpgpuSwarm: isGpgpu,
      gpgpuSwarmConfig: isGpgpu ? { ...DEFAULT_GPGPU_SWARM_CONFIG, ...(p.gpgpuSwarmConfig || {}) } : undefined,
      vertices: geom.vertices, faces: geom.faces,
      color: isVol ? '#ffffff' : isGpgpu ? '#38bdf8' : isParticle ? '#38bdf8' : isWarp ? '#a855f7' : '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
      smoothShading: ['SPHERE', 'GEOSPHERE', 'CYLINDER', 'CONE', 'TORUS', 'CAPSULE', 'HEMISPHERE', 'TUBE', 'NURBS_SURFACE', 'NURBS_CYLINDER', 'NURBS_CONE', 'NURBS_SPHERE', 'NURBS_TORUS'].includes(type),
      opacity: 1, visible: true, keyframes: [],
    };
    set({ project: { ...state.project, objects: [...state.project.objects, newObj] }, selectedObjectId: newObj.id, selectedObjectIds: [newObj.id] });
    get().saveHistory();
  },

  // ── FIX: addShape — bezier handles auto-smoothed even when provided ────────
  addShape: (type, vertices, closed, customHandles) => {
    const state = get();
    let handles: BezierHandle[] = customHandles
      ? customHandles.map(h => ({ broken: h.broken, out: [...h.out] as V3, in: [...h.in] as V3 }))
      : vertices.map(() => ({ out: [0,0,0] as V3, in: [0,0,0] as V3, broken: false }));

    // Always auto-smooth zero handles for bezier type.
    // Fixes: clicking without dragging → all [0,0,0] handles → straight lines.
    if (type === 'bezier') {
      handles = autoSmoothBezierHandles(vertices, handles, closed);
    }

    const newObj: CSGObject = {
      id: genId(),
      name: `Forma ${state.project.objects.length + 1}`,
      type: 'SHAPE', operation: 'ADD',
      transform: { position:[0,0,0], rotation:[0,0,0], scale:[1,1,1] },
      parameters: { shapeType: type, closed, segments: type === 'bezier' ? 20 : 1 },
      vertices, bezierHandles: handles, faces: [],
      color: state.drawColor, smoothShading: false, opacity: 1, visible: true, keyframes: [],
    };
    set({
      project: { ...state.project, objects: [...state.project.objects, newObj] },
      selectedObjectId: newObj.id, selectedObjectIds: [newObj.id],
      drawMode: null,
    });
    get().saveHistory();
  },

  // ── addShapeVertices: extend existing shape with new points ───────────────
  addShapeVertices: (id, newVerts, newHandles) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o => {
      if (o.id !== id) return o;
      const updatedVerts   = [...o.vertices,       ...newVerts];
      const updatedHandles = [...(o.bezierHandles ?? []), ...newHandles];
      const smoothed = o.parameters.shapeType === 'bezier'
        ? autoSmoothBezierHandles(updatedVerts, updatedHandles, o.parameters.closed ?? false)
        : updatedHandles;
      return { ...o, vertices: updatedVerts, bezierHandles: smoothed };
    })}});
    get().saveHistory();
  },

  // ── Update ────────────────────────────────────────────────────────────────
  updateObject: (id, updates) => {
    const { project, isRecording, currentTime } = get();
    
    set({ project: { ...project, objects: project.objects.map(o => {
      if (o.id !== id) return o;
      
      // If recording OR object already has keyframes, and updating transform, add/update keyframe instead of base transform
      const hasKeyframes = o.keyframes && o.keyframes.length > 0;
      if ((isRecording || hasKeyframes) && updates.transform) {
        const kfs = [...(o.keyframes || [])];
        const existingIdx = kfs.findIndex(k => Math.abs(k.time - currentTime) < 0.001);
        
        if (existingIdx >= 0) {
          kfs[existingIdx] = { ...kfs[existingIdx], transform: { ...kfs[existingIdx].transform, ...updates.transform } };
        } else {
          // If no keyframe at exact time, create one.
          // Base it on the current interpolated transform to avoid jumps, then apply updates
          const _interpTransform = (() => {
            if (kfs.length === 0) return o.transform;
            const sorted = [...kfs].sort((a, b) => a.time - b.time);
            if (currentTime <= sorted[0].time) return sorted[0].transform;
            if (currentTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
            let prev = sorted[0], next = sorted[0];
            for (let _i = 0; _i < sorted.length - 1; _i++) {
              if (currentTime >= sorted[_i].time && currentTime <= sorted[_i+1].time) {
                prev = sorted[_i]; next = sorted[_i+1]; break;
              }
            }
            const t = (currentTime - prev.time) / (next.time - prev.time);
            const lerp = (a: number, b: number) => a + (b-a)*t;
            return {
              position: [lerp(prev.transform.position[0], next.transform.position[0]),
                         lerp(prev.transform.position[1], next.transform.position[1]),
                         lerp(prev.transform.position[2], next.transform.position[2])] as [number,number,number],
              rotation: [lerp(prev.transform.rotation[0], next.transform.rotation[0]),
                         lerp(prev.transform.rotation[1], next.transform.rotation[1]),
                         lerp(prev.transform.rotation[2], next.transform.rotation[2])] as [number,number,number],
              scale:    [lerp(prev.transform.scale[0], next.transform.scale[0]),
                         lerp(prev.transform.scale[1], next.transform.scale[1]),
                         lerp(prev.transform.scale[2], next.transform.scale[2])] as [number,number,number],
            };
          })();
          
          kfs.push({
            id: genId(),
            time: currentTime,
            transform: { ..._interpTransform, ...updates.transform }
          });
          kfs.sort((a, b) => a.time - b.time);
        }
        
        // Apply non-transform updates to the base object
        const { transform, ...otherUpdates } = updates;
        return { ...o, ...otherUpdates, keyframes: kfs };
      }
      
      return { ...o, ...updates };
    }) } });
  },

  updateObjects: (ids, updates) => {
    const { project, isRecording, currentTime } = get();
    const idSet = new Set(ids);
    
    set({ project: { ...project, objects: project.objects.map(o => {
      if (!idSet.has(o.id)) return o;
      
      const objUpdates = typeof updates === 'function' ? updates(o.id) : updates;
      
      // If recording OR object already has keyframes, and updating transform, add/update keyframe instead of base transform
      const hasKeyframes = o.keyframes && o.keyframes.length > 0;
      if ((isRecording || hasKeyframes) && objUpdates.transform) {
        const kfs = [...(o.keyframes || [])];
        const existingIdx = kfs.findIndex(k => Math.abs(k.time - currentTime) < 0.001);
        
        if (existingIdx >= 0) {
          kfs[existingIdx] = { ...kfs[existingIdx], transform: { ...kfs[existingIdx].transform, ...objUpdates.transform } };
        } else {
          // If no keyframe at exact time, create one.
          // Base it on the current interpolated transform to avoid jumps, then apply updates
          const _interpTransform = (() => {
            if (kfs.length === 0) return o.transform;
            const sorted = [...kfs].sort((a, b) => a.time - b.time);
            if (currentTime <= sorted[0].time) return sorted[0].transform;
            if (currentTime >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
            let prev = sorted[0], next = sorted[0];
            for (let _i = 0; _i < sorted.length - 1; _i++) {
              if (currentTime >= sorted[_i].time && currentTime <= sorted[_i+1].time) {
                prev = sorted[_i]; next = sorted[_i+1]; break;
              }
            }
            const t = (currentTime - prev.time) / (next.time - prev.time);
            const lerp = (a: number, b: number) => a + (b-a)*t;
            return {
              position: [lerp(prev.transform.position[0], next.transform.position[0]),
                         lerp(prev.transform.position[1], next.transform.position[1]),
                         lerp(prev.transform.position[2], next.transform.position[2])] as [number,number,number],
              rotation: [lerp(prev.transform.rotation[0], next.transform.rotation[0]),
                         lerp(prev.transform.rotation[1], next.transform.rotation[1]),
                         lerp(prev.transform.rotation[2], next.transform.rotation[2])] as [number,number,number],
              scale:    [lerp(prev.transform.scale[0], next.transform.scale[0]),
                         lerp(prev.transform.scale[1], next.transform.scale[1]),
                         lerp(prev.transform.scale[2], next.transform.scale[2])] as [number,number,number],
            };
          })();
          
          kfs.push({
            id: genId(),
            time: currentTime,
            transform: { ..._interpTransform, ...objUpdates.transform }
          });
          kfs.sort((a, b) => a.time - b.time);
        }
        
        // Apply non-transform updates to the base object
        const { transform, ...otherUpdates } = objUpdates;
        return { ...o, ...otherUpdates, keyframes: kfs };
      }
      
      return { ...o, ...objUpdates };
    }) } });
  },

  updateParameters: (id, params) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || obj.type === 'MESH') return;
    const newParams = { ...obj.parameters, ...params };
    
    // For SHAPE objects, we need to pass the current vertices and handles as the profile
    const genParams = obj.type === 'SHAPE' 
      ? { ...newParams, profileVertices: obj.vertices, profileBezierHandles: obj.bezierHandles }
      : newParams;

    const geom = (obj.type === 'SHAPE' && newParams.extrusionDepth === undefined)
      ? { vertices: obj.vertices, faces: obj.faces }
      : generatePrimitive(obj.type, genParams);

    set({ project: { ...project, objects: project.objects.map(o =>
      o.id === id ? { 
        ...o, 
        parameters: newParams, 
        vertices: geom.vertices, 
        faces: geom.faces, 
        // Only clear offsets for primitives, keep them for SHAPE as they are control point offsets
        vertexOffsets: o.type === 'SHAPE' ? o.vertexOffsets : {} 
      } : o
    )}});
    get().saveHistory();
  },

  updateVertexOffset: (id, vertexIndex, offset) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o => {
      if (o.id !== id) return o;
      if (o.type === 'SHAPE') {
        return { ...o, vertexOffsets: { ...(o.vertexOffsets ?? {}), [vertexIndex]: offset } };
      }
      return { ...o, type: 'MESH', parameters: {}, vertexOffsets: { ...(o.vertexOffsets ?? {}), [vertexIndex]: offset } };
    })}});
  },

  updateVertexOffsets: (id, updates) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o => {
      if (o.id !== id) return o;
      const vo = { ...(o.vertexOffsets ?? {}) };
      updates.forEach(({ index, offset }) => { vo[index] = offset; });
      if (o.type === 'SHAPE') {
        return { ...o, vertexOffsets: vo };
      }
      return { ...o, type: 'MESH', parameters: {}, vertexOffsets: vo };
    })}});
  },

  updateBezierHandle: (id, index, side, offset, broken = false) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o => {
      if (o.id !== id || !o.bezierHandles?.[index]) return o;
      const handles = [...o.bezierHandles];
      const h = { ...handles[index] };
      if (side === 'out') h.out = offset; else h.in = offset;
      if (!broken && !h.broken) {
        if (side === 'out') h.in  = [-offset[0], -offset[1], -offset[2]];
        else                h.out = [-offset[0], -offset[1], -offset[2]];
      }
      handles[index] = h;
      return { ...o, bezierHandles: handles };
    })}});
  },

  // ── Remove / Duplicate ────────────────────────────────────────────────────
  removeObject: (id) => {
    const { project, selectedObjectId, selectedObjectIds } = get();
    const safeIds = selectedObjectIds || [];
    const newIds = safeIds.filter(i => i !== id);
    const newSel = selectedObjectId === id ? (newIds[newIds.length-1] ?? null) : selectedObjectId;
    set({ project: { ...project, objects: project.objects.filter(o => o.id !== id) }, selectedObjectId: newSel, selectedObjectIds: newIds });
    get().saveHistory();
  },

  removeObjects: (ids) => {
    if (!ids || ids.length === 0) return;
    const { project, selectedObjectId, selectedObjectIds } = get();
    const idSet = new Set(ids);
    const safeIds = selectedObjectIds || [];
    const newIds = safeIds.filter(i => !idSet.has(i));
    const newSel = idSet.has(selectedObjectId || '') ? (newIds[newIds.length - 1] ?? null) : selectedObjectId;
    set({
      project: { ...project, objects: project.objects.filter(o => !idSet.has(o.id)) },
      selectedObjectId: newSel,
      selectedObjectIds: newIds
    });
    get().saveHistory();
  },

  duplicateObject: (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    const newObj = { ...JSON.parse(JSON.stringify(obj)), id: genId(), name: `${obj.name} (Copia)` };
    if (newObj.transform && newObj.transform.position) {
      newObj.transform.position[0] += 0.5;
      newObj.transform.position[2] += 0.5;
    }
    set({ project: { ...project, objects: [...project.objects, newObj] }, selectedObjectId: newObj.id, selectedObjectIds: [newObj.id] });
    get().saveHistory();
  },

  moveObjectUp: (id) => {
    const { project } = get();
    const idx = project.objects.findIndex(o => o.id === id);
    if (idx <= 0) return;
    const newObjects = [...project.objects];
    [newObjects[idx - 1], newObjects[idx]] = [newObjects[idx], newObjects[idx - 1]];
    set({ project: { ...project, objects: newObjects } });
    get().saveHistory();
  },

  moveObjectDown: (id) => {
    const { project } = get();
    const idx = project.objects.findIndex(o => o.id === id);
    if (idx < 0 || idx >= project.objects.length - 1) return;
    const newObjects = [...project.objects];
    [newObjects[idx], newObjects[idx + 1]] = [newObjects[idx + 1], newObjects[idx]];
    set({ project: { ...project, objects: newObjects } });
    get().saveHistory();
  },

  copyObject: () => {
    const { project, selectedObjectId } = get();
    const obj = project.objects.find(o => o.id === selectedObjectId);
    if (obj) set({ clipboard: JSON.parse(JSON.stringify(obj)) });
  },

  pasteObject: () => {
    const { project, clipboard } = get();
    if (!clipboard) return;
    const newObj = JSON.parse(JSON.stringify(clipboard));
    newObj.id = genId();
    newObj.name = `${newObj.name} (Copia)`;
    newObj.transform.position = newObj.transform.position.map((v: number) => v + 0.5);
    set({ project: { ...project, objects: [...project.objects, newObj] }, selectedObjectId: newObj.id, selectedObjectIds: [newObj.id] });
    get().saveHistory();
  },

  mirrorObject: (id, axis) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    const newObj = JSON.parse(JSON.stringify(obj));
    newObj.id = genId();
    newObj.name = `${obj.name} (Espejo ${axis.toUpperCase()})`;
    newObj.transform.scale[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] *= -1;
    set({ project: { ...project, objects: [...project.objects, newObj] }, selectedObjectId: newObj.id, selectedObjectIds: [newObj.id] });
    get().saveHistory();
  },

  // ── extrudeFaces ──────────────────────────────────────────────────────────
  extrudeFaces: (id, faceIndices, distance) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    const selectedVertSet = new Set<number>();
    faceIndices.forEach(fIdx => newObj.faces[fIdx]?.indices.forEach(vIdx => selectedVertSet.add(vIdx)));

    // Averaged normal
    let avgNormal: V3 = [0,0,0];
    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx];
      if (!face) return;
      const pos = face.indices.map(vIdx => {
        const base = newObj.vertices[vIdx];
        const off  = newObj.vertexOffsets?.[vIdx] ?? [0,0,0];
        return [base[0]+off[0], base[1]+off[1], base[2]+off[2]] as V3;
      });
      const n = computeNormal(pos, [0,1,2]);
      avgNormal[0] += n[0]; avgNormal[1] += n[1]; avgNormal[2] += n[2];
    });
    const mag = Math.sqrt(avgNormal[0]**2+avgNormal[1]**2+avgNormal[2]**2) || 1;
    avgNormal = [avgNormal[0]/mag, avgNormal[1]/mag, avgNormal[2]/mag];

    const oldToNew = new Map<number, number>();
    selectedVertSet.forEach(vIdx => {
      const base = newObj.vertices[vIdx];
      const off  = newObj.vertexOffsets?.[vIdx] ?? [0,0,0];
      const pos: V3 = [base[0]+off[0], base[1]+off[1], base[2]+off[2]];
      newObj.vertices.push([
        pos[0] + avgNormal[0] * distance,
        pos[1] + avgNormal[1] * distance,
        pos[2] + avgNormal[2] * distance,
      ]);
      oldToNew.set(vIdx, newObj.vertices.length - 1);
    });

    // Boundary edges → side faces
    const edgeCounts = new Map<string, { a: number; b: number; count: number }>();
    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx]; if (!face) return;
      for (let i = 0; i < face.indices.length; i++) {
        const a = face.indices[i], b = face.indices[(i+1) % face.indices.length];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const ex = edgeCounts.get(key);
        ex ? ex.count++ : edgeCounts.set(key, { a, b, count: 1 });
      }
    });

    edgeCounts.forEach(info => {
      if (info.count !== 1) return;
      let v1 = info.a, v2 = info.b;
      faceIndices.map(fi => newObj.faces[fi]).find(f => {
        if (!f) return false;
        for (let i = 0; i < f.indices.length; i++) {
          if (f.indices[i] === info.a && f.indices[(i+1)%f.indices.length] === info.b) { v1=info.a; v2=info.b; return true; }
          if (f.indices[i] === info.b && f.indices[(i+1)%f.indices.length] === info.a) { v1=info.b; v2=info.a; return true; }
        }
        return false;
      });
      const nv1 = oldToNew.get(v1), nv2 = oldToNew.get(v2);
      if (nv1 === undefined || nv2 === undefined) return;
      if (distance < 0) {
        newObj.faces.push({ indices: [v1, nv1, nv2, v2] });
      } else {
        newObj.faces.push({ indices: [v1, v2, nv2, nv1] });
      }
    });

    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx]; if (!face) return;
      if (distance < 0) {
        face.indices = face.indices.map(vIdx => oldToNew.get(vIdx) ?? vIdx).reverse();
      } else {
        face.indices = face.indices.map(vIdx => oldToNew.get(vIdx) ?? vIdx);
      }
      face.normal  = computeNormal(newObj.vertices, face.indices);
    });

    newObj.parameters = {};

    if (newObj.vertexOffsets) {
      selectedVertSet.forEach(vIdx => {
        const off = newObj.vertexOffsets![vIdx];
        if (off) {
          newObj.vertices[vIdx] = [
            newObj.vertices[vIdx][0]+off[0],
            newObj.vertices[vIdx][1]+off[1],
            newObj.vertices[vIdx][2]+off[2],
          ];
          delete newObj.vertexOffsets![vIdx];
        }
      });
    }

    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? newObj : o) }, selectedVertexIndices: Array.from(oldToNew.values()) });
    get().saveHistory();
  },

  extrudeShape: (id, depth, axis = 'y') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    let vertices: V3[] = [];
    let faces: MeshFace[] = [];
    let profilePoints: V3[] | undefined;

    const isWireOrShape = obj.type === 'SHAPE' || !obj.faces || obj.faces.length === 0;

    if (isWireOrShape && obj.vertices && obj.vertices.length >= 2) {
      // ── Perfil 2D / Polilínea / Curva / Forma Plana ─────────
      const rawVerts = obj.vertices.map((v, i) => {
        const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
        return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
      });

      const isBezier = obj.parameters?.shapeType === 'bezier' && !!obj.bezierHandles?.length;
      let isClosed = obj.parameters?.closed ?? (obj.type === 'SHAPE' ? (obj.parameters?.closed ?? false) : true);
      const segs = Math.max(4, obj.parameters?.segments ?? 20);

      let profile: V3[];
      if (isBezier && obj.bezierHandles) {
        const smoothed = autoSmoothBezierHandles(rawVerts, obj.bezierHandles, isClosed);
        profile = sampleBezierCurve(rawVerts, smoothed, isClosed, segs);
      } else {
        profile = [...rawVerts];
      }

      // Check if start and end are coincident or nearly coincident
      if (profile.length > 2) {
        const first = profile[0], last = profile[profile.length - 1];
        const d = Math.sqrt(
          (first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2 + (first[2] - last[2]) ** 2,
        );
        if (d < 0.25) {
          isClosed = true;
          if (d < 0.0001) profile.pop();
        }
      }

      const n = profile.length;
      if (n >= 2) {
        const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        const ext: V3 = [0, 0, 0];
        ext[axisIdx] = depth;

        vertices = [
          ...profile,
          ...profile.map(v => [v[0] + ext[0], v[1] + ext[1], v[2] + ext[2]] as V3),
        ];

        faces = [];
        const isNegative = depth < 0;

        if (isClosed && n >= 3) {
          // Closed solid volume with side quads + triangulated end caps
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            if (isNegative) {
              faces.push({ indices: [i, i + n, j + n, j] });
            } else {
              faces.push({ indices: [i, j, j + n, i + n] });
            }
          }

          // Create clean N-gon planar end caps without diagonal internal wireframe lines
          const uIdx = axis === 'x' ? 1 : 0;
          const vIdx = axis === 'x' ? 2 : (axis === 'y' ? 2 : 1);
          const pts2D = profile.map(p => new THREE.Vector2(p[uIdx], p[vIdx]));
          const isCCW = !THREE.ShapeUtils.isClockWise(pts2D);

          const cap1Indices: number[] = [];
          const cap2Indices: number[] = [];

          if ((!isCCW && !isNegative) || (isCCW && isNegative)) {
            for (let k = 0; k < n; k++) {
              cap1Indices.push(n - 1 - k);
              cap2Indices.push(k + n);
            }
          } else {
            for (let k = 0; k < n; k++) {
              cap1Indices.push(k);
              cap2Indices.push(2 * n - 1 - k);
            }
          }

          faces.push({ indices: cap1Indices });
          faces.push({ indices: cap2Indices });
        } else {
          // Open line / polyline: extrude as a 3D curved surface / strip
          for (let i = 0; i < n - 1; i++) {
            const j = i + 1;
            if (isNegative) {
              faces.push({ indices: [i, i + n, j + n, j] });
            } else {
              faces.push({ indices: [i, j, j + n, i + n] });
            }
          }
        }

        profilePoints = profile;
      }
    }

    if (vertices.length === 0 || faces.length === 0) {
      // ── Sólido genérico / Primitiva / Objeto importado ──────────
      let tempObj = { ...obj };
      if (!tempObj.vertices || tempObj.vertices.length === 0) {
        // Generar vértices/caras desde la geometría si no existen
        const geo = createBaseGeometry(tempObj);
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const index = geo.getIndex();
        
        const verts: V3[] = [];
        if (pos) {
          for (let i = 0; i < pos.count; i++) {
            verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)] as V3);
          }
        }
        
        const fList: MeshFace[] = [];
        if (index) {
          for (let i = 0; i < index.count; i += 3) {
            fList.push({ indices: [index.getX(i), index.getX(i + 1), index.getX(i + 2)] });
          }
        } else if (pos) {
          for (let i = 0; i < pos.count; i += 3) {
            fList.push({ indices: [i, i + 1, i + 2] });
          }
        }
        tempObj.vertices = verts;
        tempObj.faces = fList;
      }

      const result = solidExtrudeMesh(tempObj, depth, axis);
      if (!result) return;
      vertices = result.vertices;
      faces    = result.faces;
    }

    const newObj: CSGObject = {
      ...obj,
      name: `${obj.name} (Extruido)`,
      type: 'MESH',
      vertices,
      faces,
      vertexOffsets: {},
      bezierHandles: undefined,
      parameters: {
        ...obj.parameters,
        shapeType: undefined,
        isCameraPath: false,
        extrusionDepth:         depth,
        extrusionAxis:          axis,
        profileVertices:        profilePoints,
        profileBezierHandles:   obj.bezierHandles,
      },
    };

    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? newObj : o) } });
    get().saveHistory();
  },

  // ── subdivideFaces ────────────────────────────────────────────────────────
  subdivideFaces: (id, faceIndices) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || faceIndices.length === 0) return;

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH'; // Convert to pure mesh
    
    const edgeMidpoints = new Map<string, number>();
    const getEdgeKey = (v1: number, v2: number) => Math.min(v1, v2) + '_' + Math.max(v1, v2);
    
    const newFaces: MeshFace[] = [];
    const facesToRemove = new Set(faceIndices);
    
    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx];
      if (!face) return;
      
      const n = face.indices.length;
      if (n < 3) return;
      
      let cx = 0, cy = 0, cz = 0;
      face.indices.forEach(vIdx => {
        const base = newObj.vertices[vIdx];
        const off = newObj.vertexOffsets?.[vIdx] ?? [0,0,0];
        cx += base[0] + off[0];
        cy += base[1] + off[1];
        cz += base[2] + off[2];
      });
      cx /= n; cy /= n; cz /= n;
      
      const centerIdx = newObj.vertices.length;
      newObj.vertices.push([cx, cy, cz]);
      
      const midIndices: number[] = [];
      for (let i = 0; i < n; i++) {
        const v1 = face.indices[i];
        const v2 = face.indices[(i + 1) % n];
        const edgeKey = getEdgeKey(v1, v2);
        
        if (edgeMidpoints.has(edgeKey)) {
          midIndices.push(edgeMidpoints.get(edgeKey)!);
        } else {
          const b1 = newObj.vertices[v1];
          const o1 = newObj.vertexOffsets?.[v1] ?? [0,0,0];
          const b2 = newObj.vertices[v2];
          const o2 = newObj.vertexOffsets?.[v2] ?? [0,0,0];
          
          const mx = (b1[0] + o1[0] + b2[0] + o2[0]) / 2;
          const my = (b1[1] + o1[1] + b2[1] + o2[1]) / 2;
          const mz = (b1[2] + o1[2] + b2[2] + o2[2]) / 2;
          
          const midIdx = newObj.vertices.length;
          newObj.vertices.push([mx, my, mz]);
          edgeMidpoints.set(edgeKey, midIdx);
          midIndices.push(midIdx);
        }
      }
      
      for (let i = 0; i < n; i++) {
        const v1 = face.indices[i];
        const m1 = midIndices[i];
        const mPrev = midIndices[(i - 1 + n) % n];
        newFaces.push({ indices: [v1, m1, centerIdx, mPrev] });
      }
    });
    
    newObj.faces = newObj.faces.filter((_, i) => !facesToRemove.has(i)).concat(newFaces);
    newObj.parameters = {};
    
    // Apply vertex offsets to base vertices and clear offsets
    if (newObj.vertexOffsets) {
      Object.entries(newObj.vertexOffsets).forEach(([idx, off]) => {
        const i = parseInt(idx);
        if (newObj.vertices[i]) {
          newObj.vertices[i][0] += off[0];
          newObj.vertices[i][1] += off[1];
          newObj.vertices[i][2] += off[2];
        }
      });
      newObj.vertexOffsets = {};
    }
    
    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? newObj : o) } });
    get().saveHistory();
  },

  // ── mergeFaces ────────────────────────────────────────────────────────────
  mergeFaces: (id, faceIndices) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || faceIndices.length < 2) return;

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH'; // Convert to pure mesh
    
    const edgeMap = new Map<string, { from: number; to: number }>();
    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx];
      if (!face) return;
      for (let i = 0; i < face.indices.length; i++) {
        const from = face.indices[i];
        const to = face.indices[(i + 1) % face.indices.length];
        const key = `${from},${to}`;
        const oppKey = `${to},${from}`;
        
        if (edgeMap.has(oppKey)) {
          edgeMap.delete(oppKey);
        } else {
          edgeMap.set(key, { from, to });
        }
      }
    });
    
    const boundaryEdges = Array.from(edgeMap.values());
    if (boundaryEdges.length === 0) return;
    
    const nextMap = new Map<number, number>();
    boundaryEdges.forEach(e => {
      nextMap.set(e.from, e.to);
    });
    
    const loop: number[] = [];
    let current = boundaryEdges[0].from;
    const start = current;
    
    while (true) {
      loop.push(current);
      const next = nextMap.get(current);
      if (next === undefined || next === start) break;
      current = next;
      if (loop.length > boundaryEdges.length) break;
    }
    
    const newFace: MeshFace = { indices: loop };
    const facesToRemove = new Set(faceIndices);
    newObj.faces = newObj.faces.filter((_, i) => !facesToRemove.has(i));
    newObj.faces.push(newFace);
    newObj.parameters = {};
    
    if (newObj.vertexOffsets) {
      Object.entries(newObj.vertexOffsets).forEach(([idx, off]) => {
        const i = parseInt(idx);
        if (newObj.vertices[i]) {
          newObj.vertices[i][0] += off[0];
          newObj.vertices[i][1] += off[1];
          newObj.vertices[i][2] += off[2];
        }
      });
      newObj.vertexOffsets = {};
    }
    
    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? newObj : o) }, selectedFaceIndices: [] });
    get().saveHistory();
  },

  // ── Cap selected faces (close hole by boundary loop) ─────────────────────
  capSelectedFaces: (id, faceIndices) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || faceIndices.length === 0) return;

    const newObj = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    // Build edge map from selected faces to find boundary loop
    const edgeMap = new Map<string, { from: number; to: number }>();
    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx];
      if (!face) return;
      for (let i = 0; i < face.indices.length; i++) {
        const from = face.indices[i];
        const to   = face.indices[(i + 1) % face.indices.length];
        const fwd  = `${from}:${to}`;
        const rev  = `${to}:${from}`;
        if (edgeMap.has(rev)) edgeMap.delete(rev);
        else edgeMap.set(fwd, { from, to });
      }
    });

    const boundaryEdges = Array.from(edgeMap.values());
    if (boundaryEdges.length < 3) return;

    // Walk boundary loop
    const nextMap = new Map<number, number>();
    boundaryEdges.forEach(e => nextMap.set(e.from, e.to));
    const loop: number[] = [];
    let cur = boundaryEdges[0].from;
    const start = cur;
    for (let i = 0; i < nextMap.size + 1; i++) {
      loop.push(cur);
      const next = nextMap.get(cur);
      if (next === undefined || next === start) break;
      cur = next;
    }

    if (loop.length < 3) return;

    // Create face from loop (fan from centroid)
    const cx = loop.reduce((s,i)=>s+newObj.vertices[i][0],0)/loop.length;
    const cy = loop.reduce((s,i)=>s+newObj.vertices[i][1],0)/loop.length;
    const cz = loop.reduce((s,i)=>s+newObj.vertices[i][2],0)/loop.length;
    const centerIdx = newObj.vertices.length;
    newObj.vertices.push([cx,cy,cz]);
    for (let i = 0; i < loop.length; i++) {
      newObj.faces.push({ indices: [centerIdx, loop[(i+1)%loop.length], loop[i]] });
    }

    newObj.parameters = {};
    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? newObj : o) }, selectedFaceIndices: [] });
    get().saveHistory();
  },

  // ── Boolean / Modifiers ───────────────────────────────────────────────────
  executeExplicitBoolean: async (options: BooleanExecuteOptions): Promise<BooleanResult> => {
    const { project } = get();
    const target = project.objects.find(o => o.id === options.targetId);
    const tool = project.objects.find(o => o.id === options.toolId);

    if (!target || !tool) {
      return { success: false, message: 'No se encontraron los objetos seleccionados para la operación booleana.' };
    }

    const result = await executeUnifiedBoolean(target, tool, options);
    if (result.success && result.resultTarget) {
      let newObjects = [...project.objects];

      // Eliminar herramientas consumidas
      if (result.removedObjectIds && result.removedObjectIds.length > 0) {
        newObjects = newObjects.filter(o => !result.removedObjectIds!.includes(o.id));
      }

      // Actualizar objeto objetivo
      newObjects = newObjects.map(o => o.id === result.resultTarget!.id ? result.resultTarget! : o);

      // Si se generó una segunda pieza (Split / Carve), agregarla a la escena
      if (result.resultSplitPiece) {
        newObjects.push(result.resultSplitPiece);
      }

      set({ 
        project: { ...project, objects: newObjects }, 
        selectedObjectId: result.resultTarget.id, 
        selectedObjectIds: [result.resultTarget.id] 
      });
      get().saveHistory();
    }
    return result;
  },

  applyBoolean: async (op) => {
    const { project, selectedObjectIds, selectedObjectId } = get();
    let targetId: string | undefined;
    let toolId: string | undefined;

    if (selectedObjectIds.length >= 2) {
      targetId = selectedObjectIds[0];
      toolId = selectedObjectIds[1];
    } else if (selectedObjectId) {
      // Si solo hay un objeto seleccionado, abrimos el modal del Estudio Booleano para máxima claridad
      get().openBooleanModal(selectedObjectId);
      return;
    }

    if (!targetId || !toolId) {
      get().openBooleanModal();
      return;
    }

    const operation: UnifiedBooleanOp = 
      op === 'ADD' ? 'UNION' :
      op === 'INTERSECT' ? 'INTERSECTION' : 'DIFFERENCE_AB';

    await get().executeExplicitBoolean({
      targetId,
      toolId,
      operation,
      keepTool: false,
      autoHeal: true,
      recenterPivot: true,
    });
  },

  selectAll: () => {
    const { project } = get();
    const allIds = project.objects.map(o => o.id);
    set({ selectedObjectIds: allIds, selectedObjectId: allIds[allIds.length - 1] || null });
  },
  deselectAll: () => {
    set({ selectedObjectIds: [], selectedObjectId: null });
  },
  invertSelection: () => {
    const { project, selectedObjectIds } = get();
    const allIds = project.objects.map(o => o.id);
    const newIds = allIds.filter(id => !selectedObjectIds.includes(id));
    set({ selectedObjectIds: newIds, selectedObjectId: newIds[newIds.length - 1] || null });
  },
  deleteSelected: () => {
    const { project, selectedObjectIds, selectedLightId, selectedCameraId } = get();
    
    let updatedProject = { ...project };
    let changed = false;

    const safeIds = selectedObjectIds || [];
    if (safeIds.length > 0) {
      updatedProject.objects = project.objects.filter(o => !safeIds.includes(o.id));
      changed = true;
    }

    if (selectedLightId) {
      updatedProject.lights = project.lights.filter(l => l.id !== selectedLightId);
      changed = true;
    }

    if (selectedCameraId) {
      updatedProject.cameras = (project.cameras || []).filter(c => c.id !== selectedCameraId);
      changed = true;
    }

    if (changed) {
      set({ 
        project: updatedProject,
        selectedObjectIds: [],
        selectedObjectId: null,
        selectedLightId: null,
        selectedCameraId: null
      });
      get().saveHistory();
    }
  },
  duplicateSelected: () => {
    const { project, selectedObjectIds } = get();
    if (selectedObjectIds.length === 0) return;
    const newObjs: CSGObject[] = [];
    const newIds: string[] = [];
    selectedObjectIds.forEach(id => {
      const obj = project.objects.find(o => o.id === id);
      if (obj) {
        const newId = genId();
        newObjs.push({ ...JSON.parse(JSON.stringify(obj)), id: newId, name: `${obj.name} (Copia)` });
        newIds.push(newId);
      }
    });
    set({ 
      project: { ...project, objects: [...project.objects, ...newObjs] },
      selectedObjectIds: newIds,
      selectedObjectId: newIds[newIds.length - 1]
    });
    get().saveHistory('Duplicar Selección', 'create');
  },
  mirrorSelected: (axis) => {
    const { project, selectedObjectIds } = get();
    if (selectedObjectIds.length === 0) return;
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    set({
      project: {
        ...project,
        objects: project.objects.map(o => {
          if (!selectedObjectIds.includes(o.id)) return o;
          const newScale = [...o.transform.scale] as V3;
          newScale[axisIdx] *= -1;
          return { ...o, transform: { ...o.transform, scale: newScale } };
        })
      }
    });
    get().saveHistory('Espejar Objeto', 'transform');
  },

  smoothObject: async (id, factor, iterations = 1) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    
    if (obj.meshData && obj.meshData.type === 'gltf') {
      const { smoothGLB } = await import('../utils/glb_processor');
      const smoothedObj = await smoothGLB(obj, factor, iterations);
      if (smoothedObj === obj) {
        console.warn('Smoothing did not produce a new object.');
        return;
      }
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? smoothedObj : o)}});
      get().saveHistory('Suavizado Laplaciano', 'edit');
      return;
    }

    if (obj.meshData) obj = await convertImportedToCSG(obj);
    const result = smoothMesh(obj, factor, iterations);
    set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {} } : o)}});
    get().saveHistory('Suavizado Laplaciano', 'edit');
  },

  roundAnglesObject: async (id, radius = 0.08, segments = 3, angleThresholdDeg = 35) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.meshData) obj = await convertImportedToCSG(obj);
    const result = roundAnglesMesh(obj, radius, segments, angleThresholdDeg);
    set({
      project: {
        ...get().project,
        objects: get().project.objects.map(o =>
          o.id === id
            ? {
                ...o,
                type: 'MESH',
                parameters: {},
                meshData: undefined,
                vertices: result.vertices,
                faces: result.faces,
                vertexOffsets: {},
                smoothShading: true,
                stats: { vertices: result.vertices.length, faces: result.faces.length }
              }
            : o
        )
      }
    });
    get().saveHistory('Biselar / Redondear Ángulos', 'edit');
  },

  subdivideObject: async (id) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.meshData && obj.meshData.type === 'gltf') {
      const { subdivideGLB } = await import('../utils/glb_processor');
      const subdividedObj = await subdivideGLB(obj);
      if (subdividedObj === obj) {
        console.warn('Subdivision did not produce a new object.');
        return;
      }
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? subdividedObj : o)}});
      get().saveHistory('Subdividir Malla', 'edit');
      return;
    }

    if (obj.meshData) obj = await convertImportedToCSG(obj);
    const result = subdivideMesh(obj);
    set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, type: 'MESH', parameters: {}, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {} } : o)}});
    get().saveHistory('Subdividir Malla', 'edit');
  },

  applyNoiseObject: async (id, config) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Deformador de Malla por Ruido',
        subtitle: `Aplicando ruido 3D ${config.noiseType}...`,
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 30));

    try {
      if (obj.meshData) {
        obj = await convertImportedToCSG(obj);
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }

      const result = applyNoiseToMesh(
        { vertices: obj.vertices!, faces: obj.faces || [] },
        config
      );

      const finalVerts = result.vertices.length;
      const finalFaces = result.faces.length;

      set({
        project: {
          ...get().project,
          objects: get().project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  type: 'MESH',
                  parameters: {},
                  meshData: undefined,
                  vertices: result.vertices,
                  faces: result.faces,
                  vertexOffsets: {},
                  smoothShading: true,
                  stats: { vertices: finalVerts, faces: finalFaces },
                }
              : o
          ),
        },
      });
      get().saveHistory();

      set(s => ({
        meshProcessing: s.meshProcessing
          ? {
              ...s.meshProcessing,
              progress: 100,
              subtitle: '¡Geometría deformada y roto el aspecto sintético!',
              completed: true,
              finalVertCount: finalVerts,
              finalFaceCount: finalFaces,
            }
          : null,
      }));
    } catch (e) {
      console.error('Error aplicando deformación por ruido a la malla:', e);
      set({ meshProcessing: null });
    }
  },

  optimizeObject: async (id, ratio, selectedMeshes, options = { preserveCreases: true }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Optimización Poligonal',
        subtitle: 'Calculando colapso de aristas con protección UV...',
        progress: 15,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));
    
    try {
      let updatedObj = obj;
      if (obj.meshData) {
        if (obj.meshData.type === 'gltf') {
          const { optimizeGLBModel } = await import('../utils/glb_processor');
          const resLevel = Math.max(1, Math.min(12, Math.round(ratio * 12)));
          updatedObj = await optimizeGLBModel(
            obj,
            resLevel,
            (prog, step) => {
              set(s => ({
                meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
              }));
            },
            selectedMeshes,
            { preserveCreases: options.preserveCreases ?? true, ratio }
          );
        } else {
          updatedObj = await convertImportedToCSG(obj);
          const result = await simplifyMesh(updatedObj, ratio);
          if (result && result.vertices && result.vertices.length > 0 && result.faces && result.faces.length > 0) {
            updatedObj = { ...updatedObj, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {}, stats: { vertices: result.vertices.length, faces: result.faces.length } };
          }
        }
      } else {
        const result = await simplifyMesh(obj, ratio);
        if (result && result.vertices && result.vertices.length > 0 && result.faces && result.faces.length > 0) {
          updatedObj = { ...obj, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {}, stats: { vertices: result.vertices.length, faces: result.faces.length } };
        }
      }

      set({
        isolateGLTFSelection: false,
        project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}
      });
      get().saveHistory();

      const finalVerts = updatedObj.stats?.vertices ?? updatedObj.vertices?.length ?? initialVerts;
      const finalFaces = updatedObj.stats?.faces ?? updatedObj.faces?.length ?? initialFaces;
      const diffPct = initialFaces > 0 ? Math.round(((initialFaces - finalFaces) / initialFaces) * 100) : 0;

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Optimización completada con éxito! (${initialFaces.toLocaleString()} → ${finalFaces.toLocaleString()} caras ${diffPct > 0 ? `· -${diffPct}%` : '· Estructura verificada'})`,
          completed: true,
          finalVertCount: finalVerts,
          finalFaceCount: finalFaces,
        } : null
      }));
    } catch (error) {
      console.error('Error optimizando objeto:', error);
      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: 'La malla ya se encuentra en su nivel óptimo de reducción o con límites alcanzados',
          completed: true,
          finalVertCount: initialVerts,
          finalFaceCount: initialFaces,
        } : null
      }));
    }
  },

  regularizeObject: async (id, strength = 0.35, iterations = 3, featureAngleDeg = 40) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Regularización y Relajación Tangencial',
        subtitle: 'Equilibrando aristas y ángulos hacia triángulos equiláteros (0 caras extra)...',
        progress: 25,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      // 1. Si es un modelo GLTF/GLB importado, procesar directamente en el buffer sin perder texturas ni inflar caras
      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { regularizeGLBModel } = await import('../utils/glb_processor');
        const updatedObj = await regularizeGLBModel(
          obj,
          strength,
          iterations,
          featureAngleDeg,
          async (progress, subtitle) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress, subtitle } : null
            }));
          }
        );

        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory('Relajación Tangencial', 'retopo');

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Topología regularizada! (${updatedObj.stats?.faces?.toLocaleString()} caras · 0 polígonos extra · Texturas 100% intactas)`,
            completed: true,
            finalVertCount: updatedObj.stats?.vertices ?? 0,
            finalFaceCount: updatedObj.stats?.faces ?? 0,
          } : null
        }));
        return;
      }

      // 2. Si es un objeto paramétrico nativo, asegurar representación poligonal
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }

      let result: { vertices: V3[]; faces: MeshFace[] };

      let targetObj: CSGObject | undefined = undefined;
      const targetId = obj.parameters?.targetId || (get() as any).shrinkTargetId;
      if (targetId) {
        targetObj = get().project.objects.find(o => o.id === targetId);
      }
      if (!targetObj) {
        // Buscar otro modelo de referencia en el proyecto (ej. modelo GLTF importado o malla densa)
        targetObj = get().project.objects.find(o => o.id !== id && ((o.meshData && o.meshData.type === 'gltf') || (o.vertices && o.vertices.length > 500)));
      }

      if (targetObj) {
        // Disponemos de una malla destino: relajación tangencial con re-proyección BVH a superficie
        const { extractTargetGeometry, regularizeSurfaceOnBVH, getObjectWorldMatrix } = await import('../utils/shrinkwrap');
        const { MeshBVH } = await import('three-mesh-bvh');
        const targetGeo = await extractTargetGeometry(targetObj);
        if (targetGeo && targetGeo.attributes.position && targetGeo.attributes.position.count > 0) {
          const targetBvh = new MeshBVH(targetGeo);
          const tgtPosAttr = targetGeo.attributes.position;
          const tgtIndexAttr = targetGeo.index;
          const getTgtFaceNormal = (faceIndex: number) => {
            let i0 = faceIndex * 3, i1 = faceIndex * 3 + 1, i2 = faceIndex * 3 + 2;
            if (tgtIndexAttr) {
              i0 = tgtIndexAttr.getX(faceIndex * 3);
              i1 = tgtIndexAttr.getX(faceIndex * 3 + 1);
              i2 = tgtIndexAttr.getX(faceIndex * 3 + 2);
            }
            const p0 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
            const p1 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
            const p2 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);
            const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(p1, p0), new THREE.Vector3().subVectors(p2, p0)).normalize();
            return fn.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : fn;
          };

          const srcWorldMat = getObjectWorldMatrix(obj);
          const srcWorldInv = srcWorldMat.clone().invert();
          const currentPositions = obj.vertices!.map(v => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(srcWorldMat));

          const regRes = regularizeSurfaceOnBVH(
            currentPositions,
            obj.faces || [],
            targetBvh,
            getTgtFaceNormal,
            { iterations, strength }
          );

          const finalVerts: V3[] = regRes.positions.map(p => {
            const loc = p.clone().applyMatrix4(srcWorldInv);
            return [loc.x, loc.y, loc.z] as V3;
          });

          targetGeo.dispose();
          result = { vertices: finalVerts, faces: obj.faces || [] };
        } else {
          const { regularizeMeshTopology } = await import('../utils/meshUtils');
          result = regularizeMeshTopology(obj, { strength, iterations, featureAngleDeg });
        }
      } else {
        const { regularizeMeshTopology } = await import('../utils/meshUtils');
        result = regularizeMeshTopology(obj, { strength, iterations, featureAngleDeg });
      }
      
      const updatedObj: CSGObject = {
        ...obj,
        type: 'MESH',
        parameters: {},
        meshData: undefined,
        vertices: result.vertices,
        faces: result.faces,
        vertexOffsets: {},
        smoothShading: true,
        stats: { vertices: result.vertices.length, faces: result.faces.length }
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory('Relajación Tangencial', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Topología regularizada! (${result.faces.length.toLocaleString()} caras · 0 caras extra)`,
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error regularizando malla:', e);
      set({ meshProcessing: null });
    }
  },

  isotropicRemeshObject: async (id, targetEdgeLength, iterations = 3) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Remallado Isótropo Uniforme',
        subtitle: 'Homogeneizando longitud de aristas (límite estricto de caras activo)...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      // 1. Si es un modelo GLTF/GLB importado, procesar en el buffer GLB preservando texturas y limitando caras
      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { isotropicRemeshGLBModel } = await import('../utils/glb_processor');
        const updatedObj = await isotropicRemeshGLBModel(
          obj,
          iterations,
          1.0, // Garantiza <= caras originales
          async (progress, subtitle) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress, subtitle } : null
            }));
          }
        );

        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory('Remallado Isótropo Uniforme', 'retopo');

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Remallado isótropo completado! (${updatedObj.stats?.faces?.toLocaleString()} caras · 0 polígonos extra · Texturas protegidas)`,
            completed: true,
            finalVertCount: updatedObj.stats?.vertices ?? 0,
            finalFaceCount: updatedObj.stats?.faces ?? 0,
          } : null
        }));
        return;
      }

      // 2. Si es objeto nativo, asegurar representación de vértices/caras
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }

      const { isotropicRemesh } = await import('../utils/meshUtils');
      // Presupuesto estricto: NUNCA sobrepasar las caras originales
      const result = isotropicRemesh(obj, targetEdgeLength, iterations, {
        maxFaces: initialFaces > 0 ? initialFaces : undefined,
        maintainFaceBudget: true
      });

      const updatedObj: CSGObject = {
        ...obj,
        type: 'MESH',
        parameters: {},
        meshData: undefined,
        vertices: result.vertices,
        faces: result.faces,
        vertexOffsets: {},
        smoothShading: true,
        stats: { vertices: result.vertices.length, faces: result.faces.length }
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory('Remallado Isótropo Uniforme', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Remallado regular completado! (${result.report.join(', ')})`,
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error en remallado isótropo:', e);
      set({ meshProcessing: null });
    }
  },

  applyShrinkwrapToObject: async (sourceId: string, targetId: string, config: import('../types').ShrinkwrapConfig) => {
    const { project } = get();
    let sourceObj = project.objects.find(o => o.id === sourceId);
    const targetObj = project.objects.find(o => o.id === targetId);
    if (!sourceObj || !targetObj) return;

    const initialVerts = sourceObj.vertices?.length ?? sourceObj.stats?.vertices ?? 0;
    const initialFaces = sourceObj.faces?.length ?? sourceObj.stats?.faces ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Modificador Shrinkwrap (Envolver Malla)',
        subtitle: `Acoplando superficie a "${targetObj.name}"...`,
        progress: 30,
        objectName: sourceObj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (!sourceObj.vertices || sourceObj.vertices.length === 0) {
        if (sourceObj.meshData) {
          const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
          sourceObj = await convertImportedToCSG(sourceObj);
        } else {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(sourceObj);
          const res = fromThreeGeometry(geo);
          sourceObj = {
            ...sourceObj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }
      }

      const { applyShrinkwrap } = await import('../utils/shrinkwrap');
      const result = await applyShrinkwrap(sourceObj, targetObj, {
        ...config,
        selectedVertexIndices: get().selectedVertexIndices
      } as any);

      const updatedObj: CSGObject = {
        ...sourceObj,
        ...result.updatedObject,
        type: 'MESH',
        parameters: { ...(sourceObj.parameters || {}), ...(result.updatedObject.parameters || {}) },
        meshData: undefined,
        smoothShading: (result.updatedObject.smoothShading !== undefined)
          ? result.updatedObject.smoothShading
          : (targetObj.smoothShading ?? false),
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === sourceId ? updatedObj : o)}});
      get().saveHistory('Shrinkwrap (1 Pasada)', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Shrinkwrap aplicado! (${result.modifiedVerticesCount} vértices adaptados a "${targetObj.name}")`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error aplicando Shrinkwrap:', e);
      set({ meshProcessing: null });
    }
  },

  applySilhouetteVacuumWrapToObject: async (sourceId: string, targetId: string, config: import('../utils/shrinkwrap').SilhouetteVacuumWrapConfig = {}) => {
    const { project } = get();
    let sourceObj = project.objects.find(o => o.id === sourceId);
    const targetObj = project.objects.find(o => o.id === targetId);
    if (!sourceObj || !targetObj) return;

    const initialVerts = sourceObj.vertices?.length ?? sourceObj.stats?.vertices ?? 0;
    const initialFaces = sourceObj.faces?.length ?? sourceObj.stats?.faces ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Envoltura al Vacío (Ajuste a Silueta Completa)',
        subtitle: `Subdividiendo y adaptando a "${targetObj.name}"...`,
        progress: 25,
        objectName: sourceObj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (!sourceObj.vertices || sourceObj.vertices.length === 0) {
        if (sourceObj.meshData) {
          const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
          sourceObj = await convertImportedToCSG(sourceObj);
        } else {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(sourceObj);
          const res = fromThreeGeometry(geo);
          sourceObj = {
            ...sourceObj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }
      }

      const { applySilhouetteVacuumWrap } = await import('../utils/shrinkwrap');
      const result = await applySilhouetteVacuumWrap(sourceObj, targetObj, config);

      const updatedObj: CSGObject = {
        ...sourceObj,
        ...result.updatedObject,
        type: 'MESH',
        parameters: { ...(sourceObj.parameters || {}), ...(result.updatedObject.parameters || {}) },
        meshData: undefined,
        smoothShading: (result.updatedObject.smoothShading !== undefined)
          ? result.updatedObject.smoothShading
          : (targetObj.smoothShading ?? false),
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === sourceId ? updatedObj : o)}});
      get().saveHistory('Ceñir a Silueta (Vacuum Wrap)', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Silueta ajustada! (${result.modifiedVerticesCount} vértices adaptados, ${updatedObj.faces.length} caras)`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error aplicando Vacuum Wrap:', e);
      set({ meshProcessing: null });
    }
  },

  optimizeConformedMeshToObject: async (sourceId: string, targetId?: string, options: import('../utils/shrinkwrap').OptimizeConformedMeshOptions = {}) => {
    const { project } = get();
    let sourceObj = project.objects.find(o => o.id === sourceId);
    const targetObj = targetId ? project.objects.find(o => o.id === targetId) : undefined;
    if (!sourceObj) return;

    const initialVerts = sourceObj.vertices?.length ?? sourceObj.stats?.vertices ?? 0;
    const initialFaces = sourceObj.faces?.length ?? sourceObj.stats?.faces ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Optimización de Malla y Reducción de Polígonos',
        subtitle: `Analizando estructura y reduciendo polígonos de "${sourceObj.name}"...`,
        progress: 30,
        objectName: sourceObj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      let updatedObj: CSGObject;

      if (sourceObj.meshData && sourceObj.meshData.type === 'gltf') {
        const { optimizeGLBModel, dissolveCoplanarGLBModel } = await import('../utils/glb_processor');
        const ratio = options.targetReductionRatio ?? 0.35;
        const resLevel = Math.max(1, Math.min(12, Math.round(ratio * 12)));
        
        // Primero disolver paneles coplanares planos
        let tempObj = await dissolveCoplanarGLBModel(
          sourceObj,
          options.creaseAngleDeg ?? 3.5,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: Math.round(prog * 0.4), subtitle: step } : null
            }));
          }
        );

        // Luego optimizar reducción poligonal adaptativa
        updatedObj = await optimizeGLBModel(
          tempObj,
          resLevel,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: 40 + Math.round(prog * 0.6), subtitle: step } : null
            }));
          },
          undefined,
          { preserveCreases: options.preserveCreases ?? true, ratio }
        );
      } else {
        if (!sourceObj.vertices || sourceObj.vertices.length === 0) {
          if (sourceObj.meshData) {
            const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
            sourceObj = await convertImportedToCSG(sourceObj);
          } else {
            const { fromThreeGeometry } = await import('../utils/modifiers');
            const geo = createBaseGeometry(sourceObj);
            const res = fromThreeGeometry(geo);
            sourceObj = {
              ...sourceObj,
              vertices: res.vertices,
              faces: res.faces,
            };
          }
        }

        const { optimizeConformedMesh } = await import('../utils/shrinkwrap');
        const result = await optimizeConformedMesh(sourceObj, targetObj, options);

        updatedObj = {
          ...sourceObj,
          ...result.updatedObject,
          type: 'MESH',
          parameters: { ...(sourceObj.parameters || {}), ...(result.updatedObject.parameters || {}) },
          meshData: undefined,
          smoothShading: (result.updatedObject.smoothShading !== undefined)
            ? result.updatedObject.smoothShading
            : (targetObj?.smoothShading ?? sourceObj.smoothShading ?? false),
        };
      }

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === sourceId ? updatedObj : o)}});
      get().saveHistory('Optimizar Malla (Reducción Estructural)', 'retopo');

      const finalVerts = updatedObj.stats?.vertices ?? updatedObj.vertices?.length ?? initialVerts;
      const finalFaces = updatedObj.stats?.faces ?? updatedObj.faces?.length ?? initialFaces;
      const diffPct = initialFaces > 0 ? Math.round(((initialFaces - finalFaces) / initialFaces) * 100) : 0;

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Malla optimizada con éxito! (de ${initialFaces.toLocaleString()} a ${finalFaces.toLocaleString()} caras ${diffPct > 0 ? `· -${diffPct}%` : '· Topología verificada'})`,
          completed: true,
          finalVertCount: finalVerts,
          finalFaceCount: finalFaces,
        } : null
      }));
    } catch (e) {
      console.error('Error optimizando malla:', e);
      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: 'La malla ya se encuentra en su nivel óptimo o con aristas protegidas',
          completed: true,
          finalVertCount: initialVerts,
          finalFaceCount: initialFaces,
        } : null
      }));
    }
  },

  pruneAirBridgingFacesToObject: async (sourceId: string, targetId: string, options: import('../utils/shrinkwrap').PruneAirFacesOptions = {}) => {
    const { project } = get();
    let sourceObj = project.objects.find(o => o.id === sourceId);
    const targetObj = project.objects.find(o => o.id === targetId);
    if (!sourceObj || !targetObj) return;

    set({
      meshProcessing: {
        active: true,
        title: 'Poda de Membranas en el Aire',
        subtitle: `Eliminando caras que flotan en el vacío respecto a "${targetObj.name}"...`,
        progress: 35,
        objectName: sourceObj.name,
        vertCount: sourceObj.vertices?.length ?? 0,
        faceCount: sourceObj.faces?.length ?? 0,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      const { pruneAirBridgingFaces } = await import('../utils/shrinkwrap');
      const res = await pruneAirBridgingFaces(sourceObj, targetObj, options);

      const updatedObj: CSGObject = {
        ...sourceObj,
        ...res.updatedObject,
        type: 'MESH',
        meshData: undefined,
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === sourceId ? updatedObj : o)}});
      get().saveHistory('Podar Telas Flotantes (Anti-Huecos)', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Poda completada! (${res.prunedFacesCount} caras flotantes eliminadas, ${updatedObj.faces.length} caras finales)`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error podando membranas en el aire:', e);
      set({ meshProcessing: null });
    }
  },

  cleanSpikesObject: async (sourceId: string, targetId?: string) => {
    const { project } = get();
    let sourceObj = project.objects.find(o => o.id === sourceId);
    if (!sourceObj) return;
    const targetObj = targetId ? project.objects.find(o => o.id === targetId) : undefined;

    set({
      meshProcessing: {
        active: true,
        title: 'Limpieza de Espinas y Rebabas',
        subtitle: `Eliminando espinas, caras filosas y triángulos invertidos...`,
        progress: 40,
        objectName: sourceObj.name,
        vertCount: sourceObj.vertices?.length ?? 0,
        faceCount: sourceObj.faces?.length ?? 0,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      const { cleanMeshSpikes } = await import('../utils/shrinkwrap');
      const res = await cleanMeshSpikes(sourceObj, targetObj);

      const updatedObj: CSGObject = {
        ...sourceObj,
        ...res.updatedObject,
        type: 'MESH',
        meshData: undefined,
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === sourceId ? updatedObj : o)}});
      get().saveHistory('Limpiar Espinas y Rebabas', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Limpieza completada! (${res.removedCount} espinas eliminadas, ${updatedObj.faces.length} caras finales)`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error limpiando espinas:', e);
      set({ meshProcessing: null });
    }
  },

  solidifyObject: async (id: string, thickness = 0.05, offset = 0.0) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.vertices?.length ?? obj.stats?.vertices ?? 0;
    const initialFaces = obj.faces?.length ?? obj.stats?.faces ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Modificador Solidify (Solidificar)',
        subtitle: `Generando grosor físico de ${thickness} y cosiendo bordes...`,
        progress: 35,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }

      const { solidifyMesh } = await import('../utils/shrinkwrap');
      const updatedObj = solidifyMesh(obj, thickness, offset);

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory('Modificador Solidificar', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Malla solidificada con éxito! (${updatedObj.faces.length} caras)`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error aplicando Solidify:', e);
      set({ meshProcessing: null });
    }
  },

  applyVoxelRemeshToObject: async (id: string, options: import('../utils/voxelRemesher').VoxelRemeshOptions = {}) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.vertices?.length ?? obj.stats?.vertices ?? 0;
    const initialFaces = obj.faces?.length ?? obj.stats?.faces ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Remallado Voxel (SDF + Marching Cubes)',
        subtitle: `Voxelizando "${obj.name}" y garantizando topología estanca...`,
        progress: 20,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (!obj.vertices || obj.vertices.length === 0) {
        if (obj.meshData) {
          const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
          obj = await convertImportedToCSG(obj);
        } else {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = {
            ...obj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }
      }

      const { voxelRemesh } = await import('../utils/voxelRemesher');
      const result = await voxelRemesh(obj, options);

      const updatedObj: CSGObject = {
        ...obj,
        ...result.updatedObject,
        type: 'MESH',
        parameters: { ...(obj.parameters || {}), ...(result.updatedObject.parameters || {}) },
        meshData: undefined,
        smoothShading: obj.smoothShading ?? true,
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory('Remallado Voxel (SDF + BVH)', 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Remallado Voxel completado! (${result.stats.finalFaces} caras, ${result.stats.quads} quads, ${result.stats.triangles} tris)`,
          completed: true,
          finalVertCount: updatedObj.vertices.length,
          finalFaceCount: updatedObj.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error aplicando Remallado Voxel:', e);
      set({ meshProcessing: null });
    }
  },

  dissolveCoplanarObject: async (id, angleToleranceDeg = 5.0, options?: { selectedMeshes?: string[]; protectUVSeams?: boolean; snapToPlane?: boolean; collinearAngleDeg?: number }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Disolución de Caras Coplanares',
        subtitle: 'Fusionando triángulos y simplificando superficies planas...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      let updatedObj = obj;

      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { dissolveCoplanarGLBModel } = await import('../utils/glb_processor');
        updatedObj = await dissolveCoplanarGLBModel(
          obj,
          angleToleranceDeg,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          },
          options?.selectedMeshes,
          options
        );
      } else {
        if (obj.meshData) obj = await convertImportedToCSG(obj);
        if (!obj.vertices || obj.vertices.length === 0) {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = {
            ...obj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }
        const { dissolveCoplanarFaces } = await import('../utils/meshUtils');
        const result = dissolveCoplanarFaces(obj, angleToleranceDeg);

        let finalFaces = result.faces;

        updatedObj = {
          ...obj,
          type: 'MESH',
          parameters: {},
          meshData: undefined,
          vertices: result.vertices,
          faces: finalFaces,
          vertexOffsets: {},
          smoothShading: true,
          stats: { vertices: result.vertices.length, faces: finalFaces.length }
        };

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Fusión coplanar completada! (${result.report.join(' · ')})`,
            completed: true,
            finalVertCount: result.vertices.length,
            finalFaceCount: result.faces.length,
          } : null
        }));
      }

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory('Disolver Caras Coplanares', 'edit');

      if (obj.meshData && obj.meshData.type === 'gltf') {
        const finalVerts = updatedObj.stats?.vertices ?? initialVerts;
        const finalFaces = updatedObj.stats?.faces ?? initialFaces;
        const vDiff = initialFaces > 0 ? Math.round(((initialFaces - finalFaces) / initialFaces) * 100) : 0;
        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Superficies planas optimizadas! (${initialFaces.toLocaleString()} → ${finalFaces.toLocaleString()} caras ${vDiff > 0 ? `· -${vDiff}%` : '· Estructura coplanar verificada'})`,
            completed: true,
            finalVertCount: finalVerts,
            finalFaceCount: finalFaces,
          } : null
        }));
      }
    } catch (e) {
      console.error('Error disolviendo caras coplanares:', e);
      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: 'No se encontraron más planos reducibles dentro de la tolerancia indicada',
          completed: true,
          finalVertCount: initialVerts,
          finalFaceCount: initialFaces,
        } : null
      }));
    }
  },

  applyLowPolyBlueprint: async (id: string, options?: { creaseAngleDeg?: number; targetFaceRatio?: number; silhouetteOnly?: boolean; forceNativeConversion?: boolean }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado' };

    const isSilhouette = options?.silhouetteOnly ?? false;
    const creaseAngle = isSilhouette 
      ? Math.max(35.0, options?.creaseAngleDeg ?? 35.0) 
      : (options?.creaseAngleDeg ?? 25.0);
    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? (obj.meshData as any)?.verticesCount ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? (obj.meshData as any)?.facesCount ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: isSilhouette ? 'Silueta Limpia (Líneas Maestras)' : 'Estilo Blueprint (Aristas Técnicas)',
        subtitle: 'Eliminando líneas cruzadas y diagonales de polígonos...',
        progress: 35,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      let updatedObj: CSGObject;

      // Si el objeto es importado (FBX/GLTF/OBJ con meshData) y NO se solicitó reducción explícita (targetFaceRatio)
      // PRESERVAR la geometría original y meshData intacta sin destruirla ni desfigurarla
      if (obj.meshData && options?.targetFaceRatio === undefined && !options?.forceNativeConversion) {
        updatedObj = {
          ...obj,
          blueprintStyle: true,
          silhouetteOnly: isSilhouette,
          creaseAngle,
          showWireframe: true,
          smoothShading: false,
          color: '#091b33',
          originalColor: (obj as any).originalColor || obj.color,
          stats: obj.stats || { vertices: initialVerts, faces: initialFaces },
        };
      } else {
        // Objeto nativo o usuario que solicitó reducción/conversión explícita
        if (obj.meshData && (options?.targetFaceRatio !== undefined || options?.forceNativeConversion)) {
          const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
          obj = await convertImportedToCSG(obj);
        }

        if (!obj.vertices || obj.vertices.length === 0) {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const { createBaseGeometry } = await import('../utils/csg');
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = { ...obj, vertices: res.vertices, faces: res.faces };
        }

        let currVerts = obj.vertices!;
        let currFaces = obj.faces!;

        // Solo decimar si el usuario lo pidió explícitamente con targetFaceRatio
        if (options?.targetFaceRatio !== undefined && currFaces.length > 50) {
          set(s => ({
            meshProcessing: s.meshProcessing ? {
              ...s.meshProcessing,
              progress: 55,
              subtitle: `Optimizando caras (${Math.round(options.targetFaceRatio! * 100)}%)...`
            } : null
          }));
          const { optimizeMesh } = await import('../utils/modifiers');
          const decimated = optimizeMesh({ ...obj, vertices: currVerts, faces: currFaces }, options.targetFaceRatio);
          if (decimated.faces && decimated.faces.length > 0) {
            currVerts = decimated.vertices;
            currFaces = decimated.faces;
          }
        }

        // Convertir pares de triángulos adyacentes a Quads (Tris to Quads) para disolver diagonales internas
        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 75,
            subtitle: 'Disolviendo diagonales internas y unificando cuadriláteros...'
          } : null
        }));
        const { convertTrisToQuads, dissolveCoplanarFaces } = await import('../utils/meshUtils');
        const quadRes = convertTrisToQuads({ vertices: currVerts, faces: currFaces }, creaseAngle);
        currFaces = quadRes.faces;

        // Disolver caras coplanares adicionales en paneles limpios
        const dissolveRes = dissolveCoplanarFaces(
          { vertices: currVerts, faces: currFaces },
          creaseAngle,
          { collinearToleranceDeg: isSilhouette ? 6.0 : 4.0 }
        );
        currVerts = dissolveRes.vertices;
        currFaces = dissolveRes.faces;

        // Extraer aristas técnicas sin líneas cruzadas
        const { extractFeatureEdges } = await import('../utils/wireframeMesh');
        const featureEdges = extractFeatureEdges({
          vertices: currVerts,
          faces: currFaces,
          silhouetteOnly: isSilhouette,
        }, creaseAngle);

        updatedObj = {
          ...obj,
          type: 'MESH',
          parameters: {},
          vertices: currVerts,
          faces: currFaces,
          meshData: undefined,
          wireframeEdges: featureEdges,
          blueprintStyle: true,
          silhouetteOnly: isSilhouette,
          creaseAngle,
          showWireframe: true,
          smoothShading: false,
          color: '#091b33',
          originalColor: (obj as any).originalColor || ((obj.color && obj.color !== '#08182b') ? obj.color : '#e2e8f0'),
          stats: { vertices: currVerts.length, faces: currFaces.length }
        };
      }

      set({
        viewMode: 'BLUEPRINT',
        project: {
          ...get().project,
          objects: get().project.objects.map(o => o.id === id ? updatedObj : o)
        }
      });

      get().saveHistory('Estilo Blueprint', 'edit');

      const finalVerts = updatedObj.stats?.vertices ?? updatedObj.vertices?.length ?? initialVerts;
      const finalFaces = updatedObj.stats?.faces ?? updatedObj.faces?.length ?? initialFaces;

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Estilo Blueprint aplicado! (${finalFaces.toLocaleString()} caras · aristas técnicas sin líneas cruzadas)`,
          completed: true,
          finalVertCount: finalVerts,
          finalFaceCount: finalFaces,
        } : null
      }));

      setTimeout(() => {
        set({ meshProcessing: null });
      }, 1200);

      return {
        success: true,
        message: `Estilo Blueprint aplicado: aristas técnicas limpias sin líneas cruzadas (${finalFaces.toLocaleString()} caras).`
      };
    } catch (err: any) {
      console.error('Error aplicando estilo blueprint:', err);
      set({ meshProcessing: null });
      return { success: false, message: `Error al aplicar Estilo Blueprint: ${err.message || 'Error desconocido'}` };
    }
  },

  removeBlueprintStyle: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    const updatedObj: CSGObject = {
      ...obj,
      blueprintStyle: false,
      showWireframe: false,
      color: (obj as any).originalColor || (obj.color === '#08182b' ? '#ffffff' : obj.color),
    };
    set({
      viewMode: 'SOLID',
      project: {
        ...project,
        objects: project.objects.map(o => o.id === id ? updatedObj : o)
      }
    });
    get().saveHistory('Restaurar Estilo Normal', 'edit');
  },

  retopologizeObject: async (id, options = {}) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    const targetDesc = options.targetCount
      ? `${options.targetCount.toLocaleString()} polígonos`
      : options.targetRatio
      ? `${Math.round(options.targetRatio * 100)}%`
      : 'Auto';

    set({
      meshProcessing: {
        active: true,
        title: 'Remeser: Auto-Retopología',
        subtitle: `Inicializando análisis espacial y BVH (Objetivo: ${targetDesc})...`,
        progress: 15,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      let updatedObj = obj;

      if (obj.meshData && obj.meshData.type === 'gltf' && !options.convertToNative) {
        const { retopologizeGLBModel } = await import('../utils/retopology');
        updatedObj = await retopologizeGLBModel(
          obj,
          options,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          },
          options.selectedMeshes
        );
      } else {
        if (obj.meshData) {
          const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
          obj = await convertImportedToCSG(obj);
        }
        if (!obj.vertices || obj.vertices.length === 0) {
          const { createBaseGeometry } = await import('../utils/csg');
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = {
            ...obj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }

        const { retopologizeMesh } = await import('../utils/retopology');
        const result = await retopologizeMesh(obj, {
          ...options,
          onProgress: (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          }
        });

        updatedObj = {
          ...obj,
          type: 'MESH',
          parameters: {
            ...(obj.parameters || {}),
            creaseAngleDeg: options.creaseAngleDeg || 35
          },
          meshData: undefined,
          vertices: result.vertices,
          faces: result.faces,
          vertexOffsets: {},
          smoothShading: true,
          stats: {
            vertices: result.stats.vertices,
            faces: result.stats.finalFaces,
            quads: result.stats.quads,
            triangles: result.stats.triangles,
          }
        };

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Remeser completado! ${result.report.join(' · ')}`,
            completed: true,
            finalVertCount: result.stats.vertices,
            finalFaceCount: result.stats.finalFaces,
          } : null
        }));
      }

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      const modeStr = options.mode === 'PURE_QUADS' ? '100% Quads' : (options.mode === 'QUAD_DOMINANT' ? 'Quads Dominante' : (options.mode === 'ISOTROPIC_TRI' ? 'Isótropo' : 'Retopología'));
      const polyCount = (updatedObj.stats?.faces || options.targetCount || (options as any).targetFaces || 5000).toLocaleString();
      get().saveHistory(`Remeser: ${modeStr} (~${polyCount}p)`, 'retopo');

      if (obj.meshData && obj.meshData.type === 'gltf' && !options.convertToNative) {
        const finalVerts = updatedObj.stats?.vertices ?? 0;
        const finalFaces = updatedObj.stats?.faces ?? 0;
        const quadsCount = updatedObj.stats?.quads ?? 0;
        const reduction = initialFaces > 0 ? Math.round(((initialFaces - finalFaces) / initialFaces) * 100) : 0;
        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Remeser completado! ${finalFaces.toLocaleString()} caras (${reduction > 0 ? `-${reduction}%` : ''} · ${quadsCount.toLocaleString()} quads generados) · Texturas y UVs preservadas`,
            completed: true,
            finalVertCount: finalVerts,
            finalFaceCount: finalFaces,
          } : null
        }));
      }
    } catch (e) {
      console.error('Error en Remeser:', e);
      set({ meshProcessing: null });
    }
  },

  convertMeshToQuadsObject: async (id, options = {}) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.meshData) {
      const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
      obj = await convertImportedToCSG(obj);
    }
    if (!obj.vertices || obj.vertices.length === 0) {
      const { createBaseGeometry } = await import('../utils/csg');
      const { fromThreeGeometry } = await import('../utils/modifiers');
      const geo = createBaseGeometry(obj);
      const res = fromThreeGeometry(geo);
      obj = {
        ...obj,
        vertices: res.vertices,
        faces: res.faces,
      };
    }

    const { convertMeshToQuads } = await import('../utils/retopology');
    const res = convertMeshToQuads(obj, options);
    const updatedObj = {
      ...res.updatedObject,
      type: 'MESH' as const,
      parameters: {},
      meshData: undefined,
      vertexOffsets: {},
      smoothShading: true,
      stats: {
        ...(obj.stats || {}),
        vertices: res.updatedObject.vertices.length,
        faces: res.updatedObject.faces.length,
        quads: res.quadsCount,
        triangles: res.trianglesCount,
      }
    };

    set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
    get().saveHistory(`Convertir a Quads (${res.quadsCount} quads)`, 'retopo');
  },

  repairHardSurfaceObject: async (id, options = {}) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Reparación Hard-Surface',
        subtitle: 'Aplanando alas, paneles solares y regenerando quads...',
        progress: 25,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { repairGLBNormalsAndOverlaps } = await import('../utils/glb_processor');
        const res = await repairGLBNormalsAndOverlaps(
          obj,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          },
          { creaseAngleDeg: options.creaseAngleDeg ?? 35, snapPlanar: true }
        );
        const updatedObj = res.object;
        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory(`Reparar Hard-Surface: ${res.repairedFaces} elementos`);
        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Paneles aplanados y normales reparadas! (${res.report.join('; ')})`,
            completed: true,
            finalVertCount: updatedObj.stats?.vertices || 0,
            finalFaceCount: updatedObj.stats?.faces || 0,
          } : null
        }));
        return;
      }

      if (obj.meshData) {
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }

      const { repairHardSurfacePolygons } = await import('../utils/retopology');
      const res = repairHardSurfacePolygons(obj, options);
      const updatedObj = res.updatedObject;

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory(`Reparar Hard-Surface: ${res.quadsCount} Quads`, 'retopo');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Paneles aplanados y reparados! (${res.quadsCount} quads generados)`,
          completed: true,
          finalVertCount: updatedObj.stats?.vertices || updatedObj.vertices?.length || 0,
          finalFaceCount: updatedObj.stats?.faces || updatedObj.faces?.length || 0,
        } : null
      }));
    } catch (e) {
      console.error('Error reparando hard-surface:', e);
      set({ meshProcessing: null });
    }
  },

  optimizeCurvedObject: async (id, ratio = 0.5, options = { preserveCreases: true, creaseAngleDeg: 40, smoothNormals: true }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Optimización de Figuras Curvas & Tubulares',
        subtitle: 'Decimando pasos redundantes y preservando redondez...',
        progress: 25,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      let updatedObj = obj;

      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { optimizeGLBModel } = await import('../utils/glb_processor');
        const resLevel = Math.max(1, Math.min(12, Math.round(ratio * 12)));
        updatedObj = await optimizeGLBModel(
          obj,
          resLevel,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          },
          options?.selectedMeshes,
          {
            preserveCreases: options.preserveCreases !== false,
            ratio,
            isCurved: true,
            creaseAngleDeg: options.creaseAngleDeg ?? 40,
            smoothNormals: options.smoothNormals !== false
          }
        );
      } else {
        if (obj.meshData) obj = await convertImportedToCSG(obj);
        if (!obj.vertices || obj.vertices.length === 0) {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = {
            ...obj,
            vertices: res.vertices,
            faces: res.faces,
          };
        }
        const { optimizeCurvedMesh } = await import('../utils/modifiers_advanced');
        const result = await optimizeCurvedMesh(obj, ratio, options);

        if (!result.vertices || result.vertices.length === 0 || !result.faces || result.faces.length === 0) {
          console.warn('La optimización de curvas devolvió una malla vacía, conservando original.');
          set(s => ({
            meshProcessing: s.meshProcessing ? {
              ...s.meshProcessing,
              progress: 100,
              subtitle: 'Malla protegida (sin cambios)',
              completed: true,
              finalVertCount: initialVerts,
              finalFaceCount: initialFaces,
            } : null
          }));
          return;
        }

        updatedObj = {
          ...obj,
          type: 'MESH',
          parameters: {},
          meshData: undefined,
          vertices: result.vertices,
          faces: result.faces,
          vertexOffsets: {},
          smoothShading: true,
          stats: { vertices: result.vertices.length, faces: result.faces.length }
        };
      }

      const finalVerts = updatedObj.stats?.vertices ?? updatedObj.vertices?.length ?? 0;
      const finalFaces = updatedObj.stats?.faces ?? updatedObj.faces?.length ?? 0;

      set({
        isolateGLTFSelection: false,
        project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}
      });
      get().saveHistory();

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Optimización de curvas completada con éxito!`,
          completed: true,
          finalVertCount: finalVerts,
          finalFaceCount: finalFaces,
        } : null
      }));
    } catch (e) {
      console.error('Error optimizando figuras curvas:', e);
      set({ meshProcessing: null });
    }
  },

  cleanIslandsObject: async (id, minRatio = 0.05) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Limpieza de Ruido e Islas 3D',
        subtitle: 'Eliminando esquirlas flotantes sin alterar partes clave ni orientación...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      // 1. Para modelos GLB importados: procesar con cleanGLBIslands preservando GLTF nativo, esqueletos y orientación
      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { cleanGLBIslands } = await import('../utils/glb_processor');
        const res = await cleanGLBIslands(
          obj,
          { minFaceRatio: minRatio, minAbsoluteFaces: 6 },
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          }
        );
        const updatedObj = res.object;
        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory();

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Limpieza de islas 3D finalizada! (${res.report.join(', ')})`,
            completed: true,
            finalVertCount: updatedObj.stats?.vertices ?? 0,
            finalFaceCount: updatedObj.stats?.faces ?? 0,
          } : null
        }));
        return;
      }

      // 2. Para mallas nativas CSG:
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = {
          ...obj,
          vertices: res.vertices,
          faces: res.faces,
        };
      }
      const { removeDisconnectedIslands } = await import('../utils/meshUtils');
      const result = removeDisconnectedIslands(obj, minRatio);

      const updatedObj: CSGObject = {
        ...obj,
        type: 'MESH',
        parameters: {},
        meshData: undefined,
        vertices: result.vertices,
        faces: result.faces,
        vertexOffsets: {},
        smoothShading: true,
        stats: { vertices: result.vertices.length, faces: result.faces.length }
      };

      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
      get().saveHistory();

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Limpieza de islas 3D finalizada! (${result.report.join(', ')})`,
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Error limpiando islas 3D:', e);
      set({ meshProcessing: null });
    }
  },

  repairNormalsObject: async (id: string, options?: { creaseAngleDeg?: number; snapPlanar?: boolean; flipAll?: boolean }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    set({
      meshProcessing: {
        active: true,
        title: options?.flipAll ? 'Voltear Normales y Caras' : 'Reparación de Normales & Caras',
        subtitle: options?.flipAll ? 'Invirtiendo orientación de caras...' : 'Detectando caras superpuestas, invertidas y recalculando aristas vivas...',
        progress: 20,
        objectName: obj.name,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData && obj.meshData.type === 'gltf') {
        const { repairGLBNormalsAndOverlaps } = await import('../utils/glb_processor');
        const res = await repairGLBNormalsAndOverlaps(
          obj,
          (prog, step) => {
            set(s => ({
              meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: prog, subtitle: step } : null
            }));
          },
          options
        );
        const updatedObj = res.object;
        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory();

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Reparación completada! ${res.report.join('; ')}`,
            completed: true,
            finalVertCount: updatedObj.stats?.vertices ?? 0,
            finalFaceCount: updatedObj.stats?.faces ?? 0,
          } : null
        }));
      } else {
        const { repairMesh } = await import('../utils/meshUtils');
        const res = repairMesh(obj, 0.0001);
        let finalFaces = res.faces;
        if (options?.flipAll) {
          finalFaces = finalFaces.map(f => ({
            ...f,
            indices: [f.indices[0], f.indices[2], f.indices[1]] as [number, number, number]
          }));
        }
        const updatedObj: CSGObject = {
          ...obj,
          vertices: res.vertices,
          faces: finalFaces,
          vertexOffsets: {},
          stats: { vertices: res.vertices.length, faces: finalFaces.length }
        };
        set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? updatedObj : o)}});
        get().saveHistory();

        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            progress: 100,
            subtitle: `¡Caras y normales reparadas! (${res.report.join(', ')})`,
            completed: true,
          } : null
        }));
      }
    } catch (e) {
      console.error('Error reparando normales:', e);
      set({ meshProcessing: null });
    }
  },

  flipObjectNormals: async (id: string) => {
    return get().repairNormalsObject(id, { flipAll: true });
  },

  offsetObject: async (id, distance) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    
    if (obj.meshData && obj.meshData.type === 'gltf') {
      const { processGLBMeshes } = await import('../utils/glb_processor');
      const { offsetMesh } = await import('../utils/modifiers_advanced');
      const newObj = await processGLBMeshes(obj, (v, f) => offsetMesh({ vertices: v, faces: f } as any, distance));
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? newObj : o)}});
      get().saveHistory();
      return;
    }

    if (obj.meshData) obj = await convertImportedToCSG(obj);
    const { offsetMesh } = await import('../utils/modifiers_advanced');
    const result = offsetMesh(obj, distance);
    set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {} } : o)}});
    get().saveHistory();
  },

  repairObject: async (id, tolerance = 0.001) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Soldado y Reparación de Malla',
        subtitle: `Fusionando vértices a distancia <= ${tolerance}...`,
        progress: 20,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) obj = await convertImportedToCSG(obj);
      const result = repairMesh(obj, tolerance);
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {}, stats: { vertices: result.vertices.length, faces: result.faces.length } } : o)}});
      get().saveHistory();

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Soldado de vértices completado! (${result.report.join(', ')})`,
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error("Error en reparación/soldado:", e);
      set({ meshProcessing: null });
    }
  },

  weldObject: async (id, tolerance = 0.001) => {
    return get().repairObject(id, tolerance);
  },

  weldShapeVertices: (id: string, vertexIndices?: number[], tolerance: number = 0.15) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices || obj.vertices.length < 2) {
      return { success: false, message: 'La forma no tiene suficientes vértices.' };
    }

    const rawVerts: V3[] = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });

    const isBezier = obj.parameters.shapeType === 'bezier';
    let oldHandles = obj.bezierHandles ? [...obj.bezierHandles] : [];
    let isClosed = !!obj.parameters.closed;

    let newVerts: V3[] = [];
    let newHandles: BezierHandle[] = [];

    if (vertexIndices && vertexIndices.length >= 2) {
      const selSet = new Set(vertexIndices);
      const selVerts = vertexIndices.map(idx => rawVerts[idx]).filter(Boolean);
      const centroid: V3 = [
        selVerts.reduce((sum, v) => sum + v[0], 0) / selVerts.length,
        selVerts.reduce((sum, v) => sum + v[1], 0) / selVerts.length,
        selVerts.reduce((sum, v) => sum + v[2], 0) / selVerts.length,
      ];

      const includesStart = selSet.has(0);
      const includesEnd = selSet.has(rawVerts.length - 1);
      if (includesStart && includesEnd && !isClosed) {
        isClosed = true;
      }

      let mergedPlaced = false;
      let targetNewIdx = 0;
      for (let i = 0; i < rawVerts.length; i++) {
        if (selSet.has(i)) {
          if (!mergedPlaced) {
            targetNewIdx = newVerts.length;
            newVerts.push(centroid);
            newHandles.push(oldHandles[i] || { out: [0,0,0], in: [0,0,0], broken: false });
            mergedPlaced = true;
          }
        } else {
          newVerts.push(rawVerts[i]);
          newHandles.push(oldHandles[i] || { out: [0,0,0], in: [0,0,0], broken: false });
        }
      }

      if (isBezier) {
        newHandles = autoSmoothBezierHandles(newVerts, newHandles, isClosed);
      }

      get().updateObject(id, {
        vertices: newVerts,
        bezierHandles: isBezier && newHandles.length > 0 ? newHandles : undefined,
        vertexOffsets: {},
        parameters: { ...obj.parameters, closed: isClosed },
      });
      set({ selectedVertexIndices: [targetNewIdx] });
      get().saveHistory();
      return { success: true, message: `Se soldaron ${vertexIndices.length} vértices en uno solo.` };
    } else {
      let mergedCount = 0;
      const n = rawVerts.length;
      const dStartEnd = Math.hypot(
        rawVerts[0][0] - rawVerts[n - 1][0],
        rawVerts[0][1] - rawVerts[n - 1][1],
        rawVerts[0][2] - rawVerts[n - 1][2]
      );
      if (!isClosed && dStartEnd <= tolerance) {
        isClosed = true;
        const avgEnd: V3 = [
          (rawVerts[0][0] + rawVerts[n - 1][0]) / 2,
          (rawVerts[0][1] + rawVerts[n - 1][1]) / 2,
          (rawVerts[0][2] + rawVerts[n - 1][2]) / 2,
        ];
        rawVerts[0] = avgEnd;
        rawVerts.pop();
        if (oldHandles.length > 0) oldHandles.pop();
        mergedCount++;
      }

      const visited = new Set<number>();
      for (let i = 0; i < rawVerts.length; i++) {
        if (visited.has(i)) continue;
        const cluster = [i];
        for (let j = i + 1; j < rawVerts.length; j++) {
          if (visited.has(j)) continue;
          const d = Math.hypot(
            rawVerts[i][0] - rawVerts[j][0],
            rawVerts[i][1] - rawVerts[j][1],
            rawVerts[i][2] - rawVerts[j][2]
          );
          if (d <= tolerance) {
            cluster.push(j);
            visited.add(j);
          }
        }
        if (cluster.length > 1) {
          const cVerts = cluster.map(ci => rawVerts[ci]);
          const avg: V3 = [
            cVerts.reduce((sum, v) => sum + v[0], 0) / cVerts.length,
            cVerts.reduce((sum, v) => sum + v[1], 0) / cVerts.length,
            cVerts.reduce((sum, v) => sum + v[2], 0) / cVerts.length,
          ];
          newVerts.push(avg);
          newHandles.push(oldHandles[i] || { out: [0,0,0], in: [0,0,0], broken: false });
          mergedCount += cluster.length - 1;
        } else {
          newVerts.push(rawVerts[i]);
          newHandles.push(oldHandles[i] || { out: [0,0,0], in: [0,0,0], broken: false });
        }
      }

      if (isBezier) {
        newHandles = autoSmoothBezierHandles(newVerts, newHandles, isClosed);
      }

      get().updateObject(id, {
        vertices: newVerts,
        bezierHandles: isBezier && newHandles.length > 0 ? newHandles : undefined,
        vertexOffsets: {},
        parameters: { ...obj.parameters, closed: isClosed },
      });
      set({ selectedVertexIndices: [] });
      get().saveHistory();
      return { success: true, message: `Se soldaron ${mergedCount} vértices cercanos (tolerancia: ${tolerance.toFixed(2)}m). Forma ${isClosed ? 'cerrada' : 'abierta'}.` };
    }
  },

  weldSelectedVertices: async (id: string, vertexIndices?: number[], tolerance: number = 0.05) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    if (obj.type === 'SHAPE') {
      return get().weldShapeVertices(id, vertexIndices, tolerance);
    }

    if (!vertexIndices || vertexIndices.length < 2) {
      await get().weldObject(id, tolerance);
      return { success: true, message: `Vértices cercanos soldados con tolerancia ${tolerance.toFixed(3)}m.` };
    }

    const rawVerts: V3[] = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });

    const targetIdx = vertexIndices[0];
    const selVerts = vertexIndices.map(vi => rawVerts[vi]).filter(Boolean);
    const centroid: V3 = [
      selVerts.reduce((sum, v) => sum + v[0], 0) / selVerts.length,
      selVerts.reduce((sum, v) => sum + v[1], 0) / selVerts.length,
      selVerts.reduce((sum, v) => sum + v[2], 0) / selVerts.length,
    ];

    const remap = new Map<number, number>();
    vertexIndices.forEach(vi => remap.set(vi, targetIdx));

    rawVerts[targetIdx] = centroid;

    const newFaces: MeshFace[] = [];
    for (const f of obj.faces) {
      const remapped = f.indices.map(idx => remap.get(idx) ?? idx);
      const dedup: number[] = [];
      for (let i = 0; i < remapped.length; i++) {
        if (remapped[i] !== remapped[(i + 1) % remapped.length]) {
          dedup.push(remapped[i]);
        }
      }
      if (dedup.length >= 3) {
        newFaces.push({ ...f, indices: dedup });
      }
    }

    get().updateObject(id, {
      vertices: rawVerts,
      faces: newFaces,
      vertexOffsets: {},
    });
    set({ selectedVertexIndices: [targetIdx] });
    get().saveHistory();
    return { success: true, message: `Se soldaron ${vertexIndices.length} vértices en la malla.` };
  },

  subdivideShapeSegment: (id: string, vertexIndex1?: number, vertexIndex2?: number) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices || obj.vertices.length < 2) {
      return { success: false, message: 'La forma no tiene suficientes vértices.' };
    }

    const rawVerts: V3[] = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });

    const isBezier = obj.parameters.shapeType === 'bezier';
    const oldHandles = obj.bezierHandles ? [...obj.bezierHandles] : [];
    const isClosed = !!obj.parameters.closed;
    const n = rawVerts.length;

    let splitAfter = 0;
    const sel = (vertexIndex1 !== undefined ? [vertexIndex1, ...(vertexIndex2 !== undefined ? [vertexIndex2] : [])] : selectedVertexIndices);

    if (sel.length >= 2) {
      const minI = Math.min(sel[0], sel[1]);
      const maxI = Math.max(sel[0], sel[1]);
      if (maxI === minI + 1) {
        splitAfter = minI;
      } else if (isClosed && minI === 0 && maxI === n - 1) {
        splitAfter = n - 1;
      } else {
        splitAfter = minI;
      }
    } else if (sel.length === 1) {
      splitAfter = sel[0];
    } else {
      splitAfter = 0;
    }

    const nextIdx = (splitAfter + 1) % n;
    const v1 = rawVerts[splitAfter];
    const v2 = rawVerts[nextIdx];
    const midPoint: V3 = [
      (v1[0] + v2[0]) / 2,
      (v1[1] + v2[1]) / 2,
      (v1[2] + v2[2]) / 2,
    ];

    const newVerts = [...rawVerts];
    const newHandles = [...oldHandles];

    const insertIdx = splitAfter + 1;
    newVerts.splice(insertIdx, 0, midPoint);
    newHandles.splice(insertIdx, 0, { out: [0,0,0], in: [0,0,0], broken: false });

    let smoothedHandles = newHandles;
    if (isBezier) {
      smoothedHandles = autoSmoothBezierHandles(newVerts, newHandles, isClosed);
    }

    get().updateObject(id, {
      vertices: newVerts,
      bezierHandles: isBezier ? smoothedHandles : undefined,
      vertexOffsets: {},
    });
    set({ selectedVertexIndices: [insertIdx] });
    get().saveHistory();
    return { success: true, message: `Línea dividida en 2. Nuevo vértice en el centro (índice ${insertIdx}).` };
  },

  insertShapeVertexAtPoint: (id: string, point: V3, segmentIndex?: number) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) {
      return { success: false, message: 'Objeto no encontrado.' };
    }

    const rawVerts: V3[] = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
    });

    const isBezier = obj.parameters.shapeType === 'bezier';
    const oldHandles = obj.bezierHandles ? [...obj.bezierHandles] : [];
    const isClosed = !!obj.parameters.closed;
    const n = rawVerts.length;

    let targetInsertIdx = n;
    if (segmentIndex !== undefined && segmentIndex >= 0 && segmentIndex < n) {
      targetInsertIdx = segmentIndex + 1;
    } else if (n >= 2) {
      let bestDist = Infinity;
      let bestSeg = 0;
      const segCount = isClosed ? n : n - 1;
      for (let i = 0; i < segCount; i++) {
        const p1 = rawVerts[i];
        const p2 = rawVerts[(i + 1) % n];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const dz = p2[2] - p1[2];
        const lenSq = dx*dx + dy*dy + dz*dz;
        let t = 0.5;
        if (lenSq > 0.0001) {
          t = ((point[0] - p1[0])*dx + (point[1] - p1[1])*dy + (point[2] - p1[2])*dz) / lenSq;
          t = Math.max(0, Math.min(1, t));
        }
        const projX = p1[0] + t*dx;
        const projY = p1[1] + t*dy;
        const projZ = p1[2] + t*dz;
        const dist = Math.hypot(point[0] - projX, point[1] - projY, point[2] - projZ);
        if (dist < bestDist) {
          bestDist = dist;
          bestSeg = i;
        }
      }
      targetInsertIdx = bestSeg + 1;
    }

    const newVerts = [...rawVerts];
    const newHandles = [...oldHandles];
    newVerts.splice(targetInsertIdx, 0, point);
    newHandles.splice(targetInsertIdx, 0, { out: [0,0,0], in: [0,0,0], broken: false });

    let smoothedHandles = newHandles;
    if (isBezier) {
      smoothedHandles = autoSmoothBezierHandles(newVerts, newHandles, isClosed);
    }

    get().updateObject(id, {
      vertices: newVerts,
      bezierHandles: isBezier ? smoothedHandles : undefined,
      vertexOffsets: {},
    });
    set({ selectedVertexIndices: [targetInsertIdx] });
    get().saveHistory();
    return { success: true, message: `Vértice creado en la posición indicada (índice ${targetInsertIdx}).` };
  },

  connectVertices: (id: string, vertexIndices?: number[]) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto no encontrado.' };

    const sel = vertexIndices && vertexIndices.length >= 2 ? vertexIndices : selectedVertexIndices;
    if (sel.length < 2) return { success: false, message: 'Selecciona al menos 2 vértices para conectar.' };

    const v1 = sel[0];
    const v2 = sel[1];
    if (v1 === v2) return { success: false, message: 'Selecciona dos vértices distintos.' };

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    // Bake all existing vertices first so no previous deformations are lost
    newObj.vertices = newObj.vertices.map((v, i) => {
      const o = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    });
    newObj.vertexOffsets = {};

    // 1. Check if any existing face contains both v1 and v2
    let splitFaceCount = 0;
    const newFaces: MeshFace[] = [];

    newObj.faces.forEach((face) => {
      const idx1 = face.indices.indexOf(v1);
      const idx2 = face.indices.indexOf(v2);

      if (idx1 !== -1 && idx2 !== -1) {
        const len = face.indices.length;
        // Check if already an adjacent edge
        const isAdjacent = Math.abs(idx1 - idx2) === 1 || Math.abs(idx1 - idx2) === len - 1;
        if (isAdjacent) {
          newFaces.push(face);
          return;
        }

        // Split polygon into two sub-faces along chord v1-v2
        const first = Math.min(idx1, idx2);
        const second = Math.max(idx1, idx2);

        // Face A: from first to second
        const fA: number[] = [];
        for (let i = first; i <= second; i++) {
          fA.push(face.indices[i]);
        }

        // Face B: from second to end, then 0 to first
        const fB: number[] = [];
        for (let i = second; i < len; i++) {
          fB.push(face.indices[i]);
        }
        for (let i = 0; i <= first; i++) {
          fB.push(face.indices[i]);
        }

        if (fA.length >= 3) newFaces.push({ ...face, indices: fA });
        if (fB.length >= 3) newFaces.push({ ...face, indices: fB });
        splitFaceCount++;
      } else {
        newFaces.push(face);
      }
    });

    delete newObj.wireframeEdges;
    newObj.parameters = {};

    if (splitFaceCount > 0) {
      newObj.faces = newFaces;
      get().updateObject(id, newObj);
      get().saveHistory();
      return { success: true, message: `Línea añadida conectando vértices y dividiendo ${splitFaceCount} cara(s).` };
    }

    // If they don't share a face, connect as a new polygon/face or edge
    if (sel.length >= 3) {
      newFaces.push({ indices: [...sel] });
      newObj.faces = newFaces;
      get().updateObject(id, newObj);
      get().saveHistory();
      return { success: true, message: `Nueva cara poligonal creada uniendo los ${sel.length} vértices seleccionados.` };
    } else {
      // 2 vertices: create segment / line
      newFaces.push({ indices: [v1, v2] });
      newObj.faces = newFaces;
      get().updateObject(id, newObj);
      get().saveHistory();
      return { success: true, message: `Nueva línea/segmento añadido conectando los 2 vértices.` };
    }
  },

  createFaceFromVertices: (id: string, vertexIndices?: number[]) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto no encontrado.' };

    const sel = vertexIndices && vertexIndices.length >= 2 ? vertexIndices : selectedVertexIndices;
    if (sel.length < 2) return { success: false, message: 'Selecciona al menos 2 vértices.' };

    if (sel.length === 2) {
      return get().connectVertices(id, sel);
    }

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';
    newObj.vertices = newObj.vertices.map((v, i) => {
      const o = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    });
    newObj.vertexOffsets = {};
    delete newObj.wireframeEdges;
    newObj.parameters = {};

    newObj.faces.push({ indices: [...sel] });
    get().updateObject(id, newObj);
    get().saveHistory();
    return { success: true, message: `Cara creada con ${sel.length} vértices.` };
  },

  extrudeSelectedVertices: (id: string, vertexIndices?: number[], offset?: V3) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto no encontrado.' };

    const sel = vertexIndices && vertexIndices.length > 0 ? vertexIndices : selectedVertexIndices;
    if (sel.length === 0) return { success: false, message: 'Selecciona al menos un vértice para extruir.' };

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';
    const off: V3 = offset || [0, 0.4, 0];

    // Bake all existing vertices first so no previous deformations are lost
    newObj.vertices = newObj.vertices.map((v, i) => {
      const vo = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + vo[0], v[1] + vo[1], v[2] + vo[2]];
    });
    newObj.vertexOffsets = {};

    const newCreatedIndices: number[] = [];
    sel.forEach((vi) => {
      const v = newObj.vertices[vi];
      const newV: V3 = [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
      const newIdx = newObj.vertices.length;
      newObj.vertices.push(newV);
      newCreatedIndices.push(newIdx);

      // Connect with new segment
      newObj.faces.push({ indices: [vi, newIdx] });
    });

    if (sel.length >= 2) {
      for (let k = 0; k < sel.length - 1; k++) {
        newObj.faces.push({ indices: [sel[k], sel[k + 1], newCreatedIndices[k + 1], newCreatedIndices[k]] });
      }
    }

    newObj.vertexOffsets = {};
    delete newObj.wireframeEdges;
    newObj.parameters = {};
    get().updateObject(id, newObj);
    set({ selectedVertexIndices: newCreatedIndices });
    get().saveHistory();
    return { success: true, message: `${sel.length} vértice(s) extruido(s) con nuevos segmentos.` };
  },

  insertVertexOnEdge: (id: string, edgeIndices?: number[], point?: V3) => {
    const { project, selectedEdgeIndices, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto no encontrado.' };

    if (obj.type === 'SHAPE') {
      if (point) return get().insertShapeVertexAtPoint(id, point);
      return get().subdivideShapeSegment(id);
    }

    let edges = edgeIndices && edgeIndices.length >= 2 ? edgeIndices : selectedEdgeIndices;
    if ((!edges || edges.length < 2) && selectedVertexIndices && selectedVertexIndices.length === 2) {
      edges = [selectedVertexIndices[0], selectedVertexIndices[1]];
    }

    if (!edges || edges.length < 2) {
      return { success: false, message: 'Selecciona una arista o haz clic sobre un borde para insertar un vértice.' };
    }

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    // Bake all existing vertices first so previous deformations/moves are permanently preserved
    newObj.vertices = newObj.vertices.map((v, i) => {
      const o = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    });
    newObj.vertexOffsets = {};

    const newCreatedIndices: number[] = [];

    for (let ei = 0; ei < edges.length; ei += 2) {
      const eA = edges[ei], eB = edges[ei + 1];
      const pA = newObj.vertices[eA], pB = newObj.vertices[eB];
      const vPos: V3 = point ? [point[0], point[1], point[2]] : [(pA[0]+pB[0])/2, (pA[1]+pB[1])/2, (pA[2]+pB[2])/2];
      const newIdx = newObj.vertices.length;
      newObj.vertices.push(vPos);
      newCreatedIndices.push(newIdx);

      const newFaces: MeshFace[] = [];
      newObj.faces.forEach(face => {
        const len = face.indices.length;
        let edgePos = -1;
        for (let i = 0; i < len; i++) {
          const a = face.indices[i], b = face.indices[(i + 1) % len];
          if ((a === eA && b === eB) || (a === eB && b === eA)) {
            edgePos = i;
            break;
          }
        }

        if (edgePos === -1) {
          newFaces.push(face);
        } else {
          const updatedIndices = [...face.indices];
          updatedIndices.splice(edgePos + 1, 0, newIdx);
          newFaces.push({ ...face, indices: updatedIndices });
        }
      });
      newObj.faces = newFaces;
    }

    delete newObj.wireframeEdges;
    newObj.vertexOffsets = {};
    newObj.parameters = {};
    get().updateObject(id, newObj);
    set({ selectedVertexIndices: newCreatedIndices, selectedEdgeIndices: [] });
    get().saveHistory();
    return { success: true, message: `Vértice insertado en la arista.` };
  },

  deleteSelectedVertices: (id: string, vertexIndices?: number[]) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) {
      return { success: false, message: 'Objeto no encontrado.' };
    }

    const indicesToDelete = vertexIndices && vertexIndices.length > 0 ? vertexIndices : selectedVertexIndices;
    if (!indicesToDelete || indicesToDelete.length === 0) {
      return { success: false, message: 'No hay vértices seleccionados para eliminar.' };
    }

    const toRemove = new Set(indicesToDelete.filter(i => i < 10000));
    if (toRemove.size === 0) {
      return { success: false, message: 'Selecciona al menos un punto de control / vértice.' };
    }

    if (obj.type === 'SHAPE') {
      if (obj.vertices.length - toRemove.size < 2) {
        return { success: false, message: 'Una línea o curva necesita al menos 2 vértices.' };
      }

      const newVertices = obj.vertices.filter((_, i) => !toRemove.has(i));
      const newHandles = obj.bezierHandles ? obj.bezierHandles.filter((_, i) => !toRemove.has(i)) : undefined;

      const remapIdx: Record<number, number> = {};
      let ni = 0;
      obj.vertices.forEach((_, oi) => {
        if (!toRemove.has(oi)) remapIdx[oi] = ni++;
      });
      const newOffsets: Record<number, [number, number, number]> = {};
      Object.entries(obj.vertexOffsets ?? {}).forEach(([k, v]) => {
        const mapped = remapIdx[parseInt(k)];
        if (mapped !== undefined) newOffsets[mapped] = v as [number, number, number];
      });

      get().updateObject(id, {
        vertices: newVertices,
        vertexOffsets: newOffsets,
        bezierHandles: newHandles,
      });
      set({ selectedVertexIndices: [] });
      get().saveHistory();
      return { success: true, message: `${toRemove.size} vértice(s) eliminado(s).` };
    } else {
      // Mesh vertex deletion
      const oldVerts = obj.vertices;
      const remap = new Map<number, number>();
      const newVerts: V3[] = [];
      for (let i = 0; i < oldVerts.length; i++) {
        if (!toRemove.has(i)) {
          remap.set(i, newVerts.length);
          const off = obj.vertexOffsets?.[i] ?? [0, 0, 0];
          newVerts.push([oldVerts[i][0] + off[0], oldVerts[i][1] + off[1], oldVerts[i][2] + off[2]]);
        }
      }

      const newFaces: MeshFace[] = [];
      for (const f of obj.faces) {
        if (!f || !f.indices) continue;
        const hasDeleted = f.indices.some(idx => toRemove.has(idx));
        if (!hasDeleted) {
          const remapped = f.indices
            .map(idx => remap.get(idx))
            .filter((idx): idx is number => idx !== undefined && idx >= 0 && idx < newVerts.length);
          if (remapped.length >= 3) {
            newFaces.push({ ...f, indices: remapped });
          }
        }
      }

      get().updateObject(id, {
        vertices: newVerts,
        faces: newFaces,
        vertexOffsets: {},
      });
      set({ selectedVertexIndices: [] });
      get().saveHistory();
      return { success: true, message: `${toRemove.size} vértice(s) eliminado(s).` };
    }
  },

  symmetrizeVertices: (
    id: string,
    vertexIndices?: number[],
    options?: {
      axis?: 'x' | 'y' | 'z';
      direction?: '+to-' | '-to+' | 'selected_to_opposite' | 'both';
      centerSnap?: boolean;
      snapThreshold?: number;
      searchThreshold?: number;
    }
  ) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices || obj.vertices.length === 0) {
      return { success: false, message: 'Objeto sin vértices válidos para simetría.' };
    }

    const axis = options?.axis || 'x';
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const direction = options?.direction || 'selected_to_opposite';
    const centerSnap = options?.centerSnap !== false;
    const snapThreshold = options?.snapThreshold ?? 0.05;
    const searchThreshold = options?.searchThreshold ?? 3.5;

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    if (newObj.type !== 'SHAPE') {
      newObj.type = 'MESH';
      newObj.parameters = {};
    }

    const verts = newObj.vertices;
    const n = verts.length;
    const currentOffsets = { ...(newObj.vertexOffsets || {}) };

    // Coordinates with current offsets applied
    const currentPositions: V3[] = verts.map((v, i) => {
      const off = currentOffsets[i] || [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    });

    const activeSelection = (vertexIndices && vertexIndices.length > 0)
      ? vertexIndices.filter(i => i < n)
      : selectedVertexIndices.filter(i => i < n);

    let sourceIndices: number[] = [];

    if (activeSelection.length > 0) {
      if (direction === '+to-') {
        sourceIndices = activeSelection.filter(i => currentPositions[i][axisIdx] >= -snapThreshold);
      } else if (direction === '-to+') {
        sourceIndices = activeSelection.filter(i => currentPositions[i][axisIdx] <= snapThreshold);
      } else {
        sourceIndices = [...activeSelection];
      }
    } else {
      if (direction === '-to+') {
        sourceIndices = Array.from({ length: n }, (_, i) => i).filter(i => currentPositions[i][axisIdx] <= 0);
      } else {
        sourceIndices = Array.from({ length: n }, (_, i) => i).filter(i => currentPositions[i][axisIdx] >= 0);
      }
    }

    if (sourceIndices.length === 0) {
      return { success: false, message: 'Selecciona vértices en el lado de origen para reflejar al lado opuesto.' };
    }

    const newOffsets = { ...currentOffsets };
    let modifiedCount = 0;
    const matchedCounterparts = new Set<number>();

    sourceIndices.forEach(srcIdx => {
      const srcPos = currentPositions[srcIdx];

      // 1. Snap vertices near the symmetry plane to 0
      if (centerSnap && Math.abs(srcPos[axisIdx]) <= snapThreshold) {
        const snappedPos: V3 = [...srcPos];
        snappedPos[axisIdx] = 0;
        newOffsets[srcIdx] = [
          snappedPos[0] - verts[srcIdx][0],
          snappedPos[1] - verts[srcIdx][1],
          snappedPos[2] - verts[srcIdx][2]
        ];
        currentPositions[srcIdx] = snappedPos;
        modifiedCount++;
        return;
      }

      // 2. Mirrored target coordinate
      const mirroredPos: V3 = [...srcPos];
      mirroredPos[axisIdx] = -srcPos[axisIdx];

      // 3. Find closest opposite vertex counterpart
      let bestMatchIdx = -1;
      let minDistance = Infinity;

      for (let j = 0; j < n; j++) {
        if (j === srcIdx) continue;
        if (matchedCounterparts.has(j)) continue;

        const posJ = currentPositions[j];
        const dist = Math.hypot(
          posJ[0] - mirroredPos[0],
          posJ[1] - mirroredPos[1],
          posJ[2] - mirroredPos[2]
        );

        // Topology rest position hint
        const baseMirrored: V3 = [...verts[srcIdx]];
        baseMirrored[axisIdx] = -verts[srcIdx][axisIdx];
        const baseDist = Math.hypot(
          verts[j][0] - baseMirrored[0],
          verts[j][1] - baseMirrored[1],
          verts[j][2] - baseMirrored[2]
        );

        const score = dist * 0.7 + baseDist * 0.3;

        if (score < minDistance && dist <= searchThreshold) {
          minDistance = score;
          bestMatchIdx = j;
        }
      }

      if (bestMatchIdx !== -1) {
        matchedCounterparts.add(bestMatchIdx);
        newOffsets[bestMatchIdx] = [
          mirroredPos[0] - verts[bestMatchIdx][0],
          mirroredPos[1] - verts[bestMatchIdx][1],
          mirroredPos[2] - verts[bestMatchIdx][2]
        ];
        currentPositions[bestMatchIdx] = mirroredPos;

        if (newObj.type === 'SHAPE' && newObj.bezierHandles) {
          const srcH = newObj.bezierHandles[srcIdx];
          if (srcH && newObj.bezierHandles[bestMatchIdx]) {
            const mirrorV3 = (v: V3): V3 => {
              const res: V3 = [...v];
              res[axisIdx] = -v[axisIdx];
              return res;
            };
            newObj.bezierHandles[bestMatchIdx] = {
              out: mirrorV3(srcH.in || [0, 0, 0]),
              in: mirrorV3(srcH.out || [0, 0, 0]),
              broken: srcH.broken || false
            };
          }
        }

        modifiedCount++;
      }
    });

    if (modifiedCount === 0) {
      return { success: false, message: 'No se encontraron vértices contraparte en el lado opuesto del eje dentro del rango.' };
    }

    newObj.vertexOffsets = newOffsets;
    get().updateObject(id, newObj);
    get().saveHistory();

    return {
      success: true,
      message: `Simetría aplicada (Eje ${axis.toUpperCase()}): ${modifiedCount} vértice(s) emparejados simétricamente.`,
      modifiedCount
    };
  },

  toggleShapeClosed: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return;
    const isClosed = !obj.parameters.closed;
    let verts = [...obj.vertices];
    let handles = obj.bezierHandles ? [...obj.bezierHandles] : undefined;

    if (isClosed && verts.length >= 3) {
      const d = Math.hypot(
        verts[0][0] - verts[verts.length - 1][0],
        verts[0][1] - verts[verts.length - 1][1],
        verts[0][2] - verts[verts.length - 1][2]
      );
      if (d < 0.25) {
        verts.pop();
        if (handles) handles.pop();
      }
    }
    if (obj.parameters.shapeType === 'bezier' && handles) {
      handles = autoSmoothBezierHandles(verts, handles, isClosed);
    }
    get().updateObject(id, {
      vertices: verts,
      bezierHandles: handles,
      parameters: { ...obj.parameters, closed: isClosed },
    });
    get().saveHistory();
  },

  reverseShapeDirection: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return;
    const revVerts = [...obj.vertices].reverse();
    const revHandles = obj.bezierHandles
      ? [...obj.bezierHandles].reverse().map(h => ({
          out: [...h.in] as V3,
          in: [...h.out] as V3,
          broken: h.broken,
        }))
      : undefined;
    get().updateObject(id, {
      vertices: revVerts,
      bezierHandles: revHandles,
      vertexOffsets: {},
    });
    get().saveHistory();
  },

  // ── Face & Edge Tools ──────────────────────────────────────────────────────
  deleteSelectedFaces: (id: string, faceIndices?: number[]) => {
    const { project, selectedFaceIndices } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    if (!obj.faces || obj.faces.length === 0) {
      if (obj.meshData) {
        return { success: false, message: 'Pulsa "Extraer Vértices" en la parte superior para editar caras de este modelo importado.' };
      }
      try {
        const geo = createBaseGeometry(obj);
        const { fromThreeGeometry } = require('../utils/modifiers');
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      } catch {
        return { success: false, message: 'Objeto sin caras editables.' };
      }
    }

    const toDelete = faceIndices && faceIndices.length > 0 ? faceIndices : selectedFaceIndices;
    if (!toDelete || toDelete.length === 0) return { success: false, message: 'No hay caras seleccionadas para eliminar.' };

    const toRemove = new Set(toDelete);
    const newFaces = obj.faces.filter((_, i) => !toRemove.has(i));

    // Si se eliminan todas las caras, convertir limpiamente a modo alambre / wireframe
    if (newFaces.length === 0) {
      const edges = extractUniqueEdges({
        vertices: obj.vertices,
        faces: obj.faces,
        wireframeEdges: obj.wireframeEdges,
        parameters: obj.parameters,
      });

      const bakedVerts: V3[] = obj.vertices.map((v, i) => {
        const off = obj.vertexOffsets?.[i] || [0,0,0];
        return [v[0]+off[0], v[1]+off[1], v[2]+off[2]];
      });

      get().updateObject(id, {
        meshData: undefined,
        vertices: bakedVerts,
        faces: [],
        wireframeEdges: edges,
        isWireframeOnly: true,
        vertexOffsets: {},
        stats: { vertices: bakedVerts.length, faces: 0 }
      });
      set({ selectedFaceIndices: [], selectedVertexIndices: [], selectedEdgeIndices: [] });
      get().saveHistory();
      return { success: true, message: `Todas las caras eliminadas. Objeto convertido a Estructura Alámbrica.` };
    }

    // Clean orphaned vertices
    const usedVerts = new Set<number>();
    newFaces.forEach(f => f.indices.forEach(v => usedVerts.add(v)));
    const remap = new Map<number, number>();
    const newVerts: V3[] = [];
    obj.vertices.forEach((v, i) => {
      if (usedVerts.has(i)) {
        remap.set(i, newVerts.length);
        const off = obj.vertexOffsets?.[i] || [0,0,0];
        newVerts.push([v[0]+off[0], v[1]+off[1], v[2]+off[2]]);
      }
    });

    const remappedFaces = newFaces.map(f => ({
      ...f,
      indices: f.indices.map(v => remap.get(v)!)
    }));

    get().updateObject(id, {
      meshData: undefined,
      vertices: newVerts,
      faces: remappedFaces,
      vertexOffsets: {},
      stats: { vertices: newVerts.length, faces: remappedFaces.length }
    });
    set({ selectedFaceIndices: [], selectedVertexIndices: [] });
    get().saveHistory();
    return { success: true, message: `${toRemove.size} cara(s) eliminada(s). Topología actualizada.` };
  },

  removeAllFaces: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const edges = extractUniqueEdges({
      vertices: obj.vertices,
      faces: obj.faces,
      wireframeEdges: obj.wireframeEdges,
      parameters: obj.parameters,
    });

    const bakedVerts: V3[] = (obj.vertices || []).map((v, i) => {
      const off = obj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    });

    get().updateObject(id, {
      vertices: bakedVerts,
      faces: [],
      wireframeEdges: edges,
      isWireframeOnly: true,
      vertexOffsets: {},
    });
    set({ selectedFaceIndices: [], selectedVertexIndices: [], selectedEdgeIndices: [] });
    get().saveHistory();
    return { success: true, message: `Caras eliminadas: Objeto transformado en Estructura Alámbrica.` };
  },

  convertToWireframe: (id: string, options: WireframeOptions = {}) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const mode = options.mode || 'TUBES';

    if (mode === 'REMOVE_FACES' || mode === 'LINES') {
      return get().removeAllFaces(id);
    }

    try {
      const wireframeData = convertToWireframeModel(obj, options);

      if (options.asNewObject) {
        const newObjId = `wireframe_${Date.now()}`;
        const newObj: CSGObject = {
          ...JSON.parse(JSON.stringify(obj)),
          id: newObjId,
          name: `${obj.name || 'Objeto'} (Celosía 3D)`,
          type: 'MESH',
          vertices: wireframeData.vertices,
          faces: wireframeData.faces,
          wireframeEdges: wireframeData.wireframeEdges,
          isWireframeOnly: false,
          vertexOffsets: {},
          transform: {
            ...obj.transform,
            position: [obj.transform.position[0], obj.transform.position[1], obj.transform.position[2]],
          },
        };

        const updatedObjects = [...project.objects, newObj];
        set(state => ({
          project: { ...state.project, objects: updatedObjects },
          selectedObjectId: newObjId,
          selectedObjectIds: [newObjId],
        }));
        get().saveHistory();
        return {
          success: true,
          message: `Estructura alámbrica 3D creada como nuevo objeto "${newObj.name}".`,
          newObjectId: newObjId,
        };
      } else {
        // Reemplazar el objeto actual
        get().updateObject(id, {
          type: 'MESH',
          vertices: wireframeData.vertices,
          faces: wireframeData.faces,
          wireframeEdges: wireframeData.wireframeEdges,
          isWireframeOnly: false,
          vertexOffsets: {},
        });
        get().saveHistory();
        return {
          success: true,
          message: `Objeto convertido en Estructura Alámbrica 3D sólida (${wireframeData.faces.length} polígonos tubulares).`,
        };
      }
    } catch (err: any) {
      console.error('Error converting to wireframe:', err);
      return { success: false, message: `Error al generar estructura alámbrica: ${err.message || 'Error desconocido'}` };
    }
  },

  insetFaces: (id: string, faceIndices: number[], amount: number = 0.25) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.faces || faceIndices.length === 0) return { success: false, message: 'Selecciona caras para hacer inset.' };

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    // Bake all existing vertices first so previous deformations are permanently preserved
    newObj.vertices = newObj.vertices.map((v, i) => {
      const o = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    });
    newObj.vertexOffsets = {};

    const newFaces: MeshFace[] = [];
    const facesToRemove = new Set(faceIndices);

    faceIndices.forEach(fIdx => {
      const face = newObj.faces[fIdx];
      if (!face || face.indices.length < 3) return;

      const n = face.indices.length;
      const pts = face.indices.map(i => newObj.vertices[i]);
      let cx = 0, cy = 0, cz = 0;
      pts.forEach(p => { cx += p[0]; cy += p[1]; cz += p[2]; });
      cx /= n; cy /= n; cz /= n;

      const factor = Math.max(0.05, Math.min(0.95, amount));
      const innerIndices: number[] = [];

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const inX = p[0] + (cx - p[0]) * factor;
        const inY = p[1] + (cy - p[1]) * factor;
        const inZ = p[2] + (cz - p[2]) * factor;
        const newIdx = newObj.vertices.length;
        newObj.vertices.push([inX, inY, inZ]);
        innerIndices.push(newIdx);
      }

      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        newFaces.push({
          indices: [face.indices[i], face.indices[next], innerIndices[next], innerIndices[i]],
          materialIndex: face.materialIndex
        });
      }

      newFaces.push({
        indices: innerIndices,
        materialIndex: face.materialIndex
      });
    });

    const finalFaces: MeshFace[] = [];
    newObj.faces.forEach((f, idx) => {
      if (!facesToRemove.has(idx)) {
        finalFaces.push(f);
      }
    });
    const startNewIdx = finalFaces.length;
    finalFaces.push(...newFaces);

    newObj.faces = finalFaces;
    delete newObj.wireframeEdges;
    newObj.vertexOffsets = {};
    newObj.parameters = {};

    get().updateObject(id, newObj);
    const innerFaceIndices: number[] = [];
    let count = 0;
    for (let fIdx = 0; fIdx < faceIndices.length; fIdx++) {
      const origFace = obj.faces[faceIndices[fIdx]];
      if (!origFace) continue;
      const numQuads = origFace.indices.length;
      count += numQuads;
      innerFaceIndices.push(startNewIdx + count);
      count += 1;
    }
    set({ selectedFaceIndices: innerFaceIndices });
    get().saveHistory();
    return { success: true, message: `Inset aplicado a ${faceIndices.length} cara(s).` };
  },

  flipSelectedFaceNormals: (id: string, faceIndices?: number[]) => {
    const { project, selectedFaceIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.faces) return { success: false, message: 'Objeto sin caras.' };

    const toFlip = faceIndices && faceIndices.length > 0 ? faceIndices : selectedFaceIndices;
    if (!toFlip || toFlip.length === 0) return { success: false, message: 'Selecciona al menos una cara para invertir.' };

    const newFaces = obj.faces.map((f, i) => {
      if (toFlip.includes(i)) {
        const rev = [...f.indices].reverse();
        return { ...f, indices: rev, normal: f.normal ? [-f.normal[0], -f.normal[1], -f.normal[2]] as V3 : undefined };
      }
      return f;
    });

    get().updateObject(id, { faces: newFaces });
    get().saveHistory();
    return { success: true, message: `Normales invertidas en ${toFlip.length} cara(s).` };
  },

  dissolveSelectedEdges: async (id: string, edgeIndices?: number[]) => {
    const { project, selectedEdgeIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    if (obj.meshData && obj.meshData.type === 'gltf') {
      // Disolver bordes coplanares en modelo GLB (Blender Limited Dissolve / Dissolve Edges)
      set({
        meshProcessing: {
          active: true,
          title: 'Disolver Bordes (Dissolve Edges)',
          subtitle: 'Disolviendo aristas interiores en paneles planos conservando perfiles...',
          progress: 30,
          objectName: obj.name,
          vertCount: obj.stats?.vertices ?? 0,
          faceCount: obj.stats?.faces ?? 0,
        }
      });
      try {
        const { dissolveCoplanarGLBModel } = await import('../utils/glb_processor');
        const dissolved = await dissolveCoplanarGLBModel(obj, 15.0, (prog, step) => {
          set(s => ({
            meshProcessing: s.meshProcessing ? { ...s.meshProcessing, progress: Math.min(90, 25 + Math.floor(prog * 0.65)), subtitle: step } : null
          }));
        });
        get().updateObject(id, {
          meshData: dissolved.meshData,
          stats: dissolved.stats,
        });
        get().saveHistory('Disolver Bordes (Dissolve Edges)', 'edit');
        set({ meshProcessing: null, selectedEdgeIndices: [] });
        return { success: true, message: 'Bordes coplanares disueltos con éxito en el modelo.' };
      } catch (err: any) {
        set({ meshProcessing: null });
        return { success: false, message: `Error al disolver bordes: ${err?.message || err}` };
      }
    }

    if (!obj.faces) return { success: false, message: 'No hay caras asociadas.' };

    const edges = edgeIndices && edgeIndices.length >= 2 ? edgeIndices : selectedEdgeIndices;
    if (!edges || edges.length < 2) {
      // Si no hay aristas seleccionadas, disolver todos los bordes coplanares de la malla (Limited Dissolve de Blender)
      const { dissolveCoplanarFaces } = await import('../utils/meshUtils');
      const res = dissolveCoplanarFaces(
        { vertices: obj.vertices || [], faces: obj.faces },
        15.0,
        { collinearToleranceDeg: 4.0 }
      );
      const dissolvedCount = Math.max(0, (obj.faces?.length || 0) - res.faces.length);
      if (dissolvedCount > 0 || res.faces.length !== obj.faces.length) {
        get().updateObject(id, { faces: res.faces, vertices: res.vertices });
        get().saveHistory('Disolver Bordes (Dissolve Edges)', 'edit');
        return { success: true, message: `${Math.max(1, dissolvedCount)} arista(s) coplanar(es) disuelta(s) en toda la malla.` };
      }
      return { success: false, message: 'No se encontraron bordes coplanares adicionales para disolver.' };
    }

    let faces = [...obj.faces.map(f => ({ ...f, indices: [...f.indices] }))];
    let dissolvedCount = 0;

    for (let ei = 0; ei < edges.length; ei += 2) {
      const eA = edges[ei], eB = edges[ei + 1];

      const sharingFaces = faces.map((f, fi) => ({ f, fi })).filter(({ f }) => {
        const len = f.indices.length;
        for (let k = 0; k < len; k++) {
          const a = f.indices[k], b = f.indices[(k + 1) % len];
          if ((a === eA && b === eB) || (a === eB && b === eA)) return true;
        }
        return false;
      });

      if (sharingFaces.length !== 2) continue;

      const [{ f: faceA, fi: fiA }, { f: faceB, fi: fiB }] = sharingFaces;

      const mergedIndices: number[] = [];
      const lenA = faceA.indices.length;
      for (let k = 0; k < lenA; k++) {
        const a = faceA.indices[k], b = faceA.indices[(k + 1) % lenA];
        mergedIndices.push(a);
        if ((a === eA && b === eB) || (a === eB && b === eA)) {
          const lenB = faceB.indices.length;
          const startB = faceB.indices.indexOf(b);
          if (startB !== -1) {
            for (let m = 1; m < lenB - 1; m++) {
              const idx = faceB.indices[(startB + m) % lenB];
              if (idx !== a && idx !== b) mergedIndices.push(idx);
            }
          }
        }
      }

      const seen = new Set<number>();
      const cleanMerged = mergedIndices.filter(v => { if (seen.has(v)) return false; seen.add(v); return true; });

      if (cleanMerged.length >= 3) {
        const mergedFace = { ...faceA, indices: cleanMerged };
        faces = faces.filter((_, i) => i !== fiA && i !== fiB);
        faces.push(mergedFace);
        dissolvedCount++;
      }
    }

    if (dissolvedCount === 0) return { success: false, message: 'Los bordes seleccionados son de frontera exterior o no se pudieron fusionar.' };

    get().updateObject(id, { faces });
    set({ selectedEdgeIndices: [] });
    get().saveHistory('Disolver Bordes (Dissolve Edges)', 'edit');
    return { success: true, message: `${dissolvedCount} arista(s) disuelta(s) fusionando caras adyacentes.` };
  },

  dissolveSelectedVerticesAction: async (id: string, vertexIndices?: number[]) => {
    const { project, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto sin vértices válidos.' };
    const verts = vertexIndices && vertexIndices.length > 0 ? vertexIndices : selectedVertexIndices;
    if (!verts || verts.length === 0) return { success: false, message: 'Selecciona al menos un vértice para disolver.' };

    const { dissolveSelectedVertices } = await import('../utils/meshUtils');
    const res = dissolveSelectedVertices(obj, verts);
    get().updateObject(id, {
      vertices: res.vertices,
      faces: res.faces,
      stats: { vertices: res.vertices.length, faces: res.faces.length }
    });
    set({ selectedVertexIndices: [] });
    get().saveHistory('Disolver Vértices', 'edit');
    return { success: true, message: res.report.join(', ') };
  },

  dissolveSelectedFacesAction: async (id: string, faceIndices?: number[]) => {
    const { project, selectedFaceIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.faces) return { success: false, message: 'Objeto sin caras válidas.' };
    const faces = faceIndices && faceIndices.length > 0 ? faceIndices : selectedFaceIndices;
    if (!faces || faces.length === 0) return { success: false, message: 'Selecciona caras para disolver.' };

    const { dissolveSelectedFaces } = await import('../utils/meshUtils');
    const res = dissolveSelectedFaces(obj, faces);
    get().updateObject(id, {
      vertices: res.vertices,
      faces: res.faces,
      stats: { vertices: res.vertices.length, faces: res.faces.length }
    });
    set({ selectedFaceIndices: [] });
    get().saveHistory('Disolver Caras', 'edit');
    return { success: true, message: res.report.join(', ') };
  },

  collapseSelectedAction: async (id: string, targetType?: 'VERTEX' | 'EDGE' | 'FACE') => {
    const { project, selectedVertexIndices, selectedEdgeIndices, selectedFaceIndices, editMode } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.vertices) return { success: false, message: 'Objeto no encontrado.' };

    const mode = targetType || editMode;
    const selection = {
      vertexIndices: mode === 'VERTEX' ? selectedVertexIndices : undefined,
      edgeIndices: mode === 'EDGE' ? selectedEdgeIndices : undefined,
      faceIndices: mode === 'FACE' ? selectedFaceIndices : undefined,
    };

    const { collapseSelectedElements } = await import('../utils/meshUtils');
    const res = collapseSelectedElements(obj, selection);
    get().updateObject(id, {
      vertices: res.vertices,
      faces: res.faces,
      stats: { vertices: res.vertices.length, faces: res.faces.length }
    });
    set({ selectedVertexIndices: [], selectedEdgeIndices: [], selectedFaceIndices: [] });
    get().saveHistory('Colapsar (Collapse)', 'edit');
    return { success: true, message: res.report.join(', ') };
  },

  applyDecimateModifier: async (id: string, options: import('../utils/modifiers').DecimateOptions) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;
    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: `Modificador Decimate (${options.mode})`,
        subtitle: `Simplificando geometría según modo ${options.mode}...`,
        progress: 35,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });

    try {
      if (obj.meshData && obj.meshData.type === 'gltf') {
        if (options.mode === 'PLANAR') {
          const { dissolveCoplanarGLBModel } = await import('../utils/glb_processor');
          const dissolved = await dissolveCoplanarGLBModel(obj, options.angleLimitDeg ?? 15.0);
          if (dissolved.stats && dissolved.stats.faces < initialFaces) {
            get().updateObject(id, { meshData: dissolved.meshData, stats: dissolved.stats });
            get().saveHistory(`Decimate Planar (${options.angleLimitDeg ?? 15}°)`, 'edit');
            set({ meshProcessing: null });
            return { success: true, message: `Decimate Planar aplicado: ${dissolved.stats?.faces || 0} caras finales.` };
          }
        } else {
          const { optimizeGLBModel } = await import('../utils/glb_processor');
          const ratio = options.mode === 'UNSUBDIVIDE'
            ? Math.max(0.04, 1.0 / Math.pow(4, options.iterations ?? 1))
            : (options.ratio ?? 0.5);
          const opt = await optimizeGLBModel(obj, ratio);
          if (opt.stats && opt.stats.faces < initialFaces * 0.95) {
            get().updateObject(id, { meshData: opt.meshData, stats: opt.stats });
            get().saveHistory(`Decimate ${options.mode}`, 'edit');
            set({ meshProcessing: null });
            return { success: true, message: `Decimate ${options.mode} aplicado: ${opt.stats?.faces || 0} caras restantes.` };
          }
        }
      }

      if (obj.meshData) obj = await convertImportedToCSG(obj);
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      const { decimateMesh } = await import('../utils/modifiers');
      const res = decimateMesh(obj, options);
      get().updateObject(id, {
        vertices: res.vertices,
        faces: res.faces,
        meshData: undefined, // CRÍTICO: eliminar meshData para que el Viewport renderice la nueva malla decimada
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      get().saveHistory(`Decimate ${options.mode}`, 'edit');
      set({ meshProcessing: null });
      return { success: true, message: `Decimate ${options.mode} completado: de ${initialFaces} a ${res.faces.length} caras.` };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error en Decimate: ${err?.message || err}` };
    }
  },

  applyProVoxelQuadRemesh: async (id: string, options?: { voxelResolution?: number; targetQuads?: number }) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    set({
      meshProcessing: {
        active: true,
        title: 'Flujo Pro: Voxel Remesh + Quad Remesh',
        subtitle: 'Paso 1/2: Rasterizando vóxeles para unificar piezas y sellar geometría...',
        progress: 25,
        objectName: obj.name,
      }
    });

    try {
      // Paso 1: Voxel Remesh para fusionar partes sueltas, cerrar agujeros y crear un volumen estanco
      await get().applyVoxelRemeshToObject(id, {
        voxelResolution: options?.voxelResolution ?? 64,
        snapPlanarFaces: true,
        preserveSharpFeatures: true,
        outputTopology: 'QUAD_DOMINANT',
      });

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          title: 'Flujo Pro: Voxel Remesh + Quad Remesh',
          subtitle: 'Paso 2/2: Generando topología de quads y bucles continuos (Quadriflow)...',
          progress: 65,
        } : null
      }));

      // Paso 2: Retopología en Quads continuos adaptados a la curvatura
      await get().retopologizeObject(id, {
        targetCount: options?.targetQuads ?? 4000,
        mode: 'QUAD_DOMINANT',
        adaptiveCurvature: true,
        preserveCreases: true,
        creaseAngleDeg: 35,
        hardSurfaceProtection: true,
        projectToSurface: true,
      });

      set({ meshProcessing: null });
      get().saveHistory('Flujo Pro: Voxel + Quad Remesh', 'edit');
      return { success: true, message: '¡Flujo Pro completado! Malla unificada en vóxeles y retopologizada en Quads limpios.' };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error en Flujo Pro: ${err?.message || err}` };
    }
  },

  deleteLooseGeometry: async (id: string) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialVerts = (obj.vertices && obj.vertices.length > 0)
      ? obj.vertices.length
      : (obj.stats?.vertices || (obj.meshData as any)?.verticesCount || 0);
    const initialFaces = (obj.faces && obj.faces.length > 0)
      ? obj.faces.length
      : (obj.stats?.faces || (obj.meshData as any)?.facesCount || 0);

    set({
      meshProcessing: {
        active: true,
        title: 'Limpieza: Borrar Geometría Suelta',
        subtitle: 'Buscando y purgando vértices y aristas aisladas sin caras...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) {
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        set({ meshProcessing: null });
        return { success: false, message: 'No se pudieron extraer vértices del objeto.' };
      }

      const { deleteLooseElements } = await import('../utils/meshUtils');
      const res = deleteLooseElements(obj);

      get().updateObject(id, {
        meshData: undefined,
        vertices: res.vertices,
        faces: res.faces,
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      get().saveHistory('Clean Up: Delete Loose', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Elementos sueltos purgados! (${res.report.join(', ')})`,
          completed: true,
          vertCount: obj.vertices.length,
          faceCount: obj.faces.length,
          finalVertCount: res.vertices.length,
          finalFaceCount: res.faces.length,
        } : null
      }));

      return { success: true, message: res.report.join(', ') };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error al borrar sueltos: ${err?.message || err}` };
    }
  },

  dissolveDegenerateGeometry: async (id: string, minArea = 1e-7) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialVerts = (obj.vertices && obj.vertices.length > 0)
      ? obj.vertices.length
      : (obj.stats?.vertices || (obj.meshData as any)?.verticesCount || 0);
    const initialFaces = (obj.faces && obj.faces.length > 0)
      ? obj.faces.length
      : (obj.stats?.faces || (obj.meshData as any)?.facesCount || 0);

    set({
      meshProcessing: {
        active: true,
        title: 'Limpieza: Disolver Caras Degeneradas',
        subtitle: 'Detectando y colapsando polígonos degenerados con área nula...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) {
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }
      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        set({ meshProcessing: null });
        return { success: false, message: 'No se pudieron extraer vértices del objeto.' };
      }

      const { dissolveDegenerateElements } = await import('../utils/meshUtils');
      const res = dissolveDegenerateElements(obj, minArea);

      get().updateObject(id, {
        meshData: undefined,
        vertices: res.vertices,
        faces: res.faces,
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      get().saveHistory('Clean Up: Degenerate Dissolve', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: `¡Caras degeneradas disueltas! (${res.report.join(', ')})`,
          completed: true,
          vertCount: obj.vertices.length,
          faceCount: obj.faces.length,
          finalVertCount: res.vertices.length,
          finalFaceCount: res.faces.length,
        } : null
      }));

      return { success: true, message: res.report.join(', ') };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error al disolver degeneradas: ${err?.message || err}` };
    }
  },

  mergeVerticesByDistanceAction: async (id: string, distance = 0.001) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialVerts = (obj.vertices && obj.vertices.length > 0)
      ? obj.vertices.length
      : (obj.stats?.vertices || (obj.meshData as any)?.verticesCount || 0);
    const initialFaces = (obj.faces && obj.faces.length > 0)
      ? obj.faces.length
      : (obj.stats?.faces || (obj.meshData as any)?.facesCount || 0);

    // Mostrar ventana modal con barra de progreso y estado de ejecución
    set({
      meshProcessing: {
        active: true,
        title: 'Fusionar por Distancia (Merge by Distance)',
        subtitle: `Localizando vértices duplicados con tolerancia <= ${(distance * 1000).toFixed(2)}mm...`,
        progress: 25,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 45));

    try {
      // Si el objeto proviene de un archivo importado FBX/GLTF/OBJ o tiene meshData
      if (obj.meshData) {
        set(s => ({
          meshProcessing: s.meshProcessing ? {
            ...s.meshProcessing,
            subtitle: 'Desglosando geometría de modelo importado a vértices editables...',
            progress: 45
          } : null
        }));
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        set({ meshProcessing: null });
        return { success: false, message: 'No se pudieron extraer los vértices del objeto.' };
      }

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          subtitle: `Fusionando ${obj.vertices.length} vértices en grid 3D (tolerancia ${(distance * 1000).toFixed(2)}mm)...`,
          progress: 75,
          vertCount: obj.vertices.length,
          faceCount: obj.faces.length
        } : null
      }));

      const { repairMesh } = await import('../utils/meshUtils');
      const res = repairMesh(obj, distance);

      const vertDelta = obj.vertices.length - res.vertices.length;

      get().updateObject(id, {
        meshData: undefined, // Limpiar meshData para que Three.js renderice la nueva geometría limpia y reparada
        vertices: res.vertices,
        faces: res.faces,
        vertexOffsets: {},
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      get().saveHistory(`Merge by Distance (${distance})`, 'edit');

      const outcomeMsg = vertDelta > 0
        ? `¡Éxito! Se fusionaron ${vertDelta.toLocaleString()} vértices duplicados.`
        : `¡Malla verificada! No se hallaron vértices duplicados a distancia <= ${(distance * 1000).toFixed(2)}mm.`;

      // Mostrar ventana modal con resumen de lo que ha hecho
      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: outcomeMsg,
          completed: true,
          vertCount: obj.vertices.length,
          faceCount: obj.faces.length,
          finalVertCount: res.vertices.length,
          finalFaceCount: res.faces.length,
        } : null
      }));

      return { 
        success: true, 
        message: `${res.report.join(', ')} (${vertDelta} vértices fusionados)` 
      };
    } catch (err: any) {
      console.error('Error en mergeVerticesByDistanceAction:', err);
      set({ meshProcessing: null });
      return { success: false, message: `Error al fusionar: ${err?.message || err}` };
    }
  },

  purgeMeshIslandsAction: async (id: string, options = { keepOnlyLargest: true }) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialVerts = (obj.vertices && obj.vertices.length > 0)
      ? obj.vertices.length
      : (obj.stats?.vertices || (obj.meshData as any)?.verticesCount || 0);
    const initialFaces = (obj.faces && obj.faces.length > 0)
      ? obj.faces.length
      : (obj.stats?.faces || (obj.meshData as any)?.facesCount || 0);

    set({
      meshProcessing: {
        active: true,
        title: 'Purga de Fragmentos e Islas Flotantes',
        subtitle: 'Analizando conectividad topológica y separando piezas...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) {
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }
      if (!obj.vertices || obj.vertices.length === 0 || !obj.faces || obj.faces.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      if (!obj.vertices || !obj.faces || obj.faces.length === 0) {
        set({ meshProcessing: null });
        return { success: false, message: 'No se pudieron extraer caras del objeto.' };
      }

      const { purgeFloatingIslands } = await import('../utils/meshCleanUp');
      const res = purgeFloatingIslands(obj.vertices, obj.faces, options, obj.vertexOffsets);

      get().updateObject(id, {
        meshData: undefined,
        vertices: res.vertices,
        faces: res.faces,
        vertexOffsets: {},
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      set({ selectedFaceIndices: [], selectedVertexIndices: [], selectedEdgeIndices: [] });
      get().saveHistory('Eliminar Islas Flotantes', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: res.report.message,
          completed: true,
          vertCount: initialVerts,
          faceCount: initialFaces,
          finalVertCount: res.vertices.length,
          finalFaceCount: res.faces.length,
        } : null
      }));

      return { success: true, message: res.report.message };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error al purgar islas: ${err?.message || err}` };
    }
  },

  purgeDebrisPolygonsAction: async (id: string, minArea = 1e-6) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const initialVerts = (obj.vertices && obj.vertices.length > 0)
      ? obj.vertices.length
      : (obj.stats?.vertices || (obj.meshData as any)?.verticesCount || 0);
    const initialFaces = (obj.faces && obj.faces.length > 0)
      ? obj.faces.length
      : (obj.stats?.faces || (obj.meshData as any)?.facesCount || 0);

    set({
      meshProcessing: {
        active: true,
        title: 'Poda Profunda de Polígonos Inservibles',
        subtitle: 'Buscando caras degeneradas, duplicadas coplanares y astillas...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) {
        const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
        obj = await convertImportedToCSG(obj);
      }
      if (!obj.vertices || obj.vertices.length === 0 || !obj.faces || obj.faces.length === 0) {
        const { fromThreeGeometry } = await import('../utils/modifiers');
        const { createBaseGeometry } = await import('../utils/csg');
        const geo = createBaseGeometry(obj);
        const res = fromThreeGeometry(geo);
        obj = { ...obj, vertices: res.vertices, faces: res.faces };
      }

      if (!obj.vertices || !obj.faces || obj.faces.length === 0) {
        set({ meshProcessing: null });
        return { success: false, message: 'No se pudieron extraer caras del objeto.' };
      }

      const { purgeDebrisMesh } = await import('../utils/meshCleanUp');
      const res = purgeDebrisMesh(obj.vertices, obj.faces, minArea, obj.vertexOffsets);

      get().updateObject(id, {
        meshData: undefined,
        vertices: res.vertices,
        faces: res.faces,
        vertexOffsets: {},
        stats: { vertices: res.vertices.length, faces: res.faces.length }
      });
      set({ selectedFaceIndices: [], selectedVertexIndices: [], selectedEdgeIndices: [] });
      get().saveHistory('Poda de Escombros', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: res.report.message,
          completed: true,
          vertCount: initialVerts,
          faceCount: initialFaces,
          finalVertCount: res.vertices.length,
          finalFaceCount: res.faces.length,
        } : null
      }));

      return { success: true, message: res.report.message };
    } catch (err: any) {
      set({ meshProcessing: null });
      return { success: false, message: `Error en poda: ${err?.message || err}` };
    }
  },

  selectLinkedAction: (id?: string) => {
    const { project, selectedObjectId, selectedFaceIndices, selectedVertexIndices } = get();
    const targetId = id || selectedObjectId;
    if (!targetId) return { success: false, message: 'Ningún objeto seleccionado.' };
    const obj = project.objects.find(o => o.id === targetId);
    if (!obj || !obj.faces || obj.faces.length === 0) {
      return { success: false, message: 'El objeto no tiene caras poligonales editables.' };
    }

    const facesToSeed = selectedFaceIndices.length > 0 ? selectedFaceIndices : [0];
    const res = getLinkedSelection(obj.vertices, obj.faces, facesToSeed, selectedVertexIndices);

    if (res.linkedFaceIndices.length === 0) {
      return { success: false, message: 'No se encontró ninguna cara vinculada.' };
    }

    set({
      selectedFaceIndices: res.linkedFaceIndices,
      selectedVertexIndices: res.linkedVertexIndices,
      editMode: 'FACE'
    });

    return {
      success: true,
      message: `¡Isla completa seleccionada! (${res.linkedFaceIndices.length} caras, ${res.linkedVertexIndices.length} vértices). Pulsa Supr para eliminarla.`
    };
  },

  invertSelectionAction: () => {
    const { project, selectedObjectId, selectedFaceIndices, selectedVertexIndices, editMode } = get();
    if (!selectedObjectId) return { success: false, message: 'Ningún objeto seleccionado.' };
    const obj = project.objects.find(o => o.id === selectedObjectId);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    if (editMode === 'FACE' && obj.faces && obj.faces.length > 0) {
      const curSet = new Set(selectedFaceIndices);
      const invertedFaces: number[] = [];
      const invertedVerts = new Set<number>();
      for (let fi = 0; fi < obj.faces.length; fi++) {
        if (!curSet.has(fi)) {
          invertedFaces.push(fi);
          obj.faces[fi].indices.forEach(vi => invertedVerts.add(vi));
        }
      }
      set({
        selectedFaceIndices: invertedFaces,
        selectedVertexIndices: Array.from(invertedVerts)
      });
      return { success: true, message: `Selección invertida: ${invertedFaces.length} caras seleccionadas.` };
    } else if (editMode === 'VERTEX' && obj.vertices && obj.vertices.length > 0) {
      const curSet = new Set(selectedVertexIndices);
      const invertedVerts: number[] = [];
      for (let vi = 0; vi < obj.vertices.length; vi++) {
        if (!curSet.has(vi)) invertedVerts.push(vi);
      }
      set({ selectedVertexIndices: invertedVerts });
      return { success: true, message: `Selección invertida: ${invertedVerts.length} vértices seleccionados.` };
    }
    return { success: false, message: 'Cambia a Modo Caras o Vértices para invertir la selección.' };
  },

  deleteSelectedEdges: (id: string, edgeIndices?: number[]) => {
    const { project, selectedEdgeIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const edges = edgeIndices && edgeIndices.length >= 2 ? edgeIndices : selectedEdgeIndices;
    if (!edges || edges.length < 2) return { success: false, message: 'Selecciona al menos un borde.' };

    if (obj.type === 'SHAPE') {
      return get().deleteSelectedVertices(id, [edges[0], edges[1]]);
    }

    if (!obj.faces) return { success: false, message: 'No hay caras asociadas.' };

    const edgeSet = new Set<string>();
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      edgeSet.add(`${Math.min(a, b)}-${Math.max(a, b)}`);
    }

    const remainingFaces = obj.faces.filter(f => {
      const len = f.indices.length;
      for (let i = 0; i < len; i++) {
        const a = f.indices[i], b = f.indices[(i + 1) % len];
        if (edgeSet.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) {
          return false;
        }
      }
      return true;
    });

    if (remainingFaces.length === 0) return { success: false, message: 'No se pueden eliminar todas las caras del objeto.' };

    get().updateObject(id, { faces: remainingFaces });
    set({ selectedEdgeIndices: [] });
    get().saveHistory();
    return { success: true, message: `Bordes eliminados con sus caras adyacentes.` };
  },

  subdivideSelectedEdges: (id: string, edgeIndices?: number[]) => {
    const { project, selectedEdgeIndices, selectedVertexIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    if (obj.type === 'SHAPE') {
      return get().subdivideShapeSegment(id);
    }

    let edges = edgeIndices && edgeIndices.length >= 2 ? edgeIndices : selectedEdgeIndices;
    if ((!edges || edges.length < 2) && selectedVertexIndices && selectedVertexIndices.length === 2) {
      edges = [selectedVertexIndices[0], selectedVertexIndices[1]];
    }

    if (!edges || edges.length < 2) return { success: false, message: 'Selecciona al menos una arista para dividir.' };

    const newObj: CSGObject = JSON.parse(JSON.stringify(obj));
    newObj.type = 'MESH';

    // Bake all existing vertices first so previous deformations/moves are permanently preserved
    newObj.vertices = newObj.vertices.map((v, i) => {
      const o = newObj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    });
    newObj.vertexOffsets = {};

    const newCreatedIndices: number[] = [];
    let splitCount = 0;
    for (let ei = 0; ei < edges.length; ei += 2) {
      const eA = edges[ei], eB = edges[ei + 1];
      const pA = newObj.vertices[eA], pB = newObj.vertices[eB];
      const mid: V3 = [(pA[0]+pB[0])/2, (pA[1]+pB[1])/2, (pA[2]+pB[2])/2];
      const midIdx = newObj.vertices.length;
      newObj.vertices.push(mid);
      newCreatedIndices.push(midIdx);

      const newFaces: MeshFace[] = [];
      newObj.faces.forEach(face => {
        const len = face.indices.length;
        let edgePos = -1;
        for (let i = 0; i < len; i++) {
          const a = face.indices[i], b = face.indices[(i + 1) % len];
          if ((a === eA && b === eB) || (a === eB && b === eA)) {
            edgePos = i;
            break;
          }
        }

        if (edgePos === -1) {
          newFaces.push(face);
        } else {
          const updatedIndices = [...face.indices];
          updatedIndices.splice(edgePos + 1, 0, midIdx);
          newFaces.push({ ...face, indices: updatedIndices });
          splitCount++;
        }
      });
      newObj.faces = newFaces;
    }

    delete newObj.wireframeEdges;
    newObj.vertexOffsets = {};
    newObj.parameters = {};
    get().updateObject(id, newObj);
    set({ selectedVertexIndices: newCreatedIndices, selectedEdgeIndices: [] });
    get().saveHistory();
    return { success: true, message: `Arista(s) dividida(s) creando nuevo vértice.` };
  },

  bridgeSelectedEdges: (id: string, edgeIndices?: number[]) => {
    const { project, selectedEdgeIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.faces) return { success: false, message: 'Objeto no encontrado.' };

    const edges = edgeIndices && edgeIndices.length >= 4 ? edgeIndices : selectedEdgeIndices;
    if (!edges || edges.length < 4) return { success: false, message: 'Selecciona al menos 2 bordes para conectar con una cara.' };

    const e1_a = edges[0], e1_b = edges[1];
    const e2_a = edges[2], e2_b = edges[3];

    const newFaces = [...obj.faces, { indices: [e1_a, e1_b, e2_b, e2_a] }];
    get().updateObject(id, { faces: newFaces });
    set({ selectedEdgeIndices: [] });
    get().saveHistory();
    return { success: true, message: `Cara generada entre los bordes seleccionados.` };
  },

  bevelSelectedEdges: (id: string, edgeIndices?: number[], width: number = 0.08, segments: number = 3) => {
    const { project, selectedEdgeIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const edges = edgeIndices && edgeIndices.length >= 2 ? edgeIndices : selectedEdgeIndices;
    const edgeKeys: string[] = [];
    if (edges && edges.length >= 2) {
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i], b = edges[i + 1];
        edgeKeys.push(`${Math.min(a, b)}_${Math.max(a, b)}`);
      }
    }

    try {
      const res = bevelMeshAdvanced(obj, {
        affect: 'EDGES',
        width,
        segments,
        limitMethod: edgeKeys.length > 0 ? 'SELECTION' : 'ANGLE',
        selectedEdgeKeys: edgeKeys.length > 0 ? edgeKeys : undefined,
      });

      if (res.vertices.length > 0 && res.faces.length > 0) {
        get().updateObject(id, {
          vertices: res.vertices,
          faces: res.faces,
          vertexOffsets: {},
          parameters: {},
        });
        set({ selectedEdgeIndices: [] });
        get().saveHistory();
        return { success: true, message: `Biselado aplicado a los bordes.` };
      }
      return { success: false, message: 'No se pudo generar el biselado en esta geometría.' };
    } catch (e) {
      console.error(e);
      return { success: false, message: 'Error al biselar bordes.' };
    }
  },

  applyLoopCut: (id: string, edge?: [number, number], cuts?: number, slide?: number) => {
    const { project, selectedEdgeIndices, loopCutCuts, loopCutSlide } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    let targetEdge = edge;
    if (!targetEdge && selectedEdgeIndices && selectedEdgeIndices.length >= 2) {
      targetEdge = [selectedEdgeIndices[0], selectedEdgeIndices[1]];
    }

    if (!targetEdge) {
      return { success: false, message: 'Selecciona o pasa el cursor sobre una arista para cortar el bucle.' };
    }

    const numCuts = cuts ?? loopCutCuts ?? 1;
    const slideFactor = slide ?? loopCutSlide ?? 0.5;

    const result = executeLoopCut(obj, targetEdge, numCuts, slideFactor);
    if (result.success && result.newObj) {
      set({
        project: {
          ...project,
          objects: project.objects.map(o => (o.id === id ? result.newObj! : o)),
        },
        selectedVertexIndices: result.newVertexIndices || [],
        selectedEdgeIndices: [],
      });
      get().saveHistory();
      return { success: true, message: result.message };
    }

    return { success: false, message: result.message || 'No se pudo realizar el corte en bucle.' };
  },

  extrudeManifold: async (id: string, faceIndices?: number[], distance: number = 0.3) => {
    const { project, selectedFaceIndices } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const targetFaces = faceIndices && faceIndices.length > 0 ? faceIndices : selectedFaceIndices;
    if (!targetFaces || targetFaces.length === 0) {
      return { success: false, message: 'Selecciona al menos una cara para la Extrusión Manifold.' };
    }

    const result = await executeExtrudeManifold(obj, targetFaces, distance, { autoHeal: true });
    if (result.success && result.newObj) {
      set({
        project: {
          ...project,
          objects: project.objects.map(o => (o.id === id ? result.newObj! : o)),
        },
        selectedFaceIndices: [],
        selectedVertexIndices: result.selectedVertexIndices || [],
      });
      get().saveHistory();
      return { success: true, message: result.message };
    }

    return { success: false, message: result.message || 'Error en la Extrusión Manifold.' };
  },

  healObject: async (id) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Curado Topológico Manifold',
        subtitle: 'Cerrando vacíos y consolidando sólido...',
        progress: 25,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) obj = await convertImportedToCSG(obj);
      const { healMesh } = await import('../utils/manifoldUtils');
      const result = await healMesh(obj.vertices, obj.faces);
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {}, stats: { vertices: result.vertices.length, faces: result.faces.length } } : o)}});
      get().saveHistory('Curado Topológico Manifold', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: '¡Curado topológico completado!',
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error('Manifold heal failed', e);
      set({ meshProcessing: null });
    }
  },

  fillHolesObject: async (id) => {
    const { project } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    const initialVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
    const initialFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

    set({
      meshProcessing: {
        active: true,
        title: 'Tapar Agujeros Poligonales',
        subtitle: 'Buscando bordes abiertos y triangulando huecos...',
        progress: 30,
        objectName: obj.name,
        vertCount: initialVerts,
        faceCount: initialFaces,
      }
    });
    await new Promise(r => setTimeout(r, 40));

    try {
      if (obj.meshData) obj = await convertImportedToCSG(obj);
      const result = fillHoles(obj);
      set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {}, stats: { vertices: result.vertices.length, faces: result.faces.length } } : o)}});
      get().saveHistory('Tapar Huecos Poligonales', 'edit');

      set(s => ({
        meshProcessing: s.meshProcessing ? {
          ...s.meshProcessing,
          progress: 100,
          subtitle: '¡Agujeros sellados con éxito!',
          completed: true,
          finalVertCount: result.vertices.length,
          finalFaceCount: result.faces.length,
        } : null
      }));
    } catch (e) {
      console.error("Error en Tapar Huecos:", e);
      set({ meshProcessing: null });
    }
  },

  separateLoosePartsObject: async (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const { separateLooseParts } = await import('../utils/meshExplode');
    const result = await separateLooseParts(obj);

    if (!result.success || !result.objects) {
      return result;
    }

    const updatedObjects = project.objects.flatMap(o =>
      o.id === id ? result.objects! : [o]
    );

    set({
      project: { ...get().project, objects: updatedObjects },
      selectedObjectId: result.objects[0].id,
      selectedObjectIds: result.objects.map(o => o.id),
    });
    get().saveHistory();

    return { success: true, message: result.message, count: result.objects.length };
  },

  ungroupSelectedObject: async (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return { success: false, message: 'Objeto no encontrado.' };

    const { ungroupObject } = await import('../utils/ungroup');
    const result = await ungroupObject(obj);

    if (!result.success || !result.objects || result.objects.length === 0) {
      return result;
    }

    const updatedObjects = project.objects.flatMap(o =>
      o.id === id ? result.objects! : [o]
    );

    const newSelectedIds = result.objects.map(o => o.id);

    set({
      project: { ...get().project, objects: updatedObjects },
      selectedObjectId: result.objects[0].id,
      selectedObjectIds: newSelectedIds,
    });
    get().saveHistory();

    return { success: true, message: result.message, count: result.objects.length };
  },

  recenterPivotObject: async (idInput?: string) => {
    const { project, selectedObjectId, selectedObjectIds } = get();
    const targetIds = idInput ? [idInput] : (selectedObjectIds.length > 0 ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []));
    if (targetIds.length === 0) return;

    const { convertImportedToCSG } = await import('../utils/modifiers_advanced');
    const { createBaseGeometry } = await import('../utils/csg');
    const { fromThreeGeometry } = await import('../utils/modifiers');

    let updatedObjects = [...project.objects];
    let changed = false;

    for (const id of targetIds) {
      let obj = updatedObjects.find(o => o.id === id);
      if (!obj) continue;

      if (obj.meshData) {
        try {
          obj = await convertImportedToCSG(obj);
        } catch (e) {
          console.error('Error convirtiendo modelo para centrar pivote:', e);
        }
      }

      if (!obj.vertices || obj.vertices.length === 0) {
        try {
          const geo = createBaseGeometry(obj);
          const res = fromThreeGeometry(geo);
          obj = {
            ...obj,
            vertices: res.vertices,
            faces: res.faces,
            meshData: undefined,
          };
        } catch (e) {
          console.error('Error generando geometría para centrar pivote:', e);
          continue;
        }
      }

      let vertices = obj.vertices || [];
      if (!vertices.length) continue;

      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

      vertices.forEach((v, idx) => {
        const off = obj.vertexOffsets?.[idx] ?? [0, 0, 0];
        const vx = v[0] + off[0];
        const vy = v[1] + off[1];
        const vz = v[2] + off[2];
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
      });

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;

      if (Math.hypot(cx, cy, cz) < 1e-4) {
        if (obj.vertexOffsets && Object.keys(obj.vertexOffsets).length > 0) {
          const flushedVertices: V3[] = vertices.map((v, idx) => {
            const off = obj.vertexOffsets?.[idx] ?? [0, 0, 0];
            return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
          });
          updatedObjects = updatedObjects.map(o => o.id === id ? {
            ...obj,
            vertices: flushedVertices,
            vertexOffsets: {},
            meshData: undefined,
          } : o);
          changed = true;
        } else if (obj.meshData) {
          updatedObjects = updatedObjects.map(o => o.id === id ? {
            ...obj,
            meshData: undefined,
          } : o);
          changed = true;
        }
        continue;
      }

      const newVertices: V3[] = vertices.map((v, idx) => {
        const off = obj.vertexOffsets?.[idx] ?? [0, 0, 0];
        return [v[0] + off[0] - cx, v[1] + off[1] - cy, v[2] + off[2] - cz];
      });

      const scale = new THREE.Vector3(...obj.transform.scale);
      const euler = new THREE.Euler(...obj.transform.rotation, 'XYZ');
      const localOffset = new THREE.Vector3(cx, cy, cz).multiply(scale).applyEuler(euler);

      const newPos: [number, number, number] = [
        obj.transform.position[0] + localOffset.x,
        obj.transform.position[1] + localOffset.y,
        obj.transform.position[2] + localOffset.z,
      ];

      updatedObjects = updatedObjects.map(o => o.id === id ? {
        ...obj,
        vertices: newVertices,
        faces: obj.faces,
        vertexOffsets: {},
        meshData: undefined,
        transform: {
          ...obj.transform,
          position: newPos,
        }
      } : o);

      changed = true;
    }

    if (changed) {
      set({ project: { ...get().project, objects: updatedObjects } });
      get().saveHistory();
    }
  },

  capSelectedFacesObject: async (id) => {
    const { project, selectedFaceIndices } = get();
    let obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    if (obj.meshData) obj = await convertImportedToCSG(obj);
    const result = capSelectedFaces(obj, selectedFaceIndices);
    set({ project: { ...get().project, objects: get().project.objects.map(o => o.id === id ? { ...o, meshData: undefined, vertices: result.vertices, faces: result.faces, vertexOffsets: {} } : o)}});
    get().saveHistory();
  },

  alignToGrid: (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    const gs = 0.5;
    const newPos: V3 = obj.transform.position.map(v => Math.round(v/gs)*gs) as V3;
    set({ project: { ...project, objects: project.objects.map(o => o.id === id ? { ...o, transform: { ...o.transform, position: newPos } } : o)}});
    get().saveHistory();
  },

  alignToGround: (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;
    const box = new THREE.Box3();
    obj.vertices.forEach((v, i) => {
      const off = obj.vertexOffsets?.[i] || [0,0,0];
      box.expandByPoint(new THREE.Vector3(v[0]+off[0], v[1]+off[1], v[2]+off[2]));
    });
    const minY = box.min.y * obj.transform.scale[1];
    set({ project: { ...project, objects: project.objects.map(o =>
      o.id === id ? { ...o, transform: { ...o.transform, position: [o.transform.position[0], -minY, o.transform.position[2]] } } : o
    )}});
    get().saveHistory();
  },

  alignToSurface: async (idInput) => {
    const { project, selectedObjectId, faceSnapConfig } = get();
    const targetId = idInput || selectedObjectId;
    if (!targetId) return false;
    const obj = project.objects.find(o => o.id === targetId);
    if (!obj) return false;

    // Build Three.js meshes from other objects to test against
    const targetObjects = project.objects.filter(o => o.id !== targetId && (faceSnapConfig.targetObjectId ? o.id === faceSnapConfig.targetObjectId : true));
    if (targetObjects.length === 0) return false;

    const targetMeshes: THREE.Object3D[] = [];
    for (const tgt of targetObjects) {
      let verts = tgt.vertices;
      let faces = tgt.faces;
      if (!verts || verts.length === 0) {
        try {
          const { fromThreeGeometry } = await import('../utils/modifiers');
          const baseGeo = createBaseGeometry(tgt);
          const res = fromThreeGeometry(baseGeo);
          verts = res.vertices;
          faces = res.faces;
        } catch (_) {}
      }
      if (!verts || verts.length === 0) continue;

      const geom = new THREE.BufferGeometry();
      const posArr: number[] = [];
      const matWorld = new THREE.Matrix4().compose(
        new THREE.Vector3(...tgt.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...tgt.transform.rotation, 'XYZ')),
        new THREE.Vector3(...tgt.transform.scale)
      );
      if (faces && faces.length > 0) {
        for (const face of faces) {
          const idxs = (face as any).indices || (Array.isArray(face) ? (face as any) : []);
          if (idxs.length >= 3) {
            for (let i = 1; i < idxs.length - 1; i++) {
              const p0 = new THREE.Vector3(...verts[idxs[0]]).applyMatrix4(matWorld);
              const p1 = new THREE.Vector3(...verts[idxs[i]]).applyMatrix4(matWorld);
              const p2 = new THREE.Vector3(...verts[idxs[i + 1]]).applyMatrix4(matWorld);
              posArr.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
            }
          }
        }
      }
      if (posArr.length >= 9) {
        geom.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        geom.computeVertexNormals();
        const m = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
        m.updateMatrixWorld(true);
        targetMeshes.push(m);
      }
    }

    if (targetMeshes.length === 0) return false;

    const curPos = new THREE.Vector3(...obj.transform.position);
    const snapRes = snapPointToSurfaces(curPos, targetMeshes, undefined, faceSnapConfig.offset ?? 0.002);
    if (!snapRes.hit) return false;

    const alignAxis = faceSnapConfig.alignmentAxis || '+Y';
    const newRot = faceSnapConfig.alignRotationToTarget !== false
      ? alignObjectRotationToNormal(obj.transform.rotation, snapRes.normal, alignAxis)
      : obj.transform.rotation;

    let newPos = snapRes.snappedPoint.clone();
    if (faceSnapConfig.snapBaseToSurface !== false) {
      const baseDist = getObjectBaseExtentAlongNormal(obj, snapRes.normal, alignAxis);
      newPos.addScaledVector(snapRes.normal, baseDist);
    }

    set({
      project: {
        ...project,
        objects: project.objects.map(o =>
          o.id === targetId
            ? {
                ...o,
                transform: {
                  ...o.transform,
                  position: [newPos.x, newPos.y, newPos.z],
                  rotation: newRot,
                }
              }
            : o
        )
      }
    });
    get().saveHistory();
    return true;
  },

  loadFaceSnapDemoScene: (replaceScene = false) => {
    const colGeom = generatePrimitive('CYLINDER', { segments: 32, radialSegments: 32 });
    const columnaId = `columna-morada-${Date.now()}`;
    const columna: CSGObject = {
      id: columnaId,
      name: 'Columna Curva (Objetivo Morado)',
      type: 'CYLINDER',
      operation: 'ADD',
      transform: { position: [0, 1.6, 0], rotation: [0, 0, 0], scale: [1.6, 3.2, 1.6] },
      parameters: { segments: 32, radialSegments: 32 },
      vertices: colGeom.vertices,
      faces: colGeom.faces,
      color: '#8b5cf6',
      smoothShading: true,
      opacity: 1,
      visible: true,
      keyframes: [],
    };

    const accGeom = generatePrimitive('CYLINDER', { segments: 24, radialSegments: 24 });
    const accesorioId = `accesorio-azul-${Date.now()}`;
    const accesorio: CSGObject = {
      id: accesorioId,
      name: 'Accesorio (Cilindro Azul)',
      type: 'CYLINDER',
      operation: 'ADD',
      transform: { position: [2.3, 2.0, 0.4], rotation: [0, 0, 0], scale: [0.35, 0.8, 0.35] },
      parameters: { segments: 24, radialSegments: 24 },
      vertices: accGeom.vertices,
      faces: accGeom.faces,
      color: '#38bdf8',
      smoothShading: true,
      opacity: 1,
      visible: true,
      keyframes: [],
    };

    const curObjects = replaceScene ? [] : get().project.objects;
    set({
      project: {
        ...get().project,
        objects: [...curObjects, columna, accesorio]
      },
      selectedObjectId: accesorioId,
      selectedObjectIds: [accesorioId],
      faceSnapConfig: {
        enabled: true,
        targetType: 'FACE',
        projectIndividualElements: true,
        offset: 0.002,
        targetObjectId: columnaId,
        alignRotationToTarget: true,
        snapBaseToSurface: true,
        alignmentAxis: '+Y'
      }
    });
    get().saveHistory();
  },

  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying:   (v)    => set({ isPlaying: v }),
  setIsScrubbing: (v)    => set({ isScrubbing: v }),
  setIsRecording: (v)    => set({ isRecording: v }),
  setViewMode:    (mode) => set({ viewMode: mode }),
  setEditMode: async (mode) => {
    if (mode !== 'OBJECT') {
      const { project, selectedObjectId } = get();
      if (selectedObjectId) {
        let obj = project.objects.find(o => o.id === selectedObjectId);
        if (obj && obj.meshData) {
          obj = await convertImportedToCSG(obj);
          obj.meshData = undefined;
          get().updateObject(obj.id, obj);
        }
      }
    }
    set({ editMode: mode, selectedVertexIndices: [], selectedFaceIndices: [], selectedEdgeIndices: [] });
  },
  setTransformMode:  (mode)  => set({ transformMode: mode }),
  setTransformSpace: (space) => set({ transformSpace: space }),
  setDrawMode:       (mode)  => set({ drawMode: mode }),
  setDrawColor:      (color) => set({ drawColor: color }),

  // ── FIX: Keyframes — deduplicate by time (±0.001 s tolerance) ────────────
  addKeyframe: (objectId, time) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === objectId);
    if (!obj) return;
    
    // Calculate interpolated transform at this time
    const _interpTransform = (() => {
      const kfs = obj.keyframes || [];
      if (kfs.length === 0) return obj.transform;
      const sorted = [...kfs].sort((a, b) => a.time - b.time);
      if (time <= sorted[0].time) return sorted[0].transform;
      if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
      let prev = sorted[0], next = sorted[0];
      for (let _i = 0; _i < sorted.length - 1; _i++) {
        if (time >= sorted[_i].time && time <= sorted[_i+1].time) {
          prev = sorted[_i]; next = sorted[_i+1]; break;
        }
      }
      const t = (time - prev.time) / (next.time - prev.time);
      const lerp = (a: number, b: number) => a + (b-a)*t;
      return {
        position: [lerp(prev.transform.position[0], next.transform.position[0]),
                   lerp(prev.transform.position[1], next.transform.position[1]),
                   lerp(prev.transform.position[2], next.transform.position[2])] as [number,number,number],
        rotation: [lerp(prev.transform.rotation[0], next.transform.rotation[0]),
                   lerp(prev.transform.rotation[1], next.transform.rotation[1]),
                   lerp(prev.transform.rotation[2], next.transform.rotation[2])] as [number,number,number],
        scale:    [lerp(prev.transform.scale[0], next.transform.scale[0]),
                   lerp(prev.transform.scale[1], next.transform.scale[1]),
                   lerp(prev.transform.scale[2], next.transform.scale[2])] as [number,number,number],
      };
    })();

    const newKf = { id: genId(), time, transform: JSON.parse(JSON.stringify(_interpTransform)) };
    set({ project: { ...project, objects: project.objects.map(o =>
      o.id === objectId
        ? { ...o, keyframes: [...(o.keyframes || []).filter(k => Math.abs(k.time - time) > 0.001), newKf].sort((a,b) => a.time - b.time) }
        : o
    )}});
    get().saveHistory();
  },

  removeKeyframe: (objectId, keyframeId) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o =>
      o.id === objectId ? { ...o, keyframes: o.keyframes.filter(k => k.id !== keyframeId) } : o
    )}});
    get().saveHistory();
  },

  clearAllKeyframes: (objectId) => {
    const { project } = get();
    set({ project: { ...project, objects: project.objects.map(o =>
      o.id === objectId ? { ...o, keyframes: [] } : o
    )}});
    get().saveHistory();
  },

  // ── NURBS Actions ─────────────────────────────────────────────────────────
  addNurbsObject: (type) => {
    get().addObject(type);
  },

  selectNurbsControlPoint: (id, uIndex, vIndex, multi = false) => {
    const { project } = get();
    set({
      project: {
        ...project,
        objects: project.objects.map(o => {
          if (o.id !== id) {
            return o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0)
              ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
              : o;
          }
          if (uIndex === null || uIndex === undefined || uIndex < 0) {
            return { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] };
          }
          const v = vIndex !== null && vIndex !== undefined ? vIndex : undefined;
          const targetPt = { u: uIndex, v };
          if (multi) {
            const existing = o.selectedNurbsControlPoints || (o.selectedNurbsControlPoint ? [o.selectedNurbsControlPoint] : []);
            const idx = existing.findIndex(p => p.u === targetPt.u && (p.v ?? 0) === (targetPt.v ?? 0));
            let nextPts: { u: number; v?: number }[];
            if (idx >= 0) {
              nextPts = existing.filter((_, i) => i !== idx);
            } else {
              nextPts = [...existing, targetPt];
            }
            return {
              ...o,
              selectedNurbsControlPoints: nextPts,
              selectedNurbsControlPoint: nextPts.length > 0 ? nextPts[nextPts.length - 1] : null
            };
          } else {
            return {
              ...o,
              selectedNurbsControlPoint: targetPt,
              selectedNurbsControlPoints: [targetPt]
            };
          }
        })
      }
    });
  },

  selectNurbsControlPoints: (id, points) => {
    const { project } = get();
    set({
      project: {
        ...project,
        objects: project.objects.map(o => {
          if (o.id !== id) {
            return o.selectedNurbsControlPoint || (o.selectedNurbsControlPoints && o.selectedNurbsControlPoints.length > 0)
              ? { ...o, selectedNurbsControlPoint: null, selectedNurbsControlPoints: [] }
              : o;
          }
          return {
            ...o,
            selectedNurbsControlPoints: points,
            selectedNurbsControlPoint: points.length > 0 ? points[points.length - 1] : null
          };
        })
      }
    });
  },

  updateNurbsControlPoints: (id, updates) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || updates.length === 0) return;

    if (obj.nurbsSurface) {
      const surface = { ...obj.nurbsSurface };
      const grid = surface.controlPoints.map(row => row.map(cp => ({ ...cp, point: [...cp.point] as V3 })));
      for (const u of updates) {
        const v = u.v ?? 0;
        if (grid[u.u] && grid[u.u][v]) {
          grid[u.u][v].point = u.point;
          if (u.weight !== undefined) grid[u.u][v].weight = Math.max(0.01, u.weight);
        }
      }
      surface.controlPoints = grid;
      const geom = tessellateNurbsSurface(
        surface,
        obj.parameters.nurbsResolutionU ?? 16,
        obj.parameters.nurbsResolutionV ?? 16
      );

      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsSurface: surface,
                  parameters: { ...o.parameters, nurbsSurface: surface },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
    } else if (obj.nurbsCurve) {
      const curve = { ...obj.nurbsCurve };
      const pts = curve.controlPoints.map(cp => ({ ...cp, point: [...cp.point] as V3 }));
      for (const u of updates) {
        if (pts[u.u]) {
          pts[u.u].point = u.point;
          if (u.weight !== undefined) pts[u.u].weight = Math.max(0.01, u.weight);
        }
      }
      curve.controlPoints = pts;
      const geom = tessellateNurbsCurveToMesh(
        curve,
        obj.parameters.segments ?? 32,
        obj.parameters.radius ?? 0.03
      );

      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsCurve: curve,
                  parameters: { ...o.parameters, nurbsCurve: curve },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
    }
  },

  updateNurbsControlPoint: (id, uIndex, vIndex, point, weight) => {
    get().updateNurbsControlPoints(id, [{ u: uIndex, v: vIndex, point, weight }]);
  },

  setNurbsControlPointWeight: (id, uIndex, vIndex, weight) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const surface = { ...obj.nurbsSurface };
      const grid = surface.controlPoints.map(row => row.map(cp => ({ ...cp, point: [...cp.point] as V3 })));
      const v = vIndex ?? 0;
      if (grid[uIndex] && grid[uIndex][v]) {
        grid[uIndex][v].weight = Math.max(0.01, weight);
      }
      surface.controlPoints = grid;
      const geom = tessellateNurbsSurface(surface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: surface, parameters: { ...o.parameters, nurbsSurface: surface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const curve = { ...obj.nurbsCurve };
      const pts = curve.controlPoints.map(cp => ({ ...cp, point: [...cp.point] as V3 }));
      if (pts[uIndex]) pts[uIndex].weight = Math.max(0.01, weight);
      curve.controlPoints = pts;
      const geom = tessellateNurbsCurveToMesh(curve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: curve, parameters: { ...o.parameters, nurbsCurve: curve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  subdivideNurbsObject: (id, dir = 'BOTH') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = subdivideNurbsSurface(obj.nurbsSurface, dir);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = subdivideNurbsCurve(obj.nurbsCurve);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  extrudeNurbsObject: (id, delta = [0, 0.8, 0]) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsCurve) {
      // Extrude curve into 3D Surface
      const surface = extrudeNurbsCurve(obj.nurbsCurve, delta);
      const geom = tessellateNurbsSurface(surface, 16, 20);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  type: 'NURBS_SURFACE',
                  name: `${obj.name} (Extruido)`,
                  nurbsCurve: undefined,
                  nurbsSurface: surface,
                  parameters: { ...o.parameters, nurbsCurve: undefined, nurbsSurface: surface, nurbsResolutionU: 16, nurbsResolutionV: 20 },
                  vertices: geom.vertices,
                  faces: geom.faces,
                  smoothShading: true,
                }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsSurface) {
      // Extrude surface boundary row
      const newSurface = extrudeNurbsSurfaceRow(obj.nurbsSurface, 'U', 'END', delta);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsSurface: newSurface,
                  parameters: { ...o.parameters, nurbsSurface: newSurface },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  revolveNurbsObject: (id, angleDeg = 360, axis = 'y') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj || !obj.nurbsCurve) return;

    const surface = revolveNurbsCurve(obj.nurbsCurve, angleDeg, axis);
    const geom = tessellateNurbsSurface(surface, 18, 28);

    set({
      project: {
        ...project,
        objects: project.objects.map(o =>
          o.id === id
            ? {
                ...o,
                type: 'NURBS_SURFACE',
                name: `${obj.name} (Revolución)`,
                nurbsCurve: undefined,
                nurbsSurface: surface,
                parameters: { ...o.parameters, nurbsCurve: undefined, nurbsSurface: surface, nurbsResolutionU: 18, nurbsResolutionV: 28 },
                vertices: geom.vertices,
                faces: geom.faces,
                smoothShading: true,
              }
            : o
        )
      }
    });
    get().saveHistory();
  },

  loftNurbsObjects: (ids) => {
    const { project } = get();
    const curves = ids
      .map(id => project.objects.find(o => o.id === id)?.nurbsCurve)
      .filter((c): c is NurbsCurveData => !!c);

    if (curves.length === 0) return;

    const surface = loftNurbsCurves(curves);
    const geom = tessellateNurbsSurface(surface, 16, 24);

    const newObj: CSGObject = {
      id: genId(),
      name: `Superficie Loft ${project.objects.length + 1}`,
      type: 'NURBS_SURFACE',
      operation: 'ADD',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      parameters: { nurbsSurface: surface, nurbsResolutionU: 16, nurbsResolutionV: 24 },
      nurbsSurface: surface,
      isNurbs: true,
      vertices: geom.vertices,
      faces: geom.faces,
      color: '#06b6d4',
      smoothShading: true,
      opacity: 1,
      visible: true,
      keyframes: [],
    };

    set({
      project: { ...project, objects: [...project.objects, newObj] },
      selectedObjectId: newObj.id,
      selectedObjectIds: [newObj.id],
    });
    get().saveHistory();
  },

  fillNurbsObject: (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsCurve) {
      const curve: NurbsCurveData = {
        ...obj.nurbsCurve,
        closed: !obj.nurbsCurve.closed,
      };
      const geom = tessellateNurbsCurveToMesh(curve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: curve, parameters: { ...o.parameters, nurbsCurve: curve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsSurface) {
      const surface: NurbsSurfaceData = {
        ...obj.nurbsSurface,
        closedU: !obj.nurbsSurface.closedU,
      };
      const geom = tessellateNurbsSurface(surface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: surface, parameters: { ...o.parameters, nurbsSurface: surface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  switchNurbsDirectionObject: (id, dir = 'U') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = switchNurbsDirection(obj.nurbsSurface, dir);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = switchNurbsDirection(obj.nurbsCurve);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  alignNurbsSurfaces: (masterId, slaveId, edgeMaster = 'END', edgeSlave = 'START') => {
    const { project } = get();
    const masterObj = project.objects.find(o => o.id === masterId);
    const slaveObj = project.objects.find(o => o.id === slaveId);
    if (!masterObj?.nurbsSurface || !slaveObj?.nurbsSurface) return;

    try {
      // Compute transformation from slave local space to master local space
      const masterMat = new THREE.Matrix4().compose(
        new THREE.Vector3(...masterObj.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...masterObj.transform.rotation)),
        new THREE.Vector3(...masterObj.transform.scale)
      );
      const slaveMat = new THREE.Matrix4().compose(
        new THREE.Vector3(...slaveObj.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...slaveObj.transform.rotation)),
        new THREE.Vector3(...slaveObj.transform.scale)
      );
      const slaveToMaster = masterMat.clone().invert().multiply(slaveMat);

      // Clone and transform slave points into master coordinates
      const transformedSlave: NurbsSurfaceData = {
        ...slaveObj.nurbsSurface,
        controlPoints: slaveObj.nurbsSurface.controlPoints.map(row =>
          row.map(cp => {
            const pt = new THREE.Vector3(...cp.point).applyMatrix4(slaveToMaster);
            return { ...cp, point: [pt.x, pt.y, pt.z] as [number, number, number] };
          })
        )
      };

      const { master: alignedMaster, slave: alignedSlave } = alignSurfacesG0Auto(masterObj.nurbsSurface, transformedSlave);
      
      // Transform slave back to its local coordinate space so its object transform remains valid
      const masterToSlave = slaveToMaster.clone().invert();
      const finalSlave: NurbsSurfaceData = {
        ...alignedSlave,
        controlPoints: alignedSlave.controlPoints.map(row =>
          row.map(cp => {
            const pt = new THREE.Vector3(...cp.point).applyMatrix4(masterToSlave);
            return { ...cp, point: [pt.x, pt.y, pt.z] as [number, number, number] };
          })
        )
      };

      const geom = tessellateNurbsSurface(
        finalSlave,
        slaveObj.parameters.nurbsResolutionU ?? 16,
        slaveObj.parameters.nurbsResolutionV ?? 16
      );

      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === slaveId
              ? {
                  ...o,
                  nurbsSurface: finalSlave,
                  parameters: { ...o.parameters, nurbsSurface: finalSlave },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
      get().saveHistory();
    } catch (err: any) {
      console.warn("NURBS align error:", err.message);
    }
  },

  mergeNurbsSurfaces: (masterId, slaveId) => {
    const { project } = get();
    const masterObj = project.objects.find(o => o.id === masterId);
    const slaveObj = project.objects.find(o => o.id === slaveId);
    if (!masterObj?.nurbsSurface || !slaveObj?.nurbsSurface) return;

    try {
      // Compute transformation from slave local space to master local space
      const masterMat = new THREE.Matrix4().compose(
        new THREE.Vector3(...masterObj.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...masterObj.transform.rotation)),
        new THREE.Vector3(...masterObj.transform.scale)
      );
      const slaveMat = new THREE.Matrix4().compose(
        new THREE.Vector3(...slaveObj.transform.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...slaveObj.transform.rotation)),
        new THREE.Vector3(...slaveObj.transform.scale)
      );
      const slaveToMaster = masterMat.clone().invert().multiply(slaveMat);

      // Clone and transform slave points into master coordinates
      const transformedSlave: NurbsSurfaceData = {
        ...slaveObj.nurbsSurface,
        controlPoints: slaveObj.nurbsSurface.controlPoints.map(row =>
          row.map(cp => {
            const pt = new THREE.Vector3(...cp.point).applyMatrix4(slaveToMaster);
            return { ...cp, point: [pt.x, pt.y, pt.z] as [number, number, number] };
          })
        )
      };

      const { master: alignedMaster, slave: alignedSlave } = alignSurfacesG0Auto(masterObj.nurbsSurface, transformedSlave);
      const mergedSurface = mergeSurfacesU(alignedMaster, alignedSlave);
      const resU = (masterObj.parameters.nurbsResolutionU ?? 16) + (slaveObj.parameters.nurbsResolutionU ?? 16);
      const resV = masterObj.parameters.nurbsResolutionV ?? 16;
      const geom = tessellateNurbsSurface(mergedSurface, resU, resV);

      const mergedObj: CSGObject = {
        ...masterObj,
        name: `${masterObj.name} + ${slaveObj.name} (Fusión)`,
        nurbsSurface: mergedSurface,
        parameters: { ...masterObj.parameters, nurbsSurface: mergedSurface, nurbsResolutionU: resU, nurbsResolutionV: resV },
        vertices: geom.vertices,
        faces: geom.faces,
        selectedNurbsControlPoint: null,
        selectedNurbsControlPoints: []
      };

      set({
        project: {
          ...project,
          objects: project.objects.map(o => o.id === masterId ? mergedObj : o).filter(o => o.id !== slaveId)
        },
        selectedObjectId: masterId,
        selectedObjectIds: [masterId]
      });
      get().saveHistory();
    } catch (err: any) {
      console.warn("NURBS merge error:", err.message);
    }
  },

  convertNurbsToMesh: (id) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    // Convert into a baked standard polygon mesh (MESH)
    set({
      project: {
        ...project,
        objects: project.objects.map(o =>
          o.id === id
            ? {
                ...o,
                type: 'MESH',
                name: `${o.name} (Malla)`,
                isNurbs: false,
                nurbsCurve: undefined,
                nurbsSurface: undefined,
                parameters: { ...o.parameters, nurbsCurve: undefined, nurbsSurface: undefined },
                selectedNurbsControlPoint: null,
              }
            : o
        )
      }
    });
    get().saveHistory();
  },

  setNurbsDegree: (id, degreeU, degreeV) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const surface: NurbsSurfaceData = {
        ...obj.nurbsSurface,
        degreeU: Math.max(1, degreeU),
        degreeV: Math.max(1, degreeV ?? degreeU),
      };
      const geom = tessellateNurbsSurface(surface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: surface, parameters: { ...o.parameters, nurbsSurface: surface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const curve: NurbsCurveData = {
        ...obj.nurbsCurve,
        degree: Math.max(1, degreeU),
      };
      const geom = tessellateNurbsCurveToMesh(curve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: curve, parameters: { ...o.parameters, nurbsCurve: curve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  setNurbsResolution: (id, resU, resV) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const u = Math.max(3, resU);
      const v = Math.max(3, resV ?? u);
      const surface: NurbsSurfaceData = {
        ...obj.nurbsSurface,
        resolutionU: u,
        resolutionV: v,
      };
      const geom = tessellateNurbsSurface(surface, u, v);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsSurface: surface,
                  parameters: { ...o.parameters, nurbsSurface: surface, nurbsResolutionU: u, nurbsResolutionV: v },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const segs = Math.max(8, resU);
      const geom = tessellateNurbsCurveToMesh(obj.nurbsCurve, segs, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  parameters: { ...o.parameters, segments: segs },
                  vertices: geom.vertices,
                  faces: geom.faces,
                }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  updateNurbsControlPointAttributes: (id: string, uIndex: number, vIndex?: number, attrs?: { point?: V3; weight?: number; radius?: number; tilt?: number }) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const surface = { ...obj.nurbsSurface };
      const grid = surface.controlPoints.map(row => row.map(cp => ({ ...cp, point: [...cp.point] as V3 })));
      const v = vIndex ?? 0;
      if (grid[uIndex] && grid[uIndex][v]) {
        if (attrs?.point) grid[uIndex][v].point = attrs.point;
        if (attrs?.weight !== undefined) grid[uIndex][v].weight = Math.max(0.01, attrs.weight);
        if (attrs?.radius !== undefined) grid[uIndex][v].radius = Math.max(0.01, attrs.radius);
        if (attrs?.tilt !== undefined) grid[uIndex][v].tilt = attrs.tilt;
      }
      surface.controlPoints = grid;
      const geom = tessellateNurbsSurface(surface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsSurface: surface,
                  parameters: { ...o.parameters, nurbsSurface: surface },
                  vertices: geom.vertices,
                  faces: geom.faces,
                  selectedNurbsControlPoint: { u: uIndex, v },
                }
              : o
          )
        }
      });
    } else if (obj.nurbsCurve) {
      const curve = { ...obj.nurbsCurve };
      const pts = curve.controlPoints.map(cp => ({ ...cp, point: [...cp.point] as V3 }));
      if (pts[uIndex]) {
        if (attrs?.point) pts[uIndex].point = attrs.point;
        if (attrs?.weight !== undefined) pts[uIndex].weight = Math.max(0.01, attrs.weight);
        if (attrs?.radius !== undefined) pts[uIndex].radius = Math.max(0.01, attrs.radius);
        if (attrs?.tilt !== undefined) pts[uIndex].tilt = attrs.tilt;
      }
      curve.controlPoints = pts;
      const geom = tessellateNurbsCurveToMesh(curve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? {
                  ...o,
                  nurbsCurve: curve,
                  parameters: { ...o.parameters, nurbsCurve: curve },
                  vertices: geom.vertices,
                  faces: geom.faces,
                  selectedNurbsControlPoint: { u: uIndex },
                }
              : o
          )
        }
      });
    }
  },

  setNurbsOrderAction: (id: string, orderU: number, orderV?: number) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = setNurbsOrder(obj.nurbsSurface, orderU, orderV);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = setNurbsOrder(obj.nurbsCurve, orderU);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  toggleNurbsEndpointAction: (id: string, dir: 'U' | 'V' = 'U') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = toggleNurbsEndpoint(obj.nurbsSurface, dir);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = toggleNurbsEndpoint(obj.nurbsCurve, dir);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  toggleNurbsCyclicAction: (id: string, dir: 'U' | 'V' = 'U') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = toggleNurbsCyclic(obj.nurbsSurface, dir);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = toggleNurbsCyclic(obj.nurbsCurve, dir);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  setNurbsKnotTypeAction: (id: string, knotType: NurbsKnotType, dir: 'U' | 'V' = 'U') => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = setNurbsKnotType(obj.nurbsSurface, knotType, dir);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = setNurbsKnotType(obj.nurbsCurve, knotType, dir);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  smoothNurbsObject: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = smoothNurbsSurface(obj.nurbsSurface, 0.5);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = smoothNurbsCurve(obj.nurbsCurve, 0.5);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  resetNurbsWeightsObject: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = resetNurbsWeights(obj.nurbsSurface);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = resetNurbsWeights(obj.nurbsCurve);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },

  resetNurbsTiltsAndRadiiObject: (id: string) => {
    const { project } = get();
    const obj = project.objects.find(o => o.id === id);
    if (!obj) return;

    if (obj.nurbsSurface) {
      const newSurface = resetNurbsTiltsAndRadii(obj.nurbsSurface);
      const geom = tessellateNurbsSurface(newSurface, obj.parameters.nurbsResolutionU ?? 16, obj.parameters.nurbsResolutionV ?? 16);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsSurface: newSurface, parameters: { ...o.parameters, nurbsSurface: newSurface }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    } else if (obj.nurbsCurve) {
      const newCurve = resetNurbsTiltsAndRadii(obj.nurbsCurve);
      const geom = tessellateNurbsCurveToMesh(newCurve, obj.parameters.segments ?? 32, obj.parameters.radius ?? 0.03);
      set({
        project: {
          ...project,
          objects: project.objects.map(o =>
            o.id === id
              ? { ...o, nurbsCurve: newCurve, parameters: { ...o.parameters, nurbsCurve: newCurve }, vertices: geom.vertices, faces: geom.faces }
              : o
          )
        }
      });
      get().saveHistory();
    }
  },
}));