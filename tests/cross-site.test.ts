import { describe, expect, it } from "vitest";
import { crossSite } from "../src/lib/cross-site";

const post = (headers: Record<string, string>) =>
  new Request("http://10.0.0.5:3000/deconnexion", { method: "POST", headers });

describe("Requête inter-sites", () => {
  it("laisse passer le formulaire de l'application", () => {
    expect(crossSite(post({ host: "disposp.example.fr", origin: "https://disposp.example.fr" }))).toBe(false);
    expect(crossSite(post({ host: "disposp.example.fr", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("lit l'hôte demandé derrière un hébergeur, pas l'adresse interne", () => {
    expect(
      crossSite(
        post({ host: "10.0.0.5:3000", "x-forwarded-host": "disposp.example.fr", origin: "https://disposp.example.fr" }),
      ),
    ).toBe(false);
  });

  it("refuse un POST venu d'un autre site", () => {
    expect(crossSite(post({ host: "disposp.example.fr", origin: "https://piege.example.com" }))).toBe(true);
    expect(crossSite(post({ host: "disposp.example.fr", "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossSite(post({ host: "disposp.example.fr", origin: "null" }))).toBe(true);
  });
});
