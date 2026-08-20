import { Application, Container } from "pixi.js";
import { Cannon } from "../combat/Cannon";
import { CombatSimulator } from "../combat/CombatSimulator";
import {
  DEFAULT_ALPHA_THRESHOLD,
  PIXEL_COUNT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type PaletteEntry,
} from "../core/constants";
import { generateDeck } from "../deck/DeckGenerator";
import { DeckRuntime } from "../deck/DeckRuntime";
import type { ColorCard } from "../deck/cards";
import { ImageWorkerClient, type ImageProgress } from "../image/ImageWorkerClient";
import type { ImageProcessOptions } from "../image/ImageProtocol";
import { IdleWorkerClient } from "../idle/IdleWorkerClient";
import { DEFAULT_MAX_OFFLINE_MS } from "../idle/IdleProtocol";
import { SaveRepository } from "../persistence/SaveRepository";
import type { LevelSaveV1 } from "../persistence/schema";
import { SAVE_SCHEMA_VERSION } from "../persistence/schema";
import { PixelTextureRenderer } from "../rendering/PixelTextureRenderer";
import { ProjectileRenderer } from "../rendering/ProjectileRenderer";
import {
  DESKTOP_BUDGET,
  MOBILE_BUDGET,
  VisualLODController,
} from "../rendering/VisualLODController";
import { RNG_ALGORITHM, XorShift32 } from "../rng/XorShift32";
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
  onLevelReady?: (world: PixelWorld) => void;
  onMilestone?: (milestone: Milestone) => void;
  onOfflineReport?: (report: OfflineReport) => void;
  onError?: (message: string) => void;
}

const PROFILE_ID = "local";
const DEFAULT_DECK_SIZE = 12;
const AUTOSAVE_INTERVAL_MS = 10_000;
/** Keeps the board clear of the HUD panel; mirrors #hud in styles.css. */
const HUD_WIDTH = 352;

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

  private readonly imageClient = new ImageWorkerClient();
  private readonly idleClient = new IdleWorkerClient();
  private readonly saves = new SaveRepository();
  private readonly lod: VisualLODController;

  private world: PixelWorld | null = null;
  private deck: DeckRuntime | null = null;
  private cannon = new Cannon();
  private combat: CombatSimulator | null = null;
  private board: PixelTextureRenderer | null = null;
  private projectiles: ProjectileRenderer | null = null;
  private milestones = new MilestoneTracker();

  private rng = new XorShift32(0x12345678);
  private fractionalCarry: number[] = [];

  private levelId = "level-1";
  private createdAtEpochMs = Date.now();
  private lastSimulatedAtEpochMs = Date.now();

  private phase: GamePhase = "idle";
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

  getWorld(): PixelWorld | null {
    return this.world;
  }

  getDeck(): DeckRuntime | null {
    return this.deck;
  }

  getCombat(): CombatSimulator | null {
    return this.combat;
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
        paletteSize: 8,
        quantizer: "median-cut",
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

      const world = PixelWorld.create(palette, colorId);
      const deck = new DeckRuntime(
        generateDeck(
          palette.map((entry) => entry.count),
          { deckSize: DEFAULT_DECK_SIZE },
        ),
      );

      this.startLevel(world, deck, new Cannon());
      this.saveDirty = true;
      await this.save();
    } catch (error) {
      this.setPhase("idle");
      this.events.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private startLevel(world: PixelWorld, deck: DeckRuntime, cannon: Cannon): void {
    this.teardownLevel();

    this.world = world;
    this.deck = deck;
    this.cannon = cannon;
    this.milestones = new MilestoneTracker(world.progress());

    this.combat = new CombatSimulator(world, deck, cannon, this.rng, {}, this.lod);

    this.board = new PixelTextureRenderer(world.colorId, world.width, world.height, world.palette, {
      uploadHz: this.lod.currentBudget.textureUploadHz,
    });
    this.projectiles = new ProjectileRenderer(this.app.renderer, world.palette);

    this.boardLayer.addChild(this.board.mesh);
    this.boardLayer.addChild(this.projectiles.view);
    this.layoutBoard();

    this.detachContextHandler = PixelTextureRenderer.attachContextLossHandler(
      this.app.renderer,
      () => this.board?.restore(world.palette),
    );

    world.onDestroy(() => {
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
    if (this.projectiles) {
      this.boardLayer.removeChild(this.projectiles.view);
      this.projectiles.destroy();
      this.projectiles = null;
    }
    this.world?.onDestroy(null);
    this.combat = null;
  }

  /**
   * Fits the 1024² board inside the viewport, preserving the aspect ratio and
   * keeping clear of the HUD panel on wide screens.
   */
  layoutBoard(): void {
    const { width, height } = this.app.renderer;
    const margin = 24;
    const hudWidth = width >= 900 ? HUD_WIDTH : 0;

    const available = Math.max(1, width - hudWidth - margin * 2);
    const scale = Math.min(available / WORLD_WIDTH, (height - margin * 2) / WORLD_HEIGHT);

    this.boardLayer.scale.set(scale);
    this.boardLayer.position.set(
      (available - WORLD_WIDTH * scale) / 2 + margin,
      (height - WORLD_HEIGHT * scale) / 2,
    );
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

    this.projectiles?.syncProjectiles(this.combat.pool);
    this.projectiles?.spawnImpacts(this.combat.visibleImpacts);
    this.projectiles?.update(deltaMs);

    if (this.world.isDirty()) {
      this.board.markDirty();
      this.world.clearDirty();
    }
    this.board.syncTexture(nowMs);

    const crossed = this.milestones.update(this.world.progress());
    for (const milestone of crossed) this.events.onMilestone?.(milestone);

    this.profiler.recordFrame(deltaMs, simMs);
    this.profiler.recordCounters(nowMs, stats.logicalImpacts, stats.visualImpacts, stats.destroyed);

    if (this.saveDirty && nowMs - this.lastAutosaveMs > AUTOSAVE_INTERVAL_MS) {
      this.lastAutosaveMs = nowMs;
      void this.save();
    }
  };

  upgradeCard(cardId: string): ColorCard | null {
    const card = this.deck?.upgrade(cardId) ?? null;
    if (card) this.saveDirty = true;
    return card;
  }

  // --- Persistence & offline ---------------------------------------------

  private installLifecycleHooks(): void {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      // `visibilitychange` to hidden is the last reliably observable moment of
      // a session; `beforeunload` is not dependable, especially on mobile.
      if (document.visibilityState === "hidden") void this.save();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.layoutBoard());
    }
  }

  async save(): Promise<void> {
    const world = this.world;
    const deck = this.deck;
    if (!world || !deck) return;

    this.lastSimulatedAtEpochMs = Date.now();
    const save: LevelSaveV1 = {
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
      deck: deck.serialize(),
      cannon: this.cannon.serialize(),
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
    let saved: LevelSaveV1 | null = null;
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

    const world = new PixelWorld(
      {
        baseColorId: new Uint8Array(saved.baseColorId),
        colorId: new Uint8Array(saved.colorId),
        hp: new Uint8Array(saved.hp),
        flags: new Uint8Array(saved.flags),
      },
      saved.palette,
    );
    const deck = new DeckRuntime(saved.deck);

    const elapsedMs = Math.max(0, Date.now() - saved.lastSimulatedAtEpochMs);
    if (elapsedMs > 1000) {
      // The board buffers are transferred to the worker, so `world` must not be
      // touched again until the reply lands with the buffers it hands back.
      const report = await this.runOfflineCatchUp(
        world,
        deck,
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
        this.startLevel(caughtUp, deck, new Cannon(saved.cannon));
        this.events.onOfflineReport?.(report.report);
        this.saveDirty = true;
        await this.save();
        return true;
      }
    }

    this.startLevel(world, deck, new Cannon(saved.cannon));
    return true;
  }

  private async runOfflineCatchUp(
    world: PixelWorld,
    deck: DeckRuntime,
    colorId: Uint8Array,
    hp: Uint8Array,
    elapsedMs: number,
  ): Promise<{ colorId: Uint8Array; hp: Uint8Array; report: OfflineReport } | null> {
    const dps = Array.from(deck.damagePerSecondByColor(world));
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
