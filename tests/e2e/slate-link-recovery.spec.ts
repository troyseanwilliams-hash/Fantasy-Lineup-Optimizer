import { expect, test } from "@playwright/test";

for (const route of ["/optimizer", "/optimizer-pro"]) {
  test(`${route} recovers a retired duplicate slate link`, async ({ page }) => {
    const slate = {
      id: 900002, sport: "NFL", platform: "draftkings",
      name: "NFL Main Slate", label: "NFL Main Slate",
      startTime: "2099-09-13T17:00:00Z",
      isActive: true, isMain: true, gameType: "Classic",
      draftGroupId: 153069, gameCount: 14, playerCount: 1,
    };
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async intercepted => {
      const path = new URL(intercepted.request().url()).pathname;
      let data: unknown = {};
      if (path === "/api/auth/user") data = { id: "test-user", isAdmin: true };
      else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
      else if (path === "/api/slates") data = [slate];
      else if (path === "/api/slates/900001/resolve") data = slate;
      else if (path.endsWith("/players")) data = [{
        id: 1, slateId: slate.id, name: "Test Quarterback", team: "BUF",
        position: "QB", salary: 7000, fppg: "24", projectedPoints: "24",
        opponent: "HOU", gameInfo: "BUF @ HOU 1:00 PM ET",
        boostScore: "0", injuryStatus: null,
      }, {
        id: 2, slateId: slate.id, name: "Second Quarterback", team: "DET",
        position: "QB", salary: 6500, fppg: "20", projectedPoints: "20",
        opponent: "NO", gameInfo: "NO @ DET 1:00 PM ET", boostScore: "0", injuryStatus: null,
      }];
      else if (path === "/api/optimize/sim") data = { lineups: [], message: "Fixture response", simsRun: 50 };
      else if (path === "/api/alerts") data = { alerts: [] };
      else if (path.includes("/scout/signals")) data = { signals: [], count: 0 };
      await intercepted.fulfill({ json: data });
    });
    await page.goto(`${route}/900001`);
    await expect(page).toHaveURL(new RegExp(`${route}/900002$`));
    await expect(page.getByText("Test Quarterback").locator("visible=true").first()).toBeVisible();
    expect(errors).toEqual([]);
    if (route === "/optimizer-pro") {
      await page.getByTestId("btn-sim-mode-toggle").click();
      const first = page.getByTestId("btn-stack-game-BUF-HOU");
      const second = page.getByTestId("btn-stack-game-DET-NO");
      await first.click();
      await second.click();
      await expect(first).toHaveAttribute("aria-pressed", "true");
      await expect(second).toHaveAttribute("aria-pressed", "true");
      const request = page.waitForRequest(req => req.url().endsWith("/api/optimize/sim"));
      await page.getByTestId("button-generate").click();
      expect((await request).postDataJSON().stackGameKeys).toEqual(["BUF-HOU", "DET-NO"]);
      await page.getByTestId("btn-clear-stack-game").click();
      await expect(first).toHaveAttribute("aria-pressed", "false");
      await expect(second).toHaveAttribute("aria-pressed", "false");
    }
  });
}