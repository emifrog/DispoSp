import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assign, sampleState } from "./fixtures/centre";

// Lot C : l'aperçu d'un appel, lu par une route sous la session du gestionnaire,
// et ce que l'écran dit d'un besoin et d'une déclaration.
const { readSession, rpc, lookup } = vi.hoisted(() => ({ readSession: vi.fn(), rpc: vi.fn(), lookup: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/supabase/server", () => ({
  createReadClient: async () => {
    // La recherche du créneau : from(...).select(...).eq(...)×3.maybeSingle().
    const chain = { select: () => chain, eq: () => chain, maybeSingle: lookup };
    return { rpc, from: () => chain };
  },
}));
// L'écran Appels, rendu hors navigateur sur un état posé à la main.
const app = vi.hoisted(() => ({ state: null as unknown, actor: { id: "julien", role: "AGENT" }, run: vi.fn() }));
vi.mock("@/components/provider", () => ({ useApp: () => app }));
import { GET } from "../src/app/api/appels/apercu/route";
import {
  callLaunchHint,
  callNeedText,
  callOpen,
  coverage,
  declarationText,
  declaredFor,
  DECLARATION_TERMS,
  shiftKey,
  visibleCampaigns,
  type AppState,
} from "../src/lib/domain";

const CAMPAGNE = "40000000-0000-0000-0000-000000000002";
const CRENEAU = "60000000-0000-0000-0000-000000000001";
const DESISTEMENT = "70000000-0000-0000-0000-000000000001";
const get = (query: string) => GET(new NextRequest(`http://127.0.0.1:3000/api/appels/apercu${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  readSession.mockResolvedValue({ userId: "chef", membership: { organizationId: "centre" } });
  lookup.mockResolvedValue({ data: { id: CRENEAU }, error: null });
});

describe("Aperçu d’un appel", () => {
  it("demande l’aperçu de la garde à la base, désistement compris, jamais mis en cache", async () => {
    const preview = { need: { required: 2, kept: 1, missing_headcount: 1, missing_qualifications: [] }, available: 3 };
    rpc.mockResolvedValue({ data: preview, error: null });
    const response = await get(`?campagne=${CAMPAGNE}&date=2026-11-03&creneau=NIGHT&desistement=${DESISTEMENT}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("call_preview", { shift: CRENEAU, withdrawal: DESISTEMENT });
  });

  it("refuse sans session, ou une garde mal décrite, avant toute lecture", async () => {
    readSession.mockResolvedValueOnce(null);
    expect((await get(`?campagne=${CAMPAGNE}&date=2026-11-03&creneau=DAY`)).status).toBe(401);
    for (const query of [
      "",
      `?campagne=${CAMPAGNE}&date=03/11/2026&creneau=DAY`,
      `?campagne=${CAMPAGNE}&date=2026-11-03&creneau=MATIN`,
      `?campagne=${CAMPAGNE}&date=2026-11-03&creneau=DAY&desistement=x`,
    ])
      expect((await get(query)).status, query).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dit en français que la garde n’existe pas, ou que le droit manque", async () => {
    lookup.mockResolvedValueOnce({ data: null, error: null });
    expect((await get(`?campagne=${CAMPAGNE}&date=2026-11-03&creneau=DAY`)).status).toBe(404);
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Not allowed to call for this shift" } });
    const response = await get(`?campagne=${CAMPAGNE}&date=2026-11-03&creneau=DAY`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Vous n’avez pas le droit de lancer un appel pour cette garde." });
  });
});

describe("Ce que l’écran dit d’un appel", () => {
  it("résume le besoin restant en places et en qualifications", () => {
    expect(callNeedText({ required: 4, kept: 3, missingHeadcount: 1, missingQualifications: [] })).toBe("1 place");
    expect(
      callNeedText({
        required: 4,
        kept: 2,
        missingHeadcount: 2,
        missingQualifications: [{ qualification: "COD2", missing: 1 }],
      }),
    ).toBe("2 places · 1 COD2");
    expect(callNeedText({ required: 2, kept: 2, missingHeadcount: 0, missingQualifications: [] })).toBe(
      "Besoin couvert",
    );
  });

  it("écrit la déclaration avec la date et les horaires, la nuit jusqu’au lendemain", () => {
    expect(declarationText("2026-11-03", 8, 20)).toBe(
      "Je confirme être disponible le mardi 3 novembre, de 8 h à 20 h, pour cette garde. Mon affectation reste soumise à confirmation du gestionnaire.",
    );
    expect(declarationText("2026-11-03", 20, 8)).toContain("de 20 h à 8 h le lendemain");
    // La version qui part avec la proposition est celle que la base attend.
    expect(DECLARATION_TERMS).toBe("declaration-2026-10-21");
  });
});

// Correctifs du 27 octobre 2026 (analyse B2, C5, C4, C3 ; audit de déploiement
// A01, A02, A09, A10) : ce que l'écran doit dire comme la base.
type Call = AppState["calls"][number];
type Proposal = AppState["callProposals"][number];
const NOW = new Date("2026-09-18T10:00:00Z");
const CAMPAIGN = "campaign-2026-10";
const DATE = "2026-10-15";
const aCall = (overrides: Partial<Call> = {}): Call => ({
  id: "call-1",
  campaignId: CAMPAIGN,
  shiftId: "shift-1",
  date: DATE,
  shift: "DAY",
  origin: "REINFORCEMENT",
  state: "OPEN",
  openedAt: NOW.toISOString(),
  expiresAt: "2026-10-15T06:00:00Z",
  widenedAt: NOW.toISOString(),
  closedAt: null,
  need: { required: 1, kept: 0, missingHeadcount: 1, missingQualifications: [] },
  ...overrides,
});
const aProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "proposal-1",
  callId: "call-1",
  userId: "julien",
  state: "SELECTED",
  proposedAt: NOW.toISOString(),
  declared: true,
  ...overrides,
});
const render = async (state: AppState) => {
  app.state = state;
  const { Calls } = await import("../src/components/calls");
  return renderToStaticMarkup(createElement(Calls));
};

describe("Couverture d’une garde tenue sur déclaration exceptionnelle", () => {
  // Julien n'a rien validé pour octobre : sans déclaration, il est « plus
  // disponible sur ce créneau », et la garde n'est pas couverte.
  function setup() {
    const state = sampleState(NOW);
    state.requirements[shiftKey(CAMPAIGN, DATE, "DAY")] = { total: 1, qualifications: {} };
    assign(state, CAMPAIGN, DATE, "DAY", ["julien"]);
    state.calls.push(aCall());
    state.callRecipients.push({ callId: "call-1", userId: "julien", circle: "WIDENED" });
    return state;
  }
  it("compte un retenu sur déclaration comme disponible, comme la base le fait à la publication", () => {
    const state = setup();
    const before = coverage(state, CAMPAIGN, DATE, "DAY", "planned");
    expect(before.invalid.map(a => a.id)).toEqual(["julien"]);
    expect(before.covered).toBe(false);
    state.callProposals.push(aProposal());
    const after = coverage(state, CAMPAIGN, DATE, "DAY", "planned");
    expect(after.invalid).toEqual([]);
    expect(after.covered).toBe(true);
    expect(declaredFor(state, CAMPAIGN, DATE, "DAY")).toEqual(new Set(["julien"]));
  });
  it("n’y voit une preuve qu’une déclaration retenue ou confirmée, sur un appel de cette garde", () => {
    for (const proposal of [
      aProposal({ state: "PENDING" }),
      aProposal({ state: "WITHDRAWN" }),
      aProposal({ state: "DECLINED" }),
      aProposal({ state: "RELEASED" }),
      aProposal({ declared: false }),
    ]) {
      const state = setup();
      state.callProposals.push(proposal);
      expect(coverage(state, CAMPAIGN, DATE, "DAY", "planned").covered, JSON.stringify(proposal)).toBe(false);
    }
    const elsewhere = setup();
    elsewhere.calls.push(aCall({ id: "call-2", date: "2026-10-16" }));
    elsewhere.callProposals.push(aProposal({ callId: "call-2" }));
    expect(coverage(elsewhere, CAMPAIGN, DATE, "DAY", "planned").covered).toBe(false);
    const confirmed = setup();
    confirmed.callProposals.push(aProposal({ state: "CONFIRMED" }));
    expect(coverage(confirmed, CAMPAIGN, DATE, "DAY", "planned").covered).toBe(true);
  });
});

describe("Un agent sollicité sans être convié à la campagne", () => {
  function setup() {
    const state = sampleState(new Date("2026-10-15T10:00:00Z"));
    const campaign = state.campaigns[0];
    campaign.participants = campaign.participants.filter(id => id !== "julien" && id !== "thomas");
    state.calls.push(
      aCall({ campaignId: campaign.id, date: `${campaign.month}-05`, expiresAt: "2026-11-05T07:00:00Z" }),
    );
    return state;
  }
  it("voit la campagne de l’appel qui le sollicite, et elle seule", () => {
    const state = setup();
    const campaign = state.campaigns[0];
    expect(visibleCampaigns(state, "julien", false)).toEqual([]);
    state.callRecipients.push({ callId: "call-1", userId: "julien", circle: "WIDENED" });
    expect(visibleCampaigns(state, "julien", false).map(c => c.id)).toEqual([campaign.id]);
    expect(visibleCampaigns(state, "thomas", false)).toEqual([]);
    expect(visibleCampaigns(state, "marie", false).map(c => c.id)).toEqual([campaign.id]);
    expect(visibleCampaigns(state, "julien", true)).toBe(state.campaigns);
  });
  it("lit alors les vrais horaires de la garde dans sa déclaration", async () => {
    const state = setup();
    state.callRecipients.push({ callId: "call-1", userId: "julien", circle: "WIDENED" });
    const html = await render({ ...state, campaigns: visibleCampaigns(state, "julien", false) });
    expect(html).toContain("de 8 h à 20 h");
    expect(html).not.toContain("de 0 h à 0 h");
  });
});

describe("Un appel expiré n’est plus proposé", () => {
  it("tient pour ouvert un appel OPEN dont la garde n’a pas commencé, et lui seul", () => {
    const call = aCall({ expiresAt: "2026-11-03T19:00:00Z" });
    expect(callOpen(call, new Date("2026-11-03T18:59:00Z"))).toBe(true);
    expect(callOpen(call, new Date("2026-11-03T19:00:00Z"))).toBe(false);
    expect(callOpen(aCall({ state: "RESOLVED" }), new Date("2026-01-01T00:00:00Z"))).toBe(false);
  });
  it("passe sous « Appels clos », marqué expiré, dès le début de la garde", async () => {
    const state = sampleState(new Date("2026-10-15T10:00:00Z"));
    state.calls.push(
      aCall({
        campaignId: state.campaigns[0].id,
        date: "2026-11-03",
        shift: "NIGHT",
        expiresAt: "2026-11-03T19:00:00Z",
      }),
    );
    state.callRecipients.push({ callId: "call-1", userId: "julien", circle: "AVAILABLE" });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-03T18:58:00Z"));
      expect(await render(state)).toContain("Je me propose");
      vi.setSystemTime(new Date("2026-11-03T19:02:00Z"));
      const html = await render(state);
      expect(html).toContain("Aucun appel en cours");
      expect(html).not.toContain("Je me propose");
      expect(html).toContain("Expiré");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Lancer l’appel quand la base ne calcule aucun manque", () => {
  it("nomme l’agent du brouillon sans disponibilité validée, et se tait dès que quelque chose manque", () => {
    const state = sampleState(NOW);
    const date = "2026-10-26";
    state.requirements[shiftKey(CAMPAIGN, date, "DAY")] = { total: 1, qualifications: {} };
    assign(state, CAMPAIGN, date, "DAY", ["julien"]);
    const nothing = { missingHeadcount: 0, missingQualifications: [] };
    expect(callLaunchHint(state, CAMPAIGN, date, "DAY", { missingHeadcount: 1, missingQualifications: [] })).toBeNull();
    expect(callLaunchHint(state, CAMPAIGN, date, "DAY", null)).toBeNull();
    expect(callLaunchHint(state, CAMPAIGN, date, "DAY", nothing)).toMatch(
      /retient Julien Bernard, sans disponibilité validée\. Retirez-le d'abord du brouillon/,
    );
    assign(state, CAMPAIGN, date, "DAY", ["marie"]);
    expect(callLaunchHint(state, CAMPAIGN, date, "DAY", nothing)).toMatch(
      /Retirez d'abord du brouillon l'agent qui bloque la publication/,
    );
  });
});
