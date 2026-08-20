import {
  MAX_PALETTE_SIZE,
  MIN_PALETTE_SIZE,
  rarityOf,
  type ColorRarity,
  type Rgb,
} from "../../core/constants";
import { rgbToLab, squaredLabDistance } from "../colorSpace";
import type { Histogram } from "./histogram";
import { medianCut } from "./medianCut";
import { refineKMeans } from "./kmeans";

/**
 * Weights of the palette score. Deliberately named and grouped so they can be
 * calibrated as one decision — these are opening values, not settled ones.
 *
 * The point of scoring rather than fitting: a visually optimal palette can be a
 * poor *game* palette. Sixteen shades of near-identical brown fit the image
 * beautifully and give the player nothing to tell apart or aim at.
 */
export const SCORE_WEIGHTS = {
  /** Perceptual fidelity: how close the quantized image stays to the source. */
  visualQuality: 0.4,
  /** How distinguishable the colours are from each other. */
  colorSeparation: 0.25,
  /** How playable the population spread is. */
  gameplayDistribution: 0.25,
  /** Penalty for clusters that are both tiny AND perceptually redundant. */
  tinyClusterPenalty: 0.1,
} as const;

/**
 * A cluster smaller than this is only kept when it is perceptually distinct.
 * It is never dropped for being small alone — a 0.3% colour may be the
 * character's eyes, and losing it degrades the image far more than the pixel
 * count suggests.
 */
const TINY_SHARE = 0.005;

/**
 * Lab distance above which a colour counts as genuinely its own, rather than a
 * splinter of its neighbour. Roughly the point where two colours stop reading
 * as shades of the same thing.
 */
const DISTINCT_LAB_DISTANCE = 18;

export interface PaletteCandidateColor extends Rgb {
  /** Share of the image estimated from histogram weights, in [0, 1]. */
  share: number;
  rarity: ColorRarity;
  /** Lab distance to the closest other entry of the same palette. */
  separation: number;
  /** Small AND not perceptually distinct: a splinter rather than a colour. */
  redundant: boolean;
}

export interface PaletteCandidate {
  k: number;
  colors: PaletteCandidateColor[];
  /** Population-weighted mean squared Lab error against the histogram. */
  error: number;
  score: number;
  breakdown: {
    visualQuality: number;
    colorSeparation: number;
    gameplayDistribution: number;
    tinyClusterPenalty: number;
  };
}

export interface PaletteAnalysis {
  palette: PaletteCandidateColor[];
  paletteSize: number;
  candidates: PaletteCandidate[];
  /** Colours kept despite being tiny, because they are visually distinct. */
  rareColors: number[];
}

export interface AnalyzePaletteOptions {
  minK?: number;
  maxK?: number;
  /** Run the Lloyd refinement on each candidate. Costlier, better palettes. */
  refine?: boolean;
}

/**
 * Chooses the palette the image should be played with.
 *
 * The player never picks this. For every candidate K the analyzer runs the
 * quantizer, measures the resulting palette on four axes, and keeps the best
 * total. All of it runs on the compressed histogram (at most 32 768 weighted
 * points), never on the million pixels, so exploring thirteen candidates costs
 * a few milliseconds.
 */
export function analyzePalette(
  histogram: Histogram,
  options: AnalyzePaletteOptions = {},
): PaletteAnalysis {
  const maxK = Math.min(options.maxK ?? MAX_PALETTE_SIZE, histogram.distinctBuckets);
  const minK = Math.min(options.minK ?? MIN_PALETTE_SIZE, maxK);

  if (maxK <= 0) {
    return { palette: [], paletteSize: 0, candidates: [], rareColors: [] };
  }

  const raw: Array<{ k: number; colors: PaletteCandidateColor[]; error: number }> = [];

  for (let k = minK; k <= maxK; k++) {
    let colors = medianCut(histogram, k);
    if (options.refine !== false && colors.length > 1) {
      colors = refineKMeans(histogram, colors);
    }
    colors = dedupe(colors);
    if (colors.length === 0) continue;

    raw.push({ k: colors.length, ...measure(histogram, colors) });
  }

  if (raw.length === 0) {
    return { palette: [], paletteSize: 0, candidates: [], rareColors: [] };
  }

  const candidates = score(raw);
  const winner = candidates.reduce((best, c) => (c.score > best.score ? c : best));

  return {
    palette: winner.colors,
    paletteSize: winner.colors.length,
    candidates,
    rareColors: winner.colors
      .map((color, id) => ({ color, id }))
      .filter(({ color }) => color.share < TINY_SHARE)
      .map(({ id }) => id),
  };
}

/** Population, separation and error of one candidate palette. */
function measure(
  histogram: Histogram,
  colors: Rgb[],
): { colors: PaletteCandidateColor[]; error: number } {
  const labs = colors.map((c) => rgbToLab(c.r, c.g, c.b));
  const weight = new Float64Array(colors.length);
  let error = 0;

  for (let i = 0; i < histogram.distinctBuckets; i++) {
    const point = rgbToLab(histogram.r[i], histogram.g[i], histogram.b[i]);

    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let id = 0; id < labs.length; id++) {
      const d = squaredLabDistance(point, labs[id]);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }

    const count = histogram.counts[i];
    weight[best] += count;
    error += bestD * count;
  }

  const total = Math.max(1, histogram.totalWeight);

  const measured: PaletteCandidateColor[] = colors.map((c, id) => {
    // Distance to the nearest *other* entry: how much this colour is its own.
    let separation = Number.POSITIVE_INFINITY;
    for (let other = 0; other < labs.length; other++) {
      if (other === id) continue;
      separation = Math.min(separation, Math.sqrt(squaredLabDistance(labs[id], labs[other])));
    }
    if (!Number.isFinite(separation)) separation = DISTINCT_LAB_DISTANCE * 2;

    const share = weight[id] / total;

    return {
      ...c,
      share,
      rarity: rarityOf(share),
      separation,
      // A colour is only a splinter when it is small *and* indistinct. Small
      // and distinct is a rare resource, and stays in the game.
      redundant: share < TINY_SHARE && separation < DISTINCT_LAB_DISTANCE,
    };
  });

  return { colors: measured, error: error / total };
}

/** Normalises the four axes across candidates and combines them. */
function score(
  raw: Array<{ k: number; colors: PaletteCandidateColor[]; error: number }>,
): PaletteCandidate[] {
  const errors = raw.map((c) => c.error);
  const minError = Math.min(...errors);
  const maxError = Math.max(...errors);

  const separations = raw.map((c) => meanWeakestSeparation(c.colors));
  const maxSeparation = Math.max(...separations, 1);

  return raw.map((candidate, index) => {
    // 1 when this candidate fits best, 0 when it fits worst.
    const visualQuality =
      maxError === minError ? 1 : (maxError - candidate.error) / (maxError - minError);

    const colorSeparation = Math.min(1, separations[index] / maxSeparation);

    const gameplayDistribution = distributionQuality(candidate.colors);

    // Only redundant splinters are penalised, weighted by how many there are.
    const redundant = candidate.colors.filter((c) => c.redundant).length;
    const tinyClusterPenalty = redundant / candidate.colors.length;

    const total =
      SCORE_WEIGHTS.visualQuality * visualQuality +
      SCORE_WEIGHTS.colorSeparation * colorSeparation +
      SCORE_WEIGHTS.gameplayDistribution * gameplayDistribution -
      SCORE_WEIGHTS.tinyClusterPenalty * tinyClusterPenalty;

    return {
      k: candidate.k,
      colors: candidate.colors,
      error: candidate.error,
      score: total,
      breakdown: {
        visualQuality,
        colorSeparation,
        gameplayDistribution,
        tinyClusterPenalty,
      },
    };
  });
}

/**
 * The weakest links decide legibility: a palette with fourteen well separated
 * colours and two indistinguishable ones is a palette with a problem.
 */
function meanWeakestSeparation(colors: PaletteCandidateColor[]): number {
  if (colors.length < 2) return DISTINCT_LAB_DISTANCE * 2;
  const sorted = colors.map((c) => c.separation).sort((a, b) => a - b);
  const sampleSize = Math.max(1, Math.ceil(sorted.length / 3));
  let sum = 0;
  for (let i = 0; i < sampleSize; i++) sum += sorted[i];
  return sum / sampleSize;
}

/**
 * Normalised entropy of the population spread.
 *
 * A level where one colour is 95% of the image is a level with one card that
 * matters; a perfectly even spread gives every card something to do. Entropy
 * captures exactly that, and rewards neither extreme artificially.
 */
function distributionQuality(colors: PaletteCandidateColor[]): number {
  if (colors.length < 2) return 0;

  let entropy = 0;
  for (const color of colors) {
    if (color.share <= 0) continue;
    entropy -= color.share * Math.log(color.share);
  }
  return entropy / Math.log(colors.length);
}

function dedupe(colors: Rgb[]): Rgb[] {
  const seen = new Set<number>();
  const out: Rgb[] = [];
  for (const c of colors) {
    const key = (c.r << 16) | (c.g << 8) | c.b;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
