/**
 * The colour library: a grid of hexes, and what the profile has finished off.
 *
 * Each channel snaps to one of sixteen levels — `0x00`, `0x11`, … `0xFF` — so a
 * hex here is exactly a three-digit CSS shorthand written out: `#000000`,
 * `#1166FF`, `#FFEE33`. That gives **4 096** of them, and the size is the whole
 * point. A book a dozen images could fill is a checklist; a book this size is a
 * reason to go looking for a picture with colours in it you have never cleared.
 * A single toile carries eight to sixteen colours, so it moves the counter by a
 * few tenths of a percent — it can chip at the grid, never validate it.
 *
 * The cube is read as **sixteen planes**, one per red level, each a 16 × 16
 * square of green against blue. That is what keeps four thousand swatches from
 * being a wall of noise: a plane is a page, small enough to finish, and a hole
 * in it says "go find a warmer image" the way a number never would.
 *
 * The six levels of the old web-safe grid are all multiples of `0x11`, so every
 * hex catalogued before this widening is still a hex here. Nothing is lost and
 * no save needs migrating — the same book simply has more pages.
 *
 * A hex is catalogued when a colour that snaps to it is **cleared outright** —
 * the one moment in a run that is unarguably finished: the card leaves the
 * offers, a bottleneck resolves, the counter hits zero and stays there.
 * Cataloguing every colour a single pixel was ever taken from would fill the
 * grid in the first thirty seconds of the first toile.
 */

/** The sixteen levels each channel snaps to: every multiple of 0x11. */
export const HEX_LEVELS = Array.from({ length: 16 }, (_, i) => i * 0x11);

export const LIBRARY_SIZE = HEX_LEVELS.length ** 3;

/** Hexes on one plane of the cube: a page of the book. */
export const PLANE_SIZE = HEX_LEVELS.length ** 2;

/** Planes of the cube, one per red level. */
export const PLANE_COUNT = HEX_LEVELS.length;

/**
 * What one catalogued hex is worth, and why it is worth anything.
 *
 * The library is a record of work already finished, so paying it out as combat
 * power would make it a second upgrade tree with none of the choices. It pays
 * passively instead: what the image is worth, and what an absence produces.
 *
 * A twentieth of a percent each. Fifty images of ordinary play catalogue a few
 * hundred hexes, which is around +15 % — worth having, never worth chasing. The
 * full cube would be +205 %, and nobody is going to see it; a collection needs
 * a last page more than it needs a reachable one.
 */
export const HEX_BONUS = 0.0005;

/**
 * What finishing a whole plane pays on top.
 *
 * Sixteen pages, two percent each. The per-hex trickle is deliberately too
 * small to feel one at a time, so the plane is where the collecting actually
 * lands: two hundred and fifty-six related shades, a page that visibly fills,
 * and a number at the end of it.
 */
export const PLANE_BONUS = 0.02;

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
 * Rows walk red then green, columns walk blue, so the cube reads as sixteen
 * blocks of sixteen rows — related colours sit together and a gap is visible as
 * a gap rather than lost in noise.
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

/** The 256 hexes of one plane, in reading order: green down, blue across. */
export function hexesOfPlane(plane: number): string[] {
  const red = HEX_LEVELS[Math.max(0, Math.min(PLANE_COUNT - 1, plane))];
  const out: string[] = [];
  for (const g of HEX_LEVELS) {
    for (const b of HEX_LEVELS) out.push(hexOf(red, g, b));
  }
  return out;
}

/** How a plane is named to the player: its red level, in hex. */
export function planeLabel(plane: number): string {
  const red = HEX_LEVELS[Math.max(0, Math.min(PLANE_COUNT - 1, plane))];
  return `R ${red.toString(16).padStart(2, "0").toUpperCase()}`;
}

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
  /** Hexes catalogued on one plane of the cube, and how many it holds. */
  planeProgress(plane: number): { found: number; total: number } {
    let found = 0;
    for (const hex of hexesOfPlane(plane)) if (this.found.has(hex)) found++;
    return { found, total: PLANE_SIZE };
  }

  /**
   * The page worth opening: the one holding the most catalogued hexes.
   *
   * Opening on plane zero every time meant that a player who had just finished
   * a toile opened the book on an empty page, because the image's colours
   * happened to live on other red levels. The grid's job is to show what the
   * profile has; it should not have to be searched for first.
   */
  get fullestPlane(): number {
    let best = 0;
    let bestFound = -1;
    for (let plane = 0; plane < PLANE_COUNT; plane++) {
      const { found } = this.planeProgress(plane);
      if (found > bestFound) {
        bestFound = found;
        best = plane;
      }
    }
    return best;
  }

  /** Planes with every hex catalogued. */
  get completePlanes(): number {
    let complete = 0;
    for (let plane = 0; plane < PLANE_COUNT; plane++) {
      if (this.planeProgress(plane).found === PLANE_SIZE) complete++;
    }
    return complete;
  }

  bonus(): LibraryBonus {
    const gain = 1 + this.found.size * HEX_BONUS + this.completePlanes * PLANE_BONUS;
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
