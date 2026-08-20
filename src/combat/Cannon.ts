import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { Axis, Direction } from "./axisTraversal";

export interface CannonState {
  /** Position along the perimeter, measured in cells, wrapping at the corners. */
  position: number;
  /** Patrol speed, in cells per second. */
  speed: number;
}

export interface CannonAim {
  axis: Axis;
  /** Row index when firing along a row, column index when firing along a column. */
  lane: number;
  direction: Direction;
  /** Muzzle position in board coordinates, just outside the edge. Visual only. */
  x: number;
  y: number;
}

/** How far outside the board the muzzle is drawn. */
const MUZZLE_OFFSET = 14;

export const PERIMETER = 2 * (WORLD_WIDTH + WORLD_HEIGHT);

/**
 * Border-patrolling cannon.
 *
 * It slides along the four edges and always fires perpendicular to the edge it
 * currently sits on, straight ahead into the board. Constraining the aim this
 * way is what lets a shot resolve as a fixed-stride scan of a single row or
 * column instead of a general grid traversal.
 */
export class Cannon {
  position: number;
  speed: number;

  constructor(state?: Partial<CannonState>) {
    this.position = wrap(state?.position ?? 0);
    this.speed = state?.speed ?? 220;
  }

  update(deltaSeconds: number): void {
    this.position = wrap(this.position + this.speed * deltaSeconds);
  }

  /** Current edge, lane and firing direction. */
  aim(): CannonAim {
    return aimAt(this.position);
  }

  /**
   * Aim offset by `laneOffset` lanes along the same edge, used to spread a
   * volley over adjacent parallel lanes. Offsets that would run past a corner
   * are clamped to the edge rather than wrapping onto a perpendicular one.
   */
  aimOffset(laneOffset: number): CannonAim {
    const aim = this.aim();
    if (laneOffset === 0) return aim;

    const lanes = aim.axis === "row" ? WORLD_HEIGHT : WORLD_WIDTH;
    const lane = clamp(aim.lane + laneOffset, 0, lanes - 1);
    return { ...aim, lane, ...muzzleOf(aim.axis, lane, aim.direction) };
  }

  serialize(): CannonState {
    return { position: this.position, speed: this.speed };
  }
}

/**
 * Maps a perimeter position to an edge. The sides run clockwise starting at the
 * top-left corner: top, right, bottom, left.
 */
export function aimAt(position: number): CannonAim {
  const p = wrap(position);

  let axis: Axis;
  let lane: number;
  let direction: Direction;

  if (p < WORLD_WIDTH) {
    // Top edge, firing down a column.
    axis = "column";
    lane = Math.min(WORLD_WIDTH - 1, Math.floor(p));
    direction = 1;
  } else if (p < WORLD_WIDTH + WORLD_HEIGHT) {
    // Right edge, firing left along a row.
    axis = "row";
    lane = Math.min(WORLD_HEIGHT - 1, Math.floor(p - WORLD_WIDTH));
    direction = -1;
  } else if (p < 2 * WORLD_WIDTH + WORLD_HEIGHT) {
    // Bottom edge, firing up a column.
    axis = "column";
    lane = Math.min(
      WORLD_WIDTH - 1,
      Math.floor(WORLD_WIDTH - 1 - (p - WORLD_WIDTH - WORLD_HEIGHT)),
    );
    direction = -1;
  } else {
    // Left edge, firing right along a row.
    axis = "row";
    lane = Math.min(
      WORLD_HEIGHT - 1,
      Math.floor(WORLD_HEIGHT - 1 - (p - 2 * WORLD_WIDTH - WORLD_HEIGHT)),
    );
    direction = 1;
  }

  lane = Math.max(0, lane);
  return { axis, lane, direction, ...muzzleOf(axis, lane, direction) };
}

function muzzleOf(axis: Axis, lane: number, direction: Direction): { x: number; y: number } {
  if (axis === "column") {
    return {
      x: lane + 0.5,
      y: direction > 0 ? -MUZZLE_OFFSET : WORLD_HEIGHT + MUZZLE_OFFSET,
    };
  }
  return {
    x: direction > 0 ? -MUZZLE_OFFSET : WORLD_WIDTH + MUZZLE_OFFSET,
    y: lane + 0.5,
  };
}

function wrap(position: number): number {
  const p = position % PERIMETER;
  return p < 0 ? p + PERIMETER : p;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
