import { beforeEach, describe, expect, it, vi } from "vitest";

// La déconnexion ne ferme que la session de l'appareil qui la demande.
const { signOut } = vi.hoisted(() => ({
  signOut: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
}));
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
  beforeEach(() => {
    signOut.mockClear();
    vi.restoreAllMocks();
  });

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

  // Supabase n'efface rien quand il n'a pas pu relire la session : sur le poste
  // partagé, l'agent suivant héritait de celle qu'on croyait fermée.
  it("efface les cookies de session même quand Supabase échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockResolvedValueOnce({ error: { message: "fetch failed" } });
    const response = await POST(
      post({ cookie: "sb-projet-auth-token.0=aaa; sb-projet-auth-token.1=bbb; theme=sombre" }),
    );
    expect(response.status).toBe(303);
    for (const name of ["sb-projet-auth-token.0", "sb-projet-auth-token.1"]) {
      const cleared = response.cookies.get(name);
      expect(cleared?.value, name).toBe("");
      expect(cleared?.maxAge, name).toBe(0);
    }
    // Ce qui n'appartient pas à Supabase n'est pas touché.
    expect(response.cookies.get("theme")).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Déconnexion incomplète côté Supabase :", "fetch failed");
  });
});
