import { Application, Container } from "pixi.js";
import { CombatSimulator, FINALE_THRESHOLD } from "../combat/CombatSimulator";
import {
  DEFAULT_ALPHA_THRESHOLD,
  PIXEL_COUNT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type PaletteEntry,
} from "../core/constants";

import { ActiveCannon, type ActiveCannonState } from "../cannon/ActiveCannon";
import { CannonLoadGenerator, type CannonLoad } from "../cannon/CannonLoad";
import { CannonQueue } from "../cannon/CannonQueue";
import { ColorAmmoReserve } from "../cannon/ColorAmmoReserve";
import { ImageWorkerClient, type ImageProgress } from "../image/ImageWorkerClient";
import type { ImageProcessOptions } from "../image/ImageProtocol";
import { IdleWorkerClient } from "../idle/IdleWorkerClient";
import {
  DEFAULT_MAX_OFFLINE_MS,
  OFFLINE_REPORT_THRESHOLD_MS,
} from "../idle/IdleProtocol";
import { SaveRepository } from "../persistence/SaveRepository";
import type { CurrentLevelSave } from "../persistence/schema";
import { SAVE_SCHEMA_VERSION } from "../persistence/schema";
import { PixelTextureRenderer } from "../rendering/PixelTextureRenderer";
import { Viewport, type ScreenRect } from "../rendering/Viewport";
import { BurstRenderer } from "../rendering/BurstRenderer";
import {
  DESKTOP_BUDGET,
  MOBILE_BUDGET,
  VisualLODController,
} from "../rendering/VisualLODController";
import { RNG_ALGORITHM, XorShift32 } from "../rng/XorShift32";
import { UpgradeState, type UpgradeId } from "../progression/Upgrades";
import { ColorStats } from "../world/ColorStats";
import { PixelWorld } from "../world/PixelWorld";
import { isMobileProfile } from "./FeatureDetection";
import { MilestoneTracker, type Milestone } from "./milestones";
import { Profiler } from "./Profiler";

export type GamePhase = "idle" | "processing" | "playing";

export interface OfflineReport {
  elapsedMs: number;
  totalDestroyed: number;
  removedByColor: Uint32Array;
  durationMs: number;
}

export interface GameEvents {
  onPhase?: (phase: GamePhase) => void;
  onProgress?: (progress: ImageProgress) => void;
  /**
   * The level is built but not running: the player gets to see what their
   * image became before choosing to start.
   */
  onLevelPrepared?: (palette: PaletteEntry[], colorId: Uint8Array, width: number) => void;
  onLevelReady?: (world: PixelWorld) => void;
  onMilestone?: (milestone: Milestone) => void;
  /** The board is empty. Fired once per pass, the moment the last pixel goes. */
  onLevelCleared?: (pass: number) => void;
  /** The level took over and is finishing itself. Fired once per pass. */
  onFinale?: () => void;
  onOfflineReport?: (report: OfflineReport) => void;
  onError?: (message: string) => void;
}

const PROFILE_ID = "local";
const AUTOSAVE_INTERVAL_MS = 10_000;

/**
 * Owns the whole session: import, run, autosave, offline catch-up.
 *
 * The authoritative state is always the CPU-side `PixelWorld`. Everything else
 * (texture, particles, UI) is a projection of it that can be rebuilt at will.
 */
export class GameController {
  readonly app: Application;
  readonly boardLayer = new Container();
  readonly profiler = new Profiler();
  readonly viewport = new Viewport();

  private readonly imageClient = new ImageWorkerClient();
  private readonly idleClient = new IdleWorkerClient();
  private readonly saves = new SaveRepository();
  private readonly lod: VisualLODController;

  private world: PixelWorld | null = null;
  private reserve: ColorAmmoReserve | null = null;
  private queue: CannonQueue | null = null;
  private combat: CombatSimulator | null = null;
  private board: PixelTextureRenderer | null = null;
  private bursts: BurstRenderer | null = null;
  private milestones = new MilestoneTracker();
  private stats: ColorStats | null = null;
  private upgrades = new UpgradeState();
  private generator: CannonLoadGenerator | null = null;

  private rng = new XorShift32(0x12345678);
  private fractionalCarry: number[] = [];

  private levelId = "level-1";
  /** Times this image has been cleared. Zero on the first pass. */
  private completions = 0;
  /** Latched so clearing the board announces itself once, not every frame. */
  private clearedAnnounced = false;
  private createdAtEpochMs = Date.now();
  private lastSimulatedAtEpochMs = Date.now();

  private phase: GamePhase = "idle";
  private prepared: PixelWorld | null = null;
  /** The opening framing needs a real play area, which arrives a frame later. */
  private needsFraming = false;
  private saveDirty = false;
  private lastAutosaveMs = 0;
  private detachContextHandler: (() => void) | null = null;

  constructor(
    app: Application,
    private readonly events: GameEvents = {},
  ) {
    this.app = app;
    this.app.stage.addChild(this.boardLayer);
    this.lod = new VisualLODController(isMobileProfile() ? MOBILE_BUDGET : DESKTOP_BUDGET);
    this.app.ticker.add(this.tick);
    this.installLifecycleHooks();
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  /** 1 on a fresh image, 2 after one clear, and so on. */
  get pass(): number {
    return this.completions + 1;
  }

  /** True once the last pixel of the current pass is gone. */
  get isCleared(): boolean {
    return this.world !== null && this.world.aliveTotal() === 0;
  }

  /**
   * True while a level is set aside rather than finished — the player went back
   * to the import screen and can still change their mind.
   */
  get canResume(): boolean {
    return this.phase === "idle" && this.world !== null;
  }

  getWorld(): PixelWorld | null {
    return this.world;
  }

  getQueue(): CannonQueue | null {
    return this.queue;
  }

  getReserve(): ColorAmmoReserve | null {
    return this.reserve;
  }

  /** Spends a queued load: it leaves the queue and joins the rail. */
  launch(loadId: string): boolean {
    const launched = this.combat?.launch(loadId) ?? null;
    if (launched) this.saveDirty = true;
    return launched !== null;
  }

  getCombat(): CombatSimulator | null {
    return this.combat;
  }

  getStats(): ColorStats | null {
    return this.stats;
  }

  getUpgrades(): UpgradeState {
    return this.upgrades;
  }

  /**
   * Buys one level and pushes it straight into the running game, including the
   * cannons already on the rail.
   */
  buyUpgrade(id: UpgradeId): boolean {
    if (!this.upgrades.buy(id)) return false;
    this.applyUpgrades();
    this.saveDirty = true;
    return true;
  }

  private applyUpgrades(): void {
    const effects = this.upgrades.effects();
    this.combat?.setMaxActiveCannons(effects.maxActiveCannons);
    this.combat?.tuneCannons(effects.moveSpeed);
    this.generator?.setAmmoPerLoad(effects.ammoPerLoad);
    this.queue?.setSize(effects.visibleLoads);
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.events.onPhase?.(phase);
  }

  // --- Import -------------------------------------------------------------

  async importImage(
    file: File,
    overrides: Partial<ImageProcessOptions> = {},
  ): Promise<void> {
    this.setPhase("processing");
    try {
      const options: ImageProcessOptions = {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        fit: "contain",
        // No paletteSize and no quantizer: the worker reads them off the image.
        alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
        fillMargins: false,
        ...overrides,
      };

      const result = await this.imageClient.process(file, options, (progress) =>
        this.events.onProgress?.(progress),
      );

      const palette: PaletteEntry[] = result.palette;
      const colorId = new Uint8Array(result.colorId);

      this.levelId = `level-${Date.now()}`;
      this.createdAtEpochMs = Date.now();
      this.lastSimulatedAtEpochMs = Date.now();
      this.rng = new XorShift32(hashString(file.name + file.size) || 0x12345678);
      this.fractionalCarry = new Array(palette.length).fill(0);

      // A new image starts from the base values: upgrades are per level.
      this.upgrades = new UpgradeState();
      this.prepared = PixelWorld.create(palette, colorId);
      this.events.onLevelPrepared?.(palette, this.prepared.colorId, this.prepared.width);
    } catch (error) {
      this.setPhase("idle");
      this.events.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Starts the level the last import prepared. */
  startPreparedLevel(): void {
    if (!this.prepared) return;
    const world = this.prepared;
    this.prepared = null;
    this.completions = 0;
    this.startLevel(world);
    this.saveDirty = true;
    void this.save();
  }

  // --- Reprise, redémarrage, changement d'image ---------------------------

  /**
   * Sets the current level aside and shows the import screen.
   *
   * Nothing is torn down and nothing is deleted: the world stays in memory, the
   * save stays in IndexedDB under its own level id, and `resume()` picks the run
   * back up exactly where it stopped. Importing another image is what finally
   * moves on — and even then the old level's record survives, because a new
   * import writes under a new id rather than over the old one.
   */
  suspendForImport(): void {
    if (this.phase !== "playing") return;
    this.saveDirty = true;
    void this.save();
    this.setPhase("idle");
  }

  /** Comes back to the level `suspendForImport()` set aside. */
  resume(): boolean {
    if (!this.canResume) return false;
    // The play area was hidden, so its size has to be measured again before the
    // camera can frame anything.
    this.needsFraming = true;
    this.lastSimulatedAtEpochMs = Date.now();
    this.setPhase("playing");
    return true;
  }

  /**
   * Puts the image back the way it was imported, and the player back at zero.
   *
   * Upgrades and fragments go with it. That is the point rather than a
   * punishment: keeping them would make restarting a way to farm fragments off
   * the same pixels over and over, since a destroyed pixel is a fragment and
   * the board would hand out the same million again.
   */
  restartLevel(): boolean {
    if (!this.world) return false;
    this.completions = 0;
    this.upgrades = new UpgradeState();
    this.rebuildFromBaseImage();
    return true;
  }

  /**
   * Starts the next pass over a cleared image, keeping everything bought.
   *
   * This is the loop that makes an image worth finishing: the board comes back
   * whole, but against a rail the player spent the whole previous pass
   * building. Only reachable once the last pixel is gone, so the fragments a
   * pass hands out have to be earned in full before they can be earned again.
   */
  startNextPass(): boolean {
    if (!this.isCleared) return false;
    this.completions++;
    this.rebuildFromBaseImage();
    return true;
  }

  private rebuildFromBaseImage(): void {
    const world = this.world;
    if (!world) return;

    this.fractionalCarry = new Array(world.paletteSize).fill(0);
    this.startLevel(world.restart());
    this.saveDirty = true;
    void this.save();
  }

  private startLevel(
    world: PixelWorld,
    saved?: { loads: CannonLoad[]; cannons: ActiveCannon[] },
  ): void {
    this.teardownLevel();

    this.world = world;
    this.clearedAnnounced = false;
    this.milestones = new MilestoneTracker(world.progress());
    this.stats = new ColorStats(world);

    this.reserve = new ColorAmmoReserve(world);
    this.generator = new CannonLoadGenerator(this.reserve, this.rng);
    this.queue = new CannonQueue(this.generator, this.reserve);

    this.combat = new CombatSimulator(world, this.queue, this.reserve, {}, this.lod);
    this.applyUpgrades();

    if (saved) {
      this.combat.restoreCannons(saved.cannons);
      for (const cannon of saved.cannons) {
        this.reserve.reserveForQueue(cannon.colorId, cannon.ammo);
        this.reserve.promoteToActive(cannon.colorId, cannon.ammo);
      }
      this.queue.restore(saved.loads);
    } else {
      this.queue.refill();
    }

    this.board = new PixelTextureRenderer(world.colorId, world.width, world.height, world.palette, {
      uploadHz: this.lod.currentBudget.textureUploadHz,
    });
    this.bursts = new BurstRenderer(world.palette);

    this.boardLayer.addChild(this.board.mesh);
    this.boardLayer.addChild(this.bursts.view);

    // Balls are one cell across, so the level opens close enough for a
    // destroyed pixel to read as an event rather than as noise.
    this.needsFraming = true;

    this.detachContextHandler = PixelTextureRenderer.attachContextLossHandler(
      this.app.renderer,
      () => this.board?.restore(world.palette),
    );

    // The image funds its own destruction: one destroyed pixel is one fragment.
    world.onDestroy(() => {
      this.upgrades.earn(1);
      this.saveDirty = true;
    });

    this.setPhase("playing");
    this.events.onLevelReady?.(world);
  }

  private teardownLevel(): void {
    this.detachContextHandler?.();
    this.detachContextHandler = null;

    if (this.board) {
      this.boardLayer.removeChild(this.board.mesh);
      this.board.destroy();
      this.board = null;
    }
    if (this.bursts) {
      this.boardLayer.removeChild(this.bursts.view);
      this.bursts.destroy();
      this.bursts = null;
    }
    this.world?.onDestroy(null);
    this.combat = null;
    this.queue = null;
    this.reserve = null;
    this.generator = null;
  }

  /** Frames the board into the play area the layout provides. */
  layoutBoard(area: ScreenRect): void {
    this.viewport.setArea(area);
    // The opening zoom can only be computed once the play area is measured;
    // running it earlier would clamp against a placeholder rectangle.
    if (this.needsFraming) {
      this.needsFraming = false;
      this.viewport.reset();
    }
    this.applyViewport();
  }

  /** Pushes the camera onto the render container. */
  applyViewport(): void {
    this.boardLayer.scale.set(this.viewport.scale);
    this.boardLayer.position.set(this.viewport.offsetX(), this.viewport.offsetY());
  }

  // --- Loop ---------------------------------------------------------------

  private tick = (): void => {
    const nowMs = performance.now();
    const deltaMs = Math.min(this.app.ticker.deltaMS, 100); // clamp after a stall

    if (this.phase !== "playing" || !this.combat || !this.world || !this.board) return;

    const simStart = performance.now();
    this.combat.update(deltaMs, nowMs);
    const simMs = performance.now() - simStart;

    const stats = this.combat.getStats();

    this.bursts?.syncCannons(
      this.combat.activeCannons.map((cannon) => ({ aim: cannon.aim(), colorId: cannon.colorId })),
    );
    this.bursts?.spawnBursts(this.combat.bursts);
    this.bursts?.spawnImpacts(this.combat.visibleImpacts);
    this.bursts?.update(deltaMs);

    if (this.world.isDirty()) {
      this.board.markDirty();
      this.world.clearDirty();
    }
    this.board.syncTexture(nowMs);

    // The chromatic distribution is live gameplay data, not a readout: it is
    // what drives bottleneck detection and, later, the deck's adaptation. The
    // per-colour effort is no longer declared by a cadence — it is measured
    // from what actually stopped existing.
    this.stats?.sample(nowMs);

    const crossed = this.milestones.update(this.world.progress());
    for (const milestone of crossed) this.events.onMilestone?.(milestone);

    // The tail of a level is where players get stranded: what is left is a
    // handful of pixels, often buried, and too few to fund a cannon. Past the
    // threshold the game finishes the image itself.
    if (!this.combat.isFinale && this.world.progress() >= FINALE_THRESHOLD) {
      this.combat.startFinale();
      this.saveDirty = true;
      this.events.onFinale?.();
    }

    if (!this.clearedAnnounced && this.world.aliveTotal() === 0) {
      this.clearedAnnounced = true;
      this.saveDirty = true;
      void this.save();
      this.events.onLevelCleared?.(this.pass);
    }

    this.profiler.recordFrame(deltaMs, simMs);
    this.profiler.recordCounters(
      nowMs,
      stats.lanesExamined,
      this.combat.visibleImpacts.length,
      stats.destroyed,
    );

    if (this.saveDirty && nowMs - this.lastAutosaveMs > AUTOSAVE_INTERVAL_MS) {
      this.lastAutosaveMs = nowMs;
      void this.save();
    }
  };

  // --- Persistence & offline ---------------------------------------------

  private installLifecycleHooks(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      // `visibilitychange` to hidden is the last reliably observable moment of
      // a session; `beforeunload` is not dependable, especially on mobile.
      if (document.visibilityState === "hidden") void this.save();
    });

  }

  async save(): Promise<void> {
    const world = this.world;
    const queue = this.queue;
    const combat = this.combat;
    if (!world || !queue || !combat) return;

    this.lastSimulatedAtEpochMs = Date.now();
    const save: CurrentLevelSave = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      profileId: PROFILE_ID,
      levelId: this.levelId,
      width: world.width,
      height: world.height,
      paletteSize: world.paletteSize,
      palette: world.palette,
      baseColorId: world.baseColorId.buffer as ArrayBuffer,
      colorId: world.colorId.buffer as ArrayBuffer,
      hp: world.hp.buffer as ArrayBuffer,
      flags: world.flags.buffer as ArrayBuffer,
      loads: [...queue.visible],
      // Finale cannons are not part of the run: they carry no stock and no line
      // in the reserve, and the finale re-arms itself from the board's progress
      // when the level comes back.
      cannons: combat.activeCannons
        .filter((cannon) => !cannon.unlimited)
        .map((cannon) => cannon.serialize()),
      upgrades: this.upgrades.serialize(),
      completions: this.completions,
      // What the rail was actually producing, per colour, at the moment the
      // player left. The offline model runs on this rather than on a formula.
      observedRateByColor: this.stats?.ratesByColor() ?? [],
      rngAlgorithm: RNG_ALGORITHM,
      rngState: this.rng.snapshot(),
      fractionalCarryByColor: this.fractionalCarry,
      createdAtEpochMs: this.createdAtEpochMs,
      lastSimulatedAtEpochMs: this.lastSimulatedAtEpochMs,
    };

    try {
      await this.saves.putLevel(save);
      this.saveDirty = false;
    } catch (error) {
      this.events.onError?.(
        `Sauvegarde impossible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Restores the most recent level and resolves the absence before the first
   * frame, so the player comes back to an image that really was eaten into.
   */
  async restoreLatest(): Promise<boolean> {
    let saved: CurrentLevelSave | null = null;
    try {
      const all = await this.saves.listLevels(PROFILE_ID);
      saved = all.sort((a, b) => b.lastSimulatedAtEpochMs - a.lastSimulatedAtEpochMs)[0] ?? null;
    } catch {
      return false;
    }
    if (!saved) return false;

    this.levelId = saved.levelId;
    this.createdAtEpochMs = saved.createdAtEpochMs;
    this.lastSimulatedAtEpochMs = saved.lastSimulatedAtEpochMs;
    this.rng = new XorShift32(saved.rngState);
    this.fractionalCarry = saved.fractionalCarryByColor.slice();
    this.upgrades = UpgradeState.restore(saved.upgrades);
    this.completions = saved.completions;

    const world = new PixelWorld(
      {
        baseColorId: new Uint8Array(saved.baseColorId),
        colorId: new Uint8Array(saved.colorId),
        hp: new Uint8Array(saved.hp),
        flags: new Uint8Array(saved.flags),
      },
      saved.palette,
    );

    const elapsedMs = Math.max(0, Date.now() - saved.lastSimulatedAtEpochMs);
    if (elapsedMs > 1000) {
      // The board buffers are transferred to the worker, so `world` must not be
      // touched again until the reply lands with the buffers it hands back.
      const report = await this.runOfflineCatchUp(
        world,
        saved.cannons,
        saved.observedRateByColor,
        world.colorId,
        world.hp,
        elapsedMs,
      );
      if (report) {
        const caughtUp = new PixelWorld(
          {
            baseColorId: world.baseColorId,
            colorId: report.colorId,
            hp: report.hp,
            flags: world.flags,
          },
          saved.palette,
        );
        this.startLevel(caughtUp, {
          loads: saved.loads,
          cannons: saved.cannons.map(ActiveCannon.restore),
        });
        // The catch-up always runs; only a real absence is worth announcing.
        if (report.report.elapsedMs >= OFFLINE_REPORT_THRESHOLD_MS) {
          this.events.onOfflineReport?.(report.report);
        }
        this.saveDirty = true;
        await this.save();
        return true;
      }
    }

    this.startLevel(world, {
      loads: saved.loads,
      cannons: saved.cannons.map(ActiveCannon.restore),
    });
    return true;
  }

  /**
   * Resolves an absence.
   *
   * The offline model stays aggregated: it spends the rounds the rail was
   * carrying, spread over the colours those cannons targeted, and deletes real
   * pixels through the index. The exact trajectory of eight hours of shots is
   * not worth reconstructing — nobody was watching them — but the pixels that
   * disappear are real, which is the part the player comes back to.
   */
  private async runOfflineCatchUp(
    world: PixelWorld,
    cannons: ActiveCannonState[],
    observedRateByColor: readonly number[],
    colorId: Uint8Array,
    hp: Uint8Array,
    elapsedMs: number,
  ): Promise<{ colorId: Uint8Array; hp: Uint8Array; report: OfflineReport } | null> {
    // Production used to be derived from each cannon's fire interval. There is
    // no interval any more, and no formula predicts a burst rate: it depends on
    // how much of the colour the surface happens to expose, which only the
    // simulation knows. So the model carries the rate that was *measured* while
    // the player was there, capped by the rounds their cannons still hold — a
    // colour cannot produce offline what it has no ammunition for.
    const stock = new Array<number>(world.paletteSize).fill(0);
    for (const cannon of cannons) {
      if (cannon.colorId >= stock.length) continue;
      stock[cannon.colorId] += cannon.ammo;
    }

    const seconds = Math.max(1, elapsedMs / 1000);
    const dps = new Array<number>(world.paletteSize).fill(0);
    for (let colour = 0; colour < dps.length; colour++) {
      if (stock[colour] === 0) continue;
      const measured = Math.max(0, observedRateByColor[colour] ?? 0);
      dps[colour] = Math.min(measured, stock[colour] / seconds);
    }

    try {
      const output = await this.idleClient.simulate({
        elapsedMs,
        width: world.width,
        height: world.height,
        paletteSize: world.paletteSize,
        colorId,
        hp,
        rngState: this.rng.snapshot(),
        damagePerSecondByColor: dps,
        fractionalCarryByColor: this.fractionalCarry,
        maxOfflineMs: DEFAULT_MAX_OFFLINE_MS,
      });

      this.rng = new XorShift32(output.rngState);
      this.fractionalCarry = output.fractionalCarryByColor;

      return {
        colorId: output.colorId,
        hp: output.hp,
        report: {
          elapsedMs: output.elapsedAppliedMs,
          totalDestroyed: output.totalDestroyed,
          removedByColor: output.removedByColor,
          durationMs: output.durationMs,
        },
      };
    } catch (error) {
      this.events.onError?.(
        `Reprise hors-ligne impossible : ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  dispose(): void {
    this.app.ticker.remove(this.tick);
    this.teardownLevel();
    this.imageClient.dispose();
    this.idleClient.dispose();
  }
}

export function totalCells(): number {
  return PIXEL_COUNT;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
