import { describe, expect, it } from "vitest";
import { createDemoState } from "../src/lib/seed";
import { availableAgents, coverage, execute, filledDays, isValidated, monthDays, responseKey, shiftKey } from "../src/lib/domain";
import { personalCalendar, availabilityCsv } from "../src/lib/exports";

const now = new Date("2026-09-18T10:00:00Z");
const campaignId = "campaign-2026-10";
const actor = { id: "julien", role: "MANAGER" as const };
function fullResponse() {
  return execute(createDemoState(), actor, { type: "availability", campaignId, dates: monthDays("2026-10"), value: "FULL_24H", comment: "" }, now);
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
    expect(() => execute(createDemoState(), actor, { type: "validate", campaignId }, now)).toThrow("chaque jour");
    expect(() => execute(createDemoState(), actor, { type: "availability", campaignId, dates: ["2026-11-01"], value: "DAY", comment: "" }, now)).toThrow("dates dans la campagne");
  });
  it("invalide la réponse après modification sans toucher aux autres agents", () => {
    const submitted = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const edited = execute(submitted, actor, { type: "availability", campaignId, dates: ["2026-10-15"], value: "UNAVAILABLE", comment: "" }, now);
    expect(isValidated(edited, campaignId, actor.id)).toBe(false);
    expect(edited.responses[responseKey(campaignId, "marie")]).toBe(submitted.responses[responseKey(campaignId, "marie")]);
    expect(isValidated(submitted, campaignId, actor.id)).toBe(true);
  });
  it("refuse toute saisie après clôture ou en dehors de la fenêtre", () => {
    const closed = execute(createDemoState(), actor, { type: "close", campaignId, closed: true }, now);
    const command = { type: "availability" as const, campaignId, dates: ["2026-10-01"], value: "DAY" as const, comment: "" };
    expect(() => execute(closed, actor, command, now)).toThrow("fermée");
    expect(() => execute(createDemoState(), actor, command, new Date("2026-10-01T10:00:00Z"))).toThrow("fermée");
  });
});
describe("Couverture et publication", () => {
  it("compte le 24 h une fois dans chaque créneau, après validation uniquement", () => {
    let state = fullResponse();
    expect(availableAgents(state, campaignId, "2026-10-15", "DAY").some(a => a.id === actor.id)).toBe(false);
    state = execute(state, actor, { type: "validate", campaignId }, now);
    for (const shift of ["DAY", "NIGHT"] as const) expect(availableAgents(state, campaignId, "2026-10-15", shift).filter(a => a.id === actor.id)).toHaveLength(1);
  });
  it("ne confond pas disponibles et affectés, et déduplique les affectations", () => {
    let state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const key = shiftKey(campaignId, "2026-10-15", "DAY"); state.assignments[key] = [];
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "potential").actual).toBeGreaterThan(0);
    expect(coverage(state, campaignId, "2026-10-15", "DAY", "planned").actual).toBe(0);
    const cmd = { type: "assign" as const, campaignId, date: "2026-10-15", shift: "DAY" as const, userId: actor.id };
    state = execute(execute(state, actor, cmd, now), actor, cmd, now);
    expect(state.assignments[key]).toEqual([actor.id]);
  });
  it("bloque publication déficitaire, affectation non éligible et rôle agent", () => {
    const state = createDemoState();
    expect(() => execute(state, actor, { type: "publish", campaignId, date: "2026-10-15", shift: "DAY" }, now)).toThrow("Couvrez");
    expect(() => execute(state, actor, { type: "assign", campaignId, date: "2026-10-15", shift: "DAY", userId: "julien" }, now)).toThrow("validée");
    expect(() => execute(state, { ...actor, role: "AGENT" }, { type: "close", campaignId, closed: true }, now)).toThrow("responsable");
  });
  it("garde la version publiée jusqu'à republication", () => {
    let state = execute(fullResponse(), actor, { type: "validate", campaignId }, now);
    const date = "2026-10-15"; const shift = "DAY" as const; const key = shiftKey(campaignId, date, shift);
    state.assignments[key] = [actor.id];
    state = execute(state, actor, { type: "requirement", campaignId, date, shift, total: 1, qualifications: { Chef: 1 } }, now);
    state = execute(state, actor, { type: "publish", campaignId, date, shift }, now);
    const draft = execute(state, actor, { type: "assign", campaignId, date, shift, userId: actor.id, remove: true }, now);
    expect(draft.assignments[key]).toEqual([]);
    expect(draft.publications[key].agents).toEqual([actor.id]);
    expect(draft.publications[key].revision).toBe(1);
  });
  it("conserve les horaires des campagnes existantes après réglage", () => {
    const state = execute(createDemoState(), actor, { type: "settings", dayStart: 7, nightStart: 19 }, now);
    expect(state.campaigns[0].dayStart).toBe(8);
    const updated = execute(state, actor, { type: "campaign", month: "2026-11", name: "Novembre", closesOn: "2026-10-23" }, now);
    expect(updated.campaigns[1].dayStart).toBe(7);
  });
});
describe("Exports", () => {
  it("exporte uniquement les publications personnelles et traverse le changement d'heure de Paris", () => {
    const state = createDemoState();
    state.publications[shiftKey(campaignId, "2026-10-24", "NIGHT")] = { agents: [actor.id], revision: 2, publishedAt: now.toISOString() };
    const ics = personalCalendar(state, state.campaigns[0], actor.id);
    expect(ics).toContain("DTSTART:20261024T180000Z");
    expect(ics).toContain("DTEND:20261025T070000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("SEQUENCE:2");
    expect(personalCalendar(state, state.campaigns[0], "marie")).not.toContain("BEGIN:VEVENT");
  });
  it("neutralise les formules et conserve les caractères français du CSV", () => {
    const state = createDemoState(); state.agents[0].name = '=HYPERLINK("bad")';
    const csv = availabilityCsv(state, state.campaigns[0]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain("Équipe"); expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});
