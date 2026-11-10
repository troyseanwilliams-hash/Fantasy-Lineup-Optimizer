import { defineConfig } from "@playwright/test";
import baseConfig from "../../../playwright.config";

// Kept next to the focused spec because this task is scoped to client/src.
// Reuse the repository's server/base URL without broadening its normal suite.
export default defineConfig({
  ...baseConfig,
  testDir: ".",
  testMatch: "header-responsive.spec.ts",
  outputDir: "/tmp/elitelineup-header-results",
  use: {
    ...baseConfig.use,
    screenshot: "only-on-failure",
  },
  projects: [{ name: "header-chromium", use: { browserName: "chromium" } }],
});
