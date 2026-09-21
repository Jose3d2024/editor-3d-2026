import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { 
  X, 
  Magnet, 
  ChevronRight, 
  ChevronLeft, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  Layers, 
  Compass, 
  Eye, 
  Sparkles, 
  ExternalLink,
  Sliders,
  Move3d,
  MousePointerClick
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { alignObjectRotationToNormal, getObjectBaseExtentAlongNormal, snapPointToSurfaces } from '../utils/faceSnap';

interface FaceSnapDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type DemoStep = 0 | 1 | 2 | 3 | 4 | 5;

export const FaceSnapDemoModal: React.FC<FaceSnapDemoModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState<DemoStep>(0);
  const [isSimulatingDrag, setIsSimulatingDrag] = useState(false);
  const [snapBase, setSnapBase] = useState(true);
  const [alignmentAxis, setAlignmentAxis] = useState<'+Y' | '-Y' | '+Z' | '-Z' | '+X' | '-X'>('+Y');
  const [alignRotation, setAlignRotation] = useState(true);
  const [offsetValue, setOffsetValue] = useState(0.002);
  const [statusText, setStatusText] = useState('Listo para probar');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const columnMeshRef = useRef<THREE.Mesh | null>(null);
  const accessoryMeshRef = useRef<THREE.Group | null>(null);
  const normalArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const contactMarkerRef = useRef<THREE.Mesh | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const simAngleRef = useRef<number>(0);

  // Initialize Three.js embedded canvas preview
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const width = canvas.parentElement?.clientWidth || 480;
    const height = canvas.parentElement?.clientHeight || 360;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0c0d12');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4.5, 3.2, 5.0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 1.4, 0);
    controlsRef.current = controls;

    // Ambient and Directional Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0x818cf8, 0.6);
    backLight.position.set(-5, 4, -4);
    scene.add(backLight);

    // Grid Floor
    const grid = new THREE.GridHelper(10, 20, 0x3b82f6, 0x27272a);
    grid.position.y = 0;
    scene.add(grid);

    // 1. Target Column (Purple Curved Cylinder)
    const colGeom = new THREE.CylinderGeometry(1.2, 1.2, 3.0, 32);
    const colMat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      roughness: 0.35,
      metalness: 0.15,
      flatShading: false
    });
    const column = new THREE.Mesh(colGeom, colMat);
    column.position.set(0, 1.5, 0);
    column.castShadow = true;
    column.receiveShadow = true;
    scene.add(column);
    columnMeshRef.current = column;

    // 2. Accessory Group (Blue Cylinder)
    const accGroup = new THREE.Group();
    const accGeom = new THREE.CylinderGeometry(0.28, 0.28, 0.8, 24);
    const accMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.4
    });
    const accMesh = new THREE.Mesh(accGeom, accMat);
    accMesh.castShadow = true;
    accGroup.add(accMesh);

    // Add decorative pointer/ring to show top vs base
    const ringGeom = new THREE.TorusGeometry(0.3, 0.03, 16, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.38; // near top
    accGroup.add(ring);

    // Initial position of accessory (floating near the column)
    accGroup.position.set(2.4, 2.0, 0.4);
    scene.add(accGroup);
    accessoryMeshRef.current = accGroup;

    // 3. Normal Vector Arrow Helper
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 0.9, 0xa3e635, 0.25, 0.15);
    arrow.visible = false;
    scene.add(arrow);
    normalArrowRef.current = arrow;

    // 4. Contact Point Marker
    const markerGeom = new THREE.SphereGeometry(0.06, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
    const contactMarker = new THREE.Mesh(markerGeom, markerMat);
    contactMarker.visible = false;
    scene.add(contactMarker);
    contactMarkerRef.current = contactMarker;

    let isRunning = true;
    const animate = () => {
      if (!isRunning) return;
      controls.update();

      // Handle interactive drag simulation if enabled
      if (isSimulatingDrag && columnMeshRef.current && accessoryMeshRef.current) {
        simAngleRef.current += 0.02;
        const radius = 1.2; // column radius
        const angle = simAngleRef.current;
        const surfaceX = Math.sin(angle) * radius;
        const surfaceZ = Math.cos(angle) * radius;
        const surfaceY = 1.5 + Math.sin(angle * 1.5) * 0.7;

        const surfacePoint = new THREE.Vector3(surfaceX, surfaceY, surfaceZ);
        // Normal of cylinder pointing outwards
        const normal = new THREE.Vector3(surfaceX, 0, surfaceZ).normalize();

        const curRot: [number, number, number] = [
          accessoryMeshRef.current.rotation.x,
          accessoryMeshRef.current.rotation.y,
          accessoryMeshRef.current.rotation.z
        ];
        const newRot = alignObjectRotationToNormal(curRot, normal, alignmentAxis);
        accessoryMeshRef.current.rotation.set(newRot[0], newRot[1], newRot[2]);

        const halfHeight = 0.4; // half of 0.8 cylinder height
        const extent = snapBase ? halfHeight : 0;
        const finalPos = surfacePoint.clone().addScaledVector(normal, extent + offsetValue);
        accessoryMeshRef.current.position.copy(finalPos);

        if (normalArrowRef.current) {
          normalArrowRef.current.position.copy(surfacePoint);
          normalArrowRef.current.setDirection(normal);
          normalArrowRef.current.visible = true;
        }
        if (contactMarkerRef.current) {
          contactMarkerRef.current.position.copy(surfacePoint);
          contactMarkerRef.current.visible = true;
        }
      }

      renderer.render(scene, camera);
      animFrameIdRef.current = requestAnimationFrame(animate);
    };

    animFrameIdRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!canvas.parentElement || !cameraRef.current || !rendererRef.current) return;
      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isRunning = false;
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      renderer.dispose();
    };
  }, [isOpen, isSimulatingDrag, snapBase, alignmentAxis, alignRotation, offsetValue]);

  // Action: Reset Accessory to floating position
  const resetAccessoryPosition = () => {
    setIsSimulatingDrag(false);
    if (!accessoryMeshRef.current) return;
    accessoryMeshRef.current.position.set(2.4, 2.0, 0.4);
    accessoryMeshRef.current.rotation.set(0, 0, 0);
    if (normalArrowRef.current) normalArrowRef.current.visible = false;
    if (contactMarkerRef.current) contactMarkerRef.current.visible = false;
    setStatusText('Accesorio restablecido flotando lejos de la columna.');
  };

  // Action: Perform 1-Click Surface Alignment in the Demo Canvas
  const performDemoSnap = (overrideSnapBase = snapBase, overrideAxis = alignmentAxis, overrideOffset = offsetValue) => {
    setIsSimulatingDrag(false);
    if (!columnMeshRef.current || !accessoryMeshRef.current) return;

    const accPos = accessoryMeshRef.current.position;
    // Calculate nearest point on cylinder
    const radius = 1.2;
    const dir = new THREE.Vector2(accPos.x, accPos.z).normalize();
    const surfaceX = dir.x * radius;
    const surfaceZ = dir.y * radius;
    const surfaceY = Math.max(0.2, Math.min(2.8, accPos.y));

    const surfacePoint = new THREE.Vector3(surfaceX, surfaceY, surfaceZ);
    const normal = new THREE.Vector3(surfaceX, 0, surfaceZ).normalize();

    // Align Rotation
    if (alignRotation) {
      const curRot: [number, number, number] = [0, 0, 0];
      const newRot = alignObjectRotationToNormal(curRot, normal, overrideAxis);
      accessoryMeshRef.current.rotation.set(newRot[0], newRot[1], newRot[2]);
    } else {
      accessoryMeshRef.current.rotation.set(0, 0, 0);
    }

    // Position with or without base extent
    const halfHeight = 0.4;
    const extent = overrideSnapBase ? halfHeight : 0;
    const finalPos = surfacePoint.clone().addScaledVector(normal, extent + overrideOffset);
    accessoryMeshRef.current.position.copy(finalPos);

    if (normalArrowRef.current) {
      normalArrowRef.current.position.copy(surfacePoint);
      normalArrowRef.current.setDirection(normal);
      normalArrowRef.current.visible = true;
    }
    if (contactMarkerRef.current) {
      contactMarkerRef.current.position.copy(surfacePoint);
      contactMarkerRef.current.visible = true;
    }

    setStatusText(
      overrideSnapBase
        ? `🎯 Accesorio pegado sobre la cara exterior con normal orientada y base al ras (+${overrideOffset} offset).`
        : `⚠️ Accesorio ajustado al pivote central (50% hundido dentro de la columna).`
    );
  };

  // Action: Embed inside the column for multi-directional test
  const placeAccessoryInside = () => {
    setIsSimulatingDrag(false);
    if (!accessoryMeshRef.current) return;
    accessoryMeshRef.current.position.set(0.2, 1.4, 0.1);
    accessoryMeshRef.current.rotation.set(0.3, 0.2, 0.5);
    if (normalArrowRef.current) normalArrowRef.current.visible = false;
    if (contactMarkerRef.current) contactMarkerRef.current.visible = false;
    setStatusText('Accesorio incrustado deliberadamente dentro del interior de la columna.');
  };

  // Action: Execute on the real Main Viewport project
  const loadDemoSceneIntoApp = () => {
    useStore.getState().loadFaceSnapDemoScene(true);
    setStatusText('✓ Escena cargada en el editor principal (Columna Morada + Accesorio Azul seleccionada).');
  };

  const applyConfigToApp = () => {
    useStore.getState().setFaceSnapConfig({
      enabled: true,
      targetType: 'FACE',
      alignRotationToTarget: alignRotation,
      snapBaseToSurface: snapBase,
      alignmentAxis: alignmentAxis,
      offset: offsetValue
    });
    setStatusText('✓ Configuración aplicada al Imán del proyecto.');
  };

  const executeSnapInApp = async () => {
    const ok = await useStore.getState().alignToSurface();
    if (ok) {
      setStatusText('✓ ¡Alineación 1-Clic ejecutada en la escena principal!');
    } else {
      setStatusText('Aviso: Asegúrate de tener seleccionado el accesorio en la escena principal.');
    }
  };

  if (!isOpen) return null;

  const stepsInfo = [
    {
      step: 0,
      title: '🌟 Vista General del Sistema de Snapping',
      badge: 'Introducción',
      desc: 'El sistema de Face Snapping & Align to Target permite apoyar y orientar accesorios sobre cualquier superficie curva, cóncava o inclinada al estilo Blender.'
    },
    {
      step: 1,
      title: '🎯 Botón de Alineación Inmediata (1-Clic)',
      badge: '1 Clic',
      desc: 'Al pulsar «🎯 Alinear y Pegar a la Superficie (Snap)», el objeto busca la cara más próxima, calcula la normal exacta y se apoya y rota en milisegundos sin mover el gizmo.'
    },
    {
      step: 2,
      title: '📐 Apoyar Base en Superficie (Evita el Hundimiento)',
      badge: 'Geometría Base',
      desc: 'Evita que el 50% del accesorio quede enterrado dentro del modelo. Calcula la cota inferior respecto a la normal para que la base descanse sobre la cara.'
    },
    {
      step: 3,
      title: '🧭 Eje de Apoyo del Accesorio (+Y, +Z, +X)',
      badge: 'Ejes Locales',
      desc: 'Define qué cara o eje del accesorio debe encarar la normal: +Y para tornillos y postes, +Z para miras y linternas frontales, +X para fijaciones laterales.'
    },
    {
      step: 4,
      title: '🔄 Prospección de Superficies Multidireccional',
      badge: 'Raycasting 360°',
      desc: 'Detecta caras en 6 direcciones cartesianas (±X, ±Y, ±Z) y hacia centros geométricos. Incluso si el objeto está dentro de la malla, encuentra la pared exterior.'
    },
    {
      step: 5,
      title: '🚀 Cómo Usarlo Paso a Paso en el Editor',
      badge: 'Guía Práctica',
      desc: 'Flujo de trabajo para 1 Clic directo y para Arrastre Dinámico interactivo con el Gizmo 3D.'
    }
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 select-none">
      <div className="relative w-full max-w-5xl h-[92vh] max-h-[820px] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center text-black shadow-lg shadow-amber-500/20">
              <Magnet size={19} className="stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-tight text-white">
                  Demo Interactiva: Ajuste y Snapping a Superficies (Estilo Blender)
                </h2>
                <span className="px-2 py-0.5 text-[9.5px] font-bold uppercase rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {stepsInfo[currentStep].badge}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Aprende y prueba en vivo la alineación de accesorios a caras curvas e inclinadas paso a paso.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadDemoSceneIntoApp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-[11px] font-semibold transition-all border border-indigo-400/30 shadow-sm cursor-pointer"
              title="Carga la columna morada y el cilindro azul en tu visor principal de trabajo"
            >
              <Sparkles size={13} />
              <span>Cargar Escena en Editor</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Stepper Navigation Tabs ── */}
        <div className="flex items-center border-b border-zinc-800/60 bg-zinc-950 px-3 py-2 gap-1.5 overflow-x-auto">
          {stepsInfo.map((s, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCurrentStep(idx as DemoStep);
                setIsSimulatingDrag(false);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                currentStep === idx
                  ? 'bg-amber-500 text-black font-bold shadow-md shadow-amber-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-mono font-bold ${
                currentStep === idx ? 'bg-black text-amber-400' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {idx}
              </span>
              <span>{s.badge}</span>
            </button>
          ))}
        </div>

        {/* ── Main Content Area (Split 3D Canvas + Interactive Controls) ── */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          
          {/* Left Column: Interactive 3D Canvas (7 cols) */}
          <div className="lg:col-span-7 relative bg-black/60 flex flex-col border-b lg:border-b-0 lg:border-r border-zinc-800/80">
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
              <span className="px-2 py-1 bg-zinc-900/90 backdrop-blur border border-white/10 rounded-md text-[10px] text-zinc-300 flex items-center gap-1.5">
                <Eye size={12} className="text-amber-400" />
                <span>Arrastra con el ratón para rotar la cámara 3D</span>
              </span>
              <span className="px-2 py-1 bg-zinc-900/90 backdrop-blur border border-white/10 rounded-md text-[10px] font-mono text-zinc-300">
                Zoom: Rueda
              </span>
            </div>

            <div className="w-full flex-1 relative min-h-[280px]">
              <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />
              
              {/* Overlay legend */}
              <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between p-2 rounded-lg bg-zinc-950/85 backdrop-blur border border-zinc-800 text-[10px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    <span className="text-zinc-300">Columna Objetivo Curva</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                    <span className="text-zinc-300">Accesorio a Ajustar</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-lime-400" />
                    <span className="text-zinc-300">Flecha Vector Normal</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                    <span className="text-zinc-300">Punto de Contacto</span>
                  </div>
                </div>

                <button
                  onClick={resetAccessoryPosition}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9.5px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  title="Devolver accesorio al aire"
                >
                  <RotateCcw size={11} />
                  <span>Separar</span>
                </button>
              </div>
            </div>

            {/* Canvas status bar */}
            <div className="px-4 py-2 bg-zinc-900/80 border-t border-zinc-800 text-[11px] text-zinc-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="font-mono text-zinc-400 truncate">{statusText}</span>
            </div>
          </div>

          {/* Right Column: Step Explanation & Controls (5 cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between p-5 bg-zinc-950/90 overflow-y-auto">
            <div className="space-y-4">
              
              {/* Step Title & Description */}
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                  <span>Paso {currentStep} de 5</span>
                </div>
                <h3 className="text-base font-bold text-white leading-snug">
                  {stepsInfo[currentStep].title}
                </h3>
                <p className="text-[12px] text-zinc-300 mt-1.5 leading-relaxed">
                  {stepsInfo[currentStep].desc}
                </p>
              </div>

              {/* ── STEP 0: Vista General ── */}
              {currentStep === 0 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <h4 className="text-[11.5px] font-bold text-zinc-200 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-amber-400" />
                    <span>¿Qué resuelve este sistema?</span>
                  </h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Al modelar componentes mecánicos, miras, manijas o remaches sobre superficies cilíndricas, esféricas o curvadas, colocarlos a mano requiere rotar 3 ejes cartesianos y moverlos continuamente.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                    <div className="p-2 rounded bg-zinc-950/80 border border-white/5">
                      <span className="font-bold text-amber-400 block mb-0.5">🎯 1 Clic Directo</span>
                      <span className="text-zinc-400">Pega y orienta el accesorio inmediatamente a la superficie más próxima.</span>
                    </div>
                    <div className="p-2 rounded bg-zinc-950/80 border border-white/5">
                      <span className="font-bold text-cyan-400 block mb-0.5">📐 Apoyo de Base</span>
                      <span className="text-zinc-400">Evita que se incruste a la mitad calculando la extensión del volumen.</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80 flex flex-col gap-2">
                    <button
                      onClick={loadDemoSceneIntoApp}
                      className="w-full py-2 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-lg text-[11px] font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Sparkles size={14} />
                      <span>Cargar Escena Demo en el Editor de Trabajo</span>
                    </button>
                    <button
                      onClick={() => setCurrentStep(1)}
                      className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[11px] font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <span>Comenzar Paso a Paso</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 1: Botón de Alineación Inmediata (1-Clic) ── */}
              {currentStep === 1 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/20 text-amber-200 text-[11px]">
                    <MousePointerClick size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <span>
                      Pruébalo ahora en el visor de la izquierda: pulsa el botón para ver cómo el cilindro azul encuentra la normal de la columna curva y se pega sin arrastre manual.
                    </span>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => performDemoSnap()}
                      className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black font-bold rounded-lg text-[11.5px] shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Magnet size={15} />
                      <span>🎯 Ejecutar 1-Clic Snap (Alinear y Pegar)</span>
                    </button>

                    <button
                      onClick={resetAccessoryPosition}
                      className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-lg text-[10.5px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw size={12} />
                      <span>Separar Accesorio en el Aire (Reiniciar posición)</span>
                    </button>

                    <button
                      onClick={executeSnapInApp}
                      className="w-full py-1.5 bg-indigo-950/60 hover:bg-indigo-900 text-indigo-300 border border-indigo-500/30 font-semibold rounded-lg text-[10.5px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink size={12} />
                      <span>Ejecutar este 1-Clic en la Escena Principal</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 2: Apoyar Base en Superficie (Evita hundirse) ── */}
              {currentStep === 2 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    Por defecto, en muchos motores el punto de origen de la malla está en el centro. Al ajustarlo a la cara, el centro coincide con la superficie y la mitad del objeto queda <strong>enterrada</strong>.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setSnapBase(false);
                        performDemoSnap(false);
                      }}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        !snapBase
                          ? 'bg-rose-950/40 border-rose-500 text-white'
                          : 'bg-zinc-950/80 border-white/5 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span className="text-[10px] font-bold text-rose-400 block mb-0.5">❌ Hundido al 50%</span>
                      <span className="text-[9px] text-zinc-400 leading-tight">El pivote central toca la cara. Se hunde la mitad.</span>
                    </button>

                    <button
                      onClick={() => {
                        setSnapBase(true);
                        performDemoSnap(true);
                      }}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        snapBase
                          ? 'bg-emerald-950/40 border-emerald-500 text-white'
                          : 'bg-zinc-950/80 border-white/5 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <span className="text-[10px] font-bold text-emerald-400 block mb-0.5">✅ Base Apoyada</span>
                      <span className="text-[9px] text-zinc-400 leading-tight">Calcula el bounding extent y apoya la base al ras.</span>
                    </button>
                  </div>

                  {/* Offset Slider */}
                  <div className="space-y-1 bg-zinc-950/80 p-2.5 rounded-lg border border-white/5">
                    <div className="flex items-center justify-between text-[10.5px]">
                      <span className="text-zinc-300 font-medium">Offset de Separación (Anti Z-Fighting):</span>
                      <span className="font-mono text-amber-300 font-bold">{offsetValue}m</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.02"
                      step="0.001"
                      value={offsetValue}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setOffsetValue(val);
                        performDemoSnap(snapBase, alignmentAxis, val);
                      }}
                      className="w-full accent-amber-500 cursor-pointer h-1.5"
                    />
                  </div>
                </div>
              )}

              {/* ── STEP 3: Eje de Apoyo del Accesorio (+Y, +Z, +X) ── */}
              {currentStep === 3 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    Depende de cómo se haya modelado el objeto, el lado que debe fijarse a la pared puede ser su base inferior (+Y), su cara frontal (+Z) o un lateral (+X):
                  </p>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { axis: '+Y', name: '+Y (Base)', desc: 'Tornillos, cilindros, conos, patas' },
                      { axis: '+Z', name: '+Z (Frente)', desc: 'Miras telescópicas, faros, proyectores' },
                      { axis: '+X', name: '+X (Lateral)', desc: 'Ganchos, manillas, soportes' },
                    ].map(item => (
                      <button
                        key={item.axis}
                        onClick={() => {
                          const ax = item.axis as any;
                          setAlignmentAxis(ax);
                          performDemoSnap(snapBase, ax);
                        }}
                        className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                          alignmentAxis === item.axis
                            ? 'bg-amber-500/20 border-amber-500 text-white'
                            : 'bg-zinc-950/80 border-white/5 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <span className="text-[10px] font-mono font-bold text-amber-300 block mb-0.5">{item.name}</span>
                        <span className="text-[8.5px] text-zinc-400 leading-tight">{item.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-white/5 text-[10.5px] text-zinc-300">
                    <span className="text-zinc-400">Eje activo: </span>
                    <strong className="text-amber-400">{alignmentAxis}</strong>. La flecha amarilla en la base se orienta paralela a la normal verde de la columna.
                  </div>
                </div>
              )}

              {/* ── STEP 4: Prospección Multidireccional ── */}
              {currentStep === 4 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    Un raycast tradicional sólo dispara hacia abajo o desde la cámara. Nuestro algoritmo dispara rayos en <strong>6 direcciones cartesianas (±X, ±Y, ±Z)</strong> y hacia los centros de las mallas candidatas.
                  </p>

                  <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-200 text-[11px] leading-relaxed">
                    Prueba a colocar el accesorio deliberadamente <strong>dentro</strong> de la columna: el sistema no se romperá ni devolverá nulo, sino que encontrará la pared más cercana y lo proyectará hacia afuera.
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={placeAccessoryInside}
                      className="py-2 px-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10.5px] font-semibold transition-all cursor-pointer"
                    >
                      1. Incrustar Dentro
                    </button>
                    <button
                      onClick={() => performDemoSnap()}
                      className="py-2 px-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-black font-bold rounded-lg text-[10.5px] transition-all cursor-pointer"
                    >
                      2. Resolver Snapping
                    </button>
                  </div>
                </div>
              )}

              {/* ── STEP 5: Guía Práctica de Uso en la Aplicación ── */}
              {currentStep === 5 && (
                <div className="space-y-3 bg-zinc-900/60 p-3.5 rounded-xl border border-zinc-800">
                  <div className="space-y-2 text-[11px] text-zinc-300">
                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-white/5 space-y-1">
                      <span className="font-bold text-amber-400 block">Opción A: Alineación Rápida con 1 Clic</span>
                      <ol className="list-decimal pl-4 space-y-0.5 text-zinc-400 text-[10px]">
                        <li>Selecciona el objeto accesorio (por ejemplo, el cilindro azul).</li>
                        <li>Abre el menú desplegable del imán o de visores.</li>
                        <li>Haz clic en <strong>«🎯 Alinear y Pegar a la Superficie»</strong>.</li>
                      </ol>
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-white/5 space-y-1">
                      <span className="font-bold text-cyan-400 block">Opción B: Alineación Dinámica por Arrastre (Blender)</span>
                      <ol className="list-decimal pl-4 space-y-0.5 text-zinc-400 text-[10px]">
                        <li>Activa el imán en <strong>ON</strong>.</li>
                        <li>Marca las casillas <strong>«Alinear Rotación a la Cara»</strong> y <strong>«Apoyar Base»</strong>.</li>
                        <li>Arrastra con las flechas del Gizmo por encima de la columna: se deslizará pegado orientando su inclinación.</li>
                      </ol>
                    </div>
                  </div>

                  {/* Interactive Drag Simulation Toggle */}
                  <div className="pt-1">
                    <button
                      onClick={() => setIsSimulatingDrag(v => !v)}
                      className={`w-full py-2 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                        isSimulatingDrag
                          ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                      }`}
                    >
                      {isSimulatingDrag ? <Pause size={14} /> : <Play size={14} />}
                      <span>{isSimulatingDrag ? 'Pausar Simulación de Arrastre' : '▶ Simular Arrastre Dinámico en Tiempo Real'}</span>
                    </button>
                  </div>
                </div>
              )}

            </div>

            {/* ── Footer Navigation Bar ── */}
            <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentStep(curr => Math.max(0, curr - 1) as DemoStep)}
                  disabled={currentStep === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
                >
                  <ChevronLeft size={14} />
                  <span>Anterior</span>
                </button>

                <button
                  onClick={() => setCurrentStep(curr => Math.min(5, curr + 1) as DemoStep)}
                  disabled={currentStep === 5}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <span>Siguiente</span>
                  <ChevronRight size={14} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={applyConfigToApp}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-[11px] font-bold transition-all cursor-pointer"
                  title="Aplica la configuración recomendada a tu sesión de trabajo"
                >
                  Configurar Imán en App
                </button>

                <button
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black text-[11px] font-bold shadow-md transition-all cursor-pointer"
                >
                  Cerrar y Probar
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
