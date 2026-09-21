const fs = require('fs');
const path = './src/components/RenderModal.tsx';
let content = fs.readFileSync(path, 'utf8');

const target = `  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
  scene.background = new THREE.Color('#9db8e0');`;

const replacement = `  // const sky = new THREE.Mesh(skyGeo, skyMat);
  // scene.add(sky);
  // scene.background = new THREE.Color('#9db8e0');`;

content = content.replace(target, replacement);

const target2 = `  scene.environment = envTex;
  scene.environmentIntensity = intensity;`;

const replacement2 = `  scene.environment = envTex;
  scene.background = envTex;
  scene.backgroundBlurriness = 0.02;
  scene.environmentIntensity = intensity;`;

content = content.replace(target2, replacement2);

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed RenderModal.tsx');
