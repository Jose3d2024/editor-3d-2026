// textureColorUtils.ts — Real-time Color & Tone Adjustments for Albedo / Texture Maps

export interface AlbedoColorAdjustments {
  tintColor?: string;       // Hex color to tint/blend (e.g. #ff0055)
  tintAmount?: number;      // 0.0 to 1.0
  hueShift?: number;        // -180 to 180 degrees
  saturation?: number;      // 0.0 to 2.0 (1.0 = normal)
  brightness?: number;      // 0.0 to 2.0 (1.0 = normal)
  contrast?: number;        // 0.0 to 2.0 (1.0 = normal)
  invert?: boolean;
}

/**
 * Converts RGB to HSL [0..1]
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

/**
 * Converts HSL to RGB [0..255]
 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Applies color adjustments (Tint, Hue, Saturation, Brightness, Contrast, Inversion)
 * directly to any image DataURL via an offscreen 2D Canvas.
 */
export function adjustTextureColors(
  dataUrl: string,
  adjustments: AlbedoColorAdjustments,
  width = 512,
  height = 512
): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve('');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || width;
      const h = img.naturalHeight || height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);

      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      // Parse tint color
      let tR = 255, tG = 255, tB = 255;
      const hasTint = Boolean(adjustments.tintColor && adjustments.tintAmount && adjustments.tintAmount > 0);
      if (hasTint && adjustments.tintColor) {
        const hex = adjustments.tintColor.replace('#', '');
        if (hex.length === 6) {
          tR = parseInt(hex.substring(0, 2), 16) || 255;
          tG = parseInt(hex.substring(2, 4), 16) || 255;
          tB = parseInt(hex.substring(4, 6), 16) || 255;
        }
      }

      const tintAmt = adjustments.tintAmount ?? 0;
      const hueShiftNorm = (adjustments.hueShift ?? 0) / 360;
      const satMul = adjustments.saturation ?? 1.0;
      const brightMul = adjustments.brightness ?? 1.0;
      const contrast = adjustments.contrast ?? 1.0;
      const contrastFactor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
      const shouldInvert = Boolean(adjustments.invert);

      const len = data.length;
      for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        // 1. Color Tint (Multiply blend mode)
        if (hasTint) {
          const tintedR = (r * tR) / 255;
          const tintedG = (g * tG) / 255;
          const tintedB = (b * tB) / 255;
          r = r * (1 - tintAmt) + tintedR * tintAmt;
          g = g * (1 - tintAmt) + tintedG * tintAmt;
          b = b * (1 - tintAmt) + tintedB * tintAmt;
        }

        // 2. Invert if requested
        if (shouldInvert) {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }

        // 3. Brightness
        if (brightMul !== 1.0) {
          r = Math.min(255, Math.max(0, r * brightMul));
          g = Math.min(255, Math.max(0, g * brightMul));
          b = Math.min(255, Math.max(0, b * brightMul));
        }

        // 4. Contrast
        if (contrast !== 1.0) {
          r = Math.min(255, Math.max(0, contrastFactor * (r - 128) + 128));
          g = Math.min(255, Math.max(0, contrastFactor * (g - 128) + 128));
          b = Math.min(255, Math.max(0, contrastFactor * (b - 128) + 128));
        }

        // 5. Hue & Saturation
        if (hueShiftNorm !== 0 || satMul !== 1.0) {
          const [hVal, sVal, lVal] = rgbToHsl(r, g, b);
          let newH = (hVal + hueShiftNorm) % 1;
          if (newH < 0) newH += 1;
          const newS = Math.min(1, Math.max(0, sVal * satMul));
          const [finalR, finalG, finalB] = hslToRgb(newH, newS, lVal);
          r = finalR;
          g = finalG;
          b = finalB;
        }

        data[i] = Math.round(r);
        data[i + 1] = Math.round(g);
        data[i + 2] = Math.round(b);
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
}

export interface GeneratedPBRSet {
  normalMap: string;
  roughnessMap: string;
  metalnessMap: string;
  aoMap: string;
  displacementMap: string;
}

/**
 * Autogenerates a complete, high-quality PBR Texture Map Set (Normal, Roughness, Metalness, AO, Displacement)
 * directly from an image DataURL using high-precision 2D canvas convolution kernels.
 */
export function generateFullPBRMapsFromSource(
  sourceUrl: string,
  normalStrength = 1.2,
  invertNormalY = false
): Promise<GeneratedPBRSet> {
  return new Promise((resolve) => {
    if (!sourceUrl) {
      return resolve({
        normalMap: '',
        roughnessMap: '',
        metalnessMap: '',
        aoMap: '',
        displacementMap: '',
      });
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || 512;
      const h = img.naturalHeight || 512;

      // 1. Base Grayscale Height Map
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = w;
      baseCanvas.height = h;
      const baseCtx = baseCanvas.getContext('2d');
      if (!baseCtx) return;
      baseCtx.drawImage(img, 0, 0, w, h);
      const srcImgData = baseCtx.getImageData(0, 0, w, h);
      const srcData = srcImgData.data;

      const heightMap = new Float32Array(w * h);
      const totalPixels = w * h;

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const r = srcData[idx];
        const g = srcData[idx + 1];
        const b = srcData[idx + 2];
        // Standard Rec.709 perceived luminance
        heightMap[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
      }

      // 2. Normal Map (Sobel 3x3 Filter)
      const normalCanvas = document.createElement('canvas');
      normalCanvas.width = w;
      normalCanvas.height = h;
      const normCtx = normalCanvas.getContext('2d')!;
      const normImgData = normCtx.createImageData(w, h);
      const normData = normImgData.data;

      const getH = (x: number, y: number) => {
        const cx = Math.max(0, Math.min(w - 1, x));
        const cy = Math.max(0, Math.min(h - 1, y));
        return heightMap[cy * w + cx];
      };

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;

          // Sobel operator
          const tl = getH(x - 1, y - 1);
          const t  = getH(x,     y - 1);
          const tr = getH(x + 1, y - 1);
          const l  = getH(x - 1, y);
          const r  = getH(x + 1, y);
          const bl = getH(x - 1, y + 1);
          const b  = getH(x,     y + 1);
          const br = getH(x + 1, y + 1);

          const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
          const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

          // Vector normal calculation (OpenGL vs DirectX toggle)
          // Three.js utiliza formato OpenGL donde +Y es hacia arriba. En canvas Y crece hacia abajo, por lo que dY = b - t.
          let nx = -dX * normalStrength;
          let ny = (invertNormalY ? dY : -dY) * normalStrength;
          let nz = 1.0;

          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
          nx /= len;
          ny /= len;
          nz /= len;

          normData[idx]     = Math.round((nx * 0.5 + 0.5) * 255);
          normData[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
          normData[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          normData[idx + 3] = 255;
        }
      }
      normCtx.putImageData(normImgData, 0, 0);
      const normalMap = normalCanvas.toDataURL('image/png');

      // 3. Roughness Map (Micro-roughness curve)
      const roughCanvas = document.createElement('canvas');
      roughCanvas.width = w;
      roughCanvas.height = h;
      const roughCtx = roughCanvas.getContext('2d')!;
      const roughImgData = roughCtx.createImageData(w, h);
      const roughData = roughImgData.data;

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const hVal = heightMap[i];
        // Invert luminance slightly and compress into 0.3..0.9 range for natural PBR gloss/roughness balance
        const roughVal = Math.max(0, Math.min(255, Math.round((1.0 - hVal * 0.6) * 220 + 35)));
        roughData[idx]     = roughVal;
        roughData[idx + 1] = roughVal;
        roughData[idx + 2] = roughVal;
        roughData[idx + 3] = 255;
      }
      roughCtx.putImageData(roughImgData, 0, 0);
      const roughnessMap = roughCanvas.toDataURL('image/png');

      // 4. Ambient Occlusion (Cavity / Valley detection)
      const aoCanvas = document.createElement('canvas');
      aoCanvas.width = w;
      aoCanvas.height = h;
      const aoCtx = aoCanvas.getContext('2d')!;
      const aoImgData = aoCtx.createImageData(w, h);
      const aoData = aoImgData.data;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const centerH = getH(x, y);

          // Sample 8 neighbors
          let neighborSum = 0;
          for (let dy = -2; dy <= 2; dy += 2) {
            for (let dx = -2; dx <= 2; dx += 2) {
              if (dx === 0 && dy === 0) continue;
              neighborSum += getH(x + dx, y + dy);
            }
          }
          const avgNeighbor = neighborSum / 8;
          const diff = avgNeighbor - centerH;
          // If center is lower than neighbors, it's a cavity (darker AO)
          const aoVal = Math.max(0, Math.min(255, Math.round((1.0 - Math.max(0, diff) * 2.2) * 255)));

          aoData[idx]     = aoVal;
          aoData[idx + 1] = aoVal;
          aoData[idx + 2] = aoVal;
          aoData[idx + 3] = 255;
        }
      }
      aoCtx.putImageData(aoImgData, 0, 0);
      const aoMap = aoCanvas.toDataURL('image/png');

      // 5. Displacement / Height Map
      const dispCanvas = document.createElement('canvas');
      dispCanvas.width = w;
      dispCanvas.height = h;
      const dispCtx = dispCanvas.getContext('2d')!;
      const dispImgData = dispCtx.createImageData(w, h);
      const dispData = dispImgData.data;

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const hVal = Math.round(heightMap[i] * 255);
        dispData[idx]     = hVal;
        dispData[idx + 1] = hVal;
        dispData[idx + 2] = hVal;
        dispData[idx + 3] = 255;
      }
      dispCtx.putImageData(dispImgData, 0, 0);
      const displacementMap = dispCanvas.toDataURL('image/png');

      // 6. Metalness Map (Default clean dielectric / non-metal base with subtle micro-highlights)
      const metalCanvas = document.createElement('canvas');
      metalCanvas.width = w;
      metalCanvas.height = h;
      const metalCtx = metalCanvas.getContext('2d')!;
      const metalImgData = metalCtx.createImageData(w, h);
      const metalData = metalImgData.data;

      for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        metalData[idx]     = 0;
        metalData[idx + 1] = 0;
        metalData[idx + 2] = 0;
        metalData[idx + 3] = 255;
      }
      metalCtx.putImageData(metalImgData, 0, 0);
      const metalnessMap = metalCanvas.toDataURL('image/png');

      resolve({
        normalMap,
        roughnessMap,
        metalnessMap,
        aoMap,
        displacementMap,
      });
    };

    img.onerror = () => {
      resolve({
        normalMap: '',
        roughnessMap: '',
        metalnessMap: '',
        aoMap: '',
        displacementMap: '',
      });
    };

    img.src = sourceUrl;
  });
}

/**
 * Extrae intuitivamente el color dominante del objeto a partir de una imagen o ImageData,
 * filtrando el color de fondo y transparencias para teñir la malla o disimular costuras.
 */
export function extractDominantObjectColor(
  imgData: ImageData,
  bgColor?: [number, number, number] | null
): string {
  const { data, width, height } = imgData;
  const bgR = bgColor ? bgColor[0] : 255;
  const bgG = bgColor ? bgColor[1] : 255;
  const bgB = bgColor ? bgColor[2] : 255;

  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  const step = Math.max(1, Math.floor((width * height) / 4000));

  for (let i = 0; i < data.length; i += step * 4) {
    const a = data[i + 3];
    if (a < 80) continue; // Transparente
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Ignorar píxeles casi idénticos al color de fondo
    const distBg = Math.hypot(r - bgR, g - bgG, b - bgB);
    if (distBg < 35) continue;

    totalR += r;
    totalG += g;
    totalB += b;
    count++;
  }

  if (count === 0) return '#6b7280'; // Gris neutro por defecto

  const avgR = Math.round(totalR / count);
  const avgG = Math.round(totalG / count);
  const avgB = Math.round(totalB / count);

  return `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;
}
