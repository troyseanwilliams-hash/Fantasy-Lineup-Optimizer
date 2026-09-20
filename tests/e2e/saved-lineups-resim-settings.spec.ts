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

async function setMaxExposureTo80(page: Page) {
  const slider = page.getByTestId("regen-slider-exposure").getByRole("slider");
  await slider.focus();
  await slider.press("End");
  for (let i = 0; i < 4; i++) await slider.press("ArrowLeft");
  await expect(page.getByTestId("regen-text-exposure")).toHaveText("80%");
}

test("Resim failure shows a readable explanation and preserves selected lineups", async ({ page }) => {
  await mockApi(page, [lineup(976201, classicA)], []);
  const message = "Only 137 valid candidates were found for 193 requested lineups. No lineups were saved.";
  await page.route("**/api/lineups/sim-regenerate", route => route.fulfill({
    status: 400, json: { message },
  }));
  await page.goto("/lineups");
  await page.getByTestId("select-lineup-976201").click();
  await page.getByTestId("sim-regen-btn").click();
  await expect(page.getByText("Sim Regeneration Failed", { exact: true })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByTestId("sim-regen-btn")).toBeEnabled();
  await expect(page.getByText(`400: {"message":"${message}"}`, { exact: true })).toHaveCount(0);
});

test("main ReSim sends FLEX restrictions and target-player game stacks", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976201, classicA)], requests);
  await selectAndOpenSettings(page, 976201);

  await page.getByTestId("resim-flex-TE").uncheck();
  await page.getByTestId("resim-stack-game-BUF-HOU").click();
  await setMaxExposureTo80(page);
  await page.getByTestId("sim-regen-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    ids: [976201],
    flexAllowedPositions: ["RB", "WR"],
    stackGameKeys: ["BUF-HOU"],
    globalMaxExposure: 80,
    preserveSourceSlateId: true,
  });
});

test("ReSim Without Excluded shares FLEX and game stack settings", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await mockApi(page, [lineup(976202, classicA)], requests, true);
  await selectAndOpenSettings(page, 976202);

  await page.getByTestId("resim-flex-WR").uncheck();
  await page.getByTestId("resim-stack-game-DET-NO").click();
  await setMaxExposureTo80(page);
  await page.getByTestId("exposure-resim-btn").click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    flexAllowedPositions: ["RB", "TE"],
    stackGameKeys: ["DET-NO"],
    globalMaxExposure: 80,
  });
});

test("exposure denominator follows selected scope and clearly distinguishes all saved", async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  const first = lineup(976211, classicA);
  const second = lineup(976212, classicA);
  second.playerSnapshot = [players(classicA.id)[1]];
  second.playerIds = second.playerSnapshot.map(player => player.id);
  await mockApi(page, [first, second], requests);

  await page.goto("/lineups");
  await page.getByTestId("select-lineup-976211").click();

  await expect(page.getByTestId("exposure-scope-description")).toContainText("Current selected scope: 1 lineup");
  await expect(page.getByTestId("exposure-table").getByText("1/1")).toBeVisible();

  await page.getByTestId("exposure-scope-all").click();
  await expect(page.getByTestId("exposure-scope-description")).toContainText("Current saved-vault scope: 2 lineups");
  await expect(page.getByTestId("exposure-scope-description")).toContainText("preserved source lineups and new clones combined may exceed that cap");
  await expect(page.getByTestId("exposure-table").getByText("1/2").first()).toBeVisible();
});

test("source-preserving clones report exposure for the identified ReSim batch, not old plus new rows", async ({ page }) => {
  const coker = { ...players(classicA.id)[0], name: "Coker" };
  const other = { ...players(classicA.id)[1], name: "Other Player" };
  const saved = Array.from({ length: 15 }, (_, index) => {
    const row = lineup(977000 + index, classicA);
    row.playerSnapshot = [coker];
    row.playerIds = [coker.id];
    return row;
  });

  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/lineups/sim-regenerate") {
      const clones = Array.from({ length: 15 }, (_, index) => {
        const source = saved[index];
        const clone = {
          ...source,
          id: 978000 + index,
          name: `Clone ${index + 1}`,
          playerSnapshot: [index < 12 ? coker : other],
          playerIds: [index < 12 ? coker.id : other.id],
        };
        saved.push(clone);
        return { sourceLineupId: source.id, newLineupId: clone.id, status: "cloned" };
      });
      await route.fulfill({ json: { updated: 0, cloned: 15, failed: 0, skipped: 0, simsRun: 200, sortBy: "composite", results: clones } });
    } else if (path === "/api/auth/user") {
      await route.fulfill({ json: { id: "saved-resim-user", isAdmin: true } });
    } else if (path === "/api/subscription") {
      await route.fulfill({ json: { tier: "pro", maxLineups: 500, lineupCount: saved.length, sportCounts: {} } });
    } else if (path === "/api/slates") {
      await route.fulfill({ json: [classicA, classicB, showdown] });
    } else if (path === "/api/lineups") {
      await route.fulfill({ json: saved });
    } else if (/^\/api\/slates\/\d+\/players$/.test(path)) {
      await route.fulfill({ json: players(Number(path.split("/")[3])) });
    } else if (path.startsWith("/api/player-overrides/")) {
      await route.fulfill({ json: [] });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto("/lineups");
  await page.getByTestId("select-all-btn").click();
  await page.getByTestId("sim-regen-btn").click();

  await expect(page.getByTestId("exposure-scope-last-resim")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("exposure-scope-description")).toContainText("last successful ReSim batch scope: 15 lineups");
  await expect(page.getByTestId("exposure-table").getByText("12/15")).toBeVisible();

  await page.getByTestId("exposure-scope-all").click();
  await expect(page.getByTestId("exposure-scope-description")).toContainText("saved-vault scope: 30 lineups");
  await expect(page.getByTestId("exposure-table").getByText("27/30")).toBeVisible();
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