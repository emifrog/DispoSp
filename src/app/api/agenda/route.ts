import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { frenchMessage } from "@/lib/command-errors";
import { crossSite } from "@/lib/cross-site";
import { readSession } from "@/lib/session.server";
import { createActionClient } from "@/lib/supabase/server";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * L'adresse d'abonnement de l'agent connecté (lot D).
 *
 * POST en crée une — et révoque la précédente —, DELETE la révoque. Le jeton
 * est tiré ici, rendu une seule fois à l'agent, et seul son condensat SHA-256
 * part en base : personne, pas même l'encadrement, ne peut le relire ensuite.
 * Une route écrite à la main n'a pas le contrôle d'origine des actions serveur :
 * elle le fait elle-même, comme /api/push/subscribe.
 */
export async function POST(request: Request) {
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });
  const token = randomBytes(32).toString("base64url");
  const supabase = await createActionClient();
  const { error } = await supabase.rpc("create_calendar_feed", {
    token_hash: createHash("sha256").update(token).digest("hex"),
  });
  if (error) {
    console.error("Abonnement à l’agenda refusé :", error.code ?? "sans code", error.message);
    return NextResponse.json({ message: frenchMessage(error) }, { status: 403, headers: noStore });
  }
  const base = process.env.APP_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
  return NextResponse.json({ url: `${base}/api/agenda/${token}.ics` }, { headers: noStore });
}

export async function DELETE(request: Request) {
  if (crossSite(request)) return new NextResponse("Requête refusée", { status: 403 });
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });
  const supabase = await createActionClient();
  const { error } = await supabase.rpc("revoke_calendar_feed");
  if (error) {
    console.error("Révocation de l’agenda refusée :", error.code ?? "sans code", error.message);
    return NextResponse.json({ message: frenchMessage(error) }, { status: 500, headers: noStore });
  }
  return new NextResponse(null, { status: 204, headers: noStore });
}
