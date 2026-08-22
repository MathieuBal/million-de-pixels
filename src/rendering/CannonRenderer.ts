import { Container, Particle, ParticleContainer, Texture } from "pixi.js";
import type { CannonAim } from "../combat/Cannon";
import { WORLD_HEIGHT, WORLD_WIDTH, type PaletteEntry } from "../core/constants";
import {
  MUZZLE_MARKS,
  orient,
  paint,
  spriteFor,
  type CannonLook,
} from "./CannonSprites";

/** Beyond this many on the rail, the sprites turn into bands of colour. */
const DENSE_THRESHOLD = 12;

/** Width of a compact token, in board cells. */
const TOKEN_WIDTH = 4;
const TOKEN_LENGTH = 10;

/** The aimed lane, drawn all the way to the first solid cell it will meet. */
const LANE_ALPHA = 0.35;

/** A magazine below this blinks: it is the moment to look at the offers. */
const LOW_AMMO = 0.1;
const BLINK_MS = 600;

export interface CannonView {
  id: string;
  aim: CannonAim;
  colorId: number;
  ammo: number;
  maxAmmo: number;
  unlimited: boolean;
  /** Lapped the whole perimeter without peeling anything. */
  idle: boolean;
  /** Cell index the lane's first solid cell sits at, or -1. */
  frontIndex: number;
}

/**
 * The cannons, drawn as cells of the board.
 *
 * One cell of the sprite is one cell of the plateau, so a cannon cannot clash
 * with the imported image — it is made of the same stuff. Two readings have to
 * be free: the colour band across its base says what it is aimed at, and the
 * gauge under the band says how much is left, as segments going out rather than
 * a number.
 *
 * It sits on the rail, muzzle inward, and never covers a living cell: the
 * sprite is placed entirely outside the board's edge. Position is read from
 * `trackPosition` every frame and never interpolated here — a corner is crossed
 * in one frame, with the grid re-indexed rather than rotated, so nothing
 * smears.
 *
 * Past a dozen cannons the sprites overlap into mush, so the rail falls back to
 * compact tokens: the colour band alone, which is the one reading that still
 * matters at that density.
 */
export class CannonRenderer {
  readonly view = new Container();

  private readonly laneLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });
  private readonly bodyLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });

  private readonly cells: Particle[] = [];
  private readonly lanes: Particle[] = [];
  private readonly texture: Texture = Texture.WHITE;

  private palette: PaletteEntry[];
  private accent = 0xe8a13c;
  /** The highest capability the profile owns, or null. */
  private capability: keyof typeof MUZZLE_MARKS | null = null;

  constructor(palette: PaletteEntry[]) {
    this.palette = palette;
    this.view.addChild(this.laneLayer);
    this.view.addChild(this.bodyLayer);
  }

  setPalette(palette: PaletteEntry[]): void {
    this.palette = palette;
  }

  /** Which marking the muzzles wear. Null is a cannon with no specialisation. */
  setCapability(capability: keyof typeof MUZZLE_MARKS | null): void {
    this.capability = capability;
  }

  /** Redraws the whole rail. Called once a frame; nothing is retained. */
  sync(cannons: readonly CannonView[], nowMs: number): void {
    const dense = cannons.length > DENSE_THRESHOLD;
    let used = 0;
    let laneUsed = 0;

    for (const cannon of cannons) {
      laneUsed = this.drawLane(cannon, laneUsed);
      used = dense ? this.drawToken(cannon, used) : this.drawSprite(cannon, used, nowMs);
    }

    this.park(this.cells, used);
    this.park(this.lanes, laneUsed);
    this.bodyLayer.update();
    this.laneLayer.update();
  }

  /**
   * The streak down the aimed lane, stopping at the first solid cell.
   *
   * This is the only honest reading of a cannon's reach: what it will hit is
   * whatever the surface exposes, and that is exactly where the streak ends.
   */
  private drawLane(cannon: CannonView, used: number): number {
    if (cannon.frontIndex < 0) return used;

    const targetX = cannon.frontIndex % WORLD_WIDTH;
    const targetY = (cannon.frontIndex / WORLD_WIDTH) | 0;
    const particle = this.take(this.lanes, this.laneLayer, used);

    const row = cannon.aim.axis === "row";
    const length = row
      ? Math.abs(targetX - cannon.aim.x) + 1
      : Math.abs(targetY - cannon.aim.y) + 1;

    particle.x = row ? (cannon.aim.x + targetX) / 2 : cannon.aim.x;
    particle.y = row ? cannon.aim.y : (cannon.aim.y + targetY) / 2;
    particle.scaleX = row ? length : 1;
    particle.scaleY = row ? 1 : length;
    particle.color = packColor(this.colorOf(cannon), Math.round(255 * LANE_ALPHA));

    return used + 1;
  }

  private drawSprite(cannon: CannonView, used: number, nowMs: number): number {
    const oriented = orient(
      spriteFor(cannon.maxAmmo, this.capability),
      cannon.aim.axis,
      cannon.aim.direction,
    );
    const origin = this.originFor(cannon, oriented.width, oriented.height);

    const look: CannonLook = {
      accent: this.accent,
      target: this.colorOf(cannon),
      ammo: cannon.ammo,
      maxAmmo: cannon.maxAmmo,
      unlimited: cannon.unlimited,
      idle: cannon.idle,
    };

    // The last rounds blink rather than shrink: the gauge is already saying how
    // little is left, and the blink is what pulls the eye to the offers.
    const low = !cannon.unlimited && cannon.maxAmmo > 0 && cannon.ammo / cannon.maxAmmo < LOW_AMMO;
    const alpha = low && Math.floor(nowMs / BLINK_MS) % 2 === 0 ? 110 : 255;

    for (const cell of paint(oriented, look, origin.x, origin.y).cells) {
      const particle = this.take(this.cells, this.bodyLayer, used++);
      particle.x = cell.x;
      particle.y = cell.y;
      particle.scaleX = 1;
      particle.scaleY = 1;
      particle.color = packColor(cell.color, alpha);
    }

    return used;
  }

  /** Colour band alone: at this density it is the only legible reading left. */
  private drawToken(cannon: CannonView, used: number): number {
    const row = cannon.aim.axis === "row";
    const particle = this.take(this.cells, this.bodyLayer, used);

    particle.x = cannon.aim.x;
    particle.y = cannon.aim.y;
    particle.scaleX = row ? TOKEN_WIDTH : TOKEN_LENGTH;
    particle.scaleY = row ? TOKEN_LENGTH : TOKEN_WIDTH;
    particle.color = packColor(this.colorOf(cannon), cannon.idle ? 90 : 255);

    return used + 1;
  }

  /**
   * Where the sprite's top-left corner goes.
   *
   * Straddling the rail — half outside the board, half on it. Entirely outside
   * would be honest and invisible: the camera frames the board, so a cannon
   * parked past its edge is off screen. Straddling puts the muzzle on the first
   * few cells of the lane it is about to fire down, which is also where the eye
   * looks. On an imported photograph those cells are the transparent margin; on
   * a full-bleed poster it is five cells out of a thousand, and it reads as the
   * cannon resting on the edge rather than hovering beside it.
   */
  private originFor(cannon: CannonView, width: number, height: number): { x: number; y: number } {
    const { axis, direction, x, y } = cannon.aim;

    if (axis === "row") {
      // Half the sprite's depth sits on the board, the rest hangs off the edge.
      const inset = (width / 2) | 0;
      return {
        x: direction > 0 ? -width + inset : WORLD_WIDTH - inset,
        y: y - ((height / 2) | 0),
      };
    }
    const inset = (height / 2) | 0;
    return {
      x: x - ((width / 2) | 0),
      y: direction > 0 ? -height + inset : WORLD_HEIGHT - inset,
    };
  }

  private colorOf(cannon: CannonView): number {
    const entry = this.palette[cannon.colorId];
    if (!entry) return 0xffffff;
    return (entry.r << 16) | (entry.g << 8) | entry.b;
  }

  private take(pool: Particle[], layer: ParticleContainer, index: number): Particle {
    let particle = pool[index];
    if (!particle) {
      particle = new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      pool.push(particle);
      layer.addParticle(particle);
    }
    return particle;
  }

  private park(pool: Particle[], from: number): void {
    for (let i = from; i < pool.length; i++) {
      pool[i].scaleX = 0;
      pool[i].scaleY = 0;
    }
  }

  destroy(): void {
    // Texture.WHITE is shared and owned by Pixi: never destroy it here.
    this.view.destroy({ children: true });
  }
}

/**
 * Particle colours are written as a raw u32 into a `unorm8x4` attribute, so on
 * a little-endian machine the packing is ABGR, not ARGB. Getting this backwards
 * swaps red and blue silently.
 */
function packColor(rgb: number, alpha: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0);
}
