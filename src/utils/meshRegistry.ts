import * as THREE from 'three';
import { useStore } from '../store/useStore';
import { createBaseGeometry } from './csg';

const meshRegistry = new Map<string, THREE.Mesh[]>();

export function registerMeshes(id: string, meshes: THREE.Mesh[]): void {
  if (!id) return;
  meshRegistry.set(id, meshes);
}

export function unregisterMeshes(id: string): void {
  meshRegistry.delete(id);
}

export function setRegistry(newRegistry: Map<string, THREE.Mesh[]>): void {
  meshRegistry.clear();
  newRegistry.forEach((v, k) => meshRegistry.set(k, v));
}

export function getMeshes(id: string | null | undefined): THREE.Mesh[] {
  if (!id) return [];
  const registered = meshRegistry.get(id);
  if (registered && registered.length > 0) {
    return registered;
  }
  // Fallback resiliente: si el registro no se ha poblado todavía desde el viewport,
  // generamos la malla Three.js directamente desde los datos paramétricos o CSG del store.
  const state = useStore.getState();
  const obj = state.project.objects.find((o) => o.id === id);
  if (!obj) return [];

  try {
    const geo = createBaseGeometry(obj);
    if (geo && geo.getAttribute('position')) {
      const mat = new THREE.MeshStandardMaterial({ color: obj.color || 0xcccccc });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = obj.name || obj.id;
      mesh.position.set(...obj.transform.position);
      mesh.rotation.set(...obj.transform.rotation);
      mesh.scale.set(...obj.transform.scale);
      mesh.updateMatrixWorld(true);
      return [mesh];
    }
  } catch (err) {
    console.warn('[meshRegistry] Fallback getMeshes warning:', err);
  }

  return [];
}

export function getMesh(id: string | null | undefined): THREE.Mesh | null {
  const meshes = getMeshes(id);
  return meshes.length > 0 ? meshes[0] : null;
}
