import React from 'react';
import { Project } from '../../types';
import { Globe, Magnet } from 'lucide-react';

interface ViewportNavigationControlsProps {
  project: Project;
  selectedObjectId: string | null;
  drawMode?: boolean | string | null;
  gridSnapEnabled: boolean;
  faceSnapConfig?: {
    enabled?: boolean;
    offset?: number;
    projectIndividualElements?: boolean;
  };
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  onResetView: () => void;
  onToggleHdriBg: () => void;
  onRecenterPivot: () => void;
  onAlignToAxes: () => void;
  onAlignToFloor: () => void;
  onToggleGridSnap: () => void;
  onToggleFaceSnap: () => void;
}

export const ViewportNavigationControls: React.FC<ViewportNavigationControlsProps> = ({
  project,
  selectedObjectId,
  drawMode,
  gridSnapEnabled,
  faceSnapConfig,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onResetView,
  onToggleHdriBg,
  onRecenterPivot,
  onAlignToAxes,
  onAlignToFloor,
  onToggleGridSnap,
  onToggleFaceSnap,
}) => {
  const isHdriActive =
    project.environment?.backgroundMode === 'HDRI' && project.environment?.backgroundVisible !== false;
  const isDrawActive = Boolean(drawMode);

  return (
    <div className="absolute top-10 left-1 sm:top-12 sm:left-2 z-40 flex flex-col gap-2 pointer-events-auto">
      {/* Zoom In */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onZoomIn();
        }}
        className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
        title="Acercar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Zoom Out */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onZoomOut();
        }}
        className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
        title="Alejar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Recenter */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRecenter();
        }}
        className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
        title="Recentrar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

      {/* Reset View */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onResetView();
        }}
        className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
        title="Reset Vista"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      {/* HDRI Background Toggle */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleHdriBg();
        }}
        className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border ${
          isHdriActive
            ? 'bg-amber-600/90 border-amber-400 text-white shadow-amber-500/20'
            : 'bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700'
        }`}
        title={
          isHdriActive
            ? 'Mapa HDRI de fondo: VISIBLE (Haz clic para ocultar del visor)'
            : 'Mapa HDRI de fondo: OCULTO (Haz clic para mostrar mapa HDRI en el visor)'
        }
      >
        <Globe size={16} />
      </button>

      {/* Object Specific Alignments */}
      {selectedObjectId && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRecenterPivot();
            }}
            className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
            title="Centrar Pivote / Origen al Objeto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAlignToAxes();
            }}
            className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
            title="Alinear a Ejes (90°)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16" />
              <path d="M4 4v16" />
              <path d="M14 10l-4-4-4 4" />
              <path d="M10 14l4 4 4-4" />
            </svg>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAlignToFloor();
            }}
            className="p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none active:bg-indigo-600 transition-colors border bg-zinc-800/95 border-white/10 text-white hover:bg-zinc-700"
            title="Alinear al Suelo (Y=0)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 22h20" />
              <path d="M12 2v14" />
              <path d="m7 11 5 5 5-5" />
            </svg>
          </button>
        </>
      )}

      {/* Grid snap toggle — only useful when drawMode is active */}
      {isDrawActive && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleGridSnap();
          }}
          className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none transition-colors border text-[10px] font-bold leading-none ${
            gridSnapEnabled
              ? 'bg-indigo-600 border-indigo-400 text-white'
              : 'bg-zinc-800/95 border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white'
          }`}
          title={gridSnapEnabled ? 'Snap a cuadrícula: ON' : 'Snap a cuadrícula: OFF'}
        >
          ⊞
        </button>
      )}

      {/* Face Snap / Snapping to geometry (Retopology magnet) */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFaceSnap();
        }}
        className={`p-2 sm:p-1.5 rounded-lg shadow-xl cursor-pointer touch-none transition-colors border text-[10px] font-bold leading-none flex items-center justify-center ${
          faceSnapConfig?.enabled
            ? 'bg-amber-500 border-amber-300 text-black shadow-amber-500/40 ring-1 ring-amber-400 font-black'
            : 'bg-zinc-800/95 border-white/10 text-zinc-400 hover:bg-zinc-700 hover:text-white'
        }`}
        title={
          faceSnapConfig?.enabled
            ? `Imán Ajuste a Caras: ACTIVADO (Offset: ${faceSnapConfig?.offset ?? 0.005}, Proy. Individual: ${
                faceSnapConfig?.projectIndividualElements ? 'SÍ' : 'NO'
              })`
            : 'Activar Imán Ajuste a Caras (Snapping para Retopología)'
        }
      >
        <Magnet size={14} className={faceSnapConfig?.enabled ? 'text-black' : 'text-zinc-400'} />
      </button>
    </div>
  );
};
