import { test, expect, type Page } from "@playwright/test";

// La proposition d'installation de Chrome. Elle n'était écoutée que par le
// panneau de /profil : ailleurs, personne ne la retenait, et sur /profil le
// panneau la manquait quand Chrome l'annonçait avant lui. L'encadrement, dont
// le menu n'a pas de lien vers /profil, ne voyait jamais le bouton.
//
// Un navigateur piloté n'émet pas cet événement de lui-même : les parcours le
// fabriquent, avec une méthode prompt() qui compte ses appels. Il est émis dès
// que le document est analysé, avant l'hydratation — le cas qui était manqué.

const OFFER = "Installer l’application sur cet appareil";

async function offerInstallation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prompted: number; __retenu: boolean | null };
    w.__prompted = 0;
    w.__retenu = null;
    document.addEventListener("DOMContentLoaded", () => {
      const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string }>;
      };
      event.prompt = () => {
        w.__prompted += 1;
        return Promise.resolve();
      };
      event.userChoice = Promise.resolve({ outcome: "dismissed" });
      // Le script de l'application peut arriver après le document : on émet
      // quand il est là, comme Chrome qui émet après son propre contrôle.
      const emit = () => {
        window.dispatchEvent(event);
        w.__retenu = event.defaultPrevented;
      };
      const wait = () => ("__dispospInstallation" in window ? emit() : setTimeout(wait, 20));
      wait();
    });
  });
}

test.describe("Proposition d’installation", () => {
  test("le script qui la retient est servi à tous, avant l’hydratation", async ({ page, request }) => {
    const script = await request.get("/installation.js", { maxRedirects: 0 });
    expect(script.status()).toBe(200);
    expect(await script.text()).toContain("beforeinstallprompt");
    await page.goto("/connexion");
    expect(await page.evaluate(() => "__dispospInstallation" in window)).toBe(true);
  });

  test("rien n’est proposé tant que Chrome ne propose rien", async ({ page }) => {
    await page.goto("/connexion");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: OFFER })).toHaveCount(0);
  });

  test("l’écran de connexion propose l’installation, une seule fois", async ({ page }) => {
    await offerInstallation(page);
    await page.goto("/connexion");
    const button = page.getByRole("button", { name: OFFER });
    await expect(button).toBeVisible();
    // Retenue par l'application : Chrome n'affiche pas sa propre bannière.
    expect(await page.evaluate(() => (window as unknown as { __retenu: boolean }).__retenu)).toBe(true);
    await button.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    // Une proposition ne sert qu'une fois : le bouton s'efface.
    await expect(button).toHaveCount(0);
  });

  test("le bouton disparaît une fois l’application installée", async ({ page }) => {
    await offerInstallation(page);
    await page.goto("/connexion");
    await expect(page.getByRole("button", { name: OFFER })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(page.getByRole("button", { name: OFFER })).toHaveCount(0);
  });

  test("le bouton se lit : contraste d’au moins 4,5:1", async ({ page }) => {
    await offerInstallation(page);
    await page.goto("/connexion");
    const button = page.getByRole("button", { name: OFFER });
    await expect(button).toBeVisible();
    const [fg, bg] = await button.evaluate(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    const luminance = (color: string) => {
      const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  test.describe("dans l’espace de travail", () => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;

    async function signIn(page: Page) {
      await page.goto("/connexion");
      await page.getByLabel("Adresse électronique").fill(email!);
      await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL(url => !url.pathname.startsWith("/connexion"));
    }

    test("la barre du haut la propose à tout rôle, et la garde d’un écran à l’autre", async ({ page }) => {
      test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
      await signIn(page);
      await offerInstallation(page);
      await page.reload();
      const button = page.locator(".topbar").getByRole("button", { name: OFFER });
      await expect(button).toBeVisible();
      // Une navigation interne : la proposition appartient à la page, pas à
      // l'écran — elle était perdue en allant du tableau de bord au profil.
      // Un lien visible : sur téléphone, le menu latéral est escamoté et c'est la
      // barre du bas qui mène d'un écran à l'autre.
      const other = page.locator(".sidebar nav a:visible, .mobile-nav a:visible");
      const links = await other.evaluateAll(els =>
        els.map(el => el.getAttribute("href")).filter((href): href is string => Boolean(href)),
      );
      const target = links.find(href => href !== new URL(page.url()).pathname);
      expect(target, "un autre écran dans le menu").toBeTruthy();
      await page.locator(`a[href="${target}"]:visible`).first().click();
      await page.waitForURL(url => url.pathname === target);
      await expect(page.locator(".topbar").getByRole("button", { name: OFFER })).toBeVisible();
      // Le bouton ne pousse rien hors de l'écran d'un téléphone.
      await page.setViewportSize({ width: 320, height: 700 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("le panneau du profil la propose aussi, même annoncée avant lui", async ({ page }) => {
      test.skip(!email || !password, "Demande E2E_EMAIL et E2E_PASSWORD, un compte rattaché à un centre.");
      await signIn(page);
      await offerInstallation(page);
      await page.goto("/profil");
      await expect(page.getByRole("button", { name: "Installer l’application", exact: true })).toBeVisible();
    });
  });
});
