import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sampleState } from "./fixtures/centre";

// L'export Excel : la campagne demandée, ou rien. Vu en production : un
// identifiant inconnu rendait 200 et le fichier d'un autre mois.
const { readSession, loadState } = vi.hoisted(() => ({ readSession: vi.fn(), loadState: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/session.server", () => ({ readSession }));
vi.mock("../src/lib/data.server", () => ({ loadState }));
import { GET } from "../src/app/api/export/route";

const now = new Date("2026-09-18T10:00:00Z");
const ask = (query = "") => new NextRequest(new URL(`http://127.0.0.1:3000/api/export${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  readSession.mockResolvedValue({ userId: "julien", membership: { organizationId: "centre" } });
  loadState.mockResolvedValue(sampleState(now));
});

describe("Export Excel", () => {
  it("répond 404 pour une campagne inconnue, au lieu d’exporter une autre", async () => {
    const response = await GET(ask("?campagne=40000000-0000-0000-0000-00000000dead"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("exporte la campagne demandée", async () => {
    const [campaign] = sampleState(now).campaigns;
    const response = await GET(ask(`?campagne=${campaign.id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(`disposp-${campaign.month}.xlsx`);
  });

  it("garde un repli quand l’adresse ne nomme aucune campagne", async () => {
    const response = await GET(ask());
    expect(response.status).toBe(200);
  });
});
