import type { QuantizerKind } from "./quantization";

export type FitMode = "contain" | "cover" | "stretch";

export interface ImageProcessOptions {
  width: number;
  height: number;
  fit: FitMode;
  /**
   * Number of colours to force. Omit it — the normal case — and the worker
   * detects the palette from the image itself: the image defines the level,
   * so the player never picks this.
   */
  paletteSize?: number;
  /** Omit to let the worker pick by device profile. */
  quantizer?: QuantizerKind;
  alphaThreshold: number;
  /**
   * When true the letterbox margins become a playable background color instead
   * of VOID, guaranteeing exactly 1_048_576 destructible cells.
   */
  fillMargins: boolean;
}

export type ImageStage = "decode" | "resize" | "histogram" | "palette" | "map" | "index";

export interface ImageProcessRequest {
  v: 1;
  requestId: string;
  type: "IMAGE_PROCESS";
  file: Blob;
  options: ImageProcessOptions;
}

export interface ImageCancelRequest {
  v: 1;
  requestId: string;
  type: "CANCEL";
}

export type ImageWorkerRequest = ImageProcessRequest | ImageCancelRequest;

import type { ColorRarity } from "../core/constants";

export interface ImagePaletteEntry {
  id: number;
  r: number;
  g: number;
  b: number;
  a: number;
  count: number;
  /** Share of the playable pixels, in [0, 1]. */
  share: number;
  rarity: ColorRarity;
  /** Lab distance to the nearest other palette entry. */
  separation: number;
}

export interface ImageProgressResponse {
  v: 1;
  requestId: string;
  type: "IMAGE_PROGRESS";
  stage: ImageStage;
  progress: number;
}

export interface ImageResultResponse {
  v: 1;
  requestId: string;
  type: "IMAGE_RESULT";
  width: number;
  height: number;
  palette: ImagePaletteEntry[];
  colorId: ArrayBuffer;
  counts: ArrayBuffer;
  stats: {
    playablePixels: number;
    voidPixels: number;
    effectivePaletteSize: number;
    /** How the palette was arrived at, for the level summary screen. */
    paletteDetection: {
      automatic: boolean;
      candidates: Array<{
        k: number;
        score: number;
        breakdown: {
          visualQuality: number;
          colorSeparation: number;
          gameplayDistribution: number;
          tinyClusterPenalty: number;
        };
      }>;
      /** Palette ids kept despite being tiny, because they are distinct. */
      rareColors: number[];
    };
    sourceWidth: number;
    sourceHeight: number;
    durationMs: number;
  };
}

export interface ImageErrorResponse {
  v: 1;
  requestId: string;
  type: "ERROR";
  code: string;
  message: string;
}

export type ImageWorkerResponse =
  | ImageProgressResponse
  | ImageResultResponse
  | ImageErrorResponse;

export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Product limit, deliberately conservative for the prototype. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_SOURCE_DIMENSION = 16384;

export function validateImageFile(file: File | Blob & { name?: string }): string | null {
  if (file.size === 0) return "Fichier vide.";
  if (file.size > MAX_FILE_BYTES) {
    return `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo, max ${MAX_FILE_BYTES / 1024 / 1024} Mo).`;
  }
  if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return `Format non supporté (${file.type || "inconnu"}). Utilisez PNG, JPEG ou WebP.`;
  }
  return null;
}
