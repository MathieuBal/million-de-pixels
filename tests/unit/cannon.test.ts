import { describe, expect, it } from "vitest";
import { Cannon, PERIMETER, aimAt } from "../../src/combat/Cannon";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../src/core/constants";
import { LaneIndex } from "../../src/world/LaneIndex";

describe("Cannon", () => {
  it("covers the four edges over one lap", () => {
    const seen = new Set<string>();
    for (let p = 0; p < PERIMETER; p += 16) {
      const aim = aimAt(p);
      seen.add(`${aim.axis}:${aim.direction}`);
    }
    expect(seen).toEqual(new Set(["column:1", "row:-1", "column:-1", "row:1"]));
  });

  it("always fires perpendicular to its edge, into the board", () => {
    for (let p = 0; p < PERIMETER; p += 7) {
      const aim = aimAt(p);
      const lanes = aim.axis === "row" ? WORLD_HEIGHT : WORLD_WIDTH;
      expect(aim.lane).toBeGreaterThanOrEqual(0);
      expect(aim.lane).toBeLessThan(lanes);
      // The muzzle sits outside the board, on the side it shoots from.
      if (aim.axis === "column") {
        expect(aim.direction > 0 ? aim.y < 0 : aim.y > WORLD_HEIGHT).toBe(true);
      } else {
        expect(aim.direction > 0 ? aim.x < 0 : aim.x > WORLD_WIDTH).toBe(true);
      }
    }
  });

  it("wraps around the perimeter", () => {
    const cannon = new Cannon({ position: PERIMETER - 10, speed: 100 });
    cannon.update(1);
    expect(cannon.position).toBeCloseTo(90, 6);
  });

  it("handles a negative starting position", () => {
    expect(new Cannon({ position: -5 }).position).toBeCloseTo(PERIMETER - 5, 6);
  });

  it("offsets a volley onto adjacent parallel lanes", () => {
    const cannon = new Cannon({ position: 500 });
    const base = cannon.aim();
    const left = cannon.aimOffset(-1);
    const right = cannon.aimOffset(1);

    expect(left.axis).toBe(base.axis);
    expect(right.axis).toBe(base.axis);
    expect(left.direction).toBe(base.direction);
    expect(left.lane).toBe(base.lane - 1);
    expect(right.lane).toBe(base.lane + 1);
  });

  it("clamps a volley offset at a corner instead of wrapping onto another edge", () => {
    const cannon = new Cannon({ position: 0 }); // top-left corner, column 0
    const aim = cannon.aimOffset(-4);
    expect(aim.axis).toBe("column");
    expect(aim.lane).toBe(0);
  });

  it("round-trips through serialize", () => {
    const cannon = new Cannon({ position: 1234.5, speed: 310 });
    const restored = new Cannon(cannon.serialize());
    expect(restored.position).toBeCloseTo(1234.5, 6);
    expect(restored.speed).toBe(310);
  });
});

describe("LaneIndex", () => {
  const PALETTE = 3;

  function build(): { colorId: Uint8Array; index: LaneIndex } {
    const colorId = new Uint8Array(WORLD_WIDTH * WORLD_HEIGHT);
    // Colour c occupies row c only; every other row is colour 2.
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        colorId[y * WORLD_WIDTH + x] = y < 2 ? y : 2;
      }
    }
    return { colorId, index: LaneIndex.build(colorId, PALETTE) };
  }

  it("counts a full row and a full column", () => {
    const { index } = build();
    expect(index.count("row", 0, 0)).toBe(WORLD_WIDTH);
    expect(index.count("row", 0, 1)).toBe(0);
    // Every column crosses row 0 exactly once.
    expect(index.count("column", 5, 0)).toBe(1);
    expect(index.count("column", 5, 2)).toBe(WORLD_HEIGHT - 2);
  });

  it("answers lane occupancy without scanning", () => {
    const { index } = build();
    expect(index.hasColor("row", 1, 1)).toBe(true);
    expect(index.hasColor("row", 1, 0)).toBe(false);
  });

  it("drops to zero once a lane is emptied", () => {
    const { index } = build();
    for (let x = 0; x < WORLD_WIDTH; x++) index.decrement(x, 0, 0);
    expect(index.hasColor("row", 0, 0)).toBe(false);
    expect(index.count("column", 3, 0)).toBe(0);
  });

  it("never underflows below zero", () => {
    // decrement() is a raw primitive: exactly-once is guaranteed upstream by
    // PixelWorld.destroy, but the counter must still never wrap around.
    const { index } = build();
    for (let x = 0; x < WORLD_WIDTH; x++) index.decrement(x, 1, 1);
    index.decrement(0, 1, 1);
    expect(index.count("row", 1, 1)).toBe(0);
  });

  it("reports nothing for a colour outside the palette", () => {
    const { index } = build();
    expect(index.count("row", 0, 254)).toBe(0);
  });
});
