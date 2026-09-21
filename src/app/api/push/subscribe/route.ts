import { NextResponse } from "next/server";
import { pushSubscriptionSchema } from "@/lib/push";
import { pushConfigured } from "@/lib/push.server";
import { readSession } from "@/lib/session.server";
import { createActionClient } from "@/lib/supabase/server";

/**
 * L'appareil dit ce que son navigateur vient de lui donner.
 *
 * Une route plutôt qu'une commande : l'abonnement appartient à l'appareil, pas
 * au centre. Il ne change rien à ce que montrent les écrans, et une commande
 * aurait fait relire toute la page pour une case cochée.
 *
 * Le corps est validé avant d'atteindre la base — l'adresse de remise doit être
 * celle d'un service connu, sans quoi l'application deviendrait un relais vers
 * l'hôte de son choix. Le compte vient de la session, jamais du corps.
 */
export async function POST(request: Request) {
  if (!pushConfigured()) return new NextResponse("Notifications non configurées", { status: 503 });
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const parsed = pushSubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Abonnement invalide", { status: 400 });

  const client = await createActionClient();
  const { error } = await client.rpc("register_push_subscription", {
    device_endpoint: parsed.data.endpoint,
    device_p256dh: parsed.data.keys.p256dh,
    device_auth: parsed.data.keys.auth,
  });
  if (error) {
    console.error("Abonnement Web Push non enregistré", error.message);
    return new NextResponse("Enregistrement impossible", { status: 503 });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

/**
 * L'agent coupe les notifications sur cet appareil, ou s'en sépare.
 *
 * L'effacement passe par les policies : une session ne peut retirer que ses
 * propres lignes. Une adresse déjà absente n'est pas une erreur — le navigateur
 * a pu se désabonner de son côté avant que l'application le sache.
 */
export async function DELETE(request: Request) {
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const body = await request.json().catch(() => null);
  const endpoint = typeof body === "object" && body !== null ? (body as { endpoint?: unknown }).endpoint : null;
  if (typeof endpoint !== "string" || !endpoint) return new NextResponse("Abonnement invalide", { status: 400 });

  const client = await createActionClient();
  const { error } = await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) {
    console.error("Abonnement Web Push non retiré", error.message);
    return new NextResponse("Retrait impossible", { status: 503 });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
