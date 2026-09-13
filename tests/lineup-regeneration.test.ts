import assert from "node:assert/strict";
import test from "node:test";
import { reconcileClassicMainIdentity, shouldCloneRegeneratedLineup } from "../server/lineup-regeneration";
import { getLatestGameStart } from "../server/slate-lifecycle-utils";
import { fetchDKSlateByDraftGroup } from "../server/balldontlie";

const slate = {
  id: 10,
  sport: "NFL",
  platform: "draftkings",
  name: "Classic",
  startTime: new Date("2026-09-13T17:00:00.000Z"),
  isMain: true,
  isActive: true,
  draftGroupId: 151307,
  gameType: "Classic",
  label: "Featured",
  gameCount: 12,
  contestCount: 1,
  salaryCap: null,
} as any;

test("cross-group regeneration clones while same-group regeneration can update", () => {
  assert.equal(shouldCloneRegeneratedLineup(10, 11, true), true);
  assert.equal(shouldCloneRegeneratedLineup(10, 11, false), false);
  assert.equal(shouldCloneRegeneratedLineup(10, 10, true), false);
});

test("existing wrong main is demoted and featured target is promoted without replacement", () => {
  const transition = reconcileClassicMainIdentity([
    { id: 41, draftGroupId: 153069, isMain: true },
    { id: 42, draftGroupId: 151307, isMain: false },
  ], 151307);

  assert.deepEqual(transition, {
    demoteSlateId: 41,
    promoteSlateId: 42,
    createTarget: false,
  });
});

test("lifecycle uses the latest player game rather than slate kickoff", () => {
  const players = [
    { gameInfo: "BUF @ HOU 1:00 PM ET" },
    { gameInfo: "DAL @ NYG 8:20 PM ET" },
  ] as any[];

  const latest = getLatestGameStart(slate, players as any);
  assert.equal(latest.getUTCHours(), 0);
  assert.equal(latest.getUTCMinutes(), 20);
  assert.ok(latest.getTime() > new Date(slate.startTime).getTime());
});

test("lifecycle keeps a Monday competition on Monday for Sun-Mon groups", () => {
  const players = [
    { gameInfo: "BUF @ HOU 1:00 PM ET [DK_START:2026-09-13T17:00:00.0000000]" },
    { gameInfo: "DAL @ NYG 8:15 PM ET [DK_START:2026-09-14T20:15:00.0000000]" },
  ] as any[];

  const latest = getLatestGameStart(slate, players as any);
  assert.equal(latest.toISOString(), "2026-09-15T00:15:00.000Z");
});

test("DraftGroup ingestion uses lobby StartDateEst instead of first draftable competition", async () => {
  const originalFetch = globalThis.fetch;
  const mondayCompetition = "2026-09-14T20:15:00.0000000";
  const lobbyStart = "2026-09-13T13:00:00.0000000";
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/draftgroups/v1/draftgroups/")) {
      return {
        ok: true,
        json: async () => ({
          draftables: [{
            draftableId: 1001,
            playerId: 2001,
            displayName: "Monday Player",
            firstName: "Monday",
            lastName: "Player",
            position: "RB",
            salary: 5000,
            status: "",
            newsStatus: "",
            teamAbbreviation: "DAL",
            teamId: 1,
            competition: {
              competitionId: 3001,
              name: "DAL @ NYG",
              startTime: mondayCompetition,
            },
            draftStatAttributes: [],
            playerGameAttributes: [],
          }],
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        DraftGroups: [{
          DraftGroupId: 9999,
          GameCount: 2,
          StartDateEst: lobbyStart,
          GameTypeId: 1,
          ContestTypeId: 21,
        }],
        Contests: [],
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const result = await fetchDKSlateByDraftGroup("NFL", 9999);
    assert.ok(result);
    assert.equal(result.slateDate.toISOString(), "2026-09-13T17:00:00.000Z");
    assert.match(result.dkPlayers[0].gameInfo || "", /\[DK_START:2026-09-14T20:15:00\.0000000\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});