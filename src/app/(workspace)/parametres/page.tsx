import type { Metadata } from "next";
import { Settings, type ScheduledStatus } from "@/components/management";
import { refuseAgents } from "@/components/manager-page";
import { readSession } from "@/lib/session.server";
import { createReadClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Paramètres du centre" };

export default async function Page() {
  await refuseAgents();
  // L'état des traitements se lit ici, pour cet écran seul : il n'a rien à
  // faire dans l'état chargé par toutes les pages. Une base sans la migration
  // du lot A refuse l'appel : l'écran le dit au lieu d'échouer.
  const session = await readSession();
  let scheduled: ScheduledStatus | null = null;
  if (session?.membership) {
    const supabase = await createReadClient();
    const { data, error } = await supabase.rpc("scheduled_status", { org: session.membership.organizationId });
    if (!error && data) scheduled = data as ScheduledStatus;
  }
  return <Settings scheduled={scheduled} />;
}
