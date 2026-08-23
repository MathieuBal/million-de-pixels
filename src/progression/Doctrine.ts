import type { UpgradeEffects } from "./Upgrades";

/**
 * La doctrine d'une toile : ce qu'on accepte de perdre pour ce qu'on gagne.
 *
 * Mesuré sur deux cents toiles, trois façons opposées de dépenser l'arbre
 * permanent finissent à moins d'un pour cent l'une de l'autre. Sept nœuds qui
 * multiplient chacun quelque chose ne font pas sept choix : ils font un seul
 * curseur peint sept fois, et l'ordre dans lequel on le pousse n'a pas
 * d'importance. Un arbre sans décision n'est pas un arbre.
 *
 * Ce qui fabrique une décision, ce n'est pas un bonus de plus — c'est un
 * renoncement. Une doctrine se choisit **avant** une toile et vaut pour toute
 * sa durée : elle donne franchement et retire franchement, on ne peut pas en
 * prendre deux, et laquelle est la bonne dépend de l'image qu'on a en face.
 * Une affiche de trois aplats énormes ne se joue pas comme une photo de seize
 * teintes minuscules.
 *
 * C'est aussi ce qui relie enfin les trois systèmes : la galerie garde le
 * meilleur temps, et « meilleur temps sur cette image » cesse d'être une
 * question de patience pour devenir une question de doctrine.
 */
export type DoctrineId = "franche" | "meule" | "fonte" | "essaim";

export interface DoctrineDefinition {
  id: DoctrineId;
  label: string;
  glyph: string;
  /** Ce qu'elle donne, en une ligne. */
  gain: string;
  /** Une seconde ligne de gain, quand une seule ne suffit pas à la décrire. */
  gain2?: string;
  /** Ce qu'elle retire, en une ligne. Vide pour la doctrine franche. */
  cost: string;
  /** À quelle image elle va — la seule aide de lecture qui compte. */
  suits: string;
  speedMultiplier: number;
  ammoMultiplier: number;
  extraCannons: number;
  /** Ce qu'un pixel détruit rapporte. Le seul coût qui ne touche pas au rail. */
  fragmentMultiplier: number;
  /** Le délai de l'automate. Sans lui, des emplacements de plus restent vides. */
  autoLaunchMultiplier: number;
}

export const DOCTRINES: DoctrineDefinition[] = [
  {
    id: "franche",
    label: "Franche",
    glyph: "—",
    gain: "Aucun réglage",
    cost: "",
    suits: "quand on ne sait pas encore ce que l'image demande",
    speedMultiplier: 1,
    ammoMultiplier: 1,
    extraCannons: 0,
    fragmentMultiplier: 1,
    autoLaunchMultiplier: 1,
  },
  {
    id: "meule",
    label: "Meule",
    glyph: "⌁",
    gain: "+35 % de vitesse de rail",
    cost: "−30 % de billes par case",
    suits: "les images dont beaucoup de couleurs affleurent",
    speedMultiplier: 1.35,
    ammoMultiplier: 0.7,
    extraCannons: 0,
    fragmentMultiplier: 1,
    autoLaunchMultiplier: 1,
  },
  {
    id: "fonte",
    label: "Fonte",
    glyph: "◲",
    gain: "+60 % de billes par case",
    cost: "−20 % de vitesse de rail",
    suits: "les grands aplats, et les mains qui tapent lentement",
    speedMultiplier: 0.8,
    ammoMultiplier: 1.6,
    extraCannons: 0,
    fragmentMultiplier: 1,
    autoLaunchMultiplier: 1,
  },
  {
    id: "essaim",
    label: "Essaim",
    glyph: "+3",
    gain: "+3 canons sur le rail",
    // Le coût ne peut toucher ni les billes ni la vitesse, et les deux ont été
    // mesurés. En billes : un canon dépense son chargeur puis quitte le rail,
    // donc amputer les billes raccourcit sa vie — 0,92 s, 2,3 canons tenus sur
    // les 8 emplacements que la doctrine vient d'acheter. En vitesse : c'est le
    // débit lui-même qu'on ampute, précisément dans le régime où les
    // emplacements paieraient. Les deux versions n'étaient premières à aucun
    // tempo, et la seconde finissait dernière sur seize couleurs — l'image même
    // que sa fiche promettait.
    //
    // Le seul coût qui ne combat pas son propre gain est celui qui ne touche
    // pas au rail : Essaim détruit large et vite, mais chaque pixel rapporte
    // moins. Aller large se paie en économie, pas en puissance.
    gain2: "et l'automate lance 40 % plus vite",
    cost: "−25 % de fragments par pixel",
    suits: "les palettes larges, quand on a déjà de quoi acheter",
    speedMultiplier: 1,
    ammoMultiplier: 1,
    extraCannons: 3,
    fragmentMultiplier: 0.75,
    // Sans ça les trois emplacements restent vides, et c'est mesuré trois fois :
    // à 400 ms entre deux lancements le rail ne tient qu'environ trois canons,
    // quel que soit le nombre d'emplacements achetés. Une doctrine qui vend de
    // la largeur doit vendre de quoi la remplir, sinon son gain est inerte et
    // seul son coût se voit.
    autoLaunchMultiplier: 0.6,
  },
];

export const DOCTRINE_BY_ID = new Map(DOCTRINES.map((d) => [d.id, d]));

export const DEFAULT_DOCTRINE: DoctrineId = "franche";

/** Une doctrine inconnue — sauvegarde d'une autre version — retombe à franche. */
export function doctrineOf(id: string | null | undefined): DoctrineDefinition {
  return DOCTRINE_BY_ID.get((id ?? DEFAULT_DOCTRINE) as DoctrineId) ?? DOCTRINE_BY_ID.get("franche")!;
}

/**
 * Applique une doctrine aux effets de la boutique.
 *
 * Multiplicative sur ce que le joueur a acheté plutôt qu'additive sur la base :
 * une doctrine oriente une partie, elle ne la remplace pas, et son coût doit
 * grandir avec ce qu'elle ampute — sinon un −30 % de billes devient indolore
 * dès que Chargeur est monté.
 */
export function applyDoctrine(effects: UpgradeEffects, doctrine: DoctrineDefinition): UpgradeEffects {
  return {
    ...effects,
    moveSpeed: Math.max(1, Math.round(effects.moveSpeed * doctrine.speedMultiplier)),
    ammoPerLoad: Math.max(1, Math.round(effects.ammoPerLoad * doctrine.ammoMultiplier)),
    maxActiveCannons: Math.max(1, effects.maxActiveCannons + doctrine.extraCannons),
    fragmentsPerPixel: effects.fragmentsPerPixel * doctrine.fragmentMultiplier,
    autoLaunchMs:
      effects.autoLaunchMs === null
        ? null
        : Math.round(effects.autoLaunchMs * doctrine.autoLaunchMultiplier),
  };
}
