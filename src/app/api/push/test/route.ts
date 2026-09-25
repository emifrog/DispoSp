import { NextResponse } from "next/server";
import { crossSite } from "@/lib/cross-site";
import { pushConfigured, sendTestPush } from "@/lib/push.server";
import { readSession } from "@/lib/session.server";
import { createActionClient } from "@/lib/supabase/server";

/**
 * L'essai, depuis le profil.
 *
 * Activer les notifications ne prouve rien : l'agent a coché une case, et il ne
 * saura qu'à la prochaine campagne si la bulle arrive vraiment — un mois plus
 * tard, quand il sera trop tard pour s'en apercevoir. Cet envoi immédiat est la
 * seule preuve possible, et il ne peut atteindre que les appareils de
 * l'appelant : les policies ne lui rendent que ses propres abonnements.
 */
export async function POST(request: Request) {
  // Un envoi que n'importe quel site pouvait déclencher sur les appareils de
  // l'agent connecté, à chaque visite : même contrôle que /deconnexion.
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  if (!pushConfigured()) return new NextResponse("Notifications non configurées", { status: 503 });
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const client = await createActionClient();
  const { data, error } = await client.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (error) {
    console.error("Abonnements illisibles", error.message);
    return new NextResponse("Envoi impossible", { status: 503 });
  }
  const devices = (data ?? []).map(row => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  if (!devices.length) return NextResponse.json({ sent: 0, devices: 0 }, { headers: { "Cache-Control": "no-store" } });

  const { sent, gone } = await sendTestPush(devices);
  // Un appareil que le service de remise ne connaît plus ne reviendra pas :
  // le garder ferait échouer chaque envoi suivant.
  if (gone.length) await client.from("push_subscriptions").delete().in("endpoint", gone);
  return NextResponse.json({ sent, devices: devices.length }, { headers: { "Cache-Control": "no-store" } });
}
