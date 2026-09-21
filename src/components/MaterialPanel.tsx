import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { MaterialData } from '../types';
import { MaterialThumbnail } from './MaterialThumbnail';
import { 
  Settings, 
  Palette, 
  Layers, 
  Droplets, 
  Sun, 
  Eye, 
  Trash2, 
  Plus, 
  Upload,
  Box,
  Zap,
  ArrowLeft,
  Download,
  FileUp,
  FolderOpen,
  AlertTriangle,
  CheckCircle,
  X,
  Search,
  Sparkles,
  Grid,
  Disc,
  Feather,
  Shield,
  Gem,
  Glasses,
  Flame,
  ChevronDown,
  ChevronRight,
  Sliders,
  RotateCw,
  Copy,
  Image as ImageIcon, Cloud,
  Check,
  Link as LinkIcon,
  Unlink,
  Wand2,
  SlidersHorizontal,
  RefreshCw,
  Cpu,
  Code,
  Waves
} from 'lucide-react';
import { adjustTextureColors, AlbedoColorAdjustments, generateFullPBRMapsFromSource } from '../utils/textureColorUtils';
import { createORMMap, extractPBRMaterialFromGLTFOrOBJ, extractPBRMaterialsFromObject3D } from '../utils/materialUtils';
import { applyUVWMapping, generateUVs } from '../utils/modifiers';
import { importPBRPack, detectSlotFromFilename, importTextureFile } from '../utils/materialImporter';
import { CSM_PRESETS } from '../utils/customShaderMaterial';
import { WEBGPU_GLASS_PRESETS } from '../utils/webgpuGlassMaterial';
import { 
  MATERIAL_LIBRARY, 
  MATERIAL_CATEGORIES, 
  generateMaterial, 
  generateMaterialWithFilters,
  applyImperfectionsToCustomMaps,
  MaterialFilters,
  generateAllThumbnails,
  generateAllThumbnailsAsync,
  ProceduralMaterial,
  createThinFilmIridescenceTexture,
  createIridescenceThicknessTexture
} from '../utils/proceduralTextures';
import { MapEditorModal } from './MapEditorModal';
import { ProceduralMapModal, ProceduralConfig } from './ProceduralMapModal';

// ── Presets Físicos Calibrados de Acceso Rápido ────────────────────────────
const PHYSICALLY_CALIBRATED_PRESETS: {
  name: string;
  category: string;
  icon: string;
  description: string;
  apply: Partial<MaterialData>;
}[] = [
  // Metales PBR (Substance 3D Core)
  {
    name: 'Oro 24K',
    category: 'Metales',
    icon: '🪙',
    description: 'Metal noble reflectante calibrado',
    apply: { color: '#ffd700', metalness: 1.0, roughness: 0.08, specularIntensity: 1.0, clearcoat: 0, transmission: 0, sheen: 0, anisotropy: 0, iridescence: 0 }
  },
  {
    name: 'Acero de Damasco (Substance)',
    category: 'Metales',
    icon: '🗡️',
    description: 'Pliegues de forja con anisotropía a 45°',
    apply: { color: '#cbd5e1', metalness: 1.0, roughness: 0.22, specularIntensity: 1.0, anisotropy: 0.75, anisotropyRotation: 45, normalScale: 1.8 }
  },
  {
    name: 'Bronce con Pátina (Substance)',
    category: 'Metales',
    icon: '🏛️',
    description: 'Bronce envejecido con cardenillo turquesa',
    apply: { color: '#a87343', metalness: 0.8, roughness: 0.42, specularIntensity: 0.9, normalScale: 2.2 }
  },
  {
    name: 'Hierro Fundido Forjado (Substance)',
    category: 'Metales',
    icon: '🔨',
    description: 'Textura granulada de fundición al carbono',
    apply: { color: '#27272a', metalness: 0.95, roughness: 0.62, specularIntensity: 0.8, normalScale: 2.5 }
  },
  {
    name: 'Titanio Anodizado Arcoíris (Substance)',
    category: 'Metales',
    icon: '🌈',
    description: 'Titanio electroquímico con interferencia óptica',
    apply: { color: '#e2e8f0', metalness: 1.0, roughness: 0.12, iridescence: 1.0, iridescenceIOR: 2.2, iridescenceThicknessRange: [200, 750] }
  },
  {
    name: 'Blindaje Sci-Fi Hull (Substance)',
    category: 'Metales',
    icon: '🚀',
    description: 'Paneles de blindaje modular para naves',
    apply: { color: '#475569', metalness: 0.9, roughness: 0.35, clearcoat: 0.3, normalScale: 3.0 }
  },
  {
    name: 'Cobre Puro',
    category: 'Metales',
    icon: '🥉',
    description: 'Cobre pulido con reflectancia física',
    apply: { color: '#f5957a', metalness: 1.0, roughness: 0.15, specularIntensity: 1.0, transmission: 0 }
  },
  {
    name: 'Acero Inox Cepillado',
    category: 'Metales',
    icon: '⚙️',
    description: 'Anisotropía con reflejos estirados',
    apply: { color: '#e5e7eb', metalness: 0.95, roughness: 0.28, anisotropy: 0.85, anisotropyRotation: 0, transmission: 0 }
  },
  {
    name: 'Cromo Espejo',
    category: 'Metales',
    icon: '🪞',
    description: 'Reflexión pura sin difusión',
    apply: { color: '#ffffff', metalness: 1.0, roughness: 0.02, clearcoat: 0, transmission: 0 }
  },
  {
    name: 'Disco Vinilo / Radial',
    category: 'Metales',
    icon: '💿',
    description: 'Surcos circulares con anisotropía a 90°',
    apply: { color: '#18181b', metalness: 0.75, roughness: 0.3, anisotropy: 1.0, anisotropyRotation: 90, transmission: 0 }
  },

  // Maderas & Arquitectura (Substance 3D)
  {
    name: 'Shou Sugi Ban Quemado (Substance)',
    category: 'Madera & Piedra',
    icon: '🔥',
    description: 'Madera de cedro carbonizada a fuego vivo',
    apply: { color: '#18181b', metalness: 0.1, roughness: 0.78, normalScale: 3.5, displacementScale: 0.05 }
  },
  {
    name: 'Teca Marina de Cubierta (Substance)',
    category: 'Madera & Piedra',
    icon: '⛵',
    description: 'Listones aceitados con juntas de calafateo',
    apply: { color: '#b45309', metalness: 0.0, roughness: 0.38, normalScale: 1.5, specularIntensity: 0.7 }
  },
  {
    name: 'Bambú Tejido / Rattan (Substance)',
    category: 'Madera & Piedra',
    icon: '🎋',
    description: 'Esterilla de bambú trenzado natural',
    apply: { color: '#d97706', metalness: 0.0, roughness: 0.42, normalScale: 2.8, sheen: 0.3 }
  },
  {
    name: 'Corcho Natural Prensado (Substance)',
    category: 'Madera & Piedra',
    icon: '🍾',
    description: 'Aglomerado de corteza porosa mate',
    apply: { color: '#b45309', metalness: 0.0, roughness: 0.88, normalScale: 3.2 }
  },
  {
    name: 'Hormigón Visto Encofrado (Substance)',
    category: 'Madera & Piedra',
    icon: '🏢',
    description: 'Hormigón arquitectónico con veta de madera',
    apply: { color: '#94a3b8', metalness: 0.0, roughness: 0.75, normalScale: 2.0 }
  },
  {
    name: 'Terrazo Veneciano Pulido (Substance)',
    category: 'Madera & Piedra',
    icon: '🪨',
    description: 'Aglomerado de mármol con barniz vítreo',
    apply: { color: '#f8fafc', metalness: 0.0, roughness: 0.15, clearcoat: 0.85, clearcoatRoughness: 0.05, normalScale: 0.4 }
  },
  {
    name: 'Ladrillo Rústico Artesanal (Substance)',
    category: 'Madera & Piedra',
    icon: '🧱',
    description: 'Terracota cocida con mortero arenoso',
    apply: { color: '#b91c1c', metalness: 0.0, roughness: 0.85, normalScale: 3.5, displacementScale: 0.04 }
  },
  {
    name: 'Piedra Caliza Travertino Porosa',
    category: 'Madera & Piedra',
    icon: '🪨',
    description: 'Piedra natural con microcavidades y zonas mates no reflectantes',
    apply: {
      color: '#e2d9cc',
      metalness: 0.0,
      roughness: 0.78,
      normalScale: 2.2,
      porosity: true,
      porosityStrength: 0.95,
      porosityScale: 16.0,
      porosityPatchiness: 0.70,
      porosityPatchScale: 3.0,
      porosityMatteBias: 0.95,
      porosityCavityDarkening: 0.35,
    }
  },
  {
    name: 'Terracota / Barro Poroso',
    category: 'Madera & Piedra',
    icon: '🏺',
    description: 'Arcilla cocida artesanal con acabado poroso mate natural',
    apply: {
      color: '#c25e36',
      metalness: 0.0,
      roughness: 0.82,
      normalScale: 1.8,
      porosity: true,
      porosityStrength: 0.85,
      porosityScale: 22.0,
      porosityPatchiness: 0.45,
      porosityPatchScale: 2.5,
      porosityMatteBias: 0.90,
      porosityCavityDarkening: 0.28,
    }
  },
  {
    name: 'Mármol Calacatta Gold (Substance)',
    category: 'Madera & Piedra',
    icon: '🏛️',
    description: 'Mármol blanco puro con vetas ocres y grises',
    apply: { color: '#ffffff', metalness: 0.0, roughness: 0.08, clearcoat: 0.9, clearcoatRoughness: 0.04, normalScale: 0.6 }
  },

  // ── Pack Procedural Hielo y Nieve (Física Realista / IOR 1.31 / Beer-Lambert) ─────────────────
  {
    name: 'Cubo de Hielo Físico (Beer-Lambert PBR)',
    category: 'Hielo & Nieve',
    icon: '🧊',
    description: 'Masa tridimensional real: IOR 1.31, absorción volumétrica baja (0.45), atenuación cian profunda y refracción HDRI',
    apply: {
      color: '#ffffff',
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.99,
      ior: 1.31,
      thickness: 2.0,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.45,
      dispersion: 0.035,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: false,
      opacity: 1,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.04,
        cloudDensity: 1.2,
        cloudColor: '#edf7fd',
        cloudScale: 2.6,
        frostIntensity: 0.75,
        crackIntensity: 0.85,
      }
    }
  },
  {
    name: 'Hielo Antártico Orgánico Poroso',
    category: 'Hielo & Nieve',
    icon: '🧊',
    description: 'Hielo natural con zonas porosas no reflectantes, microburbujas y escarcha',
    apply: {
      color: '#f0f9ff',
      roughness: 0.22,
      metalness: 0.0,
      transmission: 0.90,
      ior: 1.31,
      thickness: 2.2,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.50,
      dispersion: 0.03,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      transparent: false,
      opacity: 1,
      porosity: true,
      porosityStrength: 0.80,
      porosityScale: 22.0,
      porosityPatchiness: 0.75,
      porosityPatchScale: 3.5,
      porosityMatteBias: 0.90,
      porosityCavityDarkening: 0.15,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.08,
        cloudDensity: 1.6,
        cloudColor: '#e0f2fe',
        cloudScale: 2.8,
        frostIntensity: 0.9,
        crackIntensity: 0.95,
      }
    }
  },
  {
    name: 'Hielo Glacial Puro (CGTrader PBR)',
    category: 'Hielo & Nieve',
    icon: '🧊',
    description: '100% Transmisión, IOR 1.31, volumen sólido Beer-Lambert y atenuación azul glaciar',
    apply: {
      color: '#ffffff',
      roughness: 0.04,
      metalness: 0.0,
      transmission: 1.0,
      ior: 1.31,
      thickness: 2.2,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.45,
      dispersion: 0.035,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: false,
      opacity: 1,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.03,
        cloudDensity: 1.1,
        cloudColor: '#f0f9ff',
        cloudScale: 2.4,
        frostIntensity: 0.6,
        crackIntensity: 0.75,
      }
    }
  },
  {
    name: 'Hielo con Escarcha Superficial',
    category: 'Hielo & Nieve',
    icon: '❄️',
    description: 'Cristales dendríticos de escarcha y zonas cristalinas transparentes',
    apply: {
      color: '#ffffff',
      roughness: 0.16,
      metalness: 0.0,
      transmission: 0.94,
      ior: 1.31,
      thickness: 2.0,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.60,
      dispersion: 0.025,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08,
      transparent: false,
      opacity: 1,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.05,
        cloudDensity: 1.3,
        cloudColor: '#e0f2fe',
        cloudScale: 2.6,
        frostIntensity: 1.1,
        crackIntensity: 0.8,
      }
    }
  },
  {
    name: 'Hielo Fisurado de Lago',
    category: 'Hielo & Nieve',
    icon: '💎',
    description: 'Red profunda de grietas de tensión y microburbujas bajo superficie lisa',
    apply: {
      color: '#ffffff',
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.98,
      ior: 1.31,
      thickness: 2.5,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.40,
      dispersion: 0.03,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: false,
      opacity: 1,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.04,
        cloudDensity: 1.2,
        cloudColor: '#edf7fd',
        cloudScale: 2.8,
        frostIntensity: 0.7,
        crackIntensity: 1.3,
      }
    }
  },
  {
    name: 'Nieve Fresca / Polvo',
    category: 'Hielo & Nieve',
    icon: '🌨️',
    description: 'Manto de nieve esponjosa con microdestellos cristalinos y sheen',
    apply: {
      color: '#f8fafc',
      roughness: 0.85,
      metalness: 0.0,
      sheen: 0.95,
      sheenColor: '#e0f2fe',
      sheenRoughness: 0.35,
      transparent: false,
      opacity: 1
    }
  },
  {
    name: 'Nieve y Hielo Descongelado',
    category: 'Hielo & Nieve',
    icon: '🏔️',
    description: 'Transición entre nieve compactada húmeda y charcos de hielo transparente',
    apply: {
      color: '#ffffff',
      roughness: 0.28,
      metalness: 0.0,
      transmission: 0.75,
      ior: 1.31,
      thickness: 1.8,
      attenuationColor: '#0284c7',
      attenuationDistance: 0.55,
      clearcoat: 0.9,
      clearcoatRoughness: 0.04,
      transparent: false,
      opacity: 1
    }
  },
  {
    name: 'Vidrio Óptico Claro',
    category: 'Vidrio & Gemas',
    icon: '🪟',
    description: 'Vidrio crown con IOR 1.52',
    apply: { color: '#ffffff', roughness: 0.02, metalness: 0.0, transmission: 1.0, ior: 1.52, thickness: 1.2, transparent: true, opacity: 1, attenuationDistance: 5.0, attenuationColor: '#ffffff' }
  },
  {
    name: 'Vidrio Esmerilado',
    category: 'Vidrio & Gemas',
    icon: '🧊',
    description: 'Vidrio arenado mate difuso',
    apply: { color: '#f8fafc', roughness: 0.38, metalness: 0.0, transmission: 0.95, ior: 1.50, thickness: 1.0, transparent: true, opacity: 1 }
  },
  {
    name: 'Diamante Puro',
    category: 'Vidrio & Gemas',
    icon: '💎',
    description: 'IOR 2.42 y dispersión prismática',
    apply: { color: '#ffffff', roughness: 0.01, metalness: 0.0, transmission: 1.0, ior: 2.42, dispersion: 0.08, thickness: 1.5, transparent: true }
  },
  {
    name: 'Rubí Carmesí',
    category: 'Vidrio & Gemas',
    icon: '🩸',
    description: 'Corindón con absorción roja',
    apply: { color: '#ffffff', roughness: 0.03, transmission: 0.92, ior: 1.77, attenuationColor: '#e11d48', attenuationDistance: 0.6, thickness: 2.0, transparent: true }
  },
  {
    name: 'Esmeralda Verde',
    category: 'Vidrio & Gemas',
    icon: '💚',
    description: 'Berilo translúcido verde',
    apply: { color: '#ffffff', roughness: 0.04, transmission: 0.9, ior: 1.58, attenuationColor: '#059669', attenuationDistance: 0.5, thickness: 2.0, transparent: true }
  },
  {
    name: 'Ámbar Fósil',
    category: 'Vidrio & Gemas',
    icon: '🍯',
    description: 'Resina cálida con absorción ámbar',
    apply: { color: '#ffffff', roughness: 0.08, transmission: 0.85, ior: 1.55, attenuationColor: '#f59e0b', attenuationDistance: 0.8, thickness: 1.5, transparent: true }
  },
  {
    name: 'Agua Cristalina',
    category: 'Vidrio & Gemas',
    icon: '💧',
    description: 'Líquido diáfano IOR 1.333',
    apply: { color: '#f0f9ff', roughness: 0.02, metalness: 0.0, transmission: 1.0, ior: 1.333, thickness: 2.0, transparent: true }
  },
  {
    name: 'Pompa de Jabón Físico (Thin-Film)',
    category: 'Vidrio & Gemas',
    icon: '🫧',
    description: 'Interferencia de película ultra-delgada con iridiscencia espectral completa e IOR 1.333',
    apply: {
      color: '#ffffff',
      roughness: 0.005,
      metalness: 0.0,
      transmission: 0.98,
      ior: 1.333,
      iridescence: 1.0,
      iridescenceIOR: 1.333,
      iridescenceThicknessRange: [200, 750],
      thickness: 0.05,
      transparent: true,
      opacity: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      specularIntensity: 1.0
    }
  },
  {
    name: 'Película de Aceite en Agua',
    category: 'Vidrio & Gemas',
    icon: '🛢️',
    description: 'Fina capa lipídica irisada con interferencia óptica sobre superficie húmeda',
    apply: {
      color: '#0f172a',
      roughness: 0.05,
      metalness: 0.0,
      iridescence: 0.95,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [150, 600],
      clearcoat: 0.9,
      clearcoatRoughness: 0.02
    }
  },
  {
    name: 'Nácar / Concha de Perla',
    category: 'Vidrio & Gemas',
    icon: '🦪',
    description: 'Aragonito bio-mineral laminado con brillos iridiscentes y sheen satinado',
    apply: {
      color: '#fdfbf7',
      roughness: 0.18,
      metalness: 0.05,
      iridescence: 0.85,
      iridescenceIOR: 1.65,
      iridescenceThicknessRange: [200, 800],
      sheen: 0.7,
      sheenColor: '#fce7f3',
      clearcoat: 0.6
    }
  },

  // Lacados & Pinturas
  {
    name: 'Pintura Candy Red',
    category: 'Lacados & Pinturas',
    icon: '🏎️',
    description: 'Metalizado con laca de alto brillo',
    apply: { color: '#c8001a', metalness: 0.65, roughness: 0.25, clearcoat: 1.0, clearcoatRoughness: 0.04, specularIntensity: 1.2, transmission: 0 }
  },
  {
    name: 'Fibra Carbono Lacada',
    category: 'Lacados & Pinturas',
    icon: '🏁',
    description: 'Compuesto oscuro con barniz epoxi',
    apply: { color: '#18181b', metalness: 0.15, roughness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.06, anisotropy: 0.6, transmission: 0 }
  },
  {
    name: 'Cerámica Esmaltada',
    category: 'Lacados & Pinturas',
    icon: '🏺',
    description: 'Porcelana con esmalte vítreo',
    apply: { color: '#fafafa', metalness: 0.0, roughness: 0.18, clearcoat: 0.95, clearcoatRoughness: 0.05, ior: 1.52, transmission: 0 }
  },

  // Textiles & Terciopelos
  {
    name: 'Terciopelo Carmesí',
    category: 'Textiles',
    icon: '🧣',
    description: 'Retro-reflexión de microvellosidades',
    apply: { color: '#7f1d1d', roughness: 0.85, metalness: 0.0, sheen: 1.0, sheenRoughness: 0.35, sheenColor: '#f43f5e', transmission: 0 }
  },
  {
    name: 'Seda Azul Noche',
    category: 'Textiles',
    icon: '👘',
    description: 'Tejido lustroso con sheen azul hielo',
    apply: { color: '#1e3a8a', roughness: 0.4, metalness: 0.05, sheen: 0.85, sheenRoughness: 0.3, sheenColor: '#93c5fd', anisotropy: 0.5, transmission: 0 }
  },

  // Especiales / Iridiscencia
  {
    name: 'Pompa de Jabón',
    category: 'Especiales',
    icon: '🫧',
    description: 'Interferencia de película fina con reflejos irisados Airy, halo magenta y refracción diáfana',
    apply: {
      color: '#ffffff',
      roughness: 0.005,
      metalness: 0.0,
      transmission: 0.98,
      opacity: 0.35,
      transparent: true,
      ior: 1.333,
      thickness: 0.05,
      iridescence: 1.0,
      iridescenceIOR: 1.333,
      iridescenceThicknessRange: [200, 750],
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'soap_bubble',
        timeSpeed: 0.7,
        displacementScale: 0.008,
        noiseFrequency: 1.8,
        colorAccent: '#ff26aa',
        glowIntensity: 1.8,
      }
    }
  },
  {
    name: 'Mancha Petróleo',
    category: 'Especiales',
    icon: '🛢️',
    description: 'Capa delgada con efecto tornasol',
    apply: { color: '#111827', roughness: 0.12, metalness: 0.4, iridescence: 1.0, iridescenceIOR: 1.6, iridescenceThicknessRange: [150, 600], transmission: 0 }
  },
  {
    name: 'Nácar / Perla',
    category: 'Especiales',
    icon: '🦪',
    description: 'Reflejos irisados nacarados',
    apply: { color: '#fdfcfb', roughness: 0.22, metalness: 0.05, sheen: 0.45, sheenColor: '#fbcfe8', iridescence: 0.8, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 500], transmission: 0 }
  },

  // ── WebGPU Physical Glass (Dispersión Espectral, Refracción & Cáusticas) ──
  {
    name: 'Pompa de Jabón Espectral (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '🫧',
    description: 'Refracción física con dispersión de Cauchy, iridiscencia espectral y ondas superficiales',
    apply: {
      color: '#ffffff',
      roughness: 0.005,
      metalness: 0.0,
      transmission: 0.98,
      ior: 1.333,
      thickness: 0.05,
      dispersion: 0.14,
      attenuationColor: '#fdf4ff',
      attenuationDistance: 4.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      iridescence: 1.0,
      iridescenceIOR: 1.333,
      iridescenceThicknessRange: [200, 750],
      transparent: true,
      opacity: 0.35,
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'soap_bubble_spectral',
        dispersion: 0.14,
        chromaticAberration: 0.08,
        distortion: 0.015,
        distortionSpeed: 1.0,
        distortionFrequency: 2.0,
        rimGlow: 2.0,
        rimColor: '#ff26aa',
        thinFilmIridescence: 1.0,
        causticIntensity: 1.2,
      }
    }
  },
  {
    name: 'Prisma Óptico Newton (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '🌈',
    description: 'Dispersión espectral prismática con separación de longitud de onda Cauchy',
    apply: {
      color: '#ffffff',
      roughness: 0.01,
      metalness: 0.0,
      transmission: 1.0,
      ior: 1.65,
      thickness: 1.8,
      dispersion: 0.12,
      attenuationColor: '#ffffff',
      attenuationDistance: 8.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.01,
      iridescence: 0.8,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [200, 700],
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'newton_dispersion_prism',
        dispersion: 0.12,
        chromaticAberration: 0.08,
        rimGlow: 1.5,
        rimColor: '#a5b4fc',
        thinFilmIridescence: 0.6,
        causticIntensity: 1.6,
      }
    }
  },
  {
    name: 'Diamante Cuántico (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '💎',
    description: 'Refracción de alto IOR 2.417 con destellos cáusticos y borde Fresnel',
    apply: {
      color: '#ffffff',
      roughness: 0.005,
      metalness: 0.0,
      transmission: 1.0,
      ior: 2.417,
      thickness: 2.5,
      dispersion: 0.18,
      attenuationColor: '#ffffff',
      attenuationDistance: 12.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.01,
      iridescence: 0.95,
      iridescenceIOR: 1.8,
      iridescenceThicknessRange: [300, 800],
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'diamond_spectral',
        dispersion: 0.18,
        chromaticAberration: 0.12,
        rimGlow: 2.2,
        rimColor: '#e0e7ff',
        thinFilmIridescence: 0.9,
        causticIntensity: 2.0,
      }
    }
  },
  {
    name: 'Cristal Ondulado Líquido (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '🌊',
    description: 'Vidrio líquido dinámico con ondas sinusoidales en tiempo real y aberración cromática',
    apply: {
      color: '#f0f9ff',
      roughness: 0.02,
      metalness: 0.0,
      transmission: 1.0,
      ior: 1.333,
      thickness: 2.2,
      dispersion: 0.07,
      attenuationColor: '#0284c7',
      attenuationDistance: 3.5,
      clearcoat: 0.95,
      clearcoatRoughness: 0.02,
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'liquid_wave_glass',
        dispersion: 0.07,
        chromaticAberration: 0.06,
        distortion: 0.45,
        distortionSpeed: 1.5,
        distortionFrequency: 3.5,
        rimGlow: 1.2,
        rimColor: '#38bdf8',
        thinFilmIridescence: 0.3,
        causticIntensity: 1.4,
      }
    }
  },
  {
    name: 'Vidrio Soplado con Microburbujas (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '🫧',
    description: 'Inclusiones 3D Voronoi internas de burbujas de aire y refracción sutil',
    apply: {
      color: '#f8fafc',
      roughness: 0.06,
      metalness: 0.0,
      transmission: 0.98,
      ior: 1.51,
      thickness: 2.0,
      dispersion: 0.06,
      attenuationColor: '#bae6fd',
      attenuationDistance: 4.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.04,
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'handblown_bubbles',
        dispersion: 0.06,
        chromaticAberration: 0.04,
        distortion: 0.2,
        internalBubbles: true,
        bubbleDensity: 1.8,
        bubbleScale: 24.0,
        rimGlow: 1.1,
        rimColor: '#e0e7fe',
        causticIntensity: 1.2,
      }
    }
  },
  {
    name: 'Vidrio Dicroico Iridiscente (WebGPU Glass)',
    category: 'Vidrio & Gemas',
    icon: '✨',
    description: 'Efecto dicroico multicapa con gradiente angular de longitud de onda',
    apply: {
      color: '#ffffff',
      roughness: 0.02,
      metalness: 0.05,
      transmission: 0.95,
      ior: 1.72,
      thickness: 1.5,
      dispersion: 0.14,
      attenuationColor: '#fbcfe8',
      attenuationDistance: 5.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.01,
      iridescence: 1.0,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [180, 850],
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'dichroic_rainbow',
        dispersion: 0.14,
        chromaticAberration: 0.1,
        rimGlow: 2.0,
        rimColor: '#f43f5e',
        thinFilmIridescence: 1.0,
        causticIntensity: 1.8,
      }
    }
  },

  // ── THREE-CustomShaderMaterial (CSM Extension Shaders) ──
  {
    name: 'CSM Pompa de Jabón (Película Delgada)',
    category: 'Custom Shaders (CSM)',
    icon: '🫧',
    description: 'Interferencia Airy con torbellinos de espesor fluido, halo fucsia/magenta/cian y transparencia cristalina',
    apply: {
      color: '#ffffff',
      roughness: 0.005,
      metalness: 0.0,
      transmission: 0.98,
      opacity: 0.35,
      transparent: true,
      ior: 1.333,
      thickness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.0,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'soap_bubble',
        timeSpeed: 0.7,
        displacementScale: 0.008,
        noiseFrequency: 1.8,
        colorAccent: '#ff26aa',
        glowIntensity: 1.8,
      }
    }
  },
  {
    name: 'CSM Ondas Líquidas & Vórtice',
    category: 'Custom Shaders (CSM)',
    icon: '🌀',
    description: 'Deformación dinámica de malla sinusoidal con normales recalculadas y brillo emissivo',
    apply: {
      color: '#0284c7',
      roughness: 0.1,
      metalness: 0.2,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'wave_distortion',
        timeSpeed: 1.2,
        displacementScale: 0.18,
        noiseFrequency: 2.2,
        colorAccent: '#38bdf8',
        glowIntensity: 0.5,
      }
    }
  },
  {
    name: 'CSM Escudo Holográfico Sci-Fi',
    category: 'Custom Shaders (CSM)',
    icon: '🛡️',
    description: 'Efecto holográfico con líneas de escaneo activas, rejilla cúbica y glow Fresnel',
    apply: {
      color: '#0891b2',
      roughness: 0.15,
      metalness: 0.0,
      opacity: 0.85,
      transparent: true,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'hologram_shield',
        timeSpeed: 2.0,
        displacementScale: 0.05,
        noiseFrequency: 8.0,
        colorAccent: '#06b6d4',
        glowIntensity: 2.5,
      }
    }
  },
  {
    name: 'CSM Magma & Lava Volcánica',
    category: 'Custom Shaders (CSM)',
    icon: '🌋',
    description: 'Corteza basáltica con fracturas incandescentes animadas por ruido simplex y pulsación',
    apply: {
      color: '#1c1917',
      roughness: 0.85,
      metalness: 0.1,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'volcanic_magma',
        timeSpeed: 0.8,
        displacementScale: 0.12,
        noiseFrequency: 3.5,
        colorAccent: '#ff3b00',
        glowIntensity: 3.0,
      }
    }
  },
  {
    name: 'CSM Torsión Espacial Helicoidal',
    category: 'Custom Shaders (CSM)',
    icon: '🌪️',
    description: 'Torsión helicoidal geométrica 3D a lo largo del eje Y impulsada por GPU',
    apply: {
      color: '#581c87',
      roughness: 0.2,
      metalness: 0.6,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'twist_vortex',
        timeSpeed: 1.2,
        displacementScale: 0.25,
        noiseFrequency: 2.0,
        colorAccent: '#c084fc',
        glowIntensity: 1.8,
      }
    }
  },
  {
    name: 'CSM Tejido Bio-Orgánico',
    category: 'Custom Shaders (CSM)',
    icon: '🧬',
    description: 'Piel y tejido vivo con pulsación biológica y vascularización procedural',
    apply: {
      color: '#881337',
      roughness: 0.35,
      metalness: 0.0,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'bio_organic_flesh',
        timeSpeed: 1.5,
        displacementScale: 0.15,
        noiseFrequency: 3.0,
        colorAccent: '#e11d48',
        glowIntensity: 0.8,
      }
    }
  },
  {
    name: 'CSM Cristal Cuántico Facetado',
    category: 'Custom Shaders (CSM)',
    icon: '💎',
    description: 'Refracción molecular interna con faceteado anisotrópico dinámico',
    apply: {
      color: '#312e81',
      roughness: 0.05,
      metalness: 0.4,
      transmission: 0.6,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'quantum_crystal',
        timeSpeed: 1.0,
        displacementScale: 0.1,
        noiseFrequency: 4.0,
        colorAccent: '#818cf8',
        glowIntensity: 1.2,
      }
    }
  },
  {
    name: 'CSM Glitch Digital Cyber',
    category: 'Custom Shaders (CSM)',
    icon: '👾',
    description: 'Artefactos de compresión digital y líneas de datos de matriz cuántica',
    apply: {
      color: '#064e3b',
      roughness: 0.3,
      metalness: 0.1,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'digital_wire_glitch',
        timeSpeed: 3.0,
        displacementScale: 0.08,
        noiseFrequency: 6.0,
        colorAccent: '#10b981',
        glowIntensity: 2.0,
      }
    }
  },
  {
    name: 'CSM Sombreado Cómic / Pop-Art',
    category: 'Custom Shaders (CSM)',
    icon: '🎨',
    description: 'Sombreado toon cel-shading con trama de puntos semitono Halftone',
    apply: {
      color: '#d97706',
      roughness: 0.9,
      metalness: 0.0,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshToonMaterial',
        preset: 'comic_halftone',
        timeSpeed: 0.0,
        displacementScale: 0.0,
        noiseFrequency: 12.0,
        colorAccent: '#f59e0b',
        glowIntensity: 1.0,
      }
    }
  },

  // Volumétricos 3D (Raymarching: WebGPU Fire, Lighting, Perlin & Ice)
  {
    name: 'Fuego Volumétrico 3D (WebGPU Fire)',
    category: 'Volumétricos 3D',
    icon: '🔥',
    description: 'Llama ardiente con gradiente de temperatura, convección y emisión aditiva',
    apply: {
      color: '#ef4444',
      emissive: '#fbbf24',
      emissiveIntensity: 3.2,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'fire',
        density: 2.8,
        scale: 2.4,
        lightIntensity: 2.2,
        color: '#ef4444',
        secondaryColor: '#fbbf24',
        emissiveIntensity: 3.2,
        threshold: 0.28,
        thresholdMax: 0.78,
        absorption: 1.2,
        steps: 42,
        shadowSteps: 4,
        windSpeed: 0.35,
        windDirection: [0.0, 1.2, 0.0],
        blending: 'additive',
        turbulentFlame: true,
      }
    }
  },
  {
    name: 'Gas Plasma / Raymarching',
    category: 'Volumétricos 3D',
    icon: '⚡',
    description: 'Gas ionizado brillante con filamentos Voronoi y blending aditivo',
    apply: {
      color: '#06b6d4',
      emissive: '#a855f7',
      emissiveIntensity: 2.8,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'plasma',
        density: 2.4,
        scale: 2.0,
        lightIntensity: 2.0,
        color: '#06b6d4',
        secondaryColor: '#a855f7',
        emissiveIntensity: 2.8,
        threshold: 0.32,
        thresholdMax: 0.80,
        absorption: 1.0,
        steps: 40,
        shadowSteps: 4,
        windSpeed: 0.12,
        windDirection: [0.1, 0.05, 0.1],
        blending: 'additive',
      }
    }
  },
  {
    name: 'Niebla / Bruma Densa (Raymarching)',
    category: 'Volumétricos 3D',
    icon: '🌫️',
    description: 'Capa de niebla densa volumétrica con dispersión suave de luz ambiental',
    apply: {
      color: '#f1f5f9',
      emissive: '#000000',
      emissiveIntensity: 0.0,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'cloud',
        density: 1.8,
        scale: 1.4,
        lightIntensity: 1.2,
        color: '#f1f5f9',
        secondaryColor: '#cbd5e1',
        emissiveIntensity: 0,
        threshold: 0.12,
        thresholdMax: 0.85,
        absorption: 0.8,
        steps: 32,
        shadowSteps: 4,
        windSpeed: 0.05,
        windDirection: [0.1, 0.0, 0.05],
        blending: 'normal',
      }
    }
  },
  {
    name: 'Humo Volumétrico Denso',
    category: 'Volumétricos 3D',
    icon: '💨',
    description: 'Humo industrial con auto-sombreado interno y dispersión',
    apply: {
      color: '#334155',
      emissive: '#000000',
      emissiveIntensity: 0,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'smoke',
        density: 3.0,
        scale: 3.2,
        lightIntensity: 0.85,
        color: '#334155',
        secondaryColor: '#64748b',
        emissiveIntensity: 0,
        threshold: 0.35,
        thresholdMax: 0.85,
        absorption: 3.8,
        steps: 36,
        shadowSteps: 8,
        windSpeed: 0.22,
        windDirection: [0.0, 0.8, 0.1],
        blending: 'normal',
      }
    }
  },
  {
    name: 'Nube Cúmulo 3D',
    category: 'Volumétricos 3D',
    icon: '☁️',
    description: 'Nube algodonosa blanca con absorción Beer-Lambert',
    apply: {
      color: '#ffffff',
      emissive: '#000000',
      emissiveIntensity: 0,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'cloud',
        density: 1.6,
        scale: 2.2,
        lightIntensity: 1.2,
        color: '#ffffff',
        secondaryColor: '#cbd5e1',
        emissiveIntensity: 0,
        threshold: 0.38,
        thresholdMax: 0.82,
        absorption: 2.2,
        steps: 36,
        shadowSteps: 6,
        windSpeed: 0.08,
        windDirection: [0.1, 0.05, 0.0],
        blending: 'normal',
      }
    }
  },
  {
    name: 'Tormenta Oscura 3D',
    category: 'Volumétricos 3D',
    icon: '🌩️',
    description: 'Nube densa de tormenta con absorción alta',
    apply: {
      color: '#475569',
      emissive: '#000000',
      emissiveIntensity: 0,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'cloud',
        density: 5.5,
        scale: 5.8,
        lightIntensity: 1.5,
        color: '#475569',
        secondaryColor: '#2d3748',
        emissiveIntensity: 0,
        threshold: 0.34,
        thresholdMax: 0.86,
        absorption: 3.2,
        steps: 24,
        shadowSteps: 5,
        windSpeed: 0.12,
        windDirection: [0.15, 0.05, 0.0],
        blending: 'normal',
      }
    }
  },
  {
    name: 'Nebulosa Cósmica 3D',
    category: 'Volumétricos 3D',
    icon: '🌌',
    description: 'Gas espacial púrpura con dispersión anisotrópica',
    apply: {
      color: '#c084fc',
      emissive: '#f43f5e',
      emissiveIntensity: 2.2,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'plasma',
        density: 1.8,
        scale: 1.6,
        lightIntensity: 1.8,
        color: '#c084fc',
        secondaryColor: '#f43f5e',
        emissiveIntensity: 2.2,
        threshold: 0.34,
        thresholdMax: 0.80,
        absorption: 1.2,
        steps: 36,
        shadowSteps: 6,
        windSpeed: 0.05,
        windDirection: [0.05, 0.02, 0.08],
        blending: 'additive',
      }
    }
  },
  {
    name: 'Aurora Boreal 3D',
    category: 'Volumétricos 3D',
    icon: '✨',
    description: 'Velo etéreo con brillo esmeralda y cian',
    apply: {
      color: '#10b981',
      emissive: '#06b6d4',
      emissiveIntensity: 2.0,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'plasma',
        density: 1.4,
        scale: 1.8,
        lightIntensity: 1.6,
        color: '#10b981',
        secondaryColor: '#06b6d4',
        emissiveIntensity: 2.0,
        threshold: 0.40,
        thresholdMax: 0.86,
        absorption: 1.0,
        steps: 36,
        shadowSteps: 4,
        windSpeed: 0.08,
        windDirection: [0.1, 0.0, 0.1],
        blending: 'additive',
      }
    }
  }
];

// ── Modal de importación de pack PBR ────────────────────────────────────────
const PBRImportModal: React.FC<{
  onClose: () => void;
  onImport: (mat: Omit<MaterialData, 'id'>) => void;
}> = ({ onClose, onImport }) => {
  const [step, setStep]           = useState<'select' | 'preview' | 'importing'>('select');
  const [files, setFiles]         = useState<File[]>([]);
  const [result, setResult]       = useState<Awaited<ReturnType<typeof importPBRPack>> | null>(null);
  const [matName, setMatName]     = useState('');
  const [error, setError]         = useState('');

  const SLOT_LABELS: Record<string, string> = {
    map:             'Albedo / Color',
    normalMap:       'Normal Map',
    roughnessMap:    'Roughness',
    metalnessMap:    'Metalness',
    aoMap:           'AO',
    emissiveMap:     'Emisivo',
    displacementMap: 'Displacement / Height',
    alphaMap:        'Alpha / Opacidad',
  };

  const handleFiles = (selectedFiles: FileList | File[]) => {
    const arr = Array.from(selectedFiles);
    setFiles(arr);
  };

  const handleAnalyze = async () => {
    if (files.length === 0) { setError('Selecciona al menos un archivo.'); return; }
    setError('');
    setStep('importing');
    try {
      const res = await importPBRPack(files);
      setResult(res);
      setMatName((res.material.name as string) || 'Material PBR');
      setStep('preview');
    } catch (e) {
      setError('Error al procesar los archivos: ' + (e as Error).message);
      setStep('select');
    }
  };

  const handleConfirm = () => {
    if (!result) return;
    const mat = {
      ...result.material,
      name: matName || 'Material PBR',
      color:             (result.material.color as string) || '#ffffff',
      roughness:         (result.material.roughness as number) ?? 0.5,
      metalness:         (result.material.metalness as number) ?? 0,
      emissive:          (result.material.emissive as string) || '#000000',
      emissiveIntensity: (result.material.emissiveIntensity as number) ?? 1,
      opacity:           (result.material.opacity as number) ?? 1,
      transparent:       (result.material.transparent as boolean) ?? false,
      ior:               (result.material.ior as number) ?? 1.5,
      transmission:      (result.material.transmission as number) ?? 0,
      thickness:         (result.material.thickness as number) ?? 0,
    } as Omit<MaterialData, 'id'>;
    onImport(mat);
    onClose();
  };

  const formatExt = (name: string) => name.split('.').pop()?.toUpperCase() || '';
  const formatColor = (ext: string) => {
    const map: Record<string, string> = {
      MTLX: 'bg-purple-900/40 text-purple-300', TRES: 'bg-teal-900/40 text-teal-300',
      USDA: 'bg-blue-900/40 text-blue-300',   PNG: 'bg-green-900/40 text-green-300',
      JPG: 'bg-green-900/40 text-green-300',  JPEG: 'bg-green-900/40 text-green-300',
      WEBP: 'bg-green-900/40 text-green-300',
    };
    return map[ext] || 'bg-zinc-800 text-zinc-400';
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-[#18181b] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
              <FolderOpen size={16} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Importar Pack PBR</h2>
              <p className="text-[10px] text-zinc-500">PNG/JPG · .mtlx · .tres · .usda</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {step === 'select' && (
            <>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Selecciona <span className="text-white font-semibold">todos los archivos del pack</span> a la vez: el archivo de formato
                (<code className="text-indigo-300">.mtlx</code>, <code className="text-indigo-300">.tres</code> o <code className="text-indigo-300">.usda</code>)
                junto con las texturas PNG. Los slots se detectan automáticamente por el nombre.
              </p>

              {/* Drop zone */}
              <label
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed border-zinc-700 hover:border-indigo-500 transition-colors cursor-pointer bg-zinc-900/40 hover:bg-indigo-500/5"
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-indigo-400'); }}
                onDragLeave={e => e.currentTarget.classList.remove('border-indigo-400')}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-indigo-400'); handleFiles(e.dataTransfer.files); }}
              >
                <FolderOpen size={32} className="text-zinc-600" />
                <span className="text-[11px] text-zinc-500 text-center">
                  Arrastra aquí los archivos del pack<br />o haz clic para seleccionarlos
                </span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.webp,.tga,.tiff,.mtlx,.tres,.usda,.usdc,.blend"
                  onChange={e => e.target.files && handleFiles(e.target.files)}
                />
              </label>

              {files.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{files.length} archivos seleccionados</p>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${formatColor(formatExt(f.name))}`}>
                          {formatExt(f.name)}
                        </span>
                        <span className="text-zinc-400 truncate">{f.name}</span>
                        <span className="text-zinc-600 ml-auto flex-shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Formatos soportados */}
              <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-1.5">
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-2">Formatos soportados</p>
                {[
                  { fmt: '.mtlx', desc: 'MaterialX — estándar Academy Software Foundation', ok: true },
                  { fmt: '.tres', desc: 'Godot Engine 4 StandardMaterial3D', ok: true },
                  { fmt: '.usda', desc: 'USD ASCII (Universal Scene Description)', ok: true },
                  { fmt: '.usdc', desc: 'USD binario → necesita conversión a .usda', ok: false },
                  { fmt: '.blend', desc: 'Blender nativo → exportar como GLB desde Blender', ok: false },
                ].map(({ fmt, desc, ok }) => (
                  <div key={fmt} className="flex items-center gap-2">
                    {ok
                      ? <CheckCircle size={11} className="text-teal-400 flex-shrink-0" />
                      : <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                    }
                    <code className="text-[10px] text-indigo-300 w-12 flex-shrink-0">{fmt}</code>
                    <span className="text-[10px] text-zinc-500">{desc}</span>
                  </div>
                ))}
              </div>

              {error && <p className="text-[11px] text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={handleAnalyze}
                disabled={files.length === 0}
                className={`w-full py-2.5 rounded-xl text-[12px] font-bold transition-all ${files.length > 0 ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'}`}
              >
                Analizar archivos →
              </button>
            </>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-zinc-400">Procesando pack PBR...</p>
            </div>
          )}

          {step === 'preview' && result && (
            <>
              {/* Nombre */}
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Nombre del material</label>
                <input
                  value={matName}
                  onChange={e => setMatName(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Slots detectados */}
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Texturas detectadas</p>
                {Object.keys(SLOT_LABELS).map(slot => {
                  const hasMap = !!(result.material as any)[slot];
                  return (
                    <div key={slot} className={`flex items-center gap-3 p-2 rounded-lg ${hasMap ? 'bg-teal-900/15 border border-teal-900/30' : 'bg-zinc-900/40 border border-zinc-800'}`}>
                      {hasMap
                        ? <CheckCircle size={12} className="text-teal-400 flex-shrink-0" />
                        : <div className="w-3 h-3 rounded-full border border-zinc-700 flex-shrink-0" />
                      }
                      <span className="text-[11px] text-zinc-300 flex-1">{SLOT_LABELS[slot]}</span>
                      {hasMap
                        ? <span className="text-[9px] text-teal-400 font-bold">Asignado</span>
                        : <span className="text-[9px] text-zinc-600">Sin asignar</span>
                      }
                    </div>
                  );
                })}
              </div>

              {/* Valores escalares detectados */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Color base', value: result.material.color, type: 'color' },
                  { label: 'Rugosidad', value: ((result.material.roughness as number) ?? 0.5).toFixed(2), type: 'text' },
                  { label: 'Metalicidad', value: ((result.material.metalness as number) ?? 0).toFixed(2), type: 'text' },
                  { label: 'IOR', value: ((result.material.ior as number) ?? 1.5).toFixed(2), type: 'text' },
                ].map(({ label, value, type }) => (
                  <div key={label} className="bg-zinc-900/60 rounded-lg px-3 py-2">
                    <p className="text-[9px] text-zinc-600 uppercase font-bold">{label}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {type === 'color' && <div className="w-4 h-4 rounded border border-zinc-700 flex-shrink-0" style={{ background: value as string }} />}
                      <span className="text-[11px] text-zinc-300 font-mono">{value as string}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="space-y-1.5">
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex gap-2 p-2.5 rounded-lg bg-amber-900/20 border border-amber-900/30">
                      <AlertTriangle size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-300 leading-relaxed">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => { setStep('select'); setResult(null); }}
                  className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  ← Volver
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  Importar material ✓
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};


export const MaterialPanel: React.FC = () => {
  const {
    project,
    updateMaterial,
    updateObject,
    addMaterial,
    removeMaterial,
    selectedObjectId,
    selectedObjectIds,
    assignMaterialToObjects,
    isMaterialStudioOpen,
    openMaterialStudio,
    closeMaterialStudio,
    materialStudioMaterialId,
    setMaterialStudioMaterialId,
    updateEnvironment,
  } = useStore();
  const { materials, objects } = project;
  
  const selectedObject = objects.find(o => o.id === selectedObjectId);
  const activeMaterialId = selectedObject?.materialId;
  
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(materialStudioMaterialId || activeMaterialId || null);
  const [activeTab, setActiveTab] = useState<'library' | 'textures' | 'edit'>(
    (isMaterialStudioOpen || (materialStudioMaterialId || activeMaterialId)) ? 'edit' : 'library'
  );
  const [showPBRImport, setShowPBRImport] = useState(false);

  // Categorías y filtrado de la librería procedimental
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [presetCategoryFilter, setPresetCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Estado para la Librería de Texturas integrada
  const [customTextures, setCustomTextures] = useState<Array<{ id: string; name: string; url: string; type: string }>>([]);
  const [textureSearch, setTextureSearch] = useState<string>('');
  const [textureCategory, setTextureCategory] = useState<string>('all');
  const [textureSlotTarget, setTextureSlotTarget] = useState<'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'displacementMap'>('map');
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Estados de control avanzado de Mapeo UV y Color de Albedo
  const [isTilingLinked, setIsTilingLinked] = useState<boolean>(true);
  const [isOffsetLinked, setIsOffsetLinked] = useState<boolean>(false);
  const [albedoAdjustOpen, setAlbedoAdjustOpen] = useState<boolean>(false);
  const [albedoColorAdjustments, setAlbedoColorAdjustments] = useState<AlbedoColorAdjustments>({
    tintColor: '#ffffff',
    tintAmount: 0,
    hueShift: 0,
    saturation: 1,
    brightness: 1,
    contrast: 1,
    invert: false,
  });
  const [isProcessingAlbedo, setIsProcessingAlbedo] = useState<boolean>(false);
  const originalAlbedoBackup = useRef<Map<string, string>>(new Map());

  // Estados para modales de edición avanzada de mapas (Procedimental / Editor de Mapa)
  const [activeEditorMapKey, setActiveEditorMapKey] = useState<keyof MaterialData | null>(null);
  const [activeEditorTitle, setActiveEditorTitle] = useState<string>('');
  const [proceduralModalConfig, setProceduralModalConfig] = useState<ProceduralConfig | null>(null);

  const [proceduralThumbnails, setProceduralThumbnails] = useState<Map<string, string>>(() => generateAllThumbnails());

  useEffect(() => {
    generateAllThumbnailsAsync().then(map => {
      setProceduralThumbnails(new Map(map));
    });
  }, []);

  // Sync editingMaterialId with materialStudioMaterialId or activeMaterialId
  useEffect(() => {
    if (materialStudioMaterialId) {
      setEditingMaterialId(materialStudioMaterialId);
    } else if (activeMaterialId && !isMaterialStudioOpen) {
      setEditingMaterialId(activeMaterialId);
    }
  }, [materialStudioMaterialId, activeMaterialId, isMaterialStudioOpen]);

  // Auto-Recovery & Extraction for Imported Objects without MaterialId or missing in project.materials
  useEffect(() => {
    if (!selectedObject) return;

    // 1. If object already has a valid materialId in project.materials
    if (selectedObject.materialId) {
      const existing = materials.find(m => m.id === selectedObject.materialId);
      if (existing) {
        if (editingMaterialId !== selectedObject.materialId) {
          setEditingMaterialId(selectedObject.materialId);
        }
        return;
      }
    }

    // 2. If object has meshData (GLTF/GLB/OBJ), auto-extract its PBR materials
    if (selectedObject.meshData?.data) {
      extractPBRMaterialFromGLTFOrOBJ(selectedObject.meshData, selectedObject.name || 'Modelo').then((extracted) => {
        if (extracted && extracted.length > 0) {
          const newMaterials = [...materials];
          extracted.forEach((mat) => {
            if (!newMaterials.some(m => m.id === mat.id)) {
              newMaterials.push(mat);
            }
          });
          const primaryMat = extracted[0];
          updateObject(selectedObject.id, {
            materialId: primaryMat.id,
            material: { ...primaryMat },
            color: primaryMat.color || selectedObject.color || '#ffffff',
          });
          useStore.getState().setProject({ ...project, materials: newMaterials });
          setEditingMaterialId(primaryMat.id);
        }
      });
    } else if (selectedObject.material && (selectedObject.material.map || selectedObject.material.roughnessMap || selectedObject.material.normalMap || selectedObject.material.transmission)) {
      // 3. If object has inline material with textures or PBR properties
      const newId = 'mat_obj_' + selectedObject.id;
      const inlineMat: MaterialData = {
        color: selectedObject.material.color || '#ffffff',
        roughness: selectedObject.material.roughness ?? 0.5,
        metalness: selectedObject.material.metalness ?? 0.0,
        emissive: selectedObject.material.emissive || '#000000',
        emissiveIntensity: selectedObject.material.emissiveIntensity ?? 1.0,
        opacity: selectedObject.material.opacity ?? 1.0,
        transparent: selectedObject.material.transparent ?? false,
        ...selectedObject.material,
        id: newId,
        name: `Material ${selectedObject.name || 'Objeto'}`,
        category: 'imported',
      };
      const newMaterials = [...materials, inlineMat];
      updateObject(selectedObject.id, { materialId: newId });
      useStore.getState().setProject({ ...project, materials: newMaterials });
      setEditingMaterialId(newId);
    }
  }, [selectedObject?.id, selectedObject?.materialId, selectedObject?.meshData]);

  const handleReextractPBRMapsFromSelectedObject = async () => {
    if (!selectedObject) return;
    if (selectedObject.meshData?.data) {
      const extracted = await extractPBRMaterialFromGLTFOrOBJ(selectedObject.meshData, selectedObject.name || 'Modelo');
      if (extracted && extracted.length > 0) {
        const newMaterials = [...materials];
        extracted.forEach((mat) => {
          const idx = newMaterials.findIndex(m => m.id === mat.id || m.name === mat.name);
          if (idx >= 0) {
            newMaterials[idx] = mat;
          } else {
            newMaterials.push(mat);
          }
        });
        const primaryMat = extracted[0];
        updateObject(selectedObject.id, {
          materialId: primaryMat.id,
          material: { ...primaryMat },
        });
        useStore.getState().setProject({ ...project, materials: newMaterials });
        setEditingMaterialId(primaryMat.id);
        setCopiedNotification('¡Mapas PBR extraídos y sincronizados!');
        setTimeout(() => setCopiedNotification(null), 3000);
      }
    } else {
      setCopiedNotification('Este objeto no tiene mallas GLTF/OBJ embebidas');
      setTimeout(() => setCopiedNotification(null), 2500);
    }
  };

  const currentMaterialId = editingMaterialId || materialStudioMaterialId || activeMaterialId;
  const activeMaterial = materials.find(m => m.id === currentMaterialId);

  const handleSelectProceduralMaterial = (pMat: ProceduralMaterial) => {
    const isVol = Boolean(pMat.isVolumetric || pMat.volumetric || pMat.category === 'gaseous');
    const defaultFilters = { rust: 0, scratches: 0, dirt: 0 };
    const maps = isVol ? null : generateMaterial(pMat.id, 512, 512, defaultFilters);
    const newId = 'mat_' + pMat.id + '_' + Math.random().toString(36).substr(2, 6);
    const d = pMat.defaults;

    const newMat: MaterialData = {
      id: newId,
      name: pMat.name,
      proceduralBaseId: pMat.id,
      filters: defaultFilters,
      color: d.color ?? (pMat.volumetric?.color || '#ffffff'),
      emissive: d.emissive ?? (isVol ? (pMat.volumetric?.secondaryColor || '#fbbf24') : '#000000'),
      emissiveIntensity: d.emissiveIntensity ?? (isVol ? (pMat.volumetric?.emissiveIntensity ?? 2.0) : 1),
      isVolumetric: isVol,
      volumetric: isVol ? {
        enabled: true,
        mode: pMat.volumetric?.mode || (pMat.id.includes('fire') ? 'fire' : pMat.id.includes('smoke') ? 'smoke' : pMat.id.includes('ice') ? 'ice' : pMat.id.includes('cloud') || pMat.id.includes('storm') ? 'cloud' : 'plasma'),
        density: pMat.volumetric?.density ?? 2.5,
        scale: pMat.volumetric?.scale ?? 2.2,
        lightIntensity: pMat.volumetric?.lightIntensity ?? 1.5,
        color: pMat.volumetric?.color || d.color || '#ffffff',
        secondaryColor: pMat.volumetric?.secondaryColor || d.emissive || '#fbbf24',
        emissiveIntensity: pMat.volumetric?.emissiveIntensity ?? (d.emissiveIntensity ?? 2.0),
        threshold: pMat.volumetric?.threshold ?? 0.22,
        thresholdMax: pMat.volumetric?.thresholdMax ?? 0.75,
        absorption: pMat.volumetric?.absorption ?? 1.6,
        steps: pMat.volumetric?.steps ?? 36,
        shadowSteps: pMat.volumetric?.shadowSteps ?? 4,
        windSpeed: pMat.volumetric?.windSpeed ?? 0.12,
        windDirection: pMat.volumetric?.windDirection ?? [0.0, 1.0, 0.0],
        blending: pMat.volumetric?.blending ?? (pMat.id.includes('fire') || pMat.id.includes('plasma') || pMat.id.includes('aurora') || pMat.id.includes('nebula') ? 'additive' : 'normal'),
        turbulentFlame: pMat.volumetric?.turbulentFlame ?? pMat.id.includes('fire'),
      } : undefined,
      map: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.albedo || undefined),
      normalMap: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.normal || undefined),
      roughnessMap: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.roughness || undefined),
      metalnessMap: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.metallic || undefined),
      aoMap: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.ao || undefined),
      displacementMap: (isVol || pMat.isCSM || pMat.isWebGPUGlass) ? undefined : (maps?.displacement || undefined),
      roughness: d.roughness ?? 0.5,
      metalness: d.metalness ?? 0.0,
      normalScale: d.normalScale ?? 1.0,
      displacementScale: d.displacementScale ?? 0.0,
      displacementBias: d.displacementBias ?? 0.0,
      clearcoat: d.clearcoat ?? 0.0,
      clearcoatRoughness: d.clearcoatRoughness ?? 0.1,
      sheen: d.sheen ?? 0.0,
      sheenRoughness: d.sheenRoughness ?? 0.5,
      sheenColor: d.sheenColor ?? '#ffffff',
      iridescence: d.iridescence ?? 0.0,
      iridescenceIOR: d.iridescenceIOR ?? 1.3,
      iridescenceThicknessRange: d.iridescenceThicknessRange,
      transmission: d.transmission ?? 0.0,
      ior: d.ior ?? 1.5,
      thickness: d.thickness ?? 0.0,
      attenuationColor: d.attenuationColor,
      attenuationDistance: d.attenuationDistance,
      dispersion: d.dispersion ?? 0.0,
      isIce: pMat.category === 'ice_snow' || pMat.id.startsWith('ice_'),
      iceConfig: (pMat.category === 'ice_snow' || pMat.id.startsWith('ice_')) ? {
        enabled: true,
        surfaceWarp: 0.05,
        cloudDensity: pMat.id === 'ice_glacial' ? 1.5 : pMat.id === 'ice_cracked' ? 1.2 : 0.8,
        cloudColor: '#e0f2fe',
        cloudScale: 2.8,
        frostIntensity: pMat.id === 'ice_frosted' ? 1.0 : 0.85,
        crackIntensity: pMat.id === 'ice_cracked' ? 1.2 : 0.9,
      } : undefined,
      isCSM: Boolean(pMat.isCSM || pMat.category === 'csm' || pMat.id.startsWith('csm_')),
      csmConfig: (pMat.isCSM || pMat.category === 'csm' || pMat.id.startsWith('csm_')) ? {
        enabled: true,
        ...(pMat.csmConfig || {}),
      } : undefined,
      isGlass: Boolean(pMat.isWebGPUGlass || pMat.category === 'glass_webgpu' || pMat.id.startsWith('glass_')),
      glassConfig: (pMat.isWebGPUGlass || pMat.category === 'glass_webgpu' || pMat.id.startsWith('glass_')) ? {
        enabled: true,
        ...(pMat.webgpuGlass || {}),
      } : undefined,
      opacity: 1,
      transparent: isVol || (d.transmission ?? 0) > 0 || (pMat.isCSM && pMat.csmConfig?.preset === 'hologram_shield'),
    };

    addMaterial(newMat);
    const ids = (selectedObjectIds && selectedObjectIds.length > 0) 
      ? selectedObjectIds 
      : (selectedObjectId ? [selectedObjectId] : []);
    if (ids.length > 0) {
      assignMaterialToObjects(ids, newMat.id);
      setCopiedNotification(`¡Material "${pMat.name}" aplicado al objeto!`);
      setTimeout(() => setCopiedNotification(null), 2500);
    } else {
      setCopiedNotification(`Material "${pMat.name}" añadido al proyecto`);
      setTimeout(() => setCopiedNotification(null), 2500);
    }
    setEditingMaterialId(newMat.id);
    setMaterialStudioMaterialId(newMat.id);
    return newMat.id;
  };

  const handleFilterChange = (filterKey: 'rust' | 'scratches' | 'dirt', val: number) => {
    if (!activeMaterial) return;
    const currentFilters = activeMaterial.filters || { rust: 0, scratches: 0, dirt: 0 };
    const newFilters: MaterialFilters = { ...currentFilters, [filterKey]: val };
    
    // 1. If active material has a procedural base ID, generate directly from library
    if (activeMaterial.proceduralBaseId) {
      const maps = generateMaterial(activeMaterial.proceduralBaseId, 512, 512, newFilters);
      if (maps) {
        updateMaterial(activeMaterial.id, {
          filters: newFilters,
          map: maps.albedo,
          normalMap: maps.normal,
          roughnessMap: maps.roughness,
          metalnessMap: maps.metallic,
          aoMap: maps.ao,
          displacementMap: maps.displacement,
        });
        return;
      }
    }

    // 2. Otherwise apply imperfections to custom maps or base properties
    const customMaps = applyImperfectionsToCustomMaps({
      albedo: activeMaterial.map,
      normal: activeMaterial.normalMap,
      roughness: activeMaterial.roughnessMap,
      metallic: activeMaterial.metalnessMap,
      ao: activeMaterial.aoMap,
      displacement: activeMaterial.displacementMap,
      baseColorHex: activeMaterial.color,
      baseRoughness: activeMaterial.roughness,
      baseMetalness: activeMaterial.metalness,
    }, newFilters);

    updateMaterial(activeMaterial.id, {
      filters: newFilters,
      map: customMaps.albedo,
      normalMap: customMaps.normal,
      roughnessMap: customMaps.roughness,
      metalnessMap: customMaps.metallic,
      aoMap: customMaps.ao,
      displacementMap: customMaps.displacement,
    });
  };

  const handleBatchFiltersChange = (newFilters: MaterialFilters) => {
    if (!activeMaterial) return;
    if (activeMaterial.proceduralBaseId) {
      const maps = generateMaterial(activeMaterial.proceduralBaseId, 512, 512, newFilters);
      if (maps) {
        updateMaterial(activeMaterial.id, {
          filters: newFilters,
          map: maps.albedo,
          normalMap: maps.normal,
          roughnessMap: maps.roughness,
          metalnessMap: maps.metallic,
          aoMap: maps.ao,
          displacementMap: maps.displacement,
        });
        return;
      }
    }

    const customMaps = applyImperfectionsToCustomMaps({
      albedo: activeMaterial.map,
      normal: activeMaterial.normalMap,
      roughness: activeMaterial.roughnessMap,
      metallic: activeMaterial.metalnessMap,
      ao: activeMaterial.aoMap,
      displacement: activeMaterial.displacementMap,
      baseColorHex: activeMaterial.color,
      baseRoughness: activeMaterial.roughness,
      baseMetalness: activeMaterial.metalness,
    }, newFilters);

    updateMaterial(activeMaterial.id, {
      filters: newFilters,
      map: customMaps.albedo,
      normalMap: customMaps.normal,
      roughnessMap: customMaps.roughness,
      metalnessMap: customMaps.metallic,
      aoMap: customMaps.ao,
      displacementMap: customMaps.displacement,
    });
  };

  const onSelectTextureFile = useCallback((file: File, type: keyof MaterialData) => {
    if (!activeMaterial) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      updateMaterial(activeMaterial.id, { [type]: url });
      setCopiedNotification(`¡Textura cargada correctamente en ${String(type)}!`);
      setTimeout(() => setCopiedNotification(null), 2500);
    };
    reader.readAsDataURL(file);
  }, [activeMaterial, updateMaterial]);

  const handleApplyAlbedoColor = async () => {
    if (!activeMaterial || !activeMaterial.map) return;
    if (!originalAlbedoBackup.current.has(activeMaterial.id)) {
      originalAlbedoBackup.current.set(activeMaterial.id, activeMaterial.map);
    }
    setIsProcessingAlbedo(true);
    try {
      const baseMapToProcess = originalAlbedoBackup.current.get(activeMaterial.id) || activeMaterial.map;
      const updatedDataUrl = await adjustTextureColors(baseMapToProcess, albedoColorAdjustments);
      updateMaterial(activeMaterial.id, { map: updatedDataUrl });
      setCopiedNotification('¡Ajustes de color aplicados al mapa Albedo!');
      setTimeout(() => setCopiedNotification(null), 2500);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessingAlbedo(false);
    }
  };

  const handleResetAlbedoColor = () => {
    if (!activeMaterial) return;
    const original = originalAlbedoBackup.current.get(activeMaterial.id);
    if (original) {
      updateMaterial(activeMaterial.id, { map: original });
    }
    setAlbedoColorAdjustments({
      tintColor: '#ffffff',
      tintAmount: 0,
      hueShift: 0,
      saturation: 1,
      brightness: 1,
      contrast: 1,
      invert: false,
    });
    setCopiedNotification('¡Mapa Albedo restaurado a su color original!');
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  const handleModifyMap = (slotKey: string, mapProperty: keyof MaterialData) => {
    if (!activeMaterial) return;

    // Abrir siempre el editor de mapa 2D interactivo con herramientas de color, tintes y tonalidad
    setActiveEditorMapKey(mapProperty);
    setActiveEditorTitle(slotKey);
  };

  const handleGeneratePBRFromSource = async (sourceUrl?: string) => {
    if (!activeMaterial || !sourceUrl) {
      setCopiedNotification('No hay imagen en esta ranura para generar los mapas PBR');
      setTimeout(() => setCopiedNotification(null), 2000);
      return;
    }
    try {
      setCopiedNotification('⚡ Procesando imagen y sintetizando mapas PBR...');
      const pbrSet = await generateFullPBRMapsFromSource(sourceUrl);
      updateMaterial(activeMaterial.id, {
        normalMap: pbrSet.normalMap || activeMaterial.normalMap,
        roughnessMap: pbrSet.roughnessMap || activeMaterial.roughnessMap,
        aoMap: pbrSet.aoMap || activeMaterial.aoMap,
        displacementMap: pbrSet.displacementMap || activeMaterial.displacementMap,
        metalnessMap: pbrSet.metalnessMap || activeMaterial.metalnessMap,
      });
      setCopiedNotification('✓ ¡Mapas Normal, Rugosidad, AO y Altura generados con éxito!');
      setTimeout(() => setCopiedNotification(null), 3500);
    } catch (err) {
      console.error(err);
      setCopiedNotification('Error al generar mapas PBR');
      setTimeout(() => setCopiedNotification(null), 2500);
    }
  };

  const handleApplyTilingToAllMaps = () => {
    if (!activeMaterial) return;
    const currentRepeat = activeMaterial.mapRepeat ?? [1, 1];
    const currentOffset = activeMaterial.mapOffset ?? [0, 0];
    const currentRot = activeMaterial.mapRotation ?? 0;
    const rep: [number, number] = Array.isArray(currentRepeat) ? [currentRepeat[0], currentRepeat[1]] : [currentRepeat, currentRepeat];
    const off: [number, number] = Array.isArray(currentOffset) ? [currentOffset[0], currentOffset[1]] : [currentOffset, currentOffset];

    updateMaterial(activeMaterial.id, {
      mapRepeat: [rep[0], rep[1]],
      mapOffset: [off[0], off[1]],
      mapRotation: currentRot,
    });
    setCopiedNotification('¡Transformación UV (Tiling / Offset / Rotación) aplicada a TODOS los mapas!');
    setTimeout(() => setCopiedNotification(null), 3000);
  };

  const handleClearAllMaps = () => {
    if (!activeMaterial) return;
    updateMaterial(activeMaterial.id, {
      map: undefined,
      normalMap: undefined,
      roughnessMap: undefined,
      metalnessMap: undefined,
      aoMap: undefined,
      displacementMap: undefined,
      emissiveMap: undefined,
      alphaMap: undefined,
      transmissionMap: undefined,
      anisotropyMap: undefined,
      ormMap: undefined,
    });
    setCopiedNotification('¡Todas las ranuras de mapas han sido vaciadas!');
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  const handleExportMaterial = () => {
    if (!activeMaterial) return;
    const blob = new Blob([JSON.stringify(activeMaterial, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeMaterial.name.replace(/\s+/g, '_')}_PBR.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportMaterial = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev: any) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (imported.name && (imported.color || imported.map)) {
            // Create a new material from imported data
            const newMat: Omit<MaterialData, 'id'> = {
              ...imported,
              id: undefined // Ensure a new ID is generated
            };
            addMaterial(newMat);
          } else {
            alert('Formato de material PBR no válido');
          }
        } catch (err) {
          alert('Error al cargar el material');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleCreateMaterial = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newMat: MaterialData = {
      id: newId,
      name: 'Nuevo Material',
      color: '#ffffff',
      roughness: 0.5,
      metalness: 0.0,
      emissive: '#000000',
      emissiveIntensity: 1,
      opacity: 1,
      transparent: false,
      ior: 1.5,
      transmission: 0,
      thickness: 0,
    };
    addMaterial(newMat);
    setEditingMaterialId(newId);
    setActiveTab('edit');
  };

  const onDropTexture = useCallback(async (e: React.DragEvent, type: keyof MaterialData) => {
    e.preventDefault();
    if (!activeMaterial) return;

    // 1. Check if a texture URL was dragged from the Textures tab
    const textureUrl = e.dataTransfer.getData('application/x-texture-url') || e.dataTransfer.getData('text/plain');
    if (textureUrl && (textureUrl.startsWith('data:') || textureUrl.startsWith('http') || textureUrl.startsWith('blob:') || textureUrl.startsWith('/'))) {
      updateMaterial(activeMaterial.id, { [type]: textureUrl });
      setCopiedNotification(`¡Textura asignada a ${String(type)}!`);
      setTimeout(() => setCopiedNotification(null), 2500);
      return;
    }

    // 2. Check if a file was dropped from the OS
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      updateMaterial(activeMaterial.id, { [type]: url });
      setCopiedNotification(`¡Textura cargada en ${String(type)}!`);
      setTimeout(() => setCopiedNotification(null), 2500);
    };
    reader.readAsDataURL(file);
  }, [activeMaterial, updateMaterial]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    presets: true,
    volumetric: true,
    basic: true,
    normal: true,
    porosity: true,
    glass: true,
    webgpu_glass: true,
    csm: true,
    ice_nodes: true,
    clearcoat: false,
    sheen: false,
    anisotropy: false,
    iridescence: false,
    emissive: false,
    filters: false,
    projection: false,
    maps: true
  });

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleAutoUVProjection = useCallback((targetMapping?: string) => {
    if (!activeMaterial) return;
    const mapping = targetMapping || activeMaterial.uvwMapping || 'BOX';
    const state = useStore.getState();
    const targetObjectIds = (selectedObjectIds && selectedObjectIds.length > 0)
      ? selectedObjectIds
      : (selectedObjectId ? [selectedObjectId] : []);
    
    // Find objects with this material or currently selected
    const objectsToUpdate = state.project.objects.filter(obj => 
      targetObjectIds.includes(obj.id) || obj.materialId === activeMaterial.id
    );

    if (objectsToUpdate.length === 0) return;

    const angleThresholdDeg = activeMaterial.uvAngleThreshold ?? 66;
    const islandMargin = activeMaterial.uvIslandMargin ?? 0.02;
    const relaxIterations = activeMaterial.uvRelaxIterations ?? 6;

    objectsToUpdate.forEach(obj => {
      if (obj.vertices && obj.faces && obj.faces.length > 0) {
        const meshData = applyUVWMapping(
          { vertices: obj.vertices, faces: obj.faces.map(f => ({ ...f, uvs: undefined })) },
          mapping,
          { angleThresholdDeg, islandMargin, relaxIterations }
        );
        state.updateObject(obj.id, { vertices: meshData.vertices, faces: meshData.faces });
      }
    });
  }, [activeMaterial, selectedObjectId, selectedObjectIds]);

  // Generar texturas procedimentales + texturas por defecto + texturas del proyecto + texturas de usuario
  const proceduralTexturesList = useMemo(() => {
    const list: Array<{ id: string; name: string; type: string; category: string; url: string; source: string }> = [];

    // 1. Procedural textures from material generators
    const baseMats = ['wood', 'marble', 'rusted_iron', 'concrete', 'tiles', 'brick_wall', 'carbon_fiber', 'leather', 'brushed_metal', 'gold_foil'];
    baseMats.forEach(baseId => {
      const matDef = MATERIAL_LIBRARY.find(m => m.id === baseId);
      const name = matDef?.name || baseId;
      const maps = generateMaterial(baseId, 256, 256, { rust: 0, scratches: 0, dirt: 0 });
      if (maps) {
        if (maps.albedo) list.push({ id: `${baseId}_albedo`, name: `${name} (Albedo / Color)`, type: 'albedo', category: 'albedo', url: maps.albedo, source: 'Procedimental' });
        if (maps.normal) list.push({ id: `${baseId}_normal`, name: `${name} (Normal Map)`, type: 'normal', category: 'normal', url: maps.normal, source: 'Procedimental' });
        if (maps.roughness) list.push({ id: `${baseId}_roughness`, name: `${name} (Rugosidad)`, type: 'roughness', category: 'roughness', url: maps.roughness, source: 'Procedimental' });
        if (maps.metallic) list.push({ id: `${baseId}_metallic`, name: `${name} (Metálico)`, type: 'metalness', category: 'metalness', url: maps.metallic, source: 'Procedimental' });
        if (maps.ao) list.push({ id: `${baseId}_ao`, name: `${name} (Oclusión / AO)`, type: 'ao', category: 'ao', url: maps.ao, source: 'Procedimental' });
        if (maps.displacement) list.push({ id: `${baseId}_disp`, name: `${name} (Desplazamiento)`, type: 'displacement', category: 'displacement', url: maps.displacement, source: 'Procedimental' });
      }
    });

    // 2. UV Calibration test textures
    const uvGridCanvas = document.createElement('canvas');
    uvGridCanvas.width = 256; uvGridCanvas.height = 256;
    const uctx = uvGridCanvas.getContext('2d');
    if (uctx) {
      uctx.fillStyle = '#1e1e24'; uctx.fillRect(0,0,256,256);
      uctx.strokeStyle = '#6366f1'; uctx.lineWidth = 2;
      for(let i=0; i<=256; i+=32){
        uctx.beginPath(); uctx.moveTo(i,0); uctx.lineTo(i,256); uctx.moveTo(0,i); uctx.lineTo(256,i); uctx.stroke();
      }
      uctx.fillStyle = '#a5b4fc'; uctx.font = 'bold 11px sans-serif';
      for(let y=16; y<256; y+=32){ for(let x=10; x<256; x+=32){ uctx.fillText(`U${Math.floor(x/32)}V${Math.floor(y/32)}`, x-6, y+4); }}
      list.push({ id: 'uv_grid_test', name: 'Rejilla Coordenadas UV', type: 'uv_grid', category: 'uv_grid', url: uvGridCanvas.toDataURL(), source: 'Calibración' });
    }

    const uvCheckerCanvas = document.createElement('canvas');
    uvCheckerCanvas.width = 256; uvCheckerCanvas.height = 256;
    const cctx = uvCheckerCanvas.getContext('2d');
    if (cctx) {
      for(let y=0; y<256; y+=32){
        for(let x=0; x<256; x+=32){
          const even = ((x/32)+(y/32))%2===0;
          cctx.fillStyle = even ? '#e4e4e7' : '#18181b';
          cctx.fillRect(x,y,32,32);
        }
      }
      list.push({ id: 'uv_checker_test', name: 'Damero Cuadros UV', type: 'uv_grid', category: 'uv_grid', url: uvCheckerCanvas.toDataURL(), source: 'Calibración' });
    }

    // 3. Project textures from materials
    materials.forEach(mat => {
      if (mat.map && !list.some(t => t.url === mat.map)) {
        list.push({ id: `proj_${mat.id}_map`, name: `${mat.name} (Albedo)`, type: 'albedo', category: 'project', url: mat.map, source: 'Proyecto' });
      }
      if (mat.normalMap && !list.some(t => t.url === mat.normalMap)) {
        list.push({ id: `proj_${mat.id}_norm`, name: `${mat.name} (Normal)`, type: 'normal', category: 'project', url: mat.normalMap, source: 'Proyecto' });
      }
      if (mat.roughnessMap && !list.some(t => t.url === mat.roughnessMap)) {
        list.push({ id: `proj_${mat.id}_rough`, name: `${mat.name} (Rugosidad)`, type: 'roughness', category: 'project', url: mat.roughnessMap, source: 'Proyecto' });
      }
      if (mat.metalnessMap && !list.some(t => t.url === mat.metalnessMap)) {
        list.push({ id: `proj_${mat.id}_met`, name: `${mat.name} (Metálico)`, type: 'metalness', category: 'project', url: mat.metalnessMap, source: 'Proyecto' });
      }
      if (mat.aoMap && !list.some(t => t.url === mat.aoMap)) {
        list.push({ id: `proj_${mat.id}_ao`, name: `${mat.name} (AO)`, type: 'ao', category: 'project', url: mat.aoMap, source: 'Proyecto' });
      }
      if (mat.displacementMap && !list.some(t => t.url === mat.displacementMap)) {
        list.push({ id: `proj_${mat.id}_disp`, name: `${mat.name} (Desplazamiento)`, type: 'displacement', category: 'project', url: mat.displacementMap, source: 'Proyecto' });
      }
    });

    // 4. Custom user uploaded textures
    customTextures.forEach(ct => {
      list.unshift({ id: ct.id, name: ct.name, type: ct.type || 'albedo', category: 'custom', url: ct.url, source: 'Subida por Usuario' });
    });

    return list;
  }, [materials, customTextures]);

  const handleApplyTextureToSelected = useCallback((texUrl: string, targetSlot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'displacementMap' = textureSlotTarget) => {
    const targetObjId = selectedObjectId;
    if (!targetObjId) {
      alert('Selecciona un objeto en la escena 3D para asignarle la textura.');
      return;
    }
    const obj = objects.find(o => o.id === targetObjId);
    if (!obj) return;

    let targetMatId = obj.materialId;
    if (!targetMatId) {
      targetMatId = 'mat_' + Math.random().toString(36).substr(2, 9);
      const newMat: MaterialData = {
        id: targetMatId,
        name: `Material ${obj.name || 'Objeto'}`,
        color: '#ffffff',
        roughness: 0.5,
        metalness: 0.0,
        emissive: '#000000',
        emissiveIntensity: 1,
        opacity: 1,
        transparent: false,
        [targetSlot]: texUrl,
      };
      addMaterial(newMat);
      assignMaterialToObjects([targetObjId], targetMatId);
      setEditingMaterialId(targetMatId);
    } else {
      updateMaterial(targetMatId, { [targetSlot]: texUrl });
    }

    useStore.getState().setViewMode('TEXTURED');
    useStore.getState().saveHistory();
    setCopiedNotification(`Asignado a "${obj.name || 'Objeto'}" (${targetSlot})`);
    setTimeout(() => setCopiedNotification(null), 2500);
  }, [selectedObjectId, objects, addMaterial, assignMaterialToObjects, setEditingMaterialId, updateMaterial, textureSlotTarget]);


  if (activeTab === 'library') {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#141417] text-zinc-300">
        {showPBRImport && (
          <PBRImportModal
            onClose={() => setShowPBRImport(false)}
            onImport={(mat) => {
              const newId = Math.random().toString(36).substr(2, 9);
              addMaterial({ ...mat, id: newId });
            }}
          />
        )}

        {/* ── SELECTOR SUPERIOR DE PESTAÑAS ── */}
        <div className="flex items-center p-1.5 bg-[#101013] border-b border-white/10 gap-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'library'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Sparkles size={12} />
            <span>Materiales</span>
          </button>
          <button
            onClick={() => setActiveTab('textures')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'textures'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <ImageIcon size={12} />
            <span>Texturas</span>
          </button>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'edit'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <SlidersHorizontal size={12} />
            <span>Editor</span>
          </button>
        </div>
        
        {/* Header */}
        <div className="p-3 border-b border-white/10 flex items-center justify-between bg-[#18181c]">
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-indigo-400" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-200">Librería de Materiales</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
              {MATERIAL_LIBRARY.length + materials.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setShowPBRImport(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-900/40 hover:bg-indigo-800/60 text-indigo-300 transition-colors text-[10px] font-bold border border-indigo-800/40"
              title="Importar pack PBR (.mtlx, .tres, .usda, PNG...)"
            >
              <FolderOpen size={12} /> Pack PBR
            </button>
            <button 
              onClick={handleImportMaterial}
              className="p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              title="Importar Material guardado (.json)"
            >
              <FileUp size={14} />
            </button>
            <button 
              onClick={handleCreateMaterial}
              className="p-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              title="Nuevo Material"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Buscador y Filtro por Categoría */}
        <div className="p-3 border-b border-white/5 space-y-2.5 bg-[#16161a]">
          {/* Botón de Acceso al Visor de Materiales 3D Aislado */}
          {!isMaterialStudioOpen ? (
            <button
              onClick={() => openMaterialStudio(activeMaterial?.id || (materials.length > 0 ? materials[0].id : undefined))}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-700 hover:from-indigo-500 hover:to-purple-600 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-98 border border-indigo-400/30"
              title="Abrir el visor de materiales 3D con esfera PBR e iluminación general (Ahorra recursos del editor)"
            >
              <Sparkles size={14} className="text-indigo-200" />
              <span>Abrir en Visor de Materiales 3D</span>
            </button>
          ) : (
            <button
              onClick={closeMaterialStudio}
              className="w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs flex items-center justify-center gap-2 border border-white/10 transition-colors"
              title="Regresar a la escena 3D principal"
            >
              <ArrowLeft size={13} />
              <span>Volver al Editor 3D</span>
            </button>
          )}

          {/* Barra de búsqueda */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input 
              type="text" 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              placeholder="Buscar material (ej. Terciopelo, Oro, Mármol...)" 
              className="w-full bg-zinc-900/90 border border-white/10 rounded-xl pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Categorías (Pills con scroll horizontal) */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-[11px]">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                selectedCategory === 'all'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>✨</span>
              <span>Todos</span>
            </button>

            <button
              onClick={() => setSelectedCategory('project')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                selectedCategory === 'project'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers size={11} />
              <span>Proyecto</span>
              <span className="opacity-60 text-[9px]">({materials.length})</span>
            </button>

            {/* Categoría de Materiales Importados de Modelos 3D */}
            <button
              onClick={() => setSelectedCategory('imported')}
              className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                selectedCategory === 'imported'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>📦</span>
              <span>Importados PBR</span>
              <span className="opacity-60 text-[9px]">
                ({materials.filter(m => m.category === 'imported' || m.id.startsWith('mat_imp_') || m.id.startsWith('mat_obj_') || Boolean(m.map && !m.proceduralBaseId)).length})
              </span>
            </button>

            {MATERIAL_CATEGORIES.map(cat => {
              const count = MATERIAL_LIBRARY.filter(m => m.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                    selectedCategory === cat.id
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                  <span className="opacity-60 text-[9px]">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CUADRÍCULA DE MINIATURAS CON SCROLL SEGURO ── */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar min-h-0 min-w-0 space-y-3">
          {/* Banner de Material Vinculado al Modelo Seleccionado */}
          {selectedObject && (
            <div className="p-3 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-zinc-900/50 border border-indigo-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Box size={14} className="text-indigo-400 flex-shrink-0" />
                  <span className="text-xs font-bold text-white truncate">
                    {selectedObject.name || 'Objeto Seleccionado'}
                  </span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30 flex-shrink-0">
                  {activeMaterial ? 'Material PBR Activo' : 'Sin Material Asignado'}
                </span>
              </div>
              
              {activeMaterial ? (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MaterialThumbnail material={activeMaterial} size={32} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-indigo-200 truncate">{activeMaterial.name}</p>
                      <div className="flex items-center gap-1.5 text-[9px] text-zinc-400 font-medium">
                        {activeMaterial.map && <span className="text-emerald-400">Color ✓</span>}
                        {activeMaterial.normalMap && <span className="text-cyan-400">Normal ✓</span>}
                        {activeMaterial.roughnessMap && <span className="text-amber-400">Rough ✓</span>}
                        {(activeMaterial.transmission ?? 0) > 0 && <span className="text-sky-300">Vidrio/Hielo ✓</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {selectedObject.meshData && (
                      <button
                        onClick={() => {
                          updateObject(selectedObject.id, {
                            materialId: undefined,
                            material: undefined,
                            color: '#ffffff'
                          });
                          setEditingMaterialId(null);
                          setCopiedNotification('¡Material restaurado al PBR original del modelo!');
                          setTimeout(() => setCopiedNotification(null), 2500);
                        }}
                        className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-[10px] font-bold transition-all border border-zinc-700"
                        title="Restaurar material nativo del archivo 3D"
                      >
                        Restaurar Nativo
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditingMaterialId(activeMaterial.id);
                        openMaterialStudio(activeMaterial.id);
                      }}
                      className="p-1.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white rounded-lg text-[10px] font-bold transition-all border border-indigo-500/30"
                      title="Abrir en Visor 3D"
                    >
                      <Sparkles size={13} />
                    </button>
                    <button
                      onClick={() => {
                        setEditingMaterialId(activeMaterial.id);
                        setActiveTab('edit');
                      }}
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all shadow"
                    >
                      Editar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="text-[11px] text-zinc-400">
                    {selectedObject.meshData ? 'Usando materiales y texturas nativas del modelo 3D' : 'Extraer mapas y propiedades PBR'}
                  </p>
                  <button
                    onClick={handleReextractPBRMapsFromSelectedObject}
                    className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold transition-all flex items-center gap-1"
                  >
                    <RefreshCw size={11} /> Extraer PBR
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 pb-8">
            {/* Materiales Procedimentales de la Librería */}
            {selectedCategory !== 'project' && selectedCategory !== 'imported' && MATERIAL_LIBRARY
              .filter(pMat => {
                if (selectedCategory !== 'all' && pMat.category !== selectedCategory) return false;
                if (searchQuery && !pMat.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
              })
              .map(pMat => {
                const thumbUrl = proceduralThumbnails.get(pMat.id);
                const catObj = MATERIAL_CATEGORIES.find(c => c.id === pMat.category);

                return (
                  <button
                    key={pMat.id}
                    onClick={() => handleSelectProceduralMaterial(pMat)}
                    className="group relative flex flex-col items-center p-2 rounded-xl border border-white/5 bg-zinc-900/40 hover:border-indigo-500/50 hover:bg-indigo-900/10 transition-all text-left overflow-hidden shadow-sm hover:shadow-indigo-500/10 min-h-[96px] cursor-pointer active:scale-95"
                    title={`Hacer clic para aplicar "${pMat.name}" al objeto seleccionado`}
                  >
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/10 relative flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-200">
                      {thumbUrl ? (
                        <img src={thumbUrl} alt={pMat.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl">{pMat.icon}</span>
                      )}
                      <div className="absolute top-0.5 left-0.5 bg-black/60 backdrop-blur-md px-1 py-0.5 rounded text-[8px] shadow">
                        {pMat.icon}
                      </div>
                    </div>

                    <span className="mt-1.5 text-[10px] font-semibold text-zinc-200 group-hover:text-white truncate w-full text-center px-1">
                      {pMat.name}
                    </span>

                    <span className="text-[9px] text-zinc-500 font-medium truncate w-full text-center px-1">
                      {catObj?.label || pMat.category}
                    </span>
                  </button>
                );
              })
            }

            {/* Materiales en el Proyecto Actual / Importados */}
            {(selectedCategory === 'all' || selectedCategory === 'project' || selectedCategory === 'imported') && materials
              .filter(mat => {
                const isImported = mat.category === 'imported' || mat.id.startsWith('mat_imp_') || mat.id.startsWith('mat_obj_') || Boolean(mat.map && !mat.proceduralBaseId);
                if (selectedCategory === 'imported' && !isImported) return false;
                if (searchQuery && !mat.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
              })
              .map(mat => {
                const isImported = mat.category === 'imported' || mat.id.startsWith('mat_imp_') || mat.id.startsWith('mat_obj_') || Boolean(mat.map && !mat.proceduralBaseId);
                return (
                  <button
                    key={mat.id}
                    onClick={() => {
                      const ids = (selectedObjectIds && selectedObjectIds.length > 0) ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
                      if (ids.length > 0) {
                        assignMaterialToObjects(ids, mat.id);
                        setCopiedNotification(`¡Material "${mat.name}" asignado al objeto!`);
                        setTimeout(() => setCopiedNotification(null), 2500);
                      }
                      setEditingMaterialId(mat.id);
                      setMaterialStudioMaterialId(mat.id);
                    }}
                    className={`group relative flex flex-col items-center p-2 rounded-xl border transition-all text-left overflow-hidden min-h-[96px] cursor-pointer active:scale-95 ${
                      activeMaterialId === mat.id 
                        ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_12px_rgba(99,102,241,0.2)]' 
                        : 'border-white/5 bg-zinc-900/40 hover:border-white/20'
                    }`}
                    title={`Hacer clic para asignar "${mat.name}"`}
                  >
                    <div className="relative">
                      <MaterialThumbnail material={mat} size={48} />
                      {activeMaterialId === mat.id && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-zinc-900 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                      )}
                      {isImported && (
                        <div className="absolute -bottom-1 -left-1 px-1 py-0.2 bg-purple-600/90 text-[8px] font-bold text-white rounded shadow">
                          PBR
                        </div>
                      )}
                    </div>

                    <span className="mt-1.5 text-[10px] font-semibold text-zinc-200 truncate w-full text-center px-1">
                      {mat.name}
                    </span>

                    <span className="text-[9px] text-indigo-400 font-medium">
                      {isImported ? '📦 Importado' : 'En Proyecto'}
                    </span>
                  </button>
                );
              })
            }
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'textures') {
    const categories = [
      { id: 'all', label: 'Todas', icon: '✨' },
      { id: 'albedo', label: 'Albedo / Color', icon: '🎨' },
      { id: 'normal', label: 'Normal Maps', icon: '🟣' },
      { id: 'roughness', label: 'Rugosidad', icon: '⚪' },
      { id: 'metalness', label: 'Metálico', icon: '🪙' },
      { id: 'ao', label: 'Oclusión (AO)', icon: '🌑' },
      { id: 'displacement', label: 'Desplazamiento', icon: '🏔️' },
      { id: 'uv_grid', label: 'Calibración UV', icon: '📐' },
      { id: 'custom', label: 'Mis Subidas', icon: '📂' },
    ];

    const filteredTextures = proceduralTexturesList.filter(t => {
      if (textureCategory !== 'all') {
        if (textureCategory === 'custom' && t.source !== 'Subida por Usuario') return false;
        if (textureCategory !== 'custom' && t.category !== textureCategory) return false;
      }
      if (textureSearch && !t.name.toLowerCase().includes(textureSearch.toLowerCase())) return false;
      return true;
    });

    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#141417] text-zinc-300">
        {/* ── SELECTOR SUPERIOR DE PESTAÑAS ── */}
        <div className="flex items-center p-1.5 bg-[#101013] border-b border-white/10 gap-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'library'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Sparkles size={12} />
            <span>Materiales</span>
          </button>
          <button
            onClick={() => setActiveTab('textures')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'textures'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <ImageIcon size={12} />
            <span>Texturas</span>
          </button>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'edit'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <SlidersHorizontal size={12} />
            <span>Editor</span>
          </button>
        </div>

        {/* Header Texturas */}
        <div className="p-3 border-b border-white/10 flex items-center justify-between bg-[#18181c]">
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-emerald-400" />
            <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-200">Librería de Texturas</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
              {filteredTextures.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white transition-colors text-[10px] font-bold shadow-sm">
              <Upload size={12} />
              <span>Subir Textura</span>
              <input
                type="file"
                className="hidden"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev: any) => {
                    const url = ev.target.result as string;
                    const name = file.name.replace(/\.[^/.]+$/, "");
                    const slot = detectSlotFromFilename(file.name);
                    const newTex = {
                      id: 'tex_' + Math.random().toString(36).substr(2, 9),
                      name,
                      url,
                      type: slot === 'albedo' ? 'albedo' : slot,
                    };
                    setCustomTextures(prev => [newTex, ...prev]);
                    setTextureCategory('custom');
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
        </div>

        {/* Notificación de asignación */}
        {copiedNotification && (
          <div className="px-3 py-1.5 bg-emerald-900/60 border-b border-emerald-500/30 text-emerald-200 text-[10px] font-medium flex items-center gap-1.5 animate-fadeIn">
            <Check size={12} className="text-emerald-400 flex-shrink-0" />
            <span className="truncate">{copiedNotification}</span>
          </div>
        )}

        {/* Selector de ranura objetivo y buscador */}
        <div className="p-3 border-b border-white/5 space-y-2.5 bg-[#16161a]">
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="text-zinc-400 font-semibold whitespace-nowrap">Ranura al hacer clic:</span>
            <select
              value={textureSlotTarget}
              onChange={e => setTextureSlotTarget(e.target.value as any)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-2 py-1 text-[11px] font-medium focus:outline-none focus:border-emerald-500"
            >
              <option value="map">Color / Albedo (map)</option>
              <option value="normalMap">Normal Map</option>
              <option value="roughnessMap">Rugosidad (Roughness)</option>
              <option value="metalnessMap">Metálico (Metalness)</option>
              <option value="aoMap">Oclusión Ambiental (AO)</option>
              <option value="displacementMap">Desplazamiento (Height)</option>
            </select>
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={textureSearch}
              onChange={e => setTextureSearch(e.target.value)}
              placeholder="Buscar textura (ej. Madera, Normal, Mármol...)"
              className="w-full bg-zinc-900/90 border border-white/10 rounded-xl pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
            />
            {textureSearch && (
              <button onClick={() => setTextureSearch('')} className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Categorías (Pills con scroll horizontal) */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-[11px]">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setTextureCategory(cat.id)}
                className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                  textureCategory === cat.id
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── CUADRÍCULA DE TEXTURAS ── */}
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar min-h-0 min-w-0">
          <div className="grid grid-cols-2 gap-3 pb-8">
            {filteredTextures.map(tex => {
              const typeBadgeColors: Record<string, string> = {
                albedo: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
                normal: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
                roughness: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40',
                metalness: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
                ao: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
                displacement: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
                uv_grid: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
              };

              return (
                <div
                  key={tex.id}
                  className="group relative flex flex-col p-2 rounded-xl border border-white/5 bg-zinc-900/60 hover:border-emerald-500/50 hover:bg-emerald-950/20 transition-all text-left overflow-hidden shadow-sm"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-texture-url', tex.url);
                    e.dataTransfer.setData('application/x-texture-type', tex.type);
                    e.dataTransfer.setData('text/plain', tex.url);
                  }}
                >
                  <div
                    onClick={() => handleApplyTextureToSelected(tex.url, textureSlotTarget)}
                    className="w-full aspect-square rounded-lg overflow-hidden bg-black/50 border border-white/10 relative flex items-center justify-center cursor-pointer group-hover:scale-[1.02] transition-transform duration-200"
                    title="Haz clic para aplicar al objeto seleccionado o arrastra al visor 3D"
                  >
                    <img src={tex.url} alt={tex.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    
                    <div className="absolute top-1.5 left-1.5">
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border backdrop-blur-md uppercase tracking-wider ${typeBadgeColors[tex.type] || 'bg-black/60 text-white'}`}>
                        {tex.type}
                      </span>
                    </div>

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-1 rounded-md shadow-lg">
                        Aplicar
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-col min-w-0">
                    <span className="text-[11px] font-semibold text-zinc-200 truncate group-hover:text-emerald-300">
                      {tex.name}
                    </span>
                    <span className="text-[9px] text-zinc-500 truncate">
                      {tex.source}
                    </span>
                  </div>

                  {/* Acciones rápidas de ranuras */}
                  <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between gap-1 text-[9px]">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApplyTextureToSelected(tex.url, 'map'); }}
                      className="flex-1 py-0.5 rounded bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white transition-colors text-center font-bold"
                      title="Asignar como Albedo / Color"
                    >
                      Color
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApplyTextureToSelected(tex.url, 'normalMap'); }}
                      className="flex-1 py-0.5 rounded bg-zinc-800 hover:bg-purple-600 text-zinc-300 hover:text-white transition-colors text-center font-bold"
                      title="Asignar como Normal Map"
                    >
                      Normal
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleApplyTextureToSelected(tex.url, 'roughnessMap'); }}
                      className="flex-1 py-0.5 rounded bg-zinc-800 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors text-center font-bold"
                      title="Asignar como Rugosidad"
                    >
                      Rugoso
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Zona de Drop rápida para archivos de imagen */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev: any) => {
                  const url = ev.target.result as string;
                  const name = file.name.replace(/\.[^/.]+$/, "");
                  const slot = detectSlotFromFilename(file.name);
                  const newTex = {
                    id: 'tex_' + Math.random().toString(36).substr(2, 9),
                    name,
                    url,
                    type: slot === 'albedo' ? 'albedo' : slot,
                  };
                  setCustomTextures(prev => [newTex, ...prev]);
                  setTextureCategory('custom');
                };
                reader.readAsDataURL(file);
              }
            }}
            className="mt-2 border-2 border-dashed border-zinc-800 hover:border-emerald-500/50 rounded-xl p-4 text-center text-zinc-500 hover:text-zinc-300 transition-colors bg-zinc-950/30"
          >
            <Upload size={18} className="mx-auto mb-1 text-zinc-600" />
            <p className="text-[11px] font-bold text-zinc-400">Arrastra archivos de imagen aquí</p>
            <p className="text-[9px] text-zinc-600 mt-0.5">Soporta PNG, JPG, WebP (Albedo, Normal, Roughness, Metalness, AO)</p>
          </div>
        </div>
      </div>
    );
  }

  if (!activeMaterial) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#141417] text-zinc-300">
        {/* ── SELECTOR SUPERIOR DE PESTAÑAS ── */}
        <div className="flex items-center p-1.5 bg-[#101013] border-b border-white/10 gap-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'library'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <Sparkles size={12} />
            <span>Materiales</span>
          </button>
          <button
            onClick={() => setActiveTab('textures')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'textures'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <ImageIcon size={12} />
            <span>Texturas</span>
          </button>
          <button
            onClick={() => setActiveTab('edit')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
              (activeTab as string) === 'edit'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            <SlidersHorizontal size={12} />
            <span>Editor</span>
          </button>
        </div>

        <div className="flex flex-col items-center justify-center h-full p-6 text-center text-zinc-400 space-y-4">
          <Palette size={40} className="opacity-30 text-indigo-400" />
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              {selectedObject ? `Objeto "${selectedObject.name || 'Sin Nombre'}" Seleccionado` : 'Ningún Objeto Seleccionado'}
            </p>
            <p className="text-[11px] text-zinc-500 max-w-xs">
              {selectedObject 
                ? 'Este objeto aún no tiene un material PBR asignado de la librería.'
                : 'Selecciona un objeto en el visor para vincular un material o abre la librería.'}
            </p>
          </div>
          
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {selectedObject && (
              <button
                onClick={() => {
                  const newMat = {
                    id: 'mat_' + Math.random().toString(36).substr(2, 9),
                    name: `Material ${selectedObject.name || 'Objeto'}`,
                    color: selectedObject.material?.color || selectedObject.color || '#ffffff',
                    roughness: selectedObject.material?.roughness ?? 0.5,
                    metalness: selectedObject.material?.metalness ?? 0,
                    emissive: '#000000',
                    emissiveIntensity: 1,
                    opacity: selectedObject.opacity ?? 1,
                    transparent: (selectedObject.opacity ?? 1) < 1,
                  };
                  addMaterial(newMat);
                  const ids = (selectedObjectIds && selectedObjectIds.length > 0) ? selectedObjectIds : [selectedObject.id];
                  assignMaterialToObjects(ids, newMat.id);
                  setEditingMaterialId(newMat.id);
                  setActiveTab('edit');
                }}
                className="py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
              >
                <Plus size={14} /> Crear Nuevo Material PBR
              </button>
            )}

            <button 
              onClick={() => setActiveTab('library')}
              className="py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-white/10 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-2"
            >
              <FolderOpen size={14} className="text-indigo-400" /> Explorar Librería / Importar Pack PBR
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#141417] text-zinc-300 overflow-hidden">
      {/* ── SELECTOR SUPERIOR DE PESTAÑAS ── */}
      <div className="flex items-center p-1.5 bg-[#101013] border-b border-white/10 gap-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab('library')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            (activeTab as string) === 'library'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Sparkles size={12} />
          <span>Materiales</span>
        </button>
        <button
          onClick={() => setActiveTab('textures')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            (activeTab as string) === 'textures'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <ImageIcon size={12} />
          <span>Texturas</span>
        </button>
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
            (activeTab as string) === 'edit'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <SlidersHorizontal size={12} />
          <span>Editor</span>
        </button>
      </div>

      {/* Header del Panel Corregido (Evita desbordamiento de Asignar) */}
      <div className="p-3 border-b border-white/10 flex items-center justify-between bg-[#1a1a1f] w-full min-w-0 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Botón Volver Flecha */}
          <button 
            onClick={() => setActiveTab('library')}
            className="p-1 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-white transition-colors flex items-center justify-center flex-shrink-0"
            title="Volver a la Librería"
          >
            <ArrowLeft size={14} />
          </button>
          
          {/* Miniatura del Material */}
          <div className="flex-shrink-0 scale-90">
            <MaterialThumbnail material={activeMaterial} size={28} />
          </div>

          {/* Nombre del Material con elipsis si es muy largo */}
          <input 
            value={activeMaterial.name}
            onChange={e => updateMaterial(activeMaterial.id, { name: e.target.value })}
            className="bg-transparent border-none focus:ring-0 font-bold text-xs p-0 text-white outline-none font-sans min-w-0 flex-1 truncate"
            style={{ minWidth: '50px' }}
          />
        </div>

        {/* Bloque de Botones de Acción Derecho */}
        <div className="flex items-center gap-1 flex-shrink-0 ml-1">
          {!isMaterialStudioOpen && (
            <button 
              onClick={() => openMaterialStudio(activeMaterial.id)}
              className="p-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white transition-all flex-shrink-0 border border-indigo-500/30" 
              title="Abrir en Visor de Materiales 3D Aislado (Esfera PBR)"
            >
              <Sparkles size={13} />
            </button>
          )}

          <button 
            onClick={() => {
              const ids = (selectedObjectIds && selectedObjectIds.length > 0) ? selectedObjectIds : (selectedObjectId ? [selectedObjectId] : []);
              if (ids.length > 0) assignMaterialToObjects(ids, activeMaterial.id);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black tracking-wider transition-all active:scale-95 flex-shrink-0 shadow-md uppercase"
          >
            ASIGNAR
          </button>

          <button 
            onClick={() => {
              const newId = 'mat_' + Math.random().toString(36).substr(2, 9);
              const clone = { ...activeMaterial, id: newId, name: `${activeMaterial.name} (Copia)` };
              addMaterial(clone);
              setEditingMaterialId(newId);
            }} 
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-400 hover:text-indigo-400 transition-colors flex-shrink-0" 
            title="Duplicar Material"
          >
            <Copy size={13} />
          </button>
          
          <button 
            onClick={handleExportMaterial} 
            className="p-1.5 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-indigo-400 transition-colors flex-shrink-0" 
            title="Exportar Material PBR (.json)"
          >
            <Download size={14} />
          </button>
          
          <button 
            onClick={() => removeMaterial(activeMaterial.id)} 
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-colors flex-shrink-0" 
            title="Eliminar Material"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Contenido con Scroll Protegido */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar max-w-full overflow-x-hidden">
        
        {/* ── PRESETS FÍSICOS CALIBRADOS DE ACCESO RÁPIDO CON FILTRO DE CATEGORÍA ── */}
        <div className="bg-zinc-900/80 p-2.5 rounded-xl border border-white/10 space-y-2 shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
              <span>✨</span> Presets Calibrados
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-zinc-500 font-mono">
                {PHYSICALLY_CALIBRATED_PRESETS.filter(p => {
                  if (presetCategoryFilter === 'all') return true;
                  if (presetCategoryFilter === 'csm') return p.category === 'Custom Shaders (CSM)' || p.apply.isCSM;
                  if (presetCategoryFilter === 'glass') return p.category === 'Vidrio & Gemas' || (p.apply.transmission && p.apply.transmission > 0);
                  if (presetCategoryFilter === 'metal') return p.category === 'Metales';
                  if (presetCategoryFilter === 'ice') return p.category === 'Hielo & Nieve';
                  if (presetCategoryFilter === 'wood_stone') return p.category === 'Madera & Piedra';
                  if (presetCategoryFilter === 'volumetric') return p.category === 'Volumétricos 3D' || p.apply.isVolumetric;
                  if (presetCategoryFilter === 'paint') return p.category === 'Lacados & Pinturas' || p.category === 'Textiles';
                  return p.category === presetCategoryFilter;
                }).length} presets
              </span>
            </div>
          </div>

          {/* Selector de subcategorías de Presets */}
          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar pb-1 text-[9px]">
            {[
              { id: 'all', label: 'Todos', icon: '✨' },
              { id: 'csm', label: '🌀 CSM Shaders', icon: '🌀' },
              { id: 'glass', label: '💎 Vidrios & Gemas', icon: '💎' },
              { id: 'metal', label: '🪙 Metales', icon: '⚙️' },
              { id: 'ice', label: '❄️ Hielo & Nieve', icon: '❄️' },
              { id: 'volumetric', label: '🔥 Volumétricos', icon: '🔥' },
              { id: 'wood_stone', label: '🪵 Madera/Piedra', icon: '🪨' },
              { id: 'paint', label: '🎨 Pintura/Telas', icon: '🎨' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setPresetCategoryFilter(cat.id)}
                className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-all font-medium flex items-center gap-1 border ${
                  presetCategoryFilter === cat.id
                    ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm shadow-indigo-500/20'
                    : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 border-white/5 hover:border-white/20'
                }`}
              >
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Carrusel de botones de presets */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 pt-0.5">
            {PHYSICALLY_CALIBRATED_PRESETS
              .filter(preset => {
                if (presetCategoryFilter === 'all') return true;
                if (presetCategoryFilter === 'csm') return preset.category === 'Custom Shaders (CSM)' || preset.apply.isCSM;
                if (presetCategoryFilter === 'glass') return preset.category === 'Vidrio & Gemas' || (preset.apply.transmission && preset.apply.transmission > 0);
                if (presetCategoryFilter === 'metal') return preset.category === 'Metales';
                if (presetCategoryFilter === 'ice') return preset.category === 'Hielo & Nieve';
                if (presetCategoryFilter === 'wood_stone') return preset.category === 'Madera & Piedra';
                if (presetCategoryFilter === 'volumetric') return preset.category === 'Volumétricos 3D' || preset.apply.isVolumetric;
                if (presetCategoryFilter === 'paint') return preset.category === 'Lacados & Pinturas' || preset.category === 'Textiles';
                return preset.category === presetCategoryFilter;
              })
              .map((preset, idx) => {
                const isCSM = preset.category === 'Custom Shaders (CSM)' || preset.apply.isCSM;
                return (
                  <button
                    key={idx}
                    onClick={() => updateMaterial(activeMaterial.id, preset.apply)}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all flex items-center gap-1.5 flex-shrink-0 shadow-sm border ${
                      isCSM
                        ? 'bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-200 hover:text-white border-indigo-500/40 hover:border-indigo-400 ring-1 ring-indigo-500/20'
                        : 'bg-zinc-800/90 hover:bg-indigo-600/30 text-zinc-300 hover:text-white border-white/5 hover:border-indigo-500/40'
                    }`}
                    title={`${preset.name}: ${preset.description}`}
                  >
                    <span className="text-xs">{preset.icon}</span>
                    <span>{preset.name}</span>
                  </button>
                );
              })}
          </div>
        </div>

        {/* ── SECCIÓN VOLUMÉTRICA 3D (RAYMARCHING: FUEGO, GAS, PLASMA, HUMO, HIELO) ── */}
        <div className="bg-gradient-to-br from-amber-950/30 via-zinc-900/60 to-cyan-950/30 rounded-xl border border-amber-500/30 overflow-hidden shadow-lg">
          <button 
            onClick={() => toggleSection('volumetric')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-300">
              <span className="text-sm">🔥</span>
              <span>Propiedades Volumétricas 3D (Raymarching)</span>
              {activeMaterial.isVolumetric && (
                <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/40">ACTIVO</span>
              )}
            </div>
            {openSections.volumetric ? <ChevronDown size={14} className="text-amber-400" /> : <ChevronRight size={14} className="text-amber-400" />}
          </button>

          {openSections.volumetric && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5 bg-black/20">
              {/* Toggle Volumetric Mode */}
              <div className="flex items-center justify-between bg-white/5 p-2 rounded-lg border border-white/5">
                <div>
                  <span className="text-[10px] font-bold text-zinc-200">Modo Volumétrico Raymarching</span>
                  <p className="text-[8px] text-zinc-400">Renderizado 3D real de volumen en shader (sin caras planas)</p>
                </div>
                <button
                  onClick={() => {
                    const isVol = !activeMaterial.isVolumetric;
                    updateMaterial(activeMaterial.id, {
                      isVolumetric: isVol,
                      volumetric: {
                        enabled: isVol,
                        mode: activeMaterial.volumetric?.mode || 'cloud',
                        density: activeMaterial.volumetric?.density ?? 2.0,
                        scale: activeMaterial.volumetric?.scale ?? 2.0,
                        lightIntensity: activeMaterial.volumetric?.lightIntensity ?? 1.5,
                        color: activeMaterial.color || '#ffffff',
                        secondaryColor: activeMaterial.volumetric?.secondaryColor || '#fbbf24',
                        emissiveIntensity: activeMaterial.volumetric?.emissiveIntensity ?? 2.0,
                        threshold: activeMaterial.volumetric?.threshold ?? 0.35,
                        thresholdMax: activeMaterial.volumetric?.thresholdMax ?? 0.80,
                        absorption: activeMaterial.volumetric?.absorption ?? 2.0,
                        steps: activeMaterial.volumetric?.steps ?? 36,
                        shadowSteps: activeMaterial.volumetric?.shadowSteps ?? 6,
                        windSpeed: activeMaterial.volumetric?.windSpeed ?? 0.15,
                        windDirection: activeMaterial.volumetric?.windDirection ?? [0.0, 1.0, 0.0],
                        blending: activeMaterial.volumetric?.blending ?? 'normal',
                      }
                    });
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all ${
                    activeMaterial.isVolumetric 
                      ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20' 
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {activeMaterial.isVolumetric ? 'Activado' : 'Desactivado'}
                </button>
              </div>

              {activeMaterial.isVolumetric && (
                <>
                  {/* Selector de Tipo de Volumen */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">Tipo de Medio Volumétrico</label>
                    <div className="grid grid-cols-6 gap-1">
                      {[
                        { id: 'cloud', label: 'Nube', icon: '☁️', color: '#ffffff', sec: '#cbd5e1', blend: 'normal' },
                        { id: 'fire', label: 'Fuego', icon: '🔥', color: '#ef4444', sec: '#fbbf24', blend: 'additive' },
                        { id: 'explosion', label: 'Explosión', icon: '💥', color: '#ef4444', sec: '#fbbf24', blend: 'additive' },
                        { id: 'plasma', label: 'Plasma', icon: '⚡', color: '#06b6d4', sec: '#a855f7', blend: 'additive' },
                        { id: 'smoke', label: 'Humo', icon: '💨', color: '#94a3b8', sec: '#64748b', blend: 'normal' },
                        { id: 'ice', label: 'Hielo', icon: '🧊', color: '#bae6fd', sec: '#38bdf8', blend: 'normal' },
                      ].map(m => {
                        const isCur = (activeMaterial.volumetric?.mode || 'cloud') === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              updateMaterial(activeMaterial.id, {
                                color: isCur ? activeMaterial.color : m.color,
                                volumetric: {
                                  ...activeMaterial.volumetric,
                                  mode: m.id as any,
                                  color: isCur ? (activeMaterial.volumetric?.color || activeMaterial.color) : m.color,
                                  secondaryColor: m.sec,
                                  blending: m.blend as any,
                                  emissiveIntensity: m.blend === 'additive' ? 2.8 : 0.5,
                                }
                              });
                            }}
                            className={`p-1.5 rounded-lg text-center transition-all border ${
                              isCur
                                ? 'bg-amber-500/30 border-amber-400 text-white font-bold shadow-sm'
                                : 'bg-zinc-800/60 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                            }`}
                          >
                            <span className="text-sm block">{m.icon}</span>
                            <span className="text-[8px] font-bold block">{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Colores Primario y Secundario (Gradiente térmico o dispersión) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400">Color Primario / Núcleo</label>
                      <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/5">
                        <input 
                          type="color" 
                          value={activeMaterial.volumetric?.color || activeMaterial.color || '#ffffff'}
                          onChange={e => updateMaterial(activeMaterial.id, { 
                            color: e.target.value,
                            volumetric: { ...activeMaterial.volumetric, color: e.target.value } 
                          })}
                          className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                        />
                        <span className="text-[9px] font-mono uppercase text-zinc-300">{activeMaterial.volumetric?.color || activeMaterial.color || '#ffffff'}</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-400">Color Secundario / Borde</label>
                      <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg border border-white/5">
                        <input 
                          type="color" 
                          value={activeMaterial.volumetric?.secondaryColor || '#fbbf24'}
                          onChange={e => updateMaterial(activeMaterial.id, { 
                            volumetric: { ...activeMaterial.volumetric, secondaryColor: e.target.value } 
                          })}
                          className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                        />
                        <span className="text-[9px] font-mono uppercase text-zinc-300">{activeMaterial.volumetric?.secondaryColor || '#fbbf24'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Sliders de Densidad, Escala y Emisión */}
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Densidad Volumétrica</label>
                        <span className="font-mono text-amber-400 font-bold">{(activeMaterial.volumetric?.density ?? 2.0).toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.2" max="6.0" step="0.1"
                        value={activeMaterial.volumetric?.density ?? 2.0}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, density: parseFloat(e.target.value) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Escala de Ruido 3D (Frecuencia)</label>
                        <span className="font-mono text-amber-400 font-bold">{(activeMaterial.volumetric?.scale ?? 2.0).toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.5" max="8.0" step="0.1"
                        value={activeMaterial.volumetric?.scale ?? 2.0}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, scale: parseFloat(e.target.value) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Intensidad Emisiva / Luminosidad</label>
                        <span className="font-mono text-amber-400 font-bold">{(activeMaterial.volumetric?.emissiveIntensity ?? 2.0).toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.0" max="6.0" step="0.1"
                        value={activeMaterial.volumetric?.emissiveIntensity ?? 2.0}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, emissiveIntensity: parseFloat(e.target.value) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Absorción de Luz (Beer-Lambert)</label>
                        <span className="font-mono text-amber-400 font-bold">{(activeMaterial.volumetric?.absorption ?? 2.0).toFixed(1)}</span>
                      </div>
                      <input 
                        type="range" min="0.2" max="6.0" step="0.1"
                        value={activeMaterial.volumetric?.absorption ?? 2.0}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, absorption: parseFloat(e.target.value) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Velocidad de Flujo / Convección</label>
                        <span className="font-mono text-amber-400 font-bold">{(activeMaterial.volumetric?.windSpeed ?? 0.15).toFixed(2)}</span>
                      </div>
                      <input 
                        type="range" min="0.0" max="1.0" step="0.02"
                        value={activeMaterial.volumetric?.windSpeed ?? 0.15}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, windSpeed: parseFloat(e.target.value) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[10px]">
                        <label className="text-zinc-400">Pasos de Raymarching (Calidad)</label>
                        <span className="font-mono text-amber-400 font-bold">{activeMaterial.volumetric?.steps ?? 36}</span>
                      </div>
                      <input 
                        type="range" min="16" max="64" step="4"
                        value={activeMaterial.volumetric?.steps ?? 36}
                        onChange={e => updateMaterial(activeMaterial.id, { 
                          volumetric: { ...activeMaterial.volumetric, steps: parseInt(e.target.value, 10) } 
                        })}
                        className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── SECCIÓN 1: SUPERFICIE BASE & COLOR ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('basic')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Palette size={13} className="text-indigo-400" />
              <span>Superficie Base & Color</span>
            </div>
            {openSections.basic ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>
          
          {openSections.basic && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              {/* Color Base & Opacidad */}
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500">Color Base</label>
                  <div className="flex items-center gap-2 bg-white/5 p-1.5 h-8 rounded-lg border border-white/5">
                    <input 
                      type="color" 
                      value={activeMaterial.color}
                      onChange={e => updateMaterial(activeMaterial.id, { color: e.target.value })}
                      className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                    />
                    <span className="text-[10px] font-mono uppercase text-zinc-300">{activeMaterial.color}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-500">Opacidad</label>
                    <span className="font-mono text-indigo-400">{(activeMaterial.opacity * 100).toFixed(0)}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={activeMaterial.opacity}
                    onChange={e => updateMaterial(activeMaterial.id, { 
                      opacity: parseFloat(e.target.value),
                      transparent: parseFloat(e.target.value) < 1 || (activeMaterial.transmission ?? 0) > 0
                    })}
                    className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Rugosidad & Metalicidad */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-500">Rugosidad (Roughness)</label>
                    <span className="font-mono text-zinc-400">{(activeMaterial.roughness ?? 0.5).toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={activeMaterial.roughness}
                    onChange={e => updateMaterial(activeMaterial.id, { roughness: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-500">Metalicidad (Metalness)</label>
                    <span className="font-mono text-zinc-400">{(activeMaterial.metalness ?? 0.0).toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={activeMaterial.metalness}
                    onChange={e => updateMaterial(activeMaterial.id, { metalness: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Intensidad Especular */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-500">Reflejo Especular (Specular Intensity)</label>
                  <span className="font-mono text-zinc-400">{(activeMaterial.specularIntensity ?? 1.0).toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="2" step="0.05"
                  value={activeMaterial.specularIntensity ?? 1.0}
                  onChange={e => updateMaterial(activeMaterial.id, { specularIntensity: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* 🎨 MODIFICADOR Y AJUSTE DE COLORES DE MAPA ALBEDO */}
              <div className="pt-2 border-t border-white/5 space-y-2">
                <button
                  onClick={() => setAlbedoAdjustOpen(v => !v)}
                  className={`w-full py-1.5 px-2.5 rounded-lg text-[10px] font-bold flex items-center justify-between transition-all border ${
                    albedoAdjustOpen 
                      ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40' 
                      : 'bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 border-white/5'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Wand2 size={12} className="text-indigo-400" />
                    <span>Ajustar / Teñir Color del Mapa Albedo</span>
                  </span>
                  <span className="text-[8px] font-mono text-zinc-400">
                    {albedoAdjustOpen ? 'Ocultar ▲' : 'Desplegar ▼'}
                  </span>
                </button>

                {albedoAdjustOpen && (
                  <div className="p-2.5 bg-black/30 rounded-xl border border-white/5 space-y-2.5">
                    {/* Tinte de Color */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] text-zinc-400 font-semibold">Tinte de Color</label>
                        <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-lg border border-white/5">
                          <input 
                            type="color" 
                            value={albedoColorAdjustments.tintColor || '#ffffff'}
                            onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, tintColor: e.target.value }))}
                            className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                          />
                          <span className="text-[9px] font-mono text-zinc-300 truncate">{albedoColorAdjustments.tintColor || '#ffffff'}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[9px]">
                          <label className="text-zinc-400 font-semibold">Intensidad Tinte</label>
                          <span className="font-mono text-indigo-400">{((albedoColorAdjustments.tintAmount || 0) * 100).toFixed(0)}%</span>
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.02"
                          value={albedoColorAdjustments.tintAmount || 0}
                          onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, tintAmount: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Desplazamiento de Tono (Hue) */}
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-[9px]">
                        <label className="text-zinc-400 font-semibold">Desplazamiento Tonal (Hue Shift)</label>
                        <span className="font-mono text-cyan-400">{albedoColorAdjustments.hueShift || 0}°</span>
                      </div>
                      <input 
                        type="range" min="-180" max="180" step="1"
                        value={albedoColorAdjustments.hueShift || 0}
                        onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, hueShift: parseInt(e.target.value, 10) }))}
                        className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                      />
                    </div>

                    {/* Saturación & Brillo */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[9px]">
                          <label className="text-zinc-400">Saturación</label>
                          <span className="font-mono text-zinc-300">{((albedoColorAdjustments.saturation ?? 1) * 100).toFixed(0)}%</span>
                        </div>
                        <input 
                          type="range" min="0" max="2" step="0.05"
                          value={albedoColorAdjustments.saturation ?? 1}
                          onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, saturation: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[9px]">
                          <label className="text-zinc-400">Brillo</label>
                          <span className="font-mono text-zinc-300">{((albedoColorAdjustments.brightness ?? 1) * 100).toFixed(0)}%</span>
                        </div>
                        <input 
                          type="range" min="0.3" max="2" step="0.05"
                          value={albedoColorAdjustments.brightness ?? 1}
                          onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, brightness: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Contraste & Inversión */}
                    <div className="grid grid-cols-2 gap-2 items-center">
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[9px]">
                          <label className="text-zinc-400">Contraste</label>
                          <span className="font-mono text-zinc-300">{((albedoColorAdjustments.contrast ?? 1) * 100).toFixed(0)}%</span>
                        </div>
                        <input 
                          type="range" min="0.4" max="2" step="0.05"
                          value={albedoColorAdjustments.contrast ?? 1}
                          onChange={e => setAlbedoColorAdjustments(prev => ({ ...prev, contrast: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between pt-3">
                        <span className="text-[9px] text-zinc-400 font-semibold">Invertir</span>
                        <button
                          onClick={() => setAlbedoColorAdjustments(prev => ({ ...prev, invert: !prev.invert }))}
                          className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${
                            albedoColorAdjustments.invert 
                              ? 'bg-amber-600/30 text-amber-300 border-amber-500/40' 
                              : 'bg-zinc-800 text-zinc-400 border-white/5'
                          }`}
                        >
                          {albedoColorAdjustments.invert ? 'SÍ' : 'NO'}
                        </button>
                      </div>
                    </div>

                    {/* Botones de Acción */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={handleApplyAlbedoColor}
                        disabled={isProcessingAlbedo || !activeMaterial.map}
                        className="py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1 shadow-sm"
                      >
                        <Wand2 size={11} />
                        <span>{isProcessingAlbedo ? 'Procesando...' : 'Aplicar al Mapa'}</span>
                      </button>

                      <button
                        onClick={handleResetAlbedoColor}
                        className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1 border border-white/5"
                      >
                        <RefreshCw size={11} />
                        <span>Restaurar Color</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 2: MAPAS NORMALES & FORMATO DIRECTX / OPENGL ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('normal')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Sliders size={13} className="text-cyan-400" />
              <span>Normales & Relieve PBR</span>
              {activeMaterial.normalFormat === 'DIRECTX' && (
                <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1 rounded border border-cyan-500/30">DirectX (-Y)</span>
              )}
            </div>
            {openSections.normal ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.normal && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              {/* Selector de Formato Normal Map (DirectX vs OpenGL) */}
              <div className="space-y-1.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-semibold text-zinc-300">Formato de Normal Map</label>
                  <span className="text-[9px] text-zinc-500 font-mono">
                    {activeMaterial.normalFormat === 'DIRECTX' || activeMaterial.invertNormalY ? 'Canal Y Invertido (-Y)' : 'Estándar (+Y)'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => updateMaterial(activeMaterial.id, { normalFormat: 'OPENGL', invertNormalY: false })}
                    className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition-all text-center ${
                      (activeMaterial.normalFormat !== 'DIRECTX' && !activeMaterial.invertNormalY)
                        ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500 shadow-sm'
                        : 'bg-zinc-800/60 text-zinc-400 border-white/5 hover:bg-zinc-800'
                    }`}
                  >
                    OpenGL (+Y)
                    <span className="block text-[8px] font-normal text-zinc-400">Blender / Three.js / Maya</span>
                  </button>
                  <button
                    onClick={() => updateMaterial(activeMaterial.id, { normalFormat: 'DIRECTX', invertNormalY: true })}
                    className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition-all text-center ${
                      (activeMaterial.normalFormat === 'DIRECTX' || activeMaterial.invertNormalY)
                        ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500 shadow-sm'
                        : 'bg-zinc-800/60 text-zinc-400 border-white/5 hover:bg-zinc-800'
                    }`}
                  >
                    DirectX (-Y)
                    <span className="block text-[8px] font-normal text-zinc-400">cgbookcase / Unreal / 3ds Max</span>
                  </button>
                </div>
                <p className="text-[8px] text-zinc-500 leading-tight pt-1">
                  * cgbookcase y Unreal usan normales DirectX (-Y). Si el relieve se ve hundido o invertido con la luz, activa DirectX (-Y).
                </p>
              </div>

              {/* Fuerza de Normal Map */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-500">Escala de Normales (Normal Scale)</label>
                  <span className="font-mono text-cyan-400">{(activeMaterial.normalScale ?? 1.0).toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="3" step="0.05"
                  value={activeMaterial.normalScale ?? 1.0}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    updateMaterial(activeMaterial.id, { normalScale: val });
                  }}
                  className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Relieve Geométrico (Displacement) */}
              <div className="space-y-1.5 bg-white/5 p-2 rounded-lg border border-white/5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-300 font-semibold">Fuerza de Relieve (Displacement Scale)</span>
                  <span className="font-mono text-cyan-400">{(activeMaterial.displacementScale ?? 0.0).toFixed(3)}</span>
                </div>
                <input 
                  type="range" min="0" max="0.08" step="0.001" 
                  value={activeMaterial.displacementScale ?? 0.0} 
                  onChange={(e) => updateMaterial(activeMaterial.id, { displacementScale: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 2.5: POROSIDAD Y MATIZADO ORGÁNICO DE SUPERFICIE ── */}
        <div className="bg-emerald-950/25 rounded-xl border border-emerald-500/25 overflow-hidden">
          <button 
            onClick={() => toggleSection('porosity')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-emerald-500/10 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-300">
              <span className="text-sm">🧽</span>
              <span>Porosidad & Microcavidades (Superficie Mate)</span>
              {(activeMaterial.porosity || (activeMaterial.porosityStrength ?? 0) > 0) && (
                <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1 rounded border border-emerald-500/30">
                  ACTIVO
                </span>
              )}
            </div>
            {openSections.porosity ? <ChevronDown size={14} className="text-emerald-400" /> : <ChevronRight size={14} className="text-emerald-400" />}
          </button>

          {openSections.porosity && (
            <div className="p-3 pt-1 space-y-3 border-t border-emerald-500/20">
              {/* Toggle de Activación */}
              <div className="flex items-center justify-between bg-black/30 p-2 rounded-lg border border-emerald-500/20">
                <div>
                  <span className="text-[10px] font-bold text-zinc-200">Activar Porosidad y Mateado</span>
                  <p className="text-[8.5px] text-zinc-400">Elimina el aspecto plástico/demasiado liso creando microcavidades y parches mates</p>
                </div>
                <input 
                  type="checkbox"
                  checked={Boolean(activeMaterial.porosity)}
                  onChange={e => {
                    const enabled = e.target.checked;
                    updateMaterial(activeMaterial.id, {
                      porosity: enabled,
                      porosityStrength: enabled ? (activeMaterial.porosityStrength || 0.65) : 0,
                      porosityScale: activeMaterial.porosityScale ?? 18.0,
                      porosityPatchiness: activeMaterial.porosityPatchiness ?? 0.65,
                      porosityPatchScale: activeMaterial.porosityPatchScale ?? 3.0,
                      porosityMatteBias: activeMaterial.porosityMatteBias ?? 0.8,
                      porosityCavityDarkening: activeMaterial.porosityCavityDarkening ?? 0.25,
                    });
                  }}
                  className="rounded accent-emerald-400 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* Presets Rápidos de Porosidad */}
              <div className="space-y-1">
                <span className="text-[8.5px] text-zinc-400 font-semibold uppercase">Presets Rápidos de Porosidad:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: '🧽 Microcavidades', desc: 'Finas y sutiles', p: { porosity: true, porosityStrength: 0.5, porosityScale: 32, porosityPatchiness: 0.15, porosityPatchScale: 2, porosityMatteBias: 0.6, porosityCavityDarkening: 0.2 } },
                    { label: '🪨 Piedra / Cemento', desc: 'Poros profundos', p: { porosity: true, porosityStrength: 0.95, porosityScale: 14, porosityPatchiness: 0.75, porosityPatchScale: 2.5, porosityMatteBias: 0.9, porosityCavityDarkening: 0.4 } },
                    { label: '🧊 Hielo Escarchado', desc: 'Mateado & burbujas', p: { porosity: true, porosityStrength: 0.7, porosityScale: 24, porosityPatchiness: 0.85, porosityPatchScale: 4.0, porosityMatteBias: 0.85, porosityCavityDarkening: 0.1 } },
                    { label: '🏺 Barro / Cerámica', desc: 'Áspero artesanal', p: { porosity: true, porosityStrength: 0.8, porosityScale: 18, porosityPatchiness: 0.55, porosityPatchScale: 3.0, porosityMatteBias: 0.8, porosityCavityDarkening: 0.3 } },
                  ].map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => updateMaterial(activeMaterial.id, preset.p)}
                      className="p-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-emerald-500/20 hover:border-emerald-400/40 text-left transition-all cursor-pointer group"
                    >
                      <span className="text-[9.5px] font-bold text-zinc-200 group-hover:text-emerald-300 block truncate">{preset.label}</span>
                      <span className="text-[8px] text-zinc-500 block truncate">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders de Configuración de Porosidad */}
              <div className="space-y-2 pt-1">
                {/* Fuerza / Profundidad */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Fuerza / Profundidad de Microcavidades</label>
                    <span className="font-mono text-emerald-400 font-bold">
                      {((activeMaterial.porosityStrength ?? (activeMaterial.porosity ? 0.65 : 0)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1.5" step="0.02"
                    value={activeMaterial.porosityStrength ?? (activeMaterial.porosity ? 0.65 : 0)}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      updateMaterial(activeMaterial.id, {
                        porosityStrength: val,
                        porosity: val > 0,
                      });
                    }}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Densidad / Tamaño de Poros */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Densidad / Frecuencia Espacial (Frecuencia)</label>
                    <span className="font-mono text-emerald-300 font-bold">
                      {(activeMaterial.porosityScale ?? 18.0).toFixed(1)}
                    </span>
                  </div>
                  <input 
                    type="range" min="2.0" max="60.0" step="1.0"
                    value={activeMaterial.porosityScale ?? 18.0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      porosityScale: parseFloat(e.target.value),
                      porosity: true,
                    })}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Distribución en Zonas / Parches */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Distribución en Zonas / Parches Desiguales</label>
                    <span className="font-mono text-emerald-300 font-bold">
                      {(((activeMaterial.porosityPatchiness ?? 0.65)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1.0" step="0.05"
                    value={activeMaterial.porosityPatchiness ?? 0.65}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      porosityPatchiness: parseFloat(e.target.value),
                      porosity: true,
                    })}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                  <p className="text-[8px] text-zinc-500 leading-tight">
                    * Al 0% toda la superficie es porosa uniforme; a valores altos solo afecta parches aleatorios orgánicos.
                  </p>
                </div>

                {/* Escala de los Parches */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Escala de Zonas / Parches</label>
                    <span className="font-mono text-zinc-300 font-bold">
                      {(activeMaterial.porosityPatchScale ?? 3.0).toFixed(1)}
                    </span>
                  </div>
                  <input 
                    type="range" min="0.5" max="15.0" step="0.5"
                    value={activeMaterial.porosityPatchScale ?? 3.0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      porosityPatchScale: parseFloat(e.target.value),
                      porosity: true,
                    })}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Opacado / Mateado */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Opacado / Mateado de Poros (Eliminar Brillo Plástico)</label>
                    <span className="font-mono text-emerald-300 font-bold">
                      {(((activeMaterial.porosityMatteBias ?? 0.8)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1.0" step="0.05"
                    value={activeMaterial.porosityMatteBias ?? 0.8}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      porosityMatteBias: parseFloat(e.target.value),
                      porosity: true,
                    })}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Oscurecimiento de Cavidades */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Sombreado / Oclusión en Fondo de Cavidades</label>
                    <span className="font-mono text-zinc-300 font-bold">
                      {(((activeMaterial.porosityCavityDarkening ?? 0.25)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="0.8" step="0.02"
                    value={activeMaterial.porosityCavityDarkening ?? 0.25}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      porosityCavityDarkening: parseFloat(e.target.value),
                      porosity: true,
                    })}
                    className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3: VIDRIO, TRANSMISIÓN Y GEMAS ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('glass')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Glasses size={13} className="text-blue-400" />
              <span>Vidrio, Transmisión & Gemas</span>
              {(activeMaterial.transmission ?? 0) > 0 && (
                <span className="text-[8px] bg-blue-500/20 text-blue-300 px-1 rounded border border-blue-500/30">
                  {((activeMaterial.transmission ?? 0) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {openSections.glass ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.glass && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              {/* Slider Transmisión */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Transmisión (Vidrio / Refracción)</label>
                  <span className="font-mono text-blue-400 font-bold">{((activeMaterial.transmission ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.transmission ?? 0}
                  onChange={e => {
                    const val = parseFloat(e.target.value);
                    updateMaterial(activeMaterial.id, { 
                      transmission: val,
                      transparent: val > 0 || (activeMaterial.opacity ?? 1) < 1
                    });
                  }}
                  className="w-full accent-blue-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Selector de IOR con Presets Rápidos */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Índice de Refracción (IOR)</label>
                  <span className="font-mono text-blue-300 font-bold">{(activeMaterial.ior ?? 1.5).toFixed(3)}</span>
                </div>
                <input 
                  type="range" min="1.0" max="3.0" step="0.01"
                  value={activeMaterial.ior ?? 1.5}
                  onChange={e => updateMaterial(activeMaterial.id, { ior: parseFloat(e.target.value) })}
                  className="w-full accent-blue-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
                <div className="grid grid-cols-5 gap-1 pt-1">
                  {[
                    { label: 'Aire (1.0)', val: 1.0 },
                    { label: 'Hielo (1.31)', val: 1.31 },
                    { label: 'Agua (1.33)', val: 1.333 },
                    { label: 'Vidrio (1.52)', val: 1.52 },
                    { label: 'Diamante (2.42)', val: 2.417 },
                  ].map(iorP => (
                    <button
                      key={iorP.label}
                      onClick={() => updateMaterial(activeMaterial.id, { ior: iorP.val })}
                      className={`py-1 px-0.5 rounded text-[8px] font-bold transition-all border text-center ${
                        Math.abs((activeMaterial.ior ?? 1.5) - iorP.val) < 0.02
                          ? 'bg-blue-600/30 text-blue-200 border-blue-500'
                          : 'bg-zinc-800/80 text-zinc-400 border-white/5 hover:bg-zinc-800'
                      }`}
                    >
                      {iorP.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dispersión Cromática (Prisma / Arcoíris) */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Dispersión Cromática (Prisma)</label>
                  <span className="font-mono text-indigo-400">{(activeMaterial.dispersion ?? 0.0).toFixed(3)}</span>
                </div>
                <input 
                  type="range" min="0" max="0.2" step="0.005"
                  value={activeMaterial.dispersion ?? 0.0}
                  onChange={e => updateMaterial(activeMaterial.id, { dispersion: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Espesor y Atenuación Volumétrica (Ley de Beer-Lambert) */}
              <div className="space-y-2 bg-black/20 p-2.5 rounded-lg border border-white/5">
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-400">Espesor Volumétrico (Thickness)</label>
                    <span className="font-mono text-zinc-300">{(activeMaterial.thickness ?? 0.0).toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="5.0" step="0.05"
                    value={activeMaterial.thickness ?? 0.0}
                    onChange={e => updateMaterial(activeMaterial.id, { thickness: parseFloat(e.target.value) })}
                    className="w-full accent-blue-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="space-y-1">
                    <label className="text-[9px] text-zinc-500">Color de Atenuación</label>
                    <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded border border-white/5">
                      <input 
                        type="color" 
                        value={activeMaterial.attenuationColor || '#ffffff'}
                        onChange={e => updateMaterial(activeMaterial.id, { attenuationColor: e.target.value })}
                        className="w-4 h-4 rounded bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[9px] font-mono text-zinc-300">{activeMaterial.attenuationColor || '#ffffff'}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px]">
                      <label className="text-zinc-500">Distancia Atenuación</label>
                      <span className="font-mono text-zinc-400">{activeMaterial.attenuationDistance ?? 1.0}</span>
                    </div>
                    <input 
                      type="range" min="0.1" max="10" step="0.05"
                      value={activeMaterial.attenuationDistance ?? 1.0}
                      onChange={e => updateMaterial(activeMaterial.id, { attenuationDistance: parseFloat(e.target.value) })}
                      className="w-full accent-blue-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Presets Beer-Lambert Rápidos */}
                <div className="pt-1">
                  <div className="text-[8px] text-zinc-500 uppercase tracking-wider mb-1">Presets Beer-Lambert:</div>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: '🧊 Hielo (0.45m)', color: '#0284c7', dist: 0.45, thick: 2.0, ior: 1.31 },
                      { label: '❄️ Glaciar (0.60m)', color: '#0ea5e9', dist: 0.60, thick: 2.2, ior: 1.31 },
                      { label: '🪟 Vidrio (5.0m)', color: '#ffffff', dist: 5.0, thick: 0.5, ior: 1.52 },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => updateMaterial(activeMaterial.id, {
                          attenuationColor: p.color,
                          attenuationDistance: p.dist,
                          thickness: p.thick,
                          ior: p.ior,
                        })}
                        className="py-1 px-1 rounded bg-zinc-800/60 hover:bg-blue-900/30 border border-white/5 hover:border-blue-500/40 text-[8px] text-zinc-300 transition-colors text-center truncate"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Aviso HDRI para Refracción Física */}
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                  <div className="text-[8px] text-zinc-400 leading-tight">
                    💡 <span className="text-zinc-300 font-semibold">Iluminación HDRI:</span> La refracción requiere un entorno 360° para reflejar el fondo.
                  </div>
                  <button
                    onClick={() => {
                      updateEnvironment({
                        hdriUrl: 'synthetic_polar_arctic',
                        backgroundMode: 'HDRI',
                        backgroundVisible: true,
                        intensity: 1.2,
                      });
                      setCopiedNotification('¡Entorno HDRI Polar Ártico activado para refracción física!');
                      setTimeout(() => setCopiedNotification(null), 3000);
                    }}
                    className="flex-shrink-0 px-2 py-1 bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/50 rounded text-[8px] font-bold text-sky-200 transition-colors whitespace-nowrap"
                  >
                    🧊 Activar HDRI Ártico
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3.5: NODOS PROCEDURALES DE HIELO 3D (BLENDER / SUBSTANCE ARCHITECTURE) ── */}
        <div className="bg-sky-950/20 rounded-xl border border-sky-500/20 overflow-hidden">
          <button 
            onClick={() => toggleSection('ice_nodes')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-sky-500/10 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-sky-300">
              <span className="text-sm">🧊</span>
              <span>Hielo & Nieve Procedural (Nodos 3D)</span>
              {(activeMaterial.isIce || (activeMaterial.iceConfig?.cloudDensity ?? 0) > 0) && (
                <span className="text-[8px] bg-sky-500/20 text-sky-300 px-1 rounded border border-sky-500/30">ACTIVO</span>
              )}
            </div>
            {openSections.ice_nodes ? <ChevronDown size={14} className="text-sky-400" /> : <ChevronRight size={14} className="text-sky-400" />}
          </button>

          {openSections.ice_nodes && (
            <div className="p-3 pt-1 space-y-3 border-t border-sky-500/20">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-zinc-400">Activar Sombreador de Hielo 3D</span>
                <input 
                  type="checkbox"
                  checked={Boolean(activeMaterial.isIce)}
                  onChange={e => {
                    const enabled = e.target.checked;
                    updateMaterial(activeMaterial.id, {
                      isIce: enabled,
                      transmission: enabled ? 1.0 : activeMaterial.transmission,
                      ior: enabled ? 1.31 : activeMaterial.ior,
                      roughness: enabled ? 0.12 : activeMaterial.roughness,
                      attenuationColor: enabled ? (activeMaterial.attenuationColor || '#38bdf8') : activeMaterial.attenuationColor,
                      attenuationDistance: enabled ? 1.2 : activeMaterial.attenuationDistance,
                      thickness: enabled ? (activeMaterial.thickness || 2.8) : activeMaterial.thickness,
                      iceConfig: {
                        enabled,
                        surfaceWarp: activeMaterial.iceConfig?.surfaceWarp ?? 0.05,
                        cloudDensity: activeMaterial.iceConfig?.cloudDensity ?? 1.4,
                        cloudColor: activeMaterial.iceConfig?.cloudColor ?? '#e0f2fe',
                        cloudScale: activeMaterial.iceConfig?.cloudScale ?? 2.6,
                        frostIntensity: activeMaterial.iceConfig?.frostIntensity ?? 0.85,
                        crackIntensity: activeMaterial.iceConfig?.crackIntensity ?? 0.9,
                      }
                    });
                  }}
                  className="rounded accent-sky-400"
                />
              </div>

              <p className="text-[9px] text-sky-200/70 leading-tight">
                Simulación procedural por nodos: Deformación orgánica de caras, núcleo blanco denso Musgrave 3D y escarcha en esquinas/silueta (Fresnel).
              </p>

              {/* Slider 1: Deformación de Superficie */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-300 flex items-center gap-1">
                    <span>Ondulación Orgánica de Caras</span>
                  </label>
                  <span className="font-mono text-sky-300 font-bold">
                    {(((activeMaterial.iceConfig?.surfaceWarp ?? 0.05)) * 100).toFixed(1)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="0.2" step="0.005"
                  value={activeMaterial.iceConfig?.surfaceWarp ?? 0.05}
                  onChange={e => updateMaterial(activeMaterial.id, {
                    isIce: true,
                    iceConfig: {
                      ...(activeMaterial.iceConfig || {}),
                      surfaceWarp: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full accent-sky-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider 2: Densidad Núcleo Musgrave 3D */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-300">Núcleo Blanco Musgrave 3D (Centro Congelado)</label>
                  <span className="font-mono text-sky-300 font-bold">
                    {(activeMaterial.iceConfig?.cloudDensity ?? 1.4).toFixed(1)}x
                  </span>
                </div>
                <input 
                  type="range" min="0" max="3.0" step="0.05"
                  value={activeMaterial.iceConfig?.cloudDensity ?? 1.4}
                  onChange={e => updateMaterial(activeMaterial.id, {
                    isIce: true,
                    iceConfig: {
                      ...(activeMaterial.iceConfig || {}),
                      cloudDensity: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full accent-sky-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider 3: Escarcha en Silueta / Fresnel Facing */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-300">Escarcha en Bordes (Fresnel Facing)</label>
                  <span className="font-mono text-sky-300 font-bold">
                    {(((activeMaterial.iceConfig?.frostIntensity ?? 0.85)) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="2.0" step="0.05"
                  value={activeMaterial.iceConfig?.frostIntensity ?? 0.85}
                  onChange={e => updateMaterial(activeMaterial.id, {
                    isIce: true,
                    iceConfig: {
                      ...(activeMaterial.iceConfig || {}),
                      frostIntensity: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full accent-sky-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider 4: Grietas y Burbujas Internas Voronoi 3D */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-300">Grietas Internas & Microburbujas</label>
                  <span className="font-mono text-sky-300 font-bold">
                    {(((activeMaterial.iceConfig?.crackIntensity ?? 0.9)) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="2.0" step="0.05"
                  value={activeMaterial.iceConfig?.crackIntensity ?? 0.9}
                  onChange={e => updateMaterial(activeMaterial.id, {
                    isIce: true,
                    iceConfig: {
                      ...(activeMaterial.iceConfig || {}),
                      crackIntensity: parseFloat(e.target.value)
                    }
                  })}
                  className="w-full accent-sky-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Color del Núcleo Nuboso */}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[10px] text-zinc-300">Color Dispersión Interna</label>
                <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded border border-white/10">
                  <input 
                    type="color" 
                    value={activeMaterial.iceConfig?.cloudColor || '#e0f2fe'}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isIce: true,
                      iceConfig: {
                        ...(activeMaterial.iceConfig || {}),
                        cloudColor: e.target.value
                      }
                    })}
                    className="w-4 h-4 rounded bg-transparent border-none cursor-pointer"
                  />
                  <span className="text-[9px] font-mono text-zinc-200">{activeMaterial.iceConfig?.cloudColor || '#e0f2fe'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3.6: WEBGPU GLASS (DISPERSIÓN ESPECTRAL, REFRACCIÓN & CÁUSTICAS) ── */}
        <div className="bg-gradient-to-r from-blue-950/30 via-indigo-950/20 to-purple-950/30 rounded-xl border border-indigo-500/30 overflow-hidden shadow-lg shadow-indigo-950/20">
          <button 
            onClick={() => toggleSection('webgpu_glass')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-indigo-500/10 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-300">
              <span className="text-sm">🌈</span>
              <span>WebGPU Glass (Dispersión Espectral)</span>
              {(activeMaterial.isGlass || activeMaterial.glassConfig?.enabled) && (
                <span className="text-[8px] bg-gradient-to-r from-indigo-500/30 to-purple-500/30 text-indigo-200 px-1.5 py-0.5 rounded-full border border-indigo-400/40 font-mono font-semibold">
                  WEBGPU ACTIVE
                </span>
              )}
            </div>
            {openSections.webgpu_glass ? <ChevronDown size={14} className="text-indigo-400" /> : <ChevronRight size={14} className="text-indigo-400" />}
          </button>

          {openSections.webgpu_glass && (
            <div className="p-3 pt-1 space-y-3.5 border-t border-indigo-500/20">
              {/* Switch Activar WebGPU Glass */}
              <div className="flex items-center justify-between bg-indigo-950/40 p-2 rounded-lg border border-indigo-500/20">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-indigo-200">Activar Shader WebGPU Glass</span>
                  <span className="text-[8px] text-zinc-400">Dispersión de Newton, aberración cromática y ondas cáusticas</span>
                </div>
                <input 
                  type="checkbox"
                  checked={Boolean(activeMaterial.isGlass || activeMaterial.glassConfig?.enabled)}
                  onChange={e => {
                    const enabled = e.target.checked;
                    updateMaterial(activeMaterial.id, {
                      isGlass: enabled,
                      transmission: enabled ? (activeMaterial.transmission || 1.0) : activeMaterial.transmission,
                      ior: enabled ? (activeMaterial.ior || 1.65) : activeMaterial.ior,
                      dispersion: enabled ? (activeMaterial.dispersion || 0.12) : activeMaterial.dispersion,
                      thickness: enabled ? (activeMaterial.thickness || 1.8) : activeMaterial.thickness,
                      glassConfig: {
                        enabled,
                        preset: activeMaterial.glassConfig?.preset || 'newton_dispersion_prism',
                        dispersion: activeMaterial.glassConfig?.dispersion ?? (activeMaterial.dispersion || 0.12),
                        chromaticAberration: activeMaterial.glassConfig?.chromaticAberration ?? 0.08,
                        distortion: activeMaterial.glassConfig?.distortion ?? 0.0,
                        distortionSpeed: activeMaterial.glassConfig?.distortionSpeed ?? 1.0,
                        distortionFrequency: activeMaterial.glassConfig?.distortionFrequency ?? 3.0,
                        internalBubbles: activeMaterial.glassConfig?.internalBubbles ?? false,
                        bubbleDensity: activeMaterial.glassConfig?.bubbleDensity ?? 1.5,
                        bubbleScale: activeMaterial.glassConfig?.bubbleScale ?? 20.0,
                        frostedBlur: activeMaterial.glassConfig?.frostedBlur ?? 0.0,
                        rimGlow: activeMaterial.glassConfig?.rimGlow ?? 1.5,
                        rimColor: activeMaterial.glassConfig?.rimColor ?? '#a5b4fc',
                        causticIntensity: activeMaterial.glassConfig?.causticIntensity ?? 1.5,
                        thinFilmIridescence: activeMaterial.glassConfig?.thinFilmIridescence ?? 0.5,
                      }
                    });
                  }}
                  className="rounded accent-indigo-500 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* Presets Rápidos WebGPU Glass */}
              <div className="space-y-1.5">
                <div className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Presets Calibrados WebGPU Glass:</span>
                  <span className="text-[8px] text-indigo-400 font-mono">{WEBGPU_GLASS_PRESETS.length} presets</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {WEBGPU_GLASS_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        updateMaterial(activeMaterial.id, {
                          isGlass: true,
                          transmission: 1.0,
                          ior: p.pbrParams?.ior || activeMaterial.ior,
                          dispersion: p.defaultParams.dispersion ?? activeMaterial.dispersion,
                          roughness: p.pbrParams?.roughness ?? 0.01,
                          thickness: p.pbrParams?.thickness ?? 2.0,
                          attenuationColor: p.pbrParams?.attenuationColor || activeMaterial.attenuationColor,
                          attenuationDistance: p.pbrParams?.attenuationDistance || activeMaterial.attenuationDistance,
                          clearcoat: p.pbrParams?.clearcoat ?? 1.0,
                          clearcoatRoughness: p.pbrParams?.clearcoatRoughness ?? 0.01,
                          glassConfig: {
                            ...p.defaultParams,
                            enabled: true,
                            preset: p.id,
                          }
                        });
                      }}
                      className={`p-2 rounded-lg text-left transition-all border flex flex-col gap-0.5 ${
                        activeMaterial.glassConfig?.preset === p.id
                          ? 'bg-indigo-600/30 border-indigo-400 text-indigo-100 shadow-sm shadow-indigo-500/30'
                          : 'bg-zinc-900/60 border-white/5 text-zinc-300 hover:bg-indigo-950/40 hover:border-indigo-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold truncate">{p.name}</span>
                        <span className="text-[7px] px-1 py-0.2 bg-white/10 rounded font-mono text-indigo-300">
                          IOR {p.pbrParams?.ior || 1.5}
                        </span>
                      </div>
                      <span className="text-[8px] text-zinc-400 truncate">{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders de Parámetros Físicos WebGPU Glass */}
              <div className="space-y-2.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                {/* Dispersión Espectral Cauchy */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300 font-medium">Dispersión Espectral (Cauchy)</label>
                    <span className="font-mono text-indigo-300 font-bold">
                      {(activeMaterial.glassConfig?.dispersion ?? 0.12).toFixed(3)}
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="0.35" step="0.005"
                    value={activeMaterial.glassConfig?.dispersion ?? 0.12}
                    onChange={e => {
                      const val = parseFloat(e.target.value);
                      updateMaterial(activeMaterial.id, {
                        isGlass: true,
                        dispersion: val,
                        glassConfig: {
                          ...(activeMaterial.glassConfig || { enabled: true }),
                          dispersion: val
                        }
                      });
                    }}
                    className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Aberración Cromática */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300 font-medium">Aberración Cromática (Wavelength Split)</label>
                    <span className="font-mono text-indigo-300 font-bold">
                      {(((activeMaterial.glassConfig?.chromaticAberration ?? 0.08)) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="0.25" step="0.005"
                    value={activeMaterial.glassConfig?.chromaticAberration ?? 0.08}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isGlass: true,
                      glassConfig: {
                        ...(activeMaterial.glassConfig || { enabled: true }),
                        chromaticAberration: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Resplandor Fresnel de Borde (Rim Glow) */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <label className="text-zinc-400">Resplandor Rim Glow</label>
                      <span className="font-mono text-indigo-300">{(activeMaterial.glassConfig?.rimGlow ?? 1.5).toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" min="0" max="4.0" step="0.1"
                      value={activeMaterial.glassConfig?.rimGlow ?? 1.5}
                      onChange={e => updateMaterial(activeMaterial.id, {
                        isGlass: true,
                        glassConfig: {
                          ...(activeMaterial.glassConfig || { enabled: true }),
                          rimGlow: parseFloat(e.target.value)
                        }
                      })}
                      className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-zinc-400">Color de Resplandor Rim</label>
                    <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded border border-white/5">
                      <input 
                        type="color"
                        value={activeMaterial.glassConfig?.rimColor || '#a5b4fc'}
                        onChange={e => updateMaterial(activeMaterial.id, {
                          isGlass: true,
                          glassConfig: {
                            ...(activeMaterial.glassConfig || { enabled: true }),
                            rimColor: e.target.value
                          }
                        })}
                        className="w-4 h-4 rounded bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[8px] font-mono text-zinc-300 truncate">
                        {activeMaterial.glassConfig?.rimColor || '#a5b4fc'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Destellos Cáusticos Especulares */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300 font-medium">Intensidad de Cáusticas & Destellos</label>
                    <span className="font-mono text-indigo-300 font-bold">
                      {(activeMaterial.glassConfig?.causticIntensity ?? 1.5).toFixed(1)}x
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="3.5" step="0.1"
                    value={activeMaterial.glassConfig?.causticIntensity ?? 1.5}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isGlass: true,
                      glassConfig: {
                        ...(activeMaterial.glassConfig || { enabled: true }),
                        causticIntensity: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Deformación y Ondas de Superficie Líquida */}
                <div className="space-y-1 pt-1 border-t border-white/5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Ondulación Líquida Dinámica</label>
                    <span className="font-mono text-indigo-300">
                      {(((activeMaterial.glassConfig?.distortion ?? 0)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1.0" step="0.02"
                    value={activeMaterial.glassConfig?.distortion ?? 0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isGlass: true,
                      glassConfig: {
                        ...(activeMaterial.glassConfig || { enabled: true }),
                        distortion: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Microburbujas Voronoi Internas */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-300 font-medium">Microburbujas Internas 3D</span>
                    <span className="text-[8px] text-zinc-400">Inclusiones de aire Voronoi dentro de la masa vítrea</span>
                  </div>
                  <input 
                    type="checkbox"
                    checked={Boolean(activeMaterial.glassConfig?.internalBubbles)}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isGlass: true,
                      glassConfig: {
                        ...(activeMaterial.glassConfig || { enabled: true }),
                        internalBubbles: e.target.checked
                      }
                    })}
                    className="rounded accent-indigo-500 w-4 h-4 cursor-pointer"
                  />
                </div>

                {/* Película Delgada Iridiscente */}
                <div className="space-y-1 pt-1 border-t border-white/5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300">Interferencia Dicroica / Película Delgada</label>
                    <span className="font-mono text-indigo-300">
                      {(((activeMaterial.glassConfig?.thinFilmIridescence ?? 0.5)) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1.0" step="0.05"
                    value={activeMaterial.glassConfig?.thinFilmIridescence ?? 0.5}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isGlass: true,
                      glassConfig: {
                        ...(activeMaterial.glassConfig || { enabled: true }),
                        thinFilmIridescence: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-indigo-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 3.7: THREE-CUSTOMSHADERMATERIAL (CSM SHADER EXTENSIONS) ── */}
        <div className="bg-gradient-to-r from-purple-950/30 via-fuchsia-950/20 to-pink-950/30 rounded-xl border border-purple-500/30 overflow-hidden shadow-lg shadow-purple-950/20">
          <button 
            onClick={() => toggleSection('csm')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-purple-500/10 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-purple-300">
              <Cpu size={14} className="text-purple-400" />
              <span>CustomShaderMaterial (CSM)</span>
              {(activeMaterial.isCSM || activeMaterial.csmConfig?.enabled) && (
                <span className="text-[8px] bg-gradient-to-r from-purple-500/30 to-fuchsia-500/30 text-purple-200 px-1.5 py-0.5 rounded-full border border-purple-400/40 font-mono font-semibold">
                  CSM ACTIVE
                </span>
              )}
            </div>
            {openSections.csm ? <ChevronDown size={14} className="text-purple-400" /> : <ChevronRight size={14} className="text-purple-400" />}
          </button>

          {openSections.csm && (
            <div className="p-3 pt-1 space-y-3.5 border-t border-purple-500/20">
              {/* Switch Activar CSM */}
              <div className="flex items-center justify-between bg-purple-950/40 p-2 rounded-lg border border-purple-500/20">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-purple-200">Activar Extensión CSM</span>
                  <span className="text-[8px] text-zinc-400">Extiende materiales estándar con vertex & fragment shaders custom</span>
                </div>
                <input 
                  type="checkbox"
                  checked={Boolean(activeMaterial.isCSM || activeMaterial.csmConfig?.enabled)}
                  onChange={e => {
                    const enabled = e.target.checked;
                    updateMaterial(activeMaterial.id, {
                      isCSM: enabled,
                      csmConfig: {
                        enabled,
                        baseMaterial: activeMaterial.csmConfig?.baseMaterial || 'MeshPhysicalMaterial',
                        preset: activeMaterial.csmConfig?.preset || 'wave_distortion',
                        timeSpeed: activeMaterial.csmConfig?.timeSpeed ?? 1.0,
                        displacementScale: activeMaterial.csmConfig?.displacementScale ?? 0.0,
                        noiseFrequency: activeMaterial.csmConfig?.noiseFrequency ?? 3.0,
                        colorAccent: activeMaterial.csmConfig?.colorAccent || '#38bdf8',
                        glowIntensity: activeMaterial.csmConfig?.glowIntensity ?? 1.5,
                        vertexShader: activeMaterial.csmConfig?.vertexShader,
                        fragmentShader: activeMaterial.csmConfig?.fragmentShader,
                      }
                    });
                  }}
                  className="rounded accent-purple-500 w-4 h-4 cursor-pointer"
                />
              </div>

              {/* Selector de Material Base Three.js */}
              <div className="space-y-1">
                <label className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider">Material Base Three.js:</label>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { id: 'MeshPhysicalMaterial', label: 'Physical PBR' },
                    { id: 'MeshStandardMaterial', label: 'Standard PBR' },
                    { id: 'MeshToonMaterial', label: 'Toon Cel' },
                  ].map(bm => (
                    <button
                      key={bm.id}
                      onClick={() => updateMaterial(activeMaterial.id, {
                        isCSM: true,
                        csmConfig: {
                          ...(activeMaterial.csmConfig || { enabled: true }),
                          baseMaterial: bm.id as any
                        }
                      })}
                      className={`py-1 px-1 rounded text-[8px] font-bold transition-all border text-center ${
                        (activeMaterial.csmConfig?.baseMaterial || 'MeshPhysicalMaterial') === bm.id
                          ? 'bg-purple-600/30 text-purple-200 border-purple-400'
                          : 'bg-zinc-900/60 text-zinc-400 border-white/5 hover:bg-zinc-800'
                      }`}
                    >
                      {bm.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets Rápidos CSM */}
              <div className="space-y-1.5">
                <div className="text-[9px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Presets de Sombreador CSM:</span>
                  <span className="text-[8px] text-purple-400 font-mono">{CSM_PRESETS.length} presets</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {CSM_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        updateMaterial(activeMaterial.id, {
                          isCSM: true,
                          csmConfig: {
                            ...p.defaultParams,
                            baseMaterial: p.defaultBaseMaterial,
                            enabled: true,
                            preset: p.id,
                            vertexShader: p.vertexCode,
                            fragmentShader: p.fragmentCode,
                          }
                        });
                      }}
                      className={`p-2 rounded-lg text-left transition-all border flex flex-col gap-0.5 ${
                        activeMaterial.csmConfig?.preset === p.id
                          ? 'bg-purple-600/30 border-purple-400 text-purple-100 shadow-sm shadow-purple-500/30'
                          : 'bg-zinc-900/60 border-white/5 text-zinc-300 hover:bg-purple-950/40 hover:border-purple-500/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold truncate">{p.name}</span>
                        <span className="text-[7px] px-1 py-0.2 bg-white/10 rounded font-mono text-purple-300 truncate">
                          {p.defaultBaseMaterial?.replace('Mesh', '').replace('Material', '')}
                        </span>
                      </div>
                      <span className="text-[8px] text-zinc-400 truncate">{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders de Parámetros CSM */}
              <div className="space-y-2.5 bg-black/20 p-2.5 rounded-lg border border-white/5">
                {/* Desplazamiento de Vértices */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <div className="flex items-center gap-1.5">
                      <label className="text-zinc-300 font-medium">Deformación 3D (Displacement)</label>
                      {(activeMaterial.csmConfig?.displacementScale ?? 0.0) === 0 ? (
                        <span className="text-[8px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded font-mono border border-emerald-500/30">
                          Sólido Cerrado
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-purple-300 font-bold">
                        {(activeMaterial.csmConfig?.displacementScale ?? 0.0).toFixed(2)}x
                      </span>
                      {(activeMaterial.csmConfig?.displacementScale ?? 0.0) > 0 && (
                        <button
                          type="button"
                          onClick={() => updateMaterial(activeMaterial.id, {
                            isCSM: true,
                            csmConfig: {
                              ...(activeMaterial.csmConfig || { enabled: true }),
                              displacementScale: 0.0
                            }
                          })}
                          className="text-[8px] px-1 py-0.5 bg-white/10 hover:bg-white/20 text-zinc-300 rounded transition-colors"
                          title="Restablecer a 0 para mantener la malla 3D cerrada e intacta"
                        >
                          Fijar en 0
                        </button>
                      )}
                    </div>
                  </div>
                  <input 
                    type="range" min="0" max="0.5" step="0.01"
                    value={activeMaterial.csmConfig?.displacementScale ?? 0.0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isCSM: true,
                      csmConfig: {
                        ...(activeMaterial.csmConfig || { enabled: true }),
                        displacementScale: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-purple-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                  <p className="text-[7.5px] text-zinc-400 leading-tight">
                    * En <strong>0.00x</strong> el shader aplica efectos ópticos (Fresnel, brillo, lava, iridiscencia) preservando la figura 3D intacta y sellada.
                  </p>
                </div>

                {/* Velocidad de Tiempo */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300 font-medium">Velocidad de Animación (Time Speed)</label>
                    <span className="font-mono text-purple-300 font-bold">
                      {(activeMaterial.csmConfig?.timeSpeed ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="4.0" step="0.1"
                    value={activeMaterial.csmConfig?.timeSpeed ?? 1.0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isCSM: true,
                      csmConfig: {
                        ...(activeMaterial.csmConfig || { enabled: true }),
                        timeSpeed: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-purple-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Frecuencia de Ruido / Ondas */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-300 font-medium">Frecuencia Espacial de Ruido</label>
                    <span className="font-mono text-purple-300 font-bold">
                      {(activeMaterial.csmConfig?.noiseFrequency ?? 3.0).toFixed(1)}
                    </span>
                  </div>
                  <input 
                    type="range" min="0.5" max="15.0" step="0.2"
                    value={activeMaterial.csmConfig?.noiseFrequency ?? 3.0}
                    onChange={e => updateMaterial(activeMaterial.id, {
                      isCSM: true,
                      csmConfig: {
                        ...(activeMaterial.csmConfig || { enabled: true }),
                        noiseFrequency: parseFloat(e.target.value)
                      }
                    })}
                    className="w-full accent-purple-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Color de Acento y Emisión Glow */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                  <div className="space-y-1">
                    <label className="text-[9px] text-zinc-400">Color de Acento Shader</label>
                    <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded border border-white/5">
                      <input 
                        type="color"
                        value={activeMaterial.csmConfig?.colorAccent || '#38bdf8'}
                        onChange={e => updateMaterial(activeMaterial.id, {
                          isCSM: true,
                          csmConfig: {
                            ...(activeMaterial.csmConfig || { enabled: true }),
                            colorAccent: e.target.value
                          }
                        })}
                        className="w-4 h-4 rounded bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-[8px] font-mono text-zinc-300 truncate">
                        {activeMaterial.csmConfig?.colorAccent || '#38bdf8'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[9px]">
                      <label className="text-zinc-400">Brillo Glow / Emisión</label>
                      <span className="font-mono text-purple-300">{(activeMaterial.csmConfig?.glowIntensity ?? 1.5).toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" min="0" max="5.0" step="0.1"
                      value={activeMaterial.csmConfig?.glowIntensity ?? 1.5}
                      onChange={e => updateMaterial(activeMaterial.id, {
                        isCSM: true,
                        csmConfig: {
                          ...(activeMaterial.csmConfig || { enabled: true }),
                          glowIntensity: parseFloat(e.target.value)
                        }
                      })}
                      className="w-full accent-purple-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 4: ANISOTROPÍA (METALES CEPILLADOS & DISCOS) ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('anisotropy')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Disc size={13} className="text-emerald-400" />
              <span>Anisotropía (Metales Cepillados & Radial)</span>
              {(activeMaterial.anisotropy ?? 0) > 0 && (
                <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1 rounded border border-emerald-500/30">
                  {((activeMaterial.anisotropy ?? 0) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {openSections.anisotropy ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.anisotropy && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <p className="text-[9px] text-zinc-400 leading-tight">
                Estira los brillos especulares en una dirección angular (aluminio cepillado, surcos de discos de vinilo, sartenes).
              </p>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Intensidad de Anisotropía</label>
                  <span className="font-mono text-emerald-400 font-bold">{((activeMaterial.anisotropy ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.anisotropy ?? 0}
                  onChange={e => updateMaterial(activeMaterial.id, { anisotropy: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Rotación de la Anisotropía</label>
                  <span className="font-mono text-zinc-300">{(activeMaterial.anisotropyRotation ?? 0).toFixed(0)}°</span>
                </div>
                <input 
                  type="range" min="0" max="360" step="1"
                  value={activeMaterial.anisotropyRotation ?? 0}
                  onChange={e => updateMaterial(activeMaterial.id, { anisotropyRotation: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 5: BARNIZ Y LACADOS (CLEARCOAT) ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('clearcoat')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Shield size={13} className="text-amber-400" />
              <span>Barniz & Lacados (Clearcoat)</span>
              {(activeMaterial.clearcoat ?? 0) > 0 && (
                <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1 rounded border border-amber-500/30">
                  {((activeMaterial.clearcoat ?? 0) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {openSections.clearcoat ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.clearcoat && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <p className="text-[9px] text-zinc-400 leading-tight">
                Simula una capa exterior de barniz brillante sobre la superficie base (pintura de carrocerías, fibra de carbono lacada, madera tratada).
              </p>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Intensidad de Barniz (Clearcoat)</label>
                  <span className="font-mono text-amber-400 font-bold">{((activeMaterial.clearcoat ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.clearcoat ?? 0}
                  onChange={e => updateMaterial(activeMaterial.id, { clearcoat: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Rugosidad del Barniz (Clearcoat Roughness)</label>
                  <span className="font-mono text-zinc-300">{(activeMaterial.clearcoatRoughness ?? 0.05).toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.clearcoatRoughness ?? 0.05}
                  onChange={e => updateMaterial(activeMaterial.id, { clearcoatRoughness: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 6: TELAS Y TERCIOPELO (SHEEN) ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('sheen')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Feather size={13} className="text-rose-400" />
              <span>Telas & Terciopelo (Sheen)</span>
              {(activeMaterial.sheen ?? 0) > 0 && (
                <span className="text-[8px] bg-rose-500/20 text-rose-300 px-1 rounded border border-rose-500/30">
                  {((activeMaterial.sheen ?? 0) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {openSections.sheen ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.sheen && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <p className="text-[9px] text-zinc-400 leading-tight">
                Genera retro-dispersión y suavidad de micro-vellosidades en los bordes de la tela o terciopelo.
              </p>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Intensidad Sheen (Terciopelo)</label>
                  <span className="font-mono text-rose-400 font-bold">{((activeMaterial.sheen ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.sheen ?? 0}
                  onChange={e => updateMaterial(activeMaterial.id, { sheen: parseFloat(e.target.value) })}
                  className="w-full accent-rose-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-400">Color de Sheen</label>
                  <div className="flex items-center gap-2 bg-white/5 p-1.5 h-8 rounded-lg border border-white/5">
                    <input 
                      type="color" 
                      value={activeMaterial.sheenColor || '#ffffff'}
                      onChange={e => updateMaterial(activeMaterial.id, { sheenColor: e.target.value })}
                      className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                    />
                    <span className="text-[10px] font-mono uppercase text-zinc-300">{activeMaterial.sheenColor || '#ffffff'}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <label className="text-zinc-400">Rugosidad Sheen</label>
                    <span className="font-mono text-zinc-400">{(activeMaterial.sheenRoughness ?? 0.5).toFixed(2)}</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={activeMaterial.sheenRoughness ?? 0.5}
                    onChange={e => updateMaterial(activeMaterial.id, { sheenRoughness: parseFloat(e.target.value) })}
                    className="w-full accent-rose-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 7: IRIDISCENCIA & PELÍCULA FINA ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('iridescence')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Gem size={13} className="text-fuchsia-400" />
              <span>Iridiscencia & Película Fina</span>
              {(activeMaterial.iridescence ?? 0) > 0 && (
                <span className="text-[8px] bg-fuchsia-500/20 text-fuchsia-300 px-1 rounded border border-fuchsia-500/30">
                  {((activeMaterial.iridescence ?? 0) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {openSections.iridescence ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.iridescence && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <p className="text-[9px] text-zinc-400 leading-tight">
                Interferencia física de película delgada (thin-film) que descompone la luz en patrones irisados cromáticos según el espesor molecular y el ángulo de incidencia (pompas de jabón, manchas de aceite, nácar, alas de insectos).
              </p>

              {/* Presets Rápidos Calibrados de Iridiscencia */}
              <div className="space-y-1">
                <span className="text-[8.5px] text-zinc-400 font-semibold uppercase">Presets Calibrados de Película Fina:</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    {
                      label: '🫧 Pompa de Jabón Físico',
                      desc: 'Película ultra-fina translúcida',
                      p: {
                        iridescence: 1.0,
                        iridescenceIOR: 1.333,
                        iridescenceThicknessRange: [100, 750] as [number, number],
                        transmission: 1.0,
                        roughness: 0.0,
                        ior: 1.333,
                        thickness: 0.1,
                        transparent: true,
                        opacity: 0.35,
                        clearcoat: 1.0,
                        clearcoatRoughness: 0.0,
                        metalness: 0.0
                      }
                    },
                    {
                      label: '🛢️ Película de Aceite',
                      desc: 'Flotando sobre agua / asfalto',
                      p: {
                        iridescence: 0.95,
                        iridescenceIOR: 1.45,
                        iridescenceThicknessRange: [150, 600] as [number, number],
                        roughness: 0.05,
                        clearcoat: 0.8
                      }
                    },
                    {
                      label: '🦪 Nácar / Madreperla',
                      desc: 'Reflejos orgánicos de concha',
                      p: {
                        iridescence: 0.85,
                        iridescenceIOR: 1.65,
                        iridescenceThicknessRange: [200, 800] as [number, number],
                        roughness: 0.18,
                        clearcoat: 0.6
                      }
                    },
                    {
                      label: '🌈 Titanio Anodizado',
                      desc: 'Capa de óxido térmico irisado',
                      p: {
                        iridescence: 0.9,
                        iridescenceIOR: 2.1,
                        iridescenceThicknessRange: [250, 650] as [number, number],
                        metalness: 0.95,
                        roughness: 0.12
                      }
                    }
                  ].map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => updateMaterial(activeMaterial.id, preset.p)}
                      className="p-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-fuchsia-500/20 hover:border-fuchsia-400/40 text-left transition-all cursor-pointer group"
                    >
                      <span className="text-[9.5px] font-bold text-zinc-200 group-hover:text-fuchsia-300 block truncate">{preset.label}</span>
                      <span className="text-[8px] text-zinc-500 block truncate">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Slider de Intensidad */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Intensidad Iridiscente</label>
                  <span className="font-mono text-fuchsia-400 font-bold">{((activeMaterial.iridescence ?? 0) * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01"
                  value={activeMaterial.iridescence ?? 0}
                  onChange={e => updateMaterial(activeMaterial.id, { iridescence: parseFloat(e.target.value) })}
                  className="w-full accent-fuchsia-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider IOR Película Fina */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">IOR Película Iridiscente (Índice de Refracción)</label>
                  <span className="font-mono text-zinc-300">{(activeMaterial.iridescenceIOR ?? 1.333).toFixed(3)}</span>
                </div>
                <input 
                  type="range" min="1.0" max="3.0" step="0.01"
                  value={activeMaterial.iridescenceIOR ?? 1.333}
                  onChange={e => updateMaterial(activeMaterial.id, { iridescenceIOR: parseFloat(e.target.value) })}
                  className="w-full accent-fuchsia-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Rango de Grosor de la Película Fina (Thickness Range en nm) */}
              <div className="space-y-2 bg-black/20 p-2 rounded-lg border border-fuchsia-500/20">
                <div className="flex items-center justify-between text-[9.5px] font-bold text-fuchsia-300">
                  <span>Espesor de Película Delgada (Nanómetros)</span>
                  <span className="font-mono text-[8.5px] text-zinc-400">
                    {activeMaterial.iridescenceThicknessRange ? `${activeMaterial.iridescenceThicknessRange[0]}nm – ${activeMaterial.iridescenceThicknessRange[1]}nm` : '100nm – 750nm'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8.5px] text-zinc-400">
                      <span>Mínimo (nm)</span>
                      <span className="font-mono text-zinc-200">{activeMaterial.iridescenceThicknessRange?.[0] ?? 100}</span>
                    </div>
                    <input 
                      type="range" min="50" max="600" step="10"
                      value={activeMaterial.iridescenceThicknessRange?.[0] ?? 100}
                      onChange={e => {
                        const min = parseInt(e.target.value, 10);
                        const max = Math.max(min + 50, activeMaterial.iridescenceThicknessRange?.[1] ?? 750);
                        updateMaterial(activeMaterial.id, { iridescenceThicknessRange: [min, max] });
                      }}
                      className="w-full accent-fuchsia-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[8.5px] text-zinc-400">
                      <span>Máximo (nm)</span>
                      <span className="font-mono text-zinc-200">{activeMaterial.iridescenceThicknessRange?.[1] ?? 750}</span>
                    </div>
                    <input 
                      type="range" min="200" max="1200" step="10"
                      value={activeMaterial.iridescenceThicknessRange?.[1] ?? 750}
                      onChange={e => {
                        const max = parseInt(e.target.value, 10);
                        const min = Math.min(max - 50, activeMaterial.iridescenceThicknessRange?.[0] ?? 100);
                        updateMaterial(activeMaterial.id, { iridescenceThicknessRange: [min, max] });
                      }}
                      className="w-full accent-fuchsia-400 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Generación Procedimental Rápida de Mapas de Iridiscencia */}
                <div className="pt-1.5 flex gap-1.5 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      const url = createThinFilmIridescenceTexture(512, 512);
                      updateMaterial(activeMaterial.id, { iridescenceMap: url, iridescence: activeMaterial.iridescence || 1.0 });
                      setCopiedNotification('¡Mapa de Iridiscencia Espectral generado y asignado!');
                      setTimeout(() => setCopiedNotification(null), 2500);
                    }}
                    className="flex-1 py-1 px-1.5 bg-fuchsia-950/60 hover:bg-fuchsia-900/80 border border-fuchsia-500/30 text-fuchsia-200 rounded text-[8.5px] font-bold transition-colors flex items-center justify-center gap-1"
                  >
                    <span>✨ Generar Mapa Arcoíris</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const url = createIridescenceThicknessTexture(512, 512);
                      updateMaterial(activeMaterial.id, { iridescenceThicknessMap: url, iridescence: activeMaterial.iridescence || 1.0 });
                      setCopiedNotification('¡Mapa de Grosor Dinámico generado y asignado!');
                      setTimeout(() => setCopiedNotification(null), 2500);
                    }}
                    className="flex-1 py-1 px-1.5 bg-fuchsia-950/60 hover:bg-fuchsia-900/80 border border-fuchsia-500/30 text-fuchsia-200 rounded text-[8.5px] font-bold transition-colors flex items-center justify-center gap-1"
                  >
                    <span>🫧 Generar Mapa de Grosor</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 8: EMISIÓN Y BRILLO (GLOW) ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('emissive')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Sun size={13} className="text-yellow-400" />
              <span>Emisión & Brillo (Glow)</span>
              {activeMaterial.emissive && activeMaterial.emissive !== '#000000' && (
                <span className="text-[8px] bg-yellow-500/20 text-yellow-300 px-1 rounded border border-yellow-500/30">ACTIVO</span>
              )}
            </div>
            {openSections.emissive ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.emissive && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-zinc-400">Color de Emisión</label>
                <div className="flex items-center gap-2 bg-white/5 p-1 rounded border border-white/5">
                  <input 
                    type="color" 
                    value={activeMaterial.emissive || '#000000'}
                    onChange={e => updateMaterial(activeMaterial.id, { emissive: e.target.value })}
                    className="w-5 h-5 rounded bg-transparent border-none cursor-pointer"
                  />
                  <span className="text-[10px] font-mono uppercase text-zinc-300">{activeMaterial.emissive || '#000000'}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <label className="text-zinc-400">Intensidad Emisiva</label>
                  <span className="font-mono text-yellow-400 font-bold">{activeMaterial.emissiveIntensity ?? 1}</span>
                </div>
                <input 
                  type="range" min="0" max="20" step="0.1"
                  value={activeMaterial.emissiveIntensity ?? 1}
                  onChange={e => updateMaterial(activeMaterial.id, { emissiveIntensity: parseFloat(e.target.value) })}
                  className="w-full accent-yellow-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 9: FILTROS DE DESGASTE (ÓXIDO, ARAÑAZOS, SUCpipeline) ── */}
        <div className="bg-amber-950/20 rounded-xl border border-amber-500/20 overflow-hidden">
          <button 
            onClick={() => toggleSection('filters')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-amber-400">
              <Sparkles size={13} />
              <span>Imperfecciones & Desgaste (Filtros)</span>
            </div>
            {openSections.filters ? <ChevronDown size={14} className="text-amber-500" /> : <ChevronRight size={14} className="text-amber-500" />}
          </button>

          {openSections.filters && (
            <div className="p-3 pt-1 space-y-2.5 border-t border-amber-500/20">
              {/* Slider Óxido */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="flex items-center gap-1.5 text-zinc-300 font-medium">
                    <span>🦀</span> Óxido / Corrosión (Rust)
                  </span>
                  <span className="font-mono text-amber-400 font-bold">
                    {((activeMaterial.filters?.rust ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05"
                  value={activeMaterial.filters?.rust ?? 0}
                  onChange={e => handleFilterChange('rust', parseFloat(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider Arañazos */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="flex items-center gap-1.5 text-zinc-300 font-medium">
                    <span>🔪</span> Arañazos / Incisiones (Scratches)
                  </span>
                  <span className="font-mono text-cyan-400 font-bold">
                    {((activeMaterial.filters?.scratches ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05"
                  value={activeMaterial.filters?.scratches ?? 0}
                  onChange={e => handleFilterChange('scratches', parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 h-1.5 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Slider Suciedad / Grietas */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="flex items-center gap-1.5 text-zinc-300 font-medium">
                    <span>🟤</span> Suciedad / Grietas (Dirt)
                  </span>
                  <span className="font-mono text-yellow-500 font-bold">
                    {((activeMaterial.filters?.dirt ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05"
                  value={activeMaterial.filters?.dirt ?? 0}
                  onChange={e => handleFilterChange('dirt', parseFloat(e.target.value))}
                  className="w-full accent-yellow-500 h-1.5 bg-white/10 rounded-lg cursor-pointer"
                />
              </div>

              {/* Presets Rápidos */}
              <div className="grid grid-cols-4 gap-1.5 pt-1.5 border-t border-amber-500/20">
                <button
                  onClick={() => {
                    handleFilterChange('rust', 0);
                    handleFilterChange('scratches', 0);
                    handleFilterChange('dirt', 0);
                  }}
                  className="py-1 px-1 bg-zinc-800 hover:bg-zinc-700 text-[9px] font-bold text-zinc-300 rounded text-center transition-colors truncate"
                >
                  Limpio
                </button>
                <button
                  onClick={() => {
                    handleFilterChange('rust', 0.15);
                    handleFilterChange('scratches', 0.2);
                    handleFilterChange('dirt', 0.15);
                  }}
                  className="py-1 px-1 bg-amber-900/40 hover:bg-amber-800/60 text-[9px] font-bold text-amber-300 rounded text-center transition-colors border border-amber-500/30 truncate"
                >
                  Uso Ligero
                </button>
                <button
                  onClick={() => {
                    handleFilterChange('rust', 0.45);
                    handleFilterChange('scratches', 0.5);
                    handleFilterChange('dirt', 0.4);
                  }}
                  className="py-1 px-1 bg-amber-900/60 hover:bg-amber-800/80 text-[9px] font-bold text-amber-200 rounded text-center transition-colors border border-amber-500/40 truncate"
                >
                  Desgastado
                </button>
                <button
                  onClick={() => {
                    handleFilterChange('rust', 0.85);
                    handleFilterChange('scratches', 0.8);
                    handleFilterChange('dirt', 0.75);
                  }}
                  className="py-1 px-1 bg-red-950/80 hover:bg-red-900/80 text-[9px] font-bold text-red-200 rounded text-center transition-colors border border-red-500/40 truncate"
                >
                  Extremo
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 10: MAPEO Y DESENVOLVIMIENTO UV (BLENDER STANDARD) ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('projection')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-indigo-400">
              <Box size={13} />
              <span>Mapeo & Desenvolvimiento UV (Blender)</span>
            </div>
            {openSections.projection ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.projection && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'SMART_UV', label: 'Smart UV', icon: '🧠' },
                  { id: 'BOX', label: 'Cúbico (Box)', icon: '📦' },
                  { id: 'TRIPLANAR', label: 'Triplanar', icon: '💎' },
                  { id: 'LIGHTMAP', label: 'Lightmap', icon: '💡' },
                  { id: 'PLANAR', label: 'Plana', icon: '📐' },
                  { id: 'SPHERICAL', label: 'Esférica', icon: '🌐' },
                  { id: 'CYLINDRICAL', label: 'Cilíndrica', icon: '🛢️' },
                  { id: 'UV', label: 'Auto Normal', icon: '🗺️' },
                ].map(proj => {
                  const currentMapping = activeMaterial.uvwMapping || 'BOX';
                  const isSelected = currentMapping === proj.id || (proj.id === 'SMART_UV' && currentMapping === 'UV');
                  return (
                    <button
                      key={proj.id}
                      onClick={() => {
                        updateMaterial(activeMaterial.id, { uvwMapping: proj.id as any });
                        handleAutoUVProjection(proj.id);
                      }}
                      className={`px-1.5 py-1.5 rounded-lg text-[9px] font-bold flex flex-col items-center justify-center gap-0.5 transition-all border ${
                        isSelected
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                          : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-white/5'
                      }`}
                    >
                      <span className="text-[13px]">{proj.icon}</span>
                      <span className="truncate w-full text-center">{proj.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Controles de Smart UV Project (Ángulo límite, Margen de islas, Relajación contra estiramiento) */}
              {((activeMaterial.uvwMapping || 'BOX') === 'SMART_UV' || (activeMaterial.uvwMapping || 'BOX') === 'UV') && (
                <div className="space-y-2 bg-indigo-950/25 p-2.5 rounded-lg border border-indigo-500/25">
                  <div className="text-[9px] font-bold text-indigo-300 uppercase tracking-wider flex items-center justify-between">
                    <span>Parámetros Smart UV Project</span>
                    <span className="text-[8px] bg-indigo-500/20 text-indigo-200 px-1 py-0.5 rounded">Blender 5.x</span>
                  </div>

                  {/* Ángulo Límite */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <label className="text-zinc-400">Ángulo Límite (Angle Limit)</label>
                      <span className="font-mono text-indigo-400">{(activeMaterial.uvAngleThreshold ?? 66).toFixed(0)}°</span>
                    </div>
                    <input 
                      type="range" min="20" max="89" step="1"
                      value={activeMaterial.uvAngleThreshold ?? 66}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        updateMaterial(activeMaterial.id, { uvAngleThreshold: val });
                      }}
                      onPointerUp={() => handleAutoUVProjection('SMART_UV')}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Margen entre islas */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <label className="text-zinc-400">Margen de Islas (Island Margin)</label>
                      <span className="font-mono text-indigo-400">{(activeMaterial.uvIslandMargin ?? 0.02).toFixed(3)}</span>
                    </div>
                    <input 
                      type="range" min="0.001" max="0.08" step="0.002"
                      value={activeMaterial.uvIslandMargin ?? 0.02}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        updateMaterial(activeMaterial.id, { uvIslandMargin: val });
                      }}
                      onPointerUp={() => handleAutoUVProjection('SMART_UV')}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Pasos de Relajación Antiestiramiento */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <label className="text-zinc-400">Relajación Laplaciana (Min Stretch)</label>
                      <span className="font-mono text-indigo-400">{activeMaterial.uvRelaxIterations ?? 6} iter</span>
                    </div>
                    <input 
                      type="range" min="0" max="15" step="1"
                      value={activeMaterial.uvRelaxIterations ?? 6}
                      onChange={e => {
                        const val = parseInt(e.target.value, 10);
                        updateMaterial(activeMaterial.id, { uvRelaxIterations: val });
                      }}
                      onPointerUp={() => handleAutoUVProjection('SMART_UV')}
                      className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {((activeMaterial.uvwMapping || 'BOX') === 'TRIPLANAR' || (activeMaterial.uvwMapping || 'BOX') === 'BOX') && (
                <div className="space-y-1.5 bg-indigo-950/30 p-2 rounded-lg border border-indigo-500/30">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-zinc-200 font-bold flex items-center gap-1">
                      <Sparkles size={11} className="text-indigo-400" />
                      <span>Blend (Suavizado de bordes)</span>
                    </span>
                    <span className="font-mono text-indigo-400 font-bold">
                      {((activeMaterial.triplanarBlend ?? 0.5) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.01"
                    value={activeMaterial.triplanarBlend ?? 0.5}
                    onChange={e => updateMaterial(activeMaterial.id, { triplanarBlend: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              )}

              <div className="pt-1 flex gap-2">
                <button
                  onClick={() => handleAutoUVProjection()}
                  className="flex-1 py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 hover:text-white border border-indigo-500/40 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98"
                >
                  <Zap size={12} className="text-indigo-400" />
                  <span>Desplegar / Recalcular UV</span>
                </button>
                <button
                  onClick={() => updateMaterial(activeMaterial.id, { uvDebug: !activeMaterial.uvDebug })}
                  className={`py-1.5 px-2 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 ${
                    activeMaterial.uvDebug 
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/30' 
                      : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border-white/10'
                  }`}
                  title="Activar/Desactivar textura Checkerboard UV para este material"
                >
                  <Grid size={12} />
                  <span>UV Debug: {activeMaterial.uvDebug ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── SECCIÓN 11: MAPAS DE TEXTURAS & SLOTS EXPANDIDOS ── */}
        <div className="bg-zinc-900/40 rounded-xl border border-white/5 overflow-hidden">
          <button 
            onClick={() => toggleSection('maps')}
            className="w-full p-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
              <Layers size={13} className="text-indigo-400" />
              <span>Mapas de Textura PBR (Slots)</span>
            </div>
            {openSections.maps ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          </button>

          {openSections.maps && (
            <div className="p-3 pt-1 space-y-3 border-t border-white/5">
              {/* Toggles Compactados en el lateral superior */}
              <div className="flex items-center justify-between text-[9px] font-bold text-zinc-500 uppercase bg-black/20 p-2 rounded-lg border border-white/5">
                <div className="flex items-center gap-1.5">
                  <span>Flip Y (Texturas)</span>
                  <button 
                    onClick={() => updateMaterial(activeMaterial.id, { flipY: !(activeMaterial.flipY ?? true) })}
                    className={`w-7 h-3.5 rounded-full transition-colors relative ${activeMaterial.flipY ?? true ? 'bg-indigo-600' : 'bg-zinc-800'}`}
                  >
                    <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${activeMaterial.flipY ?? true ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span>Usar ORM Compuesto</span>
                  <button 
                    onClick={() => updateMaterial(activeMaterial.id, { useORM: !activeMaterial.useORM })}
                    className={`w-7 h-3.5 rounded-full transition-colors relative ${activeMaterial.useORM ? 'bg-indigo-600' : 'bg-zinc-800'}`}
                  >
                    <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${activeMaterial.useORM ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Tiling / Scale / Offset con enlace de relación de aspecto U & V */}
              <div className="space-y-2 bg-black/20 p-2.5 rounded-xl border border-white/5">
                <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400">
                  <span className="flex items-center gap-1">
                    <SlidersHorizontal size={12} className="text-indigo-400" />
                    <span>Transformación UV (Tiling & Offset)</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleApplyTilingToAllMaps}
                      className="px-2 py-0.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded text-[9px] font-bold transition-colors border border-indigo-500/30 flex items-center gap-1 shadow-sm"
                      title="Forzar esta escala, repetición y desplazamiento en todas las ranuras de mapas PBR"
                    >
                      <RefreshCw size={10} />
                      <span>Sincronizar Todos</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {/* Repetición U & V */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-zinc-500 font-semibold truncate" title="Repetición (Scale)">Tiling UV</span>
                      <button
                        onClick={() => setIsTilingLinked(!isTilingLinked)}
                        className={`p-0.5 rounded transition-colors ${isTilingLinked ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-600'}`}
                        title={isTilingLinked ? 'Relación U/V Vinculada' : 'U/V Independientes'}
                      >
                        {isTilingLinked ? <LinkIcon size={10} /> : <Unlink size={10} />}
                      </button>
                    </div>
                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-1 h-7 rounded border border-white/5">
                      <span className="text-[9px] text-zinc-500 font-mono">U:</span>
                      <input 
                        type="number" step="0.1"
                        value={activeMaterial.mapRepeat?.[0] ?? 1}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 1;
                          const currentV = activeMaterial.mapRepeat?.[1] ?? 1;
                          updateMaterial(activeMaterial.id, { 
                            mapRepeat: isTilingLinked ? [val, val] : [val, currentV] 
                          });
                        }}
                        className="w-full bg-transparent text-[11px] text-white text-right outline-none font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-1 h-7 rounded border border-white/5">
                      <span className="text-[9px] text-zinc-500 font-mono">V:</span>
                      <input 
                        type="number" step="0.1"
                        value={activeMaterial.mapRepeat?.[1] ?? 1}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 1;
                          const currentU = activeMaterial.mapRepeat?.[0] ?? 1;
                          updateMaterial(activeMaterial.id, { 
                            mapRepeat: isTilingLinked ? [val, val] : [currentU, val] 
                          });
                        }}
                        className="w-full bg-transparent text-[11px] text-white text-right outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* Desplazamiento U & V */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-zinc-500 font-semibold truncate" title="Desplazamiento (Offset)">Offset UV</span>
                      <button
                        onClick={() => setIsOffsetLinked(!isOffsetLinked)}
                        className={`p-0.5 rounded transition-colors ${isOffsetLinked ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-600'}`}
                        title={isOffsetLinked ? 'Offset Vinculado' : 'Offset Independiente'}
                      >
                        {isOffsetLinked ? <LinkIcon size={10} /> : <Unlink size={10} />}
                      </button>
                    </div>
                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-1 h-7 rounded border border-white/5">
                      <span className="text-[9px] text-zinc-500 font-mono">U:</span>
                      <input 
                        type="number" step="0.05"
                        value={activeMaterial.mapOffset?.[0] ?? 0}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          const currentV = activeMaterial.mapOffset?.[1] ?? 0;
                          updateMaterial(activeMaterial.id, { 
                            mapOffset: isOffsetLinked ? [val, val] : [val, currentV] 
                          });
                        }}
                        className="w-full bg-transparent text-[11px] text-white text-right outline-none font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-1 h-7 rounded border border-white/5">
                      <span className="text-[9px] text-zinc-500 font-mono">V:</span>
                      <input 
                        type="number" step="0.05"
                        value={activeMaterial.mapOffset?.[1] ?? 0}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          const currentU = activeMaterial.mapOffset?.[0] ?? 0;
                          updateMaterial(activeMaterial.id, { 
                            mapOffset: isOffsetLinked ? [val, val] : [currentU, val] 
                          });
                        }}
                        className="w-full bg-transparent text-[11px] text-white text-right outline-none font-mono"
                      />
                    </div>
                  </div>

                  {/* Rotación */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] text-zinc-500 font-semibold truncate" title="Rotación (Grados)">Rotación</span>
                    <div className="flex items-center gap-1 bg-black/30 px-1.5 py-1 h-7 rounded border border-white/5 mt-auto">
                      <input 
                        type="number" step="5"
                        value={activeMaterial.mapRotation ?? 0}
                        onChange={e => updateMaterial(activeMaterial.id, { mapRotation: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-transparent text-[11px] text-white text-right outline-none font-mono"
                      />
                      <span className="text-[9px] text-zinc-500">°</span>
                    </div>
                    <div className="flex gap-1 pt-1">
                      <button
                        onClick={() => updateMaterial(activeMaterial.id, { mapRotation: ((activeMaterial.mapRotation ?? 0) + 90) % 360 })}
                        className="flex-1 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[8px] font-bold rounded"
                        title="Girar 90°"
                      >
                        +90°
                      </button>
                      <button
                        onClick={() => updateMaterial(activeMaterial.id, { mapRotation: 0 })}
                        className="py-1 px-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[8px] font-bold rounded"
                        title="Restablecer Rotación a 0°"
                      >
                        0°
                      </button>
                    </div>
                  </div>
                </div>

                {/* Botones de acción masiva en mapas */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-white/5">
                  <button
                    onClick={handleApplyTilingToAllMaps}
                    className="flex-1 py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1 shadow-sm"
                  >
                    <RefreshCw size={11} />
                    <span>Cambiar en TODOS los mapas</span>
                  </button>
                  <button
                    onClick={() => setShowPBRImport(true)}
                    className="py-1.5 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[9px] font-bold transition-colors flex items-center justify-center gap-1 border border-white/5"
                    title="Importar juego completo de texturas PBR"
                  >
                    <FolderOpen size={11} className="text-indigo-400" />
                    <span>Pack PBR</span>
                  </button>
                  <button
                    onClick={handleClearAllMaps}
                    className="py-1.5 px-2 bg-zinc-800 hover:bg-red-900/60 text-zinc-400 hover:text-red-200 rounded-lg text-[9px] font-bold transition-colors flex items-center justify-center gap-1 border border-white/5"
                    title="Vaciar todas las ranuras de mapas de este material"
                  >
                    <Trash2 size={11} />
                    <span>Limpiar Todo</span>
                  </button>
                </div>
              </div>

              {activeMaterial.useORM && (activeMaterial.aoMap || activeMaterial.roughnessMap || activeMaterial.metalnessMap) && (
                <button 
                  onClick={() => useStore.getState().generateORM(activeMaterial.id)}
                  className="w-full py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-[10px] font-bold rounded border border-indigo-500/30 transition-colors"
                >
                  GENERAR MAPA COMPUESTO ORM
                </button>
              )}

              {/* Ranuras de imágenes PBR */}
              <div className="grid grid-cols-2 gap-2.5">
                <TextureSlot 
                  label="Albedo / Base Color" 
                  slotKey="Albedo"
                  texture={activeMaterial.map} 
                  onDrop={e => onDropTexture(e, 'map')}
                  onSelectFile={f => onSelectTextureFile(f, 'map')}
                  onOpenLibrary={() => { setTextureSlotTarget('map'); setActiveTab('textures'); }}
                  onModify={() => handleModifyMap('Albedo / Base Color', 'map')}
                  onGeneratePBRSet={() => handleGeneratePBRFromSource(activeMaterial.map)}
                  onClear={() => updateMaterial(activeMaterial.id, { map: undefined })}
                />
                <TextureSlot 
                  label={`Normal Map (${activeMaterial.normalFormat === 'DIRECTX' ? 'DirectX' : 'OpenGL'})`}
                  slotKey="Normal Map"
                  texture={activeMaterial.normalMap} 
                  onDrop={e => onDropTexture(e, 'normalMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'normalMap')}
                  onOpenLibrary={() => { setTextureSlotTarget('normalMap'); setActiveTab('textures'); }}
                  onModify={() => handleModifyMap('Normal Map', 'normalMap')}
                  onGeneratePBRSet={() => handleGeneratePBRFromSource(activeMaterial.normalMap)}
                  onClear={() => updateMaterial(activeMaterial.id, { normalMap: undefined })}
                />

                {activeMaterial.useORM ? (
                  <div className="col-span-2 space-y-2">
                    <TextureSlot 
                      label="ORM Map (R:AO, G:Rough, B:Metal)" 
                      slotKey="ORM"
                      texture={activeMaterial.ormMap} 
                      onDrop={e => onDropTexture(e, 'ormMap')}
                      onSelectFile={f => onSelectTextureFile(f, 'ormMap')}
                      onModify={() => handleModifyMap('ORM Map', 'ormMap')}
                      onClear={() => updateMaterial(activeMaterial.id, { ormMap: undefined })}
                      isLarge
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <IntensityControl 
                        label="AO" 
                        value={activeMaterial.ormIntensityAO ?? 1} 
                        onChange={v => updateMaterial(activeMaterial.id, { ormIntensityAO: v })} 
                      />
                      <IntensityControl 
                        label="Rough" 
                        value={activeMaterial.ormIntensityRoughness ?? 1} 
                        onChange={v => updateMaterial(activeMaterial.id, { ormIntensityRoughness: v })} 
                      />
                      <IntensityControl 
                        label="Metal" 
                        value={activeMaterial.ormIntensityMetalness ?? 1} 
                        onChange={v => updateMaterial(activeMaterial.id, { ormIntensityMetalness: v })} 
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <TextureSlot 
                      label="Roughness" 
                      slotKey="Roughness"
                      texture={activeMaterial.roughnessMap} 
                      onDrop={e => onDropTexture(e, 'roughnessMap')}
                      onSelectFile={f => onSelectTextureFile(f, 'roughnessMap')}
                      onOpenLibrary={() => { setTextureSlotTarget('roughnessMap'); setActiveTab('textures'); }}
                      onModify={() => handleModifyMap('Roughness', 'roughnessMap')}
                      onGeneratePBRSet={() => handleGeneratePBRFromSource(activeMaterial.roughnessMap)}
                      onClear={() => updateMaterial(activeMaterial.id, { roughnessMap: undefined })}
                    />
                    <TextureSlot 
                      label="Metalness" 
                      slotKey="Metalness"
                      texture={activeMaterial.metalnessMap} 
                      onDrop={e => onDropTexture(e, 'metalnessMap')}
                      onSelectFile={f => onSelectTextureFile(f, 'metalnessMap')}
                      onOpenLibrary={() => { setTextureSlotTarget('metalnessMap'); setActiveTab('textures'); }}
                      onModify={() => handleModifyMap('Metalness', 'metalnessMap')}
                      onClear={() => updateMaterial(activeMaterial.id, { metalnessMap: undefined })}
                    />
                    <TextureSlot 
                      label="Ambient Occlusion" 
                      slotKey="AO"
                      texture={activeMaterial.aoMap} 
                      onDrop={e => onDropTexture(e, 'aoMap')}
                      onSelectFile={f => onSelectTextureFile(f, 'aoMap')}
                      onOpenLibrary={() => { setTextureSlotTarget('aoMap'); setActiveTab('textures'); }}
                      onModify={() => handleModifyMap('Ambient Occlusion', 'aoMap')}
                      onGeneratePBRSet={() => handleGeneratePBRFromSource(activeMaterial.aoMap)}
                      onClear={() => updateMaterial(activeMaterial.id, { aoMap: undefined })}
                    />
                    <TextureSlot 
                      label="Displacement / Height" 
                      slotKey="Displacement"
                      texture={activeMaterial.displacementMap} 
                      onDrop={e => onDropTexture(e, 'displacementMap')}
                      onSelectFile={f => onSelectTextureFile(f, 'displacementMap')}
                      onOpenLibrary={() => { setTextureSlotTarget('displacementMap'); setActiveTab('textures'); }}
                      onModify={() => handleModifyMap('Displacement / Height', 'displacementMap')}
                      onGeneratePBRSet={() => handleGeneratePBRFromSource(activeMaterial.displacementMap)}
                      onClear={() => updateMaterial(activeMaterial.id, { displacementMap: undefined })}
                    />
                  </>
                )}

                <TextureSlot 
                  label="Emissive Map" 
                  slotKey="Emissive"
                  texture={activeMaterial.emissiveMap} 
                  onDrop={e => onDropTexture(e, 'emissiveMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'emissiveMap')}
                  onModify={() => handleModifyMap('Emissive Map', 'emissiveMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { emissiveMap: undefined })}
                />
                <TextureSlot 
                  label="Alpha / Opacidad" 
                  slotKey="Alpha"
                  texture={activeMaterial.alphaMap} 
                  onDrop={e => onDropTexture(e, 'alphaMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'alphaMap')}
                  onModify={() => handleModifyMap('Alpha / Opacity', 'alphaMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { alphaMap: undefined })}
                />
                <TextureSlot 
                  label="Transmission Map" 
                  slotKey="Transmission"
                  texture={activeMaterial.transmissionMap} 
                  onDrop={e => onDropTexture(e, 'transmissionMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'transmissionMap')}
                  onModify={() => handleModifyMap('Transmission Map', 'transmissionMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { transmissionMap: undefined })}
                />
                <TextureSlot 
                  label="Anisotropy Map" 
                  slotKey="Anisotropy"
                  texture={activeMaterial.anisotropyMap} 
                  onDrop={e => onDropTexture(e, 'anisotropyMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'anisotropyMap')}
                  onModify={() => handleModifyMap('Anisotropy Map', 'anisotropyMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { anisotropyMap: undefined })}
                />
                <TextureSlot 
                  label="Iridescence Map (Color)" 
                  slotKey="Iridescence"
                  texture={activeMaterial.iridescenceMap} 
                  onDrop={e => onDropTexture(e, 'iridescenceMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'iridescenceMap')}
                  onModify={() => handleModifyMap('Iridescence Map', 'iridescenceMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { iridescenceMap: undefined })}
                />
                <TextureSlot 
                  label="Iridescence Thickness" 
                  slotKey="IridescenceThickness"
                  texture={activeMaterial.iridescenceThicknessMap} 
                  onDrop={e => onDropTexture(e, 'iridescenceThicknessMap')}
                  onSelectFile={f => onSelectTextureFile(f, 'iridescenceThicknessMap')}
                  onModify={() => handleModifyMap('Iridescence Thickness Map', 'iridescenceThicknessMap')}
                  onClear={() => updateMaterial(activeMaterial.id, { iridescenceThicknessMap: undefined })}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODALES DE EDICIÓN 2D Y PROCEDIMENTAL DE MAPAS */}
      {activeMaterial && activeEditorMapKey && (
        <MapEditorModal
          title={activeEditorTitle || String(activeEditorMapKey)}
          url={(activeMaterial[activeEditorMapKey] as string) || null}
          repeat={activeMaterial.mapRepeat ? (Array.isArray(activeMaterial.mapRepeat) ? [activeMaterial.mapRepeat[0], activeMaterial.mapRepeat[1]] : [activeMaterial.mapRepeat, activeMaterial.mapRepeat]) : [1, 1]}
          onRepeatChange={rep => updateMaterial(activeMaterial.id, { mapRepeat: rep })}
          offset={activeMaterial.mapOffset ? (Array.isArray(activeMaterial.mapOffset) ? [activeMaterial.mapOffset[0], activeMaterial.mapOffset[1]] : [activeMaterial.mapOffset, activeMaterial.mapOffset]) : [0, 0]}
          onOffsetChange={off => updateMaterial(activeMaterial.id, { mapOffset: off })}
          rotation={activeMaterial.mapRotation ?? 0}
          onRotationChange={rot => updateMaterial(activeMaterial.id, { mapRotation: rot })}
          onApplyToAllMaps={(rep, off, rot) => {
            updateMaterial(activeMaterial.id, {
              mapRepeat: rep,
              mapOffset: off,
              mapRotation: rot,
            });
            setCopiedNotification('Transformaciones aplicadas a todos los mapas');
            setTimeout(() => setCopiedNotification(null), 2500);
          }}
          onClose={() => setActiveEditorMapKey(null)}
          onUpdate={newUrl => {
            updateMaterial(activeMaterial.id, { [activeEditorMapKey]: newUrl || undefined });
            setCopiedNotification(`Mapa ${activeEditorTitle} actualizado`);
            setTimeout(() => setCopiedNotification(null), 2000);
          }}
        />
      )}

      {activeMaterial && proceduralModalConfig && (
        <ProceduralMapModal
          config={proceduralModalConfig}
          onClose={() => setProceduralModalConfig(null)}
          onApply={dataUrl => {
            updateMaterial(activeMaterial.id, { [proceduralModalConfig.mapKey]: dataUrl });
            setProceduralModalConfig(null);
            setCopiedNotification('¡Mapa procedimental aplicado con éxito!');
            setTimeout(() => setCopiedNotification(null), 2500);
          }}
        />
      )}
    </div>
  );
};

const TextureSlot: React.FC<{ 
  label: string; 
  slotKey?: string;
  texture?: string; 
  onDrop: (e: React.DragEvent) => void; 
  onDropFile?: (file: File) => void;
  onSelectFile?: (file: File) => void;
  onClear: () => void;
  onOpenLibrary?: () => void;
  onModify?: () => void;
  onGeneratePBRSet?: () => void;
  isLarge?: boolean;
}> = ({ label, slotKey, texture, onDrop, onDropFile, onSelectFile, onClear, onOpenLibrary, onModify, onGeneratePBRSet, isLarge }) => {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const triggerFileInput = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (onSelectFile) {
      onSelectFile(file);
    } else if (onDropFile) {
      onDropFile(file);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dummyEvent = {
          dataTransfer: {
            getData: () => ev.target?.result as string,
            files: [file]
          },
          preventDefault: () => {},
          stopPropagation: () => {}
        } as unknown as React.DragEvent;
        onDrop(dummyEvent);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  return (
    <div className={`space-y-1.5 ${isLarge ? 'col-span-2' : ''}`}>
      <div className="flex items-center justify-between gap-1">
        <label className="text-[9px] text-zinc-300 font-bold uppercase tracking-tighter truncate block flex-1" title={label}>
          {label}
        </label>
        {texture && onGeneratePBRSet && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onGeneratePBRSet();
            }}
            className="text-[8px] font-bold text-amber-300 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/35 px-1.5 py-0.5 rounded border border-amber-500/30 flex items-center gap-0.5 transition-all flex-shrink-0"
            title="Generar resto de mapas PBR (Normal, Rugosidad, AO, Altura) a partir de este mapa"
          >
            <Sparkles size={8} className="text-amber-400" />
            <span>⚡ Formar PBR</span>
          </button>
        )}
      </div>

      <input 
        type="file" 
        ref={inputRef} 
        className="hidden" 
        accept="image/*,.png,.jpg,.jpeg,.webp,.tga,.bmp" 
        onChange={handleFileChange} 
      />

      <div
        onClick={() => triggerFileInput()}
        onDragOver={e => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop(e); setIsOver(false); }}
        className={`relative group cursor-pointer aspect-square rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center overflow-hidden ${
          texture 
            ? 'border-indigo-500/50 bg-indigo-500/5 hover:border-indigo-400' 
            : isOver ? 'border-indigo-400 bg-indigo-400/10' : 'border-white/10 bg-white/5 hover:border-indigo-500/40 hover:bg-white/[0.07]'
        } ${isLarge ? 'aspect-[2/1]' : ''}`}
      >
        {texture ? (
          <>
            <img 
              src={texture} 
              alt={label}
              className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-25 transition-opacity" 
            />

            {/* Botón de borrar en esquina superior derecha */}
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/80 text-zinc-400 hover:text-white hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100 z-30 shadow-md"
              title="Quitar este mapa"
            >
              <Trash2 size={11} />
            </button>

            {/* Botones de acción central con hover */}
            <div className="z-20 flex flex-col items-center gap-1 px-2 w-full max-w-[140px]">
              {/* Botón Cargar: carga desde archivo */}
              <button
                type="button"
                onClick={triggerFileInput}
                className="w-full py-1 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[9px] font-bold shadow-md transition-all flex items-center justify-center gap-1 active:scale-95 border border-indigo-400/30"
                title="Cargar nuevo archivo de imagen desde tu ordenador"
              >
                <Upload size={10} />
                <span>Cargar</span>
              </button>

              {/* Botón Modificar: abre herramientas de color/atributos */}
              {onModify && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onModify(); }}
                  className="w-full py-1 px-2 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 hover:text-white rounded-lg text-[9px] font-bold shadow-md transition-all flex items-center justify-center gap-1 border border-cyan-500/30"
                  title="Abrir herramientas para modificar atributos, colores, formas y filtros de este mapa"
                >
                  <Wand2 size={10} className="text-cyan-400" />
                  <span>Modificar</span>
                </button>
              )}

              {/* Botón Generar resto de mapas PBR */}
              {onGeneratePBRSet && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onGeneratePBRSet(); }}
                  className="w-full py-0.5 px-1.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded text-[8px] font-bold shadow-sm transition-all flex items-center justify-center gap-1 border border-amber-400/30 opacity-0 group-hover:opacity-100"
                  title="Generar Normal, Rugosidad, AO y Altura desde este mapa"
                >
                  <Sparkles size={9} />
                  <span>⚡ Formar PBR</span>
                </button>
              )}

              {onOpenLibrary && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenLibrary(); }}
                  className="w-full py-0.5 px-1.5 bg-black/60 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded text-[8px] font-medium transition-all backdrop-blur-sm border border-white/10 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100"
                  title="Abrir galería de texturas PBR"
                >
                  <FolderOpen size={9} className="text-indigo-400" />
                  <span>Galería</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-2 text-center w-full">
            <Upload size={18} className={`mb-1 transition-colors ${isOver ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-indigo-400'}`} />
            <span className="text-[9px] text-zinc-300 font-bold group-hover:text-white">Cargar</span>
            <span className="text-[8px] text-zinc-500">Haz clic o arrastra</span>
            {onOpenLibrary && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenLibrary(); }}
                className="mt-1.5 py-0.5 px-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded text-[8px] font-medium transition-all border border-white/5 flex items-center gap-1"
                title="Explorar texturas disponibles"
              >
                <FolderOpen size={9} className="text-indigo-400" />
                <span>Galería</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const IntensityControl: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between items-center px-1">
      <span className="text-[8px] font-bold text-zinc-600">{label}</span>
      <span className="text-[8px] font-mono text-zinc-400">{value.toFixed(1)}</span>
    </div>
    <input 
      type="range" min="0" max="2" step="0.1"
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full accent-indigo-500 h-1 bg-white/5 rounded-lg appearance-none cursor-pointer"
    />
  </div>
);
