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

    const price = meta.priceOf("elan")!;
    expect(meta.buy("elan")).toBe(true);
    expect(meta.balance).toBe(20 - price);
    expect(meta.bonus().fragmentMultiplier).toBeCloseTo(1.002, 6);
  });

  it("pays more once Prospecteur is stacked", () => {
    const meta = new MetaProgression({ earned: 100_000 });
    const before = meta.recordClear(plain).total;
    for (let i = 0; i < 50; i++) meta.buy("prospecteur");
    expect(meta.recordClear(plain).total).toBeGreaterThan(before);
  });

  describe("nœuds sans plafond", () => {
    it("never runs out of levels to buy", () => {
      const meta = new MetaProgression({ earned: 1_000_000 });
      for (let i = 0; i < 500; i++) expect(meta.buy("fondation")).toBe(true);
      expect(meta.isMaxed("fondation")).toBe(false);
      expect(meta.priceOf("fondation")).not.toBeNull();
      expect(meta.levelOf("fondation")).toBe(500);
    });

    it("creeps rather than doubles", () => {
      // The whole point of the shape: a geometric price turns an unbounded node
      // into a bounded one after twenty points.
      const meta = new MetaProgression({ earned: 10_000_000 });
      const first = meta.priceOf("fondation")!;
      for (let i = 0; i < 100; i++) meta.buy("fondation");
      const hundredth = meta.priceOf("fondation")!;
      expect(hundredth).toBeGreaterThan(first);
      expect(hundredth).toBeLessThan(first * 20);
    });

    it("moves a fifth of a percent at a time", () => {
      const meta = new MetaProgression({ earned: 1_000_000 });
      for (let i = 0; i < 100; i++) meta.buy("fondation");
      expect(meta.bonus().speedMultiplier).toBeCloseTo(1.2, 6);
    });

    it("discounts the shop without ever reaching free", () => {
      const meta = new MetaProgression({ earned: 100_000_000 });
      for (let i = 0; i < 2000; i++) meta.buy("negoce");
      const price = meta.bonus().priceMultiplier;
      expect(price).toBeLessThan(0.05);
      expect(price).toBeGreaterThan(0);
    });
  });

  describe("capacités", () => {
    it("hides a branch until its capability is bought", () => {
      const meta = new MetaProgression({ earned: 100_000 });
      expect(meta.isAvailable("souffle")).toBe(false);
      expect(meta.priceOf("souffle")).toBeNull();
      expect(meta.buy("souffle")).toBe(false);

      expect(meta.buy("explosion")).toBe(true);
      expect(meta.isAvailable("souffle")).toBe(true);
      expect(meta.buy("souffle")).toBe(true);
    });

    it("leaves a branch inert while its capability is not owned", () => {
      // Nothing can buy into a locked branch, so the bonus stays at zero and
      // the cannon simply does not have the capability.
      const meta = new MetaProgression({ earned: 100_000 });
      expect(meta.bonus().effects.explosionChance).toBe(0);
      meta.buy("explosion");
      expect(meta.bonus().effects.explosionChance).toBeGreaterThan(0);
      expect(meta.bonus().effects.lightningChance).toBe(0);
    });

    it("gives each capability a working baseline the moment it is unlocked", () => {
      const meta = new MetaProgression({ earned: 100_000 });
      for (const id of ["perce", "explosion", "foudre", "feu"] as const) {
        expect(meta.buy(id)).toBe(true);
      }
      const effects = meta.bonus().effects;
      expect(effects.pierceChance).toBeGreaterThan(0);
      expect(effects.pierceDepth).toBeGreaterThan(0);
      expect(effects.explosionRadius).toBeGreaterThan(0);
      expect(effects.lightningArcs).toBeGreaterThan(0);
      expect(effects.fireSpread).toBeGreaterThan(0);
    });

    it("caps a proc chance below certainty", () => {
      const meta = new MetaProgression({ earned: 100_000_000 });
      meta.buy("foudre");
      for (let i = 0; i < 3000; i++) meta.buy("foudreProc");
      expect(meta.bonus().effects.lightningChance).toBeLessThanOrEqual(0.9);
    });

    it("keeps Emplette behind Automate", () => {
      const meta = new MetaProgression({ earned: 100_000 });
      expect(meta.isAvailable("emplette")).toBe(false);
      meta.buy("auto");
      expect(meta.isAvailable("emplette")).toBe(true);
    });
  });

  describe("mémoire", () => {
    it("carries nothing until it is bought", () => {
      const meta = new MetaProgression();
      meta.recordClear(plain, { vitesse: 40, munitions: 20 });
      expect(meta.bonus().carriedLevels).toEqual({});
    });

    it("carries a slice of the last cleared toile's build", () => {
      const meta = new MetaProgression({ earned: 1_000_000 });
      for (let i = 0; i < 100; i++) meta.buy("memoire"); // 20 %
      meta.recordClear(plain, { vitesse: 40, munitions: 20, cases: 2 });

      const carried = meta.bonus().carriedLevels;
      expect(carried.vitesse).toBe(8);
      expect(carried.munitions).toBe(4);
      // A level too small to leave a whole one behind carries nothing.
      expect(carried.cases).toBeUndefined();
    });

    it("never carries the whole build", () => {
      const meta = new MetaProgression({ earned: 100_000_000 });
      for (let i = 0; i < 2000; i++) meta.buy("memoire");
      meta.recordClear(plain, { vitesse: 100 });
      expect(meta.bonus().carriedLevels.vitesse).toBeLessThan(100);
    });

    it("only a real clear updates what is carried", () => {
      const meta = new MetaProgression({ earned: 1_000_000 });
      for (let i = 0; i < 100; i++) meta.buy("memoire");
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
    const meta = new MetaProgression({ earned: 100_000 });
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
    const meta = new MetaProgression({ earned: 1_000_000 });
    for (let i = 0; i < 3; i++) meta.buy("socle");
    for (let i = 0; i < 100; i++) meta.buy("elan");

    const base = new UpgradeState().effects();
    const boosted = new UpgradeState().effects(meta.bonus());

    expect(boosted.maxActiveCannons).toBe(base.maxActiveCannons + 3);
    expect(boosted.fragmentsPerPixel).toBeGreaterThan(base.fragmentsPerPixel);
  });

  it("raises the starting rail and magazine of every image", () => {
    const meta = new MetaProgression({ earned: 1_000_000 });
    for (let i = 0; i < 100; i++) meta.buy("fondation");
    for (let i = 0; i < 100; i++) meta.buy("atelier");

    const base = new UpgradeState().effects();
    const boosted = new UpgradeState().effects(meta.bonus());

    expect(boosted.moveSpeed).toBeGreaterThan(base.moveSpeed);
    expect(boosted.ammoPerLoad).toBeGreaterThan(base.ammoPerLoad);
  });
});
