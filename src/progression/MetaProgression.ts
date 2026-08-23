import { ColorLibrary, type LibrarySnapshot } from "./ColorLibrary";
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
  // Confort
  | "filtre"
  | "nuancier";

export type MetaKind = "point" | "unlock" | "stat";

export type MetaBranch = "racine" | "confort";

export const BRANCH_LABELS: Record<MetaBranch, string> = {
  racine: "Fondations",
  confort: "Confort",
};

export const BRANCH_ORDER: MetaBranch[] = ["racine", "confort"];

export interface MetaUpgradeDefinition {
  id: MetaUpgradeId;
  kind: MetaKind;
  branch: MetaBranch;
  /** Heading the node sits under inside its branch. */
  ladder: string;
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

/**
 * Two fifths of a percent, the unit the whole root of the tree is built on.
 *
 * It was a fifth, and a fifth was measured to be unreachable. A linear price
 * for a linear effect makes the cost of *doubling* an axis quadratic: at
 * 0.2 % a point, ×1,5 on the rail speed asks for two hundred and fifty points
 * and 3 725 éclats — a hundred and forty-nine toiles at the twenty-five a clear
 * pays. Mémoire, the one node that shortens the *next* toile, came out at two
 * hundred and sixty-one toiles, which at fifty minutes each is two hundred and
 * fifty hours. Every axis that compounds sat two orders of magnitude past the
 * income; the only healthy purchase in the tree was Socle, and Socle is the one
 * with a flat price.
 *
 * Doubling the tick halves the points a target needs, and the price being
 * quadratic in points means it quarters the éclats. ×1,5 on the rail now costs
 * a thousand and twenty-nine — twenty-nine toiles, next to the twenty-six the
 * eight unlocks take. Nothing here has a ceiling, so the axis keeps going; what
 * changed is that its first real multiplier is inside a profile's life.
 */
const TICK = 0.004;

const mult = (value: number) => `×${value.toFixed(3)}`;

export const META_UPGRADES: MetaUpgradeDefinition[] = [
  // --- Fondations -------------------------------------------------------
  {
    id: "negoce",
    ladder: "Économie",
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
    ladder: "Départ",
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
    ladder: "Départ",
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
    ladder: "Économie",
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
    ladder: "Économie",
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
    ladder: "Départ",
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
    ladder: "Économie",
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
    ladder: "Départ",
    kind: "point",
    branch: "racine",
    label: "Mémoire",
    glyph: "≡",
    description: "Niveaux repris sur la toile suivante",
    basePrice: 6,
    // The steepest step in the tree, on the node that matters most: at 0.5 the
    // price is quadratic fast enough that thirty percent carried cost 6 525
    // éclats. It is the compounding node — the only one that makes the next
    // toile shorter than this one — so it is the last that should have been
    // priced out of reach.
    priceStep: 0.2,
    // Capped where it stops being a head start and starts being the whole run.
    valueAt: (p) => Math.min(0.6, p * TICK),
    format: (value) => `${(value * 100).toFixed(1)} % des niveaux`,
  },
  {
    id: "socle",
    ladder: "Départ",
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

  // --- Confort ----------------------------------------------------------
  {
    id: "nuancier",
    ladder: "Lecture",
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
    ladder: "Étal",
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
  /** Toiles this profile has already finished, all images together. */
  clears?: number;
}

/** The reward, itemised. The panel shows these lines, so they are the model. */
export interface ClearReward {
  base: number;
  paletteFactor: number;
  rarityFactor: number;
  passFactor: number;
  /** Métier: what every toile already finished is worth on this one. */
  craftFactor: number;
  multiplier: number;
  total: number;
}

/**
 * What one finished toile adds to every later one.
 *
 * Four percent, and it is the only term in the reward that grows on its own.
 * Measured before it existed: twenty-five éclats a clear, toile one and toile
 * ten alike, against a tree whose compounding nodes wanted thousands. An idle
 * game works because the curve accelerates; this one was a straight line, so a
 * profile ten hours in played exactly like a profile on its first minute.
 *
 * It counts toiles, not pixels or colours, because that is the thing the player
 * did — and it reads on the completion panel as a line that goes up every time,
 * which is the point of it.
 */
export const CRAFT_PER_CLEAR = 0.04;

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
  const craftFactor = 1 + Math.max(0, input.clears ?? 0) * CRAFT_PER_CLEAR;
  const multiplier = input.multiplier ?? 1;

  return {
    base,
    paletteFactor,
    rarityFactor,
    passFactor,
    craftFactor,
    multiplier,
    total: Math.max(
      1,
      Math.round(base * paletteFactor * rarityFactor * passFactor * craftFactor * multiplier),
    ),
  };
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
  canFilterQueue: boolean;
  canSeePalette: boolean;
}

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
  canFilterQueue: false,
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
  /** Colours finished off, kept for good. */
  library: LibrarySnapshot;
}

export class MetaProgression {
  private readonly levels: Map<MetaUpgradeId, number>;
  private earned: number;
  private spent: number;
  private clears: number;
  private lastLevels: UpgradeLevels;
  /** The colour book. Profile state, like everything else here. */
  readonly library: ColorLibrary;

  constructor(snapshot: Partial<MetaSnapshot> = {}) {
    this.levels = new Map(META_UPGRADES.map((u) => [u.id, snapshot.levels?.[u.id] ?? 0]));
    this.earned = snapshot.earned ?? 0;
    this.spent = snapshot.spent ?? 0;
    this.clears = snapshot.clears ?? 0;
    this.lastLevels = { ...(snapshot.lastLevels ?? {}) };
    this.library = ColorLibrary.restore(snapshot.library);
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

  /**
   * The nodes above this one that have not been bought yet.
   *
   * A locked node is still listed — showing "here is the next thing to want" is
   * the whole reason the tree has doors. What it must not do is pretend to be
   * buyable, so the panel reads this to say *what* is missing.
   */
  missingFor(id: MetaUpgradeId): MetaUpgradeId[] {
    const definition = META_BY_ID.get(id);
    if (!definition?.requires) return [];
    return definition.requires.filter((parent) => this.levelOf(parent) === 0);
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

  /** Buys up to `count` points, stopping at the balance or a ceiling. */
  buyMany(id: MetaUpgradeId, count: number): number {
    let bought = 0;
    while (bought < count && this.buy(id)) bought++;
    return bought;
  }

  /**
   * What the next `count` points would cost, and how many are within reach.
   *
   * A `point` node's price creeps with every point already spent, so ten points
   * are never ten times the first. The panel has to be able to say what a batch
   * costs before the player commits to it.
   */
  costOf(id: MetaUpgradeId, count: number): { levels: number; price: number } {
    const definition = META_BY_ID.get(id);
    if (!definition || !this.isAvailable(id)) return { levels: 0, price: 0 };

    let level = this.levelOf(id);
    let price = 0;
    let levels = 0;

    while (levels < count) {
      if (definition.maxLevel !== undefined && level >= definition.maxLevel) break;
      const step = Math.max(1, Math.ceil(definition.basePrice + level * definition.priceStep));
      if (price + step > this.balance) break;
      price += step;
      level++;
      levels++;
    }

    return { levels, price };
  }

  affordableLevels(id: MetaUpgradeId): number {
    return this.costOf(id, Number.MAX_SAFE_INTEGER).levels;
  }

  /**
   * Records a cleared toile and pays for it, itemised.
   *
   * It also snapshots where the level upgrades stood, because that is what
   * Mémoire carries into the next image. Only a real clear updates it: a restart
   * must not, or restarting would be a way to bank a build.
   */
  recordClear(
    input: Omit<ClearInput, "multiplier" | "clears">,
    levels: UpgradeLevels = {},
  ): ClearReward {
    // The toiles already finished count, this one does not: the reward is what
    // the profile brought to the image, not what it is about to be worth.
    const reward = rewardForClear({
      ...input,
      clears: this.clears,
      multiplier: this.bonus().shardMultiplier,
    });
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

    // The library pays passively for work already finished: it multiplies what
    // an image is worth and what an absence produces, and touches nothing else.
    const book = this.library.bonus();

    return {
      startingFragments: this.valueOf("heritage"),
      fragmentMultiplier: this.valueOf("elan") * book.fragmentMultiplier,
      extraCannons: this.valueOf("socle"),
      offlineMultiplier: this.valueOf("somnambule") * book.offlineMultiplier,
      speedMultiplier: this.valueOf("fondation"),
      ammoMultiplier: this.valueOf("atelier"),
      shardMultiplier: this.valueOf("prospecteur"),
      priceMultiplier: this.valueOf("negoce"),
      carriedLevels,
      canFilterQueue: this.levelOf("filtre") > 0,
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
      library: this.library.serialize(),
    };
  }

  static restore(snapshot?: Partial<MetaSnapshot>): MetaProgression {
    return new MetaProgression(snapshot ?? {});
  }

  private valueOf(id: MetaUpgradeId): number {
    return META_BY_ID.get(id)!.valueAt(this.levelOf(id));
  }
}
