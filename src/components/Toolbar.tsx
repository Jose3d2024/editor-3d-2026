import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore';
import {
  Box, Circle, Cylinder, Cone, Undo2, Redo2, Save, FolderOpen,
  Download, Code, Maximize2, Disc, Square, Hexagon,
  MousePointer2, Dot, Move, RotateCw, Maximize, Spline, Layers3, Layers,
  Copy, Clipboard, FlipHorizontal, Image as ImageIcon,
  ChevronDown, Pencil, SquareDashed, Upload, Magnet, Grid, LayoutGrid, Check, SlidersHorizontal,
  GripVertical, GripHorizontal, Pin, PinOff, AlignStartVertical, Plus, X, Sparkles,
  Edit3, RefreshCw, RotateCcw, Trash2, Combine, Scissors, Target, Zap, FlipVertical, XCircle, ArrowUpFromLine, Split,
  Keyboard, Cloud, Wind, Flame, Waves, Bone, Camera
} from 'lucide-react';
import { downloadViewportSnapshot } from '../utils/viewportCapture';
import { ConfirmModal } from './ConfirmModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { SaveProjectModal, saveSceneToStorage, getSavedScenes } from './SaveProjectModal';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { performCSG } from '../utils/csg';
import * as THREE from 'three';
import type { CSGObject, MeshFace, V3, ViewportLayoutPreset } from '../types';
import { fileToDataURL } from '../utils/silhouettes';
import { Exporter } from '../utils/exporters';
import { extractPBRMaterialsFromObject3D } from '../utils/materialUtils';
import {
  generatePolygon, generateArc,
  latheMesh, LATHE_PRESETS,
  sweepMesh, SWEEP_PROFILES, makeStraightPath, makeArcPath, makeHelixPath,
  loftMesh, circleSection, squareSection, starSection,
  bevelMesh, pathDeformMesh,
} from '../utils/modifiers';
import {
  chamfer3DEdges, arrayLinear, arrayPolar,
  capOpenHoles, capSelectedFaces, revolveMesh, shapeToProfile, simplifyMesh,
} from '../utils/modifiers_advanced';
import { createRetopoQuadPlane, createRetopoCage } from '../utils/shrinkwrap';
import { SiluetaTab } from './SiluetaTab';
import { safeFixed, safeNum, safeParseFixed, safeVec3Key } from '../utils/numberUtils';
import { RenderModal } from './RenderModal';
import { CodeExporterModal } from './CodeExporterModal';
import { WireframeModal } from './WireframeModal';
import { FaceSnapDemoModal } from './FaceSnapDemoModal';
import { VOLUMETRIC_PRESETS } from '../utils/volumetricRaymarch';
import {
  PARTICLE_PRESETS,
  SPACE_WARP_PRESETS,
  DEFAULT_PARTICLE_CONFIG,
  DEFAULT_SPACE_WARP_CONFIG,
} from '../utils/particleSystem';
import {
  GPGPU_SWARM_PRESETS,
  DEFAULT_GPGPU_SWARM_CONFIG,
} from '../utils/gpgpuSwarm';

// ── Import helper: BufferGeometry → CSGObject ─────────────────────────────────
const textureToDataURL = (texture: THREE.Texture): string | undefined => {
  if (!texture) return undefined;
  const img = texture.image || (texture as any).source?.data;
  if (!img) return undefined;
  
  try {
    // If it's already a data URL, return it
    if (typeof img.src === 'string' && img.src.startsWith('data:')) {
      return img.src;
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.width || 512;
    canvas.height = img.height || 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    
    // Handle ImageBitmap or HTMLImageElement
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('Could not convert texture to DataURL', e);
    return typeof img.src === 'string' ? img.src : undefined;
  }
};

const bufferGeomToCSGObject = (
  geometry: THREE.BufferGeometry, 
  name: string, 
  material?: THREE.Material | THREE.Material[],
  options: { noTransform?: boolean } = {}
): CSGObject => {
  const uniqueVerts: V3[] = [];
  const vertMap = new Map<string, number>();
  const getIdx = (x: number, y: number, z: number) => {
    const key = safeVec3Key(x, y, z, 6);
    if (vertMap.has(key)) return vertMap.get(key)!;
    const idx = uniqueVerts.length;
    uniqueVerts.push([x, y, z]);
    vertMap.set(key, idx);
    return idx;
  };
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const faces: MeshFace[] = [];
  
  const getUV = (idx: number): [number, number] | undefined => {
    if (!uv) return undefined;
    return [uv.getX(idx), uv.getY(idx)];
  };

  if (geometry.index) {
    for (let i = 0; i < geometry.index.count; i += 3) {
      const a = geometry.index.getX(i), b = geometry.index.getX(i+1), c = geometry.index.getX(i+2);
      const face: MeshFace = { 
        indices: [
          getIdx(pos.getX(a),pos.getY(a),pos.getZ(a)), 
          getIdx(pos.getX(b),pos.getY(b),pos.getZ(b)), 
          getIdx(pos.getX(c),pos.getY(c),pos.getZ(c))
        ] 
      };
      if (uv) {
        face.uvs = [getUV(a)!, getUV(b)!, getUV(c)!];
      }
      faces.push(face);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const face: MeshFace = { 
        indices: [
          getIdx(pos.getX(i),pos.getY(i),pos.getZ(i)), 
          getIdx(pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1)), 
          getIdx(pos.getX(i+2),pos.getY(i+2),pos.getZ(i+2))
        ] 
      };
      if (uv) {
        face.uvs = [getUV(i)!, getUV(i+1)!, getUV(i+2)!];
      }
      faces.push(face);
    }
  }

  let matData: any = undefined;
  const actualMat = Array.isArray(material) ? material[0] : material;
  
  if (actualMat && (actualMat as any).isMaterial) {
    const m = actualMat as any;
    matData = {
      map: textureToDataURL(m.map),
      normalMap: textureToDataURL(m.normalMap),
      roughnessMap: textureToDataURL(m.roughnessMap),
      metalnessMap: textureToDataURL(m.metalnessMap),
      aoMap: textureToDataURL(m.aoMap),
      roughness: m.roughness ?? 0.5,
      metalness: m.metalness ?? 0,
      flipY: m.map ? m.map.flipY : (m.normalMap ? m.normalMap.flipY : true),
    };
  }

  const box3 = new THREE.Box3();
  uniqueVerts.forEach(v => box3.expandByPoint(new THREE.Vector3(...v)));
  const center = new THREE.Vector3(); box3.getCenter(center);
  const size = new THREE.Vector3(); box3.getSize(size);
  
  const sc = options.noTransform ? 1 : (2 / (Math.max(size.x, size.y, size.z) || 1));
  const centerOffset = options.noTransform ? new THREE.Vector3(0,0,0) : center;
  
  const matColor = (actualMat as any)?.color ? '#' + (actualMat as any).color.getHexString() : undefined;

  return {
    id: Math.random().toString(36).substr(2,9), name, type: 'MESH', operation: 'ADD',
    transform: { position:[0,0,0], rotation:[0,0,0], scale:[1,1,1] },
    parameters: {}, vertices: uniqueVerts.map(v => [(v[0]-centerOffset.x)*sc,(v[1]-centerOffset.y)*sc,(v[2]-centerOffset.z)*sc] as V3),
    faces, color: matColor || '#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
    opacity:1, visible:true, keyframes:[], vertexOffsets:{},
    material: matData,
    smoothShading: true,
  };
};

const extractMaterialsFromObject = (object: THREE.Object3D): any[] => {
  const materials: any[] = [];
  const seen = new Set<THREE.Material>();

  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(m => {
        if (m && !seen.has(m)) {
          seen.add(m);
          const pbr = m as any;
          
          // Helper to get flipY from any map
          const getFlipY = () => {
            if (pbr.map) return pbr.map.flipY;
            if (pbr.normalMap) return pbr.normalMap.flipY;
            if (pbr.roughnessMap) return pbr.roughnessMap.flipY;
            if (pbr.metalnessMap) return pbr.metalnessMap.flipY;
            return true;
          };

          const matId = Math.random().toString(36).substr(2, 9);
          m.userData.csgMaterialId = matId;

          const matData: any = {
            id: matId,
            name: m.name || `Material ${materials.length + 1}`,
            color: pbr.color ? '#' + pbr.color.getHexString() : '#ffffff',
            roughness: pbr.roughness ?? 0.5,
            metalness: pbr.metalness ?? 0,
            opacity: m.opacity ?? 1,
            transparent: m.transparent ?? false,
            emissive: pbr.emissive ? '#' + pbr.emissive.getHexString() : '#000000',
            emissiveIntensity: pbr.emissiveIntensity ?? 1,
            map: textureToDataURL(pbr.map),
            normalMap: textureToDataURL(pbr.normalMap),
            roughnessMap: textureToDataURL(pbr.roughnessMap),
            metalnessMap: textureToDataURL(pbr.metalnessMap),
            aoMap: textureToDataURL(pbr.aoMap),
            alphaMap: textureToDataURL(pbr.alphaMap),
            emissiveMap: textureToDataURL(pbr.emissiveMap),
            flipY: getFlipY(),
          };
          materials.push(matData);
        }
      });
    }
  });
  return materials;
};

const TooltipContext = createContext<((label:string|null,rect?:DOMRect,shortcut?:string)=>void)|null>(null);

// ─── Toolbar ──────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// PESTAÑA DE MALLA (OPTIMIZAR / SUBDIVIDIR)
// ════════════════════════════════════════════════════════════════════════════
const MeshTab: React.FC<{
  selectedObject: CSGObject | null;
  onModify: (v: V3[], f: MeshFace[]) => void;
}> = ({ selectedObject, onModify }) => {
  const [optRatio, setOptRatio] = useState(0.3);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSubdividing, setIsSubdividing] = useState(false);
  const [isSmoothing, setIsSmoothing] = useState(false);
  const [smoothFactor, setSmoothFactor] = useState(0.5);
  const [smoothIters, setSmoothIters] = useState(1);

  if (!selectedObject) {
    return (
      <div className="p-4 text-center space-y-2">
        <p className="text-[10px] text-zinc-500 italic">Selecciona un objeto 3D para ver las herramientas de malla.</p>
      </div>
    );
  }

  const currentVerts = selectedObject.stats?.vertices ?? selectedObject.vertices?.length ?? 0;
  const currentFaces = selectedObject.stats?.faces ?? selectedObject.faces?.length ?? 0;
  const targetFacesEst = Math.max(4, Math.round(currentFaces * optRatio));
  const reductionPercent = Math.round((1 - optRatio) * 100);

  return (
    <div className="space-y-4">
      <PTitle icon="🕸️" title="Herramientas de Malla" desc="Optimiza, reduce polígonos, subdivide o suaviza la geometría." />

      {/* Optimizar */}
      <div className="space-y-2 p-2.5 bg-zinc-800/40 rounded-lg border border-violet-500/30">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-violet-300 uppercase flex items-center gap-1">
            <Zap size={12} className="text-amber-400" /> Optimizar / Decimar
          </span>
          <span className="text-[9px] font-mono text-zinc-400">{currentFaces.toLocaleString()} caras</span>
        </div>

        <div className="flex items-center justify-between text-[10px]">
          <span className="text-zinc-300">Ratio Retenido</span>
          <span className="font-mono text-violet-300 font-bold">{Math.round(optRatio * 100)}% (~{targetFacesEst.toLocaleString()} caras, -{reductionPercent}%)</span>
        </div>

        <input 
          type="range" 
          min={0.01} 
          max={0.95} 
          step={0.01} 
          value={optRatio} 
          onChange={e => setOptRatio(+e.target.value)} 
          className="w-full accent-violet-500 h-1.5 bg-zinc-800 rounded cursor-pointer" 
        />

        {/* Presets */}
        <div className="grid grid-cols-4 gap-1">
          <button onClick={() => setOptRatio(0.05)} className={`py-0.5 text-[9px] font-bold rounded border cursor-pointer ${optRatio === 0.05 ? 'bg-violet-600 border-violet-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>5% Ultra</button>
          <button onClick={() => setOptRatio(0.15)} className={`py-0.5 text-[9px] font-bold rounded border cursor-pointer ${optRatio === 0.15 ? 'bg-violet-600 border-violet-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>15%</button>
          <button onClick={() => setOptRatio(0.30)} className={`py-0.5 text-[9px] font-bold rounded border cursor-pointer ${optRatio === 0.30 ? 'bg-violet-600 border-violet-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>30%</button>
          <button onClick={() => setOptRatio(0.50)} className={`py-0.5 text-[9px] font-bold rounded border cursor-pointer ${optRatio === 0.50 ? 'bg-violet-600 border-violet-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>50%</button>
        </div>

        <button 
          disabled={isOptimizing}
          onClick={async () => {
            setIsOptimizing(true);
            try {
              await useStore.getState().optimizeObject(selectedObject.id, optRatio);
            } finally {
              setIsOptimizing(false);
            }
          }} 
          className={`w-full py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            isOptimizing ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-violet-600 hover:bg-violet-500 text-white shadow-md'
          }`}
        >
          <Zap size={12} />
          {isOptimizing ? '⌛ Optimizando geometría...' : `Ejecutar Optimización (-${reductionPercent}%)`}
        </button>
      </div>

      {/* Subdividir */}
      <div className="space-y-2 p-2 bg-zinc-800/30 rounded border border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-zinc-300 uppercase">Subdividir</span>
          <span className="text-[9px] text-zinc-500">Aumenta detalle</span>
        </div>
        <p className="text-[8px] text-zinc-500 italic">Divide cada cara en 4 caras más pequeñas. Útil para modelado orgánico.</p>
        <button 
          disabled={isSubdividing}
          onClick={async () => {
            setIsSubdividing(true);
            try {
              await useStore.getState().subdivideObject(selectedObject.id);
            } finally {
              setIsSubdividing(false);
            }
          }} 
          className={`w-full py-1.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${isSubdividing ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
        >
          {isSubdividing ? '⌛ Subdividiendo...' : 'Subdividir Malla (x4 caras)'}
        </button>
      </div>

      {/* Suavizar */}
      <div className="space-y-2 p-2 bg-zinc-800/30 rounded border border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-zinc-300 uppercase">Suavizar (Laplacian)</span>
          <span className="text-[9px] text-zinc-500">Relaja la malla</span>
        </div>
        <CRow label="Factor">
          <input type="range" min={0.1} max={1} step={0.1} value={smoothFactor} onChange={e => setSmoothFactor(+e.target.value)} className="flex-1 accent-violet-500 h-1.5" />
          <CVal>{safeFixed(smoothFactor, 1)}</CVal>
        </CRow>
        <CRow label="Iteraciones">
          <input type="range" min={1} max={10} step={1} value={smoothIters} onChange={e => setSmoothIters(+e.target.value)} className="flex-1 accent-violet-500 h-1.5" />
          <CVal>{smoothIters}</CVal>
        </CRow>
        <button 
          disabled={isSmoothing}
          onClick={async () => {
            setIsSmoothing(true);
            try {
              await useStore.getState().smoothObject(selectedObject.id, smoothFactor, smoothIters);
            } finally {
              setIsSmoothing(false);
            }
          }} 
          className={`w-full py-1.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${isSmoothing ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-zinc-700 hover:bg-zinc-600 text-white'}`}
        >
          {isSmoothing ? '⌛ Suavizando...' : 'Suavizar Geometría'}
        </button>
      </div>
    </div>
  );
};

const ToolbarTextureLibrary: React.FC = () => {
  const project = useStore(s => s.project);
  const [customTextures, setCustomTextures] = useState<string[]>([]);
  
  const textures = React.useMemo(() => {
    const set = new Set<string>(DEFAULT_TEXTURES);
    project.objects.forEach(o => {
      if (o.material) {
        if (o.material.map) set.add(o.material.map);
        if (o.material.normalMap) set.add(o.material.normalMap);
        if (o.material.roughnessMap) set.add(o.material.roughnessMap);
        if (o.material.metalnessMap) set.add(o.material.metalnessMap);
        if (o.material.aoMap) set.add(o.material.aoMap);
      }
    });
    customTextures.forEach(t => set.add(t));
    return Array.from(set);
  }, [project.objects, customTextures]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = await fileToDataURL(file);
      setCustomTextures(prev => [...prev, url]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[9px] text-zinc-500 italic">Arrastra a un objeto</p>
        <label className="cursor-pointer p-1 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors flex items-center gap-1 text-[9px] font-bold text-zinc-300">
          <Upload size={10} /> Subir
          <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
        </label>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {textures.map((url, i) => (
          <div 
            key={i}
            className="aspect-square bg-zinc-800 rounded border border-zinc-700 overflow-hidden cursor-grab active:cursor-grabbing hover:border-emerald-500 transition-colors group relative"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-texture-url', url);
              e.dataTransfer.setData('application/x-texture-type', 'map');
              e.dataTransfer.setData('text/plain', url);
            }}
            onClick={() => {
              const selId = useStore.getState().selectedObjectId;
              if (selId) {
                const obj = project.objects.find(o => o.id === selId);
                if (obj) {
                  const m = obj.material || {};
                  useStore.getState().updateObject(selId, { material: { ...m, map: url } });
                  useStore.getState().setViewMode('TEXTURED');
                  useStore.getState().saveHistory();
                }
              }
            }}
          >
            <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="w-2 h-2 bg-white rounded-full shadow-[0_0_10px_white]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DEFAULT_TEXTURES = [
  'https://picsum.photos/seed/wood/512',
  'https://picsum.photos/seed/metal/512',
  'https://picsum.photos/seed/stone/512',
  'https://picsum.photos/seed/fabric/512',
  'https://picsum.photos/seed/concrete/512',
  'https://picsum.photos/seed/grid/512',
  'https://picsum.photos/seed/brick/512',
  'https://picsum.photos/seed/marble/512',
  'https://picsum.photos/seed/grass/512',
  'https://picsum.photos/seed/water/512',
  'https://picsum.photos/seed/sand/512',
  'https://picsum.photos/seed/rust/512',
];

export const Toolbar: React.FC = () => {
  const historyIndex = useStore(s => s.historyIndex);
  const history = useStore(s => s.history);
  const {
    addObject, undo, redo, viewMode, setViewMode,
    editMode, setEditMode, transformMode, setTransformMode,
    transformSpace, setTransformSpace, drawMode, setDrawMode,
    project, setProject, currentTime, selectedObjectId,
    updateObject, selectedFaceIndices, saveHistory, setReference,
    copyObject, pasteObject, mirrorObject, duplicateObject,
    extrudeShape, gridSnapEnabled, setGridSnapEnabled,
    moveReferenceMode, setMoveReferenceMode,
    maximizedViewport, setMaximizedViewport,
    viewportConfig, setViewportPreset, setViewportSplits,
    setCustomResizeMode, setSnapStep, resetViewportSplits,
    faceSnapConfig, setFaceSnapConfig, toggleFaceSnap,
  } = useStore();

  const [showFaceSnapMenu, setShowFaceSnapMenu] = useState(false);
  const faceSnapRef = useRef<HTMLDivElement>(null);
  const [isFloating,       setIsFloating]       = useState(false);
  const [showMirror,       setShowMirror]        = useState(false);
  const [showRef,          setShowRef]           = useState(false);
  const [showViewportConfig, setShowViewportConfig] = useState(false);
  const [viewportSections, setViewportSections] = useState({
    layouts: true,
    resize: false,
    gridSnap: true,
    faceSnap: false,
    alignment: false,
  });

  const toggleViewportSection = (sec: keyof typeof viewportSections) => {
    setViewportSections(prev => ({ ...prev, [sec]: !prev[sec] }));
  };

  const toggleAllViewportSections = () => {
    const anyOpen = Object.values(viewportSections).some(Boolean);
    setViewportSections({
      layouts: !anyOpen,
      resize: !anyOpen,
      gridSnap: !anyOpen,
      faceSnap: !anyOpen,
      alignment: !anyOpen,
    });
  };
  const viewportConfigRef = useRef<HTMLDivElement>(null);
  const [viewportPanelPos, setViewportPanelPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingViewportRef = useRef(false);
  const dragStartOffsetRef = useRef({ x: 0, y: 0 });

  const handleViewportPanelDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    isDraggingViewportRef.current = true;
    const currentX = viewportPanelPos?.x ?? Math.min(
      viewportConfigRef.current?.getBoundingClientRect().left ?? 0,
      window.innerWidth - 370
    );
    const currentY = viewportPanelPos?.y ?? Math.min(
      (viewportConfigRef.current?.getBoundingClientRect().bottom ?? 45) + 4,
      Math.max(10, window.innerHeight - 560)
    );
    dragStartOffsetRef.current = {
      x: e.clientX - currentX,
      y: e.clientY - currentY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleViewportPanelDragMove = (e: React.PointerEvent) => {
    if (!isDraggingViewportRef.current) return;
    const newX = Math.max(10, Math.min(window.innerWidth - 370, e.clientX - dragStartOffsetRef.current.x));
    const newY = Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragStartOffsetRef.current.y));
    setViewportPanelPos({ x: newX, y: newY });
  };

  const handleViewportPanelDragEnd = (e: React.PointerEvent) => {
    if (isDraggingViewportRef.current) {
      isDraggingViewportRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  const [showOpacity,      setShowOpacity]       = useState(false);
  const [globalOpacity,    setGlobalOpacity]     = useState(1);
  const [extrudeDist,      setExtrudeDist]       = useState(0.3);
  const [extrudeAxis,      setExtrudeAxis]       = useState<'x'|'y'|'z'>('y');

  // Create panel
  const [showMainCreate, setShowMainCreate] = useState(false);
  const [showMainEdit,   setShowMainEdit]   = useState(false);
  const [showTextures, setShowTextures] = useState(false);
  const [showMesh,    setShowMesh]    = useState(false);
  const [showRender,  setShowRender]  = useState(false);
  const [showCodeExporter, setShowCodeExporter] = useState(false);
  const [showWireframeModal, setShowWireframeModal] = useState(false);
  const [showFile,    setShowFile]    = useState(false);
  const [showView,    setShowView]    = useState(false);
  const [createTab,   setCreateTab]   = useState<
    'primitivo'|'nurbs'|'volumetric'|'particles'|'polygon'|'arc'|'lathe'|'sweep'|'loft'|'silueta'|'ingenieria'|'dibujar'|'geometria'|'generar'
  >('primitivo');
  const [editTab,     setEditTab]     = useState<'seleccion'|'transformar'|'modificar'|'malla'|'acciones'>('seleccion');

  // Polygon
  const [polySides,  setPolySides]  = useState(6);
  const [polyRadius, setPolyRadius] = useState(1);
  // Arc
  const [arcR,       setArcR]       = useState(1);
  const [arcStart,   setArcStart]   = useState(0);
  const [arcEnd,     setArcEnd]     = useState(360);
  const [arcSegs,    setArcSegs]    = useState(32);
  const [arcFilled,  setArcFilled]  = useState(true);
  // Lathe
  const [lathePreset, setLathePreset] = useState<keyof typeof LATHE_PRESETS>('columna');
  const [latheSegs,   setLatheSegs]   = useState(16);
  const [latheH,      setLatheH]      = useState(2);
  // Sweep
  const [sweepProf,     setSweepProf]     = useState<keyof typeof SWEEP_PROFILES>('círculo');
  const [sweepPath,     setSweepPath]     = useState<'recto'|'arco'|'hélice'>('recto');
  const [sweepLen,      setSweepLen]      = useState(3);
  const [sweepSegs,     setSweepSegs]     = useState(16);
  // Loft
  const [loftS1, setLoftS1] = useState<'círculo'|'cuadrado'|'estrella'>('círculo');
  const [loftS2, setLoftS2] = useState<'círculo'|'cuadrado'|'estrella'>('cuadrado');
  const [loftH,  setLoftH]  = useState(2);
  const [loftN,  setLoftN]  = useState(8);
  // Silueta: state in <SiluetaTab/>
  // Herramientas avanzadas
  const [advTab,      setAdvTab]      = useState<'extrude'|'chamfer'|'offset'|'array'|'cap'|'separate'>('extrude');
  const [advChamferD, setAdvChamferD] = useState(0.08);
  const [advChamferA, setAdvChamferA] = useState(30);
  const [advOffsetD,  setAdvOffsetD]  = useState(0.05);
  const [advArrType,  setAdvArrType]  = useState<'linear'|'polar'>('linear');
  const [advArrCount, setAdvArrCount] = useState(3);
  const [advArrStepX, setAdvArrStepX] = useState(1.5);
  const [advArrStepY, setAdvArrStepY] = useState(0);
  const [advArrStepZ, setAdvArrStepZ] = useState(0);
  const [advArrAngle, setAdvArrAngle] = useState(360);
  const [advArrAxis,  setAdvArrAxis]  = useState<'x'|'y'|'z'>('y');
  // Torno libre
  const [latPickedId, setLatPickedId] = useState<string|null>(null);
  const [latAxis,     setLatAxis]     = useState<'x'|'y'|'z'>('y');
  const [latAngle,    setLatAngle]    = useState(360);
  const [latSegs,     setLatSegs]     = useState(32);
  const [latOffset,   setLatOffset]   = useState(0);
  // Sweep/Loft desde escena
  const [sweepPickProfile, setSweepPickProfile] = useState<string|null>(null);
  const [sweepPickPath,    setSweepPickPath]    = useState<string|null>(null);
  const [loftPickA,        setLoftPickA]        = useState<string|null>(null);
  const [loftPickB,        setLoftPickB]        = useState<string|null>(null);
  const [exportWithThumbnail, setExportWithThumbnail] = useState<boolean>(true);

  const setT = useContext(TooltipContext);
  const [tooltip, setTooltip] = useState<{label:string; shortcut?: string; rect:DOMRect}|null>(null);
  const tooltipTimeoutRef = useRef<any>(null);

  const handleHover = (label:string|null, rect?:DOMRect, shortcut?: string) => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    if (label && rect) {
      tooltipTimeoutRef.current = setTimeout(() => {
        setTooltip({label, rect, shortcut});
      }, 600);
    } else {
      setTooltip(null);
    }
  };

  const mirrorRef     = useRef<HTMLDivElement>(null);
  const refPanelRef   = useRef<HTMLDivElement>(null);
  const opacityRef    = useRef<HTMLDivElement>(null);
  const mainCreateRef = useRef<HTMLDivElement>(null);
  const mainEditRef   = useRef<HTMLDivElement>(null);
  const textureRef    = useRef<HTMLDivElement>(null);
  const meshRef       = useRef<HTMLDivElement>(null);
  const fileRef       = useRef<HTMLDivElement>(null);
  const viewRef       = useRef<HTMLDivElement>(null);

  const selectedObject = project.objects.find(o => o.id === selectedObjectId);
  const hasSel     = !!selectedObjectId;
  // ── FIX: flat primitives (PLANE, RING, CIRCLE) are also extrudable ────────
  const EXTRUDABLE = ['SHAPE','PLANE','RING','CIRCLE'];
  const isExtrudable = EXTRUDABLE.includes(selectedObject?.type ?? '');
  const canExtrude   = editMode === 'FACE' && selectedFaceIndices.length > 0;

  // ── Close panels on outside click ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (mirrorRef.current   && !mirrorRef.current.contains(e.target as Node))   setShowMirror(false);
      if (refPanelRef.current && !refPanelRef.current.contains(e.target as Node)) setShowRef(false);
      if (opacityRef.current  && !opacityRef.current.contains(e.target as Node))  setShowOpacity(false);
      if (mainCreateRef.current && !mainCreateRef.current.contains(e.target as Node)) setShowMainCreate(false);
      if (mainEditRef.current   && !mainEditRef.current.contains(e.target as Node))   setShowMainEdit(false);
      if (textureRef.current  && !textureRef.current.contains(e.target as Node))  setShowTextures(false);
      if (meshRef.current     && !meshRef.current.contains(e.target as Node))     setShowMesh(false);
      if (fileRef.current     && !fileRef.current.contains(e.target as Node))     setShowFile(false);
      if (viewRef.current     && !viewRef.current.contains(e.target as Node))     setShowView(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA') return;
      if (e.ctrlKey||e.metaKey) {
        const k = e.key.toLowerCase();
        if (k==='z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
          return;
        }
        if (k==='y') { e.preventDefault(); redo(); return; }
        if (k==='s') {
          e.preventDefault();
          if (e.shiftKey) {
            handleSaveAs();
          } else {
            handleSave();
          }
          return;
        }
        if (k==='c') { e.preventDefault(); copyObject(); return; }
        if (k==='v') { e.preventDefault(); pasteObject(); return; }
        if (k==='d') { e.preventDefault(); if(selectedObjectId)duplicateObject(selectedObjectId); return; }
        return;
      }
      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsModal(prev => !prev);
        return;
      }
      switch(e.key){
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
        case 'Escape':
          setTransformMode('universal');
          break;
        case 'Tab':
          e.preventDefault();
          setEditMode(editMode==='OBJECT'?'FACE':'OBJECT');
          break;
        case 'Delete': case 'Backspace':
          if (editMode==='OBJECT'&&selectedObjectId) useStore.getState().removeObject(selectedObjectId);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editMode, selectedObjectId, project]);

  // ── File ops ──────────────────────────────────────────────────────────────
  const isFaceSnapDemoModalOpen = useStore(s => s.isFaceSnapDemoModalOpen);
  const closeFaceSnapDemoModal = useStore(s => s.closeFaceSnapDemoModal);
  const [isExporting, setIsExporting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showFaceSnapDemoModal, setShowFaceSnapDemoModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveModalMode, setSaveModalMode] = useState<'save' | 'save_as' | 'open'>('save');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasBeenExplicitlySaved, setHasBeenExplicitlySaved] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(curr => curr === msg ? null : curr);
    }, 4000);
  };

  const handleReset = () => {
    setShowResetModal(true);
  };

  const handleSave = () => {
    // If saving for the first time or still default name, prompt the user with default "Nuevo Proyecto"
    if (!hasBeenExplicitlySaved && (project.name === 'Nuevo Proyecto' || !project.name)) {
      setSaveModalMode('save');
      setShowSaveModal(true);
    } else {
      // Overwrite existing scene directly
      saveSceneToStorage(project);
      setHasBeenExplicitlySaved(true);
      showToast(`✓ Proyecto "${project.name}" sobreescrito y guardado correctamente.`);
    }
  };

  const handleSaveAs = () => {
    setSaveModalMode('save_as');
    setShowSaveModal(true);
  };

  const handleOpenSavedScenes = () => {
    setSaveModalMode('open');
    setShowSaveModal(true);
  };

  const handleLoad = () => {
    const input = document.createElement('input'); input.type='file'; input.accept='.json';
    input.onchange=(e:any)=>{
      const reader = new FileReader();
      reader.onload=(ev:any)=>{
        try {
          const parsed = JSON.parse(ev.target.result);
          setProject(parsed);
          setHasBeenExplicitlySaved(true);
          showToast(`✓ Proyecto "${parsed.name || 'Cargado'}" importado.`);
        } catch {
          alert('Error al cargar archivo JSON.');
        }
      };
      reader.readAsText(e.target.files[0]);
    };
    input.click();
  };
  const handleExportSTL = async () => {
    if (isExporting) return;
    const visible = project.objects.filter(o => o.visible);
    if (visible.length === 0) { alert('No hay nada que exportar'); return; }
    setIsExporting(true);
    try {
      const baseName = project.name || 'export';
      await Exporter.exportSTL(visible, project.materials, baseName);
      if (exportWithThumbnail) {
        downloadViewportSnapshot(`${baseName}_miniatura.png`);
      }
    } catch (e) {
      console.error('Export STL failed', e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportOBJ = async () => {
    if (isExporting) return;
    const visible = project.objects.filter(o => o.visible);
    if (visible.length === 0) { alert('No hay nada que exportar'); return; }
    setIsExporting(true);
    try {
      const baseName = project.name || 'export';
      await Exporter.exportOBJ(visible, project.materials, baseName);
      if (exportWithThumbnail) {
        downloadViewportSnapshot(`${baseName}_miniatura.png`);
      }
    } catch (e) {
      console.error('Export OBJ failed', e);
    } finally {
      setIsExporting(false);
    }
  };

  const getInterpolatedTransform = (obj: any, time: number) => {
    const kfs = obj.keyframes;
    if (!kfs || kfs.length === 0) return obj.transform;
    const sorted = [...kfs].sort((a: any, b: any) => a.time - b.time);
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

  const handleExportGLTF = async (binary = false) => {
    if (isExporting) return;
    const visible = project.objects.filter(o => o.visible);
    if (visible.length === 0) { alert('No hay nada que exportar'); return; }
    setIsExporting(true);
    try {
      const baseName = project.name || 'export';
      await Exporter.exportGLTF(visible, project.materials, binary, baseName);
      if (exportWithThumbnail) {
        downloadViewportSnapshot(`${baseName}_miniatura.png`);
      }
    } catch (e) {
      console.error('Export GLTF failed', e);
    } finally {
      setIsExporting(false);
    }
  };
  const handleCopyJSON    = () => navigator.clipboard.writeText(JSON.stringify(project,null,2)).then(()=>alert('JSON copiado'));
  const handleFullscreen  = () => { if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{}); else document.exitFullscreen(); };
  const handleImport = () => {
    const input = document.createElement('input'); input.type='file'; input.accept='.obj,.stl,.gltf,.glb';
    input.onchange=async(e:any)=>{
      const file:File=e.target.files[0]; if(!file) return;
      const ext=file.name.split('.').pop()?.toLowerCase();
      const baseName=file.name.split('.').slice(0,-1).join('.')||'Importado';
      const geos: { geo?: THREE.BufferGeometry; name?: string; mat?: THREE.Material; csgObj?: CSGObject; materials?: any[] }[] = [];

      const computeAutoFitTransform = (
        target: THREE.Object3D | THREE.BufferGeometry,
        targetSize = 3.0
      ): { scale: [number, number, number]; position: [number, number, number] } => {
        const box = new THREE.Box3();
        if ((target as THREE.BufferGeometry).isBufferGeometry) {
          const geo = target as THREE.BufferGeometry;
          geo.computeBoundingBox();
          if (geo.boundingBox) box.copy(geo.boundingBox);
        } else {
          box.setFromObject(target as THREE.Object3D);
        }

        if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) {
          return { scale: [1, 1, 1], position: [0, 0, 0] };
        }

        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);

        const center = new THREE.Vector3();
        box.getCenter(center);

        let scaleFactor = 1.0;
        if (maxDim > 0 && (maxDim > 6.0 || maxDim < 0.2)) {
          scaleFactor = targetSize / maxDim;
          scaleFactor = safeParseFixed(scaleFactor, 4, 1);
        }

        let posX = 0;
        let posY = 0;
        let posZ = 0;

        if (scaleFactor !== 1.0 || Math.abs(center.x) > maxDim * 0.1 || Math.abs(center.z) > maxDim * 0.1) {
          posX = -center.x * scaleFactor;
          posZ = -center.z * scaleFactor;
        }

        if (scaleFactor !== 1.0 || Math.abs(box.min.y) > maxDim * 0.1) {
          posY = -box.min.y * scaleFactor;
        }

        return {
          scale: [scaleFactor, scaleFactor, scaleFactor],
          position: [
            safeParseFixed(posX, 3, 0),
            safeParseFixed(posY, 3, 0),
            safeParseFixed(posZ, 3, 0),
          ],
        };
      };

      const getStatsFromObject = (obj: THREE.Object3D | THREE.BufferGeometry) => {
        let vertices = 0;
        let faces = 0;
        if ((obj as THREE.BufferGeometry).isBufferGeometry) {
          const geo = obj as THREE.BufferGeometry;
          vertices += geo.attributes.position ? geo.attributes.position.count : 0;
          faces += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
        } else {
          (obj as THREE.Object3D).traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const geo = (child as THREE.Mesh).geometry;
              vertices += geo.attributes.position ? geo.attributes.position.count : 0;
              faces += geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
            }
          });
        }
        return { vertices: Math.floor(vertices), faces: Math.floor(faces) };
      };

      // ── CRÍTICO: leer el archivo como base64 DataURL, no como blob URL.
      // Los blob URLs (URL.createObjectURL) son temporales y se invalidan cuando
      // el componente se desmonta o el proyecto se guarda/recarga.
      const readAsDataURL = (f: File): Promise<string> =>
        new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload  = ev => res(ev.target!.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(f);
        });

      try{
        const dataURL = await readAsDataURL(file);
        
        if(ext==='stl'){
          // Para STL necesitamos un blob URL temporal SOLO para el loader, pero guardamos el dataURL
          const blobUrl = URL.createObjectURL(file);
          const geo = await new Promise<THREE.BufferGeometry>((resolve, reject) => new STLLoader().load(blobUrl, resolve, undefined, reject));
          URL.revokeObjectURL(blobUrl);
          const stats = getStatsFromObject(geo);
          const autoTransform = computeAutoFitTransform(geo);
          const csgObj: CSGObject = {
            id: Math.random().toString(36).substr(2, 9),
            name: baseName,
            type: 'MESH',
            operation: 'ADD',
            transform: { position: autoTransform.position, rotation: [0, 0, 0], scale: autoTransform.scale },
            parameters: {},
            vertices: [],
            faces: [],
            color: '#cccccc',
            opacity: 1,
            visible: true,
            keyframes: [],
            meshData: { type: 'stl', data: dataURL },
            stats
          };
          geos.push({ csgObj });
        }
        else if(ext==='obj'){
          const blobUrl = URL.createObjectURL(file);
          const object = await new Promise<THREE.Object3D>((resolve, reject) => new OBJLoader().load(blobUrl, resolve, undefined, reject));
          URL.revokeObjectURL(blobUrl);
          const stats = getStatsFromObject(object);
          const extractedMaterials = extractPBRMaterialsFromObject3D(object, baseName);
          const autoTransform = computeAutoFitTransform(object);
          const primaryMat = extractedMaterials[0];
          
          const csgObj: CSGObject = {
            id: Math.random().toString(36).substr(2, 9),
            name: baseName,
            type: 'MESH',
            operation: 'ADD',
            transform: { position: autoTransform.position, rotation: [0, 0, 0], scale: autoTransform.scale },
            parameters: {},
            vertices: [],
            faces: [],
            color: '#ffffff',
            opacity: 1,
            visible: true,
            keyframes: [],
            meshData: { type: 'obj', data: dataURL },
            stats,
            materialId: undefined,
            material: undefined,
          };
          geos.push({ csgObj, materials: extractedMaterials });
        }
        else if(ext==='gltf'||ext==='glb'){
          await new Promise<void>((resolve,reject)=>{
            const loader = new GLTFLoader();
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
            loader.setDRACOLoader(dracoLoader);
            // Usar dataURL directamente — funciona con GLTFLoader y persiste
            loader.load(dataURL,gltf=>{
              const animations = gltf.animations;
              const scene = gltf.scene;
              const stats = getStatsFromObject(scene);
              const extractedMaterials = extractPBRMaterialsFromObject3D(scene, baseName);
              const autoTransform = computeAutoFitTransform(scene);
              const primaryMat = extractedMaterials[0];
              
              const maxDuration = Math.max(...animations.map(a => a.duration), 0);
              const fps = 24;
              const sampleTimes = [];
              for (let t = 0; t <= maxDuration; t += 1/fps) { sampleTimes.push(t); }
              if (sampleTimes.length === 0 || sampleTimes[sampleTimes.length - 1] < maxDuration) {
                sampleTimes.push(maxDuration);
              }
              const hasAnimations = animations.length > 0;

              const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
              let meshIdx = 0;
              scene.traverse((child: any) => {
                if (child.isMesh) {
                  const geometry = child.geometry;
                  const verts = geometry?.attributes.position ? geometry.attributes.position.count : 0;
                  const faces = geometry?.index ? geometry.index.count / 3 : verts / 3;
                  meshesList.push({
                    id: `mesh-${meshIdx++}`,
                    name: child.name || 'Unnamed Mesh',
                    vertices: Math.floor(verts),
                    faces: Math.floor(faces)
                  });
                }
              });

              const csgObj: CSGObject = {
                id: Math.random().toString(36).substr(2, 9),
                name: baseName,
                type: 'MESH',
                operation: 'ADD',
                transform: { position: autoTransform.position, rotation: [0, 0, 0], scale: autoTransform.scale },
                parameters: {},
                vertices: [],
                faces: [],
                color: '#ffffff',
                opacity: 1,
                visible: true,
                keyframes: [],
                meshData: {
                  type: 'gltf',
                  data: dataURL,   // base64 — persiste tras guardar/recargar
                  animations: animations.map(a => a.toJSON()),
                  meshes: meshesList
                },
                stats,
                materialId: undefined,
                material: undefined,
              };

              if (hasAnimations) {
                const keyframes: any[] = [];
                const mixer = new THREE.AnimationMixer(scene);
                animations.forEach((clip: THREE.AnimationClip) => { mixer.clipAction(clip).play(); });

                sampleTimes.forEach(t => {
                  mixer.setTime(t);
                  scene.updateMatrixWorld(true);
                  const worldPos = new THREE.Vector3();
                  const worldQuat = new THREE.Quaternion();
                  const worldScale = new THREE.Vector3();
                  scene.matrixWorld.decompose(worldPos, worldQuat, worldScale);
                  const euler = new THREE.Euler().setFromQuaternion(worldQuat);
                  keyframes.push({
                    id: Math.random().toString(36).substr(2, 9),
                    time: t,
                    transform: {
                      position: [worldPos.x, worldPos.y, worldPos.z] as [number,number,number],
                      rotation: [euler.x, euler.y, euler.z] as [number,number,number],
                      scale: [worldScale.x, worldScale.y, worldScale.z] as [number,number,number],
                    }
                  });
                });
                csgObj.keyframes = keyframes;
                if (keyframes.length > 0) csgObj.transform = { ...keyframes[0].transform };
              }

              geos.push({ csgObj, materials: extractedMaterials });
              
              // Update project duration if needed
              if (hasAnimations) {
                const maxTime = Math.max(...sampleTimes);
                const curProject = useStore.getState().project;
                if (maxTime > curProject.duration) {
                  useStore.getState().setProject({ ...curProject, duration: Math.ceil(maxTime) });
                }
              }

              resolve();
            },undefined,reject);
          });
        }
        else{alert('Usa OBJ, STL, GLTF o GLB');return;}
        if(geos.length===0){alert('No se encontraron mallas');return;}
        const cur=useStore.getState().project;
        
        const newObjects = geos.map((g: any) => g.csgObj || bufferGeomToCSGObject(g.geo, g.name, g.mat));
        const newMaterials = [...cur.materials];
        geos.forEach((g: any) => {
          if (g.materials && g.materials.length > 0) {
            g.materials.forEach((m: any) => {
              if (!newMaterials.find(existing => existing.id === m.id)) {
                newMaterials.push(m);
              }
            });
          }
        });

        const firstNewObj = newObjects[0];
        const firstMat = geos[0]?.materials?.[0];

        useStore.getState().setProject({...cur, objects:[...cur.objects, ...newObjects], materials: newMaterials});
        if (firstNewObj) {
          useStore.getState().selectObject(firstNewObj.id);
          if (firstMat) {
            useStore.getState().setMaterialStudioMaterialId(firstMat.id);
          }
        }
        useStore.getState().saveHistory(`Importar ${firstNewObj?.name || 'Modelo'}`, 'create');
      }catch(err:any){alert('Error al importar: '+(err?.message??String(err)));}
    };
    input.click();
  };
  const loadRefImage = (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = await fileToDataURL(file);
      setReference(view, { url });
    };
    input.click();
  };

  // ── addGeneratedObject ───────────────────────────────────────────────────
  const addGen = (vertices:V3[], faces:MeshFace[], name:string, type: any = 'CUBE', params: any = {}) => {
    if (!vertices.length||!faces.length){alert('Error generando geometría');return;}
    const obj:CSGObject={
      id:Math.random().toString(36).substr(2,9),name,type: 'CUBE',operation:'ADD',
      transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},
      parameters:params,vertices,faces,
      color:'#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
      opacity:1,visible:true,keyframes:[],vertexOffsets:{},
    };
    const cur=useStore.getState().project;
    useStore.getState().setProject({...cur,objects:[...cur.objects,obj]});
    useStore.getState().saveHistory();
    setShowMainCreate(false);
  };

  const getLoftSec=(t:'círculo'|'cuadrado'|'estrella',y:number,n:number):V3[]=>
    t==='círculo'?circleSection(0.5,y,n):t==='cuadrado'?squareSection(1,y):starSection(0.5,0.25,4,y);

  const addEngTool=(obj:CSGObject)=>{
    const cur=useStore.getState().project;
    useStore.getState().setProject({...cur,objects:[...cur.objects,obj]});
    useStore.getState().saveHistory();
    setShowMainCreate(false);
  };

  // toPath removed — silhouette tab now uses image uploads


  return (
    <TooltipContext.Provider value={handleHover}>
      <motion.div
        layout drag={isFloating} dragMomentum={false}
        className={`bg-zinc-950 border border-zinc-800 flex items-center px-3 justify-between text-zinc-300 select-none relative z-[50] transition-all duration-300 ${
          isFloating
            ? 'fixed top-20 left-1/2 -translate-x-1/2 rounded-xl shadow-2xl border-white/10 p-1 h-auto flex-col gap-2 w-auto max-w-[95vw]'
            : 'h-11 border-b w-full min-w-0 flex-nowrap gap-1.5 overflow-x-auto overflow-y-visible'
        }`}
        style={!isFloating?{overflowX:'visible',overflowY:'visible',scrollbarWidth:'thin',scrollbarColor:'#3f3f46 transparent'}:{}}
      >
        {isFloating && (
          <div className="w-full flex items-center justify-center py-1 cursor-grab active:cursor-grabbing border-b border-white/5 mb-1">
            <GripVertical size={14} className="text-zinc-600 rotate-90"/>
          </div>
        )}

        <div className={`flex items-center gap-1.5 flex-shrink-0 ${isFloating?'flex-wrap justify-center':'flex-nowrap'}`}>

          {/* Brand */}
          {!isFloating&&<><div className="flex items-center gap-2 flex-shrink-0"><div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-bold text-sm">R</div><span className="font-bold text-sm tracking-tight hidden lg:block">CSG Pro</span></div><Sep/></>}

          {/* ── Archivo ── */}
          <Dropdown label="Archivo" icon={<FolderOpen size={14}/>} isOpen={showFile} setIsOpen={setShowFile} containerRef={fileRef} width={205}>
            <button onClick={()=>{handleSave();setShowFile(false);}} className="flex items-center justify-between w-full px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-white font-medium">
              <span className="flex items-center gap-2"><Save size={14} className="text-indigo-400"/> Guardar</span>
              <kbd className="text-[9px] text-zinc-500 font-mono">Ctrl+S</kbd>
            </button>
            <button onClick={()=>{handleSaveAs();setShowFile(false);}} className="flex items-center justify-between w-full px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-zinc-200">
              <span className="flex items-center gap-2"><Save size={14} className="text-zinc-400"/> Guardar como...</span>
              <kbd className="text-[9px] text-zinc-500 font-mono">Ctrl+Shift+S</kbd>
            </button>
            <button onClick={()=>{handleOpenSavedScenes();setShowFile(false);}} className="flex items-center justify-between w-full px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-indigo-300 font-medium">
              <span className="flex items-center gap-2"><FolderOpen size={14} className="text-indigo-400"/> Mis Escenas Guardadas</span>
            </button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button onClick={()=>{handleLoad();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><FolderOpen size={14}/> Abrir archivo .json</button>
            <button onClick={()=>{handleImport();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Upload size={14}/> Importar 3D (STL/OBJ/GLTF)</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button onClick={()=>{handleReset();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-rose-400 font-medium"><RotateCcw size={14}/> Reiniciar Proyecto</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <div className="px-2.5 py-1.5 bg-zinc-950/70 rounded-md border border-zinc-800/80 my-1">
              <label className="flex items-center justify-between gap-2 text-[10.5px] text-zinc-300 cursor-pointer select-none">
                <span className="flex items-center gap-1.5">
                  <Camera size={13} className="text-cyan-400" />
                  <span>Adjuntar miniatura (.png) al exportar</span>
                </span>
                <input
                  type="checkbox"
                  checked={exportWithThumbnail}
                  onChange={e => setExportWithThumbnail(e.target.checked)}
                  className="w-3.5 h-3.5 accent-cyan-500 rounded cursor-pointer"
                />
              </label>
            </div>
            <button onClick={()=>{downloadViewportSnapshot(`${project.name || 'escena'}_captura.png`);setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-cyan-300 font-medium">
              <Camera size={14} className="text-cyan-400"/> Capturar Imagen del Visor (PNG)
            </button>
            <button onClick={()=>{handleExportSTL();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Download size={14}/> Exportar STL {exportWithThumbnail && <span className="text-[9px] text-cyan-400/80 font-mono ml-auto">+img</span>}</button>
            <button onClick={()=>{handleExportOBJ();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Download size={14}/> Exportar OBJ {exportWithThumbnail && <span className="text-[9px] text-cyan-400/80 font-mono ml-auto">+img</span>}</button>
            <button onClick={()=>{handleExportGLTF(false);setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Download size={14}/> Exportar GLTF {exportWithThumbnail && <span className="text-[9px] text-cyan-400/80 font-mono ml-auto">+img</span>}</button>
            <button onClick={()=>{handleExportGLTF(true);setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Download size={14}/> Exportar GLB {exportWithThumbnail && <span className="text-[9px] text-cyan-400/80 font-mono ml-auto">+img</span>}</button>
            <button onClick={()=>{setShowWireframeModal(true);setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-emerald-300 font-semibold bg-emerald-950/40 border border-emerald-800/30"><Grid size={14} className="text-emerald-400"/> Exportar Estructura Alámbrica 3D...</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button onClick={()=>{setShowCodeExporter(true);setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors text-indigo-300 font-semibold bg-indigo-950/40"><Code size={14} className="text-indigo-400"/> Exportar Código Three.js</button>
            <button onClick={()=>{handleCopyJSON();setShowFile(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Code size={14} className="text-zinc-500"/> Copiar JSON (Proyecto)</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button
              onClick={() => {
                setShowFaceSnapDemoModal(true);
                setShowFile(false);
              }}
              className="flex items-center justify-between w-full px-3 py-2 text-[11px] text-left hover:bg-amber-950/60 rounded transition-colors text-amber-300 font-bold bg-amber-950/30 border border-amber-500/30 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-amber-400" />
                <span>Demos: Snapping y Ajuste a Superficies</span>
              </span>
              <span className="px-1.5 py-0.5 text-[8.5px] uppercase font-bold bg-amber-500/30 text-amber-200 rounded">
                Paso a Paso
              </span>
            </button>
          </Dropdown>

          {/* ── Deshacer / Rehacer (Siempre Visibles) ── */}
          <div className="flex items-center gap-0.5 flex-shrink-0 bg-zinc-900/60 p-0.5 rounded-lg border border-zinc-800" title="Deshacer / Rehacer">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="p-1.5 rounded hover:bg-zinc-700/80 text-zinc-200 disabled:opacity-25 disabled:hover:bg-transparent transition-all flex items-center justify-center active:scale-95"
              title="Deshacer (Ctrl+Z)"
            >
              <Undo2 size={16} />
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className="p-1.5 rounded hover:bg-zinc-700/80 text-zinc-200 disabled:opacity-25 disabled:hover:bg-transparent transition-all flex items-center justify-center active:scale-95"
              title="Rehacer (Ctrl+Y)"
            >
              <Redo2 size={16} />
            </button>
          </div>
          <Sep/>

          {/* ── Crear (Grouped) ── */}
          <div className="relative flex-shrink-0" ref={mainCreateRef}>
            <button onClick={()=>setShowMainCreate(v=>!v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-all border ${
                showMainCreate
                  ? 'bg-violet-600 text-white border-violet-400 shadow-lg'
                  : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-violet-800 hover:text-white hover:border-violet-600'
              }`}>
              <Plus size={13}/> <span className="hidden sm:inline">Crear</span>
              <ChevronDown size={10} className={`transition-transform ${showMainCreate?'rotate-180':''}`}/>
            </button>

            <AnimatePresence>
              {showMainCreate && (
                <motion.div
                  drag
                  dragMomentum={false}
                  initial={{opacity:0,y:-8,scale:0.97}}
                  animate={{opacity:1,y:0,scale:1}}
                  exit={{opacity:0,y:-8,scale:0.97}}
                  transition={{duration:0.15}}
                  className="fixed z-[200] mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
                  style={{
                    top: mainCreateRef.current?.getBoundingClientRect().bottom,
                    left: Math.min(mainCreateRef.current?.getBoundingClientRect().left??0, window.innerWidth-448),
                    width: 440,
                    maxWidth: '95vw',
                    maxHeight: '88vh',
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 cursor-grab active:cursor-grabbing select-none bg-zinc-950/40">
                    <div className="flex items-center gap-1.5">
                      <GripVertical size={13} className="text-zinc-500" />
                      <p className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">Panel de Creación</p>
                    </div>
                    <button onClick={()=>setShowMainCreate(false)} className="text-zinc-500 hover:text-zinc-300"><X size={14}/></button>
                  </div>

                  {/* Tab strip */}
                  <div className="grid grid-cols-7 border-b border-zinc-800">
                    {([
                      {id:'primitivo', label:'Figuras',      icon:'⬛'},
                      {id:'nurbs',     label:'NURBS',        icon:'〰️'},
                      {id:'particles', label:'Partículas',   icon:'✨'},
                      {id:'volumetric',label:'Volúmenes',    icon:'🔥'},
                      {id:'dibujar',   label:'Dibujar',      icon:'✏️'},
                      {id:'geometria', label:'Geometría',    icon:'⬡'},
                      {id:'generar',   label:'Generar',      icon:'🌀'},
                    ] as const).map(tab=>(
                      <button key={tab.id} onClick={()=>setCreateTab(tab.id)}
                        className={`flex flex-col items-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors border-b-2 ${
                          createTab===tab.id || (tab.id==='geometria' && (createTab==='polygon' || createTab==='arc')) || (tab.id==='generar' && (createTab==='lathe' || createTab==='sweep' || createTab==='loft' || createTab==='silueta' || createTab==='ingenieria'))
                            ?'border-violet-500 text-violet-300 bg-zinc-800/80'
                            :'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
                        }`}>
                        <span className="text-sm leading-none">{tab.icon}</span>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto" style={{scrollbarWidth:'thin',scrollbarColor:'#3f3f46 transparent'}}>

                    {/* ════ PARTÍCULAS Y FUERZAS ESPACIALES (FX) ════ */}
                    {createTab==='particles'&&(
                      <div className="space-y-4">
                        <PTitle icon="✨" title="Sistemas de Partículas y Enjambres GPGPU" desc="Enjambres acelerados por GPU (hasta 262k partículas con Curl Noise y Atractores), emisores animados y fuerzas espaciales."/>
                        
                        {/* Enjambre GPGPU */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1.5">
                              <Zap size={13} className="text-cyan-400"/> Enjambre de Partículas GPGPU (GPU Curl Noise)
                            </span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 font-mono font-bold">262k+ GPU</span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            {GPGPU_SWARM_PRESETS.map((s) => (
                              <button key={s.id} onClick={() => {
                                addObject('GPGPU_SWARM');
                                setTimeout(() => {
                                  const selId = useStore.getState().selectedObjectId;
                                  if (selId) {
                                    const cfg = { ...DEFAULT_GPGPU_SWARM_CONFIG, ...s.config };
                                    useStore.getState().updateObject(selId, {
                                      name: `${s.name} ${useStore.getState().project.objects.length}`,
                                      isGpgpuSwarm: true,
                                      gpgpuSwarmConfig: cfg,
                                      color: cfg.colorStart || '#38bdf8',
                                      parameters: { isGpgpuSwarm: true, gpgpuSwarmConfig: cfg }
                                    });
                                    useStore.getState().saveHistory();
                                  }
                                }, 20);
                                setShowMainCreate(false);
                              }}
                                className="flex items-center gap-2.5 p-2.5 bg-zinc-800/60 hover:bg-zinc-700/80 rounded-xl border border-zinc-700/50 hover:border-cyan-500/50 transition-all group cursor-pointer text-left">
                                <div className="text-2xl drop-shadow-md flex-shrink-0 group-hover:scale-110 transition-transform">{s.icon}</div>
                                <div className="min-w-0">
                                  <span className="block text-[11px] font-bold text-zinc-200 group-hover:text-cyan-200 leading-tight truncate">{s.name}</span>
                                  <span className="block text-[9px] text-zinc-400 group-hover:text-zinc-300 line-clamp-1">{s.desc}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Emisores */}
                        <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles size={13} className="text-purple-400"/> Emisores de Partículas (PF Source)
                            </span>
                            <span className="text-[9px] text-zinc-400 font-mono">Tiempo Real</span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2">
                            {PARTICLE_PRESETS.map((p) => (
                              <button key={p.id} onClick={() => {
                                addObject('PARTICLE_SYSTEM');
                                setTimeout(() => {
                                  const selId = useStore.getState().selectedObjectId;
                                  if (selId) {
                                    const cfg = { ...DEFAULT_PARTICLE_CONFIG, ...p.config };
                                    useStore.getState().updateObject(selId, {
                                      name: `${p.name} ${useStore.getState().project.objects.length}`,
                                      isParticleSystem: true,
                                      particleConfig: cfg,
                                      color: cfg.colorStart || '#38bdf8',
                                      parameters: { isParticleSystem: true, particleConfig: cfg }
                                    });
                                    useStore.getState().saveHistory();
                                  }
                                }, 20);
                                setShowMainCreate(false);
                              }}
                                className="flex items-center gap-2.5 p-2.5 bg-zinc-800/60 hover:bg-zinc-700/80 rounded-xl border border-zinc-700/50 hover:border-purple-500/50 transition-all group cursor-pointer text-left">
                                <div className="text-2xl drop-shadow-md flex-shrink-0 group-hover:scale-110 transition-transform">{p.icon}</div>
                                <div className="min-w-0">
                                  <span className="block text-[11px] font-bold text-zinc-200 group-hover:text-white leading-tight truncate">{p.name}</span>
                                  <span className="block text-[9px] text-zinc-400 group-hover:text-zinc-300 line-clamp-1">{p.desc}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Space Warps */}
                        <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                              <Wind size={13} className="text-indigo-400"/> Fuerzas & Deformadores Espaciales (Space Warps)
                            </span>
                            <span className="text-[9px] text-zinc-400 font-mono">Física 3D</span>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {SPACE_WARP_PRESETS.map((w) => (
                              <button key={w.id} onClick={() => {
                                addObject('SPACE_WARP');
                                setTimeout(() => {
                                  const selId = useStore.getState().selectedObjectId;
                                  if (selId) {
                                    const cfg = { ...DEFAULT_SPACE_WARP_CONFIG, ...w.config };
                                    useStore.getState().updateObject(selId, {
                                      name: `${w.name} ${useStore.getState().project.objects.length}`,
                                      isSpaceWarp: true,
                                      warpConfig: cfg,
                                      color: '#a855f7',
                                      parameters: { isSpaceWarp: true, warpConfig: cfg }
                                    });
                                    useStore.getState().saveHistory();
                                  }
                                }, 20);
                                setShowMainCreate(false);
                              }}
                                className="flex items-center gap-2.5 p-2.5 bg-zinc-800/60 hover:bg-zinc-700/80 rounded-xl border border-zinc-700/50 hover:border-indigo-500/50 transition-all group cursor-pointer text-left">
                                <div className="text-2xl drop-shadow-md flex-shrink-0 group-hover:scale-110 transition-transform">{w.icon}</div>
                                <div className="min-w-0">
                                  <span className="block text-[11px] font-bold text-zinc-200 group-hover:text-white leading-tight truncate">{w.name}</span>
                                  <span className="block text-[9px] text-zinc-400 group-hover:text-zinc-300 line-clamp-1">{w.desc}</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ════ NURBS (SUPERFICIES & CURVAS) ════ */}
                    {createTab==='nurbs'&&(
                      <>
                        <PTitle icon="〰️" title="Superficies y Curvas NURBS" desc="Geometría matemática B-Spline no destructiva y de alta precisión (Blender style)."/>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'Curva NURBS', icon: '〰️', desc: 'Curva spline de 4 puntos', fn: () => addObject('NURBS_CURVE') },
                            { label: 'Círculo NURBS', icon: '⭕', desc: 'Círculo racional exacto 9 pts', fn: () => addObject('NURBS_CIRCLE') },
                            { label: 'Superficie Patch', icon: '🟩', desc: 'Malla 4x4 cuadrática/cúbica', fn: () => addObject('NURBS_SURFACE') },
                            { label: 'Cilindro NURBS', icon: '🛢️', desc: 'Superficie cilíndrica pura', fn: () => addObject('NURBS_CYLINDER') },
                            { label: 'Cono NURBS', icon: '🍦', desc: 'Cono racional exacto', fn: () => addObject('NURBS_CONE') },
                            { label: 'Esfera NURBS', icon: '🌐', desc: 'Esfera matemática racional', fn: () => addObject('NURBS_SPHERE') },
                            { label: 'Toroide NURBS', icon: '🍩', desc: 'Toroide racional continuo', fn: () => addObject('NURBS_TORUS') },
                          ].map(p => (
                            <button key={p.label} onClick={() => { p.fn(); setShowMainCreate(false); }}
                              className="flex flex-col items-center gap-1.5 p-3 bg-zinc-800/60 hover:bg-violet-600 rounded-xl border border-zinc-700/50 hover:border-violet-400 transition-all group cursor-pointer text-left">
                              <span className="text-2xl group-hover:scale-110 transition-transform">{p.icon}</span>
                              <span className="text-[10px] font-bold text-center leading-tight text-zinc-200 group-hover:text-white">{p.label}</span>
                              <span className="text-[8px] text-zinc-400 group-hover:text-violet-200 text-center">{p.desc}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* ════ MEDIOS VOLUMÉTRICOS 3D (RAYMARCHING) ════ */}
                    {createTab==='volumetric'&&(
                      <>
                        <PTitle icon="🔥" title="Medios Volumétricos 3D (Raymarching)" desc="Añade fuego, plasma, gases, humo y niebla mediante shaders de raymarching en tiempo real."/>
                        <div className="grid grid-cols-2 gap-2">
                          {VOLUMETRIC_PRESETS.map((p, i) => (
                            <button key={i} onClick={() => {
                              addObject('VOLUME_CLOUD');
                              setTimeout(() => {
                                const selId = useStore.getState().selectedObjectId;
                                if (selId) {
                                  useStore.getState().updateObject(selId, {
                                    name: `${p.name} ${useStore.getState().project.objects.length}`,
                                    isVolumetric: true,
                                    volumetric: p.config,
                                    color: p.config.color || p.color,
                                    parameters: { isVolumetric: true, volumetric: p.config }
                                  });
                                  useStore.getState().saveHistory();
                                }
                              }, 20);
                              setShowMainCreate(false);
                            }}
                              className="flex items-center gap-3 p-3 bg-zinc-800/60 hover:bg-zinc-700/80 rounded-xl border border-zinc-700/50 hover:border-amber-500/50 transition-all group cursor-pointer text-left">
                              <div className="text-2xl drop-shadow-md flex-shrink-0">{p.icon}</div>
                              <div className="min-w-0">
                                <span className="block text-[11px] font-bold text-zinc-200 group-hover:text-white leading-tight truncate">{p.name}</span>
                                <span className="block text-[9px] text-zinc-400 group-hover:text-zinc-300 line-clamp-1">{p.desc}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* ════ GEOMETRÍA SUB-TABS ════ */}
                    {(createTab==='geometria' || createTab==='polygon' || createTab==='arc') && (
                      <div className="flex gap-1 mb-4 p-1 bg-zinc-800/50 rounded-lg">
                        <button onClick={()=>setCreateTab('polygon')} className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${createTab==='polygon'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Polígono</button>
                        <button onClick={()=>setCreateTab('arc')} className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${createTab==='arc'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Arco</button>
                      </div>
                    )}

                    {/* ════ GENERAR SUB-TABS ════ */}
                    {(createTab==='generar' || createTab==='lathe' || createTab==='sweep' || createTab==='loft' || createTab==='silueta' || createTab==='ingenieria') && (
                      <div className="grid grid-cols-3 gap-1 mb-4 p-1 bg-zinc-800/50 rounded-lg">
                        <button onClick={()=>setCreateTab('lathe')} className={`py-1 rounded text-[10px] font-bold transition-colors ${createTab==='lathe'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Torno</button>
                        <button onClick={()=>setCreateTab('sweep')} className={`py-1 rounded text-[10px] font-bold transition-colors ${createTab==='sweep'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Sweep</button>
                        <button onClick={()=>setCreateTab('loft')} className={`py-1 rounded text-[10px] font-bold transition-colors ${createTab==='loft'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Loft</button>
                        <button onClick={()=>setCreateTab('silueta')} className={`py-1 rounded text-[10px] font-bold transition-colors ${createTab==='silueta'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>Silueta</button>
                        <button onClick={()=>setCreateTab('ingenieria')} className={`py-1 rounded text-[10px] font-bold transition-colors ${createTab==='ingenieria'?'bg-violet-600 text-white':'text-zinc-400 hover:bg-zinc-700'}`}>CAD</button>
                      </div>
                    )}

                    {/* ════ FIGURAS (PRIMITIVOS) ════ */}
                    {createTab==='primitivo'&&(
                      <>
                        <PTitle icon="⬛" title="Figuras 3D y 2D" desc="Selecciona una figura geométrica para añadir al escenario."/>
                        <div className="max-h-64 overflow-y-auto pr-1 grid grid-cols-4 gap-1.5 custom-scrollbar">
                          {[
                            {label:'Cubo',       icon:'⬛', fn:()=>addObject('CUBE')},
                            {label:'Esfera',     icon:'⬤', fn:()=>addObject('SPHERE')},
                            {label:'Cilindro',   icon:'⬡', fn:()=>addObject('CYLINDER')},
                            {label:'Cono',       icon:'△', fn:()=>addObject('CONE')},
                            {label:'Pirámide',   icon:'🔺', fn:()=>addObject('PYRAMID')},
                            {label:'Prisma',     icon:'📐', fn:()=>addObject('PRISM')},
                            {label:'Cápsula',    icon:'💊', fn:()=>addObject('CAPSULE')},
                            {label:'Toro',       icon:'◎', fn:()=>addObject('TORUS')},
                            {label:'Icosaedro',  icon:'⬢', fn:()=>addObject('ICOSAHEDRON')},
                            {label:'Dodecaedro', icon:'💎', fn:()=>addObject('DODECAHEDRON')},
                            {label:'Tetraedro',  icon:'🔻', fn:()=>addObject('TETRAHEDRON')},
                            {label:'Octaedro',   icon:'💠', fn:()=>addObject('OCTAHEDRON')},
                            {label:'Tubo 3D',    icon:'⭕', fn:()=>addObject('TUBE')},
                            {label:'Arco 3D',    icon:'🌙', fn:()=>addObject('ARC')},
                            {label:'Estrella 3D',icon:'⭐', fn:()=>addObject('STAR')},
                            {label:'Cuña',       icon:'⬕', fn:()=>addObject('WEDGE')},
                            {label:'Hemisferio', icon:'🌓', fn:()=>addObject('HEMISPHERE')},
                            {label:'Plano',      icon:'▭', fn:()=>addObject('PLANE')},
                            {label:'Plano Quads (100x100)', icon:'▦', fn:()=>{
                              const selId = useStore.getState().selectedObjectId;
                              const targetObj = selId ? project.objects.find(o => o.id === selId) : undefined;
                              const plane = createRetopoQuadPlane({
                                targetObj,
                                subdivisions: 100,
                                orientation: 'FRONT'
                              });
                              addObject(plane);
                              useStore.getState().selectObject(plane.id);
                            }},
                            {label:'Cage Silueta (64x64)', icon:'🌐', fn:()=>{
                              const selId = useStore.getState().selectedObjectId;
                              const targetObj = selId ? project.objects.find(o => o.id === selId) : undefined;
                              const cage = createRetopoCage({
                                targetObj,
                                subdivisions: 64,
                                shape: 'ELLIPSOID'
                              });
                              addObject(cage);
                              useStore.getState().selectObject(cage.id);
                            }},
                            {label:'Anillo',     icon:'○', fn:()=>addObject('RING')},
                            {label:'Círculo',    icon:'⚪', fn:()=>addObject('CIRCLE')},
                          ].map(p=>(
                            <button key={p.label} onClick={()=>{p.fn();setShowMainCreate(false);}}
                              className="flex flex-col items-center gap-1 p-2 bg-zinc-800/50 hover:bg-violet-600 rounded-lg transition-all group">
                              <span className="text-xl group-hover:scale-110 transition-transform">{p.icon}</span>
                              <span className="text-[9px] font-bold text-center leading-tight">{p.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {/* ════ DIBUJAR ════ */}
                    {createTab==='dibujar'&&(
                      <>
                        <PTitle icon="✏️" title="Herramientas de Dibujo" desc="Dibuja formas 2D en el plano."/>
                        <div className="grid grid-cols-3 gap-2">
                          <button onClick={()=>{setDrawMode(drawMode==='line'?null:'line');setShowMainCreate(false);}} 
                            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${drawMode==='line'?'bg-indigo-600 border-indigo-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}>
                            <Pencil size={20}/><span className="text-[10px] font-bold">Línea</span>
                          </button>
                          <button onClick={()=>{setDrawMode(drawMode==='rect'?null:'rect');setShowMainCreate(false);}} 
                            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${drawMode==='rect'?'bg-indigo-600 border-indigo-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}>
                            <SquareDashed size={20}/><span className="text-[10px] font-bold">Rectángulo</span>
                          </button>
                          <button onClick={()=>{setDrawMode(drawMode==='bezier'?null:'bezier');setShowMainCreate(false);}} 
                            className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all ${drawMode==='bezier'?'bg-indigo-600 border-indigo-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}>
                            <Spline size={20}/><span className="text-[10px] font-bold">Curva Bézier</span>
                          </button>
                        </div>
                        <div className="mt-4 p-3 bg-zinc-800/30 rounded-lg border border-zinc-800">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-zinc-400">Color de trazo</span>
                            <div className="flex items-center gap-2">
                              <input type="color" value={useStore.getState().drawColor} onChange={e=>useStore.getState().setDrawColor(e.target.value)} className="w-8 h-8 rounded border-0 bg-transparent cursor-pointer p-0"/>
                              <span className="text-[10px] font-mono text-zinc-500 uppercase">{useStore.getState().drawColor}</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {/* ════ POLÍGONO ════ */}
                    {createTab==='polygon'&&(
                      <>
                        <PTitle icon="⬡" title="Polígono Regular" desc="Forma N-lateral: triángulo, hexágono, octógono…"/>
                        {/* Preview visual del polígono */}
                        <div className="flex justify-center">
                          <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-24 h-24 bg-zinc-800 rounded-lg border border-zinc-700">
                            <polygon points={Array.from({length:polySides},(_, i)=>{const a=(i/polySides)*Math.PI*2-Math.PI/2;return `${Math.cos(a)*0.9},${Math.sin(a)*0.9}`;}).join(' ')}
                              fill="#7c3aed33" stroke="#7c3aed" strokeWidth="0.05"/>
                          </svg>
                        </div>
                        <CRow label="Lados">
                          <input type="range" min={3} max={16} value={polySides} onChange={e=>setPolySides(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/>
                          <CVal>{polySides}</CVal>
                        </CRow>
                        <CRow label="Radio">
                          <input type="number" min={0.1} step={0.1} value={polyRadius} onChange={e=>setPolyRadius(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/>
                        </CRow>
                        <div className="grid grid-cols-3 gap-1">
                          {[['Triángulo',3],['Cuadrado',4],['Hexágono',6],['Octógono',8],['Decágono',10],['12-lado',12]].map(([n,s])=>(
                            <PresetBtn key={n as string} label={n as string} active={polySides===(s as number)} onClick={()=>setPolySides(s as number)}/>
                          ))}
                        </div>
                        <CreateBtn onClick={()=>addGen(...Object.values(generatePolygon(polySides,polyRadius)) as [V3[],MeshFace[]],`Polígono ${polySides}L`)}/>
                      </>
                    )}

                    {/* ════ ARCO ════ */}
                    {createTab==='arc'&&(
                      <>
                        <PTitle icon="◔" title="Arco / Sector" desc="Arco, media luna, cuarto de círculo o disco completo."/>
                        {/* Preview */}
                        <div className="flex justify-center">
                          <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-24 h-24 bg-zinc-800 rounded-lg border border-zinc-700">
                            <path d={`M 0 0 L ${Math.cos(arcStart*Math.PI/180)*0.9} ${Math.sin(arcStart*Math.PI/180)*0.9} A 0.9 0.9 0 ${Math.abs(arcEnd-arcStart)>180?1:0} 1 ${Math.cos(arcEnd*Math.PI/180)*0.9} ${Math.sin(arcEnd*Math.PI/180)*0.9} Z`}
                              fill="#7c3aed33" stroke="#7c3aed" strokeWidth="0.05"/>
                          </svg>
                        </div>
                        <CRow label="Radio"><input type="number" min={0.1} step={0.1} value={arcR} onChange={e=>setArcR(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
                        <CRow label="Inicio °"><input type="number" min={0} max={360} step={15} value={arcStart} onChange={e=>setArcStart(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
                        <CRow label="Fin °"><input type="number" min={0} max={720} step={15} value={arcEnd} onChange={e=>setArcEnd(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
                        <CRow label="Segmentos"><input type="range" min={4} max={64} value={arcSegs} onChange={e=>setArcSegs(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{arcSegs}</CVal></CRow>
                        <CRow label="Tipo">
                          <button onClick={()=>setArcFilled(!arcFilled)} className={`px-2 py-0.5 rounded text-[10px] font-bold ${arcFilled?'bg-violet-600 text-white':'bg-zinc-700 text-zinc-400'}`}>{arcFilled?'Sector relleno':'Solo arco'}</button>
                        </CRow>
                        <div className="grid grid-cols-4 gap-1">
                          {[['Cuarto',0,90],['Mitad',0,180],['¾',0,270],['Disco',0,360]].map(([n,s,e])=>(
                            <PresetBtn key={n as string} label={n as string} active={arcStart===(s as number)&&arcEnd===(e as number)} onClick={()=>{setArcStart(s as number);setArcEnd(e as number);}}/>
                          ))}
                        </div>
                        <CreateBtn onClick={()=>addGen(...Object.values(generateArc(arcR,arcStart,arcEnd,arcSegs,arcFilled)) as [V3[],MeshFace[]],`Arco ${arcEnd-arcStart}°`)}/>
                      </>
                    )}

                    {/* ════ TORNO LIBRE ════ */}
                    {createTab==='lathe'&&(
                      <LatheFromShapeTab
                        latPickedId={latPickedId} setLatPickedId={setLatPickedId}
                        latAxis={latAxis} setLatAxis={setLatAxis}
                        latAngle={latAngle} setLatAngle={setLatAngle}
                        latSegs={latSegs}   setLatSegs={setLatSegs}
                        latOffset={latOffset} setLatOffset={setLatOffset}
                        project={project}
                        onGenerate={(v,f,n)=>{addGen(v,f,n,'lathe',{genAxis:latAxis,genAngle:latAngle,genSegs:latSegs});}}
                      />
                    )}

                    {/* ════ SWEEP ════ */}
                    {createTab==='sweep'&&(
                      <SweepFromShapeTab
                        sweepPickProfile={sweepPickProfile} setSweepPickProfile={setSweepPickProfile}
                        sweepPickPath={sweepPickPath}       setSweepPickPath={setSweepPickPath}
                        project={project}
                        onGenerate={(v,f,n)=>{addGen(v,f,n,'sweep',{});}}
                      />
                    )}

                    {/* ════ LOFT ════ */}
                    {createTab==='loft'&&(
                      <LoftFromShapeTab
                        loftPickA={loftPickA} setLoftPickA={setLoftPickA}
                        loftPickB={loftPickB} setLoftPickB={setLoftPickB}
                        loftH={loftH} setLoftH={setLoftH}
                        loftN={loftN} setLoftN={setLoftN}
                        loftS1={loftS1} setLoftS1={setLoftS1}
                        loftS2={loftS2} setLoftS2={setLoftS2}
                        project={project}
                        getLoftSec={getLoftSec}
                        onGenerate={(v,f,n)=>{addGen(v,f,n,'loft',{genS1:loftS1,genS2:loftS2,genH:loftH,genN:loftN});}}
                      />
                    )}

                    {createTab==='silueta'&&(
                      <SiluetaTab onGenerate={(v,f,n)=>{addGen(v,f,n,'silhouette',{});}}/>
                    )}

                    {/* ════ INGENIERÍA CAD ════ */}
                    {createTab==='ingenieria'&&(
                      <AdvancedTab
                        advTab={advTab} setAdvTab={setAdvTab}
                        advChamferD={advChamferD} setAdvChamferD={setAdvChamferD}
                        advChamferA={advChamferA} setAdvChamferA={setAdvChamferA}
                        advOffsetD={advOffsetD}   setAdvOffsetD={setAdvOffsetD}
                        advArrType={advArrType}   setAdvArrType={setAdvArrType}
                        advArrCount={advArrCount} setAdvArrCount={setAdvArrCount}
                        advArrStepX={advArrStepX} setAdvArrStepX={setAdvArrStepX}
                        advArrStepY={advArrStepY} setAdvArrStepY={setAdvArrStepY}
                        advArrStepZ={advArrStepZ} setAdvArrStepZ={setAdvArrStepZ}
                        advArrAngle={advArrAngle} setAdvArrAngle={setAdvArrAngle}
                        advArrAxis={advArrAxis}   setAdvArrAxis={setAdvArrAxis}
                        selectedObject={selectedObject} selectedObjectId={selectedObjectId}
                        project={project}
                        onApply={(v,f,n,t,p)=>addGen(v,f,n,t,p)}
                        onMultiAdd={(objs)=>{
                          const cur=useStore.getState().project;
                          useStore.getState().setProject({...cur,objects:[...cur.objects,...objs]});
                          useStore.getState().saveHistory(); setShowMainCreate(false);
                        }}
                        onModify={(v,f)=>{
                          if(!selectedObjectId) return;
                          updateObject(selectedObjectId,{vertices:v,faces:f,vertexOffsets:{}});
                          saveHistory(); setShowMainCreate(false);
                        }}
                        extrudeDist={extrudeDist} setExtrudeDist={setExtrudeDist}
                        extrudeAxis={extrudeAxis} setExtrudeAxis={setExtrudeAxis}
                        editMode={editMode} selectedFaceIndices={selectedFaceIndices}
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Editar (Grouped) ── */}
          <div className="relative flex-shrink-0" ref={mainEditRef}>
            <button onClick={()=>setShowMainEdit(v=>!v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-all border ${
                showMainEdit
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg'
                  : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-emerald-800 hover:text-white hover:border-emerald-600'
              }`}>
              <Edit3 size={13}/> <span className="hidden sm:inline">Editar</span>
              <ChevronDown size={10} className={`transition-transform ${showMainEdit?'rotate-180':''}`}/>
            </button>

            <AnimatePresence>
              {showMainEdit && (
                <motion.div
                  drag
                  dragMomentum={false}
                  initial={{opacity:0,y:-8,scale:0.97}}
                  animate={{opacity:1,y:0,scale:1}}
                  exit={{opacity:0,y:-8,scale:0.97}}
                  transition={{duration:0.15}}
                  className="fixed z-[200] mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
                  style={{
                    top: mainEditRef.current?.getBoundingClientRect().bottom,
                    left: Math.min(mainEditRef.current?.getBoundingClientRect().left??0, window.innerWidth-408),
                    width: 400,
                    maxHeight: '88vh',
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 cursor-grab active:cursor-grabbing select-none bg-zinc-950/40">
                    <div className="flex items-center gap-1.5">
                      <GripVertical size={13} className="text-zinc-500" />
                      <p className="text-[11px] font-bold text-zinc-200 uppercase tracking-widest">Panel de Edición</p>
                    </div>
                    <button onClick={()=>setShowMainEdit(false)} className="text-zinc-500 hover:text-zinc-300"><X size={14}/></button>
                  </div>

                  {/* Tab strip */}
                  <div className="grid grid-cols-5 border-b border-zinc-800">
                    {([
                      {id:'seleccion', label:'Selección', icon:'🖱️'},
                      {id:'transformar',label:'Transformar',icon:'📐'},
                      {id:'modificar',  label:'Modificar', icon:'🔨'},
                      {id:'malla',      label:'Malla/Opt',  icon:'🕸️'},
                      {id:'acciones',   label:'Acciones',  icon:'⚡'},
                    ] as const).map(tab=>(
                      <button key={tab.id} onClick={()=>setEditTab(tab.id)}
                        className={`flex flex-col items-center gap-0.5 py-1.5 text-[9px] font-bold transition-colors border-b-2 ${
                          editTab===tab.id
                            ?'border-emerald-500 text-emerald-300 bg-zinc-800/80'
                            :'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
                        }`}>
                        <span className="text-sm leading-none">{tab.icon}</span>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto" style={{scrollbarWidth:'thin',scrollbarColor:'#3f3f46 transparent'}}>
                    {/* ════ SELECCIÓN ════ */}
                    {editTab==='seleccion'&&(
                      <>
                        <PTitle icon="🖱️" title="Modo de Edición" desc="Selecciona el tipo de elementos a editar."/>
                        <div className="grid grid-cols-4 gap-2 mb-4">
                          <button 
                            onMouseEnter={e=>setT?.('Modo Objeto', e.currentTarget.getBoundingClientRect(), '1')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setEditMode('OBJECT');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1 p-2 rounded border transition-all ${editMode==='OBJECT'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                          >
                            <Box size={16}/><span className="text-[9px] font-bold">Objeto</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Modo Cara', e.currentTarget.getBoundingClientRect(), '2')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setEditMode('FACE');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1 p-2 rounded border transition-all ${editMode==='FACE'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                          >
                            <Layers size={16}/><span className="text-[9px] font-bold">Cara</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Modo Lado', e.currentTarget.getBoundingClientRect(), '3')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setEditMode('EDGE');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1 p-2 rounded border transition-all ${editMode==='EDGE'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                          >
                            <Layers3 size={16}/><span className="text-[9px] font-bold">Lado</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Modo Vértice', e.currentTarget.getBoundingClientRect(), '4')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setEditMode('VERTEX');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1 p-2 rounded border transition-all ${editMode==='VERTEX'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}
                          >
                            <Dot size={16}/><span className="text-[9px] font-bold">Vértice</span>
                          </button>
                        </div>

                        <PTitle icon="🖱️" title="Herramientas de Selección" desc="Gestiona los objetos seleccionados."/>
                        <div className="grid grid-cols-2 gap-2">
                          <button 
                            onMouseEnter={e=>setT?.('Seleccionar Todo', e.currentTarget.getBoundingClientRect(), 'Ctrl+A')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{useStore.getState().selectAll();setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"
                          >
                            <MousePointer2 size={14}/> Seleccionar Todo
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Deseleccionar', e.currentTarget.getBoundingClientRect(), 'Esc')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{useStore.getState().deselectAll();setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"
                          >
                            <XCircle size={14}/> Deseleccionar
                          </button>
                          <button onClick={()=>{useStore.getState().invertSelection();setShowMainEdit(false);}} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"><RefreshCw size={14}/> Invertir</button>
                          <button 
                            onMouseEnter={e=>setT?.('Eliminar', e.currentTarget.getBoundingClientRect(), 'Del')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{useStore.getState().deleteSelected();setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-red-900/30 hover:bg-red-800/50 text-red-300 rounded text-[11px] font-bold"
                          >
                            <Trash2 size={14}/> Eliminar
                          </button>
                        </div>
                      </>
                    )}

                    {/* ════ TRANSFORMAR ════ */}
                    {editTab==='transformar'&&(
                      <>
                        <PTitle icon="📐" title="Transformación" desc="Ajusta posición, rotación y escala."/>
                        <div className="grid grid-cols-4 gap-1.5">
                          <button 
                            onMouseEnter={e=>setT?.('Mover', e.currentTarget.getBoundingClientRect(), 'W')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setTransformMode('translate');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-all ${transformMode==='translate'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                          >
                            <Move size={16}/><span className="text-[9px] font-bold">Mover</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Rotar', e.currentTarget.getBoundingClientRect(), 'E')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setTransformMode('rotate');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-all ${transformMode==='rotate'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                          >
                            <RotateCw size={16}/><span className="text-[9px] font-bold">Rotar</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Escalar', e.currentTarget.getBoundingClientRect(), 'R')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setTransformMode('scale');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-all ${transformMode==='scale'?'bg-emerald-600 border-emerald-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                          >
                            <Maximize size={16}/><span className="text-[9px] font-bold">Escalar</span>
                          </button>
                          <button 
                            onMouseEnter={e=>setT?.('Combinado', e.currentTarget.getBoundingClientRect(), 'U')}
                            onMouseLeave={()=>setT?.(null)}
                            onClick={()=>{setTransformMode('universal');setShowMainEdit(false);}} 
                            className={`flex flex-col items-center gap-1.5 p-2 rounded border transition-all ${transformMode==='universal'?'bg-amber-600 border-amber-400 text-white':'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                          >
                            <Sparkles size={16}/><span className="text-[9px] font-bold">Combinado</span>
                          </button>
                        </div>
                      </>
                    )}

                    {/* ════ MODIFICAR ════ */}
                    {editTab==='modificar'&&(
                      <>
                        <PTitle icon="🔨" title="Modificadores" desc="Operaciones booleanas y de malla."/>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <button 
                            onClick={()=>{useStore.getState().applyBoolean('SUBTRACT');setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 rounded text-[11px] font-bold text-rose-200"
                            title="Resta / Diferencia: Abre un hueco en el objeto base restando el objeto cortador"
                          >
                            <Scissors size={14} className="text-rose-400"/> Diferencia (A − B)
                          </button>
                          <button 
                            onClick={()=>{useStore.getState().applyBoolean('ADD');setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/40 rounded text-[11px] font-bold text-emerald-200"
                            title="Unión: Fusiona ambos objetos en una única pieza sólida"
                          >
                            <Combine size={14} className="text-emerald-400"/> Unión (A + B)
                          </button>
                          <button 
                            onClick={()=>{useStore.getState().applyBoolean('INTERSECT');setShowMainEdit(false);}} 
                            className="flex items-center gap-2 px-3 py-2 bg-sky-950/40 hover:bg-sky-900/60 border border-sky-800/40 rounded text-[11px] font-bold text-sky-200"
                            title="Intersección: Conserva solo el volumen común compartido"
                          >
                            <Target size={14} className="text-sky-400"/> Intersección
                          </button>
                          <button 
                            onClick={async ()=>{
                              const selId = useStore.getState().selectedObjectId;
                              if (selId) await useStore.getState().ungroupSelectedObject(selId);
                              setShowMainEdit(false);
                            }} 
                            className="flex items-center gap-2 px-3 py-2 bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-500/30 rounded text-[11px] font-bold transition-all cursor-pointer"
                          >
                            <Split size={14}/> Desagrupar
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            useStore.getState().openBooleanModal();
                            setShowMainEdit(false);
                          }}
                          className="w-full mb-4 py-1.5 px-2.5 bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                        >
                          <Sparkles size={12} className="text-indigo-300" />
                          Abrir Estudio Booleano Completo (CSG)
                        </button>

                        <PTitle icon="📤" title="Extrusión" desc="Crea volumen a partir de formas o caras."/>
                        <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 space-y-3">
                          {editMode === 'FACE' ? (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Distancia</span>
                                <span className="text-[11px] font-mono text-indigo-400">{safeFixed(extrudeDist, 2)}</span>
                              </div>
                              <input
                                type="range"
                                min={0.01}
                                max={2}
                                step={0.01}
                                value={extrudeDist}
                                onChange={(e) => setExtrudeDist(parseFloat(e.target.value))}
                                className="w-full accent-indigo-500 h-1.5"
                              />
                              <button
                                onMouseEnter={e=>setT?.('Extruir Caras', e.currentTarget.getBoundingClientRect(), 'Ctrl+E')}
                                onMouseLeave={()=>setT?.(null)}
                                disabled={!canExtrude}
                                onClick={() => {
                                  if (!selectedObjectId) return;
                                  useStore.getState().extrudeFaces(selectedObjectId, selectedFaceIndices, extrudeDist);
                                  setShowMainEdit(false);
                                }}
                                className={`w-full py-2 rounded flex items-center justify-center gap-2 text-[11px] font-bold transition-all ${canExtrude ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}
                              >
                                <ArrowUpFromLine size={14} /> Extruir Caras ({selectedFaceIndices.length})
                              </button>
                              {!canExtrude && (
                                <p className="text-[9px] text-zinc-500 text-center italic">Selecciona al menos una cara para extruir.</p>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Eje</span>
                                <div className="flex gap-1">
                                  {(['x','y','z'] as const).map(ax => (
                                    <button
                                      key={ax}
                                      onClick={() => setExtrudeAxis(ax)}
                                      className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all ${extrudeAxis === ax ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                      {ax.toUpperCase()}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Distancia</span>
                                <span className="text-[11px] font-mono text-indigo-400">{safeFixed(extrudeDist, 2)}</span>
                              </div>
                              <input
                                type="range"
                                min={0.01}
                                max={2}
                                step={0.01}
                                value={extrudeDist}
                                onChange={(e) => setExtrudeDist(parseFloat(e.target.value))}
                                className="w-full accent-indigo-500 h-1.5"
                              />
                              <button
                                disabled={!isExtrudable}
                                onClick={() => {
                                  if (!selectedObjectId) return;
                                  useStore.getState().extrudeShape(selectedObjectId, extrudeDist, extrudeAxis);
                                  setShowMainEdit(false);
                                }}
                                className={`w-full py-2 rounded flex items-center justify-center gap-2 text-[11px] font-bold transition-all ${isExtrudable ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}
                              >
                                <ArrowUpFromLine size={14} /> Extruir Objeto
                              </button>
                              {!isExtrudable && (
                                <p className="text-[9px] text-zinc-500 text-center italic">Solo para Formas, Planos, Círculos y Anillos.</p>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}

                    {/* ════ MALLA / OPTIMIZACIÓN ════ */}
                    {editTab==='malla'&&(
                      <MeshTab
                        selectedObject={selectedObject}
                        onModify={(v, f) => {
                          if (selectedObjectId) useStore.getState().updateObject(selectedObjectId, { vertices: v, faces: f });
                        }}
                      />
                    )}

                    {/* ════ ACCIONES ════ */}
                    {editTab==='acciones'&&(
                      <>
                        <PTitle icon="⚡" title="Acciones Rápidas" desc="Operaciones de utilidad sobre la selección."/>
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={()=>{useStore.getState().duplicateSelected();setShowMainEdit(false);}} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"><Copy size={14}/> Duplicar</button>
                          <button onClick={()=>{useStore.getState().mirrorSelected('x');setShowMainEdit(false);}} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"><FlipHorizontal size={14}/> Espejo X</button>
                          <button onClick={()=>{useStore.getState().mirrorSelected('y');setShowMainEdit(false);}} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"><FlipVertical size={14}/> Espejo Y</button>
                          <button onClick={()=>{useStore.getState().mirrorSelected('z');setShowMainEdit(false);}} className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-bold"><RefreshCw size={14}/> Espejo Z</button>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Sep/>

          {/* ── Quick Tools (Gap) ── */}
          {!isFloating && (showMainEdit || editMode !== 'OBJECT' || showMainCreate) && (
            <div className="flex items-center gap-1 px-1 min-w-0 overflow-hidden flex-shrink">
              <AnimatePresence mode="wait">
                {showMainEdit || editMode !== 'OBJECT' ? (
                  <motion.div 
                    key="edit-quick"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5"
                  >
                    <QuickButton active={editMode==='OBJECT'} onClick={()=>setEditMode('OBJECT')} icon={<Box size={14}/>} label="Objeto" shortcut="1" />
                    <QuickButton active={editMode==='FACE'}   onClick={()=>setEditMode('FACE')}   icon={<Layers size={14}/>} label="Cara" shortcut="2" />
                    <QuickButton active={editMode==='EDGE'}   onClick={()=>setEditMode('EDGE')}   icon={<Layers3 size={14}/>} label="Borde" shortcut="3" />
                    <QuickButton active={editMode==='VERTEX'} onClick={()=>setEditMode('VERTEX')} icon={<Dot size={14}/>} label="Vértice" shortcut="4" />
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <QuickButton active={transformMode==='translate'} onClick={()=>setTransformMode('translate')} icon={<Move size={14}/>} label="Mover" shortcut="W" />
                    <QuickButton active={transformMode==='rotate'}    onClick={()=>setTransformMode('rotate')}    icon={<RotateCw size={14}/>} label="Rotar" shortcut="E" />
                    <QuickButton active={transformMode==='scale'}     onClick={()=>setTransformMode('scale')}     icon={<Maximize size={14}/>} label="Escalar" shortcut="R" />
                    <QuickButton active={transformMode==='universal'} onClick={()=>setTransformMode('universal')} icon={<Sparkles size={14}/>} label="Combinado" shortcut="U" />
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    
                    {/* Face Snapping Magnet (Retopology) */}
                    <div className="relative flex items-center" ref={faceSnapRef}>
                      <button
                        type="button"
                        onClick={() => toggleFaceSnap()}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-l text-xs font-semibold transition-all border border-r-0 cursor-pointer ${
                          faceSnapConfig?.enabled
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                            : 'bg-zinc-800/80 text-zinc-400 border-white/5 hover:text-zinc-200'
                        }`}
                        title={faceSnapConfig?.enabled ? 'Ajuste a Caras (Snapping): ACTIVO' : 'Activar Ajuste a Caras (Snapping de Retopología)'}
                      >
                        <Magnet size={13} className={faceSnapConfig?.enabled ? 'text-amber-400' : 'text-zinc-400'} />
                        <span className="text-[11px] hidden sm:inline">Imán Caras</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowFaceSnapMenu(v => !v)}
                        className={`px-1 py-1 rounded-r border border-l-0 transition-all cursor-pointer ${
                          faceSnapConfig?.enabled
                            ? 'bg-amber-500/30 text-amber-300 border-amber-500/50'
                            : 'bg-zinc-800/80 text-zinc-400 border-white/5 hover:text-zinc-200'
                        }`}
                        title="Opciones de Snapping (Project Individual Elements, Offset)"
                      >
                        <ChevronDown size={10} className={`transition-transform ${showFaceSnapMenu ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence>
                        {showFaceSnapMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: -4, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.95 }}
                            transition={{ duration: 0.12 }}
                            className="absolute z-[250] mt-1.5 top-full right-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-3 w-[260px] text-zinc-200 space-y-2.5 backdrop-blur-md"
                          >
                            <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                              <div className="flex items-center gap-1.5">
                                <Magnet size={13} className="text-amber-400" />
                                <span className="text-xs font-bold text-white">Ajuste a Caras (Snapping)</span>
                              </div>
                              <button onClick={() => setShowFaceSnapMenu(false)} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
                                <X size={12} />
                              </button>
                            </div>

                            <label className="flex items-center justify-between cursor-pointer p-1.5 rounded bg-zinc-950/60 border border-white/5 hover:border-amber-500/30">
                              <span className="text-[11px] font-medium text-zinc-300">Activar Snapping</span>
                              <input
                                type="checkbox"
                                checked={faceSnapConfig?.enabled ?? false}
                                onChange={e => setFaceSnapConfig({ enabled: e.target.checked })}
                                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer"
                              />
                            </label>

                            <label className="flex items-start justify-between gap-2 cursor-pointer p-1.5 rounded bg-zinc-950/60 border border-white/5 hover:border-amber-500/30">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-medium text-zinc-200">Proyectar Elementos Individuales</span>
                                <span className="text-[9px] text-zinc-400 leading-tight">Cada vértice se ajusta a la cara debajo independientemente en vez de como bloque</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={faceSnapConfig?.projectIndividualElements ?? true}
                                onChange={e => setFaceSnapConfig({ projectIndividualElements: e.target.checked })}
                                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                              />
                            </label>

                            <label className="flex items-start justify-between gap-2 cursor-pointer p-1.5 rounded bg-zinc-950/60 border border-white/5 hover:border-amber-500/30">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-medium text-zinc-200">Alinear Rotación a la Cara</span>
                                <span className="text-[9px] text-zinc-400 leading-tight">Orienta el objeto según la inclinación o normal de la superficie (Face Snapping de Blender)</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={faceSnapConfig?.alignRotationToTarget ?? false}
                                onChange={e => setFaceSnapConfig({ alignRotationToTarget: e.target.checked })}
                                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                              />
                            </label>

                            <label className="flex items-start justify-between gap-2 cursor-pointer p-1.5 rounded bg-zinc-950/60 border border-white/5 hover:border-amber-500/30">
                              <div className="flex flex-col">
                                <span className="text-[11px] font-medium text-zinc-200">Apoyar Base en Superficie</span>
                                <span className="text-[9px] text-zinc-400 leading-tight">Apoya la base exterior del accesorio sobre la cara en vez de incrustar el centro a la mitad</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={faceSnapConfig?.snapBaseToSurface ?? true}
                                onChange={e => setFaceSnapConfig({ snapBaseToSurface: e.target.checked })}
                                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                              />
                            </label>

                            <div className="space-y-1 bg-zinc-950/60 p-1.5 rounded border border-white/5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-zinc-300">Eje de Apoyo del Accesorio:</span>
                                <span className="text-[10px] font-mono text-amber-300 font-bold">{faceSnapConfig?.alignmentAxis ?? '+Y'}</span>
                              </div>
                              <div className="grid grid-cols-3 gap-1 pt-0.5">
                                {(['+Y', '+Z', '+X'] as const).map(axis => (
                                  <button
                                    key={axis}
                                    type="button"
                                    onClick={() => setFaceSnapConfig({ alignmentAxis: axis })}
                                    className={`py-0.5 text-[8.5px] font-mono font-bold rounded cursor-pointer ${
                                      (faceSnapConfig?.alignmentAxis ?? '+Y') === axis
                                        ? 'bg-amber-500 text-black'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                    }`}
                                  >
                                    {axis === '+Y' ? '+Y (Base)' : axis === '+Z' ? '+Z (Frente)' : '+X (Lateral)'}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-1 bg-zinc-950/60 p-1.5 rounded border border-white/5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-zinc-300">Offset (Desplazamiento):</span>
                                <span className="text-[10px] font-mono text-amber-300 font-bold">{faceSnapConfig?.offset ?? 0.002}</span>
                              </div>
                              <p className="text-[8.5px] text-zinc-400 leading-tight">Separa los vértices ligeramente de la cara para evitar parpadeo o que se hundan.</p>
                              <div className="flex items-center gap-1 pt-1">
                                {[0, 0.001, 0.002, 0.005, 0.01].map(off => (
                                  <button
                                    key={off}
                                    type="button"
                                    onClick={() => setFaceSnapConfig({ offset: off })}
                                    className={`flex-1 py-0.5 text-[9px] font-mono font-bold rounded transition-colors cursor-pointer ${
                                      (faceSnapConfig?.offset ?? 0.002) === off
                                        ? 'bg-amber-500 text-black'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                    }`}
                                  >
                                    {off === 0 ? '0' : off}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={async () => {
                                if (selectedObjectId) {
                                  const ok = await useStore.getState().alignToSurface(selectedObjectId);
                                  if (!ok) {
                                    useStore.getState().alignToGround(selectedObjectId);
                                  }
                                }
                              }}
                              disabled={!selectedObjectId}
                              className="w-full py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-40 text-black font-bold rounded text-[10px] shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Magnet size={12} />
                              <span>🎯 Alinear y Pegar a Superficie (Snap)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setShowFaceSnapDemoModal(true);
                                setShowFaceSnapMenu(false);
                              }}
                              className="w-full py-1 text-[9px] text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer border border-amber-500/20"
                            >
                              <Sparkles size={11} className="text-amber-400" />
                              <span>Ver Demo Guiada Paso a Paso</span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : showMainCreate ? (
                  <motion.div 
                    key="create-quick"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-lg border border-white/5"
                  >
                    <QuickButton active={createTab==='primitivo'} onClick={()=>setCreateTab('primitivo')} icon={<Box size={14}/>} label="Primitivos" />
                    <QuickButton active={createTab==='dibujar'}   onClick={()=>setCreateTab('dibujar')}   icon={<Pencil size={14}/>} label="Dibujar" />
                    <QuickButton active={createTab==='ingenieria'} onClick={()=>setCreateTab('ingenieria')} icon={<Combine size={14}/>} label="Ingeniería" />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          )}

          {/* Configuración Visores Tab */}
          <div className="relative" ref={viewportConfigRef}>
            <button
              onClick={() => setShowViewportConfig(v => !v)}
              className={`flex items-center gap-1 px-2 py-1.5 rounded text-[11px] font-bold transition-all border cursor-pointer ${
                showViewportConfig
                  ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg'
                  : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
              }`}
              title="Configuración de Visores, Layouts, Rejilla y Snap"
            >
              <LayoutGrid size={13} className="text-indigo-400" />
              <span>Visores</span>
              <ChevronDown size={10} className={`transition-transform ${showViewportConfig ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showViewportConfig && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className="fixed z-[200] mt-1 bg-zinc-900/98 border border-zinc-700 rounded-xl shadow-2xl p-3.5 w-[360px] max-h-[calc(100vh-80px)] overflow-y-auto custom-scrollbar text-zinc-200 space-y-2.5 backdrop-blur-md"
                  style={{
                    top: viewportPanelPos
                      ? viewportPanelPos.y
                      : Math.min(
                          (viewportConfigRef.current?.getBoundingClientRect().bottom ?? 45) + 4,
                          Math.max(10, window.innerHeight - 560)
                        ),
                    left: viewportPanelPos
                      ? viewportPanelPos.x
                      : Math.min(
                          viewportConfigRef.current?.getBoundingClientRect().left ?? 0,
                          window.innerWidth - 370
                        ),
                  }}
                >
                  {/* Header Sticky con soporte para arrastrar */}
                  <div
                    onPointerDown={handleViewportPanelDragStart}
                    onPointerMove={handleViewportPanelDragMove}
                    onPointerUp={handleViewportPanelDragEnd}
                    onPointerCancel={handleViewportPanelDragEnd}
                    className="sticky -top-3.5 -mx-3.5 px-3.5 pt-1 pb-2 bg-zinc-900/98 backdrop-blur border-b border-white/10 z-20 flex items-center justify-between select-none cursor-grab active:cursor-grabbing"
                    title="Arrastra para mover este panel por la pantalla"
                  >
                    <div className="flex items-center gap-1.5 pointer-events-none">
                      <GripHorizontal size={14} className="text-zinc-500" />
                      <LayoutGrid size={14} className="text-indigo-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Configuración de Visores</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {viewportPanelPos && (
                        <button
                          type="button"
                          onClick={() => setViewportPanelPos(null)}
                          className="p-1 rounded text-[9px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-white/10 cursor-pointer transition-colors"
                          title="Restablecer posición inicial"
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={toggleAllViewportSections}
                        className="px-2 py-0.5 rounded text-[9px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10 cursor-pointer transition-colors"
                        title="Plegar o desplegar todos los apartados"
                      >
                        {Object.values(viewportSections).some(Boolean) ? 'Plegar' : 'Desplegar'}
                      </button>
                      <button onClick={() => setShowViewportConfig(false)} className="text-zinc-400 hover:text-zinc-200 cursor-pointer p-0.5">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Sección 1: Layouts / Disposiciones */}
                  <div className="bg-zinc-950/60 rounded-lg border border-white/5 overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleViewportSection('layouts')}
                      className="w-full flex items-center justify-between p-2 text-left cursor-pointer group hover:bg-white/[0.02]"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 group-hover:text-white flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${viewportSections.layouts ? '' : '-rotate-90'}`} />
                        <LayoutGrid size={13} className="text-indigo-400" />
                        <span>Disposición de Visores</span>
                      </span>
                      <span className="text-[9.5px] font-mono text-indigo-400 font-semibold px-1.5 py-0.2 rounded bg-indigo-950/60 border border-indigo-500/30">
                        {viewportConfig?.preset || 'QUAD'}
                      </span>
                    </button>

                    {viewportSections.layouts && (
                      <div className="p-2 pt-0 border-t border-white/5 space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5 max-h-[170px] overflow-y-auto pr-1 custom-scrollbar pt-1.5">
                          {[
                            { id: 'QUAD', label: '4 Vistas', desc: 'Cuadrícula 2x2' },
                            { id: 'SINGLE', label: 'Vista Única', desc: 'Visor grande' },
                            { id: 'TOP_1_BOTTOM_2', label: '1 Arriba / 2 Abajo', desc: '1 Horiz + 2 Abajo' },
                            { id: 'TOP_2_BOTTOM_1', label: '2 Arriba / 1 Abajo', desc: '2 Arriba + 1 Horiz' },
                            { id: 'LEFT_1_RIGHT_2', label: '1 Izq / 2 Der', desc: '1 Vert + 2 Derecha' },
                            { id: 'RIGHT_1_LEFT_2', label: '2 Izq / 1 Der', desc: '2 Izquierda + 1 Vert' },
                            { id: 'SPLIT_H', label: '2 Horizontales', desc: 'Arriba / Abajo' },
                            { id: 'SPLIT_V', label: '2 Verticales', desc: 'Izquierda / Derecha' },
                          ].map((item) => {
                            const isSelected = (viewportConfig?.preset || 'QUAD') === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setViewportPreset(item.id as ViewportLayoutPreset);
                                }}
                                className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-950/80 border-indigo-500 text-white shadow-md'
                                    : 'bg-zinc-800/60 border-white/5 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-600'
                                }`}
                              >
                                {/* Diagram */}
                                {(() => {
                                  const active = isSelected;
                                  const main = active ? 'bg-indigo-500' : 'bg-zinc-500';
                                  const sub = active ? 'bg-indigo-950 border border-indigo-500/40' : 'bg-zinc-900 border border-zinc-700';

                                  if (item.id === 'QUAD') return (
                                    <div className="w-6 h-5 p-0.5 grid grid-cols-2 grid-rows-2 gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`${main} rounded-[1px]`} /><div className={`${sub} rounded-[1px]`} />
                                      <div className={`${sub} rounded-[1px]`} /><div className={`${sub} rounded-[1px]`} />
                                    </div>
                                  );
                                  if (item.id === 'SINGLE') return (
                                    <div className="w-6 h-5 p-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`w-full h-full ${main} rounded-[1px]`} />
                                    </div>
                                  );
                                  if (item.id === 'TOP_1_BOTTOM_2') return (
                                    <div className="w-6 h-5 p-0.5 flex flex-col gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`w-full h-1/2 ${main} rounded-[1px]`} />
                                      <div className="w-full h-1/2 flex gap-0.5"><div className={`w-1/2 h-full ${sub} rounded-[1px]`} /><div className={`w-1/2 h-full ${sub} rounded-[1px]`} /></div>
                                    </div>
                                  );
                                  if (item.id === 'TOP_2_BOTTOM_1') return (
                                    <div className="w-6 h-5 p-0.5 flex flex-col gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className="w-full h-1/2 flex gap-0.5"><div className={`w-1/2 h-full ${sub} rounded-[1px]`} /><div className={`w-1/2 h-full ${sub} rounded-[1px]`} /></div>
                                      <div className={`w-full h-1/2 ${main} rounded-[1px]`} />
                                    </div>
                                  );
                                  if (item.id === 'LEFT_1_RIGHT_2') return (
                                    <div className="w-6 h-5 p-0.5 flex gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`w-1/2 h-full ${main} rounded-[1px]`} />
                                      <div className="w-1/2 h-full flex flex-col gap-0.5"><div className={`w-full h-1/2 ${sub} rounded-[1px]`} /><div className={`w-full h-1/2 ${sub} rounded-[1px]`} /></div>
                                    </div>
                                  );
                                  if (item.id === 'RIGHT_1_LEFT_2') return (
                                    <div className="w-6 h-5 p-0.5 flex gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className="w-1/2 h-full flex flex-col gap-0.5"><div className={`w-full h-1/2 ${sub} rounded-[1px]`} /><div className={`w-full h-1/2 ${sub} rounded-[1px]`} /></div>
                                      <div className={`w-1/2 h-full ${main} rounded-[1px]`} />
                                    </div>
                                  );
                                  if (item.id === 'SPLIT_H') return (
                                    <div className="w-6 h-5 p-0.5 flex flex-col gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`w-full h-1/2 ${main} rounded-[1px]`} />
                                      <div className={`w-full h-1/2 ${sub} rounded-[1px]`} />
                                    </div>
                                  );
                                  return (
                                    <div className="w-6 h-5 p-0.5 flex gap-0.5 rounded bg-zinc-950 border border-zinc-700 shrink-0">
                                      <div className={`w-1/2 h-full ${main} rounded-[1px]`} />
                                      <div className={`w-1/2 h-full ${sub} rounded-[1px]`} />
                                    </div>
                                  );
                                })()}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[10px] font-bold truncate leading-tight">{item.label}</p>
                                  <p className="text-[8px] text-zinc-400 truncate leading-tight">{item.desc}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sección 2: Personalizar Tamaño (Drag Redimensionar) */}
                  <div className="bg-zinc-950/60 rounded-lg border border-white/5 overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleViewportSection('resize')}
                      className="w-full flex items-center justify-between p-2 text-left cursor-pointer group hover:bg-white/[0.02]"
                    >
                      <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${viewportSections.resize ? '' : '-rotate-90'}`} />
                        <Move size={13} className="text-amber-400" />
                        <span>Redimensionar Visores</span>
                      </span>
                      <span className={`text-[8.5px] font-mono px-1.5 py-0.2 rounded font-bold ${viewportConfig?.customResizeMode ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-zinc-800 text-zinc-400'}`}>
                        {viewportConfig?.customResizeMode ? 'Edición Activa' : 'Fijado'}
                      </span>
                    </button>

                    {viewportSections.resize && (
                      <div className="p-2.5 pt-0 border-t border-white/5 space-y-2">
                        <p className="text-[9.5px] text-zinc-400 leading-tight pt-1.5">
                          Activa para arrastrar desde el centro o divisores y ajustar el tamaño de cada visor. Al terminar, queda fijado.
                        </p>

                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setCustomResizeMode(!viewportConfig?.customResizeMode)}
                            className={`flex-1 py-1.5 px-2 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow ${
                              viewportConfig?.customResizeMode
                                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40 animate-pulse'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-900/40'
                            }`}
                          >
                            {viewportConfig?.customResizeMode ? <Check size={12} /> : <Move size={12} />}
                            {viewportConfig?.customResizeMode ? 'Fijar Tamaño Final' : 'Personalizar Tamaño'}
                          </button>

                          <button
                            type="button"
                            onClick={() => resetViewportSplits()}
                            className="py-1.5 px-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] font-medium transition-colors border border-white/10 cursor-pointer"
                            title="Restablecer divisiones a 50/50"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sección 3: Rejilla (Grid) & Snap */}
                  <div className="bg-zinc-950/60 rounded-lg border border-white/5 overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleViewportSection('gridSnap')}
                      className="w-full flex items-center justify-between p-2 text-left cursor-pointer group hover:bg-white/[0.02]"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 group-hover:text-white flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${viewportSections.gridSnap ? '' : '-rotate-90'}`} />
                        <Grid size={13} className="text-indigo-400" />
                        <span>Rejilla y Ajustes (Grid & Snap)</span>
                      </span>
                      <span className="text-[8.5px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                        Snap: {gridSnapEnabled ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {viewportSections.gridSnap && (
                      <div className="p-2.5 pt-0 border-t border-white/5 space-y-2">
                        <div className="grid grid-cols-2 gap-2 pt-1.5">
                          {/* Snap Toggle */}
                          <button
                            type="button"
                            onClick={() => setGridSnapEnabled(!gridSnapEnabled)}
                            className={`flex items-center justify-between p-2 rounded-lg border transition-all text-xs font-semibold cursor-pointer ${
                              gridSnapEnabled
                                ? 'bg-indigo-950/80 border-indigo-500/50 text-indigo-200 shadow'
                                : 'bg-zinc-800/80 border-white/5 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Magnet size={14} className={gridSnapEnabled ? 'text-indigo-400' : 'text-zinc-500'} />
                              <span>Snap</span>
                            </div>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${gridSnapEnabled ? 'bg-indigo-500 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                              {gridSnapEnabled ? 'ON' : 'OFF'}
                            </span>
                          </button>

                          {/* Grid Toggle */}
                          <button
                            type="button"
                            onClick={() => useStore.getState().setShowGrid(project.showGrid !== false ? false : true)}
                            className={`flex items-center justify-between p-2 rounded-lg border transition-all text-xs font-semibold cursor-pointer ${
                              project.showGrid !== false
                                ? 'bg-indigo-950/80 border-indigo-500/50 text-indigo-200 shadow'
                                : 'bg-zinc-800/80 border-white/5 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Grid size={14} className={project.showGrid !== false ? 'text-indigo-400' : 'text-zinc-500'} />
                              <span>Rejilla Grid</span>
                            </div>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${project.showGrid !== false ? 'bg-indigo-500 text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                              {project.showGrid !== false ? 'ON' : 'OFF'}
                            </span>
                          </button>

                          {/* Skeleton / Bones Rigging Toggle */}
                          <button
                            type="button"
                            onClick={() => useStore.getState().toggleShowSkeleton()}
                            className={`flex items-center justify-between p-2 rounded-lg border transition-all text-xs font-semibold cursor-pointer col-span-2 ${
                              project.showSkeleton
                                ? 'bg-amber-950/80 border-amber-500/50 text-amber-200 shadow'
                                : 'bg-zinc-800/80 border-white/5 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Bone size={14} className={project.showSkeleton ? 'text-amber-400' : 'text-zinc-500'} />
                              <span>Huesos / Rigging Esqueleto</span>
                            </div>
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${project.showSkeleton ? 'bg-amber-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}>
                              {project.showSkeleton ? 'ON' : 'OFF'}
                            </span>
                          </button>
                        </div>

                        {/* Snap Step Selector */}
                        <div className="flex items-center justify-between bg-zinc-950/50 p-2 rounded-lg border border-white/5">
                          <span className="text-[10px] text-zinc-400 font-medium">Distancia Snap:</span>
                          <div className="flex items-center gap-1">
                            {[0.1, 0.25, 0.5, 1.0, 2.0].map((step) => (
                              <button
                                key={step}
                                type="button"
                                onClick={() => setSnapStep(step)}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors cursor-pointer ${
                                  (viewportConfig?.snapStep ?? 0.5) === step
                                    ? 'bg-indigo-600 text-white font-bold'
                                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                }`}
                              >
                                {step}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sección 4: Retopology Face Snapping Section */}
                  <div className="bg-zinc-950/60 rounded-lg border border-amber-500/30 overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleViewportSection('faceSnap')}
                      className="w-full flex items-center justify-between p-2 text-left cursor-pointer group hover:bg-white/[0.02]"
                    >
                      <span className="text-[10px] font-bold text-amber-300 group-hover:text-amber-200 flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-amber-400 transition-transform ${viewportSections.faceSnap ? '' : '-rotate-90'}`} />
                        <Magnet size={13} className="text-amber-400" />
                        <span>Imán Ajuste a Caras (Retopología)</span>
                      </span>
                      <span className={`text-[8.5px] font-mono font-bold px-1.5 py-0.2 rounded ${faceSnapConfig?.enabled ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400'}`}>
                        {faceSnapConfig?.enabled ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {viewportSections.faceSnap && (
                      <div className="p-2.5 pt-0 border-t border-white/5 space-y-2">
                        <div className="flex items-center justify-between pt-1.5">
                          <span className="text-[9.5px] text-zinc-300 font-medium">Estado del Snapping</span>
                          <button
                            type="button"
                            onClick={() => toggleFaceSnap()}
                            className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded cursor-pointer ${
                              faceSnapConfig?.enabled ? 'bg-amber-500 text-black shadow-xs' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {faceSnapConfig?.enabled ? 'ACTIVADO' : 'DESACTIVADO'}
                          </button>
                        </div>

                        <label className="flex items-start justify-between gap-2 cursor-pointer pt-0.5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-medium text-zinc-200">Proyectar Elementos Individuales</span>
                            <span className="text-[8.5px] text-zinc-400 leading-tight">Cada vértice se ajusta a la cara debajo en vez de mover el bloque</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={faceSnapConfig?.projectIndividualElements ?? true}
                            onChange={e => setFaceSnapConfig({ projectIndividualElements: e.target.checked })}
                            className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                          />
                        </label>

                        <label className="flex items-start justify-between gap-2 cursor-pointer pt-0.5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-medium text-zinc-200">Alinear Rotación a la Cara</span>
                            <span className="text-[8.5px] text-zinc-400 leading-tight">Orienta según la inclinación de la superficie de apoyo</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={faceSnapConfig?.alignRotationToTarget ?? false}
                            onChange={e => setFaceSnapConfig({ alignRotationToTarget: e.target.checked })}
                            className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                          />
                        </label>

                        <label className="flex items-start justify-between gap-2 cursor-pointer pt-0.5">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-medium text-zinc-200">Apoyar Base en Superficie</span>
                            <span className="text-[8.5px] text-zinc-400 leading-tight">Apoya la base exterior sobre la cara (evita que se hunda a la mitad)</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={faceSnapConfig?.snapBaseToSurface ?? true}
                            onChange={e => setFaceSnapConfig({ snapBaseToSurface: e.target.checked })}
                            className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
                          />
                        </label>

                        <div className="flex items-center justify-between pt-1 border-t border-white/5">
                          <span className="text-[9px] text-zinc-300">Eje de Apoyo:</span>
                          <div className="flex items-center gap-1">
                            {(['+Y', '+Z', '+X'] as const).map(axis => (
                              <button
                                key={axis}
                                type="button"
                                onClick={() => setFaceSnapConfig({ alignmentAxis: axis })}
                                className={`px-1.5 py-0.5 text-[8px] font-mono font-bold rounded cursor-pointer ${
                                  (faceSnapConfig?.alignmentAxis ?? '+Y') === axis
                                    ? 'bg-amber-500 text-black'
                                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                }`}
                              >
                                {axis === '+Y' ? '+Y (Base)' : axis === '+Z' ? '+Z (Frente)' : '+X'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-white/5">
                          <span className="text-[9.5px] text-zinc-300">Offset (Desplazamiento):</span>
                          <div className="flex items-center gap-1">
                            {[0, 0.001, 0.002, 0.005, 0.01].map(off => (
                              <button
                                key={off}
                                type="button"
                                onClick={() => setFaceSnapConfig({ offset: off })}
                                className={`px-1 py-0.5 text-[8.5px] font-mono font-bold rounded cursor-pointer ${
                                  (faceSnapConfig?.offset ?? 0.002) === off
                                    ? 'bg-amber-500 text-black'
                                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                }`}
                              >
                                {off}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            if (selectedObjectId) {
                              const ok = await useStore.getState().alignToSurface(selectedObjectId);
                              if (!ok) {
                                useStore.getState().alignToGround(selectedObjectId);
                              }
                            }
                          }}
                          disabled={!hasSel}
                          className="w-full py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-40 text-black font-bold rounded text-[10px] shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                        >
                          <Magnet size={12} />
                          <span>🎯 Alinear y Pegar a la Superficie (1-Clic)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowFaceSnapDemoModal(true);
                            setShowViewportConfig(false);
                          }}
                          className="w-full py-1 text-[9px] text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer border border-amber-500/20 mt-1"
                        >
                          <Sparkles size={11} className="text-amber-400" />
                          <span>Ver Demo Guiada Paso a Paso</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Sección 5: Acciones de Alineación */}
                  <div className="bg-zinc-950/60 rounded-lg border border-white/5 overflow-hidden transition-all">
                    <button
                      type="button"
                      onClick={() => toggleViewportSection('alignment')}
                      className="w-full flex items-center justify-between p-2 text-left cursor-pointer group hover:bg-white/[0.02]"
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 group-hover:text-zinc-200 flex items-center gap-1.5">
                        <ChevronDown size={13} className={`text-zinc-400 transition-transform ${viewportSections.alignment ? '' : '-rotate-90'}`} />
                        <span>Acciones de Alineación Rápida</span>
                      </span>
                      <span className="text-[8.5px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400">
                        3 Opciones
                      </span>
                    </button>

                    {viewportSections.alignment && (
                      <div className="p-2.5 pt-0 border-t border-white/5">
                        <div className="grid grid-cols-3 gap-1 pt-1.5">
                          <button
                            type="button"
                            onClick={() => selectedObjectId && useStore.getState().alignToGrid(selectedObjectId)}
                            disabled={!hasSel}
                            className="flex items-center justify-center gap-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 rounded text-[9.5px] font-medium transition-colors border border-white/5 cursor-pointer"
                            title="Alinear a la Rejilla"
                          >
                            <Magnet size={11} className="text-indigo-400" />
                            Rejilla
                          </button>
                          <button
                            type="button"
                            onClick={() => selectedObjectId && useStore.getState().alignToGround(selectedObjectId)}
                            disabled={!hasSel}
                            className="flex items-center justify-center gap-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 rounded text-[9.5px] font-medium transition-colors border border-white/5 cursor-pointer"
                            title="Alinear al Suelo Y=0"
                          >
                            <AlignStartVertical size={11} className="text-emerald-400" />
                            Suelo Y=0
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (selectedObjectId) {
                                await useStore.getState().alignToSurface(selectedObjectId);
                              }
                            }}
                            disabled={!hasSel}
                            className="flex items-center justify-center gap-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 rounded text-[9.5px] font-medium transition-colors border border-white/5 cursor-pointer"
                            title="Alinear y pegar a la cara/superficie más cercana"
                          >
                            <Magnet size={11} className="text-amber-400" />
                            Superficie
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <Sep/>

          {/* Ref images */}
          <div className="relative" ref={refPanelRef}>
            <button onClick={()=>setShowRef(v=>!v)}
              className="flex items-center gap-1 px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-semibold transition-colors">
              <ImageIcon size={14}/><span className="hidden sm:inline">Ref.</span><ChevronDown size={11}/>
            </button>
            {showRef&&refPanelRef.current&&(
              <motion.div 
                drag 
                dragMomentum={false}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="fixed mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-[220] w-72 p-3 space-y-3 max-h-[85vh] overflow-y-auto"
                style={{
                  top: Math.min(refPanelRef.current.getBoundingClientRect().bottom, window.innerHeight - 400),
                  left: Math.min(refPanelRef.current.getBoundingClientRect().left, window.innerWidth - 300)
                }}>
                <div className="flex items-center justify-between cursor-grab active:cursor-grabbing pb-1 border-b border-zinc-800 select-none">
                  <div className="flex items-center gap-1.5">
                    <GripVertical size={13} className="text-zinc-500" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Imágenes de Referencia</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setMoveReferenceMode(!moveReferenceMode)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                        moveReferenceMode ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                      title="Activa para arrastrar las imágenes directamente en el canvas"
                    >
                      <Move size={10}/>
                      {moveReferenceMode ? 'Moviendo...' : 'Mover'}
                    </button>
                    <button onClick={() => setShowRef(false)} className="text-zinc-500 hover:text-zinc-300 p-0.5">
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* Botón directo a Tallado Volumétrico desde 3 Bocetos */}
                <button
                  onClick={() => {
                    setShowRef(false);
                    useStore.getState().openBlueprintModal();
                  }}
                  className="w-full py-1.5 px-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer"
                  title="Tallado automático 3D combinando 3 vistas (Frontal, Superior, Lateral)"
                >
                  <Sparkles size={11} className="text-amber-300"/>
                  <span>Modelar 3D desde 3 Vistas</span>
                </button>
                {(['top','bottom','front','back','left','right'] as const).map(view=>{
                  const ref=project.references?.[view];
                  const label={top:'Superior',bottom:'Inferior',front:'Frontal',back:'Trasera',left:'Izquierda',right:'Derecha'}[view];
                  return(
                    <div key={view} className="space-y-1.5 border-t border-zinc-800 pt-2 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-zinc-300">{label}</span>
                        <div className="flex gap-1">
                          <button onClick={()=>loadRefImage(view)} className="px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-[9px]">{ref?.url?'Cambiar':'+ Cargar'}</button>
                          {ref?.url&&<button onClick={()=>setReference(view,{url:null})} className="px-2 py-0.5 bg-red-900/50 hover:bg-red-800 rounded text-[9px] text-red-300">✕</button>}
                        </div>
                      </div>
                      {ref?.url&&(
                        <div className="space-y-2 bg-zinc-950/60 p-2 rounded border border-zinc-800/80">
                          <div className="flex items-center gap-2"><span className="text-[9px] text-zinc-500 w-14">Opacidad</span><input type="range" min={0} max={1} step={0.05} value={ref.opacity??0.5} onChange={e=>setReference(view,{opacity:parseFloat(e.target.value)})} className="flex-1 h-1 accent-indigo-500"/><span className="text-[9px] text-zinc-400 w-7">{Math.round((ref.opacity??0.5)*100)}%</span></div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-zinc-500 w-14">Tamaño</span>
                            <div className="flex items-center gap-1.5 flex-1">
                              <input type="range" min={0.5} max={25} step={0.5} 
                                value={ref.scale?.[1] ?? ref.scale?.[0] ?? 5} 
                                onChange={e => {
                                  const v = parseFloat(e.target.value);
                                  setReference(view, { scale: [v, v, v] });
                                }} 
                                className="flex-1 h-1 accent-indigo-500"
                              />
                              <button
                                type="button"
                                onClick={() => setReference(view, { scale: [5, 5, 5] })}
                                className="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[8px] text-zinc-300 border border-zinc-700"
                                title="Restablecer tamaño a escala base de 5m"
                              >
                                5m
                              </button>
                            </div>
                            <span className="text-[9px] text-zinc-400 w-7 font-mono">{safeFixed(ref.scale?.[1] ?? ref.scale?.[0] ?? 5, 1)}</span>
                          </div>

                          {/* ── Rotación y Espejo / Invertir ── */}
                          <div className="flex flex-col gap-1.5 pt-1.5 border-t border-zinc-800/70">
                            <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Orientación y Espejo</span>
                            
                            {/* Botones de Rotación y Espejo */}
                            <div className="grid grid-cols-4 gap-1">
                              <button
                                onClick={() => {
                                  const current = ref.angle || 0;
                                  setReference(view, { angle: (current - 90 + 360) % 360 });
                                }}
                                className="flex items-center justify-center gap-1 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] text-zinc-300 font-medium border border-zinc-700"
                                title="Rotar -90° (Sentido antihorario)"
                              >
                                <RotateCcw size={10} /> -90°
                              </button>

                              <button
                                onClick={() => {
                                  const current = ref.angle || 0;
                                  setReference(view, { angle: (current + 90) % 360 });
                                }}
                                className="flex items-center justify-center gap-1 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] text-zinc-300 font-medium border border-zinc-700"
                                title="Rotar +90° (Sentido horario)"
                              >
                                <RotateCw size={10} /> +90°
                              </button>

                              <button
                                onClick={() => setReference(view, { flipX: !ref.flipX })}
                                className={`flex items-center justify-center gap-1 py-1 rounded text-[9px] font-bold border transition-colors ${
                                  ref.flipX ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                                }`}
                                title="Espejo horizontal (Invertir eje X)"
                              >
                                <FlipHorizontal size={10} /> Espejo
                              </button>

                              <button
                                onClick={() => setReference(view, { flipY: !ref.flipY })}
                                className={`flex items-center justify-center gap-1 py-1 rounded text-[9px] font-bold border transition-colors ${
                                  ref.flipY ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                                }`}
                                title="Invertir vertical (Invertir eje Y)"
                              >
                                <FlipVertical size={10} /> Invertir
                              </button>
                            </div>

                            {/* Slider de Rotación Fina */}
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-zinc-500 w-14">Giro</span>
                              <input 
                                type="range" 
                                min={0} 
                                max={360} 
                                step={1} 
                                value={ref.angle ?? 0} 
                                onChange={e => setReference(view, { angle: parseFloat(e.target.value) })} 
                                className="flex-1 h-1 accent-indigo-500"
                              />
                              <span className="text-[9px] text-zinc-400 w-7 font-mono">{(ref.angle ?? 0)}°</span>
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-1 pt-1 border-t border-zinc-800/50">
                            <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Posición</span>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="flex flex-col gap-1">
                                <span className="text-[8px] text-zinc-500">{(view === 'left' || view === 'right') ? 'Z' : 'X'}</span>
                                <input type="number" step={0.1}
                                  value={ref.position?.[(view === 'left' || view === 'right') ? 2 : 0] ?? 0}
                                  onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    const p = [...(ref.position || [0,0,0])] as [number,number,number];
                                    p[(view === 'left' || view === 'right') ? 2 : 0] = v;
                                    setReference(view, { position: p });
                                  }}
                                  className="w-full px-1 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] text-zinc-200 font-mono"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[8px] text-zinc-500">{(view === 'top' || view === 'bottom') ? 'Z' : 'Y'}</span>
                                <input type="number" step={0.1}
                                  value={ref.position?.[(view === 'top' || view === 'bottom') ? 2 : 1] ?? 0}
                                  onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    const p = [...(ref.position || [0,0,0])] as [number,number,number];
                                    p[(view === 'top' || view === 'bottom') ? 2 : 1] = v;
                                    setReference(view, { position: p });
                                  }}
                                  className="w-full px-1 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] text-zinc-200 font-mono"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[8px] text-zinc-500">Prof.</span>
                                <input type="number" step={0.1}
                                  value={ref.position?.[(view === 'top' || view === 'bottom') ? 1 : (view === 'left' || view === 'right') ? 0 : 2] ?? 0}
                                  onChange={e => {
                                    const v = parseFloat(e.target.value);
                                    const p = [...(ref.position || [0,0,0])] as [number,number,number];
                                    p[(view === 'top' || view === 'bottom') ? 1 : (view === 'left' || view === 'right') ? 0 : 2] = v;
                                    setReference(view, { position: p });
                                  }}
                                  className="w-full px-1 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[9px] text-zinc-200 font-mono"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </div>
        </div>

        {/* ── Derecha ── */}
        <div className={`flex items-center gap-1.5 flex-shrink-0 ml-2 ${isFloating?'flex-wrap justify-center':'flex-nowrap'}`}>
          {/* ── Vista ── */}
          <Dropdown label="Vista" icon={<Layers3 size={14}/>} isOpen={showView} setIsOpen={setShowView} containerRef={viewRef} width={175}>
            <button onClick={()=>{setMaximizedViewport(maximizedViewport === null ? 'TOP' : null);setShowView(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Layers3 size={14}/> {maximizedViewport === null ? '1 Vista' : '4 Vistas'}</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button onClick={()=>{setViewMode('SOLID');setGlobalOpacity(1);setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='SOLID'&&globalOpacity===1?'bg-indigo-600 text-white':'hover:bg-zinc-800'}`}><Box size={14}/> Sólido</button>
            <button onClick={()=>{setViewMode('TEXTURED');setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='TEXTURED'?'bg-indigo-600 text-white':'hover:bg-zinc-800'}`}><ImageIcon size={14}/> Texturas</button>
            <button onClick={()=>{setViewMode('TEXTURED_WIREFRAME');setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='TEXTURED_WIREFRAME'?'bg-indigo-600 text-white':'hover:bg-zinc-800'}`}><Layers size={14} className="text-cyan-400"/> Texturas + Malla</button>
            <button onClick={()=>{setViewMode('WIREFRAME');setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='WIREFRAME'?'bg-indigo-600 text-white':'hover:bg-zinc-800'}`}><Grid size={14}/> Malla</button>
            <button onClick={()=>{setViewMode('FACES_VERTICES');setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='FACES_VERTICES'?'bg-indigo-600 text-white':'hover:bg-zinc-800'}`}><Layers size={14} className="text-emerald-400"/> Caras + Vértices</button>
            <button onClick={()=>{setViewMode('BLUEPRINT');setShowView(false);}} className={`flex items-center gap-2 px-3 py-2 text-[11px] text-left rounded transition-colors ${viewMode==='BLUEPRINT'?'bg-cyan-600 text-white font-bold shadow-sm':'hover:bg-zinc-800 text-cyan-300'}`} title="Vista técnica holograma blueprint con sombreado azul y líneas de pliegue"><Sparkles size={14} className="text-cyan-300"/> Plano Blueprint</button>
            <div className="h-px bg-zinc-800 my-1"/>
            <button onClick={()=>{setShowOpacity(true);setShowView(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Layers size={14}/> Transparencia</button>
            <button onClick={()=>{handleFullscreen();setShowView(false);}} className="flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 rounded transition-colors"><Maximize2 size={14}/> Pantalla Completa</button>
          </Dropdown>

          {/* Transparencia Panel (still needed for the slider) */}
          <div className="relative" ref={opacityRef}>
            {showOpacity&&(
              <div className="fixed z-[200] mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 w-48"
                style={{top:opacityRef.current?.getBoundingClientRect().bottom,left:opacityRef.current?.getBoundingClientRect().left}}>
                <p className="text-[10px] font-bold uppercase text-zinc-500 mb-3">Transparencia global</p>
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {[{label:'Sólido',val:1},{label:'50%',val:0.5},{label:'25%',val:0.25}].map(({label,val})=>(
                    <button key={label} onClick={()=>{setGlobalOpacity(val);setViewMode('SOLID');const cur=useStore.getState().project;useStore.getState().setProject({...cur,objects:cur.objects.map(o=>({...o,opacity:val}))});}}
                      className={`px-1 py-1 rounded text-[10px] font-semibold transition-colors ${Math.abs(globalOpacity-val)<0.01?'bg-indigo-600 text-white':'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>{label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-zinc-500 w-5">0%</span>
                  <input type="range" min={0} max={1} step={0.05} value={globalOpacity}
                    onChange={e=>{const v=parseFloat(e.target.value);setGlobalOpacity(v);setViewMode('SOLID');const cur=useStore.getState().project;useStore.getState().setProject({...cur,objects:cur.objects.map(o=>({...o,opacity:v}))});}}
                    className="flex-1 h-1.5 accent-indigo-500"/>
                  <span className="text-[9px] text-zinc-500 w-8">100%</span>
                </div>
                <p className="text-center text-[10px] text-zinc-400 mt-2 font-mono">{Math.round(globalOpacity*100)}%</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowShortcutsModal(true)}
              onMouseEnter={(e)=>handleHover('Atajos de Teclado (?)', e.currentTarget.getBoundingClientRect(), '?')}
              onMouseLeave={()=>handleHover(null)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/80 shadow-sm group"
              title="Atajos de teclado y panel de navegación rápida (? / F1)"
            >
              <Keyboard size={14} className="text-indigo-400 group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-bold hidden sm:inline">Atajos</span>
            </button>
            <button
              onClick={() => setIsFloating(!isFloating)}
              onMouseEnter={(e)=>handleHover(isFloating ? 'Anclar barra' : 'Desanclar barra', e.currentTarget.getBoundingClientRect())}
              onMouseLeave={()=>handleHover(null)}
              className={`p-1.5 rounded transition-colors ${!isFloating ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              title={isFloating ? 'Anclar a la parte superior' : 'Desanclar (Barra flotante)'}
            >
              <Pin size={14} className={!isFloating ? '' : 'rotate-45'} />
            </button>
            <button
              onClick={() => setShowRender(true)}
              onMouseEnter={(e)=>handleHover('Renderizado Fotorrealista', e.currentTarget.getBoundingClientRect())}
              onMouseLeave={()=>handleHover(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all bg-blue-600 hover:bg-blue-500 text-white border border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.2)] group relative"
            >
              <Sparkles size={14} className="group-hover:scale-110 transition-transform" />
              <span className="text-[11px] font-bold">Render</span>
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-blue-300 rounded-full animate-pulse" />
            </button>
          </div>
        </div>

        {/* Render Modal */}
      {showRender && <RenderModal onClose={() => setShowRender(false)} />}
      {showCodeExporter && <CodeExporterModal isOpen={showCodeExporter} onClose={() => setShowCodeExporter(false)} />}
      <WireframeModal isOpen={showWireframeModal} onClose={() => setShowWireframeModal(false)} />
      <KeyboardShortcutsModal isOpen={showShortcutsModal} onClose={() => setShowShortcutsModal(false)} />
      <SaveProjectModal
        isOpen={showSaveModal}
        mode={saveModalMode}
        onClose={() => setShowSaveModal(false)}
        onSuccessNotification={(msg) => showToast(msg)}
      />
      <ConfirmModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        onConfirm={() => useStore.getState().resetProject()}
        title="Reiniciar Proyecto"
        message="¿Estás seguro de que deseas reiniciar el proyecto? Esta acción eliminará todos los objetos de la escena actual y restaurará la escena inicial por defecto."
        confirmLabel="Sí, reiniciar"
        cancelLabel="Cancelar"
        isDanger={true}
      />
      <FaceSnapDemoModal
        isOpen={showFaceSnapDemoModal || isFaceSnapDemoModalOpen}
        onClose={() => {
          setShowFaceSnapDemoModal(false);
          closeFaceSnapDemoModal();
        }}
      />

      {/* Floating Save/Action Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -15, scale: 0.95 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[999999] bg-zinc-900/95 border border-indigo-500/50 shadow-2xl backdrop-blur-md px-4 py-2.5 rounded-xl text-white text-xs font-semibold flex items-center gap-2.5 text-center pointer-events-none"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tooltip */}
        {tooltip&&(
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed z-[300] bg-zinc-900 text-zinc-200 text-[10px] px-2.5 py-1.5 rounded-lg border border-white/10 shadow-2xl pointer-events-none whitespace-nowrap flex flex-col items-center gap-1"
            style={{top:tooltip.rect.bottom+8,left:tooltip.rect.left+tooltip.rect.width/2,transform:'translateX(-50%)'}}>
            <span className="font-bold">{tooltip.label}</span>
            {tooltip.shortcut && (
              <span className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-white/5 font-mono">
                {tooltip.shortcut}
              </span>
            )}
          </motion.div>
        )}
      </motion.div>
    </TooltipContext.Provider>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────────
const Sep = () => <div className="h-7 w-px bg-zinc-800 mx-1 flex-shrink-0"/>;

const TB: React.FC<{icon:React.ReactNode;label:string;shortcut?:string;onClick:()=>void;disabled?:boolean}> = ({icon,label,shortcut,onClick,disabled}) => {
  const setT = useContext(TooltipContext);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={e=>setT?.(label,e.currentTarget.getBoundingClientRect(),shortcut)}
      onMouseLeave={()=>setT?.(null)}
      className={'p-1.5 rounded transition-all flex-shrink-0 '+(disabled?'text-zinc-700 cursor-not-allowed':'text-zinc-400 hover:bg-zinc-800 hover:text-white')}>
      {icon}
    </button>
  );
};

const MB: React.FC<{active:boolean;onClick:()=>void;title:string;shortcut?:string;children:React.ReactNode}> = ({active,onClick,title,shortcut,children}) => {
  const setT = useContext(TooltipContext);
  return (
    <button onClick={onClick}
      onMouseEnter={e=>setT?.(title,e.currentTarget.getBoundingClientRect(),shortcut)}
      onMouseLeave={()=>setT?.(null)}
      className={'p-1.5 rounded transition-colors '+(active?'bg-zinc-700 text-white shadow':'text-zinc-500 hover:text-zinc-300')}>
      {children}
    </button>
  );
};

const QuickButton: React.FC<{active:boolean; onClick:()=>void; icon:React.ReactNode; label:string; shortcut?:string}> = ({active, onClick, icon, label, shortcut}) => {
  const setT = useContext(TooltipContext);
  return (
    <button 
      onClick={onClick}
      onMouseEnter={e=>setT?.(label, e.currentTarget.getBoundingClientRect(), shortcut)}
      onMouseLeave={()=>setT?.(null)}
      className={`p-1.5 rounded-md transition-all flex items-center gap-1.5 ${
        active 
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20' 
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold hidden xl:inline">{label}</span>
    </button>
  );
};

// Panel micro-components
const Dropdown: React.FC<{
  label: React.ReactNode;
  icon?: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  children: React.ReactNode;
  containerRef: React.RefObject<HTMLDivElement>;
  width?: number;
}> = ({ label, icon, isOpen, setIsOpen, children, containerRef, width = 180 }) => (
  <div className="relative flex-shrink-0" ref={containerRef}>
    <button onClick={() => setIsOpen(!isOpen)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-all border ${
        isOpen
          ? 'bg-zinc-700 text-white border-zinc-500 shadow-lg'
          : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700 hover:text-white'
      }`}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
      <ChevronDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
    </button>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          drag
          dragMomentum={false}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          className="fixed z-[200] mt-1 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 flex flex-col gap-1 max-h-[85vh] overflow-y-auto"
          style={{
            top: containerRef.current?.getBoundingClientRect().bottom,
            left: Math.min(containerRef.current?.getBoundingClientRect().left ?? 0, window.innerWidth - width - 10),
            width,
          }}
        >
          {/* Draggable header bar */}
          <div className="flex items-center justify-between px-1 pb-1 mb-1 border-b border-zinc-800/80 cursor-grab active:cursor-grabbing select-none">
            <div className="flex items-center gap-1">
              <GripVertical size={11} className="text-zinc-500" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Menú</span>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); setIsOpen(false); }}
              className="text-zinc-500 hover:text-zinc-300 p-0.5"
            >
              <X size={11} />
            </button>
          </div>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const PTitle: React.FC<{icon:string;title:string;desc:string}> = ({icon,title,desc}) => (
  <div className="mb-1">
    <p className="text-[12px] font-bold text-zinc-100">{icon} {title}</p>
    <p className="text-[9px] text-zinc-500 leading-tight">{desc}</p>
  </div>
);

const CRow: React.FC<{label:string;children:React.ReactNode}> = ({label,children}) => (
  <div className="flex items-center gap-2">
    <span className="text-[10px] text-zinc-400 w-24 flex-shrink-0 font-medium">{label}</span>
    <div className="flex items-center gap-1.5 flex-1">{children}</div>
  </div>
);

const CVal: React.FC<{children:React.ReactNode}> = ({children}) => (
  <span className="text-[10px] text-zinc-300 font-mono w-8 text-right">{children}</span>
);

const PresetBtn: React.FC<{label:string;onClick:()=>void;active?:boolean}> = ({label,onClick,active}) => (
  <button onClick={onClick}
    className={`px-2 py-1 rounded text-[9px] font-semibold transition-colors ${active?'bg-violet-700 text-white':'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
    {label}
  </button>
);

const CreateBtn: React.FC<{onClick:()=>void}> = ({onClick}) => (
  <button onClick={onClick}
    className="w-full py-2 bg-violet-600 hover:bg-violet-500 text-white rounded text-[11px] font-bold transition-colors mt-1 shadow">
    ＋ Crear objeto
  </button>
);


// SiluetaTab → src/components/SiluetaTab.tsx

// ════════════════════════════════════════════════════════════════════════════
// SHAPE PICKER
// ════════════════════════════════════════════════════════════════════════════
const ShapePicker: React.FC<{
  project:any; pickedId:string|null; onPick:(id:string|null)=>void;
  label:string; color?:string;
}> = ({project,pickedId,onPick,label})=>{
  const shapes = project.objects.filter((o:any)=>o.type==='SHAPE');
  return(<div className="space-y-1">
    <p className="text-[9px] text-zinc-500 font-bold uppercase">{label}</p>
    {shapes.length===0
      ? <p className="text-[9px] text-zinc-600 italic">No hay formas 2D. Dibuja una primero con las herramientas de dibujo (Lápiz/Bézier).</p>
      : <div className="flex flex-col gap-1">{shapes.map((o:any)=>(
          <button key={o.id} onClick={()=>onPick(pickedId===o.id?null:o.id)}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-semibold text-left transition-colors border ${pickedId===o.id?'bg-violet-700 border-violet-500 text-white':'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}`}>
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{background:o.color}}/>
            <span className="flex-1 truncate">{o.name}</span>
            <span className="text-[8px] text-zinc-500">{o.vertices.length}pts</span>
            {pickedId===o.id&&<span className="text-violet-300">✓</span>}
          </button>
        ))}</div>}
  </div>);
};

// ════════════════════════════════════════════════════════════════════════════
// TORNO LIBRE
// ════════════════════════════════════════════════════════════════════════════
const LatheFromShapeTab: React.FC<{
  latPickedId:string|null; setLatPickedId:(v:string|null)=>void;
  latAxis:'x'|'y'|'z'; setLatAxis:(v:'x'|'y'|'z')=>void;
  latAngle:number; setLatAngle:(v:number)=>void;
  latSegs:number;  setLatSegs:(v:number)=>void;
  latOffset:number; setLatOffset:(v:number)=>void;
  project:any;
  onGenerate:(v:V3[],f:MeshFace[],n:string)=>void;
}> = ({latPickedId,setLatPickedId,latAxis,setLatAxis,latAngle,setLatAngle,latSegs,setLatSegs,latOffset,setLatOffset,project,onGenerate})=>{
  const pickedObj = project.objects.find((o:any)=>o.id===latPickedId);
  return(<>
    <PTitle icon="⊙" title="Torno — Revolución libre"
      desc="Dibuja el perfil 2D en vista FRONTAL, selecciónalo aquí y genera la revolución."/>
    <div className="bg-zinc-800/40 rounded p-2 text-[9px] text-zinc-500 space-y-1">
      <p className="text-zinc-300 font-bold">Cómo usar:</p>
      <p>① Activa las herramientas de dibujo (Lápiz) en la barra superior</p>
      <p>② Dibuja la <b>mitad del perfil</b> en vista FRONTAL (el lado derecho del objeto)</p>
      <p>③ Haz doble clic para finalizar la forma</p>
      <p>④ Selecciona la forma aquí y configura los parámetros</p>
    </div>
    <ShapePicker project={project} pickedId={latPickedId} onPick={setLatPickedId} label="Perfil 2D dibujado"/>
    {pickedObj&&<div className="bg-emerald-900/30 border border-emerald-800/50 rounded p-2 text-[9px] text-emerald-400">
      ✓ <b>{pickedObj.name}</b> — {pickedObj.vertices.length} puntos
    </div>}
    <CRow label="Eje">
      <div className="flex gap-1">
        {(['x','y','z'] as const).map(ax=>(
          <button key={ax} onClick={()=>setLatAxis(ax)}
            className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${latAxis===ax?'bg-indigo-600 text-white':'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}>{ax}
          </button>
        ))}
      </div>
    </CRow>
    <CRow label="Ángulo °">
      <input type="range" min={1} max={360} value={latAngle} onChange={e=>setLatAngle(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/>
      <CVal>{latAngle}°</CVal>
    </CRow>
    <CRow label="Segmentos">
      <input type="range" min={4} max={128} value={latSegs} onChange={e=>setLatSegs(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/>
      <CVal>{latSegs}</CVal>
    </CRow>
    <CRow label="Dist. eje">
      <input type="number" step={0.05} value={latOffset} onChange={e=>setLatOffset(+e.target.value)}
        className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/>
      <span className="text-[9px] text-zinc-500">u (hueco interior)</span>
    </CRow>
    <button disabled={!latPickedId||!pickedObj} onClick={()=>{
      if(!pickedObj) return;
      const profile = shapeToProfile(pickedObj, latAxis);
      if(profile.length<2){alert('El perfil necesita al menos 2 puntos');return;}
      const{vertices,faces}=revolveMesh(profile,latSegs,latAngle,latAxis,latOffset,latAngle>=359);
      if(!vertices.length){alert('Error al generar. Comprueba que el perfil está a un lado del eje.');return;}
      onGenerate(vertices,faces,`Torno - ${pickedObj.name}`);
    }} className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${(latPickedId&&pickedObj)?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
      ⊙ Generar revolución
    </button>
  </>);
};

// ════════════════════════════════════════════════════════════════════════════
// SWEEP DESDE ESCENA
// ════════════════════════════════════════════════════════════════════════════
const SweepFromShapeTab: React.FC<{
  sweepPickProfile:string|null; setSweepPickProfile:(v:string|null)=>void;
  sweepPickPath:string|null;    setSweepPickPath:(v:string|null)=>void;
  project:any;
  onGenerate:(v:V3[],f:MeshFace[],n:string)=>void;
}> = ({sweepPickProfile,setSweepPickProfile,sweepPickPath,setSweepPickPath,project,onGenerate})=>{
  const profObj=project.objects.find((o:any)=>o.id===sweepPickProfile);
  const pathObj=project.objects.find((o:any)=>o.id===sweepPickPath);
  return(<>
    <PTitle icon="⟳" title="Sweep desde formas"
      desc="Selecciona un perfil (sección transversal) y un camino (trayectoria) dibujados en la escena."/>
    <ShapePicker project={project} pickedId={sweepPickProfile} onPick={setSweepPickProfile} label="① Perfil (sección transversal)"/>
    <ShapePicker project={project} pickedId={sweepPickPath} onPick={p=>{if(p!==sweepPickProfile)setSweepPickPath(p);}} label="② Camino (trayectoria)"/>
    {profObj&&pathObj&&<div className="bg-emerald-900/30 border border-emerald-800/50 rounded p-2 text-[9px] text-emerald-400 space-y-0.5">
      <p>✓ Perfil: <b>{profObj.name}</b> ({profObj.vertices.length}pts)</p>
      <p>✓ Camino: <b>{pathObj.name}</b> ({pathObj.vertices.length}pts)</p>
    </div>}
    <button disabled={!sweepPickProfile||!sweepPickPath||sweepPickProfile===sweepPickPath}
      onClick={()=>{
        if(!profObj||!pathObj) return;
        import('../utils/modifiers').then(({sweepMesh})=>{
          import('three').then(T=>{
            const profile2D=profObj.vertices.map((v:V3)=>[v[0],v[1]] as [number,number]);
            const path3D=pathObj.vertices.map((v:V3)=>new T.Vector3(v[0],v[1],v[2]));
            const{vertices,faces}=sweepMesh(profile2D,path3D,true);
            onGenerate(vertices,faces,`Sweep ${profObj.name}→${pathObj.name}`);
          });
        });
      }}
      className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${(sweepPickProfile&&sweepPickPath&&sweepPickProfile!==sweepPickPath)?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
      ⟳ Generar Sweep
    </button>
  </>);
};

// ════════════════════════════════════════════════════════════════════════════
// LOFT DESDE ESCENA
// ════════════════════════════════════════════════════════════════════════════
const LoftFromShapeTab: React.FC<{
  loftPickA:string|null; setLoftPickA:(v:string|null)=>void;
  loftPickB:string|null; setLoftPickB:(v:string|null)=>void;
  loftH:number; setLoftH:(v:number)=>void;
  loftN:number; setLoftN:(v:number)=>void;
  loftS1:string; setLoftS1:(v:any)=>void;
  loftS2:string; setLoftS2:(v:any)=>void;
  project:any;
  getLoftSec:(t:any,y:number,n:number)=>V3[];
  onGenerate:(v:V3[],f:MeshFace[],n:string)=>void;
}> = ({loftPickA,setLoftPickA,loftPickB,setLoftPickB,loftH,setLoftH,loftN,setLoftN,loftS1,setLoftS1,loftS2,setLoftS2,project,getLoftSec,onGenerate})=>{
  const [useScene,setUseScene]=React.useState(false);
  const objA=project.objects.find((o:any)=>o.id===loftPickA);
  const objB=project.objects.find((o:any)=>o.id===loftPickB);
  return(<>
    <PTitle icon="⬦" title="Loft (Solevado)" desc="Interpola entre dos secciones transversales."/>
    <div className="flex gap-1 bg-zinc-800/50 rounded p-1">
      <button onClick={()=>setUseScene(false)} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${!useScene?'bg-violet-600 text-white':'text-zinc-400 hover:text-zinc-200'}`}>Predefinidos</button>
      <button onClick={()=>setUseScene(true)}  className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${useScene?'bg-violet-600 text-white':'text-zinc-400 hover:text-zinc-200'}`}>Desde escena</button>
    </div>
    {!useScene?(<>
      {([{label:'Secc. A',val:loftS1,set:setLoftS1},{label:'Secc. B',val:loftS2,set:setLoftS2}]).map(({label,val,set})=>(
        <CRow key={label} label={label}><div className="flex gap-1">
          {(['círculo','cuadrado','estrella'] as const).map(s=>(
            <button key={s} onClick={()=>(set as any)(s)} className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${val===s?'bg-violet-600 text-white':'bg-zinc-700 text-zinc-400'}`}>
              {s==='círculo'?'○':s==='cuadrado'?'□':'★'}
            </button>
          ))}
        </div></CRow>
      ))}
      <CRow label="Altura"><input type="number" min={0.1} step={0.1} value={loftH} onChange={e=>setLoftH(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
      <CRow label="Segmentos"><input type="range" min={4} max={32} value={loftN} onChange={e=>setLoftN(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{loftN}</CVal></CRow>
      <CreateBtn onClick={()=>{
        import('../utils/modifiers').then(({loftMesh})=>{
          const{vertices,faces}=loftMesh([getLoftSec(loftS1,0,loftN),getLoftSec(loftS2,loftH,loftN)],true);
          onGenerate(vertices,faces,`Loft ${loftS1}→${loftS2}`);
        });
      }}/>
    </>):(<>
      <ShapePicker project={project} pickedId={loftPickA} onPick={setLoftPickA} label="① Sección inferior"/>
      <ShapePicker project={project} pickedId={loftPickB} onPick={p=>{if(p!==loftPickA)setLoftPickB(p);}} label="② Sección superior"/>
      <CRow label="Altura"><input type="number" min={0.1} step={0.1} value={loftH} onChange={e=>setLoftH(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
      <button disabled={!loftPickA||!loftPickB||loftPickA===loftPickB} onClick={()=>{
        if(!objA||!objB) return;
        import('../utils/modifiers').then(({loftMesh})=>{
          const secA=objA.vertices.map((v:V3):V3=>[v[0],v[1],v[2]]);
          const secB=objB.vertices.map((v:V3):V3=>[v[0],v[1]+loftH,v[2]]);
          const{vertices,faces}=loftMesh([secA,secB],true);
          onGenerate(vertices,faces,`Loft ${objA.name}→${objB.name}`);
        });
      }} className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${(loftPickA&&loftPickB&&loftPickA!==loftPickB)?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
        ⬦ Generar Loft desde escena
      </button>
    </>)}
  </>);
};

// ════════════════════════════════════════════════════════════════════════════
// HERRAMIENTAS AVANZADAS CAD
// ════════════════════════════════════════════════════════════════════════════
const AdvancedTab: React.FC<{
  advTab:'extrude'|'chamfer'|'offset'|'array'|'cap'|'separate'; setAdvTab:(v:any)=>void;
  advChamferD:number; setAdvChamferD:(v:number)=>void;
  advChamferA:number; setAdvChamferA:(v:number)=>void;
  advOffsetD:number;  setAdvOffsetD:(v:number)=>void;
  advArrType:'linear'|'polar'; setAdvArrType:(v:any)=>void;
  advArrCount:number; setAdvArrCount:(v:number)=>void;
  advArrStepX:number; setAdvArrStepX:(v:number)=>void;
  advArrStepY:number; setAdvArrStepY:(v:number)=>void;
  advArrStepZ:number; setAdvArrStepZ:(v:number)=>void;
  advArrAngle:number; setAdvArrAngle:(v:number)=>void;
  advArrAxis:'x'|'y'|'z'; setAdvArrAxis:(v:any)=>void;
  selectedObject:any; selectedObjectId:string|null; project:any;
  onApply:(v:V3[],f:MeshFace[],n:string,t?:string,p?:any)=>void;
  onMultiAdd:(objs:any[])=>void;
  onModify:(v:V3[],f:MeshFace[])=>void;
  extrudeDist:number; setExtrudeDist:(v:number)=>void;
  extrudeAxis:'x'|'y'|'z'; setExtrudeAxis:(v:any)=>void;
  editMode:string; selectedFaceIndices:number[];
}> = (p)=>{
  const{advTab,setAdvTab,advChamferD,setAdvChamferD,advChamferA,setAdvChamferA,
    advOffsetD,setAdvOffsetD,advArrType,setAdvArrType,advArrCount,setAdvArrCount,
    advArrStepX,setAdvArrStepX,advArrStepY,setAdvArrStepY,advArrStepZ,setAdvArrStepZ,
    advArrAngle,setAdvArrAngle,advArrAxis,setAdvArrAxis,
    selectedObject,selectedObjectId,onMultiAdd,onModify,
    extrudeDist,setExtrudeDist,extrudeAxis,setExtrudeAxis,
    editMode,selectedFaceIndices}=p;
  const hasSel=!!selectedObjectId&&!!selectedObject;
  const EXTRUDABLE = ['SHAPE','PLANE','RING','CIRCLE'];
  const isExtrudable = EXTRUDABLE.includes(selectedObject?.type ?? '');
  const canExtrudeFaces = editMode === 'FACE' && selectedFaceIndices.length > 0;

  return(<>
    <PTitle icon="⚙️" title="Modificación avanzada" desc="Extrusión, Chaflán 3D, equidistancia, array, tapar y separar partes sueltas."/>
    <div className="grid grid-cols-6 gap-1">
      {([{id:'extrude',label:'Extruir',icon:'📤'},{id:'chamfer',label:'Chaflán',icon:'◥'},{id:'offset',label:'Offset',icon:'⊡'},{id:'array',label:'Array',icon:'⠿'},{id:'cap',label:'Tapar',icon:'⬜'},{id:'separate',label:'Partes',icon:'🧩'}] as const).map(op=>(
        <button key={op.id} onClick={()=>setAdvTab(op.id)}
          className={`flex flex-col items-center py-2 rounded text-[9px] font-bold transition-colors ${advTab===op.id?'bg-violet-600 text-white':'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
          <span className="text-base mb-0.5">{op.icon}</span>{op.label}
        </button>
      ))}
    </div>
    {!hasSel&&advTab!=='array'&&<p className="text-[9px] text-amber-400 bg-amber-900/30 rounded px-2 py-1.5">⚠ Selecciona un objeto primero.</p>}
    {advTab==='extrude'&&(<>
      <div className="text-[9px] text-zinc-400 bg-zinc-800/50 rounded p-2">Crea volumen a partir de formas 2D o caras de malla.</div>
      {editMode === 'FACE' ? (
        <>
          <CRow label="Distancia"><input type="range" min={0.01} max={2} step={0.01} value={extrudeDist} onChange={e=>setExtrudeDist(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{safeFixed(extrudeDist, 2)}</CVal></CRow>
          <button disabled={!canExtrudeFaces} onClick={()=>{
            if(!selectedObjectId)return;
            useStore.getState().extrudeFaces(selectedObjectId,selectedFaceIndices,extrudeDist);
          }} className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${canExtrudeFaces?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
            📤 Extruir Caras ({selectedFaceIndices.length})
          </button>
        </>
      ) : (
        <>
          <CRow label="Eje"><div className="flex gap-1">{(['x','y','z'] as const).map(ax=>(<button key={ax} onClick={()=>setExtrudeAxis(ax)} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${extrudeAxis===ax?'bg-indigo-600 text-white':'bg-zinc-700 text-zinc-400'}`}>{ax}</button>))}</div></CRow>
          <CRow label="Distancia"><input type="range" min={0.01} max={2} step={0.01} value={extrudeDist} onChange={e=>setExtrudeDist(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{safeFixed(extrudeDist, 2)}</CVal></CRow>
          <button disabled={!isExtrudable} onClick={()=>{
            if(!selectedObjectId)return;
            useStore.getState().extrudeShape(selectedObjectId,extrudeDist,extrudeAxis);
          }} className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${isExtrudable?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
            📤 Extruir Objeto
          </button>
        </>
      )}
    </>)}
    {advTab==='chamfer'&&(<>
      <div className="text-[9px] text-zinc-400 bg-zinc-800/50 rounded p-2">Aristas vivas → <b>caras planas inclinadas</b>. Detecta aristas por ángulo diedro.</div>
      <CRow label="Distancia"><input type="range" min={0.01} max={0.5} step={0.01} value={advChamferD} onChange={e=>setAdvChamferD(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{safeFixed(advChamferD, 2)}</CVal></CRow>
      <CRow label="Umbral °"><input type="range" min={10} max={80} step={5} value={advChamferA} onChange={e=>setAdvChamferA(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{advChamferA}°</CVal></CRow>
      <button disabled={!hasSel} onClick={()=>{if(!selectedObject)return;const r=chamfer3DEdges(selectedObject,advChamferD,advChamferA);onModify(r.vertices,r.faces);}}
        className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${hasSel?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
        ◥ Aplicar Chaflán 3D
      </button>
    </>)}
    {advTab==='offset'&&(<>
      <div className="text-[9px] text-zinc-400 bg-zinc-800/50 rounded p-2">Infla o deflacta la malla. <b>+</b> = hacia afuera · <b>−</b> = hacia adentro.</div>
      <CRow label="Distancia"><input type="range" min={-0.5} max={0.5} step={0.01} value={advOffsetD} onChange={e=>setAdvOffsetD(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{advOffsetD>0?'+':''}{safeFixed(advOffsetD, 2)}</CVal></CRow>
      <button disabled={!hasSel} onClick={()=>{if(!selectedObject)return;useStore.getState().offsetObject(selectedObject.id,advOffsetD);}}
        className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${hasSel?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
        ⊡ Aplicar Offset
      </button>
    </>)}
    {advTab==='array'&&(<>
      <div className="flex gap-1 bg-zinc-800/50 rounded p-1">
        <button onClick={()=>setAdvArrType('linear')} className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${advArrType==='linear'?'bg-violet-600 text-white':'text-zinc-400 hover:text-zinc-200'}`}>Lineal</button>
        <button onClick={()=>setAdvArrType('polar')}  className={`flex-1 py-1 rounded text-[9px] font-bold transition-colors ${advArrType==='polar'?'bg-violet-600 text-white':'text-zinc-400 hover:text-zinc-200'}`}>Polar</button>
      </div>
      {!hasSel&&<p className="text-[9px] text-amber-400 bg-amber-900/30 rounded px-2 py-1.5">⚠ Selecciona el objeto a repetir.</p>}
      <CRow label="Cantidad"><input type="range" min={2} max={24} value={advArrCount} onChange={e=>setAdvArrCount(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{advArrCount}</CVal></CRow>
      {advArrType==='linear'&&([['X',advArrStepX,setAdvArrStepX],['Y',advArrStepY,setAdvArrStepY],['Z',advArrStepZ,setAdvArrStepZ]]).map(([ax,val,setter]:any)=>(
        <CRow key={ax} label={`Paso ${ax}`}><input type="number" step={0.1} value={val} onChange={e=>(setter as any)(+e.target.value)} className="w-16 px-2 py-1 bg-zinc-800 rounded text-[11px] text-zinc-200 border border-zinc-700"/></CRow>
      ))}
      {advArrType==='polar'&&(<>
        <CRow label="Ángulo total"><input type="range" min={1} max={360} value={advArrAngle} onChange={e=>setAdvArrAngle(+e.target.value)} className="flex-1 accent-violet-500 h-1.5"/><CVal>{advArrAngle}°</CVal></CRow>
        <CRow label="Eje"><div className="flex gap-1">{(['x','y','z'] as const).map(ax=>(<button key={ax} onClick={()=>setAdvArrAxis(ax)} className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors ${advArrAxis===ax?'bg-indigo-600 text-white':'bg-zinc-700 text-zinc-400'}`}>{ax}</button>))}</div></CRow>
      </>)}
      <button disabled={!hasSel} onClick={()=>{
        if(!selectedObject) return;
        const copies=advArrType==='linear'?arrayLinear(selectedObject,advArrCount,[advArrStepX,advArrStepY,advArrStepZ]):arrayPolar(selectedObject,advArrCount,advArrAngle,advArrAxis);
        onMultiAdd(copies);
      }} className={`w-full py-2 rounded text-[11px] font-bold transition-colors ${hasSel?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
        ⠿ Crear Array ({advArrCount} copias)
      </button>
    </>)}
    {advTab==='cap'&&(<>
      <div className="text-[9px] text-zinc-400 bg-zinc-800/50 rounded p-2 space-y-1">
        <p className="text-zinc-300 font-bold">Tapar huecos</p>
        <p><b>Automático:</b> detecta y cierra todos los huecos abiertos de la malla.</p>
        <p><b>Por selección:</b> selecciona caras en modo CARA, luego pulsa "Tapar selección" para crear una cara que une los bordes del hueco.</p>
      </div>
      <div className="flex gap-1">
        <button disabled={!hasSel} onClick={()=>{
          if(!selectedObject) return;
          const r=capOpenHoles(selectedObject);
          if(r.faces.length===selectedObject.faces.length){alert('No se encontraron huecos abiertos.');return;}
          const added=r.faces.length-selectedObject.faces.length;
          onModify(r.vertices,r.faces);
          alert(`✓ Se cerraron ${added} huecos.`);
        }} className={`flex-1 py-2 rounded text-[11px] font-bold transition-colors ${hasSel?'bg-violet-600 hover:bg-violet-500 text-white':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
          ⬜ Automático
        </button>
        <button disabled={!hasSel || useStore.getState().editMode !== 'FACE'} onClick={()=>{
          if(!selectedObject) return;
          const { selectedFaceIndices } = useStore.getState();
          const r = capSelectedFaces(selectedObject, selectedFaceIndices);
          if (r.report.includes('No hay caras seleccionadas')) { alert('Selecciona caras primero.'); return; }
          onModify(r.vertices, r.faces);
          alert('✓ Hueco de selección cerrado.');
        }} className={`flex-1 py-2 rounded text-[11px] font-bold transition-colors ${hasSel && useStore.getState().editMode === 'FACE' ? 'bg-teal-600 hover:bg-teal-500 text-white' : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
          ▣ Tapar Selección
        </button>
      </div>
    </>)}
    {advTab==='separate'&&(<>
      <div className="text-[9px] text-zinc-400 bg-zinc-800/50 rounded p-2 space-y-1">
        <p className="text-zinc-300 font-bold">Separar por partes sueltas (Mesh Explode)</p>
        <p>Analiza la conectividad geométrica del objeto seleccionado. Si consta de piezas independientes desconectadas, creará un objeto individual para cada sub-malla en la jerarquía de la escena.</p>
      </div>
      <button disabled={!hasSel} onClick={async ()=>{
        if(!selectedObject) return;
        const res = await useStore.getState().ungroupSelectedObject(selectedObject.id);
        alert(res.message);
      }} className={`w-full py-2.5 px-3 rounded text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${hasSel?'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/30':'bg-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
        <Split size={14} /> Separar por partes sueltas
      </button>
    </>)}
  </>);
};