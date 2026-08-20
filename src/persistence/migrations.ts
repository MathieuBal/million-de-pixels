import { PERIMETER } from "../combat/Cannon";
import {
  SAVE_SCHEMA_VERSION,
  type AnyLevelSave,
  type CurrentLevelSave,
  type LevelSaveV1,
  type LevelSaveV2,
} from "./schema";

/**
 * Save migration chain.
 *
 * Each step upgrades one version, so an old record is walked forward rather
 * than guessed at. A save that cannot be recognised is rejected loudly instead
 * of being loaded half-interpreted.
 */
export function migrate(save: AnyLevelSave): CurrentLevelSave {
  if (!save || typeof save !== "object") {
    throw new Error("Save corrompue : objet invalide.");
  }

  let current: AnyLevelSave = save;
  if (current.schemaVersion === 1) current = v1ToV2(current);
  if (current.schemaVersion === 2) current = v2ToV3(current);

  if (current.schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new Error(
      `Version de save non supportée : ${(save as { schemaVersion?: unknown }).schemaVersion}`,
    );
  }

  assertShape(current);
  return current;
}

/**
 * v1 stored an orbital cannon (angle, angular speed, radius). v2 keeps it on
 * the board's edge, so the orbit angle is reinterpreted as a position along the
 * perimeter — the cannon resumes roughly where the player left it.
 */
function v1ToV2(save: LevelSaveV1): LevelSaveV2 {
  const { cannon, ...rest } = save;
  const turns = (cannon?.angle ?? 0) / (Math.PI * 2);
  const position = ((turns % 1) + 1) % 1 * PERIMETER;

  return {
    ...rest,
    schemaVersion: 2,
    cannon: { position, speed: 220 },
  };
}

/**
 * v2 carried a deck of cards feeding one permanent cannon. v3 replaced that
 * with disposable cannons drawn from a queue, so the old deck has no meaning
 * and no equivalent: the board is preserved, the rail restarts empty and the
 * queue refills itself from the pixels that are still there.
 */
function v2ToV3(save: LevelSaveV2): CurrentLevelSave {
  const { cannon: _cannon, deck: _deck, ...rest } = save;
  return { ...rest, schemaVersion: 3, loads: [], cannons: [] };
}

function assertShape(save: CurrentLevelSave): void {
  const required: Array<keyof CurrentLevelSave> = [
    "baseColorId",
    "colorId",
    "hp",
    "flags",
    "palette",
    "loads",
    "cannons",
  ];
  for (const key of required) {
    if (save[key] === undefined || save[key] === null) {
      throw new Error(`Save corrompue : champ manquant "${String(key)}".`);
    }
  }

  const expected = save.width * save.height;
  for (const key of ["baseColorId", "colorId", "hp", "flags"] as const) {
    const buffer = save[key];
    if (buffer.byteLength !== expected) {
      throw new Error(
        `Save corrompue : ${key} fait ${buffer.byteLength} octets, attendu ${expected}.`,
      );
    }
  }
}
