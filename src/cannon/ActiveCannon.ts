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
 * Rail speed of a finale cannon, in cells per second.
 *
 * The finale is an outro, not a fight: it runs at a speed no upgrade track
 * reaches so the last thousandth of an image falls in seconds rather than
 * minutes.
 */
export const FINALE_MOVE_SPEED = 4096;

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

  /**
   * A finale cannon: no stock to spend, no lap timeout, no line in the reserve.
   *
   * It exists only for the automatic finish of a nearly-cleared image, where
   * the ammunition economy has stopped meaning anything — a colour down to
   * eleven pixels cannot fund a cannon worth launching. Everything else about
   * it is a normal cannon: it rides the rail, and it peels real lanes from the
   * surface inwards. Nothing is ever deleted off a lane.
   */
  readonly unlimited: boolean;

  constructor(
    load: CannonLoad,
    trackPosition: number,
    state?: Partial<ActiveCannonState>,
    unlimited = false,
  ) {
    this.unlimited = unlimited;
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
    // A finale cannon never gives up on a buried colour: the layer in front of
    // it is being peeled by the other finale cannons, so its turn comes.
    if (!this.unlimited && this.distanceSinceBurst > PERIMETER) this.retire();

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
    if (!this.unlimited) this.ammo = Math.max(0, this.ammo - destroyed);
    this.distanceSinceBurst = 0;
  }

  /** Ends the mission now, whatever is left — its colour is gone. */
  retire(): void {
    this.retired = true;
  }

  /**
   * How far round it has gone without peeling anything, as a fraction of a lap.
   *
   * The rail reads this to grey a cannon out before it leaves: a colour buried
   * from every side is the thing that stalls a run, and the player should see
   * the cannon giving up rather than find it gone.
   */
  get idleFraction(): number {
    return Math.min(1, this.distanceSinceBurst / PERIMETER);
  }

  get isRetired(): boolean {
    return this.retired;
  }

  /** Off the rail once the stock is spent, or the colour disappeared. */
  isFinished(): boolean {
    return this.retired || (!this.unlimited && this.ammo === 0);
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
