import type { ImageStage } from "../image/ImageProtocol";

const STAGE_LABELS: Array<[ImageStage, string]> = [
  ["decode", "Décodage"],
  ["resize", "Redimensionnement 1024²"],
  ["histogram", "Analyse des couleurs"],
  ["palette", "Palette"],
  ["map", "Création du niveau"],
  ["index", "Indexation"],
];

/** Staged progress, never a bare spinner: the player sees where time goes. */
export class ProgressPanel {
  private readonly root = document.getElementById("progress") as HTMLElement;
  private readonly list = document.getElementById("stages") as HTMLElement;
  private readonly items = new Map<ImageStage, HTMLElement>();

  constructor() {
    for (const [stage, label] of STAGE_LABELS) {
      const li = document.createElement("li");
      li.textContent = label;
      li.dataset.state = "pending";
      this.items.set(stage, li);
      this.list.appendChild(li);
    }
  }

  show(): void {
    for (const [stage, label] of STAGE_LABELS) {
      const item = this.items.get(stage)!;
      item.dataset.state = "pending";
      item.textContent = label;
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(stage: ImageStage, progress: number): void {
    const item = this.items.get(stage);
    if (!item) return;

    const label = STAGE_LABELS.find(([s]) => s === stage)?.[1] ?? stage;
    if (progress >= 1) {
      item.dataset.state = "done";
      item.textContent = `${label} ✓`;
      return;
    }
    item.dataset.state = "active";
    item.textContent = progress > 0 ? `${label} ${Math.round(progress * 100)} %` : label;
  }
}
