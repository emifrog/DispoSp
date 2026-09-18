import { describe, expect, it } from "vitest";
import { createDemoState } from "../src/lib/seed";
import {
  availableAgents,
  entryKey,
  coverage,
  coverageLevel,
  execute,
  filledDays,
  isOpen,
  isoWeekday,
  isValidated,
  localDate,
  localMonth,
  monthDays,
  responseKey,
  shiftKey,
  shiftMonth,
  templateEntries,
  workload,
} from "../src/lib/domain";
import { auditCsv, personalCalendar, availabilityCsv } from "../src/lib/exports";

const now = new Date("2026-09-18T10:00:00Z");
const campaignId = "campaign-2026-10";
const actor = { id: "julien", role: "MANAGER" as const };
function fullResponse() {
  return execute(
    createDemoState(now),
    actor,
    { type: "availability", campaignId, dates: monthDays("2026-10"), value: "FULL_24H", comment: "" },
    now,
  );
}
describe("Réponses aux campagnes", () => {
  it("ne compte pas une saisie complète comme une réponse validée", () => {
    const state = fullResponse();
    expect(filledDays(state, state.campaigns[0], actor.id)).toBe(31);
    expect(isValidated(state, campaignId, actor.id)).toBe(false);
    const submitted = execute(state, actor, { type: "validate", campaignId }, now);
    expect(isValidated(submitted, campaignId, actor.id)).toBe(true);
  });
  it("refuse une validation incomplète et les dates hors campagne", () => {
    expect(() => execute(createDemoState(now), actor, { type: "validate", campaignId }, now)).toThrow("chaque jour");
    expect(() =>
      execute(
        createDemoState(now),
        actor,
        { type: "availability", campaignId, dates: ["2026-11-01"], value: "DAY", comment: "" },
        now,
      ),
    ).toThrow("dates dans la campagne");
  });
  it("invalide la réponse après modification sans toucher aux autres agents", () => {
    const submitted = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const edited = execute(
      submitted,
      actor,
      { type: "availability", campaignId, dates: ["2026-10-15"], value: "UNAVAILABLE", comment: "" },
      now,
    );
    expect(isValidated(edited, campaignId, actor.id)).toBe(false);
    expect(edited.responses[responseKey(campaignId, "marie")]).toBe(
      submitted.responses[responseKey(campaignId, "marie")],
    );
    expect(isValidated(submitted, campaignId, actor.id)).toBe(true);
  });
  it("refuse toute saisie après clôture ou en dehors de la fenêtre", () => {
    const closed = execute(createDemoState(now), actor, { type: "close", campaignId, closed: true }, now);
    const command = {
      type: "availability" as const,
      campaignId,
      dates: ["2026-10-01"],
      value: "DAY" as const,
      comment: "",
    };
    expect(() => execute(closed, actor, command, now)).toThrow("fermée");
    expect(() => execute(createDemoState(now), actor, command, new Date("2026-10-01T10:00:00Z"))).toThrow("fermée");
  });
});
describe("Jeu de démonstration", () => {
  it("s’ouvre à la saisie quelle que soit la date à laquelle il est chargé", () => {
    const days = ["2026-09-18", "2026-09-30", "2026-10-01", "2026-12-31", "2027-01-01", "2028-02-29"];
    for (const day of days) {
      const at = new Date(`${day}T10:00:00`);
      const state = createDemoState(at);
      const campaign = state.campaigns[0];
      expect(campaign.month, day).toBe(shiftMonth(localMonth(at), 1));
      expect(campaign.id, day).toBe(`campaign-${campaign.month}`);
      expect(isOpen(campaign, localDate(at)), day).toBe(true);
      // The symptom a fixed window produced: an agent could no longer save.
      expect(() =>
        execute(
          state,
          { id: "julien", role: "AGENT" },
          {
            type: "availability",
            campaignId: campaign.id,
            dates: [monthDays(campaign.month)[0]],
            value: "DAY",
            comment: "",
          },
          at,
        ),
      ).not.toThrow();
    }
  });
});
describe("Couverture et publication", () => {
  it("compte le 24 h une fois dans chaque créneau, après validation uniquement", () => {
    let state = fullResponse();
    expect(availableAgents(state, campaignId, "2026-10-15", "DAY").some(a => a.id === actor.id)).toBe(false);
    state = execute(state, actor, { type: "validate", campaignId }, now);
    for (const shift of ["DAY", "NIGHT"] as const)
      expect(availableAgents(state, campaignId, "2026-10-15", shift).filter(a => a.id === actor.id)).toHaveLength(1);
  });
  it("ne confond pas disponibles et affectés, et déduplique les affectations", () => {
    let state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const key = shiftKey(campaignId, "2026-10-15", "DAY");
    state.assignments[key] = [];
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "potential").actual).toBeGreaterThan(0);
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "planned").actual).toBe(0);
    const cmd = { type: "assign" as const, campaignId, date: "2026-10-15", shift: "DAY" as const, userId: actor.id };
    state = execute(execute(state, actor, cmd, now), actor, cmd, now);
    expect(state.assignments[key]).toEqual([actor.id]);
  });
  it("bloque publication déficitaire, affectation non éligible et rôle agent", () => {
    const state = createDemoState(now);
    expect(() => execute(state, actor, { type: "publish", campaignId, date: "2026-10-15", shift: "DAY" }, now)).toThrow(
      "Couvrez",
    );
    expect(() =>
      execute(state, actor, { type: "assign", campaignId, date: "2026-10-15", shift: "DAY", userId: "julien" }, now),
    ).toThrow("validée");
    expect(() => execute(state, { ...actor, role: "AGENT" }, { type: "close", campaignId, closed: true }, now)).toThrow(
      "responsable",
    );
  });
  it("ne mesure ni ne publie un créneau sans besoins définis", () => {
    const state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const date = "2026-10-15";
    const shift = "DAY" as const;
    const key = shiftKey(campaignId, date, shift);
    // The seed records its requirements; a centre that has not defined any is the
    // case that used to be filled in with an invented figure.
    expect(coverage(state, campaignId, date, shift, "potential").defined).toBe(true);
    delete state.requirements[key];
    const result = coverage(state, campaignId, date, shift, "planned");
    expect(result.defined).toBe(false);
    expect(result.need).toBeNull();
    expect(result.covered).toBe(false);
    // An eligible agent is affected: the missing requirement is the only obstacle,
    // and private.publish_schedule_shift() refuses that same case.
    state.assignments[key] = [actor.id];
    expect(() => execute(state, actor, { type: "publish", campaignId, date, shift }, now)).toThrow(
      "Définissez les besoins",
    );
  });
  it("garde la version publiée jusqu'à republication", () => {
    let state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const date = "2026-10-15";
    const shift = "DAY" as const;
    const key = shiftKey(campaignId, date, shift);
    state.assignments[key] = [actor.id];
    state = execute(
      state,
      actor,
      { type: "requirement", campaignId, date, shift, total: 1, qualifications: { Chef: 1 } },
      now,
    );
    state = execute(state, actor, { type: "publish", campaignId, date, shift }, now);
    const draft = execute(
      state,
      actor,
      { type: "assign", campaignId, date, shift, userId: actor.id, remove: true },
      now,
    );
    expect(draft.assignments[key]).toEqual([]);
    expect(draft.publications[key].agents).toEqual([actor.id]);
    expect(draft.publications[key].revision).toBe(1);
  });
  it("conserve les horaires des campagnes existantes après réglage", () => {
    const state = execute(createDemoState(now), actor, { type: "settings", dayStart: 7, nightStart: 19 }, now);
    expect(state.campaigns[0].dayStart).toBe(8);
    const updated = execute(
      state,
      actor,
      { type: "campaign", month: "2026-11", name: "Novembre", closesOn: "2026-10-23" },
      now,
    );
    expect(updated.campaigns[1].dayStart).toBe(7);
  });
});
describe("Exports", () => {
  it("exporte uniquement les publications personnelles et traverse le changement d'heure de Paris", () => {
    const state = createDemoState(now);
    state.publications[shiftKey(campaignId, "2026-10-24", "NIGHT")] = {
      agents: [actor.id],
      revision: 2,
      publishedAt: now.toISOString(),
    };
    const ics = personalCalendar(state, state.campaigns[0], actor.id);
    expect(ics).toContain("DTSTART:20261024T180000Z");
    expect(ics).toContain("DTEND:20261025T070000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SEQUENCE:2");
    expect(personalCalendar(state, state.campaigns[0], "marie")).not.toContain("BEGIN:VEVENT");
  });
  it("exporte le journal avec la date séparée de l’heure et le sujet en clair", () => {
    const state = execute(
      createDemoState(now),
      actor,
      { type: "availability", campaignId, dates: ["2026-10-01"], value: "DAY", comment: "" },
      now,
    );
    const lines = auditCsv(state.audit).split("\r\n");
    expect(lines[0]).toBe('\uFEFF"Date";"Heure";"Auteur";"Action";"Détail";"Sujet"');
    // L'entrée la plus récente d'abord, comme à l'écran, et son sujet lisible
    // plutôt que le nom de la table dont elle vient.
    expect(lines[1]).toContain('"2026-09-18";"12:00";"Julien Bernard"');
    expect(lines[1]).toContain('"Disponibilités"');
    expect(lines[lines.length - 1]).toContain('"Campagnes"');
  });
  it("neutralise une formule glissée dans le journal comme dans la matrice", () => {
    const state = createDemoState(now);
    state.audit[0].detail = '=HYPERLINK("bad")';
    const csv = auditCsv(state.audit);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
  it("neutralise les formules et conserve les caractères français du CSV", () => {
    const state = createDemoState(now);
    state.agents[0].name = '=HYPERLINK("bad")';
    const csv = availabilityCsv(state, state.campaigns[0]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain("Équipe");
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});

describe("Lecture du cahier des charges", () => {
  const base = {
    defined: true,
    covered: true,
    actual: 5,
    need: 4,
    qualifications: [] as { need: number; actual: number }[],
  };

  it("distingue le troisième niveau du §9 : couvert, limite, déficit", () => {
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
    let state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const hold = (date: string, shift: "DAY" | "NIGHT") => {
      state.assignments[shiftKey(campaignId, date, shift)] = [actor.id];
    };
    for (const key of Object.keys(state.assignments)) state.assignments[key] = [];
    hold("2026-10-01", "DAY");
    hold("2026-10-02", "NIGHT");
    // Les deux créneaux d’une même date : une garde de 24 h, pas deux gardes.
    hold("2026-10-03", "DAY");
    hold("2026-10-03", "NIGHT");
    expect(workload(state, campaignId, actor.id)).toEqual({ day: 1, night: 1, full: 1, total: 4 });
    expect(workload(state, campaignId, "marie")).toEqual({ day: 0, night: 0, full: 0, total: 0 });
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

  it("enregistre un modèle sans rien écrire dans les disponibilités", () => {
    const state = execute(createDemoState(now), actor, { type: "template", days: { "1": "DAY", "2": null } }, now);
    expect(state.template).toEqual({ "1": "DAY" });
    // Un modèle n’est pas une disponibilité : rien n’a bougé.
    expect(Object.keys(state.entries)).toEqual(Object.keys(createDemoState(now).entries));
  });

  it("applique le modèle, écrase les jours concernés et invalide la réponse", () => {
    const validated = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    expect(isValidated(validated, campaignId, actor.id)).toBe(true);
    const withTemplate = execute(validated, actor, { type: "template", days: { "1": "UNAVAILABLE" } }, now);
    const applied = execute(withTemplate, actor, { type: "applyTemplate", campaignId }, now);
    const mondays = monthDays("2026-10").filter(d => isoWeekday(d) === 1);
    for (const date of mondays) expect(applied.entries[entryKey(campaignId, actor.id, date)].type).toBe("UNAVAILABLE");
    // Les autres jours gardent ce qu’ils avaient.
    const tuesday = monthDays("2026-10").find(d => isoWeekday(d) === 2)!;
    expect(applied.entries[entryKey(campaignId, actor.id, tuesday)].type).toBe("FULL_24H");
    expect(isValidated(applied, campaignId, actor.id)).toBe(false);
  });

  it("refuse d’appliquer un modèle vide ou une campagne fermée", () => {
    const state = createDemoState(now);
    expect(() => execute(state, actor, { type: "applyTemplate", campaignId }, now)).toThrow("est vide");
    const withTemplate = execute(state, actor, { type: "template", days: { "1": "DAY" } }, now);
    const closed = execute(withTemplate, actor, { type: "close", campaignId, closed: true }, now);
    expect(() => execute(closed, actor, { type: "applyTemplate", campaignId }, now)).toThrow("fermée");
  });
});
