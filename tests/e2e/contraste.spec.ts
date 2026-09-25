import { test, expect, type Page } from "@playwright/test";

// C9 de l'analyse du 25 septembre : des états se lisaient entre 1,8:1 et 4,4:1
// — « À valider », les refus de publication, les erreurs de formulaire, les
// qualifications, les avatars, l'anneau de focus. Les écrans qui les portent
// demandent une session ; leurs classes, elles, ne demandent que la feuille de
// style, que la page de connexion charge. On pose donc le balisage de chaque
// état dans cette page, et on mesure ce que le navigateur calcule.

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

/** Le texte d'un élément et le fond sur lequel il se lit réellement : le
    premier ancêtre qui en porte un, sinon le fond de la page. */
const colorsOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate(el => {
    let background = "rgb(255, 255, 255)";
    for (let node: Element | null = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        background = bg;
        break;
      }
    }
    return { text: getComputedStyle(el).color, background };
  });

/** Le balisage des écrans de travail, réduit à ce qui porte la couleur. */
const MARKUP = `
  <div style="background:#fff;padding:12px">
    <span id="valide" class="response-dot responded">Validée</span>
    <span id="a-valider" class="response-dot pending">À valider</span>
    <section class="panel">
      <article class="day-group pending">
        <header><span>Réponse non validée</span><strong>1</strong></header>
        <ul><li><span><strong id="non-valide-nom">Camille Martin</strong></span></li></ul>
      </article>
    </section>
    <div id="refus" class="warning">Besoins non définis.</div>
    <p id="erreur" class="field-error">Indiquez une adresse.</p>
    <span id="rouge" class="text-red">2/3</span>
    <span id="vert" class="text-green">3/3</span>
    <span id="orange" class="pill pill-orange">En attente</span>
    <span id="pilule-verte" class="pill pill-green">Validée</span>
    <button id="danger" type="button" class="button button-danger">Refuser</button>
    <div id="succes" class="success-note">Ce créneau peut être publié.</div>
    <div class="agent-card">
      <div class="agent-info">
        <strong>Camille Martin</strong>
        <small>Sergent · Bon Voyage</small>
        <small id="cause" class="text-red">Désistement accepté</small>
        <div class="qualification-tags">
          <span id="chef" class="chief">Chef</span>
          <span id="conducteur" class="driver">Conducteur PL</span>
        </div>
      </div>
    </div>
    <span id="avatar-0" class="avatar avatar-0">CM</span>
    <span id="avatar-1" class="avatar avatar-1">JD</span>
    <span id="avatar-2" class="avatar avatar-2">AL</span>
    <span id="avatar-3" class="avatar avatar-3">PB</span>
    <table class="equity-table"><tbody><tr><th>Camille</th><td id="zero" class="nil">0</td></tr></tbody></table>
  </div>
  <div class="page-heading"><div><h1>Titre</h1><p id="sous-titre">La description d’un écran.</p></div></div>
  <input id="avant" aria-label="avant" />
  <button id="cible" type="button">Cible</button>
  <label class="search-field"><input id="recherche" aria-label="Rechercher" /></label>`;

async function inject(page: Page) {
  await page.goto("/connexion");
  await page.evaluate(markup => {
    const host = document.createElement("div");
    host.id = "banc";
    host.innerHTML = markup;
    // Sur le fond de page de l'application, comme les écrans de travail.
    host.style.cssText = "position:relative;z-index:9999;background:var(--background);padding:16px";
    document.body.prepend(host);
  }, MARKUP);
}

test.describe("Contraste des états (C9)", () => {
  test("chaque texte d’état dépasse 4,5:1 sur son fond", async ({ page }) => {
    await inject(page);
    const texts: [string, string][] = [
      ["#valide", "« Validée » de la matrice"],
      ["#a-valider", "« À valider » de la matrice"],
      ["#non-valide-nom", "nom sous « Réponse non validée »"],
      ["#refus", "avertissement"],
      ["#erreur", "erreur de formulaire"],
      ["#rouge", ".text-red"],
      ["#vert", ".text-green"],
      ["#orange", "pastille orange"],
      ["#pilule-verte", "pastille verte"],
      ["#danger", "bouton de refus"],
      ["#succes", "note de succès"],
      ["#cause", "cause d’une affectation invalide"],
      ["#chef", "qualification Chef"],
      ["#conducteur", "qualification Conducteur PL"],
      ["#avatar-0", "avatar"],
      ["#avatar-1", "avatar 1"],
      ["#avatar-2", "avatar 2"],
      ["#avatar-3", "avatar 3"],
      ["#zero", "zéro du tableau d’équité"],
      ["#sous-titre", "description d’un écran"],
    ];
    for (const [selector, name] of texts) {
      const { text, background } = await colorsOf(page, selector);
      expect(contrast(text, background), `${name} : ${text} sur ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // La cause s'écrivait en gris : `.agent-info > small` l'emportait sur
  // `.text-red`. Elle doit porter le rouge, pas seulement un contraste suffisant.
  test("la cause d’une affectation invalide s’écrit en rouge", async ({ page }) => {
    await inject(page);
    const red = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--red)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect((await colorsOf(page, "#cause")).text).toBe(red);
  });

  // WCAG 1.4.11 : un indicateur non textuel demande 3:1 sur ce qui l'entoure.
  // L'anneau bleu clair d'avant faisait 2,3:1 sur le blanc.
  test("l’anneau de focus se voit sur le blanc et sur le fond de page", async ({ page }) => {
    await inject(page);
    // Une tabulation depuis un champ : le bouton reçoit un focus « clavier »,
    // celui que `:focus-visible` dessine.
    await page.locator("#avant").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#cible")).toBeFocused();
    const ring = await page.locator("#cible").evaluate(el => getComputedStyle(el).outlineColor);
    const pageBackground = await page.evaluate(
      () => getComputedStyle(document.getElementById("banc")!).backgroundColor,
    );
    expect(contrast(ring, "rgb(255, 255, 255)")).toBeGreaterThanOrEqual(3);
    expect(contrast(ring, pageBackground)).toBeGreaterThanOrEqual(3);

    await page.locator("#recherche").focus();
    const search = await page.locator(".search-field").evaluate(el => getComputedStyle(el).outlineColor);
    expect(contrast(search, "rgb(255, 255, 255)")).toBeGreaterThanOrEqual(3);
  });
});
