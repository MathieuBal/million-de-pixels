import type { CannonLoad } from "./CannonLoad";
import type { CannonLoadGenerator } from "./CannonLoad";
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

  /** Passes the reachable palette on to the draw. Null draws blind. */
  setReachable(reachable: readonly boolean[] | null): void {
    this.generator.setReachable(reachable);
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
   * Re-cuts the one offer that has gone most out of date, and gives its rounds
   * back. Returns it, or null when the étal is current.
   *
   * The end of a toile used to freeze the étal, and it took two mistakes to do
   * it. A load is cut when the board is large and keeps the stock it was cut
   * with; the board then shrinks under it. So the rounds promised to the queue
   * converge on the rounds that exist — measured at ninety percent cleared with
   * the étal upgraded to a hundred slots, a hundred thousand rounds committed
   * against a hundred and two thousand living pixels — and `next()` has nothing
   * left to draw with. The offer stops changing, and if the colours it froze on
   * happen to be buried behind others, the toile cannot be finished at all.
   *
   * `ColorAmmoReserve.QUEUE_SHARE` stops the first half of that, but on its own
   * it makes the second half worse: the colours a cannon *can* reach are the
   * ones the queue offers most, so they are the first to fill their share with
   * old fat loads — and then they are the ones that can no longer be drawn,
   * while the buried colours still can. Measured after that change alone: the
   * three reachable colours held seventy-eight of ninety-nine slots and were
   * launched exactly zero times in ten minutes.
   *
   * So staleness is what gets re-cut, and it is two things at once: a colour
   * nothing exposes, and a stock far larger than the same load would be given
   * today. The worst offender goes first.
   *
   * One per call, which the simulator makes about once a second. That is what
   * keeps this from being the tile-shuffling bug again: the slot a player is
   * aiming at is almost never the single worst one, and a tap that does land on
   * a re-cut slot resolves to nothing rather than to the wrong colour, because
   * `take()` matches on the load's id.
   */
  recycleStale(reachable: readonly boolean[]): CannonLoad | null {
    let worst = -1;
    let worstScore = 0;

    for (let i = 0; i < this.slots.length; i++) {
      const load = this.slots[i];
      if (!load) continue;

      const ideal = this.idealAmmo(load.colorId);
      // How many times over its current worth this load is, and whether its
      // colour is shootable at all. Being unreachable outweighs any excess:
      // rounds promised to a buried colour do nothing whatever their number.
      const excess = load.ammo / Math.max(1, ideal);
      const score = (reachable[load.colorId] === false ? 100 : 0) + (excess >= 2 ? excess : 0);
      if (score > worstScore) {
        worstScore = score;
        worst = i;
      }
    }

    if (worst < 0) return null;

    const load = this.slots[worst]!;
    this.reserve.releaseFromQueue(load.colorId, load.ammo);
    this.slots[worst] = this.generator.next();
    return load;
  }

  /** What a load of this colour would be cut with right now. */
  private idealAmmo(colorId: number): number {
    return Math.max(1, Math.min(this.generator.loadSizeFor(colorId), this.reserve.alive(colorId)));
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
