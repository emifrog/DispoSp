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

  // Deux relais : chacun ajoute son hôte, le premier est celui du navigateur.
  it("ne retient que la première valeur de x-forwarded-host, comme Next", () => {
    const behind = (origin: string) =>
      post({ host: "10.0.0.5:3000", "x-forwarded-host": "disposp.sdis.fr, disposp-interne:3000", origin });
    expect(crossSite(behind("https://disposp.sdis.fr"))).toBe(false);
    expect(crossSite(behind("https://piege.example.com"))).toBe(true);
    expect(crossSite(behind("http://disposp-interne:3000"))).toBe(true);
  });

  it("refuse un POST venu d'un autre site", () => {
    expect(crossSite(post({ host: "disposp.example.fr", origin: "https://piege.example.com" }))).toBe(true);
    expect(crossSite(post({ host: "disposp.example.fr", "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossSite(post({ host: "disposp.example.fr", origin: "null" }))).toBe(true);
  });
});
