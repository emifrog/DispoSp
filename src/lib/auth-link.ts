import { NextResponse, type NextRequest } from "next/server";
import { crossSite } from "./cross-site";
import { createActionClient } from "./supabase/server";
import { SIGN_IN_PATH } from "./supabase/config";

/**
 * Les liens à usage unique des emails d'invitation et de réinitialisation.
 *
 * Ils se vérifiaient à l'ouverture, sur un `GET`. Or les messageries des
 * administrations ouvrent les liens pour les analyser avant de les remettre :
 * le jeton était consommé par l'analyseur, et l'agent lisait « lien expiré » au
 * premier clic. L'ouverture ne fait donc plus rien d'autre que montrer une page
 * avec un bouton ; c'est le bouton — un `POST`, qu'aucun analyseur n'envoie —
 * qui consomme le jeton.
 *
 * Les gabarits d'email ne changent pas : ils visent toujours les deux routes.
 */
export type LinkKind = "invite" | "recovery";
export const CONFIRM_PATH = "/confirmer";

export const linkRoutes: Record<LinkKind, { route: string; next: string }> = {
  invite: { route: "/auth/activation", next: "/activation" },
  recovery: { route: "/auth/recuperation", next: "/nouveau-mot-de-passe" },
};

/** L'ouverture du lien : la page qui demande de continuer, sans rien vérifier. */
export function showConfirmation(request: NextRequest, kind: LinkKind) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  // Rien à vérifier : l'écran suivant constate l'absence de session et propose
  // un nouveau lien, plutôt que d'accuser ici sans contexte.
  if (!tokenHash || searchParams.get("type") !== kind)
    return NextResponse.redirect(new URL(linkRoutes[kind].next, origin));
  const target = new URL(CONFIRM_PATH, origin);
  target.searchParams.set("type", kind);
  target.searchParams.set("token_hash", tokenHash);
  return NextResponse.redirect(target, { status: 303 });
}

/** Le bouton : le jeton est vérifié ici, et la session posée dans les cookies. */
export async function confirmLink(request: NextRequest, kind: LinkKind) {
  const { origin } = request.nextUrl;
  // Sans ce contrôle, un autre site pourrait poster son propre jeton et ouvrir
  // chez l'agent une session qui n'est pas la sienne.
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  const form = await request.formData().catch(() => null);
  const tokenHash = form?.get("token_hash");
  if (typeof tokenHash !== "string" || !tokenHash)
    return NextResponse.redirect(new URL(linkRoutes[kind].next, origin), { status: 303 });

  const supabase = await createActionClient();
  const { error } = await supabase.auth.verifyOtp({ type: kind, token_hash: tokenHash });
  // Le jeton est consommé ou périmé. L'écran de connexion sait le dire, et
  // l'adresse ne doit pas garder un jeton mort dans l'historique.
  if (error) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?lien=expire`, origin), { status: 303 });
  return NextResponse.redirect(new URL(linkRoutes[kind].next, origin), { status: 303 });
}
