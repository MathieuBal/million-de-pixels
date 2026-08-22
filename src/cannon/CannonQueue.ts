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
  /**
   * Fixed slots, not a list.
   *
   * Taking a load used to splice it out, so every offer to its right shifted
   * one place left and the gap was filled from the generator. Tap a tile, and
   * by the time the finger comes down again the slot holds a different colour —
   * which is exactly what a player spamming the queue reported: tiles that do
   * nothing, tiles that send the wrong colour, and gaps near the end of a run
   * where the generator has nothing left to shift in. A slot is a place on
   * screen; it keeps its identity and is refilled where it stands.
   */
  private slots: (CannonLoad | null)[] = [];

  constructor(
    private readonly generator: CannonLoadGenerator,
    private readonly reserve: ColorAmmoReserve,
    private size = VISIBLE_LOADS,
  ) {}

  /** Widening the queue fills the new slots at once. */
  setSize(size: number): void {
    this.size = Math.max(1, Math.round(size));
    if (this.slots.length > this.size) {
      // Shrinking gives back what the slots beyond the new size were holding.
      for (const load of this.slots.splice(this.size)) {
        if (load) this.reserve.releaseFromQueue(load.colorId, load.ammo);
      }
    }
    this.refill();
  }

  /** The offers, in slot order. A hole is a slot nothing could fill. */
  get positions(): readonly (CannonLoad | null)[] {
    return this.slots;
  }

  /** The offers that exist, for callers that do not care where they sit. */
  get visible(): readonly CannonLoad[] {
    return this.slots.filter((load): load is CannonLoad => load !== null);
  }

  /** Fills empty slots in place. Stops early when no colour can supply one. */
  refill(): void {
    while (this.slots.length < this.size) this.slots.push(null);

    for (let i = 0; i < this.size; i++) {
      if (this.slots[i]) continue;
      const load = this.generator.next();
      if (!load) return;
      this.slots[i] = load;
    }
  }

  /**
   * Empties one slot onto the rail. Returns null if the id is unknown — a stale
   * click, typically, which is exactly what shifting slots used to produce.
   */
  take(loadId: string): CannonLoad | null {
    const index = this.slots.findIndex((load) => load?.id === loadId);
    if (index < 0) return null;

    const load = this.slots[index]!;
    this.slots[index] = null;
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

    for (let i = 0; i < this.slots.length; i++) {
      const load = this.slots[i];
      if (!load || this.reserve.alive(load.colorId) > 0) continue;
      this.reserve.releaseFromQueue(load.colorId, load.ammo);
      this.slots[i] = null;
      dropped.push(load);
    }

    if (dropped.length > 0) this.refill();
    return dropped;
  }

  /**
   * Drops the offers that do not match a colour filter, freeing their rounds.
   *
   * Without this, turning the filter on would leave up to eight loads of the
   * wrong colours sitting in the way, and the player would have to spend them
   * before seeing what they asked for.
   */
  dropUnwanted(colorId: number | null): CannonLoad[] {
    if (colorId === null) return [];

    const dropped: CannonLoad[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const load = this.slots[i];
      if (!load || load.colorId === colorId) continue;
      this.reserve.releaseFromQueue(load.colorId, load.ammo);
      this.slots[i] = null;
      dropped.push(load);
    }

    this.refill();
    return dropped;
  }

  /** Restores a persisted queue, re-committing its rounds to the reserve. */
  restore(loads: CannonLoad[]): void {
    this.slots = [];
    for (const load of loads) {
      const ammo = this.reserve.reserveForQueue(load.colorId, load.ammo);
      if (ammo > 0) this.slots.push({ ...load, ammo });
    }
    this.refill();
  }
}
