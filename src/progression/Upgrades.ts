import { CANNON_MOVE_SPEED } from "../cannon/ActiveCannon";
import { DEFAULT_LOAD_AMMO } from "../cannon/CannonLoad";
import { VISIBLE_LOADS } from "../cannon/CannonQueue";
import { MAX_ACTIVE_CANNONS } from "../combat/CombatSimulator";
import { NO_PERMANENT_BONUS, type PermanentBonus } from "./MetaProgression";

export type UpgradeId = "vitesse" | "canons" | "munitions" | "cases" | "gain" | "veille";

export type UpgradeFamily = "rail" | "cases" | "economie";

export const FAMILY_LABELS: Record<UpgradeFamily, string> = {
  rail: "Rail",
  cases: "Cases",
  economie: "Économie",
};

export const FAMILY_ORDER: UpgradeFamily[] = ["rail", "cases", "economie"];

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
 * opportunity, so cells per second are lanes examined per second.
 *
 * **Long tracks, small steps.** Every axis runs ten times as many levels as it
 * first did, each worth roughly a tenth as much, with the price growing at the
 * matching tenth-root. The ceilings end up higher than before, but that is a
 * side effect: the point is that there is always a next level within reach, and
 * that no axis quietly stops being buyable halfway through a pass.
 *
 * Every number here is an opening value to balance, not a rule.
 */
export const UPGRADES: UpgradeDefinition[] = [
  {
    id: "vitesse",
    family: "rail",
    label: "Vitesse",
    glyph: "⌁",
    description: "Voies examinées par seconde",
    maxLevel: 150,
    basePrice: 120,
    priceGrowth: 1.035,
    valueAt: (level) => Math.round(CANNON_MOVE_SPEED * 1.015 ** level),
    format: (value) => `${value} voies/s`,
  },
  {
    id: "canons",
    family: "rail",
    label: "Rail",
    glyph: "+1",
    description: "Canons simultanés sur le rail",
    maxLevel: 50,
    basePrice: 600,
    priceGrowth: 1.082,
    valueAt: (level) => MAX_ACTIVE_CANNONS + level,
    format: (value) => `${value} canons`,
  },
  {
    id: "munitions",
    family: "cases",
    label: "Chargeur",
    glyph: "◲",
    description: "Billes par case",
    maxLevel: 100,
    basePrice: 200,
    priceGrowth: 1.055,
    valueAt: (level) => DEFAULT_LOAD_AMMO + level * 12,
    format: (value) => `${value} billes`,
  },
  {
    id: "cases",
    family: "cases",
    label: "Étal",
    glyph: "▤",
    description: "Cases proposées",
    maxLevel: 40,
    basePrice: 350,
    priceGrowth: 1.072,
    valueAt: (level) => VISIBLE_LOADS + level,
    format: (value) => `${value} cases`,
  },

  // --- Économie ---------------------------------------------------------
  {
    id: "gain",
    family: "economie",
    label: "Alliage",
    glyph: "◈",
    description: "Fragments par pixel détruit",
    maxLevel: 120,
    basePrice: 300,
    priceGrowth: 1.048,
    valueAt: (level) => 1 + level * 0.05,
    format: (value) => `×${value.toFixed(2)} / px`,
  },
  {
    id: "veille",
    family: "economie",
    label: "Veille",
    glyph: "☾",
    description: "Production pendant l'absence",
    maxLevel: 80,
    basePrice: 450,
    priceGrowth: 1.06,
    valueAt: (level) => 1 + level * 0.075,
    format: (value) => `×${value.toFixed(2)} hors-ligne`,
  },

];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

export interface UpgradeEffects {
  moveSpeed: number;
  maxActiveCannons: number;
  ammoPerLoad: number;
  visibleLoads: number;
  /** Fragments a destroyed pixel is worth. */
  fragmentsPerPixel: number;
  /** Multiplier on what the offline catch-up produces. */
  offlineMultiplier: number;
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
  /** Négoce, from the profile. 1 is the undiscounted price. */
  private priceMultiplier = 1;

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

  /**
   * The profile's shop discount. Applied at the price rather than at the
   * balance so the player sees what they are getting: the number on the button
   * is the number Négoce changed.
   */
  setPriceMultiplier(multiplier: number): void {
    this.priceMultiplier = Math.max(0.01, multiplier);
  }

  /** Cost of the next level, or null when the axis is maxed out. */
  priceOf(id: UpgradeId): number | null {
    const definition = UPGRADE_BY_ID.get(id);
    if (!definition || this.isMaxed(id)) return null;
    const full = definition.basePrice * definition.priceGrowth ** this.levelOf(id);
    return Math.max(1, Math.round(full * this.priceMultiplier));
  }

  /** The cheapest axis still worth buying, or null. Emplette runs on this. */
  cheapestAffordable(): UpgradeId | null {
    let best: UpgradeId | null = null;
    let bestPrice = Number.POSITIVE_INFINITY;
    for (const definition of UPGRADES) {
      const price = this.priceOf(definition.id);
      if (price === null || price > this.balance || price >= bestPrice) continue;
      best = definition.id;
      bestPrice = price;
    }
    return best;
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

  effects(bonus: PermanentBonus = NO_PERMANENT_BONUS): UpgradeEffects {
    return {
      moveSpeed: Math.round(valueOf("vitesse", this.levelOf("vitesse")) * bonus.speedMultiplier),
      maxActiveCannons: valueOf("canons", this.levelOf("canons")) + bonus.extraCannons,
      ammoPerLoad: Math.round(valueOf("munitions", this.levelOf("munitions")) * bonus.ammoMultiplier),
      visibleLoads: valueOf("cases", this.levelOf("cases")),
      fragmentsPerPixel: valueOf("gain", this.levelOf("gain")) * bonus.fragmentMultiplier,
      offlineMultiplier: valueOf("veille", this.levelOf("veille")) * bonus.offlineMultiplier,
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
