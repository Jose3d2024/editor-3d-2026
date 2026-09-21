import React, { useState } from 'react';
import {
  Keyboard, Sliders, Move, RotateCw, Box, Compass, Sparkles,
  Layers, Search, ExternalLink, HelpCircle, RefreshCw, Eye,
  Monitor, Zap, Check, ChevronDown, ChevronRight, Pin
} from 'lucide-react';
import { SHORTCUTS_DATA, CATEGORIES, ShortcutItem } from './KeyboardShortcutsModal';
import { useStore } from '../store/useStore';
import { extractUniqueEdges } from '../utils/wireframeMesh';
import { safeFixed } from '../utils/numberUtils';

interface ConfigPanelProps {
  onOpenShortcutsModal: (isFloating?: boolean) => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onOpenShortcutsModal }) => {
  const project = useStore(state => state.project);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [isShortcutsSectionOpen, setIsShortcutsSectionOpen] = useState(true);
  const [isViewportPrefsOpen, setIsViewportPrefsOpen] = useState(true);
  const [isPrecisionOpen, setIsPrecisionOpen] = useState(false);
  const [isTexturePrefsOpen, setIsTexturePrefsOpen] = useState(true);
  const [isSceneStatsOpen, setIsSceneStatsOpen] = useState(false);

  // Local preferences state (persisted in localStorage or session)
  const [gridSnap, setGridSnap] = useState<number>(0.1);
  const [angleSnap, setAngleSnap] = useState<number>(15);
  const [orbitSpeed, setOrbitSpeed] = useState<number>(1.0);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [highPerformanceMode, setHighPerformanceMode] = useState<boolean>(false);

  // Estados locales para Proyección & Texturas PBR
  const [triplanarScale, setTriplanarScale] = useState<number>(1.0);
  const [triplanarBlend, setTriplanarBlend] = useState<number>(0.5);
  const [mirrorOpposite, setMirrorOpposite] = useState<boolean>(false);

  const selectedObjectId = useStore(state => state.selectedObjectId);
  const updateMaterial = useStore(state => state.updateMaterial);

  // Helper para sincronizar cambios con el material del objeto seleccionado si existe
  const handleMaterialParamChange = (key: string, value: any) => {
    if (selectedObjectId) {
      const obj = project.objects.find(o => o.id === selectedObjectId);
      if (obj?.materialId) {
        updateMaterial(obj.materialId, { [key]: value });
      }
    }
  };

  // Filtered shortcuts for in-panel quick browsing
  const filteredShortcuts = SHORTCUTS_DATA.filter(item => {
    const matchesCat = activeCategory === 'all' || item.category === activeCategory;
    if (!matchesCat) return false;
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase().trim();
    return (
      item.description.toLowerCase().includes(q) ||
      item.keys.some(k => k.toLowerCase().includes(q)) ||
      (item.detail?.toLowerCase().includes(q) ?? false)
    );
  });

  // Calculate project metrics
  const totalObjects = project.objects.length;
  const totalVertices = project.objects.reduce((acc, o) => acc + (o.stats?.vertices || o.vertices?.length || 0), 0);
  const totalEdges = project.objects.reduce((acc, o) => acc + extractUniqueEdges(o).length, 0);
  const totalFaces = project.objects.reduce((acc, o) => acc + (o.stats?.faces || o.faces?.length || 0), 0);
  const totalMaterials = project.materials.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 text-zinc-100 select-none">
      {/* Configuration Header */}
      <div className="p-3 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <Sliders size={14} />
          </div>
          <div>
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">Configuración</h2>
            <p className="text-[9px] text-zinc-400">Atajos, preferencias y ajustes del entorno</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">

        {/* ─── SECTION 1: ATAJOS DE TECLADO (HERO ACCENT) ─── */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-b from-indigo-950/40 to-zinc-900/80 border border-indigo-500/30 space-y-3 shadow-lg shadow-indigo-950/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/40">
                <Keyboard size={15} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white">Atajos de Teclado</h3>
                <p className="text-[9px] text-indigo-300">Navegación, herramientas y modelado</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[8px] font-bold uppercase tracking-wider border border-indigo-500/30">
              {SHORTCUTS_DATA.length} Atajos
            </span>
          </div>

          <p className="text-[10px] text-zinc-300 leading-relaxed">
            Aumenta tu velocidad de trabajo con los comandos rápidos del editor 3D. Abre la guía interactiva o busca atajos a continuación.
          </p>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => onOpenShortcutsModal(false)}
              className="py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10.5px] font-bold transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center gap-1.5 active:scale-95"
            >
              <ExternalLink size={12} />
              <span>Abrir Modal</span>
            </button>
            <button
              onClick={() => onOpenShortcutsModal(true)}
              className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-[10.5px] font-bold transition-all border border-zinc-700/80 flex items-center justify-center gap-1.5 active:scale-95"
            >
              <Pin size={12} className="text-indigo-400" />
              <span>Panel Flotante</span>
            </button>
          </div>

          {/* In-Panel Quick Shortcuts Accordion / Viewer */}
          <div className="pt-2 border-t border-indigo-500/20">
            <button
              onClick={() => setIsShortcutsSectionOpen(!isShortcutsSectionOpen)}
              className="w-full flex items-center justify-between text-[10px] font-bold text-indigo-300 hover:text-white py-1 transition-colors"
            >
              <span>Explorar atajos aquí</span>
              {isShortcutsSectionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>

            {isShortcutsSectionOpen && (
              <div className="mt-2 space-y-2">
                {/* Search */}
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Filtrar atajos (ej. W, cara, tab)..."
                    value={searchFilter}
                    onChange={e => setSearchFilter(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 bg-zinc-900/90 border border-zinc-800 rounded-lg text-[10px] text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Categories */}
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                  {CATEGORIES.slice(0, 4).map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveCategory(c.id)}
                      className={`px-2 py-0.5 rounded text-[8.5px] font-bold whitespace-nowrap transition-colors ${
                        activeCategory === c.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {c.label.split(' ')[0]}
                    </button>
                  ))}
                </div>

                {/* Compact List */}
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {filteredShortcuts.map(item => (
                    <div
                      key={item.id}
                      className="p-1.5 rounded-lg bg-zinc-900/70 border border-zinc-800/60 flex items-center justify-between text-[10px]"
                    >
                      <span className="text-zinc-200 font-medium truncate pr-2">
                        {item.description}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.slice(0, 2).map((k, i) => (
                          <kbd
                            key={i}
                            className="px-1.5 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[9px] font-mono font-bold border border-zinc-700"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── SECTION 2: PREFERENCIAS DEL VIEWPORT & NAVEGACIÓN ─── */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
          <button
            onClick={() => setIsViewportPrefsOpen(!isViewportPrefsOpen)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Compass size={14} className="text-cyan-400" />
              <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Navegación & Viewport
              </span>
            </div>
            {isViewportPrefsOpen ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {isViewportPrefsOpen && (
            <div className="space-y-3 pt-1 text-xs">
              {/* Sensibilidad de Órbita */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Sensibilidad de Órbita</span>
                  <span className="text-zinc-200 font-mono font-bold">{safeFixed(orbitSpeed, 1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={orbitSpeed}
                  onChange={e => setOrbitSpeed(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 cursor-pointer">
                  <span className="text-[10px] text-zinc-300 font-medium">Mostrar Cuadrícula (Grid)</span>
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={e => setShowGrid(e.target.checked)}
                    className="accent-indigo-500 w-3.5 h-3.5 rounded"
                  />
                </label>

                <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 cursor-pointer">
                  <span className="text-[10px] text-zinc-300 font-medium">Mostrar Ejes de Coordenadas (XYZ)</span>
                  <input
                    type="checkbox"
                    checked={showAxes}
                    onChange={e => setShowAxes(e.target.checked)}
                    className="accent-indigo-500 w-3.5 h-3.5 rounded"
                  />
                </label>

                <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 cursor-pointer">
                  <div className="flex items-center gap-1.5">
                    <Zap size={12} className="text-amber-400" />
                    <span className="text-[10px] text-zinc-300 font-medium">Modo Rendimiento Máximo</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={highPerformanceMode}
                    onChange={e => setHighPerformanceMode(e.target.checked)}
                    className="accent-amber-500 w-3.5 h-3.5 rounded"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ─── SECTION 3: SNAPPING & PRECISIÓN ─── */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
          <button
            onClick={() => setIsPrecisionOpen(!isPrecisionOpen)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Move size={14} className="text-emerald-400" />
              <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Snapping & Precisión
              </span>
            </div>
            {isPrecisionOpen ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {isPrecisionOpen && (
            <div className="space-y-3 pt-1 text-xs">
              {/* Grid Snap Increment */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Paso de Traslación (Grid)</span>
                <select
                  value={gridSnap}
                  onChange={e => setGridSnap(parseFloat(e.target.value))}
                  className="bg-zinc-900 border border-zinc-700 text-[10px] text-white rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500"
                >
                  <option value={0.01}>0.01 (Fino)</option>
                  <option value={0.05}>0.05</option>
                  <option value={0.1}>0.10 (Estándar)</option>
                  <option value={0.5}>0.50</option>
                  <option value={1.0}>1.00 (Grande)</option>
                </select>
              </div>

              {/* Angular Snap Increment */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Paso de Rotación (Ángulo)</span>
                <select
                  value={angleSnap}
                  onChange={e => setAngleSnap(parseInt(e.target.value, 10))}
                  className="bg-zinc-900 border border-zinc-700 text-[10px] text-white rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500"
                >
                  <option value={5}>5° (Preciso)</option>
                  <option value={15}>15° (Recomendado)</option>
                  <option value={30}>30°</option>
                  <option value={45}>45°</option>
                  <option value={90}>90° (Ortogonal)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* ─── SECTION 4: AJUSTES DE PROYECCIÓN & PBR ─── */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
          <button
            onClick={() => setIsTexturePrefsOpen(!isTexturePrefsOpen)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-400" />
              <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Proyección & Texturas PBR
              </span>
            </div>
            {isTexturePrefsOpen ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {isTexturePrefsOpen && (
            <div className="space-y-3 pt-1 text-xs">
              {/* Deslizador de Escala / Tiling Triplanar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Escala de Textura (Tiling)</span>
                  <span className="text-zinc-200 font-mono font-bold">{triplanarScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.05"
                  value={triplanarScale}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setTriplanarScale(val);
                    handleMaterialParamChange('triplanarScale', val);
                    handleMaterialParamChange('mapRepeat', [val, val]);
                  }}
                  className="w-full accent-indigo-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
                />
              </div>

              {/* Deslizador de Suavizado de Bordes (Blend) */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Suavizado de Bordes (Blend)</span>
                  <span className="text-zinc-200 font-mono font-bold">{(triplanarBlend * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.02"
                  value={triplanarBlend}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    setTriplanarBlend(val);
                    handleMaterialParamChange('triplanarBlend', val);
                  }}
                  className="w-full accent-indigo-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
                />
              </div>

              {/* Conmutador de Simetría Espejo para Caras Opuestas */}
              <div className="pt-1">
                <label className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition-colors">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-300 font-medium">Simetría en Caras Opuestas</span>
                    <span className="text-[8px] text-zinc-500">Refleja la proyección en normales invertidas</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={mirrorOpposite}
                    onChange={e => {
                      const val = e.target.checked;
                      setMirrorOpposite(val);
                      handleMaterialParamChange('texMirrorOpposite', val);
                    }}
                    className="accent-indigo-500 w-3.5 h-3.5 rounded"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* ─── SECTION 5: MÉTRICAS DEL PROYECTO ─── */}
        <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-3">
          <button
            onClick={() => setIsSceneStatsOpen(!isSceneStatsOpen)}
            className="w-full flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-violet-400" />
              <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Métricas del Escenario
              </span>
            </div>
            {isSceneStatsOpen ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {isSceneStatsOpen && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-2 bg-zinc-900/80 rounded-xl border border-zinc-800 text-center">
                <span className="text-[9px] text-zinc-400 uppercase font-bold block">Objetos</span>
                <span className="text-sm font-bold text-indigo-300 font-mono">{totalObjects}</span>
              </div>
              <div className="p-2 bg-zinc-900/80 rounded-xl border border-zinc-800 text-center">
                <span className="text-[9px] text-zinc-400 uppercase font-bold block">Materiales</span>
                <span className="text-sm font-bold text-indigo-300 font-mono">{totalMaterials}</span>
              </div>
              <div className="p-2 bg-zinc-900/80 rounded-xl border border-zinc-800 text-center">
                <span className="text-[9px] text-zinc-400 uppercase font-bold block">Vértices Totales</span>
                <span className="text-sm font-bold text-white font-mono">{totalVertices.toLocaleString()}</span>
              </div>
              <div className="p-2 bg-zinc-900/80 rounded-xl border border-zinc-800 text-center">
                <span className="text-[9px] text-zinc-400 uppercase font-bold block">Aristas Totales</span>
                <span className="text-sm font-bold text-cyan-400 font-mono">{totalEdges.toLocaleString()}</span>
              </div>
              <div className="p-2 bg-zinc-900/80 rounded-xl border border-zinc-800 text-center col-span-2">
                <span className="text-[9px] text-zinc-400 uppercase font-bold block">Caras Poligonales</span>
                <span className="text-sm font-bold text-amber-400 font-mono">{totalFaces.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* ─── ABOUT & QUICK HELP FOOTER ─── */}
        <div className="p-3 bg-zinc-900/20 rounded-xl border border-zinc-800/60 text-center space-y-1">
          <p className="text-[10px] font-bold text-zinc-400">3D CAD CSG Studio</p>
          <p className="text-[8.5px] text-zinc-500">
            Modelado booleano CSG, NURBS, PBR Shaders y Exportación GLTF/OBJ
          </p>
          <div className="pt-1 flex items-center justify-center gap-2">
            <button
              onClick={() => onOpenShortcutsModal(false)}
              className="text-[9.5px] text-indigo-400 hover:text-indigo-300 font-bold underline cursor-pointer"
            >
              Ver todos los atajos (F1 / ?)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
