import { expect, test, type Page } from "@playwright/test";

const slate = {
  id: 910001,
  sport: "NFL",
  platform: "draftkings",
  name: "Cache Test Slate",
  label: "Cache Test Slate",
  startTime: "2099-09-13T17:00:00Z",
  isActive: true,
  isMain: true,
  gameType: "Classic",
  gameCount: 1,
  games: ["BUF @ HOU"],
};

function playersFor(user: string, version = "initial") {
  return [{
    id: 91001,
    slateId: slate.id,
    name: `${user} ${version} Player`,
    team: "BUF",
    position: "QB",
    salary: 7000,
    fppg: "20",
    projectedPoints: "20",
    opponent: "HOU",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    boostScore: "0",
    injuryStatus: null,
  }];
}

async function mockOptimizerApi(
  page: Page,
  options: {
    user?: string;
    slates?: Array<typeof slate>;
    onPlayers?: (user: string) => unknown;
  } = {},
) {
  let currentUser = options.user ?? "cache-user";
  let playerRequests = 0;
  const availableSlates = options.slates ?? [slate];

  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/user") {
      data = { id: currentUser, isAdmin: true };
    } else if (path === "/api/subscription") {
      data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    } else if (path === "/api/slates") {
      data = availableSlates;
    } else if (path.endsWith("/players")) {
      playerRequests += 1;
      data = options.onPlayers?.(currentUser) ?? playersFor(currentUser);
    } else if (path === "/api/alerts") {
      data = { alerts: [] };
    } else if (path.includes("/scout/signals")) {
      data = { signals: [], count: 0 };
    }
    await route.fulfill({ json: data });
  });

  return {
    get playerRequests() {
      return playerRequests;
    },
    setUser(user: string) {
      currentUser = user;
    },
  };
}

test("reload reuses a fresh player pool from sessionStorage", async ({ page }) => {
  const api = await mockOptimizerApi(page);

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("cache-user initial Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(1);

  await page.reload();
  await expect(page.getByText("cache-user initial Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(1);
});

test("player caches are separated by slate URL and authenticated user", async ({ page }) => {
  const secondSlate = { ...slate, id: slate.id + 1, name: "Second Cache Slate", label: "Second Cache Slate" };
  const api = await mockOptimizerApi(page, {
    slates: [slate, secondSlate],
    onPlayers: user => playersFor(user, "slate"),
  });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("cache-user slate Player").locator("visible=true").first()).toBeVisible();
  await page.goto(`/optimizer/${secondSlate.id}`);
  await expect(page.getByText("cache-user slate Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(2);

  api.setUser("different-user");
  await page.reload();
  await expect(page.getByText("different-user slate Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(3);

  const cachedKeys = await page.evaluate(() =>
    Object.keys(sessionStorage).filter(key => key.includes("player-pool")),
  );
  expect(cachedKeys.length).toBe(3);
});

test("stale session data renders while the player pool refreshes", async ({ page }) => {
  let playerRequests = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/user") data = { id: "stale-user", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    else if (path === "/api/slates") data = [slate];
    else if (path.endsWith("/players")) {
      playerRequests += 1;
      if (playerRequests > 1) await new Promise(resolve => setTimeout(resolve, 400));
      data = playersFor("stale-user", playerRequests > 1 ? "refreshed" : "initial");
    } else if (path === "/api/alerts") data = { alerts: [] };
    else if (path.includes("/scout/signals")) data = { signals: [], count: 0 };
    await route.fulfill({ json: data });
  });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("stale-user initial Player").locator("visible=true").first()).toBeVisible();
  expect(playerRequests).toBe(1);

  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(candidate => candidate.includes("player-pool"));
    if (!key) throw new Error("player session cache was not written");
    const entry = JSON.parse(sessionStorage.getItem(key) as string);
    entry.timestamp = Date.now() - 6 * 60 * 1000;
    sessionStorage.setItem(key, JSON.stringify(entry));
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("stale-user initial Player").locator("visible=true").first()).toBeVisible();
  await expect(page.getByText("stale-user refreshed Player").locator("visible=true").first()).toBeVisible();
  expect(playerRequests).toBe(2);
});

test("a failed stale refresh keeps old data and manual refresh gets server changes", async ({ page }) => {
  let playerRequests = 0;
  let allowManualRefresh = false;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/user") data = { id: "refresh-user", isAdmin: true };
    else if (path === "/api/subscription") data = { tier: "pro", maxLineups: 500, lineupCount: 0, sportCounts: {} };
    else if (path === "/api/slates") data = [slate];
    else if (path.endsWith("/players")) {
      playerRequests += 1;
      if (playerRequests === 2 && !allowManualRefresh) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "players temporarily unavailable" }),
        });
        return;
      }
      data = playersFor("refresh-user", "server-updated");
    } else if (path === "/api/alerts") data = { alerts: [] };
    else if (path.includes("/scout/signals")) data = { signals: [], count: 0 };
    await route.fulfill({ json: data });
  });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("refresh-user server-updated Player").locator("visible=true").first()).toBeVisible();

  await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(candidate => candidate.includes("player-pool"));
    if (!key) throw new Error("player session cache was not written");
    const entry = JSON.parse(sessionStorage.getItem(key) as string);
    entry.data[0].name = "refresh-user cached-old Player";
    entry.timestamp = Date.now() - 6 * 60 * 1000;
    sessionStorage.setItem(key, JSON.stringify(entry));
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("refresh-user cached-old Player").locator("visible=true").first()).toBeVisible();
  await expect(page.getByTestId("player-refresh-warning")).toBeVisible();
  expect(playerRequests).toBe(2);

  const cachedAfterFailure = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(candidate => candidate.includes("player-pool"));
    return key ? JSON.parse(sessionStorage.getItem(key) as string) : null;
  });
  expect(cachedAfterFailure?.data?.[0]?.name).toBe("refresh-user cached-old Player");

  allowManualRefresh = true;
  await page.getByTestId("button-refresh-players").click();
  await expect(page.getByText("refresh-user server-updated Player").locator("visible=true").first()).toBeVisible();
  expect(playerRequests).toBe(3);
});

test("standard and pro optimizer paths reuse the same player session cache", async ({ page }) => {
  const api = await mockOptimizerApi(page, {
    user: "shared-path-user",
    onPlayers: user => playersFor(user, "shared"),
  });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("shared-path-user shared Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(1);

  await page.goto(`/optimizer-pro/${slate.id}`);
  await expect(page.getByText("shared-path-user shared Player").locator("visible=true").first()).toBeVisible();
  expect(api.playerRequests).toBe(1);
});

test("player loading still works when sessionStorage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("sessionStorage blocked");
      },
    });
  });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await mockOptimizerApi(page, { user: "storage-blocked-user" });

  await page.goto(`/optimizer/${slate.id}`);
  await expect(page.getByText("storage-blocked-user initial Player").locator("visible=true").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

function playersForTest(user: string, version: string) {
  return [{
    id: 91001,
    slateId: slate.id,
    name: `${user} ${version} Player`,
    team: "BUF",
    position: "QB",
    salary: 7000,
    fppg: "20",
    projectedPoints: "20",
    opponent: "HOU",
    gameInfo: "BUF @ HOU 1:00 PM ET",
    boostScore: "0",
    injuryStatus: null,
  }];
}
