/**
 * numberUtils.ts - Utilidades matemáticas y formateo ultra-seguro contra crashes de .toFixed()
 * y números degenerados (NaN, Infinity, undefined, null, strings vacíos) en Electron/Windows.
 */

export function safeNum(val: any, fallback: number = 0): number {
  if (val === null || val === undefined || val === '') return fallback;
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function safeFixed(val: any, digits: number = 2, fallback: number = 0): string {
  const n = safeNum(val, fallback);
  const d = Math.max(0, Math.min(20, Math.floor(safeNum(digits, 2))));
  try {
    return n.toFixed(d);
  } catch {
    return (0).toFixed(d);
  }
}

export function safeParseFixed(val: any, digits: number = 2, fallback: number = 0): number {
  const s = safeFixed(val, digits, fallback);
  const parsed = parseFloat(s);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeVec3Key(x: any, y: any, z: any, digits: number = 4): string {
  return `${safeFixed(x, digits)},${safeFixed(y, digits)},${safeFixed(z, digits)}`;
}

export function safeClamp(val: any, min: number, max: number, fallback: number = 0): number {
  const n = safeNum(val, fallback);
  return Math.max(min, Math.min(max, n));
}

/**
 * Instalación de shims de protección global para Electron / Windows
 */
export function installGlobalNumberSafetyShims() {
  if (typeof window === 'undefined') return;

  // 1. Proteger Number.prototype.toFixed
  const originalNumberToFixed = Number.prototype.toFixed;
  Number.prototype.toFixed = function (digits?: number) {
    const val = Number(this);
    const d = Math.max(0, Math.min(20, typeof digits === 'number' && !isNaN(digits) ? Math.floor(digits) : 0));
    if (!Number.isFinite(val)) {
      return (0).toFixed(d);
    }
    try {
      return originalNumberToFixed.call(val, d);
    } catch {
      return (0).toFixed(d);
    }
  };

  // 2. Proteger String.prototype.toFixed por si alguna variable string llama .toFixed()
  if (!(String.prototype as any).toFixed) {
    (String.prototype as any).toFixed = function (digits?: number) {
      const num = parseFloat(this);
      const safe = Number.isFinite(num) ? num : 0;
      return safe.toFixed(digits);
    };
  }
}
