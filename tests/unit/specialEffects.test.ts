import { describe, expect, it } from "vitest";
import { NO_EFFECTS, resolveEffects, type EffectLoadout } from "../../src/combat/SpecialEffects";
import { aimAt } from "../../src/combat/Cannon";
import { PixelWorld } from "../../src/world/PixelWorld";
import { XorShift32 } from "../../src/rng/XorShift32";
import { DEAD, PIXEL_COUNT, VOID, WORLD_WIDTH } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

function readRow(world: PixelWorld, length: number): string {
  let out = "";
  for (let x = 0; x < length; x++) out += world.colorId[x] === DEAD ? "." : String(world.colorId[x]);
  return out;
}

/** VOID everywhere except one row, written left to right from x = 0. */
function rowWorld(pattern: number[], paletteSize = 3): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
  const counts = new Array(paletteSize).fill(0);
  for (let x = 0; x < pattern.length; x++) {
    colorId[x] = pattern[x];
    counts[pattern[x]]++;
  }
  return PixelWorld.create(makePalette(paletteSize, counts), colorId);
}

/** A solid block of one colour, so a blast and an arc have room to work. */
function blockWorld(size: number, paletteSize = 2): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
  let count = 0;
  for (let y = 100; y < 100 + size; y++) {
    for (let x = 100; x < 100 + size; x++) {
      colorId[y * WORLD_WIDTH + x] = 0;
      count++;
    }
  }
  return PixelWorld.create(makePalette(paletteSize, [count, 0]), colorId);
}

const FROM_LEFT = aimAt(2 * WORLD_WIDTH + 1024 + 1023);
const always = (over: Partial<EffectLoadout>): EffectLoadout => ({ ...NO_EFFECTS, ...over });

describe("resolveEffects", () => {
  it("does nothing at all with no specialisation bought", () => {
    const world = blockWorld(6);
    const before = world.aliveTotal();
    const out = resolveEffects(world, 0, FROM_LEFT, 100 * WORLD_WIDTH + 100, NO_EFFECTS, new XorShift32(1), 999);

    expect(out.destroyed).toBe(0);
    expect(world.aliveTotal()).toBe(before);
  });

  describe("perce", () => {
    it("reaches its colour behind an obstacle without destroying the obstacle", () => {
      // B B R : blue wall, red behind. The surface is blue, so a normal bite
      // finds nothing — this is exactly the burial that stalls a run.
      const world = rowWorld([1, 1, 0]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, -1,
        always({ pierceChance: 1, pierceDepth: 2 }),
        new XorShift32(1), 10,
      );

      expect(out.pierced).toBe(true);
      expect(out.destroyed).toBe(1);
      // The wall it looked past is untouched: a foreign colour is never
      // destroyed by anything a cannon does.
      expect(world.aliveByColor(1)).toBe(2);
      expect(world.aliveByColor(0)).toBe(0);
    });

    it("stops at the depth bought", () => {
      const world = rowWorld([1, 1, 1, 0]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, -1,
        always({ pierceChance: 1, pierceDepth: 2 }),
        new XorShift32(1), 10,
      );

      expect(out.pierced).toBe(false);
      expect(world.aliveByColor(0)).toBe(1);
    });

    it("never fires when the chance is zero", () => {
      const world = rowWorld([1, 1, 0]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, -1,
        always({ pierceChance: 0, pierceDepth: 5 }),
        new XorShift32(1), 10,
      );

      expect(out.destroyed).toBe(0);
    });
  });

  describe("éclat", () => {
    it("takes the neighbours of the kill, of its colour only", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ explosionChance: 1, explosionRadius: 2 }),
        new XorShift32(1), 999,
      );

      expect(out.exploded).toBe(true);
      // A radius-2 span-filled disc: 13 cells, all inside the block.
      expect(out.destroyed).toBe(13);
    });

    it("never removes more than the cannon can pay for", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ explosionChance: 1, explosionRadius: 4 }),
        new XorShift32(1), 3,
      );

      expect(out.destroyed).toBe(3);
    });
  });

  describe("feu", () => {
    it("floods the colour region outwards from the kill", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ fireChance: 1, fireSpread: 12 }),
        new XorShift32(5), 999,
      );

      expect(out.burned).toBe(true);
      expect(out.destroyed).toBe(12);
    });

    it("follows the shape of the colour rather than stamping a disc", () => {
      // A one-cell-wide arm: a blast of the same size would take the cells
      // beside it too, a fire can only go where the colour goes.
      const world = rowWorld([0, 0, 0, 0, 0, 0]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, 0,
        always({ fireChance: 1, fireSpread: 3 }),
        new XorShift32(5), 999,
      );

      expect(out.destroyed).toBe(3);
      // The kill itself is the origin, not fuel; the fire takes the three cells
      // the colour actually offers next to it, in order.
      expect(readRow(world, 6)).toBe("0...00");
    });

    it("stops on the stock like every other effect", () => {
      const world = blockWorld(9);
      const out = resolveEffects(
        world, 0, FROM_LEFT, 104 * WORLD_WIDTH + 104,
        always({ fireChance: 1, fireSpread: 40 }),
        new XorShift32(5), 5,
      );

      expect(out.destroyed).toBe(5);
    });
  });

  describe("foudre", () => {
    it("jumps from the kill along its own colour", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ lightningChance: 1, lightningArcs: 4 }),
        new XorShift32(7), 999,
      );

      expect(out.sparked).toBe(true);
      expect(out.destroyed).toBe(4);
      // It walks rather than fills: every cell it took touches the previous one.
      for (const index of out.touched) {
        expect(world.colorId[index]).not.toBe(0);
      }
    });

    it("stops when there is nothing left to jump to", () => {
      // A lone cell of colour 0: the arc has no neighbour of its colour.
      const world = rowWorld([0, 1, 1]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, 0,
        always({ lightningChance: 1, lightningArcs: 9 }),
        new XorShift32(3), 999,
      );

      expect(out.destroyed).toBe(0);
      expect(world.aliveByColor(1)).toBe(2);
    });
  });

  describe("traces", () => {
    // The renderer draws what the simulation actually did. Passing the shape up
    // costs nothing and stops the renderer inventing a plausible one — which
    // would be gameplay decided in the wrong place.
    it("hands the blast its centre and its radius", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ explosionChance: 1, explosionRadius: 3 }),
        new XorShift32(1), 999,
      );

      expect(out.marks).toHaveLength(1);
      expect(out.marks[0]).toEqual({ kind: "explode", center, radius: 3 });
    });

    it("hands the arc its walk, in order, starting where it was struck", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ lightningChance: 1, lightningArcs: 4 }),
        new XorShift32(7), 999,
      );

      const mark = out.marks[0];
      expect(mark.kind).toBe("arc");
      if (mark.kind !== "arc") return;
      expect(mark.path[0]).toBe(center);
      expect(mark.path).toHaveLength(5);
      // Every step touches the one before it: a walk, not a scatter.
      for (let i = 1; i < mark.path.length; i++) {
        const dx = Math.abs((mark.path[i] % WORLD_WIDTH) - (mark.path[i - 1] % WORLD_WIDTH));
        const dy = Math.abs(
          ((mark.path[i] / WORLD_WIDTH) | 0) - ((mark.path[i - 1] / WORLD_WIDTH) | 0),
        );
        expect(dx + dy).toBe(1);
      }
    });

    it("hands the fire its front, in the order it spread", () => {
      const world = blockWorld(9);
      const center = 104 * WORLD_WIDTH + 104;
      const out = resolveEffects(
        world, 0, FROM_LEFT, center,
        always({ fireChance: 1, fireSpread: 8 }),
        new XorShift32(5), 999,
      );

      const mark = out.marks[0];
      expect(mark.kind).toBe("burn");
      if (mark.kind !== "burn") return;
      expect(mark.path[0]).toBe(center);
      expect(mark.path).toHaveLength(9);
    });

    it("hands the pierce both ends of what it went through", () => {
      const world = rowWorld([1, 1, 0]);
      const out = resolveEffects(
        world, 0, FROM_LEFT, -1,
        always({ pierceChance: 1, pierceDepth: 2 }),
        new XorShift32(1), 10,
      );

      const mark = out.marks[0];
      expect(mark.kind).toBe("pierce");
      if (mark.kind !== "pierce") return;
      // From the surface it looked past, to the cell it actually took.
      expect(mark.from).toBe(0);
      expect(mark.to).toBe(2);
    });

    it("leaves no trace when nothing fired", () => {
      const world = blockWorld(6);
      const out = resolveEffects(
        world, 0, FROM_LEFT, 100 * WORLD_WIDTH + 100,
        NO_EFFECTS, new XorShift32(1), 999,
      );
      expect(out.marks).toEqual([]);
    });
  });

  it("is deterministic for a given generator state", () => {
    const play = () => {
      const world = blockWorld(9);
      const out = resolveEffects(
        world, 0, FROM_LEFT, 104 * WORLD_WIDTH + 104,
        always({ lightningChance: 0.5, lightningArcs: 6, explosionChance: 0.5, explosionRadius: 2 }),
        new XorShift32(0x1234), 999,
      );
      return `${out.destroyed}:${out.touched.join(",")}`;
    };

    expect(play()).toBe(play());
  });
});
