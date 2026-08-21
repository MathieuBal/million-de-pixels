import type { GameController } from "../app/GameController";
import { cssColor, formatCompact, formatPercent, inkOn } from "./format";

/**
 * The whole palette of the toile, and which of it can still be hit.
 *
 * The four blocks under the progress bar only ever showed the biggest colours,
 * so a palette of sixteen hid most of itself, and nothing anywhere said which
 * colours were *reachable*. That distinction is the one the game turns on: a
 * colour can be alive and buried behind another from every side, and until the
 * facade falls, sending a cannon at it is a wasted slot. A player without this
 * sees a count that refuses to move and no reason why.
 *
 * Unlocked with éclats, because it is a reading aid for someone who has already
 * played a toile through and met the problem it explains.
 */
export class PaletteBoard {
  private readonly panel = document.getElementById("palette-board") as HTMLElement;
  private readonly grid = document.getElementById("palette-grid") as HTMLElement;
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

    this.grid.replaceChildren();
    for (const entry of world.palette) {
      const alive = world.aliveByColor(entry.id);
      const cell = document.createElement("div");
      cell.className = "palette-cell";
      cell.dataset.state = alive === 0 ? "gone" : reachable[entry.id] ? "open" : "buried";
      cell.innerHTML =
        `<span class="swatch" style="background:${cssColor(entry.r, entry.g, entry.b)};` +
        `color:${inkOn(entry.r, entry.g, entry.b)}">#${entry.id}</span>` +
        `<span class="count">${formatCompact(alive)}</span>` +
        `<span class="tag">${
          alive === 0 ? "épuisée" : reachable[entry.id] ? "à portée" : "enterrée"
        } · ${formatPercent(entry.share, 1)}</span>`;
      this.grid.appendChild(cell);
    }
  }
}
