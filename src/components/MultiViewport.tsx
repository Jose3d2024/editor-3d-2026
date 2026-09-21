import React, { useRef } from 'react';
import { Viewport } from './Viewport';
import { ViewportErrorBoundary } from './ViewportErrorBoundary';
import { PrecisionDrawToolbar } from './PrecisionDrawToolbar';
import { useStore } from '../store/useStore';
import { ViewportType, ViewportLayoutPreset } from '../types';
import { Move, Check, RotateCcw } from 'lucide-react';

const getTitle = (type: string) => {
  switch (type) {
    case 'PERSPECTIVE': return 'Perspectiva';
    case 'TOP': return 'Superior (Planta)';
    case 'BOTTOM': return 'Inferior';
    case 'FRONT': return 'Frontal';
    case 'BACK': return 'Trasera';
    case 'LEFT': return 'Izquierda';
    case 'RIGHT': return 'Derecha';
    case 'CAMERA': return 'Cámara';
    default: return type;
  }
};

interface SlotConfig {
  id: string;
  defaultType: ViewportType;
  defaultTitle: string;
  rect: (splitX: number, splitY: number) => { left: string; top: string; width: string; height: string };
}

const PRESET_SLOTS: Record<ViewportLayoutPreset, SlotConfig[]> = {
  QUAD: [
    { id: 'quad-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (sx, sy) => ({ left: '0%', top: '0%', width: `${sx * 100}%`, height: `${sy * 100}%` }) },
    { id: 'quad-1', defaultType: 'TOP', defaultTitle: 'Superior (Planta)', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: '0%', width: `${(1 - sx) * 100}%`, height: `${sy * 100}%` }) },
    { id: 'quad-2', defaultType: 'FRONT', defaultTitle: 'Frontal', rect: (sx, sy) => ({ left: '0%', top: `${sy * 100}%`, width: `${sx * 100}%`, height: `${(1 - sy) * 100}%` }) },
    { id: 'quad-3', defaultType: 'RIGHT', defaultTitle: 'Derecha', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: `${sy * 100}%`, width: `${(1 - sx) * 100}%`, height: `${(1 - sy) * 100}%` }) },
  ],
  SINGLE: [
    { id: 'single-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: () => ({ left: '0%', top: '0%', width: '100%', height: '100%' }) },
  ],
  TOP_1_BOTTOM_2: [
    { id: 't1b2-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (_, sy) => ({ left: '0%', top: '0%', width: '100%', height: `${sy * 100}%` }) },
    { id: 't1b2-1', defaultType: 'FRONT', defaultTitle: 'Frontal', rect: (sx, sy) => ({ left: '0%', top: `${sy * 100}%`, width: `${sx * 100}%`, height: `${(1 - sy) * 100}%` }) },
    { id: 't1b2-2', defaultType: 'RIGHT', defaultTitle: 'Derecha', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: `${sy * 100}%`, width: `${(1 - sx) * 100}%`, height: `${(1 - sy) * 100}%` }) },
  ],
  TOP_2_BOTTOM_1: [
    { id: 't2b1-0', defaultType: 'FRONT', defaultTitle: 'Frontal', rect: (sx, sy) => ({ left: '0%', top: '0%', width: `${sx * 100}%`, height: `${sy * 100}%` }) },
    { id: 't2b1-1', defaultType: 'RIGHT', defaultTitle: 'Derecha', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: '0%', width: `${(1 - sx) * 100}%`, height: `${sy * 100}%` }) },
    { id: 't2b1-2', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (_, sy) => ({ left: '0%', top: `${sy * 100}%`, width: '100%', height: `${(1 - sy) * 100}%` }) },
  ],
  LEFT_1_RIGHT_2: [
    { id: 'l1r2-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (sx) => ({ left: '0%', top: '0%', width: `${sx * 100}%`, height: '100%' }) },
    { id: 'l1r2-1', defaultType: 'TOP', defaultTitle: 'Superior (Planta)', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: '0%', width: `${(1 - sx) * 100}%`, height: `${sy * 100}%` }) },
    { id: 'l1r2-2', defaultType: 'FRONT', defaultTitle: 'Frontal', rect: (sx, sy) => ({ left: `${sx * 100}%`, top: `${sy * 100}%`, width: `${(1 - sx) * 100}%`, height: `${(1 - sy) * 100}%` }) },
  ],
  RIGHT_1_LEFT_2: [
    { id: 'r1l2-0', defaultType: 'TOP', defaultTitle: 'Superior (Planta)', rect: (sx, sy) => ({ left: '0%', top: '0%', width: `${sx * 100}%`, height: `${sy * 100}%` }) },
    { id: 'r1l2-1', defaultType: 'FRONT', defaultTitle: 'Frontal', rect: (sx, sy) => ({ left: '0%', top: `${sy * 100}%`, width: `${sx * 100}%`, height: `${(1 - sy) * 100}%` }) },
    { id: 'r1l2-2', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (sx) => ({ left: `${sx * 100}%`, top: '0%', width: `${(1 - sx) * 100}%`, height: '100%' }) },
  ],
  SPLIT_H: [
    { id: 'splith-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (_, sy) => ({ left: '0%', top: '0%', width: '100%', height: `${sy * 100}%` }) },
    { id: 'splith-1', defaultType: 'TOP', defaultTitle: 'Superior (Planta)', rect: (_, sy) => ({ left: '0%', top: `${sy * 100}%`, width: '100%', height: `${(1 - sy) * 100}%` }) },
  ],
  SPLIT_V: [
    { id: 'splitv-0', defaultType: 'PERSPECTIVE', defaultTitle: 'Perspectiva', rect: (sx) => ({ left: '0%', top: '0%', width: `${sx * 100}%`, height: '100%' }) },
    { id: 'splitv-1', defaultType: 'TOP', defaultTitle: 'Superior (Planta)', rect: (sx) => ({ left: `${sx * 100}%`, top: '0%', width: `${(1 - sx) * 100}%`, height: `${(1 - sx) * 100}%` }) },
  ],
};

export const MultiViewport: React.FC = () => {
  const {
    maximizedViewport,
    activeViewport,
    viewportConfig,
    setViewportSplits,
    setCustomResizeMode,
    resetViewportSplits,
  } = useStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingX = useRef(false);
  const isDraggingY = useRef(false);

  const preset = viewportConfig?.preset || 'QUAD';
  const splitX = viewportConfig?.splitX ?? 0.5;
  const splitY = viewportConfig?.splitY ?? 0.5;
  const customResizeMode = !!viewportConfig?.customResizeMode;

  const currentSlots = PRESET_SLOTS[preset] || PRESET_SLOTS.QUAD;

  let maximizedIndex = -1;
  if (maximizedViewport) {
    maximizedIndex = currentSlots.findIndex(s => s.defaultType === maximizedViewport);
    if (maximizedIndex === -1) {
      maximizedIndex = currentSlots.findIndex(s => s.defaultType === activeViewport);
      if (maximizedIndex === -1) maximizedIndex = 0;
    }
  }

  const handlePointerDown = (axis: 'X' | 'Y' | 'BOTH', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}

    if (axis === 'X' || axis === 'BOTH') isDraggingX.current = true;
    if (axis === 'Y' || axis === 'BOTH') isDraggingY.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current || (!isDraggingX.current && !isDraggingY.current)) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let newX = splitX;
    let newY = splitY;

    if (isDraggingX.current) {
      const relX = (e.clientX - rect.left) / rect.width;
      newX = Math.max(0.15, Math.min(0.85, relX));
    }
    if (isDraggingY.current) {
      const relY = (e.clientY - rect.top) / rect.height;
      newY = Math.max(0.15, Math.min(0.85, relY));
    }

    setViewportSplits(newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingX.current = false;
    isDraggingY.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const hasHDivider = preset !== 'SINGLE' && preset !== 'SPLIT_V';
  const hasVDivider = preset !== 'SINGLE' && preset !== 'SPLIT_H';
  const hasCenterNode = hasHDivider && hasVDivider;

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-zinc-950 relative overflow-hidden select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Precision Drawing and Vertex Draggable Micro Toolbar */}
      <PrecisionDrawToolbar />

      {/* Viewport Slots */}
      {currentSlots.map((slot, index) => {
        const isMaximized = maximizedViewport !== null;
        const isThisMaximized = isMaximized && index === maximizedIndex;
        const isHidden = isMaximized && !isThisMaximized;

        const type = (isThisMaximized && slot.defaultType !== maximizedViewport)
          ? (maximizedViewport as ViewportType)
          : slot.defaultType;
        const title = getTitle(type);

        const r = isMaximized
          ? { left: '0%', top: '0%', width: '100%', height: '100%' }
          : slot.rect(splitX, splitY);

        return (
          <div
            key={slot.id}
            className={`absolute ${isHidden ? 'hidden' : 'block'} p-px border border-zinc-900/60 transition-[width,height,top,left] duration-75`}
            style={{
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
            }}
          >
            <ViewportErrorBoundary viewportType={type} fallbackTitle={`Visor ${title}`}>
              <Viewport type={type} title={title} />
            </ViewportErrorBoundary>
          </div>
        );
      })}

      {/* Resize Controls Overlay when Custom Resize Mode is ON */}
      {customResizeMode && !maximizedViewport && preset !== 'SINGLE' && (
        <>
          {/* Top Info Badge */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-amber-950/90 border border-amber-500/60 text-amber-200 px-4 py-1.5 rounded-full shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs font-semibold animate-fade-in">
            <div className="flex items-center gap-1.5">
              <Move size={14} className="text-amber-400 animate-pulse" />
              <span>Personalización de Tamaño Activa (Arrastra los divisores)</span>
            </div>
            <div className="h-3 w-px bg-amber-500/40" />
            <button
              onClick={() => setCustomResizeMode(false)}
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold px-3 py-0.5 rounded-full text-[11px] transition-all cursor-pointer flex items-center gap-1 shadow"
            >
              <Check size={12} />
              Fijar Tamaño
            </button>
            <button
              onClick={() => resetViewportSplits()}
              className="text-amber-300 hover:text-white text-[10px] flex items-center gap-1 underline cursor-pointer"
              title="Restablecer divisiones a 50/50"
            >
              <RotateCcw size={10} />
              Reset 50/50
            </button>
          </div>

          {/* Horizontal Split Line Handle */}
          {hasHDivider && (
            <div
              style={{ top: `${splitY * 100}%` }}
              className="absolute left-0 right-0 -translate-y-1/2 z-40 h-4 cursor-row-resize flex items-center justify-center group"
              onPointerDown={(e) => handlePointerDown('Y', e)}
            >
              <div className="w-full h-1 bg-amber-500 group-hover:bg-amber-300 group-hover:h-1.5 transition-all shadow-[0_0_10px_rgba(245,158,11,0.9)]" />
            </div>
          )}

          {/* Vertical Split Line Handle */}
          {hasVDivider && (
            <div
              style={{ left: `${splitX * 100}%` }}
              className="absolute top-0 bottom-0 -translate-x-1/2 z-40 w-4 cursor-col-resize flex items-center justify-center group"
              onPointerDown={(e) => handlePointerDown('X', e)}
            >
              <div className="h-full w-1 bg-amber-500 group-hover:bg-amber-300 group-hover:w-1.5 transition-all shadow-[0_0_10px_rgba(245,158,11,0.9)]" />
            </div>
          )}

          {/* Center 4-Way Intersection Node Handle */}
          {hasCenterNode && (
            <div
              style={{ left: `${splitX * 100}%`, top: `${splitY * 100}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-50 w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center cursor-move shadow-2xl border-2 border-white transition-transform hover:scale-110 font-bold"
              onPointerDown={(e) => handlePointerDown('BOTH', e)}
              title="Arrastrar centro para cambiar dimensiones horizontal y vertical"
            >
              <Move size={18} />
            </div>
          )}
        </>
      )}
    </div>
  );
};
