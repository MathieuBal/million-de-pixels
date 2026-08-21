import { describe, expect, it } from "vitest";
import { UPGRADES, UpgradeState } from "../../src/progression/Upgrades";
import { CANNON_FIRE_INTERVAL_MS, CANNON_MOVE_SPEED } from "../../src/cannon/ActiveCannon";
import { DEFAULT_LOAD_AMMO } from "../../src/cannon/CannonLoad";
import { VISIBLE_LOADS } from "../../src/cannon/CannonQueue";
import { MAX_ACTIVE_CANNONS } from "../../src/combat/CombatSimulator";

describe("UpgradeState", () => {
  it("starts at the base game", () => {
    const effects = new UpgradeState().effects();
    expect(effects.fireIntervalMs).toBe(CANNON_FIRE_INTERVAL_MS);
    expect(effects.moveSpeed).toBe(CANNON_MOVE_SPEED);
    expect(effects.maxActiveCannons).toBe(MAX_ACTIVE_CANNONS);
    expect(effects.ammoPerLoad).toBe(DEFAULT_LOAD_AMMO);
    expect(effects.visibleLoads).toBe(VISIBLE_LOADS);
    // Level zero is the strict "one ball, one block" rule.
    expect(effects.blastRadius).toBe(0);
  });

  it("earns one fragment per destroyed pixel", () => {
    const state = new UpgradeState();
    state.earn(1);
    state.earn(1);
    expect(state.balance).toBe(2);
    expect(state.totalEarned).toBe(2);
  });

  it("refuses a purchase it cannot pay for", () => {
    const state = new UpgradeState();
    expect(state.canAfford("cadence")).toBe(false);
    expect(state.buy("cadence")).toBe(false);
    expect(state.levelOf("cadence")).toBe(0);
  });

  it("debits the balance on a purchase", () => {
    const state = new UpgradeState({}, 10_000);
    const price = state.priceOf("cadence")!;
    expect(state.buy("cadence")).toBe(true);
    expect(state.balance).toBe(10_000 - price);
    expect(state.levelOf("cadence")).toBe(1);
  });

  it("keeps the total earned when fragments are spent", () => {
    const state = new UpgradeState({}, 10_000);
    state.buy("cadence");
    expect(state.totalEarned).toBe(10_000);
    expect(state.balance).toBeLessThan(10_000);
  });

  it("gets more expensive at every level", () => {
    const state = new UpgradeState({}, 10_000_000);
    let previous = 0;
    for (let i = 0; i < 5; i++) {
      const price = state.priceOf("cadence")!;
      expect(price).toBeGreaterThan(previous);
      previous = price;
      state.buy("cadence");
    }
  });

  it("stops at the maximum level", () => {
    const state = new UpgradeState({}, 10_000_000_000);
    const definition = UPGRADES.find((u) => u.id === "explosion")!;
    for (let i = 0; i < definition.maxLevel; i++) expect(state.buy("explosion")).toBe(true);

    expect(state.isMaxed("explosion")).toBe(true);
    expect(state.priceOf("explosion")).toBeNull();
    expect(state.canAfford("explosion")).toBe(false);
    expect(state.buy("explosion")).toBe(false);
  });

  it("moves every axis in the useful direction", () => {
    const state = new UpgradeState({}, 10_000_000_000);
    const base = state.effects();
    for (const definition of UPGRADES) state.buy(definition.id);
    const next = state.effects();

    expect(next.fireIntervalMs).toBeLessThan(base.fireIntervalMs);
    expect(next.moveSpeed).toBeGreaterThan(base.moveSpeed);
    expect(next.blastRadius).toBeGreaterThan(base.blastRadius);
    expect(next.maxActiveCannons).toBeGreaterThan(base.maxActiveCannons);
    expect(next.ammoPerLoad).toBeGreaterThan(base.ammoPerLoad);
    expect(next.visibleLoads).toBeGreaterThan(base.visibleLoads);
  });

  it("never pushes the fire interval below its floor", () => {
    const state = new UpgradeState({}, 10_000_000_000);
    const definition = UPGRADES.find((u) => u.id === "cadence")!;
    for (let i = 0; i < definition.maxLevel; i++) state.buy("cadence");
    expect(state.effects().fireIntervalMs).toBeGreaterThanOrEqual(30);
  });

  it("round-trips through serialize", () => {
    const state = new UpgradeState({}, 50_000);
    state.buy("cadence");
    state.buy("munitions");

    const restored = UpgradeState.restore(state.serialize());
    expect(restored.levelOf("cadence")).toBe(1);
    expect(restored.levelOf("munitions")).toBe(1);
    expect(restored.balance).toBe(state.balance);
    expect(restored.effects()).toEqual(state.effects());
  });

  it("restores to the base game from nothing", () => {
    const restored = UpgradeState.restore();
    expect(restored.balance).toBe(0);
    expect(restored.effects()).toEqual(new UpgradeState().effects());
  });

  it("only writes the axes actually bought", () => {
    const state = new UpgradeState({}, 50_000);
    state.buy("cadence");
    expect(Object.keys(state.serialize().levels)).toEqual(["cadence"]);
  });
});
