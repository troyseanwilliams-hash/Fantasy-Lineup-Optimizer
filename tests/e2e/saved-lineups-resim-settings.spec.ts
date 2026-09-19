import { expect, test, type Page } from "@playwright/test";

const classicA = {
  id: 976101, sport: "NFL", platform: "draftkings", name: "NFL Main A",
  label: "NFL Main A", startTime: "2099-09-13T17:00:00Z", isActive: true,
  isMain: true, gameType: "Classic", gameCount: 2, draftGroupId: 876101,
};
const classicB = {
  ...classicA, id: 976102, name: "NFL Main B", label: "NFL Main B",
  startTime: "2099-09-14T17:00:00Z", draftGroupId: 876102,
};
const showdown = {
  ...classicA, id: 976103, name: "NFL Showdown", label: "NFL Showdown",
  gameType: "Showdown", gameCount: 1, draftGroupId: 876103,
};

function players(slateId: number) {
  return [
    { id: slateId + 1, slateId, name: "BUF QB", position: "QB", team: "BUF", opponent: "HOU", gameInfo: "BUF @ HOU 1:00 PM ET", salary: 7000, projectedPoints: "24" },
    { id: slateId + 2, slateId, name: "HOU WR", position: "WR", team: "HOU", opponent: "BUF", gameInfo: "BUF @ HOU 1:00 PM ET", salary: 6000, projectedPoints: "18" },
    { id: slateId + 3, slateId, name: "DET RB", position: "RB", team: "DET", opponent: "NO", gameInfo: "DET @ NO 4:00 PM ET", salary: 5800, projectedPoints: "17" },
    { id: slateId + 4, slateId, name: "NO WR", position: "WR", team: "NO", opponent: "DET", gameInfo: "DET @ NO 4:00 PM ET", salary: 5600, projectedPoints: "16" },
  ];
}

function lineup(id: number, slate: typeof classicA) {
  const snapshot = players(slate.id).slice(0, 1);
  return {
    id, sport: "NFL", platform: "draftkings", name: `Lineup ${id}`,
    totalSalary: 50000, totalProjectedPoints: "150", playerIds: snapshot.map(p => p.id),
    createdAt: "2099-09-01T12:00:00Z", slateId: slate.id, playerSnapshot: snapshot,
    gameType: slate.gameType, isShowdown: slate.gameType === "Showdown",
  };
}

async function mockApi(
  page: Page,
  saved: ReturnType<typeof lineup>[],
  requests: Record<string, unknown>[],
  excluded = false,
) {
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/lineups/sim-regenerate") {
      requests.push(request.postDataJSON());
      await route.fulfill({ json: { updated: 1, cloned: 0, failed: 0, skipped: 0, simsRun: 200, sortBy: "composite" } });
    } else if (path === "/api/auth/user") {
      await route.fulfill({ json: { id: "saved-resim-user", isAdmin: true } });
    } else if (path === "/api/subscription") {
      await route.fulfill({ json: { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} } });
    } else if (path === "/api/slates") {
      await route.fulfill({ json: [classicA, classicB, showdown] });
    } else if (path === "/api/lineups") {
      await route.fulfill({ json: saved });
    } else if (/^\/api\/slates\/\d+\/players$/.test(path)) {
      await route.fulfill({ json: players(Number(path.split("/")[3])) });
    } else if (path.startsWith("/api/player-overrides/")) {
      await route.fulfill({ json: excluded ? [{ playerId: players(classicA.id)[0].id, isExcluded: true }] : [] });
    } else {
      await route.fulfill({ json: {} });
    }
  });
}

async function selectAndOpenSettings(page: Page, id: number) {
  await page.goto("/lineups");
  await page.getByTestId(`select-lineup-${id}`).click();
  await page.getByTestId("regen-settings-btn").click();
  await expect(page.getByTestId("regen-settings-panel")).toBeVisible();
}

test("main ReSim sends FLEX restrictions and target-player game stacks", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976201, classicA)], requests);
  await selectAndOpenSettings(page, 976201);

  await page.getByTestId("resim-flex-TE").uncheck();
  await page.getByTestId("resim-stack-game-BUF-HOU").click();
  await page.getByTestId("sim-regen-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    ids: [976201],
    flexAllowedPositions: ["RB", "WR"],
    stackGameKeys: ["BUF-HOU"],
    preserveSourceSlateId: true,
  });
});

test("ReSim Without Excluded shares FLEX and game stack settings", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976202, classicA)], requests, true);
  await selectAndOpenSettings(page, 976202);

  await page.getByTestId("resim-flex-WR").uncheck();
  await page.getByTestId("resim-stack-game-DET-NO").click();
  await page.getByTestId("exposure-resim-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    flexAllowedPositions: ["RB", "TE"],
    stackGameKeys: ["DET-NO"],
  });
});

test("changing the effective target clears stale games", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976203, classicA)], requests);
  await selectAndOpenSettings(page, 976203);
  await page.getByTestId("resim-stack-game-BUF-HOU").click();
  await page.getByTestId("regen-select-slate").selectOption(String(classicB.id));
  await expect(page.getByTestId("resim-stack-game-BUF-HOU")).toHaveAttribute("aria-pressed", "false");
});

test("Showdown omits controls and mixed source slates require an explicit target", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976204, showdown), lineup(976205, classicB)], requests);
  await page.goto("/lineups");
  await page.getByTestId("select-lineup-976204").click();
  await page.getByTestId("regen-settings-btn").click();
  await expect(page.getByTestId("resim-nfl-flex-controls")).toHaveCount(0);
  await expect(page.getByTestId("resim-game-stack-controls")).toHaveCount(0);
  await page.getByTestId("sim-regen-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).not.toHaveProperty("flexAllowedPositions");
  expect(requests[0]).not.toHaveProperty("stackGameKeys");

  await expect(page.getByTestId("sim-regen-btn")).toHaveCount(0);
  await page.getByTestId("select-lineup-976204").click();
  await page.getByTestId("select-lineup-976205").click();
  await expect(page.getByTestId("resim-games-unavailable")).toBeVisible();
  await expect(page.getByTestId("resim-game-stack-controls")).toHaveCount(0);
  await page.getByTestId("regen-select-slate").selectOption(String(classicA.id));
  await expect(page.getByTestId("resim-nfl-flex-controls")).toBeVisible();
  await expect(page.getByTestId("resim-game-stack-controls")).toBeVisible();
});