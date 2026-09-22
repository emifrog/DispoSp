import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le traitement de la file poussée, côté serveur : ce qu'il réclame pour
// tourner, ce qu'il journalise, et le fait qu'il repasse tant que la base rend
// un lot plein — dix envois par clic ne prévenaient pas une caserne.
const { rpc, sendNotification } = vi.hoisted(() => ({ rpc: vi.fn(), sendNotification: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
vi.mock("web-push", () => ({ default: { sendNotification } }));
import { dispatchPush, pushConfigured, pushMisconfiguration } from "../src/lib/push.server";

const publicKey = "B".repeat(87);
const privateKey = "A".repeat(43);
const job = (n: number) => ({
  id: `d${n}`,
  lease: `l${n}`,
  subscription_id: `s${n}`,
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  p256dh: "B".repeat(87),
  auth: "A".repeat(22),
  notification_id: `n${n}`,
  kind: "CAMPAIGN_OPENED",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY", publicKey);
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", privateKey);
  vi.stubEnv("WEB_PUSH_SUBJECT", "mailto:disposp@example.org");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Configuration des notifications poussées", () => {
  it("est complète avec les trois variables VAPID et la clé du serveur", () => {
    expect(pushMisconfiguration()).toBeNull();
    expect(pushConfigured()).toBe(true);
  });

  it.each([
    ["SUPABASE_SECRET_KEY", "", "SUPABASE_SECRET_KEY"],
    ["WEB_PUSH_SUBJECT", "disposp@example.org", "mailto"],
    ["WEB_PUSH_SUBJECT", "", "vont ensemble"],
    ["NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY", "trop-courte", "87 caractères"],
    ["WEB_PUSH_PRIVATE_KEY", "trop-courte", "43 caractères"],
  ])("nomme ce qui manque : %s = « %s »", (name, value, reason) => {
    // Sans la clé du serveur, l'écran proposait l'activation, l'essai marchait,
    // et aucune bulle réelle ne partait jamais.
    vi.stubEnv(name, value);
    expect(pushMisconfiguration()).toContain(reason);
    expect(pushConfigured()).toBe(false);
  });
});

describe("Traitement de la file poussée", () => {
  it("repasse tant que la base rend un lot plein, et s’arrête au premier lot court", async () => {
    let claims = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name !== "claim_push_deliveries") return { error: null };
      claims++;
      const full = Array.from({ length: 10 }, (_, i) => job(claims * 100 + i));
      return { data: claims < 3 ? full : [job(999), job(998), job(997)], error: null };
    });
    sendNotification.mockResolvedValue({ statusCode: 201 });
    await expect(dispatchPush()).resolves.toEqual({ processed: 23, sent: 23 });
    expect(claims).toBe(3);
    expect(rpc.mock.calls.filter(([name]) => name === "finish_push_delivery")).toHaveLength(23);
  });

  it("journalise une erreur qui n’est pas une réponse du service, et la rend comme un zéro", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_push_deliveries" ? { data: [job(1)], error: null } : { error: null },
    );
    // Une paire de clés invalide, un sujet refusé : web-push lève sans code.
    sendNotification.mockRejectedValue(new Error("Vapid subject is not a url or mailto url"));
    await expect(dispatchPush()).resolves.toEqual({ processed: 1, sent: 0 });
    expect(console.error).toHaveBeenCalledWith("Envoi poussé impossible", "Vapid subject is not a url or mailto url");
    expect(rpc).toHaveBeenCalledWith("finish_push_delivery", { delivery: "d1", token: "l1", http_status: 0 });
  });

  it("garde le code d’un refus du service de remise, sans le journaliser", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_push_deliveries" ? { data: [job(1)], error: null } : { error: null },
    );
    sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    await dispatchPush();
    expect(rpc).toHaveBeenCalledWith("finish_push_delivery", { delivery: "d1", token: "l1", http_status: 410 });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("ne tourne pas sans la clé du serveur", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    await expect(dispatchPush()).rejects.toThrow("Push non configuré");
    expect(rpc).not.toHaveBeenCalled();
  });
});
