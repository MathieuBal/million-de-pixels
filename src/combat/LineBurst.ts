import type { CannonAim } from "./Cannon";
import type { Axis, Direction } from "./axisTraversal";
import type { PixelWorld } from "../world/PixelWorld";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";


export interface BurstEvent {
  cannonId: string;
  colorId: number;

  axis: Axis;
  lane: number;
  direction: Direction;

  /** Blocks removed by this burst. Zero means the lane did not match. */
  destroyed: number;
  /** Cell index of the first block removed, or -1 when nothing was. */
  firstIndex: number;
  lastIndex: number;
}

export interface BurstTarget {
  id: string;
  colorId: number;
  ammo: number;
  /**
   * A finale cannon: the stock stops bounding the burst, the lane does. Set
   * only by the automatic finish of a nearly-cleared image.
   */
  unlimited?: boolean;
}

/**
 * Default cells a single crossing takes off a lane.
 *
 * One. A cannon files the outline as it goes rather than drilling into it: past
 * a bite of a few cells the board stops being eaten from its edges and starts
 * showing long straight gashes cut across the picture, which is not what the
 * rail is meant to look like. Throughput comes from crossing more lanes — speed,
 * cannons, stock — never from cutting deeper.
 */
export const BITE_DEPTH = 1;

/**
 * Takes a bite out of one lane.
 *
 * The rule the whole game now runs on: every lane a cannon crosses is an
 * opportunity, and a lane whose exposed surface is the cannon's colour loses
 * the cells facing the cannon — as many as the bite allows, and no more.
 *
 * It is cheap because everything it needs already exists: `SurfaceIndex` gives
 * the exposed cell in a single read and advances itself, and `PixelWorld.destroy`
 * keeps the colour index, the macro tiles, the surface and the counters in step.
 * Nothing here ever searches the million cells.
 *
 * A foreign colour stops the bite and is never destroyed by it.
 */
export function resolveLaneBurst(
  world: PixelWorld,
  cannon: BurstTarget,
  aim: CannonAim,
  depth = BITE_DEPTH,
): BurstEvent {
  // A lane is at most a full row or column, so this bounds a bite that is
  // deliberately unbounded without pretending a stock is infinite.
  const stock = cannon.unlimited ? WORLD_WIDTH * WORLD_HEIGHT : cannon.ammo;
  const capacity = Math.min(stock, Math.max(1, depth));
  let destroyed = 0;
  let firstIndex = -1;
  let lastIndex = -1;

  while (destroyed < capacity) {
    const index = world.surface.frontIndex(aim.axis, aim.lane, aim.direction);
    if (index < 0) break;
    if (world.colorId[index] !== cannon.colorId) break;
    if (!world.destroy(index)) break;

    if (firstIndex < 0) firstIndex = index;
    lastIndex = index;
    destroyed++;
  }

  return {
    cannonId: cannon.id,
    colorId: cannon.colorId,
    axis: aim.axis,
    lane: aim.lane,
    direction: aim.direction,
    destroyed,
    firstIndex,
    lastIndex,
  };
}
