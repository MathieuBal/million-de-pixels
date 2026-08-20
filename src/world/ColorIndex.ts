import { DEAD, MAX_PALETTE_SIZE, VOID } from "../core/constants";
import type { Rng } from "../rng/XorShift32";

/**
 * O(1) index of the still-alive pixels, bucketed by color.
 *
 * `pixelsByColor` stores every playable pixel index grouped in one contiguous
 * segment per color. `slotOfPixel` is the inverse permutation. Destroying a
 * pixel is a swap with the last alive slot of its bucket, so neither
 * destruction nor "pick a random red pixel" ever scans the million cells.
 *
 * Layout of a bucket (color c):
 *   offsets[c] .. offsets[c] + alive[c] - 1   -> alive pixels
 *   offsets[c] + alive[c] .. offsets[c+1] - 1 -> dead pixels (kept, not erased)
 *
 * The index is derived state: it is rebuilt from `colorId` on load rather than
 * being persisted (it would cost 8 MiB in the save for no benefit).
 */
export class ColorIndex {
  readonly paletteSize: number;

  /** Alive-then-dead pixel indices, grouped by color. */
  readonly pixelsByColor: Uint32Array;
  /** slotOfPixel[pixelIndex] === position of that pixel inside pixelsByColor. */
  readonly slotOfPixel: Uint32Array;
  /** Start of each color bucket. Length paletteSize + 1. */
  readonly offsets: Uint32Array;
  /** Number of still-alive pixels per color. */
  readonly alive: Uint32Array;

  private constructor(
    paletteSize: number,
    pixelsByColor: Uint32Array,
    slotOfPixel: Uint32Array,
    offsets: Uint32Array,
    alive: Uint32Array,
  ) {
    this.paletteSize = paletteSize;
    this.pixelsByColor = pixelsByColor;
    this.slotOfPixel = slotOfPixel;
    this.offsets = offsets;
    this.alive = alive;
  }

  /**
   * Builds the index from the current color map in two O(N) passes.
   * Cells holding VOID or DEAD are not indexed at all.
   */
  static build(colorId: Uint8Array, paletteSize: number): ColorIndex {
    if (paletteSize < 1 || paletteSize > MAX_PALETTE_SIZE) {
      throw new RangeError(`paletteSize out of range: ${paletteSize}`);
    }

    const alive = new Uint32Array(paletteSize);
    for (let i = 0; i < colorId.length; i++) {
      const c = colorId[i];
      if (c < paletteSize) alive[c]++;
    }

    const offsets = new Uint32Array(paletteSize + 1);
    let running = 0;
    for (let c = 0; c < paletteSize; c++) {
      offsets[c] = running;
      running += alive[c];
    }
    offsets[paletteSize] = running;

    const pixelsByColor = new Uint32Array(running);
    const slotOfPixel = new Uint32Array(colorId.length);

    const cursor = offsets.slice(0, paletteSize);
    for (let i = 0; i < colorId.length; i++) {
      const c = colorId[i];
      if (c >= paletteSize) continue;
      const slot = cursor[c]++;
      pixelsByColor[slot] = i;
      slotOfPixel[i] = slot;
    }

    return new ColorIndex(paletteSize, pixelsByColor, slotOfPixel, offsets, alive);
  }

  aliveTotal(): number {
    let total = 0;
    for (let c = 0; c < this.paletteSize; c++) total += this.alive[c];
    return total;
  }

  /**
   * Removes one pixel from its bucket. Returns false when the pixel was
   * already dead, void, or never playable, so callers can count real kills.
   *
   * Does NOT write DEAD into `colorId` — that is `PixelWorld`'s job, so the
   * index stays usable on a bare buffer inside the idle worker.
   */
  remove(colorId: Uint8Array, pixelIndex: number): boolean {
    const color = colorId[pixelIndex];
    if (color >= this.paletteSize) return false;
    if (this.alive[color] === 0) return false;

    const slot = this.slotOfPixel[pixelIndex];
    const lastSlot = this.offsets[color] + this.alive[color] - 1;
    const replacement = this.pixelsByColor[lastSlot];

    this.pixelsByColor[slot] = replacement;
    this.slotOfPixel[replacement] = slot;

    this.pixelsByColor[lastSlot] = pixelIndex;
    this.slotOfPixel[pixelIndex] = lastSlot;

    this.alive[color]--;
    return true;
  }

  /** Picks a uniformly random alive pixel of `color`, or -1 when exhausted. */
  randomAlive(color: number, rng: Rng): number {
    const remaining = this.alive[color];
    if (remaining === 0) return -1;
    const slot = this.offsets[color] + rng.nextInt(remaining);
    return this.pixelsByColor[slot];
  }

  /** Debug/test helper: verifies the permutation is still consistent. */
  verify(colorId: Uint8Array): void {
    for (let c = 0; c < this.paletteSize; c++) {
      const start = this.offsets[c];
      const end = this.offsets[c + 1];
      for (let slot = start; slot < end; slot++) {
        const pixel = this.pixelsByColor[slot];
        if (this.slotOfPixel[pixel] !== slot) {
          throw new Error(`slotOfPixel mismatch at slot ${slot} (pixel ${pixel})`);
        }
        const isAliveSlot = slot < start + this.alive[c];
        const value = colorId[pixel];
        if (isAliveSlot && value !== c) {
          throw new Error(`alive slot ${slot} holds color ${value}, expected ${c}`);
        }
        if (!isAliveSlot && value !== DEAD && value !== VOID) {
          throw new Error(`dead slot ${slot} holds live color ${value}`);
        }
      }
    }
  }
}
