import type { Player, Slate } from "@shared/schema";
import type { PlayerStatsMap } from "./balldontlie-stats";
import type { OwnershipResult } from "./ownership-engine";

export interface LineupSlateEnrichment {
  allWithOwnership: (Player & { ownershipProjection: number })[];
  playerIdSet: Set<number>;
  gameType: string | null;
}

export interface LineupEnrichmentDependencies {
  getPlayersBySlate(slateId: number): Promise<Player[]>;
  getSlate(slateId: number): Promise<Pick<Slate, "sport" | "gameType"> | undefined>;
  fetchBDLStats(sport: string): Promise<PlayerStatsMap>;
  calculateOwnership(
    players: Player[],
    sport: string,
    contestType: "gpp_large",
    bdlStats?: PlayerStatsMap,
  ): Promise<OwnershipResult[]>;
  computeOwnershipForPlayers(
    players: Player[],
    ownershipResults: OwnershipResult[],
  ): (Player & { ownershipProjection: number })[];
}

/**
 * Build the per-request slate enrichment loader used by the saved lineups
 * endpoint. Promises are stored before any await so concurrent lineups for
 * the same slate (or sport) share the in-flight work.
 */
export function createLineupEnrichmentLoader(dependencies: LineupEnrichmentDependencies) {
  const sportStatsPromises = new Map<string, Promise<PlayerStatsMap>>();
  const slatePromises = new Map<number, Promise<LineupSlateEnrichment>>();

  const getSportStats = (sport: string): Promise<PlayerStatsMap> => {
    const cacheKey = sport.toUpperCase();
    const existing = sportStatsPromises.get(cacheKey);
    if (existing) return existing;

    const promise = Promise.resolve().then(() => dependencies.fetchBDLStats(sport));
    sportStatsPromises.set(cacheKey, promise);
    return promise;
  };

  const getSlateEnrichment = (slateId: number): Promise<LineupSlateEnrichment> => {
    const existing = slatePromises.get(slateId);
    if (existing) return existing;

    const promise = Promise.resolve().then(async (): Promise<LineupSlateEnrichment> => {
      const slatePlayers = await dependencies.getPlayersBySlate(slateId);
      const slate = await dependencies.getSlate(slateId);
      const sport = slate?.sport || "NBA";
      const bdlStats = await getSportStats(sport);
      const ownershipResults = await dependencies.calculateOwnership(
        slatePlayers,
        sport,
        "gpp_large",
        bdlStats,
      );

      return {
        allWithOwnership: dependencies.computeOwnershipForPlayers(slatePlayers, ownershipResults),
        playerIdSet: new Set(slatePlayers.map(player => player.id)),
        gameType: slate?.gameType || null,
      };
    });
    slatePromises.set(slateId, promise);
    return promise;
  };

  return { getSlateEnrichment };
}