import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Grid,
  Download,
  Sliders,
  Sparkles,
  RefreshCw,
  Box,
  Activity,
  Check,
  Upload,
  Paintbrush,
  Columns,
  Square,
  Play,
  Pause,
  Focus,
  Info,
  MousePointer,
  Scissors,
  Package,
  Palette,
  Layers2,
  Crosshair,
  Target,
  Maximize2,
  Eye
} from 'lucide-react';
import type { MeshFace, V3, MaterialData, BlueprintViewKey } from '../types';
import {
  smartUVProject,
  cylinderSphereUVProject,
  boxTriplanarUVProject,
  lightmapPack,
  unfoldCardboardBoxNet,
  extractUVIslands,
  transformSingleUVIsland,
  straightenUVIsland,
  packAllIslandsIntoTextureTile,
  UVIslandInfo,
  transformUVCoordinates,
  calculateUVDistortionHeatmap,
  generateCheckerboardPattern,
  exportUVLayoutDataUrl,
  projectFacesFromOrthogonalView,
  fitUVIslandToTileBounds
} from '../utils/uvUnwrap';

export interface UVMappingStudioProps {
  mesh: { vertices: V3[]; faces: MeshFace[] };
  onUpdateMeshUVs: (updatedFaces: MeshFace[]) => void;
  blueprintImages?: Partial<Record<BlueprintViewKey, string | null>>;
  activeTextureUrl?: string | null;
  activeMaterial?: MaterialData | null;
  atlasTextureUrl?: string | null;
  title?: string;
  isEmbedded?: boolean;
}

export type UnwrapMode = 'cardboard' | 'cardboard_staging' | 'smart' | 'cylinder' | 'box' | 'sphere' | 'lightmap';
export type ViewLayoutMode = 'split' | '2d' | '3d';
export type ActiveTabKey = 'unwrap' | 'islands' | 'transform' | 'inspector';
export type SelectionMode = 'face' | 'island';

export const UVMappingStudio: React.FC<UVMappingStudioProps> = ({
  mesh,
  onUpdateMeshUVs,
  blueprintImages,
  activeTextureUrl,
  atlasTextureUrl,
  title = 'Estudio de Desenvolvimiento UV & Desarme',
  isEmbedded = false
}) => {
  // ── MODO DE DISPOSICIÓN VISUAL (SPLIT 2D+3D, SOLO 2D, SOLO 3D) ──
  const [layoutMode, setLayoutMode] = useState<ViewLayoutMode>('split');
  const [rightPanelTab, setRightPanelTab] = useState<ActiveTabKey>('unwrap');

  // ── MODO DE SELECCIÓN (CARA VS ISLA COMPLETA) ──
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('island');
  const [selectedIslandId, setSelectedIslandId] = useState<number | null>(null);
  const [hoveredIslandId, setHoveredIslandId] = useState<number | null>(null);
  const [colorIslands, setColorIslands] = useState<boolean>(true);

  // ── ESTADOS DE TRANSFORMACIÓN UV GLOBAL ──
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [scaleX, setScaleX] = useState<number>(1.0);
  const [scaleY, setScaleY] = useState<number>(1.0);
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [flipH, setFlipH] = useState<boolean>(false);
  const [flipV, setFlipV] = useState<boolean>(false);
  const [repeatX] = useState<number>(1);
  const [repeatY] = useState<number>(1);

  // ── ESTADOS DE DESENVUELTO AUTOMÁTICO ──
  const [unwrapMode, setUnwrapMode] = useState<UnwrapMode>('cardboard');
  const [smartAngleLimit] = useState<number>(66);
  const [islandMargin, setIslandMargin] = useState<number>(0.03);
  const [relaxIterations] = useState<number>(5);

  // ── ESTADOS DE VISUALIZACIÓN Y TEXTURA ──
  const [activeOverlaySource, setActiveOverlaySource] = useState<
    'front' | 'top' | 'side' | 'atlas' | 'material' | 'checker16' | 'checker32' | 'custom' | 'none'
  >(() => {
    if (atlasTextureUrl) return 'atlas';
    if (blueprintImages?.front) return 'front';
    if (activeTextureUrl) return 'material';
    return 'checker16';
  });
  const [customTextureUrl, setCustomTextureUrl] = useState<string | null>(null);
  const [textureOpacity, setTextureOpacity] = useState<number>(0.85);
  const [wireframeColor] = useState<string>('#38bdf8');
  const [wireframeFill] = useState<boolean>(true);
  const [showVertices, setShowVertices] = useState<boolean>(false);
  const [showDistortionHeatmap, setShowDistortionHeatmap] = useState<boolean>(false);
  const [showGridCoordinates, setShowGridCoordinates] = useState<boolean>(true);

  // ── ESTADOS DEL VISOR 2D INTERACTIVO (CANVAS DUAL: ESPERA [-1,0] + ATLAS [0,1]) ──
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewTransform, setViewTransform] = useState({ zoom: 0.95, panX: 60, panY: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingIsland, setIsDraggingIsland] = useState(false);
  const [dragStartUV, setDragStartUV] = useState<{ u: number; v: number }>({ u: 0, v: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [cursorUV, setCursorUV] = useState<{ u: number; v: number } | null>(null);
  const [hoveredFaceIndex, setHoveredFaceIndex] = useState<number | null>(null);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // ── ESTADOS DEL VISOR 3D INTERACTIVO (THREE.JS) ──
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const mesh3DRef = useRef<THREE.Mesh | null>(null);
  const highlightMeshRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseVecRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const faceMap3DToFaceIndexRef = useRef<number[]>([]);
  const [wireframe3D, setWireframe3D] = useState<boolean>(false);
  const [autoRotate3D, setAutoRotate3D] = useState<boolean>(false);

  // Caché de imágenes cargadas para el fondo
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

  // ── Malla base y caras actuales con UVs ──
  const [currentFaces, setCurrentFaces] = useState<MeshFace[]>(() => {
    return mesh.faces.map(f => ({
      ...f,
      uvs: f.uvs && f.uvs.length >= 3
        ? f.uvs.map(uv => [uv[0], uv[1]] as [number, number])
        : f.indices.map(() => [0, 0] as [number, number])
    }));
  });

  // Sincronizar caras si la malla exterior cambia
  useEffect(() => {
    setCurrentFaces(mesh.faces.map(f => ({
      ...f,
      uvs: f.uvs && f.uvs.length >= 3
        ? f.uvs.map(uv => [uv[0], uv[1]] as [number, number])
        : f.indices.map(() => [0, 0] as [number, number])
    })));
  }, [mesh.faces]);

  // ── EXTRACCIÓN REACTIVA DE ISLAS UV ──
  const islands = useMemo<UVIslandInfo[]>(() => {
    return extractUVIslands(currentFaces, mesh.vertices);
  }, [currentFaces, mesh.vertices]);

  // Mapa de cara -> ID de isla
  const faceToIslandMap = useMemo(() => {
    const map = new Map<number, number>();
    islands.forEach(isl => {
      isl.faceIndices.forEach(fIdx => {
        map.set(fIdx, isl.islandId);
      });
    });
    return map;
  }, [islands]);

  // Isla activa seleccionada
  const activeIsland = useMemo(() => {
    if (selectedIslandId === null) return null;
    return islands.find(isl => isl.islandId === selectedIslandId) || null;
  }, [islands, selectedIslandId]);

  // Precargar texturas y tableros
  useEffect(() => {
    const urlsToLoad: Record<string, string> = {};

    if (blueprintImages?.front) urlsToLoad.front = blueprintImages.front;
    if (blueprintImages?.top) urlsToLoad.top = blueprintImages.top;
    if (blueprintImages?.side) urlsToLoad.side = blueprintImages.side;
    if (atlasTextureUrl) urlsToLoad.atlas = atlasTextureUrl;
    if (activeTextureUrl) urlsToLoad.material = activeTextureUrl;
    if (customTextureUrl) urlsToLoad.custom = customTextureUrl;

    urlsToLoad.checker16 = generateCheckerboardPattern(16, '#18181b', '#f4f4f5', '#6366f1');
    urlsToLoad.checker32 = generateCheckerboardPattern(32, '#09090b', '#e4e4e7', '#06b6d4');

    const newMap: Record<string, HTMLImageElement> = {};
    let pending = Object.keys(urlsToLoad).length;
    if (pending === 0) return;

    Object.entries(urlsToLoad).forEach(([key, url]) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        newMap[key] = img;
        pending--;
        if (pending === 0) {
          setLoadedImages(prev => ({ ...prev, ...newMap }));
        }
      };
      img.onerror = () => {
        pending--;
      };
      img.src = url;
    });
  }, [blueprintImages, activeTextureUrl, atlasTextureUrl, customTextureUrl]);

  // ── CÁLCULO DE DISTORSIÓN Y ESTADÍSTICAS UV ──
  const distortionStats = useMemo(() => {
    return calculateUVDistortionHeatmap(mesh.vertices, currentFaces);
  }, [mesh.vertices, currentFaces]);

  const uvCoveragePercent = useMemo(() => {
    let totalUVArea = 0;
    currentFaces.forEach(f => {
      if (f.uvs && f.uvs.length >= 3) {
        let a = 0;
        for (let i = 0; i < f.uvs.length; i++) {
          const [u1, v1] = f.uvs[i];
          const [u2, v2] = f.uvs[(i + 1) % f.uvs.length];
          if (u1 >= 0 && u1 <= 1.0 && v1 >= 0 && v1 <= 1.0) {
            a += (u1 * v2 - u2 * v1);
          }
        }
        totalUVArea += Math.abs(a) * 0.5;
      }
    });
    return Math.min(100, Math.round(totalUVArea * 100));
  }, [currentFaces]);

  // ── NOTIFICACIÓN TEMPORIZADA ──
  const triggerNotification = useCallback((msg: string) => {
    setNotification(msg);
    const t = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(t);
  }, []);

  // ── TRANSFORMACIONES REACTIVAS GLOBALES ──
  const applyTransforms = useCallback((
    newOffX: number,
    newOffY: number,
    newScaleX: number,
    newScaleY: number,
    newRot: number,
    newFlipH: boolean,
    newFlipV: boolean,
    newRepX: number,
    newRepY: number
  ) => {
    const transformed = transformUVCoordinates(currentFaces, {
      offsetX: newOffX,
      offsetY: newOffY,
      scaleX: newScaleX,
      scaleY: newScaleY,
      rotationDeg: newRot,
      flipH: newFlipH,
      flipV: newFlipV,
      repeatX: newRepX,
      repeatY: newRepY
    });
    setCurrentFaces(transformed);
    onUpdateMeshUVs(transformed);
  }, [currentFaces, onUpdateMeshUVs]);

  // ── DESENVUELTOS AUTOMÁTICOS ──
  const handleExecuteUnwrap = useCallback((mode: UnwrapMode) => {
    setUnwrapMode(mode);
    let resultFaces: MeshFace[] = [];

    switch (mode) {
      case 'cardboard': {
        const unwrapped = unfoldCardboardBoxNet({ vertices: mesh.vertices, faces: currentFaces }, {
          targetZone: 'ATLAS',
          margin: islandMargin
        });
        resultFaces = unwrapped.faces;
        triggerNotification('📦 Malla desarmada como caja de cartón plana (Box Net) en Atlas [0, 1]');
        break;
      }
      case 'cardboard_staging': {
        const unwrapped = unfoldCardboardBoxNet({ vertices: mesh.vertices, faces: currentFaces }, {
          targetZone: 'STAGING',
          margin: islandMargin
        });
        resultFaces = unwrapped.faces;
        triggerNotification('🧩 Malla desdoblada en Zona de Espera [-1, 0] lista para pintar');
        break;
      }
      case 'smart': {
        const unwrapped = smartUVProject({ vertices: mesh.vertices, faces: currentFaces }, {
          angleThresholdDeg: smartAngleLimit,
          islandMargin: islandMargin,
          relaxIterations: relaxIterations,
          correctAspect: true,
          scaleToFit: true
        });
        resultFaces = unwrapped.faces;
        triggerNotification(`✓ Smart UV Project por islas (${smartAngleLimit}°) aplicado`);
        break;
      }
      case 'cylinder': {
        const unwrapped = cylinderSphereUVProject({ vertices: mesh.vertices, faces: currentFaces }, 'CYLINDRICAL');
        resultFaces = unwrapped.faces;
        triggerNotification('✓ Despliegue Cilíndrico con tapas independientes aplicado');
        break;
      }
      case 'box': {
        const unwrapped = boxTriplanarUVProject({ vertices: mesh.vertices, faces: currentFaces }, 1.0);
        resultFaces = unwrapped.faces;
        triggerNotification('✓ Proyección Cúbica / Triplanar 6 caras aplicada');
        break;
      }
      case 'sphere': {
        const unwrapped = cylinderSphereUVProject({ vertices: mesh.vertices, faces: currentFaces }, 'SPHERICAL');
        resultFaces = unwrapped.faces;
        triggerNotification('✓ Proyección Esférica 360° aplicada');
        break;
      }
      case 'lightmap': {
        const unwrapped = lightmapPack({ vertices: mesh.vertices, faces: currentFaces }, islandMargin);
        resultFaces = unwrapped.faces;
        triggerNotification('✓ Empaquetado Lightmap de caras separadas aplicado');
        break;
      }
      default:
        return;
    }

    if (resultFaces.length > 0) {
      setOffsetX(0);
      setOffsetY(0);
      setScaleX(1.0);
      setScaleY(1.0);
      setRotationDeg(0);
      setFlipH(false);
      setFlipV(false);
      setCurrentFaces(resultFaces);
      onUpdateMeshUVs(resultFaces);
    }
  }, [mesh.vertices, currentFaces, smartAngleLimit, islandMargin, relaxIterations, onUpdateMeshUVs, triggerNotification]);

  // ── OPERACIONES POR ISLA ESPECÍFICA ──
  const handleTransformSelectedIsland = useCallback((options: {
    deltaU?: number;
    deltaV?: number;
    rotationDeg?: number;
    scaleFactor?: number;
    flipH?: boolean;
    flipV?: boolean;
    snapToStaging?: boolean;
    snapToAtlas?: boolean;
  }) => {
    if (!activeIsland) {
      triggerNotification('⚠️ Selecciona primero una isla para transformar');
      return;
    }

    const updated = transformSingleUVIsland(currentFaces, activeIsland.faceIndices, options);
    setCurrentFaces(updated);
    onUpdateMeshUVs(updated);

    if (options.snapToStaging) {
      triggerNotification(`🚚 Isla #${activeIsland.islandId} enviada al Área de Espera [-1, 0]`);
    } else if (options.snapToAtlas) {
      triggerNotification(`📦 Isla #${activeIsland.islandId} colocada en el Lienzo Atlas [0, 1]`);
    } else if (options.rotationDeg) {
      triggerNotification(`↺ Isla #${activeIsland.islandId} rotada ${options.rotationDeg}°`);
    } else {
      triggerNotification(`✓ Isla #${activeIsland.islandId} transformada`);
    }
  }, [activeIsland, currentFaces, onUpdateMeshUVs, triggerNotification]);

  const handleStraightenSelectedIsland = useCallback(() => {
    if (!activeIsland) return;
    const updated = straightenUVIsland(currentFaces, activeIsland.faceIndices);
    setCurrentFaces(updated);
    onUpdateMeshUVs(updated);
    triggerNotification(`📐 Isla #${activeIsland.islandId} enderezada a la cuadrícula`);
  }, [activeIsland, currentFaces, onUpdateMeshUVs, triggerNotification]);

  const handlePackAllIslands = useCallback(() => {
    const updated = packAllIslandsIntoTextureTile({ vertices: mesh.vertices, faces: currentFaces }, islandMargin);
    setCurrentFaces(updated.faces);
    onUpdateMeshUVs(updated.faces);
    triggerNotification('🚀 Todas las islas empaquetadas en el lienzo [0, 1] (Smart Pack)');
  }, [mesh.vertices, currentFaces, islandMargin, onUpdateMeshUVs, triggerNotification]);

  // ── ALINEACIONES RÁPIDAS Y PROYECCIONES DIRECTAS (PROJECT FROM VIEW) ──
  const handleProjectFromView = useCallback((
    plane: 'XY' | 'XZ' | 'ZY' | 'FIT_BOUNDS' | 'FLIP_U' | 'FLIP_V' | 'ROTATE_90' | 'RESET',
    scope: 'ALL' | 'SELECTED_ISLAND' = 'ALL'
  ) => {
    const verts = mesh.vertices;
    if (!verts || verts.length === 0) return;

    const targetIndices = scope === 'SELECTED_ISLAND' && activeIsland
      ? activeIsland.faceIndices
      : 'ALL';

    if (plane === 'RESET') {
      setOffsetX(0);
      setOffsetY(0);
      setScaleX(1);
      setScaleY(1);
      setRotationDeg(0);
      setFlipH(false);
      setFlipV(false);
      const resetFaces = boxTriplanarUVProject({ vertices: mesh.vertices, faces: currentFaces }, 1.0).faces;
      setCurrentFaces(resetFaces);
      onUpdateMeshUVs(resetFaces);
      triggerNotification('✓ Coordenadas UV restablecidas a cubo estándar');
      return;
    }

    if (plane === 'FIT_BOUNDS') {
      const targetList = scope === 'SELECTED_ISLAND' && activeIsland
        ? activeIsland.faceIndices
        : currentFaces.map((_, i) => i);
      const updated = fitUVIslandToTileBounds(currentFaces, targetList, { minU: 0.03, maxU: 0.97, minV: 0.03, maxV: 0.97 }, true);
      setCurrentFaces(updated);
      onUpdateMeshUVs(updated);
      triggerNotification('🎯 UVs ajustadas al 100% del área de textura (Proporción 1:1)');
      return;
    }

    if (plane === 'FLIP_U') {
      const targetList = scope === 'SELECTED_ISLAND' && activeIsland ? activeIsland.faceIndices : currentFaces.map((_, i) => i);
      const updated = transformSingleUVIsland(currentFaces, targetList, { flipH: true });
      setCurrentFaces(updated);
      onUpdateMeshUVs(updated);
      triggerNotification('↔ Invertido horizontalmente (Flip U)');
      return;
    }

    if (plane === 'FLIP_V') {
      const targetList = scope === 'SELECTED_ISLAND' && activeIsland ? activeIsland.faceIndices : currentFaces.map((_, i) => i);
      const updated = transformSingleUVIsland(currentFaces, targetList, { flipV: true });
      setCurrentFaces(updated);
      onUpdateMeshUVs(updated);
      triggerNotification('↕ Invertido verticalmente (Flip V)');
      return;
    }

    if (plane === 'ROTATE_90') {
      const targetList = scope === 'SELECTED_ISLAND' && activeIsland ? activeIsland.faceIndices : currentFaces.map((_, i) => i);
      const updated = transformSingleUVIsland(currentFaces, targetList, { rotationDeg: 90 });
      setCurrentFaces(updated);
      onUpdateMeshUVs(updated);
      triggerNotification('🔄 Girado +90°');
      return;
    }

    const viewPlaneKey = plane === 'XZ' ? 'TOP_XZ' : plane === 'XY' ? 'FRONT_XY' : 'SIDE_ZY';
    const projected = projectFacesFromOrthogonalView(verts, currentFaces, targetIndices, viewPlaneKey, {
      preserveAspect: true,
      padding: 0.03
    });

    setCurrentFaces(projected);
    onUpdateMeshUVs(projected);

    const names = { XY: 'Frontal (XY)', XZ: 'Superior (XZ)', ZY: 'Lateral (ZY)' };
    const scopeName = scope === 'SELECTED_ISLAND' && activeIsland ? `Isla #${activeIsland.islandId}` : 'toda la malla';
    triggerNotification(`🎯 Proyección 1:1 desde vista ${names[plane]} aplicada a ${scopeName}`);
  }, [mesh.vertices, currentFaces, activeIsland, onUpdateMeshUVs, triggerNotification]);

  // ── INICIALIZACIÓN DEL VISOR 3D (THREE.JS + ORBIT CONTROLS + RAYCASTING) ──
  useEffect(() => {
    const container = threeContainerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#09090b');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.01, 1000);
    camera.position.set(2.2, 1.6, 2.8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.2;
    controls.maxDistance = 20;
    controlsRef.current = controls;

    // Iluminación
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight1.position.set(5, 10, 7);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.6);
    dirLight2.position.set(-5, -3, -5);
    scene.add(dirLight2);

    const grid = new THREE.GridHelper(4, 20, 0x6366f1, 0x27272a);
    grid.position.y = -0.001;
    scene.add(grid);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controlsRef.current) {
        controlsRef.current.autoRotate = autoRotate3D;
        controlsRef.current.autoRotateSpeed = 2.0;
        controlsRef.current.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !cameraRef.current || !rendererRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / Math.max(1, h);
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement) {
        container.innerHTML = '';
      }
    };
  }, []);

  // ── ACTUALIZACIÓN DE GEOMETRÍA Y MATERIAL EN EL VISOR 3D ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !mesh.vertices || mesh.vertices.length === 0 || currentFaces.length === 0) return;

    if (mesh3DRef.current) {
      scene.remove(mesh3DRef.current);
      mesh3DRef.current.geometry.dispose();
      if (Array.isArray(mesh3DRef.current.material)) {
        mesh3DRef.current.material.forEach(m => m.dispose());
      } else {
        mesh3DRef.current.material.dispose();
      }
      mesh3DRef.current = null;
    }

    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const vertMap = new Map<string, number>();
    const faceMap3DToFaceIndex: number[] = [];

    currentFaces.forEach((face, fIdx) => {
      if (!face.indices || face.indices.length < 3) return;
      const faceVertIndices: number[] = [];

      // Determine face color if island color coding is active
      const islId = faceToIslandMap.get(fIdx);
      const isl = islId !== undefined ? islands[islId] : null;
      let faceColor = new THREE.Color(0xffffff);
      if (colorIslands && isl) {
        faceColor = new THREE.Color(isl.color);
      }

      face.indices.forEach((posIdx, i) => {
        const uv = face.uvs?.[i] || [0.5, 0.5];
        const key = `${posIdx}_${uv[0].toFixed(4)}_${uv[1].toFixed(4)}`;
        if (vertMap.has(key)) {
          faceVertIndices.push(vertMap.get(key)!);
        } else {
          const newIdx = positions.length / 3;
          const v = mesh.vertices[posIdx] || [0, 0, 0];
          positions.push(v[0], v[1], v[2]);
          uvs.push(uv[0], uv[1]);
          colors.push(faceColor.r, faceColor.g, faceColor.b);
          vertMap.set(key, newIdx);
          faceVertIndices.push(newIdx);
        }
      });

      if (faceVertIndices.length === 3) {
        indices.push(faceVertIndices[0], faceVertIndices[1], faceVertIndices[2]);
        faceMap3DToFaceIndex.push(fIdx);
      } else if (faceVertIndices.length === 4) {
        indices.push(faceVertIndices[0], faceVertIndices[1], faceVertIndices[2]);
        faceMap3DToFaceIndex.push(fIdx);
        indices.push(faceVertIndices[0], faceVertIndices[2], faceVertIndices[3]);
        faceMap3DToFaceIndex.push(fIdx);
      } else {
        for (let i = 1; i < faceVertIndices.length - 1; i++) {
          indices.push(faceVertIndices[0], faceVertIndices[i], faceVertIndices[i + 1]);
          faceMap3DToFaceIndex.push(fIdx);
        }
      }
    });

    faceMap3DToFaceIndexRef.current = faceMap3DToFaceIndex;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (indices.length > 0) {
      geo.setIndex(indices);
    }
    geo.computeVertexNormals();

    const overlayImg = loadedImages[activeOverlaySource];
    let texture: THREE.CanvasTexture | THREE.Texture | null = null;

    if (overlayImg && activeOverlaySource !== 'none') {
      texture = new THREE.CanvasTexture(overlayImg);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 16;
      texture.needsUpdate = true;
    }

    const material = new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : (colorIslands ? 0xffffff : 0x4f46e5),
      vertexColors: colorIslands && !texture,
      map: texture,
      roughness: 0.35,
      metalness: 0.1,
      wireframe: wireframe3D,
      side: THREE.DoubleSide
    });

    const mesh3D = new THREE.Mesh(geo, material);
    scene.add(mesh3D);
    mesh3DRef.current = mesh3D;

    geo.computeBoundingBox();
    if (geo.boundingBox) {
      mesh3D.position.y = -geo.boundingBox.min.y;
    }
  }, [mesh.vertices, currentFaces, loadedImages, activeOverlaySource, wireframe3D, colorIslands, faceToIslandMap, islands]);

  // ── RESALTADO DE CARA O ISLA ACTIVA EN 3D ──
  const activeHighlightIndex = hoveredFaceIndex !== null ? hoveredFaceIndex : selectedFaceIndex;
  const activeHighlightIslandId = hoveredIslandId !== null ? hoveredIslandId : selectedIslandId;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !mesh.vertices) return;

    if (highlightMeshRef.current) {
      scene.remove(highlightMeshRef.current);
      highlightMeshRef.current.geometry.dispose();
      highlightMeshRef.current = null;
    }

    let targetFaceIndices: number[] = [];
    if (selectionMode === 'island' && activeHighlightIslandId !== null) {
      const isl = islands.find(i => i.islandId === activeHighlightIslandId);
      if (isl) targetFaceIndices = isl.faceIndices;
    } else if (activeHighlightIndex !== null) {
      targetFaceIndices = [activeHighlightIndex];
    }

    if (targetFaceIndices.length === 0) return;

    const hPositions: number[] = [];
    const hIndices: number[] = [];

    targetFaceIndices.forEach(fIdx => {
      const face = currentFaces[fIdx];
      if (!face || !face.indices || face.indices.length < 3) return;

      const baseIdx = hPositions.length / 3;
      face.indices.forEach(idx => {
        const v = mesh.vertices[idx];
        if (v) hPositions.push(v[0], v[1], v[2]);
      });

      for (let i = 1; i < face.indices.length - 1; i++) {
        hIndices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
      }
    });

    if (hPositions.length === 0) return;

    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.Float32BufferAttribute(hPositions, 3));
    hGeo.setIndex(hIndices);
    hGeo.computeVertexNormals();

    const hMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      wireframe: false,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthTest: false
    });

    const hMesh = new THREE.Mesh(hGeo, hMat);
    if (mesh3DRef.current) {
      hMesh.position.copy(mesh3DRef.current.position);
    }
    scene.add(hMesh);
    highlightMeshRef.current = hMesh;
  }, [activeHighlightIndex, activeHighlightIslandId, selectionMode, currentFaces, mesh.vertices, islands]);

  // ── RAYCASTING 3D: DETECCIÓN DE CARA / ISLA AL PASAR EL RATÓN SOBRE EL VISOR 3D ──
  const handleThreePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = threeContainerRef.current;
    const camera = cameraRef.current;
    const mesh3D = mesh3DRef.current;
    if (!container || !camera || !mesh3D) return;

    const rect = container.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    mouseVecRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseVecRef.current, camera);

    const intersects = raycasterRef.current.intersectObject(mesh3D, false);
    if (intersects.length > 0 && intersects[0].faceIndex !== undefined) {
      const triIdx = intersects[0].faceIndex;
      const meshFaceIdx = faceMap3DToFaceIndexRef.current[triIdx];
      if (meshFaceIdx !== undefined && meshFaceIdx >= 0) {
        setHoveredFaceIndex(meshFaceIdx);
        const islId = faceToIslandMap.get(meshFaceIdx) ?? null;
        setHoveredIslandId(islId);
        return;
      }
    }
    setHoveredFaceIndex(null);
    setHoveredIslandId(null);
  };

  const handleThreeClick = () => {
    if (hoveredFaceIndex !== null) {
      if (selectionMode === 'island') {
        const islId = faceToIslandMap.get(hoveredFaceIndex) ?? null;
        setSelectedIslandId(islId === selectedIslandId ? null : islId);
      } else {
        setSelectedFaceIndex(hoveredFaceIndex === selectedFaceIndex ? null : hoveredFaceIndex);
      }
    }
  };

  const handleResetCamera3D = () => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(2.2, 1.6, 2.8);
    controlsRef.current.target.set(0, 0.5, 0);
    controlsRef.current.update();
    triggerNotification('✓ Cámara 3D centrada');
  };

  const setCameraView = (view: 'TOP' | 'FRONT' | 'SIDE' | 'ISO') => {
    if (!cameraRef.current || !controlsRef.current) return;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    ctrl.target.set(0, 0.5, 0);
    if (view === 'TOP') {
      cam.position.set(0, 4.2, 0.001);
      triggerNotification('👁️ Vista Superior (XZ)');
    } else if (view === 'FRONT') {
      cam.position.set(0, 0.5, 3.8);
      triggerNotification('👁️ Vista Frontal (XY)');
    } else if (view === 'SIDE') {
      cam.position.set(3.8, 0.5, 0);
      triggerNotification('👁️ Vista Lateral (ZY)');
    } else if (view === 'ISO') {
      cam.position.set(2.2, 1.6, 2.8);
      triggerNotification('👁️ Vista Perspectiva Isométrica');
    }
    ctrl.update();
  };

  // ── RENDERIZADO DEL CANVAS 2D UV (ESPACIO DUAL: ESPERA [-1, 0] + TEXTURA [0, 1]) ──
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Fondo base
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    ctx.save();

    // Pan y Zoom
    ctx.translate(width / 2 + viewTransform.panX, height / 2 + viewTransform.panY);
    ctx.scale(viewTransform.zoom, viewTransform.zoom);
    ctx.translate(-width / 2, -height / 2);

    // Dimensiones de la casilla UV unitaria [0, 1]
    const uvTileSize = Math.min(width, height) * 0.72;
    const atlasOriginX = width / 2;
    const atlasOriginY = (height - uvTileSize) / 2;

    // Origen de la Zona de Espera [-1, 0]
    const stagingOriginX = atlasOriginX - uvTileSize;
    const stagingOriginY = atlasOriginY;

    // ─────────────────────────────────────────────────────────────
    // 1. ZONA DE ESPERA / DESARME [-1, 0] (Área Externa Izquierda)
    // ─────────────────────────────────────────────────────────────
    ctx.fillStyle = '#0c0e14';
    ctx.fillRect(stagingOriginX, stagingOriginY, uvTileSize, uvTileSize);

    // Cuadrícula en zona de espera
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      const pos = i * 0.1;
      const x = stagingOriginX + pos * uvTileSize;
      const y = stagingOriginY + pos * uvTileSize;

      ctx.beginPath();
      ctx.moveTo(x, stagingOriginY);
      ctx.lineTo(x, stagingOriginY + uvTileSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(stagingOriginX, y);
      ctx.lineTo(stagingOriginX + uvTileSize, y);
      ctx.stroke();
    }

    // Borde de la zona de espera
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(stagingOriginX, stagingOriginY, uvTileSize, uvTileSize);
    ctx.setLineDash([]);

    // Banner de la zona de espera
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🧩 ZONA DE DESARME & ESPERA  [-1.0, 0.0]', stagingOriginX + uvTileSize * 0.5, stagingOriginY - 8);

    // ─────────────────────────────────────────────────────────────
    // 2. LIENZO ATLAS ACTIVO [0, 1] (Área Derecha)
    // ─────────────────────────────────────────────────────────────
    ctx.fillStyle = '#121216';
    ctx.fillRect(atlasOriginX, atlasOriginY, uvTileSize, uvTileSize);

    // Textura de Fondo (Overlay) en [0, 1]
    const overlayImg = loadedImages[activeOverlaySource];
    if (overlayImg && activeOverlaySource !== 'none') {
      ctx.save();
      ctx.globalAlpha = textureOpacity;
      ctx.drawImage(overlayImg, atlasOriginX, atlasOriginY, uvTileSize, uvTileSize);
      ctx.restore();
    }

    // Cuadrícula en lienzo atlas
    if (showGridCoordinates) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;

      for (let i = 1; i < 10; i++) {
        const pos = i * 0.1;
        const x = atlasOriginX + pos * uvTileSize;
        const y = atlasOriginY + pos * uvTileSize;

        ctx.beginPath();
        ctx.moveTo(x, atlasOriginY);
        ctx.lineTo(x, atlasOriginY + uvTileSize);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(atlasOriginX, y);
        ctx.lineTo(atlasOriginX + uvTileSize, y);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
      ctx.lineWidth = 1.5;
      const midX = atlasOriginX + 0.5 * uvTileSize;
      const midY = atlasOriginY + 0.5 * uvTileSize;
      ctx.beginPath();
      ctx.moveTo(midX, atlasOriginY);
      ctx.lineTo(midX, atlasOriginY + uvTileSize);
      ctx.moveTo(atlasOriginX, midY);
      ctx.lineTo(atlasOriginX + uvTileSize, midY);
      ctx.stroke();

      ctx.restore();
    }

    // Marco del espacio [0, 1]
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(atlasOriginX, atlasOriginY, uvTileSize, uvTileSize);

    // Banner del Lienzo Atlas
    ctx.fillStyle = '#818cf8';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎨 LIENZO DE TEXTURA ACTIVA  [0.0, 1.0]', atlasOriginX + uvTileSize * 0.5, atlasOriginY - 8);

    // Línea divisoria central U = 0.0
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(atlasOriginX, atlasOriginY - 20);
    ctx.lineTo(atlasOriginX, atlasOriginY + uvTileSize + 20);
    ctx.stroke();

    // ─────────────────────────────────────────────────────────────
    // 3. POLÍGONOS DE LA MALLA UV (Soporta U en [-1, 1])
    // ─────────────────────────────────────────────────────────────
    currentFaces.forEach((face, fIdx) => {
      if (!face.uvs || face.uvs.length < 3) return;

      const islId = faceToIslandMap.get(fIdx);
      const isIslandHovered = hoveredIslandId !== null && islId === hoveredIslandId;
      const isIslandSelected = selectedIslandId !== null && islId === selectedIslandId;
      const isFaceHovered = hoveredFaceIndex === fIdx;
      const isFaceSelected = selectedFaceIndex === fIdx;

      const isHighlighted = (selectionMode === 'island' && (isIslandHovered || isIslandSelected)) ||
                            (selectionMode === 'face' && (isFaceHovered || isFaceSelected));

      ctx.beginPath();
      face.uvs.forEach(([u, v], idx) => {
        const x = atlasOriginX + u * uvTileSize;
        const y = atlasOriginY + (1.0 - v) * uvTileSize;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();

      // Relleno de polígono
      if (showDistortionHeatmap) {
        const dist = distortionStats.perFaceDistortion[fIdx] ?? 0.5;
        let r = 0, g = 255, b = 0;
        if (dist > 0.5) {
          const factor = (dist - 0.5) * 2.0;
          r = Math.round(255 * factor);
          g = Math.round(255 * (1.0 - factor * 0.7));
          b = 0;
        } else {
          const factor = (0.5 - dist) * 2.0;
          r = 0;
          g = Math.round(255 * (1.0 - factor * 0.5));
          b = Math.round(255 * factor);
        }
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${isHighlighted ? 0.75 : 0.32})`;
        ctx.fill();
      } else if (colorIslands && islId !== undefined && islands[islId]) {
        const islColor = islands[islId].color;
        ctx.fillStyle = isHighlighted ? 'rgba(251, 191, 36, 0.45)' : `${islColor}28`;
        ctx.fill();
      } else if (wireframeFill || isHighlighted) {
        ctx.fillStyle = isHighlighted ? 'rgba(245, 158, 11, 0.45)' : 'rgba(56, 189, 248, 0.08)';
        ctx.fill();
      }

      // Alambre
      if (colorIslands && islId !== undefined && islands[islId]) {
        ctx.strokeStyle = isHighlighted ? '#fbbf24' : islands[islId].color;
      } else {
        ctx.strokeStyle = isHighlighted ? '#fbbf24' : wireframeColor;
      }
      ctx.lineWidth = isHighlighted ? 2.5 : 1.0;
      ctx.stroke();

      // Vértices
      if (showVertices || isHighlighted) {
        ctx.fillStyle = isHighlighted ? '#f59e0b' : '#38bdf8';
        face.uvs.forEach(([u, v]) => {
          const vx = atlasOriginX + u * uvTileSize;
          const vy = atlasOriginY + (1.0 - v) * uvTileSize;
          ctx.beginPath();
          ctx.arc(vx, vy, isHighlighted ? 3.5 : 1.8, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 4. BORDES DE ISLAS SELECCIONADAS (Bounding Box)
    // ─────────────────────────────────────────────────────────────
    if (activeIsland && selectionMode === 'island') {
      const bx = atlasOriginX + activeIsland.minU * uvTileSize;
      const by = atlasOriginY + (1.0 - activeIsland.maxV) * uvTileSize;
      const bw = activeIsland.width * uvTileSize;
      const bh = activeIsland.height * uvTileSize;

      ctx.strokeStyle = '#fbbf24';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);

      // Etiqueta de la isla
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 11px system-ui, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `📦 Isla #${activeIsland.islandId} (${activeIsland.faceIndices.length} caras) ${activeIsland.isStaged ? '[En Espera]' : '[En Atlas]'}`,
        bx,
        by - 5
      );
    }

    // Coordenadas en esquinas de Atlas [0, 1]
    ctx.fillStyle = '#a5b4fc';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('0.0, 0.0', atlasOriginX + 4, atlasOriginY + uvTileSize - 6);
    ctx.fillText('1.0, 1.0', atlasOriginX + uvTileSize - 50, atlasOriginY + 14);
    ctx.fillText('0.0, 1.0', atlasOriginX + 4, atlasOriginY + 14);
    ctx.fillText('1.0, 0.0', atlasOriginX + uvTileSize - 50, atlasOriginY + uvTileSize - 6);

    // Coordenadas en esquinas de Espera [-1, 0]
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('-1.0, 0.0', stagingOriginX + 4, stagingOriginY + uvTileSize - 6);
    ctx.fillText('-1.0, 1.0', stagingOriginX + 4, stagingOriginY + 14);

    ctx.restore();
  }, [
    viewTransform,
    loadedImages,
    activeOverlaySource,
    textureOpacity,
    wireframeColor,
    wireframeFill,
    showVertices,
    showDistortionHeatmap,
    showGridCoordinates,
    currentFaces,
    hoveredFaceIndex,
    selectedFaceIndex,
    hoveredIslandId,
    selectedIslandId,
    activeIsland,
    selectionMode,
    colorIslands,
    faceToIslandMap,
    islands,
    distortionStats
  ]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(200, Math.floor(rect.width * dpr));
      const h = Math.max(200, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      renderCanvas();
    };

    handleResize();
    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [renderCanvas]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  // ── MANEJADORES DE RATÓN EN EL CANVAS 2D UV (ARRASTRE DE ISLAS + PAN + ZOOM) ──
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const uvTileSize = Math.min(width, height) * 0.72;
    const atlasOriginX = width / 2;
    const atlasOriginY = (height - uvTileSize) / 2;

    const canvasX = (clientX / rect.width) * width;
    const canvasY = (clientY / rect.height) * height;

    const localX = (canvasX - (width / 2 + viewTransform.panX)) / viewTransform.zoom + width / 2;
    const localY = (canvasY - (height / 2 + viewTransform.panY)) / viewTransform.zoom + height / 2;

    const u = (localX - atlasOriginX) / uvTileSize;
    const v = 1.0 - (localY - atlasOriginY) / uvTileSize;

    // Check if clicked inside an island
    if (selectionMode === 'island' && hoveredIslandId !== null) {
      setSelectedIslandId(hoveredIslandId);
      setIsDraggingIsland(true);
      setDragStartUV({ u, v });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    setIsPanning(true);
    setPanStart({ x: e.clientX - viewTransform.panX, y: e.clientY - viewTransform.panY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const uvTileSize = Math.min(width, height) * 0.72;
    const atlasOriginX = width / 2;
    const atlasOriginY = (height - uvTileSize) / 2;

    const canvasX = (clientX / rect.width) * width;
    const canvasY = (clientY / rect.height) * height;

    const localX = (canvasX - (width / 2 + viewTransform.panX)) / viewTransform.zoom + width / 2;
    const localY = (canvasY - (height / 2 + viewTransform.panY)) / viewTransform.zoom + height / 2;

    const u = (localX - atlasOriginX) / uvTileSize;
    const v = 1.0 - (localY - atlasOriginY) / uvTileSize;

    setCursorUV({ u: Math.round(u * 1000) / 1000, v: Math.round(v * 1000) / 1000 });

    // Dragging island
    if (isDraggingIsland && activeIsland) {
      const deltaU = u - dragStartUV.u;
      const deltaV = v - dragStartUV.v;
      if (Math.abs(deltaU) > 1e-4 || Math.abs(deltaV) > 1e-4) {
        const updated = transformSingleUVIsland(currentFaces, activeIsland.faceIndices, {
          deltaU,
          deltaV
        });
        setCurrentFaces(updated);
        onUpdateMeshUVs(updated);
        setDragStartUV({ u, v });
      }
      return;
    }

    if (isPanning) {
      setViewTransform(prev => ({
        ...prev,
        panX: e.clientX - panStart.x,
        panY: e.clientY - panStart.y
      }));
      return;
    }

    // Hover detection across all faces
    let foundFaceIdx: number | null = null;
    for (let fIdx = 0; fIdx < currentFaces.length; fIdx++) {
      const face = currentFaces[fIdx];
      if (!face.uvs || face.uvs.length < 3) continue;

      let inside = false;
      const n = face.uvs.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = face.uvs[i];
        const [xj, yj] = face.uvs[j];
        const intersect = ((yi > v) !== (yj > v)) && (u < (xj - xi) * (v - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }

      if (inside) {
        foundFaceIdx = fIdx;
        break;
      }
    }

    setHoveredFaceIndex(foundFaceIdx);
    if (foundFaceIdx !== null) {
      const islId = faceToIslandMap.get(foundFaceIdx) ?? null;
      setHoveredIslandId(islId);
    } else {
      setHoveredIslandId(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsPanning(false);
    setIsDraggingIsland(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleCanvasClick = () => {
    if (selectionMode === 'island') {
      if (hoveredIslandId !== null) {
        setSelectedIslandId(hoveredIslandId === selectedIslandId ? null : hoveredIslandId);
      }
    } else {
      if (hoveredFaceIndex !== null) {
        setSelectedFaceIndex(hoveredFaceIndex === selectedFaceIndex ? null : hoveredFaceIndex);
      }
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.15 : -0.15;
    setViewTransform(prev => ({
      ...prev,
      zoom: Math.max(0.2, Math.min(6.0, prev.zoom + zoomDelta))
    }));
  };

  const handleResetZoomPan = () => {
    setViewTransform({ zoom: 0.95, panX: 60, panY: 0 });
  };

  const handleExportUVLayout = (res: number) => {
    const dataUrl = exportUVLayoutDataUrl(currentFaces, res, '#00ffcc', 2, 'rgba(0, 255, 204, 0.04)', '#09090b');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `uv_layout_${res}x${res}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    triggerNotification(`✓ Plantilla UV ${res}×${res} exportada`);
  };

  return (
    <div className={`flex flex-col bg-zinc-950 text-zinc-100 rounded-xl border border-zinc-800 overflow-hidden shadow-2xl ${isEmbedded ? 'h-full' : 'h-[88vh] w-full max-w-7xl mx-auto'}`}>
      
      {/* ── BARRA SUPERIOR CON CONTROLES CLAVE ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-md flex-shrink-0 gap-2 flex-wrap">
        
        {/* Lado Izquierdo: Identificador, Modo de Selección e Islas */}
        <div className="flex items-center gap-2">
          {!isEmbedded && (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center shadow">
                <Package size={13} className="text-white" />
              </div>
              <span className="text-xs font-bold text-white">{title}</span>
            </div>
          )}

          {/* Selector de Disposición de Vistas */}
          <div className="flex items-center gap-0.5 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
            <button
              onClick={() => setLayoutMode('split')}
              className={`px-2 py-1 rounded text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                layoutMode === 'split' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Vista dual: 2D UV + 3D sincronizado"
            >
              <Columns size={12} />
              <span>2D + 3D</span>
            </button>
            <button
              onClick={() => setLayoutMode('2d')}
              className={`px-2 py-1 rounded text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                layoutMode === '2d' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Solo Editor UV 2D"
            >
              <Square size={12} />
              <span>Solo 2D</span>
            </button>
            <button
              onClick={() => setLayoutMode('3d')}
              className={`px-2 py-1 rounded text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                layoutMode === '3d' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Solo Modelo 3D"
            >
              <Box size={12} />
              <span>Solo 3D</span>
            </button>
          </div>

          {/* Selector de Modo de Selección (Cara vs Isla) */}
          <div className="flex items-center gap-0.5 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
            <button
              onClick={() => setSelectionMode('island')}
              className={`px-2 py-1 rounded text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                selectionMode === 'island' ? 'bg-amber-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Selecciona y mueve islas completas (piezas desdobladas de la caja)"
            >
              <Package size={11} />
              <span>Modo Isla (Pieza)</span>
            </button>
            <button
              onClick={() => setSelectionMode('face')}
              className={`px-2 py-1 rounded text-[9.5px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                selectionMode === 'face' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Selecciona caras individuales"
            >
              <MousePointer size={11} />
              <span>Modo Cara</span>
            </button>
          </div>
        </div>

        {/* Notificación Flotante */}
        {notification && (
          <div className="flex items-center gap-1 text-[10px] bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 px-2 py-0.5 rounded-lg animate-in fade-in">
            <Check size={11} />
            <span>{notification}</span>
          </div>
        )}

        {/* Lado Derecho: Estado de Isla / Cara Activa y Coordenadas */}
        <div className="flex items-center gap-2">
          {activeIsland !== null ? (
            <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded-lg text-[9.5px] font-bold text-amber-300 animate-in fade-in">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeIsland.color }} />
              <span>Isla #{activeIsland.islandId}</span>
              <span className="text-[8px] text-amber-200/80 font-normal">
                ({activeIsland.faceIndices.length} caras {activeIsland.isStaged ? '• Espera [-1,0]' : '• Atlas [0,1]'})
              </span>
            </div>
          ) : activeHighlightIndex !== null ? (
            <div className="flex items-center gap-1.5 bg-indigo-950/80 border border-indigo-500/50 px-2 py-0.5 rounded-lg text-[9.5px] font-bold text-indigo-300 animate-in fade-in">
              <MousePointer size={11} className="text-indigo-400" />
              <span>Cara #{activeHighlightIndex}</span>
            </div>
          ) : (
            <span className="text-[9px] text-zinc-500 hidden sm:inline">
              Haz clic en una pieza 2D o en el 3D para seleccionarla y moverla
            </span>
          )}

          <div className="hidden sm:flex items-center gap-1.5 bg-zinc-950 px-2 py-0.5 rounded-lg border border-zinc-800 font-mono text-[9.5px] text-indigo-300">
            <span>U: {cursorUV ? (cursorUV.u).toFixed(3) : '0.000'}</span>
            <span className="text-zinc-600">|</span>
            <span>V: {cursorUV ? (cursorUV.v).toFixed(3) : '0.000'}</span>
          </div>
        </div>
      </div>

      {/* ── CUERPO PRINCIPAL (VISORES DUALES + PANEL DERECHO ORGANIZADO) ── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden min-h-0">
        
        {/* ÁREA DE VISORES (COLUMNA IZQUIERDA / CENTRAL - 8 COLUMNAS) */}
        <div className="lg:col-span-8 flex flex-col bg-zinc-950 p-2 space-y-1.5 border-r border-zinc-800 overflow-hidden relative">
          
          {/* Barra de Herramientas del Visor (Textura, Opacidad, Colorear Islas, Distorsión) */}
          <div className="flex items-center justify-between gap-1 flex-wrap bg-zinc-900/90 p-1.5 rounded-xl border border-zinc-800 shadow-sm flex-shrink-0">
            
            {/* Selector de Textura */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] font-bold text-zinc-300 flex items-center gap-1">
                <Paintbrush size={11} className="text-amber-400" />
                <span>Textura / Boceto:</span>
              </span>
              <select
                value={activeOverlaySource}
                onChange={e => setActiveOverlaySource(e.target.value as any)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-[10px] font-medium rounded-lg px-2 py-0.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {blueprintImages?.top && <option value="top">📐 Boceto Superior (XZ)</option>}
                {blueprintImages?.front && <option value="front">📐 Boceto Frontal (XY)</option>}
                {blueprintImages?.side && <option value="side">📐 Boceto Lateral (ZY)</option>}
                {atlasTextureUrl && <option value="atlas">🎨 Atlas PBR Unificado</option>}
                {activeTextureUrl && <option value="material">🎨 Textura Material</option>}
                {customTextureUrl && <option value="custom">🖼️ Imagen Subida</option>}
                <option value="checker16">🏁 Tablero Ajedrez (16×16)</option>
                <option value="checker32">🏁 Tablero Fino (32×32)</option>
                <option value="none">⚪ Sin Textura (Ver Islas)</option>
              </select>

              <label className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors cursor-pointer" title="Cargar imagen propia">
                <Upload size={11} />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => {
                        setCustomTextureUrl(reader.result as string);
                        setActiveOverlaySource('custom');
                        triggerNotification('✓ Textura personalizada cargada');
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
              </label>
            </div>

            {/* Slider de Opacidad */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-zinc-400">Opacidad:</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={textureOpacity}
                onChange={e => setTextureOpacity(parseFloat(e.target.value))}
                className="w-14 h-1 accent-amber-500 bg-zinc-800 rounded cursor-pointer"
              />
              <span className="text-[9px] font-mono text-amber-300 w-6">
                {Math.round(textureOpacity * 100)}%
              </span>
            </div>

            {/* Toggles Rápidos: Colorear Islas, Distorsión, Vértices */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setColorIslands(prev => !prev)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                  colorIslands
                    ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-sm'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
                title="Colorear cada isla / pieza de cartón con un color distintivo en 2D y 3D"
              >
                <Palette size={10} className={colorIslands ? 'text-indigo-300' : 'text-zinc-500'} />
                <span>Islas</span>
              </button>

              <button
                onClick={() => setShowDistortionHeatmap(prev => !prev)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                  showDistortionHeatmap
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
                title="Mostrar mapa de calor de distorsión"
              >
                <Activity size={10} className={showDistortionHeatmap ? 'text-amber-400 animate-pulse' : 'text-zinc-500'} />
                <span>Distorsión</span>
              </button>

              <button
                onClick={() => setShowVertices(prev => !prev)}
                className={`p-1 rounded text-[9px] border transition-all cursor-pointer ${
                  showVertices ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}
                title="Mostrar vértices UV"
              >
                <span className="text-[8.5px] font-mono font-bold">V</span>
              </button>

              <button
                onClick={() => setShowGridCoordinates(prev => !prev)}
                className={`p-1 rounded text-[9px] border transition-all cursor-pointer ${
                  showGridCoordinates ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}
                title="Cuadrícula UV"
              >
                <Grid size={11} />
              </button>
            </div>
          </div>

          {/* Cinta de Alineación Rápida 1:1 Boceto / Malla */}
          <div className="flex items-center justify-between gap-1 px-2 py-1 rounded-xl bg-gradient-to-r from-amber-950/40 via-indigo-950/40 to-zinc-900 border border-amber-500/30 text-[9px] flex-shrink-0">
            <div className="flex items-center gap-1.5">
              <Crosshair size={12} className="text-amber-400 flex-shrink-0 animate-pulse" />
              <span className="font-bold text-amber-300">
                {activeOverlaySource === 'top' ? 'Alinear con Boceto Superior (XZ)' :
                 activeOverlaySource === 'front' ? 'Alinear con Boceto Frontal (XY)' :
                 activeOverlaySource === 'side' ? 'Alinear con Boceto Lateral (ZY)' :
                 'Alineación Malla y Textura:'}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {activeOverlaySource === 'top' && (
                <button
                  onClick={() => handleProjectFromView('XZ', 'ALL')}
                  className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition shadow cursor-pointer flex items-center gap-1"
                  title="Alinear toda la malla exactamente con el boceto superior 1:1"
                >
                  <Target size={10} />
                  <span>Proyectar Superior (1:1)</span>
                </button>
              )}
              {activeOverlaySource === 'front' && (
                <button
                  onClick={() => handleProjectFromView('XY', 'ALL')}
                  className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition shadow cursor-pointer flex items-center gap-1"
                  title="Alinear toda la malla exactamente con el boceto frontal 1:1"
                >
                  <Target size={10} />
                  <span>Proyectar Frontal (1:1)</span>
                </button>
              )}
              {activeOverlaySource === 'side' && (
                <button
                  onClick={() => handleProjectFromView('ZY', 'ALL')}
                  className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition shadow cursor-pointer flex items-center gap-1"
                  title="Alinear toda la malla exactamente con el boceto lateral 1:1"
                >
                  <Target size={10} />
                  <span>Proyectar Lateral (1:1)</span>
                </button>
              )}
              {activeIsland && (
                <button
                  onClick={() => handleProjectFromView(activeOverlaySource === 'top' ? 'XZ' : activeOverlaySource === 'side' ? 'ZY' : 'XY', 'SELECTED_ISLAND')}
                  className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition cursor-pointer"
                  title="Alinear solo la pieza seleccionada con la vista ortogonal actual"
                >
                  Solo Pieza #{activeIsland.islandId}
                </button>
              )}
              <button
                onClick={() => handleProjectFromView('FIT_BOUNDS')}
                className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium border border-zinc-700 transition cursor-pointer"
                title="Ajustar al área de textura sin deformar proporciones"
              >
                Ajustar Bounds
              </button>
              <button
                onClick={() => handleProjectFromView('FLIP_U')}
                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition cursor-pointer"
                title="Invertir horizontalmente (Flip U)"
              >
                <FlipHorizontal size={10} />
              </button>
              <button
                onClick={() => handleProjectFromView('FLIP_V')}
                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition cursor-pointer"
                title="Invertir verticalmente (Flip V)"
              >
                <FlipVertical size={10} />
              </button>
              <button
                onClick={() => handleProjectFromView('ROTATE_90')}
                className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition cursor-pointer"
                title="Girar +90 grados"
              >
                <RotateCw size={10} />
              </button>
            </div>
          </div>

          {/* CONTENEDOR DE VISORES (2D UV DUAL + 3D THREE.JS) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 min-h-0 overflow-hidden">
            
            {/* 1. VISOR 2D UV CON ÁREA DE ESPERA [-1, 0] Y LIENZO [0, 1] */}
            {(layoutMode === 'split' || layoutMode === '2d') && (
              <div 
                ref={canvasContainerRef}
                className={`${layoutMode === '2d' ? 'col-span-2' : 'col-span-1'} bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden relative flex items-center justify-center shadow-inner h-full`}
              >
                <canvas
                  ref={canvasRef}
                  width={1400}
                  height={900}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onClick={handleCanvasClick}
                  onWheel={handleWheel}
                  className={`w-full h-full block select-none touch-none ${
                    isDraggingIsland ? 'cursor-move' : isPanning ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                />

                {/* Badge Superior Izquierdo */}
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-zinc-700/80 shadow-md">
                  <Square size={10} className="text-indigo-400" />
                  <span className="text-[9px] font-bold text-zinc-200">Editor UV 2D (Espera + Atlas)</span>
                  <span className="text-[8px] font-mono text-zinc-400">({Math.round(viewTransform.zoom * 100)}%)</span>
                </div>

                {/* Controles de Zoom Flotantes */}
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md p-0.5 rounded-lg border border-zinc-700/80 shadow">
                  <button
                    onClick={() => setViewTransform(p => ({ ...p, zoom: Math.min(6.0, p.zoom + 0.25) }))}
                    className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer"
                    title="Acercar"
                  >
                    <ZoomIn size={11} />
                  </button>
                  <button
                    onClick={() => setViewTransform(p => ({ ...p, zoom: Math.max(0.2, p.zoom - 0.25) }))}
                    className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer"
                    title="Alejar"
                  >
                    <ZoomOut size={11} />
                  </button>
                  <button
                    onClick={handleResetZoomPan}
                    className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[8px] font-bold text-zinc-300 cursor-pointer"
                    title="Centrar vista"
                  >
                    Centrar
                  </button>
                </div>

                {/* Botón Exportar PNG */}
                <div className="absolute bottom-2 right-2">
                  <button
                    onClick={() => handleExportUVLayout(2048)}
                    className="px-2 py-1 rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white font-bold text-[8.5px] shadow-lg flex items-center gap-1 transition-all cursor-pointer"
                    title="Exportar plantilla UV en PNG 2K"
                  >
                    <Download size={10} />
                    <span>PNG 2K</span>
                  </button>
                </div>
              </div>
            )}

            {/* 2. VISOR 3D THREE.JS */}
            {(layoutMode === 'split' || layoutMode === '3d') && (
              <div 
                className={`${layoutMode === '3d' ? 'col-span-2' : 'col-span-1'} bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden relative flex items-center justify-center shadow-inner h-full group`}
                onPointerMove={handleThreePointerMove}
                onClick={handleThreeClick}
              >
                <div ref={threeContainerRef} className="w-full h-full block cursor-crosshair" />

                {/* Badge Superior Izquierdo */}
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-zinc-700/80 shadow-md pointer-events-none">
                  <Box size={10} className="text-amber-400" />
                  <span className="text-[9px] font-bold text-zinc-200">Modelo 3D</span>
                  {activeIsland !== null ? (
                    <span className="text-[8px] font-mono text-amber-300 font-bold ml-1">
                      [Isla #{activeIsland.islandId}]
                    </span>
                  ) : activeHighlightIndex !== null ? (
                    <span className="text-[8px] font-mono text-amber-300 font-bold ml-1">
                      [Cara #{activeHighlightIndex}]
                    </span>
                  ) : null}
                </div>

                {/* Controles Flotantes 3D (Vistas de Cámara + Wireframe + AutoRotate) */}
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md p-0.5 rounded-lg border border-zinc-700/80 shadow">
                  <div className="flex items-center border-r border-zinc-700 pr-1 mr-0.5 gap-0.5">
                    <button
                      onClick={() => setCameraView('TOP')}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-300 text-[8px] font-bold cursor-pointer"
                      title="Vista Superior (XZ)"
                    >
                      Top
                    </button>
                    <button
                      onClick={() => setCameraView('FRONT')}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-300 text-[8px] font-bold cursor-pointer"
                      title="Vista Frontal (XY)"
                    >
                      Front
                    </button>
                    <button
                      onClick={() => setCameraView('SIDE')}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-amber-300 text-[8px] font-bold cursor-pointer"
                      title="Vista Lateral (ZY)"
                    >
                      Side
                    </button>
                    <button
                      onClick={() => setCameraView('ISO')}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-indigo-300 text-[8px] font-bold cursor-pointer"
                      title="Vista 3D Isométrica"
                    >
                      3D
                    </button>
                  </div>

                  <button
                    onClick={() => setWireframe3D(!wireframe3D)}
                    className={`px-1.5 py-0.5 rounded text-[8px] font-bold border transition-all cursor-pointer ${
                      wireframe3D ? 'bg-amber-600 border-amber-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    }`}
                    title="Alambre 3D"
                  >
                    Wire
                  </button>

                  <button
                    onClick={() => setAutoRotate3D(!autoRotate3D)}
                    className={`p-1 rounded border transition-all cursor-pointer ${
                      autoRotate3D ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    }`}
                    title="Giro automático 3D"
                  >
                    {autoRotate3D ? <Pause size={10} /> : <Play size={10} />}
                  </button>

                  <button
                    onClick={handleResetCamera3D}
                    className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 cursor-pointer"
                    title="Centrar cámara 3D"
                  >
                    <Focus size={10} />
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Estadísticas de Malla e Islas Inferiores */}
          <div className="grid grid-cols-4 gap-1.5 bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-800 text-center flex-shrink-0">
            <div>
              <span className="text-[7.5px] uppercase text-zinc-500 font-bold block">Polígonos 3D</span>
              <span className="text-xs font-mono font-bold text-zinc-200">{currentFaces.length}</span>
            </div>
            <div>
              <span className="text-[7.5px] uppercase text-zinc-500 font-bold block">Islas / Piezas</span>
              <span className="text-xs font-mono font-bold text-amber-400">{islands.length} piezas</span>
            </div>
            <div>
              <span className="text-[7.5px] uppercase text-zinc-500 font-bold block">Cobertura Atlas</span>
              <span className="text-xs font-mono font-bold text-indigo-400">{uvCoveragePercent}%</span>
            </div>
            <div>
              <span className="text-[7.5px] uppercase text-zinc-500 font-bold block">Distorsión</span>
              <span className={`text-xs font-mono font-bold ${distortionStats.averageDistortion >= 0.45 && distortionStats.averageDistortion <= 0.55 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {distortionStats.averageDistortion >= 0.45 && distortionStats.averageDistortion <= 0.55 ? 'Baja (Óptima)' : 'Media'}
              </span>
            </div>
          </div>
        </div>

        {/* ── COLUMNA DERECHA: PANEL ORGANIZADO EN 4 PESTAÑAS (4 COLUMNAS) ── */}
        <div className="lg:col-span-4 flex flex-col bg-zinc-900/50 p-2 space-y-2 overflow-y-auto min-w-0">
          
          {/* Selector de Pestañas Principales */}
          <div className="grid grid-cols-4 gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setRightPanelTab('unwrap')}
              className={`py-1 px-1 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                rightPanelTab === 'unwrap'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Package size={11} />
              <span>Desarmar</span>
            </button>

            <button
              onClick={() => setRightPanelTab('islands')}
              className={`py-1 px-1 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                rightPanelTab === 'islands'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Layers2 size={11} />
              <span>Piezas</span>
            </button>

            <button
              onClick={() => setRightPanelTab('transform')}
              className={`py-1 px-1 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                rightPanelTab === 'transform'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Sliders size={11} />
              <span>Ajustes</span>
            </button>

            <button
              onClick={() => setRightPanelTab('inspector')}
              className={`py-1 px-1 rounded-lg text-[9px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                rightPanelTab === 'inspector'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Info size={11} />
              <span>Info</span>
            </button>
          </div>

          {/* ════════════════ PESTAÑA 1: DESARMAR MALLA (CARDBOARD & NETS) ════════════════ */}
          {rightPanelTab === 'unwrap' && (
            <div className="space-y-2 animate-in fade-in">
              
              {/* Tarjeta Destacada: Desarmar como Caja de Cartón */}
              <div className="bg-gradient-to-br from-amber-950/40 via-zinc-900 to-zinc-900 p-2.5 rounded-xl border border-amber-500/40 space-y-2 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <Package size={13} className="text-amber-400" />
                    <span>Desarmar como Caja de Cartón (Box Net)</span>
                  </span>
                  <span className="text-[8px] bg-amber-500/20 text-amber-300 font-bold px-1.5 py-0.5 rounded border border-amber-500/30">
                    Cero Distorsión
                  </span>
                </div>

                <p className="text-[9px] text-zinc-300 leading-relaxed">
                  Aplana la malla 3D rotando sus caras por las bisagras compartidas en un patrón continuo plano 2D, igual que abrir una caja de cartón para pintarla o imprimirla.
                </p>

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  {/* Desarmar en Atlas [0, 1] */}
                  <button
                    onClick={() => handleExecuteUnwrap('cardboard')}
                    className="py-2 px-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[9.5px] font-bold flex flex-col items-center justify-center gap-1 shadow-md transition-all cursor-pointer"
                    title="Desenvuelve la caja plana dentro del lienzo de textura [0, 1]"
                  >
                    <Package size={14} />
                    <span>Desarmar en Atlas [0, 1]</span>
                  </button>

                  {/* Desdoblar a Zona de Espera [-1, 0] */}
                  <button
                    onClick={() => handleExecuteUnwrap('cardboard_staging')}
                    className="py-2 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[9.5px] font-bold flex flex-col items-center justify-center gap-1 border border-zinc-700 shadow transition-all cursor-pointer"
                    title="Desdobla todas las piezas en la zona de trabajo externa [-1, 0]"
                  >
                    <Scissors size={14} className="text-amber-400" />
                    <span>Desdoblar en Espera [-1, 0]</span>
                  </button>
                </div>
              </div>

              {/* Tarjeta de Otros Algoritmos */}
              <div className="bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 space-y-2 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                  <Sparkles size={12} className="text-indigo-400" />
                  <span>Otros Algoritmos de Despliegue</span>
                </span>

                <div className="grid grid-cols-2 gap-1.5">
                  {/* Smart UV Project por Islas */}
                  <button
                    onClick={() => handleExecuteUnwrap('smart')}
                    className={`py-2 px-2 rounded-lg border text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      unwrapMode === 'smart'
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                    }`}
                  >
                    <Layers size={13} className="text-indigo-400" />
                    <span>Smart UV (Ángulo {smartAngleLimit}°)</span>
                  </button>

                  {/* Cilíndrico + Tapas */}
                  <button
                    onClick={() => handleExecuteUnwrap('cylinder')}
                    className={`py-2 px-2 rounded-lg border text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      unwrapMode === 'cylinder'
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                    }`}
                  >
                    <RefreshCw size={13} className="text-indigo-400" />
                    <span>Cilíndrico + Tapas</span>
                  </button>

                  {/* Proyección Cúbica */}
                  <button
                    onClick={() => handleExecuteUnwrap('box')}
                    className={`py-2 px-2 rounded-lg border text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      unwrapMode === 'box'
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                    }`}
                  >
                    <Box size={13} className="text-indigo-400" />
                    <span>Cúbica 6 Caras</span>
                  </button>

                  {/* Lightmap Separado */}
                  <button
                    onClick={() => handleExecuteUnwrap('lightmap')}
                    className={`py-2 px-2 rounded-lg border text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      unwrapMode === 'lightmap'
                        ? 'bg-indigo-600 border-indigo-400 text-white shadow-md'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                    }`}
                  >
                    <Grid size={13} className="text-indigo-400" />
                    <span>Empacar Caras Sueltas</span>
                  </button>
                </div>
              </div>

              {/* Parámetros de Empaquetado */}
              <div className="bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                  Parámetros de Margen & Ángulo
                </span>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-zinc-400">Margen entre piezas:</span>
                    <span className="font-mono font-bold text-amber-300">{(islandMargin * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.005}
                    max={0.08}
                    step={0.005}
                    value={islandMargin}
                    onChange={e => setIslandMargin(parseFloat(e.target.value))}
                    className="w-full h-1 accent-amber-500 bg-zinc-800 rounded cursor-pointer"
                  />
                </div>

                <button
                  onClick={handlePackAllIslands}
                  className="w-full py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[9.5px] flex items-center justify-center gap-1.5 shadow transition-all cursor-pointer"
                  title="Organiza todas las islas en el cuadrado [0, 1] sin solapamiento"
                >
                  <Package size={12} />
                  <span>🚀 Empaquetar Todo en Atlas [0, 1] (Smart Pack)</span>
                </button>
              </div>

            </div>
          )}

          {/* ════════════════ PESTAÑA 2: GESTOR DE PIEZAS / ISLAS ════════════════ */}
          {rightPanelTab === 'islands' && (
            <div className="space-y-2 animate-in fade-in">
              
              {/* Acciones de la Isla Seleccionada */}
              {activeIsland ? (
                <div className="bg-zinc-900 p-2.5 rounded-xl border border-amber-500/50 space-y-2.5 shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shadow" style={{ backgroundColor: activeIsland.color }} />
                      <span className="text-xs font-bold text-amber-300">Isla #{activeIsland.islandId}</span>
                    </div>
                    <span className="text-[8px] font-mono text-zinc-400">
                      {activeIsland.faceIndices.length} polígonos
                    </span>
                  </div>

                  {/* Botones de Envío Rápido entre Espera y Atlas */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => handleTransformSelectedIsland({ snapToAtlas: true })}
                      disabled={!activeIsland.isStaged}
                      className={`py-1.5 px-2 rounded-lg font-bold text-[9px] flex items-center justify-center gap-1 transition-all ${
                        activeIsland.isStaged
                          ? 'bg-amber-600 hover:bg-amber-500 text-white shadow cursor-pointer'
                          : 'bg-zinc-800 text-zinc-500 opacity-50 cursor-not-allowed'
                      }`}
                      title="Mueve la pieza a la zona activa de textura [0, 1]"
                    >
                      <span>📥 Al Atlas [0, 1]</span>
                    </button>

                    <button
                      onClick={() => handleTransformSelectedIsland({ snapToStaging: true })}
                      disabled={activeIsland.isStaged}
                      className={`py-1.5 px-2 rounded-lg font-bold text-[9px] flex items-center justify-center gap-1 transition-all ${
                        !activeIsland.isStaged
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 cursor-pointer'
                          : 'bg-zinc-800 text-zinc-500 opacity-50 cursor-not-allowed'
                      }`}
                      title="Mueve la pieza fuera del lienzo a la zona de espera [-1, 0]"
                    >
                      <span>📤 A Espera [-1, 0]</span>
                    </button>
                  </div>

                  {/* Rotación y Enderezado */}
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      onClick={() => handleTransformSelectedIsland({ rotationDeg: -90 })}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold flex items-center justify-center gap-0.5 border border-zinc-700 cursor-pointer"
                      title="Girar -90°"
                    >
                      <RotateCcw size={10} />
                      <span>-90°</span>
                    </button>

                    <button
                      onClick={() => handleTransformSelectedIsland({ rotationDeg: 90 })}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold flex items-center justify-center gap-0.5 border border-zinc-700 cursor-pointer"
                      title="Girar +90°"
                    >
                      <RotateCw size={10} />
                      <span>+90°</span>
                    </button>

                    <button
                      onClick={() => handleTransformSelectedIsland({ flipH: true })}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold flex items-center justify-center gap-0.5 border border-zinc-700 cursor-pointer"
                      title="Voltear horizontal"
                    >
                      <FlipHorizontal size={10} />
                      <span>Flip</span>
                    </button>

                    <button
                      onClick={handleStraightenSelectedIsland}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold flex items-center justify-center gap-0.5 border border-zinc-700 cursor-pointer"
                      title="Alinear automáticamente con los ejes Cartesianos"
                    >
                      <span>📐 Auto</span>
                    </button>
                  </div>

                  {/* Escala de la Isla */}
                  <div className="grid grid-cols-2 gap-1 pt-1">
                    <button
                      onClick={() => handleTransformSelectedIsland({ scaleFactor: 1.1 })}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold cursor-pointer"
                    >
                      +10% Escala
                    </button>
                    <button
                      onClick={() => handleTransformSelectedIsland({ scaleFactor: 0.9 })}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[8.5px] font-bold cursor-pointer"
                    >
                      -10% Escala
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800 text-center space-y-1">
                  <Package size={20} className="text-zinc-500 mx-auto" />
                  <p className="text-[10px] text-zinc-400 font-bold">Ninguna pieza seleccionada</p>
                  <p className="text-[8.5px] text-zinc-500">
                    Haz clic en cualquier pieza en el lienzo 2D o en el visor 3D para moverla, rotarla o enviarla a la zona de espera.
                  </p>
                </div>
              )}

              {/* Lista Completa de Piezas / Islas */}
              <div className="bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 space-y-1.5 max-h-56 overflow-y-auto">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400 block">
                  Piezas Desdobladas ({islands.length})
                </span>

                <div className="space-y-1">
                  {islands.map(isl => {
                    const isSelected = selectedIslandId === isl.islandId;
                    return (
                      <div
                        key={isl.islandId}
                        onClick={() => setSelectedIslandId(isSelected ? null : isl.islandId)}
                        className={`flex items-center justify-between p-1.5 rounded-lg border text-[9.5px] transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-950/70 border-amber-500 text-amber-200 shadow'
                            : 'bg-zinc-800/80 border-zinc-750 text-zinc-300 hover:bg-zinc-750'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: isl.color }} />
                          <span className="font-bold">Pieza #{isl.islandId}</span>
                          <span className="text-[8px] text-zinc-400">({isl.faceIndices.length} caras)</span>
                        </div>

                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${
                          isl.isStaged ? 'bg-purple-950 text-purple-300 border border-purple-800/50' : 'bg-indigo-950 text-indigo-300 border border-indigo-800/50'
                        }`}>
                          {isl.isStaged ? 'En Espera' : 'En Atlas'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ════════════════ PESTAÑA 3: AJUSTES GLOBALES ════════════════ */}
          {rightPanelTab === 'transform' && (
            <div className="space-y-2 animate-in fade-in">
              
              <div className="bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 space-y-2.5 shadow-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <Sliders size={12} />
                  <span>Ajustes Globales de Mapeo</span>
                </span>

                {/* Escala */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-zinc-400">Escala Global:</span>
                    <span className="font-mono text-emerald-400">{scaleX.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={3.0}
                    step={0.05}
                    value={scaleX}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      setScaleX(v);
                      setScaleY(v);
                      applyTransforms(offsetX, offsetY, v, v, rotationDeg, flipH, flipV, repeatX, repeatY);
                    }}
                    className="w-full h-1 accent-emerald-500 bg-zinc-800 rounded cursor-pointer"
                  />
                </div>

                {/* Rotación */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-zinc-400">Rotación:</span>
                    <span className="font-mono text-emerald-400">{rotationDeg}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={rotationDeg}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      setRotationDeg(v);
                      applyTransforms(offsetX, offsetY, scaleX, scaleY, v, flipH, flipV, repeatX, repeatY);
                    }}
                    className="w-full h-1 accent-emerald-500 bg-zinc-800 rounded cursor-pointer"
                  />
                </div>

                {/* Proyecciones de Vista Rápida */}
                <div className="pt-1">
                  <span className="text-[8.5px] font-bold text-zinc-400 uppercase block mb-1">
                    Alineación Rápida por Ejes
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => handleProjectFromView('XY')}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-[8.5px] font-bold border border-zinc-700 cursor-pointer"
                    >
                      Frontal XY
                    </button>
                    <button
                      onClick={() => handleProjectFromView('XZ')}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-[8.5px] font-bold border border-zinc-700 cursor-pointer"
                    >
                      Superior XZ
                    </button>
                    <button
                      onClick={() => handleProjectFromView('ZY')}
                      className="py-1 px-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-[8.5px] font-bold border border-zinc-700 cursor-pointer"
                    >
                      Lateral ZY
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <button
                    onClick={() => handleProjectFromView('FIT_BOUNDS')}
                    className="py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[9px] shadow cursor-pointer"
                  >
                    Ajustar 100%
                  </button>
                  <button
                    onClick={() => handleProjectFromView('RESET')}
                    className="py-1.5 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-[9px] border border-zinc-700 cursor-pointer"
                  >
                    Restablecer
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ════════════════ PESTAÑA 4: INSPECTOR DE DISTORSIÓN Y GUÍA ════════════════ */}
          {rightPanelTab === 'inspector' && (
            <div className="space-y-2 animate-in fade-in">
              
              <div className="bg-zinc-900 p-2.5 rounded-xl border border-zinc-800 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1">
                  <Info size={12} />
                  <span>Concepto de Desenvolvimiento UV</span>
                </span>

                <p className="text-[9px] text-zinc-300 leading-relaxed">
                  <strong>Desarmar una caja 3D en 2D</strong> significa rotar sus caras contiguas por las aristas hasta aplanarlas completamente sin deformar longitudes ni ángulos, permitiendo pintar o texturizar cada solapa con precisión milimétrica.
                </p>

                <div className="bg-zinc-950 p-2 rounded-lg border border-zinc-800 space-y-1 font-mono text-[8.5px] text-zinc-400">
                  <div className="flex justify-between">
                    <span>Área 2D UV:</span>
                    <span className="text-zinc-200">{distortionStats.uvAreaTotal.toFixed(3)} u²</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Área 3D Mesh:</span>
                    <span className="text-zinc-200">{distortionStats.meshAreaTotal.toFixed(3)} u²</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Índice de Estiramiento:</span>
                    <span className="text-emerald-400">{(distortionStats.averageDistortion * 100).toFixed(0)}% (Óptimo)</span>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>

    </div>
  );
};
