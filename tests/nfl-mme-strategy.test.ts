import assert from "node:assert/strict";
import test from "node:test";
import { generateMockLineups } from "../client/src/pages/NFLMMEOptimizer";

const settings = {
  platform: "draftkings" as const,
  contestType: "gpp" as const,
  numLineups: 20,
  minUniquePlayers: 2,
  maxExposure: 60,
  minExposure: 0,
  enableQBStack: true,
  enableBringback: true,
  leverageOwnership: true,
  maxPlayersPerTeam: 5,
};

test("NFL MME historical strategy produces a complete valid portfolio", () => {
  const lineups = generateMockLineups(settings, settings.numLineups);
  assert.equal(lineups.length, settings.numLineups);

  const exposure = new Map<number, number>();
  const stackCounts = new Map<number, number>();
  for (const lineup of lineups) {
    assert.equal(lineup.players.length, 9);
    assert.ok(lineup.totalSalary <= 50_000);
    assert.deepEqual(
      lineup.players.map(player => player.position),
      ["QB", "RB", "RB", "WR", "WR", "WR", "TE", lineup.players[7].position, "DST"],
    );
    assert.ok(["RB", "WR", "TE"].includes(lineup.players[7].position));
    assert.ok(new Set(lineup.players.map(player => player.gameKey)).size >= 5);
    assert.ok(new Set(lineup.players.map(player => player.gameKey)).size <= 6);
    assert.ok(lineup.players.filter(player => player.position === "WR" && player.projOwnership < 10).length >= 2);

    const qb = lineup.players[0];
    const stackSize = lineup.players.filter(player =>
      player.team === qb.team && ["WR", "TE"].includes(player.position)
    ).length;
    stackCounts.set(stackSize, (stackCounts.get(stackSize) || 0) + 1);
    lineup.players.forEach(player => exposure.set(player.id, (exposure.get(player.id) || 0) + 1));
  }

  assert.deepEqual(Object.fromEntries(stackCounts), { 0: 2, 1: 10, 2: 7, 3: 1 });
  assert.ok(Math.max(...exposure.values()) <= 12);
});