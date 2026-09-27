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

const signIn = async (page: Page) => {
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
};

/**
 * Une relecture complète — `router.refresh()` — marque la racine de l'arbre
 * qu'elle envoie ; une navigation ne marque que le segment qui change, sous le
 * layout (createDynamicRequestTree, dans
 * node_modules/next/dist/client/components/router-reducer/ppr-navigations.js).
 */
const isFullReread = (headers: Record<string, string>) => {
  try {
    return JSON.parse(decodeURIComponent(headers["next-router-state-tree"] ?? ""))[3] === "refetch";
  } catch {
    return false;
  }
};

test.describe("Retour au premier plan", () => {
  test("relit l’état après une vraie absence, pas après un aller-retour bref", async ({ page }) => {
    await signIn(page);

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

// L'état vient du layout, que Next ne rejoue pas en changeant d'écran : sans
// relecture, un agent resté dans l'application ouvrait « Mon planning » sur la
// version d'avant la dernière publication.
test.describe("Changement d’écran", () => {
  test("relit l’état quand ce qu’il montre a plus de trente secondes, pas avant", async ({ page }) => {
    await signIn(page);
    const start = new URL(page.url()).pathname;
    const rereads: string[] = [];
    page.on("request", request => {
      const headers = request.headers();
      if (headers["rsc"] === "1" && isFullReread(headers)) rereads.push(request.url());
    });

    await page.clock.fastForward(10_000);
    // La cloche : présente sur tous les écrans, pour tous les rôles.
    await page.locator("a.bell").click();
    await page.waitForURL(url => url.pathname === "/notifications");
    await page.waitForTimeout(1500);
    expect(rereads, "un écran ouvert dix secondes après la lecture").toEqual([]);

    await page.clock.fastForward(60_000);
    await page.goBack();
    await page.waitForURL(url => url.pathname === start);
    await expect
      .poll(() => rereads.length, { message: "un écran ouvert une minute après la lecture" })
      .toBeGreaterThan(0);
  });
});
