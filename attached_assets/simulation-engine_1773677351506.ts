import type { Player } from "@shared/schema";
import type { VegasContext } from "./vegas-client";

const POSITION_CV: Record<string, Record<string, number>> = {
  NFL: {
    QB:  0.22,
    RB:  0.48,
    WR:  0.55,
    TE:  0.50,
    DST: 0.60,
    K:   0.35,
    DEF: 0.60,
  },
  NBA: {
    PG:  0.32,
    SG:  0.30,
    SF:  0.28,
    PF:  0.28,
    C:   0.32,
    G:   0.31,
    F:   0.28,
    UTIL:0.30,
  },
  MLB: {
    SP:  0.38,
    RP:  0.45,
    P:   0.38,
    C:   0.65,
    "1B":0.62,
    "2B":0.63,
    "3B":0.63,
    SS:  0.62,
    OF:  0.65,
  },
  NHL: {
    C:   0.62,
    W:   0.60,
    LW:  0.60,
    RW:  0.60,
    D:   0.55,
    G:   0.42,
    SKATER: 0.60,
  },
  GOLF: {
    G:   0.38,
  },
  SOCCER: {
    GK:  0.42,
    D:   0.50,
    M:   0.52,
    F:   0.58,
    OUTFIELD: 0.55,
  },
};

const GAME_VARIANCE: Record<string, number> = {
  NFL:    0.18,
  NBA:    0.10,
  MLB:    0.25,
  NHL:    0.22,
  GOLF:   0.20,
  SOCCER: 0.20,
};

const TEAM_VARIANCE: Record<string, number> = {
  NFL:    0.24,
  NBA:    0.14,
  MLB:    0.32,
  NHL:    0.26,
  GOLF:   0.00,
  SOCCER: 0.24,
};

const QB_CASCADE: Record<string, number> = {
  WR:  0.40,
  TE:  0.35,
  RB:  0.08,
};

const MIN_PROJ_FLOOR = 0.05;

export interface SimProjection {
  [playerId: number]: number;
}

export interface SimResult {
  simId:        number;
  projections:  SimProjection;
  gameFactors:  Record<string, number>;
  teamFactors:  Record<string, number>;
}

function sampleNormal(mean: number, stddev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const standard = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + standard * stddev;
}

function clampFactor(factor: number, min = 0.15, max = 2.5): number {
  return Math.max(min, Math.min(max, factor));
}

function extractTeams(gameInfo: string): { away: string; home: string; key: string } | null {
  if (!gameInfo) return null;
  const atMatch  = gameInfo.match(/^([A-Z0-9]+)\s*@\s*([A-Z0-9]+)/i);
  const vsMatch  = gameInfo.match(/^([A-Z0-9]+)\s*vs\.?\s*([A-Z0-9]+)/i);
  const match = atMatch || vsMatch;
  if (!match) return null;
  const away = match[1].toUpperCase().trim();
  const home = match[2].toUpperCase().trim();
  const key  = [away, home].sort().join("-");
  return { away, home, key };
}

function getPlayerCV(player: Player, sport: string): number {
  const pos = player.position?.split("/")[0]?.toUpperCase() || "UTIL";
  const sportCVs = POSITION_CV[sport.toUpperCase()] || POSITION_CV.NFL;
  return sportCVs[pos] ?? 0.35;
}

export function runSingleSim(
  players:        Player[],
  sport:          string,
  projOverrides?: Record<number, number>,
  vegasContext?:  VegasContext,
): SimResult {
  const sportUpper = sport.toUpperCase();
  const gameVar    = GAME_VARIANCE[sportUpper]   ?? 0.20;
  const teamVar    = TEAM_VARIANCE[sportUpper]   ?? 0.20;

  const gameGroups = new Map<string, Player[]>();
  const playerGame  = new Map<number, string>();
  const playerTeam  = new Map<number, string>();

  for (const p of players) {
    const teams = extractTeams(p.gameInfo || "");
    const team  = p.team?.toUpperCase() || "UNKNOWN";
    playerTeam.set(p.id, team);
    if (teams) {
      playerGame.set(p.id, teams.key);
      if (!gameGroups.has(teams.key)) gameGroups.set(teams.key, []);
      gameGroups.get(teams.key)!.push(p);
    }
  }

  // ── Game-level factors — variance scaled by Vegas total ───────────────────
  // High-total games (shootouts) have wider variance; low-total games tighter.
  // Scalar = total / slateAvgTotal, clamped to [0.55, 1.6].
  const gameFactors: Record<string, number> = {};
  for (const gameKey of gameGroups.keys()) {
    let adjustedGameVar = gameVar;
    if (vegasContext?.games.has(gameKey) && vegasContext.slateAvgTotal > 0) {
      const total       = vegasContext.games.get(gameKey)!.total;
      const totalScalar = Math.max(0.55, Math.min(1.60, total / vegasContext.slateAvgTotal));
      adjustedGameVar   = gameVar * totalScalar;
    }
    gameFactors[gameKey] = clampFactor(sampleNormal(1.0, adjustedGameVar));
  }

  // ── Team-level factors — baseline shifted by implied total ────────────────
  // A team with implied total 10% above slate average gets a +5% baseline
  // (50% dampened — DK projections already partially reflect Vegas).
  const teamSet = new Set<string>(playerTeam.values());
  const teamFactors: Record<string, number> = {};
  for (const team of teamSet) {
    let teamBaseline = 1.0;
    if (vegasContext?.teamImplied.has(team) && vegasContext.slateAvgImplied > 0) {
      const implied       = vegasContext.teamImplied.get(team)!;
      const impliedRatio  = implied / vegasContext.slateAvgImplied;
      // Dampen by 50%: market signal already partially reflected in projections
      const impliedShift  = (impliedRatio - 1.0) * 0.50;
      teamBaseline        = Math.max(0.70, Math.min(1.35, 1.0 + impliedShift));
    }
    teamFactors[team] = clampFactor(sampleNormal(teamBaseline, teamVar));
  }

  const passingGameMultiplier: Record<string, number> = {};
  if (sportUpper === "NFL") {
    const qbByTeam = new Map<string, Player>();
    for (const p of players) {
      if (p.position?.includes("QB")) {
        const team = playerTeam.get(p.id) || p.team || "";
        if (!qbByTeam.has(team)) qbByTeam.set(team, p);
      }
    }
    for (const [team, qb] of qbByTeam) {
      const baseProj = projOverrides?.[qb.id] ?? Number(qb.projectedPoints) ?? 0;
      if (baseProj === 0) continue;
      const gameKey  = playerGame.get(qb.id);
      const gameFact = gameKey ? (gameFactors[gameKey] ?? 1.0) : 1.0;
      const teamFact = teamFactors[team] ?? 1.0;
      const qbSimBase = baseProj * gameFact * teamFact;
      const qbRatio   = qbSimBase / baseProj;
      passingGameMultiplier[team] = qbRatio;
    }
  }

  const projections: SimProjection = {};
  for (const p of players) {
    const baseProj = projOverrides?.[p.id] ?? Number(p.projectedPoints) ?? 0;
    if (baseProj <= 0) { projections[p.id] = 0; continue; }

    const team    = playerTeam.get(p.id) || p.team || "UNKNOWN";
    const gameKey = playerGame.get(p.id);
    const gameFact = gameKey ? (gameFactors[gameKey] ?? 1.0) : 1.0;
    const teamFact = teamFactors[team] ?? 1.0;
    const cv          = getPlayerCV(p, sportUpper);
    const playerFact  = clampFactor(sampleNormal(1.0, cv), MIN_PROJ_FLOOR);

    let effProj = baseProj * gameFact * teamFact * playerFact;

    if (sportUpper === "NFL" && passingGameMultiplier[team] !== undefined) {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      const cascadeCoeff = QB_CASCADE[pos];
      if (cascadeCoeff) {
        const qbRatio = passingGameMultiplier[team];
        const deviation = qbRatio - 1.0;
        effProj = baseProj * gameFact * teamFact * playerFact
                * (1.0 + deviation * cascadeCoeff);
      }
    }

    if (sportUpper === "MLB") {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      const isHitter = !["SP","RP","P"].includes(pos);
      if (isHitter) {
        const batterTeamFact = clampFactor(sampleNormal(1.0, 0.20));
        effProj = effProj * batterTeamFact;
      }
    }

    if (sportUpper === "NHL") {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      if (["C","W","LW","RW"].includes(pos)) {
        const lineFact = clampFactor(sampleNormal(1.0, 0.18));
        effProj = effProj * lineFact;
      }
    }

    projections[p.id] = Math.max(baseProj * MIN_PROJ_FLOOR, effProj);
  }

  return { simId: 0, projections, gameFactors, teamFactors };
}

export function runSimulations(
  players:        Player[],
  sport:          string,
  numSims:        number,
  projOverrides?: Record<number, number>,
  vegasContext?:  VegasContext,
): SimResult[] {
  const results: SimResult[] = [];
  for (let i = 0; i < numSims; i++) {
    const sim = runSingleSim(players, sport, projOverrides, vegasContext);
    sim.simId = i;
    results.push(sim);
  }
  return results;
}

export interface ScoredLineup {
  playerIds:       number[];
  key:             string;
  avgSimScore:     number;
  p75Score:        number;
  p90Score:        number;
  frequency:       number;
  simScore:        number;
  stackedGame?:    string;
  stackCount:      number;
}

export function scoreLineupsAcrossSims(
  lineups:  Array<{ playerIds: number[]; key: string }>,
  sims:     SimResult[],
): ScoredLineup[] {
  return lineups.map(lineup => {
    const simScores = sims.map(sim =>
      lineup.playerIds.reduce((sum, id) => sum + (sim.projections[id] || 0), 0)
    ).sort((a, b) => a - b);

    const n       = simScores.length;
    const avg     = simScores.reduce((a, b) => a + b, 0) / n;
    const p75     = simScores[Math.floor(n * 0.75)] ?? avg;
    const p90     = simScores[Math.floor(n * 0.90)] ?? avg;
    const score = avg * 0.40 + p75 * 0.35 + p90 * 0.25;

    return {
      playerIds:  lineup.playerIds,
      key:        lineup.key,
      avgSimScore: Math.round(avg * 10) / 10,
      p75Score:    Math.round(p75 * 10) / 10,
      p90Score:    Math.round(p90 * 10) / 10,
      frequency:   0,
      simScore:    Math.round(score * 10) / 10,
      stackCount:  0,
    };
  });
}

export function detectStack(
  lineupPlayers: Player[],
): { game: string; count: number; teams: string[] } {
  const gameCounts = new Map<string, { count: number; teams: Set<string> }>();
  for (const p of lineupPlayers) {
    const teams = extractTeams(p.gameInfo || "");
    if (!teams) continue;
    const entry = gameCounts.get(teams.key) || { count: 0, teams: new Set() };
    entry.count++;
    entry.teams.add(p.team?.toUpperCase() || "");
    gameCounts.set(teams.key, entry);
  }
  let maxGame = "", maxCount = 0, maxTeams: string[] = [];
  for (const [game, { count, teams }] of gameCounts) {
    if (count > maxCount) { maxGame = game; maxCount = count; maxTeams = [...teams]; }
  }
  return { game: maxGame, count: maxCount, teams: maxTeams };
}
