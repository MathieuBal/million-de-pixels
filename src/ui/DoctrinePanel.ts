import type { GameController } from "../app/GameController";
import { DOCTRINES, type DoctrineId } from "../progression/Doctrine";

/**
 * Le choix de doctrine, sur l'écran d'import.
 *
 * Il est ici et pas dans la boutique parce que c'est un engagement et non un
 * réglage : il se prend avant la toile, en regardant l'image, et il vaut pour
 * toute sa durée. Une doctrine qu'on pourrait changer en cours de partie ne
 * serait plus une décision, seulement un curseur de plus.
 *
 * Chaque carte dit ce qu'elle donne, ce qu'elle retire et à quoi elle va. Ce
 * dernier point est mesuré, pas deviné : au pouce lent Fonte finit la même
 * image en 14,3 min contre 22,1 à Meule ; au pouce rapide c'est Meule en 7,3
 * contre 10,0. Aucune ne domine, et c'est exactement ce qui manquait à l'arbre
 * permanent, où trois stratégies opposées finissaient à moins d'un pour cent
 * l'une de l'autre.
 */
export class DoctrinePanel {
  private readonly root = document.getElementById("doctrine") as HTMLElement;
  private readonly choices = document.getElementById("doctrine-choices") as HTMLElement;

  constructor(private readonly game: GameController) {
    this.render();
  }

  render(): void {
    // Rien à choisir tant qu'aucune image n'attend : l'écran d'accueil vierge
    // ne doit pas demander un engagement sur une toile qui n'existe pas.
    this.root.hidden = !this.game.hasPreparedLevel;
    if (this.root.hidden) return;

    const current = this.game.doctrine;
    this.choices.replaceChildren();

    for (const doctrine of DOCTRINES) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "doctrine-card";
      card.dataset.id = doctrine.id;
      card.dataset.active = String(doctrine.id === current);
      card.setAttribute("aria-pressed", String(doctrine.id === current));

      card.innerHTML =
        `<span class="doctrine-head"><b>${doctrine.label}</b><i>${doctrine.glyph}</i></span>` +
        `<span class="doctrine-gain">${doctrine.gain}</span>` +
        (doctrine.cost ? `<span class="doctrine-cost">${doctrine.cost}</span>` : "") +
        `<span class="doctrine-suits">${doctrine.suits}</span>`;

      card.addEventListener("click", () => {
        this.game.setDoctrine(doctrine.id as DoctrineId);
        this.render();
      });

      this.choices.appendChild(card);
    }
  }
}
