import { beforeEach, describe, expect, it, vi } from "vitest";

// Le passage de livraison du traitement planifié (lot A) : un secret propre,
// le recontrôle des rappels avant de réserver, deux files indépendantes, une
// durée bornée et un passage toujours inscrit au journal.
const { rpc, dispatchPush, dispatchEmails, configured } = vi.hoisted(() => ({
  rpc: vi.fn(),
  dispatchPush: vi.fn(),
  dispatchEmails: vi.fn(),
  configured: { push: true, email: true },
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
vi.mock("../src/lib/push.server", () => ({ dispatchPush, pushConfigured: () => configured.push }));
vi.mock("../src/lib/mailer.server", () => ({ dispatchEmails, emailConfigured: () => configured.email }));
import { POST } from "../src/app/api/traitements/route";

const SECRET = "s".repeat(40);
const call = (authorization?: string) =>
  POST(
    new Request("https://dispo-sp.example/api/traitements", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  configured.push = true;
  configured.email = true;
  process.env.SCHEDULED_TASKS_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projet.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "cle-serveur";
  rpc.mockResolvedValue({ data: 0, error: null });
  dispatchPush.mockResolvedValue({ processed: 2, sent: 2 });
  dispatchEmails.mockResolvedValue({ processed: 3, sent: 3 });
});

describe("Passage de livraison planifié", () => {
  it.each([
    ["sans en-tête", undefined],
    ["avec un autre secret", `Bearer ${"x".repeat(40)}`],
    ["avec le secret sans « Bearer »", SECRET],
  ])("refuse un appel %s, sans rien toucher", async (_, header) => {
    const response = await call(header);
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchPush).not.toHaveBeenCalled();
  });

  it("refuse tout appel quand le secret configuré est trop court", async () => {
    process.env.SCHEDULED_TASKS_SECRET = "court";
    expect((await call("Bearer court")).status).toBe(401);
  });

  it("recontrôle, livre les deux files dans un temps borné, puis inscrit le passage", async () => {
    rpc.mockResolvedValueOnce({ data: 1, error: null });
    const before = Date.now();
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      annulations: 1,
      push: { processed: 2, sent: 2 },
      emails: { processed: 3, sent: 3 },
    });
    expect(rpc.mock.calls[0]).toEqual(["cancel_obsolete_notifications"]);
    const { deadline } = dispatchEmails.mock.calls[0][0];
    expect(deadline).toBeGreaterThanOrEqual(before + 40_000);
    expect(deadline).toBeLessThan(before + 60_000);
    expect(dispatchPush.mock.calls[0][0]).toEqual({ deadline });
    expect(rpc.mock.calls[1]).toEqual([
      "record_scheduled_run",
      {
        task: "livraison",
        ok: true,
        summary: { annulations: 1, push: { processed: 2, sent: 2 }, emails: { processed: 3, sent: 3 } },
        error: null,
      },
    ]);
  });

  it("livre les emails même si le push échoue, et inscrit l’échec", async () => {
    dispatchPush.mockRejectedValue(new Error("Réservation des envois impossible : délai dépassé"));
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(dispatchEmails).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[1][1]).toMatchObject({
      task: "livraison",
      ok: false,
      error: "push : Réservation des envois impossible : délai dépassé",
    });
  });

  it("dit ce qui n’est pas configuré au lieu d’échouer", async () => {
    configured.email = false;
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect((await response.json()).emails).toBe("non configuré");
    expect(dispatchEmails).not.toHaveBeenCalled();
  });
});
