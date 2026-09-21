import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSGObject, V3, MeshFace } from '../types';
import { smoothMesh, subdivideMesh } from './modifiers';
import { computeSmoothNormalsByPosition, dissolveCoplanarFaces } from './meshUtils';
import { limitedDissolveGeometry } from './limitedDissolve';

import { MeshoptSimplifier as Meshopt, MeshoptDecoder } from 'meshoptimizer';

export async function processGLBMeshes(
  obj: CSGObject,
  processor: (vertices: V3[], faces: MeshFace[]) => { vertices: V3[]; faces: MeshFace[] }
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    const gltf = await new Promise<any>((resolve, reject) => 
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let modified = false;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        
        // Merge un-welded vertices first so faces share vertices correctly
        if (geometry.attributes.position) {
          try {
            geometry = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
            mesh.geometry = geometry;
          } catch (e) {
            // keep original geometry if merge fails
          }
        }

        const posAttr = geometry.getAttribute('position');
        const indexAttr = geometry.index;
        
        if (posAttr) {
          const vertices: V3[] = [];
          for (let i = 0; i < posAttr.count; i++) {
            vertices.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
          }
          
          const faces: MeshFace[] = [];
          if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i += 3) {
              faces.push({ indices: [indexAttr.getX(i), indexAttr.getX(i+1), indexAttr.getX(i+2)] });
            }
          } else {
            for (let i = 0; i < posAttr.count; i += 3) {
              faces.push({ indices: [i, i+1, i+2] });
            }
          }

          const result = processor(vertices, faces);
          
          if (result && (result.vertices.length !== vertices.length || result.faces.length !== faces.length || result.vertices !== vertices)) {
            const newPos = new Float32Array(result.vertices.length * 3);
            result.vertices.forEach((v, i) => {
              newPos[i*3] = v[0];
              newPos[i*3+1] = v[1];
              newPos[i*3+2] = v[2];
            });
            
            if (result.vertices.length === vertices.length && result.faces.length === faces.length) {
              // Only positions changed (e.g. smoothing)
              geometry.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
              geometry.computeVertexNormals();
              modified = true;
            } else {
              // Topology changed (e.g. subdivision)
              const newIndices = [];
              for (const f of result.faces) {
                if (f.indices.length === 3) {
                  newIndices.push(f.indices[0], f.indices[1], f.indices[2]);
                } else {
                  // Triangulate if needed
                  for (let i = 1; i < f.indices.length - 1; i++) {
                    newIndices.push(f.indices[0], f.indices[i], f.indices[i+1]);
                  }
                }
              }
              
              const newGeo = new THREE.BufferGeometry();
              newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
              newGeo.setIndex(newIndices);
              newGeo.computeVertexNormals();
              
              // Note: UVs and other attributes are lost in this simple conversion.
              // For a full solution, we would need to interpolate UVs, normals, skin weights, etc.
              // But for now, this preserves the hierarchy and animations.
              mesh.geometry = newGeo;
              modified = true;
            }
          }
        }
      }
    });

    if (!modified) return obj;

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    // Recalculate meshes list
    const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    let meshIdx = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) {
        const geometry = child.geometry;
        let verts = 0;
        let faces = 0;
        if (geometry) {
          verts = geometry.attributes.position ? geometry.attributes.position.count : 0;
          faces = geometry.index ? geometry.index.count / 3 : verts / 3;
        }
        meshesList.push({
          id: `mesh-${meshIdx++}`,
          name: child.name || 'Unnamed Mesh',
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    return {
      ...obj,
      meshData: {
        type: 'gltf',
        data: url,
        animations: gltf.animations.map((a: any) => a.toJSON()),
        meshes: meshesList
      }
    };
  } catch (err) {
    console.error('Error processing GLB:', err);
    return obj;
  }
}

export async function smoothGLB(obj: CSGObject, factor: number, iterations: number = 1): Promise<CSGObject> {
  return processGLBMeshes(obj, (vertices, faces) => smoothMesh({ ...obj, vertices, faces }, factor, iterations));
}

export async function subdivideGLB(obj: CSGObject): Promise<CSGObject> {
  return processGLBMeshes(obj, (vertices, faces) => subdivideMesh({ ...obj, vertices, faces }));
}

/**
 * Optimizador de modelos GLB/GLTF con preservación de Texturas, Materiales, Animaciones y Jerarquía de Sub-mallas.
 * Utiliza Meshopt con protección de bordes (LockBorder) para evitar la desarticulación de partes separadas o flotantes.
 */
export async function optimizeGLBModel(
  obj: CSGObject,
  resolutionLevel: number = 3,
  onProgress?: (progress: number, stepText: string) => Promise<void> | void,
  targetMeshIds?: string[],
  options?: {
    preserveCreases?: boolean;
    ratio?: number;
    isCurved?: boolean;
    creaseAngleDeg?: number;
    smoothNormals?: boolean;
  }
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    if (onProgress) await onProgress(10, 'Cargando modelo GLB, texturas y animaciones...');

    if ((Meshopt as any).ready) await (Meshopt as any).ready;

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let totalMeshes = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) totalMeshes++;
    });

    if (onProgress) await onProgress(20, `Optimizando ${totalMeshes} sub-mallas conservando texturas y movimiento...`);

    const clampedRes = Math.max(1, Math.min(12, resolutionLevel));
    // Escalar nivel de resolución o utilizar el ratio directo si se suministra
    const targetRatio = options?.ratio !== undefined
      ? Math.min(0.98, Math.max(0.01, options.ratio))
      : Math.min(0.85, Math.max(0.02, Math.pow((clampedRes - 0.5) / 11.5, 1.4) * 0.83 + 0.02));
    const targetError = Math.max(0.01, 0.95 - (clampedRes / 12) * 0.90);
    const preserveCreases = options?.preserveCreases !== false;

    let meshIdxCounter = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) {
        const meshId = `mesh-${meshIdxCounter++}`;
        if (targetMeshIds && targetMeshIds.length > 0 && !targetMeshIds.includes(meshId)) {
          return; // Omitir sub-malla no seleccionada (se mantiene 100% intacta)
        }

        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        // Solo si la geometría no tiene índices, indexarla
        if (!geometry.index) {
          try {
            geometry = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
            mesh.geometry = geometry;
          } catch (e) {
            // fallback
          }
          if (!geometry.index) {
            const posCount = geometry.attributes.position.count;
            const idx = new Uint32Array(posCount);
            for (let i = 0; i < posCount; i++) idx[i] = i;
            geometry.setIndex(new THREE.BufferAttribute(idx, 1));
          }
        }

        // Disolver coplanares en superficies planas primero para optimizar paneles y alas
        if (!options?.isCurved) {
          try {
            geometry.computeBoundingBox();
            const diag = geometry.boundingBox ? geometry.boundingBox.getSize(new THREE.Vector3()).length() : undefined;
            dissolveCoplanarBufferGeometry(geometry, 3.5, diag);
          } catch (_) {}
        }

        const posAttr = geometry.attributes.position;
        const indexAttr = geometry.index!;

        const posArray = posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array);
        const indexArray = indexAttr.array instanceof Uint32Array ? indexAttr.array : new Uint32Array(indexAttr.array);

        const uvAttr = geometry.attributes.uv;
        const hasUV = !!uvAttr && uvAttr.count === posAttr.count;
        const hasNormal = !!geometry.attributes.normal;

        const initialTris = indexArray.length / 3;
        
        // Protección anti-desaparición: Si una pieza ya es muy pequeña o low-poly (<24 caras en curvas, <12 en general),
        // preservarla íntegra para no colapsarla ni hacerla desaparecer.
        const minTrisSafety = options?.isCurved ? 24 : 12;
        if (initialTris <= minTrisSafety && (!targetMeshIds || targetMeshIds.length === 0)) {
          return; // Mantener partes pequeñas intactas en decimation masiva
        }

        if (initialTris > 6) {
          const minTrisFloor = options?.isCurved ? Math.min(24, initialTris) : Math.min(12, initialTris);
          const targetTris = Math.max(minTrisFloor, Math.floor(initialTris * targetRatio));
          const targetCount = targetTris * 3;

          let resultIndices: Uint32Array | null = null;

          if (hasUV) {
            // Simplificación multi-atributo: protege estrictamente el mapeado UV y las costuras de textura
            const uvArray = uvAttr.array instanceof Float32Array ? uvAttr.array : new Float32Array(uvAttr.array);
            const uvWeights = options?.isCurved ? [1.2, 1.2] : [1.5, 1.5];

            const uvAttempts = options?.isCurved
              ? [
                  { err: 0.015, flags: ['LockBorder'] as any },
                  { err: 0.035, flags: ['LockBorder'] as any },
                  { err: 0.08,  flags: ['LockBorder'] as any },
                  { err: 0.18,  flags: ['LockBorder'] as any },
                  { err: 0.35,  flags: ['LockBorder'] as any },
                  { err: 0.20,  flags: [] as any },
                  { err: 0.45,  flags: [] as any },
                ]
              : [
                  { err: 0.02, flags: ['LockBorder'] as any },
                  { err: 0.05, flags: ['LockBorder'] as any },
                  { err: 0.15, flags: ['LockBorder'] as any },
                  { err: 0.35, flags: ['LockBorder'] as any },
                  { err: 0.60, flags: ['LockBorder'] as any },
                ];

            if (!preserveCreases && !options?.isCurved) {
              uvAttempts.push({ err: 0.30, flags: [] as any }, { err: 0.60, flags: [] as any });
            }

            for (const att of uvAttempts) {
              try {
                const res = Meshopt.simplifyWithAttributes(
                  indexArray,
                  posArray,
                  3,
                  uvArray,
                  2,
                  uvWeights,
                  null,
                  targetCount,
                  att.err,
                  att.flags
                );
                if (res && res[0] && res[0].length >= 12 && res[0].length < indexArray.length) {
                  resultIndices = res[0];
                  if (resultIndices.length <= targetCount * 1.15) break;
                }
              } catch (eAtt) {}
            }
            // En mallas con texturas UV nunca ejecutamos simplifySloppy para evitar desgarrar las texturas
          } else {
            // Mallas sin UVs: simplificación posicional estándar
            const flags = preserveCreases ? ['LockBorder'] : [];
            const attempts = options?.isCurved
              ? [
                  { err: 0.012, flags: ['LockBorder'] as any },
                  { err: 0.035, flags: ['LockBorder'] as any },
                  { err: 0.08,  flags: ['LockBorder'] as any },
                  { err: 0.18,  flags: ['LockBorder'] as any },
                  { err: 0.35,  flags: ['LockBorder'] as any },
                  { err: 0.20,  flags: [] as any },
                  { err: 0.45,  flags: [] as any },
                ]
              : [
                  { err: 0.05, flags: flags as any },
                  { err: 0.15, flags: flags as any },
                  { err: 0.35, flags: flags as any },
                  { err: 0.70, flags: flags as any },
                ];
            if (!preserveCreases && !options?.isCurved) {
              attempts.push({ err: 0.50, flags: [] as any });
            }

            for (const att of attempts) {
              try {
                const res = Meshopt.simplify(
                  indexArray,
                  posArray,
                  3,
                  targetCount,
                  att.err,
                  att.flags
                );
                if (res && res[0] && res[0].length >= 12 && res[0].length < indexArray.length) {
                  resultIndices = res[0];
                  if (resultIndices.length <= targetCount * 1.15) break;
                }
              } catch (eSimp) {}
            }

            // Evitar fallback sloppy en geometrías curvas para no destruir cilindros o cañones finos
            if (!options?.isCurved && (!resultIndices || resultIndices.length === indexArray.length) && targetRatio <= 0.7) {
              try {
                const resSloppy = Meshopt.simplifySloppy(indexArray, posArray, 3, null, targetCount, 0.4);
                if (resSloppy && resSloppy[0] && resSloppy[0].length >= 12 && resSloppy[0].length < indexArray.length) {
                  resultIndices = resSloppy[0];
                }
              } catch (eSloppy) {}
            }
          }

          if (resultIndices && resultIndices.length >= 12 && resultIndices.length < indexArray.length) {
            const attrNames = Object.keys(geometry.attributes);
            const oldArrays: { [name: string]: { array: ArrayLike<number>, itemSize: number } } = {};
            const newArrays: { [name: string]: number[] } = {};

            for (const name of attrNames) {
              const attr = geometry.attributes[name];
              oldArrays[name] = { array: attr.array, itemSize: attr.itemSize };
              newArrays[name] = [];
            }

            const usedMap = new Map<number, number>();
            const remappedIndices = new Uint32Array(resultIndices.length);

            for (let i = 0; i < resultIndices.length; i++) {
              const oldIdx = resultIndices[i];
              let newIdx = usedMap.get(oldIdx);
              if (newIdx === undefined) {
                newIdx = newArrays['position'].length / 3;
                usedMap.set(oldIdx, newIdx);
                for (const name of attrNames) {
                  const { array, itemSize } = oldArrays[name];
                  for (let k = 0; k < itemSize; k++) {
                    newArrays[name].push(array[oldIdx * itemSize + k]);
                  }
                }
              }
              remappedIndices[i] = newIdx;
            }

            // Solo aplicar si los nuevos buffers son coherentes y tienen geometría válida
            if (newArrays['position'] && newArrays['position'].length >= 9 && remappedIndices.length >= 3) {
              for (const name of attrNames) {
                const itemSize = oldArrays[name].itemSize;
                const origAttr = geometry.attributes[name];
                let typedArr: ArrayLike<number>;

                if (name === 'skinIndex' || name === 'joints' || name.toLowerCase().includes('skinindex')) {
                  const isUint8 = origAttr.array instanceof Uint8Array;
                  typedArr = isUint8 ? new Uint8Array(newArrays[name]) : new Uint16Array(newArrays[name]);
                } else if (origAttr.array instanceof Uint32Array) {
                  typedArr = new Uint32Array(newArrays[name]);
                } else if (origAttr.array instanceof Uint16Array) {
                  typedArr = new Uint16Array(newArrays[name]);
                } else if (origAttr.array instanceof Uint8Array) {
                  typedArr = new Uint8Array(newArrays[name]);
                } else if (origAttr.array instanceof Int16Array) {
                  typedArr = new Int16Array(newArrays[name]);
                } else {
                  typedArr = new Float32Array(newArrays[name]);
                }

                const newAttr = new THREE.BufferAttribute(typedArr as any, itemSize);
                newAttr.normalized = origAttr.normalized;
                geometry.setAttribute(name, newAttr);
              }

              // Normalizar pesos de huesos (skinWeight) si existen para que la suma sea exactamente 1.0
              if (geometry.attributes.skinWeight) {
                const sw = geometry.attributes.skinWeight;
                for (let v = 0; v < sw.count; v++) {
                  const x = sw.getX(v);
                  const y = sw.getY(v);
                  const z = sw.getZ(v);
                  const w = sw.getW(v);
                  const sum = x + y + z + w;
                  if (sum > 1e-4) {
                    sw.setXYZW(v, x / sum, y / sum, z / sum, w / sum);
                  } else {
                    sw.setXYZW(v, 1, 0, 0, 0);
                  }
                }
                sw.needsUpdate = true;
              }

              geometry.setIndex(new THREE.BufferAttribute(remappedIndices, 1));

              // Sincronizar o limpiar geometry.groups para evitar desfases que causan desaparición de partes
              if (geometry.groups && geometry.groups.length > 0) {
                if (!Array.isArray(mesh.material) || mesh.material.length <= 1) {
                  geometry.clearGroups();
                } else {
                  const oldLen = indexArray.length;
                  const newLen = remappedIndices.length;
                  let curStart = 0;
                  geometry.groups.forEach((grp, idx) => {
                    const propCount = (idx === geometry.groups.length - 1)
                      ? (newLen - curStart)
                      : Math.floor((grp.count / oldLen) * newLen);
                    grp.start = curStart;
                    grp.count = Math.max(3, propCount - (propCount % 3));
                    curStart += grp.count;
                  });
                  if (geometry.groups.length > 0) {
                    const last = geometry.groups[geometry.groups.length - 1];
                    if (last.start + last.count < newLen) {
                      last.count = newLen - last.start;
                    }
                  }
                }
              }

              // Recalcular normales preservando aristas vivas y evitando sombras negras en paneles
              const creaseAngleRad = ((options?.creaseAngleDeg ?? 35) * Math.PI) / 180;
              try {
                computeSmoothNormalsByPosition(geometry, creaseAngleRad);
              } catch (eNorm) {
                geometry.computeVertexNormals();
              }
              geometry.computeBoundingBox();
              geometry.computeBoundingSphere();
            }
          }
        }
      }
    });

    if (onProgress) await onProgress(75, 'Empaquetando modelo GLB con materiales y animaciones...');
    await new Promise(r => setTimeout(r, 20));

    const exporter = new GLTFExporter();
    let glbBuffer: ArrayBuffer;
    try {
      glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          scene,
          (gltfData) => resolve(gltfData as ArrayBuffer),
          (error) => reject(error),
          { binary: true, animations: (gltf.animations && gltf.animations.length > 0) ? gltf.animations : undefined }
        );
      });
    } catch (exportErr) {
      console.warn('Fallo en exportación con animaciones, reintentando exportación limpia:', exportErr);
      glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        exporter.parse(
          scene,
          (gltfData) => resolve(gltfData as ArrayBuffer),
          (error) => reject(error),
          { binary: true }
        );
      });
    }

    // Verificación de integridad: comprobar que el nuevo GLB se puede cargar sin errores
    try {
      const verifyLoader = new GLTFLoader();
      verifyLoader.setMeshoptDecoder(MeshoptDecoder);
      await new Promise((res, rej) => verifyLoader.parse(glbBuffer, '', res, rej));
    } catch (verifyErr) {
      console.error('El GLB exportado no superó la prueba de integridad, conservando modelo original:', verifyErr);
      return obj;
    }

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    let meshIdx = 0;
    let totalVertices = 0;
    let totalFaces = 0;

    scene.traverse((child: any) => {
      if (child.isMesh) {
        const geo = child.geometry;
        let verts = geo?.attributes?.position ? geo.attributes.position.count : 0;
        let faces = geo?.index ? geo.index.count / 3 : verts / 3;
        totalVertices += verts;
        totalFaces += faces;
        meshesList.push({
          id: `mesh-${meshIdx++}`,
          name: child.name || 'Sub-mesh',
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    if (onProgress) await onProgress(100, '¡Optimización finalizada preservando texturas y animación!');

    return {
      ...obj,
      stats: {
        vertices: Math.floor(totalVertices),
        faces: Math.floor(totalFaces)
      },
      meshData: {
        type: 'gltf',
        data: url,
        animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
        meshes: meshesList
      }
    };
  } catch (err) {
    console.error('Error optimizando modelo GLB:', err);
    return obj;
  }
}

/**
 * Algoritmo geométrico canónico de Limited Dissolve (Topological BMesh Dissolve) para BufferGeometry.
 * Implementa las tres fases algorítmicas secuenciales de Blender:
 * 1. Filtrado por umbral de ángulo (Cálculo del Producto Escalar entre normales de caras adyacentes).
 * 2. Fusión Topológica de BMesh (Disolución de aristas internas y bucles de frontera).
 * 3. Limpieza de vértices colineales de grado 2 en bordes y reteselado plano limpio mediante Ear-Clipping 2D.
 */
export function dissolveCoplanarBufferGeometry(
  geometry: THREE.BufferGeometry,
  angleToleranceDeg: number = 5.0,
  sceneDiag: number = 1.0,
  options?: {
    protectUVSeams?: boolean;
    protectMaterialBoundaries?: boolean;
    collinearAngleDeg?: number;
    snapToPlane?: boolean;
  }
): { modified: boolean; initialFaces: number; finalFaces: number } {
  const res = limitedDissolveGeometry(geometry, {
    maxAngleDeg: angleToleranceDeg,
    collinearAngleDeg: options?.collinearAngleDeg ?? Math.max(3.0, angleToleranceDeg * 0.8),
    protectUVSeams: options?.protectUVSeams ?? (angleToleranceDeg < 8.0),
    protectMaterialBoundaries: options?.protectMaterialBoundaries ?? true,
    snapToPlane: options?.snapToPlane ?? false
  });
  return {
    modified: res.modified,
    initialFaces: res.initialFaces,
    finalFaces: res.finalFaces
  };
}

/**
 * Disuelve triángulos coplanares y simplifica áreas planas en modelos GLB manteniendo intactos:
 * - Todas las texturas PBR (Albedo, Normal Map, Roughness, Metalness, Emissive, Ambient Occlusion)
 * - Mapeado UV exacto y costuras de textura ('LockBorder' + ponderación de atributos UV)
 * - Jerarquía completa de nodos, sub-mallas, materiales y animaciones
 * - Aristas vivas y curvaturas (solo colapsa triángulos en superficies que yacen dentro de angleToleranceDeg)
 */
export async function dissolveCoplanarGLBModel(
  obj: CSGObject,
  angleToleranceDeg: number = 5.0,
  onProgress?: (progress: number, stepText: string) => Promise<void> | void,
  targetMeshIds?: string[],
  options?: {
    protectUVSeams?: boolean;
    protectMaterialBoundaries?: boolean;
    collinearAngleDeg?: number;
    snapToPlane?: boolean;
  }
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    if (onProgress) await onProgress(10, 'Cargando modelo GLB y analizando superficies coplanares...');

    if ((Meshopt as any).ready) await (Meshopt as any).ready;

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let totalMeshes = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) totalMeshes++;
    });

    if (onProgress) await onProgress(25, `Disolviendo planos en ${totalMeshes} sub-mallas protegiendo texturas y cañones...`);

    const sceneBBox = new THREE.Box3().setFromObject(scene);
    const sceneDiag = sceneBBox.min.distanceTo(sceneBBox.max) || 1.0;

    let meshIdxCounter = 0;
    let totalInitialFaces = 0;
    let totalFinalFaces = 0;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const meshId = `mesh-${meshIdxCounter++}`;
        if (targetMeshIds && targetMeshIds.length > 0 && !targetMeshIds.includes(meshId)) {
          return;
        }

        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        // Preservar piezas de micro-detalle (< 1.2% del tamaño total)
        try {
          const childBBox = new THREE.Box3().setFromObject(child);
          const childDiag = childBBox.min.distanceTo(childBBox.max) || 0;
          if (childDiag > 0 && childDiag < sceneDiag * 0.012) {
            const triCount = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
            totalInitialFaces += triCount;
            totalFinalFaces += triCount;
            return;
          }
        } catch (_) {}

        const triCountBefore = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
        totalInitialFaces += triCountBefore;

        // Aplicar Limited Dissolve puro de 3 fases (BMesh Topological Dissolve)
        const dissolveRes = dissolveCoplanarBufferGeometry(geometry, angleToleranceDeg, sceneDiag, options);
        const currentFaces = dissolveRes.modified ? dissolveRes.finalFaces : triCountBefore;
        totalFinalFaces += currentFaces;
      }
    });

    if (onProgress) await onProgress(75, 'Empaquetando modelo GLB optimizado con texturas intactas...');
    await new Promise(r => setTimeout(r, 20));

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    let meshIdx = 0;
    let totalVertices = 0;
    let totalFaces = 0;

    scene.traverse((child: any) => {
      if (child.isMesh) {
        const geo = child.geometry;
        let verts = geo?.attributes?.position ? geo.attributes.position.count : 0;
        let faces = geo?.index ? geo.index.count / 3 : verts / 3;
        totalVertices += verts;
        totalFaces += faces;
        meshesList.push({
          id: `mesh-${meshIdx++}`,
          name: child.name || 'Sub-mesh',
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    const savedFaces = Math.max(0, totalInitialFaces - totalFaces);
    const reductionPct = totalInitialFaces > 0 ? Math.round((savedFaces / totalInitialFaces) * 100) : 0;

    if (onProgress) await onProgress(100, `¡Fusión coplanar completada! (-${reductionPct}% caras planas optimizadas)`);

    return {
      ...obj,
      stats: {
        vertices: Math.floor(totalVertices),
        faces: Math.floor(totalFaces)
      },
      meshData: {
        type: 'gltf',
        data: url,
        animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
        meshes: meshesList
      }
    };
  } catch (err) {
    console.error('Error disolviendo planos en modelo GLB:', err);
    return obj;
  }
}

/**
 * Regularización Tangencial para modelos GLB/GLTF.
 * Relaja las posiciones de los vértices a lo largo del plano tangente para igualar ángulos
 * y formas de triángulos hacia configuraciones equiláteras.
 * GARANTÍA ESTRICTA:
 * - 0% de cambio en el recuento de caras (0 polígonos añadidos).
 * - 100% de preservación de mapas UV, costuras y materiales PBR.
 */
export async function regularizeGLBModel(
  obj: CSGObject,
  strength: number = 0.65,
  iterations: number = 3,
  featureAngleDeg: number = 40,
  onProgress?: (progress: number, stepText: string) => Promise<void> | void
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    if (onProgress) await onProgress(15, 'Cargando modelo GLB y preparando topología...');

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    const cosFeature = Math.cos((featureAngleDeg * Math.PI) / 180);

    let totalVertices = 0;
    let totalFaces = 0;

    if (onProgress) await onProgress(35, 'Regularizando vértices tangencialmente sin alterar caras...');

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        const geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        const posAttr = geometry.attributes.position;
        const nVerts = posAttr.count;
        if (nVerts < 3) return;

        // Asegurar buffer indexado para conectividad
        let indexAttr = geometry.index;
        if (!indexAttr) {
          const idxArr = new Uint32Array(nVerts);
          for (let i = 0; i < nVerts; i++) idxArr[i] = i;
          indexAttr = new THREE.BufferAttribute(idxArr, 1);
          geometry.setIndex(indexAttr);
        }

        const indexArray = indexAttr.array;
        const nFaces = Math.floor(indexArray.length / 3);
        totalFaces += nFaces;
        totalVertices += nVerts;

        // Bounding box para calcular tolerancias proporcionales
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const bbox = geometry.boundingBox || new THREE.Box3();
        const bboxSize = new THREE.Vector3();
        bbox.getSize(bboxSize);
        const bboxDiag = Math.max(1e-3, bboxSize.length());

        // 1. Spatial Clustering (Welding físico para UV seams y aristas divididas)
        // Agrupamos vértices que comparten la misma coordenada 3D física para que se muevan
        // juntos de forma idéntica, garantizando que NUNCA se desgarren costuras de textura.
        const weldCell = Math.max(1e-5, bboxDiag * 1e-4);
        const invCell = 1 / weldCell;
        const spatialMap = new Map<string, number>();
        const spatialId: number[] = new Array(nVerts);
        const spatialPos: THREE.Vector3[] = [];

        for (let i = 0; i < nVerts; i++) {
          const px = posAttr.getX(i);
          const py = posAttr.getY(i);
          const pz = posAttr.getZ(i);
          const k = `${Math.round(px * invCell)}_${Math.round(py * invCell)}_${Math.round(pz * invCell)}`;
          let sId = spatialMap.get(k);
          if (sId === undefined) {
            sId = spatialPos.length;
            spatialMap.set(k, sId);
            spatialPos.push(new THREE.Vector3(px, py, pz));
          }
          spatialId[i] = sId;
        }

        const numSpatialPoints = spatialPos.length;

        // 2. Construir conectividad topológica entre puntos espaciales
        const spatialNeighbors: Set<number>[] = Array.from({ length: numSpatialPoints }, () => new Set<number>());
        const spatialFaces: number[][] = Array.from({ length: numSpatialPoints }, () => []);
        const spatialEdgeFaces = new Map<string, number[]>();

        for (let f = 0; f < nFaces; f++) {
          const i0 = indexArray[f * 3];
          const i1 = indexArray[f * 3 + 1];
          const i2 = indexArray[f * 3 + 2];

          const s0 = spatialId[i0];
          const s1 = spatialId[i1];
          const s2 = spatialId[i2];

          if (s0 === s1 || s1 === s2 || s2 === s0) continue;

          spatialFaces[s0].push(f);
          spatialFaces[s1].push(f);
          spatialFaces[s2].push(f);

          spatialNeighbors[s0].add(s1); spatialNeighbors[s0].add(s2);
          spatialNeighbors[s1].add(s0); spatialNeighbors[s1].add(s2);
          spatialNeighbors[s2].add(s0); spatialNeighbors[s2].add(s1);

          const sEdges: [number, number][] = [[s0, s1], [s1, s2], [s2, s0]];
          for (const [ea, eb] of sEdges) {
            const k = ea < eb ? `${ea}_${eb}` : `${eb}_${ea}`;
            let list = spatialEdgeFaces.get(k);
            if (!list) { list = []; spatialEdgeFaces.set(k, list); }
            list.push(f);
          }
        }

        // 3. Cálculo de normales y áreas de caras
        const faceNormals: THREE.Vector3[] = new Array(nFaces);
        const faceAreas: number[] = new Array(nFaces);
        const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

        const updateNormals = () => {
          for (let f = 0; f < nFaces; f++) {
            const i0 = indexArray[f * 3];
            const i1 = indexArray[f * 3 + 1];
            const i2 = indexArray[f * 3 + 2];
            const s0 = spatialId[i0];
            const s1 = spatialId[i1];
            const s2 = spatialId[i2];

            pA.copy(spatialPos[s0]);
            pB.copy(spatialPos[s1]);
            pC.copy(spatialPos[s2]);
            ab.subVectors(pB, pA);
            ac.subVectors(pC, pA);
            cross.crossVectors(ab, ac);
            const len = cross.length();
            faceAreas[f] = Math.max(1e-9, len * 0.5);
            faceNormals[f] = len > 1e-9 ? cross.clone().multiplyScalar(1 / len) : new THREE.Vector3(0, 1, 0);
          }
        };

        // 4. Clasificación de aristas (bordes abiertos, aristas vivas/pliegues y uniones complejas)
        updateNormals();

        const boundaryNeighbors: number[][] = Array.from({ length: numSpatialPoints }, () => []);
        const creaseNeighbors: number[][] = Array.from({ length: numSpatialPoints }, () => []);
        const lockedPoints = new Uint8Array(numSpatialPoints);

        spatialEdgeFaces.forEach((fList, k) => {
          const parts = k.split('_');
          const ea = Number(parts[0]);
          const eb = Number(parts[1]);

          if (fList.length === 1) {
            // Borde abierto real (perímetro exterior de alas o paneles)
            boundaryNeighbors[ea].push(eb);
            boundaryNeighbors[eb].push(ea);
          } else if (fList.length === 2) {
            const fn1 = faceNormals[fList[0]];
            const fn2 = faceNormals[fList[1]];
            if (fn1 && fn2 && fn1.dot(fn2) < cosFeature) {
              // Pliegue o arista viva mecánica
              creaseNeighbors[ea].push(eb);
              creaseNeighbors[eb].push(ea);
            }
          } else if (fList.length > 2) {
            // Unión no-manifold: fijar estrictamente
            lockedPoints[ea] = 1;
            lockedPoints[eb] = 1;
          }
        });

        // Esquinas de silueta o cruces mecánicos de aristas vivas -> fijar para no deformar
        for (let s = 0; s < numSpatialPoints; s++) {
          if (boundaryNeighbors[s].length > 0 && boundaryNeighbors[s].length !== 2) {
            lockedPoints[s] = 1; // Esquina de perímetro abierto
          }
          if (creaseNeighbors[s].length > 0 && creaseNeighbors[s].length !== 2) {
            lockedPoints[s] = 1; // Esquina de caja o arista mecánica
          }
        }

        // 5. Relajación tangencial balanceada con amortiguación
        const safeStrength = Math.min(0.35, Math.max(0.05, strength));

        for (let it = 0; it < iterations; it++) {
          if (it > 0) updateNormals();

          const nextSpatialPos = spatialPos.map(v => v.clone());
          const vertNormal = new THREE.Vector3();
          const neighborCenter = new THREE.Vector3();
          const disp = new THREE.Vector3();

          for (let s = 0; s < numSpatialPoints; s++) {
            if (lockedPoints[s]) continue;

            const bN = boundaryNeighbors[s];
            const cN = creaseNeighbors[s];

            if (bN.length === 2) {
              // Deslizamiento 1D a lo largo de la silueta exterior del modelo (no encoge)
              const p1 = spatialPos[bN[0]];
              const p2 = spatialPos[bN[1]];
              const lineDir = new THREE.Vector3().subVectors(p2, p1).normalize();
              const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
              const toMid = new THREE.Vector3().subVectors(midPoint, spatialPos[s]);
              const proj = lineDir.clone().multiplyScalar(toMid.dot(lineDir));
              const maxMove = spatialPos[s].distanceTo(p1) * 0.2;
              if (proj.length() > maxMove) proj.setLength(maxMove);
              nextSpatialPos[s].addScaledVector(proj, safeStrength * 0.35);
              continue;
            }

            if (cN.length === 2) {
              // Deslizamiento 1D a lo largo de la arista viva (preserva filo 100%)
              const p1 = spatialPos[cN[0]];
              const p2 = spatialPos[cN[1]];
              const lineDir = new THREE.Vector3().subVectors(p2, p1).normalize();
              const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
              const toMid = new THREE.Vector3().subVectors(midPoint, spatialPos[s]);
              const proj = lineDir.clone().multiplyScalar(toMid.dot(lineDir));
              const maxMove = spatialPos[s].distanceTo(p1) * 0.2;
              if (proj.length() > maxMove) proj.setLength(maxMove);
              nextSpatialPos[s].addScaledVector(proj, safeStrength * 0.35);
              continue;
            }

            // Interior de la superficie: Relajación tangencial balanceada
            const nbs = Array.from(spatialNeighbors[s]);
            if (nbs.length === 0) continue;

            vertNormal.set(0, 0, 0);
            for (const fi of spatialFaces[s]) {
              const fn = faceNormals[fi];
              const fa = faceAreas[fi] || 1;
              if (fn) vertNormal.addScaledVector(fn, fa);
            }
            if (vertNormal.lengthSq() > 1e-10) vertNormal.normalize();
            else vertNormal.set(0, 1, 0);

            neighborCenter.set(0, 0, 0);
            let minEdgeDist = Infinity;
            for (const nb of nbs) {
              const np = spatialPos[nb];
              neighborCenter.add(np);
              const d = spatialPos[s].distanceTo(np);
              if (d < minEdgeDist) minEdgeDist = d;
            }
            neighborCenter.multiplyScalar(1 / nbs.length);
            disp.subVectors(neighborCenter, spatialPos[s]);

            // Remover componente normal para conservar 100% el volumen y curvatura
            const normalComp = disp.dot(vertNormal);
            disp.addScaledVector(vertNormal, -normalComp);

            // Clamping estricto de seguridad: máximo 20% de la arista más cercana para evitar desgarros
            const maxDisp = isFinite(minEdgeDist) && minEdgeDist > 1e-5 ? minEdgeDist * 0.2 : bboxDiag * 0.01;
            if (disp.length() > maxDisp) disp.setLength(maxDisp);

            nextSpatialPos[s].addScaledVector(disp, safeStrength);
          }

          for (let s = 0; s < numSpatialPoints; s++) {
            spatialPos[s].copy(nextSpatialPos[s]);
          }
        }

        // 6. Asignar las nuevas posiciones sincronizadas a todos los vértices del buffer
        for (let i = 0; i < nVerts; i++) {
          const s = spatialId[i];
          const sp = spatialPos[s];
          posAttr.setXYZ(i, sp.x, sp.y, sp.z);
        }
        posAttr.needsUpdate = true;
        geometry.computeVertexNormals();
      }
    });

    if (onProgress) await onProgress(80, 'Exportando modelo regularizado con 0 caras extra...');

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    let meshIdx = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) {
        const geo = child.geometry;
        let verts = geo?.attributes?.position ? geo.attributes.position.count : 0;
        let faces = geo?.index ? geo.index.count / 3 : verts / 3;
        meshesList.push({
          id: `mesh-${meshIdx++}`,
          name: child.name || 'Sub-mesh',
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    if (onProgress) await onProgress(100, `¡Topología regularizada! (${totalFaces.toLocaleString()} caras · 0 caras extra · Texturas intactas)`);

    return {
      ...obj,
      stats: {
        vertices: Math.floor(totalVertices),
        faces: Math.floor(totalFaces)
      },
      meshData: {
        type: 'gltf',
        data: url,
        animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
        meshes: meshesList
      }
    };
  } catch (err) {
    console.error('Error regularizando modelo GLB:', err);
    return obj;
  }
}

/**
 * Remallado Isótropo Uniforme para modelos GLB/GLTF.
 * Reorganiza la geometría en una red poligonal homogénea eliminando aristas dispares
 * GARANTIZANDO ESTRICTAMENTE que el número de polígonos NUNCA aumente respecto al original.
 */
export async function isotropicRemeshGLBModel(
  obj: CSGObject,
  iterations: number = 2,
  targetRatio: number = 1.0,
  onProgress?: (progress: number, stepText: string) => Promise<void> | void
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    if (onProgress) await onProgress(15, 'Cargando modelo GLB para remallado uniforme...');

    if ((Meshopt as any).ready) await (Meshopt as any).ready;

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let totalInitialFaces = 0;
    let totalFinalFaces = 0;
    let totalVertices = 0;

    // Proporción máxima: NUNCA superar 1.0 (mantener o reducir)
    const effectiveRatio = Math.min(1.0, Math.max(0.05, targetRatio));

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        if (!geometry.index) {
          try {
            geometry = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
            mesh.geometry = geometry;
          } catch (e) {}
          if (!geometry.index) {
            const posCount = geometry.attributes.position.count;
            const idx = new Uint32Array(posCount);
            for (let i = 0; i < posCount; i++) idx[i] = i;
            geometry.setIndex(new THREE.BufferAttribute(idx, 1));
          }
        }

        const posAttr = geometry.attributes.position;
        const indexAttr = geometry.index!;
        const posArray = posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array);
        const indexArray = indexAttr.array instanceof Uint32Array ? indexAttr.array : new Uint32Array(indexAttr.array);

        const initialTris = Math.floor(indexArray.length / 3);
        totalInitialFaces += initialTris;

        const uvAttr = geometry.attributes.uv;
        const hasUV = !!uvAttr && uvAttr.count === posAttr.count;

        // Objetivo estricto: menor o igual al recuento inicial
        const targetTris = Math.max(4, Math.floor(initialTris * effectiveRatio));
        const targetCount = targetTris * 3;

        let resultIndices: Uint32Array | null = null;

        if (hasUV) {
          const uvArray = uvAttr.array instanceof Float32Array ? uvAttr.array : new Float32Array(uvAttr.array);
          try {
            const res = Meshopt.simplifyWithAttributes(
              indexArray,
              posArray,
              3,
              uvArray,
              2,
              [3.0, 3.0],
              null,
              targetCount,
              0.02,
              ['LockBorder'] as any
            );
            if (res && res[0] && res[0].length >= 12 && res[0].length <= indexArray.length) {
              resultIndices = res[0];
            }
          } catch (e) {}
        } else {
          try {
            const res = Meshopt.simplify(
              indexArray,
              posArray,
              3,
              targetCount,
              0.02,
              ['LockBorder'] as any
            );
            if (res && res[0] && res[0].length >= 12 && res[0].length <= indexArray.length) {
              resultIndices = res[0];
            }
          } catch (e) {}
        }

        // Si la simplificación redujo o igualó las caras, remapear atributos
        if (resultIndices && resultIndices.length < indexArray.length) {
          const attrNames = Object.keys(geometry.attributes);
          const oldArrays: { [name: string]: { array: ArrayLike<number>, itemSize: number } } = {};
          const newArrays: { [name: string]: number[] } = {};

          for (const name of attrNames) {
            const attr = geometry.attributes[name];
            oldArrays[name] = { array: attr.array, itemSize: attr.itemSize };
            newArrays[name] = [];
          }

          const usedMap = new Map<number, number>();
          const remappedIndices = new Uint32Array(resultIndices.length);

          for (let i = 0; i < resultIndices.length; i++) {
            const oldIdx = resultIndices[i];
            let newIdx = usedMap.get(oldIdx);
            if (newIdx === undefined) {
              newIdx = usedMap.size;
              usedMap.set(oldIdx, newIdx);
              for (const name of attrNames) {
                const { array, itemSize } = oldArrays[name];
                for (let k = 0; k < itemSize; k++) {
                  newArrays[name].push(array[oldIdx * itemSize + k]);
                }
              }
            }
            remappedIndices[i] = newIdx;
          }

          for (const name of attrNames) {
            const itemSize = oldArrays[name].itemSize;
            const arr = new Float32Array(newArrays[name]);
            geometry.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
          }

          geometry.setIndex(new THREE.BufferAttribute(remappedIndices, 1));
          totalFinalFaces += Math.floor(resultIndices.length / 3);
          totalVertices += usedMap.size;
        } else {
          totalFinalFaces += initialTris;
          totalVertices += posAttr.count;
        }

        // ─── RELAJACIÓN ISÓTROPA TANGENCIAL NO DESTRUCTIVA (TAUBIN + LOCK DE BORDES Y SEAMS) ───
        // Previene desgarros en costuras UV, preserva bordes vivos y evita la pérdida o inflación de volumen
        const curPosAttr = geometry.attributes.position;
        const nV = curPosAttr.count;
        const curIdx = geometry.index?.array;
        const curNFaces = curIdx ? Math.floor(curIdx.length / 3) : 0;

        if (nV >= 4 && curIdx && curNFaces > 0) {
          // 1. Agrupamiento espacial de vértices coincidentes (seams de UVs o normales divididas)
          // Todos los vértices que comparten la misma coordenada 3D exacta se tratan como un único nodo espacial
          const posToSpatial = new Int32Array(nV);
          const spatialPositions: THREE.Vector3[] = [];
          const spatialToVerts = new Map<number, number[]>();
          const spatialHash = new Map<string, number>();

          for (let i = 0; i < nV; i++) {
            const x = curPosAttr.getX(i);
            const y = curPosAttr.getY(i);
            const z = curPosAttr.getZ(i);
            const key = `${Math.round(x * 10000)}_${Math.round(y * 10000)}_${Math.round(z * 10000)}`;
            let sId = spatialHash.get(key);
            if (sId === undefined) {
              sId = spatialPositions.length;
              spatialPositions.push(new THREE.Vector3(x, y, z));
              spatialHash.set(key, sId);
              spatialToVerts.set(sId, [i]);
            } else {
              spatialToVerts.get(sId)!.push(i);
            }
            posToSpatial[i] = sId;
          }

          const nSpatial = spatialPositions.length;

          // 2. Mapeo de aristas espaciales y caras para detectar bordes abiertos y aristas vivas
          const spatialEdgeFaces = new Map<string, number[]>();
          const spatialFaces: [number, number, number][] = [];
          const spatialFaceNormals: THREE.Vector3[] = [];

          for (let f = 0; f < curNFaces; f++) {
            const s0 = posToSpatial[curIdx[f * 3]];
            const s1 = posToSpatial[curIdx[f * 3 + 1]];
            const s2 = posToSpatial[curIdx[f * 3 + 2]];
            if (s0 === s1 || s1 === s2 || s2 === s0) continue;

            const fIdx = spatialFaces.length;
            spatialFaces.push([s0, s1, s2]);

            const v0 = spatialPositions[s0];
            const v1 = spatialPositions[s1];
            const v2 = spatialPositions[s2];
            const ab = new THREE.Vector3().subVectors(v1, v0);
            const ac = new THREE.Vector3().subVectors(v2, v0);
            const fn = new THREE.Vector3().crossVectors(ab, ac);
            if (fn.lengthSq() > 1e-12) fn.normalize();
            else fn.set(0, 1, 0);
            spatialFaceNormals.push(fn);

            for (const [u, v] of [[s0, s1], [s1, s2], [s2, s0]]) {
              const eKey = u < v ? `${u}_${v}` : `${v}_${u}`;
              const list = spatialEdgeFaces.get(eKey) || [];
              list.push(fIdx);
              spatialEdgeFaces.set(eKey, list);
            }
          }

          // 3. Detección de aristas vivas y bordes abiertos
          const isLockedSpatial = new Uint8Array(nSpatial);
          const spatialNeighbors: Set<number>[] = Array.from({ length: nSpatial }, () => new Set<number>());
          let totalEdgeLen = 0;
          let countedEdges = 0;

          spatialEdgeFaces.forEach((fList, eKey) => {
            const sep = eKey.indexOf('_');
            const u = parseInt(eKey.substring(0, sep), 10);
            const v = parseInt(eKey.substring(sep + 1), 10);

            spatialNeighbors[u].add(v);
            spatialNeighbors[v].add(u);

            const edgeLen = spatialPositions[u].distanceTo(spatialPositions[v]);
            totalEdgeLen += edgeLen;
            countedEdges++;

            if (fList.length === 1) {
              // Borde abierto: estrictamente protegido para impedir desgarros o contracción de silueta
              isLockedSpatial[u] = 1;
              isLockedSpatial[v] = 1;
            } else if (fList.length >= 2) {
              // Arista viva o quiebre mecánico (> 35°)
              const nA = spatialFaceNormals[fList[0]];
              const nB = spatialFaceNormals[fList[1]];
              if (nA && nB && nA.dot(nB) < 0.819) {
                isLockedSpatial[u] = 1;
                isLockedSpatial[v] = 1;
              }
            }
          });

          const avgEdgeLen = countedEdges > 0 ? totalEdgeLen / countedEdges : 0.05;
          const maxDisp = avgEdgeLen * 0.10;

          // 4. Normales promedio por nodo espacial
          const spatialNormals: THREE.Vector3[] = Array.from({ length: nSpatial }, () => new THREE.Vector3());
          spatialFaces.forEach(([s0, s1, s2], fIdx) => {
            const fn = spatialFaceNormals[fIdx];
            spatialNormals[s0].add(fn);
            spatialNormals[s1].add(fn);
            spatialNormals[s2].add(fn);
          });
          for (let s = 0; s < nSpatial; s++) {
            if (spatialNormals[s].lengthSq() > 1e-12) spatialNormals[s].normalize();
            else spatialNormals[s].set(0, 1, 0);
          }

          // 5. Filtro Taubin sin pérdida de volumen (λ = 0.18, μ = -0.19)
          const lambda = 0.18;
          const mu = -0.19;
          const safeIters = Math.max(1, Math.min(iterations, 3));

          let currentSpatial = spatialPositions.map(p => p.clone());
          let nextSpatial = spatialPositions.map(p => p.clone());

          for (let it = 0; it < safeIters; it++) {
            // Sub-paso 1: paso positivo
            for (let s = 0; s < nSpatial; s++) {
              if (isLockedSpatial[s]) {
                nextSpatial[s].copy(currentSpatial[s]);
                continue;
              }
              const nbs = Array.from(spatialNeighbors[s]);
              if (nbs.length < 3) {
                nextSpatial[s].copy(currentSpatial[s]);
                continue;
              }

              let cx = 0, cy = 0, cz = 0;
              for (const nb of nbs) {
                cx += currentSpatial[nb].x;
                cy += currentSpatial[nb].y;
                cz += currentSpatial[nb].z;
              }
              cx /= nbs.length; cy /= nbs.length; cz /= nbs.length;

              const p = currentSpatial[s];
              let dx = cx - p.x, dy = cy - p.y, dz = cz - p.z;

              const n = spatialNormals[s];
              const dot = dx * n.x + dy * n.y + dz * n.z;
              dx -= dot * n.x;
              dy -= dot * n.y;
              dz -= dot * n.z;

              const dispLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dispLen > maxDisp) {
                const scale = maxDisp / dispLen;
                dx *= scale; dy *= scale; dz *= scale;
              }

              nextSpatial[s].set(p.x + dx * lambda, p.y + dy * lambda, p.z + dz * lambda);
            }

            for (let s = 0; s < nSpatial; s++) currentSpatial[s].copy(nextSpatial[s]);

            // Sub-paso 2: paso negativo anti-contracción Taubin
            for (let s = 0; s < nSpatial; s++) {
              if (isLockedSpatial[s]) {
                nextSpatial[s].copy(currentSpatial[s]);
                continue;
              }
              const nbs = Array.from(spatialNeighbors[s]);
              if (nbs.length < 3) {
                nextSpatial[s].copy(currentSpatial[s]);
                continue;
              }

              let cx = 0, cy = 0, cz = 0;
              for (const nb of nbs) {
                cx += currentSpatial[nb].x;
                cy += currentSpatial[nb].y;
                cz += currentSpatial[nb].z;
              }
              cx /= nbs.length; cy /= nbs.length; cz /= nbs.length;

              const p = currentSpatial[s];
              let dx = cx - p.x, dy = cy - p.y, dz = cz - p.z;

              const n = spatialNormals[s];
              const dot = dx * n.x + dy * n.y + dz * n.z;
              dx -= dot * n.x;
              dy -= dot * n.y;
              dz -= dot * n.z;

              const dispLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dispLen > maxDisp) {
                const scale = maxDisp / dispLen;
                dx *= scale; dy *= scale; dz *= scale;
              }

              nextSpatial[s].set(p.x + dx * mu, p.y + dy * mu, p.z + dz * mu);
            }

            for (let s = 0; s < nSpatial; s++) currentSpatial[s].copy(nextSpatial[s]);
          }

          // 6. Asignar las posiciones sincronizadas a todos los vértices duplicados en la misma coordenada
          for (let s = 0; s < nSpatial; s++) {
            const vIndices = spatialToVerts.get(s);
            if (!vIndices) continue;
            const finalP = currentSpatial[s];
            for (const vi of vIndices) {
              curPosAttr.setXYZ(vi, finalP.x, finalP.y, finalP.z);
            }
          }

          curPosAttr.needsUpdate = true;
          geometry.computeVertexNormals();
        }
      }
    });

    if (onProgress) await onProgress(80, 'Exportando modelo remallado uniforme con texturas intactas...');

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    const meshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    let meshIdx = 0;
    scene.traverse((child: any) => {
      if (child.isMesh) {
        const geo = child.geometry;
        let verts = geo?.attributes?.position ? geo.attributes.position.count : 0;
        let faces = geo?.index ? geo.index.count / 3 : verts / 3;
        meshesList.push({
          id: `mesh-${meshIdx++}`,
          name: child.name || 'Sub-mesh',
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    if (onProgress) await onProgress(100, `¡Remallado isótropo completado! (${totalFinalFaces.toLocaleString()} caras · 0 polígonos extra)`);

    return {
      ...obj,
      stats: {
        vertices: Math.floor(totalVertices),
        faces: Math.floor(totalFinalFaces)
      },
      meshData: {
        type: 'gltf',
        data: url,
        animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
        meshes: meshesList
      }
    };
  } catch (err) {
    console.error('Error en remallado isótropo de modelo GLB:', err);
    return obj;
  }
}

/**
 * Limpia fragmentos de ruido e islas flotantes desconectadas en modelos GLB.
 * - Mantiene el formato GLTF nativo, texturas, materiales, jerarquía, esqueletos y cinemática.
 * - NO convierte a CSG estático ni altera la orientación ("no tumba el objeto").
 * - Procesa cada sub-malla individualmente y protege partes funcionales mecánicas.
 */
export async function cleanGLBIslands(
  obj: CSGObject,
  options: {
    minFaceRatio?: number;
    minAbsoluteFaces?: number;
    targetMeshIds?: string[];
  } = {},
  onProgress?: (progress: number, stepText: string) => Promise<void> | void
): Promise<{ object: CSGObject; removedFragments: number; report: string[] }> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') {
    return { object: obj, removedFragments: 0, report: ['No es un modelo GLB'] };
  }

  try {
    if (onProgress) await onProgress(15, 'Cargando modelo GLB conservando orientación y jerarquía...');

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let modified = false;
    let totalRemovedShells = 0;

    // Medir la diagonal total de la escena para calibrar el tamaño físico real
    const sceneBBox = new THREE.Box3().setFromObject(scene);
    const sceneDiag = sceneBBox.min.distanceTo(sceneBBox.max) || 1.0;

    let meshIdxCounter = 0;
    const targetIds = options.targetMeshIds;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const meshId = `mesh-${meshIdxCounter++}`;
        if (targetIds && targetIds.length > 0 && !targetIds.includes(meshId)) return;

        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        // Asegurar que la geometría esté indexada
        if (!geometry.index) {
          try {
            geometry = BufferGeometryUtils.mergeVertices(geometry, 1e-4);
            mesh.geometry = geometry;
          } catch (e) {}
          if (!geometry.index) {
            const count = geometry.attributes.position.count;
            const indices = new Uint32Array(count);
            for (let i = 0; i < count; i++) indices[i] = i;
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
          }
        }

        const indexAttr = geometry.index!;
        const indexArray = indexAttr.array;
        const totalFaces = Math.floor(indexArray.length / 3);
        if (totalFaces < 8) return;

        const posArray = geometry.attributes.position.array;
        const numVerts = posArray.length / 3;

        // 1. Mapeo espacial de vértices:
        // En modelos 3D y GLB, paneles, compuertas y piezas adyacentes a menudo tienen vértices duplicados
        // por costuras de textura UV o aristas duras (sharp normals).
        // El hash espacial conecta geométricamente los triángulos que comparten posición en el espacio 3D,
        // evitando que las placas de armadura se fragmenten falsamente en conchas desconectadas.
        const precision = 1e-3;
        const posMap = new Map<string, number>();
        const vertToSpatialId = new Int32Array(numVerts);

        for (let i = 0; i < numVerts; i++) {
          const x = Math.round(posArray[i * 3] / precision);
          const y = Math.round(posArray[i * 3 + 1] / precision);
          const z = Math.round(posArray[i * 3 + 2] / precision);
          const key = `${x}_${y}_${z}`;
          let id = posMap.get(key);
          if (id === undefined) {
            id = posMap.size;
            posMap.set(key, id);
          }
          vertToSpatialId[i] = id;
        }

        // 2. Construir grafo de adyacencia usando aristas espaciales
        const edgeToFaces = new Map<string, number[]>();
        for (let f = 0; f < totalFaces; f++) {
          const i0 = vertToSpatialId[indexArray[f * 3]];
          const i1 = vertToSpatialId[indexArray[f * 3 + 1]];
          const i2 = vertToSpatialId[indexArray[f * 3 + 2]];
          const edges = [
            i0 < i1 ? `${i0}_${i1}` : `${i1}_${i0}`,
            i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`,
            i2 < i0 ? `${i2}_${i0}` : `${i0}_${i2}`,
          ];
          for (const eKey of edges) {
            let list = edgeToFaces.get(eKey);
            if (!list) {
              list = [];
              edgeToFaces.set(eKey, list);
            }
            list.push(f);
          }
        }

        const faceAdj: number[][] = Array.from({ length: totalFaces }, () => []);
        edgeToFaces.forEach(fList => {
          if (fList.length > 1) {
            for (let i = 0; i < fList.length; i++) {
              for (let j = i + 1; j < fList.length; j++) {
                faceAdj[fList[i]].push(fList[j]);
                faceAdj[fList[j]].push(fList[i]);
              }
            }
          }
        });

        // 3. Encontrar conchas conectadas continuas
        const visited = new Uint8Array(totalFaces);
        const shells: number[][] = [];
        for (let i = 0; i < totalFaces; i++) {
          if (visited[i]) continue;
          const shell: number[] = [];
          const q = [i];
          visited[i] = 1;
          while (q.length > 0) {
            const curr = q.pop()!;
            shell.push(curr);
            for (const neighbor of faceAdj[curr]) {
              if (!visited[neighbor]) {
                visited[neighbor] = 1;
                q.push(neighbor);
              }
            }
          }
          shells.push(shell);
        }

        if (shells.length <= 1) return; // Sub-malla completamente continua

        // 4. Calcular métricas físicas de cada concha (Bounding Box y Área 3D real)
        let totalMeshArea = 0;
        const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
        const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), cr = new THREE.Vector3();

        const shellMetrics = shells.map(shell => {
          const sBBox = new THREE.Box3();
          let sArea = 0;

          for (const f of shell) {
            const i0 = indexArray[f * 3];
            const i1 = indexArray[f * 3 + 1];
            const i2 = indexArray[f * 3 + 2];
            pA.set(posArray[i0 * 3], posArray[i0 * 3 + 1], posArray[i0 * 3 + 2]);
            pB.set(posArray[i1 * 3], posArray[i1 * 3 + 1], posArray[i1 * 3 + 2]);
            pC.set(posArray[i2 * 3], posArray[i2 * 3 + 1], posArray[i2 * 3 + 2]);
            sBBox.expandByPoint(pA);
            sBBox.expandByPoint(pB);
            sBBox.expandByPoint(pC);
            v1.subVectors(pB, pA);
            v2.subVectors(pC, pA);
            cr.crossVectors(v1, v2);
            sArea += cr.length() * 0.5;
          }
          totalMeshArea += sArea;
          const sDiag = sBBox.min.distanceTo(sBBox.max);
          return { sDiag, sArea };
        });

        // 5. Criterio de clasificación estricto:
        // Jamás eliminar placas, cañones, paneles o puertas.
        // Una pieza solo se considera "ruido flotante" si cumple TODAS las siguientes condiciones:
        // - Tamaño físico microscópico (< 1.2% del tamaño total del modelo)
        // - Poligonaje minúsculo (<= 8 triángulos)
        // - Área superficial ínfima (< 0.05% del área de la sub-malla)
        const keptFaces: number[] = [];
        let meshRemoved = 0;
        let potentialRemovedFaces = 0;

        for (let sIdx = 0; sIdx < shells.length; sIdx++) {
          const shell = shells[sIdx];
          const { sDiag, sArea } = shellMetrics[sIdx];
          const diagRatio = sDiag / sceneDiag;

          const isNoiseSpeck =
            diagRatio < 0.012 &&
            shell.length <= 8 &&
            (totalMeshArea === 0 || sArea < totalMeshArea * 0.0005);

          if (isNoiseSpeck) {
            meshRemoved++;
            potentialRemovedFaces += shell.length;
          } else {
            for (const f of shell) keptFaces.push(f);
          }
        }

        // Límite de salvaguarda: si se borraría más del 2% de las caras de la sub-malla,
        // no es ruido sino geometría deliberada del modelo. Proteger 100% de las caras.
        if (potentialRemovedFaces > totalFaces * 0.02 || meshRemoved === 0 || keptFaces.length === 0) {
          return;
        }

        totalRemovedShells += meshRemoved;
        const newIndices = new Uint32Array(keptFaces.length * 3);
        for (let i = 0; i < keptFaces.length; i++) {
          const f = keptFaces[i];
          newIndices[i * 3] = indexArray[f * 3];
          newIndices[i * 3 + 1] = indexArray[f * 3 + 1];
          newIndices[i * 3 + 2] = indexArray[f * 3 + 2];
        }

        // Compactar atributos para eliminar vértices huérfanos
        const attrNames = Object.keys(geometry.attributes);
        const oldArrays: { [name: string]: { array: ArrayLike<number>; itemSize: number } } = {};
        const newArrays: { [name: string]: number[] } = {};
        for (const name of attrNames) {
          const attr = geometry.attributes[name];
          oldArrays[name] = { array: attr.array, itemSize: attr.itemSize };
          newArrays[name] = [];
        }

        const usedMap = new Map<number, number>();
        const remappedIndices = new Uint32Array(newIndices.length);

        for (let i = 0; i < newIndices.length; i++) {
          const oldIdx = newIndices[i];
          let newIdx = usedMap.get(oldIdx);
          if (newIdx === undefined) {
            newIdx = newArrays['position'].length / 3;
            usedMap.set(oldIdx, newIdx);
            for (const name of attrNames) {
              const { array, itemSize } = oldArrays[name];
              for (let k = 0; k < itemSize; k++) {
                newArrays[name].push(array[oldIdx * itemSize + k]);
              }
            }
          }
          remappedIndices[i] = newIdx;
        }

        for (const name of attrNames) {
          const itemSize = oldArrays[name].itemSize;
          const arr = new Float32Array(newArrays[name]);
          geometry.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
        }
        geometry.setIndex(new THREE.BufferAttribute(remappedIndices, 1));
        if (!geometry.attributes.normal) {
          geometry.computeVertexNormals();
        }
        modified = true;
      }
    });

    if (!modified) {
      return {
        object: obj,
        removedFragments: 0,
        report: ['No se detectaron fragmentos de ruido flotante en las sub-mallas del modelo.']
      };
    }

    if (onProgress) await onProgress(85, 'Exportando modelo GLB limpio conservando cinemática y jerarquía...');

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    let totalVertices = 0;
    let totalFaces = 0;
    const meshesList: any[] = [];
    let mCount = 0;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const m = child as THREE.Mesh;
        const geo = m.geometry;
        const verts = geo.attributes.position ? geo.attributes.position.count : 0;
        const faces = geo.index ? geo.index.count / 3 : verts / 3;
        totalVertices += verts;
        totalFaces += faces;
        meshesList.push({
          id: `mesh-${mCount++}`,
          name: child.name || `Sub-mesh ${mCount}`,
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    return {
      object: {
        ...obj,
        stats: {
          vertices: Math.floor(totalVertices),
          faces: Math.floor(totalFaces)
        },
        meshData: {
          type: 'gltf',
          data: url,
          animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
          meshes: meshesList
        }
      },
      removedFragments: totalRemovedShells,
      report: [`Limpieza completada: ${totalRemovedShells} fragmento(s) de ruido eliminado(s). Todas las partes mecánicas y orientación conservadas.`]
    };
  } catch (err) {
    console.error('Error en cleanGLBIslands:', err);
    return { object: obj, removedFragments: 0, report: ['Error durante la limpieza de islas en GLB'] };
  }
}

/**
 * Repara normales invertidas, elimina caras montadas/duplicadas superpuestas y unifica el sombreado.
 * Resuelve el problema de "caras montadas sobre otras", normales invertidas, sombreado negro en paneles y arrugas.
 */
export async function repairGLBNormalsAndOverlaps(
  obj: CSGObject,
  onProgress?: (progress: number, stepText: string) => Promise<void> | void,
  options?: {
    creaseAngleDeg?: number;
    snapPlanar?: boolean;
    flipAll?: boolean;
    unifyWinding?: boolean;
  }
): Promise<{ object: CSGObject; repairedFaces: number; report: string[] }> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') {
    return { object: obj, repairedFaces: 0, report: ['No es un modelo GLB'] };
  }

  try {
    if (onProgress) await onProgress(15, 'Analizando caras montadas, superpuestas y normales invertidas...');

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    const gltf = await new Promise<any>((resolve, reject) =>
      loader.load(obj.meshData!.data, resolve, undefined, reject)
    );

    const scene = gltf.scene;
    let totalDuplicatesRemoved = 0;
    let totalDegeneratesRemoved = 0;
    let totalFlippedFaces = 0;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = child as THREE.Mesh;
        let geometry = mesh.geometry;
        if (!geometry || !geometry.attributes.position) return;

        // Asegurar materiales de doble cara para evitar caras transparentes o negras en paneles delgados
        if (mesh.material) {
          const makeDouble = (m: THREE.Material) => {
            m.side = THREE.DoubleSide;
            (m as any).shadowSide = THREE.DoubleSide;
            m.needsUpdate = true;
          };
          if (Array.isArray(mesh.material)) mesh.material.forEach(makeDouble);
          else makeDouble(mesh.material);
        }

        // Asegurar indexación sin alterar coordenadas UV ni costuras de textura
        if (!geometry.index) {
          const count = geometry.attributes.position.count;
          const indices = new Uint32Array(count);
          for (let i = 0; i < count; i++) indices[i] = i;
          geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }

        const posAttr = geometry.attributes.position;
        const indexAttr = geometry.index!;
        const indexArray = indexAttr.array;
        const totalFaces = Math.floor(indexArray.length / 3);
        if (totalFaces === 0) return;

        // 1. Detectar y eliminar caras duplicadas/montadas coincidentes y caras degeneradas
        const seenFaces = new Set<string>();
        const keptIndices: number[] = [];

        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const pC = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const cross = new THREE.Vector3();

        for (let f = 0; f < totalFaces; f++) {
          const a = indexArray[f * 3];
          const b = indexArray[f * 3 + 1];
          const c = indexArray[f * 3 + 2];

          // Cara degenerada (vértices repetidos en el mismo triángulo)
          if (a === b || b === c || c === a) {
            totalDegeneratesRemoved++;
            continue;
          }

          pA.fromBufferAttribute(posAttr, a);
          pB.fromBufferAttribute(posAttr, b);
          pC.fromBufferAttribute(posAttr, c);

          e1.subVectors(pB, pA);
          e2.subVectors(pC, pA);
          cross.crossVectors(e1, e2);
          if (cross.lengthSq() < 1e-12) {
            totalDegeneratesRemoved++;
            continue;
          }

          // Clave canónica independiente del orden de los vértices
          const sorted = [a, b, c].sort((x, y) => x - y);
          const key = `${sorted[0]}_${sorted[1]}_${sorted[2]}`;

          if (seenFaces.has(key)) {
            // Cara duplicada montada exactamente encima de otra
            totalDuplicatesRemoved++;
          } else {
            seenFaces.add(key);
            keptIndices.push(a, b, c);
          }
        }

        // 2. Voltear todo solo si se solicitó explícitamente
        if (options?.flipAll) {
          for (let f = 0; f < keptIndices.length; f += 3) {
            const tmp = keptIndices[f + 1];
            keptIndices[f + 1] = keptIndices[f + 2];
            keptIndices[f + 2] = tmp;
            totalFlippedFaces++;
          }
        }

        // 3. Aplicar índices limpios (sin alterar posiciones de vértices para mantener texturas 100% nítidas)
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(keptIndices), 1));

        // 4. Recalcular normales limpias con sombreado hard-surface
        const creaseAngleRad = ((options?.creaseAngleDeg ?? 35) * Math.PI) / 180;
        try {
          computeSmoothNormalsByPosition(geometry, creaseAngleRad);
        } catch (eNorm) {
          geometry.computeVertexNormals();
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
      }
    });

    if (onProgress) await onProgress(80, 'Guardando modelo con caras y normales reparadas...');

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        scene,
        (gltfData) => resolve(gltfData as ArrayBuffer),
        (error) => reject(error),
        { binary: true, animations: gltf.animations }
      );
    });

    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    let totalVertices = 0;
    let totalFaces = 0;
    const meshesList: any[] = [];
    let mCount = 0;

    scene.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const m = child as THREE.Mesh;
        const geo = m.geometry;
        const verts = geo.attributes.position ? geo.attributes.position.count : 0;
        const faces = geo.index ? geo.index.count / 3 : verts / 3;
        totalVertices += verts;
        totalFaces += faces;
        meshesList.push({
          id: `mesh-${mCount++}`,
          name: child.name || `Sub-mesh ${mCount}`,
          vertices: Math.floor(verts),
          faces: Math.floor(faces)
        });
      }
    });

    const reportMsg: string[] = [];
    if (totalDuplicatesRemoved > 0) reportMsg.push(`${totalDuplicatesRemoved} caras duplicadas/montadas eliminadas`);
    if (totalDegeneratesRemoved > 0) reportMsg.push(`${totalDegeneratesRemoved} caras degeneradas descartadas`);
    if (totalFlippedFaces > 0) reportMsg.push(`${totalFlippedFaces} caras orientadas correctamente`);
    reportMsg.push('Normales calculadas con protección de aristas y doble cara activada');

    return {
      object: {
        ...obj,
        stats: {
          vertices: Math.floor(totalVertices),
          faces: Math.floor(totalFaces)
        },
        meshData: {
          type: 'gltf',
          data: url,
          animations: gltf.animations ? gltf.animations.map((a: any) => a.toJSON()) : obj.meshData.animations,
          meshes: meshesList
        }
      },
      repairedFaces: totalDuplicatesRemoved + totalDegeneratesRemoved + totalFlippedFaces,
      report: reportMsg
    };
  } catch (err) {
    console.error('Error en repairGLBNormalsAndOverlaps:', err);
    return { object: obj, repairedFaces: 0, report: ['Error reparando caras y normales en GLB'] };
  }
}


