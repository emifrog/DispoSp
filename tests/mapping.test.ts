import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildState, campaignsToLoad, taken, READ_FAILED, type Raw } from "../src/lib/data-mapping";
import {
  auditFamilies,
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

  // Les deux horodatages étaient comparés comme du texte : juste tant que la
  // base écrit les deux avec le même décalage et la même précision.
  it("compare décision et affectation comme des instants, quels que soient décalage et précision", () => {
    const withdrawal = {
      id: "w1",
      schedule_shift_id: SHIFT_DAY,
      user_id: "u1",
      reason: "",
      state: "ACCEPTED",
      created_at: "2026-09-18T07:00:00Z",
    };
    const decided = (decided_at: string) =>
      buildState(raw({ withdrawals: [{ ...withdrawal, decided_at }] }), "S").withdrawals[0].blocking;
    // L'affectation date de 08:00 UTC. 09:30 à Paris, c'est 07:30 UTC : avant.
    expect(decided("2026-09-18T09:30:00+02:00")).toBe(false);
    // Une demi-seconde après, écrite avec des microsecondes : après.
    expect(decided("2026-09-18T08:00:00.500000+00:00")).toBe(true);
    // 10:30 à Paris, 08:30 UTC : après, quoi qu'en dise l'ordre des chaînes.
    expect(decided("2026-09-18T10:30:00+02:00")).toBe(true);
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
        decidedAt: null,
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

// Point 7 de l'audit de déployabilité : le détail ne se lit que sur une fenêtre.
describe("Fenêtre de chargement", () => {
  const campaigns = [
    { id: "ancienne", starts_on: "2024-03-01" },
    { id: "limite", starts_on: "2025-10-01" },
    { id: "courante", starts_on: "2026-09-01" },
    { id: "a-venir", starts_on: "2026-11-01" },
  ];

  it("lit la fenêtre, et l’archive que l’adresse demande", () => {
    expect(campaignsToLoad(campaigns, "2025-10-01")).toEqual(["limite", "courante", "a-venir"]);
    expect(campaignsToLoad(campaigns, "2025-10-01", "ancienne")).toEqual(["ancienne", "limite", "courante", "a-venir"]);
    // Une campagne inconnue demandée par l'adresse n'ajoute rien.
    expect(campaignsToLoad(campaigns, "2025-10-01", "inconnue")).toHaveLength(3);
  });

  it("marque les archives et ce qui a été lu, sans rien marquer hors fenêtre", () => {
    const [plain] = buildState(raw(), "Secours").campaigns;
    expect(plain).toMatchObject({ archived: false, loaded: true });
    const [archived] = buildState(raw(), "Secours", { since: "2099-01-01", loaded: [] }).campaigns;
    expect(archived).toMatchObject({ archived: true, loaded: false });
    const [asked] = buildState(raw(), "Secours", { since: "2099-01-01", loaded: [CAMPAIGN] }).campaigns;
    expect(asked).toMatchObject({ archived: true, loaded: true });
  });
});

/**
 * Chaque couple entité/action que les migrations écrivent au journal.
 *
 * Même principe que le test qui vérifie la traduction de chaque refus : la
 * liste est relue dans les migrations, pas recopiée ici. Un déclencheur qui
 * ajoute une action sans libellé ferait apparaître un code brut à l'écran —
 * c'est ce qui est arrivé aux désistements —, et une entité sans famille
 * échapperait au filtre par sujet comme à la colonne Sujet de l'export.
 */
describe("Journal d’audit : libellés de tout ce que la base écrit", () => {
  const folder = new URL("../supabase/migrations/", import.meta.url);
  const sql = readdirSync(folder)
    .filter(file => file.endsWith(".sql"))
    .sort()
    .map(file => readFileSync(new URL(file, folder), "utf8"))
    .join("\n")
    // Les commentaires d'abord : ils citent parfois du code.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");

  /** Les arguments de premier niveau d'une liste qui s'ouvre à `start`, jusqu'à la parenthèse fermante. */
  function argumentsFrom(text: string, start: number) {
    const found: string[] = [];
    let depth = 0;
    let quoted = false;
    let current = "";
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (char === "'") quoted = !quoted;
      else if (!quoted && char === "(") depth++;
      else if (!quoted && char === ")" && depth-- === 0) {
        found.push(current.trim());
        return found;
      } else if (!quoted && char === "," && depth === 0) {
        found.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    throw new Error("Liste d’arguments non refermée");
  }

  /**
   * Les actions qu'une expression peut produire : ses littéraux en capitales,
   * moins les comparaisons à `TG_OP`. Une action recopiée d'une colonne
   * (`new.state`) prend les valeurs que la contrainte de la table autorise.
   */
  function actionsOf(expression: string, name: string) {
    const actions = [...expression.replace(/TG_OP\s*=\s*'[A-Z]+'/g, "").matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
    for (const [, column] of expression.matchAll(/new\.(\w+)/g)) {
      const table = sql.match(
        new RegExp(String.raw`on public\.(\w+)\s+for each row execute function private\.${name}\(`),
      )?.[1];
      const definition = sql.match(new RegExp(String.raw`create table public\.${table} \(([\s\S]*?)\n\);`))?.[1] ?? "";
      const allowed = definition.match(
        new RegExp(String.raw`${column} text[^\n]*check \(${column} in \(([^)]*)\)\)`),
      )?.[1];
      expect(allowed, `${name} : valeurs de ${table}.${column}`).toBeTruthy();
      actions.push(...[...allowed!.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]));
    }
    return actions;
  }

  const pairs = new Set<string>();
  for (const block of sql.matchAll(
    /create (?:or replace )?function private\.(\w+)\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/g,
  )) {
    const [, name, body] = block;
    for (const insert of body.matchAll(/insert into public\.audit_logs\s*\(([^)]*)\)\s*values\s*\(/g)) {
      const columns = insert[1].split(",").map(column => column.trim());
      const values = argumentsFrom(body, insert.index! + insert[0].length);
      const entity = values[columns.indexOf("entity")];
      const action = values[columns.indexOf("action")];
      const literal = entity.match(/^'(\w+)'$/)?.[1];
      if (literal) {
        for (const each of actionsOf(action, name)) pairs.add(`${literal}/${each}`);
        continue;
      }
      // L'entité vient d'une variable : une branche par table, chacune pose
      // `entity := '…'` puis `action := …;`.
      const branches = body.split(/entity := '/).slice(1);
      expect(branches.length, name).toBeGreaterThan(0);
      for (const branch of branches) {
        const table = branch.slice(0, branch.indexOf("'"));
        const assigned = branch.match(/action := ([\s\S]*?);/)?.[1];
        expect(assigned, `${name} : action de ${table}`).toBeTruthy();
        for (const each of actionsOf(assigned!, name)) pairs.add(`${table}/${each}`);
      }
    }
  }

  it("retrouve dans les migrations ce que le journal contient", () => {
    // Garde-fou du garde-fou : une extraction vide ferait passer le reste.
    expect(pairs.size).toBeGreaterThanOrEqual(30);
    for (const known of [
      "availability_entry/SET",
      "campaign_participant/UNVALIDATE",
      "schedule_shift/PUBLISH",
      "membership/DEACTIVATE",
      "invitation/ACCEPT",
      "shift_withdrawal/CREATE",
      "shift_withdrawal/ACCEPTED",
      "shift_withdrawal/CANCELLED",
    ])
      expect(pairs, known).toContain(known);
  });

  it("donne un libellé français à chaque couple", () => {
    const rows = [...pairs].map((pair, index) => {
      const [entity, action] = pair.split("/");
      return {
        id: index,
        occurred_at: "2026-09-25T08:00:00Z",
        action,
        entity,
        actor_id: null,
        old_value: null,
        new_value: { user_id: "u1", date: "2026-10-01", shift_code: "DAY", headcount: 2 },
      };
    });
    const state = buildState(raw({ audit: rows }), "S");
    const raw_codes = state.audit.filter(line => line.action.includes(" · ")).map(line => line.action);
    expect(raw_codes).toEqual([]);
  });

  it("range chaque entité dans une famille du filtre", () => {
    const families = new Set(auditFamilies.flatMap(family => [...family.entities] as string[]));
    const orphans = [...new Set([...pairs].map(pair => pair.split("/")[0]))].filter(entity => !families.has(entity));
    expect(orphans).toEqual([]);
  });

  it("montre les désistements sous leur nom, avec l’agent concerné", () => {
    const state = buildState(
      raw({
        audit: [
          {
            id: 1,
            occurred_at: "2026-09-25T08:00:00Z",
            action: "ACCEPTED",
            entity: "shift_withdrawal",
            actor_id: "u1",
            old_value: { user_id: "u2", state: "PENDING", reason: "Enfant malade" },
            new_value: { user_id: "u2", state: "ACCEPTED", reason: "Enfant malade" },
          },
        ],
      }),
      "S",
    );
    expect(state.audit[0]).toMatchObject({
      action: "Désistement accepté",
      actor: "Chef Un",
      entity: "shift_withdrawal",
    });
    // Le motif peut être personnel : il ne passe pas dans l'historique.
    expect(state.audit[0].detail).not.toContain("Enfant");
  });
});
