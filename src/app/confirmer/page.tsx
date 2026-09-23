import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { linkRoutes, type LinkKind } from "@/lib/auth-link";
import { SIGN_IN_PATH } from "@/lib/supabase/config";

/**
 * La page qu'ouvre un lien d'invitation ou de réinitialisation.
 *
 * Elle ne vérifie rien : ouvrir un lien ne doit pas le consommer, parce que les
 * messageries l'ouvrent pour l'analyser avant l'agent. Le bouton envoie le
 * jeton à la route qui le vérifie — un formulaire ordinaire, qui marche sans
 * aucun script.
 */
const wording: Record<LinkKind, { title: string; intro: string }> = {
  invite: {
    title: "Activer mon compte",
    intro:
      "Votre centre vous a inscrit sur DispoSP. Continuez pour choisir le mot de passe qui vous servira à vous connecter.",
  },
  recovery: {
    title: "Nouveau mot de passe",
    intro: "Continuez pour choisir un nouveau mot de passe.",
  },
};

export default async function Confirm({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = params.type === "invite" || params.type === "recovery" ? params.type : null;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";

  return (
    <main className="sign-in" id="main">
      <aside className="sign-in-hero" aria-hidden="true">
        <Brand variant="onDark" width={210} />
        <h2>
          Planification
          <br />
          des disponibilités
        </h2>
        <p>Une meilleure couverture opérationnelle, ensemble.</p>
      </aside>
      <section className="sign-in-card">
        <div className="sign-in-brand">
          <Brand width={168} />
        </div>
        {kind && tokenHash ? (
          <>
            <h1>{wording[kind].title}</h1>
            <p className="muted">{wording[kind].intro}</p>
            <form method="post" action={linkRoutes[kind].route}>
              <input type="hidden" name="token_hash" value={tokenHash} />
              <Button type="submit" className="full-width">
                Continuer
                <ArrowRight size={17} />
              </Button>
            </form>
            <p className="muted small">
              Ce lien ne sert qu’une fois : il n’est utilisé qu’au moment où vous continuez.
            </p>
          </>
        ) : (
          <>
            <h1>Lien incomplet</h1>
            <p className="muted">
              Ce lien ne porte pas ce qu’il faut pour vous identifier. Ouvrez-le de nouveau depuis le message reçu, en
              entier.
            </p>
            <Button className="full-width" asChild>
              <Link href={SIGN_IN_PATH}>Revenir à la connexion</Link>
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
