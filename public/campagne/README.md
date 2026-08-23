# Images de campagne

Dépose les fichiers image **ici**. C'est tout ce qu'il y a à faire côté fichiers.

Ce dossier est servi tel quel : `public/campagne/affiche.png` est accessible à
`/campagne/affiche.png`, et le jeu la charge par ce chemin.

> Ce README n'est pas décoratif : git ne suit pas les dossiers vides, donc sans
> un fichier dedans le dossier n'existe pas dans le dépôt et personne ne le
> voit. C'est ce qui s'est passé la première fois.

## Formats

PNG, JPG, WebP — tout ce qu'un navigateur décode. La taille n'a pas
d'importance : le cadrage s'en charge, et le plateau fait 1024 × 1024, donc
au-delà on ne gagne rien.

## Déclarer une image

Une ligne dans `CAMPAIGN`, dans `src/progression/Campaign.ts` :

```ts
{
  id: "01-spirale-violette",
  file: "spirale-violette.png",
  name: "Spirale violette",
  hint: "quatre nuances, des aplats énormes",
  parMs: null,
  difficulty: null,
}
```

`parMs` et `difficulty` restent à `null` : ils sont **mesurés**, pas écrits à la
main. Le temps de référence vient du simulateur, la difficulté du quantifieur —
nombre de couleurs, couleurs rares, et couleurs déjà enterrées sur le plateau
intact. Une campagne ordonnée par des difficultés supposées ordonnerait des
impressions.

## Ce qui fait une bonne image de campagne

La **palette** et la **disposition**, jamais la résolution. Mesuré : la même
surface prend 14,3 min à huit couleurs et 20,5 min à seize, à doctrine égale. Et
une image de grands aplats récompense Fonte là où une image finement découpée
récompense Meule — donc un pack qui varie ces deux caractères enseigne les
doctrines sans un mot d'explication.
