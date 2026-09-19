import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { configured, credentials, HOME_PATH, publicPaths, SIGN_IN_PATH } from "./config";

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
  const { url, key } = credentials();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates the token with Supabase; getSession() would trust a
  // cookie the browser could have forged. Do not replace it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !publicPaths.includes(path)) return redirectTo(request, SIGN_IN_PATH);
  if (user && path === SIGN_IN_PATH) return redirectTo(request, HOME_PATH);
  return response;
}

function redirectTo(request: NextRequest, pathname: string) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  return NextResponse.redirect(target);
}
