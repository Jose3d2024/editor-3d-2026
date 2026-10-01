import * as THREE from 'three';

/**
 * Known texture property keys on standard, physical, and custom Three.js materials.
 */
const TEXTURE_PROPERTY_KEYS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'gradientMap',
] as const;

/**
 * Safely disposes of a BufferGeometry and its attributes, unless marked as shared.
 */
export function disposeGeometry(geometry?: THREE.BufferGeometry | null): void {
  if (!geometry || geometry.userData?.isShared) return;
  try {
    geometry.dispose();
  } catch (err) {
    console.warn('[disposeUtils] Error disposing geometry:', err);
  }
}

/**
 * Safely disposes of a Texture, unless marked as shared.
 */
export function disposeTexture(texture?: THREE.Texture | null): void {
  if (!texture || texture.userData?.isShared) return;
  try {
    if (typeof texture.dispose === 'function') {
      texture.dispose();
    }
  } catch (err) {
    console.warn('[disposeUtils] Error disposing texture:', err);
  }
}

/**
 * Safely disposes of a Material (or array of Materials), including all attached non-shared textures and uniforms.
 */
export function disposeMaterial(material?: THREE.Material | THREE.Material[] | null): void {
  if (!material) return;

  const materials = Array.isArray(material) ? material : [material];

  materials.forEach((mat) => {
    if (!mat || mat.userData?.isShared) return;

    try {
      // 1. Dispose known texture properties (skip shared textures)
      const m = mat as any;
      TEXTURE_PROPERTY_KEYS.forEach((key) => {
        if (m[key] && !m[key].userData?.isShared && typeof m[key].dispose === 'function') {
          m[key].dispose();
        }
      });

      // 2. Dispose any custom texture properties attached to the material
      Object.keys(m).forEach((k) => {
        const val = m[k];
        if (val && val.isTexture && !val.userData?.isShared && typeof val.dispose === 'function') {
          val.dispose();
        }
      });

      // 3. Dispose shader uniforms textures if present
      if (m.uniforms) {
        Object.values(m.uniforms).forEach((u: any) => {
          if (u && u.value && !u.value.userData?.isShared) {
            if (u.value.isTexture && typeof u.value.dispose === 'function') {
              u.value.dispose();
            } else if (u.value.isRenderTarget && typeof u.value.dispose === 'function') {
              u.value.dispose();
            }
          }
        });
      }

      // 4. Dispose material itself
      mat.dispose();
    } catch (err) {
      console.warn('[disposeUtils] Error disposing material:', err);
    }
  });
}

/**
 * Recursively disposes of an Object3D, including its geometry, materials, textures, and all child objects.
 */
export function disposeObject(obj?: THREE.Object3D | null, preserveChildren: boolean = false): void {
  if (!obj) return;

  // 1. Dispose child objects first if not preserving
  if (!preserveChildren && obj.children && obj.children.length > 0) {
    // Copy array because child.remove() mutates children
    const children = [...obj.children];
    children.forEach((child) => {
      disposeObject(child, false);
      if (child.parent) {
        child.parent.remove(child);
      }
    });
  }

  // 2. Skip disposing if this object is explicitly marked as shared singleton
  if (obj.userData?.isShared) return;

  // 3. Dispose Mesh / Line / Points / Sprite resources
  const mesh = obj as THREE.Mesh;
  if (mesh.geometry && !mesh.geometry.userData?.isShared) {
    disposeGeometry(mesh.geometry);
  }
  if (mesh.material) {
    disposeMaterial(mesh.material);
  }

  // 4. Dispose special helpers (SkeletonHelper, LightHelper, etc.)
  const helper = obj as any;
  if (helper.skeleton) {
    helper.skeleton.dispose?.();
  }
  if (helper.dispose && typeof helper.dispose === 'function' && helper !== obj) {
    try {
      helper.dispose();
    } catch (_) {}
  }
}

/**
 * Deeply disposes and removes all children of a Group or Scene, leaving the root object clean and empty.
 */
export function disposeHierarchy(root?: THREE.Object3D | null): void {
  if (!root) return;
  const children = [...root.children];
  children.forEach((child) => {
    disposeObject(child, false);
    root.remove(child);
  });
}
