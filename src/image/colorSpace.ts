import type { Rgb } from "../core/constants";

export interface Lab {
  l: number;
  a: number;
  b: number;
}

const D65_X = 95.047;
const D65_Y = 100.0;
const D65_Z = 108.883;

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function pivot(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** sRGB (0..255) to CIELAB under D65. Used by the quality quantizer only. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) * 100;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) * 100;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) * 100;

  const fx = pivot(x / D65_X);
  const fy = pivot(y / D65_Y);
  const fz = pivot(z / D65_Z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function squaredRgbDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function squaredLabDistance(a: Lab, b: Lab): number {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
}

/** Plain CIE76 delta-E. Reporting/QA only, never used in the hot remap loop. */
export function deltaE76(a: Rgb, b: Rgb): number {
  return Math.sqrt(squaredLabDistance(rgbToLab(a.r, a.g, a.b), rgbToLab(b.r, b.g, b.b)));
}
