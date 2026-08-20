/**
 * Fixed-capacity projectile pool.
 *
 * The hot path must not allocate: projectiles are recycled through a free
 * list, and iteration walks a dense `activeIds` array rather than the whole
 * capacity.
 */
export interface Projectile {
  id: number;
  active: boolean;

  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;

  colorId: number;
  damage: number;

  remainingPierces: number;
  remainingBounces: number;

  ageMs: number;
  maxAgeMs: number;
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
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
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
  spawn(init: Omit<Projectile, "id" | "active" | "ageMs">): Projectile | null {
    const id = this.free.pop();
    if (id === undefined) return null;

    const p = this.items[id];
    p.active = true;
    p.x = init.x;
    p.y = init.y;
    p.vx = init.vx;
    p.vy = init.vy;
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
