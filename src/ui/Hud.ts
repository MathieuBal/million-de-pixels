import type { GameController } from "../app/GameController";
import { MAX_ACTIVE_CANNONS } from "../combat/CombatSimulator";
import type { Milestone } from "../app/milestones";
import { cssColor, formatCount, formatDuration, formatPercent } from "./format";

/**
 * Minimal DOM HUD.
 *
 * The colour table is the actual decision surface of the game: it is where a
 * player sees that their deck is still pouring DPS into a colour that has
 * almost run out.
 */
export class Hud {
  private readonly root = document.getElementById("hud") as HTMLElement;
  private readonly aliveCount = document.getElementById("alive-count") as HTMLElement;
  private readonly playableCount = document.getElementById("playable-count") as HTMLElement;
  private readonly progressFill = document.getElementById("progress-fill") as HTMLElement;
  private readonly progressPercent = document.getElementById("progress-percent") as HTMLElement;
  private readonly colorBody = document.querySelector("#color-table tbody") as HTMLElement;
  private readonly queueList = document.getElementById("queue-list") as HTMLElement;
  private readonly cannonList = document.getElementById("cannon-list") as HTMLElement;
  private readonly railCount = document.getElementById("rail-count") as HTMLElement;
  private readonly perfList = document.getElementById("perf-list") as HTMLElement;
  private readonly toast = document.getElementById("toast") as HTMLElement;

  private toastTimer = 0;
  private lastSampleMs = 0;

  constructor(private readonly game: GameController) {}

  show(): void {
    this.root.hidden = false;
    this.renderQueue();
  }

  hide(): void {
    this.root.hidden = true;
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

  announceOffline(elapsedMs: number, destroyed: number): void {
    this.notify(
      `Absence de ${formatDuration(elapsedMs)} : ${formatCount(destroyed)} pixels détruits pendant votre absence.`,
    );
  }

  /** Called every animation frame; only touches the DOM a few times a second. */
  update(nowMs: number): void {
    const world = this.game.getWorld();
    if (!world) return;
    if (nowMs - this.lastSampleMs < 250) return;

    this.lastSampleMs = nowMs;

    const alive = world.aliveTotal();
    this.aliveCount.textContent = formatCount(alive);
    this.playableCount.textContent = formatCount(world.playablePixels);

    const progress = world.progress();
    this.progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.progressPercent.textContent = formatPercent(progress);

    this.renderColors(world.paletteSize);
    this.renderCannons();
    this.renderQueue();
    this.renderPerf();
  }

  private renderColors(paletteSize: number): void {
    const world = this.game.getWorld();
    const stats = this.game.getStats();
    if (!world || !stats) return;

    if (this.colorBody.childElementCount !== paletteSize) {
      this.colorBody.replaceChildren();
      for (let colour = 0; colour < paletteSize; colour++) {
        const entry = world.palette[colour];
        const row = document.createElement("tr");
        // Rarity is only spelled out when it is worth noticing — a column of
        // "COMMUNE" repeated eight times is noise, not information.
        const rarity =
          entry.rarity === "commune"
            ? ""
            : ` <span class="rarity r-${entry.rarity}">${entry.rarity}</span>`;
        row.innerHTML =
          `<td><span class="swatch" style="background:${cssColor(entry.r, entry.g, entry.b)}"></span>` +
          `#${colour}${rarity}</td>` +
          `<td class="alive"></td><td class="share"></td><td class="dps"></td><td class="rate"></td>`;
        this.colorBody.appendChild(row);
      }
    }

    const rows = this.colorBody.children;
    // A colour holding this much more of the board than of the deck's output
    // is what the run is waiting on.
    const bottlenecks = new Set(stats.bottlenecks().map((b) => b.colorId));
    const wasted = new Set(stats.wasted().map((b) => b.colorId));

    for (let colour = 0; colour < paletteSize; colour++) {
      const entry = stats.entryOf(colour);
      const row = rows[colour] as HTMLElement;

      row.dataset.exhausted = String(entry.exhausted);
      row.dataset.flag = bottlenecks.has(colour)
        ? "bottleneck"
        : wasted.has(colour)
          ? "waste"
          : "";

      (row.querySelector(".alive") as HTMLElement).textContent = formatCount(entry.alive);
      (row.querySelector(".share") as HTMLElement).textContent = formatPercent(
        entry.shareOfRemaining,
      );
      (row.querySelector(".dps") as HTMLElement).textContent = formatPercent(entry.dpsShare);
      (row.querySelector(".rate") as HTMLElement).textContent = formatCount(entry.rate);
    }
  }

  /**
   * The queue is the only decision the player makes: which colour to send in
   * now. Slots show the colour and the stock, and grey out when the rail is
   * full rather than disappearing — the choice is still worth reading.
   */
  renderQueue(): void {
    const queue = this.game.getQueue();
    const world = this.game.getWorld();
    const combat = this.game.getCombat();
    if (!queue || !world) return;

    this.queueList.replaceChildren();

    for (const load of queue.visible) {
      const entry = world.palette[load.colorId];
      const li = document.createElement("li");
      li.className = "load";
      li.dataset.disabled = String(!(combat?.hasFreeSlot ?? false));

      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !(combat?.hasFreeSlot ?? false);
      button.innerHTML =
        `<span class="swatch" style="background:${cssColor(entry.r, entry.g, entry.b)}"></span>` +
        `<span class="ammo">${load.ammo}</span>`;
      button.title = `Lancer un canon #${load.colorId} chargé de ${load.ammo} billes`;
      button.addEventListener("click", () => {
        if (this.game.launch(load.id)) this.renderQueue();
      });

      li.appendChild(button);
      this.queueList.appendChild(li);
    }

    if (queue.visible.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Plus aucune couleur à charger.";
      this.queueList.appendChild(li);
    }
  }

  /** Cannons currently on the rail, with what is left of their stock. */
  private renderCannons(): void {
    const combat = this.game.getCombat();
    const world = this.game.getWorld();
    if (!combat || !world) return;

    const cannons = combat.activeCannons;
    this.cannonList.replaceChildren();

    for (const cannon of cannons) {
      const entry = world.palette[cannon.colorId];
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="swatch" style="background:${cssColor(entry.r, entry.g, entry.b)}"></span>` +
        `<span class="ammo">${cannon.ammo}<small>/${cannon.maxAmmo}</small></span>` +
        `<span class="bar"><i style="width:${(cannon.ammo / cannon.maxAmmo) * 100}%;` +
        `background:${cssColor(entry.r, entry.g, entry.b)}"></i></span>`;
      this.cannonList.appendChild(li);
    }

    this.railCount.textContent = `${cannons.length} / ${MAX_ACTIVE_CANNONS}`;
  }

  private renderPerf(): void {
    const profiler = this.game.profiler;
    const combat = this.game.getCombat();
    const stats = combat?.getStats();

    const entries: Array<[string, string]> = [
      ["FPS", profiler.fps.toFixed(0)],
      ["p95 frame", `${profiler.p95FrameMs.toFixed(1)} ms`],
      ["Simulation", `${profiler.meanSimMs.toFixed(2)} ms`],
      ["Canons sur le rail", formatCount(stats?.activeCannons ?? 0)],
      ["Billes en vol", formatCount(stats?.activeProjectiles ?? 0)],
      ["Tirs/s", formatCount(profiler.logicalImpactsPerSecond)],
      ["Blocs détruits/s", formatCount(profiler.destroyedPerSecond)],
      ["Tirs perdus", formatCount(stats?.misses ?? 0)],
    ];

    this.perfList.replaceChildren();
    for (const [label, value] of entries) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      this.perfList.append(dt, dd);
    }
  }
}
