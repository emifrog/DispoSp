import { type NextRequest } from "next/server";
import { forwardCampaign } from "@/lib/campaign-header";
import { updateSession } from "@/lib/supabase/middleware";

// « proxy » est le nom que Next 16 donne à ce qui s'appelait « middleware » :
// l'ancien nom est déprécié et avertissait à chaque build.
export async function proxy(request: NextRequest) {
  // updateSession transmet les en-têtes de la requête qu'on lui donne.
  return updateSession(forwardCampaign(request));
}

export const config = {
  // `\.` et non `\.` : dans une chaîne, `\.` vaut `.`, et le motif laissait
  // passer tout chemin finissant par « png » ou « ico » sans point devant.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
