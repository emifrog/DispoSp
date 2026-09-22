import { test, expect } from "@playwright/test";

// La campagne choisie vit dans l'adresse. Sans cela, chaque rechargement —
// connexion, lancement depuis l'écran d'accueil, bulle de notification —
// retombait sur la première de la liste, c'est-à-dire la plus ancienne du
// centre, et l'agent saisissait dans le mauvais mois.
test.describe("Campagne choisie", () => {
  test("l’adresse porte la campagne, sur chaque écran et après rechargement", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));

    // À l'arrivée, l'adresse dit déjà quelle campagne est ouverte.
    await expect(page).toHaveURL(/[?&]campagne=/);
    const selector = page.getByLabel("Campagne active");
    const chosen = await selector.inputValue();
    expect(new URL(page.url()).searchParams.get("campagne")).toBe(chosen);

    // Les liens internes ne la portent pas : l'adresse la reprend quand même.
    await page.goto("/mon-planning");
    await expect(page).toHaveURL(new RegExp(`campagne=${chosen}`));

    // Une autre campagne, si le centre en a plusieurs, puis un rechargement :
    // c'est elle qui revient, pas la première de la liste.
    const options = await selector.locator("option").evaluateAll(all => all.map(o => (o as HTMLOptionElement).value));
    const other = options.find(id => id !== chosen);
    if (other) {
      await selector.selectOption(other);
      await expect(page).toHaveURL(new RegExp(`campagne=${other}`));
      await page.reload();
      await expect(page.getByLabel("Campagne active")).toHaveValue(other);
    }
  });
});
