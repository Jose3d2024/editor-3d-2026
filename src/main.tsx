import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installGlobalNumberSafetyShims } from './utils/numberUtils';

// Instala protecciones globales contra crashes de .toFixed() en Electron/Windows
installGlobalNumberSafetyShims();

// Suppress specific deprecation warnings from dependencies
const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string') {
    if (args[0].includes('THREE.Clock: This module has been deprecated')) return;
    if (args[0].includes('MeshBVH: "maxLeafTris" option has been deprecated')) return;
  }
  originalWarn(...args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
