import Module from 'manifold-3d/manifold.js';
import type { V3, MeshFace } from '../types';
import { repairMesh, fillHoles } from './meshUtils';

let manifoldModule: any = null;
let isInitializing = false;
let initPromise: Promise<any> | null = null;

export async function initManifold() {
  if (manifoldModule) return manifoldModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const initFn = Module as any;
      if (typeof initFn !== 'function') {
        return null;
      }
      const module = await initFn({
        locateFile: (url?: string) => {
          if (url && url.endsWith('.wasm')) {
            return '/manifold.wasm';
          }
          return '/manifold.wasm';
        }
      });
      if (module && typeof module.setup === 'function') {
        module.setup();
      }
      manifoldModule = module;
      return manifoldModule;
    } catch (err) {
      console.warn('Could not initialize Manifold WASM module with locateFile, trying default init:', err);
      try {
        const initFn = Module as any;
        if (typeof initFn !== 'function') return null;
        const module = await initFn();
        if (module && typeof module.setup === 'function') {
          module.setup();
        }
        manifoldModule = module;
        return manifoldModule;
      } catch (fallbackErr) {
        console.warn('Manifold WASM unavailable, fallback to native CSG operations:', fallbackErr);
        manifoldModule = null;
        return null;
      }
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Utiliza Manifold para "curar" una malla, asegurando que sea cerrada y sin errores.
 * Si Manifold no está disponible o falla, ejecuta la tubería de curado topológico nativo
 * (soldadura espacial, purga de degeneradas, sellado de orificios).
 */
export async function healMesh(
  vertices: V3[],
  faces: MeshFace[]
): Promise<{ vertices: V3[]; faces: MeshFace[]; report: string[] }> {
  if (!vertices || vertices.length === 0 || !faces || faces.length === 0) {
    return { vertices: vertices || [], faces: faces || [], report: ['Sin geometría para curar'] };
  }

  try {
    const manifold = await initManifold();
    if (manifold && manifold.Manifold) {
      // 1. Preparar datos para Manifold
      const vertArray = new Float32Array(vertices.flat());
      const triArray = new Uint32Array(faces.flatMap(f => {
        // Manifold solo acepta triángulos
        if (f.indices.length === 3) return f.indices;
        // Si no es triángulo, lo triangulamos (fan simple)
        const tris: number[] = [];
        for (let i = 1; i < f.indices.length - 1; i++) {
          tris.push(f.indices[0], f.indices[i], f.indices[i + 1]);
        }
        return tris;
      }));

      // 2. Crear objeto Manifold
      const mesh = {
        vertProperties: vertArray,
        triVerts: triArray,
        numProp: 3
      };

      const m = manifold.Manifold.fromMesh(mesh);

      // 3. Realizar limpieza y estanqueidad automática
      const cleanMesh = m.getMesh();

      // 4. Convertir de vuelta
      const outVerts: V3[] = [];
      for (let i = 0; i < cleanMesh.vertProperties.length; i += 3) {
        outVerts.push([cleanMesh.vertProperties[i], cleanMesh.vertProperties[i + 1], cleanMesh.vertProperties[i + 2]]);
      }

      const outFaces: MeshFace[] = [];
      for (let i = 0; i < cleanMesh.triVerts.length; i += 3) {
        outFaces.push({
          indices: [cleanMesh.triVerts[i], cleanMesh.triVerts[i + 1], cleanMesh.triVerts[i + 2]]
        });
      }

      // Limpiar memoria WASM
      m.delete();

      if (outVerts.length > 0 && outFaces.length > 0) {
        return {
          vertices: outVerts,
          faces: outFaces,
          report: [`Curado Manifold WASM: sólido estanco consolidado (${outFaces.length} caras, ${outVerts.length} vértices)`]
        };
      }
    }
  } catch (error) {
    console.warn('Manifold heal WASM failed, applying native topological healing:', error);
  }

  // Tubería de curado nativo de alta precisión
  const welded = repairMesh({ vertices, faces }, 0.0005);
  const filled = fillHoles(welded);
  const finalRepaired = repairMesh({ vertices: filled.vertices, faces: filled.faces }, 0.0001);

  return {
    vertices: finalRepaired.vertices,
    faces: finalRepaired.faces,
    report: [
      `Curado topológico completado:`,
      `- Vértices soldados y agujeros sellados`,
      `- ${finalRepaired.vertices.length} vértices, ${finalRepaired.faces.length} caras limpias`
    ]
  };
}
