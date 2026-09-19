import "server-only";
import type { AppState } from "./domain";
import { buildState, type Raw } from "./data-mapping";
import type { AttachedSession } from "./session";
import { createReadClient } from "./supabase/server";

const rows = <K extends keyof Raw>(result: { data: unknown }) => (result.data ?? []) as Raw[K];

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
      .select("id, name, starts_on, opens_at, closes_at, locked, day_start, night_start")
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
  const [participants, entries, requirements, schedules, shifts, assignments, audit] = await Promise.all([
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
    supabase
      .from("audit_logs")
      .select("id, occurred_at, action, entity, actor_id, old_value, new_value")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(200),
  ]);

  const raw: Raw = {
    organization: (organization.data ?? null) as Raw["organization"],
    members: rows<"members">(members),
    memberQualifications: rows<"memberQualifications">(memberQualifications),
    campaigns: rows<"campaigns">(campaigns),
    teams: rows<"teams">(teams),
    notifications: rows<"notifications">(notifications),
    qualificationCatalogue: rows<"qualificationCatalogue">(catalogue),
    template: rows<"template">(template),
    invitations: rows<"invitations">(invitations),
    participants: rows<"participants">(participants),
    entries: rows<"entries">(entries),
    requirements: rows<"requirements">(requirements),
    schedules: rows<"schedules">(schedules),
    shifts: rows<"shifts">(shifts),
    assignments: rows<"assignments">(assignments),
    audit: rows<"audit">(audit),
  };
  return buildState(raw, session.membership.organizationName);
}
