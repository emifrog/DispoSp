import { NextResponse } from "next/server";
import { crossSite } from "@/lib/cross-site";
import { SIGN_IN_PATH } from "@/lib/supabase/config";
import { createActionClient } from "@/lib/supabase/server";

// A POST route rather than a client call: signing out has to clear the cookies
// the server reads, and a Route Handler is one of the two places allowed to
// write them. It also works without JavaScript.
export async function POST(request: Request) {
  // Un autre site pouvait poster ce formulaire et déconnecter l'agent à son insu.
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  const supabase = await createActionClient();
  // Cette session seulement. Sans `scope`, Supabase les révoque toutes : se
  // déconnecter du poste partagé du centre déconnectait aussi le téléphone de
  // l'agent, qui ne recevait plus rien jusqu'à sa prochaine connexion.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  const response = NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), { status: 303 });
  if (error) {
    /*
     * Supabase n'efface les cookies qu'une fois la session relue avec succès.
     * Quand cette lecture échoue, il rend l'erreur et laisse tout en place :
     * sur le poste partagé du centre, l'agent suivant héritait de la session
     * de celui qui venait de « se déconnecter ». Les cookies de session sont
     * donc effacés ici, quoi qu'ait répondu Supabase. Le jeton reste valable
     * jusqu'à son expiration côté serveur, mais ce navigateur ne le porte plus.
     */
    console.error("Déconnexion incomplète côté Supabase :", error.message);
    // Tous les `sb-*`, morceaux compris : un jeton long se découpe en
    // `sb-…-auth-token.0`, `.1`, et un seul reste suffit à le reconstituer.
    for (const pair of request.headers.get("cookie")?.split(";") ?? []) {
      const name = pair.split("=")[0].trim();
      if (name.startsWith("sb-")) response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }
  return response;
}
