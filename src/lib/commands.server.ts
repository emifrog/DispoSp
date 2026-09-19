import "server-only";
import { frenchMessage, type DatabaseFailure } from "./command-errors";
import { dispatch } from "./mailer.server";
import type { Command, Shift } from "./domain";
import type { AttachedSession } from "./session";
import { createActionClient } from "./supabase/server";

type Client = Awaited<ReturnType<typeof createActionClient>>;
type Of<T extends Command["type"]> = Extract<Command, { type: T }>;

function fail(error: DatabaseFailure): never {
  throw new Error(frenchMessage(error));
}

// Every write below runs under RLS as the signed-in user, and the triggers of
// 0001/0002/0003 do the checking. Nothing here re-implements a rule the database
// already holds: it would only give the two a chance to disagree.
export async function runCommand(session: AttachedSession, command: Command): Promise<void> {
  const client = await createActionClient();
  switch (command.type) {
    case "availability":
      return writeAvailability(client, session.userId, command);
    case "validate":
      return validateResponse(client, session.userId, command);
    case "assign":
      return writeAssignment(client, session, command);
    case "publish":
      return publishShift(client, session.membership.organizationId, command);
    case "requirement":
      return writeRequirement(client, session, command);
    case "requirements":
      return writeRequirements(client, session, command);
    case "campaign":
      return openCampaign(client, session, command);
    case "close":
      return lockCampaign(client, command);
    case "settings":
      return writeSettings(client, session, command);
    case "member":
      return writeMember(client, session, command);
    case "invite":
      return writeInvitation(client, session, command);
    case "revokeInvitation":
      return revokeInvitation(client, command);
    case "team":
      return writeTeam(client, session, command);
    case "withdraw":
      return writeWithdrawal(client, session, command);
    case "cancelWithdrawal":
      return cancelWithdrawal(client, session, command);
    case "decideWithdrawal":
      return decideWithdrawal(client, command);
    case "readNotifications":
      return markNotificationsRead(client, command);
    case "remind":
      return remindCampaign(client, session, command);
    case "template":
      return writeTemplate(client, session, command);
    case "applyTemplate":
      return applyTemplate(client, command);
  }
}

// ---------------------------------------------------------------------------
// Disponibilité habituelle (§4)
// ---------------------------------------------------------------------------

// La semaine entière est remplacée : l’écran envoie toujours les sept jours, et
// un jour absent veut dire « rien d’habituel », pas « inchangé ». L’effacement et
// la réécriture tiennent dans une transaction : un refus rend à l’agent la semaine
// qu’il avait, au lieu de la lui laisser vide.
async function writeTemplate(client: Client, session: AttachedSession, command: Of<"template">) {
  const { error } = await client.rpc("save_availability_template", {
    org: session.membership.organizationId,
    days: command.days,
  });
  if (error) fail(error);
}

// Appliquer, c’est écrire de vraies disponibilités. La base tient le calendrier —
// elle seule sait quel jour de la campagne tombe un lundi — et écrit le mois d’un
// bloc, avec ses règles habituelles : fenêtre ouverte et invalidation de la réponse.
async function applyTemplate(client: Client, command: Of<"applyTemplate">) {
  const { error } = await client.rpc("apply_availability_template", { campaign: command.campaignId });
  if (error) fail(error);
}

// Nobody runs a clock, so a reminder is an act a manager takes. The database
// picks the targets — those who have not validated — and refuses a second
// pending reminder for the same campaign.
async function remindCampaign(client: Client, session: AttachedSession, command: Of<"remind">) {
  const { error } = await client.rpc("remind_campaign", { campaign: command.campaignId });
  if (error) fail(error);
  await dispatch(client, session.membership.organizationId);
}

// The only column a session may write on its own notices. Marking one already
// read again is not an error: the screen may send a batch that overlaps.
async function markNotificationsRead(client: Client, command: Of<"readNotifications">) {
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", command.ids)
    .is("read_at", null);
  if (error) fail(error);
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

async function writeAvailability(client: Client, userId: string, command: Of<"availability">) {
  const { campaignId, dates, value } = command;
  const comment = command.comment.trim();
  // Clearing a day is a delete: the absence of a row is what « non renseigné »
  // means in the schema, and the trigger invalidates the response either way.
  if (value === null) {
    const { error } = await client
      .from("availability_entries")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .in("date", dates);
    if (error) fail(error);
    return;
  }
  // Update what exists, insert what is missing. A delete-then-insert would empty
  // the selected days if the second statement failed; this order never loses one.
  // An upsert is not an option: it would need update rights on the key columns,
  // which the migration deliberately withholds.
  const { data: updated, error: updateFailure } = await client
    .from("availability_entries")
    .update({ availability_type: value, comment })
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .in("date", dates)
    .select("date");
  if (updateFailure) fail(updateFailure);
  const written = new Set((updated ?? []).map(row => row.date as string));
  const missing = dates.filter(date => !written.has(date));
  if (!missing.length) return;
  const { error: insertFailure } = await client.from("availability_entries").insert(
    missing.map(date => ({
      campaign_id: campaignId,
      user_id: userId,
      date,
      availability_type: value,
      comment,
    })),
  );
  if (insertFailure) fail(insertFailure);
}

async function validateResponse(client: Client, userId: string, command: Of<"validate">) {
  // The value sent is only a non-null marker: private.check_validation() checks
  // the month is complete and stamps the real instant itself.
  const { data, error } = await client
    .from("campaign_participants")
    .update({ validated_at: new Date().toISOString() })
    .eq("campaign_id", command.campaignId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) fail(error);
  // RLS and the missing participant row look the same from here — no error, no
  // row — so the case is named rather than reported as a mysterious success.
  if (!data?.length) throw new Error("Vous ne faites pas partie des agents invités à cette campagne.");
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

// A shift is addressed by campaign, date and slot on screen, and by its own id in
// the database. One schedule per campaign, so the walk is unambiguous.
async function shiftIdFor(client: Client, campaignId: string, date: string, shift: Shift): Promise<string> {
  const { data: schedule, error: scheduleFailure } = await client
    .from("schedules")
    .select("id")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (scheduleFailure) fail(scheduleFailure);
  if (!schedule) throw new Error("Cette campagne n’a pas encore de planning.");
  const { data, error } = await client
    .from("schedule_shifts")
    .select("id")
    .eq("schedule_id", schedule.id)
    .eq("date", date)
    .eq("shift_code", shift)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new Error("Ce créneau ne fait pas partie du planning de la campagne.");
  return data.id as string;
}

async function writeAssignment(client: Client, session: AttachedSession, command: Of<"assign">) {
  const shiftId = await shiftIdFor(client, command.campaignId, command.date, command.shift);
  if (command.remove) {
    const { error } = await client
      .from("schedule_assignments")
      .delete()
      .eq("schedule_shift_id", shiftId)
      .eq("user_id", command.userId)
      .eq("revision", 0);
    if (error) fail(error);
    return;
  }
  // The draft accepts anyone the manager picks; eligibility is re-checked at
  // publication, where it becomes a commitment. The screen flags the mismatch
  // meanwhile, so a draft can be built before every response is in.
  const { error } = await client.from("schedule_assignments").insert({
    organization_id: session.membership.organizationId,
    schedule_shift_id: shiftId,
    user_id: command.userId,
    revision: 0,
    status: "PROPOSED",
    assigned_by: session.userId,
  });
  if (error) fail(error);
}

async function publishShift(client: Client, organizationId: string, command: Of<"publish">) {
  const shiftId = await shiftIdFor(client, command.campaignId, command.date, command.shift);
  // public.publish_shift() is the only door to the private definer function,
  // which re-checks headcount, qualifications and eligibility in one transaction.
  const { error } = await client.rpc("publish_shift", { shift: shiftId });
  if (error) fail(error);
  await dispatch(client, organizationId);
}

async function writeRequirement(client: Client, session: AttachedSession, command: Of<"requirement">) {
  await writeOneRequirement(client, session.membership.organizationId, command);
}

/**
 * Le même besoin posé sur plusieurs créneaux.
 *
 * Une boucle et non une seule requête : chaque créneau passe par le même
 * chemin, donc par les mêmes policies et le même déclencheur de vérification du
 * minimum. Grouper l'écriture ferait gagner des allers-retours et perdre cette
 * garantie. Ce n'est pas atomique, et c'est acceptable ici — un besoin posé est
 * un besoin posé, et l'écran redit l'état réel après coup.
 */
async function writeRequirements(client: Client, session: AttachedSession, command: Of<"requirements">) {
  const organizationId = session.membership.organizationId;
  // Le catalogue est le même pour tous les créneaux du lot : le résoudre une
  // fois épargne une requête par créneau, soit soixante-deux sur un mois.
  const wanted = Object.entries(command.qualifications).filter(([, minimum]) => minimum > 0);
  const ids = wanted.length
    ? await qualificationIds(
        client,
        organizationId,
        wanted.map(([name]) => name),
      )
    : new Map<string, string>();
  for (const date of command.dates)
    for (const shift of command.shifts)
      await writeOneRequirement(
        client,
        organizationId,
        {
          campaignId: command.campaignId,
          date,
          shift,
          total: command.total,
          qualifications: command.qualifications,
        },
        ids,
      );
}

type RequirementWrite = {
  campaignId: string;
  date: string;
  shift: Of<"requirement">["shift"];
  total: number;
  qualifications: Record<string, number>;
};

async function writeOneRequirement(
  client: Client,
  organizationId: string,
  command: RequirementWrite,
  /** Catalogue déjà résolu, quand l'appelant écrit plusieurs créneaux d'affilée. */
  resolved?: Map<string, string>,
) {
  const { data: existing, error: readFailure } = await client
    .from("staffing_requirements")
    .select("id")
    .eq("campaign_id", command.campaignId)
    .eq("date", command.date)
    .eq("shift_code", command.shift)
    .maybeSingle();
  if (readFailure) fail(readFailure);

  let requirementId = existing?.id as string | undefined;
  if (requirementId) {
    const { error } = await client
      .from("staffing_requirements")
      .update({ headcount: command.total })
      .eq("id", requirementId);
    if (error) fail(error);
  } else {
    const { data, error } = await client
      .from("staffing_requirements")
      .insert({
        organization_id: organizationId,
        campaign_id: command.campaignId,
        date: command.date,
        shift_code: command.shift,
        headcount: command.total,
      })
      .select("id")
      .single();
    if (error) fail(error);
    requirementId = data.id as string;
  }

  // Replace the minima wholesale: the screen always sends the complete set, and
  // the headcount is already written, so check_requirement_minimum() judges the
  // new pair rather than a half-applied one.
  const { error: clearFailure } = await client
    .from("staffing_requirement_qualifications")
    .delete()
    .eq("requirement_id", requirementId);
  if (clearFailure) fail(clearFailure);
  const wanted = Object.entries(command.qualifications).filter(([, minimum]) => minimum > 0);
  if (!wanted.length) return;

  const ids =
    resolved ??
    (await qualificationIds(
      client,
      organizationId,
      wanted.map(([name]) => name),
    ));
  const { error } = await client.from("staffing_requirement_qualifications").insert(
    wanted.map(([name, minimum]) => ({
      organization_id: organizationId,
      requirement_id: requirementId,
      qualification_id: ids.get(name),
      minimum,
    })),
  );
  if (error) fail(error);
}

// The catalogue has no administration screen yet, so it fills itself as needs are
// defined. Creating one takes an administrator: a team manager reusing existing
// qualifications works, inventing a new one does not.
async function qualificationIds(client: Client, organizationId: string, names: string[]) {
  const { data, error } = await client
    .from("qualifications")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("name", names);
  if (error) fail(error);
  const found = new Map((data ?? []).map(row => [row.name as string, row.id as string]));
  const missing = names.filter(name => !found.has(name));
  if (!missing.length) return found;
  const { data: created, error: createFailure } = await client
    .from("qualifications")
    .insert(missing.map(name => ({ organization_id: organizationId, name })))
    .select("id, name");
  if (createFailure) fail(createFailure);
  for (const row of created ?? []) found.set(row.name as string, row.id as string);
  return found;
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

async function openCampaign(client: Client, session: AttachedSession, command: Of<"campaign">) {
  const { organizationId, teamId } = session.membership;
  const { error } = await client.rpc("create_campaign", {
    org: organizationId,
    team: teamId,
    campaign_name: command.name,
    campaign_month: `${command.month}-01`,
    closes_on: command.closesOn,
  });
  if (error) fail(error);
  // Only send after the campaign, planning, participants and notices commit.
  await dispatch(client, organizationId);
}

async function lockCampaign(client: Client, command: Of<"close">) {
  const { data, error } = await client
    .from("availability_campaigns")
    .update({ locked: command.closed })
    .eq("id", command.campaignId)
    .select("id");
  if (error) fail(error);
  if (!data?.length) throw new Error("Vous n’avez pas le droit de verrouiller cette campagne.");
}

// ---------------------------------------------------------------------------
// Désistements
// ---------------------------------------------------------------------------

/**
 * Se désister d'une garde publiée.
 *
 * Rien n'est vérifié ici sur le droit de le faire : c'est la policy d'insertion
 * qui exige que l'agent figure dans la révision publiée du créneau. Refaire ce
 * contrôle en TypeScript donnerait deux règles à maintenir, dont une seule
 * compte.
 */
async function writeWithdrawal(client: Client, session: AttachedSession, command: Of<"withdraw">) {
  const shiftId = await shiftIdFor(client, command.campaignId, command.date, command.shift);
  const { error } = await client.from("shift_withdrawals").insert({
    organization_id: session.membership.organizationId,
    schedule_shift_id: shiftId,
    user_id: session.userId,
    reason: command.reason,
  });
  if (error) fail(error);
}

async function cancelWithdrawal(client: Client, session: AttachedSession, command: Of<"cancelWithdrawal">) {
  const { data, error } = await client
    .from("shift_withdrawals")
    .update({ state: "CANCELLED" })
    .eq("id", command.withdrawalId)
    .eq("user_id", session.userId)
    .select("id");
  if (error) fail(error);
  if (!data?.length) throw new Error("Ce désistement n’est plus en attente, ou n’est pas le vôtre.");
}

async function decideWithdrawal(client: Client, command: Of<"decideWithdrawal">) {
  // decided_by et decided_at sont posés par le déclencheur : les envoyer d'ici
  // laisserait croire qu'un client peut choisir qui a décidé.
  const { data, error } = await client
    .from("shift_withdrawals")
    .update({ state: command.accepted ? "ACCEPTED" : "REFUSED" })
    .eq("id", command.withdrawalId)
    .select("id");
  if (error) fail(error);
  if (!data?.length) throw new Error("Ce désistement a déjà été tranché, ou vous n’en avez pas le droit.");
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

async function writeMember(client: Client, session: AttachedSession, command: Of<"member">) {
  const organizationId = session.membership.organizationId;
  // The record and the membership are two tables with two policies. A partial
  // edit is visible and re-editable; nothing is derived from the other half.
  const { data: profile, error: profileFailure } = await client
    .from("profiles")
    .update({
      display_name: command.name,
      grade: command.grade || null,
      fonction: command.fonction || null,
      matricule: command.matricule || null,
      phone: command.phone || null,
    })
    .eq("user_id", command.userId)
    .select("user_id");
  if (profileFailure) fail(profileFailure);
  if (!profile?.length) throw new Error("Vous n’avez pas le droit de modifier cette fiche.");

  const { error: membershipFailure } = await client
    .from("memberships")
    .update({ team_id: command.teamId, role: command.role, active: command.active })
    .eq("organization_id", organizationId)
    .eq("user_id", command.userId);
  if (membershipFailure) fail(membershipFailure);

  // The screen always sends the complete set, so the difference is computed here
  // rather than asking it to remember what it removed.
  const { data: held, error: heldFailure } = await client
    .from("user_qualifications")
    .select("qualification_id, qualifications(name)")
    .eq("organization_id", organizationId)
    .eq("user_id", command.userId);
  if (heldFailure) fail(heldFailure);
  // A to-one embed comes back as an object, but the untyped client infers an
  // array: accept either rather than assert one and be wrong at runtime.
  const embeddedName = (value: unknown): string => {
    const row = Array.isArray(value) ? value[0] : value;
    return row && typeof row === "object" && "name" in row ? String((row as { name: unknown }).name) : "";
  };
  const current = new Map((held ?? []).map(row => [embeddedName(row.qualifications), row.qualification_id as string]));
  const wanted = new Set(command.qualifications);
  const removed = [...current].filter(([name]) => name && !wanted.has(name)).map(([, id]) => id);
  if (removed.length) {
    const { error } = await client
      .from("user_qualifications")
      .delete()
      .eq("user_id", command.userId)
      .in("qualification_id", removed);
    if (error) fail(error);
  }
  const added = command.qualifications.filter(name => !current.has(name));
  if (!added.length) return;
  const ids = await qualificationIds(client, organizationId, added);
  const { error } = await client.from("user_qualifications").insert(
    added.map(name => ({
      organization_id: organizationId,
      user_id: command.userId,
      qualification_id: ids.get(name),
    })),
  );
  if (error) fail(error);
}

async function writeInvitation(client: Client, session: AttachedSession, command: Of<"invite">) {
  // No service key: the invitation only records who is expected. The account is
  // created by the agent, and 0004's trigger attaches it once the address is
  // confirmed — an unconfirmed address never takes a seat.
  //
  // L'équipe ne se demande plus à l'invitation, mais la colonne reste
  // obligatoire : l'invité rejoint celle de l'invitant. Un gestionnaire qui
  // veut l'affecter ailleurs le fait depuis sa fiche, une fois le compte créé.
  const { error } = await client.from("invitations").insert({
    organization_id: session.membership.organizationId,
    team_id: session.membership.teamId,
    email: command.email,
    display_name: command.name,
    role: command.role,
    grade: command.grade || null,
    fonction: command.fonction || null,
    matricule: command.matricule || null,
    phone: command.phone || null,
    invited_by: session.userId,
  });
  if (error) fail(error);
}

async function revokeInvitation(client: Client, command: Of<"revokeInvitation">) {
  const { data, error } = await client.from("invitations").delete().eq("id", command.invitationId).select("id");
  if (error) fail(error);
  if (!data?.length) throw new Error("Cette invitation n’existe plus, ou a déjà été acceptée.");
}

async function writeTeam(client: Client, session: AttachedSession, command: Of<"team">) {
  if (command.teamId) {
    const { data, error } = await client
      .from("teams")
      .update({ name: command.name })
      .eq("id", command.teamId)
      .select("id");
    if (error) fail(error);
    if (!data?.length) throw new Error("Vous n’avez pas le droit de renommer cette équipe.");
    return;
  }
  const { error } = await client
    .from("teams")
    .insert({ organization_id: session.membership.organizationId, name: command.name });
  if (error) fail(error);
}

async function writeSettings(client: Client, session: AttachedSession, command: Of<"settings">) {
  // The database holds this rule as a check constraint; stating it here only buys
  // a message that names the two fields instead of quoting a constraint.
  if (command.dayStart >= command.nightStart) throw new Error("Le début du jour doit précéder le début de la nuit.");
  const { data, error } = await client
    .from("organizations")
    .update({ day_start: command.dayStart, night_start: command.nightStart })
    .eq("id", session.membership.organizationId)
    .select("id");
  if (error) fail(error);
  if (!data?.length)
    throw new Error("Seuls un gestionnaire ou un administrateur peuvent modifier les horaires du centre.");
}
