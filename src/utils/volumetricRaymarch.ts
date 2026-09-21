import * as THREE from 'three';
import { VolumetricConfig, VolumetricMode } from '../types';

export const DEFAULT_VOLUMETRIC_CONFIG: Required<VolumetricConfig> = {
  enabled: true,
  mode: 'cloud',
  cloudType: 'cumulus',
  density: 2.4,
  scale: 2.2,
  lightIntensity: 1.5,
  color: '#ffffff',
  secondaryColor: '#cbd5e1',
  emissiveIntensity: 0.0,
  threshold: 0.22,
  thresholdMax: 0.75,
  absorption: 1.6,
  steps: 40,
  shadowSteps: 5,
  windSpeed: 0.12,
  windDirection: [0.1, 0.05, 0.0],
  blending: 'normal',
  turbulentFlame: false,
  silverLining: 1.4,
  anisotropy: 0.60,
  anisotropyG: 0.60,
  coverage: 0.68,
  ambientBoost: 0.40,
  detailOctaves: 4,
  altitudeFade: [0.15, 0.20],
};

// 1. Vertex Shader (Passes local and world positions for bounding-box raymarching)
export const volumetricVertexShader = `
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;

  void main() {
    vLocalPosition = position; // Local position in container [-0.5, 0.5] or mesh space
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 2. Fragment Shader (Volumetric Raymarching supporting Cloud, Fire/Flame, Plasma, Smoke, Ice/Crystal, and Fire Explosion)
export const volumetricFragmentShader = `
  uniform mat4 uModelInverse;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;

  uniform float uTime;
  uniform int uMode; // 0: cloud, 1: fire, 2: plasma, 3: smoke, 4: ice, 5: explosion
  uniform float uCloudDensity;
  uniform float uLightIntensity;
  uniform float uCloudScale;
  uniform vec3 uCloudColor;
  uniform vec3 uSecondaryColor;
  uniform float uEmissiveIntensity;
  uniform vec3 uLightPosition;
  uniform float uThreshold;
  uniform float uThresholdMax;
  uniform float uAbsorption;
  uniform int uSteps;
  uniform int uShadowSteps;
  uniform vec3 uWind;
  uniform int uAdditive;

  // 2026 Advanced Atmospheric Scattering & Cloud Shaping
  uniform float uSilverLining;
  uniform float uAnisotropy;
  uniform float uCoverage;
  uniform float uAmbientBoost;
  uniform vec2 uAltitudeFade;

  // --- 3D Analytic Perlin / Simplex style Hash Noise ---
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.1, 0.1));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(in vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(
        mix(hash(i + vec3(0.0,0.0,0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
        mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
        mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  // --- Fractal Brownian Motion (FBM) with 4 Octaves ---
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 4; ++i) {
      v += a * noise(p);
      p = p * 2.04 + shift;
      a *= 0.5;
    }
    return v;
  }

  // --- Voronoi / Cellular 3D Noise for Worley Billowy Cloud Lobes ---
  float voronoi(vec3 p) {
    vec3 g = floor(p);
    vec3 f = fract(p);
    float minDist = 1.0;
    for (int k = -1; k <= 1; k++) {
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec3 b = vec3(float(i), float(j), float(k));
          vec3 r = b - f + hash(g + b);
          float d = dot(r, r);
          if (d < minDist) {
            minDist = d;
          }
        }
      }
    }
    return sqrt(minDist);
  }

  // --- Worley-Perlin Hybrid FBM for Fluffy Billowy Clouds ---
  float cloudFBM(vec3 p) {
    float perlin = fbm(p);
    float worley1 = 1.0 - voronoi(p * 1.5);
    float worley2 = 1.0 - voronoi(p * 3.0);
    float worley = worley1 * 0.65 + worley2 * 0.35;
    return mix(perlin, worley, 0.45);
  }

  // --- Henyey-Greenstein Phase Function (Forward Mie & Silver Lining Scattering) ---
  float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
  }

  // --- Internal Light Transmittance & Beer-Lambert Law Calculation ---
  float getLightTransmittance(vec3 localPos, vec3 lightDirLocal) {
    if (uMode == 1 || uMode == 2 || uMode == 5) {
      return 1.0;
    }
    float shadowDensity = 0.0;
    float shadowStepLength = 0.06;
    vec3 currentPos = localPos;

    for (int j = 0; j < 8; j++) {
      if (j >= uShadowSteps) break;
      currentPos += lightDirLocal * shadowStepLength;
      
      vec3 bDist = abs(currentPos);
      if (bDist.x >= 0.49 || bDist.y >= 0.49 || bDist.z >= 0.49) break;
      
      float bFade = smoothstep(0.48, 0.25, bDist.x) * 
                    smoothstep(0.48, 0.25, bDist.y) * 
                    smoothstep(0.48, 0.25, bDist.z);
      float rFade = smoothstep(0.70, 0.15, length(currentPos));
      
      vec3 sampleCoord = (currentPos * uCloudScale) + (uWind * uTime);
      float d = cloudFBM(sampleCoord);
      shadowDensity += smoothstep(uThreshold, uThresholdMax, d) * (bFade * rFade) * uCloudDensity * shadowStepLength;
    }
    float beer = exp(-shadowDensity * uAbsorption);
    float powderSugar = 1.0 - exp(-shadowDensity * uAbsorption * 2.0);
    return mix(beer, beer * powderSugar * 1.5 + 0.1, uAmbientBoost * 0.5);
  }

  void main() {
    vec3 camLocalPos = (uModelInverse * vec4(cameraPosition, 1.0)).xyz;
    bool isCameraInside = abs(camLocalPos.x) <= 0.49 && abs(camLocalPos.y) <= 0.49 && abs(camLocalPos.z) <= 0.49;

    if (!isCameraInside && !gl_FrontFacing) {
      discard;
    }

    vec3 rayDirWorld = normalize(vWorldPosition - cameraPosition);
    vec3 lightDirWorld = normalize(uLightPosition - vWorldPosition);

    mat3 invMat3 = mat3(uModelInverse);
    vec3 rayDirLocal = normalize(invMat3 * rayDirWorld);
    vec3 lightDirLocal = normalize(invMat3 * lightDirWorld);
    vec3 currentLocalPos = isCameraInside ? camLocalPos : vLocalPosition;

    float accumDensity = 0.0;
    vec3 accumColor = vec3(0.0);
    
    float stepLength = 2.4 / float(max(uSteps, 16));
    vec3 stepVector = rayDirLocal * stepLength;

    float cosTheta = dot(rayDirLocal, lightDirLocal);
    float hgPhase = henyeyGreenstein(cosTheta, clamp(uAnisotropy, 0.1, 0.9));

    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;

      float distFromCenter = length(currentLocalPos);
      if (distFromCenter > 1.5) break;

      vec3 bDist = abs(currentLocalPos);
      if (bDist.x >= 0.49 || bDist.y >= 0.49 || bDist.z >= 0.49) {
        currentLocalPos += stepVector;
        continue;
      }

      float boxFade = smoothstep(0.48, 0.22, bDist.x) * 
                      smoothstep(0.48, 0.22, bDist.y) * 
                      smoothstep(0.48, 0.22, bDist.z);
      
      float yNorm = currentLocalPos.y + 0.5;
      float altitudeShape = smoothstep(0.0, max(0.05, uAltitudeFade.x), yNorm) *
                            smoothstep(1.0, 1.0 - max(0.05, uAltitudeFade.y), yNorm);

      float boundaryFade = boxFade * smoothstep(0.70, 0.15, distFromCenter) * altitudeShape;

      float d = 0.0;
      vec3 samplePos = currentLocalPos;

      // MODE 0: CUMULUS & ATMOSPHERIC CLOUDS
      if (uMode == 0) {
        vec3 sampleCoord = (samplePos * uCloudScale) + (uWind * uTime);
        float n = cloudFBM(sampleCoord);
        d = smoothstep(uThreshold * (1.1 - uCoverage * 0.3), uThresholdMax, n) * boundaryFade * uCloudDensity;

        if (d > 0.002) {
          float transmittance = exp(-accumDensity * uAbsorption);
          float directLight = getLightTransmittance(currentLocalPos, lightDirLocal);
          float multiScattering = exp(-accumDensity * uAbsorption * 0.28) * (0.42 + uAmbientBoost * 0.5);
          float totalLight = max(directLight + multiScattering, 0.20 + uAmbientBoost * 0.25);
          
          accumDensity += d * stepLength * 1.6;

          vec3 silverHighlight = mix(uCloudColor, vec3(0.96, 0.98, 1.0), 0.6);
          vec3 midToneCloud = uCloudColor;
          vec3 shadowToneCloud = mix(uSecondaryColor, uCloudColor * 0.45, 0.5);

          vec3 cloudTone = mix(shadowToneCloud, midToneCloud, clamp(totalLight * 1.35, 0.0, 1.0));
          cloudTone = mix(cloudTone, silverHighlight, clamp(pow(directLight, 2.0) * 0.75, 0.0, 1.0));

          float silverPeak = (hgPhase * 2.0 + pow(max(cosTheta, 0.0), 6.0)) * uSilverLining * directLight * 0.45;
          cloudTone += vec3(0.92, 0.96, 1.0) * silverPeak;

          vec3 litColor = cloudTone * (uLightIntensity * (0.35 + totalLight * 0.95));
          accumColor += transmittance * d * litColor * stepLength * 2.2;
        }
      }
      // MODE 1: FIRE / FLAME COLUMN
      else if (uMode == 1) {
        vec3 flameCoord = samplePos;
        flameCoord.y -= uTime * length(uWind) * 1.6;
        flameCoord.xz += vec2(
          sin(samplePos.y * 4.5 + uTime * 3.5) * 0.12,
          cos(samplePos.y * 4.5 + uTime * 3.0) * 0.12
        );

        float n1 = fbm(flameCoord * uCloudScale);
        float n2 = fbm((flameCoord + vec3(3.2, 1.5, -2.1)) * (uCloudScale * 1.8));
        float combinedNoise = n1 * 0.65 + n2 * 0.35;

        float flameHeight = (samplePos.y + 0.5);
        float radiusLimit = mix(0.55, 0.15, clamp(flameHeight, 0.0, 1.0));
        float horizDist = length(samplePos.xz);
        float shapeMask = smoothstep(radiusLimit, radiusLimit * 0.3, horizDist) * smoothstep(1.1, 0.15, flameHeight) * smoothstep(-0.55, -0.4, samplePos.y);
        d = smoothstep(uThreshold, uThresholdMax, combinedNoise) * shapeMask * uCloudDensity;

        if (d > 0.002) {
          float temp = clamp(d * 1.5 - flameHeight * 0.5, 0.0, 1.0);
          vec3 flameCol = mix(vec3(0.12, 0.01, 0.01), uCloudColor, smoothstep(0.0, 0.35, temp));
          flameCol = mix(flameCol, uSecondaryColor, smoothstep(0.25, 0.68, temp));
          flameCol = mix(flameCol, vec3(1.0, 0.98, 0.85), smoothstep(0.68, 1.0, temp));

          vec3 emittedLight = flameCol * (uEmissiveIntensity * uLightIntensity * (1.2 + temp * 2.2));
          
          if (uAdditive == 1) {
            accumColor += d * emittedLight * stepLength * 2.2;
            accumDensity += d * stepLength * 0.7;
          } else {
            float transmittance = exp(-accumDensity * 1.2);
            accumColor += transmittance * d * emittedLight * stepLength * 2.0;
            accumDensity += d * stepLength * 1.2;
          }
        }
      }
      // MODE 2: PLASMA / ENERGY GAS
      else if (uMode == 2) {
        vec3 plasmaCoord = (samplePos * uCloudScale) + (uWind * uTime);
        float fbmVal = fbm(plasmaCoord);
        float voronoiVal = 1.0 - voronoi(plasmaCoord * 1.5);
        float combinedVal = mix(fbmVal, voronoiVal, 0.5);

        d = smoothstep(uThreshold, uThresholdMax, combinedVal) * boundaryFade * uCloudDensity;

        if (d > 0.002) {
          float intensity = smoothstep(0.15, 0.85, d);
          vec3 plasmaCol = mix(uCloudColor, uSecondaryColor, intensity);
          vec3 coreCol = mix(plasmaCol, vec3(1.0, 1.0, 1.0), pow(intensity, 2.2));
          vec3 emitted = coreCol * (uEmissiveIntensity * uLightIntensity * (1.3 + intensity * 2.2));

          if (uAdditive == 1) {
            accumColor += d * emitted * stepLength * 2.2;
            accumDensity += d * stepLength * 0.7;
          } else {
            float transmittance = exp(-accumDensity * 1.0);
            accumColor += transmittance * d * emitted * stepLength * 2.0;
            accumDensity += d * stepLength * 1.1;
          }
        }
      }
      // MODE 3: SMOKE / VOLUMETRIC PLUME
      else if (uMode == 3) {
        vec3 smokeCoord = (samplePos * uCloudScale) + (uWind * uTime);
        vec3 curl = vec3(
          sin(smokeCoord.y * 3.2 + uTime * 1.2),
          cos(smokeCoord.z * 3.2 + uTime * 1.0),
          sin(smokeCoord.x * 3.2 + uTime * 1.4)
        ) * 0.22;
        float n = fbm(smokeCoord + curl);
        d = smoothstep(uThreshold, uThresholdMax, n) * boundaryFade * uCloudDensity;

        if (d > 0.002) {
          float transmittance = exp(-accumDensity * uAbsorption);
          float directLight = getLightTransmittance(currentLocalPos, lightDirLocal);
          float multiScattering = exp(-accumDensity * uAbsorption * 0.35) * 0.45;
          float totalLight = max(directLight + multiScattering, 0.25);

          accumDensity += d * stepLength * 1.4;

          vec3 smokeShade = mix(uSecondaryColor, uCloudColor, clamp(totalLight * 1.2, 0.0, 1.0));
          vec3 litColor = smokeShade * (uLightIntensity * (0.35 + totalLight * 0.85));
          accumColor += transmittance * d * litColor * stepLength * 2.0;
        }
      }
      // MODE 4: ICE / CRYSTAL
      else if (uMode == 4) {
        vec3 iceCoord = samplePos * uCloudScale;
        float v1 = voronoi(iceCoord * 2.5);
        float v2 = voronoi(iceCoord * 5.0 + vec3(1.2, 3.4, 5.6));
        float crackPattern = smoothstep(0.08, 0.0, abs(v1 - 0.5)) + smoothstep(0.06, 0.0, abs(v2 - 0.5)) * 0.5;
        float f = fbm(iceCoord * 1.8);
        float iceDensity = mix(f, crackPattern, 0.35);

        d = smoothstep(uThreshold, uThresholdMax, iceDensity) * boundaryFade * uCloudDensity;

        if (d > 0.002) {
          float transmittance = exp(-accumDensity * uAbsorption);
          float directLight = getLightTransmittance(currentLocalPos, lightDirLocal);
          accumDensity += d * stepLength * 1.3;

          vec3 iceCol = mix(uCloudColor, uSecondaryColor, clamp(d * 1.2, 0.0, 1.0));
          vec3 litColor = iceCol * (uLightIntensity * (0.5 + directLight * 0.8));
          accumColor += transmittance * d * litColor * stepLength * 1.8;
        }
      }
      // MODE 5: EXPLOSION
      else if (uMode == 5) {
        float r = length(samplePos);
        vec3 expCoord = samplePos * uCloudScale - normalize(samplePos + vec3(0.001)) * (uTime * 0.6);
        float n = fbm(expCoord);
        float shockwave = smoothstep(0.5, 0.25, r) * smoothstep(0.0, 0.15, r);
        d = smoothstep(uThreshold, uThresholdMax, n) * shockwave * boundaryFade * uCloudDensity;

        if (d > 0.002) {
          float coreFactor = smoothstep(0.35, 0.0, r);
          vec3 expColor = mix(uCloudColor, uSecondaryColor, coreFactor);
          expColor = mix(expColor, vec3(1.0, 0.98, 0.8), pow(coreFactor, 2.0));
          vec3 emitted = expColor * (uEmissiveIntensity * uLightIntensity * (1.5 + coreFactor * 3.0));

          if (uAdditive == 1) {
            accumColor += d * emitted * stepLength * 2.2;
            accumDensity += d * stepLength * 0.7;
          } else {
            float transmittance = exp(-accumDensity * 1.1);
            accumColor += transmittance * d * emitted * stepLength * 2.0;
            accumDensity += d * stepLength * 1.1;
          }
        }
      }

      currentLocalPos += stepVector;
      if (accumDensity >= 0.99) break;
    }

    if (accumDensity <= 0.001) discard;

    float finalAlpha = clamp(accumDensity, 0.0, 1.0);
    gl_FragColor = vec4(accumColor, finalAlpha);
  }
`;

function getModeEnum(mode?: VolumetricMode): number {
  switch (mode) {
    case 'fire': return 1;
    case 'plasma': return 2;
    case 'smoke': return 3;
    case 'ice': return 4;
    case 'explosion': return 5;
    case 'cloud':
    default:
      return 0;
  }
}

/**
 * Creates a THREE.ShaderMaterial configured for Volumetric Raymarching
 */
export function createRaymarchedCloudMaterial(config?: Partial<VolumetricConfig>): THREE.ShaderMaterial {
  const cfg = { ...DEFAULT_VOLUMETRIC_CONFIG, ...(config || {}) };
  const modeInt = getModeEnum(cfg.mode);
  const isAdditive = cfg.blending === 'additive' || cfg.mode === 'fire' || cfg.mode === 'plasma';

  const uniforms = {
    uTime: { value: 0 },
    uMode: { value: modeInt },
    uCloudDensity: { value: cfg.density },
    uLightIntensity: { value: cfg.lightIntensity },
    uCloudScale: { value: cfg.scale },
    uCloudColor: { value: new THREE.Color(cfg.color) },
    uSecondaryColor: { value: new THREE.Color(cfg.secondaryColor || '#cbd5e1') },
    uEmissiveIntensity: { value: cfg.emissiveIntensity ?? 0.0 },
    uLightPosition: { value: new THREE.Vector3(5, 10, 5) },
    uThreshold: { value: cfg.threshold },
    uThresholdMax: { value: cfg.thresholdMax ?? 0.8 },
    uAbsorption: { value: cfg.absorption },
    uSteps: { value: cfg.steps },
    uShadowSteps: { value: cfg.shadowSteps },
    uModelInverse: { value: new THREE.Matrix4() },
    uAdditive: { value: isAdditive ? 1 : 0 },
    uWind: {
      value: new THREE.Vector3(
        (cfg.windDirection?.[0] ?? 0.1) * (cfg.windSpeed ?? 0.1),
        (cfg.windDirection?.[1] ?? 0.05) * (cfg.windSpeed ?? 0.1),
        (cfg.windDirection?.[2] ?? 0.0) * (cfg.windSpeed ?? 0.1)
      ),
    },
    uSilverLining: { value: cfg.silverLining ?? 1.4 },
    uAnisotropy: { value: cfg.anisotropy ?? 0.60 },
    uCoverage: { value: cfg.coverage ?? 0.68 },
    uAmbientBoost: { value: cfg.ambientBoost ?? 0.40 },
    uAltitudeFade: { value: new THREE.Vector2(cfg.altitudeFade?.[0] ?? 0.15, cfg.altitudeFade?.[1] ?? 0.20) },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: volumetricVertexShader,
    fragmentShader: volumetricFragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false, // Prevents depth sorting artifacts with other 3D geometry
    side: THREE.DoubleSide, // Full 360-degree inside/outside volumetric visibility
    blending: isAdditive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  mat.userData.isVolumetric = true;
  mat.userData.volumetricConfig = cfg;

  return mat;
}

/**
 * Updates uniforms for a volumetric material on every frame
 */
export function updateVolumetricUniforms(
  material: THREE.ShaderMaterial,
  config: Partial<VolumetricConfig>,
  time: number,
  lightPosition?: THREE.Vector3,
  mesh?: THREE.Mesh
) {
  if (!material || !material.uniforms) return;

  const u = material.uniforms;
  if (u.uTime) u.uTime.value = time;
  if (u.uModelInverse && mesh) {
    u.uModelInverse.value.copy(mesh.matrixWorld).invert();
  }
  if (u.uLightPosition && lightPosition) {
    u.uLightPosition.value.copy(lightPosition);
  }

  if (config.mode !== undefined && u.uMode) {
    u.uMode.value = getModeEnum(config.mode);
  }
  if (config.density !== undefined && u.uCloudDensity) {
    u.uCloudDensity.value = config.density;
  }
  if (config.scale !== undefined && u.uCloudScale) {
    u.uCloudScale.value = config.scale;
  }
  if (config.lightIntensity !== undefined && u.uLightIntensity) {
    u.uLightIntensity.value = config.lightIntensity;
  }
  if (config.color && u.uCloudColor) {
    u.uCloudColor.value.set(config.color);
  }
  if (config.secondaryColor && u.uSecondaryColor) {
    u.uSecondaryColor.value.set(config.secondaryColor);
  }
  if (config.emissiveIntensity !== undefined && u.uEmissiveIntensity) {
    u.uEmissiveIntensity.value = config.emissiveIntensity;
  }
  if (config.threshold !== undefined && u.uThreshold) {
    u.uThreshold.value = config.threshold;
  }
  if (config.thresholdMax !== undefined && u.uThresholdMax) {
    u.uThresholdMax.value = config.thresholdMax;
  }
  if (config.absorption !== undefined && u.uAbsorption) {
    u.uAbsorption.value = config.absorption;
  }
  if (config.steps !== undefined && u.uSteps) {
    u.uSteps.value = config.steps;
  }
  if (config.shadowSteps !== undefined && u.uShadowSteps) {
    u.uShadowSteps.value = config.shadowSteps;
  }
  if (config.silverLining !== undefined && u.uSilverLining) {
    u.uSilverLining.value = config.silverLining;
  }
  if (config.anisotropy !== undefined && u.uAnisotropy) {
    u.uAnisotropy.value = config.anisotropy;
  }
  if (config.coverage !== undefined && u.uCoverage) {
    u.uCoverage.value = config.coverage;
  }
  if (config.ambientBoost !== undefined && u.uAmbientBoost) {
    u.uAmbientBoost.value = config.ambientBoost;
  }
  if (config.altitudeFade && u.uAltitudeFade) {
    u.uAltitudeFade.value.set(config.altitudeFade[0], config.altitudeFade[1]);
  }
  if (config.blending !== undefined && u.uAdditive) {
    const isAdd = config.blending === 'additive' || config.mode === 'fire' || config.mode === 'plasma';
    u.uAdditive.value = isAdd ? 1 : 0;
    material.blending = isAdd ? THREE.AdditiveBlending : THREE.NormalBlending;
  }
  if (u.uWind && config.windDirection && config.windSpeed !== undefined) {
    u.uWind.value.set(
      config.windDirection[0] * config.windSpeed,
      config.windDirection[1] * config.windSpeed,
      config.windDirection[2] * config.windSpeed
    );
  }
}

export interface VolumetricPreset {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  config: VolumetricConfig;
}

export const VOLUMETRIC_PRESETS: VolumetricPreset[] = [
  {
    id: 'cumulus',
    name: 'Nube Cúmulo 2026',
    desc: 'Cúmulo algodonoso blanco con crestas plateadas Mie, dispersión dual y relieve Worley',
    icon: '☁️',
    color: '#ffffff',
    config: {
      enabled: true,
      mode: 'cloud',
      cloudType: 'cumulus',
      density: 2.6,
      scale: 2.2,
      lightIntensity: 1.5,
      color: '#ffffff',
      secondaryColor: '#cbd5e1',
      emissiveIntensity: 0,
      threshold: 0.20,
      thresholdMax: 0.72,
      absorption: 1.6,
      steps: 40,
      shadowSteps: 5,
      windSpeed: 0.08,
      windDirection: [0.1, 0.05, 0.0],
      blending: 'normal',
      silverLining: 1.4,
      anisotropy: 0.6,
      coverage: 0.7,
      ambientBoost: 0.4,
      altitudeFade: [0.15, 0.20],
    },
  },
  {
    id: 'stratocumulus',
    name: 'Estratocúmulo Ondulado',
    desc: 'Manto de nubes estratificadas horizontales densas con suave absorción difusa',
    icon: '🌥️',
    color: '#e2e8f0',
    config: {
      enabled: true,
      mode: 'cloud',
      cloudType: 'stratocumulus',
      density: 3.2,
      scale: 1.6,
      lightIntensity: 1.4,
      color: '#f8fafc',
      secondaryColor: '#94a3b8',
      emissiveIntensity: 0,
      threshold: 0.18,
      thresholdMax: 0.75,
      absorption: 2.0,
      steps: 36,
      shadowSteps: 5,
      windSpeed: 0.06,
      windDirection: [0.15, 0.0, 0.05],
      blending: 'normal',
      silverLining: 1.0,
      anisotropy: 0.45,
      coverage: 0.85,
      ambientBoost: 0.35,
      altitudeFade: [0.25, 0.25],
    },
  },
  {
    id: 'cumulonimbus',
    name: 'Cumulonimbus / Tormenta',
    desc: 'Torre de tormenta imponente con base oscura, yunque superior y dispersión interna',
    icon: '🌩️',
    color: '#64748b',
    config: {
      enabled: true,
      mode: 'cloud',
      cloudType: 'cumulonimbus',
      density: 5.5,
      scale: 3.8,
      lightIntensity: 1.6,
      color: '#64748b',
      secondaryColor: '#1e293b',
      emissiveIntensity: 0,
      threshold: 0.28,
      thresholdMax: 0.82,
      absorption: 3.4,
      steps: 32,
      shadowSteps: 6,
      windSpeed: 0.14,
      windDirection: [0.2, 0.05, 0.0],
      blending: 'normal',
      silverLining: 1.8,
      anisotropy: 0.7,
      coverage: 0.8,
      ambientBoost: 0.25,
      altitudeFade: [0.1, 0.15],
    },
  },
  {
    id: 'cirrus',
    name: 'Cirros Filamentosos',
    desc: 'Velo de nubes de hielo etéreas, finas y traslúcidas a gran altitud',
    icon: '🌤️',
    color: '#ffffff',
    config: {
      enabled: true,
      mode: 'cloud',
      cloudType: 'cirrus',
      density: 1.4,
      scale: 3.2,
      lightIntensity: 1.8,
      color: '#ffffff',
      secondaryColor: '#e0f2fe',
      emissiveIntensity: 0,
      threshold: 0.12,
      thresholdMax: 0.65,
      absorption: 0.7,
      steps: 32,
      shadowSteps: 3,
      windSpeed: 0.18,
      windDirection: [0.25, 0.02, 0.0],
      blending: 'normal',
      silverLining: 2.0,
      anisotropy: 0.8,
      coverage: 0.45,
      ambientBoost: 0.5,
      altitudeFade: [0.4, 0.1],
    },
  },
  {
    id: 'smoke_dense',
    name: 'Humo Volumétrico Definido',
    desc: 'Pluma de humo ondulante con remolinos definidos, tonos ceniza y dispersión lumínica',
    icon: '💨',
    color: '#94a3b8',
    config: {
      enabled: true,
      mode: 'smoke',
      density: 2.3,
      scale: 2.6,
      lightIntensity: 1.35,
      color: '#94a3b8',
      secondaryColor: '#64748b',
      emissiveIntensity: 0,
      threshold: 0.18,
      thresholdMax: 0.72,
      absorption: 1.2,
      steps: 38,
      shadowSteps: 5,
      windSpeed: 0.20,
      windDirection: [0.0, 0.75, 0.1],
      blending: 'normal',
    },
  },
  {
    id: 'explosion_fire',
    name: 'Explosión de Fuego 3D',
    desc: 'Detonación expansiva con núcleo incandescente, bola de fuego naranja y hollín turbulento',
    icon: '💥',
    color: '#ef4444',
    config: {
      enabled: true,
      mode: 'explosion',
      density: 3.2,
      scale: 2.2,
      lightIntensity: 2.6,
      color: '#ef4444',
      secondaryColor: '#fbbf24',
      emissiveIntensity: 4.2,
      threshold: 0.18,
      thresholdMax: 0.68,
      absorption: 1.1,
      steps: 44,
      shadowSteps: 4,
      windSpeed: 0.38,
      windDirection: [0.0, 1.0, 0.0],
      blending: 'additive',
      turbulentFlame: true,
    },
  },
  {
    id: 'fire_volumetric',
    name: 'Fuego Volumétrico 3D (Llama)',
    desc: 'Llama ardiente con núcleo térmico, convección y emisión aditiva',
    icon: '🔥',
    color: '#ef4444',
    config: {
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
  },
  {
    id: 'plasma_gas',
    name: 'Gas Plasma / Raymarching',
    desc: 'Gas ionizado brillante con filamentos voronoi y aditividad',
    icon: '⚡',
    color: '#06b6d4',
    config: {
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
  },
  {
    id: 'nebula_cosmic',
    name: 'Nebulosa Cósmica 3D',
    desc: 'Gas estelar profundo con tonalidades púrpura y magenta',
    icon: '🌌',
    color: '#c084fc',
    config: {
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
  },
  {
    id: 'ice_crystal',
    name: 'Hielo / Cristal Volumétrico',
    desc: 'Cubo de hielo translúcido con fracturas internas y micro-burbujas',
    icon: '🧊',
    color: '#bae6fd',
    config: {
      enabled: true,
      mode: 'ice',
      density: 2.4,
      scale: 2.0,
      lightIntensity: 1.6,
      color: '#bae6fd',
      secondaryColor: '#38bdf8',
      emissiveIntensity: 0.2,
      threshold: 0.15,
      thresholdMax: 0.80,
      absorption: 0.9,
      steps: 36,
      shadowSteps: 4,
      windSpeed: 0.0,
      windDirection: [0.0, 0.0, 0.0],
      blending: 'normal',
    },
  },
];
