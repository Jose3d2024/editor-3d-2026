import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CSG } from 'three-csg-ts';
import { CSGObject, Transform, Keyframe } from '../types';
import { generateUVs, applyUVWMapping } from './modifiers';
import { computeSmoothNormalsByPosition } from './meshUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Interpolation helpers
// ─────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function interpolateTransform(keyframes: Keyframe[], time: number, base: Transform): Transform {
  if (!keyframes || keyframes.length === 0) return base;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0].transform;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].transform;
  let prev = sorted[0], next = sorted[0];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i]; next = sorted[i + 1]; break;
    }
  }
  const t = (time - prev.time) / (next.time - prev.time);
  return {
    position: [0, 1, 2].map(i => lerp(prev.transform.position[i], next.transform.position[i], t)) as [number,number,number],
    rotation: [0, 1, 2].map(i => lerp(prev.transform.rotation[i], next.transform.rotation[i], t)) as [number,number,number],
    scale:    [0, 1, 2].map(i => lerp(prev.transform.scale[i],    next.transform.scale[i],    t)) as [number,number,number],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// createBaseGeometry  — INDEXED (clean topology, no vertex duplication)
// Used for: viewport display, wireframe, EdgesGeometry, raycasting
// ─────────────────────────────────────────────────────────────────────────────

export function createBaseGeometry(obj: CSGObject, mData?: any): THREE.BufferGeometry {
  // If the object has explicit mesh data (new architecture), use it.
  if (obj.vertices && obj.faces && obj.vertices.length > 0 && obj.faces.length > 0) {
    let meshData = { vertices: obj.vertices, faces: obj.faces };
    const uvwMapping = mData?.uvwMapping;
    
    if (uvwMapping && uvwMapping !== 'UV') {
      meshData = { ...meshData, faces: meshData.faces.map(f => ({ ...f, uvs: undefined })) };
      meshData = applyUVWMapping(meshData, uvwMapping);
    } else {
      const hasUVs = obj.faces.some(f => f.uvs && f.uvs.length > 0);
      if (!hasUVs) {
        meshData = generateUVs(meshData);
      }
    }

    const geometry = new THREE.BufferGeometry();
    const indices: number[] = [];
    const finalUvs: number[] = [];
    const finalPositions: number[] = [];
    const vertMap = new Map<string, number>();

    const isSmooth = obj.smoothShading === true;

    meshData.faces.forEach((face, fIdx) => {
      const faceIndices: number[] = [];
      const rawIndices = face.indices || ((face as any).a !== undefined ? [(face as any).a, (face as any).b, (face as any).c] : []);
      rawIndices.forEach((posIdx, i) => {
        const uv = face.uvs?.[i] || [0, 0];
        const key = isSmooth
          ? `${posIdx}_${uv[0].toFixed(6)}_${uv[1].toFixed(6)}`
          : `${posIdx}_f${fIdx}`;
        if (vertMap.has(key)) {
          faceIndices.push(vertMap.get(key)!);
        } else {
          const newIdx = finalPositions.length / 3;
          const vRaw = meshData.vertices[posIdx];
          if (!vRaw) return;
          const vx = Array.isArray(vRaw) ? vRaw[0] : (vRaw as any).x ?? 0;
          const vy = Array.isArray(vRaw) ? vRaw[1] : (vRaw as any).y ?? 0;
          const vz = Array.isArray(vRaw) ? vRaw[2] : (vRaw as any).z ?? 0;
          const off = obj.vertexOffsets?.[posIdx] || [0, 0, 0];
          finalPositions.push(vx + off[0], vy + off[1], vz + off[2]);
          finalUvs.push(...uv);
          vertMap.set(key, newIdx);
          faceIndices.push(newIdx);
        }
      });
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i+1]);
      }
    });

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalPositions, 3));
    const uvAttr = new THREE.Float32BufferAttribute(finalUvs, 2);
    geometry.setAttribute('uv', uvAttr);
    geometry.setAttribute('uv2', uvAttr);
    geometry.setIndex(indices);
    if (isSmooth) {
      computeSmoothNormalsByPosition(geometry, Math.PI / 3);
    } else {
      geometry.computeVertexNormals();
    }
    try {
      geometry.computeTangents();
    } catch (_) {}
    return geometry;
  }

  // Fallback for legacy objects or if mesh data is missing
  const p = obj.parameters || {};
  let geo: THREE.BufferGeometry;

  const needsSubdivision = Boolean(
    mData?.isIce ||
    (mData?.id && mData.id.startsWith('ice_')) ||
    (mData?.name && mData.name.toLowerCase().includes('hielo')) ||
    (mData?.displacementScale && mData.displacementScale > 0) ||
    mData?.displacementMap
  );

  switch (obj.type) {
    case 'CUBE': {
      const segs = needsSubdivision ? Math.max(32, Math.round(p.segments ?? 1)) : Math.max(1, Math.round(p.segments ?? 1));
      geo = new THREE.BoxGeometry(1, 1, 1, segs, segs, segs);
      break;
    }
    case 'SPHERE': {
      const sphereType = p.sphereType || 'UV';
      if (sphereType === 'ICO') {
        const detail = Math.max(needsSubdivision ? 3 : 0, Math.min(5, Math.round(p.detail ?? 2)));
        geo = new THREE.IcosahedronGeometry(0.5, detail);
      } else {
        const S = Math.max(needsSubdivision ? 48 : 3, Math.round(p.segments ?? 32));
        const H = Math.max(needsSubdivision ? 32 : 2, Math.round(p.heightSegments ?? Math.round(S / 2)));
        geo = new THREE.SphereGeometry(0.5, S, H);
      }
      break;
    }
    case 'CYLINDER':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, Math.max(3, Math.round(p.segments ?? 16)));
      break;
    case 'PRISM':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
      break;
    case 'CONE':
      geo = new THREE.ConeGeometry(0.5, 1, Math.max(3, Math.round(p.segments ?? 16)));
      break;
    case 'PYRAMID':
      geo = new THREE.ConeGeometry(0.5, 1, 4);
      break;
    case 'CAPSULE':
      geo = new THREE.CapsuleGeometry(0.25, 0.5, 8, Math.max(4, Math.round(p.segments ?? 16)));
      break;
    case 'TORUS':
      geo = new THREE.TorusGeometry(
        p.radius ?? 0.5, p.tube ?? 0.2,
        Math.max(3, Math.round(p.radialSegments ?? 16)),
        Math.max(6, Math.round(p.tubularSegments ?? 32)));
      break;
    case 'ICOSAHEDRON':
      geo = new THREE.IcosahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0)));
      break;
    case 'DODECAHEDRON':
      geo = new THREE.DodecahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0)));
      break;
    case 'TETRAHEDRON':
      geo = new THREE.TetrahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0)));
      break;
    case 'OCTAHEDRON':
      geo = new THREE.OctahedronGeometry(0.5, Math.max(0, Math.round(p.detail ?? 0)));
      break;
    case 'PLANE':
      geo = new THREE.PlaneGeometry(1, 1,
        Math.max(1, Math.round(p.segments ?? 1)),
        Math.max(1, Math.round(p.segments ?? 1)));
      break;
    case 'CIRCLE':
      geo = new THREE.CircleGeometry(0.5, Math.max(3, Math.round(p.segments ?? 16)));
      break;
    case 'RING':
      geo = new THREE.RingGeometry(
        p.innerRadius ?? 0.25, p.outerRadius ?? 0.5,
        Math.max(3, Math.round(p.thetaSegments ?? 16)));
      break;
    default:
      geo = new THREE.BoxGeometry(1, 1, 1);
  }

  // Soldar los vértices duplicados de las aristas compartidas para que al desplazarse por el mapa de relieve se muevan juntos.
  try {
    const merged = BufferGeometryUtils.mergeVertices(geo, 1e-4);
    merged.computeVertexNormals();
    return merged;
  } catch (_) {
    geo.computeVertexNormals();
    return geo;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyVertexOffsets — modifies a geometry's position buffer in-place
// Works on both indexed and non-indexed geometries
// ─────────────────────────────────────────────────────────────────────────────

export function applyVertexOffsets(geo: THREE.BufferGeometry, offsets: Record<number, [number,number,number]>): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (const [key, offset] of Object.entries(offsets)) {
    const idx = parseInt(key);
    if (idx >= 0 && idx < pos.count) {
      pos.setXYZ(idx,
        pos.getX(idx) + offset[0],
        pos.getY(idx) + offset[1],
        pos.getZ(idx) + offset[2],
      );
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// ─────────────────────────────────────────────────────────────────────────────
// createPrimitiveMesh  — INDEXED geometry + transforms applied
// Used by: Viewport render loop (non-destructive), raycasting, sub-object editing
// ─────────────────────────────────────────────────────────────────────────────

export function createPrimitiveMesh(obj: CSGObject, time: number): THREE.Mesh {
  const transform = interpolateTransform(obj.keyframes, time, obj.transform);
  const geo = createBaseGeometry(obj);

  // Apply vertex offsets on the indexed geometry
  if (obj.vertexOffsets && Object.keys(obj.vertexOffsets).length > 0) {
    applyVertexOffsets(geo, obj.vertexOffsets);
  }

  const mat = new THREE.MeshStandardMaterial({ color: obj.color });
  const mesh = new THREE.Mesh(geo, mat);

  mesh.position.set(...transform.position);
  mesh.rotation.set(...transform.rotation);
  mesh.scale.set(...transform.scale);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);

  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// createNonIndexedMesh  — for CSG operations only (three-csg-ts needs non-indexed)
// ─────────────────────────────────────────────────────────────────────────────

function createNonIndexedMesh(obj: CSGObject, time: number): THREE.Mesh {
  const transform = interpolateTransform(obj.keyframes, time, obj.transform);
  const geo = createBaseGeometry(obj).toNonIndexed();

  if (obj.vertexOffsets && Object.keys(obj.vertexOffsets).length > 0) {
    // Build a mapping from indexed → non-indexed positions before applying offsets
    // For non-indexed we apply the same offsets (vertex count may differ, but best effort)
    applyVertexOffsets(geo, obj.vertexOffsets);
  }

  const mat = new THREE.MeshStandardMaterial({ color: obj.color });
  const mesh = new THREE.Mesh(geo, mat);

  mesh.position.set(...transform.position);
  mesh.rotation.set(...transform.rotation);
  mesh.scale.set(...transform.scale);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);

  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// performCSG  — boolean operations, called ONLY for export / explicit apply
// NOT called in the render loop
// ─────────────────────────────────────────────────────────────────────────────

export function performCSG(objects: CSGObject[], time: number): THREE.Mesh | null {
  if (!objects || objects.length === 0) return null;

  const visible = objects.filter(o => o.visible);
  if (visible.length === 0) return null;

  // Start with the first object (must be ADD)
  let resultMesh = createNonIndexedMesh(visible[0], time);

  for (let i = 1; i < visible.length; i++) {
    const obj = visible[i];
    const nextMesh = createNonIndexedMesh(obj, time);

    try {
      const csgA = CSG.fromMesh(resultMesh);
      const csgB = CSG.fromMesh(nextMesh);

      let resultCSG;
      if (obj.operation === 'ADD')           resultCSG = csgA.union(csgB);
      else if (obj.operation === 'SUBTRACT') resultCSG = csgA.subtract(csgB);
      else if (obj.operation === 'INTERSECT') resultCSG = csgA.intersect(csgB);

      if (resultCSG) {
        resultMesh = CSG.toMesh(resultCSG, resultMesh.matrix, resultMesh.material);
        resultMesh.updateMatrixWorld(true);
      }
    } catch (e) {
      console.error(`CSG operation failed for object "${obj.name}":`, e);
    }
  }

  if (!resultMesh.material) {
    resultMesh.material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  }

  return resultMesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// previewCSGResult  — lightweight non-destructive CSG preview
// Returns individual solid meshes (no boolean merge) for real-time viewport
// ─────────────────────────────────────────────────────────────────────────────

export function previewCSGResult(
  objects: CSGObject[],
  time: number,
  selectedIds: string[],
): { mesh: THREE.Mesh; id: string; isSelected: boolean }[] {
  return objects
    .filter(o => o.visible)
    .map(obj => {
      const mesh = createPrimitiveMesh(obj, time);
      mesh.userData.id = obj.id;
      return {
        mesh,
        id: obj.id,
        isSelected: selectedIds.includes(obj.id),
      };
    });
}