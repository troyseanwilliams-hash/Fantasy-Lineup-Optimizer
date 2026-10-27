import assert from "node:assert/strict";
import test from "node:test";
import { getLiveScores } from "../server/espn-scores";

test("NBA scoreboard fetches and caches the basketball schedule", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.equal(String(input), "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
    return Response.json({ events: [{
      id: "nba-today", date: "2026-10-27T23:30:00Z",
      status: { type: { state: "pre", detail: "Scheduled" } },
      competitions: [{ competitors: [
        { homeAway: "home", team: { displayName: "Boston Celtics", abbreviation: "BOS" } },
        { homeAway: "away", team: { displayName: "Brooklyn Nets", abbreviation: "BKN" } },
      ] }],
    }] });
  };
  try {
    const scores = await getLiveScores("NBA");
    assert.equal(scores.length, 1);
    assert.equal(scores[0].sport, "NBA");
    assert.equal(scores[0].status, "pre");
    assert.ok("homeTeam" in scores[0]);
    assert.equal(scores[0].homeTeam.abbreviation, "BOS");
    assert.deepEqual(await getLiveScores("NBA"), scores);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("score provider failures are not returned or cached as an empty schedule", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Unavailable", { status: 503 });
  };
  try {
    await assert.rejects(getLiveScores("NHL"), /503/);
    await assert.rejects(getLiveScores("NHL"), /503/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
