import { test, expect, type Page } from "@playwright/test";

// Les écrans de travail demandent une session, donc un projet Supabase joignable.
// Sans lui, seule la page de connexion est atteignable : c'est elle qu'on mesure.
const ROUTES = ["/connexion", "/hors-ligne"];

/** Les quinze écrans de travail, mesurés dès qu'un compte d'essai est fourni.
    Ce sont eux qui portent les tableaux, les filtres et les modales — c'est là
    que l'adaptation aux écrans se joue vraiment. */
const WORKSPACE = [
  "/accueil",
  "/tableau-de-bord",
  "/mes-disponibilites",
  "/mon-planning",
  "/disponibilites",
  "/planning",
  "/besoins",
  "/demandes",
  "/agents",
  "/campagnes",
  "/statistiques",
  "/historique",
  "/notifications",
  "/parametres",
  "/profil",
];

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Les commandes plus petites que le pouce.
 *
 * Le texte réservé aux lecteurs d'écran est découpé à un pixel : c'est sa
 * technique, pas une cible ratée. Le lien d'évitement reste masqué jusqu'à la
 * prise de focus, pour la même raison.
 */
const tooSmall = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, a, input, select, textarea, [role=button]")]
      .filter(el => !el.classList.contains("skip-link") && !el.closest(".sr-only"))
      .map(el => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24))
      .map(
        ({ el, box }) =>
          `${el.tagName.toLowerCase()} « ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} » ${Math.round(box.width)}×${Math.round(box.height)}`,
      ),
  );

test.describe("Adaptation aux écrans", () => {
  test.skip(({ isMobile }) => !isMobile, "Exécutés une fois, sur le profil mobile.");

  // 320 px reste la largeur des plus petits téléphones en service. Ce qui déborde
  // là déborde d'abord là : un champ de date en a fait la démonstration.
  test("aucun écran ne dépasse la largeur de l’appareil", async ({ page }) => {
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(route);
        expect(await overflow(page), `${route} à ${width} px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("les commandes restent assez grandes pour le doigt", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of ROUTES) {
      await page.goto(route);
      expect(await tooSmall(page), route).toEqual([]);
    }
  });
});

test.describe("Adaptation des écrans de travail", () => {
  test.skip(({ isMobile }) => !isMobile, "Exécutés une fois, sur le profil mobile.");

  test("chaque écran tient dans un téléphone, commandes comprises", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));

    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of WORKSPACE) {
        await page.goto(route);
        // Un compte agent n'atteint pas les écrans d'administration : la page
        // répond, l'écran explique. Rien à mesurer de plus, mais rien à sauter.
        expect(await overflow(page), `${route} à ${width} px`).toBeLessThanOrEqual(1);
        expect(await tooSmall(page), `${route} à ${width} px`).toEqual([]);
      }
    }
  });

  // Le sélecteur qui n'affiche que « Tout… » ne filtre plus rien : l'agent ne
  // sait pas ce qu'il regarde. Les filtres tombaient à 64 px sur un téléphone.
  test("un filtre affiche l’option qu’il a sélectionnée", async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
    await page.goto("/connexion");
    await page.getByLabel("Adresse électronique").fill(email!);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL(url => !url.pathname.startsWith("/connexion"));

    for (const width of [320, 414]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ["/disponibilites", "/historique"]) {
        await page.goto(route);
        const tight = await page.evaluate(() => {
          const out: string[] = [];
          for (const select of document.querySelectorAll("select")) {
            const box = select.getBoundingClientRect();
            if (!box.width) continue;
            const style = getComputedStyle(select);
            const longest = [...select.options].map(o => o.text).sort((a, b) => b.length - a.length)[0] ?? "";
            const probe = document.createElement("span");
            probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${style.font}`;
            probe.textContent = longest;
            document.body.append(probe);
            // 22 px : la flèche que le navigateur dessine à droite.
            const need =
              probe.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 22;
            probe.remove();
            if (need > box.width + 2)
              out.push(`${select.getAttribute("aria-label")} : ${Math.round(box.width)} px pour « ${longest} »`);
          }
          return out;
        });
        expect(tight, `${route} à ${width} px`).toEqual([]);
      }
    }
  });
});
