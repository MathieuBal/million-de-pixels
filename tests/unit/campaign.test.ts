import { describe, expect, it } from "vitest";
import { CAMPAIGN, campaignByDifficulty, characterOf, rateDifficulty } from "../../src/progression/Campaign";

describe("rateDifficulty", () => {
  it("pèse le plus lourd ce qui fait qu'une toile coince", () => {
    // Une couleur enterrée dès le plateau intact est ce qui arrête une partie ;
    // une couleur de plus la fait seulement durer. La note doit le refléter.
    const buried = rateDifficulty({ paletteSize: 8, rareColors: 0, buriedAtStart: 5 });
    const wide = rateDifficulty({ paletteSize: 18, rareColors: 0, buriedAtStart: 0 });
    expect(buried.rating).toBeGreaterThan(wide.rating);
  });

  it("reste entre 1 et 5, même poussée à l'absurde", () => {
    expect(rateDifficulty({ paletteSize: 0, rareColors: 0, buriedAtStart: 0 }).rating).toBe(1);
    expect(rateDifficulty({ paletteSize: 999, rareColors: 999, buriedAtStart: 999 }).rating).toBe(5);
  });

  it("ne descend jamais quand une image devient plus dure", () => {
    let previous = 0;
    for (let n = 0; n <= 16; n++) {
      const rating = rateDifficulty({ paletteSize: n, rareColors: n, buriedAtStart: n }).rating;
      expect(rating).toBeGreaterThanOrEqual(previous);
      previous = rating;
    }
  });
});

describe("campaignByDifficulty", () => {
  it("range une toile non mesurée en fin de liste", () => {
    // Plutôt qu'à une place qu'on lui aurait supposée.
    const ordered = campaignByDifficulty();
    const unrated = ordered.findIndex((image) => image.difficulty === null);
    if (unrated >= 0) expect(unrated).toBe(ordered.length - 1);
  });
});


describe("les cinquante-six toiles mesurées", () => {
  it("sont toutes notées, et notées sur une mesure", () => {
    expect(CAMPAIGN.length).toBe(56);
    for (const image of CAMPAIGN) {
      expect(image.difficulty).not.toBeNull();
      // Une note doit venir des trois nombres relevés, pas d'une impression :
      // si elle ne se recalcule pas à l'identique, elle a été écrite à la main.
      const recomputed = rateDifficulty({
        paletteSize: image.difficulty!.paletteSize,
        rareColors: image.difficulty!.rareColors,
        buriedAtStart: image.difficulty!.buriedAtStart,
      });
      expect(image.difficulty!.rating).toBe(recomputed.rating);
    }
  });

  it("montent en difficulté sans jamais sauter un cran", () => {
    // La pente n'est plus une suite non décroissante : trier sur la seule note
    // donnait douze premières toiles interchangeables, toutes sans couleur
    // enterrée — le facteur qui vaut pourtant quatre fois la durée d'une
    // partie. L'ordre alterne donc les caractères. Ce qu'il doit garantir n'est
    // plus la monotonie mais l'absence de marche : jamais plus d'un cran
    // au-dessus de ce qui reste à jouer.
    const ordered = campaignByDifficulty();
    for (let i = 1; i < ordered.length; i++) {
      const floor = Math.min(...ordered.slice(i).map((image) => image.difficulty!.rating));
      expect(ordered[i].difficulty!.rating).toBeLessThanOrEqual(floor + 1);
    }
  });

  it("font rencontrer les trois caractères tant qu'ils sont doux", () => {
    // Une toile de seize couleurs franches et une de huit dont six enterrées ne
    // se jouent pas pareil. Les trois manières de résister doivent être vues
    // tôt, sinon la campagne enseigne une seule chose pendant douze parties.
    const first = campaignByDifficulty().slice(0, 5).map(characterOf);
    expect(new Set(first).size).toBe(3);
  });

  it("montent vraiment du début à la fin", () => {
    const ratings = campaignByDifficulty().map((image) => image.difficulty!.rating);
    const head = ratings.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const tail = ratings.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(tail).toBeGreaterThan(head + 2);
  });

  it("désignent des fichiers distincts", () => {
    // Deux entrées sur le même fichier feraient deux toiles identiques à des
    // places différentes de la campagne.
    expect(new Set(CAMPAIGN.map((i) => i.file)).size).toBe(CAMPAIGN.length);
    expect(new Set(CAMPAIGN.map((i) => i.id)).size).toBe(CAMPAIGN.length);
  });

  it("commencent doux et finissent rude", () => {
    // La pente est ce qui fait une campagne : sans elle, c'est une liste.
    const ordered = campaignByDifficulty();
    expect(ordered[0].difficulty!.rating).toBe(1);
    expect(ordered[ordered.length - 1].difficulty!.rating).toBe(5);
  });
});
