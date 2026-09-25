import { test, expect, type Page } from "@playwright/test";

// Des règles de feuille de style qui se contredisent ne font échouer aucune
// construction : la plus spécifique gagne, en silence. Ces parcours mesurent le
// rendu lui-même, sur des pages publiques, pour tourner aussi dans
// l'intégration continue, qui n'a pas de session.

/** Une couleur telle que le navigateur la calcule, pour comparer des rgb(). */
const resolved = (page: Page, css: string) =>
  page.evaluate(value => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, css);

// C7 de l'analyse du 25 septembre : le commit de design du 24 a donné aux jours
// à renseigner une règle de trois classes, qui l'emportait sur celle de la
// sélection. En « Sélection multiple », les jours vides cochés ne changeaient
// pas de bordure.
test("un jour sélectionné porte la bordure de sélection, qu’il soit vide ou renseigné", async ({ page }) => {
  await page.goto("/connexion");
  // Le calendrier demande une session ; ses cases, elles, ne demandent que la
  // feuille de style de l'application, que la page de connexion charge.
  await page.evaluate(() => {
    const grid = document.createElement("div");
    grid.innerHTML = `
      <button type="button" id="vide-choisi" class="calendar-day unknown is-selected">1</button>
      <button type="button" id="vide" class="calendar-day unknown">2</button>
      <button type="button" id="rempli-choisi" class="calendar-day day is-selected">3</button>`;
    grid.style.cssText = "position:fixed;top:0;left:0;display:flex;gap:8px;z-index:9999;background:#fff;padding:8px";
    document.body.append(grid);
  });
  const blue = await resolved(page, "var(--blue)");
  const border = (id: string) => page.locator(`#${id}`).evaluate(el => getComputedStyle(el).borderTopColor);

  expect(await border("vide-choisi")).toBe(blue);
  expect(await border("rempli-choisi")).toBe(blue);
  expect(await border("vide")).not.toBe(blue);
  // Au survol aussi : la règle de survol des jours vides ne l'efface pas. La
  // bordure a une transition de 0,15 s : on attend qu'elle se pose.
  await page.locator("#vide-choisi").hover();
  await page.waitForTimeout(300);
  expect(await border("vide-choisi")).toBe(blue);
  // Et le survol d'un jour vide non choisi se voit de nouveau.
  const idle = await border("vide");
  await page.locator("#vide").hover();
  await expect.poll(() => border("vide")).not.toBe(idle);
});

/** Rapport de contraste WCAG entre deux couleurs rgb() calculées. */
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const [r, g, bl] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// C8 de l'analyse du 25 septembre : en thème sombre, la page hors ligne passait
// son texte en clair sur un fond resté clair — 1,1:1.
for (const scheme of ["light", "dark"] as const)
  test(`la page hors ligne se lit en thème ${scheme === "dark" ? "sombre" : "clair"}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/hors-ligne");
    const colors = await page.evaluate(() => {
      // Le fond effectif : le premier ancêtre qui en porte un, sinon le blanc
      // par défaut d'une page sans `color-scheme` sombre.
      const backgroundOf = (el: Element | null): string => {
        for (let node = el; node; node = node.parentElement) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        }
        return "rgb(255, 255, 255)";
      };
      const title = document.querySelector("h1")!;
      const text = document.querySelector("main p")!;
      return {
        title: getComputedStyle(title).color,
        titleBackground: backgroundOf(title),
        text: getComputedStyle(text).color,
        textBackground: backgroundOf(text),
      };
    });
    expect(contrast(colors.title, colors.titleBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.text, colors.textBackground)).toBeGreaterThanOrEqual(4.5);
  });
