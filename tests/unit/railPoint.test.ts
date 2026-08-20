import { describe, expect, it } from "vitest";
import { railPoint } from "../../src/ui/GameScreen";
import { PERIMETER, aimAt } from "../../src/combat/Cannon";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../src/core/constants";

const W = 390;
const H = 390;

describe("rail token projection", () => {
  it("starts at the top-left corner", () => {
    expect(railPoint(0, W, H)).toEqual({ x: 0, y: 0 });
  });

  it("runs clockwise through the four corners", () => {
    expect(railPoint(WORLD_WIDTH, W, H)).toEqual({ x: W, y: 0 });
    expect(railPoint(WORLD_WIDTH + WORLD_HEIGHT, W, H)).toEqual({ x: W, y: H });
    expect(railPoint(2 * WORLD_WIDTH + WORLD_HEIGHT, W, H)).toEqual({ x: 0, y: H });
  });

  it("wraps back to the start after a full lap", () => {
    expect(railPoint(PERIMETER, W, H)).toEqual(railPoint(0, W, H));
  });

  it("handles a negative position", () => {
    const point = railPoint(-10, W, H);
    expect(point.x).toBe(0);
    expect(point.y).toBeGreaterThan(0);
  });

  it("never leaves the ring", () => {
    for (let p = 0; p < PERIMETER; p += 37) {
      const point = railPoint(p, W, H);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(W);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(H);
      // A rail point always lies on an edge, never inside the board.
      const onEdge =
        point.x === 0 || point.y === 0 || point.x === W || point.y === H;
      expect(onEdge).toBe(true);
    }
  });

  it("puts the token on the same edge as the barrel it belongs to", () => {
    // The DOM ring and the simulation must agree, or a token drifts away from
    // the cannon it labels.
    for (let p = 0; p < PERIMETER; p += 53) {
      const aim = aimAt(p);
      const point = railPoint(p, W, H);

      if (aim.axis === "column" && aim.direction > 0) expect(point.y).toBe(0);
      if (aim.axis === "row" && aim.direction < 0) expect(point.x).toBe(W);
      if (aim.axis === "column" && aim.direction < 0) expect(point.y).toBe(H);
      if (aim.axis === "row" && aim.direction > 0) expect(point.x).toBe(0);
    }
  });

  it("places a token proportionally along its edge", () => {
    const quarter = railPoint(WORLD_WIDTH / 4, W, H);
    expect(quarter.x).toBeCloseTo(W / 4, 6);
    expect(quarter.y).toBe(0);
  });
});
