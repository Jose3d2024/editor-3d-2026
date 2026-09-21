import * as THREE from 'three';
import { CSGObject, V3, MeshFace } from '../types';
import { convertImportedToCSG } from './modifiers_advanced';
import { createBaseGeometry } from './csg';
import { fromThreeGeometry } from './modifiers';

/**
 * Separar por partes sueltas (Separate by Loose Parts / Mesh Explode)
 * 
 * Analiza la conectividad del grafo de caras/vértices (malla o CSGObject).
 * Agrupa las caras continuas conectadas geométricamente e identifica partes aislladas.
 * Crea un objeto independiente en la escena para cada sub-malla desconectada.
 */
export async function separateLooseParts(obj: CSGObject): Promise<{
  success: boolean;
  objects?: CSGObject[];
  message: string;
}> {
  let workingObj = obj;

  // 1. Si es un archivo importado con meshData (GLTF, STL, OBJ), convertir primero a CSG/Vértices
  if (workingObj.meshData) {
    try {
      workingObj = await convertImportedToCSG(workingObj);
    } catch (e) {
      console.error('Error al convertir meshData para separar partes:', e);
    }
  }

  let vertices = workingObj.vertices || [];
  let faces = workingObj.faces || [];

  // Si no hay vértices directos, extraer la geometría base
  if (!vertices.length || !faces.length) {
    try {
      const geo = createBaseGeometry(workingObj);
      const res = fromThreeGeometry(geo);
      vertices = res.vertices;
      faces = res.faces;
    } catch (e) {
      console.error('Error extrayendo geometría para partes sueltas:', e);
    }
  }

  if (!vertices.length || !faces.length) {
    return {
      success: false,
      message: 'El objeto seleccionado no posee caras o vértices válidos para separar.',
    };
  }

  // 2. Mapeo de clave espacial para tolerar vértices no soldados (coincidentes en el espacio)
  const vertexToKey = (v: V3): string => `${v[0].toFixed(4)}_${v[1].toFixed(4)}_${v[2].toFixed(4)}`;
  const vertexKeyMap = new Map<number, string>();
  vertices.forEach((v, idx) => {
    vertexKeyMap.set(idx, vertexToKey(v));
  });

  // Mapear cada clave espacial a los índices de caras que la utilizan
  const keyToFaces = new Map<string, number[]>();
  faces.forEach((face, faceIdx) => {
    face.indices.forEach((vIdx) => {
      const key = vertexKeyMap.get(vIdx);
      if (key) {
        if (!keyToFaces.has(key)) keyToFaces.set(key, []);
        keyToFaces.get(key)!.push(faceIdx);
      }
    });
  });

  // Grafo de conectividad mediante BFS
  const faceVisited = new Array(faces.length).fill(false);
  const components: number[][] = []; // Lista de grupos de caras (cada grupo es una parte suelta)

  for (let i = 0; i < faces.length; i++) {
    if (faceVisited[i]) continue;

    const componentFaceIndices: number[] = [];
    const queue: number[] = [i];
    faceVisited[i] = true;

    while (queue.length > 0) {
      const currentFaceIdx = queue.pop()!;
      componentFaceIndices.push(currentFaceIdx);

      const face = faces[currentFaceIdx];
      for (const vIdx of face.indices) {
        const key = vertexKeyMap.get(vIdx);
        if (!key) continue;
        const neighborFaces = keyToFaces.get(key) || [];
        for (const neighborIdx of neighborFaces) {
          if (!faceVisited[neighborIdx]) {
            faceVisited[neighborIdx] = true;
            queue.push(neighborIdx);
          }
        }
      }
    }

    components.push(componentFaceIndices);
  }

  if (components.length <= 1) {
    return {
      success: false,
      message: 'El objeto es una sola pieza geométrica continua. No se encontraron partes sueltas.',
    };
  }

  // 3. Crear un nuevo CSGObject por cada componente conexo encontrado
  const rotationEuler = new THREE.Euler(
    workingObj.transform.rotation[0],
    workingObj.transform.rotation[1],
    workingObj.transform.rotation[2]
  );
  const scaleVector = new THREE.Vector3(
    workingObj.transform.scale[0],
    workingObj.transform.scale[1],
    workingObj.transform.scale[2]
  );

  const newObjects: CSGObject[] = components.map((faceIndices, compIdx) => {
    const oldToNewVertMap = new Map<number, number>();
    const subVertices: V3[] = [];
    const subFaces: MeshFace[] = [];

    // Extraer sub-caras y reindexar vértices
    for (const fIdx of faceIndices) {
      const origFace = faces[fIdx];
      const newIndices: number[] = [];

      origFace.indices.forEach((origVIdx) => {
        if (!oldToNewVertMap.has(origVIdx)) {
          const newIdx = subVertices.length;
          oldToNewVertMap.set(origVIdx, newIdx);
          subVertices.push([...vertices[origVIdx]] as V3);
        }
        newIndices.push(oldToNewVertMap.get(origVIdx)!);
      });

      subFaces.push({
        indices: newIndices,
        uvs: origFace.uvs ? [...origFace.uvs] : undefined,
      });
    }

    // Calcular centroide/caja envolvente local de la sub-malla
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const v of subVertices) {
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }

    const localCenterX = (minX + maxX) / 2;
    const localCenterY = (minY + maxY) / 2;
    const localCenterZ = (minZ + maxZ) / 2;

    // Centrar vértices respecto a su origen local para pivote limpio
    const centeredVertices: V3[] = subVertices.map((v) => [
      v[0] - localCenterX,
      v[1] - localCenterY,
      v[2] - localCenterZ,
    ]);

    // Calcular desplazamiento en espacio mundo respetando rotación y escala
    const offsetLocal = new THREE.Vector3(
      localCenterX * scaleVector.x,
      localCenterY * scaleVector.y,
      localCenterZ * scaleVector.z
    );
    offsetLocal.applyEuler(rotationEuler);

    const newPos: [number, number, number] = [
      parseFloat((workingObj.transform.position[0] + offsetLocal.x).toFixed(3)),
      parseFloat((workingObj.transform.position[1] + offsetLocal.y).toFixed(3)),
      parseFloat((workingObj.transform.position[2] + offsetLocal.z).toFixed(3)),
    ];

    const partName = `${workingObj.name}_parte_${compIdx + 1}`;

    return {
      ...workingObj,
      id: Math.random().toString(36).substring(2, 11),
      name: partName,
      type: 'MESH',
      meshData: undefined,
      vertices: centeredVertices,
      faces: subFaces,
      vertexOffsets: {},
      transform: {
        position: newPos,
        rotation: [...workingObj.transform.rotation] as [number, number, number],
        scale: [...workingObj.transform.scale] as [number, number, number],
      },
      stats: {
        vertices: centeredVertices.length,
        faces: subFaces.length,
      },
    };
  });

  return {
    success: true,
    objects: newObjects,
    message: `¡Éxito! Se dividió "${workingObj.name}" en ${newObjects.length} partes sueltas.`,
  };
}
