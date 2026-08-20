import type { PaletteEntry } from "../core/constants";
import type { ActiveCannonState } from "../cannon/ActiveCannon";
import type { CannonLoad } from "../cannon/CannonLoad";
import type { CannonState } from "../combat/Cannon";
import type { RngAlgorithm } from "../rng/XorShift32";

export const SAVE_SCHEMA_VERSION = 3;

/** Cannon state before the cannon was constrained to the board's edges. */
export interface OrbitalCannonStateV1 {
  angle: number;
  angularSpeed: number;
  radius: number;
}

interface LevelSaveBase {
  profileId: string;
  levelId: string;

  width: number;
  height: number;
  paletteSize: number;
  palette: PaletteEntry[];

  /** Board state. The derived index arrays are deliberately NOT stored. */
  baseColorId: ArrayBuffer;
  colorId: ArrayBuffer;
  hp: ArrayBuffer;
  flags: ArrayBuffer;


  rngAlgorithm: RngAlgorithm;
  rngState: number;
  fractionalCarryByColor: number[];

  createdAtEpochMs: number;
  lastSimulatedAtEpochMs: number;

  /** Metadata only. The source file itself is never persisted. */
  importedImage?: {
    name: string;
    mime: string;
    originalWidth: number;
    originalHeight: number;
  };
}

export interface LevelSaveV1 extends LevelSaveBase {
  schemaVersion: 1;
  cannon: OrbitalCannonStateV1;
}

export interface LevelSaveV2 extends LevelSaveBase {
  schemaVersion: 2;
  cannon: CannonState;
  /** Deck of the periodic-volley model, dropped in v3. */
  deck?: unknown[];
}

export interface LevelSaveV3 extends LevelSaveBase {
  schemaVersion: 3;
  /** Loads waiting in the visible queue. */
  loads: CannonLoad[];
  /** Cannons currently on the rail, with what is left of their stock. */
  cannons: ActiveCannonState[];
}

export type CurrentLevelSave = LevelSaveV3;
export type AnyLevelSave = LevelSaveV1 | LevelSaveV2 | LevelSaveV3;
