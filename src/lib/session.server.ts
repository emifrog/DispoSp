import "server-only";
import { connection } from "next/server";
import { createReadClient } from "./supabase/server";
import type { Session } from "./session";

// Returns null for a visitor without a session. Every
// query below runs under RLS as the signed-in user: an empty result is the
// database's answer, not a missing filter.
export async function readSession(): Promise<Session | null> {
  /*
   * Aucun écran de l'espace de travail ne peut être prérendu : ils dépendent
   * tous de qui est connecté. Next l'apprenait jusqu'ici par `cookies()`, que
   * le client Supabase finit par appeler — mais il n'y arrive jamais sans
   * coordonnées, `credentials()` levant avant. Le prérendu croyait donc avoir
   * affaire à des pages statiques, et le build échouait sur la première :
   * « Error occurred prerendering page "/accueil" ». C'est exactement la
   * situation de l'intégration continue, qui ne fournit délibérément aucun
   * projet Supabase.
   *
   * `connection()` le dit avant toute lecture, et sans rien supposer de la
   * configuration. `export const dynamic` ferait la même chose, mais la v16
   * l'a retiré de la configuration de segment — voir
   * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md`.
   */
  await connection();
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
