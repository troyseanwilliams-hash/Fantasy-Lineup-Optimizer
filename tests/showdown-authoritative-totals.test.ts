import assert from "node:assert/strict";
import test from "node:test";
import { computeAuthoritativeShowdownTotals, isValidAuthoritativeShowdownTotals } from "../server/showdown-route";
import { getShowdownConfig } from "../shared/platform-config";

function player(id: number, salary: number, projectedPoints: number) {
  return {
    id,
    salary,
    projectedPoints: String(projectedPoints),
  } as any;
}

test("authoritative Showdown totals ignore client effective values", () => {
  const config = getShowdownConfig("NFL", "draftkings");
  const totals = computeAuthoritativeShowdownTotals(
    player(1, 10_000, 20),
    [2, 3, 4, 5, 6].map(id => player(id, 5_000, 10)),
    config,
  );
  assert.equal(totals.totalSalary, 40_000);
  // Canonical CPT projection is 20 * 1.5 + 5 * 10.
  assert.equal(totals.totalProjectedPoints, "80.00");
});

test("authoritative Showdown totals reject an over-cap lineup", () => {
  const config = getShowdownConfig("NFL", "draftkings");
  assert.ok(config);
  const totals = computeAuthoritativeShowdownTotals(
    player(1, 20_000, 20),
    [2, 3, 4, 5, 6].map(id => player(id, 5_000, 10)),
    config,
  );
  assert.equal(totals.totalSalary, 55_000);
  assert.equal(isValidAuthoritativeShowdownTotals(totals, config.salaryCap), false);
});