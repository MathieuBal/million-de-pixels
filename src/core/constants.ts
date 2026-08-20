/** Dimensions of the logical board. The promise of the game is one million cells. */
export const WORLD_WIDTH = 1024;
export const WORLD_HEIGHT = 1024;
export const PIXEL_COUNT = WORLD_WIDTH * WORLD_HEIGHT; // 1_048_576

/** Reserved cell values. Palette ids always live in 0..MAX_PALETTE_SIZE-1. */
export const VOID = 254;
export const DEAD = 255;

/** Candidate range explored by the automatic palette analyzer. */
export const MIN_PALETTE_SIZE = 4;
export const MAX_PALETTE_SIZE = 16;

/**
 * Gameplay rarity of a colour, derived from its share of the level.
 *
 * A colour covering 0.3% of the image is 3 000-odd pixels: not noise to be
 * discarded, but a scarce resource. The deck reads this to decide which cards
 * are exotic.
 */
export type ColorRarity = "commune" | "peu-commune" | "rare" | "exotique";

export const RARITY_THRESHOLDS: Array<{ minShare: number; rarity: ColorRarity }> = [
  { minShare: 0.1, rarity: "commune" },
  { minShare: 0.03, rarity: "peu-commune" },
  { minShare: 0.01, rarity: "rare" },
  { minShare: 0, rarity: "exotique" },
];

export function rarityOf(share: number): ColorRarity {
  for (const tier of RARITY_THRESHOLDS) {
    if (share >= tier.minShare) return tier.rarity;
  }
  return "exotique";
}

/** Alpha below this threshold turns a source pixel into a VOID (non playable) cell. */
export const DEFAULT_ALPHA_THRESHOLD = 16;

/** Macro tiles used to skip empty regions during area effects. */
export const MACRO_TILE_SIZE = 32;
export const MACRO_TILES_X = WORLD_WIDTH / MACRO_TILE_SIZE; // 32
export const MACRO_TILES_Y = WORLD_HEIGHT / MACRO_TILE_SIZE; // 32
export const MACRO_TILE_COUNT = MACRO_TILES_X * MACRO_TILES_Y; // 1024

export type ColorId = number;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PaletteEntry extends Rgb {
  id: ColorId;
  a: number;
  count: number;
  /** Share of the playable pixels, in [0, 1]. */
  share: number;
  rarity: ColorRarity;
}

export function isPlayableColor(value: number): boolean {
  return value < MAX_PALETTE_SIZE;
}
