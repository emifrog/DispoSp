import { test, expect } from "@playwright/test";

const ROUTES = [
  "/tableau-de-bord",
  "/disponibilites",
  "/planning",
  "/campagnes",
  "/agents",
  "/historique",
  "/parametres",
  "/mes-disponibilites",
  "/mon-planning",
  "/notifications",
  "/profil",
];

// Ces tests posent leur propre largeur : les rejouer sur les deux profils du
// projet ne dirait rien de plus et doublerait la durée de la suite.
test.describe("Adaptation aux écrans", () => {
  test.skip(({ isMobile }) => !isMobile, "Exécutés une fois, sur le profil mobile.");
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
  });

  // 320 px reste la largeur des plus petits téléphones en service. Ce qui
  // déborde là déborde d'abord là : un champ de date en a fait la démonstration.
  test("aucun écran ne dépasse la largeur de l’appareil", async ({ page }) => {
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ROUTES) {
        await page.goto(route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} à ${width} px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("les commandes restent assez grandes pour le doigt", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of ["/tableau-de-bord", "/disponibilites", "/historique"]) {
      await page.goto(route);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, a, input, select, [role=button]")]
          // Le lien d'évitement est masqué jusqu'à la prise de focus : c'est une
          // technique d'accessibilité, pas une cible trop petite.
          .filter(el => !el.classList.contains("skip-link"))
          .map(el => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 24 || box.height < 24))
          .map(
            ({ el, box }) =>
              `${el.tagName.toLowerCase()} « ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)} » ${Math.round(box.width)}×${Math.round(box.height)}`,
          ),
      );
      expect(small, route).toEqual([]);
    }
  });
});
