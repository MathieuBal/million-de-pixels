import type { Rgb } from "../../core/constants";
import type { Histogram } from "./histogram";

/**
 * Heckbert-style median cut over the compressed histogram.
 *
 * A box holds a slice of the histogram point list. Splitting picks the box
 * with the largest weighted variance, cuts along its widest channel at the
 * population-weighted median, and stops as soon as no box can be split any
 * further — which is what makes `effectivePaletteSize` collapse to 1 on a
 * monochrome image instead of inventing phantom centroids.
 *
 * The algorithm is fully deterministic: no RNG, no input ordering surprises.
 */

interface Box {
  start: number;
  end: number; // exclusive
  weight: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
  score: number;
}

export type BoxSelection = "variance" | "range-population";

export interface MedianCutOptions {
  selection?: BoxSelection;
}

export function medianCut(
  histogram: Histogram,
  paletteSize: number,
  options: MedianCutOptions = {},
): Rgb[] {
  const selection = options.selection ?? "variance";
  const n = histogram.distinctBuckets;
  if (n === 0) return [];

  // Working permutation of the histogram points; boxes address slices of it.
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  const boxes: Box[] = [makeBox(histogram, order, 0, n, selection)];

  while (boxes.length < paletteSize) {
    let target = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.end - box.start < 2) continue;
      if (box.score > bestScore) {
        bestScore = box.score;
        target = i;
      }
    }
    if (target < 0) break; // every box is a single color: palette is saturated

    const split = splitBox(histogram, order, boxes[target], selection);
    if (!split) {
      boxes[target].score = 0;
      continue;
    }
    boxes[target] = split[0];
    boxes.push(split[1]);
  }

  return boxes.map((box) => boxAverage(histogram, order, box));
}

function channelValue(histogram: Histogram, point: number, channel: 0 | 1 | 2): number {
  return channel === 0 ? histogram.r[point] : channel === 1 ? histogram.g[point] : histogram.b[point];
}

function makeBox(
  histogram: Histogram,
  order: Uint32Array,
  start: number,
  end: number,
  selection: BoxSelection,
): Box {
  let weight = 0;
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;

  for (let i = start; i < end; i++) {
    const p = order[i];
    weight += histogram.counts[p];
    const r = histogram.r[p];
    const g = histogram.g[p];
    const b = histogram.b[p];
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }

  const box: Box = {
    start,
    end,
    weight,
    rMin,
    rMax,
    gMin,
    gMax,
    bMin,
    bMax,
    score: 0,
  };
  box.score = scoreBox(histogram, order, box, selection);
  return box;
}

function scoreBox(
  histogram: Histogram,
  order: Uint32Array,
  box: Box,
  selection: BoxSelection,
): number {
  if (box.end - box.start < 2) return 0;

  if (selection === "range-population") {
    const range = Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
    return range * box.weight;
  }

  // Population-weighted variance: favours boxes that actually hurt the image.
  const mean = boxAverage(histogram, order, box);
  let variance = 0;
  for (let i = box.start; i < box.end; i++) {
    const p = order[i];
    const w = histogram.counts[p];
    const dr = histogram.r[p] - mean.r;
    const dg = histogram.g[p] - mean.g;
    const db = histogram.b[p] - mean.b;
    variance += w * (dr * dr + dg * dg + db * db);
  }
  return variance;
}

function widestChannel(box: Box): 0 | 1 | 2 {
  const dr = box.rMax - box.rMin;
  const dg = box.gMax - box.gMin;
  const db = box.bMax - box.bMin;
  if (dr >= dg && dr >= db) return 0;
  if (dg >= db) return 1;
  return 2;
}

function splitBox(
  histogram: Histogram,
  order: Uint32Array,
  box: Box,
  selection: BoxSelection,
): [Box, Box] | null {
  const channel = widestChannel(box);

  const slice = Array.from(order.subarray(box.start, box.end));
  slice.sort((a, b) => {
    const delta = channelValue(histogram, a, channel) - channelValue(histogram, b, channel);
    return delta !== 0 ? delta : a - b; // stable, deterministic tie-break
  });
  order.set(slice, box.start);

  // Cut at the population-weighted median.
  const half = box.weight / 2;
  let accumulated = 0;
  let cut = box.start + 1;
  for (let i = box.start; i < box.end - 1; i++) {
    accumulated += histogram.counts[order[i]];
    if (accumulated >= half) {
      cut = i + 1;
      break;
    }
    cut = i + 2;
  }

  // The median lands outside the box whenever one point outweighs all the
  // others put together — a dominant colour sorted to either end. Clamping
  // rather than bailing out is what keeps the box splittable: giving up here
  // would freeze the palette early on any image with a dominant colour, which
  // is most posters and most illustrations.
  if (cut < box.start + 1) cut = box.start + 1;
  if (cut > box.end - 1) cut = box.end - 1;

  return [
    makeBox(histogram, order, box.start, cut, selection),
    makeBox(histogram, order, cut, box.end, selection),
  ];
}

function boxAverage(histogram: Histogram, order: Uint32Array, box: Box): Rgb {
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = box.start; i < box.end; i++) {
    const p = order[i];
    const w = histogram.counts[p];
    weight += w;
    r += histogram.r[p] * w;
    g += histogram.g[p] * w;
    b += histogram.b[p] * w;
  }
  if (weight === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: clamp255(Math.round(r / weight)),
    g: clamp255(Math.round(g / weight)),
    b: clamp255(Math.round(b / weight)),
  };
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
