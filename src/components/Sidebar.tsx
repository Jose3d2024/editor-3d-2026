import React, { useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
  Trash2, Copy, Eye, EyeOff,
  ChevronDown, ChevronRight, Settings2, Layers, Sliders,
  AlignCenterHorizontal, AlignCenterVertical, AlignStartHorizontal,
  AlignEndHorizontal, AlignStartVertical, AlignEndVertical,
  CheckCircle, AlertTriangle, Wrench, Wand2, Maximize2,
  Move, RotateCw, Download, FileDown, Split, Grid,
  Lock, Unlock
} from 'lucide-react';
import { CSGOperation, PrimitiveType } from '../types';
import { validateMesh } from '../utils/modifiers';
import { Exporter } from '../utils/exporters';
import { hasChildrenOrSubObjects } from '../utils/ungroup';
import { safeFixed, safeNum, safeParseFixed } from '../utils/numberUtils';

// ─── Section accordion ────────────────────────────────────────────────────────
const Section = ({ title, icon: Icon, children, defaultOpen = true, badge }: {
  title: string; icon: any; children: React.ReactNode;
  defaultOpen?: boolean; badge?: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 p-1.5 sm:p-2 hover:bg-white/5 transition-colors text-zinc-400 hover:text-zinc-200"
      >
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest flex-1 text-left">{title}</span>
        {badge}
      </button>
      {isOpen && <div className="bg-black/20">{children}</div>}
    </div>
  );
};

// ─── Slider + number input row ────────────────────────────────────────────────
const PropRow = ({
  label, value, min, max, step = 0.01, onChange, integer = false,
}: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; integer?: boolean;
  key?: string | number;
}) => {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase text-zinc-500 font-bold">{label}</label>
        <input
          type="number"
          value={isNaN(value) ? '' : (integer ? Math.round(safeNum(value)) : safeParseFixed(value, 3, 0))}
          min={min} max={max} step={step}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v)); }}
          className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-right focus:outline-none focus:border-indigo-500"
        />
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={isNaN(value) ? min : value}
        onChange={e => onChange(clamp(parseFloat(e.target.value)))}
        className="w-full h-1 accent-indigo-500 cursor-pointer"
      />
    </div>
  );
};

// ─── XYZ precise numeric input row ───────────────────────────────────────────
const XYZRow = ({
  label, values, onChange, step = 0.01, min = -Infinity, max = Infinity, lockable = label.toLowerCase().includes('escala') || label.toLowerCase().includes('scale')
}: {
  label: string;
  values: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number; min?: number; max?: number;
  lockable?: boolean;
}) => {
  const [locked, setLocked] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase text-zinc-500 font-bold">{label}</label>
        {lockable && (
          <button
            type="button"
            onClick={() => setLocked(!locked)}
            className={`flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded transition-all cursor-pointer ${
              locked ? 'bg-amber-500/20 text-amber-400 font-bold' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={locked ? 'Desbloquear ejes para escalar por separado' : 'Bloquear ejes para escalar conjuntamente'}
          >
            {locked ? <Lock size={9} /> : <Unlock size={9} />}
            <span>{locked ? 'Bloqueado' : 'Libre'}</span>
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(['X', 'Y', 'Z'] as const).map((ax, i) => (
          <div key={ax} className="flex items-center gap-1">
            <span className="text-[9px] font-bold" style={{ color: i===0?'#f87171':i===1?'#4ade80':'#60a5fa' }}>{ax}</span>
            <input
              type="number" step={step}
              value={safeParseFixed(values?.[i], 4, 0)}
              onChange={e => {
                const v = parseFloat(e.target.value);
                if (isNaN(v)) return;
                const clamped = Math.min(max, Math.max(min, v));
                if (locked) {
                  const ratio = values[i] !== 0 ? clamped / values[i] : 1;
                  const next: [number, number, number] = [
                    i === 0 ? clamped : Math.min(max, Math.max(min, values[0] * ratio)),
                    i === 1 ? clamped : Math.min(max, Math.max(min, values[1] * ratio)),
                    i === 2 ? clamped : Math.min(max, Math.max(min, values[2] * ratio))
                  ];
                  onChange(next);
                } else {
                  const next: [number,number,number] = [...values] as any;
                  next[i] = clamped;
                  onChange(next);
                }
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Geometry params per primitive type ──────────────────────────────────────
const PARAM_DEFS: Record<PrimitiveType, {
  key: string; label: string; min: number; max: number; step?: number; integer?: boolean;
}[]> = {
  CUBE:         [{ key: 'segments',       label: 'Subdivisión',     min: 1,    max: 128, step: 1,    integer: true }],
  SPHERE:       [{ key: 'segments',       label: 'Segmentos',       min: 3,    max: 256, step: 1,    integer: true }],
  CYLINDER:     [
    { key: 'segments',       label: 'Seg. radiales',   min: 3,    max: 256, step: 1,    integer: true },
    { key: 'heightSegments', label: 'Seg. altura',     min: 1,    max: 128, step: 1,    integer: true },
  ],
  CONE:         [
    { key: 'segments',       label: 'Seg. radiales',   min: 3,    max: 256, step: 1,    integer: true },
    { key: 'heightSegments', label: 'Seg. altura',     min: 1,    max: 128, step: 1,    integer: true },
  ],
  TORUS: [
    { key: 'radius',          label: 'Radio mayor',    min: 0.1,  max: 10,  step: 0.05 },
    { key: 'tube',            label: 'Radio tubo',     min: 0.01, max: 5,   step: 0.02 },
    { key: 'radialSegments',  label: 'Seg. radiales',  min: 3,    max: 256, step: 1, integer: true },
    { key: 'tubularSegments', label: 'Seg. tubulares', min: 6,    max: 512, step: 1, integer: true },
  ],
  ICOSAHEDRON:  [{ key: 'detail', label: 'Detalle', min: 0, max: 8, step: 1, integer: true }],
  DODECAHEDRON: [{ key: 'detail', label: 'Detalle', min: 0, max: 8, step: 1, integer: true }],
  TETRAHEDRON:  [{ key: 'detail', label: 'Detalle', min: 0, max: 8, step: 1, integer: true }],
  OCTAHEDRON:   [{ key: 'detail', label: 'Detalle', min: 0, max: 8, step: 1, integer: true }],
  PYRAMID:      [{ key: 'heightSegments', label: 'Seg. altura', min: 1, max: 128, step: 1, integer: true }],
  PRISM:        [{ key: 'heightSegments', label: 'Seg. altura', min: 1, max: 128, step: 1, integer: true }],
  CAPSULE:      [{ key: 'segments',       label: 'Segmentos',   min: 4, max: 128, step: 1, integer: true }],
  HEMISPHERE:   [{ key: 'segments',       label: 'Segmentos',   min: 4, max: 256, step: 1, integer: true }],
  WEDGE:        [],
  TUBE: [
    { key: 'innerRadius', label: 'Radio interior', min: 0.01, max: 10, step: 0.05 },
    { key: 'outerRadius', label: 'Radio exterior', min: 0.05, max: 12, step: 0.05 },
    { key: 'segments',    label: 'Segmentos',      min: 3,    max: 256, step: 1, integer: true },
  ],
  ARC: [
    { key: 'arcAngle',    label: 'Ángulo (°)',      min: 1,    max: 360, step: 1, integer: true },
    { key: 'innerRadius', label: 'Radio interior', min: 0.01, max: 10,  step: 0.05 },
    { key: 'outerRadius', label: 'Radio exterior', min: 0.05, max: 12,  step: 0.05 },
    { key: 'height',      label: 'Altura',         min: 0.05, max: 10,  step: 0.05 },
    { key: 'segments',    label: 'Segmentos',      min: 3,    max: 256, step: 1, integer: true },
  ],
  STAR: [
    { key: 'starPoints',  label: 'Puntas',          min: 3,    max: 32,  step: 1, integer: true },
    { key: 'innerRadius', label: 'Radio interior', min: 0.01, max: 10,  step: 0.05 },
    { key: 'outerRadius', label: 'Radio exterior', min: 0.05, max: 12,  step: 0.05 },
    { key: 'height',      label: 'Altura',         min: 0.05, max: 10,  step: 0.05 },
  ],
  PLANE:        [{ key: 'segments',       label: 'Subdivisión',     min: 1,    max: 256, step: 1,    integer: true }],
  VOLUME_CLOUD: [],
  CIRCLE:       [{ key: 'segments',       label: 'Segmentos',       min: 3,    max: 256, step: 1,    integer: true }],
  RING: [
    { key: 'innerRadius',   label: 'Radio interior', min: 0.01, max: 10, step: 0.05 },
    { key: 'outerRadius',   label: 'Radio exterior', min: 0.05, max: 12, step: 0.05 },
    { key: 'thetaSegments', label: 'Segmentos',      min: 3,    max: 256, step: 1, integer: true },
  ],
  SHAPE: [
    { key: 'segments',       label: 'Segmentos (Bezier)', min: 1,    max: 128, step: 1,    integer: true },
    { key: 'depthSegments',  label: 'Segmentos (Prof.)',  min: 1,    max: 128, step: 1,    integer: true },
    { key: 'extrusionDepth', label: 'Profundidad',        min: 0,    max: 50,  step: 0.1 },
  ],
  MESH: [],
  NURBS_CURVE: [
    { key: 'segments', label: 'Segmentos', min: 8, max: 128, step: 4, integer: true },
    { key: 'radius',   label: 'Grosor Tubo', min: 0.005, max: 1.0, step: 0.005 },
  ],
  NURBS_CIRCLE: [
    { key: 'segments', label: 'Segmentos', min: 12, max: 256, step: 4, integer: true },
    { key: 'tube',     label: 'Grosor Tubo', min: 0.005, max: 1.0, step: 0.005 },
  ],
  NURBS_SURFACE: [
    { key: 'nurbsResolutionU', label: 'Resolución U', min: 4, max: 64, step: 2, integer: true },
    { key: 'nurbsResolutionV', label: 'Resolución V', min: 4, max: 64, step: 2, integer: true },
  ],
  NURBS_CYLINDER: [
    { key: 'nurbsResolutionU', label: 'Resolución U (Altura)', min: 4, max: 64, step: 2, integer: true },
    { key: 'nurbsResolutionV', label: 'Resolución V (Radial)', min: 6, max: 64, step: 2, integer: true },
  ],
  NURBS_CONE: [
    { key: 'nurbsResolutionU', label: 'Resolución U (Generatriz)', min: 4, max: 64, step: 2, integer: true },
    { key: 'nurbsResolutionV', label: 'Resolución V (Radial)', min: 6, max: 64, step: 2, integer: true },
  ],
  NURBS_SPHERE: [
    { key: 'nurbsResolutionU', label: 'Resolución U (Latitud)', min: 4, max: 64, step: 2, integer: true },
    { key: 'nurbsResolutionV', label: 'Resolución V (Longitud)', min: 6, max: 64, step: 2, integer: true },
  ],
  NURBS_TORUS: [
    { key: 'nurbsResolutionU', label: 'Resolución U (Tubo)', min: 6, max: 64, step: 2, integer: true },
    { key: 'nurbsResolutionV', label: 'Resolución V (Anillo)', min: 8, max: 64, step: 2, integer: true },
  ],
  GEOSPHERE: [
    { key: 'geodesicFrequency', label: 'Frecuencia Geodésica', min: 1, max: 16, step: 1, integer: true },
    { key: 'segments',          label: 'Subdivisiones',        min: 1, max: 16, step: 1, integer: true },
  ],
  PARTICLE_SYSTEM: [],
  SPACE_WARP: [],
  GPGPU_SWARM: [],
};

type AlignAxis = 'x' | 'y' | 'z';
type AlignMode = 'min' | 'center' | 'max';

// ─── Main Sidebar ─────────────────────────────────────────────────────────────
export const Sidebar: React.FC = () => {
  const {
    project, selectedObjectId, selectedObjectIds, selectObject, removeObject, removeObjects, duplicateObject,
    updateObject, updateParameters, saveHistory, toggleObjectSelection,
    smoothObject, subdivideObject, optimizeObject, repairObject,
  } = useStore();

  const [smoothFactor,  setSmoothFactor]  = useState(0.5);
  const [optimizeRatio, setOptimizeRatio] = useState(0.3);
  const [validResult,   setValidResult]   = useState<ReturnType<typeof validateMesh> | null>(null);
  const [repairReport,  setRepairReport]  = useState<string[] | null>(null);

  const selectedObject = project.objects.find(o => o.id === selectedObjectId);

  // ── Align ──────────────────────────────────────────────────────────────────
  const alignObjects = useCallback((axis: AlignAxis, mode: AlignMode) => {
    const ids = (selectedObjectIds && selectedObjectIds.length > 1)
      ? selectedObjectIds
      : selectedObjectId ? [selectedObjectId] : [];
    const selected = project.objects.filter(o => ids.includes(o.id));
    if (selected.length === 0) return;
    const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const positions = selected.map(o => o.transform.position[axisIdx]);
    const ref = mode === 'min' ? Math.min(...positions)
      : mode === 'max' ? Math.max(...positions)
      : positions.reduce((a, b) => a + b, 0) / positions.length;
    selected.forEach(o => {
      const pos: [number,number,number] = [...o.transform.position] as any;
      pos[axisIdx] = ref;
      updateObject(o.id, { transform: { ...o.transform, position: pos } });
    });
    saveHistory();
  }, [selectedObjectIds, selectedObjectId, project.objects, updateObject, saveHistory]);

  const snapToOrigin  = () => { if (!selectedObject) return; updateObject(selectedObject.id, { transform: { ...selectedObject.transform, position: [0,0,0] } }); saveHistory(); };
  const resetRotation = () => { if (!selectedObject) return; updateObject(selectedObject.id, { transform: { ...selectedObject.transform, rotation: [0,0,0] } }); saveHistory(); };
  const resetScale    = () => { if (!selectedObject) return; updateObject(selectedObject.id, { transform: { ...selectedObject.transform, scale:    [1,1,1] } }); saveHistory(); };

  // ── Validation ────────────────────────────────────────────────────────────
  const handleValidate = () => {
    if (!selectedObject) return;
    setValidResult(validateMesh(selectedObject));
    setRepairReport(null);
  };

  const handleRepair = () => {
    if (!selectedObjectId) return;
    repairObject(selectedObjectId);
    setTimeout(() => {
      const updated = useStore.getState().project.objects.find(o => o.id === selectedObjectId);
      if (updated) {
        setValidResult(validateMesh(updated));
        setRepairReport(['Reparación aplicada. Malla re-validada automáticamente.']);
      }
    }, 50);
  };

  const handleSmooth = () => {
    if (!selectedObjectId) return;
    smoothObject(selectedObjectId, smoothFactor);
    setValidResult(null);
    setRepairReport(null);
  };

  const handleSubdivide = () => {
    if (!selectedObjectId) return;
    subdivideObject(selectedObjectId);
    setValidResult(null);
    setRepairReport(null);
  };

  const handleOptimize = () => {
    if (!selectedObjectId) return;
    optimizeObject(selectedObjectId, optimizeRatio);
    setValidResult(null);
    setRepairReport(null);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: 'GLB' | 'GLTF' | 'OBJ') => {
    const objectsToExport = (selectedObjectIds && selectedObjectIds.length > 0)
      ? project.objects.filter(o => selectedObjectIds.includes(o.id))
      : project.objects;

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

  return (
    <div className="w-full h-full bg-zinc-950/70 backdrop-blur-xl border-l border-white/10 flex flex-col overflow-hidden text-zinc-300 select-none">

      {/* Hierarchy */}
      <Section title="Jerarquía" icon={Layers}>
        <div className="p-2 space-y-1">
          {selectedObjectIds && selectedObjectIds.length > 0 && (
            <div className="flex items-center justify-between gap-2 p-1.5 bg-indigo-950/40 border border-indigo-500/30 rounded text-[10px]">
              <span className="text-indigo-200 font-medium">
                {selectedObjectIds.length} sel.
              </span>
              <button
                onClick={() => removeObjects(selectedObjectIds)}
                className="flex items-center gap-1 px-2 py-0.5 bg-rose-600/30 hover:bg-rose-600 text-rose-200 hover:text-white rounded font-bold transition-all border border-rose-500/30"
                title="Eliminar objetos seleccionados"
              >
                <Trash2 size={10} /> Eliminar ({selectedObjectIds.length})
              </button>
            </div>
          )}
          <div className="space-y-1 max-h-[180px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
            {project.objects.map(obj => (
              <div
                key={obj.id}
                onClick={(e) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) toggleObjectSelection?.(obj.id, true);
                  else selectObject(obj.id);
                }}
                className={`group flex items-center gap-2 p-1.5 rounded cursor-pointer transition-all ${
                  (selectedObjectIds ?? [selectedObjectId]).includes(obj.id)
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                    : 'hover:bg-zinc-800'
                }`}
              >
                <div className="w-2 h-2 rounded-full ring-1 ring-white/10 flex-shrink-0" style={{ backgroundColor: obj.color }} />
                <span className="text-[11px] truncate flex-1 font-medium">{obj.name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); updateObject(obj.id, { visible: !obj.visible }); }} className="p-1 hover:bg-white/10 rounded" title="Visibilidad">
                    {obj.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                  </button>
                  <button onClick={e => { e.stopPropagation(); duplicateObject(obj.id); }} className="p-1 hover:bg-white/10 rounded" title="Duplicar">
                    <Copy size={10} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); removeObject(obj.id); }} className="p-1 hover:bg-red-500/20 text-red-400 rounded" title="Eliminar">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
        {selectedObjectIds && selectedObjectIds.length > 1 && (
          <div className="px-3 py-1.5 bg-indigo-900/40 border-b border-indigo-500/20 text-[10px] text-indigo-300 font-medium">
            {selectedObjectIds.length} objetos — Shift+clic para añadir/quitar
          </div>
        )}

        {selectedObject ? (
          <div className="flex flex-col">

            {/* General */}
            <Section title="General" icon={Settings2}>
              <div className="p-3 space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] uppercase text-zinc-500 font-bold">Nombre</label>
                  <input type="text" value={selectedObject.name}
                    onChange={e => updateObject(selectedObject.id, { name: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase text-zinc-500 font-bold">Operación</label>
                    <select value={selectedObject.operation}
                      onChange={e => updateObject(selectedObject.id, { operation: e.target.value as CSGOperation })}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ADD">Unión</option>
                      <option value="SUBTRACT">Diferencia</option>
                      <option value="INTERSECT">Intersección</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase text-zinc-500 font-bold">Color</label>
                    <input type="color" value={selectedObject.color}
                      onChange={e => updateObject(selectedObject.id, { color: e.target.value })}
                      className="w-full h-7 bg-zinc-800 border border-zinc-700 rounded cursor-pointer p-0.5"
                    />
                  </div>
                </div>

                <button
                  disabled={!hasChildrenOrSubObjects(selectedObject)}
                  onClick={async () => {
                    if (selectedObject) {
                      await useStore.getState().ungroupSelectedObject(selectedObject.id);
                    }
                  }}
                  className={`w-full py-1.5 px-2 rounded text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow cursor-pointer ${
                    hasChildrenOrSubObjects(selectedObject)
                      ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/40 border border-purple-400/40'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed opacity-50 border border-zinc-700'
                  }`}
                  title="Desagrupar / Separar Conjunto: Extrae todos los sub-objetos del modelo en objetos independientes"
                >
                  <Split size={12} />
                  Desagrupar / Separar Conjunto
                </button>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] uppercase text-zinc-500 font-bold">Opacidad</label>
                    <span className="text-[9px] text-zinc-400 font-mono">{Math.round((selectedObject.opacity ?? 1) * 100)}%</span>
                  </div>
                  <input 
                    type="range" min={0} max={1} step={0.01} 
                    value={selectedObject.opacity ?? 1}
                    onChange={e => updateObject(selectedObject.id, { opacity: parseFloat(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
            </Section>

            {/* Transformación — inputs numéricos precisos */}
            <Section title="Transformación" icon={Move}>
              <div className="p-3 space-y-3">
                <XYZRow
                  label="Posición"
                  values={selectedObject.transform.position as [number,number,number]}
                  step={0.01}
                  onChange={v => { updateObject(selectedObject.id, { transform: { ...selectedObject.transform, position: v } }); saveHistory(); }}
                />
                {/* Rotation shown in degrees for usability */}
                <XYZRow
                  label="Rotación (°)"
                  values={(selectedObject.transform.rotation as [number,number,number]).map(r => safeParseFixed((safeNum(r) * 180 / Math.PI), 2, 0)) as [number,number,number]}
                  step={0.5} min={-360} max={360}
                  onChange={v => {
                    const rad = v.map(d => d * Math.PI / 180) as [number,number,number];
                    updateObject(selectedObject.id, { transform: { ...selectedObject.transform, rotation: rad } });
                    saveHistory();
                  }}
                />
                <XYZRow
                  label="Escala"
                  values={selectedObject.transform.scale as [number,number,number]}
                  step={0.01} min={0.001} max={1000}
                  onChange={v => { updateObject(selectedObject.id, { transform: { ...selectedObject.transform, scale: v } }); saveHistory(); }}
                />
                <div className="flex gap-1 pt-1">
                  <button onClick={snapToOrigin}  className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-[9px] rounded transition-colors">Origen</button>
                  <button onClick={resetRotation} className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-[9px] rounded transition-colors">Reset rot.</button>
                  <button onClick={resetScale}    className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-[9px] rounded transition-colors">Reset esc.</button>
                </div>
              </div>
            </Section>

            {/* Geometría (segmentos, radios…) */}
            {(PARAM_DEFS[selectedObject.type] || []).length > 0 && (
              <Section title="Geometría" icon={Sliders} defaultOpen>
                <div className="p-3 space-y-3">
                  {(PARAM_DEFS[selectedObject.type] || []).map(def => (
                    <PropRow
                      key={def.key}
                      label={def.label}
                      value={(selectedObject.parameters as any)[def.key] ?? 0}
                      min={def.min} max={def.max} step={def.step ?? 0.01}
                      integer={def.integer}
                      onChange={v => updateParameters(selectedObject.id, { [def.key]: def.integer ? Math.round(v) : v })}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* Puntos de control (SHAPE/línea) — coordenadas editables */}
            {selectedObject.type === 'SHAPE' && (
              <Section title="Puntos de control" icon={RotateCw} defaultOpen>
                <div className="p-2 space-y-1">
                  <p className="text-[9px] text-zinc-500 px-1 pb-1">Edita posición exacta de cada vértice de la línea/forma.</p>
                  <div className="max-h-[240px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 space-y-1">
                    {selectedObject.vertices.length === 0 && (
                      <p className="text-[10px] text-zinc-600 italic p-1">Sin puntos aún</p>
                    )}
                    {selectedObject.vertices.map((v, i) => {
                      const off = (selectedObject.vertexOffsets as any)?.[i] ?? [0,0,0];
                      const cur: [number,number,number] = [v[0]+off[0], v[1]+off[1], v[2]+off[2]];
                      return (
                        <div key={i} className="flex items-center gap-1 bg-zinc-900/60 rounded px-1 py-1">
                          <span className="text-[9px] text-zinc-500 w-5 flex-shrink-0 text-right">{i+1}</span>
                          {(['X','Y','Z'] as const).map((ax, ai) => (
                            <div key={ax} className="flex items-center gap-0.5 flex-1 min-w-0">
                              <span className="text-[8px] font-bold flex-shrink-0" style={{ color: ai===0?'#f87171':ai===1?'#4ade80':'#60a5fa' }}>{ax}</span>
                              <input
                                type="number" step={0.001}
                                value={safeParseFixed(cur[ai], 3, 0)}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  if (isNaN(val)) return;
                                  const newOff: [number,number,number] = [...off] as any;
                                  newOff[ai] = val - v[ai];
                                  useStore.getState().updateVertexOffset(selectedObject.id, i, newOff as any);
                                }}
                                onBlur={() => saveHistory()}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-0.5 py-0.5 text-[9px] focus:outline-none focus:border-indigo-500 min-w-0"
                              />
                            </div>
                          ))}
                          <button 
                            onClick={() => {
                              const newVerts = selectedObject.vertices.filter((_, vi) => vi !== i);
                              const newHandles = selectedObject.bezierHandles ? selectedObject.bezierHandles.filter((_, vi) => vi !== i) : undefined;
                              const newOffsets: Record<number,[number,number,number]> = {};
                              Object.entries(selectedObject.vertexOffsets ?? {}).forEach(([k,v]) => {
                                const ki = parseInt(k);
                                if (ki > i) newOffsets[ki-1] = v as [number,number,number];
                                else if (ki < i) newOffsets[ki] = v as [number,number,number];
                              });
                              if (newVerts.length >= 2) {
                                updateObject(selectedObject.id, { vertices: newVerts, bezierHandles: newHandles, vertexOffsets: newOffsets } as any);
                                saveHistory();
                              }
                            }}
                            className="p-1 text-red-400 hover:bg-red-500/20 rounded ml-1"
                            title="Eliminar vértice"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => {
                      const lastIdx = selectedObject.vertices.length - 1;
                      const lastV = selectedObject.vertices[lastIdx] ?? [0,0,0];
                      const lastOff = (selectedObject.vertexOffsets as any)?.[lastIdx] ?? [0,0,0];
                      const newVerts = [...selectedObject.vertices, [lastV[0] + lastOff[0] + 0.5, lastV[1] + lastOff[1], lastV[2] + lastOff[2]] as [number,number,number]];
                      const newHandles = selectedObject.bezierHandles ? [...selectedObject.bezierHandles, { out: [0,0,0], in: [0,0,0], broken: false }] : undefined;
                      updateObject(selectedObject.id, { vertices: newVerts, bezierHandles: newHandles } as any);
                      saveHistory();
                    }}
                    className="w-full mt-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5"
                  >
                    + Añadir Vértice
                  </button>
                </div>
              </Section>
            )}

            {/* Alinear */}
            <Section title="Alinear" icon={AlignCenterHorizontal} defaultOpen={false}>
              <div className="p-3 space-y-2">
                <p className="text-[9px] text-zinc-500 mb-2">Alinear al mundo / a otros seleccionados</p>
                <div className="grid grid-cols-3 gap-1">
                  {([
                    ['x','−','min',<AlignStartHorizontal size={11}/>],
                    ['x','','center',<AlignCenterHorizontal size={11}/>],
                    ['x','+','max',<AlignEndHorizontal size={11}/>],
                    ['y','−','min',<AlignStartVertical size={11}/>],
                    ['y','','center',<AlignCenterVertical size={11}/>],
                    ['y','+','max',<AlignEndVertical size={11}/>],
                    ['z','−','min',<AlignStartHorizontal size={11} className="rotate-90"/>],
                    ['z','','center',<AlignCenterHorizontal size={11} className="rotate-90"/>],
                    ['z','+','max',<AlignEndHorizontal size={11} className="rotate-90"/>],
                  ] as [AlignAxis,string,AlignMode,React.ReactNode][]).map(([ax,sign,mode,icon]) => (
                    <button key={ax+mode} onClick={() => alignObjects(ax,mode)}
                      className="flex flex-col items-center gap-0.5 p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[9px] transition-colors">
                      {icon}{ax.toUpperCase()}{sign}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-white/5">
                  <button onClick={() => selectedObjectId && useStore.getState().alignToGrid(selectedObjectId)}
                    className="flex items-center justify-center gap-1.5 py-1.5 bg-indigo-900/40 hover:bg-indigo-800/60 rounded text-[9px] transition-colors text-indigo-200">
                    <AlignStartHorizontal size={11}/> Rejilla
                  </button>
                  <button onClick={() => selectedObjectId && useStore.getState().alignToGround(selectedObjectId)}
                    className="flex items-center justify-center gap-1.5 py-1.5 bg-emerald-900/40 hover:bg-emerald-800/60 rounded text-[9px] transition-colors text-emerald-200">
                    <AlignStartVertical size={11}/> Suelo
                  </button>
                </div>
              </div>
            </Section>

            {/* Modificadores de Malla */}
            <Section title="Modificadores de Malla" icon={Wand2} defaultOpen={false}>
              <div className="p-3 space-y-3">
                {/* Show UV Debug Toggle */}
                <div className="p-2 bg-indigo-950/40 border border-indigo-500/30 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-[10px] font-bold text-indigo-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedObject?.uvDebug ?? false}
                        onChange={e => selectedObjectId && updateObject(selectedObjectId, { uvDebug: e.target.checked })}
                        className="rounded bg-zinc-900 border-zinc-700 text-indigo-500 focus:ring-indigo-500/50"
                      />
                      <span className="flex items-center gap-1">
                        <Grid size={11} className="text-indigo-400" />
                        <span>Show UV Debug</span>
                      </span>
                    </label>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${selectedObject?.uvDebug ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                      {selectedObject?.uvDebug ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <p className="text-[9px] text-zinc-400 leading-tight">
                    Aplica una textura de damero UV con cuadrantes y coordenadas U/V para visualizar distorsiones e inconsistencias.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-[9px] text-zinc-500 leading-relaxed">Sombreado Suave (Shade Smooth) — Difumina visualmente los bordes sin añadir geometría.</p>
                  <label className="flex items-center gap-2 text-[10px] text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={selectedObject?.smoothShading ?? false}
                      onChange={e => selectedObjectId && updateObject(selectedObjectId, { smoothShading: e.target.checked })}
                      className="rounded bg-zinc-900 border-zinc-700 text-indigo-500 focus:ring-indigo-500/50" />
                    Aplicar Sombreado Suave
                  </label>
                </div>

                <div className="border-t border-white/5 pt-3 space-y-2">
                  <p className="text-[9px] text-zinc-500 leading-relaxed">Subdivisión (Subdivision Surface) — Aumenta la cantidad de polígonos dividiendo cada cara.</p>
                  <button onClick={handleSubdivide}
                    className="w-full py-1.5 bg-indigo-700 hover:bg-indigo-600 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <Layers size={11}/> Subdividir Malla
                  </button>
                </div>

                <div className="border-t border-white/5 pt-3 space-y-2">
                  <p className="text-[9px] text-zinc-500 leading-relaxed">Suavizado Laplaciano (Modificador Smooth) — Aplana ángulos relajando la malla sin subdividirla.</p>
                  <PropRow label="Factor (0–1)" value={smoothFactor} min={0.01} max={1} step={0.01} onChange={setSmoothFactor}/>
                  <button onClick={handleSmooth}
                    className="w-full py-1.5 bg-indigo-700 hover:bg-indigo-600 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <Wand2 size={11}/> Suavizar Geometría
                  </button>
                </div>

                <div className="border-t border-white/5 pt-3 space-y-2">
                  <p className="text-[9px] text-zinc-500 leading-relaxed">Reducir segmentos — fusiona vértices próximos para simplificar la malla.</p>
                  <PropRow label="Agresividad (0–1)" value={optimizeRatio} min={0.01} max={1} step={0.01} onChange={setOptimizeRatio}/>
                  <button onClick={handleOptimize}
                    className="w-full py-1.5 bg-violet-700 hover:bg-violet-600 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <Maximize2 size={11}/> Optimizar / Reducir
                  </button>
                </div>
              </div>
            </Section>

            {/* Validación y Reparación */}
            <Section
              title="Validación y Reparación"
              icon={CheckCircle}
              defaultOpen={false}
              badge={
                validResult
                  ? validResult.isValid
                    ? <span className="text-[8px] bg-emerald-700/60 text-emerald-200 px-1.5 py-0.5 rounded-full ml-1">OK</span>
                    : <span className="text-[8px] bg-red-700/60 text-red-200 px-1.5 py-0.5 rounded-full ml-1">{validResult.issues.length} errores</span>
                  : null
              }
            >
              <div className="p-3 space-y-3">

                {/* Stats grid */}
                {validResult && (
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {[
                      { l:'Vértices',   v: validResult.vertexCount,         warn: false },
                      { l:'Caras',      v: validResult.faceCount,           warn: false },
                      { l:'Aristas',    v: validResult.edgeCount,           warn: false },
                      { l:'Dup. vert.', v: validResult.duplicateVertices,   warn: validResult.duplicateVertices > 0 },
                      { l:'Deg. caras', v: validResult.degenerateFaces,     warn: validResult.degenerateFaces > 0 },
                      { l:'Ar. abiert', v: validResult.openEdges,           warn: validResult.openEdges > 0 },
                    ].map(({ l, v, warn }) => (
                      <div key={l} className={`bg-zinc-800 rounded p-1.5 ${warn ? 'ring-1 ring-red-500/60' : ''}`}>
                        <div className={`text-[11px] font-bold ${warn ? 'text-red-300' : 'text-white'}`}>{v}</div>
                        <div className="text-[9px] text-zinc-300">{l}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Issues */}
                {validResult && validResult.issues.length > 0 && (
                  <div className="space-y-1">
                    {validResult.issues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-1.5 bg-red-900/20 rounded px-2 py-1">
                        <AlertTriangle size={10} className="text-red-400 mt-0.5 flex-shrink-0"/>
                        <span className="text-[9px] text-red-300">{issue}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Suggestions */}
                {validResult && validResult.suggestions.length > 0 && (
                  <div className="space-y-1">
                    {validResult.suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-1.5 bg-amber-900/20 rounded px-2 py-1">
                        <AlertTriangle size={10} className="text-amber-400 mt-0.5 flex-shrink-0"/>
                        <span className="text-[9px] text-amber-300">{s}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* OK badge */}
                {validResult && validResult.isValid && (
                  <div className="flex items-center gap-1.5 bg-emerald-900/20 rounded px-2 py-1.5">
                    <CheckCircle size={11} className="text-emerald-400"/>
                    <span className="text-[9px] text-emerald-300">Malla válida — sin errores detectados</span>
                  </div>
                )}

                {/* Repair report */}
                {repairReport && (
                  <div className="space-y-1">
                    {repairReport.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 bg-indigo-900/20 rounded px-2 py-1">
                        <Wrench size={10} className="text-indigo-400 mt-0.5 flex-shrink-0"/>
                        <span className="text-[9px] text-indigo-300">{r}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2">
                  <button onClick={handleValidate}
                    className="flex-1 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <CheckCircle size={11}/> Validar
                  </button>
                  <button onClick={handleRepair}
                    className="flex-1 py-1.5 bg-emerald-800 hover:bg-emerald-700 rounded text-[10px] font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <Wrench size={11}/> Reparar
                  </button>
                </div>
                <p className="text-[8px] text-zinc-600 leading-relaxed">
                  Reparar: fusiona vértices duplicados, elimina caras degeneradas y vértices huérfanos.
                </p>
              </div>
            </Section>
            
            {/* Exportar */}
            <Section title="Exportar" icon={Download} defaultOpen={false}>
              <div className="p-3 space-y-3">
                <p className="text-[9px] text-zinc-500 leading-relaxed">
                  Exporta la selección actual (o todo el proyecto si no hay nada seleccionado) con texturas incluidas.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <button 
                    disabled={isExporting}
                    onClick={() => handleExport('GLB')}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10"
                  >
                    <FileDown size={12}/> {isExporting ? 'Exportando...' : 'Exportar como GLB (Recomendado)'}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('GLTF')}
                      className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      GLTF
                    </button>
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('OBJ')}
                      className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      OBJ
                    </button>
                  </div>
                </div>
                <p className="text-[8px] text-zinc-600 leading-relaxed italic">
                  * GLB/GLTF son los formatos estándar que mejor preservan materiales y texturas PBR.
                </p>
              </div>
            </Section>

          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-600">
                <Layers size={24} />
              </div>
              <p className="text-zinc-600 text-xs italic leading-relaxed">
                Selecciona un objeto para ver sus propiedades
              </p>
            </div>
          </div>
        )}

        {/* Global Export (always visible) */}
        {!selectedObject && (
          <div className="border-t border-white/10">
            <Section title="Exportar Proyecto" icon={Download} defaultOpen={true}>
              <div className="p-3 space-y-3">
                <p className="text-[9px] text-zinc-500 leading-relaxed">
                  Exporta todo el proyecto actual con texturas incluidas.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <button 
                    disabled={isExporting}
                    onClick={() => handleExport('GLB')}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded text-[10px] font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/10"
                  >
                    <FileDown size={12}/> {isExporting ? 'Exportando...' : 'Exportar Proyecto (GLB)'}
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('GLTF')}
                      className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      GLTF
                    </button>
                    <button 
                      disabled={isExporting}
                      onClick={() => handleExport('OBJ')}
                      className="py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 rounded text-[10px] font-bold transition-colors flex items-center justify-center gap-1.5"
                    >
                      OBJ
                    </button>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
};
