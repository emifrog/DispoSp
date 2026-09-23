import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// B1 de l'analyse du 23 septembre : ouvrir un lien ne le consomme plus. Les
// messageries l'ouvrent pour l'analyser ; seul le bouton de l'agent le vérifie.
const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({ createActionClient: async () => ({ auth: { verifyOtp } }) }));
import { GET as openInvite, POST as confirmInvite } from "../src/app/auth/activation/route";
import { GET as openRecovery, POST as confirmRecovery } from "../src/app/auth/recuperation/route";

const base = "http://127.0.0.1:3000";
const open = (path: string) => new NextRequest(new URL(`${base}${path}`));
const post = (path: string, token: string | null, origin = base) => {
  const body = new URLSearchParams();
  if (token !== null) body.set("token_hash", token);
  return new NextRequest(new URL(`${base}${path}`), {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded", host: "127.0.0.1:3000", origin },
  });
};
const location = (response: Response) => {
  const url = new URL(response.headers.get("location")!);
  return `${url.pathname}${url.search}`;
};

beforeEach(() => verifyOtp.mockReset());

describe("Ouverture d’un lien d’email", () => {
  it("mène à la page qui demande de continuer, sans toucher au jeton", () => {
    const invite = openInvite(open("/auth/activation?token_hash=abc&type=invite"));
    expect(invite.status).toBe(303);
    expect(location(invite)).toBe("/confirmer?type=invite&token_hash=abc");
    const recovery = openRecovery(open("/auth/recuperation?token_hash=xyz&type=recovery"));
    expect(location(recovery)).toBe("/confirmer?type=recovery&token_hash=xyz");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("laisse l’écran suivant parler d’un lien incomplet ou d’un autre type", () => {
    expect(location(openInvite(open("/auth/activation?type=invite")))).toBe("/activation");
    expect(location(openRecovery(open("/auth/recuperation?token_hash=abc&type=invite")))).toBe("/nouveau-mot-de-passe");
  });
});

describe("Bouton « Continuer »", () => {
  it("vérifie le jeton avec le type de la route, puis mène au choix du mot de passe", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const invite = await confirmInvite(post("/auth/activation", "abc"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "invite", token_hash: "abc" });
    expect(invite.status).toBe(303);
    expect(location(invite)).toBe("/activation");
    const recovery = await confirmRecovery(post("/auth/recuperation", "xyz"));
    expect(verifyOtp).toHaveBeenLastCalledWith({ type: "recovery", token_hash: "xyz" });
    expect(location(recovery)).toBe("/nouveau-mot-de-passe");
  });

  it("renvoie vers la connexion, qui l’explique, quand le jeton est mort", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
    expect(location(await confirmInvite(post("/auth/activation", "mort")))).toBe("/connexion?lien=expire");
  });

  it("refuse un jeton posté depuis un autre site", async () => {
    const response = await confirmInvite(post("/auth/activation", "abc", "https://piege.example.com"));
    expect(response.status).toBe(403);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("ne vérifie rien sans jeton", async () => {
    expect(location(await confirmRecovery(post("/auth/recuperation", null)))).toBe("/nouveau-mot-de-passe");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
