import { test, expect } from "@playwright/test";

// Toutes les pages portaient le même titre : les onglets, l'historique du
// navigateur et le lecteur d'écran à l'arrivée ne disaient pas laquelle était
// ouverte. Chaque page donne désormais son nom, suivi de celui de
// l'application. Les pages publiques se vérifient sans session.
const PUBLIC: [string, string][] = [
  ["/connexion", "Connexion · DispoSP"],
  ["/hors-ligne", "Hors ligne · DispoSP"],
  ["/nouveau-mot-de-passe", "Nouveau mot de passe · DispoSP"],
  ["/activation", "Activer mon compte · DispoSP"],
  ["/confirmer", "Continuer depuis le lien reçu · DispoSP"],
];

test.describe("Titres de page", () => {
  for (const [route, title] of PUBLIC)
    test(`${route} porte son propre titre`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveTitle(title);
    });

  // Les écrans de travail, dès qu'un compte d'essai est fourni. Seuls ceux que
  // tout rôle peut ouvrir : un agent serait renvoyé des autres.
  test("les écrans personnels portent chacun leur titre", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
    for (const [route, title] of [
      ["/accueil", "Accueil · DispoSP"],
      ["/mes-disponibilites", "Mes disponibilités · DispoSP"],
      ["/mon-planning", "Mon planning · DispoSP"],
      ["/notifications", "Notifications · DispoSP"],
      ["/profil", "Mon profil · DispoSP"],
    ]) {
      await page.goto(route);
      await expect(page, route).toHaveTitle(title);
    }
  });
});
