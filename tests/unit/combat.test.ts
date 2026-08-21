import { describe, expect, it } from "vitest";
import { ActiveCannon } from "../../src/cannon/ActiveCannon";
import { CannonLoadGenerator, DEFAULT_LOAD_AMMO } from "../../src/cannon/CannonLoad";
import { CannonQueue, VISIBLE_LOADS } from "../../src/cannon/CannonQueue";
import { ColorAmmoReserve } from "../../src/cannon/ColorAmmoReserve";
import { CombatSimulator, MAX_ACTIVE_CANNONS } from "../../src/combat/CombatSimulator";
import { aimAt, PERIMETER } from "../../src/combat/Cannon";
import { PixelWorld } from "../../src/world/PixelWorld";
import { XorShift32 } from "../../src/rng/XorShift32";
import { VisualLODController } from "../../src/rendering/VisualLODController";
import { DEAD, PIXEL_COUNT, WORLD_HEIGHT, WORLD_WIDTH } from "../../src/core/constants";
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
    expect(queue.visible).toHaveLength(VISIBLE_LOADS);
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
    expect(queue.visible).toHaveLength(VISIBLE_LOADS);
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
  it("reports the distance it covered, because that is its workload", () => {
    // There is no cadence any more: every lane crossed is an opportunity, so
    // what the simulator needs back from a move is how far it went.
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 5 }, 0);
    cannon.tune(300);
    expect(cannon.update(1000)).toBeCloseTo(300, 6);
    expect(cannon.trackPosition).toBeCloseTo(300, 6);
  });

  it("spends one round per block a burst actually removed", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 10 }, 0);
    cannon.onBurst(3);
    expect(cannon.ammo).toBe(7);
    // A lane with nothing to peel costs nothing.
    cannon.onBurst(0);
    expect(cannon.ammo).toBe(7);
  });

  it("never spends more rounds than it carries", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 2 }, 0);
    cannon.onBurst(5);
    expect(cannon.ammo).toBe(0);
  });

  it("leaves the rail once its stock is spent", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 1 }, 0);
    expect(cannon.isFinished()).toBe(false);
    cannon.onBurst(1);
    expect(cannon.isFinished()).toBe(true);
  });

  it("leaves after a full lap that peeled nothing", () => {
    // Its colour is buried behind another from every side: without this the
    // cannon would orbit forever and hold a rail slot hostage.
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 30 }, 0);
    cannon.tune(PERIMETER);
    cannon.update(1100);
    expect(cannon.isFinished()).toBe(true);
  });

  it("ends its mission immediately when its colour is gone", () => {
    const cannon = new ActiveCannon({ id: "c", colorId: 0, ammo: 30 }, 0);
    cannon.retire();
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

  it("never destroys a pixel off the lanes a cannon crossed", () => {
    // The absolute criterion: no aggregate command, no random pick by colour.
    //
    // A frame's trajectory is now the whole arc a cannon covered, not the
    // single position it landed on — that is exactly the change that turned
    // speed into throughput — so the reference set has to be the arc too. Sixty
    // frames keep the covered lanes well under the perimeter, or the assertion
    // would pass on anything.
    const { world, combat, queue } = setup();
    for (let i = 0; i < 3; i++) combat.launch(queue.visible[0].id);

    const lanes = new Set<string>();
    for (let frame = 0; frame < 60; frame++) {
      for (const cannon of combat.activeCannons) {
        const travel = cannon.moveSpeed * 0.016;
        for (let p = Math.floor(cannon.trackPosition); p <= cannon.trackPosition + travel + 1; p++) {
          const aim = aimAt(p);
          lanes.add(`${aim.axis}:${aim.lane}`);
        }
      }
      combat.update(16, frame * 16);
    }

    // The check is only worth anything while most of the rail is untouched.
    expect(lanes.size).toBeLessThan(PERIMETER / 2);

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

  it("is blocked by a foreign colour and spends no round", () => {
    // Two stacked bands: colour 1 covers colour 0 from the top.
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      colorId[i] = ((i / WORLD_WIDTH) | 0) < WORLD_HEIGHT / 2 ? 1 : 0;
    }

    const world = PixelWorld.create(makePalette(2, [PIXEL_COUNT / 2, PIXEL_COUNT / 2]), colorId);
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(4)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    const load = queue.visible.find((l) => l.colorId === 0)!;
    const cannon = combat.launch(load.id)!;
    // Parked on the top edge: colour 1 faces it, colour 0 is behind.
    cannon.moveSpeed = 0;
    cannon.trackPosition = 200;

    const before = cannon.ammo;
    run(combat, 120);

    expect(cannon.ammo).toBe(before);
    expect(world.aliveByColor(0)).toBe(PIXEL_COUNT / 2);
    expect(world.aliveByColor(1)).toBe(PIXEL_COUNT / 2);
  });

  it("fires once the colour in front of it has been cleared", () => {
    // Column 0 is colour 1 on top of colour 0; every other column is colour 1.
    const colorId = new Uint8Array(PIXEL_COUNT).fill(1);
    for (let y = 4; y < WORLD_HEIGHT; y++) colorId[y * WORLD_WIDTH] = 0;

    const counts = [WORLD_HEIGHT - 4, PIXEL_COUNT - (WORLD_HEIGHT - 4)];
    const world = PixelWorld.create(makePalette(2, counts), colorId);
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(8)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    const load = queue.visible.find((l) => l.colorId === 0)!;
    const cannon = combat.launch(load.id)!;
    // Slow enough that sixty frames stay in the columns of pure colour 1, so
    // the only lane that can ever match is column 0. A cannon at rest is not an
    // option any more: with the rail as the clock, standing still is no work.
    cannon.moveSpeed = 60;
    cannon.trackPosition = 0; // top of column 0

    run(combat, 60);
    expect(world.aliveByColor(0)).toBe(counts[0]); // the facade holds

    // Strip the four cells of colour 1 capping the column.
    for (let y = 0; y < 4; y++) world.destroy(y * WORLD_WIDTH);

    // Bring it back round to column 0 and let it pass again.
    cannon.trackPosition = 0;
    run(combat, 60);
    expect(world.aliveByColor(0)).toBeLessThan(counts[0]);
  });

  it("takes a cannon off the rail when its colour is unreachable", () => {
    // Colour 0 is walled in on all four sides by colour 1.
    const colorId = new Uint8Array(PIXEL_COUNT).fill(1);
    for (let y = 300; y < 700; y++) {
      for (let x = 300; x < 700; x++) colorId[y * WORLD_WIDTH + x] = 0;
    }

    const buried = 400 * 400;
    const world = PixelWorld.create(makePalette(2, [buried, PIXEL_COUNT - buried]), colorId);
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(12)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    const load = queue.visible.find((l) => l.colorId === 0)!;
    combat.launch(load.id);

    // One full lap at the default speed, and a little more.
    run(combat, 1200);

    expect(combat.activeCannons).toHaveLength(0);
    expect(world.aliveByColor(0)).toBe(buried);
    // Its rounds went back to the reserve rather than vanishing.
    expect(reserve.stateOf(0).activeAmmo).toBe(0);
  });

  it("keeps the blast inside its radius and its colour", () => {
    const world = makeWorld();
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(21)), reserve);
    queue.refill();
    const combat = new CombatSimulator(
      world,
      queue,
      reserve,
      { blastRadius: 3 },
      new VisualLODController(),
    );

    const load = queue.visible[0];
    combat.launch(load.id);
    run(combat, 200);

    const destroyed: Array<[number, number]> = [];
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (world.colorId[i] !== DEAD) continue;
      destroyed.push([i % WORLD_WIDTH, (i / WORLD_WIDTH) | 0]);
    }

    expect(destroyed.length).toBeGreaterThan(0);
    // A blast never reaches a colour other than the cannon's.
    for (const [x, y] of destroyed) {
      expect((x + y) % world.paletteSize).toBe(load.colorId);
    }
  });

  it("destroys strictly one block per round at radius zero", () => {
    const world = makeWorld();
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(22)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    const load = queue.visible[0];
    combat.launch(load.id);
    run(combat, 400);

    expect(world.destroyedCount()).toBeLessThanOrEqual(load.ammo);
  });

  it("destroys the same blocks at 30, 60 and 120 FPS", () => {
    // The acceptance invariant of the whole refactor: the rail is the clock,
    // so the same simulated time must do the same work however it is sliced.
    // A cadence could never hold this — it counted frames, not distance.
    const play = (frameMs: number, frames: number) => {
      const { world, combat, queue } = setup(4, 7);
      for (let i = 0; i < 3; i++) combat.launch(queue.visible[0].id);
      for (let f = 0; f < frames; f++) combat.update(frameMs, f * frameMs);
      return world.destroyedCount();
    };

    const at60 = play(1000 / 60, 120); // 2 s
    expect(at60).toBeGreaterThan(0);
    expect(play(1000 / 30, 60)).toBe(at60);
    expect(play(1000 / 120, 240)).toBe(at60);
  });

  it("destroys more in the same time when the rail turns faster", () => {
    const play = (moveSpeed: number) => {
      const { world, combat, queue } = setup(4, 7);
      for (let i = 0; i < 3; i++) combat.launch(queue.visible[0].id);
      combat.tuneCannons(moveSpeed);
      // A short window on purpose: three cannons carry a hundred and twenty
      // rounds between them and a burst spends them fast, so a long run would
      // measure the ammunition stock instead of the speed.
      for (let f = 0; f < 10; f++) combat.update(16, f * 16);
      return world.destroyedCount();
    };

    // Speed used to buy nothing at all: throughput was pinned at
    // `1000 / fireIntervalMs` and going faster only skipped more lanes.
    expect(play(760)).toBeGreaterThan(play(260));
  });

  it("keeps queued plus active within the living pixels for a whole run", () => {
    const { world, combat, queue, reserve } = setup(4, 11);
    for (let i = 0; i < MAX_ACTIVE_CANNONS; i++) {
      const load = queue.visible[0];
      if (load) combat.launch(load.id);
    }

    for (let frame = 0; frame < 400; frame++) {
      combat.update(16, frame * 16);
      queue.refill();
      for (let colour = 0; colour < 4; colour++) {
        const state = reserve.stateOf(colour);
        expect(state.queuedAmmo + state.activeAmmo).toBeLessThanOrEqual(
          world.aliveByColor(colour),
        );
      }
    }
  });

  it("re-offers a load when a cannon leaves the rail with rounds unspent", () => {
    // The dead end this guards against: late in a level the queue drains
    // because every remaining pixel is committed to the rail, then a cannon
    // gives up on a buried colour and hands its rounds back. Nothing else
    // refills the queue — `take()` needs a tile to click, `dropExhausted()`
    // only refills when it dropped something — so the player was left with
    // pixels on the board, no tiles, and no way to play on.
    const colorId = new Uint8Array(PIXEL_COUNT).fill(DEAD);
    for (let i = 0; i < 60; i++) colorId[500 * WORLD_WIDTH + 300 + i] = 0;
    for (let i = 0; i < 60; i++) colorId[700 * WORLD_WIDTH + 300 + i] = 1;

    const world = PixelWorld.create(makePalette(2, [60, 60]), colorId);
    const reserve = new ColorAmmoReserve(world);
    const queue = new CannonQueue(new CannonLoadGenerator(reserve, new XorShift32(5)), reserve);
    queue.refill();
    const combat = new CombatSimulator(world, queue, reserve, {}, new VisualLODController());

    // The player takes everything on offer; the colours are fully committed, so
    // the generator has nothing left to draw and the queue stays empty.
    while (queue.visible.length > 0 && combat.hasFreeSlot) combat.launch(queue.visible[0].id);
    expect(queue.visible).toHaveLength(0);

    // A cannon gives up — exactly what a full lap without a burst does.
    combat.activeCannons[0].retire();
    combat.update(16, 16);

    expect(world.aliveTotal()).toBeGreaterThan(0);
    expect(queue.visible.length).toBeGreaterThan(0);
  });

  it("never leaves the player without an offer while rounds can be handed out", () => {
    const { world, combat, queue, reserve } = setup(4, 3);
    for (let frame = 0; frame < 600; frame++) {
      while (queue.visible.length > 0 && combat.hasFreeSlot) {
        if (!combat.launch(queue.visible[0].id)) break;
      }
      combat.update(16, frame * 16);

      const assignable = [0, 1, 2, 3].reduce((sum, c) => sum + reserve.assignable(c), 0);
      if (assignable > 0) expect(queue.visible.length).toBeGreaterThan(0);
    }
    expect(world.aliveTotal()).toBeGreaterThan(0);
  });

  it("does nothing at all with an empty rail", () => {
    const { world, combat } = setup();
    run(combat, 200);
    expect(world.destroyedCount()).toBe(0);
  });
});
