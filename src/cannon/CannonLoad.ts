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

export interface LoadWeight {
  colorId: number;
  weight: number;
}

/** Normalised, tempered weights over the colours that can still supply rounds. */
export function loadWeights(
  reserve: ColorAmmoReserve,
  alpha = LOAD_WEIGHT_ALPHA,
): LoadWeight[] {
  const available = reserve.availableColors();
  if (available.length === 0) return [];

  let total = 0;
  for (const colour of available) total += reserve.assignable(colour);
  if (total === 0) return [];

  const weights = available.map((colorId) => ({
    colorId,
    weight: Math.pow(reserve.assignable(colorId) / total, alpha),
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

  /** Loads already in the queue keep the stock they were drawn with. */
  setAmmoPerLoad(ammo: number): void {
    this.ammoPerLoad = Math.max(1, Math.round(ammo));
  }

  /** Returns null when no colour can supply a single round any more. */
  next(): CannonLoad | null {
    const weights = loadWeights(this.reserve);
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
    const ammo = this.reserve.reserveForQueue(chosen, this.ammoPerLoad);
    if (ammo === 0) return null;

    return { id: `load-${++this.counter}`, colorId: chosen, ammo };
  }
}
