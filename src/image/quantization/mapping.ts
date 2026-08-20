import { PIXEL_COUNT, VOID, type Rgb } from "../../core/constants";

export interface MappingResult {
  colorId: Uint8Array;
  counts: Uint32Array;
  playablePixels: number;
  voidPixels: number;
}

/**
 * Nearest palette entry by squared RGB distance.
 *
 * K <= 16 so an exhaustive scan beats any acceleration structure, and it keeps
 * the remap loop allocation free.
 */
export function nearestPaletteId(r: number, g: number, b: number, palette: readonly Rgb[]): number {
  let bestId = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let id = 0; id < palette.length; id++) {
    const c = palette[id];
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Turns the RGBA staging buffer into the authoritative Uint8Array of color ids.
 *
 * No dithering: colors carry gameplay meaning here, so scattering red pixels
 * into an orange region would invent targets the source image never had.
 */
export function mapPixels(
  rgba: Uint8ClampedArray | Uint8Array,
  palette: readonly Rgb[],
  alphaThreshold: number,
): MappingResult {
  const pixels = rgba.length >> 2;
  const colorId = new Uint8Array(pixels);
  const counts = new Uint32Array(Math.max(palette.length, 1));

  let voidPixels = 0;

  for (let i = 0; i < pixels; i++) {
    const p = i << 2;
    if (rgba[p + 3] < alphaThreshold || palette.length === 0) {
      colorId[i] = VOID;
      voidPixels++;
      continue;
    }
    const id = nearestPaletteId(rgba[p], rgba[p + 1], rgba[p + 2], palette);
    colorId[i] = id;
    counts[id]++;
  }

  return {
    colorId,
    counts,
    playablePixels: pixels - voidPixels,
    voidPixels,
  };
}

/** sum(counts) + void === total cells. Violating this means the level is corrupt. */
export function assertCountInvariant(
  counts: Uint32Array,
  voidPixels: number,
  total = PIXEL_COUNT,
): void {
  let sum = voidPixels;
  for (let i = 0; i < counts.length; i++) sum += counts[i];
  if (sum !== total) {
    throw new Error(`count invariant violated: ${sum} !== ${total}`);
  }
}
