export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Liang-Barsky clip of a segment against [0,width) x [0,height).
 *
 * The cannon orbits outside the board, so a shot must be clipped before the
 * DDA runs — otherwise the traversal would either start out of bounds or burn
 * its step budget walking towards the grid.
 *
 * The max bound is nudged inward by one ulp-ish epsilon so a segment ending
 * exactly on the far edge still floors into the last valid cell.
 */
const EDGE_EPSILON = 1e-9;

export function clipSegmentToGrid(
  segment: Segment,
  width: number,
  height: number,
): Segment | null {
  const { x0, y0, x1, y1 } = segment;
  const dx = x1 - x0;
  const dy = y1 - y0;

  let tMin = 0;
  let tMax = 1;

  const maxX = width - EDGE_EPSILON;
  const maxY = height - EDGE_EPSILON;

  const tests: Array<[number, number]> = [
    [-dx, x0 - 0],
    [dx, maxX - x0],
    [-dy, y0 - 0],
    [dy, maxY - y0],
  ];

  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null; // parallel and outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tMax) return null;
      if (t > tMin) tMin = t;
    } else {
      if (t < tMin) return null;
      if (t < tMax) tMax = t;
    }
  }

  return {
    x0: x0 + dx * tMin,
    y0: y0 + dy * tMin,
    x1: x0 + dx * tMax,
    y1: y0 + dy * tMax,
  };
}
