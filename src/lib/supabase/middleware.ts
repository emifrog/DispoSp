import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { configured, credentials, HOME_PATH, publicPaths, SIGN_IN_PATH } from "./config";
import { authOutage, outageCause } from "./outage";

// Refreshing the session is the middleware's job: Server Components cannot write
// cookies, so without this a token would expire and never be renewed.
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Ce qu'un navigateur va chercher avant d'avoir une session — le manifeste,
  // l'agent de service, la page hors ligne — ne dépend d'aucune donnée. Exiger
  // la configuration Supabase pour le servir faisait échouer jusqu'au manifeste
  // sur un environnement qui n'en a pas : l'intégration continue, par exemple,
  // où les tests censés vérifier cette surface publique ne pouvaient pas passer.
  //
  // Le garde reste entier quand la configuration est là : un compte connecté
  // qui revient sur /connexion est toujours renvoyé chez lui.
  if (!configured() && publicPaths.includes(path)) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  // Les en-têtes que Supabase demande avec un cookie de session : ils
  // interdisent à un cache partagé de servir le jeton d'un agent à un autre.
  let sessionHeaders: Record<string, string> = {};
  const { url, key } = credentials();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        sessionHeaders = { ...sessionHeaders, ...headers };
        for (const [header, value] of Object.entries(sessionHeaders)) response.headers.set(header, value);
      },
    },
  });

  // getUser() revalidates the token with Supabase; getSession() would trust a
  // cookie the browser could have forged. Do not replace it.
  let user: User | null = null;
  let error: unknown = null;
  try {
    ({
      data: { user },
      error,
    } = await supabase.auth.getUser());
  } catch (failure) {
    error = failure;
  }

  // Une réponse que le garde fabrique lui-même — redirection, refus — part sans
  // la réponse préparée plus haut : elle doit en reprendre les cookies. Sans
  // eux, un jeton que getUser() venait de renouveler était perdu, et le
  // navigateur revenait avec l'ancien, déjà consommé.
  const carry = (answer: NextResponse) => {
    for (const cookie of response.cookies.getAll()) answer.cookies.set(cookie);
    for (const [header, value] of Object.entries(sessionHeaders)) answer.headers.set(header, value);
    return answer;
  };

  if (!user && authOutage(error)) {
    console.error("Supabase Auth injoignable :", outageCause(error));
    // La surface publique ne dépend d'aucune session : le manifeste, l'agent de
    // service et la page hors ligne doivent justement rester servis.
    if (publicPaths.includes(path)) return response;
    return carry(unavailable(path));
  }
  if (!user && !publicPaths.includes(path))
    // Une route d'API répond à du code, pas à une personne : une redirection
    // lui rendait la page de connexion en HTML, avec un statut 200 au bout,
    // que l'appelant prenait pour une réussite.
    return carry(
      isApi(path)
        ? NextResponse.json({ error: "Non authentifié" }, { status: 401, headers: { "Cache-Control": "no-store" } })
        : redirectTo(request, SIGN_IN_PATH),
    );
  if (user && path === SIGN_IN_PATH) return carry(redirectTo(request, HOME_PATH));
  return response;
}

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

/**
 * Le service d'authentification ne répond pas.
 *
 * Ni une redirection vers /connexion — l'agent n'est pas déconnecté, et
 * l'adresse demandée serait perdue —, ni une page blanche. Un 503 dit
 * « réessayez » à un navigateur comme à un script.
 */
function unavailable(path: string) {
  const message = "Le service de connexion ne répond pas. Réessayez dans un instant.";
  const headers = { "Cache-Control": "no-store", "Retry-After": "30" };
  return isApi(path)
    ? NextResponse.json({ error: message }, { status: 503, headers })
    : new NextResponse(message, { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

function redirectTo(request: NextRequest, pathname: string) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  return NextResponse.redirect(target);
}
