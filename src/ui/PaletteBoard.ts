import type { GameController } from "../app/GameController";
import { RARITY_GLYPHS } from "../core/constants";
import { cssColor, formatCompact, formatPercent, inkOn } from "./format";

/**
 * The whole palette of the toile, and which of it can still be hit.
 *
 * The four blocks under the progress bar only ever showed the biggest colours,
 * so a palette of sixteen hid most of itself, and nothing anywhere said which
 * colours were *reachable*. That distinction is the one the game turns on: a
 * colour can be alive and buried behind another from every side, and until the
 * facade falls, sending a cannon at it is a wasted slot.
 *
 * Three states, and **the border says them before the text does**. "Enterrée"
 * is deliberately the loudest of the three: it is the state that explains why a
 * counter will not move, and the one that makes Perce worth buying.
 *
 * Below the grid, the bottlenecks: what each colour is as a share of what is
 * left (top bar) against its share of the destruction actually happening
 * (bottom bar). `ColorStats` already computes and sorts both.
 */
export class PaletteBoard {
  private readonly panel = document.getElementById("palette-board") as HTMLElement;
  private readonly grid = document.getElementById("palette-grid") as HTMLElement;
  private readonly gaps = document.getElementById("palette-gaps") as HTMLElement;
  private readonly toggle = document.getElementById("palette-toggle") as HTMLButtonElement;

  private open = false;
  private signature = "";

  constructor(private readonly game: GameController) {
    this.toggle.addEventListener("click", () => {
      this.open = !this.open;
      this.render(true);
    });
  }

  render(force = false): void {
    const world = this.game.getWorld();
    const unlocked = this.game.canSeePalette;

    this.toggle.hidden = !unlocked;
    this.panel.hidden = !unlocked || !this.open;
    if (!world || this.panel.hidden) return;

    this.toggle.dataset.on = String(this.open);

    const reachable = world.reachableColors();
    const signature = world.palette
      .map((_entry, id) => `${world.aliveByColor(id)}:${reachable[id] ? 1 : 0}`)
      .join(",");
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.renderGrid(reachable);
    this.renderGaps();
  }

  private renderGrid(reachable: readonly boolean[]): void {
    const world = this.game.getWorld();
    if (!world) return;

    this.grid.replaceChildren();
    for (const entry of world.palette) {
      const alive = world.aliveByColor(entry.id);
      const state = alive === 0 ? "gone" : reachable[entry.id] ? "open" : "buried";
      const label = alive === 0 ? "épuisée" : reachable[entry.id] ? "à portée" : "enterrée";

      const cell = document.createElement("div");
      cell.className = "palette-cell";
      cell.dataset.state = state;
      cell.title = `#${entry.id} — ${label}, ${formatPercent(entry.share, 1)} de l'image`;
      cell.innerHTML =
        `<span class="swatch" style="background:${cssColor(entry.r, entry.g, entry.b)};` +
        `color:${inkOn(entry.r, entry.g, entry.b)}">` +
        `<b>#${entry.id}</b><i>${RARITY_GLYPHS[entry.rarity]}</i></span>` +
        `<span class="count">${formatCompact(alive)}</span>` +
        `<span class="tag">${label} · ${formatPercent(entry.share, 1)}</span>`;
      this.grid.appendChild(cell);
    }
  }

  /**
   * What the run is waiting on.
   *
   * Two bars per colour rather than a number: how much of what is left it is,
   * and how much of the destruction is landing on it. The gap between them is
   * the whole reading, and `ColorStats` only reports it past the same threshold
   * it uses everywhere else.
   */
  private renderGaps(): void {
    const stats = this.game.getStats();
    const world = this.game.getWorld();
    if (!stats || !world) return;

    const starved = stats.bottlenecks();
    const wasted = stats.wasted();
    this.gaps.replaceChildren();
    this.gaps.hidden = starved.length === 0 && wasted.length === 0;
    if (this.gaps.hidden) return;

    const rows = [
      ...starved.slice(0, 3).map((gap) => ({ ...gap, starved: true })),
      ...wasted.slice(0, 2).map((gap) => ({ ...gap, starved: false })),
    ];

    for (const gap of rows) {
      const entry = stats.entryOf(gap.colorId);
      const palette = world.palette[gap.colorId];

      const row = document.createElement("div");
      row.className = "gap-row";
      row.dataset.starved = String(gap.starved);
      row.innerHTML =
        `<span class="chip" style="background:${cssColor(palette.r, palette.g, palette.b)}"></span>` +
        `<span class="bars">` +
        `<i class="need" style="width:${(entry.shareOfRemaining * 100).toFixed(0)}%"></i>` +
        `<i class="out" style="width:${(entry.outputShare * 100).toFixed(0)}%"></i>` +
        `</span>` +
        `<span class="gap">${gap.starved ? "+" : "−"}${Math.round(gap.gap * 100)} pts</span>`;
      row.title =
        `#${gap.colorId} — ${formatPercent(entry.shareOfRemaining, 0)} du reste, ` +
        `${formatPercent(entry.outputShare, 0)} des tirs`;
      this.gaps.appendChild(row);
    }
  }
}
