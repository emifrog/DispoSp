import { describe, expect, it } from "vitest";
import { buildWorkbook } from "../src/lib/workbook";
import { publish, sampleState } from "./fixtures/centre";
import { entryKey, isValidated, labels, monthDays, shiftKey } from "../src/lib/domain";

const now = new Date("2026-09-18T10:00:00Z");
const state = sampleState(now);
const campaign = state.campaigns[0];
const book = buildWorkbook(state, campaign);
const days = monthDays(campaign.month);
const agents = [...state.agents].sort((a, b) => a.name.localeCompare(b.name, "fr"));

const cell = (sheet: string, row: number, column: number) =>
  book.getWorksheet(sheet)?.getRow(row).getCell(column).value;

describe("Classeur Excel", () => {
  it("porte les cinq feuilles du §11, plus la couverture du §7", () => {
    expect(book.worksheets.map(w => w.name)).toEqual([
      "Disponibilités",
      "Synthèse",
      "Couverture",
      "Affectations",
      "Qualifications",
      "Statistiques",
    ]);
  });

  it("reprend la matrice telle que l’écran la montre", () => {
    const sheet = book.getWorksheet("Disponibilités");
    expect(sheet?.rowCount).toBe(agents.length + 1);
    // Six colonnes d’identité — agent, équipe, grade, fonction, matricule,
    // réponse — puis un jour par colonne.
    expect(sheet?.columnCount).toBe(6 + days.length);
    const first = agents[0];
    expect(cell("Disponibilités", 2, 1)).toBe(first.name);
    expect(cell("Disponibilités", 2, 4)).toBe(first.fonction);
    expect(cell("Disponibilités", 2, 6)).toBe(isValidated(state, campaign.id, first.id) ? "Validée" : "À valider");
    const entry = state.entries[entryKey(campaign.id, first.id, days[0])];
    expect(cell("Disponibilités", 2, 7)).toBe(entry ? labels[entry.type].short : "?");
  });

  it("compte chaque état une fois par jour dans la synthèse", () => {
    const sheet = book.getWorksheet("Synthèse");
    expect(sheet?.rowCount).toBe(days.length + 1);
    const row = sheet?.getRow(2);
    const counts = [2, 3, 4, 5, 6].map(column => Number(row?.getCell(column).value));
    // Les cinq états couvrent tout l’effectif, sans recouvrement.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(agents.length);
  });

  it("distingue le brouillon du publié dans les affectations", () => {
    const sheet = book.getWorksheet("Affectations");
    const states = new Set<string>();
    sheet?.eachRow((row, index) => {
      if (index > 1) states.add(String(row.getCell(7).value));
    });
    // Le jeu de démonstration ne publie rien : tout doit se lire « Brouillon ».
    expect([...states]).toEqual(["Brouillon"]);
    const assigned = Object.entries(state.assignments)
      .filter(([key]) => key.startsWith(`${campaign.id}/`))
      .reduce((total, [, ids]) => total + ids.length, 0);
    expect((sheet?.rowCount ?? 0) - 1).toBe(assigned);
  });

  // C14 de l'analyse du 23 septembre : la feuille ne lisait que le brouillon, et
  // dans l'effectif actif seulement.
  it("garde un agent désactivé encore affecté, et un agent publié puis retiré du brouillon", () => {
    const local = sampleState(now);
    const target = local.campaigns[0];
    const date = monthDays(target.month)[1];
    const day = shiftKey(target.id, date, "DAY");
    const night = shiftKey(target.id, date, "NIGHT");
    // Désactivé, resté au brouillon de jour.
    const leaving = local.assignments[day][0];
    const record = local.agents.find(a => a.id === leaving)!;
    local.agents = local.agents.filter(a => a.id !== leaving);
    local.inactiveAgents.push(record);
    // Publié la nuit, puis retiré du brouillon sans republier.
    const drafted = [...local.assignments[night]];
    publish(local, target.id, date, "NIGHT", drafted, 1, now);
    const removed = drafted[drafted.length - 1];
    local.assignments[night] = drafted.slice(0, -1);

    const rows: string[][] = [];
    buildWorkbook(local, target)
      .getWorksheet("Affectations")
      ?.eachRow((row, index) => {
        if (index > 1) rows.push([1, 2, 3, 7].map(column => String(row.getCell(column).value)));
      });
    const nameOf = (id: string) => [...local.agents, ...local.inactiveAgents].find(a => a.id === id)!.name;
    expect(rows).toContainEqual([date, "Jour", record.name, "Brouillon · agent désactivé"]);
    expect(rows).toContainEqual([date, "Nuit", nameOf(removed), "Publié · version 1 · retiré du brouillon"]);
    // Autant de lignes de jour que la feuille Couverture compte d'affectés.
    expect(rows.filter(r => r[0] === date && r[1] === "Jour")).toHaveLength(local.assignments[day].length);
  });

  it("n’invente aucun besoin dans la couverture", () => {
    const sheet = book.getWorksheet("Couverture");
    expect(sheet?.rowCount).toBe(days.length * 2 + 1);
    const need = state.requirements[shiftKey(campaign.id, days[0], "DAY")];
    expect(cell("Couverture", 2, 4)).toBe(need.total);
    expect(cell("Couverture", 2, 2)).toBe("Jour");
  });

  it("ventile l’équité par agent, sous les indicateurs", () => {
    const sheet = book.getWorksheet("Statistiques");
    const labelsRead: string[] = [];
    sheet?.eachRow(row => labelsRead.push(String(row.getCell(1).value ?? "")));
    expect(labelsRead).toContain("Taux de réponse");
    expect(labelsRead).toContain("Créneaux à la limite");
    expect(labelsRead).toContain("Équité — agent");
    for (const agent of agents) expect(labelsRead).toContain(agent.name);
  });
});

/**
 * Le classeur ne parle que de sa campagne.
 *
 * Le jeu de démonstration convie tout le centre, ce qui rendait le défaut
 * invisible : les deux listes coïncidaient. Un centre à plusieurs équipes ne
 * coïncide pas, et l'export présentait alors des agents que la campagne n'avait
 * jamais invités — avec un mois de « ? » qui se lit comme un défaut de réponse.
 */
describe("Classeur d’une campagne qui ne convie pas tout le centre", () => {
  const partial = sampleState(now);
  const only = partial.campaigns[0];
  const invited = partial.agents.slice(0, 3);
  const outsider = partial.agents[partial.agents.length - 1];
  only.participants = invited.map(a => a.id);
  const sheets = buildWorkbook(partial, only);
  const names = (sheet: string, column = 1) => {
    const read: string[] = [];
    sheets.getWorksheet(sheet)?.eachRow((row, index) => {
      if (index > 1) read.push(String(row.getCell(column).value ?? ""));
    });
    return read;
  };

  it("ne retient que les participants dans les disponibilités", () => {
    expect(sheets.getWorksheet("Disponibilités")?.rowCount).toBe(invited.length + 1);
    expect(names("Disponibilités")).not.toContain(outsider.name);
  });

  it("compte la synthèse et le taux de réponse sur eux seuls", () => {
    const row = sheets.getWorksheet("Synthèse")?.getRow(2);
    const counts = [2, 3, 4, 5, 6].map(column => Number(row?.getCell(column).value));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(invited.length);
    const stats = sheets.getWorksheet("Statistiques");
    const concerned = stats?.getRow(5);
    expect(String(concerned?.getCell(1).value)).toBe("Agents concernés");
    expect(Number(concerned?.getCell(2).value)).toBe(invited.length);
  });

  it("laisse dehors les qualifications et l’équité de qui n’est pas convié", () => {
    expect(names("Qualifications")).not.toContain(outsider.name);
    expect(names("Statistiques")).not.toContain(outsider.name);
  });
});
