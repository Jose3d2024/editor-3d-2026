import React, { useState, useEffect, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { RetopologyPanel } from './components/RetopologyPanel';
import { Timeline } from './components/Timeline';
import { MultiViewport } from './components/MultiViewport';
import { MaterialStudioViewport } from './components/MaterialStudioViewport';
import { ViewportErrorBoundary } from './components/ViewportErrorBoundary';
import { MeshProgressModal } from './components/MeshProgressModal';
import { BooleanStudioModal } from './components/BooleanStudioModal';
import { BlueprintCarverModal } from './components/BlueprintCarverModal';
import { useStore } from './store/useStore';
import { PanelRightClose, PanelRightOpen, ChevronDown, ChevronUp, Film, ShieldCheck, RotateCw, X } from 'lucide-react';
import { generateAllThumbnailsAsync } from './utils/proceduralTextures';
import { saveTempBackup, getTempBackup, restoreTempBackup, AUTO_BACKUP_INTERVAL_MS, TempBackupData } from './utils/autoBackup';

export default function App() {
  const [appReady, setAppReady] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Inicializando motor 3D...');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(true);
  const [recoveryBackup, setRecoveryBackup] = useState<TempBackupData | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  // Ancho compacto por defecto para mayor espacio en el visor 3D (280px), redimensionable interactivamente
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('csg_sidebar_width_px');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 220 && val <= 600) return val;
      }
    } catch (_) {}
    return 280; // Inicio compacto por defecto
  });

  const isResizingSidebar = useRef(false);

  const handleSidebarResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    isResizingSidebar.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let lastWidth = startWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isResizingSidebar.current) return;
      // Arrastrar a la izquierda agranda el panel derecho, arrastrar a la derecha lo reduce
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(Math.max(220, startWidth + delta), Math.min(580, window.innerWidth * 0.55));
      lastWidth = newWidth;
      setSidebarWidth(newWidth);
    };

    const onPointerUp = () => {
      isResizingSidebar.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      try {
        localStorage.setItem('csg_sidebar_width_px', String(lastWidth));
      } catch (_) {}
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const isBooleanModalOpen = useStore(state => state.isBooleanModalOpen);
  const closeBooleanModal = useStore(state => state.closeBooleanModal);
  const booleanModalTargetId = useStore(state => state.booleanModalTargetId);
  const booleanModalToolId = useStore(state => state.booleanModalToolId);
  const isMaterialStudioOpen = useStore(state => state.isMaterialStudioOpen);
  const isBlueprintModalOpen = useStore(state => state.isBlueprintModalOpen);
  const closeBlueprintModal = useStore(state => state.closeBlueprintModal);
  const drawMode = useStore(state => state.drawMode);

  // ── 1. Inicialización y detección de copia de seguridad previa ──
  useEffect(() => {
    const initApplication = async () => {
      try {
        setAppReady(true);
        generateAllThumbnailsAsync().catch(err => console.warn("Thumbnails async notice:", err));
        
        // Verificar si existe una copia de seguridad temporal de una sesión anterior
        const prevBackup = await getTempBackup();
        if (prevBackup && prevBackup.objectCount > 0) {
          const currentProject = useStore.getState().project;
          const isCurrentEmpty = (currentProject.objects?.length || 0) <= 2;
          const ageMs = Date.now() - prevBackup.timestamp;
          // Si la copia fue en las últimas 48 horas y la escena actual está vacía / por defecto
          if (isCurrentEmpty && ageMs < 48 * 3600 * 1000) {
            setRecoveryBackup(prevBackup);
          }
        }
      } catch (e) {
        console.error("Error durante el arranque:", e);
        setAppReady(true);
      }
    };
    initApplication();
  }, []);

  // ── 2. Loop de Copia de Seguridad Automática cada 1.5 minutos (90 segundos) ──
  useEffect(() => {
    if (!appReady) return;

    const runBackup = async () => {
      try {
        const currentProject = useStore.getState().project;
        if (currentProject.objects && currentProject.objects.length > 0) {
          const saved = await saveTempBackup(currentProject);
          setBackupNotice(`Copia temporal guardada (${saved.dateStr})`);
          setTimeout(() => setBackupNotice(null), 3000);
        }
      } catch (err) {
        console.warn('Auto-backup background notice:', err);
      }
    };

    // Ejecutar intervalo periódico cada 90s (1.5 minutos)
    const interval = setInterval(runBackup, AUTO_BACKUP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [appReady]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 't' || e.key === 'T') {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          setIsTimelineCollapsed(prev => !prev);
        }
      }
      if (e.key === 'Escape') {
        const state = useStore.getState();
        if (!state.drawMode && state.insertVertexMode) state.toggleInsertVertexMode(false);
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

      {/* ── Banner de Recuperación de Copia de Seguridad Temporal Previa ── */}
      {recoveryBackup && (
        <div className="bg-emerald-950/90 border-b border-emerald-500/50 px-4 py-2 text-white flex items-center justify-between z-50 backdrop-blur-md animate-fadeIn select-none">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="p-1 rounded-md bg-emerald-500/20 text-emerald-300">
              <ShieldCheck size={16} />
            </span>
            <span>
              Se encontró una <strong>copia de seguridad temporal</strong> de tu sesión anterior ({recoveryBackup.dateStr} · {recoveryBackup.objectCount} objetos · {recoveryBackup.projectName}).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await restoreTempBackup();
                setRecoveryBackup(null);
              }}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCw size={12} />
              <span>Restaurar Escena</span>
            </button>
            <button
              onClick={() => setRecoveryBackup(null)}
              className="p-1 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Descartar aviso"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Notificación Discreta de Autoguardado Temporal ── */}
      {backupNotice && (
        <div className="fixed bottom-4 left-4 z-50 bg-zinc-900/90 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-full shadow-2xl backdrop-blur-md text-[11px] font-mono flex items-center gap-1.5 animate-fadeIn pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{backupNotice}</span>
        </div>
      )}

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

        {/* Interactive Sidebar Separator & Resizer (Desktop) */}
        <div
          onPointerDown={handleSidebarResizeStart}
          onDoubleClick={() => {
            setSidebarWidth(280);
            try { localStorage.setItem('csg_sidebar_width_px', '280'); } catch (_) {}
          }}
          className="hidden lg:flex w-2.5 -mx-1 hover:w-2.5 hover:bg-indigo-500/25 active:bg-indigo-500 cursor-col-resize z-30 transition-all shrink-0 items-center justify-center group select-none relative"
          title="Arrastra para redimensionar el panel • Doble clic para reiniciar al tamaño compacto (280px)"
        >
          <div className="w-0.5 h-10 rounded-full bg-zinc-700 group-hover:bg-indigo-400 group-active:bg-white transition-colors" />
        </div>

        {/* Sidebar panel */}
        <aside
          className={[
            'fixed inset-y-0 right-0 z-40',
            'transform transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            'lg:relative lg:translate-x-0 lg:inset-auto lg:h-full',
            isSidebarOpen ? 'translate-x-0' : 'translate-x-full',
            'flex flex-col h-full max-h-full overflow-hidden shrink-0',
          ].join(' ')}
          style={{
            background: 'var(--surface-1)',
            width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${sidebarWidth}px` : undefined,
          }}
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
            {drawMode === 'retopo' ? <RetopologyPanel /> : <PropertiesPanel />}
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
