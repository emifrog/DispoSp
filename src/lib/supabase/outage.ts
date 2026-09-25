import { isAuthRetryableFetchError, isAuthSessionMissingError } from "@supabase/supabase-js";

/**
 * Supabase Auth n'a pas pu répondre — ce qui n'est pas la même chose que
 * « personne n'est connecté ».
 *
 * `getUser()` rend une erreur dans les deux cas, et l'ignorer les confondait :
 * une panne passagère d'Auth renvoyait tout le centre vers /connexion, en
 * perdant l'adresse demandée, et chaque action répondait « session expirée »
 * à des agents dont la session était intacte.
 *
 * Absence de session : pas de jeton du tout (`AuthSessionMissingError`), ou un
 * jeton que le service a lu et refusé — expiré sans renouvellement possible,
 * révoqué, compte supprimé. Ce sont des réponses 4xx : le service a bien
 * répondu, et sa réponse est « non ».
 *
 * Panne : le réseau (`AuthRetryableFetchError`, qui couvre aussi 502, 503 et
 * 504), une erreur 5xx, ou une erreur sans statut — rien n'a été lu.
 */
export function authOutage(error: unknown): boolean {
  if (!error) return false;
  if (isAuthSessionMissingError(error)) return false;
  if (isAuthRetryableFetchError(error)) return true;
  const status = typeof error === "object" && "status" in error ? Number(error.status) : NaN;
  return !(status >= 400 && status < 500);
}

/** Ce que le journal du serveur retient d'une panne : le message, jamais un jeton. */
export const outageCause = (error: unknown) => (error instanceof Error ? error.message : String(error));
