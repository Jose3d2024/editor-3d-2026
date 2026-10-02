import type { CSGObject, MeshFace, V3 } from '../types';
import type { OptimizationWorkerRequest, OptimizationWorkerResponse } from './optimizationWorker';

export interface WorkerOptimizationResult {
  vertices: V3[];
  faces: MeshFace[];
}

let nextRequestId = 1;

/**
 * Runs native mesh simplification outside the UI thread.
 * The worker is terminated after each request so stale jobs cannot keep
 * consuming CPU or memory after a new optimization starts.
 */
export function optimizeMeshInWorker(
  object: CSGObject,
  ratio: number,
): Promise<WorkerOptimizationResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./optimizationWorker.ts', import.meta.url),
      { type: 'module' }
    );

    const requestId = nextRequestId++;
    let settled = false;

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<OptimizationWorkerResponse>) => {
      const response = event.data;
      if (!response || response.id !== requestId || settled) return;

      settled = true;
      cleanup();

      if (!response.ok || !response.vertices || !response.faces) {
        reject(new Error(response.error || 'La optimización en segundo plano falló.'));
        return;
      }

      resolve({
        vertices: response.vertices,
        faces: response.faces,
      });
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'Error en el Worker de optimización.'));
    };

    const request: OptimizationWorkerRequest = {
      id: requestId,
      object,
      ratio: Math.max(0.01, Math.min(0.99, ratio)),
    };

    worker.postMessage(request);
  });
}
