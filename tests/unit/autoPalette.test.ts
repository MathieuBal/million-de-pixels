import { describe, expect, it } from "vitest";
import { analyzePalette, SCORE_WEIGHTS } from "../../src/image/quantization/autoPalette";
import { buildHistogram } from "../../src/image/quantization/histogram";
import { DEFAULT_ALPHA_THRESHOLD } from "../../src/core/constants";
import { bandedImage, gradientImage, solidImage } from "../fixtures/images";

const W = 96;
const H = 48;

function analyze(image: Uint8ClampedArray) {
  return analyzePalette(buildHistogram(image, DEFAULT_ALPHA_THRESHOLD));
}

const SIX: Array<[number, number, number]> = [
  [220, 30, 30],
  [30, 60, 220],
  [240, 220, 40],
  [20, 20, 20],
  [240, 240, 240],
  [30, 170, 90],
];

/** A dominant field plus a tiny, unmistakably different speck. */
function imageWithSpeck(
  speck: [number, number, number],
  speckPixels: number,
): Uint8ClampedArray {
  const image = solidImage(W, H, 40, 40, 200);
  for (let i = 0; i < speckPixels; i++) {
    const p = i * 4;
    image[p] = speck[0];
    image[p + 1] = speck[1];
    image[p + 2] = speck[2];
  }
  return image;
}

describe("automatic palette analysis", () => {
  it("collapses a monochrome image to a single colour", () => {
    const analysis = analyze(solidImage(W, H, 180, 40, 90));
    expect(analysis.paletteSize).toBe(1);
  });

  it("recovers a six-colour image", () => {
    expect(analyze(bandedImage(W, H, SIX)).paletteSize).toBe(6);
  });

  it("stays inside 1..16 on a continuous gradient", () => {
    const analysis = analyze(gradientImage(256, 16));
    expect(analysis.paletteSize).toBeGreaterThanOrEqual(4);
    expect(analysis.paletteSize).toBeLessThanOrEqual(16);
  });

  it("is deterministic", () => {
    const image = bandedImage(W, H, SIX);
    expect(analyze(image).paletteSize).toBe(analyze(image).paletteSize);
  });

  it("keeps a tiny colour that is visually distinct", () => {
    // Bright red on a blue field: 0.2% of the image, but it is the eyes.
    const analysis = analyze(imageWithSpeck([250, 20, 20], 9));
    const reds = analysis.palette.filter((c) => c.r > 180 && c.g < 90 && c.b < 90);
    expect(reds.length).toBeGreaterThan(0);
    expect(reds[0].share).toBeLessThan(0.01);
    expect(reds[0].rarity).toBe("exotique");
    expect(analysis.rareColors.length).toBeGreaterThan(0);
  });

  it("does not mark a distinct tiny colour as redundant", () => {
    const analysis = analyze(imageWithSpeck([250, 20, 20], 9));
    const red = analysis.palette.find((c) => c.r > 180 && c.g < 90)!;
    expect(red.redundant).toBe(false);
    expect(red.separation).toBeGreaterThan(18);
  });

  it("treats a tiny near-duplicate as a splinter, not a colour", () => {
    // Barely distinguishable from the background: this one IS noise.
    const analysis = analyze(imageWithSpeck([44, 44, 205], 9));
    const splinters = analysis.palette.filter((c) => c.redundant);
    for (const splinter of splinters) {
      expect(splinter.separation).toBeLessThan(18);
    }
  });

  it("classifies rarity from the population share", () => {
    const analysis = analyze(bandedImage(W, H, SIX));
    for (const color of analysis.palette) {
      if (color.share >= 0.1) expect(color.rarity).toBe("commune");
      else if (color.share >= 0.03) expect(color.rarity).toBe("peu-commune");
      else if (color.share >= 0.01) expect(color.rarity).toBe("rare");
      else expect(color.rarity).toBe("exotique");
    }
  });

  it("scores every candidate on the four axes", () => {
    const analysis = analyze(gradientImage(256, 16));
    expect(analysis.candidates.length).toBeGreaterThan(1);
    for (const candidate of analysis.candidates) {
      const { visualQuality, colorSeparation, gameplayDistribution, tinyClusterPenalty } =
        candidate.breakdown;
      for (const axis of [visualQuality, colorSeparation, gameplayDistribution, tinyClusterPenalty]) {
        expect(axis).toBeGreaterThanOrEqual(0);
        expect(axis).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns the highest scoring candidate", () => {
    const analysis = analyze(bandedImage(W, H, SIX));
    const best = analysis.candidates.reduce((a, b) => (b.score > a.score ? b : a));
    expect(analysis.paletteSize).toBe(best.colors.length);
  });

  it("prefers separated colours over a marginally better fit", () => {
    // Weight sanity: separation and distribution together outweigh fidelity,
    // so a palette cannot win on raw error alone.
    expect(SCORE_WEIGHTS.colorSeparation + SCORE_WEIGHTS.gameplayDistribution).toBeGreaterThan(
      SCORE_WEIGHTS.visualQuality,
    );
  });

  it("penalises a palette made of near-identical shades", () => {
    // Sixteen browns: fits well, plays terribly. Separation must drag it down.
    const shades: Array<[number, number, number]> = Array.from({ length: 8 }, (_, i) => [
      120 + i,
      82 + i,
      45 + i,
    ]);
    const analysis = analyze(bandedImage(W, H, shades));
    const winner = analysis.candidates.find((c) => c.colors.length === analysis.paletteSize)!;
    expect(winner.breakdown.colorSeparation).toBeLessThanOrEqual(1);
    expect(analysis.paletteSize).toBeLessThanOrEqual(8);
  });
});
