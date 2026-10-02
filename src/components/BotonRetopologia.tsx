import { useState } from 'react';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';
import { useStore } from '../store/useStore';
import { getMeshes } from '../utils/meshRegistry';
import type { MaterialData, MeshFace } from '../types';

interface Props {
  selectedMesh?: THREE.Mesh | null;
  onMeshUpdated?: () => void;
}

type Preset = 'ultra-low' | 'low' | 'medium' | 'high' | 'custom';

const PRESETS: Record<Exclude<Preset, 'custom'>, { ratio: number; label: string }> = {
  'ultra-low': { ratio: 0.05, label: 'Ultra Low · 95%' },
  'low':       { ratio: 0.15, label: 'Low · 85%' },
  'medium':    { ratio: 0.35, label: 'Medium · 65%' },
  'high':      { ratio: 0.60, label: 'High · 40%' },
};

export function BotonRetopologia({ onMeshUpdated }: Props) {
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('low');
  const [customRatio, setCustomRatio] = useState(0.15);
  const [preserveBorders, setPreserveBorders] = useState(false);
  const [bvhSnap, setBvhSnap] = useState(true);
  const [maxError, setMaxError] = useState(0.02); // 2% del bbox
  const [analisis, setAnalisis] = useState<string | null>(null);

  const ratioActual = preset === 'custom' ? customRatio : PRESETS[preset].ratio;

  // ─── Análisis previo (compatible con mallas indexadas y no indexadas) ───
  const handleAnalizar = () => {
    const state = useStore.getState();
    const id = state.selectedObjectId;
    if (!id) {
      setAnalisis('Selecciona un objeto primero');
      return;
    }

    const meshes = getMeshes(id);
    if (meshes.length === 0) {
      setAnalisis('No hay meshes registrados');
      return;
    }

    let totalVerts = 0;
    let totalFaces = 0;
    let boundaryEdges = 0;
    let totalEdges = 0;

    meshes.forEach((m) => {
      const g = m.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const idx = g.getIndex();
      if (!pos || pos.count === 0) return;

      totalVerts += pos.count;
      const faceCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      totalFaces += faceCount;

      // Cuantizar coordenadas 3D para identificar vértices coincidentes
      // tanto en geometrías indexadas como no indexadas o con costuras
      const getCanonicalVertKey = (vIdx: number) => {
        const x = Math.round(pos.getX(vIdx) * 10000);
        const y = Math.round(pos.getY(vIdx) * 10000);
        const z = Math.round(pos.getZ(vIdx) * 10000);
        return `${x}_${y}_${z}`;
      };

      const edgeMap = new Map<string, number>();
      for (let i = 0; i < faceCount * 3; i += 3) {
        const i0 = idx ? idx.getX(i) : i;
        const i1 = idx ? idx.getX(i + 1) : i + 1;
        const i2 = idx ? idx.getX(i + 2) : i + 2;

        const k0 = getCanonicalVertKey(i0);
        const k1 = getCanonicalVertKey(i1);
        const k2 = getCanonicalVertKey(i2);

        if (k0 === k1 || k1 === k2 || k2 === k0) continue; // Triángulo degenerado

        const key1 = k0 < k1 ? `${k0}#${k1}` : `${k1}#${k0}`;
        const key2 = k1 < k2 ? `${k1}#${k2}` : `${k2}#${k1}`;
        const key3 = k2 < k0 ? `${k2}#${k0}` : `${k0}#${k2}`;

        edgeMap.set(key1, (edgeMap.get(key1) || 0) + 1);
        edgeMap.set(key2, (edgeMap.get(key2) || 0) + 1);
        edgeMap.set(key3, (edgeMap.get(key3) || 0) + 1);
      }

      edgeMap.forEach((count) => {
        totalEdges++;
        if (count === 1) boundaryEdges++;
      });
    });

    const ratioBorde = totalEdges > 0 ? boundaryEdges / totalEdges : 0;
    const esEnsamblado = ratioBorde > 0.15;

    const partes = [
      `📊 ${totalVerts.toLocaleString()} vértices · ${totalFaces.toLocaleString()} caras`,
      `🧩 ${meshes.length} sub-mallas`,
      ratioBorde > 0.15
        ? `⚠️ ${(ratioBorde * 100).toFixed(1)}% aristas de borde → modelo ENSAMBLADO`
        : ratioBorde > 0.03
        ? `🔷 ${(ratioBorde * 100).toFixed(1)}% bordes → semi-cerrado`
        : `🟢 ${(ratioBorde * 100).toFixed(1)}% bordes → malla CERRADA`,
      esEnsamblado
        ? `💡 Recomendado: desactivar "Preservar bordes"`
        : `💡 Recomendado: activar "Preservar bordes"`,
    ];
    setAnalisis(partes.join('\n'));
  };

  // ─── Simplificación con control de silueta y preservación de materiales por cara ───
  const handleSimplificar = async () => {
    const state = useStore.getState();
    const selectedObjectId = state.selectedObjectId;
    if (!selectedObjectId) {
      setResultado('Selecciona un objeto primero');
      return;
    }

    const meshes = getMeshes(selectedObjectId);
    if (meshes.length === 0) {
      setResultado('No hay meshes registrados');
      return;
    }

    setCargando(true);
    setResultado('Analizando geometría y materiales...');

    try {
      await (MeshoptSimplifier as any).ready;

      const currentObj = state.project.objects.find((o) => o.id === selectedObjectId);
      const existingProjectMaterials = state.project.materials || [];
      const newProjectMaterials: MaterialData[] = [...existingProjectMaterials];
      const materialIdsMap: Record<number, string> = {};

      if (currentObj?.materialIds && typeof currentObj.materialIds === 'object') {
        Object.entries(currentObj.materialIds).forEach(([k, v]) => {
          if (v && typeof v === 'string') materialIdsMap[Number(k)] = v;
        });
      }

      // ── 1. Extraer todas las geometrías con sus matrices aplicadas y mapeo de materiales ──
      const origGeos: THREE.BufferGeometry[] = [];
      const origTriMaterials: number[] = [];
      let totalFacesOrig = 0;

      // Obtener matriz inversa del objeto raíz para transformar las submallas a su espacio local
      // y evitar desfases o duplicaciones de posición, rotación o escala en el viewport
      const rootPos = new THREE.Vector3(...(currentObj?.transform?.position ?? [0, 0, 0]));
      const rootRot = new THREE.Euler(...(currentObj?.transform?.rotation ?? [0, 0, 0]));
      const rootScale = new THREE.Vector3(...(currentObj?.transform?.scale ?? [1, 1, 1]));
      const rootMatrix = new THREE.Matrix4().compose(rootPos, new THREE.Quaternion().setFromEuler(rootRot), rootScale);
      const rootMatrixInv = rootMatrix.clone().invert();

      meshes.forEach((m, meshIdx) => {
        const g = m.geometry;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        if (!pos) return;

        // Registrar / asociar material de la submalla
        let submeshMatId: string | undefined = materialIdsMap[meshIdx];
        const subMat = Array.isArray(m.material) ? m.material[0] : m.material;

        if (!submeshMatId && subMat) {
          if (subMat.userData?.csgMaterialId) {
            submeshMatId = subMat.userData.csgMaterialId;
          } else {
            const pbr = subMat as any;
            const match = newProjectMaterials.find(
              (pm) => pm.name === subMat.name || (pm.color && pbr.color && pm.color === '#' + pbr.color.getHexString())
            );
            if (match) {
              submeshMatId = match.id;
            } else {
              const newMatId = 'mat_sub_' + Math.random().toString(36).substring(2, 9);
              const matName = (subMat.name && subMat.name.trim() !== '') ? subMat.name.trim() : `${currentObj?.name || 'Submalla'}_Material_${meshIdx + 1}`;
              const matData: MaterialData = {
                id: newMatId,
                name: matName,
                category: 'imported',
                color: pbr.color ? '#' + pbr.color.getHexString() : '#ffffff',
                roughness: typeof pbr.roughness === 'number' ? pbr.roughness : 0.5,
                metalness: typeof pbr.metalness === 'number' ? pbr.metalness : 0,
                opacity: typeof subMat.opacity === 'number' ? subMat.opacity : 1,
                transparent: subMat.transparent === true && subMat.opacity < 1,
                emissive: pbr.emissive ? '#' + pbr.emissive.getHexString() : '#000000',
                emissiveIntensity: typeof pbr.emissiveIntensity === 'number' ? pbr.emissiveIntensity : 1,
              };
              newProjectMaterials.push(matData);
              submeshMatId = newMatId;
              subMat.userData.csgMaterialId = newMatId;
            }
          }
        }
        if (submeshMatId) {
          materialIdsMap[meshIdx] = submeshMatId;
        }

        const clone = g.clone();
        m.updateMatrixWorld(true);
        // Transformar submalla al espacio local relativo del objeto
        const localMatrix = rootMatrixInv.clone().multiply(m.matrixWorld);
        clone.applyMatrix4(localMatrix);

        // Reducir a solo position + índices para evitar conflictos de merge
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', clone.getAttribute('position').clone());
        const idx = clone.getIndex();
        if (idx) {
          newGeo.setIndex(idx.clone());
        } else {
          const seq = new Uint32Array(pos.count);
          for (let i = 0; i < pos.count; i++) seq[i] = i;
          newGeo.setIndex(new THREE.BufferAttribute(seq, 1));
        }

        const faceCount = newGeo.getIndex()!.count / 3;
        totalFacesOrig += faceCount;
        origGeos.push(newGeo);

        // Registrar materialIndex por cada cara triangular original
        const groups = m.geometry.groups;
        for (let t = 0; t < faceCount; t++) {
          let triMatIdx = meshIdx;
          if (groups && groups.length > 0) {
            const grp = groups.find((grpItem) => t * 3 >= grpItem.start && t * 3 < grpItem.start + grpItem.count);
            if (grp && typeof grp.materialIndex === 'number') {
              triMatIdx = grp.materialIndex;
            }
          } else if (m.userData?.materialIndex !== undefined) {
            triMatIdx = m.userData.materialIndex;
          }
          origTriMaterials.push(triMatIdx);
        }
      });

      if (origGeos.length === 0) {
        setResultado('No se pudo extraer geometría');
        return;
      }

      // Si es una sola submalla pero el objeto original ya contenía asignación de material por cara
      if (meshes.length === 1 && currentObj?.faces && currentObj.faces.length > 0 && origTriMaterials.length > 0) {
        let triOffset = 0;
        currentObj.faces.forEach((f) => {
          const triCount = Math.max(1, (f.indices?.length || 3) - 2);
          if (f.materialIndex !== undefined) {
            for (let k = 0; k < triCount && triOffset + k < origTriMaterials.length; k++) {
              origTriMaterials[triOffset + k] = f.materialIndex;
            }
          }
          triOffset += triCount;
        });
      }

      // ── 2. Combinar todo en una sola geometría ──
      const merged = origGeos.length === 1
        ? origGeos[0]
        : BufferGeometryUtils.mergeGeometries(origGeos, false);

      if (!merged) {
        setResultado('Error al combinar geometrías');
        return;
      }

      const posAttr = merged.getAttribute('position') as THREE.BufferAttribute;
      const idxAttr = merged.getIndex()!;

      // Copia de posiciones para modificar
      const posArray = new Float32Array(posAttr.array);
      const idxArray = new Uint32Array(idxAttr.array);

      // Tabla de respaldo de material por vértice
      const vertMatIndices = new Uint32Array(posArray.length / 3);
      for (let t = 0; t < idxArray.length; t += 3) {
        const triIdx = Math.floor(t / 3);
        const mat = origTriMaterials[triIdx] ?? 0;
        vertMatIndices[idxArray[t]] = mat;
        vertMatIndices[idxArray[t + 1]] = mat;
        vertMatIndices[idxArray[t + 2]] = mat;
      }

      // ── 3. BVH de la geometría original (para el snap y transferencia de material) ──
      const bvhGeo = new THREE.BufferGeometry();
      bvhGeo.setAttribute('position', new THREE.BufferAttribute(posArray.slice(), 3));
      bvhGeo.setIndex(new THREE.BufferAttribute(idxArray.slice(), 1));
      const bvh = new MeshBVH(bvhGeo);

      // ── 4. Simplificar con meshoptimizer ──
      const targetFaces = Math.max(4, Math.floor(totalFacesOrig * ratioActual));
      const targetIndexCount = targetFaces * 3;

      setResultado(`Simplificando ${totalFacesOrig.toLocaleString()} → ${targetFaces.toLocaleString()} caras...`);

      const flags: string[] = [];
      if (preserveBorders) flags.push('LockBorder');

      const [simplifiedIndices, resultError] = (MeshoptSimplifier as any).simplify(
        idxArray,
        posArray,
        3,
        targetIndexCount,
        maxError,
        flags
      );

      const simplifiedIdxArray = simplifiedIndices as Uint32Array;
      const facesAfter = simplifiedIdxArray.length / 3;

      // ── 5. BVH snap: reproyectar vértices a la superficie original ──
      let projectedCount = 0;
      if (bvhSnap) {
        setResultado(`Proyectando ${facesAfter.toLocaleString()} caras a la superficie original...`);
        const tmpTarget: any = { point: new THREE.Vector3(), distance: 0 };
        const pt = new THREE.Vector3();
        // Solo proyectar vértices usados por las caras simplificadas
        const usedVerts = new Set<number>();
        for (let i = 0; i < simplifiedIdxArray.length; i++) {
          usedVerts.add(simplifiedIdxArray[i]);
        }
        usedVerts.forEach((vi) => {
          pt.set(posArray[vi * 3], posArray[vi * 3 + 1], posArray[vi * 3 + 2]);
          bvh.closestPointToPoint(pt, tmpTarget);
          if (tmpTarget.point) {
            posArray[vi * 3] = tmpTarget.point.x;
            posArray[vi * 3 + 1] = tmpTarget.point.y;
            posArray[vi * 3 + 2] = tmpTarget.point.z;
            projectedCount++;
          }
        });
      }

      // ── 6. Convertir a formato del store y asignar material por cara ──
      const usedSet = new Set<number>();
      for (let i = 0; i < simplifiedIdxArray.length; i++) usedSet.add(simplifiedIdxArray[i]);

      const remap = new Map<number, number>();
      const newVertices: [number, number, number][] = [];
      for (let i = 0; i < posArray.length / 3; i++) {
        if (usedSet.has(i)) {
          remap.set(i, newVertices.length);
          newVertices.push([posArray[i * 3], posArray[i * 3 + 1], posArray[i * 3 + 2]]);
        }
      }

      const newFaces: MeshFace[] = [];
      const triCentroid = new THREE.Vector3();
      const bvhMatTarget: any = { point: new THREE.Vector3(), distance: Infinity, faceIndex: -1 };

      for (let i = 0; i < simplifiedIdxArray.length; i += 3) {
        const origI0 = simplifiedIdxArray[i];
        const origI1 = simplifiedIdxArray[i + 1];
        const origI2 = simplifiedIdxArray[i + 2];

        // Calcular baricentro del triángulo simplificado para muestreo de material
        triCentroid.set(
          (posArray[origI0 * 3] + posArray[origI1 * 3] + posArray[origI2 * 3]) / 3,
          (posArray[origI0 * 3 + 1] + posArray[origI1 * 3 + 1] + posArray[origI2 * 3 + 1]) / 3,
          (posArray[origI0 * 3 + 2] + posArray[origI1 * 3 + 2] + posArray[origI2 * 3 + 2]) / 3
        );

        let faceMatIndex = vertMatIndices[origI0] ?? 0;
        bvhMatTarget.faceIndex = -1;
        bvh.closestPointToPoint(triCentroid, bvhMatTarget);
        if (bvhMatTarget.faceIndex >= 0 && bvhMatTarget.faceIndex < origTriMaterials.length) {
          faceMatIndex = origTriMaterials[bvhMatTarget.faceIndex];
        }

        newFaces.push({
          indices: [
            remap.get(origI0)!,
            remap.get(origI1)!,
            remap.get(origI2)!,
          ],
          materialIndex: faceMatIndex,
        });
      }

      // ── 7. Actualizar el objeto conservando materiales individuales y asignación por cara ──
      const primaryMaterialId = materialIdsMap[0] || currentObj?.materialId;

      useStore.setState((s) => ({
        project: {
          ...s.project,
          materials: newProjectMaterials,
          objects: s.project.objects.map((o) =>
            o.id === selectedObjectId
              ? {
                  ...o,
                  meshData: undefined,
                  vertices: newVertices,
                  faces: newFaces,
                  vertexOffsets: {},
                  materialId: primaryMaterialId ?? o.materialId,
                  materialIds: Object.keys(materialIdsMap).length > 1 ? materialIdsMap : o.materialIds,
                }
              : o
          ),
        },
      }));

      setTimeout(() => useStore.getState().saveHistory(), 50);

      const errorPct = (resultError * 100).toFixed(2);
      const reduccionPct = ((1 - facesAfter / totalFacesOrig) * 100).toFixed(0);

      setResultado(
        `✅ ${totalFacesOrig.toLocaleString()} → ${facesAfter.toLocaleString()} caras (${reduccionPct}% reducción)\n` +
        `📐 Error máx: ${errorPct}% · ${projectedCount.toLocaleString()} vértices proyectados\n` +
        `🎨 Materiales preservados: ${Object.keys(materialIdsMap).length > 0 ? Object.keys(materialIdsMap).length : 1}`
      );

      if (onMeshUpdated) onMeshUpdated();
    } catch (err) {
      setResultado('Error: ' + String(err));
      console.error(err);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-lg shadow-2xl w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
          Optimizar Silueta (Reducción Poligonal)
        </span>
        <button
          onClick={handleAnalizar}
          disabled={cargando}
          className="text-[10px] text-zinc-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          title="Analizar número de vértices, caras y aristas de borde antes de reducir"
        >
          🔍 Analizar
        </button>
      </div>

      {analisis && (
        <div className="text-[10px] text-zinc-300 bg-zinc-950/70 rounded p-2 font-mono whitespace-pre-line border border-zinc-800">
          {analisis}
        </div>
      )}

      {/* Presets */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Reducción Objetivo</span>
          <span className="text-[9px] text-zinc-500">Sujeto al límite de error</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(PRESETS) as Array<Exclude<Preset, 'custom'>>).map((k) => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              disabled={cargando}
              className={`text-[10px] py-1.5 px-2 rounded border transition-colors cursor-pointer disabled:opacity-50 ${
                preset === k
                  ? 'bg-purple-600 border-purple-400 text-white font-bold'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {PRESETS[k].label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPreset('custom')}
          disabled={cargando}
          className={`text-[10px] py-1.5 rounded border transition-colors cursor-pointer disabled:opacity-50 ${
            preset === 'custom'
              ? 'bg-purple-600 border-purple-400 text-white font-bold'
              : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          Personalizado
        </button>
      </div>

      {preset === 'custom' && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-zinc-400 flex justify-between">
            <span>Reducción</span>
            <span className="text-purple-300 font-mono">{Math.round((1 - customRatio) * 100)}%</span>
          </label>
          <input
            type="range"
            min="0.02"
            max="0.95"
            step="0.01"
            value={1 - customRatio}
            onChange={(e) => setCustomRatio(1 - parseFloat(e.target.value))}
            disabled={cargando}
            className="w-full accent-purple-500 cursor-pointer"
          />
        </div>
      )}

      {/* Opciones avanzadas */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-800">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Opciones</span>

        <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={preserveBorders}
            onChange={(e) => setPreserveBorders(e.target.checked)}
            disabled={cargando}
            className="accent-purple-500 cursor-pointer"
          />
          Preservar bordes abiertos
        </label>

        <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={bvhSnap}
            onChange={(e) => setBvhSnap(e.target.checked)}
            disabled={cargando}
            className="accent-purple-500 cursor-pointer"
          />
          Proyectar a superficie (BVH)
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-zinc-300">
          <div className="flex justify-between">
            <span>Error máximo</span>
            <span className="text-purple-300 font-mono">{(maxError * 100).toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="0.001"
            max="0.10"
            step="0.001"
            value={maxError}
            onChange={(e) => setMaxError(parseFloat(e.target.value))}
            disabled={cargando}
            className="w-full accent-purple-500 cursor-pointer"
          />
        </label>
      </div>

      <button
        onClick={handleSimplificar}
        disabled={cargando}
        className="px-3 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded text-xs font-bold uppercase tracking-wide disabled:from-zinc-700 disabled:to-zinc-700 disabled:cursor-not-allowed transition-all shadow-lg cursor-pointer"
      >
        {cargando ? '⏳ Procesando...' : '✨ Optimizar silueta'}
      </button>

      {resultado && (
        <div className="text-[10px] text-zinc-300 font-mono break-words whitespace-pre-line bg-zinc-950/70 rounded p-2 border border-zinc-800">
          {resultado}
        </div>
      )}
    </div>
  );
}
