import { redirect } from "next/navigation";
import { readSession } from "@/lib/session.server";
import { SIGN_IN_PATH } from "@/lib/supabase/config";

/**
 * La racine décide seule où envoyer, et c'est le rôle qui tranche.
 *
 * Un agent n'a rien à faire sur le tableau de bord du centre : les policies ne
 * lui montrant que sa propre ligne, il y verrait une synthèse d'une seule
 * personne, la sienne, présentée comme celle de l'effectif. Son écran d'accueil
 * dit la même donnée à la première personne.
 *
 * Un compte sans rattachement part aussi vers l'accueil : la mise en page de
 * l'espace de travail sait l'accueillir, et lui seul sait le dire proprement.
 */
export default async function Home() {
  const session = await readSession();
  if (!session) redirect(SIGN_IN_PATH);
  redirect(session.membership && session.membership.role !== "AGENT" ? "/tableau-de-bord" : "/accueil");
}
