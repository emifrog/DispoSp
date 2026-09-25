import { notificationLabels } from "./domain";

/** A row of the dispatch queue, as public.pending_notifications() returns it. */
export type Pending = { id: string; email: string; kind: string; subject: string; body: string | null };
export type Message = { to: string; subject: string; text: string; html: string };

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Ce que chaque message invite à faire, et l'écran où cela se fait.
 *
 * Tous, sauf la publication, portaient « Renseigner mes disponibilités » et
 * menaient à la racine : un gestionnaire prévenu d'un désistement était invité
 * à saisir ses propres disponibilités, et l'agent à qui l'on répondait aussi.
 * Un genre inconnu garde la racine, qui aiguille selon le rôle, et un appel
 * qui ne promet rien de précis.
 */
export const callsToAction: Record<string, { label: string; path: string }> = {
  CAMPAIGN_OPENED: { label: "Renseigner mes disponibilités", path: "/mes-disponibilites" },
  CAMPAIGN_REMINDER: { label: "Renseigner mes disponibilités", path: "/mes-disponibilites" },
  SCHEDULE_PUBLISHED: { label: "Consulter mon planning", path: "/mon-planning" },
  WITHDRAWAL_REQUESTED: { label: "Examiner la demande", path: "/demandes" },
  WITHDRAWAL_DECIDED: { label: "Consulter mon planning", path: "/mon-planning" },
};
const OPEN_APP = { label: "Ouvrir DispoSP", path: "" };

// Sober on purpose. An operational message is read on a phone, between two other
// things: the subject carries the news, the body says what to do, and a single
// link leads to the screen that does it. No images, no tracking, no colour.
export function message(notice: Pending, appUrl: string): Message {
  const root = appUrl.replace(/\/+$/, "");
  const kind = notificationLabels[notice.kind] ?? notice.kind;
  const body = notice.body?.trim() ?? "";
  const { label: call, path } = callsToAction[notice.kind] ?? OPEN_APP;
  const link = `${root}${path}`;
  // Sans corps, le message commence par son appel : deux lignes vides en tête
  // se lisaient comme un message tronqué.
  const text = [...(body ? [body, ""] : []), `${call} : ${link}`, "", "DispoSP"].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.55;color:#1d2a3a">`,
    // Hauteur accordée au fichier servi, 1521 × 486 : un client de messagerie
    // n'a pas de mise en page à recalculer, il prend ces deux nombres au mot.
    `<img src="${escape(root)}/logo-disposp.png" alt="DispoSP" width="132" height="42" style="display:block;margin:0 0 18px;border:0">`,
    `<p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#7186a2">${escape(kind)}</p>`,
    `<h1 style="margin:0 0 14px;font-size:18px;font-weight:600">${escape(notice.subject)}</h1>`,
    body ? `<p style="margin:0 0 18px">${escape(body)}</p>` : "",
    `<p style="margin:0 0 22px"><a href="${escape(link)}" style="color:#1668dc">${escape(call)}</a></p>`,
    `<p style="margin:0;font-size:12px;color:#7186a2">DispoSP — vous recevez ce message parce que vous êtes inscrit dans un centre.</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("");
  return { to: notice.email, subject: notice.subject, text, html };
}
