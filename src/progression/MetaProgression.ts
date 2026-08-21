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

/**
 * Éclats paid by clearing a toile.
 *
 * Scaled by the image rather than flat, so a dense picture is worth more than a
 * mostly-transparent logo, and nudged by the pass number so a second pass over
 * an image the player already knows still pays — less, but not nothing.
 */
export function shardsForClear(playablePixels: number, pass: number): number {
  const base = Math.max(1, Math.round(playablePixels / 50_000));
  return Math.max(1, Math.round(base * (1 + (pass - 1) * 0.25)));
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
  canFilterQueue: boolean;
  canAutoLaunch: boolean;
}

export const NO_PERMANENT_BONUS: PermanentBonus = {
  startingFragments: 0,
  fragmentMultiplier: 1,
  extraCannons: 0,
  offlineMultiplier: 1,
  canFilterQueue: false,
  canAutoLaunch: false,
};

export interface MetaSnapshot {
  levels: MetaLevels;
  earned: number;
  spent: number;
  /** Images cleared, all toiles and all passes together. */
  clears: number;
}

export class MetaProgression {
  private readonly levels: Map<MetaUpgradeId, number>;
  private earned: number;
  private spent: number;
  private clears: number;

  constructor(snapshot: Partial<MetaSnapshot> = {}) {
    this.levels = new Map(META_UPGRADES.map((u) => [u.id, snapshot.levels?.[u.id] ?? 0]));
    this.earned = snapshot.earned ?? 0;
    this.spent = snapshot.spent ?? 0;
    this.clears = snapshot.clears ?? 0;
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

  /** Records a cleared toile and pays for it. Returns the éclats granted. */
  recordClear(playablePixels: number, pass: number): number {
    const shards = shardsForClear(playablePixels, pass);
    this.earned += shards;
    this.clears++;
    return shards;
  }

  bonus(): PermanentBonus {
    return {
      startingFragments: metaValue("heritage", this.levelOf("heritage")),
      fragmentMultiplier: metaValue("elan", this.levelOf("elan")),
      extraCannons: metaValue("socle", this.levelOf("socle")),
      offlineMultiplier: metaValue("somnambule", this.levelOf("somnambule")),
      canFilterQueue: this.levelOf("filtre") > 0,
      canAutoLaunch: this.levelOf("auto") > 0,
    };
  }

  serialize(): MetaSnapshot {
    const levels: MetaLevels = {};
    for (const [id, level] of this.levels) if (level > 0) levels[id] = level;
    return { levels, earned: this.earned, spent: this.spent, clears: this.clears };
  }

  static restore(snapshot?: Partial<MetaSnapshot>): MetaProgression {
    return new MetaProgression(snapshot ?? {});
  }
}

function metaValue(id: MetaUpgradeId, level: number): number {
  return META_BY_ID.get(id)!.valueAt(level);
}
