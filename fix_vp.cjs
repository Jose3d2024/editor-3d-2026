const fs = require('fs');
let code = fs.readFileSync('src/components/Viewport.tsx', 'utf8');

code = code.replace(
`  // ── 1.5 Animation Loop ───────────────────────────────────────────────────
  useEffect(() => {
    let id: number;
    const animate = () => {`,
`  // ── 1.5 Animation Loop ───────────────────────────────────────────────────
  useEffect(() => {
    let id: number;
    const clock = new THREE.Clock();
    const animate = () => {`
);

code = code.replace(
`        if (currentRenderer && currentCamera && currentScene) {
          // 1. Actualizar OrbitControls si no es la vista de la cámara activa`,
`        if (currentRenderer && currentCamera && currentScene) {
          // 0. Update Volumetric Raymarching Uniforms
          const elapsedTime = clock.getElapsedTime();
          currentScene.traverse((child) => {
            if (child.isMesh && child.material && child.material.userData?.isVolumetric) {
              const sm = child.material;
              if (sm.uniforms?.uTime) sm.uniforms.uTime.value = elapsedTime;
              if (sm.uniforms?.uModelInverse) {
                child.updateMatrixWorld();
                sm.uniforms.uModelInverse.value.copy(child.matrixWorld).invert();
              }
            }
          });

          // 1. Actualizar OrbitControls si no es la vista de la cámara activa`
);

fs.writeFileSync('src/components/Viewport.tsx', code);
