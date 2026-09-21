import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { BackgroundMode } from '../types';
import {
  X, Download, Play, Pause, RefreshCw, Sparkles, Settings, Camera,
  Sun, Globe, Palette, RotateCw, Upload, Video, Film, Clock, Target,
  Route, CheckCircle, FileVideo, Layers
} from 'lucide-react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { setupSceneEnvironment, PRESET_HDRIS } from '../utils/environmentHelper';
import { fileToDataURL } from '../utils/silhouettes';
import { createBaseGeometry } from '../utils/csg';
import { computeSmoothNormalsByPosition } from '../utils/meshUtils';
import { applyUVWMapping, generateUVs } from '../utils/modifiers';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { evaluateCameraTransform } from '../utils/cameraPathHelper';
import { createPBRMaterial, injectSeamlessDisplacement } from '../utils/materialUtils';
import { setupTriplanarMaterial } from '../utils/TriplanarMaterial';
import { createParallaxMaterial } from '../utils/ParallaxMaterial';
import { createRaymarchedCloudMaterial } from '../utils/volumetricRaymarch';
import { getUVDebugTexture } from '../utils/proceduralTextures';
import { createGpgpuSwarmMesh, DEFAULT_GPGPU_SWARM_CONFIG } from '../utils/gpgpuSwarm';
import {
  ParticleSimulator,
  DEFAULT_PARTICLE_CONFIG,
  DEFAULT_SPACE_WARP_CONFIG,
  SpaceWarpObjectData
} from '../utils/particleSystem';

interface RenderModalProps { onClose: () => void; }

// ── Opciones de calidad ────────────────────────────────────────────────────
const QUALITY_PRESETS = {
  draft:   { samples: 32,  bounces: 3,  label: 'Borrador', desc: '~3s'   },
  medium:  { samples: 128, bounces: 5,  label: 'Media',    desc: '~12s'  },
  high:    { samples: 256, bounces: 8,  label: 'Alta',     desc: '~30s'  },
  ultra:   { samples: 512, bounces: 12, label: 'Ultra',    desc: '~1min' },
};
type QualityKey = keyof typeof QUALITY_PRESETS;

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function getInterpolatedTransform(obj: any, time: number) {
  const kfs = obj.keyframes;
  if (!kfs || kfs.length === 0) return obj.transform;
  const sorted = [...kfs].sort((a: any, b: any) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].transform;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
  let prev = sorted[0], next = sorted[0];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i]; next = sorted[i + 1]; break;
    }
  }
  const t = (time - prev.time) / (next.time - prev.time);
  return {
    position: [0,1,2].map(i => lerp(prev.transform.position[i], next.transform.position[i], t)) as [number,number,number],
    rotation: [0,1,2].map(i => lerp(prev.transform.rotation[i], next.transform.rotation[i], t)) as [number,number,number],
    scale:    [0,1,2].map(i => lerp(prev.transform.scale[i],    next.transform.scale[i],    t)) as [number,number,number],
  };
}

/** Halton sequence for low-discrepancy sub-pixel anti-aliasing jitter */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/** Espera a que todas las imágenes de las texturas asignadas al material carguen físicamente */
function waitForMaterialTextures(mat: THREE.Material): Promise<void> {
  const textures: THREE.Texture[] = [];
  const anyMat = mat as any;
  const keys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'displacementMap', 'alphaMap', 'clearcoatNormalMap', 'bumpMap'];
  for (const k of keys) {
    if (anyMat[k] && anyMat[k].isTexture) {
      textures.push(anyMat[k]);
    }
  }
  if (textures.length === 0) return Promise.resolve();

  const promises = textures.map(tex => {
    return new Promise<void>((resolve) => {
      const img = tex.image as any;
      if (!img) {
        const check = setInterval(() => {
          const currentImg = tex.image as any;
          if (currentImg && (currentImg.complete || currentImg.width > 0)) {
            clearInterval(check);
            resolve();
          }
        }, 20);
        setTimeout(() => { clearInterval(check); resolve(); }, 3000);
      } else if (img.complete || img.width > 0) {
        resolve();
      } else if (typeof img.addEventListener === 'function') {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        setTimeout(() => resolve(), 3000);
      } else {
        resolve();
      }
    });
  });

  return Promise.all(promises).then(() => {});
}

// Shader para acumular muestras temporalmente (Super-Sampling Anti-Aliasing & Soft Shadows)
const blendShader = {
  uniforms: {
    tNew: { value: null as THREE.Texture | null },
    tOld: { value: null as THREE.Texture | null },
    blendWeight: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tNew;
    uniform sampler2D tOld;
    uniform float blendWeight;
    varying vec2 vUv;
    void main() {
      vec4 newColor = texture2D(tNew, vUv);
      vec4 oldColor = texture2D(tOld, vUv);
      gl_FragColor = mix(oldColor, newColor, blendWeight);
    }
  `,
};

// Shader para aplicar Tone Mapping al mostrar el buffer acumulado en pantalla
const displayShader = {
  uniforms: {
    tTexture: { value: null as THREE.Texture | null },
    exposure: { value: 1.2 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tTexture;
    uniform float exposure;
    varying vec2 vUv;

    vec3 ACESFilmicToneMapping(vec3 color) {
      color *= exposure;
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
    }

    void main() {
      vec4 texColor = texture2D(tTexture, vUv);
      vec3 mapped = ACESFilmicToneMapping(texColor.rgb);
      gl_FragColor = vec4(mapped, texColor.a);
    }
  `,
};

/** Sincroniza e inyecta la iluminación exacta del visor interactivo o rig de estudio en la escena */
function setupProjectLightsInScene(scene: THREE.Scene, projectLights: any[]) {
  const visibleLights = projectLights ? projectLights.filter((l: any) => l.visible) : [];

  if (visibleLights.length > 0) {
    visibleLights.forEach((lData: any) => {
      const color = lData.color || '#ffffff';
      const intensity = lData.intensity ?? 1.0;
      let light: THREE.Light | null = null;

      const tipoLuzSeguro = (lData.type || '').toUpperCase();

      switch (tipoLuzSeguro) {
        case 'POINT':
          light = new THREE.PointLight(color, intensity, lData.distance || 0, lData.decay || 2);
          break;
        case 'DIRECTIONAL':
          light = new THREE.DirectionalLight(color, intensity);
          break;
        case 'SPOT':
          light = new THREE.SpotLight(
            color,
            intensity,
            lData.distance || 0,
            lData.angle || Math.PI / 4,
            lData.penumbra || 0.5,
            lData.decay || 2
          );
          break;
        case 'RECTAREA':
          light = new THREE.RectAreaLight(color, intensity, lData.width || 1, lData.height || 1);
          break;
        case 'AMBIENT':
          light = new THREE.AmbientLight(color, intensity);
          break;
      }

      if (!light) return;

      // Sincronizar posición y rotación transform
      if (lData.transform?.position) {
        light.position.fromArray(lData.transform.position);
      } else if (lData.position) {
        light.position.fromArray(lData.position);
      }

      if (lData.transform?.rotation) {
        light.rotation.fromArray(lData.transform.rotation);
      } else if (lData.rotation) {
        light.rotation.fromArray(lData.rotation);
      }

      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
        const target = new THREE.Object3D();
        target.position.set(0, 0, -1);
        light.add(target);
        light.target = target;
        scene.add(target);
      }

      light.castShadow = lData.castShadow ?? true;
      const l = light as any;
      if (l.shadow) {
        l.shadow.bias = -0.0001;
        l.shadow.normalBias = 0.05;
        l.shadow.mapSize.set(2048, 2048);
        if (light instanceof THREE.DirectionalLight) {
          l.shadow.camera.left = -20;
          l.shadow.camera.right = 20;
          l.shadow.camera.top = 20;
          l.shadow.camera.bottom = -20;
          l.shadow.camera.near = 0.1;
          l.shadow.camera.far = 50;
        } else if (light instanceof THREE.SpotLight || light instanceof THREE.PointLight) {
          l.shadow.camera.near = 0.1;
          l.shadow.camera.far = 50;
        }
      }

      scene.add(light);
    });
  } else {
    // Si el usuario no ha añadido luces manuales, inyectar Rig de Estudio PBR de 3 Puntos
    // idéntico al Editor de Materiales para conseguir reflejos, brillos y volumen fotorealista
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    ambientLight.name = 'editorAmbientLight';
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 2.2);
    keyLight.name = 'editorDirectionalLight';
    keyLight.position.set(4, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.normalBias = 0.05;
    keyLight.shadow.radius = 2.5;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd8e4fc, 0.85);
    fillLight.position.set(-4, 2, -2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 1.3);
    rimLight.position.set(0, 4, -4);
    scene.add(rimLight);
  }
}

export const RenderModal: React.FC<RenderModalProps> = ({ onClose }) => {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const { project, currentTime, lastCameraState, updateEnvironment } = useStore();

  // Mode Selection: PHOTO (imagen fija) vs VIDEO (animación)
  const [renderType, setRenderType] = useState<'PHOTO' | 'VIDEO'>('PHOTO');

  const [samples, setSamples]       = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [status, setStatus]         = useState('Configurando...');
  const [quality, setQuality]       = useState<QualityKey>('draft');
  const [showSettings, setShowSettings] = useState(true);
  const [showGround, setShowGround] = useState(false);
  const [fov, setFov]               = useState((lastCameraState as any)?.fov || 45);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<'viewport' | '720p' | '1080p' | '4k' | 'square' | 'vertical'>('viewport');
  const [ready, setReady]           = useState(false);
  const [error, setError]           = useState('');

  // ── Parámetros de Generación de Video ────────────────────────────────────
  const [durationSource, setDurationSource] = useState<'ANIMATED_OBJECT' | 'TIMELINE' | 'CUSTOM'>('ANIMATED_OBJECT');
  const [customDuration, setCustomDuration] = useState(5.0);
  const [videoFps, setVideoFps]             = useState<24 | 30 | 60>(30);
  const [videoBitrate, setVideoBitrate]     = useState<number>(8); // Mbps (2, 4, 8, 16)
  const [videoCodec, setVideoCodec]         = useState<string>('video/webm;codecs=vp9');
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoProgress, setVideoProgress]   = useState({ currentFrame: 0, totalFrames: 0, pct: 0, etaSec: 0 });
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const rendererRef   = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef     = useRef<THREE.PerspectiveCamera | null>(null);
  const rafRef        = useRef<number | null>(null);
  const mountedRef    = useRef(true);

  const preset = QUALITY_PRESETS[quality];

  // Detect loaded GLTF animations or procedural keyframes
  const detectedAnimationInfo = useMemo(() => {
    let maxDur = 0;
    let sourceName = 'Ninguna animación detectada';

    project.objects.forEach(obj => {
      if (obj.meshData?.animations && Array.isArray(obj.meshData.animations)) {
        obj.meshData.animations.forEach((anim: any) => {
          const dur = anim.duration || anim.length || 0;
          if (dur > maxDur) {
            maxDur = dur;
            sourceName = `${obj.name} (${anim.name || 'Clip GLTF'}, ${dur.toFixed(2)}s)`;
          }
        });
      }
      if (obj.keyframes && obj.keyframes.length > 0) {
        const maxKeyTime = Math.max(...obj.keyframes.map(k => k.time || 0));
        if (maxKeyTime > maxDur) {
          maxDur = maxKeyTime;
          sourceName = `${obj.name} (Timeline Keyframes, ${maxKeyTime.toFixed(2)}s)`;
        }
      }
    });

    return { maxDur, sourceName };
  }, [project.objects]);

  // Total duration of video in seconds
  const effectiveVideoDuration = useMemo(() => {
    if (durationSource === 'ANIMATED_OBJECT' && detectedAnimationInfo.maxDur > 0) {
      return detectedAnimationInfo.maxDur;
    }
    if (durationSource === 'CUSTOM') {
      return customDuration;
    }
    return project.duration || 5.0;
  }, [durationSource, detectedAnimationInfo, customDuration, project.duration]);

  // Available codecs supported by browser MediaRecorder
  const supportedCodecs = useMemo(() => {
    const candidates = [
      { id: 'video/webm;codecs=vp9', label: 'VP9 (Máxima Calidad WebM)' },
      { id: 'video/webm;codecs=vp8', label: 'VP8 (Compatibilidad Alta)' },
      { id: 'video/webm;codecs=h264', label: 'H.264 (AVC Video)' },
      { id: 'video/webm', label: 'WebM Estándar' },
    ];
    if (typeof window !== 'undefined' && window.MediaRecorder) {
      return candidates.map(c => ({
        ...c,
        supported: MediaRecorder.isTypeSupported(c.id),
      }));
    }
    return candidates.map(c => ({ ...c, supported: true }));
  }, []);

  // ── Inicio del render de Imagen Fija (Photo) ──────────────────────────────────
  const startRender = useCallback(async () => {
    if (!canvasRef.current || !containerRef.current) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (rendererRef.current) { 
      try { rendererRef.current.dispose(); } catch (_) {}
      rendererRef.current = null; 
    }

    setReady(false);
    setError('');
    setSamples(0);
    setIsRendering(false);
    setStatus('Creando motor físico de render...');

    let w = containerRef.current.clientWidth;
    let h = containerRef.current.clientHeight;

    if (resolution === '720p') {
      w = 1280; h = 720;
    } else if (resolution === '1080p') {
      w = 1920; h = 1080;
    } else if (resolution === '4k') {
      w = 3840; h = 2160;
    } else if (resolution === 'square') {
      w = 1080; h = 1080;
    } else if (resolution === 'vertical') {
      w = 1080; h = 1920;
    }

    // ── Renderer de alta definición con ToneMapping ───────────────────────
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = project.environment.exposure ?? 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    rendererRef.current = renderer;

    // ── Cámara y Evaluación de Ruta / Objetivo ─────────────────────────────
    const camera = new THREE.PerspectiveCamera(fov, w / h, 0.01, 1000);
    
    if (selectedCameraId) {
      const camObj = project.cameras?.find(c => c.id === selectedCameraId);
      if (camObj) {
        if (camObj.targetObjectId || camObj.pathObjectId) {
          const evalCam = evaluateCameraTransform(camObj, project.objects, currentTime, project.duration || 5);
          camera.position.copy(evalCam.position);
          if (evalCam.target) camera.lookAt(evalCam.target);
          camera.fov = evalCam.fov;
        } else {
          camera.position.fromArray(camObj.transform.position);
          camera.rotation.fromArray(camObj.transform.rotation);
          camera.fov = camObj.fov;
        }
      }
    } else if ((lastCameraState as any)?.position) {
      const pos = (lastCameraState as any).position;
      const target = (lastCameraState as any).target ?? [0, 0, 0];
      const posVec = new THREE.Vector3().fromArray(pos);
      const targetVec = new THREE.Vector3().fromArray(target);
      if (isNaN(posVec.x) || posVec.distanceTo(targetVec) < 0.001) {
        camera.position.set(0, 2, 6);
        camera.lookAt(0, 0, 0);
      } else {
        camera.position.copy(posVec);
        camera.lookAt(targetVec);
      }
    } else {
      camera.position.set(0, 2, 6);
      camera.lookAt(0, 0, 0);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    cameraRef.current = camera;

    // ── Escena y Entorno PBR ────────────────────────────────────────────────────────────
    setStatus('Cargando iluminación de estudio HDRI...');
    const scene = new THREE.Scene();

    await setupSceneEnvironment(scene, renderer, project.environment);

    // ── Luces de Estudio Físicas Sincronizadas con la UI ────────────────────
    setupProjectLightsInScene(scene, project.lights);

    // ── Plano de suelo con sombra suave física ────────────────────────────
    if (showGround) {
      let minY = 0;
      project.objects.forEach((obj: any) => {
        if (obj.transform) minY = Math.min(minY, obj.transform.position[1] - 0.5);
      });

      const groundGeo = new THREE.PlaneGeometry(60, 60);
      const groundMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#22242c'),
        roughness: 0.7,
        metalness: 0.1,
        clearcoat: 0.2,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = minY - 0.01;
      ground.receiveShadow = true;
      scene.add(ground);
    }

    // ── Cargar materiales y objetos ────────────────────────────────────────
    setStatus('Cargando materiales PBR...');

    const loadMaterial = async (obj: any): Promise<THREE.Material> => {
      const projectMaterials = project.materials || [];
      const refMat = obj.materialId ? projectMaterials.find((m: any) => m.id === obj.materialId) : null;
      const mData: any = refMat
        ? { ...refMat, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
        : (obj.material || {});

      let finalMData = {
        ...mData,
        color: mData.color || obj.color || '#ffffff',
        opacity: mData.opacity ?? obj.opacity ?? 1,
        transparent: (mData.opacity ?? obj.opacity ?? 1) < 1,
      };

      if (obj.uvDebug || mData.uvDebug) {
        finalMData = {
          ...finalMData,
          color: '#ffffff',
          map: getUVDebugTexture(),
          normalMap: undefined,
          roughnessMap: undefined,
          metalnessMap: undefined,
          aoMap: undefined,
          displacementMap: undefined,
          useParallax: false,
          roughness: 0.2,
          metalness: 0.0,
        };
      }

      // 1. Detectar si el objeto o su material es Volumétrico 3D (Nube, Fuego, Humo, Plasma)
      const isVolumetricObj = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || obj.parameters?.isVolumetric || finalMData.isVolumetric || finalMData.volumetric?.enabled;
      if (isVolumetricObj) {
        const volCfg = {
          ...(obj.parameters?.volumetric || {}),
          ...(obj.volumetric || {}),
          ...(finalMData.volumetric || {}),
          color: finalMData.color || obj.color || '#ffffff',
        };
        const volMat = createRaymarchedCloudMaterial(volCfg);
        volMat.transparent = true;
        volMat.depthWrite = false;
        volMat.side = THREE.DoubleSide;
        return volMat;
      }

      // 2. Comprobar si tiene mapeado de relieve Parallax activo
      if (finalMData.useParallax) {
        const parallaxMat = createParallaxMaterial(finalMData);
        await waitForMaterialTextures(parallaxMat);
        parallaxMat.needsUpdate = true;
        return parallaxMat;
      }

      // 3. Crear el material PBR unificado con las mismas reglas del Editor
      const mat = createPBRMaterial(finalMData);

      // Aplicar mapeado Triplanar solo si la proyección es explícitamente TRIPLANAR o tiene mezcla triplanar
      const nombreMat = (finalMData.name || '').toLowerCase();
      const uvMapping = finalMData.uvwMapping || 'BOX';
      const requiereTriplanar = uvMapping === 'TRIPLANAR' || nombreMat.includes('triplanar') || typeof finalMData.triplanarBlend === 'number';

      if (requiereTriplanar) {
        setupTriplanarMaterial(mat, finalMData);
      }

      // Esperar la carga física completa de las imágenes de las texturas
      await waitForMaterialTextures(mat);

      mat.needsUpdate = true;
      return mat;
    };

    const objPromises = project.objects.map(async (obj: any) => {
      if (!obj.visible) return null;
      const t = getInterpolatedTransform(obj, currentTime);
      let mesh: THREE.Object3D | null = null;

      if (obj.meshData) {
        try {
          if (obj.meshData.type === 'gltf') {
            const loader = new GLTFLoader();
            const dLoader = new DRACOLoader();
            dLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
            loader.setDRACOLoader(dLoader);
            loader.setMeshoptDecoder(MeshoptDecoder);
            const gltf = await loader.loadAsync(obj.meshData.data);
            mesh = gltf.scene;

            if (obj.materialId || (obj.material && Object.keys(obj.material).length > 0)) {
              const mat = await loadMaterial(obj);
              mesh.traverse((child: any) => {
                if (child.isMesh) {
                  child.material = mat;
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
            } else {
              mesh.traverse((child: any) => {
                if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
            }
          } else if (obj.meshData.type === 'obj') {
            const group = await new OBJLoader().loadAsync(obj.meshData.data);
            const mat = await loadMaterial(obj);
            group.traverse((child: any) => { if (child.isMesh) { child.material = mat; child.castShadow = true; child.receiveShadow = true; } });
            mesh = group;
          } else if (obj.meshData.type === 'stl') {
            const geo = await new STLLoader().loadAsync(obj.meshData.data);
            geo.computeVertexNormals();
            const mat = await loadMaterial(obj);
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true; m.receiveShadow = true;
            mesh = m;
          }
        } catch (e) {
          console.error(`[Render] Error al cargar meshData para ${obj.name}:`, e);
        }
      }

      const isGpgpu = obj.type === 'GPGPU_SWARM' || obj.isGpgpuSwarm || obj.parameters?.isGpgpuSwarm;
      const isParticle = obj.type === 'PARTICLE_SYSTEM' || obj.isParticleSystem || obj.parameters?.isParticleSystem;

      if (isGpgpu) {
        const swarmCfg = { ...DEFAULT_GPGPU_SWARM_CONFIG, ...(obj.parameters?.gpgpuSwarmConfig || {}), ...(obj.gpgpuSwarmConfig || {}) };
        mesh = createGpgpuSwarmMesh(swarmCfg, obj.id);
      } else if (isParticle) {
        const pCfg = { ...DEFAULT_PARTICLE_CONFIG, ...(obj.parameters?.particleConfig || {}), ...(obj.particleConfig || {}) };
        const particleSim = new ParticleSimulator(obj.id, pCfg);
        particleSim.seekToTime(
          currentTime,
          (t) => {
            const tr = getInterpolatedTransform(obj, t);
            return {
              position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
              quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
              scale: new THREE.Vector3(tr.scale[0], tr.scale[1], tr.scale[2])
            };
          },
          (t) => {
            const warps: SpaceWarpObjectData[] = [];
            (project.objects || []).forEach(o => {
              if (o.type === 'SPACE_WARP' || o.isSpaceWarp || o.parameters?.isSpaceWarp) {
                const wCfg = { ...DEFAULT_SPACE_WARP_CONFIG, ...(o.parameters?.spaceWarpConfig || {}), ...(o.spaceWarpConfig || {}) };
                const tr = getInterpolatedTransform(o, t);
                warps.push({
                  id: o.id,
                  type: wCfg.warpType || 'WIND',
                  position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
                  quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
                  config: wCfg
                });
              }
            });
            return warps;
          }
        );
        mesh = particleSim.points;
      } else if (!mesh) {
        try {
          const projectMaterials = project.materials || [];
          const refMat = obj.materialId ? projectMaterials.find((m: any) => m.id === obj.materialId) : null;
          const mData: any = refMat
            ? { ...refMat, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
            : (obj.material || {});

          let geo: THREE.BufferGeometry;
          const isVol = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || mData.isVolumetric || mData.volumetric?.enabled;
          if (isVol) {
            geo = new THREE.BoxGeometry(1, 1, 1);
          } else {
            geo = createBaseGeometry(obj, mData);
          }
          const mat = await loadMaterial(obj);
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = !isVol;
          m.receiveShadow = !isVol;
          mesh = m;
        } catch (e) {
          console.error(`[Render] Error al crear geometría sincronizada para ${obj.name}:`, e);
        }
      }

      if (mesh) {
        mesh.position.fromArray(t.position);
        mesh.rotation.fromArray(t.rotation);
        mesh.scale.fromArray(t.scale);
        mesh.updateMatrixWorld(true);
      }
      return mesh;
    });

    const loaded = await Promise.all(objPromises);
    loaded.forEach(o => { if (o) scene.add(o); });

    scene.updateMatrixWorld(true);

    // Desactivar Tone Mapping en el renderer para no aplicar doble o triple mapeo en los shaders
    renderer.toneMapping = THREE.NoToneMapping;

    // ── Pipeline de Acumulación Temporal (Super-Sampling & Soft Shadows en HDR) ───
    const renderTargetParams: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };

    let rtCurrent = new THREE.WebGLRenderTarget(w, h, renderTargetParams);
    let rtA       = new THREE.WebGLRenderTarget(w, h, renderTargetParams);
    let rtB       = new THREE.WebGLRenderTarget(w, h, renderTargetParams);

    const blendMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(blendShader.uniforms),
      vertexShader: blendShader.vertexShader,
      fragmentShader: blendShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const displayMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(displayShader.uniforms),
      vertexShader: displayShader.vertexShader,
      fragmentShader: displayShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    
    const blendMesh = new THREE.Mesh(quadGeo, blendMaterial);
    const blendScene = new THREE.Scene();
    blendScene.add(blendMesh);

    const displayMesh = new THREE.Mesh(quadGeo, displayMaterial);
    const displayScene = new THREE.Scene();
    displayScene.add(displayMesh);

    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    quadCamera.position.set(0, 0, 1);

    let currentSample = 0;
    setIsRendering(true);
    setReady(true);

    // ── Loop de Acumulación Sub-Píxel ──────────────────────────────────────
    const loop = () => {
      if (!mountedRef.current || !rendererRef.current) return;

      currentSample++;

      // Sub-Pixel Jitter con secuencia de Halton
      const jitterX = (halton(currentSample, 2) - 0.5) / w;
      const jitterY = (halton(currentSample, 3) - 0.5) / h;
      camera.setViewOffset(w, h, jitterX * w, jitterY * h, w, h);

      // Actualizar uniforms de volumétricos y shaders en la escena antes del render
      const nowSec = performance.now() * 0.001;
      const mainLight = (scene.getObjectByName('editorDirectionalLight') as THREE.DirectionalLight) || (scene.children.find((c: any) => c.isDirectionalLight) as THREE.DirectionalLight);
      const lightPos = mainLight ? mainLight.position : new THREE.Vector3(4, 5, 4);

      scene.traverse((child: any) => {
        if ((child.isMesh || child.isPoints || child.isLine) && child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat: any) => {
            if (mat && mat.uniforms) {
              if (mat.uniforms.uCameraPos) {
                mat.uniforms.uCameraPos.value.copy(camera.position);
              }
              if (mat.uniforms.uTime) {
                mat.uniforms.uTime.value = currentTime || nowSec;
              }
              if (mat.uniforms.uLightPosition) {
                mat.uniforms.uLightPosition.value.copy(lightPos);
              }
              if (mat.uniforms.uLightPos) {
                mat.uniforms.uLightPos.value.copy(lightPos);
              }
              if (mat.uniforms.uModelInverse) {
                child.updateMatrixWorld(true);
                mat.uniforms.uModelInverse.value.copy(child.matrixWorld).invert();
              }
            }
          });
        }
      });

      // Renderizar la vista jittered a rtCurrent
      renderer.setRenderTarget(rtCurrent);
      renderer.clear();
      renderer.render(scene, camera);

      // Si sólo es 1 muestra (borrador / vista previa), renderizar directo con Tone Mapping nativo
      if (preset.samples <= 1) {
        camera.clearViewOffset();
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = project.environment.exposure ?? 1.2;
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        setSamples(1);
        setIsRendering(false);
        setStatus('✓ Completado — 1 muestra');
        return;
      }

      // Mezclar la muestra nueva con el acumulado histórico (rtA -> rtB)
      blendMaterial.uniforms.tNew.value = rtCurrent.texture;
      blendMaterial.uniforms.tOld.value = currentSample === 1 ? rtCurrent.texture : rtA.texture;
      blendMaterial.uniforms.blendWeight.value = 1.0 / currentSample;

      renderer.setRenderTarget(rtB);
      renderer.clear();
      renderer.render(blendScene, quadCamera);

      // Dibujar imagen final acumulada en la pantalla con Tone Mapping & Corrección sRGB
      displayMaterial.uniforms.tTexture.value = rtB.texture;
      displayMaterial.uniforms.exposure.value = project.environment.exposure ?? 1.2;

      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(displayScene, quadCamera);

      // Swap rtA y rtB
      const temp = rtA;
      rtA = rtB;
      rtB = temp;

      setSamples(currentSample);

      if (currentSample >= preset.samples) {
        if (mountedRef.current) {
          setIsRendering(false);
          setStatus(`✓ Completado — ${currentSample} muestras`);
          camera.clearViewOffset();
        }
        return;
      }

      if (currentSample % 2 === 0 && mountedRef.current) {
        setStatus(`Renderizando... ${currentSample} / ${preset.samples} SPP`);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [project, project.environment, currentTime, quality, fov, showGround, preset, lastCameraState, selectedCameraId, resolution]);

  // ── GENERACIÓN Y EXPORTACIÓN DE VIDEO OFFLINE FRAME-BY-FRAME ──────────────
  const startVideoRendering = useCallback(async () => {
    if (!canvasRef.current || !containerRef.current) return;
    if (isVideoRecording) return;

    setIsVideoRecording(true);
    setRecordedVideoUrl(null);
    setStatus('Iniciando codificador de video...');

    let w = containerRef.current.clientWidth;
    let h = containerRef.current.clientHeight;

    if (resolution === '720p') { w = 1280; h = 720; }
    else if (resolution === '1080p') { w = 1920; h = 1080; }
    else if (resolution === '4k') { w = 3840; h = 2160; }
    else if (resolution === 'square') { w = 1080; h = 1080; }
    else if (resolution === 'vertical') { w = 1080; h = 1920; }

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = project.environment.exposure ?? 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const camera = new THREE.PerspectiveCamera(fov, w / h, 0.01, 1000);
    const scene = new THREE.Scene();
    await setupSceneEnvironment(scene, renderer, project.environment);

    // Luces de Estudio Sincronizadas
    setupProjectLightsInScene(scene, project.lights);

    // Plano de suelo si activado
    if (showGround) {
      let minY = 0;
      project.objects.forEach((obj: any) => {
        if (obj.transform) minY = Math.min(minY, obj.transform.position[1] - 0.5);
      });
      const groundGeo = new THREE.PlaneGeometry(60, 60);
      const groundMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#22242c'), roughness: 0.7 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = minY - 0.01;
      ground.receiveShadow = true;
      scene.add(ground);
    }

    const texLoader = new THREE.TextureLoader();

    const loadMaterial = async (obj: any): Promise<THREE.Material> => {
      const projectMaterials = project.materials || [];
      const refMat = obj.materialId ? projectMaterials.find((m: any) => m.id === obj.materialId) : null;
      const mData: any = refMat
        ? { ...refMat, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
        : (obj.material || {});

      let finalMData = {
        ...mData,
        color: mData.color || obj.color || '#ffffff',
        opacity: mData.opacity ?? obj.opacity ?? 1,
        transparent: (mData.opacity ?? obj.opacity ?? 1) < 1,
      };

      if (obj.uvDebug || mData.uvDebug) {
        finalMData = {
          ...finalMData,
          color: '#ffffff',
          map: getUVDebugTexture(),
          normalMap: undefined,
          roughnessMap: undefined,
          metalnessMap: undefined,
          aoMap: undefined,
          displacementMap: undefined,
          useParallax: false,
          roughness: 0.2,
          metalness: 0.0,
        };
      }

      // 1. Detectar si el objeto o su material es Volumétrico 3D (Nube, Fuego, Humo, Plasma)
      const isVolumetricObj = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || obj.parameters?.isVolumetric || finalMData.isVolumetric || finalMData.volumetric?.enabled;
      if (isVolumetricObj) {
        const volCfg = {
          ...(obj.parameters?.volumetric || {}),
          ...(obj.volumetric || {}),
          ...(finalMData.volumetric || {}),
          color: finalMData.color || obj.color || '#ffffff',
        };
        const volMat = createRaymarchedCloudMaterial(volCfg);
        volMat.transparent = true;
        volMat.depthWrite = false;
        volMat.side = THREE.DoubleSide;
        return volMat;
      }

      // 2. Comprobar si tiene mapeado de relieve Parallax activo
      if (finalMData.useParallax) {
        const parallaxMat = createParallaxMaterial(finalMData);
        await waitForMaterialTextures(parallaxMat);
        parallaxMat.needsUpdate = true;
        return parallaxMat;
      }

      // 3. Crear el material PBR unificado con las mismas reglas que el Viewport
      const mat = createPBRMaterial(finalMData);

      // Aplicar mapeado Triplanar si corresponde
      const nombreMat = (finalMData.name || '').toLowerCase();
      const uvMapping = finalMData.uvwMapping || 'BOX';
      const requiereTriplanar = uvMapping === 'TRIPLANAR' || nombreMat.includes('triplanar') || typeof finalMData.triplanarBlend === 'number';

      if (requiereTriplanar) {
        setupTriplanarMaterial(mat, finalMData);
      }

      // Esperar la carga física completa de las imágenes de las texturas
      await waitForMaterialTextures(mat);

      mat.needsUpdate = true;
      return mat;
    };

    // Cargar objetos y mixers de animación GLTF y simuladores de partículas
    const loadedObjects: { mesh: THREE.Object3D; objData: any; mixer?: THREE.AnimationMixer; particleSim?: ParticleSimulator | null }[] = [];

    for (const obj of project.objects) {
      if (!obj.visible) continue;
      let mesh: THREE.Object3D | null = null;
      let mixer: THREE.AnimationMixer | undefined = undefined;

      if (obj.meshData) {
        try {
          if (obj.meshData.type === 'gltf') {
            const loader = new GLTFLoader();
            const dLoader = new DRACOLoader();
            dLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
            loader.setDRACOLoader(dLoader);
            loader.setMeshoptDecoder(MeshoptDecoder);
            const gltf = await loader.loadAsync(obj.meshData.data);
            mesh = gltf.scene;

            if (gltf.animations && gltf.animations.length > 0) {
              mixer = new THREE.AnimationMixer(mesh);
              gltf.animations.forEach(clip => {
                const action = mixer!.clipAction(clip);
                action.play();
              });
            }

            if (obj.materialId || (obj.material && Object.keys(obj.material).length > 0)) {
              const mat = await loadMaterial(obj);
              mesh.traverse((child: any) => {
                if (child.isMesh) {
                  child.material = mat;
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
            } else {
              mesh.traverse((child: any) => {
                if (child.isMesh) {
                  child.castShadow = true;
                  child.receiveShadow = true;
                }
              });
            }
          } else if (obj.meshData.type === 'obj') {
            const group = await new OBJLoader().loadAsync(obj.meshData.data);
            const mat = await loadMaterial(obj);
            group.traverse((child: any) => { if (child.isMesh) { child.material = mat; child.castShadow = true; child.receiveShadow = true; } });
            mesh = group;
          } else if (obj.meshData.type === 'stl') {
            const geo = await new STLLoader().loadAsync(obj.meshData.data);
            geo.computeVertexNormals();
            const mat = await loadMaterial(obj);
            const m = new THREE.Mesh(geo, mat);
            m.castShadow = true; m.receiveShadow = true;
            mesh = m;
          }
        } catch (e) {
          console.error(`Error al cargar modelo en render de video:`, e);
        }
      }

      const isGpgpu = obj.type === 'GPGPU_SWARM' || obj.isGpgpuSwarm || obj.parameters?.isGpgpuSwarm;
      const isParticle = obj.type === 'PARTICLE_SYSTEM' || obj.isParticleSystem || obj.parameters?.isParticleSystem;
      let particleSim: ParticleSimulator | null = null;

      if (isGpgpu) {
        const swarmCfg = { ...DEFAULT_GPGPU_SWARM_CONFIG, ...(obj.parameters?.gpgpuSwarmConfig || {}), ...(obj.gpgpuSwarmConfig || {}) };
        mesh = createGpgpuSwarmMesh(swarmCfg, obj.id);
      } else if (isParticle) {
        const pCfg = { ...DEFAULT_PARTICLE_CONFIG, ...(obj.parameters?.particleConfig || {}), ...(obj.particleConfig || {}) };
        particleSim = new ParticleSimulator(obj.id, pCfg);
        mesh = particleSim.points;
      } else if (!mesh) {
        try {
          const projectMaterials = project.materials || [];
          const refMat = obj.materialId ? projectMaterials.find((m: any) => m.id === obj.materialId) : null;
          const mData: any = refMat
            ? { ...refMat, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
            : (obj.material || {});

          let geo: THREE.BufferGeometry;
          const isVol = obj.type === 'VOLUME_CLOUD' || obj.isVolumetric || mData.isVolumetric || mData.volumetric?.enabled;
          if (isVol) {
            geo = new THREE.BoxGeometry(1, 1, 1);
          } else {
            geo = createBaseGeometry(obj, mData);
          }
          const mat = await loadMaterial(obj);
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = !isVol;
          m.receiveShadow = !isVol;
          mesh = m;
        } catch (e) {
          console.error(`[Render Video] Error al crear geometría sincronizada para ${obj.name}:`, e);
        }
      }

      if (mesh) {
        scene.add(mesh);
        loadedObjects.push({ mesh, objData: obj, mixer, particleSim });
      }
    }

    // Posición inicial de la cámara
    const camObj = selectedCameraId ? project.cameras?.find(c => c.id === selectedCameraId) : null;
    if (camObj) {
      const evalCam = evaluateCameraTransform(camObj, project.objects, 0, effectiveVideoDuration);
      camera.position.copy(evalCam.position);
      if (evalCam.target) camera.lookAt(evalCam.target);
      camera.fov = evalCam.fov;
    } else if ((lastCameraState as any)?.position) {
      camera.position.fromArray((lastCameraState as any).position);
      camera.lookAt(new THREE.Vector3().fromArray((lastCameraState as any).target ?? [0, 0, 0]));
    } else {
      camera.position.set(0, 2, 6);
      camera.lookAt(0, 0, 0);
    }
    camera.updateProjectionMatrix();

    // Configurar MediaRecorder usando captureStream con el FPS deseado
    const totalDuration = effectiveVideoDuration;
    const fps = videoFps;
    const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));
    const mimeType = supportedCodecs.find(c => c.id === videoCodec && c.supported)?.id || 'video/webm';

    // Primer render previo para inicializar el buffer del canvas
    renderer.render(scene, camera);

    const stream = canvasRef.current.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: videoBitrate * 1000000,
    });

    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    mediaRecorder.start();

    const startTimeMs = Date.now();
    const frameDelayMs = Math.max(16, Math.floor(1000 / fps));

    // Renderizar cuadro a cuadro
    for (let frame = 0; frame < totalFrames; frame++) {
      if (!mountedRef.current) break;

      const frameTime = (frame / fps);

      // 1. Actualizar animaciones GLTF, partículas y transformaciones de objetos
      loadedObjects.forEach(item => {
        if (item.mixer) {
          item.mixer.setTime(frameTime);
        }
        if (item.particleSim) {
          item.particleSim.seekToTime(
            frameTime,
            (t) => {
              const tr = getInterpolatedTransform(item.objData, t);
              return {
                position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
                quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
                scale: new THREE.Vector3(tr.scale[0], tr.scale[1], tr.scale[2])
              };
            },
            (t) => {
              const warps: SpaceWarpObjectData[] = [];
              (project.objects || []).forEach(o => {
                if (o.type === 'SPACE_WARP' || o.isSpaceWarp || o.parameters?.isSpaceWarp) {
                  const wCfg = { ...DEFAULT_SPACE_WARP_CONFIG, ...(o.parameters?.spaceWarpConfig || {}), ...(o.spaceWarpConfig || {}) };
                  const tr = getInterpolatedTransform(o, t);
                  warps.push({
                    id: o.id,
                    type: wCfg.warpType || 'WIND',
                    position: new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
                    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(tr.rotation[0], tr.rotation[1], tr.rotation[2], 'XYZ')),
                    config: wCfg
                  });
                }
              });
              return warps;
            }
          );
        }
        const tr = getInterpolatedTransform(item.objData, frameTime);
        item.mesh.position.fromArray(tr.position);
        item.mesh.rotation.fromArray(tr.rotation);
        item.mesh.scale.fromArray(tr.scale);
        item.mesh.updateMatrixWorld(true);
      });

      // 2. Actualizar Cámara
      if (camObj) {
        const evalCam = evaluateCameraTransform(camObj, project.objects, frameTime, totalDuration);
        camera.position.copy(evalCam.position);
        if (evalCam.target) camera.lookAt(evalCam.target);
        camera.fov = evalCam.fov;
        camera.updateProjectionMatrix();
      }

      // Actualizar uniforms de volumétricos y shaders en la escena cuadro a cuadro
      const mainLight = (scene.getObjectByName('editorDirectionalLight') as THREE.DirectionalLight) || (scene.children.find((c: any) => c.isDirectionalLight) as THREE.DirectionalLight);
      const lightPos = mainLight ? mainLight.position : new THREE.Vector3(4, 5, 4);

      scene.traverse((child: any) => {
        if ((child.isMesh || child.isPoints || child.isLine) && child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat: any) => {
            if (mat && mat.uniforms) {
              if (mat.uniforms.uCameraPos) {
                mat.uniforms.uCameraPos.value.copy(camera.position);
              }
              if (mat.uniforms.uTime) {
                mat.uniforms.uTime.value = frameTime;
              }
              if (mat.uniforms.uLightPosition) {
                mat.uniforms.uLightPosition.value.copy(lightPos);
              }
              if (mat.uniforms.uLightPos) {
                mat.uniforms.uLightPos.value.copy(lightPos);
              }
              if (mat.uniforms.uModelInverse) {
                child.updateMatrixWorld(true);
                mat.uniforms.uModelInverse.value.copy(child.matrixWorld).invert();
              }
            }
          });
        }
      });

      scene.updateMatrixWorld(true);

      // 3. Renderizar cuadro
      renderer.clear();
      renderer.render(scene, camera);

      // Calcular ETA
      const elapsedSec = (Date.now() - startTimeMs) / 1000;
      const avgSecPerFrame = elapsedSec / (frame + 1);
      const remainingSec = Math.round((totalFrames - (frame + 1)) * avgSecPerFrame);

      setVideoProgress({
        currentFrame: frame + 1,
        totalFrames,
        pct: Math.round(((frame + 1) / totalFrames) * 100),
        etaSec: remainingSec,
      });

      setStatus(`Generando video: Cuadro ${frame + 1} / ${totalFrames} (${Math.round(((frame + 1) / totalFrames) * 100)}%)`);

      // Breve retardo por cuadro para que MediaRecorder registre el fotograma del stream
      await new Promise(r => setTimeout(r, frameDelayMs));
    }

    // Detener MediaRecorder y generar URL de video
    await new Promise(r => setTimeout(r, 200));
    mediaRecorder.stop();
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);
      setIsVideoRecording(false);
      setStatus('✓ Video renderizado y listo para descargar!');
    };
  }, [
    project, currentTime, resolution, fov, selectedCameraId, lastCameraState, showGround,
    effectiveVideoDuration, videoFps, videoBitrate, videoCodec, supportedCodecs, isVideoRecording
  ]);

  useEffect(() => {
    mountedRef.current = true;
    startRender();
    return () => {
      mountedRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  const handleDownloadPhoto = () => {
    if (!canvasRef.current || samples < 1) return;
    const link = document.createElement('a');
    link.download = `render_${project.name}_${samples}spp.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const pctDone = Math.min(100, (samples / preset.samples) * 100);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* ── Header ── */}
        <div className="px-6 py-4 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-violet-600/20 text-violet-400 rounded-xl border border-violet-500/30">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Estudio de Renderizado Profesional
              </h2>
              <p className="text-[11px] text-zinc-400 font-mono">
                {status}
              </p>
            </div>

            {/* Selector de Modo: Foto vs Video */}
            <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800 ml-4">
              <button
                onClick={() => setRenderType('PHOTO')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  renderType === 'PHOTO'
                    ? 'bg-violet-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Camera size={14} />
                Foto Fija (PNG)
              </button>
              <button
                onClick={() => setRenderType('VIDEO')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  renderType === 'VIDEO'
                    ? 'bg-violet-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Film size={14} />
                Video Animado
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(v => !v)}
              className={`p-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                showSettings
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}>
              <Settings size={15} />
              Configurar
            </button>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition-all">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="flex-1 flex min-h-0 relative">
          {/* Panel Lateral de Ajustes */}
          {showSettings && (
            <div className="w-80 bg-zinc-900 border-r border-zinc-800 p-5 flex flex-col gap-5 overflow-y-auto z-10 flex-shrink-0">
              
              {/* ── SECCIÓN ESPECÍFICA DE VIDEO ── */}
              {renderType === 'VIDEO' && (
                <div className="p-4 bg-violet-950/40 rounded-2xl border border-violet-500/30 space-y-4 animate-in fade-in">
                  <div className="flex items-center gap-2 text-violet-300">
                    <Film size={16} />
                    <h4 className="text-xs font-bold uppercase tracking-wider">Ajustes de Video Animado</h4>
                  </div>

                  {/* Origen de Duración */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                      Duración del Video
                    </label>
                    <select
                      value={durationSource}
                      onChange={e => setDurationSource(e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                    >
                      {detectedAnimationInfo.maxDur > 0 && (
                        <option value="ANIMATED_OBJECT">
                          🎬 Objeto Animado ({detectedAnimationInfo.maxDur.toFixed(2)}s)
                        </option>
                      )}
                      <option value="TIMELINE">
                        ⏱️ Línea de Tiempo del Proyecto ({(project.duration || 5).toFixed(2)}s)
                      </option>
                      <option value="CUSTOM">
                        ⚙️ Duración Personalizada
                      </option>
                    </select>

                    {detectedAnimationInfo.maxDur > 0 && durationSource === 'ANIMATED_OBJECT' && (
                      <p className="text-[10px] text-violet-300/80 font-mono flex items-center gap-1 pt-1">
                        <CheckCircle size={11} />
                        Detectado: {detectedAnimationInfo.sourceName}
                      </p>
                    )}

                    {durationSource === 'CUSTOM' && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="range" min="1" max="60" step="0.5"
                          value={customDuration}
                          onChange={e => setCustomDuration(parseFloat(e.target.value))}
                          className="flex-1 accent-violet-500 bg-zinc-950 rounded-lg h-1.5"
                        />
                        <span className="text-xs font-mono text-white w-12 text-right">{customDuration.toFixed(1)}s</span>
                      </div>
                    )}
                  </div>

                  {/* FPS */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                      Cuadros por Segundo (FPS)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[24, 30, 60].map(f => (
                        <button
                          key={f}
                          onClick={() => setVideoFps(f as any)}
                          className={`py-1.5 rounded-lg border text-xs font-bold transition-all ${
                            videoFps === f
                              ? 'bg-violet-600 border-violet-400 text-white'
                              : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {f} FPS
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tasa de Bits / Compresión */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                      Calidad de Compresión (Bitrate)
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { mbps: 16, label: 'Master (16 Mbps)' },
                        { mbps: 8,  label: 'Pro HD (8 Mbps)' },
                        { mbps: 4,  label: 'Estándar (4 Mbps)' },
                        { mbps: 2,  label: 'Web (2 Mbps)' },
                      ].map(b => (
                        <button
                          key={b.mbps}
                          onClick={() => setVideoBitrate(b.mbps)}
                          className={`p-1.5 rounded-lg border text-[10px] font-bold transition-all ${
                            videoBitrate === b.mbps
                              ? 'bg-violet-600 border-violet-400 text-white'
                              : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Formato y Códec */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block">
                      Códec de Salida
                    </label>
                    <select
                      value={videoCodec}
                      onChange={e => setVideoCodec(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                    >
                      {supportedCodecs.map(c => (
                        <option key={c.id} value={c.id} disabled={!c.supported}>
                          {c.label} {!c.supported ? '(No soportado)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Calidad de Render (para foto) */}
              {renderType === 'PHOTO' && (
                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                    Calidad de Muestreo (SSAA)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(QUALITY_PRESETS) as QualityKey[]).map(key => {
                      const q = QUALITY_PRESETS[key];
                      const active = quality === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setQuality(key)}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            active
                              ? 'bg-violet-600/20 border-violet-500 text-white'
                              : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800'
                          }`}>
                          <div className="text-xs font-bold">{q.label}</div>
                          <div className="text-[10px] text-zinc-400 font-mono mt-0.5">{q.samples} SPP · {q.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Resolución */}
              <div>
                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                  Resolución de Salida
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'viewport', label: 'Viewport' },
                    { id: '720p',     label: '720p HD' },
                    { id: '1080p',    label: '1080p Full HD' },
                    { id: '4k',       label: '4K Ultra HD' },
                    { id: 'square',   label: 'Cuadrado (1:1)' },
                    { id: 'vertical', label: 'Vertical (9:16)' },
                  ].map(r => (
                    <button
                      key={r.id}
                      onClick={() => setResolution(r.id as any)}
                      className={`p-2 rounded-xl border text-xs font-medium transition-all ${
                        resolution === r.id
                          ? 'bg-violet-600/20 border-violet-500 text-white'
                          : 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800'
                      }`}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cámaras */}
              <div>
                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Camera size={13} />
                  Cámara de Render
                </label>
                <select
                  value={selectedCameraId || ''}
                  onChange={e => setSelectedCameraId(e.target.value || null)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500">
                  <option value="">Vista de Edición Actual</option>
                  {(project.cameras || []).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.targetObjectId ? '🎯(Sigue Objetivo)' : ''} {c.pathObjectId ? '🛣️(En Ruta)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* FOV */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Campo de Visión (FOV)
                  </label>
                  <span className="text-xs font-mono text-zinc-300">{fov}°</span>
                </div>
                <input
                  type="range" min="15" max="120" value={fov}
                  onChange={e => setFov(Number(e.target.value))}
                  className="w-full accent-violet-500 bg-zinc-800 rounded-lg h-1.5 cursor-pointer"
                />
              </div>

              {/* Opción de Plano de Suelo */}
              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showGround}
                    onChange={e => setShowGround(e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-700 text-violet-600 focus:ring-0"
                  />
                  Añadir plano de suelo con sombras
                </label>
              </div>

              {/* Botón Aplicar / Reiniciar */}
              {renderType === 'PHOTO' && (
                <button
                  onClick={startRender}
                  className="mt-auto py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-violet-900/30 flex items-center justify-center gap-2">
                  <RefreshCw size={14} />
                  Reiniciar Preview Foto
                </button>
              )}
            </div>
          )}

          {/* Canvas de Render */}
          <div ref={containerRef} className="flex-1 h-full bg-black flex items-center justify-center relative overflow-hidden">
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain shadow-2xl" />

            {/* Error Overlay */}
            {error && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center z-20">
                <p className="text-red-400 font-semibold mb-2 text-sm">{error}</p>
                <button onClick={() => { setError(''); setShowSettings(true); }}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-[11px] font-bold">
                  Ver configuración
                </button>
              </div>
            )}

            {/* Progreso de Grabación de Video Overlay */}
            {isVideoRecording && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 z-30">
                <div className="p-4 bg-violet-600/20 border border-violet-500/40 rounded-full animate-bounce mb-4 text-violet-400">
                  <Film size={32} />
                </div>
                <h3 className="text-base font-bold text-white mb-1">
                  Renderizando Video Cuadro a Cuadro...
                </h3>
                <p className="text-xs text-zinc-400 font-mono mb-4">
                  Cuadro {videoProgress.currentFrame} / {videoProgress.totalFrames} ({videoProgress.pct}%)
                  {videoProgress.etaSec > 0 ? ` · Tiempo estimado: ${videoProgress.etaSec}s` : ''}
                </p>

                <div className="w-80 h-2 bg-zinc-800 rounded-full overflow-hidden mb-6">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-indigo-400 transition-all duration-200"
                    style={{ width: `${videoProgress.pct}%` }}
                  />
                </div>

                <div className="text-[11px] text-zinc-500 max-w-sm text-center">
                  Capturando movimiento continuo sin pérdida de cuadros, aplicando sombras suaves y desplazamiento de cámara.
                </div>
              </div>
            )}

            {/* Vista previa de video completado */}
            {recordedVideoUrl && !isVideoRecording && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 z-30">
                <div className="max-w-xl w-full bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
                  <div className="px-4 py-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <CheckCircle size={15} className="text-emerald-400" />
                      Vista Previa de Video Renderizado
                    </span>
                    <button
                      onClick={() => setRecordedVideoUrl(null)}
                      className="text-zinc-400 hover:text-white p-1"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <video src={recordedVideoUrl} controls autoPlay loop className="w-full h-64 object-contain bg-black" />
                  <div className="p-4 bg-zinc-950/80 flex items-center justify-between">
                    <div className="text-[11px] text-zinc-400 font-mono">
                      Duración: {effectiveVideoDuration.toFixed(1)}s · {videoFps} FPS · {videoBitrate} Mbps
                    </div>
                    <a
                      href={recordedVideoUrl}
                      download={`render_video_${project.name}.webm`}
                      className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-violet-900/30 flex items-center gap-2"
                    >
                      <Download size={14} />
                      Guardar Video (.webm)
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Barra de progreso de Foto */}
            {ready && renderType === 'PHOTO' && (
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent z-20">
                <div className="flex items-center justify-between text-[10px] font-bold text-white/80 mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${isRendering ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                    <span className="font-mono">{samples} / {preset.samples} SPP</span>
                  </div>
                  <span className="font-mono">{pctDone.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pctDone}%`,
                      background: 'linear-gradient(90deg, #7c3aed, #db2777)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3 bg-zinc-900/50 border-t border-zinc-800 flex items-center justify-between flex-shrink-0">
          <span className="text-[10px] text-zinc-500">
            {renderType === 'PHOTO'
              ? 'Renderizado Fotorrealista PBR — Super-Sampling Anti-Aliasing e Iluminación IBL'
              : `Generador de Video Pro — ${effectiveVideoDuration.toFixed(1)}s de animación a ${videoFps} FPS (${videoBitrate} Mbps)`}
          </span>

          {renderType === 'PHOTO' ? (
            <button
              onClick={handleDownloadPhoto}
              disabled={samples < 1}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-[11px] font-bold transition-all active:scale-[0.98] shadow-lg shadow-violet-900/30">
              <Download size={14} />
              Guardar PNG
            </button>
          ) : (
            <button
              onClick={startVideoRendering}
              disabled={isVideoRecording}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-lg shadow-violet-900/40">
              <Video size={15} />
              {isVideoRecording ? 'Renderizando Video...' : '🎥 Iniciar Renderizado de Video'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
