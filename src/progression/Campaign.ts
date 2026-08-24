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
/**
 * Les cinquante-six toiles, rangées de la plus douce à la plus rude.
 *
 * Chaque note sort d'un import réel : le quantifieur a tourné sur l'image, et
 * les trois nombres sont lus sur le plateau intact. Rien ici n'a été estimé à
 * l'œil — un premier classement visuel avait rangé ces images par « densité
 * apparente », un critère qui ne survit pas à la quantification.
 *
 * Ce que le relevé a donné sur les cinquante-six : la palette va de 5 à 16
 * couleurs (médiane 10), les couleurs rares de 0 à 12 (médiane 1), et les
 * couleurs déjà enterrées de 0 à 15 (médiane 2). La note se répartit en
 * 13/13/17/8/5, ce qui est la pyramide qu'une campagne veut — beaucoup de
 * douces pour apprendre, peu de finales.
 *
 * `parMs` reste nul : le temps de référence se mesure en jouant, pas en
 * regardant, et il dépendra des doctrines autant que de l'image.
 */
export const CAMPAIGN: CampaignImage[] = [
  {
    id: "toile-03",
    file: "toile-03.png",
    name: "Toile 01",
    hint: "5 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-11",
    file: "toile-11.png",
    name: "Toile 02",
    hint: "5 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-20",
    file: "toile-20.png",
    name: "Toile 03",
    hint: "5 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-27",
    file: "toile-27.png",
    name: "Toile 04",
    hint: "5 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-34",
    file: "toile-34.png",
    name: "Toile 05",
    hint: "6 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 6,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-48",
    file: "toile-48.png",
    name: "Toile 06",
    hint: "8 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 8,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-16",
    file: "toile-16.png",
    name: "Toile 07",
    hint: "5 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-04",
    file: "toile-04.png",
    name: "Toile 08",
    hint: "6 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 6,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-06",
    file: "toile-06.png",
    name: "Toile 09",
    hint: "7 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-21",
    file: "toile-21.png",
    name: "Toile 10",
    hint: "7 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-26",
    file: "toile-26.png",
    name: "Toile 11",
    hint: "7 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-09",
    file: "toile-09.png",
    name: "Toile 12",
    hint: "6 couleurs, 2 rares, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 6,
      rareColors: 2,
      buriedAtStart: 0,
      rating: 1,
    },
  },
  {
    id: "toile-53",
    file: "toile-53.png",
    name: "Toile 13",
    hint: "9 couleurs, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 9,
      rareColors: 0,
      buriedAtStart: 0,
      rating: 2,
    },
  },
  {
    id: "toile-24",
    file: "toile-24.png",
    name: "Toile 14",
    hint: "8 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 8,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 2,
    },
  },
  {
    id: "toile-14",
    file: "toile-14.png",
    name: "Toile 15",
    hint: "14 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 14,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 2,
    },
  },
  {
    id: "toile-56",
    file: "toile-56.png",
    name: "Toile 16",
    hint: "16 couleurs, 1 rare, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 1,
      buriedAtStart: 0,
      rating: 2,
    },
  },
  {
    id: "toile-05",
    file: "toile-05.png",
    name: "Toile 17",
    hint: "7 couleurs, 3 rares, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 3,
      buriedAtStart: 0,
      rating: 2,
    },
  },
  {
    id: "toile-37",
    file: "toile-37.png",
    name: "Toile 18",
    hint: "6 couleurs, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 6,
      rareColors: 0,
      buriedAtStart: 1,
      rating: 2,
    },
  },
  {
    id: "toile-40",
    file: "toile-40.png",
    name: "Toile 19",
    hint: "10 couleurs, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 10,
      rareColors: 0,
      buriedAtStart: 1,
      rating: 2,
    },
  },
  {
    id: "toile-47",
    file: "toile-47.png",
    name: "Toile 20",
    hint: "10 couleurs, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 10,
      rareColors: 0,
      buriedAtStart: 1,
      rating: 2,
    },
  },
  {
    id: "toile-36",
    file: "toile-36.png",
    name: "Toile 21",
    hint: "8 couleurs, 1 rare, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 8,
      rareColors: 1,
      buriedAtStart: 1,
      rating: 2,
    },
  },
  {
    id: "toile-38",
    file: "toile-38.png",
    name: "Toile 22",
    hint: "10 couleurs, 1 rare, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 10,
      rareColors: 1,
      buriedAtStart: 1,
      rating: 2,
    },
  },
  {
    id: "toile-25",
    file: "toile-25.png",
    name: "Toile 23",
    hint: "6 couleurs, 1 rare, 2 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 6,
      rareColors: 1,
      buriedAtStart: 2,
      rating: 2,
    },
  },
  {
    id: "toile-13",
    file: "toile-13.png",
    name: "Toile 24",
    hint: "7 couleurs, 3 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 0,
      buriedAtStart: 3,
      rating: 2,
    },
  },
  {
    id: "toile-19",
    file: "toile-19.png",
    name: "Toile 25",
    hint: "5 couleurs, 4 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 4,
      rating: 2,
    },
  },
  {
    id: "toile-22",
    file: "toile-22.png",
    name: "Toile 26",
    hint: "5 couleurs, 4 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 5,
      rareColors: 0,
      buriedAtStart: 4,
      rating: 2,
    },
  },
  {
    id: "toile-08",
    file: "toile-08.png",
    name: "Toile 27",
    hint: "15 couleurs, 4 rares, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 15,
      rareColors: 4,
      buriedAtStart: 0,
      rating: 3,
    },
  },
  {
    id: "toile-17",
    file: "toile-17.png",
    name: "Toile 28",
    hint: "15 couleurs, 5 rares, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 15,
      rareColors: 5,
      buriedAtStart: 0,
      rating: 3,
    },
  },
  {
    id: "toile-07",
    file: "toile-07.png",
    name: "Toile 29",
    hint: "15 couleurs, 9 rares, rien d'enterré",
    parMs: null,
    difficulty: {
      paletteSize: 15,
      rareColors: 9,
      buriedAtStart: 0,
      rating: 3,
    },
  },
  {
    id: "toile-50",
    file: "toile-50.png",
    name: "Toile 30",
    hint: "16 couleurs, 2 rares, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 2,
      buriedAtStart: 1,
      rating: 3,
    },
  },
  {
    id: "toile-10",
    file: "toile-10.png",
    name: "Toile 31",
    hint: "13 couleurs, 10 rares, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 13,
      rareColors: 10,
      buriedAtStart: 1,
      rating: 3,
    },
  },
  {
    id: "toile-15",
    file: "toile-15.png",
    name: "Toile 32",
    hint: "16 couleurs, 2 rares, 2 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 2,
      buriedAtStart: 2,
      rating: 3,
    },
  },
  {
    id: "toile-55",
    file: "toile-55.png",
    name: "Toile 33",
    hint: "16 couleurs, 2 rares, 2 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 2,
      buriedAtStart: 2,
      rating: 3,
    },
  },
  {
    id: "toile-33",
    file: "toile-33.png",
    name: "Toile 34",
    hint: "7 couleurs, 4 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 0,
      buriedAtStart: 4,
      rating: 3,
    },
  },
  {
    id: "toile-46",
    file: "toile-46.png",
    name: "Toile 35",
    hint: "7 couleurs, 4 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 0,
      buriedAtStart: 4,
      rating: 3,
    },
  },
  {
    id: "toile-39",
    file: "toile-39.png",
    name: "Toile 36",
    hint: "7 couleurs, 6 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 7,
      rareColors: 0,
      buriedAtStart: 6,
      rating: 3,
    },
  },
  {
    id: "toile-29",
    file: "toile-29.png",
    name: "Toile 37",
    hint: "8 couleurs, 2 rares, 6 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 8,
      rareColors: 2,
      buriedAtStart: 6,
      rating: 3,
    },
  },
  {
    id: "toile-30",
    file: "toile-30.png",
    name: "Toile 38",
    hint: "8 couleurs, 7 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 8,
      rareColors: 0,
      buriedAtStart: 7,
      rating: 3,
    },
  },
  {
    id: "toile-23",
    file: "toile-23.png",
    name: "Toile 39",
    hint: "9 couleurs, 2 rares, 7 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 9,
      rareColors: 2,
      buriedAtStart: 7,
      rating: 3,
    },
  },
  {
    id: "toile-28",
    file: "toile-28.png",
    name: "Toile 40",
    hint: "10 couleurs, 1 rare, 8 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 10,
      rareColors: 1,
      buriedAtStart: 8,
      rating: 3,
    },
  },
  {
    id: "toile-43",
    file: "toile-43.png",
    name: "Toile 41",
    hint: "11 couleurs, 1 rare, 10 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 11,
      rareColors: 1,
      buriedAtStart: 10,
      rating: 3,
    },
  },
  {
    id: "toile-51",
    file: "toile-51.png",
    name: "Toile 42",
    hint: "12 couleurs, 11 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 12,
      rareColors: 0,
      buriedAtStart: 11,
      rating: 3,
    },
  },
  {
    id: "toile-02",
    file: "toile-02.png",
    name: "Toile 43",
    hint: "16 couleurs, 11 rares, 1 enterrée",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 11,
      buriedAtStart: 1,
      rating: 4,
    },
  },
  {
    id: "toile-01",
    file: "toile-01.png",
    name: "Toile 44",
    hint: "16 couleurs, 10 rares, 3 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 10,
      buriedAtStart: 3,
      rating: 4,
    },
  },
  {
    id: "toile-12",
    file: "toile-12.png",
    name: "Toile 45",
    hint: "14 couleurs, 5 rares, 4 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 14,
      rareColors: 5,
      buriedAtStart: 4,
      rating: 4,
    },
  },
  {
    id: "toile-32",
    file: "toile-32.png",
    name: "Toile 46",
    hint: "13 couleurs, 6 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 13,
      rareColors: 0,
      buriedAtStart: 6,
      rating: 4,
    },
  },
  {
    id: "toile-18",
    file: "toile-18.png",
    name: "Toile 47",
    hint: "14 couleurs, 5 rares, 9 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 14,
      rareColors: 5,
      buriedAtStart: 9,
      rating: 4,
    },
  },
  {
    id: "toile-52",
    file: "toile-52.png",
    name: "Toile 48",
    hint: "10 couleurs, 6 rares, 9 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 10,
      rareColors: 6,
      buriedAtStart: 9,
      rating: 4,
    },
  },
  {
    id: "toile-31",
    file: "toile-31.png",
    name: "Toile 49",
    hint: "13 couleurs, 4 rares, 12 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 13,
      rareColors: 4,
      buriedAtStart: 12,
      rating: 4,
    },
  },
  {
    id: "toile-42",
    file: "toile-42.png",
    name: "Toile 50",
    hint: "16 couleurs, 4 rares, 13 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 4,
      buriedAtStart: 13,
      rating: 4,
    },
  },
  {
    id: "toile-41",
    file: "toile-41.png",
    name: "Toile 51",
    hint: "16 couleurs, 5 rares, 14 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 5,
      buriedAtStart: 14,
      rating: 4,
    },
  },
  {
    id: "toile-45",
    file: "toile-45.png",
    name: "Toile 52",
    hint: "16 couleurs, 6 rares, 15 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 6,
      buriedAtStart: 15,
      rating: 5,
    },
  },
  {
    id: "toile-49",
    file: "toile-49.png",
    name: "Toile 53",
    hint: "16 couleurs, 6 rares, 15 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 6,
      buriedAtStart: 15,
      rating: 5,
    },
  },
  {
    id: "toile-54",
    file: "toile-54.png",
    name: "Toile 54",
    hint: "16 couleurs, 6 rares, 15 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 6,
      buriedAtStart: 15,
      rating: 5,
    },
  },
  {
    id: "toile-35",
    file: "toile-35.png",
    name: "Toile 55",
    hint: "16 couleurs, 9 rares, 15 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 9,
      buriedAtStart: 15,
      rating: 5,
    },
  },
  {
    id: "toile-44",
    file: "toile-44.png",
    name: "Toile 56",
    hint: "16 couleurs, 12 rares, 15 enterrées",
    parMs: null,
    difficulty: {
      paletteSize: 16,
      rareColors: 12,
      buriedAtStart: 15,
      rating: 5,
    },
  },
];

/**
 * Ce qui rend *cette* toile-ci difficile — pas à quel point, mais en quoi.
 *
 * Trois images peuvent partager une note et ne rien avoir en commun à jouer :
 * seize couleurs franches se décapent, huit couleurs dont six enterrées se
 * déterrent. C'est la distinction qu'une note scalaire écrase.
 */
export type CampaignCharacter = "palette" | "rares" | "enterrees";

export function characterOf(image: CampaignImage): CampaignCharacter {
  const d = image.difficulty;
  if (!d) return "palette";
  // Les mêmes poids que la note : le caractère est le terme qui pèse le plus.
  const palette = (Math.min(1, Math.max(0, d.paletteSize - 4) / 14)) * 0.35;
  const rares = Math.min(1, d.rareColors / 8) * 0.25;
  const buried = Math.min(1, d.buriedAtStart / 5) * 0.4;
  if (buried >= palette && buried >= rares) return "enterrees";
  return rares > palette ? "rares" : "palette";
}

/** Combien une toile pèse, pour départager à caractère égal. */
function weight(image: CampaignImage): number {
  const d = image.difficulty;
  if (!d) return Number.POSITIVE_INFINITY;
  return d.rating * 1000 + d.buriedAtStart * 10 + d.rareColors + d.paletteSize / 100;
}

/**
 * L'ordre de la campagne : une pente qui monte, mais qui change de sujet.
 *
 * Trier sur la seule note produisait douze premières toiles interchangeables —
 * cinq à huit couleurs, aucune enterrée, aucune différence perceptible d'une
 * partie à l'autre. Et « aucune enterrée » n'est pas un détail : à palette et
 * surface identiques, un plateau où sept couleurs sur huit sont enterrées se
 * finit en 40,7 minutes contre 9,9 — quatre fois plus long. Le joueur qui
 * ouvrait la campagne rencontrait donc douze fois le même exercice avant de
 * voir le facteur qui compte le plus.
 *
 * L'ordre alterne donc les caractères. À chaque pas on prend la toile la plus
 * douce dont le caractère diffère de la précédente, en s'autorisant à monter
 * d'un cran de note — pas plus, sinon ce n'est plus une pente. Une toile de
 * note 2 avec une couleur enterrée arrive ainsi en deuxième ou troisième
 * position, et le déterrage s'apprend pendant qu'il est encore doux.
 */
export function campaignByDifficulty(): CampaignImage[] {
  // Les non mesurées passent en fin plutôt qu'à une place supposée.
  const pool = [...CAMPAIGN].sort((a, b) => weight(a) - weight(b));
  const out: CampaignImage[] = [];
  const seen = new Set<CampaignCharacter>();
  let previous: CampaignCharacter | null = null;

  while (pool.length > 0) {
    const floor = pool[0].difficulty?.rating ?? Number.POSITIVE_INFINITY;
    // La fenêtre : la note du moment, et un cran au-dessus. Elle borne la
    // variété pour qu'alterner ne devienne jamais un saut de difficulté.
    const window = pool.filter((image) => (image.difficulty?.rating ?? Infinity) <= floor + 1);

    // Un caractère encore jamais rencontré passe avant un caractère simplement
    // différent : les trois façons dont une toile résiste doivent être vues
    // tant qu'elles sont douces, et le déterrage — celui qui coûte quatre fois
    // le temps d'une partie — est le dernier qu'on peut se permettre de
    // découvrir tard.
    const fresh = window.find((image) => !seen.has(characterOf(image)));
    const different = window.find((image) => characterOf(image) !== previous);
    const chosen = fresh ?? different ?? pool[0];

    out.push(chosen);
    previous = characterOf(chosen);
    seen.add(previous);
    pool.splice(pool.indexOf(chosen), 1);
  }

  return out;
}

/**
 * Ce que le joueur a fini, et jusqu'où la campagne lui est ouverte.
 *
 * Une campagne n'est pas une liste : c'est une pente, et une pente ne veut dire
 * quelque chose que si on ne peut pas la sauter. Mais un verrou trop strict
 * transforme une toile qui bloque en cul-de-sac — et une toile *peut* bloquer,
 * c'est même ce que la note à cinq mesure. D'où la règle : chaque toile finie
 * ouvre les **deux** suivantes. On avance en ligne droite, mais il y a toujours
 * un chemin de côté quand celle d'en face résiste.
 */
export const CAMPAIGN_LOOKAHEAD = 2;

export interface CampaignProgress {
  /** Les identifiants des toiles menées jusqu'au bout. */
  cleared: string[];
}

/** Les toiles jouables : celles finies, plus la marge que la dernière ouvre. */
export function unlockedCount(progress: CampaignProgress): number {
  // Deux ouvertes au départ, pour que le premier écran offre déjà un choix
  // plutôt qu'une seule porte.
  return Math.min(CAMPAIGN.length, CAMPAIGN_LOOKAHEAD + progress.cleared.length);
}

export interface CampaignEntry {
  image: CampaignImage;
  index: number;
  cleared: boolean;
  unlocked: boolean;
}

/** La campagne telle que l'écran doit la montrer : en ordre, avec ses verrous. */
export function campaignEntries(progress: CampaignProgress): CampaignEntry[] {
  const cleared = new Set(progress.cleared);
  const open = unlockedCount(progress);
  return campaignByDifficulty().map((image, index) => ({
    image,
    index,
    cleared: cleared.has(image.id),
    // Une toile finie reste ouverte même si elle sortait de la marge : on doit
    // pouvoir y retourner pour battre son temps.
    unlocked: index < open || cleared.has(image.id),
  }));
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
