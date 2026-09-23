import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { forwardCampaign } from "../src/lib/campaign-header";
import { CAMPAIGN_HEADER } from "../src/lib/campaign-param";

const id = "40000000-0000-0000-0000-0000000000a1";
const ask = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`http://127.0.0.1:3000${path}`), { headers });

describe("Relais de la campagne demandée", () => {
  it("recopie le paramètre d’adresse dans l’en-tête que lit la mise en page", () => {
    expect(forwardCampaign(ask(`/planning?campagne=${id}`)).headers.get(CAMPAIGN_HEADER)).toBe(id);
  });

  it("écarte un en-tête envoyé par le navigateur", () => {
    expect(forwardCampaign(ask("/planning", { [CAMPAIGN_HEADER]: id })).headers.get(CAMPAIGN_HEADER)).toBeNull();
    const other = "40000000-0000-0000-0000-0000000000a2";
    expect(
      forwardCampaign(ask(`/planning?campagne=${id}`, { [CAMPAIGN_HEADER]: other })).headers.get(CAMPAIGN_HEADER),
    ).toBe(id);
  });

  it("ignore un paramètre qui n’est pas un identifiant", () => {
    expect(forwardCampaign(ask("/planning?campagne=n'importe%20quoi")).headers.get(CAMPAIGN_HEADER)).toBeNull();
  });

  it("garde le reste de la requête : chemin et cookies", () => {
    const forwarded = forwardCampaign(ask(`/planning?campagne=${id}`, { cookie: "sb=jeton" }));
    expect(forwarded.nextUrl.pathname).toBe("/planning");
    expect(forwarded.cookies.get("sb")?.value).toBe("jeton");
  });
});
