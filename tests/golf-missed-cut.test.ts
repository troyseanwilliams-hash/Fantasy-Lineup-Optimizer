import assert from "node:assert/strict";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";
import {
  GOLF_MISSED_CUT_DETAIL_PREFIX,
  applyGolfMissedCutEligibility,
  clearGolfMissedCutEligibilityCache,
  isExplicitGolfMissedCutStatus,
  isGolfMissedCutMarker,
  parseGolfESPNCutStatuses,
  protectGolfMissedCutMarker,
} from "../server/golf-missed-cut";
import { solveLineup } from "../server/routes";

function player(overrides: Partial<Player>): Player {
  return {
    id: 1,
    slateId: 11,
    name: "Jordan Example",
    team: "",
    position: "G",
    salary: 8000,
    fppg: "35",
    projectedPoints: "30",
    opponent: "",
    gameInfo: "Test Open - Test Course",
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

function slate(overrides: Partial<Slate>): Slate {
  return {
    id: 11,
    sport: "GOLF",
    platform: "draftkings",
    name: "Test Open",
    startTime: new Date("2025-09-11T12:00:00.000Z"),
    isMain: true,
    isActive: true,
    draftGroupId: 991,
    gameType: null,
    label: null,
    gameCount: 0,
    contestCount: 0,
    salaryCap: 50000,
    ...overrides,
  };
}

test("DraftKings explicit cut status marks a golfer without mutating the baseline", async () => {
  clearGolfMissedCutEligibilityCache();
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      draftables: [{
        draftableId: 101,
        displayName: "Jordan Example",
        status: "mIsSeD cUt",
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const baseline = player({});
    const result = await applyGolfMissedCutEligibility([baseline], slate({}));
    assert.equal(result[0].injuryStatus, "OUT");
    assert.equal(result[0].projectedPoints, "0");
    assert.equal(result[0].fppg, "35");
    assert.equal(result[0].injuryDetail?.startsWith(GOLF_MISSED_CUT_DETAIL_PREFIX), true);
    assert.equal(result[0].id, baseline.id);
    assert.equal(baseline.injuryStatus, null);
    assert.equal(baseline.injuryDetail, null);
    assert.equal(baseline.projectedPoints, "30");
    assert.equal(calls.length, 1);

    // Promise cache is keyed by draft group and prevents a second provider
    // request while the short positive TTL is active.
    await applyGolfMissedCutEligibility([player({ id: 2 })], slate({}));
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    clearGolfMissedCutEligibilityCache();
  }
});

test("pre-cut and ordinary leaderboard positions remain eligible", async () => {
  clearGolfMissedCutEligibilityCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    draftables: [{
      draftableId: 101,
      displayName: "Jordan Example",
      status: "Active",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    const result = await applyGolfMissedCutEligibility([player({})], slate({ draftGroupId: 992 }));
    assert.equal(result[0].injuryStatus, null);
    assert.equal(result[0].projectedPoints, "30");
    assert.equal(isExplicitGolfMissedCutStatus("T-20"), false);
    assert.equal(isExplicitGolfMissedCutStatus("STATUS_IN_PROGRESS"), false);
  } finally {
    globalThis.fetch = previousFetch;
    clearGolfMissedCutEligibilityCache();
  }
});

test("ESPN cuts require target date containment and roster overlap", () => {
  const names = new Set(["jordan example"]);
  const target = {
    start: Date.UTC(2025, 8, 11),
    end: Date.UTC(2025, 8, 17),
  };
  const oldTournament = parseGolfESPNCutStatuses({
    events: [{
      id: "old",
      date: "2025-09-04T12:00:00Z",
      competitions: [{
        competitors: [{
          athlete: { displayName: "Jordan Example" },
          status: { type: { name: "STATUS_CUT" } },
        }],
      }],
    }],
  }, target, names, "pga");
  assert.equal(oldTournament.length, 0);

  const targetTournament = parseGolfESPNCutStatuses({
    events: [{
      id: "target",
      date: "2025-09-11T12:00:00Z",
      competitions: [{
        competitors: Array.from({ length: 25 }, (_, index) => ({
          athlete: { displayName: index === 24 ? "Jordan Example" : `Other Golfer ${index}` },
          status: index === 24 ? { type: { name: "STATUS_CUT" } } : { type: { name: "STATUS_IN_PROGRESS" } },
        })),
      }],
    }],
  }, target, names, "pga");
  assert.equal(targetTournament.length, 1);
  assert.equal(targetTournament[0].normalizedName, "jordan example");

  const weekendTarget = {
    start: Date.UTC(2025, 8, 13), // Saturday Showdown
    end: Date.UTC(2025, 8, 19),
  };
  const thursdayTournament = parseGolfESPNCutStatuses({
    events: [{
      id: "thursday",
      date: "2025-09-11T12:00:00Z",
      endDate: "2025-09-14T23:00:00Z",
      competitions: [{
        competitors: [{
          athlete: { displayName: "Jordan Example" },
          status: { type: { name: "STATUS_CUT" } },
        }],
      }],
    }],
  }, weekendTarget, names, "pga");
  assert.equal(thursdayTournament.length, 1);

  const nextWeek = parseGolfESPNCutStatuses({
    events: [{
      id: "next-week",
      date: "2025-09-18T12:00:00Z",
      endDate: "2025-09-21T23:00:00Z",
      competitions: [{
        competitors: [{
          athlete: { displayName: "Jordan Example" },
          status: { type: { name: "STATUS_CUT" } },
        }],
      }],
    }],
  }, weekendTarget, names, "pga");
  assert.equal(nextWeek.length, 0);
});

test("missed-cut marker remains a hard zero and locked player is rejected", () => {
  const marked = protectGolfMissedCutMarker({
    ...player({ projectedPoints: "42", injuryStatus: "Healthy" }),
    injuryDetail: "Golf missed cut [event=pga:target;dg=991]",
  }, 991);
  assert.equal(isGolfMissedCutMarker(marked.injuryDetail), true);
  assert.equal(marked.injuryStatus, "OUT");
  assert.equal(marked.projectedPoints, "0");

  const result = solveLineup(
    [marked, player({ id: 2, name: "Other Golfer", draftKingsPlayerId: 102 })],
    {
      slateId: 11,
      lockedPlayerIds: [marked.id],
      excludedPlayerIds: [],
      contestType: "cash",
    },
    "GOLF",
    "draftkings",
  );
  assert.match(result.error || "", /missed.*cut/i);
});

test("partial ESPN outage keeps a known cut from the same event", async () => {
  clearGolfMissedCutEligibilityCache();
  const previousFetch = globalThis.fetch;
  const previousNow = Date.now;
  let now = previousNow();
  let refresh = false;
  const payload = {
    events: [{
      id: "target-event",
      date: "2025-09-11T12:00:00Z",
      competitions: [{
        competitors: [{
          athlete: { displayName: "Jordan Example" },
          status: { type: { name: "STATUS_CUT" } },
        }],
      }],
    }],
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/pga/scoreboard")) {
      return refresh
        ? new Response("temporary failure", { status: 503 })
        : new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    Date.now = () => now;
    const targetSlate = slate({ draftGroupId: null });
    const first = await applyGolfMissedCutEligibility([player({})], targetSlate);
    assert.equal(first[0].injuryStatus, "OUT");

    now += 2 * 60 * 1000 + 1;
    refresh = true;
    const second = await applyGolfMissedCutEligibility([player({ id: 2 })], targetSlate);
    assert.equal(second[0].injuryStatus, "OUT");
    assert.match(second[0].injuryDetail || "", /target-event/);
  } finally {
    globalThis.fetch = previousFetch;
    Date.now = previousNow;
    clearGolfMissedCutEligibilityCache();
  }
});