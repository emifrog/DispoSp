import { beforeEach, describe, expect, it, vi } from "vitest";

// Les deux routes Web Push qu'un navigateur poste : même contrôle d'origine que
// /deconnexion. Une page tierce ne doit ni abonner l'appareil d'un agent à une
// adresse de remise qu'elle détient, ni déclencher des envois sur ses appareils.
const { readSession, rpc, sendTestPush } = vi.hoisted(() => ({
  readSession: vi.fn(),
  rpc: vi.fn(),
  sendTestPush: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/push.server", () => ({ pushConfigured: () => true, sendTestPush }));
vi.mock("../src/lib/supabase/server", () => ({
  createActionClient: async () => ({
    rpc,
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  }),
}));
import { POST as subscribe } from "../src/app/api/push/subscribe/route";
import { POST as test } from "../src/app/api/push/test/route";

const device = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
};
const post = (path: string, headers: Record<string, string>, body?: unknown) =>
  new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: { host: "127.0.0.1:3000", "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.resetAllMocks();
  readSession.mockResolvedValue({ userId: "agent", membership: { organizationId: "centre" } });
  rpc.mockResolvedValue({ error: null });
});

describe("Routes Web Push", () => {
  it("refusent un POST venu d’un autre site, avant toute écriture", async () => {
    const foreign = { origin: "https://piege.example.com", "sec-fetch-site": "cross-site" };
    expect((await subscribe(post("/api/push/subscribe", foreign, device))).status).toBe(403);
    expect((await test(post("/api/push/test", foreign))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(sendTestPush).not.toHaveBeenCalled();
  });

  // Le renouvellement que l'agent de service poste après `pushsubscriptionchange`
  // part de la même origine : il doit continuer de passer.
  it("laissent passer l’application et son agent de service", async () => {
    const same = { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" };
    expect((await subscribe(post("/api/push/subscribe", same, device))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("register_push_subscription", expect.anything());
    expect((await test(post("/api/push/test", same))).status).toBe(200);
  });
});
