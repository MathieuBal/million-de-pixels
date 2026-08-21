import { CANNON_MOVE_SPEED } from "../cannon/ActiveCannon";
import { DEFAULT_LOAD_AMMO } from "../cannon/CannonLoad";
import { VISIBLE_LOADS } from "../cannon/CannonQueue";
import { MAX_ACTIVE_CANNONS } from "../combat/CombatSimulator";

export type UpgradeId = "vitesse" | "canons" | "munitions" | "cases";

export type UpgradeFamily = "canons" | "cases";

export interface UpgradeDefinition {
  id: UpgradeId;
  family: UpgradeFamily;
  label: string;
  /** Short glyph for the booster row. Characters, never emoji. */
  glyph: string;
  description: string;
  maxLevel: number;
  basePrice: number;
  priceGrowth: number;
  /** Value at a given level, and how to write it for the player. */
  valueAt: (level: number) => number;
  format: (value: number) => string;
}

/**
 * The four axes a player can push, in two families.
 *
 * Speed leads, because the rail is the clock: every lane a cannon crosses is an
 * opportunity, so cells per second are lanes examined per second. Many small
 * steps rather than a few large ones — the player should feel the rail turn
 * faster often.
 *
 * Every number here is an opening value to balance, not a rule.
 */
export const UPGRADES: UpgradeDefinition[] = [
  {
    id: "vitesse",
    family: "canons",
    label: "Vitesse",
    glyph: "⌁",
    description: "Voies examinées par seconde",
    maxLevel: 15,
    basePrice: 120,
    priceGrowth: 1.45,
    valueAt: (level) => Math.round(CANNON_MOVE_SPEED * 1.08 ** level),
    format: (value) => `${value} voies/s`,
  },
  {
    id: "canons",
    family: "canons",
    label: "Rail",
    glyph: "+1",
    description: "Canons simultanés sur le rail",
    maxLevel: 5,
    basePrice: 600,
    priceGrowth: 2.2,
    valueAt: (level) => MAX_ACTIVE_CANNONS + level,
    format: (value) => `${value} canons`,
  },
  {
    id: "munitions",
    family: "cases",
    label: "Chargeur",
    glyph: "◲",
    description: "Billes par case",
    maxLevel: 10,
    basePrice: 200,
    priceGrowth: 1.8,
    valueAt: (level) => DEFAULT_LOAD_AMMO + level * 25,
    format: (value) => `${value} billes`,
  },
  {
    id: "cases",
    family: "cases",
    label: "Étal",
    glyph: "▤",
    description: "Cases proposées",
    maxLevel: 4,
    basePrice: 350,
    priceGrowth: 2.0,
    valueAt: (level) => VISIBLE_LOADS + level,
    format: (value) => `${value} cases`,
  },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

export interface UpgradeEffects {
  moveSpeed: number;
  maxActiveCannons: number;
  ammoPerLoad: number;
  visibleLoads: number;
}

/**
 * What the player has bought, and what it is worth.
 *
 * Fragments are destroyed pixels: the image pays for its own destruction, so
 * pushing an axis is always funded by the progress it accelerates. Scope is one
 * level — a new image starts from the base values, and none of this needs a
 * meta-progression to exist.
 */
export class UpgradeState {
  private readonly levels: Map<UpgradeId, number>;
  private earned: number;
  private spent: number;

  constructor(levels: UpgradeLevels = {}, earned = 0, spent = 0) {
    this.levels = new Map(UPGRADES.map((u) => [u.id, levels[u.id] ?? 0]));
    this.earned = earned;
    this.spent = spent;
  }

  /** Fragments still available to spend. */
  get balance(): number {
    return Math.max(0, this.earned - this.spent);
  }

  get totalEarned(): number {
    return this.earned;
  }

  levelOf(id: UpgradeId): number {
    return this.levels.get(id) ?? 0;
  }

  isMaxed(id: UpgradeId): boolean {
    const definition = UPGRADE_BY_ID.get(id);
    return definition ? this.levelOf(id) >= definition.maxLevel : true;
  }

  /** Cost of the next level, or null when the axis is maxed out. */
  priceOf(id: UpgradeId): number | null {
    const definition = UPGRADE_BY_ID.get(id);
    if (!definition || this.isMaxed(id)) return null;
    return Math.round(definition.basePrice * definition.priceGrowth ** this.levelOf(id));
  }

  canAfford(id: UpgradeId): boolean {
    const price = this.priceOf(id);
    return price !== null && price <= this.balance;
  }

  /** Buys one level. Returns false when maxed out or too expensive. */
  buy(id: UpgradeId): boolean {
    const price = this.priceOf(id);
    if (price === null || price > this.balance) return false;
    this.spent += price;
    this.levels.set(id, this.levelOf(id) + 1);
    return true;
  }

  /** One destroyed pixel is one fragment. */
  earn(fragments: number): void {
    this.earned += fragments;
  }

  effects(): UpgradeEffects {
    return {
      moveSpeed: valueOf("vitesse", this.levelOf("vitesse")),
      maxActiveCannons: valueOf("canons", this.levelOf("canons")),
      ammoPerLoad: valueOf("munitions", this.levelOf("munitions")),
      visibleLoads: valueOf("cases", this.levelOf("cases")),
    };
  }

  serialize(): { levels: UpgradeLevels; earned: number; spent: number } {
    const levels: UpgradeLevels = {};
    for (const [id, level] of this.levels) if (level > 0) levels[id] = level;
    return { levels, earned: this.earned, spent: this.spent };
  }

  static restore(state?: {
    levels?: UpgradeLevels;
    earned?: number;
    spent?: number;
  }): UpgradeState {
    return new UpgradeState(state?.levels ?? {}, state?.earned ?? 0, state?.spent ?? 0);
  }
}

function valueOf(id: UpgradeId, level: number): number {
  return UPGRADE_BY_ID.get(id)!.valueAt(level);
}
