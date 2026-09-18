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
    // These tests drive the demonstration, and the mode cannot be set here:
    // NEXT_PUBLIC_* is inlined into every bundle at build time, server code
    // included. The build carries the mode, so the suite needs one made in
    // demonstration mode — which is what an unset variable gives:
    //   NEXT_PUBLIC_DISPOSP_MODE=demo pnpm build && pnpm test:e2e
    // Working in connected mode locally otherwise sends the whole suite to the
    // login screen, with sixteen failures that say nothing about the code.
    reuseExistingServer: true,
    timeout: 60000,
  },
});
