import type { GameController } from "../app/GameController";
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  UPGRADES,
  UPGRADE_BY_ID,
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
import {
  HEX_BONUS,
  LIBRARY_SIZE,
  PLANE_BONUS,
  PLANE_COUNT,
  PLANE_SIZE,
  hexesOfPlane,
  planeLabel,
} from "../progression/ColorLibrary";
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
  private tab: "level" | "permanent" | "library" = "level";
  /** Which page of the colour book is open. Null until the panel picks one. */
  private libraryPlane: number | null = null;
  /**
   * The hex whose entry is open, if any.
   *
   * It has to live here rather than in the DOM: the panel re-renders on every
   * HUD tick while it is open, so a card drawn straight into `rows` was wiped
   * within a frame — it never survived long enough to be read.
   */
  private openSpecimen: string | null = null;
  /** Which family of the shop, or which branch of the tree, is on screen. */
  private family: UpgradeFamily = "rail";
  private branch: MetaBranch = "racine";
  /** How many levels a click buys. `max` is "as many as the balance allows". */
  private batch: 1 | 10 | "max" = 1;

  constructor(private readonly game: GameController) {
    for (const [id, label] of [
      ["level", "Cette image"],
      ["permanent", "Permanent"],
      ["library", "Nuancier"],
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
    // The library has one page, so it gets no second row of tabs at all.
    if (this.tab === "library") {
      this.subTabs.hidden = true;
      this.batchRow.hidden = true;
      return;
    }
    this.subTabs.hidden = false;
    this.batchRow.hidden = false;

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

  open(tab: "level" | "permanent" | "library" = this.tab): void {
    this.tab = tab;
    // Reopening the panel comes back to the grid: a card left open from last
    // time is an answer to a question nobody just asked.
    this.openSpecimen = null;
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

    if (this.tab === "library") {
      if (this.openSpecimen) this.renderSpecimen(this.openSpecimen);
      else this.renderLibrary();
      return;
    }
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
    const missing = upgrades.missingFor(definition.id);
    const locked = missing.length > 0;
    const price = upgrades.priceOf(definition.id);
    const maxed = !locked && price === null;

    const row = document.createElement("div");
    row.className = "upgrade-row";
    row.dataset.state = locked
      ? "locked"
      : maxed
        ? "max"
        : upgrades.canAfford(definition.id)
          ? "buy"
          : "poor";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = definition.glyph;

    const quote = maxed || locked ? { levels: 0, price: 0 } : this.quote(definition.id);
    const shown = Math.max(1, quote.levels);
    const current = definition.format(definition.valueAt(level));
    const next = maxed || locked ? "" : ` → ${definition.format(definition.valueAt(level + shown))}`;

    // A locked axis says what door it is behind rather than a value it cannot
    // have: "here is the next thing to want" is the reason it is listed at all.
    const doors = missing
      .map((id) => UPGRADE_BY_ID.get(id)?.label ?? id)
      .join(", ");

    const text = document.createElement("span");
    text.className = "text";
    text.innerHTML =
      `<span class="name">${definition.label}${locked ? "" : ` · niv. ${level}`}</span>` +
      `<span class="meta">${locked ? `demande ${doors}` : `${current}${next}`}</span>` +
      `<span class="what">${definition.description}</span>` +
      `<span class="track"><i style="width:${locked ? 0 : ((level / definition.maxLevel) * 100).toFixed(1)}%"></i></span>`;

    const batched = quote.levels > 1;
    const button = document.createElement("button");
    button.className = "price";
    button.type = "button";
    button.disabled = locked || maxed || quote.levels === 0;
    button.innerHTML = locked
      ? "verrouillé"
      : maxed
        ? "max"
        : quote.levels === 0
          ? // Never null here: locked and maxed are both handled above.
            `${formatCount(price ?? 0)} ◈`
          : `${formatCount(quote.price)} ◈${batched ? `<small>×${quote.levels}</small>` : ""}`;
    button.title = locked
      ? `${definition.label} — demande ${doors}`
      : maxed
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

  /**
   * The colour book: four thousand and ninety-six hexes, read one page at a
   * time.
   *
   * A grid rather than a list, because the shape of what is missing is the
   * information — a hole in the warm greens says "go find another picture" far
   * better than a number would. The whole cube at once would be four thousand
   * swatches on a phone and a wall of noise besides, so it is shown as sixteen
   * planes of two hundred and fifty-six: one red level per page, green down and
   * blue across. A page is small enough to finish, which is where the collecting
   * actually happens — the per-hex trickle is deliberately too small to feel one
   * at a time.
   *
   * Each hex is catalogued by clearing a colour that snaps to it, and pays
   * passively for the rest of the profile's life: work already finished,
   * rewarded quietly, never the reason to play.
   */
  private renderLibrary(): void {
    const library = this.game.getMeta().library;
    const bonus = library.bonus();
    // First look lands where there is something to see, not on plane zero.
    this.libraryPlane ??= library.fullestPlane;
    const openPlane = this.libraryPlane;

    const head = document.createElement("div");
    head.className = "upgrade-family";
    head.textContent = `${library.discovered} / ${LIBRARY_SIZE} teintes · ${library.completePlanes} / ${PLANE_COUNT} planches`;
    this.rows.appendChild(head);

    const note = document.createElement("p");
    note.className = "tree-note";
    note.textContent =
      `+${((bonus.fragmentMultiplier - 1) * 100).toFixed(1)} % de fragments et de production ` +
      `hors-ligne · ${(HEX_BONUS * 100).toFixed(2)} % par teinte, ` +
      `${(PLANE_BONUS * 100).toFixed(0)} % par planche complète`;
    this.rows.appendChild(note);

    // The pages, with their own progress on them: which one to open next is the
    // only decision this screen offers, so it has to be answerable at a glance.
    const pages = document.createElement("div");
    pages.className = "hex-pages";
    for (let plane = 0; plane < PLANE_COUNT; plane++) {
      const { found } = library.planeProgress(plane);
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "hex-page";
      tab.dataset.active = String(plane === openPlane);
      // The bar is the plane's own red, warmed just enough that the darkest
      // page still shows a bar rather than a gap in the strip.
      const red = plane * 17;
      tab.style.setProperty("--page-tint", `rgb(${Math.max(28, red)}, ${red * 0.16}, ${red * 0.16})`);
      tab.textContent = planeLabel(plane);
      tab.title = `${planeLabel(plane)} — ${found} / ${PLANE_SIZE}`;
      tab.setAttribute("aria-label", `Planche ${planeLabel(plane)}, ${found} sur ${PLANE_SIZE}`);
      tab.addEventListener("click", () => {
        this.libraryPlane = plane;
        this.openSpecimen = null;
        this.renderPanel();
      });
      pages.appendChild(tab);
    }
    this.rows.appendChild(pages);

    const { found } = library.planeProgress(openPlane);
    const pageHead = document.createElement("p");
    pageHead.className = "tree-note";
    pageHead.textContent = `Planche ${planeLabel(openPlane)} — ${found} / ${PLANE_SIZE}`;
    this.rows.appendChild(pageHead);

    const grid = document.createElement("div");
    grid.className = "hex-grid";
    for (const hex of hexesOfPlane(openPlane)) {
      const specimen = library.specimen(hex);
      const cell = document.createElement("div");
      cell.className = "hex-cell";
      cell.dataset.found = String(specimen !== null);
      if (specimen) {
        // The swatch shows the specimen as it was on the board, not the grid
        // value it was filed under.
        cell.style.background = `rgb(${specimen.r}, ${specimen.g}, ${specimen.b})`;
        cell.title = `${hex} · ${formatCount(specimen.pixels)} px · ${specimen.clears} fois`;
        // A found hex opens its own entry: that is what makes this a book
        // rather than a grid of four thousand checkboxes.
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.addEventListener("click", () => {
          this.openSpecimen = hex;
          this.renderPanel();
        });
      } else {
        cell.title = `${hex} — jamais épuisée`;
      }
      grid.appendChild(cell);
    }
    this.rows.appendChild(grid);
  }

  /**
   * La fiche d'une teinte : où elle a été trouvée, et ce qu'elle a coûté.
   *
   * Quatre mille pastilles sans histoire sont un compteur ; une entrée qui dit
   * de quelle image elle vient est un souvenir. C'est la différence entre une
   * grille et un carnet de terrain — et la seule chose qui donne envie
   * d'importer une image pour ses couleurs plutôt que pour ses pixels.
   */
  private renderSpecimen(hex: string): void {
    const specimen = this.game.getMeta().library.specimen(hex);
    if (!specimen) {
      this.openSpecimen = null;
      this.renderLibrary();
      return;
    }

    const card = document.createElement("div");
    card.className = "specimen";

    const swatch = document.createElement("div");
    swatch.className = "specimen-swatch";
    swatch.style.background = `rgb(${specimen.r}, ${specimen.g}, ${specimen.b})`;

    const lines: Array<[string, string]> = [
      ["Teinte", hex],
      ["Sur le plateau", `rgb(${specimen.r}, ${specimen.g}, ${specimen.b})`],
      ["Pixels détruits", formatCount(specimen.pixels)],
      ["Épuisée", `${specimen.clears} fois`],
    ];
    // Absent on a specimen catalogued before the gallery existed: an old save
    // loses the caption, not the entry.
    if (specimen.fromImage) lines.push(["Trouvée sur", specimen.fromImage]);
    if (specimen.foundAtEpochMs) {
      lines.push(["Le", new Date(specimen.foundAtEpochMs).toLocaleDateString("fr-FR")]);
    }

    const body = document.createElement("div");
    body.className = "specimen-body";
    for (const [label, value] of lines) {
      const row = document.createElement("div");
      row.className = "reward-row";
      row.innerHTML = `<span>${label}</span><b>${value}</b>`;
      body.appendChild(row);
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "ghost-button";
    back.innerHTML = `<span class="label">Retour au nuancier</span>`;
    back.addEventListener("click", () => {
      this.openSpecimen = null;
      this.renderPanel();
    });

    card.append(swatch, body);
    this.rows.append(card, back);
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
