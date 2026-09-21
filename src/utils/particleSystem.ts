import * as THREE from 'three';
import { ParticleSystemConfig, SpaceWarpConfig, CSGObject, V3 } from '../types';

export const DEFAULT_PARTICLE_CONFIG: ParticleSystemConfig = {
  emitterType: 'POINT',
  emitterSize: [1, 1, 1],
  particleType: 'SUPER_SPRAY',
  count: 400,
  birthRate: 60,
  life: 3.5,
  lifeVariation: 0.3,
  speed: 2.2,
  speedVariation: 0.4,
  spread: 25, // degrees
  particleSize: 0.18,
  sizeVariation: 0.35,
  growth: 0.5,
  fade: true,
  spin: 1.5,
  colorStart: '#60a5fa',
  colorEnd: '#f43f5e',
  opacity: 0.85,
  blending: 'additive',
  affectedBySpaceWarps: true,
  boundSpaceWarpIds: [],
};

export const DEFAULT_SPACE_WARP_CONFIG: SpaceWarpConfig = {
  warpType: 'WIND',
  strength: 1.5,
  decay: 0.0,
  range: 15.0,
  windTurbulence: 0.6,
  windFrequency: 1.2,
  vortexAxial: 1.2,
  vortexRadial: 2.0,
  waveAmplitude: 0.4,
  waveLength: 1.5,
  waveSpeed: 2.0,
  deflectorBounce: 0.75,
  deflectorFriction: 0.1,
  iconSize: 1.0,
};

export interface ParticlePreset {
  id: string;
  name: string;
  desc: string;
  icon: string;
  config: Partial<ParticleSystemConfig>;
}

export const PARTICLE_PRESETS: ParticlePreset[] = [
  {
    id: 'super_spray',
    name: 'Super Spray',
    desc: 'Chorro de partículas cónico con dispersión',
    icon: '✨',
    config: {
      particleType: 'SUPER_SPRAY',
      emitterType: 'POINT',
      count: 500,
      birthRate: 80,
      speed: 3.0,
      spread: 30,
      particleSize: 0.14,
      colorStart: '#38bdf8',
      colorEnd: '#818cf8',
      blending: 'additive',
    }
  },
  {
    id: 'snow_blizzard',
    name: 'Nieve / Ventisca (Snow)',
    desc: 'Copos flotantes con turbulencia suave',
    icon: '❄️',
    config: {
      particleType: 'SNOW',
      emitterType: 'BOX',
      emitterSize: [4, 1, 4],
      count: 600,
      birthRate: 90,
      life: 5.0,
      speed: 0.8,
      spread: 60,
      particleSize: 0.12,
      colorStart: '#f8fafc',
      colorEnd: '#cbd5e1',
      blending: 'normal',
      spin: 0.8,
    }
  },
  {
    id: 'fire_smoke',
    name: 'Fuego y Humo (Fire/Smoke)',
    desc: 'Llamas ardientes con transición a humo',
    icon: '🔥',
    config: {
      particleType: 'FIRE_SMOKE',
      emitterType: 'CIRCLE',
      count: 450,
      birthRate: 75,
      life: 2.5,
      speed: 1.8,
      spread: 20,
      particleSize: 0.28,
      growth: 1.2,
      colorStart: '#fbbf24',
      colorEnd: '#1e293b',
      blending: 'additive',
    }
  },
  {
    id: 'cloud_puff',
    name: 'Nubes de Partículas (Cloud Puffs)',
    desc: 'Volutas esponjosas y cúmulos de vapor',
    icon: '☁️',
    config: {
      particleType: 'CLOUD_PUFF',
      emitterType: 'SPHERE',
      count: 250,
      birthRate: 35,
      life: 4.5,
      speed: 0.5,
      spread: 80,
      particleSize: 0.55,
      growth: 0.8,
      colorStart: '#ffffff',
      colorEnd: '#94a3b8',
      blending: 'normal',
      opacity: 0.65,
    }
  },
  {
    id: 'starfield',
    name: 'Polvo Estelar (Stars)',
    desc: 'Centelleo de chispas cósmicas brillantes',
    icon: '⭐',
    config: {
      particleType: 'STARS',
      emitterType: 'SPHERE',
      count: 500,
      birthRate: 60,
      life: 3.5,
      speed: 0.9,
      spread: 180,
      particleSize: 0.16,
      colorStart: '#fef08a',
      colorEnd: '#c084fc',
      blending: 'additive',
    }
  },
  {
    id: 'bubbles',
    name: 'Burbujas Flotantes',
    desc: 'Esferas translúcidas con oscilación',
    icon: '🫧',
    config: {
      particleType: 'BUBBLES',
      emitterType: 'RING',
      count: 300,
      birthRate: 40,
      life: 4.0,
      speed: 1.1,
      spread: 25,
      particleSize: 0.22,
      colorStart: '#67e8f9',
      colorEnd: '#a855f7',
      blending: 'additive',
      opacity: 0.75,
    }
  }
];

export interface SpaceWarpPreset {
  id: string;
  name: string;
  desc: string;
  icon: string;
  config: Partial<SpaceWarpConfig>;
}

export const SPACE_WARP_PRESETS: SpaceWarpPreset[] = [
  {
    id: 'gravity',
    name: 'Gravedad (Gravity)',
    desc: 'Fuerza direccional descendente constante',
    icon: '⬇️',
    config: {
      warpType: 'GRAVITY',
      strength: 4.8,
      decay: 0.0,
      range: 20.0,
    }
  },
  {
    id: 'wind',
    name: 'Viento (Wind)',
    desc: 'Corriente de aire con ráfagas turbulentas',
    icon: '💨',
    config: {
      warpType: 'WIND',
      strength: 3.2,
      windTurbulence: 0.8,
      windFrequency: 1.5,
      range: 20.0,
    }
  },
  {
    id: 'vortex',
    name: 'Vórtice / Tornado (Vortex)',
    desc: 'Remolino ciclónico espiral con elevación',
    icon: '🌪️',
    config: {
      warpType: 'VORTEX',
      strength: 3.5,
      vortexAxial: 1.8,
      vortexRadial: 2.8,
      range: 15.0,
    }
  },
  {
    id: 'push_attractor',
    name: 'Empuje / Atractor (Push)',
    desc: 'Campo de fuerza radial puntual de atracción/repulsión',
    icon: '🧲',
    config: {
      warpType: 'PUSH',
      strength: 4.0,
      decay: 1.0,
      range: 10.0,
    }
  },
  {
    id: 'deflector',
    name: 'Deflector de Rebote (Deflector)',
    desc: 'Plano de colisión que rebota partículas con fricción',
    icon: '🛡️',
    config: {
      warpType: 'DEFLECTOR',
      deflectorBounce: 0.8,
      deflectorFriction: 0.15,
      range: 10.0,
    }
  },
  {
    id: 'wave_ripple',
    name: 'Ondulación / Ola (Wave)',
    desc: 'Perturbación oscilatoria periódica en el espacio',
    icon: '🌊',
    config: {
      warpType: 'WAVE',
      waveAmplitude: 0.6,
      waveLength: 1.8,
      waveSpeed: 2.5,
      range: 15.0,
    }
  }
];

export interface LiveParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  maxLife: number;
  size: number;
  initialSize: number;
  growth: number;
  color: THREE.Color;
  colorStart: THREE.Color;
  colorEnd: THREE.Color;
  alpha: number;
  rotation: number;
  rotationSpeed: number;
  seed: number;
  active: boolean;
}

export interface SpaceWarpObjectData {
  id: string;
  type: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  config: SpaceWarpConfig;
}

/**
 * Procedural Sprite Texture Generation for particle rendering
 */
const spriteTextureCache = new Map<string, THREE.Texture>();

export function getParticleSpriteTexture(type: string): THREE.Texture {
  if (spriteTextureCache.has(type)) {
    return spriteTextureCache.get(type)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cx = 64, cy = 64;

  if (type === 'FIRE_SMOKE' || type === 'CLOUD_PUFF') {
    // Soft fluffy cloud / smoke puff with radial softness
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.7)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'SNOW') {
    // Stylized snowflake / ice crystal dot
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.8, 'rgba(230, 245, 255, 0.3)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'STARS') {
    // 4-point sparkle star
    ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    // Star rays
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, 8); ctx.lineTo(cx, 120);
    ctx.moveTo(8, cy); ctx.lineTo(120, cy);
    ctx.stroke();
  } else if (type === 'BUBBLES') {
    // Rim-highlighted translucent sphere bubble
    const grad = ctx.createRadialGradient(cx - 15, cy - 15, 5, cx, cy, 55);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.4, 'rgba(180, 240, 255, 0.25)');
    grad.addColorStop(0.85, 'rgba(200, 230, 255, 0.8)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Default bright glow dot for Super Spray
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 55);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  spriteTextureCache.set(type, tex);
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE SIMULATOR ENGINE (High-Performance 3ds Max Style Engine)
// ─────────────────────────────────────────────────────────────────────────────

const particleVertexShader = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 customColor;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = customColor;
    vAlpha = alpha;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Dynamic perspective size attenuation
    gl_PointSize = size * (400.0 / -mvPosition.z);
    // Clamp point size for clean rendering
    gl_PointSize = clamp(gl_PointSize, 1.0, 256.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform sampler2D pointTexture;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.002) discard;
    vec4 texColor = texture2D(pointTexture, gl_PointCoord);
    gl_FragColor = vec4(vColor * texColor.rgb, texColor.a * vAlpha);
    if (gl_FragColor.a < 0.005) discard;
  }
`;

export class ParticleSimulator {
  public id: string;
  public config: ParticleSystemConfig;
  public points: THREE.Points;
  public geometry: THREE.BufferGeometry;
  public material: THREE.ShaderMaterial;

  private particles: LiveParticle[] = [];
  private pool: LiveParticle[] = [];
  private spawnAccumulator = 0;
  private maxCount: number;

  // Buffer attributes
  private posAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;

  private cStart = new THREE.Color();
  private cEnd = new THREE.Color();

  constructor(id: string, config: ParticleSystemConfig) {
    this.id = id;
    this.config = { ...DEFAULT_PARTICLE_CONFIG, ...config };
    this.maxCount = Math.max(50, this.config.count || 500);

    this.cStart.set(this.config.colorStart || '#60a5fa');
    this.cEnd.set(this.config.colorEnd || '#f43f5e');

    // Pre-allocate pools
    for (let i = 0; i < this.maxCount; i++) {
      this.pool.push({
        position: new THREE.Vector3(0, -99999, 0),
        velocity: new THREE.Vector3(),
        age: 0,
        maxLife: 3.0,
        size: 0.2,
        initialSize: 0.2,
        growth: 0.5,
        color: new THREE.Color(),
        colorStart: new THREE.Color(),
        colorEnd: new THREE.Color(),
        alpha: 0,
        rotation: 0,
        rotationSpeed: 0,
        seed: Math.random(),
        active: false,
      });
    }

    // Geometry buffers
    const positions = new Float32Array(this.maxCount * 3);
    const colors = new Float32Array(this.maxCount * 3);
    const sizes = new Float32Array(this.maxCount);
    const alphas = new Float32Array(this.maxCount);

    for (let i = 0; i < this.maxCount; i++) {
      positions[i * 3 + 1] = -99999; // Park offscreen
      sizes[i] = 0;
      alphas[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('customColor', this.colorAttr);
    this.geometry.setAttribute('size', this.sizeAttr);
    this.geometry.setAttribute('alpha', this.alphaAttr);

    const isAdditive = (this.config.blending || 'additive') === 'additive';
    const texture = getParticleSpriteTexture(this.config.particleType || 'SUPER_SPRAY');

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: texture },
      },
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthTest: true,
      depthWrite: false,
      transparent: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.userData = { isParticleMesh: true, objectId: id };
  }

  public updateConfig(newConfig: Partial<ParticleSystemConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.cStart.set(this.config.colorStart || '#60a5fa');
    this.cEnd.set(this.config.colorEnd || '#f43f5e');

    const isAdditive = (this.config.blending || 'additive') === 'additive';
    this.material.blending = isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.uniforms.pointTexture.value = getParticleSpriteTexture(this.config.particleType || 'SUPER_SPRAY');
    this.material.needsUpdate = true;
  }

  public reset() {
    this.particles.forEach(p => {
      p.active = false;
      p.position.set(0, -99999, 0);
      this.pool.push(p);
    });
    this.particles = [];
    this.spawnAccumulator = 0;
    this.syncBuffers();
  }

  /**
   * Spawns a single particle at the emitter's current position / orientation
   */
  private spawnParticle(
    emitterPos: THREE.Vector3,
    emitterQuat: THREE.Quaternion,
    emitterScale: THREE.Vector3
  ) {
    if (this.particles.length >= this.maxCount) return;
    const p = this.pool.pop();
    if (!p) return;

    p.active = true;
    p.age = 0;
    const lifeVar = this.config.lifeVariation ?? 0.3;
    const baseLife = this.config.life ?? 3.5;
    p.maxLife = Math.max(0.1, baseLife * (1 + (Math.random() - 0.5) * lifeVar * 2));

    const sizeVar = this.config.sizeVariation ?? 0.35;
    const baseSize = this.config.particleSize ?? 0.18;
    p.initialSize = Math.max(0.01, baseSize * (1 + (Math.random() - 0.5) * sizeVar * 2));
    p.size = p.initialSize;
    p.growth = this.config.growth ?? 0.5;

    p.colorStart.copy(this.cStart);
    p.colorEnd.copy(this.cEnd);
    p.color.copy(p.colorStart);

    p.rotation = Math.random() * Math.PI * 2;
    p.rotationSpeed = (Math.random() - 0.5) * (this.config.spin ?? 1.5);
    p.seed = Math.random();

    // 1. Calculate emitter local offset based on emitterType
    const eType = this.config.emitterType || 'POINT';
    const localOffset = new THREE.Vector3();
    const eSize = this.config.emitterSize || [1, 1, 1];
    const sx = (eSize[0] || 1) * 0.5;
    const sy = (eSize[1] || 1) * 0.5;
    const sz = (eSize[2] || 1) * 0.5;

    if (eType === 'BOX') {
      localOffset.set(
        (Math.random() - 0.5) * 2 * sx,
        (Math.random() - 0.5) * 2 * sy,
        (Math.random() - 0.5) * 2 * sz
      );
    } else if (eType === 'SPHERE') {
      const u = Math.random(), v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.cbrt(Math.random()) * sx;
      const sinPhi = Math.sin(phi);
      localOffset.set(r * sinPhi * Math.cos(theta), r * sinPhi * Math.sin(theta), r * Math.cos(phi));
    } else if (eType === 'CIRCLE') {
      const r = Math.sqrt(Math.random()) * sx;
      const theta = Math.random() * 2 * Math.PI;
      localOffset.set(r * Math.cos(theta), 0, r * Math.sin(theta));
    } else if (eType === 'RING') {
      const theta = Math.random() * 2 * Math.PI;
      localOffset.set(sx * Math.cos(theta), 0, sx * Math.sin(theta));
    }

    // Apply emitter rotation and scale to initial position
    localOffset.multiply(emitterScale).applyQuaternion(emitterQuat);
    p.position.copy(emitterPos).add(localOffset);

    // 2. Calculate initial velocity with conical spread
    // Base direction is local +Y axis (matching 3ds Max emitter cone nozzle gizmo)
    const spreadDeg = this.config.spread ?? 25;
    const spreadRad = (spreadDeg * Math.PI) / 180;

    // Random direction inside a cone around (0, 1, 0)
    const phi = Math.random() * (spreadRad * 0.5);
    const theta = Math.random() * 2 * Math.PI;

    const dirLocal = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    ).normalize();

    // Transform local nozzle direction to world space
    const dirWorld = dirLocal.applyQuaternion(emitterQuat).normalize();

    const speedVar = this.config.speedVariation ?? 0.4;
    const baseSpeed = this.config.speed ?? 2.2;
    const speed = Math.max(0.01, baseSpeed * (1 + (Math.random() - 0.5) * speedVar * 2));

    p.velocity.copy(dirWorld).multiplyScalar(speed);

    this.particles.push(p);
  }

  /**
   * Main Physics Step with Space Warps (Gravity, Wind, Vortex, Push/Attractor, Deflector, Wave)
   */
  public update(
    dt: number,
    emitterTransform: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
    spaceWarps: SpaceWarpObjectData[] = [],
    currentTime = 0
  ) {
    if (dt <= 0) return;
    // Cap dt to prevent giant physics jumps on frame drop
    const clampedDt = Math.min(dt, 0.06);

    // 1. Spawning new particles
    const birthRate = this.config.birthRate ?? 60;
    this.spawnAccumulator += birthRate * clampedDt;

    while (this.spawnAccumulator >= 1.0) {
      this.spawnParticle(emitterTransform.position, emitterTransform.quaternion, emitterTransform.scale);
      this.spawnAccumulator -= 1.0;
    }

    // 2. Simulate active particles
    const affectedByWarps = this.config.affectedBySpaceWarps ?? true;
    const boundIds = this.config.boundSpaceWarpIds || [];
    const activeWarps = affectedByWarps
      ? (boundIds.length > 0
          ? spaceWarps.filter(w => boundIds.includes(w.id))
          : spaceWarps)
      : [];

    const baseOpacity = this.config.opacity ?? 0.85;
    const doFade = this.config.fade !== false;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += clampedDt;

      if (p.age >= p.maxLife) {
        // Recycle particle
        p.active = false;
        p.position.set(0, -99999, 0);
        this.pool.push(p);
        this.particles.splice(i, 1);
        continue;
      }

      const lifeRatio = p.age / p.maxLife; // 0.0 -> 1.0

      // ── Apply Space Warps ──
      for (let w = 0; w < activeWarps.length; w++) {
        const warp = activeWarps[w];
        const wType = warp.config.warpType || warp.type || 'WIND';
        const str = warp.config.strength ?? 1.5;
        const range = warp.config.range ?? 15.0;

        const toParticle = p.position.clone().sub(warp.position);
        const dist = toParticle.length();

        if (range > 0 && dist > range && wType !== 'GRAVITY') {
          continue; // Outside influence range
        }

        const decayFactor = warp.config.decay && warp.config.decay > 0
          ? 1.0 / (1.0 + warp.config.decay * (dist / range))
          : 1.0;

        if (wType === 'GRAVITY') {
          // Directional gravity along warp's downward arrow (local -Y transformed to world)
          const down = new THREE.Vector3(0, -1, 0).applyQuaternion(warp.quaternion);
          p.velocity.addScaledVector(down, str * 9.8 * clampedDt * decayFactor);

        } else if (wType === 'WIND') {
          // Wind force along warp's local +Y direction
          const windDir = new THREE.Vector3(0, 1, 0).applyQuaternion(warp.quaternion);
          const turbFreq = warp.config.windFrequency ?? 1.2;
          const turbStr = warp.config.windTurbulence ?? 0.6;
          
          // Spatial multi-axis turbulence
          const turb = new THREE.Vector3(
            Math.sin(p.position.y * turbFreq + currentTime * 3.0 + p.seed * 10),
            Math.cos(p.position.x * turbFreq + currentTime * 2.5),
            Math.sin(p.position.z * turbFreq + currentTime * 2.0)
          ).multiplyScalar(turbStr * str);

          p.velocity.addScaledVector(windDir, str * 3.0 * clampedDt * decayFactor);
          p.velocity.addScaledVector(turb, clampedDt * decayFactor);

        } else if (wType === 'VORTEX') {
          // Cyclone vortex around warp axis
          const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(warp.quaternion);
          const axialDist = toParticle.dot(axis);
          const radialVec = toParticle.clone().sub(axis.clone().multiplyScalar(axialDist));
          const r = radialVec.length();

          if (r > 0.05) {
            const tangent = axis.clone().cross(radialVec).normalize();
            const vortexRad = warp.config.vortexRadial ?? 2.0;
            const vortexAx = warp.config.vortexAxial ?? 1.2;

            // Orbital tangential velocity
            p.velocity.addScaledVector(tangent, vortexRad * 6.0 * clampedDt * decayFactor);
            // Upward axial lift
            p.velocity.addScaledVector(axis, vortexAx * 4.0 * clampedDt * decayFactor);
            // Inward gravitational pull towards core
            p.velocity.addScaledVector(radialVec.normalize(), -vortexRad * 1.5 * clampedDt * decayFactor);
          }

        } else if (wType === 'PUSH') {
          // Radial push/pull attractor
          if (dist > 0.05) {
            const pushDir = toParticle.clone().normalize();
            p.velocity.addScaledVector(pushDir, str * 6.0 * clampedDt * decayFactor);
          }

        } else if (wType === 'DEFLECTOR') {
          // Planar bounce deflector
          const planeNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(warp.quaternion);
          const planeDist = toParticle.dot(planeNormal);
          const bounce = warp.config.deflectorBounce ?? 0.75;
          const friction = warp.config.deflectorFriction ?? 0.1;

          // If close to deflector plane and moving towards it
          const velDot = p.velocity.dot(planeNormal);
          if (Math.abs(planeDist) < 0.35 && velDot < 0) {
            // Reflect normal velocity
            p.velocity.sub(planeNormal.clone().multiplyScalar((1.0 + bounce) * velDot));
            // Apply tangential friction
            p.velocity.multiplyScalar(1.0 - Math.min(1.0, friction * 2.0));
            // Offset particle away from plane
            p.position.addScaledVector(planeNormal, 0.05);
          }

        } else if (wType === 'WAVE' || wType === 'RIPPLE') {
          // Sinusoidal wave oscillation
          const waveAmp = warp.config.waveAmplitude ?? 0.4;
          const waveLen = warp.config.waveLength ?? 1.5;
          const waveSpd = warp.config.waveSpeed ?? 2.0;
          const waveY = Math.sin(dist * waveLen - currentTime * waveSpd) * waveAmp;
          const waveForce = new THREE.Vector3(0, waveY, 0).applyQuaternion(warp.quaternion);
          p.velocity.addScaledVector(waveForce, clampedDt * 4.0 * decayFactor);
        }
      }

      // Step position
      p.position.addScaledVector(p.velocity, clampedDt);

      // Color interpolation from start to end
      p.color.copy(p.colorStart).lerp(p.colorEnd, lifeRatio);

      // Growth scaling
      p.size = p.initialSize * Math.max(0.01, 1.0 + p.growth * lifeRatio);

      // Alpha fade lifecycle (smooth fade-in and smooth fade-out)
      if (doFade) {
        let alphaFade = 1.0;
        if (lifeRatio < 0.15) {
          alphaFade = lifeRatio / 0.15; // Fade in
        } else if (lifeRatio > 0.7) {
          alphaFade = Math.max(0, (1.0 - lifeRatio) / 0.3); // Fade out
        }
        p.alpha = baseOpacity * alphaFade;
      } else {
        p.alpha = baseOpacity;
      }
    }

    this.syncBuffers();
  }

  /**
   * Deterministically steps/seeks to any target timeline time
   */
  public seekToTime(
    targetTime: number,
    getEmitterTransformAtTime: (t: number) => { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 },
    spaceWarpsAtTime: (t: number) => SpaceWarpObjectData[]
  ) {
    this.reset();
    const life = this.config.life ?? 3.5;
    const startTime = Math.max(0, targetTime - life);
    const subSteps = 45; // 45 discrete evaluation steps
    const stepDt = (targetTime - startTime) / subSteps;

    if (stepDt <= 0.001) return;

    for (let s = 0; s <= subSteps; s++) {
      const curT = startTime + s * stepDt;
      const xform = getEmitterTransformAtTime(curT);
      const warps = spaceWarpsAtTime(curT);
      this.update(stepDt, xform, warps, curT);
    }
  }

  /**
   * Syncs active live particles to WebGL BufferAttributes
   */
  private syncBuffers() {
    const posArr = this.posAttr.array as Float32Array;
    const colArr = this.colorAttr.array as Float32Array;
    const sizeArr = this.sizeAttr.array as Float32Array;
    const alphaArr = this.alphaAttr.array as Float32Array;

    const count = this.particles.length;

    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      posArr[i * 3] = p.position.x;
      posArr[i * 3 + 1] = p.position.y;
      posArr[i * 3 + 2] = p.position.z;

      colArr[i * 3] = p.color.r;
      colArr[i * 3 + 1] = p.color.g;
      colArr[i * 3 + 2] = p.color.b;

      sizeArr[i] = p.size;
      alphaArr[i] = p.alpha;
    }

    // Clear unused slots
    for (let i = count; i < this.maxCount; i++) {
      posArr[i * 3 + 1] = -99999;
      sizeArr[i] = 0;
      alphaArr[i] = 0;
    }

    this.posAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Helper to build Particle System Mesh and instantiate its simulator
 */
export function createParticleSystemSimulator(id: string, config: ParticleSystemConfig): ParticleSimulator {
  return new ParticleSimulator(id, config);
}

/**
 * Builds Space Warp Visual Gizmo 3D Line Mesh (3ds Max Style Viewport Icons)
 */
export function buildSpaceWarpGizmo(warp: SpaceWarpConfig): { vertices: V3[]; faces: any[]; wireframeEdges: [number, number][] } {
  const type = warp.warpType || 'WIND';
  const size = warp.iconSize ?? 1.0;
  const s = size * 0.5;
  const verts: V3[] = [];
  const edges: [number, number][] = [];

  const addV = (x: number, y: number, z: number): number => {
    verts.push([x, y, z]);
    return verts.length - 1;
  };
  const addE = (a: number, b: number) => {
    edges.push([a, b]);
  };

  if (type === 'GRAVITY') {
    // Bounding Box Cage with Downward Force Arrows
    const v0 = addV(-s, s, -s);
    const v1 = addV(s, s, -s);
    const v2 = addV(s, s, s);
    const v3 = addV(-s, s, s);
    const v4 = addV(-s, -s, -s);
    const v5 = addV(s, -s, -s);
    const v6 = addV(s, -s, s);
    const v7 = addV(-s, -s, s);

    // Box perimeter
    addE(v0, v1); addE(v1, v2); addE(v2, v3); addE(v3, v0);
    addE(v4, v5); addE(v5, v6); addE(v6, v7); addE(v7, v4);
    addE(v0, v4); addE(v1, v5); addE(v2, v6); addE(v3, v7);

    // Central downward arrow
    const aTop = addV(0, s * 0.9, 0);
    const aBot = addV(0, -s * 0.9, 0);
    const aL = addV(-s * 0.3, -s * 0.4, 0);
    const aR = addV(s * 0.3, -s * 0.4, 0);
    const aF = addV(0, -s * 0.4, s * 0.3);
    const aB = addV(0, -s * 0.4, -s * 0.3);
    addE(aTop, aBot);
    addE(aBot, aL); addE(aBot, aR); addE(aBot, aF); addE(aBot, aB);

  } else if (type === 'WIND') {
    // Wind Emitter Plane with 3 Forward Wind Velocity Arrows
    const p0 = addV(-s, 0, -s);
    const p1 = addV(s, 0, -s);
    const p2 = addV(s, 0, s);
    const p3 = addV(-s, 0, s);
    addE(p0, p1); addE(p1, p2); addE(p2, p3); addE(p3, p0);
    addE(p0, p2); addE(p1, p3);

    // 3 Arrows pointing along +Y or +Z
    [-s * 0.5, 0, s * 0.5].forEach(offset => {
      const b = addV(offset, 0, 0);
      const t = addV(offset, s * 1.5, 0);
      const l = addV(offset - s * 0.2, s * 1.1, 0);
      const r = addV(offset + s * 0.2, s * 1.1, 0);
      addE(b, t);
      addE(t, l); addE(t, r);
    });

  } else if (type === 'VORTEX') {
    // 3D Tornado Spiral Helix Curves
    const turns = 3;
    const segs = 36;
    let prevIdx = -1;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const r = (0.2 + 0.8 * t) * s;
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * s * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const idx = addV(x, y, z);
      if (prevIdx !== -1) addE(prevIdx, idx);
      prevIdx = idx;
    }
    // Top circle
    const topCircleSegs = 16;
    let pTop = -1;
    let firstTop = -1;
    for (let i = 0; i < topCircleSegs; i++) {
      const a = (i / topCircleSegs) * Math.PI * 2;
      const idx = addV(Math.cos(a) * s, s, Math.sin(a) * s);
      if (i === 0) firstTop = idx;
      if (pTop !== -1) addE(pTop, idx);
      pTop = idx;
    }
    if (pTop !== -1 && firstTop !== -1) addE(pTop, firstTop);

  } else if (type === 'DEFLECTOR') {
    // Planar Collision Grid with Bouncing Normal Arrow
    const gridN = 4;
    for (let i = 0; i <= gridN; i++) {
      const u = (i / gridN - 0.5) * s * 2;
      const a0 = addV(u, 0, -s);
      const a1 = addV(u, 0, s);
      const b0 = addV(-s, 0, u);
      const b1 = addV(s, 0, u);
      addE(a0, a1);
      addE(b0, b1);
    }
    // Deflector normal bounce vector
    const c0 = addV(0, 0, 0);
    const c1 = addV(0, s * 1.2, 0);
    const cL = addV(-s * 0.25, s * 0.85, 0);
    const cR = addV(s * 0.25, s * 0.85, 0);
    addE(c0, c1); addE(c1, cL); addE(c1, cR);

  } else if (type === 'WAVE' || type === 'RIPPLE') {
    // Concentric Ripples or Sinusoidal Mesh Grid
    const rings = 4;
    const ringSegs = 24;
    for (let r = 1; r <= rings; r++) {
      const rad = (r / rings) * s;
      const waveY = Math.sin((r / rings) * Math.PI * 3) * s * 0.25;
      let pIdx = -1;
      let fIdx = -1;
      for (let i = 0; i < ringSegs; i++) {
        const a = (i / ringSegs) * Math.PI * 2;
        const idx = addV(Math.cos(a) * rad, waveY, Math.sin(a) * rad);
        if (i === 0) fIdx = idx;
        if (pIdx !== -1) addE(pIdx, idx);
        pIdx = idx;
      }
      if (pIdx !== -1 && fIdx !== -1) addE(pIdx, fIdx);
    }
  } else {
    // Push / Radial Attractor Starburst
    const numSpikes = 8;
    const center = addV(0, 0, 0);
    for (let i = 0; i < numSpikes; i++) {
      const phi = Math.acos(-1 + (2 * i) / numSpikes);
      const theta = Math.sqrt(numSpikes * Math.PI) * phi;
      const x = Math.cos(theta) * Math.sin(phi) * s;
      const y = Math.sin(theta) * Math.sin(phi) * s;
      const z = Math.cos(phi) * s;
      const spk = addV(x, y, z);
      addE(center, spk);
    }
  }

  return {
    vertices: verts,
    faces: [], // Pure wireframe gizmo
    wireframeEdges: edges
  };
}

/**
 * Builds Emitter Visualization Wireframe for Particle System
 */
export function buildParticleEmitterGizmo(config: ParticleSystemConfig): { vertices: V3[]; faces: any[]; wireframeEdges: [number, number][] } {
  const verts: V3[] = [];
  const edges: [number, number][] = [];
  const addV = (x: number, y: number, z: number): number => {
    verts.push([x, y, z]);
    return verts.length - 1;
  };
  const addE = (a: number, b: number) => {
    edges.push([a, b]);
  };

  const s = 0.5;
  const spreadRad = ((config.spread || 30) * Math.PI) / 180;
  const coneRadius = Math.tan(spreadRad * 0.5) * s * 2;

  // Emitter base circle / point
  const segs = 16;
  let pIdx = -1, fIdx = -1;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const idx = addV(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
    if (i === 0) fIdx = idx;
    if (pIdx !== -1) addE(pIdx, idx);
    pIdx = idx;
  }
  if (pIdx !== -1 && fIdx !== -1) addE(pIdx, fIdx);

  // Emitter spray cone bounds
  const topY = s * 2;
  let pTop = -1, fTop = -1;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const idx = addV(Math.cos(a) * Math.max(0.3, coneRadius), topY, Math.sin(a) * Math.max(0.3, coneRadius));
    if (i === 0) fTop = idx;
    if (pTop !== -1) addE(pTop, idx);
    pTop = idx;
    if (i % 4 === 0) {
      const origin = addV(0, 0, 0);
      addE(origin, idx);
    }
  }
  if (pTop !== -1 && fTop !== -1) addE(pTop, fTop);

  return {
    vertices: verts,
    faces: [],
    wireframeEdges: edges
  };
}
