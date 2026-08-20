/// <reference lib="webworker" />

import { computeDrawRect } from "../image/drawRect";
import type {
  ImageProcessOptions,
  ImageStage,
  ImageWorkerRequest,
  ImageWorkerResponse,
} from "../image/ImageProtocol";
import { MAX_SOURCE_DIMENSION } from "../image/ImageProtocol";
import { buildHistogram } from "../image/quantization/histogram";
import { medianCut } from "../image/quantization/medianCut";
import { refineKMeans } from "../image/quantization/kmeans";
import { mapPixels } from "../image/quantization/mapping";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The image pipeline runs entirely off the main thread: decode, resize through
 * OffscreenCanvas, histogram, palette, remap. Only the two result buffers
 * cross back, and they cross by transfer, not by copy.
 */

let currentRequestId: string | null = null;

ctx.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "CANCEL") {
    if (currentRequestId === msg.requestId) currentRequestId = null;
    return;
  }
  if (msg.type !== "IMAGE_PROCESS") return;

  currentRequestId = msg.requestId;
  const startedAt = performance.now();

  try {
    const { requestId, file, options } = msg;

    progress(requestId, "decode", 0);
    const bitmap = await createImageBitmap(file);
    if (isStale(requestId)) return;

    if (bitmap.width > MAX_SOURCE_DIMENSION || bitmap.height > MAX_SOURCE_DIMENSION) {
      bitmap.close();
      throw new Error(
        `Image trop grande (${bitmap.width}x${bitmap.height}, max ${MAX_SOURCE_DIMENSION}px par côté).`,
      );
    }

    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;

    progress(requestId, "decode", 1);
    progress(requestId, "resize", 0);

    const rgba = rasterize(bitmap, options);
    // The full resolution decode is released immediately: the only durable
    // large buffer must be the 1024x1024 board.
    bitmap.close();
    if (isStale(requestId)) return;

    if (options.fillMargins) {
      fillTransparentWithBackground(rgba, options.alphaThreshold);
    }

    progress(requestId, "resize", 1);
    progress(requestId, "histogram", 0);

    const histogram = buildHistogram(rgba, options.alphaThreshold);
    if (isStale(requestId)) return;

    if (histogram.totalWeight === 0) {
      throw new Error("Image entièrement transparente : aucun pixel jouable.");
    }

    progress(requestId, "histogram", 1);
    progress(requestId, "palette", 0);

    const effectiveK = Math.min(options.paletteSize, histogram.distinctBuckets);
    let palette = medianCut(histogram, effectiveK);
    if (options.quantizer === "median-cut+kmeans" && palette.length > 1) {
      palette = refineKMeans(histogram, palette);
    }
    palette = dedupe(palette);
    if (isStale(requestId)) return;

    progress(requestId, "palette", 1);
    progress(requestId, "map", 0);

    const mapped = mapPixels(rgba, palette, options.alphaThreshold);
    if (isStale(requestId)) return;

    progress(requestId, "map", 1);
    progress(requestId, "index", 1);

    const response: ImageWorkerResponse = {
      v: 1,
      requestId,
      type: "IMAGE_RESULT",
      width: options.width,
      height: options.height,
      palette: palette.map((c, id) => ({
        id,
        r: c.r,
        g: c.g,
        b: c.b,
        a: 255,
        count: mapped.counts[id],
      })),
      colorId: mapped.colorId.buffer as ArrayBuffer,
      counts: mapped.counts.buffer as ArrayBuffer,
      stats: {
        playablePixels: mapped.playablePixels,
        voidPixels: mapped.voidPixels,
        effectivePaletteSize: palette.length,
        sourceWidth,
        sourceHeight,
        durationMs: performance.now() - startedAt,
      },
    };

    ctx.postMessage(response, [response.colorId, response.counts]);
    currentRequestId = null;
  } catch (error) {
    ctx.postMessage({
      v: 1,
      requestId: msg.requestId,
      type: "ERROR",
      code: "IMAGE_PROCESS_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies ImageWorkerResponse);
    currentRequestId = null;
  }
};

function isStale(requestId: string): boolean {
  return currentRequestId !== requestId;
}

function rasterize(bitmap: ImageBitmap, options: ImageProcessOptions): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(options.width, options.height);
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("OffscreenCanvas 2D indisponible.");

  context.clearRect(0, 0, options.width, options.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const rect = computeDrawRect(
    bitmap.width,
    bitmap.height,
    options.width,
    options.height,
    options.fit,
  );

  context.drawImage(
    bitmap,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    rect.dx,
    rect.dy,
    rect.dw,
    rect.dh,
  );

  return context.getImageData(0, 0, options.width, options.height).data;
}

/**
 * "Full million" mode: transparent cells adopt the mean color of the visible
 * pixels so the whole 1024x1024 surface stays destructible.
 */
function fillTransparentWithBackground(rgba: Uint8ClampedArray, alphaThreshold: number): void {
  let count = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] < alphaThreshold) continue;
    r += rgba[p];
    g += rgba[p + 1];
    b += rgba[p + 2];
    count++;
  }
  if (count === 0) return;

  const meanR = Math.round(r / count);
  const meanG = Math.round(g / count);
  const meanB = Math.round(b / count);

  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] >= alphaThreshold) continue;
    rgba[p] = meanR;
    rgba[p + 1] = meanG;
    rgba[p + 2] = meanB;
    rgba[p + 3] = 255;
  }
}

function dedupe<T extends { r: number; g: number; b: number }>(palette: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const c of palette) {
    const key = (c.r << 16) | (c.g << 8) | c.b;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function progress(requestId: string, stage: ImageStage, value: number): void {
  ctx.postMessage({
    v: 1,
    requestId,
    type: "IMAGE_PROGRESS",
    stage,
    progress: value,
  } satisfies ImageWorkerResponse);
}
