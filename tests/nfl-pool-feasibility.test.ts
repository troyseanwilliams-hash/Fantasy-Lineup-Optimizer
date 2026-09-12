import assert from "node:assert/strict";
import test from "node:test";
import { solveLineup } from "../server/routes";
import { runSimulations } from "../server/simulation-engine";
import type { Player, OptimizationConstraints } from "../shared/schema";
import { NFL_PRACTICE_SQUAD_DETAIL } from "../server/nfl-roster-eligibility";

const positions = [
  ...Array(35).fill("QB"), ...Array(61).fill("RB"),
  ...Array(48).fill("WR"), ...Array(6).fill("TE"), "DST", "DST",
];
const pool = positions.map((position, index) => ({
  id: index + 1, slateId: 1, name: `Fixture ${position} ${index}`,
  position, salary: position === "DST" ? 2500 : 5000,
  projectedPoints: position === "DST" ? "8" : "18", fppg: "18",
  team: index % 2 ? "BUF" : "HOU",
  gameInfo: "BUF @ HOU 1:00 PM ET", injuryStatus: null,
})) as Player[];
const constraints = {
  slateId: 1, lockedPlayerIds: [], excludedPlayerIds: [],
  lineupCount: 1, maxSalary: 50000,
} as OptimizationConstraints;

test("salary-capped NFL pool is infeasible without DST; full pool fills all nine slots", () => {
  assert.ok(solveLineup(pool.slice(0, 150), constraints, "NFL", "draftkings").error);
  const result = solveLineup(pool, constraints, "NFL", "draftkings");
  assert.ok(!result.error, result.error);
  assert.equal(result.lineup.length, 9);
  assert.equal(result.lineup.filter(p => p.position === "DST").length, 1);
  assert.ok(result.totalSalary <= 50000);
});

test("NFL simulated projections produce valid rosters when DST is retained", () => {
  for (const sim of runSimulations(pool, "NFL", 10, {})) {
    const simulatedPool = pool.map(p => ({ ...p, projectedPoints: String(sim.projections[p.id]) }));
    const result = solveLineup(simulatedPool, constraints, "NFL", "draftkings");
    assert.ok(!result.error, result.error);
    assert.equal(result.lineup.length, 9);
    assert.equal(new Set(result.lineup.map(p => p.id)).size, 9);
    assert.ok(result.totalSalary <= 50000);
    assert.equal(result.lineup.filter(p => p.position === "DST").length, 1);
  }
});

test("practice-squad marker is a hard exclusion and locked marker is infeasible", () => {
  const markedPool = pool.map(p => p.id === 1
    ? { ...p, injuryStatus: "OUT", injuryDetail: NFL_PRACTICE_SQUAD_DETAIL, projectedPoints: "0", fppg: "0" }
    : p);
  const result = solveLineup(markedPool, constraints, "NFL", "draftkings");
  assert.ok(!result.error, result.error);
  assert.ok(!result.lineup.some(p => p.id === 1));

  const lockedResult = solveLineup(markedPool, {
    ...constraints,
    lockedPlayerIds: [1],
  }, "NFL", "draftkings");
  assert.match(lockedResult.error || "", /practice squad/i);
});
