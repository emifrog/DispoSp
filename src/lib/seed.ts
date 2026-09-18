import {
  type AppState,
  type Availability,
  monthDays,
  entryKey,
  responseKey,
  shiftKey,
  availableAgents,
} from "./domain";

export function createDemoState(): AppState {
  const state: AppState = {
    version: 1,
    organization: { name: "CIS Val de Loire", dayStart: 8, nightStart: 20 },
    agents: [
      { id: "julien", name: "Julien Bernard", team: "Équipe Alpha", grade: "Sergent", qualifications: ["Chef", "SAP"] },
      {
        id: "marie",
        name: "Marie Lambert",
        team: "Équipe Alpha",
        grade: "Sergent",
        qualifications: ["Chef", "SAP", "Conducteur PL"],
      },
      {
        id: "thomas",
        name: "Thomas Petit",
        team: "Équipe Alpha",
        grade: "Caporal",
        qualifications: ["SAP", "Conducteur PL"],
      },
      { id: "chloe", name: "Chloé Dubois", team: "Équipe Bravo", grade: "Sapeur", qualifications: ["SAP"] },
      {
        id: "nicolas",
        name: "Nicolas Leroy",
        team: "Équipe Bravo",
        grade: "Sapeur",
        qualifications: ["SAP", "Équipier INC"],
      },
      { id: "emma", name: "Emma Martin", team: "Équipe Bravo", grade: "Caporal", qualifications: ["SAP", "Chef"] },
      { id: "lucas", name: "Lucas Bernard", team: "Équipe Alpha", grade: "Sapeur", qualifications: ["SAP"] },
      {
        id: "sophie",
        name: "Sophie Rousseau",
        team: "Équipe Bravo",
        grade: "Sergent",
        qualifications: ["SAP", "Conducteur PL"],
      },
      {
        id: "alice",
        name: "Alice Caron",
        team: "Équipe Alpha",
        grade: "Caporal",
        qualifications: ["SAP", "Conducteur PL"],
      },
      {
        id: "maxime",
        name: "Maxime Faure",
        team: "Équipe Bravo",
        grade: "Sapeur",
        qualifications: ["SAP", "Équipier INC"],
      },
      { id: "camille", name: "Camille Laurent", team: "Équipe Alpha", grade: "Sapeur", qualifications: ["SAP"] },
      { id: "antoine", name: "Antoine Robert", team: "Équipe Bravo", grade: "Caporal", qualifications: ["SAP"] },
    ],
    campaigns: [
      {
        id: "campaign-2026-10",
        name: "Disponibilités d’octobre",
        month: "2026-10",
        opensOn: "2026-09-01",
        closesOn: "2026-09-30",
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
    if (index > 0 && index < 10) state.responses[responseKey(campaign.id, agent.id)] = "2026-09-17T09:30:00Z";
  });
  for (const date of monthDays(campaign.month)) {
    for (const shift of ["DAY", "NIGHT"] as const) {
      const pool = availableAgents(state, campaign.id, date, shift);
      state.assignments[shiftKey(campaign.id, date, shift)] = pool
        .slice(0, Number(date.slice(-2)) % 3 === 0 ? 3 : 4)
        .map(a => a.id);
    }
  }
  state.audit.push({
    id: "initial-campaign",
    at: "2026-09-01T08:00:00Z",
    actor: "Julien Bernard",
    action: "Campagne ouverte",
    detail: "Disponibilités d’octobre · 12 agents invités",
  });
  return state;
}
