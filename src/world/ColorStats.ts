import type { PixelWorld } from "./PixelWorld";

export interface ColorStatEntry {
  colorId: number;
  /** Pixels of this colour when the level was generated. */
  initialCount: number;
  alive: number;
  destroyed: number;
  /** Share of the pixels still standing, in [0, 1]. */
  shareOfRemaining: number;
  /** Share of the level as originally generated, in [0, 1]. */
  shareOfInitial: number;
  /** Smoothed destruction rate, pixels per second. */
  rate: number;
  /** Share of the deck's total damage output aimed here, in [0, 1]. */
  dpsShare: number;
  /** Seconds until this colour runs out at the current rate. Infinity if idle. */
  etaSeconds: number;
  exhausted: boolean;
}

export interface Imbalance {
  colorId: number;
  /** How far the effort is from the need. Positive = starved, negative = wasted. */
  gap: number;
}

/** A colour must be this far off its fair share before it is worth reporting. */
const IMBALANCE_THRESHOLD = 0.08;

/** Exponential smoothing factor for the destruction rate. */
const RATE_SMOOTHING = 0.3;

const MIN_SAMPLE_INTERVAL_MS = 200;

/**
 * Single owner of the per-colour statistics.
 *
 * Before this existed the numbers were spread across three places: the palette
 * carried a count frozen at import, the colour index carried the live count,
 * and the HUD smoothed its own rates on the side. None of the three could
 * answer the question the game is actually about — which colour is holding the
 * player back.
 *
 * It reads `ColorIndex.alive`, which is always current, so there is nothing to
 * subscribe to and nothing that can drift out of sync.
 */
export class ColorStats {
  readonly paletteSize: number;

  private readonly initialCount: Uint32Array;
  private readonly previousAlive: Uint32Array;
  private readonly rate: Float64Array;
  private readonly dps: Float64Array;

  private lastSampleMs = 0;

  constructor(private readonly world: PixelWorld) {
    this.paletteSize = world.paletteSize;

    this.initialCount = new Uint32Array(this.paletteSize);
    this.previousAlive = new Uint32Array(this.paletteSize);
    this.rate = new Float64Array(this.paletteSize);
    this.dps = new Float64Array(this.paletteSize);

    for (let colour = 0; colour < this.paletteSize; colour++) {
      // The palette count is the import-time total, so `destroyed` stays
      // correct across a reload even though `alive` comes back reduced.
      this.initialCount[colour] = world.palette[colour]?.count ?? 0;
      this.previousAlive[colour] = world.aliveByColor(colour);
    }
  }

  /**
   * Refreshes the smoothed rates. Cheap enough to call every frame — it walks
   * the palette, never the board — but throttled so the smoothing window stays
   * meaningful regardless of frame rate.
   */
  sample(nowMs: number, damagePerSecondByColor?: ArrayLike<number>): void {
    if (damagePerSecondByColor) {
      for (let colour = 0; colour < this.paletteSize; colour++) {
        this.dps[colour] = damagePerSecondByColor[colour] ?? 0;
      }
    }

    if (this.lastSampleMs === 0) {
      this.lastSampleMs = nowMs;
      return;
    }

    const elapsedMs = nowMs - this.lastSampleMs;
    if (elapsedMs < MIN_SAMPLE_INTERVAL_MS) return;

    const elapsedSeconds = elapsedMs / 1000;
    this.lastSampleMs = nowMs;

    for (let colour = 0; colour < this.paletteSize; colour++) {
      const alive = this.world.aliveByColor(colour);
      const instant = Math.max(0, this.previousAlive[colour] - alive) / elapsedSeconds;
      this.rate[colour] =
        this.rate[colour] * (1 - RATE_SMOOTHING) + instant * RATE_SMOOTHING;
      this.previousAlive[colour] = alive;
    }
  }

  entryOf(colour: number): ColorStatEntry {
    const alive = this.world.aliveByColor(colour);
    const initial = this.initialCount[colour];
    const totalAlive = this.world.aliveTotal();
    const totalDps = this.totalDps();
    const rate = this.rate[colour];

    return {
      colorId: colour,
      initialCount: initial,
      alive,
      destroyed: Math.max(0, initial - alive),
      shareOfRemaining: totalAlive === 0 ? 0 : alive / totalAlive,
      shareOfInitial: this.world.playablePixels === 0 ? 0 : initial / this.world.playablePixels,
      rate,
      dpsShare: totalDps === 0 ? 0 : this.dps[colour] / totalDps,
      etaSeconds: rate <= 0 ? Number.POSITIVE_INFINITY : alive / rate,
      exhausted: alive === 0,
    };
  }

  entries(): ColorStatEntry[] {
    const out: ColorStatEntry[] = [];
    for (let colour = 0; colour < this.paletteSize; colour++) out.push(this.entryOf(colour));
    return out;
  }

  totalDps(): number {
    let total = 0;
    for (let colour = 0; colour < this.paletteSize; colour++) total += this.dps[colour];
    return total;
  }

  /**
   * Colours that make up a bigger share of what is left than of the deck's
   * output. These are what the run is actually waiting on.
   */
  bottlenecks(): Imbalance[] {
    return this.imbalances().filter((entry) => entry.gap > 0);
  }

  /**
   * The mirror image: output pouring into a colour that is nearly gone. This is
   * what makes a deck feel wrong long before it stops working.
   */
  wasted(): Imbalance[] {
    return this.imbalances()
      .filter((entry) => entry.gap < 0)
      .map((entry) => ({ ...entry, gap: -entry.gap }));
  }

  /** Signed gap between need and effort, worst first. */
  private imbalances(): Imbalance[] {
    const out: Imbalance[] = [];
    for (const entry of this.entries()) {
      if (entry.alive === 0) continue;
      const gap = entry.shareOfRemaining - entry.dpsShare;
      if (Math.abs(gap) < IMBALANCE_THRESHOLD) continue;
      out.push({ colorId: entry.colorId, gap });
    }
    return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  }

  /** Seconds until the board is cleared at the current pace. */
  etaSeconds(): number {
    let worst = 0;
    for (let colour = 0; colour < this.paletteSize; colour++) {
      const entry = this.entryOf(colour);
      if (entry.alive === 0) continue;
      if (!Number.isFinite(entry.etaSeconds)) return Number.POSITIVE_INFINITY;
      if (entry.etaSeconds > worst) worst = entry.etaSeconds;
    }
    return worst;
  }
}
