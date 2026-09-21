import React, { useState } from 'react';
import { 
  Box, Circle, Cylinder, Triangle, Hexagon, Spline, Waves, Orbit, 
  Sparkles, Cone, Cloud, Wind, Flame, Zap, Compass, ArrowDown, Magnet, Shield, Disc, Droplets
} from 'lucide-react';
import { PrimitiveType, VolumetricConfig, ParticleSystemConfig, SpaceWarpConfig } from '../types';
import { useStore } from '../store/useStore';
import { VOLUMETRIC_PRESETS } from '../utils/volumetricRaymarch';
import { PARTICLE_PRESETS, SPACE_WARP_PRESETS } from '../utils/particleSystem';

interface ShapeItemProps {
  type: PrimitiveType;
  label: string;
  icon: React.ReactNode;
  color: string;
  desc?: string;
  customVolumetric?: VolumetricConfig;
  customParticle?: Partial<ParticleSystemConfig>;
  customWarp?: Partial<SpaceWarpConfig>;
  customParams?: Record<string, any>;
}

const ShapeItem: React.FC<ShapeItemProps> = ({ 
  type, label, icon, color, desc, customVolumetric, customParticle, customWarp, customParams 
}) => {
  const addObject = useStore(s => s.addObject);
  const updateObject = useStore(s => s.updateObject);
  const saveHistory = useStore(s => s.saveHistory);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('shapeType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleAdd = () => {
    addObject(type);
    const selId = useStore.getState().selectedObjectId;
    if (selId) {
      const updates: any = {};
      if (customVolumetric) {
        updates.isVolumetric = true;
        updates.volumetric = customVolumetric;
        updates.color = customVolumetric.color || '#ffffff';
        updates.parameters = { isVolumetric: true, volumetric: customVolumetric };
      }
      if (customParticle) {
        updates.isParticleSystem = true;
        updates.particleConfig = customParticle;
        updates.parameters = { isParticleSystem: true, particleConfig: customParticle };
      }
      if (customWarp) {
        updates.isSpaceWarp = true;
        updates.warpConfig = customWarp;
        updates.parameters = { isSpaceWarp: true, warpConfig: customWarp };
      }
      if (customParams) {
        updates.parameters = { ...(useStore.getState().project.objects.find(o => o.id === selId)?.parameters || {}), ...customParams };
      }
      if (Object.keys(updates).length > 0) {
        updateObject(selId, {
          name: `${label} ${useStore.getState().project.objects.length}`,
          ...updates,
        });
        saveHistory();
      }
    }
  };

  return (
    <div 
      draggable 
      onDragStart={handleDragStart}
      onClick={handleAdd}
      className="flex flex-col items-center gap-1.5 p-2 cursor-pointer active:cursor-grabbing hover:bg-zinc-800/80 rounded-lg border border-transparent hover:border-zinc-700 transition-all group"
      title={`Añadir ${label} (o arrastra al visor 3D)`}
    >
      <div 
        className="w-11 h-11 rounded-lg shadow-sm flex items-center justify-center transition-transform group-hover:scale-105"
        style={{ backgroundColor: color }}
      >
        <div className="text-white/90 drop-shadow-md">
          {icon}
        </div>
      </div>
      <span className="text-[10px] text-zinc-300 font-medium text-center leading-tight">{label}</span>
      {desc && <span className="text-[8px] text-zinc-500 text-center leading-none">{desc}</span>}
    </div>
  );
};

export const ShapesPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'MESH' | 'PARTICLES' | 'NURBS' | 'VOLUME' | 'TEXTURES'>('MESH');
  const project = useStore(s => s.project);
  const setViewMode = useStore(s => s.setViewMode);
  const updateObject = useStore(s => s.updateObject);
  const saveHistory = useStore(s => s.saveHistory);

  const DEFAULT_TEXTURES = [
    'https://picsum.photos/seed/wood/512',
    'https://picsum.photos/seed/metal/512',
    'https://picsum.photos/seed/stone/512',
    'https://picsum.photos/seed/fabric/512',
    'https://picsum.photos/seed/concrete/512',
    'https://picsum.photos/seed/grass/512',
    'https://picsum.photos/seed/brick/512',
    'https://picsum.photos/seed/marble/512',
  ];

  return (
    <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col">
      {/* Category Tabs */}
      <div className="grid grid-cols-5 border-b border-zinc-800 bg-zinc-950 text-[8.5px]">
        <button
          onClick={() => setActiveTab('MESH')}
          className={`py-2 font-bold tracking-wider uppercase transition-colors ${
            activeTab === 'MESH' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-zinc-900/60' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Mallas
        </button>
        <button
          onClick={() => setActiveTab('PARTICLES')}
          className={`py-2 font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-0.5 ${
            activeTab === 'PARTICLES' ? 'text-purple-400 border-b-2 border-purple-500 bg-zinc-900/60' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Sparkles size={9} />
          FX
        </button>
        <button
          onClick={() => setActiveTab('NURBS')}
          className={`py-2 font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-0.5 ${
            activeTab === 'NURBS' ? 'text-cyan-400 border-b-2 border-cyan-500 bg-zinc-900/60' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Waves size={9} />
          NURBS
        </button>
        <button
          onClick={() => setActiveTab('VOLUME')}
          className={`py-2 font-bold tracking-wider uppercase transition-colors flex items-center justify-center gap-0.5 ${
            activeTab === 'VOLUME' ? 'text-sky-400 border-b-2 border-sky-500 bg-zinc-900/60' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Cloud size={9} />
          Nubes
        </button>
        <button
          onClick={() => setActiveTab('TEXTURES')}
          className={`py-2 font-bold tracking-wider uppercase transition-colors ${
            activeTab === 'TEXTURES' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-zinc-900/60' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Texturas
        </button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {activeTab === 'MESH' && (
          <div className="grid grid-cols-2 gap-2">
            <ShapeItem type="GEOSPHERE" label="GeoEsfera" color="#0284c7" desc="Geodésica 3ds Max" icon={<Disc size={22} />} />
            <ShapeItem type="SPHERE" label="Esfera UV" color="#3b82f6" desc="Rebanable / Casquete" icon={<Circle size={22} />} />
            <ShapeItem type="CUBE" label="Cubo" color="#ef4444" icon={<Box size={22} />} />
            <ShapeItem type="CYLINDER" label="Cilindro" color="#f97316" icon={<Cylinder size={22} />} />
            <ShapeItem type="CONE" label="Cono" color="#a855f7" icon={<Triangle size={22} />} />
            <ShapeItem type="PYRAMID" label="Pirámide" color="#eab308" icon={<Triangle size={22} />} />
            <ShapeItem type="PRISM" label="Prisma" color="#10b981" icon={<Triangle size={22} className="rotate-90" />} />
            <ShapeItem type="CAPSULE" label="Cápsula" color="#14b8a6" icon={<Cylinder size={22} className="rounded-full" />} />
            <ShapeItem type="TORUS" label="Toroide" color="#ec4899" icon={<Circle size={18} strokeWidth={4} />} />
            <ShapeItem type="ICOSAHEDRON" label="Icosaedro" color="#06b6d4" icon={<Hexagon size={22} />} />
            <ShapeItem type="DODECAHEDRON" label="Dodecaedro" color="#6366f1" icon={<Hexagon size={22} className="rotate-45" />} />
            <ShapeItem type="TETRAHEDRON" label="Tetraedro" color="#f43f5e" icon={<Triangle size={22} />} />
            <ShapeItem type="OCTAHEDRON" label="Octaedro" color="#8b5cf6" icon={<Hexagon size={22} />} />
            <ShapeItem type="TUBE" label="Tubo 3D" color="#8b5cf6" icon={<Circle size={22} strokeWidth={8} />} />
            <ShapeItem type="ARC" label="Arco 3D" color="#14b8a6" icon={<Circle size={22} strokeWidth={6} />} />
            <ShapeItem type="STAR" label="Estrella 3D" color="#eab308" icon={<Hexagon size={22} />} />
            <ShapeItem type="WEDGE" label="Cuña" color="#64748b" icon={<Triangle size={22} className="rotate-180" />} />
            <ShapeItem type="HEMISPHERE" label="Hemisferio" color="#0284c7" icon={<Circle size={22} />} />
            <ShapeItem type="PLANE" label="Plano" color="#10b981" icon={<Box size={22} className="scale-y-25" />} />
            <ShapeItem type="RING" label="Anillo" color="#d946ef" icon={<Circle size={22} strokeWidth={4} />} />
          </div>
        )}

        {activeTab === 'PARTICLES' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Sparkles size={13} className="text-purple-400" />
                <span className="text-[11px] font-bold text-purple-300">Sistemas de Partículas</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PARTICLE_PRESETS.map((p) => (
                  <ShapeItem
                    key={p.id}
                    type="PARTICLE_SYSTEM"
                    label={p.name}
                    color="#8b5cf6"
                    desc={p.desc}
                    icon={<span className="text-base">{p.icon}</span>}
                    customParticle={p.config}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Compass size={13} className="text-amber-400" />
                <span className="text-[11px] font-bold text-amber-300">Deformadores Espaciales (Space Warps)</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SPACE_WARP_PRESETS.map((w) => (
                  <ShapeItem
                    key={w.id}
                    type="SPACE_WARP"
                    label={w.name}
                    color="#f59e0b"
                    desc={w.desc}
                    icon={<span className="text-base">{w.icon}</span>}
                    customWarp={w.config}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'NURBS' && (
          <div className="space-y-3">
            <div className="bg-cyan-950/30 border border-cyan-800/40 rounded-lg p-2.5">
              <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5 mb-1">
                <Sparkles size={13} />
                Primitivas NURBS Avanzadas
              </span>
              <p className="text-[9px] text-cyan-400/80 leading-relaxed">
                Geometría matemática B-Spline exacta no uniforme con jaula de control (Hull) y pesos racionales.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ShapeItem type="NURBS_CURVE" label="Curva NURBS" color="#06b6d4" desc="Spline B-Spline" icon={<Spline size={22} />} />
              <ShapeItem type="NURBS_CIRCLE" label="Círculo NURBS" color="#0ea5e9" desc="Racional Exacto" icon={<Orbit size={22} />} />
              <ShapeItem type="NURBS_SURFACE" label="Superficie Patch" color="#14b8a6" desc="Malla Cuadrática" icon={<Waves size={22} />} />
              <ShapeItem type="NURBS_CYLINDER" label="Cilindro NURBS" color="#0284c7" desc="Superficie Cilíndrica" icon={<Cylinder size={22} />} />
              <ShapeItem type="NURBS_CONE" label="Cono NURBS" color="#f59e0b" desc="Cono Racional" icon={<Cone size={22} />} />
              <ShapeItem type="NURBS_SPHERE" label="Esfera NURBS" color="#3b82f6" desc="Esfera Racional" icon={<Circle size={22} />} />
              <ShapeItem type="NURBS_TORUS" label="Toroide NURBS" color="#8b5cf6" desc="Toroide Continuo" icon={<Circle size={18} strokeWidth={4} />} />
            </div>
          </div>
        )}

        {activeTab === 'VOLUME' && (
          <div className="space-y-3">
            <div className="bg-sky-950/40 border border-sky-800/40 rounded-lg p-2.5">
              <span className="text-[11px] font-bold text-sky-300 flex items-center gap-1.5 mb-1">
                <Cloud size={13} />
                Nubes 3D & Dispersión Atmosférica 2026
              </span>
              <p className="text-[9px] text-sky-400/80 leading-relaxed">
                Dispersión Mie interna, crestas plateadas con ángulo de fase Henyey-Greenstein, ruido Worley-Perlin dual y absorción Beer-Lambert.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {VOLUMETRIC_PRESETS.map((p) => (
                <ShapeItem 
                  key={p.id}
                  type="VOLUME_CLOUD" 
                  label={p.name} 
                  color={p.config.mode === 'fire' || p.config.mode === 'explosion' ? '#ef4444' : p.config.mode === 'plasma' ? '#06b6d4' : '#0284c7'} 
                  desc={p.desc}
                  icon={<span className="text-base">{p.icon}</span>}
                  customVolumetric={p.config}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'TEXTURES' && (
          <div className="grid grid-cols-2 gap-2">
            {DEFAULT_TEXTURES.map((url, i) => (
              <div 
                key={i}
                className="aspect-square bg-zinc-800 rounded border border-zinc-700 overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors relative group"
                onClick={() => {
                  const selId = useStore.getState().selectedObjectId;
                  if (selId) {
                    const obj = project.objects.find(o => o.id === selId);
                    if (obj) {
                      const m = obj.material || {};
                      updateObject(selId, { material: { ...m, map: url } });
                      setViewMode('TEXTURED');
                      saveHistory();
                    }
                  }
                }}
              >
                <img src={url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-[8px] text-white font-bold uppercase">Aplicar</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
