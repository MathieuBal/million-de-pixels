import { CANNON_MOVE_SPEED } from "../cannon/ActiveCannon";
import { DEFAULT_LOAD_AMMO } from "../cannon/CannonLoad";
import { VISIBLE_LOADS } from "../cannon/CannonQueue";
import { MAX_ACTIVE_CANNONS } from "../combat/CombatSimulator";
import type { EffectLoadout } from "../combat/SpecialEffects";
import { NO_PERMANENT_BONUS, type PermanentBonus } from "./MetaProgression";

export type UpgradeId =
  | "vitesse"
  | "canons"
  | "munitions"
  | "cases"
  | "gain"
  | "veille"
  | "salve"
  | "jumeau"
  // Automatisme — l'automate et son délai
  | "automate"
  | "cadence"
  | "emplette"
  // Capacités — chacune un déblocage, puis ses propres réglages
  | "perce"
  | "perceProc"
  | "pointe"
  | "explosion"
  | "explosionProc"
  | "souffle"
  | "foudre"
  | "foudreProc"
  | "chaine"
  | "feu"
  | "feuProc"
  | "brasier";

export type UpgradeFamily = "rail" | "cases" | "economie" | "automatisme" | "capacites";

export const FAMILY_LABELS: Record<UpgradeFamily, string> = {
  rail: "Rail",
  cases: "Cases",
  economie: "Économie",
  automatisme: "Automatisme",
  capacites: "Capacités",
};

export const FAMILY_ORDER: UpgradeFamily[] = [
  "rail",
  "cases",
  "economie",
  "automatisme",
  "capacites",
];

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
  /**
   * Axes that must be bought first. An axis whose parents are unbought is shown
   * as a locked row rather than hidden: "here is the next thing to want" is the
   * reason the shop has doors at all.
   */
  requires?: UpgradeId[];
  /** Value at a given level, and how to write it for the player. */
  valueAt: (level: number) => number;
  format: (value: number) => string;
}

/**
 * How long the automaton waits between two launches, before any upgrade.
 *
 * Eight seconds: enough that tapping is still worth it, little enough that
 * leaving the phone on the table finally does something. The whole point of
 * moving the automaton into the toile's own shop is that a run should idle from
 * its first minutes rather than after seven hours of profile — measured, before
 * this: the automaton was a permanent node bought on the sixth toile, and the
 * toile after it fell from fifty-eight minutes to seven. The entire difficulty
 * of the game was one purchase.
 */
export const AUTO_LAUNCH_BASE_MS = 8000;

/** Floor on that delay: below this, a launch a frame is not a delay any more. */
export const AUTO_LAUNCH_FLOOR_MS = 250;

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
    maxLevel: 400,
    basePrice: 120,
    priceGrowth: 1.028,
    valueAt: (level) => Math.round(CANNON_MOVE_SPEED * 1.011 ** level),
    format: (value) => `${value} voies/s`,
  },
  {
    id: "canons",
    family: "rail",
    label: "Rail",
    glyph: "+1",
    description: "Canons simultanés sur le rail",
    maxLevel: 150,
    basePrice: 600,
    priceGrowth: 1.055,
    valueAt: (level) => MAX_ACTIVE_CANNONS + level,
    format: (value) => `${value} canons`,
  },
  {
    id: "munitions",
    family: "cases",
    label: "Chargeur",
    glyph: "◲",
    description: "Billes par case",
    maxLevel: 300,
    basePrice: 200,
    priceGrowth: 1.035,
    valueAt: (level) => DEFAULT_LOAD_AMMO + level * 12,
    format: (value) => `${value} billes`,
  },
  {
    id: "cases",
    family: "cases",
    label: "Étal",
    glyph: "▤",
    description: "Cases proposées",
    maxLevel: 120,
    basePrice: 350,
    priceGrowth: 1.05,
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
    maxLevel: 400,
    basePrice: 300,
    priceGrowth: 1.03,
    valueAt: (level) => 1 + level * 0.05,
    format: (value) => `×${value.toFixed(2)} / px`,
  },
  {
    id: "veille",
    family: "economie",
    label: "Veille",
    glyph: "☾",
    description: "Production pendant l'absence",
    maxLevel: 250,
    basePrice: 450,
    priceGrowth: 1.04,
    valueAt: (level) => 1 + level * 0.075,
    format: (value) => `×${value.toFixed(2)} hors-ligne`,
  },

  // Two axes that buy a *chance* rather than a number. They are the answer to
  // hitting a ceiling: a percentage has no natural end, and a proc the player
  // can see land reads as luck earned rather than a bar that filled.
  {
    id: "salve",
    family: "rail",
    label: "Salve",
    glyph: "⑂",
    description: "Chance qu'un passage morde deux fois au lieu d'une",
    maxLevel: 250,
    basePrice: 900,
    priceGrowth: 1.035,
    valueAt: (level) => Math.min(0.9, level * 0.004),
    format: (value) => `${(value * 100).toFixed(1)} % de double`,
  },
  {
    id: "jumeau",
    family: "cases",
    label: "Jumeau",
    glyph: "⧉",
    description: "Chance qu'une case parte en deux canons",
    maxLevel: 200,
    basePrice: 1400,
    priceGrowth: 1.05,
    valueAt: (level) => Math.min(0.8, level * 0.004),
    format: (value) => `${(value * 100).toFixed(1)} % de jumeau`,
  },

  // --- Automatisme ------------------------------------------------------
  //
  // A run should start by hand and end by itself. These are the toile's own
  // purchases rather than the profile's, so every image replays that arc — which
  // is what a roguelite is for, and what a permanent unlock destroyed: bought
  // once on the sixth toile, it made every toile after it seven minutes long
  // and every toile before it an hour of tapping.
  {
    id: "automate",
    family: "automatisme",
    label: "Automate",
    glyph: "◉",
    description: "Envoie une case tout seul, à intervalle",
    maxLevel: 1,
    basePrice: 2500,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "en service" : "à l'arrêt"),
  },
  {
    id: "cadence",
    family: "automatisme",
    label: "Cadence",
    glyph: "≫",
    description: "Délai entre deux envois automatiques",
    maxLevel: 24,
    basePrice: 400,
    priceGrowth: 1.18,
    requires: ["automate"],
    valueAt: (level) =>
      Math.max(AUTO_LAUNCH_FLOOR_MS, Math.round(AUTO_LAUNCH_BASE_MS * 0.85 ** level)),
    format: (value) => `${(value / 1000).toFixed(2)} s`,
  },
  {
    id: "emplette",
    family: "automatisme",
    label: "Emplette",
    glyph: "⇵",
    description: "Achète l'amélioration la moins chère dès qu'elle est payable",
    maxLevel: 1,
    basePrice: 12_000,
    priceGrowth: 1,
    requires: ["automate"],
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "en service" : "à l'arrêt"),
  },

  // --- Capacités --------------------------------------------------------
  //
  // Four doors, each opening onto its own two numbers. They are bought with
  // fragments inside a toile for the same reason the automaton is: a capability
  // that a profile owns for good is a capability that stops being a decision.
  {
    id: "perce",
    family: "capacites",
    label: "Perce",
    glyph: "→",
    description: "Un tir peut traverser ce qui bouche la voie",
    maxLevel: 1,
    basePrice: 6000,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloquée" : "verrouillée"),
  },
  {
    id: "perceProc",
    family: "capacites",
    label: "Précision",
    glyph: "%",
    description: "Chance qu'un passage perce",
    maxLevel: 150,
    basePrice: 800,
    priceGrowth: 1.12,
    requires: ["perce"],
    valueAt: (level) => Math.min(0.75, level * 0.004),
    format: (value) => `${(value * 100).toFixed(1)} % de perce`,
  },
  {
    id: "pointe",
    family: "capacites",
    label: "Pointe",
    glyph: "▹",
    description: "Cases étrangères qu'un tir peut regarder au-delà",
    maxLevel: 10,
    basePrice: 2500,
    priceGrowth: 1.35,
    requires: ["perce"],
    valueAt: (level) => level,
    format: (value) => `${value} case${value > 1 ? "s" : ""}`,
  },
  {
    id: "explosion",
    family: "capacites",
    label: "Explosion",
    glyph: "✳",
    description: "Une case détruite peut emporter ses voisines",
    maxLevel: 1,
    basePrice: 15_000,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloquée" : "verrouillée"),
  },
  {
    id: "explosionProc",
    family: "capacites",
    label: "Amorce",
    glyph: "%",
    description: "Chance qu'une case détruite explose",
    maxLevel: 150,
    basePrice: 1000,
    priceGrowth: 1.12,
    requires: ["explosion"],
    valueAt: (level) => Math.min(0.6, level * 0.003),
    format: (value) => `${(value * 100).toFixed(1)} % d'explosion`,
  },
  {
    id: "souffle",
    family: "capacites",
    label: "Souffle",
    glyph: "◎",
    description: "Rayon du souffle, en cases",
    maxLevel: 8,
    basePrice: 4000,
    priceGrowth: 1.45,
    requires: ["explosion"],
    valueAt: (level) => level,
    format: (value) => `${value} case${value > 1 ? "s" : ""}`,
  },
  {
    id: "foudre",
    family: "capacites",
    label: "Foudre",
    glyph: "⚡",
    description: "Un arc saute vers une voisine de la même couleur",
    maxLevel: 1,
    basePrice: 30_000,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloquée" : "verrouillée"),
  },
  {
    id: "foudreProc",
    family: "capacites",
    label: "Charge",
    glyph: "%",
    description: "Chance qu'un arc parte",
    maxLevel: 150,
    basePrice: 1200,
    priceGrowth: 1.12,
    requires: ["foudre"],
    valueAt: (level) => Math.min(0.6, level * 0.003),
    format: (value) => `${(value * 100).toFixed(1)} % de foudre`,
  },
  {
    id: "chaine",
    family: "capacites",
    label: "Rebond",
    glyph: "⟿",
    description: "Sauts supplémentaires de l'arc",
    maxLevel: 12,
    basePrice: 5000,
    priceGrowth: 1.4,
    requires: ["foudre"],
    valueAt: (level) => level,
    format: (value) => `${value} saut${value > 1 ? "s" : ""}`,
  },
  {
    id: "feu",
    family: "capacites",
    label: "Feu",
    glyph: "≋",
    description: "Un incendie prend là où la case est morte",
    maxLevel: 1,
    basePrice: 60_000,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloquée" : "verrouillée"),
  },
  {
    id: "feuProc",
    family: "capacites",
    label: "Braise",
    glyph: "%",
    description: "Chance qu'un feu prenne",
    maxLevel: 150,
    basePrice: 1500,
    priceGrowth: 1.12,
    requires: ["feu"],
    valueAt: (level) => Math.min(0.5, level * 0.0025),
    format: (value) => `${(value * 100).toFixed(1)} % de feu`,
  },
  {
    id: "brasier",
    family: "capacites",
    label: "Brasier",
    glyph: "❋",
    description: "Cases que l'incendie parcourt",
    maxLevel: 12,
    basePrice: 6000,
    priceGrowth: 1.4,
    requires: ["feu"],
    valueAt: (level) => level,
    format: (value) => `${value} case${value > 1 ? "s" : ""}`,
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
  /** Chance a crossing takes a second cell off the same lane. */
  doubleBiteChance: number;
  /** Chance a launched load puts two cannons on the rail instead of one. */
  twinChance: number;
  /**
   * Milliseconds between two automatic launches, or null while the automaton
   * has not been bought. Null is "the player's thumb is the only clock".
   */
  autoLaunchMs: number | null;
  /** Emplette: the shop buys its own cheapest axis. */
  canAutoBuy: boolean;
  /** Pierce, explosion, lightning and fire, as the toile has bought them. */
  effects: EffectLoadout;
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

  /** The axes above this one that are still unbought. */
  missingFor(id: UpgradeId): UpgradeId[] {
    const definition = UPGRADE_BY_ID.get(id);
    if (!definition?.requires) return [];
    return definition.requires.filter((parent) => this.levelOf(parent) === 0);
  }

  /** True once every door this axis sits behind has been opened. */
  isAvailable(id: UpgradeId): boolean {
    return this.missingFor(id).length === 0;
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
    if (!definition || this.isMaxed(id) || !this.isAvailable(id)) return null;
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

  /**
   * Buys up to `count` levels, stopping at the balance or the ceiling.
   *
   * Prices compound, so the only honest way to answer "what would ten cost" is
   * to walk them — and the panel needs that number before the player commits,
   * which is what `costOf` is for.
   */
  buyMany(id: UpgradeId, count: number): number {
    let bought = 0;
    while (bought < count && this.buy(id)) bought++;
    return bought;
  }

  /** What the next `count` levels would cost, and how many are actually within reach. */
  costOf(id: UpgradeId, count: number): { levels: number; price: number } {
    const definition = UPGRADE_BY_ID.get(id);
    if (!definition) return { levels: 0, price: 0 };

    if (!this.isAvailable(id)) return { levels: 0, price: 0 };

    let level = this.levelOf(id);
    let price = 0;
    let levels = 0;

    while (levels < count && level < definition.maxLevel) {
      const step = Math.max(
        1,
        Math.round(definition.basePrice * definition.priceGrowth ** level * this.priceMultiplier),
      );
      if (price + step > this.balance) break;
      price += step;
      level++;
      levels++;
    }

    return { levels, price };
  }

  /** Levels of `id` the balance could pay for right now. */
  affordableLevels(id: UpgradeId): number {
    return this.costOf(id, Number.MAX_SAFE_INTEGER).levels;
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
      doubleBiteChance: valueOf("salve", this.levelOf("salve")),
      twinChance: valueOf("jumeau", this.levelOf("jumeau")),
      autoLaunchMs: this.levelOf("automate") > 0 ? valueOf("cadence", this.levelOf("cadence")) : null,
      canAutoBuy: this.levelOf("emplette") > 0,
      effects: {
        // A branch's numbers only exist once its door has been opened: an
        // unbought Explosion leaves a radius bought under it inert rather than
        // firing at a chance of zero, which is the same thing said less clearly.
        pierceChance: this.behind("perce", "perceProc"),
        pierceDepth: this.behind("perce", "pointe"),
        explosionChance: this.behind("explosion", "explosionProc"),
        explosionRadius: this.behind("explosion", "souffle"),
        lightningChance: this.behind("foudre", "foudreProc"),
        lightningArcs: this.behind("foudre", "chaine"),
        fireChance: this.behind("feu", "feuProc"),
        fireSpread: this.behind("feu", "brasier"),
      },
    };
  }

  /** A stat's value, or zero while the capability it belongs to is unbought. */
  private behind(unlock: UpgradeId, id: UpgradeId): number {
    return this.levelOf(unlock) > 0 ? valueOf(id, this.levelOf(id)) : 0;
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
