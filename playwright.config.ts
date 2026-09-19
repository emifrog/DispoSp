import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", locale: "fr-FR", timezoneId: "Europe/Paris" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1050 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    // L'application ne tourne qu'en mode connecté : les parcours qui demandent une
    // session se sautent d'eux-mêmes sans NEXT_PUBLIC_SUPABASE_URL, ce qui est le
    // cas de l'intégration continue. Restent le manifeste, l'agent de service et
    // l'adaptation aux écrans, qui n'ont besoin d'aucune donnée.
    reuseExistingServer: true,
    timeout: 60000,
  },
});
