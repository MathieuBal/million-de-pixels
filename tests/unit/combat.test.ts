import { describe, expect, it } from "vitest";
import { ActiveCannon } from "../../src/cannon/ActiveCannon";
import { CannonLoadGenerator, DEFAULT_LOAD_AMMO } from "../../src/cannon/CannonLoad";
import { CannonQueue } from "../../src/cannon/CannonQueue";
import { ColorAmmoReserve } from "../../src/cannon/ColorAmmoReserve";
import { CombatSimulator, MAX_ACTIVE_CANNONS } from "../../src/combat/CombatSimulator";
import { ProjectilePool } from "../../src/combat/ProjectilePool";
import { PixelWorld } from "../../src/world/PixelWorld";
import { XorShift32 } from "../../src/rng/XorShift32";
import { VisualLODController } from "../../src/rendering/VisualLODController";
import { DEAD, PIXEL_COUNT, WORLD_WIDTH } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

/** Diagonal stripes: every row and every column holds every colour. */
function makeWorld(paletteSize = 4): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const x = i % WORLD_WIDTH;
    const y = (i / WORLD_WIDTH) | 0;
    colorId[i] = (x + y) % paletteSize;
  }
  return PixelWorld.create(
    makePalette(paletteSize, new Array(paletteSize).fill(PIXEL_COUNT / paletteSize)),
    colorId,
  );
}

function setup(paletteSize = 4, seed = 1) {
  const world = makeWorld(paletteSize);
  const reserve = new ColorAmmoReserve(world);
  const rng = new XorShift32(seed);
  const queue = new CannonQueue(new CannonLoadGenerator(reserve, rng), reserve);
  queue.refill();
  const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());
  return { world, reserve, queue, combat };
}

function run(combat: CombatSimulator, frames: number, startMs = 0): void {
  for (let f = 0; f < frames; f++) combat.update(16, startMs + f * 16);
}

describe("ColorAmmoReserve", () => {
  /** A reserve with nothing committed yet — no queue in the way. */
  function bare(paletteSize = 2) {
    const world = makeWorld(paletteSize);
    return { world, reserve: new ColorAmmoReserve(world) };
  }

  it("never promises more rounds than there are pixels", () => {
    const { world, reserve } = bare();
    const alive = world.aliveByColor(0);
    expect(reserve.reserveForQueue(0, alive + 5000)).toBe(alive);
    expect(reserve.assignable(0)).toBe(0);
  });

  it("keeps queued plus active within the living pixels", () => {
    const { world, reserve } = bare();
    reserve.reserveForQueue(0, 100);
    reserve.promoteToActive(0, 60);

    const state = reserve.stateOf(0);
    expect(state.queuedAmmo).toBe(40);
    expect(state.activeAmmo).toBe(60);
    expect(state.queuedAmmo + state.activeAmmo).toBeLessThanOrEqual(world.aliveByColor(0));
  });

  it("stops offering a colour once its pixels are gone", () => {
    const { world, reserve } = bare();
    world.destroyRandomOfColor(0, PIXEL_COUNT, new XorShift32(1));
    expect(reserve.assignable(0)).toBe(0);
    expect(reserve.availableColors()).not.toContain(0);
  });

  it("returns unspent rounds when a cannon leaves", () => {
    const { reserve } = bare();
    reserve.reserveForQueue(0, 40);
    reserve.promoteToActive(0, 40);
    reserve.releaseFromActive(0, 40);
    expect(reserve.stateOf(0).activeAmmo).toBe(0);
  });
});

describe("CannonQueue", () => {
  it("offers a fixed number of loads", () => {
    const { queue } = setup();
    expect(queue.visible).toHaveLength(5);
    for (const load of queue.visible) expect(load.ammo).toBe(DEFAULT_LOAD_AMMO);
  });

  it("only offers colours the image actually contains", () => {
    // Two colours out of a palette of four are absent from the board.
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) colorId[i] = i % 2;
    const world = PixelWorld.create(
      makePalette(4, [PIXEL_COUNT / 2, PIXEL_COUNT / 2, 0, 0]),
      colorId,
    );
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(7)), reserve);
    queue.refill();

    for (const load of queue.visible) expect(load.colorId).toBeLessThan(2);
  });

  it("refills the slot a taken load leaves behind", () => {
    const { queue } = setup();
    const first = queue.visible[0];
    expect(queue.take(first.id)).not.toBeNull();
    expect(queue.visible).toHaveLength(5);
    expect(queue.visible.find((l) => l.id === first.id)).toBeUndefined();
  });

  it("ignores a stale load id", () => {
    const { queue } = setup();
    expect(queue.take("load-does-not-exist")).toBeNull();
  });

  it("drops loads whose colour ran out and frees their rounds", () => {
    const { world, reserve, queue } = setup(2);
    const doomed = queue.visible.find((l) => l.colorId === 0);
    world.destroyRandomOfColor(0, PIXEL_COUNT, new XorShift32(3));

    const dropped = queue.dropExhausted();
    if (doomed) {
      expect(dropped.map((l) => l.id)).toContain(doomed.id);
      expect(reserve.stateOf(0).queuedAmmo).toBe(0);
    }
    for (const load of queue.visible) expect(world.aliveByColor(load.colorId)).toBeGreaterThan(0);
  });

  it("stops offering anything once the board is empty", () => {
    const { world, queue } = setup(2);
    for (let c = 0; c < 2; c++) world.destroyRandomOfColor(c, PIXEL_COUNT, new XorShift32(c + 1));
    queue.dropExhausted();
    expect(queue.visible).toHaveLength(0);
  });
});

describe("ActiveCannon", () => {
  it("holds fire until its cooldown elapses", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 5 }, 0);
    expect(cannon.canFire()).toBe(true);
    cannon.onFired();
    expect(cannon.canFire()).toBe(false);
    cannon.update(200);
    cannon.onHit();
    expect(cannon.canFire()).toBe(true);
  });

  it("never puts more balls in the air than it has rounds", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 2 }, 0);
    cannon.onFired();
    cannon.update(500);
    cannon.onFired();
    cannon.update(500);
    expect(cannon.canFire()).toBe(false);
  });

  it("spends a round on a hit and none on a miss", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 10 }, 0);
    cannon.onFired();
    cannon.onHit();
    expect(cannon.ammo).toBe(9);

    cannon.onFired();
    cannon.onMiss();
    expect(cannon.ammo).toBe(9);
  });

  it("leaves the rail once its stock is spent", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 1 }, 0);
    cannon.onFired();
    expect(cannon.isFinished()).toBe(false);
    cannon.onHit();
    expect(cannon.isFinished()).toBe(true);
  });

  it("ends its mission immediately when its colour is gone", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 30 }, 0);
    cannon.retire();
    expect(cannon.canFire()).toBe(false);
    expect(cannon.isFinished()).toBe(true);
  });

  it("round-trips through serialize", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 2, ammo: 17 }, 900);
    const restored = ActiveCannon.restore(cannon.serialize());
    expect(restored.colorId).toBe(2);
    expect(restored.ammo).toBe(17);
    expect(restored.trackPosition).toBeCloseTo(900, 6);
  });
});

describe("CombatSimulator", () => {
  it("launches a queued load onto the rail", () => {
    const { combat, queue } = setup();
    const load = queue.visible[0];
    const cannon = combat.launch(load.id);

    expect(cannon).not.toBeNull();
    expect(combat.activeCannons).toHaveLength(1);
    expect(cannon!.colorId).toBe(load.colorId);
    expect(cannon!.ammo).toBe(load.ammo);
  });

  it("refuses a sixth cannon on the rail", () => {
    const { combat, queue } = setup();
    for (let i = 0; i < MAX_ACTIVE_CANNONS; i++) {
      expect(combat.launch(queue.visible[0].id)).not.toBeNull();
    }
    expect(combat.hasFreeSlot).toBe(false);
    expect(combat.launch(queue.visible[0].id)).toBeNull();
    expect(combat.activeCannons).toHaveLength(MAX_ACTIVE_CANNONS);
  });

  it("destroys real pixels, one per round", () => {
    const { world, combat, queue } = setup();
    const load = queue.visible[0];
    combat.launch(load.id);

    const before = world.aliveTotal();
    run(combat, 400);

    const destroyed = before - world.aliveTotal();
    expect(destroyed).toBeGreaterThan(0);
    // A stock of N rounds can never destroy more than N blocks.
    expect(destroyed).toBeLessThanOrEqual(load.ammo);
  });

  it("never destroys a pixel off the ball's trajectory", () => {
    // The absolute criterion: no aggregate command, no random pick by colour.
    const { world, combat, queue } = setup();
    for (let i = 0; i < 3; i++) combat.launch(queue.visible[0].id);

    const lanes = new Set<string>();
    for (let frame = 0; frame < 600; frame++) {
      for (const cannon of combat.activeCannons) {
        const aim = cannon.aim();
        lanes.add(`${aim.axis}:${aim.lane}`);
      }
      combat.update(16, frame * 16);
    }

    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (world.colorId[i] !== DEAD) continue;
      const x = i % WORLD_WIDTH;
      const y = (i / WORLD_WIDTH) | 0;
      expect(lanes.has(`row:${y}`) || lanes.has(`column:${x}`)).toBe(true);
    }
  });

  it("destroys only cells of the cannon's own colour", () => {
    const { world, combat, queue } = setup();
    const load = queue.visible.find((l) => l.colorId === 0) ?? queue.visible[0];
    combat.launch(load.id);
    run(combat, 400);

    for (let colour = 0; colour < world.paletteSize; colour++) {
      if (colour === load.colorId) continue;
      expect(world.aliveByColor(colour)).toBe(PIXEL_COUNT / 4);
    }
  });

  it("takes the cannon off the rail once its stock is spent", () => {
    const { combat, queue } = setup();
    combat.launch(queue.visible[0].id);
    run(combat, 3000);
    expect(combat.activeCannons).toHaveLength(0);
  });

  it("spends no round while facing a lane without its colour", () => {
    // Column-striped board: column x holds only colour x % 2.
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) colorId[i] = (i % WORLD_WIDTH) % 2;
    const world = PixelWorld.create(
      makePalette(2, [PIXEL_COUNT / 2, PIXEL_COUNT / 2]),
      colorId,
    );
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(5)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    const cannon = combat.launch(queue.visible[0].id)!;
    // Parked on a column that cannot hold its colour.
    cannon.moveSpeed = 0;
    cannon.trackPosition = cannon.colorId === 0 ? 1 : 0;

    const before = cannon.ammo;
    run(combat, 200);
    expect(cannon.ammo).toBe(before);
    expect(world.destroyedCount()).toBe(0);
  });

  it("retires a cannon whose colour ran out mid-mission", () => {
    const { world, combat, queue } = setup(2);
    const cannon = combat.launch(queue.visible[0].id)!;
    world.destroyRandomOfColor(cannon.colorId, PIXEL_COUNT, new XorShift32(11));

    run(combat, 5);
    expect(combat.activeCannons).toHaveLength(0);
  });

  it("runs several cannons of different colours at once", () => {
    const { world, combat, queue } = setup();
    while (combat.hasFreeSlot) combat.launch(queue.visible[0].id);

    const touched = new Set(combat.activeCannons.map((c) => c.colorId));
    run(combat, 300);

    let destroyedColors = 0;
    for (let colour = 0; colour < world.paletteSize; colour++) {
      if (world.aliveByColor(colour) < PIXEL_COUNT / 4) destroyedColors++;
    }
    expect(destroyedColors).toBeGreaterThan(0);
    expect(destroyedColors).toBeLessThanOrEqual(touched.size);
  });

  it("does nothing at all with an empty rail", () => {
    const { world, combat } = setup();
    run(combat, 200);
    expect(world.destroyedCount()).toBe(0);
  });
});

describe("ProjectilePool", () => {
  const base = () => ({
    cannonId: "c",
    colorId: 0,
    axis: "row" as const,
    lane: 0,
    direction: 1 as const,
    position: 0,
    speed: 100,
  });

  it("recycles slots instead of allocating", () => {
    const pool = new ProjectilePool(4);
    const spawned = [];
    for (let i = 0; i < 4; i++) spawned.push(pool.spawn(base())!);
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
});
