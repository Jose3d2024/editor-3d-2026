import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import {
  LayoutGrid,
  Zap,
  CheckCircle2,
  Undo2,
  X,
  Compass,
  Layers,
  Sparkles,
  Eye,
  Sliders,
  HelpCircle,
  Hash,
  Shapes,
  Palette,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const RetopoSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, icon, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-900/60 overflow-hidden shadow-xs">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-zinc-900/90 hover:bg-zinc-800/80 transition-colors text-left cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[11px] font-bold text-zinc-200">{title}</span>
        </div>
        <div className="text-zinc-500">
          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>
      {isOpen && <div className="p-2.5 border-t border-zinc-800/60">{children}</div>}
    </div>
  );
};

export const RetopologyPanel: React.FC = () => {
  const {
    drawMode,
    setDrawMode,
    orthoDrawMode,
    setOrthoDrawMode,
    drawLockAxis,
    setDrawLockAxis,
    viewMode,
    setViewMode,
    project,
    selectedObjectId,
    retopologizeObject,
    updateObject,
    saveHistory,
  } = useStore();

  const [autoRatio, setAutoRatio] = useState<number>(0.25);
  const [preserveCreases, setPreserveCreases] = useState<boolean>(true);
  const [isProcessingAuto, setIsProcessingAuto] = useState<boolean>(false);

  // Buscar la malla de retopología activa o creada recientemente
  const retopoMesh = project.objects.find(
    o => o.isRetopoMesh || (o.name && o.name.toLowerCase().includes('retopo')) || (selectedObjectId && o.id === selectedObjectId)
  );

  // Buscar el objeto de referencia (el objeto seleccionado que no sea de retopo, o el primer objeto no retopo)
  const referenceObj = project.objects.find(
    o => o.id === selectedObjectId && !o.isRetopoMesh && !o.name?.toLowerCase().includes('retopo')
  ) || project.objects.find(o => !o.isRetopoMesh && !o.name?.toLowerCase().includes('retopo'));

  const handleFinishFace = () => {
    window.dispatchEvent(new CustomEvent('csg-finish-drawing-stroke', { detail: { close: true } }));
  };

  const handleCancelPoly = () => {
    window.dispatchEvent(new CustomEvent('csg-cancel-drawing-stroke'));
  };

  const handleRemoveLastPoint = () => {
    // Simular pulsación de Backspace en la ventana para deshacer el último vértice colocado
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  };

  const handleExitRetopo = () => {
    window.dispatchEvent(new CustomEvent('csg-cancel-drawing-stroke'));
    setDrawMode(null);
  };

  const handleRunAutoRetopo = async () => {
    const targetId = referenceObj?.id || selectedObjectId;
    if (!targetId) return;
    setIsProcessingAuto(true);
    try {
      await retopologizeObject(targetId, {
        mode: 'QUAD_DOMINANT',
        targetRatio: autoRatio,
        adaptiveCurvature: true,
        preserveCreases: preserveCreases,
        hardSurfaceProtection: true,
      });
    } catch (e) {
      console.error('Error en Auto-Retopo:', e);
    } finally {
      setIsProcessingAuto(false);
    }
  };

  // Calcular estadísticas de la malla de retopología
  const vertCount = retopoMesh?.vertices?.length || retopoMesh?.stats?.vertices || 0;
  const faceCount = retopoMesh?.faces?.length || retopoMesh?.stats?.faces || 0;
  const quadsCount = retopoMesh?.faces?.filter(f => f.indices && f.indices.length === 4).length || retopoMesh?.stats?.quads || 0;
  const triCount = retopoMesh?.faces?.filter(f => f.indices && f.indices.length === 3).length || retopoMesh?.stats?.triangles || (faceCount - quadsCount);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-white overflow-hidden select-none">
      {/* ── Encabezado Principal del Modo Retopología ── */}
      <div className="p-3 border-b border-zinc-800 bg-gradient-to-r from-cyan-950/40 via-zinc-900 to-zinc-950 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
            <LayoutGrid size={16} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-cyan-200">Retopología Manual</span>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            </div>
            <p className="text-[9px] text-zinc-400">Panel de control y visualización</p>
          </div>
        </div>

        <button
          onClick={handleExitRetopo}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-rose-900/40 text-zinc-300 hover:text-rose-300 border border-zinc-700 hover:border-rose-500/50 text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-xs"
          title="Salir del modo retopología (Esc)"
        >
          <X size={12} />
          <span>Salir</span>
        </button>
      </div>

      {/* ── Contenido con Scroll ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        
        {/* 1. SECCIÓN DE VISUALIZACIÓN ESPECIAL */}
        <RetopoSection title="Visualización del Visor" icon={<Eye size={13} className="text-cyan-400" />} defaultOpen={true}>
          <div className="space-y-2">
            <button
              onClick={() => setViewMode(viewMode === 'RETOPO_OVERLAY' ? 'SOLID' : 'RETOPO_OVERLAY')}
              className={`w-full py-2 px-3 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm ${
                viewMode === 'RETOPO_OVERLAY'
                  ? 'bg-cyan-600 border-cyan-400 text-white shadow-cyan-500/20'
                  : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-white'
              }`}
              title="Muestra el modelo original en malla alámbrica translúcida y la nueva retopología en sólido opaco"
            >
              <Layers size={14} className={viewMode === 'RETOPO_OVERLAY' ? 'text-white' : 'text-cyan-400'} />
              <span>{viewMode === 'RETOPO_OVERLAY' ? '✓ Vista Especial Activa' : 'Activar Ref Malla / Retopo Sólido'}</span>
            </button>

            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => setViewMode('SOLID')}
                className={`py-1 px-2 rounded text-[10px] font-medium border transition-colors ${
                  viewMode === 'SOLID' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Sólido
              </button>
              <button
                onClick={() => setViewMode('TEXTURED')}
                className={`py-1 px-2 rounded text-[10px] font-medium border transition-colors ${
                  viewMode === 'TEXTURED' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Texturas
              </button>
              <button
                onClick={() => setViewMode('BLUEPRINT')}
                className={`py-1 px-2 rounded text-[10px] font-medium border transition-colors ${
                  viewMode === 'BLUEPRINT' ? 'bg-cyan-700 border-cyan-500 text-white' : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Blueprint
              </button>
            </div>
          </div>
        </RetopoSection>

        {/* 2. ACCIONES DE DIBUJO Y CONSTRUCCIÓN */}
        <RetopoSection title="Acciones de Dibujo" icon={<Shapes size={13} className="text-emerald-400" />} defaultOpen={true}>
          <div className="space-y-2">
            <button
              onClick={handleFinishFace}
              className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-98"
              title="Cierra el polígono actual y lo convierte en cara poligonal (Enter o Doble Clic)"
            >
              <CheckCircle2 size={14} />
              <span>Cerrar Cara / Quad (Enter)</span>
            </button>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={handleRemoveLastPoint}
                className="py-1.5 px-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white rounded-md text-[10.5px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                title="Deshacer el último punto creado del polígono actual (Backspace)"
              >
                <Undo2 size={12} />
                <span>Borrar Punto</span>
              </button>

              <button
                onClick={handleCancelPoly}
                className="py-1.5 px-2 bg-zinc-900 hover:bg-rose-950/40 border border-zinc-700 hover:border-rose-500/40 text-zinc-400 hover:text-rose-300 rounded-md text-[10.5px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                title="Descarta los puntos del polígono actual para empezar uno nuevo (Esc o Doble Clic Derecho)"
              >
                <X size={12} />
                <span>Descartar</span>
              </button>
            </div>
          </div>
        </RetopoSection>

        {/* 3. GUÍAS Y PRECISIÓN ANGULAR */}
        <RetopoSection title="Precisión y Ejes" icon={<Compass size={13} className="text-amber-400" />} defaultOpen={true}>
          <div className="space-y-2.5">
            {/* Modo Escuadra 90° */}
            <div className="flex items-center justify-between bg-zinc-900/80 p-2 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-2">
                <Compass size={14} className={orthoDrawMode ? 'text-amber-400 rotate-45 transition-transform' : 'text-zinc-400'} />
                <div>
                  <span className="text-[11px] font-semibold text-zinc-200 block">Escuadra 90°</span>
                  <span className="text-[9px] text-zinc-500 block">Ángulos rectos perpendiculares (Q)</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrthoDrawMode(!orthoDrawMode)}
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                  orthoDrawMode ? 'bg-amber-500' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`block w-3.5 h-3.5 bg-white rounded-full transition-transform absolute top-0.5 ${
                    orthoDrawMode ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Restricción de Eje */}
            <div>
              <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider block mb-1">Restricción de Eje</span>
              <div className="grid grid-cols-5 gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                {(['FREE', 'ORTHO_90', 'X', 'Y', 'Z'] as const).map(axis => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() => setDrawLockAxis(axis)}
                    className={`py-1 text-[10px] font-bold rounded transition-all cursor-pointer ${
                      drawLockAxis === axis
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                    }`}
                  >
                    {axis === 'FREE' ? 'Libre' : axis === 'ORTHO_90' ? '90°' : axis}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </RetopoSection>

        {/* 4. REMALLADO INTELIGENTE (AUTO-RETOPO) */}
        <RetopoSection title="Auto-Retopología Rápida" icon={<Zap size={13} className="text-amber-400" />} defaultOpen={false}>
          <div className="space-y-2.5">
            <p className="text-[9.5px] text-zinc-400 leading-relaxed">
              Genera una retopología automática adaptativa preservando aristas vivas y silueta:
            </p>

            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-zinc-400">Reducción de polígonos:</span>
                <span className="text-cyan-300 font-bold font-mono">-{Math.round((1 - autoRatio) * 100)}% ({Math.round(autoRatio * 100)}% caras)</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.90}
                step={0.05}
                value={autoRatio}
                onChange={(e) => setAutoRatio(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-[10px] text-zinc-300">
              <input
                type="checkbox"
                checked={preserveCreases}
                onChange={(e) => setPreserveCreases(e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
              />
              <span>Proteger pliegues y aristas duras</span>
            </label>

            <button
              disabled={isProcessingAuto || !referenceObj}
              onClick={handleRunAutoRetopo}
              className="w-full py-2 px-3 bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
            >
              <Sparkles size={13} className={isProcessingAuto ? 'animate-spin' : ''} />
              <span>{isProcessingAuto ? 'Calculando retopología...' : '⚡ Ejecutar Auto-Retopo'}</span>
            </button>
          </div>
        </RetopoSection>

        {/* 5. ESTADÍSTICAS DE LA MALLA RESULTANTE */}
        {retopoMesh && (
          <RetopoSection title="Malla de Retopología" icon={<Hash size={13} className="text-cyan-400" />} defaultOpen={true}>
            <div className="space-y-2">
              <div className="text-[10px] font-medium text-cyan-300 truncate bg-cyan-950/40 px-2 py-1 rounded border border-cyan-500/20">
                {retopoMesh.name}
              </div>

              <div className="grid grid-cols-3 gap-1">
                <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800 text-center">
                  <p className="text-[8.5px] text-zinc-400 uppercase">Quads</p>
                  <p className="text-xs font-bold font-mono text-cyan-300">{quadsCount.toLocaleString()}</p>
                </div>
                <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800 text-center">
                  <p className="text-[8.5px] text-zinc-400 uppercase">Tris</p>
                  <p className="text-xs font-bold font-mono text-zinc-300">{triCount.toLocaleString()}</p>
                </div>
                <div className="bg-zinc-900 p-1.5 rounded border border-zinc-800 text-center">
                  <p className="text-[8.5px] text-zinc-400 uppercase">Vértices</p>
                  <p className="text-xs font-bold font-mono text-white">{vertCount.toLocaleString()}</p>
                </div>
              </div>

              {/* Apariencia de la Retopología */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-zinc-400">Color de cara:</span>
                <input
                  type="color"
                  value={retopoMesh.color || '#06b6d4'}
                  onChange={(e) => {
                    updateObject(retopoMesh.id, { color: e.target.value });
                    saveHistory('Cambiar color retopología');
                  }}
                  className="w-6 h-6 rounded border border-zinc-700 cursor-pointer bg-transparent"
                  title="Cambiar color del sólido de retopología"
                />
              </div>
            </div>
          </RetopoSection>
        )}

        {/* 6. GUÍA DE ATAJOS RÁPIDOS */}
        <RetopoSection title="Atajos y Controles" icon={<HelpCircle size={13} className="text-zinc-400" />} defaultOpen={false}>
          <div className="space-y-1.5 text-[9.5px] text-zinc-300 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Clic Izquierdo:</span>
              <span className="font-semibold text-cyan-300">Crear vértice</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Clic en arista existente:</span>
              <span className="font-semibold text-emerald-300">Extender quad adyacente</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Enter / Doble Clic:</span>
              <span className="font-semibold text-emerald-300">Cerrar y crear cara</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Backspace:</span>
              <span className="font-semibold text-amber-300">Borrar último punto</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Esc (1º pulsación):</span>
              <span className="font-semibold text-rose-300">Descartar polígono actual</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-zinc-800/80">
              <span className="text-zinc-400">Esc (2º pulsación):</span>
              <span className="font-semibold text-rose-400">Salir de la herramienta</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-zinc-400">Alt + Arrastrar / Central:</span>
              <span className="font-semibold text-zinc-200">Orbitar vista 3D</span>
            </div>
          </div>
        </RetopoSection>

      </div>
    </div>
  );
};
