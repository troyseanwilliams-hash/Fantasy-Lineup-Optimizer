import { expect, test, type Page } from "@playwright/test";

const slate = { id: 979001, name: "NFL strategy test", label: "NFL strategy test", sport: "NFL", platform: "draftkings", gameType: "Classic", startTime: "2099-09-13T17:00:00Z", isActive: true, isMain: true, draftGroupId: 879001 };
const players = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "RB", "DST", "QB"].map((position, i) => ({ id: i + 1, slateId: slate.id, name: `Test ${position} ${i}`, position, team: i % 2 ? "BUF" : "HOU", opponent: i % 2 ? "HOU" : "BUF", gameInfo: "BUF @ HOU", salary: 5000, projectedPoints: "20", fppg: "20" }));
const report = { requestedCount: 2, generatedCount: 1, candidateCount: 5, seed: 2026, partial: true, dataSources: { ownership: "off", vegas: "unavailable", rushing: "manual" }, metrics: [{ key: "stack", label: "Single stacks", target: 2, achieved: 1, unit: "lineups", status: "shortfall" }], warnings: ["Insufficient compatible candidates"] };
async function mock(page: Page, requests: any[], unsupported = false) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: any = {};
    if (route.request().method() === "POST") {
      requests.push({ path, ...route.request().postDataJSON() });
      const lineup = { lineup: players.slice(0, 9), totalSalary: 45000, totalProjectedPoints: 180 };
      data = path.includes("sim-regenerate") ? { updated: 1, failed: 1, skipped: 0, cloned: 0, simsRun: 200, sortBy: "composite", nflPortfolioReports: [{ slateId: slate.id, report }] } : { ...lineup, lineups: [{ ...lineup, medianScore: 180, compositeScore: 180 }], boostsSummary: [], injurySummary: [], nflPortfolioReport: report };
    } else if (path === "/api/auth/user") data = { id: "portfolio-test", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    else if (path === "/api/slates") data = [{ ...slate, sport: unsupported ? "NBA" : "NFL" }];
    else if (path.endsWith("/players")) data = players;
    else if (path === "/api/lineups") data = [{ id: 979101, slateId: slate.id, sport: "NFL", platform: "draftkings", name: "Saved strategy test", totalSalary: 45000, totalProjectedPoints: "180", playerIds: players.slice(0, 9).map(p => p.id), playerSnapshot: players.slice(0, 9), createdAt: "2099-09-01T00:00:00Z", gameType: "Classic" }];
    else if (path.includes("player-overrides")) data = [{ playerId: 1, isExcluded: true }];
    else if (path.includes("favorite-stacks")) data = [];
    else if (path.includes("signals")) data = { signals: [] };
    else if (path === "/api/alerts") data = { alerts: [] };
    await route.fulfill({ json: data });
  });
}

test("Pro ownership distinguishes supplied projections from model estimates", async ({ page }) => {
  await mock(page, []);
  await page.route("**/api/slates/*/players", route => route.fulfill({ json: players.map((p, index) => ({
    ...p, ownershipProjection: index === 0 ? 40.1 : 8.4,
    ownershipSource: index === 0 ? "supplied" : "estimated",
    ownershipSourceLabel: index === 0 ? "User-supplied Sunday ownership" : "Model estimate",
  })) }));
  await page.goto(`/optimizer-pro/${slate.id}`);
  await expect(page.getByTestId("ownership-source-1")).toHaveText("Supplied");
  await expect(page.getByTestId("ownership-source-2")).toHaveText("Est.");
  await expect(page.getByTestId("text-own-1")).toContainText("40.1%");
});

for (const mode of ["optimizer", "optimizer-pro"]) {
  test(`${mode}: off payload, invalid mix, enabled report and Sim count`, async ({ page }) => {
    const requests: any[] = [];
    await mock(page, requests);
    await page.goto(`/${mode}/${slate.id}`);
    const normal = mode === "optimizer";
    if (normal && await page.getByTestId("mobile-tab-lineup").isVisible()) await page.getByTestId("mobile-tab-lineup").click();
    const generate = page.getByTestId(normal ? "optimize-btn" : "button-generate");
    await generate.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].nflPortfolio).toBeUndefined();
    if (normal) await page.getByTestId("btn-gpp").click();
    await page.getByTestId("nfl-portfolio-controls").locator("summary").first().click();
    await page.getByTestId("nfl-portfolio-enabled").check();
    await page.getByLabel("QB stack naked", { exact: true }).fill("11");
    await generate.click();
    await expect(page.getByRole("alert").filter({ hasText: "QB stack percentages" }).first()).toBeVisible();
    expect(requests).toHaveLength(1);
    await page.getByLabel("QB stack naked", { exact: true }).fill("10");
    await generate.click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].nflPortfolio).toMatchObject({ enabled: true, ownershipMode: "off" });
    await expect(page.getByTestId("nfl-portfolio-report")).toContainText("Partial portfolio");
    await expect(page.getByTestId("nfl-portfolio-report")).toContainText("shortfall");
    if (!normal) {
      await page.getByTestId("btn-sim-mode-toggle").click();
      await generate.click();
      await expect.poll(() => requests.length).toBe(3);
      expect(requests[2].lineupCount).toBe(requests[2].numSims);
      expect(requests[2].nflPortfolio.enabled).toBe(true);
    }
    await page.getByTestId("nfl-portfolio-enabled").uncheck();
    await generate.click();
    await expect.poll(() => requests.length).toBe(normal ? 3 : 4);
    expect(requests.at(-1).nflPortfolio).toBeUndefined();
  });
}

test("unsupported sport explains disabled strategy", async ({ page }) => {
  await mock(page, [], true);
  await page.goto(`/optimizer-pro/${slate.id}`);
  await page.getByTestId("nfl-portfolio-controls").locator("summary").first().click();
  await expect(page.getByTestId("nfl-portfolio-enabled")).toBeDisabled();
  await expect(page.getByTestId("nfl-portfolio-controls")).toContainText("only for NFL DraftKings Classic GPP");
});

for (const entry of ["sim-regen-btn", "exposure-resim-btn"]) {
  test(`Resim ${entry} shares settings and retains target report after deselection`, async ({ page }) => {
    const requests: any[] = [];
    await mock(page, requests);
    await page.goto("/lineups");
    await page.getByTestId("select-lineup-979101").click();
    await page.getByTestId("nfl-portfolio-controls").locator("summary").first().click();
    await page.getByTestId("nfl-portfolio-enabled").check();
    await page.getByText("Advanced strategy settings", { exact: true }).click();
    await page.getByLabel("Ownership mode").selectOption("provided");
    await page.getByText("Individual ownership inputs (10 pool players)", { exact: true }).click();
    await page.getByLabel("Ownership Test QB 9 10", { exact: true }).fill("5");
    await page.getByTestId(entry).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].nflPortfolio.ownershipOverrides).toEqual({ "10": 5 });
    await expect(page.getByTestId("nfl-portfolio-report")).toContainText("NFL strategy test");
    await expect(page.getByTestId("nfl-portfolio-report")).toContainText("Partial portfolio");
  });
}