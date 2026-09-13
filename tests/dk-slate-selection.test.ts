import assert from "node:assert/strict";
import test from "node:test";
import {
  selectFeaturedClassicDraftGroup,
  selectLargestCurrentClassicDraftGroup,
  type DKDraftGroup,
} from "../server/balldontlie";

function group(overrides: Partial<DKDraftGroup>): DKDraftGroup {
  return {
    DraftGroupId: 7001,
    GameCount: 1,
    StartDateEst: "2026-09-13T13:00:00.0000000",
    GameTypeId: 1,
    ContestTypeId: 21,
    ...overrides,
  };
}

test("selects the featured classic group instead of the larger same-start extended group", () => {
  const selected = selectFeaturedClassicDraftGroup([
    group({
      DraftGroupId: 7014,
      GameCount: 14,
      ContestStartTimeSuffix: " (Sun-Mon)",
      SortOrder: 12,
    }),
    group({
      DraftGroupId: 7012,
      GameCount: 12,
      DraftGroupTag: "Featured",
      SortOrder: 1,
    }),
  ], new Date("2026-09-12T20:00:00.000Z"));

  assert.equal(selected?.DraftGroupId, 7012);
  assert.notEqual(selected?.DraftGroupId, 7014);
});

test("does not select Sunday-night or Monday classic alternatives as featured main", () => {
  const selected = selectFeaturedClassicDraftGroup([
    group({
      DraftGroupId: 7020,
      GameCount: 2,
      ContestStartTimeSuffix: " (Primetime)",
      SortOrder: 25,
    }),
    group({
      DraftGroupId: 7021,
      GameCount: 1,
      ContestStartTimeSuffix: " (Monday)",
      SortOrder: 30,
    }),
    group({
      DraftGroupId: 7022,
      GameCount: 10,
      DraftGroupTag: "Featured",
      SortOrder: 1,
    }),
  ], new Date("2026-09-12T20:00:00.000Z"));

  assert.equal(selected?.DraftGroupId, 7022);
  assert.notEqual(selected?.DraftGroupId, 7020);
  assert.notEqual(selected?.DraftGroupId, 7021);
});

test("does not guess a primetime or Sun-Mon pool when Featured is absent", () => {
  const selected = selectFeaturedClassicDraftGroup([
    group({
      DraftGroupId: 7023,
      GameCount: 2,
      ContestStartTimeSuffix: " (SNF)",
    }),
    group({
      DraftGroupId: 7024,
      GameCount: 14,
      ContestStartTimeSuffix: " (Sun-Mon)",
    }),
  ], new Date("2026-09-12T20:00:00.000Z"));

  assert.equal(selected, null);
});

test("keeps a draft group identity distinct even when kickoff and player count match", () => {
  const groups = [
    group({ DraftGroupId: 7031, GameCount: 12, DraftGroupTag: "Featured", SortOrder: 1 }),
    group({ DraftGroupId: 7032, GameCount: 12, DraftGroupTag: "Featured", SortOrder: 2 }),
  ];
  const selected = selectFeaturedClassicDraftGroup(
    groups,
    new Date("2026-09-12T20:00:00.000Z"),
  );

  assert.equal(selected?.DraftGroupId, 7031);
  assert.deepEqual(groups.map(candidate => candidate.DraftGroupId), [7031, 7032]);
});

test("selects the larger same-day MLB classic instead of an early one-game group", () => {
  const selected = selectLargestCurrentClassicDraftGroup([
    group({
      DraftGroupId: 7041,
      GameCount: 1,
      GameTypeId: 2,
      StartDateEst: "2026-09-13T09:00:00.0000000",
    }),
    group({
      DraftGroupId: 7042,
      GameCount: 14,
      GameTypeId: 2,
      StartDateEst: "2026-09-13T13:00:00.0000000",
    }),
  ], new Date("2026-09-13T12:00:00.000Z"));

  assert.equal(selected?.DraftGroupId, 7042);
  assert.equal(selected?.GameCount, 14);
});

test("prefers today's current MLB classic over a larger tomorrow slate", () => {
  const selected = selectLargestCurrentClassicDraftGroup([
    group({
      DraftGroupId: 7051,
      GameCount: 8,
      GameTypeId: 2,
      StartDateEst: "2026-09-13T13:00:00.0000000",
    }),
    group({
      DraftGroupId: 7052,
      GameCount: 15,
      GameTypeId: 2,
      StartDateEst: "2026-09-14T13:00:00.0000000",
    }),
  ], new Date("2026-09-13T12:00:00.000Z"));

  assert.equal(selected?.DraftGroupId, 7051);
  assert.equal(selected?.GameCount, 8);
});

test("NFL still requires DraftKings' featured unsuffixed classic identity", () => {
  const selected = selectFeaturedClassicDraftGroup([
    group({
      DraftGroupId: 7061,
      GameCount: 1,
      DraftGroupTag: "Featured",
      StartDateEst: "2026-09-13T13:00:00.0000000",
    }),
    group({
      DraftGroupId: 7062,
      GameCount: 14,
      ContestStartTimeSuffix: " (Sun-Mon)",
      StartDateEst: "2026-09-13T13:00:00.0000000",
    }),
  ], new Date("2026-09-13T12:00:00.000Z"));

  assert.equal(selected?.DraftGroupId, 7061);
  assert.equal(selected?.GameCount, 1);
});