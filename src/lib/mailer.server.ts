import "server-only";
import { createClient } from "@supabase/supabase-js";
import { message, type Pending } from "./email";

const RESEND_SEND = "https://api.resend.com/emails";
/** Ce que la base rend par passage ; en deçà, la file est vide et on s'arrête. */
const BATCH = 50;
/** Au-delà, on laisse la suite au passage suivant : un centre ne vide pas la file du monde entier. */
const MAX_PASSES = 20;
/** Un service d'envoi qui ne répond pas en dix secondes ne répondra pas mieux en trente. */
const TIMEOUT_MS = 10_000;

/**
 * Tout ce que l'envoi réclame, et pas seulement Resend : la file se lit sous
 * la clé secrète du projet. Sans elle, chaque commande programmait un envoi
 * qui levait aussitôt « non configuré », et le journal s'en remplissait sans
 * qu'un seul message parte. Même règle que `pushMisconfiguration`.
 */
const REQUIRED = ["RESEND_API_KEY", "RESEND_FROM", "APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];
/** Les noms des variables absentes — des noms seulement, jamais leurs valeurs. */
const missing = () => REQUIRED.filter(name => !process.env[name]);

export function emailConfigured() {
  return missing().length === 0;
}

/**
 * Envoie un message et rend le code du service d'envoi.
 *
 * Ne lève jamais : un refus est une réponse, et le zéro est le silence —
 * réseau coupé, délai dépassé. Un message à la fois, et non un lot : Resend
 * refuse un lot entier pour une seule adresse invalide, et ce refus bloquait
 * jusqu'ici tous les envois suivants du centre, indéfiniment.
 */
async function send(notice: Pending, key: string, from: string, appUrl: string): Promise<number> {
  const built = message(notice, appUrl);
  try {
    const response = await fetch(RESEND_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [built.to], subject: built.subject, text: built.text, html: built.html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.error("Resend a refusé un message", response.status, notice.id);
    return response.status;
  } catch (failure) {
    console.error("Envoi impossible", failure instanceof Error ? failure.message : failure);
    return 0;
  }
}

/**
 * Vide la file d'emails, tous centres confondus.
 *
 * Même principe que la file poussée : une notification est écrite au moment où
 * elle est méritée, l'envoi est un acte séparé, réservé sous verrou avec un
 * bail — deux passages simultanés ne poussent jamais le même message deux fois,
 * une interruption ne perd rien, et une adresse refusée ne retient que sa
 * propre ligne. Le serveur la lit sous sa clé, parce qu'un agent qui se
 * désiste n'a aucun droit sur la file et que personne ne devait attendre
 * qu'un gestionnaire agisse pour être prévenu.
 */
export async function dispatchEmails() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const appUrl = process.env.APP_URL;
  if (!key || !from || !appUrl || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    throw new Error(`Envoi des emails non configuré : ${missing().join(", ")} manquant(s)`);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let processed = 0;
  let sent = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { data, error } = await client.rpc("claim_email_deliveries", { batch: BATCH });
    // Le message de la base, pour savoir où chercher : il part au journal du
    // serveur, jamais à l'écran.
    if (error) throw new Error(`Réservation des envois impossible : ${error.message}`);
    const jobs = (data ?? []) as (Pending & { lease: string })[];
    // Un message après l'autre : Resend limite le débit, et un lot parti en
    // parallèle ne ferait que provoquer les refus qu'on cherche à éviter.
    for (const job of jobs) {
      const status = await send(job, key, from, appUrl);
      const { error: failure } = await client.rpc("finish_email_delivery", {
        delivery: job.id,
        token: job.lease,
        http_status: status,
      });
      if (failure) throw new Error(`Résultat d’envoi non enregistré : ${failure.message}`);
      processed++;
      if (status >= 200 && status < 300) sent++;
    }
    if (jobs.length < BATCH) break;
  }
  return { processed, sent };
}
