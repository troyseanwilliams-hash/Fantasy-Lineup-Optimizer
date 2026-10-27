import { expect, test } from "@playwright/test";

test("NBA menus expose the existing optimizer and simulation entry points", async ({ page }, testInfo) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/user") data = { id: "nba-menu-test", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro" };
    else if (path === "/api/slates") data = [{
      id: 987001, sport: "NBA", platform: "draftkings", isMain: true,
      isActive: true, name: "NBA Main", startTime: "2099-10-28T23:00:00Z",
      gameType: "Classic",
    }];
    else if (path === "/api/alerts") data = { alerts: [], unreadCount: 0 };
    await route.fulfill({ json: data });
  });
  await page.goto("/lineups");
  const desktop = testInfo.project.name === "desktop";
  await page.getByTestId(desktop ? "sport-selector" : "mobile-menu-btn").click();
  if (desktop) {
    await expect(page.getByTestId("sport-menu-nba-dk")).toBeEnabled();
    await expect(page.getByTestId("sport-menu-nba-dk").locator("..")).toHaveAttribute("href", "/optimizer/987001");
    await expect(page.getByTestId("sport-menu-nba-pro-dk").locator("..")).toHaveAttribute("href", "/optimizer-pro/987001");
  } else {
    await expect(page.getByTestId("mobile-sport-nba-dk")).toBeEnabled();
    await expect(page.getByTestId("mobile-sport-nba-pro")).toBeEnabled();
  }
  await page.screenshot({ path: `screenshots/nba-menu-${testInfo.project.name}.png` });
});
