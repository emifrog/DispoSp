import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { pushPayload, pushSubscriptionSchema, type PushSubscriptionInput } from "./push";

/** Ce que la base rend par passage ; en deçà, la file est vide et on s'arrête. */
const BATCH = 10;
/** Au-delà, on laisse la suite au passage suivant ou au planificateur. */
const MAX_PASSES = 20;

/**
 * Ce qui manque pour que les notifications poussées fonctionnent, ou rien.
 *
 * Tout ce que l'envoi réclame, et pas seulement les trois variables VAPID : la
 * clé secrète du projet, sans laquelle la file ne se lit pas. Sans elle,
 * l'écran proposait l'activation, l'abonnement s'enregistrait, l'essai
 * fonctionnait — et chaque commande écrivait « Le traitement Web Push a
 * échoué » sans qu'une seule bulle réelle ne parte. Personne ne le remarquait
 * avant la première campagne.
 *
 * Le sujet et les clés sont vérifiés une fois, ici, plutôt que découverts à
 * chaque envoi par une exception de web-push que rien ne journalisait.
 */
export function pushMisconfiguration(): string | null {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  if (!publicKey || !privateKey || !subject)
    return "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY et WEB_PUSH_SUBJECT vont ensemble";
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey))
    return "NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY n'est pas une clé VAPID publique (87 caractères base64url)";
  if (!/^[A-Za-z0-9_-]{43}$/.test(privateKey))
    return "WEB_PUSH_PRIVATE_KEY n'est pas une clé VAPID privée (43 caractères base64url)";
  if (!/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(subject))
    return "WEB_PUSH_SUBJECT doit être une adresse « mailto:… » ou une adresse https";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    return "SUPABASE_SECRET_KEY est nécessaire pour lire la file des envois poussés";
  return null;
}

let reported: string | null | undefined;
export function pushConfigured() {
  const problem = pushMisconfiguration();
  // Une ligne, une fois : la configuration ne change pas entre deux requêtes.
  if (problem && reported !== problem) console.error("Notifications poussées désactivées :", problem);
  reported = problem;
  return problem === null;
}

function vapid() {
  return {
    subject: process.env.WEB_PUSH_SUBJECT!,
    publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY!,
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
  };
}

/**
 * Envoie un message à un appareil et rend le code du service de remise.
 *
 * Ne lève jamais : un refus est une réponse, pas une panne. 404 et 410 disent
 * que l'abonnement n'existe plus — l'appareil a été effacé, l'application
 * désinstallée — et l'appelant en tire les conséquences. Le zéro est le
 * silence : réseau coupé, délai dépassé, ou une erreur de web-push lui-même,
 * qui se journalise — cinq tentatives muettes ne disent rien à personne.
 */
async function deliver(subscription: PushSubscriptionInput, payload: string): Promise<number> {
  try {
    const response = await webpush.sendNotification(subscription, payload, {
      vapidDetails: vapid(),
      TTL: 3600,
      timeout: 5000,
      urgency: "normal",
    });
    return response.statusCode;
  } catch (error) {
    if (typeof error === "object" && error !== null && "statusCode" in error && Number(error.statusCode))
      return Number(error.statusCode);
    console.error("Envoi poussé impossible", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * Vide la file d'envoi.
 *
 * La file est en base : une notification est écrite au moment où elle est
 * méritée, l'envoi est un acte séparé qui peut échouer et se rejouer. Chaque
 * passage réserve dix envois pour deux minutes — le bail — de sorte que deux
 * passages simultanés ne poussent jamais le même message deux fois, et qu'une
 * interruption ne perde rien. On repasse tant que la base rend un lot plein :
 * une campagne ouverte pour trente agents n'a pas à attendre trois clics.
 */
export async function dispatchPush() {
  // La raison, et pas seulement le constat : c'est elle que le journal retient.
  if (!pushConfigured()) throw new Error(`Push non configuré : ${pushMisconfiguration()}`);
  // Client privilégié dédié au worker, jamais partagé avec une commande utilisateur.
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let processed = 0;
  let sent = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const { data, error } = await client.rpc("claim_push_deliveries");
    if (error) throw new Error(`Réservation des envois impossible : ${error.message}`);
    const jobs = (data ?? []) as {
      id: string;
      lease: string;
      subscription_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      notification_id: string;
      kind: string;
    }[];
    await Promise.all(
      jobs.map(async job => {
        const parsed = pushSubscriptionSchema.safeParse({
          endpoint: job.endpoint,
          keys: { p256dh: job.p256dh, auth: job.auth },
        });
        // Une adresse qui ne passe plus la validation ne partira jamais : autant
        // le dire tout de suite plutôt que de la réessayer cinq fois.
        const status = parsed.success
          ? await deliver(parsed.data, JSON.stringify(pushPayload(job.notification_id, job.kind)))
          : 400;
        const { error: failure } = await client.rpc("finish_push_delivery", {
          delivery: job.id,
          token: job.lease,
          http_status: status,
        });
        if (failure) throw new Error(`Résultat d’envoi non enregistré : ${failure.message}`);
        if (status >= 200 && status < 300) sent++;
      }),
    );
    processed += jobs.length;
    if (jobs.length < BATCH) break;
  }
  return { processed, sent };
}

/**
 * L'essai que l'agent déclenche depuis son profil, pour voir la bulle arriver.
 *
 * Il ne passe pas par la file : il ne naît d'aucune notification et ne doit
 * rien laisser derrière lui. Les abonnements sont lus sous la session de
 * l'appelant — les policies ne rendent que les siens, donc un essai ne peut
 * atteindre que ses propres appareils.
 */
export async function sendTestPush(devices: PushSubscriptionInput[]) {
  const payload = JSON.stringify({
    title: "DispoSP",
    body: "Les notifications sont bien actives sur cet appareil.",
    tag: "test",
    url: "/profil",
  });
  const codes = await Promise.all(devices.map(device => deliver(device, payload)));
  return {
    sent: codes.filter(code => code >= 200 && code < 300).length,
    // L'appareil a disparu côté service de remise : l'appelant efface la ligne.
    gone: devices.filter((_, index) => codes[index] === 404 || codes[index] === 410).map(device => device.endpoint),
  };
}
