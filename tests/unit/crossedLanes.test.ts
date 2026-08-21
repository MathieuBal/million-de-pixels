import { describe, expect, it } from "vitest";
import { PERIMETER, aimAt, crossedLanes } from "../../src/combat/Cannon";

function lanes(from: number, distance: number) {
  return [...crossedLanes(from, distance)].map((aim) => `${aim.axis}:${aim.lane}:${aim.direction}`);
}

describe("crossedLanes", () => {
  it("yields nothing when the cannon has not moved", () => {
    expect(lanes(100, 0)).toEqual([]);
    expect(lanes(100, -5)).toEqual([]);
  });

  it("yields every integer position covered, in order", () => {
    expect(lanes(10.2, 3)).toEqual([
      `${aimAt(11).axis}:11:1`,
      `${aimAt(12).axis}:12:1`,
      `${aimAt(13).axis}:13:1`,
    ]);
  });

  it("yields one lane when a step crosses exactly one boundary", () => {
    expect(lanes(10.5, 1)).toHaveLength(1);
  });

  it("visits the same lanes whatever the frame rate", () => {
    // The invariant the whole refactor rests on: same simulated time, same
    // starting point, same lanes — however many steps were used to get there.
    const speed = 977; // cells per second, upgraded
    const seconds = 0.4;

    const oneStep = lanes(37.3, speed * seconds);

    const split = (frames: number) => {
      const out: string[] = [];
      let position = 37.3;
      const step = (speed * seconds) / frames;
      for (let i = 0; i < frames; i++) {
        out.push(...lanes(position, step));
        position += step;
      }
      return out;
    };

    expect(split(12)).toEqual(oneStep); // 30 FPS
    expect(split(24)).toEqual(oneStep); // 60 FPS
    expect(split(48)).toEqual(oneStep); // 120 FPS
  });

  it("never examines fewer lanes when the cannon goes faster", () => {
    for (const seconds of [0.1, 0.5, 1]) {
      let previous = 0;
      for (const speed of [260, 504, 977, 1500]) {
        const count = [...crossedLanes(0, speed * seconds)].length;
        expect(count).toBeGreaterThanOrEqual(previous);
        previous = count;
      }
    }
  });

  it("crosses corners without losing a lane", () => {
    // A step straddling the top-right corner must cover both edges.
    const around = [...crossedLanes(1020, 8)];
    expect(around.map((a) => a.axis)).toContain("column");
    expect(around.map((a) => a.axis)).toContain("row");
    expect(around).toHaveLength(8);
  });

  it("covers a full lap exactly once", () => {
    const lap = [...crossedLanes(0, PERIMETER)];
    expect(lap).toHaveLength(PERIMETER);
    const seen = new Set(lap.map((a) => `${a.axis}:${a.lane}:${a.direction}`));
    expect(seen.size).toBe(PERIMETER);
  });

  it("never yields more than a lap, however large the step", () => {
    expect([...crossedLanes(0, PERIMETER * 9)]).toHaveLength(PERIMETER);
  });

  it("wraps past the end of the perimeter", () => {
    const wrapped = [...crossedLanes(PERIMETER - 2, 4)];
    expect(wrapped).toHaveLength(4);
    // Landing back at the top-left corner means a column lane going down.
    expect(wrapped.some((a) => a.axis === "column" && a.lane === 0)).toBe(true);
  });

  it("handles a negative starting position", () => {
    expect(() => [...crossedLanes(-500, 10)]).not.toThrow();
    expect([...crossedLanes(-500, 10)]).toHaveLength(10);
  });
});
