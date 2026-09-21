import { z } from "zod";

// Liste des services de livraison, pas des sites autorisés à appeler notre API.
// Un endpoint arbitraire pourrait transformer l'expéditeur en relais HTTP.
export function validPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const allowed = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "push.services.mozilla.com",
      "web.push.apple.com",
    ];
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (allowed.includes(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(validPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export function pushPayload(id: string, kind: string) {
  const labels: Record<string, string> = {
    CAMPAIGN_OPENED: "Une campagne de disponibilités est ouverte.",
    CAMPAIGN_REMINDER: "Pensez à valider vos disponibilités.",
    SCHEDULE_PUBLISHED: "Votre planning a été publié ou modifié.",
    WITHDRAWAL_REQUESTED: "Une demande de désistement attend votre réponse.",
    WITHDRAWAL_DECIDED: "Une réponse à votre désistement est disponible.",
  };
  // Aucun nom, motif de désistement ou détail de garde sur l'écran verrouillé.
  return {
    title: "DispoSP",
    body: labels[kind] ?? "Une nouvelle notification vous attend.",
    tag: id,
    url: "/notifications",
  };
}

/**
 * La clé publique VAPID, telle que le navigateur la réclame.
 *
 * Elle part dans le paquet du navigateur — c'est sa raison d'être : elle
 * identifie l'expéditeur auprès du service de remise, qui refusera ensuite tout
 * envoi non signé par la clé privée correspondante. Absente, l'application
 * n'offre simplement pas l'activation.
 */
export const vapidPublicKey = () => process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";

/** `pushManager.subscribe` n'accepte pas le base64url de la clé, mais ses octets. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  // Le tampon est nommé : `pushManager.subscribe` réclame un ArrayBuffer, et
  // un Uint8Array qui n'a pas dit lequel il porte ne lui convient pas.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
