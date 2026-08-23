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
  /** Ce qu'elle retire, en une ligne. Vide pour la doctrine franche. */
  cost: string;
  /** À quelle image elle va — la seule aide de lecture qui compte. */
  suits: string;
  speedMultiplier: number;
  ammoMultiplier: number;
  extraCannons: number;
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
  },
  {
    id: "essaim",
    label: "Essaim",
    glyph: "+3",
    gain: "+3 canons sur le rail",
    cost: "−25 % de billes par case",
    suits: "les palettes larges, où chaque couleur veut son canon",
    speedMultiplier: 1,
    ammoMultiplier: 0.75,
    extraCannons: 3,
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
  };
}
