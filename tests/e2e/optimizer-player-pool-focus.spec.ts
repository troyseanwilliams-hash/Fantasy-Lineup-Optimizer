import { expect, test } from "@playwright/test";

const slate = {
  id: 845001, sport: "NFL", platform: "draftkings", name: "NFL Main Slate",
  label: "NFL Main Slate", startTime: "2099-09-13T17:00:00Z",
  isActive: true, isMain: true, gameType: "Classic", gameCount: 2,
  games: ["BUF @ HOU", "DET @ NO"],
};

const players = Array.from({ length: 30 }, (_, index) => {
  const id = index + 1;
  const bufGame = index % 2 === 0;
  return {
    id, slateId: slate.id, name: `Fixture Player ${id}`, team: bufGame ? "BUF" : "DET",
    position: ["QB", "WR", "RB", "TE", "DST"][index % 5], salary: 7400 - index * 100,
    fppg: `${24 - index / 2}`, projectedPoints: `${24 - index / 2}`, opponent: bufGame ? "HOU" : "NO",
    gameInfo: bufGame ? "BUF @ HOU 1:00 PM ET" : "NO @ DET 1:00 PM ET", boostScore: "0", injuryStatus: null,
  };
});

for (const pro of [true, false]) {
test(`${pro ? "Pro" : "Standard"} optimizer expands the player pool`, async ({ page }, testInfo) => {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/user") data = { id: "pool-test-user", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    else if (path === "/api/slates") data = [slate];
    else if (path.endsWith("/players")) data = players;
    else if (path.includes("/scout/signals")) data = { signals: [], count: 0 };
    else if (path === "/api/alerts") data = { alerts: [] };
    await route.fulfill({ json: data });
  });

  await page.goto(`/${pro ? "optimizer-pro" : "optimizer"}/${slate.id}`);
  const playerViewport = testInfo.project.name === "desktop"
    ? page.getByTestId(pro ? "pro-player-pool-scroll" : "player-pool-scroll")
    : page.getByTestId(pro ? "pro-mobile-player-pool-scroll" : "mobile-player-pool-scroll");
  await expect(playerViewport).toBeVisible();
  if (testInfo.project.name === "desktop") {
    for (const width of [1024, 1280, 1440, 1536]) {
      await page.setViewportSize({ width, height: 800 });
      const dimensions = await playerViewport.evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(dimensions.scrollWidth, `player table overflows at ${width}px`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      expect(dimensions.documentWidth, `page overflows at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      if (width < (pro ? 1536 : 1280)) {
        await expect(page.getByTestId(pro ? "pro-mobile-tab-players" : "mobile-tab-players")).toBeVisible();
      } else {
        await expect(page.getByTestId(pro ? "pro-mobile-tab-players" : "mobile-tab-players")).toBeHidden();
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  } else {
    await expect(page.getByTestId("button-player-focus-mobile")).toBeVisible();
    await page.getByTestId("button-player-focus-mobile").click();
    await expect(page.getByTestId("button-player-focus")).toHaveAttribute("aria-pressed", "true");
    await expect(playerViewport.getByText("Fixture Player 1", { exact: true })).toBeInViewport();
    await page.getByTestId("button-player-focus").click();
    await expect(page.getByTestId("button-player-focus")).toHaveAttribute("aria-pressed", "false");
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.documentWidth, "phone layout overflows horizontally").toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  }
  if (pro) {
    // Setup must remain available on the default Players tab at every width.
    await expect(page.getByTestId("btn-sim-mode-toggle")).toBeVisible();
    await expect(page.getByTestId("button-generate")).toBeVisible();
    await expect(page.getByTestId("badge-platform")).toBeVisible();
  } else if (testInfo.project.name === "desktop") {
    await expect(page.getByTestId("salary-remaining")).toBeVisible();
  }
  const lastPlayer = playerViewport.getByText("Fixture Player 30", { exact: true });
  await lastPlayer.scrollIntoViewIfNeeded();
  await expect(lastPlayer).toBeInViewport();
  await playerViewport.evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByTestId("nfl-rookie-filter-helper")).toHaveCount(0);
  if (pro) {
  await page.getByTestId("pro-mobile-tab-lineup").click();
  await page.getByTestId("btn-sim-mode-toggle").click();
  await expect(page.getByTestId("button-toggle-sim-settings")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("btn-stack-game-BUF-HOU")).toBeVisible();
  await page.screenshot({ path: `screenshots/pro-optimizer-player-pool-compact-${testInfo.project.name}.png`, fullPage: false });
  await page.getByTestId("button-toggle-sim-settings").click();
  await expect(page.getByTestId("button-toggle-sim-settings")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("btn-sim-sort-p90")).toBeVisible();
  await page.getByTestId("btn-sims-100").click();
  await page.getByTestId("btn-stack-game-BUF-HOU").click();
  await expect(page.getByTestId("btn-stack-game-BUF-HOU")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `screenshots/pro-optimizer-player-pool-expanded-${testInfo.project.name}.png`, fullPage: false });
  await page.getByTestId("pro-mobile-tab-players").click();
  }

  await page.getByTestId("button-player-focus").click();
  await expect(page.getByTestId("button-player-focus")).toHaveAttribute("aria-pressed", "true");
  const focusedViewport = await playerViewport.boundingBox();
  expect(focusedViewport?.height).toBeGreaterThanOrEqual(testInfo.project.name === "desktop" ? 400 : 300);
  await page.screenshot({ path: `screenshots/${pro ? "pro" : "standard"}-optimizer-player-pool-focused-${testInfo.project.name}.png`, fullPage: false });
  await playerViewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(playerViewport.getByText("Fixture Player 30", { exact: true })).toBeInViewport();

  await page.getByTestId("button-player-focus").click();
  await expect(page.getByTestId("button-player-focus")).toHaveAttribute("aria-pressed", "false");
  if (pro) {
    await expect(page.getByTestId("button-generate")).toContainText("100");
    await expect(page.getByTestId("btn-stack-game-BUF-HOU")).toHaveAttribute("aria-pressed", "true");
  }
});
}