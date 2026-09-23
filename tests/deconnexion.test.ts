import { beforeEach, describe, expect, it, vi } from "vitest";

// La déconnexion ne ferme que la session de l'appareil qui la demande.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }));
vi.mock("../src/lib/supabase/server", () => ({
  createActionClient: async () => ({ auth: { signOut } }),
}));
import { POST } from "../src/app/deconnexion/route";

const post = (headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:3000/deconnexion", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", ...headers },
  });

describe("Déconnexion", () => {
  beforeEach(() => signOut.mockClear());

  it("ne ferme que cette session : le téléphone reste connecté quand on quitte le poste du centre", async () => {
    const response = await POST(post());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/connexion");
  });

  it("ne déconnecte personne sur un formulaire posté depuis un autre site", async () => {
    const response = await POST(post({ origin: "https://piege.example.com" }));
    expect(response.status).toBe(403);
    expect(signOut).not.toHaveBeenCalled();
  });
});
