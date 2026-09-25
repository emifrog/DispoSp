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
  // Deux barres obliques inverses dans le source, pour une seule dans le motif :
  // écrit `\.`, le point perdait son échappement dans la chaîne JavaScript et
  // valait « n'importe quel caractère ». /tableau-de-bordpng échappait alors au
  // garde, comme tout chemin finissant par « png » ou « ico » sans point devant.
  // tests/proxy.test.ts compile ce motif comme Next le fait.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
