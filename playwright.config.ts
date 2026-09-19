import { defineConfig, devices } from "@playwright/test";

// Next lit `.env` de lui-même pour le serveur ; ce processus-ci ne le faisait
// pas. Les deux pouvaient donc diverger : un serveur branché sur Supabase, et
// des parcours qui se sautaient en croyant qu'il ne l'était pas — « 12 tests
// ignorés » qui ne voulaient plus rien dire.
//
// Le fichier absent est le cas normal de l'intégration continue : elle n'a pas
// de projet Supabase, les parcours qui en demandent un se sautent, et ceux de
// la surface publique s'exécutent pour de bon.
try {
  process.loadEnvFile(".env");
} catch {
  // Pas de .env : rien à aligner.
}
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
