import { z } from "zod";
import { roleLabels } from "./session";

export const availabilitySchema = z.enum(["DAY", "NIGHT", "FULL_24H", "UNAVAILABLE"]);
export type Availability = z.infer<typeof availabilitySchema>;
export type Shift = "DAY" | "NIGHT";
export type Role = "AGENT" | "MANAGER";
// The four roles of §2, as the database spells them. The Actor above keeps its
// two, because the business rules only ever ask « does this person manage? ».
export const memberRoles = ["AGENT", "RESPONSABLE", "GESTIONNAIRE", "ADMIN"] as const;
export const memberRoleSchema = z.enum(memberRoles);
export type MemberRole = (typeof memberRoles)[number];
export const administers = (role: MemberRole) => role === "GESTIONNAIRE" || role === "ADMIN";
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
        matricule: z.string().default(""),
        phone: z.string().default(""),
        qualifications: z.array(z.string()),
        role: memberRoleSchema.default("AGENT"),
        teamId: z.string().default(""),
      }),
    )
    .default([]),
  teams: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  qualificationCatalogue: z.array(z.string()).default([]),
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
    z.object({ id: z.string(), at: z.string(), actor: z.string(), action: z.string(), detail: z.string() }),
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
  const invalid =
    mode === "potential"
      ? []
      : agents.filter(
          a =>
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
    matricule: z.string().trim().max(30),
    phone: z.string().trim().max(30),
    teamId: id,
    role: memberRoleSchema,
    active: z.boolean(),
    qualifications: z.array(z.string().trim().min(1).max(60)).max(20),
  }),
  z.object({
    type: z.literal("invite"),
    email: z.string().trim().toLowerCase().email().max(200),
    name: z.string().trim().min(1).max(100),
    grade: z.string().trim().max(60),
    matricule: z.string().trim().max(30),
    phone: z.string().trim().max(30),
    teamId: id,
    role: memberRoleSchema,
  }),
  z.object({ type: z.literal("revokeInvitation"), invitationId: id }),
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
export const commandLabels: Record<Command["type"], string> = {
  availability: "Disponibilités modifiées",
  validate: "Réponse validée",
  assign: "Brouillon du planning modifié",
  publish: "Créneau publié",
  requirement: "Besoins modifiés",
  campaign: "Campagne ouverte",
  close: "Verrouillage de la campagne modifié",
  settings: "Horaires par défaut modifiés",
  member: "Fiche agent mise à jour",
  invite: "Invitation envoyée",
  revokeInvitation: "Invitation annulée",
  team: "Équipe enregistrée",
};

// Pure business layer shared by the demonstration and the future server commands.
// Browser roles are only simulation controls, never an authorization boundary.
export function execute(state: AppState, actor: Actor, command: Command, now = new Date()): AppState {
  const next = structuredClone(state);
  const stamp = now.toISOString();
  const today = localDate(now);
  // Administration writes to tables the demonstration does not model at all.
  // Connected mode handles these four; refusing plainly beats pretending.
  if (["member", "invite", "revokeInvitation", "team"].includes(command.type))
    throw new Error("L’administration des agents n’est disponible qu’en mode connecté.");
  const campaign = "campaignId" in command ? next.campaigns.find(c => c.id === command.campaignId) : undefined;
  if ("campaignId" in command && !campaign) throw new Error("Campagne introuvable.");
  if (!["availability", "validate"].includes(command.type) && actor.role !== "MANAGER")
    throw new Error("Cette action est réservée au responsable.");
  const author = next.agents.find(a => a.id === actor.id);
  if (!author) throw new Error("Agent introuvable.");
  let action = "";
  let detail = "";
  if (command.type === "availability" && campaign) {
    if (!isOpen(campaign, today)) throw new Error("La campagne est fermée à la saisie.");
    if (!command.dates.length || command.dates.some(d => !monthDays(campaign.month).includes(d)))
      throw new Error("Sélectionnez des dates dans la campagne.");
    if (command.comment.length > 500) throw new Error("Le commentaire est limité à 500 caractères.");
    for (const date of command.dates) {
      const key = entryKey(campaign.id, actor.id, date);
      if (command.value)
        next.entries[key] = { type: availabilitySchema.parse(command.value), comment: command.comment.trim() };
      else delete next.entries[key];
    }
    delete next.responses[responseKey(campaign.id, actor.id)];
    action = "Disponibilités modifiées";
    detail = `${command.dates.length} jour(s) · ${command.value ? labels[command.value].label : "Non renseigné"} · réponse à valider`;
  } else if (command.type === "validate" && campaign) {
    if (!isOpen(campaign, today)) throw new Error("La campagne est fermée à la validation.");
    if (filledDays(next, campaign, actor.id) !== monthDays(campaign.month).length)
      throw new Error("Renseignez chaque jour avant de valider votre réponse.");
    next.responses[responseKey(campaign.id, actor.id)] = stamp;
    action = "Réponse validée";
    detail = campaign.name;
  } else if (command.type === "assign" && campaign) {
    if (!monthDays(campaign.month).includes(command.date)) throw new Error("Date hors campagne.");
    const key = shiftKey(campaign.id, command.date, command.shift);
    const assigned = next.assignments[key] ?? [];
    if (command.remove) next.assignments[key] = assigned.filter(id => id !== command.userId);
    else {
      if (!availableAgents(next, campaign.id, command.date, command.shift).some(a => a.id === command.userId))
        throw new Error("Cet agent doit être disponible et sa réponse validée.");
      next.assignments[key] = [...new Set([...assigned, command.userId])];
    }
    action = command.remove ? "Affectation retirée du brouillon" : "Agent affecté au brouillon";
    detail = `${next.agents.find(a => a.id === command.userId)?.name} · ${dateLabel(command.date)} · ${labels[command.shift].label}`;
  } else if (command.type === "publish" && campaign) {
    if (!monthDays(campaign.month).includes(command.date)) throw new Error("Date hors campagne.");
    // Same order as private.publish_schedule_shift(), so the interface refuses
    // what the database would refuse, and says the same thing.
    if (!requirement(next, campaign.id, command.date, command.shift))
      throw new Error("Définissez les besoins de ce créneau avant de publier.");
    if (!coverage(next, campaign.id, command.date, command.shift, "planned").covered)
      throw new Error("Couvrez les effectifs et qualifications avec des disponibilités validées avant publication.");
    const key = shiftKey(campaign.id, command.date, command.shift);
    const revision = (next.publications[key]?.revision ?? 0) + 1;
    next.publications[key] = { agents: [...(next.assignments[key] ?? [])], publishedAt: stamp, revision };
    action = "Créneau publié";
    detail = `${dateLabel(command.date)} · ${labels[command.shift].label} · version ${revision}`;
  } else if (command.type === "requirement" && campaign) {
    if (!monthDays(campaign.month).includes(command.date)) throw new Error("Date hors campagne.");
    if (
      !Number.isInteger(command.total) ||
      command.total < 1 ||
      command.total > 100 ||
      Object.values(command.qualifications).some(n => !Number.isInteger(n) || n < 0 || n > command.total)
    )
      throw new Error("Les besoins doivent être entiers, entre 0 et l’effectif requis (1 à 100).");
    next.requirements[shiftKey(campaign.id, command.date, command.shift)] = {
      total: command.total,
      qualifications: command.qualifications,
    };
    action = "Besoins modifiés";
    detail = `${dateLabel(command.date)} · ${labels[command.shift].label} · ${command.total} agents`;
  } else if (command.type === "campaign") {
    campaignFormSchema.parse(command);
    if (command.closesOn < today) throw new Error("La date de clôture est passée.");
    if (next.campaigns.some(c => c.month === command.month)) throw new Error("Une campagne existe déjà pour ce mois.");
    next.campaigns.push({
      id: `campaign-${command.month}`,
      name: command.name,
      month: command.month,
      opensOn: today,
      closesOn: command.closesOn,
      closed: false,
      dayStart: next.organization.dayStart,
      nightStart: next.organization.nightStart,
    });
    action = "Campagne ouverte";
    detail = command.name;
  } else if (command.type === "close" && campaign) {
    campaign.closed = command.closed;
    action = command.closed ? "Campagne verrouillée" : "Campagne déverrouillée";
    detail = campaign.name;
  } else if (command.type === "settings") {
    if (
      ![command.dayStart, command.nightStart].every(n => Number.isInteger(n) && n >= 0 && n <= 23) ||
      command.dayStart >= command.nightStart
    )
      throw new Error("Le début du jour doit précéder le début de la nuit (0 à 23 h).");
    next.organization.dayStart = command.dayStart;
    next.organization.nightStart = command.nightStart;
    action = "Horaires par défaut modifiés";
    detail = `Jour ${command.dayStart} h–${command.nightStart} h · nouvelles campagnes uniquement`;
  }
  next.audit.unshift({
    id: crypto.randomUUID(),
    at: stamp,
    actor: author.name,
    action,
    detail,
  });
  return next;
}
