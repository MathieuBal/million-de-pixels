import type { GameController } from "../app/GameController";

/**
 * The way out of a level, and the way back into it.
 *
 * Without this a player is locked in whatever the board gives them: a run that
 * stalls, an image they are tired of, or a pass they finished with nothing left
 * to do. Three exits, and none of them destroys anything the player cannot get
 * back:
 *
 * - **Passage suivant** — only once the board is empty. The image comes back
 *   whole against everything bought, which is the loop that makes finishing
 *   worth something.
 * - **Recommencer l'image** — the board whole again from zero, upgrades and
 *   fragments included. Keeping them would make restarting a way to farm the
 *   same pixels twice, so the reset is total and the panel says so before it
 *   happens.
 * - **Changer d'image** — the run is saved and set aside, not deleted. The
 *   import screen offers to come back to it until another image is started.
 *
 * The two destructive actions arm on the first click and fire on the second,
 * because losing a run to a misplaced tap is exactly the kind of thing this
 * panel exists to prevent.
 */
export class RunMenu {
  private readonly panel = document.getElementById("run-menu") as HTMLElement;
  private readonly scrim = document.getElementById("run-menu-scrim") as HTMLElement;
  private readonly title = document.getElementById("run-menu-title") as HTMLElement;
  private readonly passLabel = document.getElementById("run-menu-pass") as HTMLElement;
  private readonly note = document.getElementById("run-menu-note") as HTMLElement;
  private readonly openButton = document.getElementById("menu") as HTMLButtonElement;
  private readonly closeButton = document.getElementById("run-menu-close") as HTMLButtonElement;
  private readonly nextButton = document.getElementById("run-next") as HTMLButtonElement;
  private readonly restartButton = document.getElementById("run-restart") as HTMLButtonElement;
  private readonly changeButton = document.getElementById("run-change") as HTMLButtonElement;

  /** Set while a destructive action waits for its confirming second click. */
  private armed: HTMLButtonElement | null = null;
  /** Éclats the clear just paid, shown once in the completion panel. */
  private shards = 0;

  constructor(private readonly game: GameController) {
    this.openButton.addEventListener("click", () => this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.scrim.addEventListener("click", () => this.close());

    this.nextButton.addEventListener("click", () => {
      if (this.game.startNextPass()) this.close();
    });

    this.arm(this.restartButton, "Tout recommencer ?", () => {
      if (this.game.restartLevel()) this.close();
    });

    // Suspending moves the phase back to `idle`, and the phase handler is what
    // brings the import screen up with its "reprendre" offer.
    this.arm(this.changeButton, "Mettre la partie de côté ?", () => {
      this.close();
      this.game.suspendForImport();
    });
  }

  /**
   * Two clicks, and only ever one button armed at a time — arming a second one
   * disarms the first, so a stray tap can never leave two live triggers.
   */
  private arm(button: HTMLButtonElement, confirmLabel: string, run: () => void): void {
    const label = button.querySelector(".label") as HTMLElement;
    const original = label.textContent ?? "";

    button.addEventListener("click", () => {
      if (this.armed === button) {
        this.disarm();
        run();
        return;
      }
      this.disarm();
      this.armed = button;
      button.dataset.armed = "true";
      label.textContent = confirmLabel;
    });

    button.dataset.originalLabel = original;
  }

  private disarm(): void {
    if (!this.armed) return;
    const label = this.armed.querySelector(".label") as HTMLElement;
    label.textContent = this.armed.dataset.originalLabel ?? label.textContent;
    delete this.armed.dataset.armed;
    this.armed = null;
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Opens on the player's own initiative: the run keeps going behind it. */
  open(): void {
    this.render(false);
    this.panel.hidden = false;
  }

  /**
   * Opens on the board being cleared. The panel leads with the next pass, and
   * the run has nothing left to do behind it anyway.
   */
  announceCleared(shards = 0): void {
    this.shards = shards;
    this.render(true);
    this.panel.hidden = false;
  }

  close(): void {
    this.disarm();
    this.panel.hidden = true;
  }

  private render(cleared: boolean): void {
    this.disarm();
    this.passLabel.textContent = `Passage ${this.game.pass}`;
    this.nextButton.hidden = !this.game.isCleared;

    if (cleared) {
      this.title.textContent = "Image terminée";
      this.note.textContent =
        `Le million de pixels est tombé. ${this.shards} éclat${this.shards > 1 ? "s" : ""} ` +
        `gagné${this.shards > 1 ? "s" : ""} — ils survivent à l'image et s'achètent dans ` +
        `l'onglet Permanent. Le passage suivant remet l'image entière en face de tout ce ` +
        `que tu as acheté.`;
      this.closeButton.textContent = "Plus tard";
    } else {
      this.title.textContent = "Partie";
      this.note.textContent = "";
      this.closeButton.textContent = "Reprendre";
    }
  }
}
