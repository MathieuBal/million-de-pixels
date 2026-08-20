import type { Rgb } from "../../core/constants";
import { rgbToLab, squaredLabDistance, type Lab } from "../colorSpace";
import type { Histogram } from "./histogram";

/**
 * Lloyd refinement seeded by Median Cut.
 *
 * Runs over the weighted histogram (<= 32_768 points), never over the raw
 * million pixels, and in Lab space so the movement of a centroid tracks
 * perceived error rather than raw channel error. Deterministic: the seeding
 * comes from Median Cut and empty clusters are re-seeded from the point that
 * currently carries the worst error, not from a random draw.
 */
export function refineKMeans(
  histogram: Histogram,
  seed: readonly Rgb[],
  maxIterations = 6,
  epsilon = 0.5,
): Rgb[] {
  const k = seed.length;
  if (k === 0 || histogram.distinctBuckets === 0) return seed.slice();

  const n = histogram.distinctBuckets;
  const pointLab: Lab[] = new Array(n);
  for (let i = 0; i < n; i++) {
    pointLab[i] = rgbToLab(histogram.r[i], histogram.g[i], histogram.b[i]);
  }

  let centroids: Lab[] = seed.map((c) => rgbToLab(c.r, c.g, c.b));
  const assignment = new Int32Array(n).fill(-1);

  const weight = new Float64Array(k);
  const sumL = new Float64Array(k);
  const sumA = new Float64Array(k);
  const sumB = new Float64Array(k);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    weight.fill(0);
    sumL.fill(0);
    sumA.fill(0);
    sumB.fill(0);

    let worstPoint = 0;
    let worstError = -1;

    for (let i = 0; i < n; i++) {
      const point = pointLab[i];
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c++) {
        const d = squaredLabDistance(point, centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignment[i] = best;

      const w = histogram.counts[i];
      weight[best] += w;
      sumL[best] += point.l * w;
      sumA[best] += point.a * w;
      sumB[best] += point.b * w;

      const error = bestD * w;
      if (error > worstError) {
        worstError = error;
        worstPoint = i;
      }
    }

    let movement = 0;
    const next: Lab[] = new Array(k);
    for (let c = 0; c < k; c++) {
      if (weight[c] === 0) {
        // Re-seed the starved centroid onto the currently worst-served color.
        next[c] = pointLab[worstPoint];
        movement += squaredLabDistance(next[c], centroids[c]);
        continue;
      }
      next[c] = {
        l: sumL[c] / weight[c],
        a: sumA[c] / weight[c],
        b: sumB[c] / weight[c],
      };
      movement += squaredLabDistance(next[c], centroids[c]);
    }

    centroids = next;
    if (movement < epsilon) break;
  }

  // Convert back through the weighted RGB mean of each cluster, so the final
  // palette entries are real colors of the image rather than Lab round trips.
  const outWeight = new Float64Array(k);
  const outR = new Float64Array(k);
  const outG = new Float64Array(k);
  const outB = new Float64Array(k);

  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < k; c++) {
      const d = squaredLabDistance(pointLab[i], centroids[c]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const w = histogram.counts[i];
    outWeight[best] += w;
    outR[best] += histogram.r[i] * w;
    outG[best] += histogram.g[i] * w;
    outB[best] += histogram.b[i] * w;
  }

  const result: Rgb[] = [];
  for (let c = 0; c < k; c++) {
    if (outWeight[c] === 0) {
      result.push(seed[c]);
      continue;
    }
    result.push({
      r: Math.round(outR[c] / outWeight[c]),
      g: Math.round(outG[c] / outWeight[c]),
      b: Math.round(outB[c] / outWeight[c]),
    });
  }
  return result;
}
