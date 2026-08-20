/**
 * Axis-aligned grid traversal.
 *
 * The cannon patrols the border of the board and always fires perpendicular to
 * the edge it sits on, so every shot walks exactly one row or one column. That
 * turns the traversal into a fixed-stride scan: the cell index advances by a
 * constant (±1 along a row, ±width along a column) with no incremental error
 * terms, no per-cell comparison of two `tMax` accumulators, and no floating
 * point at all inside the loop.
 *
 * Clipping collapses to clamping the start and end positions, since the ray can
 * never leave the board sideways.
 */
export type Axis = "row" | "column";
export type Direction = 1 | -1;

export type CellVisitor = (x: number, y: number, index: number) => boolean;

/** Number of cells along `axis`. A row spans the width, a column the height. */
export function axisLength(axis: Axis, width: number, height: number): number {
  return axis === "row" ? width : height;
}

/** Number of distinct lanes for `axis`: one per row, or one per column. */
export function laneCount(axis: Axis, width: number, height: number): number {
  return axis === "row" ? height : width;
}

/**
 * Visits the cells of one lane between `fromCell` and `toCell` (inclusive),
 * in travel order. Both bounds are clamped to the board, so callers may pass
 * positions from outside it. Returns true when the visitor stopped the scan.
 */
export function traverseAxis(
  axis: Axis,
  lane: number,
  direction: Direction,
  fromCell: number,
  toCell: number,
  width: number,
  height: number,
  visit: CellVisitor,
): boolean {
  if (lane < 0 || lane >= laneCount(axis, width, height)) return false;

  const size = axisLength(axis, width, height);
  const last = size - 1;

  let from: number;
  let to: number;

  if (direction > 0) {
    if (toCell < 0 || fromCell > last) return false; // segment misses the board
    from = fromCell < 0 ? 0 : fromCell;
    to = toCell > last ? last : toCell;
    if (to < from) return false;
  } else {
    if (fromCell < 0 || toCell > last) return false;
    from = fromCell > last ? last : fromCell;
    to = toCell < 0 ? 0 : toCell;
    if (to > from) return false;
  }

  const isRow = axis === "row";
  const stride = isRow ? direction : direction * width;

  let index = isRow ? lane * width + from : from * width + lane;
  const steps = (direction > 0 ? to - from : from - to) + 1;

  let position = from;
  for (let step = 0; step < steps; step++) {
    if (visit(isRow ? position : lane, isRow ? lane : position, index)) return true;
    index += stride;
    position += direction;
  }

  return false;
}
