import * as THREE from 'three';
import { GlassMaterialConfig, GlassPresetType, MaterialData } from '../types';

export interface GlassPresetDefinition {
  id: GlassPresetType;
  name: string;
  category: string;
  icon: string;
  description: string;
  defaultParams: Partial<GlassMaterialConfig>;
  pbrParams: {
    color: string;
    roughness: number;
    metalness: number;
    transmission: number;
    ior: number;
    thickness: number;
    dispersion: number;
    attenuationColor: string;
    attenuationDistance: number;
    clearcoat: number;
    clearcoatRoughness: number;
    iridescence?: number;
    iridescenceIOR?: number;
    iridescenceThicknessRange?: [number, number];
  };
}

export const WEBGPU_GLASS_PRESETS: GlassPresetDefinition[] = [
  {
    id: 'newton_dispersion_prism',
    name: 'Prisma Óptico de Newton',
    category: 'Dispersión Espectral',
    icon: '💎',
    description: 'Dispersión espectral máxima que descompone la luz en un arcoíris cromático completo',
    defaultParams: {
      dispersion: 0.12,
      chromaticAberration: 0.08,
      distortion: 0.0,
      frostedBlur: 0.0,
      rimGlow: 1.5,
      rimColor: '#a5b4fc',
      thinFilmIridescence: 0.6,
      internalBubbles: false,
      causticIntensity: 1.6
    },
    pbrParams: {
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
      iridescenceThicknessRange: [200, 700]
    }
  },
  {
    id: 'diamond_spectral',
    name: 'Diamante Brillante Cuántico',
    category: 'Gemas & Cristales',
    icon: '✨',
    description: 'Altísimo índice de refracción (IOR 2.42) con destellos de fuego interior y bordes prismáticos',
    defaultParams: {
      dispersion: 0.18,
      chromaticAberration: 0.12,
      distortion: 0.02,
      frostedBlur: 0.0,
      rimGlow: 2.2,
      rimColor: '#e0e7ff',
      thinFilmIridescence: 0.9,
      causticIntensity: 2.0
    },
    pbrParams: {
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
      iridescenceThicknessRange: [300, 800]
    }
  },
  {
    id: 'soap_bubble_spectral',
    name: 'Pompa de Jabón Espectral (WebGPU)',
    category: 'Vidrio & Gemas',
    icon: '🫧',
    description: 'Película ultra-delgada con refracción física, dispersión de Cauchy, iridiscencia espectral y ondulación orgánica',
    defaultParams: {
      dispersion: 0.14,
      chromaticAberration: 0.08,
      distortion: 0.015,
      distortionSpeed: 1.0,
      distortionFrequency: 2.0,
      frostedBlur: 0.0,
      rimGlow: 2.0,
      rimColor: '#ff26aa',
      thinFilmIridescence: 1.0,
      internalBubbles: false,
      causticIntensity: 1.2
    },
    pbrParams: {
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
      iridescenceThicknessRange: [200, 750]
    }
  },
  {
    id: 'frosted_mist_glass',
    name: 'Vidrio Esmerilado de Niebla',
    category: 'Translúcidos & Difusos',
    icon: '🌫️',
    description: 'Transmisión mate difuminada con micro-rugosidad suave y dispersión subsuperficial',
    defaultParams: {
      dispersion: 0.03,
      chromaticAberration: 0.02,
      distortion: 0.05,
      frostedBlur: 0.85,
      rimGlow: 0.8,
      rimColor: '#f1f5f9',
      thinFilmIridescence: 0.0,
      internalBubbles: false,
      causticIntensity: 0.4
    },
    pbrParams: {
      color: '#f8fafc',
      roughness: 0.38,
      metalness: 0.0,
      transmission: 0.96,
      ior: 1.52,
      thickness: 1.2,
      dispersion: 0.03,
      attenuationColor: '#e2e8f0',
      attenuationDistance: 2.5,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2
    }
  },
  {
    id: 'liquid_wave_glass',
    name: 'Cristal de Agua & Ondulación',
    category: 'Fluidos & Dinámicos',
    icon: '🌊',
    description: 'Ondulaciones de refracción líquida en tiempo real con aberración dinámica en las olas',
    defaultParams: {
      dispersion: 0.07,
      chromaticAberration: 0.06,
      distortion: 0.45,
      distortionSpeed: 1.5,
      distortionFrequency: 3.5,
      frostedBlur: 0.0,
      rimGlow: 1.2,
      rimColor: '#38bdf8',
      thinFilmIridescence: 0.3,
      causticIntensity: 1.4
    },
    pbrParams: {
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
      clearcoatRoughness: 0.02
    }
  },
  {
    id: 'smoked_obsidian',
    name: 'Obsidiana & Cristal Ahumado',
    category: 'Arquitectura & Tintados',
    icon: '🖤',
    description: 'Cristal oscuro de lujo con atenuación de Beer-Lambert y reflejos de alto contraste',
    defaultParams: {
      dispersion: 0.02,
      chromaticAberration: 0.015,
      distortion: 0.0,
      frostedBlur: 0.05,
      rimGlow: 1.4,
      rimColor: '#64748b',
      thinFilmIridescence: 0.2,
      causticIntensity: 0.6
    },
    pbrParams: {
      color: '#0f172a',
      roughness: 0.04,
      metalness: 0.1,
      transmission: 0.88,
      ior: 1.62,
      thickness: 3.0,
      dispersion: 0.02,
      attenuationColor: '#020617',
      attenuationDistance: 0.8,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02
    }
  },
  {
    id: 'handblown_bubbles',
    name: 'Vidrio Soplado con Microburbujas',
    category: 'Artesanales & Orgánicos',
    icon: '🫧',
    description: 'Inclusiones de aire internas 3D, tensión de enfriamiento y distorsión artesanal',
    defaultParams: {
      dispersion: 0.06,
      chromaticAberration: 0.04,
      distortion: 0.2,
      distortionFrequency: 2.0,
      frostedBlur: 0.1,
      internalBubbles: true,
      bubbleDensity: 1.8,
      bubbleScale: 24.0,
      rimGlow: 1.1,
      rimColor: '#e0f2fe',
      causticIntensity: 1.2
    },
    pbrParams: {
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
      clearcoatRoughness: 0.04
    }
  },
  {
    id: 'dichroic_rainbow',
    name: 'Vidrio Dicroico Iridiscente',
    category: 'Óptica Avanzada',
    icon: '🌈',
    description: 'Filtro dicroico de película fina que cambia de color cian/oro/magenta según la incidencia',
    defaultParams: {
      dispersion: 0.14,
      chromaticAberration: 0.1,
      distortion: 0.03,
      frostedBlur: 0.0,
      rimGlow: 2.0,
      rimColor: '#f43f5e',
      thinFilmIridescence: 1.0,
      causticIntensity: 1.8
    },
    pbrParams: {
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
      iridescenceThicknessRange: [180, 850]
    }
  },
  {
    id: 'warm_amber_liquid',
    name: 'Ámbar & Miel Cristalina',
    category: 'Gemas & Cristales',
    icon: '🍯',
    description: 'Atenuación volumétrica cálida dorada con espesor denso y destellos ámbar',
    defaultParams: {
      dispersion: 0.05,
      chromaticAberration: 0.04,
      distortion: 0.15,
      distortionFrequency: 2.5,
      frostedBlur: 0.08,
      rimGlow: 1.3,
      rimColor: '#fef08a',
      thinFilmIridescence: 0.4,
      causticIntensity: 1.5
    },
    pbrParams: {
      color: '#ffffff',
      roughness: 0.03,
      metalness: 0.0,
      transmission: 0.92,
      ior: 1.56,
      thickness: 2.8,
      dispersion: 0.05,
      attenuationColor: '#d97706',
      attenuationDistance: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02
    }
  }
];

export const WEBGPU_GLASS_COMMON_GLSL = `
  // 3D Simplex noise for glass waviness and internal flaws
  vec3 glass_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 glass_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 glass_permute(vec4 x) { return glass_mod289(((x*34.0)+1.0)*x); }
  vec4 glass_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float glass_snoise(vec3 v) {
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
    i = glass_mod289(i);
    vec4 p = glass_permute(glass_permute(glass_permute(
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
    vec4 norm = glass_taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // 3D Voronoi Cellular Noise for internal microbubbles
  float glass_voronoiBubbles(vec3 p) {
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

  // Cauchy dispersion spectral rainbow RGB decomposition
  vec3 glass_cauchySpectralRainbow(float cosAngle, float dispersionStrength) {
    float shift = (1.0 - cosAngle) * dispersionStrength * 6.28318;
    return vec3(
      sin(shift + 0.0) * 0.5 + 0.5,
      sin(shift + 2.094) * 0.5 + 0.5,
      sin(shift + 4.188) * 0.5 + 0.5
    );
  }
`;

/**
 * Injects spectral dispersion, fluid waviness, micro-bubbles, and Fresnel caustics
 * into a Three.js MeshPhysicalMaterial.
 */
export function injectWebGPUGlassShader(material: THREE.MeshPhysicalMaterial, config: GlassMaterialConfig) {
  const prevOnBeforeCompile = material.onBeforeCompile;

  const activePreset = WEBGPU_GLASS_PRESETS.find(p => p.id === config.preset);
  const rimColorObj = new THREE.Color(config.rimColor || activePreset?.defaultParams.rimColor || '#e0e7ff');

  material.onBeforeCompile = (shader, renderer) => {
    if (prevOnBeforeCompile) {
      prevOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.uGlassTime = { value: 0.0 };
    shader.uniforms.uGlassDispersion = { value: config.dispersion ?? activePreset?.defaultParams.dispersion ?? 0.08 };
    shader.uniforms.uGlassChromaticAberration = { value: config.chromaticAberration ?? activePreset?.defaultParams.chromaticAberration ?? 0.05 };
    shader.uniforms.uGlassDistortion = { value: config.distortion ?? activePreset?.defaultParams.distortion ?? 0.0 };
    shader.uniforms.uGlassDistortionSpeed = { value: config.distortionSpeed ?? activePreset?.defaultParams.distortionSpeed ?? 1.0 };
    shader.uniforms.uGlassDistortionFreq = { value: config.distortionFrequency ?? activePreset?.defaultParams.distortionFrequency ?? 2.5 };
    shader.uniforms.uGlassFrostedBlur = { value: config.frostedBlur ?? activePreset?.defaultParams.frostedBlur ?? 0.0 };
    shader.uniforms.uGlassBubbleDensity = { value: (config.internalBubbles ? (config.bubbleDensity ?? 1.5) : 0.0) };
    shader.uniforms.uGlassBubbleScale = { value: config.bubbleScale ?? activePreset?.defaultParams.bubbleScale ?? 20.0 };
    shader.uniforms.uGlassCausticIntensity = { value: config.causticIntensity ?? activePreset?.defaultParams.causticIntensity ?? 1.0 };
    shader.uniforms.uGlassRimGlow = { value: config.rimGlow ?? activePreset?.defaultParams.rimGlow ?? 1.2 };
    shader.uniforms.uGlassRimColor = { value: rimColorObj };
    shader.uniforms.uGlassThinFilm = { value: config.thinFilmIridescence ?? activePreset?.defaultParams.thinFilmIridescence ?? 0.5 };

    // Vertex Shader: Surface organic wave distortion & world coordinates
    shader.vertexShader = `
      uniform float uGlassTime;
      uniform float uGlassDistortion;
      uniform float uGlassDistortionSpeed;
      uniform float uGlassDistortionFreq;
      varying vec3 vGlassLocalPos;
      varying vec3 vGlassWorldPos;
      ${WEBGPU_GLASS_COMMON_GLSL}
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vGlassLocalPos = position;
      vGlassWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;

      if (uGlassDistortion > 0.001) {
        float wave1 = sin(position.y * uGlassDistortionFreq * 2.0 + uGlassTime * uGlassDistortionSpeed) * 0.5 + 0.5;
        float noiseWave = glass_snoise(position * uGlassDistortionFreq + vec3(0.0, uGlassTime * uGlassDistortionSpeed * 0.5, 0.0));
        float totalDist = (wave1 * 0.4 + noiseWave * 0.6) * uGlassDistortion * 0.08;
        transformed += normal * totalDist;
      }
      `
    );

    // Fragment Shader: Spectral dispersion, Fresnel rim, Beer-Lambert attenuation & microbubbles
    shader.fragmentShader = `
      uniform float uGlassTime;
      uniform float uGlassDispersion;
      uniform float uGlassChromaticAberration;
      uniform float uGlassDistortion;
      uniform float uGlassFrostedBlur;
      uniform float uGlassBubbleDensity;
      uniform float uGlassBubbleScale;
      uniform float uGlassCausticIntensity;
      uniform float uGlassRimGlow;
      uniform vec3 uGlassRimColor;
      uniform float uGlassThinFilm;
      varying vec3 vGlassLocalPos;
      varying vec3 vGlassWorldPos;
      ${WEBGPU_GLASS_COMMON_GLSL}
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      vec3 vDir = normalize(vViewPosition);
      vec3 nDir = normalize(vNormal);
      float nDotV = max(0.0, dot(nDir, vDir));
      float fresnelEdge = pow(1.0 - nDotV, 3.2);

      // --- Node 1: Cauchy Spectral Dispersion & Chromatic Aberration ---
      if (uGlassDispersion > 0.001 || uGlassChromaticAberration > 0.001) {
        vec3 spectralRainbow = glass_cauchySpectralRainbow(nDotV, uGlassDispersion + uGlassChromaticAberration * 1.5);
        // Blend spectral dispersion onto transmission edges
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * spectralRainbow * 1.8, fresnelEdge * 0.85);
      }

      // --- Node 2: Thin-film Iridescent Rainbow Sheen ---
      if (uGlassThinFilm > 0.01) {
        float filmPhase = nDotV * 6.28318 + uGlassTime * 0.2;
        vec3 filmRainbow = vec3(
          sin(filmPhase + 0.0) * 0.5 + 0.5,
          sin(filmPhase + 2.094) * 0.5 + 0.5,
          sin(filmPhase + 4.188) * 0.5 + 0.5
        );
        diffuseColor.rgb += filmRainbow * (fresnelEdge * uGlassThinFilm * 0.5);
      }

      // --- Node 3: Fresnel Rim Glow & Specular Caustics ---
      diffuseColor.rgb += uGlassRimColor * (fresnelEdge * uGlassRimGlow * 0.45);
      
      if (uGlassCausticIntensity > 0.01) {
        float causticNoise = glass_snoise(vGlassLocalPos * 12.0 + vec3(uGlassTime * 0.4));
        float causticHigh = pow(max(0.0, causticNoise), 4.0);
        diffuseColor.rgb += vec3(1.0, 0.98, 0.9) * causticHigh * (uGlassCausticIntensity * 0.4);
      }

      // --- Node 4: 3D Micro-bubbles & Inclusions ---
      if (uGlassBubbleDensity > 0.01) {
        float vBubble = glass_voronoiBubbles(vGlassLocalPos * uGlassBubbleScale);
        float bubbleSphere = 1.0 - smoothstep(0.02, 0.08, vBubble);
        if (bubbleSphere > 0.01) {
          vec3 bubbleCol = vec3(1.0, 1.0, 1.0) * (bubbleSphere * uGlassBubbleDensity * 0.6);
          diffuseColor.rgb += bubbleCol;
        }
      }
      `
    ).replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>
      if (uGlassFrostedBlur > 0.01) {
        float frostGrain = glass_snoise(vGlassLocalPos * 35.0) * 0.05;
        roughnessFactor = clamp(roughnessFactor + uGlassFrostedBlur * 0.35 + frostGrain, 0.01, 0.98);
      }
      `
    );

    material.userData.shader = shader;
    material.userData.isWebGPUGlass = true;
  };
}

/**
 * Updates WebGPU Glass uniforms in the frame render loop.
 */
export function updateWebGPUGlassUniforms(material: THREE.Material, time: number, config?: GlassMaterialConfig) {
  const shader = material.userData.shader;
  if (!shader || !shader.uniforms) return;

  if (shader.uniforms.uGlassTime) {
    shader.uniforms.uGlassTime.value = time;
  }
  if (config) {
    if (shader.uniforms.uGlassDispersion && config.dispersion !== undefined) {
      shader.uniforms.uGlassDispersion.value = config.dispersion;
    }
    if (shader.uniforms.uGlassChromaticAberration && config.chromaticAberration !== undefined) {
      shader.uniforms.uGlassChromaticAberration.value = config.chromaticAberration;
    }
    if (shader.uniforms.uGlassDistortion && config.distortion !== undefined) {
      shader.uniforms.uGlassDistortion.value = config.distortion;
    }
    if (shader.uniforms.uGlassDistortionSpeed && config.distortionSpeed !== undefined) {
      shader.uniforms.uGlassDistortionSpeed.value = config.distortionSpeed;
    }
    if (shader.uniforms.uGlassFrostedBlur && config.frostedBlur !== undefined) {
      shader.uniforms.uGlassFrostedBlur.value = config.frostedBlur;
    }
    if (shader.uniforms.uGlassBubbleDensity) {
      shader.uniforms.uGlassBubbleDensity.value = config.internalBubbles ? (config.bubbleDensity ?? 1.5) : 0.0;
    }
    if (shader.uniforms.uGlassCausticIntensity && config.causticIntensity !== undefined) {
      shader.uniforms.uGlassCausticIntensity.value = config.causticIntensity;
    }
    if (shader.uniforms.uGlassRimGlow && config.rimGlow !== undefined) {
      shader.uniforms.uGlassRimGlow.value = config.rimGlow;
    }
    if (shader.uniforms.uGlassRimColor && config.rimColor) {
      shader.uniforms.uGlassRimColor.value.set(config.rimColor);
    }
  }
}
