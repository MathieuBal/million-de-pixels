import type { GameController } from "../app/GameController";
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  UPGRADES,
  type UpgradeDefinition,
} from "../progression/Upgrades";
import {
  BRANCH_LABELS,
  BRANCH_ORDER,
  META_UPGRADES,
  type MetaUpgradeDefinition,
  type MetaUpgradeId,
} from "../progression/MetaProgression";
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

  private readonly batchRow = document.getElementById("upgrade-batch") as HTMLElement;

  private boosterSignature = "";
  private tab: "level" | "permanent" = "level";
  /** How many levels a click buys. `max` is "as many as the balance allows". */
  private batch: 1 | 10 | "max" = 1;

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

    for (const size of [1, 10, "max"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "batch-button";
      button.dataset.size = String(size);
      button.textContent = size === "max" ? "max" : `×${size}`;
      button.addEventListener("click", () => {
        this.batch = size;
        this.syncBatch();
        this.renderPanel();
      });
      this.batchRow.appendChild(button);
    }
    this.syncBatch();

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

  private syncBatch(): void {
    for (const button of Array.from(this.batchRow.children) as HTMLElement[]) {
      button.dataset.active = String(button.dataset.size === String(this.batch));
    }
  }

  /** How many levels the current batch would buy of `id`, and for how much. */
  private quote(
    id: UpgradeDefinition["id"],
  ): { levels: number; price: number } {
    const upgrades = this.game.getUpgrades();
    return this.batch === "max"
      ? upgrades.costOf(id, Number.MAX_SAFE_INTEGER)
      : upgrades.costOf(id, this.batch);
  }

  private syncTabs(): void {
    for (const tab of Array.from(this.tabs.children) as HTMLElement[]) {
      tab.dataset.active = String(tab.dataset.tab === this.tab);
    }
  }

  open(tab: "level" | "permanent" = this.tab): void {
    this.tab = tab;
    this.syncTabs();
    this.syncBatch();
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
        `<span class="meta">${current}${next}</span>` +
        `<span class="what">${definition.description}</span>`;

      const quote = maxed ? { levels: 0, price: 0 } : this.quote(definition.id);
      const batched = quote.levels > 1;

      const button = document.createElement("button");
      button.className = "price";
      button.type = "button";
      button.disabled = maxed || quote.levels === 0;
      button.innerHTML = maxed
        ? "max"
        : quote.levels === 0
          ? formatCount(price)
          : `${formatCount(quote.price)}${batched ? `<small>×${quote.levels}</small>` : ""}`;
      button.title = maxed ? "Niveau maximum atteint" : definition.description;
      button.addEventListener("click", () => {
        if (this.game.buyUpgrade(definition.id, Math.max(1, quote.levels))) this.renderPanel();
      });

      row.append(chip, text, button);
      return row;
    }
  }

  /**
   * The talent tree.
   *
   * Kept in the same panel behind a tab rather than in a screen of its own: it
   * is the same decision — spend now or save — only in the currency that
   * survives the image, and a player weighing the two should not have to
   * navigate between them.
   *
   * A branch appears only once its capability is bought. Showing twenty-five
   * greyed rows on a first clear would say "here is everything you do not
   * have"; showing the locked capability alone says "here is the next thing to
   * want", which is the same information and a better invitation.
   */
  private renderPermanent(): void {
    const meta = this.game.getMeta();

    const heading = document.createElement("div");
    heading.className = "upgrade-family";
    heading.textContent =
      `${formatCount(meta.balance)} éclats · ${meta.totalClears} toile(s) terminée(s)`;
    this.rows.appendChild(heading);

    for (const branch of BRANCH_ORDER) {
      const nodes = META_UPGRADES.filter(
        (node) => node.branch === branch && meta.isAvailable(node.id),
      );
      if (nodes.length === 0) continue;

      if (branch !== "racine") {
        const title = document.createElement("div");
        title.className = "upgrade-family";
        title.textContent = BRANCH_LABELS[branch];
        this.rows.appendChild(title);
      }

      for (const node of nodes) this.rows.appendChild(this.metaRow(node));
    }
  }

  private metaRow(definition: MetaUpgradeDefinition): HTMLElement {
    const meta = this.game.getMeta();
    const points = meta.levelOf(definition.id);
    const price = meta.priceOf(definition.id);
    const maxed = price === null;
    const unlock = definition.kind === "unlock";
    const owned = unlock && points > 0;

    const row = document.createElement("div");
    row.className = "upgrade-row";
    row.dataset.kind = definition.kind;

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = definition.glyph;

    const current = definition.format(definition.valueAt(points));
    const step = unlock ? 0 : this.batch === "max" ? meta.affordableLevels(definition.id) : this.batch;
    const quote = unlock
      ? { levels: 0, price: 0 }
      : meta.costOf(definition.id, Math.max(1, step));
    const next =
      maxed || unlock || quote.levels === 0
        ? ""
        : ` → ${definition.format(definition.valueAt(points + quote.levels))}`;

    const text = document.createElement("span");
    text.className = "text";
    text.innerHTML =
      `<span class="name">${definition.label}${unlock ? "" : ` · ${points} pt`}</span>` +
      `<span class="meta">${unlock ? "" : `${current}${next}`}</span>` +
      `<span class="what">${definition.description}</span>`;

    const batched = quote.levels > 1;
    const button = document.createElement("button");
    button.className = "price";
    button.type = "button";
    button.disabled = maxed || (!unlock && quote.levels === 0) || (unlock && !meta.canAfford(definition.id));
    button.innerHTML = owned
      ? "acquis"
      : maxed
        ? "max"
        : unlock || quote.levels === 0
          ? `${formatCount(price)} ◆`
          : `${formatCount(quote.price)} ◆${batched ? `<small>×${quote.levels}</small>` : ""}`;
    button.title = definition.description;
    button.addEventListener("click", () => {
      const id = definition.id as MetaUpgradeId;
      if (this.game.buyMetaUpgrade(id, unlock ? 1 : Math.max(1, quote.levels))) this.renderPanel();
    });

    row.append(chip, text, button);
    return row;
  }
}
