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
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), { status: 303 });
}
