import "server-only";
import { loadedSince, type AppState } from "./domain";
import { buildState, campaignsToLoad, paged as pagedRows, taken, type Raw } from "./data-mapping";
import type { AttachedSession } from "./session";
import { createReadClient } from "./supabase/server";

/** Les clés de `Raw` qui portent une liste — toutes sauf l'organisation. */
type ListKey = { [K in keyof Raw]: Raw[K] extends unknown[] ? K : never }[keyof Raw];
type Result = { data: unknown; error: { message: string } | null };
type Counted = Result & { count: number | null };

// Le garde vit dans data-mapping, pur et testable : ce module-ci est
// « server-only » et ne s'importe pas depuis un test.
const rows = <K extends ListKey>(what: string, result: Result) => taken<Raw[K]>(what, result, [] as unknown as Raw[K]);

/**
 * PostgREST plafonne une réponse, et Supabase règle ce plafond à mille lignes
 * par défaut. Un centre de trente-trois agents dépasse déjà ce plafond sur un
 * seul mois de disponibilités — trente-trois fois trente et un jours font
 * 1 023 lignes — et les campagnes passées s'y ajoutent.
 *
 * Une requête plafonnée ne signale rien : elle rend ses mille premières lignes
 * comme si c'était tout. Les écrans affichaient donc une matrice incomplète
 * présentée comme complète, et les exports reprenaient le même état.
 */
const PAGE = 500;

/**
 * Le pager vit dans data-mapping, pur et testable. Ici on ne fait que lui
 * donner le typage de `Raw`.
 *
 * Le compte exact qu'il réclame coûte un dénombrement par table. C'est le prix
 * d'une lecture dont on sait qu'elle est complète, et il se paie sur des tables
 * qui tiennent en quelques milliers de lignes pour un centre.
 */
const paged = <K extends ListKey>(what: string, page: (from: number, to: number) => PromiseLike<Counted>) =>
  pagedRows<Raw[K][number]>(what, PAGE, page) as Promise<Raw[K]>;

// Everything below runs under RLS as the signed-in user: an agent legitimately
// sees only their own membership and entries, a manager sees their team's.
//
// Le détail — disponibilités, besoins, planning — ne se lit que pour les
// campagnes des LOADED_MONTHS derniers mois, plus `asked` si l'adresse en
// demande une plus ancienne. Voir `campaignsToLoad`.
export async function loadState(session: AttachedSession, asked?: string | null): Promise<AppState> {
  const supabase = await createReadClient();
  const organizationId = session.membership.organizationId;
  const exact = { count: "exact" as const };

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
    paged<"members">("membres", (from, to) =>
      supabase
        .from("memberships")
        .select(
          "user_id, role, team_id, active, profiles(display_name, grade, fonction, matricule, phone), teams(name)",
          exact,
        )
        .eq("organization_id", organizationId)
        .order("user_id")
        .range(from, to),
    ),
    paged<"memberQualifications">("qualifications des agents", (from, to) =>
      supabase
        .from("user_qualifications")
        .select("user_id, qualifications(name)", exact)
        .eq("organization_id", organizationId)
        .order("user_id")
        .order("qualification_id")
        .range(from, to),
    ),
    paged<"campaigns">("campagnes", (from, to) =>
      supabase
        .from("availability_campaigns")
        .select("id, name, team_id, starts_on, opens_at, closes_at, locked, day_start, night_start", exact)
        .eq("organization_id", organizationId)
        // `starts_on` seul n'est pas unique : deux campagnes du même mois se
        // chevaucheraient entre deux pages, ou disparaîtraient.
        .order("starts_on", { ascending: true })
        .order("id")
        .range(from, to),
    ),
    paged<"teams">("équipes", (from, to) =>
      supabase
        .from("teams")
        .select("id, name", exact)
        .eq("organization_id", organizationId)
        .order("name")
        .order("id")
        .range(from, to),
    ),
    // Volontairement plafonnées : l'écran n'en montre qu'un extrait récent, et
    // le dit. Ce n'est pas une troncature subie.
    supabase
      .from("notifications")
      .select("id, kind, subject, body, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(50),
    paged<"qualificationCatalogue">("catalogue de qualifications", (from, to) =>
      supabase
        .from("qualifications")
        .select("name", exact)
        .eq("organization_id", organizationId)
        .order("name")
        .range(from, to),
    ),
    // RLS limite déjà au propriétaire : le modèle de quelqu un ne regarde que lui.
    supabase.from("availability_templates").select("weekday, availability_type").order("weekday"),
    // Readable by administrators only; anyone else gets an empty list from RLS
    // rather than a refusal, which is exactly what the screen should show.
    paged<"invitations">("invitations", (from, to) =>
      supabase
        .from("invitations")
        .select("id, email, display_name, role, team_id, created_at", exact)
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  const since = loadedSince();
  const campaignIds = campaignsToLoad(campaigns, since, asked);
  const [participants, entries, requirements, schedules, audit] = await Promise.all([
    // Tous les participants, archives comprises : une ligne par agent et par
    // mois, que l'écran des campagnes compte et que le sélecteur d'un agent
    // filtre. C'est le détail jour par jour qui pèse, pas eux.
    paged<"participants">("participants aux campagnes", (from, to) =>
      supabase
        .from("campaign_participants")
        .select("campaign_id, user_id, validated_at", exact)
        .eq("organization_id", organizationId)
        .order("campaign_id")
        .order("user_id")
        .range(from, to),
    ),
    // La plus volumineuse de toutes : agents × jours × campagnes.
    paged<"entries">("disponibilités", (from, to) =>
      supabase
        .from("availability_entries")
        .select("campaign_id, user_id, date, availability_type, comment", exact)
        .in("campaign_id", campaignIds)
        .order("campaign_id")
        .order("user_id")
        .order("date")
        .range(from, to),
    ),
    paged<"requirements">("besoins", (from, to) =>
      supabase
        .from("staffing_requirements")
        .select(
          "campaign_id, date, shift_code, headcount, staffing_requirement_qualifications(minimum, qualifications(name))",
          exact,
        )
        .in("campaign_id", campaignIds)
        .order("campaign_id")
        .order("date")
        .order("shift_code")
        .range(from, to),
    ),
    paged<"schedules">("plannings", (from, to) =>
      supabase
        .from("schedules")
        .select("id, campaign_id", exact)
        .in("campaign_id", campaignIds)
        .order("id")
        .range(from, to),
    ),
    // Plafonné aussi, et l'écran d'historique le signale quand la période
    // demandée précède les deux cents actions chargées.
    supabase
      .from("audit_logs")
      .select("id, occurred_at, action, entity, actor_id, old_value, new_value")
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false })
      .limit(200),
  ]);

  // Un créneau ne connaît que son planning, et une affectation ou un
  // désistement que son créneau : il faut les plannings pour les borner. Les
  // identifiants de créneaux, eux, se comptent par centaines — trop pour une
  // adresse — d'où le filtre sur le créneau joint (`!inner`), qui ne garde que
  // les lignes dont le créneau appartient à l'un de ces plannings.
  const scheduleIds = (schedules as { id: string }[]).map(s => s.id);
  const [shifts, assignments, withdrawals] = await Promise.all([
    paged<"shifts">("créneaux", (from, to) =>
      supabase
        .from("schedule_shifts")
        .select("id, schedule_id, date, shift_code, published_revision, published_at", exact)
        .eq("organization_id", organizationId)
        .in("schedule_id", scheduleIds)
        .order("id")
        .range(from, to),
    ),
    paged<"assignments">("affectations", (from, to) =>
      supabase
        .from("schedule_assignments")
        .select("schedule_shift_id, user_id, revision, status, assigned_at, schedule_shifts!inner(schedule_id)", exact)
        .eq("organization_id", organizationId)
        .in("schedule_shifts.schedule_id", scheduleIds)
        .order("schedule_shift_id")
        .order("user_id")
        .order("revision")
        .range(from, to),
    ),
    // RLS décide qui voit quoi : un agent n'obtient que les siens, qui encadre
    // obtient ceux du centre. L'écran n'a rien à filtrer.
    paged<"withdrawals">("désistements", (from, to) =>
      supabase
        .from("shift_withdrawals")
        .select(
          "id, schedule_shift_id, user_id, reason, state, created_at, decided_at, schedule_shifts!inner(schedule_id)",
          exact,
        )
        .eq("organization_id", organizationId)
        .in("schedule_shifts.schedule_id", scheduleIds)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  const raw: Raw = {
    // La seule lecture qui rend un objet et non une liste ; elle passe par le
    // même contrôle, et `null` reste une réponse valable.
    organization: taken<Raw["organization"]>("organisation", organization, null),
    members,
    memberQualifications,
    campaigns,
    teams,
    notifications: rows<"notifications">("notifications", notifications),
    qualificationCatalogue: catalogue,
    template: rows<"template">("disponibilité habituelle", template),
    invitations,
    participants,
    entries,
    requirements,
    schedules,
    shifts,
    assignments,
    withdrawals,
    audit: rows<"audit">("journal d’audit", audit),
  };
  return buildState(raw, session.membership.organizationName, { since, loaded: campaignIds });
}
