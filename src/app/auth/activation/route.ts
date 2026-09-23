import { type NextRequest } from "next/server";
import { confirmLink, showConfirmation } from "@/lib/auth-link";

/**
 * Le lien d'activation, vérifié côté serveur.
 *
 * Même raison que pour la réinitialisation : le gabarit par défaut renvoie un
 * code lié au navigateur qui a **demandé** l'opération. Ici c'est le
 * gestionnaire qui a demandé et l'agent qui ouvre — sur un autre appareil,
 * toujours. Le code ne peut donc jamais s'échanger, et ce chemin est le seul
 * qui fonctionne.
 *
 * L'ouverture (`GET`) ne consomme pas le jeton : elle mène à une page qui
 * demande de continuer, et c'est ce bouton (`POST`) qui le vérifie. Voir
 * `src/lib/auth-link.ts`.
 *
 * Il suppose le gabarit « Invite user » réglé sur :
 *   {{ .SiteURL }}/auth/activation?token_hash={{ .TokenHash }}&type=invite
 */
export function GET(request: NextRequest) {
  return showConfirmation(request, "invite");
}

export function POST(request: NextRequest) {
  return confirmLink(request, "invite");
}
