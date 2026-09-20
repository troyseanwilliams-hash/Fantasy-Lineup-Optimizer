import assert from "node:assert/strict";
import test from "node:test";
import solver from "javascript-lp-solver";
import type { Player } from "../shared/schema";
import { nflPortfolioSettingsSchema, type NflPortfolioLineupPolicy } from "../shared/nfl-portfolio";
import { addNflPortfolioConstraints, classifyNflLineup, generateNflPortfolio, planNflMix } from "../server/nfl-portfolio";

const pool = ["A", "B", "C", "D", "E", "F"].flatMap((team, ti) =>
  ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"].map((position, pi) => ({
    id: ti * 8 + pi + 1, slateId: 1, name: `${team}${position}${pi}`, team, position,
    gameInfo: ti < 2 ? "A @ B" : ti < 4 ? "C @ D" : "E @ F",
    opponent: ["B", "A", "D", "C", "F", "E"][ti], salary: position === "DST" ? 2500 : 5000,
    projectedPoints: String(10 + ((ti * 7 + pi * 3) % 14)), fppg: "12",
  })),
) as Player[];
const policy: NflPortfolioLineupPolicy = { catcherCount: 1, bringBack: false, nakedQbIds: [], rbMinSalary: 4500, exemptLockedRbIds: [], minLowOwnedPlayers: 0, lowOwnershipThreshold: 10, stackGameKeys: [] };
function modelFor(players: Player[]) {
  const model: any = { optimize: "points", opType: "max", constraints: { size: { equal: 9 }, salary: { max: 50000 }, QB: { equal: 1 }, RB: { equal: 2 }, WR: { equal: 4 }, TE: { equal: 1 }, DST: { equal: 1 } }, variables: {}, ints: {} };
  for (const p of players) {
    model.constraints[`b${p.id}`] = { max: 1 };
    model.variables[`p${p.id}`] = { points: Number(p.projectedPoints), size: 1, salary: p.salary, [p.position]: 1, [`b${p.id}`]: 1 };
    model.ints[`p${p.id}`] = 1;
  }
  return model;
}
function solve(players: Player[], constraints: any) {
  const m = modelFor(players);
  for (const id of constraints.lockedPlayerIds || []) {
    m.constraints[`lock${id}`] = { equal: 1 };
    if (m.variables[`p${id}`]) m.variables[`p${id}`][`lock${id}`] = 1;
  }
  addNflPortfolioConstraints(m, players, constraints.nflPortfolioLineupPolicy, constraints.ownershipMap);
  const r = solver.Solve(m);
  return r.feasible ? { lineup: players.filter(p => Number(r[`p${p.id}`]) > 0.5) } : { error: "Fixture infeasible" };
}
const settings = nflPortfolioSettingsSchema.parse({ enabled: true, stackMix: { naked: 0, single: 100, double: 0, triple: 0 }, bringBackPct: 0 });
test("largest remainder rounding preserves count with stable ties", () => {
  assert.deepEqual(planNflMix({ naked: 10, single: 49, double: 38, triple: 3 }, 10), { naked: 1, single: 5, double: 4, triple: 0 });
  for (let n = 1; n < 150; n++) assert.equal(Object.values(planNflMix(settings.flexMix, n)).reduce((a, b) => a + b), n);
});
test("LP enforces exact catchers and no bringback without injecting one for selected games", () => {
  const m = modelFor(pool);
  addNflPortfolioConstraints(m, pool, { ...policy, catcherCount: 2, stackGameKeys: ["A-B"] });
  const r = solver.Solve(m);
  assert.ok(r.feasible);
  const f = classifyNflLineup(pool.filter(p => Number(r[`p${p.id}`]) > 0.5));
  assert.equal(f.catchers, 2); assert.equal(f.bringBack, false); assert.ok(["A", "B"].includes(f.qb!.team));
});
test("LP naked eligibility is explicit; no eligible QB means infeasible", () => {
  const m = modelFor(pool);
  addNflPortfolioConstraints(m, pool, { ...policy, catcherCount: 0 });
  assert.equal(solver.Solve(m).feasible, false);
  const m2 = modelFor(pool);
  addNflPortfolioConstraints(m2, pool, { ...policy, catcherCount: 0, nakedQbIds: [1] });
  const r = solver.Solve(m2);
  assert.ok(r.feasible); assert.equal(r.p1, 1);
  for (const teammate of pool.filter(p => p.team === "A" && p.id !== 1)) assert.ok(!r[`p${teammate.id}`]);
  assert.equal(classifyNflLineup([pool[0], pool[1]]).stack, "qbPlusTeammate");
});
test("LP hard cheap-RB and low-owned constraints are enforced", () => {
  const players = pool.map(p => ({ ...p, salary: p.id === 2 ? 4000 : p.salary }));
  const m = modelFor(players);
  const own = new Map(players.map(p => [p.id, p.position === "WR" ? 5 : 20]));
  addNflPortfolioConstraints(m, players, { ...policy, minLowOwnedPlayers: 3 }, own);
  const r = solver.Solve(m);
  assert.ok(r.feasible); assert.ok(!r.p2);
  assert.throws(() => addNflPortfolioConstraints(modelFor(players), players, { ...policy, minLowOwnedPlayers: 2 }, new Map()), /complete ownership/);
});
test("secondary includes same-team RB+TE and prioritizes RB+WR", () => {
  const qb = pool[0], rb = pool[17], te = pool[22], wr = pool[19];
  assert.equal(classifyNflLineup([qb, rb, te]).secondary, true);
  assert.equal(classifyNflLineup([qb, rb, wr]).secondaryQuality, 2);
});
test("deterministic seeded portfolio honors exclusions, uniqueness, and max exposure", async () => {
  const opts = { pool, settings, count: 3, baseConstraints: { excludedPlayerIds: [1], exposureLimits: { "2": 0 } }, solve };
  const a = await generateNflPortfolio(opts), b = await generateNflPortfolio(opts);
  const signatures = (x: typeof a) => x.lineups.map(l => l.lineup.map((p: Player) => p.id).sort((a: number, b: number) => a - b).join(","));
  assert.deepEqual(signatures(a), signatures(b));
  assert.equal(new Set(signatures(a)).size, a.lineups.length);
  assert.ok(a.lineups.every(l => !l.lineup.some((p: Player) => [1, 2].includes(p.id))));
});
test("minimum exposure infeasibility is explicit and never silently violated", async () => {
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 2, baseConstraints: { excludedPlayerIds: [1], minExposureLimits: { "1": 100 } }, solve }), /minimum and maximum exposures/);
});
test("provided mode refuses modeled map; off ignores map", async () => {
  const ownershipMap = new Map(pool.map(p => [p.id, 5]));
  await assert.rejects(generateNflPortfolio({ pool, settings: { ...settings, ownershipMode: "provided" }, count: 1, baseConstraints: {}, ownershipMap, solve }), /provided ownership is incomplete/);
  const r = await generateNflPortfolio({ pool, settings, count: 1, baseConstraints: {}, ownershipMap: new Map([[1, NaN]]), solve });
  assert.equal(r.report.dataSources.ownership, "off");
});
test("provided provenance can supply a complete actual ownership map", async () => {
  const r = await generateNflPortfolio({ pool, settings: { ...settings, ownershipMode: "provided" }, count: 1, baseConstraints: {}, ownershipMap: new Map(pool.map(p => [p.id, 5])), ownershipProvenance: "provided", solve });
  assert.equal(r.report.dataSources.ownership, "provided");
});
test("custom callback cannot bypass salary, FLEX, favorites or roster hard constraints", async () => {
  const valid = await generateNflPortfolio({ pool, settings, count: 1, baseConstraints: {}, solve });
  const fixed = () => valid.lineups[0];
  for (const baseConstraints of [{ maxSalary: 100 }, { totalMinSalary: 60000 }, { flexAllowedPositions: ["RB"] }, { stackAlternatives: [{ kind: "players", playerIds: [999] }] }]) {
    await assert.rejects(generateNflPortfolio({ pool, settings, count: 1, baseConstraints, solve: fixed }), /No NFL portfolio lineup/);
  }
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 1, baseConstraints: {}, solve: () => ({ lineup: pool.slice(0, 9) }) }), /No NFL portfolio lineup/);
});
test("projection eligibility stays deterministic and floor-violating locks fail explicitly", async () => {
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 1, baseConstraints: { minProjection: 25, lockedPlayerIds: [1] }, solve }), /Locked player.*projection floor/);
  await generateNflPortfolio({ pool, settings, count: 1, baseConstraints: { minProjection: 10 }, solve: (p, c) => { assert.equal(c.minProjection, undefined); return solve(p, c); } });
});
test("hard FLEX mask renormalizes targets and scoring hook validates supplied scores", async () => {
  const r = await generateNflPortfolio({ pool, settings, count: 2, baseConstraints: { flexAllowedPositions: ["WR"] }, solve, scoreCandidates: xs => xs.map((_, i) => i) });
  assert.equal(r.report.metrics.find(m => m.key === "flex_RB")?.target, 0);
  assert.equal(r.report.metrics.find(m => m.key === "flex_WR")?.target, 2);
  assert.equal(r.report.metrics.find(m => m.key === "fourXUpside")?.status, "unavailable");
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 1, baseConstraints: {}, solve, scoreCandidates: () => [] }), /invalid scores/);
});
test("exact favorite constraints coexist with portfolio constraints in actual LP model", () => {
  const m = modelFor(pool);
  m.constraints.exact_favorite = { equal: 3 };
  for (const id of [1, 4, 18]) m.variables[`p${id}`].exact_favorite = 1;
  addNflPortfolioConstraints(m, pool, policy);
  const r: any = solver.Solve(m);
  assert.ok(r.feasible);
  for (const id of [1, 4, 18]) assert.equal(r[`p${id}`], 1);
  assert.equal(classifyNflLineup(pool.filter(p => r[`p${p.id}`] === 1)).bringBack, false);
});
test("candidate generation actively excludes dominant players to satisfy exposure", async () => {
  const dominant = pool.map(p => ({ ...p, projectedPoints: p.id === 18 ? "500" : p.projectedPoints }));
  let pressureAttempts = 0;
  const result = await generateNflPortfolio({
    pool: dominant, settings, count: 4, baseConstraints: { exposureLimits: { "18": 50 } },
    solve: (p, c) => { if (c.excludedPlayerIds.includes(18)) pressureAttempts++; return solve(p, c); },
  });
  assert.ok(pressureAttempts > 0);
  assert.equal(result.lineups.length, 4);
  assert.ok(result.lineups.filter(x => x.lineup.some((p: Player) => p.id === 18)).length <= 2);
});
test("candidate generation explicitly seeds low-projection minimum exposure targets", async () => {
  const low = pool.map(p => ({ ...p, projectedPoints: p.id === 18 ? "0.01" : p.projectedPoints }));
  let forcedAttempts = 0;
  const result = await generateNflPortfolio({
    pool: low, settings, count: 4, baseConstraints: { minExposureLimits: { "18": 50 } },
    solve: (p, c) => { if (c.lockedPlayerIds.includes(18)) forcedAttempts++; return solve(p, c); },
  });
  assert.ok(forcedAttempts > 0);
  assert.equal(result.lineups.length, 4);
  assert.ok(result.lineups.filter(x => x.lineup.some((p: Player) => p.id === 18)).length >= 2);
});
test("locked player max contradiction is infeasible before search; exhausted time is not proof", async () => {
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 3, baseConstraints: { lockedPlayerIds: [1], globalMaxExposure: 80 }, solve }), /locked player.*100%/);
  await assert.rejects(generateNflPortfolio({ pool, settings, count: 3, baseConstraints: {}, deadline: Date.now() - 1, solve }), /time budget.*does not prove infeasibility/);
});
test("generic player minimum salary exempts defense but maximum still applies", async () => {
  const result = await generateNflPortfolio({ pool, settings, count: 1, baseConstraints: { playerMinSalary: 4500 }, solve });
  assert.ok(result.lineups[0].lineup.some((p: Player) => p.position === "DST" && p.salary < 4500));
  const expensiveDefense = pool.map(p => ({ ...p, salary: p.position === "DST" ? 5100 : p.salary }));
  await assert.rejects(generateNflPortfolio({ pool: expensiveDefense, settings, count: 1, baseConstraints: { playerMaxSalary: 5000 }, solve }), /No NFL portfolio lineup/);
});