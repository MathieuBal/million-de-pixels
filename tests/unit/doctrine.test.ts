import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCTRINE,
  DOCTRINES,
  applyDoctrine,
  doctrineOf,
} from "../../src/progression/Doctrine";
import { UpgradeState } from "../../src/progression/Upgrades";

/** The shop as it stands after a few purchases: a doctrine bends this, not the base. */
function shop(): UpgradeState {
  const state = new UpgradeState({}, 1_000_000);
  state.buyMany("vitesse", 40);
  state.buyMany("munitions", 20);
  state.buyMany("canons", 5);
  return state;
}

describe("les doctrines", () => {
  it("donnent franchement et retirent franchement", () => {
    // Une doctrine sans renoncement n'est pas un choix, c'est un bonus — et
    // c'est exactement le défaut mesuré sur l'arbre permanent, où trois
    // stratégies opposées finissaient à moins d'un pour cent l'une de l'autre.
    for (const doctrine of DOCTRINES) {
      if (doctrine.id === DEFAULT_DOCTRINE) continue;

      // Tous les axes, y compris ceux ajoutés après coup : une doctrine qui
      // gagnerait sur une dimension que ce test ignore passerait pour gratuite.
      const gains =
        (doctrine.speedMultiplier > 1 ? 1 : 0) +
        (doctrine.ammoMultiplier > 1 ? 1 : 0) +
        (doctrine.extraCannons > 0 ? 1 : 0) +
        (doctrine.fragmentMultiplier > 1 ? 1 : 0) +
        // Un délai plus court est un gain : l'automate lance plus souvent.
        (doctrine.autoLaunchMultiplier < 1 ? 1 : 0);
      const costs =
        (doctrine.speedMultiplier < 1 ? 1 : 0) +
        (doctrine.ammoMultiplier < 1 ? 1 : 0) +
        (doctrine.extraCannons < 0 ? 1 : 0) +
        (doctrine.fragmentMultiplier < 1 ? 1 : 0) +
        (doctrine.autoLaunchMultiplier > 1 ? 1 : 0);

      expect(gains).toBeGreaterThan(0);
      expect(costs).toBeGreaterThan(0);
      expect(doctrine.cost).not.toBe("");
    }
  });

  it("laissent la doctrine franche exactement neutre", () => {
    const base = shop().effects();
    expect(applyDoctrine(base, doctrineOf("franche"))).toEqual(base);
  });

  it("s'appliquent sur ce qui a été acheté, pas sur la base", () => {
    // Un −30 % de billes doit rester un −30 % une fois Chargeur monté, sinon la
    // doctrine devient indolore au moment où elle devrait peser le plus.
    const base = shop().effects();
    const meule = applyDoctrine(base, doctrineOf("meule"));

    expect(meule.moveSpeed).toBe(Math.round(base.moveSpeed * 1.35));
    expect(meule.ammoPerLoad).toBe(Math.round(base.ammoPerLoad * 0.7));
    expect(base.ammoPerLoad).toBeGreaterThan(40); // Chargeur a bien été acheté
  });

  it("ne descendent jamais sous un rail jouable", () => {
    const bare = new UpgradeState().effects();
    for (const doctrine of DOCTRINES) {
      const bent = applyDoctrine(bare, doctrine);
      expect(bent.moveSpeed).toBeGreaterThanOrEqual(1);
      expect(bent.ammoPerLoad).toBeGreaterThanOrEqual(1);
      expect(bent.maxActiveCannons).toBeGreaterThanOrEqual(1);
    }
  });

  it("ne se ressemblent pas deux à deux", () => {
    // Le test qui compte : si deux doctrines produisent le même rail, il n'y a
    // pas de décision à prendre entre elles.
    const base = shop().effects();
    const shapes = DOCTRINES.map((d) => {
      const bent = applyDoctrine(base, d);
      return [
        bent.moveSpeed,
        bent.ammoPerLoad,
        bent.maxActiveCannons,
        bent.fragmentsPerPixel.toFixed(3),
        bent.autoLaunchMs,
      ].join("/");
    });
    expect(new Set(shapes).size).toBe(DOCTRINES.length);
  });

  it("retombent sur franche pour un identifiant inconnu", () => {
    // Une sauvegarde faite avec une autre liste ne doit pas casser une partie.
    expect(doctrineOf("doctrine-qui-n-existe-pas").id).toBe("franche");
    expect(doctrineOf(null).id).toBe("franche");
    expect(doctrineOf(undefined).id).toBe("franche");
  });
});
