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

/**
 * Aucune campagne à afficher, et tous les écrans en dépendent.
 *
 * Deux situations sans rapport, qu'il serait malhonnête de confondre : le
 * centre n'en a ouvert aucune, ou l'agent n'est convié à aucune de celles qui
 * existent. Dire « aucune campagne ouverte » à quelqu'un dont l'équipe vient
 * d'en ouvrir une l'enverrait chercher un problème là où il n'y en a pas.
 */
export function NoCampaign({ session, manages }: { session: AttachedSession; manages: boolean }) {
  return (
    <main className="sign-in" id="main">
      <section className="sign-in-card">
        <Brand />
        <h1>{manages ? "Aucune campagne ouverte" : "Aucune campagne ne vous concerne"}</h1>
        <p className="muted">
          {manages
            ? `${session.membership.organizationName} n’a pas encore de campagne de disponibilités. Tous les écrans en dépendent.`
            : `Aucune campagne ouverte à ${session.membership.organizationName} ne vous a été adressée. Vous y aurez accès dès que votre équipe sera concernée.`}
        </p>
        <div className="info-card">
          <CalendarPlus size={22} />
          <h3>{manages ? "Ouvrir la première campagne" : "Que faire en attendant"}</h3>
          <p>
            {manages
              ? "Depuis l’écran Campagnes, « Nouvelle campagne » ouvre le mois, prépare les créneaux Jour et Nuit et invite les membres actifs de l’équipe."
              : "Rien de votre côté. Rapprochez-vous de votre encadrement si vous pensez devoir figurer dans une campagne en cours."}
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
