import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

export interface HDROptions {
  maxDimension?: number; // Max resolution (e.g. 2048px or 1024px) to preserve high FPS
}

/**
 * Downsamples float or byte DataTexture bilinearly if it exceeds maxDimension.
 */
export function downsampleDataTexture(
  texture: THREE.DataTexture,
  maxDimension = 2048
): THREE.DataTexture {
  const image = texture.image;
  if (!image || !image.width || !image.height || !image.data) {
    return texture;
  }

  const srcW = image.width;
  const srcH = image.height;
  const maxSrc = Math.max(srcW, srcH);

  if (maxSrc <= maxDimension) {
    return texture;
  }

  const scale = maxDimension / maxSrc;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const srcData = image.data;
  const channels = 4; // RGBA
  
  const Ctor = srcData.constructor as new (length: number) => any;
  const dstData = new Ctor(dstW * dstH * channels);

  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const gy = (dy + 0.5) * yRatio - 0.5;
    const gyi = Math.floor(gy);
    const fy = gy - gyi;
    const y0 = Math.max(0, Math.min(srcH - 1, gyi));
    const y1 = Math.max(0, Math.min(srcH - 1, gyi + 1));

    for (let dx = 0; dx < dstW; dx++) {
      const gx = (dx + 0.5) * xRatio - 0.5;
      const gxi = Math.floor(gx);
      const fx = gx - gxi;
      const x0 = Math.max(0, Math.min(srcW - 1, gxi));
      const x1 = Math.max(0, Math.min(srcW - 1, gxi + 1));

      const i00 = (y0 * srcW + x0) * channels;
      const i10 = (y0 * srcW + x1) * channels;
      const i01 = (y1 * srcW + x0) * channels;
      const i11 = (y1 * srcW + x1) * channels;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const dstIdx = (dy * dstW + dx) * channels;

      for (let c = 0; c < channels; c++) {
        const v =
          (srcData[i00 + c] || 0) * w00 +
          (srcData[i10 + c] || 0) * w10 +
          (srcData[i01 + c] || 0) * w01 +
          (srcData[i11 + c] || 0) * w11;
        dstData[dstIdx + c] = v;
      }
    }
  }

  const resizedTex = new THREE.DataTexture(
    dstData,
    dstW,
    dstH,
    (texture.format as THREE.PixelFormat) || THREE.RGBAFormat,
    texture.type || THREE.FloatType
  );
  resizedTex.mapping = THREE.EquirectangularReflectionMapping;
  resizedTex.minFilter = THREE.LinearFilter;
  resizedTex.magFilter = THREE.LinearFilter;
  resizedTex.needsUpdate = true;

  texture.dispose();
  return resizedTex;
}

/**
 * Downsamples standard HTML image element (JPG, PNG, WEBP) via 2D Canvas.
 */
export function downsampleImageTexture(
  texture: THREE.Texture,
  maxDimension = 2048
): THREE.Texture {
  const img = texture.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  if (!img || !img.width || !img.height) return texture;

  const srcW = img.width;
  const srcH = img.height;
  const maxSrc = Math.max(srcW, srcH);

  if (maxSrc <= maxDimension) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    return texture;
  }

  const scale = maxDimension / maxSrc;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0, dstW, dstH);
  }

  const resizedTex = new THREE.CanvasTexture(canvas);
  resizedTex.mapping = THREE.EquirectangularReflectionMapping;
  resizedTex.colorSpace = THREE.SRGBColorSpace;
  resizedTex.needsUpdate = true;

  texture.dispose();
  return resizedTex;
}

/**
 * Automatically loads any HDRI / EXR / Image environment map,
 * identifies format, and downscales if resolution is too large to maintain high FPS.
 */
export async function loadOptimizedEnvironmentTexture(
  url: string,
  options: HDROptions = {}
): Promise<THREE.Texture> {
  const maxDim = options.maxDimension || 2048;
  const lowerUrl = url.toLowerCase();

  const isEXR = lowerUrl.includes('.exr') || url.startsWith('data:image/x-exr') || url.startsWith('data:application/x-exr');
  const isHDR = lowerUrl.includes('.hdr') || url.startsWith('data:image/vnd.radiance');

  if (isEXR) {
    const loader = new EXRLoader();
    // Force FloatType for linear arithmetic downscaling
    loader.setDataType(THREE.FloatType);
    const tex = await loader.loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return downsampleDataTexture(tex as THREE.DataTexture, maxDim);
  } else if (isHDR) {
    const loader = new HDRLoader();
    const tex = await loader.loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return downsampleDataTexture(tex as THREE.DataTexture, maxDim);
  } else {
    // Attempt HDRLoader -> EXRLoader -> TextureLoader
    try {
      const loader = new HDRLoader();
      const tex = await loader.loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return downsampleDataTexture(tex as THREE.DataTexture, maxDim);
    } catch {
      try {
        const exrLoader = new EXRLoader();
        exrLoader.setDataType(THREE.FloatType);
        const tex = await exrLoader.loadAsync(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        return downsampleDataTexture(tex as THREE.DataTexture, maxDim);
      } catch {
        const texLoader = new THREE.TextureLoader();
        const tex = await texLoader.loadAsync(url);
        return downsampleImageTexture(tex, maxDim);
      }
    }
  }
}
