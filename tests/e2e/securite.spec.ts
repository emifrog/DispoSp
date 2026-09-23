import { test, expect } from "@playwright/test";

// Point 6 de l'audit de déployabilité. Une politique de sécurité trop stricte ne
// fait échouer aucun build : elle bloque des scripts en silence, et
// l'application cesse de répondre. Ces tests chargent les pages publiques —
// prérendues comme dynamiques — et exigent qu'aucune violation ne soit levée.
test.describe("En-têtes de sécurité", () => {
  test("chaque réponse porte la politique de contenu et HSTS", async ({ request }) => {
    const headers = (await request.get("/connexion")).headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
  });

  for (const path of ["/connexion", "/hors-ligne", "/nouveau-mot-de-passe", "/confirmer?type=invite&token_hash=x"])
    test(`${path} se charge sans violation de la politique de contenu`, async ({ page }) => {
      const violations: string[] = [];
      page.on("console", message => {
        if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
      });
      await page.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", event =>
          console.error(`Refused to load: ${event.violatedDirective} ${event.blockedURI}`),
        ),
      );
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(violations).toEqual([]);
    });

  test("la déconnexion refuse un formulaire posté depuis un autre site", async ({ request }) => {
    const response = await request.post("/deconnexion", {
      headers: { origin: "https://piege.example.com" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });
});
