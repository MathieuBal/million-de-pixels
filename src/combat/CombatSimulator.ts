import { ActiveCannon, CANNON_MOVE_SPEED, FINALE_MOVE_SPEED } from "../cannon/ActiveCannon";
import type { CannonLoad } from "../cannon/CannonLoad";
import type { CannonQueue } from "../cannon/CannonQueue";
import type { ColorAmmoReserve } from "../cannon/ColorAmmoReserve";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { PixelWorld } from "../world/PixelWorld";
import { VisualLODController } from "../rendering/VisualLODController";
import { crossedLanes, PERIMETER } from "./Cannon";
import { BITE_DEPTH, resolveLaneBurst, type BurstEvent } from "./LineBurst";
import {
  NO_EFFECTS,
  resolveEffects,
  type EffectLoadout,
  type EffectMark,
} from "./SpecialEffects";
import type { Rng } from "../rng/XorShift32";
import { XorShift32 } from "../rng/XorShift32";

export interface ImpactEvent {
  x: number;
  y: number;
  colorId: number;
}

export interface CombatStats {
  activeCannons: number;
  /** Lanes examined this frame — the rail's real workload. */
  lanesExamined: number;
  /** Lanes that matched and were peeled. */
  bursts: number;
  /** Bites that also set off a specialisation. */
  effects: number;
  destroyed: number;
}

export interface CombatOptions {
  maxActiveCannons?: number;
  /** Rail speed handed to every cannon, including the ones not launched yet. */
  moveSpeed?: number;
  /** Pierce, explosion, lightning and fire. All zero is the plain game. */
  effects?: EffectLoadout;
  /** Chance a crossing takes a second cell off the same lane. */
  doubleBiteChance?: number;
  /** Chance a launched load puts two cannons on the rail instead of one. */
  twinChance?: number;
  /**
   * Rolls the effect chances. Its own generator, never the world's: sharing one
   * would make the offline catch-up's draws depend on how many shots happened
   * to fire before it, and the run would stop being reproducible.
   */
  rng?: Rng;
  /**
   * Cells a single lane crossing takes off. One by default: a cannon files the
   * outline as it passes. Deeper bites cut visible straight gashes across the
   * picture instead of eating it from its edges.
   */
  biteDepth?: number;
  /**
   * Cells around the last block of a burst also destroyed, of the same colour
   * only. Zero is the base game; it is the hook the effects system will drive,
   * not a purchasable axis.
   */
  blastRadius?: number;
}

/** Opening value, to test rather than to treat as balance. */
export const MAX_ACTIVE_CANNONS = 5;

/**
 * Progress past which the level finishes itself.
 *
 * The last thousandth of an image is the worst part of the game and the part
 * that strands players: a colour down to eleven pixels cannot fund a cannon
 * worth launching, and what is left is usually buried under something else. The
 * ammunition economy has simply stopped meaning anything by then — so it is
 * dropped, and the image is finished.
 */
export const FINALE_THRESHOLD = 0.999;

/**
 * How often the palette's reachability is re-read, and one stale offer re-cut.
 *
 * A second, for two reasons that pull the same way: the answer changes on the
 * scale of a cannon's lap, not a frame, and re-cutting an offer moves a tile —
 * so it must be rare enough that a finger already on its way down effectively
 * never meets one.
 */
export const REACHABILITY_INTERVAL_MS = 1000;

/**
 * Drives the cannons currently on the rail.
 *
 * **The rail is the clock.** Every lane a cannon crosses is an opportunity, so
 * the work a cannon does is exactly the distance it covered — and speed is the
 * production stat. There is no cadence: a fixed shot interval capped output at
 * `1000 / interval` whatever the speed, which made the speed upgrade buy
 * nothing but skipped lanes.
 *
 * The rule the whole design rests on is unchanged: **one round destroys at most
 * one block**. A lane is peeled from the surface inwards while the exposed cell
 * is the cannon's colour and rounds remain; the first foreign colour stops the
 * burst and is never destroyed.
 *
 * That makes the image's own layering matter: what is behind the front is
 * unreachable from that side until the front is gone, so a cannon may have to
 * come round to another edge — or wait for another colour to be cleared —
 * before it has a shot. Nothing is ever destroyed off the lane: no aggregate
 * command, no random pick by colour. `destroyRandomOfColor` has no business in
 * live combat; it stays for the offline catch-up, where nobody is watching.
 *
 * A round is only spent on a block that actually dies, so a stock of forty is
 * forty blocks.
 */
export class CombatSimulator {
  readonly lod: VisualLODController;

  /** Impacts to draw this frame. Consumed by the renderer. */
  readonly visibleImpacts: ImpactEvent[] = [];
  /** Bursts resolved this frame, for the tracer and the future effects. */
  readonly bursts: BurstEvent[] = [];
  /** Shapes the specialisations left this frame, for the renderer to trace. */
  readonly effectMarks: Array<{ mark: EffectMark; colorId: number }> = [];

  private readonly cannons: ActiveCannon[] = [];
  private readonly options: Required<CombatOptions>;
  private finale = false;

  /**
   * When the reachability of the palette was last read, and what it said.
   *
   * `reachableColors()` is four thousand surface lookups at worst and usually
   * far fewer, but it answers a question that changes slowly — a colour does not
   * surface and bury itself between two frames — so once a second is plenty and
   * sixty times a second would be waste.
   */
  private reachable: boolean[] | null = null;
  private reachableAtMs = -Infinity;

  private stats: CombatStats = {
    activeCannons: 0,
    lanesExamined: 0,
    bursts: 0,
    effects: 0,
    destroyed: 0,
  };

  constructor(
    private readonly world: PixelWorld,
    private readonly queue: CannonQueue,
    private readonly reserve: ColorAmmoReserve,
    options: CombatOptions = {},
    lod = new VisualLODController(),
  ) {
    this.lod = lod;
    this.options = {
      maxActiveCannons: options.maxActiveCannons ?? MAX_ACTIVE_CANNONS,
      moveSpeed: options.moveSpeed ?? CANNON_MOVE_SPEED,
      effects: options.effects ?? NO_EFFECTS,
      doubleBiteChance: options.doubleBiteChance ?? 0,
      twinChance: options.twinChance ?? 0,
      rng: options.rng ?? new XorShift32(0x5eed_1234),
      biteDepth: options.biteDepth ?? BITE_DEPTH,
      blastRadius: options.blastRadius ?? 0,
    };
  }

  /**
   * Which colours a cannon could hit right now, as of the last time it was
   * read — about once a second. Null before the first frame.
   */
  get reachableColors(): readonly boolean[] | null {
    return this.reachable;
  }

  get activeCannons(): readonly ActiveCannon[] {
    return this.cannons;
  }

  setMaxActiveCannons(count: number): void {
    this.options.maxActiveCannons = Math.max(1, Math.round(count));
  }

  /**
   * Widens what a single ball takes out. Zero — the base game — is the strict
   * "one ball, one block" rule; above that the blast still only touches the
   * cannon's own colour, or the per-colour economy would collapse.
   */
  setBlastRadius(radius: number): void {
    this.options.blastRadius = Math.max(0, Math.round(radius));
  }

  /** Pushes the bought specialisations onto the rail. */
  setEffects(effects: EffectLoadout): void {
    this.options.effects = effects;
  }

  /** The two chance-based axes: a second bite, and a second cannon. */
  setChances(doubleBite: number, twin: number): void {
    this.options.doubleBiteChance = Math.max(0, Math.min(1, doubleBite));
    this.options.twinChance = Math.max(0, Math.min(1, twin));
  }

  /**
   * Sets the rail speed, now and for every cannon launched afterwards.
   *
   * Tuning only what is already travelling was a real bug: a bought speed
   * level reached the cannons on the rail and then every replacement spawned
   * back at the base speed, so the upgrade silently faded as the rail turned
   * over. The speed belongs to the rail, not to the cannons on it.
   */
  tuneCannons(moveSpeed: number): void {
    this.options.moveSpeed = moveSpeed;
    for (const cannon of this.cannons) {
      if (!cannon.unlimited) cannon.tune(moveSpeed);
    }
  }

  get hasFreeSlot(): boolean {
    if (this.finale) return false;
    return this.cannons.length < this.options.maxActiveCannons;
  }

  /** True once the level took over and is finishing itself. */
  get isFinale(): boolean {
    return this.finale;
  }

  /**
   * Hands the end of the level to the game.
   *
   * One cannon per colour still standing, no stock, no lap timeout, at a rail
   * speed no upgrade reaches. What they do is what every cannon does — cross
   * lanes and peel the ones whose surface matches — so nothing is ever deleted
   * off a lane, and `destroyRandomOfColor` stays out of live combat. Only the
   * ammunition economy is dropped, because at this point there is none left to
   * respect.
   *
   * The cannons already on the rail leave and give their rounds back first, so
   * the reserve ends the level balanced.
   */
  startFinale(): void {
    if (this.finale) return;
    this.finale = true;

    for (const cannon of this.cannons) {
      this.reserve.releaseFromActive(cannon.colorId, cannon.ammo);
    }
    this.cannons.length = 0;

    const colors: number[] = [];
    for (let colour = 0; colour < this.world.paletteSize; colour++) {
      if (this.world.aliveByColor(colour) > 0) colors.push(colour);
    }

    const spacing = PERIMETER / Math.max(1, colors.length);
    colors.forEach((colorId, i) => {
      const cannon = new ActiveCannon(
        { id: `finale-${colorId}`, colorId, ammo: 0 },
        (i * spacing) % PERIMETER,
        { moveSpeed: FINALE_MOVE_SPEED },
        true,
      );
      this.cannons.push(cannon);
    });
  }

  get maxActiveCannons(): number {
    return this.options.maxActiveCannons;
  }

  getStats(): CombatStats {
    return { ...this.stats, activeCannons: this.cannons.length };
  }

  private resetFrameStats(): void {
    this.stats.lanesExamined = 0;
    this.stats.bursts = 0;
    this.stats.effects = 0;
    this.stats.destroyed = 0;
    this.visibleImpacts.length = 0;
    this.bursts.length = 0;
    this.effectMarks.length = 0;
  }

  /**
   * Spends a queued load: it leaves the queue and joins the rail. Returns null
   * when the rail is full or the id is stale.
   */
  launch(loadId: string): ActiveCannon | null {
    if (!this.hasFreeSlot) return null;

    const load = this.queue.take(loadId);
    if (!load) return null;

    // Jumeau: the load leaves as two cannons carrying half its stock each.
    // Splitting rather than duplicating is what keeps the ledger honest — the
    // rounds were already promoted to the rail when the tile was taken, and
    // inventing a second full stock would put a colour above its own pixels.
    // What it buys is coverage: two positions on the rail for one tile.
    const twin =
      this.options.twinChance > 0 &&
      load.ammo >= 2 &&
      this.cannons.length + 2 <= this.options.maxActiveCannons &&
      this.options.rng.nextFloat() < this.options.twinChance;

    if (twin) {
      const half = Math.floor(load.ammo / 2);
      const first = this.spawn({ ...load, ammo: load.ammo - half });
      this.spawn({ ...load, id: `${load.id}-b`, ammo: half });
      return first;
    }

    return this.spawn(load);
  }

  /** Puts one cannon on the rail, opposite the busiest stretch of it. */
  private spawn(load: CannonLoad): ActiveCannon {
    const cannon = new ActiveCannon(load, this.nextEntryPosition(), {
      moveSpeed: this.options.moveSpeed,
    });
    this.cannons.push(cannon);
    return cannon;
  }

  /**
   * Restores cannons from a save without touching the queue.
   *
   * The reserve accounting for these rounds belongs to the caller, which has
   * just rebuilt it from the save — this only puts the cannons back on the rail.
   */
  restoreCannons(cannons: ActiveCannon[]): void {
    this.cannons.length = 0;
    for (const cannon of cannons) this.cannons.push(cannon);
  }

  update(deltaMs: number, nowMs: number): void {
    this.resetFrameStats();
    this.lod.beginFrame(nowMs);

    this.retireExhaustedColors();

    for (const cannon of this.cannons) {
      const travelled = cannon.update(deltaMs);
      this.workLanes(cannon, travelled);
    }

    this.removeFinishedCannons();

    // Settle the ledger before the frame ends rather than at the start of the
    // next one: a colour whose last pixel just died still had rounds promised
    // to queued loads, and leaving them there would break
    // `queued + active <= alive` for a frame.
    this.queue.dropExhausted();

    // What the queue is allowed to offer depends on what a cannon could
    // actually hit, and the answer only matters near the end of a toile — but
    // that is exactly where the game used to strand the player. See
    // `CannonQueue.recycleUnreachable`.
    if (nowMs - this.reachableAtMs >= REACHABILITY_INTERVAL_MS) {
      this.reachableAtMs = nowMs;
      this.reachable = this.world.reachableColors();
      this.queue.setReachable(this.reachable);
      this.queue.recycleStale(this.reachable);
    }

    // A cannon that leaves the rail with rounds unspent gives them back to its
    // colour, and nothing else in the game refills the queue: `take()` needs a
    // tile to click and `dropExhausted()` only refills when it dropped
    // something. Empty the queue while the rail holds everything, let one
    // cannon give up, and the offer never came back — pixels left, no tiles,
    // no way to play. The queue is cheap to top up when it is already full, so
    // it is topped up every frame rather than at each place that frees rounds.
    this.queue.refill();
  }

  /**
   * A colour running out ends its cannons on the spot, before they get to work
   * this frame. No prismatic conversion: a cannon with nothing left to shoot at
   * simply leaves. Its queued loads are cleared at the end of the frame, once
   * everything that could kill a colour has run.
   */
  private retireExhaustedColors(): void {
    for (const cannon of this.cannons) {
      if (!cannon.isRetired && this.world.aliveByColor(cannon.colorId) === 0) {
        cannon.retire();
      }
    }
  }

  /**
   * Walks every lane the cannon crossed and peels the ones that match.
   *
   * This is where the rail became the clock. Sampling only the lane a cannon
   * landed on wasted everything it flew over, and the faster it went the more
   * it wasted — so speed bought no throughput at all. Now the work a cannon
   * does is exactly the distance it covered.
   */
  private workLanes(cannon: ActiveCannon, travelled: number): void {
    // `isFinished` rather than `ammo === 0`: a finale cannon carries no stock
    // at all, and reading the stock directly would park it on the rail doing
    // nothing.
    if (cannon.isFinished()) return;

    // Enumerating from the position before the move keeps the lanes tiled
    // exactly: no lane covered twice, none skipped, whatever the frame rate.
    const from = cannon.trackPosition - travelled;

    for (const aim of crossedLanes(from, travelled)) {
      this.stats.lanesExamined++;

      const burst = resolveLaneBurst(this.world, cannon, aim, this.options.biteDepth);

      if (burst.destroyed > 0) {
        this.settle(cannon, burst.destroyed);
        this.stats.bursts++;
        this.stats.destroyed += burst.destroyed;

        // Salve: the same crossing bites again. It spends a round like any
        // other block, so the ledger does not move — what it buys is a second
        // cell out of one pass, not free ammunition.
        if (
          this.options.doubleBiteChance > 0 &&
          !cannon.isFinished() &&
          this.options.rng.nextFloat() < this.options.doubleBiteChance
        ) {
          const again = resolveLaneBurst(this.world, cannon, aim, this.options.biteDepth);
          if (again.destroyed > 0) {
            this.settle(cannon, again.destroyed);
            this.stats.destroyed += again.destroyed;
            burst.destroyed += again.destroyed;
            burst.lastIndex = again.lastIndex;
          }
        }
      }

      // The specialisations run on every crossing, not only the productive
      // ones: Perce exists precisely to get through a lane the bite found
      // blocked. Every block they add still costs a round — see
      // `SpecialEffects` for why the ledger cannot be bypassed.
      const extra = resolveEffects(
        this.world,
        cannon.colorId,
        aim,
        burst.lastIndex,
        this.options.effects,
        this.options.rng,
        cannon.unlimited ? Number.MAX_SAFE_INTEGER : cannon.ammo,
      );
      if (extra.destroyed > 0) {
        this.settle(cannon, extra.destroyed);
        this.stats.destroyed += extra.destroyed;
        this.stats.effects++;
        burst.destroyed += extra.destroyed;
        if (burst.firstIndex < 0) burst.firstIndex = extra.touched[0] ?? -1;
        this.sampleEffect(extra.touched, cannon.colorId);
        for (const mark of extra.marks) {
          this.effectMarks.push({ mark, colorId: cannon.colorId });
        }
      }

      if (burst.destroyed === 0) continue;

      if (burst.lastIndex >= 0) {
        const x = burst.lastIndex % WORLD_WIDTH;
        const y = (burst.lastIndex / WORLD_WIDTH) | 0;
        this.stats.destroyed += this.blast(x, y, cannon.colorId);
      }

      this.bursts.push(burst);
      this.sampleImpacts(burst);

      if (cannon.isFinished()) return;
    }
  }

  /** Charges a cannon for what it removed, and squares the ledger. */
  private settle(cannon: ActiveCannon, destroyed: number): void {
    cannon.onBurst(destroyed);
    // A finale cannon was never in the ledger, so it has nothing to give back.
    if (!cannon.unlimited) this.reserve.releaseFromActive(cannon.colorId, destroyed);
  }

  /** Sparks for what an effect took, within the same visual budget. */
  private sampleEffect(touched: readonly number[], colorId: number): void {
    const granted = this.lod.sample(touched.length);
    for (let i = 0; i < granted && i < touched.length; i++) {
      const index = touched[i];
      this.visibleImpacts.push({
        x: index % WORLD_WIDTH,
        y: (index / WORLD_WIDTH) | 0,
        colorId,
      });
    }
  }

  /**
   * Picks the impacts worth drawing. The graphics budget must never hold back
   * the logic: a burst of two hundred blocks is already resolved by the time
   * this decides how many sparks it deserves.
   */
  private sampleImpacts(burst: BurstEvent): void {
    const granted = this.lod.sample(burst.destroyed);
    if (granted <= 0 || burst.firstIndex < 0) return;

    const span = burst.destroyed;
    for (let i = 0; i < granted; i++) {
      // Spread the sparks over the peeled run rather than stacking them.
      const step = span === 1 ? 0 : Math.round((i * (span - 1)) / Math.max(1, granted - 1));
      const offset = burst.direction > 0 ? step : -step;
      const index =
        burst.axis === "row"
          ? burst.firstIndex + offset
          : burst.firstIndex + offset * WORLD_WIDTH;

      this.visibleImpacts.push({
        x: index % WORLD_WIDTH,
        y: (index / WORLD_WIDTH) | 0,
        colorId: burst.colorId,
      });
    }
  }

  /**
   * Destroys cells of the same colour around the end of a burst.
   *
   * A span-filled disc bounded by the radius: at radius 0 — the base game —
   * this does nothing at all. Foreign colours inside the blast are never
   * touched, or the per-colour economy would collapse.
   */
  private blast(cx: number, cy: number, colorId: number): number {
    const radius = this.options.blastRadius;
    if (radius <= 0) return 0;

    const r2 = radius * radius;
    let destroyed = 0;

    const yMin = Math.max(0, cy - radius);
    const yMax = Math.min(WORLD_HEIGHT - 1, cy + radius);

    for (let y = yMin; y <= yMax; y++) {
      const dy = y - cy;
      const half = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
      const xMin = Math.max(0, cx - half);
      const xMax = Math.min(WORLD_WIDTH - 1, cx + half);

      for (let x = xMin; x <= xMax; x++) {
        const index = y * WORLD_WIDTH + x;
        if (this.world.colorId[index] !== colorId) continue;
        if (this.world.destroy(index)) destroyed++;
      }
    }

    return destroyed;
  }



  private removeFinishedCannons(): void {
    for (let i = this.cannons.length - 1; i >= 0; i--) {
      const cannon = this.cannons[i];
      if (!cannon.isFinished()) continue;
      // Rounds it never got to spend go back to the colour's reserve.
      if (!cannon.unlimited) this.reserve.releaseFromActive(cannon.colorId, cannon.ammo);
      this.cannons.splice(i, 1);
    }
  }

  /** Spreads new arrivals around the rail instead of stacking them. */
  private nextEntryPosition(): number {
    if (this.cannons.length === 0) return 0;
    const spacing = (WORLD_WIDTH + WORLD_HEIGHT) * 2 / this.options.maxActiveCannons;
    return (this.cannons[this.cannons.length - 1].trackPosition + spacing) % ((WORLD_WIDTH + WORLD_HEIGHT) * 2);
  }
}

export type { CannonLoad };
