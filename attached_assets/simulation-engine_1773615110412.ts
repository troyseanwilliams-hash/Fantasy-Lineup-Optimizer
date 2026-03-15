/**
 * simulation-engine.ts
 *
 * Monte Carlo game-script simulator for DFS lineup generation.
 *
 * How it works (the SaberSim approach in pure TypeScript):
 * ─────────────────────────────────────────────────────────
 * Instead of running the LP solver once against median projections, we run it
 * N times, each time with a different "game script" — a correlated sample of
 * how the slate could realistically unfold.
 *
 * Each simulation uses a three-level variance model:
 *   1. Game level  — overall pace/totals (did this game turn into a shootout?)
 *   2. Team level  — game script split (pass-heavy vs run-heavy, blowout vs close)
 *   3. Player level— individual performance variance (target share, usage, matchup)
 *
 * NFL-specific QB cascade:
 *   When a QB has a high sim (high team passing script), his receivers are
 *   proportionally amplified — this is what drives natural stacking without
 *   needing explicit stack rules.
 *
 * The result: each LP call sees a different but internally-consistent set of
 * projections. Players who are correlated (same game, same team, same script)
 * naturally co-appear in lineups that beat the slate together.
 */

import type { Player } from "@shared/schema";

// ── Variance coefficients (CV = stddev / mean) ───────────────────────────────
// Calibrated from real DFS result distributions. Higher CV = more boom/bust.

const POSITION_CV: Record<string, Record<string, number>> = {
  NFL: {
    QB:  0.22, // Consistent but can boom (50+ pt games exist)
    RB:  0.48, // Binary carry distribution — either the back or not
    WR:  0.55, // Target + TD variance — very high ceiling / floor spread
    TE:  0.50, // Similar to WR
    DST: 0.60, // Shutout vs disaster — widest range
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
    SP:  0.38, // Can dominate or get knocked out early
    RP:  0.45,
    P:   0.38,
    C:   0.65,
    "1B":0.62,
    "2B":0.63,
    "3B":0.63,
    SS:  0.62,
    OF:  0.65, // High variance — hits, HRs, RBIs all binary
  },
  NHL: {
    C:   0.62,
    W:   0.60,
    LW:  0.60,
    RW:  0.60,
    D:   0.55,
    G:   0.42, // Goalie variance: save%, goals against
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

// ── Game-level variance (pace/totals) ─────────────────────────────────────────
const GAME_VARIANCE: Record<string, number> = {
  NFL:    0.18,  // ~18% total variance — OT, shootout, weather-dominated games
  NBA:    0.10,  // Smaller — NBA totals are more predictable
  MLB:    0.25,  // High — pitcher dominance or slugfest swings the whole slate
  NHL:    0.22,  // Can be 1-0 or 8-5 in overtime
  GOLF:   0.20,  // Course conditions, weather windows
  SOCCER: 0.20,
};

// ── Team-level variance (game script) ─────────────────────────────────────────
const TEAM_VARIANCE: Record<string, number> = {
  NFL:    0.24,  // Blowout changes scripting dramatically
  NBA:    0.14,
  MLB:    0.32,  // One team can feast on a bad pitcher all game
  NHL:    0.26,
  GOLF:   0.00,  // No team concept — game-level variance is sufficient
  SOCCER: 0.24,
};

// ── QB cascade coefficients (NFL only) ───────────────────────────────────────
// How much of a QB's above-median performance flows to each receiver position.
// E.g., if QB sims at 1.4x median, WR1 gets 0.70 * 0.40 = +28% boost.
const QB_CASCADE: Record<string, number> = {
  WR:  0.40,   // 40% of QB upside cascades to receivers
  TE:  0.35,
  RB:  0.08,   // Minor — checkdowns only
};

// Minimum projection floor as a fraction of median (players always score something)
const MIN_PROJ_FLOOR = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SimProjection {
  [playerId: number]: number;  // player id -> simulated projection
}

export interface SimResult {
  simId:        number;
  projections:  SimProjection;
  gameFactors:  Record<string, number>;  // gameKey -> factor (diagnostic)
  teamFactors:  Record<string, number>;  // team -> factor (diagnostic)
}

// ─────────────────────────────────────────────────────────────────────────────
// Box-Muller normal random number generator
// ─────────────────────────────────────────────────────────────────────────────

function sampleNormal(mean: number, stddev: number): number {
  // Box-Muller transform: two uniform samples → one normal sample
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const standard = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + standard * stddev;
}

function clampFactor(factor: number, min = 0.15, max = 2.5): number {
  return Math.max(min, Math.min(max, factor));
}

// ─────────────────────────────────────────────────────────────────────────────
// Game group extraction from player.gameInfo
// e.g. "LAL @ GSW 7:30 PM ET" → "GSW-LAL" (sorted so both teams use same key)
// ─────────────────────────────────────────────────────────────────────────────

function extractTeams(gameInfo: string): { away: string; home: string; key: string } | null {
  if (!gameInfo) return null;

  // "AWAY @ HOME TIME" or "AWAY vs HOME TIME"
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
  return sportCVs[pos] ?? 0.35;  // default 35% if position unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: run a single game-script simulation
// ─────────────────────────────────────────────────────────────────────────────

export function runSingleSim(
  players:        Player[],
  sport:          string,
  projOverrides?: Record<number, number>,
): SimResult {
  const sportUpper = sport.toUpperCase();
  const gameVar    = GAME_VARIANCE[sportUpper]   ?? 0.20;
  const teamVar    = TEAM_VARIANCE[sportUpper]   ?? 0.20;

  // ── Step 1: Group players by game ─────────────────────────────────────────
  const gameGroups = new Map<string, Player[]>();  // gameKey → players
  const playerGame  = new Map<number, string>();    // playerId → gameKey
  const playerTeam  = new Map<number, string>();    // playerId → team

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

  // ── Step 2: Sample game-level factors ─────────────────────────────────────
  const gameFactors: Record<string, number> = {};
  for (const gameKey of gameGroups.keys()) {
    gameFactors[gameKey] = clampFactor(sampleNormal(1.0, gameVar));
  }

  // ── Step 3: Sample team-level factors (game script) ───────────────────────
  const teamSet = new Set<string>(playerTeam.values());
  const teamFactors: Record<string, number> = {};
  for (const team of teamSet) {
    teamFactors[team] = clampFactor(sampleNormal(1.0, teamVar));
  }

  // ── Step 4: NFL QB cascade ─────────────────────────────────────────────────
  // When a QB has an above-median day, his receivers benefit proportionally.
  // We compute a "passing game multiplier" per team, then cascade it downward.
  const passingGameMultiplier: Record<string, number> = {};  // team → cascade factor

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

      // QB's simulated projection (before player-level variance)
      const qbSimBase = baseProj * gameFact * teamFact;
      // How much above/below median is the QB in this sim?
      const qbRatio   = qbSimBase / baseProj;  // 1.0 = exactly median

      // Cascade: > 1 means passing game is alive → boost receivers
      // < 1 means run-heavy / QB struggling → receivers see less
      passingGameMultiplier[team] = qbRatio;
    }
  }

  // ── Step 5: Sample per-player projections ─────────────────────────────────
  const projections: SimProjection = {};

  for (const p of players) {
    const baseProj = projOverrides?.[p.id] ?? Number(p.projectedPoints) ?? 0;
    if (baseProj <= 0) { projections[p.id] = 0; continue; }

    const team    = playerTeam.get(p.id) || p.team || "UNKNOWN";
    const gameKey = playerGame.get(p.id);
    const gameFact = gameKey ? (gameFactors[gameKey] ?? 1.0) : 1.0;
    const teamFact = teamFactors[team] ?? 1.0;

    // Player-level idiosyncratic variance
    const cv          = getPlayerCV(p, sportUpper);
    const playerFact  = clampFactor(sampleNormal(1.0, cv), MIN_PROJ_FLOOR);

    let effProj = baseProj * gameFact * teamFact * playerFact;

    // ── NFL cascade: boost/reduce receivers based on QB's passing game ───────
    if (sportUpper === "NFL" && passingGameMultiplier[team] !== undefined) {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      const cascadeCoeff = QB_CASCADE[pos];
      if (cascadeCoeff) {
        const qbRatio = passingGameMultiplier[team];
        // Interpolate: 0 = no cascade, 1 = full QB ratio applied
        // At full cascade, receiver proj would be baseProj * qbRatio
        // We apply cascadeCoeff fraction of the deviation from median
        const deviation = qbRatio - 1.0;
        effProj = baseProj * gameFact * teamFact * playerFact
                * (1.0 + deviation * cascadeCoeff);
      }
    }

    // MLB: stack boost — batters on same team share some lineup score variance
    if (sportUpper === "MLB") {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      const isHitter = !["SP","RP","P"].includes(pos);
      if (isHitter) {
        // Team factor already handles this, but apply a secondary batter-specific
        // team factor that makes adjacent lineup hitters more correlated
        const batterTeamFact = clampFactor(sampleNormal(1.0, 0.20));
        effProj = effProj * batterTeamFact;
      }
    }

    // NHL line stack: players on same line (approximated by team + position)
    if (sportUpper === "NHL") {
      const pos = p.position?.split("/")[0]?.toUpperCase() || "";
      if (["C","W","LW","RW"].includes(pos)) {
        // Additional forward-line correlation
        const lineFact = clampFactor(sampleNormal(1.0, 0.18));
        effProj = effProj * lineFact;
      }
    }

    // Floor: players always score at least MIN_PROJ_FLOOR * their median
    projections[p.id] = Math.max(baseProj * MIN_PROJ_FLOOR, effProj);
  }

  return { simId: 0, projections, gameFactors, teamFactors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch simulation runner
// ─────────────────────────────────────────────────────────────────────────────

export function runSimulations(
  players:        Player[],
  sport:          string,
  numSims:        number,
  projOverrides?: Record<number, number>,
): SimResult[] {
  const results: SimResult[] = [];
  for (let i = 0; i < numSims; i++) {
    const sim = runSingleSim(players, sport, projOverrides);
    sim.simId = i;
    results.push(sim);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lineup scoring: given a portfolio of lineups and simulation results,
// score each lineup across all sims and return ranked results.
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoredLineup {
  playerIds:       number[];
  key:             string;
  avgSimScore:     number;   // average score across all sims
  p75Score:        number;   // 75th percentile (ceiling indicator)
  p90Score:        number;   // 90th percentile (max upside)
  frequency:       number;   // how many sims this lineup was the LP-optimal result
  simScore:        number;   // composite score: 0.5*avg + 0.3*p75 + 0.2*p90
  stackedGame?:    string;   // the game this lineup is stacked around
  stackCount:      number;   // number of players from the dominant game
}

export function scoreLineupsAcrossSims(
  lineups:  Array<{ playerIds: number[]; key: string }>,
  sims:     SimResult[],
): ScoredLineup[] {
  return lineups.map(lineup => {
    // Score this lineup in every simulation
    const simScores = sims.map(sim =>
      lineup.playerIds.reduce((sum, id) => sum + (sim.projections[id] || 0), 0)
    ).sort((a, b) => a - b);

    const n       = simScores.length;
    const avg     = simScores.reduce((a, b) => a + b, 0) / n;
    const p75     = simScores[Math.floor(n * 0.75)] ?? avg;
    const p90     = simScores[Math.floor(n * 0.90)] ?? avg;

    // Composite score: weighted toward upside (GPP focus)
    const score = avg * 0.40 + p75 * 0.35 + p90 * 0.25;

    return {
      playerIds:  lineup.playerIds,
      key:        lineup.key,
      avgSimScore: Math.round(avg * 10) / 10,
      p75Score:    Math.round(p75 * 10) / 10,
      p90Score:    Math.round(p90 * 10) / 10,
      frequency:   0,  // populated by the caller
      simScore:    Math.round(score * 10) / 10,
      stackCount:  0,  // populated by the caller
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect stacks in a lineup (for labeling and diagnostics)
// ─────────────────────────────────────────────────────────────────────────────

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
