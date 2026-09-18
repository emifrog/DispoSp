import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
});
test("parcours agent : saisie rapide, validation explicite, sauvegarde et modification", async ({ page }) => {
  await page.goto("/tableau-de-bord");
  await expect(page.getByRole("heading", { name: "Une équipe prête, ensemble." })).toBeVisible();
  await page.getByLabel("Espace de démonstration").selectOption("AGENT");
  await expect(page.getByRole("button", { name: "Valider mes disponibilités" })).toBeDisabled();
  await page.getByRole("button", { name: "Saisie rapide", exact: true }).click();
  await page.getByRole("button", { name: "24 24 h" }).click();
  await page.getByRole("button", { name: "Enregistrer les 31 jours" }).click();
  await expect(page.getByText("31 / 31 jours renseignés")).toBeVisible();
  await page.getByRole("button", { name: "Valider mes disponibilités" }).click();
  await expect(page.getByText("Votre réponse est validée")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Votre réponse est validée")).toBeVisible();
  await page.getByRole("button", { name: "15 octobre, 24 h", exact: true }).click();
  await page.getByRole("button", { name: "X Indisponible" }).click();
  await page.getByRole("button", { name: "Enregistrer la disponibilité" }).click();
  await expect(page.getByRole("button", { name: "Valider mes disponibilités" })).toBeEnabled();
  await page.screenshot({ path: `test-results/availability-${test.info().project.name}.png`, fullPage: true });
});
test("le responsable publie un créneau couvert, visible pour l’agent", async ({ page, isMobile }) => {
  await page.goto("/planning?date=2026-10-15&shift=DAY");
  await page.getByRole("button", { name: "Modifier les besoins" }).click();
  await page.getByLabel("Effectif minimum").fill("1");
  for (const q of ["Chef", "Conducteur PL", "SAP", "Équipier INC"]) await page.getByLabel(q, { exact: true }).fill("0");
  await page.getByRole("button", { name: "Enregistrer les besoins" }).click();
  await page.getByRole("button", { name: "Publier ce créneau" }).click();
  await page.getByRole("button", { name: "Confirmer la publication" }).click();
  await expect(page.getByText("Version 1 publiée", { exact: true })).toBeVisible();
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("disposp-demo-v1")!));
  const assignedId = snapshot.publications["campaign-2026-10/2026-10-15/DAY"].agents[0];
  await page.getByLabel("Espace de démonstration").selectOption("AGENT");
  await page.goto("/profil");
  await page.getByLabel("Agent de démonstration").selectOption(assignedId);
  // Use in-app navigation so the selected demo identity is retained.
  await page
    .getByRole("navigation", { name: isMobile ? "Navigation mobile" : "Navigation principale", exact: true })
    .getByRole("link", { name: "Mon planning", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Garde de jour" })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter mon calendrier" }).click();
  expect((await downloaded).suggestedFilename()).toBe("planning-2026-10.ics");
});
test("création d’une campagne et saisie sur le bon mois", async ({ page }) => {
  await page.goto("/campagnes");
  await page.getByRole("button", { name: "Nouvelle campagne" }).click();
  await page.getByLabel("Nom de la campagne").fill("Disponibilités de novembre");
  await page.getByRole("button", { name: "Créer et ouvrir la campagne" }).click();
  await expect(page.getByRole("heading", { name: "Disponibilités de novembre", exact: true })).toBeVisible();
  await page.getByLabel("Campagne active").selectOption("campaign-2026-11");
  await page.getByLabel("Espace de démonstration").selectOption("AGENT");
  await expect(page.getByText("0 / 30 jours renseignés")).toBeVisible();
  await page.getByRole("button", { name: "Saisie rapide", exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer les 30 jours" }).click();
  await expect(page.getByText("30 / 30 jours renseignés")).toBeVisible();
  await page.getByRole("button", { name: "Valider mes disponibilités" }).click();
  await expect(page.getByText("Votre réponse est validée")).toBeVisible();
});
test("synthèse filtrable, export et blocage de publication déficitaire", async ({ page }) => {
  await page.goto("/disponibilites");
  await page.getByLabel("Rechercher un agent", { exact: true }).fill("Julien");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Filtrer par validation").selectOption("validated");
  await expect(page.getByText("Aucun agent ne correspond aux filtres.")).toBeVisible();
  await page.getByLabel("Filtrer par validation").selectOption("pending");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter la vue CSV" }).click();
  expect((await exported).suggestedFilename()).toBe("disponibilites-2026-10.csv");
  await page.goto("/planning?date=2026-10-15&shift=NIGHT");
  await expect(page.getByRole("button", { name: "Publier ce créneau" })).toBeDisabled();
  await expect(page.getByText("20 h – 8 h (+1 j)", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/planning-${test.info().project.name}.png`, fullPage: true });
});
test("tableau de bord, navigation et affichage sans débordement", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tableau-de-bord");
  await expect(page.getByRole("heading", { name: "Une équipe prête, ensemble." })).toBeVisible();
  await page.getByRole("button", { name: "Couverture planifiée", exact: true }).click();
  await expect(page.getByText("Affectations du brouillon · effectifs et qualifications")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/dashboard-${test.info().project.name}.png`, fullPage: true });
  expect(errors).toEqual([]);
});
test("une sauvegarde locale inutilisable ne fait pas planter l’application", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Schema-valid but unusable: a campaign exists, so the state is accepted, yet
  // there is no agent behind the demonstration profile. Every screen used to
  // resolve that lookup with a non-null assertion and crashed on it.
  await page.addInitScript(() => {
    localStorage.setItem(
      "disposp-demo-v1",
      JSON.stringify({
        version: 1,
        organization: { name: "Centre vide", dayStart: 8, nightStart: 20 },
        agents: [],
        campaigns: [
          {
            id: "campaign-2026-10",
            name: "Campagne orpheline",
            month: "2026-10",
            opensOn: "2026-09-01",
            closesOn: "2026-09-30",
            closed: false,
            dayStart: 8,
            nightStart: 20,
          },
        ],
        entries: {},
        responses: {},
        requirements: {},
        assignments: {},
        publications: {},
        audit: [],
      }),
    );
    sessionStorage.setItem("disposp-demo-actor", JSON.stringify({ id: "inconnu", role: "MANAGER" }));
  });
  // Each screen must render for real. Asserting on <main> alone would pass on the
  // error boundary, which also renders a <main>.
  const screens = [
    ["/tableau-de-bord", "Une équipe prête, ensemble."],
    ["/planning", "Construire le planning"],
    ["/disponibilites", "Toutes les disponibilités"],
    ["/mes-disponibilites", "Mes disponibilités"],
    ["/mon-planning", "Mon planning"],
  ];
  for (const [route, heading] of screens) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByText("Cet écran n’a pas pu s’afficher.")).toBeHidden();
  }
  await expect(page.getByText("La sauvegarde locale n’est pas compatible.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("une sauvegarde locale illisible repart des données d’exemple", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
  await page.addInitScript(() => localStorage.setItem("disposp-demo-v1", "{ceci n’est pas du JSON"));
  await page.goto("/tableau-de-bord");
  await expect(page.getByRole("heading", { name: "Une équipe prête, ensemble." })).toBeVisible();
  await expect(page.getByText("La sauvegarde locale n’a pas pu être lue.")).toBeVisible();
  expect(errors).toEqual([]);
});
