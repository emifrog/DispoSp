import "server-only";
import { isConnected } from "./supabase/config";
import { createReadClient } from "./supabase/server";
import type { Session } from "./session";

// Returns null in demonstration mode and for a visitor without a session. Every
// query below runs under RLS as the signed-in user: an empty result is the
// database's answer, not a missing filter.
export async function readSession(): Promise<Session | null> {
  if (!isConnected) return null;
  const supabase = await createReadClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profile, membership] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("organization_id, team_id, role, organizations(name), teams(name)")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle(),
  ]);

  const row = membership.data as {
    organization_id: string;
    team_id: string;
    role: string;
    organizations: { name: string } | null;
    teams: { name: string } | null;
  } | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName: profile.data?.display_name ?? user.email ?? "",
    membership: row
      ? {
          organizationId: row.organization_id,
          organizationName: row.organizations?.name ?? "Organisation",
          teamId: row.team_id,
          teamName: row.teams?.name ?? "Équipe",
          role: row.role,
        }
      : null,
  };
}
