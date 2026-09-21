/**
 * meshNoise.ts
 *
 * Herramienta avanzada para aplicar ruidos 3D y romper la geometría perfecta de mallas:
 * - Perlin FBM (Fractal Browniano)
 * - Voronoi / Celular Orgánico (bloques de hielo, fracturas, rocas cristalinas)
 * - Simplex Turbulencia (pliegues caóticos y distorsión orgánica)
 * - Rizado Glacial (surcos de deshielo, erosión hídrica)
 * - Microporos 3D (pitting geométrico y microrugosidad táctil)
 * - Cráteres & Erosión (hendiduras y oquedades)
 */

import * as THREE from 'three';
import type { CSGObject, MeshFace, V3 } from '../types';
import { subdivideMesh, fromThreeGeometry } from './modifiers';
import { repairMesh } from './meshUtils';

export type MeshNoiseType =
  | 'PERLIN_FBM'
  | 'VORONOI_CELLULAR'
  | 'SIMPLEX_TURBULENCE'
  | 'GLACIAL_RIPPLE'
  | 'MICRO_PORES_3D'
  | 'CRATER_EROSION';

export type MeshNoiseDirection = 'NORMAL' | 'RADIAL' | 'XYZ';

export interface NoiseDeformConfig {
  noiseType: MeshNoiseType;
  intensity: number;      // Fuerza / Amplitud (ej: 0.01 a 0.5)
  scale: number;          // Frecuencia / Escala espacial (ej: 0.2 a 15.0)
  octaves?: number;       // 1 a 5 niveles de detalle fractal
  roughness?: number;     // 0.1 a 0.9 (persistencia de octavas)
  direction?: MeshNoiseDirection; // NORMAL (defecto), RADIAL, XYZ
  seed?: number;          // Semilla aleatoria
  subdivideFirst?: boolean; // Subdividir antes si la malla tiene pocos polígonos
  preserveFlatBottom?: boolean; // No deformar vértices en la base Y <= min
}

export interface NoisePreset {
  id: string;
  name: string;
  icon: string;
  desc: string;
  config: NoiseDeformConfig;
}

export const MESH_NOISE_PRESETS: NoisePreset[] = [
  {
    id: 'glacier_blocks',
    name: 'Glaciar & Bloques de Hielo',
    icon: '🧊',
    desc: 'Facetas angulares tipo bloque de hielo quebrado y grietas naturales',
    config: {
      noiseType: 'VORONOI_CELLULAR',
      intensity: 0.10,
      scale: 1.8,
      octaves: 3,
      roughness: 0.55,
      direction: 'NORMAL',
    }
  },
  {
    id: 'organic_rock',
    name: 'Roca Orgánica & Mineral',
    icon: '🪨',
    desc: 'Ondulaciones y crestas de erosión natural multicapa',
    config: {
      noiseType: 'PERLIN_FBM',
      intensity: 0.12,
      scale: 1.5,
      octaves: 4,
      roughness: 0.5,
      direction: 'NORMAL',
    }
  },
  {
    id: 'glacial_melt',
    name: 'Deshielo & Surcos Glaciales',
    icon: '🌊',
    desc: 'Canales fluidos y ondulaciones de agua y deshielo',
    config: {
      noiseType: 'GLACIAL_RIPPLE',
      intensity: 0.08,
      scale: 2.2,
      octaves: 3,
      roughness: 0.55,
      direction: 'NORMAL',
    }
  },
  {
    id: 'crater_pitting',
    name: 'Meteorito & Cráteres',
    icon: '🌋',
    desc: 'Hendiduras, cavidades y desgaste por impacto',
    config: {
      noiseType: 'CRATER_EROSION',
      intensity: 0.12,
      scale: 1.6,
      octaves: 3,
      roughness: 0.45,
      direction: 'NORMAL',
    }
  },
  {
    id: 'micro_pores',
    name: 'Microporos 3D & Rugosidad',
    icon: '🧽',
    desc: 'Micro-deformación táctil de alta frecuencia para romper el acabado liso',
    config: {
      noiseType: 'MICRO_PORES_3D',
      intensity: 0.035,
      scale: 8.5,
      octaves: 3,
      roughness: 0.7,
      direction: 'NORMAL',
    }
  },
  {
    id: 'chaos_turbulence',
    name: 'Turbulencia Caótica',
    icon: '🌪️',
    desc: 'Pliegues distorsionados y silueta agresivamente orgánica',
    config: {
      noiseType: 'SIMPLEX_TURBULENCE',
      intensity: 0.12,
      scale: 1.2,
      octaves: 4,
      roughness: 0.65,
      direction: 'XYZ',
    }
  },
];

// ── Algoritmos de Ruido 3D Puros (Simplex, Perlin, Voronoi) ───────────────────

function pseudoRandom(seed: number): () => number {
  let s = Math.sin(seed) * 10000;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Generador de ruido Simplex 3D rápido
class FastNoise3D {
  private p: number[] = [];
  private perm: number[] = [];

  constructor(seed = 1337) {
    const rng = pseudoRandom(seed);
    const pTemp: number[] = [];
    for (let i = 0; i < 256; i++) pTemp[i] = i;
    // Shuffle
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = pTemp[i];
      pTemp[i] = pTemp[j];
      pTemp[j] = t;
    }
    this.p = pTemp;
    this.perm = new Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = this.p[i & 255];
    }
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  public noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);

    const u = this.fade(x);
    const v = this.fade(y);
    const w = this.fade(z);

    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;

    return this.lerp(
      this.lerp(
        this.lerp(this.grad(this.perm[AA], x, y, z), this.grad(this.perm[BA], x - 1, y, z), u),
        this.lerp(this.grad(this.perm[AB], x, y - 1, z), this.grad(this.perm[BB], x - 1, y - 1, z), u),
        v
      ),
      this.lerp(
        this.lerp(this.grad(this.perm[AA + 1], x, y, z - 1), this.grad(this.perm[BA + 1], x - 1, y, z - 1), u),
        this.lerp(this.grad(this.perm[AB + 1], x, y - 1, z - 1), this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  // Fractal Brownian Motion (FBM)
  public fbm(x: number, y: number, z: number, octaves = 4, roughness = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency, z * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= roughness;
      frequency *= 2.02;
    }

    return total / (maxValue || 1);
  }

  // Ridged Multi-fractal (Crestas y estratos minerales geológicos)
  public ridgedFbm(x: number, y: number, z: number, octaves = 4, roughness = 0.5): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      let n = 1.0 - Math.abs(this.noise(x * frequency, y * frequency, z * frequency));
      n = n * n; // Exponente para afilar crestas naturales
      total += n * amplitude;
      maxValue += amplitude;
      amplitude *= roughness;
      frequency *= 2.05;
    }

    return total / (maxValue || 1);
  }

  // Domain Warping 3D (Distorsión geológica tridimensional natural)
  public domainWarpFbm(x: number, y: number, z: number, octaves = 4, roughness = 0.5): number {
    const qx = this.fbm(x + 1.2, y + 3.4, z + 5.6, 2, 0.5) - 0.5;
    const qy = this.fbm(x + 7.8, y + 9.1, z + 2.3, 2, 0.5) - 0.5;
    const qz = this.fbm(x + 4.5, y + 6.7, z + 8.9, 2, 0.5) - 0.5;
    return this.fbm(x + qx * 0.75, y + qy * 0.75, z + qz * 0.75, octaves, roughness);
  }

  // Voronoi / Celular 3D
  public voronoi(x: number, y: number, z: number): { f1: number; f2: number; diff: number } {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;

    let d1 = 1e10;
    let d2 = 1e10;

    for (let xo = -1; xo <= 1; xo++) {
      for (let yo = -1; yo <= 1; yo++) {
        for (let zo = -1; zo <= 1; zo++) {
          const cx = (this.perm[(ix + xo + 512) & 255] / 255.0);
          const cy = (this.perm[(iy + yo + (this.perm[(ix + xo + 512) & 255])) & 255] / 255.0);
          const cz = (this.perm[(iz + zo + (this.perm[(iy + yo + 512) & 255])) & 255] / 255.0);

          const px = xo + cx - fx;
          const py = yo + cy - fy;
          const pz = zo + cz - fz;

          const dist = Math.sqrt(px * px + py * py + pz * pz);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }
    }

    return { f1: d1, f2: d2, diff: d2 - d1 };
  }

  // Turbulencia Simplex
  public turbulence(x: number, y: number, z: number, octaves = 4): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;

    for (let i = 0; i < octaves; i++) {
      total += Math.abs(this.noise(x * frequency, y * frequency, z * frequency)) * amplitude;
      amplitude *= 0.55;
      frequency *= 2.0;
    }
    return total;
  }
}

/**
 * Aplica el ruido configurado sobre la malla garantizando:
 * 1. Fusión de vértices coincidentes (las caras y esquinas nunca se separan ni se abren en aletas).
 * 2. Subdivisión adaptativa automática para mallas de baja resolución (como cubos básicos).
 * 3. Difusión y suavizado laplaciano del campo de normales para evitar que las 12 aristas y 8 esquinas del cubo salgan disparadas en pico.
 * 4. Fusión de curvatura orgánica (combina normales de superficie con vector radial desde el centroide).
 * 5. Deformación fractal geológica de alto realismo (rocas, glaciares, meteoritos, hielo).
 */
export function applyNoiseToMesh(
  mesh: { vertices: V3[]; faces: MeshFace[] },
  config: NoiseDeformConfig
): { vertices: V3[]; faces: MeshFace[] } {
  let targetMesh = mesh;
  if (!targetMesh.vertices || targetMesh.vertices.length === 0) return targetMesh;

  // 1. Soldar inicialmente para asegurar conectividad cerrada
  try {
    const repaired = repairMesh(targetMesh as any, 0.0005);
    targetMesh = { vertices: repaired.vertices, faces: repaired.faces };
  } catch (e) {
    // Si falla, continuar con targetMesh
  }

  // 2. Subdivisión adaptativa automática:
  // Si la malla tiene muy pocos vértices (ej: un cubo base de 8 vértices), el ruido necesita resolución
  // poligonal para formar ondulaciones orgánicas en lugar de estirar solo las 8 esquinas.
  const isLowRes = targetMesh.vertices.length < 500;
  const shouldAutoSubdivide = config.subdivideFirst ? isLowRes : targetMesh.vertices.length < 300;
  if (shouldAutoSubdivide) {
    let iterations = 0;
    while (targetMesh.vertices.length < 600 && iterations < 3) {
      try {
        targetMesh = subdivideMesh(targetMesh);
        iterations++;
      } catch (e) {
        break;
      }
    }
  }

  const vertices = targetMesh.vertices;
  const faces = targetMesh.faces;
  const nVerts = vertices.length;
  if (nVerts === 0) return targetMesh;

  // 3. Agrupación por coordenadas espaciales coincidentes
  const tol = 10000; // Precisión de 0.0001
  const posKey = (v: V3) => `${Math.round(v[0] * tol)},${Math.round(v[1] * tol)},${Math.round(v[2] * tol)}`;

  const clusterMap = new Map<string, number[]>();
  for (let i = 0; i < nVerts; i++) {
    const k = posKey(vertices[i]);
    if (!clusterMap.has(k)) {
      clusterMap.set(k, []);
    }
    clusterMap.get(k)!.push(i);
  }

  // Construir mapa de adyacencia de clusters topológicos (vecinos por arista)
  const clusterNeighbors = new Map<string, Set<string>>();
  clusterMap.forEach((_, k) => {
    clusterNeighbors.set(k, new Set<string>());
  });

  faces.forEach(face => {
    const idxs = face.indices;
    const len = idxs.length;
    for (let i = 0; i < len; i++) {
      const k1 = posKey(vertices[idxs[i]]);
      const k2 = posKey(vertices[idxs[(i + 1) % len]]);
      if (k1 !== k2) {
        clusterNeighbors.get(k1)?.add(k2);
        clusterNeighbors.get(k2)?.add(k1);
      }
    }
  });

  // 4. Calcular normales acumuladas por área en cada cluster
  const clusterNormals = new Map<string, THREE.Vector3>();
  const clusterCenters = new Map<string, THREE.Vector3>();

  clusterMap.forEach((indices, k) => {
    clusterNormals.set(k, new THREE.Vector3(0, 0, 0));
    const firstV = vertices[indices[0]];
    clusterCenters.set(k, new THREE.Vector3(firstV[0], firstV[1], firstV[2]));
  });

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  faces.forEach(face => {
    const idxs = face.indices;
    if (idxs.length >= 3) {
      for (let i = 1; i < idxs.length - 1; i++) {
        const i0 = idxs[0];
        const i1 = idxs[i];
        const i2 = idxs[i + 1];

        vA.fromArray(vertices[i0]);
        vB.fromArray(vertices[i1]);
        vC.fromArray(vertices[i2]);

        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab);

        const area = cb.length();
        if (area > 1e-8) {
          cb.normalize();

          const k0 = posKey(vertices[i0]);
          const k1 = posKey(vertices[i1]);
          const k2 = posKey(vertices[i2]);

          clusterNormals.get(k0)?.addScaledVector(cb, area);
          clusterNormals.get(k1)?.addScaledVector(cb, area);
          clusterNormals.get(k2)?.addScaledVector(cb, area);
        }
      }
    }
  });

  // 5. Calcular centroide y radio de la caja envolvente
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let cx = 0, cy = 0, cz = 0;

  for (let i = 0; i < nVerts; i++) {
    const v = vertices[i];
    cx += v[0]; cy += v[1]; cz += v[2];
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  cx /= nVerts; cy /= nVerts; cz /= nVerts;
  const center = new THREE.Vector3(cx, cy, cz);
  const bboxRadius = Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5);

  // Normalizar normales iniciales
  clusterNormals.forEach((n, k) => {
    if (n.lengthSq() > 1e-8) {
      n.normalize();
    } else {
      const p = clusterCenters.get(k)!;
      n.subVectors(p, center).normalize();
      if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
    }
  });

  // ── DIFUSIÓN Y SUAVIZADO DEL CAMPO DE NORMALES (Elimina el efecto de aletas/picos en aristas) ──
  // Aplica 5 iteraciones de difusión laplaciana en las normales de superficie entre vecinos topológicos.
  // Esto hace que las aristas de 90° de un cubo transicionen suavemente sin dispararse diagonalmente.
  let smoothedNormals = new Map<string, THREE.Vector3>();
  clusterNormals.forEach((n, k) => {
    smoothedNormals.set(k, n.clone());
  });

  const smoothIterations = 6;
  for (let iter = 0; iter < smoothIterations; iter++) {
    const nextNormals = new Map<string, THREE.Vector3>();
    smoothedNormals.forEach((curN, k) => {
      const nbrs = clusterNeighbors.get(k);
      if (!nbrs || nbrs.size === 0) {
        nextNormals.set(k, curN.clone());
        return;
      }
      const avgN = curN.clone().multiplyScalar(0.35);
      const weight = 0.65 / nbrs.size;
      nbrs.forEach(nbrKey => {
        const nbrN = smoothedNormals.get(nbrKey);
        if (nbrN) avgN.addScaledVector(nbrN, weight);
      });
      if (avgN.lengthSq() > 1e-8) avgN.normalize();
      nextNormals.set(k, avgN);
    });
    smoothedNormals = nextNormals;
  }

  // ── FUSIÓN DE CURVATURA ORGÁNICA CONTINUA ──
  // Combina la normal suave de superficie con el vector radial desde el centroide (30% radial, 70% normal suave).
  // Esto le da a cubos y prismas un volumen redondeado y natural de roca/glaciar sin perder su perfil.
  const finalDeformDirections = new Map<string, THREE.Vector3>();
  clusterMap.forEach((_, k) => {
    const p = clusterCenters.get(k)!;
    const radial = p.clone().sub(center);
    if (radial.lengthSq() > 1e-8) radial.normalize();
    else radial.set(0, 1, 0);

    const sNorm = smoothedNormals.get(k) || clusterNormals.get(k)!;
    
    // Fusión armónica: 70% normal suavizada + 30% vector radial
    const blended = sNorm.clone().multiplyScalar(0.70).addScaledVector(radial, 0.30);
    if (blended.lengthSq() > 1e-8) blended.normalize();
    else blended.copy(sNorm);

    finalDeformDirections.set(k, blended);
  });

  const noise = new FastNoise3D(config.seed ?? Math.floor(Math.random() * 100000));
  const scale = config.scale || 1.5;
  const intensity = config.intensity || 0.12;
  const octaves = Math.min(5, Math.max(1, config.octaves ?? 3));
  const roughness = config.roughness ?? 0.55;
  const direction = config.direction || 'NORMAL';

  // 6. Calcular desplazamiento por cada cluster espacial único
  const clusterDisplacements = new Map<string, THREE.Vector3>();

  clusterMap.forEach((_, k) => {
    const p = clusterCenters.get(k)!;
    const organicDir = finalDeformDirections.get(k)!;
    const radialDir = p.clone().sub(center).normalize();

    const px = (p.x - cx) * scale;
    const py = (p.y - cy) * scale;
    const pz = (p.z - cz) * scale;

    let displacementAmount = 0;
    let dispDir = new THREE.Vector3();

    if (direction === 'NORMAL') {
      dispDir.copy(organicDir);
    } else if (direction === 'RADIAL') {
      dispDir.copy(radialDir.lengthSq() > 1e-8 ? radialDir : organicDir);
    } else {
      // 3D XYZ Vectorial continuo
      const dx = noise.fbm(px + 12.3, py + 4.7, pz + 8.1, octaves, roughness) - 0.5;
      const dy = noise.fbm(px + 45.1, py + 92.4, pz + 1.2, octaves, roughness) - 0.5;
      const dz = noise.fbm(px + 7.8, py + 33.6, pz + 55.9, octaves, roughness) - 0.5;
      dispDir.set(dx, dy, dz);
      if (dispDir.lengthSq() > 1e-8) dispDir.normalize();
      else dispDir.copy(organicDir);
    }

    switch (config.noiseType) {
      case 'GLACIAL_RIPPLE': {
        // Ondas fluidas de deshielo y surcos continuos
        const flowWarp = noise.domainWarpFbm(px * 0.9, py * 0.9, pz * 0.9, 2, 0.45);
        const wave1 = Math.sin(px * 1.4 + flowWarp * 2.0) * 0.35;
        const wave2 = Math.cos(pz * 1.3 + py * 0.8 + flowWarp * 1.5) * 0.30;
        const detail = (noise.fbm(px * 2.2, py * 2.2, pz * 2.2, octaves, roughness) - 0.5) * 0.35;
        displacementAmount = wave1 + wave2 + detail;
        break;
      }

      case 'VORONOI_CELLULAR': {
        // Facetas cristalinas de hielo y fracturas naturales de bloque
        const vor = noise.voronoi(px * 1.1, py * 1.1, pz * 1.1);
        const facets = vor.diff * 1.3 - 0.4;
        const micro = (noise.fbm(px * 2.6, py * 2.6, pz * 2.6, 2, 0.5) - 0.5) * 0.25;
        displacementAmount = facets + micro;
        break;
      }

      case 'PERLIN_FBM': {
        // Roca Orgánica con estratos geológicos y crestas naturales
        const macro = (noise.domainWarpFbm(px * 0.85, py * 0.85, pz * 0.85, octaves, roughness) - 0.5) * 1.3;
        const ridges = (noise.ridgedFbm(px * 1.2 + 3.1, py * 1.2 + 5.7, pz * 1.2 + 1.4, Math.max(2, octaves - 1), roughness) - 0.4) * 0.5;
        displacementAmount = macro + ridges;
        break;
      }

      case 'SIMPLEX_TURBULENCE': {
        // Pliegues y turbulencia orgánica profunda
        const turb = noise.turbulence(px * 0.95, py * 0.95, pz * 0.95, octaves);
        displacementAmount = (turb - 0.55) * 1.25;
        break;
      }

      case 'MICRO_PORES_3D': {
        // Microporosidad y textura superficial fina de alta frecuencia
        const n1 = (noise.noise(px * 3.2, py * 3.2, pz * 3.2)) * 0.6;
        const n2 = (noise.noise(px * 6.5, py * 6.5, pz * 6.5)) * 0.3;
        const n3 = (noise.noise(px * 13.0, py * 13.0, pz * 13.0)) * 0.15;
        displacementAmount = n1 + n2 + n3;
        break;
      }

      case 'CRATER_EROSION': {
        // Hendiduras y cráteres cóncavos con bordes erosionados
        const vor = noise.voronoi(px * 0.75, py * 0.75, pz * 0.75);
        const pit = -Math.pow(Math.max(0, 1.0 - vor.f1 * 1.35), 1.6);
        const rim = Math.pow(Math.max(0, 1.0 - Math.abs(vor.f1 - 0.4) * 3.0), 2.0) * 0.35;
        const roughnessDetail = (noise.fbm(px * 2.2, py * 2.2, pz * 2.2, 2, 0.4) - 0.5) * 0.25;
        displacementAmount = pit + rim + roughnessDetail;
        break;
      }

      default: {
        const fbmVal = noise.fbm(px, py, pz, octaves, roughness);
        displacementAmount = (fbmVal - 0.5) * 1.2;
        break;
      }
    }

    // Escalar desplazamiento por el tamaño global de la malla
    const safeIntensity = intensity * bboxRadius * 0.85;
    const finalVec = dispDir.clone().multiplyScalar(displacementAmount * safeIntensity);
    clusterDisplacements.set(k, finalVec);
  });

  // 7. Aplicar el desplazamiento exacto a todos los vértices según su cluster
  const newVertices: V3[] = new Array(nVerts);

  for (let i = 0; i < nVerts; i++) {
    const orig = vertices[i];
    const k = posKey(orig);
    const disp = clusterDisplacements.get(k) || new THREE.Vector3(0, 0, 0);

    newVertices[i] = [
      orig[0] + disp.x,
      orig[1] + disp.y,
      orig[2] + disp.z,
    ];
  }

  // 8. Relajación laplaciana suave para eliminar arrugas excesivas o polígonos degenerados
  const relaxedVertices: V3[] = newVertices.map(v => [...v] as V3);
  const clusterRelaxed = new Map<string, THREE.Vector3>();

  clusterMap.forEach((_, k) => {
    const nbrs = clusterNeighbors.get(k);
    if (!nbrs || nbrs.size === 0) return;
    
    // Obtener la posición desplazada de este cluster
    const firstIdx = clusterMap.get(k)![0];
    const curP = new THREE.Vector3(...newVertices[firstIdx]);
    
    // Promedio de posiciones de los clusters vecinos
    const avgNeighborP = new THREE.Vector3();
    nbrs.forEach(nbrK => {
      const nbrFirstIdx = clusterMap.get(nbrK)![0];
      avgNeighborP.add(new THREE.Vector3(...newVertices[nbrFirstIdx]));
    });
    avgNeighborP.divideScalar(nbrs.size);

    // Relajación muy sutil (8% hacia el promedio de vecinos) para regularizar la cuadrícula
    const relaxed = curP.clone().lerp(avgNeighborP, 0.08);
    clusterRelaxed.set(k, relaxed);
  });

  for (let i = 0; i < nVerts; i++) {
    const orig = vertices[i];
    const k = posKey(orig);
    const rel = clusterRelaxed.get(k);
    if (rel) {
      relaxedVertices[i] = [rel.x, rel.y, rel.z];
    }
  }

  return {
    vertices: relaxedVertices,
    faces: faces.map(f => ({ ...f }))
  };
}
