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
  it.each(["/manifest.webmanifest", "/sw.js", "/installation.js", "/hors-ligne", "/connexion"])(
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

/**
 * Le garde avec un client Supabase simulé : ce que getUser() rend, et ce que
 * le client écrit comme cookies en passant — un jeton renouvelé, typiquement.
 */
async function middlewareAnswering(answer: () => Promise<unknown>, refreshed = false) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.doMock("@supabase/ssr", () => ({
    createServerClient: (
      _url: string,
      _key: string,
      options: { cookies: { setAll: (cookies: unknown[], headers: Record<string, string>) => void } },
    ) => ({
      auth: {
        getUser: async () => {
          if (refreshed)
            options.cookies.setAll(
              [{ name: "sb-test-auth-token", value: "renouvele", options: { path: "/", httpOnly: true } }],
              { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
            );
          return answer();
        },
      },
    }),
  }));
  return (await import("../src/lib/supabase/middleware")).updateSession;
}

describe("Garde de session face à Supabase Auth", async () => {
  const { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } = await import("@supabase/supabase-js");
  const nobody = (error: unknown) => async () => ({ data: { user: null }, error });
  const someone = async () => ({ data: { user: { id: "agent" } }, error: null });

  afterEach(() => {
    vi.doUnmock("@supabase/ssr");
    vi.restoreAllMocks();
  });

  // Une panne passagère d'Auth renvoyait tout le centre vers /connexion, en
  // perdant l'adresse demandée : elle se présentait comme une déconnexion.
  it("répond 503, sans redirection, quand Auth ne répond pas", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const updateSession = await middlewareAnswering(nobody(new AuthRetryableFetchError("fetch failed", 0)));
    const response = await updateSession(ask("/tableau-de-bord"));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("Réessayez");
    expect(console.error).toHaveBeenCalledWith("Supabase Auth injoignable :", "fetch failed");
  });

  it("répond 503 en JSON à une route d’API quand Auth est en panne", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const updateSession = await middlewareAnswering(nobody(new AuthApiError("upstream", 500, "unexpected_failure")));
    const response = await updateSession(ask("/api/export"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Réessayez") });
  });

  it("sert toujours la surface publique pendant une panne", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const updateSession = await middlewareAnswering(nobody(new AuthRetryableFetchError("fetch failed", 503)));
    for (const path of ["/connexion", "/manifest.webmanifest", "/hors-ligne"])
      expect((await updateSession(ask(path))).status, path).toBe(200);
  });

  // L'absence de session et le jeton refusé restent ce qu'ils sont : une
  // déconnexion, qui mène à /connexion.
  it("renvoie vers la connexion sans session, ou avec un jeton refusé", async () => {
    for (const error of [new AuthSessionMissingError(), new AuthApiError("invalid JWT", 403, "bad_jwt")]) {
      const updateSession = await middlewareAnswering(nobody(error));
      const response = await updateSession(ask("/tableau-de-bord"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/connexion");
    }
  });

  // Une route d'API recevait la page de connexion en HTML, avec un 200 au bout
  // de la redirection, que fetch() prenait pour une réussite.
  it("répond 401 en JSON à une route d’API sans session", async () => {
    const updateSession = await middlewareAnswering(nobody(new AuthSessionMissingError()));
    const response = await updateSession(ask("/api/push/subscribe"));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toEqual({ error: "Non authentifié" });
  });

  // Le jeton renouvelé par getUser() partait avec la réponse préparée, que la
  // redirection remplaçait : le navigateur revenait avec l'ancien.
  it("garde les cookies renouvelés sur une redirection", async () => {
    const updateSession = await middlewareAnswering(someone, true);
    const response = await updateSession(ask("/connexion"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("renouvele");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("garde les cookies écrits sur un refus d’API", async () => {
    const updateSession = await middlewareAnswering(nobody(new AuthSessionMissingError()), true);
    const response = await updateSession(ask("/api/export"));
    expect(response.status).toBe(401);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("renouvele");
  });

  it("laisse passer un agent connecté, cookies renouvelés compris", async () => {
    const updateSession = await middlewareAnswering(someone, true);
    const response = await updateSession(ask("/tableau-de-bord"));
    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("renouvele");
  });
});
