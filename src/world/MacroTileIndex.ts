import {
  MACRO_TILES_X,
  MACRO_TILE_COUNT,
  MACRO_TILE_SIZE,
  WORLD_WIDTH,
} from "../core/constants";

/**
 * Per-tile alive counts, one Uint16 per (tile, color).
 *
 * A 32x32 tile holds at most 1024 cells, so Uint16 is enough. Total cost for
 * a 16 color palette is 32 KiB. Area effects use it to reject whole tiles
 * before touching individual cells.
 */
export class MacroTileIndex {
  readonly paletteSize: number;
  readonly counts: Uint16Array;

  private constructor(paletteSize: number, counts: Uint16Array) {
    this.paletteSize = paletteSize;
    this.counts = counts;
  }

  static build(colorId: Uint8Array, paletteSize: number): MacroTileIndex {
    const counts = new Uint16Array(MACRO_TILE_COUNT * paletteSize);
    for (let i = 0; i < colorId.length; i++) {
      const c = colorId[i];
      if (c >= paletteSize) continue;
      const x = i % WORLD_WIDTH;
      const y = (i / WORLD_WIDTH) | 0;
      const tile = ((y / MACRO_TILE_SIZE) | 0) * MACRO_TILES_X + ((x / MACRO_TILE_SIZE) | 0);
      counts[tile * paletteSize + c]++;
    }
    return new MacroTileIndex(paletteSize, counts);
  }

  static tileOf(x: number, y: number): number {
    return ((y / MACRO_TILE_SIZE) | 0) * MACRO_TILES_X + ((x / MACRO_TILE_SIZE) | 0);
  }

  decrement(x: number, y: number, color: number): void {
    const slot = MacroTileIndex.tileOf(x, y) * this.paletteSize + color;
    if (this.counts[slot] > 0) this.counts[slot]--;
  }

  countIn(tile: number, color: number): number {
    return this.counts[tile * this.paletteSize + color];
  }

  /** True when the tile still holds at least one cell of any color. */
  tileHasAnything(tile: number): boolean {
    const base = tile * this.paletteSize;
    for (let c = 0; c < this.paletteSize; c++) {
      if (this.counts[base + c] !== 0) return true;
    }
    return false;
  }
}
