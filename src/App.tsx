import React, { useState, useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { MultiViewport } from './components/MultiViewport';
import { MaterialStudioViewport } from './components/MaterialStudioViewport';
import { ViewportErrorBoundary } from './components/ViewportErrorBoundary';
import { MeshProgressModal } from './components/MeshProgressModal';
import { BooleanStudioModal } from './components/BooleanStudioModal';
import { BlueprintCarverModal } from './components/BlueprintCarverModal';
import { useStore } from './store/useStore';
import { PanelRightClose, PanelRightOpen, ChevronDown, ChevronUp, Film } from 'lucide-react';
import { generateAllThumbnailsAsync } from './utils/proceduralTextures';

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Inicializando motor 3D...');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(true);

  const isBooleanModalOpen = useStore(state => state.isBooleanModalOpen);
  const closeBooleanModal = useStore(state => state.closeBooleanModal);
  const booleanModalTargetId = useStore(state => state.booleanModalTargetId);
  const booleanModalToolId = useStore(state => state.booleanModalToolId);
  const isMaterialStudioOpen = useStore(state => state.isMaterialStudioOpen);
  const isBlueprintModalOpen = useStore(state => state.isBlueprintModalOpen);
  const closeBlueprintModal = useStore(state => state.closeBlueprintModal);

  useEffect(() => {
    const initApplication = async () => {
      try {
        setAppReady(true);
        // Pre-cargar biblioteca en segundo plano sin congelar la interfaz
        generateAllThumbnailsAsync().catch(err => console.warn("Thumbnails async notice:", err));
      } catch (e) {
        console.error("Error durante el arranque:", e);
        setAppReady(true);
      }
    };
    initApplication();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 't' || e.key === 'T') {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          setIsTimelineCollapsed(prev => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!appReady) {
    return (
      <div className="fixed inset-0 bg-[#0d0e15] flex flex-col items-center justify-center z-[9999]">
        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-sm font-bold text-white tracking-wide uppercase">CSG Studio Editor</h2>
        <p className="text-xs text-indigo-400 font-mono mt-1.5 animate-pulse">{loadingStatus}</p>
        <div className="w-48 h-1 bg-zinc-800 rounded-full mt-4 overflow-hidden relative">
          <div className="absolute top-0 bottom-0 left-0 bg-indigo-500 animate-pulse w-full" />
        </div>
      </div>
    );
  }

  // ── MODO VISOR DE MATERIALES AISLADO (Ahorro del 100% de recursos de la escena 3D) ──
  if (isMaterialStudioOpen) {
    return (
      <ViewportErrorBoundary fallbackTitle="Estudio de Materiales">
        <MaterialStudioViewport />
        <MeshProgressModal />
      </ViewportErrorBoundary>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden font-sans"
         style={{ background: 'var(--surface-0)' }}>

      {/* ── Top bar ── */}
      <Toolbar />

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden relative"
           style={{ borderTop: '1px solid var(--border)' }}>

        {/* Viewport */}
        <div className="flex-1 relative overflow-hidden flex flex-col min-w-0">
          <ViewportErrorBoundary fallbackTitle="Visores 3D">
            <MultiViewport />
          </ViewportErrorBoundary>
          
          {/* Timeline Toggle Button */}
          <button
            onClick={() => setIsTimelineCollapsed(v => !v)}
            className={`absolute bottom-3 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md transition-all duration-200 active:scale-95 ${
              isTimelineCollapsed
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/40 shadow-indigo-600/30'
                : 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/80'
            }`}
            title={isTimelineCollapsed ? "Expandir línea de tiempo y controles de animación (T)" : "Minimizar línea de tiempo para mayor visibilidad (T)"}
          >
            <Film size={13} className={isTimelineCollapsed ? "animate-pulse text-indigo-200" : "text-zinc-400"} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {isTimelineCollapsed ? "Mostrar Línea de Tiempo" : "Minimizar Línea de Tiempo"}
            </span>
            {isTimelineCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Sidebar separator (desktop) */}
        <div className="hidden lg:block w-px flex-shrink-0"
             style={{ background: 'var(--border)' }} />

        {/* Sidebar panel */}
        <aside
          className={[
            'fixed inset-y-0 right-0 z-40',
            'transform transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            'lg:relative lg:translate-x-0 lg:inset-auto lg:h-full',
            isSidebarOpen ? 'translate-x-0' : 'translate-x-full',
            'w-80 sm:w-[360px] md:w-[375px] lg:w-[380px] xl:w-[410px]',
            'flex flex-col h-full max-h-full overflow-hidden',
          ].join(' ')}
          style={{ background: 'var(--surface-1)' }}
        >
          {/* Mobile header */}
          <div className="flex items-center justify-between px-3 py-2 border-b lg:hidden shrink-0"
               style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'var(--text-muted)' }}>Propiedades</span>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            >
              <PanelRightClose size={14} style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <PropertiesPanel />
          </div>
        </aside>

        {/* Mobile FAB */}
        <button
          onClick={() => setIsSidebarOpen(v => !v)}
          className="fixed right-4 bottom-28 z-50 p-3 rounded-2xl lg:hidden transition-all duration-200 active:scale-90 shadow-2xl"
          style={{
            background: isSidebarOpen ? 'var(--surface-3)' : 'var(--accent)',
            boxShadow: isSidebarOpen
              ? '0 8px 32px rgba(0,0,0,0.4)'
              : '0 8px 32px rgba(99,102,241,0.45)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
          title="Alternar panel de propiedades"
        >
          {isSidebarOpen
            ? <PanelRightClose size={20} className="text-white" />
            : <PanelRightOpen  size={20} className="text-white" />
          }
        </button>

        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </div>

      {/* ── Timeline ── */}
      {!isTimelineCollapsed && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Timeline onToggleCollapse={() => setIsTimelineCollapsed(true)} />
        </div>
      )}

      {/* ── Mesh Operation Progress Modal ── */}
      <MeshProgressModal />

      {/* ── Unified CSG Boolean Studio Modal ── */}
      <BooleanStudioModal
        isOpen={isBooleanModalOpen}
        onClose={closeBooleanModal}
        initialTargetId={booleanModalTargetId}
        initialToolId={booleanModalToolId}
      />

      {/* ── Blueprint Carver Studio (3-View Sketch Modeling) ── */}
      <BlueprintCarverModal
        isOpen={isBlueprintModalOpen}
        onClose={closeBlueprintModal}
      />
    </div>
  );
}
