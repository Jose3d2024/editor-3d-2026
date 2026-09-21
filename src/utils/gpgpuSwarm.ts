import * as THREE from 'three';
import { GpgpuSwarmConfig, GpgpuSwarmMode, GpgpuMeshTarget, GpgpuMouseMode, CSGObject, V3 } from '../types';

export const DEFAULT_GPGPU_SWARM_CONFIG: GpgpuSwarmConfig = {
  enabled: true,
  mode: 'curl_noise',
  count: 32000,
  particleSize: 2.0,
  noiseFrequency: 0.45,
  noiseSpeed: 0.7,
  curlOctaves: 2,
  attractionStrength: 1.2,
  swirlForce: 2.2,
  damping: 0.94,
  speed: 1.0,
  boundingRadius: 8.0,
  particleShape: 'glow_disc',
  colorStart: '#38bdf8',
  colorEnd: '#c084fc',
  colorMode: 'velocity',
  opacity: 0.85,
  blending: 'additive',
  interactiveMouse: true,
  mouseMode: 'attract',
  mouseForce: 4.5,
  mouseRadius: 4.0,
  trailLength: 1.0,
  velocityStretch: 0.2,
  lightReactivity: 0.5,
  meshTarget: 'none',
  surfaceAttraction: 0.8,
  surfaceDispersion: 0.4,
  pulseSpeed: 1.2,
  pulseAmplitude: 0.15,
  lorenzSigma: 10.0,
  lorenzRho: 28.0,
  lorenzBeta: 2.666,
};

export interface GpgpuSwarmPreset {
  id: string;
  name: string;
  desc: string;
  icon: string;
  config: Partial<GpgpuSwarmConfig>;
}

export const GPGPU_SWARM_PRESETS: GpgpuSwarmPreset[] = [
  {
    id: 'cosmic_nebula',
    name: 'Nebulosa Cósmica (Curl Noise)',
    desc: '32,000 partículas en filamentos fluidos y vórtices orgánicos',
    icon: '🌌',
    config: {
      mode: 'curl_noise',
      meshTarget: 'none',
      count: 32000,
      particleSize: 2.0,
      noiseFrequency: 0.45,
      noiseSpeed: 0.65,
      curlOctaves: 3,
      attractionStrength: 1.2,
      swirlForce: 2.5,
      colorStart: '#38bdf8',
      colorEnd: '#c084fc',
      colorMode: 'velocity',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.82,
    }
  },
  {
    id: 'stanford_bunny_morph',
    name: 'Morfosis 3D: Stanford Bunny',
    desc: 'Partículas que convergen y esculpen la silueta 3D del Stanford Bunny',
    icon: '🐇',
    config: {
      mode: 'mesh_surface',
      meshTarget: 'stanford_bunny',
      surfaceAttraction: 0.85,
      surfaceDispersion: 0.35,
      count: 45000,
      particleSize: 1.8,
      noiseFrequency: 0.6,
      noiseSpeed: 0.8,
      swirlForce: 1.5,
      colorStart: '#38bdf8',
      colorEnd: '#f472b6',
      colorMode: 'position',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.84,
      lightReactivity: 0.45,
    }
  },
  {
    id: 'suzanne_monkey_flow',
    name: 'Morfosis 3D: Suzanne Monkey',
    desc: 'Flujo volumétrico que dibuja la icónica malla de Suzanne con iluminación 3D',
    icon: '🐵',
    config: {
      mode: 'mesh_surface',
      meshTarget: 'suzanne',
      surfaceAttraction: 0.88,
      surfaceDispersion: 0.3,
      count: 40000,
      particleSize: 1.9,
      noiseFrequency: 0.5,
      noiseSpeed: 0.7,
      swirlForce: 1.2,
      colorStart: '#00f5ff',
      colorEnd: '#ff007f',
      colorMode: 'aurora',
      particleShape: 'lit_sphere',
      blending: 'additive',
      opacity: 0.85,
      lightReactivity: 0.6,
    }
  },
  {
    id: 'black_hole_vortex',
    name: 'Vórtice & Agujero Negro (Black Hole)',
    desc: 'Disco de acreción gravitatorio con chorros polares relativistas',
    icon: '🌪️',
    config: {
      mode: 'vortex_blackhole',
      meshTarget: 'none',
      count: 45000,
      particleSize: 1.8,
      noiseFrequency: 0.6,
      noiseSpeed: 1.2,
      attractionStrength: 3.8,
      swirlForce: 5.5,
      colorStart: '#fbbf24',
      colorEnd: '#f43f5e',
      colorMode: 'temperature',
      particleShape: 'sparkle',
      blending: 'additive',
      opacity: 0.85,
    }
  },
  {
    id: 'lorenz_attractor',
    name: 'Atractor Caótico de Lorenz',
    desc: 'Órbitas mariposa caóticas del atractor diferencial de Lorenz',
    icon: '🦋',
    config: {
      mode: 'lorenz_attractor',
      meshTarget: 'none',
      count: 28000,
      particleSize: 1.8,
      noiseFrequency: 0.2,
      noiseSpeed: 0.8,
      attractionStrength: 0.5,
      swirlForce: 1.0,
      colorStart: '#22d3ee',
      colorEnd: '#ec4899',
      colorMode: 'position',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.80,
      lorenzSigma: 10.0,
      lorenzRho: 28.0,
      lorenzBeta: 2.666,
    }
  },
  {
    id: 'magnetic_dipole_field',
    name: 'Líneas de Campo Magnético',
    desc: 'Dipolo magnético 3D con líneas de fuerza de polo Norte a Sur',
    icon: '🧲',
    config: {
      mode: 'magnetic_dipole',
      meshTarget: 'none',
      count: 36000,
      particleSize: 1.9,
      noiseFrequency: 0.4,
      noiseSpeed: 0.9,
      attractionStrength: 2.0,
      swirlForce: 2.2,
      colorStart: '#60a5fa',
      colorEnd: '#f87171',
      colorMode: 'velocity',
      particleShape: 'streak',
      blending: 'additive',
      opacity: 0.82,
      velocityStretch: 0.4,
    }
  },
  {
    id: 'spiral_galaxy',
    name: 'Galaxia Espiral Estelar',
    desc: 'Ondas de densidad espirales con bulbo galáctico brillante',
    icon: '🌀',
    config: {
      mode: 'galaxy_spiral',
      meshTarget: 'none',
      count: 50000,
      particleSize: 1.6,
      noiseFrequency: 0.35,
      noiseSpeed: 0.5,
      attractionStrength: 2.0,
      swirlForce: 3.2,
      colorStart: '#fed7aa',
      colorEnd: '#60a5fa',
      colorMode: 'radial',
      particleShape: 'star',
      blending: 'additive',
      opacity: 0.82,
    }
  },
  {
    id: 'cyber_neon',
    name: 'Enjambre Neón Cyberpunk',
    desc: 'Matriz de alta velocidad con gradientes cian-magenta vibrantes',
    icon: '⚡',
    config: {
      mode: 'cyber_neon',
      meshTarget: 'none',
      count: 40000,
      particleSize: 2.1,
      noiseFrequency: 0.8,
      noiseSpeed: 1.4,
      attractionStrength: 1.5,
      swirlForce: 3.0,
      colorStart: '#00f5ff',
      colorEnd: '#ff007f',
      colorMode: 'cyber_neon',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.85,
    }
  },
  {
    id: 'interactive_repulsion',
    name: 'Onda Repulsora Reactiva',
    desc: 'Onda de choque y repulsión explosiva al pasar el puntero 3D',
    icon: '💥',
    config: {
      mode: 'spherical_flow',
      meshTarget: 'none',
      count: 36000,
      particleSize: 1.9,
      noiseFrequency: 0.5,
      noiseSpeed: 0.9,
      attractionStrength: 1.8,
      swirlForce: 2.0,
      interactiveMouse: true,
      mouseMode: 'repel',
      mouseForce: -8.0,
      mouseRadius: 5.5,
      colorStart: '#34d399',
      colorEnd: '#3b82f6',
      colorMode: 'ocean',
      particleShape: 'sparkle',
      blending: 'additive',
      opacity: 0.82,
    }
  },
  {
    id: 'quantum_dna_helix',
    name: 'Doble Hélice / ADN Cuántico',
    desc: 'Cadenas helicoidales entrelazadas con pulso de fase',
    icon: '🧬',
    config: {
      mode: 'double_helix',
      meshTarget: 'none',
      count: 30000,
      particleSize: 1.8,
      noiseFrequency: 0.4,
      noiseSpeed: 0.8,
      attractionStrength: 1.0,
      swirlForce: 2.2,
      colorStart: '#a78bfa',
      colorEnd: '#f472b6',
      colorMode: 'position',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.82,
    }
  },
  {
    id: 'torus_knot_stream',
    name: 'Torus Knot (Filamentos Cósmicos)',
    desc: 'Flujo paramétrico a lo largo de un nudo toroidal trefoil 3D',
    icon: '💫',
    config: {
      mode: 'torus_knot',
      meshTarget: 'none',
      count: 35000,
      particleSize: 1.9,
      noiseFrequency: 0.5,
      noiseSpeed: 1.0,
      attractionStrength: 1.6,
      swirlForce: 2.8,
      colorStart: '#facc15',
      colorEnd: '#4ade80',
      colorMode: 'velocity',
      particleShape: 'ring',
      blending: 'additive',
      opacity: 0.82,
    }
  },
  {
    id: 'harmonic_wave_pulse',
    name: 'Ondas Armónicas & Pulso',
    desc: 'Patrones de interferencia estacionaria 3D y pulsaciones rítmicas',
    icon: '🌊',
    config: {
      mode: 'harmonic_wave',
      meshTarget: 'none',
      count: 38000,
      particleSize: 1.9,
      noiseFrequency: 0.6,
      noiseSpeed: 1.0,
      attractionStrength: 1.4,
      swirlForce: 1.8,
      pulseSpeed: 1.8,
      pulseAmplitude: 0.35,
      colorStart: '#f97316',
      colorEnd: '#a855f7',
      colorMode: 'sunset',
      particleShape: 'glow_disc',
      blending: 'additive',
      opacity: 0.84,
    }
  }
];

// ── Base 3D Model Point Cloud Generators (for Mesh Morphing) ──────────────────

function sampleMeshPoints(target: GpgpuMeshTarget, count: number): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const u = Math.random();
    const v = Math.random();
    const w = Math.random();

    let x = 0, y = 0, z = 0;
    let nx = 0, ny = 1, nz = 0;

    if (target === 'stanford_bunny') {
      // Stanford Bunny parametric point formulation (body, head, ears, tail)
      const part = Math.random();
      if (part < 0.50) {
        // Main Body (ovoid bulb)
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const rx = 1.35 * (1 + 0.15 * Math.sin(theta * 2));
        const ry = 1.15;
        const rz = 1.65;
        x = rx * Math.sin(phi) * Math.cos(theta);
        y = ry * Math.cos(phi) - 0.3;
        z = rz * Math.sin(phi) * Math.sin(theta) + 0.1;
      } else if (part < 0.72) {
        // Head
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const r = 0.85;
        x = r * Math.sin(phi) * Math.cos(theta) * 0.9;
        y = r * Math.cos(phi) + 0.95;
        z = r * Math.sin(phi) * Math.sin(theta) * 1.1 + 0.9;
      } else if (part < 0.86) {
        // Left Ear
        const t = u * 2.2;
        const rad = (0.25 - t * 0.08) * (1 + (v - 0.5) * 0.3);
        const ang = w * Math.PI * 2;
        x = -0.45 - t * 0.2 + Math.cos(ang) * rad;
        y = 1.6 + t * 0.95 + Math.sin(ang) * rad;
        z = 0.6 - t * 0.4;
      } else if (part < 0.97) {
        // Right Ear
        const t = u * 2.2;
        const rad = (0.25 - t * 0.08) * (1 + (v - 0.5) * 0.3);
        const ang = w * Math.PI * 2;
        x = 0.45 + t * 0.2 + Math.cos(ang) * rad;
        y = 1.6 + t * 0.95 + Math.sin(ang) * rad;
        z = 0.6 - t * 0.4;
      } else {
        // Fluffy Tail
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const r = 0.38;
        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.cos(phi) - 0.1;
        z = r * Math.sin(phi) * Math.sin(theta) - 1.5;
      }
      // Rough outward normal
      const len = Math.hypot(x, y, z) || 1;
      nx = x / len; ny = y / len; nz = z / len;

    } else if (target === 'suzanne') {
      // Suzanne Monkey geometry approximation (cranium, brow ridge, snout, ears, eyes)
      const part = Math.random();
      if (part < 0.40) {
        // Cranium
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        const r = 1.4;
        x = r * Math.sin(phi) * Math.cos(theta) * 1.05;
        y = r * Math.cos(phi) * 0.9 + 0.3;
        z = r * Math.sin(phi) * Math.sin(theta) * 0.95 - 0.2;
      } else if (part < 0.65) {
        // Snout & Chin
        const theta = u * Math.PI * 2;
        const phi = v * Math.PI * 0.6;
        const r = 0.95;
        x = r * Math.sin(phi) * Math.cos(theta) * 0.85;
        y = r * Math.cos(phi) * 0.7 - 0.5;
        z = r * Math.sin(phi) * Math.sin(theta) * 1.2 + 0.9;
      } else if (part < 0.82) {
        // Brow Ridge & Eyes
        const eyeSide = u > 0.5 ? 1 : -1;
        const theta = (v - 0.5) * Math.PI * 1.2;
        const phi = (w - 0.5) * Math.PI * 1.2;
        x = eyeSide * (0.65 + Math.cos(theta) * 0.42);
        y = 0.35 + Math.sin(theta) * 0.42;
        z = 0.75 + Math.sin(phi) * 0.42;
      } else {
        // Flared Ears
        const earSide = u > 0.5 ? 1 : -1;
        const ang = v * Math.PI * 2;
        const r = 0.65 * Math.sqrt(w);
        x = earSide * (1.75 + Math.cos(ang) * r * 0.9);
        y = 0.4 + Math.sin(ang) * r * 1.2;
        z = -0.1 + (w - 0.5) * 0.3;
      }
      const len = Math.hypot(x, y, z) || 1;
      nx = x / len; ny = y / len; nz = z / len;

    } else if (target === 'torus_knot') {
      // Trefoil Torus Knot (p=2, q=3)
      const t = u * Math.PI * 2;
      const pK = 2, qK = 3;
      const rRing = 0.55 * (0.8 + 0.2 * Math.cos(v * Math.PI * 2));
      const angTube = w * Math.PI * 2;
      const kX = (2.2 + rRing * Math.cos(qK * t)) * Math.cos(pK * t);
      const kY = (2.2 + rRing * Math.cos(qK * t)) * Math.sin(pK * t);
      const kZ = rRing * Math.sin(qK * t) * 2.2;
      x = kX + Math.cos(angTube) * 0.25;
      y = kZ + Math.sin(angTube) * 0.25;
      z = kY;
      nx = Math.cos(angTube); ny = Math.sin(angTube); nz = 0;

    } else if (target === 'skull') {
      // Cranial Skull approximation
      const part = Math.random();
      if (part < 0.60) {
        // Cranium
        const theta = u * Math.PI * 2;
        const phi = Math.acos(2 * v - 1);
        x = 1.2 * Math.sin(phi) * Math.cos(theta);
        y = 1.3 * Math.cos(phi) + 0.4;
        z = 1.4 * Math.sin(phi) * Math.sin(theta);
      } else {
        // Jaw & Maxilla
        const t = (u - 0.5) * 1.2;
        x = t * (0.9 - v * 0.3);
        y = -0.6 - v * 0.8;
        z = 0.5 + w * 0.5 - v * 0.2;
      }
      const len = Math.hypot(x, y, z) || 1;
      nx = x / len; ny = y / len; nz = z / len;

    } else if (target === 'human_torso') {
      // Stylized Human Torso / Bust
      const tY = (u - 0.5) * 3.2; // -1.6 to +1.6
      const ribRadius = (1.2 - tY * 0.2 + (tY < 0 ? tY * 0.3 : 0)) * (1 + 0.15 * Math.cos(v * Math.PI * 2));
      const ang = v * Math.PI * 2;
      x = Math.cos(ang) * ribRadius * 1.15;
      y = tY;
      z = Math.sin(ang) * ribRadius * 0.75;
      nx = Math.cos(ang); ny = 0; nz = Math.sin(ang);

    } else if (target === 'cube') {
      // Bounding Box Surface
      const face = Math.floor(Math.random() * 6);
      const fx = (u - 0.5) * 3.5;
      const fy = (v - 0.5) * 3.5;
      if (face === 0) { x = 1.75; y = fx; z = fy; nx = 1; ny = 0; nz = 0; }
      else if (face === 1) { x = -1.75; y = fx; z = fy; nx = -1; ny = 0; nz = 0; }
      else if (face === 2) { x = fx; y = 1.75; z = fy; nx = 0; ny = 1; nz = 0; }
      else if (face === 3) { x = fx; y = -1.75; z = fy; nx = 0; ny = -1; nz = 0; }
      else if (face === 4) { x = fx; y = fy; z = 1.75; nx = 0; ny = 0; nz = 1; }
      else { x = fx; y = fy; z = -1.75; nx = 0; ny = 0; nz = -1; }

    } else {
      // Default Smooth Sphere
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 2.2;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.cos(phi);
      z = r * Math.sin(phi) * Math.sin(theta);
      nx = x / r; ny = y / r; nz = z / r;
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    normals[i3] = nx;
    normals[i3 + 1] = ny;
    normals[i3 + 2] = nz;
  }

  return { positions, normals };
}

// ── GLSL 3D Simplex & Curl Noise Shaders ──────────────────────────────────────

export const gpgpuSwarmVertexShader = /* glsl */ `
  uniform float uTime;
  uniform int   uMode;                // 0: curl, 1: lorenz, 2: vortex, 3: galaxy, 4: helix, 5: torus_knot, 6: spherical, 7: cyber_neon, 8: mesh_surface, 9: magnetic_dipole, 10: harmonic_wave
  uniform float uParticleSize;
  uniform float uNoiseFrequency;
  uniform float uNoiseSpeed;
  uniform int   uCurlOctaves;
  uniform float uAttractionStrength;
  uniform float uSwirlForce;
  uniform float uDamping;
  uniform float uSpeed;
  uniform float uBoundingRadius;
  uniform vec3  uColorStart;
  uniform vec3  uColorEnd;
  uniform int   uColorMode;           // 0: velocity, 1: position, 2: rainbow, 3: monochrome, 4: radial, 5: temperature, 6: cyber_neon, 7: aurora, 8: sunset, 9: ocean
  uniform int   uInteractiveMouse;
  uniform int   uMouseMode;           // 0: attract, 1: repel, 2: vortex, 3: wave
  uniform vec3  uMousePos;
  uniform float uMouseForce;
  uniform float uMouseRadius;
  uniform float uTrailLength;
  uniform float uVelocityStretch;
  uniform float uLightReactivity;
  uniform vec3  uLightPos;
  uniform vec3  uCameraPos;
  uniform float uSurfaceAttraction;
  uniform float uSurfaceDispersion;
  uniform float uPulseSpeed;
  uniform float uPulseAmplitude;
  uniform float uLorenzSigma;
  uniform float uLorenzRho;
  uniform float uLorenzBeta;

  attribute vec3  aSeed;
  attribute float aPhase;
  attribute float aSizeMult;
  attribute float aColorSeed;
  attribute vec3  aTargetPos;
  attribute vec3  aTargetNormal;

  varying vec4  vColor;
  varying float vSpeedNorm;
  varying vec3  vWorldNormal;
  varying vec3  vViewDir;

  // --- 3D Simplex Noise Helper ---
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

  float snoise(vec3 v){
    const vec2  C = vec2(1.0/6.0, 1.0/3.0);
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 = v - i + dot(i, C.xxx) ;

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

    i = mod(i, 289.0 );
    vec4 p = permute( permute( permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );

    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );

    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }

  // --- Analytical 3D Curl Noise Vector Field ---
  vec3 curlNoise(vec3 p, float t, float freq, int octaves) {
    const float e = 0.02;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);

    vec3 curl = vec3(0.0);
    float f = freq;
    float amp = 1.0;

    for (int i = 0; i < 4; i++) {
      if (i >= octaves) break;
      vec3 pScaled = p * f + vec3(0.0, 0.0, t * 0.15);

      float x0 = snoise(pScaled - dy) - snoise(pScaled + dy);
      float x1 = snoise(pScaled - dz) - snoise(pScaled + dz);
      float y0 = snoise(pScaled - dz) - snoise(pScaled + dz);
      float y1 = snoise(pScaled - dx) - snoise(pScaled + dx);
      float z0 = snoise(pScaled - dx) - snoise(pScaled + dx);
      float z1 = snoise(pScaled - dy) - snoise(pScaled + dy);

      curl += vec3(x0 - x1, y0 - y1, z0 - z1) * amp;
      f *= 2.0;
      amp *= 0.5;
    }
    return curl;
  }

  // --- Rainbow / Spectral Color Helper ---
  vec3 rainbowPalette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  // --- Temperature / Blackbody Radiation Color Helper ---
  vec3 temperaturePalette(float t) {
    vec3 c0 = vec3(0.8, 0.1, 0.05);
    vec3 c1 = vec3(1.0, 0.55, 0.1);
    vec3 c2 = vec3(1.0, 0.95, 0.5);
    vec3 c3 = vec3(0.7, 0.9, 1.0);
    if (t < 0.33) return mix(c0, c1, t / 0.33);
    if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33);
    return mix(c2, c3, (t - 0.66) / 0.34);
  }

  // --- Aurora Borealis Color Helper ---
  vec3 auroraPalette(float t) {
    vec3 c0 = vec3(0.05, 0.95, 0.55); // Emerald neon
    vec3 c1 = vec3(0.0, 0.85, 0.95);  // Cyan
    vec3 c2 = vec3(0.75, 0.2, 0.95);  // Magenta/Violet
    if (t < 0.5) return mix(c0, c1, t * 2.0);
    return mix(c1, c2, (t - 0.5) * 2.0);
  }

  // --- Sunset Twilight Palette ---
  vec3 sunsetPalette(float t) {
    vec3 c0 = vec3(0.98, 0.45, 0.08); // Golden Amber
    vec3 c1 = vec3(0.92, 0.15, 0.55); // Magenta Rose
    vec3 c2 = vec3(0.35, 0.1, 0.85);  // Indigo
    if (t < 0.5) return mix(c0, c1, t * 2.0);
    return mix(c1, c2, (t - 0.5) * 2.0);
  }

  // --- Deep Ocean Electric Palette ---
  vec3 oceanPalette(float t) {
    vec3 c0 = vec3(0.0, 0.95, 0.85);  // Aquamarine
    vec3 c1 = vec3(0.05, 0.45, 0.95); // Royal Azure
    vec3 c2 = vec3(0.1, 0.1, 0.4);    // Deep Abyss
    if (t < 0.5) return mix(c0, c1, t * 2.0);
    return mix(c1, c2, (t - 0.5) * 2.0);
  }

  void main() {
    float t = uTime * uSpeed * uNoiseSpeed;
    float pt = t + aPhase;

    vec3 p = position;
    vec3 vel = vec3(0.0);
    vec3 norm = aTargetNormal;

    // ════ 1. EVALUACIÓN DE MODOS DE ENJAMBRE GPGPU ════
    if (uMode == 0) {
      // ── CURL NOISE NEBULA ──
      vec3 c = curlNoise(p, pt, uNoiseFrequency, uCurlOctaves);
      vel = c * (2.2 * uNoiseSpeed);

      vec3 toCenter = -p;
      float dist = length(toCenter);
      vel += normalize(toCenter) * (dist * 0.25 * uAttractionStrength);
      vel += vec3(-p.z, 0.0, p.x) * (0.35 * uSwirlForce);

      p += vel * sin(pt * 0.8 + aSeed.x * 6.28) * 0.8;
      p += c * 0.4;

    } else if (uMode == 1) {
      // ── ATRACTOR CAÓTICO DE LORENZ ──
      float lSigma = uLorenzSigma > 0.0 ? uLorenzSigma : 10.0;
      float lRho   = uLorenzRho > 0.0 ? uLorenzRho : 28.0;
      float lBeta  = uLorenzBeta > 0.0 ? uLorenzBeta : 2.666;

      float orbitT = mod(pt * 0.4 + aSeed.z * 10.0, 20.0);
      float lx = p.x * 0.15;
      float ly = p.y * 0.15;
      float lz = (p.z + 2.5) * 0.15;

      float dx = lSigma * (ly - lx);
      float dy = lx * (lRho - lz) - ly;
      float dz = lx * ly - lBeta * lz;

      vel = vec3(dx, dy, dz) * 0.08;
      p = position + vel * (sin(orbitT) * 1.5 + 1.5);
      p.y += sin(pt * 1.5 + aSeed.y * 6.28) * 0.3;

    } else if (uMode == 2) {
      // ── VÓRTICE & AGUJERO NEGRO (BLACK HOLE) ──
      float r = length(p.xz) + 0.1;
      float angle = atan(p.z, p.x) + (3.5 * uSwirlForce / sqrt(r)) * (pt * 0.2);
      
      float newX = cos(angle) * r;
      float newZ = sin(angle) * r;
      float newY = p.y * exp(-r * 0.4) + sin(r * 4.0 - pt * 3.0) * 0.2;

      if (abs(p.y) > 1.2) {
        newY += sign(p.y) * (sin(pt * 4.0 + aSeed.y * 10.0) * 1.2 + 0.5);
        newX *= 0.3;
        newZ *= 0.3;
      }

      vel = vec3(newX - p.x, newY - p.y, newZ - p.z) * 1.5;
      p = vec3(newX, newY, newZ);

    } else if (uMode == 3) {
      // ── GALAXIA ESPIRAL ESTELAR ──
      float r = length(p.xz);
      float arms = 2.0;
      float spiral = atan(p.z, p.x) + r * 1.2 - pt * (0.35 * uSwirlForce / (1.0 + r * 0.5));
      float armOffset = sin(spiral * arms) * 0.35;

      float newX = cos(spiral) * (r + armOffset);
      float newZ = sin(spiral) * (r + armOffset);
      float newY = p.y * exp(-r * 0.6) + sin(r * 3.0 + pt) * 0.1;

      vel = vec3(newX - p.x, newY - p.y, newZ - p.z);
      p = vec3(newX, newY, newZ);

    } else if (uMode == 4) {
      // ── DOBLE HÉLICE CUÁNTICA (DNA) ──
      float strand = aSeed.x > 0.5 ? 1.0 : -1.0;
      float hY = p.y + sin(pt * 0.8 + aSeed.z * 6.28) * 0.5;
      float hAngle = hY * 1.8 + (pt * 1.2) + (strand * 3.14159);
      float hRadius = 1.6 + sin(hY * 3.0 + pt * 2.0) * 0.3;

      float newX = cos(hAngle) * hRadius;
      float newZ = sin(hAngle) * hRadius;
      vel = vec3(newX - p.x, 0.0, newZ - p.z) * 2.0;
      p = vec3(newX, hY, newZ);

    } else if (uMode == 5) {
      // ── TORUS KNOT TREFOIL STREAM ──
      float u = pt * 0.8 + aPhase * 2.0;
      float pK = 2.0;
      float qK = 3.0;
      float rK = 0.6 + sin(u * 5.0) * 0.15;
      float kX = (2.0 + rK * cos(qK * u)) * cos(pK * u);
      float kY = (2.0 + rK * cos(qK * u)) * sin(pK * u);
      float kZ = rK * sin(qK * u) * 2.2;

      vec3 targetPos = vec3(kX, kZ, kY);
      vel = (targetPos - p) * 1.8;
      p = targetPos + aSeed * 0.3;

    } else if (uMode == 6) {
      // ── SPHERICAL SHELL FLOW ──
      vec3 nP = normalize(p);
      float rad = 2.5 + sin(pt * 1.5 + dot(nP, vec3(1.0, 2.0, 3.0))) * 0.4;
      vec3 c = curlNoise(nP * 2.0, pt * 0.8, uNoiseFrequency, 2);
      p = (nP + c * 0.3) * rad;
      vel = c * 2.0;

    } else if (uMode == 7) {
      // ── CYBER NEON MATRIX VORTEX ──
      vec3 c = curlNoise(p * 1.2, pt * 1.5, uNoiseFrequency * 1.5, 3);
      float wave = sin(p.y * 4.0 - pt * 4.0);
      vel = c * 3.0 + vec3(-p.z, wave * 1.5, p.x) * (0.8 * uSwirlForce);
      p += vel * 0.25;

    } else if (uMode == 8) {
      // ── MESH SURFACE MORPHING (r3f-flow-field-particles Base Model) ──
      vec3 c = curlNoise(aTargetPos * uNoiseFrequency, pt * 0.8, uNoiseFrequency, 2);
      vec3 surfacePos = aTargetPos + aTargetNormal * (snoise(aTargetPos + pt) * uSurfaceDispersion) + c * (0.2 * uSurfaceDispersion);
      vel = (surfacePos - p) * 2.5;
      p = mix(p + c * 0.5, surfacePos, clamp(uSurfaceAttraction, 0.0, 1.0));
      norm = aTargetNormal;

    } else if (uMode == 9) {
      // ── MAGNETIC DIPOLE FIELD LINES ──
      vec3 poleN = vec3(0.0, 1.8, 0.0);
      vec3 poleS = vec3(0.0, -1.8, 0.0);
      vec3 rN = p - poleN;
      vec3 rS = p - poleS;
      float dN = length(rN) + 0.1;
      float dS = length(rS) + 0.1;
      vec3 bField = (rN / (dN * dN * dN)) - (rS / (dS * dS * dS));
      vec3 c = curlNoise(p, pt * 0.5, uNoiseFrequency, 2);
      vel = normalize(bField) * 2.4 + c * 0.6;
      p += vel * (0.15 * uSpeed);
      if (length(p) > uBoundingRadius) p = position;

    } else {
      // ── HARMONIC WAVE STANDING OSCILLATION ──
      float pulse = sin(pt * uPulseSpeed) * uPulseAmplitude;
      float wX = sin(p.y * 2.0 + pt) * cos(p.z * 2.0 + pt);
      float wY = sin(p.z * 2.0 + pt) * cos(p.x * 2.0 + pt);
      float wZ = sin(p.x * 2.0 + pt) * cos(p.y * 2.0 + pt);
      vec3 waveDir = vec3(wX, wY, wZ);
      vel = waveDir * 2.0 + vec3(pulse * p.x, pulse * p.y, pulse * p.z);
      p += vel * 0.2;
    }

    // ════ 2. INTERACCIÓN 3D CON EL PUNTERO / RATÓN ════
    if (uInteractiveMouse == 1) {
      vec3 toMouse = uMousePos - p;
      float mDist = length(toMouse);
      if (mDist < uMouseRadius && mDist > 0.05) {
        float mFactor = 1.0 - smoothstep(0.0, uMouseRadius, mDist);
        vec3 mForceDir = vec3(0.0);

        if (uMouseMode == 0) {
          // Attract
          mForceDir = normalize(toMouse) * (uMouseForce * mFactor * 2.5);
        } else if (uMouseMode == 1) {
          // Repel (Explosive push away)
          mForceDir = -normalize(toMouse) * (abs(uMouseForce) * mFactor * 3.5);
        } else if (uMouseMode == 2) {
          // Vortex / Whirlwind around cursor axis
          vec3 tangent = cross(normalize(toMouse), vec3(0.0, 1.0, 0.0));
          mForceDir = tangent * (uMouseForce * mFactor * 3.0);
        } else {
          // Wave / Ripple
          float wave = sin(mDist * 6.0 - pt * 10.0);
          mForceDir = normalize(toMouse) * (wave * uMouseForce * mFactor * 2.0);
        }

        p += mForceDir * 0.12;
        vel += mForceDir;
      }
    }

    // Velocity magnitude & normalization
    float speedVal = length(vel);
    vSpeedNorm = clamp(speedVal / 4.0, 0.0, 1.0);
    vWorldNormal = norm;
    vViewDir = normalize(uCameraPos - p);

    // ════ 3. CÁLCULO DE COLOR DINÁMICO ════
    vec3 col = uColorStart;
    if (uColorMode == 0) {
      col = mix(uColorStart, uColorEnd, vSpeedNorm);
    } else if (uColorMode == 1) {
      float posT = clamp((p.y + 3.0) / 6.0, 0.0, 1.0);
      col = mix(uColorStart, uColorEnd, posT);
    } else if (uColorMode == 2) {
      col = rainbowPalette(aColorSeed + pt * 0.1);
    } else if (uColorMode == 3) {
      col = uColorStart;
    } else if (uColorMode == 4) {
      float rDist = clamp(length(p) / uBoundingRadius, 0.0, 1.0);
      col = mix(uColorStart, uColorEnd, rDist);
    } else if (uColorMode == 5) {
      col = temperaturePalette(vSpeedNorm);
    } else if (uColorMode == 6) {
      col = mix(vec3(0.0, 0.95, 1.0), vec3(1.0, 0.0, 0.55), sin(pt * 2.0 + aSeed.x * 6.28) * 0.5 + 0.5);
    } else if (uColorMode == 7) {
      col = auroraPalette(vSpeedNorm + aColorSeed * 0.2);
    } else if (uColorMode == 8) {
      col = sunsetPalette(clamp((p.y + 2.0) / 4.0, 0.0, 1.0));
    } else if (uColorMode == 9) {
      col = oceanPalette(vSpeedNorm);
    }

    // Velocity-based chromatic brilliance (vibrant lift without pure white burnout)
    vec3 velocityBloom = col * (1.0 + vSpeedNorm * 0.4) + vec3(vSpeedNorm * 0.06);
    col = velocityBloom;

    // ════ 4. ILUMINACIÓN 3D REALISTA (r3f-flow-field-particles Light Support) ════
    if (uLightReactivity > 0.01) {
      vec3 L = normalize(uLightPos - p);
      float diff = max(0.3, dot(norm, L));
      vec3 H = normalize(L + vViewDir);
      float spec = pow(max(0.0, dot(norm, H)), 16.0);
      vec3 litCol = col * diff + vec3(spec * 0.35);
      col = mix(col, litCol, clamp(uLightReactivity * 0.75, 0.0, 1.0));
    }

    vColor = vec4(col, 1.0);

    // Model View projection
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Responsive Point Size with perspective distance attenuation & velocity stretch
    float distAtten = clamp(220.0 / max(0.1, -mvPosition.z), 0.2, 8.0);
    float sizeScale = aSizeMult * (1.0 + vSpeedNorm * (0.4 + uVelocityStretch));
    gl_PointSize = clamp(uParticleSize * sizeScale * distAtten, 1.0, 48.0);
  }
`;

export const gpgpuSwarmFragmentShader = /* glsl */ `
  uniform int   uParticleShape; // 0: glow_disc, 1: point, 2: star, 3: sparkle, 4: ring, 5: lit_sphere, 6: square, 7: streak
  uniform float uOpacity;
  uniform int   uBlending;      // 0: normal, 1: additive
  uniform float uLightReactivity;
  uniform vec3  uLightPos;

  varying vec4  vColor;
  varying float vSpeedNorm;
  varying vec3  vWorldNormal;
  varying vec3  vViewDir;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);

    float alpha = 0.0;
    vec3 shadeColor = vColor.rgb;

    if (uParticleShape == 0) {
      // ── GLOW DISC (Smooth Exponential Gaussian Falloff) ──
      if (dist > 0.5) discard;
      float core = 1.0 - smoothstep(0.0, 0.32, dist);
      float glow = exp(-dist * 4.6);
      alpha = core * 0.52 + glow * 0.48;

    } else if (uParticleShape == 1) {
      // ── SHARP CRISP POINT ──
      if (dist > 0.48) discard;
      alpha = 1.0 - smoothstep(0.35, 0.48, dist);

    } else if (uParticleShape == 2) {
      // ── 4-POINT DIFFRACTION STARBURST ──
      if (dist > 0.5) discard;
      float crossRay = max(
        exp(-abs(coord.x) * 16.0) * (1.0 - abs(coord.y) * 2.0),
        exp(-abs(coord.y) * 16.0) * (1.0 - abs(coord.x) * 2.0)
      );
      float centerGlow = exp(-dist * 7.0);
      alpha = clamp(crossRay * 0.85 + centerGlow * 0.9, 0.0, 1.0);

    } else if (uParticleShape == 3) {
      // ── DIAMOND SPARKLE ──
      float diamond = abs(coord.x) + abs(coord.y);
      if (diamond > 0.5) discard;
      alpha = exp(-diamond * 6.0) * 1.2;

    } else if (uParticleShape == 4) {
      // ── HOLOGRAPHIC RING / HALO ──
      float ringDist = abs(dist - 0.32);
      if (dist > 0.5) discard;
      float ringAlpha = exp(-ringDist * 18.0);
      float innerCore = exp(-dist * 10.0) * 0.5;
      alpha = ringAlpha + innerCore;

    } else if (uParticleShape == 5) {
      // ── 3D LIT SPHERE (Pseudo-normal Sphere with Specular Highlight) ──
      if (dist > 0.48) discard;
      float z = sqrt(max(0.0, 0.25 - dist * dist));
      vec3 pseudoNormal = normalize(vec3(coord.x, -coord.y, z));
      vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
      float diff = max(0.2, dot(pseudoNormal, lightDir));
      float spec = pow(max(0.0, dot(reflect(-lightDir, pseudoNormal), vec3(0.0, 0.0, 1.0))), 12.0);
      shadeColor = shadeColor * diff + vec3(spec * 0.6);
      alpha = 1.0 - smoothstep(0.42, 0.48, dist);

    } else if (uParticleShape == 6) {
      // ── SQUARE PIXEL MATRIX ──
      if (abs(coord.x) > 0.46 || abs(coord.y) > 0.46) discard;
      alpha = 0.95;

    } else {
      // ── VELOCITY FLOW STREAK ──
      float streak = exp(-abs(coord.x) * 10.0) * (1.0 - abs(coord.y) * 2.0);
      if (dist > 0.5) discard;
      alpha = clamp(streak * 1.4, 0.0, 1.0);
    }

    alpha = clamp(alpha * uOpacity * vColor.a, 0.0, 1.0);
    if (alpha < 0.01) discard;

    if (uBlending == 1) {
      gl_FragColor = vec4(shadeColor * (alpha * 0.78), alpha * 0.85);
    } else {
      gl_FragColor = vec4(shadeColor, alpha);
    }
  }
`;

/**
 * Builds GPGPU Swarm Geometry with initial particle distribution seeds & base mesh targets
 */
export function buildGpgpuSwarmGeometry(config: GpgpuSwarmConfig): THREE.BufferGeometry {
  const count = Math.max(1000, Math.min(262144, config.count || 32000));
  const positions = new Float32Array(count * 3);
  const aSeed = new Float32Array(count * 3);
  const aPhase = new Float32Array(count);
  const aSizeMult = new Float32Array(count);
  const aColorSeed = new Float32Array(count);

  const mode = config.mode || 'curl_noise';
  const radius = config.boundingRadius || 6.0;

  // Sample target mesh points for 3D Morphing
  const meshTarget = config.meshTarget && config.meshTarget !== 'none' ? config.meshTarget : (mode === 'mesh_surface' ? 'suzanne' : 'sphere');
  const targetSamples = sampleMeshPoints(meshTarget, count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    const r1 = Math.random();
    const r2 = Math.random();
    const r3 = Math.random();

    aSeed[i3] = r1;
    aSeed[i3 + 1] = r2;
    aSeed[i3 + 2] = r3;
    aPhase[i] = r1 * Math.PI * 2.0;
    aSizeMult[i] = 0.5 + Math.random() * 0.9;
    aColorSeed[i] = Math.random();

    let x = 0, y = 0, z = 0;

    if (mode === 'mesh_surface') {
      x = targetSamples.positions[i3] + (r1 - 0.5) * 0.2;
      y = targetSamples.positions[i3 + 1] + (r2 - 0.5) * 0.2;
      z = targetSamples.positions[i3 + 2] + (r3 - 0.5) * 0.2;
    } else if (mode === 'vortex_blackhole' || mode === 'galaxy_spiral') {
      const r = Math.pow(r1, 0.6) * radius;
      const theta = r2 * Math.PI * 2;
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
      y = (r3 - 0.5) * (radius * 0.25) * Math.exp(-r * 0.4);
    } else if (mode === 'lorenz_attractor') {
      const lobe = r1 > 0.5 ? 1 : -1;
      x = lobe * (2.0 + (r2 - 0.5) * 3.0);
      y = (r3 - 0.5) * 4.0;
      z = (r1 - 0.5) * 4.0;
    } else if (mode === 'double_helix') {
      const hY = (r1 - 0.5) * radius * 2.0;
      const strand = r2 > 0.5 ? 0 : Math.PI;
      const hAngle = hY * 1.5 + strand;
      const hR = 1.5 + (r3 - 0.5) * 0.4;
      x = Math.cos(hAngle) * hR;
      z = Math.sin(hAngle) * hR;
      y = hY;
    } else if (mode === 'torus_knot') {
      const u = r1 * Math.PI * 2;
      const pK = 2, qK = 3;
      x = (2 + 0.6 * Math.cos(qK * u)) * Math.cos(pK * u) + (r2 - 0.5) * 0.3;
      y = (2 + 0.6 * Math.cos(qK * u)) * Math.sin(pK * u) + (r3 - 0.5) * 0.3;
      z = 0.6 * Math.sin(qK * u) * 2.2;
    } else {
      const u = r1;
      const v = r2;
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.cbrt(r3) * radius;
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.sin(phi) * Math.sin(theta);
      z = r * Math.cos(phi);
    }

    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute('aSizeMult', new THREE.BufferAttribute(aSizeMult, 1));
  geometry.setAttribute('aColorSeed', new THREE.BufferAttribute(aColorSeed, 1));
  geometry.setAttribute('aTargetPos', new THREE.BufferAttribute(targetSamples.positions, 3));
  geometry.setAttribute('aTargetNormal', new THREE.BufferAttribute(targetSamples.normals, 3));

  return geometry;
}

/**
 * Creates GPGPU Swarm ShaderMaterial
 */
export function createGpgpuSwarmMaterial(config: GpgpuSwarmConfig): THREE.ShaderMaterial {
  const shapeMap: Record<string, number> = {
    glow_disc: 0,
    point: 1,
    star: 2,
    sparkle: 3,
    ring: 4,
    lit_sphere: 5,
    square: 6,
    streak: 7,
  };

  const modeMap: Record<string, number> = {
    curl_noise: 0,
    lorenz_attractor: 1,
    vortex_blackhole: 2,
    galaxy_spiral: 3,
    double_helix: 4,
    torus_knot: 5,
    spherical_flow: 6,
    cyber_neon: 7,
    mesh_surface: 8,
    magnetic_dipole: 9,
    harmonic_wave: 10,
  };

  const colorModeMap: Record<string, number> = {
    velocity: 0,
    position: 1,
    rainbow: 2,
    monochrome: 3,
    radial: 4,
    temperature: 5,
    cyber_neon: 6,
    aurora: 7,
    sunset: 8,
    ocean: 9,
  };

  const mouseModeMap: Record<string, number> = {
    attract: 0,
    repel: 1,
    vortex: 2,
    wave: 3,
  };

  const cStart = new THREE.Color(config.colorStart || '#38bdf8');
  const cEnd = new THREE.Color(config.colorEnd || '#c084fc');
  const isAdditive = config.blending !== 'normal';

  const uniforms = {
    uTime: { value: 0 },
    uMode: { value: modeMap[config.mode] ?? 0 },
    uParticleSize: { value: config.particleSize ?? 3.5 },
    uNoiseFrequency: { value: config.noiseFrequency ?? 0.45 },
    uNoiseSpeed: { value: config.noiseSpeed ?? 0.7 },
    uCurlOctaves: { value: config.curlOctaves ?? 2 },
    uAttractionStrength: { value: config.attractionStrength ?? 1.2 },
    uSwirlForce: { value: config.swirlForce ?? 2.2 },
    uDamping: { value: config.damping ?? 0.94 },
    uSpeed: { value: config.speed ?? 1.0 },
    uBoundingRadius: { value: config.boundingRadius ?? 8.0 },
    uColorStart: { value: cStart },
    uColorEnd: { value: cEnd },
    uColorMode: { value: colorModeMap[config.colorMode] ?? 0 },
    uParticleShape: { value: shapeMap[config.particleShape] ?? 0 },
    uOpacity: { value: config.opacity ?? 0.88 },
    uBlending: { value: isAdditive ? 1 : 0 },
    uInteractiveMouse: { value: config.interactiveMouse ? 1 : 0 },
    uMouseMode: { value: mouseModeMap[config.mouseMode || 'attract'] ?? 0 },
    uMousePos: { value: new THREE.Vector3(0, 0, 0) },
    uMouseForce: { value: config.mouseForce ?? 4.5 },
    uMouseRadius: { value: config.mouseRadius ?? 4.0 },
    uTrailLength: { value: config.trailLength ?? 1.0 },
    uVelocityStretch: { value: config.velocityStretch ?? 0.2 },
    uLightReactivity: { value: config.lightReactivity ?? 0.5 },
    uLightPos: { value: new THREE.Vector3(5, 10, 5) },
    uCameraPos: { value: new THREE.Vector3(0, 0, 10) },
    uSurfaceAttraction: { value: config.surfaceAttraction ?? 0.8 },
    uSurfaceDispersion: { value: config.surfaceDispersion ?? 0.4 },
    uPulseSpeed: { value: config.pulseSpeed ?? 1.2 },
    uPulseAmplitude: { value: config.pulseAmplitude ?? 0.15 },
    uLorenzSigma: { value: config.lorenzSigma ?? 10.0 },
    uLorenzRho: { value: config.lorenzRho ?? 28.0 },
    uLorenzBeta: { value: config.lorenzBeta ?? 2.666 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: gpgpuSwarmVertexShader,
    fragmentShader: gpgpuSwarmFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  return material;
}

/**
 * Creates full Points Mesh with GPGPU Swarm properties
 */
export function createGpgpuSwarmMesh(config: GpgpuSwarmConfig, objectId: string): THREE.Points {
  const geometry = buildGpgpuSwarmGeometry(config);
  const material = createGpgpuSwarmMaterial(config);
  const points = new THREE.Points(geometry, material);
  points.userData.id = objectId;
  points.userData.isGpgpuSwarm = true;
  points.frustumCulled = false;
  return points;
}

/**
 * Builds GPGPU Swarm Spatial Gizmo (Wireframe orbital rings and bounding cage)
 */
export function buildGpgpuSwarmGizmo(config: GpgpuSwarmConfig): { vertices: V3[]; faces: any[]; wireframeEdges: [number, number][] } {
  const verts: V3[] = [];
  const edges: [number, number][] = [];
  const addV = (x: number, y: number, z: number): number => {
    verts.push([x, y, z]);
    return verts.length - 1;
  };
  const addE = (a: number, b: number) => {
    edges.push([a, b]);
  };

  const r = (config.boundingRadius || 6.0) * 0.45;
  const segs = 24;

  // Ring XZ
  let pIdx = -1, fIdx = -1;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const idx = addV(Math.cos(a) * r, 0, Math.sin(a) * r);
    if (i === 0) fIdx = idx;
    if (pIdx !== -1) addE(pIdx, idx);
    pIdx = idx;
  }
  if (pIdx !== -1 && fIdx !== -1) addE(pIdx, fIdx);

  // Ring XY
  pIdx = -1; fIdx = -1;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const idx = addV(Math.cos(a) * r, Math.sin(a) * r, 0);
    if (i === 0) fIdx = idx;
    if (pIdx !== -1) addE(pIdx, idx);
    pIdx = idx;
  }
  if (pIdx !== -1 && fIdx !== -1) addE(pIdx, fIdx);

  // Ring YZ
  pIdx = -1; fIdx = -1;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const idx = addV(0, Math.cos(a) * r, Math.sin(a) * r);
    if (i === 0) fIdx = idx;
    if (pIdx !== -1) addE(pIdx, idx);
    pIdx = idx;
  }
  if (pIdx !== -1 && fIdx !== -1) addE(pIdx, fIdx);

  // Cross axes
  const xN = addV(-r * 1.15, 0, 0); const xP = addV(r * 1.15, 0, 0);
  const yN = addV(0, -r * 1.15, 0); const yP = addV(0, r * 1.15, 0);
  const zN = addV(0, 0, -r * 1.15); const zP = addV(0, 0, r * 1.15);
  addE(xN, xP); addE(yN, yP); addE(zN, zP);

  return {
    vertices: verts,
    faces: [],
    wireframeEdges: edges
  };
}
