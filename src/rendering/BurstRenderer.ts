import { Container, Particle, ParticleContainer, Texture } from "pixi.js";
import type { PaletteEntry } from "../core/constants";
import { WORLD_WIDTH } from "../core/constants";
import type { ImpactEvent } from "../combat/CombatSimulator";
import type { BurstEvent } from "../combat/LineBurst";
import type { EffectMark } from "../combat/SpecialEffects";

/**
 * Four square sparks per impact, one cell each, gone in 180 ms.
 *
 * This is 99 % of what a player sees, so it is dry on purpose: a flash of one
 * frame, four squares, nothing else. No trail, no dust, no shake. The spectacle
 * is rationed to what is rare — the specialisations and the milestones — because
 * at two hundred and sixty lanes a second and up to fifty cannons, it is the
 * only registry that stays legible.
 */
const SPARKS_PER_IMPACT = 4;
const SPARK_LIFE_MS = 180;
const SPARK_SPREAD = 2.5;

/** One frame of pure white on the cell that died, and then nothing. */
const FLASH_LIFE_MS = 17;

/**
 * Impacts past which sparks stop being emitted for the frame.
 *
 * A hard threshold, not a budget to negotiate: beyond this the flash alone
 * carries the reading and the simulation never slows down for an effect.
 */
const HARD_IMPACT_CAP = 400;

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

interface Spark extends Fading {
  vx: number;
  vy: number;
  /** Frames to wait before showing. An arc appears one jump at a time. */
  delayMs: number;
}

/**
 * How long each specialisation's trace lingers.
 *
 * They differ on purpose. A pierce is a click; a blast is a thump; an arc
 * crackles; a fire breathes. If they all faded over the same 200 ms the player
 * would learn one effect instead of four.
 */
const PIERCE_LIFE_MS = 120;
const EXPLODE_LIFE_MS = 140;
const ARC_STEP_MS = 16;
const ARC_LIFE_MS = 100;
const BURN_STEP_MS = 22;
const BURN_LIFE_MS = 400;

/** Warm colours the fire keeps regardless of the colour it is eating. */
const EMBER = 0xe2553f;

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
  private readonly flashLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });

  private readonly tracers: Tracer[] = [];
  private readonly tracerPool: Particle[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkPool: Particle[] = [];
  private readonly flashes: Fading[] = [];
  private readonly flashPool: Particle[] = [];
  private readonly rings: Array<Fading & { radius: number }> = [];

  /**
   * A single white texel. Drawn at scale 1 it covers exactly one board cell,
   * so a spark is the size of the pixel it replaces — the whole point of the
   * scale the game is played at.
   */
  private readonly dotTexture: Texture = Texture.WHITE;
  private palette: PaletteEntry[];

  constructor(
    palette: PaletteEntry[],
    private readonly maxSparks = 2048,
    private readonly maxTracers = 256,
  ) {
    this.palette = palette;
    this.view.addChild(this.tracerLayer);
    this.view.addChild(this.sparkLayer);
    this.view.addChild(this.flashLayer);
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

  /**
   * One impact, image by image: a flash of exactly one frame on the cell, then
   * four square sparks that are gone in a sixth of a second, then nothing.
   *
   * Past the hard cap the sparks stop and the flash carries it alone. The
   * threshold is not a budget to negotiate: the simulation has already resolved
   * everything by the time this runs, and it must never wait for a particle.
   */
  spawnImpacts(impacts: readonly ImpactEvent[]): void {
    const sparking = impacts.length <= HARD_IMPACT_CAP;

    for (const impact of impacts) {
      const flash =
        this.flashPool.pop() ??
        new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });
      flash.x = impact.x;
      flash.y = impact.y;
      flash.scaleX = 1;
      flash.scaleY = 1;
      flash.color = 0xffffffff;
      this.flashLayer.addParticle(flash);
      this.flashes.push({ particle: flash, lifeMs: 0, maxLifeMs: FLASH_LIFE_MS });

      if (!sparking) continue;

      for (let i = 0; i < SPARKS_PER_IMPACT; i++) {
        if (this.sparks.length >= this.maxSparks) return;

        const particle =
          this.sparkPool.pop() ??
          new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });

        particle.x = impact.x;
        particle.y = impact.y;
        particle.scaleX = 1;
        particle.scaleY = 1;
        particle.color = this.packedColorOf(impact.colorId);

        // Four corners rather than a random spray: square sparks leaving a
        // square cell, which is the only shape this board has.
        const vx = i === 0 || i === 3 ? -SPARK_SPREAD : SPARK_SPREAD;
        const vy = i < 2 ? -SPARK_SPREAD : SPARK_SPREAD;

        this.sparkLayer.addParticle(particle);
        this.sparks.push({ particle, lifeMs: 0, maxLifeMs: SPARK_LIFE_MS, vx, vy, delayMs: 0 });
      }
    }
  }

  /**
   * Traces what a specialisation left behind.
   *
   * The shape comes from the simulation, which is the only thing that knows
   * which cells were actually taken and in which order. Drawing a plausible
   * shape here instead would be the renderer inventing gameplay.
   */
  spawnEffects(marks: ReadonlyArray<{ mark: EffectMark; colorId: number }>): void {
    for (const { mark, colorId } of marks) {
      switch (mark.kind) {
        case "pierce":
          // A thin line through what it looked past, and nothing at the end:
          // the cells it crossed are still standing, and must look it.
          this.trace(mark.from, mark.to, 0xffffff, PIERCE_LIFE_MS, 1);
          break;

        case "explode": {
          // A ring that opens: a square outline growing to the radius. It is
          // the loudest effect, so it is the only one that also shakes.
          const particle = this.takeSpark();
          if (!particle) break;
          particle.x = mark.center % WORLD_WIDTH;
          particle.y = (mark.center / WORLD_WIDTH) | 0;
          particle.scaleX = 1;
          particle.scaleY = 1;
          particle.color = this.packedColorOf(colorId, 200);
          this.rings.push({
            particle,
            lifeMs: 0,
            maxLifeMs: EXPLODE_LIFE_MS,
            radius: Math.max(1, mark.radius),
          });
          break;
        }

        case "arc":
          // One frame per jump: the polyline draws itself along the colour.
          this.walk(mark.path, this.packedColorOf(colorId, 255), ARC_STEP_MS, ARC_LIFE_MS);
          break;

        case "burn":
          // Embers keep their own colour: a fire is warm whatever it eats.
          this.walk(mark.path, packRgb(EMBER, 235), BURN_STEP_MS, BURN_LIFE_MS);
          break;
      }
    }
  }

  /** A one-cell-wide line between two board cells. */
  private trace(from: number, to: number, rgb: number, lifeMs: number, width: number): void {
    const fx = from % WORLD_WIDTH;
    const fy = (from / WORLD_WIDTH) | 0;
    const tx = to % WORLD_WIDTH;
    const ty = (to / WORLD_WIDTH) | 0;

    const particle = this.takeSpark();
    if (!particle) return;

    particle.x = (fx + tx) / 2;
    particle.y = (fy + ty) / 2;
    particle.scaleX = Math.max(width, Math.abs(tx - fx) + 1);
    particle.scaleY = Math.max(width, Math.abs(ty - fy) + 1);
    particle.color = packRgb(rgb, 220);
    this.sparks.push({ particle, lifeMs: 0, maxLifeMs: lifeMs, vx: 0, vy: 0, delayMs: 0 });
  }

  /** Lights a path cell by cell, each one a step behind the last. */
  private walk(path: readonly number[], color: number, stepMs: number, lifeMs: number): void {
    for (let i = 0; i < path.length; i++) {
      const particle = this.takeSpark();
      if (!particle) return;

      particle.x = path[i] % WORLD_WIDTH;
      particle.y = (path[i] / WORLD_WIDTH) | 0;
      particle.scaleX = 1;
      particle.scaleY = 1;
      particle.color = color;
      this.sparks.push({
        particle,
        lifeMs: 0,
        maxLifeMs: lifeMs,
        vx: 0,
        vy: 0,
        delayMs: i * stepMs,
      });
    }
  }

  private takeSpark(): Particle | null {
    if (this.sparks.length + this.rings.length >= this.maxSparks) return null;
    const particle =
      this.sparkPool.pop() ??
      new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });
    this.sparkLayer.addParticle(particle);
    return particle;
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

    // The flash is one frame and no more: anything that lingers on an ordinary
    // impact turns a million of them into soup.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.lifeMs += deltaMs;
      if (flash.lifeMs < flash.maxLifeMs) continue;

      this.flashLayer.removeParticle(flash.particle);
      this.flashPool.push(flash.particle);
      this.flashes[i] = this.flashes[this.flashes.length - 1];
      this.flashes.pop();
    }
    this.flashLayer.update();

    // A ring opens rather than fades in place: the square outline grows to the
    // radius the blast actually reached, so its size is the reading.
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.lifeMs += deltaMs;

      const t = ring.lifeMs / ring.maxLifeMs;
      if (t >= 1) {
        this.sparkLayer.removeParticle(ring.particle);
        this.sparkPool.push(ring.particle);
        this.rings[i] = this.rings[this.rings.length - 1];
        this.rings.pop();
        continue;
      }

      const size = 1 + ring.radius * 2 * t;
      ring.particle.scaleX = size;
      ring.particle.scaleY = size;
      ring.particle.color = fadeAlpha(ring.particle.color, (1 - t) * 0.5);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];

      // A delayed cell is held off screen until its turn: that is what makes an
      // arc read as a walk rather than a shape appearing whole.
      if (spark.delayMs > 0) {
        spark.delayMs -= deltaMs;
        spark.particle.scaleX = 0;
        spark.particle.scaleY = 0;
        continue;
      }
      if (spark.particle.scaleX === 0) {
        spark.particle.scaleX = 1;
        spark.particle.scaleY = 1;
      }

      spark.lifeMs += deltaMs;

      const t = spark.lifeMs / spark.maxLifeMs;
      if (t >= 1) {
        this.sparkLayer.removeParticle(spark.particle);
        this.sparkPool.push(spark.particle);
        this.sparks[i] = this.sparks[this.sparks.length - 1];
        this.sparks.pop();
        continue;
      }

      // A square cell throws square sparks: they drift and go out, they never
      // grow, and they leave nothing behind.
      spark.particle.x += (spark.vx * deltaMs) / 1000;
      spark.particle.y += (spark.vy * deltaMs) / 1000;
      spark.particle.color = fadeAlpha(spark.particle.color, 1 - t);
    }
    this.sparkLayer.update();
  }

  get sparkCount(): number {
    return this.sparks.length;
  }

  get flashCount(): number {
    return this.flashes.length;
  }

  get tracerCount(): number {
    return this.tracers.length;
  }

  destroy(): void {
    // Texture.WHITE is shared and owned by Pixi: never destroy it here.
    this.view.destroy({ children: true });
  }
}

/**
 * Packs a plain RGB into the ABGR word a particle expects.
 *
 * Particle colours are written as a raw u32 into a `unorm8x4` attribute, so on
 * a little-endian machine the packing is ABGR, not ARGB.
 */
function packRgb(rgb: number, alpha: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

/** Rewrites only the alpha byte of a packed ABGR colour. */
function fadeAlpha(packed: number, alpha: number): number {
  return ((packed & 0x00ffffff) | (Math.round(255 * alpha) << 24)) >>> 0;
}
