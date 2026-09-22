import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La file d'emails, côté serveur : réservée sous la clé du serveur, un
// message à la fois, chaque résultat rendu à la base. Ce que ce fichier garde :
// une adresse refusée ne bloque plus le centre, un lot plein appelle le
// suivant, un service muet ne fait pas échouer la commande.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
import { dispatchEmails, emailConfigured } from "../src/lib/mailer.server";

const job = (n: number) => ({
  id: `n${n}`,
  lease: `l${n}`,
  email: `agent${n}@example.org`,
  kind: "CAMPAIGN_OPENED",
  subject: "Ouverte",
  body: "",
});
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM", "DispoSP <notifications@example.org>");
  vi.stubEnv("APP_URL", "https://disposp.example.org");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("File d’emails", () => {
  it("n’est configurée qu’avec les trois variables Resend", () => {
    expect(emailConfigured()).toBe(true);
    vi.stubEnv("RESEND_FROM", "");
    expect(emailConfigured()).toBe(false);
  });

  it("refuse de tourner sans la clé du serveur : la file ne se lit pas sous une session", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(dispatchEmails()).rejects.toThrow("non configuré");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("envoie un message à la fois et rend chaque résultat, refus compris, sans s’arrêter", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries" ? { data: [job(1), job(2), job(3)], error: null } : { error: null },
    );
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      // Une adresse que Resend refuse : ce message-là échoue, les autres partent.
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => "invalid to" })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await dispatchEmails();
    expect(result).toEqual({ processed: 3, sent: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const finished = rpc.mock.calls.filter(([name]) => name === "finish_email_delivery").map(([, args]) => args);
    expect(finished).toEqual([
      { delivery: "n1", token: "l1", http_status: 200 },
      { delivery: "n2", token: "l2", http_status: 422 },
      { delivery: "n3", token: "l3", http_status: 200 },
    ]);
    // Un message, un destinataire, et un délai posé sur l'appel.
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body).to).toEqual(["agent1@example.org"]);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("rend le silence comme un zéro, que la base réessaiera plus tard", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries" ? { data: [job(1)], error: null } : { error: null },
    );
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(dispatchEmails()).resolves.toEqual({ processed: 1, sent: 0 });
    expect(rpc).toHaveBeenCalledWith("finish_email_delivery", { delivery: "n1", token: "l1", http_status: 0 });
  });

  it("repasse tant que la base rend un lot plein, et s’arrête au premier lot court", async () => {
    const full = Array.from({ length: 50 }, (_, i) => job(i));
    let claims = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name !== "claim_email_deliveries") return { error: null };
      claims++;
      return { data: claims < 3 ? full : [job(999)], error: null };
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await expect(dispatchEmails()).resolves.toEqual({ processed: 101, sent: 101 });
    expect(claims).toBe(3);
  });

  it("s’arrête si la base ne rend pas la réservation, sans rien envoyer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(dispatchEmails()).rejects.toThrow("Réservation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
