import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
// @ts-ignore
// @ts-ignore
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CSGObject, Project, MaterialData } from '../types';
import { createBaseGeometry } from './csg';
import { createWireframeTubesGeometry, type WireframeOptions } from './wireframeMesh';

/**
 * Utility to export the current project or selected objects to various formats.
 */
export class Exporter {
  /**
   * Converts a CSGObject to a THREE.Object3D with its material and textures.
   */
  static async objectToObject3D(obj: CSGObject, projectMaterials: MaterialData[] = [], forceWireframeTubes: boolean = false, wireframeOptions?: WireframeOptions): Promise<THREE.Object3D> {
    // Resolve material: priority is inline material > materialId > default
    const referencedMaterial = obj.materialId ? projectMaterials.find(m => m.id === obj.materialId) : null;
    
    // Cleanly resolve material data
    const m = (referencedMaterial
      ? { ...referencedMaterial, ...(obj.material && (obj.material as any).userModified ? obj.material : {}) }
      : (obj.material || {})) as any;

    let customMaterial: THREE.Material | null = null;
    if (obj.materialId || Object.keys(obj.material || {}).length > 0 || (obj.color && obj.color !== '#ffffff') || (obj.opacity !== undefined && obj.opacity !== 1)) {
      const opacity = obj.opacity ?? 1;
      const matParams: any = {
        color: new THREE.Color(m.color || obj.color || '#4ade80'),
        transparent: (m.transparent !== undefined ? m.transparent : (opacity < 1 || m.opacity < 1)),
        opacity: m.opacity !== undefined ? m.opacity : opacity,
        side: THREE.DoubleSide,
        flatShading: !obj.smoothShading,
        roughness: m.roughness ?? 0.5,
        metalness: m.metalness ?? 0,
        emissive: new THREE.Color(m.emissive || '#000000'),
        emissiveIntensity: m.emissiveIntensity ?? 1,
      };

      if (m.transmission !== undefined) matParams.transmission = m.transmission;
      if (m.ior !== undefined) matParams.ior = m.ior;
      if (m.thickness !== undefined) matParams.thickness = m.thickness;

      customMaterial = (m.transmission !== undefined || m.thickness !== undefined) 
        ? new THREE.MeshPhysicalMaterial(matParams)
        : new THREE.MeshStandardMaterial(matParams);

      const loader = new THREE.TextureLoader();
      const loadTexture = (url: string) => new Promise<THREE.Texture | null>((resolve) => {
        if (!url) return resolve(null);
        loader.load(
          url, 
          (tex) => {
            tex.flipY = m.flipY ?? true;
            resolve(tex);
          },
          undefined,
          () => {
            console.warn(`Failed to load texture: ${url}`);
            resolve(null);
          }
        );
      });

      const mat = customMaterial as any;
      if (m.map) { const tex = await loadTexture(m.map); if (tex) mat.map = tex; }
      if (m.normalMap) {
        const tex = await loadTexture(m.normalMap);
        if (tex) {
          mat.normalMap = tex;
          if (m.normalScale !== undefined) mat.normalScale = new THREE.Vector2(m.normalScale, m.normalScale);
        }
      }
      if (m.roughnessMap) { const tex = await loadTexture(m.roughnessMap); if (tex) mat.roughnessMap = tex; }
      if (m.metalnessMap) { const tex = await loadTexture(m.metalnessMap); if (tex) mat.metalnessMap = tex; }
      if (m.aoMap) {
        const tex = await loadTexture(m.aoMap);
        if (tex) {
          mat.aoMap = tex;
          if (m.aoMapIntensity !== undefined) mat.aoMapIntensity = m.aoMapIntensity;
        }
      }
      if (m.emissiveMap) { const tex = await loadTexture(m.emissiveMap); if (tex) mat.emissiveMap = tex; }
      if (m.alphaMap) { const tex = await loadTexture(m.alphaMap); if (tex) mat.alphaMap = tex; }
      if (m.displacementMap) {
        const tex = await loadTexture(m.displacementMap);
        if (tex) {
          mat.displacementMap = tex;
          if (m.displacementScale !== undefined) mat.displacementScale = m.displacementScale;
        }
      }
    }

    let object3D: THREE.Object3D;
    let originalAnimations: THREE.AnimationClip[] = [];

    const shouldConvertToTubes = forceWireframeTubes || (obj.wireframeAsTubes === true && wireframeOptions?.mode !== 'LINES');

    if (shouldConvertToTubes && !obj.meshData) {
      // Generar tubos 3D sólidos solo si se especificó la opción de tubos 3D
      const wireGeo = createWireframeTubesGeometry(obj, wireframeOptions || { radius: 0.035, radialSegments: 6, addJointSpheres: true });
      object3D = new THREE.Mesh(wireGeo, customMaterial || new THREE.MeshStandardMaterial({ color: obj.color || '#4ade80', roughness: 0.3 }));
    } else if (obj.meshData) {
      try {
        if (obj.meshData.type === 'gltf') {
          const loader = new GLTFLoader();
          const dracoLoader = new DRACOLoader();
          dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
          loader.setDRACOLoader(dracoLoader);
          loader.setMeshoptDecoder(MeshoptDecoder);
          const gltf = await new Promise<any>((resolve, reject) => loader.load(obj.meshData!.data, resolve, undefined, reject));
          object3D = gltf.scene;
          if (gltf.animations) {
            originalAnimations = gltf.animations;
          }
        } else if (obj.meshData.type === 'obj') {
          object3D = await new Promise<THREE.Object3D>((resolve, reject) => new OBJLoader().load(obj.meshData!.data, resolve, undefined, reject));
        } else if (obj.meshData.type === 'stl') {
          const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => new STLLoader().load(obj.meshData!.data, resolve, undefined, reject));
          object3D = new THREE.Mesh(geometry, customMaterial || new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' }));
        } else {
          const geometry = createBaseGeometry(obj);
          object3D = new THREE.Mesh(geometry, customMaterial || new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' }));
        }
        
        if (customMaterial && obj.meshData.type !== 'stl') {
          object3D.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).material = customMaterial!;
            }
          });
        }
      } catch (error) {
        console.error(`Failed to load meshData for object ${obj.id}:`, error);
        const geometry = createBaseGeometry(obj);
        object3D = new THREE.Mesh(geometry, customMaterial || new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' }));
      }
    } else if (!obj.faces || obj.faces.length === 0) {
      // Objeto alámbrico / trazado / curva: exportar como líneas reales de la escena
      const posArr: number[] = [];
      const verts = obj.vertices || [];
      if (obj.edges && obj.edges.length > 0) {
        obj.edges.forEach(([i1, i2]) => {
          const v1 = verts[i1], v2 = verts[i2];
          if (v1 && v2) {
            const off1 = obj.vertexOffsets?.[i1] || [0, 0, 0];
            const off2 = obj.vertexOffsets?.[i2] || [0, 0, 0];
            posArr.push(v1[0] + off1[0], v1[1] + off1[1], v1[2] + off1[2]);
            posArr.push(v2[0] + off2[0], v2[1] + off2[1], v2[2] + off2[2]);
          }
        });
      } else if (verts.length > 1) {
        for (let i = 0; i < verts.length; i++) {
          const next = (i + 1) % verts.length;
          if (!obj.parameters?.closed && i === verts.length - 1) break;
          const v1 = verts[i], v2 = verts[next];
          const off1 = obj.vertexOffsets?.[i] || [0, 0, 0];
          const off2 = obj.vertexOffsets?.[next] || [0, 0, 0];
          posArr.push(v1[0] + off1[0], v1[1] + off1[1], v1[2] + off1[2]);
          posArr.push(v2[0] + off2[0], v2[1] + off2[1], v2[2] + off2[2]);
        }
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
      object3D = new THREE.LineSegments(
        lineGeo,
        new THREE.LineBasicMaterial({ color: obj.color || '#4ade80' })
      );
    } else {
      const geometry = createBaseGeometry(obj);
      object3D = new THREE.Mesh(geometry, customMaterial || new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' }));
    }
    
    // Apply transform
    object3D.position.set(...obj.transform.position);
    object3D.rotation.set(...obj.transform.rotation);
    object3D.scale.set(...obj.transform.scale);
    object3D.name = obj.id;
    object3D.updateMatrixWorld(true);

    // Attach animations to userData so exportGLTF can access them
    object3D.userData.originalAnimations = originalAnimations;

    return object3D;
  }

  /**
   * Exports objects to GLTF/GLB
   */
  static async exportGLTF(objects: CSGObject[], projectMaterials: MaterialData[], binary: boolean = true, baseFilename: string = 'export') {
    const scene = new THREE.Scene();
    const animations: THREE.AnimationClip[] = [];
    const tracks: THREE.KeyframeTrack[] = [];

    for (const obj of objects) {
      const object3D = await this.objectToObject3D(obj, projectMaterials);
      scene.add(object3D);

      if (object3D.userData.originalAnimations) {
        animations.push(...object3D.userData.originalAnimations);
      }

      if (obj.keyframes && obj.keyframes.length > 0) {
        // Sort keyframes by time just in case
        const sortedKeyframes = [...obj.keyframes].sort((a, b) => a.time - b.time);
        const times = sortedKeyframes.map(k => k.time);
        
        // Position track
        const positions = sortedKeyframes.flatMap(k => k.transform.position);
        tracks.push(new THREE.VectorKeyframeTrack(`${object3D.name}.position`, times, positions));

        // Rotation track (Quaternion)
        const quaternions = sortedKeyframes.flatMap(k => {
          const euler = new THREE.Euler(...k.transform.rotation);
          const q = new THREE.Quaternion().setFromEuler(euler);
          return [q.x, q.y, q.z, q.w];
        });
        tracks.push(new THREE.QuaternionKeyframeTrack(`${object3D.name}.quaternion`, times, quaternions));

        // Scale track
        const scales = sortedKeyframes.flatMap(k => k.transform.scale);
        tracks.push(new THREE.VectorKeyframeTrack(`${object3D.name}.scale`, times, scales));
      }
    }

    if (tracks.length > 0) {
      animations.push(new THREE.AnimationClip('ProjectAnimation', -1, tracks));
    }

    scene.updateMatrixWorld(true);

    const exporter = new GLTFExporter();
    const options: any = { binary, includeCustomExtensions: true };
    if (animations.length > 0) {
      options.animations = animations;
    }

    const cleanName = baseFilename.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';

    exporter.parse(
      scene,
      (gltf) => {
        const output = binary ? (gltf as ArrayBuffer) : JSON.stringify(gltf, null, 2);
        const blob = new Blob([output], { type: binary ? 'application/octet-stream' : 'application/json' });
        this.saveBlob(blob, `${cleanName}.${binary ? 'glb' : 'gltf'}`);
      },
      (error) => {
        console.error('Error exporting GLTF', error);
      },
      options
    );
  }

  /**
   * Exports objects to OBJ
   */
  static async exportOBJ(objects: CSGObject[], projectMaterials: MaterialData[], baseFilename: string = 'export') {
    const scene = new THREE.Scene();
    for (const obj of objects) {
      const object3D = await this.objectToObject3D(obj, projectMaterials);
      scene.add(object3D);
    }

    scene.updateMatrixWorld(true);

    const cleanName = baseFilename.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
    const exporter = new OBJExporter();
    const result = exporter.parse(scene);
    const blob = new Blob([result], { type: 'text/plain' });
    this.saveBlob(blob, `${cleanName}.obj`);
  }

  /**
   * Exports objects to STL
   */
  static async exportSTL(objects: CSGObject[], projectMaterials: MaterialData[], baseFilename: string = 'export') {
    const scene = new THREE.Scene();
    for (const obj of objects) {
      const object3D = await this.objectToObject3D(obj, projectMaterials);
      scene.add(object3D);
    }

    scene.updateMatrixWorld(true);

    const cleanName = baseFilename.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'export';
    const exporter = new STLExporter();
    const result = exporter.parse(scene, { binary: true });
    const blob = new Blob([result], { type: 'application/octet-stream' });
    this.saveBlob(blob, `${cleanName}.stl`);
  }

  /**
   * Exports objects explicitly as 3D Wireframe / Celosía Tubular in STL, OBJ or GLTF/GLB
   */
  static async exportWireframe(
    objects: CSGObject[],
    projectMaterials: MaterialData[],
    format: 'STL' | 'OBJ' | 'GLTF' | 'GLB' = 'STL',
    options?: WireframeOptions
  ) {
    const scene = new THREE.Scene();
    for (const obj of objects) {
      const object3D = await this.objectToObject3D(obj, projectMaterials, true, options);
      scene.add(object3D);
    }
    scene.updateMatrixWorld(true);

    if (format === 'STL') {
      const exporter = new STLExporter();
      const result = exporter.parse(scene, { binary: true });
      const blob = new Blob([result], { type: 'application/octet-stream' });
      this.saveBlob(blob, `wireframe_export.stl`);
    } else if (format === 'OBJ') {
      const exporter = new OBJExporter();
      const result = exporter.parse(scene);
      const blob = new Blob([result], { type: 'text/plain' });
      this.saveBlob(blob, `wireframe_export.obj`);
    } else if (format === 'GLTF' || format === 'GLB') {
      const binary = format === 'GLB';
      const exporter = new GLTFExporter();
      exporter.parse(
        scene,
        (gltf) => {
          const output = binary ? (gltf as ArrayBuffer) : JSON.stringify(gltf, null, 2);
          const blob = new Blob([output], { type: binary ? 'application/octet-stream' : 'application/json' });
          this.saveBlob(blob, `wireframe_export.${binary ? 'glb' : 'gltf'}`);
        },
        (error) => {
          console.error('Error exporting Wireframe GLTF', error);
        },
        { binary }
      );
    }
  }

  /**
   * Helper to trigger a browser download
   */
  private static saveBlob(blob: Blob, filename: string) {
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    document.body.removeChild(link);
  }
}
