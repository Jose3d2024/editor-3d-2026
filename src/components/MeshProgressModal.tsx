import React from 'react';
import { useStore } from '../store/useStore';
import { Layers, Loader2, Sparkles, Box, Cpu, CheckCircle2, TrendingDown } from 'lucide-react';
import { safeFixed } from '../utils/numberUtils';

export const MeshProgressModal: React.FC = () => {
  const meshProcessing = useStore(state => state.meshProcessing);
  const closeMeshProcessing = useStore(state => state.closeMeshProcessing);

  if (!meshProcessing || !meshProcessing.active) return null;

  const {
    title, subtitle, progress, objectName,
    vertCount, faceCount, completed, finalVertCount, finalFaceCount
  } = meshProcessing;

  const clampedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  // Percent reduction calculations
  let vertReductionStr = '';
  let faceReductionStr = '';
  if (completed && vertCount && finalVertCount !== undefined) {
    const vDiff = ((finalVertCount - vertCount) / vertCount) * 100;
    vertReductionStr = `${vDiff > 0 ? '+' : ''}${safeFixed(vDiff, 1)}%`;
  }
  if (completed && faceCount && finalFaceCount !== undefined) {
    const fDiff = ((finalFaceCount - faceCount) / faceCount) * 100;
    faceReductionStr = `${fDiff > 0 ? '+' : ''}${safeFixed(fDiff, 1)}%`;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-zinc-900/95 border border-zinc-700/80 rounded-2xl p-6 shadow-2xl text-white relative overflow-hidden"
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 35px rgba(16, 185, 129, 0.15)',
        }}
      >
        {/* Top decorative gradient line */}
        <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${completed ? 'from-emerald-500 via-teal-400 to-indigo-500' : 'from-teal-500 via-indigo-500 to-purple-500'} ${completed ? '' : 'animate-pulse'}`} />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl border relative ${completed ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'}`}>
              {completed ? (
                <CheckCircle2 size={24} className="text-emerald-400 animate-in zoom-in-75 duration-300" />
              ) : (
                <Loader2 size={22} className="animate-spin text-indigo-400" />
              )}
              {!completed && <Sparkles size={10} className="absolute -top-1 -right-1 text-teal-400 animate-ping" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-100 tracking-wide flex items-center gap-2">
                {title}
              </h3>
              {objectName && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Box size={11} className="text-zinc-400" />
                  <span className="text-[11px] font-semibold text-zinc-300 bg-zinc-800/90 px-2 py-0.5 rounded-md border border-zinc-700/60 truncate max-w-[220px]">
                    {objectName}
                  </span>
                </div>
              )}
            </div>
          </div>

          <span className={`text-lg font-extrabold font-mono px-3 py-1 rounded-lg border ${completed ? 'bg-emerald-950/80 text-emerald-400 border-emerald-700/50' : 'bg-indigo-950/50 text-indigo-400 border-indigo-800/40'}`}>
            {clampedProgress}%
          </span>
        </div>

        {/* Subtitle / Status text */}
        <p className="text-xs text-zinc-300 font-medium mb-3 min-h-[1.5rem] flex items-center gap-2">
          {completed ? (
            <Sparkles size={14} className="text-emerald-400 shrink-0" />
          ) : (
            <Cpu size={13} className="text-teal-400 animate-pulse shrink-0" />
          )}
          <span className="truncate">{subtitle || (completed ? '¡Proceso finalizado correctamente!' : 'Procesando algoritmo de geometría...')}</span>
        </p>

        {/* Progress bar container */}
        <div className="relative w-full h-3.5 bg-zinc-800/90 rounded-full overflow-hidden border border-zinc-700/60 p-0.5 shadow-inner mb-4">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out relative ${completed ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500' : 'bg-gradient-to-r from-teal-500 via-indigo-500 to-purple-500'}`}
            style={{ width: `${clampedProgress}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
          </div>
        </div>

        {/* Completion Summary Card */}
        {completed && (
          <div className="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                <Layers size={14} className="text-emerald-400" />
                Resumen de Optimización Poligonal
              </span>
              {faceReductionStr && (
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <TrendingDown size={10} />
                  {faceReductionStr} en polígonos
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Original Stats */}
              <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800/80">
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-1">Geometría Original</p>
                <p className="text-zinc-300 font-mono">Vértices: <strong className="text-white">{vertCount?.toLocaleString() ?? '-'}</strong></p>
                <p className="text-zinc-300 font-mono">Caras: <strong className="text-white">{faceCount?.toLocaleString() ?? '-'}</strong></p>
              </div>

              {/* Final Stats */}
              <div className="bg-emerald-950/30 p-2.5 rounded-lg border border-emerald-500/30">
                <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-1">Geometría Final</p>
                <p className="text-emerald-200 font-mono">Vértices: <strong className="text-white font-bold">{finalVertCount?.toLocaleString() ?? vertCount?.toLocaleString() ?? '-'}</strong></p>
                <p className="text-emerald-200 font-mono">Caras: <strong className="text-white font-bold">{finalFaceCount?.toLocaleString() ?? faceCount?.toLocaleString() ?? '-'}</strong></p>
              </div>
            </div>

            {vertReductionStr && (
              <div className="text-[10px] text-zinc-400 text-center font-mono">
                Variación total: <span className="text-emerald-400 font-bold">{vertReductionStr} vértices</span> | <span className="text-emerald-400 font-bold">{faceReductionStr} caras</span>
              </div>
            )}
          </div>
        )}

        {/* Ongoing Stats footer (while in progress) */}
        {!completed && (vertCount !== undefined || faceCount !== undefined) && (
          <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
            <div className="flex items-center gap-1.5">
              <Layers size={12} className="text-zinc-500" />
              <span>Geometría original:</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-zinc-300">
              {vertCount !== undefined && <span>Vértices: <strong className="text-white">{vertCount.toLocaleString()}</strong></span>}
              {faceCount !== undefined && <span>Caras: <strong className="text-white">{faceCount.toLocaleString()}</strong></span>}
            </div>
          </div>
        )}

        {/* Return to Editor Button (if completed) */}
        {completed ? (
          <button
            onClick={closeMeshProcessing}
            className="w-full mt-4 py-2.5 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2 border border-emerald-400/40 cursor-pointer active:scale-[0.98] transition-all"
          >
            <CheckCircle2 size={16} />
            Volver al Editor
          </button>
        ) : (
          <div className="mt-3 text-[10px] text-zinc-500 text-center font-medium">
            Optimizando topología poligonal de forma segura...
          </div>
        )}
      </div>
    </div>
  );
};
