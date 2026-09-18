import "server-only";
import { fromZonedTime } from "date-fns-tz";
import { frenchMessage, type DatabaseFailure } from "./command-errors";
import { lastDayOfMonth, monthDays, type Command, type Shift } from "./domain";
import type { AttachedSession } from "./session";
import { createActionClient } from "./supabase/server";

type Client = Awaited<ReturnType<typeof createActionClient>>;
type Of<T extends Command["type"]> = Extract<Command, { type: T }>;

const PARIS = "Europe/Paris";

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
      return publishShift(client, command);
    case "requirement":
      return writeRequirement(client, session, command);
    case "campaign":
      return openCampaign(client, session, command);
    case "close":
      return lockCampaign(client, command);
    case "settings":
      return writeSettings(client, session, command);
  }
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

async function publishShift(client: Client, command: Of<"publish">) {
  const shiftId = await shiftIdFor(client, command.campaignId, command.date, command.shift);
  // public.publish_shift() is the only door to the private definer function,
  // which re-checks headcount, qualifications and eligibility in one transaction.
  const { error } = await client.rpc("publish_shift", { shift: shiftId });
  if (error) fail(error);
}

async function writeRequirement(client: Client, session: AttachedSession, command: Of<"requirement">) {
  const organizationId = session.membership.organizationId;
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

  const ids = await qualificationIds(
    client,
    organizationId,
    wanted.map(([name]) => name),
  );
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
  const { data: organization, error: organizationFailure } = await client
    .from("organizations")
    .select("day_start, night_start")
    .eq("id", organizationId)
    .single();
  if (organizationFailure) fail(organizationFailure);

  const startsOn = `${command.month}-01`;
  const { data: campaign, error } = await client
    .from("availability_campaigns")
    .insert({
      organization_id: organizationId,
      team_id: teamId,
      name: command.name,
      starts_on: startsOn,
      ends_on: lastDayOfMonth(command.month),
      opens_at: new Date().toISOString(),
      // A closing date is a day on screen and an instant in the database: the
      // window ends when that day ends in the centre's own timezone.
      closes_at: fromZonedTime(`${command.closesOn}T23:59:59`, PARIS).toISOString(),
      day_start: organization.day_start,
      night_start: organization.night_start,
    })
    .select("id")
    .single();
  if (error) fail(error);
  const campaignId = campaign.id as string;

  // The schedule comes before the invitations: a campaign whose planning is
  // missing breaks every manager screen, while one missing an invitation shows
  // the gap plainly. These four statements are not one transaction — see the
  // note in the README about moving this behind a single database function.
  const { data: schedule, error: scheduleFailure } = await client
    .from("schedules")
    .insert({ organization_id: organizationId, campaign_id: campaignId, team_id: teamId })
    .select("id")
    .single();
  if (scheduleFailure) fail(scheduleFailure);
  const shifts = monthDays(command.month).flatMap(date =>
    (["DAY", "NIGHT"] as Shift[]).map(shift => ({
      organization_id: organizationId,
      schedule_id: schedule.id as string,
      date,
      shift_code: shift,
    })),
  );
  const { error: shiftFailure } = await client.from("schedule_shifts").insert(shifts);
  if (shiftFailure) fail(shiftFailure);

  const { data: members, error: memberFailure } = await client
    .from("memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("team_id", teamId)
    .eq("active", true);
  if (memberFailure) fail(memberFailure);
  if (!members?.length) return;
  const { error: participantFailure } = await client.from("campaign_participants").insert(
    members.map(member => ({
      organization_id: organizationId,
      campaign_id: campaignId,
      user_id: member.user_id as string,
    })),
  );
  if (participantFailure) fail(participantFailure);
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
