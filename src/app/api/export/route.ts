import { NextResponse, type NextRequest } from "next/server";
import { buildWorkbook } from "@/lib/workbook";
import { loadState } from "@/lib/data.server";
import { defaultCampaign } from "@/lib/domain";
import { readSession } from "@/lib/session.server";
import type { AttachedSession } from "@/lib/session";

// A route handler rather than a Server Action: the answer is a file, and this
// keeps ExcelJS — which is large — out of every browser bundle. The workbook is
// built from the same state the screens read, under the same RLS.
export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const wanted = request.nextUrl.searchParams.get("campagne");
  // La campagne demandée, même archivée : son détail se lit avec le reste.
  const state = await loadState({ ...session, membership: session.membership } as AttachedSession, wanted);
  /*
   * Une campagne demandée et introuvable est un 404, jamais une autre : le
   * repli sur la première exportait en silence le mois d'un autre — vu en
   * production, un identifiant inconnu rendait 200 et le fichier d'octobre.
   * L'écran passe toujours l'identifiant ; seule une adresse sans paramètre
   * garde un repli, pour qui la tape à la main — la campagne par défaut des
   * écrans, plutôt que la plus ancienne du centre.
   */
  const campaign = wanted ? state.campaigns.find(c => c.id === wanted) : defaultCampaign(state.campaigns);
  if (!campaign) return new NextResponse(wanted ? "Campagne introuvable" : "Aucune campagne", { status: 404 });

  const buffer = await buildWorkbook(state, campaign).xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="disposp-${campaign.month}.xlsx"`,
      // Never a shared cache: the file carries a centre's roster.
      "Cache-Control": "private, no-store",
    },
  });
}
