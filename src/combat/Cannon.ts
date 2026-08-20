import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";

export interface CannonState {
  angle: number;
  angularSpeed: number;
  radius: number;
}

/**
 * Orbital cannon. It lives outside the board on purpose: every shot enters the
 * grid from the edge, which is exactly what the segment clip is there for.
 */
export class Cannon {
  angle: number;
  angularSpeed: number;
  radius: number;

  readonly centerX = WORLD_WIDTH / 2;
  readonly centerY = WORLD_HEIGHT / 2;

  constructor(state?: Partial<CannonState>) {
    this.angle = state?.angle ?? 0;
    this.angularSpeed = state?.angularSpeed ?? 0.35; // rad/s
    this.radius = state?.radius ?? WORLD_WIDTH * 0.78;
  }

  update(deltaSeconds: number): void {
    this.angle = (this.angle + this.angularSpeed * deltaSeconds) % (Math.PI * 2);
  }

  get x(): number {
    return this.centerX + Math.cos(this.angle) * this.radius;
  }

  get y(): number {
    return this.centerY + Math.sin(this.angle) * this.radius;
  }

  /** Unit vector pointing from the cannon towards the centre of the board. */
  aim(): { x: number; y: number } {
    const dx = this.centerX - this.x;
    const dy = this.centerY - this.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  serialize(): CannonState {
    return { angle: this.angle, angularSpeed: this.angularSpeed, radius: this.radius };
  }
}
