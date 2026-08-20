import { DEAD } from "../core/constants";
import { XorShift32 } from "../rng/XorShift32";
import { ColorIndex } from "../world/ColorIndex";

export interface OfflineModelInput {
  colorId: Uint8Array;
  hp: Uint8Array;
  paletteSize: number;

  elapsedMs: number;
  maxOfflineMs: number;

  /** Logical hits per second the build produces against each colour. */
  damagePerSecondByColor: number[];
  /** Sub-hit remainder carried over from the previous catch-up. */
  fractionalCarryByColor: number[];

  rngState: number;
}

export interface OfflineModelResult {
  removedByColor: Uint32Array;
  totalDestroyed: number;
  fractionalCarryByColor: number[];
  rngState: number;
  elapsedAppliedMs: number;
}

/**
 * Resolves an absence in one shot.
 *
 * It does not replay frames: production is integrated analytically per colour,
 * the fractional remainder is carried so frequent short sessions lose nothing,
 * and the resulting counts are then spent by *actually deleting real pixels*
 * through the swap-delete index. That is the difference between coming back to
 * a gnawed image and coming back to a progress bar.
 *
 * A colour that runs out mid-catch-up spills its unspent hits onto whatever is
 * still alive, so an overnight absence cannot stall on an exhausted bucket.
 */
export function simulateOffline(input: OfflineModelInput): OfflineModelResult {
  const elapsedMs = Math.max(0, Math.min(input.elapsedMs, input.maxOfflineMs));
  const elapsedSeconds = elapsedMs / 1000;

  const index = ColorIndex.build(input.colorId, input.paletteSize);
  const rng = new XorShift32(input.rngState);

  const removedByColor = new Uint32Array(input.paletteSize);
  const carry = input.fractionalCarryByColor.slice(0, input.paletteSize);
  while (carry.length < input.paletteSize) carry.push(0);

  let totalDestroyed = 0;
  let spill = 0;

  for (let colour = 0; colour < input.paletteSize; colour++) {
    const dps = input.damagePerSecondByColor[colour] ?? 0;
    const exact = carry[colour] + dps * elapsedSeconds;
    const hits = Math.floor(exact);
    carry[colour] = exact - hits;

    const destroyed = destroyRandom(input, index, colour, hits, rng);
    removedByColor[colour] += destroyed;
    totalDestroyed += destroyed;
    spill += hits - destroyed;
  }

  // Redistribute the hits that had no target left, round-robin over the
  // colours that still have pixels.
  while (spill > 0) {
    let progressed = false;
    for (let colour = 0; colour < input.paletteSize && spill > 0; colour++) {
      if (index.alive[colour] === 0) continue;
      const share = Math.min(spill, index.alive[colour]);
      const destroyed = destroyRandom(input, index, colour, share, rng);
      if (destroyed === 0) continue;
      removedByColor[colour] += destroyed;
      totalDestroyed += destroyed;
      spill -= destroyed;
      progressed = true;
    }
    if (!progressed) break; // board fully cleared
  }

  return {
    removedByColor,
    totalDestroyed,
    fractionalCarryByColor: carry,
    rngState: rng.snapshot(),
    elapsedAppliedMs: elapsedMs,
  };
}

function destroyRandom(
  input: OfflineModelInput,
  index: ColorIndex,
  colour: number,
  count: number,
  rng: XorShift32,
): number {
  let removed = 0;
  while (removed < count) {
    const pixel = index.randomAlive(colour, rng);
    if (pixel < 0) break;
    if (!index.remove(input.colorId, pixel)) break;
    input.colorId[pixel] = DEAD;
    input.hp[pixel] = 0;
    removed++;
  }
  return removed;
}
