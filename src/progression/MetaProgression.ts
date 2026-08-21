import type { UpgradeId, UpgradeLevels } from "./Upgrades";

/**
 * The talent tree, and what survives an image.
 *
 * Level upgrades are scoped to one toile on purpose: a new image has to start
 * near the base values or the first pass of every image after the first would
 * be over before it began. This is the other half — what a cleared toile pays
 * for, and what it buys is never lost.
 *
 * Three kinds of node, because they answer three different questions:
 *
 * - **`point`** — no ceiling, a fifth of a percent at a time, a price that
 *   creeps rather than doubles. There is always something to put éclats into,
 *   and no axis quietly stops existing halfway through a profile.
 * - **`unlock`** — one level, expensive, and it opens a branch. This is where
 *   the capabilities live: a cannon does not pierce, explode, arc or burn until
 *   the profile paid for it once.
 * - **`stat`** — a `point` node hidden behind an unlock. Radius, bounces,
 *   spread, proc chance: the numbers that only mean something once the
 *   capability they belong to exists.
 *
 * A node with `requires` is invisible until every id it names is bought, so the
 * tree opens up rather than presenting forty rows on the first clear.
 */
export type MetaUpgradeId =
  // Racine — always available, no ceiling
  | "negoce"
  | "fondation"
  | "atelier"
  | "elan"
  | "prospecteur"
  | "somnambule"
  | "heritage"
  | "socle"
  | "memoire"
  // Capacités
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
  | "brasier"
  // Confort
  | "filtre"
  | "auto"
  | "emplette"
  | "nuancier";

export type MetaKind = "point" | "unlock" | "stat";

export type MetaBranch = "racine" | "perce" | "explosion" | "foudre" | "feu" | "confort";

export const BRANCH_LABELS: Record<MetaBranch, string> = {
  racine: "Fondations",
  perce: "Perce",
  explosion: "Explosion",
  foudre: "Foudre",
  feu: "Feu",
  confort: "Confort",
};

export const BRANCH_ORDER: MetaBranch[] = [
  "racine",
  "perce",
  "explosion",
  "foudre",
  "feu",
  "confort",
];

export interface MetaUpgradeDefinition {
  id: MetaUpgradeId;
  kind: MetaKind;
  branch: MetaBranch;
  label: string;
  glyph: string;
  description: string;
  /** Nodes that must be bought first. An unbought parent hides the node. */
  requires?: MetaUpgradeId[];
  basePrice: number;
  /**
   * Éclats added to the price per point already spent. Linear on purpose: a
   * geometric curve turns an unbounded node into a bounded one after twenty
   * levels, which is the shape this is meant to replace.
   */
  priceStep: number;
  /** Absent on a `point` node — that is the whole idea. */
  maxLevel?: number;
  valueAt: (points: number) => number;
  format: (value: number) => string;
}

/** A fifth of a percent, the unit the whole root of the tree is built on. */
const TICK = 0.002;

const pct = (value: number) => `${(value * 100).toFixed(1)} %`;
const mult = (value: number) => `×${value.toFixed(3)}`;

export const META_UPGRADES: MetaUpgradeDefinition[] = [
  // --- Fondations -------------------------------------------------------
  {
    id: "negoce",
    kind: "point",
    branch: "racine",
    label: "Négoce",
    glyph: "%",
    description: "Prix des améliorations en boutique",
    basePrice: 2,
    priceStep: 0.12,
    // Multiplicative, so a hundred points is a third off rather than free.
    valueAt: (p) => Math.pow(1 - TICK, p),
    format: (value) => `−${((1 - value) * 100).toFixed(1)} % sur les prix`,
  },
  {
    id: "fondation",
    kind: "point",
    branch: "racine",
    label: "Fondation",
    glyph: "⌁",
    description: "Vitesse de rail de départ, sur toutes les images",
    basePrice: 2,
    priceStep: 0.1,
    valueAt: (p) => 1 + p * TICK,
    format: mult,
  },
  {
    id: "atelier",
    kind: "point",
    branch: "racine",
    label: "Atelier",
    glyph: "◲",
    description: "Munitions par case de départ",
    basePrice: 2,
    priceStep: 0.1,
    valueAt: (p) => 1 + p * TICK,
    format: mult,
  },
  {
    id: "elan",
    kind: "point",
    branch: "racine",
    label: "Élan",
    glyph: "◈",
    description: "Fragments par pixel détruit",
    basePrice: 2,
    priceStep: 0.1,
    valueAt: (p) => 1 + p * TICK,
    format: mult,
  },
  {
    id: "prospecteur",
    kind: "point",
    branch: "racine",
    label: "Prospecteur",
    glyph: "◆",
    description: "Éclats gagnés en terminant une toile",
    basePrice: 3,
    priceStep: 0.16,
    valueAt: (p) => 1 + p * TICK,
    format: mult,
  },
  {
    id: "somnambule",
    kind: "point",
    branch: "racine",
    label: "Somnambule",
    glyph: "☾",
    description: "Production pendant l'absence",
    basePrice: 2,
    priceStep: 0.1,
    valueAt: (p) => 1 + p * TICK,
    format: mult,
  },
  {
    id: "heritage",
    kind: "point",
    branch: "racine",
    label: "Héritage",
    glyph: "◇",
    description: "Fragments offerts au début de chaque image",
    basePrice: 2,
    priceStep: 0.08,
    valueAt: (p) => p * 400,
    format: (value) => `${Math.round(value).toLocaleString("fr-FR")} fragments`,
  },
  {
    id: "memoire",
    kind: "point",
    branch: "racine",
    label: "Mémoire",
    glyph: "≡",
    description: "Niveaux repris sur la toile suivante",
    basePrice: 6,
    priceStep: 0.5,
    // Capped where it stops being a head start and starts being the whole run.
    valueAt: (p) => Math.min(0.6, p * TICK),
    format: (value) => `${(value * 100).toFixed(1)} % des niveaux`,
  },
  {
    id: "socle",
    kind: "point",
    branch: "racine",
    label: "Socle",
    glyph: "+1",
    description: "Canons simultanés dès le départ",
    basePrice: 12,
    priceStep: 6,
    valueAt: (p) => p,
    format: (value) => `+${value} canons`,
  },

  // --- Capacités --------------------------------------------------------
  {
    id: "perce",
    kind: "unlock",
    branch: "perce",
    label: "Perce",
    glyph: "→",
    description:
      "Un tir peut atteindre sa couleur derrière ce qui la couvre. Ce qu'il traverse n'est jamais détruit.",
    basePrice: 100,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "perceProc",
    kind: "stat",
    branch: "perce",
    label: "Précision",
    glyph: "·",
    description: "Chance qu'un passage perce",
    requires: ["perce"],
    basePrice: 3,
    priceStep: 0.2,
    valueAt: (p) => Math.min(0.9, 0.05 + p * TICK),
    format: pct,
  },
  {
    id: "pointe",
    kind: "stat",
    branch: "perce",
    label: "Pointe",
    glyph: "⇥",
    description: "Cellules étrangères traversées",
    requires: ["perce"],
    basePrice: 8,
    priceStep: 1.6,
    valueAt: (p) => 1 + p,
    format: (value) => `${value} cellules`,
  },
  {
    id: "explosion",
    kind: "unlock",
    branch: "explosion",
    label: "Explosion",
    glyph: "✳",
    description: "Un pixel détruit peut emporter ses voisins de la même couleur.",
    basePrice: 140,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "explosionProc",
    kind: "stat",
    branch: "explosion",
    label: "Amorce",
    glyph: "·",
    description: "Chance qu'un pixel détruit explose",
    requires: ["explosion"],
    basePrice: 3,
    priceStep: 0.2,
    valueAt: (p) => Math.min(0.9, 0.05 + p * TICK),
    format: pct,
  },
  {
    id: "souffle",
    kind: "stat",
    branch: "explosion",
    label: "Souffle",
    glyph: "◎",
    description: "Rayon de l'explosion",
    requires: ["explosion"],
    basePrice: 10,
    priceStep: 2.4,
    valueAt: (p) => 1 + p,
    format: (value) => `${value} blocs`,
  },
  {
    id: "foudre",
    kind: "unlock",
    branch: "foudre",
    label: "Foudre",
    glyph: "⚡",
    description: "Un arc saute du pixel abattu vers un voisin de sa couleur, et continue.",
    basePrice: 180,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "foudreProc",
    kind: "stat",
    branch: "foudre",
    label: "Charge",
    glyph: "·",
    description: "Chance qu'un arc parte",
    requires: ["foudre"],
    basePrice: 3,
    priceStep: 0.2,
    valueAt: (p) => Math.min(0.9, 0.05 + p * TICK),
    format: pct,
  },
  {
    id: "chaine",
    kind: "stat",
    branch: "foudre",
    label: "Rebond",
    glyph: "⌇",
    description: "Sauts successifs de l'arc",
    requires: ["foudre"],
    basePrice: 6,
    priceStep: 1.1,
    valueAt: (p) => 2 + p,
    format: (value) => `${value} sauts`,
  },
  {
    id: "feu",
    kind: "unlock",
    branch: "feu",
    label: "Feu",
    glyph: "▲",
    description:
      "L'incendie se propage de proche en proche dans la couleur touchée, en suivant sa forme.",
    basePrice: 240,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "feuProc",
    kind: "stat",
    branch: "feu",
    label: "Braise",
    glyph: "·",
    description: "Chance qu'un incendie parte",
    requires: ["feu"],
    basePrice: 4,
    priceStep: 0.24,
    valueAt: (p) => Math.min(0.9, 0.04 + p * TICK),
    format: pct,
  },
  {
    id: "brasier",
    kind: "stat",
    branch: "feu",
    label: "Brasier",
    glyph: "≋",
    description: "Cellules que l'incendie parcourt",
    requires: ["feu"],
    basePrice: 8,
    priceStep: 0.9,
    valueAt: (p) => 4 + p * 2,
    format: (value) => `${value} cellules`,
  },

  // --- Confort ----------------------------------------------------------
  {
    id: "nuancier",
    kind: "unlock",
    branch: "confort",
    label: "Nuancier",
    glyph: "▦",
    description:
      "La palette complète de la toile, avec les couleurs encore atteignables mises en évidence.",
    basePrice: 40,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "filtre",
    kind: "unlock",
    branch: "confort",
    label: "Trieuse",
    glyph: "▤",
    description: "Filtrer les cases proposées sur une seule couleur.",
    basePrice: 70,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "auto",
    kind: "unlock",
    branch: "confort",
    label: "Automate",
    glyph: "⟳",
    description: "Les cases partent toutes seules dès qu'un emplacement se libère.",
    basePrice: 110,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "emplette",
    kind: "unlock",
    branch: "confort",
    label: "Emplette",
    glyph: "◈⟳",
    description: "Achète toute seule l'amélioration la moins chère dès qu'elle est payable.",
    requires: ["auto"],
    basePrice: 200,
    priceStep: 0,
    maxLevel: 1,
    valueAt: (p) => p,
    format: (v) => (v > 0 ? "débloqué" : "verrouillé"),
  },
];

export const META_BY_ID = new Map(META_UPGRADES.map((u) => [u.id, u]));

export type MetaLevels = Partial<Record<MetaUpgradeId, number>>;

/** Pixels one éclat of the base reward is worth. */
const PIXELS_PER_SHARD = 50_000;

/** Palette size that pays no colour bonus: the smallest a level can have. */
const PLAIN_PALETTE = 6;

export interface ClearInput {
  playablePixels: number;
  paletteSize: number;
  /** Colours below the "rare" threshold — the ones that strand a run. */
  awkwardColors: number;
  pass: number;
  /** Prospecteur, from the permanent bonus. */
  multiplier?: number;
}

/** The reward, itemised. The panel shows these lines, so they are the model. */
export interface ClearReward {
  base: number;
  paletteFactor: number;
  rarityFactor: number;
  passFactor: number;
  multiplier: number;
  total: number;
}

/**
 * What clearing a toile is worth.
 *
 * Four things make a picture hard, and each is a line the player can read on the
 * completion panel rather than a single number to take on faith: its size, how
 * many colours had to be juggled, how many of them were rare enough to hide
 * behind another, and whether this image is already familiar.
 */
export function rewardForClear(input: ClearInput): ClearReward {
  const base = Math.max(1, Math.round(input.playablePixels / PIXELS_PER_SHARD));
  const paletteFactor = 1 + Math.max(0, input.paletteSize - PLAIN_PALETTE) * 0.1;
  const rarityFactor = 1 + Math.max(0, input.awkwardColors) * 0.15;
  const passFactor = 1 + Math.max(0, input.pass - 1) * 0.25;
  const multiplier = input.multiplier ?? 1;

  return {
    base,
    paletteFactor,
    rarityFactor,
    passFactor,
    multiplier,
    total: Math.max(
      1,
      Math.round(base * paletteFactor * rarityFactor * passFactor * multiplier),
    ),
  };
}

/** The capabilities a cannon has, and how far each one reaches. */
export interface EffectBonus {
  pierceChance: number;
  pierceDepth: number;
  explosionChance: number;
  explosionRadius: number;
  lightningChance: number;
  lightningArcs: number;
  fireChance: number;
  fireSpread: number;
}

/** What the profile hands to every level it starts. */
export interface PermanentBonus {
  startingFragments: number;
  fragmentMultiplier: number;
  extraCannons: number;
  offlineMultiplier: number;
  speedMultiplier: number;
  ammoMultiplier: number;
  shardMultiplier: number;
  /** Multiplier on every in-game upgrade price. Négoce. */
  priceMultiplier: number;
  /**
   * Level upgrade levels a new toile starts with, carried from the last one
   * that was cleared. Mémoire is the bought exception to axes being per-image.
   */
  carriedLevels: UpgradeLevels;
  effects: EffectBonus;
  canFilterQueue: boolean;
  canAutoLaunch: boolean;
  canAutoBuy: boolean;
  canSeePalette: boolean;
}

export const NO_EFFECT_BONUS: EffectBonus = {
  pierceChance: 0,
  pierceDepth: 0,
  explosionChance: 0,
  explosionRadius: 0,
  lightningChance: 0,
  lightningArcs: 0,
  fireChance: 0,
  fireSpread: 0,
};

export const NO_PERMANENT_BONUS: PermanentBonus = {
  startingFragments: 0,
  fragmentMultiplier: 1,
  extraCannons: 0,
  offlineMultiplier: 1,
  speedMultiplier: 1,
  ammoMultiplier: 1,
  shardMultiplier: 1,
  priceMultiplier: 1,
  carriedLevels: {},
  effects: NO_EFFECT_BONUS,
  canFilterQueue: false,
  canAutoLaunch: false,
  canAutoBuy: false,
  canSeePalette: false,
};

export interface MetaSnapshot {
  levels: MetaLevels;
  earned: number;
  spent: number;
  /** Images cleared, all toiles and all passes together. */
  clears: number;
  /** Level upgrades as they stood when the last toile was cleared. */
  lastLevels: UpgradeLevels;
}

export class MetaProgression {
  private readonly levels: Map<MetaUpgradeId, number>;
  private earned: number;
  private spent: number;
  private clears: number;
  private lastLevels: UpgradeLevels;

  constructor(snapshot: Partial<MetaSnapshot> = {}) {
    this.levels = new Map(META_UPGRADES.map((u) => [u.id, snapshot.levels?.[u.id] ?? 0]));
    this.earned = snapshot.earned ?? 0;
    this.spent = snapshot.spent ?? 0;
    this.clears = snapshot.clears ?? 0;
    this.lastLevels = { ...(snapshot.lastLevels ?? {}) };
  }

  get balance(): number {
    return Math.max(0, this.earned - this.spent);
  }

  get totalEarned(): number {
    return this.earned;
  }

  get totalClears(): number {
    return this.clears;
  }

  levelOf(id: MetaUpgradeId): number {
    return this.levels.get(id) ?? 0;
  }

  isMaxed(id: MetaUpgradeId): boolean {
    const definition = META_BY_ID.get(id);
    if (!definition) return true;
    return definition.maxLevel !== undefined && this.levelOf(id) >= definition.maxLevel;
  }

  /** True once every node this one hangs off has been bought. */
  isAvailable(id: MetaUpgradeId): boolean {
    const definition = META_BY_ID.get(id);
    if (!definition?.requires) return true;
    return definition.requires.every((parent) => this.levelOf(parent) > 0);
  }

  /** What a node the player can see right now would cost. */
  priceOf(id: MetaUpgradeId): number | null {
    const definition = META_BY_ID.get(id);
    if (!definition || this.isMaxed(id) || !this.isAvailable(id)) return null;
    return Math.max(1, Math.ceil(definition.basePrice + this.levelOf(id) * definition.priceStep));
  }

  canAfford(id: MetaUpgradeId): boolean {
    const price = this.priceOf(id);
    return price !== null && price <= this.balance;
  }

  buy(id: MetaUpgradeId): boolean {
    const price = this.priceOf(id);
    if (price === null || price > this.balance) return false;
    this.spent += price;
    this.levels.set(id, this.levelOf(id) + 1);
    return true;
  }

  /**
   * Records a cleared toile and pays for it, itemised.
   *
   * It also snapshots where the level upgrades stood, because that is what
   * Mémoire carries into the next image. Only a real clear updates it: a restart
   * must not, or restarting would be a way to bank a build.
   */
  recordClear(input: Omit<ClearInput, "multiplier">, levels: UpgradeLevels = {}): ClearReward {
    const reward = rewardForClear({ ...input, multiplier: this.bonus().shardMultiplier });
    this.earned += reward.total;
    this.clears++;
    this.lastLevels = { ...levels };
    return reward;
  }

  bonus(): PermanentBonus {
    const memory = this.valueOf("memoire");
    const carriedLevels: UpgradeLevels = {};
    if (memory > 0) {
      for (const [id, level] of Object.entries(this.lastLevels) as [UpgradeId, number][]) {
        const carried = Math.floor(level * memory);
        if (carried > 0) carriedLevels[id] = carried;
      }
    }

    // A branch's numbers only exist once its capability has been bought: an
    // unbought Explosion leaves the radius bought under it inert rather than
    // firing at a chance of zero, which would be the same thing said less
    // clearly.
    const branch = (unlock: MetaUpgradeId, id: MetaUpgradeId): number =>
      this.levelOf(unlock) > 0 ? this.valueOf(id) : 0;

    return {
      startingFragments: this.valueOf("heritage"),
      fragmentMultiplier: this.valueOf("elan"),
      extraCannons: this.valueOf("socle"),
      offlineMultiplier: this.valueOf("somnambule"),
      speedMultiplier: this.valueOf("fondation"),
      ammoMultiplier: this.valueOf("atelier"),
      shardMultiplier: this.valueOf("prospecteur"),
      priceMultiplier: this.valueOf("negoce"),
      carriedLevels,
      effects: {
        pierceChance: branch("perce", "perceProc"),
        pierceDepth: branch("perce", "pointe"),
        explosionChance: branch("explosion", "explosionProc"),
        explosionRadius: branch("explosion", "souffle"),
        lightningChance: branch("foudre", "foudreProc"),
        lightningArcs: branch("foudre", "chaine"),
        fireChance: branch("feu", "feuProc"),
        fireSpread: branch("feu", "brasier"),
      },
      canFilterQueue: this.levelOf("filtre") > 0,
      canAutoLaunch: this.levelOf("auto") > 0,
      canAutoBuy: this.levelOf("emplette") > 0,
      canSeePalette: this.levelOf("nuancier") > 0,
    };
  }

  serialize(): MetaSnapshot {
    const levels: MetaLevels = {};
    for (const [id, level] of this.levels) if (level > 0) levels[id] = level;
    return {
      levels,
      earned: this.earned,
      spent: this.spent,
      clears: this.clears,
      lastLevels: { ...this.lastLevels },
    };
  }

  static restore(snapshot?: Partial<MetaSnapshot>): MetaProgression {
    return new MetaProgression(snapshot ?? {});
  }

  private valueOf(id: MetaUpgradeId): number {
    return META_BY_ID.get(id)!.valueAt(this.levelOf(id));
  }
}
