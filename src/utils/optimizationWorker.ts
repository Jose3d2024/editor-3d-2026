import type { CSGObject, MeshFace, V3 } from '../types';
import { optimizeMesh } from './modifiers';

export interface OptimizationWorkerRequest {
  id: number;
  object: CSGObject;
  ratio: number;
}

export interface OptimizationWorkerResponse {
  id: number;
  ok: boolean;
  vertices?: V3[];
  faces?: MeshFace[];
  error?: string;
}

self.onmessage = (event: MessageEvent<OptimizationWorkerRequest>) => {
  const { id, object, ratio } = event.data;

  try {
    const result = optimizeMesh(object, ratio);
    const response: OptimizationWorkerResponse = {
      id,
      ok: true,
      vertices: result.vertices,
      faces: result.faces,
    };
    self.postMessage(response);
  } catch (error) {
    const response: OptimizationWorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export {};
