import assert from "node:assert/strict";
import test from "node:test";
import { solveLineup } from "../server/routes";
import { solveWithBudget, validatedIntegralResult } from "../server/solver-guard";
import {
  optimizationConstraintSchema,
  proOptimizationConstraintSchema,
  type OptimizationConstraints,
  type Player,
} from "../shared/schema";

test("solver guard passes javascript-lp-solver timeout options", () => {
  const model: any = {
    optimize: "points",
    opType: "max",
    constraints: { roster: { equal: 1 } },
    variables: { x: { points: 1, roster: 1 } },
    ints: { x: 1 },
  };

  const guarded = solveWithBudget(model, { timeoutMs: 1 });

  assert.equal(model.timeout, 1);
  assert.equal(model.options.timeout, 1);
  assert.ok(guarded.elapsedMs >= 0);
  assert.ok(guarded.elapsedMs < 1000, `solve exceeded guard budget: ${guarded.elapsedMs}ms`);
  assert.ok(guarded.result === null || guarded.result.feasible === true);
});

test("expired request budgets do not start another solve", () => {
  const result = solveWithBudget({}, { deadline: Date.now() - 1 });
  assert.equal(result.result, null);
  assert.equal(result.timedOut, true);
  assert.equal(result.elapsedMs, 0);
});

test("only complete integral incumbents satisfying all constraints are accepted", () => {
  const model = {
    variables: { p1: { roster: 1, stack: -1 }, p2: { roster: 1, stack: 1 } },
    ints: { p1: 1, p2: 1 },
    constraints: { roster: { equal: 2 }, stack: { min: 0 } },
  };
  assert.equal(validatedIntegralResult({ feasible: true, p1: 1, p2: 1 }, model), null);
  assert.equal(validatedIntegralResult({ feasible: true, isIntegral: true, p1: 1.5, p2: 0.5 }, model), null);
  assert.equal(validatedIntegralResult({ feasible: true, isIntegral: true, p1: 1 }, model), null);
  assert.ok(validatedIntegralResult({ feasible: true, isIntegral: true, p1: 1, p2: 1 }, model));
});

function nflPlayer(
  id: number,
  position: string,
  team: string,
  projectedPoints: number,
  salary = 5_000,
): Player {
  return {
    id,
    slateId: 1,
    name: `Fixture ${id}`,
    position,
    team,
    salary,
    projectedPoints: String(projectedPoints),
    fppg: String(projectedPoints),
    opponent: team === "HOU" ? "BUF" : "HOU",
    gameInfo: "HOU @ BUF 1:00 PM ET",
    injuryStatus: null,
  } as Player;
}

test("mandatory NFL QB stacks remain enforced with bounded solves", () => {
  const pool = [
    nflPlayer(1, "QB", "HOU", 30, 7_000),
    nflPlayer(2, "QB", "BUF", 10, 7_000),
    nflPlayer(3, "WR", "HOU", 24),
    nflPlayer(4, "WR", "BUF", 18),
    nflPlayer(5, "WR", "BUF", 17),
    nflPlayer(6, "WR", "HOU", 16),
    nflPlayer(7, "RB", "HOU", 15),
    nflPlayer(8, "RB", "BUF", 14),
    nflPlayer(9, "TE", "HOU", 13),
    nflPlayer(10, "TE", "BUF", 8),
    nflPlayer(11, "DST", "HOU", 8, 2_500),
    nflPlayer(12, "DST", "BUF", 7, 2_500),
  ];
  const constraints = {
    slateId: 1,
    lockedPlayerIds: [1],
    excludedPlayerIds: [],
    lineupCount: 1,
    maxSalary: 50_000,
  } as OptimizationConstraints;

  const result = solveLineup(
    pool,
    constraints,
    "NFL",
    "draftkings",
    undefined,
    { timeoutMs: 500 },
  );

  assert.ok(!result.error, result.error);
  assert.equal(result.lineup.length, 9);
  assert.ok(
    result.lineup.some(
      p => p.team === "HOU" && (p.position === "WR" || p.position === "TE"),
    ),
    "locked HOU quarterback must have a same-team WR/TE",
  );
  assert.ok(result.totalSalary <= 50_000);
});

function minProjectionNFLPool(): Player[] {
  return [
    nflPlayer(1, "QB", "HOU", 30, 7_000),
    nflPlayer(2, "QB", "BUF", 10, 7_000),
    nflPlayer(3, "WR", "HOU", 24),
    nflPlayer(4, "WR", "BUF", 18),
    nflPlayer(5, "WR", "BUF", 17),
    nflPlayer(6, "WR", "HOU", 16),
    nflPlayer(7, "RB", "HOU", 15),
    nflPlayer(8, "RB", "BUF", 14),
    nflPlayer(9, "TE", "HOU", 13),
    nflPlayer(10, "TE", "BUF", 8),
    nflPlayer(11, "DST", "HOU", 8),
    nflPlayer(12, "DST", "BUF", 7),
    nflPlayer(13, "WR", "BUF", 7),
    nflPlayer(14, "DST", "BUF", 7),
  ];
}

test("deterministic GPP baseline is independent of ownership and retains hard locks", () => {
  const pool = minProjectionNFLPool();
  const constraints = {
    slateId: 1, lockedPlayerIds: [1], excludedPlayerIds: [],
    contestType: "gpp" as const, deterministicObjective: true,
  };
  const first = solveLineup(pool, constraints, "NFL", "draftkings",
    new Map(pool.map(p => [p.id, p.id % 2 ? 1 : 90])), { timeoutMs: 1000 });
  const second = solveLineup(pool, constraints, "NFL", "draftkings",
    new Map(pool.map(p => [p.id, p.id % 2 ? 90 : 1])), { timeoutMs: 1000 });
  assert.ok(!first.error, first.error);
  assert.ok(!second.error, second.error);
  assert.equal(first.totalProjectedPoints, second.totalProjectedPoints);
  assert.ok(first.lineup.some(p => p.id === 1));
  assert.ok(first.lineup.some(p => p.team === "HOU" && /WR|TE/.test(p.position)));
});

for (const contestType of ["cash", "gpp"] as const) {
  for (const boundary of [20, 30]) {
    test(`deterministic ${contestType} baseline maximizes raw totals across ${boundary}-point multiplier boundary`, () => {
      const pool = [
        ...Array.from({ length: 4 }, (_, i) => nflPlayer(i + 1, "G", "A", 1, 8000)),
        nflPlayer(5, "G", "A", boundary, 10000),
        nflPlayer(6, "G", "A", 10, 8000),
        nflPlayer(7, "G", "A", boundary - 0.1, 9000),
        nflPlayer(8, "G", "A", 10.2, 9000),
      ].map(p => ({ ...p, fppg: p.id === 5 ? String(boundary) : "100" }));
      const constraints = { slateId: 1, lockedPlayerIds: [1, 2, 3, 4], excludedPlayerIds: [],
        contestType, deterministicObjective: true };
      const baseline = solveLineup(pool, constraints, "GOLF", "draftkings", undefined, { timeoutMs: 1000 });
      assert.ok(!baseline.error, baseline.error);
      assert.ok(baseline.lineup.some(p => p.id === 7));
      assert.ok(baseline.lineup.some(p => p.id === 8));
      assert.ok(Math.abs(baseline.totalProjectedPoints - (boundary + 14.1)) < 1e-9);
      const preference = solveLineup(pool, { ...constraints, deterministicObjective: false },
        "GOLF", "draftkings", undefined, { timeoutMs: 1000 });
      assert.ok(preference.lineup.some(p => p.id === 5), "fixture crosses the preference-objective boundary");
    });
  }
}

test("optimization schemas accept finite nonnegative minProjection and reject invalid values", () => {
  const standard = optimizationConstraintSchema.parse({ slateId: 1, minProjection: 0 });
  const pro = proOptimizationConstraintSchema.parse({ slateId: 1, minProjection: 8 });
  assert.equal(standard.minProjection, 0);
  assert.equal(pro.minProjection, 8);
  assert.throws(
    () => optimizationConstraintSchema.parse({ slateId: 1, minProjection: -1 }),
    /Number must be greater than or equal to 0/,
  );
  assert.throws(
    () => optimizationConstraintSchema.parse({ slateId: 1, minProjection: Infinity }),
    /Number must be finite/,
  );
});

test("solveLineup enforces inclusive minProjection on low WR and DST players", () => {
  const result = solveLineup(
    minProjectionNFLPool(),
    {
      slateId: 1,
      lockedPlayerIds: [1],
      excludedPlayerIds: [],
      minProjection: 8,
    } as OptimizationConstraints,
    "NFL",
    "draftkings",
    undefined,
    { timeoutMs: 500 },
  );

  assert.ok(!result.error, result.error);
  assert.equal(result.lineup.length, 9);
  assert.ok(result.lineup.some(p => p.id === 11), "projection exactly at the cutoff remains eligible");
  assert.ok(!result.lineup.some(p => p.id === 12 || p.id === 13 || p.id === 14), "below-cutoff WR/DST players are excluded");
});

test("solveLineup rejects a locked player below minProjection with an actionable error", () => {
  const result = solveLineup(
    minProjectionNFLPool(),
    {
      slateId: 1,
      lockedPlayerIds: [13],
      excludedPlayerIds: [],
      minProjection: 8,
    } as OptimizationConstraints,
    "NFL",
    "draftkings",
    undefined,
    { timeoutMs: 500 },
  );

  assert.match(result.error || "", /Locked player Fixture 13.*below the minProjection cutoff of 8/);
  assert.match(result.error || "", /Remove the lock or lower minProjection/);
});

test("solveLineup honors a manual projection boost before applying minProjection", () => {
  const pool = minProjectionNFLPool().map(player =>
    player.id === 13 ? { ...player, projectedPoints: "100", fppg: "100" } : player,
  );
  const result = solveLineup(
    pool,
    {
      slateId: 1,
      lockedPlayerIds: [1],
      excludedPlayerIds: [],
      minProjection: 8,
    } as OptimizationConstraints,
    "NFL",
    "draftkings",
    undefined,
    { timeoutMs: 500 },
  );

  assert.ok(!result.error, result.error);
  assert.ok(result.lineup.some(p => p.id === 13), "a manually boosted player above the cutoff can be selected");
});

test("solveLineup reports the required-position cutoff when no NFL DST remains", () => {
  const result = solveLineup(
    minProjectionNFLPool(),
    {
      slateId: 1,
      lockedPlayerIds: [1],
      excludedPlayerIds: [],
      minProjection: 10,
    } as OptimizationConstraints,
    "NFL",
    "draftkings",
    undefined,
    { timeoutMs: 500 },
  );

  assert.match(result.error || "", /No DST\/DEF players meet the minProjection cutoff of 10/);
  assert.match(result.error || "", /Lower minProjection/);
});