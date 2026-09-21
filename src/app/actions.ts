"use server";
import { after } from "next/server";
import { runCommand } from "@/lib/commands.server";
import { commandLabels, commandSchema } from "@/lib/domain";
import { dispatchPush, pushConfigured } from "@/lib/push.server";
import { readSession } from "@/lib/session.server";

export type CommandResult = { ok: true; label: string } | { ok: false; message: string };

/**
 * Vide la file des envois poussés, une fois la réponse partie.
 *
 * Après la commande et non pendant : l'agent n'a pas à attendre que cinq
 * téléphones aient reçu leur bulle pour voir son écran se mettre à jour, et un
 * service de remise lent ne doit pas faire échouer une écriture déjà faite.
 * `after` est fait pour ça — voir
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.
 *
 * Appelée après chaque commande, même celles qui n'écrivent aucune
 * notification : la file est remplie par des déclencheurs en base, pas par le
 * code d'ici, et deviner lesquels déclenchent quoi finirait par se tromper. Une
 * file vide coûte une requête qui ne rend aucune ligne.
 */
function flushPush() {
  if (!pushConfigured()) return;
  after(async () => {
    try {
      await dispatchPush();
    } catch {
      // Les notifications restent dans la file et dans le centre de messages :
      // un envoi manqué ne doit pas annuler l'écriture qui l'a provoqué.
      console.error("Le traitement Web Push a échoué.");
    }
  });
}

// A Server Action is a public endpoint reachable by anyone who can POST to the
// application: the payload is parsed here, and the identity is read from the
// session cookie rather than taken from what the browser claims.
export async function submitCommand(payload: unknown): Promise<CommandResult> {
  const parsed = commandSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: "La demande est incomplète ou mal formée." };
  const session = await readSession();
  if (!session) return { ok: false, message: "Votre session a expiré. Reconnectez-vous." };
  if (!session.membership) return { ok: false, message: "Votre compte n’est rattaché à aucun centre." };
  try {
    await runCommand({ ...session, membership: session.membership }, parsed.data);
    flushPush();
    return { ok: true, label: commandLabels[parsed.data.type] };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "L’action n’a pas pu être enregistrée.",
    };
  }
}
