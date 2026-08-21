# Un million de pixels

Prototype navigateur d'un idle/roguelite où une image importée devient un plateau
de **1 048 576 cellules** (1024 × 1024) à détruire couleur par couleur.

Le principe structurant : le million de pixels est **un tableau de données**, jamais
un million d'objets graphiques ou physiques. Aucun sprite, aucun collider, aucun
rigidbody par cellule.

```
npm install
npm run dev        # serveur de développement
npm test           # 101 tests unitaires
npm run build      # typecheck + build production
npm run e2e        # smoke test navigateur + benchmark (après npm run build)
```

## État du prototype

Le **vertical slice** décrit dans le plan de développement est complet et vérifié
en navigateur : importer une image → la quantifier → afficher le million de cellules
via une texture → faire orbiter un canon → détruire les bonnes couleurs → sauvegarder
→ revenir plus tard sur une image réellement rongée.

| Lot | État |
|---|---|
| Setup TypeScript / Vite / PixiJS + tests | fait |
| Drag & drop + validation fichier | fait |
| `image.worker` + OffscreenCanvas + resize | fait |
| Histogramme + Median Cut (+ k-means en option) | fait |
| Mapping `colorId` + comptages | fait |
| `PixelWorld` + `ColorIndex` (swap-delete O(1)) | fait |
| Texture R8 + shader palette | fait |
| Throttling des uploads | fait |
| Canon patrouillant le cadre | fait |
| Caméra : zoom molette/pincement, pan, vue d'ensemble | fait |
| Améliorations : 6 axes, panneau, économie en pixels détruits | fait |
| Habillage jeu portrait 430×932 (3 écrans) | fait |
| Parcours ligne/colonne à pas fixe | fait |
| Collision couleur + pierce/ricochet | fait |
| Deck généré depuis les comptages | fait |
| Cartes / upgrades / couleurs épuisées | fait |
| Batch destruction + LOD visuel | fait |
| IndexedDB + version de save + migrations | fait |
| `idle.worker` + RNG déterministe | fait |
| Suppression hors-ligne de vrais pixels | fait |
| UI stats chromatiques + milestones | fait |
| Octree, WebGPU, prestige, méta-progression | hors périmètre (P1+) |

## Architecture

Trois domaines indépendants : présentation, simulation, traitements lourds.

```
                        GAMEPLAY STATE
                              │
              ┌───────────────┴───────────────┐
              │                               │
   1 048 576 cellules                  économie / deck
   dans des TypedArrays                        │
              │                                │
              ├────────── combat exact ────────┤
              ├────────── batch idle ──────────┤
              ▼                                ▼
     destructions réelles              puissance logique
              └───────────────┬────────────────┘
                              │
                         VISUAL LOD
                              │
                 quelques centaines de VFX
                              │
                    1 texture R8 1024²
                              │
                       shader palette
                              │
                     PixiJS → WebGL2
```

| Thread | Contenu |
|---|---|
| Principal | `GameController`, `PixelWorld`, `ColorIndex`, `CombatSimulator`, rendu Pixi |
| `image.worker` | decode, resize OffscreenCanvas, histogramme, palette, remap |
| `idle.worker` | reprise hors-ligne analytique + suppression réelle de pixels |

Les gros buffers circulent en **transfert** (`postMessage` + transfer list), pas en copie.

## Décisions figées

| Sujet | Décision |
|---|---|
| Rendu | PixiJS v8 épinglé, `preference: "webgl"` (WebGL2) |
| WebGPU | hors MVP — spike seulement si le profilage le justifie |
| Résolution logique | 1024 × 1024, jamais réduite en fallback |
| Palette | 6 à 16 couleurs, `Uint8Array` d'identifiants |
| Valeurs réservées | `254 = VOID`, `255 = DEAD` |
| Rendu pixels | 1 texture `r8unorm` + shader palette, `scaleMode: nearest` |
| Physique | mathématique — parcours axial à pas fixe, aucun moteur physique |
| Tir | canon sur le cadre, perpendiculaire à son bord, une morsure par voie |
| Quantification | Median Cut déterministe par défaut, k-means Lab en option qualité |
| Dithering | désactivé — les couleurs portent une signification mécanique |
| Persistance | IndexedDB, save v6 versionnée, index dérivés non sauvegardés |
| Image source | jamais persistée (seul le niveau quantifié l'est) |
| PRNG | `xorshift32-v1`, versionné, jamais `Math.random()` |

### Mémoire

| Structure | Type | Mémoire |
|---|---|---:|
| `baseColorId`, `colorId`, `hp`, `flags` | `Uint8Array` ×4 | 4 MiB |
| `pixelsByColor`, `slotOfPixel` | `Uint32Array` ×2 | 8 MiB |
| Macro-tuiles 32×32 | `Uint16Array` | 32 KiB |
| Surface (4 sens × voies) | `Int16Array` | 8 KiB |
| Texture GPU R8 | — | ≈1 MiB |

Les 8 MiB d'index sont **dérivés** : reconstruits depuis `colorId` en O(N) au
chargement plutôt que stockés dans la save.

## Les points qui font marcher le prototype

**Swap-delete par couleur.** `ColorIndex` range les pixels vivants en segments
contigus par couleur, avec la permutation inverse. Détruire un pixel, ou en tirer
un au hasard dans une couleur, est O(1). Rien ne parcourt jamais le million de
cellules pour chercher une cible rouge.

**Canon sur le cadre, tir sur une seule voie.** Le canon patrouille le bord de
l'image et tire toujours perpendiculairement à son côté : une rafale reste dans
une seule ligne ou une seule colonne. Le parcours se réduit alors à un balayage à
pas fixe — l'index de cellule avance d'une constante (±1 sur une ligne, ±1024 sur
une colonne), sans flottant ni terme incrémental dans la boucle.

**Le rail est l'horloge.** Chaque voie franchie est une occasion de traitement :
le travail d'un canon vaut exactement la distance qu'il a parcourue. Il n'y a plus
de cadence. Une cadence fixe plafonnait la production à `1000 / intervalle` quelle
que soit la vitesse — l'amélioration « Vitesse » n'achetait alors aucun débit, elle
faisait seulement sauter plus de voies (1 sur 36 au niveau 0, 1 sur 137 au niveau 8).
`crossedLanes()` énumère les positions entières de `[from, from + distance)`, un
intervalle semi-ouvert : les voies se pavent exactement, sans doublon ni oubli, et
30, 60 ou 120 FPS sur le même temps simulé visitent les mêmes voies.

**Morsure de ligne.** Une voie dont la surface expose la couleur du canon perd
la cellule qui lui fait face — **une seule**, `BITE_DEPTH = 1`. Le canon lime le
contour au passage au lieu de forer dedans : au-delà de quelques cellules par
voie, le plateau cesse d'être rongé par les bords et se met à montrer de longues
entailles droites en travers de l'image, ce qui n'est pas ce à quoi le rail doit
ressembler. Le débit vient de franchir plus de voies — vitesse, canons, stock —
jamais de mordre plus profond. `SurfaceIndex.frontIndex()` donne la cellule
exposée en une lecture, donc rien ne balaye la voie. La règle fondamentale ne
bouge pas : **une munition détruit au plus un bloc**, et la première couleur
étrangère arrête la morsure sans jamais être détruite.

**Découplage morsure / spectacle.** Une morsure détruit instantanément : une bille
qui voyagerait *après* la disparition du pixel serait un mensonge visuel, donc il
n'y a plus de projectiles mobiles. `BurstRenderer` dessine des étincelles
échantillonnées par `VisualLODController`, et un **traceur** sur la voie
uniquement quand une morsure a emporté une vraie enfilade — au-delà de la
profondeur de base, où il ferait double emploi avec l'étincelle. Le budget
graphique ne peut plus jamais retenir un tir.

**Reprise hors-ligne réelle.** L'absence n'est pas rejouée frame par frame : la
production est intégrée analytiquement par couleur, la fraction résiduelle est
conservée d'une session à l'autre, et les hits résultants **suppriment de vrais
pixels** via l'index. On revient sur une image rongée, pas sur une jauge.

**La surface protège ce qu'il y a derrière.** Une rafale part de la première
cellule pleine de la voie, quelle qu'en soit la couleur : si c'est la sienne elle
la détruit et continue, sinon rien ne se passe. Seuls les trous laissés par les
rafales précédentes et les marges transparentes se traversent.

C'est ce qui donne du poids à la géométrie de l'image : ce qui est enterré est
inatteignable d'un côté tant que la façade tient, et un canon doit parfois faire le
tour du cadre — ou attendre qu'une autre couleur soit dégagée — avant d'avoir un tir.
`SurfaceIndex` répond en une lecture à « quelle cellule me fait face ? », donc le
canon ne dépense rien devant un mur. Un canon qui boucle un tour complet sans rien
peler quitte le rail : sans ça une couleur totalement enterrée immobiliserait un
slot à vie.

## Améliorations

L'image finance sa propre destruction : un pixel détruit vaut un fragment. Quatre
axes, achetés dans un panneau et appliqués immédiatement — y compris aux canons
déjà sur le rail, sans quoi un achat semblerait sans effet.

Douze axes, en quatre familles.

| Famille | Axe | Effet | Base → max | Paliers |
|---|---|---|---|---:|
| Rail | Vitesse | voies examinées par seconde | 260 → 2 426 | 150 |
| Rail | Rail | canons simultanés | 5 → 55 | 50 |
| Cases | Chargeur | munitions par case | 40 → 1 240 | 100 |
| Cases | Étal | cases proposées | 8 → 48 | 40 |
| Économie | Alliage | fragments par pixel | ×1 → ×7 | 120 |
| Économie | Veille | production hors-ligne | ×1 → ×7 | 80 |
| Tirs | Perce | chance d'atteindre sa couleur derrière un obstacle | 0 → 75 % | 60 |
| Tirs | Pointe | cellules étrangères traversées | 0 → 30 | 30 |
| Tirs | Éclat | chance d'emporter les voisins | 0 → 60 % | 60 |
| Tirs | Souffle | rayon de l'explosion | 0 → 20 | 20 |
| Tirs | Foudre | chance qu'un arc saute sur un voisin | 0 → 60 % | 60 |
| Tirs | Chaîne | sauts successifs de l'arc | 0 → 40 | 40 |

**Pistes longues, petits pas.** Chaque axe court sur dix fois plus de paliers
qu'à l'origine, chacun valant environ un dixième, avec un prix qui croît à la
racine dixième correspondante. Les plafonds finissent plus hauts, mais c'est un
effet de bord : ce qui compte est qu'il y ait toujours un palier suivant à
portée, et qu'aucun axe ne cesse discrètement d'être achetable au milieu d'un
passage. Tout maximiser coûte ~1,8 M de fragments sur une image d'un million de
pixels — soit environ deux passages.

**Vitesse est l'axe de production.** Depuis que le rail est l'horloge, voies par
seconde *est* le débit.

**Les tirs spéciaux vont par paire** : une chance et une puissance. La chance dit
à quelle fréquence le passage fait autre chose, la puissance dit jusqu'où il va.
Acheter la puissance sans la chance ne sert à rien — c'est le choix qui est
proposé.

**Chaque bloc qu'un effet retire coûte une munition.** Ce n'est pas une
restriction ajoutée après coup : le grand livre dit `queued + active <= alive`,
donc une couleur ne peut jamais se voir promettre plus de munitions qu'elle n'a
de pixels. Un effet qui détruirait gratuitement placerait durablement le grand
livre au-dessus du plateau, et le jeu distribuerait des canons pour des couleurs
qui n'existent plus. Les effets rendent un **passage** plus productif, jamais une
munition.

**Perce se déclenche sur une voie bloquée**, pas après une bouchée réussie :
traverser ce qui est devant est toute sa raison d'être, et le tirer seulement
après un tir réussi en aurait fait la seule spécialisation qui n'aide jamais
quand on en a besoin. Il regarde au-delà d'un nombre borné de cellules
étrangères et prend la première cellule de sa couleur derrière — **sans jamais
détruire ce qu'il a traversé**.

## Ce qui survit à une image

Les améliorations sont volontairement liées à une toile : une nouvelle image doit
repartir des valeurs de base, sinon la première passe de chaque image après la
première serait finie avant d'avoir commencé. Restait à donner un intérêt à
terminer une toile — ce sont les **éclats**.

| Permanent | Effet |
|---|---|
| Héritage | fragments offerts au début de chaque image |
| Élan | fragments par pixel, sur toutes les images |
| Socle | canons simultanés dès le départ |
| Somnambule | production hors-ligne, sur toutes les images |
| Trieuse | filtrer et trier les cases par couleur |
| Automate | lancer les cases toutes seules dès qu'un slot se libère |

Les éclats sont proportionnels à l'image (`playablePixels / 50 000`) et
augmentent avec le numéro de passage, donc une image dense vaut plus qu'un logo
transparent et une deuxième passe rapporte encore, moins mais pas rien. Ils sont
rangés dans le magasin de réglages, pas dans une sauvegarde de niveau, parce que
c'est exactement ce qu'ils sont : de l'état de profil.

**Trieuse et Automate se gagnent** au lieu d'être donnés. Ils ne veulent dire
quelque chose que pour quelqu'un qui a déjà fini une toile et sait ce qui est
pénible dans la suivante : chercher la couleur goulot parmi huit offres au
hasard, et cliquer la même case quelques centaines de fois. Tant qu'ils ne sont
pas achetés, la rangée n'existe pas et une première passe garde sa forme.

`blastRadius` reste une option de `CombatSimulator` par défaut à zéro : c'est le
point d'accroche du futur système d'effets, pas un axe achetable.

La portée est le niveau : une nouvelle image repart des valeurs de base, et rien
n'exige de méta-progression. **Tous les prix et paliers sont des valeurs
d'ouverture à équilibrer.**

## Finir une image, en changer, recommencer

**Achèvement automatique à 99,9 %.** La dernière fraction de millième est la
pire partie du jeu et celle qui bloque : ce qui reste tient en quelques dizaines
de pixels, souvent enterrés, et trop peu nombreux pour financer un canon. Passé
le seuil, la partie prend la main — un canon par couleur encore debout, sans
stock, sans délai d'abandon, à une vitesse de rail qu'aucune amélioration
n'atteint. Ils font ce que fait n'importe quel canon : franchir des voies et
peler celles dont la surface correspond. Rien n'est jamais supprimé hors d'une
voie, `destroyRandomOfColor()` reste interdit en combat. Seule l'économie de
munitions est abandonnée, parce qu'à ce stade il n'en reste plus à respecter.

**Trois sorties**, dans le menu de la barre du haut :

| Action | Quand | Ce qu'il advient |
|---|---|---|
| Passage suivant | plateau vide | l'image revient entière, tout ce qui a été acheté reste |
| Recommencer l'image | à tout moment | plateau entier, améliorations et fragments à zéro |
| Changer d'image | à tout moment | la partie est sauvegardée et mise de côté, jamais supprimée |

La remise à zéro totale du redémarrage n'est pas une punition : un pixel détruit
vaut un fragment, donc garder ses achats ferait du redémarrage une façon de
farmer les mêmes pixels indéfiniment. Le compteur de passages, lui, ne bouge que
sur une vraie fin de niveau.

`PixelWorld.restart()` reconstruit le niveau depuis `baseColorId`, porté depuis
le premier commit exactement pour ça : l'image d'origine ne quitte jamais la
mémoire, donc recommencer coûte une copie et aucun ré-import.

## Écrans

La mise en page de référence est un téléphone de 430 × 932, et elle le reste : sur
un bureau, les mêmes panneaux passent dans une colonne à côté du plateau au lieu
d'être réempilés en autre chose.

**Aucun téléphone réel ne fait 932 de haut** — une barre d'URL coûte à elle seule
une centaine de pixels, et un appareil de 360 × 600 en perd un tiers. Dans une
colonne flex ordinaire, tout enfant se rétracte par défaut, et c'étaient les
cases qui cédaient : `#cards` s'écrasait à dix pixels pendant que ses tuiles
gardaient leurs soixante-treize et débordaient sous les boosters, voire hors de
l'écran. Elles restaient dans le DOM avec une boîte de clic, donc rien n'avait
l'air cassé et rien n'était cliquable. Rien au-dessus du plateau ne se rétracte
plus, et sous 820 px de haut la pile se compacte — blocs de couleurs masqués,
marges et tuiles resserrées — au lieu de voler sa place au plateau, qui garde un
plancher de 190 px et cesse d'être carré. Le smoke le vérifie là où ça compte :
au centre de la tuile, est-ce la tuile que le doigt touche, et ce point est-il à
l'écran. Le plateau prend tout le reste, ce qui est
l'intérêt d'un grand écran — un million de cellules obtient enfin les pixels pour
être regardé. La caméra se moque de la forme : `Viewport.setArea` reçoit le
rectangle que la zone de jeu occupe réellement, et la mise en page pousse la
nouvelle taille au redimensionnement plutôt que de laisser le renderer la
sonder.

`npm run shot -- out.png 1440 900` conduit un vrai navigateur jusqu'à un état
jouable et écrit un PNG : la mise en page est la seule partie du projet qu'aucune
assertion ne couvre, et une grille qui s'applique techniquement peut quand même
mettre huit offres en colonnes hautes comme le plateau.

## Mesures

Relevées par `npm run e2e` (Chromium **swiftshader**, rendu logiciel — le FPS est
limité par le rasterizer, pas par la simulation) :

| Métrique | Régime exact | Régime agrégé |
|---|---:|---:|
| Impacts logiques/s | ~280 | **34 000 – 37 000** |
| Impacts visuels/s | ~280 | ~880 (budget 900) |
| Ratio logique : visuel | 1 : 1 | **1 : 35** |
| Temps de simulation | 0,19 ms/frame | 0,36 ms/frame |

Occasions de tir par seconde, avant et après la suppression de la cadence :

| Vitesse | Avant (cadence 140 ms) | Après (le rail est l'horloge) |
|---|---:|---:|
| niv. 0 — 260 c/s | 7,1 | **260** |
| niv. 5 — 382 c/s | 7,1 | **382** |
| niv. 10 — 561 c/s | 7,1 | **561** |
| niv. 15 — 825 c/s | 7,1 | **825** |

Le plafond réel s'est déplacé : ce n'est plus la cadence mais les **munitions**.
Cinq canons de 40 coups vident leur stock en une poignée de voies dès que l'image
présente des aplats, si bien que le débit se règle désormais sur Chargeur et Rail
autant que sur Vitesse. C'est le bon problème à avoir — il est dans l'économie, pas
dans une constante de boucle.

Le budget de simulation visé est ≤ 4 ms/frame ; la boucle en consomme moins de 0,4 ms
même à 35 000 impacts logiques par seconde. Ces chiffres restent des mesures sur une
cible logicielle, à refaire sur du matériel réel et sur mobile.

## Tests

101 tests unitaires (`npm test`) couvrant les invariants qui cassent silencieusement :

- **Quantification** — image monochrome → 1 couleur, pas de centroïde fantôme,
  `sum(counts) + void === 1 048 576`, déterminisme entre deux exécutions.
- **Parcours axial** — ordre des cellules dans les deux sens, index linéaire à pas
  constant, bornes clampées, segment hors plateau, voie invalide, absorption.
- **Canon / voies** — les quatre bords couverts, tir toujours perpendiculaire,
  salve décalée sur des voies parallèles et clampée aux coins, occupancy sans
  balayage, pas de sous-dépassement de compteur.
- **ColorIndex** — `pixelsByColor[slotOfPixel[p]] === p` après 100 000 destructions
  aléatoires, double destruction refusée, VOID jamais détruit.
- **Hors-ligne** — 8 h en une reprise ≡ 8 × 1 h avec carry et RNG préservés, sortie
  identique octet par octet à entrées identiques, plafond d'absence, horloge reculée.
- **RNG** — séquence golden verrouillée (la changer invalide toutes les saves).
- **Deck** — chaque couleur présente obtient au moins une carte, allocation exacte
  par largest remainder, couleur dominante tempérée.
- **Persistance** — round-trip octet par octet, migration v1→v2 du canon orbital
  vers le canon de bord, saves corrompues.

`npm run e2e` couvre en plus ce que les tests unitaires ne peuvent pas atteindre :
le chemin de rendu réel (texture R8, shader palette, packing des particules) et les
mesures de débit ci-dessus.

## Ce qui reste ouvert

Tous les chiffres de gameplay — vitesse du rail, taille du deck, valeurs d'upgrade,
seuils de milestones, plafond hors-ligne — sont des **valeurs initiales de conception
à mesurer et ajuster**, pas des spécifications. Le prototype existe précisément pour
savoir combien de temps il est réellement agréable de regarder un million de pixels
se faire ronger.

Hors périmètre pour l'instant : quantification octree, backend WebGPU compute,
prestige élaboré, recoloration massive, portage mobile mesuré, corpus QA d'images
complet.
