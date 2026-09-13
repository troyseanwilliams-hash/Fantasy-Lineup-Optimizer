import { expect, test, type Page } from "@playwright/test";

const slate = {
  id: 912345,
  sport: "NFL",
  platform: "draftkings",
  name: "NFL Correlation Fixture",
  label: "NFL Correlation Fixture",
  startTime: "2099-09-13T17:00:00Z",
  isActive: true,
  isMain: true,
  gameType: "Classic",
  gameCount: 1,
};

const showdownSlate = {
  ...slate,
  id: 912346,
  name: "NFL Showdown Fixture",
  gameType: "Showdown",
};

const golfSlate = {
  ...slate,
  id: 912347,
  sport: "GOLF",
  name: "PGA Tournament Fixture",
  gameType: "Classic",
};

const players = [
  {
    id: 1,
    slateId: slate.id,
    name: "Fixture QB",
    team: "BUF",
    position: "QB",
    salary: 7000,
    fppg: "24",
    projectedPoints: "24",
    opponent: "HOU",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    gameKey: "BUF-HOU",
    boostScore: "0",
    injuryStatus: null,
  },
  {
    id: 2,
    slateId: slate.id,
    name: "Fixture WR",
    team: "BUF",
    position: "WR",
    salary: 6800,
    fppg: "20",
    projectedPoints: "20",
    opponent: "HOU",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    gameKey: "BUF-HOU",
    boostScore: "0",
    injuryStatus: null,
  },
  {
    id: 3,
    slateId: slate.id,
    name: "Fixture TE",
    team: "BUF",
    position: "TE",
    salary: 5200,
    fppg: "14",
    projectedPoints: "14",
    opponent: "HOU",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    gameKey: "BUF-HOU",
    boostScore: "0",
    injuryStatus: null,
  },
  {
    id: 4,
    slateId: slate.id,
    name: "Fixture Opponent RB",
    team: "HOU",
    position: "RB",
    salary: 6100,
    fppg: "16",
    projectedPoints: "16",
    opponent: "BUF",
    gameInfo: "HOU @ BUF 1:00 PM ET",
    gameKey: "BUF-HOU",
    boostScore: "0",
    injuryStatus: null,
  },
];

type FavoriteStack = {
  id: number;
  slateId: number;
  kind: "game" | "players";
  name: string;
  gameKey: string | null;
  playerIds: number[];
};

async function mockTopStacksApi(page: Page, slateRows = [slate]) {
  const favorites: FavoriteStack[] = [];
  let nextFavoriteId = 700;
  const simPayloads: unknown[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === `/api/slates/${slate.id}/favorite-stacks`) {
      if (method === "GET") {
        await route.fulfill({ json: favorites });
        return;
      }
      if (method === "POST") {
        const body = request.postDataJSON() as Omit<FavoriteStack, "id" | "slateId">;
        const created: FavoriteStack = { ...body, id: nextFavoriteId++, slateId: slate.id };
        favorites.push(created);
        await route.fulfill({ status: 201, json: created });
        return;
      }
    }

    const deletePrefix = `/api/slates/${slate.id}/favorite-stacks/`;
    if (path.startsWith(deletePrefix) && method === "DELETE") {
      const favoriteId = Number(path.slice(deletePrefix.length));
      const index = favorites.findIndex((favorite) => favorite.id === favoriteId);
      if (index >= 0) favorites.splice(index, 1);
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    let data: unknown = {};
    if (path === "/api/auth/user") {
      data = { id: "top-stacks-browser-user", isAdmin: true };
    } else if (path === "/api/subscription") {
      data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    } else if (path === "/api/slates") {
      data = slateRows;
    } else if (path === `/api/slates/${slate.id}/players`) {
      data = players;
    } else if (path === "/api/optimize/sim" && method === "POST") {
      simPayloads.push(request.postDataJSON());
      data = { lineups: [], message: "Fixture simulation response", simsRun: 50 };
    } else if (path === "/api/alerts") {
      data = { alerts: [] };
    } else if (path.includes("/scout/signals")) {
      data = { signals: [], count: 0 };
    }
    await route.fulfill({ json: data });
  });

  return { favorites, simPayloads };
}

test("Top Stacks excludes Showdown and non-matchup Golf slates", async ({ page }) => {
  await mockTopStacksApi(page, [slate, showdownSlate, golfSlate]);

  await page.goto(`/top-stacks?slateId=${showdownSlate.id}`);

  await expect(page.getByRole("heading", { name: "Top Stacks" })).toBeVisible();
  await expect(page.getByRole("option", { name: /NFL Correlation Fixture/ })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /NFL Showdown Fixture/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /PGA Tournament Fixture/ })).toHaveCount(0);
});

async function waitForFavoriteRequest(page: Page, method: "POST" | "DELETE", action: () => Promise<void>) {
  const requestPromise = page.waitForRequest((request) => {
    const pathname = new URL(request.url()).pathname;
    return request.method() === method && (pathname === `/api/slates/${slate.id}/favorite-stacks` || (
      pathname.startsWith(`/api/slates/${slate.id}/favorite-stacks/`) && method === "DELETE"
    ));
  });
  await action();
  const request = await requestPromise;
  expect(request.method()).toBe(method);
  return request;
}

test("Top Stacks saves game and exact-player favorites for Pro Sim", async ({ page }, testInfo) => {
  const { favorites, simPayloads } = await mockTopStacksApi(page);

  await page.goto(`/top-stacks?slateId=${slate.id}`);
  await expect(page.getByRole("heading", { name: "Top Stacks" })).toBeVisible();
  await expect(page.getByText("BUF @ HOU", { exact: true }).first()).toBeVisible();

  const gameFavorite = page.getByRole("button", { name: "Favorite", exact: true }).first();
  const gameCreateRequest = await waitForFavoriteRequest(page, "POST", () => gameFavorite.click());
  expect(gameCreateRequest.postDataJSON()).toMatchObject({
    kind: "game",
    name: "BUF @ HOU",
    gameKey: "BUF-HOU",
    playerIds: [],
  });
  await expect(page.getByRole("button", { name: "Saved", exact: true }).first()).toBeVisible();

  const playerFavorite = page.getByRole("button", { name: "Save player stack", exact: true }).first();
  const playersCreateRequest = await waitForFavoriteRequest(page, "POST", () => playerFavorite.click());
  const playerFavoritePayload = playersCreateRequest.postDataJSON();
  expect(playerFavoritePayload.kind).toBe("players");
  expect(playerFavoritePayload.playerIds.length).toBeGreaterThanOrEqual(2);
  expect(playerFavoritePayload.playerIds).toEqual(expect.arrayContaining([1, 2]));
  await expect(page.getByRole("heading", { name: "Favorites" })).toBeVisible();
  expect(favorites).toHaveLength(2);
  await expect(page.getByText(favorites[1].name, { exact: true })).toBeVisible();
  const gameFavoriteId = favorites[0].id;
  const playerFavoriteId = favorites[1].id;

  if (testInfo.project.name === "desktop") {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "screenshots/top-stacks-desktop.png", fullPage: true });
  }

  await page.getByRole("link", { name: "Use favorites in Sim", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/optimizer-pro/${slate.id}\\?useFavoriteStacks=1$`));
  await expect(page.getByTestId(`btn-favorite-stack-${gameFavoriteId}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`btn-favorite-stack-${playerFavoriteId}`)).toHaveAttribute("aria-pressed", "true");

  const simRequest = page.waitForRequest((request) => (
    request.url().endsWith("/api/optimize/sim") && request.method() === "POST"
  ));
  await page.getByTestId("button-generate").click();
  await simRequest;
  expect(simPayloads).toHaveLength(1);
  expect(simPayloads[0]).toMatchObject({
    favoriteStackIds: [gameFavoriteId, playerFavoriteId],
    stackGameKeys: [],
  });

  await page.getByTestId("button-reset").click();
  await expect(page.getByTestId(`btn-favorite-stack-${gameFavoriteId}`)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId(`btn-favorite-stack-${playerFavoriteId}`)).toHaveAttribute("aria-pressed", "false");

  await page.goto(`/top-stacks?slateId=${slate.id}`);
  const removeGame = page.getByRole("button", { name: "Remove BUF @ HOU", exact: true });
  const deleteRequest = await waitForFavoriteRequest(page, "DELETE", () => removeGame.click({ force: true }));
  expect(deleteRequest.url()).toContain(`/favorite-stacks/${gameFavoriteId}`);
  await expect(removeGame).toHaveCount(0);
  expect(favorites).toHaveLength(1);

  await page.getByRole("link", { name: "Use favorites in Sim", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/optimizer-pro/${slate.id}\\?useFavoriteStacks=1$`));
  await expect(page.getByTestId(`btn-favorite-stack-${playerFavoriteId}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`btn-favorite-stack-${gameFavoriteId}`)).toHaveCount(0);

  const secondSimRequest = page.waitForRequest((request) => (
    request.url().endsWith("/api/optimize/sim") && request.method() === "POST"
  ));
  await page.getByTestId("button-generate").click();
  await secondSimRequest;
  expect(simPayloads).toHaveLength(2);
  expect(simPayloads[1]).toMatchObject({
    favoriteStackIds: [playerFavoriteId],
    stackGameKeys: [],
  });
});