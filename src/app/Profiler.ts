export interface FrameSample {
  frameMs: number;
  simMs: number;
  uploadMs: number;
}

/**
 * Rolling frame statistics.
 *
 * Budgets in this project are acceptance criteria (p95 frame, sim time,
 * logical impacts per second), so they have to be measured continuously rather
 * than eyeballed once in DevTools.
 */
export class Profiler {
  private readonly frames: number[] = [];
  private readonly sim: number[] = [];
  private readonly capacity: number;

  private windowStartMs = 0;
  private logicalImpactsWindow = 0;
  private visualImpactsWindow = 0;
  private destroyedWindow = 0;

  logicalImpactsPerSecond = 0;
  visualImpactsPerSecond = 0;
  destroyedPerSecond = 0;

  constructor(capacity = 180) {
    this.capacity = capacity;
  }

  recordFrame(frameMs: number, simMs: number): void {
    push(this.frames, frameMs, this.capacity);
    push(this.sim, simMs, this.capacity);
  }

  recordCounters(nowMs: number, logicalImpacts: number, visualImpacts: number, destroyed: number): void {
    this.logicalImpactsWindow += logicalImpacts;
    this.visualImpactsWindow += visualImpacts;
    this.destroyedWindow += destroyed;

    if (this.windowStartMs === 0) {
      this.windowStartMs = nowMs;
      return;
    }
    const elapsed = nowMs - this.windowStartMs;
    if (elapsed < 500) return;

    const scale = 1000 / elapsed;
    this.logicalImpactsPerSecond = this.logicalImpactsWindow * scale;
    this.visualImpactsPerSecond = this.visualImpactsWindow * scale;
    this.destroyedPerSecond = this.destroyedWindow * scale;

    this.windowStartMs = nowMs;
    this.logicalImpactsWindow = 0;
    this.visualImpactsWindow = 0;
    this.destroyedWindow = 0;
  }

  get fps(): number {
    const mean = average(this.frames);
    return mean > 0 ? 1000 / mean : 0;
  }

  get p95FrameMs(): number {
    return percentile(this.frames, 0.95);
  }

  get meanSimMs(): number {
    return average(this.sim);
  }
}

function push(list: number[], value: number, capacity: number): void {
  list.push(value);
  if (list.length > capacity) list.shift();
}

function average(list: number[]): number {
  if (list.length === 0) return 0;
  let sum = 0;
  for (const v of list) sum += v;
  return sum / list.length;
}

function percentile(list: number[], p: number): number {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}
