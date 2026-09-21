import { Loading } from "@/components/common";

// Affiché pendant qu'un écran de travail se construit, la barre latérale et
// l'en-tête restant en place : la mise en page du groupe est conservée d'une
// navigation à l'autre, seul le contenu change.
export default function WorkspaceLoading() {
  return <Loading />;
}
