import { NextResponse } from "next/server";
import { crossSite } from "@/lib/cross-site";
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
 *
 * `claim: false` : l'appareil n'est pas réclamé. La base rafraîchit alors
 * l'abonnement s'il est déjà celui du compte, et ne fait rien d'autre — c'est ce
 * que l'application demande à l'ouverture, pour un compte qui n'a pas accepté
 * les notifications sur cet appareil. Sans cela, se connecter sur la tablette
 * du centre suffisait à en prendre les notifications au compte précédent.
 * Absent, il vaut réclamation : l'agent de service renouvelle un abonnement déjà
 * voulu, et ne sait pas le dire.
 *
 * 204 : l'appareil est inscrit pour ce compte. 409 : il ne l'est pas, parce
 * qu'il n'a pas été réclamé.
 */
export async function POST(request: Request) {
  // Comme /deconnexion : une route écrite à la main n'a pas le contrôle d'origine
  // des actions serveur. Sans lui, une page tierce pouvait abonner l'appareil
  // d'un agent connecté à l'adresse de remise de son choix, parmi les services
  // connus. Le renouvellement que poste l'agent de service part de la même
  // origine, et passe.
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  if (!pushConfigured()) return new NextResponse("Notifications non configurées", { status: 503 });
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const body: unknown = await request.json().catch(() => null);
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) return new NextResponse("Abonnement invalide", { status: 400 });
  const claim = (body as { claim?: unknown }).claim !== false;

  const client = await createActionClient();
  const { data, error } = await client.rpc("register_push_subscription", {
    device_endpoint: parsed.data.endpoint,
    device_p256dh: parsed.data.keys.p256dh,
    device_auth: parsed.data.keys.auth,
    claim,
  });
  if (error) {
    console.error("Abonnement Web Push non enregistré", error.message);
    return new NextResponse("Enregistrement impossible", { status: 503 });
  }
  if (data === false)
    return new NextResponse("Appareil non inscrit pour ce compte", {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
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
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
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
