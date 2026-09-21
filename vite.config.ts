import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      // CRÍTICO: una sola instancia de Three.js, React y React-DOM en toda la app.
      // Sin dedupe: three-gpu-pathtracer, three-bvh-csg, three-csg-ts resuelven
      // su propio 'three' → dos instancias → "not an instance of THREE.Object3D"
      // + crash de hooks de React.
      dedupe: ['three', 'react', 'react-dom'],
      alias: {
        '@':         path.resolve(__dirname, '.'),
        'three':     path.resolve(__dirname, 'node_modules/three'),
        'react':     path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      },
    },
    optimizeDeps: {
      // Pre-bundlear TODOS estos en el arranque inicial para que Vite no los
      // descubra mid-session (lo que causa un reload que crea dos instancias de React).
      include: [
        'three',
        'three-gpu-pathtracer',
        'three/examples/jsm/loaders/RGBELoader',
        'three/examples/jsm/loaders/GLTFLoader',
        'three/examples/jsm/loaders/STLLoader',
        'three/examples/jsm/loaders/OBJLoader',
        'three/examples/jsm/loaders/DRACOLoader',
        'three/examples/jsm/loaders/FontLoader',
        'three/examples/jsm/geometries/TextGeometry',
        'three/examples/jsm/environments/RoomEnvironment',
        'three/examples/jsm/exporters/GLTFExporter',
        'three/examples/jsm/exporters/STLExporter',
        'three/examples/jsm/exporters/OBJExporter',
        'three/examples/jsm/controls/OrbitControls',
        'three/examples/jsm/controls/TransformControls',
        'three/examples/jsm/utils/SkeletonUtils',
        'three/examples/jsm/postprocessing/Pass',
      ],
      // Excluir solo los que tienen WASM o workers nativos que Vite no puede pre-bundlear
      exclude: ['three-bvh-csg', 'three-csg-ts', 'three-mesh-bvh', 'manifold-3d'],
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});