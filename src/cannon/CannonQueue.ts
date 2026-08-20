import type { CannonLoad, CannonLoadGenerator } from "./CannonLoad";
import type { ColorAmmoReserve } from "./ColorAmmoReserve";

/**
 * Slots the player picks from: two rows of four, as laid out in the design.
 * A gameplay value, open to balancing.
 */
export const VISIBLE_LOADS = 8;

/**
 * The visible queue of cannons waiting to be launched.
 *
 * Loads are drawn one at a time, only when a slot opens, so nothing is
 * precomputed and the offer always reflects the pixels still on the board.
 * Taking a load is the player's only decision here — which colour is worth
 * sending in right now.
 */
export class CannonQueue {
  private loads: CannonLoad[] = [];

  constructor(
    private readonly generator: CannonLoadGenerator,
    private readonly reserve: ColorAmmoReserve,
    private readonly size = VISIBLE_LOADS,
  ) {}

  get visible(): readonly CannonLoad[] {
    return this.loads;
  }

  /** Fills empty slots. Stops early when no colour can supply a load. */
  refill(): void {
    while (this.loads.length < this.size) {
      const load = this.generator.next();
      if (!load) return;
      this.loads.push(load);
    }
  }

  /**
   * Removes a load from the queue and moves its rounds onto the rail.
   * Returns null if the id is unknown — a stale click, typically.
   */
  take(loadId: string): CannonLoad | null {
    const index = this.loads.findIndex((load) => load.id === loadId);
    if (index < 0) return null;

    const [load] = this.loads.splice(index, 1);
    this.reserve.promoteToActive(load.colorId, load.ammo);
    this.refill();
    return load;
  }

  /**
   * Drops loads whose colour has run out, and replaces them.
   *
   * A queued red load is dead weight once the last red pixel is gone, and
   * leaving it in the queue would also keep its rounds committed against a
   * colour that no longer exists.
   */
  dropExhausted(): CannonLoad[] {
    const dropped: CannonLoad[] = [];

    this.loads = this.loads.filter((load) => {
      if (this.reserve.alive(load.colorId) > 0) return true;
      this.reserve.releaseFromQueue(load.colorId, load.ammo);
      dropped.push(load);
      return false;
    });

    if (dropped.length > 0) this.refill();
    return dropped;
  }

  /** Restores a persisted queue, re-committing its rounds to the reserve. */
  restore(loads: CannonLoad[]): void {
    this.loads = loads.map((load) => ({
      ...load,
      ammo: this.reserve.reserveForQueue(load.colorId, load.ammo),
    })).filter((load) => load.ammo > 0);
    this.refill();
  }
}
