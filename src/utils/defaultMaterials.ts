import { MaterialData } from '../types';
import { createNoiseTexture, createCheckerTexture, createWoodTexture } from './proceduralTextures';

export function getDefaultMaterials(): MaterialData[] {
  const noiseBump = createNoiseTexture(512, 512, 20, 0.3, true);
  const noiseRoughness = createNoiseTexture(512, 512, 10, 0.5, false);
  const woodDiffuse = createWoodTexture(512, 512, '#8b5a2b', '#5c3a21');
  const woodBump = createWoodTexture(512, 512, '#808080', '#404040'); // Grayscale for bump
  const checkerDiffuse = createCheckerTexture(512, 512, 8, '#ffffff', '#000000');

  return [
    { 
      id: 'm_gold', name: 'Oro', color: '#ffd700', 
      roughness: 0.1, roughnessMap: noiseRoughness, 
      metalness: 1.0, 
      normalMap: noiseBump, normalScale: 0.1,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'm_copper', name: 'Cobre', color: '#b87333', 
      roughness: 0.2, roughnessMap: noiseRoughness, 
      metalness: 1.0, 
      normalMap: noiseBump, normalScale: 0.15,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'm_silver', name: 'Plata / Cromo', color: '#c0c0c0', 
      roughness: 0.05, roughnessMap: noiseRoughness, 
      metalness: 1.0, 
      normalMap: noiseBump, normalScale: 0.05,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'm_iron', name: 'Hierro', color: '#434b4d', 
      roughness: 0.6, roughnessMap: noiseRoughness, 
      metalness: 1.0, 
      normalMap: noiseBump, normalScale: 0.5,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'r_stone', name: 'Piedra', color: '#888c8d', 
      roughness: 0.9, roughnessMap: noiseRoughness, 
      metalness: 0.0, 
      normalMap: noiseBump, normalScale: 1.0,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'r_marble', name: 'Mármol', color: '#e3e3e3', 
      roughness: 0.1, roughnessMap: noiseRoughness, 
      metalness: 0.0, 
      normalMap: noiseBump, normalScale: 0.05,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'g_ice_glacial', name: 'Hielo Glacial 3D (Blender PBR)', color: '#ffffff', 
      roughness: 0.12, roughnessMap: noiseRoughness,
      metalness: 0.0, 
      normalMap: noiseBump, normalScale: 0.15,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true, 
      ior: 1.31, transmission: 1.0, thickness: 2.8,
      attenuationColor: '#38bdf8', attenuationDistance: 1.2,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.05,
        cloudDensity: 1.5,
        cloudColor: '#e0f2fe',
        cloudScale: 2.6,
        frostIntensity: 0.85,
        crackIntensity: 0.9,
      }
    },
    { 
      id: 'g_clear', name: 'Cristal Claro', color: '#ffffff', 
      roughness: 0.0, 
      metalness: 0.0, 
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: true, ior: 1.5, transmission: 1.0, thickness: 0.5 
    },
    { 
      id: 'g_frosted', name: 'Cristal Esmerilado', color: '#ffffff', 
      roughness: 0.4, roughnessMap: noiseRoughness, 
      metalness: 0.0, 
      normalMap: noiseBump, normalScale: 0.2,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: true, ior: 1.5, transmission: 0.9, thickness: 0.5 
    },
    { 
      id: 'p_glossy', name: 'Plástico Brillante', color: '#e74c3c', 
      roughness: 0.1, 
      metalness: 0.0, 
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'p_matte', name: 'Plástico Mate', color: '#3498db', 
      roughness: 0.6, roughnessMap: noiseRoughness, 
      metalness: 0.0, 
      normalMap: noiseBump, normalScale: 0.1,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'w_oak', name: 'Roble', color: '#ffffff', 
      map: woodDiffuse,
      roughness: 0.7, roughnessMap: woodBump, 
      metalness: 0.0, 
      normalMap: woodBump, normalScale: 0.3,
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    { 
      id: 'checker', name: 'Ajedrez', color: '#ffffff', 
      map: checkerDiffuse,
      roughness: 0.5, 
      metalness: 0.0, 
      emissive: '#000000', emissiveIntensity: 1, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0 
    },
    // ── Emisores ─────────────────────────────────────────────────────────────
    {
      id: 'e_neon_pink', name: 'Neón Rosa', color: '#ff006e',
      roughness: 0.0, metalness: 0.0,
      emissive: '#ff006e', emissiveIntensity: 4,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_neon_cyan', name: 'Neón Cian', color: '#00f5ff',
      roughness: 0.0, metalness: 0.0,
      emissive: '#00f5ff', emissiveIntensity: 4,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_neon_green', name: 'Neón Verde', color: '#00ff41',
      roughness: 0.0, metalness: 0.0,
      emissive: '#00ff41', emissiveIntensity: 4,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_neon_violet', name: 'Neón Violeta', color: '#bf5fff',
      roughness: 0.0, metalness: 0.0,
      emissive: '#bf5fff', emissiveIntensity: 4,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_neon_orange', name: 'Neón Naranja', color: '#ff6500',
      roughness: 0.0, metalness: 0.0,
      emissive: '#ff6500', emissiveIntensity: 4,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_laser_red', name: 'Láser Rojo', color: '#ff0000',
      roughness: 0.0, metalness: 0.5,
      emissive: '#ff0000', emissiveIntensity: 8,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_laser_green', name: 'Láser Verde', color: '#00ff00',
      roughness: 0.0, metalness: 0.5,
      emissive: '#00ff00', emissiveIntensity: 8,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_laser_blue', name: 'Láser Azul', color: '#0080ff',
      roughness: 0.0, metalness: 0.5,
      emissive: '#0080ff', emissiveIntensity: 8,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_hologram', name: 'Holograma', color: '#00d4ff',
      roughness: 0.0, metalness: 0.0,
      emissive: '#00d4ff', emissiveIntensity: 2.5,
      opacity: 0.55, transparent: true, ior: 1.4, transmission: 0.3, thickness: 0.5,
    },
    {
      id: 'e_lava', name: 'Lava', color: '#ff4400',
      roughness: 0.9, metalness: 0.0,
      emissive: '#ff2200', emissiveIntensity: 2,
      normalMap: noiseBump, normalScale: 1.2,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_sun', name: 'Sol / Plasma', color: '#ffdd00',
      roughness: 0.2, metalness: 0.0,
      emissive: '#ff8800', emissiveIntensity: 5,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_led_white', name: 'LED Blanco', color: '#ffffff',
      roughness: 0.0, metalness: 0.0,
      emissive: '#ffffff', emissiveIntensity: 6,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'e_ember', name: 'Brasa', color: '#ff3300',
      roughness: 0.95, metalness: 0.0,
      emissive: '#dd1100', emissiveIntensity: 1.5,
      normalMap: noiseBump, normalScale: 0.8,
      opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'p_car_paint', name: 'Pintura de Coche', color: '#ff0000',
      roughness: 0.2, metalness: 0.5,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'p_velvet', name: 'Terciopelo', color: '#4a0e0e',
      roughness: 0.9, metalness: 0.0,
      sheen: 1.0, sheenRoughness: 0.5, sheenColor: '#ff9999',
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5, transmission: 0, thickness: 0,
    },
    {
      id: 'g_diamond', name: 'Diamante', color: '#ffffff',
      roughness: 0.0, metalness: 0.0,
      transmission: 1.0, ior: 2.417, thickness: 1.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
    },
    {
      id: 'm_anodized', name: 'Aluminio Anodizado', color: '#3498db',
      roughness: 0.2, metalness: 1.0,
      specularIntensity: 0.5,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    // ── Adobe Substance 3D Collection ──────────────────────────────────────────
    {
      id: 'sub_damascus', name: 'Acero Damasco (Substance)', color: '#cbd5e1',
      roughness: 0.22, metalness: 1.0, normalMap: noiseBump, normalScale: 1.8,
      anisotropy: 0.75, anisotropyRotation: 45,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_bronze_patina', name: 'Bronce Pátina (Substance)', color: '#a87343',
      roughness: 0.45, metalness: 0.75, normalMap: noiseBump, normalScale: 2.2,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_shou_sugi_ban', name: 'Shou Sugi Ban Quemado (Substance)', color: '#18181b',
      roughness: 0.78, metalness: 0.12, normalMap: noiseBump, normalScale: 3.5,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_teak_deck', name: 'Teca Marina Cubierta (Substance)', color: '#b45309',
      roughness: 0.38, metalness: 0.0, normalMap: noiseBump, normalScale: 1.5,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_formwork_concrete', name: 'Hormigón Encofrado (Substance)', color: '#94a3b8',
      roughness: 0.75, metalness: 0.0, normalMap: noiseBump, normalScale: 2.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_terrazzo', name: 'Terrazo Veneciano (Substance)', color: '#f8fafc',
      roughness: 0.15, metalness: 0.0, clearcoat: 0.85, clearcoatRoughness: 0.05,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_calacatta_gold', name: 'Mármol Calacatta Gold (Substance)', color: '#ffffff',
      roughness: 0.08, metalness: 0.0, clearcoat: 0.9, clearcoatRoughness: 0.04,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_distressed_leather', name: 'Cuero Vintage Envejecido (Substance)', color: '#9a3412',
      roughness: 0.58, metalness: 0.0, sheen: 0.6, sheenRoughness: 0.4, sheenColor: '#d97706',
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_kintsugi', name: 'Kintsugi Cerámica Oro (Substance)', color: '#27272a',
      roughness: 0.35, metalness: 0.3, clearcoat: 0.6, normalMap: noiseBump, normalScale: 3.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_zellige', name: 'Azulejos Zellige Esmaltados (Substance)', color: '#0d9488',
      roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_tactical_polymer', name: 'Polímero Táctico (Substance)', color: '#27272a',
      roughness: 0.72, metalness: 0.0, normalMap: noiseBump, normalScale: 2.8,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.5,
    },
    {
      id: 'sub_magma_crust', name: 'Corteza Magma Activa (Substance)', color: '#18181b',
      roughness: 0.9, metalness: 0.0, emissive: '#ff3b00', emissiveIntensity: 3.5,
      normalMap: noiseBump, normalScale: 4.5, opacity: 1, transparent: false, ior: 1.5,
    },
    // ── Hielo y Nieve Procedural PBR (CGTrader / Natural Collection) ─────────────
    {
      id: 'ice_glacial_pbr', name: 'Hielo Glacial Puro (CGTrader PBR)', color: '#ffffff',
      roughness: 0.04, metalness: 0.0,
      transmission: 1.0, ior: 1.31, thickness: 2.8,
      attenuationColor: '#38bdf8', attenuationDistance: 1.2,
      clearcoat: 1.0, clearcoatRoughness: 0.02, dispersion: 0.025,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.045,
        cloudDensity: 1.5,
        cloudColor: '#e0f2fe',
        cloudScale: 2.6,
        frostIntensity: 0.85,
        crackIntensity: 0.9,
      }
    },
    {
      id: 'ice_frosted_pbr', name: 'Hielo con Escarcha Superficial (PBR)', color: '#ffffff',
      roughness: 0.16, metalness: 0.0,
      transmission: 0.94, ior: 1.31, thickness: 2.2,
      attenuationColor: '#7dd3fc', attenuationDistance: 1.5,
      clearcoat: 0.85, clearcoatRoughness: 0.08,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.035,
        cloudDensity: 1.1,
        cloudColor: '#f0f9ff',
        cloudScale: 2.4,
        frostIntensity: 1.35,
        crackIntensity: 0.6,
      }
    },
    {
      id: 'ice_cracked_pbr', name: 'Hielo Fisurado de Lago (PBR)', color: '#ffffff',
      roughness: 0.05, metalness: 0.0,
      transmission: 0.98, ior: 1.31, thickness: 3.5,
      attenuationColor: '#0284c7', attenuationDistance: 1.0,
      clearcoat: 1.0, clearcoatRoughness: 0.02,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.06,
        cloudDensity: 1.3,
        cloudColor: '#bae6fd',
        cloudScale: 3.2,
        frostIntensity: 0.7,
        crackIntensity: 1.45,
      }
    },
    {
      id: 'snow_powder_pbr', name: 'Nieve Fresca Polvo (PBR)', color: '#f8fafc',
      roughness: 0.85, metalness: 0.0,
      sheen: 0.95, sheenColor: '#e0f2fe', sheenRoughness: 0.35,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false, ior: 1.31,
    },
    {
      id: 'snow_ice_melt_pbr', name: 'Nieve y Hielo Descongelado (PBR)', color: '#ffffff',
      roughness: 0.30, metalness: 0.0,
      transmission: 0.60, ior: 1.31, thickness: 1.8,
      attenuationColor: '#38bdf8', attenuationDistance: 1.2,
      clearcoat: 0.9, clearcoatRoughness: 0.04,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      isIce: true,
      iceConfig: {
        enabled: true,
        surfaceWarp: 0.08,
        cloudDensity: 1.6,
        cloudColor: '#e2e8f0',
        cloudScale: 2.2,
        frostIntensity: 1.1,
        crackIntensity: 0.8,
      }
    },
    // ── Volumétricos Raymarching ───────────────────────────────────────────────
    {
      id: 'vol_cumulus', name: 'Nube Cúmulo (Raymarching)', color: '#ffffff',
      roughness: 1.0, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1, transparent: true,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'cloud',
        density: 2.5,
        scale: 2.2,
        lightIntensity: 1.5,
        color: '#ffffff',
        threshold: 0.20,
        thresholdMax: 0.72,
        absorption: 1.8,
        steps: 36,
        shadowSteps: 4,
        windSpeed: 0.08,
        windDirection: [0.1, 0.05, 0.0],
      }
    },
    {
      id: 'vol_storm', name: 'Nube de Tormenta 3D', color: '#475569',
      roughness: 1.0, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1, transparent: true,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'cloud',
        density: 5.5,
        scale: 5.8,
        lightIntensity: 1.5,
        color: '#475569',
        secondaryColor: '#2d3748',
        threshold: 0.34,
        thresholdMax: 0.86,
        absorption: 3.2,
        steps: 24,
        shadowSteps: 5,
        windSpeed: 0.12,
        windDirection: [0.15, 0.05, 0.0],
      }
    },
    {
      id: 'vol_nebula', name: 'Nebulosa Cósmica 3D', color: '#c084fc',
      roughness: 1.0, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1, transparent: true,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'plasma',
        density: 2.2,
        scale: 1.6,
        lightIntensity: 1.8,
        color: '#c084fc',
        threshold: 0.22,
        thresholdMax: 0.72,
        absorption: 1.2,
        steps: 36,
        shadowSteps: 4,
        windSpeed: 0.04,
        windDirection: [0.05, 0.02, 0.08],
      }
    },
    {
      id: 'vol_smoke', name: 'Humo Denso 3D', color: '#334155',
      roughness: 1.0, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1, transparent: true,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'smoke',
        density: 3.2,
        scale: 3.5,
        lightIntensity: 0.95,
        color: '#475569',
        threshold: 0.22,
        thresholdMax: 0.75,
        absorption: 2.8,
        steps: 36,
        shadowSteps: 6,
        windSpeed: 0.22,
        windDirection: [0.0, 1.0, 0.0],
      }
    },
    {
      id: 'vol_fire', name: 'Gas Ígneo / Fuego 3D', color: '#f97316',
      roughness: 1.0, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1, transparent: true,
      isVolumetric: true,
      volumetric: {
        enabled: true,
        mode: 'fire',
        density: 2.8,
        scale: 2.6,
        lightIntensity: 2.2,
        color: '#fb923c',
        threshold: 0.22,
        thresholdMax: 0.70,
        absorption: 1.2,
        steps: 42,
        shadowSteps: 4,
        windSpeed: 0.35,
        windDirection: [0.0, 1.0, 0.0],
      }
    },
    // ── WebGPU Physical Glass Collection (Dispersión Espectral, Refracción & Cáusticas) ──
    {
      id: 'glass_prism_spectral', name: 'Prisma Óptico Newton (WebGPU Glass)', color: '#ffffff',
      roughness: 0.01, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 1.0, ior: 1.65, thickness: 1.8, dispersion: 0.12,
      attenuationColor: '#ffffff', attenuationDistance: 8.0,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      iridescence: 0.8, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 700],
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
    },
    {
      id: 'glass_diamond_spectral', name: 'Diamante Cuántico (WebGPU Glass)', color: '#ffffff',
      roughness: 0.005, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 1.0, ior: 2.417, thickness: 2.5, dispersion: 0.18,
      attenuationColor: '#ffffff', attenuationDistance: 12.0,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      iridescence: 0.95, iridescenceIOR: 1.8, iridescenceThicknessRange: [300, 800],
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
    },
    {
      id: 'glass_frosted_mist', name: 'Vidrio Esmerilado Difuso (WebGPU Glass)', color: '#f8fafc',
      roughness: 0.38, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 0.96, ior: 1.52, thickness: 1.2, dispersion: 0.03,
      attenuationColor: '#e2e8f0', attenuationDistance: 2.5,
      clearcoat: 0.4, clearcoatRoughness: 0.2,
      isGlass: true,
      glassConfig: {
        enabled: true,
        preset: 'frosted_mist_glass',
        dispersion: 0.03,
        chromaticAberration: 0.02,
        frostedBlur: 0.85,
        rimGlow: 0.8,
        rimColor: '#f1f5f9',
        causticIntensity: 0.4,
      }
    },
    {
      id: 'glass_liquid_wave', name: 'Cristal de Agua Ondulante (WebGPU Glass)', color: '#f0f9ff',
      roughness: 0.02, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 1.0, ior: 1.333, thickness: 2.2, dispersion: 0.07,
      attenuationColor: '#0284c7', attenuationDistance: 3.5,
      clearcoat: 0.95, clearcoatRoughness: 0.02,
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
    },
    {
      id: 'glass_handblown_bubbles', name: 'Vidrio Soplado con Microburbujas (WebGPU Glass)', color: '#f8fafc',
      roughness: 0.06, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 0.98, ior: 1.51, thickness: 2.0, dispersion: 0.06,
      attenuationColor: '#bae6fd', attenuationDistance: 4.0,
      clearcoat: 0.9, clearcoatRoughness: 0.04,
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
    },
    {
      id: 'glass_dichroic_rainbow', name: 'Vidrio Dicroico Iridiscente (WebGPU Glass)', color: '#ffffff',
      roughness: 0.02, metalness: 0.05,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: true,
      transmission: 0.95, ior: 1.72, thickness: 1.5, dispersion: 0.14,
      attenuationColor: '#fbcfe8', attenuationDistance: 5.0,
      clearcoat: 1.0, clearcoatRoughness: 0.01,
      iridescence: 1.0, iridescenceIOR: 1.9, iridescenceThicknessRange: [180, 850],
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
    },
    // ── THREE-CustomShaderMaterial (CSM) Presets ──
    {
      id: 'csm_waves', name: 'CSM Ondas Líquidas & Vórtice', color: '#0284c7',
      roughness: 0.1, metalness: 0.2,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshPhysicalMaterial',
        preset: 'wave_distortion',
        timeSpeed: 1.2,
        displacementScale: 0.0,
        noiseFrequency: 2.2,
        colorAccent: '#38bdf8',
        glowIntensity: 0.5,
      }
    },
    {
      id: 'csm_hologram', name: 'CSM Escudo Holográfico Sci-Fi', color: '#0891b2',
      roughness: 0.15, metalness: 0.0,
      emissive: '#000000', emissiveIntensity: 0, opacity: 0.85, transparent: true,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'hologram_shield',
        timeSpeed: 2.0,
        displacementScale: 0.0,
        noiseFrequency: 8.0,
        colorAccent: '#06b6d4',
        glowIntensity: 2.5,
      }
    },
    {
      id: 'csm_magma', name: 'CSM Magma & Lava Volcánica', color: '#1c1917',
      roughness: 0.85, metalness: 0.1,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'volcanic_magma',
        timeSpeed: 0.8,
        displacementScale: 0.0,
        noiseFrequency: 3.5,
        colorAccent: '#ff3b00',
        glowIntensity: 3.0,
      }
    },
    {
      id: 'csm_twist', name: 'CSM Torsión Espacial Helicoidal', color: '#581c87',
      roughness: 0.2, metalness: 0.6,
      emissive: '#000000', emissiveIntensity: 0, opacity: 1, transparent: false,
      isCSM: true,
      csmConfig: {
        enabled: true,
        baseMaterial: 'MeshStandardMaterial',
        preset: 'twist_vortex',
        timeSpeed: 1.2,
        displacementScale: 0.0,
        noiseFrequency: 2.0,
        colorAccent: '#c084fc',
        glowIntensity: 1.8,
      }
    }
  ];
}
