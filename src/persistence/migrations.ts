import { SAVE_SCHEMA_VERSION, type AnyLevelSave, type LevelSaveV1 } from "./schema";

/**
 * Save migration chain.
 *
 * There is only one version today, but the entry point exists from day one so
 * a v2 never has to guess what an old record meant.
 */
export function migrate(save: AnyLevelSave): LevelSaveV1 {
  if (!save || typeof save !== "object") {
    throw new Error("Save corrompue : objet invalide.");
  }
  if (save.schemaVersion === SAVE_SCHEMA_VERSION) {
    assertShape(save);
    return save;
  }
  throw new Error(`Version de save non supportée : ${(save as { schemaVersion?: unknown }).schemaVersion}`);
}

function assertShape(save: LevelSaveV1): void {
  const required: Array<keyof LevelSaveV1> = [
    "baseColorId",
    "colorId",
    "hp",
    "flags",
    "palette",
    "deck",
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
