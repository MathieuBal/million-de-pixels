import type { ColorCard } from "./cards";
import { upgradeCard } from "./cards";
import type { PixelWorld } from "../world/PixelWorld";

export interface CardSlot {
  card: ColorCard;
  cooldownMs: number;
}

/**
 * Runtime state of the deck: cooldowns, exhausted colours, upgrades.
 *
 * When a colour runs out, its cards do not die — they turn prismatic and
 * retarget whatever colour is still alive, so a build never silently loses a
 * third of its DPS.
 */
export class DeckRuntime {
  readonly slots: CardSlot[];

  constructor(cards: ColorCard[]) {
    this.slots = cards.map((card) => ({ card, cooldownMs: 0 }));
  }

  get size(): number {
    return this.slots.length;
  }

  /** Advances cooldowns and returns the slots that fire on this tick. */
  tick(deltaMs: number): CardSlot[] {
    const ready: CardSlot[] = [];
    for (const slot of this.slots) {
      slot.cooldownMs -= deltaMs;
      if (slot.cooldownMs <= 0) {
        // Clamp instead of accumulating debt: a long pause must not produce a
        // burst of catch-up volleys the moment the tab regains focus.
        slot.cooldownMs = slot.card.fireIntervalMs;
        ready.push(slot);
      }
    }
    return ready;
  }

  /**
   * Marks cards whose colour is gone as prismatic, and clears the flag again
   * if the colour comes back (prestige, recolour effects).
   */
  syncExhaustedColors(world: PixelWorld): void {
    for (const slot of this.slots) {
      const exhausted = world.aliveByColor(slot.card.colorId) === 0;
      slot.card.prismatic = exhausted;
    }
  }

  /** Effective target for a card: its own colour, or the richest one left. */
  resolveTarget(card: ColorCard, world: PixelWorld): number {
    if (!card.prismatic) return card.colorId;

    let best = -1;
    let bestAlive = 0;
    for (let colour = 0; colour < world.paletteSize; colour++) {
      const alive = world.aliveByColor(colour);
      if (alive > bestAlive) {
        bestAlive = alive;
        best = colour;
      }
    }
    return best;
  }

  upgrade(cardId: string): ColorCard | null {
    const slot = this.slots.find((s) => s.card.id === cardId);
    if (!slot) return null;
    slot.card = upgradeCard(slot.card);
    return slot.card;
  }

  /** Cards ordered by how much of their own colour is left, richest first. */
  serialize(): ColorCard[] {
    return this.slots.map((slot) => ({ ...slot.card }));
  }

  /**
   * Volleys per second summed over the deck, used by the offline model to turn
   * a build into a per-colour damage rate.
   */
  damagePerSecondByColor(world: PixelWorld): Float64Array {
    const dps = new Float64Array(world.paletteSize);
    for (const slot of this.slots) {
      const card = slot.card;
      const target = this.resolveTarget(card, world);
      if (target < 0) continue;
      const volleysPerSecond = 1000 / card.fireIntervalMs;
      const hitsPerVolley = card.ballCount * card.pierce + card.logicalBurst;
      dps[target] += volleysPerSecond * hitsPerVolley * card.damage;
    }
    return dps;
  }
}
