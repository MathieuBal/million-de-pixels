import type { PaletteEntry } from "../core/constants";
import type { ActiveCannonState } from "../cannon/ActiveCannon";
import type { CannonLoad } from "../cannon/CannonLoad";
import type { UpgradeLevels } from "../progression/Upgrades";
import type { CannonState } from "../combat/Cannon";
import type { RngAlgorithm } from "../rng/XorShift32";

export const SAVE_SCHEMA_VERSION = 5;

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

interface RailSaveBase extends LevelSaveBase {
  /** Loads waiting in the visible queue. */
  loads: CannonLoad[];
  /** Cannons currently on the rail, with what is left of their stock. */
  cannons: ActiveCannonState[];
}

export interface LevelSaveV3 extends RailSaveBase {
  schemaVersion: 3;
}

export interface LevelSaveV4 extends RailSaveBase {
  schemaVersion: 4;
  /**
   * Upgrades are scoped to the level, so they live in its save. A new image
   * starts from the base values and nothing needs a meta-progression store.
   */
  upgrades: { levels: UpgradeLevels; earned: number; spent: number };
}

export interface LevelSaveV5 extends RailSaveBase {
  schemaVersion: 5;
  upgrades: { levels: UpgradeLevels; earned: number; spent: number };
  /**
   * Pixels per second measured per colour when the tab was left.
   *
   * The offline catch-up used to derive production from each cannon's fire
   * interval. There is no fire interval any more — the rail is the clock, and
   * what a cannon actually removes depends on how much of its colour the
   * surface exposes. Nothing short of running the simulation predicts that, so
   * the model uses what was observed rather than a formula that would be wrong
   * in both directions.
   */
  observedRateByColor: number[];
}

export type CurrentLevelSave = LevelSaveV5;
export type AnyLevelSave =
  | LevelSaveV1
  | LevelSaveV2
  | LevelSaveV3
  | LevelSaveV4
  | LevelSaveV5;
