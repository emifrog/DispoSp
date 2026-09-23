import "server-only";
import { frenchMessage, type DatabaseFailure } from "./command-errors";
import { plural, type Command, type Shift } from "./domain";
import type { AttachedSession } from "./session";
import { createActionClient } from "./supabase/server";
import { canInvite, createAdminClient } from "./supabase/admin.server";

type Client = Awaited<ReturnType<typeof createActionClient>>;
type Of<T extends Command["type"]> = Extract<Command, { type: T }>;

function fail(error: DatabaseFailure): never {
  throw new Error(frenchMessage(error));
}

// Every write below runs under RLS as the signed-in user, and the triggers of
// 0001/0002/0003 do the checking. Nothing here re-implements a rule the database
// already holds: it would only give the two a chance to disagree.
//
// Une commande peut rendre le libellé à afficher, quand le libellé fixe de
// `commandLabels` ne dirait pas ce qui s'est passé — le nombre de relancés.
export async function runCommand(session: AttachedSession, command: Command): Promise<string | void> {
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
      return writeRequirement(client, command);
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
    case "resendInvitation":
      return resendInvitation(client, command);
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
      return remindCampaign(client, command);
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
// picks the targets — active members who have not validated — and refuses a
// closed campaign or a second reminder within twelve hours. L'envoi, lui, n'est
// plus déclenché ici : les deux files se vident après chaque commande.
//
// Le compte revient à l'écran : « Relance envoyée » quand personne n'était à
// relancer laissait croire à un envoi.
async function remindCampaign(client: Client, command: Of<"remind">): Promise<string> {
  const { data, error } = await client.rpc("remind_campaign", { campaign: command.campaignId });
  if (error) fail(error);
  const sent = Number(data ?? 0);
  return sent > 0
    ? `Relance envoyée à ${sent} ${plural(sent, "agent")}`
    : "Personne à relancer : tous les agents concernés ont validé";
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

async function publishShift(client: Client, command: Of<"publish">) {
  const shiftId = await shiftIdFor(client, command.campaignId, command.date, command.shift);
  // public.publish_shift() is the only door to the private definer function,
  // which re-checks headcount, qualifications and eligibility in one transaction.
  const { error } = await client.rpc("publish_shift", { shift: shiftId });
  if (error) fail(error);
}

async function writeRequirement(client: Client, command: Of<"requirement">) {
  await writeOneRequirement(client, command);
}

/**
 * Le même besoin posé sur plusieurs créneaux.
 *
 * Une boucle d'appels, et non un seul : chaque créneau passe par la même
 * fonction, donc par les mêmes policies et le même déclencheur de vérification
 * du minimum.
 *
 * **Chaque créneau est atomique, le lot ne l'est pas.** Un refus au dixième
 * jour laisse les neuf premiers écrits — mais aucun d'eux à moitié. C'est la
 * distinction qui compte : un besoin posé est un besoin posé, jamais un besoin
 * privé de ses qualifications.
 */
async function writeRequirements(client: Client, session: AttachedSession, command: Of<"requirements">) {
  for (const date of command.dates)
    for (const shift of command.shifts)
      await writeOneRequirement(client, {
        campaignId: command.campaignId,
        date,
        shift,
        total: command.total,
        qualifications: command.qualifications,
      });
}

type RequirementWrite = {
  campaignId: string;
  date: string;
  shift: Of<"requirement">["shift"];
  total: number;
  qualifications: Record<string, number>;
};

/**
 * Un besoin écrit en une transaction.
 *
 * L'ancienne version enchaînait trois requêtes : l'effectif, l'effacement des
 * minima, puis leur réécriture. Un refus sur la dernière laissait le créneau
 * **sans aucune exigence de qualification** alors que l'appelant recevait une
 * erreur — la moitié du geste tenait, l'autre non. `set_staffing_requirement()`
 * fait les trois d'un bloc, sous les droits de l'appelant et ses policies.
 */
async function writeOneRequirement(client: Client, command: RequirementWrite) {
  const { error } = await client.rpc("set_staffing_requirement", {
    campaign: command.campaignId,
    on_date: command.date,
    shift: command.shift,
    total: command.total,
    // L'écran envoie toujours l'ensemble complet ; la fonction remplace en bloc.
    minima: Object.fromEntries(Object.entries(command.qualifications).filter(([, minimum]) => minimum > 0)),
  });
  if (error) fail(error);
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

async function openCampaign(client: Client, session: AttachedSession, command: Of<"campaign">) {
  const { organizationId, teamId } = session.membership;
  // L'équipe du formulaire, sinon celle de qui ouvre : un gestionnaire gère tout
  // son centre, et une campagne s'ouvre pour l'équipe qu'elle concerne. La base
  // vérifie que l'équipe est bien du centre — clé composée — et le droit.
  const { error } = await client.rpc("create_campaign", {
    org: organizationId,
    team: command.teamId ?? teamId,
    campaign_name: command.name,
    campaign_month: `${command.month}-01`,
    closes_on: command.closesOn,
  });
  if (error) fail(error);
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

/**
 * Une fiche d'agent écrite en une transaction.
 *
 * L'ancienne version enchaînait quatre requêtes — rattachement, profil,
 * qualifications retirées, qualifications ajoutées — et un refus au troisième
 * pas laissait une fiche à moitié modifiée alors que l'écran annonçait un
 * échec. `save_member()` fait tout d'un bloc, sous les droits de l'appelant et
 * ses policies ; l'ordre, rattachement d'abord, y est conservé pour que la
 * réactivation rende la fiche modifiable.
 */
async function writeMember(client: Client, session: AttachedSession, command: Of<"member">) {
  const { error } = await client.rpc("save_member", {
    org: session.membership.organizationId,
    member: command.userId,
    team: command.teamId,
    member_role: command.role,
    is_active: command.active,
    member_name: command.name,
    member_grade: command.grade || null,
    member_fonction: command.fonction || null,
    member_matricule: command.matricule || null,
    member_phone: command.phone || null,
    // L'écran envoie toujours l'ensemble complet ; la fonction calcule l'écart.
    qualification_names: command.qualifications,
  });
  if (error) fail(error);
}

/**
 * Envoyer l'invitation à une adresse, que le compte existe ou non.
 *
 * Trois issues, et l'appelant doit pouvoir les distinguer :
 * — le message part, l'agent choisira son mot de passe ;
 * — le compte existait déjà, le rattachement s'est fait à l'enregistrement de
 *   l'invitation (déclencheur `accept_invitation_now`), rien à envoyer ;
 * — l'envoi n'est pas configuré ou a échoué, l'invitation reste en attente et
 *   se renvoie.
 *
 * Chaque envoi est d'abord réservé en base, qui tient les limites : un quart
 * d'heure entre deux envois d'une invitation, cinq au plus, cinquante
 * invitations par heure et par centre. La réservation passe par la session de
 * l'appelant — un gestionnaire d'un autre centre n'obtient rien à envoyer.
 *
 * Et un envoi qui ne part pas est rendu : sans cela, chaque échec imposait un
 * quart d'heure annoncé comme « le message est parti », et le cinquième
 * condamnait l'invitation. Le relais intégré de Supabase n'envoie que quelques
 * messages par heure ; à l'arrivée d'un centre, c'était le cas ordinaire.
 */
async function sendInvitationEmail(
  client: Client,
  invitationId: string,
): Promise<"sent" | "exists" | "unsent" | "limited"> {
  // Avant la réservation : un envoi qui ne peut pas partir ne doit pas user
  // le quota ni imposer le quart d'heure d'attente.
  if (!canInvite()) return "unsent";
  const { data: email, error: refused } = await client.rpc("reserve_invitation_send", { invitation: invitationId });
  if (refused) fail(refused);
  if (!email) return "exists";
  const admin = createAdminClient();
  const redirectTo = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, "")}/activation` : undefined;
  const { error } = await admin.auth.admin.inviteUserByEmail(email as string, { redirectTo });
  if (!error) return "sent";

  // Rien n'est parti : la réservation est rendue, quelle que soit la raison.
  const { error: unreleased } = await admin.rpc("release_invitation_send", { invitation: invitationId });
  if (unreleased) console.error("Réservation d’envoi non rendue", unreleased.message);
  // Supabase refuse d'inviter une adresse déjà enregistrée. Ce n'est pas un
  // échec : le déclencheur a rattaché l'agent, il se connecte comme d'habitude.
  if (error.code === "email_exists" || /already been registered|already exists/i.test(error.message)) return "exists";
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    console.error(
      "Invitation non envoyée : Supabase limite les emails par heure. Branchez un SMTP (README, gabarits d’email).",
    );
    return "limited";
  }
  console.error("Invitation non envoyée", error.message);
  return "unsent";
}

// Ce que le gestionnaire lit quand le message n'est pas parti. Ni l'un ni
// l'autre n'accuse l'adresse : elle n'y est pour rien.
const LIMITED = "Supabase limite le nombre d’emails envoyés par heure : ce message n’est pas parti.";
const RETRY_LATER = "Renvoyez-la plus tard depuis la liste des invitations.";

async function writeInvitation(client: Client, session: AttachedSession, command: Of<"invite">) {
  // L'invitation enregistre qui est attendu, et c'est la base qui rattache :
  // à la confirmation d'adresse pour un compte neuf, à l'enregistrement même
  // pour un compte déjà confirmé. Une adresse non confirmée ne prend jamais de
  // place, quel que soit le chemin.
  //
  // L'équipe ne se demande plus à l'invitation, mais la colonne reste
  // obligatoire : l'invité rejoint celle de l'invitant. Un gestionnaire qui
  // veut l'affecter ailleurs le fait depuis sa fiche, une fois le compte créé.
  const { data, error } = await client
    .from("invitations")
    .insert({
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
    })
    .select("id")
    .single();
  if (error) fail(error);

  // L'écriture d'abord, l'envoi ensuite : le déclencheur d'insertion rattache
  // un agent dont le compte existe déjà, et il faut le laisser trancher avant
  // de demander à Supabase de créer un compte qu'il refusera.
  //
  // À partir d'ici, l'invitation existe : un refus de l'envoi doit le dire,
  // sinon le gestionnaire la recrée et bute sur « Cet enregistrement existe
  // déjà ».
  let outcome: Awaited<ReturnType<typeof sendInvitationEmail>>;
  try {
    outcome = await sendInvitationEmail(client, data.id as string);
  } catch (refusal) {
    throw new Error(`L’invitation est enregistrée, mais son message n’est pas parti. ${(refusal as Error).message}`);
  }
  if (outcome === "limited") throw new Error(`L’invitation est enregistrée. ${LIMITED} ${RETRY_LATER}`);
  if (outcome === "unsent")
    throw new Error(`L’invitation est enregistrée, mais le message n’a pas pu partir. ${RETRY_LATER}`);
}

/**
 * Renvoyer le message d'activation.
 *
 * L'invitation existe déjà : on ne la réécrit pas, on redemande seulement à
 * Supabase d'envoyer le lien. La réservation vérifie l'accès et les limites.
 */
async function resendInvitation(client: Client, command: Of<"resendInvitation">) {
  const outcome = await sendInvitationEmail(client, command.invitationId);
  if (outcome === "exists") throw new Error("Cette invitation n’existe plus, ou a déjà été acceptée.");
  if (outcome === "limited") throw new Error(`${LIMITED} Réessayez plus tard.`);
  if (outcome === "unsent") throw new Error("Le message n’a pas pu partir. Vérifiez la configuration de l’envoi.");
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
