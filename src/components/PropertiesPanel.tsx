/**
 * PropertiesPanel.tsx
 *
 * Panel lateral de propiedades del objeto seleccionado.
 * Permite editar TODOS los parámetros en tiempo real con regeneración automática.
 */

import { MaterialPanel } from './MaterialPanel';
import { ConfigPanel } from './ConfigPanel';
import { EditMeshPanel } from './EditMeshPanel';
import { HistoryPanel } from './HistoryPanel';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  generatePolygon, generateArc,
  latheMesh, LATHE_PRESETS,
  sweepMesh, SWEEP_PROFILES, makeStraightPath, makeArcPath, makeHelixPath,
  loftMesh, circleSection, squareSection, starSection,
} from '../utils/modifiers';
import { createRetopoQuadPlane, createRetopoCage, getObjectRealBoundingBox } from '../utils/shrinkwrap';
import type { V3, MeshFace, MaterialData, CameraObject, Transform, BackgroundMode, ShrinkwrapMode } from '../types';
import { PRESET_HDRIS } from '../utils/environmentHelper';
import { useStore } from '../store/useStore';
import type { CSGObject } from '../types';
import { MapEditorModal } from './MapEditorModal';
import { ProceduralMapModal, ProceduralConfig } from './ProceduralMapModal';
import { createCameraPathObject } from '../utils/cameraPathHelper';
import { MESH_NOISE_PRESETS, type NoiseDeformConfig, type MeshNoiseType, type MeshNoiseDirection } from '../utils/meshNoise';
import {
  ChevronDown, ChevronUp, ChevronRight, RotateCw, Maximize, Maximize2,
  Move, Eye, EyeOff, Trash2, Copy, Save, Book,
  Box, Layers, Wand2, CheckCircle, Square,
  AlignCenterHorizontal, AlignCenterVertical, AlignStartHorizontal,
  AlignEndHorizontal, AlignStartVertical, AlignEndVertical,
  Image as ImageIcon, Upload, Download, FileDown,
  Palette, Settings, Plus, X, MousePointer2, Info, Globe, Sun, ArrowLeft, Camera, Split, Grid,
  ArrowUpFromLine, Target, ArrowDownNarrowWide, Compass, Route,
  Spline, Waves, Orbit, Sparkles, RefreshCw, RotateCcw, ArrowRightLeft, GitMerge, FileDigit,
  SlidersHorizontal, Keyboard, Scissors, Combine, ArrowLeftRight, Cloud, Wind, Flame, Zap,
  Activity, Shield, Magnet, Disc, Droplets, Lock, Unlock, CircleDot, Bone,
  AlertCircle, History
} from 'lucide-react';
import { UnifiedBooleanOp } from '../utils/booleanOperations';
import { safeFixed, safeNum, safeParseFixed } from '../utils/numberUtils';
import { VOLUMETRIC_PRESETS, DEFAULT_VOLUMETRIC_CONFIG } from '../utils/volumetricRaymarch';
import { DEFAULT_PARTICLE_CONFIG, DEFAULT_SPACE_WARP_CONFIG, PARTICLE_PRESETS, SPACE_WARP_PRESETS } from '../utils/particleSystem';
import { DEFAULT_GPGPU_SWARM_CONFIG, GPGPU_SWARM_PRESETS } from '../utils/gpgpuSwarm';
import type { VolumetricConfig, ParticleSystemConfig, SpaceWarpConfig, GpgpuSwarmConfig } from '../types';
import { fileToDataURL } from '../utils/silhouettes';
import { Exporter } from '../utils/exporters';
import { extractUniqueEdges } from '../utils/wireframeMesh';
import { hasChildrenOrSubObjects } from '../utils/ungroup';
import { createNoiseTexture, createCheckerTexture, createWoodTexture, createOakPlanksTexture, createOakPlanksRoughnessMap, createOakPlanksAOMap, MATERIAL_LIBRARY, MATERIAL_CATEGORIES, generateMaterial } from '../utils/proceduralTextures';

// ─── Tipos de label por categoría ────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  CUBE: 'Cubo', SPHERE: 'Esfera UV', GEOSPHERE: 'GeoEsfera', CYLINDER: 'Cilindro', CONE: 'Cono',
  TORUS: 'Toroide', ICOSAHEDRON: 'Icosaedro', DODECAHEDRON: 'Dodecaedro',
  PYRAMID: 'Pirámide', PRISM: 'Prisma', CAPSULE: 'Cápsula',
  TETRAHEDRON: 'Tetraedro', OCTAHEDRON: 'Octaedro', TUBE: 'Tubo 3D',
  ARC: 'Arco 3D', STAR: 'Estrella 3D',
  WEDGE: 'Cuña', HEMISPHERE: 'Hemisferio',
  PLANE: 'Plano', CIRCLE: 'Círculo', RING: 'Anillo',
  SHAPE: 'Forma 2D', MESH: 'Malla',
  VOLUME_CLOUD: 'Nube Volumétrica 3D',
  PARTICLE_SYSTEM: 'Sistema de Partículas (PF Source)',
  SPACE_WARP: 'Deformador Espacial (Space Warp)',
  NURBS_CURVE: 'Curva NURBS',
  NURBS_CIRCLE: 'Círculo NURBS',
  NURBS_SURFACE: 'Superficie NURBS',
  NURBS_CYLINDER: 'Cilindro NURBS',
  NURBS_CONE: 'Cono NURBS',
  NURBS_SPHERE: 'Esfera NURBS',
  NURBS_TORUS: 'Toroide NURBS',
};

const TYPE_COLORS: Record<string, string> = {
  CUBE: 'bg-blue-900/60 text-blue-300',
  SPHERE: 'bg-purple-900/60 text-purple-300',
  CYLINDER: 'bg-cyan-900/60 text-cyan-300',
  CONE: 'bg-orange-900/60 text-orange-300',
  TORUS: 'bg-pink-900/60 text-pink-300',
  ICOSAHEDRON: 'bg-emerald-900/60 text-emerald-300',
  PYRAMID: 'bg-yellow-900/60 text-yellow-300',
  PRISM: 'bg-emerald-900/60 text-emerald-300',
  CAPSULE: 'bg-teal-900/60 text-teal-300',
  TETRAHEDRON: 'bg-rose-900/60 text-rose-300',
  OCTAHEDRON: 'bg-violet-900/60 text-violet-300',
  TUBE: 'bg-fuchsia-900/60 text-fuchsia-300',
  ARC: 'bg-teal-900/60 text-teal-300',
  STAR: 'bg-yellow-900/60 text-yellow-300',
  WEDGE: 'bg-slate-700/60 text-slate-300',
  HEMISPHERE: 'bg-sky-900/60 text-sky-300',
  PLANE: 'bg-zinc-700/60 text-zinc-300',
  CIRCLE: 'bg-zinc-700/60 text-zinc-300',
  RING: 'bg-zinc-700/60 text-zinc-300',
  SHAPE: 'bg-indigo-900/60 text-indigo-300',
  MESH: 'bg-amber-900/60 text-amber-300',
  NURBS_CURVE: 'bg-cyan-900/60 text-cyan-300',
  NURBS_CIRCLE: 'bg-sky-900/60 text-sky-300',
  NURBS_SURFACE: 'bg-teal-900/60 text-teal-300',
  NURBS_CYLINDER: 'bg-blue-900/60 text-blue-300',
  NURBS_CONE: 'bg-amber-900/60 text-amber-300',
  NURBS_SPHERE: 'bg-indigo-900/60 text-indigo-300',
  NURBS_TORUS: 'bg-violet-900/60 text-violet-300',
};

const OPERATION_COLORS: Record<string, string> = {
  ADD:       'bg-emerald-600 text-white',
  SUBTRACT:  'bg-red-600 text-white',
  INTERSECT: 'bg-amber-600 text-white',
};
const OPERATION_LABELS: Record<string, string> = {
  ADD: 'Unión', SUBTRACT: 'Resta', INTERSECT: 'Intersección',
};

// ─── Micro-componentes ────────────────────────────────────────────────────────

import { motion, AnimatePresence } from 'framer-motion';

export const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; badge?: React.ReactNode }> = ({
  title, icon, children, defaultOpen = false, badge
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => e.key === 'Enter' && setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-white/[0.02] transition-all text-left group cursor-pointer"
      >
        <motion.span 
          animate={{ rotate: open ? 0 : -90 }}
          className="text-zinc-600 group-hover:text-zinc-400 flex-shrink-0"
        >
          <ChevronDown size={14}/>
        </motion.span>
        {icon && <span className="text-zinc-500 group-hover:text-indigo-400 transition-colors flex-shrink-0">{icon}</span>}
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500 group-hover:text-zinc-300 transition-colors flex-1">{title}</span>
        {badge}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'circOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-5 space-y-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const NumRow: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  slider?: boolean;
}> = ({ label, value, onChange, min, max, step = 0.01, unit, slider }) => (
  <div className="flex items-center gap-3">
    <span className="text-[10px] text-zinc-500 w-24 flex-shrink-0 font-bold uppercase tracking-wider">{label}</span>
    {slider && min !== undefined && max !== undefined ? (
      <div className="flex-1 flex items-center gap-3">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="flex-1 h-1.5 accent-indigo-500 bg-zinc-800 rounded-full appearance-none cursor-pointer"
        />
        <span className="text-[10px] text-indigo-400 font-mono w-12 text-right flex-shrink-0 font-bold bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
          {safeNum(value) % 1 === 0 ? safeNum(value) : safeFixed(value, 2)}{unit ?? ''}
        </span>
      </div>
    ) : (
      <div className="flex-1 relative group">
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
          className="w-full px-3 py-2 bg-zinc-900/50 border border-white/5 rounded-lg text-[11px] text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-800 transition-all shadow-inner"
        />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-zinc-600 group-focus-within:text-indigo-500">{unit}</span>}
      </div>
    )}
  </div>
);

const XYZRow: React.FC<{
  label: string;
  values: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  min?: number;
  lockable?: boolean;
}> = ({ label, values, onChange, step = 0.01, min, lockable = label.toLowerCase().includes('escala') || label.toLowerCase().includes('scale') }) => {
  const [locked, setLocked] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600">{label}</span>
        {lockable && (
          <button
            type="button"
            onClick={() => setLocked(!locked)}
            className={`flex items-center gap-1 text-[8.5px] px-1.5 py-0.5 rounded transition-all cursor-pointer ${
              locked ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={locked ? 'Desbloquear ejes para escalar por separado' : 'Bloquear ejes para escalar conjuntamente'}
          >
            {locked ? <Lock size={10} /> : <Unlock size={10} />}
            <span>{locked ? 'Vinculado' : 'Libre'}</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} className="relative group">
            <div className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-1 h-3 rounded-full ${i===0?'bg-rose-500':i===1?'bg-emerald-500':'bg-sky-500'} opacity-50 group-focus-within:opacity-100 transition-opacity`}/>
            <input
              type="number" value={values[i]} step={step} min={min}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  if (locked) {
                    const ratio = values[i] !== 0 ? v / values[i] : 1;
                    const next: [number, number, number] = [
                      i === 0 ? v : values[0] * ratio,
                      i === 1 ? v : values[1] * ratio,
                      i === 2 ? v : values[2] * ratio
                    ];
                    onChange(next);
                  } else {
                    const next = [...values] as [number, number, number];
                    next[i] = v;
                    onChange(next);
                  }
                }
              }}
              className="w-full pl-5 pr-2 py-2 bg-zinc-900/50 border border-white/5 rounded-lg text-[10px] text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-800 transition-all shadow-inner min-w-0"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const RotationXYZRow: React.FC<{
  label: string;
  values: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}> = ({ label, values, onChange }) => {
  const degrees = (values || [0, 0, 0]).map(r => safeParseFixed((safeNum(r) * 180) / Math.PI, 1)) as [number, number, number];

  const handleDegChange = (axisIdx: number, degVal: number) => {
    const nextRads = [...values] as [number, number, number];
    nextRads[axisIdx] = (degVal * Math.PI) / 180;
    onChange(nextRads);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600">{label} (grados °)</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <div key={axis} className="relative group">
            <div className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-1 h-3 rounded-full ${i===0?'bg-rose-500':i===1?'bg-emerald-500':'bg-sky-500'} opacity-50 group-focus-within:opacity-100 transition-opacity`}/>
            <input
              type="number"
              value={degrees[i]}
              step={1}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  handleDegChange(i, v);
                }
              }}
              className="w-full pl-5 pr-3 py-2 bg-zinc-900/50 border border-white/5 rounded-lg text-[10px] text-zinc-200 font-mono focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-800 transition-all shadow-inner min-w-0"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-zinc-500 font-mono">°</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── NURBS Section ────────────────────────────────────────────────────────────

const NurbsSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const isNurbs = obj.isNurbs || !!obj.nurbsCurve || !!obj.nurbsSurface || obj.type.startsWith('NURBS_');
  if (!isNurbs) return null;

  const editMode = useStore(s => s.editMode);
  const setEditMode = useStore(s => s.setEditMode);
  const selectNurbsControlPoint = useStore(s => s.selectNurbsControlPoint);
  const updateNurbsControlPoint = useStore(s => s.updateNurbsControlPoint);
  const setNurbsControlPointWeight = useStore(s => s.setNurbsControlPointWeight);
  const updateNurbsControlPointAttributes = useStore(s => (s as any).updateNurbsControlPointAttributes);
  const subdivideNurbsObject = useStore(s => s.subdivideNurbsObject);
  const extrudeNurbsObject = useStore(s => s.extrudeNurbsObject);
  const revolveNurbsObject = useStore(s => s.revolveNurbsObject);
  const loftNurbsObjects = useStore(s => s.loftNurbsObjects);
  const fillNurbsObject = useStore(s => s.fillNurbsObject);
  const switchNurbsDirectionObject = useStore(s => s.switchNurbsDirectionObject);
  const convertNurbsToMesh = useStore(s => s.convertNurbsToMesh);
  const setNurbsDegree = useStore(s => s.setNurbsDegree);
  const setNurbsResolution = useStore(s => s.setNurbsResolution);
  const setNurbsOrderAction = useStore(s => (s as any).setNurbsOrderAction);
  const toggleNurbsEndpointAction = useStore(s => (s as any).toggleNurbsEndpointAction);
  const toggleNurbsCyclicAction = useStore(s => (s as any).toggleNurbsCyclicAction);
  const setNurbsKnotTypeAction = useStore(s => (s as any).setNurbsKnotTypeAction);
  const smoothNurbsObject = useStore(s => (s as any).smoothNurbsObject);
  const resetNurbsWeightsObject = useStore(s => (s as any).resetNurbsWeightsObject);
  const resetNurbsTiltsAndRadiiObject = useStore(s => (s as any).resetNurbsTiltsAndRadiiObject);
  const alignNurbsSurfaces = useStore(s => s.alignNurbsSurfaces);
  const mergeNurbsSurfaces = useStore(s => s.mergeNurbsSurfaces);
  const project = useStore(s => s.project);

  const isSurface = !!obj.nurbsSurface;
  const isCurve = !!obj.nurbsCurve;

  const curveData = obj.nurbsCurve;
  const surfaceData = obj.nurbsSurface;

  // Selected control point
  const selCp = obj.selectedNurbsControlPoint || { u: 0, v: 0 };
  const uSel = selCp.u ?? 0;
  const vSel = selCp.v ?? 0;

  // Active control point data
  const currentCP = isSurface && surfaceData
    ? surfaceData.controlPoints[uSel]?.[vSel]
    : isCurve && curveData
      ? curveData.controlPoints[uSel]
      : null;

  // Other curve objects in project for lofting
  const otherCurves = project.objects.filter(o => o.id !== obj.id && (o.nurbsCurve || o.type === 'NURBS_CURVE' || o.type === 'NURBS_CIRCLE'));
  // Other surface objects in project for align/merge
  const otherSurfaces = project.objects.filter(o => o.id !== obj.id && !!o.nurbsSurface);

  return (
    <Section
      title="Estructura NURBS (Blender)"
      icon={<Waves size={12} className="text-cyan-400" />}
      badge={
        <span className="text-[8px] bg-cyan-950/80 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-800/60 font-bold uppercase tracking-wider">
          {isSurface ? 'Superficie' : 'Curva'}
        </span>
      }
    >
      <div className="space-y-3">
        {/* Modo Edición toggle (Tab) */}
        <div className="bg-zinc-800/80 border border-zinc-700/60 rounded-lg p-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${editMode === 'VERTEX' ? 'bg-amber-400 animate-pulse' : 'bg-zinc-500'}`} />
            <div>
              <span className="text-[10px] font-bold text-zinc-200">Jaula de Control (Hull)</span>
              <p className="text-[8px] text-zinc-400">Presiona <kbd className="px-1 py-0.5 bg-zinc-700 rounded text-[8px] font-mono text-zinc-200">Tab</kbd> para alternar</p>
            </div>
          </div>
          <button
            onClick={() => setEditMode(editMode === 'VERTEX' ? 'OBJECT' : 'VERTEX')}
            className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase transition-all ${
              editMode === 'VERTEX'
                ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-md shadow-amber-500/20'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {editMode === 'VERTEX' ? 'Modo Edición ON' : 'Editar Puntos'}
          </button>
        </div>

        {/* ─── ESTRUCTURA DEL VECTOR DE NUDOS (KNOTS & ENDPOINTS) ─── */}
        <div className="space-y-2 bg-zinc-900/60 rounded-lg p-2.5 border border-zinc-800">
          <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider block flex items-center justify-between">
            <span>Estructura de Nudos (Knot Vector)</span>
            <span className="text-[8px] text-zinc-500 lowercase font-normal">Blender Manual</span>
          </span>

          {isCurve && curveData && (
            <div className="space-y-2 text-xs">
              {/* Tipo de Nudo */}
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 text-[10px]">Tipo de Nudo</span>
                <select
                  value={curveData.knotsType || 'ENDPOINT'}
                  onChange={e => setNurbsKnotTypeAction(obj.id, e.target.value as any, 'U')}
                  className="bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-100 rounded px-2 py-0.5 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ENDPOINT">Endpoint (Extremos Sujetos)</option>
                  <option value="UNIFORM">Uniform (B-Spline Libre)</option>
                  <option value="BEZIER">Bézier (Tramos Cúbicos)</option>
                </select>
              </div>

              {/* Switches Endpoint & Cyclic */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={curveData.endpoint !== false}
                    onChange={() => toggleNurbsEndpointAction(obj.id, 'U')}
                    className="accent-cyan-500 w-3 h-3 rounded"
                  />
                  <span>Endpoint Clamping</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={!!curveData.closed}
                    onChange={() => toggleNurbsCyclicAction(obj.id, 'U')}
                    className="accent-cyan-500 w-3 h-3 rounded"
                  />
                  <span>Cíclico (Cyclic U)</span>
                </label>
              </div>

              {/* Orden (Order = Degree + 1) */}
              <NumRow
                label="Orden (Order = p + 1)"
                value={curveData.degree + 1}
                onChange={v => setNurbsOrderAction(obj.id, Math.round(v))}
                min={2}
                max={Math.min(6, curveData.controlPoints.length)}
                step={1}
                slider
              />
              <p className="text-[8px] text-zinc-500 italic">Grado polinómico: p = {curveData.degree}</p>
            </div>
          )}

          {isSurface && surfaceData && (
            <div className="space-y-2.5 text-xs">
              {/* Dirección U */}
              <div className="p-1.5 bg-zinc-950/40 rounded border border-zinc-800/80 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-300">
                  <span>Dirección U</span>
                  <select
                    value={surfaceData.knotsTypeU || 'ENDPOINT'}
                    onChange={e => setNurbsKnotTypeAction(obj.id, e.target.value as any, 'U')}
                    className="bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-100 rounded px-1.5 py-0.5"
                  >
                    <option value="ENDPOINT">Endpoint</option>
                    <option value="UNIFORM">Uniform</option>
                    <option value="BEZIER">Bézier</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-zinc-300 select-none">
                    <input
                      type="checkbox"
                      checked={surfaceData.endpointU !== false}
                      onChange={() => toggleNurbsEndpointAction(obj.id, 'U')}
                      className="accent-cyan-500 w-3 h-3 rounded"
                    />
                    <span>Endpoint U</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-zinc-300 select-none">
                    <input
                      type="checkbox"
                      checked={!!surfaceData.closedU}
                      onChange={() => toggleNurbsCyclicAction(obj.id, 'U')}
                      className="accent-cyan-500 w-3 h-3 rounded"
                    />
                    <span>Cíclico U</span>
                  </label>
                </div>
                <NumRow
                  label="Orden U"
                  value={surfaceData.degreeU + 1}
                  onChange={v => setNurbsOrderAction(obj.id, Math.round(v), surfaceData.degreeV + 1)}
                  min={2}
                  max={Math.min(6, surfaceData.controlPoints.length)}
                  step={1}
                  slider
                />
              </div>

              {/* Dirección V */}
              <div className="p-1.5 bg-zinc-950/40 rounded border border-zinc-800/80 space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-300">
                  <span>Dirección V</span>
                  <select
                    value={surfaceData.knotsTypeV || 'ENDPOINT'}
                    onChange={e => setNurbsKnotTypeAction(obj.id, e.target.value as any, 'V')}
                    className="bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-100 rounded px-1.5 py-0.5"
                  >
                    <option value="ENDPOINT">Endpoint</option>
                    <option value="UNIFORM">Uniform</option>
                    <option value="BEZIER">Bézier</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-zinc-300 select-none">
                    <input
                      type="checkbox"
                      checked={surfaceData.endpointV !== false}
                      onChange={() => toggleNurbsEndpointAction(obj.id, 'V')}
                      className="accent-cyan-500 w-3 h-3 rounded"
                    />
                    <span>Endpoint V</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-zinc-300 select-none">
                    <input
                      type="checkbox"
                      checked={!!surfaceData.closedV}
                      onChange={() => toggleNurbsCyclicAction(obj.id, 'V')}
                      className="accent-cyan-500 w-3 h-3 rounded"
                    />
                    <span>Cíclico V</span>
                  </label>
                </div>
                <NumRow
                  label="Orden V"
                  value={surfaceData.degreeV + 1}
                  onChange={v => setNurbsOrderAction(obj.id, surfaceData.degreeU + 1, Math.round(v))}
                  min={2}
                  max={Math.min(6, (surfaceData.controlPoints[0]?.length || 4))}
                  step={1}
                  slider
                />
              </div>
            </div>
          )}
        </div>

        {/* Resolución de Muestreo / Teselado */}
        <div className="space-y-1.5 bg-zinc-800/40 rounded-lg p-2 border border-zinc-700/40">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Resolución / Densidad de Muestreo</span>
          {isCurve && (
            <NumRow
              label="Resolución (Segmentos)"
              value={obj.parameters.segments ?? 32}
              onChange={v => setNurbsResolution(obj.id, Math.round(v))}
              min={8}
              max={128}
              step={4}
              slider
            />
          )}
          {isSurface && surfaceData && (
            <>
              <NumRow
                label="Resolución U"
                value={surfaceData.resolutionU}
                onChange={v => setNurbsResolution(obj.id, Math.round(v), surfaceData.resolutionV)}
                min={4}
                max={64}
                step={2}
                slider
              />
              <NumRow
                label="Resolución V"
                value={surfaceData.resolutionV}
                onChange={v => setNurbsResolution(obj.id, surfaceData.resolutionU, Math.round(v))}
                min={4}
                max={64}
                step={2}
                slider
              />
            </>
          )}
        </div>

        {/* ─── PUNTO DE CONTROL ACTIVO Y SUS ATRIBUTOS DE ESTRUCTURA ─── */}
        <div className="space-y-2 bg-cyan-950/20 border border-cyan-800/30 rounded-lg p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-cyan-300 flex items-center gap-1">
              <Orbit size={11} />
              Punto de Control Activo
            </span>
            <span className="text-[9px] text-cyan-400 font-mono">
              {isSurface
                ? `[${uSel}, ${vSel}] de ${surfaceData?.controlPoints.length}×${surfaceData?.controlPoints[0]?.length}`
                : `[${uSel}] de ${curveData?.controlPoints.length}`}
            </span>
          </div>

          {/* Point Grid / List Selector */}
          {isSurface && surfaceData && (
            <div className="max-h-24 overflow-y-auto p-1 bg-zinc-900/60 rounded border border-zinc-800 custom-scrollbar">
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${surfaceData.controlPoints[0]?.length || 4}, minmax(0, 1fr))` }}>
                {surfaceData.controlPoints.map((row, rIdx) =>
                  row.map((cp, cIdx) => {
                    const isSelected = uSel === rIdx && vSel === cIdx;
                    return (
                      <button
                        key={`${rIdx}-${cIdx}`}
                        onClick={() => selectNurbsControlPoint(obj.id, rIdx, cIdx)}
                        className={`h-6 text-[8px] font-mono font-bold rounded transition-all flex items-center justify-center ${
                          isSelected
                            ? 'bg-amber-500 text-zinc-950 ring-2 ring-amber-300'
                            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                        }`}
                        title={`Punto [${rIdx},${cIdx}] (x:${safeFixed(cp?.point?.[0], 1)}, y:${safeFixed(cp?.point?.[1], 1)}, z:${safeFixed(cp?.point?.[2], 1)}, w:${safeFixed(cp?.weight, 2)})`}
                      >
                        {rIdx},{cIdx}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {isCurve && curveData && (
            <div className="flex gap-1 overflow-x-auto p-1 bg-zinc-900/60 rounded border border-zinc-800 custom-scrollbar">
              {curveData.controlPoints.map((cp, idx) => {
                const isSelected = uSel === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => selectNurbsControlPoint(obj.id, idx)}
                    className={`px-2 py-1 text-[9px] font-mono font-bold rounded shrink-0 transition-all ${
                      isSelected
                        ? 'bg-amber-500 text-zinc-950 ring-2 ring-amber-300'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    P{idx} (w:{safeFixed(cp?.weight, 1)})
                  </button>
                );
              })}
            </div>
          )}

          {/* Coordinate & Structural Attributes Editing for current CP */}
          {currentCP && (
            <div className="space-y-2 pt-1">
              <XYZRow
                label="Posición CP"
                values={currentCP.point}
                onChange={newPt => updateNurbsControlPointAttributes(obj.id, uSel, vSel, { point: newPt })}
                step={0.05}
              />

              {/* Peso Racional (Weight) */}
              <NumRow
                label="Peso Racional (Weight w)"
                value={currentCP.weight}
                onChange={w => updateNurbsControlPointAttributes(obj.id, uSel, vSel, { weight: w })}
                min={0.01}
                max={10.0}
                step={0.05}
                slider
              />
              <div className="flex gap-1">
                {[
                  { label: 'w=1 (Normal)', val: 1.0 },
                  { label: 'w=0.71 (Círculo)', val: 0.7071 },
                  { label: 'w=2.0 (Fuerte)', val: 2.0 },
                  { label: 'w=0.3 (Débil)', val: 0.3 },
                ].map(pre => (
                  <button
                    key={pre.label}
                    onClick={() => updateNurbsControlPointAttributes(obj.id, uSel, vSel, { weight: pre.val })}
                    className={`flex-1 py-0.5 text-[8px] font-mono rounded bg-zinc-800 hover:bg-cyan-700 hover:text-white transition-colors ${
                      Math.abs(currentCP.weight - pre.val) < 0.05 ? 'border border-cyan-400 text-cyan-300' : 'text-zinc-400'
                    }`}
                  >
                    {pre.label}
                  </button>
                ))}
              </div>

              {/* Radio Local (Radius Alt+S) & Inclinación (Tilt Ctrl+T) */}
              <div className="pt-1 grid grid-cols-2 gap-2">
                <NumRow
                  label="Radio (Alt+S)"
                  value={currentCP.radius ?? 1.0}
                  onChange={r => updateNurbsControlPointAttributes(obj.id, uSel, vSel, { radius: r })}
                  min={0.05}
                  max={10.0}
                  step={0.05}
                  slider
                />
                <NumRow
                  label="Inclinación / Tilt (°)"
                  value={currentCP.tilt ?? 0}
                  onChange={t => updateNurbsControlPointAttributes(obj.id, uSel, vSel, { tilt: t })}
                  min={-180}
                  max={180}
                  step={5}
                  slider
                />
              </div>
            </div>
          )}
        </div>

        {/* ─── BARRA DE HERRAMIENTAS Y OPERADORES DE ESTRUCTURA ─── */}
        <div className="space-y-2">
          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Operadores de Estructura (Blender)</span>

          {/* Quick Structure Cleansers & Smoothers */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => smoothNurbsObject(obj.id)}
              className="py-1 px-1.5 bg-zinc-800/90 hover:bg-cyan-600 rounded text-[9px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1 border border-zinc-700/60 transition-all"
              title="Suavizar puntos de control usando relajación laplaciana (Laplacian Smoothing)"
            >
              <Sparkles size={11} />
              Suavizar
            </button>
            <button
              onClick={() => resetNurbsWeightsObject(obj.id)}
              className="py-1 px-1.5 bg-zinc-800/90 hover:bg-cyan-600 rounded text-[9px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1 border border-zinc-700/60 transition-all"
              title="Restablece todos los pesos racionales a 1.0 (Uniform B-Spline)"
            >
              <RotateCcw size={11} />
              Reset Pesos
            </button>
            <button
              onClick={() => resetNurbsTiltsAndRadiiObject(obj.id)}
              className="py-1 px-1.5 bg-zinc-800/90 hover:bg-cyan-600 rounded text-[9px] font-semibold text-zinc-300 hover:text-white flex items-center justify-center gap-1 border border-zinc-700/60 transition-all"
              title="Restablece radio a 1.0 e inclinación (tilt) a 0°"
            >
              <RefreshCw size={11} />
              Reset Tilt
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* Subdividir */}
            <button
              onClick={() => subdivideNurbsObject(obj.id, 'BOTH')}
              className="py-1.5 px-2 bg-zinc-800 hover:bg-cyan-600 rounded text-[10px] font-bold text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 border border-zinc-700/60 hover:border-cyan-400 transition-all cursor-pointer"
              title="Añade nuevos puntos de control intermedios refinando la curvatura matemática"
            >
              <GitMerge size={12} />
              Subdividir
            </button>

            {/* Extruir */}
            <button
              onClick={() => extrudeNurbsObject(obj.id, [0, 0.6, 0])}
              className="py-1.5 px-2 bg-zinc-800 hover:bg-cyan-600 rounded text-[10px] font-bold text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 border border-zinc-700/60 hover:border-cyan-400 transition-all cursor-pointer"
              title="Extruye la curva hacia una superficie 3D o expande la fila de control"
            >
              <ArrowUpFromLine size={12} />
              Extruir [E]
            </button>

            {/* Revolución (Revolve) para Curvas */}
            {isCurve && (
              <button
                onClick={() => revolveNurbsObject(obj.id, 360, 'y')}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-cyan-600 rounded text-[10px] font-bold text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 border border-zinc-700/60 hover:border-cyan-400 transition-all cursor-pointer"
                title="Genera una superficie 3D de revolución 360° alrededor del eje vertical"
              >
                <RotateCw size={12} />
                Revolución 360°
              </button>
            )}

            {/* Cerrar / Rellenar (Fill) */}
            <button
              onClick={() => fillNurbsObject(obj.id)}
              className="py-1.5 px-2 bg-zinc-800 hover:bg-cyan-600 rounded text-[10px] font-bold text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 border border-zinc-700/60 hover:border-cyan-400 transition-all cursor-pointer"
              title="Alterna entre curva/superficie abierta y cerrada (Fill / Cyclic)"
            >
              <Target size={12} />
              Rellenar / Cerrar [F]
            </button>

            {/* Invertir Dirección */}
            <button
              onClick={() => switchNurbsDirectionObject(obj.id, 'U')}
              className="py-1.5 px-2 bg-zinc-800 hover:bg-cyan-600 rounded text-[10px] font-bold text-zinc-200 hover:text-white flex items-center justify-center gap-1.5 border border-zinc-700/60 hover:border-cyan-400 transition-all cursor-pointer"
              title="Invierte la dirección matemática del spline (Switch Direction)"
            >
              <ArrowRightLeft size={12} />
              Invertir Dirección
            </button>

            {/* Loft con otras curvas */}
            {isCurve && otherCurves.length > 0 && (
              <button
                onClick={() => loftNurbsObjects([obj.id, ...otherCurves.map(c => c.id)])}
                className="py-1.5 px-2 bg-cyan-900/60 hover:bg-cyan-600 text-cyan-200 hover:text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 border border-cyan-700/60 transition-all cursor-pointer"
                title="Crea una superficie uniendo todas las curvas NURBS del escenario"
              >
                <Spline size={12} />
                Loft ({otherCurves.length + 1} curvas)
              </button>
            )}

            {/* Alineación G0 con otra superficie */}
            {isSurface && otherSurfaces.length > 0 && (
              <button
                onClick={() => alignNurbsSurfaces(obj.id, otherSurfaces[0].id, 'END', 'START')}
                className="py-1.5 px-2 bg-indigo-900/60 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 border border-indigo-700/60 transition-all cursor-pointer"
                title={`Alinear borde G0 con '${otherSurfaces[0].name}'`}
              >
                <Target size={12} />
                Alinear G0 ({otherSurfaces[0].name.slice(0, 10)})
              </button>
            )}

            {/* Fusión (Merge) con otra superficie */}
            {isSurface && otherSurfaces.length > 0 && (
              <button
                onClick={() => mergeNurbsSurfaces(obj.id, otherSurfaces[0].id)}
                className="py-1.5 px-2 bg-emerald-900/60 hover:bg-emerald-600 text-emerald-200 hover:text-white rounded text-[10px] font-bold flex items-center justify-center gap-1.5 border border-emerald-700/60 transition-all cursor-pointer"
                title={`Fusionar matemáticamente en una sola superficie con '${otherSurfaces[0].name}'`}
              >
                <GitMerge size={12} />
                Fusionar ({otherSurfaces[0].name.slice(0, 10)})
              </button>
            )}
          </div>

          {/* Convertir a Malla (Convert to Mesh) */}
          <button
            onClick={() => convertNurbsToMesh(obj.id)}
            className="w-full mt-2 py-2 px-3 bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/50 text-amber-300 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            title="Convierte la geometría NURBS en una malla poligonal tradicional para esculpir, aplicar modificadores (Biselado, Twist, Bend) o CSG"
          >
            <FileDigit size={13} />
            Convertir a Malla Poligonal (Convert to Mesh)
          </button>
        </div>
      </div>
    </Section>
  );
};

// ─── Sub-element editing section (Faces, Edges, Vertices) ─────────────────────

const SubElementEditSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const {
    editMode,
    setEditMode,
    selectedFaceIndices,
    selectedEdgeIndices,
    selectedVertexIndices,
    extrudeFaces,
    insetFaces,
    subdivideFaces,
    mergeFaces,
    flipSelectedFaceNormals,
    capSelectedFacesObject,
    deleteSelectedFaces,
    bevelSelectedEdges,
    subdivideSelectedEdges,
    bridgeSelectedEdges,
    dissolveSelectedEdges,
    deleteSelectedEdges,
    weldSelectedVertices,
    deleteSelectedVertices,
    connectVertices,
    createFaceFromVertices,
    extrudeSelectedVertices,
  } = useStore();

  const [extrudeAmount, setExtrudeAmount] = useState(0.3);
  const [insetAmount, setInsetAmount] = useState(0.2);
  const [bevelRadius, setBevelRadius] = useState(0.08);
  const [bevelSegs, setBevelSegs] = useState(3);

  const numEdges = Math.floor(selectedEdgeIndices.length / 2);

  return (
    <Section
      title={`Herramientas de Sub-elementos (${editMode === 'FACE' ? 'Caras' : editMode === 'EDGE' ? 'Bordes' : editMode === 'VERTEX' ? 'Vértices' : 'Objeto'})`}
      icon={<Scissors size={12} />}
    >
      <div className="space-y-3">
        {/* Selector de modo rápido */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-900/90 rounded-lg border border-white/5 text-[10px]">
          <button
            type="button"
            onClick={() => setEditMode('OBJECT')}
            className={`py-1.5 rounded font-semibold text-center transition-all ${
              editMode === 'OBJECT' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Modo Objeto (1 o Esc)"
          >
            Objeto (1)
          </button>
          <button
            type="button"
            onClick={() => setEditMode('FACE')}
            className={`py-1.5 rounded font-semibold text-center transition-all ${
              editMode === 'FACE' ? 'bg-amber-600 text-white shadow' : 'text-zinc-400 hover:text-amber-300'
            }`}
            title="Modo Caras (2)"
          >
            Caras (2)
          </button>
          <button
            type="button"
            onClick={() => setEditMode('EDGE')}
            className={`py-1.5 rounded font-semibold text-center transition-all ${
              editMode === 'EDGE' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-indigo-300'
            }`}
            title="Modo Bordes (3)"
          >
            Bordes (3)
          </button>
          <button
            type="button"
            onClick={() => setEditMode('VERTEX')}
            className={`py-1.5 rounded font-semibold text-center transition-all ${
              editMode === 'VERTEX' ? 'bg-violet-600 text-white shadow' : 'text-zinc-400 hover:text-violet-300'
            }`}
            title="Modo Vértices (4)"
          >
            Vértices (4)
          </button>
        </div>

        {/* ── SECCIÓN MODO CARAS ── */}
        {editMode === 'FACE' && (
          <div className="space-y-2.5 p-2.5 bg-amber-950/20 border border-amber-500/20 rounded-xl">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-amber-300 flex items-center gap-1.5">
                <Layers size={13} className="text-amber-400" />
                <span>Caras Seleccionadas</span>
              </span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-amber-900/40 text-amber-200 border border-amber-600/30">
                {selectedFaceIndices.length} / {obj.faces?.length || 0}
              </span>
            </div>

            {/* Extrusión */}
            <div className="space-y-1.5 pt-1 border-t border-amber-500/10">
              <NumRow
                label="Distancia Extruir"
                value={extrudeAmount}
                onChange={v => setExtrudeAmount(v)}
                min={-5}
                max={10}
                step={0.05}
                slider
              />
              <button
                type="button"
                onClick={() => {
                  if (selectedFaceIndices.length === 0) {
                    alert('Selecciona una o más caras para extruir.');
                    return;
                  }
                  extrudeFaces(obj.id, selectedFaceIndices, extrudeAmount);
                }}
                disabled={selectedFaceIndices.length === 0}
                className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer"
              >
                <span>🚀 Extruir Caras (E / Ctrl+E)</span>
              </button>
            </div>

            {/* Inset */}
            <div className="space-y-1.5 pt-1 border-t border-amber-500/10">
              <NumRow
                label="Factor Inset"
                value={insetAmount}
                onChange={v => setInsetAmount(v)}
                min={0.01}
                max={0.9}
                step={0.02}
                slider
              />
              <button
                type="button"
                onClick={() => {
                  if (selectedFaceIndices.length === 0) {
                    alert('Selecciona una o más caras para hacer Inset.');
                    return;
                  }
                  const res = insetFaces(obj.id, selectedFaceIndices, insetAmount);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedFaceIndices.length === 0}
                className="w-full py-1.5 bg-zinc-800 hover:bg-amber-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-amber-200 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all border border-amber-600/30 cursor-pointer"
              >
                <span>🔲 Inset / Contorno Interior (I)</span>
              </button>
            </div>

            {/* Operaciones de Caras secundarias */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-amber-500/10">
              <button
                type="button"
                onClick={() => {
                  if (selectedFaceIndices.length === 0) {
                    alert('Selecciona caras para subdividir.');
                    return;
                  }
                  subdivideFaces(obj.id, selectedFaceIndices);
                }}
                disabled={selectedFaceIndices.length === 0}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Subdivide las caras en quads menores"
              >
                ✂️ Subdividir (D)
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedFaceIndices.length < 2) {
                    alert('Selecciona al menos 2 caras para fusionar.');
                    return;
                  }
                  mergeFaces(obj.id, selectedFaceIndices);
                }}
                disabled={selectedFaceIndices.length < 2}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-indigo-600 disabled:opacity-50 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Fusiona caras contiguas coplanares"
              >
                🔗 Fusionar (M)
              </button>

              <button
                type="button"
                onClick={() => {
                  if (selectedFaceIndices.length === 0) {
                    alert('Selecciona caras para invertir sus normales.');
                    return;
                  }
                  const res = flipSelectedFaceNormals(obj.id, selectedFaceIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedFaceIndices.length === 0}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Invertir orientación y normales de la cara"
              >
                🔄 Invertir Normales
              </button>

              <button
                type="button"
                onClick={async () => {
                  await capSelectedFacesObject(obj.id);
                }}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-emerald-700 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Tapar hueco en la selección"
              >
                🛡️ Tapar Hueco (F)
              </button>
            </div>

            {/* Eliminar Caras */}
            <button
              type="button"
              onClick={() => {
                const res = deleteSelectedFaces(obj.id, selectedFaceIndices);
                if (!res.success) alert(res.message);
              }}
              disabled={selectedFaceIndices.length === 0}
              className="w-full py-1.5 bg-rose-950/80 hover:bg-rose-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-rose-200 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 border border-rose-800/60 transition-all cursor-pointer"
            >
              <Trash2 size={12} />
              <span>Eliminar Caras (Supr)</span>
            </button>
          </div>
        )}

        {/* ── SECCIÓN MODO BORDES ── */}
        {editMode === 'EDGE' && (
          <div className="space-y-2.5 p-2.5 bg-indigo-950/20 border border-indigo-500/20 rounded-xl">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <span className="w-2 h-0.5 bg-indigo-400 rounded-full"></span>
                <span>Bordes Seleccionados</span>
              </span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-200 border border-indigo-600/30">
                {numEdges} borde(s)
              </span>
            </div>

            {/* Biselar / Bevel */}
            <div className="space-y-1.5 pt-1 border-t border-indigo-500/10">
              <NumRow
                label="Radio Bisel"
                value={bevelRadius}
                onChange={v => setBevelRadius(v)}
                min={0.01}
                max={2}
                step={0.02}
                slider
              />
              <NumRow
                label="Segmentos Bisel"
                value={bevelSegs}
                onChange={v => setBevelSegs(Math.max(1, Math.round(v)))}
                min={1}
                max={16}
                step={1}
                slider
              />
              <button
                type="button"
                onClick={() => {
                  const res = bevelSelectedEdges(obj.id, selectedEdgeIndices, bevelRadius, bevelSegs);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedEdgeIndices.length < 2 && (!obj.edges || obj.edges.length === 0)}
                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer"
              >
                <Sparkles size={12} />
                <span>Biselar / Redondear Bordes (B)</span>
              </button>
            </div>

            {/* Operaciones de Bordes */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-indigo-500/10">
              <button
                type="button"
                onClick={() => {
                  const res = subdivideSelectedEdges(obj.id, selectedEdgeIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedEdgeIndices.length < 2}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Inserta un vértice en el centro de cada arista seleccionada"
              >
                ✂️ Dividir Arista (D)
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = bridgeSelectedEdges(obj.id, selectedEdgeIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={numEdges < 2}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-emerald-700 disabled:opacity-50 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Crea una cara conectando 2 aristas seleccionadas"
              >
                🌉 Puente / Cara (F)
              </button>

              <button
                type="button"
                onClick={async () => {
                  const res = await dissolveSelectedEdges(obj.id, selectedEdgeIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedEdgeIndices.length < 2}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-violet-700 disabled:opacity-50 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Disuelve la arista fusionando las dos caras adyacentes"
              >
                ↩️ Disolver (X)
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = deleteSelectedEdges(obj.id, selectedEdgeIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedEdgeIndices.length < 2}
                className="py-1.5 px-2 bg-rose-950/70 hover:bg-rose-600 disabled:opacity-50 text-rose-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-rose-800/50 transition-all cursor-pointer"
                title="Elimina las aristas seleccionadas y sus caras"
              >
                <Trash2 size={11} />
                <span>Eliminar (Supr)</span>
              </button>
            </div>
          </div>
        )}

        {/* ── SECCIÓN MODO VÉRTICES ── */}
        {editMode === 'VERTEX' && (
          <div className="space-y-2.5 p-2.5 bg-violet-950/20 border border-violet-500/20 rounded-xl">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-violet-300 flex items-center gap-1.5">
                <Box size={13} className="text-violet-400" />
                <span>Vértices Seleccionados</span>
              </span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-violet-900/40 text-violet-200 border border-violet-600/30">
                {selectedVertexIndices.length} / {obj.vertices?.length || 0}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-violet-500/10">
              <button
                type="button"
                onClick={() => {
                  const res = connectVertices(obj.id, selectedVertexIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedVertexIndices.length < 2}
                className="py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer col-span-2"
                title="Conecta 2 vértices seleccionados creando una línea o dividiendo la cara (J)"
              >
                ✂️ Conectar Línea (J)
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = createFaceFromVertices(obj.id, selectedVertexIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedVertexIndices.length < 3}
                className="py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
                title="Crear cara poligonal a partir de 3 o más vértices (F)"
              >
                🔲 Rellenar Cara (F)
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = extrudeSelectedVertices(obj.id, selectedVertexIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedVertexIndices.length === 0}
                className="py-1.5 px-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all cursor-pointer"
                title="Extruir vértice(s) creando nuevo segmento (E)"
              >
                🚀 Extruir (E)
              </button>

              <button
                type="button"
                onClick={async () => {
                  const res = await weldSelectedVertices(obj.id, selectedVertexIndices);
                  alert(res.message);
                }}
                className="py-1.5 px-2 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-zinc-700 transition-all cursor-pointer"
                title="Soldar / Unir vértices seleccionados o cercanos (W)"
              >
                🔗 Soldar (W)
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = deleteSelectedVertices(obj.id, selectedVertexIndices);
                  if (!res.success) alert(res.message);
                }}
                disabled={selectedVertexIndices.length === 0}
                className="py-1.5 px-2 bg-rose-950/70 hover:bg-rose-600 disabled:opacity-50 text-rose-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 border border-rose-800/50 transition-all cursor-pointer"
                title="Eliminar vértices seleccionados (Supr)"
              >
                <Trash2 size={11} />
                <span>Eliminar (Supr)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
};

// ─── Secciones específicas ───────────────────────────────────────────────────

const ParametersSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const updateParameters = useStore(s => s.updateParameters);
  const up = useCallback(
    (params: Partial<CSGObject['parameters']>) => updateParameters(obj.id, params),
    [obj.id, updateParameters],
  );

  const p = obj.parameters;

  switch (obj.type) {
    case 'PLANE':
      return (
        <Section title="Parámetros">
          <NumRow label="Subdivisión" value={p.segments ?? 1} onChange={v => up({ segments: Math.max(1, Math.round(v)) })}
            min={1} max={256} step={1} slider/>
        </Section>
      );
    case 'CIRCLE':
      return (
        <Section title="Parámetros">
          <NumRow label="Segmentos" value={p.segments ?? 16} onChange={v => up({ segments: Math.max(3, Math.round(v)) })}
            min={3} max={256} step={1} slider/>
        </Section>
      );
    case 'RING':
      return (
        <Section title="Parámetros">
          <NumRow label="Radio Int." value={p.innerRadius ?? 0.25} onChange={v => up({ innerRadius: v })} min={0.01} step={0.05}/>
          <NumRow label="Radio Ext." value={p.outerRadius ?? 0.5} onChange={v => up({ outerRadius: v })} min={0.01} step={0.05}/>
          <NumRow label="Segmentos" value={p.thetaSegments ?? 16} onChange={v => up({ thetaSegments: Math.max(3, Math.round(v)) })}
            min={3} max={256} step={1} slider/>
        </Section>
      );
    case 'CUBE':
      return (
        <Section title="Parámetros">
          <NumRow label="Subdivisión" value={p.segments ?? 1} onChange={v => up({ segments: Math.max(1, Math.round(v)) })}
            min={1} max={128} step={1} slider/>
        </Section>
      );
    case 'GEOSPHERE':
      return (
        <Section title="Parámetros GeoEsfera (3ds Max)">
          <NumRow label="Radio" value={p.radius ?? 0.5} onChange={v => up({ radius: Math.max(0.01, v) })}
            min={0.01} max={50} step={0.05} slider/>
          <NumRow label="Segmentos (Frecuencia)" value={p.geodesicFrequency ?? 4} onChange={v => up({ geodesicFrequency: Math.max(1, Math.min(16, Math.round(v))) })}
            min={1} max={16} step={1} slider/>
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Tipo Base Geodésica</span>
            <select
              value={p.geodesicBaseType || 'ICOSAHEDRON'}
              onChange={e => up({ geodesicBaseType: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
            >
              <option value="TETRAHEDRON">Tetra (4 caras)</option>
              <option value="OCTAHEDRON">Octa (8 caras)</option>
              <option value="ICOSAHEDRON">Icosa (20 caras)</option>
            </select>
          </div>
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Hemisferio (Cúpula)</span>
            <input
              type="checkbox"
              checked={!!p.geodesicHemisphere}
              onChange={e => up({ geodesicHemisphere: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700 text-indigo-500"
            />
          </div>
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Base a Pivote (Base to Pivot)</span>
            <input
              type="checkbox"
              checked={!!p.baseToPivot}
              onChange={e => up({ baseToPivot: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700 text-indigo-500"
            />
          </div>
        </Section>
      );
    case 'SPHERE':
      return (
        <Section title="Parámetros Esfera (3ds Max)">
          <NumRow label="Radio" value={p.radius ?? 0.5} onChange={v => up({ radius: Math.max(0.01, v) })}
            min={0.01} max={50} step={0.05} slider/>
          <NumRow label="Segmentos (Longitud)" value={p.segments ?? 32} onChange={v => up({ segments: Math.max(3, Math.round(v)) })}
            min={3} max={256} step={1} slider/>
          <NumRow label="Segmentos Altura (Latitud)" value={p.heightSegments ?? 16} onChange={v => up({ heightSegments: Math.max(2, Math.round(v)) })}
            min={2} max={128} step={1} slider/>
          
          {/* Hemisphere */}
          <NumRow label="Hemisferio (0 = Total)" value={p.hemisphere ?? 0.0} onChange={v => up({ hemisphere: Math.max(0, Math.min(1, v)) })}
            min={0.0} max={1.0} step={0.05} slider/>
          {(p.hemisphere ?? 0) > 0 && (
            <div className="flex items-center justify-between text-xs my-1 text-zinc-300 pl-2 border-l-2 border-indigo-500/50">
              <span>Modo Hemisferio</span>
              <div className="flex gap-2 text-[10px]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`chopSquash_${obj.id}`}
                    value="chop"
                    checked={(p.chopSquash || 'chop') === 'chop'}
                    onChange={() => up({ chopSquash: 'chop' })}
                  />
                  Chop (Corte)
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name={`chopSquash_${obj.id}`}
                    value="squash"
                    checked={p.chopSquash === 'squash'}
                    onChange={() => up({ chopSquash: 'squash' })}
                  />
                  Squash (Comprimir)
                </label>
              </div>
            </div>
          )}

          {/* Slice */}
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Rebanar (Slice On)</span>
            <input
              type="checkbox"
              checked={!!p.sliceOn}
              onChange={e => up({ sliceOn: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700 text-indigo-500"
            />
          </div>
          {p.sliceOn && (
            <div className="space-y-1 pl-2 border-l-2 border-indigo-500/50">
              <NumRow label="Rebanar Desde (°)" value={p.sliceFrom ?? 0} onChange={v => up({ sliceFrom: v })}
                min={0} max={360} step={5} slider/>
              <NumRow label="Rebanar Hasta (°)" value={p.sliceTo ?? 360} onChange={v => up({ sliceTo: v })}
                min={0} max={360} step={5} slider/>
            </div>
          )}

          {/* Base to Pivot */}
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Base a Pivote (Base to Pivot)</span>
            <input
              type="checkbox"
              checked={!!p.baseToPivot}
              onChange={e => up({ baseToPivot: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700 text-indigo-500"
            />
          </div>
        </Section>
      );
    case 'CYLINDER':
    case 'CONE':
    case 'PYRAMID':
    case 'PRISM':
      return (
        <Section title="Parámetros">
          <NumRow label="Seg. radiales" value={p.segments ?? 32} onChange={v => up({ segments: Math.max(3, Math.round(v)) })}
            min={3} max={256} step={1} slider/>
          <NumRow label="Seg. altura" value={p.heightSegments ?? 1} onChange={v => up({ heightSegments: Math.max(1, Math.round(v)) })}
            min={1} max={128} step={1} slider/>
        </Section>
      );
    case 'CAPSULE':
    case 'HEMISPHERE':
      return (
        <Section title="Parámetros">
          <NumRow label="Segmentos" value={p.segments ?? 32} onChange={v => up({ segments: Math.max(4, Math.round(v)) })}
            min={4} max={256} step={1} slider/>
        </Section>
      );
    case 'TUBE':
      return (
        <Section title="Parámetros">
          <NumRow label="Radio interior" value={p.innerRadius ?? 0.25} onChange={v => up({ innerRadius: Math.max(0.01, v) })} min={0.01} max={10} step={0.05} slider/>
          <NumRow label="Radio exterior" value={p.outerRadius ?? 0.5} onChange={v => up({ outerRadius: Math.max(0.05, v) })} min={0.05} max={12} step={0.05} slider/>
          <NumRow label="Segmentos" value={p.segments ?? 32} onChange={v => up({ segments: Math.max(3, Math.round(v)) })} min={3} max={256} step={1} slider/>
        </Section>
      );
    case 'ARC':
      return (
        <Section title="Parámetros Arco 3D">
          <NumRow label="Ángulo (°)" value={p.arcAngle ?? 180} onChange={v => up({ arcAngle: Math.max(1, Math.min(360, Math.round(v))) })} min={1} max={360} step={1} slider/>
          <NumRow label="Radio int." value={p.innerRadius ?? 0.25} onChange={v => up({ innerRadius: Math.max(0.01, v) })} min={0.01} max={10} step={0.05} slider/>
          <NumRow label="Radio ext." value={p.outerRadius ?? 0.5} onChange={v => up({ outerRadius: Math.max(0.05, v) })} min={0.05} max={12} step={0.05} slider/>
          <NumRow label="Altura" value={p.height ?? 0.5} onChange={v => up({ height: Math.max(0.05, v) })} min={0.05} max={10} step={0.05} slider/>
          <NumRow label="Segmentos" value={p.segments ?? 32} onChange={v => up({ segments: Math.max(3, Math.round(v)) })} min={3} max={256} step={1} slider/>
        </Section>
      );
    case 'STAR':
      return (
        <Section title="Parámetros Estrella 3D">
          <NumRow label="Puntas" value={p.starPoints ?? p.points ?? 5} onChange={v => up({ starPoints: Math.max(3, Math.round(v)) })} min={3} max={32} step={1} slider/>
          <NumRow label="Radio int." value={p.innerRadius ?? 0.25} onChange={v => up({ innerRadius: Math.max(0.01, v) })} min={0.01} max={10} step={0.05} slider/>
          <NumRow label="Radio ext." value={p.outerRadius ?? 0.5} onChange={v => up({ outerRadius: Math.max(0.05, v) })} min={0.05} max={12} step={0.05} slider/>
          <NumRow label="Altura" value={p.height ?? 0.5} onChange={v => up({ height: Math.max(0.05, v) })} min={0.05} max={10} step={0.05} slider/>
        </Section>
      );
    case 'TORUS':
      return (
        <Section title="Parámetros">
          <NumRow label="Radio" value={p.radius ?? 0.5} onChange={v => up({ radius: v })} min={0.05} step={0.05}/>
          <NumRow label="Tubo" value={p.tube ?? 0.2} onChange={v => up({ tube: v })} min={0.01} step={0.05}/>
          <NumRow label="Seg. radiales" value={p.radialSegments ?? 16} onChange={v => up({ radialSegments: Math.max(3, Math.round(v)) })}
            min={3} max={256} step={1} slider/>
          <NumRow label="Seg. tubulares" value={p.tubularSegments ?? 32} onChange={v => up({ tubularSegments: Math.max(6, Math.round(v)) })}
            min={6} max={512} step={2} slider/>
        </Section>
      );
    case 'ICOSAHEDRON':
    case 'DODECAHEDRON':
    case 'TETRAHEDRON':
    case 'OCTAHEDRON':
      return (
        <Section title="Parámetros">
          <NumRow label="Detalle" value={p.detail ?? 0} onChange={v => up({ detail: Math.max(0, Math.round(v)) })}
            min={0} max={8} step={1} slider/>
        </Section>
      );
    case 'SHAPE': {
      const selectedVertexIndices = useStore.getState().selectedVertexIndices;
      const insertVertexMode = useStore.getState().insertVertexMode;
      const setInsertVertexMode = useStore.getState().setInsertVertexMode;
      const weldSelectedVertices = useStore.getState().weldSelectedVertices;
      const subdivideShapeSegment = useStore.getState().subdivideShapeSegment;
      const deleteSelectedVertices = useStore.getState().deleteSelectedVertices;
      const toggleShapeClosed = useStore.getState().toggleShapeClosed;

      return (
        <>
          <Section title="Herramientas de Vértices">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-900/60 p-2 rounded border border-zinc-800">
                <span>Vértices: <strong className="text-zinc-200">{obj.vertices?.length || 0}</strong></span>
                <span className="text-[10px] text-indigo-400 font-semibold">{selectedVertexIndices.length} seleccionados</span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await weldSelectedVertices(obj.id, selectedVertexIndices);
                    alert(res.message);
                  }}
                  className="px-2 py-1.5 bg-zinc-800 hover:bg-indigo-600 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all border border-zinc-700 hover:border-indigo-500"
                  title="Soldar / Fusionar vértices (W)"
                >
                  🔗 Soldar (W)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const res = subdivideShapeSegment(obj.id);
                    alert(res.message);
                  }}
                  className="px-2 py-1.5 bg-zinc-800 hover:bg-violet-600 text-zinc-200 hover:text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all border border-zinc-700 hover:border-violet-500"
                  title="Dividir segmento por la mitad (D)"
                >
                  ✂️ Dividir (D)
                </button>

                <button
                  type="button"
                  onClick={() => setInsertVertexMode(!insertVertexMode)}
                  className={`px-2 py-1.5 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all border ${
                    insertVertexMode
                      ? 'bg-amber-600 text-white border-amber-400'
                      : 'bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700'
                  }`}
                  title="Insertar vértice haciendo clic en la línea (I)"
                >
                  ➕ Insertar (I)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const res = deleteSelectedVertices(obj.id, selectedVertexIndices);
                    if (!res.success) alert(res.message);
                  }}
                  disabled={selectedVertexIndices.length === 0}
                  className={`px-2 py-1.5 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all border ${
                    selectedVertexIndices.length > 0
                      ? 'bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white border-rose-800 hover:border-rose-500'
                      : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
                  }`}
                  title="Eliminar vértices seleccionados (Supr / Delete / Backspace)"
                >
                  🗑️ Eliminar (Supr)
                </button>
              </div>

              <button
                type="button"
                onClick={() => toggleShapeClosed(obj.id)}
                className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-all border border-zinc-700 mt-1"
                title="Cerrar o abrir la línea (C)"
              >
                ⭕ {obj.parameters?.closed ? 'Abrir Curva/Polilínea' : 'Cerrar Forma (C)'}
              </button>
            </div>
          </Section>

          <Section title="Parámetros">
            <NumRow label="Segmentos (Bezier)" value={p.segments ?? 20} onChange={v => up({ segments: Math.max(1, Math.round(v)) })}
              min={1} max={128} step={1} slider/>
            <NumRow label="Profundidad" value={p.extrusionDepth ?? 0} onChange={v => up({ extrusionDepth: v })}
              min={0} max={50} step={0.1} />
            {p.extrusionDepth !== undefined && p.extrusionDepth > 0 && (
              <NumRow label="Seg. Profundidad" value={p.depthSegments ?? 1} onChange={v => up({ depthSegments: Math.max(1, Math.round(v)) })}
                min={1} max={128} step={1} slider/>
            )}
          </Section>
        </>
      );
    }
    default:
      return null;
  }
};

const GeneratedSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const updateObject = useStore(s => s.updateObject);
  const saveHistory  = useStore(s => s.saveHistory);
  const p = obj.parameters as Record<string, any>;
  const genType = p.genType;

  if (!genType || genType === 'mesh') return null;

  const regen = (newVerts: V3[], newFaces: MeshFace[], newParams: Record<string,any>) => {
    updateObject(obj.id, {
      vertices: newVerts,
      faces: newFaces,
      parameters: { ...obj.parameters, ...newParams },
    });
    saveHistory();
  };

  return (
    <Section title="Generador" icon={<RotateCw size={12}/>}>
      <div className="px-1.5 py-1 bg-indigo-900/30 border border-indigo-800/50 rounded text-[9px] text-indigo-300 mb-2 flex items-center gap-1.5">
        <Wand2 size={10}/>
        <span>Objeto Paramétrico: <span className="font-bold uppercase">{genType}</span></span>
      </div>
      
      <div className="space-y-3">
        {genType === 'polygon' && (
          <>
            <NumRow label="Lados" value={p.genSides ?? 6} onChange={v => {
              const {vertices, faces} = generatePolygon(v, p.genRadius ?? 1);
              regen(vertices, faces, { genSides: v });
            }} min={3} max={64} step={1} slider />
            <NumRow label="Radio" value={p.genRadius ?? 1} onChange={v => {
              const {vertices, faces} = generatePolygon(p.genSides ?? 6, v);
              regen(vertices, faces, { genRadius: v });
            }} min={0.1} max={10} step={0.1} />
          </>
        )}

        {genType === 'arc' && (
          <>
            <NumRow label="Radio" value={p.genRadius ?? 1} onChange={v => {
              const {vertices, faces} = generateArc(v, p.genStart ?? 0, p.genEnd ?? Math.PI, p.genSegs ?? 32, p.genFilled ?? true);
              regen(vertices, faces, { genRadius: v });
            }} min={0.1} max={10} step={0.1} />
            <NumRow label="Ángulo" value={(p.genEnd ?? Math.PI) * (180/Math.PI)} onChange={v => {
              const rad = v * (Math.PI/180);
              const {vertices, faces} = generateArc(p.genRadius ?? 1, p.genStart ?? 0, rad, p.genSegs ?? 32, p.genFilled ?? true);
              regen(vertices, faces, { genEnd: rad });
            }} min={1} max={360} step={1} slider />
            <NumRow label="Segmentos" value={p.genSegs ?? 32} onChange={v => {
              const {vertices, faces} = generateArc(p.genRadius ?? 1, p.genStart ?? 0, p.genEnd ?? Math.PI, v, p.genFilled ?? true);
              regen(vertices, faces, { genSegs: v });
            }} min={3} max={128} step={1} slider />
          </>
        )}

        {genType === 'lathe' && (
          <>
            <NumRow label="Segmentos" value={p.genSegs ?? 32} onChange={v => {
              const {vertices, faces} = latheMesh(p.genProf ?? 'circle', v, p.genAngle ?? 360);
              regen(vertices, faces, { genSegs: v });
            }} min={3} max={128} step={1} slider />
            <NumRow label="Ángulo" value={p.genAngle ?? 360} onChange={v => {
              const {vertices, faces} = latheMesh(p.genProf ?? 'circle', p.genSegs ?? 32, v);
              regen(vertices, faces, { genAngle: v });
            }} min={1} max={360} step={1} slider />
          </>
        )}

        {genType === 'sweep' && (
          <>
            <NumRow label="Longitud" value={p.genLen ?? 5} onChange={v => {
              const path = makeStraightPath(v);
              const {vertices, faces} = sweepMesh(p.genProf ?? 'circle', path);
              regen(vertices, faces, { genLen: v });
            }} min={0.1} max={20} step={0.1} />
          </>
        )}
      </div>
    </Section>
  );
};

const AlignSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { project, selectedObjectIds, updateObject, saveHistory, recenterPivotObject } = useStore();
  
  const alignObjects = (axis: 'x'|'y'|'z', mode: 'min'|'center'|'max') => {
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    const selected = project.objects.filter(o => ids.includes(o.id));
    if (selected.length < 1) return;
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const positions = selected.map(o => o.transform.position[axisIdx]);
    const ref = mode === 'min' ? Math.min(...positions) : mode === 'max' ? Math.max(...positions) : positions.reduce((a,b)=>a+b,0)/positions.length;
    selected.forEach(o => {
      const pos = [...o.transform.position] as V3;
      pos[axisIdx] = ref;
      updateObject(o.id, { transform: { ...o.transform, position: pos } });
    });
    saveHistory();
  };

  const handleAlignToFloor = () => {
    const storeState = useStore.getState();
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    const selected = storeState.project.objects.filter(o => ids.includes(o.id));
    selected.forEach(targetObj => {
      let minYRel = 0;
      if (targetObj.vertices && targetObj.vertices.length > 0) {
        const euler = new THREE.Euler(targetObj.transform.rotation[0], targetObj.transform.rotation[1], targetObj.transform.rotation[2]);
        const scale = new THREE.Vector3(...targetObj.transform.scale);
        let min = Infinity;
        targetObj.vertices.forEach((v, idx) => {
          const off = targetObj.vertexOffsets?.[idx] ?? [0,0,0];
          const p = new THREE.Vector3((v[0]+off[0])*scale.x, (v[1]+off[1])*scale.y, (v[2]+off[2])*scale.z).applyEuler(euler);
          if (p.y < min) min = p.y;
        });
        if (isFinite(min)) minYRel = min;
      }
      storeState.updateObject(targetObj.id, {
        transform: {
          ...targetObj.transform,
          position: [targetObj.transform.position[0], -minYRel, targetObj.transform.position[2]]
        }
      });
    });
    storeState.saveHistory();
  };

  const handleCenterAllOrigin = () => {
    const storeState = useStore.getState();
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    ids.forEach(id => {
      const targetObj = storeState.project.objects.find(o => o.id === id);
      if (targetObj) {
        storeState.updateObject(id, {
          transform: {
            ...targetObj.transform,
            position: [0, 0, 0]
          }
        });
      }
    });
    storeState.saveHistory();
  };

  const handleCenterXZAndFloor = () => {
    const storeState = useStore.getState();
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    const selected = storeState.project.objects.filter(o => ids.includes(o.id));
    selected.forEach(targetObj => {
      let minYRel = 0;
      if (targetObj.vertices && targetObj.vertices.length > 0) {
        const euler = new THREE.Euler(targetObj.transform.rotation[0], targetObj.transform.rotation[1], targetObj.transform.rotation[2]);
        const scale = new THREE.Vector3(...targetObj.transform.scale);
        let min = Infinity;
        targetObj.vertices.forEach((v, idx) => {
          const off = targetObj.vertexOffsets?.[idx] ?? [0,0,0];
          const p = new THREE.Vector3((v[0]+off[0])*scale.x, (v[1]+off[1])*scale.y, (v[2]+off[2])*scale.z).applyEuler(euler);
          if (p.y < min) min = p.y;
        });
        if (isFinite(min)) minYRel = min;
      }
      storeState.updateObject(targetObj.id, {
        transform: {
          ...targetObj.transform,
          position: [0, -minYRel, 0]
        }
      });
    });
    storeState.saveHistory();
  };

  const rotateAxisByDegrees = (axis: 'x' | 'y' | 'z', deltaDeg: number) => {
    const storeState = useStore.getState();
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    const deltaRad = (deltaDeg * Math.PI) / 180;
    ids.forEach(id => {
      const targetObj = storeState.project.objects.find(o => o.id === id);
      if (!targetObj) return;
      const [rx, ry, rz] = targetObj.transform.rotation;
      let newRot: V3 = [rx, ry, rz];
      if (axis === 'x') newRot = [rx + deltaRad, ry, rz];
      if (axis === 'y') newRot = [rx, ry + deltaRad, rz];
      if (axis === 'z') newRot = [rx, ry, rz + deltaRad];

      storeState.updateObject(id, {
        transform: {
          ...targetObj.transform,
          rotation: newRot
        }
      });
    });
    storeState.saveHistory();
  };

  const handleFixLyingUpright = () => {
    const storeState = useStore.getState();
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    ids.forEach(id => {
      const targetObj = storeState.project.objects.find(o => o.id === id);
      if (!targetObj) return;
      const [rx, ry, rz] = targetObj.transform.rotation;
      const newRot: V3 = [rx + Math.PI / 2, ry, rz];

      let minYRel = 0;
      if (targetObj.vertices && targetObj.vertices.length > 0) {
        const euler = new THREE.Euler(newRot[0], newRot[1], newRot[2]);
        const scale = new THREE.Vector3(...targetObj.transform.scale);
        let min = Infinity;
        targetObj.vertices.forEach((v, idx) => {
          const off = targetObj.vertexOffsets?.[idx] ?? [0,0,0];
          const p = new THREE.Vector3((v[0]+off[0])*scale.x, (v[1]+off[1])*scale.y, (v[2]+off[2])*scale.z).applyEuler(euler);
          if (p.y < min) min = p.y;
        });
        if (isFinite(min)) minYRel = min;
      }

      storeState.updateObject(id, {
        transform: {
          ...targetObj.transform,
          rotation: newRot,
          position: [targetObj.transform.position[0], -minYRel, targetObj.transform.position[2]]
        }
      });
    });
    storeState.saveHistory();
  };

  const handleResetRotation = () => {
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    ids.forEach(id => {
      const targetObj = project.objects.find(o => o.id === id);
      if (!targetObj) return;
      updateObject(id, {
        transform: {
          ...targetObj.transform,
          rotation: [0, 0, 0]
        }
      });
    });
    saveHistory();
  };

  const handleAlignToAxes = () => {
    const ids = (selectedObjectIds && selectedObjectIds.length > 1) ? selectedObjectIds : [obj.id];
    const snap = (val: number) => Math.round(val / (Math.PI / 2)) * (Math.PI / 2);
    ids.forEach(id => {
      const targetObj = project.objects.find(o => o.id === id);
      if (targetObj) {
        updateObject(id, {
          transform: {
            ...targetObj.transform,
            rotation: [
              snap(targetObj.transform.rotation[0]),
              snap(targetObj.transform.rotation[1]),
              snap(targetObj.transform.rotation[2])
            ]
          }
        });
      }
    });
    saveHistory();
  };

  return (
    <Section title="Alinear / Pivote / Rotación" icon={<AlignCenterHorizontal size={12}/>}>
      <div className="space-y-3">
        <button 
          onClick={() => recenterPivotObject(obj.id)} 
          className="w-full p-1.5 bg-amber-900/40 hover:bg-amber-800/60 border border-amber-500/30 rounded text-[10px] font-bold text-amber-200 flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
          title="Centra el origen / pivote de transformación exactamente en el centro geométrico del objeto sin mover su posición en la escena"
        >
          <Target size={12} className="text-amber-400" /> Centrar Pivote / Origen al Objeto
        </button>

        {/* Alineación en los 3 Ejes */}
        <div className="space-y-1.5 pt-1 border-t border-white/5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
            <AlignCenterHorizontal size={10} /> Alineación Automática en 3 Ejes
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <button 
              onClick={handleCenterAllOrigin} 
              className="p-1.5 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded text-[10px] font-bold text-zinc-200 flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Mueve la posición del objeto exactamente al centro de los 3 ejes (0, 0, 0)"
            >
              <Target size={11} className="text-indigo-400" /> Centrar en (0, 0, 0)
            </button>
            <button 
              onClick={handleCenterXZAndFloor} 
              className="p-1.5 bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-500/30 rounded text-[10px] font-bold text-indigo-200 flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Centra X=0, Z=0 en el origen y sienta la base sobre el suelo (Y=0)"
            >
              <ArrowUpFromLine size={11} className="rotate-180 text-indigo-400" /> Centrar XZ + Suelo
            </button>
          </div>
          <button 
            onClick={handleAlignToFloor} 
            className="w-full p-1.5 bg-zinc-800/80 hover:bg-zinc-700 border border-white/10 rounded text-[10px] font-bold text-zinc-200 flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
            title="Sienta la base inferior del objeto exactamente sobre el suelo (Y = 0)"
          >
            <ArrowUpFromLine size={11} className="rotate-180 text-emerald-400" /> Alinear Base al Suelo (Y=0)
          </button>
        </div>

        {/* Corregir Modelo Tumbado / Rotación Automática */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <RotateCw size={10} /> Corregir Orientación (Modelo Tumbado)
            </span>
            <button 
              onClick={handleResetRotation}
              className="text-[9px] text-zinc-400 hover:text-white underline cursor-pointer"
              title="Restablecer rotación a (0°, 0°, 0°)"
            >
              Reset 0°
            </button>
          </div>

          <button 
            onClick={handleFixLyingUpright}
            className="w-full p-2 bg-gradient-to-r from-violet-900/60 via-indigo-900/60 to-purple-900/60 hover:from-violet-800 hover:to-purple-800 border border-indigo-500/40 rounded-lg text-[10px] font-bold text-white flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer active:scale-[0.98]"
            title="Si el objeto importado (STL/OBJ/GLTF) aparece acostado/tumbado, esto lo endereza verticalmente (+90° X) y lo asienta en el suelo"
          >
            <RotateCw size={13} className="text-indigo-300" />
            Enderezar Modelo Tumbado (+90° X)
          </button>

          {/* Botones de Rotación Rápida por Eje */}
          <div className="space-y-1.5">
            <p className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider">Rotar en Ejes (+90° / -90° / 180°)</p>
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis} className="flex items-center gap-1">
                <span className={`w-12 text-[9px] font-mono font-bold uppercase px-1 py-0.5 rounded text-center shrink-0 ${axis==='x'?'bg-rose-950 text-rose-300 border border-rose-800/50':axis==='y'?'bg-emerald-950 text-emerald-300 border border-emerald-800/50':'bg-sky-950 text-sky-300 border border-sky-800/50'}`}>
                  Eje {axis.toUpperCase()}
                </span>
                <button
                  onClick={() => rotateAxisByDegrees(axis, 90)}
                  className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] font-mono font-bold text-zinc-200 transition-all border border-white/5 active:scale-95"
                  title={`Rotar +90° en eje ${axis.toUpperCase()}`}
                >
                  +{axis.toUpperCase()} 90°
                </button>
                <button
                  onClick={() => rotateAxisByDegrees(axis, -90)}
                  className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] font-mono font-bold text-zinc-200 transition-all border border-white/5 active:scale-95"
                  title={`Rotar -90° en eje ${axis.toUpperCase()}`}
                >
                  -{axis.toUpperCase()} 90°
                </button>
                <button
                  onClick={() => rotateAxisByDegrees(axis, 180)}
                  className="px-2 py-1 bg-zinc-800/80 hover:bg-zinc-700 rounded text-[9px] font-mono font-bold text-zinc-400 hover:text-white transition-all border border-white/5 active:scale-95"
                  title={`Invertir 180° en eje ${axis.toUpperCase()}`}
                >
                  180°
                </button>
              </div>
            ))}
          </div>

          <button 
            onClick={handleAlignToAxes} 
            className="w-full p-1.5 bg-zinc-800/60 hover:bg-zinc-700 border border-white/10 rounded text-[10px] font-bold text-zinc-300 flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
            title="Redondea la rotación actual a los ángulos ortogonales más cercanos (múltiplos de 90°)"
          >
            <Target size={11} className="text-zinc-400" /> Ajustar a Ángulos Ortogonales (90°)
          </button>
        </div>

        {/* Matriz Min / Cen / Max */}
        <div className="space-y-1 pt-2 border-t border-white/5">
          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Alinear Relativo (Mín / Cen / Máx)</span>
          <div className="grid grid-cols-3 gap-1">
            {['x','y','z'].map(ax => (
              <React.Fragment key={ax}>
                <button onClick={()=>alignObjects(ax as any,'min')} className="p-1 bg-zinc-800/80 hover:bg-zinc-700 rounded text-[9px] font-mono">{ax.toUpperCase()} Min</button>
                <button onClick={()=>alignObjects(ax as any,'center')} className="p-1 bg-zinc-800/80 hover:bg-zinc-700 rounded text-[9px] font-mono">{ax.toUpperCase()} Cen</button>
                <button onClick={()=>alignObjects(ax as any,'max')} className="p-1 bg-zinc-800/80 hover:bg-zinc-700 rounded text-[9px] font-mono">{ax.toUpperCase()} Max</button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
};

const ObjectMaterialSection: React.FC<{ obj: CSGObject; onOpenMaterialTab: () => void }> = ({ obj, onOpenMaterialTab }) => {
  const { project, updateObject, assignMaterialToObjects, updateMaterial, addMaterial, openMaterialStudio } = useStore();
  const m = obj.material;
  const assignedMat = project.materials.find(mat => mat.id === obj.materialId);

  const handleAssign = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    assignMaterialToObjects([obj.id], val === 'none' ? null : val);
  };

  const handleCreateMaterialFromObject = () => {
    const newMat = {
      id: 'mat_' + Math.random().toString(36).substr(2, 9),
      name: `Material ${obj.name || 'Objeto'}`,
      color: m?.color || obj.color || '#ffffff',
      roughness: m?.roughness ?? 0.5,
      metalness: m?.metalness ?? 0,
      emissive: '#000000',
      emissiveIntensity: 1,
      opacity: obj.opacity ?? 1,
      transparent: (obj.opacity ?? 1) < 1,
    };
    addMaterial(newMat);
    assignMaterialToObjects([obj.id], newMat.id);
    openMaterialStudio(newMat.id);
  };

  const updateProp = (field: string, val: any) => {
    const nextMat = { ...m, [field]: val };
    updateObject(obj.id, { material: nextMat });
    if (assignedMat) {
      updateMaterial(assignedMat.id, { [field]: val });
    }
  };

  return (
    <Section title="Material del Objeto" icon={<Palette size={14}/>}>
      <div className="space-y-4">
        {/* Selector de material de proyecto */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Material Asignado</label>
            <button
              onClick={() => openMaterialStudio(assignedMat?.id)}
              className="text-[9px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
            >
              <Palette size={11} /> Abrir en Visor 3D
            </button>
          </div>
          <select 
            value={obj.materialId || 'none'} 
            onChange={handleAssign}
            className="w-full bg-zinc-900/80 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500/50 transition-all appearance-none cursor-pointer shadow-inner"
          >
            <option value="none">Ninguno (Material local simple)</option>
            {project.materials.map(mat => (
              <option key={mat.id} value={mat.id}>{mat.name}</option>
            ))}
          </select>
        </div>

        {/* Botón de acceso directo al editor PBR */}
        {assignedMat ? (
          <button
            onClick={() => openMaterialStudio(assignedMat.id)}
            className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-98"
          >
            <Palette size={13} /> Editar en Visor 3D de Materiales
          </button>
        ) : (
          <button
            onClick={handleCreateMaterialFromObject}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md active:scale-98"
          >
            <Plus size={13} className="text-indigo-400" /> Crear Material PBR y Abrir Visor 3D
          </button>
        )}

        {/* Propiedades en tiempo real */}
        <div className="p-4 bg-white/[0.02] rounded-2xl border border-white/5 space-y-4 shadow-xl">
          <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
            {assignedMat ? `Editar Parámetros ("${assignedMat.name}")` : 'Parámetros del Objeto'}
          </p>
          
          <NumRow label="Rugosidad" value={m?.roughness ?? assignedMat?.roughness ?? 0.5} onChange={v => updateProp('roughness', v)} min={0} max={1} slider />
          <NumRow label="Metálico" value={m?.metalness ?? assignedMat?.metalness ?? 0} onChange={v => updateProp('metalness', v)} min={0} max={1} slider />
          
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Usar POM (Parallax)</span>
            <button 
              onClick={() => updateProp('useParallax', !m?.useParallax)}
              className={`relative w-10 h-5 rounded-full transition-all ${m?.useParallax ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20' : 'bg-zinc-800'}`}
            >
              <motion.div 
                animate={{ x: m?.useParallax ? 22 : 2 }}
                className="absolute top-1 w-3 h-3 rounded-full bg-white shadow-sm"
              />
            </button>
          </div>
          {m?.useParallax && (
            <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="space-y-4 pt-2">
              <NumRow label="Escala POM" value={m?.parallaxScale ?? 0.1} onChange={v => updateProp('parallaxScale', v)} min={0} max={0.5} step={0.01} slider />
              <NumRow label="Pasos POM" value={m?.parallaxSteps ?? 32} onChange={v => updateProp('parallaxSteps', v)} min={8} max={128} step={1} slider />
            </motion.div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Color Base</span>
            <div className="relative group">
              <div 
                className="w-10 h-10 rounded-xl border-2 border-white/10 shadow-lg transition-transform group-hover:scale-105 cursor-pointer" 
                style={{ background: m?.color || assignedMat?.color || obj.color || '#ffffff' }} 
              />
              <input 
                type="color" 
                value={m?.color || assignedMat?.color || obj.color || '#ffffff'} 
                onChange={e => updateProp('color', e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
};



const MeshModifiersSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const {
    project,
    smoothObject,
    roundAnglesObject,
    subdivideObject,
    applyNoiseObject,
    optimizeObject,
    optimizeCurvedObject,
    regularizeObject,
    isotropicRemeshObject,
    retopologizeObject,
    convertMeshToQuadsObject,
    applyShrinkwrapToObject,
    applySilhouetteVacuumWrapToObject,
    optimizeConformedMeshToObject,
    pruneAirBridgingFacesToObject,
    cleanSpikesObject,
    solidifyObject,
    applyVoxelRemeshToObject,
    faceSnapConfig,
    setFaceSnapConfig,
    toggleFaceSnap,
    dissolveCoplanarObject,
    applyLowPolyBlueprint,
    applyDecimateModifier,
    removeBlueprintStyle,
    cleanIslandsObject,
    repairNormalsObject,
    repairHardSurfaceObject,
    flipObjectNormals,
    updateObject,
    fillHolesObject,
    capSelectedFacesObject,
    repairObject,
    weldObject,
    healObject,
    separateLoosePartsObject,
    editMode,
    selectedGLTFMeshes,
    setSelectedGLTFMeshes,
    isolateGLTFSelection,
    setIsolateGLTFSelection,
    addObject,
    removeObject,
    selectObject
  } = useStore();
  const [smoothFactor, setSmoothFactor] = useState(0.5);
  const [smoothIters, setSmoothIters] = useState(1);
  const [roundRadius, setRoundRadius] = useState(0.08);
  const [roundSegments, setRoundSegments] = useState(3);
  const [roundAngleThreshold, setRoundAngleThreshold] = useState(35);
  const [optimizeRatio, setOptimizeRatio] = useState(0.3);
  const [weldTolerance, setWeldTolerance] = useState(0.001);
  const [isHealing, setIsHealing] = useState(false);
  const [isSeparating, setIsSeparating] = useState(false);
  const [separateMsg, setSeparateMsg] = useState<string | null>(null);
  const [meshSortMode, setMeshSortMode] = useState<'desc' | 'asc' | 'default'>('desc');
  const [meshSearch, setMeshSearch] = useState('');

  // Estados de Regularización y Limpieza Avanzada de Topología
  const [regStrength, setRegStrength] = useState(0.30);
  const [regIters, setRegIters] = useState(3);
  const [regFeatureAngle, setRegFeatureAngle] = useState(40);
  const [remeshIters, setRemeshIters] = useState(2);
  const [coplanarTolerance, setCoplanarTolerance] = useState(5.0);
  const [islandRatio, setIslandRatio] = useState(0.05);

  // Estados de Snapping, Shrinkwrap (Envolver) y Solidify (Solidificar)
  const [shrinkTargetId, setShrinkTargetId] = useState<string>('');
  const [shrinkwrapMode, setShrinkwrapMode] = useState<ShrinkwrapMode>('NEAREST_SURFACE_POINT');
  const [shrinkwrapOffset, setShrinkwrapOffset] = useState<number>(0.002);
  const [shrinkwrapProjectAxis, setShrinkwrapProjectAxis] = useState<'X' | 'Y' | 'Z'>('Z');
  const [shrinkwrapProjectDir, setShrinkwrapProjectDir] = useState<'POSITIVE' | 'NEGATIVE' | 'BOTH'>('BOTH');
  const [shrinkwrapOnlySelected, setShrinkwrapOnlySelected] = useState<boolean>(false);
  const [isApplyingShrinkwrap, setIsApplyingShrinkwrap] = useState<boolean>(false);
  const [retopoPlaneSubdivs, setRetopoPlaneSubdivs] = useState<number>(100);
  const [retopoPlaneOrientation, setRetopoPlaneOrientation] = useState<'FRONT' | 'TOP' | 'SIDE' | 'VIEW'>('FRONT');
  const [retopoClampRayHits, setRetopoClampRayHits] = useState<boolean>(true);
  const [retopoCageSubdivs, setRetopoCageSubdivs] = useState<number>(16);
  const [retopoHeightSubdivs, setRetopoHeightSubdivs] = useState<number>(0);
  const [retopoShadingMode, setRetopoShadingMode] = useState<'FLAT' | 'SMOOTH' | 'AUTO'>('AUTO');
  const [retopoNormalWeight, setRetopoNormalWeight] = useState<number>(0.75);
  const [retopoActivePreset, setRetopoActivePreset] = useState<'HARDSURFACE' | 'RADIAL' | 'MECH' | 'ORGANIC' | 'CUSTOM'>('HARDSURFACE');
  const [showAdvancedRetopo, setShowAdvancedRetopo] = useState<boolean>(false);
  const [retopoCageShape, setRetopoCageShape] = useState<'ELLIPSOID' | 'BOX' | 'CYLINDER'>('BOX');
  const [retopoPruneAir, setRetopoPruneAir] = useState<boolean>(false);
  const [retopoAirSensitivity, setRetopoAirSensitivity] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [retopoAirDistThreshold, setRetopoAirDistThreshold] = useState<number>(0.035);
  const [retopoMaxStretchRatio, setRetopoMaxStretchRatio] = useState<number>(2.6);
  const [retopoAutoFillHoles, setRetopoAutoFillHoles] = useState<boolean>(true);
  const [isFillingHoles, setIsFillingHoles] = useState<boolean>(false);
  const [retopoAggressiveAir, setRetopoAggressiveAir] = useState<boolean>(false);
  const [retopoSubdivideStretchedEdges, setRetopoSubdivideStretchedEdges] = useState<boolean>(false);
  const [retopoIterations, setRetopoIterations] = useState<number>(4);
  const [retopoRelaxation, setRetopoRelaxation] = useState<number>(0.18);
  const [isApplyingVacuum, setIsApplyingVacuum] = useState<boolean>(false);
  const [isPruningAir, setIsPruningAir] = useState<boolean>(false);
  const [isCleaningSpikes, setIsCleaningSpikes] = useState<boolean>(false);

  // Estados de Optimización de Malla Ceñida a Silueta
  const [retopoAutoOptimize, setRetopoAutoOptimize] = useState<boolean>(false);
  const [retopoOptimizationRatio, setRetopoOptimizationRatio] = useState<number>(0.35);
  const [retopoPreserveCreases, setRetopoPreserveCreases] = useState<boolean>(true);
  const [retopoCreaseAngleDeg, setRetopoCreaseAngleDeg] = useState<number>(25);
  const [retopoOutputMode, setRetopoOutputMode] = useState<'QUAD_DOMINANT' | 'PURE_QUADS' | 'TRIANGLES'>('QUAD_DOMINANT');
  const [retopoReprojectTarget, setRetopoReprojectTarget] = useState<boolean>(true);
  const [isOptimizingMesh, setIsOptimizingMesh] = useState<boolean>(false);

  // Estados de Remallado Voxel (Comfy3D / GeomPack Pipeline)
  const [voxelTargetFaces, setVoxelTargetFaces] = useState<number>(1200);
  const [voxelResolution, setVoxelResolution] = useState<number>(44);
  const [voxelPreserveSharp, setVoxelPreserveSharp] = useState<boolean>(true);
  const [voxelSnapPlanar, setVoxelSnapPlanar] = useState<boolean>(true);
  const [voxelOutputMode, setVoxelOutputMode] = useState<'QUAD_DOMINANT' | 'TRIANGLES'>('QUAD_DOMINANT');
  const [isVoxelRemeshing, setIsVoxelRemeshing] = useState<boolean>(false);

  const [solidifyThickness, setSolidifyThickness] = useState<number>(0.05);
  const [solidifyOffset, setSolidifyOffset] = useState<number>(0.0);
  const [isSolidifying, setIsSolidifying] = useState<boolean>(false);

  // Estados de Optimización de Curvas & Redondeados (Esferas, Tubos, Cilindros)
  const [curvedOptRatio, setCurvedOptRatio] = useState(0.4);
  const [curvedPreserveCreases, setCurvedPreserveCreases] = useState(true);
  const [curvedCreaseAngle, setCurvedCreaseAngle] = useState(40);
  const [curvedSmoothNormals, setCurvedSmoothNormals] = useState(true);

  // Estados del Deformador de Malla por Ruido
  const [noiseType, setNoiseType] = useState<MeshNoiseType>('VORONOI_CELLULAR');
  const [noiseIntensity, setNoiseIntensity] = useState(0.12);
  const [noiseScale, setNoiseScale] = useState(1.8);
  const [noiseOctaves, setNoiseOctaves] = useState(3);
  const [noiseRoughness, setNoiseRoughness] = useState(0.55);
  const [noiseDirection, setNoiseDirection] = useState<MeshNoiseDirection>('NORMAL');
  const [noiseSeed, setNoiseSeed] = useState(1337);
  const [noiseSubdivideFirst, setNoiseSubdivideFirst] = useState(true);
  const [isApplyingNoise, setIsApplyingNoise] = useState(false);

  const handleApplyPreset = (preset: typeof MESH_NOISE_PRESETS[0]) => {
    setNoiseType(preset.config.noiseType);
    setNoiseIntensity(preset.config.intensity);
    setNoiseScale(preset.config.scale);
    if (preset.config.octaves !== undefined) setNoiseOctaves(preset.config.octaves);
    if (preset.config.roughness !== undefined) setNoiseRoughness(preset.config.roughness);
    if (preset.config.direction !== undefined) setNoiseDirection(preset.config.direction);
  };

  const handleApplyNoise = async () => {
    setIsApplyingNoise(true);
    await applyNoiseObject(obj.id, {
      noiseType,
      intensity: noiseIntensity,
      scale: noiseScale,
      octaves: noiseOctaves,
      roughness: noiseRoughness,
      direction: noiseDirection,
      seed: noiseSeed,
      subdivideFirst: noiseSubdivideFirst,
    });
    setIsApplyingNoise(false);
  };

  const sortedAndFilteredMeshes = useMemo(() => {
    if (!obj.meshData?.meshes) return [];
    let list = [...obj.meshData.meshes];
    if (meshSearch.trim()) {
      const q = meshSearch.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q));
    }
    if (meshSortMode === 'desc') {
      return list.sort((a, b) => b.faces - a.faces);
    } else if (meshSortMode === 'asc') {
      return list.sort((a, b) => a.faces - b.faces);
    }
    return list;
  }, [obj.meshData?.meshes, meshSortMode, meshSearch]);

  const handleSeparateLooseParts = async () => {
    setIsSeparating(true);
    setSeparateMsg(null);
    const res = await useStore.getState().separateLoosePartsObject(obj.id);
    setIsSeparating(false);
    setSeparateMsg(res.message);
    setTimeout(() => setSeparateMsg(null), 5000);
  };

  const handleHeal = async () => {
    setIsHealing(true);
    await healObject(obj.id);
    setIsHealing(false);
  };

  const toggleMeshSelection = (meshId: string) => {
    setSelectedGLTFMeshes(
      selectedGLTFMeshes.includes(meshId) 
        ? selectedGLTFMeshes.filter(id => id !== meshId)
        : [...selectedGLTFMeshes, meshId]
    );
  };

  const selectAllMeshes = () => {
    if (obj.meshData?.meshes) {
      setSelectedGLTFMeshes(obj.meshData.meshes.map(m => m.id));
    }
  };

  const selectDenseMeshes = () => {
    if (obj.meshData?.meshes) {
      const dense = obj.meshData.meshes.filter(m => m.faces >= 2000).map(m => m.id);
      setSelectedGLTFMeshes(dense.length > 0 ? dense : obj.meshData.meshes.map(m => m.id));
    }
  };

  const deselectAllMeshes = () => {
    setSelectedGLTFMeshes([]);
  };

  const selectedStats = useMemo(() => {
    if (!obj.meshData?.meshes || selectedGLTFMeshes.length === 0) return null;
    return obj.meshData.meshes
      .filter(m => selectedGLTFMeshes.includes(m.id))
      .reduce((acc, m) => ({
        vertices: acc.vertices + m.vertices,
        faces: acc.faces + m.faces
      }), { vertices: 0, faces: 0 });
  }, [obj.meshData?.meshes, selectedGLTFMeshes]);

  return (
    <Section title="Malla" icon={<Wand2 size={12}/>} defaultOpen={false}>
      <div className="space-y-2">
        <div className="p-2 bg-indigo-950/40 border border-indigo-500/30 rounded-lg space-y-1">
          <div className="flex items-center justify-between">
            <button
              onClick={() => updateObject(obj.id, { uvDebug: !obj.uvDebug })}
              className={`w-full py-1.5 px-2 rounded text-[10px] font-bold flex items-center justify-between transition-all ${
                obj.uvDebug 
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm shadow-indigo-950' 
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
              title="Aplica una textura de cuadrícula checkerboard UV para identificar estiramientos o distorsiones de coordenadas"
            >
              <span className="flex items-center gap-1.5">
                <Grid size={12} className={obj.uvDebug ? 'text-white' : 'text-indigo-400'} />
                <span>Show UV Debug (Checkerboard)</span>
              </span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/30">
                {obj.uvDebug ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
          <p className="text-[9px] text-zinc-400 leading-tight">
            Visualiza el mapa de coordenadas UV para detectar incoherencias entre el visor y el render.
          </p>
        </div>

        <div className="flex gap-1">
          <button onClick={() => updateObject(obj.id, { smoothShading: !obj.smoothShading })}
            className={`flex-1 py-1 rounded text-[10px] font-bold ${obj.smoothShading ? 'bg-indigo-600' : 'bg-zinc-800'}`}>
            Suave: {obj.smoothShading ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => repairObject(obj.id)} className="flex-1 py-1 bg-emerald-800 hover:bg-emerald-700 rounded text-[10px] font-bold transition-colors" title="Soldar vértices y limpiar geometría">
            Reparar
          </button>
          <button 
            onClick={handleHeal} 
            disabled={isHealing}
            className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${isHealing ? 'bg-zinc-700 animate-pulse' : 'bg-blue-800 hover:bg-blue-700'}`}
            title="Sana la malla usando Manifold (asegura que sea cerrada y estanca)"
          >
            {isHealing ? 'Sanando...' : 'Sanar'}
          </button>
        </div>
        <button onClick={() => subdivideObject(obj.id)} className="w-full py-1 bg-indigo-700 rounded text-[10px] font-bold">Subdividir</button>
        
        {/* ─── RUIDO DEFORMADOR DE MALLA (ROMPER GEOMETRÍA PERFECTA) ─── */}
        <div className="space-y-2 p-2.5 bg-gradient-to-b from-cyan-950/40 via-zinc-900/70 to-zinc-900/80 border border-cyan-500/30 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles size={12} className="text-cyan-400" />
              Ruido Deformador 3D (Romper Geometría)
            </span>
            <span className="text-[8.5px] bg-cyan-900/60 text-cyan-200 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
              3D Noise
            </span>
          </div>

          <p className="text-[9px] text-zinc-300 leading-tight">
            Rompe la geometría lisa y antinatural aplicando fractales, facetas de hielo/roca, ondas y microporos sobre los vértices.
          </p>

          {/* Barra de Presets Rápidos */}
          <div className="space-y-1">
            <span className="text-[8.5px] text-zinc-400 font-semibold uppercase">Presets Rápidos:</span>
            <div className="grid grid-cols-3 gap-1">
              {MESH_NOISE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleApplyPreset(p)}
                  className={`py-1 px-1.5 rounded text-[9px] font-medium flex items-center justify-center gap-1 border transition-all text-left truncate cursor-pointer ${
                    noiseType === p.config.noiseType
                      ? 'bg-cyan-900/80 border-cyan-400/60 text-cyan-100 font-bold shadow-sm'
                      : 'bg-zinc-800/80 hover:bg-zinc-700/80 border-zinc-700 text-zinc-300'
                  }`}
                  title={`${p.name}: ${p.desc}`}
                >
                  <span className="text-xs">{p.icon}</span>
                  <span className="truncate">{p.name.split('&')[0].trim()}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selector de Tipo de Ruido */}
          <div className="space-y-1">
            <label className="text-[9px] text-zinc-300 font-bold flex items-center justify-between">
              <span>Tipo de Ruido / Patrón:</span>
            </label>
            <select
              value={noiseType}
              onChange={(e) => setNoiseType(e.target.value as MeshNoiseType)}
              className="w-full bg-zinc-950 border border-zinc-700 text-zinc-200 rounded px-2 py-1.5 text-[10px] font-medium focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="VORONOI_CELLULAR">🧊 Voronoi Celular (Bloques Glaciales / Facetas)</option>
              <option value="PERLIN_FBM">🪨 Perlin FBM Fractal (Roca Orgánica / Montañas)</option>
              <option value="GLACIAL_RIPPLE">🌊 Rizado Glacial (Ondas y Surcos de Deshielo)</option>
              <option value="CRATER_EROSION">🌋 Cráteres & Erosión (Hendiduras / Meteorito)</option>
              <option value="MICRO_PORES_3D">🧽 Microporos 3D (Relieve Táctil en Vértices)</option>
              <option value="SIMPLEX_TURBULENCE">🌪️ Simplex Turbulencia (Pliegues y Distorsión)</option>
            </select>
          </div>

          {/* Sliders de Ajuste */}
          <div className="space-y-1 pt-0.5">
            <NumRow label="Fuerza / Intensidad" value={noiseIntensity} min={0.005} max={0.4} step={0.005} onChange={setNoiseIntensity} slider />
            <NumRow label="Escala / Tamaño de Ruido" value={noiseScale} min={0.2} max={12.0} step={0.1} onChange={setNoiseScale} slider />
            <NumRow label="Detalle / Octavas" value={noiseOctaves} min={1} max={5} step={1} onChange={setNoiseOctaves} slider />
            <NumRow label="Persistencia / Rugosidad" value={noiseRoughness} min={0.1} max={0.9} step={0.05} onChange={setNoiseRoughness} slider />
          </div>

          {/* Selector de Dirección */}
          <div className="space-y-1">
            <span className="text-[8.5px] text-zinc-400 font-semibold uppercase">Dirección de Deformación:</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setNoiseDirection('NORMAL')}
                className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all cursor-pointer ${
                  noiseDirection === 'NORMAL'
                    ? 'bg-cyan-700 border-cyan-400 text-white shadow-sm'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Desplaza vértices a lo largo de las normales de la superficie"
              >
                Normal (Superficie)
              </button>
              <button
                type="button"
                onClick={() => setNoiseDirection('RADIAL')}
                className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all cursor-pointer ${
                  noiseDirection === 'RADIAL'
                    ? 'bg-cyan-700 border-cyan-400 text-white shadow-sm'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Desplaza vértices hacia afuera del centro del objeto"
              >
                Radial (Centro)
              </button>
              <button
                type="button"
                onClick={() => setNoiseDirection('XYZ')}
                className={`flex-1 py-1 rounded text-[9px] font-bold border transition-all cursor-pointer ${
                  noiseDirection === 'XYZ'
                    ? 'bg-cyan-700 border-cyan-400 text-white shadow-sm'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Deformación tridimensional volumétrica libre"
              >
                3D Libre (XYZ)
              </button>
            </div>
          </div>

          {/* Opciones Adicionales & Semilla */}
          <div className="flex items-center justify-between pt-1 gap-2 border-t border-zinc-800/80">
            <label className="flex items-center gap-1.5 text-[9.5px] text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={noiseSubdivideFirst}
                onChange={(e) => setNoiseSubdivideFirst(e.target.checked)}
                className="accent-cyan-500 w-3.5 h-3.5 rounded"
              />
              <span>Subdividir si es baja resolución</span>
            </label>

            <button
              type="button"
              onClick={() => setNoiseSeed(Math.floor(Math.random() * 999999))}
              className="py-1 px-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-[9px] text-zinc-300 hover:text-white flex items-center gap-1 font-medium transition-colors cursor-pointer"
              title="Genera una nueva variación aleatoria de ruido"
            >
              <RotateCw size={10} className="text-cyan-400" />
              <span>🎲 Variación #{noiseSeed % 1000}</span>
            </button>
          </div>

          {/* Botón Principal de Aplicar Ruido */}
          <button
            onClick={handleApplyNoise}
            disabled={isApplyingNoise}
            className={`w-full py-2 px-3 rounded-md text-[10.5px] font-bold text-white flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer ${
              isApplyingNoise
                ? 'bg-cyan-900 animate-pulse border border-cyan-500/50'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-400/40 shadow-cyan-950/40'
            }`}
            title="Aplica la deformación de ruido seleccionada a la geometría de la malla"
          >
            <Sparkles size={13} className={isApplyingNoise ? 'animate-spin' : ''} />
            <span>{isApplyingNoise ? 'Deformando Malla...' : 'Romper Geometría con Ruido'}</span>
          </button>
        </div>

        <div className="pt-1 pb-0.5">
          <button
            onClick={handleSeparateLooseParts}
            disabled={isSeparating}
            className={`w-full py-1.5 px-2 rounded text-[10px] font-bold text-white flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer ${
              isSeparating
                ? 'bg-purple-900/60 animate-pulse border border-purple-500/40'
                : 'bg-purple-700 hover:bg-purple-600 border border-purple-500/40 shadow-purple-950/30'
            }`}
            title="Separar por partes sueltas: Analiza conectividad y divide objetos o mallas unificadas en piezas independientes"
          >
            <Split size={12} />
            {isSeparating ? 'Analizando partes...' : 'Separar por partes sueltas'}
          </button>
          {separateMsg && (
            <div className="mt-1.5 p-1.5 bg-purple-950/80 border border-purple-500/40 rounded text-[9px] text-purple-200 text-center font-medium animate-fadeIn">
              {separateMsg}
            </div>
          )}
        </div>
        <div className="space-y-1.5 p-2 bg-zinc-900/60 border border-emerald-500/20 rounded-lg">
          <div className="flex items-center justify-between text-[9px] font-bold text-emerald-300 uppercase">
            <span>Unir / Soldar Vértices (Weld)</span>
          </div>
          <p className="text-[9px] text-zinc-400 leading-tight">
            Fusiona vértices desarticulados y elimina grietas entre polígonos para cerrar la malla.
          </p>
          <NumRow label="Distancia Max Soldado" value={weldTolerance} min={0.0001} max={0.05} step={0.0005} onChange={setWeldTolerance} slider />
          <div className="flex gap-1 pt-0.5">
            <button
              onClick={() => weldObject(obj.id, weldTolerance)}
              className="flex-1 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded-md text-[10px] font-bold text-white transition-all shadow-sm cursor-pointer"
              title="Soldar vértices desarticulados dentro de la tolerancia seleccionada"
            >
              Soldar Vértices
            </button>
            <button
              onClick={handleHeal}
              disabled={isHealing}
              className={`flex-1 py-1.5 rounded-md text-[10px] font-bold text-white transition-all shadow-sm cursor-pointer ${
                isHealing ? 'bg-zinc-700 animate-pulse' : 'bg-blue-700 hover:bg-blue-600'
              }`}
              title="Curar topología usando Manifold 3D para obtener una malla 100% estanca/cerrada"
            >
              {isHealing ? 'Curando...' : 'Curar Malla (Manifold)'}
            </button>
          </div>
        </div>

        <div className="space-y-1.5 p-2 bg-zinc-900/60 border border-amber-500/20 rounded-lg">
          <div className="flex items-center justify-between text-[9px] font-bold text-amber-300 uppercase">
            <span>Redondear / Biselar Ángulos</span>
          </div>
          <p className="text-[9px] text-zinc-400 leading-tight">
            Suaviza únicamente los ángulos y bordes rectos o semirrectos con control de divisiones.
          </p>
          <NumRow label="Radio / Ancho" value={roundRadius} min={0.005} max={0.5} step={0.005} onChange={setRoundRadius} slider />
          <NumRow label="Divisiones" value={roundSegments} min={1} max={8} step={1} onChange={setRoundSegments} slider />
          <NumRow label="Ángulo Mínimo (°)" value={roundAngleThreshold} min={5} max={120} step={5} onChange={setRoundAngleThreshold} slider />
          <button 
            onClick={() => roundAnglesObject(obj.id, roundRadius, roundSegments, roundAngleThreshold)} 
            className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 rounded-md text-[10px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
            title="Redondea únicamente las aristas con ángulos rectos o afilados según el radio y divisiones configurados"
          >
            Redondear Ángulos Rectos
          </button>
        </div>

        <div className="space-y-1.5 p-2 bg-zinc-900/60 border border-indigo-500/20 rounded-lg">
          <div className="flex items-center justify-between text-[9px] font-bold text-indigo-300 uppercase">
            <span>Suavizado Laplaciano Fused</span>
          </div>
          <NumRow label="Factor Suavizado" value={smoothFactor} min={0.01} max={1} step={0.05} onChange={setSmoothFactor} slider />
          <NumRow label="Iteraciones" value={smoothIters} min={1} max={10} step={1} onChange={setSmoothIters} slider />
          <button 
            onClick={() => smoothObject(obj.id, smoothFactor, smoothIters)} 
            className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-[10px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            Aplicar Suavizado Malla
          </button>
        </div>

        {/* ─── REGULARIZACIÓN Y LIMPIEZA DE TOPOLOGÍA POST-OPTIMIZACIÓN ─── */}
        <div className="space-y-2 p-2 bg-gradient-to-b from-teal-950/40 via-zinc-900/70 to-zinc-900/80 border border-teal-500/30 rounded-lg shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-teal-300 uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles size={12} className="text-teal-400" />
              Malla Limpia & Regular (Post-Optimizar)
            </span>
            <span className="text-[8.5px] bg-teal-900/60 text-teal-200 border border-teal-500/30 px-1.5 py-0.5 rounded font-mono font-bold">
              Topology
            </span>
          </div>

          <p className="text-[9px] text-zinc-300 leading-tight">
            Corrige la geometría tras optimizar o extruir: relaja vértices tangencialmente, iguala triángulos sin perder aristas vivas y elimina ruido flotante.
          </p>

          {/* 1. Regularización Tangencial */}
          <div className="space-y-1 bg-zinc-950/60 border border-zinc-800 p-1.5 rounded">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-teal-200 font-bold flex items-center gap-1">
                <span>1. Relajación Tangencial (Equiláteros)</span>
              </span>
              <span className="text-[7.5px] bg-teal-950/90 text-teal-300 border border-teal-500/40 px-1 py-0.5 rounded font-mono font-bold">
                0 Caras Extra
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Equilibra los ángulos hacia triángulos equiláteros manteniendo el 100% de las caras y protegiendo aristas vivas y texturas.
            </p>
            <NumRow label="Fuerza Relajación" value={regStrength} min={0.05} max={0.65} step={0.05} onChange={setRegStrength} slider />
            <NumRow label="Iteraciones" value={regIters} min={1} max={8} step={1} onChange={setRegIters} slider />
            <NumRow label="Ángulo Aristas Vivas (°)" value={regFeatureAngle} min={15} max={85} step={5} onChange={setRegFeatureAngle} slider />
            <button
              onClick={() => regularizeObject(obj.id, regStrength, regIters, regFeatureAngle)}
              className="w-full py-1.5 bg-teal-700 hover:bg-teal-600 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer mt-0.5"
              title="Equilibra y regulariza los triángulos a lo largo de la superficie manteniendo exactamente el mismo recuento de caras"
            >
              Regularizar Malla (Topología Equilibrada · 0 Caras Extra)
            </button>
          </div>

          {/* 2. Remallado Isótropo Uniforme */}
          <div className="space-y-1 bg-zinc-950/60 border border-zinc-800 p-1.5 rounded">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-emerald-200 font-bold flex items-center gap-1">
                <span>2. Remallado Isótropo Uniforme</span>
              </span>
              <span className="text-[7.5px] bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 px-1 py-0.5 rounded font-mono font-bold">
                Sin Inflar Caras
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Unifica la longitud de aristas mediante división y colapso mutuo, garantizando que el recuento de caras nunca supere el actual.
            </p>
            <NumRow label="Pasadas" value={remeshIters} min={1} max={5} step={1} onChange={setRemeshIters} slider />
            <button
              onClick={() => isotropicRemeshObject(obj.id, undefined, remeshIters)}
              className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer mt-0.5"
              title="Divide aristas largas y colapsa aristas microscópicas garantizando que el recuento de polígonos no aumente"
            >
              Remallar Malla Uniforme (Sin Aumentar Polígonos)
            </button>
          </div>

          {/* 3. Remeser: Auto-Retopología (Flujo de Quads) */}
          <div className="space-y-1.5 bg-zinc-950/70 border border-fuchsia-500/40 p-2 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] text-fuchsia-300 font-bold flex items-center gap-1">
                <Layers size={11} className="text-fuchsia-400" />
                <span>3. Remeser: Auto-Retopología (Quads)</span>
              </span>
              <span className="text-[8px] bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-600/40 px-1 py-0.5 rounded font-mono font-bold">
                Quad Flow
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Reorganiza toda la malla en cuadriláteros limpios con bucles de bordes continuos para animación y rigging sin perder volumen.
            </p>
            <div className="grid grid-cols-2 gap-1 pt-0.5">
              <button
                type="button"
                onClick={() => retopologizeObject(obj.id, { mode: 'QUAD_DOMINANT', targetRatio: 0.25 })}
                className="py-1.5 bg-gradient-to-r from-fuchsia-700 to-indigo-700 hover:from-fuchsia-600 hover:to-indigo-600 rounded text-[9px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                title="Genera topología limpia con cuadriláteros dominantes al 25% del recuento original"
              >
                <Layers size={11} />
                Quads Dominantes (25%)
              </button>
              <button
                type="button"
                onClick={() => retopologizeObject(obj.id, { mode: 'PURE_QUADS', targetRatio: 0.25 })}
                className="py-1.5 bg-gradient-to-r from-indigo-700 to-violet-700 hover:from-indigo-600 hover:to-violet-600 rounded text-[9px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                title="Genera topología 100% de cuadriláteros puros (Catmull-Clark Flow)"
              >
                <Sparkles size={11} />
                100% Quads (Puros)
              </button>
            </div>
            <button
              type="button"
              onClick={() => convertMeshToQuadsObject(obj.id, { preserveCreases: false })}
              className="w-full py-1 bg-zinc-900 hover:bg-zinc-800 text-cyan-300 border border-cyan-500/30 rounded text-[8.5px] font-bold transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1"
              title="Convierte pares de caras triangulares coplanares en caras cuadriláteras (Quads) eliminando las aristas diagonales"
            >
              <Box size={10} className="text-cyan-400" />
              <span>Convertir Malla a Quads (Disolver Diagonales)</span>
            </button>
          </div>

          {/* 4. Snapping: Ajuste a Caras (Imán de Retopología) */}
          <div className="space-y-2 bg-zinc-950/70 border border-amber-500/40 p-2.5 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] text-amber-300 font-bold flex items-center gap-1.5">
                <Magnet size={12} className="text-amber-400" />
                <span>Snapping: Ajuste a Caras (Imán)</span>
              </span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold border ${
                faceSnapConfig?.enabled
                  ? 'bg-amber-500 text-black border-amber-400'
                  : 'bg-zinc-800 text-zinc-400 border-white/10'
              }`}>
                {faceSnapConfig?.enabled ? 'ACTIVO' : 'OFF'}
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Ajusta y calca los vértices directamente sobre la superficie del modelo high-poly mientras los mueves, manteniendo fielmente la silueta y los volúmenes del esculpido.
            </p>

            {/* Toggle Switch */}
            <button
              type="button"
              onClick={() => toggleFaceSnap()}
              className={`w-full py-1.5 rounded text-[9.5px] font-bold transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 ${
                faceSnapConfig?.enabled
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10'
              }`}
            >
              <Magnet size={12} />
              {faceSnapConfig?.enabled ? 'Desactivar Imán de Superficie' : 'Activar Imán Ajuste a Caras'}
            </button>

            {/* Project Individual Elements Toggle */}
            <label className="flex items-start justify-between gap-2 p-1.5 bg-zinc-900/80 border border-white/5 rounded cursor-pointer hover:border-amber-500/30 transition-colors">
              <div className="flex flex-col">
                <span className="text-[9px] font-semibold text-zinc-200">Project Individual Elements (Proyectar Individuales)</span>
                <span className="text-[7.5px] text-zinc-400 leading-tight">
                  Al mover varios vértices a la vez, cada uno se ajusta a la cara debajo independientemente en vez de como bloque rígido.
                </span>
              </div>
              <input
                type="checkbox"
                checked={faceSnapConfig?.projectIndividualElements ?? true}
                onChange={e => setFaceSnapConfig({ projectIndividualElements: e.target.checked })}
                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
              />
            </label>

            {/* Align Rotation to Target (Blender Face Snapping) */}
            <label className="flex items-start justify-between gap-2 cursor-pointer p-1.5 rounded bg-zinc-900/80 border border-white/5 hover:border-amber-500/30">
              <div className="flex flex-col">
                <span className="text-[9px] font-semibold text-zinc-200">Alinear Rotación a la Cara (Align Rotation)</span>
                <span className="text-[7.5px] text-zinc-400 leading-tight">
                  Al mover un objeto o modelo, orienta automáticamente su rotación siguiendo la normal e inclinación de la cara de apoyo (estilo Blender).
                </span>
              </div>
              <input
                type="checkbox"
                checked={faceSnapConfig?.alignRotationToTarget ?? false}
                onChange={e => setFaceSnapConfig({ alignRotationToTarget: e.target.checked })}
                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
              />
            </label>

            {/* Snap Base to Surface */}
            <label className="flex items-start justify-between gap-2 cursor-pointer p-1.5 rounded bg-zinc-900/80 border border-white/5 hover:border-amber-500/30">
              <div className="flex flex-col">
                <span className="text-[9px] font-semibold text-zinc-200">Apoyar Base en Superficie</span>
                <span className="text-[7.5px] text-zinc-400 leading-tight">
                  Apoya la base exterior sobre la cara en lugar de incrustar el pivote o centro del accesorio a la mitad.
                </span>
              </div>
              <input
                type="checkbox"
                checked={faceSnapConfig?.snapBaseToSurface ?? true}
                onChange={e => setFaceSnapConfig({ snapBaseToSurface: e.target.checked })}
                className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer mt-0.5"
              />
            </label>

            {/* Alignment Axis */}
            <div className="space-y-1 bg-zinc-900/80 p-1.5 rounded border border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-300 font-semibold">Eje de Apoyo del Accesorio:</span>
                <span className="text-[8.5px] font-mono text-amber-300 font-bold">{faceSnapConfig?.alignmentAxis ?? '+Y'}</span>
              </div>
              <div className="grid grid-cols-3 gap-1 pt-0.5">
                {(['+Y', '+Z', '+X'] as const).map(axis => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() => setFaceSnapConfig({ alignmentAxis: axis })}
                    className={`py-0.5 text-[8px] font-mono font-bold rounded cursor-pointer transition-colors ${
                      (faceSnapConfig?.alignmentAxis ?? '+Y') === axis
                        ? 'bg-amber-500 text-black'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {axis === '+Y' ? '+Y (Base)' : axis === '+Z' ? '+Z (Frente)' : '+X (Lado)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Offset / Desplazamiento */}
            <div className="space-y-1 bg-zinc-900/80 p-1.5 rounded border border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-300 font-semibold">Offset (Desplazamiento Z-Fighting):</span>
                <span className="text-[9px] font-mono text-amber-300 font-bold">{faceSnapConfig?.offset ?? 0.002}</span>
              </div>
              <p className="text-[7.5px] text-zinc-400 leading-tight">
                Evita que la nueva malla se hunda o parpadee visualmente al quedar en la misma coordenada que la escultura original.
              </p>
              <div className="flex items-center gap-1 pt-1">
                {[0, 0.001, 0.002, 0.005, 0.01].map(off => (
                  <button
                    key={off}
                    type="button"
                    onClick={() => setFaceSnapConfig({ offset: off })}
                    className={`flex-1 py-0.5 text-[8px] font-mono font-bold rounded cursor-pointer transition-colors ${
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

            {/* 1-Click Action to Snap selected object onto nearest surface */}
            <button
              type="button"
              onClick={async () => {
                if (obj?.id) {
                  const ok = await useStore.getState().alignToSurface(obj.id);
                  if (!ok) {
                    useStore.getState().alignToGround(obj.id);
                  }
                }
              }}
              disabled={!obj}
              className="w-full py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-40 text-black font-bold rounded text-[9.5px] shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Magnet size={12} />
              <span>🎯 Alinear y Pegar a la Superficie (Snap)</span>
            </button>

            <button
              type="button"
              onClick={() => useStore.getState().openFaceSnapDemoModal()}
              className="w-full py-1 text-[9px] text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer border border-amber-500/20"
            >
              <Sparkles size={11} className="text-amber-400" />
              <span>Ver Demo Guiada Paso a Paso</span>
            </button>
          </div>

          {/* 5. Modificador Shrinkwrap (Envolver) */}
          <div className="space-y-2 bg-zinc-950/70 border border-cyan-500/40 p-2.5 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] text-cyan-300 font-bold flex items-center gap-1.5">
                <Layers size={12} className="text-cyan-400" />
                <span>Modificador Shrinkwrap (Envolver Malla)</span>
              </span>
              <span className="text-[8px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 px-1 py-0.5 rounded font-mono font-bold">
                Envolver
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Proyecta toda la malla (o los vértices seleccionados) contra la superficie del modelo High-Poly para calcar perfectamente sus relieves y silueta.
            </p>

            {(() => {
              const availableTargets = project.objects.filter(o => o.id !== obj.id);
              const resolvedTarget = shrinkTargetId 
                ? project.objects.find(o => o.id === shrinkTargetId) 
                : availableTargets[0];

              const isCurrentObjCage = !!(obj.parameters as any)?.isWrapperCage || 
                obj.name.toLowerCase().includes('cage') || 
                obj.name.toLowerCase().includes('envoltura');
              const effectiveTarget = (isCurrentObjCage && resolvedTarget) ? resolvedTarget : obj;

              const handleCreateRetopoPlane = (subdivs = retopoPlaneSubdivs, orient = retopoPlaneOrientation) => {
                const newObj = createRetopoQuadPlane({
                  targetObj: effectiveTarget,
                  subdivisions: subdivs,
                  orientation: orient,
                  marginFactor: 1.15
                });

                addObject(newObj);
                selectObject(newObj.id);
                setShrinkTargetId(effectiveTarget.id);
              };

              const handleCreateWrapperCage = (
                subdivs = retopoCageSubdivs,
                shape = retopoCageShape,
                heightSubdivs = retopoHeightSubdivs
              ) => {
                if (isCurrentObjCage) {
                  removeObject(obj.id);
                }
                const newObj = createRetopoCage({
                  targetObj: effectiveTarget,
                  subdivisions: subdivs,
                  heightSubdivisions: heightSubdivs > 0 ? heightSubdivs : undefined,
                  marginFactor: 1.08,
                  shape: shape
                });

                addObject(newObj);
                selectObject(newObj.id);
                setShrinkTargetId(effectiveTarget.id);
              };

              return (
                <div className="space-y-2">
                  {/* Banner de ayuda rápida si el objeto activo es una Envoltura o Cage */}
                  {(obj.name.toLowerCase().includes('cage') || obj.name.toLowerCase().includes('envoltura')) && (
                    <div className="p-2.5 bg-gradient-to-r from-amber-950/70 via-orange-950/60 to-zinc-900/80 border border-amber-500/50 rounded-lg space-y-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-[9px] text-amber-300">
                          <Scissors size={12} className="text-amber-400 shrink-0" />
                          <span>¿Membranas o telas flotando entre patas/alas?</span>
                        </div>
                        <span className="text-[7.5px] bg-amber-500/20 text-amber-200 border border-amber-500/40 px-1 py-0.2 rounded font-mono font-bold">
                          Anti-Huecos
                        </span>
                      </div>
                      <p className="text-[8px] text-amber-200/90 leading-tight">
                        Elimina las telas que flotan en el aire entre patas o bajo el vientre protegiendo las superficies reales y auto-sellando los huecos.
                      </p>

                      {/* Modo Sensibilidad */}
                      <div className="grid grid-cols-3 gap-1 pt-0.5">
                        {[
                          { id: 'conservative', label: '🛡️ Conservador', desc: 'Cero huecos' },
                          { id: 'balanced', label: '⚖️ Equilibrado', desc: 'Recomendado' },
                          { id: 'aggressive', label: '⚡ Agresivo', desc: 'Separar patas' }
                        ].map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setRetopoAirSensitivity(s.id as any);
                              if (s.id === 'conservative') {
                                setRetopoMaxStretchRatio(3.5);
                                setRetopoAirDistThreshold(0.055);
                              } else if (s.id === 'aggressive') {
                                setRetopoMaxStretchRatio(2.0);
                                setRetopoAirDistThreshold(0.025);
                              } else {
                                setRetopoMaxStretchRatio(2.6);
                                setRetopoAirDistThreshold(0.035);
                              }
                            }}
                            className={`py-1 px-1 rounded text-[7.5px] font-bold text-center cursor-pointer transition-all ${
                              retopoAirSensitivity === s.id
                                ? 'bg-amber-600 text-white shadow-sm'
                                : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                            }`}
                            title={s.desc}
                          >
                            <div>{s.label}</div>
                            <div className="text-[6.5px] font-normal opacity-80">{s.desc}</div>
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-1 pt-0.5">
                        <button
                          type="button"
                          disabled={isPruningAir || isApplyingVacuum}
                          onClick={async () => {
                            const targetObj = resolvedTarget || availableTargets[0];
                            if (!targetObj) {
                              alert('Se necesita el modelo original de referencia para podar las telas flotantes.');
                              return;
                            }
                            setIsPruningAir(true);
                            try {
                              await pruneAirBridgingFacesToObject(obj.id, targetObj.id, {
                                sensitivity: retopoAirSensitivity,
                                airDistanceThreshold: retopoAirDistThreshold,
                                maxStretchRatio: retopoMaxStretchRatio,
                                autoFillHoles: retopoAutoFillHoles,
                                offset: shrinkwrapOffset
                              });
                            } catch (err) {
                              console.error('Error al podar telas flotantes:', err);
                              alert('Ocurrió un error al podar las membranas.');
                            } finally {
                              setIsPruningAir(false);
                            }
                          }}
                          className="flex-1 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded font-bold text-[8.5px] flex items-center justify-center gap-1 cursor-pointer transition-all shadow-md active:scale-95"
                        >
                          <Scissors size={11} />
                          <span>{isPruningAir ? 'Podando telas...' : '🧹 Limpiar Telas Ahora'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isFillingHoles}
                          onClick={async () => {
                            setIsFillingHoles(true);
                            try {
                              await fillHolesObject(obj.id);
                            } catch (err) {
                              console.error('Error tapando huecos:', err);
                            } finally {
                              setIsFillingHoles(false);
                            }
                          }}
                          className="py-1.5 px-2 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/40 rounded font-bold text-[8.5px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm"
                          title="Detecta y cierra automáticamente cualquier borde abierto o agujero en la malla"
                        >
                          <span>{isFillingHoles ? 'Sellando...' : '🕳️ Tapar Huecos'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Selector y Generador de Malla de Retopología: Plano Quads o Cage Envoltura 3D */}
                  <div className="p-2 bg-cyan-950/30 border border-cyan-500/30 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-[9px] text-cyan-300">
                        <Grid size={12} className="text-cyan-400" />
                        <span>Generador de Retopología (Auto-Ajuste Bounding)</span>
                      </div>
                      <span className="text-[7.5px] bg-cyan-900/60 text-cyan-200 px-1 py-0.5 rounded font-mono">
                        Silueta 3D
                      </span>
                    </div>

                    {/* Opción 1: Plano Quads 2D */}
                    <div className="bg-zinc-900/70 border border-zinc-700/60 p-1.5 rounded space-y-1.5">
                      <div className="flex items-center justify-between text-[8px] font-bold text-zinc-300">
                        <span>1. Plano Quads (Lámina frontal/cenital):</span>
                        <span className="text-cyan-300 font-mono font-bold">{retopoPlaneSubdivs}x{retopoPlaneSubdivs} quads</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[
                          { label: '25x25', val: 25 },
                          { label: '50x50', val: 50 },
                          { label: '100x100', val: 100, star: true },
                          { label: '150x150', val: 150 },
                        ].map(preset => (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => setRetopoPlaneSubdivs(preset.val)}
                            className={`py-0.5 px-1 rounded text-[7.5px] font-mono font-bold transition-all cursor-pointer ${
                              retopoPlaneSubdivs === preset.val
                                ? 'bg-cyan-600 text-white shadow-sm'
                                : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                            }`}
                          >
                            {preset.label} {preset.star && '★'}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[7.5px]">
                        <span className="text-zinc-400">Orientación:</span>
                        <div className="flex flex-wrap gap-1">
                          {[
                            { id: 'FRONT', label: 'Frente (Z)' },
                            { id: 'TOP', label: 'Cenital (Y)' },
                            { id: 'SIDE', label: 'Lateral (X)' },
                            { id: 'VIEW', label: 'Cámara Activa' }
                          ].map(orient => (
                            <button
                              key={orient.id}
                              type="button"
                              onClick={() => setRetopoPlaneOrientation(orient.id as any)}
                              className={`px-1.5 py-0.5 rounded text-[7.5px] font-bold cursor-pointer transition-colors ${
                                retopoPlaneOrientation === orient.id
                                  ? 'bg-cyan-600 text-white'
                                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {orient.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-1.5 text-[7.5px] text-cyan-200 cursor-pointer pt-0.5">
                        <input
                          type="checkbox"
                          checked={retopoClampRayHits}
                          onChange={e => setRetopoClampRayHits(e.target.checked)}
                          className="w-3 h-3 accent-cyan-500 rounded cursor-pointer"
                        />
                        <span>Preservar bordes exteriores del plano (evita colapsar en punta)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleCreateRetopoPlane(retopoPlaneSubdivs, retopoPlaneOrientation)}
                        className="w-full py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-bold text-[8.5px] flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                      >
                        <Plus size={11} />
                        <span>Crear Plano Quads {retopoPlaneSubdivs}x{retopoPlaneSubdivs}</span>
                      </button>
                    </div>

                    {/* Opción 2: Cage Envoltura 3D (Silueta Completa) */}
                    <div className="bg-blue-950/40 border border-blue-500/40 p-2 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-[8px] font-bold text-blue-200">
                        <span className="flex items-center gap-1">
                          <Box size={10} className="text-blue-400" />
                          <span>2. Cage Envoltura 3D (Silueta completa 360°):</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-[7.5px] px-1 py-0.2 rounded bg-blue-900/80 text-blue-300 font-mono font-bold border border-blue-500/30">
                            Base: {retopoCageSubdivs} | Alt: {retopoHeightSubdivs > 0 ? retopoHeightSubdivs : 'Auto'}
                          </span>
                        </div>
                      </div>

                      {/* PRESETS INTELIGENTES DE 1-CLIC */}
                      <div className="space-y-1 p-1.5 bg-gradient-to-r from-indigo-950/80 via-blue-950/70 to-purple-950/80 rounded border border-indigo-500/40">
                        <div className="flex items-center justify-between text-[7.5px]">
                          <span className="font-bold text-indigo-300 flex items-center gap-1">
                            <Sparkles size={10} className="text-indigo-400" />
                            <span>Ajuste Rápido (1-Clic Inteligente):</span>
                          </span>
                          <span className="text-[6.5px] text-indigo-200/80 font-mono">Auto-configuración</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            {
                              id: 'HARDSURFACE',
                              label: '💎 Sólido',
                              desc: 'Cubos, prismas, cajas',
                              apply: () => {
                                setRetopoActivePreset('HARDSURFACE');
                                setRetopoCageShape('BOX');
                                setRetopoCageSubdivs(16);
                                setRetopoHeightSubdivs(0);
                                setRetopoPruneAir(false);
                                setRetopoAggressiveAir(false);
                                setRetopoPreserveCreases(true);
                                setRetopoSubdivideStretchedEdges(false);
                                setRetopoShadingMode('FLAT');
                                setRetopoNormalWeight(0.75);
                                setRetopoIterations(4);
                                setRetopoRelaxation(0.18);
                                setRetopoAutoOptimize(false);
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(16, 'BOX', 0);
                                }
                              }
                            },
                            {
                              id: 'RADIAL',
                              label: '⭐ Radial',
                              desc: 'Estrellas, engranajes, logos',
                              apply: () => {
                                setRetopoActivePreset('RADIAL');
                                setRetopoCageShape('CYLINDER');
                                setRetopoCageSubdivs(20);
                                setRetopoHeightSubdivs(2);
                                setRetopoPruneAir(false);
                                setRetopoAggressiveAir(false);
                                setRetopoPreserveCreases(true);
                                setRetopoSubdivideStretchedEdges(false);
                                setRetopoShadingMode('FLAT');
                                setRetopoNormalWeight(0.75);
                                setRetopoIterations(4);
                                setRetopoRelaxation(0.08);
                                setRetopoAutoOptimize(false);
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(20, 'CYLINDER', 2);
                                }
                              }
                            },
                            {
                              id: 'MECH',
                              label: '🤖 Mecha',
                              desc: 'Robots, 4 patas, huecos',
                              apply: () => {
                                setRetopoActivePreset('MECH');
                                setRetopoCageShape('BOX');
                                setRetopoCageSubdivs(24);
                                setRetopoHeightSubdivs(16);
                                setRetopoPruneAir(false);
                                setRetopoAggressiveAir(false);
                                setRetopoPreserveCreases(true);
                                setRetopoSubdivideStretchedEdges(false);
                                setRetopoShadingMode('AUTO');
                                setRetopoNormalWeight(0.75);
                                setRetopoIterations(4);
                                setRetopoRelaxation(0.15);
                                setRetopoAutoOptimize(false);
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(24, 'BOX', 16);
                                }
                              }
                            },
                            {
                              id: 'ORGANIC',
                              label: '👤 Orgánico',
                              desc: 'Bustos, esculturas',
                              apply: () => {
                                setRetopoActivePreset('ORGANIC');
                                setRetopoCageShape('ELLIPSOID');
                                setRetopoCageSubdivs(16);
                                setRetopoHeightSubdivs(0);
                                setRetopoPruneAir(false);
                                setRetopoAggressiveAir(false);
                                setRetopoPreserveCreases(false);
                                setRetopoSubdivideStretchedEdges(false);
                                setRetopoShadingMode('SMOOTH');
                                setRetopoNormalWeight(0.35);
                                setRetopoIterations(4);
                                setRetopoRelaxation(0.28);
                                setRetopoAutoOptimize(false);
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(16, 'ELLIPSOID', 0);
                                }
                              }
                            }
                          ].map(preset => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={preset.apply}
                              className={`p-1 rounded text-center cursor-pointer transition-all ${
                                retopoActivePreset === preset.id
                                  ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                                  : 'bg-zinc-900/90 text-zinc-300 hover:text-white hover:bg-zinc-800 border border-white/5'
                              }`}
                              title={preset.desc}
                            >
                              <div className="text-[7.5px] font-bold">{preset.label}</div>
                              <div className="text-[6px] text-zinc-400 truncate">{preset.desc}</div>
                            </button>
                          ))}
                        </div>

                        {/* Banner contextual especial para Figuras Radiales / Estrellas */}
                        {(retopoActivePreset === 'RADIAL' || (effectiveTarget && (effectiveTarget.name.toLowerCase().includes('estrella') || effectiveTarget.name.toLowerCase().includes('star') || effectiveTarget.type === 'STAR'))) && (
                          <div className="p-1.5 mt-1 bg-amber-950/80 border border-amber-500/40 rounded space-y-1">
                            <div className="flex items-center justify-between text-[7px] text-amber-200">
                              <span className="font-bold flex items-center gap-1">
                                <Sparkles size={9} className="text-amber-400" />
                                <span>Figura Radial / Extruida ({effectiveTarget?.name || 'Estrella 3D'})</span>
                              </span>
                              <span className="text-[6.5px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 rounded font-mono">
                                Cilindro Radial Recomendado
                              </span>
                            </div>
                            <p className="text-[6.5px] text-amber-200/80 leading-tight">
                              Una caja cúbica deforma las puntas de una estrella al proyectarse. Usar una jaula de <strong>Cilindro (Radial)</strong> de 20 divisiones reparte 4 quads exactos por punta sin cruces ni arrugas:
                            </p>
                            <div className="grid grid-cols-2 gap-1 pt-0.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setRetopoActivePreset('RADIAL');
                                  setRetopoCageShape('CYLINDER');
                                  setRetopoCageSubdivs(20);
                                  setRetopoHeightSubdivs(2);
                                  if (isCurrentObjCage) {
                                    handleCreateWrapperCage(20, 'CYLINDER', 2);
                                  }
                                }}
                                className="py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[7px] font-bold shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                title="Crea o regenera la jaula como un cilindro radial concéntrico a las puntas"
                              >
                                <Sparkles size={9} />
                                <span>1. Jaula Cilindro (20 div)</span>
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!effectiveTarget) return;
                                  try {
                                    await convertMeshToQuadsObject(effectiveTarget.id, { preserveCreases: true });
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                                className="py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded text-[7px] font-bold shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                title="Convierte la estrella directamente a cuadriláteros sin necesidad de envolver jaula"
                              >
                                <Layers size={9} />
                                <span>2. Quads Directos (Sin Jaula)</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Banner contextual especial para Mechas / AT-AT */}
                        {retopoActivePreset === 'MECH' && (
                          <div className="p-1.5 mt-1 bg-purple-950/80 border border-purple-500/40 rounded space-y-1">
                            <div className="flex items-center justify-between text-[7px] text-purple-200">
                              <span className="font-bold flex items-center gap-1">
                                <Sparkles size={9} className="text-purple-400" />
                                <span>¿Quieres retopologizar las partes de {effectiveTarget.name || 'este modelo'} directamente?</span>
                              </span>
                            </div>
                            <p className="text-[6.5px] text-purple-200/80 leading-tight">
                              Remalla la geometría real con protección estricta de texturas UV y normales originales:
                            </p>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await retopologizeObject(effectiveTarget.id, { mode: 'QUAD_DOMINANT', targetRatio: 0.25 });
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              className="w-full py-1 bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-white rounded text-[7.5px] font-bold shadow-xs flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                            >
                              <Layers size={10} />
                              <span>⚡ Remallar {effectiveTarget.name || 'Modelo'} Directamente (Quad Flow 25%)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                try {
                                  useStore.getState().undo();
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              className="w-full py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[7px] font-semibold border border-zinc-700 flex items-center justify-center gap-1 cursor-pointer transition-all"
                              title="Deshacer el último cambio de remallado y restaurar la geometría original con sus texturas intactas"
                            >
                              <RotateCcw size={8.5} className="text-amber-400" />
                              <span>↺ Deshacer Remeser (Restaurar Original)</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Selector de Forma 3D */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[7.5px] text-zinc-400">
                          <span>Forma 3D de la Jaula:</span>
                          <span className="text-[7px] text-blue-300">
                            {retopoCageShape === 'BOX' ? '📦 Cubo / Caja' : retopoCageShape === 'CYLINDER' ? '⭕ Cilindro' : '🌐 Elipsoide'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {[
                            { id: 'BOX', label: '📦 Cubo / Caja' },
                            { id: 'CYLINDER', label: '⭕ Cilindro (Radial)' },
                            { id: 'ELLIPSOID', label: '🌐 Elipsoide' }
                          ].map(shape => (
                            <button
                              key={shape.id}
                              type="button"
                              onClick={() => {
                                const newShape = shape.id as any;
                                setRetopoCageShape(newShape);
                                setRetopoActivePreset('CUSTOM');
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(retopoCageSubdivs, newShape, retopoHeightSubdivs);
                                }
                              }}
                              className={`py-1 px-1 rounded text-[7.5px] font-bold cursor-pointer transition-all ${
                                retopoCageShape === shape.id
                                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400'
                                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-750'
                              }`}
                            >
                              {shape.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Subdivisión Base (Perímetro / Ancho) */}
                      <div className="space-y-1 pt-1 border-t border-blue-500/20">
                        <div className="flex items-center justify-between text-[7.5px]">
                          <span className="text-zinc-300">Subdivisión Base (Ancho / Contorno):</span>
                          <span className="text-blue-300 font-mono font-bold text-[8px]">{retopoCageSubdivs}</span>
                        </div>
                        <div className="grid grid-cols-5 gap-1">
                          {[
                            { label: '8 (Ultra-Low)', val: 8 },
                            { label: '12 (Low)', val: 12 },
                            { label: '16 ★', val: 16, star: true },
                            { label: '24', val: 24 },
                            { label: '32', val: 32 },
                          ].map(preset => (
                            <button
                              key={preset.val}
                              type="button"
                              onClick={() => {
                                setRetopoCageSubdivs(preset.val);
                                setRetopoActivePreset('CUSTOM');
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(preset.val, retopoCageShape, retopoHeightSubdivs);
                                }
                              }}
                              className={`py-0.5 px-0.5 rounded text-[7px] font-mono font-bold transition-all cursor-pointer ${
                                retopoCageSubdivs === preset.val
                                  ? 'bg-blue-600 text-white shadow-sm'
                                  : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Polígonos en Altura (Y) */}
                      <div className="space-y-1 p-1.5 bg-blue-900/30 rounded border border-blue-400/30">
                        <div className="flex items-center justify-between text-[7.5px]">
                          <span className="font-bold text-blue-200 flex items-center gap-1">
                            <span>↕️ Polígonos en Altura (Eje Y):</span>
                          </span>
                          <span className="text-cyan-300 font-mono font-bold text-[8px]">
                            {retopoHeightSubdivs > 0 ? `${retopoHeightSubdivs} cortes` : 'Automático'}
                          </span>
                        </div>
                        <div className="grid grid-cols-7 gap-0.5">
                          {[
                            { label: 'Auto ★', val: 0 },
                            { label: '1 (Mín)', val: 1 },
                            { label: '2', val: 2 },
                            { label: '4', val: 4 },
                            { label: '8', val: 8 },
                            { label: '12', val: 12 },
                            { label: '16', val: 16 }
                          ].map(hp => (
                            <button
                              key={hp.val}
                              type="button"
                              onClick={() => {
                                setRetopoHeightSubdivs(hp.val);
                                setRetopoActivePreset('CUSTOM');
                                if (isCurrentObjCage) {
                                  handleCreateWrapperCage(retopoCageSubdivs, retopoCageShape, hp.val);
                                }
                              }}
                              className={`py-0.5 px-0.5 rounded text-[7px] font-mono font-bold transition-all cursor-pointer ${
                                retopoHeightSubdivs === hp.val
                                  ? 'bg-cyan-600 text-white shadow-xs'
                                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {hp.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ACORDEÓN DESPLEGABLE: AJUSTES MANUALES Y AVANZADOS (OPCIONAL) */}
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() => setShowAdvancedRetopo(!showAdvancedRetopo)}
                          className="w-full py-1 px-1.5 rounded text-[7.5px] font-bold text-zinc-400 hover:text-zinc-200 bg-zinc-900/80 hover:bg-zinc-800 border border-white/5 flex items-center justify-between cursor-pointer transition-colors"
                        >
                          <span className="flex items-center gap-1">
                            <SlidersHorizontal size={10} className="text-blue-400" />
                            <span>⚙️ Ajustes Manuales / Avanzados (Opcional)</span>
                          </span>
                          <span className="text-[6.5px] text-blue-300 font-mono">
                            {showAdvancedRetopo ? '▲ Ocultar' : '▼ Ver parámetros'}
                          </span>
                        </button>

                        {showAdvancedRetopo && (
                          <div className="space-y-1.5 pt-1.5 pb-0.5">
                            {/* Control de Optimización y Reducción de Polígonos */}
                            <div className="p-1 bg-cyan-950/40 rounded border border-cyan-500/30 space-y-1">
                              <label className="flex items-center justify-between gap-1 text-[7.5px] text-cyan-200 cursor-pointer">
                                <span className="font-bold flex items-center gap-1">
                                  <Sparkles size={9} className="text-cyan-400" />
                                  <span>Decimar / Reducir polígonos tras envoltura</span>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={retopoAutoOptimize}
                                  onChange={e => setRetopoAutoOptimize(e.target.checked)}
                                  className="w-3 h-3 accent-cyan-500 rounded cursor-pointer"
                                />
                              </label>
                              {!retopoAutoOptimize && (
                                <p className="text-[7px] text-cyan-300/80 leading-tight">
                                  ✓ <strong>Flujo de Quads Puro:</strong> Mantiene la cuadrícula regular y bucles ortogonales sin triángulos diagonales ni telarañas.
                                </p>
                              )}

                              {retopoAutoOptimize && (
                                <div className="space-y-1 pt-0.5 border-t border-cyan-500/20">
                                  <div className="flex items-center justify-between text-[7px] text-cyan-200/90">
                                    <span>Reducción de polígonos:</span>
                                    <span className="font-mono font-bold text-cyan-300">
                                      {retopoOptimizationRatio === 0.5 ? '50% (Fiel)' : retopoOptimizationRatio === 0.35 ? '65% (Equilibrada ★)' : retopoOptimizationRatio === 0.2 ? '80% (Optimizada)' : '90% (Low-Poly)'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-0.5">
                                    {[
                                      { label: '50%', val: 0.5 },
                                      { label: '65% ★', val: 0.35 },
                                      { label: '80%', val: 0.2 },
                                      { label: '90%', val: 0.1 }
                                    ].map(p => (
                                      <button
                                        key={p.val}
                                        type="button"
                                        onClick={() => setRetopoOptimizationRatio(p.val)}
                                        className={`py-0.5 px-0.5 rounded text-[7px] font-mono transition-all cursor-pointer ${
                                          retopoOptimizationRatio === p.val
                                            ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                            : 'bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                                        }`}
                                      >
                                        {p.label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="flex items-center justify-between pt-0.5">
                                    <label className="flex items-center gap-1 text-[7px] text-zinc-300 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={retopoPreserveCreases}
                                        onChange={e => setRetopoPreserveCreases(e.target.checked)}
                                        className="w-2.5 h-2.5 accent-cyan-500 rounded cursor-pointer"
                                      />
                                      <span>Bloquear aristas vivas</span>
                                    </label>
                                    <div className="flex items-center gap-0.5 bg-zinc-900 p-0.5 rounded border border-white/5">
                                      <button
                                        type="button"
                                        onClick={() => setRetopoOutputMode('QUAD_DOMINANT')}
                                        className={`px-1 py-0.2 rounded text-[6.5px] font-bold transition-all ${
                                          retopoOutputMode === 'QUAD_DOMINANT' ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title="Quads Dominantes (conserva quads con algunos triángulos de transición)"
                                      >
                                        Quads
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRetopoOutputMode('PURE_QUADS')}
                                        className={`px-1 py-0.2 rounded text-[6.5px] font-bold transition-all ${
                                          retopoOutputMode === 'PURE_QUADS' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title="100% Quads puros sin ninguna cara triangular"
                                      >
                                        100% Quads
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setRetopoOutputMode('TRIANGLES')}
                                        className={`px-1 py-0.2 rounded text-[6.5px] font-bold transition-all ${
                                          retopoOutputMode === 'TRIANGLES' ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                        title="Triángulos isótropos estándar"
                                      >
                                        Tris
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <label className="flex items-center gap-1.5 text-[7.5px] text-blue-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={retopoPruneAir}
                                onChange={e => setRetopoPruneAir(e.target.checked)}
                                className="w-3 h-3 accent-blue-500 rounded cursor-pointer"
                              />
                              <span>Podar telas y membranas en el aire (solo bípedos/personajes)</span>
                            </label>
                            {!retopoPruneAir ? (
                              <div className="text-[7px] text-emerald-400 font-medium flex items-center gap-1 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                <span>🛡️ Modo Sólido Continuo: 100% estanco y sin huecos (ideal para evitar telarañas en extremidades).</span>
                              </div>
                            ) : null}
                            {retopoPruneAir && (
                              <div className="grid grid-cols-3 gap-1 pt-0.5">
                                {[
                                  { id: 'conservative', label: '🛡️ Conservador', desc: 'Cero huecos (Estrellas)' },
                                  { id: 'balanced', label: '⚖️ Equilibrado', desc: 'Recomendado' },
                                  { id: 'aggressive', label: '⚡ Agresivo', desc: 'Separar patas' }
                                ].map(s => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => {
                                      setRetopoAirSensitivity(s.id as any);
                                      if (s.id === 'conservative') {
                                        setRetopoMaxStretchRatio(3.5);
                                        setRetopoAirDistThreshold(0.055);
                                      } else if (s.id === 'aggressive') {
                                        setRetopoMaxStretchRatio(2.0);
                                        setRetopoAirDistThreshold(0.025);
                                      } else {
                                        setRetopoMaxStretchRatio(2.6);
                                        setRetopoAirDistThreshold(0.035);
                                      }
                                    }}
                                    className={`py-1 px-1 rounded text-[7.5px] font-bold text-center cursor-pointer transition-all ${
                                      retopoAirSensitivity === s.id
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/5'
                                    }`}
                                    title={s.desc}
                                  >
                                    <div>{s.label}</div>
                                    <div className="text-[6px] font-normal opacity-80">{s.desc}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                            <label className="flex items-center gap-1.5 text-[7.5px] text-blue-300/80 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={retopoAggressiveAir}
                                onChange={e => setRetopoAggressiveAir(e.target.checked)}
                                disabled={!retopoPruneAir}
                                className="w-3 h-3 accent-blue-500 rounded cursor-pointer disabled:opacity-40"
                              />
                              <span>Poda agresiva de chasms (elimina cortinas entre extremidades)</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-[7.5px] text-amber-300/90 cursor-pointer pt-0.5">
                              <input
                                type="checkbox"
                                checked={retopoPreserveCreases}
                                onChange={e => setRetopoPreserveCreases(e.target.checked)}
                                className="w-3 h-3 accent-amber-500 rounded cursor-pointer"
                              />
                              <span>Preservar ángulos vivos y caras planas (Hard-Surface)</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-[7.5px] text-cyan-300/90 cursor-pointer pt-0.5">
                              <input
                                type="checkbox"
                                checked={retopoSubdivideStretchedEdges}
                                onChange={e => setRetopoSubdivideStretchedEdges(e.target.checked)}
                                className="w-3 h-3 accent-cyan-500 rounded cursor-pointer"
                              />
                              <span>Subdivisión adaptativa de aristas estiradas (picos y valles vivos)</span>
                            </label>
                            <div className="flex items-center justify-between py-1 px-1.5 bg-zinc-900/80 rounded border border-white/5">
                              <span className="text-[7.5px] text-zinc-300 font-bold flex items-center gap-1">
                                <span>Sombreado:</span>
                              </span>
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => setRetopoShadingMode('FLAT')}
                                  className={`px-1.5 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                    retopoShadingMode === 'FLAT'
                                      ? 'bg-amber-600 text-white shadow-xs'
                                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                  title="Facetado nítido: planos matemáticamente perfectos y aristas vivas (ideal para dodecaedros, cubos, poliedros y estrellas)"
                                >
                                  Facetado
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRetopoShadingMode('SMOOTH')}
                                  className={`px-1.5 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                    retopoShadingMode === 'SMOOTH'
                                      ? 'bg-blue-600 text-white shadow-xs'
                                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                  title="Sombreado suave interpolado (ideal para esferas, cabezas, personajes y formas orgánicas)"
                                >
                                  Suave
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRetopoShadingMode('AUTO')}
                                  className={`px-1.5 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                    retopoShadingMode === 'AUTO'
                                      ? 'bg-cyan-600 text-white shadow-xs'
                                      : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                  }`}
                                  title="Heredar del objeto original automáticamente"
                                >
                                  Auto
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center justify-between py-1 px-1.5 bg-zinc-900/80 rounded border border-white/5">
                              <div className="flex flex-col">
                                <span className="text-[7.5px] text-zinc-300 font-bold flex items-center gap-1" title="Alineación de Normales: Penaliza caras que miren hacia otro lado para que los quads abracen filos agudos sin saltar ni crear huecos">
                                  <span>Alineación Normales:</span>
                                  <span className="text-[6.5px] text-cyan-400 font-mono font-normal">
                                    {retopoNormalWeight === 0 ? 'Off (0%)' : `${Math.round(retopoNormalWeight * 100)}%`}
                                  </span>
                                </span>
                                <span className="text-[6px] text-zinc-500">Evita saltos y huecos en ángulos agudos</span>
                              </div>
                              <div className="flex items-center gap-0.5">
                                {[
                                  { label: 'Off', val: 0, title: 'Euclídeo puro (sin ponderar orientación de normales)' },
                                  { label: '35%', val: 0.35, title: 'Alineación moderada' },
                                  { label: '75% ★', val: 0.75, title: 'Recomendado: ideal para ángulos agudos, aristas vivas y pliegues' },
                                  { label: '100%', val: 1.0, title: 'Estricto: máxima coincidencia normal' }
                                ].map(nw => (
                                  <button
                                    key={nw.val}
                                    type="button"
                                    onClick={() => setRetopoNormalWeight(nw.val)}
                                    className={`px-1 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                      Math.abs(retopoNormalWeight - nw.val) < 0.05
                                        ? 'bg-indigo-600 text-white shadow-xs'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                    }`}
                                    title={nw.title}
                                  >
                                    {nw.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-white/5">
                              <div className="flex items-center justify-between">
                                <span className="text-[7.5px] text-zinc-400">Pases (Iteraciones):</span>
                                <div className="flex items-center gap-1">
                                  {[3, 4, 6].map(it => (
                                    <button
                                      key={it}
                                      type="button"
                                      onClick={() => setRetopoIterations(it)}
                                      className={`px-1.5 py-0.5 rounded text-[7.5px] font-bold cursor-pointer transition-all ${
                                        retopoIterations === it
                                          ? 'bg-blue-600 text-white shadow-xs'
                                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                      }`}
                                    >
                                      {it}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[7.5px] text-zinc-400">Relajación:</span>
                                <div className="flex items-center gap-1">
                                  {[
                                    { val: 0.12, label: 'Suave' },
                                    { val: 0.18, label: 'Media' },
                                    { val: 0.28, label: 'Alta' }
                                  ].map(rel => (
                                    <button
                                      key={rel.val}
                                      type="button"
                                      onClick={() => setRetopoRelaxation(rel.val)}
                                      className={`px-1 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                        Math.abs(retopoRelaxation - rel.val) < 0.02
                                          ? 'bg-cyan-600 text-white shadow-xs'
                                          : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                      }`}
                                    >
                                      {rel.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => handleCreateWrapperCage(retopoCageSubdivs, retopoCageShape, retopoHeightSubdivs)}
                          className="py-1 bg-zinc-800 hover:bg-zinc-700 border border-blue-500/30 text-blue-200 rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                        >
                          <Box size={10} />
                          <span>Solo Crear Cage</span>
                        </button>
                        <button
                          type="button"
                          disabled={isApplyingVacuum}
                          onClick={async () => {
                            setIsApplyingVacuum(true);
                            try {
                              const targetObjForWrap = effectiveTarget;
                              let cageObjId: string;

                              if (isCurrentObjCage) {
                                const cageParams = (obj.parameters as any) || {};
                                const shapeChanged = cageParams.cageShape && cageParams.cageShape !== retopoCageShape;
                                const subdivsChanged = cageParams.subdivisions && cageParams.subdivisions !== retopoCageSubdivs;
                                const heightChanged = retopoHeightSubdivs > 0 && cageParams.heightSubdivisions && cageParams.heightSubdivisions !== retopoHeightSubdivs;

                                if (shapeChanged || subdivsChanged || heightChanged) {
                                  removeObject(obj.id);
                                  const newObj = createRetopoCage({
                                    targetObj: targetObjForWrap,
                                    subdivisions: retopoCageSubdivs,
                                    heightSubdivisions: retopoHeightSubdivs > 0 ? retopoHeightSubdivs : undefined,
                                    marginFactor: 1.08,
                                    shape: retopoCageShape
                                  });
                                  addObject(newObj);
                                  selectObject(newObj.id);
                                  cageObjId = newObj.id;
                                } else {
                                  cageObjId = obj.id;
                                }
                              } else {
                                const existingCage = project.objects.find(o =>
                                  (o.parameters as any)?.isWrapperCage && (o.parameters as any)?.targetId === targetObjForWrap.id
                                );
                                if (existingCage) {
                                  cageObjId = existingCage.id;
                                  selectObject(cageObjId);
                                } else {
                                  const newObj = createRetopoCage({
                                    targetObj: targetObjForWrap,
                                    subdivisions: retopoCageSubdivs,
                                    heightSubdivisions: retopoHeightSubdivs > 0 ? retopoHeightSubdivs : undefined,
                                    marginFactor: 1.08,
                                    shape: retopoCageShape
                                  });
                                  addObject(newObj);
                                  selectObject(newObj.id);
                                  cageObjId = newObj.id;
                                }
                              }

                              setShrinkTargetId(targetObjForWrap.id);
                              await applySilhouetteVacuumWrapToObject(cageObjId, targetObjForWrap.id, {
                                autoSubdivide: false,
                                iterations: retopoIterations,
                                relaxation: retopoRelaxation,
                                offset: shrinkwrapOffset,
                                clampToRayHitsOnly: false,
                                pruneAirFaces: retopoPruneAir,
                                sensitivity: retopoAirSensitivity,
                                airDistanceThreshold: retopoAirDistThreshold,
                                maxStretchRatio: retopoMaxStretchRatio,
                                autoFillHoles: !retopoPruneAir,
                                aggressivePruning: retopoAggressiveAir,
                                optimizeTopology: retopoAutoOptimize,
                                reductionRatio: retopoOptimizationRatio,
                                preserveCreases: retopoPreserveCreases,
                                creaseAngleDeg: retopoCreaseAngleDeg,
                                outputTopology: retopoOutputMode,
                                snapPlanarFaces: true,
                                snapSharpFeatures: true,
                                antiRounding: true,
                                subdivideStretchedEdges: retopoSubdivideStretchedEdges,
                                smoothShading: retopoShadingMode === 'AUTO' ? undefined : (retopoShadingMode === 'SMOOTH'),
                                normalAlignmentWeight: retopoNormalWeight
                              });
                            } catch (err) {
                              console.error('Error auto wrapping 360:', err);
                              alert('Ocurrió un error al envolver la silueta 360.');
                            } finally {
                              setIsApplyingVacuum(false);
                            }
                          }}
                          className="py-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 text-white rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all shadow-md active:scale-95"
                        >
                          <Sparkles size={10} />
                          <span>✨ Envolver 360°</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Target Object Selector or Empty State Helper */}
                  {availableTargets.length === 0 ? (
                    <div className="space-y-1.5 p-2 bg-amber-950/40 border border-amber-500/40 rounded-lg text-amber-200">
                      <div className="flex items-center gap-1.5 font-bold text-[9px] text-amber-300">
                        <AlertCircle size={13} className="text-amber-400 shrink-0" />
                        <span>Requiere una malla de referencia (High-Poly)</span>
                      </div>
                      <p className="text-[8px] text-amber-200/90 leading-tight">
                        Usa el botón superior para generar un Plano Retopo Quads sobre este modelo. El plano se creará ya adaptado a las dimensiones de tu figura.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[8.5px] text-zinc-400 font-semibold">Malla Destino (High-Poly):</span>
                        {resolvedTarget && (
                          <span className="text-[8px] font-mono text-cyan-300 bg-cyan-950/80 px-1 py-0.2 rounded border border-cyan-500/30 truncate max-w-[130px]">
                            {resolvedTarget.name || resolvedTarget.id}
                          </span>
                        )}
                      </div>
                      <select
                        value={shrinkTargetId || (resolvedTarget ? resolvedTarget.id : '')}
                        onChange={e => setShrinkTargetId(e.target.value)}
                        className="w-full bg-zinc-900 border border-white/10 rounded px-2 py-1 text-[9px] text-zinc-200 focus:border-cyan-400 outline-none"
                      >
                        {availableTargets.map(o => (
                          <option key={o.id} value={o.id}>{o.name || `Objeto ${o.id.slice(0, 6)}`}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Mode Selector */}
                  <div className="space-y-1">
                    <span className="text-[8.5px] text-zinc-400 font-semibold">Modo de Ajuste (Shrinkwrap Mode):</span>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { id: 'NEAREST_SURFACE_POINT', label: 'Punto Más Cercano' },
                        { id: 'PROJECT', label: 'Proyectar (Ejes)' },
                        { id: 'NEAREST_VERTEX', label: 'Vértice Cercano' },
                        { id: 'TARGET_NORMAL_PROJECT', label: 'Normales Destino' }
                      ].map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setShrinkwrapMode(m.id as ShrinkwrapMode)}
                          className={`py-1 px-1.5 rounded text-[8.5px] font-medium transition-colors cursor-pointer text-center ${
                            shrinkwrapMode === m.id
                              ? 'bg-cyan-600 text-white font-bold shadow-sm'
                              : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-white/5'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* If Mode is PROJECT: axis and direction */}
                  {shrinkwrapMode === 'PROJECT' && (
                    <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-zinc-900/60 rounded border border-white/5">
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-zinc-400">Eje de Proyección:</span>
                        <div className="flex gap-1">
                          {(['X', 'Y', 'Z'] as const).map(axis => (
                            <button
                              key={axis}
                              type="button"
                              onClick={() => setShrinkwrapProjectAxis(axis)}
                              className={`flex-1 py-0.5 text-[8.5px] font-mono font-bold rounded cursor-pointer ${
                                shrinkwrapProjectAxis === axis ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {axis}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[8px] text-zinc-400">Dirección:</span>
                        <div className="flex gap-1">
                          {[
                            { id: 'BOTH', label: '+/-' },
                            { id: 'POSITIVE', label: '+' },
                            { id: 'NEGATIVE', label: '-' }
                          ].map(d => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setShrinkwrapProjectDir(d.id as any)}
                              className={`flex-1 py-0.5 text-[8.5px] font-mono font-bold rounded cursor-pointer ${
                                shrinkwrapProjectDir === d.id ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Offset Slider */}
                  <div className="space-y-1 bg-zinc-900/60 p-1.5 rounded border border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-[8.5px] text-zinc-300 font-semibold">Offset (Desplazamiento Z):</span>
                      <span className="text-[8.5px] font-mono text-cyan-300 font-bold">{shrinkwrapOffset}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.02}
                      step={0.0005}
                      value={shrinkwrapOffset}
                      onChange={e => setShrinkwrapOffset(parseFloat(e.target.value))}
                      className="w-full h-1.5 accent-cyan-400 bg-zinc-800 rounded cursor-pointer"
                    />
                    <div className="flex justify-between gap-1 pt-0.5">
                      {[0, 0.001, 0.002, 0.005, 0.01].map(off => (
                        <button
                          key={off}
                          type="button"
                          onClick={() => setShrinkwrapOffset(off)}
                          className={`flex-1 py-0.5 text-[7.5px] font-mono rounded cursor-pointer ${
                            shrinkwrapOffset === off ? 'bg-cyan-600 text-white font-bold' : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {off}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Only Selected Vertices checkbox */}
                  {editMode === 'VERTEX' && (
                    <label className="flex items-center justify-between gap-2 p-1.5 bg-zinc-900/60 rounded border border-white/5 cursor-pointer">
                      <span className="text-[8.5px] text-zinc-300">Aplicar solo a vértices seleccionados</span>
                      <input
                        type="checkbox"
                        checked={shrinkwrapOnlySelected}
                        onChange={e => setShrinkwrapOnlySelected(e.target.checked)}
                        className="w-3.5 h-3.5 accent-cyan-500 rounded cursor-pointer"
                      />
                    </label>
                  )}

                  {/* Vacuum / Deep Silhouette Shrinkwrap Action Card */}
                  <div className="p-2.5 bg-gradient-to-br from-cyan-950/80 via-blue-950/70 to-indigo-950/80 border-2 border-cyan-400/80 rounded-lg space-y-2.5 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-[9.5px] text-cyan-200">
                        <Sparkles size={13} className="text-cyan-400 animate-pulse" />
                        <span>✨ Ajustar a Silueta Completa (Vacuum Wrap)</span>
                      </div>
                      <span className="text-[7.5px] bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 px-1.5 py-0.5 rounded font-mono font-bold">
                        Anti-Huecos
                      </span>
                    </div>

                    <p className="text-[8px] text-cyan-100/90 leading-relaxed">
                      Succión profunda al vacío por contracción iterativa (5 pasadas con relajación Laplaciana). Si la malla tiene pocas caras (ej. 480 caras), <b>la subdivide automáticamente para alcanzar miles de vértices</b> y ceñirse entre las patas, bajo el vientre, cuello y silueta completa sin agujeros.
                    </p>

                    {/* Controles de Poda y Prevención de Huecos */}
                    <div className="p-2 bg-black/40 border border-cyan-500/30 rounded-md space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[8.5px] font-bold text-cyan-300">Poda de Telas en el Aire:</span>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={retopoPruneAir}
                            onChange={e => setRetopoPruneAir(e.target.checked)}
                            className="w-3.5 h-3.5 accent-cyan-400 rounded cursor-pointer"
                          />
                          <span className="text-[8px] text-cyan-200 font-mono font-bold">{retopoPruneAir ? 'ACTIVA' : 'OFF'}</span>
                        </label>
                      </div>

                      {retopoPruneAir && (
                        <div className="space-y-1.5 pt-0.5">
                          {/* Sensibilidad / Modo */}
                          <div className="grid grid-cols-3 gap-1">
                            {[
                              { id: 'conservative', label: '🛡️ Conservador', sub: 'Cero Huecos' },
                              { id: 'balanced', label: '⚖️ Equilibrado', sub: 'Recomendado' },
                              { id: 'aggressive', label: '⚡ Agresivo', sub: 'Separar Patas' }
                            ].map(s => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  setRetopoAirSensitivity(s.id as any);
                                  if (s.id === 'conservative') {
                                    setRetopoMaxStretchRatio(3.5);
                                    setRetopoAirDistThreshold(0.055);
                                  } else if (s.id === 'aggressive') {
                                    setRetopoMaxStretchRatio(2.0);
                                    setRetopoAirDistThreshold(0.025);
                                  } else {
                                    setRetopoMaxStretchRatio(2.6);
                                    setRetopoAirDistThreshold(0.035);
                                  }
                                }}
                                className={`py-1 px-0.5 rounded text-[7.5px] font-bold text-center cursor-pointer transition-all ${
                                  retopoAirSensitivity === s.id
                                    ? 'bg-cyan-600 text-white shadow-sm'
                                    : 'bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-white/5'
                                }`}
                              >
                                <div>{s.label}</div>
                                <div className="text-[6.5px] font-normal opacity-80">{s.sub}</div>
                              </button>
                            ))}
                          </div>

                          {/* Sliders de ajuste fino */}
                          <div className="space-y-1 pt-0.5">
                            <div className="flex items-center justify-between text-[7.5px] text-zinc-300">
                              <span>Sensibilidad / Umbral Aire:</span>
                              <span className="font-mono text-cyan-300 font-bold">{retopoAirDistThreshold.toFixed(3)}</span>
                            </div>
                            <input
                              type="range"
                              min={0.01}
                              max={0.08}
                              step={0.005}
                              value={retopoAirDistThreshold}
                              onChange={e => setRetopoAirDistThreshold(parseFloat(e.target.value))}
                              className="w-full h-1 accent-cyan-400 bg-zinc-800 rounded cursor-pointer"
                            />

                            <div className="flex items-center justify-between text-[7.5px] text-zinc-300 pt-0.5">
                              <span>Estiramiento Máx. Aristas:</span>
                              <span className="font-mono text-cyan-300 font-bold">{retopoMaxStretchRatio.toFixed(1)}x</span>
                            </div>
                            <input
                              type="range"
                              min={1.6}
                              max={4.0}
                              step={0.1}
                              value={retopoMaxStretchRatio}
                              onChange={e => setRetopoMaxStretchRatio(parseFloat(e.target.value))}
                              className="w-full h-1 accent-cyan-400 bg-zinc-800 rounded cursor-pointer"
                            />
                          </div>

                          {/* Auto-sellar huecos checkbox */}
                          <label className="flex items-center justify-between gap-1.5 p-1 bg-zinc-900/80 rounded border border-white/5 cursor-pointer">
                            <span className="text-[7.5px] text-zinc-300">Auto-sellar aberturas y huecos al podar</span>
                            <input
                              type="checkbox"
                              checked={retopoAutoFillHoles}
                              onChange={e => setRetopoAutoFillHoles(e.target.checked)}
                              className="w-3.5 h-3.5 accent-emerald-500 rounded cursor-pointer"
                            />
                          </label>

                          {/* Subdivisión adaptativa de aristas estiradas */}
                          <label className="flex items-center justify-between gap-1.5 p-1 bg-zinc-900/80 rounded border border-white/5 cursor-pointer">
                            <span className="text-[7.5px] text-cyan-300 font-semibold">Subdivisión adaptativa de aristas (picos vivos)</span>
                            <input
                              type="checkbox"
                              checked={retopoSubdivideStretchedEdges}
                              onChange={e => setRetopoSubdivideStretchedEdges(e.target.checked)}
                              className="w-3.5 h-3.5 accent-cyan-500 rounded cursor-pointer"
                            />
                          </label>

                          {/* Iteraciones y Relajación */}
                          <div className="grid grid-cols-2 gap-1.5 p-1 bg-zinc-900/80 rounded border border-white/5">
                            <div className="flex items-center justify-between">
                              <span className="text-[7.5px] text-zinc-400">Pases:</span>
                              <div className="flex items-center gap-1">
                                {[3, 4, 6].map(it => (
                                  <button
                                    key={it}
                                    type="button"
                                    onClick={() => setRetopoIterations(it)}
                                    className={`px-1.5 py-0.5 rounded text-[7.5px] font-bold cursor-pointer transition-all ${
                                      retopoIterations === it
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                    }`}
                                  >
                                    {it}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[7.5px] text-zinc-400">Relajación:</span>
                              <div className="flex items-center gap-1">
                                {[
                                  { val: 0.12, label: 'Suave' },
                                  { val: 0.18, label: 'Media' },
                                  { val: 0.28, label: 'Alta' }
                                ].map(rel => (
                                  <button
                                    key={rel.val}
                                    type="button"
                                    onClick={() => setRetopoRelaxation(rel.val)}
                                    className={`px-1 py-0.5 rounded text-[7px] font-bold cursor-pointer transition-all ${
                                      Math.abs(retopoRelaxation - rel.val) < 0.02
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                                    }`}
                                  >
                                    {rel.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isApplyingVacuum || isApplyingShrinkwrap}
                      onClick={async () => {
                        const targetObj = resolvedTarget || availableTargets[0];
                        if (!targetObj) {
                          alert('Para ajustar la silueta se requiere una malla objetivo (High-Poly) sobre la cual proyectar los vértices.');
                          return;
                        }

                        setIsApplyingVacuum(true);
                        try {
                          await applySilhouetteVacuumWrapToObject(obj.id, targetObj.id, {
                            autoSubdivide: false,
                            iterations: retopoIterations,
                            relaxation: retopoRelaxation,
                            offset: shrinkwrapOffset,
                            clampToRayHitsOnly: retopoClampRayHits,
                            pruneAirFaces: retopoPruneAir,
                            sensitivity: retopoAirSensitivity,
                            airDistanceThreshold: retopoAirDistThreshold,
                            maxStretchRatio: retopoMaxStretchRatio,
                            autoFillHoles: retopoPruneAir ? false : retopoAutoFillHoles,
                            aggressivePruning: retopoAirSensitivity === 'aggressive',
                            optimizeTopology: retopoAutoOptimize,
                            reductionRatio: retopoOptimizationRatio,
                            preserveCreases: retopoPreserveCreases,
                            creaseAngleDeg: retopoCreaseAngleDeg,
                            outputTopology: retopoOutputMode,
                            snapPlanarFaces: true,
                            snapSharpFeatures: true,
                            antiRounding: true,
                            subdivideStretchedEdges: retopoSubdivideStretchedEdges,
                            normalAlignmentWeight: retopoNormalWeight
                          });
                        } catch (err) {
                          console.error('Error applying vacuum shrinkwrap:', err);
                          alert('Ocurrió un error al ceñir la silueta completa.');
                        } finally {
                          setIsApplyingVacuum(false);
                        }
                      }}
                      className="w-full py-2 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded font-bold text-[9.5px] flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                    >
                      <Sparkles size={12} />
                      <span>{isApplyingVacuum ? 'Ajustando y Succionando Silueta...' : 'Ceñir a Silueta Completa Ahora'}</span>
                    </button>

                    <div className="grid grid-cols-3 gap-1 pt-0.5">
                      <button
                        type="button"
                        disabled={isApplyingVacuum || isApplyingShrinkwrap || isPruningAir}
                        onClick={async () => {
                          const targetObj = resolvedTarget || availableTargets[0];
                          if (!targetObj) {
                            alert('Selecciona una malla objetivo (High-Poly) para detectar qué caras están suspendidas en el aire.');
                            return;
                          }

                          setIsPruningAir(true);
                          try {
                            let cageObjId = obj.id;
                            let highPolyId = targetObj.id;
                            // Si el usuario tiene seleccionada la estrella o modelo original en vez de la jaula de envoltura:
                            if (!obj.name.toLowerCase().includes('cage') && !obj.name.toLowerCase().includes('envoltura')) {
                              const allObjs = useStore.getState().project.objects;
                              const matchingCage = allObjs.find(o => o.id !== obj.id && (o.name.toLowerCase().includes('cage') || o.name.toLowerCase().includes('envoltura')));
                              if (matchingCage) {
                                cageObjId = matchingCage.id;
                                highPolyId = obj.id;
                              }
                            }

                            await pruneAirBridgingFacesToObject(cageObjId, highPolyId, {
                              sensitivity: retopoAirSensitivity,
                              airDistanceThreshold: retopoAirDistThreshold,
                              maxStretchRatio: retopoMaxStretchRatio,
                              autoFillHoles: retopoAutoFillHoles,
                              offset: shrinkwrapOffset
                            });
                          } catch (err) {
                            console.error('Error podando caras en el aire:', err);
                            alert('Ocurrió un error al podar las membranas flotantes.');
                          } finally {
                            setIsPruningAir(false);
                          }
                        }}
                        className="py-1.5 px-1 bg-amber-950/70 hover:bg-amber-900/90 text-amber-200 border border-amber-500/60 rounded font-bold text-[7.5px] flex items-center justify-center gap-0.5 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                        title="Elimina telas y membranas suspendidas en el aire respetando la superficie y sin crear agujeros"
                      >
                        <Scissors size={10} className="text-amber-400 shrink-0" />
                        <span>{isPruningAir ? 'Podando...' : '✂️ Podar Telas'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isCleaningSpikes}
                        onClick={async () => {
                          const targetObj = resolvedTarget || availableTargets[0];
                          setIsCleaningSpikes(true);
                          try {
                            await cleanSpikesObject(obj.id, targetObj?.id);
                          } catch (err) {
                            console.error('Error limpiando espinas:', err);
                          } finally {
                            setIsCleaningSpikes(false);
                          }
                        }}
                        className="py-1.5 px-1 bg-indigo-950/70 hover:bg-indigo-900/90 text-indigo-200 border border-indigo-500/60 rounded font-bold text-[7.5px] flex items-center justify-center gap-0.5 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                        title="Elimina rebabas, triángulos filosos o en aguja y caras invertidas suavizando el corte"
                      >
                        <Sparkles size={10} className="text-indigo-400 shrink-0" />
                        <span>{isCleaningSpikes ? 'Limpiando...' : '🧹 Limpiar Espinas'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isFillingHoles}
                        onClick={async () => {
                          setIsFillingHoles(true);
                          try {
                            await fillHolesObject(obj.id);
                          } catch (err) {
                            console.error('Error tapando huecos:', err);
                          } finally {
                            setIsFillingHoles(false);
                          }
                        }}
                        className="py-1.5 px-1 bg-emerald-950/70 hover:bg-emerald-900/90 text-emerald-200 border border-emerald-500/60 rounded font-bold text-[7.5px] flex items-center justify-center gap-0.5 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                        title="Cierra y triangula automáticamente todos los agujeros o bordes abiertos de la malla"
                      >
                        <span>{isFillingHoles ? 'Sellando...' : '🕳️ Tapar Huecos'}</span>
                      </button>
                    </div>

                    {/* Reparación de Caras Malas, Invertidas y Normales */}
                    <div className="p-2 bg-gradient-to-br from-amber-950/40 via-red-950/30 to-zinc-900/60 border border-amber-500/50 rounded-lg space-y-1.5 mt-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-[8.5px] text-amber-200">
                          <AlertCircle size={11} className="text-amber-400" />
                          <span>Reparación de Caras Malas & Normales</span>
                        </div>
                        <span className="text-[7px] text-amber-300/80 font-mono font-bold px-1 py-0.5 rounded bg-amber-950/80 border border-amber-500/30">
                          1-Click Fix
                        </span>
                      </div>
                      <p className="text-[7.5px] text-zinc-300 leading-tight">
                        Elimina caras montadas, huecos degenerados y unifica orientación de normales para evitar triángulos negros, sombreados arrugados y distorsiones.
                      </p>

                      <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => repairNormalsObject(obj.id, { creaseAngleDeg: 35, snapPlanar: true })}
                          className="py-1.5 px-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                          title="Elimina caras duplicadas, orienta normales invertidas y recalcula aristas vivas limpias"
                        >
                          <Sparkles size={10} className="shrink-0" />
                          <span>Reparar Caras & Normales</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => repairHardSurfaceObject(obj.id, { creaseAngleDeg: 35, planarToleranceDeg: 12 })}
                          className="py-1.5 px-1.5 bg-gradient-to-r from-cyan-700 to-blue-700 hover:from-cyan-600 hover:to-blue-600 text-white rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                          title="Aplanar alas y paneles eliminando ondulaciones y arrugas diagonales de polígonos"
                        >
                          <Shield size={10} className="shrink-0" />
                          <span>Aplanar Paneles Hard-Surface</span>
                        </button>
                      </div>

                      {/* Botón 1-Clic: Transformación a Estilo Low-Poly Blueprint / Sci-Fi Holograma */}
                      {obj.blueprintStyle ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => applyLowPolyBlueprint(obj.id, { creaseAngleDeg: 20.0 })}
                            className="flex-1 py-1.5 px-2 bg-gradient-to-r from-cyan-700 to-blue-700 hover:from-cyan-600 hover:to-blue-600 text-white rounded font-bold text-[8.5px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm border border-cyan-400/30"
                            title="Re-aplicar optimización blueprint"
                          >
                            <Sparkles size={10} className="shrink-0 text-cyan-200" />
                            <span>Re-aplicar Blueprint</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBlueprintStyle(obj.id)}
                            className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 border border-zinc-700"
                            title="Restaurar apariencia y material original"
                          >
                            <RotateCcw size={9} className="shrink-0" />
                            <span>Desactivar</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <button
                            type="button"
                            onClick={() => applyLowPolyBlueprint(obj.id, { creaseAngleDeg: 20.0 })}
                            className="w-full py-2 px-2.5 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 text-white rounded-md font-extrabold text-[9px] flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-md border border-cyan-400/40 text-center tracking-wide"
                            title="1 Clic: Decimate a Low-Poly + Limited Dissolve + Extracción de Aristas de Pliegue (>20°) + Sombreado Blueprint Técnico"
                          >
                            <Sparkles size={11} className="shrink-0 text-cyan-200 animate-pulse" />
                            <span>✨ Estilo Low-Poly Blueprint (1 Clic)</span>
                          </button>
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              type="button"
                              onClick={() => applyLowPolyBlueprint(obj.id, { targetFaceRatio: 0.15, creaseAngleDeg: 20.0 })}
                              className="py-1 px-1.5 bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-700/50 rounded font-bold text-[7.5px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 text-center"
                              title="Transformación agresiva a Low-Poly conservando el 15% de caras"
                            >
                              <Zap size={9} className="shrink-0 text-cyan-400" />
                              <span>Low-Poly Puro (15%)</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => applyDecimateModifier(obj.id, { mode: 'COLLAPSE', ratio: 0.20 })}
                              className="py-1 px-1.5 bg-amber-950/80 hover:bg-amber-900/90 text-amber-300 border border-amber-700/50 rounded font-bold text-[7.5px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 text-center"
                              title="Decimar directamente la malla al 20% de caras"
                            >
                              <Scissors size={9} className="shrink-0 text-amber-400" />
                              <span>Decimar (20% caras)</span>
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => dissolveCoplanarObject(obj.id, 15.0, { protectUVSeams: false })}
                          className="w-full py-1.5 px-1.5 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 text-white rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 shadow-sm text-center"
                          title="Elimina todos los triángulos internos y diagonales en superficies planas (alas, paneles) fusionándolos en planos limpios"
                        >
                          <Layers size={10} className="shrink-0 text-emerald-200" />
                          <span>🧹 Limpiar Planos (15°)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => dissolveCoplanarObject(obj.id, 5.0, { protectUVSeams: true })}
                          className="w-full py-1.5 px-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded font-bold text-[8px] flex items-center justify-center gap-1 cursor-pointer transition-all active:scale-95 border border-zinc-700 text-center"
                          title="Disolución estricta (5°) protegiendo estrictamente costuras UV"
                        >
                          <Layers size={10} className="shrink-0 text-zinc-400" />
                          <span>Disolver (5°)</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => flipObjectNormals(obj.id)}
                        className="w-full py-1 px-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/60 rounded text-[7.5px] font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Invierte la orientación de todas las caras si el modelo se ve transparente o invertido desde fuera"
                      >
                        <RotateCcw size={9} className="shrink-0" />
                        <span>Voltear Normales (Invertir Fuera / Dentro)</span>
                      </button>
                    </div>

                    {/* Optimización de Malla y Reducción Estructural de Polígonos */}
                    <div className="p-2 bg-gradient-to-br from-cyan-950/40 via-blue-950/30 to-zinc-900/60 border border-cyan-500/40 rounded-lg space-y-1.5 mt-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-[8.5px] text-cyan-200">
                          <Sparkles size={11} className="text-cyan-400" />
                          <span>Optimizar Malla (Reducir Polígonos)</span>
                        </div>
                        <span className="text-[7.5px] px-1.5 py-0.5 rounded bg-cyan-900/60 border border-cyan-400/30 text-cyan-300 font-mono font-bold">
                          {obj.faces?.length || obj.stats?.faces || 0} caras
                        </span>
                      </div>
                      <p className="text-[7.5px] text-zinc-300 leading-tight">
                        Reduce la densidad poligonal conservando el 100% de la forma y aristas vivas mediante simplificación geométrica adaptativa y reproyección al objetivo.
                      </p>

                      <div className="space-y-1 bg-black/40 p-1.5 rounded border border-white/5">
                        <div className="flex items-center justify-between text-[7px] text-zinc-300">
                          <span>Nivel de reducción:</span>
                          <span className="font-mono font-bold text-cyan-300">
                            {retopoOptimizationRatio === 0.5 ? '50% (Fiel)' : retopoOptimizationRatio === 0.35 ? '65% (Equilibrada ★)' : retopoOptimizationRatio === 0.2 ? '80% (Agresiva)' : '90% (Low-Poly)'}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { label: '50%', val: 0.5 },
                            { label: '65% ★', val: 0.35 },
                            { label: '80%', val: 0.2 },
                            { label: '90%', val: 0.1 }
                          ].map(preset => (
                            <button
                              key={preset.val}
                              type="button"
                              onClick={() => setRetopoOptimizationRatio(preset.val)}
                              className={`py-0.5 px-0.5 rounded text-[7px] font-mono font-bold transition-all cursor-pointer ${
                                retopoOptimizationRatio === preset.val
                                  ? 'bg-cyan-600 text-white shadow-sm ring-1 ring-cyan-400'
                                  : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-2 gap-1 pt-1">
                          <label className="flex items-center gap-1 text-[7px] text-zinc-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={retopoPreserveCreases}
                              onChange={e => setRetopoPreserveCreases(e.target.checked)}
                              className="w-3 h-3 accent-cyan-500 rounded cursor-pointer"
                            />
                            <span>Bloquear aristas vivas</span>
                          </label>

                          <label className="flex items-center gap-1 text-[7px] text-zinc-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={retopoReprojectTarget}
                              onChange={e => setRetopoReprojectTarget(e.target.checked)}
                              className="w-3 h-3 accent-cyan-500 rounded cursor-pointer"
                            />
                            <span>{resolvedTarget ? `Reproyectar a "${resolvedTarget.name.slice(0, 10)}"` : 'Reproyectar a forma original'}</span>
                          </label>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-white/5">
                          <span className="text-[7px] text-zinc-400">Topología:</span>
                          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-white/5">
                            <button
                              type="button"
                              onClick={() => setRetopoOutputMode('QUAD_DOMINANT')}
                              className={`px-1.5 py-0.5 rounded text-[7px] font-bold transition-all ${
                                retopoOutputMode === 'QUAD_DOMINANT' ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Quads
                            </button>
                            <button
                              type="button"
                              onClick={() => setRetopoOutputMode('PURE_QUADS')}
                              className={`px-1.5 py-0.5 rounded text-[7px] font-bold transition-all ${
                                retopoOutputMode === 'PURE_QUADS' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              100% Quads
                            </button>
                            <button
                              type="button"
                              onClick={() => setRetopoOutputMode('TRIANGLES')}
                              className={`px-1.5 py-0.5 rounded text-[7px] font-bold transition-all ${
                                retopoOutputMode === 'TRIANGLES' ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              Triángulos
                            </button>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isOptimizingMesh || isApplyingVacuum}
                        onClick={async () => {
                          setIsOptimizingMesh(true);
                          try {
                            const targetObj = resolvedTarget;
                            await optimizeConformedMeshToObject(obj.id, targetObj?.id, {
                              targetReductionRatio: retopoOptimizationRatio,
                              preserveCreases: retopoPreserveCreases,
                              creaseAngleDeg: retopoCreaseAngleDeg,
                              outputTopology: retopoOutputMode,
                              reprojectToTarget: retopoReprojectTarget,
                              offset: shrinkwrapOffset,
                              errorTolerance: 0.035
                            });
                          } catch (err) {
                            console.error('Error optimizando malla:', err);
                            alert('Ocurrió un error al optimizar la malla.');
                          } finally {
                            setIsOptimizingMesh(false);
                          }
                        }}
                        className="w-full py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white rounded font-bold text-[8.5px] flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                      >
                        <Sparkles size={11} />
                        <span>{isOptimizingMesh ? 'Optimizando Estructura...' : '⚡ Reducir Polígonos Ahora'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Standard 1-Pass Shrinkwrap Button & Helpers */}
                  <div className="flex flex-col gap-1 pt-1">
                    <button
                      type="button"
                      disabled={isApplyingShrinkwrap || isApplyingVacuum}
                      onClick={async () => {
                        const targetObj = resolvedTarget;
                        if (!targetObj) {
                          alert('Para usar Shrinkwrap se requiere una malla objetivo (High-Poly) sobre la cual proyectar los vértices.');
                          return;
                        }

                        setIsApplyingShrinkwrap(true);
                        try {
                          await applyShrinkwrapToObject(obj.id, targetObj.id, {
                            targetId: targetObj.id,
                            mode: shrinkwrapMode,
                            offset: shrinkwrapOffset,
                            projectAxis: shrinkwrapProjectAxis,
                            projectDirection: shrinkwrapProjectDir,
                            onlySelectedVertices: shrinkwrapOnlySelected
                          });
                        } catch (err) {
                          console.error('Error applying shrinkwrap:', err);
                          alert('Ocurrió un error al aplicar el modificador Shrinkwrap.');
                        } finally {
                          setIsApplyingShrinkwrap(false);
                        }
                      }}
                      className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-cyan-500/30 disabled:opacity-50 rounded text-[8.5px] font-bold text-cyan-200 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                    >
                      <Layers size={11} />
                      <span>{isApplyingShrinkwrap ? 'Envolviendo Malla...' : 'Aplicar Shrinkwrap Estándar (1 Pasada)'}</span>
                    </button>

                    <div className="grid grid-cols-2 gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => subdivideObject(obj.id)}
                        className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[7.5px] text-zinc-300 font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Subdivide la malla actual para añadir 4x caras y permitir mayor detalle de silueta"
                      >
                        <span>➕ Subdividir Malla (4x)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => regularizeObject(obj.id, 0.4, 2)}
                        className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded text-[7.5px] text-zinc-300 font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        title="Alisa y redistribuye los vértices para eliminar arrugas y suavizar la silueta"
                      >
                        <span>✨ Suavizar y Relajar</span>
                      </button>
                    </div>
                  </div>

                  {/* ── SECCIÓN: REMALLADO VOXEL (SDF + MARCHING CUBES - PIPELINE COMFY3D / MICHAEL GOLD) ── */}
                  <div className="p-2.5 bg-gradient-to-br from-indigo-950/40 via-purple-950/30 to-zinc-950/80 border border-indigo-500/40 rounded-lg space-y-2 mt-2 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-[9px] text-indigo-200">
                        <Layers size={12} className="text-indigo-400 animate-pulse" />
                        <span>🧬 Remallado Voxel (SDF + Anti-Redondeo)</span>
                      </div>
                      <span className="text-[7.5px] px-1.5 py-0.5 rounded bg-indigo-900/60 border border-indigo-400/30 text-indigo-300 font-mono font-bold">
                        100% Estanco
                      </span>
                    </div>

                    <p className="text-[7.5px] text-zinc-300 leading-tight">
                      Basado en el pipeline de <b>Michael Gold (Comfy3D / GeomPack)</b>: Rasteriza en campo SDF implícito, extrae isosuperficie con Marching Cubes, proyecta con BVH y <b>ancla las caras planas y puntas vivas</b> para evitar el redondeo.
                    </p>

                    <div className="space-y-1.5 bg-black/40 p-2 rounded border border-white/5">
                      {/* Presupuesto de caras */}
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-[7.5px] text-zinc-300">
                          <span>Presupuesto objetivo:</span>
                          <span className="font-mono font-bold text-indigo-300">{voxelTargetFaces} caras</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { label: '400', val: 400 },
                            { label: '800 ★', val: 800 },
                            { label: '1500', val: 1500 },
                            { label: '3000', val: 3000 }
                          ].map(p => (
                            <button
                              key={p.val}
                              type="button"
                              onClick={() => setVoxelTargetFaces(p.val)}
                              className={`py-0.5 rounded text-[7px] font-mono font-bold transition-all cursor-pointer ${
                                voxelTargetFaces === p.val
                                  ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Resolución Voxel */}
                      <div className="space-y-0.5 pt-0.5">
                        <div className="flex items-center justify-between text-[7.5px] text-zinc-300">
                          <span>Resolución del Voxel Grid:</span>
                          <span className="font-mono font-bold text-indigo-300">{voxelResolution}³ vóxeles</span>
                        </div>
                        <input
                          type="range"
                          min={24}
                          max={64}
                          step={4}
                          value={voxelResolution}
                          onChange={e => setVoxelResolution(parseInt(e.target.value))}
                          className="w-full h-1 accent-indigo-400 bg-zinc-800 rounded cursor-pointer"
                        />
                      </div>

                      {/* Claves Anti-Redondeo */}
                      <div className="space-y-1 pt-1 border-t border-white/5">
                        <label className="flex items-center gap-1.5 text-[7.5px] text-indigo-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={voxelPreserveSharp}
                            onChange={e => setVoxelPreserveSharp(e.target.checked)}
                            className="w-3.5 h-3.5 accent-indigo-500 rounded cursor-pointer"
                          />
                          <span className="font-medium">Bloquear Puntas y Esquinas Vivas (Anti-Redondeo)</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-[7.5px] text-indigo-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={voxelSnapPlanar}
                            onChange={e => setVoxelSnapPlanar(e.target.checked)}
                            className="w-3.5 h-3.5 accent-indigo-500 rounded cursor-pointer"
                          />
                          <span className="font-medium">Anclar Cara Superior/Inferior Plana (Cero Abombamiento)</span>
                        </label>
                      </div>

                      {/* Modo de salida */}
                      <div className="flex items-center justify-between pt-1 border-t border-white/5">
                        <span className="text-[7.5px] text-zinc-400">Flujo de Salida:</span>
                        <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded border border-white/5">
                          <button
                            type="button"
                            onClick={() => setVoxelOutputMode('QUAD_DOMINANT')}
                            className={`px-1.5 py-0.5 rounded text-[7px] font-bold transition-all ${
                              voxelOutputMode === 'QUAD_DOMINANT' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            Quads Dominantes
                          </button>
                          <button
                            type="button"
                            onClick={() => setVoxelOutputMode('TRIANGLES')}
                            className={`px-1.5 py-0.5 rounded text-[7px] font-bold transition-all ${
                              voxelOutputMode === 'TRIANGLES' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            Triángulos
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isVoxelRemeshing || isApplyingVacuum || isApplyingShrinkwrap}
                      onClick={async () => {
                        setIsVoxelRemeshing(true);
                        try {
                          await applyVoxelRemeshToObject(obj.id, {
                            targetFaces: voxelTargetFaces,
                            voxelResolution,
                            preserveSharpFeatures: voxelPreserveSharp,
                            snapPlanarFaces: voxelSnapPlanar,
                            outputTopology: voxelOutputMode
                          });
                        } catch (err) {
                          console.error('Error in voxel remesh:', err);
                          alert('Ocurrió un error al ejecutar el Remallado Voxel.');
                        } finally {
                          setIsVoxelRemeshing(false);
                        }
                      }}
                      className="w-full py-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 disabled:opacity-50 text-white rounded font-bold text-[9px] flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                    >
                      <Sparkles size={12} />
                      <span>{isVoxelRemeshing ? 'Rasterizando y Remallando Vóxeles...' : '🚀 Ejecutar Remallado Voxel Estanco'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 6. Modificador Solidify (Solidificar) */}
          <div className="space-y-2 bg-zinc-950/70 border border-emerald-500/40 p-2.5 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] text-emerald-300 font-bold flex items-center gap-1.5">
                <Box size={12} className="text-emerald-400" />
                <span>Modificador Solidify (Solidificar)</span>
              </span>
              <span className="text-[8px] bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 px-1 py-0.5 rounded font-mono font-bold">
                Grosor 3D
              </span>
            </div>
            <p className="text-[8px] text-zinc-400 leading-tight">
              Otorga grosor y profundidad física a mallas abiertas o láminas de retopología, cosiendo y sellando los bordes con caras laterales.
            </p>

            <NumRow label="Grosor" value={solidifyThickness} min={0.005} max={0.5} step={0.005} onChange={setSolidifyThickness} slider />
            <NumRow label="Offset (-1 a 1)" value={solidifyOffset} min={-1} max={1} step={0.1} onChange={setSolidifyOffset} slider />

            <button
              type="button"
              disabled={isSolidifying}
              onClick={async () => {
                setIsSolidifying(true);
                try {
                  await solidifyObject(obj.id, solidifyThickness, solidifyOffset);
                } finally {
                  setIsSolidifying(false);
                }
              }}
              className="w-full py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer flex items-center justify-center gap-1"
            >
              <Box size={11} />
              {isSolidifying ? 'Solidificando Malla...' : 'Aplicar Solidify (Dar Grosor)'}
            </button>
          </div>

          {/* 7. Disolver Caras Coplanares & Limpiar Ruido */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1.5 bg-zinc-950/70 border border-amber-500/30 p-2 rounded-lg flex flex-col justify-between shadow-sm">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] text-amber-300 font-bold tracking-tight">Disolver Planos</span>
                  <span className="text-[9px] font-mono font-bold bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded border border-amber-600/40">
                    {coplanarTolerance}°
                  </span>
                </div>
                <div className="text-[8px] text-amber-400/80 font-medium flex items-center gap-1">
                  <span>🛡️ Texturas UV & PBR 100% protegidas</span>
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  <input
                    type="range"
                    min={0.5}
                    max={40}
                    step={0.5}
                    value={coplanarTolerance}
                    onChange={(e) => setCoplanarTolerance(parseFloat(e.target.value))}
                    className="w-full h-1.5 accent-amber-500 bg-zinc-800 rounded cursor-pointer"
                  />
                </div>
                <div className="flex justify-between gap-1 pt-0.5">
                  {[2, 5, 10, 18, 30].map(deg => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => setCoplanarTolerance(deg)}
                      className={`flex-1 py-0.5 text-[8px] font-mono font-bold rounded transition-colors cursor-pointer ${
                        coplanarTolerance === deg
                          ? 'bg-amber-600 text-white'
                          : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => dissolveCoplanarObject(obj.id, coplanarTolerance, {
                  selectedMeshes: selectedGLTFMeshes.length > 0 ? selectedGLTFMeshes : undefined
                })}
                className="w-full py-1.5 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer mt-1"
                title="Limited Dissolve: Detecta caras triangulares contiguas que yacen en el mismo plano y las fusiona en N-gons limpios sin alterar texturas ni UVs"
              >
                🔷 Limited Dissolve (Disolver Planos)
              </button>
            </div>

            <div className="space-y-1.5 bg-zinc-950/70 border border-rose-500/30 p-2 rounded-lg flex flex-col justify-between shadow-sm">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9.5px] text-rose-300 font-bold tracking-tight">Quitar Islas / Ruido</span>
                  <span className="text-[9px] font-mono font-bold bg-rose-950/80 text-rose-300 px-1.5 py-0.5 rounded border border-rose-600/40">
                    {Math.round(islandRatio * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={Math.round(islandRatio * 100)}
                    onChange={(e) => setIslandRatio(parseFloat(e.target.value) / 100)}
                    className="w-full h-1.5 accent-rose-500 bg-zinc-800 rounded cursor-pointer"
                  />
                </div>
                <div className="flex justify-between gap-1 pt-0.5">
                  {[2, 5, 10, 15, 25].map(pct => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setIslandRatio(pct / 100)}
                      className={`flex-1 py-0.5 text-[8px] font-mono font-bold rounded transition-colors cursor-pointer ${
                        Math.round(islandRatio * 100) === pct
                          ? 'bg-rose-600 text-white'
                          : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <button
                  onClick={() => cleanIslandsObject(obj.id, islandRatio)}
                  className="w-full py-1.5 bg-gradient-to-r from-rose-700 to-rose-600 hover:from-rose-600 hover:to-rose-500 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Elimina fragmentos poligonales flotantes sin alterar partes funcionales ni orientación"
                >
                  🧹 Limpiar Islas 3D
                </button>
                <button
                  onClick={() => repairNormalsObject(obj.id)}
                  className="w-full py-1.5 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Elimina caras montadas/duplicadas superpuestas y unifica normales suaves para corregir texturas oscuras o grises"
                >
                  🔧 Reparar Caras/Normales
                </button>
              </div>
            </div>
          </div>

          {/* Tarjeta de Optimización de Curvas & Redondeados (Esferas, Tubos, Cilindros) */}
          <div className="space-y-2 bg-zinc-950/70 border border-cyan-500/30 p-2.5 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-[10px] text-cyan-300 font-bold tracking-tight">
                  Optimizar Curvas & Redondeados
                </span>
              </div>
              <span className="text-[9px] font-mono font-bold bg-cyan-950/80 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-600/40">
                {Math.round(curvedOptRatio * 100)}% ({Math.round((1 - curvedOptRatio) * 100)}% menos)
              </span>
            </div>
            
            <p className="text-[8.5px] text-zinc-400 leading-tight">
              Especial para esferas, tubos, cañones y curvaturas: decima pasos radiales redundantes preservando silueta y calcula normales ultra-suaves sin facetado.
            </p>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[9px] text-zinc-400">
                <span>Ratio de Polígonos Retenidos</span>
                <span className="font-mono text-cyan-300 font-bold">{Math.round(curvedOptRatio * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.90}
                step={0.05}
                value={curvedOptRatio}
                onChange={(e) => setCurvedOptRatio(parseFloat(e.target.value))}
                className="w-full h-1.5 accent-cyan-500 bg-zinc-800 rounded cursor-pointer"
              />
              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {[0.20, 0.40, 0.60, 0.80].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setCurvedOptRatio(r)}
                    className={`py-0.5 text-[8px] font-mono font-bold rounded transition-colors cursor-pointer ${
                      curvedOptRatio === r
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {Math.round(r * 100)}%
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-zinc-800/60">
              <div className="flex items-center justify-between text-[9px] text-zinc-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={curvedPreserveCreases}
                    onChange={(e) => setCurvedPreserveCreases(e.target.checked)}
                    className="accent-cyan-500 w-3 h-3 rounded"
                  />
                  <span>Proteger tapas/aristas vivas</span>
                </label>
                {curvedPreserveCreases && (
                  <span className="font-mono text-[8.5px] text-cyan-400">{curvedCreaseAngle}°</span>
                )}
              </div>

              {curvedPreserveCreases && (
                <div className="flex items-center gap-2 pl-4">
                  <input
                    type="range"
                    min={20}
                    max={75}
                    step={5}
                    value={curvedCreaseAngle}
                    onChange={(e) => setCurvedCreaseAngle(parseInt(e.target.value, 10))}
                    className="flex-1 h-1 accent-cyan-500 bg-zinc-800 rounded cursor-pointer"
                  />
                  <span className="text-[7.5px] text-zinc-500">Ángulo de pliegue</span>
                </div>
              )}

              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={curvedSmoothNormals}
                  onChange={(e) => setCurvedSmoothNormals(e.target.checked)}
                  className="accent-cyan-500 w-3 h-3 rounded"
                />
                <span>Normales ultra-suaves (anti-facetado)</span>
              </label>

              <button
                type="button"
                onClick={() => optimizeCurvedObject(obj.id, curvedOptRatio, {
                  preserveCreases: curvedPreserveCreases,
                  creaseAngleDeg: curvedCreaseAngle,
                  smoothNormals: curvedSmoothNormals,
                  selectedMeshes: selectedGLTFMeshes.length > 0 ? selectedGLTFMeshes : undefined
                })}
                className="w-full py-1.5 px-2.5 mt-1 bg-gradient-to-r from-cyan-700 to-cyan-600 hover:from-cyan-600 hover:to-cyan-500 rounded text-[9.5px] font-bold text-white transition-all shadow-sm active:scale-98 cursor-pointer flex items-center justify-center gap-1.5"
                title="Optimiza esferas, tubos y geometrías curvadas reduciendo pasos poligonales redundantes"
              >
                ⭕ Optimizar Curvas & Redondeados {selectedGLTFMeshes.length > 0 ? `(${selectedGLTFMeshes.length} partes)` : ''}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 pt-1">
          <button onClick={() => fillHolesObject(obj.id)} className="py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors" title="Cierra todos los huecos abiertos">
            <Wand2 size={10}/> Tapar Huecos
          </button>
          <button 
            disabled={editMode !== 'FACE'}
            onClick={() => capSelectedFacesObject(obj.id)} 
            className={`py-1 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors ${editMode === 'FACE' ? 'bg-teal-700 hover:bg-teal-600' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}
            title="Cierra el hueco definido por las caras seleccionadas"
          >
            <Square size={10}/> Tapar Selección
          </button>
        </div>
      </div>
    </Section>
  );
};

/// ─── OPTIMIZACIÓN Y DECIMACIÓN DE MALLA ──────────────────────────────────────────
const OptimizeMeshSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const {
    project,
    toggleShowSkeleton,
    optimizeObject,
    optimizeCurvedObject,
    retopologizeObject,
    repairHardSurfaceObject,
    selectedGLTFMeshes,
    setSelectedGLTFMeshes,
    isolateGLTFSelection,
    setIsolateGLTFSelection
  } = useStore();

  const [optTab, setOptTab] = useState<'ALL' | 'CURVED' | 'ZREMESHER'>('ALL');
  const [optimizeRatio, setOptimizeRatio] = useState(0.3);
  const [optimizePreserveCreases, setOptimizePreserveCreases] = useState(true);
  const [curvedRatio, setCurvedRatio] = useState(0.4);
  const [curvedPreserveCreases, setCurvedPreserveCreases] = useState(true);
  const [curvedCreaseAngle, setCurvedCreaseAngle] = useState(40);
  const [curvedSmoothNormals, setCurvedSmoothNormals] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [meshSortMode, setMeshSortMode] = useState<'desc' | 'asc' | 'default'>('desc');
  const [meshSearch, setMeshSearch] = useState('');

  const currentVerts = obj.stats?.vertices ?? obj.vertices?.length ?? 0;
  const currentFaces = obj.stats?.faces ?? obj.faces?.length ?? 0;

  // Estados para ZRemesher
  const [retopoTargetPolys, setRetopoTargetPolys] = useState(
    Math.max(500, Math.min(20000, Math.round(currentFaces * 0.25 || 5000)))
  );
  const [retopoMode, setRetopoMode] = useState<'QUAD_DOMINANT' | 'PURE_QUADS' | 'ISOTROPIC_TRI'>('QUAD_DOMINANT');
  const [retopoAdaptive, setRetopoAdaptive] = useState(true);
  const [retopoPreserveCreases, setRetopoPreserveCreases] = useState(true);
  const [retopoHardSurface, setRetopoHardSurface] = useState(true);
  const [retopoSnapPlanar, setRetopoSnapPlanar] = useState(true);
  const [retopoCreaseAngle, setRetopoCreaseAngle] = useState(35);
  const [retopoSymmetry, setRetopoSymmetry] = useState<'NONE' | 'X'>('NONE');
  const [retopoProject, setRetopoProject] = useState(true);
  const [retopoConvertToNative, setRetopoConvertToNative] = useState(false);
  
  const activeRatio = optTab === 'ALL' ? optimizeRatio : curvedRatio;
  const targetFacesEst = optTab === 'ZREMESHER'
    ? retopoTargetPolys
    : Math.max(4, Math.round(currentFaces * activeRatio));
  const reductionPercent = optTab === 'ZREMESHER'
    ? Math.max(0, Math.round(((currentFaces - retopoTargetPolys) / Math.max(1, currentFaces)) * 100))
    : Math.round((1 - activeRatio) * 100);

  const sortedAndFilteredMeshes = useMemo(() => {
    if (!obj.meshData?.meshes) return [];
    let list = [...obj.meshData.meshes];
    if (meshSearch.trim()) {
      const q = meshSearch.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q));
    }
    if (meshSortMode === 'desc') {
      return list.sort((a, b) => b.faces - a.faces);
    } else if (meshSortMode === 'asc') {
      return list.sort((a, b) => a.faces - b.faces);
    }
    return list;
  }, [obj.meshData?.meshes, meshSortMode, meshSearch]);

  const toggleMeshSelection = (meshId: string) => {
    setSelectedGLTFMeshes(
      selectedGLTFMeshes.includes(meshId) 
        ? selectedGLTFMeshes.filter(id => id !== meshId)
        : [...selectedGLTFMeshes, meshId]
    );
  };

  const selectAllMeshes = () => {
    if (obj.meshData?.meshes) {
      setSelectedGLTFMeshes(obj.meshData.meshes.map(m => m.id));
    }
  };

  const selectDenseMeshes = () => {
    if (obj.meshData?.meshes) {
      const dense = obj.meshData.meshes.filter(m => m.faces >= 2000).map(m => m.id);
      setSelectedGLTFMeshes(dense.length > 0 ? dense : obj.meshData.meshes.map(m => m.id));
    }
  };

  const deselectAllMeshes = () => {
    setSelectedGLTFMeshes([]);
  };

  const selectedStats = useMemo(() => {
    if (!obj.meshData?.meshes || selectedGLTFMeshes.length === 0) return null;
    return obj.meshData.meshes
      .filter(m => selectedGLTFMeshes.includes(m.id))
      .reduce((acc, m) => ({
        vertices: acc.vertices + m.vertices,
        faces: acc.faces + m.faces
      }), { vertices: 0, faces: 0 });
  }, [obj.meshData?.meshes, selectedGLTFMeshes]);

  const handleExecuteOptimize = async () => {
    setIsOptimizing(true);
    try {
      if (optTab === 'ZREMESHER') {
        await retopologizeObject(obj.id, {
          targetCount: retopoTargetPolys,
          mode: retopoMode,
          adaptiveCurvature: retopoAdaptive,
          preserveCreases: retopoPreserveCreases || retopoHardSurface,
          creaseAngleDeg: retopoCreaseAngle,
          hardSurfaceProtection: retopoHardSurface,
          snapPlanarFaces: retopoSnapPlanar,
          symmetryAxis: retopoSymmetry,
          projectToSurface: retopoProject,
          convertToNative: retopoConvertToNative,
          selectedMeshes: selectedGLTFMeshes.length > 0 ? selectedGLTFMeshes : undefined
        });
      } else if (optTab === 'CURVED') {
        await optimizeCurvedObject(obj.id, curvedRatio, {
          preserveCreases: curvedPreserveCreases,
          creaseAngleDeg: curvedCreaseAngle,
          smoothNormals: curvedSmoothNormals,
          selectedMeshes: selectedGLTFMeshes.length > 0 ? selectedGLTFMeshes : undefined
        });
      } else {
        await optimizeObject(
          obj.id,
          optimizeRatio,
          selectedGLTFMeshes.length > 0 ? selectedGLTFMeshes : undefined,
          { preserveCreases: optimizePreserveCreases }
        );
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <Section title="Optimizar Malla & Retopología" icon={<Zap size={12} className="text-violet-400" />}>
      <div className="space-y-2.5">
        {/* Selector de Modo */}
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-zinc-950 rounded-lg border border-zinc-800">
          <button
            type="button"
            onClick={() => setOptTab('ALL')}
            className={`py-1 text-[9px] font-bold rounded-md transition-all cursor-pointer ${
              optTab === 'ALL'
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            ⚡ General
          </button>
          <button
            type="button"
            onClick={() => setOptTab('CURVED')}
            className={`py-1 text-[9px] font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1 ${
              optTab === 'CURVED'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-cyan-300'
            }`}
          >
            ⭕ Curvas
          </button>
          <button
            type="button"
            onClick={() => setOptTab('ZREMESHER')}
            className={`py-1 text-[9px] font-bold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1 ${
              optTab === 'ZREMESHER'
                ? 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-fuchsia-300'
            }`}
          >
            🔷 Remeser
          </button>
        </div>

        {/* Resumen de Polígonos Actuales vs Estimados */}
        <div className={`grid grid-cols-2 gap-1.5 p-2 bg-zinc-950/70 border rounded-lg ${
          optTab === 'ZREMESHER' ? 'border-fuchsia-500/40 bg-fuchsia-950/20' : optTab === 'CURVED' ? 'border-cyan-500/30' : 'border-violet-500/30'
        }`}>
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-bold text-zinc-400">Polígonos Actuales</span>
            <span className="text-[12px] font-mono font-bold text-zinc-200">{currentFaces.toLocaleString()} caras</span>
            <span className="text-[8.5px] text-zinc-500">{currentVerts.toLocaleString()} vértices</span>
          </div>
          <div className="flex flex-col items-end">
            <span className={`text-[9px] uppercase font-bold ${
              optTab === 'ZREMESHER' ? 'text-fuchsia-400' : optTab === 'CURVED' ? 'text-cyan-400' : 'text-violet-400'
            }`}>
              Objetivo Estimado
            </span>
            <span className={`text-[12px] font-mono font-bold ${
              optTab === 'ZREMESHER' ? 'text-fuchsia-300' : optTab === 'CURVED' ? 'text-cyan-300' : 'text-violet-300'
            }`}>
              ~{targetFacesEst.toLocaleString()} caras
            </span>
            <span className="text-[8.5px] font-bold text-emerald-400">-{reductionPercent}% reducción</span>
          </div>
        </div>

        {optTab === 'ZREMESHER' ? (
          /* Modo Remeser: Auto-Retopología con Flujo de Quads */
          <div className="p-2.5 rounded-lg border border-fuchsia-500/30 bg-gradient-to-b from-fuchsia-950/40 via-zinc-900/80 to-zinc-900 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-fuchsia-300 uppercase tracking-wide flex items-center gap-1.5">
                <Layers size={13} className="text-fuchsia-400" />
                Remeser: Auto-Retopología
              </span>
              <span className="text-[8px] bg-fuchsia-950 text-fuchsia-200 border border-fuchsia-500/40 px-1.5 py-0.5 rounded font-mono font-bold">
                Quad Flow
              </span>
            </div>

            <p className="text-[8.5px] text-zinc-300 leading-tight">
              Reorganiza la malla de forma automática y uniforme en cuadriláteros limpios (quads) con bucles continuos para animación, rigging y renderizado sin perder volumen ni detalle.
            </p>

            {/* Selector de Modo de Topología */}
            <div className="space-y-1">
              <span className="text-[9px] font-semibold text-zinc-400">Modo de Flujo Poligonal:</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => setRetopoMode('QUAD_DOMINANT')}
                  className={`py-1 px-1 text-[8.5px] font-bold rounded border transition-all cursor-pointer ${
                    retopoMode === 'QUAD_DOMINANT'
                      ? 'bg-fuchsia-600 border-fuchsia-400 text-white shadow'
                      : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                  title="Cuadriláteros dominantes con bucles de bordes suaves (Estándar Remeser)"
                >
                  🔷 Quads Dom.
                </button>
                <button
                  type="button"
                  onClick={() => setRetopoMode('PURE_QUADS')}
                  className={`py-1 px-1 text-[8.5px] font-bold rounded border transition-all cursor-pointer ${
                    retopoMode === 'PURE_QUADS'
                      ? 'bg-indigo-600 border-indigo-400 text-white shadow'
                      : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                  title="100% Cuadriláteros puros (Catmull-Clark - Ideal para Rigging y Deformación)"
                >
                  ✨ 100% Quads
                </button>
                <button
                  type="button"
                  onClick={() => setRetopoMode('ISOTROPIC_TRI')}
                  className={`py-1 px-1 text-[8.5px] font-bold rounded border transition-all cursor-pointer ${
                    retopoMode === 'ISOTROPIC_TRI'
                      ? 'bg-emerald-600 border-emerald-400 text-white shadow'
                      : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                  title="Triángulos equiláteros homogéneos"
                >
                  📐 Isótropo
                </button>
              </div>
            </div>

            {/* Recuento de Polígonos Objetivo */}
            <div className="space-y-1 pt-1 border-t border-zinc-800">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="text-zinc-300 font-bold">Polígonos Objetivo (Target Polys):</span>
                <span className="font-mono text-fuchsia-300 font-bold">{retopoTargetPolys.toLocaleString()}</span>
              </div>

              <input
                type="range"
                min={300}
                max={Math.max(25000, currentFaces)}
                step={100}
                value={retopoTargetPolys}
                onChange={(e) => setRetopoTargetPolys(parseInt(e.target.value, 10))}
                className="w-full h-1.5 accent-fuchsia-500 bg-zinc-800 rounded cursor-pointer"
              />

              {/* Botones de presets rápidos */}
              <div className="grid grid-cols-6 gap-1 pt-0.5">
                {[1000, 2500, 5000, 10000].map(cnt => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setRetopoTargetPolys(cnt)}
                    className={`py-0.5 text-[8.5px] font-bold rounded border transition-colors cursor-pointer ${
                      retopoTargetPolys === cnt
                        ? 'bg-fuchsia-600 border-fuchsia-400 text-white'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {cnt >= 1000 ? `${cnt / 1000}K` : cnt}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setRetopoTargetPolys(Math.max(200, Math.round(currentFaces * 0.5)))}
                  className="py-0.5 text-[8.5px] font-bold rounded border bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
                  title="50% del recuento actual"
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => setRetopoTargetPolys(Math.max(100, Math.round(currentFaces * 0.25)))}
                  className="py-0.5 text-[8.5px] font-bold rounded border bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white cursor-pointer"
                  title="25% del recuento actual"
                >
                  25%
                </button>
              </div>
            </div>

            {/* Parámetros de precisión y curvatura */}
            <div className="space-y-1.5 pt-1.5 border-t border-zinc-800">
              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={retopoPreserveCreases}
                  onChange={(e) => setRetopoPreserveCreases(e.target.checked)}
                  className="accent-fuchsia-500 w-3 h-3 rounded"
                />
                <span className="font-semibold text-fuchsia-200">🛡️ Alinear bucles con aristas vivas (Creases)</span>
              </label>

              {retopoPreserveCreases && (
                <div className="flex items-center justify-between pl-4 text-[8.5px] text-zinc-400">
                  <span>Ángulo de arista viva:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min={15}
                      max={75}
                      step={5}
                      value={retopoCreaseAngle}
                      onChange={(e) => setRetopoCreaseAngle(parseInt(e.target.value, 10))}
                      className="w-16 h-1 accent-fuchsia-500 bg-zinc-800 rounded cursor-pointer"
                    />
                    <span className="font-mono text-fuchsia-300 w-6 text-right">{retopoCreaseAngle}°</span>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={retopoAdaptive}
                  onChange={(e) => setRetopoAdaptive(e.target.checked)}
                  className="accent-fuchsia-500 w-3 h-3 rounded"
                />
                <span className="font-semibold text-fuchsia-200">🎯 Densidad Adaptativa por Curvatura</span>
              </label>

              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={retopoProject}
                  onChange={(e) => setRetopoProject(e.target.checked)}
                  className="accent-fuchsia-500 w-3 h-3 rounded"
                />
                <span className="font-semibold text-fuchsia-200">🧲 Proyección BVH (Zero-Volume-Loss)</span>
              </label>

              {/* Modo Especial Hard-Surface (Naves Espaciales, Piezas Mecánicas, Alas) */}
              <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-500/30 space-y-1.5">
                <label className="flex items-center gap-1.5 text-[9px] text-zinc-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={retopoHardSurface}
                    onChange={(e) => {
                      setRetopoHardSurface(e.target.checked);
                      if (e.target.checked) {
                        setRetopoPreserveCreases(true);
                        setRetopoSnapPlanar(true);
                      }
                    }}
                    className="accent-amber-500 w-3 h-3 rounded"
                  />
                  <span className="font-bold text-amber-300">🛡️ Protección Hard-Surface (Naves, Alas y Paneles)</span>
                </label>

                {retopoHardSurface && (
                  <div className="pl-4 space-y-1">
                    <label className="flex items-center gap-1.5 text-[8.5px] text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={retopoSnapPlanar}
                        onChange={(e) => setRetopoSnapPlanar(e.target.checked)}
                        className="accent-amber-500 w-3 h-3 rounded"
                      />
                      <span className="text-amber-200">📐 Aplanar paneles coplanares (Anti-arrugas)</span>
                    </label>
                    <p className="text-[7.5px] text-zinc-400">
                      Elimina ondulaciones y bloquea el colapso en superficies delgadas de alas y fuselajes.
                    </p>
                  </div>
                )}

                {/* Botón de acción directa de reparación Hard-Surface */}
                <button
                  type="button"
                  onClick={() => repairHardSurfaceObject(obj.id, { creaseAngleDeg: retopoCreaseAngle, planarToleranceDeg: 12 })}
                  className="w-full py-1 px-2 mt-1 bg-amber-600/80 hover:bg-amber-500 text-white rounded text-[8.5px] font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  title="Aplanar alas/paneles y convertir triángulos a quads sin alterar la forma"
                >
                  ✨ Aplanar & Reparar Polígonos Hard-Surface (1-Click)
                </button>
              </div>

              <div className="flex items-center justify-between pt-0.5 text-[9px] text-zinc-300">
                <span>Simetría Bilateral:</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRetopoSymmetry('NONE')}
                    className={`px-2 py-0.5 text-[8.5px] rounded border cursor-pointer ${
                      retopoSymmetry === 'NONE'
                        ? 'bg-fuchsia-950 border-fuchsia-500 text-fuchsia-200 font-bold'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    }`}
                  >
                    Ninguna
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetopoSymmetry('X')}
                    className={`px-2 py-0.5 text-[8.5px] rounded border cursor-pointer ${
                      retopoSymmetry === 'X'
                        ? 'bg-fuchsia-950 border-fuchsia-500 text-fuchsia-200 font-bold'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                    }`}
                  >
                    Eje X
                  </button>
                </div>
              </div>

              {/* Si es modelo GLB: Opción para convertir a Malla Nativa Editable */}
              {obj.meshData?.type === 'gltf' && (
                <div className="pt-1.5 border-t border-zinc-800 space-y-2">
                  <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={retopoConvertToNative}
                      onChange={(e) => setRetopoConvertToNative(e.target.checked)}
                      className="accent-indigo-500 w-3 h-3 rounded"
                    />
                    <span className="font-semibold text-indigo-300">
                      ⭐ Convertir a Malla Nativa Editable CSG (Quads)
                    </span>
                  </label>
                  <p className="text-[8px] text-zinc-400 pl-4.5 leading-tight">
                    Convierte el modelo en un objeto nativo editable con soporte de bisel, extrusión y edición directa de polígonos cuadriláteros.
                  </p>

                  {/* Toggle de Esqueleto / Huesos (Líneas cian y verdes) */}
                  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/70 border border-white/5">
                    <div className="flex items-center gap-2">
                      <Bone size={14} className={project.showSkeleton ? 'text-amber-400' : 'text-zinc-500'} />
                      <div>
                        <div className="text-[9px] font-bold text-zinc-200">Huesos / Rigging (Esqueleto)</div>
                        <div className="text-[7.5px] text-zinc-400">Líneas de articulaciones internas</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleShowSkeleton()}
                      className={`text-[8.5px] font-mono px-2 py-1 rounded font-bold cursor-pointer transition-all ${
                        project.showSkeleton
                          ? 'bg-amber-500 text-black shadow-sm shadow-amber-500/30'
                          : 'bg-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                      title="Activa o desactiva las líneas de huesos y rigging en el visor"
                    >
                      {project.showSkeleton ? 'MOSTRAR (ON)' : 'OCULTAR (OFF)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : optTab === 'CURVED' ? (
          /* Modo Curvaturas: Esferas, Tubos, Cilindros */
          <div className="space-y-2 bg-zinc-900/80 p-2.5 rounded-lg border border-cyan-500/30">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-cyan-300 font-bold">
                {selectedGLTFMeshes.length > 0 ? `Ratio Curvas (${selectedGLTFMeshes.length} partes seleccionadas)` : 'Ratio de Conservación Radial (Todo)'}
              </span>
              <span className="font-mono text-cyan-300 font-bold">{Math.round(curvedRatio * 100)}% ({Math.round((1 - curvedRatio) * 100)}% menos)</span>
            </div>
            
            <p className="text-[8.5px] text-zinc-400 leading-tight">
              Diseñado para esferas, cilindros, cañones y tubos: decima pasos radiales redundantes preservando curvatura, tapas y silueta sin colapsar partes finas.
            </p>

            <input
              type="range"
              min={0.05}
              max={0.90}
              step={0.05}
              value={curvedRatio}
              onChange={(e) => setCurvedRatio(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-cyan-500 bg-zinc-800 rounded cursor-pointer"
            />

            <div className="grid grid-cols-4 gap-1 pt-0.5">
              {[0.15, 0.30, 0.50, 0.75].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setCurvedRatio(r)}
                  className={`py-1 text-[9px] font-bold rounded border transition-colors cursor-pointer ${
                    curvedRatio === r
                      ? 'bg-cyan-600 border-cyan-400 text-white shadow'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  {Math.round(r * 100)}%
                </button>
              ))}
            </div>

            <div className="space-y-1.5 pt-1 border-t border-zinc-800">
              <div className="flex items-center justify-between text-[9px] text-zinc-300">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={curvedPreserveCreases}
                    onChange={(e) => setCurvedPreserveCreases(e.target.checked)}
                    className="accent-cyan-500 w-3 h-3 rounded"
                  />
                  <span>Proteger tapas y aristas vivas</span>
                </label>
                {curvedPreserveCreases && (
                  <span className="font-mono text-[8.5px] text-cyan-400 font-bold">{curvedCreaseAngle}°</span>
                )}
              </div>

              {curvedPreserveCreases && (
                <div className="flex items-center gap-2 pl-4">
                  <input
                    type="range"
                    min={20}
                    max={75}
                    step={5}
                    value={curvedCreaseAngle}
                    onChange={(e) => setCurvedCreaseAngle(parseInt(e.target.value, 10))}
                    className="flex-1 h-1 accent-cyan-500 bg-zinc-800 rounded cursor-pointer"
                  />
                  <span className="text-[7.5px] text-zinc-500">Umbral angular</span>
                </div>
              )}

              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={curvedSmoothNormals}
                  onChange={(e) => setCurvedSmoothNormals(e.target.checked)}
                  className="accent-cyan-500 w-3 h-3 rounded"
                />
                <span>Normales ultra-suaves (anti-facetado sin roturas)</span>
              </label>
            </div>
          </div>
        ) : (
          /* Modo General */
          <div className="space-y-1 bg-zinc-900/80 p-2 rounded-lg border border-zinc-800">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-300 font-bold">
                {selectedGLTFMeshes.length > 0 ? 'Ratio Retenido (Selección)' : 'Ratio Retenido (Completo)'}
              </span>
              <span className="font-mono text-violet-300 font-bold">{Math.round(optimizeRatio * 100)}%</span>
            </div>
            
            <input
              type="range"
              min={0.01}
              max={0.95}
              step={0.01}
              value={optimizeRatio}
              onChange={(e) => setOptimizeRatio(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-violet-500 bg-zinc-800 rounded cursor-pointer"
            />

            {/* Botones Rápidos de Porcentaje */}
            <div className="grid grid-cols-4 gap-1 pt-1">
              <button
                onClick={() => setOptimizeRatio(0.05)}
                className={`py-1 text-[9px] font-bold rounded border transition-colors cursor-pointer ${
                  optimizeRatio === 0.05 ? 'bg-violet-600 border-violet-400 text-white shadow' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Reducción extrema al 5% de polígonos (-95%)"
              >
                5% Ultra
              </button>
              <button
                onClick={() => setOptimizeRatio(0.15)}
                className={`py-1 text-[9px] font-bold rounded border transition-colors cursor-pointer ${
                  optimizeRatio === 0.15 ? 'bg-violet-600 border-violet-400 text-white shadow' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Reducción fuerte al 15% de polígonos (-85%)"
              >
                15%
              </button>
              <button
                onClick={() => setOptimizeRatio(0.30)}
                className={`py-1 text-[9px] font-bold rounded border transition-colors cursor-pointer ${
                  optimizeRatio === 0.30 ? 'bg-violet-600 border-violet-400 text-white shadow' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Reducción equilibrada al 30% de polígonos (-70%)"
              >
                30% Medio
              </button>
              <button
                onClick={() => setOptimizeRatio(0.50)}
                className={`py-1 text-[9px] font-bold rounded border transition-colors cursor-pointer ${
                  optimizeRatio === 0.50 ? 'bg-violet-600 border-violet-400 text-white shadow' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                }`}
                title="Reducción suave al 50% de polígonos (-50%)"
              >
                50% Suave
              </button>
            </div>

            {/* Protección de UVs y costuras */}
            <div className="pt-2 border-t border-zinc-800/80">
              <label className="flex items-center gap-1.5 text-[9px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={optimizePreserveCreases}
                  onChange={(e) => setOptimizePreserveCreases(e.target.checked)}
                  className="accent-violet-500 w-3 h-3 rounded"
                />
                <span className="font-semibold text-violet-300">
                  🛡️ Proteger texturas UV, costuras y aristas
                </span>
              </label>
              <p className="text-[8px] text-zinc-400 pl-4.5 pt-0.5 leading-tight">
                Mantiene intacto el mapeado UV, las costuras de textura y normales PBR sin deformar proyecciones.
              </p>
            </div>
          </div>
        )}

        {/* Selector de Partes si es GLTF (disponible en ALL, CURVED y ZREMESHER) */}
        {obj.meshData?.type === 'gltf' && obj.meshData.meshes && obj.meshData.meshes.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 space-y-1.5">
            <div className="flex justify-between items-center gap-1">
              <span className="text-[10px] text-zinc-300 font-bold flex items-center gap-1">
                Partes ({obj.meshData.meshes.length})
              </span>
              <div className="flex gap-1 items-center">
                <button 
                  onClick={() => setMeshSortMode(prev => prev === 'desc' ? 'asc' : prev === 'asc' ? 'default' : 'desc')}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 cursor-pointer ${
                    meshSortMode !== 'default' 
                      ? 'bg-amber-950/90 text-amber-300 border-amber-500/60 font-bold' 
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                  }`}
                  title={
                    meshSortMode === 'desc' 
                      ? "Orden actual: Mayor a Menor polígonos. Clic para Menor a Mayor" 
                      : meshSortMode === 'asc' 
                        ? "Orden actual: Menor a Mayor polígonos. Clic para Orden Original" 
                        : "Orden original. Clic para Ordenar Mayor a Menor"
                  }
                >
                  <ArrowDownNarrowWide size={11} className={meshSortMode === 'asc' ? 'rotate-180 transition-transform' : ''} />
                  {meshSortMode === 'desc' ? 'Mayor-Menor' : meshSortMode === 'asc' ? 'Menor-Mayor' : 'Original'}
                </button>
                <button onClick={selectAllMeshes} className="text-[9px] bg-zinc-800 hover:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-300 cursor-pointer">Todas</button>
                <button onClick={selectDenseMeshes} className="text-[9px] bg-purple-900/60 text-purple-200 border border-purple-500/30 px-1.5 py-0.5 rounded hover:bg-purple-800 cursor-pointer" title="Selecciona automáticamente las sub-mallas más densas (>2,000 polígonos)">Densas</button>
                <button onClick={deselectAllMeshes} className="text-[9px] bg-zinc-800 hover:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-300 cursor-pointer">Ninguna</button>
              </div>
            </div>

            {obj.meshData.meshes.length > 5 && (
              <input
                type="text"
                placeholder="Filtrar partes por nombre..."
                value={meshSearch}
                onChange={(e) => setMeshSearch(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-violet-500"
              />
            )}

            <div className="max-h-36 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {sortedAndFilteredMeshes.map((mesh) => (
                <label key={mesh.id} className="flex items-center gap-1.5 text-[10px] cursor-pointer hover:bg-zinc-800 p-1.5 rounded border border-transparent hover:border-zinc-700/50 transition-colors">
                  <input 
                    type="checkbox" 
                    className="accent-violet-600 w-3.5 h-3.5 cursor-pointer"
                    checked={selectedGLTFMeshes.includes(mesh.id)}
                    onChange={() => toggleMeshSelection(mesh.id)}
                  />
                  <span className="truncate flex-1 font-medium text-zinc-200" title={mesh.name}>{mesh.name}</span>
                  <span 
                    className="text-violet-300 font-mono text-[9px] bg-violet-950/70 px-1.5 py-0.5 rounded border border-violet-800/40 shrink-0 font-semibold"
                    title={`${mesh.faces.toLocaleString()} polígonos / ${mesh.vertices ? mesh.vertices.toLocaleString() : '-'} vértices`}
                  >
                    {mesh.faces.toLocaleString()} pol.
                  </span>
                </label>
              ))}
            </div>
            
            <div className="pt-1.5 border-t border-zinc-800 flex flex-col gap-1">
              <label className="flex items-center gap-2 text-[10px] cursor-pointer text-zinc-300 hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  className="accent-violet-600 w-3 h-3 cursor-pointer"
                  checked={isolateGLTFSelection}
                  onChange={(e) => setIsolateGLTFSelection(e.target.checked)}
                />
                <span>Ver solo selección (Aislar en 3D)</span>
              </label>

              {selectedStats && (
                <div className="bg-zinc-800/60 rounded p-1.5 text-[9px] text-zinc-300 flex justify-between items-center border border-zinc-700/50">
                  <span>Partes seleccionadas ({selectedGLTFMeshes.length}):</span>
                  <span className="font-mono text-violet-300 font-bold">{selectedStats.vertices.toLocaleString()}v | {selectedStats.faces.toLocaleString()}f</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Botón Principal de Optimización */}
        <button
          disabled={isOptimizing}
          onClick={handleExecuteOptimize}
          className={`w-full py-2.5 px-3 rounded-lg text-[11px] font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
            isOptimizing
              ? 'bg-zinc-800 text-zinc-400 cursor-wait animate-pulse'
              : optTab === 'ZREMESHER'
                ? 'bg-gradient-to-r from-fuchsia-600 via-indigo-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white shadow-fuchsia-950/60 active:scale-98'
                : optTab === 'CURVED'
                  ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-950/50 hover:shadow-cyan-900/60 active:scale-98'
                  : 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-950/50 hover:shadow-violet-900/60 active:scale-98'
          }`}
        >
          {isOptimizing ? (
            <RefreshCw size={14} className="animate-spin text-zinc-200" />
          ) : optTab === 'ZREMESHER' ? (
            <Layers size={14} className="text-fuchsia-200" />
          ) : optTab === 'CURVED' ? (
            <CircleDot size={14} className="text-cyan-200" />
          ) : (
            <Zap size={14} className="text-amber-300" />
          )}
          <span>
            {isOptimizing
              ? 'Procesando retopología...'
              : optTab === 'ZREMESHER'
                ? `⚡ Ejecutar Remeser (${retopoMode === 'PURE_QUADS' ? '100% Quads' : retopoMode === 'QUAD_DOMINANT' ? 'Quads Dominantes' : 'Isótropo'} ~${retopoTargetPolys.toLocaleString()}p)`
                : optTab === 'CURVED'
                  ? `Optimizar Curvas ${selectedGLTFMeshes.length > 0 ? `(${selectedGLTFMeshes.length} partes)` : 'y Redondeados'} (-${reductionPercent}%)`
                  : `Optimizar ${selectedGLTFMeshes.length > 0 ? `Selección (${selectedGLTFMeshes.length} partes)` : 'Malla Completa'}`}
          </span>
        </button>
      </div>
    </Section>
  );
};

const ValidationSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { repairObject } = useStore();
  const [validResult, setValidResult] = useState<any>(null);

  const handleValidate = async () => {
    const { validateMesh } = await import('../utils/modifiers');
    setValidResult(validateMesh(obj));
  };

  return (
    <Section title="Validación" icon={<CheckCircle size={12}/>} defaultOpen={false}>
      <div className="space-y-2">
        {validResult && (
          <div className="text-[9px] text-zinc-400 bg-zinc-900 p-2 rounded">
            <p>Vértices: {validResult.vertexCount}</p>
            <p>Caras: {validResult.faceCount}</p>
            <p>Estado: {validResult.isValid ? '✅ Válido' : '❌ Errores'}</p>
          </div>
        )}
        <div className="flex gap-1">
          <button onClick={handleValidate} className="flex-1 py-1 bg-zinc-800 rounded text-[10px]">Validar</button>
          <button onClick={() => repairObject(obj.id)} className="flex-1 py-1 bg-emerald-800 rounded text-[10px]">Reparar</button>
        </div>
      </div>
    </Section>
  );
};

const LIGHT_ICONS: Record<string, string> = {
  POINT: '💡', DIRECTIONAL: '☀️', SPOT: '🔦', RECTAREA: '▭', AMBIENT: '🌍'
};
const LIGHT_LABELS: Record<string, string> = {
  POINT: 'Punto', DIRECTIONAL: 'Direccional', SPOT: 'Foco', RECTAREA: 'Área', AMBIENT: 'Ambiental'
};

const LIGHT_PRESET_COLORS = [
  { name: 'Luz Día (6500K)', color: '#ffffff' },
  { name: 'Cálida (3200K)', color: '#ffe4b5' },
  { name: 'Atardecer', color: '#ff9944' },
  { name: 'Oro Intenso', color: '#ffa500' },
  { name: 'Cielo Frío', color: '#90caf9' },
  { name: 'Cyber Cyan', color: '#00f5ff' },
  { name: 'Neón Rosa', color: '#ff007f' },
  { name: 'Luz de Luna', color: '#88aacc' },
];

const LightPropertiesSection: React.FC<{ light: any }> = ({ light }) => {
  const updateLight = useStore(s => s.updateLight);
  const removeLight = useStore(s => s.removeLight);
  const selectLight = useStore(s => s.selectLight);

  const up = (data: any) => updateLight(light.id, data);

  return (
    <div className="flex flex-col h-full">
      {/* Header con botón volver prominente */}
      <div className="flex-shrink-0 border-b border-white/5">
        {/* Botón volver */}
        <button
          onClick={() => selectLight(null)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-all text-left group"
        >
          <div className="p-1.5 rounded-lg bg-zinc-900 border border-white/5 group-hover:bg-indigo-900/40 group-hover:border-indigo-500/30 transition-all">
            <ArrowLeft size={12} className="text-zinc-500 group-hover:text-indigo-400" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300 transition-colors">
            Volver a Iluminación
          </span>
        </button>

        {/* Identidad de la luz */}
        <div className="px-4 pb-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 shadow-xl border"
               style={{ background: `${light.color}11`, borderColor: `${light.color}33` }}>
            <span style={{ filter: 'drop-shadow(0 0 8px currentColor)' }}>{LIGHT_ICONS[light.type] || '💡'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <input
              value={light.name}
              onChange={e => up({ name: e.target.value })}
              className="w-full bg-transparent text-[14px] font-bold text-zinc-100 focus:outline-none truncate placeholder:text-zinc-700"
              placeholder="Nombre de la luz"
            />
            <div className="flex items-center gap-2 mt-1">
              <select
                value={light.type}
                onChange={(e) => up({ type: e.target.value as any })}
                className="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-300 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer hover:bg-zinc-800"
              >
                <option value="POINT">Punto</option>
                <option value="DIRECTIONAL">Direccional (Sol)</option>
                <option value="SPOT">Foco / Spot</option>
                <option value="RECTAREA">Área (Softbox)</option>
                <option value="AMBIENT">Ambiental / Hemisférica</option>
              </select>
            </div>
          </div>
          {/* Swatch de color */}
          <label className="cursor-pointer flex-shrink-0 relative group" title="Color de la luz">
            <div className="w-8 h-8 rounded-xl border-2 border-white/10 group-hover:border-white/30 shadow-lg transition-all overflow-hidden"
                 style={{ background: light.color }}>
              <input type="color" value={light.color} onChange={e => up({ color: e.target.value })}
                     className="opacity-0 w-0 h-0 absolute" />
            </div>
          </label>
        </div>

        {/* Paleta rápida de colores / temperatura */}
        <div className="px-4 pb-3 flex items-center gap-1.5 overflow-x-auto custom-scrollbar">
          {LIGHT_PRESET_COLORS.map(p => (
            <button
              key={p.color}
              type="button"
              onClick={() => up({ color: p.color })}
              className={`w-5 h-5 rounded-full border shrink-0 transition-transform hover:scale-110 ${
                light.color.toLowerCase() === p.color.toLowerCase() ? 'ring-2 ring-indigo-400 scale-105 border-white' : 'border-white/20'
              }`}
              style={{ backgroundColor: p.color }}
              title={p.name}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 p-1">
        <Section title="Intensidad y Color" icon={<Sun size={14}/>}>
          <NumRow label="Intensidad" value={light.intensity} onChange={v => up({ intensity: v })} min={0} max={30} step={0.1} slider unit="cd" />
          
          {light.type === 'AMBIENT' && (
            <div className="pt-2 border-t border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Luz de Suelo / Rebote</span>
                <label className="cursor-pointer flex items-center gap-2">
                  <div className="w-5 h-5 rounded border border-white/20" style={{ background: light.groundColor || '#222222' }} />
                  <input
                    type="color"
                    value={light.groundColor || '#222222'}
                    onChange={e => up({ groundColor: e.target.value })}
                    className="opacity-0 w-0 h-0 absolute"
                  />
                  <span className="text-[9px] text-zinc-400 font-mono">{light.groundColor || '#222222'}</span>
                </label>
              </div>
            </div>
          )}
        </Section>

        {/* Apartado Específico según el tipo de luz */}
        <Section title={`Parámetros de ${LIGHT_LABELS[light.type] || light.type}`} icon={<SlidersHorizontal size={14}/>}>
          {light.type === 'POINT' && (
            <div className="space-y-3">
              <NumRow label="Distancia / Alcance" value={light.distance ?? 0} onChange={v => up({ distance: v })} min={0} max={100} step={0.5} slider unit="m" />
              <p className="text-[9px] text-zinc-500 italic">0 = alcance infinito sin corte brusco</p>
              <NumRow label="Decaimiento Físico" value={light.decay ?? 2} onChange={v => up({ decay: v })} min={0} max={5} step={0.1} slider />
              <p className="text-[9px] text-zinc-500 italic">2.0 = decaimiento físicamente cuadrático inverso</p>
            </div>
          )}

          {light.type === 'SPOT' && (
            <div className="space-y-3">
              <NumRow
                label="Ángulo del Cono"
                value={Math.round(((light.angle ?? Math.PI/3) * 180) / Math.PI)}
                onChange={v => up({ angle: (v * Math.PI) / 180 })}
                min={5}
                max={90}
                step={1}
                slider
                unit="°"
              />
              <NumRow label="Penumbra / Difuminado" value={light.penumbra ?? 0.25} onChange={v => up({ penumbra: v })} min={0} max={1} step={0.02} slider />
              <NumRow label="Alcance Máximo" value={light.distance ?? 0} onChange={v => up({ distance: v })} min={0} max={100} step={0.5} slider unit="m" />
              <NumRow label="Decaimiento" value={light.decay ?? 2} onChange={v => up({ decay: v })} min={0} max={5} step={0.1} slider />
            </div>
          )}

          {light.type === 'DIRECTIONAL' && (
            <div className="space-y-3">
              <NumRow label="Cobertura de Sombra" value={light.shadowCameraSize ?? 20} onChange={v => up({ shadowCameraSize: v })} min={2} max={80} step={1} slider unit="m" />
              <p className="text-[9px] text-zinc-500 italic">Extensión del área que proyecta sombras solares nítidas</p>
            </div>
          )}

          {light.type === 'RECTAREA' && (
            <div className="space-y-3">
              <NumRow label="Ancho Difusor" value={light.width ?? 2} onChange={v => up({ width: v })} min={0.1} max={25} step={0.1} slider unit="m" />
              <NumRow label="Alto Difusor" value={light.height ?? 2} onChange={v => up({ height: v })} min={0.1} max={25} step={0.1} slider unit="m" />
            </div>
          )}

          {light.type === 'AMBIENT' && (
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              Iluminación global uniforme sin dirección fija. Si defines color de rebote, actúa como hemisferio (cielo + suelo).
            </p>
          )}
        </Section>

        {/* Apartado de Sombras Avanzadas */}
        {light.type !== 'RECTAREA' && light.type !== 'AMBIENT' && (
          <Section title="Configuración de Sombras" icon={<Sparkles size={14}/>}>
            <div className="flex items-center justify-between py-1">
              <span className="text-[10px] text-zinc-300 font-bold uppercase tracking-wider">Proyectar Sombras</span>
              <button
                type="button"
                onClick={() => up({ castShadow: !light.castShadow })}
                className={`relative w-10 h-5 rounded-full transition-all cursor-pointer ${
                  light.castShadow ? 'bg-indigo-600 shadow-lg shadow-indigo-500/20' : 'bg-zinc-800'
                }`}
              >
                <motion.div 
                  animate={{ x: light.castShadow ? 22 : 2 }}
                  className="absolute top-1 w-3 h-3 rounded-full bg-white shadow-sm"
                />
              </button>
            </div>

            {light.castShadow && (
              <div className="space-y-3 pt-2 border-t border-white/5">
                <NumRow
                  label="Suavidad / Radio"
                  value={light.shadowRadius ?? 1.5}
                  onChange={v => up({ shadowRadius: v })}
                  min={0.2}
                  max={8.0}
                  step={0.1}
                  slider
                />
                <NumRow
                  label="Shadow Bias"
                  value={light.shadowBias ?? -0.0001}
                  onChange={v => up({ shadowBias: v })}
                  min={-0.005}
                  max={0.005}
                  step={0.0001}
                  slider
                />
                <p className="text-[8.5px] text-zinc-500 italic">Corrige rayas o artefactos de sombra sobre superficies planas</p>

                <NumRow
                  label="Normal Bias"
                  value={light.shadowNormalBias ?? 0.05}
                  onChange={v => up({ shadowNormalBias: v })}
                  min={0.0}
                  max={0.2}
                  step={0.005}
                  slider
                />
                <p className="text-[8.5px] text-zinc-500 italic">Evita sombras oscuras dentadas en polígonos curvados</p>

                <div>
                  <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1.5">
                    Resolución del Mapa de Sombra
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {[512, 1024, 2048, 4096].map(res => (
                      <button
                        key={res}
                        type="button"
                        onClick={() => up({ shadowMapSize: res })}
                        className={`py-1 text-[9px] font-mono font-bold rounded border transition-colors cursor-pointer ${
                          (light.shadowMapSize ?? 2048) === res
                            ? 'bg-indigo-600 border-indigo-400 text-white shadow'
                            : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800'
                        }`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Section>
        )}

        <Section title="Transformación 3D" icon={<Move size={14}/>}>
          <XYZRow label="Posición" values={light.transform.position} onChange={v => up({ transform: { ...light.transform, position: v } })} step={0.1} />
          <XYZRow label="Rotación" values={light.transform.rotation} onChange={v => up({ transform: { ...light.transform, rotation: v } })} step={0.1} />
        </Section>
      </div>

      <div className="p-4 border-t border-white/5 flex-shrink-0 bg-zinc-950/20">
        <button onClick={() => { removeLight(light.id); }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-rose-500/20 cursor-pointer">
          <Trash2 size={14}/> Eliminar luz
        </button>
      </div>
    </div>
  );
};

const HierarchyItem: React.FC<{ 
  id: string; 
  name: string; 
  type: string; 
  isSelected: boolean; 
  onSelect: (id: string, shift: boolean) => void;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  visible?: boolean;
  onToggleVisibility?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
}> = ({ id, name, type, isSelected, onSelect, children, icon, visible = true, onToggleVisibility, onDuplicate, onDelete }) => {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = !!children;

  return (
    <div className="flex flex-col">
      <motion.div 
        layout
        onClick={(e) => onSelect(id, e.shiftKey || e.ctrlKey || e.metaKey)}
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
          isSelected 
            ? 'bg-indigo-600/90 text-white shadow-lg shadow-indigo-500/20' 
            : 'hover:bg-white/[0.03] text-zinc-400 hover:text-zinc-200'
        }`}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasChildren ? (
            <button 
              onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
              className="p-1 hover:bg-white/10 rounded-md transition-colors"
            >
              <motion.div animate={{ rotate: isOpen ? 0 : -90 }}>
                <ChevronDown size={12} />
              </motion.div>
            </button>
          ) : (
            <div className="w-6" />
          )}
          <span className={`flex-shrink-0 transition-colors ${isSelected ? 'text-white' : 'text-zinc-500 group-hover:text-indigo-400'}`}>
            {icon || <Box size={14}/>}
          </span>
          <span className="text-[11px] font-medium truncate tracking-tight">{name || `Sin nombre (${type})`}</span>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {onToggleVisibility && (
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(id); }}
              className={`p-1.5 rounded-md transition-colors ${isSelected ? 'hover:bg-white/20 text-white' : 'hover:bg-white/10 text-zinc-400'}`}
              title="Alternar visibilidad"
            >
              {visible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          )}
          {onDuplicate && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDuplicate(id); }}
              className={`p-1.5 rounded-md transition-colors ${isSelected ? 'hover:bg-white/20 text-white' : 'hover:bg-white/10 text-zinc-400'}`}
              title="Duplicar"
            >
              <Copy size={12} />
            </button>
          )}
          {onDelete && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(id); }}
              className="p-1.5 rounded-md transition-colors text-rose-400 hover:bg-rose-500/20 hover:text-rose-300"
              title="Eliminar objeto"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {hasChildren && isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="ml-5 border-l border-white/5 pl-2 mt-1 space-y-1 overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const CameraPropertiesSection: React.FC<{ camera: CameraObject }> = ({ camera }) => {
  const { updateCamera, selectCamera, project, addObject } = useStore();

  const handleChange = (field: keyof CameraObject, value: any) => {
    updateCamera(camera.id, { [field]: value });
  };

  const handleTransformChange = (field: keyof Transform, value: any) => {
    updateCamera(camera.id, { transform: { ...camera.transform, [field]: value } });
  };

  const filmGauge = camera.filmGauge || 35;
  const focalLength = filmGauge / (2 * Math.tan((camera.fov * Math.PI) / 360));

  const handleFocalLengthChange = (newFocalLength: number) => {
    const newFov = 2 * Math.atan(filmGauge / (2 * newFocalLength)) * (180 / Math.PI);
    updateCamera(camera.id, { fov: newFov, focalLength: newFocalLength });
  };

  const handleFilmGaugeChange = (newFilmGauge: number) => {
    const newFov = 2 * Math.atan(newFilmGauge / (2 * focalLength)) * (180 / Math.PI);
    updateCamera(camera.id, { fov: newFov, filmGauge: newFilmGauge });
  };

  const handleCreatePath = (type: 'CIRCLE' | 'SPIRAL' | 'SINE' = 'CIRCLE') => {
    let targetPos: V3 = [0, 2, 0];
    if (camera.targetObjectId) {
      const tgtObj = project.objects.find(o => o.id === camera.targetObjectId);
      if (tgtObj) targetPos = tgtObj.transform.position;
    }
    const newPath = createCameraPathObject(`Ruta_Camara_${camera.name}`, targetPos, 7, type);
    addObject(newPath);
    updateCamera(camera.id, {
      pathObjectId: newPath.id,
      followPathAnimation: true,
      pathProgress: 0,
    });
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => selectCamera(null)} className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400 hover:text-white">
          <ChevronRight size={16} className="rotate-180" />
        </button>
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">{camera.name}</h3>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Propiedades de Cámara</p>
        </div>
      </div>

      {/* ── SEGUIMIENTO DE OBJETIVO (TARGET TRACKING) ── */}
      <div className="p-4 bg-indigo-950/30 rounded-2xl border border-indigo-500/20 space-y-3">
        <div className="flex items-center gap-2 text-indigo-400">
          <Target size={15} />
          <h4 className="text-xs font-bold text-white uppercase tracking-wider">Objetivo de Cámara (Look At)</h4>
        </div>
        
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-zinc-400">Marcar objeto objetivo a seguir</label>
          <select
            value={camera.targetObjectId || ''}
            onChange={(e) => handleChange('targetObjectId', e.target.value || null)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">-- Ninguno (Dirección Libres / Libre) --</option>
            {project.objects.map(obj => (
              <option key={obj.id} value={obj.id}>
                🎯 {obj.name} ({obj.type})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── RUTA Y TRAYECTORIA DE CÁMARA (CAMERA PATH & CURVE MOVEMENT) ── */}
      <div className="p-4 bg-violet-950/30 rounded-2xl border border-violet-500/20 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-violet-400">
            <Route size={15} />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Ruta / Trayectoria de Cámara</h4>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-medium text-zinc-400">Objeto o Curva para el desplazamiento</label>
          <select
            value={camera.pathObjectId || ''}
            onChange={(e) => handleChange('pathObjectId', e.target.value || null)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500 transition-colors"
          >
            <option value="">-- Ninguna (Posición Estática) --</option>
            {project.objects.map(obj => (
              <option key={obj.id} value={obj.id}>
                🛣️ {obj.name}
              </option>
            ))}
          </select>

          {/* Botones de creación rápida de ruta */}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={() => handleCreatePath('CIRCLE')}
              className="flex-1 py-1.5 px-2 bg-violet-900/40 hover:bg-violet-800/60 border border-violet-700/50 rounded-lg text-[10px] font-bold text-violet-200 transition-all flex items-center justify-center gap-1">
              <Compass size={12} />
              + Crear Órbita
            </button>
            <button
              onClick={() => handleCreatePath('SPIRAL')}
              className="flex-1 py-1.5 px-2 bg-violet-900/40 hover:bg-violet-800/60 border border-violet-700/50 rounded-lg text-[10px] font-bold text-violet-200 transition-all flex items-center justify-center gap-1">
              <Route size={12} />
              + Espiral
            </button>
          </div>

          {camera.pathObjectId && (
            <div className="space-y-3 pt-2 border-t border-violet-500/20">
              <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={camera.followPathAnimation ?? true}
                  onChange={(e) => handleChange('followPathAnimation', e.target.checked)}
                  className="rounded bg-zinc-950 border-zinc-700 text-violet-500 focus:ring-0"
                />
                <span className="font-semibold text-violet-300">Sincronizar con Línea de Tiempo</span>
              </label>

              {!(camera.followPathAnimation ?? true) && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-zinc-400">Progreso en Ruta</span>
                    <span className="font-mono text-violet-300">{Math.round((camera.pathProgress || 0) * 100)}%</span>
                  </div>
                  <input
                    type="range" min="0" max="1" step="0.01"
                    value={camera.pathProgress || 0}
                    onChange={(e) => handleChange('pathProgress', parseFloat(e.target.value))}
                    className="w-full accent-violet-500 bg-zinc-900 rounded-lg h-1.5"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Nombre</label>
          <input
            type="text"
            value={camera.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tipo</label>
          <select
            value={camera.type}
            onChange={(e) => handleChange('type', e.target.value as any)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="PERSPECTIVE">Perspectiva</option>
            <option value="ORTHOGRAPHIC">Ortográfica</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
            {camera.type === 'PERSPECTIVE' ? 'FOV (Campo de Visión)' : 'Tamaño (Size)'}
          </label>
          <div className="flex gap-2">
            {camera.type === 'PERSPECTIVE' ? (
              <>
                <input
                  type="range" min="10" max="120" step="1"
                  value={camera.fov}
                  onChange={(e) => handleChange('fov', parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-xs text-zinc-400 font-mono w-8 text-right">{Math.round(camera.fov)}°</span>
              </>
            ) : (
              <>
                <input
                  type="range" min="1" max="50" step="0.5"
                  value={camera.fov} // Reusing fov for orthographic size for simplicity
                  onChange={(e) => handleChange('fov', parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-xs text-zinc-400 font-mono w-8 text-right">{camera.fov}</span>
              </>
            )}
          </div>
        </div>

        {camera.type === 'PERSPECTIVE' && (
          <>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Distancia Focal (mm)</label>
              <div className="flex gap-2">
                <input
                  type="range" min="10" max="200" step="1"
                  value={focalLength}
                  onChange={(e) => handleFocalLengthChange(parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-xs text-zinc-400 font-mono w-10 text-right">{Math.round(focalLength)}mm</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Sensor de Cámara (mm)</label>
              <div className="flex gap-2">
                <input
                  type="range" min="10" max="100" step="1"
                  value={filmGauge}
                  onChange={(e) => handleFilmGaugeChange(parseFloat(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-xs text-zinc-400 font-mono w-10 text-right">{Math.round(filmGauge)}mm</span>
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Near / Far</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number" step="0.1"
              value={camera.near}
              onChange={(e) => handleChange('near', parseFloat(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Near"
            />
            <input
              type="number" step="1"
              value={camera.far}
              onChange={(e) => handleChange('far', parseFloat(e.target.value))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="Far"
            />
          </div>
        </div>
      </div>

      <div className="p-4 bg-zinc-900/50 rounded-2xl border border-white/5 space-y-4">
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">Transformación</h4>
        <XYZRow label="Posición" values={camera.transform.position} onChange={(v) => handleTransformChange('position', v)} step={0.1} />
        <XYZRow label="Rotación" values={camera.transform.rotation} onChange={(v) => handleTransformChange('rotation', v)} step={0.1} />
      </div>
    </div>
  );
};

const SceneManager: React.FC = () => {
  const { 
    project, updateEnvironment, addLight, selectLight, selectedLightId, updateLight, removeLight,
    addCamera, selectCamera, selectedCameraId, removeCamera,
    selectedObjectId, selectedObjectIds, selectObject, toggleObjectSelection,
    updateObject, removeObject, removeObjects, duplicateObject, selectedGLTFMeshes, toggleGLTFMeshSelection
  } = useStore();
  const env = project.environment;

  const selectedLight = project.lights.find(l => l.id === selectedLightId);
  const selectedCamera = (project.cameras || []).find(c => c.id === selectedCameraId);

  if (selectedLight) {
    return <LightPropertiesSection light={selectedLight} />;
  }

  if (selectedCamera) {
    return <CameraPropertiesSection camera={selectedCamera} />;
  }

  const handleHDRIUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const dataUrl = await fileToDataURL(file);
      const urlWithFilename = `${dataUrl}#${file.name}`;
      updateEnvironment({ hdriUrl: urlWithFilename });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1 space-y-1">
        <Section title="Entorno e Iluminación" icon={<Globe size={14}/>}>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {PRESET_HDRIS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => updateEnvironment({ hdriUrl: opt.url })}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
                    env.hdriUrl === opt.url 
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300 shadow' 
                      : 'bg-zinc-900/50 border-white/5 text-zinc-500 hover:bg-zinc-800 hover:border-white/10'
                  }`}
                  title={opt.desc}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span className="text-[9px] font-bold uppercase tracking-tighter truncate w-full text-center">{opt.name}</span>
                </button>
              ))}
              <label className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border border-dashed border-indigo-500/30 bg-indigo-950/20 text-indigo-300 hover:bg-indigo-900/30 hover:border-indigo-400 cursor-pointer transition-all">
                <Upload size={14} className="text-indigo-400" />
                <span className="text-[9px] font-bold uppercase tracking-tighter text-center">Subir HDR</span>
                <span className="text-[7.5px] text-zinc-400 text-center leading-tight">EXR, HDR, JPG</span>
                <input type="file" accept=".hdr,.exr,.png,.jpg,.jpeg,.webp,.avif" onChange={handleHDRIUpload} className="hidden" />
              </label>
            </div>

            {/* Input URL directa de HDRI */}
            <div className="bg-zinc-900/60 p-2 rounded-xl border border-white/5 space-y-1">
              <span className="text-[9px] text-zinc-400 font-semibold block">URL de Mapa HDRI Externo (Magnific / Poly Haven / Web):</span>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="https://.../mapa.hdr o imagen equirectangular"
                  value={env.hdriUrl && !env.hdriUrl.startsWith('synthetic_') && !env.hdriUrl.startsWith('data:') ? env.hdriUrl : ''}
                  onChange={e => updateEnvironment({ hdriUrl: e.target.value || null })}
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <div className="space-y-3 pt-2">
              {/* Modo de Fondo */}
              <div>
                <span className="text-[10px] text-zinc-400 font-medium block mb-1">Modo de Fondo</span>
                <div className="grid grid-cols-2 gap-1 bg-zinc-900/80 p-1 rounded-xl border border-zinc-800">
                  {[
                    { id: 'GRADIENT', label: 'Estudio (Gradiente)' },
                    { id: 'HDRI',     label: 'Imagen HDRI' },
                    { id: 'COLOR',    label: 'Color Sólido' },
                    { id: 'TRANSPARENT', label: 'Transparente' },
                  ].map(m => {
                    const currentMode = env.backgroundMode || (env.backgroundVisible ? 'HDRI' : 'GRADIENT');
                    const active = currentMode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => updateEnvironment({
                          backgroundMode: m.id as BackgroundMode,
                          backgroundVisible: m.id === 'HDRI' || m.id === 'GRADIENT',
                        })}
                        className={`py-1 px-1.5 rounded-lg text-[9.5px] font-bold transition-all ${
                          active
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(env.backgroundMode === 'HDRI' || (!env.backgroundMode && env.backgroundVisible)) && (
                <NumRow
                  label="Desenfoque Fondo (Bokeh)"
                  value={env.backgroundBlur ?? 0.25}
                  onChange={v => updateEnvironment({ backgroundBlur: v })}
                  min={0} max={1} step={0.05} slider
                />
              )}

              {env.backgroundMode === 'COLOR' && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-[10px] text-zinc-400 font-medium">Color de Fondo</span>
                  <input
                    type="color"
                    value={env.backgroundColor || '#16171d'}
                    onChange={e => updateEnvironment({ backgroundColor: e.target.value })}
                    className="w-8 h-6 bg-transparent rounded border border-zinc-700 cursor-pointer"
                  />
                </div>
              )}

              <NumRow label="Rotación Luz (Dirección)" value={env.rotation ?? 0} onChange={v => updateEnvironment({ rotation: v })} min={0} max={360} step={5} slider />
              <NumRow label="Intensidad HDRI" value={env.intensity} onChange={v => updateEnvironment({ intensity: v })} min={0.1} max={5} step={0.1} slider />
              <NumRow label="Exposición Cámara" value={env.exposure} onChange={v => updateEnvironment({ exposure: v })} min={0.2} max={5} step={0.1} slider />

              <div className="flex items-center justify-between px-1 pt-1">
                <span className="text-[10px] text-zinc-400 font-medium">Límite Res. (FPS)</span>
                <select
                  value={env.maxResolution || 2048}
                  onChange={e => updateEnvironment({ maxResolution: parseInt(e.target.value, 10) })}
                  className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-[10px] rounded px-2 py-1 font-mono focus:border-indigo-500"
                >
                  <option value={1024}>1K (Ultra FPS)</option>
                  <option value={2048}>2K (Recomendado)</option>
                  <option value={4096}>4K (Alta Calidad)</option>
                </select>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Jerarquía" icon={<Layers size={14}/>} badge={
          selectedObjectIds.length > 0 ? (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
              {selectedObjectIds.length} sel.
            </span>
          ) : undefined
        }>
          <div className="space-y-2">
            {selectedObjectIds.length > 0 && (
              <div className="flex items-center justify-between gap-2 p-2 bg-indigo-950/40 border border-indigo-500/30 rounded-lg">
                <span className="text-[10px] text-indigo-200 font-medium truncate">
                  {selectedObjectIds.length} {selectedObjectIds.length === 1 ? 'objeto seleccionado' : 'objetos seleccionados'}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {selectedObjectIds.length > 1 && (
                    <button
                      onClick={() => {
                        selectedObjectIds.forEach(id => duplicateObject(id));
                      }}
                      className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-zinc-200 rounded text-[10px] font-bold transition-all"
                      title="Duplicar seleccionados"
                    >
                      <Copy size={11} /> Duplicar
                    </button>
                  )}
                  <button
                    onClick={() => removeObjects(selectedObjectIds)}
                    className="flex items-center gap-1 px-2 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-200 hover:text-white rounded text-[10px] font-bold transition-all border border-rose-500/30"
                    title="Eliminar objetos seleccionados"
                  >
                    <Trash2 size={11} /> Eliminar ({selectedObjectIds.length})
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
              {project.objects.map(obj => (
                <HierarchyItem
                  key={obj.id}
                  id={obj.id}
                  name={obj.name}
                  type={obj.type}
                  isSelected={selectedObjectIds.includes(obj.id)}
                  onSelect={(id, shift) => shift ? toggleObjectSelection(id, true) : selectObject(id)}
                  visible={obj.visible}
                  onToggleVisibility={(id) => updateObject(id, { visible: !obj.visible })}
                  onDuplicate={(id) => duplicateObject(id)}
                  onDelete={(id) => removeObject(id)}
                  icon={obj.meshData?.type === 'gltf' ? <ImageIcon size={12}/> : undefined}
                >
                  {obj.meshData?.type === 'gltf' && obj.meshData.meshes && (
                    <div className="space-y-0.5 mt-1">
                      {obj.meshData.meshes.map(mesh => (
                        <div 
                          key={mesh.id}
                          onClick={(e) => { e.stopPropagation(); toggleGLTFMeshSelection(mesh.id); }}
                          className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-all ${
                            selectedGLTFMeshes.includes(mesh.id) 
                              ? 'bg-violet-600/30 text-violet-200 border border-violet-500/30' 
                              : 'hover:bg-white/5 text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          <Box size={10} className="opacity-50" />
                          <span className="text-[9px] truncate font-medium">{mesh.name}</span>
                          <span 
                            className="ml-auto text-[8px] font-mono font-semibold text-violet-300 bg-violet-950/80 px-1.5 py-0.5 rounded border border-violet-800/40 shrink-0"
                            title={`${mesh.faces.toLocaleString()} polígonos`}
                          >
                            {mesh.faces.toLocaleString()} pol.
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </HierarchyItem>
              ))}
              {project.lights.map(light => (
                <HierarchyItem
                  key={light.id}
                  id={light.id}
                  name={light.name}
                  type={`Luz ${LIGHT_LABELS[light.type]}`}
                  isSelected={selectedLightId === light.id}
                  onSelect={(id) => selectLight(id)}
                  visible={light.visible}
                  onToggleVisibility={(id) => updateLight(id, { visible: !light.visible })}
                  onDelete={(id) => removeLight(id)}
                  icon={<span className="text-[10px]">{LIGHT_ICONS[light.type]}</span>}
                />
              ))}
              {project.cameras?.map(cam => (
                <HierarchyItem
                  key={cam.id}
                  id={cam.id}
                  name={cam.name}
                  type={`Cámara ${cam.type === 'PERSPECTIVE' ? 'Perspectiva' : 'Ortográfica'}`}
                  isSelected={selectedCameraId === cam.id}
                  onSelect={(id) => selectCamera(id)}
                  visible={true}
                  onToggleVisibility={() => {}}
                  onDelete={(id) => removeCamera(id)}
                  icon={<Camera size={12}/>}
                />
              ))}
              {project.objects.length === 0 && project.lights.length === 0 && (!project.cameras || project.cameras.length === 0) && (
                <div className="py-8 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center mx-auto text-zinc-700">
                    <Box size={16} />
                  </div>
                  <p className="text-[10px] text-zinc-600 font-medium italic">No hay objetos en la escena</p>
                </div>
              )}
            </div>
          </div>
        </Section>

        <Section title="Luces" icon={<Sun size={14}/>} badge={
          <div className="relative group/light-menu">
            <button 
              onClick={(e) => { e.stopPropagation(); }}
              className="p-1.5 rounded-lg bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all border border-indigo-500/20 flex items-center gap-1"
              title="Añadir tipo de luz"
            >
              <Plus size={12} />
            </button>
            <div className="absolute right-0 top-full mt-1 w-36 bg-zinc-900 border border-white/10 rounded-xl shadow-xl opacity-0 invisible group-hover/light-menu:opacity-100 group-hover/light-menu:visible transition-all z-50 overflow-hidden">
              <button onClick={(e) => { e.stopPropagation(); addLight('POINT'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-indigo-600/20 transition-colors">💡 Punto</button>
              <button onClick={(e) => { e.stopPropagation(); addLight('DIRECTIONAL'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-indigo-600/20 transition-colors">☀️ Direccional</button>
              <button onClick={(e) => { e.stopPropagation(); addLight('SPOT'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-indigo-600/20 transition-colors">🔦 Foco</button>
              <button onClick={(e) => { e.stopPropagation(); addLight('RECTAREA'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-indigo-600/20 transition-colors">▭ Área</button>
              <button onClick={(e) => { e.stopPropagation(); addLight('AMBIENT'); }} className="w-full text-left px-3 py-2 text-[10px] font-bold text-zinc-400 hover:text-white hover:bg-indigo-600/20 transition-colors">🌍 Ambiental</button>
            </div>
          </div>
        }>
          <div className="space-y-2">
            {/* Presets de iluminación 1-Clic */}
            <div className="p-2 bg-zinc-900/60 rounded-xl border border-white/5 space-y-1.5">
              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block">Presets de Iluminación</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    // Estudio 3 puntos
                    addLight('DIRECTIONAL', { name: 'Key Light (Principal)', color: '#fff5ea', intensity: 2.5, transform: { position: [5, 6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] }, castShadow: true });
                    addLight('DIRECTIONAL', { name: 'Fill Light (Relleno)', color: '#dbeafe', intensity: 1.0, transform: { position: [-5, 3, 4], rotation: [0, 0, 0], scale: [1, 1, 1] }, castShadow: false });
                    addLight('SPOT', { name: 'Rim Light (Contorno)', color: '#ffffff', intensity: 3.0, transform: { position: [0, 6, -6], rotation: [0, 0, 0], scale: [1, 1, 1] }, castShadow: true });
                  }}
                  className="px-2 py-1.5 bg-zinc-800 hover:bg-indigo-600/30 text-zinc-300 hover:text-white rounded-lg text-[9px] font-bold border border-white/5 transition-all text-left truncate"
                  title="Añadir Luz Principal, Relleno y Contorno"
                >
                  🎬 Estudio 3 Puntos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addLight('DIRECTIONAL', { name: 'Sol de Atardecer', color: '#ff8c3b', intensity: 3.2, transform: { position: [8, 3, 5], rotation: [0, 0, 0], scale: [1, 1, 1] }, castShadow: true });
                    addLight('AMBIENT', { name: 'Cielo Azul Calmo', color: '#93c5fd', groundColor: '#38251e', intensity: 0.8 });
                  }}
                  className="px-2 py-1.5 bg-zinc-800 hover:bg-amber-600/30 text-zinc-300 hover:text-white rounded-lg text-[9px] font-bold border border-white/5 transition-all text-left truncate"
                  title="Sol atardecer dorado + ambiental cielo"
                >
                  🌅 Sol Atardecer
                </button>
              </div>
            </div>

            {project.lights.map(light => (
              <div
                key={light.id}
                className={`p-2 rounded-xl border transition-all ${
                  selectedLightId === light.id 
                    ? 'bg-indigo-600/20 border-indigo-500/50 shadow-md shadow-indigo-500/10' 
                    : 'bg-zinc-900/50 border-white/5 hover:bg-zinc-800/80 hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    onClick={() => selectLight(light.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shadow-inner border cursor-pointer shrink-0"
                    style={{ background: `${light.color}22`, borderColor: `${light.color}55`, color: light.color }}
                    title="Click para editar detalles"
                  >
                    {light.type === 'POINT' ? '💡' : light.type === 'DIRECTIONAL' ? '☀️' : light.type === 'SPOT' ? '🔦' : light.type === 'AMBIENT' ? '🌍' : '▭'}
                  </div>
                  
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => selectLight(light.id)}>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-bold truncate text-zinc-200">{light.name}</p>
                      <span className="text-[9px] font-mono text-zinc-400 font-bold ml-1">{light.intensity} cd</span>
                    </div>
                    <p className="text-[9px] font-medium uppercase tracking-widest text-zinc-500">
                      {LIGHT_LABELS[light.type] || light.type}
                    </p>
                  </div>

                  {/* Toggle visibilidad rápida */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateLight(light.id, { visible: light.visible !== false ? false : true });
                    }}
                    className={`p-1 rounded text-xs transition-colors ${light.visible !== false ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                    title={light.visible !== false ? 'Ocultar luz' : 'Mostrar luz'}
                  >
                    {light.visible !== false ? '👁️' : '🕶️'}
                  </button>

                  <button
                    type="button"
                    onClick={() => selectLight(light.id)}
                    className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/10"
                    title="Propiedades"
                  >
                    <ChevronRight size={13} />
                  </button>
                </div>

                {/* Slider rápido de intensidad para cada luz en la lista */}
                <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center gap-2">
                  <Sun size={11} className="text-zinc-500 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.1"
                    value={light.intensity}
                    onChange={(e) => updateLight(light.id, { intensity: parseFloat(e.target.value) })}
                    className="flex-1 h-1 bg-zinc-800 rounded appearance-none accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-[8.5px] font-mono text-indigo-300 w-8 text-right shrink-0">
                    {safeFixed(light.intensity, 1)}
                  </span>
                </div>
              </div>
            ))}
            {project.lights.length === 0 && (
              <div className="py-6 text-center border border-dashed border-white/5 rounded-2xl bg-zinc-900/20">
                <p className="text-[10px] text-zinc-600 font-medium italic">No hay luces personalizadas</p>
              </div>
            )}
          </div>
        </Section>
        
        <Section title="Cámaras" icon={<Camera size={14}/>} badge={
          <button 
            onClick={(e) => { e.stopPropagation(); addCamera('PERSPECTIVE'); }}
            className="p-1.5 rounded-lg bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all border border-indigo-500/20"
          >
            <Plus size={12} />
          </button>
        }>
          <div className="space-y-1">
            {(project.cameras || []).map(cam => (
              <button
                key={cam.id}
                onClick={() => selectCamera(cam.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all group ${
                  selectedCameraId === cam.id 
                    ? 'bg-indigo-600/90 border-indigo-500/50 text-white shadow-lg shadow-indigo-500/20' 
                    : 'bg-zinc-900/50 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:border-white/10'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg shadow-inner border ${
                  selectedCameraId === cam.id ? 'bg-white/20 border-white/20' : 'bg-zinc-950/50 border-white/5'
                }`}>
                  🎥
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[11px] font-bold truncate">{cam.name}</p>
                  <p className={`text-[9px] font-medium uppercase tracking-widest opacity-60`}>
                    {cam.type} • {cam.fov}°
                  </p>
                </div>
                <ChevronRight size={14} className={`opacity-0 group-hover:opacity-100 transition-all ${selectedCameraId === cam.id ? 'text-white' : 'text-zinc-600'}`} />
              </button>
            ))}
            {(project.cameras || []).length === 0 && (
              <div className="py-6 text-center border border-dashed border-white/5 rounded-2xl bg-zinc-900/20">
                <p className="text-[10px] text-zinc-600 font-medium italic">No hay cámaras personalizadas</p>
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
};

const UngroupHeaderButton: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const ungroupSelectedObject = useStore(s => s.ungroupSelectedObject);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canUngroup = hasChildrenOrSubObjects(obj);

  const handleUngroup = async () => {
    if (!canUngroup || isWorking) return;
    setIsWorking(true);
    setStatusMsg(null);
    const res = await ungroupSelectedObject(obj.id);
    setIsWorking(false);
    setStatusMsg(res.message);
    setTimeout(() => setStatusMsg(null), 4000);
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-800/80">
      <button
        onClick={handleUngroup}
        disabled={!canUngroup || isWorking}
        className={`w-full py-1.5 px-2.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-2 transition-all shadow-md ${
          canUngroup
            ? 'bg-gradient-to-r from-purple-600 via-indigo-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white shadow-purple-950/40 border border-purple-400/40 cursor-pointer active:scale-[0.98]'
            : 'bg-zinc-800/60 text-zinc-500 border border-zinc-700/40 cursor-not-allowed opacity-60'
        }`}
        title="Desagrupar / Separar Conjunto: Extrae todos los sub-objetos del modelo y los posiciona de forma independiente en la escena"
      >
        <Split size={13} className={canUngroup ? 'text-purple-200 animate-pulse' : ''} />
        {isWorking ? 'Desagrupando objetos...' : 'Desagrupar / Separar Conjunto'}
      </button>
      {statusMsg && (
        <div className="mt-1 p-1 bg-purple-950/90 border border-purple-500/40 rounded text-[9px] text-purple-200 text-center font-medium animate-fadeIn">
          {statusMsg}
        </div>
      )}
    </div>
  );
};

const BooleanOperationsSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { project, openBooleanModal, executeExplicitBoolean } = useStore();
  const [selectedToolId, setSelectedToolId] = useState<string>('');
  const [keepTool, setKeepTool] = useState(false);
  const [autoHeal, setAutoHeal] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const candidateObjects = useMemo(() => {
    return project.objects.filter(o => o.id !== obj.id);
  }, [project.objects, obj.id]);

  useEffect(() => {
    if (candidateObjects.length > 0 && (!selectedToolId || !candidateObjects.some(o => o.id === selectedToolId))) {
      setSelectedToolId(candidateObjects[0].id);
    }
  }, [candidateObjects, selectedToolId]);

  const toolObj = useMemo(() => project.objects.find(o => o.id === selectedToolId), [project.objects, selectedToolId]);

  const handleQuickOp = async (op: UnifiedBooleanOp) => {
    if (!selectedToolId) {
      setFeedback({ type: 'error', message: 'Selecciona un objeto cortador / herramienta.' });
      return;
    }

    setIsWorking(true);
    setFeedback(null);
    try {
      const res = await executeExplicitBoolean({
        targetId: obj.id,
        toolId: selectedToolId,
        operation: op,
        keepTool,
        autoHeal,
        recenterPivot: true,
      });

      if (res.success) {
        setFeedback({
          type: 'success',
          message: `${res.message}`,
        });
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setFeedback({ type: 'error', message: res.message });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || String(e) });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Section
      title="Operaciones Booleanas (CSG)"
      icon={<Scissors size={14} className="text-rose-400" />}
      badge={
        <button
          onClick={(e) => {
            e.stopPropagation();
            openBooleanModal(obj.id, selectedToolId || undefined);
          }}
          className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white border border-indigo-500/30 transition-all flex items-center gap-1 cursor-pointer"
          title="Abrir el Estudio Booleano completo"
        >
          <Sparkles size={10} />
          Estudio
        </button>
      }
    >
      <div className="space-y-3">
        {candidateObjects.length === 0 ? (
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-center space-y-1.5">
            <p className="text-[11px] text-zinc-300 font-semibold">Se necesitan al menos 2 objetos</p>
            <p className="text-[10px] text-zinc-500">
              Añade otra figura o superficie para perforar, restar o fusionar con este objeto.
            </p>
          </div>
        ) : (
          <>
            {/* Roles configuration card */}
            <div className="p-2.5 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-blue-400 uppercase tracking-wide flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded-full bg-blue-950 border border-blue-500/40 flex items-center justify-center text-[8px] text-blue-300 font-bold">A</span>
                  Objeto Base (Este):
                </span>
                <span className="text-zinc-200 font-medium truncate max-w-[130px]">{obj.name}</span>
              </div>

              <div className="space-y-1 pt-1.5 border-t border-zinc-800/80">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-bold text-rose-400 uppercase tracking-wide flex items-center gap-1">
                    <span className="w-3.5 h-3.5 rounded-full bg-rose-950 border border-rose-500/40 flex items-center justify-center text-[8px] text-rose-300 font-bold">B</span>
                    Objeto Cortador / Herramienta:
                  </span>
                </div>
                <select
                  value={selectedToolId}
                  onChange={(e) => {
                    setSelectedToolId(e.target.value);
                    setFeedback(null);
                  }}
                  className="w-full bg-zinc-950 border border-zinc-700 hover:border-zinc-500 rounded-lg px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors font-medium"
                >
                  {candidateObjects.map(cand => (
                    <option key={cand.id} value={cand.id}>
                      {cand.name || `Objeto (${cand.type})`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Direct 1-Click Boolean Buttons */}
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider">Acciones Rápidas:</p>
              <div className="grid grid-cols-2 gap-1.5">
                {/* 1. A - B */}
                <button
                  disabled={isWorking}
                  onClick={() => handleQuickOp('DIFFERENCE_AB')}
                  className="p-2 rounded-lg bg-zinc-900 hover:bg-rose-950/60 border border-zinc-800 hover:border-rose-500/50 text-left transition-all group cursor-pointer"
                  title={`Restar "${toolObj?.name}" de "${obj.name}". Abre un hueco con la forma de B.`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-200 group-hover:text-rose-300 flex items-center gap-1">
                      <Scissors size={12} className="text-rose-400" />
                      Resta (A − B)
                    </span>
                  </div>
                  <p className="text-[8px] text-zinc-500 group-hover:text-zinc-400 mt-0.5">Abre hueco con B</p>
                </button>

                {/* 2. B - A */}
                <button
                  disabled={isWorking}
                  onClick={() => handleQuickOp('DIFFERENCE_BA')}
                  className="p-2 rounded-lg bg-zinc-900 hover:bg-amber-950/60 border border-zinc-800 hover:border-amber-500/50 text-left transition-all group cursor-pointer"
                  title={`Restar "${obj.name}" de "${toolObj?.name}".`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-200 group-hover:text-amber-300 flex items-center gap-1">
                      <Scissors size={12} className="text-amber-400 rotate-180" />
                      Invertida (B − A)
                    </span>
                  </div>
                  <p className="text-[8px] text-zinc-500 group-hover:text-zinc-400 mt-0.5">Resta A de B</p>
                </button>

                {/* 3. A + B */}
                <button
                  disabled={isWorking}
                  onClick={() => handleQuickOp('UNION')}
                  className="p-2 rounded-lg bg-zinc-900 hover:bg-emerald-950/60 border border-zinc-800 hover:border-emerald-500/50 text-left transition-all group cursor-pointer"
                  title="Fusionar ambos objetos en un único cuerpo sólido"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-200 group-hover:text-emerald-300 flex items-center gap-1">
                      <Combine size={12} className="text-emerald-400" />
                      Unión (A + B)
                    </span>
                  </div>
                  <p className="text-[8px] text-zinc-500 group-hover:text-zinc-400 mt-0.5">Fusionar sólidos</p>
                </button>

                {/* 4. A ∩ B */}
                <button
                  disabled={isWorking}
                  onClick={() => handleQuickOp('INTERSECTION')}
                  className="p-2 rounded-lg bg-zinc-900 hover:bg-sky-950/60 border border-zinc-800 hover:border-sky-500/50 text-left transition-all group cursor-pointer"
                  title="Conservar únicamente el volumen en común"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-200 group-hover:text-sky-300 flex items-center gap-1">
                      <Target size={12} className="text-sky-400" />
                      Intersección
                    </span>
                  </div>
                  <p className="text-[8px] text-zinc-500 group-hover:text-zinc-400 mt-0.5">Zona común (A ∩ B)</p>
                </button>
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center justify-between text-[10px] pt-1 text-zinc-400">
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={keepTool}
                  onChange={(e) => setKeepTool(e.target.checked)}
                  className="accent-indigo-500 rounded"
                />
                <span>Conservar B</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={autoHeal}
                  onChange={(e) => setAutoHeal(e.target.checked)}
                  className="accent-indigo-500 rounded"
                />
                <span>Auto-Curar</span>
              </label>
            </div>

            {/* Open Full Studio Button */}
            <button
              onClick={() => openBooleanModal(obj.id, selectedToolId || undefined)}
              className="w-full py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 hover:border-indigo-500 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Sparkles size={12} />
              Abrir Estudio Booleano Completo
            </button>

            {/* Diagnostic Message */}
            {feedback && (
              <div
                className={`p-2 rounded-lg text-[10px] border leading-tight ${
                  feedback.type === 'success'
                    ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/70 border-rose-500/40 text-rose-300'
                }`}
              >
                {feedback.message}
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
};

const ParticleSystemSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { updateObject, saveHistory, project } = useStore();
  const isParticle = obj.type === 'PARTICLE_SYSTEM' || !!obj.isParticleSystem || !!obj.parameters?.isParticleSystem;
  const pConfig: ParticleSystemConfig = {
    ...DEFAULT_PARTICLE_CONFIG,
    ...(obj.particleConfig || {}),
    ...(obj.parameters?.particleConfig || {}),
  };

  const updateParticle = (patch: Partial<ParticleSystemConfig>) => {
    const updated = { ...pConfig, ...patch };
    updateObject(obj.id, {
      isParticleSystem: true,
      particleConfig: updated,
      parameters: {
        ...(obj.parameters || {}),
        isParticleSystem: true,
        particleConfig: updated,
      }
    });
    saveHistory();
  };

  const spaceWarpObjects = project.objects.filter(o => o.isSpaceWarp || o.type === 'SPACE_WARP');

  return (
    <Section 
      title="Sistema de Partículas (Particle Flow / Spray)" 
      icon={<Sparkles size={12} className={isParticle ? "text-purple-400" : "text-zinc-400"} />}
    >
      <div className="space-y-3">
        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider block">Presets de Partículas (3ds Max)</span>
          <div className="grid grid-cols-2 gap-1.5">
            {PARTICLE_PRESETS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => updateParticle({ ...p.config })}
                className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700/90 border border-zinc-700/60 hover:border-purple-500/60 rounded-lg text-[9px] font-medium text-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer text-left group"
                title={p.desc}
              >
                <span className="text-base flex-shrink-0">{p.icon}</span>
                <div className="min-w-0">
                  <span className="truncate block font-bold text-[9px] text-zinc-200 group-hover:text-white">{p.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Emitter Setup */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Emisor & Generación</span>
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Tipo de Emisor</span>
            <select
              value={pConfig.emitterType || 'POINT'}
              onChange={e => updateParticle({ emitterType: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-purple-500"
            >
              <option value="POINT">Punto (Point)</option>
              <option value="BOX">Caja (Box)</option>
              <option value="SPHERE">Esfera (Sphere)</option>
              <option value="CIRCLE">Círculo (Circle)</option>
              <option value="RING">Anillo (Ring)</option>
            </select>
          </div>
          <NumRow label="Cantidad Total (Max)" value={pConfig.count ?? 400} onChange={v => updateParticle({ count: Math.round(v) })} min={10} max={2000} step={20} slider/>
          <NumRow label="Tasa de Nacimiento / seg" value={pConfig.birthRate ?? 60} onChange={v => updateParticle({ birthRate: Math.round(v) })} min={1} max={300} step={5} slider/>
          <NumRow label="Vida Útil (segundos)" value={pConfig.life ?? 3.5} onChange={v => updateParticle({ life: v })} min={0.2} max={15.0} step={0.1} slider/>
          <NumRow label="Velocidad Inicial" value={pConfig.speed ?? 2.2} onChange={v => updateParticle({ speed: v })} min={0.0} max={15.0} step={0.1} slider/>
          <NumRow label="Ángulo de Dispersión (°)" value={pConfig.spread ?? 25} onChange={v => updateParticle({ spread: v })} min={0} max={180} step={5} slider/>
        </div>

        {/* Appearance & Physics */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Dimensiones & Color</span>
          <NumRow label="Tamaño Partícula" value={pConfig.particleSize ?? 0.18} onChange={v => updateParticle({ particleSize: v })} min={0.02} max={2.0} step={0.02} slider/>
          <NumRow label="Crecimiento / Expansión" value={pConfig.growth ?? 0.5} onChange={v => updateParticle({ growth: v })} min={-1.0} max={3.0} step={0.1} slider/>
          <NumRow label="Giro / Rotación" value={pConfig.spin ?? 1.5} onChange={v => updateParticle({ spin: v })} min={0.0} max={8.0} step={0.2} slider/>
          
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Modo de Mezcla</span>
            <select
              value={pConfig.blending || 'additive'}
              onChange={e => updateParticle({ blending: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-purple-500"
            >
              <option value="additive">Aditivo (Brillo / Fuego / Magia)</option>
              <option value="normal">Normal (Nieve / Humo / Sólido)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <span className="text-[8px] text-zinc-400 font-bold uppercase block">Color Inicio</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={pConfig.colorStart || '#60a5fa'}
                  onChange={e => updateParticle({ colorStart: e.target.value })}
                  className="w-5 h-5 rounded bg-transparent cursor-pointer border border-zinc-700"
                />
                <span className="text-[8px] font-mono text-zinc-300">{pConfig.colorStart}</span>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[8px] text-zinc-400 font-bold uppercase block">Color Fin</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={pConfig.colorEnd || '#f43f5e'}
                  onChange={e => updateParticle({ colorEnd: e.target.value })}
                  className="w-5 h-5 rounded bg-transparent cursor-pointer border border-zinc-700"
                />
                <span className="text-[8px] font-mono text-zinc-300">{pConfig.colorEnd}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Space Warps Binding */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">Afectado por Space Warps</span>
            <input
              type="checkbox"
              checked={pConfig.affectedBySpaceWarps ?? true}
              onChange={e => updateParticle({ affectedBySpaceWarps: e.target.checked })}
              className="rounded bg-zinc-800 border-zinc-700 text-amber-500"
            />
          </div>
          <p className="text-[8px] text-zinc-400 leading-tight">
            Vincula fuerzas de gravedad, viento, turbulencia, vórtices y reflectores activos en la escena.
          </p>
          {spaceWarpObjects.length > 0 && (
            <div className="text-[8px] text-zinc-400 bg-zinc-900/60 p-1.5 rounded border border-zinc-800">
              <span className="font-semibold text-zinc-300">Deformadores detectados: </span>
              {spaceWarpObjects.map(w => w.name).join(', ')}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
};

const SpaceWarpSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { updateObject, saveHistory } = useStore();
  const isWarp = obj.type === 'SPACE_WARP' || !!obj.isSpaceWarp || !!obj.parameters?.isSpaceWarp;
  const wConfig: SpaceWarpConfig = {
    ...DEFAULT_SPACE_WARP_CONFIG,
    ...(obj.warpConfig || {}),
    ...(obj.parameters?.warpConfig || {}),
  };

  const updateWarp = (patch: Partial<SpaceWarpConfig>) => {
    const updated = { ...wConfig, ...patch };
    updateObject(obj.id, {
      isSpaceWarp: true,
      warpConfig: updated,
      parameters: {
        ...(obj.parameters || {}),
        isSpaceWarp: true,
        warpConfig: updated,
      }
    });
    saveHistory();
  };

  return (
    <Section 
      title="Deformador Espacial (Space Warp 3ds Max)" 
      icon={<Compass size={12} className={isWarp ? "text-amber-400" : "text-zinc-400"} />}
    >
      <div className="space-y-3">
        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider block">Presets de Fuerza Espacial</span>
          <div className="grid grid-cols-2 gap-1.5">
            {SPACE_WARP_PRESETS.map((w, idx) => (
              <button
                key={idx}
                onClick={() => updateWarp({ ...w.config })}
                className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700/90 border border-zinc-700/60 hover:border-amber-500/60 rounded-lg text-[9px] font-medium text-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer text-left group"
                title={w.desc}
              >
                <span className="text-base flex-shrink-0">{w.icon}</span>
                <div className="min-w-0">
                  <span className="truncate block font-bold text-[9px] text-zinc-200 group-hover:text-white">{w.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Warp Controls */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Tipo de Deformador</span>
            <select
              value={wConfig.warpType || 'WIND'}
              onChange={e => updateWarp({ warpType: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-amber-500"
            >
              <option value="WIND">Viento (Wind)</option>
              <option value="GRAVITY">Gravedad (Gravity)</option>
              <option value="VORTEX">Vórtice / Tornado (Vortex)</option>
              <option value="PUSH">Empuje / Atractor (Push)</option>
              <option value="DEFLECTOR">Deflector / Rebote (Deflector)</option>
              <option value="WAVE">Ondas Lineales (Wave)</option>
              <option value="RIPPLE">Ondas Radiales (Ripple)</option>
              <option value="MOTOR">Motor Rotacional (Motor)</option>
              <option value="DRAG">Fricción de Aire (Drag)</option>
              <option value="PBOMB">Bomba Expansiva (PBomb)</option>
            </select>
          </div>

          <NumRow label="Fuerza (Strength)" value={wConfig.strength ?? 1.5} onChange={v => updateWarp({ strength: v })} min={-20.0} max={20.0} step={0.2} slider/>
          <NumRow label="Alcance de Efecto (Range)" value={wConfig.range ?? 15.0} onChange={v => updateWarp({ range: v })} min={1.0} max={60.0} step={1.0} slider/>
          <NumRow label="Atenuación con Distancia (Decay)" value={wConfig.decay ?? 0.0} onChange={v => updateWarp({ decay: v })} min={0.0} max={3.0} step={0.1} slider/>

          {wConfig.warpType === 'WIND' && (
            <>
              <NumRow label="Turbulencia del Viento" value={wConfig.windTurbulence ?? 0.6} onChange={v => updateWarp({ windTurbulence: v })} min={0.0} max={3.0} step={0.1} slider/>
              <NumRow label="Frecuencia de Ráfagas" value={wConfig.windFrequency ?? 1.2} onChange={v => updateWarp({ windFrequency: v })} min={0.1} max={5.0} step={0.1} slider/>
            </>
          )}

          {wConfig.warpType === 'VORTEX' && (
            <>
              <NumRow label="Fuerza Espiral Radial" value={wConfig.vortexRadial ?? 2.0} onChange={v => updateWarp({ vortexRadial: v })} min={0.0} max={8.0} step={0.2} slider/>
              <NumRow label="Elevación Axial" value={wConfig.vortexAxial ?? 1.2} onChange={v => updateWarp({ vortexAxial: v })} min={0.0} max={8.0} step={0.2} slider/>
            </>
          )}

          {(wConfig.warpType === 'WAVE' || wConfig.warpType === 'RIPPLE') && (
            <>
              <NumRow label="Amplitud de Onda" value={wConfig.waveAmplitude ?? 0.4} onChange={v => updateWarp({ waveAmplitude: v })} min={0.05} max={3.0} step={0.05} slider/>
              <NumRow label="Longitud de Onda" value={wConfig.waveLength ?? 1.5} onChange={v => updateWarp({ waveLength: v })} min={0.2} max={6.0} step={0.1} slider/>
              <NumRow label="Velocidad de Propagación" value={wConfig.waveSpeed ?? 2.0} onChange={v => updateWarp({ waveSpeed: v })} min={0.1} max={10.0} step={0.2} slider/>
            </>
          )}

          {wConfig.warpType === 'DEFLECTOR' && (
            <>
              <NumRow label="Elasticidad de Rebote (Bounce)" value={wConfig.deflectorBounce ?? 0.75} onChange={v => updateWarp({ deflectorBounce: v })} min={0.0} max={1.0} step={0.05} slider/>
              <NumRow label="Fricción de Superficie" value={wConfig.deflectorFriction ?? 0.1} onChange={v => updateWarp({ deflectorFriction: v })} min={0.0} max={1.0} step={0.05} slider/>
            </>
          )}
        </div>
      </div>
    </Section>
  );
};

const GpgpuSwarmSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { updateObject, saveHistory, project } = useStore();
  const isGpgpu = obj.type === 'GPGPU_SWARM' || !!obj.isGpgpuSwarm || !!obj.parameters?.isGpgpuSwarm;
  const sCfg: GpgpuSwarmConfig = {
    ...DEFAULT_GPGPU_SWARM_CONFIG,
    ...(obj.gpgpuSwarmConfig || {}),
    ...(obj.parameters?.gpgpuSwarmConfig || {}),
  };

  const updateSwarm = (patch: Partial<GpgpuSwarmConfig>) => {
    const updated = { ...sCfg, ...patch };
    updateObject(obj.id, {
      isGpgpuSwarm: true,
      gpgpuSwarmConfig: updated,
      parameters: {
        ...(obj.parameters || {}),
        isGpgpuSwarm: true,
        gpgpuSwarmConfig: updated,
      }
    });
    saveHistory();
  };

  return (
    <Section
      title="Enjambre de Partículas GPGPU (Flow Field Particles)"
      icon={<Zap size={12} className={isGpgpu ? "text-cyan-400" : "text-zinc-400"} />}
      defaultOpen={isGpgpu}
    >
      <div className="space-y-3">
        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-wider block">Presets de Simulación GPU</span>
          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
            {GPGPU_SWARM_PRESETS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => updateSwarm({ ...p.config })}
                className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700/90 border border-zinc-700/60 hover:border-cyan-500/60 rounded-lg text-[9px] font-medium text-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer text-left group"
                title={p.desc}
              >
                <span className="text-base flex-shrink-0">{p.icon}</span>
                <div className="min-w-0">
                  <span className="truncate block font-bold text-[9px] text-zinc-200 group-hover:text-cyan-300">{p.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Core Mode & Particles */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Modo & Cantidad de Partículas</span>
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Algoritmo de Simulación</span>
            <select
              value={sCfg.mode || 'curl_noise'}
              onChange={e => updateSwarm({ mode: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-cyan-300 font-medium rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
            >
              <option value="curl_noise">Nebulosa Curl Noise</option>
              <option value="mesh_surface">Morfosis a Malla 3D (Base Model)</option>
              <option value="vortex_blackhole">Vórtice Agujero Negro</option>
              <option value="lorenz_attractor">Atractor de Lorenz</option>
              <option value="magnetic_dipole">Líneas de Campo Magnético</option>
              <option value="galaxy_spiral">Galaxia Espiral 3D</option>
              <option value="double_helix">Doble Hélice (ADN)</option>
              <option value="torus_knot">Nudo Toroidal (Trefoil)</option>
              <option value="spherical_flow">Capa Esférica Vibrante</option>
              <option value="cyber_neon">Cyberpunk Matrix Vortex</option>
              <option value="harmonic_wave">Ondas Armónicas Estacionarias</option>
            </select>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <span>Cantidad de Partículas GPU</span>
              <span className="font-mono text-cyan-400 font-bold text-xs">{(sCfg.count || 65536).toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-4 gap-1 pt-1">
              {[16384, 32768, 65536, 131072].map((count) => (
                <button
                  key={count}
                  onClick={() => updateSwarm({ count })}
                  className={`py-1 text-[9px] font-mono rounded border transition-colors cursor-pointer ${
                    (sCfg.count || 65536) === count
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >
                  {count >= 1000 ? `${Math.round(count / 1000)}k` : count}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3D Base Model Target Morphing */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span className="font-bold text-[9px] text-fuchsia-400 uppercase tracking-wider">Malla 3D Base / Morfosis</span>
            <select
              value={sCfg.meshTarget || 'none'}
              onChange={e => updateSwarm({ meshTarget: e.target.value as any, mode: e.target.value !== 'none' ? 'mesh_surface' : sCfg.mode })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-fuchsia-300 font-medium rounded px-2 py-1 focus:outline-none focus:border-fuchsia-500"
            >
              <option value="none">Sin Malla (Espacio Libre)</option>
              <option value="suzanne">Suzanne Monkey (Mono 3D)</option>
              <option value="stanford_bunny">Stanford Bunny (Conejo 3D)</option>
              <option value="torus_knot">Nudo Toroidal Trefoil</option>
              <option value="skull">Cráneo / Cabeza 3D</option>
              <option value="human_torso">Busto / Torso Humano</option>
              <option value="sphere">Esfera Smooth</option>
              <option value="cube">Cubo / Caja Bounding</option>
            </select>
          </div>
          {sCfg.meshTarget && sCfg.meshTarget !== 'none' && (
            <>
              <NumRow label="Atracción a Superficie" value={sCfg.surfaceAttraction ?? 0.85} onChange={v => updateSwarm({ surfaceAttraction: v })} min={0.0} max={1.0} step={0.02} slider/>
              <NumRow label="Dispersión Turbulenta" value={sCfg.surfaceDispersion ?? 0.35} onChange={v => updateSwarm({ surfaceDispersion: v })} min={0.0} max={2.0} step={0.05} slider/>
              <p className="text-[8px] text-zinc-400">Las partículas se adhieren dinámicamente a la superficie del modelo 3D y fluyen en turbulencia.</p>
            </>
          )}
        </div>

        {/* Physics & Flow Dynamics */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Dinámica & Fuerzas GPU</span>
          <NumRow label="Velocidad Simulación" value={sCfg.speed ?? 1.0} onChange={v => updateSwarm({ speed: v })} min={0.0} max={4.0} step={0.05} slider/>
          <NumRow label="Frecuencia de Ruido" value={sCfg.noiseFrequency ?? 0.35} onChange={v => updateSwarm({ noiseFrequency: v })} min={0.05} max={2.0} step={0.02} slider/>
          <NumRow label="Velocidad de Turbulencia" value={sCfg.noiseSpeed ?? 0.7} onChange={v => updateSwarm({ noiseSpeed: v })} min={0.0} max={3.0} step={0.05} slider/>
          <NumRow label="Fuerza de Remolino (Swirl)" value={sCfg.swirlForce ?? 1.8} onChange={v => updateSwarm({ swirlForce: v })} min={0.0} max={6.0} step={0.1} slider/>
          <NumRow label="Atracción al Centro" value={sCfg.attractionStrength ?? 0.8} onChange={v => updateSwarm({ attractionStrength: v })} min={-5.0} max={8.0} step={0.1} slider/>
          <NumRow label="Amortiguación (Damping)" value={sCfg.damping ?? 0.96} onChange={v => updateSwarm({ damping: v })} min={0.7} max={0.99} step={0.01} slider/>
          <NumRow label="Radio Delimitador" value={sCfg.boundingRadius ?? 6.5} onChange={v => updateSwarm({ boundingRadius: v })} min={1.0} max={20.0} step={0.5} slider/>

          {sCfg.mode === 'lorenz_attractor' && (
            <div className="pt-2 border-t border-zinc-800 space-y-1">
              <span className="text-[9px] font-bold text-amber-400 block">Parámetros del Atractor de Lorenz</span>
              <NumRow label="Sigma (σ)" value={sCfg.lorenzSigma ?? 10.0} onChange={v => updateSwarm({ lorenzSigma: v })} min={1.0} max={30.0} step={0.5} slider/>
              <NumRow label="Rho (ρ)" value={sCfg.lorenzRho ?? 28.0} onChange={v => updateSwarm({ lorenzRho: v })} min={1.0} max={60.0} step={0.5} slider/>
              <NumRow label="Beta (β)" value={sCfg.lorenzBeta ?? 2.666} onChange={v => updateSwarm({ lorenzBeta: v })} min={0.5} max={10.0} step={0.1} slider/>
            </div>
          )}

          {sCfg.mode === 'harmonic_wave' && (
            <div className="pt-2 border-t border-zinc-800 space-y-1">
              <span className="text-[9px] font-bold text-purple-400 block">Pulso Armónico & Reactividad de Ritmo</span>
              <NumRow label="Frecuencia del Pulso" value={sCfg.pulseSpeed ?? 1.2} onChange={v => updateSwarm({ pulseSpeed: v })} min={0.1} max={5.0} step={0.1} slider/>
              <NumRow label="Amplitud de Onda" value={sCfg.pulseAmplitude ?? 0.2} onChange={v => updateSwarm({ pulseAmplitude: v })} min={0.0} max={1.0} step={0.02} slider/>
            </div>
          )}
        </div>

        {/* Visual Styling, Shapes & 3D Lighting */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Apariencia, Iluminación 3D & Shading</span>
          <NumRow label="Tamaño de Partícula (px)" value={sCfg.particleSize ?? 6.0} onChange={v => updateSwarm({ particleSize: v })} min={1.0} max={32.0} step={0.5} slider/>
          
          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Forma de Partícula</span>
            <select
              value={sCfg.particleShape || 'glow_disc'}
              onChange={e => updateSwarm({ particleShape: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
            >
              <option value="glow_disc">Esfera con Brillo Suave (Glow Disc)</option>
              <option value="point">Punto Nítido</option>
              <option value="lit_sphere">Esfera con Iluminación 3D & Especular</option>
              <option value="star">Destello Estelar (Star)</option>
              <option value="sparkle">Chispa Diamante (Sparkle)</option>
              <option value="ring">Anillo Holográfico (Ring)</option>
              <option value="square">Píxel Cuadrado Matrix</option>
              <option value="streak">Estela de Flujo (Velocity Streak)</option>
            </select>
          </div>

          <NumRow label="Estiramiento por Velocidad (Streak)" value={sCfg.velocityStretch ?? 0.2} onChange={v => updateSwarm({ velocityStretch: v })} min={0.0} max={2.0} step={0.05} slider/>
          <NumRow label="Reactividad a Luces 3D (Shading)" value={sCfg.lightReactivity ?? 0.5} onChange={v => updateSwarm({ lightReactivity: v })} min={0.0} max={1.0} step={0.05} slider/>

          <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
            <span>Modo de Color / Paleta</span>
            <select
              value={sCfg.colorMode || 'velocity'}
              onChange={e => updateSwarm({ colorMode: e.target.value as any })}
              className="bg-zinc-800 border border-zinc-700 text-xs text-zinc-100 rounded px-2 py-1 focus:outline-none focus:border-cyan-500"
            >
              <option value="velocity">Gradiente por Velocidad</option>
              <option value="position">Paleta por Posición 3D</option>
              <option value="radial">Gradiente por Distancia Radial</option>
              <option value="monochrome">Color Sólido</option>
              <option value="rainbow">Ciclo Cromático Arcoíris</option>
              <option value="temperature">Gradiente Térmico / Plasma</option>
              <option value="cyber_neon">Cyberpunk Neón (Cian/Magenta)</option>
              <option value="aurora">Aurora Boreal (Esmeralda/Violeta)</option>
              <option value="sunset">Atardecer Twilight (Ámbar/Índigo)</option>
              <option value="ocean">Océano Eléctrico (Aguamarina/Azul)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-400">Color Primario</span>
              <input
                type="color"
                value={sCfg.colorStart || '#00f0ff'}
                onChange={e => updateSwarm({ colorStart: e.target.value })}
                className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-400">Color Secundario</span>
              <input
                type="color"
                value={sCfg.colorEnd || '#ff0077'}
                onChange={e => updateSwarm({ colorEnd: e.target.value })}
                className="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
              />
            </div>
          </div>

          <NumRow label="Opacidad" value={sCfg.opacity ?? 0.88} onChange={v => updateSwarm({ opacity: v })} min={0.05} max={1.0} step={0.02} slider/>

          <div className="flex items-center justify-between text-xs pt-1 text-zinc-300">
            <span>Mezcla Aditiva (Glow Luminoso)</span>
            <input
              type="checkbox"
              checked={sCfg.blending !== 'normal'}
              onChange={e => updateSwarm({ blending: e.target.checked ? 'additive' : 'normal' })}
              className="accent-cyan-500 cursor-pointer w-4 h-4"
            />
          </div>
        </div>

        {/* 3D Mouse Interaction */}
        <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span className="font-bold text-[9px] text-emerald-400 uppercase tracking-wider">Interacción con Cursor / Ratón 3D</span>
            <input
              type="checkbox"
              checked={sCfg.interactiveMouse !== false}
              onChange={e => updateSwarm({ interactiveMouse: e.target.checked })}
              className="accent-emerald-500 cursor-pointer w-4 h-4"
            />
          </div>
          {sCfg.interactiveMouse !== false && (
            <>
              <div className="flex items-center justify-between text-xs my-1 text-zinc-300">
                <span>Comportamiento del Cursor</span>
                <select
                  value={sCfg.mouseMode || 'attract'}
                  onChange={e => updateSwarm({ mouseMode: e.target.value as any })}
                  className="bg-zinc-800 border border-zinc-700 text-xs text-emerald-300 font-medium rounded px-2 py-1 focus:outline-none focus:border-emerald-500"
                >
                  <option value="attract">Atracción Magnética</option>
                  <option value="repel">Repulsión / Onda Expansiva</option>
                  <option value="vortex">Vórtice Giratorio (Tornado)</option>
                  <option value="wave">Onda de Choque Ondulante</option>
                </select>
              </div>
              <NumRow label="Fuerza del Cursor" value={sCfg.mouseForce ?? 4.5} onChange={v => updateSwarm({ mouseForce: v })} min={-15.0} max={15.0} step={0.5} slider/>
              <NumRow label="Radio de Influencia" value={sCfg.mouseRadius ?? 4.0} onChange={v => updateSwarm({ mouseRadius: v })} min={0.5} max={12.0} step={0.2} slider/>
            </>
          )}
        </div>
      </div>
    </Section>
  );
};

const VolumetricSection: React.FC<{ obj: CSGObject }> = ({ obj }) => {
  const { updateObject, saveHistory } = useStore();
  const isVol = obj.type === 'VOLUME_CLOUD' || !!obj.isVolumetric || !!obj.parameters?.isVolumetric;
  const volConfig: VolumetricConfig = {
    ...DEFAULT_VOLUMETRIC_CONFIG,
    ...(obj.volumetric || {}),
    ...(obj.parameters?.volumetric || {}),
  };

  const handleToggle = (enabled: boolean) => {
    updateObject(obj.id, {
      isVolumetric: enabled,
      volumetric: { ...volConfig, enabled },
      parameters: {
        ...(obj.parameters || {}),
        isVolumetric: enabled,
        volumetric: { ...volConfig, enabled },
      }
    });
    saveHistory();
  };

  const updateVol = (patch: Partial<VolumetricConfig>) => {
    const updated = { ...volConfig, ...patch };
    updateObject(obj.id, {
      isVolumetric: true,
      volumetric: updated,
      parameters: {
        ...(obj.parameters || {}),
        isVolumetric: true,
        volumetric: updated,
      }
    });
    saveHistory();
  };

  const applyPreset = (preset: typeof VOLUMETRIC_PRESETS[0]) => {
    updateVol({ ...preset.config });
  };

  return (
    <Section 
      title="Nube Volumétrica 3D & Dispersión 2026" 
      icon={<Cloud size={12} className={isVol ? "text-sky-400" : "text-zinc-400"} />}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between p-2 bg-zinc-950/60 rounded-lg border border-zinc-800">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-zinc-200">Shader Atmosférico 2026</span>
            <span className="text-[8px] text-zinc-400">Raymarching con Mie Henyey-Greenstein y Silver Lining</span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={isVol} 
              onChange={e => handleToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-sky-500"></div>
          </label>
        </div>

        {isVol && (
          <div className="space-y-3 pt-1">
            {/* Presets */}
            <div className="space-y-1.5">
              <span className="text-[9px] font-bold text-sky-400 uppercase tracking-wider block">Presets de Nubes y Atmósfera</span>
              <div className="grid grid-cols-2 gap-1.5">
                {VOLUMETRIC_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => applyPreset(p)}
                    className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700/90 border border-zinc-700/60 hover:border-amber-500/60 rounded-lg text-[9px] font-medium text-zinc-200 transition-all flex items-center gap-1.5 cursor-pointer text-left group"
                    title={p.desc}
                  >
                    <span className="text-base flex-shrink-0">{p.icon}</span>
                    <div className="min-w-0">
                      <span className="truncate block font-bold text-[9px] text-zinc-200 group-hover:text-white">{p.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 2026 Atmospheric Scattering Parameters */}
            <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-sky-800/40">
              <span className="text-[9px] font-bold text-sky-300 uppercase tracking-wider block">Dispersión Atmosférica & Silver Lining</span>
              <NumRow
                label="Crestas Plateadas (Silver Lining)"
                value={volConfig.silverLining ?? 0.8}
                onChange={v => updateVol({ silverLining: v })}
                min={0.0}
                max={3.0}
                step={0.1}
                slider
              />
              <NumRow
                label="Anisotropía Mie (g Forward)"
                value={volConfig.anisotropyG ?? 0.6}
                onChange={v => updateVol({ anisotropyG: v })}
                min={0.0}
                max={0.95}
                step={0.05}
                slider
              />
              <NumRow
                label="Cobertura de Nube"
                value={volConfig.coverage ?? 0.0}
                onChange={v => updateVol({ coverage: v })}
                min={-0.6}
                max={0.8}
                step={0.05}
                slider
              />
              <NumRow
                label="Luz Ambiental Interna"
                value={volConfig.ambientBoost ?? 0.3}
                onChange={v => updateVol({ ambientBoost: v })}
                min={0.0}
                max={2.0}
                step={0.05}
                slider
              />
              <NumRow
                label="Desvanecimiento por Altitud"
                value={Array.isArray(volConfig.altitudeFade) ? volConfig.altitudeFade[0] : (volConfig.altitudeFade ?? 0.15)}
                onChange={v => updateVol({ altitudeFade: v })}
                min={0.0}
                max={1.0}
                step={0.05}
                slider
              />
            </div>

            {/* Sliders */}
            <div className="space-y-2 bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
              <span className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider block">Densidad & Raymarching</span>
              <NumRow
                label="Densidad de Nube"
                value={volConfig.density ?? 1.5}
                onChange={v => updateVol({ density: v })}
                min={0.1}
                max={8.0}
                step={0.1}
                slider
              />
              <NumRow
                label="Escala Ruido FBM"
                value={volConfig.scale ?? 2.0}
                onChange={v => updateVol({ scale: v })}
                min={0.5}
                max={10.0}
                step={0.1}
                slider
              />
              <NumRow
                label="Intensidad Iluminación"
                value={volConfig.lightIntensity ?? 1.2}
                onChange={v => updateVol({ lightIntensity: v })}
                min={0.1}
                max={4.0}
                step={0.1}
                slider
              />
              <NumRow
                label="Corte Umbral Mín."
                value={volConfig.threshold ?? 0.38}
                onChange={v => updateVol({ threshold: v })}
                min={0.0}
                max={0.9}
                step={0.02}
                slider
              />
              <NumRow
                label="Corte Umbral Máx."
                value={volConfig.thresholdMax ?? 0.82}
                onChange={v => updateVol({ thresholdMax: v })}
                min={0.1}
                max={1.0}
                step={0.02}
                slider
              />
              <NumRow
                label="Absorción de Luz (Beer)"
                value={volConfig.absorption ?? 2.0}
                onChange={v => updateVol({ absorption: v })}
                min={0.1}
                max={6.0}
                step={0.1}
                slider
              />
              <NumRow
                label="Pasos de Raymarching"
                value={volConfig.steps ?? 32}
                onChange={v => updateVol({ steps: Math.round(v) })}
                min={16}
                max={96}
                step={4}
                slider
              />
              <NumRow
                label="Pasos de Sombra"
                value={volConfig.shadowSteps ?? 6}
                onChange={v => updateVol({ shadowSteps: Math.round(v) })}
                min={2}
                max={16}
                step={1}
                slider
              />
              <NumRow
                label="Velocidad Viento / Deriva"
                value={volConfig.windSpeed ?? 0.08}
                onChange={v => updateVol({ windSpeed: v })}
                min={0.0}
                max={1.0}
                step={0.01}
                slider
              />
            </div>

            {/* Colors */}
            <div className="bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/60">
              <div className="space-y-1">
                <span className="text-[9px] text-zinc-400 font-bold uppercase block">Color Nube / Gas</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={volConfig.color || '#ffffff'}
                    onChange={e => updateVol({ color: e.target.value })}
                    className="w-6 h-6 rounded bg-transparent cursor-pointer border border-zinc-700"
                  />
                  <span className="text-[9px] font-mono text-zinc-300">{volConfig.color || '#ffffff'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
};

export const PropertiesPanel: React.FC = () => {
  const {
    project, selectedObjectId, selectedObjectIds, updateObject, removeObject, removeObjects,
    duplicateObject, saveHistory, selectObject, toggleObjectSelection,
    moveObjectUp, moveObjectDown, selectedLightId, selectedCameraId,
    removeLight, removeCamera, selectLight, selectCamera, updateLight, editMode, setEditMode
  } = useStore();

  const [activeTab, setActiveTab] = useState<'PROPERTIES' | 'HISTORIAL' | 'EDIT_MESH' | 'MATERIALS' | 'SCENE' | 'CONFIG'>('PROPERTIES');
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [shortcutsFloating, setShortcutsFloating] = useState(false);
  const obj = project.objects.find(o => o.id === selectedObjectId);
  const [isExporting, setIsExporting] = useState(false);

  // Auto-switch tabs based on selection or edit mode
  useEffect(() => {
    if (selectedLightId || selectedCameraId) {
      setActiveTab('SCENE');
    } else if (editMode !== 'OBJECT') {
      setActiveTab('EDIT_MESH');
    }
  }, [selectedObjectId, selectedLightId, selectedCameraId, editMode]);

  const handleExport = async (format: 'GLB' | 'GLTF' | 'OBJ') => {
    const objectsToExport = (selectedObjectIds && selectedObjectIds.length > 0)
      ? project.objects.filter(o => selectedObjectIds.includes(o.id))
      : obj ? [obj] : project.objects;

    if (objectsToExport.length === 0) return;

    setIsExporting(true);
    try {
      if (format === 'GLB') await Exporter.exportGLTF(objectsToExport, project.materials, true);
      else if (format === 'GLTF') await Exporter.exportGLTF(objectsToExport, project.materials, false);
      else if (format === 'OBJ') await Exporter.exportOBJ(objectsToExport, project.materials);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setIsExporting(false);
    }
  };

  const handleAutoFitSelectedObject = async (targetObj: CSGObject) => {
    let targetObjOrGeo: THREE.Object3D | THREE.BufferGeometry | null = null;

    if (targetObj.meshData) {
      if (targetObj.meshData.type === 'obj') {
        targetObjOrGeo = await new Promise<THREE.Object3D>((res, rej) =>
          new OBJLoader().load(targetObj.meshData!.data, res, undefined, rej)
        ).catch(() => null);
      } else if (targetObj.meshData.type === 'stl') {
        targetObjOrGeo = await new Promise<THREE.BufferGeometry>((res, rej) =>
          new STLLoader().load(targetObj.meshData!.data, res, undefined, rej)
        ).catch(() => null);
      } else if (targetObj.meshData.type === 'gltf') {
        const gltf = await new Promise<any>((res, rej) => {
          const loader = new GLTFLoader();
          const dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
          loader.setDRACOLoader(dracoLoader);
          loader.load(targetObj.meshData!.data, res, undefined, rej);
        }).catch(() => null);
        if (gltf?.scene) targetObjOrGeo = gltf.scene;
      }
    } else if (targetObj.vertices && targetObj.vertices.length > 0) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(targetObj.vertices.flat());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      targetObjOrGeo = geo;
    }

    if (!targetObjOrGeo) return;

    const box = new THREE.Box3();
    if ((targetObjOrGeo as THREE.BufferGeometry).isBufferGeometry) {
      const geo = targetObjOrGeo as THREE.BufferGeometry;
      geo.computeBoundingBox();
      if (geo.boundingBox) box.copy(geo.boundingBox);
    } else {
      box.setFromObject(targetObjOrGeo as THREE.Object3D);
    }

    if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.x)) return;

    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return;

    const center = new THREE.Vector3();
    box.getCenter(center);

    const targetSize = 3.0;
    let scaleFactor = maxDim > 0 ? targetSize / maxDim : 1;
    scaleFactor = safeParseFixed(scaleFactor, 4, 1);

    const posX = safeParseFixed(-center.x * scaleFactor, 3, 0);
    const posY = safeParseFixed(-box.min.y * scaleFactor, 3, 0);
    const posZ = safeParseFixed(-center.z * scaleFactor, 3, 0);

    updateObject(targetObj.id, {
      transform: {
        ...targetObj.transform,
        scale: [scaleFactor, scaleFactor, scaleFactor],
        position: [posX, posY, posZ],
      }
    });
    saveHistory();
  };

  return (
    <div className="h-full bg-zinc-950 border-l border-zinc-800 flex flex-col overflow-hidden select-none">
      
      {/* ── Tabs Superiores de Herramientas (Cuadrícula 3x2: Todos los nombres siempre visibles y accesibles) ─────────────────── */}
      <div className="border-b border-zinc-800/90 bg-zinc-950/90 p-1.5 shrink-0">
        <div className="grid grid-cols-3 gap-1">
          <button 
            id="tab-btn-properties"
            onClick={() => setActiveTab('PROPERTIES')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'PROPERTIES' 
                ? 'text-indigo-300 bg-indigo-500/20 border border-indigo-500/50 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Propiedades y parámetros del objeto seleccionado"
          >
            <Settings size={12} className={activeTab === 'PROPERTIES' ? 'text-indigo-400' : 'text-zinc-400'} />
            <span className="truncate">Propiedades</span>
          </button>

          <button 
            id="tab-btn-historial"
            onClick={() => setActiveTab('HISTORIAL')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'HISTORIAL' 
                ? 'text-amber-300 bg-amber-500/20 border border-amber-500/50 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Historial de herramientas y pasos para volver directamente a cualquier estado anterior"
          >
            <History size={12} className={activeTab === 'HISTORIAL' ? 'text-amber-400' : 'text-zinc-400'} />
            <span className="truncate">Historial</span>
          </button>

          <button 
            id="tab-btn-edit-mesh"
            onClick={() => {
              setActiveTab('EDIT_MESH');
              setEditMode('OBJECT');
            }}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'EDIT_MESH' 
                ? 'text-emerald-300 bg-emerald-500/20 border border-emerald-500/50 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Editar Malla: añadir líneas, segmentos, nuevos vértices y polígonos"
          >
            <Scissors size={12} className={activeTab === 'EDIT_MESH' ? 'text-emerald-400' : 'text-zinc-400'} />
            <span className="truncate">Malla</span>
          </button>

          <button 
            id="tab-btn-materials"
            onClick={() => setActiveTab('MATERIALS')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'MATERIALS' 
                ? 'text-purple-300 bg-purple-500/20 border border-purple-500/50 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Biblioteca y edición de materiales PBR"
          >
            <Palette size={12} className={activeTab === 'MATERIALS' ? 'text-purple-400' : 'text-zinc-400'} />
            <span className="truncate">Materiales</span>
          </button>

          <button 
            id="tab-btn-scene"
            onClick={() => setActiveTab('SCENE')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'SCENE' 
                ? 'text-sky-300 bg-sky-500/20 border border-sky-500/50 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Iluminación, cámaras y entorno de la escena"
          >
            <Globe size={12} className={activeTab === 'SCENE' ? 'text-sky-400' : 'text-zinc-400'} />
            <span className="truncate">Escena</span>
          </button>

          <button 
            id="tab-btn-config"
            onClick={() => setActiveTab('CONFIG')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-semibold transition-all cursor-pointer select-none ${
              activeTab === 'CONFIG' 
                ? 'text-zinc-200 bg-zinc-800 border border-zinc-600/70 shadow-xs' 
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/50'
            }`}
            title="Configuración, atajos de teclado y preferencias"
          >
            <SlidersHorizontal size={12} className={activeTab === 'CONFIG' ? 'text-zinc-300' : 'text-zinc-400'} />
            <span className="truncate">Config</span>
          </button>
        </div>
      </div>

      {activeTab === 'HISTORIAL' ? (
        <HistoryPanel />
      ) : activeTab === 'EDIT_MESH' ? (
        <EditMeshPanel />
      ) : activeTab === 'MATERIALS' ? (
        <MaterialPanel />
      ) : activeTab === 'SCENE' ? (
        <SceneManager />
      ) : activeTab === 'CONFIG' ? (
        <ConfigPanel
          onOpenShortcutsModal={(floating) => {
            setShortcutsFloating(floating ?? false);
            setShowShortcutsModal(true);
          }}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ── Propiedades del objeto ─────────────────────────────────────────── */}
          {!obj ? (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-zinc-600">
                <Box size={24} className="opacity-20"/>
                <p className="text-[10px] uppercase tracking-widest font-bold">Propiedades</p>
                <p className="text-[10px] italic">Selecciona un objeto</p>
              </div>
              
              <div className="border-t border-zinc-800">
                <Section title="Exportar Proyecto" icon={<Download size={12}/>}>
                  <div className="space-y-2">
                    <p className="text-[9px] text-zinc-500 leading-relaxed">
                      Exporta todo el proyecto actual con texturas.
                    </p>
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('GLB')}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <FileDown size={12}/> {isExporting ? 'Exportando...' : 'Exportar Proyecto (GLB)'}
                    </button>
                    <div className="grid grid-cols-2 gap-1">
                      <button 
                        disabled={isExporting}
                        onClick={() => handleExport('GLTF')}
                        className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors"
                      >
                        GLTF
                      </button>
                      <button 
                        disabled={isExporting}
                        onClick={() => handleExport('OBJ')}
                        className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors"
                      >
                        OBJ
                      </button>
                    </div>
                  </div>
                </Section>
              </div>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 bg-zinc-900/40 border-b border-zinc-800">
                <input
                  value={obj.name}
                  onChange={e => updateObject(obj.id, { name: e.target.value })}
                  className="w-full bg-transparent text-[12px] font-bold text-zinc-100 focus:outline-none"
                />
                <div className="flex gap-1.5 mt-1">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${TYPE_COLORS[obj.type] ?? 'bg-zinc-700'}`}>
                    {TYPE_LABELS[obj.type] ?? obj.type}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${OPERATION_COLORS[obj.operation]}`}>
                    {OPERATION_LABELS[obj.operation]}
                  </span>
                </div>
                <UngroupHeaderButton obj={obj} />
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                <Section title="Apariencia">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 w-20">Color</span>
                    <input type="color" value={obj.color} onChange={e => updateObject(obj.id, { color: e.target.value })} className="w-8 h-6 rounded bg-transparent cursor-pointer p-0" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 w-20">Operación</span>
                    <select 
                      value={obj.operation} 
                      onChange={e => updateObject(obj.id, { operation: e.target.value as any })}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ADD">Unión</option>
                      <option value="SUBTRACT">Resta</option>
                      <option value="INTERSECT">Intersección</option>
                    </select>
                  </div>
                  <NumRow label="Opacidad" value={obj.opacity ?? 1} onChange={v => updateObject(obj.id, { opacity: v })} min={0} max={1} slider />
                </Section>

                <Section title="Transformación" icon={<Move size={12}/>}>
                  <XYZRow label="Posición" values={obj.transform.position} onChange={v => updateObject(obj.id, { transform: { ...obj.transform, position: v } })} step={0.1} />
                  <RotationXYZRow label="Rotación" values={obj.transform.rotation} onChange={v => updateObject(obj.id, { transform: { ...obj.transform, rotation: v } })} />
                  <XYZRow label="Escala" values={obj.transform.scale} onChange={v => updateObject(obj.id, { transform: { ...obj.transform, scale: v } })} step={0.1} min={0.01} />
                  <button
                    onClick={() => handleAutoFitSelectedObject(obj)}
                    className="w-full mt-2 py-1.5 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    title="Ajusta automáticamente la escala y posición para que el objeto quepa perfectamente en la vista"
                  >
                    <Maximize2 size={12} />
                    Auto-escalar y Centrar
                  </button>
                </Section>

                <NurbsSection obj={obj}/>
                <SubElementEditSection obj={obj}/>
                <ParametersSection obj={obj}/>
                <GeneratedSection obj={obj}/>
                <GpgpuSwarmSection obj={obj}/>
                <ParticleSystemSection obj={obj}/>
                <SpaceWarpSection obj={obj}/>
                <AlignSection obj={obj}/>
                <BooleanOperationsSection obj={obj}/>
                <VolumetricSection obj={obj}/>
                <ObjectMaterialSection obj={obj} onOpenMaterialTab={() => setActiveTab('MATERIALS')}/>
                <OptimizeMeshSection obj={obj}/>
                <MeshModifiersSection obj={obj}/>
                <ValidationSection obj={obj}/>

                <Section title="Estadísticas" defaultOpen={false}>
                  {(() => {
                    const quadsCount = obj.stats?.quads ?? obj.faces?.filter(f => f.indices?.length === 4).length ?? 0;
                    const hasQuads = quadsCount > 0;
                    return (
                      <div className={`grid ${hasQuads ? 'grid-cols-4' : 'grid-cols-3'} gap-1`}>
                        <div className="bg-zinc-800 p-2 rounded border border-zinc-700/50">
                          <p className="text-[9px] text-zinc-300 uppercase">Vértices</p>
                          <p className="text-[13px] font-bold font-mono text-white">{(obj.stats?.vertices ?? obj.vertices?.length ?? 0).toLocaleString()}</p>
                        </div>
                        <div className="bg-zinc-800 p-2 rounded border border-zinc-700/50">
                          <p className="text-[9px] text-emerald-400 uppercase font-semibold">Aristas</p>
                          <p className="text-[13px] font-bold font-mono text-emerald-300">{extractUniqueEdges(obj).length.toLocaleString()}</p>
                        </div>
                        <div className="bg-zinc-800 p-2 rounded border border-zinc-700/50">
                          <p className="text-[9px] text-zinc-300 uppercase">Caras</p>
                          <p className="text-[13px] font-bold font-mono text-white">{(obj.stats?.faces ?? obj.faces?.length ?? 0).toLocaleString()}</p>
                        </div>
                        {hasQuads && (
                          <div className="bg-violet-950/40 p-2 rounded border border-violet-500/40">
                            <p className="text-[9px] text-violet-300 uppercase font-semibold">Quads</p>
                            <p className="text-[13px] font-bold font-mono text-fuchsia-300">{quadsCount.toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </Section>

                <Section title="Exportar" icon={<Download size={12}/>} defaultOpen={false}>
                  <div className="space-y-2">
                    <p className="text-[9px] text-zinc-500 leading-relaxed">
                      Exporta la selección actual con texturas.
                    </p>
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('GLB')}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <FileDown size={12}/> {isExporting ? 'Exportando...' : 'Exportar GLB'}
                    </button>
                    <div className="grid grid-cols-2 gap-1">
                      <button 
                        disabled={isExporting}
                        onClick={() => handleExport('GLTF')}
                        className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors"
                      >
                        GLTF
                      </button>
                      <button 
                        disabled={isExporting}
                        onClick={() => handleExport('OBJ')}
                        className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors"
                      >
                        OBJ
                      </button>
                    </div>
                  </div>
                </Section>
              </div>

              <div className="p-2 border-t border-zinc-800 flex gap-1.5 bg-zinc-900/20">
                <button onClick={() => duplicateObject(obj.id)} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] font-semibold">
                  <Copy size={12}/> Duplicar
                </button>
                <button onClick={() => { removeObject(obj.id); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-300 rounded text-[10px] font-semibold">
                  <Trash2 size={12}/> Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Modal / Panel Flotante de Atajos de Teclado ── */}
      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
        isFloatingInitially={shortcutsFloating}
      />
    </div>
  );
};