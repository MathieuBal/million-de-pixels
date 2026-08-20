import type { Rgb } from "../../core/constants";
import { buildHistogram, type Histogram } from "./histogram";
import { medianCut } from "./medianCut";
import { refineKMeans } from "./kmeans";
import { mapPixels, type MappingResult } from "./mapping";

export type QuantizerKind = "median-cut" | "median-cut+kmeans";

export interface QuantizeOptions {
  paletteSize: number;
  quantizer: QuantizerKind;
  alphaThreshold: number;
}

export interface QuantizeResult extends MappingResult {
  palette: Rgb[];
  histogram: Histogram;
}

/**
 * Full CPU pipeline: histogram -> palette -> optional refinement -> remap.
 * Pure and synchronous so it can run identically in the worker and in tests.
 */
export function quantize(
  rgba: Uint8ClampedArray | Uint8Array,
  options: QuantizeOptions,
): QuantizeResult {
  const histogram = buildHistogram(rgba, options.alphaThreshold);

  // Never ask for more colors than the image actually contains.
  const effectiveK = Math.min(options.paletteSize, histogram.distinctBuckets);

  let palette = medianCut(histogram, effectiveK);
  if (options.quantizer === "median-cut+kmeans" && palette.length > 1) {
    palette = refineKMeans(histogram, palette);
  }
  palette = dedupePalette(palette);

  const mapped = mapPixels(rgba, palette, options.alphaThreshold);
  return { ...mapped, palette, histogram };
}

/**
 * Drops exact duplicates so two palette slots can never fight over the same
 * color — one of them would receive zero pixels and produce a dead card.
 */
function dedupePalette(palette: readonly Rgb[]): Rgb[] {
  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (const c of palette) {
    const key = (c.r << 16) | (c.g << 8) | c.b;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export { buildHistogram, medianCut, refineKMeans, mapPixels };
export type { Histogram, MappingResult };
