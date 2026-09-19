import { redirect } from "next/navigation";
import { readSession } from "@/lib/session.server";
import { Dashboard } from "@/components/dashboard";

// Le tableau de bord parle de l'effectif. Un agent n'en voit qu'une ligne — la
// sienne, les policies ne lui montrant pas les autres — et l'écran lui
// présenterait donc une synthèse du centre calculée sur une seule personne. On
// le renvoie là où la même donnée est dite à la première personne.
export default async function Page() {
  const session = await readSession();
  if (session?.membership?.role === "AGENT") redirect("/accueil");
  return <Dashboard />;
}
