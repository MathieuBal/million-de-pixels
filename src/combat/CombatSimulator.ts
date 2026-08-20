import { DEAD, VOID, WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { DeckRuntime, CardSlot } from "../deck/DeckRuntime";
import type { Rng } from "../rng/XorShift32";
import type { PixelWorld } from "../world/PixelWorld";
import { VisualLODController } from "../rendering/VisualLODController";
import { BatchExecutor } from "./BatchExecutor";
import type { Cannon, CannonAim } from "./Cannon";
import { axisLength, traverseAxis } from "./axisTraversal";
import { ProjectilePool, type Projectile } from "./ProjectilePool";

export interface ImpactEvent {
  x: number;
  y: number;
  colorId: number;
}

export interface CombatStats {
  activeProjectiles: number;
  logicalImpacts: number;
  visualImpacts: number;
  cellsTraversed: number;
  batchedCommands: number;
  destroyed: number;
}

/**
 * What a ball does when it meets a cell of another colour.
 *
 * This is a game design parameter, not a technical constraint. `pass-through`
 * is the MVP default because it is the only one where the core fantasy works
 * on a dense image: with `bounce`, the first foreign pixel absorbs the shot, so
 * a ball can never reach its own colour past the outer rim.
 */
export type ForeignColorPolicy = "pass-through" | "bounce";

export interface CombatOptions {
  /** Width of a volley, in lanes: the balls occupy adjacent parallel lanes. */
  volleyLanes?: number;
  /** Above this many balls in one volley, the card goes fully batched. */
  batchThreshold?: number;
  maxProjectileLifetimeMs?: number;
  foreignColorPolicy?: ForeignColorPolicy;
}

/**
 * Drives the active (foreground) part of the game.
 *
 * The cannon patrols the border and fires perpendicular to its edge, so every
 * shot stays inside a single row or column. Two regimes coexist deliberately:
 *   - exact: one logical shot is one simulated projectile scanning its lane;
 *   - aggregate: the volley is converted straight into destruction commands,
 *     with only a sampled handful of impacts turned into visual effects.
 *
 * Switching between the two is what lets upgrades keep scaling past the point
 * where the renderer could draw every ball.
 */
export class CombatSimulator {
  readonly pool: ProjectilePool;
  readonly lod: VisualLODController;
  private readonly batch: BatchExecutor;
  private readonly options: Required<CombatOptions>;

  /** Impacts selected for display this frame. Consumed by the renderer. */
  readonly visibleImpacts: ImpactEvent[] = [];

  private stats: CombatStats = {
    activeProjectiles: 0,
    logicalImpacts: 0,
    visualImpacts: 0,
    cellsTraversed: 0,
    batchedCommands: 0,
    destroyed: 0,
  };

  constructor(
    private readonly world: PixelWorld,
    private readonly deck: DeckRuntime,
    private readonly cannon: Cannon,
    private readonly rng: Rng,
    options: CombatOptions = {},
    lod = new VisualLODController(),
  ) {
    this.pool = new ProjectilePool(2048);
    this.lod = lod;
    this.batch = new BatchExecutor(world);
    this.options = {
      volleyLanes: options.volleyLanes ?? 1,
      batchThreshold: options.batchThreshold ?? 24,
      maxProjectileLifetimeMs: options.maxProjectileLifetimeMs ?? 4000,
      foreignColorPolicy: options.foreignColorPolicy ?? "pass-through",
    };
  }

  getStats(): CombatStats {
    return { ...this.stats, activeProjectiles: this.pool.activeCount };
  }

  resetFrameStats(): void {
    this.stats.logicalImpacts = 0;
    this.stats.visualImpacts = 0;
    this.stats.cellsTraversed = 0;
    this.stats.batchedCommands = 0;
    this.stats.destroyed = 0;
    this.visibleImpacts.length = 0;
  }

  update(deltaMs: number, nowMs: number): void {
    this.resetFrameStats();
    this.lod.beginFrame(nowMs);

    this.cannon.update(deltaMs / 1000);
    this.deck.syncExhaustedColors(this.world);

    for (const slot of this.deck.tick(deltaMs)) {
      // An armed card holds its shot until the cannon faces a lane that still
      // contains its colour, so no volley is ever spent on an empty lane.
      if (this.fire(slot)) this.deck.markFired(slot);
    }

    this.stepProjectiles(deltaMs);
  }

  /** Returns true when the volley was actually fired. */
  private fire(slot: CardSlot): boolean {
    const card = slot.card;
    const target = this.deck.resolveTarget(card, this.world);
    if (target < 0) return false; // board cleared

    const aim = this.cannon.aim();
    if (!this.laneHasTarget(aim, card.ballCount, target)) return false;

    const aggregate =
      card.ballCount > this.options.batchThreshold ||
      card.logicalBurst > 0 ||
      !this.lod.canSimulateExactly(this.pool.activeCount);

    if (aggregate) {
      this.fireAggregate(card.ballCount * card.pierce + card.logicalBurst, target, card.damage);
      return true;
    }

    const size = axisLength(aim.axis, WORLD_WIDTH, WORLD_HEIGHT);
    // Balls enter at the edge the cannon is standing on: there is no flight
    // through empty space outside the board to simulate.
    const entry = aim.direction > 0 ? 0 : size - 1;
    const spread = Math.max(1, this.options.volleyLanes);

    for (let i = 0; i < card.ballCount; i++) {
      // Spread the volley over adjacent lanes, centred on the cannon's own.
      const laneOffset = spread === 1 ? 0 : (i % spread) - ((spread - 1) >> 1);
      const shot = this.cannon.aimOffset(laneOffset);

      const spawned = this.pool.spawn({
        axis: shot.axis,
        lane: shot.lane,
        direction: shot.direction,
        along: entry,
        speed: card.speed,
        colorId: target,
        damage: card.damage,
        remainingPierces: card.pierce,
        remainingBounces: card.ricochet,
        maxAgeMs: this.options.maxProjectileLifetimeMs,
      });

      // Pool saturated: the rest of the volley still counts, it just goes
      // through the batch path instead of being dropped.
      if (!spawned) {
        this.fireAggregate((card.ballCount - i) * card.pierce, target, card.damage);
        return true;
      }
    }

    return true;
  }

  /**
   * True when at least one lane covered by the volley still holds `colorId`.
   * One lookup per lane in the lane index — no scanning of the board.
   */
  private laneHasTarget(aim: CannonAim, ballCount: number, colorId: number): boolean {
    const spread = Math.min(Math.max(1, this.options.volleyLanes), ballCount);
    const half = (spread - 1) >> 1;

    for (let offset = -half; offset <= spread - 1 - half; offset++) {
      const shot = offset === 0 ? aim : this.cannon.aimOffset(offset);
      if (this.world.lanes.hasColor(shot.axis, shot.lane, colorId)) return true;
    }
    return false;
  }

  /** Converts logical hits straight into destruction, bypassing the grid walk. */
  private fireAggregate(logicalHits: number, colorId: number, damage: number): void {
    const amount = Math.max(0, Math.floor(logicalHits * damage));
    if (amount === 0) return;

    const destroyed = this.batch.execute({ kind: "color", colorId, amount }, this.rng);

    this.stats.batchedCommands++;
    this.stats.logicalImpacts += amount;
    this.stats.destroyed += destroyed;

    const vfx = this.lod.sample(destroyed);
    for (let i = 0; i < vfx; i++) {
      // Representative sparks: pick surviving neighbours of the same colour so
      // the effect appears where that colour actually lives.
      const pixel = this.world.colorIndex.randomAlive(colorId, this.rng);
      if (pixel < 0) break;
      this.visibleImpacts.push({
        x: pixel % WORLD_WIDTH,
        y: (pixel / WORLD_WIDTH) | 0,
        colorId,
      });
      // Counted one by one: `visibleImpacts` accumulates across every card
      // firing this frame, so its length is not this call's contribution.
      this.stats.visualImpacts++;
    }
  }

  private stepProjectiles(deltaMs: number): void {
    const deltaSeconds = deltaMs / 1000;
    const world = this.world;

    this.pool.forEachActive((projectile) => {
      projectile.ageMs += deltaMs;
      if (projectile.ageMs > projectile.maxAgeMs) {
        this.pool.release(projectile);
        return;
      }

      const travel = projectile.speed * deltaSeconds;
      const from = projectile.along;
      const to = from + projectile.direction * travel;
      projectile.along = to;

      const size = axisLength(projectile.axis, WORLD_WIDTH, WORLD_HEIGHT);
      if (projectile.direction > 0 ? from > size - 1 : from < 0) {
        // Ran off the far edge: the lane is finished.
        this.pool.release(projectile);
        return;
      }

      let absorbed = false;

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
          const outcome = this.resolveCellHit(projectile, index);

          if (outcome === "continue") return false;

          if (outcome === "hit") {
            this.stats.logicalImpacts++;
            if (world.damage(index, projectile.damage)) {
              this.stats.destroyed++;
              if (this.lod.sample(1) > 0) {
                this.visibleImpacts.push({ x: cx, y: cy, colorId: projectile.colorId });
                this.stats.visualImpacts++;
              }
            }
            projectile.remainingPierces--;
            if (projectile.remainingPierces > 0) return false;
            absorbed = true;
            return true;
          }

          // outcome === "bounce": a wrong colour sends the ball back down its
          // own lane, since that is the only direction it can travel.
          if (projectile.remainingBounces > 0) {
            projectile.remainingBounces--;
            projectile.direction = projectile.direction > 0 ? -1 : 1;
            projectile.along = (projectile.axis === "row" ? cx : cy) + projectile.direction * 0.51;
            return true;
          }
          absorbed = true;
          return true;
        },
      );

      if (absorbed) this.pool.release(projectile);
    });
  }

  private resolveCellHit(
    projectile: Projectile,
    pixelIndex: number,
  ): "continue" | "hit" | "bounce" {
    const cell = this.world.colorId[pixelIndex];
    if (cell === DEAD || cell === VOID) return "continue";
    if (cell === projectile.colorId) return "hit";
    return this.options.foreignColorPolicy === "bounce" ? "bounce" : "continue";
  }
}
