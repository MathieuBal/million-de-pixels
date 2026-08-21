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
}

/**
 * Cells travelled per second — and, since every lane crossed is an opportunity,
 * lanes examined per second too. This is the production stat.
 */
export const CANNON_MOVE_SPEED = 260;

/**
 * A cannon actually on the rail.
 *
 * It carries a finite stock of rounds of one colour, travels the perimeter,
 * and leaves once the stock is gone. There is no permanent cannon any more:
 * every cannon on screen came from a slot the player chose to spend.
 *
 * `ammo` counts rounds still to be spent, and a round is only ever spent on a
 * block that actually dies — a burst that finds nothing costs nothing.
 */
export class ActiveCannon {
  readonly id: string;
  readonly colorId: ColorId;
  readonly maxAmmo: number;

  ammo: number;
  trackPosition: number;
  moveSpeed: number;

  /**
   * Rail distance covered since the last burst that removed something. A burst
   * stops at the first solid cell, so a colour buried behind another is
   * unreachable from every side; without this a cannon for such a colour would
   * orbit forever and hold a rail slot hostage. A full lap with nothing to peel
   * means there is nothing to peel.
   */
  private distanceSinceBurst = 0;

  /** Set when the colour ran out under it: the mission ends immediately. */
  private retired = false;

  constructor(load: CannonLoad, trackPosition: number, state?: Partial<ActiveCannonState>) {
    this.id = load.id;
    this.colorId = load.colorId;
    this.maxAmmo = state?.maxAmmo ?? load.ammo;
    this.ammo = state?.ammo ?? load.ammo;
    this.trackPosition = state?.trackPosition ?? trackPosition;
    this.moveSpeed = state?.moveSpeed ?? CANNON_MOVE_SPEED;
  }

  /**
   * Advances along the rail and reports how far it went, so the simulator can
   * walk every lane crossed rather than only the one it landed on.
   */
  update(deltaMs: number): number {
    const travelled = this.moveSpeed * (deltaMs / 1000);
    this.trackPosition = (this.trackPosition + travelled) % PERIMETER;

    this.distanceSinceBurst += travelled;
    if (this.distanceSinceBurst > PERIMETER) this.retire();

    return travelled;
  }

  aim(): CannonAim {
    return aimAt(this.trackPosition);
  }

  /**
   * Applies bought upgrades. It has to reach cannons already travelling, not
   * only the next ones: an upgrade the player cannot see take effect reads as
   * a purchase that did nothing.
   */
  tune(moveSpeed: number): void {
    this.moveSpeed = moveSpeed;
  }

  /** Spends what a burst removed, and resets the idle-lap counter. */
  onBurst(destroyed: number): void {
    if (destroyed <= 0) return;
    this.ammo = Math.max(0, this.ammo - destroyed);
    this.distanceSinceBurst = 0;
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
    return this.retired || this.ammo === 0;
  }

  serialize(): ActiveCannonState {
    return {
      id: this.id,
      colorId: this.colorId,
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
      trackPosition: this.trackPosition,
      moveSpeed: this.moveSpeed,
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
