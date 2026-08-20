import type { Axis, Direction } from "./axisTraversal";

/**
 * Fixed-capacity projectile pool.
 *
 * A ball is confined to one lane, so its whole trajectory is a lane index, a
 * direction and a scalar position along the axis — no velocity vector, no
 * position vector, nothing to normalise. The hot path never allocates:
 * projectiles are recycled through a free list and iteration walks a dense
 * `active` array rather than the whole capacity.
 */
export interface Projectile {
  id: number;
  active: boolean;

  axis: Axis;
  /** Row index when travelling along a row, column index along a column. */
  lane: number;
  direction: Direction;
  /** Position along the axis, in cells. Fractional between two cells. */
  along: number;
  /** Travel speed, in cells per second. */
  speed: number;

  colorId: number;
  damage: number;

  remainingPierces: number;
  remainingBounces: number;

  ageMs: number;
  maxAgeMs: number;
}

export type ProjectileInit = Omit<Projectile, "id" | "active" | "ageMs">;

/** Board-space position of a ball, for rendering only. */
export function projectileX(projectile: Projectile): number {
  return projectile.axis === "row" ? projectile.along : projectile.lane + 0.5;
}

export function projectileY(projectile: Projectile): number {
  return projectile.axis === "row" ? projectile.lane + 0.5 : projectile.along;
}

export class ProjectilePool {
  readonly capacity: number;
  private readonly items: Projectile[];
  private readonly free: number[] = [];
  private readonly active: number[] = [];

  constructor(capacity = 2048) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) {
      this.items[i] = {
        id: i,
        active: false,
        axis: "row",
        lane: 0,
        direction: 1,
        along: 0,
        speed: 0,
        colorId: 0,
        damage: 1,
        remainingPierces: 0,
        remainingBounces: 0,
        ageMs: 0,
        maxAgeMs: 0,
      };
      this.free.push(i);
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** Returns null when the pool is saturated — the caller then batches instead. */
  spawn(init: ProjectileInit): Projectile | null {
    const id = this.free.pop();
    if (id === undefined) return null;

    const p = this.items[id];
    p.active = true;
    p.axis = init.axis;
    p.lane = init.lane;
    p.direction = init.direction;
    p.along = init.along;
    p.speed = init.speed;
    p.colorId = init.colorId;
    p.damage = init.damage;
    p.remainingPierces = init.remainingPierces;
    p.remainingBounces = init.remainingBounces;
    p.ageMs = 0;
    p.maxAgeMs = init.maxAgeMs;

    this.active.push(id);
    return p;
  }

  release(projectile: Projectile): void {
    if (!projectile.active) return;
    projectile.active = false;
    const at = this.active.indexOf(projectile.id);
    if (at >= 0) {
      this.active[at] = this.active[this.active.length - 1];
      this.active.pop();
    }
    this.free.push(projectile.id);
  }

  /** Iterates backwards so a visitor can release the current projectile. */
  forEachActive(visit: (projectile: Projectile) => void): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      visit(this.items[this.active[i]]);
    }
  }

  clear(): void {
    this.forEachActive((p) => this.release(p));
  }
}
