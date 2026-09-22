import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Les coordonnées Supabase sont lues à l'import du module de configuration :
// il faut donc les poser avant, et réinitialiser le cache de modules entre
// deux cas. Un simple process.env modifié après coup ne changerait rien.
async function middlewareWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env))
    if (value === undefined) vi.stubEnv(key, undefined as unknown as string);
    else vi.stubEnv(key, value);
  return (await import("../src/lib/supabase/middleware")).updateSession;
}
const ask = (path: string) => new NextRequest(new URL(`http://127.0.0.1:3000${path}`));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Garde de session", () => {
  const withoutSupabase = {
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
  };

  // Ce qu'un navigateur demande avant d'avoir une session ne dépend d'aucune
  // donnée. L'intégration continue n'a pas de projet Supabase : si le garde
  // exige la configuration avant de regarder le chemin, elle ne peut pas
  // vérifier la surface publique qu'elle prétend vérifier.
  it.each(["/manifest.webmanifest", "/sw.js", "/hors-ligne", "/connexion"])(
    "sert %s sans configuration Supabase",
    async path => {
      const updateSession = await middlewareWith(withoutSupabase);
      const response = await updateSession(ask(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  // L'autre moitié de la décision : un déploiement mal configuré doit s'arrêter,
  // pas servir des écrans vides. Seule la surface publique est épargnée.
  it("s’arrête sur un écran de travail sans configuration Supabase", async () => {
    const updateSession = await middlewareWith(withoutSupabase);
    await expect(updateSession(ask("/tableau-de-bord"))).rejects.toThrow("Supabase");
  });

  // Le rattrapage des envois poussés est appelé par un planificateur, sans
  // cookie : c'est la route qui vérifie son jeton, pas le garde. Renvoyer cette
  // requête vers la connexion rendait la route inaccessible — et la file ne se
  // vidait plus qu'au rythme des clics des utilisateurs.
  it("laisse passer le rattrapage des envois poussés sans session", async () => {
    const updateSession = await middlewareWith({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    const request = new NextRequest(new URL("http://127.0.0.1:3000/api/push/dispatch"), {
      method: "POST",
      headers: { authorization: "Bearer 0123456789abcdef0123456789abcdef" },
    });
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("renvoie un visiteur sans session vers la connexion quand tout est configuré", async () => {
    const updateSession = await middlewareWith({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    const response = await updateSession(ask("/tableau-de-bord"));
    expect(response.headers.get("location")).toContain("/connexion");
  });
});
