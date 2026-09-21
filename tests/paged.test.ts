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

  it("lance les pages suivantes ensemble, au lieu de les attendre l’une après l’autre", async () => {
    // Le compte dit d'avance où commence chaque page : elles peuvent donc
    // partir en même temps. C'est tout l'intérêt — quarante pages en file
    // indienne, c'est quarante allers-retours à chaque navigation.
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    const all = Array.from({ length: 3000 }, (_, i) => ({ i }));
    const page = (from: number, to: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const answer = { data: all.slice(from, to + 1), error: null, count: all.length };
      // La première page répond tout de suite ; les autres attendent qu'on les
      // libère, ce qui laisse le temps de compter combien sont en vol.
      if (from === 0) {
        inFlight -= 1;
        return Promise.resolve(answer);
      }
      return new Promise<typeof answer>(resolve =>
        release.push(() => {
          inFlight -= 1;
          resolve(answer);
        }),
      );
    };
    const reading = paged<{ i: number }>("disponibilités", 500, page);
    await vi.waitFor(() => expect(release.length).toBe(5));
    expect(peak).toBe(5);
    release.forEach(done => done());
    const rows = await reading;
    expect(rows.map(r => r.i)).toEqual(all.map(r => r.i));
  });

  it("ne dépasse jamais six pages en vol", async () => {
    let inFlight = 0;
    let peak = 0;
    const all = Array.from({ length: 20_000 }, (_, i) => ({ i }));
    const page = async (from: number, to: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { data: all.slice(from, to + 1), error: null, count: all.length };
    };
    expect(await paged<{ i: number }>("disponibilités", 500, page)).toHaveLength(20_000);
    // Quarante pages restantes, six à la fois : on accélère sans occuper tout
    // le pool de connexions que les autres tables attendent.
    expect(peak).toBeLessThanOrEqual(6);
  });

  /**
   * Le filet du calcul de plages.
   *
   * Les plages étant prévues d'avance, une page servie plus courte que demandée
   * ne décale pas les suivantes : elle laisse un **trou au milieu**. Le compte
   * final ne tombe plus juste, et la lecture doit alors repartir à la file,
   * où chaque page part de ce qui a réellement été reçu.
   */
  it("relit à la file plutôt que de rendre une liste trouée", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const all = Array.from({ length: 1400 }, (_, i) => ({ i }));
    let parallel = true;
    const page = (from: number, to: number) => {
      // Première page pleine — rien ne laisse deviner le plafond — puis des
      // pages écourtées tant qu'on lit en parallèle.
      const size = parallel && from > 0 ? 200 : to - from + 1;
      if (from > 0) parallel = false;
      return Promise.resolve({ data: all.slice(from, from + size), error: null, count: all.length });
    };
    const rows = await paged<{ i: number }>("disponibilités", 500, page);
    expect(rows.map(r => r.i)).toEqual(all.map(r => r.i));
    expect(spy).toHaveBeenCalled();
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
