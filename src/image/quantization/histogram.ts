/**
 * 5-bits-per-channel color histogram.
 *
 * Quantizing directly over 1_048_576 pixels is wasteful for K <= 16. The
 * histogram compresses the source to at most 32_768 weighted points, which is
 * what both Median Cut and the k-means refinement actually consume.
 */
export const HIST_BITS = 5;
export const HIST_LEVELS = 1 << HIST_BITS; // 32
export const HIST_SIZE = HIST_LEVELS ** 3; // 32_768

export interface Histogram {
  /** Populated bucket indices only. */
  readonly buckets: Uint32Array;
  /** Weight (pixel count) of each populated bucket. */
  readonly counts: Uint32Array;
  /** Mean color of each populated bucket, 0..255 per channel. */
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
  readonly totalWeight: number;
  /** Number of distinct 5-bit buckets, i.e. an upper bound on useful K. */
  readonly distinctBuckets: number;
}

export function bucketIndex(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

export function buildHistogram(rgba: Uint8ClampedArray | Uint8Array, alphaThreshold: number): Histogram {
  const count = new Uint32Array(HIST_SIZE);
  const sumR = new Uint32Array(HIST_SIZE);
  const sumG = new Uint32Array(HIST_SIZE);
  const sumB = new Uint32Array(HIST_SIZE);

  let totalWeight = 0;

  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] < alphaThreshold) continue;

    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];

    const h = bucketIndex(r, g, b);
    count[h]++;
    sumR[h] += r;
    sumG[h] += g;
    sumB[h] += b;
    totalWeight++;
  }

  let distinct = 0;
  for (let i = 0; i < HIST_SIZE; i++) if (count[i] !== 0) distinct++;

  const buckets = new Uint32Array(distinct);
  const counts = new Uint32Array(distinct);
  const meanR = new Float64Array(distinct);
  const meanG = new Float64Array(distinct);
  const meanB = new Float64Array(distinct);

  let cursor = 0;
  for (let i = 0; i < HIST_SIZE; i++) {
    const c = count[i];
    if (c === 0) continue;
    buckets[cursor] = i;
    counts[cursor] = c;
    meanR[cursor] = sumR[i] / c;
    meanG[cursor] = sumG[i] / c;
    meanB[cursor] = sumB[i] / c;
    cursor++;
  }

  return {
    buckets,
    counts,
    r: meanR,
    g: meanG,
    b: meanB,
    totalWeight,
    distinctBuckets: distinct,
  };
}
