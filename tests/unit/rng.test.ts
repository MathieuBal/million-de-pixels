import { describe, expect, it } from "vitest";
import { XorShift32 } from "../../src/rng/XorShift32";

describe("XorShift32", () => {
  it("produces a stable golden sequence for a known seed", () => {
    const rng = new XorShift32(0x12345678);
    const sequence = Array.from({ length: 8 }, () => rng.nextU32());
    // Locked in: a change here silently invalidates every existing save.
    expect(sequence).toEqual([
      2274908837, 358294691, 1210119364, 2176035992, 1882851208, 698933837, 2311737117,
      3306712617,
    ]);
  });

  it("replays identically from a snapshot", () => {
    const rng = new XorShift32(42);
    for (let i = 0; i < 100; i++) rng.nextU32();
    const state = rng.snapshot();

    const expected = Array.from({ length: 10 }, () => rng.nextU32());
    const resumed = new XorShift32(state);
    expect(Array.from({ length: 10 }, () => resumed.nextU32())).toEqual(expected);
  });

  it("never gets stuck on the zero state", () => {
    const rng = new XorShift32(0);
    expect(rng.nextU32()).not.toBe(0);
  });

  it("keeps nextInt inside the requested range", () => {
    const rng = new XorShift32(2024);
    for (let i = 0; i < 10_000; i++) {
      const value = rng.nextInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it("rejects a non positive bound", () => {
    expect(() => new XorShift32(1).nextInt(0)).toThrow(RangeError);
  });
});
