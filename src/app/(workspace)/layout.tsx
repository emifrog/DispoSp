import { AppProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
import { UnattachedAccount } from "@/components/account";
import { readSession } from "@/lib/session.server";
import type { AttachedSession } from "@/lib/session";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // null in demonstration mode, where nothing below changes.
  const session = await readSession();
  if (session && !session.membership) return <UnattachedAccount session={session} />;
  // Narrowed rather than asserted, so the shell never has to re-check.
  const attached: AttachedSession | null =
    session && session.membership ? { ...session, membership: session.membership } : null;
  return (
    <AppProvider>
      <Shell session={attached}>{children}</Shell>
    </AppProvider>
  );
}
