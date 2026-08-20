import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { Axis } from "../combat/axisTraversal";

/**
 * Per-lane, per-colour alive counts.
 *
 * The cannon patrols the border and only fires when it passes in front of a
 * pixel of the colour it is holding. Answering "does row 412 still contain any
 * red?" by scanning the lane would cost 1024 reads per check, several times per
 * frame; this index answers it in one read and is updated in O(1) on every
 * destruction.
 *
 * A lane holds at most 1024 cells, so Uint16 is enough. Total cost for a
 * 16-colour palette is (1024 rows + 1024 columns) x 16 x 2 bytes = 64 KiB.
 */
export class LaneIndex {
  readonly paletteSize: number;
  private readonly rows: Uint16Array;
  private readonly columns: Uint16Array;

  private constructor(paletteSize: number, rows: Uint16Array, columns: Uint16Array) {
    this.paletteSize = paletteSize;
    this.rows = rows;
    this.columns = columns;
  }

  static build(colorId: Uint8Array, paletteSize: number): LaneIndex {
    const rows = new Uint16Array(WORLD_HEIGHT * paletteSize);
    const columns = new Uint16Array(WORLD_WIDTH * paletteSize);

    for (let i = 0; i < colorId.length; i++) {
      const c = colorId[i];
      if (c >= paletteSize) continue;
      const x = i % WORLD_WIDTH;
      const y = (i / WORLD_WIDTH) | 0;
      rows[y * paletteSize + c]++;
      columns[x * paletteSize + c]++;
    }

    return new LaneIndex(paletteSize, rows, columns);
  }

  decrement(x: number, y: number, color: number): void {
    const row = y * this.paletteSize + color;
    const column = x * this.paletteSize + color;
    if (this.rows[row] > 0) this.rows[row]--;
    if (this.columns[column] > 0) this.columns[column]--;
  }

  count(axis: Axis, lane: number, color: number): number {
    if (color >= this.paletteSize) return 0;
    const table = axis === "row" ? this.rows : this.columns;
    return table[lane * this.paletteSize + color];
  }

  /** True when firing down this lane could actually hit something. */
  hasColor(axis: Axis, lane: number, color: number): boolean {
    return this.count(axis, lane, color) > 0;
  }
}
