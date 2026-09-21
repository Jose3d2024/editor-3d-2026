const fs = require('fs');
let code = fs.readFileSync('src/utils/volumetricRaymarch.ts', 'utf8');

code = code.replace(
`      // Stop ray if it exits the container [-0.5, 0.5]
      if (abs(localPos.x) > 0.5 || abs(localPos.y) > 0.5 || abs(localPos.z) > 0.5) {
        break;
      }`,
`      // Fade out instead of hard clipping bounds
      float dist = length(localPos);
      if (dist > 1.5) {
        break; // Far outside
      }`
);

// We need to fix both places if there are two (light ray and eye ray)
code = code.replace(
`      // Stop if ray exits the bounding box [-0.5, 0.5]
      if (abs(currentPos.x) > 0.5 || abs(currentPos.y) > 0.5 || abs(currentPos.z) > 0.5) {
        break;
      }`,
`      // Fade out light ray
      vec3 lightLocalPos = (uModelInverse * vec4(currentPos, 1.0)).xyz;
      if (length(lightLocalPos) > 1.5) {
        break;
      }`
);

fs.writeFileSync('src/utils/volumetricRaymarch.ts', code);
