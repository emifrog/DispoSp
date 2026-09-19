import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { NoCampaign, UnattachedAccount } from "@/components/account";
import { readSession } from "@/lib/session.server";
import { loadState } from "@/lib/data.server";
import { SIGN_IN_PATH } from "@/lib/supabase/config";
import { redirect } from "next/navigation";
import type { AttachedSession } from "@/lib/session";
import { memberRoles, type Actor, type MemberRole } from "@/lib/domain";

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
  const state = await loadState(attached);
  // Every screen is built around a selected campaign; the provider would have
  // none to select. Guard here so no screen has to handle the empty case.
  if (!state.campaigns.length) return <NoCampaign session={attached} />;
  return (
    <AppProvider state={state} actor={actorFor(attached)} memberRole={memberRoleOf(attached)}>
      <Shell session={attached}>{children}</Shell>
    </AppProvider>
  );
}
