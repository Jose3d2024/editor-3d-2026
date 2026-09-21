const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialStudioViewport.tsx', 'utf8');

code = code.replace(
`    } else if (type === 'VOLUME') {
      // Volume Cloud container cube
      const geom = new THREE.BoxGeometry(2.2, 2.2, 2.2);
      const mesh = new THREE.Mesh(geom, material);
      group.add(mesh);
    }`,
`    } else if (type === 'VOLUME') {
      // Volume Cloud container cube
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geom, material);
      mesh.scale.set(2.2, 2.2, 2.2);
      group.add(mesh);
    }`
);

fs.writeFileSync('src/components/MaterialStudioViewport.tsx', code);
