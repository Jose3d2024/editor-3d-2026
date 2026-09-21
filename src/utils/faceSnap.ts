/**
 * faceSnap.ts — Face Snapping & Surface Projection Utilities for Retopology
 *
 * Implements real-time magnet snapping to high-poly surfaces:
 * - Project Individual Elements: Snaps each moved vertex to the face directly underneath
 * - Offset: Offsets along surface normal to eliminate Z-fighting
 * - BVH & Raycast surface detection with visual feedback
 */

import * as THREE from 'three';
import { CSGObject } from '../types';

export interface FaceSnapHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  object: THREE.Object3D;
  faceIndex?: number;
}

export interface SnapVertexResult {
  snappedPoint: THREE.Vector3;
  normal: THREE.Vector3;
  hit: boolean;
}

/**
 * Snaps a single candidate world point onto target meshes with multi-directional surface raycasting
 */
export function snapPointToSurfaces(
  candidateWorldPos: THREE.Vector3,
  targetMeshes: THREE.Object3D[],
  camera?: THREE.Camera,
  offset: number = 0.002
): SnapVertexResult {
  if (!targetMeshes || targetMeshes.length === 0) {
    return { snappedPoint: candidateWorldPos.clone(), normal: new THREE.Vector3(0, 1, 0), hit: false };
  }

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  let bestHit: FaceSnapHit | null = null;
  let minDistance = Infinity;

  // 1. Raycast from camera through candidate position (if camera provided)
  if (camera) {
    const rayDir = candidateWorldPos.clone().sub(camera.position).normalize();
    raycaster.set(camera.position, rayDir);

    const intersects = raycaster.intersectObjects(targetMeshes, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      const normal = hit.face
        ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
        : new THREE.Vector3(0, 1, 0);

      const dist = hit.point.distanceTo(candidateWorldPos);
      bestHit = {
        point: hit.point.clone(),
        normal,
        distance: dist,
        object: hit.object,
        faceIndex: hit.faceIndex
      };
      minDistance = dist;
    }
  }

  // 2. Multi-directional probing from candidateWorldPos to catch surfaces in all directions:
  // Down (-Y), Up (+Y), Left (-X), Right (+X), Back (-Z), Forward (+Z), and towards target centers
  const probeDirs: THREE.Vector3[] = [
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 1)
  ];

  // Also add directions towards centers of target meshes
  for (const tm of targetMeshes) {
    const tmWorldPos = new THREE.Vector3();
    tm.getWorldPosition(tmWorldPos);
    const toCenter = tmWorldPos.clone().sub(candidateWorldPos);
    if (toCenter.lengthSq() > 0.0001) {
      probeDirs.push(toCenter.normalize());
    }
  }

  for (const dir of probeDirs) {
    // Cast from a small offset backwards to catch intersecting or surface-embedded candidates
    const origin = candidateWorldPos.clone().addScaledVector(dir, -0.5);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(targetMeshes, true);
    if (hits.length > 0) {
      const hit = hits[0];
      const dist = hit.point.distanceTo(candidateWorldPos);
      if (dist < minDistance || !bestHit) {
        const normal = hit.face
          ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
          : new THREE.Vector3(0, 1, 0);

        bestHit = {
          point: hit.point.clone(),
          normal,
          distance: dist,
          object: hit.object,
          faceIndex: hit.faceIndex
        };
        minDistance = dist;
      }
    }
  }

  if (bestHit) {
    const snapped = bestHit.point.clone();
    if (offset !== 0) {
      snapped.addScaledVector(bestHit.normal, offset);
    }
    return {
      snappedPoint: snapped,
      normal: bestHit.normal,
      hit: true
    };
  }

  return { snappedPoint: candidateWorldPos.clone(), normal: new THREE.Vector3(0, 1, 0), hit: false };
}

/**
 * Projects multiple vertices onto surface faces.
 * If projectIndividualElements is true, each vertex is snapped to the face directly underneath it.
 * If false, the cluster is translated rigidly based on the centroid's snap.
 */
export function projectVerticesToFaces(
  verticesWithOffsets: { index: number; candidateWorldPos: THREE.Vector3; baseLocalPos: THREE.Vector3 }[],
  targetMeshes: THREE.Object3D[],
  meshMatrixWorld: THREE.Matrix4,
  camera: THREE.Camera,
  options: {
    projectIndividualElements: boolean;
    offset: number;
  }
): {
  updates: { index: number; offset: [number, number, number] }[];
  snapIndicators: { point: THREE.Vector3; normal: THREE.Vector3 }[];
} {
  const invMatrixWorld = meshMatrixWorld.clone().invert();
  const snapIndicators: { point: THREE.Vector3; normal: THREE.Vector3 }[] = [];

  if (options.projectIndividualElements) {
    // ── PROYECTAR ELEMENTOS INDIVIDUALES: Cada vértice se ajusta a la cara debajo ──
    const updates = verticesWithOffsets.map(({ index, candidateWorldPos, baseLocalPos }) => {
      const snapRes = snapPointToSurfaces(candidateWorldPos, targetMeshes, camera, options.offset);
      
      let finalWorldPos = candidateWorldPos;
      if (snapRes.hit) {
        finalWorldPos = snapRes.snappedPoint;
        snapIndicators.push({ point: snapRes.snappedPoint.clone(), normal: snapRes.normal.clone() });
      }

      const finalLocalPos = finalWorldPos.clone().applyMatrix4(invMatrixWorld);
      return {
        index,
        offset: [
          finalLocalPos.x - baseLocalPos.x,
          finalLocalPos.y - baseLocalPos.y,
          finalLocalPos.z - baseLocalPos.z
        ] as [number, number, number]
      };
    });

    return { updates, snapIndicators };
  } else {
    // ── MODO RÍGIDO: Se calcula el snap del centroide y se aplica el mismo delta a todos ──
    const centroid = new THREE.Vector3();
    for (const v of verticesWithOffsets) {
      centroid.add(v.candidateWorldPos);
    }
    if (verticesWithOffsets.length > 0) {
      centroid.divideScalar(verticesWithOffsets.length);
    }

    const snapRes = snapPointToSurfaces(centroid, targetMeshes, camera, options.offset);
    const deltaWorld = snapRes.hit ? snapRes.snappedPoint.clone().sub(centroid) : new THREE.Vector3(0, 0, 0);

    if (snapRes.hit) {
      snapIndicators.push({ point: snapRes.snappedPoint.clone(), normal: snapRes.normal.clone() });
    }

    const updates = verticesWithOffsets.map(({ index, candidateWorldPos, baseLocalPos }) => {
      const finalWorldPos = candidateWorldPos.clone().add(deltaWorld);
      const finalLocalPos = finalWorldPos.applyMatrix4(invMatrixWorld);
      return {
        index,
        offset: [
          finalLocalPos.x - baseLocalPos.x,
          finalLocalPos.y - baseLocalPos.y,
          finalLocalPos.z - baseLocalPos.z
        ] as [number, number, number]
      };
    });

    return { updates, snapIndicators };
  }
}

/**
 * Aligns an object's rotation with the surface normal of a face (Blender Face Snapping - Align Rotation to Target)
 * Properly calculates full 3D Euler angles with support for configurable attachment axis.
 */
export function alignObjectRotationToNormal(
  currentRotation: [number, number, number],
  surfaceNormal: THREE.Vector3,
  alignmentAxis: '+Y' | '-Y' | '+Z' | '-Z' | '+X' | '-X' = '+Y'
): [number, number, number] {
  const targetNormal = surfaceNormal.clone().normalize();
  if (targetNormal.lengthSq() < 0.0001) return currentRotation;

  // Local direction vector of the accessory that will align with the surface normal
  const localAxis = new THREE.Vector3(0, 1, 0); // default +Y
  if (alignmentAxis === '-Y') localAxis.set(0, -1, 0);
  else if (alignmentAxis === '+Z') localAxis.set(0, 0, 1);
  else if (alignmentAxis === '-Z') localAxis.set(0, 0, -1);
  else if (alignmentAxis === '+X') localAxis.set(1, 0, 0);
  else if (alignmentAxis === '-X') localAxis.set(-1, 0, 0);

  // If localAxis and targetNormal are antiparallel:
  if (localAxis.dot(targetNormal) < -0.9999) {
    // Find an orthogonal axis to rotate 180 degrees
    const ortho = Math.abs(localAxis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(localAxis, ortho).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI);
    const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return [euler.x, euler.y, euler.z];
  }

  // If already parallel
  if (localAxis.dot(targetNormal) > 0.9999) {
    return [0, currentRotation[1], 0];
  }

  const q = new THREE.Quaternion().setFromUnitVectors(localAxis, targetNormal);
  const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [euler.x, euler.y, euler.z];
}

/**
 * Calculates distance from object's pivot/center to its base along the alignment axis,
 * ensuring the accessory sits on top of the surface rather than having 50% sinking into the mesh.
 */
export function getObjectBaseExtentAlongNormal(
  obj: CSGObject,
  surfaceNormal: THREE.Vector3,
  alignmentAxis: '+Y' | '-Y' | '+Z' | '-Z' | '+X' | '-X' = '+Y'
): number {
  const scale = obj.transform?.scale || [1, 1, 1];

  if (obj.vertices && obj.vertices.length > 0) {
    if (alignmentAxis === '+Y') {
      let minY = Infinity;
      for (const v of obj.vertices) {
        if (v[1] < minY) minY = v[1];
      }
      return minY !== Infinity ? Math.abs(minY) * scale[1] : 0.5 * scale[1];
    } else if (alignmentAxis === '-Y') {
      let maxY = -Infinity;
      for (const v of obj.vertices) {
        if (v[1] > maxY) maxY = v[1];
      }
      return maxY !== -Infinity ? Math.abs(maxY) * scale[1] : 0.5 * scale[1];
    } else if (alignmentAxis === '+Z') {
      let minZ = Infinity;
      for (const v of obj.vertices) {
        if (v[2] < minZ) minZ = v[2];
      }
      return minZ !== Infinity ? Math.abs(minZ) * scale[2] : 0.5 * scale[2];
    } else if (alignmentAxis === '-Z') {
      let maxZ = -Infinity;
      for (const v of obj.vertices) {
        if (v[2] > maxZ) maxZ = v[2];
      }
      return maxZ !== -Infinity ? Math.abs(maxZ) * scale[2] : 0.5 * scale[2];
    } else if (alignmentAxis === '+X') {
      let minX = Infinity;
      for (const v of obj.vertices) {
        if (v[0] < minX) minX = v[0];
      }
      return minX !== Infinity ? Math.abs(minX) * scale[0] : 0.5 * scale[0];
    } else if (alignmentAxis === '-X') {
      let maxX = -Infinity;
      for (const v of obj.vertices) {
        if (v[0] > maxX) maxX = v[0];
      }
      return maxX !== -Infinity ? Math.abs(maxX) * scale[0] : 0.5 * scale[0];
    }
  }

  // Fallback approximation using scale
  return 0.5 * scale[1];
}
