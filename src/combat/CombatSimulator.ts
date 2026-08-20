import { DEAD, VOID, WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { DeckRuntime, CardSlot } from "../deck/DeckRuntime";
import type { Rng } from "../rng/XorShift32";
import type { PixelWorld } from "../world/PixelWorld";
import { VisualLODController } from "../rendering/VisualLODController";
import { BatchExecutor } from "./BatchExecutor";
import type { Cannon } from "./Cannon";
import { clipSegmentToGrid } from "./clip";
import { traverseGridDDA } from "./dda";
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
  /** Spread of a volley around the aim direction, in radians. */
  volleySpread?: number;
  /** Above this many balls in one volley, the card goes fully batched. */
  batchThreshold?: number;
  maxProjectileLifetimeMs?: number;
  foreignColorPolicy?: ForeignColorPolicy;
}

/**
 * Drives the active (foreground) part of the game.
 *
 * Two regimes coexist deliberately:
 *   - exact: one logical shot is one simulated projectile walking the grid;
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
      volleySpread: options.volleySpread ?? 0.22,
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
      this.fire(slot);
    }

    this.stepProjectiles(deltaMs);
  }

  private fire(slot: CardSlot): void {
    const card = slot.card;
    const target = this.deck.resolveTarget(card, this.world);
    if (target < 0) return; // board cleared

    const aggregate =
      card.ballCount > this.options.batchThreshold ||
      card.logicalBurst > 0 ||
      !this.lod.canSimulateExactly(this.pool.activeCount);

    if (aggregate) {
      this.fireAggregate(card.ballCount * card.pierce + card.logicalBurst, target, card.damage);
      return;
    }

    const origin = { x: this.cannon.x, y: this.cannon.y };
    const aim = this.cannon.aim();
    const baseAngle = Math.atan2(aim.y, aim.x);

    for (let i = 0; i < card.ballCount; i++) {
      const offset =
        card.ballCount === 1
          ? 0
          : (i / (card.ballCount - 1) - 0.5) * this.options.volleySpread;
      const angle = baseAngle + offset;

      const spawned = this.pool.spawn({
        x: origin.x,
        y: origin.y,
        vx: Math.cos(angle),
        vy: Math.sin(angle),
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
        return;
      }
    }
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
      const nextX = projectile.x + projectile.vx * travel;
      const nextY = projectile.y + projectile.vy * travel;

      const clipped = clipSegmentToGrid(
        { x0: projectile.x, y0: projectile.y, x1: nextX, y1: nextY },
        WORLD_WIDTH,
        WORLD_HEIGHT,
      );

      projectile.x = nextX;
      projectile.y = nextY;

      if (!clipped) {
        // Never entered the board on this step. Only give up once the ball is
        // heading away from it, so a shot from the orbit still gets to arrive.
        if (this.isLeavingBoard(projectile)) this.pool.release(projectile);
        return;
      }

      let absorbed = false;

      traverseGridDDA(
        clipped.x0,
        clipped.y0,
        clipped.x1,
        clipped.y1,
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

          // outcome === "bounce": a wrong colour deflects the ball.
          if (projectile.remainingBounces > 0) {
            projectile.remainingBounces--;
            this.deflect(projectile, cx, cy);
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

  /**
   * Reflects the ball off the cell it could not destroy. The normal is taken
   * from the dominant travel axis — good enough visually, and it keeps the
   * ball inside the play area instead of grazing along it forever.
   */
  private deflect(projectile: Projectile, cellX: number, cellY: number): void {
    const dx = projectile.x - (cellX + 0.5);
    const dy = projectile.y - (cellY + 0.5);
    if (Math.abs(dx) > Math.abs(dy)) projectile.vx = -projectile.vx;
    else projectile.vy = -projectile.vy;

    // Nudge the ball off the surface so the next step does not re-hit it.
    projectile.x = cellX + 0.5 + Math.sign(projectile.vx) * 0.51;
    projectile.y = cellY + 0.5 + Math.sign(projectile.vy) * 0.51;
  }

  private isLeavingBoard(projectile: Projectile): boolean {
    const towardsCenterX = WORLD_WIDTH / 2 - projectile.x;
    const towardsCenterY = WORLD_HEIGHT / 2 - projectile.y;
    return projectile.vx * towardsCenterX + projectile.vy * towardsCenterY <= 0;
  }
}
