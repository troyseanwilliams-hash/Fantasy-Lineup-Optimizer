import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Player } from "../shared/schema";
import { solveLineup, buildSimRegenerateSolverConstraints } from "../server/routes";
import { createSimExposureSearch, filterSimProjectionCandidates } from "../server/sim-exposure-search";
import { assertLineupExposures, selectExposureLineups } from "../server/lineup-exposure";
import { runSimulations } from "../server/simulation-engine";

// Full-slate shaped synthetic regression fixture, not historical performance data.
const pool = Array.from({ length: 16 }, (_, team) =>
  ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"].map((position, slot) => ({
    id: team * 8 + slot + 1, slateId: 1, name: `Team ${team} ${position} ${slot}`,
    team: `T${team}`, opponent: `T${team ^ 1}`, position,
    gameInfo: `T${team & ~1} @ T${team | 1} 1:00 PM ET`,
    salary: position === "DST" ? 2700 + team * 30 : 4300 + slot * 170 + team * 50,
    projectedPoints: String((position === "DST" ? 9 : position === "QB" ? 25 : 20) -
      team * 0.35 - slot * 0.35 + (team < 2 ? 7 : 0)),
    fppg: "15", injuryStatus: null,
  } as Player))).flat();

test("193/40 regression: automatic 235.7 floor cannot cut 273 candidates to 137; explicit floor remains hard", () => {
  const candidates = Array.from({ length: 273 }, (_, i) => i < 137 ? 250 : 230);
  const options = { count: 193, automaticFloor: 235.7, constrained: true };
  assert.equal(filterSimProjectionCandidates(candidates, x => x, options), candidates);
  assert.equal(filterSimProjectionCandidates(candidates, x => x, { ...options, constrained: false }), candidates);
  assert.equal(filterSimProjectionCandidates(candidates, x => x, { ...options, explicitFloor: 235.7 }).length, 137);
  assert.equal(filterSimProjectionCandidates(candidates, x => x, { ...options, explicitFloor: 300 }).length, 0);
});

for (const [count, cap] of [[15, 80], [193, 40]]) {
  test(`real roster solver supplies ${count} lineups under ${cap}% cap and star 40%`, () => {
    const bounds = { globalMaxExposure: cap, exposureLimits: { 2: 40, 3: 0 }, minExposureLimits: { 124: 10 } };
    const search = createSimExposureSearch(bounds, count);
    const candidates = new Map<string, { lineup: Player[] }>();
    const base = buildSimRegenerateSolverConstraints(1, [], 50000, "gpp", {});
    const deadline = Date.now() + 35000;
    let seed = 42;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < Math.max(180, Math.ceil(count * 1.42)) && Date.now() < deadline - 7000; i++) {
      const constraints = search(base, pool.map(p => p.id), candidates.values());
      const result = solveLineup(pool.map(p => ({
        ...p, projectedPoints: String(Number(p.projectedPoints) * (0.9 + random() * 0.2)),
      })), constraints, "NFL", "draftkings", undefined, { deadline: deadline - 7000, timeoutMs: 300 });
      if (result.error || !result.lineup.length) continue;
      candidates.set(result.lineup.map(p => p.id).sort((a, b) => a - b).join(","), result);
    }
    const selected = selectExposureLineups([...candidates.values()], c => c.lineup.map(p => p.id), bounds,
      { count, requireFull: true, deadline });
    assert.equal(selected.length, count);
    assertLineupExposures(selected, c => c.lineup.map(p => p.id), bounds);
    for (const c of selected) {
      assert.equal(c.lineup.length, 9);
      assert.ok(c.lineup.reduce((n, p) => n + p.salary, 0) <= 50000);
    }
  });
}

test("optional read-only exported slate: 193 at 40%, actual simulation p90 ranking", {
  skip: !process.env.RESIM_POOL_FIXTURE,
}, () => {
  const start = Date.now();
  const raw: Player[] = JSON.parse(readFileSync(process.env.RESIM_POOL_FIXTURE!, "utf8"));
  const eligible = raw.filter(p => !["OUT", "IR", "DOUBTFUL", "INJ", "O", "SUS", "NA"].includes((p.injuryStatus || "").toUpperCase()))
    .map(p => {
      let pts = Number(p.projectedPoints || p.fppg || 0);
      if (p.isConfirmedStarter) pts = Math.round(pts * 1.05 * 10) / 10;
      if (p.boostScore) pts = Math.round(pts * (1 + Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008))) * 10) / 10;
      return { ...p, projectedPoints: String(pts) };
    });
  const keep = new Set<number>();
  for (const position of ["QB", "RB", "WR", "TE", "DST"]) {
    const players = eligible.filter(p => p.position.split("/").includes(position));
    for (const p of [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints)).slice(0, 20)) keep.add(p.id);
    for (const p of [...players].sort((a, b) => a.salary - b.salary).slice(0, 5)) keep.add(p.id);
  }
  const lpPool = eligible.filter(p => keep.has(p.id));
  const bounds = { globalMaxExposure: 40 };
  const search = createSimExposureSearch(bounds, 193);
  const base = buildSimRegenerateSolverConstraints(raw[0].slateId, [], 50000, "gpp", {});
  const candidates = new Map<string, { lineup: Player[]; score: number }>();
  // Match the failing request's candidate budget, not an easier larger pool.
  const sims = runSimulations(eligible, "NFL", 273);
  const deadline = start + 30000;
  for (const sim of sims) {
    if (Date.now() >= deadline - 7000) break;
    const result = solveLineup(lpPool.map(p => ({
      ...p, projectedPoints: String(sim.projections[p.id] * 0.7 + Number(p.projectedPoints) * 0.3),
    })), search(base, lpPool.map(p => p.id), candidates.values()), "NFL", "draftkings", undefined,
    { deadline: deadline - 7000, timeoutMs: 1000 });
    if (result.error || !result.lineup.length) continue;
    const scores = sims.map(s => result.lineup.reduce((sum, p) => sum + (s.projections[p.id] || 0), 0)).sort((a, b) => a - b);
    candidates.set(result.lineup.map(p => p.id).sort((a, b) => a - b).join(","), { lineup: result.lineup, score: scores[Math.floor(scores.length * 0.9)] });
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const selected = selectExposureLineups(ranked, c => c.lineup.map(p => p.id), bounds, { count: 193, requireFull: true, deadline });
  assert.equal(selected.length, 193);
  assertLineupExposures(selected, c => c.lineup.map(p => p.id), bounds);
  console.info(JSON.stringify({ raw: raw.length, eligible: eligible.length, lpPool: lpPool.length,
    candidates: candidates.size, selected: selected.length, elapsedMs: Date.now() - start }));
});