import type { GameController } from "../app/GameController";
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  UPGRADES,
  type UpgradeDefinition,
} from "../progression/Upgrades";
import { META_UPGRADES, type MetaUpgradeId } from "../progression/MetaProgression";
import { formatCount } from "./format";

/** Axes shown as shortcuts in the bottom row — all four of them. */
const BOOSTER_ROW: Array<UpgradeDefinition["id"]> = [
  "vitesse",
  "canons",
  "munitions",
  "cases",
];

/**
 * Where a player turns destruction into speed.
 *
 * Fragments are destroyed pixels, so the image funds its own destruction and
 * every purchase is paid for by the progress it accelerates. The bottom row is
 * a shortcut onto the four axes the panel carries: how fast the rail turns,
 * how many cannons ride it, how much each one carries, and how wide the queue
 * of offers is.
 */
export class UpgradePanel {
  private readonly boosters = document.getElementById("boosters") as HTMLElement;
  private readonly panel = document.getElementById("upgrade-panel") as HTMLElement;
  private readonly rows = document.getElementById("upgrade-rows") as HTMLElement;
  private readonly balance = document.getElementById("upgrade-balance") as HTMLElement;
  private readonly scrim = this.panel.querySelector(".upgrade-scrim") as HTMLElement;
  private readonly close = document.getElementById("upgrade-close") as HTMLButtonElement;

  private readonly shardBalance = document.getElementById("upgrade-shards") as HTMLElement;
  private readonly tabs = document.getElementById("upgrade-tabs") as HTMLElement;

  private boosterSignature = "";
  private tab: "level" | "permanent" = "level";

  constructor(private readonly game: GameController) {
    for (const [id, label] of [
      ["level", "Cette image"],
      ["permanent", "Permanent"],
    ] as const) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "upgrade-tab";
      tab.dataset.tab = id;
      tab.textContent = label;
      tab.addEventListener("click", () => {
        this.tab = id;
        this.renderPanel();
        this.syncTabs();
      });
      this.tabs.appendChild(tab);
    }
    this.syncTabs();

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

  private syncTabs(): void {
    for (const tab of Array.from(this.tabs.children) as HTMLElement[]) {
      tab.dataset.active = String(tab.dataset.tab === this.tab);
    }
  }

  open(tab: "level" | "permanent" = this.tab): void {
    this.tab = tab;
    this.syncTabs();
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
    this.shardBalance.textContent = formatCount(this.game.getMeta().balance);

    this.rows.replaceChildren();
    if (this.tab === "permanent") {
      this.renderPermanent();
      return;
    }

    for (const family of FAMILY_ORDER) {
      const inFamily = UPGRADES.filter((u) => u.family === family);
      if (inFamily.length === 0) continue;

      const heading = document.createElement("div");
      heading.className = "upgrade-family";
      heading.textContent = FAMILY_LABELS[family];
      this.rows.appendChild(heading);

      for (const definition of inFamily) this.rows.appendChild(this.levelRow(definition));
    }
  }

  /** One buyable line. Same shape for both tabs, different currency. */
  private levelRow(definition: UpgradeDefinition): HTMLElement {
    {
      const upgrades = this.game.getUpgrades();
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
      return row;
    }
  }

  /**
   * Éclats, and what they buy.
   *
   * Kept in the same panel behind a tab rather than in a screen of its own: it
   * is the same decision — spend now or save — only in the currency that
   * survives the image, and a player comparing the two should not have to
   * navigate between them.
   */
  private renderPermanent(): void {
    const meta = this.game.getMeta();

    const heading = document.createElement("div");
    heading.className = "upgrade-family";
    heading.textContent = `Éclats · ${formatCount(meta.balance)} disponibles · ${meta.totalClears} toile(s) terminée(s)`;
    this.rows.appendChild(heading);

    for (const definition of META_UPGRADES) {
      const level = meta.levelOf(definition.id);
      const price = meta.priceOf(definition.id);
      const maxed = price === null;

      const row = document.createElement("div");
      row.className = "upgrade-row";

      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = definition.glyph;

      const unlock = definition.maxLevel === 1;
      const current = definition.format(definition.valueAt(level));
      const next = maxed || unlock ? "" : ` → ${definition.format(definition.valueAt(level + 1))}`;

      const text = document.createElement("span");
      text.className = "text";
      text.innerHTML =
        `<span class="name">${definition.label}${unlock ? "" : ` · niv. ${level}`}</span>` +
        `<span class="meta">${definition.description} — ${current}${next}</span>`;

      const button = document.createElement("button");
      button.className = "price";
      button.type = "button";
      button.disabled = maxed || !meta.canAfford(definition.id);
      button.textContent = maxed ? (unlock ? "acquis" : "max") : `${formatCount(price)} ◆`;
      button.title = definition.description;
      button.addEventListener("click", () => {
        if (this.game.buyMetaUpgrade(definition.id as MetaUpgradeId)) this.renderPanel();
      });

      row.append(chip, text, button);
      this.rows.appendChild(row);
    }
  }
}
