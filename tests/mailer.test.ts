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

  // Sans la clé du serveur, la file ne se lit pas : se dire configuré
  // programmait après chaque commande un envoi voué à lever.
  it.each(["SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"])("n’est pas configurée sans %s", name => {
    vi.stubEnv(name, "");
    expect(emailConfigured()).toBe(false);
  });

  it("nomme ce qui manque, sans jamais en écrire la valeur", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const failure = await dispatchEmails().catch((error: Error) => error);
    expect((failure as Error).message).toContain("SUPABASE_SECRET_KEY");
    expect((failure as Error).message).not.toContain("re_test");
  });

  it("garde la cause d’un refus de la base dans l’erreur qu’il lève", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function claim_email_deliveries" } });
    await expect(dispatchEmails()).rejects.toThrow("permission denied for function claim_email_deliveries");
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
    const full = Array.from({ length: 10 }, (_, i) => job(i));
    let claims = 0;
    rpc.mockImplementation(async (name: string, args: { batch?: number }) => {
      if (name !== "claim_email_deliveries") return { error: null };
      // Dix au plus : un lot doit tenir dans le bail de deux minutes, même
      // quand chaque message attend dix secondes.
      expect(args.batch).toBe(10);
      claims++;
      return { data: claims < 3 ? full : [job(999)], error: null };
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await expect(dispatchEmails()).resolves.toEqual({ processed: 21, sent: 21 });
    expect(claims).toBe(3);
  });

  it("envoie la clé que la base a donnée au message, et s’en passe si elle n’en donne pas", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries"
        ? { data: [{ ...job(1), idempotency_key: "cle-1" }, job(2)], error: null }
        : { error: null },
    );
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await dispatchEmails();
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("cle-1");
    expect(fetchMock.mock.calls[1][1].headers).not.toHaveProperty("Idempotency-Key");
  });

  // Deux 409 : un envoi concurrent sous la même clé, qui n'est ni un envoi ni
  // un refus ; un contenu qui a changé depuis le premier essai, que la base
  // réessaie sous une clé neuve.
  it("rend en silence le 409 d’un envoi concurrent, et tel quel celui d’un contenu changé", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries" ? { data: [job(1), job(2)], error: null } : { error: null },
    );
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ name: "concurrent_idempotent_requests" }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ name: "invalid_idempotent_request" }) });
    await expect(dispatchEmails()).resolves.toEqual({ processed: 2, sent: 0 });
    const finished = rpc.mock.calls.filter(([name]) => name === "finish_email_delivery").map(([, args]) => args);
    expect(finished).toEqual([
      { delivery: "n1", token: "l1", http_status: 0 },
      { delivery: "n2", token: "l2", http_status: 409 },
    ]);
  });

  // Analyse du 5 octobre, C3 : un refus qui vise le compte vaut pour toute la
  // file. Il ne solde plus rien en échec : le lot retourne en file, sans que
  // la tentative compte, pour un nouvel essai après un délai.
  const refused = (status: number, name: string, message = "") => ({
    ok: false,
    status,
    json: async () => ({ statusCode: status, name, message }),
  });
  const run = async (response: object) => {
    let claims = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name !== "claim_email_deliveries") return { error: null };
      claims++;
      // Un lot plein, puis une file vide.
      return { data: claims === 1 ? Array.from({ length: 10 }, (_, i) => job(i + 1)) : [], error: null };
    });
    fetchMock.mockResolvedValue(response);
    const result = await dispatchEmails();
    const calls = (name: string) => rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args);
    return { result, claims, finished: calls("finish_email_delivery"), released: calls("release_email_delivery") };
  };

  it.each([
    [403, "validation_error", "The `audit.test` domain is not verified.", 900],
    [403, "suspended_api_key", "This API key is suspended", 900],
    [401, "missing_api_key", "Missing API key in the authorization header.", 900],
    [422, "validation_error", "Invalid `from` field.", 900],
    [429, "daily_quota_exceeded", "You have exceeded your daily email sending quota.", 3600],
    [429, "monthly_quota_exceeded", "You have exceeded your monthly email sending quota.", 3600],
    [429, "rate_limit_exceeded", "Too many requests.", 60],
  ])(
    "suspend la file sur un %i %s, et rend tout le lot sans compter la tentative",
    async (status, name, message, delay) => {
      const { result, claims, finished, released } = await run(refused(status, name, message));
      // Un seul essai, puis l'arrêt : ni passage suivant, ni neuf refus de plus.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(claims).toBe(1);
      expect(finished).toEqual([]);
      expect(released).toEqual([
        { delivery: "n1", token: "l1", retry_in: delay, http_status: status },
        ...Array.from({ length: 9 }, (_, i) => ({
          delivery: `n${i + 2}`,
          token: `l${i + 2}`,
          retry_in: delay,
          http_status: null,
        })),
      ]);
      expect(result).toEqual({ processed: 0, sent: 0, suspended: expect.stringContaining(`${status} ${name}`) });
    },
  );

  it("garde définitif un refus propre au destinataire, et continue le lot", async () => {
    const { result, finished, released } = await run(refused(422, "validation_error", "Invalid `to` field."));
    expect(released).toEqual([]);
    expect(finished).toHaveLength(10);
    expect(finished.every(f => f.http_status === 422)).toBe(true);
    expect(result).toEqual({ processed: 10, sent: 0 });
  });

  it("garde les messages déjà partis avant le refus du compte", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries" ? { data: [job(1), job(2), job(3)], error: null } : { error: null },
    );
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(refused(429, "daily_quota_exceeded"));
    const result = await dispatchEmails();
    const calls = (name: string) => rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args);
    expect(calls("finish_email_delivery")).toEqual([{ delivery: "n1", token: "l1", http_status: 200 }]);
    expect(calls("release_email_delivery").map(r => r.delivery)).toEqual(["n2", "n3"]);
    expect(result).toMatchObject({ processed: 1, sent: 1 });
  });

  it("dit pourquoi la suspension n’a pas pu être enregistrée", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_email_deliveries"
        ? { data: [job(1)], error: null }
        : { error: { message: "Could not find the function public.release_email_delivery" } },
    );
    fetchMock.mockResolvedValue(refused(403, "validation_error", "The domain is not verified."));
    await expect(dispatchEmails()).rejects.toThrow("Suspension non enregistrée : Could not find the function");
  });

  it("s’arrête si la base ne rend pas la réservation, sans rien envoyer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(dispatchEmails()).rejects.toThrow("Réservation");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
