import { z } from "zod";
import { roleLabels } from "./session";

export const availabilitySchema = z.enum(["DAY", "NIGHT", "FULL_24H", "UNAVAILABLE"]);
export type Availability = z.infer<typeof availabilitySchema>;
export type Shift = "DAY" | "NIGHT";
export type Role = "AGENT" | "MANAGER";
// Les trois rôles, tels que la base les écrit. L'Actor ci-dessus n'en garde que
// deux, parce que les règles métier ne demandent jamais que « cette personne
// encadre-t-elle ? ». RESPONSABLE a disparu : un centre n'a pas de responsable
// d'équipe distinct du gestionnaire.
export const memberRoles = ["AGENT", "GESTIONNAIRE", "ADMIN"] as const;
export const memberRoleSchema = z.enum(memberRoles);
export type MemberRole = (typeof memberRoles)[number];
export const administers = (role: MemberRole) => role === "GESTIONNAIRE" || role === "ADMIN";
/** Les grades proposés à la saisie, du plus bas au plus élevé. La base, elle,
    accepte n'importe quel texte : cette liste guide l'écran sans interdire une
    valeur déjà enregistrée qui n'y figurerait pas. */
export const grades = [
  "Sapeur",
  "Caporal",
  "Caporal-Chef",
  "Sergent",
  "Sergent-Chef",
  "Adjudant",
  "Adjudant-Chef",
  "Lieutenant",
] as const;
/** Les fonctions proposées à la saisie. Elle n'existe que côté écran : la base
    accepte n'importe quel texte, donc la compléter ne demande aucune migration. */
export const fonctions = [
  "Équipier",
  "Chef d'équipe",
  "Chef d'agrès une équipe",
  "Chef d'agrès tout engin",
  "Conducteur",
  "Chef de groupe",
] as const;
// A centre that has not filled the rank in yet still gets an honest line. This is
// a display fallback and stays one: the stored grade may legitimately be empty.
export const gradeLabel = (agent: { grade: string; role: MemberRole }) => agent.grade || roleLabels[agent.role];
export const labels: Record<Availability, { label: string; short: string; className: string }> = {
  DAY: { label: "Jour", short: "J", className: "day" },
  NIGHT: { label: "Nuit", short: "N", className: "night" },
  FULL_24H: { label: "24 h", short: "24", className: "full" },
  UNAVAILABLE: { label: "Indisponible", short: "X", className: "unavailable" },
};
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const campaignFormSchema = z
  .object({
    name: z.string().trim().min(3, "Au moins 3 caractères."),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choisissez un mois."),
    closesOn: isoDate,
  })
  .refine(v => v.closesOn < `${v.month}-01`, {
    path: ["closesOn"],
    message: "La clôture doit précéder le mois concerné.",
  });
export const stateSchema = z.object({
  version: z.literal(1),
  organization: z.object({
    name: z.string(),
    dayStart: z.number().int().min(0).max(23),
    nightStart: z.number().int().min(0).max(23),
  }),
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      team: z.string(),
      grade: z.string(),
      /** La fonction tenue sur un engin, distincte du grade. Par défaut vide :
          une fiche saisie avant la séparation des deux n'a que son grade. */
      fonction: z.string().default(""),
      /** Empty when unknown: §3 makes both optional on the agent record. The
          default also lets a demonstration saved before they existed still load,
          instead of being thrown away as incompatible. */
      matricule: z.string().default(""),
      phone: z.string().default(""),
      qualifications: z.array(z.string()),
      role: memberRoleSchema.default("AGENT"),
      teamId: z.string().default(""),
    }),
  ),
  /** Administration only. Every other screen reads `agents`, which stays the
      active roster: a deactivated agent must not reappear in a synthesis. */
  inactiveAgents: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        team: z.string(),
        grade: z.string(),
        fonction: z.string().default(""),
        matricule: z.string().default(""),
        phone: z.string().default(""),
        qualifications: z.array(z.string()),
        role: memberRoleSchema.default("AGENT"),
        teamId: z.string().default(""),
      }),
    )
    .default([]),
  teams: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  notifications: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        subject: z.string(),
        body: z.string(),
        createdAt: z.string(),
        readAt: z.string().nullable(),
      }),
    )
    .default([]),
  qualificationCatalogue: z.array(z.string()).default([]),
  /** La disponibilité habituelle du §4, par jour de semaine ISO : « 1 » = lundi.
      Ce n’est pas une disponibilité : rien n’entre dans une couverture tant que
      l’agent ne l’a pas appliquée à une campagne. */
  template: z.record(z.string(), availabilitySchema).default({}),
  invitations: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        role: memberRoleSchema,
        teamId: z.string(),
        team: z.string(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  /** Les désistements du centre. Un agent ne voit que les siens : ce sont les
      policies qui filtrent, pas l'écran. */
  withdrawals: z
    .array(
      z.object({
        id: z.string(),
        shiftId: z.string(),
        campaignId: z.string(),
        date: isoDate,
        shift: z.enum(["DAY", "NIGHT"]),
        userId: z.string(),
        reason: z.string().default(""),
        state: z.enum(["PENDING", "ACCEPTED", "REFUSED", "CANCELLED"]),
        createdAt: z.string(),
        /** Ce désistement écarte-t-il encore l'agent de cette garde ? Accepté,
            et postérieur à l'affectation qui tient encore au brouillon. */
        blocking: z.boolean().default(false),
      }),
    )
    .default([]),
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      month: z.string(),
      opensOn: isoDate,
      closesOn: isoDate,
      closed: z.boolean(),
      dayStart: z.number(),
      nightStart: z.number(),
      /** L'équipe à qui la campagne a été ouverte. */
      teamId: z.string().default(""),
      /** Qui elle concerne, validés ou non. Sans cette liste, le seul
          dénominateur disponible était l'effectif entier du centre — un agent
          d'une autre équipe comptait comme non-répondant à une campagne où il
          n'avait jamais été invité. */
      participants: z.array(z.string()).default([]),
    }),
  ),
  entries: z.record(z.string(), z.object({ type: availabilitySchema, comment: z.string() })),
  responses: z.record(z.string(), z.string()),
  requirements: z.record(
    z.string(),
    z.object({
      total: z.number().int().min(1).max(100),
      qualifications: z.record(z.string(), z.number().int().min(0)),
    }),
  ),
  assignments: z.record(z.string(), z.array(z.string())),
  publications: z.record(
    z.string(),
    z.object({ agents: z.array(z.string()), publishedAt: z.string(), revision: z.number() }),
  ),
  audit: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      actor: z.string(),
      action: z.string(),
      detail: z.string(),
      /** The table the line came from. Empty on a demonstration saved before it
          existed, which the filter then simply never matches. */
      entity: z.string().default(""),
    }),
  ),
});
export type AppState = z.infer<typeof stateSchema>;
export type Agent = AppState["agents"][number];
export type Campaign = AppState["campaigns"][number];
export type Actor = { id: string; role: Role };
export const entryKey = (campaignId: string, userId: string, date: string) => `${campaignId}/${userId}/${date}`;
export const responseKey = (campaignId: string, userId: string) => `${campaignId}/${userId}`;
export const shiftKey = (campaignId: string, date: string, shift: Shift) => `${campaignId}/${date}/${shift}`;
export const monthDays = (month: string) =>
  Array.from(
    { length: new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const localMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const shiftMonth = (month: string, delta: number) =>
  localMonth(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + delta, 1));
export const lastDayOfMonth = (month: string) => {
  const days = monthDays(month);
  return days[days.length - 1];
};
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", options);
export const monthLabel = (month: string) => dateLabel(`${month}-01`, { month: "long", year: "numeric" });
// « de septembre » but « d’octobre » : a label opening on a vowel takes the elided form.
export const elide = (label: string) => `${/^[aeiouâàéèêîôû]/i.test(label) ? "d’" : "de "}${label}`;
export const ofMonth = (month: string) => elide(monthLabel(month));
// French keeps the singular for 0 and 1: « 0 agent », « 1 agent », « 2 agents ».
export const plural = (count: number, one: string, many = `${one}s`) => (count > 1 ? many : one);
export const hours = (campaign: Pick<Campaign, "dayStart" | "nightStart">, shift: Shift | "FULL_24H") =>
  shift === "DAY"
    ? `${campaign.dayStart} h – ${campaign.nightStart} h`
    : shift === "NIGHT"
      ? `${campaign.nightStart} h – ${campaign.dayStart} h (+1 j)`
      : `${campaign.dayStart} h – ${campaign.dayStart} h (+1 j)`;
// ISO 8601 numérote la semaine à partir du lundi ; getDay() à partir du dimanche.
export const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1;
export const weekdayNames = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
/** Ce qu’un modèle donnerait sur un mois, sans rien écrire. Les jours de semaine
 *  que le modèle ne mentionne pas restent tels qu’ils sont. */
export function templateEntries(template: AppState["template"], month: string) {
  return monthDays(month)
    .map(date => ({ date, type: template[String(isoWeekday(date))] }))
    .filter((entry): entry is { date: string; type: Availability } => Boolean(entry.type));
}
export const isAvailable = (type: Availability | undefined, shift: Shift) => type === shift || type === "FULL_24H";
export const isOpen = (campaign: Campaign, today = localDate()) =>
  !campaign.closed && today >= campaign.opensOn && today <= campaign.closesOn;
export const isValidated = (state: AppState, campaignId: string, userId: string) =>
  Boolean(state.responses[responseKey(campaignId, userId)]);
export const filledDays = (state: AppState, campaign: Campaign, userId: string) =>
  monthDays(campaign.month).filter(d => state.entries[entryKey(campaign.id, userId, d)]).length;
export type Requirement = AppState["requirements"][string];
// Starting point for the needs form and for the demonstration seed. It is never a
// measurement: a shift holds no requirement until one is actually recorded.
export const suggestedRequirement: Requirement = {
  total: 6,
  qualifications: { Chef: 1, "Conducteur PL": 1, SAP: 3 },
};
// null when nothing is recorded. A shift without requirement is neither covered
// nor in deficit, and private.publish_schedule_shift() refuses to publish it:
// inventing a figure here would make the interface disagree with the database.
export function requirement(state: AppState, campaignId: string, date: string, shift: Shift): Requirement | null {
  return state.requirements[shiftKey(campaignId, date, shift)] ?? null;
}
// §9 asks for three levels, not two. « Limite » is a shift that is covered with
// nothing to spare: one absence and it is short. Naming it is the whole point —
// a manager reads the orange cells first.
export type CoverageLevel = "unset" | "deficit" | "tight" | "covered";
export const coverageLevel = (c: {
  defined: boolean;
  covered: boolean;
  actual: number;
  need: number | null;
  qualifications: { need: number; actual: number }[];
}): CoverageLevel => {
  if (!c.defined) return "unset";
  if (!c.covered) return "deficit";
  const spare = c.actual - (c.need ?? 0);
  const qualificationAtLimit = c.qualifications.some(q => q.need > 0 && q.actual === q.need);
  return spare === 0 || qualificationAtLimit ? "tight" : "covered";
};
export const coverageLevelLabels: Record<CoverageLevel, string> = {
  unset: "Besoins non définis",
  deficit: "Déficit",
  tight: "Limite",
  covered: "Couvert",
};

// §8 asks for Jour, Nuit and 24 h per agent. An assignment is made to one shift,
// so « 24 h » is not a kind of its own: it is holding both slots of the same day.
export function workload(state: AppState, campaignId: string, userId: string) {
  const days = new Map<string, Set<Shift>>();
  for (const [key, ids] of Object.entries(state.assignments)) {
    if (!key.startsWith(`${campaignId}/`) || !ids.includes(userId)) continue;
    const [, date, shift] = key.split("/");
    days.set(date, (days.get(date) ?? new Set()).add(shift as Shift));
  }
  let day = 0;
  let night = 0;
  let full = 0;
  for (const shifts of days.values()) {
    if (shifts.has("DAY") && shifts.has("NIGHT")) full += 1;
    else if (shifts.has("DAY")) day += 1;
    else night += 1;
  }
  return { day, night, full, total: day + night + full * 2 };
}

/**
 * Les agents qu'une campagne concerne.
 *
 * Ses participants, moins ceux qui ont quitté l'effectif actif depuis — un
 * agent désactivé ne doit reparaître ni dans un taux ni dans une relance.
 *
 * C'est le dénominateur de tout ce qui se compte « sur la campagne ». L'écran
 * prenait l'effectif du centre, ce qui faisait passer pour non-répondant
 * quelqu'un qui n'avait jamais été invité.
 */
export function campaignAgents(state: AppState, campaignId: string) {
  const campaign = state.campaigns.find(c => c.id === campaignId);
  if (!campaign) return [];
  const invited = new Set(campaign.participants);
  return state.agents.filter(a => invited.has(a.id));
}
/** Les campagnes qu'un agent peut ouvrir. Qui encadre les voit toutes. */
export const visibleCampaigns = (state: AppState, userId: string, manages: boolean) =>
  manages ? state.campaigns : state.campaigns.filter(c => c.participants.includes(userId));

/** Les agents qu'un désistement accepté écarte encore de cette garde. */
export const withdrawnFrom = (state: AppState, campaignId: string, date: string, shift: Shift) =>
  new Set(
    state.withdrawals
      .filter(w => w.blocking && w.campaignId === campaignId && w.date === date && w.shift === shift)
      .map(w => w.userId),
  );

export function availableAgents(state: AppState, campaignId: string, date: string, shift: Shift) {
  return state.agents.filter(
    a =>
      isValidated(state, campaignId, a.id) && isAvailable(state.entries[entryKey(campaignId, a.id, date)]?.type, shift),
  );
}
export function coverage(
  state: AppState,
  campaignId: string,
  date: string,
  shift: Shift,
  mode: "potential" | "planned" | "published",
) {
  const key = shiftKey(campaignId, date, shift);
  const ids = mode === "published" ? (state.publications[key]?.agents ?? []) : (state.assignments[key] ?? []);
  const agents =
    mode === "potential"
      ? availableAgents(state, campaignId, date, shift)
      : state.agents.filter(a => ids.includes(a.id));
  const need = requirement(state, campaignId, date, shift);
  const qualifications = Object.entries(need?.qualifications ?? {}).map(([name, count]) => ({
    name,
    need: count,
    actual: agents.filter(a => a.qualifications.includes(name)).length,
  }));
  // Une affectation qui ne passera pas la publication. Deux causes : la
  // disponibilité ne correspond plus, ou l'agent s'est désisté et on le lui a
  // accordé. La base refuse les deux ; l'écran doit le dire avant le clic,
  // sinon la couverture annonce « couvert » jusqu'au refus.
  const withdrawn = mode === "potential" ? new Set<string>() : withdrawnFrom(state, campaignId, date, shift);
  const invalid =
    mode === "potential"
      ? []
      : agents.filter(
          a =>
            withdrawn.has(a.id) ||
            !isValidated(state, campaignId, a.id) ||
            !isAvailable(state.entries[entryKey(campaignId, a.id, date)]?.type, shift),
        );
  return {
    actual: agents.length,
    /** null while no requirement is recorded: screens show « — », never a figure. */
    need: need?.total ?? null,
    defined: need !== null,
    qualifications,
    invalid,
    covered:
      need !== null &&
      agents.length >= need.total &&
      qualifications.every(q => q.actual >= q.need) &&
      invalid.length === 0,
  };
}

const shiftSchema = z.enum(["DAY", "NIGHT"]);
const id = z.string().min(1).max(64);
// A server action is a public endpoint: its payload is parsed, never trusted.
// The Command type is inferred from here so the two can never drift apart.
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("availability"),
    campaignId: id,
    dates: z.array(isoDate).min(1).max(31),
    value: availabilitySchema.nullable(),
    comment: z.string().max(500),
  }),
  z.object({ type: z.literal("validate"), campaignId: id }),
  z.object({
    type: z.literal("assign"),
    campaignId: id,
    date: isoDate,
    shift: shiftSchema,
    userId: id,
    remove: z.boolean().optional(),
  }),
  z.object({ type: z.literal("publish"), campaignId: id, date: isoDate, shift: shiftSchema }),
  z.object({
    type: z.literal("requirement"),
    campaignId: id,
    date: isoDate,
    shift: shiftSchema,
    total: z.number().int().min(1).max(100),
    qualifications: z.record(z.string().max(60), z.number().int().min(0).max(100)),
  }),
  // Le même besoin posé d'un coup sur plusieurs journées. 62 est le plafond
  // atteignable : un mois de 31 jours, jour et nuit.
  z.object({
    type: z.literal("requirements"),
    campaignId: id,
    dates: z.array(isoDate).min(1).max(31),
    shifts: z.array(shiftSchema).min(1).max(2),
    total: z.number().int().min(1).max(100),
    qualifications: z.record(z.string().max(60), z.number().int().min(0).max(100)),
  }),
  z.object({
    type: z.literal("campaign"),
    name: z.string().trim().min(3),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    closesOn: isoDate,
  }),
  z.object({ type: z.literal("close"), campaignId: id, closed: z.boolean() }),
  z.object({
    type: z.literal("member"),
    userId: id,
    name: z.string().trim().min(1).max(100),
    grade: z.string().trim().max(60),
    fonction: z.string().trim().max(60),
    matricule: z.string().trim().max(30),
    phone: z.string().trim().max(30),
    teamId: id,
    role: memberRoleSchema,
    active: z.boolean(),
    qualifications: z.array(z.string().trim().min(1).max(60)).max(20),
  }),
  // Pas de teamId : l'équipe ne se choisit plus à l'invitation. Le serveur
  // rattache l'invité à celle de l'invitant, et la fiche agent permet ensuite
  // de le déplacer. La colonne reste obligatoire en base.
  z.object({
    type: z.literal("invite"),
    email: z.string().trim().toLowerCase().email().max(200),
    name: z.string().trim().min(1).max(100),
    grade: z.string().trim().max(60),
    fonction: z.string().trim().max(60),
    matricule: z.string().trim().max(30),
    phone: z.string().trim().max(30),
    role: memberRoleSchema,
  }),
  z.object({ type: z.literal("resendInvitation"), invitationId: id }),
  z.object({ type: z.literal("revokeInvitation"), invitationId: id }),
  // Un désistement porte sur le créneau, pas sur la campagne : c'est la garde
  // publiée qu'on ne peut plus tenir.
  z.object({
    type: z.literal("withdraw"),
    campaignId: id,
    date: isoDate,
    shift: shiftSchema,
    reason: z.string().trim().max(500),
  }),
  z.object({ type: z.literal("cancelWithdrawal"), withdrawalId: id }),
  z.object({ type: z.literal("decideWithdrawal"), withdrawalId: id, accepted: z.boolean() }),
  z.object({ type: z.literal("readNotifications"), ids: z.array(id).min(1).max(100) }),
  z.object({ type: z.literal("remind"), campaignId: id }),
  z.object({
    type: z.literal("template"),
    days: z.record(z.string().regex(/^[1-7]$/), availabilitySchema.nullable()),
  }),
  z.object({ type: z.literal("applyTemplate"), campaignId: id }),
  z.object({ type: z.literal("team"), teamId: z.string().max(64).optional(), name: z.string().trim().min(1).max(60) }),
  z.object({
    type: z.literal("settings"),
    dayStart: z.number().int().min(0).max(23),
    nightStart: z.number().int().min(0).max(23),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
// What the toast says once the database has accepted the write. The demonstration
// takes its wording from the audit entry execute() builds; connected mode has no
// such entry to read back, so the label lives here for both to stay in step.
// The trail groups by table; a reader groups by subject. One place decides which
// is which, and the history screen offers nothing the vocabulary cannot fill.
export const auditFamilies = [
  {
    key: "availability",
    label: "Disponibilités",
    entities: ["availability_entry", "campaign_participant", "availability_template"],
  },
  { key: "planning", label: "Planning", entities: ["schedule_assignment", "schedule_shift"] },
  { key: "needs", label: "Besoins", entities: ["staffing_requirement"] },
  { key: "campaigns", label: "Campagnes", entities: ["availability_campaign"] },
  {
    key: "administration",
    label: "Administration",
    entities: ["profile", "membership", "team", "invitation", "user_qualification", "qualification", "organization"],
  },
] as const;
export const notificationLabels: Record<string, string> = {
  CAMPAIGN_OPENED: "Campagne ouverte",
  CAMPAIGN_REMINDER: "Rappel avant clôture",
  SCHEDULE_PUBLISHED: "Planning publié",
  WITHDRAWAL_REQUESTED: "Désistement signalé",
  WITHDRAWAL_DECIDED: "Réponse à votre désistement",
};
export const commandLabels: Record<Command["type"], string> = {
  availability: "Disponibilités modifiées",
  validate: "Réponse validée",
  assign: "Brouillon du planning modifié",
  publish: "Créneau publié",
  requirement: "Besoins modifiés",
  requirements: "Besoins appliqués aux journées choisies",
  withdraw: "Désistement signalé",
  cancelWithdrawal: "Désistement retiré",
  decideWithdrawal: "Désistement tranché",
  campaign: "Campagne ouverte",
  close: "Verrouillage de la campagne modifié",
  settings: "Horaires par défaut modifiés",
  member: "Fiche agent mise à jour",
  invite: "Invitation envoyée",
  resendInvitation: "Invitation renvoyée",
  revokeInvitation: "Invitation annulée",
  team: "Équipe enregistrée",
  readNotifications: "Notifications marquées comme lues",
  remind: "Relance envoyée",
  template: "Disponibilité habituelle enregistrée",
  applyTemplate: "Disponibilité habituelle appliquée",
};
