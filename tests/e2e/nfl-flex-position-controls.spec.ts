import { expect, test, type Page } from "@playwright/test";

const slate = {
  id: 975001,
  sport: "NFL",
  platform: "draftkings",
  name: "NFL Classic FLEX Fixture",
  label: "NFL Classic FLEX Fixture",
  startTime: "2099-09-13T17:00:00Z",
  isActive: true,
  isMain: true,
  gameType: "Classic",
  gameCount: 1,
  games: ["BUF @ HOU"],
  salaryCap: 50000,
};

const players = [
  ["QB", "Fixture QB"],
  ["RB", "Fixture RB 1"],
  ["RB", "Fixture RB 2"],
  ["RB", "Fixture RB 3"],
  ["WR", "Fixture WR 1"],
  ["WR", "Fixture WR 2"],
  ["WR", "Fixture WR 3"],
  ["TE", "Fixture TE 1"],
  ["TE", "Fixture TE 2"],
  ["DST", "Fixture DST"],
].map(([position, name], index) => ({
  id: index + 1,
  slateId: slate.id,
  name,
  position,
  team: index % 2 ? "HOU" : "BUF",
  opponent: index % 2 ? "BUF" : "HOU",
  gameInfo: "BUF @ HOU 1:00 PM ET",
  salary: 5000,
  projectedPoints: `${25 - index}`,
  fppg: `${25 - index}`,
  boostScore: "0",
  boostReason: "",
  injuryStatus: null,
  injuryDetail: null,
  isConfirmedStarter: true,
  ownershipProjection: 10,
}));

function classicLineup() {
  const lineup = players.filter(player => player.name !== "Fixture TE 2");
  return {
    lineup,
    totalSalary: lineup.reduce((sum, player) => sum + player.salary, 0),
    totalProjectedPoints: lineup.reduce((sum, player) => sum + Number(player.projectedPoints), 0),
  };
}

async function mockApi(page: Page, requests: Array<{ path: string; body: Record<string, unknown> }>) {
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = {};

    if (request.method() === "POST" && path.includes("/optimize")) {
      requests.push({ path, body: request.postDataJSON() as Record<string, unknown> });
      data = path.endsWith("/sim") ? {
        lineups: [{ ...classicLineup(), medianScore: 150, p75Score: 160, p90Score: 170, avgSimScore: 150, compositeScore: 155, evScore: 1 }],
        simsRun: 50,
        uniqueLineups: 1,
        elapsedMs: 10,
        gamesRepresented: 1,
      } : path.endsWith("/pro") ? {
        lineups: [classicLineup()],
        boostsSummary: [],
        injurySummary: [],
      } : classicLineup();
    } else if (path === "/api/auth/user") {
      data = { id: "nfl-flex-test-user", isAdmin: true };
    } else if (path === "/api/subscription") {
      data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    } else if (path === "/api/slates") {
      data = [slate];
    } else if (path.endsWith("/players")) {
      data = players;
    } else if (path.startsWith("/api/player-overrides/")) {
      data = [];
    } else if (path === "/api/scout/status") {
      data = { next_refresh: 3600, per_sport: { NFL: { signal_count: 0, boost_count: 0, injury_count: 0, next_refresh: 3600 } } };
    } else if (path.includes("/scout/signals")) {
      data = { signals: [], count: 0 };
    } else if (path === "/api/alerts") {
      data = { alerts: [] };
    }

    await route.fulfill({ json: data });
  });
}

for (const mode of ["standard", "pro"] as const) {
  test(`${mode} sends selected NFL FLEX positions in normal and Pro Sim requests`, async ({ page }) => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApi(page, requests);
    await page.goto(`/${mode === "pro" ? "optimizer-pro" : "optimizer"}/${slate.id}`);

    // The desktop and mobile controls share state; use whichever settings row
    // is visible in the current responsive project.
    const controls = page.locator('[data-testid="nfl-flex-controls"]:visible, [data-testid="nfl-flex-controls-mobile"]:visible').first();
    await expect(controls).toBeVisible();
    const visibleControlsId = (await controls.getAttribute("data-testid"))!;
    for (const position of ["RB", "WR", "TE"]) {
      await expect(controls.getByTestId(`${visibleControlsId}-${position}`)).toBeChecked();
    }
    for (const position of ["WR", "TE"]) {
      await controls.getByTestId(`${visibleControlsId}-${position}`).uncheck();
    }
    await expect(controls.getByTestId(`${visibleControlsId}-RB`)).toBeChecked();
    await expect(controls.getByTestId(`${visibleControlsId}-WR`)).not.toBeChecked();
    await expect(controls.getByTestId(`${visibleControlsId}-TE`)).not.toBeChecked();
    await expect(controls.getByTestId(`${visibleControlsId}-RB`)).toBeDisabled();

    if (mode === "standard" && await page.getByTestId("mobile-tab-lineup").isVisible()) {
      await page.getByTestId("mobile-tab-lineup").click();
    }
    await page.getByTestId(mode === "standard" ? "optimize-btn" : "button-generate").click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].body).toMatchObject({ flexAllowedPositions: ["RB"] });
    if (mode === "standard") {
      await expect(page.getByTestId("slot-TE")).toContainText("Fixture TE 1");
      await expect(page.getByTestId("slot-FLEX")).toContainText("Fixture RB");
      await expect(page.getByTestId("slot-FLEX")).not.toContainText("Fixture TE");
    }

    if (mode === "pro") {
      await page.getByTestId("btn-sim-mode-toggle").click();
      await page.getByTestId("button-generate").click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1].path).toContain("/api/optimize/sim");
      expect(requests[1].body).toMatchObject({ flexAllowedPositions: ["RB"] });
    }

    await page.getByTestId(mode === "standard" ? "reset-btn" : "button-reset").click();
    const resetControls = page.locator('[data-testid="nfl-flex-controls"]:visible, [data-testid="nfl-flex-controls-mobile"]:visible').first();
    const resetControlsId = (await resetControls.getAttribute("data-testid"))!;
    for (const position of ["RB", "WR", "TE"]) {
      await expect(resetControls.getByTestId(`${resetControlsId}-${position}`)).toBeChecked();
    }
  });
}

test("NFL Showdown does not render or send classic FLEX position restrictions", async ({ page }) => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let data: unknown = {};
    if (request.method() === "POST" && path.includes("/optimize")) {
      requests.push({ path, body: request.postDataJSON() as Record<string, unknown> });
      data = { lineups: [] };
    } else if (path === "/api/auth/user") {
      data = { id: "nfl-showdown-flex-test-user", isAdmin: true };
    } else if (path === "/api/subscription") {
      data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    } else if (path === "/api/slates") {
      data = [{ ...slate, gameType: "Showdown" }];
    } else if (path.endsWith("/players")) {
      data = players;
    } else if (path.startsWith("/api/player-overrides/")) {
      data = [];
    } else if (path === "/api/scout/status") {
      data = { next_refresh: 3600, per_sport: { NFL: { signal_count: 0, boost_count: 0, injury_count: 0, next_refresh: 3600 } } };
    } else if (path.includes("/scout/signals")) {
      data = { signals: [], count: 0 };
    } else if (path === "/api/alerts") {
      data = { alerts: [] };
    }
    await route.fulfill({ json: data });
  });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByTestId("nfl-flex-controls")).toHaveCount(0);
  await expect(page.getByTestId("nfl-flex-controls-mobile")).toHaveCount(0);
});