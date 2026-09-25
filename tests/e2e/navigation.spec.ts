import { test, expect, type Page } from "@playwright/test";

// Deux défauts de l'analyse du 25 septembre qui demandent une session :
// `aria-current` n'était posé que sur le menu principal, et un agent qui
// tapait l'adresse d'un écran d'encadrement le recevait du serveur, que le
// navigateur masquait ensuite — seul le tableau de bord le renvoyait.

const MANAGER_SCREENS = [
  "/tableau-de-bord",
  "/disponibilites",
  "/planning",
  "/campagnes",
  "/besoins",
  "/agents",
  "/demandes",
  "/statistiques",
  "/historique",
  "/parametres",
];

async function signIn(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
  await page.goto("/connexion");
  await page.getByLabel("Adresse électronique").fill(email!);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
  // Le rôle du compte d'essai n'est pas fixé : l'étiquette du bandeau le dit.
  return ((await page.locator(".role-tag").first().textContent()) ?? "").replace("Rôle :", "").trim();
}

test.describe("Navigation", () => {
  test("un agent est renvoyé des écrans d’encadrement par le serveur", async ({ page }) => {
    const role = await signIn(page);
    test.skip(role !== "Agent", "Demande un compte d’essai de rôle agent.");
    for (const route of MANAGER_SCREENS) {
      // Le garde du navigateur, lui, ne renvoie nulle part : il remplace
      // l'écran par « Espace encadrement » et laisse l'adresse. Arriver sur
      // l'accueil, c'est donc le renvoi du serveur — en tête HTTP, ou dans le
      // flux quand la page avait commencé d'être envoyée.
      await page.goto(route);
      await expect(page, route).toHaveURL(/\/accueil(\?|$)/);
    }
  });

  test("le lien de la page ouverte porte aria-current, dans chaque menu", async ({ page, isMobile }) => {
    const role = await signIn(page);
    const manages = role !== "Agent";
    const home = manages ? "/tableau-de-bord" : "/accueil";
    await page.goto(home);
    // La barre du bas sur téléphone, la barre latérale ailleurs.
    const menu = isMobile ? "Navigation mobile" : "Navigation principale";
    const current = page.getByRole("navigation", { name: menu }).locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", new RegExp(`^${home}`));

    // La cloche, sur la page des notifications.
    await page.goto("/notifications");
    await expect(page.locator(".bell")).toHaveAttribute("aria-current", "page");

    // Les liens d'administration, pour qui administre.
    if (manages && !isMobile) {
      await page.goto("/historique");
      const admin = page.getByRole("navigation", { name: "Administration" });
      if (await admin.count()) {
        await expect(admin.locator('[aria-current="page"]')).toHaveAttribute("href", /^\/historique/);
      }
    }
  });
});
