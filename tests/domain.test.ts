import { describe, expect, it } from "vitest";
import { assign, fillMonth, publish, sampleState, validate } from "./fixtures/centre";
import {
  availableAgents,
  defaultCampaign,
  entryKey,
  coverage,
  coverageLevel,
  isoWeekday,
  isValidated,
  monthDays,
  shiftKey,
  templateEntries,
  workload,
} from "../src/lib/domain";
import { auditCsv, personalCalendar, availabilityCsv } from "../src/lib/exports";

// Ce fichier porte sur les fonctions de lecture du domaine : ce que l'interface
// calcule à partir d'un état. Les règles d'écriture — validation complète,
// invalidation, fenêtre de saisie, publication couverte — sont tenues par la
// base et vérifiées contre PostgreSQL dans database.test.ts. Elles ne sont pas
// dupliquées ici : deux implémentations d'une même règle finissent par diverger.
const now = new Date("2026-09-18T10:00:00Z");
const campaignId = "campaign-2026-10";
const julien = "julien";
const answered = () => fillMonth(sampleState(now), campaignId, julien, "FULL_24H");

describe("Couverture", () => {
  it("compte le 24 h une fois dans chaque créneau, après validation uniquement", () => {
    const state = answered();
    expect(availableAgents(state, campaignId, "2026-10-15", "DAY").some(a => a.id === julien)).toBe(false);
    validate(state, campaignId, julien, now);
    for (const shift of ["DAY", "NIGHT"] as const)
      expect(availableAgents(state, campaignId, "2026-10-15", shift).filter(a => a.id === julien)).toHaveLength(1);
  });

  it("ne confond pas disponibles et affectés", () => {
    const state = validate(answered(), campaignId, julien, now);
    assign(state, campaignId, "2026-10-15", "DAY", []);
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "potential").actual).toBeGreaterThan(0);
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "planned").actual).toBe(0);
  });

  // Un agent désactivé après avoir été affecté ne disparaît pas du brouillon :
  // la base refusera la publication, l'écran doit le montrer comme invalide au
  // lieu d'annoncer « couvert » jusqu'au refus.
  it("montre un agent désactivé du brouillon comme invalide, sans le faire disparaître", () => {
    const state = validate(answered(), campaignId, julien, now);
    assign(state, campaignId, "2026-10-15", "DAY", [julien]);
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "planned").invalid).toHaveLength(0);
    const record = state.agents.find(a => a.id === julien)!;
    state.agents = state.agents.filter(a => a.id !== julien);
    state.inactiveAgents.push(record);
    const planned = coverage(state, campaignId, "2026-10-15", "DAY", "planned");
    expect(planned.actual).toBe(1);
    expect(planned.invalid.map(a => a.id)).toEqual([julien]);
    expect(planned.covered).toBe(false);
    // Le potentiel, lui, ne compte que l'effectif actif.
    expect(availableAgents(state, campaignId, "2026-10-15", "DAY").map(a => a.id)).not.toContain(julien);
  });

  it("ne mesure pas un créneau dont les besoins ne sont pas définis", () => {
    const state = validate(answered(), campaignId, julien, now);
    const key = shiftKey(campaignId, "2026-10-15", "DAY");
    // Le centre d'exemple enregistre ses besoins ; celui qui n'en a défini aucun
    // est le cas qu'on remplissait autrefois par un chiffre inventé.
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "potential").defined).toBe(true);
    delete state.requirements[key];
    const result = coverage(state, campaignId, "2026-10-15", "DAY", "planned");
    expect(result.defined).toBe(false);
    expect(result.need).toBeNull();
    expect(result.covered).toBe(false);
  });

  it("garde la version publiée pendant que le brouillon change", () => {
    const state = validate(answered(), campaignId, julien, now);
    const key = shiftKey(campaignId, "2026-10-15", "DAY");
    publish(state, campaignId, "2026-10-15", "DAY", [julien], 1, now);
    assign(state, campaignId, "2026-10-15", "DAY", []);
    expect(state.assignments[key]).toEqual([]);
    expect(state.publications[key].agents).toEqual([julien]);
    expect(state.publications[key].revision).toBe(1);
  });

  it("distingue le troisième niveau du §9 : couvert, limite, déficit", () => {
    const base = {
      defined: true,
      covered: true,
      actual: 5,
      need: 4,
      qualifications: [] as { need: number; actual: number }[],
    };
    expect(coverageLevel({ ...base, defined: false, covered: false })).toBe("unset");
    expect(coverageLevel({ ...base, covered: false, actual: 2 })).toBe("deficit");
    expect(coverageLevel(base)).toBe("covered");
    // Juste assez : une absence et le créneau est court.
    expect(coverageLevel({ ...base, actual: 4 })).toBe("tight");
    // L’effectif a de la marge, mais une qualification est à son minimum exact.
    expect(coverageLevel({ ...base, qualifications: [{ need: 1, actual: 1 }] })).toBe("tight");
    // Un minimum à zéro n’est jamais « limite » : il n’exige rien.
    expect(coverageLevel({ ...base, qualifications: [{ need: 0, actual: 0 }] })).toBe("covered");
  });

  it("ventile la charge en Jour, Nuit et 24 h, comme le demande le §8", () => {
    const state = validate(answered(), campaignId, julien, now);
    for (const key of Object.keys(state.assignments)) state.assignments[key] = [];
    assign(state, campaignId, "2026-10-01", "DAY", [julien]);
    assign(state, campaignId, "2026-10-02", "NIGHT", [julien]);
    // Les deux créneaux d’une même date : une garde de 24 h, pas deux gardes.
    assign(state, campaignId, "2026-10-03", "DAY", [julien]);
    assign(state, campaignId, "2026-10-03", "NIGHT", [julien]);
    expect(workload(state, campaignId, julien)).toEqual({ day: 1, night: 1, full: 1, total: 4 });
    expect(workload(state, campaignId, "marie")).toEqual({ day: 0, night: 0, full: 0, total: 0 });
  });
});

describe("Exports", () => {
  it("exporte uniquement les publications personnelles et traverse le changement d'heure de Paris", () => {
    const state = publish(sampleState(now), campaignId, "2026-10-24", "NIGHT", [julien], 2, now);
    const ics = personalCalendar(state, state.campaigns[0], julien);
    expect(ics).toContain("DTSTART:20261024T180000Z");
    expect(ics).toContain("DTEND:20261025T070000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SEQUENCE:2");
    expect(personalCalendar(state, state.campaigns[0], "marie")).not.toContain("BEGIN:VEVENT");
  });

  it("exporte le journal avec la date séparée de l’heure et le sujet en clair", () => {
    const state = sampleState(now);
    state.audit.unshift({
      id: "saisie",
      at: now.toISOString(),
      actor: "Julien Bernard",
      action: "Disponibilités enregistrées",
      detail: "1 jour · Jour",
      entity: "availability_entry",
    });
    const lines = auditCsv(state.audit).split("\r\n");
    expect(lines[0]).toBe('﻿"Date";"Heure";"Auteur";"Action";"Détail";"Sujet"');
    // L'entrée la plus récente d'abord, comme à l'écran, et son sujet lisible
    // plutôt que le nom de la table dont elle vient.
    expect(lines[1]).toContain('"2026-09-18";"12:00";"Julien Bernard"');
    expect(lines[1]).toContain('"Disponibilités"');
    expect(lines[lines.length - 1]).toContain('"Campagnes"');
  });

  it("neutralise une formule glissée dans le journal comme dans la matrice", () => {
    const state = sampleState(now);
    state.audit[0].detail = '=HYPERLINK("bad")';
    const csv = auditCsv(state.audit);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("neutralise les formules et conserve les caractères français du CSV", () => {
    const state = sampleState(now);
    state.agents[0].name = '=HYPERLINK("bad")';
    const csv = availabilityCsv(state, state.campaigns[0]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain("Équipe");
    expect(csv.startsWith("﻿")).toBe(true);
  });
});

describe("Disponibilité habituelle", () => {
  it("numérote la semaine comme ISO 8601, lundi en tête", () => {
    // 2026-10-01 est un jeudi ; 2026-10-04, un dimanche.
    expect(isoWeekday("2026-10-01")).toBe(4);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(isoWeekday("2026-10-05")).toBe(1);
  });

  it("ne touche qu’aux jours de semaine que le modèle mentionne", () => {
    const entries = templateEntries({ "6": "FULL_24H", "7": "UNAVAILABLE" }, "2026-10");
    // Octobre 2026 : cinq samedis et quatre dimanches.
    expect(entries.filter(e => e.type === "FULL_24H")).toHaveLength(5);
    expect(entries.filter(e => e.type === "UNAVAILABLE")).toHaveLength(4);
    expect(entries.every(e => [6, 7].includes(isoWeekday(e.date)))).toBe(true);
    expect(templateEntries({}, "2026-10")).toEqual([]);
  });

  it("un modèle n’est pas une disponibilité : il n’écrit rien de lui-même", () => {
    const state = sampleState(now);
    const before = JSON.stringify(state.entries);
    state.template = { "1": "UNAVAILABLE" };
    // Poser un modèle ne touche à aucun jour : il faut l'appliquer, et c'est
    // alors public.apply_availability_template() qui écrit, sous ses règles.
    expect(JSON.stringify(state.entries)).toBe(before);
    const monday = monthDays("2026-10").find(d => isoWeekday(d) === 1)!;
    expect(state.entries[entryKey(campaignId, julien, monday)]?.type).not.toBe("UNAVAILABLE");
  });
});

describe("Campagne par défaut", () => {
  const campaign = (month: string, closesOn: string, closed = false) => ({
    ...sampleState(now).campaigns[0],
    id: `campaign-${month}${closed ? "-close" : ""}`,
    month,
    closesOn,
    closed,
  });
  // Le centre porte toutes ses campagnes, de la plus ancienne à la plus récente.
  const centre = [
    campaign("2026-08", "2026-07-31", true),
    campaign("2026-09", "2026-08-31", true),
    campaign("2026-10", "2026-09-30"),
    campaign("2026-11", "2026-10-31"),
  ];

  it("ouvre sur la campagne qui attend une réponse, la première à clore", () => {
    expect(defaultCampaign(centre, "2026-09-18")?.month).toBe("2026-10");
    // Octobre est passée : novembre presse à son tour.
    expect(defaultCampaign(centre, "2026-10-05")?.month).toBe("2026-11");
  });

  it("ouvre sur la plus récente quand plus rien n’attend de réponse", () => {
    expect(defaultCampaign(centre, "2026-12-01")?.month).toBe("2026-11");
    const allClosed = centre.map(c => ({ ...c, closed: true }));
    expect(defaultCampaign(allClosed, "2026-09-18")?.month).toBe("2026-11");
  });

  it("ne retombe jamais sur la plus ancienne par le seul ordre de la liste", () => {
    expect(defaultCampaign(centre, "2026-09-18")?.month).not.toBe("2026-08");
    expect(defaultCampaign([], "2026-09-18")).toBeUndefined();
  });
});
