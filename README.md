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

**L'étal ne peut pas se figer.** Une case est découpée quand le plateau est
grand et garde le stock avec lequel elle l'a été ; le plateau rétrécit ensuite
sous elle. Sans garde-fou, les billes promises à l'étal convergent vers les
billes qui existent — mesuré à 90 % de toile nettoyée, étal amélioré à cent
cases : **100 910 billes engagées contre 102 049 pixels vivants**. Le générateur
ne peut alors plus rien tirer, l'offre cesse de tourner, et si les couleurs sur
lesquelles elle s'est figée sont enterrées derrière d'autres, la toile ne peut
plus être finie du tout — quatre-vingt-dix minutes sans une seule cellule
détruite, avec un million de pixels de munitions dans les cases.

Trois pièces le rendent impossible :

- **`QUEUE_SHARE = 0,5`** — l'étal ne peut jamais se voir promettre plus de la
  moitié d'une couleur vivante. Un canon déjà sur le rail n'est pas concerné : il
  dépense ses billes, il ne les stocke pas.
- **Le tirage connaît l'accessibilité.** Une couleur que rien n'expose garde un
  dixième de sa part — pas zéro, parce qu'elle est à une cellule près d'être
  tirable et qu'une file qui l'aurait oubliée mettrait plusieurs tirages à s'en
  apercevoir.
- **Une case périmée est redécoupée**, une par seconde : celle dont la couleur
  est enterrée, sinon celle dont le stock dépasse le plus ce qu'on lui donnerait
  aujourd'hui. Une par appel, parce que déplacer une case sous le doigt du joueur
  est le bug qu'on venait de corriger.

Et **l'Automate ne prend plus la première case**. Tard dans une toile certaines
couleurs sont enterrées ; un canon lancé sur l'une d'elles fait un tour complet,
ne détruit rien et revient. Un automate qui prenait toujours la case 1 envoyait
donc tous ses canons dans le même mur : sur une toile qu'un joueur qui tape au
hasard finit en 22 minutes, il en était encore à 86 % après trois heures, ayant
lancé les trois couleurs tirables exactement zéro fois dans les dix dernières
minutes. Il choisit une couleur que quelque chose expose, et ne retombe sur la
première case que si rien ne l'est. Après correction : **54 minutes**.

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

**Le canon est fait de la même matière que l'image.** Une case du sprite est une
case du plateau, à la même échelle, donc il ne peut pas jurer avec la toile
importée. Deux lectures doivent être gratuites : la **bande de couleur** en
travers du socle dit ce qu'il vise, et la **jauge** juste en dessous dit ce qui
reste — des segments qui s'éteignent, jamais un chiffre. Une munition n'est
dépensée que sur un pixel réellement mort, donc la jauge ne peut pas mentir sur
ce qui reste à peler.

Trois silhouettes selon le chargeur acheté : c'est le seul retour d'amélioration
qui n'a pas besoin d'un nombre. Le canon chevauche le rail — moitié dehors,
moitié sur la première rangée de la voie qu'il s'apprête à peler — et pivote
avec le côté qu'il longe. La rotation **ré-indexe la grille** au lieu
d'interpoler : un coin se franchit en une frame, sans orientation intermédiaire
qui étalerait les pixels. Une raie de 1 px court jusqu'à la première case solide
de la voie : c'est la seule lecture honnête de sa portée. Au-delà de douze
canons, les sprites se chevauchent en bouillie et le rail retombe sur des jetons
compacts — la bande de couleur seule, la seule lecture qui tienne à cette
densité.

**Le tir ordinaire est sec.** C'est 99 % de ce que le joueur voit : un flash
d'exactement une frame sur la case qui meurt, quatre éclats carrés d'une case
qui s'éteignent en 180 ms, et rien d'autre. Pas de traînée, pas de poussière,
pas de secousse. Au-delà de **400 impacts sur une frame**, les éclats cessent
d'être émis et le flash porte seul — un seuil dur, pas un budget à négocier : la
simulation a déjà tout résolu quand le rendu s'exécute, et elle n'attend jamais
une particule.

**Le spectacle est rationné à ce qui est rare.** Chaque spécialisation a sa forme,
et la forme vient de la simulation — seule elle sait quelles cases ont réellement
été prises, et dans quel ordre. Perce trace une raie fine à travers ce qu'il a
regardé par-dessus, sans rien laisser au bout : ce qu'il a traversé est toujours
debout et doit en avoir l'air. Éclat ouvre un anneau jusqu'au rayon réellement
atteint. Foudre allume sa polyligne un saut par frame. Incendie avance en front,
en braises qui gardent leur chaleur quelle que soit la couleur mangée.

La **secousse** est rationnée plus durement encore : un impact ordinaire ne
secoue jamais — à des centaines par seconde le plateau ne serait jamais immobile,
et un tremblement permanent n'est pas un effet mais un défaut. Elle est réservée
à un éclat qui tombe, à une couleur qui s'épuise, à la finale. Une demande ne
s'ajoute jamais à celle en cours : la plus forte gagne, deux éclats dans la même
frame ne secouent pas deux fois plus.

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

**En jeu, ça reste court** : six axes, trois familles. Les capacités et leurs
réglages vivent dans l'arbre entre les toiles, pas dans la boutique qu'on ouvre
toutes les trente secondes.

| Famille | Axe | Effet | Base → max | Paliers |
|---|---|---|---|---:|
| Rail | Vitesse | voies examinées par seconde | 260 → 2 426 | 150 |
| Rail | Rail | canons simultanés | 5 → 55 | 50 |
| Cases | Chargeur | munitions par case | 40 → 1 240 | 100 |
| Cases | Étal | cases proposées | 8 → 48 | 40 |
| Économie | Alliage | fragments par pixel | ×1 → ×7 | 120 |
| Économie | Veille | production hors-ligne | ×1 → ×7 | 80 |

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

**En jeu, la boutique montre une famille à la fois** — trois onglets, deux ou
trois axes à l'écran, jamais douze. Chaque ligne dit la valeur qu'elle a et
celle que l'achat donnerait, jamais un pourcentage abstrait, et la barre sous la
ligne est la progression sur la piste de l'axe. Un axe maxé reste en place,
éteint : « celui-là est fini » est une information.

L'arbre s'ouvre **branche par branche**, et il a trois sortes de nœud, parce
qu'ils répondent à trois questions différentes.

**`point` — une seule case qu'on fait monter, sans plafond.** Un cinquième de
pour cent à la fois, avec un prix qui monte *linéairement* : `base + points ×
pas`. Une courbe géométrique transformerait un nœud sans limite en nœud limité
au bout de vingt points, ce qui est exactement la forme que ça remplace. Cent
points de Fondation coûtent moins de vingt fois le premier.

| Fondations | Effet par point |
|---|---|
| Négoce | −0,2 % sur les prix en boutique |
| Fondation | +0,2 % vitesse de rail de départ |
| Atelier | +0,2 % munitions de départ |
| Élan | +0,2 % fragments par pixel |
| Prospecteur | +0,2 % éclats gagnés |
| Somnambule | +0,2 % production hors-ligne |
| Héritage | +400 fragments au début de chaque image |
| Mémoire | +0,2 % des niveaux repris (plafonné à 60 %) |
| Socle | +1 canon simultané |

**`unlock` — une porte.** Un seul niveau, cher, et il ouvre une branche. Un canon
ne perce pas, n'explose pas, n'arque pas et ne brûle pas tant que le profil ne
l'a pas payé une fois.

| Capacité | Prix | Ce qu'elle fait |
|---|---:|---|
| Perce | 100 ◆ | atteindre sa couleur derrière ce qui la couvre |
| Explosion | 140 ◆ | un disque de sa couleur autour du pixel abattu |
| Foudre | 180 ◆ | un arc qui saute de voisin en voisin |
| Feu | 240 ◆ | un incendie qui inonde la région de couleur |

**`stat` — un nœud `point` derrière une porte.** Rayon, rebonds, propagation,
chance de proc : les nombres qui ne veulent rien dire tant que la capacité
n'existe pas.

Un nœud verrouillé est **listé, pas caché**. Le cacher ne dit rien ; montrer la
porte dit « voici la prochaine chose à vouloir », et montrer un réglage derrière
une porte fermée dit à quoi la porte sert. Ce qu'un nœud verrouillé ne doit
jamais faire, c'est avoir l'air achetable — il annonce donc ce qui manque à la
place d'un prix, et garde son nom pour lui jusqu'à l'ouverture.

Les nœuds sans plafond affichent le **rang atteint** (`p. 34`), pas une barre :
il n'y a pas de maximum vers lequel la remplir.

L'arbre se rejoint depuis le bilan de fin d'image — le moment où on a des éclats
et une raison de penser à la toile suivante — ou depuis l'accueil d'import.

**Les trois effets doivent se ressembler le moins possible**, sinon c'est une
amélioration achetée trois fois. L'explosion estampe un disque sur l'image sans
regarder ce qu'il y a dessous ; la foudre marche en ligne fine le long de la
couleur ; le feu l'inonde — en largeur d'abord, de proche en proche, donc ce
qu'il laisse est la forme de la région elle-même, mangée depuis un point.

**Mémoire est la boucle longue.** Les axes sont liés à une image par nécessité,
et Mémoire est l'exception achetée à cette règle : un pourcentage des niveaux de
la dernière toile *terminée* est repris sur la suivante. Seule une vraie fin de
niveau met cet instantané à jour — un redémarrage ne le fait jamais, sans quoi il
suffirait de recommencer pour mettre un build en banque.

### Ce que vaut une toile

Quatre choses rendent une image difficile, et chacune est une ligne lisible sur
le panneau de fin plutôt qu'un nombre à croire sur parole :

| Ligne | Ce qu'elle mesure |
|---|---|
| Pixels détruits | `playablePixels / 50 000` — une photo dense vaut plus qu'un logo transparent |
| Palette | `1 + (couleurs − 6) × 0,10` — chaque couleur est une file, un canon et un goulot de plus |
| Couleurs rares | `1 + rares × 0,15` — celles qui se cachent derrière la façade d'une autre |
| Passage | `1 + (passage − 1) × 0,25` — revenir sur une image connue rapporte moins, jamais rien |

La ligne « couleurs rares » est ce qui donne enfin une valeur mécanique à la
préservation des micro-couleurs : une couleur descendue à une fraction de pour
cent est exactement celle qui bloque une partie derrière une autre, et c'est
précisément ce que la détection de palette a été construite pour garder.

Mesuré sur le poster de test — 8 couleurs, 589 824 px jouables, 5 couleurs rares :
`12 × 1,20 × 1,75 = 25 éclats`.

Ils sont rangés dans le magasin de réglages, pas dans une sauvegarde de niveau,
parce que c'est exactement ce qu'ils sont : de l'état de profil.

### Le nuancier

**Quatre mille quatre-vingt-seize teintes** — chaque canal ramené à l'un de seize
niveaux (`0x00`, `0x11`, … `0xFF`), donc une teinte d'ici est exactement une
notation CSS à trois chiffres écrite en toutes lettres : `#000000`, `#1166FF`,
`#FFEE33`. La taille *est* l'intérêt : un livre qu'une douzaine d'images
remplirait est une liste de courses ; un livre de cette taille est une raison
d'aller chercher une image dont on n'a jamais épuisé les couleurs. Une toile
porte huit à seize couleurs, donc elle déplace le compteur de quelques dixièmes
de pour cent — elle grignote la grille, elle ne la valide jamais.

Le cube se lit en **seize planches**, une par niveau de rouge, chacune un carré
de 16 × 16 en vert contre bleu. C'est ce qui empêche quatre mille pastilles
d'être un mur de bruit : une planche est une page, assez petite pour être finie,
et un trou dedans dit « va chercher une image plus chaude » comme aucun nombre ne
le ferait.

Les six niveaux de l'ancienne grille web-safe sont tous des multiples de `0x11`,
donc toute teinte cataloguée avant cet élargissement en est encore une. Rien
n'est perdu, aucune sauvegarde n'a besoin de migration — le même livre a
simplement plus de pages.

Une teinte est cataloguée quand une couleur qui s'y rattache est **épuisée
entièrement** — le seul moment d'une partie qui soit indiscutablement fini : la
case quitte l'étal, un goulot se résout, le compteur touche zéro et y reste.
Cataloguer chaque couleur dont un pixel a été pris remplirait la grille dans les
trente premières secondes de la première toile.

Chaque teinte paie **+0,05 % de fragments et de production hors-ligne**, à vie,
et chaque **planche terminée +2 %**. La bibliothèque est un relevé de travail
déjà fait : la payer en puissance de combat en ferait un deuxième arbre
d'améliorations sans aucun de ses choix. Cinquante images de jeu ordinaire
cataloguent quelques centaines de teintes, soit environ +15 % — à prendre, jamais
à courir après. Le cube plein vaudrait +205 %, et personne ne le verra : une
collection a plus besoin d'une dernière page que d'une page atteignable. Le
compte par teinte est volontairement trop petit pour se sentir une par une —
c'est la planche qui porte la collection, deux cent cinquante-six nuances
voisines et un nombre au bout.

Une planche se lit en seize colonnes, le carré qu'elle est : une ligne par niveau
de vert, le bleu qui court dessus, et un trou se voit comme un trou. La pastille
montre le **spécimen tel qu'il était sur le plateau**, pas la valeur de grille
sous laquelle il a été classé.

### Le confort se gagne

| Nœud | Prix | Ce qu'il retire de pénible |
|---|---:|---|
| Nuancier | 40 ◆ | la palette entière, avec les couleurs encore atteignables mises en évidence |
| Trieuse | 70 ◆ | filtrer les cases proposées sur une seule couleur |
| Automate | 110 ◆ | les cases partent toutes seules dès qu'un emplacement se libère |
| Emplette | 200 ◆ | achète l'amélioration la moins chère dès qu'elle est payable |

Aucun n'est donné : ils ne veulent dire quelque chose que pour quelqu'un qui a
déjà fini une toile et sait ce qui est pénible dans la suivante — chercher la
couleur goulot parmi huit offres au hasard, cliquer la même case des centaines de
fois, rouvrir la boutique toutes les trente secondes. Tant qu'ils ne sont pas
achetés, la rangée n'existe pas et une première passe garde sa forme.

**Le nuancier explique le problème central du jeu.** Une couleur peut être
vivante et inatteignable : enterrée derrière une autre de tous les côtés, elle
est ce qui bloque une partie, et rien nulle part ne le disait — le joueur voyait
un compteur qui refusait de descendre. `PixelWorld.reachableColors()` parcourt
les quatre sens d'approche de chaque voie et lit la cellule exposée, ce que
`SurfaceIndex` donne en une lecture : quatre mille lectures, pas un million.
Chaque couleur est alors *à portée*, *enterrée* ou *épuisée*.

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
plancher de 190 px et cesse d'être carré. 

**Un téléphone tenu de côté est un écran large et très court** : la pile
portrait n'y tient pas et ne se dégrade pas — les cases et les boosters
finissaient simplement sous le bord de l'écran, disposés et intouchables. Le
paysage reçoit donc la même mise en page côte à côte que le bureau, resserrée.

**`100%` se résout contre le viewport de *mise en page***, qui inclut la bande
derrière une barre d'URL rétractable : le bas de la page se retrouve sous la
barre du navigateur. La hauteur est en `100dvh`, qui suit ce qui est réellement
visible, avec le pourcentage en repli. Et comme la page est servie en
`viewport-fit=cover`, les encoches et l'indicateur d'accueil sont remboursés à
la main avec `env(safe-area-inset-*)`.

Le smoke conduit un navigateur tactile à quatre tailles — deux portraits courts,
deux paysages — et vérifie, **pour chaque contrôle à la fois**, ce qui compte :
en son centre, est-ce lui que `elementFromPoint` renvoie, ce point est-il à
l'écran, et sa cible fait-elle au moins 30 px. Un contrôle sorti d'une zone
défilante ne compte pas : un geste le ramène. Le plateau prend tout le reste, ce qui est
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
