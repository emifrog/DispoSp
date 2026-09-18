import { fromZonedTime } from "date-fns-tz";
import {
  type AppState,
  type Campaign,
  auditFamilies,
  entryKey,
  labels,
  localDate,
  monthDays,
  shiftKey,
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
          at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
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
export function personalCalendar(state: AppState, campaign: Campaign, userId: string) {
  const utc = (date: string, hour: number) =>
    fromZonedTime(`${date}T${String(hour).padStart(2, "0")}:00:00`, "Europe/Paris")
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DISPO SP//Planning//FR", "CALSCALE:GREGORIAN"];
  for (const day of monthDays(campaign.month))
    for (const shift of ["DAY", "NIGHT"] as const) {
      const key = shiftKey(campaign.id, day, shift);
      const published = state.publications[key];
      if (!published?.agents.includes(userId)) continue;
      const tomorrow = new Date(`${day}T12:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${key.replaceAll("/", "-")}-${userId}@disposp.local`,
        `SEQUENCE:${published.revision}`,
        `DTSTAMP:${published.publishedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
        `DTSTART:${utc(day, shift === "DAY" ? campaign.dayStart : campaign.nightStart)}`,
        `DTEND:${utc(shift === "DAY" ? day : tomorrow.toISOString().slice(0, 10), shift === "DAY" ? campaign.nightStart : campaign.dayStart)}`,
        `SUMMARY:Garde ${shift === "DAY" ? "de jour" : "de nuit"} - DISPO SP`,
        "END:VEVENT",
      );
    }
  return [...lines, "END:VCALENDAR", ""].join("\r\n");
}
export function download(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
