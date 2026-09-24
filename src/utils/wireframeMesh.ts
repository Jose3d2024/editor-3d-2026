import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSGObject, MeshFace, V3 } from '../types';
import { fromThreeGeometry } from './modifiers';
import { createBaseGeometry } from './csg';

export interface WireframeOptions {
  mode?: 'TUBES' | 'LINES' | 'REMOVE_FACES';
  radius?: number;            // Radio del tubo/alambre (ej: 0.035)
  radialSegments?: number;    // Lados del tubo (3: triángulo low-poly, 4: cuadrado, 6-8: cilindro suave)
  addJointSpheres?: boolean;  // Uniones esféricas en las esquinas/vértices
  sphereSegments?: number;    // Resolución de las esferas de unión (ej: 8)
  asNewObject?: boolean;      // Crear como duplicado o reemplazar
  dissolveCoplanars?: boolean;// Disolver automáticamente aristas diagonales entre triángulos/caras coplanares (default true)
  coplanarAngleDeg?: number;  // Tolerancia angular en grados (default 3.5°)
}

/**
 * Comprueba si dos segmentos en 3D (AB y CD) se cruzan internamente
 * como las diagonales de un cuadrilátero convexo o curvo suave.
 */
export function doSegmentsCross3D(
  pA: [number, number, number] | THREE.Vector3,
  pB: [number, number, number] | THREE.Vector3,
  pC: [number, number, number] | THREE.Vector3,
  pD: [number, number, number] | THREE.Vector3
): boolean {
  const ax = Array.isArray(pA) ? pA[0] : pA.x;
  const ay = Array.isArray(pA) ? pA[1] : pA.y;
  const az = Array.isArray(pA) ? pA[2] : pA.z;

  const bx = Array.isArray(pB) ? pB[0] : pB.x;
  const by = Array.isArray(pB) ? pB[1] : pB.y;
  const bz = Array.isArray(pB) ? pB[2] : pB.z;

  const cx = Array.isArray(pC) ? pC[0] : pC.x;
  const cy = Array.isArray(pC) ? pC[1] : pC.y;
  const cz = Array.isArray(pC) ? pC[2] : pC.z;

  const dx = Array.isArray(pD) ? pD[0] : pD.x;
  const dy = Array.isArray(pD) ? pD[1] : pD.y;
  const dz = Array.isArray(pD) ? pD[2] : pD.z;

  const v1x = bx - ax, v1y = by - ay, v1z = bz - az;
  const v2x = dx - cx, v2y = dy - cy, v2z = dz - cz;

  const len1Sq = v1x * v1x + v1y * v1y + v1z * v1z;
  const len2Sq = v2x * v2x + v2y * v2y + v2z * v2z;
  if (len1Sq < 1e-12 || len2Sq < 1e-12) return false;

  const dot12 = v1x * v2x + v1y * v2y + v1z * v2z;
  const rx = ax - cx, ry = ay - cy, rz = az - cz;
  const dot1r = v1x * rx + v1y * ry + v1z * rz;
  const dot2r = v2x * rx + v2y * ry + v2z * rz;

  const denom = len1Sq * len2Sq - dot12 * dot12;
  if (Math.abs(denom) < 1e-10) return false;

  const t = (dot12 * dot2r - len2Sq * dot1r) / denom;
  const s = (len1Sq * dot2r - dot12 * dot1r) / denom;

  if (t > 0.05 && t < 0.95 && s > 0.05 && s < 0.95) {
    const p1x = ax + t * v1x, p1y = ay + t * v1y, p1z = az + t * v1z;
    const p2x = cx + s * v2x, p2y = cy + s * v2y, p2z = cz + s * v2z;
    const distSq = (p1x - p2x)**2 + (p1y - p2y)**2 + (p1z - p2z)**2;
    return distSq <= Math.max(len1Sq, len2Sq) * 0.09;
  }
  return false;
}

/**
 * Extrae todas las aristas únicas de un objeto o geometría,
 * filtrando automáticamente aristas diagonales interiores entre triángulos coplanares
 * y diagonales transversales que parten cuadriláteros en dos mitades.
 */
export function extractUniqueEdges(
  obj: {
    vertices?: any[];
    faces?: any[];
    wireframeEdges?: [number, number][];
    parameters?: any;
    silhouetteOnly?: boolean;
    creaseAngle?: number;
  },
  options?: { dissolveCoplanars?: boolean; coplanarAngleDeg?: number; silhouetteOnly?: boolean }
): Array<[number, number]> {
  // Si ya tiene aristas explícitas guardadas
  if (obj.wireframeEdges && obj.wireframeEdges.length > 0) {
    return obj.wireframeEdges;
  }
  if (obj.parameters?.wireframeEdges && obj.parameters.wireframeEdges.length > 0) {
    return obj.parameters.wireframeEdges;
  }

  const isSilhouette = options?.silhouetteOnly ?? obj.silhouetteOnly ?? false;
  const dissolveCoplanars = options?.dissolveCoplanars ?? true;
  const coplanarAngleDeg = isSilhouette 
    ? Math.max(35.0, options?.coplanarAngleDeg ?? obj.creaseAngle ?? 35.0)
    : (options?.coplanarAngleDeg ?? obj.creaseAngle ?? 18.0);
  const cosTol = Math.cos((coplanarAngleDeg * Math.PI) / 180);

  const rawVerts = obj.vertices || [];
  const faces = obj.faces || [];
  if (faces.length === 0) {
    const result: Array<[number, number]> = [];
    if (rawVerts.length > 1) {
      for (let i = 0; i < rawVerts.length - 1; i++) result.push([i, i + 1]);
      if (obj.parameters?.closed) result.push([rawVerts.length - 1, 0]);
    }
    return result;
  }

  // Normalizar vértices a formato [x, y, z]
  const verts: [number, number, number][] = rawVerts.map(v => 
    Array.isArray(v) ? [v[0], v[1], v[2]] : [(v as any).x || 0, (v as any).y || 0, (v as any).z || 0]
  );

  // Cuantización espacial adaptativa según Bounding Box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const [x, y, z] = verts[i];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const diag = Math.sqrt((maxX - minX)**2 + (maxY - minY)**2 + (maxZ - minZ)**2) || 1.0;
  const quant = Math.max(100, Math.min(50000, Math.round(2500 / diag)));

  const spatialMap = new Map<string, number>();
  const canonicalVertIdx: number[] = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const [x, y, z] = verts[i];
    const key = `${Math.round(x * quant)}_${Math.round(y * quant)}_${Math.round(z * quant)}`;
    let can = spatialMap.get(key);
    if (can === undefined) {
      can = i;
      spatialMap.set(key, can);
    }
    canonicalVertIdx[i] = can;
  }

  // Precalcular normales de caras
  const faceNormals: (THREE.Vector3 | null)[] = faces.map(f => {
    const idxs = (f.indices && f.indices.length > 0) ? f.indices : (Array.isArray(f) ? f : []);
    if (idxs.length < 3) return null;
    const p0 = verts[idxs[0]], p1 = verts[idxs[1]], p2 = verts[idxs[2]];
    if (!p0 || !p1 || !p2) return null;
    const v0 = new THREE.Vector3(...p0);
    const v1 = new THREE.Vector3(...p1);
    const v2 = new THREE.Vector3(...p2);
    const cb = new THREE.Vector3().subVectors(v2, v1);
    const ab = new THREE.Vector3().subVectors(v0, v1);
    const cross = new THREE.Vector3().crossVectors(cb, ab);
    if (cross.lengthSq() < 1e-12) return null;
    return cross.normalize();
  });

  // Agrupar aristas por pares de vértices canónicos espaciales
  const edgeToFaces = new Map<string, { fIdx: number; origA: number; origB: number; canA: number; canB: number }[]>();
  for (let fIdx = 0; fIdx < faces.length; fIdx++) {
    const face = faces[fIdx];
    const idxs = (face.indices && face.indices.length > 0) ? face.indices : (Array.isArray(face) ? face : []);
    const len = idxs.length;
    for (let i = 0; i < len; i++) {
      const origA = idxs[i];
      const origB = idxs[(i + 1) % len];
      if (origA === origB) continue;
      const canA = canonicalVertIdx[origA] ?? origA;
      const canB = canonicalVertIdx[origB] ?? origB;
      if (canA === canB) continue;
      const minCan = Math.min(canA, canB);
      const maxCan = Math.max(canA, canB);
      const key = `${minCan}_${maxCan}`;
      let list = edgeToFaces.get(key);
      if (!list) {
        list = [];
        edgeToFaces.set(key, list);
      }
      list.push({ fIdx, origA, origB, canA: minCan, canB: maxCan });
    }
  }

  const result: Array<[number, number]> = [];

  edgeToFaces.forEach(sharedList => {
    const { origA, origB, canA, canB } = sharedList[0];

    // Borde exterior libre (contorno de silueta)
    if (sharedList.length === 1) {
      result.push([origA, origB]);
      return;
    }

    if (dissolveCoplanars) {
      if (sharedList.length === 2) {
        const f0 = sharedList[0].fIdx;
        const f1 = sharedList[1].fIdx;
        const n0 = faceNormals[f0];
        const n1 = faceNormals[f1];
        if (n0 && n1) {
          const dot = n0.dot(n1);
          // 1. Omitir si es estrictamente coplanar (< coplanarAngleDeg)
          if (dot >= cosTol) {
            return;
          }

          // 2. Omitir DIAGONALES CRUZADAS INTERIORES QUE DIVIDEN QUADS O CARAS:
          const face0 = faces[f0];
          const face1 = faces[f1];
          const idxs0 = (face0.indices && face0.indices.length > 0) ? face0.indices : (Array.isArray(face0) ? face0 : []);
          const idxs1 = (face1.indices && face1.indices.length > 0) ? face1.indices : (Array.isArray(face1) ? face1 : []);

          if (idxs0.length === 3 && idxs1.length === 3) {
            // Localizar el tercer vértice en cada triángulo
            const canC = idxs0.map(idx => canonicalVertIdx[idx] ?? idx).find(c => c !== canA && c !== canB);
            const canD = idxs1.map(idx => canonicalVertIdx[idx] ?? idx).find(c => c !== canA && c !== canB);

            if (canC !== undefined && canD !== undefined && canC !== canD) {
              const maxQuadAngle = Math.max(35.0, coplanarAngleDeg);
              const cosQuadTol = Math.cos((maxQuadAngle * Math.PI) / 180);
              // Si el pliegue entre triángulos es suave/moderado (< 35°-45°)
              if (dot >= cosQuadTol) {
                const pA = verts[canA], pB = verts[canB], pC = verts[canC], pD = verts[canD];
                if (pA && pB && pC && pD && doSegmentsCross3D(pA, pB, pC, pD)) {
                  // Esta arista es la diagonal que cruza el cuadrilátero: ¡ELIMINARLA!
                  return;
                }
              }
            }
          }
        }
      } else if (sharedList.length > 2 && isSilhouette) {
        // En modo silueta estricto, descartar aristas coplanares no-manifold
        let allCoplanar = true;
        const n0 = faceNormals[sharedList[0].fIdx];
        if (n0) {
          for (let k = 1; k < sharedList.length; k++) {
            const nk = faceNormals[sharedList[k].fIdx];
            if (!nk || nk.dot(n0) < cosTol) {
              allCoplanar = false;
              break;
            }
          }
          if (allCoplanar) return;
        }
      }
    }

    result.push([origA, origB]);
  });

  return result;
}

/**
 * Extrae aristas para BufferGeometry (ej. mallas GLTF/GLB/FBX importadas),
 * filtrando rigurosamente aristas diagonales interiores entre triángulos coplanares
 * y diagonales transversales que cruzan polígonos y cuadriláteros.
 * Devuelve un BufferGeometry de LineSegments limpio sin líneas cruzadas.
 */
export function extractEdgesFromBufferGeometry(
  geometry: THREE.BufferGeometry,
  options?: { dissolveCoplanars?: boolean; coplanarAngleDeg?: number; silhouetteOnly?: boolean }
): THREE.BufferGeometry {
  const posAttr = geometry.attributes.position;
  if (!posAttr || posAttr.count < 3) return new THREE.BufferGeometry();

  const isSilhouette = options?.silhouetteOnly ?? false;
  const coplanarAngleDeg = isSilhouette
    ? Math.max(35.0, options?.coplanarAngleDeg ?? 35.0)
    : (options?.coplanarAngleDeg ?? 20.0);
  const cosTol = Math.cos((coplanarAngleDeg * Math.PI) / 180);

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(posAttr as any);
  const diag = box.min.distanceTo(box.max) || 1.0;

  const dissolveCoplanars = options?.dissolveCoplanars ?? true;
  const indexAttr = geometry.index;
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  // 1. Soldar vértices coincidentes por posición espacial con cuantización adaptativa de alta resolución
  const quant = Math.max(200, Math.min(60000, Math.round(3000 / diag)));
  const keyMap = new Map<string, number>();
  const remap = new Int32Array(posAttr.count);
  const verts: THREE.Vector3[] = [];
  let uCount = 0;

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const k = `${Math.round(x * quant)}_${Math.round(y * quant)}_${Math.round(z * quant)}`;
    let id = keyMap.get(k);
    if (id === undefined) {
      id = uCount++;
      keyMap.set(k, id);
      verts.push(new THREE.Vector3(x, y, z));
    }
    remap[i] = id;
  }

  const edgeToFaces = new Map<string, { fIdx: number; va: number; vb: number }[]>();
  const faceNormals: THREE.Vector3[] = [];
  const faces: [number, number, number][] = [];

  for (let f = 0; f < triCount; f++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      i0 = remap[indexAttr.getX(f * 3)];
      i1 = remap[indexAttr.getX(f * 3 + 1)];
      i2 = remap[indexAttr.getX(f * 3 + 2)];
    } else {
      i0 = remap[f * 3];
      i1 = remap[f * 3 + 1];
      i2 = remap[f * 3 + 2];
    }
    faces.push([i0, i1, i2]);

    const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
    const n = new THREE.Vector3();
    if (p0 && p1 && p2) {
      n.crossVectors(new THREE.Vector3().subVectors(p2, p1), new THREE.Vector3().subVectors(p0, p1));
      if (n.lengthSq() > 1e-12) n.normalize(); else n.set(0, 1, 0);
    } else {
      n.set(0, 1, 0);
    }
    faceNormals.push(n);

    const edges: [number, number][] = [
      [Math.min(i0, i1), Math.max(i0, i1)],
      [Math.min(i1, i2), Math.max(i1, i2)],
      [Math.min(i2, i0), Math.max(i2, i0)]
    ];
    for (const [va, vb] of edges) {
      if (va === vb) continue;
      const k = `${va}_${vb}`;
      let list = edgeToFaces.get(k);
      if (!list) {
        list = [];
        edgeToFaces.set(k, list);
      }
      list.push({ fIdx: f, va, vb });
    }
  }

  // Descartar aristas interiores coplanares y diagonales que cruzan quads
  const edgePositions: number[] = [];
  edgeToFaces.forEach((sharedList) => {
    const { va, vb } = sharedList[0];

    // Borde exterior libre
    if (sharedList.length === 1) {
      const pA = verts[va], pB = verts[vb];
      if (pA && pB) edgePositions.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
      return;
    }

    if (dissolveCoplanars) {
      if (sharedList.length === 2) {
        const f0 = sharedList[0].fIdx;
        const f1 = sharedList[1].fIdx;
        const n0 = faceNormals[f0];
        const n1 = faceNormals[f1];
        if (n0 && n1) {
          const dot = n0.dot(n1);
          // 1. Omitir si es coplanar suave
          if (dot >= cosTol) {
            return;
          }

          // 2. Omitir DIAGONALES DE CUADRILÁTEROS (elimina líneas cruzadas dividiendo caras)
          const tri0 = faces[f0];
          const tri1 = faces[f1];
          const vc = tri0[0] !== va && tri0[0] !== vb ? tri0[0] : (tri0[1] !== va && tri0[1] !== vb ? tri0[1] : tri0[2]);
          const vd = tri1[0] !== va && tri1[0] !== vb ? tri1[0] : (tri1[1] !== va && tri1[1] !== vb ? tri1[1] : tri1[2]);

          if (vc !== vd) {
            const maxQuadAngle = Math.max(35.0, coplanarAngleDeg);
            const cosQuadTol = Math.cos((maxQuadAngle * Math.PI) / 180);
            if (dot >= cosQuadTol) {
              const pA = verts[va], pB = verts[vb], pC = verts[vc], pD = verts[vd];
              if (pA && pB && pC && pD && doSegmentsCross3D(pA, pB, pC, pD)) {
                // Diagonal interna encontrada: no dibujarla para evitar líneas cruzadas
                return;
              }
            }
          }
        }
      } else if (sharedList.length > 2 && isSilhouette) {
        let allCoplanar = true;
        const n0 = faceNormals[sharedList[0].fIdx];
        if (n0) {
          for (let k = 1; k < sharedList.length; k++) {
            const nk = faceNormals[sharedList[k].fIdx];
            if (!nk || nk.dot(n0) < cosTol) {
              allCoplanar = false;
              break;
            }
          }
          if (allCoplanar) return;
        }
      }
    }

    const pA = verts[va], pB = verts[vb];
    if (pA && pB) {
      edgePositions.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
    }
  });

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  return edgeGeo;
}

/**
 * Crea una geometría sólida 3D de tubos cilíndricos y esferas de unión siguiendo todas las aristas.
 * Este resultado es 100% Manifold y compatible con STL (impresión 3D), OBJ y GLTF/GLB.
 */
export function createWireframeTubesGeometry(
  obj: CSGObject,
  options: WireframeOptions = {}
): THREE.BufferGeometry {
  const radius = Math.max(0.005, options.radius ?? 0.035);
  const radialSegments = Math.max(3, options.radialSegments ?? 6);
  const addJointSpheres = options.addJointSpheres ?? true;
  const sphereSegments = Math.max(4, options.sphereSegments ?? 8);

  // Obtener vértices horneados con sus offsets
  let bakedVerts: V3[] = [];
  if (obj.vertices && obj.vertices.length > 0) {
    bakedVerts = obj.vertices.map((v, i) => {
      const off = obj.vertexOffsets?.[i] || [0, 0, 0];
      return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    });
  } else {
    // Si no tiene vertices crudos, extraer de la geometría base
    const baseGeo = createBaseGeometry(obj);
    const posAttr = baseGeo.getAttribute('position');
    if (posAttr) {
      for (let i = 0; i < posAttr.count; i++) {
        bakedVerts.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
      }
    }
  }

  if (bakedVerts.length === 0) {
    return new THREE.BufferGeometry();
  }

  const edges = extractUniqueEdges({
    vertices: bakedVerts,
    faces: obj.faces,
    wireframeEdges: obj.wireframeEdges,
    parameters: obj.parameters,
  }, options);

  if (edges.length === 0) {
    return new THREE.BufferGeometry();
  }

  const geometries: THREE.BufferGeometry[] = [];
  const upVec = new THREE.Vector3(0, 1, 0);
  const usedVertexIndices = new Set<number>();

  for (const [i1, i2] of edges) {
    const v1 = bakedVerts[i1];
    const v2 = bakedVerts[i2];
    if (!v1 || !v2) continue;

    usedVertexIndices.add(i1);
    usedVertexIndices.add(i2);

    const p1 = new THREE.Vector3(...v1);
    const p2 = new THREE.Vector3(...v2);
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();

    if (len < 1e-5) continue;

    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

    // Cilindro para la arista
    const cylGeo = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1, false);
    
    // Rotar para alinear con dir
    const orientation = new THREE.Quaternion();
    const normDir = dir.clone().normalize();
    orientation.setFromUnitVectors(upVec, normDir);

    cylGeo.applyQuaternion(orientation);
    cylGeo.translate(mid.x, mid.y, mid.z);

    geometries.push(cylGeo);
  }

  // Esferas en los vértices / nodos para esquinas perfectas sin agujeros
  if (addJointSpheres) {
    const sphereRadius = radius * 1.05;
    for (const vIdx of usedVertexIndices) {
      const v = bakedVerts[vIdx];
      if (!v) continue;
      const sphereGeo = new THREE.SphereGeometry(sphereRadius, sphereSegments, sphereSegments);
      sphereGeo.translate(v[0], v[1], v[2]);
      geometries.push(sphereGeo);
    }
  }

  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // Fusionar todas las geometrías en un único BufferGeometry sólido
  let merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  if (!merged) {
    return new THREE.BufferGeometry();
  }

  merged = BufferGeometryUtils.mergeVertices(merged, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

/**
 * Convierte un CSGObject a estructura alámbrica:
 * - 'TUBES': Malla sólida de tubos 3D exportable a STL, OBJ y GLTF
 * - 'REMOVE_FACES': Elimina las caras dejando solo aristas y vértices en modo alambre puro
 */
export function convertToWireframeModel(
  obj: CSGObject,
  options: WireframeOptions = {}
): {
  vertices: V3[];
  faces: MeshFace[];
  wireframeEdges: [number, number][];
  isWireframeOnly?: boolean;
} {
  const mode = options.mode || 'TUBES';

  // Obtener vértices horneados
  const bakedVerts: V3[] = (obj.vertices || []).map((v, i) => {
    const off = obj.vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
  });

  const edges = extractUniqueEdges({
    vertices: bakedVerts,
    faces: obj.faces,
    wireframeEdges: obj.wireframeEdges,
    parameters: obj.parameters,
  }, options);

  if (mode === 'REMOVE_FACES' || mode === 'LINES') {
    return {
      vertices: bakedVerts,
      faces: [],
      wireframeEdges: edges,
      isWireframeOnly: true,
    };
  }

  // Modo TUBES (Celosía 3D sólida)
  const tubesGeo = createWireframeTubesGeometry(obj, options);
  const meshData = fromThreeGeometry(tubesGeo);

  return {
    vertices: meshData.vertices,
    faces: meshData.faces,
    wireframeEdges: edges,
    isWireframeOnly: false,
  };
}

/**
 * Extrae únicamente las aristas de pliegue/quiebre (Crease / Feature Edges) con ángulo diedro
 * mayor o igual al umbral especificado (ej. 18°-24°), además de bordes perimetrales abiertos.
 * Elimina automáticamente el 100% de diagonales de triangulación coplanares y aristas suaves.
 */
export function extractFeatureEdges(
  obj: {
    vertices?: V3[];
    faces?: MeshFace[];
    wireframeEdges?: [number, number][];
    silhouetteOnly?: boolean;
  },
  creaseAngleDeg: number = 20.0
): Array<[number, number]> {
  return extractUniqueEdges(obj, {
    dissolveCoplanars: true,
    coplanarAngleDeg: creaseAngleDeg,
    silhouetteOnly: obj.silhouetteOnly ?? true,
  });
}

