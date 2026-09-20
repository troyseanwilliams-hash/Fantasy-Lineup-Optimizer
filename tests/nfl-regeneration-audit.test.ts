import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { solveLineup } from "../server/routes";
import { generateNflPortfolio, regenerationNflSettings, classifyNflLineup } from "../server/nfl-portfolio";
import { assertLineupExposures } from "../server/lineup-exposure";
import type { Player } from "../shared/schema";

// Optional read-only replay of the supplied SQL CSV export, never queries a DB.
// Uses exported median projections, not refreshed external boosts/status feeds.
const path = process.env.NFL_AUDIT_POOL_FILE;
test("real exported NFL slate: full 193-lineup automatic portfolios at 40% and 60%", { skip: !path }, async t => {
  const csv = readFileSync(path!, "utf8").trim();
  const field = csv.slice(csv.indexOf("\n") + 1).trim();
  const raw = JSON.parse(field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field);
  const pool: Player[] = raw.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value])))
    .filter((p: Player) => Number(p.projectedPoints) > 0 && !["OUT", "O", "IR", "DOUBTFUL", "D", "SUSPENDED"].includes((p.injuryStatus || "").toUpperCase()));
  for (const globalMaxExposure of [40, 60]) {
    const started = Date.now(), deadline = started + 32000;
    const result = await generateNflPortfolio({
      pool, settings: regenerationNflSettings(pool), count: 193, strictStructure: true, structureOnly: true,
      baseConstraints: { slateId: pool[0].slateId, contestType: "gpp", maxSalary: 50000, globalMaxExposure },
      deadline,
      scoreCandidates: candidates => {
        const shapes = candidates.map(c => classifyNflLineup(c.lineup));
        t.diagnostic(JSON.stringify({ globalMaxExposure, candidates: candidates.length, stacks: ["naked", "single", "double", "triple"].map(k => shapes.filter(s => s.stack === k).length), flex: ["RB", "WR", "TE"].map(k => shapes.filter(s => s.flex === k).length), secondary: shapes.filter(s => s.secondary).length }));
        return candidates.map(c => c.totalProjectedPoints);
      },
      solve: (candidatePool, constraints) => solveLineup(candidatePool, constraints, "NFL", "draftkings", undefined, { deadline, timeoutMs: 100 }),
    });
    assert.equal(result.lineups.length, 193);
    assertLineupExposures(result.lineups, l => l.lineup.map((p: Player) => p.id), { globalMaxExposure });
    const metrics = result.report.metrics.filter(m => m.key.startsWith("stack_") || m.key.startsWith("flex_") || ["bringBack", "secondary"].includes(m.key));
    assert.ok(metrics.every(m => m.status === "met"), JSON.stringify(metrics));
    t.diagnostic(JSON.stringify({ globalMaxExposure, players: pool.length, elapsedMs: Date.now() - started, candidates: result.report.candidateCount, metrics }));
  }
});