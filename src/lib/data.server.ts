import "server-only";
import type { AppState } from "./domain";
import { buildState, taken, type Raw } from "./data-mapping";
import type { AttachedSession } from "./session";
import { createReadClient } from "./supabase/server";

// Le garde vit dans data-mapping, pur et testable : ce module-ci est
// « server-only » et ne s'importe pas depuis un test.
/** Les clés de `Raw` qui portent une liste — toutes sauf l'organisation. */
type ListKey = { [K in keyof Raw]: Raw[K] extends unknown[] ? K : never }[keyof Raw];
const rows = <K extends ListKey>(what: string, result: { data: unknown; error: { message: string } | null }) =>
  taken<Raw[K]>(what, result, [] as unknown as Raw[K]);

// Everything below runs under RLS as the signed-in user: an agent legitimately
// sees only their own membership and entries, a manager sees their team's.
export async function loadState(session: AttachedSession): Promise<AppState> {
  const supabase = await createReadClient();
  const organizationId = session.membership.organizationId;

  const [
    organization,
    members,
    memberQualifications,
    campaigns,
    teams,
    notifications,
    catalogue,
    template,
    invitations,
  ] = await Promise.all([
    supabase.from("organizations").select("name, day_start, night_start").eq("id", organizationId).maybeSingle(),
    // Deactivated members are loaded too: the administration screen has to show
    // them to bring anyone back. buildState keeps the two rosters apart.
    supabase
      .from("memberships")
      .select("user_id, role, team_id, active, profiles(display_name, grade, fonction, matricule, phone), teams(name)")
      .eq("organization_id", organizationId),
    supabase.from("user_qualifications").select("user_id, qualifications(name)").eq("organization_id", organizationId),
    supabase
      .from("availability_campaigns")
      .select("id, name, team_id, starts_on, opens_at, closes_at, locked, day_start, night_start")
      .eq("organization_id", organizationId)
      .order("starts_on", { ascending: true }),
    supabase.from("teams").select("id, name").eq("organization_id", organizationId).order("name"),
    supabase
      .from("notifications")
      .select("id, kind, subject, body, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("qualifications").select("name").eq("organization_id", organizationId),
    // RLS limite déjà au propriétaire : le modèle de quelqu un ne regarde que lui.
    supabase.from("availability_templates").select("weekday, availability_type"),
    // Readable by administrators only; anyone else gets an empty list from RLS
    // rather than a refusal, which is exactly what the screen should show.
    supabase
      .from("invitations")
      .select("id, email, display_name, role, team_id, created_at")
      .eq("organization_id", organizationId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const campaignIds = ((campaigns.data ?? []) as { id: string }[]).map(c => c.id);
  const [participants, entries, requirements, schedules, shifts, assignments, withdrawals, audit] = await Promise.all([
    supabase.from("campaign_participants").select("campaign_id, user_id, validated_at").in("campaign_id", campaignIds),
    supabase
      .from("availability_entries")
      .select("campaign_id, user_id, date, availability_type, comment")
      .in("campaign_id", campaignIds),
    supabase
      .from("staffing_requirements")
      .select(
        "campaign_id, date, shift_code, headcount, staffing_requirement_qualifications(minimum, qualifications(name))",
      )
      .in("campaign_id", campaignIds),
    supabase.from("schedules").select("id, campaign_id").in("campaign_id", campaignIds),
    supabase.from("schedule_shifts").select("id, schedule_id, date, shift_code, published_revision, published_at"),
    supabase.from("schedule_assignments").select("schedule_shift_id, user_id, revision, status"),
    // RLS décide qui voit quoi : un agent n'obtient que les siens, qui encadre
    // obtient ceux du centre. L'écran n'a rien à filtrer.
    supabase
      .from("shift_withdrawals")
      .select("id, schedule_shift_id, user_id, reason, state, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("audit_logs")
      .select("id, occurred_at, action, entity, actor_id, old_value, new_value")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(200),
  ]);

  const raw: Raw = {
    // La seule lecture qui rend un objet et non une liste ; elle passe par le
    // même contrôle, et `null` reste une réponse valable.
    organization: taken<Raw["organization"]>("organisation", organization, null),
    members: rows<"members">("membres", members),
    memberQualifications: rows<"memberQualifications">("qualifications des agents", memberQualifications),
    campaigns: rows<"campaigns">("campagnes", campaigns),
    teams: rows<"teams">("équipes", teams),
    notifications: rows<"notifications">("notifications", notifications),
    qualificationCatalogue: rows<"qualificationCatalogue">("catalogue de qualifications", catalogue),
    template: rows<"template">("disponibilité habituelle", template),
    invitations: rows<"invitations">("invitations", invitations),
    participants: rows<"participants">("participants aux campagnes", participants),
    entries: rows<"entries">("disponibilités", entries),
    requirements: rows<"requirements">("besoins", requirements),
    schedules: rows<"schedules">("plannings", schedules),
    shifts: rows<"shifts">("créneaux", shifts),
    assignments: rows<"assignments">("affectations", assignments),
    withdrawals: rows<"withdrawals">("désistements", withdrawals),
    audit: rows<"audit">("journal d’audit", audit),
  };
  return buildState(raw, session.membership.organizationName);
}
