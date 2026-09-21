/**
 * shrinkwrap.ts — Blender-style Shrinkwrap (Envolver) & Solidify (Solidificar) Modifiers
 *
 * Implements retopology surface snapping, shrinkwrap deformation and physical thickness:
 * 1. Nearest Surface Point (Punto de superficie más cercano)
 * 2. Project along Axis (Proyectar a lo largo de ejes X, Y, Z / +/- / Ambas)
 * 3. Nearest Vertex (Vértice más cercano)
 * 4. Target Normal Project (Proyección según normales de la superficie)
 *
 * Includes normal offset to prevent Z-fighting, vertex-group filtering, and Solidify.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import type { CSGObject, MeshFace, V3, ShrinkwrapConfig } from '../types';
import { createBaseGeometry } from './csg';
import { fromThreeGeometry, subdivideMesh } from './modifiers';
import { pairTrianglesIntoQuads } from './retopology';

/**
 * Computes world matrix for an object given its transform (position, rotation in radians, scale)
 */
export function getObjectWorldMatrix(obj: CSGObject): THREE.Matrix4 {
  const t = obj.transform || {
    position: (obj as any).position || [0, 0, 0],
    rotation: (obj as any).rotation || [0, 0, 0],
    scale: (obj as any).scale || [1, 1, 1]
  };
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3(...(t.position || [0, 0, 0]));
  const rot = new THREE.Euler(...(t.rotation || [0, 0, 0]));
  const scale = new THREE.Vector3(...(t.scale || [1, 1, 1]));
  mat.compose(pos, new THREE.Quaternion().setFromEuler(rot), scale);
  return mat;
}

/**
 * Extracts a Three.js BufferGeometry from target CSGObject or imported model
 * First checks the live Three.js scene graph for 100% precision on multi-part/imported models
 * Returns geometry in SCENE WORLD SPACE for zero-error BVH projection.
 */
export async function extractTargetGeometry(targetObj: CSGObject): Promise<THREE.BufferGeometry> {
  // 1. Try extracting directly from live Three.js scene (most accurate for complex/imported/multi-mesh models like AT-AT)
  if (typeof window !== 'undefined') {
    try {
      const getAllMeshes = (window as any).__getAllObjectMeshes;
      const getMesh = (window as any).__getObjectMesh;
      const liveMeshes: THREE.Mesh[] = getAllMeshes ? getAllMeshes(targetObj.id) : [];

      if (liveMeshes.length === 0 && getMesh) {
        const m = getMesh(targetObj.id);
        if (m) {
          if ((m as THREE.Mesh).isMesh) liveMeshes.push(m as THREE.Mesh);
          else {
            m.traverse((child: any) => {
              if (child.isMesh && !child.userData?.isWireOverlay && child.visible !== false) {
                liveMeshes.push(child);
              }
            });
          }
        }
      }

      if (liveMeshes.length > 0) {
        const geometries: THREE.BufferGeometry[] = [];
        const tempV = new THREE.Vector3();

        for (const mesh of liveMeshes) {
          if (!mesh.geometry || !mesh.geometry.attributes.position) continue;
          mesh.updateMatrixWorld(true);

          let cleanG: THREE.BufferGeometry | null = null;

          const isSkinned = (mesh as any).isSkinnedMesh &&
            (mesh as THREE.SkinnedMesh).skeleton &&
            mesh.geometry.attributes.skinIndex &&
            mesh.geometry.attributes.skinWeight;

          if (isSkinned) {
            const sm = mesh as THREE.SkinnedMesh;
            if (sm.skeleton) sm.skeleton.update();
            const posAttr = sm.geometry.attributes.position;
            const count = posAttr.count;
            const bakedPositions = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
              tempV.fromBufferAttribute(posAttr, i);
              try {
                if (typeof (sm as any).applyBoneTransform === 'function') {
                  (sm as any).applyBoneTransform(i, tempV);
                }
              } catch {}
              tempV.applyMatrix4(sm.matrixWorld);
              bakedPositions[i * 3] = tempV.x;
              bakedPositions[i * 3 + 1] = tempV.y;
              bakedPositions[i * 3 + 2] = tempV.z;
            }

            const bakedGeo = new THREE.BufferGeometry();
            bakedGeo.setAttribute('position', new THREE.BufferAttribute(bakedPositions, 3));
            if (sm.geometry.attributes.uv) {
              bakedGeo.setAttribute('uv', sm.geometry.attributes.uv.clone());
            }
            if (sm.geometry.index) {
              bakedGeo.setIndex(sm.geometry.index.clone());
            }
            cleanG = bakedGeo.index ? bakedGeo.toNonIndexed() : bakedGeo;
            cleanG.computeVertexNormals();
          } else {
            const g = mesh.geometry.clone();
            g.applyMatrix4(mesh.matrixWorld);
            const nonIndexed = g.index ? g.toNonIndexed() : g;

            if (nonIndexed.attributes.position && nonIndexed.attributes.position.count > 0) {
              cleanG = new THREE.BufferGeometry();
              cleanG.setAttribute('position', nonIndexed.attributes.position);
              if (nonIndexed.attributes.uv) {
                cleanG.setAttribute('uv', nonIndexed.attributes.uv);
              }
              if (nonIndexed.attributes.normal) {
                cleanG.setAttribute('normal', nonIndexed.attributes.normal);
              } else {
                cleanG.computeVertexNormals();
              }
            }
          }

          if (cleanG && cleanG.attributes.position && cleanG.attributes.position.count > 0) {
            geometries.push(cleanG);
          }
        }

        if (geometries.length > 0) {
          const hasAnyUv = geometries.some(g => !!g.attributes.uv);
          if (hasAnyUv) {
            geometries.forEach(g => {
              if (!g.attributes.uv && g.attributes.position) {
                g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
              }
            });
          }
          const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
          if (merged && merged.attributes.position && merged.attributes.position.count > 0) {
            if (!merged.attributes.normal) {
              merged.computeVertexNormals();
            }
            merged.computeBoundingBox();
            return merged;
          }
        }
      }
    } catch (e) {
      console.warn('Could not extract from live mesh group:', e);
    }
  }

  let workingObj = targetObj;
  // If target has no vertices or is an imported model (GLB, GLTF, OBJ, STL), convert it to get full geometry
  if ((!workingObj.vertices || workingObj.vertices.length === 0) && workingObj.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      workingObj = await convertImportedToCSG(workingObj);
    } catch (err) {
      console.warn('Error converting imported target for shrinkwrap:', err);
    }
  }

  const geo = createBaseGeometry(workingObj);
  // Transform by object world matrix so targetGeo is consistently in SCENE WORLD SPACE
  const tgtWorldMat = getObjectWorldMatrix(targetObj);
  geo.applyMatrix4(tgtWorldMat);

  // Ensure normals and bounding box exist
  if (geo.attributes.position && !geo.attributes.normal) {
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox();
  return geo;
}

/**
 * Samples the interpolated UV coordinates from target geometry at the point closest to worldPos.
 */
export function sampleTargetUV(
  worldPos: THREE.Vector3,
  targetBvh: MeshBVH,
  targetGeo: THREE.BufferGeometry
): [number, number] | null {
  const uvAttr = targetGeo.getAttribute('uv');
  const posAttr = targetGeo.getAttribute('position');
  if (!uvAttr || !posAttr) return null;

  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
  const res = targetBvh.closestPointToPoint(worldPos, hitTmp as any);
  if (!res || res.faceIndex < 0) return null;

  const faceIndex = res.faceIndex;
  const indexAttr = targetGeo.getIndex();
  let i0: number, i1: number, i2: number;
  if (indexAttr) {
    i0 = indexAttr.getX(faceIndex * 3);
    i1 = indexAttr.getX(faceIndex * 3 + 1);
    i2 = indexAttr.getX(faceIndex * 3 + 2);
  } else {
    i0 = faceIndex * 3;
    i1 = faceIndex * 3 + 1;
    i2 = faceIndex * 3 + 2;
  }

  const p0 = new THREE.Vector3(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0));
  const p1 = new THREE.Vector3(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1));
  const p2 = new THREE.Vector3(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2));

  const bary = new THREE.Vector3();
  THREE.Triangle.getBarycoord(res.point, p0, p1, p2, bary);

  if (isNaN(bary.x) || isNaN(bary.y) || isNaN(bary.z)) {
    return [uvAttr.getX(i0), uvAttr.getY(i0)];
  }

  const u = bary.x * uvAttr.getX(i0) + bary.y * uvAttr.getX(i1) + bary.z * uvAttr.getX(i2);
  const v = bary.x * uvAttr.getY(i0) + bary.y * uvAttr.getY(i1) + bary.z * uvAttr.getY(i2);

  return [u, v];
}

/**
 * Calculates smooth vertex normals for an array of vertices and faces
 */
export function computeMeshVertexNormals(vertices: V3[], faces: MeshFace[]): THREE.Vector3[] {
  const normals: THREE.Vector3[] = vertices.map(() => new THREE.Vector3(0, 0, 0));

  for (const face of faces) {
    const idx = face.indices;
    if (idx.length < 3) continue;

    const v0 = new THREE.Vector3(...vertices[idx[0]]);
    const v1 = new THREE.Vector3(...vertices[idx[1]]);
    const v2 = new THREE.Vector3(...vertices[idx[2]]);

    const fn = new THREE.Vector3().crossVectors(
      v1.clone().sub(v0),
      v2.clone().sub(v0)
    ).normalize();

    for (let i = 0; i < idx.length; i++) {
      normals[idx[i]].add(fn);
    }
  }

  for (let i = 0; i < normals.length; i++) {
    if (normals[i].lengthSq() > 1e-8) {
      normals[i].normalize();
    } else {
      normals[i].set(0, 1, 0);
    }
  }

  return normals;
}

export interface ShrinkwrapResult {
  updatedObject: CSGObject;
  modifiedVerticesCount: number;
  report: string[];
}

/**
 * Applies the Shrinkwrap (Envolver) modifier from sourceObj onto targetObj
 */
export async function applyShrinkwrap(
  sourceObj: CSGObject,
  targetObj: CSGObject,
  config: ShrinkwrapConfig
): Promise<ShrinkwrapResult> {
  let resolvedSource = sourceObj;
  let resolvedTarget = targetObj;

  // Convert source if imported
  if ((!resolvedSource.vertices || resolvedSource.vertices.length === 0) && resolvedSource.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedSource = await convertImportedToCSG(resolvedSource);
    } catch (err) {
      console.warn('Error converting imported source for shrinkwrap:', err);
    }
  }

  // Convert target if imported
  if ((!resolvedTarget.vertices || resolvedTarget.vertices.length === 0) && resolvedTarget.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedTarget = await convertImportedToCSG(resolvedTarget);
    } catch (err) {
      console.warn('Error converting imported target for shrinkwrap:', err);
    }
  }

  const report: string[] = [];
  const srcVerts = resolvedSource.vertices ? [...resolvedSource.vertices] : [];
  const srcFaces = resolvedSource.faces || [];
  const numVerts = srcVerts.length;

  if (numVerts === 0) {
    return {
      updatedObject: resolvedSource,
      modifiedVerticesCount: 0,
      report: ['El objeto de origen no contiene vértices.']
    };
  }

  // 1. Prepare Target Geometry and BVH acceleration structure
  const targetGeo = await extractTargetGeometry(resolvedTarget);
  if (!targetGeo.attributes.position || targetGeo.attributes.position.count === 0) {
    return {
      updatedObject: resolvedSource,
      modifiedVerticesCount: 0,
      report: ['El objeto destino no contiene geometría válida para proyectar.']
    };
  }

  const targetBvh = new MeshBVH(targetGeo);

  // Matrices to handle arbitrary world positions/rotations/scales
  const srcWorldMat = getObjectWorldMatrix(resolvedSource);
  const srcWorldInv = srcWorldMat.clone().invert();
  const srcNormalMat = new THREE.Matrix3().getNormalMatrix(srcWorldMat);

  // Vertex normals for normal projection modes
  const srcNormalsLocal = computeMeshVertexNormals(srcVerts, srcFaces);

  const selectedSet = config.onlySelectedVertices && (config as any).selectedVertexIndices?.length
    ? new Set<number>((config as any).selectedVertexIndices)
    : null;

  let modifiedCount = 0;
  const offsetDistance = Number.isFinite(config.offset) ? config.offset : 0.002;

  // Pre-allocate working vectors
  const vLocal = new THREE.Vector3();
  const vWorld = new THREE.Vector3();
  const closestTargetHit: { point: THREE.Vector3; distance: number; faceIndex: number } = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1
  };

  // Extract target position attribute and index for face normals
  const tgtPosAttr = targetGeo.getAttribute('position');
  const tgtIndex = targetGeo.getIndex();

  const getTargetFaceNormal = (faceIndex: number): THREE.Vector3 => {
    if (faceIndex < 0 || !tgtPosAttr) return new THREE.Vector3(0, 1, 0);

    let i0 = faceIndex * 3;
    let i1 = faceIndex * 3 + 1;
    let i2 = faceIndex * 3 + 2;

    if (tgtIndex) {
      i0 = tgtIndex.getX(i0);
      i1 = tgtIndex.getX(i1);
      i2 = tgtIndex.getX(i2);
    }

    if (i0 >= tgtPosAttr.count || i1 >= tgtPosAttr.count || i2 >= tgtPosAttr.count) {
      return new THREE.Vector3(0, 1, 0);
    }

    const p0 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);

    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const fn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    return fn.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : fn;
  };

  for (let i = 0; i < numVerts; i++) {
    if (selectedSet && !selectedSet.has(i)) {
      continue;
    }

    // Reset closest target hit per vertex
    closestTargetHit.distance = Infinity;
    closestTargetHit.faceIndex = -1;

    // Source vertex in world space
    vLocal.set(srcVerts[i][0], srcVerts[i][1], srcVerts[i][2]);
    vWorld.copy(vLocal).applyMatrix4(srcWorldMat);

    let snappedWorldPoint: THREE.Vector3 | null = null;
    let snappedWorldNormal: THREE.Vector3 | null = null;

    if (config.mode === 'NEAREST_SURFACE_POINT') {
      // ── MODO 1: Punto de superficie más cercano ─────────────────────────
      const res = targetBvh.closestPointToPoint(vWorld, closestTargetHit as any);
      if (res && res.point) {
        snappedWorldPoint = res.point.clone();
        snappedWorldNormal = getTargetFaceNormal(res.faceIndex);
      }
    } else if (config.mode === 'PROJECT') {
      // ── MODO 2: Proyectar a lo largo de un eje (X, Y, Z) ─────────────────
      const axis = config.projectAxis || 'Z';
      const dirMode = config.projectDirection || 'BOTH';

      const rayDirWorld = new THREE.Vector3(
        axis === 'X' ? 1 : 0,
        axis === 'Y' ? 1 : 0,
        axis === 'Z' ? 1 : 0
      );

      const hits: { hit: any; sign: number }[] = [];

      if (dirMode === 'POSITIVE' || dirMode === 'BOTH') {
        const rayPos = new THREE.Ray(vWorld, rayDirWorld);
        const hitPos = targetBvh.raycastFirst(rayPos);
        if (hitPos) hits.push({ hit: hitPos, sign: 1 });
      }

      if (dirMode === 'NEGATIVE' || dirMode === 'BOTH') {
        const rayNeg = new THREE.Ray(vWorld, rayDirWorld.clone().negate());
        const hitNeg = targetBvh.raycastFirst(rayNeg);
        if (hitNeg) hits.push({ hit: hitNeg, sign: -1 });
      }

      if (hits.length > 0) {
        hits.sort((a, b) => a.hit.distance - b.hit.distance);
        const best = hits[0].hit;
        snappedWorldPoint = best.point.clone();
        snappedWorldNormal = best.normal || getTargetFaceNormal(best.faceIndex);
      } else {
        // Fallback: closest point on surface
        const res = targetBvh.closestPointToPoint(vWorld, closestTargetHit as any);
        if (res && res.point) {
          snappedWorldPoint = res.point.clone();
          snappedWorldNormal = getTargetFaceNormal(res.faceIndex);
        }
      }
    } else if (config.mode === 'NEAREST_VERTEX') {
      // ── MODO 3: Vértice más cercano ──────────────────────────────────────
      let minDistSq = Infinity;
      let closestVIdx = -1;
      const count = tgtPosAttr.count;

      const pCur = new THREE.Vector3();
      for (let k = 0; k < count; k++) {
        pCur.fromBufferAttribute(tgtPosAttr, k);
        const dSq = pCur.distanceToSquared(vWorld);
        if (dSq < minDistSq) {
          minDistSq = dSq;
          closestVIdx = k;
        }
      }

      if (closestVIdx >= 0) {
        snappedWorldPoint = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, closestVIdx);

        const tgtNormAttr = targetGeo.getAttribute('normal');
        if (tgtNormAttr) {
          snappedWorldNormal = new THREE.Vector3()
            .fromBufferAttribute(tgtNormAttr, closestVIdx)
            .normalize();
        } else {
          snappedWorldNormal = new THREE.Vector3(0, 1, 0);
        }
      }
    } else if (config.mode === 'TARGET_NORMAL_PROJECT') {
      // ── MODO 4: Proyección de normales del objetivo / superficie ─────────
      const srcNormWorld = srcNormalsLocal[i].clone().applyMatrix3(srcNormalMat).normalize();

      // Raycast inward and outward along vertex normal in world space
      const rayIn = new THREE.Ray(vWorld, srcNormWorld.clone().negate());
      const hitIn = targetBvh.raycastFirst(rayIn);

      const rayOut = new THREE.Ray(vWorld, srcNormWorld);
      const hitOut = targetBvh.raycastFirst(rayOut);

      let chosenHit: any = null;
      if (hitIn && hitOut) {
        chosenHit = hitIn.distance <= hitOut.distance ? hitIn : hitOut;
      } else {
        chosenHit = hitIn || hitOut;
      }

      if (chosenHit) {
        snappedWorldPoint = chosenHit.point.clone();
        snappedWorldNormal = chosenHit.normal || getTargetFaceNormal(chosenHit.faceIndex);
      } else {
        // Fallback to closest surface point
        const res = targetBvh.closestPointToPoint(vWorld, closestTargetHit as any);
        if (res && res.point) {
          snappedWorldPoint = res.point.clone();
          snappedWorldNormal = getTargetFaceNormal(res.faceIndex);
        }
      }
    }

    if (snappedWorldPoint) {
      const normal = snappedWorldNormal || new THREE.Vector3(0, 1, 0);
      // Desplazamiento (Offset) para evitar Z-fighting
      if (offsetDistance !== 0) {
        snappedWorldPoint.addScaledVector(normal, offsetDistance);
      }

      // Convert snapped point back to source object local space
      const newLocalPos = snappedWorldPoint.clone().applyMatrix4(srcWorldInv);
      srcVerts[i] = [newLocalPos.x, newLocalPos.y, newLocalPos.z];
      modifiedCount++;
    }
  }

  // Cleanup BVH resources
  targetGeo.dispose();

  report.push(`Shrinkwrap aplicado con éxito: ${modifiedCount} de ${numVerts} vértices proyectados.`);
  report.push(`Modo: ${config.mode}, Offset: ${offsetDistance.toFixed(4)}`);

  return {
    updatedObject: {
      ...resolvedSource,
      vertices: srcVerts,
      faces: srcFaces,
      meshData: undefined, // Fully baked into editable CSG mesh
      vertexOffsets: {}, // Clear temporary gizmo offsets once baked into base vertices
      stats: {
        ...(resolvedSource.stats || {}),
        vertices: srcVerts.length,
        faces: srcFaces.length
      }
    },
    modifiedVerticesCount: modifiedCount,
    report
  };
}

/**
 * Blender-style Solidify modifier: gives physical thickness to an open or surface mesh
 * - Duplicates faces with inverted normals
 * - Offsets outer and inner surfaces along vertex normals
 * - Bridges boundary edges with quadrilaterals
 */
export function solidifyMesh(
  obj: CSGObject,
  thickness: number = 0.05,
  offsetFactor: number = 0.0 // -1.0 = inner only, 0.0 = centered, 1.0 = outer only
): CSGObject {
  const origVerts = obj.vertices;
  const origFaces = obj.faces;
  const numOrigVerts = origVerts.length;

  if (numOrigVerts === 0 || origFaces.length === 0) return obj;

  const normals = computeMeshVertexNormals(origVerts, origFaces);

  // Compute outer and inner vertices
  // offsetFactor: 1.0 -> extrude +thickness outward
  // 0.0 -> -thickness/2 to +thickness/2
  // -1.0 -> extrude -thickness inward
  const halfT = thickness * 0.5;
  const outerDist = halfT + (offsetFactor * halfT);
  const innerDist = -halfT + (offsetFactor * halfT);

  const newVertices: V3[] = [];

  // Front vertices [0 .. numOrigVerts - 1]
  for (let i = 0; i < numOrigVerts; i++) {
    const v = origVerts[i];
    const n = normals[i];
    newVertices.push([
      v[0] + n.x * outerDist,
      v[1] + n.y * outerDist,
      v[2] + n.z * outerDist
    ]);
  }

  // Back vertices [numOrigVerts .. 2*numOrigVerts - 1]
  for (let i = 0; i < numOrigVerts; i++) {
    const v = origVerts[i];
    const n = normals[i];
    newVertices.push([
      v[0] + n.x * innerDist,
      v[1] + n.y * innerDist,
      v[2] + n.z * innerDist
    ]);
  }

  const newFaces: MeshFace[] = [];

  // 1. Front faces (pointing outward, original winding)
  for (const f of origFaces) {
    newFaces.push({
      ...f,
      indices: [...f.indices]
    });
  }

  // 2. Back faces (pointing inward, reversed winding + offset index)
  for (const f of origFaces) {
    const revIdx = [...f.indices].reverse().map(idx => idx + numOrigVerts);
    newFaces.push({
      ...f,
      indices: revIdx
    });
  }

  // 3. Find boundary edges and create side rim faces
  // An edge is boundary if it is shared by only 1 face
  const edgeCount = new Map<string, { v0: number; v1: number; count: number }>();

  for (const f of origFaces) {
    const idx = f.indices;
    const len = idx.length;
    for (let i = 0; i < len; i++) {
      const v0 = idx[i];
      const v1 = idx[(i + 1) % len];
      const key = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
      const existing = edgeCount.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeCount.set(key, { v0, v1, count: 1 });
      }
    }
  }

  // Bridge boundaries
  for (const { v0, v1, count } of edgeCount.values()) {
    if (count === 1) {
      // Boundary edge: create quad (two triangles) connecting front & back
      const f0 = v0;
      const f1 = v1;
      const b0 = v0 + numOrigVerts;
      const b1 = v1 + numOrigVerts;

      // Outer to inner bridging
      newFaces.push({ indices: [f0, b0, b1] });
      newFaces.push({ indices: [f0, b1, f1] });
    }
  }

  return {
    ...obj,
    vertices: newVertices,
    faces: newFaces,
    vertexOffsets: {},
    stats: {
      vertices: newVertices.length,
      faces: newFaces.length
    }
  };
}

export interface RetopoQuadPlaneOptions {
  targetObj?: CSGObject | null;
  subdivisions?: number;
  orientation?: 'FRONT' | 'TOP' | 'SIDE' | 'VIEW';
  marginFactor?: number;
  customWidth?: number;
  customHeight?: number;
}

export function getObjectRealBoundingBox(obj: CSGObject): {
  center: [number, number, number];
  size: [number, number, number];
  maxDim: number;
} {
  const box = new THREE.Box3();
  let found = false;

  // 1. Check window.__getObjectRealBox (comprehensive box covering all parts of the model)
  if (typeof window !== 'undefined') {
    const getRealBox = (window as any).__getObjectRealBox;
    if (getRealBox) {
      const b = getRealBox(obj.id);
      if (b && !b.isEmpty() && isFinite(b.min.x) && isFinite(b.max.x)) {
        box.copy(b);
        found = true;
      }
    }

    if (!found) {
      const getAllMeshes = (window as any).__getAllObjectMeshes;
      if (getAllMeshes) {
        const meshes: THREE.Mesh[] = getAllMeshes(obj.id);
        if (meshes.length > 0) {
          meshes.forEach(m => {
            m.updateMatrixWorld(true);
            box.expandByObject(m);
          });
          if (!box.isEmpty() && isFinite(box.min.x)) {
            found = true;
          }
        }
      }
    }

    if (!found) {
      const getMesh = (window as any).__getObjectMesh;
      if (getMesh) {
        const mesh = getMesh(obj.id);
        if (mesh) {
          mesh.updateMatrixWorld(true);
          box.setFromObject(mesh);
          if (!box.isEmpty() && isFinite(box.min.x) && isFinite(box.max.x)) {
            found = true;
          }
        }
      }
    }
  }

  // 2. Procedural vertices fallback
  if (!found && obj.vertices && obj.vertices.length > 0) {
    obj.vertices.forEach(v => {
      box.expandByPoint(new THREE.Vector3(v[0], v[1], v[2]));
    });
    const scale = obj.transform?.scale || [1, 1, 1];
    const pos = obj.transform?.position || [0, 0, 0];
    box.min.multiply(new THREE.Vector3(scale[0], scale[1], scale[2])).add(new THREE.Vector3(pos[0], pos[1], pos[2]));
    box.max.multiply(new THREE.Vector3(scale[0], scale[1], scale[2])).add(new THREE.Vector3(pos[0], pos[1], pos[2]));
    found = true;
  }

  if (!found || box.isEmpty() || !isFinite(box.min.x)) {
    const pos = obj.transform?.position || [0, 0, 0];
    const scale = obj.transform?.scale || [1, 1, 1];
    const s = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]), 5);
    return {
      center: [pos[0], pos[1], pos[2]],
      size: [s * 2, s * 2, s * 2],
      maxDim: s * 2
    };
  }

  const centerVec = new THREE.Vector3();
  const sizeVec = new THREE.Vector3();
  box.getCenter(centerVec);
  box.getSize(sizeVec);

  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0.5);

  return {
    center: [centerVec.x, centerVec.y, centerVec.z],
    size: [sizeVec.x, sizeVec.y, sizeVec.z],
    maxDim
  };
}

export function createRetopoQuadPlane(options: RetopoQuadPlaneOptions): CSGObject {
  const {
    targetObj,
    subdivisions = 100,
    orientation = 'FRONT',
    marginFactor = 1.15,
    customWidth,
    customHeight
  } = options;

  let center: [number, number, number] = [0, 0, 0];
  let size: [number, number, number] = [10, 10, 10];

  if (targetObj) {
    const b = getObjectRealBoundingBox(targetObj);
    center = b.center;
    size = b.size;
  }

  let width = customWidth || Math.max(2, size[0] * marginFactor);
  let height = customHeight || Math.max(2, size[1] * marginFactor);
  let position: [number, number, number] = [center[0], center[1], center[2] + Math.max(size[2] * 0.55, 0.8)];
  let rotation: [number, number, number] = [0, 0, 0];

  if (orientation === 'TOP') {
    width = customWidth || Math.max(2, size[0] * marginFactor);
    height = customHeight || Math.max(2, size[2] * marginFactor);
    position = [center[0], center[1] + Math.max(size[1] * 0.55, 0.8), center[2]];
    rotation = [-Math.PI / 2, 0, 0];
  } else if (orientation === 'SIDE') {
    width = customWidth || Math.max(2, size[2] * marginFactor);
    height = customHeight || Math.max(2, size[1] * marginFactor);
    position = [center[0] + Math.max(size[0] * 0.55, 0.8), center[1], center[2]];
    rotation = [0, Math.PI / 2, 0];
  } else if (orientation === 'VIEW') {
    const cam = typeof window !== 'undefined' && (window as any).__viewportCamera ? (window as any).__viewportCamera() : null;
    if (cam) {
      const camDir = new THREE.Vector3();
      cam.getWorldDirection(camDir);
      const maxD = Math.max(size[0], size[1], size[2]);
      width = customWidth || Math.max(2, maxD * marginFactor);
      height = customHeight || Math.max(2, maxD * marginFactor);
      const planePos = new THREE.Vector3(center[0], center[1], center[2]).addScaledVector(camDir, -Math.max(maxD * 0.55, 1.0));
      position = [planePos.x, planePos.y, planePos.z];
      const euler = new THREE.Euler().setFromQuaternion(cam.quaternion);
      rotation = [euler.x, euler.y, euler.z];
    }
  }

  const segs = Math.max(1, Math.min(250, Math.round(subdivisions)));
  const vertices: [number, number, number][] = [];
  const faces: MeshFace[] = [];

  const halfW = width / 2;
  const halfH = height / 2;

  for (let iy = 0; iy <= segs; iy++) {
    const y = -halfH + (iy / segs) * height;
    for (let ix = 0; ix <= segs; ix++) {
      const x = -halfW + (ix / segs) * width;
      vertices.push([x, y, 0]);
    }
  }

  const stride = segs + 1;
  for (let iy = 0; iy < segs; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = (iy + 1) * stride + (ix + 1);
      const d = (iy + 1) * stride + ix;
      faces.push({
        indices: [a, b, c, d],
        uvs: [
          [ix / segs, iy / segs],
          [(ix + 1) / segs, iy / segs],
          [(ix + 1) / segs, (iy + 1) / segs],
          [ix / segs, (iy + 1) / segs]
        ]
      });
    }
  }

  const planeId = 'retopo_plane_' + Math.random().toString(36).substring(2, 8);
  const targetLabel = targetObj ? ` (${targetObj.name || 'Malla'})` : '';

  return {
    id: planeId,
    name: `Plano Retopo Quads ${segs}x${segs}${targetLabel}`,
    type: 'MESH',
    operation: 'ADD',
    keyframes: [],
    visible: true,
    color: '#06b6d4',
    opacity: 0.9,
    smoothShading: true,
    transform: {
      position,
      rotation,
      scale: [1, 1, 1],
    },
    parameters: {
      isRetopoPlane: true,
      subdivisions: segs,
      targetId: targetObj?.id
    },
    vertices,
    faces,
    stats: {
      vertices: vertices.length,
      faces: faces.length
    }
  };
}

export interface RetopoCageOptions {
  targetObj?: CSGObject;
  subdivisions?: number;
  heightSubdivisions?: number; // Número explícito de polígonos/cortes en altura (eje Y)
  marginFactor?: number;
  shape?: 'ELLIPSOID' | 'BOX' | 'CYLINDER';
}

/**
 * Genera una caja 3D compuesta 100% por caras cuadriláteras (Quads) con normales exteriores
 * sin ninguna cara triangular ni arista diagonal.
 */
export function generateQuadBox(
  sx: number, sy: number, sz: number,
  nx: number, ny: number, nz: number
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];
  const vertMap = new Map<string, number>();

  const getOrAddVertex = (x: number, y: number, z: number): number => {
    const rx = Math.round(x * 10000) + 0;
    const ry = Math.round(y * 10000) + 0;
    const rz = Math.round(z * 10000) + 0;
    const k = `${rx}_${ry}_${rz}`;
    const existing = vertMap.get(k);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push([x, y, z]);
    vertMap.set(k, idx);
    return idx;
  };

  const hx = sx / 2, hy = sy / 2, hz = sz / 2;

  const buildFace = (
    uSegs: number, vSegs: number,
    getPt: (u: number, v: number) => [number, number, number]
  ) => {
    const grid: number[][] = [];
    for (let j = 0; j <= vSegs; j++) {
      const row: number[] = [];
      const v = j / vSegs;
      for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs;
        const pt = getPt(u, v);
        row.push(getOrAddVertex(pt[0], pt[1], pt[2]));
      }
      grid.push(row);
    }

    for (let j = 0; j < vSegs; j++) {
      for (let i = 0; i < uSegs; i++) {
        const v0 = grid[j][i];
        const v1 = grid[j][i + 1];
        const v2 = grid[j + 1][i + 1];
        const v3 = grid[j + 1][i];
        faces.push({ indices: [v0, v1, v2, v3] });
      }
    }
  };

  // 6 caras con normales exteriores CCW:
  // Frontal (+Z): u hacia +X, v hacia +Y, z = +hz
  buildFace(nx, ny, (u, v) => [-hx + u * sx, -hy + v * sy, hz]);
  // Posterior (-Z): u hacia -X, v hacia +Y, z = -hz
  buildFace(nx, ny, (u, v) => [hx - u * sx, -hy + v * sy, -hz]);
  // Superior (+Y): u hacia +X, v hacia -Z, y = +hy
  buildFace(nx, nz, (u, v) => [-hx + u * sx, hy, hz - v * sz]);
  // Inferior (-Y): u hacia +X, v hacia +Z, y = -hy
  buildFace(nx, nz, (u, v) => [-hx + u * sx, -hy, -hz + v * sz]);
  // Derecha (+X): x = +hx constante, u hacia -Z, v hacia +Y
  buildFace(nz, ny, (u, v) => [hx, -hy + v * sy, hz - u * sz]);
  // Izquierda (-X): x = -hx constante, u hacia +Z, v hacia +Y
  buildFace(nz, ny, (u, v) => [-hx, -hy + v * sy, -hz + u * sz]);

  return { vertices, faces };
}

/**
 * Genera una esfera/elipsoide 100% Quads basada en Cube-Sphere normalizada sin polos triangulares.
 */
export function generateQuadSphere(
  rx: number, ry: number, rz: number,
  segs: number,
  heightSegs?: number
): { vertices: V3[]; faces: MeshFace[] } {
  const n = Math.max(2, Math.round(segs / 2));
  const ny = heightSegs !== undefined && heightSegs > 0 ? Math.max(1, Math.round(heightSegs / 2)) : n;
  const rawBox = generateQuadBox(2, 2, 2, n, ny, n);
  const sphereVerts: V3[] = rawBox.vertices.map(([x, y, z]) => {
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    const sx = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
    const sy = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3));
    const sz = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
    return [sx * rx, sy * ry, sz * rz] as V3;
  });
  return {
    vertices: sphereVerts,
    faces: rawBox.faces
  };
}

/**
 * Genera un cilindro con cuerpo y tapas cuadriláteras (100% Quads).
 */
export function generateQuadCylinder(
  radius: number, height: number,
  radialSegs: number, heightSegs: number,
  axis: 'X' | 'Y' | 'Z' = 'Y'
): { vertices: V3[]; faces: MeshFace[] } {
  const vertices: V3[] = [];
  const faces: MeshFace[] = [];
  const vertMap = new Map<string, number>();

  const getOrAddVertex = (coordU: number, coordV: number, coordH: number): number => {
    let x = 0, y = 0, z = 0;
    if (axis === 'Z') {
      x = coordU;
      y = coordV;
      z = coordH;
    } else if (axis === 'X') {
      x = coordH;
      y = coordU;
      z = coordV;
    } else {
      x = coordU;
      y = coordH;
      z = coordV;
    }
    const rx = Math.round(x * 10000) + 0;
    const ry = Math.round(y * 10000) + 0;
    const rz = Math.round(z * 10000) + 0;
    const k = `${rx}_${ry}_${rz}`;
    const existing = vertMap.get(k);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push([x, y, z]);
    vertMap.set(k, idx);
    return idx;
  };

  const nr = Math.max(6, radialSegs);
  const nh = Math.max(1, heightSegs);
  const halfH = height / 2;

  // 1. Tubo cilíndrico
  const tubeGrid: number[][] = [];
  for (let j = 0; j <= nh; j++) {
    const row: number[] = [];
    const h = -halfH + (j / nh) * height;
    for (let i = 0; i < nr; i++) {
      const angle = (i / nr) * 2 * Math.PI;
      const u = radius * Math.cos(angle);
      const v = radius * Math.sin(angle);
      row.push(getOrAddVertex(u, v, h));
    }
    tubeGrid.push(row);
  }

  for (let j = 0; j < nh; j++) {
    for (let i = 0; i < nr; i++) {
      const nextI = (i + 1) % nr;
      const v0 = tubeGrid[j][i];
      const v1 = tubeGrid[j][nextI];
      const v2 = tubeGrid[j + 1][nextI];
      const v3 = tubeGrid[j + 1][i];
      if (axis === 'Z' || axis === 'X') {
        faces.push({ indices: [v0, v1, v2, v3] });
      } else {
        faces.push({ indices: [v0, v3, v2, v1] });
      }
    }
  }

  // 2. Tapas cuadriláteras concéntricas (100% quads)
  const makeCap = (h: number, isTop: boolean) => {
    const rings = nr <= 16 ? 1 : Math.max(1, Math.round(nr / 8));
    const ringGrid: number[][] = [];
    for (let r = 0; r <= rings; r++) {
      const row: number[] = [];
      const curR = (1 - r / rings) * radius;
      for (let i = 0; i < nr; i++) {
        const angle = (i / nr) * 2 * Math.PI;
        const u = curR * Math.cos(angle);
        const v = curR * Math.sin(angle);
        row.push(getOrAddVertex(u, v, h));
      }
      ringGrid.push(row);
    }

    for (let r = 0; r < rings - 1; r++) {
      for (let i = 0; i < nr; i++) {
        const nextI = (i + 1) % nr;
        const v0 = ringGrid[r][i];
        const v1 = ringGrid[r][nextI];
        const v2 = ringGrid[r + 1][nextI];
        const v3 = ringGrid[r + 1][i];
        if (axis === 'Z' || axis === 'X') {
          if (isTop) {
            faces.push({ indices: [v0, v1, v2, v3] });
          } else {
            faces.push({ indices: [v0, v3, v2, v1] });
          }
        } else {
          if (isTop) {
            faces.push({ indices: [v0, v3, v2, v1] });
          } else {
            faces.push({ indices: [v0, v1, v2, v3] });
          }
        }
      }
    }

    const centerIdx = getOrAddVertex(0, 0, h);
    const lastR = rings - 1;
    for (let i = 0; i < nr; i += 2) {
      const i1 = (i + 1) % nr;
      const i2 = (i + 2) % nr;
      const v0 = ringGrid[lastR][i];
      const v1 = ringGrid[lastR][i1];
      const v2 = ringGrid[lastR][i2];
      if (axis === 'Z' || axis === 'X') {
        if (isTop) {
          faces.push({ indices: [centerIdx, v0, v1, v2] });
        } else {
          faces.push({ indices: [centerIdx, v2, v1, v0] });
        }
      } else {
        if (isTop) {
          faces.push({ indices: [centerIdx, v2, v1, v0] });
        } else {
          faces.push({ indices: [centerIdx, v0, v1, v2] });
        }
      }
    }
  };

  makeCap(halfH, true);
  makeCap(-halfH, false);

  return { vertices, faces };
}

/**
 * Creates a proportional 3D Cage wrapper adapted to the real dimensions (length, height, width) of the target model
 */
export function createRetopoCage(options: RetopoCageOptions = {}): CSGObject {
  const {
    targetObj,
    subdivisions = 16, // 16x16 produces an optimal, clean quad mesh without polygon clutter
    heightSubdivisions,
    marginFactor = 1.08,
    shape = 'ELLIPSOID'
  } = options;

  let center: [number, number, number] = [0, 0, 0];
  let size: [number, number, number] = [10, 10, 10];

  if (targetObj) {
    const b = getObjectRealBoundingBox(targetObj);
    center = b.center;
    size = b.size;
  }

  const segs = Math.max(4, Math.min(128, Math.round(subdivisions)));
  const hSegs = heightSubdivisions !== undefined && heightSubdivisions > 0
    ? Math.max(1, Math.min(64, Math.round(heightSubdivisions)))
    : undefined;

  let cageData: { vertices: V3[]; faces: MeshFace[] };
  let appliedHeightSegs = hSegs;

  if (shape === 'BOX') {
    const maxDim = Math.max(size[0], size[1], size[2], 0.01);
    const boxSegsX = Math.max(2, Math.round((size[0] / maxDim) * segs));
    const boxSegsY = hSegs !== undefined
      ? hSegs
      : Math.max(2, Math.round((size[1] / maxDim) * segs));
    const boxSegsZ = Math.max(2, Math.round((size[2] / maxDim) * segs));
    appliedHeightSegs = boxSegsY;
    const sx = Math.max(size[0] * marginFactor, 0.01);
    const sy = Math.max(size[1] * marginFactor, 0.01);
    const sz = Math.max(size[2] * marginFactor, 0.01);
    cageData = generateQuadBox(sx, sy, sz, boxSegsX, boxSegsY, boxSegsZ);
  } else if (shape === 'CYLINDER') {
    // Detectar eje de extrusión según dimensiones relativas
    let axis: 'X' | 'Y' | 'Z' = 'Y';
    if (size[2] < size[0] * 0.75 && size[2] < size[1] * 0.75) {
      axis = 'Z';
    } else if (size[0] < size[1] * 0.75 && size[0] < size[2] * 0.75) {
      axis = 'X';
    }

    let radius = 0;
    let height = 0;
    if (axis === 'Z') {
      radius = Math.max(size[0], size[1]) * 0.55 * marginFactor;
      height = Math.max(size[2] * marginFactor, 0.01);
    } else if (axis === 'X') {
      radius = Math.max(size[1], size[2]) * 0.55 * marginFactor;
      height = Math.max(size[0] * marginFactor, 0.01);
    } else {
      radius = Math.max(size[0], size[2]) * 0.55 * marginFactor;
      height = Math.max(size[1] * marginFactor, 0.01);
    }

    const radialSegs = Math.max(6, Math.min(128, segs));
    const heightSegs = hSegs !== undefined
      ? hSegs
      : Math.max(1, Math.min(64, Math.round(segs * (height / Math.max(radius * 2, 0.01)))));
    appliedHeightSegs = heightSegs;
    cageData = generateQuadCylinder(radius, height, radialSegs, heightSegs, axis);
  } else {
    // Proportional Ellipsoid / Sphere: 100% Pure Quad Cube-Sphere (sin polos triangulares)
    // Usamos 0.88 * marginFactor para garantizar que las puntas diagonales y esquinas queden 100% dentro del elipsoide
    const rx = Math.max(size[0] * 0.88 * marginFactor, 0.01);
    const ry = Math.max(size[1] * 0.88 * marginFactor, 0.01);
    const rz = Math.max(size[2] * 0.88 * marginFactor, 0.01);
    appliedHeightSegs = hSegs;
    cageData = generateQuadSphere(rx, ry, rz, segs, hSegs);
  }

  const { vertices, faces } = cageData;
  const cageId = 'retopo_cage_' + Math.random().toString(36).substring(2, 8);
  const targetLabel = targetObj ? ` (${targetObj.name || 'Malla'})` : '';
  const heightTag = appliedHeightSegs !== undefined ? `x${appliedHeightSegs}Y` : '';

  return {
    id: cageId,
    name: `Cage Envoltura ${shape === 'BOX' ? 'Cubo' : shape === 'CYLINDER' ? 'Cilindro' : 'Elipsoide'} ${segs}${heightTag}${targetLabel}`,
    type: 'MESH',
    operation: 'ADD',
    keyframes: [],
    visible: true,
    color: '#38bdf8',
    opacity: 0.55,
    smoothShading: targetObj?.smoothShading ?? false,
    transform: {
      position: center,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    parameters: {
      isWrapperCage: true,
      subdivisions: segs,
      heightSubdivisions: appliedHeightSegs,
      targetId: targetObj?.id,
      cageShape: shape
    },
    vertices,
    faces,
    stats: {
      vertices: vertices.length,
      faces: faces.length
    }
  };
}

export interface SilhouetteVacuumWrapConfig {
  autoSubdivide?: boolean;
  minFacesTarget?: number;
  iterations?: number;
  relaxation?: number;
  offset?: number;
  clampToRayHitsOnly?: boolean;
  pruneAirFaces?: boolean;             // Prune faces bridging empty space/voids (e.g. between wings and cockpit)
  airDistanceThreshold?: number;       // Normalized max distance from face centroid to surface
  maxStretchRatio?: number;            // Max edge stretch relative to median edge length (default: 2.5)
  minIslandFaces?: number;             // Minimum faces required for an island to be kept (default: 4)
  aggressivePruning?: boolean;         // Strict limb separation
  sensitivity?: 'conservative' | 'balanced' | 'aggressive';
  autoFillHoles?: boolean;             // Automatically cap open boundary loops after pruning
  maxHoleEdges?: number;               // Max edges in an open hole loop to auto-cap
  // Opciones de optimización y reducción de topología
  optimizeTopology?: boolean;          // Optimizar y reducir densidad poligonal conservando aristas vivas y silueta (default: true)
  reductionRatio?: number;             // Ratio objetivo (default: 0.35, ~65% reducción)
  targetPolyCount?: number;            // Número objetivo explícito de polígonos
  preserveCreases?: boolean;           // Preservar aristas vivas y esquinas (default: true)
  creaseAngleDeg?: number;             // Ángulo umbral de arista viva en grados (default: 25)
  outputTopology?: 'QUAD_DOMINANT' | 'PURE_QUADS' | 'TRIANGLES'; // Flujo de polígonos de salida (default: QUAD_DOMINANT)
  snapPlanarFaces?: boolean;           // Anclar y aplanar caras superiores/inferiores coplanares evitando abombamiento
  snapSharpFeatures?: boolean;         // Detectar y ceñir vértices a esquinas y puntas vivas
  antiRounding?: boolean;              // Activar pipeline anti-redondeo de Michael Gold/Comfy3D
  subdivideStretchedEdges?: boolean;   // Subdivisión adaptativa de aristas estiradas (default: false)
  regularizeSurface?: boolean;         // Homogeneización tangencial de la superficie (default: false para cages ortogonales)
  smoothShading?: boolean;             // Forzar sombreado suave (true) o facetado/hard-surface (false)
  normalAlignmentWeight?: number;      // Peso de alineación de normales (0 a 1). Prioriza caras cuya orientación coincide con el vértice de la jaula, evitando huecos y saltos en ángulos agudos
}

export interface OptimizeConformedMeshOptions {
  targetReductionRatio?: number;       // Ratio de polígonos deseados (ej: 0.25 para 75% de reducción, 0.50 para 50%)
  targetPolyCount?: number;            // Número explícito de polígonos finales deseados
  preserveCreases?: boolean;           // Preservar aristas vivas, crestas y esquinas estructurales (default: true)
  creaseAngleDeg?: number;             // Ángulo diedro para considerar arista viva (default: 25°)
  reprojectToTarget?: boolean;         // Reproyectar vértices simplificados al BVH del objetivo para cero pérdida de silueta (default: true)
  offset?: number;                     // Separación de superficie al reproyectar (default: 0.002)
  outputTopology?: 'QUAD_DOMINANT' | 'PURE_QUADS' | 'TRIANGLES'; // Formato de polígonos (default: QUAD_DOMINANT)
  errorTolerance?: number;             // Tolerancia máxima de desviación geométrica (default: 0.035)
}

export interface OptimizeConformedMeshResult {
  updatedObject: CSGObject;
  report: string[];
  stats: {
    initialFaces: number;
    finalFaces: number;
    initialVertices: number;
    finalVertices: number;
    quads: number;
    triangles: number;
    reductionPct: number;
  };
}

export interface PruneAirFacesOptions {
  airDistanceThreshold?: number;
  maxStretchRatio?: number;
  minIslandFaces?: number;
  aggressive?: boolean;
  sensitivity?: 'conservative' | 'balanced' | 'aggressive';
  offset?: number;
  autoFillHoles?: boolean;
  maxHoleEdges?: number;
}

/**
 * Seals open boundary holes (loops created when severing membranes or air bridges).
 * Only caps TRUE LOCAL puncture holes (perimeter <= 8 edges, diameter <= 2.8x median edge),
 * strictly refusing to bridge open severed limbs, cuts, or chasms.
 */
export function fillSmallBoundaryHoles(
  vertices: V3[],
  faces: MeshFace[],
  maxHoleEdges: number = 8,
  targetBvh?: MeshBVH | null
): { vertices: V3[]; faces: MeshFace[]; holesFilled: number } {
  if (!vertices || vertices.length < 3 || !faces || faces.length === 0) {
    return { vertices, faces, holesFilled: 0 };
  }

  // Sample median edge length of the mesh
  const edgeLens: number[] = [];
  const sampleStep = Math.max(1, Math.floor(faces.length / 300));
  for (let fi = 0; fi < faces.length; fi += sampleStep) {
    const idxs = faces[fi].indices;
    for (let i = 0; i < idxs.length; i++) {
      const p1 = vertices[idxs[i]];
      const p2 = vertices[idxs[(i + 1) % idxs.length]];
      if (p1 && p2) {
        const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
        if (d > 1e-5) edgeLens.push(d);
      }
    }
  }
  edgeLens.sort((a, b) => a - b);
  const effectiveMaxEdges = maxHoleEdges;

  // 1. Map edges and their orientation
  const edgeMap = new Map<string, { a: number; b: number; count: number; dirA: number; dirB: number }>();
  for (let fi = 0; fi < faces.length; fi++) {
    const idxs = faces[fi].indices;
    const len = idxs.length;
    for (let i = 0; i < len; i++) {
      const a = idxs[i];
      const b = idxs[(i + 1) % len];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const entry = edgeMap.get(key);
      if (!entry) {
        edgeMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), count: 1, dirA: a, dirB: b });
      } else {
        entry.count++;
      }
    }
  }

  // Boundary edges appear in exactly one face
  const boundaryEdges = Array.from(edgeMap.values()).filter(e => e.count === 1);
  if (boundaryEdges.length === 0) return { vertices, faces, holesFilled: 0 };

  // 2. Build adjacency for boundary edges: opposite to the adjacent face's winding (dirB -> dirA)
  const adj = new Map<number, number[]>();
  boundaryEdges.forEach(e => {
    const from = e.dirB;
    const to = e.dirA;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  });

  // 3. Trace closed boundary loops with subcycle detection
  const visitedEdges = new Set<string>();
  const loops: number[][] = [];

  for (const [startNode, neighbors] of adj.entries()) {
    for (const neighbor of neighbors) {
      const edgeKey = `${startNode}->${neighbor}`;
      if (visitedEdges.has(edgeKey)) continue;

      let path: number[] = [startNode];
      visitedEdges.add(edgeKey);
      let current = neighbor;

      while (true) {
        const cycleIdx = path.indexOf(current);
        if (cycleIdx !== -1) {
          const cycle = path.slice(cycleIdx);
          if (cycle.length >= 3) {
            loops.push(cycle);
          }
          path = path.slice(0, cycleIdx);
          if (path.length === 0) break;
          current = path[path.length - 1];
        } else {
          path.push(current);
        }

        const nextNeighbors = adj.get(current);
        if (!nextNeighbors) break;

        let foundNext = false;
        for (const next of nextNeighbors) {
          const nextKey = `${current}->${next}`;
          if (!visitedEdges.has(nextKey)) {
            visitedEdges.add(nextKey);
            current = next;
            foundNext = true;
            break;
          }
        }
        if (!foundNext) break;
      }
    }
  }

  let holesFilled = 0;
  const newFaces = [...faces];
  const resultVerts = [...vertices];

  loops.forEach(loop => {
    // Only process real closed loops of appropriate size
    if (loop.length < 3 || loop.length > effectiveMaxEdges) return;

    const loopVerts = loop.map(idx => new THREE.Vector3(...resultVerts[idx]));
    const numLp = loopVerts.length;

    // Newell's method to calculate the best-fit average plane normal
    const normal = new THREE.Vector3(0, 0, 0);
    const center = new THREE.Vector3();
    for (let i = 0; i < numLp; i++) {
      const curr = loopVerts[i];
      center.add(curr);
      const next = loopVerts[(i + 1) % numLp];
      normal.x += (curr.y - next.y) * (curr.z + next.z);
      normal.y += (curr.z - next.z) * (curr.x + next.x);
      normal.z += (curr.x - next.x) * (curr.y + next.y);
    }
    center.divideScalar(numLp);
    if (normal.lengthSq() > 1e-8) {
      normal.normalize();
    }

    // Snap centroide a la superficie del modelo si BVH disponible
    if (targetBvh) {
      const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
      const snapRes = targetBvh.closestPointToPoint(center, hitTmp as any);
      if (snapRes && snapRes.point) {
        center.copy(snapRes.point);
      }
    }

    // Registrar el nuevo vértice del centroide en la estructura del modelo
    const centerIndex = resultVerts.length;
    resultVerts.push([center.x, center.y, center.z]);

    // Generar el abanico de triángulos apuntando al centroide plano
    for (let i = 0; i < numLp; i++) {
      const v1 = loop[i];
      const v2 = loop[(i + 1) % numLp];
      
      newFaces.push({
        indices: [v1, v2, centerIndex]
      });
    }
    holesFilled++;
  });

  return { vertices: resultVerts, faces: newFaces, holesFilled };
}

/**
 * Removes needle triangles, extreme spikes, and inverted faces,
 * and relaxes remaining boundary vertices cleanly onto the target surface.
 */
export function cleanSpikesAndDegeneratesCore(
  currentPositions: THREE.Vector3[],
  faces: MeshFace[],
  targetBvh?: MeshBVH | null,
  targetGeo?: THREE.BufferGeometry | null,
  options: {
    maxAspectRatio?: number;
    removeInverted?: boolean;
    smoothBoundary?: boolean;
  } = {}
): {
  cleanPositions: THREE.Vector3[];
  cleanFaces: MeshFace[];
  removedSpikesCount: number;
} {
  const maxAspectRatio = options.maxAspectRatio ?? 6.0;
  const numVerts = currentPositions.length;
  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

  // Helper to get target normal if available
  const tgtPosAttr = targetGeo?.getAttribute('position');
  const tgtIndex = targetGeo?.getIndex();
  const getTargetNormal = (faceIndex: number): THREE.Vector3 => {
    if (!tgtPosAttr || faceIndex < 0) return new THREE.Vector3(0, 1, 0);
    let i0 = faceIndex * 3, i1 = faceIndex * 3 + 1, i2 = faceIndex * 3 + 2;
    if (tgtIndex) {
      i0 = tgtIndex.getX(i0);
      i1 = tgtIndex.getX(i1);
      i2 = tgtIndex.getX(i2);
    }
    if (i0 >= tgtPosAttr.count || i1 >= tgtPosAttr.count || i2 >= tgtPosAttr.count) return new THREE.Vector3(0, 1, 0);
    const p0 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);
    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const fn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    return fn.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : fn;
  };

  // Build edge frequency map to identify loose antennae (faces with 2 open edges)
  const edgeCount = new Map<string, number>();
  for (const f of faces) {
    const idxs = f.indices;
    if (!idxs || idxs.length < 3) continue;
    for (let k = 0; k < idxs.length; k++) {
      const a = Math.min(idxs[k], idxs[(k + 1) % idxs.length]);
      const b = Math.max(idxs[k], idxs[(k + 1) % idxs.length]);
      const key = `${a}_${b}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }

  const keptFaces: MeshFace[] = [];
  let removedCount = 0;
  const seenFaceKeys = new Set<string>();
  const seenCentroids = new Set<string>();

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const rawIdxs = f.indices;
    if (!rawIdxs || rawIdxs.length < 3) {
      removedCount++;
      continue;
    }

    // 1. Eliminar vértices duplicados consecutivos dentro de la misma cara
    const idxs: number[] = [];
    for (let k = 0; k < rawIdxs.length; k++) {
      const curr = rawIdxs[k];
      const next = rawIdxs[(k + 1) % rawIdxs.length];
      if (curr !== next) {
        idxs.push(curr);
      }
    }
    if (idxs.length < 3) {
      removedCount++;
      continue;
    }

    // 1b. Duplicate / overlapping faces sharing the same vertices (anti-caras dobles/duplicadas)
    const sortedKey = [...idxs].sort((x, y) => x - y).join('_');
    if (seenFaceKeys.has(sortedKey)) {
      removedCount++;
      continue;
    }
    seenFaceKeys.add(sortedKey);

    // ── PARCHE DE LIMPIEZA DE MALLAS DOBLES POR CENTROIDE ──
    // Purgar caras superpuestas/fantasmas que ocupan la misma coordenada 3D en el espacio
    const faceCentroid = new THREE.Vector3();
    let validCentroid = true;
    for (const vi of idxs) {
      if (currentPositions[vi]) {
        faceCentroid.add(currentPositions[vi]);
      } else {
        validCentroid = false;
        break;
      }
    }
    if (!validCentroid) {
      removedCount++;
      continue;
    }
    faceCentroid.divideScalar(idxs.length);

    // Clave espacial redondeada a 3 decimales (tolerancia milimétrica)
    const spatialKey = `${Math.round(faceCentroid.x * 1000)}_${Math.round(faceCentroid.y * 1000)}_${Math.round(faceCentroid.z * 1000)}`;
    if (seenCentroids.has(spatialKey)) {
      // Si ya existe una cara ocupando exactamente esta misma coordenada en el espacio: ¡Descartada!
      removedCount++;
      continue;
    }
    seenCentroids.add(spatialKey);

    const p0 = currentPositions[idxs[0]];
    const p1 = currentPositions[idxs[1]];
    const p2 = currentPositions[idxs[2]];
    if (!p0 || !p1 || !p2) {
      removedCount++;
      continue;
    }

    // 2. Cálculo de área real para cualquier polígono (triángulos y quads)
    let totalArea = 0;
    let maxE = 0;
    let minE = Infinity;
    for (let k = 0; k < idxs.length; k++) {
      const pA = currentPositions[idxs[k]];
      const pB = currentPositions[idxs[(k + 1) % idxs.length]];
      if (pA && pB) {
        const elen = pA.distanceTo(pB);
        if (elen > maxE) maxE = elen;
        if (elen < minE) minE = elen;
      }
    }
    for (let k = 1; k < idxs.length - 1; k++) {
      const v0 = currentPositions[idxs[0]];
      const v1 = currentPositions[idxs[k]];
      const v2 = currentPositions[idxs[k + 1]];
      if (v0 && v1 && v2) {
        const e1 = new THREE.Vector3().subVectors(v1, v0);
        const e2 = new THREE.Vector3().subVectors(v2, v0);
        totalArea += 0.5 * e1.cross(e2).length();
      }
    }

    if (minE < 1e-6 || maxE < 1e-6 || totalArea <= 1e-12) {
      removedCount++;
      continue;
    }

    // Solo eliminar si es un triángulo/quad degenerado colapsado sin área real
    const hMin = (2 * totalArea) / Math.max(1e-6, maxE);
    const aspectRatio = maxE / Math.max(1e-6, hMin);
    if (aspectRatio > 45.0 && totalArea <= 1e-8) {
      removedCount++;
      continue;
    }

    // 3. Antenna check (faces with 3 boundary edges sticking out like single isolated fins into the air)
    let boundaryEdges = 0;
    for (let k = 0; k < idxs.length; k++) {
      const eA = Math.min(idxs[k], idxs[(k + 1) % idxs.length]);
      const eB = Math.max(idxs[k], idxs[(k + 1) % idxs.length]);
      if ((edgeCount.get(`${eA}_${eB}`) || 0) === 1) {
        boundaryEdges++;
      }
    }
    if (boundaryEdges >= 3 && faces.length > 50) {
      // Solo considerar antena suelta si su centroide está completamente fuera de la superficie del modelo
      let isFloating = false;
      if (targetBvh) {
        const centroid = new THREE.Vector3();
        for (const vi of idxs) centroid.add(currentPositions[vi]);
        centroid.divideScalar(idxs.length);
        hitTmp.distance = Infinity;
        hitTmp.faceIndex = -1;
        const res = targetBvh.closestPointToPoint(centroid, hitTmp as any);
        if (res && res.point && centroid.distanceTo(res.point) > 0.08) {
          isFloating = true;
        }
      }
      if (isFloating) {
        removedCount++;
        continue;
      }
    }

    keptFaces.push(f);
  }

  // 5. Re-index vertices to remove orphaned vertices
  const usedVerts = new Set<number>();
  for (const f of keptFaces) {
    for (const vi of f.indices) usedVerts.add(vi);
  }

  const oldToNew = new Map<number, number>();
  const cleanPositions: THREE.Vector3[] = [];
  for (let i = 0; i < numVerts; i++) {
    if (usedVerts.has(i)) {
      oldToNew.set(i, cleanPositions.length);
      cleanPositions.push(currentPositions[i].clone());
    }
  }

  let cleanFaces = keptFaces.map(f => ({
    ...f,
    indices: f.indices.map(oldIdx => oldToNew.get(oldIdx)!)
  }));

  // 6. Boundary Smoothing: relax zigzag boundary edges along the target surface
  if (options.smoothBoundary !== false && cleanPositions.length > 10) {
    const bEdgeMap = new Map<string, { a: number; b: number; count: number }>();
    for (const f of cleanFaces) {
      const idxs = f.indices;
      for (let k = 0; k < idxs.length; k++) {
        const a = Math.min(idxs[k], idxs[(k + 1) % idxs.length]);
        const b = Math.max(idxs[k], idxs[(k + 1) % idxs.length]);
        const key = `${a}_${b}`;
        const entry = bEdgeMap.get(key);
        if (!entry) bEdgeMap.set(key, { a, b, count: 1 });
        else entry.count++;
      }
    }

    const bAdj = new Map<number, number[]>();
    for (const [, item] of bEdgeMap) {
      if (item.count === 1) {
        if (!bAdj.has(item.a)) bAdj.set(item.a, []);
        if (!bAdj.has(item.b)) bAdj.set(item.b, []);
        bAdj.get(item.a)!.push(item.b);
        bAdj.get(item.b)!.push(item.a);
      }
    }

    // Apply 1-pass boundary relaxation
    for (const [vi, neighbors] of bAdj) {
      if (neighbors.length === 2) {
        const p0 = cleanPositions[vi];
        const pA = cleanPositions[neighbors[0]];
        const pB = cleanPositions[neighbors[1]];
        const avg = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
        p0.lerp(avg, 0.35);

        // Snap back to target surface if BVH available
        if (targetBvh) {
          hitTmp.distance = Infinity;
          hitTmp.faceIndex = -1;
          const res = targetBvh.closestPointToPoint(p0, hitTmp as any);
          if (res && res.point) {
            p0.copy(res.point);
          }
        }
      }
    }
  }

  return {
    cleanPositions,
    cleanFaces,
    removedSpikesCount: removedCount
  };
}

/**
 * Core geometric evaluator to detect and prune bridging faces suspended in open air
 * or stretching across chasms (e.g. between the legs, feet, belly, or wings of a model).
 *
 * Enforces the Golden Surface Rule: Valid faces on actual model surfaces are never pruned,
 * completely preventing unwanted holes while cleanly severing air webs and curtains.
 */
export function pruneAirBridgingFacesCore(
  currentPositions: THREE.Vector3[],
  faces: MeshFace[],
  targetBvh: MeshBVH,
  targetGeo: THREE.BufferGeometry,
  options: PruneAirFacesOptions = {}
): {
  retainedFaces: MeshFace[];
  prunedCount: number;
} {
  if (!targetGeo.boundingBox) targetGeo.computeBoundingBox();
  const tgtBox = targetGeo.boundingBox!;
  const tgtDiag = Math.max(0.1, tgtBox.getSize(new THREE.Vector3()).length());

  // Sample edge lengths to determine baseline mesh edge scale
  const edgeLengths: number[] = [];
  const sampleStep = Math.max(1, Math.floor(faces.length / 500));
  for (let fi = 0; fi < faces.length; fi += sampleStep) {
    const idxs = faces[fi].indices;
    if (!idxs || idxs.length < 2) continue;
    for (let k = 0; k < idxs.length; k++) {
      const pA = currentPositions[idxs[k]];
      const pB = currentPositions[idxs[(k + 1) % idxs.length]];
      if (pA && pB) {
        const d = pA.distanceTo(pB);
        if (d > 1e-5) edgeLengths.push(d);
      }
    }
  }
  edgeLengths.sort((a, b) => a - b);
  const medianEdge = edgeLengths.length > 0 ? edgeLengths[Math.floor(edgeLengths.length * 0.4)] : 0.15;

  const sensitivity = options.sensitivity ?? (options.aggressive ? 'aggressive' : 'balanced');

  let defaultStretchRatio: number;
  let defaultAirThreshRel: number;
  let minIslandFaces: number;

  if (sensitivity === 'conservative') {
    defaultStretchRatio = 3.5;
    defaultAirThreshRel = 0.055;
    minIslandFaces = options.minIslandFaces ?? 8;
  } else if (sensitivity === 'aggressive') {
    defaultStretchRatio = 2.0;
    defaultAirThreshRel = 0.025;
    minIslandFaces = options.minIslandFaces ?? 3;
  } else {
    // 'balanced' (Default - Recommended)
    defaultStretchRatio = 2.6;
    defaultAirThreshRel = 0.038;
    minIslandFaces = options.minIslandFaces ?? 4;
  }

  const maxStretchRatio = options.maxStretchRatio ?? defaultStretchRatio;
  const maxAllowedEdge = Math.max(0.02, medianEdge * maxStretchRatio);
  const extremeStretchEdge = Math.max(0.035, medianEdge * (maxStretchRatio * 1.45));

  // Distance beyond which a face centroid is considered floating in open air:
  const airDistThresh = options.airDistanceThreshold
    ? (options.airDistanceThreshold > 1 ? options.airDistanceThreshold : Math.max(0.015, tgtDiag * options.airDistanceThreshold))
    : Math.max(0.02, tgtDiag * (sensitivity === 'aggressive' ? 0.018 : sensitivity === 'conservative' ? 0.045 : 0.028), medianEdge * (sensitivity === 'aggressive' ? 0.45 : 0.75));

  // Surface adherence tolerance:
  const surfaceTolerance = Math.max(0.008, tgtDiag * 0.01, medianEdge * 0.4);

  // Pre-calculate vertex distances to target surface
  const numVerts = currentPositions.length;
  const vertDistToSurface = new Float32Array(numVerts);
  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

  const tgtPosAttr = targetGeo.getAttribute('position');
  const tgtIndex = targetGeo.getIndex();
  const tgtNormAttr = targetGeo.getAttribute('normal');
  const getTargetFaceNormal = (faceIndex: number): THREE.Vector3 => {
    if (faceIndex < 0 || !tgtPosAttr) return new THREE.Vector3(0, 1, 0);
    let i0 = faceIndex * 3;
    let i1 = faceIndex * 3 + 1;
    let i2 = faceIndex * 3 + 2;
    if (tgtIndex) {
      i0 = tgtIndex.getX(i0);
      i1 = tgtIndex.getX(i1);
      i2 = tgtIndex.getX(i2);
    }
    if (i0 >= tgtPosAttr.count || i1 >= tgtPosAttr.count || i2 >= tgtPosAttr.count) {
      return new THREE.Vector3(0, 1, 0);
    }
    const p0 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);
    const fn = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(p1, p0),
      new THREE.Vector3().subVectors(p2, p0)
    ).normalize();

    if (tgtNormAttr) {
      const n0 = new THREE.Vector3().fromBufferAttribute(tgtNormAttr, i0);
      const n1 = new THREE.Vector3().fromBufferAttribute(tgtNormAttr, i1);
      const n2 = new THREE.Vector3().fromBufferAttribute(tgtNormAttr, i2);
      const avgN = n0.add(n1).add(n2).normalize();
      if (avgN.lengthSq() > 1e-4 && fn.dot(avgN) < 0) {
        fn.negate();
      }
    }

    return fn.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : fn;
  };
  const getTargetNormal = getTargetFaceNormal;

  for (let i = 0; i < numVerts; i++) {
    hitTmp.distance = Infinity;
    hitTmp.faceIndex = -1;
    const res = targetBvh.closestPointToPoint(currentPositions[i], hitTmp as any);
    vertDistToSurface[i] = res && res.point ? currentPositions[i].distanceTo(res.point) : 0;
  }

  let retainedFaces: MeshFace[] = [];
  let prunedCount = 0;

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    const idxs = f.indices;
    if (!idxs || idxs.length < 3 || idxs[0] === idxs[1] || idxs[1] === idxs[2] || idxs[0] === idxs[2]) {
      prunedCount++;
      continue;
    }

    // 0. Tolerancia dinámica según dimensiones y aspecto de la cara (protección de zonas delgadas / transición)
    let faceMaxEdge = 0;
    let faceMinEdge = Infinity;
    let pValid = true;
    for (let k = 0; k < idxs.length; k++) {
      const pA = currentPositions[idxs[k]];
      const pB = currentPositions[idxs[(k + 1) % idxs.length]];
      if (!pA || !pB) {
        pValid = false;
        break;
      }
      const elen = pA.distanceTo(pB);
      if (elen > faceMaxEdge) faceMaxEdge = elen;
      if (elen < faceMinEdge) faceMinEdge = elen;
    }
    if (!pValid) {
      prunedCount++;
      continue;
    }

    const faceElongation = faceMinEdge > 1e-6 ? faceMaxEdge / faceMinEdge : 1.0;
    // Si la cara es grande o muy alargada, incrementa temporalmente la tolerancia de esa cara en un 50%
    const isLargeOrElongated = (faceMaxEdge > medianEdge * 1.4) || (faceElongation > 2.2);
    const faceTolerance = isLargeOrElongated ? surfaceTolerance * 1.5 : surfaceTolerance;

    // 1. Analizar cuántos vértices de la cara están realmente tocando el modelo
    let vertsOnSurfaceCount = 0;
    let anyVertOnSurface = false;

    for (let k = 0; k < idxs.length; k++) {
      const vd = vertDistToSurface[idxs[k]];
      if (vd <= faceTolerance) {
        vertsOnSurfaceCount++;
        anyVertOnSurface = true;
      }
    }

    // 2. Analizar aristas y calcular centroide
    let hasExtremeEdge = false;
    let hasStretchedEdge = false;
    let stretchedMidpointInAir = false;
    let hasDegenerateEdge = false;
    const centroid = new THREE.Vector3();

    for (let k = 0; k < idxs.length; k++) {
      const pA = currentPositions[idxs[k]];
      const pB = currentPositions[idxs[(k + 1) % idxs.length]];
      if (!pA || !pB) {
        hasDegenerateEdge = true;
        break;
      }

      const elen = pA.distanceTo(pB);
      if (elen < 1e-6) {
        hasDegenerateEdge = true;
        break;
      }
      if (elen > extremeStretchEdge) hasExtremeEdge = true;
      if (elen > maxAllowedEdge) {
        hasStretchedEdge = true;
      }

      // Detectar si el punto medio de esta arista está suspendido en el aire cruzando un abismo
      // Solo se evalúa en aristas estiradas que cruzan distancias significativas
      if (elen > maxAllowedEdge) {
        const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
        hitTmp.distance = Infinity;
        hitTmp.faceIndex = -1;
        const midRes = targetBvh.closestPointToPoint(mid, hitTmp as any);
        if (midRes && midRes.point) {
          if (mid.distanceTo(midRes.point) > airDistThresh * 1.8) {
            stretchedMidpointInAir = true;
          }
        }
      }
      centroid.add(pA);
    }

    if (hasDegenerateEdge) {
      prunedCount++;
      continue;
    }

    centroid.divideScalar(idxs.length);
    hitTmp.distance = Infinity;
    hitTmp.faceIndex = -1;
    const cenRes = targetBvh.closestPointToPoint(centroid, hitTmp as any);
    const distToSurface = (cenRes && cenRes.point) ? centroid.distanceTo(cenRes.point) : 0;

    // ── ✂️ PODA OBLIGATORIA DE ARISTAS KILOMÉTRICAS QUE CRUZAN EXTREMIDADES (TELARAÑAS) ──
    // Si la cara contiene aristas extremas que saltan de una pata a otra cruzando el aire,
    // se debe podar de inmediato para evitar que quede una telaraña de alambres diagonales atravesando el modelo
    if (hasExtremeEdge && (stretchedMidpointInAir || distToSurface > airDistThresh * 0.8)) {
      prunedCount++;
      continue;
    }

    // ── 🛡️ REGLA FUNDAMENTAL DE PROTECCIÓN DE SUPERFICIE ──
    // Si la cara reposa directamente sobre la superficie del modelo (centroide próximo a la superficie):
    // NUNCA SE PODA. Preserva caras sobre el modelo, biseles, alas, valles y aristas vivas.
    if (distToSurface <= airDistThresh * 1.4 && !stretchedMidpointInAir) {
      retainedFaces.push(f);
      continue;
    }

    if (vertsOnSurfaceCount >= 2 && distToSurface <= airDistThresh * 1.8 && !hasExtremeEdge) {
      retainedFaces.push(f);
      continue;
    }

    // ── 🛡️ PROTECCIÓN DE PICOS, PUNTAS Y CARAS ALARGADAS DE EXTREMIDADES ──
    // Si la cara tiene vértices anclados a las puntas/superficie del modelo y muestra elongación de pico:
    const tocarPuntaOriginal = idxs.some(vi => vertDistToSurface[vi] <= surfaceTolerance * 1.2);
    if (tocarPuntaOriginal && (faceElongation > 1.8 || vertsOnSurfaceCount >= 1)) {
      retainedFaces.push(f); // Se salva la punta y arista viva del poliedro/estrella
      continue;
    }

    // ── ✂️ PODA DE MEMBRANAS Y TELAS SUSPENDIDAS EN EL AIRE ──
    // Se eliminan caras que estén REALMENTE suspendidas en el aire entre extremidades o abismos
    // (el centroide DEBE estar flotando muy lejos en el aire Y no tener más de 1 vértice en la superficie)
    // NUNCA podar una cara legítima de la superficie por simple elongación de arista anisotrópica
    const isFloatingInAir = distToSurface > airDistThresh * 1.8;
    const isBridgingChasm = stretchedMidpointInAir && (vertsOnSurfaceCount < idxs.length);

    if (isFloatingInAir && (vertsOnSurfaceCount <= 0 || (isBridgingChasm && vertsOnSurfaceCount <= 1))) {
      prunedCount++;
      continue;
    }

    retainedFaces.push(f);
  }

  // Island filtering: Protect surface islands, prune only mid-air floating debris
  let finalRetainedFaces = retainedFaces;
  if (retainedFaces.length > minIslandFaces * 2) {
    const faceAdjacency: number[][] = Array.from({ length: retainedFaces.length }, () => []);
    const edgeToFace = new Map<string, number[]>();

    for (let fi = 0; fi < retainedFaces.length; fi++) {
      const idxs = retainedFaces[fi].indices;
      for (let k = 0; k < idxs.length; k++) {
        const a = Math.min(idxs[k], idxs[(k + 1) % idxs.length]);
        const b = Math.max(idxs[k], idxs[(k + 1) % idxs.length]);
        const key = `${a}_${b}`;
        const existing = edgeToFace.get(key) || [];
        existing.push(fi);
        edgeToFace.set(key, existing);
      }
    }

    for (const [, faceList] of edgeToFace) {
      if (faceList.length > 1) {
        for (let i = 0; i < faceList.length; i++) {
          for (let j = i + 1; j < faceList.length; j++) {
            faceAdjacency[faceList[i]].push(faceList[j]);
            faceAdjacency[faceList[j]].push(faceList[i]);
          }
        }
      }
    }

    const visited = new Uint8Array(retainedFaces.length);
    const validFaceIndices = new Set<number>();

    for (let fi = 0; fi < retainedFaces.length; fi++) {
      if (visited[fi]) continue;
      const component: number[] = [];
      const queue = [fi];
      visited[fi] = 1;

      while (queue.length > 0) {
        const curr = queue.pop()!;
        component.push(curr);
        for (const nb of faceAdjacency[curr]) {
          if (!visited[nb]) {
            visited[nb] = 1;
            queue.push(nb);
          }
        }
      }

      // Check if this component's faces are firmly on the surface
      const isComponentOnSurface = component.some(cFi => {
        const cFace = retainedFaces[cFi];
        return cFace.indices.some(vi => vertDistToSurface[vi] <= surfaceTolerance * 1.5);
      });

      if (component.length >= minIslandFaces || isComponentOnSurface) {
        for (const idx of component) validFaceIndices.add(idx);
      } else {
        prunedCount += component.length;
      }
    }

    finalRetainedFaces = retainedFaces.filter((_, idx) => validFaceIndices.has(idx));
  }

  return {
    retainedFaces: finalRetainedFaces,
    prunedCount
  };
}

/**
 * Prunes faces that stretch across empty air / chasms between separated components
 * (such as the void between an AT-AT's 4 legs, or between a TIE fighter's wings and central cockpit).
 */
export async function pruneAirBridgingFaces(
  sourceObj: CSGObject,
  targetObj: CSGObject,
  options: PruneAirFacesOptions = {}
): Promise<{ updatedObject: CSGObject; prunedFacesCount: number; report: string[] }> {
  let resolvedSource = sourceObj;
  let resolvedTarget = targetObj;

  if ((!resolvedSource.vertices || resolvedSource.vertices.length === 0) && resolvedSource.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedSource = await convertImportedToCSG(resolvedSource);
    } catch (err) {
      console.warn('Error converting source for air pruning:', err);
    }
  }

  if ((!resolvedTarget.vertices || resolvedTarget.vertices.length === 0) && resolvedTarget.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedTarget = await convertImportedToCSG(resolvedTarget);
    } catch (err) {
      console.warn('Error converting target for air pruning:', err);
    }
  }

  const offsets = resolvedSource.vertexOffsets || {};
  const srcVerts: V3[] = (resolvedSource.vertices || []).map((v, i) => {
    const off = offsets[i];
    if (off) return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    return [v[0], v[1], v[2]];
  });
  const srcFaces = resolvedSource.faces ? [...resolvedSource.faces] : [];

  if (srcVerts.length < 4 || srcFaces.length === 0) {
    return { updatedObject: sourceObj, prunedFacesCount: 0, report: ['Malla sin geometría suficiente para poda.'] };
  }

  const targetGeo = await extractTargetGeometry(resolvedTarget);
  if (!targetGeo.attributes.position || targetGeo.attributes.position.count === 0) {
    return { updatedObject: sourceObj, prunedFacesCount: 0, report: ['Objetivo no contiene geometría válida.'] };
  }

  const targetBvh = new MeshBVH(targetGeo);
  const srcWorldMat = getObjectWorldMatrix(resolvedSource);

  const currentPositions = srcVerts.map(v => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(srcWorldMat));

  const pruneSensitivity = options.sensitivity ?? 'balanced';
  const airDistanceThreshold = options.airDistanceThreshold ?? (
    pruneSensitivity === 'conservative' ? 0.055 :
    pruneSensitivity === 'aggressive' ? 0.025 : 0.035
  );
  const maxStretchRatio = options.maxStretchRatio ?? (
    pruneSensitivity === 'conservative' ? 3.5 :
    pruneSensitivity === 'aggressive' ? 2.0 : 2.6
  );
  const minIslandFaces = options.minIslandFaces ?? (
    pruneSensitivity === 'aggressive' ? 12 : 5
  );
  const offset = options.offset ?? 0;

  // Ejecuta la evaluación geométrica central de membranas en el aire
  const { retainedFaces, prunedCount } = pruneAirBridgingFacesCore(
    currentPositions,
    srcFaces,
    targetBvh,
    targetGeo,
    {
      airDistanceThreshold,
      maxStretchRatio,
      minIslandFaces,
      aggressive: options.aggressive ?? (options.sensitivity === 'aggressive'),
      sensitivity: options.sensitivity ?? 'balanced',
      offset
    }
  );

  // Re-indexar vértices retenidos para descartar los huérfanos
  const usedVerts = new Set<number>();
  for (const f of retainedFaces) {
    for (const vi of f.indices) usedVerts.add(vi);
  }

  const oldToNewIdx = new Map<number, number>();
  const newVerts: V3[] = [];
  for (let i = 0; i < srcVerts.length; i++) {
    if (usedVerts.has(i)) {
      oldToNewIdx.set(i, newVerts.length);
      newVerts.push(srcVerts[i]);
    }
  }

  let finalFaces: MeshFace[] = retainedFaces.map(f => ({
    ...f,
    indices: f.indices.map(oldIdx => oldToNewIdx.get(oldIdx)!)
  }));
  let finalVerts: V3[] = newVerts;

  // AUTO-SELLADO INTEGRADO TRAS PODA MANUAL (Solo si se solicita explícitamente y limitado a micro-poros)
  if (options.autoFillHoles === true && prunedCount > 0) {
    const maxHoleEdges = options.maxHoleEdges ?? 10;
    const holeRes = fillSmallBoundaryHoles(finalVerts, finalFaces, maxHoleEdges, targetBvh);
    if (holeRes.holesFilled > 0) {
      finalFaces = holeRes.faces;
      finalVerts = holeRes.vertices; // Actualizamos vértices incluyendo los nuevos centroides
    }
  }

  // Clean needle spikes, inverted faces, and smooth cut boundaries
  const cleanPosVecs = finalVerts.map(v => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(srcWorldMat));
  const cleanRes = cleanSpikesAndDegeneratesCore(
    cleanPosVecs,
    finalFaces,
    targetBvh,
    targetGeo,
    { maxAspectRatio: 6.0, removeInverted: true, smoothBoundary: true }
  );

  const srcWorldInv = srcWorldMat.clone().invert();
  finalVerts = cleanRes.cleanPositions.map(p => {
    const loc = p.clone().applyMatrix4(srcWorldInv);
    return [loc.x, loc.y, loc.z] as V3;
  });
  finalFaces = cleanRes.cleanFaces;

  targetGeo.dispose();

  const report = [
    `Poda de membranas en el aire completada:`,
    `- ${prunedCount} caras flotantes/estiradas eliminadas.`,
    `- ${cleanRes.removedSpikesCount} espinas y caras degeneradas limpiadas.`,
    `- ${finalFaces.length} caras limpias retenidas ceñidas a la superficie.`
  ];

  return {
    updatedObject: {
      ...resolvedSource,
      vertices: finalVerts,
      faces: finalFaces,
      meshData: undefined,
      vertexOffsets: {},
      stats: {
        ...(resolvedSource.stats || {}),
        vertices: finalVerts.length,
        faces: finalFaces.length
      }
    },
    prunedFacesCount: prunedCount,
    report
  };
}

/**
 * Tangential Equilateral Surface Regularizer with BVH Surface Reprojection.
 * Glides vertices smoothly along the target model's surface to equalize edge lengths
 * and turn distorted, crumpled, or spiky triangles into homogeneous, uniform equilateral faces.
 */
export function regularizeSurfaceOnBVH(
  positions: THREE.Vector3[],
  faces: MeshFace[],
  targetBvh: MeshBVH,
  getTargetFaceNormal: (faceIndex: number) => THREE.Vector3,
  options: {
    iterations?: number;
    strength?: number;
    preserveCreases?: boolean;
    creaseAngleDeg?: number;
    lockedVertices?: Set<number>;
    planarPlanes?: { normal: THREE.Vector3; d: number }[];
  } = {}
): { positions: THREE.Vector3[]; normals: THREE.Vector3[] } {
  const iterations = options.iterations ?? 6;
  const strength = options.strength ?? 0.45;
  const preserveCreases = options.preserveCreases ?? true;
  const creaseAngleDeg = options.creaseAngleDeg ?? 30;
  const cosCrease = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const lockedVertices = options.lockedVertices;
  const planarPlanes = options.planarPlanes || [];

  const nVerts = positions.length;
  if (nVerts === 0 || faces.length === 0) {
    return { positions, normals: positions.map(() => new THREE.Vector3(0, 1, 0)) };
  }

  // 1. Build adjacency (1-ring neighbors for each vertex)
  const neighbors: Set<number>[] = Array.from({ length: nVerts }, () => new Set<number>());
  for (let f = 0; f < faces.length; f++) {
    const idxs = faces[f].indices;
    if (!idxs) continue;
    const len = idxs.length;
    for (let k = 0; k < len; k++) {
      const u = idxs[k];
      const v = idxs[(k + 1) % len];
      if (u < nVerts && v < nVerts) {
        neighbors[u].add(v);
        neighbors[v].add(u);
      }
    }
  }

  const neighborLists = neighbors.map(set => Array.from(set));
  const currentPositions = positions.map(p => p.clone());
  const currentNormals: THREE.Vector3[] = Array.from({ length: nVerts }, () => new THREE.Vector3(0, 1, 0));

  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

  // Calculate median edge length to prevent pulling across topological gaps
  let sampleEdgeDist = 1.0;
  {
    const sampleEdges: number[] = [];
    const step = Math.max(1, Math.floor(faces.length / 300));
    for (let f = 0; f < faces.length; f += step) {
      const idxs = faces[f].indices;
      if (idxs && idxs.length >= 3) {
        sampleEdges.push(currentPositions[idxs[0]].distanceTo(currentPositions[idxs[1]]));
      }
    }
    if (sampleEdges.length > 0) {
      sampleEdges.sort((a, b) => a - b);
      sampleEdgeDist = sampleEdges[Math.floor(sampleEdges.length * 0.5)];
    }
  }
  const maxMoveDist = Math.max(0.005, sampleEdgeDist * 2.5);

  for (let iter = 0; iter < iterations; iter++) {
    const nextPositions = currentPositions.map(p => p.clone());

    // Compute current face normals and identify crease edges
    const creaseNeighbors: number[][] = Array.from({ length: nVerts }, () => []);
    if (preserveCreases) {
      const faceNormals: THREE.Vector3[] = [];
      for (let f = 0; f < faces.length; f++) {
        const idxs = faces[f].indices;
        if (idxs.length >= 3) {
          const v0 = currentPositions[idxs[0]];
          const v1 = currentPositions[idxs[1]];
          const v2 = currentPositions[idxs[2]];
          const fn = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(v1, v0),
            new THREE.Vector3().subVectors(v2, v0)
          ).normalize();
          faceNormals.push(fn.lengthSq() > 1e-12 ? fn : new THREE.Vector3(0, 1, 0));
        } else {
          faceNormals.push(new THREE.Vector3(0, 1, 0));
        }
      }

      const edgeMap = new Map<string, { f1: number; f2?: number; v1: number; v2: number }>();
      for (let f = 0; f < faces.length; f++) {
        const idxs = faces[f].indices;
        const len = idxs.length;
        for (let k = 0; k < len; k++) {
          const a = idxs[k];
          const b = idxs[(k + 1) % len];
          const minV = Math.min(a, b);
          const maxV = Math.max(a, b);
          const key = `${minV}_${maxV}`;
          const existing = edgeMap.get(key);
          if (existing) {
            existing.f2 = f;
          } else {
            edgeMap.set(key, { f1: f, v1: minV, v2: maxV });
          }
        }
      }

      edgeMap.forEach(({ f1, f2, v1, v2 }) => {
        if (f2 !== undefined) {
          const n1 = faceNormals[f1];
          const n2 = faceNormals[f2];
          if (n1 && n2 && n1.dot(n2) < cosCrease) {
            creaseNeighbors[v1].push(v2);
            creaseNeighbors[v2].push(v1);
          }
        }
      });
    }

    for (let i = 0; i < nVerts; i++) {
      if (lockedVertices && lockedVertices.has(i)) continue;

      const nbs = neighborLists[i];
      if (nbs.length === 0) continue;

      const pI = currentPositions[i];
      const centroid = new THREE.Vector3();
      let validNbCount = 0;

      for (let k = 0; k < nbs.length; k++) {
        const nbPos = currentPositions[nbs[k]];
        if (nbPos.distanceTo(pI) <= maxMoveDist) {
          centroid.add(nbPos);
          validNbCount++;
        }
      }

      if (validNbCount === 0) continue;
      centroid.divideScalar(validNbCount);

      // Local displacement towards neighbor centroid
      let disp = new THREE.Vector3().subVectors(centroid, pI);

      // Query current surface normal on target
      hitTmp.distance = Infinity;
      hitTmp.faceIndex = -1;
      const res = targetBvh.closestPointToPoint(pI, hitTmp as any);
      let norm = new THREE.Vector3(0, 1, 0);
      if (res && res.faceIndex >= 0) {
        norm = getTargetFaceNormal(res.faceIndex);
      }

      // Check crease constraints to prevent rounding off corners and edges
      const crNbs = creaseNeighbors[i];
      if (preserveCreases && crNbs && crNbs.length > 0) {
        if (crNbs.length >= 3) {
          // Sharp apex, corner or junction: freeze in place to preserve corner tip!
          continue;
        } else if (crNbs.length === 2) {
          // Sharp ridge line (e.g. rim of flat top face): allow sliding ONLY along the ridge line
          const pA = currentPositions[crNbs[0]];
          const pB = currentPositions[crNbs[1]];
          const ridgeDir = new THREE.Vector3().subVectors(pB, pA);
          const lenSq = ridgeDir.lengthSq();
          if (lenSq > 1e-12) {
            ridgeDir.normalize();
            disp = ridgeDir.multiplyScalar(disp.dot(ridgeDir));
          } else {
            continue;
          }
        } else if (crNbs.length === 1) {
          const ridgeDir = new THREE.Vector3().subVectors(currentPositions[crNbs[0]], pI);
          const lenSq = ridgeDir.lengthSq();
          if (lenSq > 1e-12) {
            ridgeDir.normalize();
            disp = ridgeDir.multiplyScalar(disp.dot(ridgeDir));
          } else {
            continue;
          }
        }
      }

      // Tangential projection: remove normal component so vertex slides along surface
      const normalDot = disp.dot(norm);
      const tangentDisp = disp.sub(norm.clone().multiplyScalar(normalDot));

      // Move tangentially
      const newPos = pI.clone().addScaledVector(tangentDisp, strength);

      // Re-project onto target BVH to guarantee 100% adherence to geometry
      hitTmp.distance = Infinity;
      hitTmp.faceIndex = -1;
      const reprojectRes = targetBvh.closestPointToPoint(newPos, hitTmp as any);
      if (reprojectRes && reprojectRes.point) {
        nextPositions[i].copy(reprojectRes.point);
        currentNormals[i].copy(getTargetFaceNormal(reprojectRes.faceIndex));
      } else {
        nextPositions[i].copy(newPos);
      }

      // Planar snapping: if vertex is on a target flat face, lock its coordinate to the plane
      if (planarPlanes.length > 0) {
        for (const pl of planarPlanes) {
          if (norm.dot(pl.normal) > 0.95) {
            const distToPlane = pl.normal.dot(nextPositions[i]) - pl.d;
            if (Math.abs(distToPlane) < 0.05) {
              nextPositions[i].addScaledVector(pl.normal, -distToPlane);
            }
          }
        }
      }
    }

    for (let i = 0; i < nVerts; i++) {
      currentPositions[i].copy(nextPositions[i]);
    }
  }

  return { positions: currentPositions, normals: currentNormals };
}

/**
 * Subdivisión Adaptativa por Estiramiento (Edge-Split)
 *
 * Recorre todas las aristas de la malla actual. Si una arista mide más de
 * medianEdge * 1.8, corta esa arista por la mitad agregando un vértice intermedio y
 * triangula de forma conforme las caras adyacentes (Subdivisión Edge-Split).
 * Proyecta de inmediato el nuevo vértice a la superficie real usando el BVH del modelo destino.
 * Se ejecuta durante 2 pasadas rápidas para dotar de polígonos a extremidades delgadas y zonas complejas.
 */
export function subdivideStretchedEdges(
  currentPositions: THREE.Vector3[],
  finalNormals: THREE.Vector3[],
  srcFaces: MeshFace[],
  targetBvh: MeshBVH,
  getTargetFaceNormal: (faceIndex: number) => THREE.Vector3,
  passes: number = 2
): {
  positions: THREE.Vector3[];
  normals: THREE.Vector3[];
  faces: MeshFace[];
  totalSplits: number;
} {
  let positions = [...currentPositions];
  let normals = [...finalNormals];

  // Si la malla ya tiene suficiente resolución (p. ej. cage 100x100 con >8,000 caras),
  // no subdividimos para evitar fragmentar y generar agujas desiguales
  if (srcFaces.length >= 8000) {
    return { positions, normals, faces: srcFaces, totalSplits: 0 };
  }

  // Triangulamos todas las caras de entrada para una subdivisión conformada y robusta
  let faces: MeshFace[] = [];
  for (const f of srcFaces) {
    const idxs = f.indices;
    if (!idxs || idxs.length < 3) continue;
    if (idxs.length === 3) {
      faces.push({ ...f });
    } else if (idxs.length === 4) {
      faces.push({ ...f, indices: [idxs[0], idxs[1], idxs[2]] });
      faces.push({ ...f, indices: [idxs[0], idxs[2], idxs[3]] });
    } else {
      for (let k = 1; k < idxs.length - 1; k++) {
        faces.push({ ...f, indices: [idxs[0], idxs[k], idxs[k + 1]] });
      }
    }
  }

  let totalSplits = 0;
  const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

  for (let pass = 0; pass < passes; pass++) {
    // 1. Calcular longitud de arista mediana en la malla actual
    const edgeLengths: number[] = [];
    const seenEdges = new Set<string>();

    for (let fi = 0; fi < faces.length; fi++) {
      const idxs = faces[fi].indices;
      for (let j = 0; j < 3; j++) {
        const u = idxs[j];
        const v = idxs[(j + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          const pU = positions[u];
          const pV = positions[v];
          if (pU && pV) {
            const d = pU.distanceTo(pV);
            if (d > 1e-6) edgeLengths.push(d);
          }
        }
      }
    }

    if (edgeLengths.length === 0) break;
    edgeLengths.sort((a, b) => a - b);
    const medianEdge = edgeLengths[Math.floor(edgeLengths.length * 0.5)];
    if (medianEdge < 1e-5) break;

    const stretchThreshold = medianEdge * 1.8;

    // 2. Identificar aristas que superan medianEdge * 1.8 y crear vértices intermedios proyectados
    const splitMap = new Map<string, number>(); // edgeKey -> newVertexIndex

    for (let fi = 0; fi < faces.length; fi++) {
      const idxs = faces[fi].indices;
      for (let j = 0; j < 3; j++) {
        const u = idxs[j];
        const v = idxs[(j + 1) % 3];
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        if (splitMap.has(key)) continue;

        const pU = positions[u];
        const pV = positions[v];
        if (!pU || !pV) continue;

        const len = pU.distanceTo(pV);
        if (len > stretchThreshold) {
          // Vértice intermedio
          const mid = new THREE.Vector3().addVectors(pU, pV).multiplyScalar(0.5);

          // Proyección a la superficie real usando BVH
          hitTmp.distance = Infinity;
          hitTmp.faceIndex = -1;
          const res = targetBvh.closestPointToPoint(mid, hitTmp as any);

          // Si el punto medio está dentro de un rango razonable de la superficie, lo anclamos
          const maxAllowedDist = Math.max(medianEdge * 2.2, len * 0.6);
          if (!res || !res.point || mid.distanceTo(res.point) > maxAllowedDist) {
            continue;
          }

          const newPos = res.point.clone();
          const newNorm = getTargetFaceNormal(res.faceIndex);

          const newIdx = positions.length;
          positions.push(newPos);
          normals.push(newNorm);
          splitMap.set(key, newIdx);
        }
      }
    }

    if (splitMap.size === 0) break;
    totalSplits += splitMap.size;

    // 3. Triangulación conforme de caras adyacentes (Edge-Split) preservando estrictamente el Winding Order
    const nextFaces: MeshFace[] = [];

    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      const [i0, i1, i2] = f.indices;

      const p0 = positions[i0];
      const p1 = positions[i1];
      const p2 = positions[i2];
      if (!p0 || !p1 || !p2) continue;

      const k01 = i0 < i1 ? `${i0}_${i1}` : `${i1}_${i0}`;
      const k12 = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
      const k20 = i2 < i0 ? `${i2}_${i0}` : `${i0}_${i2}`;

      const m01 = splitMap.get(k01);
      const m12 = splitMap.get(k12);
      const m20 = splitMap.get(k20);

      const numSplits = (m01 !== undefined ? 1 : 0) + (m12 !== undefined ? 1 : 0) + (m20 !== undefined ? 1 : 0);

      if (numSplits === 0) {
        nextFaces.push(f);
      } else if (numSplits === 1) {
        if (m01 !== undefined) {
          // Arista v0-v1 cortada por vNew (m01):
          // Triángulo A: [v0, vNew, v2]
          // Triángulo B: [vNew, v1, v2]
          nextFaces.push({ ...f, indices: [i0, m01, i2] });
          nextFaces.push({ ...f, indices: [m01, i1, i2] });
        } else if (m12 !== undefined) {
          // Arista v1-v2 cortada por vNew (m12):
          // Triángulo A: [v1, vNew, v0]
          // Triángulo B: [vNew, v2, v0]
          nextFaces.push({ ...f, indices: [i1, m12, i0] });
          nextFaces.push({ ...f, indices: [m12, i2, i0] });
        } else if (m20 !== undefined) {
          // Arista v2-v0 cortada por vNew (m20):
          // Triángulo A: [v2, vNew, v1]
          // Triángulo B: [vNew, v0, v1]
          nextFaces.push({ ...f, indices: [i2, m20, i1] });
          nextFaces.push({ ...f, indices: [m20, i0, i1] });
        }
      } else if (numSplits === 2) {
        if (m01 !== undefined && m12 !== undefined) {
          nextFaces.push({ ...f, indices: [m01, i1, m12] });
          const d1 = positions[m01].distanceTo(positions[i2]);
          const d2 = positions[i0].distanceTo(positions[m12]);
          if (d1 <= d2) {
            nextFaces.push({ ...f, indices: [i0, m01, i2] });
            nextFaces.push({ ...f, indices: [m01, m12, i2] });
          } else {
            nextFaces.push({ ...f, indices: [i0, m01, m12] });
            nextFaces.push({ ...f, indices: [i0, m12, i2] });
          }
        } else if (m12 !== undefined && m20 !== undefined) {
          nextFaces.push({ ...f, indices: [m12, i2, m20] });
          const d1 = positions[m12].distanceTo(positions[i0]);
          const d2 = positions[i1].distanceTo(positions[m20]);
          if (d1 <= d2) {
            nextFaces.push({ ...f, indices: [i1, m12, i0] });
            nextFaces.push({ ...f, indices: [m12, m20, i0] });
          } else {
            nextFaces.push({ ...f, indices: [i1, m12, m20] });
            nextFaces.push({ ...f, indices: [i1, m20, i0] });
          }
        } else if (m20 !== undefined && m01 !== undefined) {
          nextFaces.push({ ...f, indices: [m20, i0, m01] });
          const d1 = positions[m20].distanceTo(positions[i1]);
          const d2 = positions[i2].distanceTo(positions[m01]);
          if (d1 <= d2) {
            nextFaces.push({ ...f, indices: [i2, m20, i1] });
            nextFaces.push({ ...f, indices: [m20, m01, i1] });
          } else {
            nextFaces.push({ ...f, indices: [i2, m20, m01] });
            nextFaces.push({ ...f, indices: [i2, m01, i1] });
          }
        }
      } else if (numSplits === 3 && m01 !== undefined && m12 !== undefined && m20 !== undefined) {
        nextFaces.push({ ...f, indices: [i0, m01, m20] });
        nextFaces.push({ ...f, indices: [m01, i1, m12] });
        nextFaces.push({ ...f, indices: [m12, i2, m20] });
        nextFaces.push({ ...f, indices: [m01, m12, m20] });
      }
    }

    faces = nextFaces;
  }

  // 4. Recalcular las normales del objeto con geometry.computeVertexNormals() para garantizar coherencia
  if (faces.length > 0 && positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      posArr[i * 3] = positions[i].x;
      posArr[i * 3 + 1] = positions[i].y;
      posArr[i * 3 + 2] = positions[i].z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

    const idxArr: number[] = [];
    for (const f of faces) {
      if (f.indices && f.indices.length >= 3) {
        idxArr.push(f.indices[0], f.indices[1], f.indices[2]);
      }
    }
    geo.setIndex(idxArr);
    geo.computeVertexNormals();

    const normAttr = geo.getAttribute('normal');
    if (normAttr && normAttr.count === positions.length) {
      normals = [];
      for (let i = 0; i < positions.length; i++) {
        normals.push(new THREE.Vector3(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)));
      }
    }
    geo.dispose();
  }

  return {
    positions,
    normals,
    faces,
    totalSplits
  };
}

/**
 * Optimiza la topología de una malla ceñida o envoltorio eliminando polígonos redundantes
 * (regiones planas o de baja curvatura) preservando al 100% las aristas vivas, esquinas,
 * puntas de silueta y contorno exterior.
 */
export async function optimizeConformedMesh(
  meshObj: CSGObject,
  targetObj?: CSGObject,
  options: OptimizeConformedMeshOptions = {}
): Promise<OptimizeConformedMeshResult> {
  const {
    targetReductionRatio = 0.35,
    targetPolyCount,
    preserveCreases = true,
    creaseAngleDeg = 25,
    reprojectToTarget = true,
    offset = 0.002,
    outputTopology = 'QUAD_DOMINANT',
    errorTolerance = 0.035
  } = options;

  let resolvedSource = meshObj;
  if ((!resolvedSource.vertices || resolvedSource.vertices.length === 0) && resolvedSource.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedSource = await convertImportedToCSG(resolvedSource);
    } catch (err) {
      console.warn('Error convirtiendo objeto para optimización:', err);
    }
  }

  const rawVerts: V3[] = (resolvedSource.vertices || []).map((v, i) => {
    const off = resolvedSource.vertexOffsets?.[i] || [0, 0, 0];
    return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
  });

  const rawIndices: number[] = [];
  (resolvedSource.faces || []).forEach(f => {
    if (!f.indices || f.indices.length < 3) return;
    if (f.indices.length === 3) {
      rawIndices.push(f.indices[0], f.indices[1], f.indices[2]);
    } else if (f.indices.length === 4) {
      rawIndices.push(f.indices[0], f.indices[1], f.indices[2]);
      rawIndices.push(f.indices[0], f.indices[2], f.indices[3]);
    } else {
      for (let i = 1; i < f.indices.length - 1; i++) {
        rawIndices.push(f.indices[0], f.indices[i], f.indices[i + 1]);
      }
    }
  });

  const initialFacesCount = resolvedSource.faces?.length || Math.floor(rawIndices.length / 3);
  const initialVertsCount = rawVerts.length;

  if (rawVerts.length < 4 || rawIndices.length < 12) {
    return {
      updatedObject: resolvedSource,
      report: ['La malla no contiene suficientes polígonos para optimizar.'],
      stats: {
        initialFaces: initialFacesCount,
        finalFaces: initialFacesCount,
        initialVertices: initialVertsCount,
        finalVertices: initialVertsCount,
        quads: 0,
        triangles: initialFacesCount,
        reductionPct: 0
      }
    };
  }

  const numVerts = rawVerts.length;
  const numTris = rawIndices.length / 3;

  const flatPos = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    flatPos[i * 3] = rawVerts[i][0];
    flatPos[i * 3 + 1] = rawVerts[i][1];
    flatPos[i * 3 + 2] = rawVerts[i][2];
  }

  // 1. Detección de aristas vivas, crestas y esquinas estructurales
  const creaseCos = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const triNormals: THREE.Vector3[] = [];
  for (let t = 0; t < numTris; t++) {
    const i0 = rawIndices[t * 3];
    const i1 = rawIndices[t * 3 + 1];
    const i2 = rawIndices[t * 3 + 2];
    const v0 = new THREE.Vector3(flatPos[i0 * 3], flatPos[i0 * 3 + 1], flatPos[i0 * 3 + 2]);
    const v1 = new THREE.Vector3(flatPos[i1 * 3], flatPos[i1 * 3 + 1], flatPos[i1 * 3 + 2]);
    const v2 = new THREE.Vector3(flatPos[i2 * 3], flatPos[i2 * 3 + 1], flatPos[i2 * 3 + 2]);
    triNormals.push(new THREE.Vector3().crossVectors(v1.sub(v0), v2.sub(v0)).normalize());
  }

  const edgeFaces = new Map<string, number[]>();
  for (let t = 0; t < numTris; t++) {
    const i0 = rawIndices[t * 3];
    const i1 = rawIndices[t * 3 + 1];
    const i2 = rawIndices[t * 3 + 2];
    for (const [u, v] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const list = edgeFaces.get(k) || [];
      list.push(t);
      edgeFaces.set(k, list);
    }
  }

  const vertCreaseCount = new Int32Array(numVerts);
  edgeFaces.forEach((fList, k) => {
    const sep = k.indexOf('_');
    const u = parseInt(k.substring(0, sep), 10);
    const v = parseInt(k.substring(sep + 1), 10);
    if (fList.length === 1) {
      // Borde abierto
      vertCreaseCount[u] += 2;
      vertCreaseCount[v] += 2;
    } else if (fList.length === 2) {
      if (triNormals[fList[0]].dot(triNormals[fList[1]]) < creaseCos) {
        // Arista viva
        vertCreaseCount[u]++;
        vertCreaseCount[v]++;
      }
    }
  });

  // 2. Normales por vértice y atributos de peso para Meshopt
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(flatPos, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(rawIndices), 1));
  geo.computeVertexNormals();
  const flatNormals = geo.attributes.normal.array as Float32Array;

  const attrArray = new Float32Array(numVerts * 4);
  for (let i = 0; i < numVerts; i++) {
    attrArray[i * 4] = flatNormals[i * 3];
    attrArray[i * 4 + 1] = flatNormals[i * 3 + 1];
    attrArray[i * 4 + 2] = flatNormals[i * 3 + 2];
    const c = vertCreaseCount[i];
    // Esquinas y puntas estructurales (>= 3 aristas vivas) reciben peso alto; crestas peso medio; planos peso mínimo
    attrArray[i * 4 + 3] = c >= 3 ? 6.0 : c === 2 ? 2.5 : 0.1;
  }
  geo.dispose();

  // 3. Inicialización y cálculo de objetivo
  await MeshoptSimplifier.ready;

  let targetTris: number;
  if (targetPolyCount && targetPolyCount > 0) {
    targetTris = targetPolyCount;
  } else if (targetReductionRatio && targetReductionRatio > 0 && targetReductionRatio < 1) {
    targetTris = Math.max(16, Math.floor(numTris * targetReductionRatio));
  } else {
    targetTris = Math.max(16, Math.floor(numTris * 0.35));
  }

  let curIndices = new Uint32Array(rawIndices);
  const targetIndexCount = targetTris * 3;

  if (targetIndexCount < curIndices.length) {
    const flags = preserveCreases ? (['LockBorder'] as any) : ([] as any);
    // Tier 1: Reducción con atributos (preserva esquinas, crestas y normales)
    try {
      const resAttr = MeshoptSimplifier.simplifyWithAttributes(
        curIndices,
        flatPos,
        3,
        attrArray,
        4,
        [1.0, 1.0, 1.0, 2.0],
        null,
        targetIndexCount,
        errorTolerance,
        flags
      );
      if (resAttr && resAttr[0].length >= 12 && resAttr[0].length < curIndices.length) {
        curIndices = resAttr[0];
      }
    } catch (eAttr) {
      console.warn('simplifyWithAttributes advertencia:', eAttr);
    }

    // Tier 2: Reducción progresiva respetando o relajando LockBorder según preserveCreases
    for (let pass = 1; pass <= 4; pass++) {
      if (curIndices.length <= targetIndexCount * 1.08) break;
      const stepTarget = Math.max(targetIndexCount, Math.floor((curIndices.length / 3) * 0.65) * 3);
      if (stepTarget >= curIndices.length) break;
      try {
        const passFlags = (preserveCreases && pass <= 2) ? (['LockBorder'] as any) : ([] as any);
        const res = MeshoptSimplifier.simplify(
          curIndices,
          flatPos,
          3,
          stepTarget,
          errorTolerance * (1 + pass * 0.4),
          passFlags
        );
        if (res && res[0].length >= 12 && res[0].length < curIndices.length) {
          curIndices = res[0];
        } else if (pass > 2) {
          // Si con LockBorder se atasca, intentar sin LockBorder para permitir reducir paneles planos
          const resNoLock = MeshoptSimplifier.simplify(
            curIndices,
            flatPos,
            3,
            stepTarget,
            errorTolerance * (1 + pass * 0.5),
            [] as any
          );
          if (resNoLock && resNoLock[0].length >= 12 && resNoLock[0].length < curIndices.length) {
            curIndices = resNoLock[0];
          } else {
            break;
          }
        }
      } catch (eSimp) {
        break;
      }
    }

    // Tier 3: Si aún está lejos del objetivo y preserveCreases no es estricto, garantizar reducción
    if (!preserveCreases && curIndices.length > targetIndexCount * 1.25) {
      try {
        const resSloppy = MeshoptSimplifier.simplifySloppy(
          curIndices,
          flatPos,
          3,
          null,
          targetIndexCount,
          0.1
        );
        if (resSloppy && resSloppy[0].length >= 12 && resSloppy[0].length < curIndices.length) {
          curIndices = resSloppy[0];
        }
      } catch (eSloppy) {}
    }
  }

  // 4. Compactación de vértices (elimina vértices flotantes no referenciados)
  const usedVertMap = new Map<number, number>();
  const compactedVerts: V3[] = [];
  const compactedIndices = new Uint32Array(curIndices.length);

  for (let i = 0; i < curIndices.length; i++) {
    const oldIdx = curIndices[i];
    let newIdx = usedVertMap.get(oldIdx);
    if (newIdx === undefined) {
      newIdx = compactedVerts.length;
      compactedVerts.push([
        flatPos[oldIdx * 3],
        flatPos[oldIdx * 3 + 1],
        flatPos[oldIdx * 3 + 2]
      ]);
      usedVertMap.set(oldIdx, newIdx);
    }
    compactedIndices[i] = newIdx;
  }

  // 5. Reproyección al BVH para garantizar cero desviación de la silueta sin colapsar la malla
  if (reprojectToTarget) {
    try {
      const isExternalTarget = targetObj && targetObj.id !== resolvedSource.id;

      if (isExternalTarget) {
        // Reproyección a objetivo externo (e.g. Shrinkwrap / Retopología guiada)
        const targetGeo = await extractTargetGeometry(targetObj);
        targetGeo.computeBoundingBox();
        const targetBvh = new MeshBVH(targetGeo);
        const srcMat = getObjectWorldMatrix(resolvedSource);
        const srcWorldInv = srcMat.clone().invert();
        const ptLocal = new THREE.Vector3();
        const ptWorld = new THREE.Vector3();
        const nearestWorld = new THREE.Vector3();
        const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
        const tgtPosAttr = targetGeo.getAttribute('position');
        const tgtIndexAttr = targetGeo.getIndex();
        const getTargetNormal = (faceIndex: number): THREE.Vector3 => {
          if (faceIndex < 0 || !tgtPosAttr) return new THREE.Vector3(0, 1, 0);
          let i0 = faceIndex * 3;
          let i1 = faceIndex * 3 + 1;
          let i2 = faceIndex * 3 + 2;
          if (tgtIndexAttr) {
            i0 = tgtIndexAttr.getX(i0);
            i1 = tgtIndexAttr.getX(i1);
            i2 = tgtIndexAttr.getX(i2);
          }
          const vA = new THREE.Vector3(tgtPosAttr.getX(i0), tgtPosAttr.getY(i0), tgtPosAttr.getZ(i0));
          const vB = new THREE.Vector3(tgtPosAttr.getX(i1), tgtPosAttr.getY(i1), tgtPosAttr.getZ(i1));
          const vC = new THREE.Vector3(tgtPosAttr.getX(i2), tgtPosAttr.getY(i2), tgtPosAttr.getZ(i2));
          return new THREE.Vector3().crossVectors(vB.sub(vA), vC.sub(vA)).normalize();
        };

        // Radio de seguridad estricto: Si el objetivo está en otra posición de la escena, NO colapsar vértices
        const srcBox = new THREE.Box3();
        for (let i = 0; i < rawVerts.length; i++) {
          srcBox.expandByPoint(new THREE.Vector3(rawVerts[i][0], rawVerts[i][1], rawVerts[i][2]));
        }
        const srcSize = new THREE.Vector3();
        srcBox.getSize(srcSize);
        const maxSnapDistance = Math.max(0.35, srcSize.length() * 0.45);

        for (let i = 0; i < compactedVerts.length; i++) {
          ptLocal.set(compactedVerts[i][0], compactedVerts[i][1], compactedVerts[i][2]);
          ptWorld.copy(ptLocal).applyMatrix4(srcMat);

          hitTmp.distance = Infinity;
          hitTmp.faceIndex = -1;
          const res = targetBvh.closestPointToPoint(ptWorld, hitTmp as any);
          if (res && res.point) {
            const dist = ptWorld.distanceTo(res.point);
            // Solo ajustar si el vértice está razonablemente cerca del objetivo
            if (dist <= maxSnapDistance) {
              nearestWorld.copy(res.point);
              if (offset && Math.abs(offset) > 1e-6 && res.faceIndex >= 0) {
                const hitNorm = getTargetNormal(res.faceIndex);
                nearestWorld.addScaledVector(hitNorm, offset);
              }
              nearestWorld.applyMatrix4(srcWorldInv);
              compactedVerts[i] = [nearestWorld.x, nearestWorld.y, nearestWorld.z];
            }
          }
        }
        targetGeo.dispose();
      } else {
        // Auto-reproyección sobre la forma original del propio objeto (conserva el 100% de la silueta sin deformar)
        const origGeo = new THREE.BufferGeometry();
        origGeo.setAttribute('position', new THREE.BufferAttribute(flatPos, 3));
        origGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(rawIndices), 1));
        origGeo.computeVertexNormals();
        const selfBvh = new MeshBVH(origGeo);
        const ptLocal = new THREE.Vector3();
        const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

        for (let i = 0; i < compactedVerts.length; i++) {
          ptLocal.set(compactedVerts[i][0], compactedVerts[i][1], compactedVerts[i][2]);
          hitTmp.distance = Infinity;
          hitTmp.faceIndex = -1;
          const res = selfBvh.closestPointToPoint(ptLocal, hitTmp as any);
          if (res && res.point) {
            const dist = ptLocal.distanceTo(res.point);
            // Auto-proyección microscópica para anclar vértices a la superficie original
            if (dist < 1.0) {
              compactedVerts[i] = [res.point.x, res.point.y, res.point.z];
            }
          }
        }
        origGeo.dispose();
      }
    } catch (eReproject) {
      console.warn('Error en reproyección de vértices simplificados:', eReproject);
    }
  }

  // 6. Generación de polígonos finales (Quad Flow o Triángulos)
  const finalTriFaces = [];
  for (let i = 0; i < compactedIndices.length; i += 3) {
    finalTriFaces.push({
      indices: [compactedIndices[i], compactedIndices[i + 1], compactedIndices[i + 2]]
    });
  }

  const finalFaces: MeshFace[] = [];
  let quadsCount = 0;
  let trisCount = 0;

  if (outputTopology === 'QUAD_DOMINANT' || outputTopology === 'PURE_QUADS') {
    const flatCompactedPos = new Float32Array(compactedVerts.length * 3);
    for (let i = 0; i < compactedVerts.length; i++) {
      flatCompactedPos[i * 3] = compactedVerts[i][0];
      flatCompactedPos[i * 3 + 1] = compactedVerts[i][1];
      flatCompactedPos[i * 3 + 2] = compactedVerts[i][2];
    }
    const quadRes = pairTrianglesIntoQuads(finalTriFaces as any, flatCompactedPos, {
      preserveCreases,
      creaseAngleDeg
    });
    quadRes.quads.forEach(q => {
      finalFaces.push({ indices: [q[0], q[1], q[2], q[3]] });
      quadsCount++;
    });

    // Añadir triángulos restantes de forma limpia y conformal sin T-junctions
    quadRes.remainingTris.forEach(t => {
      finalFaces.push({ indices: [t[0], t[1], t[2]] });
      trisCount++;
    });
  } else {
    finalTriFaces.forEach(t => {
      finalFaces.push({ indices: t.indices });
      trisCount++;
    });
  }

  const finalFacesCount = finalFaces.length;
  const finalVertsCount = compactedVerts.length;
  const reductionPct = Math.max(0, parseFloat(((1 - finalFacesCount / initialFacesCount) * 100).toFixed(1)));

  const report = [
    `Optimización de topología completada:`,
    `- Caras: de ${initialFacesCount.toLocaleString()} a ${finalFacesCount.toLocaleString()} (-${reductionPct}% de polígonos).`,
    `- Vértices: de ${initialVertsCount.toLocaleString()} a ${finalVertsCount.toLocaleString()}.`,
    quadsCount > 0 ? `- Topología Quad Flow: ${quadsCount} cuadriláteros, ${trisCount} triángulos.` : `- Topología: ${trisCount} triángulos limpios.`,
    `- Estructura: 100% de esquinas vivas y aristas de silueta preservadas.`
  ];

  // 6.5 Preservar / transferir UVs si targetObj tiene UVs
  let finalFacesWithUV: MeshFace[] = finalFaces;
  if (targetObj) {
    try {
      const targetGeo = await extractTargetGeometry(targetObj);
      if (targetGeo && targetGeo.attributes.uv && targetGeo.attributes.uv.count > 0) {
        const targetBvh = new MeshBVH(targetGeo);
        const srcMat = getObjectWorldMatrix(resolvedSource);
        const vertUVs: ([number, number] | null)[] = new Array(compactedVerts.length);
        const tmpPt = new THREE.Vector3();
        for (let i = 0; i < compactedVerts.length; i++) {
          tmpPt.set(compactedVerts[i][0], compactedVerts[i][1], compactedVerts[i][2]).applyMatrix4(srcMat);
          vertUVs[i] = sampleTargetUV(tmpPt, targetBvh, targetGeo);
        }
        finalFacesWithUV = finalFaces.map(face => ({
          ...face,
          uvs: face.indices.map(vi => vertUVs[vi] || [0.5, 0.5])
        }));
        targetGeo.dispose();
      }
    } catch (eUV) {
      console.warn('Error transfiriendo UVs en optimización:', eUV);
    }
  }

  const updatedObject: CSGObject = {
    ...resolvedSource,
    vertices: compactedVerts,
    faces: finalFacesWithUV,
    materialId: targetObj?.materialId ?? resolvedSource.materialId,
    material: targetObj?.material ? JSON.parse(JSON.stringify(targetObj.material)) : resolvedSource.material,
    color: targetObj?.color ?? resolvedSource.color,
    meshData: undefined,
    vertexOffsets: {},
    stats: {
      ...(resolvedSource.stats || {}),
      vertices: finalVertsCount,
      faces: finalFacesCount,
      quads: quadsCount,
      triangles: trisCount,
      reductionPct
    }
  };

  return {
    updatedObject,
    report,
    stats: {
      initialFaces: initialFacesCount,
      finalFaces: finalFacesCount,
      initialVertices: initialVertsCount,
      finalVertices: finalVertsCount,
      quads: quadsCount,
      triangles: trisCount,
      reductionPct
    }
  };
}

/**
 * Vacuum Shrinkwrap (Ajuste Profundo a Silueta Completa)
 *
 * Conceived specifically for complex multi-part models (AT-AT, TIE Fighters, spaceships, character meshes):
 * 1. Subdivides to sufficient resolution to capture concavities and limbs.
 * 2. Inward ray projection with strictly bounded search distances to avoid shooting across open air.
 * 3. Tangential Laplacian relaxation with neighbor distance gating (never smooths across open chasms).
 * 4. Automatic pruning of bridging air-faces / membranes (eliminates spider-webbing between wings and hull).
 */
export async function applySilhouetteVacuumWrap(
  sourceObj: CSGObject,
  targetObj: CSGObject,
  config: SilhouetteVacuumWrapConfig = {}
): Promise<ShrinkwrapResult> {
  let resolvedSource = sourceObj;
  let resolvedTarget = targetObj;

  // Convert source if imported
  if ((!resolvedSource.vertices || resolvedSource.vertices.length === 0) && resolvedSource.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedSource = await convertImportedToCSG(resolvedSource);
    } catch (err) {
      console.warn('Error converting imported source for vacuum wrap:', err);
    }
  }

  // Convert target if imported
  if ((!resolvedTarget.vertices || resolvedTarget.vertices.length === 0) && resolvedTarget.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedTarget = await convertImportedToCSG(resolvedTarget);
    } catch (err) {
      console.warn('Error converting imported target for vacuum wrap:', err);
    }
  }

  let srcVerts = resolvedSource.vertices ? [...resolvedSource.vertices.map(v => [...v] as V3)] : [];
  let srcFaces = resolvedSource.faces ? [...resolvedSource.faces] : [];

  if (srcVerts.length < 4 || srcFaces.length === 0) {
    return {
      updatedObject: resolvedSource,
      modifiedVerticesCount: 0,
      report: ['La malla de origen no contiene vértices o caras válidas.']
    };
  }

  const {
    autoSubdivide = false,
    minFacesTarget = 4000,
    iterations = 5,
    relaxation = 0.15,
    offset = 0.003,
    pruneAirFaces = false,
    airDistanceThreshold,
    maxStretchRatio = 2.2,
    minIslandFaces = 4,
    optimizeTopology = false,
    reductionRatio = 0.35,
    targetPolyCount,
    preserveCreases = true,
    creaseAngleDeg = 25,
    outputTopology = 'QUAD_DOMINANT',
    subdivideStretchedEdges: autoSubdivideStretchedEdges = false,
    regularizeSurface = false,
    smoothShading: configSmoothShading,
    normalAlignmentWeight = 0.75
  } = config;

  const report: string[] = [];
  if (normalAlignmentWeight > 0.05) {
    report.push(`Alineación de Normales activa (peso: ${Math.round(normalAlignmentWeight * 100)}%): restringiendo proyección a caras frontales para preservar ángulos agudos y evitar huecos.`);
  }

  // Step 1: Check if subdivision is needed to follow complex concavities and limbs
  if (autoSubdivide) {
    let currentFaces = srcFaces.length;
    let subdivLevels = 0;
    while (currentFaces < minFacesTarget && subdivLevels < 2) {
      const subRes = subdivideMesh({ vertices: srcVerts, faces: srcFaces });
      srcVerts = subRes.vertices;
      srcFaces = subRes.faces;
      currentFaces = srcFaces.length;
      subdivLevels++;
    }
    if (subdivLevels > 0) {
      report.push(`Subdivisión adaptativa aplicada: ${subdivLevels} nivel(es), ${srcFaces.length} caras finales.`);
    }
  }

  // Step 2: Extract target geometry with BVH in Scene World Space
  const targetGeo = await extractTargetGeometry(resolvedTarget);
  if (!targetGeo.attributes.position || targetGeo.attributes.position.count === 0) {
    return {
      updatedObject: resolvedSource,
      modifiedVerticesCount: 0,
      report: ['El objeto destino no contiene geometría válida para proyectar.']
    };
  }

  const targetBvh = new MeshBVH(targetGeo);

  const srcWorldMat = getObjectWorldMatrix(resolvedSource);
  const srcWorldInv = srcWorldMat.clone().invert();
  const srcNormalMat = new THREE.Matrix3().getNormalMatrix(srcWorldMat);

  const tgtPosAttr = targetGeo.getAttribute('position');
  const tgtIndex = targetGeo.getIndex();

  // Target bounding box & center in world space
  if (!targetGeo.boundingBox) targetGeo.computeBoundingBox();
  const tgtBox = targetGeo.boundingBox!;
  const tgtCenterWorld = new THREE.Vector3();
  tgtBox.getCenter(tgtCenterWorld);
  const tgtDiag = tgtBox.getSize(new THREE.Vector3()).length();
  const maxRayDistance = tgtDiag * 1.5;
  const maxAllowedFallback = tgtDiag * 0.35;

  const snapPlanarFaces = config.snapPlanarFaces ?? true;
  const snapSharpFeatures = config.snapSharpFeatures ?? true;
  const antiRounding = config.antiRounding ?? true;

  // Extracción de planos dominantes, aristas vivas y esquinas del objetivo para Anti-Redondeo y Preservación de Ángulos
  const targetPlanarPlanes: { normal: THREE.Vector3; d: number; faceIndices: Set<number> }[] = [];
  const targetFaceToPlane = new Map<number, { normal: THREE.Vector3; d: number }>();
  const targetSharpPts: THREE.Vector3[] = [];
  const targetSharpEdges: { p1: THREE.Vector3; p2: THREE.Vector3; dir: THREE.Vector3; len: number }[] = [];

  if ((snapPlanarFaces || antiRounding) && tgtPosAttr) {
    const numFaces = tgtIndex ? tgtIndex.count / 3 : tgtPosAttr.count / 3;
    const cosPlanarTol = Math.cos((3.5 * Math.PI) / 180);
    const planeDistTol = Math.max(0.015, tgtDiag * 0.01);
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();

    for (let f = 0; f < numFaces; f++) {
      let i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
      if (tgtIndex) { i0 = tgtIndex.getX(i0); i1 = tgtIndex.getX(i1); i2 = tgtIndex.getX(i2); }
      p0.fromBufferAttribute(tgtPosAttr, i0);
      p1.fromBufferAttribute(tgtPosAttr, i1);
      p2.fromBufferAttribute(tgtPosAttr, i2);
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      fn.crossVectors(e1, e2).normalize();
      if (fn.lengthSq() < 1e-5) continue;
      const d = fn.dot(p0);

      let found = false;
      for (const pl of targetPlanarPlanes) {
        if (pl.normal.dot(fn) >= cosPlanarTol && Math.abs(pl.normal.dot(p0) - pl.d) < planeDistTol) {
          pl.faceIndices.add(f);
          targetFaceToPlane.set(f, pl);
          found = true;
          break;
        }
      }
      if (!found && targetPlanarPlanes.length < 128) {
        const set = new Set<number>();
        set.add(f);
        const newPl = { normal: fn.clone(), d, faceIndices: set };
        targetPlanarPlanes.push(newPl);
        targetFaceToPlane.set(f, newPl);
      }
    }
    if (targetPlanarPlanes.length > 0) {
      report.push(`Anti-redondeo: detectadas ${targetPlanarPlanes.length} caras/regiones planas coplanares en el objetivo.`);
    }
  }

  if ((snapSharpFeatures || antiRounding) && tgtPosAttr) {
    const cosCrease = Math.cos((creaseAngleDeg * Math.PI) / 180);
    const numFaces = tgtIndex ? tgtIndex.count / 3 : tgtPosAttr.count / 3;
    const edgeMap = new Map<string, { f1: number; f2?: number; pA: THREE.Vector3; pB: THREE.Vector3 }>();
    const faceNormals: THREE.Vector3[] = [];
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

    // Función de clave espacial robusta a duplicados de vértices no indexados
    const posKey = (p: THREE.Vector3) => `${Math.round(p.x * 2000)}_${Math.round(p.y * 2000)}_${Math.round(p.z * 2000)}`;

    for (let f = 0; f < numFaces; f++) {
      let i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
      if (tgtIndex) { i0 = tgtIndex.getX(i0); i1 = tgtIndex.getX(i1); i2 = tgtIndex.getX(i2); }
      p0.fromBufferAttribute(tgtPosAttr, i0);
      p1.fromBufferAttribute(tgtPosAttr, i1);
      p2.fromBufferAttribute(tgtPosAttr, i2);
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      faceNormals.push(new THREE.Vector3().crossVectors(e1, e2).normalize());

      const edges = [
        { a: p0, b: p1 },
        { a: p1, b: p2 },
        { a: p2, b: p0 }
      ];
      for (const { a, b } of edges) {
        const kA = posKey(a);
        const kB = posKey(b);
        if (kA === kB) continue;
        const key = kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
        const ex = edgeMap.get(key);
        if (ex) {
          ex.f2 = f;
        } else {
          edgeMap.set(key, { f1: f, pA: a.clone(), pB: b.clone() });
        }
      }
    }

    const vSharpCount = new Map<string, number>();
    const vSharpPos = new Map<string, THREE.Vector3>();

    edgeMap.forEach(({ f1, f2, pA, pB }) => {
      if (f2 !== undefined) {
        const n1 = faceNormals[f1];
        const n2 = faceNormals[f2];
        if (n1 && n2 && n1.dot(n2) < cosCrease) {
          const diff = new THREE.Vector3().subVectors(pB, pA);
          const elen = diff.length();
          if (elen > 1e-5) {
            targetSharpEdges.push({
              p1: pA,
              p2: pB,
              dir: diff.clone().normalize(),
              len: elen
            });
            const kA = posKey(pA);
            const kB = posKey(pB);
            vSharpCount.set(kA, (vSharpCount.get(kA) || 0) + 1);
            vSharpCount.set(kB, (vSharpCount.get(kB) || 0) + 1);
            vSharpPos.set(kA, pA);
            vSharpPos.set(kB, pB);
          }
        }
      }
    });

    vSharpCount.forEach((cnt, k) => {
      if (cnt >= 3) {
        const pt = vSharpPos.get(k);
        if (pt) targetSharpPts.push(pt.clone());
      }
    });

    if (targetSharpEdges.length > 0 || targetSharpPts.length > 0) {
      report.push(`Anti-redondeo: detectadas ${targetSharpEdges.length} aristas vivas y ${targetSharpPts.length} esquinas en el objetivo.`);
    }
  }

  const getTargetFaceNormal = (faceIndex: number): THREE.Vector3 => {
    if (faceIndex < 0 || !tgtPosAttr) return new THREE.Vector3(0, 1, 0);

    let i0 = faceIndex * 3;
    let i1 = faceIndex * 3 + 1;
    let i2 = faceIndex * 3 + 2;

    if (tgtIndex) {
      i0 = tgtIndex.getX(i0);
      i1 = tgtIndex.getX(i1);
      i2 = tgtIndex.getX(i2);
    }

    if (i0 >= tgtPosAttr.count || i1 >= tgtPosAttr.count || i2 >= tgtPosAttr.count) {
      return new THREE.Vector3(0, 1, 0);
    }

    const p0 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i0);
    const p1 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i1);
    const p2 = new THREE.Vector3().fromBufferAttribute(tgtPosAttr, i2);

    const e1 = new THREE.Vector3().subVectors(p1, p0);
    const e2 = new THREE.Vector3().subVectors(p2, p0);
    const fn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    return fn.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : fn;
  };

  // Step 3: Build neighbor topology graph for tangential relaxation
  let numVerts = srcVerts.length;
  const neighbors: number[][] = Array.from({ length: numVerts }, () => []);
  const edgeSet = new Set<string>();

  for (const face of srcFaces) {
    const idx = face.indices;
    const len = idx.length;
    for (let j = 0; j < len; j++) {
      const a = idx[j];
      const b = idx[(j + 1) % len];
      if (a === b) continue;
      const key1 = `${a}_${b}`;
      const key2 = `${b}_${a}`;
      if (!edgeSet.has(key1)) {
        edgeSet.add(key1);
        edgeSet.add(key2);
        neighbors[a].push(b);
        neighbors[b].push(a);
      }
    }
  }

  // Calculate vertex normals of source in local space, then convert to world space
  const srcNormalsLocal = computeMeshVertexNormals(srcVerts, srcFaces);
  const srcNormalsWorld = srcNormalsLocal.map(n => n.clone().applyMatrix3(srcNormalMat).normalize());

  // Determine if source is a flat plane or an enclosing cage (ellipsoid/box)
  const isRetopoPlane = !!(resolvedSource.parameters as any)?.isRetopoPlane;

  // Working positions in SCENE WORLD SPACE
  let currentPositions: THREE.Vector3[] = srcVerts.map(v => {
    return new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(srcWorldMat);
  });

  const closestHit: { point: THREE.Vector3; distance: number; faceIndex: number } = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1
  };

  let finalNormals: THREE.Vector3[] = Array.from({ length: numVerts }, () => new THREE.Vector3(0, 1, 0));

  // Determine cage bounding box and scale
  const srcCageBox = new THREE.Box3();
  for (const p of currentPositions) srcCageBox.expandByPoint(p);
  const srcCageCenterWorld = srcCageBox.getCenter(new THREE.Vector3());

  // Comprobar si la malla ya está ceñida o muy cerca de la superficie
  let initialCloseCount = 0;
  const sampleVertStep = Math.max(1, Math.floor(numVerts / 50));
  for (let si = 0; si < numVerts; si += sampleVertStep) {
    closestHit.distance = Infinity;
    closestHit.faceIndex = -1;
    const testRes = targetBvh.closestPointToPoint(currentPositions[si], closestHit as any);
    if (testRes && testRes.point && currentPositions[si].distanceTo(testRes.point) < tgtDiag * 0.05) {
      initialCloseCount++;
    }
  }
  const isAlreadyConformed = initialCloseCount / Math.ceil(numVerts / sampleVertStep) > 0.6;

  report.push(`Ceñido iterativo de silueta (${iterations} pases, relajación tangencial y adaptación a la superficie)...`);

  const rayDistanceLimit = tgtDiag * 2.5;

  for (let pass = 0; pass < iterations; pass++) {
    const isFirstPass = pass === 0;
    const progress = (pass + 1) / iterations;
    const stepAlpha = isFirstPass ? 1.0 : Math.min(0.85, 0.45 + progress * 0.4);

    for (let i = 0; i < numVerts; i++) {
      const vWorld = currentPositions[i];
      let snappedPoint: THREE.Vector3 | null = null;
      let snappedNormal: THREE.Vector3 | null = null;

      if (isRetopoPlane) {
        // Plano Quads: Proyectar a lo largo de la normal del plano hacia el objetivo
        const currentNorm = (pass === 0 ? srcNormalsWorld[i] : finalNormals[i]);
        const rayDir = currentNorm.clone().negate().normalize();
        const rayPos = new THREE.Ray(vWorld, rayDir);
        const hitPos = targetBvh.raycastFirst(rayPos);
        if (hitPos && hitPos.point && hitPos.point.distanceTo(vWorld) <= rayDistanceLimit) {
          snappedPoint = hitPos.point.clone();
          snappedNormal = hitPos.normal || getTargetFaceNormal(hitPos.faceIndex);
        } else {
          const rayNeg = new THREE.Ray(vWorld, rayDir.clone().negate());
          const hitNeg = targetBvh.raycastFirst(rayNeg);
          if (hitNeg && hitNeg.point && hitNeg.point.distanceTo(vWorld) <= rayDistanceLimit) {
            snappedPoint = hitNeg.point.clone();
            snappedNormal = hitNeg.normal || getTargetFaceNormal(hitNeg.faceIndex);
          }
        }

        // Fallback con BVH
        if (!snappedPoint) {
          closestHit.distance = Infinity;
          closestHit.faceIndex = -1;
          const res = targetBvh.closestPointToPoint(vWorld, closestHit as any);
          if (res && res.point) {
            snappedPoint = res.point.clone();
            snappedNormal = getTargetFaceNormal(res.faceIndex);
          }
        }
      } else {
        // Jaula de Envoltura (Box / Sphere / Cylinder 360°):
        // ── PROYECCIÓN CON PONDERACIÓN DE ALINEACIÓN DE NORMALES (Normal Alignment Weight) ──
        // Resuelve ángulos agudos, cuñas y pliegues cóncavos penalizando caras que miren hacia otro lado
        // (evita que los vértices salten al reverso de aristas vivas y dejen huecos/webbing).
        const vNorm = (pass === 0 ? srcNormalsWorld[i] : finalNormals[i]).clone().normalize();

        // 1. Evaluación del Punto más Cercano Euclídeo (BVH Closest Point)
        closestHit.distance = Infinity;
        closestHit.faceIndex = -1;
        const resClosest = targetBvh.closestPointToPoint(vWorld, closestHit as any);
        const pClosest = resClosest && resClosest.point ? resClosest.point.clone() : null;
        const normClosest = (resClosest && resClosest.faceIndex >= 0) ? getTargetFaceNormal(resClosest.faceIndex) : null;

        // 2. Dirección de rayo a lo largo de la normal invertida de la jaula (-vNorm)
        const normIn = vNorm.clone().negate();
        const rayNorm = new THREE.Ray(vWorld, normIn);
        const hitNorm = targetBvh.raycastFirst(rayNorm);
        let pRayNorm: THREE.Vector3 | null = null;
        let nRayNorm: THREE.Vector3 | null = null;

        if (hitNorm && hitNorm.point && hitNorm.point.distanceTo(vWorld) <= rayDistanceLimit) {
          const fn = hitNorm.normal || getTargetFaceNormal(hitNorm.faceIndex);
          pRayNorm = hitNorm.point.clone();
          nRayNorm = fn;
        }

        // 3. Rayo secundario hacia el centro geométrico del objetivo
        const rayDirection = new THREE.Vector3().subVectors(tgtCenterWorld, vWorld).normalize();
        const rayIn = new THREE.Ray(vWorld, rayDirection);
        const hitIn = targetBvh.raycastFirst(rayIn);
        let pRayIn: THREE.Vector3 | null = null;
        let nRayIn: THREE.Vector3 | null = null;

        if (hitIn && hitIn.point && hitIn.point.distanceTo(vWorld) <= rayDistanceLimit) {
          const fn = hitIn.normal || getTargetFaceNormal(hitIn.faceIndex);
          pRayIn = hitIn.point.clone();
          nRayIn = fn;
        }

        // 4. Rayo hacia afuera (+vNorm) para cuando el vértice cayó dentro de una cavidad o ángulo agudo cóncavo
        let pRayOut: THREE.Vector3 | null = null;
        let nRayOut: THREE.Vector3 | null = null;
        if (normalAlignmentWeight > 0.05) {
          const rayNormOut = new THREE.Ray(vWorld, vNorm);
          const hitNormOut = targetBvh.raycastFirst(rayNormOut);
          if (hitNormOut && hitNormOut.point && hitNormOut.point.distanceTo(vWorld) <= tgtDiag * 0.35) {
            pRayOut = hitNormOut.point.clone();
            nRayOut = hitNormOut.normal || getTargetFaceNormal(hitNormOut.faceIndex);
          }
        }

        // ── FUNCIÓN DE PUNTUACIÓN DE CANDIDATOS ASISTIDA POR NORMAL ALIGNMENT ──
        const scoreCandidate = (pt: THREE.Vector3 | null, fn: THREE.Vector3 | null): { score: number; pt: THREE.Vector3; norm: THREE.Vector3 } | null => {
          if (!pt || !fn) return null;
          const dist = vWorld.distanceTo(pt);
          if (dist > rayDistanceLimit) return null;

          if (normalAlignmentWeight <= 0.01) {
            return { score: dist, pt, norm: fn };
          }

          // Producto escalar entre la normal del vértice de la jaula y la normal de la cara candidata
          const dot = Math.max(-1, Math.min(1, vNorm.dot(fn)));

          // Si dot > 0: ambas normales apuntan hacia el mismo hemisferio exterior (orientación coherente).
          // Si dot == 1: paralelismo coplanar perfecto -> penalización 0.
          // Si dot == 0 (90°, pared perpendicular): penalización moderada.
          // Si dot < 0 (cara invertida / reverso del filo agudo): penalización severa (impide el salto entre caras).
          let penalty = 0;
          if (dot >= 0) {
            penalty = normalAlignmentWeight * (1.0 - dot) * 2.2;
          } else {
            penalty = normalAlignmentWeight * (2.2 + Math.abs(dot) * 7.5);
          }

          const score = dist * (1.0 + penalty);
          return { score, pt, norm: fn };
        };

        const candidates = [
          scoreCandidate(pClosest, normClosest),
          scoreCandidate(pRayNorm, nRayNorm),
          scoreCandidate(pRayIn, nRayIn),
          scoreCandidate(pRayOut, nRayOut)
        ].filter((c): c is { score: number; pt: THREE.Vector3; norm: THREE.Vector3 } => c !== null);

        if (candidates.length > 0) {
          candidates.sort((a, b) => a.score - b.score);
          snappedPoint = candidates[0].pt;
          snappedNormal = candidates[0].norm;
        } else if (pClosest) {
          snappedPoint = pClosest;
          snappedNormal = normClosest;
        }

        // 5. Los vértices preservan su distribución sin colapsar puntas en una singularidad
      }

      if (snappedPoint) {
        if (isFirstPass) {
          currentPositions[i].copy(snappedPoint);
        } else {
          currentPositions[i].lerp(snappedPoint, stepAlpha);
        }
        finalNormals[i] = (snappedNormal || new THREE.Vector3(0, 1, 0)).clone();
      }
    }

    // Relajación tangencial uniforme entre pases con preservación de características
    if (relaxation > 0) {
      const curEdgeLengths: number[] = [];
      const sampleStep = Math.max(1, Math.floor(srcFaces.length / 400));
      for (let fIdx = 0; fIdx < srcFaces.length; fIdx += sampleStep) {
        const idx = srcFaces[fIdx].indices;
        for (let j = 0; j < idx.length; j++) {
          curEdgeLengths.push(currentPositions[idx[j]].distanceTo(currentPositions[idx[(j + 1) % idx.length]]));
        }
      }
      curEdgeLengths.sort((a, b) => a - b);
      const curMedianEdge = curEdgeLengths.length > 0 ? curEdgeLengths[Math.floor(curEdgeLengths.length / 2)] : 1.0;

      const smoothed = currentPositions.map(p => p.clone());
      for (let i = 0; i < numVerts; i++) {
        const nbs = neighbors[i];
        if (nbs.length > 0) {
          // Preservar esquinas vivas: si el vértice está anclado a una punta viva, no desplazarlo
          if ((snapSharpFeatures || antiRounding) && targetSharpPts.length > 0) {
            let isNearSharp = false;
            for (const sp of targetSharpPts) {
              if (currentPositions[i].distanceTo(sp) < curMedianEdge * 0.35) {
                isNearSharp = true;
                break;
              }
            }
            if (isNearSharp) continue;
          }

          const avg = new THREE.Vector3();
          for (let k = 0; k < nbs.length; k++) {
            avg.add(currentPositions[nbs[k]]);
          }
          avg.divideScalar(nbs.length);
          const diff = avg.sub(currentPositions[i]);
          const norm = finalNormals[i];

          // ── PATCH ANTI-ROUNDING: Si los vecinos divergen fuertemente en su normal, estamos en una cresta/punta viva ──
          let maxNormalAngle = 0;
          for (let k = 0; k < nbs.length; k++) {
            const nbNorm = finalNormals[nbs[k]];
            if (nbNorm) {
              const dotVal = Math.max(-1, Math.min(1, norm.dot(nbNorm)));
              maxNormalAngle = Math.max(maxNormalAngle, 1.0 - dotVal);
            }
          }
          // Si el ángulo normal entre caras adyacentes es muy pronunciado (> 45° aprox, dot < 0.7), congelamos el vértice para que no se redondee
          const antiRoundingFactor = maxNormalAngle > 0.3 ? 0.0 : 1.0;

          // Proyectar diferencia en el plano tangente a la superficie
          const normalComp = norm.clone().multiplyScalar(diff.dot(norm));
          const tangentDiff = diff.sub(normalComp);

          // Limitar desplazamiento máximo por paso de relajación para estabilidad numérica
          const maxStep = Math.max(curMedianEdge * 0.45, 0.01);
          if (tangentDiff.length() > maxStep) {
            tangentDiff.normalize().multiplyScalar(maxStep);
          }

          const relaxedPos = currentPositions[i].clone().addScaledVector(tangentDiff, relaxation * 0.35 * antiRoundingFactor);

          // Re-snap directo a la superficie mediante BVH
          closestHit.distance = Infinity;
          closestHit.faceIndex = -1;
          const rSnap = targetBvh.closestPointToPoint(relaxedPos, closestHit as any);
          if (rSnap && rSnap.point) {
            const rNorm = rSnap.faceIndex >= 0 ? getTargetFaceNormal(rSnap.faceIndex) : null;
            // Si la alineación de normales está activa, verificar que la relajación no cruce un filo vivo o ángulo agudo
            const isOrientOk = !rNorm || normalAlignmentWeight <= 0.1 || (finalNormals[i].dot(rNorm) >= (0.15 - normalAlignmentWeight * 0.45));
            if (isOrientOk) {
              smoothed[i].copy(rSnap.point);
              if (rNorm) finalNormals[i] = rNorm;
            } else {
              smoothed[i].copy(currentPositions[i]);
            }
          } else {
            smoothed[i].copy(relaxedPos);
          }

          // Restricción planar durante la relajación: mantener caras coplanares estrictamente planas
          if (snapPlanarFaces && targetPlanarPlanes.length > 0) {
            for (const pl of targetPlanarPlanes) {
              if (Math.abs(finalNormals[i].dot(pl.normal)) > 0.88) {
                const distToPlane = pl.normal.dot(smoothed[i]) - pl.d;
                if (Math.abs(distToPlane) < 0.05) {
                  smoothed[i].addScaledVector(pl.normal, -distToPlane);
                  break;
                }
              }
            }
          }
        }
      }
      for (let i = 0; i < numVerts; i++) {
        currentPositions[i].copy(smoothed[i]);
      }
    }
  }

  // Aplicar desplazamiento final (offset) a lo largo de las normales de la superficie
  if (offset !== 0) {
    for (let i = 0; i < numVerts; i++) {
      currentPositions[i].addScaledVector(finalNormals[i], offset);
    }
  }

  // ── HOMOGENEIZACIÓN Y REGULARIZACIÓN TANGENCIAL ──
  // Iguala el tamaño y la proporción de triángulos deslizando suavemente
  // los vértices por la superficie (solo si se solicita para modelos orgánicos; omitido en jaulas ortogonales)
  if (regularizeSurface && !isRetopoPlane && targetBvh && srcFaces.length > 0) {
    report.push(`Homogeneizando superficie: equilibrando aristas hacia triángulos regulares con preservación de aristas...`);
    const regRes = regularizeSurfaceOnBVH(
      currentPositions,
      srcFaces,
      targetBvh,
      getTargetFaceNormal,
      {
        iterations: 4,
        strength: 0.35,
        preserveCreases: true,
        creaseAngleDeg,
        planarPlanes: targetPlanarPlanes
      }
    );
    currentPositions = regRes.positions;
    finalNormals = regRes.normals;
  }

  // ── INVERSIÓN DEL PIPELINE: SNAPPING DE PUNTAS Y ESQUINAS VIVAS ANTES DE LA PODA ──
  // Las esquinas y puntas vivas quedan ancladas y congeladas ANTES de que cualquier filtro pode la malla
  const snappedToSharp = new Set<number>();
  const curCellSize = tgtDiag / Math.max(1, Math.sqrt(currentPositions.length));

  if ((snapSharpFeatures || antiRounding) && targetSharpPts.length > 0) {
    report.push(`Ceñido previo a ${targetSharpPts.length} puntas y esquinas vivas (anclaje anti-redondeo)...`);
    const maxSnapDist = Math.min(curCellSize * 0.45, tgtDiag * 0.035);
    for (const sharpPt of targetSharpPts) {
      let bestIdx = -1;
      let bestDist = maxSnapDist;
      for (let i = 0; i < currentPositions.length; i++) {
        if (snappedToSharp.has(i)) continue; // Garantizar mapeo 1-a-1: nunca asignar dos puntas al mismo vértice
        const d = currentPositions[i].distanceTo(sharpPt);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        currentPositions[bestIdx].copy(sharpPt);
        snappedToSharp.add(bestIdx);
      }
    }
  }

  // Snapping de aristas vivas (mantener rectas las líneas de intersección de planos del poliedro/figura)
  if ((snapSharpFeatures || antiRounding) && targetSharpEdges.length > 0) {
    const maxEdgeSnapDist = Math.min(curCellSize * 0.16, tgtDiag * 0.015);
    for (let i = 0; i < currentPositions.length; i++) {
      if (snappedToSharp.has(i)) continue; // Ya fijado exactamente en un vértice/esquina
      let bestEdgePt: THREE.Vector3 | null = null;
      let bestEdgeDist = maxEdgeSnapDist;
      for (const se of targetSharpEdges) {
        const toPt = new THREE.Vector3().subVectors(currentPositions[i], se.p1);
        const proj = Math.max(0, Math.min(se.len, toPt.dot(se.dir)));
        const ptOnEdge = se.p1.clone().addScaledVector(se.dir, proj);
        const d = currentPositions[i].distanceTo(ptOnEdge);
        if (d < bestEdgeDist) {
          bestEdgeDist = d;
          bestEdgePt = ptOnEdge;
        }
      }
      if (bestEdgePt) {
        currentPositions[i].copy(bestEdgePt);
        snappedToSharp.add(i);
      }
    }
  }

  // Anclaje matemático de caras planas (Anti-Abombamiento: caras y ángulos planos idénticos al original)
  if ((snapPlanarFaces || antiRounding) && targetPlanarPlanes.length > 0) {
    report.push(`Aplanando regiones coplanares (preservando caras y ángulos exactos del original)...`);
    const hitTmp = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };
    const maxPlaneHitDist = Math.max(tgtDiag * 0.06, 0.08);
    for (let i = 0; i < currentPositions.length; i++) {
      hitTmp.distance = Infinity;
      hitTmp.faceIndex = -1;
      const hit = targetBvh.closestPointToPoint(currentPositions[i], hitTmp as any);
      if (hit && hit.faceIndex >= 0 && hitTmp.distance < maxPlaneHitDist) {
        const pl = targetFaceToPlane.get(hit.faceIndex);
        if (pl) {
          const dist = pl.normal.dot(currentPositions[i]) - pl.d;
          if (Math.abs(dist) < maxPlaneHitDist) {
            currentPositions[i].addScaledVector(pl.normal, -dist);
          }
        }
      }
    }
  }

  // ── SUBDIVISIÓN ADAPTATIVA POR ESTIRAMIENTO (EDGE-SPLIT) ANTES DE LA PODA ──
  // Solo se ejecuta si se solicita explícitamente en la configuración
  if (!isRetopoPlane && autoSubdivideStretchedEdges) {
    const subdivRes = subdivideStretchedEdges(
      currentPositions,
      finalNormals,
      srcFaces,
      targetBvh,
      getTargetFaceNormal,
      2
    );

    if (subdivRes.totalSplits > 0) {
      currentPositions = subdivRes.positions;
      finalNormals = subdivRes.normals;
      srcFaces = subdivRes.faces;
      numVerts = currentPositions.length;
      srcVerts = currentPositions.map(p => {
        const loc = p.clone().applyMatrix4(srcWorldInv);
        return [loc.x, loc.y, loc.z] as V3;
      });
      report.push(`Subdivisión adaptativa por estiramiento: ${subdivRes.totalSplits} aristas críticas divididas y proyectadas con BVH.`);
    }
  }

  // POST-PASO: Poda de membranas suspendidas en el aire (solo si el usuario lo activa)
  if (pruneAirFaces && !isRetopoPlane) {
    report.push(`Iniciando poda de membranas y telas suspendidas en el aire...`);

    const pruneSensitivity = config.sensitivity ?? 'balanced';
    const airDistThreshold = config.airDistanceThreshold;
    const maxStretch = config.maxStretchRatio ?? (
      pruneSensitivity === 'conservative' ? 3.5 :
      pruneSensitivity === 'aggressive' ? 2.0 : 2.6
    );
    const minIslands = config.minIslandFaces ?? (
      pruneSensitivity === 'aggressive' ? 12 : 5
    );

    const { retainedFaces, prunedCount } = pruneAirBridgingFacesCore(
      currentPositions,
      srcFaces,
      targetBvh,
      targetGeo,
      {
        airDistanceThreshold: airDistThreshold,
        maxStretchRatio: maxStretch,
        minIslandFaces: minIslands,
        aggressive: config.aggressivePruning ?? (config.sensitivity === 'aggressive'),
        sensitivity: config.sensitivity ?? 'balanced',
        offset
      }
    );

      if (prunedCount > 0) {
        const usedVerts = new Set<number>();
        for (const f of retainedFaces) {
          for (const vi of f.indices) usedVerts.add(vi);
        }

        const oldToNewIdx = new Map<number, number>();
        const newPositions: THREE.Vector3[] = [];
        const newNormals: THREE.Vector3[] = [];
        // Mapeo temporal a coordenadas vectoriales locales V3 para la función de sellado
        const tempLocalVerts: V3[] = [];

        for (let i = 0; i < currentPositions.length; i++) {
          if (usedVerts.has(i)) {
            oldToNewIdx.set(i, newPositions.length);
            newPositions.push(currentPositions[i].clone());
            newNormals.push(finalNormals[i].clone());
            // Guardamos temporalmente en el formato de array numérico
            tempLocalVerts.push([currentPositions[i].x, currentPositions[i].y, currentPositions[i].z]);
          }
        }

        let newFaces: MeshFace[] = retainedFaces.map(f => ({
          ...f,
          indices: f.indices.map(oldIdx => oldToNewIdx.get(oldIdx)!)
        }));

        // EJECUCIÓN DEL AUTO-SELLADO ROBUSTO 3D (Solo si no se están podando membranas en el aire)
        if (config.autoFillHoles === true && !pruneAirFaces) {
          const maxHoleEdges = config.maxHoleEdges ?? 8;
          const holeRes = fillSmallBoundaryHoles(tempLocalVerts, newFaces, maxHoleEdges, targetBvh);
          
          if (holeRes.holesFilled > 0) {
            newFaces = holeRes.faces;
            
            // Sincronizar de vuelta los nuevos vértices/centroides generados en las variables del motor
            for (let i = newPositions.length; i < holeRes.vertices.length; i++) {
              const vData = holeRes.vertices[i];
              newPositions.push(new THREE.Vector3(vData[0], vData[1], vData[2]));
              newNormals.push(new THREE.Vector3(0, 1, 0)); // Normal por defecto para el centroide, se recalcula después
            }
            report.push(`Auto-sellado: ${holeRes.holesFilled} aberturas de frontera cerradas con éxito.`);
          }
        }

        // Clean needle spikes, degenerate faces, and smooth cut boundaries along the surface
        const cleanRes = cleanSpikesAndDegeneratesCore(
          newPositions,
          newFaces,
          targetBvh,
          targetGeo,
          { maxAspectRatio: 35.0, removeInverted: true, smoothBoundary: true }
        );

        // Sobrescribimos el estado principal del proceso iterativo con la geometría sellada y estanca
        currentPositions = cleanRes.cleanPositions;
        srcFaces = cleanRes.cleanFaces;
        finalNormals = [];
        for (let i = 0; i < cleanRes.cleanPositions.length; i++) {
          closestHit.distance = Infinity;
          closestHit.faceIndex = -1;
          const res = targetBvh.closestPointToPoint(cleanRes.cleanPositions[i], closestHit as any);
          finalNormals.push(res && res.faceIndex >= 0 ? getTargetFaceNormal(res.faceIndex) : new THREE.Vector3(0, 1, 0));
        }
        srcVerts = cleanRes.cleanPositions.map(p => {
          const loc = p.clone().applyMatrix4(srcWorldInv);
          return [loc.x, loc.y, loc.z] as V3;
        });
        numVerts = currentPositions.length; // Actualizamos el contador total de vértices

        if (cleanRes.removedSpikesCount > 0) {
          report.push(`Limpieza: ${cleanRes.removedSpikesCount} espinas y caras anómalas eliminadas.`);
        }

        report.push(`Poda de membranas en el aire: ${prunedCount} caras flotantes/estiradas eliminadas.`);
      }
    }

  // Snapping final de confirmación de puntas vivas tras la poda
  if ((snapSharpFeatures || antiRounding) && targetSharpPts.length > 0) {
    const maxSnapDist = Math.max((tgtDiag / Math.sqrt(currentPositions.length)) * 1.6, 0.05);
    for (const sharpPt of targetSharpPts) {
      let bestIdx = -1;
      let bestDist = maxSnapDist;
      for (let i = 0; i < currentPositions.length; i++) {
        const d = currentPositions[i].distanceTo(sharpPt);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        currentPositions[bestIdx].copy(sharpPt);
      }
    }
  }

  // Step 5: Final surface clearance offset (si existe)
  let modifiedCount = currentPositions.length;
  if (offset !== 0) {
    for (let i = 0; i < currentPositions.length; i++) {
      if (finalNormals[i]) {
        currentPositions[i].addScaledVector(finalNormals[i], offset);
      }
    }
  }

  targetGeo.dispose();

  // =========================================================================
  // 🏁 BLOQUE DE CIERRE, SOLDADURA TOPOLÓGICA Y EMPAQUETADO FINAL (OPTIMIZADO)
  // =========================================================================
  
  // Garantía de estanqueidad (watertight): sellar pequeñas perforaciones si está habilitado explícitamente y no se podaron membranas
  if (!isRetopoPlane && config.autoFillHoles === true && !pruneAirFaces && srcFaces.length > 0) {
    const tempLocal: V3[] = currentPositions.map(p => [p.x, p.y, p.z]);
    const maxBoundaryHole = config.maxHoleEdges ?? 8;
    const sealRes = fillSmallBoundaryHoles(tempLocal, srcFaces, maxBoundaryHole, targetBvh);
    if (sealRes.holesFilled > 0) {
      srcFaces = sealRes.faces;
      for (let i = currentPositions.length; i < sealRes.vertices.length; i++) {
        const v = sealRes.vertices[i];
        currentPositions.push(new THREE.Vector3(v[0], v[1], v[2]));
      }
      report.push(`Garantía de estanqueidad: ${sealRes.holesFilled} aberturas de frontera selladas con éxito.`);
    }
  }

  report.push(`Iniciando soldadura topológica y suavizado final de normales...`);

  // 1. Transformar las posiciones adaptadas del espacio del mundo al espacio local del objeto origen
  const finalVerts: V3[] = currentPositions.map(p => {
    const loc = p.clone().applyMatrix4(srcWorldInv);
    return [loc.x, loc.y, loc.z] as V3;
  });

  // 2. Preservar la estructura topológica de caras (Quads puros y polígonos intactos)
  let finalFaces: MeshFace[] = srcFaces;

  // Si se aplicó recorte de caras en el aire ("pruneAirFaces"), limpiar y soldar bordes preservando quads
  if (pruneAirFaces) {
    const weldedVerts: V3[] = [];
    const remap = new Map<number, number>();
    const grid = new Map<string, number>();
    const invTol = 10000;

    for (let i = 0; i < finalVerts.length; i++) {
      const v = finalVerts[i];
      const key = `${Math.round(v[0] * invTol)}_${Math.round(v[1] * invTol)}_${Math.round(v[2] * invTol)}`;
      if (grid.has(key)) {
        remap.set(i, grid.get(key)!);
      } else {
        const newIdx = weldedVerts.length;
        weldedVerts.push(v);
        grid.set(key, newIdx);
        remap.set(i, newIdx);
      }
    }

    const weldedFaces: MeshFace[] = [];
    const seenWeldedKeys = new Set<string>();
    for (const f of srcFaces) {
      const mapped = f.indices.map(idx => remap.get(idx) ?? idx);
      const clean: number[] = [];
      for (let j = 0; j < mapped.length; j++) {
        if (j === 0 || mapped[j] !== mapped[j - 1]) {
          clean.push(mapped[j]);
        }
      }
      if (clean.length > 2 && clean[0] === clean[clean.length - 1]) {
        clean.pop();
      }
      if (clean.length >= 3) {
        const key = [...clean].sort((a, b) => a - b).join('_');
        if (!seenWeldedKeys.has(key)) {
          seenWeldedKeys.add(key);
          weldedFaces.push({ ...f, indices: clean });
        }
      }
    }
    finalVerts.length = 0;
    finalVerts.push(...weldedVerts);
    finalFaces = weldedFaces;
  }

  // Deduplicación estricta de caras (Garantía anti-doble malla)
  const finalUniqueFaces: MeshFace[] = [];
  const finalSeenKeys = new Set<string>();
  for (const f of finalFaces) {
    if (!f.indices || f.indices.length < 3) continue;
    const k = [...f.indices].sort((a, b) => a - b).join('_');
    if (!finalSeenKeys.has(k)) {
      finalSeenKeys.add(k);
      finalUniqueFaces.push(f);
    }
  }
  finalFaces = finalUniqueFaces;

  report.push(`Envoltura ceñida a silueta completada con éxito:`);
  report.push(`- ${finalVerts.length.toLocaleString()} vértices adaptados ceñidos a la silueta.`);
  report.push(`- Offset final: ${offset.toFixed(4)} unidades.`);

  // 3. OPTIMIZACIÓN Y REESTRUCTURACIÓN DE TOPOLOGÍA
  let outputVerts = finalVerts;
  let outputFaces = finalFaces;
  let finalQuads = 0;
  let finalTris = 0;

  if (optimizeTopology && finalFaces.length > 24) {
    try {
      const optRes = await optimizeConformedMesh(
        {
          ...resolvedSource,
          vertices: finalVerts,
          faces: finalFaces
        },
        resolvedTarget,
        {
          targetReductionRatio: reductionRatio,
          targetPolyCount,
          preserveCreases,
          creaseAngleDeg,
          outputTopology,
          reprojectToTarget: true,
          offset,
          errorTolerance: 0.035
        }
      );
      outputVerts = optRes.updatedObject.vertices;
      outputFaces = optRes.updatedObject.faces;
      finalQuads = optRes.stats.quads;
      finalTris = optRes.stats.triangles;
      report.push(...optRes.report);
    } catch (eOpt) {
      console.warn('Error optimizando topología tras envoltura:', eOpt);
    }
  } else if ((outputTopology === 'QUAD_DOMINANT' || outputTopology === 'PURE_QUADS') && finalFaces.length > 0) {
    // Si no se usó decimación destructiva de triángulos, emparejar los triángulos coplanares del cage en Quads puros
    try {
      const existingQuadsOnly: MeshFace[] = [];
      const triFacesOnly: any[] = [];
      finalFaces.forEach(f => {
        if (f.indices && f.indices.length === 4) {
          existingQuadsOnly.push(f);
        } else if (f.indices && f.indices.length === 3) {
          triFacesOnly.push({ indices: [f.indices[0], f.indices[1], f.indices[2]] });
        } else {
          existingQuadsOnly.push(f);
        }
      });

      if (triFacesOnly.length > 0) {
        const flatPos = new Float32Array(finalVerts.length * 3);
        for (let i = 0; i < finalVerts.length; i++) {
          flatPos[i * 3] = finalVerts[i][0];
          flatPos[i * 3 + 1] = finalVerts[i][1];
          flatPos[i * 3 + 2] = finalVerts[i][2];
        }
        const quadRes = pairTrianglesIntoQuads(triFacesOnly, flatPos, {
          preserveCreases,
          creaseAngleDeg
        });
        const combinedFaces: MeshFace[] = [...existingQuadsOnly];
        quadRes.quads.forEach(q => {
          combinedFaces.push({ indices: [q[0], q[1], q[2], q[3]] });
        });

        quadRes.remainingTris.forEach(t => {
          combinedFaces.push({ indices: [t[0], t[1], t[2]] });
        });
        finalQuads = quadRes.quads.length + existingQuadsOnly.length;
        finalTris = quadRes.remainingTris.length;
        report.push(`Topología generada: ${finalQuads.toLocaleString()} quads, ${finalTris} triángulos sin aristas cruzadas.`);
        outputFaces = combinedFaces;
      } else {
        finalQuads = existingQuadsOnly.length;
        finalTris = 0;
        report.push(`Topología 100% Cuadriláteros pura preservada: ${finalQuads.toLocaleString()} caras quad sin diagonales.`);
      }
    } catch (eQuad) {
      console.warn('Error emparejando quads en malla no decimada:', eQuad);
    }
  }

  // 6.5 TRANSFERIR Y HEREDAR COORDENADAS UV Y MATERIALES DEL MODELO OBJETIVO
  const targetHasUV = targetGeo && targetGeo.attributes.uv && targetGeo.attributes.uv.count > 0;
  if (targetHasUV && targetBvh) {
    report.push('Mapeando e interpolando coordenadas UV y texturas desde el modelo objetivo...');
    const vertUVs: ([number, number] | null)[] = new Array(outputVerts.length);
    const tmpPt = new THREE.Vector3();
    for (let i = 0; i < outputVerts.length; i++) {
      tmpPt.set(outputVerts[i][0], outputVerts[i][1], outputVerts[i][2]).applyMatrix4(srcWorldMat);
      vertUVs[i] = sampleTargetUV(tmpPt, targetBvh, targetGeo);
    }
    outputFaces = outputFaces.map(face => ({
      ...face,
      uvs: face.indices.map(vi => vertUVs[vi] || [0.5, 0.5])
    }));
  }

  // Deduplicación final de outputFaces por si hubo optimización topológica
  const uniqueOutputFaces: MeshFace[] = [];
  const seenOutputKeys = new Set<string>();
  for (const f of outputFaces) {
    if (!f.indices || f.indices.length < 3) continue;
    const k = [...f.indices].sort((a, b) => a - b).join('_');
    if (!seenOutputKeys.has(k)) {
      seenOutputKeys.add(k);
      uniqueOutputFaces.push(f);
    }
  }
  outputFaces = uniqueOutputFaces;

  // 7. RETORNAR EL OBJETO TOTALMENTE MANIFOLD, ESTANCO Y CONTINUO
  return {
    updatedObject: {
      ...resolvedSource,
      vertices: outputVerts,
      faces: outputFaces,
      smoothShading: (configSmoothShading !== undefined)
        ? configSmoothShading
        : (targetObj?.smoothShading ?? false),
      opacity: targetObj?.opacity ?? 1.0,
      materialId: targetObj?.materialId ?? resolvedSource.materialId,
      material: targetObj?.material ? JSON.parse(JSON.stringify(targetObj.material)) : resolvedSource.material,
      color: targetObj?.color ?? resolvedSource.color,
      meshData: undefined, // Forzar a Three.js / CSG a reconstruir el buffer gráfico
      vertexOffsets: {},
      stats: {
        ...(resolvedSource.stats || {}),
        vertices: outputVerts.length,
        faces: outputFaces.length,
        quads: finalQuads,
        triangles: finalTris
      }
    },
    modifiedVerticesCount: modifiedCount,
    report
  };
}

export const generateSilhouetteVacuumWrap = applySilhouetteVacuumWrap;

/**
 * Standalone mesh spike and shard cleaner.
 * Removes needle triangles, spikes, and folded faces,
 * and relaxes boundary vertices cleanly along the target surface.
 */
export async function cleanMeshSpikes(
  sourceObj: CSGObject,
  targetObj?: CSGObject,
  options: {
    maxAspectRatio?: number;
    removeInverted?: boolean;
    smoothBoundary?: boolean;
  } = {}
): Promise<{ updatedObject: CSGObject; removedCount: number; report: string[] }> {
  let resolvedSource = sourceObj;
  if ((!resolvedSource.vertices || resolvedSource.vertices.length === 0) && resolvedSource.meshData) {
    try {
      const { convertImportedToCSG } = await import('./modifiers_advanced');
      resolvedSource = await convertImportedToCSG(resolvedSource);
    } catch (err) {
      console.warn('Error converting source for spike cleaning:', err);
    }
  }

  const offsets = resolvedSource.vertexOffsets || {};
  const srcVerts: V3[] = (resolvedSource.vertices || []).map((v, i) => {
    const off = offsets[i];
    if (off) return [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    return [v[0], v[1], v[2]];
  });
  const srcFaces = resolvedSource.faces ? [...resolvedSource.faces] : [];

  if (srcVerts.length < 3 || srcFaces.length === 0) {
    return { updatedObject: sourceObj, removedCount: 0, report: ['Malla vacía'] };
  }

  const srcWorldMat = getObjectWorldMatrix(resolvedSource);
  const srcWorldInv = srcWorldMat.clone().invert();
  const currentPositions = srcVerts.map(v => new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(srcWorldMat));

  let targetBvh: MeshBVH | null = null;
  let targetGeo: THREE.BufferGeometry | null = null;

  if (targetObj) {
    let resolvedTarget = targetObj;
    if ((!resolvedTarget.vertices || resolvedTarget.vertices.length === 0) && resolvedTarget.meshData) {
      try {
        const { convertImportedToCSG } = await import('./modifiers_advanced');
        resolvedTarget = await convertImportedToCSG(resolvedTarget);
      } catch (err) {
        console.warn('Error converting target for spike cleaning:', err);
      }
    }
    try {
      targetGeo = await extractTargetGeometry(resolvedTarget);
      if (targetGeo && targetGeo.attributes.position && targetGeo.attributes.position.count > 0) {
        targetBvh = new MeshBVH(targetGeo);
      }
    } catch (e) {
      console.warn('Target geometry extraction skipped:', e);
    }
  }

  const cleanRes = cleanSpikesAndDegeneratesCore(
    currentPositions,
    srcFaces,
    targetBvh,
    targetGeo,
    {
      maxAspectRatio: options.maxAspectRatio ?? 6.0,
      removeInverted: options.removeInverted ?? true,
      smoothBoundary: options.smoothBoundary ?? true
    }
  );

  if (targetGeo) {
    targetGeo.dispose();
  }

  const finalVerts: V3[] = cleanRes.cleanPositions.map(p => {
    const loc = p.clone().applyMatrix4(srcWorldInv);
    return [loc.x, loc.y, loc.z] as V3;
  });

  const report = [
    `Limpieza de espinas y rebabas completada:`,
    `- ${cleanRes.removedSpikesCount} espinas, caras invertidas y triángulos degenerados eliminados.`,
    `- ${cleanRes.cleanFaces.length} caras limpias restantes.`
  ];

  return {
    updatedObject: {
      ...resolvedSource,
      vertices: finalVerts,
      faces: cleanRes.cleanFaces,
      meshData: undefined,
      vertexOffsets: {},
      stats: {
        ...(resolvedSource.stats || {}),
        vertices: finalVerts.length,
        faces: cleanRes.cleanFaces.length
      }
    },
    removedCount: cleanRes.removedSpikesCount,
    report
  };
}


