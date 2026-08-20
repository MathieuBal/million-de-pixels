import type { ColorId } from "../core/constants";

export type CardModifier = "pierce" | "ricochet" | "split" | "burst";

export interface ColorCard {
  id: string;
  colorId: ColorId;
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

export function makeCard(colorId: ColorId, copy: number): ColorCard {
  return {
    id: `c${colorId}-${copy}`,
    colorId,
    level: 1,
    ballCount: BASE_CARD.ballCount,
    fireIntervalMs: BASE_CARD.fireIntervalMs,
    damage: BASE_CARD.damage,
    speed: BASE_CARD.speed,
    pierce: BASE_CARD.pierce,
    ricochet: BASE_CARD.ricochet,
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
