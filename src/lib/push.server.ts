import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { pushPayload, pushSubscriptionSchema, type PushSubscriptionInput } from "./push";

export function pushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY && process.env.WEB_PUSH_SUBJECT,
  );
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
 * silence : réseau coupé, délai dépassé.
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
    return typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) || 0 : 0;
  }
}

/**
 * Vide un lot de la file d'envoi.
 *
 * La file est en base : une notification est écrite au moment où elle est
 * méritée, l'envoi est un acte séparé qui peut échouer et se rejouer. Chaque
 * passage réserve dix envois pour deux minutes — le bail — de sorte que deux
 * passages simultanés ne poussent jamais le même message deux fois, et qu'une
 * interruption ne perde rien.
 */
export async function dispatchPush() {
  if (!pushConfigured() || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
    throw new Error("Push non configuré");
  // Client privilégié dédié au worker, jamais partagé avec une commande utilisateur.
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("claim_push_deliveries");
  if (error) throw new Error("Réservation des envois impossible");
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
  let sent = 0;
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
      if (failure) throw new Error("Résultat d’envoi non enregistré");
      if (status >= 200 && status < 300) sent++;
    }),
  );
  return { processed: jobs.length, sent };
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
