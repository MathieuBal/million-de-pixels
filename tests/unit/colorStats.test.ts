import { describe, expect, it } from "vitest";
import { ColorStats } from "../../src/world/ColorStats";
import { PixelWorld } from "../../src/world/PixelWorld";
import { PIXEL_COUNT, WORLD_WIDTH } from "../../src/core/constants";
import { XorShift32 } from "../../src/rng/XorShift32";
import { makePalette } from "../fixtures/palette";

/** Colour c takes a fixed slice of the board, sizes given as shares. */
function worldWithShares(shares: number[]): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT);
  const counts = new Array(shares.length).fill(0);

  let cursor = 0;
  for (let colour = 0; colour < shares.length; colour++) {
    const size =
      colour === shares.length - 1
        ? PIXEL_COUNT - cursor
        : Math.round(PIXEL_COUNT * shares[colour]);
    colorId.fill(colour, cursor, cursor + size);
    counts[colour] = size;
    cursor += size;
  }

  return PixelWorld.create(makePalette(shares.length, counts), colorId);
}

describe("ColorStats", () => {
  it("reports the initial population and keeps it after destruction", () => {
    const world = worldWithShares([0.5, 0.5]);
    const stats = new ColorStats(world);

    const initial = stats.entryOf(0).initialCount;
    world.destroyRandomOfColor(0, 1000, new XorShift32(1));

    const entry = stats.entryOf(0);
    expect(entry.initialCount).toBe(initial);
    expect(entry.destroyed).toBe(1000);
    expect(entry.alive).toBe(initial - 1000);
  });

  it("computes the share of what is left, not of the original image", () => {
    const world = worldWithShares([0.5, 0.5]);
    const stats = new ColorStats(world);

    // Wipe most of colour 0: colour 1 now dominates what remains.
    world.destroyRandomOfColor(0, Math.round(PIXEL_COUNT * 0.4), new XorShift32(2));

    expect(stats.entryOf(1).shareOfRemaining).toBeGreaterThan(0.7);
    expect(stats.entryOf(1).shareOfInitial).toBeCloseTo(0.5, 2);
  });

  it("flags the colour the run is actually waiting on", () => {
    const world = worldWithShares([0.8, 0.2]);
    const stats = new ColorStats(world);

    // All the output goes to the small colour; the big one is the wall.
    stats.sample(0, [0, 100]);
    stats.sample(1000, [0, 100]);

    const bottlenecks = stats.bottlenecks();
    expect(bottlenecks[0].colorId).toBe(0);
    expect(bottlenecks[0].gap).toBeGreaterThan(0);
  });

  it("flags output poured into a colour that is nearly gone", () => {
    const world = worldWithShares([0.8, 0.2]);
    const stats = new ColorStats(world);
    stats.sample(0, [0, 100]);
    stats.sample(1000, [0, 100]);

    const wasted = stats.wasted();
    expect(wasted.map((w) => w.colorId)).toContain(1);
  });

  it("reports nothing when effort matches need", () => {
    const world = worldWithShares([0.5, 0.5]);
    const stats = new ColorStats(world);
    stats.sample(0, [50, 50]);
    stats.sample(1000, [50, 50]);

    expect(stats.bottlenecks()).toHaveLength(0);
    expect(stats.wasted()).toHaveLength(0);
  });

  it("never flags an exhausted colour as a bottleneck", () => {
    const world = worldWithShares([0.5, 0.5]);
    const stats = new ColorStats(world);
    world.destroyRandomOfColor(0, PIXEL_COUNT, new XorShift32(3));

    stats.sample(0, [0, 100]);
    stats.sample(1000, [0, 100]);

    expect(stats.bottlenecks().map((b) => b.colorId)).not.toContain(0);
    expect(stats.entryOf(0).exhausted).toBe(true);
  });

  it("measures a smoothed destruction rate", () => {
    const world = worldWithShares([1]);
    const stats = new ColorStats(world);

    stats.sample(0);
    for (let step = 1; step <= 20; step++) {
      world.destroyRandomOfColor(0, 1000, new XorShift32(step));
      stats.sample(step * 1000);
    }

    // 1000 pixels per second, approached through the smoothing window.
    expect(stats.entryOf(0).rate).toBeGreaterThan(500);
    expect(stats.entryOf(0).rate).toBeLessThan(1500);
  });

  it("reports an infinite ETA while nothing is being destroyed", () => {
    const world = worldWithShares([1]);
    const stats = new ColorStats(world);
    stats.sample(0);
    stats.sample(1000);
    expect(stats.entryOf(0).etaSeconds).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores samples taken faster than the smoothing window", () => {
    const world = worldWithShares([1]);
    const stats = new ColorStats(world);
    stats.sample(0);
    world.destroyRandomOfColor(0, 5000, new XorShift32(9));
    stats.sample(10); // 10 ms later: too soon to mean anything
    expect(stats.entryOf(0).rate).toBe(0);
  });

  it("stays correct when the board has void cells", () => {
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      colorId[i] = i % WORLD_WIDTH < 512 ? 0 : 254;
    }
    const world = PixelWorld.create(makePalette(1, [PIXEL_COUNT / 2]), colorId);
    const stats = new ColorStats(world);

    expect(stats.entryOf(0).shareOfRemaining).toBe(1);
    expect(stats.entryOf(0).shareOfInitial).toBeCloseTo(1, 5);
  });
});
