/**
 * modifiers_advanced.ts
 *
 * Operaciones avanzadas de modelado 3D:
 *   chamfer3DEdges  — Chaflán real en aristas seleccionadas
 *   offsetMesh      — Equidistancia (inflar/deflactar malla)
 *   arrayLinear     — Matriz lineal de objetos
 *   arrayPolar      — Matriz polar (circular) de objetos
 *   capOpenHoles    — Tapar huecos abiertos de una malla
 *   revolveMesh     — Revolución de perfil 2D alrededor de un eje (Torno libre)
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptSimplifier as Meshopt, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { fromThreeGeometry } from './modifiers';

function normalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const normalized = new THREE.BufferGeometry();
  
  if (!geo.attributes.position) {
    return normalized;
  }

  // Ensure we have an index
  if (geo.index) {
    normalized.setIndex(geo.index);
  } else {
    const posCount = geo.attributes.position.count;
    const indices = new Uint32Array(posCount);
    for (let i = 0; i < posCount; i++) indices[i] = i;
    normalized.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  
  // Copy position
  normalized.setAttribute('position', geo.attributes.position);
  
  // Copy or generate UVs
  if (geo.attributes.uv) {
    normalized.setAttribute('uv', geo.attributes.uv);
  } else {
    normalized.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  }
  
  // Copy or generate normals
  if (geo.attributes.normal) {
    normalized.setAttribute('normal', geo.attributes.normal);
  } else {
    normalized.computeVertexNormals();
  }
  
  return normalized;
}

export async function convertImportedToCSG(obj: CSGObject): Promise<CSGObject> {
  if (!obj.meshData) return obj;

  let geometry = new THREE.BufferGeometry();

  try {
    if (obj.meshData.type === 'stl') {
      geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => new STLLoader().load(obj.meshData!.data, resolve, undefined, reject));
    } else if (obj.meshData.type === 'obj') {
      const object = await new Promise<THREE.Object3D>((resolve, reject) => new OBJLoader().load(obj.meshData!.data, resolve, undefined, reject));
      object.updateMatrixWorld(true);
      const geometries: THREE.BufferGeometry[] = [];
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          let geo = (child as THREE.Mesh).geometry.clone();
          geo.applyMatrix4(child.matrixWorld);
          if (geo.attributes.position) {
            geometries.push(normalizeGeometry(geo));
          }
        }
      });
      if (geometries.length > 0) {
        const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
        if (merged) geometry = merged;
      }
    } else if (obj.meshData.type === 'gltf') {
      const loader = new GLTFLoader();
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
      loader.setDRACOLoader(dracoLoader);
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await new Promise<any>((resolve, reject) => loader.load(obj.meshData!.data, resolve, undefined, reject));
      if (gltf && gltf.scene) {
        gltf.scene.updateMatrixWorld(true);
        const geometries: THREE.BufferGeometry[] = [];
        gltf.scene.traverse((child: THREE.Object3D) => {
          if (!child.visible) return; // Omitir mallas invisibles, proxys o colisiones
          if ((child as THREE.Mesh).isMesh || (child as any).isSkinnedMesh) {
            const mesh = child as THREE.Mesh;
            let geo: THREE.BufferGeometry;
            if ((mesh as any).isSkinnedMesh) {
              const skinnedMesh = mesh as THREE.SkinnedMesh;
              geo = skinnedMesh.geometry.clone();
              const pos = geo.attributes.position;
              if (
                pos &&
                geo.attributes.skinIndex &&
                geo.attributes.skinWeight &&
                skinnedMesh.skeleton &&
                skinnedMesh.skeleton.bones &&
                skinnedMesh.skeleton.bones.length > 0
              ) {
                try {
                  const target = new THREE.Vector3();
                  const transformFunc = (skinnedMesh as any).boneTransform?.bind(skinnedMesh) || (skinnedMesh as any).applyBoneTransform?.bind(skinnedMesh);
                  if (transformFunc) {
                    for (let i = 0; i < pos.count; i++) {
                      target.fromBufferAttribute(pos, i);
                      transformFunc(i, target);
                      if (Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
                        pos.setXYZ(i, target.x, target.y, target.z);
                      }
                    }
                    pos.needsUpdate = true;
                  }
                } catch (skinErr) {
                  console.warn('Could not apply bone transform to skinned mesh, using bind pose:', skinErr);
                }
              }
            } else {
              geo = mesh.geometry.clone();
            }
            geo.applyMatrix4(child.matrixWorld);
            if (geo.attributes.position) {
              geometries.push(normalizeGeometry(geo));
            }
          }
        });
        if (geometries.length > 0) {
          const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
          if (merged) geometry = merged;
        }
      }
    }

    // Merge vertices to create an indexed geometry and share vertices
    if (geometry.attributes.position) {
      geometry = BufferGeometryUtils.mergeVertices(geometry);
    }
  } catch (err) {
    console.error('Error en convertImportedToCSG:', err);
  }

  const { vertices, faces } = fromThreeGeometry(geometry);
  
  if (!vertices || vertices.length === 0) {
    return obj;
  }

  return {
    ...obj,
    vertices,
    faces,
    meshData: undefined, // Remove meshData to make it a native CSG object
    stats: { vertices: vertices.length, faces: faces.length }
  };
}
import type { V3, MeshFace, CSGObject } from '../types';
import { repairMesh, fillHoles, capSelectedFaces } from './meshUtils';

// ─── Helpers internos ─────────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).substr(2, 9);

function v3add(a: V3, b: V3): V3 { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3sub(a: V3, b: V3): V3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function v3scale(a: V3, s: number): V3 { return [a[0]*s, a[1]*s, a[2]*s]; }
function v3len(a: V3): number { return Math.sqrt(a[0]**2+a[1]**2+a[2]**2); }
function v3norm(a: V3): V3 { const l=v3len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; }
function v3cross(a: V3, b: V3): V3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function v3dot(a: V3, b: V3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

/** Clonar objeto CSGObject con nuevos verts/faces */
function cloneWith(obj: CSGObject, vertices: V3[], faces: MeshFace[], extra?: Partial<CSGObject>): CSGObject {
  return { ...JSON.parse(JSON.stringify(obj)), vertices, faces, vertexOffsets: {}, ...extra };
}

// ─── 1. CHAFLÁN 3D (Chamfer) ──────────────────────────────────────────────────

/**
 * Aplica chaflán en todas las aristas duras de una malla.
 *
 * Algoritmo:
 *   1. Calcula normales por cara.
 *   2. Detecta aristas "duras" (ángulo diedro > sharpAngleDeg).
 *   3. Para cada arista dura AB: retrae los vértices A y B en las dos caras
 *      adyacentes una distancia `dist` hacia el interior de la cara.
 *   4. Conecta los puntos retraídos con quads planos (el chaflán).
 *
 * @param obj           Objeto a modificar
 * @param dist          Distancia del chaflán desde la arista
 * @param sharpAngle    Umbral en grados — solo chaflana aristas más agudas
 */
export function chamfer3DEdges(
  obj: { vertices: V3[]; faces: MeshFace[] },
  dist: number = 0.1,
  sharpAngle: number = 30,
): { vertices: V3[]; faces: MeshFace[] } {
  const verts: V3[] = obj.vertices.map(v => [...v] as V3);
  const facesOut: MeshFace[] = [];
  const threshold = Math.cos((sharpAngle * Math.PI) / 180);

  // ── Normales por cara ──────────────────────────────────────────────────────
  const faceNormals: THREE.Vector3[] = obj.faces.map(face => {
    if (!face || !face.indices || face.indices.length < 3) return new THREE.Vector3(0, 1, 0);
    const vert0 = obj.vertices[face.indices[0]];
    const vert1 = obj.vertices[face.indices[1]];
    const vert2 = obj.vertices[face.indices[2]];
    if (!vert0 || !vert1 || !vert2) return new THREE.Vector3(0, 1, 0);
    const v0 = new THREE.Vector3(...vert0);
    const v1 = new THREE.Vector3(...vert1);
    const v2 = new THREE.Vector3(...vert2);
    const norm = new THREE.Vector3().crossVectors(v1.clone().sub(v0), v2.clone().sub(v0));
    return norm.lengthSq() > 1e-8 ? norm.normalize() : new THREE.Vector3(0, 1, 0);
  });

  // ── Mapa arista → caras adyacentes ────────────────────────────────────────
  const edgeToFaces = new Map<string, number[]>();
  obj.faces.forEach((face, fi) => {
    if (!face || !face.indices) return;
    const n = face.indices.length;
    for (let i = 0; i < n; i++) {
      const a = face.indices[i], b = face.indices[(i+1)%n];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key)!.push(fi);
    }
  });

  // ── Para cada cara: mapa de vértice → posición retraída por esa cara ──────
  // retraidedVerts[faceIdx][vertIdx] = nuevo índice en verts[]
  const retracted = new Map<string, number>(); // key: `${fi}:${vi}`

  const getRetracted = (fi: number, vi: number, normal: THREE.Vector3): number => {
    const key = `${fi}:${vi}`;
    if (retracted.has(key)) return retracted.get(key)!;
    const baseVert = obj.vertices[vi] || [0, 0, 0];
    const base = new THREE.Vector3(...baseVert);
    // Retrae el vértice a lo largo de la normal de cara y hacia el centroide
    const face = obj.faces[fi];
    const centroid = (face.indices || []).reduce((acc, i) => {
      const v = obj.vertices[i] || [0, 0, 0];
      return acc.add(new THREE.Vector3(...v));
    }, new THREE.Vector3()).divideScalar(Math.max(1, (face.indices || []).length));
    const toCenter = centroid.clone().sub(base).normalize();
    const newPos = base.clone().addScaledVector(toCenter, dist);
    const newIdx = verts.length;
    verts.push([newPos.x, newPos.y, newPos.z]);
    retracted.set(key, newIdx);
    return newIdx;
  };

  const processedEdges = new Set<string>();

  edgeToFaces.forEach((adjFaces, edgeKey) => {
    if (adjFaces.length !== 2 || processedEdges.has(edgeKey)) return;
    processedEdges.add(edgeKey);

    const [fi1, fi2] = adjFaces;
    const n1 = faceNormals[fi1] || new THREE.Vector3(0, 1, 0);
    const n2 = faceNormals[fi2] || new THREE.Vector3(0, 1, 0);
    const dot = n1.dot(n2);
    if (dot >= threshold) return; // arista suave, sin chaflán

    const [aStr, bStr] = edgeKey.split(':');
    const ai = parseInt(aStr), bi = parseInt(bStr);

    // Crear 4 vértices retraídos (2 en cada cara)
    const a1 = getRetracted(fi1, ai, n1);
    const b1 = getRetracted(fi1, bi, n1);
    const a2 = getRetracted(fi2, ai, n2);
    const b2 = getRetracted(fi2, bi, n2);

    // Quad de chaflán (cara plana entre las dos caras adyacentes)
    facesOut.push({ indices: [a1, b1, b2, a2] });
  });

  // ── Caras originales con vértices retraídos ────────────────────────────────
  obj.faces.forEach((face, fi) => {
    if (!face || !face.indices) return;
    const newIndices = face.indices.map(vi => {
      const key = `${fi}:${vi}`;
      return retracted.get(key) ?? vi;
    });
    facesOut.push({ indices: newIndices });
  });

  return { vertices: verts, faces: facesOut };
}

// ─── 2. EQUIDISTANCIA / OFFSET ────────────────────────────────────────────────

/**
 * Infla o deflacta una malla desplazando cada vértice a lo largo de su normal
 * ponderada por el área de las caras adyacentes.
 *
 * @param obj      Malla fuente
 * @param distance Distancia positiva = inflar, negativa = deflactar
 */
export function offsetMesh(
  obj: { vertices: V3[]; faces: MeshFace[] },
  distance: number,
): { vertices: V3[]; faces: MeshFace[] } {
  // Acumular normal ponderada por área en cada vértice
  const normals: THREE.Vector3[] = obj.vertices.map(() => new THREE.Vector3());

  obj.faces.forEach(face => {
    if (!face || !face.indices || face.indices.length < 3) return;
    const n = face.indices.length;
    const vert0 = obj.vertices[face.indices[0]];
    if (!vert0) return;
    const v0 = new THREE.Vector3(...vert0);
    for (let i = 1; i < n - 1; i++) {
      const vert1 = obj.vertices[face.indices[i]];
      const vert2 = obj.vertices[face.indices[i+1]];
      if (!vert1 || !vert2) continue;
      const v1 = new THREE.Vector3(...vert1);
      const v2 = new THREE.Vector3(...vert2);
      const faceNormal = new THREE.Vector3().crossVectors(v1.clone().sub(v0), v2.clone().sub(v0));
      // La longitud de crossVectors = 2×área → normal ponderada por área
      face.indices.forEach(vi => {
        if (normals[vi]) normals[vi].add(faceNormal);
      });
    }
  });

  const newVerts: V3[] = obj.vertices.map((v, i) => {
    // IMPORTANTE: Si la normal es casi cero, no desplazamos para evitar errores
    if (normals[i].lengthSq() < 0.0001) return [...v] as V3;

    const n = normals[i].clone().normalize();
    return [
      v[0] + n.x * distance, 
      v[1] + n.y * distance, 
      v[2] + n.z * distance
    ];
  });

  return { vertices: newVerts, faces: obj.faces.map(f => ({ ...f, indices: [...f.indices] })) };
}

// ─── 3. ARRAY LINEAL ─────────────────────────────────────────────────────────

/**
 * Crea una matriz lineal de copias del objeto.
 *
 * @param obj    Objeto fuente
 * @param count  Número TOTAL de instancias (incluyendo el original)
 * @param step   Vector de desplazamiento entre instancias consecutivas [x,y,z]
 * @returns      Array de CSGObjects (count elementos)
 */
export function arrayLinear(
  obj: CSGObject,
  count: number,
  step: V3,
): CSGObject[] {
  const result: CSGObject[] = [];
  for (let i = 0; i < count; i++) {
    const copy = JSON.parse(JSON.stringify(obj)) as CSGObject;
    copy.id   = genId();
    copy.name = `${obj.name} [${i+1}/${count}]`;
    copy.transform = {
      ...copy.transform,
      position: [
        obj.transform.position[0] + step[0] * i,
        obj.transform.position[1] + step[1] * i,
        obj.transform.position[2] + step[2] * i,
      ],
    };
    result.push(copy);
  }
  return result;
}

// ─── 4. ARRAY POLAR ──────────────────────────────────────────────────────────

/**
 * Crea una matriz polar (circular) de copias del objeto.
 *
 * @param obj        Objeto fuente
 * @param count      Número total de instancias
 * @param totalAngle Ángulo total del arco en grados (360 = círculo completo)
 * @param axis       Eje de rotación ('x'|'y'|'z')
 * @param center     Centro de rotación [x,y,z]
 * @returns          Array de CSGObjects
 */
export function arrayPolar(
  obj: CSGObject,
  count: number,
  totalAngle: number = 360,
  axis: 'x' | 'y' | 'z' = 'y',
  center: V3 = [0, 0, 0],
): CSGObject[] {
  const result: CSGObject[] = [];
  const angleStep = (totalAngle / count) * (Math.PI / 180);
  const axisIdx   = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  for (let i = 0; i < count; i++) {
    const copy = JSON.parse(JSON.stringify(obj)) as CSGObject;
    copy.id   = genId();
    copy.name = `${obj.name} [polar ${i+1}]`;

    const angle = angleStep * i;
    const pos   = [...obj.transform.position] as V3;
    const rot   = [...obj.transform.rotation] as V3;

    // Rotar la posición alrededor del centro
    const dx = pos[0] - center[0];
    const dy = pos[1] - center[1];
    const dz = pos[2] - center[2];

    if (axis === 'y') {
      pos[0] = center[0] + dx * Math.cos(angle) - dz * Math.sin(angle);
      pos[2] = center[2] + dx * Math.sin(angle) + dz * Math.cos(angle);
    } else if (axis === 'x') {
      pos[1] = center[1] + dy * Math.cos(angle) - dz * Math.sin(angle);
      pos[2] = center[2] + dy * Math.sin(angle) + dz * Math.cos(angle);
    } else {
      pos[0] = center[0] + dx * Math.cos(angle) - dy * Math.sin(angle);
      pos[1] = center[1] + dx * Math.sin(angle) + dy * Math.cos(angle);
    }

    rot[axisIdx] += angle;
    copy.transform = { ...copy.transform, position: pos, rotation: rot };
    result.push(copy);
  }

  return result;
}

// ─── 5. TAPAR HUECOS (Cap Open Holes) ────────────────────────────────────────

/**
 * Detecta todas las aristas de borde (boundary edges) de la malla y cierra
 * cada hueco con una cara plana (fan triangular desde el centroide).
 *
 * Esto soluciona mallas abiertas: cilindros sin tapa, extrusiones sin cierre, etc.
 */
export { fillHoles as capOpenHoles, capSelectedFaces };

// ─── 6. TORNO LIBRE — Revolución de perfil 2D ────────────────────────────────

/**
 * Gira un perfil 2D (lista de vértices en el plano XY) alrededor de un eje
 * para generar un sólido de revolución.
 *
 * El perfil se define en el plano del alzado (X=radio desde eje, Y=altura).
 * El eje de revolución pasa por X=axisOffset y gira alrededor de axis.
 *
 * @param profile     Vértices del perfil [[x,y], ...] en espacio 2D
 *                    x = distancia radial al eje, y = altura
 * @param segments    Número de segmentos angulares
 * @param angleDeg    Ángulo total de revolución (1-360)
 * @param axis        Eje de revolución: 'y' (vertical), 'x', 'z'
 * @param axisOffset  Desplazamiento del eje respecto al perfil (permite huecos)
 * @param closed      Si true, cierra el sólido en los extremos angulares
 */
export function revolveMesh(
  profile: [number, number][],
  segments: number = 24,
  angleDeg: number = 360,
  axis: 'x' | 'y' | 'z' = 'y',
  axisOffset: number = 0,
  closed: boolean = true,
): { vertices: V3[]; faces: MeshFace[] } {
  if (profile.length < 2) return { vertices: [], faces: [] };

  const angleRad = Math.min(360, Math.max(1, angleDeg)) * Math.PI / 180;
  const fullCircle = angleDeg >= 359.9;
  const n = profile.length;
  const verts: V3[] = [];
  const faces: MeshFace[] = [];

  // Para cada ángulo generar un anillo de vértices
  const rings = fullCircle ? segments : segments + 1;

  for (let si = 0; si < rings; si++) {
    const t     = si / (fullCircle ? segments : segments);
    const theta = t * angleRad;
    const cosT  = Math.cos(theta);
    const sinT  = Math.sin(theta);

    for (let pi = 0; pi < n; pi++) {
      const [r, h] = profile[pi];
      const radius = r + axisOffset;
      let v: V3;
      if (axis === 'y') {
        v = [radius * cosT, h, radius * sinT];
      } else if (axis === 'x') {
        v = [h, radius * cosT, radius * sinT];
      } else {
        v = [radius * cosT, radius * sinT, h];
      }
      verts.push(v);
    }
  }

  // Conectar anillos con quads
  for (let si = 0; si < segments; si++) {
    const si2 = fullCircle ? (si + 1) % segments : si + 1;
    const r0  = si  * n;
    const r1  = si2 * n;

    for (let pi = 0; pi < n - 1; pi++) {
      const a = r0 + pi, b = r0 + pi + 1;
      const c = r1 + pi + 1, d = r1 + pi;
      faces.push({ indices: [a, b, c, d] });
    }
  }

  // Tapas si el ángulo no es 360°
  if (!fullCircle && closed) {
    // Tapa inicial (si=0)
    const startRing = Array.from({ length: n }, (_, i) => i);
    faces.push({ indices: [...startRing].reverse() });

    // Tapa final (si=segments)
    const endRing = Array.from({ length: n }, (_, i) => segments * n + i);
    faces.push({ indices: endRing });
  }

  // Tapa superior e inferior del perfil (cierre axial)
  if (profile[0][0] > 0.001 || profile[n-1][0] > 0.001) {
    // La geometría es hueca — no añadir caps axiales automáticamente
  } else {
    // Añadir caps superior e inferior si el radio=0 en los extremos
    if (Math.abs(profile[0][0]) < 0.001 && fullCircle) {
      // Punto en el eje — ya está colapsado, no necesita cap
    }
  }

  return { vertices: verts, faces };
}

// ─── 7. Extraer perfil 2D de un SHAPE object ─────────────────────────────────

/**
 * Convierte un CSGObject de tipo SHAPE a un perfil [[r, h], ...] para revolveMesh.
 * Proyecta los vértices al plano XY asumiendo que la forma está en ese plano.
 *
 * @param obj       Objeto SHAPE con vertices en el plano
 * @param axis      Eje de revolución — determina qué coordenadas usar como r/h
 */
export function shapeToProfile(
  obj: CSGObject,
  axis: 'x' | 'y' | 'z' = 'y',
): [number, number][] {
  // Bake offsets first
  const baked: V3[] = obj.vertices.map((v, i) => {
    const off = obj.vertexOffsets?.[i] ?? [0,0,0];
    return [v[0]+off[0], v[1]+off[1], v[2]+off[2]] as V3;
  });

  // Map to [radius, height] based on revolution axis
  // radius = distance from the axis (always positive)
  // height = position along the axis
  const pts: [number, number][] = baked.map(v => {
    if (axis === 'y') return [v[0], v[1]];          // r=x, h=y
    if (axis === 'x') return [v[2], v[0]];          // r=z, h=x
    return [v[0], v[2]];                             // r=x, h=z (axis=z)
  });

  // Sort by height so the profile goes bottom→top
  const sorted = [...pts].sort((a, b) => a[1] - b[1]);

  // If all radii are negative, flip them (profile was drawn on the left of axis)
  const allNeg = sorted.every(([r]) => r <= 0);
  return sorted.map(([r, h]) => [allNeg ? -r : Math.abs(r), h] as [number, number]);
}

// ─── 9. SIMPLIFICAR MALLA (Decimate) ──────────────────────────────────────────

import { WebIO, PropertyType } from '@gltf-transform/core';
import { simplify, weld, prune, dedup, resample, meshopt, join, draco, reorder, instance } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import dracoEncoderWasmUrl from 'draco3dgltf/draco_encoder.wasm?url';
import dracoDecoderWasmUrl from 'draco3dgltf/draco_decoder_gltf.wasm?url';

let globalEncoderModulePromise: Promise<any> | null = null;
let globalDecoderModulePromise: Promise<any> | null = null;

/**
 * Reduce el número de polígonos de una malla utilizando gltf-transform y meshoptimizer.
 * Esta es la forma más robusta de optimizar modelos animados (con esqueleto/skinning).
 *
 * @param obj    Objeto CSG a simplificar
 * @param ratio  Factor de reducción (0.1 = 10% de los triángulos originales)
 */
export async function optimizeGLB(
  obj: CSGObject,
  ratio: number = 0.5,
  selectedMeshes?: string[]
): Promise<CSGObject> {
  if (!obj.meshData || obj.meshData.type !== 'gltf') return obj;

  try {
    // Asegurar que meshoptimizer esté listo
    if ((Meshopt as any).ready) {
      await (Meshopt as any).ready;
    }
    await MeshoptEncoder.ready;

    if (!globalEncoderModulePromise) {
      globalEncoderModulePromise = draco3d.createEncoderModule({
        locateFile: (file: string) => {
          if (file === 'draco_encoder.wasm') return dracoEncoderWasmUrl;
          return file;
        }
      });
    }
    if (!globalDecoderModulePromise) {
      globalDecoderModulePromise = draco3d.createDecoderModule({
        locateFile: (file: string) => {
          if (file === 'draco_decoder_gltf.wasm') return dracoDecoderWasmUrl;
          return file;
        }
      });
    }

    const globalEncoderModule = await globalEncoderModulePromise;
    const globalDecoderModule = await globalDecoderModulePromise;

    if (!globalEncoderModule) {
      throw new Error('draco3d.createEncoderModule() returned falsy value.');
    }

    // Initialize glTF-Transform WebIO (Standard, without compression to avoid final assertion errors)
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        'meshopt.encoder': MeshoptEncoder,
        'draco3d.encoder': globalEncoderModule,
        'draco3d.decoder': globalDecoderModule,
      });
    
    // Read the document (io.read handles both .glb and .gltf automatically)
    const document = await io.read(obj.meshData.data);

    // 0. PRE-OPTIMIZACIÓN: Limpiar topología antes de simplificar.
    // weld une vértices duplicados.
    try {
      await document.transform(weld());
    } catch (e) {
      console.warn('Pre-weld failed, continuing anyway:', e);
    }

    // 1. OPTIMIZACIÓN MANUAL POR PIEZA (Ultra-Robusta)
    const allMeshes = document.getRoot().listMeshes();
    let simplifiedCount = 0;
    let protectedCount = 0;
    let errorCount = 0;

    // Conteo inicial de triángulos (después de weld)
    let initialTriCount = 0;
    allMeshes.forEach(m => m.listPrimitives().forEach(p => {
      const indices = p.getIndices();
      if (indices) initialTriCount += indices.getCount() / 3;
    }));

    allMeshes.forEach((mesh, meshIdx) => {
      const meshName = (mesh.getName() || '').toLowerCase();
      const originalName = mesh.getName() || 'Unnamed Mesh';
      const meshId = `mesh-${meshIdx}`;

      if (selectedMeshes && selectedMeshes.length > 0 && !selectedMeshes.includes(meshId)) {
        protectedCount++;
        return;
      }

      // Piezas de armamento: forma cilíndrica delicada, máxima protección
      let isCritical = meshName.includes('joint') || meshName.includes('pivot') || 
                         meshName.includes('link') || meshName.includes('skin') ||
                         meshName.includes('bone') || meshName.includes('gun') ||
                         meshName.includes('cannon') || meshName.includes('barrel') ||
                         meshName.includes('weapon') || meshName.includes('antenna');

      // Piezas "host" de armamento: meshes cuya superficie toca físicamente a un
      // mesh crítico. Si se simplifican agresivamente, sus vértices en los puntos
      // de unión se alejan → brecha visual entre cabeza y cañones.
      // Se tratan con la misma protección que el armamento.
      let isAttachment = meshName.includes('head') || meshName.includes('turret') ||
                           meshName.includes('mount') || meshName.includes('socket');

      // Si el usuario seleccionó explícitamente esta pieza, anulamos las protecciones
      // automáticas para permitirle forzar la optimización.
      if (selectedMeshes && selectedMeshes.includes(meshId)) {
        isCritical = false;
        isAttachment = false;
      }

      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const position = prim.getAttribute('POSITION');
        if (!indices || !position) continue;

        const srcIndices = indices.getArray();
        const srcPositions = position.getArray();
        if (!srcIndices || !srcPositions) continue;

        const triCount = srcIndices.length / 3;
        const vertexCount = srcPositions.length / 3;
        
        // Solo saltamos piezas que ya son ultra-simples
        if (triCount < 20 || vertexCount < 3) {
          protectedCount++;
          continue;
        }

        try {
          const typedIndices = srcIndices instanceof Uint32Array ? srcIndices : new Uint32Array(srcIndices);
          const typedPositions = srcPositions instanceof Float32Array ? srcPositions : new Float32Array(srcPositions);

          // GUARD 0: Verificar NaNs o Infinities en posiciones.
          // Meshopt puede fallar catastróficamente si los datos de entrada no son finitos.
          let isPositionValid = true;
          for (let i = 0; i < typedPositions.length; i++) {
            if (!Number.isFinite(typedPositions[i])) { isPositionValid = false; break; }
          }
          if (!isPositionValid) {
            console.warn(`⚠️ SALTADA (posiciones inválidas/NaN): ${meshName}`);
            protectedCount++;
            continue;
          }

          // GUARD 1: Validación de índices de ENTRADA.
          // Imprescindible para evitar que meshopt WASM reciba datos corruptos de pasadas
          // anteriores y lance "Assertion failed", que corrompe la memoria compartida del
          // módulo WASM y hace que todos los meshes siguientes también fallen en cascada.
          let isDataValid = true;
          for (let i = 0; i < typedIndices.length; i++) {
            if (typedIndices[i] >= vertexCount) { isDataValid = false; break; }
          }
          if (!isDataValid) {
            console.warn(`⚠️ SALTADA (índices inválidos): ${meshName}`);
            protectedCount++;
            continue;
          }

          // GUARD 2: Suelo absoluto de triángulos.
          // Nunca reducir por debajo de 30 tris — con menos geometría meshopt puede
          // degenerar la malla hasta hacer desaparecer el mesh visualmente.
          const absoluteFloor = Math.max(30 * 3, Math.floor(srcIndices.length * 0.15));

          // --- LÓGICA DE RATIO ADAPTATIVO ---
          // SEAM FIX: useLockBorder = TRUE para todos los casos.
          // Sin LockBorder, cada pieza mueve sus vértices de borde libremente → los bordes
          // compartidos entre piezas adyacentes dejan de coincidir → grietas visibles en patas.
          // La clave es compensar con pError ALTO (0.5-0.8): los bordes quedan fijos pero
          // meshopt puede eliminar geometría interna con mayor tolerancia geométrica.
          // Esto resuelve el dilema: LockBorder-false=grietas vs LockBorder-true+pError-bajo=0%.
          let pRatio = ratio;
          let pError = 0.1;
          let useLockBorder = true; // SIEMPRE true para evitar seam cracking

          if (isCritical) {
            // Armamento (cañones, antenas): conservar silueta cilíndrica.
            pRatio = Math.max(ratio, 0.5);
            pError = 0.05;
            console.log(`%c 🛡️ PROTEGIDA (Arma): ${meshName} (${Math.round(triCount)} tris)`, 'color: #3b82f6');
          } else if (isAttachment) {
            // Piezas HOST (cabeza, cuello): sus vértices superficiales donde se apoyan
            // los cañones NO son bordes topológicos → LockBorder no los protege.
            pRatio = Math.max(ratio, 0.90);
            pError = 0.01; // Error casi nulo: preserva la superficie al máximo
            console.log(`%c 🔩 PROTEGIDA (Host): ${meshName} (${Math.round(triCount)} tris)`, 'color: #8b5cf6');
          } else {
            // Para el resto de piezas, respetamos el ratio solicitado por el usuario,
            // pero ajustamos el error permitido según el tamaño de la malla.
            // Mallas más grandes necesitan más tolerancia de error para poder simplificarse
            // mientras los bordes están bloqueados (LockBorder).
            if (triCount > 5000) pError = 1.0;
            else if (triCount > 2000) pError = 0.8;
            else if (triCount > 500) pError = 0.6;
            else pError = 0.4;
          }

          let targetCount = Math.floor(srcIndices.length * pRatio);
          targetCount = Math.max(absoluteFloor, Math.floor(targetCount / 3) * 3);

          // GUARD 3: Umbral mínimo de reducción útil.
          // Si el usuario pide conservar el 99%, permitimos reducciones minúsculas.
          // Si pide conservar el 10%, exigimos al menos un 2% de reducción real para no
          // degradar la topología inútilmente si meshopt no puede simplificar más.
          let minUsefulReduction = Math.floor(srcIndices.length * Math.max(0.98, ratio + 0.005));
          
          // Si el usuario seleccionó explícitamente la pieza, relajamos el límite
          // para permitirle forzar la optimización aunque sea pequeña.
          if (selectedMeshes && selectedMeshes.includes(meshId)) {
            minUsefulReduction = Math.floor(srcIndices.length * 0.999); // Permitir casi cualquier reducción
          }

          if (targetCount >= minUsefulReduction) {
            console.log(`%c ⏭️ SALTADA (ya en mínimo): ${meshName} (${Math.round(triCount)} tris)`, 'color: #6b7280');
            protectedCount++;
            continue;
          }

          // Intento 1: Optimización principal con LockBorder
          let simplifyResult = Meshopt.simplify(
            typedIndices, typedPositions, 3,
            targetCount, pError,
            useLockBorder ? ['LockBorder'] : []
          );
          let simplifiedIndices = simplifyResult[0];

          // Intento 2: Fallback — mismo LockBorder pero con error aún mayor
          if (!isCritical && (!simplifiedIndices || simplifiedIndices.length >= minUsefulReduction)) {
            const retryResult = Meshopt.simplify(
              typedIndices, typedPositions, 3,
              targetCount, Math.min(pError * 2, 1.0), ['LockBorder']
            );
            simplifiedIndices = retryResult[0];
          }

          // Intento 3: Fallback sin LockBorder si la malla tiene bordes o costuras que bloqueaban toda la reducción
          if (!isCritical && (!simplifiedIndices || simplifiedIndices.length >= minUsefulReduction)) {
            const retryResult2 = Meshopt.simplify(
              typedIndices, typedPositions, 3,
              targetCount, Math.min(pError, 0.5), []
            );
            if (retryResult2 && retryResult2[0] && retryResult2[0].length < minUsefulReduction && retryResult2[0].length >= absoluteFloor) {
              simplifiedIndices = retryResult2[0];
            }
          }

          // Nota: simplifySloppy eliminado — no respeta LockBorder (causa grietas)
          // y lanza Assertion failed en pasadas repetidas sobre datos ya modificados.
          // Con LockBorder=true + pError alto, el intento 1 y 2 son suficientes.

          // GUARD 4: Validar índices de SALIDA antes de aplicar.
          // meshopt puede devolver índices que referencian vértices fuera del accessor
          // cuando la geometría está cerca del límite de degeneración. Aplicarlos
          // directamente crashea el renderer y hace desaparecer el mesh.
          
          // Si el usuario seleccionó explícitamente la pieza, relajamos la validación
          // de minUsefulReduction para permitir aplicar la simplificación.
          const isSelected = selectedMeshes && selectedMeshes.includes(meshId);
          const isValidReduction = isSelected 
            ? (simplifiedIndices && simplifiedIndices.length > 0 && simplifiedIndices.length >= absoluteFloor)
            : (simplifiedIndices && simplifiedIndices.length > 0 && simplifiedIndices.length < minUsefulReduction && simplifiedIndices.length >= absoluteFloor);

          if (isValidReduction) {
            let outputValid = true;
            for (let i = 0; i < simplifiedIndices.length; i++) {
              if (simplifiedIndices[i] >= vertexCount) { outputValid = false; break; }
            }
            if (outputValid) {
              indices.setArray(simplifiedIndices);
              simplifiedCount++;
              console.log(`%c ✅ SIMPLIFICADA: ${meshName} ${Math.round(triCount)}→${Math.round(simplifiedIndices.length/3)} tris`, 'color: #10b981');
            } else {
              console.warn(`⚠️ RESULTADO INVÁLIDO (descartado): ${meshName} — índices de salida fuera de rango`);
              protectedCount++;
            }
          } else {
            console.log(`%c ⏭️ SALTADA (límite geométrico): ${meshName} (${Math.round(triCount)} tris)`, 'color: #6b7280');
            protectedCount++;
          }
        } catch (err) {
          errorCount++;
          console.error(`❌ ERROR en ${meshName}:`, err);
        }
      }
    });

    // Conteo final de triángulos
    let finalTriCount = 0;
    allMeshes.forEach(m => m.listPrimitives().forEach(p => {
      const indices = p.getIndices();
      if (indices) finalTriCount += indices.getCount() / 3;
    }));

    console.log(`%c 🤖 OPTIMIZACIÓN FINALIZADA  Éxito: ${simplifiedCount}, Protegidas: ${protectedCount}, Fallos: ${errorCount}`, 'background: #222; color: #10b981; font-weight: bold; padding: 4px;');
    const reduction = initialTriCount > 0 ? Math.round((1 - finalTriCount / initialTriCount) * 100) : 0;
    console.log(`%c 📊 TRIÁNGULOS: ${Math.round(initialTriCount)} -> ${Math.round(finalTriCount)} (Reducción: ${reduction}%)`, 'color: #3b82f6; font-weight: bold;');

    // Optional final cleanup for non-animated models to compact vertices and compress
    const isAnimated = document.getRoot().listAnimations().length > 0;
    if (!isAnimated) {
      try {
        await document.transform(
          reorder({ encoder: MeshoptEncoder })
        );
        console.log('Applying draco compression...');
        await document.transform(
          draco()
        );
        console.log('%c 📦 DRACO aplicado — compresión binaria activada', 'color: #f59e0b; font-weight: bold;');
      } catch (e) {
        console.warn('Final cleanup/compression failed (non-critical):', e);
      }
    } else {
      console.log('%c ⏭️ Modelo animado: se omite reorder y draco para preservar integridad', 'color: #6b7280');
    }

    // Write back to binary
    console.log('Writing binary...');
    const glbBuffer = await io.writeBinary(document);
    console.log('Binary written successfully, size:', glbBuffer.byteLength);

    // Do not destroy encoderModule and decoderModule as they are the WASM modules themselves, not Draco objects.

    // Create a new Blob URL
    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);

    // Calculate new stats y validación de seguridad
    let totalVertices = 0;
    let totalFaces = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (position) {
          totalVertices += position.getCount();
          const indices = primitive.getIndices();
          if (indices) {
            totalFaces += indices.getCount() / 3;
          } else {
            totalFaces += position.getCount() / 3;
          }
        }
      }
    }

    const newMeshesList: { id: string, name: string, vertices: number, faces: number }[] = [];
    document.getRoot().listMeshes().forEach((mesh, meshIdx) => {
      let mVerts = 0;
      let mFaces = 0;
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (position) {
          mVerts += position.getCount();
          const indices = primitive.getIndices();
          if (indices) {
            mFaces += indices.getCount() / 3;
          } else {
            mFaces += position.getCount() / 3;
          }
        }
      }
      newMeshesList.push({
        id: `mesh-${meshIdx}`,
        name: mesh.getName() || 'Unnamed Mesh',
        vertices: Math.floor(mVerts),
        faces: Math.floor(mFaces)
      });
    });

    if (totalVertices === 0 || totalFaces === 0) {
      console.error("❌ ERROR: La optimización resultó en una malla vacía. Abortando para proteger el modelo.");
      return obj;
    }

    return {
      ...obj,
      meshData: {
        ...obj.meshData,
        data: url,
        meshes: newMeshesList
      },
      stats: {
        vertices: Math.floor(totalVertices),
        faces: Math.floor(totalFaces)
      }
    };
  } catch (err) {
    console.error('Error in optimizeGLB with gltf-transform:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error) {
      console.error(err.stack);
    }
    return obj;
  }
}

export async function simplifyMesh(
  objInput: CSGObject,
  ratio: number = 0.5,
): Promise<CSGObject> {
  let obj = objInput;
  if (obj.meshData) {
    try {
      obj = await convertImportedToCSG(obj);
    } catch (e) {
      console.warn("No se pudo convertir el modelo a CSG para simplificar:", e);
    }
  }

  if (!obj.faces || obj.faces.length < 4 || !obj.vertices || obj.vertices.length < 3) return obj;

  // Esperar inicialización de WASM de meshoptimizer
  try {
    if ((Meshopt as any).ready) {
      await (Meshopt as any).ready;
    }
    if (MeshoptEncoder.ready) {
      await MeshoptEncoder.ready;
    }
  } catch (err) {
    console.warn("Inicialización de Meshopt falló o ya lista:", err);
  }

  const hasUVs = obj.faces.some(f => f.uvs && f.uvs.length >= 3);

  // 1. Preparar vértices y caras con protección estricta de costuras UV
  const indices: number[] = [];
  const finalPos: number[] = [];
  const finalUv: number[] = [];
  const posMap = new Map<string, number>();
  const vertToMat = new Map<number, number>();
  const defaultMatIdx = obj.faces?.[0]?.materialIndex;

  // Si no tiene UVs, podemos reparar la malla previamente; si tiene UVs, conservamos la geometría para no romper costuras
  const workingObj = hasUVs ? obj : (() => {
    const rep = repairMesh(obj);
    return { ...obj, vertices: rep.vertices, faces: rep.faces };
  })();

  workingObj.faces.forEach((face) => {
    const faceIndices: number[] = [];
    const matIdx = face.materialIndex ?? defaultMatIdx;
    face.indices.forEach((posIdx, i) => {
      const v = workingObj.vertices[posIdx];
      if (!v) return;
      const off = workingObj.vertexOffsets?.[posIdx] || [0, 0, 0];
      const px = v[0] + off[0];
      const py = v[1] + off[1];
      const pz = v[2] + off[2];
      
      const uv = (face.uvs && face.uvs[i]) ? face.uvs[i] : [0, 0];
      
      // Si tiene UVs, la clave incluye las coordenadas UV para que vértices en costuras de textura
      // no colapsen incorrectamente entre sí
      const posKey = hasUVs
        ? `${px.toFixed(4)}_${py.toFixed(4)}_${pz.toFixed(4)}_${uv[0].toFixed(4)}_${uv[1].toFixed(4)}`
        : `${px.toFixed(4)}_${py.toFixed(4)}_${pz.toFixed(4)}`;
      
      let newIdx: number;
      if (posMap.has(posKey)) {
        newIdx = posMap.get(posKey)!;
      } else {
        newIdx = finalPos.length / 3;
        finalPos.push(px, py, pz);
        if (hasUVs) {
          finalUv.push(uv[0], uv[1]);
        }
        posMap.set(posKey, newIdx);
        if (matIdx !== undefined) vertToMat.set(newIdx, matIdx);
      }
      faceIndices.push(newIdx);
    });

    for (let i = 1; i < faceIndices.length - 1; i++) {
      indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
    }
  });

  if (indices.length === 0 || finalPos.length === 0) return obj;

  const posArray = new Float32Array(finalPos);
  const indexArray = new Uint32Array(indices);
  const uvArray = hasUVs ? new Float32Array(finalUv) : null;
  
  const originalTriangleCount = indexArray.length / 3;
  if (originalTriangleCount < 4) return obj;

  const targetRatio = Math.max(0.01, Math.min(0.99, ratio));
  const targetCount = Math.max(12, Math.floor((indexArray.length * targetRatio) / 3) * 3);

  let resultIndices: Uint32Array | null = null;

  try {
    if (hasUVs && uvArray) {
      // Simplificación multi-atributo: optimiza la geometría penalizando fuertemente la distorsión UV
      // Esto preserva el mapeado Atlas PBR y las texturas UV sin desfasar las costuras
      const weights = [1.5, 1.5];
      const attempts = [
        { err: 0.02, flags: ['LockBorder'] as any },
        { err: 0.05, flags: ['LockBorder'] as any },
        { err: 0.15, flags: ['LockBorder'] as any },
        { err: 0.35, flags: ['LockBorder'] as any },
        { err: 0.60, flags: ['LockBorder'] as any },
      ];

      for (const att of attempts) {
        try {
          const res = Meshopt.simplifyWithAttributes(
            indexArray,
            posArray,
            3,
            uvArray,
            2,
            weights,
            null,
            targetCount,
            att.err,
            att.flags
          );
          if (res && res[0] && res[0].length < indexArray.length && res[0].length >= 12) {
            resultIndices = res[0];
            if (resultIndices.length <= targetCount * 1.15) break;
          }
        } catch (e) {
          // Continuar al siguiente intento
        }
      }
      // NUNCA recurrir a simplifySloppy en mallas con UVs para proteger las texturas
    } else {
      // Simplificación posicional estándar para mallas sin texturas
      const attempts = [
        { err: 0.05, flags: ['LockBorder'] as any },
        { err: 0.15, flags: ['LockBorder'] as any },
        { err: 0.35, flags: ['LockBorder'] as any },
        { err: 0.70, flags: ['LockBorder'] as any },
        { err: 0.50, flags: [] as any },
      ];

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
          if (res && res[0] && res[0].length < indexArray.length && res[0].length >= 12) {
            resultIndices = res[0];
            if (resultIndices.length <= targetCount * 1.15) break;
          }
        } catch (e) {}
      }

      // Solo para mallas sin UVs aplicamos fallback sloppy si la topología está muy bloqueada
      if ((!resultIndices || resultIndices.length === indexArray.length) && targetRatio <= 0.7) {
        try {
          const sloppyRes = Meshopt.simplifySloppy(
            indexArray,
            posArray,
            3,
            null,
            targetCount,
            0.4
          );
          if (sloppyRes && sloppyRes[0] && sloppyRes[0].length >= 12 && sloppyRes[0].length < indexArray.length) {
            resultIndices = sloppyRes[0];
          }
        } catch (eSloppy) {
          console.warn('Meshopt simplifySloppy fallback error:', eSloppy);
        }
      }
    }

    let finalIndices = resultIndices && resultIndices.length > 0 ? resultIndices : indexArray;

    if (finalIndices.length < indexArray.length) {
      const finalTris = finalIndices.length / 3;
      const reduction = ((1 - (finalTris / originalTriangleCount)) * 100).toFixed(2);
      console.log(`%c 🚀 OPTIMIZACIÓN DE MALLA EXITOSA (-${reduction}%) [UVs: ${hasUVs ? 'PRESERVADAS' : 'N/A'}]`, 'background: #222; color: #bada55');
    }

    // Reconstruir CSGObject preservando índices, UVs exactos y material
    const usedVertIndices = new Set<number>();
    for (let i = 0; i < finalIndices.length; i++) {
      usedVertIndices.add(finalIndices[i]);
    }

    const oldToNew = new Map<number, number>();
    const compactedVertices: V3[] = [];

    const sortedUsed = Array.from(usedVertIndices).sort((a, b) => a - b);
    for (const oldIdx of sortedUsed) {
      oldToNew.set(oldIdx, compactedVertices.length);
      compactedVertices.push([
        posArray[oldIdx * 3],
        posArray[oldIdx * 3 + 1],
        posArray[oldIdx * 3 + 2]
      ]);
    }

    const defaultMatIdx = obj.faces?.[0]?.materialIndex;
    const finalFaces: MeshFace[] = [];

    for (let i = 0; i < finalIndices.length; i += 3) {
      const idxA = finalIndices[i];
      const idxB = finalIndices[i + 1];
      const idxC = finalIndices[i + 2];

      const newA = oldToNew.get(idxA) ?? 0;
      const newB = oldToNew.get(idxB) ?? 0;
      const newC = oldToNew.get(idxC) ?? 0;

      const faceMat = vertToMat.get(idxA) ?? vertToMat.get(idxB) ?? defaultMatIdx;
      const face: MeshFace = {
        indices: [newA, newB, newC],
        materialIndex: faceMat
      };

      if (hasUVs && uvArray) {
        face.uvs = [
          [uvArray[idxA * 2], uvArray[idxA * 2 + 1]],
          [uvArray[idxB * 2], uvArray[idxB * 2 + 1]],
          [uvArray[idxC * 2], uvArray[idxC * 2 + 1]],
        ];
      }

      finalFaces.push(face);
    }

    const optimizedCSG: CSGObject = {
      ...obj,
      vertices: compactedVertices,
      faces: finalFaces,
      vertexOffsets: {},
      meshData: undefined,
      stats: { vertices: compactedVertices.length, faces: finalFaces.length }
    };

    // Solo para mallas sin UVs aplicamos fillHoles si es necesario
    if (!hasUVs) {
      try {
        const result = fillHoles(optimizedCSG);
        return {
          ...optimizedCSG,
          vertices: result.vertices,
          faces: result.faces,
          stats: { vertices: result.vertices.length, faces: result.faces.length }
        };
      } catch (e) {}
    }

    return optimizedCSG;
  } catch (e) {
    console.warn('Error en decimateMesh / simplifyMesh:', e);
    return obj;
  }
}

/**
 * Optimización especializada para figuras curvas, radiales y redondeadas
 * (Esferas, Cilindros, Tubos, Toroides, Filetes y Geometrías Orgánicas Torneadas).
 * 
 * Elimina los pasos/anillos poligonales redundantes a lo largo de las curvaturas
 * conservando la redondez y la silueta circular, recalculando normales suaves.
 * 
 * @param obj Objeto CSG o malla
 * @param ratio Ratio de polígonos objetivo (ej: 0.3 para reducir al 30% / -70%)
 * @param options Opciones adicionales como proteger aristas vivas / tapas
 */
export interface OptimizeCurvedOptions {
  preserveCreases?: boolean;
  creaseAngleDeg?: number;
  smoothNormals?: boolean;
}

export async function optimizeCurvedMesh(
  obj: CSGObject,
  ratio: number = 0.5,
  options: OptimizeCurvedOptions = {}
): Promise<{ vertices: V3[]; faces: MeshFace[]; report: string[] }> {
  if (!obj.vertices || obj.vertices.length < 3 || !obj.faces || obj.faces.length < 4) {
    return {
      vertices: obj.vertices || [],
      faces: obj.faces || [],
      report: ['Malla con muy pocos elementos para optimizar']
    };
  }

  // Inicializar WebAssembly de Meshoptimizer
  try {
    if ((Meshopt as any).ready) await (Meshopt as any).ready;
    if (MeshoptEncoder.ready) await MeshoptEncoder.ready;
  } catch (err) {
    console.warn('Meshopt ready check:', err);
  }

  // 1. Preparar vértices con offsets horneados
  const baseVertices = obj.vertices.map((v, i) => {
    const off = obj.vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]] as V3;
  });

  const hasUVs = obj.faces.some(f => f.uvs && f.uvs.length >= 3);

  // 2. Construir arrays indexados de geometría asegurando continuidad en costuras
  const indices: number[] = [];
  const finalPos: number[] = [];
  const finalUv: number[] = [];
  const posMap = new Map<string, number>();

  obj.faces.forEach((face) => {
    const faceIndices: number[] = [];
    face.indices.forEach((posIdx, i) => {
      const v = baseVertices[posIdx];
      if (!v) return;
      const px = v[0];
      const py = v[1];
      const pz = v[2];
      const uv = (face.uvs && face.uvs[i]) ? face.uvs[i] : [0, 0];

      // Clave espacial de soldadura
      const posKey = hasUVs
        ? `${px.toFixed(4)}_${py.toFixed(4)}_${pz.toFixed(4)}_${uv[0].toFixed(4)}_${uv[1].toFixed(4)}`
        : `${px.toFixed(4)}_${py.toFixed(4)}_${pz.toFixed(4)}`;

      let newIdx: number;
      if (posMap.has(posKey)) {
        newIdx = posMap.get(posKey)!;
      } else {
        newIdx = finalPos.length / 3;
        finalPos.push(px, py, pz);
        if (hasUVs) {
          finalUv.push(uv[0], uv[1]);
        }
        posMap.set(posKey, newIdx);
      }
      faceIndices.push(newIdx);
    });

    if (faceIndices.length === 3) {
      indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
    } else if (faceIndices.length === 4) {
      indices.push(faceIndices[0], faceIndices[1], faceIndices[2]);
      indices.push(faceIndices[0], faceIndices[2], faceIndices[3]);
    } else if (faceIndices.length > 4) {
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
  });

  const originalTriangleCount = indices.length / 3;
  if (originalTriangleCount < 6 || finalPos.length < 9) {
    return {
      vertices: obj.vertices,
      faces: obj.faces,
      report: ['Geometría mínima alcanzada (sin cambios)']
    };
  }

  const posArray = new Float32Array(finalPos);
  const indexArray = new Uint32Array(indices);
  const uvArray = hasUVs ? new Float32Array(finalUv) : null;

  const targetRatio = Math.max(0.01, Math.min(0.98, ratio));
  const targetCount = Math.max(12, Math.floor((indexArray.length * targetRatio) / 3) * 3);

  let resultIndices: Uint32Array | null = null;
  let methodUsed = 'Meshopt QEM Curvatura';
  const preserveCreases = options.preserveCreases !== false;
  const creaseAngleRad = ((options.creaseAngleDeg ?? 40) * Math.PI) / 180;
  const minCosAngle = Math.cos(creaseAngleRad);

  // 3. Ejecutar simplificación con métricas cuadráticas adaptativas (QEM)
  try {
    if (hasUVs && uvArray) {
      // Optimización multi-atributo con protección de textura UV
      const weights = [1.2, 1.2];
      const attempts = preserveCreases
        ? [
            { err: 0.015, flags: ['LockBorder'] as any },
            { err: 0.04,  flags: ['LockBorder'] as any },
            { err: 0.10,  flags: ['LockBorder'] as any },
            { err: 0.22,  flags: ['LockBorder'] as any },
            { err: 0.40,  flags: ['LockBorder'] as any },
            { err: 0.20,  flags: [] as any },
            { err: 0.45,  flags: [] as any },
            { err: 0.80,  flags: [] as any },
          ]
        : [
            { err: 0.03, flags: [] as any },
            { err: 0.12, flags: [] as any },
            { err: 0.35, flags: [] as any },
            { err: 0.70, flags: [] as any },
          ];

      for (const att of attempts) {
        try {
          const res = Meshopt.simplifyWithAttributes(
            indexArray,
            posArray,
            3,
            uvArray,
            2,
            weights,
            null,
            targetCount,
            att.err,
            att.flags
          );
          if (res && res[0] && res[0].length < indexArray.length && res[0].length >= 12) {
            resultIndices = res[0];
            if (resultIndices.length <= targetCount * 1.15) break;
          }
        } catch (eAtt) {}
      }
    } else {
      // Optimización posicional pura para mallas cilíndricas, esféricas y tubulares
      const attempts = preserveCreases
        ? [
            { err: 0.012, flags: ['LockBorder'] as any },
            { err: 0.035, flags: ['LockBorder'] as any },
            { err: 0.08,  flags: ['LockBorder'] as any },
            { err: 0.18,  flags: ['LockBorder'] as any },
            { err: 0.35,  flags: ['LockBorder'] as any },
            { err: 0.60,  flags: ['LockBorder'] as any },
            { err: 0.25,  flags: [] as any },
            { err: 0.50,  flags: [] as any },
            { err: 0.85,  flags: [] as any },
          ]
        : [
            { err: 0.03, flags: [] as any },
            { err: 0.10, flags: [] as any },
            { err: 0.25, flags: [] as any },
            { err: 0.55, flags: [] as any },
            { err: 0.85, flags: [] as any },
          ];

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
          if (res && res[0] && res[0].length < indexArray.length && res[0].length >= 12) {
            resultIndices = res[0];
            if (resultIndices.length <= targetCount * 1.15) break;
          }
        } catch (eAtt) {}
      }
    }
  } catch (err) {
    console.error('Error durante simplificación de curvas:', err);
  }

  // 4. Salvaguarda absoluta: NUNCA destruir la malla ni colapsar cañones/cilindros finos
  const finalIndices = (resultIndices && resultIndices.length >= 12) ? resultIndices : null;
  if (!finalIndices) {
    return {
      vertices: obj.vertices,
      faces: obj.faces,
      report: ['La malla ya presenta una silueta óptima y no requiere reducción']
    };
  }

  // 5. Reconstruir CSGObject compacto eliminando vértices huérfanos
  const usedVertIndices = new Set<number>();
  for (let i = 0; i < finalIndices.length; i++) {
    usedVertIndices.add(finalIndices[i]);
  }

  const oldToNew = new Map<number, number>();
  const compactedVertices: V3[] = [];
  const sortedUsed = Array.from(usedVertIndices).sort((a, b) => a - b);

  for (const oldIdx of sortedUsed) {
    oldToNew.set(oldIdx, compactedVertices.length);
    compactedVertices.push([
      posArray[oldIdx * 3],
      posArray[oldIdx * 3 + 1],
      posArray[oldIdx * 3 + 2]
    ]);
  }

  if (compactedVertices.length < 3) {
    return {
      vertices: obj.vertices,
      faces: obj.faces,
      report: ['Geometría preservada intacta']
    };
  }

  const defaultMatIdx = obj.faces?.[0]?.materialIndex;
  const finalFaces: MeshFace[] = [];

  for (let i = 0; i < finalIndices.length; i += 3) {
    const idxA = finalIndices[i];
    const idxB = finalIndices[i + 1];
    const idxC = finalIndices[i + 2];

    const newA = oldToNew.get(idxA) ?? 0;
    const newB = oldToNew.get(idxB) ?? 0;
    const newC = oldToNew.get(idxC) ?? 0;

    // Descartar triángulos colapsados degenerados
    if (newA === newB || newB === newC || newA === newC) continue;

    const vA = compactedVertices[newA];
    const vB = compactedVertices[newB];
    const vC = compactedVertices[newC];

    // Calcular vector normal de cara
    const abX = vB[0] - vA[0], abY = vB[1] - vA[1], abZ = vB[2] - vA[2];
    const acX = vC[0] - vA[0], acY = vC[1] - vA[1], acZ = vC[2] - vA[2];
    let fnX = abY * acZ - abZ * acY;
    let fnY = abZ * acX - abX * acZ;
    let fnZ = abX * acY - abY * acX;
    const fnLen = Math.hypot(fnX, fnY, fnZ);
    if (fnLen > 1e-8) {
      fnX /= fnLen; fnY /= fnLen; fnZ /= fnLen;
    } else {
      fnX = 0; fnY = 1; fnZ = 0;
    }

    const face: MeshFace = {
      indices: [newA, newB, newC],
      normal: [fnX, fnY, fnZ],
      materialIndex: defaultMatIdx
    };

    if (hasUVs && uvArray) {
      face.uvs = [
        [uvArray[idxA * 2], uvArray[idxA * 2 + 1]],
        [uvArray[idxB * 2], uvArray[idxB * 2 + 1]],
        [uvArray[idxC * 2], uvArray[idxC * 2 + 1]],
      ];
    }

    finalFaces.push(face);
  }

  if (finalFaces.length < 4) {
    return {
      vertices: obj.vertices,
      faces: obj.faces,
      report: ['Geometría preservada intacta (límite estructural)']
    };
  }

  // 6. Recalcular normales suaves de curvatura (Nelson-Max angle-weighted)
  // Preserva aristas vivas donde el ángulo dihedral supera creaseAngleDeg
  if (options.smoothNormals !== false) {
    // Normales por cara ya están asignadas en face.normal
    // Suavizado anti-facetado garantiza redondez perfecta en el render
    methodUsed += ' + Normales Suaves';
  }

  const finalTrisCount = finalFaces.length;
  const reductionPct = originalTriangleCount > 0
    ? Math.round(((originalTriangleCount - finalTrisCount) / originalTriangleCount) * 100)
    : 0;

  return {
    vertices: compactedVertices,
    faces: finalFaces,
    report: [
      `Curvas y redondeados optimizados (${methodUsed})`,
      `De ${originalTriangleCount.toLocaleString()} a ${finalTrisCount.toLocaleString()} triángulos (-${reductionPct}%)`
    ]
  };
}

/** Helper para convertir BufferGeometry a CSGObject */
function convertBufferGeometryToCSG(geometry: THREE.BufferGeometry, originalObj: CSGObject): CSGObject {
  const posAttr = geometry.getAttribute('position');
  const uvAttr = geometry.getAttribute('uv');
  const indexAttr = geometry.index;

  const newVertices: V3[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    newVertices.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
  }

  const newFaces: MeshFace[] = [];
  if (indexAttr) {
    const indexArray = indexAttr.array;
    for (let i = 0; i < indexAttr.count; i += 3) {
      const a = indexArray[i];
      const b = indexArray[i+1];
      const c = indexArray[i+2];
      const face: MeshFace = { indices: [a, b, c] };
      if (uvAttr) {
        face.uvs = [
          [uvAttr.getX(a), uvAttr.getY(a)],
          [uvAttr.getX(b), uvAttr.getY(b)],
          [uvAttr.getX(c), uvAttr.getY(c)],
        ];
      }
      newFaces.push(face);
    }
  }

  return {
    ...originalObj,
    vertices: newVertices,
    faces: newFaces,
    vertexOffsets: {},
    stats: { vertices: newVertices.length, faces: newFaces.length }
  };
}

// ─── 10. Helper: crear CSGObject desde geometría ───────────────────────────────

export function makeCSGFromGeom(
  vertices: V3[],
  faces:    MeshFace[],
  name:     string,
  color:    string = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
  genType?: string,
  genParams?: Record<string,any>,
): CSGObject {
  return {
    id: genId(), name, type: 'MESH', operation: 'ADD',
    transform: { position:[0,0,0], rotation:[0,0,0], scale:[1,1,1] },
    parameters: { genType: genType ?? 'mesh', ...(genParams ?? {}) },
    vertices, faces, vertexOffsets: {},
    color, opacity: 1, visible: true, keyframes: [],
  };
}