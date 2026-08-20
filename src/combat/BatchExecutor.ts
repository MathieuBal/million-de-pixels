import { MACRO_TILES_X, MACRO_TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { Rng } from "../rng/XorShift32";
import type { PixelWorld } from "../world/PixelWorld";

export type DestroyCommand =
  | { kind: "color"; colorId: number; amount: number }
  | { kind: "circle"; x: number; y: number; radius: number; colorId?: number; damage: number }
  | { kind: "line"; x0: number; y0: number; x1: number; y1: number; colorId?: number; damage: number };

/**
 * Applies destruction in bulk.
 *
 * At high power the game stops simulating one projectile per logical hit and
 * instead converts damage into commands. None of these ever walks the million
 * cells: colour commands go through the ColorIndex, area commands go through a
 * bounding box plus macro-tile rejection.
 */
export class BatchExecutor {
  constructor(private readonly world: PixelWorld) {}

  execute(command: DestroyCommand, rng: Rng): number {
    switch (command.kind) {
      case "color":
        return this.world.destroyRandomOfColor(command.colorId, command.amount, rng);
      case "circle":
        return this.circle(command);
      case "line":
        return this.line(command);
      default:
        return 0;
    }
  }

  /**
   * Span-filled disc. Only the rows inside the bounding box are visited, and a
   * macro tile with no matching colour left is skipped whole.
   */
  private circle(command: Extract<DestroyCommand, { kind: "circle" }>): number {
    const { x, y, radius, colorId, damage } = command;
    if (radius <= 0) return 0;

    const world = this.world;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const r2 = radius * radius;

    let destroyed = 0;
    const yMin = Math.max(0, cy - Math.ceil(radius));
    const yMax = Math.min(WORLD_HEIGHT - 1, cy + Math.ceil(radius));

    for (let py = yMin; py <= yMax; py++) {
      const dy = py - cy;
      const half = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
      const xMin = Math.max(0, cx - half);
      const xMax = Math.min(WORLD_WIDTH - 1, cx + half);

      let px = xMin;
      while (px <= xMax) {
        const tile = ((py / MACRO_TILE_SIZE) | 0) * MACRO_TILES_X + ((px / MACRO_TILE_SIZE) | 0);
        const tileEndX = Math.min(xMax, (((px / MACRO_TILE_SIZE) | 0) + 1) * MACRO_TILE_SIZE - 1);

        const skip =
          colorId === undefined
            ? !world.macroTiles.tileHasAnything(tile)
            : world.macroTiles.countIn(tile, colorId) === 0;

        if (skip) {
          px = tileEndX + 1;
          continue;
        }

        for (; px <= tileEndX; px++) {
          const index = py * WORLD_WIDTH + px;
          if (colorId !== undefined && world.colorId[index] !== colorId) continue;
          if (world.damage(index, damage)) destroyed++;
        }
      }
    }
    return destroyed;
  }

  private line(command: Extract<DestroyCommand, { kind: "line" }>): number {
    const world = this.world;
    let destroyed = 0;
    const dx = command.x1 - command.x0;
    const dy = command.y1 - command.y0;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.floor(command.x0 + dx * t);
      const py = Math.floor(command.y0 + dy * t);
      if (px < 0 || py < 0 || px >= WORLD_WIDTH || py >= WORLD_HEIGHT) continue;
      const index = py * WORLD_WIDTH + px;
      if (command.colorId !== undefined && world.colorId[index] !== command.colorId) continue;
      if (world.damage(index, command.damage)) destroyed++;
    }
    return destroyed;
  }
}
