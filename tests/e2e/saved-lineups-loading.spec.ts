import { expect, test, type Page, type Download } from "@playwright/test";

const normalSlate = {
  id: 920001,
  sport: "NFL",
  platform: "draftkings",
  name: "Future NFL Main Slate",
  label: "Future NFL Main Slate",
  startTime: "2099-09-13T17:00:00Z",
  isActive: true,
  isMain: true,
  gameType: "Classic",
  gameCount: 8,
  games: ["BUF @ HOU", "DET @ NO"],
};

const showdownSlate = {
  id: 920002,
  sport: "NFL",
  platform: "draftkings",
  name: "Future NFL Showdown Slate",
  label: "Future NFL Showdown Slate",
  startTime: "2099-09-13T20:20:00Z",
  isActive: true,
  isMain: false,
  gameType: "Showdown",
  gameCount: 1,
  games: ["BUF @ HOU"],
};

type FixturePlayer = {
  id: number;
  slateId: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  fppg: string;
  projectedPoints: string;
  opponent: string;
  gameInfo: string;
  injuryStatus: null;
  injuryDetail: null;
  boostScore: string;
  boostReason: string;
  draftKingsPlayerId: number;
  isConfirmedStarter: boolean;
  slot?: string;
  isCaptain?: boolean;
};

type FixtureLineup = {
  id: number;
  sport: string;
  platform: string;
  name: string;
  totalSalary: number;
  totalProjectedPoints: string;
  playerIds: number[];
  createdAt: string;
  slateId: number;
  playerSnapshot: FixturePlayer[];
  gameType: string;
  isShowdown: boolean;
  players?: FixturePlayer[];
  allPlayers?: FixturePlayer[];
  reviewedAt?: string;
  status?: string;
};

type ListMode = "success" | "fail" | "fail-next";

function makePlayer(
  id: number,
  slateId: number,
  name: string,
  position: string,
  salary: number,
  projectedPoints: number,
  team = "BUF",
  slot?: string,
  isCaptain = false,
): FixturePlayer {
  return {
    id,
    slateId,
    name,
    team,
    position,
    salary,
    fppg: projectedPoints.toFixed(1),
    projectedPoints: projectedPoints.toFixed(1),
    opponent: team === "BUF" ? "HOU" : "BUF",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    injuryStatus: null,
    injuryDetail: null,
    boostScore: "0",
    boostReason: "Saved lineup fixture",
    draftKingsPlayerId: 700000 + id,
    isConfirmedStarter: true,
    ...(slot ? { slot } : {}),
    ...(isCaptain ? { isCaptain: true } : {}),
  };
}

const normalPlayers: FixturePlayer[] = [
  makePlayer(92101, normalSlate.id, "Vault QB", "QB", 7000, 24),
  makePlayer(92102, normalSlate.id, "Vault RB 1", "RB", 6000, 18),
  makePlayer(92103, normalSlate.id, "Vault RB 2", "RB", 5800, 17),
  makePlayer(92104, normalSlate.id, "Vault WR 1", "WR", 5800, 17),
  makePlayer(92105, normalSlate.id, "Vault WR 2", "WR", 5600, 16),
  makePlayer(92106, normalSlate.id, "Vault WR 3", "WR", 5400, 15),
  makePlayer(92107, normalSlate.id, "Vault WR Flex", "WR", 5200, 14),
  makePlayer(92108, normalSlate.id, "Vault TE", "TE", 4500, 12),
  makePlayer(92109, normalSlate.id, "Vault DST", "DST", 3000, 8, "HOU"),
];

const showdownPlayers: FixturePlayer[] = [
  makePlayer(92201, showdownSlate.id, "Showdown CPT", "QB", 9000, 30, "BUF", "CPT", true),
  makePlayer(92202, showdownSlate.id, "Showdown FLEX 1", "RB", 8200, 24, "BUF", "FLEX1"),
  makePlayer(92203, showdownSlate.id, "Showdown FLEX 2", "WR", 8000, 22, "BUF", "FLEX2"),
  makePlayer(92204, showdownSlate.id, "Showdown FLEX 3", "TE", 7800, 20, "HOU", "FLEX3"),
  makePlayer(92205, showdownSlate.id, "Showdown FLEX 4", "WR", 7600, 19, "HOU", "FLEX4"),
  makePlayer(92206, showdownSlate.id, "Showdown FLEX 5", "DST", 7400, 18, "HOU", "FLEX5"),
];

function makeLineup(
  id: number,
  slate: typeof normalSlate | typeof showdownSlate,
  name: string,
  players: FixturePlayer[],
  projection: number,
): FixtureLineup {
  return {
    id,
    sport: "NFL",
    platform: "draftkings",
    name,
    totalSalary: players.reduce((sum, player) => sum + player.salary, 0),
    totalProjectedPoints: String(projection),
    playerIds: players.map(player => player.id),
    createdAt: "2099-09-01T12:00:00Z",
    slateId: slate.id,
    playerSnapshot: players,
    gameType: slate.gameType,
    isShowdown: slate.gameType === "Showdown",
  };
}

function makeManyLineups(): FixtureLineup[] {
  return Array.from({ length: 12 }, (_, index) => {
    if (index === 1) {
      return makeLineup(93002, showdownSlate, "Saved Showdown Lineup", showdownPlayers, 179);
    }
    return makeLineup(
      93001 + index,
      normalSlate,
      index === 0 ? "Saved Normal Lineup" : `Saved Normal Lineup ${index + 1}`,
      normalPlayers,
      180 - index,
    );
  });
}

function makeReviewLineup(): FixtureLineup {
  return {
    ...makeLineup(94001, normalSlate, "Review Fixture Lineup", normalPlayers, 142),
    players: normalPlayers,
    allPlayers: normalPlayers,
    reviewedAt: "2099-09-14T03:00:00Z",
    status: "review",
  };
}

async function mockSavedLineupsApi(
  page: Page,
  options: {
    lineups?: FixtureLineup[];
    reviewLineups?: FixtureLineup[];
    initialLineupsFailure?: boolean;
    initialReviewFailure?: boolean;
  } = {},
) {
  const lineups = options.lineups ?? makeManyLineups();
  const reviewLineups = options.reviewLineups ?? [makeReviewLineup()];
  const details = new Map(
    lineups.map(lineup => [
      lineup.id,
      {
        ...lineup,
        players: lineup.playerSnapshot,
        allPlayers: lineup.playerSnapshot,
      },
    ]),
  );

  let activeMode: ListMode = options.initialLineupsFailure ? "fail" : "success";
  let reviewMode: ListMode = options.initialReviewFailure ? "fail" : "success";
  let authReady = false;
  let lineupsBeforeAuth = 0;
  let reviewBeforeAuth = 0;
  const detailRequests: number[] = [];

  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === "/api/auth/user") {
      authReady = true;
      await route.fulfill({ json: { id: "saved-lineups-user", isAdmin: true } });
      return;
    }

    if (path === "/api/subscription") {
      await route.fulfill({ json: { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} } });
      return;
    }

    if (path === "/api/slates") {
      await route.fulfill({ json: [normalSlate, showdownSlate] });
      return;
    }

    if (path.startsWith("/api/player-overrides/")) {
      await route.fulfill({ json: [] });
      return;
    }

    if (path === "/api/lineups/review") {
      if (!authReady) reviewBeforeAuth++;
      if (reviewMode === "fail" || reviewMode === "fail-next") {
        if (reviewMode === "fail-next") reviewMode = "success";
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "review lineups temporarily unavailable" }),
        });
        return;
      }
      await route.fulfill({ json: reviewLineups });
      return;
    }

    if (path === "/api/lineups") {
      if (!authReady) lineupsBeforeAuth++;
      if (activeMode === "fail" || activeMode === "fail-next") {
        if (activeMode === "fail-next") activeMode = "success";
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "saved lineups temporarily unavailable" }),
        });
        return;
      }
      await route.fulfill({ json: lineups });
      return;
    }

    if (path.startsWith("/api/lineups/")) {
      const lineupId = Number(path.split("/").pop());
      const detail = details.get(lineupId);
      if (!detail) {
        await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
        return;
      }
      detailRequests.push(lineupId);
      await route.fulfill({ json: detail });
      return;
    }

    await route.fulfill({ json: {} });
  });

  return {
    setLineupsMode(mode: ListMode) {
      activeMode = mode;
    },
    setReviewMode(mode: ListMode) {
      reviewMode = mode;
    },
    get lineupsBeforeAuth() {
      return lineupsBeforeAuth;
    },
    get reviewBeforeAuth() {
      return reviewBeforeAuth;
    },
    get detailRequests() {
      return detailRequests;
    },
  };
}

async function gotoLineups(page: Page) {
  const authResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/auth/user" && response.request().method() === "GET";
  });
  await page.goto("/lineups");
  await authResponse;
}

async function changeRouteWithoutReload(page: Page, path: string) {
  await page.evaluate(nextPath => {
    history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("saved normal and showdown summary cards expand snapshots and scroll to the final card", async ({ page }) => {
  const lineups = makeManyLineups();
  const api = await mockSavedLineupsApi(page, { lineups });

  await gotoLineups(page);
  await expect(page.getByTestId("vault-title")).toBeVisible();
  expect(api.lineupsBeforeAuth).toBe(0);

  const normalCard = page.getByTestId(`lineup-card-${lineups[0].id}`);
  const showdownCard = page.getByTestId(`lineup-card-${lineups[1].id}`);
  await expect(normalCard).toContainText("Saved Normal Lineup");
  await expect(normalCard).toContainText("NFL · DK");
  await expect(showdownCard).toContainText("Saved Showdown Lineup");
  await expect(showdownCard).toContainText("NFL · DK");
  await expect(page.locator('[data-testid^="lineup-card-"]')).toHaveCount(12);

  await normalCard.getByTestId(`lineup-header-${lineups[0].id}`).click();
  await expect(page.getByTestId(`roster-table-${lineups[0].id}`)).toBeVisible();
  await expect(page.locator(`[data-testid^="roster-row-${lineups[0].id}-"]`)).toHaveCount(9);
  await expect(page.getByTestId(`roster-row-${lineups[0].id}-QB`)).toContainText("Vault QB");
  await expect(page.getByTestId(`roster-row-${lineups[0].id}-DST`)).toContainText("Vault DST");
  expect(api.detailRequests).toContain(lineups[0].id);

  await showdownCard.getByTestId(`lineup-header-${lineups[1].id}`).click();
  await expect(page.getByTestId(`roster-table-${lineups[1].id}`)).toBeVisible();
  await expect(page.locator(`[data-testid^="roster-row-${lineups[1].id}-"]`)).toHaveCount(6);
  await expect(page.getByTestId(`roster-row-${lineups[1].id}-CPT`)).toContainText("Showdown CPT");
  expect(api.detailRequests).toContain(lineups[1].id);

  const finalCard = page.getByTestId(`lineup-card-${lineups[lineups.length - 1].id}`);
  await finalCard.scrollIntoViewIfNeeded();
  await expect(finalCard).toBeInViewport();
});

test("bulk export separates slates and uses verified captain and flex IDs", async ({ page }) => {
  const lineups = makeManyLineups().slice(0, 2);
  await mockSavedLineupsApi(page, { lineups });
  await page.route("**/api/exports/resolve-players", async route => {
    const body = route.request().postDataJSON();
    const lineup = lineups.find(item => item.slateId === body.slateId)!;
    const slate = body.slateId === normalSlate.id ? normalSlate : showdownSlate;
    await route.fulfill({ json: {
      slate: { ...slate, draftGroupId: slate.id + 100 },
      players: lineup.playerSnapshot.map(player => ({
        ...player,
        draftKingsPlayerId: player.id + (body.captainId === player.id ? 20000000 : 10000000),
      })),
    } });
  });
  await gotoLineups(page);
  await page.getByTestId("select-all-btn").click();
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await page.getByTestId("bulk-export-btn").click();
  await expect.poll(() => downloads.length).toBe(2);
  const files = await Promise.all(downloads.map(async download => {
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream!) text += chunk.toString();
    return { name: download.suggestedFilename(), text };
  }));
  const classic = files.find(file => /^"?QB"?,/.test(file.text))!;
  const showdown = files.find(file => /^"?CPT"?,/.test(file.text))!;
  expect(classic).toBeTruthy();
  expect(showdown).toBeTruthy();
  expect(classic.name).toContain(String(normalSlate.id));
  expect(showdown.name).toContain(String(showdownSlate.id));
  expect(classic.text.trim().split("\n")).toHaveLength(2);
  expect(showdown.text.trim().split("\n")).toHaveLength(2);
  const captain = lineups[1].playerSnapshot.find(player => player.isCaptain)!;
  expect(showdown.text).toContain(`(${captain.id + 20000000})`);
  expect(showdown.text).not.toContain(`(${captain.id + 10000000})`);
});

test("export refuses unverifiable slate IDs instead of downloading an invalid file", async ({ page }) => {
  const lineups = makeManyLineups().slice(0, 1);
  await mockSavedLineupsApi(page, { lineups });
  await page.route("**/api/exports/resolve-players", route =>
    route.fulfill({ status: 409, json: { message: "Player IDs could not be verified for this slate." } }));
  await gotoLineups(page);
  await page.getByTestId("select-all-btn").click();
  const downloads: Download[] = [];
  page.on("download", download => downloads.push(download));
  await page.getByTestId("bulk-export-btn").click();
  await expect(page.getByText(/Player IDs could not be verified for this slate/).first()).toBeVisible();
  expect(downloads).toHaveLength(0);
});

test("a failed saved-lineups GET shows its error, recovers, and preserves cards after a failed refresh", async ({ page }) => {
  const lineups = makeManyLineups().slice(0, 2);
  const api = await mockSavedLineupsApi(page, {
    lineups,
    initialLineupsFailure: true,
  });

  await gotoLineups(page);
  await expect(page.getByTestId("saved-lineups-error")).toBeVisible();
  await expect(page.getByTestId("no-lineups-message")).toHaveCount(0);
  expect(api.lineupsBeforeAuth).toBe(0);

  api.setLineupsMode("success");
  await page.getByTestId("refresh-saved-lineups").click();
  await expect(page.getByTestId(`lineup-card-${lineups[0].id}`)).toBeVisible();
  await expect(page.getByTestId("saved-lineups-error")).toHaveCount(0);

  // Refresh against a loaded list: a failed response must not discard it.
  api.setLineupsMode("fail-next");
  const failedRefresh = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/lineups" && response.status() === 503;
  });
  await page.getByTestId("refresh-saved-lineups").click();
  await failedRefresh;

  await expect(page.getByTestId(`lineup-card-${lineups[0].id}`)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not be refreshed");
  await expect(page.getByTestId("saved-lineups-error")).toHaveCount(0);
});

test("review GET errors show Retry and recover on the next request", async ({ page }) => {
  const api = await mockSavedLineupsApi(page, { initialReviewFailure: true });

  await gotoLineups(page);
  await expect(page.getByTestId("vault-title")).toBeVisible();
  await page.getByTestId("tab-review").click();

  await expect(page.getByRole("alert")).toContainText("Review lineups could not be loaded");
  const retryButton = page.getByRole("button", { name: "Retry" });
  await expect(retryButton).toBeVisible();
  expect(api.reviewBeforeAuth).toBe(0);

  api.setReviewMode("success");
  await retryButton.click();
  await expect(page.getByTestId("review-lineups-list")).toBeVisible();
  await expect(page.getByTestId("review-lineup-card-94001")).toContainText("Review Fixture Lineup");
});