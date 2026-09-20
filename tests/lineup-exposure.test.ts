import assert from "node:assert/strict";
import test from "node:test";
import { assertLineupExposures, selectExposureLineups, validateExposureBounds, mergeExposureMinimums } from "../server/lineup-exposure";

const ids = (c: number[]) => c;
test("Coker 13/15 is rejected in favor of an alternate; individual 100 cannot loosen global 80", () => {
  const ranked = Array.from({ length: 16 }, (_, i) => i < 13 ? [1, 100 + i] : [100 + i]);
  const selected = selectExposureLineups(ranked, ids, { globalMaxExposure: 80, exposureLimits: { 1: 100 } }, { count: 15 });
  assert.equal(selected.length, 15);
  assert.equal(selected.filter(c => c.includes(1)).length, 12);
  assert.ok(selected.includes(ranked[15]));
  assert.ok(!selected.includes(ranked[12]));
  const smaller = selectExposureLineups(ranked.slice(0, 15), ids, { globalMaxExposure: 80 }, { count: 15 });
  assert.equal(smaller.length, 10, "every smaller batch must recompute the floor, not reuse the requested-count allowance");
  assert.equal(smaller.filter(c => c.includes(1)).length, 8);
});
test("23 at 80% means at most 18, and partial denominator is recomputed", () => {
  const ranked = Array.from({ length: 25 }, (_, i) => i < 20 ? [1, 100 + i] : [100 + i]);
  const selected = selectExposureLineups(ranked, ids, { globalMaxExposure: 80 }, { count: 23 });
  assert.equal(selected.length, 23);
  assert.equal(selected.filter(c => c.includes(1)).length, 18);
  const partial = selectExposureLineups([[1, 2], [1, 3], [1, 4], [5, 6]], ids, { globalMaxExposure: 80 }, { count: 15 });
  assert.equal(partial.length, 4);
  assertLineupExposures(partial, ids, { globalMaxExposure: 80 });
  assert.throws(() => assertLineupExposures([[1], [1], [1]], ids, { globalMaxExposure: 80 }));
});
test("minimums and maximums solved simultaneously, absent explicit minimum cannot vanish", () => {
  const bounds = { globalMaxExposure: 80, minExposureLimits: { 9: 40 } };
  const candidates = [[1, 9], [1, 9, 3], [1, 4], [1, 5], [1, 6], [7, 8]];
  const selected = selectExposureLineups(candidates, ids, bounds, { count: 5 });
  assert.equal(selected.length, 5);
  assertLineupExposures(selected, ids, bounds);
  assert.throws(() => selectExposureLineups(candidates, ids, { minExposureLimits: { 999: 10 } }, { count: 5 }));
  assert.deepEqual(mergeExposureMinimums({ 1: 70 }, { 1: 30 }), { 1: 70 });
});
test("conditional global minimum, strict locks, zero max and raw numeric validation", () => {
  assertLineupExposures([[1], [1]], ids, { globalMinExposure: 100, minExposureLimits: { 2: 0 } });
  assert.throws(() => validateExposureBounds({ lockedPlayerIds: [1], globalMaxExposure: 80 }), /Locked player/);
  assert.throws(() => validateExposureBounds({ globalMaxExposure: 80, minExposureLimits: { 1: 90 } }), /minimum/);
  for (const value of [NaN, Infinity, -1, 101, "80", null]) assert.throws(() => validateExposureBounds({ globalMaxExposure: value as number }));
  const selected = selectExposureLineups([[1], [2]], ids, { exposureLimits: { 1: 0 } }, { count: 1 });
  assert.deepEqual(selected, [[2]]);
});
test("accepted preset ownership/structure objects remain identical and are never reselected", () => {
  const accepted = [
    { players: [1, 2], ownership: 45, stack: "double" },
    { players: [3, 4], ownership: 30, stack: "single" },
  ];
  assert.equal(selectExposureLineups(accepted, c => c.players, { globalMaxExposure: 80 }, { count: 9, preservePortfolio: true }), accepted);
  assert.throws(() => selectExposureLineups(accepted, c => c.players, {}, { count: 9, preservePortfolio: true, requireFull: true }));
  assert.throws(() => selectExposureLineups([[1], [1]], ids, { globalMaxExposure: 80 }, { count: 1, preservePortfolio: true }));
});
test("OFF retains empty/error response shape and ignores expired selection deadline", () => {
  assert.deepEqual(selectExposureLineups([], ids, {}, { count: 15, deadline: 0 }), []);
  assert.deepEqual(selectExposureLineups([[1], [2]], ids, {}, { count: 1, deadline: 0 }), [[1]]);
});