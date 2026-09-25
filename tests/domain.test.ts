import { describe, expect, it } from "vitest";
import { assign, fillMonth, publish, sampleState, validate } from "./fixtures/centre";
import {
  availableAgents,
  commandSchema,
  defaultCampaign,
  draftAgents,
  entryKey,
  coverage,
  coverageLevel,
  isoWeekday,
  isOpen,
  isValidated,
  loadedSince,
  localDate,
  localMonth,
  localTime,
  monthDays,
  publishedShiftsOf,
  shiftKey,
  shiftMonth,
  templateEntries,
  workload,
  type AppState,
} from "../src/lib/domain";
import { auditCsv, personalCalendar, availabilityCsv, upcomingCalendar } from "../src/lib/exports";

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

  // C1 de l'analyse du 23 septembre : l'écran Planning doit pouvoir le retirer.
  it("garde au brouillon affiché un agent désactivé, pour qu’on puisse l’en retirer", () => {
    const state = validate(answered(), campaignId, julien, now);
    assign(state, campaignId, "2026-10-15", "DAY", [julien]);
    assign(state, campaignId, "2026-10-15", "NIGHT", []);
    const record = state.agents.find(a => a.id === julien)!;
    state.agents = state.agents.filter(a => a.id !== julien);
    state.inactiveAgents.push(record);
    expect(draftAgents(state, campaignId, "2026-10-15", "DAY").map(a => a.id)).toEqual([julien]);
    expect(draftAgents(state, campaignId, "2026-10-15", "NIGHT")).toEqual([]);
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

  // C13 de l'analyse du 23 septembre : l'horodatage vient de PostgREST, avec
  // microsecondes et décalage ; les identifiants réels sont des UUID, et la
  // ligne UID dépassait 75 octets.
  it("écrit un agenda conforme à partir de ce que rend la base", () => {
    const uuid = "1ee74c18-b527-40cf-b6db-e41b711d9de9";
    const agent = "30000000-0000-0000-0000-0000000000c3";
    const state = sampleState(now);
    const campaign = { ...state.campaigns[0], id: uuid };
    publish(state, uuid, "2026-10-24", "NIGHT", [agent], 2, now);
    state.publications[shiftKey(uuid, "2026-10-24", "NIGHT")].publishedAt = "2026-09-20T08:00:00.123456+00:00";
    const ics = personalCalendar(state, campaign, agent);
    expect(ics).toContain("\r\nDTSTAMP:20260920T080000Z\r\n");
    // Aucune ligne physique au-delà de 75 octets…
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // … et le dépliage rend l'identifiant entier.
    expect(ics.replaceAll("\r\n ", "")).toContain(`UID:${uuid}-2026-10-24-NIGHT-${agent}@disposp.local\r\n`);
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

// B2 de l'analyse du 23 septembre : la campagne choisie par défaut est celle qui
// attend une réponse — le mois suivant. Les gardes du mois en cours ne doivent
// pas disparaître pour autant.
describe("Gardes publiées d’un agent", () => {
  it("rassemble toutes les campagnes, par date puis jour avant nuit", () => {
    const state = sampleState(now);
    const september = { ...state.campaigns[0], id: "campaign-2026-09", month: "2026-09", name: "Septembre" };
    state.campaigns.unshift(september);
    publish(state, campaignId, "2026-10-02", "DAY", [julien], 1, now);
    publish(state, september.id, "2026-09-24", "NIGHT", [julien], 1, now);
    publish(state, september.id, "2026-09-24", "DAY", [julien], 2, now);
    publish(state, september.id, "2026-09-25", "DAY", ["marie"], 1, now);
    const shifts = publishedShiftsOf(state, julien).map(s => `${s.campaign.id} ${s.date} ${s.shift}`);
    expect(shifts).toEqual([
      "campaign-2026-09 2026-09-24 DAY",
      "campaign-2026-09 2026-09-24 NIGHT",
      "campaign-2026-10 2026-10-02 DAY",
    ]);
    // La garde porte sa campagne : ses horaires et son désistement en viennent.
    expect(publishedShiftsOf(state, julien)[0].campaign.month).toBe("2026-09");
    expect(publishedShiftsOf(state, "personne")).toEqual([]);
  });
});

// La CI fait tourner cette suite deux fois, en Europe/Paris puis en UTC : ces
// attentes ne doivent dépendre d'aucune des deux.
describe("Dates de référence", () => {
  it("lit le jour et le mois à Paris, pas sur l'horloge de la machine", () => {
    // 23 h 30 UTC le 30 septembre : déjà le 1er octobre à Paris (UTC+2).
    const lateEvening = new Date("2026-09-30T23:30:00Z");
    expect(localDate(lateEvening)).toBe("2026-10-01");
    expect(localMonth(lateEvening)).toBe("2026-10");
    expect(localTime(lateEvening)).toBe("01:30");
    // L'hiver, Paris n'a plus qu'une heure d'avance.
    expect(localTime(new Date("2026-12-15T23:30:00Z"))).toBe("00:30");
  });

  it("date le journal exporté à l'heure de Paris", () => {
    const csv = auditCsv([
      {
        id: "a",
        at: "2026-09-30T22:15:00Z",
        actor: "Gestionnaire",
        action: "Campagne ouverte",
        detail: "Novembre",
        entity: "availability_campaigns",
      },
    ] as Parameters<typeof auditCsv>[0]);
    expect(csv).toContain('"2026-10-01";"00:15"');
  });

  it("fait commencer la fenêtre chargée douze mois en arrière, mois courant compris", () => {
    expect(loadedSince(new Date("2026-09-23T10:00:00Z"))).toBe("2025-10-01");
    // Le 1er janvier à 0 h 30 à Paris, c'est encore décembre en UTC.
    expect(loadedSince(new Date("2026-12-31T23:30:00Z"))).toBe("2026-02-01");
  });

  it("décale un mois sans passer par un fuseau", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", 0)).toBe("2026-09");
    expect(shiftMonth("2026-03", 14)).toBe("2027-05");
  });

  it("dit une campagne ouverte le jour de Paris où elle l'est", () => {
    const [campaign] = sampleState(now).campaigns;
    expect(isOpen(campaign, campaign.closesOn)).toBe(true);
    expect(isOpen(campaign, shiftDay(campaign.closesOn))).toBe(false);
  });
});

const shiftDay = (date: string) => {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

/**
 * Les schémas des commandes : une action serveur se poste sans l'écran, et ce
 * que l'écran refuse, le serveur doit le refuser aussi.
 */
describe("Schéma des commandes", () => {
  const campaign = "40000000-0000-0000-0000-000000000001";
  const requirement = {
    type: "requirement" as const,
    campaignId: campaign,
    date: "2026-10-01",
    shift: "DAY" as const,
    total: 4,
  };

  it("refuse une clôture qui ne précède pas le mois, comme le formulaire", () => {
    const open = { type: "campaign" as const, name: "Octobre", month: "2026-10" };
    expect(commandSchema.safeParse({ ...open, closesOn: "2026-09-30" }).success).toBe(true);
    expect(commandSchema.safeParse({ ...open, closesOn: "2026-10-01" }).success).toBe(false);
    expect(commandSchema.safeParse({ ...open, closesOn: "2026-10-15" }).success).toBe(false);
  });

  it("refuse une date qui n’existe pas au calendrier", () => {
    expect(commandSchema.safeParse({ ...requirement, qualifications: {}, date: "2026-02-30" }).success).toBe(false);
    expect(commandSchema.safeParse({ ...requirement, qualifications: {}, date: "2026-13-01" }).success).toBe(false);
    expect(commandSchema.safeParse({ ...requirement, qualifications: {}, date: "2028-02-29" }).success).toBe(true);
    expect(commandSchema.safeParse({ ...requirement, qualifications: {}, date: "2026-02-29" }).success).toBe(false);
  });

  it("n’accepte que des identifiants au format de la base", () => {
    const validate = (campaignId: string) => commandSchema.safeParse({ type: "validate", campaignId }).success;
    expect(validate(campaign)).toBe(true);
    expect(validate("1ee74c18-b527-40cf-b6db-e41b711d9de9")).toBe(true);
    expect(validate("campagne")).toBe(false);
    expect(validate("40000000-0000-0000-0000-00000000000g")).toBe(false);
    expect(validate("")).toBe(false);
    // Une équipe à créer n'a pas encore d'identifiant.
    expect(commandSchema.safeParse({ type: "team", teamId: "", name: "Bravo" }).success).toBe(true);
    expect(commandSchema.safeParse({ type: "team", teamId: "bravo", name: "Bravo" }).success).toBe(false);
  });

  it("nettoie les noms de qualification, et refuse un nom vide ou en double", () => {
    const parsed = commandSchema.safeParse({ ...requirement, qualifications: { " SAP ": 2, Chef: 1 } });
    expect(parsed.success && parsed.data.type === "requirement" && parsed.data.qualifications).toEqual({
      SAP: 2,
      Chef: 1,
    });
    expect(commandSchema.safeParse({ ...requirement, qualifications: { SAP: 2, "SAP ": 1 } }).success).toBe(false);
    expect(commandSchema.safeParse({ ...requirement, qualifications: { "  ": 1 } }).success).toBe(false);
  });
});

/**
 * Une garde dont le désistement est accepté n'est plus celle de l'agent, même
 * tant que personne n'a republié. Elle restait sur l'accueil, dans « Prochaine
 * garde » et dans l'agenda exporté.
 */
describe("Garde publiée après un désistement accepté", () => {
  const date = "2026-10-02";
  const withdrawal = (overrides: Partial<AppState["withdrawals"][number]> = {}) => ({
    id: "w1",
    shiftId: "s1",
    campaignId,
    date,
    shift: "DAY" as const,
    userId: julien,
    reason: "",
    state: "ACCEPTED" as const,
    createdAt: "2026-09-19T08:00:00Z",
    blocking: true,
    decidedAt: "2026-09-19T09:00:00Z",
    ...overrides,
  });
  // Publiée le 18 à 10 h UTC ; la décision du 19 vient après.
  const published = () => {
    const state = publish(sampleState(now), campaignId, date, "DAY", [julien, "marie"], 1, now);
    publish(state, campaignId, "2026-10-05", "NIGHT", [julien], 1, now);
    return state;
  };

  it("disparaît des gardes de l’agent, pas de celles des autres", () => {
    const state = published();
    state.withdrawals = [withdrawal()];
    expect(publishedShiftsOf(state, julien).map(s => s.date)).toEqual(["2026-10-05"]);
    expect(publishedShiftsOf(state, "marie").map(s => s.date)).toEqual([date]);
  });

  it("disparaît de l’agenda de la campagne", () => {
    const state = published();
    state.withdrawals = [withdrawal()];
    const ics = personalCalendar(state, state.campaigns[0], julien);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("20261002");
  });

  // Accepté, puis réaffecté et republié : une décision neuve, qui prime.
  it("revient quand l’encadrement republie l’agent après sa décision", () => {
    const state = published();
    state.withdrawals = [withdrawal({ blocking: false })];
    state.publications[shiftKey(campaignId, date, "DAY")].publishedAt = "2026-09-20T08:00:00.123456+00:00";
    expect(publishedShiftsOf(state, julien).map(s => s.date)).toEqual([date, "2026-10-05"]);
  });

  it("ne bouge pas pour une demande en attente, refusée ou retirée", () => {
    for (const state_ of ["PENDING", "REFUSED", "CANCELLED"] as const) {
      const state = published();
      state.withdrawals = [withdrawal({ state: state_, blocking: false, decidedAt: null })];
      expect(publishedShiftsOf(state, julien), state_).toHaveLength(2);
    }
  });

  it("se rabat sur `blocking` quand l’instant de la décision manque", () => {
    const state = published();
    state.withdrawals = [withdrawal({ decidedAt: undefined })];
    expect(publishedShiftsOf(state, julien)).toHaveLength(1);
  });
});

describe("Agenda des gardes à venir", () => {
  it("rassemble les gardes à venir de toutes les campagnes, au format de l’agenda d’une campagne", () => {
    const state = sampleState(now);
    const september = { ...state.campaigns[0], id: "campaign-2026-09", month: "2026-09", name: "Septembre" };
    state.campaigns.unshift(september);
    publish(state, september.id, "2026-09-17", "DAY", [julien], 1, now);
    publish(state, september.id, "2026-09-24", "NIGHT", [julien], 1, now);
    publish(state, campaignId, "2026-10-24", "NIGHT", [julien], 2, now);
    publish(state, campaignId, "2026-10-25", "DAY", ["marie"], 1, now);
    const ics = upcomingCalendar(state, julien, "2026-09-18");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // Passée, elle n'est plus « à venir ».
    expect(ics).not.toContain("20260917");
    expect(ics).toContain("DTSTART:20260924T180000Z");
    // La nuit du changement d'heure, comme dans l'agenda d'une campagne.
    expect(ics).toContain("DTSTART:20261024T180000Z");
    expect(ics).toContain("DTEND:20261025T070000Z");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    // Même événement, même identifiant que dans l'agenda de sa campagne :
    // réimporter l'un après l'autre met à jour au lieu de dupliquer.
    const single = personalCalendar(state, state.campaigns[1], julien);
    const uid = (text: string) => text.replaceAll("\r\n ", "").match(/UID:campaign-2026-10[^\r]*/)?.[0];
    expect(uid(ics)).toBe(uid(single));
  });

  it("n’exporte pas une garde dont le désistement est accepté", () => {
    const state = publish(sampleState(now), campaignId, "2026-10-02", "DAY", [julien], 1, now);
    state.withdrawals = [
      {
        id: "w1",
        shiftId: "s1",
        campaignId,
        date: "2026-10-02",
        shift: "DAY",
        userId: julien,
        reason: "",
        state: "ACCEPTED",
        createdAt: "2026-09-19T08:00:00Z",
        blocking: true,
        decidedAt: "2026-09-19T09:00:00Z",
      },
    ];
    expect(upcomingCalendar(state, julien, "2026-09-18")).not.toContain("BEGIN:VEVENT");
  });
});
