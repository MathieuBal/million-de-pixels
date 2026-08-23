import { describe, expect, it } from "vitest";
import {
  CRAFT_PER_CLEAR,
  META_BY_ID,
  META_UPGRADES,
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

  it("paie de plus en plus à mesure que le profil finit des toiles", () => {
    // The defect this fixes, measured: twenty-five éclats a clear on toile one
    // and on toile ten alike, against a tree whose compounding nodes wanted
    // thousands. A straight line is not a progression curve.
    const first = rewardForClear({ ...plain, clears: 0 }).total;
    const tenth = rewardForClear({ ...plain, clears: 10 }).total;
    const fortieth = rewardForClear({ ...plain, clears: 40 }).total;

    expect(tenth).toBeGreaterThan(first);
    expect(fortieth).toBeGreaterThan(tenth);
    expect(rewardForClear({ ...plain, clears: 10 }).craftFactor).toBeCloseTo(
      1 + 10 * CRAFT_PER_CLEAR,
      9,
    );
  });

  it("compte les toiles déjà finies, jamais celle qu'on vient de finir", () => {
    // The reward is what the profile brought to the image, not what it is about
    // to be worth: paying for the current clear would make the first one pay a
    // bonus for itself.
    const meta = new MetaProgression();
    expect(meta.recordClear(plain).craftFactor).toBe(1);
    expect(meta.recordClear(plain).craftFactor).toBeCloseTo(1 + CRAFT_PER_CLEAR, 9);
  });

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
    // A first clear has no toiles behind it, so Métier pays nothing yet.
    expect(reward.craftFactor).toBe(1);

    const price = meta.priceOf("elan")!;
    expect(meta.buy("elan")).toBe(true);
    expect(meta.balance).toBe(20 - price);
    expect(meta.bonus().fragmentMultiplier).toBeCloseTo(
      META_BY_ID.get("elan")!.valueAt(1),
      6,
    );
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

    it("avance d'un pas fixe, quel qu'il soit", () => {
      // Read the tick rather than write it down: it is a balancing number and
      // has already moved once, from a fifth of a percent to two fifths.
      const meta = new MetaProgression({ earned: 1_000_000 });
      const step = meta.buy("fondation") ? meta.bonus().speedMultiplier - 1 : 0;
      expect(step).toBeGreaterThan(0);
      for (let i = 1; i < 100; i++) meta.buy("fondation");
      expect(meta.bonus().speedMultiplier).toBeCloseTo(1 + 100 * step, 6);
    });

    it("discounts the shop without ever reaching free", () => {
      const meta = new MetaProgression({ earned: 100_000_000 });
      for (let i = 0; i < 2000; i++) meta.buy("negoce");
      const price = meta.bonus().priceMultiplier;
      expect(price).toBeLessThan(0.05);
      expect(price).toBeGreaterThan(0);
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
      for (let i = 0; i < 100; i++) meta.buy("memoire");
      const share = META_BY_ID.get("memoire")!.valueAt(100);
      meta.recordClear(plain, { vitesse: 40, munitions: 20, cases: 2 });

      const carried = meta.bonus().carriedLevels;
      expect(carried.vitesse).toBe(Math.floor(40 * share));
      expect(carried.munitions).toBe(Math.floor(20 * share));
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
      const share = META_BY_ID.get("memoire")!.valueAt(100);
      expect(MetaProgression.restore(meta.serialize()).bonus().carriedLevels.vitesse).toBe(
        Math.floor(40 * share),
      );
    });
  });

  it("refuses what it cannot pay for", () => {
    const meta = new MetaProgression();
    expect(meta.canAfford("filtre")).toBe(false);
    expect(meta.buy("filtre")).toBe(false);
    expect(meta.bonus().canFilterQueue).toBe(false);
  });

  it("ne garde que ce qui survit à une image", () => {
    // Les capacités et l'automate sont passés dans la boutique de la toile :
    // ce qui agit *dans* une partie s'achète en fragments et se rejoue à chaque
    // image, ce qui la précède ou lui survit reste ici, en éclats.
    const ids = META_UPGRADES.map((u) => u.id) as string[];
    for (const moved of ["perce", "explosion", "foudre", "feu", "auto", "emplette"]) {
      expect(ids).not.toContain(moved);
    }
    for (const kept of ["negoce", "elan", "prospecteur", "memoire", "filtre", "nuancier"]) {
      expect(ids).toContain(kept);
    }
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
