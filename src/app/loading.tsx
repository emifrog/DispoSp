import { Loading } from "@/components/common";

/**
 * Le premier chargement, avant que quoi que ce soit s'affiche.
 *
 * La mise en page de l'espace de travail lit toute la base avant de rendre la
 * barre latérale : tant qu'elle attend, il n'y a rien à montrer autour. Cette
 * attente-là se place donc à la racine, au-dessus de tout, et non dans le
 * groupe — un `loading` de groupe n'enveloppe pas la mise en page qui le porte.
 */
export default function RootLoading() {
  return (
    <main className="loading-page" id="main">
      <Loading label="Chargement de votre centre…" />
    </main>
  );
}
