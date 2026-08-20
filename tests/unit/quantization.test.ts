import { describe, expect, it } from "vitest";
import { quantize } from "../../src/image/quantization";
import { buildHistogram } from "../../src/image/quantization/histogram";
import { medianCut } from "../../src/image/quantization/medianCut";
import { assertCountInvariant } from "../../src/image/quantization/mapping";
import { DEFAULT_ALPHA_THRESHOLD, VOID } from "../../src/core/constants";
import {
  bandedImage,
  gradientImage,
  halfTransparentImage,
  solidImage,
  transparentImage,
} from "../fixtures/images";

const W = 64;
const H = 64;
const OPTIONS = {
  paletteSize: 8,
  quantizer: "median-cut" as const,
  alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
};

describe("quantization", () => {
  it("collapses a monochrome image to a single palette entry", () => {
    const result = quantize(solidImage(W, H, 200, 30, 60), OPTIONS);
    expect(result.palette).toHaveLength(1);
    expect(result.counts[0]).toBe(W * H);
    expect(result.voidPixels).toBe(0);
  });

  it("recovers exact counts on a two-colour image", () => {
    const image = bandedImage(W, H, [
      [255, 0, 0],
      [0, 0, 255],
    ]);
    const result = quantize(image, OPTIONS);
    expect(result.palette).toHaveLength(2);
    expect([...result.counts].sort((a, b) => a - b)).toEqual([(W * H) / 2, (W * H) / 2]);
  });

  it("never invents centroids beyond the number of distinct colours", () => {
    const image = bandedImage(W, H, [
      [10, 10, 10],
      [250, 250, 250],
      [10, 250, 10],
    ]);
    const result = quantize(image, { ...OPTIONS, paletteSize: 16 });
    expect(result.palette.length).toBeLessThanOrEqual(3);
    for (const count of result.counts) expect(count).toBeGreaterThan(0);
  });

  it("uses the full palette on a gradient", () => {
    const result = quantize(gradientImage(256, 4), { ...OPTIONS, paletteSize: 8 });
    expect(result.palette).toHaveLength(8);
  });

  it("maps sub-threshold alpha to VOID and excludes it from counts", () => {
    const result = quantize(halfTransparentImage(W, H), OPTIONS);
    expect(result.voidPixels).toBe((W * H) / 2);
    expect(result.playablePixels).toBe((W * H) / 2);
    expect(result.colorId[W - 1]).toBe(VOID);
    assertCountInvariant(result.counts, result.voidPixels, W * H);
  });

  it("reports an empty histogram for a fully transparent image", () => {
    const histogram = buildHistogram(transparentImage(W, H), DEFAULT_ALPHA_THRESHOLD);
    expect(histogram.totalWeight).toBe(0);
    expect(histogram.distinctBuckets).toBe(0);
    expect(medianCut(histogram, 8)).toHaveLength(0);
  });

  it("holds the sum(counts) + void === total invariant", () => {
    const result = quantize(gradientImage(W, H), OPTIONS);
    assertCountInvariant(result.counts, result.voidPixels, W * H);
  });

  it("still splits a palette when one colour dominates the image", () => {
    // Regression: the population-weighted median lands outside the box when a
    // single colour outweighs all the others combined. Bailing out there froze
    // the palette at 3 entries on any poster-like image with a dominant field.
    const W = 400;
    const H = 100;
    const image = new Uint8ClampedArray(W * H * 4);
    const plan: Array<[[number, number, number], number]> = [
      [[206, 41, 42], 0.63],
      [[26, 18, 20], 0.22],
      [[237, 228, 206], 0.1],
      [[150, 26, 30], 0.04],
      [[252, 246, 232], 0.01],
    ];

    let cursor = 0;
    for (const [[r, g, b], share] of plan) {
      const end = Math.min(W * H, cursor + Math.round(W * H * share));
      for (; cursor < end; cursor++) {
        const p = cursor * 4;
        image[p] = r;
        image[p + 1] = g;
        image[p + 2] = b;
        image[p + 3] = 255;
      }
    }
    for (; cursor < W * H; cursor++) {
      const p = cursor * 4;
      image[p] = 206;
      image[p + 1] = 41;
      image[p + 2] = 42;
      image[p + 3] = 255;
    }

    const result = quantize(image, { ...OPTIONS, paletteSize: 5 });
    expect(result.palette).toHaveLength(5);
    for (const count of result.counts) expect(count).toBeGreaterThan(0);
  });

  it("is deterministic across runs", () => {
    const image = gradientImage(128, 8);
    const a = quantize(image, { ...OPTIONS, paletteSize: 12 });
    const b = quantize(image, { ...OPTIONS, paletteSize: 12 });
    expect(a.palette).toEqual(b.palette);
    expect(Array.from(a.colorId)).toEqual(Array.from(b.colorId));
  });

  it("k-means refinement stays deterministic and keeps the palette size", () => {
    const image = gradientImage(128, 8);
    const a = quantize(image, { ...OPTIONS, paletteSize: 6, quantizer: "median-cut+kmeans" });
    const b = quantize(image, { ...OPTIONS, paletteSize: 6, quantizer: "median-cut+kmeans" });
    expect(a.palette).toEqual(b.palette);
    expect(a.palette.length).toBeLessThanOrEqual(6);
    assertCountInvariant(a.counts, a.voidPixels, 128 * 8);
  });
});
