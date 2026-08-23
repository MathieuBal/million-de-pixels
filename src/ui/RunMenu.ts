import type { GameController } from "../app/GameController";
import type { ClearReward } from "../progression/MetaProgression";
import { formatCount } from "./format";

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
 * - **Recommencer l'image** — the board whole again, and this toile's upgrades
 *   and fragments gone with it. Keeping them would make restarting a way to
 *   farm the same pixels twice. What the profile paid for stays, exactly as on
 *   a new image: a restart and a new toile are the same moment.
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
  private readonly rewardBox = document.getElementById("run-reward") as HTMLElement;
  private readonly openButton = document.getElementById("menu") as HTMLButtonElement;
  private readonly closeButton = document.getElementById("run-menu-close") as HTMLButtonElement;
  private readonly nextButton = document.getElementById("run-next") as HTMLButtonElement;
  private readonly treeButton = document.getElementById("run-tree") as HTMLButtonElement;
  private readonly restartButton = document.getElementById("run-restart") as HTMLButtonElement;
  private readonly changeButton = document.getElementById("run-change") as HTMLButtonElement;

  /** Set while a destructive action waits for its confirming second click. */
  private armed: HTMLButtonElement | null = null;
  /** What the clear just paid, itemised, shown once in the completion panel. */
  private reward: ClearReward | null = null;

  constructor(
    private readonly game: GameController,
    private readonly onOpenTree: () => void,
  ) {
    this.openButton.addEventListener("click", () => this.open());
    this.closeButton.addEventListener("click", () => this.close());
    this.scrim.addEventListener("click", () => this.close());

    this.nextButton.addEventListener("click", () => {
      if (this.game.startNextPass()) this.close();
    });

    // The tree is reached from the end of an image, which is the moment a
    // player has éclats and a reason to think about the next toile.
    this.treeButton.addEventListener("click", () => {
      this.close();
      this.onOpenTree();
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
  announceCleared(reward: ClearReward | null = null): void {
    this.reward = reward;
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
      this.renderReward();
      this.closeButton.textContent = "Plus tard";
    } else {
      this.title.textContent = "Partie";
      this.note.textContent = "";
      this.reward = null;
      this.renderReward();
      this.closeButton.textContent = "Reprendre";
    }
  }

  /**
   * The reward, line by line.
   *
   * A single number would be a number to take on faith. Four things make a
   * picture hard — its size, how many colours had to be juggled, how many of
   * them were rare enough to hide behind another, and whether the player had
   * already been round this image — and each one is worth reading, because each
   * one is a reason to go and find a different picture to feed the machine.
   */
  private renderReward(): void {
    const reward = this.reward;
    this.rewardBox.hidden = reward === null;
    if (!reward) return;

    const lines: Array<[string, string]> = [
      ["Pixels détruits", `${formatCount(reward.base)} ◆`],
      ["Palette", `×${reward.paletteFactor.toFixed(2)}`],
      ["Couleurs rares", `×${reward.rarityFactor.toFixed(2)}`],
      ["Passage", `×${reward.passFactor.toFixed(2)}`],
      // The only line that goes up on its own, so it is the one worth reading:
      // every toile already finished pays on this one.
      ["Métier", `×${reward.craftFactor.toFixed(2)}`],
    ];
    if (reward.multiplier !== 1) lines.push(["Prospecteur", `×${reward.multiplier.toFixed(2)}`]);

    this.rewardBox.replaceChildren();
    for (const [label, value] of lines) {
      const row = document.createElement("div");
      row.className = "reward-row";
      row.innerHTML = `<span>${label}</span><b>${value}</b>`;
      this.rewardBox.appendChild(row);
    }

    const total = document.createElement("div");
    total.className = "reward-row reward-total";
    total.innerHTML = `<span>Éclats gagnés</span><b>${formatCount(reward.total)} ◆</b>`;
    this.rewardBox.appendChild(total);

    this.note.textContent =
      "Les éclats survivent à l'image et s'achètent dans l'onglet Permanent. " +
      "Le passage suivant remet l'image entière en face de tout ce que tu as acheté.";
  }
}
