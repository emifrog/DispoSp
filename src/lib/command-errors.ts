import { plural } from "./domain";

/** A PostgREST or RPC failure, reduced to the two fields worth reading. */
export type DatabaseFailure = { message?: string | null; code?: string | null };

// The database raises in English on purpose: those messages are a contract
// between the migrations and their tests, not user-facing copy. Translating here
// keeps the contract intact and still shows an agent something actionable.
const byMessage: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^Not allowed to create this campaign/, () => "Vous n’avez pas le droit de créer une campagne pour cette équipe."],
  [/^Campaign name is too short/, () => "Le nom de la campagne doit contenir au moins trois caractères."],
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
