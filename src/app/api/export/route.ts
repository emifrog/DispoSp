import { NextResponse, type NextRequest } from "next/server";
import { buildWorkbook } from "@/lib/workbook";
import { loadState } from "@/lib/data.server";
import { readSession } from "@/lib/session.server";
import type { AttachedSession } from "@/lib/session";

// A route handler rather than a Server Action: the answer is a file, and this
// keeps ExcelJS — which is large — out of every browser bundle. The workbook is
// built from the same state the screens read, under the same RLS.
export async function GET(request: NextRequest) {
  const session = await readSession();
  if (!session?.membership) return new NextResponse("Non authentifié", { status: 401 });

  const state = await loadState({ ...session, membership: session.membership } as AttachedSession);
  const wanted = request.nextUrl.searchParams.get("campagne");
  const campaign = state.campaigns.find(c => c.id === wanted) ?? state.campaigns[0];
  if (!campaign) return new NextResponse("Aucune campagne", { status: 404 });

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
