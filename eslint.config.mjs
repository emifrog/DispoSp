import next from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";

export default [
  {
    ignores: [
      "node_modules/**",
      ".pnpm-store/**",
      ".next/**",
      ".local/**",
      "test-results/**",
      "playwright-report/**",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    // Tool configuration files are read by their loader, not imported by name.
    files: ["*.config.{ts,mts,mjs,js}"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
  // Keep formatting decisions with Prettier: this must stay last.
  prettier,
];
