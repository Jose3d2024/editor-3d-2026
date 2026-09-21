/**
 * materialImporter.ts
 * 
 * Importa packs de materiales PBR en múltiples formatos:
 *  - Carpeta / selección múltiple de PNG/JPG con autodetección por nombre
 *  - .mtlx   (MaterialX — XML abierto de Academy Software Foundation)
 *  - .tres   (Godot Engine 4 — texto clave=valor)
 *  - .usda   (USD ASCII — Universal Scene Description texto)
 *  - .usdc   (USD compilado — devuelve error con instrucción de conversión)
 *  - .blend  (Blender nativo — no factible, devuelve error)
 */

import type { MaterialData } from '../types';

export type PartialMaterial = Omit<MaterialData, 'id'>;

export interface ImportResult {
  material: Partial<PartialMaterial>;
  detectedSlots: Record<string, string>; // filename → slot
  warnings: string[];
  unresolvedTextures: string[]; // texture filenames referenced but not provided
}

// ── Tipos de slots y sus patrones de detección por nombre ──────────────────
const SLOT_PATTERNS: Record<string, string[]> = {
  map:                   ['basecolor','base_color','albedo','color','diffuse','_col','_dif','_alb','_bc','color.'],
  normalMap:             ['normal','nrm','nor','_n.','normalgl','normaldx','normal_gl','normal_dx','_norm'],
  roughnessMap:          ['roughness','rough','_rgh','_r.','roughness.'],
  metalnessMap:          ['metallic','metalness','metal','_met','_m.','metallic.'],
  aoMap:                 ['ambientocclusion','_ao','ao.','occlusion','ambient_occlusion'],
  emissiveMap:           ['emissive','emission','_emi','_e.','emissive.'],
  displacementMap:       ['height','displacement','disp','_h.','bump','_dp'],
  alphaMap:              ['opacity','alpha','mask','cutout','transparency','_opac'],
  clearcoatMap:          ['clearcoat','clear_coat','coating','_coat'],
  clearcoatNormalMap:    ['clearcoat_normal','coat_normal','coating_normal','coat_norm'],
  sheenColorMap:         ['sheencolor','sheen_color','sheen'],
  anisotropyMap:         ['anisotropy','aniso','tangent','flowmap'],
  transmissionMap:       ['transmission','transmiss','refraction'],
};

/** Detecta el slot de una textura a partir de su nombre de archivo */
export function detectSlotFromFilename(filename: string): keyof typeof SLOT_PATTERNS | null {
  const lower = filename.toLowerCase().replace(/\.(png|jpe?g|webp|tga|tiff?)$/i, '');
  for (const [slot, patterns] of Object.entries(SLOT_PATTERNS)) {
    if (patterns.some(p => lower.includes(p))) {
      return slot as keyof typeof SLOT_PATTERNS;
    }
  }
  return null;
}

/** Lee un File como data URL base64 */
function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target!.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Convierte valores RGB 0-1 a hex string */
function rgb01ToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${clamp(r).toString(16).padStart(2,'0')}${clamp(g).toString(16).padStart(2,'0')}${clamp(b).toString(16).padStart(2,'0')}`;
}

// ── Valores por defecto para cualquier material importado ──────────────────
const MATERIAL_DEFAULTS: Partial<PartialMaterial> = {
  color:             '#ffffff',
  roughness:         0.5,
  metalness:         0.0,
  emissive:          '#000000',
  emissiveIntensity: 1,
  opacity:           1,
  transparent:       false,
  ior:               1.5,
  transmission:      0,
  thickness:         0,
};

// ────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN DE PACK MULTI-ARCHIVO
// El usuario selecciona varios archivos (textures + opcionalmente .mtlx/.tres/.usda)
// ────────────────────────────────────────────────────────────────────────────
export async function importPBRPack(files: File[]): Promise<ImportResult> {
  const result: Partial<PartialMaterial> = { ...MATERIAL_DEFAULTS };
  const detectedSlots: Record<string, string> = {};
  const warnings: string[] = [];
  const unresolvedTextures: string[] = [];

  // Separar archivo de formato vs imágenes
  const formatFile = files.find(f => /\.(mtlx|tres|usda|usdc|blend)$/i.test(f.name));
  const imageFiles  = files.filter(f => /\.(png|jpe?g|webp|tga|tiff?)$/i.test(f.name));

  // Procesar archivo de formato si existe
  if (formatFile) {
    const ext = formatFile.name.split('.').pop()?.toLowerCase();

    if (ext === 'blend') {
      warnings.push('⛔ Los archivos .blend no pueden importarse directamente en el navegador. Exporta el material desde Blender como GLB o GLTF, o usa "File > Export > glTF 2.0" con la opción de materiales PBR activada.');
      return { material: result, detectedSlots, warnings, unresolvedTextures };
    }

    if (ext === 'usdc') {
      warnings.push('⚠️ Los archivos .usdc son USD binario compilado y requieren conversión previa. Usa usdcat (USD Tools) o Blender para convertirlo a .usda (texto ASCII) y luego impórtalo aquí.');
      return { material: result, detectedSlots, warnings, unresolvedTextures };
    }

    try {
      const text = await formatFile.text();
      let parsed: Partial<PartialMaterial> & { _texRefs?: Record<string, string> } = {};

      if (ext === 'mtlx')      parsed = parseMTLX(text);
      else if (ext === 'tres') parsed = parseTRES(text);
      else if (ext === 'usda') parsed = parseUSDA(text);

      const { _texRefs, ...rest } = parsed;
      Object.assign(result, rest);

      // Resolver referencias de texturas si se proporcionaron imágenes
      if (_texRefs) {
        for (const [refName, slot] of Object.entries(_texRefs)) {
          const match = imageFiles.find(f =>
            f.name === refName ||
            f.name.endsWith('/' + refName) ||
            f.name.replace(/^.*[\\/]/, '') === refName
          );
          if (match) {
            const dataURL = await fileToDataURL(match);
            (result as any)[slot] = dataURL;
            detectedSlots[match.name] = slot;
          } else {
            unresolvedTextures.push(refName);
          }
        }
      }
    } catch (e) {
      warnings.push(`Error al parsear ${formatFile.name}: ${(e as Error).message}`);
    }
  }

  // Asignar imágenes por nombre (autodetección)
  for (const file of imageFiles) {
    if (Object.values(detectedSlots).includes(file.name)) continue; // ya asignada
    const slot = detectSlotFromFilename(file.name);
    if (slot && !(result as any)[slot]) {
      const dataURL = await fileToDataURL(file);
      (result as any)[slot] = dataURL;
      detectedSlots[file.name] = slot;

      // Autodetectar formato DirectX vs OpenGL para mapas normales
      if (slot === 'normalMap') {
        const lowerName = file.name.toLowerCase();
        if (lowerName.includes('directx') || lowerName.includes('_dx') || lowerName.includes('normaldx') || lowerName.includes('normal_dx')) {
          result.normalFormat = 'DIRECTX';
          result.invertNormalY = true;
        } else if (lowerName.includes('opengl') || lowerName.includes('_gl') || lowerName.includes('normalgl') || lowerName.includes('normal_gl')) {
          result.normalFormat = 'OPENGL';
          result.invertNormalY = false;
        }
      }
    } else if (!slot) {
      warnings.push(`No se reconoció el tipo de textura: "${file.name}". Asígnala manualmente en el editor.`);
    }
  }

  // Nombre del material
  if (!result.name) {
    if (formatFile) {
      result.name = formatFile.name.replace(/\.(mtlx|tres|usda)$/i, '');
    } else if (imageFiles.length > 0) {
      // Extraer nombre base de la primera imagen
      const base = imageFiles[0].name
        .replace(/\.(png|jpe?g|webp|tga|tiff?)$/i, '')
        .replace(/[_-]?(basecolor|albedo|color|normal|roughness|metallic|ao|height|emissive|displacement)[_-]?.*$/i, '');
      result.name = base || 'Material PBR';
    }
  }

  if (unresolvedTextures.length > 0) {
    warnings.push(`Texturas referenciadas pero no encontradas: ${unresolvedTextures.join(', ')}. Impórtalas manualmente arrastrándolas a los slots.`);
  }

  return { material: result, detectedSlots, warnings, unresolvedTextures };
}

// ────────────────────────────────────────────────────────────────────────────
// PARSER: MaterialX (.mtlx)
// Formato XML abierto — estándar de Academy Software Foundation
// ────────────────────────────────────────────────────────────────────────────
export function parseMTLX(xml: string): Partial<PartialMaterial> & { _texRefs?: Record<string, string> } {
  const result: any = { ...MATERIAL_DEFAULTS };
  const texRefs: Record<string, string> = {};

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');

    // Nombre desde material o nodegraph
    const matEl = doc.querySelector('material, surfacematerial');
    if (matEl) result.name = matEl.getAttribute('name') || undefined;

    // Recoger todos los nodos imagen
    const imgNodes: Record<string, string> = {}; // nodename → filename
    doc.querySelectorAll('image, tiledimage').forEach(img => {
      const name = img.getAttribute('name') || '';
      // Intentar obtener el archivo desde un input hijo o desde el atributo 'file' directo
      const fileInput = img.querySelector('input[name="file"]');
      const file = fileInput?.getAttribute('value') || img.getAttribute('file') || '';
      if (name && file) imgNodes[name] = file.split('/').pop() || file;
    });

    // Parser de standard_surface o UsdPreviewSurface
    const surface = doc.querySelector('standard_surface, UsdPreviewSurface');
    if (!surface) {
      // Intentar encontrar cualquier nodo con inputs de PBR
      const nodes = doc.querySelectorAll('[type="surfaceshader"]');
      if (nodes.length > 0 && !result.name) result.name = nodes[0].getAttribute('name') || undefined;
    }

    const parseInput = (name: string): { value?: string; nodename?: string } => {
      const el = (surface || doc.documentElement).querySelector(`input[name="${name}"]`);
      if (!el) return {};
      return {
        value:    el.getAttribute('value') || undefined,
        nodename: el.getAttribute('nodename') || el.getAttribute('output') || undefined,
      };
    };

    const resolveTexSlot = (inputName: string, slot: string) => {
      const { nodename } = parseInput(inputName);
      if (nodename && imgNodes[nodename]) {
        texRefs[imgNodes[nodename]] = slot;
      }
    };

    // Color base
    const base = parseInput('base_color') || parseInput('diffuseColor');
    if (base.value) {
      const vals = base.value.split(',').map(Number);
      if (vals.length >= 3) result.color = rgb01ToHex(vals[0], vals[1], vals[2]);
    }
    resolveTexSlot('base_color', 'map');
    resolveTexSlot('diffuseColor', 'map');

    // Roughness
    const rough = parseInput('roughness') || parseInput('specularRoughness');
    if (rough.value) result.roughness = parseFloat(rough.value) || 0.5;
    resolveTexSlot('roughness', 'roughnessMap');
    resolveTexSlot('specularRoughness', 'roughnessMap');

    // Metalness
    const metal = parseInput('metalness') || parseInput('metallic');
    if (metal.value) result.metalness = parseFloat(metal.value) || 0;
    resolveTexSlot('metalness', 'metalnessMap');
    resolveTexSlot('metallic', 'metalnessMap');

    // Normal
    resolveTexSlot('normal', 'normalMap');
    const normalScale = parseInput('normal_scale') || parseInput('bumpamplitude');
    if (normalScale.value) result.normalScale = parseFloat(normalScale.value) || 1;

    // Emisivo
    const emission = parseInput('emission_color') || parseInput('emissiveColor');
    if (emission.value) {
      const vals = emission.value.split(',').map(Number);
      if (vals.length >= 3) result.emissive = rgb01ToHex(vals[0], vals[1], vals[2]);
    }
    const emissionMult = parseInput('emission') || parseInput('emissiveStrength');
    if (emissionMult.value) result.emissiveIntensity = parseFloat(emissionMult.value) || 1;
    resolveTexSlot('emission_color', 'emissiveMap');

    // Transmisión / IOR
    const transmission = parseInput('transmission');
    if (transmission.value) {
      result.transmission = parseFloat(transmission.value) || 0;
      if (result.transmission > 0) result.transparent = true;
    }
    const ior = parseInput('ior');
    if (ior.value) result.ior = parseFloat(ior.value) || 1.5;

    // Opacidad
    const opacity = parseInput('opacity') || parseInput('opacityThreshold');
    if (opacity.value) {
      const vals = opacity.value.split(',').map(Number);
      const o = vals.length >= 3 ? (vals[0] + vals[1] + vals[2]) / 3 : vals[0];
      if (!isNaN(o)) { result.opacity = o; if (o < 1) result.transparent = true; }
    }

    // AO y displacement
    resolveTexSlot('ambientOcclusion', 'aoMap');
    resolveTexSlot('displacement', 'displacementMap');

    if (!result.name) {
      const firstSurf = doc.querySelector('[type="surfaceshader"]');
      if (firstSurf) result.name = firstSurf.getAttribute('name') || 'Material MTLX';
    }

  } catch (e) {
    console.warn('MTLX parse error:', e);
  }

  return { ...result, _texRefs: Object.keys(texRefs).length > 0 ? texRefs : undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// PARSER: Godot .tres (StandardMaterial3D / ORMMaterial3D)
// ────────────────────────────────────────────────────────────────────────────
export function parseTRES(text: string): Partial<PartialMaterial> & { _texRefs?: Record<string, string> } {
  const result: any = { ...MATERIAL_DEFAULTS };
  const texRefs: Record<string, string> = {};

  try {
    const lines = text.split('\n');

    // Mapa de ExtResource ID → filename
    const extResources: Record<string, string> = {};
    const extResRe = /^\[ext_resource\s+.*?path="([^"]+)"\s+id="([^"]+)"\]/;
    for (const line of lines) {
      const m = line.match(extResRe);
      if (m) extResources[m[2]] = m[1].split('/').pop() || m[1];
    }

    const getExtRes = (val: string): string | undefined => {
      const m = val.match(/ExtResource\("([^"]+)"\)/);
      return m ? extResources[m[1]] : undefined;
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Nombre del tipo de recurso
      const headerM = trimmed.match(/^\[gd_resource.*?type="([^"]+)"/);
      if (headerM) result.name = result.name || headerM[1];

      // Color base
      const colorM = trimmed.match(/^albedo_color\s*=\s*Color\(([^)]+)\)/);
      if (colorM) {
        const [r, g, b, a] = colorM[1].split(',').map(Number);
        result.color = rgb01ToHex(r, g, b);
        if (a !== undefined && a < 1) { result.opacity = a; result.transparent = true; }
      }

      // Textura albedo
      const albedoTexM = trimmed.match(/^albedo_texture\s*=\s*(.+)/);
      if (albedoTexM) { const f = getExtRes(albedoTexM[1]); if (f) texRefs[f] = 'map'; }

      // Roughness
      const roughM = trimmed.match(/^roughness\s*=\s*([0-9.]+)/);
      if (roughM) result.roughness = parseFloat(roughM[1]);

      const roughTexM = trimmed.match(/^roughness_texture\s*=\s*(.+)/);
      if (roughTexM) { const f = getExtRes(roughTexM[1]); if (f) texRefs[f] = 'roughnessMap'; }

      // Metallic
      const metalM = trimmed.match(/^metallic\s*=\s*([0-9.]+)/);
      if (metalM) result.metalness = parseFloat(metalM[1]);

      const metalTexM = trimmed.match(/^metallic_texture\s*=\s*(.+)/);
      if (metalTexM) { const f = getExtRes(metalTexM[1]); if (f) texRefs[f] = 'metalnessMap'; }

      // Normal
      const normalEnabledM = trimmed.match(/^normal_enabled\s*=\s*(true|false)/);
      const normalTexM = trimmed.match(/^normal_texture\s*=\s*(.+)/);
      if (normalTexM) { const f = getExtRes(normalTexM[1]); if (f) texRefs[f] = 'normalMap'; }

      const normalScaleM = trimmed.match(/^normal_scale\s*=\s*([0-9.]+)/);
      if (normalScaleM) result.normalScale = parseFloat(normalScaleM[1]);

      // AO
      const aoTexM = trimmed.match(/^ao_texture\s*=\s*(.+)/);
      if (aoTexM) { const f = getExtRes(aoTexM[1]); if (f) texRefs[f] = 'aoMap'; }

      // Emisivo
      const emissColorM = trimmed.match(/^emission\s*=\s*Color\(([^)]+)\)/);
      if (emissColorM) {
        const [r, g, b] = emissColorM[1].split(',').map(Number);
        result.emissive = rgb01ToHex(r, g, b);
      }

      const emissEnergyM = trimmed.match(/^emission_energy_multiplier\s*=\s*([0-9.]+)/);
      if (emissEnergyM) result.emissiveIntensity = parseFloat(emissEnergyM[1]);

      const emissTexM = trimmed.match(/^emission_texture\s*=\s*(.+)/);
      if (emissTexM) { const f = getExtRes(emissTexM[1]); if (f) texRefs[f] = 'emissiveMap'; }

      // Height / Displacement
      const heightTexM = trimmed.match(/^heightmap_texture\s*=\s*(.+)/);
      if (heightTexM) { const f = getExtRes(heightTexM[1]); if (f) texRefs[f] = 'displacementMap'; }

      const heightScaleM = trimmed.match(/^heightmap_scale\s*=\s*([0-9.]+)/);
      if (heightScaleM) result.displacementScale = parseFloat(heightScaleM[1]);

      // IOR
      const iorM = trimmed.match(/^refraction_scale\s*=\s*([0-9.]+)/);
      if (iorM) result.ior = parseFloat(iorM[1]);

      // Transparencia
      const transM = trimmed.match(/^transparency\s*=\s*([0-9]+)/);
      if (transM && parseInt(transM[1]) > 0) result.transparent = true;
    }

  } catch (e) {
    console.warn('TRES parse error:', e);
  }

  return { ...result, _texRefs: Object.keys(texRefs).length > 0 ? texRefs : undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// PARSER: USD ASCII (.usda)
// UsdPreviewSurface — el shader PBR estándar de USD
// ────────────────────────────────────────────────────────────────────────────
export function parseUSDA(text: string): Partial<PartialMaterial> & { _texRefs?: Record<string, string> } {
  const result: any = { ...MATERIAL_DEFAULTS };
  const texRefs: Record<string, string> = {};

  try {
    // Nombre del material
    const matNameM = text.match(/def Material "([^"]+)"/);
    if (matNameM) result.name = matNameM[1];

    // Extraer valor de una propiedad USD
    const getVal = (prop: string): string | null => {
      const re = new RegExp(prop.replace('.', '\\.') + '\\s*=\\s*([^\\n]+)');
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };

    // Extraer referencia de textura (asset path)
    const getTexRef = (prop: string): string | null => {
      const val = getVal(prop);
      if (!val) return null;
      const assetM = val.match(/@([^@]+)@/);
      return assetM ? assetM[1].split('/').pop() || null : null;
    };

    // Color difuso
    const diffuse = getVal('inputs:diffuseColor.default');
    if (diffuse) {
      const nums = diffuse.match(/([\d.]+)/g)?.map(Number);
      if (nums && nums.length >= 3) result.color = rgb01ToHex(nums[0], nums[1], nums[2]);
    }
    const diffuseTex = getTexRef('inputs:diffuseColor');
    if (diffuseTex) texRefs[diffuseTex] = 'map';

    // Roughness
    const rough = getVal('inputs:roughness.default');
    if (rough) result.roughness = parseFloat(rough) || 0.5;
    const roughTex = getTexRef('inputs:roughness');
    if (roughTex) texRefs[roughTex] = 'roughnessMap';

    // Metallic
    const metal = getVal('inputs:metallic.default');
    if (metal) result.metalness = parseFloat(metal) || 0;
    const metalTex = getTexRef('inputs:metallic');
    if (metalTex) texRefs[metalTex] = 'metalnessMap';

    // Normal
    const normalTex = getTexRef('inputs:normal');
    if (normalTex) texRefs[normalTex] = 'normalMap';
    const normalScale = getVal('inputs:normalScale.default');
    if (normalScale) result.normalScale = parseFloat(normalScale) || 1;

    // Emisivo
    const emissive = getVal('inputs:emissiveColor.default');
    if (emissive) {
      const nums = emissive.match(/([\d.]+)/g)?.map(Number);
      if (nums && nums.length >= 3) result.emissive = rgb01ToHex(nums[0], nums[1], nums[2]);
    }
    const emissiveTex = getTexRef('inputs:emissiveColor');
    if (emissiveTex) texRefs[emissiveTex] = 'emissiveMap';

    // Opacidad
    const opacity = getVal('inputs:opacity.default');
    if (opacity) {
      result.opacity = parseFloat(opacity) || 1;
      if (result.opacity < 1) result.transparent = true;
    }
    const opacityTex = getTexRef('inputs:opacity');
    if (opacityTex) texRefs[opacityTex] = 'alphaMap';

    // IOR
    const ior = getVal('inputs:ior.default');
    if (ior) result.ior = parseFloat(ior) || 1.5;

    // AO
    const aoTex = getTexRef('inputs:occlusion');
    if (aoTex) texRefs[aoTex] = 'aoMap';

    // Displacement
    const dispTex = getTexRef('inputs:displacement');
    if (dispTex) texRefs[dispTex] = 'displacementMap';

    // Transmission (UsdPreviewSurface no tiene transmission nativo, pero algunos exporters lo añaden)
    const transmission = getVal('inputs:transmission.default');
    if (transmission) {
      result.transmission = parseFloat(transmission) || 0;
      if (result.transmission > 0) result.transparent = true;
    }

  } catch (e) {
    console.warn('USDA parse error:', e);
  }

  return { ...result, _texRefs: Object.keys(texRefs).length > 0 ? texRefs : undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// Helper para importar un único archivo de imagen a un slot específico
// ────────────────────────────────────────────────────────────────────────────
export async function importTextureFile(file: File): Promise<{ dataURL: string; suggestedSlot: string | null }> {
  const dataURL = await fileToDataURL(file);
  const slot = detectSlotFromFilename(file.name);
  return { dataURL, suggestedSlot: slot };
}
