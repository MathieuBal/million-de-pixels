import type { ColorId, ColorRarity } from "../core/constants";

export type CardModifier = "pierce" | "ricochet" | "split" | "burst";

export interface ColorCard {
  id: string;
  colorId: ColorId;
  /** Rarity of the colour this card targets, not of the card itself. */
  rarity: ColorRarity;
  level: number;

  /** Balls fired per volley. Beyond `LOGICAL_BURST_THRESHOLD` they go batched. */
  ballCount: number;
  fireIntervalMs: number;

  damage: number;
  speed: number;

  pierce: number;
  ricochet: number;

  /** Extra logical hits applied per volley without spawning a projectile. */
  logicalBurst: number;

  modifiers: CardModifier[];

  /** Set when the card's colour is exhausted: it may then target any colour. */
  prismatic: boolean;
}

/**
 * Opening power level. Every number here is a balancing knob: `pierce` is how
 * many matching cells one ball carves out on its way across the board, which is
 * what makes a fresh deck visibly eat into the image instead of scratching it.
 */
export const BASE_CARD = {
  ballCount: 4,
  fireIntervalMs: 600,
  damage: 1,
  speed: 900,
  pierce: 8,
  ricochet: 1,
  logicalBurst: 0,
} as const;

/**
 * What a colour's scarcity is worth on the card that targets it.
 *
 * The image's own chromatic rarity becomes the deck's rarity: a colour that
 * covers 0.3% of the level is a scarce resource, and the card that spends it
 * hits proportionately harder. Opening values, to calibrate.
 */
export const RARITY_BONUS: Record<ColorRarity, {
  damage: number;
  ricochet: number;
  pierce: number;
}> = {
  commune: { damage: 1, ricochet: 0, pierce: 0 },
  "peu-commune": { damage: 1, ricochet: 0, pierce: 1 },
  rare: { damage: 2, ricochet: 1, pierce: 2 },
  exotique: { damage: 3, ricochet: 2, pierce: 4 },
};

export function makeCard(
  colorId: ColorId,
  copy: number,
  rarity: ColorRarity = "commune",
): ColorCard {
  const bonus = RARITY_BONUS[rarity];
  return {
    id: `c${colorId}-${copy}`,
    colorId,
    rarity,
    level: 1,
    ballCount: BASE_CARD.ballCount,
    fireIntervalMs: BASE_CARD.fireIntervalMs,
    damage: BASE_CARD.damage * bonus.damage,
    speed: BASE_CARD.speed,
    pierce: BASE_CARD.pierce + bonus.pierce,
    ricochet: BASE_CARD.ricochet + bonus.ricochet,
    logicalBurst: BASE_CARD.logicalBurst,
    modifiers: [],
    prismatic: false,
  };
}

/** One upgrade step. Growth is multiplicative so late cards can go batched. */
export function upgradeCard(card: ColorCard): ColorCard {
  const level = card.level + 1;
  return {
    ...card,
    level,
    ballCount: Math.min(64, Math.round(card.ballCount * 1.35)),
    fireIntervalMs: Math.max(80, Math.round(card.fireIntervalMs * 0.88)),
    damage: card.damage,
    pierce: card.pierce + (level % 3 === 0 ? 1 : 0),
    ricochet: card.ricochet + (level % 4 === 0 ? 1 : 0),
    logicalBurst: level >= 6 ? Math.round(card.logicalBurst * 1.6 + 8) : card.logicalBurst,
    modifiers:
      level >= 6 && !card.modifiers.includes("burst")
        ? [...card.modifiers, "burst"]
        : card.modifiers,
  };
}
