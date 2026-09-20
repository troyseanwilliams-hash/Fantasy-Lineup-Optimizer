import assert from "node:assert/strict";
import test from "node:test";
import { qualityFloor, projectionTotal, qualityReport, createQualityConvergence } from "../server/lineup-quality";

test("quality uses the stricter explicit and slate-relative floor", () => {
  assert.equal(qualityFloor(300, 250), 270);
  assert.equal(qualityFloor(300, 290), 290);
  assert.throws(() => qualityFloor(NaN));
  assert.throws(() => qualityFloor(300, Infinity));
});
test("deterministic projection comes only from the current pool", () => {
  assert.equal(projectionTotal([{ id: 1 }], [{ id: 1, projectedPoints: "30" }]), 30);
  assert.throws(() => projectionTotal([{ id: 2 }], [{ id: 1, projectedPoints: "30" }]), /Missing deterministic/);
});
test("diagnostics do not claim mathematical optimality", () => {
  const report = qualityReport([280, 285], 300, 250, 20, 10, "time_budget");
  assert.equal(report.baselineStatus, "best_found");
  assert.equal(report.effectiveFloor, 270);
  assert.equal(report.generatedCount, 2);
});
test("convergence resets when qualified coverage or best projection improves", () => {
  const converged = createQualityConvergence(2);
  assert.equal(converged(300, 1), false);
  assert.equal(converged(300, 1), false);
  assert.equal(converged(300, 2), false);
  assert.equal(converged(300, 2), false);
  assert.equal(converged(301, 2), false);
  assert.equal(converged(301, 2), false);
  assert.equal(converged(301, 2), true);
});