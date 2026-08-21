import { ActiveCannon } from "../cannon/ActiveCannon";
import type { CannonLoad } from "../cannon/CannonLoad";
import type { CannonQueue } from "../cannon/CannonQueue";
import type { ColorAmmoReserve } from "../cannon/ColorAmmoReserve";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { PixelWorld } from "../world/PixelWorld";
import { VisualLODController } from "../rendering/VisualLODController";
import { crossedLanes } from "./Cannon";
import { resolveLaneBurst, type BurstEvent } from "./LineBurst";

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
  destroyed: number;
}

export interface CombatOptions {
  maxActiveCannons?: number;
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

  private readonly cannons: ActiveCannon[] = [];
  private readonly options: Required<CombatOptions>;

  private stats: CombatStats = {
    activeCannons: 0,
    lanesExamined: 0,
    bursts: 0,
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
      blastRadius: options.blastRadius ?? 0,
    };
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

  /** Pushes bought upgrades onto the cannons already travelling. */
  tuneCannons(moveSpeed: number): void {
    for (const cannon of this.cannons) cannon.tune(moveSpeed);
  }

  get hasFreeSlot(): boolean {
    return this.cannons.length < this.options.maxActiveCannons;
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
    this.stats.destroyed = 0;
    this.visibleImpacts.length = 0;
    this.bursts.length = 0;
  }

  /**
   * Spends a queued load: it leaves the queue and joins the rail. Returns null
   * when the rail is full or the id is stale.
   */
  launch(loadId: string): ActiveCannon | null {
    if (!this.hasFreeSlot) return null;

    const load = this.queue.take(loadId);
    if (!load) return null;

    // New cannons enter opposite the busiest stretch of rail, so they spread
    // out instead of stacking on top of each other.
    const cannon = new ActiveCannon(load, this.nextEntryPosition());
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
   * A colour running out ends its cannons on the spot and clears its queued
   * loads. No prismatic conversion: a cannon with nothing left to shoot at
   * simply leaves.
   */
  private retireExhaustedColors(): void {
    for (const cannon of this.cannons) {
      if (!cannon.isRetired && this.world.aliveByColor(cannon.colorId) === 0) {
        cannon.retire();
      }
    }
    this.queue.dropExhausted();
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
    if (cannon.isRetired || cannon.ammo === 0) return;

    // Enumerating from the position before the move keeps the lanes tiled
    // exactly: no lane covered twice, none skipped, whatever the frame rate.
    const from = cannon.trackPosition - travelled;

    for (const aim of crossedLanes(from, travelled)) {
      this.stats.lanesExamined++;

      const burst = resolveLaneBurst(this.world, cannon, aim);
      if (burst.destroyed === 0) continue;

      cannon.onBurst(burst.destroyed);
      this.reserve.releaseFromActive(cannon.colorId, burst.destroyed);

      this.stats.bursts++;
      this.stats.destroyed += burst.destroyed;

      if (burst.lastIndex >= 0) {
        const x = burst.lastIndex % WORLD_WIDTH;
        const y = (burst.lastIndex / WORLD_WIDTH) | 0;
        this.stats.destroyed += this.blast(x, y, cannon.colorId);
      }

      this.bursts.push(burst);
      this.sampleImpacts(burst);

      if (cannon.ammo === 0) return;
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
      this.reserve.releaseFromActive(cannon.colorId, cannon.ammo);
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
