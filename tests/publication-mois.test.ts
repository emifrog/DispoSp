import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Lot B : l'aperçu de la publication du mois, lu par une route sous la session
// du gestionnaire, et ce que l'écran et l'email en disent.
const { readSession, rpc } = vi.hoisted(() => ({ readSession: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/supabase/server", () => ({ createReadClient: async () => ({ rpc }) }));
import { GET } from "../src/app/api/planning/mois/route";
import { blockerText, commandSchema } from "../src/lib/domain";
import { message } from "../src/lib/email";

const CAMPAGNE = "40000000-0000-0000-0000-000000000002";
const get = (query: string) => GET(new NextRequest(`http://127.0.0.1:3000/api/planning/mois${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  readSession.mockResolvedValue({ userId: "chef", membership: { organizationId: "centre" } });
});

describe("Aperçu de la publication du mois", () => {
  it("rend l’aperçu de la base, jamais mis en cache", async () => {
    const preview = { fingerprint: "f".repeat(32), counts: { total: 62, ready: 48, blocked: 10, unchanged: 4 } };
    rpc.mockResolvedValue({ data: preview, error: null });
    const response = await get(`?campagne=${CAMPAGNE}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(preview);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("month_publication_preview", { campaign: CAMPAGNE });
  });

  it("refuse sans session, ou sans campagne lisible, avant toute lecture", async () => {
    readSession.mockResolvedValueOnce(null);
    expect((await get(`?campagne=${CAMPAGNE}`)).status).toBe(401);
    expect((await get("")).status).toBe(400);
    expect((await get("?campagne=pas-un-identifiant")).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("dit en français le refus de la base, en 403 quand c’est un droit", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Not allowed to publish this schedule" } });
    const response = await get(`?campagne=${CAMPAGNE}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Vous n’avez pas le droit de publier ce planning." });
  });
});

describe("Ce que l’écran dit d’un créneau bloqué", () => {
  it("reprend les motifs de la publication unitaire", () => {
    expect(blockerText({ code: "headcount", assigned: 1, required: 2 })).toBe("Effectif incomplet : 1 sur 2");
    expect(blockerText({ code: "requirement" })).toBe("Besoins non définis");
    expect(blockerText({ code: "qualifications", missing: "Chef, SAP" })).toBe("Qualifications manquantes : Chef, SAP");
    expect(blockerText({ code: "withdrawal", agents: "Léa Martin" })).toBe(
      "Désistement accepté, remplacement à faire : Léa Martin",
    );
    expect(blockerText({ code: "inactive", agents: "Paul" })).toBe("Agent désactivé : Paul");
    expect(blockerText({ code: "availability", agents: "Paul" })).toBe("Disponibilité non validée ou modifiée : Paul");
  });

  it("n’accepte qu’une empreinte et un identifiant de demande bien formés", () => {
    const valid = {
      type: "publishMonth",
      campaignId: CAMPAGNE,
      fingerprint: "0123456789abcdef0123456789abcdef",
      requestId: "90000000-0000-0000-0000-000000000001",
    };
    expect(commandSchema.safeParse(valid).success).toBe(true);
    expect(commandSchema.safeParse({ ...valid, fingerprint: "court" }).success).toBe(false);
    expect(commandSchema.safeParse({ ...valid, requestId: "x" }).success).toBe(false);
  });
});

describe("Récapitulatif du mois par email", () => {
  it("garde une garde par ligne, dans le texte comme dans le HTML", () => {
    const body = "Gardes ajoutées :\n– dimanche 1 novembre, de 8 h à 20 h\n– mardi 3 novembre, de 8 h à 20 h";
    const mail = message(
      {
        id: "1",
        email: "agent@example.org",
        kind: "SCHEDULE_PUBLISHED",
        subject: "Planning de novembre 2026 publié",
        body,
      },
      "https://dispo-sp.example.fr",
    );
    expect(mail.text.startsWith(body)).toBe(true);
    expect(mail.html).toContain(
      "Gardes ajoutées :<br>– dimanche 1 novembre, de 8 h à 20 h<br>– mardi 3 novembre, de 8 h à 20 h",
    );
  });
});
