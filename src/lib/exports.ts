import { fromZonedTime } from "date-fns-tz";
import {
  type AppState,
  type Campaign,
  auditFamilies,
  entryKey,
  labels,
  localDate,
  localTime,
  monthDays,
  publishedShiftsOf,
  relievedFrom,
  shiftKey,
  type Shift,
} from "./domain";

// Une cellule qui commence par = ou + est une formule pour un tableur, d'où
// qu'elle vienne — un commentaire d'agent comme une ligne de journal.
const escape = (s: string) => `"${(/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;

export function availabilityCsv(state: AppState, campaign: Campaign) {
  const days = monthDays(campaign.month);
  return (
    "\uFEFF" +
    [
      ["Agent", "Équipe", ...days],
      ...state.agents.map(a => [
        a.name,
        a.team,
        ...days.map(d => {
          const v = state.entries[entryKey(campaign.id, a.id, d)];
          return v ? labels[v.type].label : "Non renseigné";
        }),
      ]),
    ]
      .map(row => row.map(escape).join(";"))
      .join("\r\n")
  );
}
// Un journal se relit hors de l'application : commission, contrôle, archive. Les
// colonnes sont celles de l'écran, dans l'ordre où il les montre, et la date est
// séparée de l'heure pour que le tri d'un tableur reste chronologique.
export function auditCsv(events: AppState["audit"]) {
  return (
    "\uFEFF" +
    [
      ["Date", "Heure", "Auteur", "Action", "Détail", "Sujet"],
      ...events.map(event => {
        const at = new Date(event.at);
        return [
          localDate(at),
          localTime(at),
          event.actor,
          event.action,
          event.detail,
          auditFamilies.find(family => (family.entities as readonly string[]).includes(event.entity))?.label ?? "",
        ];
      }),
    ]
      .map(row => row.map(escape).join(";"))
      .join("\r\n")
  );
}
/**
 * Un instant au format iCalendar (RFC 5545 §3.3.5) : `AAAAMMJJTHHMMSSZ`, en UTC,
 * sans fraction de seconde ni décalage.
 *
 * Toujours à partir d'une vraie date. `DTSTAMP` retouchait jusqu'ici le texte
 * reçu de la base en supposant la forme `.123Z` ; PostgREST rend
 * `2026-09-20T08:00:00.123456+00:00`, et le fichier portait
 * `DTSTAMP:20260920T080000.123456+0000`, hors norme sur une propriété
 * obligatoire — de quoi faire refuser l'import par un agenda strict.
 */
const icsInstant = (instant: Date) =>
  instant
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

/**
 * Replie une ligne à 75 octets (RFC 5545 §3.1) : la suite repart sur une ligne
 * qui commence par une espace. Compté en octets UTF-8, pas en caractères — un
 * « é » en vaut deux —, et sans jamais couper un caractère en deux.
 */
function fold(line: string) {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      // L'espace de tête d'une ligne de suite compte dans ses 75 octets.
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const utc = (date: string, hour: number) =>
  icsInstant(fromZonedTime(`${date}T${String(hour).padStart(2, "0")}:00:00`, "Europe/Paris"));

/** Une garde publiée, en événement. Ses horaires viennent de sa campagne. */
function shiftEvent(
  campaign: Pick<Campaign, "id" | "dayStart" | "nightStart">,
  day: string,
  shift: Shift,
  published: { revision: number; publishedAt: string },
  userId: string,
) {
  const tomorrow = new Date(`${day}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return [
    "BEGIN:VEVENT",
    `UID:${shiftKey(campaign.id, day, shift).replaceAll("/", "-")}-${userId}@disposp.local`,
    `SEQUENCE:${published.revision}`,
    `DTSTAMP:${icsInstant(new Date(published.publishedAt))}`,
    `DTSTART:${utc(day, shift === "DAY" ? campaign.dayStart : campaign.nightStart)}`,
    `DTEND:${utc(shift === "DAY" ? day : tomorrow.toISOString().slice(0, 10), shift === "DAY" ? campaign.nightStart : campaign.dayStart)}`,
    `SUMMARY:Garde ${shift === "DAY" ? "de jour" : "de nuit"} - DispoSP`,
    "END:VEVENT",
  ];
}

const calendar = (events: string[][]) =>
  [
    ...[
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//DispoSP//Planning//FR",
      "CALSCALE:GREGORIAN",
      ...events.flat(),
    ].map(fold),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

/**
 * L'agenda d'une campagne. Une garde dont le désistement a été accepté n'y est
 * plus : l'agent l'importait dans son téléphone après qu'on lui eut répondu
 * qu'il n'était plus attendu.
 */
export function personalCalendar(state: AppState, campaign: Campaign, userId: string) {
  const events: string[][] = [];
  for (const day of monthDays(campaign.month))
    for (const shift of ["DAY", "NIGHT"] as const) {
      const published = state.publications[shiftKey(campaign.id, day, shift)];
      if (!published?.agents.includes(userId)) continue;
      if (relievedFrom(state, userId, campaign.id, day, shift, published.publishedAt)) continue;
      events.push(shiftEvent(campaign, day, shift, published, userId));
    }
  return calendar(events);
}

/**
 * L'agenda des gardes à venir, toutes campagnes chargées confondues.
 *
 * Celui d'une campagne ne suffit pas : la campagne ouverte par défaut est
 * celle qui attend une réponse — le mois suivant —, et l'agent de garde
 * demain n'y trouvait rien à importer. Mêmes règles que `personalCalendar` :
 * le publié seulement, sans les gardes dont le désistement est accepté.
 */
export function upcomingCalendar(state: AppState, userId: string, today = localDate()): string {
  return calendar(
    publishedShiftsOf(state, userId)
      .filter(s => s.date >= today)
      .map(s => shiftEvent(s.campaign, s.date, s.shift, s, userId)),
  );
}
export function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
