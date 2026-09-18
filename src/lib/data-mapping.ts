import { formatInTimeZone } from "date-fns-tz";
import {
  availabilitySchema,
  dateLabel,
  entryKey,
  labels,
  plural,
  responseKey,
  shiftKey,
  type AppState,
  type Availability,
  type Shift,
} from "./domain";
import { roleLabels } from "./session";

const PARIS = "Europe/Paris";
/** A campaign window is a timestamp in the database and a calendar day on screen. */
export const dayIn = (timestamp: string) => formatInTimeZone(new Date(timestamp), PARIS, "yyyy-MM-dd");

// The rows exactly as PostgREST returns them for the queries in data.server.ts.
export type Raw = {
  organization: { name: string; day_start: number; night_start: number } | null;
  members: {
    user_id: string;
    role: string;
    profiles: { display_name: string } | null;
    teams: { name: string } | null;
  }[];
  memberQualifications: { user_id: string; qualifications: { name: string } | null }[];
  campaigns: {
    id: string;
    name: string;
    starts_on: string;
    opens_at: string;
    closes_at: string;
    locked: boolean;
    day_start: number;
    night_start: number;
  }[];
  participants: { campaign_id: string; user_id: string; validated_at: string | null }[];
  entries: { campaign_id: string; user_id: string; date: string; availability_type: string; comment: string | null }[];
  requirements: {
    campaign_id: string;
    date: string;
    shift_code: string;
    headcount: number;
    staffing_requirement_qualifications: { minimum: number; qualifications: { name: string } | null }[] | null;
  }[];
  schedules: { id: string; campaign_id: string }[];
  shifts: {
    id: string;
    schedule_id: string;
    date: string;
    shift_code: string;
    published_revision: number;
    published_at: string | null;
  }[];
  assignments: { schedule_shift_id: string; user_id: string; revision: number; status: string }[];
  audit: {
    id: number | string;
    occurred_at: string;
    action: string;
    entity: string;
    actor_id: string | null;
    old_value: unknown;
    new_value: unknown;
  }[];
};

// The trail is written by database triggers, in a deliberately stable English
// vocabulary: those codes are a contract with the migration's own tests. The
// French belongs here, beside the rest of the mapping, and not in the migration
// where wording would become something nobody dares change.
const auditLabels: Record<string, string> = {
  "availability_entry/SET": "Disponibilité renseignée",
  "availability_entry/CLEAR": "Disponibilité effacée",
  "campaign_participant/VALIDATE": "Réponse validée",
  "availability_campaign/CREATE": "Campagne ouverte",
  "availability_campaign/LOCK": "Campagne verrouillée",
  "availability_campaign/UNLOCK": "Campagne déverrouillée",
  "staffing_requirement/SET": "Besoins définis",
  "staffing_requirement/CLEAR": "Besoins supprimés",
  "schedule_assignment/ASSIGN": "Agent affecté au brouillon",
  "schedule_assignment/UNASSIGN": "Affectation retirée du brouillon",
  "schedule_shift/PUBLISH": "Créneau publié",
  "organization/HOURS": "Horaires par défaut modifiés",
  "qualification/CREATE": "Qualification créée",
  "qualification/RENAME": "Qualification renommée",
  "qualification/DELETE": "Qualification supprimée",
};

type Values = Record<string, unknown> | null;
const values = (raw: unknown): Values =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
const text = (from: Values, key: string) => (typeof from?.[key] === "string" ? (from[key] as string) : "");
const num = (from: Values, key: string) => (typeof from?.[key] === "number" ? (from[key] as number) : null);

// Old and new value are both recorded; a line only shows the difference when
// there is one to show, rather than repeating the row twice.
function auditDetail(entity: string, before: Values, after: Values, nameById: Map<string, string>): string {
  const subject = after ?? before;
  const who = (id: string) => nameById.get(id) ?? "un agent";
  const slot = (code: string) => (code === "NIGHT" ? "Nuit" : "Jour");
  const day = (from: Values) => (text(from, "date") ? dateLabel(text(from, "date")) : "");
  switch (entity) {
    case "availability_entry": {
      if (!after) return `${day(subject)} · non renseigné`;
      const type = text(after, "availability_type") as Availability;
      return `${day(after)} · ${labels[type]?.label ?? type}`;
    }
    case "campaign_participant":
    case "schedule_assignment":
      return who(text(subject, "user_id"));
    case "availability_campaign":
      return text(subject, "name");
    case "staffing_requirement": {
      const line = `${day(subject)} · ${slot(text(subject, "shift_code"))}`;
      const to = num(after, "headcount");
      if (to === null) return `${line} · besoins retirés`;
      const from = num(before, "headcount");
      return from !== null && from !== to
        ? `${line} · ${from} → ${to} ${plural(to, "agent")}`
        : `${line} · ${to} ${plural(to, "agent")}`;
    }
    case "schedule_shift": {
      const headcount = num(after, "headcount") ?? 0;
      return `version ${num(after, "revision") ?? "?"} · ${headcount} ${plural(headcount, "agent")}`;
    }
    case "organization": {
      const range = (from: Values) => `${num(from, "day_start")} h – ${num(from, "night_start")} h`;
      return before ? `${range(before)} → ${range(after)}` : range(after);
    }
    case "qualification":
      return text(subject, "name");
    default:
      return "";
  }
}

// Pure on purpose: this is where the mapping bugs would live, and it can be
// tested against rows shaped like the real ones without a database round trip.
export function buildState(raw: Raw, fallbackOrganizationName: string): AppState {
  const qualificationsByUser = new Map<string, string[]>();
  for (const row of raw.memberQualifications) {
    const name = row.qualifications?.name;
    if (!name) continue;
    qualificationsByUser.set(row.user_id, [...(qualificationsByUser.get(row.user_id) ?? []), name]);
  }

  const agents: AppState["agents"] = raw.members.map(row => ({
    id: row.user_id,
    name: row.profiles?.display_name ?? "Agent",
    team: row.teams?.name ?? "Équipe",
    // The schema carries no rank yet; the role is the closest honest stand-in.
    grade: roleLabels[row.role] ?? row.role,
    qualifications: qualificationsByUser.get(row.user_id) ?? [],
  }));
  const nameById = new Map(agents.map(a => [a.id, a.name]));

  const state: AppState = {
    version: 1,
    organization: {
      name: raw.organization?.name ?? fallbackOrganizationName,
      dayStart: raw.organization?.day_start ?? 8,
      nightStart: raw.organization?.night_start ?? 20,
    },
    agents,
    campaigns: raw.campaigns.map(c => ({
      id: c.id,
      name: c.name,
      // Campaigns cover a whole month in this version; the month is its first day.
      month: c.starts_on.slice(0, 7),
      opensOn: dayIn(c.opens_at),
      closesOn: dayIn(c.closes_at),
      closed: Boolean(c.locked),
      dayStart: c.day_start,
      nightStart: c.night_start,
    })),
    entries: {},
    responses: {},
    requirements: {},
    assignments: {},
    publications: {},
    audit: [],
  };

  for (const row of raw.entries) {
    const type = availabilitySchema.safeParse(row.availability_type);
    if (!type.success) continue;
    state.entries[entryKey(row.campaign_id, row.user_id, row.date)] = {
      type: type.data,
      comment: row.comment ?? "",
    };
  }
  for (const row of raw.participants)
    if (row.validated_at) state.responses[responseKey(row.campaign_id, row.user_id)] = row.validated_at;

  for (const row of raw.requirements) {
    const minima: Record<string, number> = {};
    for (const q of row.staffing_requirement_qualifications ?? [])
      if (q.qualifications?.name) minima[q.qualifications.name] = q.minimum;
    state.requirements[shiftKey(row.campaign_id, row.date, row.shift_code as Shift)] = {
      total: row.headcount,
      qualifications: minima,
    };
  }

  // A shift only knows its schedule, and a schedule its campaign: walk back so
  // draft and published assignments land on the keys the screens expect.
  const campaignBySchedule = new Map(raw.schedules.map(s => [s.id, s.campaign_id]));
  const shiftById = new Map<string, { key: string; publishedRevision: number; publishedAt: string | null }>();
  for (const row of raw.shifts) {
    const campaignId = campaignBySchedule.get(row.schedule_id);
    if (!campaignId) continue;
    shiftById.set(row.id, {
      key: shiftKey(campaignId, row.date, row.shift_code as Shift),
      publishedRevision: row.published_revision,
      publishedAt: row.published_at,
    });
  }
  for (const row of raw.assignments) {
    const shift = shiftById.get(row.schedule_shift_id);
    if (!shift || row.status === "CANCELLED") continue;
    if (row.revision === 0) state.assignments[shift.key] = [...(state.assignments[shift.key] ?? []), row.user_id];
    else if (row.revision === shift.publishedRevision && shift.publishedAt) {
      const current = state.publications[shift.key] ?? {
        agents: [],
        publishedAt: shift.publishedAt,
        revision: shift.publishedRevision,
      };
      state.publications[shift.key] = { ...current, agents: [...current.agents, row.user_id] };
    }
  }

  state.audit = raw.audit.map(row => {
    const before = values(row.old_value);
    const after = values(row.new_value);
    return {
      id: String(row.id),
      at: row.occurred_at,
      actor: (row.actor_id && nameById.get(row.actor_id)) || "—",
      action: auditLabels[`${row.entity}/${row.action}`] ?? `${row.entity} · ${row.action}`,
      detail: auditDetail(row.entity, before, after, nameById) || row.entity,
    };
  });

  return state;
}
