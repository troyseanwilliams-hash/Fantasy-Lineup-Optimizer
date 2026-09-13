import { expect, test, type Page } from "@playwright/test";

const slate = {
  id: 987601, sport: "NFL", platform: "draftkings", name: "Projection Test Slate",
  label: "Projection Test Slate", startTime: "2099-09-13T17:00:00Z",
  isActive: true, isMain: true, gameType: "Classic", gameCount: 1,
  games: ["BUF @ HOU"], salaryCap: 50000, draftGroupId: 1987601,
};
const players = Array.from({ length: 15 }, (_, index) => ({
  id: index + 1, slateId: slate.id, name: `Projection Player ${index + 1}`,
  position: ["QB", "WR", "RB", "TE", "DST"][index % 5],
  team: index % 2 ? "HOU" : "BUF", opponent: index % 2 ? "BUF" : "HOU",
  gameInfo: "BUF @ HOU 1:00 PM ET", salary: 5000,
  projectedPoints: index === 0 ? "8" : "20", fppg: "20",
  boostScore: "0", injuryStatus: null, isConfirmedStarter: false,
  draftKingsPlayerId: 9870000 + index, ownershipProjection: 10,
}));

async function mockApi(page: Page, showdown: boolean) {
  const requests: { path: string; body: Record<string, any> }[] = [];
  const selectedSlate = { ...slate, gameType: showdown ? "Showdown" : "Classic" };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path.includes("/optimize")) {
      if (showdown && !("lockedFlexIds" in request.postDataJSON())) {
        await route.fulfill({ json: { lineups: [] } });
        return;
      }
      requests.push({ path, body: request.postDataJSON() });
      await route.fulfill({ status: 400, json: { message: "Captured optimizer request." } });
      return;
    }
    let data: unknown = {};
    if (path === "/api/auth/user") data = { id: "projection-test-user", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    else if (path === "/api/slates" || path === "/api/showdown/slates") data = [selectedSlate];
    else if (path.startsWith("/api/showdown/players/")) data = {
      slate: selectedSlate, players, games: { "BUF @ HOU 1:00 PM ET": players },
    };
    else if (path.endsWith("/players")) data = players;
    else if (path.includes("/scout/signals")) data = { signals: [], count: 0 };
    else if (path.startsWith("/api/player-overrides/")) data = [];
    else if (path === "/api/alerts") data = { alerts: [] };
    await route.fulfill({ json: data });
  });
  return requests;
}

for (const mode of ["standard", "pro", "showdown"] as const) {
  test(`${mode} sends a points cutoff and manual boosts in normal and supported Sim modes`, async ({ page }) => {
    const requests = await mockApi(page, mode === "showdown");
    await page.goto(mode === "showdown" ? "/showdown" : `/${mode === "pro" ? "optimizer-pro" : "optimizer"}/${slate.id}`);
    const cutoff = page.locator('[data-testid^="input-min-projection"]:visible').first();
    await expect(cutoff).toBeVisible();
    await cutoff.fill("10");
    await expect(page.getByText(/^Min Exp(osure)?$/)).toHaveCount(0);
    const aiSwitch = page.locator('[data-testid="toggle-boosts"]:visible, [data-testid="toggle-boosts-mobile"]:visible').first();
    if (await aiSwitch.count() && await aiSwitch.getAttribute("aria-checked") === "true") await aiSwitch.click();
    const boost = page.locator('[data-testid="input-boost-1"]:visible, [data-testid="input-boost-mobile-1"]:visible').first();
    await expect(boost).toBeVisible();
    await boost.fill("5");
    const standardMobile = mode === "standard" && await page.getByTestId("mobile-tab-lineup").isVisible();
    if (standardMobile) await page.getByTestId("mobile-tab-lineup").click();
    let generate = page.getByTestId(mode === "standard" ? "optimize-btn" : mode === "pro" ? "button-generate" : "btn-optimize-showdown-top");
    await generate.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].body).toMatchObject({ minProjection: 10, playerProjections: { "1": 13 } });
    expect(requests[0].body.globalMinExposure).toBeUndefined();
    expect(requests[0].body.minExposureLimits).toBeUndefined();
    if (mode !== "standard") {
      await page.getByTestId(mode === "pro" ? "btn-sim-mode-toggle" : "toggle-sim-showdown").click();
      if (mode === "showdown") generate = page.getByTestId("btn-sim-showdown");
      await generate.click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1].path).toContain("/sim");
      expect(requests[1].body).toMatchObject({ minProjection: 10, playerProjections: { "1": 13 } });
    }
    if (standardMobile) await page.getByTestId("mobile-tab-players").click();
    await boost.fill("");
    await cutoff.fill("0");
    if (standardMobile) await page.getByTestId("mobile-tab-lineup").click();
    await generate.click();
    await expect.poll(() => requests.length).toBe(mode === "standard" ? 2 : 3);
    const reset = requests.at(-1)!.body;
    expect(reset.minProjection ?? 0).toBe(0);
    expect(reset.playerProjections?.["1"]).not.toBe(13);
  });
}