import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Scissors, Combine, Target, Split, ArrowLeftRight, Check, AlertCircle, 
  X, Layers, Sparkles, ShieldCheck, Box, RefreshCw
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { UnifiedBooleanOp } from '../utils/booleanOperations';

interface BooleanStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTargetId?: string | null;
  initialToolId?: string | null;
}

export const BooleanStudioModal: React.FC<BooleanStudioModalProps> = ({
  isOpen,
  onClose,
  initialTargetId,
  initialToolId,
}) => {
  const { project, selectedObjectIds, executeExplicitBoolean } = useStore();

  const [targetId, setTargetId] = useState<string>('');
  const [toolId, setToolId] = useState<string>('');
  const [operation, setOperation] = useState<UnifiedBooleanOp>('DIFFERENCE_AB');
  const [keepTool, setKeepTool] = useState<boolean>(false);
  const [autoHeal, setAutoHeal] = useState<boolean>(true);
  const [recenterPivot, setRecenterPivot] = useState<boolean>(true);
  
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Inicializar selección al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setFeedback(null);
      const objects = project.objects;
      if (objects.length < 2) return;

      let tId = initialTargetId || '';
      let tlId = initialToolId || '';

      if (!tId && selectedObjectIds && selectedObjectIds.length >= 1) {
        tId = selectedObjectIds[0];
      }
      if (!tlId && selectedObjectIds && selectedObjectIds.length >= 2) {
        tlId = selectedObjectIds[1];
      }

      if (!tId && objects.length >= 1) tId = objects[0].id;
      if (!tlId && objects.length >= 2) {
        tlId = objects.find(o => o.id !== tId)?.id || objects[1].id;
      }
      if (tId === tlId && objects.length >= 2) {
        tlId = objects.find(o => o.id !== tId)?.id || objects[1].id;
      }

      setTargetId(tId);
      setToolId(tlId);
    }
  }, [isOpen, initialTargetId, initialToolId, selectedObjectIds, project.objects]);

  const targetObj = useMemo(() => project.objects.find(o => o.id === targetId), [project.objects, targetId]);
  const toolObj = useMemo(() => project.objects.find(o => o.id === toolId), [project.objects, toolId]);

  const handleSwap = () => {
    const temp = targetId;
    setTargetId(toolId);
    setToolId(temp);
    setFeedback(null);
  };

  const handleExecute = async () => {
    if (!targetId || !toolId || targetId === toolId) {
      setFeedback({
        type: 'error',
        message: 'Debes seleccionar dos objetos diferentes para la operación booleana.',
      });
      return;
    }

    setIsProcessing(true);
    setFeedback(null);

    try {
      const result = await executeExplicitBoolean({
        targetId,
        toolId,
        operation,
        keepTool,
        autoHeal,
        recenterPivot,
      });

      if (result.success) {
        setFeedback({
          type: 'success',
          message: `${result.message} (${result.stats?.resultVertices.toLocaleString()} vértices, ${result.stats?.resultFaces.toLocaleString()} caras).`,
        });
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setFeedback({
          type: 'error',
          message: result.message,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Ocurrió un error inesperado: ${err?.message || String(err)}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const getDynamicActionText = () => {
    const nameA = targetObj?.name || 'Objeto A';
    const nameB = toolObj?.name || 'Objeto B';
    switch (operation) {
      case 'DIFFERENCE_AB':
        return `Restar "${nameB}" de "${nameA}" (A − B)`;
      case 'DIFFERENCE_BA':
        return `Restar "${nameA}" de "${nameB}" (B − A)`;
      case 'UNION':
        return `Unir "${nameA}" y "${nameB}" (A + B)`;
      case 'INTERSECTION':
        return `Intersecar "${nameA}" y "${nameB}" (A ∩ B)`;
      case 'SPLIT':
        return `Dividir "${nameA}" usando "${nameB}" (A / B)`;
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 px-6 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600/20 border border-indigo-500/40 rounded-xl text-indigo-400">
                <Scissors size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                  Estudio de Operaciones Booleanas (CSG)
                </h2>
                <p className="text-xs text-zinc-400">
                  Combina, resta o divide volúmenes y geometrías 3D de forma clara y controlada.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Modal Content */}
          <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1">
            {/* Object Selectors: A (Target) and B (Tool) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={13} className="text-indigo-400" />
                  1. Selección de Objetos Participantes
                </span>
                <span className="text-[10px] text-zinc-500">
                  Elige qué objeto modifica y cuál es modificado
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] items-center gap-3 p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl">
                {/* Objeto A (Base) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-blue-950 border border-blue-500/50 flex items-center justify-center text-[9px] text-blue-300 font-mono font-black">A</span>
                      Objeto Base
                    </span>
                    <span className="text-[9px] text-zinc-400">(Receptor)</span>
                  </div>
                  <select
                    value={targetId}
                    onChange={(e) => {
                      setTargetId(e.target.value);
                      setFeedback(null);
                    }}
                    className="w-full bg-zinc-950 border border-blue-500/30 focus:border-blue-500 rounded-lg px-2.5 py-2 text-xs text-zinc-100 font-medium focus:outline-none transition-colors"
                  >
                    <option value="" disabled>Selecciona objeto...</option>
                    {project.objects.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name || `Objeto (${o.type})`} {o.id === toolId ? ' (Herramienta)' : ''}
                      </option>
                    ))}
                  </select>

                  {targetObj && (
                    <div className="flex items-center gap-2 p-1.5 bg-zinc-950/80 rounded-md border border-zinc-800 text-[10px]">
                      <div
                        className="w-3.5 h-3.5 rounded border border-white/20 shrink-0"
                        style={{ background: targetObj.color || '#ffffff' }}
                      />
                      <span className="truncate text-zinc-300 font-medium flex-1">{targetObj.name}</span>
                      <span className="text-zinc-500 font-mono">{targetObj.stats?.vertices ?? targetObj.vertices?.length ?? 0}v</span>
                    </div>
                  )}
                </div>

                {/* Swap Button */}
                <div className="flex flex-col items-center justify-center pt-2 md:pt-4">
                  <button
                    onClick={handleSwap}
                    className="p-2.5 rounded-xl bg-zinc-800 hover:bg-indigo-600 border border-zinc-700 text-zinc-300 hover:text-white transition-all shadow-md active:scale-95 group"
                    title="Intercambiar Objeto Base (A) y Objeto Cortador (B)"
                  >
                    <ArrowLeftRight size={16} className="group-hover:rotate-180 transition-transform duration-300" />
                  </button>
                  <span className="text-[8px] text-zinc-500 mt-1 uppercase font-bold tracking-tighter">Swap</span>
                </div>

                {/* Objeto B (Tool / Cortador) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wide flex items-center gap-1">
                      <span className="w-4 h-4 rounded-full bg-rose-950 border border-rose-500/50 flex items-center justify-center text-[9px] text-rose-300 font-mono font-black">B</span>
                      Objeto Cortador / Herramienta
                    </span>
                    <span className="text-[9px] text-zinc-400">(Modificador)</span>
                  </div>
                  <select
                    value={toolId}
                    onChange={(e) => {
                      setToolId(e.target.value);
                      setFeedback(null);
                    }}
                    className="w-full bg-zinc-950 border border-rose-500/30 focus:border-rose-500 rounded-lg px-2.5 py-2 text-xs text-zinc-100 font-medium focus:outline-none transition-colors"
                  >
                    <option value="" disabled>Selecciona objeto...</option>
                    {project.objects.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name || `Objeto (${o.type})`} {o.id === targetId ? ' (Base)' : ''}
                      </option>
                    ))}
                  </select>

                  {toolObj && (
                    <div className="flex items-center gap-2 p-1.5 bg-zinc-950/80 rounded-md border border-zinc-800 text-[10px]">
                      <div
                        className="w-3.5 h-3.5 rounded border border-white/20 shrink-0"
                        style={{ background: toolObj.color || '#ffffff' }}
                      />
                      <span className="truncate text-zinc-300 font-medium flex-1">{toolObj.name}</span>
                      <span className="text-zinc-500 font-mono">{toolObj.stats?.vertices ?? toolObj.vertices?.length ?? 0}v</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Operation Mode Selector */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={13} className="text-indigo-400" />
                2. Tipo de Operación Booleana
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {/* 1. Resta A - B */}
                <button
                  type="button"
                  onClick={() => setOperation('DIFFERENCE_AB')}
                  className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                    operation === 'DIFFERENCE_AB'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
                        <Scissors size={15} />
                      </div>
                      <span className="text-xs font-bold">Resta / Diferencia</span>
                    </div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40 font-bold text-rose-300">
                      A − B
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Sustrae el volumen de <strong className="text-rose-300">[B]</strong> del objeto <strong className="text-blue-300">[A]</strong>. Abre un hueco o corta con la forma de B.
                  </p>
                  {operation === 'DIFFERENCE_AB' && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </button>

                {/* 2. Resta Invertida B - A */}
                <button
                  type="button"
                  onClick={() => setOperation('DIFFERENCE_BA')}
                  className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                    operation === 'DIFFERENCE_BA'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                        <Scissors size={15} className="rotate-180" />
                      </div>
                      <span className="text-xs font-bold">Resta Invertida</span>
                    </div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40 font-bold text-amber-300">
                      B − A
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Sustrae el volumen de <strong className="text-blue-300">[A]</strong> de la pieza <strong className="text-rose-300">[B]</strong> con un solo clic.
                  </p>
                  {operation === 'DIFFERENCE_BA' && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </button>

                {/* 3. Unión A + B */}
                <button
                  type="button"
                  onClick={() => setOperation('UNION')}
                  className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                    operation === 'UNION'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                        <Combine size={15} />
                      </div>
                      <span className="text-xs font-bold">Unión Sólida</span>
                    </div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40 font-bold text-emerald-300">
                      A + B
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Fusiona <strong className="text-blue-300">[A]</strong> y <strong className="text-rose-300">[B]</strong> en un único cuerpo volumétrico continuo sin caras internas.
                  </p>
                  {operation === 'UNION' && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </button>

                {/* 4. Intersección A ∩ B */}
                <button
                  type="button"
                  onClick={() => setOperation('INTERSECTION')}
                  className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
                    operation === 'INTERSECTION'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400">
                        <Target size={15} />
                      </div>
                      <span className="text-xs font-bold">Intersección</span>
                    </div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40 font-bold text-sky-300">
                      A ∩ B
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Conserva únicamente el volumen compartido donde <strong className="text-blue-300">[A]</strong> y <strong className="text-rose-300">[B]</strong> se solapan.
                  </p>
                  {operation === 'INTERSECTION' && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </button>

                {/* 5. Dividir A con B (Split) */}
                <button
                  type="button"
                  onClick={() => setOperation('SPLIT')}
                  className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between md:col-span-2 ${
                    operation === 'SPLIT'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-lg shadow-indigo-950/50'
                      : 'bg-zinc-900/40 border-zinc-800 text-zinc-300 hover:bg-zinc-900/80 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
                        <Split size={15} />
                      </div>
                      <span className="text-xs font-bold">Dividir / Cortar en 2 Piezas</span>
                    </div>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-black/40 font-bold text-purple-300">
                      A / B (Split)
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">
                    Corta <strong className="text-blue-300">[A]</strong> usando <strong className="text-rose-300">[B]</strong> como cuchilla y genera dos piezas independientes en la escena sin perder material.
                  </p>
                  {operation === 'SPLIT' && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Advanced Options */}
            <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-indigo-400" />
                3. Opciones de Ejecución
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label className="flex items-start gap-2.5 p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl cursor-pointer hover:bg-zinc-900 transition-colors">
                  <input
                    type="checkbox"
                    checked={keepTool}
                    onChange={(e) => setKeepTool(e.target.checked)}
                    className="mt-0.5 accent-indigo-600 rounded w-4 h-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Conservar objeto herramienta [B]</p>
                    <p className="text-[10px] text-zinc-500">Mantiene una copia del objeto B en la escena tras el corte.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl cursor-pointer hover:bg-zinc-900 transition-colors">
                  <input
                    type="checkbox"
                    checked={autoHeal}
                    onChange={(e) => setAutoHeal(e.target.checked)}
                    className="mt-0.5 accent-indigo-600 rounded w-4 h-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Auto-Curar (Manifold 3D)</p>
                    <p className="text-[10px] text-zinc-500">Garantiza una malla 100% estanca, cerrada y lista para impresión 3D.</p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl cursor-pointer hover:bg-zinc-900 transition-colors md:col-span-2">
                  <input
                    type="checkbox"
                    checked={recenterPivot}
                    onChange={(e) => setRecenterPivot(e.target.checked)}
                    className="mt-0.5 accent-indigo-600 rounded w-4 h-4"
                  />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Centrar pivote y origen al nuevo centro geométrico</p>
                    <p className="text-[10px] text-zinc-500">Recalcula el origen para que los gizmos de transformación queden perfectamente en el centro de la nueva pieza.</p>
                  </div>
                </label>
              </div>
            </div>

            {/* Diagnostic / Feedback */}
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                  feedback.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-200'
                    : 'bg-rose-950/80 border-rose-500/50 text-rose-200'
                }`}
              >
                {feedback.type === 'success' ? (
                  <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                )}
                <span>{feedback.message}</span>
              </motion.div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 px-6 border-t border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleExecute}
              disabled={isProcessing || !targetId || !toolId || targetId === toolId}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all shadow-lg cursor-pointer ${
                isProcessing || !targetId || !toolId || targetId === toolId
                  ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30 active:scale-98'
              }`}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Calculando Booleana...
                </>
              ) : (
                <>
                  <Scissors size={14} />
                  {getDynamicActionText()}
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
