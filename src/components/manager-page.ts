import "server-only";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session.server";

/**
 * Renvoie un agent vers son accueil avant qu'un écran d'encadrement se rende.
 *
 * La barre latérale ne lui montre pas ces écrans, et le bandeau les lui refuse
 * — mais côté navigateur seulement, une fois la page servie : une adresse
 * tapée ou un lien partagé la lui livrait, puis la masquait. Seul le tableau de
 * bord le redirigeait côté serveur. Les policies, elles, ne lui renvoient de
 * toute façon que ses propres lignes : ce garde n'ajoute pas de sécurité, il
 * évite un écran qui ne lui est pas destiné.
 *
 * La session est celle que la mise en page vient de lire : `readSession` est
 * mise en cache le temps d'une requête, ce garde ne coûte aucun aller-retour.
 */
export async function refuseAgents() {
  const session = await readSession();
  if (session?.membership?.role === "AGENT") redirect("/accueil");
}

/**
 * Renvoie l'encadrement vers son tableau de bord avant qu'un écran d'agent se
 * rende : accueil, saisie, planning personnel.
 *
 * L'encadrement ne prend pas de garde (décision C6, 16 octobre) et n'est plus
 * inscrit aux campagnes. Ces écrans lui proposaient de saisir un mois que la
 * base refusera d'enregistrer, ou lui parlaient de gardes qu'il ne tient pas.
 */
export async function refuseManagers() {
  const session = await readSession();
  if (session?.membership && session.membership.role !== "AGENT") redirect("/tableau-de-bord");
}
