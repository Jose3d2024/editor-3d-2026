/**
 * MaterialThumbnail.tsx
 *
 * Renders a real-time Three.js preview of a MaterialData onto a small canvas.
 * Shows a sphere (default), cylinder (for metals), or plane (for fabrics/wood).
 * Emissive materials glow correctly. Transparent materials show glass effect.
 */

import React, { useEffect, useState, memo } from 'react';
import type { MaterialData } from '../types';
import { thumbnailRenderer } from '../utils/thumbnailRenderer';

interface Props {
  material: MaterialData;
  size?: number;
  shape?: 'sphere' | 'box' | 'cylinder' | 'torus';
}

function pickShape(mat: MaterialData): 'sphere' | 'box' | 'cylinder' | 'torus' {
  const name = mat.name.toLowerCase();
  if (name.includes('madera') || name.includes('roble') || name.includes('wood')) return 'box';
  if (name.includes('toro') || name.includes('toroide') || name.includes('torus')) return 'torus';
  if (name.includes('tubo') || name.includes('cilindro')) return 'cylinder';
  return 'sphere';
}

export const MaterialThumbnail: React.FC<Props> = memo(({ material, size = 44, shape: forcedShape }) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const shape = forcedShape ?? pickShape(material);

    thumbnailRenderer.renderThumbnail(material, size, shape)
      .then(url => {
        if (active) setThumbnailUrl(url);
      })
      .catch(err => {
        console.error('Thumbnail generation failed:', err);
      });

    return () => {
      active = false;
    };
  }, [
    material.color, material.roughness, material.metalness,
    material.emissive, material.emissiveIntensity,
    material.transparent, material.opacity,
    material.transmission, material.ior, material.thickness,
    material.map, material.normalMap, material.roughnessMap, material.normalScale,
    material.id, material.csmConfig, (material as any).csmPreset, material.customShaderMaterial, material.category,
    size, forcedShape,
  ]);

  if (!thumbnailUrl) {
    return (
      <div 
        className="rounded-full bg-zinc-800 animate-pulse" 
        style={{ width: size, height: size }} 
      />
    );
  }

  return (
    <img
      src={thumbnailUrl}
      alt={material.name}
      width={size}
      height={size}
      className="rounded-full block object-cover"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
    />
  );
});

MaterialThumbnail.displayName = 'MaterialThumbnail';
