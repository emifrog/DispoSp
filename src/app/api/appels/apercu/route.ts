import { NextResponse, type NextRequest } from "next/server";
import { frenchMessage } from "@/lib/command-errors";
import { readSession } from "@/lib/session.server";
import { createReadClient } from "@/lib/supabase/server";

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const noStore = { "Cache-Control": "private, no-store" };

/**
 * L'aperçu d'un appel à remplacement ou à renfort (lot C), avant de le lancer :
 * le besoin restant de la garde, et combien d'agents l'appel atteindrait, d'abord
 * et après élargissement. Avec un désistement, comme s'il était accepté.
 *
 * Une lecture, demandée à l'ouverture de la fenêtre, sous la session du
 * gestionnaire ; la base contrôle les droits (public.call_preview()).
 */
export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401, headers: noStore });
  const params = request.nextUrl.searchParams;
  const campaign = params.get("campagne") ?? "";
  const date = params.get("date") ?? "";
  const shift = params.get("creneau") ?? "";
  const withdrawal = params.get("desistement");
  if (
    !guid.test(campaign) ||
    !isoDate.test(date) ||
    (shift !== "DAY" && shift !== "NIGHT") ||
    (withdrawal !== null && !guid.test(withdrawal))
  )
    return new NextResponse("Garde invalide", { status: 400, headers: noStore });

  const supabase = await createReadClient();
  const { data: slot, error: lookup } = await supabase
    .from("schedule_shifts")
    .select("id, schedules!inner(campaign_id)")
    .eq("schedules.campaign_id", campaign)
    .eq("date", date)
    .eq("shift_code", shift)
    .maybeSingle();
  if (lookup || !slot)
    return NextResponse.json(
      { message: "Cette garde ne fait pas partie du planning de la campagne." },
      { status: 404, headers: noStore },
    );
  const { data, error } = await supabase.rpc("call_preview", { shift: slot.id, withdrawal });
  if (error) {
    console.error("Aperçu d’appel refusé :", error.code ?? "sans code", error.message);
    const forbidden = error.code === "42501" || /^Not allowed/.test(error.message ?? "");
    return NextResponse.json({ message: frenchMessage(error) }, { status: forbidden ? 403 : 500, headers: noStore });
  }
  return NextResponse.json(data, { headers: noStore });
}
