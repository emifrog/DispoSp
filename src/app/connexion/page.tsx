import type { Metadata } from "next";
import { SignInForm } from "@/components/auth";

export const metadata: Metadata = { title: "Connexion" };

/**
 * Ce que les deux routes de vérification renvoient ici.
 *
 * `/auth/activation` et `/auth/recuperation` aboutissent sur cet écran quand le
 * jeton est mort, en le disant dans l'adresse. Personne ne le lisait : l'agent
 * dont le lien avait déjà servi — parce qu'il a été ouvert ailleurs, ou parce
 * qu'il l'a rouvert par réflexe — tombait sur un écran de connexion muet, sans
 * savoir qu'il devait en demander un autre.
 *
 * Un dictionnaire plutôt qu'un affichage direct : ce qui vient de l'adresse ne
 * s'écrit jamais tel quel dans la page.
 */
const NOTICES: Record<string, string> = {
  expire:
    "Ce lien n’est plus valable : il a déjà servi, ou son délai est passé. Il en faut un nouveau — « Mot de passe oublié » ci-dessous s’il s’agissait d’une réinitialisation, votre gestionnaire s’il s’agissait d’une invitation à rejoindre un centre.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ lien?: string | string[] }> }) {
  const { lien } = await searchParams;
  const asked = Array.isArray(lien) ? lien[0] : lien;
  return <SignInForm notice={asked ? NOTICES[asked] : undefined} />;
}
