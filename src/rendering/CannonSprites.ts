import type { Axis, Direction } from "../combat/axisTraversal";

/**
 * The cannon, as cells.
 *
 * One cell of the sprite is one cell of the board, at the same scale, so the
 * cannon cannot clash with the imported image — it is made of the same stuff.
 * That is the whole direction: no vector art laid over a pixel field.
 *
 * Each character is a role, not a colour, because three of them depend on the
 * cannon rather than on the sprite: `a` is the accent, `c` is the colour this
 * cannon is aimed at, and `m` is a gauge segment that is lit or spent.
 */
export type SpriteRole = "k" | "d" | "b" | "l" | "a" | "c" | "m" | ".";

/** Fixed parts of the palette. The rest comes from the cannon. */
export const SPRITE_COLORS: Record<"k" | "d" | "b" | "l" | "dark", number> = {
  k: 0x0c0c10,
  d: 0x191920,
  b: 0x2e2e38,
  l: 0x45454f,
  dark: 0x15151b,
};

/** A spent gauge segment. Present, and visibly empty. */
export const GAUGE_SPENT = 0x23232b;

export interface CannonSprite {
  /** Rows top to bottom, as written: the muzzle points up. */
  rows: string[];
  width: number;
  height: number;
}

function sprite(rows: string[]): CannonSprite {
  return { rows, width: rows[0].length, height: rows.length };
}

/**
 * Three tiers, and the promise each one makes.
 *
 * The tier is read off what the player bought, so the silhouette is the only
 * upgrade feedback that does not need a number: a wider base means a longer
 * gauge, two barrels mean two lanes swept per pass.
 */
export const CANNON_TIERS: CannonSprite[] = [
  sprite([
    "....k....",
    "...kak...",
    "...kak...",
    "..kkakk..",
    ".kblalbk.",
    "kbbcccbbk",
    "kbmmmmmbk",
    "kkkkkkkkk",
    ".d.....d.",
  ]),
  sprite([
    ".....k.....",
    "....kak....",
    "....kak....",
    "...kkakk...",
    "..kblalbk..",
    ".kbblblbbk.",
    "kbbcccccbbk",
    "kbmmmmmmmbk",
    "kkkkkkkkkkk",
    ".dd.....dd.",
  ]),
  sprite([
    "...k.....k...",
    "..kak...kak..",
    "..kak...kak..",
    "..kak...kak..",
    ".kkakkkkkakk.",
    ".kblaaaaalbk.",
    "kbblbbbbbblbk",
    "kbcccccccccbk",
    "kbmmmmmmmmmbk",
    "kkkkkkkkkkkkk",
    ".dd.......dd.",
  ]),
];

/** Magazine sizes at which the silhouette changes. Opening values. */
export const TIER_THRESHOLDS = [0, 300, 900];

export function tierFor(maxAmmo: number): number {
  let tier = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (maxAmmo >= TIER_THRESHOLDS[i]) tier = i;
  }
  return tier;
}

/**
 * Turns the sprite so the muzzle points into the board.
 *
 * The cannon runs the perimeter and pivots with the side it is on. Written
 * rows point up, which is what a cannon on the *bottom* edge needs; every other
 * side is a quarter turn from there. The rotation is exact — the grid is
 * re-indexed, never interpolated — so a corner is crossed in one frame, with no
 * in-between orientation that would smear the pixels.
 */
export function orient(sprite: CannonSprite, axis: Axis, direction: Direction): CannonSprite {
  // A row lane approached from the left fires rightwards: the muzzle points +x.
  const quarterTurns =
    axis === "row" ? (direction > 0 ? 1 : 3) : direction > 0 ? 2 : 0;
  return rotate(sprite, quarterTurns);
}

/** Quarter turns clockwise. */
export function rotate(sprite: CannonSprite, quarterTurns: number): CannonSprite {
  let current = sprite;
  for (let turn = ((quarterTurns % 4) + 4) % 4; turn > 0; turn--) {
    const rows: string[] = [];
    for (let x = 0; x < current.width; x++) {
      let row = "";
      for (let y = current.height - 1; y >= 0; y--) row += current.rows[y][x];
      rows.push(row);
    }
    current = { rows, width: rows[0].length, height: rows.length };
  }
  return current;
}

export interface CannonPaint {
  /** Board cell of the top-left corner of the oriented sprite. */
  x: number;
  y: number;
  /** One entry per non-empty cell, in reading order. */
  cells: Array<{ x: number; y: number; color: number }>;
}

export interface CannonLook {
  accent: number;
  /** The colour this cannon is aimed at. Ignored in the finale. */
  target: number;
  ammo: number;
  maxAmmo: number;
  /** No gauge, no band: the economy stopped counting. */
  unlimited?: boolean;
  /** Lapped without peeling anything: everything goes grey. */
  idle?: boolean;
}

/**
 * Paints one cannon.
 *
 * The two readings that must never cost effort are the colour band across the
 * base and the gauge right under it — segments that go out, never a number. A
 * round is only ever spent on a pixel that actually died, so the gauge cannot
 * lie about what is left to peel.
 */
export function paint(
  sprite: CannonSprite,
  look: CannonLook,
  originX: number,
  originY: number,
): CannonPaint {
  const cells: CannonPaint["cells"] = [];
  const grey = look.idle === true;

  const accent = grey ? 0x5a5a66 : look.accent;
  const band = look.unlimited ? accent : grey ? 0x4a4a55 : look.target;
  const lit = look.maxAmmo > 0 ? look.ammo / look.maxAmmo : 0;

  for (let row = 0; row < sprite.height; row++) {
    // The gauge is one row: how many of its cells are lit is the whole reading.
    const line = sprite.rows[row];
    const segments = countRole(line, "m");
    const alight = Math.ceil(segments * lit);
    let seen = 0;

    for (let col = 0; col < sprite.width; col++) {
      const role = line[col] as SpriteRole;
      if (role === ".") continue;

      let color: number;
      switch (role) {
        case "a":
          color = accent;
          break;
        case "c":
          color = band;
          break;
        case "m":
          color = look.unlimited ? accent : seen++ < alight ? accent : GAUGE_SPENT;
          break;
        default:
          color = SPRITE_COLORS[role];
      }

      cells.push({ x: originX + col, y: originY + row, color });
    }
  }

  return { x: originX, y: originY, cells };
}

function countRole(row: string, role: string): number {
  let count = 0;
  for (const ch of row) if (ch === role) count++;
  return count;
}
