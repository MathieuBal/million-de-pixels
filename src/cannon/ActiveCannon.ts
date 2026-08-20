import { aimAt, PERIMETER, type CannonAim } from "../combat/Cannon";
import type { ColorId } from "../core/constants";
import type { CannonLoad } from "./CannonLoad";

export interface ActiveCannonState {
  id: string;
  colorId: ColorId;
  ammo: number;
  maxAmmo: number;
  trackPosition: number;
  moveSpeed: number;
  fireIntervalMs: number;
  fireCooldownMs: number;
}

/** Opening values, to test rather than to treat as balance. */
export const CANNON_MOVE_SPEED = 260;
export const CANNON_FIRE_INTERVAL_MS = 140;

/**
 * A cannon actually on the rail.
 *
 * It carries a finite stock of rounds of one colour, travels the perimeter,
 * and leaves once the stock is gone. There is no permanent cannon any more:
 * every cannon on screen came from a slot the player chose to spend.
 *
 * `ammo` counts rounds still to be *spent*, and a round is only spent when a
 * block actually dies. `inFlight` holds back firing so a cannon with three
 * rounds left cannot put five balls in the air.
 */
export class ActiveCannon {
  readonly id: string;
  readonly colorId: ColorId;
  readonly maxAmmo: number;

  ammo: number;
  trackPosition: number;
  moveSpeed: number;
  fireIntervalMs: number;
  fireCooldownMs = 0;

  /** Balls of this cannon still travelling. */
  inFlight = 0;

  /** Set when the colour ran out under it: the mission ends immediately. */
  private retired = false;

  constructor(load: CannonLoad, trackPosition: number, state?: Partial<ActiveCannonState>) {
    this.id = load.id;
    this.colorId = load.colorId;
    this.maxAmmo = state?.maxAmmo ?? load.ammo;
    this.ammo = state?.ammo ?? load.ammo;
    this.trackPosition = state?.trackPosition ?? trackPosition;
    this.moveSpeed = state?.moveSpeed ?? CANNON_MOVE_SPEED;
    this.fireIntervalMs = state?.fireIntervalMs ?? CANNON_FIRE_INTERVAL_MS;
    this.fireCooldownMs = state?.fireCooldownMs ?? 0;
  }

  update(deltaMs: number): void {
    this.trackPosition = (this.trackPosition + this.moveSpeed * (deltaMs / 1000)) % PERIMETER;
    if (this.fireCooldownMs > 0) this.fireCooldownMs -= deltaMs;
  }

  aim(): CannonAim {
    return aimAt(this.trackPosition);
  }

  /**
   * Ready to put a ball in the air. Note this says nothing about whether there
   * is anything to hit — that check belongs to the simulator, which owns the
   * lane index, and is what stops a cannon wasting its stock on empty lanes.
   */
  canFire(): boolean {
    return !this.retired && this.fireCooldownMs <= 0 && this.inFlight < this.ammo;
  }

  onFired(): void {
    this.fireCooldownMs = this.fireIntervalMs;
    this.inFlight++;
  }

  /** A ball found its target: the round is spent. */
  onHit(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.ammo = Math.max(0, this.ammo - 1);
  }

  /** A ball crossed the whole lane without finding anything. No round spent. */
  onMiss(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Ends the mission now, whatever is left — its colour is gone. */
  retire(): void {
    this.retired = true;
  }

  get isRetired(): boolean {
    return this.retired;
  }

  /** Off the rail once the stock is spent, or the colour disappeared. */
  isFinished(): boolean {
    return (this.retired && this.inFlight === 0) || (this.ammo === 0 && this.inFlight === 0);
  }

  serialize(): ActiveCannonState {
    return {
      id: this.id,
      colorId: this.colorId,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      trackPosition: this.trackPosition,
      moveSpeed: this.moveSpeed,
      fireIntervalMs: this.fireIntervalMs,
      fireCooldownMs: this.fireCooldownMs,
    };
  }

  static restore(state: ActiveCannonState): ActiveCannon {
    return new ActiveCannon(
      { id: state.id, colorId: state.colorId, ammo: state.ammo },
      state.trackPosition,
      state,
    );
  }
}
