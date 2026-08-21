import type { UpgradeId, UpgradeLevels } from "./Upgrades";

/**
 * What survives an image.
 *
 * Level upgrades are scoped to one toile on purpose: a new image has to start
 * from the base values or the first pass of every image after the first would
 * be over before it began. That leaves nothing to show for finishing one,
 * which is what this fixes. Clearing a toile pays **éclats**, and éclats buy
 * things that are never lost: a head start, a permanently better yield, and the
 * comfort features that only make sense once a player has done a full pass and
 * knows what is tedious about it.
 *
 * Stored in the settings store rather than in a level save, because that is
 * exactly what it is: profile state, not level state.
 */
export type MetaUpgradeId =
  | "heritage"
  | "elan"
  | "socle"
  | "somnambule"
  | "memoire"
  | "prospecteur"
  | "fondation"
  | "atelier"
  | "filtre"
  | "auto";

export interface MetaUpgradeDefinition {
  id: MetaUpgradeId;
  label: string;
  glyph: string;
  description: string;
  maxLevel: number;
  basePrice: number;
  priceGrowth: number;
  valueAt: (level: number) => number;
  format: (value: number) => string;
}

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
  /** Éclats from the sheer size of what was destroyed. */
  base: number;
  /** Multiplier for how many colours had to be juggled. */
  paletteFactor: number;
  /** Multiplier for the rare and exotic colours in it. */
  rarityFactor: number;
  /** Multiplier for having come back to the same image. */
  passFactor: number;
  /** Prospecteur. */
  multiplier: number;
  total: number;
}

/**
 * What clearing a toile is worth.
 *
 * Four things make a picture hard, and each is a line the player can read on the
 * completion panel rather than a single number to take on faith:
 *
 * - **its size** — a dense photograph is more work than a mostly-transparent
 *   logo, so the base is the playable pixels themselves;
 * - **its palette** — every colour is a separate queue, a separate cannon and a
 *   separate bottleneck, so sixteen colours pay twice what six do;
 * - **its rare colours** — a colour down to a fraction of a percent is the one
 *   that strands a run behind another colour's facade, and it is exactly what
 *   the palette detection was built to preserve. Paying for it makes keeping it
 *   worth something;
 * - **the pass** — coming back to an image the player already knows pays less
 *   per pass, but never nothing.
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

export const META_UPGRADES: MetaUpgradeDefinition[] = [
  {
    id: "heritage",
    label: "Héritage",
    glyph: "◇",
    description: "Fragments offerts au début de chaque image",
    maxLevel: 40,
    basePrice: 2,
    priceGrowth: 1.28,
    valueAt: (level) => level * 2_500,
    format: (value) => `${value.toLocaleString("fr-FR")} fragments`,
  },
  {
    id: "elan",
    label: "Élan",
    glyph: "◈",
    description: "Fragments par pixel, sur toutes les images",
    maxLevel: 30,
    basePrice: 3,
    priceGrowth: 1.32,
    valueAt: (level) => 1 + level * 0.1,
    format: (value) => `×${value.toFixed(2)}`,
  },
  {
    id: "socle",
    label: "Socle",
    glyph: "+1",
    description: "Canons simultanés dès le départ",
    maxLevel: 10,
    basePrice: 6,
    priceGrowth: 1.55,
    valueAt: (level) => level,
    format: (value) => `+${value} canons`,
  },
  {
    id: "somnambule",
    label: "Somnambule",
    glyph: "☾",
    description: "Production hors-ligne, sur toutes les images",
    maxLevel: 20,
    basePrice: 4,
    priceGrowth: 1.4,
    valueAt: (level) => 1 + level * 0.15,
    format: (value) => `×${value.toFixed(2)}`,
  },
  {
    id: "memoire",
    label: "Mémoire",
    glyph: "≡",
    description: "Niveaux d'améliorations repris sur la toile suivante",
    maxLevel: 20,
    basePrice: 10,
    priceGrowth: 1.34,
    valueAt: (level) => level * 0.025,
    format: (value) => `${(value * 100).toFixed(0)} % des niveaux`,
  },
  {
    id: "prospecteur",
    label: "Prospecteur",
    glyph: "◆",
    description: "Éclats gagnés en terminant une toile",
    maxLevel: 25,
    basePrice: 5,
    priceGrowth: 1.3,
    valueAt: (level) => 1 + level * 0.12,
    format: (value) => `×${value.toFixed(2)}`,
  },
  {
    id: "fondation",
    label: "Fondation",
    glyph: "⌁",
    description: "Vitesse de rail de départ, sur toutes les images",
    maxLevel: 30,
    basePrice: 5,
    priceGrowth: 1.26,
    valueAt: (level) => 1 + level * 0.06,
    format: (value) => `×${value.toFixed(2)}`,
  },
  {
    id: "atelier",
    label: "Atelier",
    glyph: "◲",
    description: "Munitions par case de départ, sur toutes les images",
    maxLevel: 30,
    basePrice: 5,
    priceGrowth: 1.26,
    valueAt: (level) => 1 + level * 0.08,
    format: (value) => `×${value.toFixed(2)}`,
  },
  {
    id: "filtre",
    label: "Trieuse",
    glyph: "▤",
    description: "Filtrer et trier les cases par couleur",
    maxLevel: 1,
    basePrice: 8,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloqué" : "verrouillé"),
  },
  {
    id: "auto",
    label: "Automate",
    glyph: "⟳",
    description: "Lancer les cases toutes seules dès qu'un slot se libère",
    maxLevel: 1,
    basePrice: 14,
    priceGrowth: 1,
    valueAt: (level) => level,
    format: (value) => (value > 0 ? "débloqué" : "verrouillé"),
  },
];

export const META_BY_ID = new Map(META_UPGRADES.map((u) => [u.id, u]));

export type MetaLevels = Partial<Record<MetaUpgradeId, number>>;

/** What the profile hands to every level it starts. */
export interface PermanentBonus {
  startingFragments: number;
  fragmentMultiplier: number;
  extraCannons: number;
  offlineMultiplier: number;
  speedMultiplier: number;
  ammoMultiplier: number;
  shardMultiplier: number;
  /**
   * Level upgrade levels a new toile starts with, carried from the last one
   * that was cleared. This is the long game: the axes are scoped to an image on
   * purpose, and Mémoire is the bought, deliberate exception to that.
   */
  carriedLevels: UpgradeLevels;
  canFilterQueue: boolean;
  canAutoLaunch: boolean;
}

export const NO_PERMANENT_BONUS: PermanentBonus = {
  startingFragments: 0,
  fragmentMultiplier: 1,
  extraCannons: 0,
  offlineMultiplier: 1,
  speedMultiplier: 1,
  ammoMultiplier: 1,
  shardMultiplier: 1,
  carriedLevels: {},
  canFilterQueue: false,
  canAutoLaunch: false,
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
    return definition ? this.levelOf(id) >= definition.maxLevel : true;
  }

  priceOf(id: MetaUpgradeId): number | null {
    const definition = META_BY_ID.get(id);
    if (!definition || this.isMaxed(id)) return null;
    return Math.round(definition.basePrice * definition.priceGrowth ** this.levelOf(id));
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
   * It also takes a snapshot of where the level upgrades stood, because that is
   * what Mémoire carries into the next image. Only a real clear updates it: a
   * restart must not, or restarting would be a way to bank a build.
   */
  recordClear(input: Omit<ClearInput, "multiplier">, levels: UpgradeLevels = {}): ClearReward {
    const reward = rewardForClear({ ...input, multiplier: this.bonus().shardMultiplier });
    this.earned += reward.total;
    this.clears++;
    this.lastLevels = { ...levels };
    return reward;
  }

  bonus(): PermanentBonus {
    const memory = metaValue("memoire", this.levelOf("memoire"));
    const carriedLevels: UpgradeLevels = {};
    if (memory > 0) {
      for (const [id, level] of Object.entries(this.lastLevels) as [UpgradeId, number][]) {
        const carried = Math.floor(level * memory);
        if (carried > 0) carriedLevels[id] = carried;
      }
    }

    return {
      startingFragments: metaValue("heritage", this.levelOf("heritage")),
      fragmentMultiplier: metaValue("elan", this.levelOf("elan")),
      extraCannons: metaValue("socle", this.levelOf("socle")),
      offlineMultiplier: metaValue("somnambule", this.levelOf("somnambule")),
      speedMultiplier: metaValue("fondation", this.levelOf("fondation")),
      ammoMultiplier: metaValue("atelier", this.levelOf("atelier")),
      shardMultiplier: metaValue("prospecteur", this.levelOf("prospecteur")),
      carriedLevels,
      canFilterQueue: this.levelOf("filtre") > 0,
      canAutoLaunch: this.levelOf("auto") > 0,
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
}

function metaValue(id: MetaUpgradeId, level: number): number {
  return META_BY_ID.get(id)!.valueAt(level);
}
