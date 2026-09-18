import ExcelJS from "exceljs";
import {
  availableAgents,
  coverage,
  coverageLevel,
  coverageLevelLabels,
  entryKey,
  gradeLabel,
  hours,
  isValidated,
  labels,
  monthDays,
  monthLabel,
  requirement,
  shiftKey,
  workload,
  type AppState,
  type Campaign,
  type Shift,
} from "./domain";

const SHIFTS: Shift[] = ["DAY", "NIGHT"];
const shiftLabel = (shift: Shift) => (shift === "DAY" ? "Jour" : "Nuit");
const HEADER = { bold: true } as const;

function sheet(book: ExcelJS.Workbook, name: string, columns: Partial<ExcelJS.Column>[]) {
  const page = book.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  page.columns = columns;
  page.getRow(1).font = HEADER;
  return page;
}

/**
 * The five books §11 asks for, in one file: disponibilités, synthèse,
 * affectations, qualifications, statistiques.
 *
 * Built from the same AppState the screens read, so an export can never tell a
 * different story from the screen it was taken from.
 */
export function buildWorkbook(state: AppState, campaign: Campaign): ExcelJS.Workbook {
  const book = new ExcelJS.Workbook();
  book.creator = "DispoSP";
  book.created = new Date();
  const days = monthDays(campaign.month);
  const agents = [...state.agents].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  // 1. Disponibilités — la matrice, telle que l'écran la montre.
  const availability = sheet(book, "Disponibilités", [
    { header: "Agent", key: "name", width: 26 },
    { header: "Équipe", key: "team", width: 16 },
    { header: "Grade", key: "grade", width: 16 },
    { header: "Matricule", key: "matricule", width: 12 },
    { header: "Réponse", key: "response", width: 12 },
    ...days.map(date => ({ header: String(Number(date.slice(-2))), key: date, width: 5 })),
  ]);
  for (const agent of agents) {
    const row: Record<string, string | number> = {
      name: agent.name,
      team: agent.team,
      grade: gradeLabel(agent),
      matricule: agent.matricule,
      response: isValidated(state, campaign.id, agent.id) ? "Validée" : "À valider",
    };
    for (const date of days) {
      const entry = state.entries[entryKey(campaign.id, agent.id, date)];
      row[date] = entry ? labels[entry.type].short : "?";
    }
    availability.addRow(row);
  }

  // 2. Synthèse — les cinq états du §4, jour par jour.
  const summary = sheet(book, "Synthèse", [
    { header: "Date", key: "date", width: 12 },
    { header: "Jour", key: "DAY", width: 8 },
    { header: "Nuit", key: "NIGHT", width: 8 },
    { header: "24 h", key: "FULL_24H", width: 8 },
    { header: "Indisponible", key: "UNAVAILABLE", width: 14 },
    { header: "Non renseigné", key: "UNKNOWN", width: 15 },
    { header: "Réponses non validées", key: "pending", width: 22 },
  ]);
  for (const date of days) {
    const counts: Record<string, number> = { DAY: 0, NIGHT: 0, FULL_24H: 0, UNAVAILABLE: 0, UNKNOWN: 0 };
    for (const agent of agents) {
      const type = state.entries[entryKey(campaign.id, agent.id, date)]?.type ?? "UNKNOWN";
      counts[type] += 1;
    }
    summary.addRow({
      date,
      ...counts,
      pending: agents.filter(a => !isValidated(state, campaign.id, a.id)).length,
    });
  }

  // 3. Couverture — besoins, potentiel et planifié, avec l'écart du §7.
  const cover = sheet(book, "Couverture", [
    { header: "Date", key: "date", width: 12 },
    { header: "Créneau", key: "shift", width: 10 },
    { header: "Horaires", key: "hours", width: 18 },
    { header: "Besoin", key: "need", width: 9 },
    { header: "Disponibles", key: "potential", width: 12 },
    { header: "Affectés", key: "planned", width: 10 },
    { header: "Écart", key: "gap", width: 8 },
    { header: "Niveau", key: "level", width: 20 },
  ]);
  for (const date of days)
    for (const shift of SHIFTS) {
      const need = requirement(state, campaign.id, date, shift);
      const planned = coverage(state, campaign.id, date, shift, "planned");
      cover.addRow({
        date,
        shift: shiftLabel(shift),
        hours: hours(campaign, shift),
        need: need ? need.total : "—",
        potential: availableAgents(state, campaign.id, date, shift).length,
        planned: planned.actual,
        gap: need ? planned.actual - need.total : "—",
        level: coverageLevelLabels[coverageLevel(planned)],
      });
    }

  // 4. Affectations — le brouillon et le publié, jamais confondus.
  const assignments = sheet(book, "Affectations", [
    { header: "Date", key: "date", width: 12 },
    { header: "Créneau", key: "shift", width: 10 },
    { header: "Agent", key: "name", width: 26 },
    { header: "Grade", key: "grade", width: 16 },
    { header: "Équipe", key: "team", width: 16 },
    { header: "État", key: "status", width: 22 },
  ]);
  for (const date of days)
    for (const shift of SHIFTS) {
      const key = shiftKey(campaign.id, date, shift);
      const published = state.publications[key];
      for (const id of state.assignments[key] ?? []) {
        const agent = state.agents.find(a => a.id === id);
        if (!agent) continue;
        assignments.addRow({
          date,
          shift: shiftLabel(shift),
          name: agent.name,
          grade: gradeLabel(agent),
          team: agent.team,
          status: published?.agents.includes(id) ? `Publié · version ${published.revision}` : "Brouillon",
        });
      }
    }

  // 5. Qualifications — le catalogue en colonnes, les agents en lignes.
  const catalogue = [...new Set([...state.qualificationCatalogue, ...agents.flatMap(a => a.qualifications)])].sort(
    (a, b) => a.localeCompare(b, "fr"),
  );
  const qualifications = sheet(book, "Qualifications", [
    { header: "Agent", key: "name", width: 26 },
    { header: "Équipe", key: "team", width: 16 },
    ...catalogue.map(name => ({ header: name, key: name, width: 16 })),
  ]);
  for (const agent of agents)
    qualifications.addRow({
      name: agent.name,
      team: agent.team,
      ...Object.fromEntries(catalogue.map(name => [name, agent.qualifications.includes(name) ? "X" : ""])),
    });

  // 6. Statistiques — le tableau de bord et l'équité du §8.
  const stats = book.addWorksheet("Statistiques");
  stats.columns = [
    { header: "Indicateur", key: "label", width: 34 },
    { header: "Valeur", key: "value", width: 16 },
  ];
  stats.getRow(1).font = HEADER;
  const shifts = days.flatMap(date => SHIFTS.map(shift => coverage(state, campaign.id, date, shift, "planned")));
  const levels = shifts.map(coverageLevel);
  const validated = agents.filter(a => isValidated(state, campaign.id, a.id)).length;
  for (const [label, value] of [
    ["Campagne", campaign.name],
    ["Mois concerné", monthLabel(campaign.month)],
    ["Fenêtre de réponse", `${campaign.opensOn} — ${campaign.closesOn}`],
    ["Agents concernés", agents.length],
    ["Réponses validées", validated],
    ["Taux de réponse", agents.length ? `${Math.round((validated / agents.length) * 100)} %` : "—"],
    ["Créneaux couverts", levels.filter(l => l === "covered").length],
    ["Créneaux à la limite", levels.filter(l => l === "tight").length],
    ["Créneaux en déficit", levels.filter(l => l === "deficit").length],
    ["Créneaux sans besoins définis", levels.filter(l => l === "unset").length],
  ] as [string, string | number][])
    stats.addRow({ label, value });

  stats.addRow({});
  const equityHeader = stats.addRow({ label: "Équité — agent", value: "Jour" });
  equityHeader.getCell(3).value = "Nuit";
  equityHeader.getCell(4).value = "24 h";
  equityHeader.getCell(5).value = "Total";
  equityHeader.font = HEADER;
  for (const agent of agents) {
    const load = workload(state, campaign.id, agent.id);
    const row = stats.addRow({ label: agent.name, value: load.day });
    row.getCell(3).value = load.night;
    row.getCell(4).value = load.full;
    row.getCell(5).value = load.total;
  }
  return book;
}
