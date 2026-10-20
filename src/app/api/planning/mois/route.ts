import { NextResponse, type NextRequest } from "next/server";
import { frenchMessage } from "@/lib/command-errors";
import { readSession } from "@/lib/session.server";
import { createReadClient } from "@/lib/supabase/server";

const campaignId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store" };

/**
 * L'aperçu de la publication du mois (lot B) : chaque créneau de la campagne,
 * prêt, bloqué ou inchangé, et l'empreinte de ce que la base a vu.
 *
 * Une route plutôt qu'une action : c'est une lecture, demandée à l'ouverture
 * de la fenêtre, et le client n'envoie les actions serveur qu'une à la fois.
 * La base classe et contrôle les droits (public.month_publication_preview()),
 * sous la session du gestionnaire.
 */
export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401, headers: noStore });
  const campaign = request.nextUrl.searchParams.get("campagne") ?? "";
  if (!campaignId.test(campaign)) return new NextResponse("Campagne invalide", { status: 400, headers: noStore });

  const supabase = await createReadClient();
  const { data, error } = await supabase.rpc("month_publication_preview", { campaign });
  if (error) {
    console.error("Aperçu du mois refusé :", error.code ?? "sans code", error.message);
    const forbidden = error.code === "42501" || /^Not allowed/.test(error.message ?? "");
    return NextResponse.json({ message: frenchMessage(error) }, { status: forbidden ? 403 : 500, headers: noStore });
  }
  return NextResponse.json(data, { headers: noStore });
}
