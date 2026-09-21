/**
 * viewportCapture.ts
 * Captures snapshots/thumbnails of the main 3D Three.js viewport canvas.
 */

export interface CaptureOptions {
  width?: number;
  height?: number;
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;
}

/**
 * Finds the primary 3D viewport canvas element in the DOM
 */
export function getViewportCanvas(): HTMLCanvasElement | null {
  const byId = document.getElementById('main-viewport-canvas') as HTMLCanvasElement | null;
  if (byId && byId instanceof HTMLCanvasElement) return byId;

  // Fallback: search for three.js canvas with positive dimensions
  const canvases = Array.from(document.querySelectorAll('canvas'));
  const viewportCanvas = canvases.find(c => {
    return c.clientWidth > 250 && c.clientHeight > 250 && !c.id.includes('preview') && !c.id.includes('uv');
  });

  return viewportCanvas || (canvases[0] as HTMLCanvasElement) || null;
}

/**
 * Captures a snapshot of the current 3D viewport scene as a base64 Data URL
 */
export function captureViewportSnapshot(options: CaptureOptions = {}): string | null {
  const canvas = getViewportCanvas();
  if (!canvas) return null;

  const targetWidth = options.width ?? 320;
  const targetHeight = options.height ?? 240;
  const format = options.format ?? 'image/jpeg';
  const quality = options.quality ?? 0.88;

  try {
    // If exact dimensions requested match or no downscale needed
    if (canvas.width <= 0 || canvas.height <= 0) return null;

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = targetWidth;
    thumbCanvas.height = targetHeight;
    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) {
      return canvas.toDataURL(format, quality);
    }

    // High quality downscaling
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Fill background neutral dark in case of alpha
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Fit image maintaining aspect ratio (contain)
    const srcW = canvas.width;
    const srcH = canvas.height;
    const scale = Math.min(targetWidth / srcW, targetHeight / srcH);
    const dstW = srcW * scale;
    const dstH = srcH * scale;
    const offsetX = (targetWidth - dstW) / 2;
    const offsetY = (targetHeight - dstH) / 2;

    ctx.drawImage(canvas, 0, 0, srcW, srcH, offsetX, offsetY, dstW, dstH);

    return thumbCanvas.toDataURL(format, quality);
  } catch (err) {
    console.warn('Could not capture viewport snapshot:', err);
    try {
      return canvas.toDataURL(format, quality);
    } catch {
      return null;
    }
  }
}

/**
 * Captures and downloads the current viewport scene as a PNG image file
 */
export function downloadViewportSnapshot(filename = 'escena_3d_captura.png', width?: number, height?: number): boolean {
  const canvas = getViewportCanvas();
  if (!canvas) return false;

  try {
    let dataUrl: string | null = null;
    if (width && height) {
      dataUrl = captureViewportSnapshot({ width, height, format: 'image/png' });
    } else {
      dataUrl = canvas.toDataURL('image/png');
    }

    if (!dataUrl) return false;

    const link = document.createElement('a');
    link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    console.error('Error downloading viewport snapshot:', err);
    return false;
  }
}
