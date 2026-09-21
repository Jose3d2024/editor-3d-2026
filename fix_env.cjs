const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialStudioViewport.tsx', 'utf8');

code = code.replace(
`  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);`,
`  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [showEnvironment, setShowEnvironment] = useState<boolean>(false);`
);

code = code.replace(
`    const renderTarget = pmremGenerator.fromScene(envScene);
    scene.environment = renderTarget.texture;`,
`    const renderTarget = pmremGenerator.fromScene(envScene);
    scene.environment = renderTarget.texture;
    scene.background = new THREE.Color('#0a0a0c'); // Initial background`
);

code = code.replace(
`  // Update Grid & Wireframe visibility
  useEffect(() => {
    const refs = threeRefs.current;
    if (!refs) return;
    refs.gridHelper.visible = showGrid;
    if (refs.currentMaterial && 'wireframe' in refs.currentMaterial) {
      (refs.currentMaterial as any).wireframe = showWireframe;
    }
  }, [showGrid, showWireframe]);`,
`  // Update Grid & Wireframe & Environment visibility
  useEffect(() => {
    const refs = threeRefs.current;
    if (!refs) return;
    refs.gridHelper.visible = showGrid;
    if (refs.currentMaterial && 'wireframe' in refs.currentMaterial) {
      (refs.currentMaterial as any).wireframe = showWireframe;
    }
    if (showEnvironment) {
      refs.scene.background = refs.scene.environment;
    } else {
      refs.scene.background = new THREE.Color('#0a0a0c');
    }
  }, [showGrid, showWireframe, showEnvironment]);`
);

code = code.replace(
`            {/* Grid Toggle */}
            <button
              onClick={() => setShowGrid((v) => !v)}`,
`            {/* Background Environment Toggle */}
            <button
              onClick={() => setShowEnvironment((v) => !v)}
              className={"p-1.5 rounded-xl text-[10px] font-bold transition-all " + (showEnvironment ? "bg-zinc-700 text-indigo-300" : "text-zinc-500 hover:text-zinc-300")}
              title="Mostrar mapa HDRI"
            >
              <Globe size={13} />
            </button>
            
            {/* Grid Toggle */}
            <button
              onClick={() => setShowGrid((v) => !v)}`
);

// We need to import Globe if not imported
if (!code.includes('Globe')) {
    code = code.replace(`import { ArrowLeft, Box, Download, RefreshCw, Sun, Copy, Layers } from 'lucide-react';`, `import { ArrowLeft, Box, Download, RefreshCw, Sun, Copy, Layers, Globe } from 'lucide-react';`);
}

fs.writeFileSync('src/components/MaterialStudioViewport.tsx', code);
