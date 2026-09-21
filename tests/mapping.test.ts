import { describe, expect, it } from "vitest";
import { buildState, taken, READ_FAILED, type Raw } from "../src/lib/data-mapping";
import {
  campaignAgents,
  coverage,
  entryKey,
  gradeLabel,
  isValidated,
  responseKey,
  shiftKey,
  visibleCampaigns,
  withdrawnFrom,
} from "../src/lib/domain";

const CAMPAIGN = "c1";
const SHIFT_DAY = "s-day";

// Rows shaped exactly as the queries in data.server.ts return them; those
// queries are checked against the real schema, this checks what we do with them.
function raw(overrides: Partial<Raw> = {}): Raw {
  return {
    organization: { name: "CIS Test", day_start: 7, night_start: 19 },
    members: [
      {
        user_id: "u1",
        role: "ADMIN",
        team_id: "t1",
        active: true,
        profiles: { display_name: "Chef Un", grade: "Sergent", matricule: "SP-7", phone: "06 24 18 00 00" },
        teams: { name: "Section Test" },
      },
      { user_id: "u2", role: "AGENT", team_id: "t1", active: true, profiles: null, teams: null },
      { user_id: "u3", role: "AGENT", team_id: "t1", active: false, profiles: { display_name: "Parti" }, teams: null },
    ],
    teams: [{ id: "t1", name: "Section Test" }],
    qualificationCatalogue: [{ name: "SAP" }, { name: "Chef" }],
    template: [
      { weekday: 1, availability_type: "DAY" },
      { weekday: 6, availability_type: "FULL_24H" },
      { weekday: 3, availability_type: "INCONNU" },
    ],
    invitations: [
      {
        id: "i1",
        email: "attendu@example.org",
        display_name: "Attendu",
        role: "AGENT",
        team_id: "t1",
        created_at: "2026-09-20T08:00:00Z",
      },
    ],
    notifications: [
      {
        id: "n1",
        kind: "CAMPAIGN_OPENED",
        subject: "Campagne ouverte : Disponibilités d’octobre 2026",
        body: null,
        created_at: "2026-09-01T08:00:00Z",
        read_at: null,
      },
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
        team_id: "t1",
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
      {
        schedule_shift_id: SHIFT_DAY,
        user_id: "u1",
        revision: 0,
        status: "PROPOSED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
      {
        schedule_shift_id: SHIFT_DAY,
        user_id: "u2",
        revision: 0,
        status: "CANCELLED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
      {
        schedule_shift_id: SHIFT_DAY,
        user_id: "u1",
        revision: 2,
        status: "CONFIRMED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
      {
        schedule_shift_id: SHIFT_DAY,
        user_id: "u2",
        revision: 2,
        status: "CONFIRMED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
      {
        schedule_shift_id: SHIFT_DAY,
        user_id: "u2",
        revision: 1,
        status: "CONFIRMED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
      {
        schedule_shift_id: "s-orphelin",
        user_id: "u1",
        revision: 0,
        status: "PROPOSED",
        assigned_at: "2026-09-18T08:00:00Z",
      },
    ],
    withdrawals: [
      {
        id: "w1",
        schedule_shift_id: SHIFT_DAY,
        user_id: "u1",
        reason: "Convocation",
        state: "PENDING",
        created_at: "2026-10-05T08:00:00Z",
        decided_at: null,
      },
      // Créneau inconnu : la ligne se jette plutôt que de porter une date vide.
      {
        id: "w2",
        schedule_shift_id: "s-orphelin",
        user_id: "u2",
        reason: null,
        state: "PENDING",
        created_at: "2026-10-05T09:00:00Z",
        decided_at: null,
      },
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
      grade: "Sergent",
      fonction: "",
      matricule: "SP-7",
      phone: "06 24 18 00 00",
      qualifications: ["Chef", "SAP"],
      role: "ADMIN",
      teamId: "t1",
    });
    // Profil ou équipe absents : des libellés neutres, jamais un écran cassé.
    expect(state.agents[1].name).toBe("Agent");
    expect(state.agents[1].team).toBe("Équipe");
    expect(state.agents[1].qualifications).toEqual([]);
    // Le grade stocké reste vide ; c’est l’affichage qui retombe sur le rôle.
    expect(state.agents[1].grade).toBe("");
    expect(gradeLabel(state.agents[1])).toBe("Agent");
    expect(state.agents[1].matricule).toBe("");
    expect(state.agents[1].phone).toBe("");
  });

  it("garde le périmètre de la campagne, et pas seulement ses validations", () => {
    const state = buildState(raw(), "Secours");
    // u1 a validé, u2 non : les deux sont participants, et la projection ne
    // gardait que le premier. Le périmètre disparaissait avec le second.
    expect(state.campaigns[0].participants.sort()).toEqual(["u1", "u2"]);
    expect(state.campaigns[0].teamId).toBe("t1");
  });

  it("compte le taux de réponse sur les invités, pas sur le centre", () => {
    // Le scénario de l’audit : un centre de deux agents actifs, une campagne
    // ouverte à un seul, qui a validé. Le taux est de 100 %, pas de 50 % — le
    // second n’a jamais été invité, il n’est donc pas un non-répondant.
    const state = buildState(
      raw({ participants: [{ campaign_id: CAMPAIGN, user_id: "u1", validated_at: "2026-09-17T09:30:00Z" }] }),
      "Secours",
    );
    const concerned = campaignAgents(state, CAMPAIGN);
    expect(concerned.map(a => a.id)).toEqual(["u1"]);
    expect(concerned.filter(a => isValidated(state, CAMPAIGN, a.id))).toHaveLength(1);
    // L’effectif actif du centre en compte bien deux : c’est la comparaison
    // avec lui qui donnait 50 %.
    expect(state.agents).toHaveLength(2);
  });

  it("écarte du périmètre un participant qui a quitté l’effectif actif", () => {
    // u3 est désactivé. Même invité, il ne doit peser sur aucun taux.
    const state = buildState(
      raw({
        participants: [
          { campaign_id: CAMPAIGN, user_id: "u1", validated_at: null },
          { campaign_id: CAMPAIGN, user_id: "u3", validated_at: null },
        ],
      }),
      "Secours",
    );
    expect(state.campaigns[0].participants).toContain("u3");
    expect(campaignAgents(state, CAMPAIGN).map(a => a.id)).toEqual(["u1"]);
  });

  it("ne propose à un agent que les campagnes où il est convié", () => {
    const state = buildState(raw(), "Secours");
    expect(visibleCampaigns(state, "u1", false).map(c => c.id)).toEqual([CAMPAIGN]);
    expect(visibleCampaigns(state, "inconnu", false)).toEqual([]);
    // Qui encadre les voit toutes, y compris celles d’une autre équipe.
    expect(visibleCampaigns(state, "inconnu", true).map(c => c.id)).toEqual([CAMPAIGN]);
  });

  it("ne bloque que sur un désistement accepté après l’affectation", () => {
    const withdrawal = {
      id: "w1",
      schedule_shift_id: SHIFT_DAY,
      user_id: "u1",
      reason: "",
      state: "ACCEPTED",
      created_at: "2026-09-19T08:00:00Z",
    };
    // L'affectation du brouillon date du 18. Une décision du 19 l'écarte.
    const after = buildState(raw({ withdrawals: [{ ...withdrawal, decided_at: "2026-09-19T09:00:00Z" }] }), "S");
    expect(after.withdrawals[0].blocking).toBe(true);
    expect(withdrawnFrom(after, CAMPAIGN, "2026-10-01", "DAY").has("u1")).toBe(true);

    // Une décision du 17, suivie d'une réaffectation le 18 : l'encadrement a
    // remis l'agent en connaissance de cause, et rien ne doit plus bloquer.
    const before = buildState(raw({ withdrawals: [{ ...withdrawal, decided_at: "2026-09-17T09:00:00Z" }] }), "S");
    expect(before.withdrawals[0].blocking).toBe(false);

    // En attente : ce n'est pas encore une décision.
    const pending = buildState(raw({ withdrawals: [{ ...withdrawal, state: "PENDING", decided_at: null }] }), "S");
    expect(pending.withdrawals[0].blocking).toBe(false);
  });

  it("retire de la couverture planifiée un agent qui s’est désisté", () => {
    const withdrawn = buildState(
      raw({
        // u1 est au brouillon depuis le 18 ; sa demande est accordée le 19.
        withdrawals: [
          {
            id: "w1",
            schedule_shift_id: SHIFT_DAY,
            user_id: "u1",
            reason: "",
            state: "ACCEPTED",
            created_at: "2026-09-19T08:00:00Z",
            decided_at: "2026-09-19T09:00:00Z",
          },
        ],
        requirements: [
          {
            campaign_id: CAMPAIGN,
            date: "2026-10-01",
            shift_code: "DAY",
            headcount: 1,
            staffing_requirement_qualifications: null,
          },
        ],
      }),
      "S",
    );
    const result = coverage(withdrawn, CAMPAIGN, "2026-10-01", "DAY", "planned");
    // L'effectif est atteint, mais la publication refuserait : l'écran ne doit
    // donc pas annoncer « couvert » jusqu'au clic.
    expect(result.actual).toBe(1);
    expect(result.invalid.map(a => a.id)).toEqual(["u1"]);
    expect(result.covered).toBe(false);
  });

  it("distingue une lecture vide d’une lecture qui a échoué", () => {
    // Une absence légitime : RLS renvoie un ensemble vide, sans erreur.
    expect(taken("disponibilités", { data: [], error: null }, [])).toEqual([]);
    expect(taken("disponibilités", { data: null, error: null }, [])).toEqual([]);
    // Une panne : elle doit s’entendre, et non ressembler à « personne n’a répondu ».
    expect(() => taken("disponibilités", { data: null, error: { message: "boom" } }, [])).toThrow(READ_FAILED);
    // Le message de la base ne remonte pas à l’écran : il décrirait le schéma.
    expect(() => taken("disponibilités", { data: null, error: { message: "relation x" } }, [])).not.toThrow(/relation/);
  });

  it("rend le repli demandé, et non une liste vide, pour une lecture d’objet", () => {
    // L’organisation est lue avec maybeSingle : « rien » y vaut null, pas [].
    // Un repli déduit aurait rendu un tableau là où l’appelant attend un objet.
    expect(taken("organisation", { data: null, error: null }, null)).toBeNull();
  });

  it("rattache un désistement à sa garde, et jette celui dont le créneau manque", () => {
    const state = buildState(raw(), "Secours");
    // Le créneau ne connaît que son planning, et le planning sa campagne : la
    // projection remonte la chaîne pour donner une date et un créneau lisibles.
    expect(state.withdrawals).toEqual([
      {
        // En attente : aucune décision, donc rien qui écarte l'agent.
        blocking: false,
        id: "w1",
        shiftId: SHIFT_DAY,
        campaignId: "c1",
        date: "2026-10-01",
        shift: "DAY",
        userId: "u1",
        reason: "Convocation",
        state: "PENDING",
        createdAt: "2026-10-05T08:00:00Z",
      },
    ]);
  });

  it("sort les agents désactivés de l’effectif, sans les perdre", () => {
    const state = buildState(raw(), "Secours");
    // Un agent désactivé ne doit reparaître ni dans une synthèse, ni dans un vivier.
    expect(state.agents.map(a => a.id)).toEqual(["u1", "u2"]);
    expect(state.inactiveAgents.map(a => a.name)).toEqual(["Parti"]);
    expect(state.teams).toEqual([{ id: "t1", name: "Section Test" }]);
    // Le catalogue est trié pour l’affichage, pas dans l’ordre des lignes.
    expect(state.qualificationCatalogue).toEqual(["Chef", "SAP"]);
    expect(state.invitations).toEqual([
      {
        id: "i1",
        email: "attendu@example.org",
        name: "Attendu",
        role: "AGENT",
        teamId: "t1",
        team: "Section Test",
        createdAt: "2026-09-20T08:00:00Z",
      },
    ]);
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
    // L’entité voyage avec la ligne : c’est sur elle que l’écran filtre.
    expect(state.audit.map(e => e.entity)).toEqual([
      "schedule_shift",
      "staffing_requirement",
      "availability_entry",
      "organization",
    ]);
  });

  it("retombe sur le nom de la session si l’organisation n’est pas lisible", () => {
    const state = buildState(raw({ organization: null }), "Secours");
    expect(state.organization).toEqual({ name: "Secours", dayStart: 8, nightStart: 20 });
  });
});
