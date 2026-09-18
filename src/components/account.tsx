import { ShieldCheck } from "lucide-react";
import type { Session } from "@/lib/session";
import { Brand } from "./brand";

// The state every new account starts in: the schema deliberately keeps
// organization, team and role provisioning out of the client API, so nobody can
// attach themselves. Say that plainly instead of showing ten empty screens.
export function UnattachedAccount({ session }: { session: Session }) {
  return (
    <main className="sign-in" id="main">
      <section className="sign-in-card">
        <Brand />
        <h1>Compte en attente de rattachement</h1>
        <p className="muted">
          Vous êtes connecté avec <strong>{session.email}</strong>, mais ce compte n’est rattaché à aucun centre.
        </p>
        <div className="info-card">
          <ShieldCheck size={22} />
          <h3>Pourquoi cet écran&nbsp;?</h3>
          <p>
            Le rattachement d’un agent à un centre et à une équipe n’est pas accessible depuis l’application : c’est une
            opération d’administration. Demandez à l’administrateur de votre centre de vous ajouter.
          </p>
        </div>
        <form method="post" action="/deconnexion">
          <button type="submit" className="button button-secondary full-width">
            Se déconnecter
          </button>
        </form>
      </section>
    </main>
  );
}
