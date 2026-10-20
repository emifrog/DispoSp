import { createClient } from "@supabase/supabase-js";
import { authorizedPushWorker } from "@/lib/push-auth";
import { dispatchEmails, emailConfigured } from "@/lib/mailer.server";
import { dispatchPush, pushConfigured } from "@/lib/push.server";

/**
 * Le passage de livraison du traitement planifié (lot A).
 *
 * Supabase Cron l'appelle toutes les cinq minutes (voir
 * supabase/provisioning/activer-les-traitements-planifies.sql). La génération
 * des rappels et des relances se fait en base, sans passer par ici ; cette route
 * ne fait que livrer ce qui attend, que quelqu'un ait agi ou non :
 *
 * 1. recontrôler les rappels encore en attente — un rappel devenu faux ne part pas ;
 * 2. vider la file push, puis la file d'emails, par lots, dans un temps borné ;
 * 3. inscrire le passage au journal, qu'il réussisse ou non.
 *
 * Les deux files gardent leurs règles : bail, reprise après échec, suspension
 * quand le fournisseur refuse le compte. Une panne d'envoi n'annule rien de ce
 * qui a été écrit : les messages restent en file pour le passage suivant.
 *
 * Le secret est propre à ce traitement (`SCHEDULED_TASKS_SECRET`, 32 caractères
 * au moins), comparé en temps constant comme celui du push.
 */
export const maxDuration = 60;
/** Au-delà, plus de nouveau lot : la suite attend le passage suivant. */
const BUDGET_MS = 40_000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function POST(request: Request) {
  if (!authorizedPushWorker(request.headers.get("authorization"), process.env.SCHEDULED_TASKS_SECRET))
    return new Response("Non autorisé", { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return new Response("Traitement non configuré", { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deadline = Date.now() + BUDGET_MS;
  const summary: Record<string, unknown> = {};
  const failures: string[] = [];

  const { data: cancelled, error: cancelFailure } = await client.rpc("cancel_obsolete_notifications");
  if (cancelFailure) failures.push(`annulations : ${cancelFailure.message}`);
  else summary.annulations = cancelled;

  // Les deux files sont indépendantes : l'une qui échoue n'arrête pas l'autre.
  if (pushConfigured()) {
    try {
      summary.push = await dispatchPush({ deadline });
    } catch (error) {
      failures.push(`push : ${reason(error)}`);
    }
  } else summary.push = "non configuré";
  if (emailConfigured()) {
    try {
      summary.emails = await dispatchEmails({ deadline });
    } catch (error) {
      failures.push(`emails : ${reason(error)}`);
    }
  } else summary.emails = "non configuré";

  const failure = failures.length ? failures.join(" ; ") : null;
  // Des nombres et des états, jamais un destinataire ni un contenu.
  const { error: logFailure } = await client.rpc("record_scheduled_run", {
    task: "livraison",
    ok: !failure,
    summary,
    error: failure,
  });
  if (logFailure) console.error("Passage planifié non inscrit au journal :", logFailure.message);
  if (failure) console.error("Le traitement planifié a échoué :", failure);
  return Response.json(
    { ok: !failure, ...summary },
    { status: failure ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
