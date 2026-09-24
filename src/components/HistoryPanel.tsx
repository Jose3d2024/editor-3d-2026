import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import {
  History,
  RotateCcw,
  RotateCw,
  Clock,
  Sparkles,
  Scissors,
  Move,
  Box,
  Trash2,
  Palette,
  Combine,
  Wand2,
  CheckCircle2,
  ChevronRight,
  Search,
  Filter,
  Layers,
  ArrowUpCircle,
  HelpCircle
} from 'lucide-react';
import type { HistoryStep } from '../types';

export const HistoryPanel: React.FC = () => {
  const {
    historySteps,
    historyIndex,
    undo,
    redo,
    jumpToHistory,
    clearHistory,
    deleteHistoryStep,
    deleteFutureHistory,
    deletePastHistory,
    selectedObjectId,
    project
  } = useStore();

  const [filterQuery, setFilterQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [filterCurrentOnly, setFilterCurrentOnly] = useState(false);

  // Identify active object
  const activeObj = useMemo(() => {
    return selectedObjectId ? project.objects.find(o => o.id === selectedObjectId) : null;
  }, [selectedObjectId, project.objects]);

  // Filtered steps
  const filteredSteps = useMemo(() => {
    return (historySteps || []).map((step, index) => ({ step, index })).filter(({ step, index }) => {
      if (filterCurrentOnly && activeObj && step.objectId && step.objectId !== activeObj.id) {
        return false;
      }
      if (categoryFilter !== 'all' && step.category !== categoryFilter) {
        return false;
      }
      if (filterQuery.trim()) {
        const q = filterQuery.toLowerCase();
        const matchLabel = step.label.toLowerCase().includes(q);
        const matchObj = (step.objectName || '').toLowerCase().includes(q);
        if (!matchLabel && !matchObj) return false;
      }
      return true;
    });
  }, [historySteps, filterQuery, categoryFilter, filterCurrentOnly, activeObj]);

  const getStepIcon = (step: HistoryStep) => {
    const label = step.label.toLowerCase();
    const cat = step.category;

    if (cat === 'retopo' || label.includes('remesh') || label.includes('retopo')) {
      return <Sparkles size={14} className="text-fuchsia-400" />;
    }
    if (cat === 'edit' || label.includes('extru') || label.includes('bisel') || label.includes('malla') || label.includes('subdiv')) {
      return <Scissors size={14} className="text-emerald-400" />;
    }
    if (cat === 'transform' || label.includes('rotar') || label.includes('mover') || label.includes('escalar') || label.includes('transform')) {
      return <Move size={14} className="text-amber-400" />;
    }
    if (cat === 'boolean' || label.includes('boolean') || label.includes('unión') || label.includes('resta')) {
      return <Combine size={14} className="text-purple-400" />;
    }
    if (cat === 'create' || label.includes('añadir') || label.includes('crear') || label.includes('duplicar')) {
      return <Box size={14} className="text-cyan-400" />;
    }
    if (cat === 'delete' || label.includes('eliminar') || label.includes('borrar')) {
      return <Trash2 size={14} className="text-rose-400" />;
    }
    if (cat === 'material' || label.includes('material') || label.includes('color') || label.includes('textura')) {
      return <Palette size={14} className="text-indigo-400" />;
    }
    return <Clock size={14} className="text-zinc-400" />;
  };

  const formatTime = (ts: number) => {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getDisplayStepLabel = (step: HistoryStep) => {
    if (!step.label) return 'Herramienta de Malla';
    // Si el paso histórico viene con el prefijo genérico antiguo "Modificar [Objeto]"
    if (step.label.startsWith('Modificar ')) {
      if (step.category === 'retopo') return 'Ceñir / Retopología (Shrinkwrap)';
      if (step.category === 'edit') return 'Edición de Malla';
      if (step.category === 'transform') return 'Transformar: Mover / Rotar';
      if (step.category === 'material') return 'Material y Color';
      if (step.category === 'boolean') return 'Operación Booleana';
      if (step.category === 'create') return 'Creación de Malla';
      return 'Edición / Herramienta de Malla';
    }
    return step.label;
  };

  const canUndo = historyIndex > 0;
  const canRedo = historySteps && historyIndex < historySteps.length - 1;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-zinc-950 overflow-hidden select-none text-zinc-200">
      {/* ── Header ── */}
      <div className="p-3 border-b border-zinc-800 space-y-2.5 bg-zinc-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <History size={16} />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Historial de Herramientas</h3>
              <p className="text-[10px] text-zinc-400">
                Paso <span className="text-amber-300 font-mono font-bold">{historyIndex + 1}</span> de <span className="font-mono">{historySteps?.length || 1}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {historyIndex < (historySteps?.length || 1) - 1 && (
              <button
                type="button"
                onClick={deleteFutureHistory}
                title="Eliminar todos los pasos futuros de rehacer a partir del paso actual"
                className="px-1.5 py-0.5 bg-zinc-850 hover:bg-rose-900/60 text-zinc-400 hover:text-rose-200 text-[9px] font-semibold rounded border border-zinc-700/60 hover:border-rose-700/60 transition-colors cursor-pointer"
              >
                Podar Futuros
              </button>
            )}
            {historyIndex > 0 && (
              <button
                type="button"
                onClick={deletePastHistory}
                title="Borrar pasos anteriores conservando el estado actual"
                className="px-1.5 py-0.5 bg-zinc-850 hover:bg-zinc-750 text-zinc-400 hover:text-zinc-200 text-[9px] font-semibold rounded border border-zinc-700/60 transition-colors cursor-pointer"
              >
                Podar Anteriores
              </button>
            )}
            <button
              type="button"
              onClick={clearHistory}
              title="Consolidar el estado actual y limpiar todo el historial previo"
              className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] font-semibold rounded border border-zinc-700 transition-colors cursor-pointer"
            >
              Consolidar
            </button>
          </div>
        </div>

        {/* Action Controls: Undo, Redo, Jump to Origin */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Deshacer el último paso (Ctrl+Z)"
            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              canUndo
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 shadow-sm active:scale-95'
                : 'bg-zinc-900/50 text-zinc-600 border border-zinc-800/40 cursor-not-allowed opacity-50'
            }`}
          >
            <RotateCcw size={12} />
            <span>Deshacer</span>
          </button>

          <button
            type="button"
            onClick={() => jumpToHistory(0)}
            disabled={historyIndex === 0}
            title="Volver directamente al estado inicial del proyecto"
            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              historyIndex > 0
                ? 'bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-zinc-700 shadow-sm active:scale-95'
                : 'bg-zinc-900/50 text-zinc-600 border border-zinc-800/40 cursor-not-allowed opacity-50'
            }`}
          >
            <ArrowUpCircle size={12} />
            <span>Al Inicio</span>
          </button>

          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Rehacer el siguiente paso (Ctrl+Y)"
            className={`py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              canRedo
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 shadow-sm active:scale-95'
                : 'bg-zinc-900/50 text-zinc-600 border border-zinc-800/40 cursor-not-allowed opacity-50'
            }`}
          >
            <RotateCw size={12} />
            <span>Rehacer</span>
          </button>
        </div>

        {/* Barra de resumen comparativo de polígonos */}
        {(() => {
          const currentStep = historySteps[historyIndex];
          const firstStep = historySteps[0];
          const curFaces = currentStep?.faceCount ?? currentStep?.totalSceneFaces ?? 0;
          const initialFaces = firstStep?.faceCount ?? firstStep?.totalSceneFaces ?? 0;
          const totalDiff = initialFaces > 0 && curFaces > 0 ? curFaces - initialFaces : 0;

          return (
            <div className="bg-zinc-900/90 border border-zinc-800/90 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-[9.5px] font-mono shadow-inner">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400 font-sans text-[9px]">Paso Actual:</span>
                <span className="text-amber-300 font-bold">{curFaces.toLocaleString()} caras</span>
              </div>
              {totalDiff !== 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 font-sans text-[8.5px]">Vs. Inicio:</span>
                  <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold border ${
                    totalDiff < 0
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                  }`}>
                    {totalDiff < 0 ? `-${Math.abs(totalDiff).toLocaleString()}` : `+${totalDiff.toLocaleString()}`}
                    {initialFaces > 0 && ` (${totalDiff < 0 ? '-' : '+'}${Math.abs(Math.round((totalDiff / initialFaces) * 100))}%)`}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Search & Filters */}
        <div className="space-y-1.5 pt-0.5">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar en el historial por herramienta u objeto..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-7 pr-2 py-1 text-[10.5px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 custom-scrollbar text-[9px]">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'retopo', label: '✨ Remeser' },
              { id: 'edit', label: '✂️ Malla' },
              { id: 'transform', label: '📐 Transform' },
              { id: 'create', label: '📦 Creación' },
              { id: 'material', label: '🎨 Materiales' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`px-2 py-0.5 rounded whitespace-nowrap font-medium transition-colors cursor-pointer ${
                  categoryFilter === tab.id
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                    : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeObj && (
            <label className="flex items-center gap-1.5 text-[9.5px] text-zinc-400 hover:text-zinc-200 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                checked={filterCurrentOnly}
                onChange={(e) => setFilterCurrentOnly(e.target.checked)}
                className="accent-amber-500 w-3 h-3 rounded"
              />
              <span>Filtrar solo pasos de <strong className="text-amber-200">{activeObj.name || activeObj.type}</strong></span>
            </label>
          )}
        </div>
      </div>

      {/* ── Steps Timeline List ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 custom-scrollbar overscroll-contain">
        {filteredSteps.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 text-xs space-y-1">
            <History size={28} className="mx-auto text-zinc-600 opacity-40 mb-2" />
            <p>No se encontraron acciones con ese filtro.</p>
            <p className="text-[10px] text-zinc-600">Cambia los términos de búsqueda o categoría.</p>
          </div>
        ) : (
          filteredSteps.map(({ step, index }) => {
            const isCurrent = index === historyIndex;
            const isPast = index < historyIndex;
            const isFuture = index > historyIndex;

            // Comparación de polígonos con el paso anterior en el historial
            const prevStep = index > 0 ? historySteps[index - 1] : null;
            const curFaces = step.faceCount ?? step.totalSceneFaces;
            const prevFaces = step.prevFaceCount ?? (prevStep ? (prevStep.faceCount ?? prevStep.totalSceneFaces) : undefined);
            const deltaFaces = (prevFaces !== undefined && curFaces !== undefined)
              ? (step.deltaFaces !== undefined ? step.deltaFaces : (curFaces - prevFaces))
              : undefined;

            return (
              <div
                key={step.id || index}
                onClick={() => jumpToHistory(index)}
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 cursor-pointer transition-all ${
                  isCurrent
                    ? 'bg-amber-950/40 border-amber-500/80 shadow-md ring-1 ring-amber-500/40 text-white'
                    : isPast
                    ? 'bg-zinc-900/60 hover:bg-zinc-850 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                    : 'bg-zinc-950/40 hover:bg-zinc-900/50 border-zinc-800/40 text-zinc-500 hover:text-zinc-300 opacity-60 hover:opacity-90'
                }`}
                title={`Clic para saltar directamente al paso #${index + 1}: ${step.label}`}
              >
                {/* Left: Step number and Icon */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[9px] font-bold shrink-0 border ${
                    isCurrent
                      ? 'bg-amber-500 text-black border-amber-400 font-extrabold shadow-sm'
                      : isPast
                      ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      : 'bg-zinc-900 text-zinc-600 border-zinc-800'
                  }`}>
                    {index + 1}
                  </div>

                  <div className="p-1 rounded-md bg-zinc-900 border border-zinc-800 shrink-0">
                    {getStepIcon(step)}
                  </div>

                  {/* Step Title & Object details */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-semibold truncate ${isCurrent ? 'text-amber-200 font-bold' : isPast ? 'text-zinc-200' : 'text-zinc-400'}`} title={step.label}>
                        {getDisplayStepLabel(step)}
                      </span>
                      {isCurrent && (
                        <span className="text-[8.5px] px-1.5 py-0.2 rounded-full bg-amber-500 text-black font-extrabold uppercase tracking-wider shrink-0 animate-pulse">
                          ACTUAL
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-zinc-400 font-mono pt-0.5">
                      {(() => {
                        const displayName = (step.objectName && !step.objectName.endsWith(' objetos'))
                          ? step.objectName
                          : (step.objectId ? project.objects.find(o => o.id === step.objectId)?.name : (project.objects.length === 1 ? project.objects[0]?.name : step.objectName));
                        return displayName ? (
                          <span className="truncate max-w-[105px] text-zinc-300 font-medium font-sans" title={displayName}>
                            {displayName}
                          </span>
                        ) : null;
                      })()}

                      {curFaces !== undefined && curFaces > 0 ? (
                        <span className="font-bold text-zinc-200 bg-zinc-850 px-1.5 py-0.2 rounded border border-zinc-700/60" title={`Geometría en este paso: ${curFaces.toLocaleString()} caras`}>
                          {curFaces.toLocaleString()} caras
                        </span>
                      ) : (
                        <span className="text-zinc-500 font-normal">0 caras</span>
                      )}

                      {/* Comparación paso a paso (Delta) */}
                      {prevFaces !== undefined && deltaFaces !== undefined && deltaFaces !== 0 && (
                        <span
                          className={`px-1.5 py-0.2 rounded text-[8px] font-bold flex items-center gap-0.5 border ${
                            deltaFaces < 0
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                          }`}
                          title={`Comparativa con paso #${index}: ${prevFaces.toLocaleString()} ➔ ${curFaces?.toLocaleString()} (${deltaFaces > 0 ? '+' : ''}${deltaFaces.toLocaleString()} caras)`}
                        >
                          <span>{deltaFaces < 0 ? '↓' : '↑'}</span>
                          <span>{deltaFaces < 0 ? `-${Math.abs(deltaFaces).toLocaleString()}` : `+${deltaFaces.toLocaleString()}`}</span>
                          {prevFaces > 0 && (
                            <span className="opacity-75 text-[7.5px]">
                              ({deltaFaces < 0 ? '-' : '+'}{Math.abs(Math.round((deltaFaces / prevFaces) * 100))}%)
                            </span>
                          )}
                        </span>
                      )}

                      {step.timestamp && (
                        <span className="text-zinc-500 ml-auto text-[8.5px]">{formatTime(step.timestamp)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Direct action badge and delete button */}
                <div className="shrink-0 flex items-center gap-1">
                  {isCurrent ? (
                    <span className="text-[9.5px] text-amber-400 font-bold px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-700/60">
                      Activo
                    </span>
                  ) : isPast ? (
                    <button
                      type="button"
                      className="px-2 py-0.5 text-[9.5px] font-semibold rounded bg-zinc-800 hover:bg-amber-600 hover:text-white text-zinc-400 transition-colors border border-zinc-700/60 cursor-pointer"
                      title="Volver directamente a este punto"
                    >
                      Volver
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="px-2 py-0.5 text-[9.5px] font-semibold rounded bg-zinc-900 hover:bg-amber-600 hover:text-white text-zinc-500 transition-colors border border-zinc-800 cursor-pointer"
                      title="Rehacer directamente hasta este punto"
                    >
                      Rehacer
                    </button>
                  )}
                  {historySteps && historySteps.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteHistoryStep(index);
                      }}
                      className="p-1 rounded bg-zinc-900 hover:bg-rose-900/60 text-zinc-500 hover:text-rose-300 border border-zinc-800 hover:border-rose-700/60 transition-colors cursor-pointer"
                      title={`Eliminar este paso (#${index + 1}: ${step.label}) del historial`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer Info ── */}
      <div className="p-2.5 border-t border-zinc-800 bg-zinc-900/60 text-[9px] text-zinc-400 flex items-center gap-2">
        <HelpCircle size={13} className="text-amber-400 shrink-0" />
        <span>Haz clic directo en cualquier paso para volver de golpe sin pasar uno por uno.</span>
      </div>
    </div>
  );
};
