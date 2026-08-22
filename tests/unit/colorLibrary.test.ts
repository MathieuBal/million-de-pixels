import { describe, expect, it } from "vitest";
import {
  ColorLibrary,
  HEX_BONUS,
  HEX_LEVELS,
  LIBRARY_HEXES,
  LIBRARY_SIZE,
  hexOf,
  snapChannel,
} from "../../src/progression/ColorLibrary";

describe("ColorLibrary", () => {
  describe("la grille", () => {
    it("has a denominator, and every hex in it is distinct", () => {
      // A collection needs a last page. Exact values would give thousands of
      // near-identical entries and a book that can never be finished.
      expect(LIBRARY_SIZE).toBe(216);
      expect(LIBRARY_HEXES).toHaveLength(LIBRARY_SIZE);
      expect(new Set(LIBRARY_HEXES).size).toBe(LIBRARY_SIZE);
    });

    it("snaps a channel to the nearest level, not the lowest", () => {
      expect(snapChannel(0)).toBe(0x00);
      expect(snapChannel(255)).toBe(0xff);
      expect(snapChannel(0x30)).toBe(0x33);
      expect(snapChannel(0x50)).toBe(0x66);
      expect(snapChannel(0x4d)).toBe(0x66); // exactly between 33 and 66, rounds up
      expect(snapChannel(300)).toBe(0xff);
      expect(snapChannel(-40)).toBe(0x00);
    });

    it("writes a hex a player could read back", () => {
      expect(hexOf(0, 0, 0)).toBe("#000000");
      expect(hexOf(255, 255, 255)).toBe("#FFFFFF");
      // 63 is nearer 0x33 than 0x66 — the grid rounds, it does not floor.
      expect(hexOf(226, 85, 63)).toBe("#CC6633");
    });

    it("only ever names a hex the grid holds", () => {
      const known = new Set(LIBRARY_HEXES);
      for (let r = 0; r < 256; r += 7) {
        for (let g = 0; g < 256; g += 11) {
          for (let b = 0; b < 256; b += 13) expect(known.has(hexOf(r, g, b))).toBe(true);
        }
      }
    });

    it("covers the grid from the levels themselves", () => {
      for (const r of HEX_LEVELS) {
        for (const g of HEX_LEVELS) {
          for (const b of HEX_LEVELS) expect(LIBRARY_HEXES).toContain(hexOf(r, g, b));
        }
      }
    });
  });

  describe("la collection", () => {
    it("starts empty and pays nothing", () => {
      const library = new ColorLibrary();
      expect(library.discovered).toBe(0);
      expect(library.completion).toBe(0);
      expect(library.bonus()).toEqual({ fragmentMultiplier: 1, offlineMultiplier: 1 });
    });

    it("catalogues a hex the first time a colour of it is cleared", () => {
      const library = new ColorLibrary();
      expect(library.record({ r: 226, g: 85, b: 63, count: 1000 })).toBe("#CC6633");
      expect(library.has("#CC6633")).toBe(true);
      expect(library.specimen("#CC6633")?.pixels).toBe(1000);
    });

    it("reports nothing new the second time, but keeps counting", () => {
      const library = new ColorLibrary();
      library.record({ r: 204, g: 102, b: 51, count: 1000 });
      // A neighbour that snaps to the same hex is the same entry.
      expect(library.record({ r: 210, g: 95, b: 45, count: 500 })).toBeNull();

      const specimen = library.specimen("#CC6633")!;
      expect(specimen.pixels).toBe(1500);
      expect(specimen.clears).toBe(2);
      // The swatch keeps the first specimen: a colour that was really on a
      // board, not the grid value it was filed under.
      expect(specimen.r).toBe(204);
    });

    it("pays passively, and more as the grid fills", () => {
      const library = new ColorLibrary();
      library.record({ r: 0, g: 0, b: 0, count: 1 });
      library.record({ r: 255, g: 255, b: 255, count: 1 });

      expect(library.bonus().fragmentMultiplier).toBeCloseTo(1 + 2 * HEX_BONUS, 9);
      expect(library.bonus().offlineMultiplier).toBeCloseTo(1 + 2 * HEX_BONUS, 9);
    });

    it("round-trips through serialize", () => {
      const library = new ColorLibrary();
      library.record({ r: 226, g: 85, b: 63, count: 1000 });
      library.record({ r: 12, g: 12, b: 14, count: 40 });

      const restored = ColorLibrary.restore(library.serialize());
      expect(restored.discovered).toBe(2);
      expect(restored.specimen("#000000")?.pixels).toBe(40);
      expect(restored.bonus()).toEqual(library.bonus());
    });

    it("has a last page", () => {
      const library = new ColorLibrary();
      for (const r of HEX_LEVELS) {
        for (const g of HEX_LEVELS) {
          for (const b of HEX_LEVELS) library.record({ r, g, b, count: 1 });
        }
      }
      expect(library.discovered).toBe(LIBRARY_SIZE);
      expect(library.completion).toBe(1);
      expect(library.bonus().fragmentMultiplier).toBeCloseTo(1 + LIBRARY_SIZE * HEX_BONUS, 9);
    });
  });
});
