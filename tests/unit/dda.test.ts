import { describe, expect, it } from "vitest";
import { traverseGridDDA } from "../../src/combat/dda";
import { clipSegmentToGrid } from "../../src/combat/clip";

const W = 16;
const H = 16;

function collect(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  traverseGridDDA(x0, y0, x1, y1, W, H, (x, y) => {
    cells.push([x, y]);
    return false;
  });
  return cells;
}

describe("DDA grid traversal", () => {
  it("walks a horizontal ray left to right in order", () => {
    const cells = collect(0.5, 4.5, 5.5, 4.5);
    expect(cells).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
      [5, 4],
    ]);
  });

  it("reverses the order for a right-to-left ray", () => {
    const cells = collect(5.5, 4.5, 0.5, 4.5);
    expect(cells.map(([x]) => x)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("handles a vertical ray without dividing by zero", () => {
    const cells = collect(3.5, 0.5, 3.5, 4.5);
    expect(cells).toEqual([
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
    ]);
  });

  it("uses a stable diagonal policy on exact corners", () => {
    const cells = collect(0.0, 0.0, 5.0, 5.0);
    expect(cells).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
  });

  it("skips no cell on a shallow slope", () => {
    const cells = collect(0.1, 0.1, 15.9, 3.9);
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i][0] - cells[i - 1][0]);
      const dy = Math.abs(cells[i][1] - cells[i - 1][1]);
      expect(dx + dy).toBeLessThanOrEqual(2);
      expect(dx).toBeLessThanOrEqual(1);
      expect(dy).toBeLessThanOrEqual(1);
    }
    expect(cells[0]).toEqual([0, 0]);
    expect(cells.at(-1)).toEqual([15, 3]);
  });

  it("visits exactly one cell for a zero-length segment", () => {
    expect(collect(7.25, 2.75, 7.25, 2.75)).toEqual([[7, 2]]);
  });

  it("never yields a duplicate cell", () => {
    const cells = collect(0.3, 15.7, 15.7, 0.3);
    const seen = new Set(cells.map(([x, y]) => `${x},${y}`));
    expect(seen.size).toBe(cells.length);
  });

  it("stops cleanly when the visitor absorbs the ray", () => {
    const cells: Array<[number, number]> = [];
    const stopped = traverseGridDDA(0.5, 0.5, 15.5, 0.5, W, H, (x, y) => {
      cells.push([x, y]);
      return x === 3;
    });
    expect(stopped).toBe(true);
    expect(cells).toHaveLength(4);
  });

  it("does not tunnel through the grid at very high speed", () => {
    const clipped = clipSegmentToGrid({ x0: -900, y0: 8.5, x1: 900, y1: 8.5 }, W, H);
    expect(clipped).not.toBeNull();
    const cells = collect(clipped!.x0, clipped!.y0, clipped!.x1, clipped!.y1);
    expect(cells).toHaveLength(W);
  });
});

describe("segment clipping", () => {
  it("clips a ray entering the grid from the outside", () => {
    const clipped = clipSegmentToGrid({ x0: -10, y0: 8, x1: 8, y1: 8 }, W, H);
    expect(clipped).not.toBeNull();
    expect(clipped!.x0).toBeCloseTo(0, 6);
    expect(clipped!.x1).toBeCloseTo(8, 6);
  });

  it("rejects a segment that never touches the grid", () => {
    expect(clipSegmentToGrid({ x0: -10, y0: -10, x1: -1, y1: -1 }, W, H)).toBeNull();
    expect(clipSegmentToGrid({ x0: 5, y0: 100, x1: 9, y1: 200 }, W, H)).toBeNull();
  });

  it("keeps a segment ending exactly on the far edge inside the last cell", () => {
    const clipped = clipSegmentToGrid({ x0: 0, y0: 0, x1: 32, y1: 0 }, W, H);
    expect(clipped).not.toBeNull();
    expect(Math.floor(clipped!.x1)).toBe(W - 1);
  });

  it("passes an already contained segment through untouched", () => {
    const segment = { x0: 2.5, y0: 3.5, x1: 9.5, y1: 11.5 };
    expect(clipSegmentToGrid(segment, W, H)).toEqual(segment);
  });
});
