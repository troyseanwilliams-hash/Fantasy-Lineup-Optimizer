import type { Player, PlayerHistory } from "@shared/schema";
import type { PlayerStatsMap } from "./balldontlie-stats";
import { normalizeName } from "./balldontlie-stats";
import { storage } from "./storage";

export type ContestType = "gpp_large" | "gpp_small" | "cash";

interface SportConfig {
  projectionWeight: number;
  salaryWeight: number;
  valueWeight: number;
  recencyWeight: number;
  consistencyWeight: number;
  starPowerWeight: number;
  stackTendency: number;
  softmaxTemperature: Record<ContestType, number>;
  ownershipCeiling: Record<ContestType, number>;
  ownershipFloor: number;
  positionChalkMultipliers: Record<string, number>;
}

const SPORT_CONFIGS: Record<string, SportConfig> = {
  NBA: {
    projectionWeight: 0.30,
    salaryWeight: 0.15,
    valueWeight: 0.20,
    recencyWeight: 0.15,
    consistencyWeight: 0.05,
    starPowerWeight: 0.15,
    stackTendency: 0.8,
    softmaxTemperature: { gpp_large: 1.8, gpp_small: 1.4, cash: 0.9 },
    ownershipCeiling: { gpp_large: 40, gpp_small: 45, cash: 55 },
    ownershipFloor: 0.3,
    positionChalkMultipliers: { PG: 1.0, SG: 0.95, SF: 0.95, PF: 1.0, C: 1.05 },
  },
  NHL: {
    projectionWeight: 0.30,
    salaryWeight: 0.12,
    valueWeight: 0.22,
    recencyWeight: 0.15,
    consistencyWeight: 0.06,
    starPowerWeight: 0.15,
    stackTendency: 0.9,
    softmaxTemperature: { gpp_large: 1.9, gpp_small: 1.5, cash: 1.0 },
    ownershipCeiling: { gpp_large: 38, gpp_small: 42, cash: 50 },
    ownershipFloor: 0.3,
    positionChalkMultipliers: { C: 1.05, W: 1.0, D: 0.90, G: 1.10, UTIL: 0.95 },
  },
  NFL: {
    projectionWeight: 0.32,
    salaryWeight: 0.10,
    valueWeight: 0.18,
    recencyWeight: 0.10,
    consistencyWeight: 0.10,
    starPowerWeight: 0.20,
    stackTendency: 0.95,
    softmaxTemperature: { gpp_large: 2.0, gpp_small: 1.6, cash: 0.8 },
    ownershipCeiling: { gpp_large: 45, gpp_small: 50, cash: 60 },
    ownershipFloor: 0.2,
    positionChalkMultipliers: { QB: 1.15, RB: 1.0, WR: 0.95, TE: 0.90, DST: 1.05, FLEX: 0.95 },
  },
  MLB: {
    projectionWeight: 0.28,
    salaryWeight: 0.12,
    valueWeight: 0.25,
    recencyWeight: 0.15,
    consistencyWeight: 0.05,
    starPowerWeight: 0.15,
    stackTendency: 0.85,
    softmaxTemperature: { gpp_large: 1.7, gpp_small: 1.3, cash: 0.9 },
    ownershipCeiling: { gpp_large: 35, gpp_small: 40, cash: 50 },
    ownershipFloor: 0.3,
    positionChalkMultipliers: { P: 1.10, C: 0.90, "1B": 1.0, "2B": 0.95, "3B": 0.95, SS: 0.95, OF: 0.90 },
  },
  GOLF: {
    projectionWeight: 0.35,
    salaryWeight: 0.10,
    valueWeight: 0.20,
    recencyWeight: 0.20,
    consistencyWeight: 0.10,
    starPowerWeight: 0.05,
    stackTendency: 0,
    softmaxTemperature: { gpp_large: 2.2, gpp_small: 1.8, cash: 1.2 },
    ownershipCeiling: { gpp_large: 30, gpp_small: 35, cash: 45 },
    ownershipFloor: 0.2,
    positionChalkMultipliers: { G: 1.0 },
  },
  SOCCER: {
    projectionWeight: 0.30,
    salaryWeight: 0.12,
    valueWeight: 0.22,
    recencyWeight: 0.15,
    consistencyWeight: 0.08,
    starPowerWeight: 0.13,
    stackTendency: 0.6,
    softmaxTemperature: { gpp_large: 1.8, gpp_small: 1.4, cash: 0.9 },
    ownershipCeiling: { gpp_large: 35, gpp_small: 40, cash: 50 },
    ownershipFloor: 0.3,
    positionChalkMultipliers: { F: 1.05, M: 1.0, D: 0.90, GK: 1.0 },
  },
};

function getConfig(sport: string): SportConfig {
  return SPORT_CONFIGS[sport.toUpperCase()] || SPORT_CONFIGS.NBA;
}

interface PlayerPopularityScore {
  playerId: number;
  player: Player;
  rawScore: number;
  components: {
    projection: number;
    salary: number;
    value: number;
    recency: number;
    consistency: number;
    starPower: number;
  };
}

function computePopularityScores(
  players: Player[],
  sport: string,
  bdlStats?: PlayerStatsMap,
  historyMap?: Map<string, PlayerHistory[]>
): PlayerPopularityScore[] {
  const config = getConfig(sport);
  if (players.length === 0) return [];

  const maxSalary = Math.max(...players.map(p => p.salary));
  const maxProj = Math.max(...players.map(p => Number(p.projectedPoints) || 0), 1);
  const maxValue = Math.max(...players.map(p => (Number(p.projectedPoints) || 0) / Math.max(p.salary / 1000, 0.1)), 0.1);

  const posCounts: Record<string, number> = {};
  players.forEach(p => {
    const primary = p.position.split("/")[0];
    posCounts[primary] = (posCounts[primary] || 0) + 1;
  });
  const avgPosCount = Object.values(posCounts).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(posCounts).length);

  const sorted = [...players].sort((a, b) => (Number(b.projectedPoints) || 0) - (Number(a.projectedPoints) || 0));
  const rankMap = new Map<number, number>();
  sorted.forEach((p, i) => rankMap.set(p.id, i));

  const hasBDL = bdlStats && Object.keys(bdlStats).length > 0;
  const maxBDLFantasy = hasBDL ? Math.max(...Object.values(bdlStats!).map(s => s.fantasyScore), 1) : 1;

  return players.map(player => {
    const proj = Number(player.projectedPoints) || 0;
    const projScore = proj / maxProj;

    const salaryScore = player.salary / (maxSalary || 1);

    const valueRaw = proj / Math.max(player.salary / 1000, 0.1);
    const valueScore = valueRaw / maxValue;

    let recencyScore = 0.5;
    let consistencyScore = 0.5;
    const key = normalizeName(player.name);
    if (historyMap) {
      const history = historyMap.get(key);
      if (history && history.length >= 2) {
        const recentProjs = history.slice(0, 5).map(h => Number(h.projectedPoints) || 0);
        const avg = recentProjs.reduce((a, b) => a + b, 0) / recentProjs.length;
        recencyScore = avg > 0 ? Math.min(1, proj / avg) : 0.5;

        if (history.length >= 3) {
          const stdDev = Math.sqrt(recentProjs.reduce((sum, v) => sum + (v - avg) ** 2, 0) / recentProjs.length);
          const cv = avg > 0 ? stdDev / avg : 1;
          consistencyScore = Math.max(0, Math.min(1, 1 - cv));
        }
      }
    }

    let starPowerScore = 0;
    if (hasBDL) {
      const stats = bdlStats![key];
      if (stats) {
        starPowerScore = stats.fantasyScore / maxBDLFantasy * 0.5 + stats.starPower * 0.3 + stats.consistency * 0.2;
      }
    }

    const primaryPos = player.position.split("/")[0];
    const posChalk = config.positionChalkMultipliers[primaryPos] || 1.0;
    const scarcity = avgPosCount / Math.max(1, posCounts[primaryPos] || avgPosCount);
    const scarcityBonus = Math.min(1.2, Math.max(0.85, scarcity));

    // Injury penalty multiplier applied to raw popularity score.
    // OUT/IR:        zeroed — excluded from lineup generation, shown at ~0% ownership.
    // Questionable:  heavily suppressed (0.15) — visible in UI with low projected
    //                ownership so users can see the player is flagged. Using 0 here
    //                would zero out the score entirely, misrepresenting field behavior
    //                and breaking the ownership distribution sum.
    // Doubtful:      near-zero (0.05) — same reasoning, even more suppressed.
    // Probable:      slight suppression (0.90) — most Probable players suit up.
    const injuryPenalty =
      player.injuryStatus === "OUT" || player.injuryStatus === "IR" ? 0
      : player.injuryStatus === "Questionable" ? 0.15
      : player.injuryStatus === "Doubtful" ? 0.05
      : player.injuryStatus === "Probable" ? 0.90
      : 1.0;

    const raw = (
      projScore * config.projectionWeight +
      salaryScore * config.salaryWeight +
      valueScore * config.valueWeight +
      recencyScore * config.recencyWeight +
      consistencyScore * config.consistencyWeight +
      starPowerScore * config.starPowerWeight
    ) * posChalk * scarcityBonus * injuryPenalty;

    return {
      playerId: player.id,
      player,
      rawScore: Math.max(0, raw),
      components: {
        projection: projScore,
        salary: salaryScore,
        value: valueScore,
        recency: recencyScore,
        consistency: consistencyScore,
        starPower: starPowerScore,
      },
    };
  });
}

function softmaxTransform(scores: PlayerPopularityScore[], temperature: number): { playerId: number; probability: number }[] {
  if (scores.length === 0) return [];

  const maxScore = Math.max(...scores.map(s => s.rawScore));
  const scaledScores = scores.map(s => ({
    playerId: s.playerId,
    exp: Math.exp((s.rawScore - maxScore) * temperature),
  }));

  const totalExp = scaledScores.reduce((sum, s) => sum + s.exp, 0) || 1;

  return scaledScores.map(s => ({
    playerId: s.playerId,
    probability: s.exp / totalExp,
  }));
}

function normalizeOwnership(
  probabilities: { playerId: number; probability: number }[],
  sport: string,
  contestType: ContestType,
  totalPlayers: number
): Map<number, number> {
  const config = getConfig(sport);
  const ceiling = config.ownershipCeiling[contestType];
  const floor = config.ownershipFloor;

  const sorted = [...probabilities].sort((a, b) => b.probability - a.probability);

  const rosterSize = getRosterSize(sport);
  const targetTotal = rosterSize * 100;

  const result = new Map<number, number>();

  for (let i = 0; i < sorted.length; i++) {
    const { playerId, probability } = sorted[i];
    let ownership = probability * targetTotal;

    ownership = Math.max(floor, Math.min(ceiling, ownership));

    const seed = Math.sin(playerId * 9301 + 49297) * 0.5 + 0.5;
    const jitter = 1 + (seed - 0.5) * 0.08;
    ownership *= jitter;

    ownership = Math.max(floor, Math.min(ceiling, ownership));
    result.set(playerId, Math.round(ownership * 10) / 10);
  }

  return result;
}

function getRosterSize(sport: string): number {
  const sizes: Record<string, number> = {
    NBA: 8, NHL: 8, NFL: 9, MLB: 10, GOLF: 6, SOCCER: 8,
  };
  return sizes[sport.toUpperCase()] || 8;
}

export interface OwnershipResult {
  playerId: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  projectedPoints: number;
  projectedOwnership: number;
  ownershipTier: "chalk" | "popular" | "mid" | "low" | "contrarian";
}

function assignTier(ownership: number): OwnershipResult["ownershipTier"] {
  if (ownership >= 25) return "chalk";
  if (ownership >= 15) return "popular";
  if (ownership >= 5) return "mid";
  if (ownership >= 2) return "low";
  return "contrarian";
}

export async function calculateOwnership(
  players: Player[],
  sport: string,
  contestType: ContestType = "gpp_large",
  bdlStats?: PlayerStatsMap
): Promise<OwnershipResult[]> {
  if (players.length === 0) return [];

  const config = getConfig(sport);
  const temperature = config.softmaxTemperature[contestType];

  let historyMap: Map<string, PlayerHistory[]> | undefined;
  try {
    const history = await storage.getPlayerHistoryBySport(sport, 1000);
    if (history.length > 0) {
      historyMap = new Map();
      for (const h of history) {
        const key = normalizeName(h.playerName);
        if (!historyMap.has(key)) historyMap.set(key, []);
        historyMap.get(key)!.push(h);
      }
    }
  } catch {
  }

  const popularityScores = computePopularityScores(players, sport, bdlStats, historyMap);
  const probabilities = softmaxTransform(popularityScores, temperature);
  const ownershipMap = normalizeOwnership(probabilities, sport, contestType, players.length);

  const scoreMap = new Map(popularityScores.map(s => [s.playerId, s]));

  return players.map(player => {
    const ownership = ownershipMap.get(player.id) || config.ownershipFloor;
    return {
      playerId: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      salary: player.salary,
      projectedPoints: Number(player.projectedPoints) || 0,
      projectedOwnership: ownership,
      ownershipTier: assignTier(ownership),
    };
  }).sort((a, b) => b.projectedOwnership - a.projectedOwnership);
}

export function computeOwnershipForPlayers(
  players: Player[],
  ownershipResults: OwnershipResult[]
): (Player & { ownershipProjection: number })[] {
  const ownershipMap = new Map(ownershipResults.map(r => [r.playerId, r.projectedOwnership]));
  return players.map(p => ({
    ...p,
    ownershipProjection: ownershipMap.get(p.id) || 0.5,
  }));
}

export function getOwnershipConfig(sport: string) {
  return getConfig(sport);
}

export function getSupportedSports(): string[] {
  return Object.keys(SPORT_CONFIGS);
}
