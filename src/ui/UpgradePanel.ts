import type { GameController } from "../app/GameController";
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  UPGRADES,
  type UpgradeDefinition,
  type UpgradeFamily,
} from "../progression/Upgrades";
import {
  BRANCH_LABELS,
  BRANCH_ORDER,
  META_BY_ID,
  META_UPGRADES,
  type MetaBranch,
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
  private readonly subTabs = document.getElementById("upgrade-subtabs") as HTMLElement;

  private boosterSignature = "";
  private tab: "level" | "permanent" = "level";
  /** Which family of the shop, or which branch of the tree, is on screen. */
  private family: UpgradeFamily = "rail";
  private branch: MetaBranch = "racine";
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

  /**
   * The second row of tabs: the shop's three families, or the tree's branches.
   *
   * Both surfaces have more sections than fit on a phone at once, and both are
   * lists the player scans rather than compares — so the row is rebuilt to match
   * whichever surface is showing, and it carries that surface's accent.
   */
  private syncSubTabs(): void {
    const entries: Array<[string, string]> =
      this.tab === "level"
        ? FAMILY_ORDER.map((id) => [id, FAMILY_LABELS[id]])
        : BRANCH_ORDER.map((id) => [id, BRANCH_LABELS[id]]);

    const active = this.tab === "level" ? (this.family as string) : (this.branch as string);
    const signature = `${this.tab}|${entries.map(([id]) => id).join(",")}`;

    if (this.subTabs.dataset.signature !== signature) {
      this.subTabs.dataset.signature = signature;
      this.subTabs.replaceChildren();
      for (const [id, label] of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sub-tab";
        button.dataset.id = id;
        button.textContent = label;
        button.addEventListener("click", () => {
          if (this.tab === "level") this.family = id as UpgradeFamily;
          else this.branch = id as MetaBranch;
          this.renderPanel();
        });
        this.subTabs.appendChild(button);
      }
    }

    for (const button of Array.from(this.subTabs.children) as HTMLElement[]) {
      button.dataset.active = String(button.dataset.id === active);
    }
  }

  private syncTabs(): void {
    for (const tab of Array.from(this.tabs.children) as HTMLElement[]) {
      tab.dataset.active = String(tab.dataset.tab === this.tab);
    }
    // The whole sheet switches accent with the tab: amber is the currency of
    // acting during a run, blue is what happens between images.
    this.panel.dataset.tab = this.tab;
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
    this.syncSubTabs();

    if (this.tab === "permanent") {
      this.renderPermanent();
      return;
    }

    for (const definition of UPGRADES.filter((u) => u.family === this.family)) {
      this.rows.appendChild(this.levelRow(definition));
    }
  }

  /**
   * One axis of the in-game shop.
   *
   * The line says the value it has and the value the purchase would give —
   * never an abstract percentage — and the bar under it is how far along the
   * axis's own track the player is. A maxed axis stays in place, dimmed: it has
   * to remain readable, because "I already finished that one" is information.
   */
  private levelRow(definition: UpgradeDefinition): HTMLElement {
    const upgrades = this.game.getUpgrades();
    const level = upgrades.levelOf(definition.id);
    const price = upgrades.priceOf(definition.id);
    const maxed = price === null;

    const row = document.createElement("div");
    row.className = "upgrade-row";
    row.dataset.state = maxed ? "max" : upgrades.canAfford(definition.id) ? "buy" : "poor";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = definition.glyph;

    const quote = maxed ? { levels: 0, price: 0 } : this.quote(definition.id);
    const shown = Math.max(1, quote.levels);
    const current = definition.format(definition.valueAt(level));
    const next = maxed ? "" : ` → ${definition.format(definition.valueAt(level + shown))}`;

    const text = document.createElement("span");
    text.className = "text";
    text.innerHTML =
      `<span class="name">${definition.label} · niv. ${level}</span>` +
      `<span class="meta">${current}${next}</span>` +
      `<span class="what">${definition.description}</span>` +
      `<span class="track"><i style="width:${((level / definition.maxLevel) * 100).toFixed(1)}%"></i></span>`;

    const batched = quote.levels > 1;
    const button = document.createElement("button");
    button.className = "price";
    button.type = "button";
    button.disabled = maxed || quote.levels === 0;
    button.innerHTML = maxed
      ? "max"
      : quote.levels === 0
        ? `${formatCount(price)} ◈`
        : `${formatCount(quote.price)} ◈${batched ? `<small>×${quote.levels}</small>` : ""}`;
    button.title = maxed
      ? `${definition.label} — niveau maximum atteint`
      : definition.description;
    button.addEventListener("click", () => {
      if (this.game.buyUpgrade(definition.id, Math.max(1, quote.levels))) this.renderPanel();
    });

    row.append(chip, text, button);
    return row;
  }

  /**
   * The talent tree: one branch at a time, in ladders.
   *
   * A locked node is **listed, not hidden**. Hiding it says nothing; showing the
   * door says "here is the next thing to want", and showing a stat behind an
   * unbought door says what that door is for. What a locked node must never do
   * is look buyable — so it states what is missing instead of a price.
   */
  private renderPermanent(): void {
    const meta = this.game.getMeta();
    const nodes = META_UPGRADES.filter((node) => node.branch === this.branch);

    // Group properly rather than emitting a heading whenever the ladder
    // changes: the definitions are declared in reading order, not sorted, so
    // that shortcut produced Économie / Départ / Économie / Départ.
    const ladders = new Map<string, MetaUpgradeDefinition[]>();
    for (const node of nodes) {
      const group = ladders.get(node.ladder);
      if (group) group.push(node);
      else ladders.set(node.ladder, [node]);
    }

    for (const [ladder, group] of ladders) {
      const title = document.createElement("div");
      title.className = "upgrade-family";
      title.textContent = ladder;
      this.rows.appendChild(title);
      for (const node of group) this.rows.appendChild(this.metaRow(node));
    }

    const note = document.createElement("p");
    note.className = "tree-note";
    note.textContent = `${meta.totalClears} toile(s) terminée(s) · les éclats ne se dépensent qu'ici`;
    this.rows.appendChild(note);
  }

  private metaRow(definition: MetaUpgradeDefinition): HTMLElement {
    const meta = this.game.getMeta();
    const points = meta.levelOf(definition.id);
    const missing = meta.missingFor(definition.id);
    const locked = missing.length > 0;
    const price = meta.priceOf(definition.id);
    const maxed = !locked && price === null;
    const unlock = definition.kind === "unlock";
    const owned = unlock && points > 0;

    const row = document.createElement("div");
    row.className = "upgrade-row";
    row.dataset.kind = definition.kind;
    row.dataset.state = locked ? "locked" : owned ? "owned" : maxed ? "max" : "buy";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = locked ? "?" : definition.glyph;

    const step = unlock || locked ? 0 : this.batch === "max" ? meta.affordableLevels(definition.id) : this.batch;
    const quote =
      unlock || locked ? { levels: 0, price: 0 } : meta.costOf(definition.id, Math.max(1, step));

    // A node with no ceiling shows the rank it reached, not a bar towards a
    // maximum it does not have.
    const rank = unlock ? "" : ` · p. ${points}`;
    const current = definition.format(definition.valueAt(points));
    const next =
      maxed || unlock || locked || quote.levels === 0
        ? ""
        : ` → ${definition.format(definition.valueAt(points + quote.levels))}`;

    const detail = locked
      ? `${missing.map((id) => META_BY_ID.get(id)?.label ?? id).join(", ")} requis`
      : unlock
        ? definition.description
        : `${current}${next}`;

    const text = document.createElement("span");
    text.className = "text";
    text.innerHTML =
      `<span class="name">${locked ? "Verrouillé" : definition.label}${locked ? "" : rank}</span>` +
      `<span class="meta">${detail}</span>` +
      `${locked || unlock ? "" : `<span class="what">${definition.description}</span>`}`;

    const batched = quote.levels > 1;
    const button = document.createElement("button");
    button.className = "price";
    button.type = "button";
    button.disabled = locked || maxed || (!unlock && quote.levels === 0) || (unlock && !meta.canAfford(definition.id));
    button.innerHTML = locked
      ? "—"
      : owned
        ? "acquis"
        : maxed
          ? "max"
          : unlock || quote.levels === 0
            ? `${formatCount(price ?? 0)} ◆`
            : `${formatCount(quote.price)} ◆${batched ? `<small>×${quote.levels}</small>` : ""}`;
    button.title = locked ? "Palier au-dessus requis" : definition.description;
    button.addEventListener("click", () => {
      const id = definition.id as MetaUpgradeId;
      if (this.game.buyMetaUpgrade(id, unlock ? 1 : Math.max(1, quote.levels))) this.renderPanel();
    });

    row.append(chip, text, button);
    return row;
  }
}
