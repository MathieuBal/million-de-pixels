import { rarityOf, type PaletteEntry } from "../../src/core/constants";

/**
 * Builds a palette for tests, deriving share and rarity from the counts so
 * fixtures stay consistent with what the image worker actually produces.
 */
export function makePalette(size: number, counts: number[] = []): PaletteEntry[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return Array.from({ length: size }, (_, id) => {
    const count = counts[id] ?? 0;
    const share = total === 0 ? 0 : count / total;
    return {
      id,
      r: (id * 37) % 256,
      g: (id * 91) % 256,
      b: (id * 53) % 256,
      a: 255,
      count,
      share,
      rarity: rarityOf(share),
    };
  });
}
