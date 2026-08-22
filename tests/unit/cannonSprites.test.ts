import { describe, expect, it } from "vitest";
import {
  CANNON_TIERS,
  GAUGE_SPENT,
  orient,
  paint,
  rotate,
  tierFor,
} from "../../src/rendering/CannonSprites";

const base = CANNON_TIERS[0];
const look = { accent: 0xe8a13c, target: 0x6f9c8f, ammo: 40, maxAmmo: 40 };

describe("CannonSprites", () => {
  it("keeps every sprite rectangular", () => {
    for (const sprite of CANNON_TIERS) {
      for (const row of sprite.rows) expect(row).toHaveLength(sprite.width);
      expect(sprite.rows).toHaveLength(sprite.height);
    }
  });

  it("gives every tier the two readings that must never cost effort", () => {
    // A colour band and a gauge: without both, a cannon on the rail says
    // nothing about what it is for or how long it has left.
    for (const sprite of CANNON_TIERS) {
      const flat = sprite.rows.join("");
      expect(flat).toContain("c");
      expect(flat).toContain("m");
    }
  });

  describe("rotation", () => {
    it("comes back to itself in four quarter turns", () => {
      expect(rotate(base, 4).rows).toEqual(base.rows);
    });

    it("swaps the axes on a quarter turn", () => {
      const turned = rotate(base, 1);
      expect(turned.width).toBe(base.height);
      expect(turned.height).toBe(base.width);
    });

    it("is exact, never interpolated", () => {
      // A corner is crossed in one frame: every cell of the turned sprite has
      // to come from a cell of the original, or the pixels smear.
      const turned = rotate(base, 1);
      for (let y = 0; y < turned.height; y++) {
        for (let x = 0; x < turned.width; x++) {
          expect(turned.rows[y][x]).toBe(base.rows[base.height - 1 - x][y]);
        }
      }
    });

    it("points the muzzle into the board from each side", () => {
      // The muzzle is the accent column; whichever side the cannon runs along,
      // it has to end up on the side facing the board.
      const muzzleAt = (axis: "row" | "column", direction: 1 | -1) => {
        const s = orient(base, axis, direction);
        const flat = s.rows.map((r) => r.split(""));
        let sumX = 0;
        let sumY = 0;
        let n = 0;
        for (let y = 0; y < s.height; y++) {
          for (let x = 0; x < s.width; x++) {
            if (flat[y][x] === "a") {
              sumX += x;
              sumY += y;
              n++;
            }
          }
        }
        return { x: sumX / n, y: sumY / n, w: s.width, h: s.height };
      };

      // Fired rightwards along a row: the barrel leans right.
      const right = muzzleAt("row", 1);
      expect(right.x).toBeGreaterThan(right.w / 2);
      // Leftwards: it leans left.
      const left = muzzleAt("row", -1);
      expect(left.x).toBeLessThan(left.w / 2);
      // Down a column: it leans down.
      const down = muzzleAt("column", 1);
      expect(down.y).toBeGreaterThan(down.h / 2);
      // Up a column: it leans up.
      const up = muzzleAt("column", -1);
      expect(up.y).toBeLessThan(up.h / 2);
    });
  });

  describe("jauge", () => {
    const gaugeColors = (ammo: number, maxAmmo = 40) => {
      const painted = paint(base, { ...look, ammo, maxAmmo }, 0, 0);
      // The gauge row is the one holding the `m` cells.
      const row = base.rows.findIndex((r) => r.includes("m"));
      return painted.cells.filter((c) => c.y === row && c.color !== 0x0c0c10 && c.color !== 0x2e2e38);
    };

    it("is full when the magazine is", () => {
      expect(gaugeColors(40).every((c) => c.color === look.accent)).toBe(true);
    });

    it("is empty when the magazine is", () => {
      expect(gaugeColors(0).every((c) => c.color === GAUGE_SPENT)).toBe(true);
    });

    it("goes out segment by segment, never below what is left", () => {
      // A round is only ever spent on a pixel that actually died, so a gauge
      // reading emptier than the stock would be a lie about what is left to peel.
      const cells = gaugeColors(20);
      const alight = cells.filter((c) => c.color === look.accent).length;
      expect(alight).toBeGreaterThan(0);
      expect(alight).toBeLessThan(cells.length);
    });

    it("never shows an empty gauge while a round remains", () => {
      const alight = gaugeColors(1, 400).filter((c) => c.color === look.accent).length;
      expect(alight).toBeGreaterThanOrEqual(1);
    });
  });

  describe("états", () => {
    it("drops the gauge and the band in the finale", () => {
      const painted = paint(base, { ...look, unlimited: true, ammo: 0 }, 0, 0);
      expect(painted.cells.some((c) => c.color === GAUGE_SPENT)).toBe(false);
      expect(painted.cells.some((c) => c.color === look.target)).toBe(false);
    });

    it("greys everything on a lap that peeled nothing", () => {
      const painted = paint(base, { ...look, idle: true }, 0, 0);
      expect(painted.cells.some((c) => c.color === look.accent)).toBe(false);
      expect(painted.cells.some((c) => c.color === look.target)).toBe(false);
    });
  });

  describe("paliers", () => {
    it("changes silhouette on what the player bought", () => {
      expect(tierFor(40)).toBe(0);
      expect(tierFor(300)).toBe(1);
      expect(tierFor(900)).toBe(2);
      expect(tierFor(5000)).toBe(2);
    });

    it("gives a bigger tier a longer gauge", () => {
      const segments = (tier: number) =>
        CANNON_TIERS[tier].rows.join("").split("").filter((c) => c === "m").length;
      expect(segments(1)).toBeGreaterThan(segments(0));
      expect(segments(2)).toBeGreaterThan(segments(1));
    });
  });

  it("places every cell relative to the origin it was given", () => {
    const painted = paint(base, look, 100, 50);
    expect(painted.cells.every((c) => c.x >= 100 && c.y >= 50)).toBe(true);
    expect(painted.cells.every((c) => c.x < 100 + base.width && c.y < 50 + base.height)).toBe(true);
  });
});
