import { describe, expect, it } from "vitest";
import { simulateOffline, type OfflineModelInput } from "../../src/idle/OfflineModel";
import { DEAD, VOID } from "../../src/core/constants";

const SIZE = 40_000;
const PALETTE = 4;

function board(): { colorId: Uint8Array; hp: Uint8Array } {
  const colorId = new Uint8Array(SIZE);
  const hp = new Uint8Array(SIZE).fill(1);
  for (let i = 0; i < SIZE; i++) {
    colorId[i] = i % 10 === 0 ? VOID : i % PALETTE;
  }
  return { colorId, hp };
}

function input(overrides: Partial<OfflineModelInput> = {}): OfflineModelInput {
  const { colorId, hp } = board();
  return {
    colorId,
    hp,
    paletteSize: PALETTE,
    elapsedMs: 60_000,
    maxOfflineMs: 8 * 60 * 60 * 1000,
    damagePerSecondByColor: [10, 5, 2.5, 1.25],
    fractionalCarryByColor: [0, 0, 0, 0],
    rngState: 0x2468ace0,
    ...overrides,
  };
}

function checksum(buffer: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

describe("offline simulation", () => {
  it("destroys the analytically expected number of pixels", () => {
    const result = simulateOffline(input());
    // 60 s at 10/5/2.5/1.25 hits per second.
    expect(Array.from(result.removedByColor)).toEqual([600, 300, 150, 75]);
    expect(result.totalDestroyed).toBe(1125);
  });

  it("really deletes pixels rather than moving a counter", () => {
    const state = input();
    const before = state.colorId.filter((c) => c < PALETTE).length;
    const result = simulateOffline(state);
    const after = state.colorId.filter((c) => c < PALETTE).length;
    expect(before - after).toBe(result.totalDestroyed);
    expect(state.colorId.filter((c) => c === DEAD).length).toBe(result.totalDestroyed);
  });

  it("produces byte-identical output for identical inputs", () => {
    const a = input();
    const b = input();
    const ra = simulateOffline(a);
    const rb = simulateOffline(b);
    expect(checksum(a.colorId)).toBe(checksum(b.colorId));
    expect(ra.rngState).toBe(rb.rngState);
    expect(ra.totalDestroyed).toBe(rb.totalDestroyed);
  });

  it("matches one long catch-up against many short ones", () => {
    const single = input({ elapsedMs: 8 * 60 * 60 * 1000 });
    const singleResult = simulateOffline(single);

    const chunked = input();
    let carry = chunked.fractionalCarryByColor;
    let rngState = chunked.rngState;
    let destroyed = 0;
    for (let hour = 0; hour < 8; hour++) {
      const result = simulateOffline({
        ...chunked,
        elapsedMs: 60 * 60 * 1000,
        fractionalCarryByColor: carry,
        rngState,
      });
      carry = result.fractionalCarryByColor;
      rngState = result.rngState;
      destroyed += result.totalDestroyed;
    }

    expect(destroyed).toBe(singleResult.totalDestroyed);
    expect(checksum(chunked.colorId)).toBe(checksum(single.colorId));
  });

  it("carries the sub-hit remainder instead of losing it", () => {
    const state = input({ elapsedMs: 100, damagePerSecondByColor: [4, 0, 0, 0] });
    const first = simulateOffline(state);
    expect(first.removedByColor[0]).toBe(0);
    expect(first.fractionalCarryByColor[0]).toBeCloseTo(0.4, 6);

    const second = simulateOffline({
      ...state,
      fractionalCarryByColor: first.fractionalCarryByColor,
      rngState: first.rngState,
    });
    // 0.4 + 0.4 still rounds down, but the third slice crosses the whole hit.
    expect(second.removedByColor[0]).toBe(0);
    const third = simulateOffline({
      ...state,
      fractionalCarryByColor: second.fractionalCarryByColor,
      rngState: second.rngState,
    });
    expect(third.removedByColor[0]).toBe(1);
  });

  it("caps the absence at maxOfflineMs", () => {
    const state = input({ elapsedMs: 48 * 60 * 60 * 1000, maxOfflineMs: 60_000 });
    const result = simulateOffline(state);
    expect(result.elapsedAppliedMs).toBe(60_000);
    expect(result.totalDestroyed).toBe(1125);
  });

  it("treats a negative elapsed (clock moved back) as zero", () => {
    const result = simulateOffline(input({ elapsedMs: -5_000_000 }));
    expect(result.elapsedAppliedMs).toBe(0);
    expect(result.totalDestroyed).toBe(0);
  });

  it("never creates a pixel and never touches VOID", () => {
    const state = input({ elapsedMs: 60 * 60 * 1000 });
    const voidBefore = state.colorId.filter((c) => c === VOID).length;
    simulateOffline(state);
    expect(state.colorId.filter((c) => c === VOID).length).toBe(voidBefore);
    expect(state.colorId.filter((c) => c < PALETTE).length).toBeLessThanOrEqual(SIZE);
  });

  it("spills unspent hits onto the colours that are still alive", () => {
    // Colour 0 runs out long before the absence ends; the surplus must not be
    // silently dropped or the night would stall on an empty bucket.
    const state = input({
      elapsedMs: 60 * 60 * 1000,
      damagePerSecondByColor: [1000, 0, 0, 0],
    });
    const result = simulateOffline(state);
    expect(state.colorId.filter((c) => c === 0).length).toBe(0);
    expect(result.removedByColor[1] + result.removedByColor[2] + result.removedByColor[3]).toBeGreaterThan(0);
  });

  it("stops cleanly when the board is fully cleared", () => {
    const state = input({
      elapsedMs: 24 * 60 * 60 * 1000,
      maxOfflineMs: 24 * 60 * 60 * 1000,
      damagePerSecondByColor: [10_000, 10_000, 10_000, 10_000],
    });
    const result = simulateOffline(state);
    expect(state.colorId.filter((c) => c < PALETTE).length).toBe(0);
    expect(result.totalDestroyed).toBe(SIZE - state.colorId.filter((c) => c === VOID).length);
  });
});
