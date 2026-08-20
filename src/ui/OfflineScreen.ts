import type { OfflineReport } from "../app/GameController";
import type { PaletteEntry } from "../core/constants";
import { cssColor, formatCount, formatDuration } from "./format";

/**
 * Screen 03 — what happened while you were away.
 *
 * The wording matters and is deliberate: the game does not announce a gauge,
 * it announces pixels genuinely removed from the board. That is what the
 * offline model actually does, and claiming anything softer would undersell it.
 */
export class OfflineScreen {
  private readonly root = document.getElementById("screen-offline") as HTMLElement;
  private readonly duration = document.getElementById("offline-duration") as HTMLElement;
  private readonly total = document.getElementById("offline-total") as HTMLElement;
  private readonly colors = document.getElementById("offline-colors") as HTMLElement;
  private readonly resume = document.getElementById("offline-resume") as HTMLButtonElement;

  constructor(onResume: () => void) {
    this.resume.addEventListener("click", () => {
      this.hide();
      onResume();
    });
  }

  show(report: OfflineReport, palette: PaletteEntry[]): void {
    this.duration.textContent = `Absence ${formatDuration(report.elapsedMs)}`;
    this.total.textContent = formatCount(report.totalDestroyed);

    // Colour bands weighted by what each one actually lost.
    const removed = Array.from(report.removedByColor);
    const max = Math.max(1, ...removed);

    this.colors.replaceChildren();
    removed
      .map((count, colorId) => ({ count, colorId }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .forEach((entry) => {
        const colour = palette[entry.colorId];
        if (!colour) return;
        const band = document.createElement("div");
        band.style.background = cssColor(colour.r, colour.g, colour.b);
        band.style.flexGrow = String(Math.max(0.2, entry.count / max));
        band.title = `#${entry.colorId} — ${formatCount(entry.count)} pixels`;
        this.colors.appendChild(band);
      });

    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
