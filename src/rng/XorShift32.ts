/**
 * Versioned deterministic PRNG.
 *
 * Every decision that has to be reproduced across a save / reload / offline
 * catch-up must go through this generator, never through `Math.random()`.
 * The algorithm name is persisted in the save so a future change can be
 * migrated instead of silently altering old runs.
 */
export const RNG_ALGORITHM = "xorshift32-v1" as const;
export type RngAlgorithm = typeof RNG_ALGORITHM;

export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    let s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    this.state = s;
  }

  nextU32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.nextU32() / 0x1_0000_0000;
  }

  /** Uniform integer in [0, exclusiveMax). */
  nextInt(exclusiveMax: number): number {
    if (exclusiveMax <= 0) {
      throw new RangeError("exclusiveMax must be > 0");
    }
    return Math.floor(this.nextFloat() * exclusiveMax);
  }

  snapshot(): number {
    return this.state;
  }
}

export interface Rng {
  nextInt(exclusiveMax: number): number;
  nextFloat(): number;
  snapshot(): number;
}
