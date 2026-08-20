import type { Axis, Direction } from "./axisTraversal";

/**
 * Fixed-capacity projectile pool.
 *
 * A ball is one round in flight: a lane, a direction, a position along it, and
 * the cannon that owes it. It destroys at most one block — there is no pierce,
 * no bounce and no burst, because a round is a pixel.
 */
export interface Projectile {
  id: number;
  active: boolean;

  /** Cannon that fired it, so the spent round is charged to the right stock. */
  cannonId: string;

  colorId: number;

  axis: Axis;
  lane: number;
  direction: Direction;
  /** Position along the axis, in cells. Fractional between two cells. */
  position: number;
  /** Travel speed, in cells per second. */
  speed: number;
}

export type ProjectileInit = Omit<Projectile, "id" | "active">;

/** Board-space position of a ball, for rendering only. */
export function projectileX(projectile: Projectile): number {
  return projectile.axis === "row" ? projectile.position : projectile.lane + 0.5;
}

export function projectileY(projectile: Projectile): number {
  return projectile.axis === "row" ? projectile.lane + 0.5 : projectile.position;
}

export class ProjectilePool {
  readonly capacity: number;
  private readonly items: Projectile[];
  private readonly free: number[] = [];
  private readonly active: number[] = [];

  constructor(capacity = 512) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) {
      this.items[i] = {
        id: i,
        active: false,
        cannonId: "",
        colorId: 0,
        axis: "row",
        lane: 0,
        direction: 1,
        position: 0,
        speed: 0,
      };
      this.free.push(i);
    }
  }

  get activeCount(): number {
    return this.active.length;
  }

  spawn(init: ProjectileInit): Projectile | null {
    const id = this.free.pop();
    if (id === undefined) return null;

    const p = this.items[id];
    p.active = true;
    p.cannonId = init.cannonId;
    p.colorId = init.colorId;
    p.axis = init.axis;
    p.lane = init.lane;
    p.direction = init.direction;
    p.position = init.position;
    p.speed = init.speed;

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
