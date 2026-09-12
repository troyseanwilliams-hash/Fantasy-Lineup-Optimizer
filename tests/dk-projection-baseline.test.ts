import assert from "node:assert/strict";
import test from "node:test";
import { dkProjectionBaseline as baseline } from "../server/dk-projection-baseline";

test("missing NFL history gets conservative positional priors, never fake FPPG", () => {
  assert.deepEqual(baseline("NFL", "RB", 6400, null), { fppg: "0.0", projectedPoints: "10.0" });
  assert.deepEqual(baseline("NFL", "WR", 3900, null), { fppg: "0.0", projectedPoints: "7.8" });
  assert.equal(baseline("NFL", "TE", 10000, null).projectedPoints, "6.0");
  assert.equal(baseline("NFL", "QB", 10000, null).projectedPoints, "14.0");
  assert.equal(baseline("NFL", "DST", 3000, null).projectedPoints, "6.0");
});

test("reported positive, zero and negative averages are preserved", () => {
  for (const average of [24.5, 0, -1.2]) {
    assert.deepEqual(baseline("NFL", "WR", 3900, average), {
      fppg: average.toFixed(1), projectedPoints: average.toFixed(1),
    });
  }
});

test("Showdown remains zero without data and other sports are unchanged", () => {
  assert.equal(baseline("NFL", "WR", 3900, null, true).projectedPoints, "0.0");
  assert.deepEqual(baseline("MLB", "SP", 10000, null), { fppg: "40.0", projectedPoints: "40.0" });
});