const fs = require('fs');
let code = fs.readFileSync('src/components/MaterialStudioViewport.tsx', 'utf8');

code = code.replace(
`  // State for Viewport`,
`  const animState = useRef({ turntable: true, speed: 0.6 });
  useEffect(() => {
    animState.current.turntable = isTurntableActive;
    animState.current.speed = turntableSpeed;
  }, [isTurntableActive, turntableSpeed]);

  // State for Viewport`
);

code = code.replace(
`      // Turntable rotation
      if (isTurntableActive && refs.previewGroup) {
        refs.previewGroup.rotation.y += delta * turntableSpeed;
      }`,
`      // Turntable rotation
      if (animState.current.turntable && refs.previewGroup) {
        refs.previewGroup.rotation.y += delta * animState.current.speed;
      }`
);

fs.writeFileSync('src/components/MaterialStudioViewport.tsx', code);
