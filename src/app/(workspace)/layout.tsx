import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { NoCampaign, UnattachedAccount } from "@/components/account";
import { readSession } from "@/lib/session.server";
import { loadState } from "@/lib/data.server";
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
  // null in demonstration mode, where nothing below changes.
  const session = await readSession();
  if (session && !session.membership) return <UnattachedAccount session={session} />;
  // Narrowed rather than asserted, so the shell never has to re-check.
  const attached: AttachedSession | null =
    session && session.membership ? { ...session, membership: session.membership } : null;
  const state = attached ? await loadState(attached) : undefined;
  // Every screen is built around a selected campaign; the provider would have
  // none to select. Guard here so no screen has to handle the empty case.
  if (attached && state && !state.campaigns.length) return <NoCampaign session={attached} />;
  return (
    <AppProvider
      initialState={state}
      initialActor={attached ? actorFor(attached) : undefined}
      memberRole={attached ? memberRoleOf(attached) : undefined}
    >
      <Shell session={attached}>{children}</Shell>
    </AppProvider>
  );
}
