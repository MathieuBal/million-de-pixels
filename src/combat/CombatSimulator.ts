import { ActiveCannon } from "../cannon/ActiveCannon";
import type { CannonLoad } from "../cannon/CannonLoad";
import type { CannonQueue } from "../cannon/CannonQueue";
import type { ColorAmmoReserve } from "../cannon/ColorAmmoReserve";
import { DEAD, VOID, WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { PixelWorld } from "../world/PixelWorld";
import { VisualLODController } from "../rendering/VisualLODController";
import { axisLength, traverseAxis } from "./axisTraversal";
import { ProjectilePool, type Projectile } from "./ProjectilePool";

export interface ImpactEvent {
  x: number;
  y: number;
  colorId: number;
}

export interface CombatStats {
  activeCannons: number;
  activeProjectiles: number;
  shotsFired: number;
  destroyed: number;
  cellsTraversed: number;
  /** Shots stopped by another colour, or that ran off the far edge. */
  misses: number;
}

export interface CombatOptions {
  maxActiveCannons?: number;
  /** Ball speed in cells per second. */
  projectileSpeed?: number;
}

/** Opening value, to test rather than to treat as balance. */
export const MAX_ACTIVE_CANNONS = 5;
const PROJECTILE_SPEED = 1400;

/**
 * Drives the cannons currently on the rail.
 *
 * The rule the whole design rests on: **one ball destroys at most one block**.
 * A ball travels its lane and stops at the first solid cell it meets, whatever
 * its colour. If that cell is the cannon's colour it dies; otherwise the shot
 * is blocked and nothing happens. Holes left by earlier hits, and the
 * transparent margins, are the only things a ball passes through.
 *
 * That makes the image's own layering matter: what is behind the front is
 * unreachable from that side until the front is gone, so a cannon may have to
 * come round to another edge — or wait for another colour to be cleared —
 * before it has a shot. Nothing is ever destroyed off the ball's trajectory:
 * no aggregate command, no random pick by colour. `destroyRandomOfColor` has
 * no business in live combat; it stays for the offline catch-up, where nobody
 * is watching the shots.
 *
 * A round is only spent on a hit, and a cannon only fires when the cell facing
 * it is its own colour, so a stock of forty is forty blocks.
 */
export class CombatSimulator {
  readonly pool = new ProjectilePool(512);
  readonly lod: VisualLODController;

  /** Impacts to draw this frame. Consumed by the renderer. */
  readonly visibleImpacts: ImpactEvent[] = [];

  private readonly cannons: ActiveCannon[] = [];
  private readonly options: Required<CombatOptions>;

  private stats: CombatStats = {
    activeCannons: 0,
    activeProjectiles: 0,
    shotsFired: 0,
    destroyed: 0,
    cellsTraversed: 0,
    misses: 0,
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
      projectileSpeed: options.projectileSpeed ?? PROJECTILE_SPEED,
    };
  }

  get activeCannons(): readonly ActiveCannon[] {
    return this.cannons;
  }

  get hasFreeSlot(): boolean {
    return this.cannons.length < this.options.maxActiveCannons;
  }

  /**
   * Shots per second aimed at each colour by the rail as it stands.
   *
   * This is what replaces the old deck-wide DPS: effort is now whatever the
   * player chose to send in, so the column that shows it beside the pixels
   * remaining is a readout of their own decisions.
   */
  shotsPerSecondByColor(paletteSize: number): number[] {
    const rate = new Array<number>(paletteSize).fill(0);
    for (const cannon of this.cannons) {
      if (cannon.colorId >= paletteSize || cannon.isRetired) continue;
      rate[cannon.colorId] += 1000 / Math.max(1, cannon.fireIntervalMs);
    }
    return rate;
  }

  getStats(): CombatStats {
    return {
      ...this.stats,
      activeCannons: this.cannons.length,
      activeProjectiles: this.pool.activeCount,
    };
  }

  private resetFrameStats(): void {
    this.stats.shotsFired = 0;
    this.stats.destroyed = 0;
    this.stats.cellsTraversed = 0;
    this.stats.misses = 0;
    this.visibleImpacts.length = 0;
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

  /** Restores cannons from a save without touching the queue. */
  restoreCannons(cannons: ActiveCannon[]): void {
    this.cannons.length = 0;
    for (const cannon of cannons) {
      this.reserve.promoteToActive(cannon.colorId, 0);
      this.cannons.push(cannon);
    }
  }

  update(deltaMs: number, nowMs: number): void {
    this.resetFrameStats();
    this.lod.beginFrame(nowMs);

    this.retireExhaustedColors();

    for (const cannon of this.cannons) {
      cannon.update(deltaMs);
      this.maybeFire(cannon);
    }

    this.stepProjectiles(deltaMs);
    this.removeFinishedCannons();
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
   * Fires at most one ball, and only when the cell facing the cannon is its own
   * colour.
   *
   * Since a ball stops at the first solid cell, having the colour somewhere
   * down the lane is not enough — it has to be the one exposed. The surface
   * index answers that in one read, so a cannon whose colour is buried simply
   * holds its fire and keeps travelling rather than throwing balls at a wall.
   */
  private maybeFire(cannon: ActiveCannon): void {
    if (!cannon.canFire()) return;

    const aim = cannon.aim();
    const front = this.world.surface.frontIndex(aim.axis, aim.lane, aim.direction);
    if (front < 0 || this.world.colorId[front] !== cannon.colorId) return;

    const size = axisLength(aim.axis, WORLD_WIDTH, WORLD_HEIGHT);
    const spawned = this.pool.spawn({
      cannonId: cannon.id,
      colorId: cannon.colorId,
      axis: aim.axis,
      lane: aim.lane,
      direction: aim.direction,
      position: aim.direction > 0 ? 0 : size - 1,
      speed: this.options.projectileSpeed,
    });
    if (!spawned) return; // pool saturated: hold the shot, spend nothing

    cannon.onFired();
    this.stats.shotsFired++;
  }

  private stepProjectiles(deltaMs: number): void {
    const deltaSeconds = deltaMs / 1000;

    this.pool.forEachActive((projectile) => {
      const from = projectile.position;
      const to = from + projectile.direction * projectile.speed * deltaSeconds;
      projectile.position = to;

      const size = axisLength(projectile.axis, WORLD_WIDTH, WORLD_HEIGHT);
      const ranOff = projectile.direction > 0 ? from > size - 1 : from < 0;

      if (ranOff) {
        // Crossed the whole lane without finding its colour: no round spent.
        this.creditMiss(projectile);
        this.pool.release(projectile);
        return;
      }

      let hit = false;
      let blocked = false;

      traverseAxis(
        projectile.axis,
        projectile.lane,
        projectile.direction,
        Math.floor(from),
        Math.floor(to),
        WORLD_WIDTH,
        WORLD_HEIGHT,
        (cx, cy, index) => {
          this.stats.cellsTraversed++;

          // Holes and transparent margins are the only things a ball crosses.
          const cell = this.world.colorId[index];
          if (cell === DEAD || cell === VOID) return false;

          // First solid cell on the path. It either matches and dies, or it
          // stops the shot — the surface is what shields what lies behind.
          if (cell === projectile.colorId && this.world.destroy(index)) {
            this.stats.destroyed++;
            this.creditHit(projectile);
            if (this.lod.sample(1) > 0) {
              this.visibleImpacts.push({ x: cx, y: cy, colorId: projectile.colorId });
            }
            hit = true;
          } else {
            blocked = true;
          }
          return true;
        },
      );

      if (hit) {
        this.pool.release(projectile);
      } else if (blocked) {
        // Another ball reached this cell first and exposed a colour that is not
        // ours. No round is spent on a blocked shot.
        this.creditMiss(projectile);
        this.pool.release(projectile);
      }
    });
  }

  private creditHit(projectile: Projectile): void {
    const cannon = this.cannons.find((c) => c.id === projectile.cannonId);
    if (!cannon) return;
    cannon.onHit();
    this.reserve.releaseFromActive(cannon.colorId, 1);
  }

  private creditMiss(projectile: Projectile): void {
    this.stats.misses++;
    this.cannons.find((c) => c.id === projectile.cannonId)?.onMiss();
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
