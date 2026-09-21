// proceduralTextures.ts — Professional PBR Material Library v2
// All 6 PBR maps (albedo, normal, roughness, metallic, AO, displacement)
// generated procedurally. Normal/roughness/AO/displacement share a common
// heightfield so they stay physically consistent.

import type { VolumetricConfig } from '../types';

// ── MOTOR DE CACHÉ PERSISTENTE INDUSTRIAL (INDEXEDDB) ────────────────────────
const DB_NAME = 'Editor3D_Materials_DB';
const DB_VERSION = 1;
const STORE_NAME = 'materials_cache';

// Inicializar la Base de Datos Local de forma segura
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Guarda de forma permanente un material (su miniatura o sus mapas binarios)
 */
export async function saveMaterialToDisk(id: string, dataUrl: string): Promise<void> {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(dataUrl, id);
    return new Promise((resolve) => { tx.oncomplete = () => resolve(); });
  } catch (e) {
    console.error("Error al guardar material en almacenamiento persistente:", e);
  }
}

/**
 * Recupera un material del almacenamiento persistente
 */
export async function loadMaterialFromDisk(id: string): Promise<string | null> {
  try {
    const db = await initDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve((request.result as string) || null);
    });
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD-COMPATIBLE LEGACY EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export function createNoiseTexture(
  width = 512, height = 512, scale = 10, intensity = 0.5, isNormal = false
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  const noise = (x: number, y: number) =>
    Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width * scale, ny = y / height * scale;
      const val = noise(nx, ny);
      const i = (y * width + x) * 4;
      if (isNormal) {
        data[i]   = ((noise(nx+0.1,ny)-val)*intensity+0.5)*255|0;
        data[i+1] = ((noise(nx,ny+0.1)-val)*intensity+0.5)*255|0;
        data[i+2] = 255; data[i+3] = 255;
      } else {
        const c = val*255*intensity + 255*(1-intensity)|0;
        data[i] = data[i+1] = data[i+2] = c; data[i+3] = 255;
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Generates an organic thin-film iridescent rainbow interference texture (soap bubble / oil slick)
 */
export function createThinFilmIridescenceTexture(
  width = 512, height = 512, swirlScale = 3.5, flowSpeed = 1.0, vibrancy = 1.2
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const snoise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const hash = (n: number) => Math.sin(n) * 43758.5453 % 1;
    const a = hash(i + j * 57), b = hash(i + 1 + j * 57);
    const c = hash(i + (j + 1) * 57), d = hash(i + 1 + (j + 1) * 57);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const nx = u * swirlScale, ny = v * swirlScale;
      const n1 = snoise(nx, ny);
      const n2 = snoise(nx * 2.2 + n1 * 1.5, ny * 2.2 + n1 * 1.5);
      const thickness = (n1 * 0.6 + n2 * 0.4 + (v * 0.2)) * 6.28318;

      const r = Math.sin(thickness * 1.0) * 0.5 + 0.5;
      const g = Math.sin(thickness * 1.0 + 2.094) * 0.5 + 0.5;
      const b = Math.sin(thickness * 1.0 + 4.188) * 0.5 + 0.5;

      const idx = (y * width + x) * 4;
      data[idx] = Math.min(255, Math.max(0, (r * vibrancy * 255) | 0));
      data[idx + 1] = Math.min(255, Math.max(0, (g * vibrancy * 255) | 0));
      data[idx + 2] = Math.min(255, Math.max(0, (b * vibrancy * 255) | 0));
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Generates an iridescence thickness grayscale map (fluid gradient & turbulence for Three.js iridescenceThicknessMap)
 */
export function createIridescenceThicknessTexture(
  width = 512, height = 512, scale = 4.0, swirl = 1.5
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  const snoise = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const hash = (n: number) => Math.sin(n) * 43758.5453 % 1;
    const a = hash(i + j * 57), b = hash(i + 1 + j * 57);
    const c = hash(i + (j + 1) * 57), d = hash(i + 1 + (j + 1) * 57);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const nx = u * scale, ny = v * scale;
      const n1 = snoise(nx, ny);
      const n2 = snoise(nx * 2.5 + n1 * swirl, ny * 2.5 + n1 * swirl);
      const val = Math.min(1.0, Math.max(0.0, 0.5 + 0.35 * n1 + 0.25 * n2));
      const c = (val * 255) | 0;

      const idx = (y * width + x) * 4;
      data[idx] = c;
      data[idx + 1] = c;
      data[idx + 2] = c;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function createCheckerTexture(
  width = 512, height = 512, size = 8, color1 = '#ffffff', color2 = '#000000'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const sw = width/size, sh = height/size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = (x+y)%2===0 ? color1 : color2;
      ctx.fillRect(x*sw, y*sh, sw, sh);
    }
  return canvas.toDataURL('image/png');
}

let _cachedUVDebugTexture: string | null = null;

export function getUVDebugTexture(): string {
  if (_cachedUVDebugTexture) return _cachedUVDebugTexture;
  _cachedUVDebugTexture = createUVDebugTexture(1024, 1024);
  return _cachedUVDebugTexture;
}

export function createUVDebugTexture(width = 1024, height = 1024): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  _cachedUVDebugTexture = null;

  const cols = 8;
  const rows = 8;
  const cellW = width / cols;
  const cellH = height / rows;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isEven = (r + c) % 2 === 0;
      const isRight = c >= cols / 2;
      const isBottom = r >= rows / 2; // In 2D canvas, r >= 4 is bottom half (Rows 1-4)

      let baseColor1 = '#f8fafc';
      let baseColor2 = '#1e293b';

      if (isBottom && !isRight) {
        // Bottom-Left (Rows 1-4, Cols A-D): Pink/Magenta
        baseColor1 = isEven ? '#fce7f3' : '#831843';
        baseColor2 = isEven ? '#fbcfe8' : '#500724';
      } else if (isBottom && isRight) {
        // Bottom-Right (Rows 1-4, Cols E-H): Blue/Cyan
        baseColor1 = isEven ? '#e0f2fe' : '#0c4a6e';
        baseColor2 = isEven ? '#bae6fd' : '#082f49';
      } else if (!isBottom && !isRight) {
        // Top-Left (Rows 5-8, Cols A-D): Amber/Yellow
        baseColor1 = isEven ? '#fef3c7' : '#78350f';
        baseColor2 = isEven ? '#fde68a' : '#451a03';
      } else {
        // Top-Right (Rows 5-8, Cols E-H): Green
        baseColor1 = isEven ? '#dcfce7' : '#064e3b';
        baseColor2 = isEven ? '#bbf7d0' : '#022c22';
      }

      ctx.fillStyle = isEven ? baseColor1 : baseColor2;
      ctx.fillRect(c * cellW, r * cellH, cellW, cellH);

      ctx.strokeStyle = isEven ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);

      ctx.strokeStyle = isEven ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c * cellW + cellW / 2, r * cellH);
      ctx.lineTo(c * cellW + cellW / 2, r * cellH + cellH);
      ctx.moveTo(c * cellW, r * cellH + cellH / 2);
      ctx.lineTo(c * cellW + cellW, r * cellH + cellH / 2);
      ctx.stroke();

      const colLabel = String.fromCharCode(65 + c); // A..H
      const rowLabel = (rows - r).toString(); // 8 at top (r=0), 1 at bottom (r=7)
      const cellText = `${colLabel}${rowLabel}`;

      ctx.fillStyle = isEven ? '#0f172a' : '#f8fafc';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cellText, c * cellW + cellW / 2, r * cellH + cellH / 2);
    }
  }

  // U (+X) Red Arrow (Bottom-Left: Row 1, Col A)
  const baseY = height - 35;
  ctx.strokeStyle = '#ef4444';
  ctx.fillStyle = '#ef4444';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(25, baseY);
  ctx.lineTo(135, baseY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(135, baseY);
  ctx.lineTo(120, baseY - 10);
  ctx.lineTo(120, baseY + 10);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('U (+X)', 155, baseY);

  // V (+Y) Green Arrow (Bottom-Left: Row 1, Col A)
  ctx.strokeStyle = '#22c55e';
  ctx.fillStyle = '#22c55e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(35, baseY);
  ctx.lineTo(35, baseY - 110);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(35, baseY - 110);
  ctx.lineTo(25, baseY - 95);
  ctx.lineTo(45, baseY - 95);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('V (+Y)', 50, baseY - 110);

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);

  const dataUrl = canvas.toDataURL('image/png');
  _cachedUVDebugTexture = dataUrl;
  return dataUrl;
}

export function createWoodTexture(
  width = 512, height = 512, baseColor = '#8b5a2b', ringColor = '#5c3a21'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return '';
  const hex2rgb = (h: string) => {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return r ? { r:parseInt(r[1],16), g:parseInt(r[2],16), b:parseInt(r[3],16) } : {r:0,g:0,b:0};
  };
  const c2 = hex2rgb(ringColor);
  ctx.fillStyle = baseColor; ctx.fillRect(0,0,width,height);
  for (let i = 0; i < 2000; i++) {
    ctx.fillStyle = `rgba(${c2.r},${c2.g},${c2.b},${0.1+Math.random()*0.2})`;
    ctx.fillRect(Math.random()*width,Math.random()*height,1+Math.random()*2,10+Math.random()*100);
  }
  return canvas.toDataURL('image/png');
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED MATH ENGINE & 4D SEAMLESS NOISE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ruido Simplex/Perlin base en 4D. Genera valores continuos sobre un toroide.
 */
export function noise4D(x: number, y: number, z: number, w: number, seed = 42): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + w * 94.123 + seed) * 43758.5453123;
  return (n - Math.floor(n));
}

/**
 * Movimiento Browniano Fraccionado (FBM) sobre topología toroidal de 4D sin costuras.
 * Garantiza continuidad perfecta entre bordes sin la arruga radial de esquina.
 */
export function getSeamlessFBM4D(px: number, py: number, w: number, h: number, frequency: number, octaves = 5): number {
  const angleX = ((px / w) + 0.137) * Math.PI * 2.0;
  const angleY = ((py / h) + 0.241) * Math.PI * 2.0;

  let x = Math.cos(angleX) * frequency;
  let z = Math.sin(angleX) * frequency;
  let y = Math.cos(angleY) * frequency;
  let w4 = Math.sin(angleY) * frequency;

  let value = 0.0;
  let amplitude = 0.5;
  let currentFreq = 1.0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * vNoise4D(x * currentFreq, y * currentFreq, z * currentFreq, w4 * currentFreq, i * 13);
    currentFreq *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * Convierte un mapa de alturas escalar en un Normal Map PBR perfectamente continuo.
 * Usa lógica modular (%) en las fronteras para coser las costuras del relieve.
 */
export function heightToNormalSeamless(heightField: Float32Array, w: number, h: number, strength = 3.5): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idxLeft  = py * w + ((px - 1 + w) % w);
      const idxRight = py * w + ((px + 1) % w);
      const idxTop   = ((py - 1 + h) % h) * w + px;
      const idxDown  = ((py + 1) % h) * w + px;

      const dx = (heightField[idxRight] - heightField[idxLeft]) * strength;
      const dy = (heightField[idxDown] - heightField[idxTop]) * strength;
      const dz = 1.0;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;

      const i = (py * w + px) * 4;
      rgba[i]     = ((nx * 0.5 + 0.5) * 255) | 0;
      rgba[i + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      rgba[i + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

/**
 * GENERADOR DE COORDENADAS CÍCLICAS UNIVERSAL (4D TORUS MAPPING)
 * Convierte un plano lineal 2D en una superficie infinita sin costuras.
 */
export function getUniversalSeamlessNoise(
  px: number, 
  py: number, 
  w: number, 
  h: number, 
  frequency: number,
  noiseFunc4D: (x: number, y: number, z: number, w: number) => number
): number {
  const angleX = ((px / w) + 0.137) * Math.PI * 2.0;
  const angleY = ((py / h) + 0.241) * Math.PI * 2.0;

  const nx = Math.cos(angleX) * frequency;
  const nz = Math.sin(angleX) * frequency;
  const ny = Math.cos(angleY) * frequency;
  const nw = Math.sin(angleY) * frequency;

  return noiseFunc4D(nx, ny, nz, nw);
}

function vNoise4D(x: number, y: number, z: number, w: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), wi = Math.floor(w);
  const xf = x - xi, yf = y - yi, zf = z - zi, wf = w - wi;
  const fade = (t: number) => t * t * (3 - 2 * t);
  const hash4 = (a: number, b: number, c: number, d: number): number => {
    let n = (a * 1619 + b * 31337 + c * 6971 + d * 1013 + s * 137) | 0;
    n = ((n >> 13) ^ n) | 0;
    return ((n * ((n * n * 15731 + 789221) | 0) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  };
  const u = fade(xf), v = fade(yf), r = fade(zf), q = fade(wf);
  
  let total = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < 2; k++) {
        for (let l = 0; l < 2; l++) {
          const weight = (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? r : 1 - r) * (l ? q : 1 - q);
          total += weight * hash4(xi + i, yi + j, zi + k, wi + l);
        }
      }
    }
  }
  return total;
}

export function fbm4D(x: number, y: number, z: number, w: number, oct = 5, s = 0): number {
  let val = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < oct; i++) {
    val += vNoise4D(x * freq, y * freq, z * freq, w * freq, s + i * 137) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / max;
}

function vNoise(x: number, y: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const fade = (t: number) => t * t * (3.0 - 2.0 * t);
  const hash = (a: number, b: number): number => {
    let n = (a * 1619 + b * 31337 + s * 137) | 0;
    n = ((n >> 13) ^ n) | 0;
    return ((n * ((n * n * 15731 + 789221) | 0) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  };
  const u = fade(xf), v = fade(yf);
  const n00 = hash(xi, yi);
  const n10 = hash(xi + 1, yi);
  const n01 = hash(xi, yi + 1);
  const n11 = hash(xi + 1, yi + 1);

  const x1 = n00 + u * (n10 - n00);
  const x2 = n01 + u * (n11 - n01);
  return x1 + v * (x2 - x1);
}

function fbm(x: number, y: number, oct = 5, s = 0): number {
  let val = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < oct; i++) {
    val += vNoise(x * freq, y * freq, s + i * 137) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.01;
  }
  return val / max;
}

function voronoi(px: number, py: number, scale: number, seed = 0): { d1: number; d2: number; id: number } {
  const numCells = Math.max(1, Math.round(scale));
  const hash2 = (a: number, b: number): [number, number] => {
    const ca = ((a % numCells) + numCells) % numCells;
    const cb = ((b % numCells) + numCells) % numCells;
    let h = (ca * 92837111 ^ cb * 689287499 ^ seed * 6971) | 0;
    h = ((h ^ (h >>> 13)) * 1540483477) | 0;
    return [(h & 0xffff) / 65536, ((h >>> 16) & 0xffff) / 65536];
  };
  const xi = Math.floor(px * numCells), yi = Math.floor(py * numCells);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const [fx, fy] = hash2(cx, cy);
      const wx = (cx + fx) / numCells, wy = (cy + fy) / numCells;
      let dxDist = Math.abs(px - wx);
      if (dxDist > 0.5) dxDist = 1.0 - dxDist;
      let dyDist = Math.abs(py - wy);
      if (dyDist > 0.5) dyDist = 1.0 - dyDist;
      const d = Math.sqrt(dxDist * dxDist + dyDist * dyDist) * numCells;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = (((cx % numCells + numCells) % numCells) & 0x3ff) | ((((cy % numCells + numCells) % numCells) & 0x3ff) << 10);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { d1: Math.min(d1, 1), d2: Math.min(d2, 1), id };
}

/**
 * Generador de Fisuras y Celdas Orgánicas con Domain Warping Multifrecuencia.
 * Elimina líneas poligonales rígidas y cuadrículas geométricas antinaturales,
 * produciendo curvas fractales, ramificaciones naturales y facetas orgánicas.
 */
export function organicVoronoiFissures(
  nx: number,
  ny: number,
  px: number,
  py: number,
  w: number,
  h: number,
  scale: number,
  warpIntensity = 0.4,
  seed = 42
): { d1: number; d2: number; crack: number; wnx: number; wny: number; id: number } {
  const w1 = (getSeamlessFBM4D(px, py, w, h, 2.0, 3) - 0.5) * warpIntensity;
  const w2 = (getSeamlessFBM4D((px + 179) % w, (py + 283) % h, w, h, 2.0, 3) - 0.5) * warpIntensity;
  const microWarp = (vNoise(nx * 20, ny * 20, seed + 11) - 0.5) * (warpIntensity * 0.35);

  const wnx = nx + w1 + microWarp;
  const wny = ny + w2 + microWarp;

  const { d1, d2, id } = voronoi(wnx * scale, wny * scale, Math.round(scale * 1.5), seed);
  const crackRaw = d2 - d1;
  const microNoise = (vNoise(wnx * scale * 5, wny * scale * 5, seed + 99) - 0.5) * 0.025;
  const crack = Math.max(0, crackRaw + microNoise);

  return { d1, d2, crack, wnx, wny, id };
}

function voronoiField(w: number, h: number, scale = 12, seed = 5): Float32Array {
  const f = new Float32Array(w * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const { d1 } = voronoi(px / w, py / h, scale, seed);
      f[py * w + px] = d1;
    }
  }
  return f;
}

/**
 * Generador de Normales Continuo. 
 * Fuerza al cálculo del relieve a saltar de un extremo al otro de forma cíclica.
 */
export function heightToNormal(heightField: Float32Array, w: number, h: number, strength = 2.0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // CORRECCIÓN MATEMÁTICA: Uso del operador módulo (%) para amarrar los extremos
      const idxLeft  = py * w + ((px - 1 + w) % w); // Si px es 0, lee de forma segura el píxel w-1
      const idxRight = py * w + ((px + 1) % w);     // Si px es w-1, lee el píxel 0
      const idxTop   = ((py - 1 + h) % h) * w + px;
      const idxDown  = ((py + 1) % h) * w + px;

      const hL = heightField[idxLeft];
      const hR = heightField[idxRight];
      const hT = heightField[idxTop];
      const hD = heightField[idxDown];

      // Cálculo de vectores normales PBR nítidos
      const dx = (hR - hL) * strength;
      const dy = (hD - hT) * strength;
      const dz = 1.0;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const nx = dx / len;
      const ny = dy / len;
      const nz = dz / len;

      const i = (py * w + px) * 4;
      rgba[i]     = ((nx * 0.5 + 0.5) * 255) | 0; // Canal R (X)
      rgba[i + 1] = ((ny * 0.5 + 0.5) * 255) | 0; // Canal G (Y)
      rgba[i + 2] = ((nz * 0.5 + 0.5) * 255) | 0; // Canal B (Z)
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

// ── IN-MEMORY BUFFER CACHE FOR FAST INSTANT FILTERING & RE-RENDERING ──
const globalBufferCache = new Map<string, Uint8ClampedArray>();

function rgbaToDataURL(rgba:Uint8ClampedArray,w:number,h:number):string{
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d')!;
  const img=ctx.createImageData(w,h);img.data.set(rgba);ctx.putImageData(img,0,0);
  const dataUrl = c.toDataURL('image/png');
  globalBufferCache.set(dataUrl, new Uint8ClampedArray(rgba));
  return dataUrl;
}

function grayFieldBuffer(field: Float32Array, w: number, h: number, invert = false): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < field.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, invert ? 1 - field[i] : field[i])) * 255);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function uniformMapBuffer(w: number, h: number, value: number): Uint8ClampedArray {
  const v = Math.round(Math.min(1, Math.max(0, value > 1 ? value / 255 : value)) * 255);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function grayField(field: Float32Array, w: number, h: number, invert = false): string {
  return rgbaToDataURL(grayFieldBuffer(field, w, h, invert), w, h);
}

function uniformMap(w: number, h: number, value: number): string {
  return rgbaToDataURL(uniformMapBuffer(w, h, value), w, h);
}

function mapField(field:Float32Array,fn:(v:number)=>number):Float32Array{
  const out=new Float32Array(field.length);
  for(let i=0;i<field.length;i++)out[i]=fn(field[i]);
  return out;
}

function clamp(v:number,lo=0,hi=1){return Math.min(hi,Math.max(lo,v));}
function lerp(a:number,b:number,t:number){return a+(b-a)*t;}
function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TYPES & IMPERFECTION FILTERS
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialFilters {
  rust: number;      // 0.0 a 1.0 (Cantidad de óxido/corrosión porosa)
  scratches: number; // 0.0 a 1.0 (Densidad de arañazos e incisiones finas)
  dirt: number;      // 0.0 a 1.0 (Manchas de suciedad acumulada)
}

export interface RawMaps {
  albedoArray: Uint8ClampedArray;
  normalArray: Uint8ClampedArray;
  roughnessArray: Uint8ClampedArray;
  metallicArray: Uint8ClampedArray;
  aoArray: Uint8ClampedArray;
  displacementArray: Uint8ClampedArray;
}

export interface GeneratedMaps {
  albedo:string; normal:string; roughness:string;
  metallic:string; ao:string; displacement:string;
}

export interface ProceduralMaterial {
  id: string; name: string;
  category: 'wood' | 'stone' | 'metal' | 'paint' | 'synthetic' | 'ground' | 'textile' | 'iridescent' | 'gaseous' | 'ice_snow' | 'csm' | 'glass_webgpu';
  icon: string;
  isVolumetric?: boolean;
  volumetric?: VolumetricConfig;
  isCSM?: boolean;
  csmConfig?: any;
  isWebGPUGlass?: boolean;
  webgpuGlass?: any;
  /** Suggested UV repeat — smaller = texture appears larger on mesh */
  defaults: {
    roughness: number; metalness: number;
    color?: string;
    emissive?: string;
    emissiveIntensity?: number;
    normalScale?: number; displacementScale?: number; displacementBias?: number;
    /** UV repeat in X and Y — e.g. [2,2] or single number 4.0 */
    tiling?: [number, number] | number;
    clearcoat?: number;
    clearcoatRoughness?: number;
    sheen?: number;
    sheenRoughness?: number;
    sheenColor?: string;
    iridescence?: number;
    iridescenceIOR?: number;
    iridescenceThicknessRange?: [number, number];
    transmission?: number;
    ior?: number;
    thickness?: number;
    attenuationColor?: string;
    attenuationDistance?: number;
    dispersion?: number;
    anisotropy?: number;
    anisotropyRotation?: number;
  };
  generate(width: number, height: number): GeneratedMaps;
  generateRawBuffers?(width: number, height: number): RawMaps;
  /** Fast 64x64 albedo preview for the picker UI */
  thumbnail?(): string;
}

// ── CONFIGURACIÓN GLOBAL DE IMPERFECCIONES (POST-PROCESADO BINARIO) ──────────

/**
 * Filtro Maestro que altera los mapas PBR inyectando imperfecciones físicas continuas.
 * Recibe los arrays crudos de píxeles (antes de convertirlos a DataURL).
 */
export function applyProceduralFilters(
  w: number,
  h: number,
  albedo: Uint8ClampedArray,
  normal: Uint8ClampedArray,
  roughness: Uint8ClampedArray,
  metallic: Uint8ClampedArray,
  ao: Uint8ClampedArray,
  settings: MaterialFilters
): void {
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;

      // ── 1. FILTRO DE ÓXIDO/CORROSIÓN POROSA (Rust) ──
      if (settings.rust > 0) {
        // Usamos nuestro ruido cíclico universal para que el óxido encaje en los bordes
        const rNoise = getUniversalSeamlessNoise(px, py, w, h, 1.8, fbm4D);
        
        // Umbral de ataque controlado por el deslizador
        if (rNoise > (1.0 - settings.rust * 0.75)) {
          // A. Modificar Albedo: Tiñe de color marrón-óxido poroso (#5c2a13)
          albedo[idx]     = lerp(albedo[idx], 92, 0.85);     // R
          albedo[idx + 1] = lerp(albedo[idx + 1], 42, 0.85); // G
          albedo[idx + 2] = lerp(albedo[idx + 2], 19, 0.85); // B

          // B. Modificar Roughness: El óxido es súper poroso y mate (sube a ~0.9)
          roughness[idx] = roughness[idx + 1] = roughness[idx + 2] = lerp(roughness[idx], 230, 0.9);

          // C. Modificar Metalness: El óxido corroe el metal, volviéndolo dieléctrico (0)
          metallic[idx] = metallic[idx + 1] = metallic[idx + 2] = lerp(metallic[idx], 0, 0.95);

          // D. Modificar Normal Map: Añade micro-relieve granulado y rugoso
          const grain = (Math.random() - 0.5) * 45; // Ruido estocástico controlado
          normal[idx]     = clamp(normal[idx] + grain, 0, 255);
          normal[idx + 1] = clamp(normal[idx + 1] + grain, 0, 255);
        }
      }

      // ── 2. FILTRO DE MANCHAS Y SUCIEDAD (Dirt) ──
      if (settings.dirt > 0) {
        // Ruido FBM suave y extendido para simular manchas de grasa, polvo o humedad
        const dNoise = getUniversalSeamlessNoise(px, py, w, h, 0.8, fbm4D);
        if (dNoise > (1.0 - settings.dirt * 0.8)) {
          const dirtFactor = (dNoise - (1.0 - settings.dirt * 0.8)) * 1.5;
          
          // Oscurecer el Albedo simulando mugre o acumulación de polvo
          albedo[idx]     = lerp(albedo[idx], 35, dirtFactor * 0.6);
          albedo[idx + 1] = lerp(albedo[idx + 1], 32, dirtFactor * 0.6);
          albedo[idx + 2] = lerp(albedo[idx + 2], 28, dirtFactor * 0.6);

          // Subir la rugosidad en las zonas manchadas
          roughness[idx] = roughness[idx + 1] = roughness[idx + 2] = lerp(roughness[idx], 200, dirtFactor * 0.4);
          
          // Atenuar la oclusión ambiental (AO) para ganar profundidad de mugre
          ao[idx] = ao[idx + 1] = ao[idx + 2] = lerp(ao[idx], 80, dirtFactor * 0.5);
        }
      }

      // ── 3. FILTRO DE ARAÑAZOS QUIRÚRGICOS (Scratches) ──
      if (settings.scratches > 0) {
        // Generamos líneas ultra-delgadas y afiladas usando un truco de alta frecuencia
        // sobre un ruido Voronoi modificado o un campo vectorial cíclico lineal
        const sNoise = getUniversalSeamlessNoise(px, py, w, h, 8.5, fbm4D);
        
        // Buscamos picos extremadamente delgados del ruido (las incisiones)
        if (sNoise > 0.88 - settings.scratches * 0.12 && sNoise < 0.90) {
          // El arañazo raspa el material exponiendo el color interior (brillante o claro)
          albedo[idx]     = clamp(albedo[idx] + 40, 0, 255);
          albedo[idx + 1] = clamp(albedo[idx + 1] + 40, 0, 255);
          albedo[idx + 2] = clamp(albedo[idx + 2] + 40, 0, 255);

          // Al ser una hendidura física, altera bruscamente los vectores del Normal Map (Gis)
          // Esto hace que el arañazo brille e intercepte la luz según gires la cámara
          normal[idx]     = clamp(normal[idx] + 60, 0, 255);     // Desvía vector X
          normal[idx + 1] = clamp(normal[idx + 1] - 60, 0, 255);     // Desvía vector Y
          
          // La zona arañada pierde pulido (sube la rugosidad)
          roughness[idx] = roughness[idx + 1] = roughness[idx + 2] = 220;
        }
      }

    }
  }
}

export function decodeDataUrlToBufferSync(dataUrl: string, w: number, h: number): Uint8ClampedArray {
  if (!dataUrl) return uniformMapBuffer(w, h, 0);
  if (globalBufferCache.has(dataUrl)) {
    return new Uint8ClampedArray(globalBufferCache.get(dataUrl)!);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return uniformMapBuffer(w, h, 0);
  
  // Create an image or deterministic fallback
  const img = new Image();
  img.src = dataUrl;
  if (img.complete && img.naturalWidth > 0) {
    try {
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      globalBufferCache.set(dataUrl, new Uint8ClampedArray(data));
      return data;
    } catch {
      return uniformMapBuffer(w, h, 0);
    }
  }

  // If async not loaded yet, check if it is a base64 string we can parse or return fallback
  return uniformMapBuffer(w, h, 128);
}

/**
 * Async decoder that reliably loads any DataURL or external image URL into a pixel buffer.
 */
export function decodeDataUrlToBufferAsync(dataUrl: string, w: number, h: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve(uniformMapBuffer(w, h, 0));
    if (globalBufferCache.has(dataUrl)) {
      return resolve(new Uint8ClampedArray(globalBufferCache.get(dataUrl)!));
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(uniformMapBuffer(w, h, 0));
      try {
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        globalBufferCache.set(dataUrl, new Uint8ClampedArray(data));
        resolve(data);
      } catch {
        resolve(uniformMapBuffer(w, h, 0));
      }
    };
    img.onerror = () => {
      resolve(uniformMapBuffer(w, h, 0));
    };
    img.src = dataUrl;
  });
}

export function getRawBuffersForMaterial(mat: ProceduralMaterial, w: number, h: number): RawMaps {
  if (mat.generateRawBuffers) {
    return mat.generateRawBuffers(w, h);
  }
  const maps = mat.generate(w, h);
  return {
    albedoArray: decodeDataUrlToBufferSync(maps.albedo, w, h),
    normalArray: decodeDataUrlToBufferSync(maps.normal, w, h),
    roughnessArray: decodeDataUrlToBufferSync(maps.roughness, w, h),
    metallicArray: decodeDataUrlToBufferSync(maps.metallic, w, h),
    aoArray: decodeDataUrlToBufferSync(maps.ao, w, h),
    displacementArray: decodeDataUrlToBufferSync(maps.displacement, w, h),
  };
}

/**
 * Applies procedural imperfection filters (rust, scratches, dirt) directly to any active material's maps.
 */
export function applyImperfectionsToCustomMaps(
  maps: {
    albedo?: string;
    normal?: string;
    roughness?: string;
    metallic?: string;
    ao?: string;
    displacement?: string;
    baseColorHex?: string;
    baseRoughness?: number;
    baseMetalness?: number;
  },
  filters: MaterialFilters,
  w = 512,
  h = 512
): GeneratedMaps {
  // Parse base color hex if provided
  let defaultR = 200, defaultG = 200, defaultB = 200;
  if (maps.baseColorHex) {
    const hex = maps.baseColorHex.replace('#', '');
    if (hex.length === 6) {
      defaultR = parseInt(hex.substring(0, 2), 16) || 200;
      defaultG = parseInt(hex.substring(2, 4), 16) || 200;
      defaultB = parseInt(hex.substring(4, 6), 16) || 200;
    }
  }

  // Create baseline buffers
  let albedoBuf: Uint8ClampedArray;
  if (maps.albedo && globalBufferCache.has(maps.albedo)) {
    albedoBuf = new Uint8ClampedArray(globalBufferCache.get(maps.albedo)!);
  } else {
    albedoBuf = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      albedoBuf[i * 4] = defaultR;
      albedoBuf[i * 4 + 1] = defaultG;
      albedoBuf[i * 4 + 2] = defaultB;
      albedoBuf[i * 4 + 3] = 255;
    }
  }

  let normalBuf: Uint8ClampedArray;
  if (maps.normal && globalBufferCache.has(maps.normal)) {
    normalBuf = new Uint8ClampedArray(globalBufferCache.get(maps.normal)!);
  } else {
    normalBuf = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      normalBuf[i * 4] = 128;     // X = 0
      normalBuf[i * 4 + 1] = 128; // Y = 0
      normalBuf[i * 4 + 2] = 255; // Z = +1
      normalBuf[i * 4 + 3] = 255;
    }
  }

  let roughBuf: Uint8ClampedArray;
  if (maps.roughness && globalBufferCache.has(maps.roughness)) {
    roughBuf = new Uint8ClampedArray(globalBufferCache.get(maps.roughness)!);
  } else {
    const rVal = Math.round((maps.baseRoughness ?? 0.5) * 255);
    roughBuf = uniformMapBuffer(w, h, rVal);
  }

  let metalBuf: Uint8ClampedArray;
  if (maps.metallic && globalBufferCache.has(maps.metallic)) {
    metalBuf = new Uint8ClampedArray(globalBufferCache.get(maps.metallic)!);
  } else {
    const mVal = Math.round((maps.baseMetalness ?? 0.0) * 255);
    metalBuf = uniformMapBuffer(w, h, mVal);
  }

  let aoBuf: Uint8ClampedArray;
  if (maps.ao && globalBufferCache.has(maps.ao)) {
    aoBuf = new Uint8ClampedArray(globalBufferCache.get(maps.ao)!);
  } else {
    aoBuf = uniformMapBuffer(w, h, 255);
  }

  // Apply filters
  if (filters && (filters.rust > 0 || filters.dirt > 0 || filters.scratches > 0)) {
    applyProceduralFilters(w, h, albedoBuf, normalBuf, roughBuf, metalBuf, aoBuf, filters);
  }

  return {
    albedo: rgbaToDataURL(albedoBuf, w, h),
    normal: rgbaToDataURL(normalBuf, w, h),
    roughness: rgbaToDataURL(roughBuf, w, h),
    metallic: rgbaToDataURL(metalBuf, w, h),
    ao: rgbaToDataURL(aoBuf, w, h),
    displacement: maps.displacement || uniformMap(w, h, 0),
  };
}

/**
 * Adaptador Avanzado que genera un material procedimental, le aplica los ruidos
 * sin costuras y acopla los filtros de suciedad, óxido y arañazos de tu UI.
 */
export function generateMaterialWithFilters(
  materialId: string, 
  w = 512, 
  h = 512, 
  filters: MaterialFilters
): GeneratedMaps | null {
  const mat = MATERIAL_LIBRARY.find(m => m.id === materialId);
  if (!mat) return null;

  // 1. Generar los mapas base (esto llena la caché globalBufferCache con los buffers reales)
  const baseMaps = mat.generate(w, h);
  if (!filters || (filters.rust === 0 && filters.dirt === 0 && filters.scratches === 0)) {
    return baseMaps;
  }

  // 2. Extraer buffers reales desde la caché o decodificar
  const rawMaps = getRawBuffersForMaterial(mat, w, h); 

  // 3. Inyectar el motor de imperfecciones procedimentales en caliente
  applyProceduralFilters(
    w, h, 
    rawMaps.albedoArray, 
    rawMaps.normalArray, 
    rawMaps.roughnessArray, 
    rawMaps.metallicArray, 
    rawMaps.aoArray, 
    filters
  );

  // 4. Empaquetar y devolver los mapas listos para Three.js como DataURLs limpios
  return {
    albedo: rgbaToDataURL(rawMaps.albedoArray, w, h),
    normal: rgbaToDataURL(rawMaps.normalArray, w, h),
    roughness: rgbaToDataURL(rawMaps.roughnessArray, w, h),
    metallic: rgbaToDataURL(rawMaps.metallicArray, w, h),
    ao: rgbaToDataURL(rawMaps.aoArray, w, h),
    displacement: rgbaToDataURL(rawMaps.displacementArray, w, h),
  };
}

/**
 * Genera un material procedimental por ID, con soporte transparente para filtros.
 */
export function generateMaterial(
  materialId: string, 
  w = 512, 
  h = 512, 
  filters?: MaterialFilters
): GeneratedMaps | null {
  if (filters && (filters.rust > 0 || filters.dirt > 0 || filters.scratches > 0)) {
    return generateMaterialWithFilters(materialId, w, h, filters);
  }
  const mat = MATERIAL_LIBRARY.find(m => m.id === materialId);
  if (!mat) return null;
  return mat.generate(w, h);
}

const COLOR_THUMB_CACHE = new Map<string, string>();
export function _colorThumb(hexColor: string, icon?: string, materialId?: string): string {
  const cacheKey = `${hexColor}_${icon || ''}_${materialId || ''}`;
  if (COLOR_THUMB_CACHE.has(cacheKey)) return COLOR_THUMB_CACHE.get(cacheKey)!;
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 1. Dark sphere background with subtle vignette
    const bgGrad = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
    bgGrad.addColorStop(0, '#1c1d28');
    bgGrad.addColorStop(1, '#090a0f');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 48, 48);

    // 2. 3D Sphere base with realistic PBR lighting
    ctx.save();
    ctx.beginPath();
    ctx.arc(24, 24, 20, 0, Math.PI * 2);
    ctx.clip();

    // Base body gradient (specular at 16, 14, diffuse midpoint, shadow at 32, 34)
    const sphereGrad = ctx.createRadialGradient(16, 14, 1, 24, 24, 22);
    sphereGrad.addColorStop(0, '#ffffff');
    sphereGrad.addColorStop(0.25, hexColor);
    sphereGrad.addColorStop(0.75, hexColor);
    sphereGrad.addColorStop(1, '#050608');
    ctx.fillStyle = sphereGrad;
    ctx.fill();

    // 3. Specialized Procedural Overlays depending on Material ID / Category
    const mid = materialId || '';
    if (mid.includes('wave') || mid.includes('water')) {
      // Concentric cyan water ripple rings
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.2;
      for (let r = 5; r <= 17; r += 4) {
        ctx.beginPath();
        ctx.ellipse(24, 26, r, r * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (mid.includes('shield') || mid.includes('glitch')) {
      // Sci-fi holographic cyber grid & scanlines
      ctx.strokeStyle = mid.includes('glitch') ? 'rgba(52, 211, 153, 0.6)' : 'rgba(34, 211, 238, 0.6)';
      ctx.lineWidth = 1;
      for (let y = 10; y <= 38; y += 4) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(40, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillRect(18, 18, 12, 12);
    } else if (mid.includes('magma') || mid.includes('volcanic')) {
      // Magma crust with incandescent glowing red/orange veins
      ctx.strokeStyle = '#ffedd5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(14, 18);
      ctx.lineTo(24, 24);
      ctx.lineTo(34, 19);
      ctx.moveTo(24, 24);
      ctx.lineTo(26, 36);
      ctx.stroke();
    } else if (mid.includes('crystal') || mid.includes('prism')) {
      // Prismatic crystal facets & rainbow caustics
      const prismGrad = ctx.createLinearGradient(10, 10, 38, 38);
      prismGrad.addColorStop(0, 'rgba(255, 0, 128, 0.4)');
      prismGrad.addColorStop(0.33, 'rgba(0, 200, 255, 0.4)');
      prismGrad.addColorStop(0.66, 'rgba(0, 255, 128, 0.4)');
      prismGrad.addColorStop(1, 'rgba(255, 200, 0, 0.4)');
      ctx.fillStyle = prismGrad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(24, 8);
      ctx.lineTo(38, 24);
      ctx.lineTo(24, 40);
      ctx.lineTo(10, 24);
      ctx.closePath();
      ctx.stroke();
    } else if (mid.includes('flesh') || mid.includes('bio')) {
      // Organic muscle striations
      ctx.strokeStyle = 'rgba(255, 180, 180, 0.35)';
      ctx.lineWidth = 1;
      for (let x = 10; x <= 38; x += 5) {
        ctx.beginPath();
        ctx.moveTo(x, 10);
        ctx.bezierCurveTo(x + 4, 20, x - 4, 30, x, 38);
        ctx.stroke();
      }
    } else if (mid.includes('comic')) {
      // Halftone dot pattern
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      for (let gx = 10; gx <= 36; gx += 5) {
        for (let gy = 10; gy <= 36; gy += 5) {
          ctx.beginPath();
          ctx.arc(gx, gy, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (mid.includes('frosted')) {
      // Frosted acid glass noise speckles
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      for (let i = 0; i < 20; i++) {
        const sx = 12 + ((i * 17) % 24);
        const sy = 12 + ((i * 23) % 24);
        ctx.fillRect(sx, sy, 2, 2);
      }
    } else if (mid.includes('emerald') || mid.includes('ruby')) {
      // Rich jewel caustics
      const jewelGrad = ctx.createRadialGradient(24, 28, 2, 24, 28, 14);
      jewelGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      jewelGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = jewelGrad;
      ctx.beginPath();
      ctx.arc(24, 28, 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (mid.includes('soap_bubble') || mid.includes('bubble') || mid.includes('jabon')) {
      // Iridescent thin-film rainbow bubble interference overlay
      const bubbleGrad = ctx.createLinearGradient(8, 8, 40, 40);
      bubbleGrad.addColorStop(0, 'rgba(255, 99, 132, 0.55)');
      bubbleGrad.addColorStop(0.25, 'rgba(255, 205, 86, 0.55)');
      bubbleGrad.addColorStop(0.5, 'rgba(75, 192, 192, 0.55)');
      bubbleGrad.addColorStop(0.75, 'rgba(54, 162, 235, 0.55)');
      bubbleGrad.addColorStop(1, 'rgba(153, 102, 255, 0.55)');
      ctx.fillStyle = bubbleGrad;
      ctx.beginPath();
      ctx.arc(24, 24, 19, 0, Math.PI * 2);
      ctx.fill();

      const innerGrad = ctx.createRadialGradient(20, 18, 2, 24, 24, 18);
      innerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
      innerGrad.addColorStop(0.5, 'rgba(200, 240, 255, 0.15)');
      innerGrad.addColorStop(1, 'rgba(255, 180, 240, 0.35)');
      ctx.fillStyle = innerGrad;
      ctx.beginPath();
      ctx.arc(24, 24, 19, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(20, 18, 6, -0.5, Math.PI * 0.8);
      ctx.stroke();
    }

    // 4. Secondary specular highlight & bounce light
    const specGrad = ctx.createRadialGradient(16, 14, 0, 16, 14, 6);
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    specGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = specGrad;
    ctx.fillRect(10, 8, 12, 12);

    ctx.restore();

    // 5. Crisp glass / Fresnel rim stroke
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(24, 24, 20, 0, Math.PI * 2);
    ctx.stroke();
  }
  const url = canvas.toDataURL('image/webp', 0.85);
  COLOR_THUMB_CACHE.set(cacheKey, url);
  return url;
}

/** Default thumbnail: 48x48 albedo preview (ultra-fast 48x48) */
function _thumb(mat:{generate(w:number,h:number):GeneratedMaps}):string{
  return mat.generate(48,48).albedo;
}

// ─────────────────────────────────────────────────────────────────────────────
// WOOD — Organic continuous grain (no planks)
// Strategy: distorted annual rings + longitudinal fibre noise + micro pores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core wood grain value [0..1] at pixel (px,py).
 * Returns: { ring, fibre, pore, height }
 *   ring  – annual ring band (light/dark alternation)
 *   fibre – longitudinal streak along grain direction
 *   pore  – open-pore dip (for roughness/height)
 *   height – heightfield for normal/displacement
 */
function woodGrain(
  px:number, py:number, w:number, h:number,
  // Grain direction: 0=vertical, Math.PI/2=horizontal
  angle = 0.0,
  // How many ring cycles across the tile
  ringFreq = 6,
  // How much the rings waver (distortion amount)
  warp = 0.5,
  seed = 0
): {ring:number;fibre:number;pore:number;height:number} {
  // Normalise to [0..1]
  const nx = px/w, ny = py/h;
  // Rotate coordinates to align grain
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rx = nx*cos - ny*sin;
  const ry = nx*sin + ny*cos;

  // Multi-octave warp so rings bend organically
  const warpScale = 4;
  const warpX = fbm(rx*warpScale,       ry*warpScale,       5, seed)      - 0.5;
  const warpY = fbm(rx*warpScale+3.7,   ry*warpScale+1.3,   5, seed+111)  - 0.5;

  // Annual rings — sine along the axis perpendicular to grain
  const ringPos = ry * ringFreq + warpX * warp * ringFreq + warpY * warp * ringFreq * 0.4;
  const ring = Math.sin(ringPos * Math.PI * 2) * 0.5 + 0.5;

  // Fibre — fine long streaks parallel to grain direction
  const fibreFreq = 80;
  const fibre = vNoise(rx*fibreFreq + warpX*8, ry*fibreFreq*0.08 + warpY*2, seed+7);

  // Micro-pores (open grain vessels) — small circular dips
  const poreScale = 28;
  const { d1 } = voronoi(rx + warpX*.05, ry + warpY*.05, poreScale, seed+999);
  const pore = clamp(1 - d1 * 3.5); // 1 = inside pore, 0 = surface

  // Combined height (pore dips, fibre medium, ring high)
  const height = clamp(ring * 0.55 + fibre * 0.28 + (1-pore) * 0.17);

  return { ring, fibre, pore, height };
}

/** Build heightfield for a full wood tile */
function woodField(w:number, h:number, angle:number, ringFreq:number, warp:number, seed:number): Float32Array {
  const f = new Float32Array(w*h);
  for(let py=0;py<h;py++) for(let px=0;px<w;px++)
    f[py*w+px] = woodGrain(px,py,w,h,angle,ringFreq,warp,seed).height;
  return f;
}

/** Build RGBA albedo for any wood species given colour palette */
function woodAlbedo(
  w:number, h:number,
  angle:number, ringFreq:number, warp:number, seed:number,
  // Light ring colour
  lightR:number, lightG:number, lightB:number,
  // Dark ring colour
  darkR:number,  darkG:number,  darkB:number,
  // Pore colour (usually very dark)
  poreR:number,  poreG:number,  poreB:number
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w*h*4);
  for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
    const { ring, fibre, pore } = woodGrain(px,py,w,h,angle,ringFreq,warp,seed);
    // Blend light/dark ring colours
    const t = ring;
    let r = lerp(darkR, lightR, t);
    let g = lerp(darkG, lightG, t);
    let b = lerp(darkB, lightB, t);
    // Fibre adds subtle streaking variation
    const fv = (fibre - 0.5) * 18;
    r += fv; g += fv * 0.8; b += fv * 0.5;
    // Pores darken
    const pd = pore * 40;
    r -= pd; g -= pd * 0.9; b -= pd * 0.7;
    const i = (py*w+px)*4;
    rgba[i]=clamp(r,0,255)|0; rgba[i+1]=clamp(g,0,255)|0;
    rgba[i+2]=clamp(b,0,255)|0; rgba[i+3]=255;
  }
  return rgba;
}

const oakPlanks:ProceduralMaterial={
  id:'oak_planks',name:'Roble',category:'wood',icon:'🪵',
  defaults:{roughness:.68,metalness:0,normalScale:2.5,displacementScale:.04,displacementBias:-.02,
    tiling:[2,2]},
  generate(w,h){
    const angle=0.05, rf=5, warp=0.55, seed=42;
    const f=woodField(w,h,angle,rf,warp,seed);
    return{
      albedo:rgbaToDataURL(woodAlbedo(w,h,angle,rf,warp,seed, 190,148,90, 120,75,30, 45,22,8),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,7),w,h),
      roughness:grayField(mapField(f,v=>clamp(.55+(1-v)*.35)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.25+v*.75)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const walnut:ProceduralMaterial={
  id:'walnut',name:'Nogal',category:'wood',icon:'🪵',
  defaults:{roughness:.62,metalness:0,normalScale:2,displacementScale:.03,displacementBias:-.015,
    tiling:[2,2]},
  generate(w,h){
    // Walnut: tight wavy grain, dark tones
    const angle=0.03, rf=7, warp=0.8, seed=77;
    const f=woodField(w,h,angle,rf,warp,seed);
    return{
      albedo:rgbaToDataURL(woodAlbedo(w,h,angle,rf,warp,seed, 90,55,28, 45,22,8, 18,8,2),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,6),w,h),
      roughness:grayField(mapField(f,v=>clamp(.52+(1-v)*.3)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.2+v*.8)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const pine:ProceduralMaterial={
  id:'pine',name:'Pino',category:'wood',icon:'🪵',
  defaults:{roughness:.74,metalness:0,normalScale:1.8,displacementScale:.035,displacementBias:-.017,
    tiling:[2,2]},
  generate(w,h){
    // Pine: wide rings, light tones, strong contrast between early/late wood
    const angle=0.0, rf=4, warp=0.3, seed=13;
    const f=woodField(w,h,angle,rf,warp,seed);
    return{
      albedo:rgbaToDataURL(woodAlbedo(w,h,angle,rf,warp,seed, 235,205,150, 170,120,55, 80,45,15),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.60+(1-v)*.28)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.3+v*.7)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const mahogany:ProceduralMaterial={
  id:'mahogany',name:'Caoba',category:'wood',icon:'🪵',
  defaults:{roughness:.58,metalness:0,normalScale:2.2,displacementScale:.03,displacementBias:-.015,
    tiling:[2,2]},
  generate(w,h){
    // Mahogany: interlocked grain at slight angle, deep red-brown
    const angle=0.12, rf=6, warp=0.65, seed=99;
    const f=woodField(w,h,angle,rf,warp,seed);
    return{
      albedo:rgbaToDataURL(woodAlbedo(w,h,angle,rf,warp,seed, 155,58,30, 90,28,12, 35,10,4),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,6),w,h),
      roughness:grayField(mapField(f,v=>clamp(.50+(1-v)*.3)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.2+v*.8)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

// ─────────────────────────────────────────────────────────────────────────────
// STONE
// ─────────────────────────────────────────────────────────────────────────────

function marbleField(w: number, h: number): Float32Array {
  const f = new Float32Array(w * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const u = px / w;
      const v = py / h;
      const t1 = getSeamlessFBM4D(px, py, w, h, 1.5, 5);
      const t2 = getSeamlessFBM4D(px, py, w, h, 3.2, 4);
      const vein = Math.sin((u * 2.0 + v * 2.5 + t1 * 3.5 + t2 * 1.2) * Math.PI * 2.0) * 0.5 + 0.5;
      f[py * w + px] = clamp(vein);
    }
  }
  return f;
}

function marbleAlbedo(w: number, h: number, cr = 245, cg = 240, cb = 238, vr = 100, vg = 95, vb = 90): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const u = px / w;
      const v = py / h;
      const t1 = getSeamlessFBM4D(px, py, w, h, 1.5, 5);
      const t2 = getSeamlessFBM4D(px, py, w, h, 3.2, 4);
      const v1 = Math.sin((u * 2.0 + v * 2.5 + t1 * 3.5 + t2 * 1.2) * Math.PI * 2.0) * 0.5 + 0.5;
      const v2 = Math.sin((u * 4.0 - v * 3.0 + t1 * 2.5) * Math.PI * 2.0) * 0.5 + 0.5;
      const vein = clamp(v1 * 0.75 + v2 * 0.25);
      const i = (py * w + px) * 4;
      rgba[i] = lerp(cr, vr, vein) | 0;
      rgba[i + 1] = lerp(cg, vg, vein) | 0;
      rgba[i + 2] = lerp(cb, vb, vein) | 0;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const marble:ProceduralMaterial={
  id:'marble',name:'Mármol Blanco',category:'stone',icon:'⬜',
  defaults:{roughness:.25,metalness:0,normalScale:.8,displacementScale:.01,displacementBias:-.005,
    tiling:[1.5,1.5]},
  generate(w,h){const f=marbleField(w,h);return{
    albedo:rgbaToDataURL(marbleAlbedo(w,h),w,h),
    normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
    roughness:grayField(mapField(f,v=>clamp(.15+v*.25)),w,h),
    metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.7+v*.3)),w,h),
    displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const marbleBlack:ProceduralMaterial={
  id:'marble_black',name:'Mármol Negro',category:'stone',icon:'⬛',
  defaults:{roughness:.2,metalness:0,normalScale:.8,displacementScale:.01,displacementBias:-.005,
    tiling:[1.5,1.5]},
  generate(w,h){const f=marbleField(w,h);return{
    albedo:rgbaToDataURL(marbleAlbedo(w,h,18,18,20,180,175,170),w,h),
    normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
    roughness:grayField(mapField(f,v=>clamp(.12+v*.2)),w,h),
    metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
    displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function graniteField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w*12,y=py/h*12;
    f[py*w+px]=clamp(fbm(x,y,5,7)*.5+vNoise(x*3,y*3,55)*.3+.2);
  }
  return f;
}

function graniteAlbedo(w:number,h:number):Uint8ClampedArray{
  const rgba=new Uint8ClampedArray(w*h*4);
  const minerals=[[180,170,165],[210,205,200],[60,60,65],[140,120,110],[195,190,185]] as [number,number,number][];
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w,y=py/h;
    const{d1,id}=voronoi(x,y,18,5);
    const[mr,mg,mb]=minerals[id%minerals.length];
    const n=(vNoise(x*18*.5,y*18*.5,99)-.5)*25;
    const edge=clamp(1-d1*2)*20;
    const i=(py*w+px)*4;
    rgba[i]=clamp(mr+n-edge,0,255)|0;rgba[i+1]=clamp(mg+n-edge,0,255)|0;
    rgba[i+2]=clamp(mb+n-edge,0,255)|0;rgba[i+3]=255;
  }
  return rgba;
}

const granite:ProceduralMaterial={
  id:'granite',name:'Granito',category:'stone',icon:'🪨',
  defaults:{roughness:.7,metalness:0,normalScale:1.5,displacementScale:.015,displacementBias:-.007,
    tiling:[2,2]},
  generate(w,h){const f=graniteField(w,h);return{
    albedo:rgbaToDataURL(graniteAlbedo(w,h),w,h),
    normal:rgbaToDataURL(heightToNormal(f,w,h,5),w,h),
    roughness:grayField(mapField(f,v=>clamp(.6+(1-v)*.35)),w,h),
    metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.4+v*.6)),w,h),
    displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function slateField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w*6,y=py/h*6;
    const layer=Math.sin(y*8+vNoise(x*2,y*2,3)*2)*.5+.5;
    const frac=vNoise(x*4,y*.3,77)>.8?.15:0;
    f[py*w+px]=clamp(layer*.7+fbm(x,y,4,22)*.3-frac);
  }
  return f;
}

const slate:ProceduralMaterial={
  id:'slate',name:'Pizarra',category:'stone',icon:'◼',
  defaults:{roughness:.85,metalness:0,normalScale:2.5,displacementScale:.025,displacementBias:-.012,
    tiling:[2,2]},
  generate(w,h){
    const f=slateField(w,h);
    const albedoRgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*6,y=py/h*6;
      const layer=Math.sin(y*8+vNoise(x*2,y*2,3)*2)*.5+.5;
      const v=55+layer*35+(vNoise(x*8,y*8,11)-.5)*20;
      const i=(py*w+px)*4;
      albedoRgba[i]=clamp(v,0,255)|0;albedoRgba[i+1]=clamp(v+2,0,255)|0;
      albedoRgba[i+2]=clamp(v+5,0,255)|0;albedoRgba[i+3]=255;
    }
    return{albedo:rgbaToDataURL(albedoRgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,8),w,h),
      roughness:grayField(mapField(f,v=>clamp(.75+(1-v)*.2)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.3+v*.7)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function concreteField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const x=(i%w)/w*10,y=Math.floor(i/w)/h*10;
    const pore=vNoise(x*3,y*3,66)>.85?-.15:0;
    f[i]=clamp(.4+fbm(x*.4,y*.4,4,8)*.5+pore);
  }
  return f;
}

const concrete:ProceduralMaterial={
  id:'concrete',name:'Hormigón',category:'stone',icon:'🏗️',
  defaults:{roughness:.9,metalness:0,normalScale:1.2,displacementScale:.02,displacementBias:-.01,
    tiling:[1.5,1.5]},
  generate(w,h){
    const f=concreteField(w,h);
    const albedoRgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){
      const x=(i%w)/w*20,y=Math.floor(i/w)/h*20;
      const v=110+f[i]*40+(vNoise(x,y,99)-.5)*15;
      albedoRgba[i*4]=clamp(v,0,255)|0;albedoRgba[i*4+1]=clamp(v-2,0,255)|0;
      albedoRgba[i*4+2]=clamp(v-5,0,255)|0;albedoRgba[i*4+3]=255;
    }
    return{albedo:rgbaToDataURL(albedoRgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,4),w,h),
      roughness:grayField(mapField(f,v=>clamp(.82+(1-v)*.15)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function cobblestoneField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w,y=py/h;
    const{d1}=voronoi(x,y,7,3);
    const stone=clamp(1-d1*1.8);
    f[py*w+px]=clamp(Math.sin(stone*Math.PI*.5)*.8+fbm(x*8,y*8,3,33)*.1+.05);
  }
  return f;
}

const cobblestone:ProceduralMaterial={
  id:'cobblestone',name:'Adoquines',category:'stone',icon:'🔲',
  defaults:{roughness:.9,metalness:0,normalScale:3.5,displacementScale:.06,displacementBias:-.03,
    tiling:[1.5,1.5]},
  generate(w,h){
    const f=cobblestoneField(w,h);
    const albedoRgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w,y=py/h;
      const{d1,id}=voronoi(x,y,7,3);
      const sc=90+(id%7)*10,edge=clamp(d1*3)*40;
      const v=sc-edge+(fbm(x*15,y*15,3,id%100)-.5)*20;
      const i=(py*w+px)*4;
      albedoRgba[i]=clamp(v+10,0,255)|0;albedoRgba[i+1]=clamp(v+5,0,255)|0;
      albedoRgba[i+2]=clamp(v,0,255)|0;albedoRgba[i+3]=255;
    }
    return{albedo:rgbaToDataURL(albedoRgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,10),w,h),
      roughness:grayField(mapField(f,v=>clamp(.75+(1-v)*.2)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(v*.9)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const sandstone:ProceduralMaterial={
  id:'sandstone',name:'Arenisca',category:'stone',icon:'🟫',
  defaults:{roughness:.8,metalness:0,normalScale:2,displacementScale:.03,displacementBias:-.015,
    tiling:[2,2]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){
      const x=(i%w)/w*8,y=Math.floor(i/w)/h*8;
      const layer=Math.sin(y*6+fbm(x,y,4,7)*.8)*.5+.5;
      f[i]=clamp(layer*.65+fbm(x*3,y*3,4,33)*.3+.05);
    }
    const albedoRgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){
      const v=f[i];
      albedoRgba[i*4]=clamp(195+v*30,0,255)|0;
      albedoRgba[i*4+1]=clamp(160+v*25,0,255)|0;
      albedoRgba[i*4+2]=clamp(100+v*20,0,255)|0;albedoRgba[i*4+3]=255;
    }
    return{albedo:rgbaToDataURL(albedoRgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,6),w,h),
      roughness:grayField(mapField(f,v=>clamp(.72+(1-v)*.22)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.35+v*.65)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

// ─────────────────────────────────────────────────────────────────────────────
// METAL
// ─────────────────────────────────────────────────────────────────────────────

function brushedMetalField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const x=(i%w)/w*60,y=Math.floor(i/w)/h*2;
    f[i]=clamp(.4+vNoise(x,y,17)*.4+vNoise(x*4,y,55)*.2);
  }
  return f;
}

const brushedSteel:ProceduralMaterial={
  id:'brushed_steel',name:'Acero Cepillado',category:'metal',icon:'🔩',
  defaults:{roughness:.3,metalness:1,normalScale:.8,displacementScale:.005,displacementBias:-.002,
    tiling:[2,2]},
  generate(w,h){
    const f=brushedMetalField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=160+f[i]*30|0;rgba[i*4]=v;rgba[i*4+1]=v;rgba[i*4+2]=v+5;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,2),w,h),
      roughness:grayField(mapField(f,v=>clamp(.2+v*.25)),w,h),
      metallic:uniformMap(w,h,1),ao:grayField(mapField(f,v=>clamp(.8+v*.2)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const brushedAluminum:ProceduralMaterial={
  id:'brushed_aluminum',name:'Aluminio Anodizado',category:'metal',icon:'⬜',
  defaults:{roughness:.22,metalness:1,normalScale:.6,displacementScale:.003,displacementBias:-.001,
    tiling:[2,2]},
  generate(w,h){
    const f=brushedMetalField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=190+f[i]*30|0;rgba[i*4]=v;rgba[i*4+1]=v+2;rgba[i*4+2]=v+5;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,1.5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.15+v*.2)),w,h),
      metallic:uniformMap(w,h,1),ao:uniformMap(w,h,1),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};


const rustedIron:ProceduralMaterial={
  id:'rusted_iron',name:'Hierro Oxidado',category:'metal',icon:'🔧',
  defaults:{roughness:.82,metalness:.15,normalScale:4.0,displacementScale:.05,displacementBias:-.025,
    tiling:[1.5,1.5]},
  generate(w,h){
    // ── Rust layer masks ──────────────────────────────────────────────────
    // Layer 0: bare/grey metal (metallic=1, smooth, light grey)
    // Layer 1: light rust — thin surface oxidation (orange-tan)
    // Layer 2: heavy rust — thick flaky crust (deep red-brown)
    // Layer 3: dark pits — deep corrosion holes (near-black)
    // The masks are driven by correlated fbm so they nest naturally.

    const albedoRgba   = new Uint8ClampedArray(w*h*4);
    const metallicRgba = new Uint8ClampedArray(w*h*4);
    const field        = new Float32Array(w*h);      // heightfield for normals

    for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
      const sx = px/w * 5, sy = py/h * 5;           // tile scale

      // Large-scale rust distribution (where patches form)
      const macro  = fbm(sx,       sy,       6,  7);   // 0..1  slow variation
      const micro  = fbm(sx*4,     sy*4,     5, 33);   // fine grain
      const detail = fbm(sx*12,    sy*12,    4, 55);   // surface micro-detail
      const pits   = fbm(sx*20,    sy*20,    3, 99);   // tiny pit noise

      // ── Layer classification ──────────────────────────────────────────
      // Voronoi islands so rust has natural "island" shapes
      const { d1: vd1 } = voronoi(px/w, py/h, 8, 3);
      const islandMask = clamp(1 - vd1 * 1.8);        // 1=island centre, 0=edge

      // Heavy rust where macro fbm is high AND near island centres
      const heavyRust  = clamp((macro - 0.38) * 2.5 + islandMask * 0.3 + micro * 0.2);
      // Light rust fills surrounding areas
      const lightRust  = clamp((macro - 0.18) * 1.8 + micro * 0.3 - heavyRust * 0.5);
      // Pits: tiny craters in heavily corroded zones
      const pitMask    = heavyRust * clamp((pits - 0.55) * 4);
      // Bare metal: what's left
      const bareMetal  = clamp(1 - lightRust - heavyRust);

      // ── Heightfield ───────────────────────────────────────────────────
      // Bare metal = flat-ish (0.7), light rust = slightly raised (0.55),
      // heavy rust = rough mounds (0.4-0.8), pits = deep holes (0)
      let h_val = lerp(0.70, 0.55, lightRust);
      h_val     = lerp(h_val, 0.45 + micro * 0.35 + detail * 0.15, heavyRust);
      h_val     = lerp(h_val, 0.0, pitMask);
      // Fine surface roughness everywhere
      h_val    += detail * 0.04 - 0.02;
      field[py*w+px] = clamp(h_val);

      // ── Albedo ────────────────────────────────────────────────────────
      // Bare: cold steel grey with slight blue tint
      const bR=lerp(145,175,micro), bG=lerp(148,178,micro), bB=lerp(152,182,micro);
      // Light rust: warm tan/orange
      const lR=lerp(175,205,detail), lG=lerp(120,148,detail), lB=lerp(60,80,detail);
      // Heavy rust: deep red-brown with yellow-ochre variation
      const hR=lerp(lerp(110,155,micro),lerp(170,190,detail),.4+detail*.3);
      const hG=lerp(lerp(48,75,micro), lerp(100,115,detail),.3+detail*.2);
      const hB=lerp(lerp(18,32,micro), lerp(40,55,detail), .2);
      // Pit: near black
      const pR=20+detail*15, pG=12+detail*10, pB=8+detail*8;

      // Blend layers
      let r=bR, g=bG, b=bB;
      r=lerp(r,lR,lightRust); g=lerp(g,lG,lightRust); b=lerp(b,lB,lightRust);
      r=lerp(r,hR,heavyRust); g=lerp(g,hG,heavyRust); b=lerp(b,hB,heavyRust);
      r=lerp(r,pR,pitMask);   g=lerp(g,pG,pitMask);   b=lerp(b,pB,pitMask);

      // Subtle green-grey tint in transition zones (iron oxide variety)
      const greenTint = clamp((lightRust - 0.3) * 0.5) * clamp(1 - heavyRust);
      g += greenTint * 18;

      const i=(py*w+px)*4;
      albedoRgba[i]=clamp(r,0,255)|0; albedoRgba[i+1]=clamp(g,0,255)|0;
      albedoRgba[i+2]=clamp(b,0,255)|0; albedoRgba[i+3]=255;

      // ── Metallic ─────────────────────────────────────────────────────
      // Only bare metal zones keep metallic=1; rust is fully dielectric
      const mv = clamp(bareMetal * 0.9 - pitMask) * 255 | 0;
      metallicRgba[i]=metallicRgba[i+1]=metallicRgba[i+2]=mv; metallicRgba[i+3]=255;
    }

    // ── Roughness from height ─────────────────────────────────────────
    // Low zones (pits) are roughest; bare metal is smoothest
    const roughness = grayField(mapField(field, v => clamp(0.62 + (1-v)*0.35)), w, h);

    // ── AO: pits and crevices get strong occlusion ─────────────────────
    const ao = grayField(mapField(field, v => clamp(0.15 + v*0.85)), w, h);

    return {
      albedo:      rgbaToDataURL(albedoRgba, w, h),
      normal:      rgbaToDataURL(heightToNormal(field, w, h, 12), w, h),
      roughness,
      metallic:    rgbaToDataURL(metallicRgba, w, h),
      ao,
      displacement: grayField(field, w, h),
    };
  },
  thumbnail(){return _thumb(this);}
};

const chrome:ProceduralMaterial={
  id:'chrome',name:'Cromo / Espejo',category:'metal',icon:'🪞',
  defaults:{roughness:.05,metalness:1,normalScale:.3,displacementScale:.002,displacementBias:-.001,
    tiling:[1,1]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*30,y=Math.floor(i/w)/h*30;f[i]=clamp(.45+vNoise(x,y,7)*.1);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=30+f[i]*20|0;rgba[i*4]=v;rgba[i*4+1]=v;rgba[i*4+2]=v+3;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,1),w,h),
      roughness:grayField(mapField(f,v=>clamp(.02+v*.06)),w,h),
      metallic:uniformMap(w,h,1),ao:uniformMap(w,h,1),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function copperField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){const x=(i%w)/w*20,y=Math.floor(i/w)/h*20;f[i]=clamp(.35+fbm(x,y,4,3)*.5+vNoise(x*5,y*5,88)*.15);}
  return f;
}

const copper:ProceduralMaterial={
  id:'copper',name:'Cobre con Pátina',category:'metal',icon:'🔶',
  defaults:{roughness:.25,metalness:1,normalScale:1,displacementScale:.008,displacementBias:-.004,
    tiling:[1.5,1.5]},
  generate(w,h){
    const f=copperField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*20,y=py/h*20;
      const pa=fbm(x,y,4,44)>.62?(fbm(x,y,4,44)-.62)*3:0;
      const n=(vNoise(x*3,y*3,55)-.5)*20;
      const i=(py*w+px)*4;
      rgba[i]=clamp(lerp(184,70,pa)+n,0,255)|0;
      rgba[i+1]=clamp(lerp(115,160,pa)+n*.7,0,255)|0;
      rgba[i+2]=clamp(lerp(51,120,pa)+n*.3,0,255)|0;rgba[i+3]=255;
    }
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
      roughness:grayField(mapField(f,v=>clamp(.15+v*.3)),w,h),
      metallic:uniformMap(w,h,1),ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const gold:ProceduralMaterial={
  id:'gold',name:'Oro',category:'metal',icon:'⭐',
  defaults:{roughness:.15,metalness:1,normalScale:.6,displacementScale:.004,displacementBias:-.002,
    tiling:[1.5,1.5]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*25,y=Math.floor(i/w)/h*25;f[i]=clamp(.4+vNoise(x,y,22)*.3+vNoise(x*6,y*6,88)*.15);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){
      const v=f[i],n=(Math.random()-.5)*8;
      rgba[i*4]=clamp(230*v*.9+n,180,255)|0;
      rgba[i*4+1]=clamp(190*v*.85+n,140,210)|0;
      rgba[i*4+2]=clamp(30+n,0,80)|0;rgba[i*4+3]=255;
    }
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,1.5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.08+v*.15)),w,h),
      metallic:uniformMap(w,h,1),ao:uniformMap(w,h,1),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const galvanizedMetal:ProceduralMaterial={
  id:'galvanized',name:'Metal Galvanizado',category:'metal',icon:'🔘',
  defaults:{roughness:.45,metalness:1,normalScale:1.5,displacementScale:.008,displacementBias:-.004,
    tiling:[2,2]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w,y=py/h;
      const{d1,d2}=voronoi(x,y,18,41);
      const ridge=clamp((d2-d1)*3)*.6;
      f[py*w+px]=clamp(.3+ridge+fbm(x*18,y*18,3,55)*.15);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const{d1,id}=voronoi(px/w,py/h,18,41);
      const base=155+(id%5)*8,ridge=clamp((1-d1*4))*25;
      const v=base+ridge;
      const i=(py*w+px)*4;
      rgba[i]=v|0;rgba[i+1]=(v+2)|0;rgba[i+2]=(v+5)|0;rgba[i+3]=255;
    }
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,4),w,h),
      roughness:grayField(mapField(f,v=>clamp(.38+(1-v)*.2)),w,h),
      metallic:uniformMap(w,h,1),ao:grayField(mapField(f,v=>clamp(.4+v*.6)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

// ─────────────────────────────────────────────────────────────────────────────
// PAINT
// ─────────────────────────────────────────────────────────────────────────────

function carPaintField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const x=(i%w)/w,y=Math.floor(i/w)/h;
    const{d1}=voronoi(x,y,40,12);
    f[i]=clamp(.45+(1-d1*2)*.4+vNoise(x*40*2,y*40*2,33)*.1);
  }
  return f;
}

export function createCarPaintMaps(w:number,h:number,baseR=180,baseG=20,baseB=20):GeneratedMaps{
  const f=carPaintField(w,h);
  const albedoRgba=new Uint8ClampedArray(w*h*4);
  const metallicRgba=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){
    const shift=(f[i]-.45)*60;
    albedoRgba[i*4]=clamp(baseR+shift*.4,0,255)|0;
    albedoRgba[i*4+1]=clamp(baseG+shift*.3,0,255)|0;
    albedoRgba[i*4+2]=clamp(baseB+shift*.2,0,255)|0;albedoRgba[i*4+3]=255;
    const mv=clamp((f[i]-.45)*3)*200|0;
    metallicRgba[i*4]=metallicRgba[i*4+1]=metallicRgba[i*4+2]=mv;metallicRgba[i*4+3]=255;
  }
  return{albedo:rgbaToDataURL(albedoRgba,w,h),
    normal:rgbaToDataURL(heightToNormal(f,w,h,1.5),w,h),
    roughness:grayField(mapField(f,v=>clamp(.12+v*.1)),w,h),
    metallic:rgbaToDataURL(metallicRgba,w,h),ao:uniformMap(w,h,1),
    displacement:grayField(f,w,h)};
}

const carPaintRed:ProceduralMaterial={id:'car_paint_red',name:'Pintura Auto Roja',category:'paint',icon:'🚗',
  defaults:{roughness:.15,metalness:.8,normalScale:.5,displacementScale:.002,displacementBias:-.001,
    tiling:[1,1]},generate:(w,h)=>createCarPaintMaps(w,h,180,20,20)};
const carPaintBlue:ProceduralMaterial={id:'car_paint_blue',name:'Pintura Auto Azul',category:'paint',icon:'🚙',
  defaults:{roughness:.15,metalness:.8,normalScale:.5,displacementScale:.002,displacementBias:-.001,
    tiling:[1,1]},generate:(w,h)=>createCarPaintMaps(w,h,20,40,180)};
const carPaintBlack:ProceduralMaterial={id:'car_paint_black',name:'Pintura Auto Negra',category:'paint',icon:'⬛',
  defaults:{roughness:.12,metalness:.9,normalScale:.4,displacementScale:.001,displacementBias:-.0005,
    tiling:[1,1]},generate:(w,h)=>createCarPaintMaps(w,h,18,18,20)};
const carPaintGreen:ProceduralMaterial={id:'car_paint_green',name:'Pintura Auto Verde',category:'paint',icon:'🟢',
  defaults:{roughness:.15,metalness:.8,normalScale:.5,displacementScale:.002,displacementBias:-.001,
    tiling:[1,1]},generate:(w,h)=>createCarPaintMaps(w,h,20,120,30)};

export function createMattePaintMaps(w:number,h:number,r=220,g=220,b=220):GeneratedMaps{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){const x=(i%w)/w*20,y=Math.floor(i/w)/h*20;f[i]=clamp(.35+fbm(x,y,4,9)*.45+vNoise(x*8,y*8,55)*.1);}
  const rgba=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){const n=(f[i]-.5)*20;
    rgba[i*4]=clamp(r+n,0,255)|0;rgba[i*4+1]=clamp(g+n,0,255)|0;rgba[i*4+2]=clamp(b+n,0,255)|0;rgba[i*4+3]=255;}
  return{albedo:rgbaToDataURL(rgba,w,h),
    normal:rgbaToDataURL(heightToNormal(f,w,h,1.5),w,h),
    roughness:grayField(mapField(f,v=>clamp(.82+v*.15)),w,h),
    metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.6+v*.4)),w,h),
    displacement:grayField(f,w,h)};
}

const matteWhite:ProceduralMaterial={id:'matte_white',name:'Pintura Mate Blanca',category:'paint',icon:'⬜',
  defaults:{roughness:.88,metalness:0,normalScale:.6,displacementScale:.005,displacementBias:-.002,
    tiling:[1,1]},generate:(w,h)=>createMattePaintMaps(w,h,230,230,228)};
const matteGray:ProceduralMaterial={id:'matte_gray',name:'Pintura Mate Gris',category:'paint',icon:'🩶',
  defaults:{roughness:.9,metalness:0,normalScale:.6,displacementScale:.005,displacementBias:-.002,
    tiling:[1,1]},generate:(w,h)=>createMattePaintMaps(w,h,120,120,120)};

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC
// ─────────────────────────────────────────────────────────────────────────────

function carbonFiberField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  const freq=16;
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w*freq*2,y=py/h*freq*2;
    const u=Math.sin((x+y)*Math.PI)*.5+.5;
    const v2=Math.sin((x-y)*Math.PI)*.5+.5;
    const towU=Math.floor(px/w*freq)%2,towV=Math.floor(py/h*freq)%2;
    f[py*w+px]=clamp((towU===towV?u:v2)*.7+vNoise(x*3,y*3,7)*.1+.1);
  }
  return f;
}

const carbonFiber:ProceduralMaterial={
  id:'carbon_fiber',name:'Fibra de Carbono',category:'synthetic',icon:'🔲',
  defaults:{roughness:.2,metalness:0,normalScale:2,displacementScale:.008,displacementBias:-.004,
    tiling:[2,2]},
  generate(w,h){
    const f=carbonFiberField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const b=15+f[i]*35|0;rgba[i*4]=b;rgba[i*4+1]=b+2;rgba[i*4+2]=b+5;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,6),w,h),
      roughness:grayField(mapField(f,v=>clamp(.12+v*.2)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(v*.85)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const rubber:ProceduralMaterial={
  id:'rubber',name:'Goma / Caucho',category:'synthetic',icon:'⚫',
  defaults:{roughness:.95,metalness:0,normalScale:1,displacementScale:.01,displacementBias:-.005,
    tiling:[2,2]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*15,y=Math.floor(i/w)/h*15;f[i]=clamp(.3+fbm(x,y,4,7)*.5+vNoise(x*6,y*6,33)*.15);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=18+f[i]*15|0;rgba[i*4]=v;rgba[i*4+1]=v;rgba[i*4+2]=v;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
      roughness:grayField(mapField(f,v=>clamp(.9+v*.08)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.4+v*.6)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

function leatherField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const x=(i%w)/w,y=Math.floor(i/w)/h;
    const{d1,d2}=voronoi(x,y,28,9);
    f[i]=clamp(.2+clamp((d2-d1)*2)*.6+clamp(1-d1*3.5)*.1+fbm(x*10,y*10,3,88)*.1);
  }
  return f;
}

const leather:ProceduralMaterial={
  id:'leather',name:'Cuero',category:'synthetic',icon:'🟫',
  defaults:{roughness:.65,metalness:0,normalScale:2,displacementScale:.02,displacementBias:-.01,
    tiling:[2,2]},
  generate(w,h){
    const f=leatherField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=100+f[i]*40;rgba[i*4]=clamp(v,0,255)|0;rgba[i*4+1]=clamp(v*.55,0,255)|0;rgba[i*4+2]=clamp(v*.28,0,255)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.55+v*.3)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.25+v*.75)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const plasticGlossy:ProceduralMaterial={
  id:'plastic_glossy',name:'Plástico Brillante',category:'synthetic',icon:'🔵',
  defaults:{roughness:.1,metalness:0,normalScale:.3,displacementScale:.002,displacementBias:-.001,
    tiling:[1,1]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*20,y=Math.floor(i/w)/h*20;f[i]=clamp(.4+vNoise(x*2,y*2,11)*.15+fbm(x,y,3,77)*.1);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=f[i];rgba[i*4]=clamp(30+v*15,0,255)|0;rgba[i*4+1]=clamp(60+v*25,0,255)|0;rgba[i*4+2]=clamp(180+v*30,0,255)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,.8),w,h),
      roughness:grayField(mapField(f,v=>clamp(.06+v*.08)),w,h),
      metallic:uniformMap(w,h,0),ao:uniformMap(w,h,1),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const fabricCanvas:ProceduralMaterial={
  id:'fabric_canvas',name:'Tela / Canvas',category:'synthetic',icon:'🟨',
  defaults:{roughness:.88,metalness:0,normalScale:1.5,displacementScale:.012,displacementBias:-.006,
    tiling:[3,3]},
  generate(w,h){
    const f=new Float32Array(w*h);
    const freq=32;
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*freq,y=py/h*freq;
      const warpH=Math.sin(x*Math.PI+vNoise(x*.3,y*.3,5)*.6)*.5+.5;
      const warpV=Math.sin(y*Math.PI+vNoise(x*.3,y*.3,55)*.6)*.5+.5;
      const tx=Math.floor(px/w*freq)%2,ty=Math.floor(py/h*freq)%2;
      f[py*w+px]=clamp((tx===ty?warpH:warpV)*.7+.15+vNoise(x*4,y*4,33)*.08);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=175+f[i]*45;rgba[i*4]=clamp(v,0,255)|0;rgba[i*4+1]=clamp(v-10,0,255)|0;rgba[i*4+2]=clamp(v-25,0,255)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,4),w,h),
      roughness:grayField(mapField(f,v=>clamp(.82+v*.12)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(v*.9)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

// ─────────────────────────────────────────────────────────────────────────────
// GROUND
// ─────────────────────────────────────────────────────────────────────────────

function gravelField(w:number,h:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let i=0;i<w*h;i++){
    const x=(i%w)/w,y=Math.floor(i/w)/h;
    const{d1}=voronoi(x,y,12,17);
    f[i]=clamp(Math.sin(clamp(1-d1*2)*Math.PI*.5)*.75+fbm(x*12,y*12,3,44)*.15);
  }
  return f;
}

const gravel:ProceduralMaterial={
  id:'gravel',name:'Grava',category:'ground',icon:'⚫',
  defaults:{roughness:.92,metalness:0,normalScale:4,displacementScale:.07,displacementBias:-.035,
    tiling:[2,2]},
  generate(w,h){
    const f=gravelField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const{id}=voronoi(px/w,py/h,12,17);
      const sb=80+(id%9)*12,v=sb-(1-f[py*w+px])*40;
      const i=(py*w+px)*4;
      rgba[i]=clamp(v+8,0,255)|0;rgba[i+1]=clamp(v+4,0,255)|0;rgba[i+2]=clamp(v,0,255)|0;rgba[i+3]=255;
    }
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,12),w,h),
      roughness:grayField(mapField(f,v=>clamp(.8+(1-v)*.18)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(v*.85)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const sand:ProceduralMaterial={
  id:'sand',name:'Arena',category:'ground',icon:'🏖️',
  defaults:{roughness:.9,metalness:0,normalScale:1.5,displacementScale:.03,displacementBias:-.015,
    tiling:[1.5,1.5]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*20,y=Math.floor(i/w)/h*20;f[i]=clamp(.4+fbm(x,y,5,29)*.5+vNoise(x*10,y*10,77)*.08);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=190+f[i]*30;rgba[i*4]=clamp(v,0,255)|0;rgba[i*4+1]=clamp(v-15,0,255)|0;rgba[i*4+2]=clamp(v-40,0,255)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
      roughness:grayField(mapField(f,v=>clamp(.86+v*.1)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const asphalt:ProceduralMaterial={
  id:'asphalt',name:'Asfalto',category:'ground',icon:'🛣️',
  defaults:{roughness:.95,metalness:0,normalScale:2,displacementScale:.025,displacementBias:-.012,
    tiling:[2,2]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){
      const x=(i%w)/w,y=Math.floor(i/w)/h;
      const{d1}=voronoi(x,y,25,31);
      f[i]=clamp(.2+clamp(1-d1*3)*.3+fbm(x*25,y*25,4,66)*.3);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=28+f[i]*35;rgba[i*4]=v|0;rgba[i*4+1]=v|0;rgba[i*4+2]=(v-2)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.88+v*.1)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.35+v*.65)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const dirt:ProceduralMaterial={
  id:'dirt',name:'Tierra',category:'ground',icon:'🟤',
  defaults:{roughness:.93,metalness:0,normalScale:2,displacementScale:.04,displacementBias:-.02,
    tiling:[2,2]},
  generate(w,h){
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){const x=(i%w)/w*10,y=Math.floor(i/w)/h*10;f[i]=clamp(.3+fbm(x,y,6,88)*.65);}
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const v=f[i];rgba[i*4]=clamp(100+v*40,0,255)|0;rgba[i*4+1]=clamp(70+v*25,0,255)|0;rgba[i*4+2]=clamp(35+v*15,0,255)|0;rgba[i*4+3]=255;}
    return{albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,5),w,h),
      roughness:grayField(mapField(f,v=>clamp(.88+(1-v)*.1)),w,h),
      metallic:uniformMap(w,h,0),ao:grayField(mapField(f,v=>clamp(.4+v*.6)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};


// ─────────────────────────────────────────────────────────────────────────────
// ROCK MATERIALS — multi-octave fbm + voronoi fractures
// ─────────────────────────────────────────────────────────────────────────────

/** Shared rock heightfield: fbm macro shape + voronoi micro cracks */
function rockField(w:number,h:number,macroScale:number,crackScale:number,seed:number):Float32Array{
  const f=new Float32Array(w*h);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w*macroScale, y=py/h*macroScale;
    // Large bumps
    const bump=fbm(x,y,7,seed)*.7+.15;
    // Crack network: low d1 = crack valley
    const{d1,d2}=voronoi(px/w,py/h,crackScale,seed+13);
    const crack=clamp((d2-d1)*2)*.25; // ridge between cells
    const crackDip=clamp(1-d1*4)*.18; // depression at crack centre
    f[py*w+px]=clamp(bump+crack-crackDip);
  }
  return f;
}

/** Rocky albedo with per-facet colour variation via voronoi cell id */
function rockAlbedo(
  w:number,h:number,
  macroScale:number,crackScale:number,seed:number,
  r0:number,g0:number,b0:number,  // dark tone
  r1:number,g1:number,b1:number,  // light tone
  crackDark=true
):Uint8ClampedArray{
  const rgba=new Uint8ClampedArray(w*h*4);
  for(let py=0;py<h;py++)for(let px=0;px<w;px++){
    const x=px/w*macroScale, y=py/h*macroScale;
    const{d1,id}=voronoi(px/w,py/h,crackScale,seed+13);
    const macro=fbm(x,y,6,seed);
    const cellVar=(id%11)/11;        // per-facet hue shift
    const t=macro*.6+cellVar*.3+vNoise(x*3,y*3,seed+77)*.1;
    let r=lerp(r0,r1,t)+cellVar*8;
    let g=lerp(g0,g1,t)+cellVar*5;
    let b=lerp(b0,b1,t)+cellVar*3;
    // Crack darkening
    if(crackDark){const cd=clamp(1-d1*4)*25;r-=cd;g-=cd;b-=cd;}
    const i=(py*w+px)*4;
    rgba[i]=clamp(r,0,255)|0;rgba[i+1]=clamp(g,0,255)|0;rgba[i+2]=clamp(b,0,255)|0;rgba[i+3]=255;
  }
  return rgba;
}

const largeRock:ProceduralMaterial={
  id:'large_rock',name:'Roca Grande',category:'stone',icon:'🗿',
  defaults:{roughness:.9,metalness:0,normalScale:5,displacementScale:.08,displacementBias:-.04,tiling:[1,1]},
  generate(w,h){
    const f=rockField(w,h,6,9,17);
    return{
      albedo:rgbaToDataURL(rockAlbedo(w,h,6,9,17, 70,65,60, 145,135,125),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,14),w,h),
      roughness:grayField(mapField(f,v=>clamp(.78+(1-v)*.2)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.1+v*.9)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const cliffRock:ProceduralMaterial={
  id:'cliff_rock',name:'Roca Acantilado',category:'stone',icon:'⛰️',
  defaults:{roughness:.92,metalness:0,normalScale:6,displacementScale:.1,displacementBias:-.05,tiling:[1,1]},
  generate(w,h){
    // Cliff: strong horizontal layering + vertical fractures
    const f=new Float32Array(w*h);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*8,y=py/h*8;
      const layer=Math.sin(y*5+fbm(x,y,4,7)*.8)*.5+.5;
      const{d1}=voronoi(px/w,py/h,12,31);
      const crack=clamp(1-d1*5)*.2;
      const bump=fbm(x*2,y*2,5,44)*.3;
      f[py*w+px]=clamp(layer*.5+bump+.1-crack);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*8,y=py/h*8;
      const layer=Math.sin(y*5+fbm(x,y,4,7)*.8)*.5+.5;
      const v=fbm(x*2,y*2,5,99);
      const r=clamp(105+layer*35+v*20,0,255)|0;
      const g=clamp(95+layer*30+v*18,0,255)|0;
      const b=clamp(80+layer*25+v*15,0,255)|0;
      const i=(py*w+px)*4;
      rgba[i]=r;rgba[i+1]=g;rgba[i+2]=b;rgba[i+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,16),w,h),
      roughness:grayField(mapField(f,v=>clamp(.82+(1-v)*.15)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.05+v*.95)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const mossyRock:ProceduralMaterial={
  id:'mossy_rock',name:'Roca con Musgo',category:'stone',icon:'🌿',
  defaults:{roughness:.93,metalness:0,normalScale:4,displacementScale:.06,displacementBias:-.03,tiling:[1,1]},
  generate(w,h){
    const fRock=rockField(w,h,5,8,23);
    // Moss mask: grows in concave areas (low height)
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w*5,y=py/h*5;
      const rv=fRock[py*w+px];
      const mossMask=clamp((1-rv)*1.4+fbm(x*2,y*2,4,88)*.3-.3);
      // Rock colour: warm grey-brown
      let r=lerp(90,150,rv)+fbm(x,y,3,11)*20;
      let g=lerp(80,135,rv)+fbm(x,y,3,22)*18;
      let b=lerp(65,115,rv)+fbm(x,y,3,33)*14;
      // Moss: dark olive-green
      const mr=lerp(38,65,fbm(x*4,y*4,3,55));
      const mg=lerp(55,88,fbm(x*4,y*4,3,66));
      const mb=lerp(18,32,fbm(x*4,y*4,3,77));
      r=lerp(r,mr,mossMask);g=lerp(g,mg,mossMask);b=lerp(b,mb,mossMask);
      const i=(py*w+px)*4;
      rgba[i]=clamp(r,0,255)|0;rgba[i+1]=clamp(g,0,255)|0;rgba[i+2]=clamp(b,0,255)|0;rgba[i+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(fRock,w,h,12),w,h),
      roughness:grayField(mapField(fRock,v=>clamp(.88+(1-v)*.1)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(fRock,v=>clamp(.08+v*.92)),w,h),
      displacement:grayField(fRock,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const volcanicRock:ProceduralMaterial={
  id:'volcanic_rock',name:'Roca Volcánica',category:'stone',icon:'🌋',
  defaults:{roughness:.95,metalness:0,normalScale:5,displacementScale:.09,displacementBias:-.045,tiling:[1.5,1.5]},
  generate(w,h){
    // Basalt: very rough, vesicles (gas bubbles = voronoi pits), almost black
    const f=new Float32Array(w*h);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const x=px/w,y=py/h;
      const{d1}=voronoi(x,y,20,37);
      const bubble=clamp(1-d1*4)*.5; // bubble cavity = deep pit
      const base=fbm(x*8,y*8,5,9)*.5+.25;
      f[py*w+px]=clamp(base-bubble);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const v=f[py*w+px];
      const n=fbm(px/w*12,py/h*12,4,55);
      const base=18+v*35+n*15;
      const i=(py*w+px)*4;
      rgba[i]=base|0;rgba[i+1]=(base+2)|0;rgba[i+2]=(base+3)|0;rgba[i+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,18),w,h),
      roughness:grayField(mapField(f,v=>clamp(.88+(1-v)*.1)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(v*0.95)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const desertRock:ProceduralMaterial={
  id:'desert_rock',name:'Roca Desértica',category:'stone',icon:'🏜️',
  defaults:{roughness:.88,metalness:0,normalScale:3,displacementScale:.06,displacementBias:-.03,tiling:[1,1]},
  generate(w,h){
    const f=rockField(w,h,5,7,41);
    // Warm sand/orange tones with bleaching on peaks
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const v=f[py*w+px];
      const n=fbm(px/w*8,py/h*8,4,33);
      // Deep: dark red-orange; peaks: warm cream
      const r=lerp(155,225,v)+n*18;
      const g=lerp(85,185,v)+n*14;
      const b=lerp(35,120,v)+n*10;
      const i=(py*w+px)*4;
      rgba[i]=clamp(r,0,255)|0;rgba[i+1]=clamp(g,0,255)|0;rgba[i+2]=clamp(b,0,255)|0;rgba[i+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,9),w,h),
      roughness:grayField(mapField(f,v=>clamp(.80+(1-v)*.15)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.2+v*.8)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

// ─────────────────────────────────────────────────────────────────────────────
// CLEARCOAT MATERIALS (Three.js MeshPhysicalMaterial)
// clearcoat=1 → second specular lobe on top of the base material
// ─────────────────────────────────────────────────────────────────────────────

const varnishedWood:ProceduralMaterial={
  id:'varnished_wood',name:'Madera Barnizada',category:'wood',icon:'✨',
  defaults:{roughness:.25,metalness:0,normalScale:1.5,displacementScale:.02,displacementBias:-.01,
    tiling:[2,2], clearcoat:0.9, clearcoatRoughness:0.1},
  generate(w,h){
    // Same grain as oak but smoother + clearcoat maps
    const angle=0.04,rf=5,warp=0.4,seed=7;
    const f=woodField(w,h,angle,rf,warp,seed);
    return{
      albedo:rgbaToDataURL(woodAlbedo(w,h,angle,rf,warp,seed,210,168,110,140,90,40,50,25,8),w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
      roughness:grayField(mapField(f,v=>clamp(.18+v*.18)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.3+v*.7)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const carLacquer:ProceduralMaterial={
  id:'car_lacquer',name:'Laca Auto (Clearcoat)',category:'paint',icon:'🏎️',
  defaults:{roughness:.05,metalness:0,normalScale:.2,displacementScale:.001,displacementBias:0,
    tiling:[1,1], clearcoat:1.0, clearcoatRoughness:0.05},
  generate(w,h){
    // Deep solid colour with orange-peel micro-texture
    const f=new Float32Array(w*h);
    for(let i=0;i<w*h;i++){
      const x=(i%w)/w*30,y=Math.floor(i/w)/h*30;
      // Orange peel: very fine Voronoi domes
      const{d1}=voronoi(x/30,y/30,30,5);
      f[i]=clamp(.3+clamp(1-d1*4)*.4+fbm(x,y,3,11)*.15);
    }
    const rgba=new Uint8ClampedArray(w*h*4);
    // Pearl white
    for(let i=0;i<w*h;i++){
      const v=f[i]*15;
      rgba[i*4]=clamp(238+v,0,255)|0;rgba[i*4+1]=clamp(235+v,0,255)|0;
      rgba[i*4+2]=clamp(232+v,0,255)|0;rgba[i*4+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,.8),w,h),
      roughness:grayField(mapField(f,v=>clamp(.04+v*.06)),w,h),
      metallic:uniformMap(w,h,0),
      ao:uniformMap(w,h,1),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const ceramicGlazed:ProceduralMaterial={
  id:'ceramic_glazed',name:'Cerámica Esmaltada',category:'synthetic',icon:'🏺',
  defaults:{roughness:.08,metalness:0,normalScale:.4,displacementScale:.005,displacementBias:-.002,
    tiling:[2,2], clearcoat:0.8, clearcoatRoughness:0.08},
  generate(w,h){
    // Tile grid with slight grout lines and surface micro-bumps
    const tileFreq=8;
    const f=new Float32Array(w*h);
    const rgba=new Uint8ClampedArray(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const tx=px/w*tileFreq, ty=py/h*tileFreq;
      const lx=tx%1, ly=ty%1;
      // Grout = near cell edges
      const grout=Math.min(lx,1-lx,ly,1-ly);
      const isGrout=grout<0.06;
      // Slight dome per tile
      const dome=Math.sin(lx*Math.PI)*Math.sin(ly*Math.PI);
      const micro=vNoise(tx*8,ty*8,5)*.04;
      f[py*w+px]=clamp(isGrout?.05:dome*.3+.5+micro);
      const i=(py*w+px)*4;
      if(isGrout){rgba[i]=175;rgba[i+1]=170;rgba[i+2]=168;rgba[i+3]=255;}
      else{
        // Cream/ivory glaze
        const gv=dome*12+micro*20;
        rgba[i]=clamp(240+gv,0,255)|0;rgba[i+1]=clamp(232+gv,0,255)|0;
        rgba[i+2]=clamp(220+gv,0,255)|0;rgba[i+3]=255;
      }
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,2),w,h),
      roughness:grayField(mapField(f,v=>clamp(.06+v*.08)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};

const wetConcrete:ProceduralMaterial={
  id:'wet_concrete',name:'Hormigón Mojado',category:'stone',icon:'💧',
  defaults:{roughness:.35,metalness:0,normalScale:.8,displacementScale:.015,displacementBias:-.007,
    tiling:[1.5,1.5], clearcoat:0.6, clearcoatRoughness:0.3},
  generate(w,h){
    const f=concreteField(w,h);
    const rgba=new Uint8ClampedArray(w*h*4);
    // Wet concrete is darker and more uniform
    for(let i=0;i<w*h;i++){
      const v=f[i];
      const base=70+v*35+(vNoise((i%w)/w*20,Math.floor(i/w)/h*20,99)-.5)*12;
      rgba[i*4]=base|0;rgba[i*4+1]=(base-1)|0;rgba[i*4+2]=(base-3)|0;rgba[i*4+3]=255;
    }
    return{
      albedo:rgbaToDataURL(rgba,w,h),
      normal:rgbaToDataURL(heightToNormal(f,w,h,3),w,h),
      roughness:grayField(mapField(f,v=>clamp(.28+v*.2)),w,h),
      metallic:uniformMap(w,h,0),
      ao:grayField(mapField(f,v=>clamp(.5+v*.5)),w,h),
      displacement:grayField(f,w,h)};
  },
  thumbnail(){return _thumb(this);}
};


// ─────────────────────────────────────────────────────────────────────────────
// ROCKY GROUND WITH MOSS — multi-scale scatter approach
//
// Layer stack (bottom → top):
//   L0  Dirt/soil base          — dark brown fbm
//   L1  Small gravel chips      — fine Voronoi (scale 35)
//   L2  Medium stones           — mid Voronoi  (scale 14)
//   L3  Large angular rocks     — coarse Voronoi (scale 6)
//   L4  Moss                    — grows in concave/low zones
//
// Height is the sum of all stone layers → used for normals, AO, displacement.
// Each Voronoi cell gets a random size/shape via its cell id so stones
// look irregular, not uniform.
// ─────────────────────────────────────────────────────────────────────────────

interface StoneLayer {
  h: number;      // height contribution [0..1]
  isSurface: boolean; // true = we're on top of a stone (not gap/dirt)
  cellId: number;
  stoneT: number; // how much of a stone we are (0=gap, 1=stone centre)
}

/** Single Voronoi stone layer — returns per-pixel data */
function stoneLayer(
  px: number, py: number, w: number, h: number,
  scale: number, seed: number,
  heightAmp: number,    // how tall these stones are (use 1.0 for full range)
  gapWidth: number,     // fraction of cell = gap (0.08 = narrow gap)
): StoneLayer {
  const x = px / w, y = py / h;
  const { d1, d2, id } = voronoi(x, y, scale, seed);

  // Per-cell random size + shape multiplier → irregular angular stones
  const cellHash = (id * 2654435761) & 0xffff;
  const sizeVar  = 0.55 + (cellHash & 0xff) / 255 * 0.9;    // 0.55..1.45
  const flatness = 0.3  + ((cellHash >> 8) & 0xff) / 255 * 0.6; // flat-top factor

  const gap      = d1 * sizeVar;
  const isSurface = gap > gapWidth;

  // stoneT: 0 = edge of stone, 1 = centre
  const stoneT = isSurface ? clamp((gap - gapWidth) / (1 - gapWidth)) : 0;

  // Profile: angular stones have FLAT TOPS and SHARP DROP-OFFS
  // pow(stoneT, flatness) → small flatness = very flat top (angular)
  //                         large flatness = dome (rounded)
  const profile = Math.pow(stoneT, flatness);

  // Micro roughness on stone surface
  const micro = fbm(x * scale * 4, y * scale * 4, 3, seed + 77) * 0.06;

  return {
    h: isSurface ? (profile + micro) * heightAmp : 0,
    isSurface,
    cellId: id,
    stoneT,
  };
}

/** Rocky ground heightfield — combines 3 stone scales.
 *  Output field is normalised to full [0..1] range:
 *    0   = dirt/gap between stones  (will be pushed DOWN by displacement)
 *    1   = top of large stone        (will be pushed UP)
 *  This maximises the physical displacement contrast.
 */
function rockyGroundField(w: number, h: number): {
  field: Float32Array;
  large: Float32Array; medium: Float32Array; small: Float32Array;
  gap: Float32Array;   moss: Float32Array;
} {
  const raw    = new Float32Array(w * h);  // un-normalised heights
  const large  = new Float32Array(w * h);
  const medium = new Float32Array(w * h);
  const small  = new Float32Array(w * h);
  const gap    = new Float32Array(w * h);
  const moss   = new Float32Array(w * h);

  let rawMin = Infinity, rawMax = -Infinity;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const x = px / w * 5, y = py / h * 5;

      // Three stone scales — each at full 0..1 amplitude
      const L = stoneLayer(px, py, w, h,  6,  7,  1.0, 0.08);  // large
      const M = stoneLayer(px, py, w, h, 16, 31,  1.0, 0.10);  // medium
      const S = stoneLayer(px, py, w, h, 38, 53,  1.0, 0.14);  // small chips

      let heightVal = 0;
      let lMask = 0, mMask = 0, sMask = 0, gMask = 0;

      if (L.isSurface) {
        // Large stone: full height contribution
        heightVal = L.h * 0.85 + 0.15;          // never fully 0 on a stone
        lMask = L.stoneT;
      } else if (M.isSurface) {
        // Medium stone sits lower than large
        heightVal = M.h * 0.55 + 0.05;
        mMask = M.stoneT;
      } else if (S.isSurface) {
        // Small chip: barely protrudes
        heightVal = S.h * 0.25 + 0.02;
        sMask = S.stoneT;
      } else {
        // Pure gap/dirt: truly flat/zero for maximum displacement contrast
        // tiny fbm so it's not perfectly flat but still very low
        const dirtBump = fbm(x * 8, y * 8, 3, 99) * 0.04;
        heightVal = dirtBump;
        gMask = 1;
      }

      raw[idx] = heightVal;
      if (heightVal < rawMin) rawMin = heightVal;
      if (heightVal > rawMax) rawMax = heightVal;

      large[idx]  = lMask;
      medium[idx] = mMask;
      small[idx]  = sMask;
      gap[idx]    = gMask;
    }
  }

  // ── Normalise to full [0..1] so displacement map has maximum contrast ──
  const field = new Float32Array(w * h);
  const range = rawMax - rawMin || 1;
  for (let i = 0; i < raw.length; i++) {
    field[i] = (raw[i] - rawMin) / range;
  }

  // ── Moss mask: grows where normalised height is LOW ─────────────────
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const x = px / w * 5, y = py / h * 5;
      const h_norm = field[idx];
      const mossNoise = fbm(x * 3, y * 3, 5, 211);
      const lowZone   = clamp(1 - h_norm * 2.2);
      moss[idx] = clamp(lowZone * mossNoise * 2.0 - 0.15);
    }
  }

  return { field, large, medium, small, gap, moss };
}

const rockyGroundMoss: ProceduralMaterial = {
  id: 'rocky_ground_moss',
  name: 'Terreno Rocoso con Musgo',
  category: 'ground',
  icon: '🪨',
  defaults: {
    roughness: 0.92,
    metalness: 0,
    normalScale: 8.0,
    displacementScale: 0.45,  // HIGH: stones protrude physically
    displacementBias: -0.22,  // push base down so gaps go below surface
    tiling: [1, 1],
  },
  generate(w, h) {
    const { field, large, medium, small, gap, moss } = rockyGroundField(w, h);

    // ── Albedo ────────────────────────────────────────────────────────
    const albedoRgba = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const x = px / w * 5, y = py / h * 5;

        const lM = large[idx];
        const mM = medium[idx];
        const sM = small[idx];
        const gM = gap[idx];
        const msM = moss[idx];

        // Cell-based colour variation for stones
        const { id: lId } = voronoi(px / w, py / h, 6, 7);
        const { id: mId } = voronoi(px / w, py / h, 16, 31);

        // Large stone colours — grey to warm grey, some bleached tops
        const lVar = ((lId * 1664525) & 0xff) / 255;
        const lBright = 0.55 + lVar * 0.35 + field[idx] * 0.25;
        const lR = lerp(90, 195, lBright);
        const lG = lerp(85, 185, lBright);
        const lB = lerp(78, 175, lBright);

        // Medium stones — slightly warmer / darker
        const mVar = ((mId * 22695477) & 0xff) / 255;
        const mBright = 0.40 + mVar * 0.30 + field[idx] * 0.2;
        const mR = lerp(75, 155, mBright);
        const mG = lerp(70, 148, mBright);
        const mB = lerp(60, 135, mBright);

        // Small chips — gritty, brownish-grey
        const sFbm = fbm(x * 8, y * 8, 3, 55);
        const sR = lerp(80, 140, sFbm);
        const sG = lerp(72, 130, sFbm);
        const sB = lerp(60, 115, sFbm);

        // Dirt/soil — dark brown with slight red
        const dFbm = fbm(x * 6, y * 6, 4, 88);
        const dR = lerp(42, 75, dFbm);
        const dG = lerp(32, 58, dFbm);
        const dB = lerp(18, 38, dFbm);

        // Moss — olive green, darker in shadow
        const msF = fbm(x * 4, y * 4, 4, 177);
        const msR = lerp(32, 68, msF);
        const msG = lerp(52, 95, msF);
        const msB = lerp(18, 35, msF);

        // ── Composite ────────────────────────────────────────────────
        // Base = dirt
        let r = dR, g = dG, b = dB;
        // Small chips over dirt
        r = lerp(r, sR, sM); g = lerp(g, sG, sM); b = lerp(b, sB, sM);
        // Medium stones
        r = lerp(r, mR, mM); g = lerp(g, mG, mM); b = lerp(b, mB, mM);
        // Large stones
        r = lerp(r, lR, lM); g = lerp(g, lG, lM); b = lerp(b, lB, lM);
        // Moss overlay
        r = lerp(r, msR, msM); g = lerp(g, msG, msM); b = lerp(b, msB, msM);

        const i = idx * 4;
        albedoRgba[i]   = clamp(r, 0, 255) | 0;
        albedoRgba[i+1] = clamp(g, 0, 255) | 0;
        albedoRgba[i+2] = clamp(b, 0, 255) | 0;
        albedoRgba[i+3] = 255;
      }
    }

    // ── Roughness: stones slightly smoother than dirt/moss ─────────────
    const roughnessStr = grayField(
      mapField(field, v => clamp(0.78 + (1 - v) * 0.18)),
      w, h
    );

    // ── AO: deep occlusion in gaps, light on stone peaks ───────────────
    const aoStr = grayField(
      mapField(field, v => {
        // Gaps are very dark; stone peaks are bright
        return clamp(v * 0.85 + (1 - v) * 0.05);
      }),
      w, h
    );

    return {
      albedo:       rgbaToDataURL(albedoRgba, w, h),
      normal:       rgbaToDataURL(heightToNormal(field, w, h, 18), w, h),
      roughness:    roughnessStr,
      metallic:     uniformMap(w, h, 0),
      ao:           aoStr,
      displacement: grayField(field, w, h),
    };
  },
  thumbnail() { return _thumb(this); },
};


// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD-COMPAT OAK PLANK EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

function _oakField(w:number,h:number):Float32Array{return woodField(w,h,0.05,5,0.55,42);}
export function createOakPlanksTexture(w=512,h=512):string{return rgbaToDataURL(woodAlbedo(w,h,0.05,5,0.55,42,190,148,90,120,75,30,45,22,8),w,h);}
export function createOakPlanksNormalMap(w=512,h=512,strength=7):string{return rgbaToDataURL(heightToNormal(_oakField(w,h),w,h,strength),w,h);}
export function createOakPlanksRoughnessMap(w=512,h=512):string{return grayField(mapField(_oakField(w,h),v=>clamp(.55+(1-v)*.35)),w,h);}
export function createOakPlanksAOMap(w=512,h=512):string{return grayField(mapField(_oakField(w,h),v=>clamp(.25+v*.75)),w,h);}
export function createOakPlanksDisplacementMap(w=512,h=512):string{return grayField(_oakField(w,h),w,h);}

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

// ── PRESETS DE MATERIALES DE ALTA GAMA ───────────────────────────────────────

const greenMarble: ProceduralMaterial = {
  id: 'green_marble', name: 'Mármol Verde Jade', category: 'stone', icon: '🟢',
  defaults: { roughness: 0.15, metalness: 0, normalScale: 0.6, displacementScale: 0.01, displacementBias: -0.005, tiling: [1.5, 1.5], clearcoat: 0.3, clearcoatRoughness: 0.1 },
  generate(w, h) {
    const f = marbleField(w, h);
    return {
      albedo: rgbaToDataURL(marbleAlbedo(w, h, 12, 45, 24, 8, 22, 12), w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 2), w, h),
      roughness: grayField(mapField(f, v => clamp(0.1 + v * 0.2)), w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(f, v => clamp(0.6 + v * 0.4)), w, h),
      displacement: grayField(f, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const goldCarbonFiber: ProceduralMaterial = {
  id: 'gold_carbon_fiber', name: 'Fibra de Carbono Oro', category: 'synthetic', icon: '✨',
  defaults: { roughness: 0.22, metalness: 0.85, normalScale: 2.2, displacementScale: 0.008, displacementBias: -0.004, tiling: [2, 2], clearcoat: 0.8, clearcoatRoughness: 0.05 },
  generate(w, h) {
    const f = carbonFiberField(w, h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const b = 180 + f[i] * 50 | 0;
      rgba[i * 4] = b; 
      rgba[i * 4 + 1] = clamp(b * 0.8, 0, 255) | 0; 
      rgba[i * 4 + 2] = clamp(b * 0.2, 0, 255) | 0; 
      rgba[i * 4 + 3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 6), w, h),
      roughness: grayField(mapField(f, v => clamp(0.15 + v * 0.2)), w, h),
      metallic: uniformMap(w, h, 0.85), 
      ao: grayField(mapField(f, v => clamp(v * 0.85)), w, h),
      displacement: grayField(f, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const copperVerdigris: ProceduralMaterial = {
  id: 'copper_verdigris', name: 'Cobre Envejecido Patinado', category: 'metal', icon: '🔋',
  defaults: { roughness: 0.75, metalness: 0.3, normalScale: 3.5, displacementScale: 0.04, displacementBias: -0.02, tiling: [1.5, 1.5] },
  generate(w, h) {
    const f = copperField(w, h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    const metallicRgba = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const x = px / w * 15, y = py / h * 15;
        const pa = fbm(x, y, 5, 88) > 0.45 ? (fbm(x, y, 5, 88) - 0.45) * 4 : 0;
        const i = (py * w + px) * 4;
        rgba[i] = clamp(lerp(190, 40, pa), 0, 255) | 0;
        rgba[i + 1] = clamp(lerp(100, 150, pa), 0, 255) | 0;
        rgba[i + 2] = clamp(lerp(40, 135, pa), 0, 255) | 0; 
        rgba[i + 3] = 255;
        const mv = clamp((1.0 - pa * 1.5) * 255, 0, 255) | 0;
        metallicRgba[i] = metallicRgba[i + 1] = metallicRgba[i + 2] = mv; 
        metallicRgba[i + 3] = 255;
      }
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 8), w, h),
      roughness: grayField(mapField(f, v => clamp(0.3 + v * 0.5)), w, h),
      metallic: rgbaToDataURL(metallicRgba, w, h), 
      ao: grayField(mapField(f, v => clamp(0.4 + v * 0.6)), w, h),
      displacement: grayField(f, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const velvetFabric: ProceduralMaterial = {
  id: 'velvet_red',
  name: 'Terciopelo Premium',
  category: 'textile',
  icon: '🧣',
  defaults: { 
    roughness: 0.75, 
    metalness: 0.0, 
    tiling: 3.5, 
    normalScale: 1.8,
    displacementScale: 0.015,
    displacementBias: -0.007,
    sheen: 1.0, 
    sheenRoughness: 0.4, 
    sheenColor: '#ff9999' 
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    // PASO 1: Crear el mapa "MADRE" de pliegues y arrugas textiles
    for (let i = 0; i < w * h; i++) {
      const px = i % w;
      const py = Math.floor(i / w);
      
      const deformacion = getUniversalSeamlessNoise(px, py, w, h, 1.2, fbm4D);
      const pliegues = getUniversalSeamlessNoise(px + deformacion * 3.0, py + deformacion * 3.0, w, h, 2.8, fbm4D);
      
      heightField[i] = Math.pow(pliegues, 2.0);
    }

    // PASO 2: Sincronizar todos los canales leyendo la misma matriz
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const hVal = heightField[i];

      albedo[idx]     = (45 + hVal * 130) | 0;  // R
      albedo[idx + 1] = (10 + hVal * 20) | 0;   // G
      albedo[idx + 2] = (18 + hVal * 25) | 0;   // B
      albedo[idx + 3] = 255;

      const rVal = (140 + (1.0 - hVal) * 70) | 0;
      roughness[idx] = roughness[idx + 1] = roughness[idx + 2] = rVal;

      const aoVal = (255 - (1.0 - hVal) * 85) | 0;
      ao[idx] = ao[idx + 1] = ao[idx + 2] = aoVal;
    }

    // PASO 3: Generar el Normal Map leyendo los gradientes del mapa de altura
    const normal = heightToNormalSeamless(heightField, w, h, 5.0);

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(normal, w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const woolFabric: ProceduralMaterial = {
  id: 'wool_knit', name: 'Lana Tejida Gruesa', category: 'textile', icon: '🧶',
  defaults: { 
    roughness: 0.9, metalness: 0.0, tiling: 5.0, normalScale: 2.5,
    sheen: 0.8, sheenRoughness: 0.6, sheenColor: '#e0d5c1'
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    const f = new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const waveX = Math.sin(px * 0.8) * 0.5 + 0.5;
        const waveY = Math.cos(py * 0.8) * 0.5 + 0.5;
        f[idx] = (waveX * waveY);
        
        const i = idx * 4;
        const c = clamp(190 + f[idx] * 45, 0, 255) | 0;
        rgba[i] = c; rgba[i+1] = clamp(c * 0.95, 0, 255) | 0; rgba[i+2] = clamp(c * 0.85, 0, 255) | 0; rgba[i+3] = 255;
      }
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 5), w, h),
      roughness: uniformMap(w, h, 230), metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(f, v => clamp(0.5 + v * 0.5)), w, h),
      displacement: grayField(f, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const silkFabric: ProceduralMaterial = {
  id: 'silk_smooth', name: 'Seda Satinada', category: 'textile', icon: '🎗️',
  defaults: { 
    roughness: 0.18, metalness: 0.0, tiling: 2.0, normalScale: 0.3,
    sheen: 1.0, sheenRoughness: 0.1, sheenColor: '#ffffff'
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i%w)/w*4, (i/w)/h*4, 3, 15);
      rgba[i*4] = clamp(30 + f * 40) | 0;
      rgba[i*4+1] = clamp(40 + f * 50) | 0;
      rgba[i*4+2] = clamp(120 + f * 60) | 0;
      rgba[i*4+3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h), normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 45), metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255), displacement: uniformMap(w, h, 0)
    };
  },
  thumbnail() { return _thumb(this); }
};

const naturalSponge: ProceduralMaterial = {
  id: 'sponge_natural', name: 'Esponja Porosa', category: 'synthetic', icon: '🧽',
  defaults: { roughness: 0.9, metalness: 0.0, normalScale: 3.0, displacementScale: 0.03, displacementBias: -0.015 },
  generate(w, h) {
    const f = voronoiField(w, h, 12, 5); 
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = clamp(f[i] * 2.0);
      rgba[i*4] = clamp(210 - v * 60) | 0;
      rgba[i*4+1] = clamp(170 - v * 50) | 0;
      rgba[i*4+2] = clamp(100 - v * 40) | 0;
      rgba[i*4+3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 8), w, h),
      roughness: uniformMap(w, h, 230), metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(f, v => clamp(1.0 - v * 0.7)), w, h),
      displacement: grayField(f, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const compactBone: ProceduralMaterial = {
  id: 'hueso_compacto', name: 'Tejido Óseo / Hueso', category: 'stone', icon: '🦴',
  defaults: { 
    roughness: 0.45, metalness: 0.0, normalScale: 0.5,
    transmission: 0.15, ior: 1.55, thickness: 0.5
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const n = fbm((i%w)/w*30, (Math.floor(i/w))/h*30, 3, 55) * 15;
      rgba[i*4] = clamp(235 - n) | 0;
      rgba[i*4+1] = clamp(228 - n) | 0;
      rgba[i*4+2] = clamp(210 - n * 2) | 0;
      rgba[i*4+3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h), normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 115), metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 240), displacement: uniformMap(w, h, 0)
    };
  },
  thumbnail() { return _thumb(this); }
};

const tornasolMetal: ProceduralMaterial = {
  id: 'tornasol_optico', name: 'Cristal Tornasol Iridiscente', category: 'iridescent', icon: '💿',
  defaults: { 
    roughness: 0.05, metalness: 0.1, transmission: 0.4, ior: 1.6,
    iridescence: 1.0, iridescenceIOR: 1.9, iridescenceThicknessRange: [100, 400]
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = (i % w) / w;
      rgba[i*4] = clamp(Math.sin(x * 6.28) * 127 + 128) | 0;
      rgba[i*4+1] = clamp(Math.sin(x * 6.28 + 2.0) * 127 + 128) | 0;
      rgba[i*4+2] = clamp(Math.sin(x * 6.28 + 4.0) * 127 + 128) | 0;
      rgba[i*4+3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h), normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 12), metallic: uniformMap(w, h, 25),
      ao: uniformMap(w, h, 255), displacement: uniformMap(w, h, 0)
    };
  },
  thumbnail() { return _thumb(this); }
};

const pearlIridescent: ProceduralMaterial = {
  id: 'pearl_nacre', name: 'Madreperla / Nácar', category: 'iridescent', icon: '🦪',
  defaults: { 
    roughness: 0.12, metalness: 0.0, clearcoat: 0.4, clearcoatRoughness: 0.1,
    iridescence: 0.8, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 450]
  },
  generate(w, h) {
    const f = marbleField(w, h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = f[i] * 20;
      rgba[i*4] = clamp(245 - v) | 0;
      rgba[i*4+1] = clamp(240 - v) | 0;
      rgba[i*4+2] = clamp(235 - v) | 0;
      rgba[i*4+3] = 255;
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: rgbaToDataURL(heightToNormal(f, w, h, 1), w, h),
      roughness: uniformMap(w, h, 30), metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255), displacement: uniformMap(w, h, 0)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── MATERIALES VOLUMÉTRICOS PROCEDIMENTALES (RAYMARCHING 3D PBR) ───────────────

const fireVolumetric: ProceduralMaterial = {
  id: 'fire_volumetric',
  name: 'Fuego Volumétrico 3D (WebGPU Fire)',
  category: 'gaseous',
  icon: '🔥',
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
    threshold: 0.22,
    thresholdMax: 0.70,
    absorption: 1.2,
    steps: 42,
    shadowSteps: 4,
    windSpeed: 0.35,
    windDirection: [0.0, 1.2, 0.0],
    blending: 'additive',
    turbulentFlame: true,
  },
  defaults: {
    roughness: 0.1,
    metalness: 0.0,
    color: '#ef4444',
    emissive: '#fbbf24',
    emissiveIntensity: 3.2,
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const nx = px / w, ny = py / h;
        const n = fbm(nx * 4, ny * 4, 4, 15);
        const heat = clamp((1.0 - ny) * 1.4 + (n - 0.5) * 0.8, 0, 1);
        rgba[i]     = 255;
        rgba[i + 1] = clamp(lerp(20, 240, Math.pow(heat, 1.5))) | 0;
        rgba[i + 2] = clamp(lerp(0, 80, Math.pow(heat, 3.0))) | 0;
        rgba[i + 3] = clamp(heat * 255);
      }
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 30),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const plasmaGas: ProceduralMaterial = {
  id: 'plasma_gas',
  name: 'Gas de Plasma Volumétrico 3D',
  category: 'gaseous',
  icon: '⚡',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'plasma',
    density: 2.6,
    scale: 2.0,
    lightIntensity: 2.0,
    color: '#06b6d4',
    secondaryColor: '#a855f7',
    emissiveIntensity: 2.8,
    threshold: 0.20,
    thresholdMax: 0.72,
    absorption: 1.0,
    steps: 40,
    shadowSteps: 4,
    windSpeed: 0.12,
    windDirection: [0.1, 0.05, 0.1],
    blending: 'additive',
  },
  defaults: {
    roughness: 0.1,
    metalness: 0.0,
    color: '#06b6d4',
    emissive: '#a855f7',
    emissiveIntensity: 2.8,
    transmission: 0.85,
    ior: 1.1,
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 8, Math.floor(i / w) / h * 8, 6, 12);
      const v = lerp(120, 255, f);
      rgba[i * 4]     = clamp(lerp(6, 168, f)) | 0;   // Cyan to purple R
      rgba[i * 4 + 1] = clamp(lerp(182, 85, f)) | 0;  // G
      rgba[i * 4 + 2] = clamp(lerp(212, 247, f)) | 0; // B
      rgba[i * 4 + 3] = clamp(f * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 30),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const cloudCumulus: ProceduralMaterial = {
  id: 'cloud_cumulus',
  name: 'Nube Cúmulo Volumétrica 3D',
  category: 'gaseous',
  icon: '☁️',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'cloud',
    density: 2.5,
    scale: 2.2,
    lightIntensity: 1.5,
    color: '#ffffff',
    secondaryColor: '#cbd5e1',
    emissiveIntensity: 0,
    threshold: 0.20,
    thresholdMax: 0.72,
    absorption: 1.8,
    steps: 36,
    shadowSteps: 4,
    windSpeed: 0.08,
    windDirection: [0.1, 0.05, 0.0],
    blending: 'normal',
  },
  defaults: {
    roughness: 0.95,
    metalness: 0.0,
    color: '#ffffff',
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 5, Math.floor(i / w) / h * 5, 5, 20);
      const c = clamp(lerp(220, 255, f)) | 0;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      rgba[i * 4 + 3] = clamp(smoothstep(0.3, 0.7, f) * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 240),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const smokeDense: ProceduralMaterial = {
  id: 'smoke_dense',
  name: 'Humo Volumétrico Denso 3D',
  category: 'gaseous',
  icon: '💨',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'smoke',
    density: 3.2,
    scale: 3.2,
    lightIntensity: 0.95,
    color: '#334155',
    secondaryColor: '#64748b',
    emissiveIntensity: 0,
    threshold: 0.22,
    thresholdMax: 0.75,
    absorption: 2.8,
    steps: 36,
    shadowSteps: 6,
    windSpeed: 0.22,
    windDirection: [0.0, 0.8, 0.1],
    blending: 'normal',
  },
  defaults: {
    roughness: 0.95,
    metalness: 0.0,
    color: '#334155',
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 6, Math.floor(i / w) / h * 6, 5, 20);
      const c = clamp(lerp(45, 90, f)) | 0;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = c;
      rgba[i * 4 + 3] = clamp(smoothstep(0.25, 0.75, f) * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 240),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── PAQUETE PROCEDIMENTAL DE HIELO Y NIEVE PBR (CGTrader / Substance Style) ───────────────

const iceGlacial: ProceduralMaterial = {
  id: 'ice_glacial',
  name: 'Hielo Glacial Puro (IOR 1.31)',
  category: 'ice_snow',
  icon: '🧊',
  isVolumetric: false,
  defaults: {
    roughness: 0.04,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 1.0,
    ior: 1.31,
    thickness: 2.0,
    attenuationColor: '#0284c7',
    attenuationDistance: 0.45,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    dispersion: 0.035,
  },
  generate(w, h) {
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const heightField = new Float32Array(w * h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const i = idx * 4;
        const nx = px / w, ny = py / h;

        // ── 1. Domain Warping Orgánico Multifrecuencia (Elimina rigidez poligonal) ──
        const deformaX = vNoise(nx * 3.5, ny * 3.5, 77) * 0.28;
        const deformaY = vNoise(nx * 3.5 + 4.0, ny * 3.5 + 2.0, 89) * 0.28;
        const warpX = (getSeamlessFBM4D(px, py, w, h, 2.2, 4) - 0.5) * 0.45;
        const warpY = (getSeamlessFBM4D((px + 137) % w, (py + 259) % h, w, h, 2.2, 4) - 0.5) * 0.45;
        const fineWarp = (vNoise(nx * 18, ny * 18, 42) - 0.5) * 0.12;

        const wnx = nx + warpX + fineWarp + deformaX;
        const wny = ny + warpY + fineWarp + deformaY;

        // ── 2. Ondulaciones Glaciales Esculpidas & Erosión Continua (FBM Multicapa) ──
        // Sustitución de celdas Voronoi por ruido continuo fractal FBM sin patrones artificiales de panal
        const n1 = getSeamlessFBM4D(px, py, w, h, 1.8, 4);
        const n2 = getSeamlessFBM4D((px + 150) % w, (py + 270) % h, w, h, 3.8, 4) * 0.5;
        const n3 = (vNoise((nx + deformaX) * 7.5, (ny + deformaY) * 7.5, 55) - 0.5) * 0.25;
        const surfaceFacet = smoothstep(0.12, 0.88, n1 + n2 + n3);

        const flowField = getSeamlessFBM4D((px + 80) % w, (py + 160) % h, w, h, 2.6, 3);
        const glacialRipples = Math.sin((wny * 6.5 + flowField * 3.2) * Math.PI) * 0.12;

        // ── 3. Fisuras Curvadas Naturales & Vetas de Tensión Orgánicas ────────────
        const musgraveCore = getSeamlessFBM4D(px, py, w, h, 3.6, 5);
        const fractureNoise = Math.abs(getSeamlessFBM4D(px, py, w, h, 4.2, 5) - 0.5) * 2.0;
        const fineStrata = Math.abs(vNoise(wnx * 18.0, wny * 18.0, 93) - 0.5) * 2.0;
        const naturalFissures = 1.0 - smoothstep(0.04, 0.24, fractureNoise * 0.65 + fineStrata * 0.35);

        // Clúster no uniforme: zonas vítreas prístinas vs zonas densas de fractura
        const clusterMask = smoothstep(0.35, 0.75, getSeamlessFBM4D(px, py, w, h, 1.3, 3));
        const activeCracks = naturalFissures * clusterMask;

        // Micro-inclusiones de aire / burbujas fluidas continuas
        const bubbleNoise = vNoise(wnx * 28.0, wny * 28.0, 29);
        const bubbles = smoothstep(0.80, 0.96, bubbleNoise) * clusterMask;

        // ── 4. Micro-desconchado & Escarcha Orgánica ─────────────────────────────
        const fineFrost = vNoise(nx * 38.0, ny * 38.0, 4);

        // Relieve y Normal Map Orgánicos y Fluidos
        const totalHeight = n1 * 0.38 + surfaceFacet * 0.24 + glacialRipples * 0.16 + activeCracks * 0.16 + bubbles * 0.06;
        heightField[idx] = clamp(totalHeight);

        // Rugosidad: Especular vítreo (~0.04) con zonas fracturadas semi-mates (~0.35)
        const roughVal = clamp(lerp(10, 95, activeCracks * 0.7 + fineFrost * 0.3)) | 0;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = roughVal;
        roughness[i + 3] = 255;

        // ── 5. Gradiente Dinámico Multitonos en Albedo (Fin del azul plano) ───────
        const colProfundo = { r: 11, g: 45, b: 82 };    // Azul noche compacto (#0b2d52)
        const colGlacial  = { r: 56, g: 189, b: 248 };  // Azul ártico (#38bdf8)
        const colBurbujas = { r: 241, g: 248, b: 255 }; // Blanco escarcha/aire (#f1f8ff)

        const factorDensidad = clamp(musgraveCore * 0.7 + (1.0 - surfaceFacet) * 0.3);

        let r = colProfundo.r, g = colProfundo.g, b = colProfundo.b;
        r = lerp(r, colGlacial.r, factorDensidad);
        g = lerp(g, colGlacial.g, factorDensidad);
        b = lerp(b, colGlacial.b, factorDensidad);

        const factorGrieta = smoothstep(0.55, 0.85, clusterMask);
        r = lerp(r, colBurbujas.r, factorGrieta);
        g = lerp(g, colBurbujas.g, factorGrieta);
        b = lerp(b, colBurbujas.b, factorGrieta);

        albedo[i]     = r | 0;
        albedo[i + 1] = g | 0;
        albedo[i + 2] = b | 0;
        albedo[i + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 2.8), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.85 + v * 0.15)), w, h),
      displacement: grayField(heightField, w, h),
    };
  },
  thumbnail() { return _thumb(this); }
};

const iceFrosted: ProceduralMaterial = {
  id: 'ice_frosted',
  name: 'Hielo con Escarcha (Rime Ice)',
  category: 'ice_snow',
  icon: '❄️',
  isVolumetric: false,
  defaults: {
    roughness: 0.16,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 0.94,
    ior: 1.31,
    thickness: 2.0,
    attenuationColor: '#0284c7',
    attenuationDistance: 0.60,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
  },
  generate(w, h) {
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const heightField = new Float32Array(w * h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const i = idx * 4;
        const nx = px / w, ny = py / h;

        // Domain warping orgánico para dendritas cristalinas ramificadas
        const warpX = (getSeamlessFBM4D(px, py, w, h, 2.4, 3) - 0.5) * 0.35;
        const warpY = (getSeamlessFBM4D((px + 99) % w, (py + 188) % h, w, h, 2.4, 3) - 0.5) * 0.35;
        const wnx = nx + warpX, wny = ny + warpY;

        // Patrón dendrítico de escarcha (FBM + modulación orgánica)
        const frostFBM = fbm(wnx * 7.5, wny * 7.5, 5, 53);
        const frostDetail = fbm(wnx * 16.0, wny * 16.0, 4, 88);
        const frostCells = smoothstep(0.15, 0.85, frostDetail);
        const frostMask = clamp(frostFBM * 0.65 + frostCells * 0.35);

        // Relieve de la corteza de escarcha
        heightField[idx] = frostMask * 0.55;

        // Rugosidad: Zonas pulidas cristalinas (12/255) vs cristales de escarcha mate (135/255)
        const roughVal = clamp(lerp(12, 135, frostMask)) | 0;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = roughVal;
        roughness[i + 3] = 255;

        // Albedo: Escarcha blanquecina sobre hielo cristalino
        const frostWhiteness = clamp(lerp(242, 255, frostMask)) | 0;
        albedo[i] = albedo[i + 1] = albedo[i + 2] = frostWhiteness;
        albedo[i + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 2.4), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.85 + v * 0.15)), w, h),
      displacement: grayField(heightField, w, h),
    };
  },
  thumbnail() { return _thumb(this); }
};

const iceCracked: ProceduralMaterial = {
  id: 'ice_cracked',
  name: 'Hielo de Lago Fisurado',
  category: 'ice_snow',
  icon: '💎',
  isVolumetric: false,
  defaults: {
    roughness: 0.05,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 0.98,
    ior: 1.31,
    thickness: 2.5,
    attenuationColor: '#0284c7',
    attenuationDistance: 0.40,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
  },
  generate(w, h) {
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const heightField = new Float32Array(w * h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const i = idx * 4;
        const nx = px / w, ny = py / h;

        // Domain warping orgánico profundo (fracturas curvilíneas de lago helado)
        const warpX = (getSeamlessFBM4D(px, py, w, h, 2.0, 4) - 0.5) * 0.50;
        const warpY = (getSeamlessFBM4D((px + 211) % w, (py + 317) % h, w, h, 2.0, 4) - 0.5) * 0.50;
        const wnx = nx + warpX, wny = ny + warpY;

        // Red profunda de fracturas orgánicas por tensión
        const { d1: c1, d2: c2 } = voronoi(wnx * 2.2, wny * 2.2, 4, 19);
        const deepCracks = 1.0 - smoothstep(0.008, 0.045, c2 - c1);

        const { d1: s1, d2: s2 } = voronoi(wnx * 5.5, wny * 5.5, 7, 92);
        const fineCracks = 1.0 - smoothstep(0.012, 0.065, s2 - s1);

        // Burbujas subsuperficiales atrapadas
        const bub = voronoi(wnx * 7.5, wny * 7.5, 10, 101).d1;
        const bubbles = 1.0 - smoothstep(0.02, 0.08, bub);

        const crackWeb = clamp(deepCracks * 0.65 + fineCracks * 0.35 + bubbles * 0.25);
        heightField[idx] = crackWeb;

        // Superficie lisa de espejo con ligeras rugosidades en grietas
        const roughVal = clamp(lerp(8, 60, crackWeb)) | 0;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = roughVal;
        roughness[i + 3] = 255;

        // Albedo: fracturas brillantes blancas dentro de hielo transparente azulado
        albedo[i] = albedo[i + 1] = albedo[i + 2] = 255;
        albedo[i + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 3.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: grayField(heightField, w, h),
    };
  },
  thumbnail() { return _thumb(this); }
};

const snowPowder: ProceduralMaterial = {
  id: 'snow_powder',
  name: 'Nieve Fresca / Polvo',
  category: 'ice_snow',
  icon: '🌨️',
  isVolumetric: false,
  defaults: {
    roughness: 0.85,
    metalness: 0.0,
    color: '#f8fafc',
    transmission: 0.0,
    sheen: 0.95,
    sheenColor: '#e0f2fe',
    sheenRoughness: 0.35,
    clearcoat: 0.0,
  },
  generate(w, h) {
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const heightField = new Float32Array(w * h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const i = idx * 4;
        const nx = px / w, ny = py / h;

        // Dunas de ventisca suaves + grano de nieve cristalina
        const duneNoise = fbm(nx * 3.5, ny * 3.5, 4, 33);
        const microGrain = vNoise(nx * 55, ny * 55, 2);
        const snowHeight = duneNoise * 0.8 + microGrain * 0.2;
        heightField[idx] = snowHeight;

        // Rugosidad suave difusa con micro-destellos
        const roughVal = clamp(lerp(200, 235, duneNoise) + (microGrain > 0.8 ? -40 : 0)) | 0;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = roughVal;
        roughness[i + 3] = 255;

        const c = clamp(lerp(242, 255, snowHeight)) | 0;
        albedo[i]     = c;
        albedo[i + 1] = clamp(c + 1) | 0;
        albedo[i + 2] = 255;
        albedo[i + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 1.6), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.75 + v * 0.25)), w, h),
      displacement: grayField(heightField, w, h),
    };
  },
  thumbnail() { return _thumb(this); }
};

const snowIceMelt: ProceduralMaterial = {
  id: 'snow_ice_melt',
  name: 'Nieve y Hielo Descongelado',
  category: 'ice_snow',
  icon: '🏔️',
  isVolumetric: false,
  defaults: {
    roughness: 0.30,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 0.60,
    ior: 1.31,
    thickness: 1.8,
    attenuationColor: '#38bdf8',
    attenuationDistance: 1.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.04,
  },
  generate(w, h) {
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const heightField = new Float32Array(w * h);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const i = idx * 4;
        const nx = px / w, ny = py / h;

        // Mezcla orgánica suave: charcos de hielo cristalino y costra de nieve
        const blendMask = smoothstep(0.35, 0.65, getSeamlessFBM4D(px, py, w, h, 2.5, 4));
        const warpX = (getSeamlessFBM4D(px, py, w, h, 2.0, 3) - 0.5) * 0.35;
        const warpY = (getSeamlessFBM4D((px + 80) % w, (py + 160) % h, w, h, 2.0, 3) - 0.5) * 0.35;
        const iceCracks = 1.0 - smoothstep(0.012, 0.065, voronoi((nx + warpX) * 3.5, (ny + warpY) * 3.5, 5, 80).d1);

        heightField[idx] = blendMask * 0.7 + (1.0 - blendMask) * iceCracks * 0.3;

        // Nieve rugosa (220), charcos de hielo pulido (12)
        const roughVal = clamp(lerp(12, 220, blendMask)) | 0;
        roughness[i] = roughness[i + 1] = roughness[i + 2] = roughVal;
        roughness[i + 3] = 255;

        // Albedo: nieve blanca vs hielo transparente
        const c = clamp(lerp(230, 255, blendMask)) | 0;
        albedo[i] = albedo[i + 1] = albedo[i + 2] = c;
        albedo[i + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 2.4), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.8 + v * 0.2)), w, h),
      displacement: grayField(heightField, w, h),
    };
  },
  thumbnail() { return _thumb(this); }
};

// Backward compatibility alias
const iceCrystal = iceGlacial;

const darkStorm: ProceduralMaterial = {
  id: 'dark_storm',
  name: 'Nube de Tormenta Oscura 3D',
  category: 'gaseous',
  icon: '🌩️',
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
  },
  defaults: {
    roughness: 0.95,
    metalness: 0.0,
    color: '#475569',
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 6, Math.floor(i / w) / h * 6, 6, 20);
      const c = clamp(lerp(60, 110, f)) | 0;
      rgba[i * 4] = rgba[i * 4 + 1] = c;
      rgba[i * 4 + 2] = clamp(c + 15);
      rgba[i * 4 + 3] = clamp(smoothstep(0.2, 0.8, f) * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 240),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const cosmicNebula: ProceduralMaterial = {
  id: 'cosmic_nebula',
  name: 'Nebulosa Cósmica Volumétrica 3D',
  category: 'gaseous',
  icon: '🌌',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'plasma',
    density: 2.2,
    scale: 1.6,
    lightIntensity: 1.8,
    color: '#c084fc',
    secondaryColor: '#f43f5e',
    emissiveIntensity: 2.4,
    threshold: 0.22,
    thresholdMax: 0.72,
    absorption: 1.2,
    steps: 36,
    shadowSteps: 4,
    windSpeed: 0.05,
    windDirection: [0.05, 0.02, 0.08],
    blending: 'additive',
  },
  defaults: {
    roughness: 0.1,
    metalness: 0.0,
    color: '#c084fc',
    emissive: '#f43f5e',
    emissiveIntensity: 2.4,
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 5, Math.floor(i / w) / h * 5, 5, 25);
      rgba[i * 4]     = clamp(lerp(192, 244, f)) | 0; // R
      rgba[i * 4 + 1] = clamp(lerp(132, 63, f)) | 0;  // G
      rgba[i * 4 + 2] = clamp(lerp(252, 94, f)) | 0;  // B
      rgba[i * 4 + 3] = clamp(f * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 30),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const auroraBoreal: ProceduralMaterial = {
  id: 'aurora_borealis',
  name: 'Aurora Boreal Volumétrica 3D',
  category: 'gaseous',
  icon: '✨',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'plasma',
    density: 2.0,
    scale: 1.8,
    lightIntensity: 1.8,
    color: '#10b981',
    secondaryColor: '#06b6d4',
    emissiveIntensity: 2.2,
    threshold: 0.25,
    thresholdMax: 0.78,
    absorption: 1.0,
    steps: 36,
    shadowSteps: 4,
    windSpeed: 0.08,
    windDirection: [0.1, 0.0, 0.1],
    blending: 'additive',
  },
  defaults: {
    roughness: 0.1,
    metalness: 0.0,
    color: '#10b981',
    emissive: '#06b6d4',
    emissiveIntensity: 2.2,
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const f = fbm((i % w) / w * 6, Math.floor(i / w) / h * 6, 5, 18);
      rgba[i * 4]     = clamp(lerp(16, 6, f)) | 0;
      rgba[i * 4 + 1] = clamp(lerp(185, 182, f)) | 0;
      rgba[i * 4 + 2] = clamp(lerp(129, 212, f)) | 0;
      rgba[i * 4 + 3] = clamp(f * 255);
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 30),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

const liquidWaterVolume: ProceduralMaterial = {
  id: 'liquid_water_volume',
  name: 'Agua / Fluido Volumétrico 3D',
  category: 'gaseous',
  icon: '💧',
  isVolumetric: true,
  volumetric: {
    enabled: true,
    mode: 'ice',
    density: 2.2,
    scale: 2.4,
    lightIntensity: 1.6,
    color: '#38bdf8',
    secondaryColor: '#0284c7',
    emissiveIntensity: 0.2,
    threshold: 0.22,
    thresholdMax: 0.72,
    absorption: 1.5,
    steps: 38,
    shadowSteps: 4,
    windSpeed: 0.06,
    windDirection: [0.05, 0.02, 0.0],
    blending: 'normal',
  },
  defaults: {
    roughness: 0.05,
    metalness: 0.0,
    color: '#38bdf8',
    transmission: 0.95,
    ior: 1.333,
  },
  generate(w, h) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const nx = px / w, ny = py / h;
        const wave = fbm(nx * 8, ny * 8, 4, 15);
        rgba[i]     = clamp(lerp(14, 56, wave)) | 0;
        rgba[i + 1] = clamp(lerp(165, 189, wave)) | 0;
        rgba[i + 2] = clamp(lerp(233, 248, wave)) | 0;
        rgba[i + 3] = 255;
      }
    }
    return {
      albedo: rgbaToDataURL(rgba, w, h),
      normal: uniformMap(w, h, 128),
      roughness: uniformMap(w, h, 10),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: uniformMap(w, h, 0),
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── ADOBE SUBSTANCE 3D: METALES AVANZADOS ──────────────────────────────────────

const damascusSteel: ProceduralMaterial = {
  id: 'damascus_steel',
  name: 'Acero de Damasco Plegado (Substance)',
  category: 'metal',
  icon: '🗡️',
  defaults: {
    roughness: 0.22,
    metalness: 1.0,
    normalScale: 1.8,
    tiling: [3, 3],
    anisotropy: 0.75,
    anisotropyRotation: 45
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const metallic = uniformMapBuffer(w, h, 255);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Domain warping for fluid Damascus folds
        const warp1 = fbm(nx * 6, ny * 6, 4, 10);
        const warp2 = fbm(nx * 6 + warp1 * 2, ny * 6 + warp1 * 2, 4, 20);
        const pattern = Math.sin((nx * 18 + ny * 12 + warp2 * 8) * Math.PI) * 0.5 + 0.5;
        const microNoise = vNoise(nx * 80, ny * 80, 5) * 0.15;
        const hVal = clamp(pattern * 0.85 + microNoise);

        heightField[idx] = hVal;

        // Dark acid-etched iron layers vs polished bright carbon steel
        const isDarkBand = hVal < 0.45;
        const c = isDarkBand ? lerp(42, 75, hVal / 0.45) : lerp(165, 230, (hVal - 0.45) / 0.55);
        albedo[idx * 4] = clamp(c * 0.96) | 0;
        albedo[idx * 4 + 1] = clamp(c * 0.98) | 0;
        albedo[idx * 4 + 2] = clamp(c * 1.04) | 0;
        albedo[idx * 4 + 3] = 255;

        // Etched bands are rougher; bright bands are mirror-polished
        const rVal = isDarkBand ? 95 : 35;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;

        // Cavity AO in etched grooves
        const aoVal = clamp(190 + hVal * 65) | 0;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: rgbaToDataURL(metallic, w, h),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const oxidizedBronze: ProceduralMaterial = {
  id: 'oxidized_bronze',
  name: 'Bronce con Pátina Cardenillo (Substance)',
  category: 'metal',
  icon: '🏛️',
  defaults: {
    roughness: 0.45,
    metalness: 0.75,
    normalScale: 2.2,
    tiling: [2, 2]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const metallic = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        const surfaceNoise = fbm(nx * 8, ny * 8, 5, 42);
        const { d1 } = voronoi(nx, ny, 6, 88);
        const patinaMask = clamp((1.0 - surfaceNoise * 0.7 - d1 * 0.5) * 1.6);

        heightField[idx] = surfaceNoise * 0.7 + patinaMask * 0.3;

        // Base bronze vs turquoise / malachite patina
        if (patinaMask > 0.45) {
          // Powdery turquoise patina
          const t = (patinaMask - 0.45) / 0.55;
          albedo[idx * 4]     = clamp(lerp(45, 90, t)) | 0;   // R
          albedo[idx * 4 + 1] = clamp(lerp(185, 220, t)) | 0; // G
          albedo[idx * 4 + 2] = clamp(lerp(170, 205, t)) | 0; // B
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 235; // Non-metallic powdery
          metallic[idx * 4] = metallic[idx * 4 + 1] = metallic[idx * 4 + 2] = 10;
        } else {
          // Polished statuary bronze metal
          albedo[idx * 4]     = 165; // R
          albedo[idx * 4 + 1] = 110; // G
          albedo[idx * 4 + 2] = 68;  // B
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 55;
          metallic[idx * 4] = metallic[idx * 4 + 1] = metallic[idx * 4 + 2] = 250;
        }
        albedo[idx * 4 + 3] = roughness[idx * 4 + 3] = metallic[idx * 4 + 3] = 255;

        const aoVal = clamp(255 - patinaMask * 75) | 0;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 3.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: rgbaToDataURL(metallic, w, h),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const hammeredCastIron: ProceduralMaterial = {
  id: 'cast_iron_hammered',
  name: 'Hierro Fundido Forjado (Substance)',
  category: 'metal',
  icon: '🔨',
  defaults: {
    roughness: 0.62,
    metalness: 0.95,
    normalScale: 2.5,
    tiling: [4, 4]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const metallic = uniformMapBuffer(w, h, 240);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Spherical hammer impressions
        const { d1 } = voronoi(nx, ny, 10, 15);
        const hammerDimple = Math.sin(clamp(d1 * Math.PI * 0.9)) * 0.6;
        const microCastPitting = fbm(nx * 40, ny * 40, 4, 3) * 0.25;
        const hVal = clamp(hammerDimple + microCastPitting);

        heightField[idx] = hVal;

        // Dark charcoal cast iron tones
        const c = clamp(36 + hVal * 30) | 0;
        albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        albedo[idx * 4 + 3] = 255;

        // Dimple high points have slight rubbing shine
        const rVal = clamp(170 - (1.0 - hVal) * 50) | 0;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: rgbaToDataURL(metallic, w, h),
      ao: grayField(mapField(heightField, v => clamp(0.6 + v * 0.4)), w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const scifiHullArmor: ProceduralMaterial = {
  id: 'scifi_hull_panels',
  name: 'Blindaje Sci-Fi de Nave (Substance)',
  category: 'metal',
  icon: '🚀',
  defaults: {
    roughness: 0.35,
    metalness: 0.9,
    normalScale: 3.0,
    tiling: [2, 2],
    clearcoat: 0.3
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const metallic = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = (px / w) * 4, ny = (py / h) * 4;
        const cellX = Math.floor(nx), cellY = Math.floor(ny);
        const fx = nx - cellX, fy = ny - cellY;

        // Seams and rivets
        const isSeam = fx < 0.05 || fx > 0.95 || fy < 0.05 || fy > 0.95;
        const isRivet = (fx < 0.15 || fx > 0.85) && (fy < 0.15 || fy > 0.85);

        let hVal = 0.8;
        if (isSeam) hVal = 0.1;
        else if (isRivet) hVal = 1.0;

        heightField[idx] = hVal;

        // Dual-tone armor plating (alternating panels)
        const isAccent = (cellX + cellY) % 2 === 0;
        let c = isAccent ? 130 : 75;
        if (isSeam) c = 20;

        albedo[idx * 4]     = clamp(c * 0.92) | 0; // R
        albedo[idx * 4 + 1] = clamp(c * 0.96) | 0; // G
        albedo[idx * 4 + 2] = clamp(c * 1.08) | 0; // B
        albedo[idx * 4 + 3] = 255;

        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = isSeam ? 220 : 80;
        roughness[idx * 4 + 3] = 255;

        metallic[idx * 4] = metallic[idx * 4 + 1] = metallic[idx * 4 + 2] = isSeam ? 40 : 230;
        metallic[idx * 4 + 3] = 255;

        const aoVal = isSeam ? 40 : 255;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 5.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: rgbaToDataURL(metallic, w, h),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── ADOBE SUBSTANCE 3D: MADERAS & FIBRAS ───────────────────────────────────────

const shouSugiBan: ProceduralMaterial = {
  id: 'shou_sugi_ban',
  name: 'Madera Quemada Shou Sugi Ban (Substance)',
  category: 'wood',
  icon: '🔥',
  defaults: {
    roughness: 0.78,
    metalness: 0.12,
    normalScale: 3.5,
    displacementScale: 0.05,
    tiling: [3, 3]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Alligator scale cracks (Voronoi + cellular crack ridges)
        const { d1, d2 } = voronoi(nx, ny, 14, 7);
        const crackEdge = clamp((d2 - d1) * 6.0);
        const woodGrainFibre = vNoise(nx * 90, ny * 4, 3) * 0.2;
        const hVal = clamp(crackEdge * 0.8 + woodGrainFibre);

        heightField[idx] = hVal;

        // Coal-black charred wood with subtle warm ash tones
        const c = clamp(15 + hVal * 25) | 0;
        albedo[idx * 4] = clamp(c + 4) | 0;
        albedo[idx * 4 + 1] = c;
        albedo[idx * 4 + 2] = clamp(c - 2) | 0;
        albedo[idx * 4 + 3] = 255;

        // Crack cavities are ultra-rough; charred scale crests have slight specular sheen
        const rVal = clamp(240 - hVal * 60) | 0;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;

        const aoVal = clamp(80 + hVal * 175) | 0;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 6.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 25),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const teakDeck: ProceduralMaterial = {
  id: 'teak_deck',
  name: 'Teca Marina de Cubierta (Substance)',
  category: 'wood',
  icon: '⛵',
  defaults: {
    roughness: 0.38,
    metalness: 0.0,
    normalScale: 1.5,
    tiling: [4, 4]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    const plankCount = 6;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        const plankPos = (nx * plankCount) % 1.0;
        const isCaulking = plankPos < 0.06 || plankPos > 0.94;

        if (isCaulking) {
          heightField[idx] = 0.2;
          // Black flexible rubber seam
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = 24;
          albedo[idx * 4 + 3] = 255;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 210;
          roughness[idx * 4 + 3] = 255;
          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 90;
          ao[idx * 4 + 3] = 255;
        } else {
          // Warm golden teak grain
          const grain = vNoise(nx * 120, ny * 10, 8);
          const wave = Math.sin(ny * 24 + grain * 4) * 0.5 + 0.5;
          heightField[idx] = 0.8 + grain * 0.2;

          const r = lerp(160, 205, wave);
          const g = lerp(105, 140, wave);
          const b = lerp(45, 65, wave);

          albedo[idx * 4]     = clamp(r) | 0;
          albedo[idx * 4 + 1] = clamp(g) | 0;
          albedo[idx * 4 + 2] = clamp(b) | 0;
          albedo[idx * 4 + 3] = 255;

          const rVal = clamp(85 + grain * 35) | 0;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
          roughness[idx * 4 + 3] = 255;

          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 250;
          ao[idx * 4 + 3] = 255;
        }
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 2.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const wovenBamboo: ProceduralMaterial = {
  id: 'bamboo_weave',
  name: 'Bambú Tejido / Rattan (Substance)',
  category: 'wood',
  icon: '🎋',
  defaults: {
    roughness: 0.42,
    metalness: 0.0,
    normalScale: 2.8,
    tiling: [4, 4]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = (px / w) * 8, ny = (py / h) * 8;
        const cellX = Math.floor(nx), cellY = Math.floor(ny);
        const fx = nx - cellX, fy = ny - cellY;

        const isHorizontal = (cellX + cellY) % 2 === 0;
        let strip = isHorizontal ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
        const fibre = vNoise(nx * 40, ny * 40, 11) * 0.15;
        const hVal = clamp(strip * 0.85 + fibre);

        heightField[idx] = hVal;

        // Natural golden-amber bamboo cane colors
        const cR = lerp(195, 235, hVal);
        const cG = lerp(155, 195, hVal);
        const cB = lerp(95, 130, hVal);

        albedo[idx * 4]     = clamp(cR) | 0;
        albedo[idx * 4 + 1] = clamp(cG) | 0;
        albedo[idx * 4 + 2] = clamp(cB) | 0;
        albedo[idx * 4 + 3] = 255;

        const rVal = clamp(90 + (1.0 - hVal) * 50) | 0;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;

        const aoVal = clamp(110 + hVal * 145) | 0;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const pressedCork: ProceduralMaterial = {
  id: 'pressed_cork',
  name: 'Corcho Natural Prensado (Substance)',
  category: 'wood',
  icon: '🍾',
  defaults: {
    roughness: 0.88,
    metalness: 0.0,
    normalScale: 3.2,
    tiling: [3, 3]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 230);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Agglomerated cork granules
        const { d1, id } = voronoi(nx, ny, 28, 19);
        const granuleTone = ((id * 9301 + 49297) % 233280) / 233280;
        const microNoise = vNoise(nx * 80, ny * 80, 5) * 0.2;
        const hVal = clamp((1.0 - d1 * 1.5) * 0.7 + microNoise);

        heightField[idx] = hVal;

        const r = lerp(165, 220, granuleTone);
        const g = lerp(110, 160, granuleTone);
        const b = lerp(60, 95, granuleTone);

        albedo[idx * 4]     = clamp(r) | 0;
        albedo[idx * 4 + 1] = clamp(g) | 0;
        albedo[idx * 4 + 2] = clamp(b) | 0;
        albedo[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.7 + v * 0.3)), w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── ADOBE SUBSTANCE 3D: ARQUITECTURA, HORMIGÓN & PIEDRA ────────────────────────

const formworkConcrete: ProceduralMaterial = {
  id: 'formwork_concrete',
  name: 'Hormigón Visto Encofrado (Substance)',
  category: 'stone',
  icon: '🏢',
  defaults: {
    roughness: 0.75,
    metalness: 0.0,
    normalScale: 2.0,
    tiling: [2, 2]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    const boardCount = 5;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        const boardPos = (ny * boardCount) % 1.0;
        const isBoardSeam = boardPos < 0.03 || boardPos > 0.97;

        // Wood grain imprint + air bubbles
        const woodTransfer = vNoise(nx * 60, ny * 15, 22) * 0.15;
        const airBubble = fbm(nx * 45, ny * 45, 4, 99);
        const isBubblePore = airBubble > 0.72;

        let hVal = 0.6 + woodTransfer;
        if (isBoardSeam) hVal -= 0.35;
        if (isBubblePore) hVal -= 0.25;

        heightField[idx] = clamp(hVal);

        // Concrete grey mineral tones
        const c = clamp(140 + woodTransfer * 80 - (isBoardSeam ? 35 : 0) - (isBubblePore ? 40 : 0)) | 0;
        albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        albedo[idx * 4 + 3] = 255;

        const rVal = clamp(180 + (1.0 - hVal) * 50) | 0;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;

        const aoVal = isBoardSeam ? 100 : (isBubblePore ? 120 : 255);
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 3.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const venetianTerrazzo: ProceduralMaterial = {
  id: 'venetian_terrazzo',
  name: 'Terrazo Veneciano con Mármol (Substance)',
  category: 'stone',
  icon: '🪨',
  defaults: {
    roughness: 0.15,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.05,
    normalScale: 0.4,
    tiling: [3, 3]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 40);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Voronoi marble chips
        const { d1, id } = voronoi(nx, ny, 16, 33);
        const isChip = d1 < 0.65;
        const chipType = (id % 5);

        heightField[idx] = isChip ? 0.55 : 0.5;

        if (isChip) {
          // Colorful stone aggregate chips
          if (chipType === 0) {
            // Nero Marquina (Black)
            albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = 30;
          } else if (chipType === 1) {
            // Rosso Verona (Terracotta red)
            albedo[idx * 4] = 195; albedo[idx * 4 + 1] = 85; albedo[idx * 4 + 2] = 65;
          } else if (chipType === 2) {
            // Carrara White
            albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = 245;
          } else if (chipType === 3) {
            // Jade Green
            albedo[idx * 4] = 60; albedo[idx * 4 + 1] = 145; albedo[idx * 4 + 2] = 115;
          } else {
            // Golden Ochre
            albedo[idx * 4] = 215; albedo[idx * 4 + 1] = 165; albedo[idx * 4 + 2] = 85;
          }
        } else {
          // Off-white cement matrix
          const cementGrain = vNoise(nx * 100, ny * 100, 2) * 15;
          const c = clamp(225 - cementGrain) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        }
        albedo[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 1.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const rusticBrick: ProceduralMaterial = {
  id: 'rustic_brick',
  name: 'Ladrillo Rústico Artesanal (Substance)',
  category: 'stone',
  icon: '🧱',
  defaults: {
    roughness: 0.85,
    metalness: 0.0,
    normalScale: 3.5,
    displacementScale: 0.04,
    tiling: [3, 3]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    const rows = 6, cols = 4;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const ny = (py / h) * rows;
        const rowIdx = Math.floor(ny);
        const rowFrac = ny - rowIdx;

        // Staggered running bond pattern
        const nx = (px / w) * cols + (rowIdx % 2 === 0 ? 0.0 : 0.5);
        const colIdx = Math.floor(nx);
        const colFrac = nx - colIdx;

        // Mortar joint margin
        const isMortar = rowFrac < 0.12 || colFrac < 0.08;

        if (isMortar) {
          // Sandy grey mortar joint
          const mortarNoise = vNoise(px * 0.2, py * 0.2, 5) * 20;
          heightField[idx] = 0.2;
          const c = clamp(170 + mortarNoise) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
          albedo[idx * 4 + 3] = 255;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 245;
          roughness[idx * 4 + 3] = 255;
          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 70;
          ao[idx * 4 + 3] = 255;
        } else {
          // Weathered terracotta brick
          const brickId = rowIdx * 100 + colIdx;
          const brickVariation = ((brickId * 7919) % 100) / 100;
          const pitNoise = fbm(px * 0.1, py * 0.1, 4, 12) * 0.3;
          heightField[idx] = clamp(0.75 + pitNoise);

          const r = lerp(165, 210, brickVariation) - pitNoise * 40;
          const g = lerp(55, 85, brickVariation) - pitNoise * 20;
          const b = lerp(35, 55, brickVariation) - pitNoise * 15;

          albedo[idx * 4]     = clamp(r) | 0;
          albedo[idx * 4 + 1] = clamp(g) | 0;
          albedo[idx * 4 + 2] = clamp(b) | 0;
          albedo[idx * 4 + 3] = 255;

          const rVal = clamp(210 - pitNoise * 50) | 0;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
          roughness[idx * 4 + 3] = 255;

          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 250;
          ao[idx * 4 + 3] = 255;
        }
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const calacattaGold: ProceduralMaterial = {
  id: 'calacatta_gold',
  name: 'Mármol Calacatta Gold (Substance)',
  category: 'stone',
  icon: '🏛️',
  defaults: {
    roughness: 0.08,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.04,
    normalScale: 0.6,
    tiling: [1, 1]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 20);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Dramatic sweeping gold and grey veins
        const warp = fbm(nx * 4, ny * 4, 5, 88);
        const vein1 = Math.abs(Math.sin((nx * 3 + ny * 5 + warp * 4) * Math.PI));
        const vein2 = Math.abs(Math.sin((nx * 6 - ny * 3 + warp * 3) * Math.PI));
        const isGoldVein = vein1 < 0.12;
        const isGreyVein = vein2 < 0.18;

        heightField[idx] = 0.5 + (isGoldVein || isGreyVein ? 0.08 : 0);

        if (isGoldVein) {
          // Warm ochre-gold vein
          const t = vein1 / 0.12;
          albedo[idx * 4]     = clamp(lerp(215, 250, t)) | 0;
          albedo[idx * 4 + 1] = clamp(lerp(165, 250, t)) | 0;
          albedo[idx * 4 + 2] = clamp(lerp(85, 250, t)) | 0;
        } else if (isGreyVein) {
          // Charcoal soft grey vein
          const t = vein2 / 0.18;
          const g = lerp(110, 250, t);
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = clamp(g) | 0;
        } else {
          // Pure white crystalline calcite
          const subtleTone = vNoise(nx * 30, ny * 30, 4) * 6;
          const c = clamp(255 - subtleTone) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        }
        albedo[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 1.2), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── ADOBE SUBSTANCE 3D: TEXTILES, PIELES & COMPUESTOS ──────────────────────────

const distressedLeather: ProceduralMaterial = {
  id: 'distressed_leather',
  name: 'Cuero Vintage Envejecido (Substance)',
  category: 'textile',
  icon: '👞',
  defaults: {
    roughness: 0.58,
    metalness: 0.0,
    normalScale: 2.8,
    sheen: 0.6,
    sheenRoughness: 0.4,
    sheenColor: '#d97706',
    tiling: [3, 3]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Fine leather grain cells + creasing wrinkles
        const { d1 } = voronoi(nx, ny, 36, 44);
        const wrinkle = fbm(nx * 8, ny * 8, 4, 18) * 0.35;
        const hVal = clamp((1.0 - d1 * 1.8) * 0.65 + wrinkle);

        heightField[idx] = hVal;

        // Rich cognac pull-up leather (creases lighten to warm tan)
        const r = lerp(85, 175, hVal);
        const g = lerp(42, 95, hVal);
        const b = lerp(18, 45, hVal);

        albedo[idx * 4]     = clamp(r) | 0;
        albedo[idx * 4 + 1] = clamp(g) | 0;
        albedo[idx * 4 + 2] = clamp(b) | 0;
        albedo[idx * 4 + 3] = 255;

        // High points develop oily burnished sheen
        const rVal = clamp(180 - hVal * 70) | 0;
        roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = rVal;
        roughness[idx * 4 + 3] = 255;

        const aoVal = clamp(120 + hVal * 135) | 0;
        ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = aoVal;
        ao[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const denimTwill: ProceduralMaterial = {
  id: 'denim_twill',
  name: 'Tejido Denim Vaquero (Substance)',
  category: 'textile',
  icon: '👖',
  defaults: {
    roughness: 0.82,
    metalness: 0.0,
    normalScale: 2.2,
    sheen: 0.7,
    sheenRoughness: 0.5,
    sheenColor: '#93c5fd',
    tiling: [6, 6]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 210);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        // 3x1 diagonal twill pattern (indigo warp + ecru weft)
        const twill = (px * 3 + py) % 4;
        const isIndigo = twill !== 0;
        const fuzz = vNoise(px * 0.5, py * 0.5, 9) * 20;

        heightField[idx] = isIndigo ? 0.7 : 0.3;

        if (isIndigo) {
          // Deep indigo blue warp yarn
          albedo[idx * 4]     = clamp(25 + fuzz * 0.4) | 0;
          albedo[idx * 4 + 1] = clamp(55 + fuzz * 0.6) | 0;
          albedo[idx * 4 + 2] = clamp(140 + fuzz) | 0;
        } else {
          // Off-white / ecru weft yarn
          const c = clamp(210 + fuzz) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        }
        albedo[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 3.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: uniformMap(w, h, 255),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── ADOBE SUBSTANCE 3D: SINTÉTICOS, ELEMENTOS & SCI-FI ─────────────────────────

const kintsugiCeramic: ProceduralMaterial = {
  id: 'kintsugi_gold_seam',
  name: 'Kintsugi Oro y Cerámica (Substance)',
  category: 'synthetic',
  icon: '✨',
  defaults: {
    roughness: 0.35,
    metalness: 0.3,
    normalScale: 3.0,
    clearcoat: 0.6,
    tiling: [2, 2]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);
    const metallic = new Uint8ClampedArray(w * h * 4);
    const ao = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Ceramic fracture network
        const { d1, d2 } = voronoi(nx, ny, 6, 91);
        const crackEdge = (d2 - d1);
        const isGoldSeam = crackEdge < 0.08;

        if (isGoldSeam) {
          // 24K pure gold repaired seam
          heightField[idx] = 1.0;
          albedo[idx * 4]     = 255; // R
          albedo[idx * 4 + 1] = 215; // G
          albedo[idx * 4 + 2] = 0;   // B
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 20;
          metallic[idx * 4] = metallic[idx * 4 + 1] = metallic[idx * 4 + 2] = 255;
          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 255;
        } else {
          // Matte dark Japanese Raku ceramic
          heightField[idx] = 0.5;
          const c = clamp(26 + vNoise(nx * 50, ny * 50, 7) * 12) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 130;
          metallic[idx * 4] = metallic[idx * 4 + 1] = metallic[idx * 4 + 2] = 0;
          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 240;
        }
        albedo[idx * 4 + 3] = roughness[idx * 4 + 3] = metallic[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: rgbaToDataURL(metallic, w, h),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const zelligeTiles: ProceduralMaterial = {
  id: 'zellige_glazed_tiles',
  name: 'Azulejos Zellige Esmaltados (Substance)',
  category: 'synthetic',
  icon: '🪞',
  defaults: {
    roughness: 0.06,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    normalScale: 2.2,
    tiling: [4, 4]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 18);
    const ao = new Uint8ClampedArray(w * h * 4);

    const cols = 5, rows = 5;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = (px / w) * cols, ny = (py / h) * rows;
        const cellX = Math.floor(nx), cellY = Math.floor(ny);
        const fx = nx - cellX, fy = ny - cellY;
        const isGrout = fx < 0.06 || fx > 0.94 || fy < 0.06 || fy > 0.94;

        if (isGrout) {
          heightField[idx] = 0.2;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = 200;
          albedo[idx * 4 + 3] = 255;
          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 80;
          ao[idx * 4 + 3] = 255;
        } else {
          // Handcrafted Moroccan vitreous turquoise/emerald glaze
          const tileSeed = cellX * 17 + cellY * 31;
          const tileTone = ((tileSeed * 49297) % 100) / 100;
          const cushion = Math.sin(fx * Math.PI) * Math.sin(fy * Math.PI);
          heightField[idx] = 0.6 + cushion * 0.4;

          const r = lerp(12, 45, tileTone);
          const g = lerp(150, 205, tileTone);
          const b = lerp(185, 230, tileTone);

          albedo[idx * 4]     = clamp(r) | 0;
          albedo[idx * 4 + 1] = clamp(g) | 0;
          albedo[idx * 4 + 2] = clamp(b) | 0;
          albedo[idx * 4 + 3] = 255;

          ao[idx * 4] = ao[idx * 4 + 1] = ao[idx * 4 + 2] = 255;
          ao[idx * 4 + 3] = 255;
        }
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 3.5), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: rgbaToDataURL(ao, w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const tacticalPolymer: ProceduralMaterial = {
  id: 'tactical_polymer',
  name: 'Polímero Táctico Estriado (Substance)',
  category: 'synthetic',
  icon: '🛡️',
  defaults: {
    roughness: 0.72,
    metalness: 0.0,
    normalScale: 2.8,
    tiling: [4, 4]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = uniformMapBuffer(w, h, 185);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Diamond stipple micro-traction pattern
        const stipple = Math.sin(nx * 120) * Math.sin(ny * 120);
        const microNoise = vNoise(nx * 60, ny * 60, 14) * 0.2;
        const hVal = clamp(stipple * 0.5 + 0.5 + microNoise);

        heightField[idx] = hVal;

        // Tactical matte black/olive polymer
        const c = clamp(35 + hVal * 18) | 0;
        albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
        albedo[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 4.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.75 + v * 0.25)), w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

const activeMagmaCrust: ProceduralMaterial = {
  id: 'magma_crust',
  name: 'Corteza de Lava Magma Activa (Substance)',
  category: 'gaseous',
  icon: '🌋',
  defaults: {
    roughness: 0.9,
    metalness: 0.0,
    normalScale: 4.5,
    displacementScale: 0.06,
    tiling: [2, 2]
  },
  generate(w, h) {
    const heightField = new Float32Array(w * h);
    const albedo = new Uint8ClampedArray(w * h * 4);
    const roughness = new Uint8ClampedArray(w * h * 4);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = py * w + px;
        const nx = px / w, ny = py / h;
        // Basalt crust breaking open
        const { d1, d2 } = voronoi(nx, ny, 8, 55);
        const crack = (d2 - d1);
        const isFissure = crack < 0.15;

        heightField[idx] = clamp(crack * 1.5);

        if (isFissure) {
          // Glowing incandescent 1500K molten lava
          const heat = 1.0 - (crack / 0.15);
          albedo[idx * 4]     = 255; // R
          albedo[idx * 4 + 1] = clamp(lerp(60, 220, heat)) | 0; // G
          albedo[idx * 4 + 2] = clamp(lerp(0, 80, heat)) | 0;   // B
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 20;
        } else {
          // Hardened basalt crust
          const c = clamp(18 + vNoise(nx * 40, ny * 40, 2) * 20) | 0;
          albedo[idx * 4] = albedo[idx * 4 + 1] = albedo[idx * 4 + 2] = c;
          roughness[idx * 4] = roughness[idx * 4 + 1] = roughness[idx * 4 + 2] = 240;
        }
        albedo[idx * 4 + 3] = roughness[idx * 4 + 3] = 255;
      }
    }

    return {
      albedo: rgbaToDataURL(albedo, w, h),
      normal: rgbaToDataURL(heightToNormalSeamless(heightField, w, h, 6.0), w, h),
      roughness: rgbaToDataURL(roughness, w, h),
      metallic: uniformMap(w, h, 0),
      ao: grayField(mapField(heightField, v => clamp(0.6 + v * 0.4)), w, h),
      displacement: grayField(heightField, w, h)
    };
  },
  thumbnail() { return _thumb(this); }
};

// ── REESTRUCTURACIÓN DE LA BIBLIOTECA GENERAL ────────────────────────────────

// ── CSM & Glass Material Definitions ───────────────────────────────────────
function fastSolidMaps(colorHex: string, rough = 0.5, metal = 0.0): GeneratedMaps {
  return {
    albedo: '',
    normal: '',
    roughness: '',
    metallic: '',
    ao: '',
    displacement: '',
  };
}

export const csmWaves: ProceduralMaterial = {
  id: 'csm_waves',
  name: 'CSM Ondas Líquidas & Vórtice',
  category: 'csm',
  icon: '🌊',
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
  },
  defaults: {
    roughness: 0.1,
    metalness: 0.2,
    color: '#0284c7',
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    transmission: 0.4,
    ior: 1.33,
  },
  generate: () => fastSolidMaps('#0284c7', 0.1, 0.2),
  thumbnail: () => _colorThumb('#0284c7', '🌊', 'csm_waves'),
};

export const csmShield: ProceduralMaterial = {
  id: 'csm_shield',
  name: 'CSM Escudo Holográfico Sci-Fi',
  category: 'csm',
  icon: '🛡️',
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
  },
  defaults: {
    roughness: 0.15,
    metalness: 0.0,
    color: '#0891b2',
    emissive: '#06b6d4',
    emissiveIntensity: 1.5,
  },
  generate: () => fastSolidMaps('#0891b2', 0.15, 0.0),
  thumbnail: () => _colorThumb('#0891b2', '🛡️', 'csm_shield'),
};

export const csmMagma: ProceduralMaterial = {
  id: 'csm_magma',
  name: 'CSM Magma Volcánico y Relieve',
  category: 'csm',
  icon: '🌋',
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
  },
  defaults: {
    roughness: 0.85,
    metalness: 0.1,
    color: '#1c1917',
    emissive: '#ff3b00',
    emissiveIntensity: 2.0,
  },
  generate: () => fastSolidMaps('#1c1917', 0.85, 0.1),
  thumbnail: () => _colorThumb('#ff3b00', '🌋', 'csm_magma'),
};

export const csmTwist: ProceduralMaterial = {
  id: 'csm_twist',
  name: 'CSM Torsión Espacial Helicoidal',
  category: 'csm',
  icon: '🌪️',
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
  },
  defaults: {
    roughness: 0.2,
    metalness: 0.6,
    color: '#581c87',
  },
  generate: () => fastSolidMaps('#581c87', 0.2, 0.6),
  thumbnail: () => _colorThumb('#a855f7', '🌪️', 'csm_twist'),
};

export const csmBioFlesh: ProceduralMaterial = {
  id: 'csm_flesh',
  name: 'CSM Tejido Bio-Orgánico',
  category: 'csm',
  icon: '🧬',
  isCSM: true,
  csmConfig: {
    enabled: true,
    baseMaterial: 'MeshPhysicalMaterial',
    preset: 'bio_organic_flesh',
    timeSpeed: 1.5,
    displacementScale: 0.0,
    noiseFrequency: 3.0,
    colorAccent: '#e11d48',
    glowIntensity: 0.8,
  },
  defaults: {
    roughness: 0.35,
    metalness: 0.0,
    color: '#881337',
  },
  generate: () => fastSolidMaps('#881337', 0.35, 0.0),
  thumbnail: () => _colorThumb('#e11d48', '🧬', 'csm_flesh'),
};

export const csmQuantumCrystal: ProceduralMaterial = {
  id: 'csm_crystal',
  name: 'CSM Cristal Cuántico Facetado',
  category: 'csm',
  icon: '💎',
  isCSM: true,
  csmConfig: {
    enabled: true,
    baseMaterial: 'MeshPhysicalMaterial',
    preset: 'quantum_crystal',
    timeSpeed: 1.0,
    displacementScale: 0.0,
    noiseFrequency: 4.0,
    colorAccent: '#818cf8',
    glowIntensity: 1.2,
  },
  defaults: {
    roughness: 0.05,
    metalness: 0.4,
    color: '#312e81',
    transmission: 0.6,
  },
  generate: () => fastSolidMaps('#312e81', 0.05, 0.4),
  thumbnail: () => _colorThumb('#818cf8', '💎', 'csm_crystal'),
};

export const csmGlitch: ProceduralMaterial = {
  id: 'csm_glitch',
  name: 'CSM Glitch Digital Cyber',
  category: 'csm',
  icon: '👾',
  isCSM: true,
  csmConfig: {
    enabled: true,
    baseMaterial: 'MeshStandardMaterial',
    preset: 'digital_wire_glitch',
    timeSpeed: 3.0,
    displacementScale: 0.0,
    noiseFrequency: 6.0,
    colorAccent: '#10b981',
    glowIntensity: 2.0,
  },
  defaults: {
    roughness: 0.3,
    metalness: 0.1,
    color: '#064e3b',
  },
  generate: () => fastSolidMaps('#064e3b', 0.3, 0.1),
  thumbnail: () => _colorThumb('#10b981', '👾', 'csm_glitch'),
};

export const csmComic: ProceduralMaterial = {
  id: 'csm_comic',
  name: 'CSM Sombreado Cómic / Pop-Art',
  category: 'csm',
  icon: '🎨',
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
  },
  defaults: {
    roughness: 0.9,
    metalness: 0.0,
    color: '#d97706',
  },
  generate: () => fastSolidMaps('#d97706', 0.9, 0.0),
  thumbnail: () => _colorThumb('#f59e0b', '🎨', 'csm_comic'),
};

export const csmSoapBubble: ProceduralMaterial = {
  id: 'csm_soap_bubble',
  name: 'CSM Pompa de Jabón (Película Delgada)',
  category: 'csm',
  icon: '🫧',
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
    roughnessMod: 0.005,
    metalnessMod: 0.0,
  },
  defaults: {
    roughness: 0.005,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 0.98,
    ior: 1.333,
    thickness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    iridescence: 1.0,
    iridescenceIOR: 1.333,
    iridescenceThicknessRange: [200, 750],
  },
  generate: () => fastSolidMaps('#ff26aa', 0.005, 0.0),
  thumbnail: () => _colorThumb('#ff26aa', '🫧', 'csm_soap_bubble'),
};

export const glassPrismDispersion: ProceduralMaterial = {
  id: 'glass_prism',
  name: 'Vidrio Espectral Cauchy (WebGPU)',
  category: 'glass_webgpu',
  icon: '🌈',
  isWebGPUGlass: true,
  webgpuGlass: {
    enabled: true,
    dispersion: 0.085,
    aberration: 0.05,
    rimGlow: 1.2,
    rimColor: '#a5b4fc',
    causticIntensity: 1.4,
  },
  defaults: {
    roughness: 0.02,
    metalness: 0.0,
    color: '#ffffff',
    transmission: 0.96,
    ior: 1.52,
    thickness: 1.2,
  },
  generate: () => fastSolidMaps('#e0e7ff', 0.02, 0.0),
  thumbnail: () => _colorThumb('#a5b4fc', '🌈', 'glass_prism'),
};

export const glassFrostedAcid: ProceduralMaterial = {
  id: 'glass_frosted',
  name: 'Vidrio Ácido Esmerilado (WebGPU)',
  category: 'glass_webgpu',
  icon: '🌫️',
  isWebGPUGlass: true,
  webgpuGlass: {
    enabled: true,
    frostedRoughness: 0.38,
    dispersion: 0.03,
    causticIntensity: 0.6,
  },
  defaults: {
    roughness: 0.32,
    metalness: 0.0,
    color: '#f8fafc',
    transmission: 0.88,
    ior: 1.48,
    thickness: 1.0,
  },
  generate: () => fastSolidMaps('#cbd5e1', 0.32, 0.0),
  thumbnail: () => _colorThumb('#cbd5e1', '🌫️', 'glass_frosted'),
};

export const glassEmeraldCaustic: ProceduralMaterial = {
  id: 'glass_emerald',
  name: 'Vidrio Esmeralda Cáusticas (WebGPU)',
  category: 'glass_webgpu',
  icon: '❇️',
  isWebGPUGlass: true,
  webgpuGlass: {
    enabled: true,
    dispersion: 0.06,
    rimGlow: 1.8,
    rimColor: '#34d399',
    causticIntensity: 2.2,
  },
  defaults: {
    roughness: 0.04,
    metalness: 0.0,
    color: '#064e3b',
    attenuationColor: '#059669',
    attenuationDistance: 0.8,
    transmission: 0.92,
    ior: 1.57,
    thickness: 1.5,
  },
  generate: () => fastSolidMaps('#059669', 0.04, 0.0),
  thumbnail: () => _colorThumb('#10b981', '❇️', 'glass_emerald'),
};

export const glassRubyDichroic: ProceduralMaterial = {
  id: 'glass_ruby',
  name: 'Vidrio Dicroico Rubí (WebGPU)',
  category: 'glass_webgpu',
  icon: '💎',
  isWebGPUGlass: true,
  webgpuGlass: {
    enabled: true,
    dispersion: 0.12,
    aberration: 0.08,
    rimGlow: 2.0,
    rimColor: '#f43f5e',
    causticIntensity: 1.8,
  },
  defaults: {
    roughness: 0.03,
    metalness: 0.0,
    color: '#881337',
    attenuationColor: '#e11d48',
    attenuationDistance: 0.6,
    transmission: 0.90,
    ior: 1.77,
    thickness: 1.6,
  },
  generate: () => fastSolidMaps('#e11d48', 0.03, 0.0),
  thumbnail: () => _colorThumb('#f43f5e', '💎', 'glass_ruby'),
};

export const glassSoapBubbleWebGPU: ProceduralMaterial = {
  id: 'glass_soap_bubble',
  name: 'Pompa de Jabón Espectral (WebGPU)',
  category: 'glass_webgpu',
  icon: '🫧',
  isWebGPUGlass: true,
  webgpuGlass: {
    enabled: true,
    preset: 'soap_bubble_spectral',
    dispersion: 0.14,
    chromaticAberration: 0.08,
    distortion: 0.015,
    distortionSpeed: 1.0,
    distortionFrequency: 2.0,
    frostedBlur: 0.0,
    rimGlow: 2.0,
    rimColor: '#ff26aa',
    thinFilmIridescence: 1.0,
    causticIntensity: 1.2,
  },
  defaults: {
    roughness: 0.005,
    metalness: 0.0,
    color: '#ffffff',
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
  },
  generate: () => fastSolidMaps('#ff26aa', 0.005, 0.0),
  thumbnail: () => _colorThumb('#ff26aa', '🫧', 'glass_soap_bubble'),
};

export const MATERIAL_LIBRARY: ProceduralMaterial[] = [
  // Custom Shader Materials (CSM)
  csmSoapBubble, csmWaves, csmShield, csmMagma, csmTwist,
  csmBioFlesh, csmQuantumCrystal, csmGlitch, csmComic,

  // WebGPU Glass Materials
  glassSoapBubbleWebGPU, glassPrismDispersion, glassFrostedAcid, glassEmeraldCaustic, glassRubyDichroic,

  // Wood & Organic (Substance 3D Core Collection)
  oakPlanks, walnut, pine, mahogany, varnishedWood,
  shouSugiBan, teakDeck, wovenBamboo, pressedCork,
  
  // Stone, Concretes & Masonry (Substance 3D Architectural)
  marble, marbleBlack, greenMarble, granite, slate, concrete, wetConcrete, compactBone,
  largeRock, cliffRock, mossyRock, volcanicRock, desertRock,
  formworkConcrete, venetianTerrazzo, rusticBrick, calacattaGold,
  
  // Metal & Alloys (Substance 3D PBR Metals)
  brushedSteel, brushedAluminum, rustedIron, chrome, copper, copperVerdigris, gold, galvanizedMetal,
  damascusSteel, oxidizedBronze, hammeredCastIron, scifiHullArmor,
  
  // Paint & Coatings
  carPaintRed, carPaintBlue, carPaintBlack, carPaintGreen, matteWhite, matteGray, carLacquer,
  
  // Textiles & Leathers
  velvetFabric, woolFabric, silkFabric, fabricCanvas, leather,
  distressedLeather, denimTwill,
  
  // Iridescent & Optical
  tornasolMetal, pearlIridescent,
  
  // Synthetic, Glazed & Ceramics
  carbonFiber, goldCarbonFiber, rubber, plasticGlossy, ceramicGlazed, naturalSponge,
  kintsugiCeramic, zelligeTiles, tacticalPolymer,
  
  // Ice & Snow Procedural PBR Collection (CGTrader / Natural)
  iceGlacial, iceFrosted, iceCracked, snowPowder, snowIceMelt,

  // Gaseous, Plasma, Fluids & Volumetric Elements (Raymarching 3D PBR)
  fireVolumetric, plasmaGas, cloudCumulus, smokeDense,
  darkStorm, cosmicNebula, auroraBoreal, liquidWaterVolume, activeMagmaCrust,

  // Ground & Terrain
  gravel, sand, asphalt, dirt, rockyGroundMoss,
];

export const MATERIAL_CATEGORIES = [
  { id: 'csm', label: 'Custom Shaders (CSM)', icon: '🌀' },
  { id: 'glass_webgpu', label: 'Vidrio Espectral & Cáusticas', icon: '💎' },
  { id: 'ice_snow', label: 'Hielo & Nieve', icon: '❄️' },
  { id: 'wood', label: 'Madera', icon: '🪵' },
  { id: 'stone', label: 'Piedra / Orgánico', icon: '🪨' },
  { id: 'metal', label: 'Metal', icon: '⚙️' },
  { id: 'paint', label: 'Pintura', icon: '🎨' },
  { id: 'textile', label: 'Textiles / Telas', icon: '🧣' },
  { id: 'iridescent', label: 'Iridiscentes', icon: '💿' },
  { id: 'synthetic', label: 'Sintético / Vidrio', icon: '🔬' },
  { id: 'gaseous', label: 'Volumétricos / Gases & Fuego', icon: '🔥' },
  { id: 'ground', label: 'Suelo', icon: '🌍' },
] as const;

const THUMBNAIL_CACHE = new Map<string, string>();

export function generateAllThumbnails(): Map<string, string> {
  if (THUMBNAIL_CACHE.size > 0) {
    return THUMBNAIL_CACHE;
  }
  for (const mat of MATERIAL_LIBRARY) {
    const thumb = mat.thumbnail ? mat.thumbnail() : _thumb(mat);
    THUMBNAIL_CACHE.set(mat.id, thumb);
  }
  return THUMBNAIL_CACHE;
}

/**
 * Genera o recupera del almacenamiento local persistente de forma selectiva.
 * NO regenera materiales existentes en disco. Carga instantánea a 0ms.
 */
export async function generateAllThumbnailsAsync(): Promise<Map<string, string>> {
  // Retornamos la caché en memoria RAM instantánea si el mapa ya está poblado en esta sesión
  if (THUMBNAIL_CACHE.size > 0) {
    return THUMBNAIL_CACHE;
  }

  // Pre-cargar inmediatamente todos los materiales que tienen thumbnail rápido sincrónico
  for (const mat of MATERIAL_LIBRARY) {
    if (mat.thumbnail) {
      try {
        const t = mat.thumbnail();
        THUMBNAIL_CACHE.set(mat.id, t);
      } catch {
        // Continue
      }
    }
  }

  // Procesar en lotes de 10 en paralelo para no bloquear el hilo principal
  const remaining = MATERIAL_LIBRARY.filter(m => !THUMBNAIL_CACHE.has(m.id));
  const batchSize = 10;
  for (let i = 0; i < remaining.length; i += batchSize) {
    const batch = remaining.slice(i, i + batchSize);
    await Promise.all(batch.map(async (mat) => {
      try {
        const cachedThumb = await loadMaterialFromDisk(mat.id);
        if (cachedThumb) {
          THUMBNAIL_CACHE.set(mat.id, cachedThumb);
        } else {
          const thumbUrl = mat.thumbnail ? mat.thumbnail() : _thumb(mat);
          saveMaterialToDisk(mat.id, thumbUrl).catch(() => {});
          THUMBNAIL_CACHE.set(mat.id, thumbUrl);
        }
      } catch {
        // Fallback rápido
        THUMBNAIL_CACHE.set(mat.id, _colorThumb(mat.defaults?.color || '#888888'));
      }
    }));
  }

  return THUMBNAIL_CACHE;
}

/**
 * Guarda de forma aislada y atómica un único material modificado o creado por el usuario.
 */
export async function saveOrUpdateSingleMaterial(customMat: ProceduralMaterial, generatedMaps: GeneratedMaps): Promise<void> {
  // Actualizar el array en memoria volátil
  const idx = MATERIAL_LIBRARY.findIndex(m => m.id === customMat.id);
  if (idx !== -1) {
    MATERIAL_LIBRARY[idx] = customMat;
  } else {
    MATERIAL_LIBRARY.push(customMat);
  }

  // Sobrescribir de forma aislada únicamente los mapas de este ID en IndexedDB
  const thumbUrl = customMat.thumbnail ? customMat.thumbnail() : generatedMaps.albedo;
  await saveMaterialToDisk(customMat.id, thumbUrl);
  await saveMaterialToDisk(`${customMat.id}_albedo`, generatedMaps.albedo);
  await saveMaterialToDisk(`${customMat.id}_normal`, generatedMaps.normal);
  await saveMaterialToDisk(`${customMat.id}_roughness`, generatedMaps.roughness);
  
  // Actualizar la caché en caliente de esta sesión para reflejar el cambio al instante
  THUMBNAIL_CACHE.set(customMat.id, thumbUrl);
}

/**
 * Registra de forma segura un nuevo material creado o importado por el usuario
 * en la biblioteca y lo escribe en el almacenamiento local.
 */
export async function registerNewUserMaterial(
  customMat: ProceduralMaterial,
  generatedMaps: GeneratedMaps
): Promise<void> {
  // Evitar duplicados en el array en tiempo de ejecución
  if (!MATERIAL_LIBRARY.some(m => m.id === customMat.id)) {
    MATERIAL_LIBRARY.push(customMat);
  }
  const thumbUrl = customMat.thumbnail ? customMat.thumbnail() : generatedMaps.albedo;
  // Guardar de forma persistente su miniatura y mapas
  await saveMaterialToDisk(customMat.id, thumbUrl);
  await saveMaterialToDisk(`${customMat.id}_thumb`, thumbUrl);
  await saveMaterialToDisk(`${customMat.id}_albedo`, generatedMaps.albedo);
  await saveMaterialToDisk(`${customMat.id}_normal`, generatedMaps.normal);
  await saveMaterialToDisk(`${customMat.id}_roughness`, generatedMaps.roughness);
  await saveMaterialToDisk(`${customMat.id}_metallic`, generatedMaps.metallic);
  THUMBNAIL_CACHE.set(customMat.id, thumbUrl);
}

/**
 * Aplica la configuración avanzada PBR soportando textiles, iridiscencia y translúcidos
 * asegurando el aislamiento completo de propiedades en Three.js.
 */
export function applyMaterialDefaults(
  def: ProceduralMaterial,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  threeMat: any,
  maps: GeneratedMaps,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  THREE: any
): void {
  const d = def.defaults;
  const loader = new THREE.TextureLoader();
  
  const load = (url: string, sRGB = false) => {
    if (!url) return null;
    const t = loader.load(url);
    t.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const tileX = Array.isArray(d.tiling) ? d.tiling[0] : (d.tiling ?? 1);
    const tileY = Array.isArray(d.tiling) ? d.tiling[1] : (d.tiling ?? 1);
    t.repeat.set(tileX, tileY);
    return t;
  };

  // 1. Asignación estándar de mapas PBR
  threeMat.map = load(maps.albedo, true);
  threeMat.normalMap = load(maps.normal);
  threeMat.roughnessMap = load(maps.roughness);
  threeMat.metalnessMap = load(maps.metallic);
  threeMat.aoMap = load(maps.ao);
  threeMat.displacementMap = load(maps.displacement);

  threeMat.roughness = d.roughness ?? 0.5;
  threeMat.metalness = d.metalness ?? 0.0;

  if (threeMat.normalScale && d.normalScale !== undefined) {
    threeMat.normalScale.setScalar(d.normalScale);
  }
  if (d.displacementScale !== undefined) {
    threeMat.displacementScale = d.displacementScale;
    threeMat.displacementBias = d.displacementBias ?? 0.0;
  }

  // 2. Clearcoat
  if (d.clearcoat !== undefined) {
    threeMat.clearcoat = d.clearcoat;
    threeMat.clearcoatRoughness = d.clearcoatRoughness ?? 0.1;
  } else {
    threeMat.clearcoat = 0.0;
    threeMat.clearcoatRoughness = 1.0;
  }

  // 3. CONFIGURACIÓN TEXTIL (TERCIOPELO / LANA / SEDA)
  if (d.sheen !== undefined) {
    threeMat.sheen = d.sheen;
    threeMat.sheenRoughness = d.sheenRoughness ?? 0.5;
    if (threeMat.sheenColor) {
      threeMat.sheenColor.set(d.sheenColor || '#ffffff');
    }
  } else {
    threeMat.sheen = 0.0;
  }

  // 4. CONFIGURACIÓN ÓPTICA (TORNASOL / IRIDISCENCIA)
  if (d.iridescence !== undefined) {
    threeMat.iridescence = d.iridescence;
    threeMat.iridescenceIOR = d.iridescenceIOR ?? 1.3;
    if (d.iridescenceThicknessRange) {
      threeMat.iridescenceThicknessRange = d.iridescenceThicknessRange;
    }
  } else {
    threeMat.iridescence = 0.0;
  }

  // 5. CONFIGURACIÓN TRANSLÚCIDA (HUESOS / CRISTALES)
  if (d.transmission !== undefined) {
    threeMat.transmission = d.transmission;
    threeMat.ior = d.ior ?? 1.5;
    threeMat.thickness = d.thickness ?? 0.0;
    threeMat.transparent = true;
  } else {
    threeMat.transmission = 0.0;
    threeMat.transparent = false;
  }

  // 6. Atenuar/Aumentar dinámicamente envMapIntensity según categoría
  if (def.category === 'wood' || def.category === 'ground' || def.category === 'textile' || (def.category === 'paint' && def.id.includes('matte'))) {
    threeMat.envMapIntensity = 0.25;
  } else if (def.id === 'chrome' || def.id === 'gold' || def.id === 'gold_carbon_fiber') {
    threeMat.envMapIntensity = 1.3;
  } else {
    threeMat.envMapIntensity = 1.0;
  }

  threeMat.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 2: PIPELINE DE FILTROS INTELIGENTES Y GENERADORES PBR AVANZADOS (MIXOS)
// ─────────────────────────────────────────────────────────────────────────────

export interface MixosFilters {
  rust: number;      // 0.0 a 1.0 (Corrosión porosa oxidada)
  scratches: number; // 0.0 a 1.0 (Incisiones que exponen metal o fondo)
  grime?: number;    // 0.0 a 1.0 (Polvo y suciedad acumulada en concavidades)
  dirt?: number;     // Alias para la interfaz UI
}

/**
 * Pipeline de Post-procesado Multicanal Inteligente.
 * Muta de forma síncrona todos los buffers PBR manteniendo el patrón infinito.
 */
export function applyMixosFiltersToBuffers(
  w: number, h: number,
  albedo: Uint8ClampedArray, normal: Uint8ClampedArray,
  roughness: Uint8ClampedArray, metallic: Uint8ClampedArray, ao: Uint8ClampedArray,
  settings: MixosFilters
): void {
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const px = i % w;
    const py = Math.floor(i / w);

    // Muestreo del mapa de ruido unificado de desgaste
    const filterNoise = getSeamlessFBM4D(px, py, w, h, 1.5, 4);

    // 1. FILTRO DE MUGRE Y POLVO (Grime / Curvature Wear / Dirt)
    const grimeLevel = settings.grime ?? settings.dirt ?? 0;
    if (grimeLevel > 0 && filterNoise > (1.2 - grimeLevel)) {
      const grimeFactor = (filterNoise - (1.2 - grimeLevel)) * 2.0;
      albedo[idx]     = Math.max(25, albedo[idx] * (1.0 - grimeFactor * 0.75)) | 0;
      albedo[idx + 1] = Math.max(22, albedo[idx + 1] * (1.0 - grimeFactor * 0.75)) | 0;
      albedo[idx + 2] = Math.max(18, albedo[idx + 2] * (1.0 - grimeFactor * 0.75)) | 0;
      roughness[idx]  = roughness[idx + 1] = roughness[idx + 2] = 230; // Mate absoluto
      ao[idx]         = ao[idx + 1]         = ao[idx + 2] = 70;         // Sombra de oclusión oscura
    }

    // 2. FILTRO DE ARAÑAZOS QUIRÚRGICOS (Scratches)
    if (settings.scratches > 0) {
      const scratchNoise = getSeamlessFBM4D(px, py, w, h, 14.0, 3); // Alta frecuencia direccional
      if (scratchNoise > 0.93 - settings.scratches * 0.07 && scratchNoise < 0.95) {
        // Exponer el material interno y raspar las normales del relieve
        albedo[idx] = albedo[idx + 1] = albedo[idx + 2] = Math.min(255, albedo[idx] + 70) | 0;
        normal[idx] = Math.min(255, normal[idx] + 50) | 0; // Desvía el canal X ante los focos
        roughness[idx] = roughness[idx + 1] = roughness[idx + 2] = 140;
      }
    }

    // 3. FILTRO DE ÓXIDO Y CORROSIÓN (Rust Smart Mask)
    if (settings.rust > 0 && filterNoise > (1.1 - settings.rust * 0.65)) {
      // Tono marrón óxido de cantera (#612d16)
      albedo[idx]     = 97;
      albedo[idx + 1] = 45;
      albedo[idx + 2] = 22;
      metallic[idx]   = metallic[idx + 1] = metallic[idx + 2] = 0;   // El óxido destruye el canal metálico
      roughness[idx]  = roughness[idx + 1] = roughness[idx + 2] = 245; // Porosidad máxima
    }
  }
}

/**
 * Adaptador Maestro de Generación. Integra el Toroide 4D con la inyección
 * de filtros PBR para compilar mapas Base64 óptimos e instantáneos.
 */
export function generateAdvancedPBRMaterial(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  material: any,
  w = 512, h = 512,
  filters: MixosFilters
): GeneratedMaps {
  const heightField = new Float32Array(w * h);
  const albedoBuffer = new Uint8ClampedArray(w * h * 4);
  const roughnessBuffer = new Uint8ClampedArray(w * h * 4);
  const metallicBuffer = new Uint8ClampedArray(w * h * 4);
  const aoBuffer = new Uint8ClampedArray(w * h * 4);

  for (let i = 0; i < w * h; i++) {
    const px = i % w;
    const py = Math.floor(i / w);
    const n = getSeamlessFBM4D(px, py, w, h, 2.0, 5);
    heightField[i] = Math.sin((px / w) * Math.PI * 4.0 + n * 5.0) * 0.5 + 0.5;

    const idx = i * 4;
    const c = (heightField[i] * 200 + 45) | 0;
    albedoBuffer[idx] = albedoBuffer[idx + 1] = albedoBuffer[idx + 2] = c;
    albedoBuffer[idx + 3] = 255;
    
    roughnessBuffer[idx] = roughnessBuffer[idx + 1] = roughnessBuffer[idx + 2] = (40 + (1.0 - n) * 30) | 0;
    metallicBuffer[idx] = metallicBuffer[idx + 1] = metallicBuffer[idx + 2] = material?.defaults?.metalness ? 255 : 0;
    aoBuffer[idx] = aoBuffer[idx + 1] = aoBuffer[idx + 2] = (180 + n * 75) | 0;
  }

  const normalBuffer = heightToNormalSeamless(heightField, w, h, 4.0);

  // Inyectar el motor de filtros multicanal en caliente
  applyMixosFiltersToBuffers(w, h, albedoBuffer, normalBuffer, roughnessBuffer, metallicBuffer, aoBuffer, filters);

  return {
    albedo: rgbaToDataURL(albedoBuffer, w, h),
    normal: rgbaToDataURL(normalBuffer, w, h),
    roughness: rgbaToDataURL(roughnessBuffer, w, h),
    metallic: rgbaToDataURL(metallicBuffer, w, h),
    ao: rgbaToDataURL(aoBuffer, w, h),
    displacement: rgbaToDataURL(grayFieldBuffer(heightField, w, h), w, h)
  };
}