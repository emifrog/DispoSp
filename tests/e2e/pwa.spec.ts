import { test, expect } from "@playwright/test";

// §17 : l'application s'installe sur l'écran d'accueil. Ces tests portent sur ce
// qui rend l'installation possible — le manifeste, les icônes et l'agent de
// service — et surtout sur ce qu'il ne conserve pas.
test.describe("Application installable", () => {
  test("le manifeste et ses icônes décrivent une application installable", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      short_name: "DispoSP",
      lang: "fr",
      display: "standalone",
      start_url: "/",
      scope: "/",
      theme_color: "#08284a",
      // La matrice mensuelle se lit en paysage : verrouiller l'orientation la
      // rendrait illisible sur un téléphone.
      orientation: "any",
    });
    // Ce que les navigateurs exigent : 192 et 512 pour l'écran d'accueil, plus
    // une version découpable pour les masques d'Android.
    const icons = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`);
    expect(icons).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    for (const icon of manifest.icons as { src: string }[]) {
      const file = await request.get(icon.src);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"], icon.src).toContain("image/png");
    }
    // iOS ignore le manifeste et va chercher celle-ci.
    expect((await request.get("/apple-touch-icon.png")).status()).toBe(200);
  });

  test("l’agent de service ne garde que la page hors ligne, et la sert quand le réseau tombe", async ({
    page,
    context,
  }) => {
    await page.goto("/connexion");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    // Le cœur de la décision : aucune donnée n'est conservée sur l'appareil. Un
    // planning ou une disponibilité servis depuis un cache seraient présentés
    // comme à jour sans l'être.
    const cached = await page.evaluate(async () => {
      const paths: string[] = [];
      for (const name of await caches.keys())
        paths.push(...(await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname));
      return paths;
    });
    expect(cached).toEqual(["/hors-ligne"]);

    await context.setOffline(true);
    await page.goto("/hors-ligne");
    await expect(page.getByRole("heading", { name: "Pas de connexion." })).toBeVisible();
    // Hors ligne, rien d'autre que le document ne se charge : la page doit
    // porter ses propres styles, et son « Réessayer » doit marcher sans script.
    // Elle s'affichait sans style, avec un bouton inerte.
    const retry = page.getByRole("link", { name: "Réessayer" });
    await expect(retry).toBeVisible();
    expect(await page.locator("main.offline").evaluate(el => getComputedStyle(el).maxWidth)).not.toBe("none");
    await retry.click();
    // Toujours hors ligne : la navigation retombe sur la même page, servie par
    // l'agent de service — et non sur une erreur du navigateur.
    await expect(page.getByRole("heading", { name: "Pas de connexion." })).toBeVisible();
    await context.setOffline(false);
  });

  test("le profil propose l’installation et donne le chemin iOS", async ({ page }) => {
    // L'écran de profil demande une session, pas seulement un projet joignable :
    // la condition portait sur l'URL Supabase, et le test échouait dès qu'elle
    // était présente. Il lui faut un compte d'essai, sinon il se saute.
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
    await page.goto("/profil");
    await expect(page.getByRole("heading", { name: "Installer l’application" })).toBeVisible();
    // Safari n'annonce jamais la possibilité d'installer : le chemin se dit.
    await expect(page.getByText("Sur iPhone et iPad")).toBeVisible();
  });

  test("le profil propose d’activer les notifications sur l’appareil", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    // Sans clé publique VAPID dans le paquet, l'application n'offre pas
    // l'activation : c'est le cas de l'intégration continue, et le parcours se
    // saute plutôt que d'échouer sur une absence voulue.
    test.skip(!process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY, "Demande une paire de clés VAPID.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
    await page.goto("/profil");
    await expect(page.getByRole("heading", { name: "Notifications sur cet appareil" })).toBeVisible();
    // Un navigateur piloté répond « refusé » à toute demande d'autorisation, et
    // rien ne le fait changer d'avis de l'extérieur. Le parcours vérifie donc ce
    // qui compte des deux côtés : l'écran ne prétend jamais que les
    // notifications sont actives, et il donne toujours la suite — le bouton
    // d'activation, ou le chemin pour rouvrir ce que le navigateur a fermé.
    await expect(page.getByText("Actives sur cet appareil.")).toHaveCount(0);
    await expect(
      page
        .getByRole("button", { name: "Activer les notifications" })
        .or(page.getByText("Les notifications ont été refusées pour DispoSP")),
    ).toBeVisible();
    // L'invitation de la connexion ne se pose qu'à qui peut y répondre : un
    // navigateur qui a déjà refusé ne doit pas voir une fenêtre lui proposer ce
    // que lui seul peut rouvrir dans ses réglages.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
