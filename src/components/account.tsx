import { CalendarPlus, ShieldCheck } from "lucide-react";
import type { AttachedSession, Session } from "@/lib/session";
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

// A freshly provisioned organization has no campaign, and every screen is built
// around one. Say so rather than render a workspace with nothing in it.
export function NoCampaign({ session }: { session: AttachedSession }) {
  return (
    <main className="sign-in" id="main">
      <section className="sign-in-card">
        <Brand />
        <h1>Aucune campagne ouverte</h1>
        <p className="muted">
          {session.membership.organizationName} n’a pas encore de campagne de disponibilités. Tous les écrans en
          dépendent.
        </p>
        <div className="info-card">
          <CalendarPlus size={22} />
          <h3>Ouvrir la première campagne</h3>
          <p>
            La création depuis l’interface arrivera avec l’enregistrement en base. En attendant, exécutez
            <code> supabase/provisioning/premiere-campagne.sql</code> dans l’éditeur SQL du tableau de bord Supabase.
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
