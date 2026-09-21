const fs = require('fs');
let code = fs.readFileSync('src/utils/volumetricRaymarch.ts', 'utf8');

code = code.replace(
`      // Sample 3D volumetric noise animated over time
      vec3 sampleCoord = (localPos * uCloudScale) + (uWind * uTime);
      float d = fbm(sampleCoord);`,
`      // Sample 3D volumetric noise animated over time
      vec3 sampleCoord = (localPos * uCloudScale) + (uWind * uTime);
      float d = fbm(sampleCoord);
      
      // Soft spherical falloff mask to remove hard cube edges
      float edgeMask = smoothstep(1.0, 0.1, length(localPos));
      d *= edgeMask;`
);

fs.writeFileSync('src/utils/volumetricRaymarch.ts', code);
