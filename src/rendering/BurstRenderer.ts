import { Container, Particle, ParticleContainer, Texture } from "pixi.js";
import type { PaletteEntry } from "../core/constants";
import { WORLD_WIDTH } from "../core/constants";
import type { ImpactEvent } from "../combat/CombatSimulator";
import type { BurstEvent } from "../combat/LineBurst";
import type { CannonAim } from "../combat/Cannon";

/**
 * Length of a cannon barrel, in board cells. Its width is always exactly one,
 * so it covers precisely the lane it fires down and never a neighbouring one.
 * The length is a readability choice only: at one cell in both directions the
 * cannon is under a screen pixel at overview zoom and cannot be seen turning.
 */
const CANNON_LENGTH = 14;

/** Starting size of an impact spark, in board cells. It shrinks to one. */
const SPARK_SIZE = 3;

/** Width of a tracer across its lane, in board cells. */
const TRACER_WIDTH = 6;

/** How long a tracer stays visible. Short: the lane is already gone. */
const TRACER_LIFE_MS = 170;

interface Fading {
  particle: Particle;
  lifeMs: number;
  maxLifeMs: number;
}

interface Tracer extends Fading {
  /** Which of the two scales is the band's width across its lane. */
  widthAxis: "x" | "y";
}

/**
 * Everything the player actually sees of a burst: the lane it peeled, and
 * sparks along it.
 *
 * There are no travelling balls any more. A burst resolves instantly — the
 * whole matching run on the lane dies in the same frame — so a ball still
 * flying towards a cell that no longer exists would be a lie. What replaces it
 * is a tracer: a band down the lane that was peeled, fading out over a sixth of
 * a second, plus sparks sampled by the LOD controller.
 *
 * Both live in `ParticleContainer`s, which draw lightweight particles outside
 * the regular scene graph. The count here is bounded by the LOD budget and has
 * no relation to the logical destruction rate — that is the whole point: the
 * graphics budget can never hold a burst back.
 */
export class BurstRenderer {
  readonly view = new Container();

  private readonly tracerLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });
  private readonly sparkLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });
  private readonly muzzleLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });

  private readonly tracers: Tracer[] = [];
  private readonly tracerPool: Particle[] = [];
  private readonly sparks: Fading[] = [];
  private readonly sparkPool: Particle[] = [];

  /**
   * A single white texel. Drawn at scale 1 it covers exactly one board cell,
   * so a spark is the size of the pixel it replaces — the whole point of the
   * scale the game is played at.
   */
  private readonly dotTexture: Texture = Texture.WHITE;
  private palette: PaletteEntry[];
  private readonly muzzles: Particle[] = [];

  constructor(
    palette: PaletteEntry[],
    private readonly maxSparks = 1200,
    private readonly maxTracers = 256,
  ) {
    this.palette = palette;
    this.view.addChild(this.tracerLayer);
    this.view.addChild(this.sparkLayer);
    this.view.addChild(this.muzzleLayer);
  }

  setPalette(palette: PaletteEntry[]): void {
    this.palette = palette;
  }

  /**
   * Particle colours are written as a raw u32 into a `unorm8x4` attribute, so
   * on a little-endian machine the packing is ABGR, not ARGB. Getting this
   * backwards swaps red and blue silently.
   */
  private packedColorOf(colorId: number, alpha = 255): number {
    const entry = this.palette[colorId];
    if (!entry) return 0xffffffff;
    return (((alpha << 24) | (entry.b << 16) | (entry.g << 8) | entry.r) >>> 0);
  }

  /**
   * Draws every cannon currently on the rail, in its own colour, so the player
   * can see one coming: "the blue one is about to reach the bottom".
   */
  syncCannons(aims: ReadonlyArray<{ aim: CannonAim; colorId: number }>): void {
    while (this.muzzles.length < aims.length) {
      const particle = new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });
      this.muzzles.push(particle);
      this.muzzleLayer.addParticle(particle);
    }

    for (let i = 0; i < this.muzzles.length; i++) {
      const muzzle = this.muzzles[i];
      const entry = aims[i];
      if (!entry) {
        muzzle.scaleX = 0;
        muzzle.scaleY = 0;
        continue;
      }
      muzzle.x = entry.aim.x;
      muzzle.y = entry.aim.y;
      // One cell wide across its lane, a few cells long towards the board, so
      // it reads as a barrel pointing in without ever covering a second lane.
      muzzle.scaleX = entry.aim.axis === "column" ? 1 : CANNON_LENGTH;
      muzzle.scaleY = entry.aim.axis === "column" ? CANNON_LENGTH : 1;
      muzzle.color = this.packedColorOf(entry.colorId);
    }
    this.muzzleLayer.update();
  }

  /**
   * Spawns one tracer per burst, spanning the run of cells it took out.
   *
   * Only for a bite that actually took a run. At the base depth of one cell a
   * tracer would be indistinguishable from the spark already drawn there, and
   * at two hundred and sixty bites a second per cannon that is pure noise — the
   * erosion of the outline is the effect, not a line drawn over it.
   */
  spawnBursts(bursts: readonly BurstEvent[]): void {
    for (const burst of bursts) {
      if (this.tracers.length >= this.maxTracers) break;
      if (burst.destroyed <= 1 || burst.firstIndex < 0) continue;

      const particle =
        this.tracerPool.pop() ??
        new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });

      const firstX = burst.firstIndex % WORLD_WIDTH;
      const firstY = (burst.firstIndex / WORLD_WIDTH) | 0;
      const lastX = burst.lastIndex % WORLD_WIDTH;
      const lastY = (burst.lastIndex / WORLD_WIDTH) | 0;

      particle.x = (firstX + lastX) / 2;
      particle.y = (firstY + lastY) / 2;

      const span = burst.destroyed;
      particle.scaleX = burst.axis === "row" ? span : TRACER_WIDTH;
      particle.scaleY = burst.axis === "row" ? TRACER_WIDTH : span;
      particle.color = this.packedColorOf(burst.colorId);

      this.tracerLayer.addParticle(particle);
      this.tracers.push({
        particle,
        lifeMs: 0,
        maxLifeMs: TRACER_LIFE_MS,
        widthAxis: burst.axis === "row" ? "y" : "x",
      });
    }
  }

  spawnImpacts(impacts: readonly ImpactEvent[]): void {
    for (const impact of impacts) {
      if (this.sparks.length >= this.maxSparks) break;

      const particle =
        this.sparkPool.pop() ??
        new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });

      particle.x = impact.x;
      particle.y = impact.y;
      particle.scaleX = SPARK_SIZE;
      particle.scaleY = SPARK_SIZE;
      particle.color = this.packedColorOf(impact.colorId);

      this.sparkLayer.addParticle(particle);
      this.sparks.push({ particle, lifeMs: 0, maxLifeMs: 260 });
    }
  }

  update(deltaMs: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.lifeMs += deltaMs;

      const t = tracer.lifeMs / tracer.maxLifeMs;
      if (t >= 1) {
        this.tracerLayer.removeParticle(tracer.particle);
        this.tracerPool.push(tracer.particle);
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
        continue;
      }

      // The band narrows across its lane as it fades, so a long burst reads as
      // a beam collapsing rather than a rectangle blinking out.
      const width = TRACER_WIDTH * (1 - t) + 1;
      if (tracer.widthAxis === "x") tracer.particle.scaleX = width;
      else tracer.particle.scaleY = width;
      tracer.particle.color = fadeAlpha(tracer.particle.color, 1 - t);
    }
    this.tracerLayer.update();

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];
      spark.lifeMs += deltaMs;

      const t = spark.lifeMs / spark.maxLifeMs;
      if (t >= 1) {
        this.sparkLayer.removeParticle(spark.particle);
        this.sparkPool.push(spark.particle);
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }

      const scale = SPARK_SIZE * (1 - t) + 1;
      spark.particle.scaleX = scale;
      spark.particle.scaleY = scale;
      spark.particle.color = fadeAlpha(spark.particle.color, 1 - t);
    }
    this.sparkLayer.update();
  }

  get sparkCount(): number {
    return this.sparks.length;
  }

  get tracerCount(): number {
    return this.tracers.length;
  }

  destroy(): void {
    // Texture.WHITE is shared and owned by Pixi: never destroy it here.
    this.view.destroy({ children: true });
  }
}

/** Rewrites only the alpha byte of a packed ABGR colour. */
function fadeAlpha(packed: number, alpha: number): number {
  return ((packed & 0x00ffffff) | (Math.round(255 * alpha) << 24)) >>> 0;
}
