import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Lot D : l'agenda abonné. Le flux se lit sans session, sur le seul jeton de
// l'adresse, réduit à son condensat avant d'atteindre la base ; l'agent crée et
// révoque son adresse sous sa session.
const { rpc, readSession, actionRpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
  readSession: vi.fn(),
  actionRpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/supabase/server", () => ({ createActionClient: async () => ({ rpc: actionRpc }) }));
import { GET as feed } from "../src/app/api/agenda/[jeton]/route";
import { DELETE as revoke, POST as subscribe } from "../src/app/api/agenda/route";
import { feedCalendar, type CalendarFeed } from "../src/lib/exports";
import { calendarFeedPath } from "../src/lib/supabase/config";

const TOKEN = "A".repeat(20) + "_-" + "b".repeat(21);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const read = (segment: string) =>
  feed(new Request(`http://127.0.0.1:3000/api/agenda/${segment}`), { params: Promise.resolve({ jeton: segment }) });
const sample: CalendarFeed = {
  user_id: "u1",
  centre: "CIS Nord, Alpha",
  events: [
    {
      campaign_id: "c1",
      date: "2026-11-03",
      shift: "NIGHT",
      day_start: 8,
      night_start: 20,
      revision: 2,
      published_at: "2026-10-20T08:00:00Z",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_essai");
  readSession.mockResolvedValue({ userId: "agent", membership: { organizationId: "centre" } });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Flux d’un agenda abonné", () => {
  it("rend les gardes au format iCalendar, sur le seul condensat du jeton", async () => {
    rpc.mockResolvedValue({ data: sample, error: null });
    const response = await read(`${TOKEN}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("calendar_feed_events", { token_hash: sha256(TOKEN) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(TOKEN);
    const body = await response.text();
    expect(body).toContain("UID:c1-2026-11-03-NIGHT-u1@disposp.local");
    expect(body).not.toContain("VALARM");
  });

  it("ne dit rien d’un jeton mal formé, inconnu ou révoqué, et ne journalise jamais le jeton", async () => {
    for (const segment of ["court.ics", `${TOKEN}.txt`, `${TOKEN}`]) expect((await read(segment)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    const unknown = await read(`${TOKEN}.ics`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("Agenda introuvable");
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: `timeout ${sha256(TOKEN)}` } });
    expect((await read(`${TOKEN}.ics`)).status).toBe(503);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(new RegExp(`${TOKEN}|${sha256(TOKEN)}`));
  });

  it("est la seule adresse d’agenda que le middleware laisse passer sans session", () => {
    expect(calendarFeedPath.test(`/api/agenda/${TOKEN}.ics`)).toBe(true);
    for (const path of [
      "/api/agenda",
      "/api/agenda/court.ics",
      `/api/agenda/${TOKEN}.ics/x`,
      `/api/autre/${TOKEN}.ics`,
    ])
      expect(calendarFeedPath.test(path), path).toBe(false);
  });
});

describe("Adresse d’abonnement de l’agent", () => {
  const post = (headers: Record<string, string> = {}) =>
    subscribe(
      new Request("http://127.0.0.1:3000/api/agenda", {
        method: "POST",
        headers: { host: "127.0.0.1:3000", ...headers },
      }),
    );

  it("tire un jeton, n’envoie que son condensat, et rend l’adresse une seule fois", async () => {
    actionRpc.mockResolvedValue({ data: "2026-10-21T10:00:00Z", error: null });
    const response = await post({ origin: "http://127.0.0.1:3000" });
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const token = /\/api\/agenda\/([A-Za-z0-9_-]{43})\.ics$/.exec(url)?.[1];
    expect(token).toBeDefined();
    expect(actionRpc).toHaveBeenCalledExactlyOnceWith("create_calendar_feed", { token_hash: sha256(token!) });
    expect(calendarFeedPath.test(new URL(url).pathname)).toBe(true);
  });

  it("refuse une demande venue d’un autre site, ou sans session", async () => {
    expect((await post({ origin: "https://piege.example.com", "sec-fetch-site": "cross-site" })).status).toBe(403);
    readSession.mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    expect(actionRpc).not.toHaveBeenCalled();
  });

  it("dit en français qu’un gestionnaire ne s’abonne pas", async () => {
    actionRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Not allowed to subscribe to a calendar" },
    });
    const response = await post();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      message: "Seuls les agents qui prennent des gardes peuvent s’abonner à leur agenda.",
    });
  });

  it("révoque l’abonnement", async () => {
    actionRpc.mockResolvedValue({ data: null, error: null });
    const response = await revoke(
      new Request("http://127.0.0.1:3000/api/agenda", { method: "DELETE", headers: { host: "127.0.0.1:3000" } }),
    );
    expect(response.status).toBe(204);
    expect(actionRpc).toHaveBeenCalledExactlyOnceWith("revoke_calendar_feed");
  });
});

describe("Contenu du flux", () => {
  it("garde l’identifiant de l’export, la révision pour séquence, et la nuit jusqu’au lendemain", () => {
    const ics = feedCalendar(sample);
    expect(ics).toContain("SEQUENCE:2");
    // 20 h à Paris le 3 novembre, 8 h le 4 : heure d'hiver.
    expect(ics).toContain("DTSTART:20261103T190000Z");
    expect(ics).toContain("DTEND:20261104T070000Z");
    // Le nom du centre est échappé : une virgule couperait la valeur.
    expect(ics).toContain("X-WR-CALNAME:DispoSP — mes gardes (CIS Nord\\, Alpha)");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("rend un agenda vide, valide, quand rien n’est publié", () => {
    const ics = feedCalendar({ ...sample, events: [] });
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });
});
