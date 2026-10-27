import { expect, test } from "@playwright/test";

for (const state of ["scheduled", "empty", "error"] as const) {
  test(`NBA home scoreboard handles ${state} feeds`, async ({ page }, testInfo) => {
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/scores/NBA") {
        return route.fulfill({
          status: state === "error" ? 503 : 200,
          json: state === "scheduled" ? [{
            id: "nba-today", sport: "NBA", status: "pre", statusDetail: "Scheduled",
            shortDetail: "7:30 PM ET", startTime: "2026-10-27T23:30:00Z",
            homeTeam: { name: "Boston Celtics", abbreviation: "BOS", score: "0" },
            awayTeam: { name: "Brooklyn Nets", abbreviation: "BKN", score: "0" },
          }] : state === "error" ? { error: "Unavailable" } : [],
        });
      }
      let data: unknown = {};
      if (path === "/api/auth/user") data = { id: "nba-scores-test", firstName: "Test", tutorialDisabled: true };
      else if (path === "/api/subscription") data = { tier: "pro" };
      else if (path === "/api/alerts") data = { alerts: [], unreadCount: 0 };
      else if (path === "/api/slates" || path.includes("/news") || path.includes("/daily-picks")) data = [];
      await route.fulfill({ json: data });
    });
    await page.goto("/");
    const panel = page.getByTestId("live-scores-section");
    if (state === "scheduled") {
      await expect(panel.getByTestId("game-card-nba-today")).toBeVisible();
      await expect(panel).toContainText("BOS");
      await expect(panel).toContainText("BKN");
      await expect(panel).toContainText("7:30 PM ET");
      await page.screenshot({ path: `screenshots/nba-scores-${testInfo.project.name}.png` });
    } else if (state === "empty") {
      await expect(panel).toContainText("No games scheduled today");
    } else {
      await expect(panel).toContainText("Game schedule is temporarily unavailable");
      await expect(panel).not.toContainText("No games scheduled today");
      await expect(panel.getByRole("button", { name: "Retry" })).toBeVisible();
      await panel.getByRole("button", { name: "Retry" }).click();
      await expect(panel).toContainText("Game schedule is temporarily unavailable");
    }
  });
}
