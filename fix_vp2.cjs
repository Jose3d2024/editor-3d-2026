const fs = require('fs');
let code = fs.readFileSync('src/components/Viewport.tsx', 'utf8');

code = code.replace(
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

          // 1. Actualizar OrbitControls si no es la vista de la cámara activa`,
`        if (currentRenderer && currentCamera && currentScene) {
          // 1. Actualizar OrbitControls si no es la vista de la cámara activa`
);

code = code.replace(
`            // 4. Actualizar la posición de la cámara y uniforms en materiales de paralaje y shaders volumétricos
            const elapsedTime = performance.now() * 0.001;`,
`            // 4. Actualizar la posición de la cámara y uniforms en materiales de paralaje y shaders volumétricos
            const elapsedTime = clock.getElapsedTime();`
);

code = code.replace(
`            currentScene.traverse((child) => {
              if (child instanceof THREE.Mesh) {`,
`            currentScene.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                // Volumetric Matrix updates
                if (child.material && child.material.userData?.isVolumetric) {
                  if (child.material.uniforms?.uModelInverse) {
                    child.updateMatrixWorld();
                    child.material.uniforms.uModelInverse.value.copy(child.matrixWorld).invert();
                  }
                }`
);

fs.writeFileSync('src/components/Viewport.tsx', code);
