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

/** Ouvre une session, ou saute le parcours faute de compte d'essai. */
async function signIn(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
  await page.goto("/connexion");
  await page.getByLabel("Adresse électronique").fill(email!);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
}

test.describe("Adaptation des écrans de travail", () => {
  test.skip(({ isMobile }) => !isMobile, "Exécutés une fois, sur le profil mobile.");

  test("chaque écran tient dans un téléphone, commandes comprises", async ({ page }) => {
    await signIn(page);

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
    await signIn(page);

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

  /*
   * Le menu ne tient pas dans une fenêtre basse.
   *
   * Il mesure près de 870 px, et il est en `position: fixed` : ce qui dépasse
   * le bas de l'écran n'est atteignable que si la barre elle-même défile. Sans
   * cela, huit rubriques disparaissaient à 844 × 390 et « Paramètres » dès
   * 1024 × 768 — un portable posé en paysage perdait la moitié de son menu.
   *
   * La hauteur est le seul axe que le reste de ce fichier ne mesure pas : un
   * élément trop haut ne fait pas déborder la page, il se contente de sortir
   * du cadre.
   */
  test("toutes les rubriques du menu restent atteignables", async ({ page }) => {
    await signIn(page);
    for (const [width, height] of [
      [320, 568],
      [844, 390],
      [1024, 768],
      [1280, 600],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/accueil");
      // Sous 760 px la barre est un tiroir : il faut l'ouvrir pour la mesurer.
      const toggle = page.getByRole("button", { name: "Ouvrir le menu" });
      if (await toggle.count()) {
        await toggle.first().click();
        await expect(page.locator("aside.sidebar.is-open")).toBeVisible();
      }
      const unreachable = await page.evaluate(() => {
        const aside = document.querySelector("aside.sidebar");
        if (!aside) return ["barre latérale absente"];
        // On la pousse jusqu'au bout : ce qui reste sous le bord après ça est
        // hors d'atteinte pour de bon.
        aside.scrollTop = aside.scrollHeight;
        return [...aside.querySelectorAll("a")]
          .filter(link => link.getBoundingClientRect().bottom > window.innerHeight + 1)
          .map(link => (link.textContent || "").trim().slice(0, 30));
      });
      expect(unreachable, `${width} × ${height}`).toEqual([]);
    }
  });

  /*
   * Le débordement à l'intérieur d'une boîte de dialogue.
   *
   * La page ne déborde pas — la fenêtre modale est bornée et masque ce qui la
   * dépasse — donc la mesure au niveau du document ne voit rien. Le champ, lui,
   * est bel et bien coupé : « Clôture des réponses » sortait de 47 px à 320 px,
   * parce qu'un champ `month` réclame 173 px avant de pouvoir s'afficher et
   * qu'un élément de grille ne se comprime pas sous sa largeur intrinsèque.
   */
  test("aucun champ ne sort d’une boîte de dialogue", async ({ page }) => {
    await signIn(page);
    const MODALS: [string, string][] = [
      ["/campagnes", "Nouvelle campagne"],
      ["/agents", "Inviter un agent"],
      ["/besoins", "Appliquer à plusieurs journées"],
      ["/mes-disponibilites", "Saisie rapide"],
    ];
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 700 });
      for (const [route, label] of MODALS) {
        await page.goto(route);
        const trigger = page.getByRole("button", { name: label }).first();
        // Un compte qui n'encadre pas n'a pas ces commandes : rien à mesurer.
        if (!(await trigger.count())) continue;
        await trigger.click();
        const dialog = page.locator("[role=dialog]").first();
        await expect(dialog).toBeVisible();
        const spill = await dialog.evaluate(el => el.scrollWidth - el.clientWidth);
        expect(spill, `« ${label} » à ${width} px`).toBeLessThanOrEqual(1);
        await page.keyboard.press("Escape");
      }
    }
  });
});
