import { describe, expect, it } from "vitest";
import { buildWorkbook } from "../src/lib/workbook";
import { sampleState } from "./fixtures/centre";
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
    // Cinq colonnes d’identité, puis un jour par colonne.
    expect(sheet?.columnCount).toBe(5 + days.length);
    const first = agents[0];
    expect(cell("Disponibilités", 2, 1)).toBe(first.name);
    expect(cell("Disponibilités", 2, 5)).toBe(isValidated(state, campaign.id, first.id) ? "Validée" : "À valider");
    const entry = state.entries[entryKey(campaign.id, first.id, days[0])];
    expect(cell("Disponibilités", 2, 6)).toBe(entry ? labels[entry.type].short : "?");
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
      if (index > 1) states.add(String(row.getCell(6).value));
    });
    // Le jeu de démonstration ne publie rien : tout doit se lire « Brouillon ».
    expect([...states]).toEqual(["Brouillon"]);
    const assigned = Object.entries(state.assignments)
      .filter(([key]) => key.startsWith(`${campaign.id}/`))
      .reduce((total, [, ids]) => total + ids.length, 0);
    expect((sheet?.rowCount ?? 0) - 1).toBe(assigned);
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
