import { describe, expect, it } from "vitest";
import { BatchExecutor } from "../../src/combat/BatchExecutor";
import { ProjectilePool } from "../../src/combat/ProjectilePool";
import { CombatSimulator } from "../../src/combat/CombatSimulator";
import { Cannon } from "../../src/combat/Cannon";
import { DeckRuntime } from "../../src/deck/DeckRuntime";
import { makeCard, upgradeCard } from "../../src/deck/cards";
import { PixelWorld } from "../../src/world/PixelWorld";
import { XorShift32 } from "../../src/rng/XorShift32";
import { VisualLODController } from "../../src/rendering/VisualLODController";
import {
  DEAD,
  PIXEL_COUNT,
  WORLD_WIDTH,
  type PaletteEntry,
} from "../../src/core/constants";

function makeWorld(paletteSize = 4): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT);
  // Diagonal stripes: every row AND every column contains every colour, so the
  // cannon always has a valid target whatever edge it is on. (A plain `i %
  // paletteSize` would make each column monochrome, since 1024 is divisible by
  // 4 — the cannon would then correctly hold fire most of the time.)
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const x = i % WORLD_WIDTH;
    const y = (i / WORLD_WIDTH) | 0;
    colorId[i] = (x + y) % paletteSize;
  }
  const palette: PaletteEntry[] = Array.from({ length: paletteSize }, (_, id) => ({
    id,
    r: id * 40,
    g: 100,
    b: 200,
    a: 255,
    count: PIXEL_COUNT / paletteSize,
  }));
  return PixelWorld.create(palette, colorId);
}

describe("BatchExecutor", () => {
  it("destroys the requested number of pixels of one colour", () => {
    const world = makeWorld();
    const batch = new BatchExecutor(world);
    const destroyed = batch.execute({ kind: "color", colorId: 2, amount: 5000 }, new XorShift32(1));
    expect(destroyed).toBe(5000);
    expect(world.aliveByColor(2)).toBe(PIXEL_COUNT / 4 - 5000);
  });

  it("stops at the number of pixels that actually remain", () => {
    const world = makeWorld();
    const batch = new BatchExecutor(world);
    const destroyed = batch.execute(
      { kind: "color", colorId: 1, amount: PIXEL_COUNT * 2 },
      new XorShift32(9),
    );
    expect(destroyed).toBe(PIXEL_COUNT / 4);
    expect(world.aliveByColor(1)).toBe(0);
  });

  it("only touches cells inside the circle", () => {
    const world = makeWorld();
    const batch = new BatchExecutor(world);
    const cx = 512;
    const cy = 512;
    const radius = 20;

    batch.execute({ kind: "circle", x: cx, y: cy, radius, damage: 1 }, new XorShift32(3));

    for (let y = cy - 40; y <= cy + 40; y++) {
      for (let x = cx - 40; x <= cx + 40; x++) {
        const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
        const dead = world.colorId[y * WORLD_WIDTH + x] === DEAD;
        if (!inside) expect(dead).toBe(false);
      }
    }
  });

  it("filters a circle by colour when asked", () => {
    const world = makeWorld();
    const batch = new BatchExecutor(world);
    const destroyed = batch.execute(
      { kind: "circle", x: 300, y: 300, radius: 15, colorId: 0, damage: 1 },
      new XorShift32(4),
    );
    expect(destroyed).toBeGreaterThan(0);
    expect(world.aliveByColor(1)).toBe(PIXEL_COUNT / 4);
    expect(world.aliveByColor(2)).toBe(PIXEL_COUNT / 4);
  });

  it("clips an area effect at the board edges", () => {
    const world = makeWorld();
    const batch = new BatchExecutor(world);
    expect(() =>
      batch.execute({ kind: "circle", x: 2, y: 2, radius: 40, damage: 1 }, new XorShift32(5)),
    ).not.toThrow();
  });
});

describe("ProjectilePool", () => {
  it("recycles slots instead of allocating", () => {
    const pool = new ProjectilePool(4);
    const spawned = [];
    for (let i = 0; i < 4; i++) {
      const p = pool.spawn(base());
      expect(p).not.toBeNull();
      spawned.push(p!);
    }
    expect(pool.spawn(base())).toBeNull();

    pool.release(spawned[0]);
    expect(pool.spawn(base())).not.toBeNull();
    expect(pool.activeCount).toBe(4);
  });

  it("survives a release during iteration", () => {
    const pool = new ProjectilePool(8);
    for (let i = 0; i < 8; i++) pool.spawn(base());
    pool.forEachActive((p) => pool.release(p));
    expect(pool.activeCount).toBe(0);
  });

  function base() {
    return {
      axis: "row" as const,
      lane: 0,
      direction: 1 as const,
      along: 0,
      speed: 100,
      colorId: 0,
      damage: 1,
      remainingPierces: 1,
      remainingBounces: 0,
      maxAgeMs: 1000,
    };
  }
});

describe("CombatSimulator", () => {
  function simulator(world: PixelWorld, cards = [makeCard(0, 0)]) {
    const deck = new DeckRuntime(cards);
    return new CombatSimulator(world, deck, new Cannon(), new XorShift32(0xfeed), {}, new VisualLODController());
  }

  it("destroys real pixels through the exact regime", () => {
    const world = makeWorld();
    const sim = simulator(world);
    const before = world.aliveTotal();

    for (let frame = 0; frame < 240; frame++) {
      sim.update(16, frame * 16);
    }

    expect(world.aliveTotal()).toBeLessThan(before);
    expect(world.destroyedCount()).toBeGreaterThan(0);
  });

  it("only ever destroys cells matching the projectile colour", () => {
    const world = makeWorld();
    const sim = simulator(world);
    for (let frame = 0; frame < 200; frame++) sim.update(16, frame * 16);

    // Only colour 0 is targeted, so every other bucket must be untouched.
    for (let colour = 1; colour < world.paletteSize; colour++) {
      expect(world.aliveByColor(colour)).toBe(PIXEL_COUNT / 4);
    }
  });

  it("switches to the batched regime for a high level card", () => {
    const world = makeWorld();
    let card = makeCard(0, 0);
    for (let i = 0; i < 8; i++) card = upgradeCard(card);

    const sim = simulator(world, [card]);
    sim.update(16, 0);


    const stats = sim.getStats();
    expect(stats.batchedCommands).toBeGreaterThan(0);
    expect(stats.logicalImpacts).toBeGreaterThan(0);
    expect(stats.activeProjectiles).toBe(0);
  });

  // Doubles as the throughput benchmark the design calls for: the logical
  // impact rate has to keep climbing well past what the renderer draws.
  it("sustains >10k logical impacts per second while VFX stay bounded", () => {
    const world = makeWorld();
    const cards = [0, 1, 2, 3].map((colour) => {
      let card = makeCard(colour, 0);
      for (let i = 0; i < 14; i++) card = upgradeCard(card);
      return card;
    });

    const sim = simulator(world, cards);
    let logical = 0;
    let visual = 0;
    // 60 frames of 16 ms is one simulated second.
    for (let frame = 0; frame < 60; frame++) {
      sim.update(16, frame * 16);
      const stats = sim.getStats();
      logical += stats.logicalImpacts;
      visual += stats.visualImpacts;
    }

    expect(logical).toBeGreaterThan(10_000);
    expect(visual).toBeLessThan(logical / 4);
  });

  it("holds fire while the cannon faces a lane without its colour", () => {
    // Column-striped board: column x is entirely colour x % 4.
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) colorId[i] = (i % WORLD_WIDTH) % 4;
    const palette: PaletteEntry[] = Array.from({ length: 4 }, (_, id) => ({
      id,
      r: id * 40,
      g: 100,
      b: 200,
      a: 255,
      count: PIXEL_COUNT / 4,
    }));
    const world = PixelWorld.create(palette, colorId);

    const deck = new DeckRuntime([makeCard(1, 0)]);
    // Parked on column 0, which holds only colour 0.
    const cannon = new Cannon({ position: 0, speed: 0 });
    const sim = new CombatSimulator(world, deck, cannon, new XorShift32(1), {}, new VisualLODController());

    sim.update(16, 0);
    expect(sim.pool.activeCount).toBe(0);
    expect(world.destroyedCount()).toBe(0);

    // Move it in front of column 1, which is colour 1: the held shot goes off.
    cannon.position = 1;
    sim.update(16, 16);
    expect(sim.pool.activeCount).toBeGreaterThan(0);
  });

  it("fires down the lane it faces, never across the board", () => {
    const world = makeWorld();
    const deck = new DeckRuntime([makeCard(0, 0)]);
    const cannon = new Cannon({ position: 0, speed: 0 });
    const sim = new CombatSimulator(world, deck, cannon, new XorShift32(2), {}, new VisualLODController());

    sim.update(16, 0);
    sim.pool.forEachActive((p) => {
      expect(p.axis).toBe("column");
      expect(p.lane).toBe(0);
      expect(p.direction).toBe(1);
    });

    // Every destroyed cell must sit in column 0.
    for (let i = 0; i < 40; i++) sim.update(16, 16 * (i + 1));
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (world.colorId[i] === DEAD) expect(i % WORLD_WIDTH).toBe(0);
    }
  });

  it("stops firing once the board is empty instead of throwing", () => {
    const world = makeWorld(1);
    const sim = simulator(world, [makeCard(0, 0)]);
    world.destroyRandomOfColor(0, PIXEL_COUNT, new XorShift32(1));
    expect(() => sim.update(16, 0)).not.toThrow();
    expect(sim.getStats().destroyed).toBe(0);
  });
});

describe("VisualLODController", () => {
  it("passes everything through at a low impact rate", () => {
    const lod = new VisualLODController({
      maxVfxPerSecond: 900,
      maxSimulatedProjectiles: 900,
      textureUploadHz: 30,
    });
    lod.beginFrame(0);
    expect(lod.sample(10)).toBe(10);
  });

  it("raises the stride once the impact rate exceeds the budget", () => {
    const lod = new VisualLODController({
      maxVfxPerSecond: 100,
      maxSimulatedProjectiles: 100,
      textureUploadHz: 30,
    });
    lod.beginFrame(0);
    for (let frame = 1; frame <= 60; frame++) {
      lod.beginFrame(frame * 16.7);
      lod.sample(500); // ~30_000 impacts per second
    }
    lod.beginFrame(2000);
    expect(lod.currentStride).toBeGreaterThan(1);
  });

  it("caps the number of effects per second", () => {
    const lod = new VisualLODController({
      maxVfxPerSecond: 50,
      maxSimulatedProjectiles: 100,
      textureUploadHz: 30,
    });
    lod.beginFrame(0);
    let granted = 0;
    for (let frame = 1; frame < 60; frame++) {
      lod.beginFrame(frame * 16);
      granted += lod.sample(1000);
    }
    expect(granted).toBeLessThanOrEqual(50 * 2);
  });
});
