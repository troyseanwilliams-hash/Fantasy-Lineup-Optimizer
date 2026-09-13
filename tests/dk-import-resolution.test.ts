import assert from "node:assert/strict";
import test from "node:test";
import type { Player, Slate } from "../shared/schema";
import {
  describeDKImportSlateResolution,
  resolveDKImportSlate,
} from "../server/dk-import-resolution";

function slate(overrides: Partial<Slate>): Slate {
  return {
    id: 1,
    sport: "NFL",
    platform: "draftkings",
    name: "NFL slate",
    startTime: new Date("2026-09-13T17:00:00.000Z"),
    isMain: false,
    isActive: true,
    draftGroupId: 1001,
    gameType: "Classic",
    label: null,
    gameCount: 12,
    contestCount: 1,
    salaryCap: 50000,
    ...overrides,
  };
}

function player(overrides: Partial<Player>): Player {
  return {
    id: 1,
    slateId: 1,
    name: "Overlapping Receiver",
    team: "SEA",
    position: "WR",
    salary: 5500,
    fppg: "10",
    projectedPoints: "12",
    opponent: "DEN",
    gameInfo: "SEA @ DEN",
    injuryStatus: null,
    injuryDetail: null,
    boostScore: null,
    boostReason: null,
    draftKingsPlayerId: 501,
    fanDuelPlayerId: null,
    yahooPlayerId: null,
    fanDuelSalary: null,
    yahooSalary: null,
    isConfirmedStarter: false,
    ...overrides,
  };
}

test("mixed main and extended entries resolve independently despite overlapping athletes", () => {
  const main = slate({ id: 11, name: "NFL Featured Main", draftGroupId: 1101, isMain: true });
  const extended = slate({
    id: 12,
    name: "NFL Sunday-Monday Extended",
    draftGroupId: 1102,
    startTime: new Date("2026-09-13T17:00:00.000Z"),
  });
  const contests = new Map([
    [2101, { status: "resolved" as const, draftGroupId: 1101 }],
    [2102, { status: "resolved" as const, draftGroupId: 1102 }],
  ]);

  const mainEntry = resolveDKImportSlate("2101", contests, [main, extended], "NFL");
  const extendedEntry = resolveDKImportSlate("2102", contests, [main, extended], "NFL");

  assert.equal(mainEntry.status, "resolved");
  assert.equal(extendedEntry.status, "resolved");
  if (mainEntry.status !== "resolved" || extendedEntry.status !== "resolved") return;
  assert.equal(mainEntry.slate.id, main.id);
  assert.equal(extendedEntry.slate.id, extended.id);

  // The same athlete can be present in both provider pools.  Player overlap
  // must not replace the contest -> draft-group identity above.
  const mainPlayer = player({ id: 101, slateId: main.id, draftKingsPlayerId: 501 });
  const extendedPlayer = player({ id: 201, slateId: extended.id, draftKingsPlayerId: 601 });
  const mainPool = new Map([[mainPlayer.draftKingsPlayerId!, mainPlayer]]);
  const extendedPool = new Map([[extendedPlayer.draftKingsPlayerId!, extendedPlayer]]);
  assert.equal(mainPool.get(501)?.slateId, main.id);
  assert.equal(extendedPool.get(601)?.slateId, extended.id);
});

test("unknown contest IDs are rejected instead of falling back to the first slate", () => {
  const main = slate({ id: 21, draftGroupId: 1201, isMain: true });
  const result = resolveDKImportSlate("999999", new Map(), [main], "NFL");

  assert.equal(result.status, "unknown-contest");
  assert.equal(describeDKImportSlateResolution(result), "Contest ID was not found in the live DraftKings lobby.");
});