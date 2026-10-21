import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { feedCalendar, type CalendarFeed } from "@/lib/exports";

// « <jeton>.ics » : le jeton tiré par /api/agenda, 32 octets en base64url.
const segment = /^([A-Za-z0-9_-]{43})\.ics$/;
// Jamais dans un cache partagé : le flux est privé, et l'adresse en est la clé.
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
const notFound = () => new Response("Agenda introuvable", { status: 404, headers });

/**
 * Le flux d'un agenda abonné (lot D).
 *
 * Un logiciel d'agenda le lit sans cookie : le middleware le laisse passer, et
 * la seule preuve est le jeton de l'adresse. Il est réduit à son condensat avant
 * d'atteindre la base, qui ne connaît que lui, et n'est jamais journalisé. La
 * base vérifie à chaque lecture que l'abonnement est actif et que l'agent y a
 * toujours droit ; sinon, la réponse est la même que pour un jeton inventé.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jeton: string }> }) {
  const match = segment.exec((await params).jeton);
  if (!match) return notFound();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return new Response("Agenda indisponible", { status: 503, headers });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = createHash("sha256").update(match[1]).digest("hex");
  const { data, error } = await client.rpc("calendar_feed_events", { token_hash: tokenHash });
  if (error) {
    // Le code seulement : le message pourrait citer la requête, et elle porte le condensat.
    console.error("Agenda abonné illisible :", error.code ?? "sans code");
    return new Response("Agenda indisponible", { status: 503, headers });
  }
  if (!data) return notFound();
  return new Response(feedCalendar(data as CalendarFeed), {
    headers: {
      ...headers,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="disposp.ics"',
    },
  });
}
