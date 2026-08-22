import { DEFAULT_ALPHA_THRESHOLD, WORLD_HEIGHT, WORLD_WIDTH } from "../core/constants";
import type { FitMode, ImageProcessOptions, ImageStage } from "../image/ImageProtocol";
import { validateImageFile } from "../image/ImageProtocol";
import type { QuantizerKind } from "../image/quantization";
import type { PaletteEntry } from "../core/constants";
import { cssColor } from "./format";

export type ImportHandler = (file: File, options: ImageProcessOptions) => void;

const STAGE_LABELS: Array<[ImageStage, string]> = [
  ["decode", "Décodage"],
  ["resize", "Redimensionnement"],
  ["histogram", "Analyse des couleurs"],
  ["palette", "Palette"],
  ["map", "Création du niveau"],
  ["index", "Indexation"],
];

/**
 * Screen 01 — the home screen *is* the import screen: no menu before it.
 *
 * Drag & drop anywhere, file picker, and the settings rows that give way to
 * the pipeline stages while the worker runs.
 */
export class ImportScreen {
  private readonly root = document.getElementById("screen-import") as HTMLElement;
  private readonly dropzone = document.getElementById("dropzone") as HTMLElement;
  private readonly input = document.getElementById("file-input") as HTMLInputElement;
  private readonly error = document.getElementById("drop-error") as HTMLElement;
  private readonly rows = document.getElementById("import-rows") as HTMLElement;
  private readonly stagesList = document.getElementById("stages") as HTMLElement;
  private readonly sourcePreview = document.getElementById("source-preview") as HTMLElement;
  private readonly quantizedPreview = document.getElementById("quantized-preview") as HTMLElement;
  private readonly paletteCount = document.getElementById("palette-count") as HTMLElement;
  private readonly swatches = document.getElementById("palette-swatches") as HTMLElement;
  private readonly cta = document.getElementById("start-run") as HTMLButtonElement;
  private readonly resumeButton = document.getElementById("resume-run") as HTMLButtonElement;
  private readonly treeButton = document.getElementById("import-tree") as HTMLButtonElement;
  private readonly shardCount = document.getElementById("import-shards") as HTMLElement;

  private readonly paletteSize = document.getElementById("palette-size") as HTMLInputElement;
  private readonly paletteValue = document.getElementById("palette-size-value") as HTMLOutputElement;
  private readonly autoPalette = document.getElementById("auto-palette") as HTMLInputElement;
  private readonly fitMode = document.getElementById("fit-mode") as HTMLSelectElement;
  private readonly quantizer = document.getElementById("quantizer") as HTMLSelectElement;
  private readonly fillMargins = document.getElementById("fill-margins") as HTMLInputElement;

  private readonly stageItems = new Map<ImageStage, HTMLElement>();
  private sourceUrl: string | null = null;

  constructor(private readonly onImport: ImportHandler) {
    for (const [stage, label] of STAGE_LABELS) {
      const li = document.createElement("li");
      li.dataset.state = "pending";
      li.innerHTML = `${label}<span></span>`;
      this.stageItems.set(stage, li);
      this.stagesList.appendChild(li);
    }

    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file) this.handle(file);
      this.input.value = "";
    });

    this.paletteSize.addEventListener("input", () => {
      this.paletteValue.value = this.paletteSize.value;
    });
    this.autoPalette.addEventListener("change", () => {
      const auto = this.autoPalette.checked;
      this.paletteSize.disabled = auto;
      this.paletteValue.value = auto ? "auto" : this.paletteSize.value;
      this.syncRows();
    });
    for (const control of [this.fitMode, this.quantizer, this.fillMargins]) {
      control.addEventListener("change", () => this.syncRows());
    }

    for (const type of ["dragenter", "dragover"]) {
      document.addEventListener(type, (event) => {
        event.preventDefault();
        this.dropzone.classList.add("dragging");
      });
    }
    document.addEventListener("dragleave", () => this.dropzone.classList.remove("dragging"));
    document.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dropzone.classList.remove("dragging");
      const file = (event as DragEvent).dataTransfer?.files?.[0];
      if (file) this.handle(file);
    });
  }

  show(): void {
    this.root.hidden = false;
    this.rows.hidden = false;
    this.stagesList.hidden = true;
  }

  /**
   * Offers the way back to a run set aside rather than finished. Hidden when
   * there is nothing to come back to, so the screen stays a first-run screen.
   */
  setResumable(resumable: boolean): void {
    this.resumeButton.hidden = !resumable;
  }

  onResume(handler: () => void): void {
    this.resumeButton.addEventListener("click", handler);
  }

  onOpenTree(handler: () => void): void {
    this.treeButton.addEventListener("click", handler);
  }

  /** The permanent tree is only worth offering once there is something in it. */
  setShards(shards: number): void {
    this.treeButton.hidden = shards <= 0;
    this.shardCount.textContent = String(shards);
  }

  hide(): void {
    this.root.hidden = true;
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
    this.rows.hidden = false;
    this.stagesList.hidden = true;
  }

  /** Analysis replaces the settings rows with the pipeline stages. */
  beginAnalysis(): void {
    this.error.hidden = true;
    this.rows.hidden = true;
    this.stagesList.hidden = false;
    for (const [stage, label] of STAGE_LABELS) {
      const item = this.stageItems.get(stage)!;
      item.dataset.state = "pending";
      item.innerHTML = `${label}<span></span>`;
    }
  }

  updateStage(stage: ImageStage, progress: number): void {
    const item = this.stageItems.get(stage);
    if (!item) return;
    const label = STAGE_LABELS.find(([s]) => s === stage)?.[1] ?? stage;
    if (progress >= 1) {
      item.dataset.state = "done";
      item.innerHTML = `${label}<span>✓</span>`;
      return;
    }
    item.dataset.state = "active";
    item.innerHTML = `${label}<span>${progress > 0 ? `${Math.round(progress * 100)} %` : ""}</span>`;
  }

  /** Shows what the image became: its palette, and a preview of the grid. */
  showResult(palette: PaletteEntry[], colorId: Uint8Array, width: number): void {
    this.paletteCount.textContent = `${palette.length} couleur${palette.length > 1 ? "s" : ""}`;

    this.swatches.replaceChildren();
    for (const entry of palette) {
      const swatch = document.createElement("div");
      swatch.style.background = cssColor(entry.r, entry.g, entry.b);
      this.swatches.appendChild(swatch);
    }

    // 16x16 sample of the real grid — the quantized level, not a mock-up.
    this.quantizedPreview.replaceChildren();
    const step = Math.floor(width / 16);
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 16; col++) {
        const index = (row * step + (step >> 1)) * width + col * step + (step >> 1);
        const entry = palette[colorId[index]];
        const cell = document.createElement("div");
        cell.style.background = entry ? cssColor(entry.r, entry.g, entry.b) : "transparent";
        this.quantizedPreview.appendChild(cell);
      }
    }

    this.cta.disabled = false;
    this.rows.hidden = false;
    this.stagesList.hidden = true;
  }

  onStart(handler: () => void): void {
    this.cta.addEventListener("click", handler);
  }

  private handle(file: File): void {
    const problem = validateImageFile(file);
    if (problem) {
      this.showError(problem);
      return;
    }
    this.error.hidden = true;
    this.showSource(file);
    this.onImport(file, this.readOptions());
  }

  private showSource(file: File): void {
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    this.sourceUrl = URL.createObjectURL(file);
    const img = document.createElement("img");
    img.src = this.sourceUrl;
    img.alt = "";
    this.sourcePreview.replaceChildren(img);
  }

  private syncRows(): void {
    const [fitRow, quantRow, marginRow] = this.rows.querySelectorAll(".value");
    fitRow.textContent = `${this.fitMode.value} · ${
      this.fitMode.value === "contain" ? "silhouette" : "plein cadre"
    }`;
    quantRow.textContent = this.autoPalette.checked
      ? this.quantizer.value || "automatique"
      : `${this.paletteSize.value} couleurs`;
    marginRow.textContent = this.fillMargins.checked ? "activé" : "désactivé";
  }

  private readOptions(): ImageProcessOptions {
    const options: ImageProcessOptions = {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      fit: this.fitMode.value as FitMode,
      alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
      fillMargins: this.fillMargins.checked,
    };
    // Both absent by default: the image decides.
    if (!this.autoPalette.checked) options.paletteSize = Number(this.paletteSize.value);
    if (this.quantizer.value) options.quantizer = this.quantizer.value as QuantizerKind;
    return options;
  }
}
