import { useState } from 'react';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshoptSimplifier } from 'meshoptimizer';
import { useStore } from '../store/useStore';
import { getMeshes } from '../utils/meshRegistry';

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

  // ─── Análisis previo ───
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
      if (!pos) return;

      totalVerts += pos.count;
      const faceCount = idx ? idx.count / 3 : pos.count / 3;
      totalFaces += faceCount;

      // Contar aristas de borde
      if (idx) {
        const edgeMap = new Map<string, number>();
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i);
          const b = idx.getX(i + 1);
          const c = idx.getX(i + 2);
          const key1 = a < b ? `${a}_${b}` : `${b}_${a}`;
          const key2 = b < c ? `${b}_${c}` : `${c}_${b}`;
          const key3 = c < a ? `${c}_${a}` : `${a}_${c}`;
          edgeMap.set(key1, (edgeMap.get(key1) || 0) + 1);
          edgeMap.set(key2, (edgeMap.get(key2) || 0) + 1);
          edgeMap.set(key3, (edgeMap.get(key3) || 0) + 1);
        }
        edgeMap.forEach((count) => {
          totalEdges++;
          if (count === 1) boundaryEdges++;
        });
      }
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

  // ─── Simplificación con control de silueta ───
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
    setResultado('Analizando geometría...');

    try {
      await (MeshoptSimplifier as any).ready;

      // ── 1. Extraer todas las geometrías con sus matrices aplicadas ──
      const origGeos: THREE.BufferGeometry[] = [];
      let totalFacesOrig = 0;

      meshes.forEach((m) => {
        const g = m.geometry;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        if (!pos) return;

        const clone = g.clone();
        m.updateMatrixWorld(true);
        clone.applyMatrix4(m.matrixWorld);

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
      });

      if (origGeos.length === 0) {
        setResultado('No se pudo extraer geometría');
        return;
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

      // ── 3. BVH de la geometría original (para el snap posterior) ──
      let bvh: MeshBVH | null = null;
      if (bvhSnap) {
        setResultado('Construyendo BVH de la superficie original...');
        const bvhGeo = new THREE.BufferGeometry();
        bvhGeo.setAttribute('position', new THREE.BufferAttribute(posArray.slice(), 3));
        bvhGeo.setIndex(new THREE.BufferAttribute(idxArray.slice(), 1));
        bvh = new MeshBVH(bvhGeo);
      }

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
      if (bvhSnap && bvh) {
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
          bvh!.closestPointToPoint(pt, tmpTarget);
          if (tmpTarget.point) {
            posArray[vi * 3] = tmpTarget.point.x;
            posArray[vi * 3 + 1] = tmpTarget.point.y;
            posArray[vi * 3 + 2] = tmpTarget.point.z;
            projectedCount++;
          }
        });
      }

      // ── 6. Convertir a formato del store ──
      // Determinar qué vértices se usan
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

      const newFaces: { indices: number[] }[] = [];
      for (let i = 0; i < simplifiedIdxArray.length; i += 3) {
        newFaces.push({
          indices: [
            remap.get(simplifiedIdxArray[i])!,
            remap.get(simplifiedIdxArray[i + 1])!,
            remap.get(simplifiedIdxArray[i + 2])!,
          ],
        });
      }

      // ── 7. Actualizar el objeto conservando su material ──
      useStore.setState((s) => ({
        project: {
          ...s.project,
          objects: s.project.objects.map((o) =>
            o.id === selectedObjectId
              ? {
                  ...o,
                  // Eliminar meshData para que el Viewport renderice desde vertices/faces
                  meshData: undefined,
                  vertices: newVertices,
                  faces: newFaces,
                  vertexOffsets: {},
                  // Preservar material: si tenía uno asignado, se mantiene
                  materialId: o.materialId,
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
        `📐 Error máx: ${errorPct}% · ${projectedCount.toLocaleString()} vértices proyectados`
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
          Optimizar silueta
        </span>
        <button
          onClick={handleAnalizar}
          disabled={cargando}
          className="text-[10px] text-zinc-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          title="Analizar malla antes de optimizar"
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
        <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Preset</span>
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
