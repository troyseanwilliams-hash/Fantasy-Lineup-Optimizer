import assert from "node:assert/strict";
import test from "node:test";
import { selectLiveDraftGroup, selectNewestLocalSlate } from "../server/draft-group-selection";

test("NFL live-group selection fails closed without an explicit featured main", () => {
  const alternatives = [
    { draftGroupId: 9101, isMain: false },
    { draftGroupId: 9202, isMain: false },
  ];

  assert.equal(selectLiveDraftGroup(alternatives, "NFL", null), undefined);
});

test("NFL live-group selection still honors an explicit alternate draft group", () => {
  const alternatives = [
    { draftGroupId: 9101, isMain: false },
    { draftGroupId: 9202, isMain: false },
  ];

  assert.equal(selectLiveDraftGroup(alternatives, "NFL", 9202)?.draftGroupId, 9202);
});

test("local main selection prefers active rows before newest retired duplicates", () => {
  const available = [
    { draftGroupId: 9202, isMain: true },
  ];
  // The endpoint's local-row ordering is represented independently here so
  // this regression documents the active/newest rule used by the route.
  const local = selectNewestLocalSlate([
    { id: 12, draftGroupId: 9202, isActive: false },
    { id: 11, draftGroupId: 9202, isActive: true },
    { id: 10, draftGroupId: 9202, isActive: true },
  ]);

  assert.equal(selectLiveDraftGroup(available, "NFL", null)?.draftGroupId, 9202);
  assert.equal(local?.id, 11);
});