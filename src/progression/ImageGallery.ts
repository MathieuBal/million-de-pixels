import type { PaletteEntry } from "../core/constants";

/**
 * Les images déjà jouées, et ce qu'elles ont coûté de temps.
 *
 * Le jeu récompensait déjà de rejouer une image — `passFactor` vaut +25 % par
 * passage — mais rien ne se souvenait d'une image d'un lancement à l'autre :
 * chaque toile était un orphelin, et « rejouer » voulait dire réimporter un
 * fichier au hasard. Une image qu'on retrouve, avec le temps qu'on y a mis et
 * le meilleur qu'on y a fait, change ce que la question « et maintenant ? »
 * veut dire : rejouer celle-ci pour le temps, ou en importer une neuve pour
 * ses teintes.
 *
 * C'est aussi la seule décision que ni les fragments ni les éclats ne savent
 * poser. Mesuré sur deux cents toiles, trois stratégies opposées de l'arbre
 * permanent finissent à moins d'un pour cent l'une de l'autre : sept nœuds qui
 * multiplient chacun quelque chose ne font pas sept choix. Choisir *quelle
 * image* en est un.
 */

/** Côté de la vignette carrée gardée pour chaque image. */
export const THUMBNAIL_SIZE = 32;

export interface ImageRecord {
  /** Empreinte du plateau quantifié : réimporter le même fichier le retrouve. */
  id: string;
  name: string;
  paletteSize: number;
  playablePixels: number;
  /** Les couleurs de la vignette, telles qu'elles étaient sur le plateau. */
  swatches: Array<{ r: number; g: number; b: number }>;
  /** `THUMBNAIL_SIZE²` indices de palette, ou 255 pour une cellule vide. */
  thumbnail: string;
  /** Toiles menées jusqu'au bout sur cette image. */
  clears: number;
  /** Meilleur temps de jeu, en millisecondes. Null tant qu'aucun passage fini. */
  bestMs: number | null;
  /** Dernier temps, pour que l'écran de fin puisse dire « contre ». */
  lastMs: number | null;
  /** Éclats rapportés par cette image, tous passages confondus. */
  shards: number;
  firstPlayedAtMs: number;
  lastPlayedAtMs: number;
}

export type GallerySnapshot = Record<string, ImageRecord>;

/**
 * L'empreinte d'une image quantifiée.
 *
 * FNV-1a sur la palette et sur un échantillon régulier du plateau. Un
 * échantillon plutôt que le million de cellules parce que l'empreinte doit
 * être calculée à chaque import sans faire attendre : deux images qui
 * coïncident sur quatre mille cellules réparties *et* sur toute leur palette
 * sont la même image, et si elles ne le sont pas, la seule conséquence est de
 * partager une ligne de galerie.
 */
export function hashImage(palette: readonly PaletteEntry[], colorId: Uint8Array): string {
  let hash = 0x811c9dc5;
  const mix = (byte: number) => {
    hash ^= byte & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };

  mix(palette.length);
  for (const entry of palette) {
    mix(entry.r);
    mix(entry.g);
    mix(entry.b);
    // Le compte, pas seulement la teinte : deux images de mêmes couleurs mais
    // de répartitions différentes ne sont pas la même toile.
    mix(entry.count & 0xff);
    mix((entry.count >>> 8) & 0xff);
    mix((entry.count >>> 16) & 0xff);
  }

  const step = Math.max(1, Math.floor(colorId.length / 4096));
  for (let i = 0; i < colorId.length; i += step) mix(colorId[i]);

  return hash.toString(16).padStart(8, "0");
}

/**
 * Réduit le plateau à une vignette carrée d'indices de palette.
 *
 * Un échantillonnage au plus proche voisin, pas une moyenne : moyenner des
 * indices de palette produirait des couleurs que l'image ne contient pas, ce
 * qui est exactement ce que tout le jeu s'interdit.
 */
export function thumbnailOf(
  colorId: Uint8Array,
  width: number,
  height: number,
  size = THUMBNAIL_SIZE,
): string {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / size));
      out[y * size + x] = colorId[sy * width + sx];
    }
  }
  // Base64 sans dépendance : la vignette voyage dans une chaîne de réglages.
  let binary = "";
  for (const byte of out) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Relit une vignette. Renvoie null si la chaîne ne fait pas la bonne taille. */
export function decodeThumbnail(encoded: string, size = THUMBNAIL_SIZE): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return null;
  }
  if (binary.length !== size * size) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export interface ClearOutcome {
  /** Le temps de ce passage. */
  ms: number;
  /** Vrai si ce passage est le meilleur — ce que l'écran de fin annonce. */
  isRecord: boolean;
  /** Le meilleur temps *avant* celui-ci, pour pouvoir dire « contre ». */
  previousBestMs: number | null;
}

export class ImageGallery {
  private readonly images: Map<string, ImageRecord>;

  constructor(snapshot: GallerySnapshot = {}) {
    this.images = new Map(Object.entries(snapshot));
  }

  get size(): number {
    return this.images.size;
  }

  get(id: string): ImageRecord | null {
    return this.images.get(id) ?? null;
  }

  /** Les images, la plus récemment jouée en tête. */
  all(): ImageRecord[] {
    return [...this.images.values()].sort((a, b) => b.lastPlayedAtMs - a.lastPlayedAtMs);
  }

  /**
   * Note qu'une image a été lancée. Une image déjà connue garde son histoire —
   * c'est tout l'intérêt — et ne met à jour que sa date.
   */
  remember(
    entry: Omit<ImageRecord, "clears" | "bestMs" | "lastMs" | "shards" | "firstPlayedAtMs" | "lastPlayedAtMs">,
    nowMs: number,
  ): ImageRecord {
    const known = this.images.get(entry.id);
    if (known) {
      known.lastPlayedAtMs = nowMs;
      known.name = entry.name;
      return known;
    }

    const record: ImageRecord = {
      ...entry,
      clears: 0,
      bestMs: null,
      lastMs: null,
      shards: 0,
      firstPlayedAtMs: nowMs,
      lastPlayedAtMs: nowMs,
    };
    this.images.set(record.id, record);
    return record;
  }

  /**
   * Enregistre une toile finie, et dit si c'est un record.
   *
   * Le temps compté est du temps *joué* : une partie laissée en pause ou fermée
   * ne se met pas à ralentir un record, sans quoi le score mesurerait la
   * patience du navigateur plutôt que ce que le joueur a construit.
   */
  noteClear(id: string, playedMs: number, shards: number, nowMs: number): ClearOutcome | null {
    const record = this.images.get(id);
    if (!record) return null;

    const previousBestMs = record.bestMs;
    const isRecord = previousBestMs === null || playedMs < previousBestMs;

    record.clears++;
    record.lastMs = playedMs;
    if (isRecord) record.bestMs = playedMs;
    record.shards += shards;
    record.lastPlayedAtMs = nowMs;

    return { ms: playedMs, isRecord, previousBestMs };
  }

  serialize(): GallerySnapshot {
    return Object.fromEntries([...this.images].map(([id, record]) => [id, { ...record }]));
  }

  static restore(snapshot?: GallerySnapshot): ImageGallery {
    return new ImageGallery(snapshot ?? {});
  }
}
