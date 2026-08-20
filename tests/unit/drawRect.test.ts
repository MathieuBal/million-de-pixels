import { describe, expect, it } from "vitest";
import { computeDrawRect } from "../../src/image/drawRect";
import { validateImageFile, MAX_FILE_BYTES } from "../../src/image/ImageProtocol";

const T = 1024;

describe("computeDrawRect", () => {
  it("letterboxes a wide image in contain mode", () => {
    const rect = computeDrawRect(2100, 900, T, T, "contain");
    expect(rect.dw).toBe(T);
    expect(rect.dh).toBe(Math.round((900 * T) / 2100));
    expect(rect.dy).toBeGreaterThan(0);
    expect(rect.dx).toBe(0);
  });

  it("pillarboxes a tall image in contain mode", () => {
    const rect = computeDrawRect(900, 2100, T, T, "contain");
    expect(rect.dh).toBe(T);
    expect(rect.dx).toBeGreaterThan(0);
  });

  it("crops the long side in cover mode and fills the board", () => {
    const rect = computeDrawRect(2100, 900, T, T, "cover");
    expect(rect.dw).toBe(T);
    expect(rect.dh).toBe(T);
    expect(rect.sw).toBeLessThan(2100);
    expect(rect.sh).toBe(900);
    expect(rect.sx).toBeCloseTo((2100 - rect.sw) / 2, 6);
  });

  it("ignores the aspect ratio in stretch mode", () => {
    const rect = computeDrawRect(3, 4000, T, T, "stretch");
    expect(rect).toMatchObject({ dx: 0, dy: 0, dw: T, dh: T, sw: 3, sh: 4000 });
  });

  it("handles a 1x1 source", () => {
    const rect = computeDrawRect(1, 1, T, T, "contain");
    expect(rect.dw).toBe(T);
    expect(rect.dh).toBe(T);
  });

  it("leaves a square image untouched", () => {
    const rect = computeDrawRect(512, 512, T, T, "contain");
    expect(rect).toMatchObject({ dx: 0, dy: 0, dw: T, dh: T });
  });

  it("rejects a degenerate source", () => {
    expect(() => computeDrawRect(0, 100, T, T, "contain")).toThrow(RangeError);
  });
});

describe("file validation", () => {
  const blob = (size: number, type: string) =>
    ({ size, type }) as unknown as File;

  it("accepts PNG, JPEG and WebP", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(validateImageFile(blob(1024, type))).toBeNull();
    }
  });

  it("rejects other formats, including SVG", () => {
    expect(validateImageFile(blob(1024, "image/svg+xml"))).toMatch(/Format non supporté/);
    expect(validateImageFile(blob(1024, "image/gif"))).toMatch(/Format non supporté/);
    expect(validateImageFile(blob(1024, ""))).toMatch(/inconnu/);
  });

  it("rejects an empty file", () => {
    expect(validateImageFile(blob(0, "image/png"))).toMatch(/vide/);
  });

  it("rejects a file above the size limit", () => {
    expect(validateImageFile(blob(MAX_FILE_BYTES + 1, "image/png"))).toMatch(/trop volumineux/);
  });
});
