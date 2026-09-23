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
    // Exact : le bouton d'affichage du mot de passe s'appelle « Afficher le mot
    // de passe », et une correspondance par sous-chaîne attraperait les deux.
    await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("form p[role=alert]")).toHaveText("Adresse ou mot de passe incorrect.");
  });

  test("la validation du formulaire précède tout appel réseau", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill("pas-une-adresse");
    await page.getByLabel("Mot de passe", { exact: true }).fill("x");
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

/**
 * Le lien mort, et ce que l'écran en dit.
 *
 * Hors du groupe ci-dessus : ce parcours ne demande aucune base. C'est la
 * surface publique, celle que l'intégration continue vérifie pour de bon.
 */
test.describe("Lien d’activation ou de réinitialisation périmé", () => {
  test("l’écran de connexion explique pourquoi on vient d’y atterrir", async ({ page }) => {
    await page.goto("/connexion?lien=expire");
    const message = page.getByRole("status");
    await expect(message).toBeVisible();
    await expect(message).toContainText("Ce lien n’est plus valable");
    // Les deux chemins de renvoi, parce qu'on arrive ici par les deux : un
    // agent invité n'a pas de mot de passe à réinitialiser, et l'écran ne doit
    // pas l'y envoyer sans nuance.
    await expect(message).toContainText("Mot de passe oublié");
    await expect(message).toContainText("gestionnaire");
  });

  // B1 de l'analyse du 23 septembre : ouvrir le lien ne le consomme pas — une
  // messagerie qui l'analyse avant l'agent ne le brûle plus. Seul le bouton le
  // vérifie.
  test("ouvrir un lien d’activation demande de continuer, sans rien vérifier", async ({ page }) => {
    await page.goto("/auth/activation?token_hash=jeton-de-test&type=invite");
    await expect(page).toHaveURL(/\/confirmer\?type=invite&token_hash=jeton-de-test$/);
    await expect(page.getByRole("heading", { name: "Activer mon compte" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuer" })).toBeVisible();
  });

  test("continuer avec un jeton mort ramène à la connexion, qui l’explique", async ({ page }) => {
    test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, "Demande un projet Supabase joignable.");
    await page.goto("/auth/recuperation?token_hash=jeton-inconnu&type=recovery");
    await expect(page.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page).toHaveURL(/\/connexion\?lien=expire$/);
    await expect(page.getByRole("status")).toContainText("Ce lien n’est plus valable");
  });

  test("n’invente rien quand l’adresse ne porte pas de motif connu", async ({ page }) => {
    // Ce qui vient de l'adresse ne s'affiche jamais tel quel : un paramètre
    // fabriqué ne doit pas devenir un message signé DispoSP.
    await page.goto("/connexion?lien=%3Cimg%20src=x%20onerror=alert(1)%3E");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  });
});
