import type { FitMode, ImageProcessOptions } from "../image/ImageProtocol";
import { validateImageFile } from "../image/ImageProtocol";
import type { QuantizerKind } from "../image/quantization";
import { WORLD_HEIGHT, WORLD_WIDTH, DEFAULT_ALPHA_THRESHOLD } from "../core/constants";

export type ImportHandler = (file: File, options: ImageProcessOptions) => void;

/**
 * Drag & drop plus the import options.
 *
 * Validation happens before anything reaches the worker: an unsupported MIME
 * type or an oversized file is a message here, not a failure three stages into
 * the pipeline.
 */
export class DropZone {
  private readonly root = document.getElementById("dropzone") as HTMLElement;
  private readonly input = document.getElementById("file-input") as HTMLInputElement;
  private readonly error = document.getElementById("drop-error") as HTMLElement;
  private readonly paletteSize = document.getElementById("palette-size") as HTMLInputElement;
  private readonly paletteValue = document.getElementById("palette-size-value") as HTMLOutputElement;
  private readonly fitMode = document.getElementById("fit-mode") as HTMLSelectElement;
  private readonly quantizer = document.getElementById("quantizer") as HTMLSelectElement;
  private readonly fillMargins = document.getElementById("fill-margins") as HTMLInputElement;

  constructor(private readonly onImport: ImportHandler) {
    this.input.addEventListener("change", () => {
      const file = this.input.files?.[0];
      if (file) this.handle(file);
      this.input.value = "";
    });

    this.paletteSize.addEventListener("input", () => {
      this.paletteValue.value = this.paletteSize.value;
    });

    for (const type of ["dragenter", "dragover"]) {
      document.addEventListener(type, (event) => {
        event.preventDefault();
        this.root.classList.add("dragging");
      });
    }
    document.addEventListener("dragleave", () => this.root.classList.remove("dragging"));
    document.addEventListener("drop", (event) => {
      event.preventDefault();
      this.root.classList.remove("dragging");
      const file = (event as DragEvent).dataTransfer?.files?.[0];
      if (file) this.handle(file);
    });
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.error.hidden = false;
  }

  private handle(file: File): void {
    const problem = validateImageFile(file);
    if (problem) {
      this.showError(problem);
      return;
    }
    this.error.hidden = true;
    this.onImport(file, this.readOptions());
  }

  private readOptions(): ImageProcessOptions {
    return {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      fit: this.fitMode.value as FitMode,
      paletteSize: Number(this.paletteSize.value),
      quantizer: this.quantizer.value as QuantizerKind,
      alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
      fillMargins: this.fillMargins.checked,
    };
  }
}
