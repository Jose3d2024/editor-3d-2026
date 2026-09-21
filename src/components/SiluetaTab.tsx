/**
 * SiluetaTab.tsx — "Del Plano a la Realidad"
 *
 * Herramienta completa con:
 *  - Subida de imagen por plano (Alzado, Perfil, Planta)
 *  - Extracción automática de silueta por umbral de luminancia
 *  - Editor 2D interactivo por plano (arrastrar puntos, añadir, borrar)
 *  - Generación de malla 3D por intersección de tres prismas (CSG)
 */

import React, { useState } from 'react';
import { Sparkles, Layers, Sliders, Wand2, Palette, Box } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  extractSilhouetteFromImage,
  silhouettesToMesh,
  fileToDataURL,
  ensureCCW,
} from '../utils/silhouettes';
import {
  generarMallaConComplejidadVariable,
  simplificarSiluetaAThreeShape,
  bufferGeometryToVerticesAndFaces,
  type PolygonComplexityMode
} from '../utils/vectorContourProcessor';
import type { V3, MeshFace } from '../types';
import { safeFixed } from '../utils/numberUtils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PlaneKey = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

interface SiluetaTabProps {
  onGenerate: (vertices: V3[], faces: MeshFace[], name: string) => void;
}

// ─── Constantes de estilo por plano ──────────────────────────────────────────

const PLANE_CONFIG: Record<PlaneKey, { label: string; desc: string; color: string; border: string; bg: string; icon: string }> = {
  front:  { label: 'Frontal',  desc: 'Vista frontal (XY)',   color: '#f87171', border: 'border-red-600/70',   bg: 'bg-red-900/20',   icon: 'Front' },
  back:   { label: 'Trasera',  desc: 'Vista trasera (XY)',   color: '#ef4444', border: 'border-red-700/70',   bg: 'bg-red-950/20',   icon: 'Back' },
  left:   { label: 'Izquierda',desc: 'Vista izquierda (ZY)', color: '#60a5fa', border: 'border-blue-600/70',  bg: 'bg-blue-900/20',  icon: 'Left' },
  right:  { label: 'Derecha',  desc: 'Vista derecha (ZY)',   color: '#3b82f6', border: 'border-blue-700/70',  bg: 'bg-blue-950/20',  icon: 'Right' },
  top:    { label: 'Superior', desc: 'Vista superior (XZ)',  color: '#4ade80', border: 'border-green-600/70', bg: 'bg-green-900/20', icon: 'Top' },
  bottom: { label: 'Inferior', desc: 'Vista inferior (XZ)',  color: '#22c55e', border: 'border-green-700/70', bg: 'bg-green-950/20', icon: 'Bottom' },
};

const PLANE_ORDER: PlaneKey[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

// ─── SiluetaTab principal ─────────────────────────────────────────────────────

export const SiluetaTab: React.FC<SiluetaTabProps> = ({ onGenerate }) => {
  const { project, setSilueta } = useStore();
  const { silueta } = project;
  const [threshold,   setThreshold]   = useState(128);
  const [numPoints,   setNumPoints]   = useState(48);
  const [boxSize,     setBoxSize]     = useState(2);
  const [polyMode,    setPolyMode]    = useState<PolygonComplexityMode>('medium');
  const [processing,  setProcessing]  = useState(false);

  // ── Subir imagen y extraer contorno ──────────────────────────────────────
  const handleUpload = async (key: PlaneKey, file: File) => {
    const url     = await fileToDataURL(file);
    const contour = await extractSilhouetteFromImage(url, { numPoints, threshold });
    setSilueta({ 
      [key]: contour ?? [],
      [`${key}Image` as any]: url 
    });
  };

  // ── Generar malla 3D con Three-BVH-CSG y nivel de detalle ──────────────
  const allReady = PLANE_ORDER.some(k => silueta[k] && silueta[k]!.length >= 3);

  const handleGenerate = async () => {
    if (!allReady) return;
    setProcessing(true);
    try {
      // Si tenemos Front, Left/Right y Top, usamos el motor algorítmico CSG de alta fidelidad con acople matemático
      const fContour = silueta.front || silueta.back;
      const lContour = silueta.left || silueta.right;
      const sContour = silueta.top || silueta.bottom;

      if (fContour && fContour.length >= 3 && lContour && lContour.length >= 3 && sContour && sContour.length >= 3) {
        try {
          const shapeF = simplificarSiluetaAThreeShape(fContour as [number, number][], { rdpEpsilon: 0.02, maxFittingError: 0.05, closedLoop: true });
          const shapeL = simplificarSiluetaAThreeShape(lContour as [number, number][], { rdpEpsilon: 0.02, maxFittingError: 0.05, closedLoop: true });
          const shapeS = simplificarSiluetaAThreeShape(sContour as [number, number][], { rdpEpsilon: 0.02, maxFittingError: 0.05, closedLoop: true });

          const threeMesh = generarMallaConComplejidadVariable(shapeF, shapeL, shapeS, {
            modoDetalle: polyMode,
            tamanoReferencia: boxSize
          });

          if (threeMesh && threeMesh.geometry) {
            const { vertices, faces } = bufferGeometryToVerticesAndFaces(threeMesh.geometry);
            if (vertices.length > 0 && faces.length > 0) {
              const labelName = polyMode === 'low' ? 'Boceto Low Poly' : polyMode === 'high' ? 'Boceto Ultra Suave' : 'Boceto 3D';
              onGenerate(vertices, faces, labelName);
              setSilueta({ activePlane: null });
              return;
            }
          }
        } catch (csgErr) {
          console.warn('Fallo motor CSG avanzado, recurriendo a CSG estándar:', csgErr);
        }
      }

      // Método alternativo estándar
      const result = silhouettesToMesh(
        {
          front: silueta.front,
          back:  silueta.back,
          left:  silueta.left,
          right: silueta.right,
          top:   silueta.top,
          bottom:silueta.bottom,
        },
        boxSize,
      );
      if (!result || result.vertices.length === 0) {
        alert('No se pudo generar la malla. Comprueba que los contornos se superponen en el espacio 3D.');
        return;
      }
      onGenerate(result.vertices, result.faces, 'Plano a la Realidad');
      setSilueta({ activePlane: null });
    } finally {
      setProcessing(false);
    }
  };

  const activePlane = silueta.activePlane || 'front';
  const cfg = PLANE_CONFIG[activePlane];

  return (
    <div className="space-y-4">
      {/* ── Banner: Estudio Automático 3 Vistas (Blueprint Carver) ── */}
      <div className="p-3 bg-gradient-to-br from-indigo-950/60 via-purple-950/40 to-zinc-900 border border-indigo-500/40 rounded-xl space-y-2 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-600 rounded-lg text-white shadow">
            <Sparkles size={14} className="text-amber-300" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-white leading-tight">Tallado 3D por Bocetos (3 Vistas)</p>
            <p className="text-[8.5px] text-indigo-300/80">Visual Hull & Intersección Booleana CSG</p>
          </div>
        </div>
        <p className="text-[8.5px] text-zinc-300 leading-snug">
          Carga 3 imágenes (Frontal, Planta, Perfil) para reconstruir automáticamente volúmenes 3D completos mediante intersección y Marching Cubes.
        </p>
        <button
          type="button"
          onClick={() => useStore.getState().openBlueprintModal()}
          className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-98 cursor-pointer"
        >
          <Sparkles size={12} className="text-amber-300" />
          <span>Abrir Estudio de Tallado 3D</span>
        </button>
      </div>

      {/* ── Header Manual ───────────────────────────────────────────────────────── */}
      <div className="pt-1 border-t border-zinc-800/80">
        <p className="text-[11px] font-bold text-zinc-200">✏️ Editor Manual por Planos</p>
        <p className="text-[8.5px] text-zinc-400 leading-tight mt-0.5">
          Dibuja directamente en los visores Frontal, Lateral y Superior con el ratón.
        </p>
      </div>

      {/* ── Selector de plano activo ────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1">
        {PLANE_ORDER.map(key => {
          const c  = PLANE_CONFIG[key];
          const contour = silueta[key];
          const ok = contour && contour.length >= 3;
          const isActive = silueta.activePlane === key;
          return (
            <button key={key} onClick={() => setSilueta({ activePlane: isActive ? null : key })}
              className={`flex flex-col items-center py-2 rounded-lg border text-[9px] font-bold transition-all ${
                isActive ? `${c.bg} ${c.border} text-white` : `border-zinc-800 text-zinc-500 hover:border-zinc-700`
              }`}>
              <span style={{ color: c.color }} className="text-[10px] mb-0.5">
                {c.icon}
              </span>
              {c.label}
              <span className={`text-[7px] mt-0.5 ${ok ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {ok ? `✓ ${contour!.length}pts` : 'sin contorno'}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Panel del plano activo ──────────────────────────────────── */}
      {silueta.activePlane && (
        <div className={`rounded-lg border p-3 space-y-3 ${cfg.border} ${cfg.bg}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold" style={{ color: cfg.color }}>{cfg.label} Activo</p>
              <p className="text-[8px] text-zinc-400">
                • Clic para añadir/insertar puntos.<br/>
                • Arrastra para mover.<br/>
                • Alt + Clic para borrar.
              </p>
            </div>
            <button
              onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*';
                inp.onchange = (e: any) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(silueta.activePlane!, f);
                };
                inp.click();
              }}
              className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-[9px] font-semibold transition-colors"
            >
              ↑ Subir imagen
            </button>
          </div>

          <div className="flex justify-between items-center">
            <button 
              onClick={() => setSilueta({ [silueta.activePlane!]: [] })}
              className="px-2 py-1 bg-zinc-800 hover:bg-red-900/50 rounded text-[8px] text-zinc-500 hover:text-red-300 transition-colors"
            >
              ↺ Limpiar Contorno
            </button>
            <span className="text-[8px] text-zinc-500">
              {silueta[silueta.activePlane!]?.length || 0} puntos
            </span>
          </div>
        </div>
      )}

      {/* ── Controles de Poligonización & Estilo ─────────────────────── */}
      <div className="bg-zinc-900/80 rounded-lg p-2.5 space-y-2 border border-zinc-800">
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1">
            <Box size={11} className="text-indigo-400"/> Nivel de Detalle Poligonal
          </p>
          <span className="text-[8px] font-mono text-indigo-400 uppercase font-semibold">{polyMode}</span>
        </div>
        
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setPolyMode('low')}
            className={`py-1.5 px-1 rounded text-[9px] font-bold border transition-colors flex flex-col items-center ${
              polyMode === 'low'
                ? 'bg-amber-600/30 border-amber-500 text-amber-300'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <span>Low Poly</span>
            <span className="text-[7px] font-normal opacity-80">Facetado Retro</span>
          </button>
          <button
            type="button"
            onClick={() => setPolyMode('medium')}
            className={`py-1.5 px-1 rounded text-[9px] font-bold border transition-colors flex flex-col items-center ${
              polyMode === 'medium'
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <span>Medio</span>
            <span className="text-[7px] font-normal opacity-80">Equilibrado</span>
          </button>
          <button
            type="button"
            onClick={() => setPolyMode('high')}
            className={`py-1.5 px-1 rounded text-[9px] font-bold border transition-colors flex flex-col items-center ${
              polyMode === 'high'
                ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                : 'bg-zinc-800/80 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            <span>Alto Poly</span>
            <span className="text-[7px] font-normal opacity-80">Ultra Suave</span>
          </button>
        </div>
      </div>

      {/* ── Controles de extracción ────────────────────────────────────────── */}
      <div className="bg-zinc-800/50 rounded-lg p-2 space-y-1.5 border border-white/5">
        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Ajustes de extracción</p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 w-16 flex-shrink-0">Umbral</span>
          <input type="range" min={30} max={225} value={threshold}
            onChange={e => setThreshold(+e.target.value)}
            className="flex-1 h-1 accent-violet-500"/>
          <span className="text-[9px] text-zinc-300 font-mono w-8 text-right">{threshold}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-500 w-16 flex-shrink-0">Precisión</span>
          <input type="range" min={12} max={96} step={4} value={numPoints}
            onChange={e => setNumPoints(+e.target.value)}
            className="flex-1 h-1 accent-violet-500"/>
          <span className="text-[9px] text-zinc-300 font-mono w-8 text-right">{numPoints}pt</span>
        </div>
      </div>

      {/* ── Tamaño final ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[9px] text-zinc-500 w-16 flex-shrink-0">Tamaño 3D</span>
        <input type="range" min={0.5} max={5} step={0.1} value={boxSize}
          onChange={e => setBoxSize(+e.target.value)} className="flex-1 h-1 accent-violet-500"/>
        <span className="text-[9px] text-zinc-300 font-mono w-8 text-right">{safeFixed(boxSize, 1)}</span>
      </div>

      {!allReady && (
        <p className="text-[9px] text-amber-400 text-center bg-amber-900/20 rounded px-2 py-1 border border-amber-900/50">
          ⚠ Define el contorno de los 3 planos para generar la malla
        </p>
      )}

      {/* Botón generar */}
      <button
        disabled={!allReady || processing}
        onClick={handleGenerate}
        className={`w-full py-3 rounded-lg text-[11px] font-bold transition-all ${
          allReady && !processing
            ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/20 cursor-pointer active:scale-98'
            : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-white/5'
        }`}
      >
        {processing ? '⏳ Generando malla 3D…' : allReady ? `✨ Crear Malla (${polyMode.toUpperCase()})` : 'Faltan contornos'}
      </button>

      {/* Ayuda */}
      <div className="bg-zinc-900/50 rounded p-2 text-[8px] text-zinc-500 border border-white/5">
        <p className="font-bold text-zinc-400 mb-1 uppercase tracking-widest">Instrucciones</p>
        <p>1. Selecciona un plano (Frontal, Trasero, etc.).</p>
        <p>2. Dibuja en el visor o sube una imagen para extraer la silueta.</p>
        <p>3. Elige el modo de poligonización: Low Poly (facetado), Medio o Alto (suave orgánico).</p>
        <p>4. Pulsa "Crear Malla" para generar el volumen 3D con corte booleano CSG.</p>
      </div>
    </div>
  );
};
