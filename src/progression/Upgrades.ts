import { CANNON_FIRE_INTERVAL_MS, CANNON_MOVE_SPEED } from "../cannon/ActiveCannon";
import { DEFAULT_LOAD_AMMO } from "../cannon/CannonLoad";
import { VISIBLE_LOADS } from "../cannon/CannonQueue";
import { MAX_ACTIVE_CANNONS } from "../combat/CombatSimulator";

export type UpgradeId =
  | "cadence"
  | "vitesse"
  | "explosion"
  | "canons"
  | "munitions"
  | "cases";

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
 * The six axes a player can push, in two families.
 *
 * Every number here is an opening value to balance, not a rule. What is not
 * negotiable is the shape: the base level is the game as specified — one ball
 * destroys one block, five cannons, forty rounds — and upgrades widen it from
 * there.
 */
export const UPGRADES: UpgradeDefinition[] = [
  {
    id: "cadence",
    family: "canons",
    label: "Cadence",
    glyph: "×2",
    description: "Intervalle entre deux billes",
    maxLevel: 10,
    basePrice: 120,
    priceGrowth: 1.7,
    valueAt: (level) => Math.max(30, Math.round(CANNON_FIRE_INTERVAL_MS * 0.86 ** level)),
    format: (value) => `${value} ms`,
  },
  {
    id: "vitesse",
    family: "canons",
    label: "Vitesse",
    glyph: "⌁",
    description: "Déplacement du canon sur le rail",
    maxLevel: 8,
    basePrice: 150,
    priceGrowth: 1.7,
    valueAt: (level) => Math.round(CANNON_MOVE_SPEED * 1.18 ** level),
    format: (value) => `${value} c/s`,
  },
  {
    id: "explosion",
    family: "canons",
    label: "Explosion",
    glyph: "▦",
    description: "Rayon d'impact, sur la couleur visée",
    maxLevel: 5,
    basePrice: 400,
    priceGrowth: 2.4,
    valueAt: (level) => level,
    format: (value) => (value === 0 ? "1 bloc" : `rayon ${value}`),
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
  fireIntervalMs: number;
  moveSpeed: number;
  blastRadius: number;
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
      fireIntervalMs: valueOf("cadence", this.levelOf("cadence")),
      moveSpeed: valueOf("vitesse", this.levelOf("vitesse")),
      blastRadius: valueOf("explosion", this.levelOf("explosion")),
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
