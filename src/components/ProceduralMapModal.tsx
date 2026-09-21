import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { MaterialData } from '../types';
import { safeFixed } from '../utils/numberUtils';
import {
  createNoiseTexture,
  createCheckerTexture,
  createWoodTexture,
  createOakPlanksTexture,
  createOakPlanksNormalMap,
  createOakPlanksRoughnessMap,
  createOakPlanksAOMap,
  createOakPlanksDisplacementMap,
  createThinFilmIridescenceTexture,
  createIridescenceThicknessTexture,
} from '../utils/proceduralTextures';

export interface ProceduralConfig {
  mapKey: keyof MaterialData;
  type: 'noise' | 'checker' | 'wood' | 'oak_planks' | 'thin_film' | 'iridescence_thickness';
  params: any;
}

interface ProceduralMapModalProps {
  config: ProceduralConfig;
  onClose: () => void;
  onApply: (dataUrl: string) => void;
}

export const ProceduralMapModal: React.FC<ProceduralMapModalProps> = ({ config, onClose, onApply }) => {
  const [params, setParams] = useState(config.params);
  const [previewUrl, setPreviewUrl] = useState('');
  // Normal map strength control (only visible for normalMap key)
  const [normalStrength, setNormalStrength] = useState(6.0);

  useEffect(() => {
    let url = '';
    if (config.type === 'noise') {
      url = createNoiseTexture(256, 256, params.scale || 20, params.intensity || 0.5, config.mapKey === 'normalMap');
    } else if (config.type === 'checker') {
      url = createCheckerTexture(256, 256, params.size || 8, params.color1 || '#ffffff', params.color2 || '#000000');
    } else if (config.type === 'wood') {
      url = createWoodTexture(256, 256, params.baseColor || '#8b5a2b', params.ringColor || '#5c3a21');
    } else if (config.type === 'oak_planks') {
      if (config.mapKey === 'normalMap')       url = createOakPlanksNormalMap(256, 256, normalStrength);
      else if (config.mapKey === 'roughnessMap')   url = createOakPlanksRoughnessMap(256, 256);
      else if (config.mapKey === 'aoMap')       url = createOakPlanksAOMap(256, 256);
      else if (config.mapKey === 'displacementMap') url = createOakPlanksDisplacementMap(256, 256);
      else url = createOakPlanksTexture(256, 256);
    } else if (config.type === 'thin_film') {
      url = createThinFilmIridescenceTexture(256, 256, params.scale || 3.5, 1.0, params.vibrancy || 1.2);
    } else if (config.type === 'iridescence_thickness') {
      url = createIridescenceThicknessTexture(256, 256, params.scale || 4.0, params.swirl || 1.5);
    }
    setPreviewUrl(url);
  }, [config.type, config.mapKey, params, normalStrength]);

  const handleApply = () => {
    let url = '';
    if (config.type === 'noise') {
      url = createNoiseTexture(512, 512, params.scale || 20, params.intensity || 0.5, config.mapKey === 'normalMap');
    } else if (config.type === 'checker') {
      url = createCheckerTexture(512, 512, params.size || 8, params.color1 || '#ffffff', params.color2 || '#000000');
    } else if (config.type === 'wood') {
      url = createWoodTexture(512, 512, params.baseColor || '#8b5a2b', params.ringColor || '#5c3a21');
    } else if (config.type === 'oak_planks') {
      if (config.mapKey === 'normalMap')       url = createOakPlanksNormalMap(512, 512, normalStrength);
      else if (config.mapKey === 'roughnessMap')   url = createOakPlanksRoughnessMap(512, 512);
      else if (config.mapKey === 'aoMap')       url = createOakPlanksAOMap(512, 512);
      else if (config.mapKey === 'displacementMap') url = createOakPlanksDisplacementMap(512, 512);
      else url = createOakPlanksTexture(512, 512);
    } else if (config.type === 'thin_film') {
      url = createThinFilmIridescenceTexture(512, 512, params.scale || 3.5, 1.0, params.vibrancy || 1.2);
    } else if (config.type === 'iridescence_thickness') {
      url = createIridescenceThicknessTexture(512, 512, params.scale || 4.0, params.swirl || 1.5);
    }
    onApply(url);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[#2b2b2b] border border-[#444] rounded-lg shadow-2xl w-full max-w-[400px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[#444] bg-[#333]">
          <h3 className="text-sm font-medium text-white capitalize">{config.type} Map Parameters</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
        </div>
        
        <div className="p-4 flex flex-col sm:flex-row gap-4">
          <div className="w-32 h-32 bg-black rounded border border-[#444] overflow-hidden shrink-0 mx-auto sm:mx-0">
            {previewUrl && <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />}
          </div>
          
          <div className="flex-1 space-y-3">
            {config.type === 'noise' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Scale ({params.scale || 20})</label>
                  <input type="range" min="1" max="100" value={params.scale || 20} onChange={e => setParams({...params, scale: Number(e.target.value)})} className="w-full accent-teal-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Intensity ({params.intensity || 0.5})</label>
                  <input type="range" min="0.1" max="2" step="0.1" value={params.intensity || 0.5} onChange={e => setParams({...params, intensity: Number(e.target.value)})} className="w-full accent-teal-500" />
                </div>
              </>
            )}
            
            {config.type === 'checker' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Grid Size ({params.size || 8})</label>
                  <input type="range" min="2" max="32" step="2" value={params.size || 8} onChange={e => setParams({...params, size: Number(e.target.value)})} className="w-full accent-teal-500" />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Color 1</label>
                    <input type="color" value={params.color1 || '#ffffff'} onChange={e => setParams({...params, color1: e.target.value})} className="w-full h-8 cursor-pointer rounded bg-[#222] border border-[#444]" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Color 2</label>
                    <input type="color" value={params.color2 || '#000000'} onChange={e => setParams({...params, color2: e.target.value})} className="w-full h-8 cursor-pointer rounded bg-[#222] border border-[#444]" />
                  </div>
                </div>
              </>
            )}
            
            {config.type === 'wood' && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Base Color</label>
                    <input type="color" value={params.baseColor || '#8b5a2b'} onChange={e => setParams({...params, baseColor: e.target.value})} className="w-full h-8 cursor-pointer rounded bg-[#222] border border-[#444]" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-400 mb-1">Ring Color</label>
                    <input type="color" value={params.ringColor || '#5c3a21'} onChange={e => setParams({...params, ringColor: e.target.value})} className="w-full h-8 cursor-pointer rounded bg-[#222] border border-[#444]" />
                  </div>
                </div>
              </>
            )}

            {/* Thin Film Iridescence controls */}
            {config.type === 'thin_film' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Escala de Ondas / Torbellinos ({params.scale || 3.5})</label>
                  <input type="range" min="1" max="12" step="0.5" value={params.scale || 3.5} onChange={e => setParams({...params, scale: Number(e.target.value)})} className="w-full accent-fuchsia-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Vibrancia Cromática ({params.vibrancy || 1.2})</label>
                  <input type="range" min="0.5" max="2.5" step="0.1" value={params.vibrancy || 1.2} onChange={e => setParams({...params, vibrancy: Number(e.target.value)})} className="w-full accent-fuchsia-500" />
                </div>
              </>
            )}

            {/* Iridescence Thickness Map controls */}
            {config.type === 'iridescence_thickness' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Frecuencia Espacial ({params.scale || 4.0})</label>
                  <input type="range" min="1" max="15" step="0.5" value={params.scale || 4.0} onChange={e => setParams({...params, scale: Number(e.target.value)})} className="w-full accent-fuchsia-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Turbulencia de Fluido ({params.swirl || 1.5})</label>
                  <input type="range" min="0.2" max="4.0" step="0.1" value={params.swirl || 1.5} onChange={e => setParams({...params, swirl: Number(e.target.value)})} className="w-full accent-fuchsia-500" />
                </div>
              </>
            )}

            {/* Normal map strength slider (oak_planks only) */}
            {config.type === 'oak_planks' && config.mapKey === 'normalMap' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Intensidad del Relieve ({safeFixed(normalStrength, 1)})
                </label>
                <input
                  type="range" min="1" max="15" step="0.5"
                  value={normalStrength}
                  onChange={e => setNormalStrength(Number(e.target.value))}
                  className="w-full accent-teal-500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Recomendado: 4–8 para madera natural
                </p>
              </div>
            )}
          </div>
        </div>
        
        <div className="p-3 border-t border-[#444] bg-[#333] flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-300 hover:text-white">Cancel</button>
          <button onClick={handleApply} className="px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-500 text-white rounded">Apply Map</button>
        </div>
      </div>
    </div>
  );
};