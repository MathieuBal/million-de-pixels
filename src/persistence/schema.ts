import type { PaletteEntry } from "../core/constants";
import type { ColorCard } from "../deck/cards";
import type { CannonState } from "../combat/Cannon";
import type { RngAlgorithm } from "../rng/XorShift32";

export const SAVE_SCHEMA_VERSION = 1;

export interface LevelSaveV1 {
  schemaVersion: 1;

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

  deck: ColorCard[];
  cannon: CannonState;

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

export type AnyLevelSave = LevelSaveV1;
