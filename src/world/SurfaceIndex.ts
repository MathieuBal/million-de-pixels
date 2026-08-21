import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { Axis, Direction } from "../combat/axisTraversal";

/**
 * Direction slots. A lane is approached from one of four sides, and each
 * approach exposes a different cell first.
 */
const ROW_FROM_LEFT = 0;
const ROW_FROM_RIGHT = 1;
const COLUMN_FROM_TOP = 2;
const COLUMN_FROM_BOTTOM = 3;

const NONE = -1;

/**
 * The exposed surface of the image: the first solid cell of every lane, seen
 * from each of the four sides.
 *
 * A ball stops at the first cell it meets, so what a cannon can actually hit is
 * not "is my colour somewhere in this lane" but "is my colour the one facing
 * me". Answering that by scanning would cost up to 1 024 reads per check,
 * several times a frame; here it is one read.
 *
 * Kept cheap by the fact that cells never come back: a front pointer only ever
 * moves deeper into the image, so advancing it is amortised constant over the
 * life of a level. Holes left by destroyed cells and the transparent margins
 * are both skipped — a ball passes straight through them.
 */
export class SurfaceIndex {
  private readonly fronts: Int16Array;
  private readonly paletteSize: number;

  private constructor(fronts: Int16Array, paletteSize: number) {
    this.fronts = fronts;
    this.paletteSize = paletteSize;
  }

  static build(colorId: Uint8Array, paletteSize: number): SurfaceIndex {
    const fronts = new Int16Array(4 * Math.max(WORLD_WIDTH, WORLD_HEIGHT));
    const index = new SurfaceIndex(fronts, paletteSize);

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      fronts[ROW_FROM_LEFT * WORLD_HEIGHT + y] = index.scanRow(colorId, y, 0, 1);
      fronts[ROW_FROM_RIGHT * WORLD_HEIGHT + y] = index.scanRow(colorId, y, WORLD_WIDTH - 1, -1);
    }
    for (let x = 0; x < WORLD_WIDTH; x++) {
      fronts[COLUMN_FROM_TOP * WORLD_WIDTH + x] = index.scanColumn(colorId, x, 0, 1);
      fronts[COLUMN_FROM_BOTTOM * WORLD_WIDTH + x] = index.scanColumn(
        colorId,
        x,
        WORLD_HEIGHT - 1,
        -1,
      );
    }

    return index;
  }

  /** Position along the axis of the first solid cell, or -1 if the lane is clear. */
  front(axis: Axis, lane: number, direction: Direction): number {
    return this.fronts[slotOf(axis, direction) * laneStride(axis) + lane];
  }

  /** Linear cell index of that first solid cell, or -1. */
  frontIndex(axis: Axis, lane: number, direction: Direction): number {
    const position = this.front(axis, lane, direction);
    if (position < 0) return NONE;
    return axis === "row" ? lane * WORLD_WIDTH + position : position * WORLD_WIDTH + lane;
  }

  /**
   * Advances any front that was pointing at the cell just destroyed.
   * `colorId` must already hold the hole.
   */
  onDestroyed(colorId: Uint8Array, x: number, y: number): void {
    const rowLeft = ROW_FROM_LEFT * WORLD_HEIGHT + y;
    if (this.fronts[rowLeft] === x) {
      this.fronts[rowLeft] = this.scanRow(colorId, y, x + 1, 1);
    }

    const rowRight = ROW_FROM_RIGHT * WORLD_HEIGHT + y;
    if (this.fronts[rowRight] === x) {
      this.fronts[rowRight] = this.scanRow(colorId, y, x - 1, -1);
    }

    const colTop = COLUMN_FROM_TOP * WORLD_WIDTH + x;
    if (this.fronts[colTop] === y) {
      this.fronts[colTop] = this.scanColumn(colorId, x, y + 1, 1);
    }

    const colBottom = COLUMN_FROM_BOTTOM * WORLD_WIDTH + x;
    if (this.fronts[colBottom] === y) {
      this.fronts[colBottom] = this.scanColumn(colorId, x, y - 1, -1);
    }
  }

  private scanRow(colorId: Uint8Array, y: number, from: number, step: 1 | -1): number {
    const base = y * WORLD_WIDTH;
    for (let x = from; x >= 0 && x < WORLD_WIDTH; x += step) {
      if (colorId[base + x] < this.paletteSize) return x;
    }
    return NONE;
  }

  private scanColumn(colorId: Uint8Array, x: number, from: number, step: 1 | -1): number {
    for (let y = from; y >= 0 && y < WORLD_HEIGHT; y += step) {
      if (colorId[y * WORLD_WIDTH + x] < this.paletteSize) return y;
    }
    return NONE;
  }
}

function slotOf(axis: Axis, direction: Direction): number {
  if (axis === "row") return direction > 0 ? ROW_FROM_LEFT : ROW_FROM_RIGHT;
  return direction > 0 ? COLUMN_FROM_TOP : COLUMN_FROM_BOTTOM;
}

function laneStride(axis: Axis): number {
  return axis === "row" ? WORLD_HEIGHT : WORLD_WIDTH;
}
