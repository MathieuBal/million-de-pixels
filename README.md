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
| Tir | canon sur le cadre, perpendiculaire à son bord, une voie pelée d'un coup |
| Quantification | Median Cut déterministe par défaut, k-means Lab en option qualité |
| Dithering | désactivé — les couleurs portent une signification mécanique |
| Persistance | IndexedDB, save v5 versionnée, index dérivés non sauvegardés |
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

**Rafale de ligne.** Une voie dont la surface expose la couleur du canon est pelée
d'un coup, de la surface vers l'intérieur, jusqu'à l'obstacle ou l'épuisement des
munitions. `SurfaceIndex.frontIndex()` donne la cellule exposée en une lecture,
donc la rafale est O(blocs détruits) et rien ne balaye la voie. La règle
fondamentale ne bouge pas : **une munition détruit au plus un bloc**, et la
première couleur étrangère arrête la rafale sans jamais être détruite.

**Découplage rafale / spectacle.** Une rafale détruit instantanément : une bille qui
voyagerait *après* la disparition du pixel serait un mensonge visuel, donc il n'y a
plus de projectiles mobiles. `BurstRenderer` dessine un **traceur** sur la voie pelée
qui s'estompe, plus des étincelles échantillonnées par `VisualLODController`. Le
budget graphique ne peut plus jamais retenir un tir.

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

| Axe | Effet | Base | Paliers |
|---|---|---|---|
| Vitesse | voies examinées par seconde | 260 | 15 × +8 % (×3,17) |
| Rail | canons simultanés | 5 | |
| Chargeur | munitions par case | 40 | |
| Étal | cases proposées | 8 | |

**Vitesse est l'axe de production.** Depuis que le rail est l'horloge, voies par
seconde *est* le débit : 260 au niveau 0, 825 au niveau 15. Quinze paliers courts
plutôt que huit longs, pour que le joueur sente souvent la voie tourner plus vite.

`blastRadius` reste une option de `CombatSimulator` par défaut à zéro : c'est le
point d'accroche du futur système d'effets, pas un axe achetable.

La portée est le niveau : une nouvelle image repart des valeurs de base, et rien
n'exige de méta-progression. **Tous les prix et paliers sont des valeurs
d'ouverture à équilibrer.**

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
