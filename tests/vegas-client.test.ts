import assert from "node:assert/strict";
import test from "node:test";
import { buildVegasContext, clearVegasCache, parseESPNOdds } from "../server/vegas-client";

const fetchedAt = "2026-09-20T12:00:00.000Z";

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "game-1",
    date: "2026-09-20T17:00:00.000Z",
    status: { type: { state: "pre" } },
    competitions: [{
      competitors: [
        { homeAway: "home", team: { abbreviation: "WSH" } },
        { homeAway: "away", team: { abbreviation: "JAC" } },
      ],
      odds: [{
        provider: { id: "23", name: "ESPN BET" },
        overUnder: 44.5,
        details: "WSH -3.5",
        homeTeamOdds: { favorite: true },
        awayTeamOdds: { favorite: false },
        lastUpdated: "2026-09-20T11:55:00.000Z",
      }],
    }],
    ...overrides,
  };
}

test("ESPN parser retains provenance and normalizes NFL aliases", () => {
  const games = parseESPNOdds({ events: [event()] }, "NFL", fetchedAt);
  assert.equal(games.length, 1);
  assert.deepEqual(games[0], {
    gameKey: "JAX-WAS",
    homeTeam: "WAS",
    awayTeam: "JAX",
    total: 44.5,
    homeImplied: 24,
    awayImplied: 20.5,
    source: "espn",
    provider: "ESPN BET",
    eventTime: "2026-09-20T17:00:00.000Z",
    fetchedAt,
    updatedAt: "2026-09-20T11:55:00.000Z",
    favoriteTeam: "WAS",
    spread: 3.5,
  });
});

test("ESPN parser skips malformed, live, postgame, and stale events", () => {
  const malformed = event();
  (malformed.competitions[0].odds[0] as any).overUnder = "not-a-total";
  const live = event({ status: { type: { state: "in" } } });
  const post = event({ status: { type: { state: "post" } } });
  const stale = event({ date: "2026-09-20T11:00:00.000Z" });
  assert.deepEqual(parseESPNOdds({ events: [malformed, live, post, stale] }, "NFL", fetchedAt), []);
});

test("ESPN parser selects the first complete provider market", () => {
  const fixture = event();
  fixture.competitions[0].odds.unshift({
    provider: { id: "58", name: "Incomplete Book" },
    overUnder: undefined as any,
    details: "JAC -1",
    homeTeamOdds: { favorite: false },
    awayTeamOdds: { favorite: true },
    lastUpdated: fetchedAt,
  });
  assert.equal(parseESPNOdds({ events: [fixture] }, "NFL", fetchedAt)[0]?.provider, "ESPN BET");
});

test("primary failure uses ESPN and caches only the successful response", async () => {
  clearVegasCache();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls++;
    const url = String(input);
    if (url.includes("api.the-odds-api.com")) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ events: [event()] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const players = [{ gameInfo: "JAC @ WSH", team: "JAC" }];
    const first = await buildVegasContext(players, "NFL");
    const callsAfterFirst = calls;
    const second = await buildVegasContext(players, "NFL");
    assert.equal(first?.source, "espn");
    assert.equal(first?.games.get("JAX-WAS")?.provider, "ESPN BET");
    assert.equal(second?.source, "espn");
    assert.equal(calls, callsAfterFirst);
  } finally {
    globalThis.fetch = originalFetch;
    clearVegasCache();
  }
});

test("transient ESPN failure is not cached as verified unavailability", async () => {
  clearVegasCache();
  const originalFetch = globalThis.fetch;
  let espnAttempts = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.the-odds-api.com")) return new Response("unavailable", { status: 503 });
    espnAttempts++;
    if (espnAttempts === 1) throw new Error("temporary timeout");
    return new Response(JSON.stringify({ events: [event()] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const players = [{ gameInfo: "JAC @ WSH", team: "JAC" }];
    assert.equal(await buildVegasContext(players, "NFL"), null);
    assert.equal((await buildVegasContext(players, "NFL"))?.source, "espn");
    assert.equal(espnAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearVegasCache();
  }
});