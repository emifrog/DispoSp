import { formatInTimeZone } from "date-fns-tz";
import {
  availabilitySchema,
  dateLabel,
  entryKey,
  labels,
  memberRoles,
  plural,
  responseKey,
  shiftKey,
  type AppState,
  type Availability,
  type MemberRole,
  type Shift,
} from "./domain";
import { roleLabels } from "./session";

/**
 * Une lecture qui échoue doit s'entendre.
 *
 * `data ?? []` seul confondait deux choses opposées : « la base n'a rien à me
 * montrer » et « la lecture a échoué ». Une panne sur les disponibilités
 * rendait un état à zéro disponibilité, indiscernable d'un mois où personne
 * n'a répondu — et les exports consommaient le même état.
 *
 * Le détail part au journal du serveur et non à l'écran : un message de
 * PostgREST décrit le schéma. L'appelant reçoit une phrase stable, que la
 * frontière d'erreur transforme en « cet écran n'a pas pu s'afficher ».
 *
 * Une absence légitime reste une absence : les policies RLS renvoient un
 * ensemble vide sans erreur, ce qui passe ici sans bruit.
 *
 * Le repli est explicite parce qu'il diffère selon la lecture : une liste
 * absente est une liste vide, un objet absent est `null`. Le déduire aurait
 * rendu un tableau vide là où l'appelant attend un objet.
 */
export const READ_FAILED = "Les données du centre n’ont pas pu être lues en entier.";
export function taken<T>(what: string, result: { data: unknown; error: { message: string } | null }, fallback: T): T {
  if (result.error) {
    console.error(`Lecture impossible : ${what}`, result.error.message);
    throw new Error(READ_FAILED);
  }
  return (result.data ?? fallback) as T;
}

type Page = (
  from: number,
  to: number,
) => PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>;

/**
 * Le nombre de pages en vol à la fois.
 *
 * Six, et pas davantage : au-delà on n'accélère plus grand-chose — la base
 * répond à la même vitesse — et on occupe des connexions du pool que les autres
 * requêtes de la page attendent. Les tables sont déjà lues en parallèle entre
 * elles ; cette limite vaut pour chacune.
 */
const IN_FLIGHT = 6;

/**
 * Lire une table en entier, page par page.
 *
 * C'est le **compte exact** qui dit qu'on a fini, et non la taille de la page.
 * S'arrêter sur « page plus courte que demandé » paraît suffisant et ne l'est
 * pas : rien ne garantit que le serveur serve autant de lignes qu'on en
 * demande — PostgREST a son propre plafond — et une page écourtée par ce
 * plafond passerait pour la dernière. On retomberait exactement dans la
 * troncature silencieuse qu'on cherche à supprimer.
 *
 * Le compte sert une seconde fois : il dit d'avance combien de pages il reste,
 * donc où elles commencent. Elles partent alors ensemble, par paquets, au lieu
 * de s'attendre l'une l'autre. Sur un centre de cinquante agents, les
 * disponibilités de l'année tiennent en une quarantaine de pages : c'était
 * quarante allers-retours en file indienne à chaque navigation.
 *
 * Deux cas gardent la lecture séquentielle, parce qu'on ne peut pas y prévoir
 * les plages : l'absence de compte, et la première page écourtée — signe que le
 * serveur plafonne plus bas que ce qu'on demande.
 */
export async function paged<T>(what: string, size: number, page: Page): Promise<T[]> {
  const first = await page(0, size - 1);
  const head = taken<T[]>(what, first, []);
  const total = first.count;
  if (total !== null && head.length >= total) return head;
  // Ni fini ni avancé : mieux vaut une erreur qu'une boucle sans fin ou une
  // liste tronquée qu'on présenterait comme entière.
  if (!head.length) {
    console.error(`Lecture interrompue : ${what}, 0 ligne sur ${total ?? "?"}`);
    throw new Error(READ_FAILED);
  }
  if (total === null || head.length < size) return [...head, ...(await sequential<T>(what, size, page, head.length))];

  const starts: number[] = [];
  for (let from = size; from < total; from += size) starts.push(from);
  const pages: T[][] = new Array(starts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(IN_FLIGHT, starts.length) }, async () => {
      for (let index = next++; index < starts.length; index = next++)
        pages[index] = taken<T[]>(what, await page(starts[index], starts[index] + size - 1), []);
    }),
  );

  const collected = [head, ...pages].flat();
  if (collected.length >= total) return collected;
  /*
   * Moins de lignes que le compte annoncé : une page a été servie écourtée, ou
   * des lignes ont disparu pendant la lecture. Les plages ayant été calculées
   * d'avance, ce qui manque laisse un **trou au milieu** — et un trou muet est
   * exactement ce que ce module existe pour empêcher. On relit tout à la file,
   * où chaque page repart de ce qui a réellement été reçu.
   */
  console.error(`Lecture relancée à la file : ${what}, ${collected.length} ligne(s) sur ${total}`);
  return sequential<T>(what, size, page, 0);
}

async function sequential<T>(what: string, size: number, page: Page, from: number): Promise<T[]> {
  const collected: T[] = [];
  for (;;) {
    const result = await page(from + collected.length, from + collected.length + size - 1);
    const batch = taken<T[]>(what, result, []);
    collected.push(...batch);

    const total = result.count;
    if (total !== null ? from + collected.length >= total : batch.length < size) return collected;
    if (!batch.length) {
      console.error(`Lecture interrompue : ${what}, ${from + collected.length} ligne(s) sur ${total ?? "?"}`);
      throw new Error(READ_FAILED);
    }
  }
}

const PARIS = "Europe/Paris";
/** A campaign window is a timestamp in the database and a calendar day on screen. */
export const dayIn = (timestamp: string) => formatInTimeZone(new Date(timestamp), PARIS, "yyyy-MM-dd");

// The rows exactly as PostgREST returns them for the queries in data.server.ts.
export type Raw = {
  organization: { name: string; day_start: number; night_start: number } | null;
  members: {
    user_id: string;
    role: string;
    team_id: string;
    active: boolean;
    profiles: {
      display_name: string;
      grade?: string | null;
      fonction?: string | null;
      matricule?: string | null;
      phone?: string | null;
    } | null;
    teams: { name: string } | null;
  }[];
  teams: { id: string; name: string }[];
  qualificationCatalogue: { name: string }[];
  template: { weekday: number; availability_type: string }[];
  invitations: {
    id: string;
    email: string;
    display_name: string;
    role: string;
    team_id: string;
    created_at: string;
  }[];
  memberQualifications: { user_id: string; qualifications: { name: string } | null }[];
  notifications: {
    id: string;
    kind: string;
    subject: string;
    body: string | null;
    created_at: string;
    read_at: string | null;
  }[];
  campaigns: {
    id: string;
    name: string;
    team_id: string;
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
  withdrawals: {
    id: string;
    schedule_shift_id: string;
    user_id: string;
    reason: string | null;
    state: string;
    created_at: string;
    decided_at: string | null;
  }[];
  shifts: {
    id: string;
    schedule_id: string;
    date: string;
    shift_code: string;
    published_revision: number;
    published_at: string | null;
  }[];
  assignments: {
    schedule_shift_id: string;
    user_id: string;
    revision: number;
    status: string;
    assigned_at: string;
  }[];
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
  "campaign_participant/UNVALIDATE": "Validation retirée",
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
  "profile/UPDATE": "Fiche agent modifiée",
  "membership/JOIN": "Agent rattaché au centre",
  "membership/ROLE": "Rôle modifié",
  "membership/ACTIVATE": "Agent réactivé",
  "membership/DEACTIVATE": "Agent désactivé",
  "membership/TEAM": "Changement d’équipe",
  "team/CREATE": "Équipe créée",
  "team/RENAME": "Équipe renommée",
  "invitation/CREATE": "Invitation créée",
  "invitation/ACCEPT": "Invitation acceptée",
  "invitation/CANCEL": "Invitation annulée",
  "invitation/UPDATE": "Invitation modifiée",
  "user_qualification/GRANT": "Qualification attribuée",
  "user_qualification/REVOKE": "Qualification retirée",
};

type Values = Record<string, unknown> | null;
const values = (raw: unknown): Values =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
const text = (from: Values, key: string) => (typeof from?.[key] === "string" ? (from[key] as string) : "");
const num = (from: Values, key: string) => (typeof from?.[key] === "number" ? (from[key] as number) : null);

// Old and new value are both recorded; a line only shows the difference when
// there is one to show, rather than repeating the row twice.
function auditDetail(entity: string, previous: Values, after: Values, nameById: Map<string, string>): string {
  const subject = after ?? previous;
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
      const from = num(previous, "headcount");
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
      return previous ? `${range(previous)} → ${range(after)}` : range(after);
    }
    case "qualification":
      return text(subject, "name");
    case "profile": {
      const before = text(previous, "grade");
      const now = text(after, "grade");
      const name = text(subject, "display_name");
      return before !== now && (before || now) ? `${name} · ${before || "sans grade"} → ${now || "sans grade"}` : name;
    }
    case "membership": {
      const name = who(text(subject, "user_id"));
      const before = text(previous, "role");
      const now = text(after, "role");
      return before && now && before !== now
        ? `${name} · ${roleLabels[before] ?? before} → ${roleLabels[now] ?? now}`
        : `${name} · ${roleLabels[now] ?? now}`;
    }
    case "team": {
      const before = text(previous, "name");
      const now = text(after, "name");
      return before && before !== now ? `${before} → ${now}` : now;
    }
    case "invitation":
      return `${text(subject, "display_name")} · ${text(subject, "email")}`;
    case "user_qualification":
      return who(text(subject, "user_id"));
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

  const toAgent = (row: Raw["members"][number]): AppState["agents"][number] => ({
    id: row.user_id,
    name: row.profiles?.display_name ?? "Agent",
    team: row.teams?.name ?? "Équipe",
    // Stored as it is, empty included. Falling back to the role label here would
    // put that label in the edit form, and the first save would write it to the
    // database as if someone had chosen it. The display does the falling back.
    grade: row.profiles?.grade ?? "",
    fonction: row.profiles?.fonction ?? "",
    matricule: row.profiles?.matricule ?? "",
    phone: row.profiles?.phone ?? "",
    qualifications: qualificationsByUser.get(row.user_id) ?? [],
    role: memberRoles.includes(row.role as MemberRole) ? (row.role as MemberRole) : "AGENT",
    teamId: row.team_id,
  });
  // Every screen but the administration one reads `agents`: a deactivated agent
  // must not reappear in a synthesis, a pool or a response rate.
  const agents = raw.members.filter(row => row.active).map(toAgent);
  const inactiveAgents = raw.members.filter(row => !row.active).map(toAgent);
  // Both rosters, so an audit line still names someone who has since left.
  const nameById = new Map([...agents, ...inactiveAgents].map(a => [a.id, a.name]));
  const teamNameById = new Map(raw.teams.map(t => [t.id, t.name]));

  const state: AppState = {
    version: 1,
    organization: {
      name: raw.organization?.name ?? fallbackOrganizationName,
      dayStart: raw.organization?.day_start ?? 8,
      nightStart: raw.organization?.night_start ?? 20,
    },
    agents,
    inactiveAgents,
    teams: raw.teams.map(t => ({ id: t.id, name: t.name })),
    // Celles de la personne connectée seulement : la policy filtre, pas nous.
    notifications: raw.notifications.map(row => ({
      id: row.id,
      kind: row.kind,
      subject: row.subject,
      body: row.body ?? "",
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
    qualificationCatalogue: raw.qualificationCatalogue.map(q => q.name).sort((a, b) => a.localeCompare(b, "fr")),
    template: Object.fromEntries(
      raw.template.flatMap(row =>
        availabilitySchema.safeParse(row.availability_type).success
          ? [[String(row.weekday), row.availability_type as AppState["template"][string]]]
          : [],
      ),
    ),
    // Empty for anyone but an administrator: the policy filters, we do not.
    invitations: raw.invitations.map(row => ({
      id: row.id,
      email: row.email,
      name: row.display_name,
      role: memberRoles.includes(row.role as MemberRole) ? (row.role as MemberRole) : "AGENT",
      teamId: row.team_id,
      team: teamNameById.get(row.team_id) ?? "Équipe",
      createdAt: row.created_at,
    })),
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
      teamId: c.team_id,
      // Rempli plus bas, une fois les participants regroupés.
      participants: [] as string[],
    })),
    entries: {},
    responses: {},
    requirements: {},
    assignments: {},
    publications: {},
    withdrawals: [],
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
  // Deux informations distinctes dans la même table, et on n'en gardait qu'une.
  // `responses` dit qui a validé ; `participants` dit qui était concerné. Sans
  // la seconde, le périmètre de la campagne disparaissait et les taux se
  // calculaient sur l'effectif entier du centre.
  const invitedBy = new Map<string, string[]>();
  for (const row of raw.participants) {
    invitedBy.set(row.campaign_id, [...(invitedBy.get(row.campaign_id) ?? []), row.user_id]);
    if (row.validated_at) state.responses[responseKey(row.campaign_id, row.user_id)] = row.validated_at;
  }
  for (const campaign of state.campaigns) campaign.participants = invitedBy.get(campaign.id) ?? [];

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
  const shiftById = new Map<
    string,
    {
      key: string;
      campaignId: string;
      date: string;
      shift: Shift;
      publishedRevision: number;
      publishedAt: string | null;
    }
  >();
  for (const row of raw.shifts) {
    const campaignId = campaignBySchedule.get(row.schedule_id);
    if (!campaignId) continue;
    shiftById.set(row.id, {
      key: shiftKey(campaignId, row.date, row.shift_code as Shift),
      campaignId,
      date: row.date,
      shift: row.shift_code as Shift,
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

  // Un désistement ne vaut que pour une garde connue : une ligne dont le
  // créneau n'a pas été chargé n'a rien à dire à l'écran.
  // Quand une affectation du brouillon a-t-elle été posée ? Il faut le savoir
  // pour dire si un désistement accepté la concerne encore.
  const draftedAt = new Map<string, string>();
  for (const row of raw.assignments)
    if (row.revision === 0) draftedAt.set(`${row.schedule_shift_id}/${row.user_id}`, row.assigned_at);

  state.withdrawals = raw.withdrawals.flatMap(row => {
    const shift = shiftById.get(row.schedule_shift_id);
    if (!shift) return [];
    // La même règle que la base applique à la publication : un désistement
    // accepté écarte l'agent, à moins qu'on ne l'ait réaffecté depuis. Sans
    // cette comparaison, l'écran signalerait un blocage là où la base
    // publierait — ou l'inverse, ce qui serait pire.
    const assigned = draftedAt.get(`${row.schedule_shift_id}/${row.user_id}`);
    const blocking =
      row.state === "ACCEPTED" && Boolean(row.decided_at) && Boolean(assigned) && row.decided_at! > assigned!;
    return [
      {
        blocking,
        id: row.id,
        shiftId: row.schedule_shift_id,
        campaignId: shift.campaignId,
        date: shift.date,
        shift: shift.shift,
        userId: row.user_id,
        reason: row.reason ?? "",
        state: row.state as AppState["withdrawals"][number]["state"],
        createdAt: row.created_at,
      },
    ];
  });

  state.audit = raw.audit.map(row => {
    const before = values(row.old_value);
    const after = values(row.new_value);
    return {
      id: String(row.id),
      at: row.occurred_at,
      actor: (row.actor_id && nameById.get(row.actor_id)) || "—",
      action: auditLabels[`${row.entity}/${row.action}`] ?? `${row.entity} · ${row.action}`,
      detail: auditDetail(row.entity, before, after, nameById) || row.entity,
      entity: row.entity,
    };
  });

  return state;
}
