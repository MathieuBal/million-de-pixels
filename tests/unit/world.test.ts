import { describe, expect, it } from "vitest";
import { ColorIndex } from "../../src/world/ColorIndex";
import { PixelWorld } from "../../src/world/PixelWorld";
import { DEAD, PIXEL_COUNT, VOID, type PaletteEntry } from "../../src/core/constants";
import { XorShift32 } from "../../src/rng/XorShift32";

function palette(size: number, counts: number[] = []): PaletteEntry[] {
  return Array.from({ length: size }, (_, id) => ({
    id,
    r: id * 16,
    g: 255 - id * 16,
    b: 128,
    a: 255,
    count: counts[id] ?? 0,
  }));
}

/** Board where colour c occupies every cell with index % paletteSize === c. */
function stripedWorld(paletteSize = 4, voidEvery = 0): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT);
  const counts = new Array(paletteSize).fill(0);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    if (voidEvery > 0 && i % voidEvery === 0) {
      colorId[i] = VOID;
      continue;
    }
    const c = i % paletteSize;
    colorId[i] = c;
    counts[c]++;
  }
  return PixelWorld.create(palette(paletteSize, counts), colorId);
}

describe("PixelWorld", () => {
  it("holds exactly one million cells per buffer", () => {
    const world = stripedWorld();
    expect(world.colorId.length).toBe(PIXEL_COUNT);
    expect(world.hp.length).toBe(PIXEL_COUNT);
    expect(world.flags.length).toBe(PIXEL_COUNT);
    expect(world.baseColorId.length).toBe(PIXEL_COUNT);
  });

  it("marks a destroyed cell DEAD and decrements its colour exactly once", () => {
    const world = stripedWorld();
    const before = world.aliveByColor(0);
    expect(world.destroy(0)).toBe(true);
    expect(world.colorId[0]).toBe(DEAD);
    expect(world.aliveByColor(0)).toBe(before - 1);
  });

  it("refuses a second destruction of the same cell", () => {
    const world = stripedWorld();
    world.destroy(4);
    const alive = world.aliveByColor(0);
    expect(world.destroy(4)).toBe(false);
    expect(world.aliveByColor(0)).toBe(alive);
  });

  it("never destroys a VOID cell", () => {
    const world = stripedWorld(4, 8);
    const voidIndex = 0;
    expect(world.colorId[voidIndex]).toBe(VOID);
    expect(world.destroy(voidIndex)).toBe(false);
    expect(world.destroyedCount()).toBe(0);
  });

  it("excludes VOID from the playable total and from progress", () => {
    const world = stripedWorld(4, 8);
    expect(world.voidPixels).toBe(PIXEL_COUNT / 8);
    expect(world.playablePixels).toBe(PIXEL_COUNT - PIXEL_COUNT / 8);
    expect(world.progress()).toBe(0);
  });

  it("keeps baseColorId untouched by destruction", () => {
    const world = stripedWorld();
    world.destroy(1);
    expect(world.baseColorId[1]).toBe(1);
    expect(world.colorId[1]).toBe(DEAD);
  });

  it("reaches exactly 100% when every playable cell is gone", () => {
    const world = stripedWorld(2, 4);
    const rng = new XorShift32(7);
    for (let c = 0; c < world.paletteSize; c++) {
      world.destroyRandomOfColor(c, PIXEL_COUNT, rng);
    }
    expect(world.aliveTotal()).toBe(0);
    expect(world.progress()).toBe(1);
    expect(world.destroyedCount()).toBe(world.playablePixels);
  });

  it("keeps macro tile counts in sync with destruction", () => {
    const world = stripedWorld();
    const tile = 0;
    const before = world.macroTiles.countIn(tile, 0);
    world.destroy(world.index(0, 0));
    expect(world.macroTiles.countIn(tile, 0)).toBe(before - 1);
  });
});

describe("ColorIndex", () => {
  it("indexes every alive pixel exactly once", () => {
    const world = stripedWorld(4);
    const index = world.colorIndex;
    const seen = new Uint8Array(PIXEL_COUNT);

    let indexed = 0;
    let duplicates = 0;
    for (let c = 0; c < 4; c++) {
      for (let slot = index.offsets[c]; slot < index.offsets[c] + index.alive[c]; slot++) {
        const pixel = index.pixelsByColor[slot];
        if (seen[pixel] !== 0) duplicates++;
        seen[pixel] = 1;
        indexed++;
      }
    }

    expect(duplicates).toBe(0);
    expect(indexed).toBe(PIXEL_COUNT);
  });

  it("holds pixelsByColor[slotOfPixel[p]] === p after mass destruction", () => {
    const world = stripedWorld(4);
    const rng = new XorShift32(0xabcdef);
    for (let i = 0; i < 100_000; i++) {
      world.destroyRandomOfColor(rng.nextInt(4), 1, rng);
    }
    world.colorIndex.verify(world.colorId);
    expect(world.destroyedCount()).toBe(100_000);
  });

  it("keeps sum(alive) equal to the number of live cells", () => {
    const world = stripedWorld(4);
    const rng = new XorShift32(99);
    world.destroyRandomOfColor(2, 50_000, rng);

    let live = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) if (world.colorId[i] < 4) live++;
    expect(world.aliveTotal()).toBe(live);
  });

  it("returns -1 once a colour is exhausted", () => {
    const colorId = new Uint8Array(16).fill(VOID);
    colorId[3] = 0;
    const index = ColorIndex.build(colorId, 1);
    const rng = new XorShift32(1);
    expect(index.randomAlive(0, rng)).toBe(3);
    index.remove(colorId, 3);
    colorId[3] = DEAD;
    expect(index.randomAlive(0, rng)).toBe(-1);
  });

  it("rebuilds identically from a partially destroyed board", () => {
    const world = stripedWorld(4);
    const rng = new XorShift32(555);
    world.destroyRandomOfColor(1, 25_000, rng);

    const rebuilt = ColorIndex.build(world.colorId, world.paletteSize);
    expect(Array.from(rebuilt.alive)).toEqual(Array.from(world.colorIndex.alive));
    rebuilt.verify(world.colorId);
  });
});
