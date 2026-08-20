import {
  DEAD,
  PIXEL_COUNT,
  VOID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type PaletteEntry,
} from "../core/constants";
import type { Rng } from "../rng/XorShift32";
import { ColorIndex } from "./ColorIndex";
import { LaneIndex } from "./LaneIndex";
import { MacroTileIndex } from "./MacroTileIndex";

export interface PixelWorldBuffers {
  /** Quantized source color. Never mutated after import — used by prestige/replay. */
  baseColorId: Uint8Array;
  /** Current state: 0..paletteSize-1, VOID or DEAD. */
  colorId: Uint8Array;
  /** Remaining hit points. MVP uses 0 or 1. */
  hp: Uint8Array;
  /** Bitfield reserved for status effects (burning, frozen, marked...). */
  flags: Uint8Array;
}

export interface DestructionListener {
  (pixelIndex: number, color: number): void;
}

/**
 * Owner of the million cells.
 *
 * There is no object, sprite or collider per pixel: the whole level is four
 * Uint8Arrays plus two derived Uint32 index arrays. Every mutation goes
 * through this class so the color index, the macro tiles and the dirty flag
 * stay in sync.
 */
export class PixelWorld {
  readonly width = WORLD_WIDTH;
  readonly height = WORLD_HEIGHT;

  readonly baseColorId: Uint8Array;
  readonly colorId: Uint8Array;
  readonly hp: Uint8Array;
  readonly flags: Uint8Array;

  readonly palette: PaletteEntry[];
  readonly paletteSize: number;

  readonly colorIndex: ColorIndex;
  readonly macroTiles: MacroTileIndex;
  /** Answers "is there still a red pixel in this row?" in one read. */
  readonly lanes: LaneIndex;

  /** Cells that were playable at import time (excludes VOID). */
  readonly playablePixels: number;
  readonly voidPixels: number;

  private destroyedTotal = 0;
  private dirty = true;
  private listener: DestructionListener | null = null;

  constructor(buffers: PixelWorldBuffers, palette: PaletteEntry[]) {
    const { baseColorId, colorId, hp, flags } = buffers;
    for (const [name, buffer] of Object.entries(buffers)) {
      if (buffer.length !== PIXEL_COUNT) {
        throw new RangeError(`${name} must hold exactly ${PIXEL_COUNT} cells`);
      }
    }

    this.baseColorId = baseColorId;
    this.colorId = colorId;
    this.hp = hp;
    this.flags = flags;

    this.palette = palette;
    this.paletteSize = palette.length;

    this.colorIndex = ColorIndex.build(colorId, this.paletteSize);
    this.macroTiles = MacroTileIndex.build(colorId, this.paletteSize);
    this.lanes = LaneIndex.build(colorId, this.paletteSize);

    let voidPixels = 0;
    let destroyed = 0;
    for (let i = 0; i < colorId.length; i++) {
      const c = colorId[i];
      if (c === VOID) voidPixels++;
      else if (c === DEAD) destroyed++;
    }
    this.voidPixels = voidPixels;
    this.destroyedTotal = destroyed;
    this.playablePixels = PIXEL_COUNT - voidPixels;
  }

  static create(palette: PaletteEntry[], colorId: Uint8Array): PixelWorld {
    const hp = new Uint8Array(PIXEL_COUNT);
    hp.fill(1);
    return new PixelWorld(
      {
        baseColorId: colorId.slice(),
        colorId,
        hp,
        flags: new Uint8Array(PIXEL_COUNT),
      },
      palette,
    );
  }

  onDestroy(listener: DestructionListener | null): void {
    this.listener = listener;
  }

  index(x: number, y: number): number {
    return y * WORLD_WIDTH + x;
  }

  aliveByColor(color: number): number {
    return this.colorIndex.alive[color];
  }

  aliveTotal(): number {
    return this.colorIndex.aliveTotal();
  }

  destroyedCount(): number {
    return this.destroyedTotal;
  }

  /** Fraction of originally playable pixels that are gone, in [0, 1]. */
  progress(): number {
    if (this.playablePixels === 0) return 1;
    return this.destroyedTotal / this.playablePixels;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /**
   * Applies damage to one cell. Returns true only when the cell died on this
   * call, which is what callers count as a real destruction.
   */
  damage(pixelIndex: number, amount: number): boolean {
    const color = this.colorId[pixelIndex];
    if (color >= this.paletteSize) return false;
    if (this.hp[pixelIndex] > amount) {
      this.hp[pixelIndex] -= amount;
      return false;
    }
    return this.destroy(pixelIndex);
  }

  /** Kills a cell outright. Idempotent: a second call returns false. */
  destroy(pixelIndex: number): boolean {
    const color = this.colorId[pixelIndex];
    if (color >= this.paletteSize) return false;

    if (!this.colorIndex.remove(this.colorId, pixelIndex)) return false;

    const x = pixelIndex % WORLD_WIDTH;
    const y = (pixelIndex / WORLD_WIDTH) | 0;

    this.colorId[pixelIndex] = DEAD;
    this.hp[pixelIndex] = 0;
    this.macroTiles.decrement(x, y, color);
    this.lanes.decrement(x, y, color);

    this.destroyedTotal++;
    this.dirty = true;
    this.listener?.(pixelIndex, color);
    return true;
  }

  /**
   * Destroys `count` random alive pixels of one color without ever scanning
   * the board. This is the primitive shared by mass abilities and by the
   * offline catch-up.
   */
  destroyRandomOfColor(color: number, count: number, rng: Rng): number {
    let removed = 0;
    while (removed < count) {
      const pixelIndex = this.colorIndex.randomAlive(color, rng);
      if (pixelIndex < 0) break;
      if (this.destroy(pixelIndex)) removed++;
    }
    return removed;
  }

  snapshotBuffers(): PixelWorldBuffers {
    return {
      baseColorId: this.baseColorId,
      colorId: this.colorId,
      hp: this.hp,
      flags: this.flags,
    };
  }
}
