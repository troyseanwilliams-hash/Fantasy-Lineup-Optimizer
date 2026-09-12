import assert from "node:assert/strict";
import test from "node:test";
import type { Player } from "../shared/schema";
import { createLineupEnrichmentLoader } from "../server/lineups-enrichment";

const fixturePlayer = (id: number): Player => ({
  id,
  slateId: 1,
  name: `Player ${id}`,
  team: "TST",
  position: "PG",
  salary: 5_000,
  fppg: "20",
  projectedPoints: "20",
  opponent: "OPP",
  gameInfo: "TST @ OPP",
  injuryStatus: null,
} as Player);

const testDependencies = (overrides: Partial<Parameters<typeof createLineupEnrichmentLoader>[0]> = {}) => {
  let playersCalls = 0;
  let slateCalls = 0;
  let statsCalls = 0;
  let ownershipCalls = 0;
  const dependencies = {
    getPlayersBySlate: async (_slateId: number) => {
      playersCalls++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return [fixturePlayer(1)];
    },
    getSlate: async (_slateId: number) => {
      slateCalls++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return { sport: "NBA", gameType: null };
    },
    fetchBDLStats: async (_sport: string) => {
      statsCalls++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return {};
    },
    calculateOwnership: async (players: Player[]) => {
      ownershipCalls++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return players.map(player => ({
        playerId: player.id,
        name: player.name,
        team: player.team,
        position: player.position,
        salary: player.salary,
        projectedPoints: Number(player.projectedPoints),
        projectedOwnership: 10,
        ownershipTier: "mid" as const,
      }));
    },
    computeOwnershipForPlayers: (players: Player[], ownershipResults: any[]) =>
      players.map(player => ({
        ...player,
        ownershipProjection: ownershipResults.find(result => result.playerId === player.id)?.projectedOwnership || 0,
      })),
  };
  return {
    dependencies: { ...dependencies, ...overrides },
    calls: () => ({ playersCalls, slateCalls, statsCalls, ownershipCalls }),
  };
};

test("same slate and sport share in-flight enrichment work", async () => {
  const fixture = testDependencies();
  const loader = createLineupEnrichmentLoader(fixture.dependencies);

  await Promise.all([
    ...Array.from({ length: 200 }, () => loader.getSlateEnrichment(1)),
    ...Array.from({ length: 200 }, () => loader.getSlateEnrichment(2)),
  ]);

  assert.deepEqual(fixture.calls(), {
    playersCalls: 2,
    slateCalls: 2,
    statsCalls: 1,
    ownershipCalls: 2,
  });
});

test("enrichment errors propagate to every waiting lineup", async () => {
  const expected = new Error("players unavailable");
  const fixture = testDependencies({
    getPlayersBySlate: async () => {
      throw expected;
    },
  });
  const loader = createLineupEnrichmentLoader(fixture.dependencies);

  const errors = await Promise.all(
    Array.from({ length: 2 }, () => loader.getSlateEnrichment(1).catch(error => error)),
  );

  assert.equal(errors[0], expected);
  assert.equal(errors[1], expected);
});