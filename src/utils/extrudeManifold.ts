import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import type { CSGObject, MeshFace, V3 } from '../types';
import { healMesh } from './manifoldUtils';
import { fromThreeGeometry } from './modifiers';
import { prepareMeshForCSG } from './booleanOperations';

function computePolygonNormal(pts: V3[]): V3 {
  if (pts.length < 3) return [0, 1, 0];
  const p0 = pts[0], p1 = pts[1], p2 = pts[2];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export interface ExtrudeManifoldResult {
  success: boolean;
  message: string;
  newObj?: CSGObject;
  selectedVertexIndices?: number[];
}

/**
 * Extrude Manifold (Blender-style Alt+E > Extrude Manifold).
 * Automatically cleans up overlapping geometry, dissolves internal faces,
 * punches through-holes when pushed through solids, and keeps the mesh manifold and watertight.
 */
export async function executeExtrudeManifold(
  obj: CSGObject,
  faceIndices: number[],
  distance: number,
  options?: {
    autoHeal?: boolean;
    dissolveCoplanars?: boolean;
  }
): Promise<ExtrudeManifoldResult> {
  const { autoHeal = true } = options || {};

  if (!obj.faces || obj.faces.length === 0 || !obj.vertices || obj.vertices.length === 0) {
    return { success: false, message: 'La malla no contiene caras válidas para extruir.' };
  }

  if (!faceIndices || faceIndices.length === 0) {
    return { success: false, message: 'Selecciona al menos una cara para la extrusión Manifold.' };
  }

  try {
    // 1. Calculate the average normal of selected faces in local space
    let avgNormal: V3 = [0, 0, 0];
    const selectedFaceData: Array<{ indices: number[]; points: V3[] }> = [];

    faceIndices.forEach(fIdx => {
      const face = obj.faces[fIdx];
      if (!face) return;
      const pts: V3[] = face.indices.map(vIdx => {
        const base = obj.vertices[vIdx];
        const off = obj.vertexOffsets?.[vIdx] ?? [0, 0, 0];
        return [base[0] + off[0], base[1] + off[1], base[2] + off[2]] as V3;
      });
      selectedFaceData.push({ indices: face.indices, points: pts });

      if (pts.length >= 3) {
        const n = computePolygonNormal(pts);
        avgNormal[0] += n[0];
        avgNormal[1] += n[1];
        avgNormal[2] += n[2];
      }
    });

    const mag = Math.hypot(avgNormal[0], avgNormal[1], avgNormal[2]) || 1;
    avgNormal = [avgNormal[0] / mag, avgNormal[1] / mag, avgNormal[2] / mag];

    // 2. Prepare the base mesh for solid CSG/Manifold operations
    const { mesh: baseMesh } = await prepareMeshForCSG(obj);
    const baseCSG = CSG.fromMesh(baseMesh);

    // 3. Build the extrusion volume tool from selected faces
    // We create a solid prism for each selected face (or group of faces)
    const toolGeometries: THREE.BufferGeometry[] = [];

    selectedFaceData.forEach(item => {
      const poly = item.points;
      const k = poly.length;
      if (k < 3) return;

      const extrusionVec = new THREE.Vector3(
        avgNormal[0] * distance,
        avgNormal[1] * distance,
        avgNormal[2] * distance
      );

      // Create bottom and top polygon points
      // In local coordinates relative to the object's transform
      const bottomPoints: THREE.Vector3[] = poly.map(p => new THREE.Vector3(p[0], p[1], p[2]));
      const topPoints: THREE.Vector3[] = bottomPoints.map(p => p.clone().add(extrusionVec));

      // Build indexed prism geometry
      const prismPositions: number[] = [];
      const prismIndices: number[] = [];

      // Base vertices: 0 .. k-1
      bottomPoints.forEach(p => prismPositions.push(p.x, p.y, p.z));
      // Top vertices: k .. 2k-1
      topPoints.forEach(p => prismPositions.push(p.x, p.y, p.z));

      // Bottom face triangulation (fan)
      for (let i = 1; i < k - 1; i++) {
        if (distance >= 0) {
          prismIndices.push(0, i + 1, i);
        } else {
          prismIndices.push(0, i, i + 1);
        }
      }

      // Top face triangulation (fan)
      for (let i = 1; i < k - 1; i++) {
        if (distance >= 0) {
          prismIndices.push(k, k + i, k + i + 1);
        } else {
          prismIndices.push(k, k + i + 1, k + i);
        }
      }

      // Side wall quads -> 2 triangles each
      for (let i = 0; i < k; i++) {
        const bA = i;
        const bB = (i + 1) % k;
        const tA = k + i;
        const tB = k + ((i + 1) % k);

        if (distance >= 0) {
          prismIndices.push(bA, bB, tB);
          prismIndices.push(bA, tB, tA);
        } else {
          prismIndices.push(bA, tB, bB);
          prismIndices.push(bA, tA, tB);
        }
      }

      const prismGeo = new THREE.BufferGeometry();
      prismGeo.setAttribute('position', new THREE.Float32BufferAttribute(prismPositions, 3));
      prismGeo.setIndex(prismIndices);
      prismGeo.computeVertexNormals();

      // Transform prism to world coordinates matching the object
      prismGeo.applyMatrix4(baseMesh.matrixWorld);
      toolGeometries.push(prismGeo.toNonIndexed());
    });

    if (toolGeometries.length === 0) {
      return { success: false, message: 'No se pudo generar el prisma de extrusión.' };
    }

    // Merge tool geometries into a single tool mesh
    let mergedToolGeo = toolGeometries[0];
    if (toolGeometries.length > 1) {
      const allPos: number[] = [];
      toolGeometries.forEach(g => {
        const posAttr = g.getAttribute('position');
        for (let i = 0; i < posAttr.count * 3; i++) {
          allPos.push(posAttr.array[i]);
        }
      });
      mergedToolGeo = new THREE.BufferGeometry();
      mergedToolGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    }

    const toolMesh = new THREE.Mesh(
      mergedToolGeo,
      new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' })
    );
    toolMesh.updateMatrixWorld(true);

    const toolCSG = CSG.fromMesh(toolMesh);

    // 4. Perform Manifold Operation:
    // If distance < 0 (pushing inward): boolean difference (subtract cutting prism)
    // If distance > 0 (pulling outward): boolean union (fuse and dissolve internal boundaries)
    let resultCSG: any;
    if (distance < 0) {
      resultCSG = baseCSG.subtract(toolCSG);
    } else {
      resultCSG = baseCSG.union(toolCSG);
    }

    if (!resultCSG) {
      return { success: false, message: 'Error en la operación de cálculo Manifold.' };
    }

    const resultMesh = CSG.toMesh(resultCSG, new THREE.Matrix4(), baseMesh.material);
    let geomData = fromThreeGeometry(resultMesh.geometry);

    // 5. Heal mesh with Manifold module to guarantee clean manifold topology
    if (autoHeal && geomData.vertices.length > 0) {
      try {
        const healed = await healMesh(geomData.vertices, geomData.faces);
        if (healed && healed.vertices.length > 0) {
          geomData = healed;
        }
      } catch (err) {
        console.warn('ExtrudeManifold healMesh warning:', err);
      }
    }

    // Recalculate local coordinates relative to object origin
    const invMat = baseMesh.matrixWorld.clone().invert();
    const finalLocalVerts: V3[] = geomData.vertices.map(([x, y, z]) => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(invMat);
      return [v.x, v.y, v.z] as V3;
    });

    const newObj: CSGObject = {
      ...obj,
      type: 'MESH',
      vertices: finalLocalVerts,
      faces: geomData.faces,
      vertexOffsets: {},
      meshData: undefined,
      nurbsSurface: undefined,
      stats: {
        vertices: finalLocalVerts.length,
        faces: geomData.faces.length,
      },
    };

    delete newObj.wireframeEdges;
    delete (newObj as any).parameters?.wireframeEdges;

    return {
      success: true,
      message: `Extrusión Manifold aplicada con éxito (${distance < 0 ? 'Corte/Cavidad Manifold' : 'Unión Manifold limpia'}).`,
      newObj,
    };
  } catch (error: any) {
    console.error('Error executing extrude manifold:', error);
    return {
      success: false,
      message: `Error al calcular la Extrusión Manifold: ${error?.message || String(error)}`,
    };
  }
}
