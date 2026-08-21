import type { GameController } from "../app/GameController";
import { cssColor, inkOn } from "./format";

/**
 * The comfort row above the offers: filter by colour, and launch on your behalf.
 *
 * Both are earned rather than given. They only mean something to someone who has
 * already finished a toile and knows what is tedious about the next one —
 * hunting the bottleneck colour among eight random offers, and clicking the same
 * tile a few hundred times. Until Trieuse and Automate are bought the row does
 * not exist, so a first pass keeps its full shape.
 */
export class QueueTools {
  private readonly root = document.getElementById("queue-tools") as HTMLElement;
  private readonly filter = document.getElementById("color-filter") as HTMLElement;
  private readonly auto = document.getElementById("auto-launch") as HTMLButtonElement;

  private signature = "";

  constructor(private readonly game: GameController) {
    this.auto.addEventListener("click", () => {
      this.game.setAutoLaunch(!this.game.isAutoLaunching);
      this.render(true);
    });
  }

  /** Called on the HUD tick; touches the DOM only when the offer changed. */
  render(force = false): void {
    const world = this.game.getWorld();
    const bonus = this.game.permanentBonus();
    if (!world) return;

    this.root.hidden = !bonus.canFilterQueue && !bonus.canAutoLaunch && !bonus.canSeePalette;
    if (this.root.hidden) return;

    this.auto.hidden = !bonus.canAutoLaunch;
    this.auto.dataset.on = String(this.game.isAutoLaunching);

    if (!bonus.canFilterQueue) {
      this.filter.replaceChildren();
      return;
    }

    // Only the colours still standing are worth offering as a filter, and the
    // signature keeps the row from being rebuilt under a finger mid-click.
    const alive: number[] = [];
    for (let colour = 0; colour < world.paletteSize; colour++) {
      if (world.aliveByColor(colour) > 0) alive.push(colour);
    }

    const active = this.game.queueFilter;
    const signature = `${active}|${alive.join(",")}`;
    if (!force && signature === this.signature) return;
    this.signature = signature;

    this.filter.replaceChildren();
    this.filter.appendChild(this.chip(null, "Tout", active === null));
    for (const colour of alive) {
      const palette = world.palette[colour];
      const chip = this.chip(colour, "", active === colour);
      chip.style.background = cssColor(palette.r, palette.g, palette.b);
      chip.style.color = inkOn(palette.r, palette.g, palette.b);
      chip.textContent = String(world.aliveByColor(colour) > 0 ? colour : "");
      this.filter.appendChild(chip);
    }
  }

  private chip(colorId: number | null, label: string, on: boolean): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.dataset.on = String(on);
    chip.textContent = label;
    chip.addEventListener("click", () => {
      this.game.setQueueFilter(on ? null : colorId);
      this.render(true);
    });
    return chip;
  }
}
