import { test, expect } from "@playwright/test";

// L'application ne tourne plus qu'en mode connecté : ces parcours demandent donc
// un projet Supabase joignable. L'intégration continue n'en a pas et les saute.
test.describe("Connexion", () => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "Demande un projet Supabase joignable.");

  test("un visiteur non authentifié est renvoyé vers la connexion", async ({ page }) => {
    await page.goto("/tableau-de-bord");
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  });

  test("les identifiants invalides remontent un message en français", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill("inconnu@example.org");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("form p[role=alert]")).toHaveText("Adresse ou mot de passe incorrect.");
  });

  test("la validation du formulaire précède tout appel réseau", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill("pas-une-adresse");
    await page.getByLabel("Mot de passe").fill("x");
    await page.getByRole("button", { name: "Se connecter" }).click();
    // Without noValidate the browser would block the submit and show its own
    // message, in its own language, never this one.
    await expect(page.getByText("Saisissez une adresse électronique valide.")).toBeVisible();
  });

  test("la déconnexion reste accessible sans session", async ({ page }) => {
    // The guard must not intercept it, or signing out could never run.
    const response = await page.request.post("/deconnexion", { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()["location"]).toContain("/connexion");
  });
});
