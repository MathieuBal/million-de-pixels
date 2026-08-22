import type { PixelWorld } from "../world/PixelWorld";

/**
 * Per-colour ammunition accounting.
 *
 * One living pixel is one round needed, so the reserves are the image itself.
 * Three numbers have to stay separated: the pixels still standing, the rounds
 * already promised to loads waiting in the queue, and the rounds carried by
 * cannons currently on the rail.
 *
 * The invariant that matters: `queued + active <= alive`. Without it the game
 * happily hands out 2 000 red rounds when 417 red pixels remain, and every
 * cannon after the first spends its life firing at nothing.
 */
export interface ColorAmmoState {
  colorId: number;
  alivePixels: number;
  queuedAmmo: number;
  activeAmmo: number;
  /** Rounds that may still be handed out for this colour. */
  assignable: number;
}

/**
 * The most of a colour the étal may hold at once, as a share of what is alive.
 *
 * Half, and it is not a tuning knob so much as the thing that keeps the offer
 * alive. Loads are cut when the board is large and keep the stock they were cut
 * with; the board then shrinks under them. Without a ceiling the rounds promised
 * to the queue converge on the rounds that exist — measured at ninety percent
 * cleared, with the étal upgraded to a hundred slots: a hundred thousand rounds
 * committed against a hundred and two thousand living pixels. From there
 * `reserveForQueue` can grant nothing, so no slot can ever be re-cut, and the
 * player is left tapping a frozen offer of whatever colours it happened to
 * freeze on. Keeping half of every colour uncommitted means there is always
 * something to draw, so the offer always turns over.
 *
 * A cannon already on the rail is not bound by this: it is spending its rounds,
 * not sitting on them.
 */
export const QUEUE_SHARE = 0.5;

export class ColorAmmoReserve {
  readonly paletteSize: number;

  private readonly queued: Uint32Array;
  private readonly active: Uint32Array;

  constructor(private readonly world: PixelWorld) {
    this.paletteSize = world.paletteSize;
    this.queued = new Uint32Array(this.paletteSize);
    this.active = new Uint32Array(this.paletteSize);
  }

  alive(colorId: number): number {
    return this.world.aliveByColor(colorId);
  }

  /** Rounds that can still be promised without over-committing the colour. */
  assignable(colorId: number): number {
    if (colorId < 0 || colorId >= this.paletteSize) return 0;
    const committed = this.queued[colorId] + this.active[colorId];
    return Math.max(0, this.alive(colorId) - committed);
  }

  stateOf(colorId: number): ColorAmmoState {
    return {
      colorId,
      alivePixels: this.alive(colorId),
      queuedAmmo: this.queued[colorId],
      activeAmmo: this.active[colorId],
      assignable: this.assignable(colorId),
    };
  }

  states(): ColorAmmoState[] {
    const out: ColorAmmoState[] = [];
    for (let colour = 0; colour < this.paletteSize; colour++) out.push(this.stateOf(colour));
    return out;
  }

  /**
   * Rounds the étal may still be promised for this colour.
   *
   * `assignable` minus the share reserved for the offer to keep turning over.
   * A colour down to its last pixels still yields one round, or it would drop
   * out of the queue entirely while it is still on the board.
   */
  queueable(colorId: number): number {
    const assignable = this.assignable(colorId);
    if (assignable <= 0) return 0;
    const ceiling = Math.floor(this.alive(colorId) * QUEUE_SHARE) - this.queued[colorId];
    // A colour with nothing queued yet is always worth one round, however few
    // pixels it has left: the alternative is a colour still on the board that
    // the étal is structurally unable to offer.
    const room = this.queued[colorId] === 0 ? Math.max(1, ceiling) : ceiling;
    return Math.max(0, Math.min(assignable, room));
  }

  /** Colours that can still supply a load. */
  availableColors(): number[] {
    const out: number[] = [];
    for (let colour = 0; colour < this.paletteSize; colour++) {
      if (this.queueable(colour) > 0) out.push(colour);
    }
    return out;
  }

  /** Promises rounds to a queued load. Returns what was actually granted. */
  reserveForQueue(colorId: number, amount: number): number {
    const granted = Math.min(amount, this.queueable(colorId));
    this.queued[colorId] += granted;
    return granted;
  }

  /** A queued load is launched: its rounds move from the queue to the rail. */
  promoteToActive(colorId: number, amount: number): void {
    const moved = Math.min(amount, this.queued[colorId]);
    this.queued[colorId] -= moved;
    this.active[colorId] += moved;
  }

  /** A queued load is discarded — usually because its colour ran out. */
  releaseFromQueue(colorId: number, amount: number): void {
    this.queued[colorId] -= Math.min(amount, this.queued[colorId]);
  }

  /** A round was spent, or a cannon left the rail with rounds unspent. */
  releaseFromActive(colorId: number, amount: number): void {
    this.active[colorId] -= Math.min(amount, this.active[colorId]);
  }

  /**
   * Rebuilds the commitments from scratch. Called after loading a save, where
   * only the loads and cannons are persisted, not the accounting.
   */
  reset(): void {
    this.queued.fill(0);
    this.active.fill(0);
  }
}
