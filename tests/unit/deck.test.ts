import { describe, expect, it } from "vitest";
import {
  allocateCards,
  deckSizeFor,
  deckWeights,
  generateDeck,
} from "../../src/deck/DeckGenerator";
import { DeckRuntime } from "../../src/deck/DeckRuntime";
import { makeCard, upgradeCard } from "../../src/deck/cards";
import { PixelWorld } from "../../src/world/PixelWorld";
import { PIXEL_COUNT } from "../../src/core/constants";
import { makePalette } from "../fixtures/palette";

function sum(values: Uint32Array | number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

describe("deck generation", () => {
  it("gives every present colour at least one card", () => {
    const counts = [500_000, 200_000, 150_000, 100_000, 50_000, 1];
    const allocation = allocateCards(counts, 12);
    for (let i = 0; i < counts.length; i++) {
      expect(allocation[i]).toBeGreaterThanOrEqual(1);
    }
  });

  it("allocates exactly the requested deck size", () => {
    const counts = [500_000, 200_000, 150_000, 100_000, 50_000];
    for (const deckSize of [5, 8, 12, 16, 24]) {
      expect(sum(allocateCards(counts, deckSize))).toBe(deckSize);
    }
  });

  it("tempers a dominant colour instead of letting it take the whole deck", () => {
    // 50/20/15/10/5 over 12 cards: proportional would give red 6 and drop white.
    const counts = [500_000, 200_000, 150_000, 100_000, 50_000];
    const allocation = allocateCards(counts, 12);
    expect(allocation[0]).toBeLessThanOrEqual(5);
    expect(allocation[4]).toBeGreaterThanOrEqual(1);
  });

  it("gives no card to a colour with no pixels", () => {
    const allocation = allocateCards([100, 0, 50], 6);
    expect(allocation[1]).toBe(0);
    expect(sum(allocation)).toBe(6);
  });

  it("never exceeds the deck size when colours outnumber cards", () => {
    const counts = new Array(16).fill(1000);
    const allocation = allocateCards(counts, 8);
    expect(sum(allocation)).toBe(8);
  });

  it("normalises weights to one", () => {
    const weights = deckWeights([600, 300, 100]);
    expect(sum(Array.from(weights))).toBeCloseTo(1, 10);
  });

  it("handles an all-zero histogram without dividing by zero", () => {
    expect(sum(Array.from(deckWeights([0, 0, 0])))).toBe(0);
    expect(sum(allocateCards([0, 0, 0], 8))).toBe(0);
  });

  it("builds one card object per allocated copy", () => {
    const deck = generateDeck(makePalette(3, [400, 300, 300]), { deckSize: 9 });
    expect(deck).toHaveLength(9);
    expect(new Set(deck.map((card) => card.id)).size).toBe(9);
  });

  it("sizes the deck from the palette, clamped to 12..24", () => {
    expect(deckSizeFor(4)).toBe(12);
    expect(deckSizeFor(6)).toBe(12);
    expect(deckSizeFor(8)).toBe(16);
    expect(deckSizeFor(10)).toBe(20);
    expect(deckSizeFor(12)).toBe(24);
    expect(deckSizeFor(16)).toBe(24);
  });

  it("turns a rare colour into a stronger card", () => {
    // 0.2% of the image: scarce, so the card that spends it hits harder.
    const palette = makePalette(2, [99_800, 200]);
    const deck = generateDeck(palette, { deckSize: 12 });

    const common = deck.find((card) => card.colorId === 0)!;
    const exotic = deck.find((card) => card.colorId === 1)!;

    expect(palette[1].rarity).toBe("exotique");
    expect(exotic.rarity).toBe("exotique");
    expect(exotic.damage).toBeGreaterThan(common.damage);
    expect(exotic.pierce).toBeGreaterThan(common.pierce);
    expect(exotic.ricochet).toBeGreaterThan(common.ricochet);
  });
});

describe("card upgrades", () => {
  it("increases volley size and shortens the cooldown", () => {
    const base = makeCard(0, 0);
    const upgraded = upgradeCard(base);
    expect(upgraded.ballCount).toBeGreaterThan(base.ballCount);
    expect(upgraded.fireIntervalMs).toBeLessThan(base.fireIntervalMs);
    expect(upgraded.level).toBe(2);
  });

  it("switches to a logical burst at high level, which is the batched regime", () => {
    let card = makeCard(0, 0);
    for (let i = 0; i < 8; i++) card = upgradeCard(card);
    expect(card.logicalBurst).toBeGreaterThan(0);
    expect(card.modifiers).toContain("burst");
  });
});

describe("DeckRuntime", () => {
  function world(paletteSize: number, aliveColors: number[]): PixelWorld {
    const colorId = new Uint8Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      colorId[i] = aliveColors[i % aliveColors.length];
    }
    return PixelWorld.create(makePalette(paletteSize), colorId);
  }

  it("fires immediately, then respects the interval once consumed", () => {
    const deck = new DeckRuntime([makeCard(0, 0)]);
    // A fresh deck is armed on the first tick rather than idling one cooldown.
    const [slot] = deck.tick(16);
    expect(slot).toBeDefined();

    deck.markFired(slot);
    expect(deck.tick(100)).toHaveLength(0);
    expect(deck.tick(700)).toHaveLength(1);
  });

  it("stays armed until the volley actually leaves the cannon", () => {
    const deck = new DeckRuntime([makeCard(0, 0)]);
    // The cannon may face a lane with no matching pixel for several frames;
    // the card must not lose its shot in the meantime.
    expect(deck.tick(16)).toHaveLength(1);
    expect(deck.tick(16)).toHaveLength(1);
    expect(deck.tick(16)).toHaveLength(1);

    deck.markFired(deck.slots[0]);
    expect(deck.tick(16)).toHaveLength(0);
  });

  it("does not burst catch-up volleys after a long stall", () => {
    const deck = new DeckRuntime([makeCard(0, 0)]);
    deck.markFired(deck.tick(16)[0]); // consume the opening volley

    const ready = deck.tick(60_000);
    expect(ready).toHaveLength(1);
    deck.markFired(ready[0]);
    expect(deck.tick(100)).toHaveLength(0);
  });

  it("turns cards of an exhausted colour prismatic and retargets them", () => {
    const w = world(3, [1, 2]); // colour 0 has no pixel at all
    const deck = new DeckRuntime([makeCard(0, 0)]);
    deck.syncExhaustedColors(w);

    const card = deck.slots[0].card;
    expect(card.prismatic).toBe(true);
    const target = deck.resolveTarget(card, w);
    expect(target === 1 || target === 2).toBe(true);
  });

  it("reports -1 as target once the whole board is cleared", () => {
    const w = world(2, [0]);
    const deck = new DeckRuntime([makeCard(0, 0)]);
    w.destroyRandomOfColor(0, PIXEL_COUNT, { nextInt: () => 0, nextFloat: () => 0, snapshot: () => 0 });
    deck.syncExhaustedColors(w);
    expect(deck.resolveTarget(deck.slots[0].card, w)).toBe(-1);
  });

  it("derives a per-colour DPS the offline model can consume", () => {
    const w = world(2, [0, 1]);
    const deck = new DeckRuntime([makeCard(0, 0), makeCard(1, 0)]);
    deck.syncExhaustedColors(w);
    const dps = deck.damagePerSecondByColor(w);
    expect(dps).toHaveLength(2);
    for (const value of dps) expect(value).toBeGreaterThan(0);
  });
});
