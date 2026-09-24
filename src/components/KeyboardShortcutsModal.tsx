import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Keyboard, Search, X, Pin, PinOff, Minimize2, Maximize2,
  Move, RotateCw, Box, Compass, Sparkles, Layers,
  Scissors, Undo2, Redo2, Eye, HelpCircle, Flame, Check
} from 'lucide-react';

export interface ShortcutItem {
  id: string;
  category: 'navigation' | 'tools' | 'modeling' | 'selection' | 'history' | 'view';
  keys: string[];
  description: string;
  detail?: string;
  badge?: string;
}

export const SHORTCUTS_DATA: ShortcutItem[] = [
  // ── Navegación y Cámara ──
  {
    id: 'nav-orbit',
    category: 'navigation',
    keys: ['Clic Izq (Órbita)', 'o', 'Alt + Clic Izq'],
    description: 'Rotar / Orbitar Cámara',
    detail: 'Rota la vista 3D en el espacio alrededor del objetivo central.',
  },
  {
    id: 'nav-pan',
    category: 'navigation',
    keys: ['Clic Central', 'Shift + Clic Izq'],
    description: 'Desplazar (Pan) Cámara',
    detail: 'Mueve la vista lateralmente en el plano de la pantalla.',
  },
  {
    id: 'nav-zoom',
    category: 'navigation',
    keys: ['Rueda Ratón'],
    description: 'Zoom Acercar / Alejar',
    detail: 'Ajusta la distancia focal o distancia de la cámara al centro.',
  },
  {
    id: 'nav-focus',
    category: 'navigation',
    keys: ['Espacio', 'Doble Clic'],
    description: 'Enfocar Objeto Seleccionado',
    detail: 'Centra la cámara instantáneamente en el objeto o elemento activo.',
    badge: 'Popular',
  },
  {
    id: 'nav-tab-mode',
    category: 'navigation',
    keys: ['Tab'],
    description: 'Alternar Modo Objeto / Modo Edición',
    detail: 'Cambia entre manipulación global y edición de vértices / NURBS hull.',
    badge: 'Esencial',
  },

  // ── Herramientas y Gizmo de Transformación ──
  {
    id: 'tool-translate',
    category: 'tools',
    keys: ['W', 'G'],
    description: 'Herramienta de Traslación (Mover)',
    detail: 'Activa el gizmo de movimiento en los ejes X, Y, Z.',
  },
  {
    id: 'tool-rotate',
    category: 'tools',
    keys: ['E', 'R'],
    description: 'Herramienta de Rotación (Girar)',
    detail: 'Activa los aros de rotación en los 3 ejes de coordenadas.',
  },
  {
    id: 'tool-scale',
    category: 'tools',
    keys: ['S'],
    description: 'Herramienta de Escala (Redimensionar)',
    detail: 'Permite escalar uniformemente o por cada eje de orientación.',
  },
  {
    id: 'tool-mode-1',
    category: 'tools',
    keys: ['1'],
    description: 'Modo Objeto',
    detail: 'Selección y transformación completa del objeto 3D.',
  },
  {
    id: 'tool-mode-2',
    category: 'tools',
    keys: ['2'],
    description: 'Modo Cara (Face Mode)',
    detail: 'Selecciona caras individuales o múltiples para extruir y editar.',
  },
  {
    id: 'tool-mode-3',
    category: 'tools',
    keys: ['3'],
    description: 'Modo Arista (Edge Mode)',
    detail: 'Selecciona aristas para biselar, achaflanar o disolver.',
  },
  {
    id: 'tool-mode-4',
    category: 'tools',
    keys: ['4'],
    description: 'Modo Vértice (Vertex Mode)',
    detail: 'Mueve y ajusta los vértices individuales de la malla 3D.',
  },

  // ── Modelado 3D & Mallas ──
  {
    id: 'mod-connect-verts',
    category: 'modeling',
    keys: ['J'],
    description: 'Conectar Vértices con Línea (Cortar Cara)',
    detail: 'Une 2 vértices seleccionados creando una nueva arista y dividiendo el polígono.',
    badge: 'Nuevo',
  },
  {
    id: 'mod-fill-face',
    category: 'modeling',
    keys: ['F'],
    description: 'Crear Cara / Rellenar Polígono',
    detail: 'Genera una nueva cara o polígono a partir de los vértices o aristas seleccionadas.',
    badge: 'Nuevo',
  },
  {
    id: 'mod-extrude-vert',
    category: 'modeling',
    keys: ['E'],
    description: 'Extruir Vértice o Cara',
    detail: 'Extruye el vértice creando un nuevo segmento o extruye las caras seleccionadas.',
  },
  {
    id: 'mod-weld-verts',
    category: 'modeling',
    keys: ['W'],
    description: 'Soldar / Fusionar Vértices',
    detail: 'Une vértices coincidentes o seleccionados en un único punto común.',
  },
  {
    id: 'mod-select-linked',
    category: 'modeling',
    keys: ['L'],
    description: 'Seleccionar Isla Conectada (Select Linked)',
    detail: 'Selecciona automáticamente todos los polígonos y vértices vinculados a la isla de la selección.',
    badge: 'Pro',
  },
  {
    id: 'mod-invert-selection',
    category: 'modeling',
    keys: ['Ctrl + I'],
    description: 'Invertir Selección de Polígonos',
    detail: 'Invierte las caras o vértices seleccionados para aislar o eliminar el resto de la figura.',
    badge: 'Pro',
  },
  {
    id: 'mod-subdiv-segment',
    category: 'modeling',
    keys: ['D'],
    description: 'Dividir Arista / Insertar Vértice',
    detail: 'Subdivide la arista o segmento seleccionado insertando un nuevo vértice central.',
  },
  {
    id: 'mod-dissolve-selection',
    category: 'modeling',
    keys: ['Ctrl + X'],
    description: 'Disolver Vértices / Aristas / Caras (Dissolve)',
    detail: 'Elimina los elementos seleccionados fusionando la geometría contigua sin romper la malla ni dejar huecos.',
    badge: 'Blender',
  },
  {
    id: 'mod-merge-by-distance',
    category: 'modeling',
    keys: ['M'],
    description: 'Fusionar / Soldar (Merge by Distance)',
    detail: 'En Modo Vértice, fusiona vértices duplicados o cercanos según tolerancia; en Modo Cara, unifica caras coplanares.',
    badge: 'Blender',
  },
  {
    id: 'mod-collapse-selection',
    category: 'modeling',
    keys: ['Alt + X'],
    description: 'Colapsar (Collapse)',
    detail: 'Fusiona los elementos seleccionados (vértices, aristas o caras) colapsándolos en un único vértice central.',
    badge: 'Blender',
  },
  {
    id: 'mod-quad-remesh',
    category: 'modeling',
    keys: ['Ctrl + Alt + R'],
    description: 'Quad Remesh (Quadriflow)',
    detail: 'Reconstruye la topología completa en cuadriláteros limpios (Quads) siguiendo el flujo de curvatura para animación.',
    badge: 'Pro',
  },
  {
    id: 'mod-voxel-remesh',
    category: 'modeling',
    keys: ['Ctrl + Shift + R'],
    description: 'Voxel Remesh (SDF)',
    detail: 'Remalla volumétricamente la geometría fusionando piezas separadas, cerrando agujeros y unificando esculturas.',
    badge: 'Esculpido',
  },
  {
    id: 'mod-loop-cut',
    category: 'modeling',
    keys: ['Ctrl + R'],
    description: 'Corte en Bucle (Loop Cut and Slide)',
    detail: 'Inserta un bucle continuo de aristas dividiendo caras cuádruples con vista previa.',
    badge: 'Blender',
  },
  {
    id: 'mod-extrude-manifold',
    category: 'modeling',
    keys: ['Alt + E'],
    description: 'Extrusión Manifold (Extrude Manifold)',
    detail: 'Extruye caras resolviendo solapamientos e intersecciones automáticamente sin caras internas.',
    badge: 'Blender',
  },
  {
    id: 'mod-extrude',
    category: 'modeling',
    keys: ['Ctrl + E'],
    description: 'Extruir Caras Seleccionadas',
    detail: 'Empuja o estira las caras seleccionadas creando nueva geometría 3D.',
    badge: 'Pro',
  },
  {
    id: 'mod-shape-close',
    category: 'modeling',
    keys: ['C'],
    description: 'Cerrar / Abrir Curva 2D',
    detail: 'En formas 2D seleccionadas, conmuta si el contorno es abierto o cerrado.',
  },
  {
    id: 'mod-del-face-edge',
    category: 'modeling',
    keys: ['Supr', 'X'],
    description: 'Disolver Arista / Borrar Cara',
    detail: 'En modo Cara o Arista, elimina o fusiona la geometría seleccionada.',
  },

  // ── Selección y Organización ──
  {
    id: 'sel-all',
    category: 'selection',
    keys: ['Ctrl + A'],
    description: 'Seleccionar Todos los Objetos',
    detail: 'Añade todos los elementos visibles de la escena a la selección.',
  },
  {
    id: 'sel-dup',
    category: 'selection',
    keys: ['Ctrl + D'],
    description: 'Duplicar Selección',
    detail: 'Crea una copia idéntica del objeto o grupo seleccionado.',
    badge: 'Rápido',
  },
  {
    id: 'sel-deselect',
    category: 'selection',
    keys: ['Escape'],
    description: 'Deseleccionar Todo / Cancelar',
    detail: 'Limpia la selección actual y cancela acciones en curso.',
  },

  // ── Historial y Proyecto ──
  {
    id: 'hist-save',
    category: 'history',
    keys: ['Ctrl + S'],
    description: 'Guardar / Sobreescribir Proyecto',
    detail: 'Guarda y sobreescribe los cambios de la escena activa localmente.',
    badge: 'Nuevo',
  },
  {
    id: 'hist-save-as',
    category: 'history',
    keys: ['Ctrl + Shift + S'],
    description: 'Guardar Escena Como...',
    detail: 'Abre el cuadro de diálogo para guardar con un nuevo nombre o exportar archivo.',
  },
  {
    id: 'hist-undo',
    category: 'history',
    keys: ['Ctrl + Z'],
    description: 'Deshacer (Undo)',
    detail: 'Revierte el último cambio de posición, geometría o materiales.',
  },
  {
    id: 'hist-redo',
    category: 'history',
    keys: ['Ctrl + Y', 'Ctrl + Shift + Z'],
    description: 'Rehacer (Redo)',
    detail: 'Vuelve a aplicar el cambio revertido.',
  },
  {
    id: 'mod-symmetry',
    category: 'modeling',
    keys: ['Simetría (Panel)'],
    description: 'Simetría de Vértices Seleccionados',
    detail: 'Espeja y duplica la posición de los vértices seleccionados al otro lado del eje X, Y o Z.',
    badge: 'Nuevo',
  },
  {
    id: 'hist-shortcuts-help',
    category: 'history',
    keys: ['?', 'Shift + /', 'F1'],
    description: 'Abrir Guía de Atajos de Teclado',
    detail: 'Muestra este panel interactivo de accesos directos y atajos.',
    badge: 'Ayuda',
  },

  // ── Vistas y Render ──
  {
    id: 'view-timeline',
    category: 'view',
    keys: ['T'],
    description: 'Mostrar / Ocultar Línea de Tiempo',
    detail: 'Alterna el panel inferior de animación, keyframes y reproducción.',
  },
];

export const CATEGORIES = [
  { id: 'all', label: 'Todos los Atajos', icon: Flame },
  { id: 'navigation', label: 'Navegación & Cámara', icon: Compass },
  { id: 'tools', label: 'Herramientas & Gizmos', icon: Move },
  { id: 'modeling', label: 'Modelado 3D & Mallas', icon: Box },
  { id: 'selection', label: 'Selección & Edición', icon: Layers },
  { id: 'history', label: 'Historial & Proyecto', icon: Undo2 },
  { id: 'view', label: 'Vistas & Animación', icon: Sparkles },
] as const;

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isFloatingInitially?: boolean;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  isFloatingInitially = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isFloating, setIsFloating] = useState(isFloatingInitially);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activePressedKey, setActivePressedKey] = useState<string | null>(null);

  // Detect pressed keys in real time for feedback
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyName = e.key.toUpperCase();
      setActivePressedKey(keyName);
      if (e.key === 'Escape' && !isFloating) {
        onClose();
      }
    };
    const handleKeyUp = () => {
      setActivePressedKey(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen, isFloating, onClose]);

  const filteredShortcuts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return SHORTCUTS_DATA.filter(item => {
      const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      const inDesc = item.description.toLowerCase().includes(query);
      const inDetail = item.detail?.toLowerCase().includes(query) ?? false;
      const inKeys = item.keys.some(k => k.toLowerCase().includes(query));
      return inDesc || inDetail || inKeys;
    });
  }, [searchQuery, selectedCategory]);

  if (!isOpen) return null;

  // Render as Floating Panel
  if (isFloating) {
    return (
      <div
        id="floating-shortcuts-panel"
        className="fixed bottom-14 right-6 z-[9000] w-[380px] max-w-[92vw] bg-zinc-950/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-zinc-100 transition-all duration-200"
        style={{
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 20px rgba(99, 102, 241, 0.15)',
        }}
      >
        {/* Floating Panel Header */}
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-900/80 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Keyboard size={14} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white leading-tight">Atajos de Teclado</h3>
              <p className="text-[9px] text-zinc-400">Guía flotante rápida</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-md transition-colors"
              title={isMinimized ? "Expandir" : "Minimizar"}
            >
              {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
            </button>
            <button
              onClick={() => setIsFloating(false)}
              className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-md transition-colors"
              title="Ver en modo modal centrado"
            >
              <PinOff size={13} />
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-rose-500/20 hover:text-rose-400 text-zinc-400 rounded-md transition-colors"
              title="Cerrar panel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* Search Bar */}
            <div className="p-2.5 border-b border-zinc-800/80 bg-zinc-900/40">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar atajo (ej. W, extruir, órbita)..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-7 py-1.5 bg-zinc-900 border border-zinc-700/70 rounded-lg text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Mini category pills */}
              <div className="flex gap-1 overflow-x-auto mt-2 pb-0.5 scrollbar-none">
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  const active = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap flex items-center gap-1 transition-all ${
                        active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-zinc-800/70 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      <Icon size={10} />
                      <span>{cat.label.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Shortcuts List */}
            <div className="max-h-[320px] overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
              {filteredShortcuts.length === 0 ? (
                <div className="py-6 text-center text-zinc-500 text-xs">
                  No se encontraron atajos para "{searchQuery}"
                </div>
              ) : (
                filteredShortcuts.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/60 border border-zinc-800/50 transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-zinc-200 truncate">
                          {item.description}
                        </span>
                        {item.badge && (
                          <span className="px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 text-[8px] font-bold rounded border border-indigo-500/30">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.detail && (
                        <p className="text-[9px] text-zinc-400 truncate">{item.detail}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k, i) => (
                        <React.Fragment key={i}>
                          <kbd
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold tracking-tight border shadow-sm transition-all ${
                              activePressedKey && k.toUpperCase().includes(activePressedKey)
                                ? 'bg-indigo-600 text-white border-indigo-400 scale-105 shadow-indigo-500/40'
                                : 'bg-zinc-800 text-zinc-300 border-zinc-700/80'
                            }`}
                          >
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-3 py-1.5 bg-zinc-900/50 border-t border-zinc-800/80 flex items-center justify-between text-[9px] text-zinc-500">
              <span>{filteredShortcuts.length} atajos disponibles</span>
              <span className="font-mono">Presiona <kbd className="text-zinc-400">?</kbd> para alternar</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // Render as Full Centered Modal Dialog
  return (
    <AnimatePresence>
      <div
        id="shortcuts-modal-overlay"
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-3xl max-h-[88vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-zinc-100"
          style={{
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(99, 102, 241, 0.15)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-zinc-900/60 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-600/30">
                <Keyboard size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-wide">
                    Atajos de Teclado y Accesos Rápidos
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold">
                    Eficiencia 3D
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Guía completa de controles para navegación de cámara, herramientas y modelado
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setIsFloating(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors border border-zinc-700/60"
                title="Convertir en panel flotante de referencia"
              >
                <Pin size={13} />
                <span>Panel Flotante</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                title="Cerrar (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Search and Category Filter */}
          <div className="p-5 border-b border-zinc-800/80 bg-zinc-900/30 space-y-3">
            {/* Search Input */}
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Buscar atajo por nombre, tecla o descripción (ej. W, rotar, Tab, cara, extrusión)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full pl-10 pr-10 py-2.5 bg-zinc-900/90 border border-zinc-700 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-200"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Category Buttons */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <Icon size={13} className={active ? 'text-white' : 'text-zinc-500'} />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content: Shortcuts Grid */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {filteredShortcuts.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
                <HelpCircle size={32} className="text-zinc-600 mb-1" />
                <p className="text-sm font-semibold text-zinc-300">No se encontraron resultados</p>
                <p className="text-xs text-zinc-500 max-w-sm">
                  Prueba a buscar con otra palabra clave o selecciona otra categoría de herramientas.
                </p>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                  className="mt-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-indigo-400 text-xs font-semibold rounded-lg transition-colors"
                >
                  Restablecer filtros
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredShortcuts.map(item => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900 transition-all flex flex-col justify-between gap-2.5 group shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-xs font-bold text-zinc-100 group-hover:text-white transition-colors">
                            {item.description}
                          </h4>
                          {item.badge && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[9px] font-bold border border-indigo-500/30">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.detail && (
                          <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                            {item.detail}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Keys Row */}
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      {item.keys.map((keyString, kidx) => {
                        const isOr = keyString.toLowerCase() === 'o';
                        if (isOr) {
                          return (
                            <span key={kidx} className="text-[10px] text-zinc-500 font-medium px-0.5">
                              o
                            </span>
                          );
                        }
                        return (
                          <kbd
                            key={kidx}
                            className={`px-2 py-1 rounded-md text-[10.5px] font-mono font-bold tracking-tight border shadow-md transition-all ${
                              activePressedKey && keyString.toUpperCase().includes(activePressedKey)
                                ? 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-500/30 scale-105'
                                : 'bg-zinc-800/90 text-zinc-200 border-zinc-700/80 hover:border-zinc-600'
                            }`}
                          >
                            {keyString}
                          </kbd>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{filteredShortcuts.length} de {SHORTCUTS_DATA.length} atajos activos</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-zinc-500 font-mono">
              <span>Tip: Presiona <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-300">Tab</kbd> para alternar modo edición</span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors text-xs"
              >
                Entendido
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
