const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialStudioViewport.tsx', 'utf8');

code = code.replace(
`      // Volumetric Shader updates
      if (refs.currentMaterial && (refs.currentMaterial as any).isShaderMaterial) {
        const sm = refs.currentMaterial as THREE.ShaderMaterial;
        if (sm.uniforms?.uTime) sm.uniforms.uTime.value = elapsedTime;
        if (sm.uniforms?.uLightPosition && refs.keyLight) {
          sm.uniforms.uLightPosition.value.copy(refs.keyLight.position);
        }
      }`,
`      // Volumetric Shader updates
      if (refs.currentMaterial && (refs.currentMaterial as any).isShaderMaterial) {
        const sm = refs.currentMaterial as THREE.ShaderMaterial;
        if (sm.uniforms?.uTime) sm.uniforms.uTime.value = elapsedTime;
        if (sm.uniforms?.uLightPosition && refs.keyLight) {
          sm.uniforms.uLightPosition.value.copy(refs.keyLight.position);
        }
        if (sm.uniforms?.uModelInverse && refs.previewGroup) {
          let mesh = null;
          refs.previewGroup.traverse((child) => {
            if (child.isMesh) mesh = child;
          });
          if (mesh) {
            mesh.updateMatrixWorld();
            sm.uniforms.uModelInverse.value.copy(mesh.matrixWorld).invert();
          }
        }
      }`
);

fs.writeFileSync('src/components/MaterialStudioViewport.tsx', code);
