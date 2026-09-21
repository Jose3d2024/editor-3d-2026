import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { CSGObject, MaterialData } from '../types';
import { 
  X, Copy, Check, Code, FileJson, Sparkles, Layers, Box, Play, FileCode, CheckCircle2
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const CodeExporterModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const project = useStore(s => s.project);
  const selectedObjectIds = useStore(s => s.selectedObjectIds);
  const [activeTab, setActiveTab] = useState<'vanilla' | 'r3f' | 'json'>('vanilla');
  const [exportScope, setExportScope] = useState<'all' | 'selected'>('all');
  const [includeAnimations, setIncludeAnimations] = useState(true);
  const [includeLights, setIncludeLights] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // Filtrar objetos a exportar
  const objectsToExport = useMemo(() => {
    if (exportScope === 'selected' && selectedObjectIds.length > 0) {
      return project.objects.filter(o => selectedObjectIds.includes(o.id));
    }
    return project.objects;
  }, [project.objects, exportScope, selectedObjectIds]);

  // Mapa de materiales
  const materialMap = useMemo(() => {
    const map = new Map<string, MaterialData>();
    project.materials.forEach(m => map.set(m.id, m));
    return map;
  }, [project.materials]);

  // ── Generar Código Vanilla Three.js ────────────────────────────────
  const vanillaCode = useMemo(() => {
    let code = `import * as THREE from 'three';\n`;
    code += `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';\n\n`;
    code += `// ── Configuración de Escena y Renderer ──\n`;
    code += `const scene = new THREE.Scene();\n`;
    code += `scene.background = new THREE.Color('#111115');\n\n`;
    code += `const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);\n`;
    code += `camera.position.set(5, 5, 10);\n\n`;
    code += `const renderer = new THREE.WebGLRenderer({ antialias: true });\n`;
    code += `renderer.setSize(window.innerWidth, window.innerHeight);\n`;
    code += `renderer.shadowMap.enabled = true;\n`;
    code += `document.body.appendChild(renderer.domElement);\n\n`;
    code += `const controls = new OrbitControls(camera, renderer.domElement);\n`;
    code += `controls.enableDamping = true;\n\n`;

    if (includeLights) {
      code += `// ── Luces ──\n`;
      code += `const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);\n`;
      code += `scene.add(ambientLight);\n\n`;
      code += `const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);\n`;
      code += `dirLight.position.set(10, 15, 10);\n`;
      code += `dirLight.castShadow = true;\n`;
      code += `scene.add(dirLight);\n\n`;
    }

    code += `// ── Materiales ──\n`;
    const usedMaterialIds = new Set<string>();
    objectsToExport.forEach(o => {
      if (o.materialId) usedMaterialIds.add(o.materialId);
    });

    if (usedMaterialIds.size === 0) {
      code += `const defaultMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.4, metalness: 0.1 });\n\n`;
    } else {
      usedMaterialIds.forEach(id => {
        const mat = materialMap.get(id);
        const varName = `mat_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
        if (mat) {
          const hex = mat.color.replace('#', '0x');
          code += `const ${varName} = new THREE.MeshStandardMaterial({\n`;
          code += `  color: ${hex},\n`;
          code += `  roughness: ${mat.roughness},\n`;
          code += `  metalness: ${mat.metalness},\n`;
          code += `  opacity: ${mat.opacity},\n`;
          code += `  transparent: ${mat.transparent ? 'true' : 'false'},\n`;
          if (mat.emissive && mat.emissive !== '#000000') {
            code += `  emissive: ${mat.emissive.replace('#', '0x')},\n`;
            code += `  emissiveIntensity: ${mat.emissiveIntensity},\n`;
          }
          code += `});\n`;
        }
      });
      code += `\n`;
    }

    code += `// ── Objetos 3D ──\n`;
    const animatedObjects: { varName: string; obj: CSGObject }[] = [];

    objectsToExport.forEach((obj, idx) => {
      const varName = `obj_${idx}_${obj.name.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      const matVar = obj.materialId ? `mat_${obj.materialId.replace(/[^a-zA-Z0-9]/g, '_')}` : 'defaultMaterial';
      const p = obj.parameters || {};

      let geoCode = ``;
      switch (obj.type) {
        case 'SPHERE':
          geoCode = `new THREE.SphereGeometry(${p.radius || 1}, ${p.radialSegments || 32}, ${p.segments || 16})`;
          break;
        case 'CYLINDER':
          geoCode = `new THREE.CylinderGeometry(${p.radius || 1}, ${p.radius || 1}, ${p.genH || 2}, ${p.radialSegments || 32})`;
          break;
        case 'CONE':
          geoCode = `new THREE.ConeGeometry(${p.radius || 1}, ${p.genH || 2}, ${p.radialSegments || 32})`;
          break;
        case 'TORUS':
          geoCode = `new THREE.TorusGeometry(${p.radius || 1}, ${p.tube || 0.3}, ${p.radialSegments || 16}, ${p.tubularSegments || 32})`;
          break;
        case 'PLANE':
          geoCode = `new THREE.PlaneGeometry(2, 2)`;
          break;
        case 'CIRCLE':
          geoCode = `new THREE.CircleGeometry(${p.radius || 1}, ${p.segments || 32})`;
          break;
        case 'RING':
          geoCode = `new THREE.RingGeometry(${p.innerRadius || 0.5}, ${p.outerRadius || 1}, ${p.thetaSegments || 32})`;
          break;
        case 'ICOSAHEDRON':
          geoCode = `new THREE.IcosahedronGeometry(${p.radius || 1}, ${p.detail || 0})`;
          break;
        case 'DODECAHEDRON':
          geoCode = `new THREE.DodecahedronGeometry(${p.radius || 1}, ${p.detail || 0})`;
          break;
        case 'TETRAHEDRON':
          geoCode = `new THREE.TetrahedronGeometry(${p.radius || 1}, ${p.detail || 0})`;
          break;
        case 'OCTAHEDRON':
          geoCode = `new THREE.OctahedronGeometry(${p.radius || 1}, ${p.detail || 0})`;
          break;
        case 'PYRAMID':
          geoCode = `new THREE.ConeGeometry(0.5, 1, 4)`;
          break;
        case 'PRISM':
          geoCode = `new THREE.CylinderGeometry(0.5, 0.5, 1, 3)`;
          break;
        case 'CAPSULE':
          geoCode = `new THREE.CapsuleGeometry(0.25, 0.5, 8, 16)`;
          break;
        case 'CUBE':
        default:
          geoCode = `new THREE.BoxGeometry(1, 1, 1)`;
          break;
      }

      code += `const ${varName}_geo = ${geoCode};\n`;
      code += `const ${varName} = new THREE.Mesh(${varName}_geo, ${matVar});\n`;
      code += `${varName}.position.set(${obj.transform.position.join(', ')});\n`;
      code += `${varName}.rotation.set(${obj.transform.rotation.join(', ')});\n`;
      code += `${varName}.scale.set(${obj.transform.scale.join(', ')});\n`;
      code += `${varName}.castShadow = true;\n`;
      code += `${varName}.receiveShadow = true;\n`;
      code += `scene.add(${varName});\n\n`;

      if (includeAnimations && obj.keyframes && obj.keyframes.length > 0) {
        animatedObjects.push({ varName, obj });
      }
    });

    if (includeAnimations && animatedObjects.length > 0) {
      code += `// ── Animación por Keyframes (AnimationMixer) ──\n`;
      code += `const mixer = new THREE.AnimationMixer(scene);\n`;
      
      animatedObjects.forEach(({ varName, obj }) => {
        const sortedKf = [...obj.keyframes].sort((a, b) => a.time - b.time);
        const times = sortedKf.map(k => k.time);
        const posValues: number[] = [];
        const rotValues: number[] = [];
        const scaleValues: number[] = [];

        sortedKf.forEach(k => {
          posValues.push(...k.transform.position);
          const euler = new THREE.Euler(...k.transform.rotation);
          const q = new THREE.Quaternion().setFromEuler(euler);
          rotValues.push(q.x, q.y, q.z, q.w);
          scaleValues.push(...k.transform.scale);
        });

        code += `// Tracks para ${obj.name}\n`;
        code += `const ${varName}_posTrack = new THREE.VectorKeyframeTrack('${varName}.position', [${times.join(', ')}], [${posValues.join(', ')}]);\n`;
        code += `const ${varName}_rotTrack = new THREE.QuaternionKeyframeTrack('${varName}.quaternion', [${times.join(', ')}], [${rotValues.join(', ')}]);\n`;
        code += `const ${varName}_scaleTrack = new THREE.VectorKeyframeTrack('${varName}.scale', [${times.join(', ')}], [${scaleValues.join(', ')}]);\n`;
        code += `const ${varName}_clip = new THREE.AnimationClip('anim_${varName}', -1, [${varName}_posTrack, ${varName}_rotTrack, ${varName}_scaleTrack]);\n`;
        code += `const ${varName}_action = mixer.clipAction(${varName}_clip);\n`;
        code += `${varName}_action.play();\n\n`;
      });
    }

    code += `// ── Bucle de Renderizado ──\n`;
    code += `const clock = new THREE.Clock();\n`;
    code += `function animate() {\n`;
    code += `  requestAnimationFrame(animate);\n`;
    code += `  const delta = clock.getDelta();\n`;
    if (includeAnimations && animatedObjects.length > 0) {
      code += `  mixer.update(delta);\n`;
    }
    code += `  controls.update();\n`;
    code += `  renderer.render(scene, camera);\n`;
    code += `}\n`;
    code += `animate();\n\n`;
    code += `window.addEventListener('resize', () => {\n`;
    code += `  camera.aspect = window.innerWidth / window.innerHeight;\n`;
    code += `  camera.updateProjectionMatrix();\n`;
    code += `  renderer.setSize(window.innerWidth, window.innerHeight);\n`;
    code += `});\n`;

    return code;
  }, [project, objectsToExport, materialMap, includeAnimations, includeLights]);

  // ── Generar Código React Three Fiber (JSX) ──────────────────────────
  const r3fCode = useMemo(() => {
    let code = `import React, { useRef } from 'react';\n`;
    code += `import { Canvas, useFrame } from '@react-three/fiber';\n`;
    code += `import { OrbitControls } from '@react-three/drei';\n`;
    code += `import * as THREE from 'three';\n\n`;

    code += `function Scene() {\n`;

    const hasAnimations = includeAnimations && objectsToExport.some(o => o.keyframes && o.keyframes.length > 0);
    if (hasAnimations) {
      code += `  // Bucle de animación\n`;
      code += `  useFrame((state, delta) => {\n`;
      code += `    // Puedes añadir animaciones en tiempo real con useFrame\n`;
      code += `  });\n\n`;
    }

    code += `  return (\n`;
    code += `    <>\n`;
    if (includeLights) {
      code += `      <ambientLight intensity={0.6} />\n`;
      code += `      <directionalLight position={[10, 15, 10]} intensity={1.2} castShadow />\n`;
    }

    objectsToExport.forEach((obj) => {
      const mat = obj.materialId ? materialMap.get(obj.materialId) : null;
      const colorHex = mat ? mat.color : '#8b5cf6';
      const roughness = mat ? mat.roughness : 0.4;
      const metalness = mat ? mat.metalness : 0.1;
      const opacity = mat ? mat.opacity : 1;
      const transparent = mat ? mat.transparent : false;
      const p = obj.parameters || {};

      let geomJsx = `<boxGeometry args={[1, 1, 1]} />`;
      switch (obj.type) {
        case 'SPHERE':
          geomJsx = `<sphereGeometry args={[${p.radius || 1}, ${p.radialSegments || 32}, ${p.segments || 16}]} />`;
          break;
        case 'CYLINDER':
          geomJsx = `<cylinderGeometry args={[${p.radius || 1}, ${p.radius || 1}, ${p.genH || 2}, ${p.radialSegments || 32}]} />`;
          break;
        case 'CONE':
          geomJsx = `<coneGeometry args={[${p.radius || 1}, ${p.genH || 2}, ${p.radialSegments || 32}]} />`;
          break;
        case 'TORUS':
          geomJsx = `<torusGeometry args={[${p.radius || 1}, ${p.tube || 0.3}, ${p.radialSegments || 16}, ${p.tubularSegments || 32}]} />`;
          break;
        case 'PLANE':
          geomJsx = `<planeGeometry args={[2, 2]} />`;
          break;
        case 'CIRCLE':
          geomJsx = `<circleGeometry args={[${p.radius || 1}, ${p.segments || 32}]} />`;
          break;
        case 'RING':
          geomJsx = `<ringGeometry args={[${p.innerRadius || 0.5}, ${p.outerRadius || 1}, ${p.thetaSegments || 32}]} />`;
          break;
        case 'ICOSAHEDRON':
          geomJsx = `<icosahedronGeometry args={[${p.radius || 1}, ${p.detail || 0}]} />`;
          break;
        case 'DODECAHEDRON':
          geomJsx = `<dodecahedronGeometry args={[${p.radius || 1}, ${p.detail || 0}]} />`;
          break;
        case 'TETRAHEDRON':
          geomJsx = `<tetrahedronGeometry args={[${p.radius || 1}, ${p.detail || 0}]} />`;
          break;
        case 'OCTAHEDRON':
          geomJsx = `<octahedronGeometry args={[${p.radius || 1}, ${p.detail || 0}]} />`;
          break;
        case 'PYRAMID':
          geomJsx = `<coneGeometry args={[0.5, 1, 4]} />`;
          break;
        case 'PRISM':
          geomJsx = `<cylinderGeometry args={[0.5, 0.5, 1, 3]} />`;
          break;
        case 'CAPSULE':
          geomJsx = `<capsuleGeometry args={[0.25, 0.5, 8, 16]} />`;
          break;
      }

      code += `      {/* ${obj.name} */}\n`;
      code += `      <mesh\n`;
      code += `        position={[${obj.transform.position.join(', ')}]}\n`;
      code += `        rotation={[${obj.transform.rotation.join(', ')}]}\n`;
      code += `        scale={[${obj.transform.scale.join(', ')}]}\n`;
      code += `        castShadow\n`;
      code += `        receiveShadow\n`;
      code += `      >\n`;
      code += `        ${geomJsx}\n`;
      code += `        <meshStandardMaterial\n`;
      code += `          color="${colorHex}"\n`;
      code += `          roughness={${roughness}}\n`;
      code += `          metalness={${metalness}}\n`;
      if (opacity < 1 || transparent) {
        code += `          opacity={${opacity}}\n`;
        code += `          transparent={${transparent || opacity < 1}}\n`;
      }
      code += `        />\n`;
      code += `      </mesh>\n\n`;
    });

    code += `      <OrbitControls makeDefault />\n`;
    code += `    </>\n`;
    code += `  );\n`;
    code += `}\n\n`;

    code += `export default function App3D() {\n`;
    code += `  return (\n`;
    code += `    <div style={{ width: '100vw', height: '100vh', background: '#111115' }}>\n`;
    code += `      <Canvas shadows camera={{ position: [5, 5, 10], fov: 50 }}>\n`;
    code += `        <Scene />\n`;
    code += `      </Canvas>\n`;
    code += `    </div>\n`;
    code += `  );\n`;
    code += `}\n`;

    return code;
  }, [project, objectsToExport, materialMap, includeAnimations, includeLights]);

  // ── Generar JSON del Proyecto ──────────────────────────────────────
  const jsonCode = useMemo(() => {
    return JSON.stringify(
      {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        environment: project.environment,
        materials: project.materials,
        objects: objectsToExport,
      },
      null,
      2
    );
  }, [project, objectsToExport]);

  const activeCode = activeTab === 'vanilla' ? vanillaCode : activeTab === 'r3f' ? r3fCode : jsonCode;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Code size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Exportar Código Three.js
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Código de Producción
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Convierte tus figuras 3D y animaciones en código listo para usar en aplicaciones web
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Informative Banner */}
        <div className="bg-indigo-950/30 border-b border-indigo-800/20 px-6 py-2.5 flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-400 flex-shrink-0" />
            <span>
              <strong>Vanilla Three.js</strong> y <strong>React Three Fiber</strong> generan código ejecutable. Usa <strong>JSON</strong> para guardar/restaurar en este editor.
            </span>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div className="px-6 py-3 bg-zinc-900/80 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          
          {/* Tabs */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveTab('vanilla')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'vanilla'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <FileCode size={14} />
              Three.js (Vanilla JS)
            </button>
            <button
              onClick={() => setActiveTab('r3f')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'r3f'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <Box size={14} />
              React Three Fiber (JSX)
            </button>
            <button
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'json'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              <FileJson size={14} />
              JSON de Proyecto
            </button>
          </div>

          {/* Export Settings */}
          {activeTab !== 'json' && (
            <div className="flex items-center gap-4 text-xs text-zinc-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportScope === 'selected'}
                  onChange={e => setExportScope(e.target.checked ? 'selected' : 'all')}
                  className="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0"
                />
                <span>Solo Seleccionados ({selectedObjectIds.length})</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAnimations}
                  onChange={e => setIncludeAnimations(e.target.checked)}
                  className="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0"
                />
                <span>Incluir Animaciones</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLights}
                  onChange={e => setIncludeLights(e.target.checked)}
                  className="rounded bg-zinc-800 border-zinc-700 text-indigo-600 focus:ring-0"
                />
                <span>Incluir Luces</span>
              </label>
            </div>
          )}
        </div>

        {/* Code Container */}
        <div className="flex-1 overflow-hidden relative bg-zinc-950 p-4 font-mono text-xs">
          <pre className="h-full overflow-auto text-zinc-300 leading-relaxed p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/80 selection:bg-indigo-600 selection:text-white">
            <code>{activeCode}</code>
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {objectsToExport.length} {objectsToExport.length === 1 ? 'objeto incluido' : 'objetos incluidos'}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              Cerrar
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95 ${
                copied
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
              }`}
            >
              {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copied ? '¡Código Copiado al Portapapeles!' : 'Copiar Código'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
