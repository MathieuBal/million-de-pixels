import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { SaveRepository } from "../../src/persistence/SaveRepository";
import { migrate } from "../../src/persistence/migrations";
import { SAVE_SCHEMA_VERSION, type CurrentLevelSave } from "../../src/persistence/schema";
import { RNG_ALGORITHM } from "../../src/rng/XorShift32";
import type { PaletteEntry } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

const W = 32;
const H = 32;
const CELLS = W * H;

function palette(): PaletteEntry[] {
  return makePalette(2, [CELLS / 2, CELLS / 2]);
}

function makeSave(overrides: Partial<CurrentLevelSave> = {}): CurrentLevelSave {
  const colorId = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) colorId[i] = i % 2;

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    profileId: "local",
    levelId: "level-1",
    width: W,
    height: H,
    paletteSize: 2,
    palette: palette(),
    baseColorId: colorId.slice().buffer,
    colorId: colorId.buffer,
    hp: new Uint8Array(CELLS).fill(1).buffer,
    flags: new Uint8Array(CELLS).buffer,
    loads: [
      { id: "load-1", colorId: 0, ammo: 40 },
      { id: "load-2", colorId: 1, ammo: 40 },
    ],
    cannons: [
      {
        id: "load-0",
        colorId: 0,
        ammo: 17,
        maxAmmo: 40,
        trackPosition: 1200,
        moveSpeed: 260,
        fireIntervalMs: 140,
        fireCooldownMs: 0,
      },
    ],
    rngAlgorithm: RNG_ALGORITHM,
    rngState: 123456,
    fractionalCarryByColor: [0.25, 0.75],
    createdAtEpochMs: 1_700_000_000_000,
    lastSimulatedAtEpochMs: 1_700_000_100_000,
    ...overrides,
  };
}

describe("SaveRepository", () => {
  let repo: SaveRepository;

  beforeEach(() => {
    repo = new SaveRepository();
  });

  it("round-trips a level byte for byte", async () => {
    const save = makeSave({ levelId: `level-${Math.random()}` });
    const original = new Uint8Array(save.colorId.slice(0));

    await repo.putLevel(save);
    const loaded = await repo.getLevel("local", save.levelId);

    expect(loaded).not.toBeNull();
    expect(new Uint8Array(loaded!.colorId)).toEqual(original);
    expect(loaded!.rngState).toBe(save.rngState);
    expect(loaded!.fractionalCarryByColor).toEqual(save.fractionalCarryByColor);
    expect(loaded!.loads).toHaveLength(2);
    expect(loaded!.cannons).toHaveLength(1);
    expect(loaded!.cannons[0].ammo).toBe(17);
    expect(loaded!.cannons[0].trackPosition).toBeCloseTo(1200, 10);
  });

  it("returns null for an unknown level", async () => {
    expect(await repo.getLevel("local", "does-not-exist")).toBeNull();
  });

  it("overwrites a level on re-save rather than duplicating it", async () => {
    const save = makeSave({ levelId: "stable" });
    await repo.putLevel(save);
    await repo.putLevel(makeSave({ levelId: "stable", rngState: 999 }));

    const levels = await repo.listLevels("local");
    expect(levels.filter((l) => l.levelId === "stable")).toHaveLength(1);
    expect((await repo.getLevel("local", "stable"))!.rngState).toBe(999);
  });

  it("deletes a level", async () => {
    await repo.putLevel(makeSave({ levelId: "temp" }));
    await repo.deleteLevel("local", "temp");
    expect(await repo.getLevel("local", "temp")).toBeNull();
  });

  it("stores and reads settings", async () => {
    await repo.setSetting("paletteSize", 12);
    expect(await repo.getSetting<number>("paletteSize")).toBe(12);
    expect(await repo.getSetting("missing")).toBeNull();
  });
});

describe("save migration", () => {
  it("accepts a current save unchanged", () => {
    const save = makeSave();
    expect(migrate(save)).toBe(save);
  });

  it("rejects an unknown schema version", () => {
    expect(() => migrate({ ...makeSave(), schemaVersion: 99 } as never)).toThrow(/non supportée/);
  });

  it("walks a v1 save all the way to the current version", () => {
    const { loads: _l, cannons: _c, ...rest } = makeSave();
    const v1 = {
      ...rest,
      schemaVersion: 1 as const,
      cannon: { angle: Math.PI, angularSpeed: 0.35, radius: 800 },
      deck: [{ id: "old-card", colorId: 0 }],
    };

    const migrated = migrate(v1 as never);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    // The board survives; the old deck has no equivalent and the rail restarts.
    expect(migrated.colorId.byteLength).toBe(CELLS);
    expect(migrated.loads).toEqual([]);
    expect(migrated.cannons).toEqual([]);
    expect("cannon" in migrated).toBe(false);
    expect("deck" in migrated).toBe(false);
  });

  it("drops the v2 deck without touching the board", () => {
    const { loads: _l, cannons: _c, ...rest } = makeSave();
    const v2 = {
      ...rest,
      schemaVersion: 2 as const,
      cannon: { position: 900, speed: 220 },
      deck: [{ id: "old-card", colorId: 1 }],
    };

    const migrated = migrate(v2 as never);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(migrated.loads).toEqual([]);
    expect(migrated.cannons).toEqual([]);
    expect(new Uint8Array(migrated.colorId)).toHaveLength(CELLS);
  });

  it("rejects a save whose buffers do not match its dimensions", () => {
    const broken = makeSave({ colorId: new Uint8Array(16).buffer });
    expect(() => migrate(broken)).toThrow(/Save corrompue/);
  });

  it("rejects a save missing a required field", () => {
    const broken = makeSave();
    delete (broken as Partial<CurrentLevelSave>).loads;
    expect(() => migrate(broken)).toThrow(/champ manquant/);
  });

  it("rejects a non-object record", () => {
    expect(() => migrate(null as never)).toThrow(/objet invalide/);
  });
});
