/**
 * La campagne : des images fournies avec le jeu, et un temps à battre.
 *
 * Tout le reste du jeu part d'un fichier que le joueur apporte, ce qui laisse
 * la première minute sans réponse à « et je joue quoi ? ». Une poignée d'images
 * livrées répond à ça, et elles apportent au passage le deuxième axe qui
 * manque : mesuré, le jeu n'en a qu'un — l'abondance ou la rareté des
 * lancements — et c'est pour ça qu'aucune troisième doctrine n'a jamais été
 * première. Une image dictée par le jeu, avec sa palette et sa disposition,
 * pose une question que le joueur n'a pas choisie.
 *
 * Elles ne sont pas un mode à part : une image de campagne passe par le même
 * import, rejoint la même galerie et paie les mêmes éclats. Ce qu'elle ajoute
 * est un cadre — un ordre, un temps de référence — pas des règles.
 */

/**
 * Ce qui rend une toile difficile, et comment on le sait.
 *
 * Pas à l'œil. Trois choses ont été mesurées et ce sont les trois seules qui
 * comptent :
 *
 * - **le nombre de couleurs** — chacune est une file, un canon et un goulot de
 *   plus ; à doctrine égale, seize couleurs ont pris 20,5 min contre 14,3 pour
 *   huit sur la même surface ;
 * - **les couleurs rares** — sous un pour cent du plateau, ce sont elles qui se
 *   cachent derrière une autre et bloquent une fin de partie ;
 * - **les couleurs enterrées au départ** — celles qu'aucune voie n'expose sur le
 *   plateau intact. `PixelWorld.reachableColors()` les donne en quatre mille
 *   lectures, et c'est le meilleur indicateur de « cette image va coincer ».
 *
 * Une note d'ensemble en découle, de 1 à 5. Elle sert à ordonner la campagne :
 * une progression par difficulté n'a de sens que si la difficulté est autre
 * chose qu'une impression.
 */
export interface DifficultyReading {
  paletteSize: number;
  rareColors: number;
  buriedAtStart: number;
  /** 1 à 5. Ce que la carte affiche. */
  rating: number;
}

export function rateDifficulty(input: {
  paletteSize: number;
  rareColors: number;
  buriedAtStart: number;
}): DifficultyReading {
  // Chaque terme est ramené sur [0, 1] avant d'être pesé, sinon le nombre de
  // couleurs — le plus grand des trois — écraserait les deux autres.
  const palette = Math.min(1, Math.max(0, input.paletteSize - 4) / 14);
  const rare = Math.min(1, input.rareColors / 8);
  const buried = Math.min(1, input.buriedAtStart / 5);

  // Les couleurs enterrées pèsent le plus : ce sont elles qui font qu'une toile
  // s'arrête au lieu de simplement durer.
  const score = palette * 0.35 + rare * 0.25 + buried * 0.4;

  return {
    ...input,
    rating: Math.max(1, Math.min(5, 1 + Math.round(score * 4))),
  };
}

export interface CampaignImage {
  id: string;
  /** Fichier dans `public/campagne/`. C'est la seule chose à déposer. */
  file: string;
  name: string;
  /** Ce que l'image demande, en une ligne. */
  hint: string;
  /**
   * Temps de référence, en millisecondes, ou null tant qu'il n'a pas été
   * mesuré. Inventer un temps sur une image qu'on n'a pas jouée donnerait un
   * objectif qui ne veut rien dire — la carte montre alors seulement le
   * meilleur temps du joueur.
   */
  parMs: number | null;
  /**
   * La note calculée sur l'image réelle, écrite ici une fois mesurée. Null tant
   * qu'elle ne l'a pas été — une campagne ordonnée par des difficultés devinées
   * ordonnerait des impressions.
   */
  difficulty: DifficultyReading | null;
}

/**
 * Les images livrées, dans l'ordre où elles sont proposées.
 *
 * Déposer un fichier dans `public/campagne/` et ajouter une ligne ici suffit :
 * rien d'autre dans le jeu ne connaît cette liste.
 */
export const CAMPAIGN: CampaignImage[] = [];

/** Les images de campagne, de la plus douce à la plus rude. */
export function campaignByDifficulty(): CampaignImage[] {
  return [...CAMPAIGN].sort((a, b) => {
    // Une image non encore mesurée passe en fin de liste plutôt que de
    // s'insérer à une place qu'on lui aurait supposée.
    const left = a.difficulty?.rating ?? Number.POSITIVE_INFINITY;
    const right = b.difficulty?.rating ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
}

/** Charge une image de campagne comme si le joueur venait de la déposer. */
export async function fetchCampaignImage(image: CampaignImage): Promise<File> {
  const url = `${import.meta.env.BASE_URL}campagne/${image.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image de campagne introuvable : ${image.file}`);

  const blob = await response.blob();
  // Le même chemin que le glisser-déposer, jusqu'au type MIME : une image de
  // campagne ne doit avoir aucun traitement de faveur, sinon elle testerait un
  // code que personne d'autre n'emprunte.
  return new File([blob], image.name, { type: blob.type || "image/png" });
}
