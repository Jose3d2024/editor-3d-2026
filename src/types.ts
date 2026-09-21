import { Vector3, Euler } from 'three';
import { SilhouetteContour } from './utils/silhouettes';
import type { NurbsControlPoint, NurbsCurveData, NurbsSurfaceData, NurbsKnotType } from './utils/nurbs';
export type { NurbsControlPoint, NurbsCurveData, NurbsSurfaceData, NurbsKnotType };

export type V3 = [number, number, number];

export interface MeshFace {
  indices: number[];
  normal?: V3;
  uvs?: [number, number][];
  materialIndex?: number;
  selected?: boolean;
}

export type CSGOperation  = 'ADD' | 'SUBTRACT' | 'INTERSECT';
export type PrimitiveType =
  | 'CUBE' | 'SPHERE' | 'GEOSPHERE' | 'CYLINDER' | 'CONE'
  | 'TORUS' | 'ICOSAHEDRON' | 'DODECAHEDRON'
  | 'PYRAMID' | 'PRISM' | 'CAPSULE' | 'TETRAHEDRON' | 'OCTAHEDRON'
  | 'TUBE' | 'WEDGE' | 'HEMISPHERE' | 'ARC' | 'STAR'
  | 'PLANE' | 'CIRCLE' | 'RING'
  | 'SHAPE' | 'MESH'
  | 'VOLUME_CLOUD'
  | 'PARTICLE_SYSTEM' | 'SPACE_WARP' | 'GPGPU_SWARM'
  | 'NURBS_CURVE' | 'NURBS_SURFACE' | 'NURBS_CIRCLE' | 'NURBS_CYLINDER' | 'NURBS_CONE' | 'NURBS_SPHERE' | 'NURBS_TORUS';

export type VolumetricMode = 'cloud' | 'fire' | 'explosion' | 'plasma' | 'smoke' | 'ice';
export type CloudStructureType = 'cumulus' | 'stratocumulus' | 'cumulonimbus' | 'cirrus' | 'nebula' | 'pyroclastic';

export interface VolumetricConfig {
  enabled?: boolean;
  mode?: VolumetricMode;   // 'cloud' | 'fire' | 'explosion' | 'plasma' | 'smoke' | 'ice'
  cloudType?: CloudStructureType; // Advanced 2026 volumetric cloud preset
  density?: number;        // uCloudDensity (e.g. 1.5)
  lightIntensity?: number; // uLightIntensity (e.g. 1.2)
  scale?: number;         // uCloudScale (e.g. 2.0)
  color?: string;         // uCloudColor (e.g. '#ffffff' or primary flame color)
  secondaryColor?: string; // Secondary flame / gas / ice tint (e.g. '#f59e0b')
  emissiveIntensity?: number; // Self-illumination for fire/plasma (e.g. 2.5)
  threshold?: number;     // uThreshold (smoothstep min cutoff, e.g. 0.4)
  thresholdMax?: number;  // uThresholdMax (smoothstep max, e.g. 0.8)
  absorption?: number;    // uAbsorption (Beer-Lambert attenuation, e.g. 2.0)
  steps?: number;         // Raymarch steps (e.g. 32 to 64)
  shadowSteps?: number;   // Shadow steps (e.g. 6)
  windSpeed?: number;     // Animation drift speed
  windDirection?: [number, number, number]; // Wind vector
  blending?: 'normal' | 'additive'; // Additive blending for fire / plasma
  turbulentFlame?: boolean; // Flame upward turbulence & heat dissipation
  
  // ── 2026 Advanced Atmospheric Scattering & Cloud Shaping ──
  silverLining?: number;   // Mie forward scattering peak (0.0 to 3.0)
  anisotropy?: number;     // Henyey-Greenstein phase eccentricity g (0.1 to 0.9)
  anisotropyG?: number;    // Alias for anisotropy g parameter
  coverage?: number;       // Cloud coverage volume fill (0.0 to 1.0)
  ambientBoost?: number;   // Dual-scattering internal diffuse luminescence (0.0 to 1.0)
  detailOctaves?: number;  // Fractal Worley-Perlin octave count (2 to 6)
  altitudeFade?: number | [number, number]; // Base and top soft clipping
}

export type ParticleEmitterType = 'POINT' | 'BOX' | 'SPHERE' | 'CYLINDER' | 'RING' | 'PLANE' | 'CIRCLE' | 'MESH';
export type ParticleVisualType = 'SPRAY' | 'SUPER_SPRAY' | 'SNOW' | 'BLIZZARD' | 'FIRE_SMOKE' | 'CLOUD_PUFF' | 'SPHERES' | 'STARS' | 'BUBBLES' | 'DUST';
export type SpaceWarpForceType = 'GRAVITY' | 'WIND' | 'VORTEX' | 'PUSH' | 'WAVE' | 'RIPPLE' | 'DEFLECTOR' | 'DISPLACE' | 'MOTOR' | 'DRAG' | 'PBOMB';

export interface ParticleSystemConfig {
  emitterType: ParticleEmitterType;
  emitterSize: [number, number, number];
  particleType: ParticleVisualType;
  count: number;              // Max active particles (e.g. 100 to 2000)
  birthRate: number;          // Particles spawned per second
  life: number;               // Lifespan in seconds (e.g. 3.0)
  lifeVariation: number;      // Variation (0 to 1)
  speed: number;              // Initial launch speed
  speedVariation: number;     // Speed randomization (0 to 1)
  spread: number;             // Cone / emitter spread angle in degrees (0 to 180)
  particleSize: number;       // Size of billboard or geometry
  sizeVariation: number;      // Size randomization
  growth: number;             // Growth over life (-1 to 2)
  fade: boolean;              // Fade alpha over lifespan
  spin: number;               // Rotation angular speed
  colorStart: string;         // Initial birth tint
  colorEnd: string;           // Death tint
  opacity: number;            // Max opacity
  blending: 'normal' | 'additive';
  affectedBySpaceWarps: boolean; // React to active space warps in scene
  boundSpaceWarpIds?: string[];  // Specifically bound space warp IDs (or all if empty)
}

export interface SpaceWarpConfig {
  warpType: SpaceWarpForceType;
  strength: number;           // Force magnitude (can be negative for repulsion)
  decay: number;              // Spatial distance decay (0 = infinite, 1 = quadratic)
  range: number;              // Max effective radius/distance
  windTurbulence: number;     // Wind turbulent noise amount
  windFrequency: number;      // Wind noise temporal frequency
  vortexAxial: number;        // Vortex upward pull along axis
  vortexRadial: number;       // Vortex inward swirling pull
  waveAmplitude: number;      // Wave height
  waveLength: number;         // Distance between wave crests
  waveSpeed: number;          // Oscillation speed
  deflectorBounce: number;    // Restitution coefficient (0 to 1)
  deflectorFriction: number;  // Surface friction drag (0 to 1)
  iconSize?: number;          // Gizmo display size
}

export type GpgpuSwarmMode =
  | 'curl_noise'
  | 'lorenz_attractor'
  | 'vortex_blackhole'
  | 'galaxy_spiral'
  | 'double_helix'
  | 'torus_knot'
  | 'spherical_flow'
  | 'cyber_neon'
  | 'mesh_surface'
  | 'magnetic_dipole'
  | 'harmonic_wave';

export type GpgpuColorMode =
  | 'velocity'
  | 'position'
  | 'rainbow'
  | 'monochrome'
  | 'radial'
  | 'temperature'
  | 'cyber_neon'
  | 'aurora'
  | 'sunset'
  | 'ocean';

export type GpgpuParticleShape =
  | 'glow_disc'
  | 'point'
  | 'star'
  | 'sparkle'
  | 'ring'
  | 'lit_sphere'
  | 'square'
  | 'streak';

export type GpgpuMeshTarget =
  | 'none'
  | 'suzanne'
  | 'stanford_bunny'
  | 'torus_knot'
  | 'skull'
  | 'human_torso'
  | 'sphere'
  | 'cube'
  | 'scene_object';

export type GpgpuMouseMode = 'attract' | 'repel' | 'vortex' | 'wave';

export interface GpgpuSwarmConfig {
  enabled?: boolean;
  mode: GpgpuSwarmMode;
  count: number;              // Total simulated particles (e.g. 10,000 to 262,144)
  particleSize: number;       // Visual point size (e.g. 1.0 to 32.0)
  noiseFrequency: number;     // Curl noise spatial frequency (0.05 to 2.5)
  noiseSpeed: number;         // Time speed of turbulence evolution (0.1 to 3.0)
  curlOctaves: number;        // Detail octaves (1 to 4)
  attractionStrength: number; // Core center pull force (-5.0 to 10.0)
  swirlForce: number;         // Orbital angular swirl momentum (0.0 to 8.0)
  damping: number;            // Velocity friction coefficient (0.80 to 0.99)
  speed: number;              // Global time/speed multiplier (0.1 to 5.0)
  boundingRadius: number;     // Boundary containment / wrap radius
  particleShape: GpgpuParticleShape;
  colorStart: string;         // Primary birth / core tint
  colorEnd: string;           // Outer / high-velocity accent tint
  colorMode: GpgpuColorMode;
  opacity: number;            // 0.1 to 1.0
  blending: 'additive' | 'normal';
  interactiveMouse: boolean;  // React to 3D mouse pointer in scene
  mouseMode?: GpgpuMouseMode; // 'attract' | 'repel' | 'vortex' | 'wave'
  mouseForce: number;         // Mouse attraction/repulsion strength
  mouseRadius: number;        // Radius of mouse influence in 3D
  trailLength: number;        // Motion velocity stretch factor
  velocityStretch?: number;   // Stretch factor along velocity vector
  lightReactivity?: number;   // 0.0 to 1.0 realistic 3D lighting shading
  meshTarget?: GpgpuMeshTarget; // Base 3D model for particles
  targetObjectId?: string;    // ID of a scene CSGObject to morph to
  surfaceAttraction?: number; // 0.0 to 1.0 how tightly particles hug mesh surface
  surfaceDispersion?: number; // 0.0 to 5.0 turbulent scatter away from mesh surface
  pulseSpeed?: number;        // Audio / beat pulse frequency
  pulseAmplitude?: number;    // Audio / beat pulse wave amplitude
  lorenzSigma?: number;       // For Lorenz mode (default 10.0)
  lorenzRho?: number;         // For Lorenz mode (default 28.0)
  lorenzBeta?: number;        // For Lorenz mode (default 2.666)
}

export interface ShapeParameters {
  segments?:        number;
  heightSegments?:  number;
  radialSegments?:  number;
  tubularSegments?: number;
  radius?:          number;
  tube?:            number;
  detail?:          number;
  innerRadius?:     number;
  outerRadius?:     number;
  arcAngle?:        number; // Degrees (1 to 360)
  starPoints?:      number; // Number of points (puntas)
  height?:          number;
  thetaSegments?:   number;
  sphereType?:      'UV' | 'ICO';
  shapeType?:       'line' | 'rect' | 'bezier' | 'custom';
  closed?:          boolean;

  // ── 3ds Max GeoSphere Parameters ──
  geodesicBaseType?: 'ICOSAHEDRON' | 'OCTAHEDRON' | 'TETRAHEDRON';
  geodesicFrequency?: number; // Subdivisions per polyhedron edge (1 to 32)
  geodesicHemisphere?: boolean; // Geodesic dome cutoff
  
  // ── 3ds Max Sphere Primitive Parameters ──
  hemisphere?:      number;  // 0.0 (full sphere) to 1.0 (flat plane), 0.5 = Dome
  chopSquash?:      'chop' | 'squash'; // 'chop' deletes bottom vertices, 'squash' compresses them into base plane
  sliceOn?:         boolean; // Slice pie cutter
  sliceFrom?:       number;  // Start angle in degrees (0 to 360)
  sliceTo?:         number;  // End angle in degrees (0 to 360)
  baseToPivot?:     boolean; // Aligns bottom pole to Y=0 origin pivot
  smooth?:          boolean; // Smooth shading vs faceted

  // ── Space Warps and Particle Systems ──
  particleConfig?:  ParticleSystemConfig;
  warpConfig?:      SpaceWarpConfig;

  // NURBS Parametric Data
  nurbsCurve?:      NurbsCurveData;
  nurbsSurface?:    NurbsSurfaceData;
  nurbsResolutionU?: number;
  nurbsResolutionV?: number;
  
  // Extrusion
  extrusionDepth?:  number;
  extrusionAxis?:   'x' | 'y' | 'z';
  profileVertices?: V3[];
  profileBezierHandles?: BezierHandle[];

  // Generation (Advanced)
  genType?:         string;
  genSides?:        number;
  genRadius?:       number;
  genR?:            number;
  genStart?:        number;
  genEnd?:          number;
  genSegs?:         number;
  genFilled?:       boolean;
  genPreset?:       string;
  genH?:            number;
  genProf?:         string;
  genPath?:         string;
  genLen?:          number;
  genS1?:           string;
  genS2?:           string;
  genN?:            number;
  genAxis?:         'x' | 'y' | 'z';
  genAngle?:        number;
  
  // Volumetric Raymarching
  isVolumetric?:    boolean;
  volumetric?:      VolumetricConfig;

  [key: string]:    any;
}

export interface Transform {
  position: V3;
  rotation: V3;
  scale:    V3;
}

export interface Keyframe {
  id:        string;
  time:      number;
  transform: Transform;
}

/**
 * Handle de Bézier cúbico para un punto ancla.
 * - `out`: controla la tangente de SALIDA (hacia el siguiente segmento)
 * - `in`:  controla la tangente de ENTRADA (desde el segmento anterior)
 * - Las posiciones son RELATIVAS al punto ancla (espacio local)
 * - Por defecto son simétricas (smooth). Cuando `broken=true` son independientes.
 */
export interface BezierHandle {
  out:    V3;      // tangente de salida relativa al ancla
  in:     V3;      // tangente de entrada relativa al ancla
  broken: boolean; // true = handles independientes (cusp/corner)
}

export interface MaterialData {
  id: string;
  name: string;
  color: string;
  map?: string; // Albedo
  mapAlbedo?: string;
  roughness: number;
  roughnessMap?: string;
  mapRoughness?: string;
  metalness: number;
  metalnessMap?: string;
  mapMetalness?: string;
  normalMap?: string;
  mapNormal?: string;
  normalScale?: number;
  displacementMap?: string;
  mapDisplacement?: string;
  displacementScale?: number;
  displacementBias?: number;
  aoMap?: string;
  mapAO?: string;
  aoMapIntensity?: number;
  emissive: string;
  emissiveMap?: string;
  mapEmissive?: string;
  emissiveIntensity: number;
  opacity: number;
  alphaMap?: string;
  transparent: boolean;
  ior?: number;
  transmission?: number;
  dispersion?: number;
  thickness?: number;
  attenuationDistance?: number;
  attenuationColor?: string;
  clearcoat?: number;
  clearcoatRoughness?: number;
  clearcoatNormalMap?: string;
  clearcoatNormalScale?: number;
  clearcoatMap?: string;
  clearcoatRoughnessMap?: string;
  sheen?: number;
  sheenRoughness?: number;
  sheenColor?: string;
  sheenColorMap?: string;
  sheenRoughnessMap?: string;
  anisotropy?: number;
  anisotropyRotation?: number;
  anisotropyMap?: string;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThicknessRange?: [number, number];
  iridescenceMap?: string;
  iridescenceThicknessMap?: string;
  transmissionMap?: string;
  thicknessMap?: string;
  specularIntensity?: number;
  specularColor?: string;
  normalFormat?: 'OPENGL' | 'DIRECTX';
  invertNormalY?: boolean;
  flipY?: boolean;
  category?: string;
  uvwMapping?: 'PLANAR' | 'BOX' | 'SPHERICAL' | 'CYLINDRICAL' | 'TRIPLANAR' | 'UV' | 'SMART_UV' | 'LIGHTMAP';
  triplanarBlend?: number; // 0.0 (Duro) a 1.0 (Difuminado suave en biseles y esquinas)
  uvAngleThreshold?: number; // Ángulo límite de Smart UV (por defecto 66°)
  uvIslandMargin?: number; // Margen de separación entre islas UV (por defecto 0.02)
  uvRelaxIterations?: number; // Pasos de relajación laplaciana contra estiramiento (por defecto 6)
  // ORM Specific Intensities (for custom shader)
  ormIntensityAO?: number;
  ormIntensityRoughness?: number;
  ormIntensityMetalness?: number;
  useORM?: boolean;
  ormMap?: string; // Combined texture
  // Texture transformations
  mapRepeat?: [number, number];
  mapOffset?: [number, number];
  mapRotation?: number;
  parallaxScale?: number;
  parallaxSteps?: number;
  useParallax?: boolean;
  proceduralBaseId?: string;
  uvDebug?: boolean;
  filters?: {
    rust: number;
    scratches: number;
    dirt: number;
  };
  // Porosidad y Micro-relieve superficial (rompe el acabado liso y brillo uniforme)
  porosity?: number | boolean;   // 0.0 (Liso) a 1.0 (Muy poroso/rugoso) o boolean
  porosityStrength?: number;     // Fuerza / Profundidad de microcavidades
  porosityScale?: number;        // Escala/frecuencia espacial de los poros (ej: 4.0 a 60.0)
  porosityRoughness?: number;    // Aumento de rugosidad en poros (matifica y rompe reflejos)
  porosityCavityDepth?: number;  // Profundidad de micro-cavidades / oclusión
  porosityCoverage?: number;     // Cobertura de la distribución porosa (0.1 a 1.0)
  porosityPatchiness?: number;   // Distribución en zonas / parches desiguales (0.0 a 1.0)
  porosityPatchScale?: number;   // Escala de los parches desiguales (0.5 a 15.0)
  porosityMatteBias?: number;    // Opacado / mateado de poros para eliminar brillo plástico (0.0 a 1.0)
  porosityCavityDarkening?: number; // Sombreado / oclusión en fondo de cavidades (0.0 a 0.8)
  isVolumetric?: boolean;
  volumetric?: VolumetricConfig;
  isIce?: boolean;
  iceConfig?: IceShaderConfig;
  isCSM?: boolean;
  csmConfig?: CSMConfig;
  customShaderMaterial?: any;
  isGlass?: boolean;
  glassConfig?: GlassMaterialConfig;
}

export type BlueprintViewKey = 'front' | 'top' | 'side';

export type CSMBaseMaterialType = 'MeshPhysicalMaterial' | 'MeshStandardMaterial' | 'MeshToonMaterial' | 'MeshLambertMaterial' | 'MeshBasicMaterial';

export type CSMPresetType =
  | 'custom'
  | 'wave_distortion'
  | 'hologram_shield'
  | 'volcanic_magma'
  | 'bio_organic_flesh'
  | 'quantum_crystal'
  | 'twist_vortex'
  | 'digital_wire_glitch'
  | 'comic_halftone'
  | 'soap_bubble';

export interface CSMConfig {
  enabled?: boolean;
  baseMaterial?: CSMBaseMaterialType;
  preset?: CSMPresetType;
  vertexShader?: string;
  fragmentShader?: string;
  timeSpeed?: number;
  displacementScale?: number;
  noiseFrequency?: number;
  colorAccent?: string;
  glowIntensity?: number;
  wireframeOverlay?: boolean;
  roughnessMod?: number;
  metalnessMod?: number;
}

export type GlassPresetType =
  | 'newton_dispersion_prism'
  | 'diamond_spectral'
  | 'soap_bubble_spectral'
  | 'frosted_mist_glass'
  | 'liquid_wave_glass'
  | 'smoked_obsidian'
  | 'handblown_bubbles'
  | 'dichroic_rainbow'
  | 'warm_amber_liquid'
  | 'custom';

export interface GlassMaterialConfig {
  enabled?: boolean;
  preset?: GlassPresetType;
  dispersion?: number; // 0.0 to 0.2 (Cauchy spectral dispersion)
  chromaticAberration?: number; // 0.0 to 0.15 (RGB wavelength split offset)
  distortion?: number; // 0.0 to 1.0 (Surface waviness / fluid distortion)
  distortionSpeed?: number; // 0.0 to 4.0
  distortionFrequency?: number; // 0.5 to 10.0
  frostedBlur?: number; // 0.0 to 1.0 (Subsurface scattering & micro-roughness)
  internalBubbles?: boolean;
  bubbleDensity?: number; // 0.0 to 3.0 (3D procedural air inclusions)
  bubbleScale?: number; // 5.0 to 50.0
  causticIntensity?: number; // 0.0 to 2.0 (Internal caustic highlights)
  rimGlow?: number; // 0.0 to 2.0 (Schlick Fresnel edge brilliance)
  rimColor?: string; // Hex color for Fresnel edge
  beerLambertAbsorption?: number; // Attenuation density
  thinFilmIridescence?: number; // 0.0 to 1.0 (Rainbow oil film interference)
}

export interface IceShaderConfig {
  enabled?: boolean;
  surfaceWarp?: number;      // Deformación orgánica Voronoi/Perlin de caras (0.0 a 0.25)
  cloudDensity?: number;     // Densidad del núcleo blanco interno Musgrave 3D (0.0 a 3.0)
  cloudColor?: string;       // Color del núcleo nuboso interno (ej: #f0f9ff)
  cloudScale?: number;       // Escala del ruido 3D interno
  frostIntensity?: number;   // Escarcha en bordes/ángulo Fresnel Facing (0.0 a 1.0)
  crackIntensity?: number;   // Grietas de tensión y fracturas internas Voronoi 3D
  porosity?: number;         // Porosidad y micro-rugosidad de superficie glacial (0.0 a 1.0)
  porosityScale?: number;    // Escala de microporos glaciales (ej: 10.0 a 40.0)
}

export type LightType = 'POINT' | 'DIRECTIONAL' | 'SPOT' | 'RECTAREA' | 'AMBIENT';

export interface LightObject {
  id: string;
  name: string;
  type: LightType;
  color: string;
  intensity: number;
  transform: Transform;
  visible: boolean;
  castShadow: boolean;
  // Specific params
  distance?: number; // Point/Spot (alcance en metros)
  decay?: number;    // Point/Spot (atenuación física)
  angle?: number;    // Spot (ángulo de apertura)
  penumbra?: number; // Spot (suavidad de borde)
  width?: number;    // RectArea
  height?: number;   // RectArea
  groundColor?: string; // Ambient / Hemispheric
  // Controles avanzados de sombras
  shadowBias?: number;       // Anti-acné / costuras de sombra
  shadowNormalBias?: number; // Desplazamiento normal de sombra
  shadowRadius?: number;     // Radio de desenfoque / sombras suaves
  shadowMapSize?: number;    // Resolución del mapa de sombras (512, 1024, 2048, 4096)
  shadowCameraSize?: number; // Frustum ortográfico para direccional
}

export interface CSGObject {
  id:        string;
  name:      string;
  type:      PrimitiveType;
  operation: CSGOperation;
  transform: Transform;
  parameters: ShapeParameters;

  // Topología de malla
  vertices:       V3[];
  faces:          MeshFace[];
  vertexOffsets?: Record<number, V3>;
  wireframeEdges?: [number, number][];
  edges?: [number, number][];
  wireframeAsTubes?: boolean;
  isWireframeOnly?: boolean;
  blueprintStyle?: boolean;
  silhouetteOnly?: boolean;
  creaseAngle?: number;
  showWireframe?: boolean;
  wireframeColor?: string;
  originalColor?: string;

  // Bézier cúbico: un handle por punto ancla (solo para SHAPE + shapeType=bezier)
  bezierHandles?: BezierHandle[];

  // NURBS Parametric Definition
  nurbsCurve?:    NurbsCurveData;
  nurbsSurface?:  NurbsSurfaceData;
  isNurbs?:       boolean;
  selectedNurbsControlPoint?: { u: number; v?: number } | null;
  selectedNurbsControlPoints?: { u: number; v?: number }[];

  mirrorAxis?: 'none' | 'x' | 'y' | 'z';
  smoothShading?: boolean;
  uvDebug?: boolean;
  isVolumetric?: boolean;
  volumetric?: VolumetricConfig;
  isParticleSystem?: boolean;
  particleConfig?: ParticleSystemConfig;
  isSpaceWarp?: boolean;
  warpConfig?: SpaceWarpConfig;
  spaceWarpConfig?: SpaceWarpConfig;
  isGpgpuSwarm?: boolean;
  gpgpuSwarmConfig?: GpgpuSwarmConfig;
  color:    string;
  opacity?: number;
  visible:  boolean;
  keyframes: Keyframe[];
  materialId?: string; // Reference to a project material
  material?: Partial<MaterialData>; // Inline overrides
  meshData?: {
    type: 'stl' | 'obj' | 'gltf';
    data: string; // base64 or raw string
    animations?: any[]; // For GLTF animations
    meshes?: { id: string, name: string, vertices: number, faces: number }[]; // For GLTF parts
  };
  stats?: {
    vertices: number;
    faces: number;
    quads?: number;
    triangles?: number;
    reductionPct?: number;
  };
}

export interface ReferenceImage {
  url:           string | null;
  position:      V3;
  rotation:      V3;
  scale:         V3;
  opacity:       number;
  locked:        boolean;
  flipX?:        boolean; // Espejo horizontal
  flipY?:        boolean; // Espejo vertical / invertir
  angle?:        number;  // Rotación en grados
  fixedToScreen?: boolean; // Si true, la imagen se mantiene de tamaño fijo en pantalla sin escalar con el zoom
}

export interface CameraObject {
  id: string;
  name: string;
  type: 'PERSPECTIVE' | 'ORTHOGRAPHIC';
  transform: Transform;
  fov: number; // For perspective, this is vertical FOV. For orthographic, it's used as size.
  focalLength?: number; // in mm
  filmGauge?: number; // Sensor size in mm (default 35)
  near: number;
  far: number;
  zoom: number;

  // Seguimiento de Objetivo y Ruta de Cámara
  targetObjectId?: string | null;     // ID del objeto al que la cámara apunta/sigue
  pathObjectId?: string | null;       // ID de la línea o curva por la que se desplaza la cámara
  pathProgress?: number;              // Progreso manual (0.00 a 1.00) en la ruta
  followPathAnimation?: boolean;      // Sincronizar movimiento en la ruta con la línea de tiempo
  cameraOffset?: V3;                  // Desplazamiento opcional respecto a la ruta o al objetivo
  keyframes?: Keyframe[];
}

export interface Project {
  name:     string;
  objects:  CSGObject[];
  lights:   LightObject[];
  cameras:  CameraObject[];
  materials: MaterialData[];
  duration: number;
  fps:      number;
  references: {
    top:    ReferenceImage;
    bottom: ReferenceImage;
    front:  ReferenceImage;
    back:   ReferenceImage;
    left:   ReferenceImage;
    right:  ReferenceImage;
  };
  silueta: SilhouetteState;
  environment: EnvironmentSettings;
  showGrid?: boolean;
  showSkeleton?: boolean;
}

export type BackgroundMode = 'HDRI' | 'GRADIENT' | 'COLOR' | 'TRANSPARENT';

export interface EnvironmentSettings {
  hdriUrl: string | null;
  backgroundMode?: BackgroundMode;
  backgroundVisible: boolean;
  backgroundColor?: string;
  backgroundBlur?: number;
  backgroundIntensity?: number;
  rotation?: number;
  intensity: number;
  exposure: number;
  maxResolution?: number;
}

export type ViewportType   = 'PERSPECTIVE' | 'TOP' | 'BOTTOM' | 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' | 'CAMERA';
export type ViewportLayoutPreset = 
  | 'QUAD' 
  | 'SINGLE' 
  | 'TOP_1_BOTTOM_2' 
  | 'TOP_2_BOTTOM_1' 
  | 'LEFT_1_RIGHT_2' 
  | 'RIGHT_1_LEFT_2' 
  | 'SPLIT_H' 
  | 'SPLIT_V';

export type SnapTargetType = 'INCREMENT' | 'FACE' | 'VERTEX';

export interface FaceSnapConfig {
  enabled: boolean;
  targetType: SnapTargetType;
  projectIndividualElements: boolean; // Cada vértice se ajusta a la cara debajo en vez de moverse como bloque rígido
  offset: number; // Offset de separación (evita Z-fighting)
  targetObjectId?: string | null; // ID del objeto de destino (high-poly), o null para auto
  alignRotationToTarget?: boolean; // Alinear la rotación del objeto con la normal de la cara donde se apoya (estilo Blender)
  snapBaseToSurface?: boolean; // Apoya la base del accesorio sobre la cara en vez de incrustar el pivote/centro dentro
  alignmentAxis?: '+Y' | '-Y' | '+Z' | '-Z' | '+X' | '-X'; // Eje local del objeto que se proyecta hacia la normal (por defecto +Y)
}

export type ShrinkwrapMode = 
  | 'NEAREST_SURFACE_POINT' 
  | 'PROJECT' 
  | 'NEAREST_VERTEX' 
  | 'TARGET_NORMAL_PROJECT';

export type ProjectAxis = 'X' | 'Y' | 'Z';
export type ProjectDirection = 'POSITIVE' | 'NEGATIVE' | 'BOTH';

export interface ShrinkwrapConfig {
  targetId: string;
  mode: ShrinkwrapMode;
  offset: number;
  projectAxis?: ProjectAxis;
  projectDirection?: ProjectDirection;
  onlySelectedVertices?: boolean;
}

export interface ViewportConfigState {
  preset: ViewportLayoutPreset;
  splitX: number; // 0.15 to 0.85 (default 0.5)
  splitY: number; // 0.15 to 0.85 (default 0.5)
  customResizeMode: boolean;
  snapStep: number; // e.g. 0.1, 0.25, 0.5, 1.0, 2.0, 5.0
}
export type EditMode       = 'OBJECT' | 'VERTEX' | 'FACE' | 'EDGE';
export type TransformMode  = 'translate' | 'rotate' | 'scale' | 'universal';
export type TransformSpace = 'world' | 'local';
export type ViewMode       = 'SOLID' | 'WIREFRAME' | 'TEXTURED' | 'TEXTURED_WIREFRAME' | 'FACES_VERTICES' | 'BLUEPRINT';

export interface HistoryStep {
  id: string;
  label: string;
  timestamp: number;
  objectName?: string;
  objectId?: string;
  objectCount?: number;
  faceCount?: number;
  vertexCount?: number;
  prevFaceCount?: number;
  prevVertexCount?: number;
  deltaFaces?: number;
  deltaVertices?: number;
  totalSceneFaces?: number;
  totalSceneVertices?: number;
  category?: 'retopo' | 'edit' | 'transform' | 'boolean' | 'create' | 'delete' | 'material' | 'general';
}

export interface SilhouetteState {
  front: SilhouetteContour | null;
  back:  SilhouetteContour | null;
  left:  SilhouetteContour | null;
  right: SilhouetteContour | null;
  top:   SilhouetteContour | null;
  bottom:SilhouetteContour | null;
  frontImage: string | null;
  backImage:  string | null;
  leftImage:  string | null;
  rightImage: string | null;
  topImage:   string | null;
  bottomImage:string | null;
  activePlane: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | null;
}

export interface CameraState {
  position: V3;
  target: V3;
  zoom: number;
}

export interface ViewportCameraState {
  [key: string]: CameraState;
}

export interface MeshProcessingState {
  active: boolean;
  title: string;
  subtitle?: string;
  progress: number;
  objectName?: string;
  vertCount?: number;
  faceCount?: number;
  completed?: boolean;
  finalVertCount?: number;
  finalFaceCount?: number;
}

export interface AppState {
  project:           Project;
  meshProcessing?:   MeshProcessingState | null;
  closeMeshProcessing: () => void;
  selectedObjectId:  string | null;
  selectedLightId?:  string | null;
  selectedCameraId?: string | null;
  selectedObjectIds: string[];
  selectedVertexIndices: number[];
  selectedFaceIndices:   number[];
  selectedEdgeIndices:   number[];
  selectedGLTFMeshes:    string[];
  isolateGLTFSelection:  boolean;
  clipboard: CSGObject | null;
  currentTime: number;
  isPlaying:   boolean;
  isScrubbing?: boolean;
  setIsScrubbing?: (isScrubbing: boolean) => void;
  isRecording: boolean;
  viewMode:       ViewMode;
  editMode:       EditMode;
  transformMode:  TransformMode;
  transformSpace: TransformSpace;
  drawMode:       'line' | 'rect' | 'bezier' | null;
  drawColor:      string;
  orthoDrawMode:  boolean;
  setOrthoDrawMode: (enabled: boolean) => void;
  drawLockAxis:   'FREE' | 'ORTHO_90' | 'X' | 'Y' | 'Z';
  setDrawLockAxis: (axis: 'FREE' | 'ORTHO_90' | 'X' | 'Y' | 'Z') => void;
  insertVertexMode: boolean;
  setInsertVertexMode: (enabled: boolean) => void;
  loopCutMode: boolean;
  setLoopCutMode: (enabled: boolean) => void;
  loopCutCuts: number;
  setLoopCutCuts: (cuts: number) => void;
  loopCutSlide: number;
  setLoopCutSlide: (slide: number) => void;
  showCSG:        boolean;
  gridSnapEnabled: boolean;
  faceSnapConfig: FaceSnapConfig;
  setFaceSnapConfig: (cfg: Partial<FaceSnapConfig>) => void;
  toggleFaceSnap: () => void;
  moveReferenceMode: boolean;
  activeViewport:    ViewportType;
  maximizedViewport: ViewportType | null;
  lastCameraState?:  CameraState;
  viewportCameras:   ViewportCameraState;
  viewportConfig:    ViewportConfigState;
  setViewportPreset: (preset: ViewportLayoutPreset) => void;
  setViewportSplits: (splitX: number, splitY: number) => void;
  setCustomResizeMode: (active: boolean) => void;
  setSnapStep: (step: number) => void;
  resetViewportSplits: () => void;
  history:      Project[];
  historySteps: HistoryStep[];
  historyIndex: number;
  saveHistory:  (actionLabel?: string, category?: HistoryStep['category']) => void;
  jumpToHistory: (targetIndex: number) => void;
  clearHistory: () => void;
  deleteHistoryStep: (index: number) => void;
  deleteFutureHistory: () => void;
  deletePastHistory: () => void;
  deleteHistoryRange: (fromIndex: number, toIndex: number) => void;
  isMaterialStudioOpen: boolean;
  materialStudioMaterialId: string | null;
  openMaterialStudio: (materialId?: string | null) => void;
  closeMaterialStudio: () => void;
  setMaterialStudioMaterialId: (id: string) => void;
}
