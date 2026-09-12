import assert from "node:assert/strict";
import test from "node:test";
import { solveLineup } from "../server/routes";
import type { Player, OptimizationConstraints } from "../shared/schema";
import { stackGameKey } from "../server/sim-game-stacks";
import { addNFLQuarterbackStacks } from "../server/nfl-qb-stacks";
import solver from "javascript-lp-solver";

const pool = ["BUF", "HOU", "DET", "NO"].flatMap((team, ti) =>
  ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"].map((position, pi) => ({
    id: ti * 8 + pi + 1, slateId: 1, name: `${team} ${pi}`, team, position,
    opponent: ["HOU", "BUF", "NO", "DET"][ti],
    gameInfo: ti < 2 ? "BUF @ HOU 1:00 PM ET" : "NO @ DET 1:00 PM ET",
    salary: position === "DST" ? 2500 : 5000,
    projectedPoints: String(ti < 2 ? 12 : 20), fppg: "12",
  })),
) as Player[];
const base = { slateId: 1, lockedPlayerIds: [], excludedPlayerIds: [], maxSalary: 50000, lineupCount: 1 } as OptimizationConstraints;
for (const keys of [["BUF-HOU"], ["DET-NO"], ["BUF-HOU", "DET-NO"]]) {
  test(`requires QB + catcher + bring-back from one selected game: ${keys}`, () => {
    const result = solveLineup(pool, { ...base, stackGameKeys: keys }, "NFL", "draftkings");
    assert.ok(!result.error, result.error);
    const qb = result.lineup.find(p => p.position === "QB")!;
    assert.ok(keys.includes(stackGameKey(qb.gameInfo)));
    assert.ok(result.lineup.some(p => p.team === qb.team && ["WR", "TE"].includes(p.position)));
    assert.ok(result.lineup.some(p => p.team === qb.opponent && ["RB", "WR", "TE"].includes(p.position)));
    assert.equal(result.lineup.length, 9);
    assert.ok(result.totalSalary <= 50000);
  });
}
test("impossible selected stack does not silently become unrestricted", () => {
  const result = solveLineup(pool, {
    ...base, stackGameKeys: ["BUF-HOU"],
    excludedPlayerIds: pool.filter(p => p.position === "QB" && ["BUF", "HOU"].includes(p.team)).map(p => p.id),
  }, "NFL", "draftkings");
  assert.ok(result.error);
});
for (const contestType of ["cash", "gpp"]) {
  for (const platform of ["draftkings", "fanduel", "yahoo"] as const) {
    test(`no game selection still pairs a QB with a WR/TE: ${contestType}/${platform}`, () => {
      const adversarial = pool.map(p => ({
        ...p,
        salary: platform === "yahoo" ? 15 : p.salary,
        position: platform === "yahoo" && p.position === "DST" ? "K" : p.position,
        projectedPoints: p.id === 1 ? "100" : p.team === "BUF" ? "0.1" : "20",
      }));
      const result = solveLineup(adversarial, {
        ...base, maxSalary: platform === "yahoo" ? 200 : 50000,
        contestType, stackGameKeys: [],
      }, "NFL", platform);
      assert.ok(!result.error, result.error);
      const qb = result.lineup.find(p => p.position === "QB")!;
      assert.equal(qb.id, 1);
      assert.ok(result.lineup.some(p => p.team === qb.team && ["WR", "TE"].includes(p.position)));
      assert.equal(result.lineup.length, 9);
    });
  }
}
test("a locked QB with every same-team catcher excluded is infeasible", () => {
  const result = solveLineup(pool, {
    ...base, lockedPlayerIds: [1],
    excludedPlayerIds: pool.filter(p => p.team === "BUF" && ["WR", "TE"].includes(p.position)).map(p => p.id),
  }, "NFL", "draftkings");
  assert.ok(result.error);
});

// Both Showdown paths optimize FLEX with a preselected captain.
function showdownModel(captainId: number, lockedIds: number[] = [], excludedIds: number[] = []) {
  const captain = pool.find(p => p.id === captainId)!;
  const flexPool = pool.filter(p => p.id !== captainId && !excludedIds.includes(p.id));
  const model: any = {
    optimize: "points", opType: "max", constraints: { size: { equal: 5 } },
    variables: {}, ints: {},
  };
  for (const p of flexPool) {
    model.variables[`p${p.id}`] = { points: p.position === "QB" ? 100 : Number(p.projectedPoints), size: 1, [`bound${p.id}`]: 1 };
    model.constraints[`bound${p.id}`] = lockedIds.includes(p.id) ? { equal: 1 } : { max: 1 };
    model.ints[`p${p.id}`] = 1;
  }
  addNFLQuarterbackStacks(model, flexPool, "NFL", captain);
  return { result: solver.Solve(model) as any, captain, flexPool };
}
for (const captainId of [1, 4, 2]) {
  test(`Showdown pairs all QBs when captain is ${pool[captainId - 1].position}`, () => {
    const { result, captain, flexPool } = showdownModel(captainId, [9]);
    assert.ok(result.feasible);
    const lineup = [captain, ...flexPool.filter(p => result[`p${p.id}`] > 0.5)];
    for (const qb of lineup.filter(p => p.position === "QB")) {
      assert.ok(lineup.some(p => p.team === qb.team && ["WR", "TE"].includes(p.position)));
    }
  });
}
test("Showdown QB captain cannot bypass missing catchers", () => {
  const exclusions = pool.filter(p => p.team === "BUF" && ["WR", "TE"].includes(p.position)).map(p => p.id);
  assert.equal(showdownModel(1, [], exclusions).result.feasible, false);
});
test("other sports do not receive NFL stacking constraints", () => {
  const model = { constraints: {}, variables: {} };
  addNFLQuarterbackStacks(model, pool, "NBA");
  assert.deepEqual(model.constraints, {});
});
for (const fixedCaptain of [false, true]) {
  test(`dual-position QB cannot count as their own catcher (captain=${fixedCaptain})`, () => {
    const qb = { id: 1, team: "BUF", position: "QB/TE" };
    const model: any = {
      optimize: "points", opType: "max",
      constraints: fixedCaptain ? {} : { locked: { equal: 1 } },
      variables: fixedCaptain ? {} : { p1: { points: 20, locked: 1 } },
      ints: fixedCaptain ? {} : { p1: 1 },
    };
    addNFLQuarterbackStacks(model, fixedCaptain ? [] : [qb], "NFL", fixedCaptain ? qb : undefined);
    assert.equal((solver.Solve(model) as any).feasible, false);
  });
}