import type { GameController } from "../app/GameController";
import type { Milestone } from "../app/milestones";
import { PERIMETER } from "../combat/Cannon";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import { UpgradePanel } from "./UpgradePanel";
import { cssColor, formatCompact, formatCount, formatPercent, inkOn } from "./format";

/** Colour blocks shown under the progress bar. The full table lives in debug. */
const STAT_BLOCKS = 4;

/**
 * Screen 02 — the game.
 *
 * Everything here is DOM over the Pixi canvas: the board itself stays one R8
 * texture and a palette shader, and the barrels, balls and impacts stay in
 * Pixi. The DOM contributes the frame, the rail, the ammo tokens and the
 * panels around them.
 */
export class GameScreen {
  private readonly root = document.getElementById("screen-game") as HTMLElement;
  private readonly playArea = document.getElementById("play-area") as HTMLElement;
  private readonly railTokens = document.getElementById("rail-tokens") as HTMLElement;

  private readonly coinCount = document.getElementById("coin-count") as HTMLElement;
  private readonly levelLabel = document.getElementById("level-label") as HTMLElement;
  private readonly passLabel = document.getElementById("round-label") as HTMLElement;

  private readonly aliveCount = document.getElementById("alive-count") as HTMLElement;
  private readonly playableCount = document.getElementById("playable-count") as HTMLElement;
  private readonly progressFill = document.getElementById("progress-fill") as HTMLElement;
  private readonly progressPercent = document.getElementById("progress-percent") as HTMLElement;
  private readonly colorStats = document.getElementById("color-stats") as HTMLElement;

  private readonly slots = document.getElementById("slots") as HTMLElement;
  private readonly cards = document.getElementById("cards") as HTMLElement;
  private readonly toast = document.getElementById("toast") as HTMLElement;

  private readonly debugPanel = document.getElementById("debug-panel") as HTMLElement;
  private readonly perfList = document.getElementById("perf-list") as HTMLElement;
  private readonly colorTableBody = document.querySelector("#color-table tbody") as HTMLElement;

  readonly upgrades: UpgradePanel;

  private toastTimer = 0;
  private lastSampleMs = 0;
  private cardSignature = "";
  private lastArea = "";

  constructor(private readonly game: GameController) {
    this.upgrades = new UpgradePanel(game);

    window.addEventListener("keydown", (event) => {
      if (event.key === "d" && event.altKey) this.toggleDebug();
    });
  }

  show(): void {
    this.root.hidden = false;
    // Force the next poll to report the area: the layout has just changed.
    this.lastArea = "";
    this.renderCards();
  }

  hide(): void {
    this.root.hidden = true;
  }

  toggleDebug(): void {
    this.debugPanel.hidden = !this.debugPanel.hidden;
  }

  notify(message: string, kind: "info" | "error" = "info"): void {
    this.toast.textContent = message;
    this.toast.dataset.kind = kind;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, 6000);
  }

  announceMilestone(milestone: Milestone): void {
    this.notify(`${formatPercent(milestone.progress, 0)} — ${milestone.label}`);
  }

  setLevelLabel(label: string): void {
    this.levelLabel.textContent = label;
  }

  /** The pass counter replaces the placeholder "Manche 1" of the mockup. */
  private renderPass(): void {
    const label = `Passage ${this.game.pass}`;
    if (this.passLabel.textContent === label) return;
    this.passLabel.textContent = label;
  }

  /**
   * Reports the play area's size, but only when it changed since the last
   * call, so the renderer and camera are re-framed only then.
   *
   * It consumes that change: calling it twice in a row returns null the second
   * time. Callers must use the value, never call it for effect.
   */
  takeBoardSize(): { width: number; height: number } | null {
    if (this.root.hidden) return null;
    const rect = this.playArea.getBoundingClientRect();
    if (rect.width < 2) return null;

    const signature = `${rect.width}:${rect.height}`;
    if (signature === this.lastArea) return null;
    this.lastArea = signature;
    return { width: rect.width, height: rect.height };
  }

  /** Called every frame; touches the DOM a few times a second. */
  update(nowMs: number): void {
    const world = this.game.getWorld();
    if (!world) return;

    this.renderRailTokens();

    if (nowMs - this.lastSampleMs < 250) return;
    this.lastSampleMs = nowMs;

    const alive = world.aliveTotal();
    this.aliveCount.textContent = formatCount(alive);
    this.playableCount.textContent = formatCount(world.playablePixels);
    // The counter is the spendable balance, not the running total.
    this.coinCount.textContent = formatCount(this.game.getUpgrades().balance);

    const progress = world.progress();
    this.progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.progressPercent.textContent = formatPercent(progress);

    this.renderPass();
    this.renderColorStats();
    this.renderSlots();
    this.renderCards();
    this.upgrades.update();

    if (!this.debugPanel.hidden) this.renderDebug();
  }

  /**
   * Ammo tokens ride the rail at their cannon's real position, so a player can
   * see one coming round before it arrives.
   */
  private renderRailTokens(): void {
    const combat = this.game.getCombat();
    const world = this.game.getWorld();
    if (!combat || !world) return;

    const cannons = combat.activeCannons;
    while (this.railTokens.childElementCount < cannons.length) {
      const token = document.createElement("div");
      token.className = "rail-token";
      this.railTokens.appendChild(token);
    }
    while (this.railTokens.childElementCount > cannons.length) {
      this.railTokens.lastElementChild!.remove();
    }

    const rect = this.railTokens.getBoundingClientRect();
    for (let i = 0; i < cannons.length; i++) {
      const cannon = cannons[i];
      const token = this.railTokens.children[i] as HTMLElement;
      const point = railPoint(cannon.trackPosition, rect.width, rect.height);
      token.style.left = `${point.x}px`;
      token.style.top = `${point.y}px`;
      token.textContent = `${cannon.ammo}/${cannon.maxAmmo}`;
      token.dataset.empty = String(cannon.ammo === 0);
    }
  }

  private renderColorStats(): void {
    const world = this.game.getWorld();
    const stats = this.game.getStats();
    if (!world || !stats) return;

    // The four colours that still matter most, richest first.
    const entries = stats
      .entries()
      .filter((entry) => entry.alive > 0)
      .sort((a, b) => b.alive - a.alive)
      .slice(0, STAT_BLOCKS);

    this.colorStats.replaceChildren();
    for (const entry of entries) {
      const palette = world.palette[entry.colorId];
      const block = document.createElement("div");
      block.innerHTML =
        `<div class="chip" style="background:${cssColor(palette.r, palette.g, palette.b)}"></div>` +
        `<span class="left">${formatCompact(entry.alive)}</span>`;
      this.colorStats.appendChild(block);
    }
  }

  private renderSlots(): void {
    const combat = this.game.getCombat();
    const world = this.game.getWorld();
    if (!combat || !world) return;

    // The rail upgrade adds slots, so the row is sized from capacity.
    const capacity = combat.maxActiveCannons;
    while (this.slots.childElementCount < capacity) {
      this.slots.appendChild(document.createElement("div"));
    }
    while (this.slots.childElementCount > capacity) {
      this.slots.lastElementChild!.remove();
    }

    const cannons = combat.activeCannons;
    for (let i = 0; i < this.slots.childElementCount; i++) {
      const slot = this.slots.children[i] as HTMLElement;
      const cannon = cannons[i];
      if (!cannon) {
        slot.dataset.filled = "false";
        slot.style.background = "";
        continue;
      }
      const palette = world.palette[cannon.colorId];
      slot.dataset.filled = "true";
      slot.style.background = cssColor(palette.r, palette.g, palette.b);
    }
  }

  /**
   * The colour cards. Rebuilt only when the offer actually changes — doing it
   * four times a second would tear a button out from under a tap.
   */
  renderCards(): void {
    const queue = this.game.getQueue();
    const world = this.game.getWorld();
    const combat = this.game.getCombat();
    if (!queue || !world) return;

    const canLaunch = combat?.hasFreeSlot ?? false;
    const signature = `${canLaunch}|${queue.visible.map((l) => `${l.id}:${l.ammo}`).join(",")}`;
    if (signature === this.cardSignature) return;
    this.cardSignature = signature;

    this.cards.replaceChildren();
    for (const load of queue.visible) {
      const palette = world.palette[load.colorId];
      const exhausted = world.aliveByColor(load.colorId) === 0;

      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !canLaunch || exhausted;
      button.dataset.exhausted = String(exhausted);
      button.title = `Lancer un canon #${load.colorId} chargé de ${load.ammo} billes`;
      button.innerHTML =
        `<span class="tile" style="background:${cssColor(palette.r, palette.g, palette.b)};` +
        `color:${inkOn(palette.r, palette.g, palette.b)}">${load.ammo}</span>` +
        `<span class="name">#${load.colorId}</span>`;
      button.addEventListener("click", () => {
        this.game.launch(load.id);
        this.renderCards();
      });
      this.cards.appendChild(button);
    }
  }

  private renderDebug(): void {
    const profiler = this.game.profiler;
    const combat = this.game.getCombat();
    const world = this.game.getWorld();
    const stats = this.game.getStats();
    const combatStats = combat?.getStats();
    if (!world || !stats) return;

    const entries: Array<[string, string]> = [
      ["FPS", profiler.fps.toFixed(0)],
      ["p95 frame", `${profiler.p95FrameMs.toFixed(1)} ms`],
      ["Simulation", `${profiler.meanSimMs.toFixed(2)} ms`],
      ["Canons", formatCount(combatStats?.activeCannons ?? 0)],
      ["Voies/frame", formatCount(combatStats?.lanesExamined ?? 0)],
      ["Rafales/frame", formatCount(combatStats?.bursts ?? 0)],
      ["Voies/s", formatCount(profiler.logicalImpactsPerSecond)],
      ["Blocs/s", formatCount(profiler.destroyedPerSecond)],
      ["Zoom", `×${this.game.viewport.scale.toFixed(1)}`],
    ];

    this.perfList.replaceChildren();
    for (const [label, value] of entries) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      this.perfList.append(dt, dd);
    }

    const bottlenecks = new Set(stats.bottlenecks().map((b) => b.colorId));
    const wasted = new Set(stats.wasted().map((b) => b.colorId));

    this.colorTableBody.replaceChildren();
    for (const entry of stats.entries()) {
      const palette = world.palette[entry.colorId];
      const row = document.createElement("tr");
      row.dataset.flag = bottlenecks.has(entry.colorId)
        ? "bottleneck"
        : wasted.has(entry.colorId)
          ? "waste"
          : "";
      row.innerHTML =
        `<td><span class="swatch" style="background:${cssColor(palette.r, palette.g, palette.b)}"></span>#${entry.colorId}</td>` +
        `<td>${formatCount(entry.alive)}</td>` +
        `<td class="share">${formatPercent(entry.shareOfRemaining)}</td>` +
        `<td class="dps">${formatPercent(entry.outputShare)}</td>` +
        `<td>${formatCount(entry.rate)}</td>`;
      this.colorTableBody.appendChild(row);
    }
  }
}

/**
 * Maps a position along the cannon rail to a point on the DOM ring.
 *
 * The rail runs clockwise from the top-left corner: top edge, right edge,
 * bottom edge, left edge — the same order `aimAt` uses, so a token always sits
 * where its barrel is.
 */
export function railPoint(
  trackPosition: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const p = ((trackPosition % PERIMETER) + PERIMETER) % PERIMETER;

  if (p < WORLD_WIDTH) {
    return { x: (p / WORLD_WIDTH) * width, y: 0 };
  }
  if (p < WORLD_WIDTH + WORLD_HEIGHT) {
    return { x: width, y: ((p - WORLD_WIDTH) / WORLD_HEIGHT) * height };
  }
  if (p < 2 * WORLD_WIDTH + WORLD_HEIGHT) {
    const along = (p - WORLD_WIDTH - WORLD_HEIGHT) / WORLD_WIDTH;
    return { x: width - along * width, y: height };
  }
  const along = (p - 2 * WORLD_WIDTH - WORLD_HEIGHT) / WORLD_HEIGHT;
  return { x: 0, y: height - along * height };
}
