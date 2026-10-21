import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
import { GET } from "../src/app/api/appels/apercu/route";
import { callNeedText, declarationText, DECLARATION_TERMS } from "../src/lib/domain";

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
