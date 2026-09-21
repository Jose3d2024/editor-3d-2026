import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSG } from 'three-csg-ts';
import { CSGObject, V3, MeshFace } from '../types';
import { healMesh } from './manifoldUtils';
import { fromThreeGeometry } from './modifiers';
import { createBaseGeometry, applyVertexOffsets } from './csg';
import { convertImportedToCSG } from './modifiers_advanced';
import { tessellateNurbsSurface } from './nurbs';

export type UnifiedBooleanOp = 
  | 'UNION'            // A + B
  | 'DIFFERENCE_AB'     // A - B (Resta B de A)
  | 'DIFFERENCE_BA'     // B - A (Resta A de B)
  | 'INTERSECTION'      // A ∩ B
  | 'SPLIT';           // Divide A con B en dos piezas (A-B y A∩B)

export interface BooleanExecuteOptions {
  targetId: string;
  toolId: string;
  operation: UnifiedBooleanOp;
  keepTool?: boolean;
  autoHeal?: boolean;
  recenterPivot?: boolean;
  weldTolerance?: number;
}

export interface BooleanResult {
  success: boolean;
  message: string;
  resultTarget?: CSGObject;
  resultSplitPiece?: CSGObject;
  removedObjectIds?: string[];
  stats?: {
    originalVerticesA: number;
    originalVerticesB: number;
    resultVertices: number;
    resultFaces: number;
  };
}

/**
 * Limpia y sanea una geometría para garantizar que sea apta para CSG sin colapsos de árbol BSP
 */
export function cleanGeometryForCSG(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let cleanGeo = geo.clone();
  
  // Asegurar que no tenga NaNs o infinitos en las posiciones
  const posAttr = cleanGeo.getAttribute('position');
  if (posAttr) {
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i]) || isNaN(arr[i])) {
        arr[i] = 0;
      }
    }
    posAttr.needsUpdate = true;
  }

  // Asegurar que tenga normales bien calculadas
  cleanGeo.computeVertexNormals();
  return cleanGeo;
}

/**
 * Prepara cualquier objeto (primitiva, NURBS, malla importada GLTF/STL/OBJ, paramétrico)
 * para convertirlo en una malla Three.js no indexada en coordenadas mundiales lista para CSG.
 */
export async function prepareMeshForCSG(rawObj: CSGObject): Promise<{ mesh: THREE.Mesh; cleanObj: CSGObject }> {
  let obj = { ...rawObj };

  // 1. Si es archivo importado (gltf/obj/stl)
  if (obj.meshData) {
    try {
      obj = await convertImportedToCSG(obj);
    } catch (e) {
      console.warn('Error converting imported mesh for CSG:', e);
    }
  }

  // 2. Si es una superficie NURBS, aseguramos que tenga geometría poligonizada actualizada
  if (obj.nurbsSurface) {
    try {
      const resU = (obj.parameters?.nurbsResolutionU as number) || 16;
      const resV = (obj.parameters?.nurbsResolutionV as number) || 20;
      const sampled = tessellateNurbsSurface(obj.nurbsSurface, resU, resV);
      obj.vertices = sampled.vertices;
      obj.faces = sampled.faces;
    } catch (e) {
      console.warn('Error sampling NURBS surface for CSG:', e);
    }
  }

  // 3. Crear Three.js geometry base
  let geo = createBaseGeometry(obj);
  geo = cleanGeometryForCSG(geo);

  // Asegurar vértices no indexados para three-csg-ts
  let nonIndexedGeo = geo.toNonIndexed();

  if (obj.vertexOffsets && Object.keys(obj.vertexOffsets).length > 0) {
    applyVertexOffsets(nonIndexedGeo, obj.vertexOffsets);
  }

  const mat = new THREE.MeshStandardMaterial({ color: obj.color || '#ffffff' });
  const mesh = new THREE.Mesh(nonIndexedGeo, mat);

  // Aplicar transformación local -> mundo
  mesh.position.set(...obj.transform.position);
  mesh.rotation.set(...obj.transform.rotation);
  mesh.scale.set(...obj.transform.scale);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);

  return { mesh, cleanObj: obj };
}

/**
 * Ejecuta la operación booleana unificada entre el objeto A y el objeto B
 */
export async function executeUnifiedBoolean(
  objA: CSGObject,
  objB: CSGObject,
  options: {
    operation: UnifiedBooleanOp;
    keepTool?: boolean;
    autoHeal?: boolean;
    recenterPivot?: boolean;
    weldTolerance?: number;
  }
): Promise<BooleanResult> {
  const { operation, keepTool = false, autoHeal = true, recenterPivot = true, weldTolerance = 0.0001 } = options;

  try {
    const { mesh: meshA } = await prepareMeshForCSG(objA);
    const { mesh: meshB } = await prepareMeshForCSG(objB);

    const csgA = CSG.fromMesh(meshA);
    const csgB = CSG.fromMesh(meshB);

    let resultCSGMain: any = null;
    let resultCSGSplitSecond: any = null;
    let opName = '';

    switch (operation) {
      case 'UNION':
        resultCSGMain = csgA.union(csgB);
        opName = `Unión (${objA.name} + ${objB.name})`;
        break;
      case 'DIFFERENCE_AB':
        resultCSGMain = csgA.subtract(csgB);
        opName = `Resta (${objA.name} − ${objB.name})`;
        break;
      case 'DIFFERENCE_BA':
        resultCSGMain = csgB.subtract(csgA);
        opName = `Resta Invertida (${objB.name} − ${objA.name})`;
        break;
      case 'INTERSECTION':
        resultCSGMain = csgA.intersect(csgB);
        opName = `Intersección (${objA.name} ∩ ${objB.name})`;
        break;
      case 'SPLIT':
        resultCSGMain = csgA.subtract(csgB);
        resultCSGSplitSecond = csgA.intersect(csgB);
        opName = `División (${objA.name} / ${objB.name})`;
        break;
      default:
        resultCSGMain = csgA.subtract(csgB);
        opName = `Resta (${objA.name} − ${objB.name})`;
    }

    if (!resultCSGMain) {
      return {
        success: false,
        message: 'No se pudo generar la geometría resultante de la operación booleana.',
      };
    }

    // Convertir el resultado principal a Three.js mesh
    const baseTargetObj = (operation === 'DIFFERENCE_BA') ? objB : objA;
    const baseToolObj = (operation === 'DIFFERENCE_BA') ? objA : objB;

    const resultMesh = CSG.toMesh(resultCSGMain, new THREE.Matrix4(), meshA.material);
    let geomData = fromThreeGeometry(resultMesh.geometry);

    // Soldar vértices duplicados si es necesario
    if (geomData.vertices.length > 0 && weldTolerance > 0) {
      try {
        let threeGeo = new THREE.BufferGeometry();
        const posArr: number[] = [];
        geomData.vertices.forEach(v => posArr.push(v[0], v[1], v[2]));
        threeGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        const idxArr: number[] = [];
        geomData.faces.forEach(f => {
          for (let i = 1; i < f.indices.length - 1; i++) {
            idxArr.push(f.indices[0], f.indices[i], f.indices[i + 1]);
          }
        });
        threeGeo.setIndex(idxArr);
        threeGeo = BufferGeometryUtils.mergeVertices(threeGeo, weldTolerance);
        geomData = fromThreeGeometry(threeGeo);
      } catch (_) {}
    }

    // Curar con Manifold 3D si autoHeal está activo
    if (autoHeal && geomData.vertices.length > 0) {
      try {
        const healed = await healMesh(geomData.vertices, geomData.faces);
        if (healed && healed.vertices.length > 0) {
          geomData = healed;
        }
      } catch (err) {
        console.warn('AutoHeal manifold warning:', err);
      }
    }

    // Calcular centro / pivote si se solicita
    let finalVertices = geomData.vertices;
    let finalPosition: V3 = [0, 0, 0];

    if (recenterPivot && finalVertices.length > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const [x, y, z] of finalVertices) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      finalPosition = [cx, cy, cz];
      finalVertices = finalVertices.map(([x, y, z]) => [x - cx, y - cy, z - cz] as V3);
    }

    const newTarget: CSGObject = {
      ...baseTargetObj,
      name: opName,
      vertices: finalVertices,
      faces: geomData.faces,
      vertexOffsets: {},
      meshData: undefined,
      nurbsSurface: undefined, // Se convierte en malla polígonal sólida
      nurbsCurve: undefined,
      transform: {
        position: finalPosition,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      stats: {
        vertices: finalVertices.length,
        faces: geomData.faces.length,
      },
    };

    let splitPiece: CSGObject | undefined;
    if (operation === 'SPLIT' && resultCSGSplitSecond) {
      const splitMesh = CSG.toMesh(resultCSGSplitSecond, new THREE.Matrix4(), meshB.material);
      let splitGeom = fromThreeGeometry(splitMesh.geometry);

      if (autoHeal && splitGeom.vertices.length > 0) {
        try {
          const healed = await healMesh(splitGeom.vertices, splitGeom.faces);
          if (healed && healed.vertices.length > 0) splitGeom = healed;
        } catch (_) {}
      }

      let splitVerts = splitGeom.vertices;
      let splitPos: V3 = [0, 0, 0];
      if (recenterPivot && splitVerts.length > 0) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const [x, y, z] of splitVerts) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;
        splitPos = [cx, cy, cz];
        splitVerts = splitVerts.map(([x, y, z]) => [x - cx, y - cy, z - cz] as V3);
      }

      splitPiece = {
        ...baseToolObj,
        id: `split_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        name: `Pieza Cortada (${objA.name} ∩ ${objB.name})`,
        vertices: splitVerts,
        faces: splitGeom.faces,
        vertexOffsets: {},
        meshData: undefined,
        nurbsSurface: undefined,
        transform: {
          position: splitPos,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        stats: {
          vertices: splitVerts.length,
          faces: splitGeom.faces.length,
        },
      };
    }

    const removedObjectIds: string[] = [];
    if (!keepTool) {
      removedObjectIds.push(baseToolObj.id);
    }

    return {
      success: true,
      message: `Operación booleana completada con éxito: ${opName}`,
      resultTarget: newTarget,
      resultSplitPiece: splitPiece,
      removedObjectIds,
      stats: {
        originalVerticesA: objA.vertices?.length || 0,
        originalVerticesB: objB.vertices?.length || 0,
        resultVertices: finalVertices.length,
        resultFaces: geomData.faces.length,
      },
    };
  } catch (error: any) {
    console.error('Error executing boolean operation:', error);
    return {
      success: false,
      message: `Error al calcular la operación booleana: ${error?.message || String(error)}`,
    };
  }
}
