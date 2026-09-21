import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Trash2, Upload, Maximize2, Palette, Wand2, RefreshCw, 
  Check, SlidersHorizontal, Sparkles, Sun, Eye, Layers 
} from 'lucide-react';
import { adjustTextureColors, AlbedoColorAdjustments } from '../utils/textureColorUtils';
import { safeFixed } from '../utils/numberUtils';

interface MapEditorModalProps {
  title: string;
  url: string | null;
  intensity?: number;
  onIntensityChange?: (value: number) => void;
  repeat?: [number, number];
  onRepeatChange?: (v: [number, number]) => void;
  offset?: [number, number];
  onOffsetChange?: (v: [number, number]) => void;
  rotation?: number;
  onRotationChange?: (v: number) => void;
  onApplyToAllMaps?: (repeat: [number, number], offset: [number, number], rotation: number) => void;
  onClose: () => void;
  onUpdate: (url: string | null) => void;
}

const COLOR_PRESETS = [
  { name: 'Blanco Puro', color: '#ffffff', icon: '⚪' },
  { name: 'Oro 24K', color: '#f59e0b', icon: '🪙' },
  { name: 'Cobre / Bronce', color: '#ea580c', icon: '🥉' },
  { name: 'Azul Glacial / Zafiro', color: '#38bdf8', icon: '💎' },
  { name: 'Verde Esmeralda', color: '#10b981', icon: '🌲' },
  { name: 'Rojo Rubí', color: '#ef4444', icon: '🔴' },
  { name: 'Púrpura / Amatista', color: '#a855f7', icon: '🔮' },
  { name: 'Rosa Cuarzo', color: '#f43f5e', icon: '🌸' },
  { name: 'Cian Neón', color: '#06b6d4', icon: '⚡' },
  { name: 'Obsidiana / Carbón', color: '#18181b', icon: '🖤' },
];

export const MapEditorModal: React.FC<MapEditorModalProps> = ({ 
  title, url, intensity, onIntensityChange, 
  repeat = [1, 1], onRepeatChange,
  offset = [0, 0], onOffsetChange,
  rotation = 0, onRotationChange,
  onApplyToAllMaps,
  onClose, onUpdate 
}) => {
  // Estado para ajustes de color y textura
  const [activeTab, setActiveTab] = useState<'color' | 'transform'>('color');
  const [tintColor, setTintColor] = useState<string>('#38bdf8');
  const [tintAmount, setTintAmount] = useState<number>(0);
  const [hueShift, setHueShift] = useState<number>(0);
  const [saturation, setSaturation] = useState<number>(1);
  const [brightness, setBrightness] = useState<number>(1);
  const [contrast, setContrast] = useState<number>(1);
  const [invert, setInvert] = useState<boolean>(false);
  
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [appliedNotification, setAppliedNotification] = useState<string | null>(null);

  // URL procesada en tiempo real para preview de alta precisión
  const [previewUrl, setPreviewUrl] = useState<string | null>(url);
  const originalUrlRef = useRef<string | null>(url);

  // Actualizar preview en tiempo real usando adjustTextureColors
  useEffect(() => {
    if (!originalUrlRef.current) {
      setPreviewUrl(null);
      return;
    }

    const adjustments: AlbedoColorAdjustments = {
      tintColor,
      tintAmount,
      hueShift,
      saturation,
      brightness,
      contrast,
      invert,
    };

    let isMounted = true;
    adjustTextureColors(originalUrlRef.current, adjustments, 512, 512)
      .then((processed) => {
        if (isMounted) {
          setPreviewUrl(processed);
        }
      })
      .catch(() => {
        if (isMounted) setPreviewUrl(originalUrlRef.current);
      });

    return () => {
      isMounted = false;
    };
  }, [tintColor, tintAmount, hueShift, saturation, brightness, contrast, invert]);

  // Manejador para aplicar y guardar permanentemente el mapa con los nuevos colores
  const handleBakeAndApply = async () => {
    if (!originalUrlRef.current) return;
    setIsProcessing(true);
    try {
      const adjustments: AlbedoColorAdjustments = {
        tintColor,
        tintAmount,
        hueShift,
        saturation,
        brightness,
        contrast,
        invert,
      };
      // Hornear en alta resolución (1024x1024)
      const bakedUrl = await adjustTextureColors(originalUrlRef.current, adjustments, 1024, 1024);
      onUpdate(bakedUrl);
      originalUrlRef.current = bakedUrl;
      // Resetear sliders de ajuste relativo tras guardar
      setTintAmount(0);
      setHueShift(0);
      setSaturation(1);
      setBrightness(1);
      setContrast(1);
      setInvert(false);
      setAppliedNotification('¡Color y textura guardados correctamente!');
      setTimeout(() => setAppliedNotification(null), 2500);
    } catch (err) {
      console.error('Error al hornear mapa:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetAdjustments = () => {
    setTintAmount(0);
    setHueShift(0);
    setSaturation(1);
    setBrightness(1);
    setContrast(1);
    setInvert(false);
    setPreviewUrl(originalUrlRef.current);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newUrl = event.target?.result as string;
        originalUrlRef.current = newUrl;
        setPreviewUrl(newUrl);
        onUpdate(newUrl);
        handleResetAdjustments();
      };
      reader.readAsDataURL(file);
    }
  };

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-[#121216] border border-white/10 rounded-2xl shadow-2xl w-[95vw] max-w-5xl h-[92vh] max-h-[850px] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-[#17171d] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Palette size={16} />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <span>Modificador de Mapa:</span>
                <span className="text-indigo-400 font-mono">{title}</span>
              </h3>
              <p className="text-[10px] text-zinc-400">Cambia colores, tonalidades, saturación y escala de la textura</p>
            </div>
          </div>
          
          <button 
            onClick={onClose} 
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
        
        {/* Contenido Principal */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
          
          {/* Vista Previa de la Textura (Izquierda / Centro) */}
          <div className="flex-1 p-4 sm:p-6 flex flex-col items-center justify-center bg-[#0d0d10] min-h-0 relative">
            <div className="relative w-full h-full max-w-[500px] max-h-[500px] flex items-center justify-center">
              <div className="relative w-full h-full aspect-square bg-zinc-950 rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex items-center justify-center p-2">
                {previewUrl ? (
                  <img 
                    src={previewUrl} 
                    alt="Map Preview" 
                    className="w-full h-full object-contain rounded-xl transition-all duration-150" 
                    referrerPolicy="no-referrer" 
                    style={{ 
                      transform: `scale(${repeat[0]}, ${repeat[1]}) translate(${offset[0]}%, ${offset[1]}%) rotate(${rotation}deg)`
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                    <Maximize2 size={48} className="mb-3 opacity-20" />
                    <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Sin Mapa Asignado</span>
                  </div>
                )}
                
                {/* Overlay Informativo */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center pointer-events-none">
                  <div className="bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-lg">
                    <p className="text-[10px] font-bold text-zinc-300 tracking-wider flex items-center gap-1.5">
                      <Eye size={12} className="text-indigo-400" />
                      <span>Vista Previa en Vivo</span>
                    </p>
                  </div>
                  
                  {appliedNotification && (
                    <div className="bg-emerald-600/90 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 animate-in fade-in">
                      <Check size={12} />
                      <span>{appliedNotification}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Panel de Controles y Herramientas (Derecha) */}
          <div className="w-full lg:w-96 p-4 sm:p-5 lg:border-l border-white/10 flex flex-col gap-4 overflow-y-auto bg-[#15151a] custom-scrollbar flex-shrink-0">
            
            {/* Pestañas de Herramientas */}
            <div className="flex items-center p-1 bg-black/40 rounded-xl border border-white/5 gap-1">
              <button
                onClick={() => setActiveTab('color')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === 'color' 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Palette size={13} />
                <span>Color y Tinte</span>
              </button>
              
              <button
                onClick={() => setActiveTab('transform')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                  activeTab === 'transform' 
                    ? 'bg-indigo-600 text-white shadow-md' 
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <SlidersHorizontal size={13} />
                <span>Transformación</span>
              </button>
            </div>

            {/* TAB 1: COLOR Y TINTE */}
            {activeTab === 'color' && (
              <div className="space-y-4">
                
                {/* Presets Rápidos de Color */}
                <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                    <Sparkles size={11} className="text-amber-400" />
                    <span>Presets Rápidos de Color</span>
                  </span>
                  
                  <div className="grid grid-cols-5 gap-1.5">
                    {COLOR_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setTintColor(preset.color);
                          setTintAmount(0.85);
                        }}
                        className="p-1.5 rounded-lg bg-black/30 hover:bg-indigo-600/30 border border-white/5 hover:border-indigo-500/40 flex flex-col items-center gap-1 transition-all active:scale-95 group"
                        title={`Aplicar tinte ${preset.name}`}
                      >
                        <div 
                          className="w-5 h-5 rounded-full border border-white/20 shadow-sm"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className="text-[8px] text-zinc-400 group-hover:text-white truncate w-full text-center">
                          {preset.name.split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tinte Personalizado & Intensidad */}
                <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                      <Wand2 size={12} className="text-indigo-400" />
                      <span>Tinte de Color Personalizado</span>
                    </span>
                    <button
                      onClick={handleResetAdjustments}
                      className="text-[9px] font-bold text-zinc-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
                      title="Restablecer todos los colores"
                    >
                      <RefreshCw size={10} />
                      <span>Resetear</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400 font-semibold">Color del Tinte</label>
                      <div className="flex items-center gap-2 bg-black/40 p-1.5 rounded-lg border border-white/10">
                        <input 
                          type="color" 
                          value={tintColor}
                          onChange={e => {
                            setTintColor(e.target.value);
                            if (tintAmount === 0) setTintAmount(0.75);
                          }}
                          className="w-6 h-6 rounded cursor-pointer bg-transparent border-none"
                        />
                        <span className="text-[10px] font-mono text-zinc-200 uppercase">{tintColor}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[9px]">
                        <label className="text-zinc-400 font-semibold">Intensidad Tinte</label>
                        <span className="font-mono text-indigo-400 font-bold">{safeFixed(tintAmount * 100, 0)}%</span>
                      </div>
                      <input 
                        type="range" min="0" max="1" step="0.02"
                        value={tintAmount}
                        onChange={e => setTintAmount(parseFloat(e.target.value))}
                        className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer mt-2"
                      />
                    </div>
                  </div>
                </div>

                {/* Desplazamiento Tonal (Hue Shift) */}
                <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-2">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-bold text-zinc-300">Desplazamiento Tonal (Hue Shift)</span>
                    <span className="font-mono text-cyan-400 font-bold">{hueShift}°</span>
                  </div>
                  <input 
                    type="range" min="-180" max="180" step="1"
                    value={hueShift}
                    onChange={e => setHueShift(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-400 h-1 bg-gradient-to-r from-red-500 via-green-500 via-blue-500 to-red-500 rounded-lg cursor-pointer"
                  />
                  <p className="text-[8px] text-zinc-400 italic">
                    Gira toda la rueda cromática para cambiar el color global de forma natural.
                  </p>
                </div>

                {/* Saturación, Brillo y Contraste */}
                <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-3">
                  {/* Saturación */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400 font-semibold">Saturación</span>
                      <span className="font-mono text-zinc-200">{safeFixed(saturation * 100, 0)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.05"
                      value={saturation}
                      onChange={e => setSaturation(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Brillo */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400 font-semibold">Brillo</span>
                      <span className="font-mono text-zinc-200">{safeFixed(brightness * 100, 0)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.05"
                      value={brightness}
                      onChange={e => setBrightness(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Contraste */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400 font-semibold">Contraste</span>
                      <span className="font-mono text-zinc-200">{safeFixed(contrast * 100, 0)}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="2" step="0.05"
                      value={contrast}
                      onChange={e => setContrast(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Invertir */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <span className="text-[9px] text-zinc-400 font-semibold">Invertir Colores</span>
                    <button
                      onClick={() => setInvert(v => !v)}
                      className={`px-2 py-0.5 rounded text-[9px] font-bold transition-colors ${
                        invert ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {invert ? 'ACTIVADO' : 'DESACTIVADO'}
                    </button>
                  </div>
                </div>

                {/* Botón Guardar / Hornear Textura */}
                <button
                  onClick={handleBakeAndApply}
                  disabled={isProcessing || !url}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50"
                >
                  <Check size={14} />
                  <span>{isProcessing ? 'Procesando Textura...' : 'Guardar y Aplicar Color al Material'}</span>
                </button>
              </div>
            )}

            {/* TAB 2: TRANSFORMACIÓN (REPETICIÓN, OFFSET, ROTACIÓN) */}
            {activeTab === 'transform' && (
              <div className="space-y-4">
                {onIntensityChange !== undefined && (
                  <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-300 font-bold uppercase">Intensidad del Mapa</span>
                      <span className="text-[10px] font-mono text-indigo-400">{safeFixed(intensity, 2)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="2" 
                      step="0.01" 
                      value={intensity || 0} 
                      onChange={(e) => onIntensityChange(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                )}

                <div className="p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Escala (Repetición UV)</span>
                    <button 
                      onClick={() => {
                        onRepeatChange?.([1, 1]);
                        onOffsetChange?.([0, 0]);
                        onRotationChange?.(0);
                      }}
                      className="text-[9px] font-bold text-indigo-400 hover:text-indigo-300 uppercase transition-colors"
                    >
                      Resetear
                    </button>
                  </div>

                  {/* Repetir X */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400">Repetir X</span>
                      <span className="font-mono text-indigo-400">{safeFixed(repeat?.[0], 1)}x</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="10" step="0.1" 
                      value={repeat?.[0] ?? 1} 
                      onChange={(e) => onRepeatChange?.([parseFloat(e.target.value), repeat?.[1] ?? 1])}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Repetir Y */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400">Repetir Y</span>
                      <span className="font-mono text-indigo-400">{safeFixed(repeat?.[1], 1)}x</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="10" step="0.1" 
                      value={repeat?.[1] ?? 1} 
                      onChange={(e) => onRepeatChange?.([repeat?.[0] ?? 1, parseFloat(e.target.value)])}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Offset X */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400">Desplazamiento X</span>
                      <span className="font-mono text-indigo-400">{safeFixed(offset?.[0], 2)}</span>
                    </div>
                    <input 
                      type="range" min="-1" max="1" step="0.01" 
                      value={offset?.[0] ?? 0} 
                      onChange={(e) => onOffsetChange?.([parseFloat(e.target.value), offset?.[1] ?? 0])}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Offset Y */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400">Desplazamiento Y</span>
                      <span className="font-mono text-indigo-400">{safeFixed(offset?.[1], 2)}</span>
                    </div>
                    <input 
                      type="range" min="-1" max="1" step="0.01" 
                      value={offset[1]} 
                      onChange={(e) => onOffsetChange?.([offset[0], parseFloat(e.target.value)])}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Rotación */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-zinc-400">Rotación</span>
                      <span className="font-mono text-indigo-400">{rotation}°</span>
                    </div>
                    <input 
                      type="range" min="0" max="360" step="1" 
                      value={rotation} 
                      onChange={(e) => onRotationChange?.(parseFloat(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                </div>

                {onApplyToAllMaps && (
                  <button
                    onClick={() => onApplyToAllMaps(repeat, offset, rotation)}
                    className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl transition-all text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
                  >
                    <Layers size={12} />
                    <span>Aplicar Escala a Todos los Mapas</span>
                  </button>
                )}
              </div>
            )}

            {/* Acciones de Archivo */}
            <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-2 mt-auto">
              <label className="flex items-center justify-center gap-1.5 p-2 bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 rounded-xl cursor-pointer transition-all text-[10px] font-bold">
                <Upload size={12} className="text-indigo-400" />
                <span>Cargar Imagen</span>
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </label>
              
              {url && (
                <button 
                  onClick={() => {
                    onUpdate(null);
                    onClose();
                  }}
                  className="flex items-center justify-center gap-1.5 p-2 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 rounded-xl transition-all text-[10px] font-bold"
                >
                  <Trash2 size={12} />
                  <span>Quitar Mapa</span>
                </button>
              )}
            </div>

            <button 
              onClick={onClose} 
              className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-bold uppercase tracking-wider rounded-xl transition-all border border-white/10 shadow-lg"
            >
              Cerrar Editor
            </button>
          </div>
        </div>
      </div>
    </div>,
    modalRoot
  );
};
