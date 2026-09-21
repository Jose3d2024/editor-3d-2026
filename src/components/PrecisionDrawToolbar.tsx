import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  GripVertical,
  X,
  Trash2,
  Split,
  PlusCircle,
  Link2,
  CircleDot,
  Compass,
  Layers,
  ArrowUpRight,
  Minimize2,
  RefreshCw,
  Sparkles,
  Scissors,
  Box,
  CornerUpRight,
  Repeat
} from 'lucide-react';

export const PrecisionDrawToolbar: React.FC = () => {
  const {
    drawMode,
    setDrawMode,
    orthoDrawMode,
    setOrthoDrawMode,
    drawLockAxis,
    setDrawLockAxis,
    editMode,
    setEditMode,
    selectedObjectId,
    selectedVertexIndices,
    selectedFaceIndices,
    selectedEdgeIndices,
    insertVertexMode,
    setInsertVertexMode,
    loopCutMode,
    setLoopCutMode,
    project,
    weldSelectedVertices,
    subdivideShapeSegment,
    deleteSelectedVertices,
    toggleShapeClosed,
    extrudeFaces,
    extrudeManifold,
    insetFaces,
    applyLoopCut,
    flipSelectedFaceNormals,
    deleteSelectedFaces,
    mergeFaces,
    capSelectedFacesObject,
    deleteSelectedEdges,
    dissolveSelectedEdges,
    subdivideSelectedEdges,
    bridgeSelectedEdges,
    bevelSelectedEdges,
    connectVertices,
    createFaceFromVertices,
    extrudeSelectedVertices,
  } = useStore();

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });
  const barRef = useRef<HTMLDivElement>(null);

  const selectedObj = selectedObjectId ? project.objects.find(o => o.id === selectedObjectId) : null;
  const isShape = selectedObj?.type === 'SHAPE';
  const isMeshOrModel = selectedObj && selectedObj.type !== 'SHAPE';

  const showVertexTools = !drawMode && (editMode === 'VERTEX' || selectedVertexIndices.length > 0) && !!selectedObj;
  const showFaceTools = !drawMode && (editMode === 'FACE' || selectedFaceIndices.length > 0) && !!selectedObj;
  const showEdgeTools = !drawMode && (editMode === 'EDGE' || selectedEdgeIndices.length > 0) && !!selectedObj;
  const showAnyEditMode = !drawMode && editMode !== 'OBJECT' && !!selectedObj;

  const isVisible = !!drawMode || showVertexTools || showFaceTools || showEdgeTools || showAnyEditMode;

  // Initialize position to top-center if not set
  useEffect(() => {
    if (isVisible && !position && barRef.current) {
      const parent = barRef.current.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const barRect = barRef.current.getBoundingClientRect();
        setPosition({
          x: Math.max(10, (parentRect.width - barRect.width) / 2),
          y: 12,
        });
      }
    }
  }, [isVisible, position]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    const currentX = position?.x ?? 0;
    const currentY = position?.y ?? 12;
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: currentX,
      startY: currentY,
    };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.mouseX;
    const dy = e.clientY - dragStart.current.mouseY;
    const newX = Math.max(10, dragStart.current.startX + dx);
    const newY = Math.max(8, dragStart.current.startY + dy);
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  if (!isVisible) return null;

  const numEdgesSelected = Math.floor(selectedEdgeIndices.length / 2);

  return (
    <div
      ref={barRef}
      style={{
        position: 'absolute',
        left: position ? `${position.x}px` : '50%',
        top: position ? `${position.y}px` : '12px',
        transform: position ? 'none' : 'translateX(-50%)',
        zIndex: 90,
      }}
      className="flex items-center gap-1.5 bg-zinc-950/95 border border-zinc-700/80 rounded-full px-2.5 py-1 shadow-2xl backdrop-blur-md text-white select-none transition-shadow hover:border-indigo-500/50"
      onPointerDown={e => e.stopPropagation()}
    >
      {/* Drag Grip Handle */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-zinc-300 px-0.5 py-1 flex items-center"
        title="Arrastra para mover esta barra flotante a cualquier lugar"
      >
        <GripVertical size={13} />
      </div>

      {/* ── DRAWING MODE HUD ── */}
      {drawMode && (
        <>
          <div className="flex items-center gap-1 text-indigo-300 font-bold text-[10px] pr-1.5 border-r border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
            <span>{drawMode === 'bezier' ? 'Curva' : drawMode === 'line' ? 'Línea' : 'Rectángulo'}</span>
          </div>

          {/* Escuadra 90° toggle */}
          <button
            type="button"
            onClick={() => setOrthoDrawMode(!orthoDrawMode)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer border ${
              orthoDrawMode
                ? 'bg-amber-600 text-white border-amber-400 shadow-sm'
                : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800'
            }`}
            title="Escuadra 90° (Q o Shift sostenido)"
          >
            <Compass size={11} className={orthoDrawMode ? 'rotate-45' : ''} />
            <span>Escuadra 90°</span>
          </button>

          {/* Ejes */}
          <div className="flex items-center bg-zinc-900 rounded-full p-0.5 border border-zinc-800 text-[9px] font-bold">
            {(['FREE', 'ORTHO_90', 'X', 'Y', 'Z'] as const).map(axis => (
              <button
                key={axis}
                type="button"
                onClick={() => setDrawLockAxis(axis)}
                className={`px-1.5 py-0.5 rounded-full transition-all cursor-pointer ${
                  drawLockAxis === axis
                    ? 'bg-indigo-600 text-white font-black shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={`Bloquear dibujo: ${axis === 'FREE' ? 'Libre' : axis === 'ORTHO_90' ? '90°' : 'Eje ' + axis}`}
              >
                {axis === 'FREE' ? 'Libre' : axis === 'ORTHO_90' ? '90°' : axis}
              </button>
            ))}
          </div>

          {/* Close & Weld button */}
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('csg-finish-drawing-stroke', { detail: { close: true } }));
            }}
            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all shadow-sm"
            title="Cerrar y soldar vértices de inicio y fin"
          >
            <Link2 size={11} />
            <span>Cerrar</span>
          </button>

          {/* Cancel button */}
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('csg-cancel-drawing-stroke'));
              setDrawMode(null);
            }}
            className="p-1 text-zinc-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-full transition-colors cursor-pointer"
            title="Cancelar dibujo (Esc)"
          >
            <X size={12} />
          </button>
        </>
      )}

      {/* ── MESH / SUB-ELEMENT EDIT MODE SELECTOR ── */}
      {!drawMode && selectedObj && (
        <div className="flex items-center gap-0.5 bg-zinc-900/90 rounded-full p-0.5 border border-zinc-800 text-[10px]">
          <button
            type="button"
            onClick={() => setEditMode('FACE')}
            className={`px-1.5 py-0.5 rounded-full font-semibold transition-all ${
              editMode === 'FACE' ? 'bg-amber-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Modo Caras (Tecla 2)"
          >
            Caras (2)
          </button>
          <button
            type="button"
            onClick={() => setEditMode('EDGE')}
            className={`px-1.5 py-0.5 rounded-full font-semibold transition-all ${
              editMode === 'EDGE' ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Modo Bordes / Lados (Tecla 3)"
          >
            Bordes (3)
          </button>
          <button
            type="button"
            onClick={() => setEditMode('VERTEX')}
            className={`px-1.5 py-0.5 rounded-full font-semibold transition-all ${
              editMode === 'VERTEX' ? 'bg-violet-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Modo Vértices (Tecla 4)"
          >
            Vértices (4)
          </button>
        </div>
      )}

      {/* ── FACE EDIT TOOLS ── */}
      {!drawMode && editMode === 'FACE' && selectedObj && (
        <>
          <div className="w-px h-3.5 bg-white/10 mx-0.5" />
          <div className="flex items-center gap-1 text-amber-400 font-bold text-[10px] pr-1">
            <Layers size={11} />
            <span>{selectedFaceIndices.length > 0 ? `${selectedFaceIndices.length} cara(s)` : 'Caras'}</span>
          </div>

          {/* Extrude */}
          <button
            type="button"
            onClick={() => {
              if (selectedFaceIndices.length === 0) {
                alert('Selecciona una o más caras haciendo clic sobre el modelo.');
                return;
              }
              extrudeFaces(selectedObjectId!, selectedFaceIndices, 0.4);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'bg-amber-600/90 hover:bg-amber-500 text-white border-amber-500 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Extruir caras seleccionadas a lo largo de su normal (E)"
          >
            <ArrowUpRight size={11} />
            <span>Extruir (E)</span>
          </button>

          {/* Extrude Manifold */}
          <button
            type="button"
            onClick={async () => {
              if (selectedFaceIndices.length === 0) {
                alert('Selecciona una o más caras para la Extrusión Manifold.');
                return;
              }
              const res = await extrudeManifold(selectedObjectId!, selectedFaceIndices, 0.4);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'bg-emerald-600/90 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Extrude Manifold (Blender Alt+E): Mantiene el sólido watertight y disuelve geometrías solapadas"
          >
            <Sparkles size={11} />
            <span>Manifold (Alt+E)</span>
          </button>

          {/* Inset */}
          <button
            type="button"
            onClick={() => {
              if (selectedFaceIndices.length === 0) {
                alert('Selecciona una o más caras para hacer Inset.');
                return;
              }
              const res = insetFaces(selectedObjectId!, selectedFaceIndices, 0.25);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'bg-zinc-900 hover:bg-zinc-800 text-amber-300 border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Insertar contorno interior en las caras (Inset / I)"
          >
            <Minimize2 size={11} />
            <span>Inset (I)</span>
          </button>

          {/* Subdividir Caras */}
          <button
            type="button"
            onClick={() => {
              if (selectedFaceIndices.length === 0) {
                alert('Selecciona caras para subdividir.');
                return;
              }
              useStore.getState().subdivideFaces(selectedObjectId!, selectedFaceIndices);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Subdividir caras seleccionadas en 4 quads (D)"
          >
            <Scissors size={11} />
            <span>Subdividir</span>
          </button>

          {/* Fusionar / Disolver Caras */}
          <button
            type="button"
            onClick={() => {
              if (selectedFaceIndices.length < 2) {
                alert('Selecciona 2 o más caras adyacentes para fusionar.');
                return;
              }
              mergeFaces(selectedObjectId!, selectedFaceIndices);
            }}
            disabled={selectedFaceIndices.length < 2}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length >= 2
                ? 'bg-zinc-900 hover:bg-indigo-600 text-zinc-200 hover:text-white border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Fusionar caras coplanares en un solo polígono (M)"
          >
            <Link2 size={11} />
            <span>Fusionar</span>
          </button>

          {/* Invertir Normales */}
          <button
            type="button"
            onClick={() => {
              if (selectedFaceIndices.length === 0) {
                alert('Selecciona caras para invertir sus normales.');
                return;
              }
              const res = flipSelectedFaceNormals(selectedObjectId!, selectedFaceIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`p-1 rounded-full transition-colors cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'text-zinc-300 hover:text-amber-400 hover:bg-zinc-800 border-zinc-700'
                : 'text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Invertir orientación / normales de las caras seleccionadas (Flip)"
          >
            <RefreshCw size={11} />
          </button>

          {/* Tapar Hueco */}
          <button
            type="button"
            onClick={async () => {
              await capSelectedFacesObject(selectedObjectId!);
            }}
            className="px-2 py-0.5 bg-zinc-900 hover:bg-emerald-600 text-zinc-200 hover:text-white border border-zinc-700 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
            title="Tapar hueco en la selección (F)"
          >
            <span>Tapar (F)</span>
          </button>

          {/* Eliminar Caras */}
          <button
            type="button"
            onClick={() => {
              const res = deleteSelectedFaces(selectedObjectId!, selectedFaceIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedFaceIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedFaceIndices.length > 0
                ? 'bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white border-rose-800 hover:border-rose-500'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Eliminar caras seleccionadas (Supr / Delete / Backspace)"
          >
            <Trash2 size={11} />
            <span>Eliminar</span>
          </button>
        </>
      )}

      {/* ── EDGE / SEGMENT EDIT TOOLS ── */}
      {!drawMode && editMode === 'EDGE' && selectedObj && (
        <>
          <div className="w-px h-3.5 bg-white/10 mx-0.5" />
          <div className="flex items-center gap-1 text-indigo-400 font-bold text-[10px] pr-1">
            <span className="w-2 h-0.5 bg-indigo-400 rounded-full"></span>
            <span>{numEdgesSelected > 0 ? `${numEdgesSelected} borde(s)` : 'Bordes'}</span>
          </div>

          {/* Biselar / Chaflán */}
          <button
            type="button"
            onClick={() => {
              const res = bevelSelectedEdges(selectedObjectId!, selectedEdgeIndices, 0.1, 3);
              if (!res.success) alert(res.message);
            }}
            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-sm border border-indigo-400"
            title="Biselar / Redondear bordes seleccionados (B)"
          >
            <Sparkles size={11} />
            <span>Biselar (B)</span>
          </button>

          {/* Loop Cut & Slide */}
          <button
            type="button"
            onClick={() => {
              setLoopCutMode(!loopCutMode);
            }}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              loopCutMode
                ? 'bg-cyan-500 text-zinc-950 border-cyan-300 font-bold shadow-sm animate-pulse'
                : 'bg-zinc-900 hover:bg-cyan-900/60 text-cyan-200 border-zinc-700 hover:border-cyan-500'
            }`}
            title="Corte en Bucle y Deslizamiento (Blender Loop Cut: Ctrl + R)"
          >
            <Repeat size={11} />
            <span>Loop Cut (Ctrl+R)</span>
          </button>

          {/* Subdividir Arista */}
          <button
            type="button"
            onClick={() => {
              const res = subdivideSelectedEdges(selectedObjectId!, selectedEdgeIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedEdgeIndices.length < 2 && !isShape}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedEdgeIndices.length >= 2 || isShape
                ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Dividir arista por la mitad insertando un vértice (D)"
          >
            <Split size={11} />
            <span>Dividir (D)</span>
          </button>

          {/* Puente / Crear Cara */}
          <button
            type="button"
            onClick={() => {
              const res = bridgeSelectedEdges(selectedObjectId!, selectedEdgeIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={numEdgesSelected < 2}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              numEdgesSelected >= 2
                ? 'bg-zinc-900 hover:bg-emerald-600 text-zinc-200 hover:text-white border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Crear una cara conectando 2 bordes seleccionados (F)"
          >
            <Link2 size={11} />
            <span>Puente (F)</span>
          </button>

          {/* Disolver Arista */}
          <button
            type="button"
            onClick={async () => {
              const res = await dissolveSelectedEdges(selectedObjectId!, selectedEdgeIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedEdgeIndices.length < 2}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedEdgeIndices.length >= 2
                ? 'bg-zinc-900 hover:bg-violet-600 text-zinc-200 hover:text-white border-zinc-700'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Disolver aristas fusionando las caras adyacentes (X)"
          >
            <CornerUpRight size={11} />
            <span>Disolver (X)</span>
          </button>

          {/* Eliminar Borde */}
          <button
            type="button"
            onClick={() => {
              const res = deleteSelectedEdges(selectedObjectId!, selectedEdgeIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedEdgeIndices.length < 2}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedEdgeIndices.length >= 2
                ? 'bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white border-rose-800 hover:border-rose-500'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Eliminar bordes seleccionados y sus caras (Supr)"
          >
            <Trash2 size={11} />
            <span>Eliminar</span>
          </button>
        </>
      )}

      {/* ── VERTEX / SHAPE EDIT HUD ── */}
      {!drawMode && editMode === 'VERTEX' && selectedObj && (
        <>
          <div className="w-px h-3.5 bg-white/10 mx-0.5" />
          <div className="flex items-center gap-1 text-zinc-400 font-medium text-[10px] pr-1">
            <CircleDot size={11} className="text-violet-400" />
            <span className="text-zinc-200 font-bold">
              {selectedVertexIndices.length > 0
                ? `${selectedVertexIndices.length} vtx`
                : 'Vértices'}
            </span>
          </div>

          {/* Conectar Vértices con Línea */}
          <button
            type="button"
            onClick={() => {
              const res = connectVertices(selectedObjectId!, selectedVertexIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedVertexIndices.length < 2}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedVertexIndices.length >= 2
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Conectar 2 vértices seleccionados creando una línea o dividiendo la cara (J)"
          >
            <Split size={11} />
            <span>Conectar Línea (J)</span>
          </button>

          {/* Extruir Vértice / Nuevo Segmento */}
          <button
            type="button"
            onClick={() => {
              const res = extrudeSelectedVertices(selectedObjectId!, selectedVertexIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedVertexIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedVertexIndices.length > 0
                ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Extruir vértices seleccionados creando nuevos segmentos (E)"
          >
            <ArrowUpRight size={11} />
            <span>Extruir (E)</span>
          </button>

          {/* Crear Cara */}
          <button
            type="button"
            onClick={() => {
              const res = createFaceFromVertices(selectedObjectId!, selectedVertexIndices);
              if (!res.success) alert(res.message);
            }}
            disabled={selectedVertexIndices.length < 3}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedVertexIndices.length >= 3
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-sm'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Crear cara poligonal a partir de 3 o más vértices (F)"
          >
            <Layers size={11} />
            <span>Crear Cara (F)</span>
          </button>

          {/* Soldar */}
          <button
            type="button"
            onClick={async () => {
              const res = await weldSelectedVertices(selectedObjectId!, selectedVertexIndices);
              alert(res.message);
            }}
            className="px-2 py-0.5 bg-zinc-900 hover:bg-indigo-600 text-zinc-200 hover:text-white border border-zinc-700 hover:border-indigo-500 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
            title="Soldar / Unir vértices seleccionados o cercanos (W)"
          >
            <Link2 size={11} />
            <span>Soldar (W)</span>
          </button>

          {/* Dividir en 2 */}
          {isShape && (
            <button
              type="button"
              onClick={() => {
                const res = subdivideShapeSegment(selectedObjectId!);
                alert(res.message);
              }}
              className="px-2 py-0.5 bg-zinc-900 hover:bg-violet-600 text-zinc-200 hover:text-white border border-zinc-700 hover:border-violet-500 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
              title="Dividir segmento en 2 (D)"
            >
              <Split size={11} />
              <span>Dividir (D)</span>
            </button>
          )}

          {/* Insertar */}
          {isShape && (
            <button
              type="button"
              onClick={() => setInsertVertexMode(!insertVertexMode)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
                insertVertexMode
                  ? 'bg-amber-600 text-white border-amber-400 shadow-sm'
                  : 'bg-zinc-900 text-zinc-200 border-zinc-700 hover:bg-zinc-800'
              }`}
              title="Haz clic sobre cualquier línea para insertar un vértice (I)"
            >
              <PlusCircle size={11} />
              <span>Insertar (I)</span>
            </button>
          )}

          {/* Eliminar Vértice */}
          <button
            type="button"
            onClick={() => {
              const res = deleteSelectedVertices(selectedObjectId!, selectedVertexIndices);
              if (!res.success) {
                alert(res.message);
              }
            }}
            disabled={selectedVertexIndices.length === 0}
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer border ${
              selectedVertexIndices.length > 0
                ? 'bg-rose-950/80 hover:bg-rose-600 text-rose-200 hover:text-white border-rose-800 hover:border-rose-500'
                : 'bg-zinc-900/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
            }`}
            title="Eliminar vértices seleccionados (Supr / Delete / Backspace)"
          >
            <Trash2 size={11} />
            <span>Eliminar (Supr)</span>
          </button>

          {/* Cerrar / Abrir Forma */}
          {isShape && (
            <button
              type="button"
              onClick={() => toggleShapeClosed(selectedObjectId!)}
              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-full text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
              title="Cerrar o abrir la línea (C)"
            >
              <span>{selectedObj?.parameters?.closed ? 'Abrir' : 'Cerrar (C)'}</span>
            </button>
          )}
        </>
      )}

      {/* Return to Object Mode button */}
      {!drawMode && editMode !== 'OBJECT' && (
        <button
          type="button"
          onClick={() => setEditMode('OBJECT')}
          className="ml-1 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors cursor-pointer"
          title="Salir al modo Objeto (Tecla 1 o Esc)"
        >
          <Box size={12} />
        </button>
      )}
    </div>
  );
};

