import { describe, expect, it } from "vitest";
import {
  MetaProgression,
  rewardForClear,
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

  const plain = { playablePixels: 1_000_000, paletteSize: 6, awkwardColors: 0, pass: 1 };

  it("pays more for a dense image than for a sparse one", () => {
    expect(rewardForClear(plain).total).toBeGreaterThan(
      rewardForClear({ ...plain, playablePixels: 50_000 }).total,
    );
  });

  it("pays more for a palette with more colours to juggle", () => {
    expect(rewardForClear({ ...plain, paletteSize: 16 }).total).toBeGreaterThan(
      rewardForClear(plain).total,
    );
  });

  it("pays for the rare colours the palette detection kept", () => {
    // A colour down to a fraction of a percent is what strands a run behind
    // another colour's facade — keeping it has to be worth something.
    expect(rewardForClear({ ...plain, awkwardColors: 3 }).total).toBeGreaterThan(
      rewardForClear(plain).total,
    );
  });

  it("still pays on a later pass, and more", () => {
    expect(rewardForClear({ ...plain, pass: 3 }).total).toBeGreaterThan(
      rewardForClear(plain).total,
    );
  });

  it("never pays zero, however small the image", () => {
    expect(rewardForClear({ ...plain, playablePixels: 1 }).total).toBeGreaterThan(0);
  });

  it("itemises the reward so the panel can show why", () => {
    const reward = rewardForClear({
      playablePixels: 1_000_000,
      paletteSize: 12,
      awkwardColors: 2,
      pass: 2,
    });

    expect(reward.base).toBe(20);
    expect(reward.paletteFactor).toBeCloseTo(1.6, 6);
    expect(reward.rarityFactor).toBeCloseTo(1.3, 6);
    expect(reward.passFactor).toBeCloseTo(1.25, 6);
    expect(reward.total).toBe(Math.round(20 * 1.6 * 1.3 * 1.25));
  });

  it("banks a clear and lets it be spent", () => {
    const meta = new MetaProgression();
    const reward = meta.recordClear(plain);

    expect(reward.total).toBe(20);
    expect(meta.balance).toBe(20);
    expect(meta.totalClears).toBe(1);
    expect(meta.buy("elan")).toBe(true);
    expect(meta.balance).toBe(17);
    expect(meta.bonus().fragmentMultiplier).toBeCloseTo(1.1, 6);
  });

  it("pays more once Prospecteur is bought", () => {
    const meta = new MetaProgression({ earned: 100 });
    const before = meta.recordClear(plain).total;
    for (let i = 0; i < 5; i++) meta.buy("prospecteur");
    expect(meta.recordClear(plain).total).toBeGreaterThan(before);
  });

  describe("mémoire", () => {
    it("carries nothing until it is bought", () => {
      const meta = new MetaProgression();
      meta.recordClear(plain, { vitesse: 40, munitions: 20 });
      expect(meta.bonus().carriedLevels).toEqual({});
    });

    it("carries a slice of the last cleared toile's build", () => {
      const meta = new MetaProgression({ earned: 10_000 });
      for (let i = 0; i < 8; i++) meta.buy("memoire"); // 20 %
      meta.recordClear(plain, { vitesse: 40, munitions: 20, cases: 2 });

      const carried = meta.bonus().carriedLevels;
      expect(carried.vitesse).toBe(8);
      expect(carried.munitions).toBe(4);
      // A level too small to leave a whole one behind carries nothing.
      expect(carried.cases).toBeUndefined();
    });

    it("only a real clear updates what is carried", () => {
      const meta = new MetaProgression({ earned: 10_000 });
      for (let i = 0; i < 8; i++) meta.buy("memoire");
      meta.recordClear(plain, { vitesse: 40 });

      // Nothing else touches the snapshot: a restart must never bank a build.
      expect(MetaProgression.restore(meta.serialize()).bonus().carriedLevels.vitesse).toBe(8);
    });
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
    meta.recordClear(plain, { vitesse: 12 });
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

    const base = new UpgradeState().effects();
    const boosted = new UpgradeState().effects(meta.bonus());

    expect(boosted.maxActiveCannons).toBe(base.maxActiveCannons + 3);
    expect(boosted.fragmentsPerPixel).toBeGreaterThan(base.fragmentsPerPixel);
  });

  it("raises the starting rail and magazine of every image", () => {
    const meta = new MetaProgression({ earned: 10_000 });
    for (let i = 0; i < 6; i++) meta.buy("fondation");
    for (let i = 0; i < 6; i++) meta.buy("atelier");

    const base = new UpgradeState().effects();
    const boosted = new UpgradeState().effects(meta.bonus());

    expect(boosted.moveSpeed).toBeGreaterThan(base.moveSpeed);
    expect(boosted.ammoPerLoad).toBeGreaterThan(base.ammoPerLoad);
  });
});
