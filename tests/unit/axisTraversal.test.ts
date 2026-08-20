import { describe, expect, it } from "vitest";
import { axisLength, laneCount, traverseAxis } from "../../src/combat/axisTraversal";

const W = 16;
const H = 12;

function collect(
  axis: "row" | "column",
  lane: number,
  direction: 1 | -1,
  from: number,
  to: number,
): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  traverseAxis(axis, lane, direction, from, to, W, H, (x, y, index) => {
    cells.push([x, y, index]);
    return false;
  });
  return cells;
}

describe("axis traversal", () => {
  it("walks a row left to right in order", () => {
    const cells = collect("row", 4, 1, 0, 3);
    expect(cells.map(([x, y]) => [x, y])).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ]);
  });

  it("reverses the order for a right-to-left row", () => {
    expect(collect("row", 4, -1, 3, 0).map(([x]) => x)).toEqual([3, 2, 1, 0]);
  });

  it("walks a column top to bottom", () => {
    expect(collect("column", 5, 1, 0, 3).map(([, y]) => y)).toEqual([0, 1, 2, 3]);
  });

  it("reverses the order for a bottom-to-top column", () => {
    expect(collect("column", 5, -1, 3, 0).map(([, y]) => y)).toEqual([3, 2, 1, 0]);
  });

  it("computes the linear index with a constant stride", () => {
    expect(collect("row", 2, 1, 0, 2).map(([, , i]) => i)).toEqual([32, 33, 34]);
    expect(collect("column", 2, 1, 0, 2).map(([, , i]) => i)).toEqual([2, 18, 34]);
  });

  it("visits exactly one cell when both bounds are equal", () => {
    expect(collect("row", 7, 1, 9, 9)).toHaveLength(1);
    expect(collect("column", 7, -1, 9, 9)).toHaveLength(1);
  });

  it("clamps a segment that starts before the board", () => {
    const cells = collect("row", 3, 1, -500, 2);
    expect(cells.map(([x]) => x)).toEqual([0, 1, 2]);
  });

  it("clamps a segment that overshoots the far edge", () => {
    expect(collect("row", 3, 1, 14, 900).map(([x]) => x)).toEqual([14, 15]);
    expect(collect("column", 3, -1, 900, -900).map(([, y]) => y)).toHaveLength(H);
  });

  it("never yields a cell when the segment misses the board entirely", () => {
    expect(collect("row", 3, 1, -50, -10)).toHaveLength(0);
    expect(collect("row", 3, 1, 40, 90)).toHaveLength(0);
    expect(collect("row", 3, -1, -50, -90)).toHaveLength(0);
  });

  it("yields nothing when the segment runs against its own direction", () => {
    expect(collect("row", 3, 1, 8, 2)).toHaveLength(0);
    expect(collect("row", 3, -1, 2, 8)).toHaveLength(0);
  });

  it("rejects a lane outside the board", () => {
    expect(collect("row", -1, 1, 0, 5)).toHaveLength(0);
    expect(collect("row", H, 1, 0, 5)).toHaveLength(0);
    expect(collect("column", W, 1, 0, 5)).toHaveLength(0);
  });

  it("stops cleanly when the visitor absorbs the shot", () => {
    const seen: number[] = [];
    const stopped = traverseAxis("row", 1, 1, 0, 15, W, H, (x) => {
      seen.push(x);
      return x === 3;
    });
    expect(stopped).toBe(true);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("never skips or duplicates a cell across a full lane", () => {
    const cells = collect("row", 6, 1, 0, W - 1);
    expect(cells.map(([x]) => x)).toEqual([...Array(W).keys()]);
    expect(new Set(cells.map(([, , i]) => i)).size).toBe(W);
  });

  it("reports lane and axis sizes", () => {
    expect(axisLength("row", W, H)).toBe(W);
    expect(axisLength("column", W, H)).toBe(H);
    expect(laneCount("row", W, H)).toBe(H);
    expect(laneCount("column", W, H)).toBe(W);
  });
});
