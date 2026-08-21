import { describe, expect, it } from "vitest";
import { resolveLaneBurst } from "../../src/combat/LineBurst";
import { aimAt } from "../../src/combat/Cannon";
import { PixelWorld } from "../../src/world/PixelWorld";
import { DEAD, PIXEL_COUNT, VOID, WORLD_WIDTH } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

/** A board that is VOID everywhere except one row, written left to right. */
function rowWorld(pattern: number[], paletteSize = 3): PixelWorld {
  const colorId = new Uint8Array(PIXEL_COUNT).fill(VOID);
  const counts = new Array(paletteSize).fill(0);
  for (let x = 0; x < pattern.length; x++) {
    colorId[x] = pattern[x];
    counts[pattern[x]]++;
  }
  return PixelWorld.create(makePalette(paletteSize, counts), colorId);
}

/** Row 0, approached from the left. */
const FROM_LEFT = aimAt(2 * WORLD_WIDTH + 1024 + 1023);

function readRow(world: PixelWorld, length: number): string {
  let out = "";
  for (let x = 0; x < length; x++) {
    const cell = world.colorId[x];
    out += cell === DEAD ? "." : String(cell);
  }
  return out;
}

describe("resolveLaneBurst", () => {
  it("peels the exposed run and stops at the obstacle", () => {
    // R R R B R, red cannon with 10 rounds → . . . B R, 3 spent.
    const world = rowWorld([0, 0, 0, 1, 0]);
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 10 }, FROM_LEFT);

    expect(readRow(world, 5)).toBe("...10");
    expect(burst.destroyed).toBe(3);
  });

  it("never destroys a foreign colour", () => {
    const world = rowWorld([1, 1, 0, 0]);
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 10 }, FROM_LEFT);

    expect(burst.destroyed).toBe(0);
    expect(readRow(world, 4)).toBe("1100");
  });

  it("stops when the stock runs out mid-run", () => {
    const world = rowWorld([0, 0, 0, 0, 0]);
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 2 }, FROM_LEFT);

    expect(burst.destroyed).toBe(2);
    expect(readRow(world, 5)).toBe("..000");
  });

  it("spends nothing on a lane with nothing left", () => {
    const world = rowWorld([]);
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 40 }, FROM_LEFT);

    expect(burst.destroyed).toBe(0);
    expect(burst.firstIndex).toBe(-1);
  });

  it("crosses the holes an earlier burst left", () => {
    const world = rowWorld([0, 0, 1, 0, 0]);
    resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 40 }, FROM_LEFT);
    expect(readRow(world, 5)).toBe("..100");

    // Clearing the obstacle exposes the depth behind it.
    world.destroy(2);
    const second = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 40 }, FROM_LEFT);
    expect(second.destroyed).toBe(2);
    expect(readRow(world, 5)).toBe(".....");
  });

  it("reports the span it removed", () => {
    const world = rowWorld([0, 0, 0, 1]);
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 40 }, FROM_LEFT);

    expect(burst.firstIndex).toBe(0);
    expect(burst.lastIndex).toBe(2);
    expect(burst.lane).toBe(FROM_LEFT.lane);
    expect(burst.axis).toBe("row");
  });

  it("peels from the other side when approached from the right", () => {
    const world = rowWorld([0, 1, 0, 0]);
    const fromRight = aimAt(WORLD_WIDTH); // right edge, row 0
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo: 40 }, fromRight);

    // Only the run exposed on the right is reachable.
    expect(burst.destroyed).toBe(2);
    expect(readRow(world, 4)).toBe("01..");
  });

  it("keeps the ammunition ledger honest", () => {
    const world = rowWorld([0, 0, 0, 0]);
    let ammo = 3;
    const burst = resolveLaneBurst(world, { id: "c", colorId: 0, ammo }, FROM_LEFT);
    ammo -= burst.destroyed;

    expect(ammo).toBe(0);
    expect(world.destroyedCount()).toBe(3);
  });
});
