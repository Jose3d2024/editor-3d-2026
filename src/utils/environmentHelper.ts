import * as THREE from 'three';
import { EnvironmentSettings, BackgroundMode } from '../types';
import { loadOptimizedEnvironmentTexture } from './hdrLoader';

export interface EnvTextures {
  envTexture: THREE.Texture | null;
  bgTexture: THREE.Texture | null;
  pmremTexture: THREE.Texture | null;
}

export const PRESET_HDRIS = [
  { id: 'polar_arctic',   name: 'Ártico Glacial', url: 'synthetic_polar_arctic', icon: '🧊', desc: 'Banquisa polar, icebergs cristalinos, cielo ártico y sol de hielo de alto rango dinámico' },
  { id: 'polar_aurora',   name: 'Aurora Boreal',  url: 'synthetic_polar_aurora', icon: '🌌', desc: 'Noche polar ártica con cortinas de aurora verde esmeralda y lago espejo congelado' },
  { id: 'polar_sunset',   name: 'Ocaso Polar',    url: 'synthetic_polar_sunset', icon: '❄️', desc: 'Sol rasante en el horizonte ártico, tonalidades ámbar/magenta y sombras cobalto' },
  { id: 'polar_ice_cave', name: 'Cueva de Hielo', url: 'synthetic_polar_ice_cave', icon: '🏔️', desc: 'Interior de caverna glaciar con haces de luz solar cenitales y hielo azul zafiro' },
  { id: 'polar_fjord',    name: 'Fiordo Glaciar', url: 'synthetic_polar_fjord', icon: '🌊', desc: 'Picos alpinos escarpados con glaciares cayendo a aguas oscuras y témpanos flotantes' },
  { id: 'polar_blizzard', name: 'Ventisca Polar', url: 'synthetic_polar_blizzard', icon: '🌨️', desc: 'Atmósfera gélida de niebla polar, luz difusa subcero y siluetas de hielo' },
  { id: 'studio_softbox', name: 'Estudio Softbox',url: null, icon: '📸', desc: 'Iluminación de estudio con softboxes neutras profesionales' },
  { id: 'sunset',         name: 'Atardecer Real', url: 'https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr', icon: '🌅', desc: 'Luz dorada cálida de atardecer real' },
  { id: 'urban',          name: 'Urbano Real',    url: 'https://threejs.org/examples/textures/equirectangular/pedestrian_overpass_1k.hdr', icon: '🏙️', desc: 'Reflejos de ciudad y luz natural' },
  { id: 'bridge',         name: 'Interior Real',  url: 'https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr', icon: '🏛️', desc: 'Luz difusa de galería/interior' },
  { id: 'night',          name: 'Noche Real',     url: 'https://threejs.org/examples/textures/equirectangular/moonless_golf_1k.hdr', icon: '🌙', desc: 'Contrastes fríos de noche despejada' },
  { id: 'quarry',         name: 'Estudio Neutro', url: 'https://threejs.org/examples/textures/equirectangular/quarry_01_1k.hdr', icon: '💡', desc: 'Luz ambiental suave de alto rango' },
];

/**
 * Procedural Fractal Brownian Motion (FBM) noise helper for realistic clouds, mountains & terrain.
 */
function fbmNoise(x: number, y: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1.0;
  for (let i = 0; i < octaves; i++) {
    const s = Math.sin(x * freq * 1.3 + y * freq * 0.7) * Math.cos(x * freq * 0.9 - y * freq * 1.4);
    val += s * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return val;
}

/**
 * Creates an ultra-high-fidelity 2048x1024 Polar/Arctic Equirectangular HDRI map.
 * Generates photorealistic 360° celestial dome, mountain ranges, crystalline icebergs,
 * solar flares, glowing auroras, and specular ground reflections.
 */
export function createPolarEquirectangularCanvas(
  preset: 'arctic' | 'aurora' | 'sunset' | 'ice_cave' | 'fjord' | 'blizzard' = 'arctic'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const w = canvas.width;
  const h = canvas.height;
  const horizonY = h * 0.52;

  if (preset === 'aurora') {
    // ══════════════════════════════════════════════════════════════════════════
    // 1. NOCHE POLAR & AURORA BOREAL ESMERALDA (2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    // Cielo Ártico Profundo
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#01050e');
    skyGrad.addColorStop(0.3, '#030c1d');
    skyGrad.addColorStop(0.65, '#05192b');
    skyGrad.addColorStop(0.88, '#08333b');
    skyGrad.addColorStop(1, '#0c4d48');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Vía Láctea / Polvo Estelar Galáctico
    const nebulaGrad = ctx.createRadialGradient(w * 0.6, horizonY * 0.35, 10, w * 0.6, horizonY * 0.35, 600);
    nebulaGrad.addColorStop(0, 'rgba(120, 180, 255, 0.12)');
    nebulaGrad.addColorStop(0.5, 'rgba(147, 51, 234, 0.08)');
    nebulaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = nebulaGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Campo Estelar Denso (Estrellas nítidas con variación cromática)
    for (let i = 0; i < 450; i++) {
      const sx = (Math.sin(i * 137.5) * 0.5 + 0.5) * w;
      const sy = (Math.cos(i * 93.1) * 0.5 + 0.5) * (horizonY * 0.88);
      const sr = (i % 9 === 0 ? 1.8 : i % 3 === 0 ? 1.2 : 0.7);
      const starColor = i % 5 === 0 ? '#93c5fd' : i % 7 === 0 ? '#fef08a' : '#ffffff';
      ctx.fillStyle = starColor;
      ctx.globalAlpha = 0.5 + (Math.sin(i) * 0.5 + 0.5) * 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Luna Llena Ártica
    const moonX = w * 0.78;
    const moonY = horizonY * 0.28;
    const moonHalo = ctx.createRadialGradient(moonX, moonY, 12, moonX, moonY, 180);
    moonHalo.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    moonHalo.addColorStop(0.1, 'rgba(219, 234, 254, 0.6)');
    moonHalo.addColorStop(0.4, 'rgba(147, 197, 253, 0.2)');
    moonHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = moonHalo;
    ctx.fillRect(moonX - 200, moonY - 200, 400, 400);

    // Cortinas Ondulantes de Aurora Boreal (Multicapa con rayos verticales)
    const auroraCurtains = [
      { startY: 100, colorA: 'rgba(34, 197, 94, 0.75)', colorB: 'rgba(56, 189, 248, 0.45)', colorC: 'rgba(168, 85, 247, 0.35)', height: 220, freq: 0.006 },
      { startY: 180, colorA: 'rgba(74, 222, 128, 0.85)', colorB: 'rgba(6, 182, 212, 0.55)', colorC: 'rgba(217, 70, 239, 0.40)', height: 260, freq: 0.009 },
      { startY: 260, colorA: 'rgba(52, 211, 153, 0.70)', colorB: 'rgba(14, 165, 233, 0.35)', colorC: 'rgba(147, 51, 234, 0.20)', height: 200, freq: 0.013 },
    ];

    auroraCurtains.forEach((c, idx) => {
      ctx.beginPath();
      ctx.moveTo(0, c.startY);
      for (let x = 0; x <= w; x += 12) {
        const w1 = Math.sin(x * c.freq + idx * 1.7) * 70;
        const w2 = Math.cos(x * c.freq * 2.3 - idx * 0.9) * 35;
        const w3 = Math.sin(x * 0.002) * 50;
        ctx.lineTo(x, c.startY + w1 + w2 + w3);
      }
      ctx.lineTo(w, c.startY + c.height);
      ctx.lineTo(0, c.startY + c.height);
      ctx.closePath();

      const aGrad = ctx.createLinearGradient(0, c.startY - 30, 0, c.startY + c.height);
      aGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      aGrad.addColorStop(0.25, c.colorA);
      aGrad.addColorStop(0.65, c.colorB);
      aGrad.addColorStop(0.9, c.colorC);
      aGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = aGrad;
      ctx.fill();

      // Rayos verticales luminosos (Striations de la aurora)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      for (let rx = 0; rx < w; rx += 28) {
        if ((rx + idx * 17) % 7 === 0) {
          ctx.fillRect(rx, c.startY - 20, 14, c.height + 40);
        }
      }
    });

    // Siluetas de Montañas Glaciares con Cimas Nevadas
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 8) {
      const peak = Math.sin(x * 0.008) * 65 + Math.cos(x * 0.022) * 35 + Math.sin(x * 0.045) * 15;
      ctx.lineTo(x, horizonY - Math.max(0, peak));
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fillStyle = '#051824';
    ctx.fill();

    // Brillos de Nieve en las Cimas iluminadas por la Aurora
    ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
    for (let x = 0; x <= w; x += 16) {
      const peak = Math.sin(x * 0.008) * 65 + Math.cos(x * 0.022) * 35 + Math.sin(x * 0.045) * 15;
      if (peak > 40) {
        ctx.fillRect(x, horizonY - peak, 12, 14);
      }
    }

    // Suelo: Lago Espejo Glaciar y Banquisa Polar
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, '#0a323b');
    groundGrad.addColorStop(0.18, '#062029');
    groundGrad.addColorStop(0.5, '#04151c');
    groundGrad.addColorStop(1, '#02090e');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Reflejo Espejo de la Aurora en el Hielo
    const reflGrad = ctx.createLinearGradient(0, horizonY, 0, horizonY + 280);
    reflGrad.addColorStop(0, 'rgba(74, 222, 128, 0.45)');
    reflGrad.addColorStop(0.4, 'rgba(6, 182, 212, 0.25)');
    reflGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = reflGrad;
    ctx.fillRect(0, horizonY, w, 280);

    // Bloques de Banquisa de Hielo y Grietas Reflectantes
    for (let i = 0; i < 40; i++) {
      const bx = (i * 89) % w;
      const by = horizonY + 25 + (i * 31) % (h - horizonY - 60);
      const bw = 60 + (i * 29) % 180;
      const bh = 6 + (i * 7) % 16;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.fillRect(bx, by, bw, 2);
    }
  } else if (preset === 'sunset') {
    // ══════════════════════════════════════════════════════════════════════════
    // 2. OCASO POLAR / SOL RASANTE ÁRTICO (2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    // Cielo Crepuscular Cromático
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#0c1329');
    skyGrad.addColorStop(0.22, '#28113e');
    skyGrad.addColorStop(0.45, '#5c1348');
    skyGrad.addColorStop(0.72, '#9a1a3e');
    skyGrad.addColorStop(0.88, '#e14a2b');
    skyGrad.addColorStop(1, '#ff9033');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Cirros de Nube Teñidos de Fuego Ártico
    for (let c = 0; c < 6; c++) {
      const cy = 60 + c * 50;
      const cGrad = ctx.createLinearGradient(0, cy, 0, cy + 30);
      cGrad.addColorStop(0, 'rgba(255, 140, 60, 0.35)');
      cGrad.addColorStop(0.5, 'rgba(244, 63, 94, 0.25)');
      cGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = cGrad;
      ctx.fillRect(0, cy, w, 30);
    }

    // Sol Polar Gigante en el Horizonte con Resplandor Incandescente
    const sunX = w * 0.46;
    const sunY = horizonY - 12;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 450);
    sunGlow.addColorStop(0, 'rgba(255, 255, 250, 1.0)');
    sunGlow.addColorStop(0.08, 'rgba(255, 235, 150, 0.98)');
    sunGlow.addColorStop(0.25, 'rgba(255, 130, 45, 0.85)');
    sunGlow.addColorStop(0.6, 'rgba(225, 29, 72, 0.40)');
    sunGlow.addColorStop(0.85, 'rgba(120, 20, 80, 0.15)');
    sunGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, w, horizonY + 120);

    // Disco Solar Ultrabrillante
    ctx.beginPath();
    ctx.ellipse(sunX, sunY, 32, 28, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#fef08a';
    ctx.shadowBlur = 40;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cordillera de Montañas Negras y Violetas en el Horizonte
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const peak = Math.sin(x * 0.007) * 45 + Math.sin(x * 0.03) * 25 + Math.cos(x * 0.06) * 12;
      ctx.lineTo(x, horizonY - Math.abs(peak));
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fillStyle = '#2d0c2c';
    ctx.fill();

    // Bordes Dorados en las Montañas a Contraluz
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const peak = Math.sin(x * 0.007) * 45 + Math.sin(x * 0.03) * 25 + Math.cos(x * 0.06) * 12;
      ctx.lineTo(x, horizonY - Math.abs(peak));
    }
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Suelo: Banquisa Polar con Sombras Largas de Cobalto y Dunas de Nieve
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, '#7c2538');
    groundGrad.addColorStop(0.18, '#44193b');
    groundGrad.addColorStop(0.5, '#1e142e');
    groundGrad.addColorStop(1, '#0e0b1c');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Camino Solar Especular en el Hielo / Agua Líquida
    const sunRoad = ctx.createRadialGradient(sunX, horizonY + 80, 10, sunX, horizonY + 180, 500);
    sunRoad.addColorStop(0, 'rgba(255, 230, 150, 0.90)');
    sunRoad.addColorStop(0.25, 'rgba(255, 120, 50, 0.55)');
    sunRoad.addColorStop(0.65, 'rgba(180, 40, 80, 0.20)');
    sunRoad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sunRoad;
    ctx.fillRect(0, horizonY, w, h - horizonY);
  } else if (preset === 'ice_cave') {
    // ══════════════════════════════════════════════════════════════════════════
    // 3. CAVERNA GLACIAR AZUL ZAFIRO (2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    // Domo 360 de Hielo Glaciar Translúcido
    const caveGrad = ctx.createLinearGradient(0, 0, 0, h);
    caveGrad.addColorStop(0, '#02182b');
    caveGrad.addColorStop(0.2, '#043b63');
    caveGrad.addColorStop(0.48, '#0873a4');
    caveGrad.addColorStop(0.68, '#065077');
    caveGrad.addColorStop(1, '#011220');
    ctx.fillStyle = caveGrad;
    ctx.fillRect(0, 0, w, h);

    // Haces de Luz Cenital Solar penetrando a través de grietas del glaciar
    for (let c = 0; c < 7; c++) {
      const cx = 180 + c * 270;
      const beamGrad = ctx.createRadialGradient(cx, 100, 10, cx, 320, 260);
      beamGrad.addColorStop(0, 'rgba(240, 253, 255, 1.0)');
      beamGrad.addColorStop(0.2, 'rgba(186, 230, 253, 0.75)');
      beamGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.35)');
      beamGrad.addColorStop(0.85, 'rgba(2, 132, 199, 0.12)');
      beamGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(cx - 280, 0, 560, 500);

      // Columna de luz vertical
      const colGrad = ctx.createLinearGradient(cx - 40, 0, cx + 40, h);
      colGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
      colGrad.addColorStop(0.5, 'rgba(125, 211, 252, 0.25)');
      colGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = colGrad;
      ctx.fillRect(cx - 40, 0, 80, h);
    }

    // Carámbanos y Columnas de Hielo Colgantes
    ctx.fillStyle = 'rgba(224, 242, 254, 0.65)';
    for (let i = 0; i < 90; i++) {
      const ix = (i * 23) % w;
      const ilen = 30 + (i * 13) % 110;
      ctx.beginPath();
      ctx.moveTo(ix, 0);
      ctx.lineTo(ix + 6, ilen);
      ctx.lineTo(ix + 12, 0);
      ctx.closePath();
      ctx.fill();
    }

    // Cáusticas y Refracciones Brillantes en el Suelo Mojado
    for (let i = 0; i < 50; i++) {
      const rx = (i * 47) % w;
      const ry = h * 0.6 + (i * 19) % (h * 0.35);
      const rw = 25 + (i * 9) % 70;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(rx, ry, rw, 3);
    }
  } else if (preset === 'fjord') {
    // ══════════════════════════════════════════════════════════════════════════
    // 4. FIORDO GLACIAR & MONTAÑAS ALPINAS (2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#0c2747');
    skyGrad.addColorStop(0.35, '#1d4e7d');
    skyGrad.addColorStop(0.7, '#4384b6');
    skyGrad.addColorStop(0.9, '#93c5fd');
    skyGrad.addColorStop(1, '#e0f2fe');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Picos Alpinos Escarpados en Capas (Profundidad Atmosférica)
    // Capa 1: Lejana
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 12) {
      const hFar = Math.sin(x * 0.005) * 80 + Math.sin(x * 0.02) * 40;
      ctx.lineTo(x, horizonY - Math.abs(hFar));
    }
    ctx.lineTo(w, horizonY);
    ctx.fillStyle = '#7ba9cf';
    ctx.fill();

    // Capa 2: Media
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const hMid = Math.sin(x * 0.012 + 1.2) * 110 + Math.cos(x * 0.035) * 50;
      ctx.lineTo(x, horizonY - Math.abs(hMid));
    }
    ctx.lineTo(w, horizonY);
    ctx.fillStyle = '#2b5f88';
    ctx.fill();

    // Nieve en Cimas de Montaña
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const hMid = Math.sin(x * 0.012 + 1.2) * 110 + Math.cos(x * 0.035) * 50;
      if (hMid > 60) {
        ctx.lineTo(x, horizonY - Math.abs(hMid));
      } else {
        ctx.lineTo(x, horizonY);
      }
    }
    ctx.lineTo(w, horizonY);
    ctx.fillStyle = '#f0f9ff';
    ctx.fill();

    // Sol Polar Alto con Rayos
    const sunX = w * 0.35;
    const sunY = horizonY * 0.32;
    const sunGrad = ctx.createRadialGradient(sunX, sunY, 5, sunX, sunY, 320);
    sunGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    sunGrad.addColorStop(0.12, 'rgba(254, 240, 138, 0.95)');
    sunGrad.addColorStop(0.35, 'rgba(186, 230, 253, 0.65)');
    sunGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.2)');
    sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Agua Oscura del Fiordo y Reflejos
    const fjordWater = ctx.createLinearGradient(0, horizonY, 0, h);
    fjordWater.addColorStop(0, '#103957');
    fjordWater.addColorStop(0.2, '#0c273e');
    fjordWater.addColorStop(0.6, '#061726');
    fjordWater.addColorStop(1, '#020b13');
    ctx.fillStyle = fjordWater;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Icebergs Flotando en el Fiordo
    for (let i = 0; i < 25; i++) {
      const ix = (i * 97) % w;
      const iy = horizonY + 15 + (i * 23) % (h - horizonY - 40);
      const iw = 40 + (i * 17) % 110;
      const ih = 15 + (i * 7) % 35;
      
      // Bloque de hielo
      ctx.fillStyle = '#dbeafe';
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + iw * 0.5, iy - ih);
      ctx.lineTo(ix + iw, iy);
      ctx.closePath();
      ctx.fill();

      // Base turquesa sumergida
      ctx.fillStyle = 'rgba(6, 182, 212, 0.45)';
      ctx.fillRect(ix, iy, iw, 10);
    }
  } else if (preset === 'blizzard') {
    // ══════════════════════════════════════════════════════════════════════════
    // 5. VENTISCA & NIEBLA POLAR ÁRTICA (2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    const fogGrad = ctx.createLinearGradient(0, 0, 0, h);
    fogGrad.addColorStop(0, '#64748b');
    fogGrad.addColorStop(0.3, '#94a3b8');
    fogGrad.addColorStop(0.52, '#cbd5e1');
    fogGrad.addColorStop(0.7, '#94a3b8');
    fogGrad.addColorStop(1, '#475569');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, w, h);

    // Sol Velado a través de la Niebla de Hielo
    const sunX = w * 0.5;
    const sunY = horizonY * 0.4;
    const diffuseSun = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 350);
    diffuseSun.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    diffuseSun.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
    diffuseSun.addColorStop(0.7, 'rgba(226, 232, 240, 0.2)');
    diffuseSun.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = diffuseSun;
    ctx.fillRect(0, 0, w, horizonY);

    // Partículas de Nieve en Suspensión
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let i = 0; i < 300; i++) {
      const px = (i * 41) % w;
      const py = (i * 17) % h;
      const pr = 1 + (i % 3);
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // ══════════════════════════════════════════════════════════════════════════
    // 6. ÁRTICO GLACIAL PROFUNDO & ICEBERGS MONUMENTALES (DEFAULT 2048x1024)
    // ══════════════════════════════════════════════════════════════════════════
    // Cielo de Dispersión Rayleigh Subcero Puro
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#061a33');
    skyGrad.addColorStop(0.2, '#0f3c66');
    skyGrad.addColorStop(0.5, '#256fa4');
    skyGrad.addColorStop(0.78, '#70b4e0');
    skyGrad.addColorStop(0.92, '#bfe1f7');
    skyGrad.addColorStop(1, '#edf7fd');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, horizonY);

    // Cirros Finos de Cristales de Hielo en la Estratósfera
    for (let c = 0; c < 5; c++) {
      const cy = 40 + c * 60;
      const cGrad = ctx.createLinearGradient(0, cy, 0, cy + 35);
      cGrad.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
      cGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0.20)');
      cGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = cGrad;
      ctx.fillRect(0, cy, w, 35);
    }

    // Sol Polar de Alto Rango Dinámico (HDR Key Light)
    const sunX = w * 0.32;
    const sunY = horizonY * 0.38;

    // Resplandor Ambiental y Corona Solar
    const sunHalo = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 380);
    sunHalo.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    sunHalo.addColorStop(0.08, 'rgba(255, 252, 230, 0.98)');
    sunHalo.addColorStop(0.22, 'rgba(219, 240, 254, 0.75)');
    sunHalo.addColorStop(0.55, 'rgba(125, 211, 252, 0.30)');
    sunHalo.addColorStop(0.85, 'rgba(56, 189, 248, 0.10)');
    sunHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sunHalo;
    ctx.fillRect(0, 0, w, horizonY + 80);

    // Puntas de Difracción en Cruz del Sol (4-Point Star Glare)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(sunX - 180, sunY - 1.5, 360, 3);
    ctx.fillRect(sunX - 1.5, sunY - 140, 3, 280);

    // Núcleo Solar Blanqueado
    ctx.beginPath();
    ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 30;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cordillera Lejana de Montañas Glaciares con Haze Azulado
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const peak = Math.sin(x * 0.006) * 55 + Math.cos(x * 0.018) * 30 + Math.sin(x * 0.04) * 15;
      ctx.lineTo(x, horizonY - Math.max(0, peak));
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fillStyle = '#a2d2f2';
    ctx.fill();

    // Sombra Cían en Laderas Opuestas al Sol
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= w; x += 10) {
      const peak = Math.sin(x * 0.006) * 55 + Math.cos(x * 0.018) * 30 + Math.sin(x * 0.04) * 15;
      if (x % 20 < 10) {
        ctx.lineTo(x, horizonY - Math.max(0, peak));
      } else {
        ctx.lineTo(x, horizonY);
      }
    }
    ctx.lineTo(w, horizonY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(14, 116, 180, 0.45)';
    ctx.fill();

    // Grandes Formaciones de Icebergs en Primer y Segundo Plano
    const icebergs = [
      { x: w * 0.15, w: 220, h: 140, deepCyan: '#0284c7' },
      { x: w * 0.55, w: 310, h: 180, deepCyan: '#0369a1' },
      { x: w * 0.82, w: 260, h: 130, deepCyan: '#0891b2' },
    ];

    icebergs.forEach(berg => {
      // Cuerpo del Iceberg
      ctx.beginPath();
      ctx.moveTo(berg.x, horizonY);
      ctx.lineTo(berg.x + berg.w * 0.25, horizonY - berg.h * 0.7);
      ctx.lineTo(berg.x + berg.w * 0.45, horizonY - berg.h);
      ctx.lineTo(berg.x + berg.w * 0.75, horizonY - berg.h * 0.85);
      ctx.lineTo(berg.x + berg.w, horizonY);
      ctx.closePath();

      // Faceta Iluminada (Blanco Nieve)
      const bergGrad = ctx.createLinearGradient(berg.x, horizonY - berg.h, berg.x + berg.w, horizonY);
      bergGrad.addColorStop(0, '#ffffff');
      bergGrad.addColorStop(0.4, '#e0f2fe');
      bergGrad.addColorStop(0.85, '#7dd3fc');
      bergGrad.addColorStop(1, berg.deepCyan);
      ctx.fillStyle = bergGrad;
      ctx.fill();

      // Grietas y Facetas de Hielo Translúcido en Sombra
      ctx.beginPath();
      ctx.moveTo(berg.x + berg.w * 0.45, horizonY - berg.h);
      ctx.lineTo(berg.x + berg.w * 0.55, horizonY - berg.h * 0.4);
      ctx.lineTo(berg.x + berg.w, horizonY);
      ctx.lineTo(berg.x + berg.w * 0.75, horizonY - berg.h * 0.85);
      ctx.closePath();
      ctx.fillStyle = 'rgba(2, 132, 199, 0.65)';
      ctx.fill();
    });

    // Suelo: Banquisa Polar, Nieve Virgen y Leads de Agua Marina Ártica
    const groundGrad = ctx.createLinearGradient(0, horizonY, 0, h);
    groundGrad.addColorStop(0, '#f0f9ff');
    groundGrad.addColorStop(0.15, '#dbeafe');
    groundGrad.addColorStop(0.45, '#93c5fd');
    groundGrad.addColorStop(0.8, '#1d4ed8');
    groundGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Camino Solar Especular Brillante en el Hielo
    const sunSpecularRoad = ctx.createRadialGradient(sunX, horizonY + 60, 10, sunX, horizonY + 220, 480);
    sunSpecularRoad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    sunSpecularRoad.addColorStop(0.2, 'rgba(224, 242, 254, 0.65)');
    sunSpecularRoad.addColorStop(0.5, 'rgba(56, 189, 248, 0.25)');
    sunSpecularRoad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sunSpecularRoad;
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // Grietas y Bloques de Banquisa Flotante con Borde Escarchado
    for (let i = 0; i < 45; i++) {
      const ix = (i * 73) % w;
      const iy = horizonY + 15 + (i * 29) % (h - horizonY - 40);
      const iw = 50 + (i * 23) % 150;
      const ih = 4 + (i * 3) % 10;
      
      // Grieta azul oscuro/turquesa
      ctx.fillStyle = 'rgba(3, 105, 161, 0.55)';
      ctx.fillRect(ix, iy, iw, ih);

      // Borde de nieve brillante
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(ix, iy, iw, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a synthetic HDRI equirectangular canvas texture with realistic studio softboxes.
 */
export function createStudioEquirectangularCanvas(preset: 'softbox' | 'warm' | 'cool' = 'softbox'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Base background studio gradient
  const baseGrad = ctx.createLinearGradient(0, 0, 0, 512);
  if (preset === 'warm') {
    baseGrad.addColorStop(0, '#2b2422');
    baseGrad.addColorStop(0.5, '#3d322d');
    baseGrad.addColorStop(1, '#191513');
  } else if (preset === 'cool') {
    baseGrad.addColorStop(0, '#19212e');
    baseGrad.addColorStop(0.5, '#283446');
    baseGrad.addColorStop(1, '#0f141e');
  } else {
    baseGrad.addColorStop(0, '#22252c');
    baseGrad.addColorStop(0.5, '#353945');
    baseGrad.addColorStop(1, '#14161a');
  }
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, 1024, 512);

  // Key Light Softbox (Top-Left)
  const keyGrad = ctx.createRadialGradient(280, 160, 10, 280, 160, 200);
  keyGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  keyGrad.addColorStop(0.35, 'rgba(255, 253, 248, 0.85)');
  keyGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = keyGrad;
  ctx.fillRect(80, 0, 400, 360);

  // Softbox rect outline reflection
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 4;
  ctx.strokeRect(180, 80, 200, 160);

  // Fill Light Softbox (Top-Right, softer, cooler)
  const fillGrad = ctx.createRadialGradient(760, 200, 10, 760, 200, 220);
  fillGrad.addColorStop(0, 'rgba(215, 230, 255, 0.85)');
  fillGrad.addColorStop(0.5, 'rgba(180, 205, 240, 0.4)');
  fillGrad.addColorStop(1, 'rgba(140, 175, 220, 0)');
  ctx.fillStyle = fillGrad;
  ctx.fillRect(540, 20, 440, 380);

  ctx.strokeStyle = 'rgba(180, 210, 255, 0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(660, 110, 200, 180);

  // Rim Light (Bottom backlight / reflector)
  const rimGrad = ctx.createRadialGradient(512, 380, 5, 512, 380, 180);
  rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
  rimGrad.addColorStop(0.5, 'rgba(200, 215, 240, 0.2)');
  rimGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rimGrad;
  ctx.fillRect(332, 260, 360, 240);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a clean studio gradient background.
 */
export function createStudioGradientBackground(baseColor = '#181921'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const rad = ctx.createRadialGradient(256, 200, 10, 256, 256, 360);
  rad.addColorStop(0, '#353945');
  rad.addColorStop(0.45, '#1e2029');
  rad.addColorStop(1, '#0c0d12');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Uniformly applies environment lighting, HDRI reflections, background mode, blur, rotation and exposure to a Three.js scene.
 */
export async function setupSceneEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  env: EnvironmentSettings
): Promise<EnvTextures> {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  let envTexture: THREE.Texture | null = null;
  let isCustomHDRI = false;

  if (env.hdriUrl) {
    if (env.hdriUrl.startsWith('synthetic_polar_') || env.hdriUrl.startsWith('polar_')) {
      const typeKey = env.hdriUrl.replace('synthetic_polar_', '').replace('polar_', '');
      const presetType = (
        typeKey === 'aurora' ? 'aurora' : 
        typeKey === 'sunset' ? 'sunset' : 
        typeKey === 'ice_cave' ? 'ice_cave' : 
        typeKey === 'fjord' ? 'fjord' :
        typeKey === 'blizzard' ? 'blizzard' :
        'arctic'
      );
      envTexture = createPolarEquirectangularCanvas(presetType);
      isCustomHDRI = true;
    } else {
      try {
        envTexture = await loadOptimizedEnvironmentTexture(env.hdriUrl, { maxDimension: env.maxResolution || 2048 });
        isCustomHDRI = true;
      } catch (e) {
        console.warn('Failed loading HDRI, using synthetic studio HDRI canvas:', e);
      }
    }
  }

  let bgMode: BackgroundMode = env.backgroundMode ?? (env.backgroundVisible ? 'HDRI' : 'GRADIENT');
  if (env.backgroundVisible === false && bgMode === 'HDRI') {
    bgMode = 'GRADIENT';
  }

  // Create synthetic studio HDRI canvas if no custom HDRI texture exists
  if (!envTexture) {
    envTexture = createStudioEquirectangularCanvas('softbox');
  }

  let pmremTexture: THREE.Texture | null = null;
  const currentIntensity = env.intensity ?? 1.2;

  // Set environment probe for realistic PBR reflections & transmissions
  if (envTexture && currentIntensity > 0) {
    pmremTexture = pmremGenerator.fromEquirectangular(envTexture).texture;
    scene.environment = pmremTexture;
    scene.environmentIntensity = currentIntensity;
  } else {
    scene.environment = null;
    scene.environmentIntensity = 0;
  }

  renderer.toneMappingExposure = env.exposure ?? 1.1;

  // Rotations
  const rotRad = ((env.rotation ?? 0) * Math.PI) / 180;
  scene.environmentRotation.set(0, rotRad, 0);
  scene.backgroundRotation.set(0, rotRad, 0);

  let bgTexture: THREE.Texture | null = null;

  if (bgMode === 'HDRI') {
    if (envTexture) {
      envTexture.mapping = THREE.EquirectangularReflectionMapping;
      envTexture.generateMipmaps = true;
      envTexture.needsUpdate = true;
      scene.background = envTexture;
    } else if (pmremTexture) {
      scene.background = pmremTexture;
    }
    scene.backgroundBlurriness = env.backgroundBlur ?? 0;
    scene.backgroundIntensity = env.backgroundIntensity ?? 1.0;
  } else if (bgMode === 'GRADIENT') {
    bgTexture = createStudioGradientBackground(env.backgroundColor || '#181921');
    scene.background = bgTexture;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = env.backgroundIntensity ?? 1.0;
  } else if (bgMode === 'COLOR') {
    scene.background = new THREE.Color(env.backgroundColor || '#16171d');
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = env.backgroundIntensity ?? 1.0;
  } else if (bgMode === 'TRANSPARENT') {
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
  }

  pmremGenerator.dispose();

  return {
    envTexture: isCustomHDRI ? envTexture : null,
    bgTexture,
    pmremTexture,
  };
}
