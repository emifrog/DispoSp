import { NextResponse, type NextRequest } from "next/server";
import { createActionClient } from "@/lib/supabase/server";
import { SIGN_IN_PATH } from "@/lib/supabase/config";

/**
 * Le lien de réinitialisation, vérifié côté serveur.
 *
 * Deux façons d'arriver à l'écran de choix du mot de passe. Le gabarit d'e-mail
 * par défaut de Supabase renvoie un code que le navigateur échange lui-même —
 * mais ce code est lié au navigateur qui a demandé la réinitialisation (PKCE),
 * donc ouvrir le message sur le téléphone après l'avoir demandé sur l'ordinateur
 * échoue.
 *
 * Cette route est l'autre chemin : elle prend le `token_hash` du gabarit
 * personnalisé, le vérifie ici, pose les cookies, et laisse repartir. Elle
 * fonctionne quel que soit l'appareil qui ouvre le message.
 *
 * Elle suppose le gabarit « Reset password » réglé sur :
 *   {{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  // Rien à vérifier : on laisse l'écran suivant constater l'absence de session
  // et proposer un nouveau lien, plutôt que d'accuser ici sans contexte.
  if (!tokenHash || type !== "recovery") {
    return NextResponse.redirect(new URL("/nouveau-mot-de-passe", origin));
  }

  const supabase = await createActionClient();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    // Le jeton est consommé ou périmé. L'écran de connexion sait le dire, et
    // l'adresse ne doit pas garder un jeton mort dans l'historique.
    return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?lien=expire`, origin));
  }
  return NextResponse.redirect(new URL("/nouveau-mot-de-passe", origin));
}
