import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "../shared/schema";
import {
  NFL_PRACTICE_SQUAD_DETAIL,
  applyNFLRosterEligibility,
  clearNFLRosterEligibilityCache,
  normalizeNFLPlayerName,
  parseNFLRoster,
  protectNFLPracticeSquadMarker,
  rosterStatusForPlayer,
} from "../server/nfl-roster-eligibility";

function player(overrides: Partial<Player>): Player {
  return {
    id: 1,
    slateId: 10,
    name: "Fixture Player",
    team: "MIA",
    position: "WR",
    salary: 4000,
    fppg: "9.5",
    projectedPoints: "10.2",
    opponent: "BUF",
    gameInfo: "MIA @ BUF",
    injuryStatus: null,
    injuryDetail: null,
    boostScore: null,
    boostReason: null,
    draftKingsPlayerId: 101,
    fanDuelPlayerId: null,
    yahooPlayerId: null,
    fanDuelSalary: null,
    yahooSalary: null,
    isConfirmedStarter: false,
    ...overrides,
  };
}

test("parser uses explicit statuses and canonicalizes Jr punctuation", () => {
  const roster = parseNFLRoster({
    athletes: [
      {
        position: "practiceSquad",
        items: [
          { fullName: "Theo Wease Jr.", status: { type: "practice-squad", id: "29" } },
          { fullName: "Missing Status", status: {} },
        ],
      },
      {
        position: "active",
        items: [{ fullName: "Elevated Player", status: { type: "elevated", id: "1" } }],
      },
    ],
  });

  assert.equal(normalizeNFLPlayerName("Theo Wease Jr."), "theo wease jr");
  assert.equal(rosterStatusForPlayer(roster, "Theo Wease Jr"), "practice-squad");
  assert.equal(rosterStatusForPlayer(roster, "Elevated Player"), "active");
  assert.equal(rosterStatusForPlayer(roster, "Missing Status"), "unknown");
  assert.equal(rosterStatusForPlayer(roster, "Absent From Feed"), "unknown");
});

test("practice squad overlay preserves IDs, DST, other teams, and unknown failures", async () => {
  clearNFLRosterEligibilityCache();
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = previousNow();
  const calls: string[] = [];
  const lacResponses: (() => Response)[] = [
    () => new Response(JSON.stringify({
      athletes: [{
        position: "practiceSquad",
        items: [{ fullName: "Theo Wease Jr.", status: { type: "practice-squad", id: "29" } }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
    () => new Response("temporarily unavailable", { status: 503 }),
    () => new Response(JSON.stringify({
      athletes: [{
        position: "active",
        items: [{ fullName: "Theo Wease Jr.", status: { type: "active", id: "1" } }],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  ];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/teams/24/roster")) {
      return lacResponses.shift!()();
    }
    if (url.endsWith("/teams/2/roster")) {
      return new Response(JSON.stringify({
        athletes: [{
          position: "active",
          items: [{ fullName: "Theo Wease", status: { type: "elevated", id: "1" } }],
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;

  try {
    Date.now = () => now;
    const input = [
      player({ id: 41, name: "Theo Wease Jr.", team: "LAC" }),
      player({ id: 42, name: "Theo Wease", team: "BUF" }),
      player({ id: 43, name: "Unknown Player", team: "NYG" }),
      player({ id: 44, name: "Los Angeles DST", team: "LAC", position: "DST" }),
    ];
    const result = await applyNFLRosterEligibility(input);
    const squad = result.find(p => p.id === 41)!;
    const active = result.find(p => p.id === 42)!;
    const unknown = result.find(p => p.id === 43)!;
    const dst = result.find(p => p.id === 44)!;

    assert.equal(squad.injuryStatus, "OUT");
    assert.equal(squad.injuryDetail, NFL_PRACTICE_SQUAD_DETAIL);
    assert.equal(squad.projectedPoints, "0");
    assert.equal(squad.fppg, "0");
    assert.equal(squad.id, 41);
    assert.equal(active.projectedPoints, "10.2");
    assert.equal(active.injuryStatus, null);
    assert.equal(unknown.projectedPoints, "10.2");
    assert.equal(unknown.injuryStatus, null);
    assert.equal(dst.projectedPoints, "10.2");
    assert.equal(dst.injuryStatus, null);

    const protectedMarker = protectNFLPracticeSquadMarker({
      ...squad,
      injuryStatus: null,
      projectedPoints: "21.5",
      fppg: "18.2",
    });
    assert.equal(protectedMarker.injuryStatus, "OUT");
    assert.equal(protectedMarker.injuryDetail, NFL_PRACTICE_SQUAD_DETAIL);
    assert.equal(protectedMarker.projectedPoints, "0");
    assert.equal(protectedMarker.id, squad.id);

    // Promise cache: a repeated request for the same team does not refetch.
    await applyNFLRosterEligibility([player({ id: 45, name: "Theo Wease Jr.", team: "LAC" })]);
    assert.equal(calls.filter(url => url.endsWith("/teams/24/roster")).length, 1);

    // After the five-minute positive TTL, an outage keeps the last known
    // practice-squad exclusion for the short negative retry window.
    now += 5 * 60 * 1000 + 1;
    const duringOutage = (await applyNFLRosterEligibility([
      player({ id: 46, name: "Theo Wease Jr.", team: "LAC" }),
    ]))[0];
    assert.equal(duringOutage.injuryStatus, "OUT");
    assert.equal(duringOutage.injuryDetail, NFL_PRACTICE_SQUAD_DETAIL);
    assert.equal(calls.filter(url => url.endsWith("/teams/24/roster")).length, 2);

    // A later explicit active roster response restores the original baseline.
    now += 30 * 1000 + 1;
    const restored = (await applyNFLRosterEligibility([
      player({ id: 47, name: "Theo Wease Jr.", team: "LAC" }),
    ]))[0];
    assert.equal(restored.injuryStatus, null);
    assert.equal(restored.injuryDetail, null);
    assert.equal(restored.projectedPoints, "10.2");
    assert.equal(restored.fppg, "9.5");
    assert.equal(calls.filter(url => url.endsWith("/teams/24/roster")).length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    Date.now = previousNow;
    clearNFLRosterEligibilityCache();
  }
});