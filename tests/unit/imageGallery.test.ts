import { describe, expect, it } from "vitest";
import {
  ImageGallery,
  THUMBNAIL_SIZE,
  decodeThumbnail,
  hashImage,
  thumbnailOf,
} from "../../src/progression/ImageGallery";
import { makePalette } from "../fixtures/palette";

/** A tiny board: bands of colour, so a thumbnail has something to preserve. */
function board(width: number, height: number, bands: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor((i % width) / (width / bands));
  return out;
}

describe("hashImage", () => {
  it("gives the same image the same identity", () => {
    const palette = makePalette(4, [10, 20, 30, 40]);
    const colorId = board(64, 64, 4);
    expect(hashImage(palette, colorId)).toBe(hashImage(palette, colorId.slice()));
  });

  it("separates images that differ in their board", () => {
    const palette = makePalette(4, [10, 20, 30, 40]);
    expect(hashImage(palette, board(64, 64, 4))).not.toBe(hashImage(palette, board(64, 64, 2)));
  });

  it("separates images that share a palette but not its distribution", () => {
    // Same hues, different counts: not the same toile, and not the same run.
    const colorId = board(64, 64, 4);
    expect(hashImage(makePalette(4, [10, 20, 30, 40]), colorId)).not.toBe(
      hashImage(makePalette(4, [40, 30, 20, 10]), colorId),
    );
  });
});

describe("thumbnailOf", () => {
  it("keeps the picture's shape at a readable size", () => {
    const decoded = decodeThumbnail(thumbnailOf(board(64, 64, 2), 64, 64));
    expect(decoded).not.toBeNull();
    expect(decoded).toHaveLength(THUMBNAIL_SIZE * THUMBNAIL_SIZE);
    // Two bands in, two bands out: the left half is colour 0, the right 1.
    expect(decoded![0]).toBe(0);
    expect(decoded![THUMBNAIL_SIZE - 1]).toBe(1);
  });

  it("never invents a colour the image does not have", () => {
    // Averaging palette indices would produce indices between two colours —
    // exactly what the rest of the game refuses to do.
    const colorId = board(60, 60, 3);
    const decoded = decodeThumbnail(thumbnailOf(colorId, 60, 60))!;
    const seen = new Set(decoded);
    for (const index of seen) expect([0, 1, 2]).toContain(index);
  });

  it("refuses a thumbnail of the wrong size", () => {
    expect(decodeThumbnail("bm90IGEgdGh1bWJuYWls")).toBeNull();
    expect(decodeThumbnail("!!!not base64!!!")).toBeNull();
  });
});

describe("ImageGallery", () => {
  const entry = {
    id: "abc123",
    name: "affiche.png",
    paletteSize: 8,
    playablePixels: 589_824,
    swatches: [{ r: 10, g: 20, b: 30 }],
    thumbnail: thumbnailOf(board(32, 32, 2), 32, 32),
  };

  it("remembers an image, and keeps its history on the way back", () => {
    const gallery = new ImageGallery();
    gallery.remember(entry, 1000);
    gallery.noteClear(entry.id, 60_000, 25, 1000);

    // Coming back to the same image must not reset what it holds — that is the
    // whole reason it is remembered.
    gallery.remember({ ...entry, name: "affiche.png" }, 5000);
    const record = gallery.get(entry.id)!;
    expect(record.clears).toBe(1);
    expect(record.bestMs).toBe(60_000);
    expect(record.firstPlayedAtMs).toBe(1000);
    expect(record.lastPlayedAtMs).toBe(5000);
  });

  it("annonce un record, et seulement quand c'en est un", () => {
    const gallery = new ImageGallery();
    gallery.remember(entry, 0);

    const first = gallery.noteClear(entry.id, 90_000, 25, 0)!;
    expect(first.isRecord).toBe(true);
    expect(first.previousBestMs).toBeNull();

    const slower = gallery.noteClear(entry.id, 120_000, 25, 0)!;
    expect(slower.isRecord).toBe(false);
    expect(slower.previousBestMs).toBe(90_000);
    expect(gallery.get(entry.id)!.bestMs).toBe(90_000);
    expect(gallery.get(entry.id)!.lastMs).toBe(120_000);

    const faster = gallery.noteClear(entry.id, 45_000, 25, 0)!;
    expect(faster.isRecord).toBe(true);
    expect(faster.previousBestMs).toBe(90_000);
    expect(gallery.get(entry.id)!.bestMs).toBe(45_000);
  });

  it("cumule les éclats et les passages", () => {
    const gallery = new ImageGallery();
    gallery.remember(entry, 0);
    gallery.noteClear(entry.id, 90_000, 25, 0);
    gallery.noteClear(entry.id, 80_000, 31, 0);

    const record = gallery.get(entry.id)!;
    expect(record.clears).toBe(2);
    expect(record.shards).toBe(56);
  });

  it("ignore une fin de toile sur une image inconnue", () => {
    expect(new ImageGallery().noteClear("jamais-vue", 1000, 5, 0)).toBeNull();
  });

  it("range la plus récemment jouée en tête", () => {
    const gallery = new ImageGallery();
    gallery.remember({ ...entry, id: "vieille" }, 100);
    gallery.remember({ ...entry, id: "recente" }, 900);
    expect(gallery.all().map((r) => r.id)).toEqual(["recente", "vieille"]);
  });

  it("round-trips through serialize", () => {
    const gallery = new ImageGallery();
    gallery.remember(entry, 42);
    gallery.noteClear(entry.id, 70_000, 25, 42);

    const restored = ImageGallery.restore(gallery.serialize());
    expect(restored.size).toBe(1);
    expect(restored.get(entry.id)).toEqual(gallery.get(entry.id));
  });
});
