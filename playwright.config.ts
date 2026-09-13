import { defineConfig, devices } from "@playwright/test";

// Keep the browser test server separate from the Replit app workflow. The
// workflow already occupies port 5000, and reusing whichever process happens
// to be there can make a stale/failed Vite instance look like a selector
// regression.
const e2ePort = process.env.PLAYWRIGHT_PORT ?? "5001";
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: e2eBaseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `PORT=${e2ePort} npm run dev`,
    url: `${e2eBaseURL}/login`,
    // Never attach tests to an unrelated process left on the test port.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "phone-375",
      use: {
        ...devices["iPhone 12"],
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: "phone-390",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});