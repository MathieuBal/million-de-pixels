import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { SaveRepository } from "../../src/persistence/SaveRepository";
import { migrate } from "../../src/persistence/migrations";
import {
  SAVE_SCHEMA_VERSION,
  type CurrentLevelSave,
  type LevelSaveV1,
} from "../../src/persistence/schema";
import { makeCard } from "../../src/deck/cards";
import { PERIMETER } from "../../src/combat/Cannon";
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
    deck: [makeCard(0, 0), makeCard(1, 0)],
    cannon: { position: 1200, speed: 220 },
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
    expect(loaded!.deck).toHaveLength(2);
    expect(loaded!.cannon.position).toBeCloseTo(1200, 10);
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

  it("migrates a v1 orbital cannon onto the perimeter", () => {
    const { cannon: _ignored, ...rest } = makeSave();
    const v1: LevelSaveV1 = {
      ...rest,
      schemaVersion: 1,
      cannon: { angle: Math.PI, angularSpeed: 0.35, radius: 800 },
    };

    const migrated = migrate(v1);
    expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    // Half a turn of the old orbit lands halfway along the perimeter.
    expect(migrated.cannon.position).toBeCloseTo(PERIMETER / 2, 6);
    expect(migrated.cannon.speed).toBeGreaterThan(0);
  });

  it("keeps the board buffers intact through a v1 migration", () => {
    const { cannon: _ignored, ...rest } = makeSave();
    const v1: LevelSaveV1 = {
      ...rest,
      schemaVersion: 1,
      cannon: { angle: 0, angularSpeed: 0.35, radius: 800 },
    };
    const migrated = migrate(v1);
    expect(migrated.colorId.byteLength).toBe(CELLS);
    expect(migrated.deck).toHaveLength(2);
  });

  it("rejects a save whose buffers do not match its dimensions", () => {
    const broken = makeSave({ colorId: new Uint8Array(16).buffer });
    expect(() => migrate(broken)).toThrow(/Save corrompue/);
  });

  it("rejects a save missing a required field", () => {
    const broken = makeSave();
    delete (broken as Partial<CurrentLevelSave>).deck;
    expect(() => migrate(broken)).toThrow(/champ manquant/);
  });

  it("rejects a non-object record", () => {
    expect(() => migrate(null as never)).toThrow(/objet invalide/);
  });
});
