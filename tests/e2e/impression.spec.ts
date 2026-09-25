import { test, expect, type Page } from "@playwright/test";

// C10 de l'analyse du 25 septembre : à l'impression, la barre latérale
// disparaissait mais sa marge restait — 242 px de blanc à gauche de chaque
// page — et le bandeau d'impression ne sortait qu'en tête de la première,
// quand son commentaire et la recette (§6) le promettent sur chacune.
//
// La coquille de l'espace de travail demande une session ; sa feuille de
// style, non. On pose son balisage dans la page de connexion, on passe en
// média « print », et on mesure.

const SHELL = `
  <div class="app-shell" id="coquille">
    <aside class="sidebar">Barre latérale</aside>
    <div class="main-shell" id="principal">
      <header class="topbar">Bandeau</header>
      <div class="print-header" id="en-tete" aria-hidden="true">
        <div><span>CIS d’essai</span></div>
      </div>
      <main id="contenu"><div class="page-heading"><div><h1>Planning</h1><p>Description.</p></div></div></main>
    </div>
    <nav class="mobile-nav" id="barre-mobile"><a href="#">Accueil</a></nav>
  </div>`;

async function injectShell(page: Page) {
  await page.goto("/connexion");
  await page.evaluate(markup => {
    // Le formulaire de connexion masqué, la coquille seule dans la page : c'est
    // elle que l'impression doit mettre en page, sans voisin qui la décale.
    // Masqué et non retiré : React tient encore ces nœuds.
    for (const child of document.body.children) (child as HTMLElement).style.display = "none";
    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.append(host);
  }, SHELL);
}

test.describe("Impression (C10)", () => {
  test("la coquille rend toute la largeur de la page", async ({ page }) => {
    await injectShell(page);
    // À l'écran, la marge de la barre latérale est là : le test mesure bien
    // la règle que l'impression doit défaire.
    const screen = await page.locator("#principal").evaluate(el => parseFloat(getComputedStyle(el).marginLeft));
    const width = page.viewportSize()?.width ?? 0;
    if (width > 760) expect(screen).toBeGreaterThan(0);

    await page.emulateMedia({ media: "print" });
    const printed = await page.locator("#principal").evaluate(el => {
      const style = getComputedStyle(el);
      return { marginLeft: style.marginLeft, paddingLeft: style.paddingLeft, left: el.getBoundingClientRect().left };
    });
    expect(printed.marginLeft).toBe("0px");
    expect(printed.paddingLeft).toBe("0px");
    expect(printed.left).toBeLessThan(1);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".topbar")).toBeHidden();
  });

  test("le bandeau d’impression est un en-tête répété, au-dessus du contenu", async ({ page }) => {
    await injectShell(page);
    await expect(page.locator("#en-tete")).toBeHidden();
    await page.emulateMedia({ media: "print" });
    const layout = await page.evaluate(() => {
      const shell = document.getElementById("principal")!;
      const header = document.getElementById("en-tete")!;
      const main = document.getElementById("contenu")!;
      return {
        shell: getComputedStyle(shell).display,
        header: getComputedStyle(header).display,
        main: getComputedStyle(main).display,
        position: getComputedStyle(header).position,
        headerBottom: header.getBoundingClientRect().bottom,
        mainTop: main.getBoundingClientRect().top,
      };
    });
    // Un groupe d'en-tête de tableau : le moteur d'impression le répète en
    // haut de chaque feuille, et réserve sa hauteur sur chacune — il ne
    // chevauche jamais le contenu, ce qu'un bloc fixe ferait dès la deuxième.
    expect(layout.shell).toBe("table");
    expect(layout.header).toBe("table-header-group");
    expect(layout.main).toBe("table-row-group");
    expect(layout.position).toBe("static");
    expect(layout.headerBottom).toBeLessThanOrEqual(layout.mainTop);
  });

  // Une feuille A4 en portrait fait moins de 760 px de large : la mise en page
  // mobile s'applique au papier, et sa barre du bas, fixe, revenait au pied de
  // chaque page.
  test("la barre de navigation mobile ne s’imprime pas", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 1000 });
    await injectShell(page);
    await expect(page.locator("#barre-mobile")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#barre-mobile")).toBeHidden();
  });
});
