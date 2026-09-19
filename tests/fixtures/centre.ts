import {
  type AppState,
  type Availability,
  monthDays,
  entryKey,
  responseKey,
  shiftKey,
  availableAgents,
  elide,
  lastDayOfMonth,
  localMonth,
  shiftMonth,
  suggestedRequirement,
} from "../../src/lib/domain";

function campaignName(month: string) {
  return `Disponibilités ${elide(new Date(`${month}-01T12:00:00`).toLocaleDateString("fr-FR", { month: "long" }))}`;
}

// Un centre d'exemple complet, utilisable quelle que soit la date : les réponses se
// collectent pendant le mois courant, pour le mois qui suit.
export function sampleState(now = new Date()): AppState {
  const responseMonth = localMonth(now);
  const month = shiftMonth(responseMonth, 1);
  const opensOn = `${responseMonth}-01`;
  const closesOn = lastDayOfMonth(responseMonth);
  const state: AppState = {
    version: 1,
    organization: { name: "CIS Val de Loire", dayStart: 8, nightStart: 20 },
    agents: [
      {
        id: "julien",
        name: "Julien Bernard",
        team: "Équipe Alpha",
        grade: "Sergent",
        matricule: "SP-1001",
        phone: "06 24 18 01 01",
        role: "AGENT",
        teamId: "",
        qualifications: ["Chef", "SAP"],
      },
      {
        id: "marie",
        name: "Marie Lambert",
        team: "Équipe Alpha",
        grade: "Sergent",
        matricule: "SP-1002",
        phone: "06 24 18 02 02",
        role: "AGENT",
        teamId: "",
        qualifications: ["Chef", "SAP", "Conducteur PL"],
      },
      {
        id: "thomas",
        name: "Thomas Petit",
        team: "Équipe Alpha",
        grade: "Caporal",
        matricule: "SP-1003",
        phone: "06 24 18 03 03",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Conducteur PL"],
      },
      {
        id: "chloe",
        name: "Chloé Dubois",
        team: "Équipe Bravo",
        grade: "Sapeur",
        matricule: "SP-1004",
        phone: "06 24 18 04 04",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP"],
      },
      {
        id: "nicolas",
        name: "Nicolas Leroy",
        team: "Équipe Bravo",
        grade: "Sapeur",
        matricule: "SP-1005",
        phone: "06 24 18 05 05",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Équipier INC"],
      },
      {
        id: "emma",
        name: "Emma Martin",
        team: "Équipe Bravo",
        grade: "Caporal",
        matricule: "SP-1006",
        phone: "06 24 18 06 06",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Chef"],
      },
      {
        id: "lucas",
        name: "Lucas Bernard",
        team: "Équipe Alpha",
        grade: "Sapeur",
        matricule: "SP-1007",
        phone: "06 24 18 07 07",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP"],
      },
      {
        id: "sophie",
        name: "Sophie Rousseau",
        team: "Équipe Bravo",
        grade: "Sergent",
        matricule: "SP-1008",
        phone: "06 24 18 08 08",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Conducteur PL"],
      },
      {
        id: "alice",
        name: "Alice Caron",
        team: "Équipe Alpha",
        grade: "Caporal",
        matricule: "SP-1009",
        phone: "06 24 18 09 09",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Conducteur PL"],
      },
      {
        id: "maxime",
        name: "Maxime Faure",
        team: "Équipe Bravo",
        grade: "Sapeur",
        matricule: "SP-1010",
        phone: "06 24 18 10 10",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP", "Équipier INC"],
      },
      {
        id: "camille",
        name: "Camille Laurent",
        team: "Équipe Alpha",
        grade: "Sapeur",
        matricule: "SP-1011",
        phone: "06 24 18 11 11",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP"],
      },
      {
        id: "antoine",
        name: "Antoine Robert",
        team: "Équipe Bravo",
        grade: "Caporal",
        matricule: "SP-1012",
        phone: "06 24 18 12 12",
        role: "AGENT",
        teamId: "",
        qualifications: ["SAP"],
      },
    ],
    inactiveAgents: [],
    teams: [],
    qualificationCatalogue: [],
    template: {},
    invitations: [],
    notifications: [
      {
        id: "notice-campaign",
        kind: "CAMPAIGN_OPENED",
        subject: `Campagne ouverte : ${campaignName(month)}`,
        body: `Renseignez vos disponibilités avant le ${closesOn.slice(8)}/${closesOn.slice(5, 7)}/${closesOn.slice(0, 4)}, puis validez votre réponse.`,
        createdAt: new Date(`${opensOn}T08:00:00`).toISOString(),
        readAt: null,
      },
      {
        id: "notice-schedule",
        kind: "SCHEDULE_PUBLISHED",
        subject: "Votre planning a été publié",
        body: "Retrouvez vos gardes dans Mon planning.",
        createdAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
        readAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      },
    ],
    campaigns: [
      {
        id: `campaign-${month}`,
        name: campaignName(month),
        month,
        opensOn,
        closesOn,
        closed: false,
        dayStart: 8,
        nightStart: 20,
      },
    ],
    entries: {},
    responses: {},
    requirements: {},
    assignments: {},
    publications: {},
    audit: [],
  };
  const campaign = state.campaigns[0];
  const types: Availability[] = ["FULL_24H", "DAY", "FULL_24H", "NIGHT", "FULL_24H", "UNAVAILABLE", "DAY"];
  state.agents.forEach((agent, index) => {
    monthDays(campaign.month).forEach((date, day) => {
      if ((index === 0 && day >= 24) || (index > 9 && day % 4 === 0)) return;
      state.entries[entryKey(campaign.id, agent.id, date)] = {
        type: types[(day + index * 2) % types.length],
        comment: "",
      };
    });
    if (index > 0 && index < 10)
      state.responses[responseKey(campaign.id, agent.id)] = new Date(now.getTime() - 86_400_000).toISOString();
  });
  for (const date of monthDays(campaign.month)) {
    for (const shift of ["DAY", "NIGHT"] as const) {
      // The demonstration records its requirements as a real centre would. Nothing
      // is inferred for a shift that has none: it is simply not measured.
      state.requirements[shiftKey(campaign.id, date, shift)] = {
        total: suggestedRequirement.total,
        qualifications: { ...suggestedRequirement.qualifications },
      };
      const pool = availableAgents(state, campaign.id, date, shift);
      state.assignments[shiftKey(campaign.id, date, shift)] = pool
        .slice(0, Number(date.slice(-2)) % 3 === 0 ? 3 : 4)
        .map(a => a.id);
    }
  }
  state.audit.push({
    id: "initial-campaign",
    at: new Date(`${opensOn}T08:00:00`).toISOString(),
    actor: "Julien Bernard",
    action: "Campagne ouverte",
    detail: `${campaign.name} · ${state.agents.length} agents invités`,
    entity: "availability_campaign",
  });
  return state;
}

// ---------------------------------------------------------------------------
// De quoi composer un état à la main
//
// L'application n'écrit plus rien localement : les commandes partent au serveur
// et c'est PostgreSQL qui applique les règles, vérifié par database.test.ts. Ces
// quelques fonctions ne sont donc pas une seconde implémentation de ces règles,
// mais de simples constructeurs : elles posent un état, pour que les fonctions
// de lecture du domaine — couverture, charge, exports — aient quelque chose à lire.
// ---------------------------------------------------------------------------

export function fillMonth(state: AppState, campaignId: string, userId: string, value: Availability) {
  for (const date of monthDays(campaignId.replace("campaign-", "")))
    state.entries[entryKey(campaignId, userId, date)] = { type: value, comment: "" };
  return state;
}

export function validate(state: AppState, campaignId: string, userId: string, at = new Date()) {
  state.responses[responseKey(campaignId, userId)] = at.toISOString();
  return state;
}

export function assign(state: AppState, campaignId: string, date: string, shift: "DAY" | "NIGHT", ids: string[]) {
  state.assignments[shiftKey(campaignId, date, shift)] = ids;
  return state;
}

export function publish(
  state: AppState,
  campaignId: string,
  date: string,
  shift: "DAY" | "NIGHT",
  ids: string[],
  revision = 1,
  at = new Date(),
) {
  state.publications[shiftKey(campaignId, date, shift)] = { agents: ids, revision, publishedAt: at.toISOString() };
  return state;
}
