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
| Canon orbital | fait |
| Clip segment + DDA | fait |
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
| Physique | mathématique — DDA 2D, aucun moteur physique |
| Quantification | Median Cut déterministe par défaut, k-means Lab en option qualité |
| Dithering | désactivé — les couleurs portent une signification mécanique |
| Persistance | IndexedDB, save versionnée, index dérivés non sauvegardés |
| Image source | jamais persistée (seul le niveau quantifié l'est) |
| PRNG | `xorshift32-v1`, versionné, jamais `Math.random()` |

### Mémoire

| Structure | Type | Mémoire |
|---|---|---:|
| `baseColorId`, `colorId`, `hp`, `flags` | `Uint8Array` ×4 | 4 MiB |
| `pixelsByColor`, `slotOfPixel` | `Uint32Array` ×2 | 8 MiB |
| Macro-tuiles 32×32 | `Uint16Array` | 32 KiB |
| Texture GPU R8 | — | ≈1 MiB |

Les 8 MiB d'index sont **dérivés** : reconstruits depuis `colorId` en O(N) au
chargement plutôt que stockés dans la save.

## Les points qui font marcher le prototype

**Swap-delete par couleur.** `ColorIndex` range les pixels vivants en segments
contigus par couleur, avec la permutation inverse. Détruire un pixel, ou en tirer
un au hasard dans une couleur, est O(1). Rien ne parcourt jamais le million de
cellules pour chercher une cible rouge.

**Deux régimes de simulation.** À faible puissance, un tir logique est un projectile
simulé qui parcourt la grille en DDA. À forte puissance, la salve est convertie
directement en commandes de destruction et seuls quelques centaines d'impacts
représentatifs deviennent des VFX. C'est ce qui permet aux upgrades de continuer à
monter bien après que le renderer a cessé de pouvoir dessiner chaque bille.

**Reprise hors-ligne réelle.** L'absence n'est pas rejouée frame par frame : la
production est intégrée analytiquement par couleur, la fraction résiduelle est
conservée d'une session à l'autre, et les hits résultants **suppriment de vrais
pixels** via l'index. On revient sur une image rongée, pas sur une jauge.

**Traversée plutôt que rebond.** Une bille traverse les couleurs qui ne sont pas la
sienne (`foreignColorPolicy: "pass-through"`). C'est un paramètre de game design, pas
une contrainte technique — mais avec `bounce`, le premier pixel étranger absorbe le
tir et une bille ne peut jamais atteindre sa couleur au-delà du bord de l'image.

## Mesures

Relevées par `npm run e2e` (Chromium **swiftshader**, rendu logiciel — le FPS est
limité par le rasterizer, pas par la simulation) :

| Métrique | Régime exact | Régime agrégé |
|---|---:|---:|
| Impacts logiques/s | ~280 | **34 000 – 37 000** |
| Impacts visuels/s | ~280 | ~880 (budget 900) |
| Ratio logique : visuel | 1 : 1 | **1 : 35** |
| Temps de simulation | 0,19 ms/frame | 0,36 ms/frame |
| Projectiles simulés | ~95 | 0 (batché) |

Le budget de simulation visé est ≤ 4 ms/frame ; la boucle en consomme moins de 0,4 ms
même à 35 000 impacts logiques par seconde. Ces chiffres restent des mesures sur une
cible logicielle, à refaire sur du matériel réel et sur mobile.

## Tests

101 tests unitaires (`npm test`) couvrant les invariants qui cassent silencieusement :

- **Quantification** — image monochrome → 1 couleur, pas de centroïde fantôme,
  `sum(counts) + void === 1 048 576`, déterminisme entre deux exécutions.
- **DDA** — horizontal/vertical/diagonal, pentes faibles sans cellule sautée, coins
  exacts, segment nul, entrée depuis l'extérieur, pas de tunneling à grande vitesse.
- **ColorIndex** — `pixelsByColor[slotOfPixel[p]] === p` après 100 000 destructions
  aléatoires, double destruction refusée, VOID jamais détruit.
- **Hors-ligne** — 8 h en une reprise ≡ 8 × 1 h avec carry et RNG préservés, sortie
  identique octet par octet à entrées identiques, plafond d'absence, horloge reculée.
- **RNG** — séquence golden verrouillée (la changer invalide toutes les saves).
- **Deck** — chaque couleur présente obtient au moins une carte, allocation exacte
  par largest remainder, couleur dominante tempérée.
- **Persistance** — round-trip octet par octet, migrations, saves corrompues.

`npm run e2e` couvre en plus ce que les tests unitaires ne peuvent pas atteindre :
le chemin de rendu réel (texture R8, shader palette, packing des particules) et les
mesures de débit ci-dessus.

## Ce qui reste ouvert

Tous les chiffres de gameplay — cadence de tir, taille du deck, valeurs d'upgrade,
seuils de milestones, plafond hors-ligne — sont des **valeurs initiales de conception
à mesurer et ajuster**, pas des spécifications. Le prototype existe précisément pour
savoir combien de temps il est réellement agréable de regarder un million de pixels
se faire ronger.

Hors périmètre pour l'instant : quantification octree, backend WebGPU compute,
prestige élaboré, recoloration massive, portage mobile mesuré, corpus QA d'images
complet.
