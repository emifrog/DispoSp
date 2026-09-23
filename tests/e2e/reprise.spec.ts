import { test, expect, type Page } from "@playwright/test";

// Une application installée reste ouverte des jours sur un téléphone. Revenue
// au premier plan après une vraie absence, elle relit l'état — données du
// moment, et nouvelle version si elle a été déployée entre-temps. Un aller-retour
// bref vers une autre application ne relit rien.
const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate(value => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

test.describe("Retour au premier plan", () => {
  test("relit l’état après une vraie absence, pas après un aller-retour bref", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    // Le temps de l'application se commande d'ici : on n'attend pas une minute.
    await page.clock.install();
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
    await page.waitForLoadState("networkidle");

    // Les relectures : une requête du routeur qui n'est pas un préchargement.
    const rereads: string[] = [];
    page.on("request", request => {
      const headers = request.headers();
      if (headers["rsc"] === "1" && !headers["next-router-prefetch"]) rereads.push(request.url());
    });

    await setVisibility(page, "hidden");
    await page.clock.fastForward(10_000);
    await setVisibility(page, "visible");
    await page.waitForTimeout(1500);
    expect(rereads, "un aller-retour de dix secondes").toEqual([]);

    await setVisibility(page, "hidden");
    await page.clock.fastForward(60_000);
    await setVisibility(page, "visible");
    await expect.poll(() => rereads.length, { message: "une absence d’une minute" }).toBeGreaterThan(0);
  });
});
