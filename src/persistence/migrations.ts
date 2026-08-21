import { CANNON_MOVE_SPEED } from "../cannon/ActiveCannon";
import { PERIMETER } from "../combat/Cannon";
import { DEAD } from "../core/constants";
import {
  SAVE_SCHEMA_VERSION,
  type AnyLevelSave,
  type CurrentLevelSave,
  type LevelSaveV1,
  type LevelSaveV2,
  type LevelSaveV3,
  type LevelSaveV4,
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
  if (current.schemaVersion === 3) current = v3ToV4(current);
  if (current.schemaVersion === 4) current = v4ToV5(current);

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
function v2ToV3(save: LevelSaveV2): LevelSaveV3 {
  const { cannon: _cannon, deck: _deck, ...rest } = save;
  return { ...rest, schemaVersion: 3, loads: [], cannons: [] };
}

/**
 * v4 added upgrades. An older save has bought none, and its fragments are
 * seeded from the pixels it already destroyed — the player keeps what the
 * board says they earned.
 */
function v3ToV4(save: LevelSaveV3): LevelSaveV4 {
  const cells = new Uint8Array(save.colorId);
  let destroyed = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === DEAD) destroyed++;

  return {
    ...save,
    schemaVersion: 4,
    upgrades: { levels: {}, earned: destroyed, spent: 0 },
  };
}

/**
 * v5 removed the fire cadence: every lane crossed is now an opportunity, so a
 * cannon has no `fireIntervalMs` and no cooldown to resume. Those fields are
 * dropped and the cannons come back at the base rail speed — the upgrades in
 * the same save put the bought speed back on them at the first frame.
 *
 * There is no observed destruction rate to inherit either, so the offline model
 * starts from zero and fills in as soon as the level is played again.
 */
function v4ToV5(save: LevelSaveV4): CurrentLevelSave {
  return {
    ...save,
    schemaVersion: 5,
    cannons: save.cannons.map((cannon) => ({
      id: cannon.id,
      colorId: cannon.colorId,
      ammo: cannon.ammo,
      maxAmmo: cannon.maxAmmo,
      trackPosition: cannon.trackPosition,
      moveSpeed: CANNON_MOVE_SPEED,
    })),
    observedRateByColor: [],
  };
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
    "upgrades",
    "observedRateByColor",
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
