import { expect, test, type Page } from "@playwright/test";

const slates = [
  { id: 901, sport: "NBA", platform: "draftkings", name: "Thursday Main", startTime: "2099-10-04T23:00:00Z", isActive: true, isMain: true, gameCount: 4 },
  { id: 902, sport: "NBA", platform: "draftkings", name: "Late Window", startTime: "2099-10-05T02:00:00Z", isActive: true, isMain: false, gameCount: 2 },
  { id: 903, sport: "NBA", platform: "draftkings", name: "Archived Window", startTime: "2020-10-05T02:00:00Z", isActive: false, isMain: false, gameCount: 2 },
];

const players = (slateId: number) => [
  { id: slateId * 10 + 1, slateId, name: "Alpha Guard", position: "PG", team: "ATL", salary: 9200, projectedPoints: "42.5", fppg: "40", draftKingsPlayerId: 101, isConfirmedStarter: true },
  { id: slateId * 10 + 2, slateId, name: "Bravo Wing", position: "SG/SF", team: "BOS", salary: 7100, projectedPoints: "31.4", fppg: "29", draftKingsPlayerId: 102, isConfirmedStarter: true },
];

type StoredOverride = Record<string, any>;

async function installConfigurationMock(page: Page) {
  const store: Record<number, StoredOverride> = {};
  const writes: Array<{ slateId: number; playerId: number; body: any }> = [];
  let failNextSave = false;
  const config = (id: number) => ({
    slate: slates.find(s => s.id === id),
    expiresAt: id === 903 ? "2020-10-05T02:00:00Z" : "2099-10-05T02:00:00Z",
    isExpired: id === 903,
    players: players(id),
    overrides: Object.values(store[id] ?? {}),
    exposures: id === 901
      ? { "9011": { count: 13, pct: 86.66666666666667 }, "9012": { count: 2, pct: 13.333333333333334 } }
      : { [`${id}1`]: { count: 1, pct: 25 } },
    lineupCount: id === 901 ? 8 : 4,
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/user") return route.fulfill({ json: { id: "config-user", isAdmin: false } });
    if (path === "/api/subscription") return route.fulfill({ json: { tier: "pro", lineupCount: 0, maxLineups: 100, sportCounts: {} } });
    if (path === "/api/slates") return route.fulfill({ json: slates });
    if (path === "/api/alerts") return route.fulfill({ json: { alerts: [], unreadCount: 0 } });
    const playersMatch = path.match(/^\/api\/slates\/(\d+)\/players$/);
    if (playersMatch) return route.fulfill({ json: players(Number(playersMatch[1])) });
    const configMatch = path.match(/^\/api\/player-configuration\/(\d+)$/);
    if (configMatch && request.method() === "GET") return route.fulfill({ json: config(Number(configMatch[1])) });
    const overrideMatch = path.match(/^\/api\/player-overrides\/(\d+)(?:\/(\d+))?$/);
    if (overrideMatch && request.method() === "PUT") {
      if (failNextSave) {
        failNextSave = false;
        return route.fulfill({ status: 500, body: "Database write declined" });
      }
      const slateId = Number(overrideMatch[1]);
      const playerId = Number(overrideMatch[2]);
      const body = request.postDataJSON();
      store[slateId] ??= {};
      store[slateId][playerId] = { ...body, playerId };
      writes.push({ slateId, playerId, body });
      return route.fulfill({ json: store[slateId][playerId] });
    }
    if (overrideMatch && request.method() === "DELETE") {
      const slateId = Number(overrideMatch[1]);
      if (overrideMatch[2]) delete store[slateId]?.[Number(overrideMatch[2])];
      else delete store[slateId];
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  return { store, writes, failSave: () => { failNextSave = true; } };
}

test("persists a player configuration through reload and uses the real slate-scoped PUT payload", async ({ page }) => {
  const api = await installConfigurationMock(page);
  await page.goto("/player-config?slateId=901");
  await expect(page.getByRole("heading", { name: "Player Configuration" })).toBeVisible();
  await page.getByLabel("Alpha Guard custom projection").fill("47.2");
  await page.getByLabel("Alpha Guard boost").selectOption("15");
  await page.getByLabel("Alpha Guard minimum exposure").fill("20");
  await page.getByLabel("Alpha Guard maximum exposure").fill("60");
  await page.getByLabel("Alpha Guard notes").fill("Primary tournament anchor");
  await page.getByLabel("Bravo Wing notes").fill("Keep this unsaved draft");
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  expect(api.writes[0]).toMatchObject({ slateId: 901, playerId: 9011, body: { customProjection: 47.2, boostPercent: 15, minExposure: 20, maxExposure: 60, notes: "Primary tournament anchor" } });
  await expect(page.getByLabel("Bravo Wing notes")).toHaveValue("Keep this unsaved draft");
  await page.reload();
  await expect(page.getByLabel("Alpha Guard custom projection")).toHaveValue("47.2");
  await expect(page.getByLabel("Alpha Guard boost")).toHaveValue("15");
  await expect(page.getByLabel("Alpha Guard notes")).toHaveValue("Primary tournament anchor");
});

test("supports null fields, server-backed reset and undo without crossing slate settings", async ({ page }) => {
  const api = await installConfigurationMock(page);
  await page.goto("/player-config?slateId=901");
  await page.getByLabel("Alpha Guard maximum exposure").fill("0");
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect.poll(() => api.writes.length).toBe(1);
  await page.getByLabel("Alpha Guard custom projection").fill("44");
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect.poll(() => api.writes.length).toBe(2);
  await page.getByRole("button", { name: "Reset Alpha Guard" }).click();
  await expect(page.getByText("Reset saved for Alpha Guard.")).toBeVisible();
  await page.getByRole("button", { name: "Undo reset" }).click();
  await expect.poll(() => api.writes.length).toBe(3);
  await expect(page.getByLabel("Alpha Guard custom projection")).toHaveValue("44");
  await page.goto("/player-config?slateId=902");
  await expect(page.getByText("Late Window", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Alpha Guard custom projection")).toHaveValue("");
  expect(api.store[901][9011].customProjection).toBe(44);
});

test("filters existing saved exposure by the current slate denominator and reports invalid/server errors", async ({ page }) => {
  const api = await installConfigurationMock(page);
  await page.goto("/player-config?slateId=901");
  await page.getByLabel("Alpha Guard maximum exposure").fill("60");
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect(page.getByText("86.7%")).toBeVisible();
  await page.getByText("Above saved cap").click();
  await expect(page.getByText("Alpha Guard", { exact: true })).toBeVisible();
  await expect(page.getByText("Bravo Wing")).toHaveCount(0);
  await page.getByLabel("Alpha Guard excluded").click();
  await page.getByLabel("Alpha Guard minimum exposure").fill("10");
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect(page.getByRole("alert")).toContainText("excluded player cannot have a positive minimum exposure");
  await page.reload();
  await page.getByLabel("Alpha Guard notes").fill("try server error");
  api.failSave();
  await page.getByRole("button", { name: "Save Alpha Guard" }).click();
  await expect(page.getByRole("alert")).toContainText("Database write declined");
});

test("preserves exact inactive slates as read-only and contextual links retain the selected slate", async ({ page }) => {
  await installConfigurationMock(page);
  await page.goto("/player-config?slateId=903");
  await expect(page.getByText(/settings are preserved for reference and are read-only/i)).toBeVisible();
  await expect(page.getByLabel("Alpha Guard custom projection")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Alpha Guard" })).toHaveCount(0);
  await page.goto("/optimizer/901");
  await expect(page.getByTestId("optimizer-player-configuration-link")).toHaveAttribute("href", "/player-config?slateId=901");
  await page.goto("/optimizer-pro/902");
  await expect(page.getByTestId("pro-player-configuration-link")).toHaveAttribute("href", "/player-config?slateId=902");
});