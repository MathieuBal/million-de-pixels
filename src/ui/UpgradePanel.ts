import type { GameController } from "../app/GameController";
import { UPGRADES, type UpgradeDefinition } from "../progression/Upgrades";
import { formatCount } from "./format";

/** Axes shown as shortcuts in the bottom row. The panel holds all six. */
const BOOSTER_ROW: Array<UpgradeDefinition["id"]> = [
  "cadence",
  "vitesse",
  "explosion",
  "canons",
];

/**
 * Where a player turns destruction into speed.
 *
 * Fragments are destroyed pixels, so the image funds its own destruction and
 * every purchase is paid for by the progress it accelerates. The bottom row is
 * a shortcut onto the four cannon axes; the panel behind it carries all six,
 * including the two that widen the queue.
 */
export class UpgradePanel {
  private readonly boosters = document.getElementById("boosters") as HTMLElement;
  private readonly panel = document.getElementById("upgrade-panel") as HTMLElement;
  private readonly rows = document.getElementById("upgrade-rows") as HTMLElement;
  private readonly balance = document.getElementById("upgrade-balance") as HTMLElement;
  private readonly scrim = this.panel.querySelector(".upgrade-scrim") as HTMLElement;
  private readonly close = document.getElementById("upgrade-close") as HTMLButtonElement;

  private boosterSignature = "";

  constructor(private readonly game: GameController) {
    for (const id of BOOSTER_ROW) {
      const definition = UPGRADES.find((u) => u.id === id)!;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "booster";
      button.dataset.id = id;
      button.innerHTML =
        `<span class="glyph">${definition.glyph}</span>` +
        `<span class="label">${definition.label}</span>` +
        `<span class="level"></span>`;
      button.addEventListener("click", () => this.open());
      this.boosters.appendChild(button);
    }

    this.close.addEventListener("click", () => this.hide());
    this.scrim.addEventListener("click", () => this.hide());
  }

  open(): void {
    this.panel.hidden = false;
    this.renderPanel();
  }

  hide(): void {
    this.panel.hidden = true;
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Called on the HUD's sampling tick. */
  update(): void {
    this.renderBoosters();
    if (this.isOpen) this.renderPanel();
  }

  /**
   * The row only shows the level and whether the next one is within reach —
   * the price lives in the panel, where there is room to read it.
   */
  private renderBoosters(): void {
    const upgrades = this.game.getUpgrades();

    const signature = BOOSTER_ROW.map(
      (id) => `${upgrades.levelOf(id)}:${upgrades.canAfford(id)}`,
    ).join("|");
    if (signature === this.boosterSignature) return;
    this.boosterSignature = signature;

    for (const button of Array.from(this.boosters.children) as HTMLElement[]) {
      const id = button.dataset.id as UpgradeDefinition["id"];
      const level = upgrades.levelOf(id);
      button.dataset.affordable = String(upgrades.canAfford(id));
      (button.querySelector(".level") as HTMLElement).textContent = upgrades.isMaxed(id)
        ? "max"
        : `niv. ${level}`;
    }
  }

  private renderPanel(): void {
    const upgrades = this.game.getUpgrades();
    this.balance.textContent = formatCount(upgrades.balance);

    this.rows.replaceChildren();
    for (const definition of UPGRADES) {
      const level = upgrades.levelOf(definition.id);
      const price = upgrades.priceOf(definition.id);
      const maxed = price === null;

      const row = document.createElement("div");
      row.className = "upgrade-row";

      const current = definition.format(definition.valueAt(level));
      const next = maxed ? "" : ` → ${definition.format(definition.valueAt(level + 1))}`;

      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = definition.glyph;

      const text = document.createElement("span");
      text.className = "text";
      text.innerHTML =
        `<span class="name">${definition.label} · niv. ${level}</span>` +
        `<span class="meta">${current}${next}</span>`;

      const button = document.createElement("button");
      button.className = "price";
      button.type = "button";
      button.disabled = maxed || !upgrades.canAfford(definition.id);
      button.textContent = maxed ? "max" : formatCount(price);
      button.title = maxed ? "Niveau maximum atteint" : definition.description;
      button.addEventListener("click", () => {
        if (this.game.buyUpgrade(definition.id)) this.renderPanel();
      });

      row.append(chip, text, button);
      this.rows.appendChild(row);
    }
  }
}
