import type { GameController } from "../app/GameController";
import { campaignEntries, fetchCampaignImage, type CampaignEntry } from "../progression/Campaign";

/**
 * L'écran de campagne : cinquante-six toiles, de la plus douce à la plus rude.
 *
 * Il montre la pente au lieu de la décrire. Chaque carte porte sa note sur cinq
 * et les trois nombres qui la fondent — couleurs, rares, enterrées — parce que
 * « difficile » ne veut rien dire tant qu'on ne sait pas *en quoi* : une toile
 * de seize couleurs franches et une toile de huit couleurs dont six sont
 * enterrées ne se jouent pas pareil, et ne demandent pas la même doctrine.
 *
 * Une toile verrouillée reste visible. Cacher la suite ne ménage aucune
 * surprise — la campagne est ordonnée, on sait qu'il y a plus dur après — et
 * voir où l'on va est la moitié de l'envie d'y aller.
 */
export class CampaignPanel {
  private readonly list = document.getElementById("campaign-list") as HTMLElement;
  private readonly progress = document.getElementById("campaign-progress") as HTMLElement;

  constructor(
    private readonly game: GameController,
    /** Prévient l'écran d'accueil qu'une image de campagne part en préparation. */
    private readonly onPick: () => void,
  ) {
    this.render();
  }

  render(): void {
    const entries = campaignEntries(this.game.campaignProgress);
    const done = entries.filter((entry) => entry.cleared).length;
    this.progress.textContent = `${done} / ${entries.length}`;

    this.list.replaceChildren();
    for (const entry of entries) this.list.appendChild(this.card(entry));
  }

  private card(entry: CampaignEntry): HTMLElement {
    const { image, cleared, unlocked } = entry;
    const difficulty = image.difficulty;

    const card = document.createElement("button");
    card.type = "button";
    card.className = "campaign-card";
    card.dataset.state = cleared ? "cleared" : unlocked ? "open" : "locked";
    card.disabled = !unlocked;

    const rating = difficulty?.rating ?? 0;
    // Des points pleins et vides plutôt qu'un nombre : la note se compare d'un
    // coup d'œil d'une carte à l'autre, ce qu'un « 3/5 » oblige à lire.
    const dots = "●".repeat(rating) + "○".repeat(Math.max(0, 5 - rating));

    card.innerHTML =
      `<span class="campaign-name">${image.name}</span>` +
      `<span class="campaign-dots" aria-label="difficulté ${rating} sur 5">${dots}</span>` +
      `<span class="campaign-hint">${unlocked ? image.hint : "verrouillée"}</span>` +
      (cleared ? `<span class="campaign-done">terminée</span>` : "");

    card.addEventListener("click", () => {
      if (!unlocked) return;
      this.onPick();
      void (async () => {
        try {
          const file = await fetchCampaignImage(image);
          this.game.beginCampaign(image.id);
          await this.game.importImage(file);
        } catch (error) {
          // Une image de campagne qui ne charge pas est un fichier manquant, pas
          // une erreur de joueur : le dire plutôt que de laisser l'écran figé.
          this.game.reportError(error instanceof Error ? error.message : String(error));
        }
      })();
    });

    return card;
  }
}
