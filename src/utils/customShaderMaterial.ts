import * as THREE from 'three';
import { CSMBaseMaterialType, CSMConfig, CSMPresetType, MaterialData } from '../types';

/**
 * Common GLSL Math and Noise functions for CustomShaderMaterial.
 */
export const CSM_COMMON_GLSL = `
  // Simplex 3D Noise
  vec3 csm_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 csm_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 csm_permute(vec4 x) { return csm_mod289(((x*34.0)+1.0)*x); }
  vec4 csm_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float csm_snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = csm_mod289(i);
    vec4 p = csm_permute(csm_permute(csm_permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = csm_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // 3D Fractal Brownian Motion
  float csm_fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 4; i++) {
      val += amp * csm_snoise(p * freq);
      freq *= 2.05;
      amp *= 0.5;
    }
    return val;
  }

  // 3D Voronoi Cellular Noise
  float csm_voronoi(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float minDist = 1.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 neighbor = vec3(float(x), float(y), float(z));
          vec3 cell = i + neighbor;
          vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)),
                                  dot(cell, vec3(269.5, 183.3, 246.1)),
                                  dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          vec3 pt = neighbor + h - f;
          float d = length(pt);
          if (d < minDist) minDist = d;
        }
      }
    }
    return minDist;
  }
`;

export interface CSMPresetDefinition {
  id: CSMPresetType;
  name: string;
  category: string;
  icon: string;
  description: string;
  defaultBaseMaterial: CSMBaseMaterialType;
  defaultParams: Partial<CSMConfig>;
  vertexCode: string;
  fragmentCode: string;
}

export const CSM_PRESETS: CSMPresetDefinition[] = [
  {
    id: 'wave_distortion',
    name: 'Ondas Líquidas & Vórtice',
    category: 'Vértices & Deformación',
    icon: '🌊',
    description: 'Cáusticas y ondas fluidas tridimensionales en tiempo real con reflejos y resplandor acuático',
    defaultBaseMaterial: 'MeshPhysicalMaterial',
    defaultParams: {
      timeSpeed: 1.2,
      displacementScale: 0.0,
      noiseFrequency: 2.0,
      colorAccent: '#38bdf8',
      glowIntensity: 1.0,
      roughnessMod: 0.1,
      metalnessMod: 0.15
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        vec3 csm_dispDir = length(position) > 0.0001 ? normalize(position) : normalize(normal);
        float wave = sin(position.y * uNoiseFreq * 3.0 + uTime * uTimeSpeed) * 0.5 + 0.5;
        float noiseDisp = csm_snoise(position * uNoiseFreq + vec3(0.0, uTime * uTimeSpeed * 0.4, 0.0));
        float totalDisp = (wave * 0.4 + noiseDisp * 0.6) * uDisplacementScale;
        transformed += csm_dispDir * totalDisp;

        vec3 tangentWave = vec3(-cos(position.y * 3.0 + uTime) * 0.2, 1.0, 0.0);
        transformedNormal = normalize(normal + tangentWave * totalDisp * 2.0);
      }
    `,
    fragmentCode: `
      vec3 p = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;
      
      // Ondas tridimensionales direccionales entrecruzadas + ruido Simplex fluido continuo
      float wave1 = sin(p.x * 2.2 + p.y * 1.5 + t * 1.8);
      float wave2 = sin(p.z * 2.4 - p.x * 1.7 + t * 1.4);
      float wave3 = cos(p.y * 2.0 + p.z * 1.8 - t * 1.6);
      
      float n1 = csm_snoise(p * 1.2 + vec3(t * 0.25, -t * 0.15, t * 0.2));
      float n2 = csm_snoise(p * 2.4 + vec3(-t * 0.2, t * 0.3, -t * 0.25));

      float fluidPattern = (wave1 + wave2 + wave3) * 0.16 + (n1 * 0.35 + n2 * 0.15) + 0.5;
      fluidPattern = clamp(fluidPattern, 0.0, 1.0);

      // Cáusticas nítidas y brillantes sin artefactos radiales ni círculos
      float caustic = pow(fluidPattern, 2.8) * 1.6;

      vec3 deepWater = diffuseColor.rgb * 0.65;
      vec3 shallowWater = mix(diffuseColor.rgb, uColorAccent, 0.8);
      vec3 causticColor = mix(uColorAccent, vec3(0.95, 0.98, 1.0), 0.6);

      vec3 fluidColor = mix(deepWater, shallowWater, fluidPattern);
      fluidColor += causticColor * caustic * (0.7 + uGlowIntensity * 0.5);

      diffuseColor.rgb = fluidColor;
    `
  },
  {
    id: 'hologram_shield',
    name: 'Escudo Holográfico Sci-Fi',
    category: 'Efectos & Shaders',
    icon: '⚡',
    description: 'Rejilla cibernética anti-aliased, barrido de haz láser y resplandor de energía',
    defaultBaseMaterial: 'MeshStandardMaterial',
    defaultParams: {
      timeSpeed: 1.8,
      displacementScale: 0.0,
      noiseFrequency: 6.0,
      colorAccent: '#06b6d4',
      glowIntensity: 2.0,
      roughnessMod: 0.15,
      metalnessMod: 0.0
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        vec3 csm_dispDir = length(position) > 0.0001 ? normalize(position) : normalize(normal);
        float pulse = sin(position.y * 5.0 + uTime * uTimeSpeed * 3.0) * 0.5 + 0.5;
        transformed += csm_dispDir * (pulse * uDisplacementScale * 0.5);
      }
    `,
    fragmentCode: `
      vec3 wp = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;

      // Rejilla cibernética continua y suavizada en 3D
      vec3 gridFract = abs(fract(wp) - 0.5);
      vec3 gridLines = smoothstep(0.44, 0.49, gridFract);
      float grid = max(gridLines.x, max(gridLines.y, gridLines.z));

      // Barrido de haz de energía láser en altura Y
      float sweep = sin(vWorldPosition.y * 8.0 - t * 4.0) * 0.5 + 0.5;
      sweep = smoothstep(0.7, 0.98, sweep);

      vec3 baseHolo = mix(diffuseColor.rgb, uColorAccent, 0.85);
      diffuseColor.rgb = baseHolo * (0.45 + grid * 0.65 + sweep * 1.1);
      diffuseColor.rgb += uColorAccent * (sweep * 0.7 + grid * 0.5) * uGlowIntensity;
      diffuseColor.a = clamp(0.4 + grid * 0.4 + sweep * 0.45, 0.2, 1.0);
    `
  },
  {
    id: 'volcanic_magma',
    name: 'Magma & Lava Volcánica',
    category: 'Procedural Dinámico',
    icon: '🌋',
    description: 'Corteza basáltica rocosa con fracturas incandescentes de magma ardiente',
    defaultBaseMaterial: 'MeshStandardMaterial',
    defaultParams: {
      timeSpeed: 0.8,
      displacementScale: 0.0,
      noiseFrequency: 3.5,
      colorAccent: '#ff3b00',
      glowIntensity: 3.0,
      roughnessMod: 0.85,
      metalnessMod: 0.1
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        vec3 csm_dispDir = length(position) > 0.0001 ? normalize(position) : normalize(normal);
        float noiseDisp = csm_snoise(position * uNoiseFreq + vec3(uTime * 0.1));
        transformed += csm_dispDir * (noiseDisp * uDisplacementScale * 0.5);
      }
    `,
    fragmentCode: `
      vec3 wp = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;

      // Fracturas incandescentes usando ruido fractal continuo 3D
      float noise1 = csm_fbm(wp + vec3(0.0, t * 0.12, 0.0));
      float noise2 = csm_snoise(wp * 2.0 - vec3(t * 0.15, 0.0, t * 0.1));
      float fissureField = noise1 * 0.7 + noise2 * 0.3;

      float magmaMask = smoothstep(0.2, 0.55, fissureField);
      float coreHeat = smoothstep(0.42, 0.68, fissureField);

      vec3 basaltCrust = vec3(0.07, 0.06, 0.06);
      vec3 orangeLava = mix(vec3(0.95, 0.15, 0.0), uColorAccent, 0.3);
      vec3 hotYellowLava = vec3(1.0, 0.85, 0.2);

      float pulse = sin(t * 2.2 + fissureField * 7.0) * 0.25 + 0.75;
      vec3 activeLava = mix(orangeLava, hotYellowLava, coreHeat) * (1.1 + pulse * 0.7) * uGlowIntensity;

      diffuseColor.rgb = mix(activeLava, basaltCrust, magmaMask);
    `
  },
  {
    id: 'bio_organic_flesh',
    name: 'Tejido Bio-Orgánico',
    category: 'Procedural Dinámico',
    icon: '🧬',
    description: 'Pulsación orgánica celular y venas reactivas en tiempo real',
    defaultBaseMaterial: 'MeshPhysicalMaterial',
    defaultParams: {
      timeSpeed: 1.5,
      displacementScale: 0.0,
      noiseFrequency: 3.0,
      colorAccent: '#e11d48',
      glowIntensity: 0.8,
      roughnessMod: 0.35,
      metalnessMod: 0.0
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        vec3 csm_dispDir = length(position) > 0.0001 ? normalize(position) : normalize(normal);
        float pulse = sin(uTime * uTimeSpeed * 3.0) * 0.03;
        float organicNoise = csm_snoise(position * uNoiseFreq + vec3(sin(uTime * 0.5), cos(uTime * 0.5), 0.0));
        transformed += csm_dispDir * ((organicNoise + pulse) * uDisplacementScale);
      }
    `,
    fragmentCode: `
      vec3 wp = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;

      float cell = csm_voronoi(wp * 1.4 + vec3(sin(t * 0.5) * 0.1, cos(t * 0.5) * 0.1, 0.0));
      float veins = 1.0 - smoothstep(0.06, 0.28, cell);
      float pulse = sin(t * 2.8 + wp.y * 2.0) * 0.5 + 0.5;

      vec3 baseFlesh = diffuseColor.rgb;
      vec3 veinColor = mix(uColorAccent, vec3(0.9, 0.05, 0.2), 0.4);

      diffuseColor.rgb = mix(baseFlesh, veinColor * (1.1 + pulse * 0.5), veins * 0.85);
      diffuseColor.rgb += veinColor * veins * pulse * uGlowIntensity * 0.5;
    `
  },
  {
    id: 'quantum_crystal',
    name: 'Cristal Cuántico Facetado',
    category: 'Efectos & Shaders',
    icon: '💎',
    description: 'Estructura angular con reflexión de interferencia cuántica',
    defaultBaseMaterial: 'MeshPhysicalMaterial',
    defaultParams: {
      timeSpeed: 1.0,
      displacementScale: 0.0,
      noiseFrequency: 3.5,
      colorAccent: '#818cf8',
      glowIntensity: 1.2,
      roughnessMod: 0.05,
      metalnessMod: 0.4
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        vec3 csm_dispDir = length(position) > 0.0001 ? normalize(position) : normalize(normal);
        float facet = csm_snoise(position * uNoiseFreq);
        transformed += csm_dispDir * (facet * uDisplacementScale * 0.5);
      }
    `,
    fragmentCode: `
      float t = uTime * uTimeSpeed;
      vec3 wp = vWorldPosition * uNoiseFreq;
      float lattice = csm_snoise(wp + vec3(t * 0.15));

      // Iridiscencia continua espacial tridimensional
      float phase = (wp.x * 0.4 + wp.y * 0.4 + wp.z * 0.4) + lattice * 1.2 + t * 0.25;
      vec3 irid = vec3(
        sin(phase * 3.1415 + 0.0) * 0.5 + 0.5,
        sin(phase * 3.1415 + 2.094) * 0.5 + 0.5,
        sin(phase * 3.1415 + 4.188) * 0.5 + 0.5
      );

      vec3 crystalBase = mix(diffuseColor.rgb, vec3(0.85, 0.95, 1.0), 0.45);
      diffuseColor.rgb = mix(crystalBase, irid, 0.55) + uColorAccent * (lattice * 0.4 + 0.4) * uGlowIntensity * 0.6;
    `
  },
  {
    id: 'twist_vortex',
    name: 'Torsión & Vórtice Espacial',
    category: 'Vértices & Deformación',
    icon: '🌀',
    description: 'Torsión espacial helicoidal a lo largo del eje Y con energía pulsante',
    defaultBaseMaterial: 'MeshStandardMaterial',
    defaultParams: {
      timeSpeed: 1.2,
      displacementScale: 0.0,
      noiseFrequency: 2.0,
      colorAccent: '#a855f7',
      glowIntensity: 1.8,
      roughnessMod: 0.2,
      metalnessMod: 0.6
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        float angle = position.y * (uDisplacementScale * 3.0) + (uTime * uTimeSpeed * 0.5 * uDisplacementScale);
        float c = cos(angle);
        float s = sin(angle);
        mat2 rot = mat2(c, -s, s, c);
        transformed.xz = rot * transformed.xz;
        transformedNormal.xz = rot * transformedNormal.xz;
      }
    `,
    fragmentCode: `
      vec3 wp = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;

      // Cintas helicoidales tridimensionales continuas
      float helix1 = sin(wp.x * 2.0 + wp.y * 3.0 + t * 2.5) * 0.5 + 0.5;
      float helix2 = cos(wp.z * 2.0 - wp.y * 3.0 + t * 2.0) * 0.5 + 0.5;
      float swirl = sin((wp.x + wp.z) * 2.5 + wp.y * 1.5 - t * 3.0) * 0.5 + 0.5;
      float vortexEnergy = (helix1 * helix2 + swirl * 0.5) * 0.8;
      
      vec3 coreColor = diffuseColor.rgb * 0.6;
      vec3 vortexGlow = mix(uColorAccent, vec3(0.9, 0.6, 1.0), swirl);

      diffuseColor.rgb = mix(coreColor, vortexGlow, vortexEnergy);
      diffuseColor.rgb += uColorAccent * pow(vortexEnergy, 2.0) * uGlowIntensity * 1.2;
    `
  },
  {
    id: 'digital_wire_glitch',
    name: 'Glitch Digital & Rejilla Cyber',
    category: 'Efectos & Shaders',
    icon: '👾',
    description: 'Desplazamiento binario por capas y distorsión de datos cibernéticos',
    defaultBaseMaterial: 'MeshStandardMaterial',
    defaultParams: {
      timeSpeed: 2.5,
      displacementScale: 0.0,
      noiseFrequency: 5.0,
      colorAccent: '#10b981',
      glowIntensity: 2.0,
      roughnessMod: 0.3,
      metalnessMod: 0.1
    },
    vertexCode: `
      if (uDisplacementScale > 0.0001) {
        float stepSlice = floor(position.y * 8.0);
        float glitchRand = fract(sin(stepSlice * 32.123 + floor(uTime * uTimeSpeed * 4.0)) * 43758.5453);
        if (glitchRand > 0.85) {
          transformed.x += (glitchRand - 0.5) * uDisplacementScale;
          transformed.z += (glitchRand - 0.5) * uDisplacementScale;
        }
      }
    `,
    fragmentCode: `
      vec3 wp = vWorldPosition * uNoiseFreq;
      float t = uTime * uTimeSpeed;

      // Matriz de circuitos cyber suavizada
      vec3 gridMod = abs(fract(wp * 1.1) - 0.5);
      float circuits = smoothstep(0.43, 0.48, max(gridMod.x, max(gridMod.y, gridMod.z)));

      // Pulsos de bloques de datos
      float dataTime = floor(t * 5.0);
      float randBlock = fract(sin(dot(floor(wp * 0.7), vec3(12.9898, 78.233, 45.164)) + dataTime) * 43758.5453);
      float dataPulse = step(0.84, randBlock);

      vec3 cyberBase = diffuseColor.rgb * 0.45;
      vec3 pulseColor = mix(uColorAccent, vec3(0.2, 1.0, 0.6), 0.5);

      diffuseColor.rgb = mix(cyberBase, pulseColor, circuits * 0.7 + dataPulse * 0.9);
      diffuseColor.rgb += uColorAccent * (circuits * 0.5 + dataPulse * 1.2) * uGlowIntensity;
    `
  },
  {
    id: 'comic_halftone',
    name: 'Sombreado Cómic / Pop-Art',
    category: 'Efectos & Shaders',
    icon: '🎨',
    description: 'Tramado de puntos halftone estilo historieta con realce de bordes entintados',
    defaultBaseMaterial: 'MeshToonMaterial',
    defaultParams: {
      timeSpeed: 0.0,
      displacementScale: 0.0,
      noiseFrequency: 24.0,
      colorAccent: '#fbbf24',
      glowIntensity: 0.0,
      roughnessMod: 0.5,
      metalnessMod: 0.0
    },
    vertexCode: `
      // Sin deformación geométrica por defecto
    `,
    fragmentCode: `
      vec3 nDir = normalize(vNormal);
      vec3 lightDir = normalize(vec3(0.6, 0.8, 0.5));
      float NdotL = clamp(dot(nDir, lightDir), 0.0, 1.0);

      // Puntos halftone continuos y suavizados (anti-aliased)
      vec2 uvDot = gl_FragCoord.xy / max(1.0, 35.0 - uNoiseFreq * 0.5);
      vec2 dotGrid = fract(uvDot) - 0.5;
      float dist = length(dotGrid);
      float radius = clamp(1.0 - NdotL, 0.06, 0.46);
      float dotMask = smoothstep(radius - 0.04, radius + 0.04, dist);

      // Bandas de entintado estilo cómic
      float band = step(0.35, NdotL) * 0.4 + step(0.72, NdotL) * 0.6;
      vec3 inkColor = diffuseColor.rgb * 0.22;
      vec3 litColor = mix(diffuseColor.rgb, uColorAccent, 0.3);

      diffuseColor.rgb = mix(inkColor, litColor * (band * 0.55 + 0.45), dotMask);
    `
  },
  {
    id: 'soap_bubble',
    name: 'Pompa de Jabón (Interferencia de Película Delgada)',
    category: 'Vidrio & Transmisión',
    icon: '🫧',
    description: 'Física óptica de interferencia por película delgada con espesor dinámico (250-800nm), halo fucsia/magenta/cian en bordes rasantes y transparencia cristalina.',
    defaultBaseMaterial: 'MeshPhysicalMaterial',
    defaultParams: {
      timeSpeed: 0.7,
      displacementScale: 0.008,
      noiseFrequency: 1.8,
      colorAccent: '#ff26aa',
      glowIntensity: 1.8,
      roughnessMod: 0.005,
      metalnessMod: 0.0
    },
    vertexCode: `
      // Micro-ondulación orgánica sutil por tensión superficial
      if (uDisplacementScale > 0.0001) {
        float bubbleWobble = sin(uTime * uTimeSpeed * 1.5 + position.y * 2.2) * cos(position.x * 2.2 + position.z * 2.2 + uTime * uTimeSpeed * 1.1);
        transformed += normal * (bubbleWobble * uDisplacementScale * 0.05);
      }
    `,
    fragmentCode: `
      // View direction towards camera and surface normal in View Space (100% 360° invariant)
      vec3 vDir = length(vViewPosition) > 0.0001 ? normalize(vViewPosition) : vec3(0.0, 0.0, 1.0);
      vec3 nDir = length(vCSMNormal) > 0.0001 ? normalize(vCSMNormal) : vec3(0.0, 0.0, 1.0);
      float NdotV = clamp(abs(dot(nDir, vDir)), 0.0001, 1.0);

      // Exponentes Fresnel: borde rasante brillante y centro ultra-transparente
      float fresnel = pow(1.0 - NdotV, 2.0);
      float rimThin = pow(1.0 - NdotV, 4.0);
      float rimUltra = pow(1.0 - NdotV, 7.5);

      // Torbellinos fluidos y suaves de espesor (Marangoni flow / drenaje gravitacional)
      vec3 posCoord = vWorldPosition * (uNoiseFreq * 0.4);
      float flowTime = uTime * uTimeSpeed * 0.12;

      vec3 swirl = vec3(
        csm_snoise(posCoord + vec3(0.0, -flowTime * 0.45, 0.0)),
        csm_snoise(posCoord + vec3(4.3, 1.7, flowTime * 0.3)),
        csm_snoise(posCoord + vec3(flowTime * 0.25, 3.1, 1.2))
      );

      float flowNoise = csm_snoise(posCoord + swirl * 0.6 + vec3(0.0, -flowTime * 0.65, 0.0));

      // Espesor de película jabonosa en nanómetros (280nm a 660nm)
      float filmThicknessNm = mix(300.0, 640.0, flowNoise * 0.5 + 0.5) + (1.0 - NdotV) * 90.0;

      // Camino óptico (OPD) con índice de refracción del agua jabonosa n = 1.333
      float cosThetaT = sqrt(max(0.0, 1.0 - (1.0 - NdotV * NdotV) / (1.333 * 1.333)));
      float opd = 2.0 * 1.333 * filmThicknessNm * cosThetaT;

      // Espectro de interferencia constructiva Airy para RGB (640nm, 530nm, 460nm)
      vec3 lambda = vec3(640.0, 530.0, 460.0);
      vec3 phase = (opd / lambda) * 6.2831853 - 3.14159265;
      vec3 airyInterference = 0.5 + 0.5 * cos(phase);

      // Paleta cromática exacta de la referencia real (Getty reference):
      // - Halo exterior periférico 360°: Magenta/fucsia brillante y violeta profundo
      // - Sub-halo interior: Azul cielo / cian eléctrico y sutiles destellos esmeralda/dorado
      vec3 magentaPink = vec3(1.0, 0.12, 0.76);  // #ff1ec2
      vec3 electricCyan = vec3(0.0, 0.92, 1.0);   // #00ebff
      vec3 royalViolet = vec3(0.68, 0.20, 1.0);   // #ad33ff
      vec3 goldenSun = vec3(1.0, 0.88, 0.35);    // #ffe059

      vec3 filmColor = mix(airyInterference, mix(electricCyan, magentaPink, airyInterference.r), 0.45);

      // Resplandor en el borde rasante 360° (Fresnel rim continuo)
      vec3 rimSpectral = mix(electricCyan, magentaPink, smoothstep(0.2, 0.7, fresnel));
      rimSpectral = mix(rimSpectral, royalViolet, smoothstep(0.7, 0.98, fresnel));
      vec3 rimRadiance = rimSpectral * (fresnel * 2.2 + rimThin * 3.4 + rimUltra * 2.5) * (uGlowIntensity * 1.3);

      // Reflejo especular espejo de la superficie brillante de la pompa
      vec3 specularReflection = vec3(1.0) * pow(1.0 - NdotV, 4.5) * 1.6;

      // Mezcla: centro ultra-diáfano (baja opacidad base) con halo perimetral esférico permanente
      diffuseColor.rgb = filmColor * (0.12 + fresnel * 0.65) + rimRadiance + specularReflection;
      diffuseColor.a = clamp(0.10 + fresnel * 0.85 + rimThin * 0.4, 0.06, 0.98);
    `
  }
];

/**
 * Creates a CustomShaderMaterial instance by wrapping standard Three.js materials
 * and compiling vertex/fragment overrides with hot uniform synchronization.
 */
export function createCustomShaderMaterial(
  csmConfig: CSMConfig,
  baseData: MaterialData,
  baseTextures: {
    map?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
  } = {}
): THREE.Material {
  const baseType = csmConfig.baseMaterial || 'MeshPhysicalMaterial';
  let material: THREE.Material;

  switch (baseType) {
    case 'MeshStandardMaterial':
      material = new THREE.MeshStandardMaterial();
      break;
    case 'MeshToonMaterial':
      material = new THREE.MeshToonMaterial();
      break;
    case 'MeshLambertMaterial':
      material = new THREE.MeshLambertMaterial();
      break;
    case 'MeshBasicMaterial':
      material = new THREE.MeshBasicMaterial();
      break;
    case 'MeshPhysicalMaterial':
    default:
      material = new THREE.MeshPhysicalMaterial();
      break;
  }

  const isSoapBubble = csmConfig.preset === 'soap_bubble';
  const isHolo = csmConfig.preset === 'hologram_shield';

  // Apply standard material parameters
  const m = material as any;
  m.name = baseData.name || 'CustomShaderMaterial';
  m.color.set(baseData.color || (isSoapBubble ? '#ffffff' : '#ffffff'));
  if ('roughness' in m) m.roughness = isSoapBubble ? 0.005 : (baseData.roughness ?? (csmConfig.roughnessMod ?? 0.5));
  if ('metalness' in m) m.metalness = isSoapBubble ? 0.0 : (baseData.metalness ?? (csmConfig.metalnessMod ?? 0.0));
  if ('emissive' in m) m.emissive.set(baseData.emissive || '#000000');
  if ('emissiveIntensity' in m) m.emissiveIntensity = baseData.emissiveIntensity ?? 1;
  m.opacity = isSoapBubble ? 0.35 : (baseData.opacity ?? 1);
  m.transparent = isSoapBubble || isHolo || (baseData.transparent ?? (m.opacity < 1));
  m.depthWrite = isSoapBubble ? false : true;
  m.side = THREE.DoubleSide;

  // Physical Transmission, Clearcoat, Iridescence & IOR support
  if ('transmission' in m) {
    m.transmission = isSoapBubble ? 0.98 : (baseData.transmission ?? 0);
    m.ior = isSoapBubble ? 1.333 : (baseData.ior ?? 1.5);
    m.thickness = isSoapBubble ? 0.05 : (baseData.thickness ?? 0);
    m.specularIntensity = isSoapBubble ? 1.0 : (baseData.specularIntensity ?? 1);
    if (baseData.specularColor) m.specularColor.set(baseData.specularColor);
    m.clearcoat = isSoapBubble ? 1.0 : (baseData.clearcoat ?? 0);
    m.clearcoatRoughness = isSoapBubble ? 0.0 : (baseData.clearcoatRoughness ?? 0);
    m.iridescence = isSoapBubble ? 1.0 : (baseData.iridescence ?? 0);
    m.iridescenceIOR = isSoapBubble ? 1.333 : (baseData.iridescenceIOR ?? 1.3);
    m.iridescenceThicknessRange = isSoapBubble ? [200, 750] : (baseData.iridescenceThicknessRange || [100, 400]);
    if (baseData.attenuationColor) m.attenuationColor.set(baseData.attenuationColor);
    if (baseData.attenuationDistance !== undefined) m.attenuationDistance = baseData.attenuationDistance;
  }

  if (baseTextures.map) m.map = baseTextures.map;
  if (baseTextures.normalMap && 'normalMap' in m) m.normalMap = baseTextures.normalMap;
  if (baseTextures.roughnessMap && 'roughnessMap' in m) m.roughnessMap = baseTextures.roughnessMap;
  if (baseTextures.metalnessMap && 'metalnessMap' in m) m.metalnessMap = baseTextures.metalnessMap;
  if (baseTextures.aoMap && 'aoMap' in m) m.aoMap = baseTextures.aoMap;
  if (baseTextures.emissiveMap && 'emissiveMap' in m) m.emissiveMap = baseTextures.emissiveMap;

  // Resolve preset codes or custom shaders
  const activePreset = CSM_PRESETS.find(p => p.id === csmConfig.preset);
  const vertexSnippet = csmConfig.vertexShader || activePreset?.vertexCode || '';
  const fragmentSnippet = csmConfig.fragmentShader || activePreset?.fragmentCode || '';

  const accentCol = new THREE.Color(csmConfig.colorAccent || activePreset?.defaultParams.colorAccent || '#38bdf8');

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0.0 };
    shader.uniforms.uTimeSpeed = { value: csmConfig.timeSpeed ?? activePreset?.defaultParams.timeSpeed ?? 1.0 };
    shader.uniforms.uDisplacementScale = { value: csmConfig.displacementScale ?? activePreset?.defaultParams.displacementScale ?? 0.0 };
    shader.uniforms.uNoiseFreq = { value: csmConfig.noiseFrequency ?? activePreset?.defaultParams.noiseFrequency ?? 2.5 };
    shader.uniforms.uColorAccent = { value: accentCol };
    shader.uniforms.uGlowIntensity = { value: csmConfig.glowIntensity ?? activePreset?.defaultParams.glowIntensity ?? 1.0 };

    // Inject Common GLSL & varying declarations into vertex shader
    shader.vertexShader = `
      uniform float uTime;
      uniform float uTimeSpeed;
      uniform float uDisplacementScale;
      uniform float uNoiseFreq;
      uniform vec3 uColorAccent;
      uniform float uGlowIntensity;
      #ifndef USE_TRANSMISSION
      varying vec3 vWorldPosition;
      #endif
      varying vec3 vCSMNormal;
      ${CSM_COMMON_GLSL}
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vCSMNormal = normalize(normalMatrix * normal);
      
      // --- CSM Vertex Injection ---
      ${vertexSnippet}
      `
    );

    // Inject into Fragment Shader
    shader.fragmentShader = `
      uniform float uTime;
      uniform float uTimeSpeed;
      uniform float uDisplacementScale;
      uniform float uNoiseFreq;
      uniform vec3 uColorAccent;
      uniform float uGlowIntensity;
      #ifndef USE_TRANSMISSION
      varying vec3 vWorldPosition;
      #endif
      varying vec3 vCSMNormal;
      ${CSM_COMMON_GLSL}
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      
      // --- CSM Fragment Injection ---
      ${fragmentSnippet}
      `
    );

    material.userData.shader = shader;
    material.userData.isCSM = true;
  };

  material.customProgramCacheKey = () => {
    return `CSM_${csmConfig.baseMaterial || 'phys'}_${csmConfig.preset || 'custom'}_${csmConfig.vertexShader ? 'v1' : 'v0'}_${csmConfig.fragmentShader ? 'f1' : 'f0'}`;
  };

  return material;
}

/**
 * Updates CSM uniforms during the rendering loop.
 */
export function updateCSMUniforms(material: THREE.Material, time: number, csmConfig?: CSMConfig) {
  const shader = material.userData.shader;
  if (!shader || !shader.uniforms) return;

  if (shader.uniforms.uTime) {
    shader.uniforms.uTime.value = time;
  }
  if (csmConfig) {
    if (shader.uniforms.uTimeSpeed && csmConfig.timeSpeed !== undefined) {
      shader.uniforms.uTimeSpeed.value = csmConfig.timeSpeed;
    }
    if (shader.uniforms.uDisplacementScale && csmConfig.displacementScale !== undefined) {
      shader.uniforms.uDisplacementScale.value = csmConfig.displacementScale;
    }
    if (shader.uniforms.uNoiseFreq && csmConfig.noiseFrequency !== undefined) {
      shader.uniforms.uNoiseFreq.value = csmConfig.noiseFrequency;
    }
    if (shader.uniforms.uGlowIntensity && csmConfig.glowIntensity !== undefined) {
      shader.uniforms.uGlowIntensity.value = csmConfig.glowIntensity;
    }
    if (shader.uniforms.uColorAccent && csmConfig.colorAccent) {
      shader.uniforms.uColorAccent.value.set(csmConfig.colorAccent);
    }
  }
}
