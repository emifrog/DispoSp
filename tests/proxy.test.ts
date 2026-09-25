import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../src/proxy";

// Le motif du proxy, compilé par Next lui-même. Un test qui relirait la chaîne
// à la main aurait laissé passer l'erreur d'origine : `\.` dans une chaîne
// JavaScript vaut `.`, et c'est ce que Next reçoit.
const guarded = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe("Motif du proxy", () => {
  it("garde les écrans et les routes", () => {
    for (const url of ["/", "/tableau-de-bord", "/accueil", "/api/export", "/api/push/subscribe", "/connexion"])
      expect(guarded(url), url).toBe(true);
  });

  it("garde un chemin qui finit par « png » ou « ico » sans point devant", () => {
    expect(guarded("/tableau-de-bordpng")).toBe(true);
    expect(guarded("/mon-planningico")).toBe(true);
    expect(guarded("/faviconxico")).toBe(true);
  });

  it("laisse passer les fichiers statiques", () => {
    for (const url of ["/logo-disposp.png", "/icons/icon-192.png", "/favicon.ico", "/_next/static/chunks/app.js"])
      expect(guarded(url), url).toBe(false);
  });
});
