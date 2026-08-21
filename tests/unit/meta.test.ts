import { describe, expect, it } from "vitest";
import {
  MetaProgression,
  shardsForClear,
  NO_PERMANENT_BONUS,
} from "../../src/progression/MetaProgression";
import { UpgradeState } from "../../src/progression/Upgrades";

describe("MetaProgression", () => {
  it("pays nothing until a toile is actually cleared", () => {
    const meta = new MetaProgression();
    expect(meta.balance).toBe(0);
    expect(meta.totalClears).toBe(0);
    expect(meta.bonus()).toEqual(NO_PERMANENT_BONUS);
  });

  it("pays more for a dense image than for a sparse one", () => {
    expect(shardsForClear(1_000_000, 1)).toBeGreaterThan(shardsForClear(50_000, 1));
  });

  it("still pays on a later pass, and more", () => {
    expect(shardsForClear(1_000_000, 3)).toBeGreaterThan(shardsForClear(1_000_000, 1));
  });

  it("never pays zero, however small the image", () => {
    expect(shardsForClear(1, 1)).toBeGreaterThan(0);
  });

  it("banks a clear and lets it be spent", () => {
    const meta = new MetaProgression();
    const shards = meta.recordClear(1_000_000, 1);

    expect(shards).toBe(20);
    expect(meta.balance).toBe(20);
    expect(meta.totalClears).toBe(1);
    expect(meta.buy("elan")).toBe(true);
    expect(meta.balance).toBe(17);
    expect(meta.bonus().fragmentMultiplier).toBeCloseTo(1.1, 6);
  });

  it("refuses what it cannot pay for", () => {
    const meta = new MetaProgression();
    expect(meta.canAfford("auto")).toBe(false);
    expect(meta.buy("auto")).toBe(false);
    expect(meta.bonus().canAutoLaunch).toBe(false);
  });

  it("treats the comfort unlocks as one-shot", () => {
    const meta = new MetaProgression({ earned: 1000 });
    expect(meta.buy("filtre")).toBe(true);
    expect(meta.bonus().canFilterQueue).toBe(true);
    expect(meta.isMaxed("filtre")).toBe(true);
    expect(meta.buy("filtre")).toBe(false);
  });

  it("round-trips through serialize", () => {
    const meta = new MetaProgression({ earned: 500 });
    meta.recordClear(1_000_000, 1);
    meta.buy("socle");
    meta.buy("heritage");

    const restored = MetaProgression.restore(meta.serialize());
    expect(restored.balance).toBe(meta.balance);
    expect(restored.totalClears).toBe(meta.totalClears);
    expect(restored.bonus()).toEqual(meta.bonus());
  });

  it("hands its bonus to a level's effects", () => {
    const meta = new MetaProgression({ earned: 10_000 });
    for (let i = 0; i < 3; i++) meta.buy("socle");
    meta.buy("elan");

    const plain = new UpgradeState().effects();
    const boosted = new UpgradeState().effects(meta.bonus());

    expect(boosted.maxActiveCannons).toBe(plain.maxActiveCannons + 3);
    expect(boosted.fragmentsPerPixel).toBeGreaterThan(plain.fragmentsPerPixel);
  });
});
