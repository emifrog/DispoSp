import { describe, expect, it, vi } from "vitest";
import { paged, READ_FAILED } from "../src/lib/data-mapping";

/**
 * Un serveur de lecture pour de faux.
 *
 * `cap` est le plafond que le serveur s'impose, indépendamment de ce qu'on lui
 * demande : c'est exactement ce que fait PostgREST, et c'est ce qui rendait la
 * troncature invisible.
 */
function server(total: number, { cap = Infinity, count = true }: { cap?: number; count?: boolean } = {}) {
  const asked: [number, number][] = [];
  const all = Array.from({ length: total }, (_, i) => ({ i }));
  return {
    asked,
    page(from: number, to: number) {
      asked.push([from, to]);
      const size = Math.min(to - from + 1, cap);
      return Promise.resolve({ data: all.slice(from, from + size), error: null, count: count ? total : null });
    },
  };
}

describe("Lecture page par page", () => {
  it("s’arrête après une seule requête quand tout tient dans une page", async () => {
    const s = server(120);
    expect(await paged<{ i: number }>("essai", 500, s.page)).toHaveLength(120);
    expect(s.asked).toEqual([[0, 499]]);
  });

  it("ramène tout ce que la table contient, pas seulement la première page", async () => {
    const s = server(1023);
    const rows = await paged<{ i: number }>("disponibilités", 500, s.page);
    expect(rows).toHaveLength(1023);
    // Aucun trou, aucun doublon : c’est l’ordre stable qui le garantit côté SQL,
    // et le découpage sans recouvrement qui le garantit ici.
    expect(rows.map(r => r.i)).toEqual(Array.from({ length: 1023 }, (_, i) => i));
    expect(s.asked).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });

  /**
   * Le cas qui justifie le compte exact.
   *
   * Le serveur plafonne ses réponses plus bas que la page demandée. Une
   * implémentation qui conclut « page plus courte que demandé, donc terminé »
   * s’arrêterait à 100 lignes sur 260, et les présenterait comme le tout.
   */
  it("ne s’arrête pas sur une page écourtée par le serveur lui-même", async () => {
    const s = server(260, { cap: 100 });
    const rows = await paged<{ i: number }>("disponibilités", 500, s.page);
    expect(rows).toHaveLength(260);
    expect(rows.map(r => r.i)).toEqual(Array.from({ length: 260 }, (_, i) => i));
  });

  it("se rabat sur la taille de page quand le compte manque", async () => {
    const s = server(700, { count: false });
    expect(await paged<{ i: number }>("essai", 500, s.page)).toHaveLength(700);
  });

  it("échoue plutôt que de boucler quand une page n’avance plus", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Le serveur annonce mille lignes et n’en rend aucune : sans garde, la
    // boucle tournerait indéfiniment.
    const stuck = () => Promise.resolve({ data: [], error: null, count: 1000 });
    await expect(paged("disponibilités", 500, stuck)).rejects.toThrow(READ_FAILED);
    spy.mockRestore();
  });

  it("remonte l’échec d’une page, sans rendre les précédentes", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const flaky = (from: number, to: number) => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: Array.from({ length: 500 }), error: null, count: 900 });
      return Promise.resolve({ data: null, error: { message: "connexion perdue" }, count: null });
      void [from, to];
    };
    await expect(paged("disponibilités", 500, flaky)).rejects.toThrow(READ_FAILED);
    spy.mockRestore();
  });
});
