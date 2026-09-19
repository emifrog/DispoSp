import { NextResponse, type NextRequest } from "next/server";
import { createActionClient } from "@/lib/supabase/server";
import { SIGN_IN_PATH } from "@/lib/supabase/config";

/**
 * Le lien d'activation, vérifié côté serveur.
 *
 * Même raison que pour la réinitialisation : le gabarit par défaut renvoie un
 * code lié au navigateur qui a **demandé** l'opération. Ici c'est le
 * gestionnaire qui a demandé et l'agent qui ouvre — sur un autre appareil,
 * toujours. Le code ne peut donc jamais s'échanger, et ce chemin est le seul
 * qui fonctionne.
 *
 * Il suppose le gabarit « Invite user » réglé sur :
 *   {{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (!tokenHash || type !== "invite") return NextResponse.redirect(new URL("/activation", origin));

  const supabase = await createActionClient();
  const { error } = await supabase.auth.verifyOtp({ type: "invite", token_hash: tokenHash });
  if (error) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?lien=expire`, origin));
  return NextResponse.redirect(new URL("/activation", origin));
}
