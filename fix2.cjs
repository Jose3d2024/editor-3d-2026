const fs = require('fs');
let code = fs.readFileSync('src/utils/volumetricRaymarch.ts', 'utf8');

code = code.replace(
`export const volumetricFragmentShader = \``,
`export const volumetricFragmentShader = \`
  uniform mat4 uModelInverse;`
);

code = code.replace(
`    vec3 currentLocalPos = vLocalPosition;`,
`    vec3 currentWorldPos = vWorldPosition;`
);

code = code.replace(
`    // Adaptive step length based on step count
    float stepLength = 1.0 / float(max(uSteps, 16));
    vec3 stepVector = rayDirection * stepLength;

    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;

      // Stop ray if it exits the container [-0.5, 0.5]
      if (abs(currentLocalPos.x) > 0.5 || abs(currentLocalPos.y) > 0.5 || abs(currentLocalPos.z) > 0.5) {
        break;
      }

      // Sample 3D volumetric noise animated over time
      vec3 sampleCoord = (currentLocalPos * uCloudScale) + (uWind * uTime);`,
`    // Adaptive step length based on step count (scaled by bounds)
    float stepLength = 3.0 / float(max(uSteps, 16));
    vec3 stepVector = rayDirection * stepLength;

    for (int i = 0; i < 64; i++) {
      if (i >= uSteps) break;

      vec3 localPos = (uModelInverse * vec4(currentWorldPos, 1.0)).xyz;
      // Stop ray if it exits the container [-0.5, 0.5]
      if (abs(localPos.x) > 0.5 || abs(localPos.y) > 0.5 || abs(localPos.z) > 0.5) {
        break;
      }

      // Sample 3D volumetric noise animated over time
      vec3 sampleCoord = (localPos * uCloudScale) + (uWind * uTime);`
);

code = code.replace(
`      currentLocalPos += stepVector;`,
`      currentWorldPos += stepVector;`
);

code = code.replace(
`    uWind: {`,
`    uModelInverse: { value: new THREE.Matrix4() },
    uWind: {`
);

fs.writeFileSync('src/utils/volumetricRaymarch.ts', code);
