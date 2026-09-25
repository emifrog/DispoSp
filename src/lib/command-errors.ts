import { plural } from "./domain";

/** A PostgREST or RPC failure, reduced to the two fields worth reading. */
export type DatabaseFailure = { message?: string | null; code?: string | null };

// The database raises in English on purpose: those messages are a contract
// between the migrations and their tests, not user-facing copy. Translating here
// keeps the contract intact and still shows an agent something actionable.
const byMessage: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Not allowed to create this campaign/, () => "Vous n’avez pas le droit de créer une campagne pour cette équipe."],
  [/^Campaign name is too short/, () => "Le nom de la campagne doit contenir au moins trois caractères."],
  // L'index unique de 20260924090000 : PostgreSQL le nomme dans son refus.
  [
    /availability_campaigns_team_month_key/,
    () => "Une campagne existe déjà pour ce mois et cette équipe. Choisissez un autre mois.",
  ],
  [/^Campaign month must start on the first day/, () => "Choisissez un mois valide pour la campagne."],
  [/^Campaign closing date must be in the future/, () => "La date de clôture de la campagne doit être à venir."],
  [
    /^Not allowed to write this template/,
    () => "Vous ne pouvez enregistrer que votre propre disponibilité habituelle.",
  ],
  [/^Not allowed to apply a template to this campaign/, () => "Cette campagne ne vous est pas accessible."],
  [/^Not a participant of this campaign/, () => "Vous ne participez pas à cette campagne."],
  [/^Availability template is empty/, () => "Votre disponibilité habituelle est vide : renseignez-la d’abord."],
  [/^Campaign is closed/, () => "La campagne est fermée : la saisie n’est plus possible."],
  [/^Date outside campaign/, () => "Cette date ne fait pas partie de la campagne."],
  [/^Availability identity is immutable/, () => "Une disponibilité ne peut changer ni de date ni d’agent."],
  [/^Complete all dates before validation/, () => "Renseignez chaque jour du mois avant de valider votre réponse."],
  [
    /^Qualification minimum exceeds the required headcount/,
    () => "Un minimum par qualification ne peut pas dépasser l’effectif requis.",
  ],
  [/^Unknown shift/, () => "Ce créneau n’existe pas."],
  [/^Not allowed to publish this schedule/, () => "Vous n’avez pas le droit de publier ce planning."],
  [
    /^Every assignment needs a validated matching availability/,
    () => "Chaque agent affecté doit avoir une disponibilité validée correspondant à ce créneau.",
  ],
  [
    /^Define the staffing requirement before publishing/,
    () => "Définissez les besoins de ce créneau avant de publier.",
  ],
  [
    /^Headcount not covered: (\d+) of (\d+)/,
    m =>
      `Effectif non couvert : ${m[1]} ${plural(Number(m[1]), "agent")} ${plural(Number(m[1]), "affecté")} sur ${m[2]} requis.`,
  ],
  [/^Qualifications not covered: (.+)$/, m => `Qualifications non couvertes : ${m[1]}.`],
  // Les refus du déclencheur de rattachement (0004 et 22 septembre).
  [/^Only an administrator can change a role/, () => "Seul un administrateur peut changer un rôle."],
  [/^Cannot change your own role/, () => "Personne ne change son propre rôle."],
  [/^Cannot deactivate your own account/, () => "Vous ne pouvez pas désactiver votre propre compte."],
  [
    /^Only an administrator can deactivate an administrator/,
    () => "Seul un administrateur peut désactiver ou rétrograder un administrateur.",
  ],
  [
    /^Cannot remove the last administrator/,
    () => "Ce compte est le dernier administrateur actif du centre : nommez-en un autre avant de le retirer.",
  ],
  [/^Not allowed to edit this member/, () => "Vous n’avez pas le droit de modifier cette fiche."],
  // Publication : ce que 20260921090000 ajoute aux contrôles de couverture.
  [
    /^Inactive members cannot be published: (.+)$/,
    m => `Ce brouillon retient un agent désactivé : ${m[1]}. Retirez-le avant de publier.`,
  ],
  [
    /^Accepted withdrawal still assigned: (.+)$/,
    m => `Un désistement accepté n’a pas été retiré du brouillon : ${m[1]}. Remplacez-le avant de publier.`,
  ],
  // Rappel, besoins, modèle, invitation.
  [/^Not allowed to remind this campaign/, () => "Vous n’avez pas le droit de relancer cette campagne."],
  // Les limites d'envoi (23 septembre).
  [
    /^Campaign reminded too recently/,
    () => "Un rappel est déjà parti pour cette campagne il y a moins de douze heures.",
  ],
  [/^Unknown invitation/, () => "Cette invitation n’existe plus, ou ne vous est pas accessible."],
  [/^Cannot remind a closed campaign/, () => "Cette campagne est close : il n’y a plus de réponse à relancer."],
  // Les limites portent sur l'adresse, pas sur l'invitation : effacer puis
  // refaire l'invitation n'y change rien, et le message ne le suggère plus.
  [
    /^Invitation sent too recently/,
    () => "Un message est parti vers cette adresse il y a moins d’un quart d’heure : laissez-lui le temps d’arriver.",
  ],
  [
    /^Invitation send limit reached/,
    () => "Cette adresse a déjà reçu cinq invitations en vingt-quatre heures. Vérifiez-la, puis réessayez demain.",
  ],
  [
    /^Too many invitations sent/,
    () => "Cinquante invitations sont déjà parties dans l’heure pour ce centre. Réessayez un peu plus tard.",
  ],
  [/^Unknown campaign/, () => "Cette campagne n’existe pas, ou ne vous est pas accessible."],
  [
    /^Template must be an object keyed by weekday/,
    () => "La disponibilité habituelle envoyée est mal formée. Rechargez l’écran et recommencez.",
  ],
  // Volontairement vague : dire « actif dans un autre centre » apprenait à un
  // gestionnaire l'existence d'un compte hors de son périmètre (RGPD, 23 sept.).
  [
    /^Account already belongs to another organisation/,
    () => "Cette adresse ne peut pas être invitée ici. Vérifiez-la, ou voyez avec l’administrateur de DispoSP.",
  ],
  // Déjà en français dans la base : les fonctions Web Push parlent à l'agent.
  [/^Aucune session ouverte/, () => "Votre session a expiré. Reconnectez-vous."],
  [/^Compte rattaché à aucun centre actif/, () => "Votre compte n’est rattaché à aucun centre actif."],
  // Les besoins (25 septembre) : l'effectif et les minima se gardent l'un l'autre.
  [
    /^Headcount is below a qualification minimum/,
    () => "L’effectif requis ne peut pas descendre sous un minimum par qualification. Baissez d’abord ce minimum.",
  ],
  [/^Qualification name is empty/, () => "Une qualification sans nom ne peut pas être exigée."],
];

const byCode: Record<string, string> = {
  "42501": "Vous n’avez pas le droit d’effectuer cette modification.",
  "23505": "Cet enregistrement existe déjà.",
  "23503": "Un élément lié est introuvable.",
  "23514": "Une valeur saisie sort des limites autorisées.",
  PGRST301: "Votre session a expiré. Reconnectez-vous.",
};

export function frenchMessage(failure: DatabaseFailure | null | undefined): string {
  const raw = failure?.message ?? "";
  for (const [pattern, build] of byMessage) {
    const match = raw.match(pattern);
    if (match) return build(match);
  }
  const known = failure?.code ? byCode[failure.code] : undefined;
  if (known) return known;
  // A raw database message is English and describes the schema: never show it.
  return "La modification n’a pas pu être enregistrée. Réessayez dans un instant.";
}
