import {
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Texture,
  type Renderer,
} from "pixi.js";
import type { PaletteEntry } from "../core/constants";
import type { ImpactEvent } from "../combat/CombatSimulator";
import type { ProjectilePool } from "../combat/ProjectilePool";

interface Spark {
  particle: Particle;
  lifeMs: number;
  maxLifeMs: number;
}

/**
 * Everything the player actually sees moving: balls and impact sparks.
 *
 * Both live in `ParticleContainer`s, which draw lightweight particles outside
 * the regular scene graph. The count here is bounded by the LOD budget and has
 * no relation to the logical impact rate — that is the whole point.
 */
export class ProjectileRenderer {
  readonly view = new Container();

  private readonly ballLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });
  private readonly sparkLayer = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false },
  });

  private readonly balls: Particle[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkPool: Particle[] = [];

  private dotTexture: Texture;
  private palette: PaletteEntry[];

  constructor(renderer: Renderer, palette: PaletteEntry[], private readonly maxSparks = 1200) {
    this.palette = palette;
    this.dotTexture = createDotTexture(renderer);
    this.view.addChild(this.sparkLayer);
    this.view.addChild(this.ballLayer);
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

  /** Mirrors the live projectile pool into particles, reusing the same objects. */
  syncProjectiles(pool: ProjectilePool): void {
    let used = 0;

    pool.forEachActive((projectile) => {
      let particle = this.balls[used];
      if (!particle) {
        particle = new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });
        this.balls.push(particle);
        this.ballLayer.addParticle(particle);
      }
      particle.x = projectile.x;
      particle.y = projectile.y;
      particle.scaleX = 3;
      particle.scaleY = 3;
      particle.color = this.packedColorOf(projectile.colorId);
      used++;
    });

    // Park the surplus off-screen rather than reallocating the container.
    for (let i = used; i < this.balls.length; i++) {
      this.balls[i].scaleX = 0;
      this.balls[i].scaleY = 0;
    }
    this.ballLayer.update();
  }

  spawnImpacts(impacts: readonly ImpactEvent[]): void {
    for (const impact of impacts) {
      if (this.sparks.length >= this.maxSparks) break;

      const particle =
        this.sparkPool.pop() ??
        new Particle({ texture: this.dotTexture, anchorX: 0.5, anchorY: 0.5 });

      particle.x = impact.x;
      particle.y = impact.y;
      particle.scaleX = 6;
      particle.scaleY = 6;
      particle.color = this.packedColorOf(impact.colorId);

      this.sparkLayer.addParticle(particle);
      this.sparks.push({ particle, lifeMs: 0, maxLifeMs: 260 });
    }
  }

  update(deltaMs: number): void {
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

      const scale = 6 * (1 - t) + 1;
      spark.particle.scaleX = scale;
      spark.particle.scaleY = scale;
      // Only the alpha byte changes as the spark fades out.
      spark.particle.color =
        ((spark.particle.color & 0x00ffffff) | (Math.round(255 * (1 - t)) << 24)) >>> 0;
    }
    this.sparkLayer.update();
  }

  get sparkCount(): number {
    return this.sparks.length;
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.dotTexture.destroy(true);
  }
}

function createDotTexture(renderer: Renderer): Texture {
  const graphics = new Graphics().circle(8, 8, 7).fill(0xffffff);
  const texture = renderer.generateTexture({ target: graphics, resolution: 1 });
  graphics.destroy();
  return texture;
}
