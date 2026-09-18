import { describe, expect, it } from "vitest";
import { buildState, type Raw } from "../src/lib/data-mapping";
import { entryKey, responseKey, shiftKey } from "../src/lib/domain";

const CAMPAIGN = "c1";
const SHIFT_DAY = "s-day";

// Rows shaped exactly as the queries in data.server.ts return them; those
// queries are checked against the real schema, this checks what we do with them.
function raw(overrides: Partial<Raw> = {}): Raw {
  return {
    organization: { name: "CIS Test", day_start: 7, night_start: 19 },
    members: [
      { user_id: "u1", role: "ADMIN", profiles: { display_name: "Chef Un" }, teams: { name: "Section Test" } },
      { user_id: "u2", role: "AGENT", profiles: null, teams: null },
    ],
    memberQualifications: [
      { user_id: "u1", qualifications: { name: "Chef" } },
      { user_id: "u1", qualifications: { name: "SAP" } },
      { user_id: "u2", qualifications: null },
    ],
    campaigns: [
      {
        id: CAMPAIGN,
        name: "Disponibilités d’octobre 2026",
        starts_on: "2026-10-01",
        opens_at: "2026-08-31T22:00:00Z",
        closes_at: "2026-09-30T21:59:59Z",
        locked: false,
        day_start: 8,
        night_start: 20,
      },
    ],
    participants: [
      { campaign_id: CAMPAIGN, user_id: "u1", validated_at: "2026-09-17T09:30:00Z" },
      { campaign_id: CAMPAIGN, user_id: "u2", validated_at: null },
    ],
    entries: [
      { campaign_id: CAMPAIGN, user_id: "u1", date: "2026-10-01", availability_type: "FULL_24H", comment: null },
      { campaign_id: CAMPAIGN, user_id: "u2", date: "2026-10-01", availability_type: "DAY", comment: "après 9 h" },
      { campaign_id: CAMPAIGN, user_id: "u2", date: "2026-10-02", availability_type: "INCONNU", comment: null },
    ],
    requirements: [
      {
        campaign_id: CAMPAIGN,
        date: "2026-10-01",
        shift_code: "DAY",
        headcount: 4,
        staffing_requirement_qualifications: [
          { minimum: 1, qualifications: { name: "Chef" } },
          { minimum: 2, qualifications: null },
        ],
      },
    ],
    schedules: [{ id: "sch1", campaign_id: CAMPAIGN }],
    shifts: [
      {
        id: SHIFT_DAY,
        schedule_id: "sch1",
        date: "2026-10-01",
        shift_code: "DAY",
        published_revision: 2,
        published_at: "2026-09-20T08:00:00Z",
      },
      {
        id: "s-orphelin",
        schedule_id: "planning-absent",
        date: "2026-10-01",
        shift_code: "NIGHT",
        published_revision: 0,
        published_at: null,
      },
    ],
    assignments: [
      { schedule_shift_id: SHIFT_DAY, user_id: "u1", revision: 0, status: "PROPOSED" },
      { schedule_shift_id: SHIFT_DAY, user_id: "u2", revision: 0, status: "CANCELLED" },
      { schedule_shift_id: SHIFT_DAY, user_id: "u1", revision: 2, status: "CONFIRMED" },
      { schedule_shift_id: SHIFT_DAY, user_id: "u2", revision: 2, status: "CONFIRMED" },
      { schedule_shift_id: SHIFT_DAY, user_id: "u2", revision: 1, status: "CONFIRMED" },
      { schedule_shift_id: "s-orphelin", user_id: "u1", revision: 0, status: "PROPOSED" },
    ],
    audit: [
      {
        id: 7,
        occurred_at: "2026-09-20T08:00:00Z",
        action: "PUBLISH",
        entity: "schedule_shift",
        actor_id: "u1",
        old_value: { revision: 1 },
        new_value: { revision: 2, headcount: 3 },
      },
      {
        id: 8,
        occurred_at: "2026-09-21T08:00:00Z",
        action: "PUBLISH",
        entity: "schedule_shift",
        actor_id: "inconnu",
        old_value: null,
        new_value: null,
      },
    ],
    ...overrides,
  };
}

describe("Construction de l’état depuis la base", () => {
  it("convertit la fenêtre de réponse en jours de Paris, pas en jours UTC", () => {
    const state = buildState(raw(), "Secours");
    const campaign = state.campaigns[0];
    // 31/08 22:00 UTC, c’est le 1er septembre à Paris ; 30/09 21:59:59 UTC, le 30.
    expect(campaign.opensOn).toBe("2026-09-01");
    expect(campaign.closesOn).toBe("2026-09-30");
    expect(campaign.month).toBe("2026-10");
    expect(campaign.dayStart).toBe(8);
  });

  it("garde les horaires de l’organisation et complète les agents incomplets", () => {
    const state = buildState(raw(), "Secours");
    expect(state.organization).toEqual({ name: "CIS Test", dayStart: 7, nightStart: 19 });
    expect(state.agents[0]).toEqual({
      id: "u1",
      name: "Chef Un",
      team: "Section Test",
      grade: "Administrateur",
      qualifications: ["Chef", "SAP"],
    });
    // Profil ou équipe absents : des libellés neutres, jamais un écran cassé.
    expect(state.agents[1].name).toBe("Agent");
    expect(state.agents[1].team).toBe("Équipe");
    expect(state.agents[1].qualifications).toEqual([]);
  });

  it("ne retient que les réponses validées et les disponibilités connues", () => {
    const state = buildState(raw(), "Secours");
    expect(state.responses[responseKey(CAMPAIGN, "u1")]).toBe("2026-09-17T09:30:00Z");
    expect(state.responses[responseKey(CAMPAIGN, "u2")]).toBeUndefined();
    expect(state.entries[entryKey(CAMPAIGN, "u2", "2026-10-01")]).toEqual({ type: "DAY", comment: "après 9 h" });
    expect(state.entries[entryKey(CAMPAIGN, "u1", "2026-10-01")].comment).toBe("");
    // Un type que le domaine ne connaît pas est ignoré plutôt que propagé.
    expect(state.entries[entryKey(CAMPAIGN, "u2", "2026-10-02")]).toBeUndefined();
  });

  it("sépare le brouillon de la version publiée et ignore les révisions périmées", () => {
    const state = buildState(raw(), "Secours");
    const key = shiftKey(CAMPAIGN, "2026-10-01", "DAY");
    // Brouillon : révision 0, sans les affectations annulées.
    expect(state.assignments[key]).toEqual(["u1"]);
    // Publié : uniquement la révision que le créneau désigne comme publiée.
    expect(state.publications[key]).toEqual({
      agents: ["u1", "u2"],
      publishedAt: "2026-09-20T08:00:00Z",
      revision: 2,
    });
  });

  it("écarte un créneau dont le planning est hors de portée", () => {
    const state = buildState(raw(), "Secours");
    // Le planning n’a pas été lu (RLS, ou autre campagne) : aucune clé inventée.
    expect(Object.keys(state.assignments)).toEqual([shiftKey(CAMPAIGN, "2026-10-01", "DAY")]);
  });

  it("nomme les besoins par qualification et ignore une qualification illisible", () => {
    const state = buildState(raw(), "Secours");
    expect(state.requirements[shiftKey(CAMPAIGN, "2026-10-01", "DAY")]).toEqual({
      total: 4,
      qualifications: { Chef: 1 },
    });
  });

  it("résout l’auteur du journal, sans inventer de nom", () => {
    const state = buildState(raw(), "Secours");
    expect(state.audit[0].actor).toBe("Chef Un");
    expect(state.audit[1].actor).toBe("—");
  });

  it("traduit le journal sans jamais afficher de JSON ni de code anglais", () => {
    const state = buildState(
      raw({
        audit: [
          {
            id: 1,
            occurred_at: "2026-09-20T08:00:00Z",
            action: "PUBLISH",
            entity: "schedule_shift",
            actor_id: "u1",
            old_value: { revision: 0 },
            new_value: { revision: 1, headcount: 1 },
          },
          {
            id: 2,
            occurred_at: "2026-09-20T09:00:00Z",
            action: "SET",
            entity: "staffing_requirement",
            actor_id: "u1",
            old_value: { date: "2026-10-01", shift_code: "NIGHT", headcount: 6 },
            new_value: { date: "2026-10-01", shift_code: "NIGHT", headcount: 1 },
          },
          {
            id: 3,
            occurred_at: "2026-09-20T10:00:00Z",
            action: "SET",
            entity: "availability_entry",
            actor_id: "u1",
            old_value: null,
            new_value: { date: "2026-10-01", availability_type: "FULL_24H" },
          },
          {
            id: 4,
            occurred_at: "2026-09-20T11:00:00Z",
            action: "HOURS",
            entity: "organization",
            actor_id: "u1",
            old_value: { day_start: 8, night_start: 20 },
            new_value: { day_start: 7, night_start: 19 },
          },
        ],
      }),
      "Secours",
    );
    expect(state.audit.map(e => `${e.action} — ${e.detail}`)).toEqual([
      "Créneau publié — version 1 · 1 agent",
      "Besoins définis — 1 octobre · Nuit · 6 → 1 agent",
      "Disponibilité renseignée — 1 octobre · 24 h",
      "Horaires par défaut modifiés — 8 h – 20 h → 7 h – 19 h",
    ]);
    for (const event of state.audit) expect(`${event.action}${event.detail}`).not.toMatch(/[{}"]|_[a-z]/);
  });

  it("retombe sur le nom de la session si l’organisation n’est pas lisible", () => {
    const state = buildState(raw({ organization: null }), "Secours");
    expect(state.organization).toEqual({ name: "Secours", dayStart: 8, nightStart: 20 });
  });
});
