import { makeCard, type ColorCard } from "./cards";

export interface DeckGenerationOptions {
  deckSize: number;
  /**
   * Tempering exponent. 1 gives a strictly proportional deck, where a colour
   * covering 60% of the image crushes every other one; lower values keep rare
   * colours playable. Starting value to balance, not a law.
   */
  alpha?: number;
}

/**
 * Temper the raw colour distribution into deck weights.
 * Colours with zero pixels get zero weight and no card.
 */
export function deckWeights(counts: Uint32Array | number[], alpha = 0.7): Float64Array {
  const length = counts.length;
  let total = 0;
  for (let i = 0; i < length; i++) total += counts[i];

  const weights = new Float64Array(length);
  if (total === 0) return weights;

  let sum = 0;
  for (let i = 0; i < length; i++) {
    const w = counts[i] === 0 ? 0 : Math.pow(counts[i] / total, alpha);
    weights[i] = w;
    sum += w;
  }
  if (sum === 0) return weights;

  for (let i = 0; i < length; i++) weights[i] /= sum;
  return weights;
}

/**
 * Largest-remainder allocation of `deckSize` cards over the present colours.
 *
 * Every colour present in the image is guaranteed at least one card first —
 * a rare colour with no card would be a dead end for the run, since nothing
 * else can destroy it.
 */
export function allocateCards(
  counts: Uint32Array | number[],
  deckSize: number,
  alpha = 0.7,
): Uint32Array {
  const length = counts.length;
  const allocation = new Uint32Array(length);

  const present: number[] = [];
  for (let i = 0; i < length; i++) if (counts[i] > 0) present.push(i);
  if (present.length === 0) return allocation;

  const guaranteed = Math.min(present.length, deckSize);
  for (let i = 0; i < guaranteed; i++) allocation[present[i]] = 1;

  let remaining = deckSize - guaranteed;
  if (remaining <= 0) return allocation;

  const weights = deckWeights(counts, alpha);
  const exact = new Float64Array(length);
  let assigned = 0;
  for (const colour of present) {
    exact[colour] = weights[colour] * remaining;
    const floor = Math.floor(exact[colour]);
    allocation[colour] += floor;
    assigned += floor;
  }

  // Largest remainder, deterministic tie-break on colour id.
  const leftovers = present
    .map((colour) => ({ colour, remainder: exact[colour] - Math.floor(exact[colour]) }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.colour - b.colour));

  remaining -= assigned;
  for (let i = 0; i < remaining; i++) {
    allocation[leftovers[i % leftovers.length].colour]++;
  }

  return allocation;
}

export function generateDeck(
  counts: Uint32Array | number[],
  options: DeckGenerationOptions,
): ColorCard[] {
  const allocation = allocateCards(counts, options.deckSize, options.alpha ?? 0.7);
  const deck: ColorCard[] = [];
  for (let colour = 0; colour < allocation.length; colour++) {
    for (let copy = 0; copy < allocation[colour]; copy++) {
      deck.push(makeCard(colour, copy));
    }
  }
  return deck;
}
