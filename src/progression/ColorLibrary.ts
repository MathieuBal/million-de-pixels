/**
 * The colour library: a grid of hexes, and what the profile has finished off.
 *
 * Each channel is snapped to one of six levels, which gives the 216 hexes of
 * the old web-safe palette — `#000000`, `#003366`, `#FF6699` and so on. That
 * number is the point: a collection needs a denominator. Exact values would
 * give thousands of near-identical entries and a book with no last page, which
 * is the opposite of what a collection is for.
 *
 * A hex is catalogued when a colour that snaps to it is **cleared outright** —
 * the one moment in a run that is unarguably finished: the card leaves the
 * offers, a bottleneck resolves, the counter hits zero and stays there.
 * Cataloguing every colour a single pixel was ever taken from would fill the
 * grid in the first thirty seconds of the first toile.
 */

/** The six levels each channel snaps to. */
export const HEX_LEVELS = [0x00, 0x33, 0x66, 0x99, 0xcc, 0xff];

export const LIBRARY_SIZE = HEX_LEVELS.length ** 3;

/**
 * What one catalogued hex is worth, and why it is worth anything.
 *
 * The library is a record of work already finished, so paying it out as combat
 * power would make it a second upgrade tree with none of the choices. It pays
 * passively instead: what the image is worth, and what an absence produces.
 * A full grid is +32 % on both — real, and never the reason to play.
 */
export const HEX_BONUS = 0.0015;

export interface LibraryBonus {
  fragmentMultiplier: number;
  offlineMultiplier: number;
}

export interface Specimen {
  /** The colour exactly as it was on the board where it was first finished. */
  r: number;
  g: number;
  b: number;
  /** Pixels of this hex destroyed across every toile. */
  pixels: number;
  /** Times a colour of this hex was cleared outright. */
  clears: number;
}

export type LibrarySnapshot = Record<string, Specimen>;

/** Snaps one channel to the grid. */
export function snapChannel(value: number): number {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  let best = HEX_LEVELS[0];
  let bestDistance = Infinity;
  for (const level of HEX_LEVELS) {
    const distance = Math.abs(level - clamped);
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** The hex a colour belongs to, as `#RRGGBB` upper case. */
export function hexOf(r: number, g: number, b: number): string {
  const pair = (value: number) => snapChannel(value).toString(16).padStart(2, "0");
  return `#${pair(r)}${pair(g)}${pair(b)}`.toUpperCase();
}

/**
 * Every hex of the grid, in reading order.
 *
 * Rows walk red then green, columns walk blue, so the grid reads as six blocks
 * of six rows — related colours sit together and a gap is visible as a gap
 * rather than lost in noise.
 */
export const LIBRARY_HEXES: string[] = (() => {
  const out: string[] = [];
  for (const r of HEX_LEVELS) {
    for (const g of HEX_LEVELS) {
      for (const b of HEX_LEVELS) out.push(hexOf(r, g, b));
    }
  }
  return out;
})();

export class ColorLibrary {
  private readonly found: Map<string, Specimen>;

  constructor(snapshot: LibrarySnapshot = {}) {
    this.found = new Map(Object.entries(snapshot));
  }

  get discovered(): number {
    return this.found.size;
  }

  get completion(): number {
    return this.found.size / LIBRARY_SIZE;
  }

  has(hex: string): boolean {
    return this.found.has(hex);
  }

  specimen(hex: string): Specimen | null {
    return this.found.get(hex) ?? null;
  }

  /** What the grid pays, passively, for what it already holds. */
  bonus(): LibraryBonus {
    const gain = 1 + this.found.size * HEX_BONUS;
    return { fragmentMultiplier: gain, offlineMultiplier: gain };
  }

  /** Records a cleared colour. Returns the hex if it had never been seen. */
  record(colour: { r: number; g: number; b: number; count: number }): string | null {
    const hex = hexOf(colour.r, colour.g, colour.b);
    const existing = this.found.get(hex);

    if (existing) {
      existing.pixels += colour.count;
      existing.clears++;
      return null;
    }

    // The swatch keeps the first specimen: a colour that was really on a board,
    // not the grid value it was filed under.
    this.found.set(hex, { r: colour.r, g: colour.g, b: colour.b, pixels: colour.count, clears: 1 });
    return hex;
  }

  serialize(): LibrarySnapshot {
    return Object.fromEntries(this.found);
  }

  static restore(snapshot?: LibrarySnapshot): ColorLibrary {
    return new ColorLibrary(snapshot ?? {});
  }
}
