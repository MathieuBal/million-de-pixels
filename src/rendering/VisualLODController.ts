/**
 * Decides how many logical impacts deserve a visual effect.
 *
 * The whole point of the two-regime design is that logical throughput may keep
 * growing long after the renderer stopped being able to draw one effect per
 * hit. This controller keeps the VFX budget flat while power keeps climbing,
 * using reservoir-free stride sampling (cheap, deterministic, unbiased enough
 * for sparks).
 *
 * The thresholds are starting values to benchmark, not guarantees.
 */
export interface LODBudget {
  /** Max effects spawned per second. */
  maxVfxPerSecond: number;
  /** Max simulated (individually stepped) projectiles. */
  maxSimulatedProjectiles: number;
  /** Board texture uploads per second. */
  textureUploadHz: number;
}

export const DESKTOP_BUDGET: LODBudget = {
  maxVfxPerSecond: 900,
  maxSimulatedProjectiles: 900,
  textureUploadHz: 30,
};

export const MOBILE_BUDGET: LODBudget = {
  maxVfxPerSecond: 300,
  maxSimulatedProjectiles: 300,
  textureUploadHz: 18,
};

export class VisualLODController {
  private budget: LODBudget;
  private windowStartMs = 0;
  private vfxThisWindow = 0;
  private impactsThisWindow = 0;
  private stride = 1;
  private strideCursor = 0;

  constructor(budget: LODBudget = DESKTOP_BUDGET) {
    this.budget = budget;
  }

  setBudget(budget: LODBudget): void {
    this.budget = budget;
  }

  get currentBudget(): LODBudget {
    return this.budget;
  }

  get currentStride(): number {
    return this.stride;
  }

  /** Called once per frame; recomputes the sampling stride every second. */
  beginFrame(nowMs: number): void {
    if (this.windowStartMs === 0) {
      this.windowStartMs = nowMs;
      return;
    }
    const elapsed = nowMs - this.windowStartMs;
    if (elapsed < 1000) return;

    const impactsPerSecond = (this.impactsThisWindow * 1000) / elapsed;
    this.stride = Math.max(1, Math.ceil(impactsPerSecond / this.budget.maxVfxPerSecond));

    this.windowStartMs = nowMs;
    this.impactsThisWindow = 0;
    this.vfxThisWindow = 0;
  }

  /**
   * Registers `count` logical impacts and returns how many of them should be
   * drawn. Never returns more than the per-second budget allows.
   */
  sample(count: number): number {
    this.impactsThisWindow += count;

    this.strideCursor += count;
    const eligible = Math.floor(this.strideCursor / this.stride);
    this.strideCursor -= eligible * this.stride;

    const remaining = Math.max(0, this.budget.maxVfxPerSecond - this.vfxThisWindow);
    const granted = Math.min(eligible, remaining);
    this.vfxThisWindow += granted;
    return granted;
  }

  /** True while individual projectiles are still cheap enough to simulate. */
  canSimulateExactly(activeProjectiles: number): boolean {
    return activeProjectiles < this.budget.maxSimulatedProjectiles;
  }
}
