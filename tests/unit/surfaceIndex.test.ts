import { describe, expect, it } from "vitest";
import { SurfaceIndex } from "../../src/world/SurfaceIndex";
import { PixelWorld } from "../../src/world/PixelWorld";
import { DEAD, PIXEL_COUNT, VOID, WORLD_HEIGHT, WORLD_WIDTH } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

/** Vertical bands: colour 0 on the left half, colour 1 on the right. */
function banded(): Uint8Array {
  const colorId = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    colorId[i] = i % WORLD_WIDTH < WORLD_WIDTH / 2 ? 0 : 1;
  }
  return colorId;
}

describe("SurfaceIndex", () => {
  it("reports the cell facing each side", () => {
    const colorId = banded();
    const surface = SurfaceIndex.build(colorId, 2);

    expect(surface.front("row", 5, 1)).toBe(0);
    expect(surface.front("row", 5, -1)).toBe(WORLD_WIDTH - 1);
    expect(surface.front("column", 5, 1)).toBe(0);
    expect(surface.front("column", 5, -1)).toBe(WORLD_HEIGHT - 1);
  });

  it("gives the linear index of the exposed cell", () => {
    const colorId = banded();
    const surface = SurfaceIndex.build(colorId, 2);
    // Approached from the right, row 3 exposes colour 1.
    expect(colorId[surface.frontIndex("row", 3, -1)]).toBe(1);
    // From the left, the same row exposes colour 0.
    expect(colorId[surface.frontIndex("row", 3, 1)]).toBe(0);
  });

  it("skips the transparent margins", () => {
    const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
    for (let x = 10; x < 20; x++) colorId[7 * WORLD_WIDTH + x] = 0;
    const surface = SurfaceIndex.build(colorId, 1);

    expect(surface.front("row", 7, 1)).toBe(10);
    expect(surface.front("row", 7, -1)).toBe(19);
  });

  it("reports nothing for an empty lane", () => {
    const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
    const surface = SurfaceIndex.build(colorId, 1);
    expect(surface.front("row", 0, 1)).toBe(-1);
    expect(surface.frontIndex("row", 0, 1)).toBe(-1);
  });

  it("uncovers the next cell when the front dies", () => {
    const colorId = banded();
    const surface = SurfaceIndex.build(colorId, 2);

    colorId[3 * WORLD_WIDTH] = DEAD;
    surface.onDestroyed(colorId, 0, 3);
    expect(surface.front("row", 3, 1)).toBe(1);
  });

  it("leaves other lanes untouched", () => {
    const colorId = banded();
    const surface = SurfaceIndex.build(colorId, 2);

    colorId[3 * WORLD_WIDTH] = DEAD;
    surface.onDestroyed(colorId, 0, 3);
    expect(surface.front("row", 4, 1)).toBe(0);
  });

  it("skips a run of holes in one advance", () => {
    const colorId = banded();
    const surface = SurfaceIndex.build(colorId, 2);

    for (let x = 0; x < 5; x++) colorId[2 * WORLD_WIDTH + x] = DEAD;
    surface.onDestroyed(colorId, 0, 2);
    expect(surface.front("row", 2, 1)).toBe(5);
  });

  it("empties a lane once its last cell is gone", () => {
    const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
    colorId[9 * WORLD_WIDTH + 4] = 0;
    const surface = SurfaceIndex.build(colorId, 1);

    colorId[9 * WORLD_WIDTH + 4] = DEAD;
    surface.onDestroyed(colorId, 4, 9);
    expect(surface.front("row", 9, 1)).toBe(-1);
    expect(surface.front("row", 9, -1)).toBe(-1);
  });

  it("stays consistent with the board through heavy destruction", () => {
    const world = PixelWorld.create(makePalette(2, [PIXEL_COUNT / 2, PIXEL_COUNT / 2]), banded());

    // Carve the left edge away, row by row.
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 30; x++) world.destroy(y * WORLD_WIDTH + x);
    }

    for (let y = 0; y < 40; y++) {
      const front = world.surface.front("row", y, 1);
      expect(front).toBe(30);
      // And the index it hands back really is the first solid cell.
      const cell = world.colorId[world.surface.frontIndex("row", y, 1)];
      expect(cell).toBeLessThan(world.paletteSize);
    }
  });

  it("never points at a hole", () => {
    const world = PixelWorld.create(makePalette(2, [PIXEL_COUNT / 2, PIXEL_COUNT / 2]), banded());
    for (let i = 0; i < 5000; i++) world.destroy(i * 7 % PIXEL_COUNT);

    for (let lane = 0; lane < WORLD_HEIGHT; lane += 37) {
      for (const direction of [1, -1] as const) {
        const index = world.surface.frontIndex("row", lane, direction);
        if (index < 0) continue;
        expect(world.colorId[index]).toBeLessThan(world.paletteSize);
      }
    }
  });
});
