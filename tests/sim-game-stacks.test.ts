import assert from "node:assert/strict";
import test from "node:test";
import { solveLineup } from "../server/routes";
import type { Player, OptimizationConstraints } from "../shared/schema";
import { stackGameKey } from "../server/sim-game-stacks";

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
test("no selection retains unrestricted optimization", () => {
  assert.ok(!solveLineup(pool, { ...base, stackGameKeys: [] }, "NFL", "draftkings").error);
});