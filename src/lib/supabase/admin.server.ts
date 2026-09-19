import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

/**
 * La première clé secrète du projet, et la seule.
 *
 * Créer un compte d'authentification est une opération d'administration : la
 * clé publiable ne peut pas la faire, par construction. Inviter un agent en
 * demande donc une seconde, qui elle **passe outre toutes les policies RLS**.
 *
 * Trois précautions, à tenir :
 *
 * - `server-only` : ce module refuse de se compiler dans un paquet navigateur.
 * - Pas de préfixe `NEXT_PUBLIC_`, sans quoi la clé partirait dans ce paquet.
 * - Ce client ne sert **qu'à** `auth.admin.inviteUserByEmail`. Il ne lit ni
 *   n'écrit aucune table : tout le reste continue de passer par la session de
 *   l'appelant et ses policies. Une lecture faite ici contournerait le
 *   cloisonnement entre centres sans que rien ne le signale.
 *
 * Elle est facultative. Sans elle, l'invitation enregistre toujours qui est
 * attendu — l'agent ne reçoit simplement pas son message, et le gestionnaire
 * le lit à l'écran.
 */
export const canInvite = () => Boolean(supabaseUrl && process.env.SUPABASE_SECRET_KEY);

export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !key) throw new Error("L’envoi des invitations n’est pas configuré.");
  // Aucune session à conserver ni à rafraîchir : ce client vit le temps d'un
  // appel, et n'a pas de cookies à écrire.
  return createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
