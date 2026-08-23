import type { ColorId } from "../core/constants";
import type { Rng } from "../rng/XorShift32";
import type { ColorAmmoReserve } from "./ColorAmmoReserve";

/**
 * One slot of the queue: a cannon waiting to be launched, and the rounds it
 * will carry. This replaces the old notion of a card that periodically feeds a
 * single permanent cannon.
 */
export interface CannonLoad {
  id: string;
  colorId: ColorId;
  ammo: number;
}

/** Rounds carried by a freshly generated load. Opening value, to balance. */
export const DEFAULT_LOAD_AMMO = 40;

/**
 * Tempering exponent on the colour distribution.
 *
 * Applied to the pixels still assignable rather than to a fixed number of
 * cards: a colour covering 60% of the image must not monopolise the queue, and
 * a colour down to its last few thousand pixels must stop being offered.
 */
export const LOAD_WEIGHT_ALPHA = 0.7;

/**
 * What a colour's share is multiplied by while no lane exposes it.
 *
 * Not zero, and that is the whole point: a buried colour is one destroyed cell
 * away from being shootable again, and a queue that had stopped offering it
 * would take several draws to notice. It keeps a tenth of its share — enough to
 * come back on its own, little enough that it stops flooding the étal.
 *
 * Without this, the end of a toile went like this: the last colours to be
 * uncovered hold tens of thousands of pixels each, the queue draws by pixel
 * count alone, and every slot fills with colours no cannon can touch. Measured
 * on a stalled run: colours 0 and 3 held 22 000 pixels between them, had zero
 * exposed lanes, and were the only two the étal would offer.
 */
export const UNREACHABLE_WEIGHT = 0.1;

export interface LoadWeight {
  colorId: number;
  weight: number;
}

/** Normalised, tempered weights over the colours that can still supply rounds. */
export function loadWeights(
  reserve: ColorAmmoReserve,
  alpha = LOAD_WEIGHT_ALPHA,
  only: number | null = null,
  reachable: readonly boolean[] | null = null,
): LoadWeight[] {
  const all = reserve.availableColors();
  // The Trieuse unlock lets a player commit the queue to one colour. It narrows
  // what is offered rather than inventing rounds: a colour with nothing left to
  // promise falls back to the normal draw instead of emptying the queue.
  const available = only !== null && all.includes(only) ? [only] : all;
  if (available.length === 0) return [];

  let total = 0;
  for (const colour of available) total += reserve.assignable(colour);
  if (total === 0) return [];

  const weights = available.map((colorId) => ({
    colorId,
    weight:
      Math.pow(reserve.assignable(colorId) / total, alpha) *
      (reachable && reachable[colorId] === false ? UNREACHABLE_WEIGHT : 1),
  }));

  let sum = 0;
  for (const entry of weights) sum += entry.weight;
  if (sum === 0) return [];

  for (const entry of weights) entry.weight /= sum;
  return weights;
}

/**
 * Produces the next load on demand.
 *
 * A million pixels at forty rounds a load is twenty-five thousand loads; none
 * of them are built ahead of time. A load is drawn only when a slot opens, and
 * only from the pixels that are actually still there.
 */
export class CannonLoadGenerator {
  private counter = 0;

  constructor(
    private readonly reserve: ColorAmmoReserve,
    private readonly rng: Rng,
    private ammoPerLoad = DEFAULT_LOAD_AMMO,
  ) {}

  private preferred: number | null = null;
  private reachable: readonly boolean[] | null = null;

  /** Loads already in the queue keep the stock they were drawn with. */
  setAmmoPerLoad(ammo: number): void {
    this.ammoPerLoad = Math.max(1, Math.round(ammo));
  }

  /** Restricts what the queue draws to one colour. Null is the normal draw. */
  setPreferredColor(colorId: number | null): void {
    this.preferred = colorId;
  }

  get preferredColor(): number | null {
    return this.preferred;
  }

  /**
   * Which colours a cannon could actually hit right now. Null draws blind, as
   * before — the draw still only ever offers colours that have pixels left.
   */
  setReachable(reachable: readonly boolean[] | null): void {
    this.reachable = reachable;
  }

  /**
   * The stock a load of this colour would be cut with right now.
   *
   * The reserve trims it further; this is what the magazine asks for. The queue
   * reads it to tell a current offer from one cut two upgrades ago.
   *
   * Sizing it against the étal instead — so a hundred slots each held a
   * hundredth of the board — was measured and dropped: it fills every slot and
   * keeps the offer turning, but it also takes Chargeur away exactly where the
   * player has bought it, and a toile that cleared in twenty-nine minutes took
   * a hundred and seventy-eight.
   */
  loadSizeFor(_colorId: number): number {
    return this.ammoPerLoad;
  }

  /** Returns null when no colour can supply a single round any more. */
  next(): CannonLoad | null {
    const weights = loadWeights(this.reserve, LOAD_WEIGHT_ALPHA, this.preferred, this.reachable);
    if (weights.length === 0) return null;

    const roll = this.rng.nextFloat();
    let cursor = 0;
    let chosen = weights[weights.length - 1].colorId;
    for (const entry of weights) {
      cursor += entry.weight;
      if (roll < cursor) {
        chosen = entry.colorId;
        break;
      }
    }

    // A load never promises more rounds than the colour has pixels left.
    const ammo = this.reserve.reserveForQueue(chosen, this.loadSizeFor(chosen));
    if (ammo === 0) return null;

    return { id: `load-${++this.counter}`, colorId: chosen, ammo };
  }
}
