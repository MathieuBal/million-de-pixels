import type { CannonAim } from "./Cannon";
import { traverseAxis } from "./axisTraversal";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { Rng } from "../rng/XorShift32";
import type { PixelWorld } from "../world/PixelWorld";

/**
 * What a crossing can do beyond taking its one cell.
 *
 * Chances are probabilities in [0, 1] rolled once per bite that actually
 * removed something; powers say how far the effect reaches when it fires.
 */
export interface EffectLoadout {
  /** Chance the shot reaches its colour through what is standing in front. */
  pierceChance: number;
  /** Foreign cells a piercing shot may look past. */
  pierceDepth: number;
  /** Chance the killed cell takes its neighbours with it. */
  explosionChance: number;
  /** Radius of that blast, in cells. */
  explosionRadius: number;
  /** Chance an arc jumps from the killed cell to a neighbour of its colour. */
  lightningChance: number;
  /** How many times the arc jumps on. */
  lightningArcs: number;
  /** Chance a fire takes hold where the cell died. */
  fireChance: number;
  /** Cells the fire works through as it spreads. */
  fireSpread: number;
}

/**
 * Cells a piercing shot may scan before giving up.
 *
 * The depth counts living foreign cells, but holes between them cost nothing,
 * so a lane pocked with gaps could otherwise be walked end to end — a thousand
 * reads on a lane that is crossed hundreds of times a second per cannon. A
 * pierce is a shot through what stands in front of it, not a search of the
 * board.
 */
const MAX_PIERCE_SCAN = 256;

export const NO_EFFECTS: EffectLoadout = {
  pierceChance: 0,
  pierceDepth: 0,
  explosionChance: 0,
  explosionRadius: 0,
  lightningChance: 0,
  lightningArcs: 0,
  fireChance: 0,
  fireSpread: 0,
};

export interface EffectOutcome {
  destroyed: number;
  /** Cell indices worth a spark, capped by the caller's appetite. */
  touched: number[];
  pierced: boolean;
  exploded: boolean;
  sparked: boolean;
  burned: boolean;
}

/**
 * The three specialisations, resolved after a bite.
 *
 * **Every block an effect removes still costs a round.** That is not a
 * limitation bolted on: it is what keeps the whole game consistent. The
 * ammunition ledger says `queued + active <= alive`, so a colour can never be
 * promised more rounds than it has pixels — and an effect that destroyed pixels
 * for free would put the ledger permanently above the board, handing out
 * cannons for colours that no longer exist. Effects make a *crossing* yield
 * more, never a round.
 *
 * `budget` is what the cannon can still pay for. Every effect stops on it.
 *
 * `killedIndex` is the cell the bite took, or -1 when the lane was blocked.
 * Éclat and Foudre need a kill to spread from; **Perce is the one that runs on a
 * blocked lane**, because getting through what is standing in front is the whole
 * reason it exists. Rolling it only after a successful bite would make it the
 * one specialisation that never helps when it is needed.
 */
export function resolveEffects(
  world: PixelWorld,
  colorId: number,
  aim: CannonAim,
  killedIndex: number,
  loadout: EffectLoadout,
  rng: Rng,
  budget: number,
): EffectOutcome {
  const outcome: EffectOutcome = {
    destroyed: 0,
    touched: [],
    pierced: false,
    exploded: false,
    sparked: false,
    burned: false,
  };
  if (budget <= 0) return outcome;

  const spend = (index: number): boolean => {
    if (outcome.destroyed >= budget) return false;
    if (world.colorId[index] !== colorId) return false;
    if (!world.destroy(index)) return false;
    outcome.destroyed++;
    outcome.touched.push(index);
    return true;
  };

  if (killedIndex >= 0 && loadout.explosionChance > 0 && rng.nextFloat() < loadout.explosionChance) {
    outcome.exploded = explode(killedIndex, loadout.explosionRadius, spend);
  }

  if (killedIndex >= 0 && loadout.lightningChance > 0 && rng.nextFloat() < loadout.lightningChance) {
    outcome.sparked = strike(world, colorId, killedIndex, loadout.lightningArcs, rng, spend);
  }

  if (killedIndex >= 0 && loadout.fireChance > 0 && rng.nextFloat() < loadout.fireChance) {
    outcome.burned = burn(world, colorId, killedIndex, loadout.fireSpread, spend);
  }

  if (loadout.pierceChance > 0 && rng.nextFloat() < loadout.pierceChance) {
    outcome.pierced = pierce(world, colorId, aim, loadout.pierceDepth, spend);
  }

  return outcome;
}

/**
 * Reaches the cannon's colour through what is standing in front of it.
 *
 * This is the answer to the game's oldest frustration: a colour buried behind
 * another is unreachable from that side, so a cannon can orbit the whole frame
 * without a shot. Piercing looks past a bounded number of foreign cells and
 * takes the first cell of its own colour behind them. The cells it looked
 * past are **not** destroyed — a foreign colour is never destroyed by anything
 * a cannon does, or the per-colour economy collapses.
 */
function pierce(
  world: PixelWorld,
  colorId: number,
  aim: CannonAim,
  depth: number,
  spend: (index: number) => boolean,
): boolean {
  if (depth <= 0) return false;

  let looked = 0;
  let scanned = 0;
  let target = -1;

  const start = world.surface.frontIndex(aim.axis, aim.lane, aim.direction);
  if (start < 0) return false;

  const fromCell = aim.axis === "row" ? start % WORLD_WIDTH : (start / WORLD_WIDTH) | 0;
  const last = aim.axis === "row" ? WORLD_WIDTH - 1 : WORLD_HEIGHT - 1;

  traverseAxis(
    aim.axis,
    aim.lane,
    aim.direction,
    fromCell,
    aim.direction > 0 ? last : 0,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    (_x, _y, index) => {
      if (++scanned > MAX_PIERCE_SCAN) return true;
      const cell = world.colorId[index];
      if (cell === colorId) {
        target = index;
        return true;
      }
      // Holes and margins are free to cross and cost no depth; only a living
      // foreign cell is something to see past.
      if (world.isSolid(index)) {
        looked++;
        if (looked > depth) return true;
      }
      return false;
    },
  );

  return target >= 0 && spend(target);
}

/** A span-filled disc around the kill, of the cannon's colour only. */
function explode(
  center: number,
  radius: number,
  spend: (index: number) => boolean,
): boolean {
  if (radius <= 0) return false;

  const cx = center % WORLD_WIDTH;
  const cy = (center / WORLD_WIDTH) | 0;
  const r2 = radius * radius;
  let any = false;

  const yMin = Math.max(0, cy - radius);
  const yMax = Math.min(WORLD_HEIGHT - 1, cy + radius);

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    const half = Math.floor(Math.sqrt(Math.max(0, r2 - dy * dy)));
    const xMin = Math.max(0, cx - half);
    const xMax = Math.min(WORLD_WIDTH - 1, cx + half);
    for (let x = xMin; x <= xMax; x++) {
      if (spend(y * WORLD_WIDTH + x)) any = true;
    }
  }

  return any;
}

/**
 * An arc that jumps from the kill to a touching cell of the same colour, and on
 * from there.
 *
 * It walks rather than fills: each jump picks one of the four neighbours that
 * still holds the colour, so the mark it leaves follows the shape of the colour
 * instead of stamping a disc on it. Bounded by the arc count and by the budget.
 */
function strike(
  world: PixelWorld,
  colorId: number,
  center: number,
  arcs: number,
  rng: Rng,
  spend: (index: number) => boolean,
): boolean {
  if (arcs <= 0) return false;

  let from = center;
  let jumped = false;

  for (let arc = 0; arc < arcs; arc++) {
    const next = pickNeighbour(world, colorId, from, rng);
    if (next < 0) break;
    if (!spend(next)) break;
    jumped = true;
    from = next;
  }

  return jumped;
}

/**
 * An incendie: it eats the colour region outwards from the kill.
 *
 * The three specialisations have to *look* different or they are one upgrade
 * bought three times. Explosion stamps a disc on the picture regardless of what
 * is under it; lightning walks a thin line along the colour; fire floods it —
 * breadth-first over touching cells of the same colour, so what it leaves is
 * the shape of the region itself, eaten from one point outwards until the
 * spread or the stock runs out.
 */
function burn(
  world: PixelWorld,
  colorId: number,
  center: number,
  spread: number,
  spend: (index: number) => boolean,
): boolean {
  if (spread <= 0) return false;

  // Breadth-first, so the fire grows as a front rather than sprinting down one
  // arm of the region. `seen` is a plain Set: the frontier is bounded by the
  // spread the player bought, never by the size of the board.
  const queue: number[] = [center];
  const seen = new Set<number>([center]);
  let burned = 0;
  let any = false;

  while (queue.length > 0 && burned < spread) {
    const index = queue.shift()!;

    for (const next of neighboursOf(index)) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (world.colorId[next] !== colorId) continue;
      if (!spend(next)) return any;

      burned++;
      any = true;
      queue.push(next);
      if (burned >= spread) break;
    }
  }

  return any;
}

/** The four touching cells, clipped to the board. */
function neighboursOf(index: number): number[] {
  const x = index % WORLD_WIDTH;
  const y = (index / WORLD_WIDTH) | 0;
  const out: number[] = [];
  if (x > 0) out.push(index - 1);
  if (x < WORLD_WIDTH - 1) out.push(index + 1);
  if (y > 0) out.push(index - WORLD_WIDTH);
  if (y < WORLD_HEIGHT - 1) out.push(index + WORLD_WIDTH);
  return out;
}

/** One of the four touching cells still holding `colorId`, or -1. */
function pickNeighbour(world: PixelWorld, colorId: number, index: number, rng: Rng): number {
  const candidates = neighboursOf(index).filter((n) => world.colorId[n] === colorId);
  if (candidates.length === 0) return -1;
  return candidates[Math.min(candidates.length - 1, (rng.nextFloat() * candidates.length) | 0)];
}
