const fs = require('fs');
let code = fs.readFileSync('src/utils/volumetricRaymarch.ts', 'utf8');

code = code.replace(
`      // Soft spherical falloff mask to remove hard cube edges
      float edgeMask = smoothstep(1.0, 0.1, length(localPos));`,
`      // Soft spherical falloff mask to remove hard cube edges (fits inside 1x1x1 box bounds)
      float edgeMask = smoothstep(0.7, 0.4, length(localPos));`
);

fs.writeFileSync('src/utils/volumetricRaymarch.ts', code);
