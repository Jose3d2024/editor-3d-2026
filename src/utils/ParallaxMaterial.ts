import * as THREE from 'three';
import { GeneratedMaps } from './proceduralTextures';

export interface ParallaxOptions {
  /** Depth of the parallax effect (0.05 subtle → 0.3 dramatic) */
  scale?: number;
  /** Ray-march steps — 16 fast, 32 balanced, 64 high quality */
  steps?: number;
  /** UV tiling */
  tiling?: [number, number];
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  color?: THREE.Color | string;
  opacity?: number;
  transparent?: boolean;
}

export interface ParallaxMaps {
  albedo?: string | THREE.Texture;
  normal?: string | THREE.Texture;
  roughness?: string | THREE.Texture;
  metallic?: string | THREE.Texture;
  ao?: string | THREE.Texture;
  displacement?: string | THREE.Texture;
}

// ─── Vertex Shader ────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vViewDirTangent;   // view direction in tangent space
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  attribute vec4 tangent;         // Three.js provides this via computeTangents()

  void main() {
    vUv = uv;
    vNormalW = normalize(normalMatrix * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vPositionW = worldPos.xyz;

    // Build TBN matrix to convert view dir → tangent space
    vec3 N = normalize((normalMatrix * normal).xyz);
    vec3 T = normalize((normalMatrix * tangent.xyz).xyz);
    vec3 B = cross(N, T) * tangent.w;
    mat3 TBN = transpose(mat3(T, B, N));

    vec3 viewDirWorld = normalize(cameraPosition - worldPos.xyz);
    vViewDirTangent = TBN * viewDirWorld;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ─── Fragment Shader ──────────────────────────────────────────────────────────
const fragmentShader = /* glsl */`
  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform sampler2D uRoughness;
  uniform sampler2D uMetallic;
  uniform sampler2D uAO;
  uniform sampler2D uHeight;      // the displacement/height map

  uniform float uParallaxScale;
  uniform int   uSteps;
  uniform float uNormalScale;
  uniform vec2  uTiling;

  // Basic PBR uniforms
  uniform vec3  uCameraPos;
  uniform vec3  uLightDir;
  uniform vec3  uLightColor;
  uniform float uAmbient;

  varying vec2 vUv;
  varying vec3 vViewDirTangent;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  // ── Parallax Occlusion Mapping ───────────────────────────────────────────
  // Ray-marches down the heightmap in view direction until it hits the surface.
  // Returns the parallax-offset UV.
  vec2 parallaxOcclusionMapping(vec2 uv, vec3 viewDirT) {
    // Normalise view dir in tangent space — only XY matter (lateral offset)
    vec2 dir = -viewDirT.xy / (viewDirT.z + 0.001);
    vec2 totalOffset = dir * uParallaxScale;

    // Divide the depth range into 'uSteps' layers
    float layerDepth = 1.0 / float(uSteps);
    float currentDepth = 0.0;

    vec2  currentUV    = uv;
    vec2  deltaUV      = totalOffset * layerDepth;
    float currentHeight = texture2D(uHeight, currentUV).r;

    // ── Step 1: coarse march ───────────────────────────────────────────────
    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;
      if (currentHeight <= currentDepth) break;
      currentDepth  += layerDepth;
      currentUV     -= deltaUV;
      currentHeight  = texture2D(uHeight, currentUV).r;
    }

    // ── Step 2: binary search refinement (4 iterations) ───────────────────
    // Interpolates between the last two layers for sub-texel accuracy
    vec2 prevUV    = currentUV + deltaUV;
    float prevDepth = currentDepth - layerDepth;
    float prevH    = texture2D(uHeight, prevUV).r;
    float currH    = currentHeight;

    for (int j = 0; j < 4; j++) {
      vec2  midUV = (prevUV + currentUV) * 0.5;
      float midDepth = (prevDepth + currentDepth) * 0.5;
      float midH = texture2D(uHeight, midUV).r;
      if (midH > midDepth) {
        prevUV    = midUV;
        prevDepth = midDepth;
        prevH     = midH;
      } else {
        currentUV    = midUV;
        currentDepth = midDepth;
        currH = midH;
      }
    }

    // ── Interpolate between before/after hit ───────────────────────────────
    float weight = (currH - currentDepth) /
                   ((currH - currentDepth) - (prevH - prevDepth) + 0.0001);
    return mix(currentUV, prevUV, weight);
  }

  // ── Minimal PBR lighting (no IBL — works with just directional light) ────
  float distributionGGX(vec3 N, vec3 H, float rough) {
    float a  = rough * rough;
    float a2 = a * a;
    float d  = max(dot(N, H), 0.0);
    float d2 = d * d;
    float denom = d2 * (a2 - 1.0) + 1.0;
    return a2 / (3.14159 * denom * denom + 0.0001);
  }

  float geometrySmith(float NdotV, float NdotL, float rough) {
    float r = rough + 1.0;
    float k = (r * r) / 8.0;
    float gv = NdotV / (NdotV * (1.0 - k) + k);
    float gl = NdotL / (NdotL * (1.0 - k) + k);
    return gv * gl;
  }

  vec3 fresnelSchlick(float cosT, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  }

  void main() {
    vec2 tiledUV = vUv * uTiling;

    // ── Parallax offset UV ─────────────────────────────────────────────────
    vec3 viewT = normalize(vViewDirTangent);
    vec2 pUV   = parallaxOcclusionMapping(tiledUV, viewT);

    // ── Sample all maps with parallax-corrected UVs ────────────────────────
    vec4 albedo    = texture2D(uAlbedo,    pUV);
    vec3 normalTS  = texture2D(uNormal,    pUV).xyz * 2.0 - 1.0;
    float rough    = texture2D(uRoughness, pUV).r;
    float metal    = texture2D(uMetallic,  pUV).r;
    float ao       = texture2D(uAO,        pUV).r;

    // Scale normal map influence
    normalTS.xy *= uNormalScale;
    normalTS = normalize(normalTS);

    // Convert tangent-space normal to world space (approximate)
    vec3 N = normalize(vNormalW + vec3(normalTS.xy, 0.0));
    vec3 V = normalize(uCameraPos - vPositionW);
    vec3 L = normalize(-uLightDir);
    vec3 H = normalize(V + L);

    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.001);

    // F0: dielectric=0.04, metal=albedo
    vec3 F0 = mix(vec3(0.04), albedo.rgb, metal);

    // Cook-Torrance specular
    float D = distributionGGX(N, H, rough);
    float G = geometrySmith(NdotV, NdotL, rough);
    vec3  F = fresnelSchlick(max(dot(H, V), 0.0), F0);

    vec3 spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);

    // Diffuse (energy-conserving)
    vec3 kD = (vec3(1.0) - F) * (1.0 - metal);
    vec3 diffuse = kD * albedo.rgb / 3.14159;

    vec3 Lo = (diffuse + spec) * uLightColor * NdotL;

    // Ambient + AO
    vec3 ambient = vec3(uAmbient) * albedo.rgb * ao;

    vec3 color = ambient + Lo;

    // Reinhard tone map
    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Factory function ──────────────────────────────────────────────────────────

export function createParallaxMaterial(
  maps: ParallaxMaps,
  opts: ParallaxOptions = {}
): THREE.ShaderMaterial {
  const {
    scale       = 0.15,
    steps       = 32,
    tiling      = [1, 1],
    roughness   = 0.9,
    metalness   = 0,
    normalScale = 4.0,
    color       = '#ffffff',
    opacity     = 1,
    transparent = false,
  } = opts;

  const load = (input: string | THREE.Texture | undefined, sRGB = false) => {
    if (!input) {
      // Create a tiny white texture as fallback
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,1,1);
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      return t;
    }
    if (input instanceof THREE.Texture) {
      input.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
      return input;
    }
    const t = new THREE.TextureLoader().load(input);
    t.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent,
    uniforms: {
      uAlbedo:        { value: load(maps.albedo,      true)  },
      uNormal:        { value: load(maps.normal,      false) },
      uRoughness:     { value: load(maps.roughness,   false) },
      uMetallic:      { value: load(maps.metallic,    false) },
      uAO:            { value: load(maps.ao,          false) },
      uHeight:        { value: load(maps.displacement,false) },

      uParallaxScale: { value: scale       },
      uSteps:         { value: steps       },
      uNormalScale:   { value: normalScale },
      uTiling:        { value: new THREE.Vector2(tiling[0], tiling[1]) },

      // Lighting (update these in your render loop)
      uCameraPos:     { value: new THREE.Vector3() },
      uLightDir:      { value: new THREE.Vector3(-1, -2, -1).normalize() },
      uLightColor:    { value: new THREE.Vector3(2.5, 2.3, 2.0) },
      uAmbient:       { value: 0.15 },
    },
  });

  return mat;
}
