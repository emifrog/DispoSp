import { type NextRequest } from "next/server";
import { confirmLink, showConfirmation } from "@/lib/auth-link";

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
 * L'ouverture (`GET`) ne consomme pas le jeton : elle mène à une page qui
 * demande de continuer, et c'est ce bouton (`POST`) qui le vérifie. Voir
 * `src/lib/auth-link.ts`.
 *
 * Elle suppose le gabarit « Reset password » réglé sur :
 *   {{ .SiteURL }}/auth/recuperation?token_hash={{ .TokenHash }}&type=recovery
 */
export function GET(request: NextRequest) {
  return showConfirmation(request, "recovery");
}

export function POST(request: NextRequest) {
  return confirmLink(request, "recovery");
}
