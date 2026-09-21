import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import {
  Play, Pause, Square, SkipBack, Clock, Circle, Key, Trash2,
  ChevronDown, Layers, Repeat, Sparkles
} from 'lucide-react';
import { motion } from 'framer-motion';
import { safeFixed } from '../utils/numberUtils';

// ── Constantes de layout ───────────────────────────────────────────────────
const ROW_H        = 22;   // px por fila de objeto
const HEADER_H     = 30;   // px cabecera de controles
const LABEL_W      = 130;  // px columna de nombres
const MIN_TRACK_H  = 36;   // altura mínima del área de tracks
const MAX_ROWS     = 3;    // filas visibles antes de scroll

// ── Colores por operación ──────────────────────────────────────────────────
const OP_COLOR: Record<string, string> = {
  ADD:       '#6366f1',
  SUBTRACT:  '#ef4444',
  INTERSECT: '#f59e0b',
};

const genId = () => Math.random().toString(36).substring(2, 9);

interface TimelineProps {
  onToggleCollapse?: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({ onToggleCollapse }) => {
  const {
    project, currentTime, setCurrentTime,
    isPlaying, setIsPlaying,
    isRecording, setIsRecording,
    selectedObjectId, selectedObjectIds, selectedCameraId,
    addKeyframe, removeKeyframe, clearAllKeyframes,
    selectObject, selectCamera,
  } = useStore();

  const { objects, cameras, duration } = project;

  // ── Animación y Bucle ──────────────────────────────────────────────────
  const [isLooping, setIsLooping] = useState(false);
  const rafRef      = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const tick = useCallback((now: number) => {
    if (lastTimeRef.current !== 0) {
      const dt = (now - lastTimeRef.current) / 1000;
      const s  = useStore.getState();
      if (s.isPlaying) {
        const next = s.currentTime + dt;
        if (next >= s.project.duration) {
          if (isLooping) {
            // Si el botón de bucle está activo, repite infinitamente
            s.setCurrentTime(0);
          } else {
            // COMPORTAMIENTO SOLICITADO: Vuelve al principio (0) pero se detiene ahí
            s.setIsPlaying(false);
            s.setCurrentTime(0);
          }
        } else {
          s.setCurrentTime(next);
        }
      }
    }
    lastTimeRef.current = now;
    rafRef.current = requestAnimationFrame(tick);
  }, [isLooping]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tick]);

  // ── Drag & Drop de Diamantes (Keyframes) ──────────────────────────────
  const [draggingKeyframe, setDraggingKeyframe] = useState<{
    itemId: string;
    keyframeId: string;
    initialTime: number;
    startX: number;
    trackWidth: number;
    type: 'object' | 'camera';
  } | null>(null);

  const handleKeyframePointerDown = (
    e: React.PointerEvent,
    itemId: string,
    kfId: string,
    kfTime: number,
    type: 'object' | 'camera'
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    setIsPlaying(false);

    const trackElem = target.closest('.track-lane') as HTMLElement;
    const trackWidth = trackElem ? trackElem.getBoundingClientRect().width : 500;

    setDraggingKeyframe({
      itemId,
      keyframeId: kfId,
      initialTime: kfTime,
      startX: e.clientX,
      trackWidth,
      type,
    });
  };

  const handleKeyframePointerMove = (e: React.PointerEvent) => {
    if (!draggingKeyframe) return;
    e.stopPropagation();

    const deltaX = e.clientX - draggingKeyframe.startX;
    const deltaTime = (deltaX / Math.max(1, draggingKeyframe.trackWidth)) * duration;
    
    let newTime = Math.max(0, Math.min(duration, draggingKeyframe.initialTime + deltaTime));
    
    // Magnetismo (Snapping) a décimas de segundo (0.1s) si está cerca (±0.04s)
    if (Math.abs(newTime - Math.round(newTime * 10) / 10) < 0.04) {
      newTime = Math.round(newTime * 10) / 10;
    }

    const state = useStore.getState();
    const proj = state.project;

    if (draggingKeyframe.type === 'object') {
      const updatedObjects = proj.objects.map((o) => {
        if (o.id !== draggingKeyframe.itemId) return o;
        const kfs = (o.keyframes || []).map((kf) =>
          kf.id === draggingKeyframe.keyframeId ? { ...kf, time: newTime } : kf
        ).sort((a, b) => a.time - b.time);
        return { ...o, keyframes: kfs };
      });
      state.setProject({ ...proj, objects: updatedObjects });
    } else {
      const updatedCameras = (proj.cameras || []).map((c) => {
        if (c.id !== draggingKeyframe.itemId) return c;
        const kfs = (c.keyframes || []).map((kf) =>
          kf.id === draggingKeyframe.keyframeId ? { ...kf, time: newTime } : kf
        ).sort((a, b) => a.time - b.time);
        return { ...c, keyframes: kfs };
      });
      state.setProject({ ...proj, cameras: updatedCameras });
    }

    setCurrentTime(newTime);
  };

  const handleKeyframePointerUp = (e: React.PointerEvent) => {
    if (!draggingKeyframe) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    const state = useStore.getState();
    if (state.saveHistory) state.saveHistory();
    setDraggingKeyframe(null);
  };

  // ── Lógica Masiva: Insertar Keyframe en Todo lo que hay en Escena ──
  const handleInsertKeyframeAll = () => {
    setIsPlaying(false);
    const state = useStore.getState();
    const proj = state.project;
    const time = state.currentTime;

    const updatedObjects = proj.objects.map((obj) => {
      const currentKfs = obj.keyframes || [];
      const newKf = { id: genId(), time, transform: JSON.parse(JSON.stringify(obj.transform)) };
      const filtered = currentKfs.filter((k) => Math.abs(k.time - time) > 0.001);
      const newKfs = [...filtered, newKf].sort((a, b) => a.time - b.time);
      return { ...obj, keyframes: newKfs };
    });

    const updatedCameras = (proj.cameras || []).map((cam) => {
      const currentKfs = cam.keyframes || [];
      const newKf = { id: genId(), time, transform: JSON.parse(JSON.stringify(cam.transform)) };
      const filtered = currentKfs.filter((k) => Math.abs(k.time - time) > 0.001);
      const newKfs = [...filtered, newKf].sort((a, b) => a.time - b.time);
      return { ...cam, keyframes: newKfs };
    });

    state.setProject({
      ...proj,
      objects: updatedObjects,
      cameras: updatedCameras,
    });
    if (state.saveHistory) state.saveHistory();
  };

  // ── Borrar Keyframe individual ──
  const handleKfDelete = (e: React.MouseEvent | React.PointerEvent, itemId: string, kfId: string, type: 'object' | 'camera') => {
    e.stopPropagation();
    e.preventDefault();
    const state = useStore.getState();
    const proj = state.project;
    if (type === 'object') {
      state.removeKeyframe(itemId, kfId);
    } else {
      const updatedCameras = (proj.cameras || []).map((c) =>
        c.id === itemId ? { ...c, keyframes: (c.keyframes || []).filter((k) => k.id !== kfId) } : c
      );
      state.setProject({ ...proj, cameras: updatedCameras });
      if (state.saveHistory) state.saveHistory();
    }
  };

  // ── Canales de Animación (Cámaras + Objetos) ─────────────────────────
  const animableItems = [
    ...(cameras || []).map((c) => ({
      id: c.id,
      name: c.name || 'Cámara',
      type: 'camera' as const,
      color: '#f59e0b',
      keyframes: c.keyframes || [],
    })),
    ...(objects || []).map((o) => ({
      id: o.id,
      name: o.name || 'Objeto 3D',
      type: 'object' as const,
      color: OP_COLOR[o.operation] || '#6366f1',
      keyframes: o.keyframes || [],
    }))
  ];

  const trackRef = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const visibleCount = Math.min(Math.max(animableItems.length, 1), MAX_ROWS);
  const trackAreaH = visibleCount * ROW_H + 16;

  // ── Drag & Click en el track para mover playhead ──────────────────────────
  const isDraggingRef = useRef(false);

  const updateTimeFromPointer = useCallback((clientX: number, targetElem: HTMLDivElement) => {
    const rect = targetElem.getBoundingClientRect();
    const x    = clientX - rect.left - LABEL_W;
    const w    = rect.width - LABEL_W;
    if (w <= 0) return;
    const t = Math.max(0, Math.min(duration, (x / w) * duration));
    setIsPlaying(false);
    setCurrentTime(t);
  }, [duration, setIsPlaying, setCurrentTime]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const targetElem = e.currentTarget;
    try { targetElem.setPointerCapture(e.pointerId); } catch {}
    isDraggingRef.current = true;
    updateTimeFromPointer(e.clientX, targetElem);
  }, [updateTimeFromPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      updateTimeFromPointer(e.clientX, e.currentTarget);
    }
  }, [updateTimeFromPointer]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
  }, []);

  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    updateTimeFromPointer(e.clientX, e.currentTarget);
  }, [updateTimeFromPointer]);

  const fmt = (t: number) => safeFixed(t, 2);

  // ── Tick labels ────────────────────────────────────────────────────────
  const tickCount = Math.min(Math.floor(duration) + 1, 11);
  const tickTimes = Array.from({ length: tickCount }, (_, i) =>
    duration <= 10 ? i : Math.round((i / (tickCount - 1)) * duration)
  );

  return (
    <div className="flex flex-col select-none text-zinc-300 bg-zinc-950/90 backdrop-blur-xl border-t border-white/5 relative overflow-hidden">
      
      {/* ══════════════ CONTROLES DE TRANSPORTE Y ACCIONES ══════════════ */}
      <div
        className="flex items-center justify-between px-2 sm:px-3 flex-shrink-0 border-b border-white/5 bg-zinc-900/60"
        style={{ height: HEADER_H }}
      >
        {/* Izquierda: transporte */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Ir al inicio */}
          <button
            onClick={() => setCurrentTime(0)}
            className="p-1 rounded-md transition-all text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
            title="Ir al inicio (0s)"
          >
            <SkipBack size={12} />
          </button>

          {/* Play/Pause */}
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`w-6 h-6 flex items-center justify-center rounded-full transition-all flex-shrink-0 shadow-md ${
              isPlaying 
                ? 'bg-indigo-600 text-white shadow-indigo-500/20 scale-105' 
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
            title={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying
              ? <Pause size={12} fill="currentColor" />
              : <Play  size={12} fill="currentColor" className="ml-0.5" />
            }
          </button>

          {/* Stop */}
          <button
            onClick={() => { setIsPlaying(false); setCurrentTime(0); }}
            className="p-1 rounded-md transition-all text-zinc-500 hover:text-zinc-200 hover:bg-white/5"
            title="Detener"
          >
            <Square size={11} fill="currentColor" />
          </button>

          {/* Loop / Bucle */}
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`p-1 rounded-md transition-all ${
              isLooping
                ? 'text-indigo-400 bg-indigo-500/20 font-bold'
                : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'
            }`}
            title={isLooping ? 'Bucle activado' : 'Bucle desactivado'}
          >
            <Repeat size={11} />
          </button>

          <div className="w-px h-3.5 bg-white/10 mx-0.5" />

          {/* Auto-Key REC */}
          <button
            onClick={() => setIsRecording(!isRecording)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold transition-all border ${
              isRecording
                ? 'bg-rose-600 text-white border-rose-400 shadow-sm shadow-rose-500/20'
                : 'bg-zinc-800/60 text-zinc-400 border-white/5 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
            title={isRecording ? 'Detener Auto-Key' : 'Auto-Key: graba keyframe al mover'}
          >
            <Circle size={8} fill={isRecording ? 'currentColor' : 'none'} />
            <span className="hidden sm:inline">REC</span>
          </button>

          <div className="w-px h-3.5 bg-white/10 mx-0.5" />

          {/* Keyframe individual de objeto seleccionado */}
          <button
            onClick={() => selectedObjectId && addKeyframe(selectedObjectId, currentTime)}
            disabled={!selectedObjectId}
            className="p-1 rounded-md transition-all text-zinc-400 hover:text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-20"
            title={selectedObjectId ? `Keyframe objeto en ${fmt(currentTime)}s` : 'Selecciona un objeto para añadir keyframe'}
          >
            <Key size={12} />
          </button>

          {/* Botón Insertar Keyframe General (+K) */}
          <button
            onClick={handleInsertKeyframeAll}
            title="Insertar fotogramas clave en todos los objetos y cámaras visibles (+K)"
            className="flex items-center gap-1 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm transition-all hover:scale-105 active:scale-95"
          >
            <Sparkles size={11} className="text-cyan-200" />
            <span className="hidden md:inline">Keyframe General</span>
            <span className="text-[8.5px] bg-black/30 font-mono px-1 rounded text-cyan-200">+K</span>
          </button>

          {/* Clear keyframes for selected object */}
          <button
            onClick={() => selectedObjectId && clearAllKeyframes(selectedObjectId)}
            disabled={!selectedObjectId}
            className="p-1 rounded-md transition-all text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-20"
            title="Borrar todos los keyframes del objeto seleccionado"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* Centro: Tiempo */}
        <div className="flex items-center gap-1.5 font-mono text-[10px] bg-zinc-900/80 px-2.5 py-0.5 rounded-full border border-white/5 shadow-inner">
          <Clock size={11} className="text-cyan-400" />
          <div className="flex items-center gap-0.5">
            <span className="text-zinc-100 font-bold">{fmt(currentTime)}s</span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">{duration}s</span>
          </div>
        </div>

        {/* Derecha: Minimizar */}
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-all border border-white/10 shadow-xs active:scale-95"
              title="Minimizar línea de tiempo"
            >
              <span className="text-[9.5px] font-bold">Minimizar</span>
              <ChevronDown size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ══════════════ ÁREA DE TRACKS Y CANALES ══════════════ */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ height: trackAreaH }}
      >
        {/* Ruler de tiempo + track clickeable */}
        <div className="flex flex-shrink-0 bg-zinc-950/60" style={{ height: 16 }}>
          {/* Spacer del label */}
          <div className="flex-shrink-0 border-r border-white/5 px-2 flex items-center" style={{ width: LABEL_W }}>
            <span className="text-[8px] font-bold uppercase text-zinc-500 tracking-wider">Canales</span>
          </div>
          {/* Ruler */}
          <div
            className="relative flex-1 cursor-pointer touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {tickTimes.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 flex flex-col items-center pointer-events-none"
                style={{ left: `${duration > 0 ? (t / duration) * 100 : 0}%`, transform: 'translateX(-50%)' }}
              >
                <div className="w-px h-1.5 bg-white/10" />
                <span className="text-[7.5px] font-mono text-zinc-500 mt-0">{t}s</span>
              </div>
            ))}
            {/* Playhead en ruler */}
            <div
              className="absolute top-0 bottom-0 w-px pointer-events-none z-10 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
              style={{ left: `${pct}%` }}
            >
              <div className="absolute top-0 -left-[3px] w-1.5 h-1.5 bg-cyan-400 transform rotate-45 rounded-xs" />
            </div>
          </div>
        </div>

        {/* Filas de canales */}
        <div
          ref={trackRef}
          className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar"
        >
          {animableItems.length === 0 ? (
            <div className="flex items-center justify-center h-full gap-2 text-zinc-600 py-1">
              <Layers size={13} className="opacity-20" />
              <span className="text-[10px] font-medium italic">Añade objetos o cámaras a la escena para comenzar a animar</span>
            </div>
          ) : (
            animableItems.map((item) => {
              const isSelected = item.type === 'object'
                ? item.id === selectedObjectId || (selectedObjectIds || []).includes(item.id)
                : item.id === selectedCameraId;
              
              const keyframes = item.keyframes || [];

              return (
                <div
                  key={item.id}
                  className="flex flex-shrink-0 group/row"
                  style={{ height: ROW_H, borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                >
                  {/* ── Label de Canal ── */}
                  <div
                    className={`flex items-center gap-1.5 px-2 flex-shrink-0 cursor-pointer transition-all border-r border-white/5 ${
                      isSelected ? 'bg-cyan-500/10' : 'hover:bg-white/[0.02]'
                    }`}
                    style={{ width: LABEL_W }}
                    onClick={() => {
                      if (item.type === 'object') selectObject(item.id);
                      else selectCamera(item.id);
                    }}
                  >
                    <span className="text-[10px] flex-shrink-0">
                      {item.type === 'camera' ? '📹' : '📦'}
                    </span>
                    <span
                      className={`text-[10px] truncate flex-1 transition-colors ${
                        isSelected ? 'text-cyan-200 font-bold' : 'text-zinc-400 group-hover/row:text-zinc-200'
                      }`}
                    >
                      {item.name}
                    </span>
                    {keyframes.length > 0 && (
                      <span
                        className={`text-[7.5px] font-bold flex-shrink-0 px-1 py-0 rounded-full ${
                          isSelected ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/5 text-zinc-500'
                        }`}
                      >
                        {keyframes.length}
                      </span>
                    )}
                  </div>

                  {/* ── Pista Horizontal del Track ── */}
                  <div
                    className={`track-lane relative flex-1 cursor-pointer transition-colors ${
                      isSelected ? 'bg-cyan-500/[0.02]' : 'bg-transparent'
                    }`}
                    onClick={handleTrackClick}
                  >
                    {/* Barra de Rango conector entre primer y último keyframe */}
                    {keyframes.length >= 2 && (() => {
                      const sortedTimes = keyframes.map((k) => k.time).sort((a, b) => a - b);
                      const first = sortedTimes[0];
                      const last  = sortedTimes[sortedTimes.length - 1];
                      const l = (first / duration) * 100;
                      const w = ((last - first) / duration) * 100;
                      return (
                        <div
                          className="absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none opacity-40 shadow-inner"
                          style={{
                            left: `${l}%`,
                            width: `${w}%`,
                            height: 3,
                            background: isSelected ? item.color : 'rgba(255,255,255,0.1)',
                          }}
                        />
                      );
                    })()}

                    {/* Diamantes de Keyframe con Arrastre y Snapping */}
                    {keyframes.map((kf) => {
                      const kfPct = duration > 0 ? (kf.time / duration) * 100 : 0;
                      const isAtCurrent = Math.abs(kf.time - currentTime) < 0.02;
                      const isDragging = draggingKeyframe?.keyframeId === kf.id;

                      return (
                        <div
                          key={kf.id}
                          onPointerDown={(e) => handleKeyframePointerDown(e, item.id, kf.id, kf.time, item.type)}
                          onPointerMove={handleKeyframePointerMove}
                          onPointerUp={handleKeyframePointerUp}
                          onContextMenu={(e) => handleKfDelete(e, item.id, kf.id, item.type)}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.type === 'object') selectObject(item.id);
                            else selectCamera(item.id);
                            setCurrentTime(kf.time);
                          }}
                          className={`absolute top-1/2 z-30 transform -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize transition-transform ${
                            isDragging ? 'scale-125 z-40' : 'hover:scale-125'
                          }`}
                          style={{
                            left: `${kfPct}%`,
                            width: 8,
                            height: 8,
                            borderRadius: 1.5,
                            background: isDragging ? '#ffffff' : (isAtCurrent ? '#ffffff' : item.color),
                            border: `1.5px solid ${isDragging ? '#22d3ee' : (isAtCurrent ? '#22d3ee' : '#18181b')}`,
                            boxShadow: isAtCurrent || isDragging
                              ? '0 0 8px rgba(34,211,238,0.9)'
                              : `0 0 3px ${item.color}66`,
                          }}
                          title={`Keyframe: ${kf.time.toFixed(2)}s\n• Arrastra para mover\n• Clic secundario para borrar`}
                        />
                      );
                    })}

                    {/* Línea Playhead */}
                    <div
                      className="absolute top-0 bottom-0 w-px pointer-events-none z-20 bg-cyan-400/30"
                      style={{ left: `${pct}%` }}
                    />

                    {/* Input invisible para scrubbing libre */}
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={0.001}
                      value={currentTime}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setIsPlaying(false);
                        const state = useStore.getState() as any;
                        if (state.setIsScrubbing) state.setIsScrubbing(true);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        const state = useStore.getState() as any;
                        if (state.setIsScrubbing) state.setIsScrubbing(false);
                      }}
                      onChange={(e) => {
                        setIsPlaying(false);
                        setCurrentTime(parseFloat(e.target.value));
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Pie con Ayuda / Tips ── */}
      <div
        className="flex items-center justify-between px-2.5 py-0.5 flex-shrink-0 border-t border-white/5 bg-zinc-950/60"
      >
        <span className="text-[8.5px] font-medium text-zinc-500 italic">
          Arrastra los diamantes ◆ para ajustar tiempos · +K graba la escena completa · Clic secundario para borrar
        </span>
        {isRecording && (
          <motion.span 
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-[8.5px] font-bold text-rose-400 tracking-widest uppercase"
          >
            ● Grabando Movimiento
          </motion.span>
        )}
      </div>
    </div>
  );
};

