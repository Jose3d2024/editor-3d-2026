const fs = require('fs');
let code = fs.readFileSync('src/utils/volumetricRaymarch.ts', 'utf8');

code = code.replace(
`export function updateVolumetricUniforms(
  material: THREE.ShaderMaterial,
  config: Partial<VolumetricConfig>,
  time: number,
  lightPosition?: THREE.Vector3
) {`,
`export function updateVolumetricUniforms(
  material: THREE.ShaderMaterial,
  config: Partial<VolumetricConfig>,
  time: number,
  lightPosition?: THREE.Vector3,
  mesh?: THREE.Mesh
) {`
);

code = code.replace(
`  if (u.uTime) u.uTime.value = time;`,
`  if (u.uTime) u.uTime.value = time;
  if (u.uModelInverse && mesh) {
    u.uModelInverse.value.copy(mesh.matrixWorld).invert();
  }`
);

fs.writeFileSync('src/utils/volumetricRaymarch.ts', code);
