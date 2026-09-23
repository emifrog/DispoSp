import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { NoCampaign, UnattachedAccount } from "@/components/account";
import { PushInvitation } from "@/components/pwa";
import { readSession } from "@/lib/session.server";
import { loadState } from "@/lib/data.server";
import { SIGN_IN_PATH } from "@/lib/supabase/config";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CAMPAIGN_HEADER } from "@/lib/campaign-param";
import type { AttachedSession } from "@/lib/session";
import { memberRoles, visibleCampaigns, type Actor, type MemberRole } from "@/lib/domain";

// Only AGENT is limited to the personal screens; every other role manages.
const actorFor = (session: AttachedSession): Actor => ({
  id: session.userId,
  role: session.membership.role === "AGENT" ? "AGENT" : "MANAGER",
});
// The four roles of §2 travel separately: the business rules only ask whether
// someone manages, the screens also need to know whether they administer.
const memberRoleOf = (session: AttachedSession): MemberRole =>
  memberRoles.includes(session.membership.role as MemberRole) ? (session.membership.role as MemberRole) : "AGENT";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  // Le garde du middleware s'en charge déjà ; cette redirection n'existe que
  // pour que la suite du fichier n'ait plus à envisager l'absence de session.
  if (!session) redirect(SIGN_IN_PATH);
  if (!session.membership) return <UnattachedAccount session={session} />;
  const attached: AttachedSession = { ...session, membership: session.membership };
  // Une campagne archivée ne se charge que si l'adresse la demande ; le proxy
  // la relaie ici, où les paramètres de l'adresse n'arrivent pas.
  const loaded = await loadState(attached, (await headers()).get(CAMPAIGN_HEADER));
  const actor = actorFor(attached);
  // Les policies laissent un agent lire les campagnes de son centre, ce qui est
  // juste : il doit pouvoir voir que le mois existe. Mais les lui proposer dans
  // le sélecteur le menait sur un calendrier où la base refuse toute écriture,
  // sans qu'aucun écran ne sache lui dire pourquoi. On ne lui montre donc que
  // celles auxquelles il est convié ; qui encadre les voit toutes.
  const state = { ...loaded, campaigns: visibleCampaigns(loaded, attached.userId, actor.role === "MANAGER") };
  // Every screen is built around a selected campaign; the provider would have
  // none to select. Guard here so no screen has to handle the empty case.
  if (!state.campaigns.length) return <NoCampaign session={attached} manages={actor.role === "MANAGER"} />;
  return (
    <AppProvider state={state} actor={actor} memberRole={memberRoleOf(attached)}>
      <Shell session={attached}>{children}</Shell>
      {/* Posée ici et non dans un écran : elle doit se présenter à l'arrivée,
          quelle que soit la page où la connexion a mené, et ne pas reparaître à
          chaque navigation — cette mise en page, elle, ne se remonte pas. */}
      <PushInvitation userId={attached.userId} />
    </AppProvider>
  );
}
