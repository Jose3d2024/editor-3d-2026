import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '../store/useStore';
import { createPBRMaterial } from '../utils/materialUtils';
import { MaterialPanel } from './MaterialPanel';
import { createPolarEquirectangularCanvas, createStudioEquirectangularCanvas } from '../utils/environmentHelper';
import {
  ArrowLeft, Palette, Sparkles, RotateCw, Sun, Box, Eye, EyeOff,
  Maximize2, Camera, Download, Layers, ShieldCheck, Check,
  SlidersHorizontal, RefreshCw, ZoomIn, ZoomOut, Image as ImageIcon,
  Zap, Cloud, Wind, HelpCircle, Globe
} from 'lucide-react';
import type { MaterialData } from '../types';

type PreviewMeshType = 'SPHERE' | 'SHADER_BALL' | 'CUBE' | 'ROCK' | 'GEM' | 'CYLINDER' | 'TORUS' | 'CLOTH' | 'VOLUME';

interface EnvironmentPreset {
  id: string;
  name: string;
  icon: string;
  bgColor: string;
  ambientColor: number;
  ambientIntensity: number;
  keyColor: number;
  keyIntensity: number;
  keyPos: [number, number, number];
  fillColor: number;
  fillIntensity: number;
  fillPos: [number, number, number];
  rimColor: number;
  rimIntensity: number;
  rimPos: [number, number, number];
  groundColor: string;
}

function createEquirectangularTextureForPreset(presetId: string): THREE.CanvasTexture {
  if (presetId === 'polar_arctic') {
    return createPolarEquirectangularCanvas('arctic');
  } else if (presetId === 'polar_aurora') {
    return createPolarEquirectangularCanvas('aurora');
  } else if (presetId === 'polar_sunset') {
    return createPolarEquirectangularCanvas('sunset');
  } else if (presetId === 'polar_ice_cave') {
    return createPolarEquirectangularCanvas('ice_cave');
  } else if (presetId === 'polar_fjord') {
    return createPolarEquirectangularCanvas('fjord');
  } else if (presetId === 'polar_blizzard') {
    return createPolarEquirectangularCanvas('blizzard');
  } else if (presetId === 'studio_neutral') {
    return createStudioEquirectangularCanvas('softbox');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  if (presetId === 'warm_sunset') {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#1c172e');
    sky.addColorStop(0.35, '#5c2a47');
    sky.addColorStop(0.5, '#c95932');
    sky.addColorStop(0.65, '#f7b05b');
    sky.addColorStop(0.85, '#2e1814');
    sky.addColorStop(1, '#0e0807');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    const sunGrad = ctx.createRadialGradient(512, 280, 5, 512, 280, 180);
    sunGrad.addColorStop(0, 'rgba(255, 255, 240, 1)');
    sunGrad.addColorStop(0.2, 'rgba(255, 200, 100, 0.9)');
    sunGrad.addColorStop(0.6, 'rgba(255, 120, 50, 0.4)');
    sunGrad.addColorStop(1, 'rgba(255, 80, 20, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, 1024, 512);
  } else if (presetId === 'natural_forest') {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#1a3b5c');
    sky.addColorStop(0.35, '#689bb5');
    sky.addColorStop(0.5, '#e0edbb');
    sky.addColorStop(0.65, '#2d4d29');
    sky.addColorStop(1, '#0f1f12');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    const sunGrad = ctx.createRadialGradient(320, 200, 10, 320, 200, 160);
    sunGrad.addColorStop(0, 'rgba(255, 255, 230, 0.95)');
    sunGrad.addColorStop(0.4, 'rgba(230, 245, 190, 0.5)');
    sunGrad.addColorStop(1, 'rgba(150, 200, 130, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, 1024, 512);
  } else if (presetId === 'cyberpunk_neon') {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#060714');
    sky.addColorStop(0.4, '#12142d');
    sky.addColorStop(0.6, '#280c35');
    sky.addColorStop(1, '#080918');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    const cyanGrad = ctx.createRadialGradient(250, 260, 5, 250, 260, 150);
    cyanGrad.addColorStop(0, 'rgba(0, 240, 255, 1)');
    cyanGrad.addColorStop(0.4, 'rgba(0, 180, 255, 0.6)');
    cyanGrad.addColorStop(1, 'rgba(0, 80, 255, 0)');
    ctx.fillStyle = cyanGrad;
    ctx.fillRect(0, 0, 1024, 512);

    const magGrad = ctx.createRadialGradient(760, 240, 5, 760, 240, 170);
    magGrad.addColorStop(0, 'rgba(255, 0, 140, 1)');
    magGrad.addColorStop(0.4, 'rgba(200, 0, 220, 0.6)');
    magGrad.addColorStop(1, 'rgba(120, 0, 180, 0)');
    ctx.fillStyle = magGrad;
    ctx.fillRect(0, 0, 1024, 512);
  } else if (presetId === 'clean_white') {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#f0f2f5');
    sky.addColorStop(0.5, '#e4e7ec');
    sky.addColorStop(1, '#cbd0d8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);

    const softGrad = ctx.createRadialGradient(512, 200, 10, 512, 200, 300);
    softGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    softGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = softGrad;
    ctx.fillRect(0, 0, 1024, 512);
  } else {
    return createStudioEquirectangularCanvas('softbox');
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: 'polar_arctic',
    name: 'Ártico Glacial (Polo)',
    icon: '🧊',
    bgColor: '#0d1824',
    ambientColor: 0xcde8ff,
    ambientIntensity: 0.9,
    keyColor: 0xffffff,
    keyIntensity: 2.8,
    keyPos: [3.5, 5.5, 4],
    fillColor: 0x38bdf8,
    fillIntensity: 1.1,
    fillPos: [-4, 2, -2],
    rimColor: 0xe0f2fe,
    rimIntensity: 1.8,
    rimPos: [0, 4, -4],
    groundColor: '#122538',
  },
  {
    id: 'polar_aurora',
    name: 'Noche Aurora Boreal',
    icon: '🌌',
    bgColor: '#040b14',
    ambientColor: 0x22c55e,
    ambientIntensity: 0.75,
    keyColor: 0x4ade80,
    keyIntensity: 2.4,
    keyPos: [0, 6, 2],
    fillColor: 0x06b6d4,
    fillIntensity: 1.5,
    fillPos: [-4, 3, -2],
    rimColor: 0xc084fc,
    rimIntensity: 1.9,
    rimPos: [3, 4, -3],
    groundColor: '#071622',
  },
  {
    id: 'polar_sunset',
    name: 'Ocaso Polar',
    icon: '❄️',
    bgColor: '#1a101b',
    ambientColor: 0xff8c42,
    ambientIntensity: 0.8,
    keyColor: 0xff7034,
    keyIntensity: 2.9,
    keyPos: [4.5, 2.5, 3.5],
    fillColor: 0x381c3e,
    fillIntensity: 1.0,
    fillPos: [-4, 2, -2],
    rimColor: 0xffd180,
    rimIntensity: 1.7,
    rimPos: [-2, 3, -4],
    groundColor: '#241022',
  },
  {
    id: 'polar_ice_cave',
    name: 'Cueva de Hielo',
    icon: '🏔️',
    bgColor: '#02182b',
    ambientColor: 0x0873a4,
    ambientIntensity: 0.85,
    keyColor: 0xbae6fd,
    keyIntensity: 2.6,
    keyPos: [0, 6, 0],
    fillColor: 0x0284c7,
    fillIntensity: 1.3,
    fillPos: [-3, 2, -3],
    rimColor: 0x7dd3fc,
    rimIntensity: 1.8,
    rimPos: [3, 1, 3],
    groundColor: '#011220',
  },
  {
    id: 'polar_fjord',
    name: 'Fiordo Glaciar',
    icon: '🌊',
    bgColor: '#0c2747',
    ambientColor: 0x93c5fd,
    ambientIntensity: 0.85,
    keyColor: 0xffffff,
    keyIntensity: 2.7,
    keyPos: [4, 6, 3],
    fillColor: 0x0284c7,
    fillIntensity: 1.1,
    fillPos: [-4, 2, -2],
    rimColor: 0xe0f2fe,
    rimIntensity: 1.6,
    rimPos: [0, 4, -4],
    groundColor: '#061726',
  },
  {
    id: 'polar_blizzard',
    name: 'Ventisca Polar',
    icon: '🌨️',
    bgColor: '#64748b',
    ambientColor: 0xcbd5e1,
    ambientIntensity: 1.1,
    keyColor: 0xffffff,
    keyIntensity: 2.0,
    keyPos: [0, 5, 2],
    fillColor: 0x94a3b8,
    fillIntensity: 0.9,
    fillPos: [-3, 2, -3],
    rimColor: 0xffffff,
    rimIntensity: 1.4,
    rimPos: [0, 3, -3],
    groundColor: '#475569',
  },
  {
    id: 'studio_neutral',
    name: 'Estudio Neutral (5500K)',
    icon: '💡',
    bgColor: '#121216',
    ambientColor: 0xffffff,
    ambientIntensity: 0.7,
    keyColor: 0xfffaf0,
    keyIntensity: 2.2,
    keyPos: [4, 5, 4],
    fillColor: 0xd8e4fc,
    fillIntensity: 0.8,
    fillPos: [-4, 2, -2],
    rimColor: 0xffffff,
    rimIntensity: 1.2,
    rimPos: [0, 4, -4],
    groundColor: '#18181f',
  },
  {
    id: 'warm_sunset',
    name: 'Atardecer Cálido',
    icon: '🌅',
    bgColor: '#1a1315',
    ambientColor: 0xff9966,
    ambientIntensity: 0.6,
    keyColor: 0xffaa55,
    keyIntensity: 2.8,
    keyPos: [5, 3, 3],
    fillColor: 0x6677aa,
    fillIntensity: 0.7,
    fillPos: [-4, 2, -3],
    rimColor: 0xffddaa,
    rimIntensity: 1.6,
    rimPos: [-2, 3, -4],
    groundColor: '#20181b',
  },
  {
    id: 'natural_forest',
    name: 'Exterior / Naturaleza',
    icon: '🌲',
    bgColor: '#111814',
    ambientColor: 0x88bb99,
    ambientIntensity: 0.65,
    keyColor: 0xfffbe8,
    keyIntensity: 2.5,
    keyPos: [3, 6, 3],
    fillColor: 0x446655,
    fillIntensity: 0.75,
    fillPos: [-4, 2, -2],
    rimColor: 0xccddbb,
    rimIntensity: 1.5,
    rimPos: [-2, 4, -4],
    groundColor: '#1a241e',
  },
  {
    id: 'cyberpunk_neon',
    name: 'Cyberpunk Neón',
    icon: '⚡',
    bgColor: '#060714',
    ambientColor: 0x1e1035,
    ambientIntensity: 0.5,
    keyColor: 0x00f0ff,
    keyIntensity: 2.6,
    keyPos: [4, 4, 3],
    fillColor: 0xff0088,
    fillIntensity: 2.2,
    fillPos: [-4, 3, -2],
    rimColor: 0xaa00ff,
    rimIntensity: 2.0,
    rimPos: [0, 4, -4],
    groundColor: '#0a0a18',
  },
  {
    id: 'clean_white',
    name: 'Estudio Blanco Minimal',
    icon: '⚪',
    bgColor: '#f4f4f6',
    ambientColor: 0xffffff,
    ambientIntensity: 0.95,
    keyColor: 0xffffff,
    keyIntensity: 1.8,
    keyPos: [3, 5, 3],
    fillColor: 0xe8ecf2,
    fillIntensity: 0.9,
    fillPos: [-3, 2, -2],
    rimColor: 0xffffff,
    rimIntensity: 1.1,
    rimPos: [0, 4, -4],
    groundColor: '#e0e4eb',
  },
];

export const MaterialStudioViewport: React.FC = () => {
  const {
    project,
    materialStudioMaterialId,
    closeMaterialStudio,
    setMaterialStudioMaterialId,
    updateMaterial,
    addMaterial,
    selectedObjectId,
    selectedObjectIds,
    assignMaterialToObjects,
  } = useStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Studio configuration states
  const [selectedMeshType, setSelectedMeshType] = useState<PreviewMeshType>('SPHERE');
  const [envPresetId, setEnvPresetId] = useState<string>('studio_neutral');
  const [isTurntableActive, setIsTurntableActive] = useState<boolean>(true);
  const [turntableSpeed, setTurntableSpeed] = useState<number>(0.6);
  const [lightRotation, setLightRotation] = useState<number>(45); // degrees
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  const animState = useRef({ turntable: isTurntableActive, speed: turntableSpeed });
  useEffect(() => {
    animState.current = { turntable: isTurntableActive, speed: turntableSpeed };
  }, [isTurntableActive, turntableSpeed]);

  // Active Material reference
  const activeMaterial = useMemo(() => {
    if (materialStudioMaterialId) {
      const found = project.materials.find((m) => m.id === materialStudioMaterialId);
      if (found) return found;
    }
    const selObj = project.objects.find((o) => o.id === selectedObjectId);
    if (selObj?.materialId) {
      const found = project.materials.find((m) => m.id === selObj.materialId);
      if (found) return found;
    }
    return project.materials[0] || null;
  }, [project.materials, materialStudioMaterialId, selectedObjectId, project.objects]);

  // Sync active material ID if missing
  useEffect(() => {
    if (!materialStudioMaterialId && project.materials.length > 0) {
      const selObj = project.objects.find((o) => o.id === selectedObjectId);
      if (selObj?.materialId && project.materials.some(m => m.id === selObj.materialId)) {
        setMaterialStudioMaterialId(selObj.materialId);
      } else {
        setMaterialStudioMaterialId(project.materials[0].id);
      }
    }
  }, [materialStudioMaterialId, project.materials, selectedObjectId, project.objects, setMaterialStudioMaterialId]);

  // Three.js References
  const threeRefs = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    previewGroup: THREE.Group;
    lightsGroup: THREE.Group;
    groundMesh?: THREE.Mesh | null;
    gridHelper?: THREE.GridHelper | null;
    currentMesh: THREE.Object3D | null;
    currentMaterial: THREE.Material | null;
    ambientLight: THREE.AmbientLight;
    keyLight: THREE.DirectionalLight;
    fillLight: THREE.DirectionalLight;
    rimLight: THREE.DirectionalLight;
    clock: THREE.Clock;
    reqId: number | null;
  } | null>(null);

  // Generate Sample Geometries
  const createPreviewObject = useCallback((type: PreviewMeshType, material: THREE.Material): THREE.Object3D => {
    const group = new THREE.Group();

    if (type === 'SPHERE') {
      // High-poly UV Sphere with smooth normals & tangents for normal mapping
      const geom = new THREE.SphereGeometry(1.2, 128, 64);
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'SHADER_BALL') {
      // Complete multi-part Shader Ball inspection model
      // 1. Central Core Sphere
      const coreGeom = new THREE.SphereGeometry(0.85, 64, 32);
      coreGeom.computeTangents();
      const coreMesh = new THREE.Mesh(coreGeom, material);
      coreMesh.castShadow = true;
      coreMesh.receiveShadow = true;
      group.add(coreMesh);

      // 2. Outer Ring / Collar
      const ringGeom = new THREE.TorusGeometry(1.2, 0.18, 32, 100);
      ringGeom.computeTangents();
      const ringMesh = new THREE.Mesh(ringGeom, material);
      ringMesh.rotation.x = Math.PI / 4;
      ringMesh.castShadow = true;
      ringMesh.receiveShadow = true;
      group.add(ringMesh);

      // 3. Base Stand Pedestal
      const baseGeom = new THREE.CylinderGeometry(1.0, 1.25, 0.35, 64);
      baseGeom.computeTangents();
      const baseMesh = new THREE.Mesh(baseGeom, material);
      baseMesh.position.y = -1.1;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      group.add(baseMesh);

      // 4. Inner Stepped Ring
      const stepGeom = new THREE.CylinderGeometry(0.65, 0.85, 0.2, 48);
      const stepMesh = new THREE.Mesh(stepGeom, material);
      stepMesh.position.y = -0.85;
      group.add(stepMesh);
    } else if (type === 'CUBE') {
      // Sculpted Organic Block (non-planar natural chamfers and subtle eroded undulations)
      const geom = new THREE.BoxGeometry(1.7, 1.7, 1.7, 48, 48, 48);
      const pos = geom.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const len = v.length();
        const norm = v.clone().normalize();
        // Subtle spherical rounding towards corners
        v.lerp(norm.clone().multiplyScalar(1.2), 0.12);
        // Organic non-planar face undulation
        const undulation = Math.sin(v.x * 3.5 + v.y * 2.8) * Math.cos(v.z * 3.5) * 0.022;
        v.addScaledVector(norm, undulation);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geom.computeVertexNormals();
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'ROCK') {
      // Natural Organic Boulder / Iceberg Formation
      const geom = new THREE.IcosahedronGeometry(1.2, 32);
      const pos = geom.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const nx = v.x, ny = v.y, nz = v.z;
        // Multi-frequency organic carving: macro rock mass + asymmetric facets + micro ridges
        const macro = Math.sin(nx * 2.2 + ny * 1.8) * Math.cos(nz * 2.0 + nx * 1.6) * 0.22;
        const facets = Math.abs(Math.sin(nx * 3.8) * Math.cos(ny * 3.8) * Math.sin(nz * 3.8)) * 0.14;
        const micro = Math.sin(nx * 8.5 + nz * 8.0) * 0.035;
        const displacement = 1.0 + macro + facets + micro;
        v.multiplyScalar(displacement);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geom.computeVertexNormals();
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'GEM') {
      // Natural Crystal / Mineral Cluster with organic cleavage facets
      const geom = new THREE.IcosahedronGeometry(1.2, 5);
      const pos = geom.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        // Vertical crystal elongation
        v.y *= 1.4;
        // Organic asymmetric crystal growth facets
        const planeCut = Math.sin(v.x * 2.8 + v.z * 2.2) * 0.10;
        v.addScaledVector(v.clone().normalize(), planeCut);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geom.computeVertexNormals();
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'CYLINDER') {
      const geom = new THREE.CylinderGeometry(1.0, 1.0, 2.0, 64, 32);
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'TORUS') {
      const geom = new THREE.TorusGeometry(1.05, 0.45, 48, 128);
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'CLOTH') {
      // Curved draped cloth / mantle with rich organic folds
      const geom = new THREE.PlaneGeometry(2.4, 2.4, 64, 64);
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = Math.sin(x * 2.5) * 0.35 + Math.cos(y * 2.0) * 0.25 + Math.sin((x + y) * 3.0) * 0.15;
        pos.setZ(i, z);
      }
      geom.computeVertexNormals();
      geom.computeTangents();
      const mesh = new THREE.Mesh(geom, material);
      mesh.rotation.x = -Math.PI / 6;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (type === 'VOLUME') {
      // Volume Cloud container cube
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geom, material);
      mesh.scale.set(2.2, 2.2, 2.2);
      group.add(mesh);
    }

    return group;
  }, []);

  // Initialize Three.js Scene
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.6, 4.2);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Controls
    const controls = new OrbitControls(camera, canvasRef.current);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.5;
    controls.maxDistance = 12.0;
    controls.target.set(0, 0, 0);

    // Groups
    const previewGroup = new THREE.Group();
    scene.add(previewGroup);

    const lightsGroup = new THREE.Group();
    scene.add(lightsGroup);

    // Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaf0, 2.2);
    keyLight.position.set(4, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.radius = 2.5;
    lightsGroup.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xd8e4fc, 0.8);
    fillLight.position.set(-4, 2, -2);
    lightsGroup.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 1.2);
    rimLight.position.set(0, 4, -4);
    lightsGroup.add(rimLight);

    // Environment map generator (creates natural reflective environment for PBR)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envTexture = createEquirectangularTextureForPreset(envPresetId);
    scene.environment = envTexture;
    scene.background = envTexture; // Full HDRI 360 background

    const clock = new THREE.Clock();

    threeRefs.current = {
      scene,
      camera,
      renderer,
      controls,
      previewGroup,
      lightsGroup,
      currentMesh: null,
      currentMaterial: null,
      ambientLight,
      keyLight,
      fillLight,
      rimLight,
      clock,
      reqId: null,
    };

    // Render loop
    const animate = () => {
      const refs = threeRefs.current;
      if (!refs) return;

      const delta = refs.clock.getDelta();
      const elapsedTime = refs.clock.getElapsedTime();

      // Turntable rotation
      if (animState.current.turntable && refs.previewGroup) {
        refs.previewGroup.rotation.y += delta * animState.current.speed;
      }

      // Shader & dynamic uniforms updates (CSM, Volumetric, WebGPU Glass)
      if (refs.currentMaterial) {
        const sm = refs.currentMaterial as any;
        if (sm.uniforms?.uTime) sm.uniforms.uTime.value = elapsedTime;
        if (sm.userData?.shader?.uniforms) {
          const sh = sm.userData.shader.uniforms;
          if (sh.uTime) sh.uTime.value = elapsedTime;
          if (sh.uGlassTime) sh.uGlassTime.value = elapsedTime;
        }
        if (sm.uniforms?.uLightPosition && refs.keyLight) {
          sm.uniforms.uLightPosition.value.copy(refs.keyLight.position);
        }
        if (sm.uniforms?.uModelInverse && refs.previewGroup) {
          let mesh: THREE.Mesh | null = null;
          refs.previewGroup.traverse((child) => {
            if ((child as any).isMesh) mesh = child as THREE.Mesh;
          });
          if (mesh) {
            (mesh as THREE.Mesh).updateMatrixWorld();
            sm.uniforms.uModelInverse.value.copy((mesh as THREE.Mesh).matrixWorld).invert();
          }
        }
      }

      refs.controls.update();
      refs.renderer.render(refs.scene, refs.camera);
      refs.reqId = requestAnimationFrame(animate);
    };

    animate();

    // Resize observer
    const handleResize = () => {
      if (!containerRef.current || !threeRefs.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      threeRefs.current.camera.aspect = w / h;
      threeRefs.current.camera.updateProjectionMatrix();
      threeRefs.current.renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (threeRefs.current?.reqId) {
        cancelAnimationFrame(threeRefs.current.reqId);
      }
      pmremGenerator.dispose();
      renderer.dispose();
    };
  }, []);

  // Update Environment Lighting when preset or light rotation changes
  useEffect(() => {
    const refs = threeRefs.current;
    if (!refs) return;

    const preset = ENVIRONMENT_PRESETS.find((p) => p.id === envPresetId) || ENVIRONMENT_PRESETS[0];

    refs.ambientLight.color.set(preset.ambientColor);
    refs.ambientLight.intensity = preset.ambientIntensity;

    // Apply lighting rotation
    const rad = (lightRotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const [kx, ky, kz] = preset.keyPos;
    refs.keyLight.position.set(kx * cos - kz * sin, ky, kx * sin + kz * cos);
    refs.keyLight.color.set(preset.keyColor);
    refs.keyLight.intensity = preset.keyIntensity;

    const [fx, fy, fz] = preset.fillPos;
    refs.fillLight.position.set(fx * cos - fz * sin, fy, fx * sin + fz * cos);
    refs.fillLight.color.set(preset.fillColor);
    refs.fillLight.intensity = preset.fillIntensity;

    const [rx, ry, rz] = preset.rimPos;
    refs.rimLight.position.set(rx * cos - rz * sin, ry, rx * sin + rz * cos);
    refs.rimLight.color.set(preset.rimColor);
    refs.rimLight.intensity = preset.rimIntensity;

    // Generate dynamic equirectangular texture for preset
    const envTexture = createEquirectangularTextureForPreset(envPresetId);
    refs.scene.environment = envTexture;
    refs.scene.background = envTexture; // Set HDRI environment as the 100% full background
  }, [envPresetId, lightRotation]);

  // Update Wireframe visibility
  useEffect(() => {
    const refs = threeRefs.current;
    if (!refs) return;
    if (refs.currentMaterial && 'wireframe' in refs.currentMaterial) {
      (refs.currentMaterial as any).wireframe = showWireframe;
    }
  }, [showWireframe]);

  // Update Mesh & Material when activeMaterial or selectedMeshType changes
  useEffect(() => {
    const refs = threeRefs.current;
    if (!refs) return;

    // Build fresh Three.js material from activeMaterial data
    let materialData = activeMaterial;
    if (!materialData) {
      materialData = {
        id: 'default_preview',
        name: 'Material Calibración PBR',
        color: '#e0e0e0',
        roughness: 0.35,
        metalness: 0.1,
        emissive: '#000000',
        emissiveIntensity: 1,
        opacity: 1,
        transparent: false,
      };
    }

    const mat = createPBRMaterial(materialData);
    if ('wireframe' in mat) {
      (mat as any).wireframe = showWireframe;
    }
    refs.currentMaterial = mat;

    // Remove previous mesh
    if (refs.currentMesh) {
      refs.previewGroup.remove(refs.currentMesh);
      refs.currentMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
        }
      });
    }

    // If volumetric material, auto select VOLUME preview if requested
    let meshType = selectedMeshType;
    if (materialData.isVolumetric || materialData.volumetric?.enabled) {
      if (meshType !== 'VOLUME' && meshType === 'SPHERE') {
        meshType = 'VOLUME';
      }
    }

    const newObj = createPreviewObject(meshType, mat);
    refs.currentMesh = newObj;
    refs.previewGroup.add(newObj);
  }, [activeMaterial, selectedMeshType, createPreviewObject, showWireframe]);

  // Keyboard shortcut: Escape to exit Material Studio
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMaterialStudio();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeMaterialStudio]);

  // Reset Camera View
  const handleResetCamera = () => {
    if (!threeRefs.current) return;
    const { camera, controls } = threeRefs.current;
    camera.position.set(0, 0.6, 4.2);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  // Zoom In / Out
  const handleZoom = (direction: 'in' | 'out') => {
    if (!threeRefs.current) return;
    const { camera } = threeRefs.current;
    const factor = direction === 'in' ? 0.8 : 1.25;
    camera.position.multiplyScalar(factor);
    threeRefs.current.controls.update();
  };

  // Assign current material to selected objects in project
  const handleAssignToSelected = () => {
    if (!activeMaterial) return;
    const ids =
      selectedObjectIds && selectedObjectIds.length > 0
        ? selectedObjectIds
        : selectedObjectId
        ? [selectedObjectId]
        : [];
    if (ids.length === 0) {
      setCopiedNotification('No hay ningún objeto 3D seleccionado en la escena.');
      setTimeout(() => setCopiedNotification(null), 3000);
      return;
    }
    assignMaterialToObjects(ids, activeMaterial.id);
    setCopiedNotification(`Asignado con éxito a ${ids.length} objeto(s).`);
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  // Duplicate active material
  const handleDuplicateMaterial = () => {
    if (!activeMaterial) return;
    const newId = 'mat_' + Math.random().toString(36).substr(2, 9);
    const duplicated: MaterialData = {
      ...activeMaterial,
      id: newId,
      name: `${activeMaterial.name} (Copia)`,
    };
    addMaterial(duplicated);
    setMaterialStudioMaterialId(newId);
    setCopiedNotification(`Material duplicado: "${duplicated.name}"`);
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  // Take Snapshot / Export thumbnail
  const handleCaptureSnapshot = () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${(activeMaterial?.name || 'material').replace(/\s+/g, '_')}_preview.png`;
    a.click();
    setCopiedNotification('Captura HD guardada con éxito.');
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  const selectedEnv = ENVIRONMENT_PRESETS.find((p) => p.id === envPresetId) || ENVIRONMENT_PRESETS[0];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0d0e12] text-zinc-200 overflow-hidden select-none font-sans">
      {/* ── TOP BAR HEADER: MATERIAL STUDIO ── */}
      <header className="h-13 bg-[#12131a] border-b border-white/10 px-4 flex items-center justify-between gap-3 flex-shrink-0 z-30 shadow-lg">
        {/* Left: Return to 3D Editor Button & Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={closeMaterialStudio}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-95 group border border-indigo-400/30"
            title="Regresar a la escena 3D principal (Esc)"
          >
            <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Volver al Editor 3D</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 font-mono text-indigo-200 ml-1">Esc</span>
          </button>

          <div className="h-5 w-px bg-white/10" />

          {/* Mode Badge & Material Title */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Palette size={15} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wide">Visor de Materiales PBR</span>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  GPU Aislada
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-zinc-400 font-medium">Material:</span>
                <select
                  value={activeMaterial?.id || ''}
                  onChange={(e) => setMaterialStudioMaterialId(e.target.value)}
                  className="bg-black/40 border border-white/10 hover:border-indigo-500/50 rounded px-1.5 py-0.5 text-[11px] font-bold text-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                >
                  {project.materials.map((m) => (
                    <option key={m.id} value={m.id} className="bg-zinc-900 text-zinc-200">
                      {m.name} {(m.category === 'imported' || m.id.startsWith('mat_imp_') || m.id.startsWith('mat_obj_') || (m.map && !m.proceduralBaseId)) ? '(📦 Importado)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Mesh Selector & Environment Presets */}
        <div className="flex items-center gap-1.5 bg-[#181922] p-1 rounded-xl border border-white/5 max-w-full overflow-x-auto custom-scrollbar">
          {/* Sample Mesh Switcher */}
          <div className="flex items-center gap-0.5 px-0.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mr-1 hidden sm:inline">Malla:</span>
            {[
              { id: 'SPHERE', label: 'Esfera', icon: '🌐' },
              { id: 'SHADER_BALL', label: 'Shader Ball', icon: '🪩' },
              { id: 'ROCK', label: 'Roca / Iceberg', icon: '🏔️' },
              { id: 'GEM', label: 'Cristal / Gema', icon: '💎' },
              { id: 'CUBE', label: 'Bloque', icon: '🧊' },
              { id: 'TORUS', label: 'Toroide', icon: '🍩' },
              { id: 'CLOTH', label: 'Paño', icon: '👕' },
              { id: 'VOLUME', label: 'Nube', icon: '☁️' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMeshType(m.id as PreviewMeshType)}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all ${
                  selectedMeshType === m.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                }`}
                title={m.label}
              >
                <span>{m.icon}</span>
                <span className="hidden lg:inline">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-white/10" />

          {/* Environment Lighting Selector */}
          <div className="flex items-center gap-1 px-1">
            <Sun size={12} className="text-amber-400 flex-shrink-0" />
            <select
              value={envPresetId}
              onChange={(e) => setEnvPresetId(e.target.value)}
              className="bg-zinc-900 border border-white/10 rounded-lg px-1.5 py-1 text-[10px] font-semibold text-zinc-200 focus:outline-none focus:border-indigo-500 cursor-pointer max-w-[140px] truncate"
              title="Preset de iluminación HDRI"
            >
              {ENVIRONMENT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center gap-2">
          {/* Quick Assign to Object */}
          <button
            onClick={handleAssignToSelected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-white/10 transition-colors shadow-sm"
            title="Asignar este material al objeto seleccionado en la escena"
          >
            <Check size={13} className="text-emerald-400" />
            <span className="hidden sm:inline">Asignar a Selección</span>
          </button>

          {/* Duplicate Material */}
          <button
            onClick={handleDuplicateMaterial}
            className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-white/10"
            title="Duplicar este material"
          >
            <Layers size={15} />
          </button>

          {/* Snapshot */}
          <button
            onClick={handleCaptureSnapshot}
            className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-white/10"
            title="Capturar imagen HD de la vista previa"
          >
            <Camera size={15} />
          </button>
        </div>
      </header>

      {/* ── NOTIFICATION TOAST ── */}
      {copiedNotification && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-zinc-900/95 border border-indigo-500/40 text-indigo-200 text-xs font-semibold shadow-2xl backdrop-blur-md flex items-center gap-2 animate-fadeIn">
          <Sparkles size={14} className="text-indigo-400" />
          <span>{copiedNotification}</span>
        </div>
      )}

      {/* ── MAIN WORKSPACE: 3D VIEWPORT + MATERIAL INSPECTOR ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Central 3D Canvas Area */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden flex flex-col min-w-0"
          style={{ backgroundColor: selectedEnv.bgColor }}
        >
          {/* Three.js Canvas */}
          <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing outline-none" />

          {/* ── TOP-RIGHT HUD: Light Angle Slider ── */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 p-1.5 px-3 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-xl">
            <Sun size={13} className="text-yellow-400" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Ángulo Luz:</span>
            <input
              type="range"
              min="0"
              max="360"
              value={lightRotation}
              onChange={(e) => setLightRotation(parseFloat(e.target.value))}
              className="w-20 accent-indigo-500 cursor-pointer"
              title={`Rotación de la iluminación: ${lightRotation}°`}
            />
            <span className="text-[10px] font-mono text-zinc-300 w-8">{lightRotation}°</span>
          </div>

          {/* ── BOTTOM HUD CONTROLS: Viewport Floating Bar ── */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl">
            {/* Turntable 360 Toggle */}
            <button
              onClick={() => setIsTurntableActive((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${
                isTurntableActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400'
              }`}
              title="Giro automático 360°"
            >
              <RotateCw size={12} className={isTurntableActive ? 'animate-spin' : ''} />
              <span>Turntable 360°</span>
            </button>

            {/* Turntable Speed Slider */}
            {isTurntableActive && (
              <div className="flex items-center gap-1 px-2">
                <input
                  type="range"
                  min="0.1"
                  max="2.5"
                  step="0.1"
                  value={turntableSpeed}
                  onChange={(e) => setTurntableSpeed(parseFloat(e.target.value))}
                  className="w-16 accent-indigo-500 cursor-pointer"
                  title={`Velocidad de giro: ${turntableSpeed.toFixed(1)}x`}
                />
              </div>
            )}

            {/* Wireframe Toggle */}
            <button
              onClick={() => setShowWireframe((v) => !v)}
              className={`p-1.5 rounded-xl text-[10px] font-bold transition-all ${
                showWireframe ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              title="Modo Malla de Alambre (Wireframe)"
            >
              <Box size={13} />
            </button>

            <div className="h-4 w-px bg-white/10" />

            {/* Zoom In */}
            <button
              onClick={() => handleZoom('in')}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Acercar Cámara"
            >
              <ZoomIn size={13} />
            </button>

            {/* Zoom Out */}
            <button
              onClick={() => handleZoom('out')}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Alejar Cámara"
            >
              <ZoomOut size={13} />
            </button>

            {/* Reset Camera */}
            <button
              onClick={handleResetCamera}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Centrar y Resetear Cámara"
            >
              <Maximize2 size={13} />
            </button>
          </div>

          {/* Quick Helper Legend */}
          <div className="absolute bottom-3 right-4 text-[9px] text-zinc-500 flex items-center gap-3 pointer-events-none hidden md:flex">
            <span>🖱️ Click Izq: Orbitar</span>
            <span>🖱️ Click Der: Desplazar</span>
            <span>⚙️ Rueda: Zoom</span>
          </div>
        </div>

        {/* ── RIGHT DOCKED SIDEBAR: FULL MATERIAL INSPECTOR & LIBRARY ── */}
        <aside className="w-80 sm:w-[350px] lg:w-[380px] xl:w-[400px] flex flex-col bg-[#141417] border-l border-white/10 overflow-hidden flex-shrink-0 z-30 shadow-2xl">
          <MaterialPanel />
        </aside>
      </div>
    </div>
  );
};
