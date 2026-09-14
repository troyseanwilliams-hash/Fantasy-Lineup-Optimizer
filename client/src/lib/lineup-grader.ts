import { getPlatformConfig, getShowdownConfig, type Platform, type Sport } from "@shared/platform-config";

export interface GradePlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  projectedPoints: string | number;
  injuryStatus?: string | null;
  slot?: string | null;
  isCaptain?: boolean;
  effectiveSalary?: number;
  effectiveProjection?: number;
}

export interface GradeBreakdown {
  label: string;
  score: number;
  maxScore: number;
}

export interface LineupGrade {
  grade: string;
  score: number;
  breakdown: GradeBreakdown[];
}

/**
 * The sixth argument of gradeLineup is intentionally optional so existing
 * Classic callers keep their historical grading behavior.  Showdown callers
 * should provide the slate/contest format explicitly rather than relying on
 * roster shape inference.
 */
export interface LineupGradeContext {
  contestFormat?: string;
  gameType?: string;
  captainId?: number;
}

const PROJECTION_THRESHOLDS: Record<string, { elite: number; great: number; good: number; avg: number }> = {
  NBA: { elite: 290, great: 270, good: 250, avg: 230 },
  NHL: { elite: 38, great: 34, good: 30, avg: 26 },
  MLB: { elite: 110, great: 95, good: 80, avg: 65 },
  NFL: { elite: 170, great: 155, good: 140, avg: 125 },
  GOLF: { elite: 90, great: 80, good: 70, avg: 60 },
  SOCCER: { elite: 55, great: 48, good: 40, avg: 32 },
};

// Showdown totals include one multiplier slot and a smaller roster. These
// thresholds are intentionally independent from the Classic slate thresholds.
const SHOWDOWN_PROJECTION_THRESHOLDS: Record<string, Partial<Record<Platform, { elite: number; great: number; good: number; avg: number }>>> = {
  NBA: {
    draftkings: { elite: 250, great: 230, good: 210, avg: 190 },
    fanduel: { elite: 235, great: 215, good: 195, avg: 175 },
  },
  NFL: {
    draftkings: { elite: 115, great: 105, good: 95, avg: 85 },
    fanduel: { elite: 110, great: 100, good: 90, avg: 80 },
  },
};

function scoreProjection(totalProj: number, sport: string): number {
  const t = PROJECTION_THRESHOLDS[sport] || PROJECTION_THRESHOLDS.NBA;
  if (totalProj >= t.elite) return 100;
  if (totalProj >= t.great) return 85 + 15 * ((totalProj - t.great) / (t.elite - t.great));
  if (totalProj >= t.good) return 65 + 20 * ((totalProj - t.good) / (t.great - t.good));
  if (totalProj >= t.avg) return 40 + 25 * ((totalProj - t.avg) / (t.good - t.avg));
  return Math.max(0, 40 * (totalProj / t.avg));
}

function scoreShowdownProjection(totalProj: number, sport: string, platform: Platform): number {
  const t = SHOWDOWN_PROJECTION_THRESHOLDS[sport]?.[platform];
  if (!t) {
    // Unsupported sports receive a neutral projection score rather than a
    // grade based on an invented cross-sport scale.
    return 60;
  }
  if (totalProj >= t.elite) return 100;
  if (totalProj >= t.great) return 85 + 15 * ((totalProj - t.great) / (t.elite - t.great));
  if (totalProj >= t.good) return 65 + 20 * ((totalProj - t.good) / (t.great - t.good));
  if (totalProj >= t.avg) return 40 + 25 * ((totalProj - t.avg) / (t.good - t.avg));
  return Math.max(0, 40 * (totalProj / t.avg));
}

function scoreSalaryEfficiency(totalSalary: number, salaryCap: number): number {
  const usage = totalSalary / salaryCap;
  if (usage >= 0.97) return 100;
  if (usage >= 0.94) return 85 + 15 * ((usage - 0.94) / 0.03);
  if (usage >= 0.90) return 60 + 25 * ((usage - 0.90) / 0.04);
  if (usage >= 0.85) return 35 + 25 * ((usage - 0.85) / 0.05);
  return Math.max(0, 35 * (usage / 0.85));
}

function scoreRosterConstruction(players: GradePlayer[], sport: string): number {
  let score = 50;

  const teamCounts = new Map<string, number>();
  players.forEach(p => teamCounts.set(p.team, (teamCounts.get(p.team) || 0) + 1));

  if (sport === "NFL") {
    const hasQB = players.some(p => p.position.includes("QB"));
    if (hasQB) {
      const qbTeam = players.find(p => p.position.includes("QB"))?.team;
      const qbTeammates = players.filter(p => p.team === qbTeam && !p.position.includes("QB"));
      const hasWR = qbTeammates.some(p => p.position.includes("WR"));
      const hasTE = qbTeammates.some(p => p.position.includes("TE"));
      if (hasWR) score += 25;
      if (hasTE) score += 10;
      if (qbTeammates.length >= 2) score += 10;
    }
    const hasBringBack = Array.from(teamCounts.entries()).some(([team, count]) => {
      const qbTeam = players.find(p => p.position.includes("QB"))?.team;
      return team !== qbTeam && count >= 1 && players.some(p => p.team === team && (p.position.includes("WR") || p.position.includes("TE")));
    });
    if (hasBringBack) score += 5;
  } else if (sport === "MLB") {
    const maxStack = Math.max(...Array.from(teamCounts.values()));
    if (maxStack >= 4) score += 35;
    else if (maxStack >= 3) score += 20;
    else if (maxStack >= 2) score += 10;
    const secondStack = Array.from(teamCounts.values()).sort((a, b) => b - a)[1] || 0;
    if (secondStack >= 2) score += 15;
  } else if (sport === "NBA" || sport === "NHL") {
    const gameTeams = new Map<string, Set<string>>();
    players.forEach(p => {
      if (!gameTeams.has(p.team)) gameTeams.set(p.team, new Set());
    });
    let hasGameStack = false;
    for (const [team, count] of teamCounts) {
      if (count >= 2) {
        hasGameStack = true;
        score += 15;
        break;
      }
    }
    if (!hasGameStack) score += 5;
    const uniqueTeams = teamCounts.size;
    if (uniqueTeams >= 4) score += 10;
    if (uniqueTeams >= 6) score += 10;
  } else if (sport === "SOCCER") {
    const maxStack = Math.max(...Array.from(teamCounts.values()));
    if (maxStack >= 3) score += 25;
    else if (maxStack >= 2) score += 15;
    const uniqueTeams = teamCounts.size;
    if (uniqueTeams >= 3) score += 10;
  } else if (sport === "GOLF") {
    score += 30;
  }

  return Math.min(100, score);
}

function scoreCeilingPotential(players: GradePlayer[]): number {
  const valueScores = players.map(p => {
    const proj = Number(p.projectedPoints);
    const salary = p.salary;
    if (salary <= 0) return 0;
    return proj / (salary / 1000);
  });

  const avgValue = valueScores.reduce((a, b) => a + b, 0) / valueScores.length;
  const highValueCount = valueScores.filter(v => v >= 6).length;
  const superValueCount = valueScores.filter(v => v >= 8).length;

  let score = Math.min(50, avgValue * 10);
  score += highValueCount * 8;
  score += superValueCount * 5;

  const topProj = Math.max(...players.map(p => Number(p.projectedPoints)));
  if (topProj >= 50) score += 10;
  else if (topProj >= 40) score += 5;

  return Math.min(100, score);
}

function scorePlayerStatus(players: GradePlayer[]): number {
  let penalty = 0;
  players.forEach(p => {
    const status = p.injuryStatus;
    if (!status || status === "Healthy") return;
    if (status === "OUT") penalty += 30;
    else if (status === "Doubtful") penalty += 20;
    else if (status === "Questionable") penalty += 15;
    else if (status === "Probable" || status === "Day-to-Day") penalty += 5;
  });
  return Math.max(0, 100 - penalty);
}

function scoreToGrade(score: number): string {
  if (score >= 92) return "S";
  if (score >= 84) return "A+";
  if (score >= 76) return "A";
  if (score >= 68) return "B+";
  if (score >= 58) return "B";
  if (score >= 45) return "C";
  if (score >= 30) return "D";
  return "F";
}

function isShowdownContext(context?: LineupGradeContext | string): boolean {
  const format = typeof context === "string"
    ? context
    : context?.contestFormat ?? context?.gameType;
  return String(format || "").trim().toLowerCase() === "showdown";
}

function isCaptainPlayer(player: GradePlayer): boolean {
  const slot = String(player.slot || "").trim().toUpperCase();
  return player.isCaptain === true || slot === "CPT" || slot === "MVP" || slot === "CAPTAIN";
}

function gameIdentity(player: GradePlayer): string | null {
  const gameInfo = String((player as any).gameInfo || "").trim().toUpperCase();
  if (gameInfo) return gameInfo;
  const opponent = String((player as any).opponent || "").trim().toUpperCase();
  const team = String(player.team || "").trim().toUpperCase();
  if (!team || !opponent) return null;
  return [team, opponent].sort().join("-");
}

function scoreShowdownConstruction(players: GradePlayer[], sport: string): number {
  const knownGames = players.map(gameIdentity).filter((key): key is string => !!key);
  // There is no slate simulation/optimal lineup feed in the saved lineup
  // record.  Known game metadata is therefore the defensible deterministic
  // single-game signal; unknown metadata is neutral, not fabricated.
  let score = knownGames.length === 0
    ? 60
    : new Set(knownGames).size === 1
      ? 82
      : 30;

  const positions = players.map(p => String(p.position || "").toUpperCase());
  if (sport === "NFL") {
    const qb = players.find(p => positions[players.indexOf(p)].includes("QB"));
    if (qb) {
      const qbTeam = qb.team;
      if (players.some(p => p.team === qbTeam && /WR|TE/.test(String(p.position).toUpperCase()))) score += 10;
      if (players.some(p => p.team !== qbTeam && /WR|TE|RB/.test(String(p.position).toUpperCase()))) score += 5;
    }
  } else if (sport === "MLB") {
    if (positions.some(position => /^(P|SP|RP)$/.test(position))) score += 8;
    if (positions.some(position => /C|1B|2B|3B|SS|OF/.test(position))) score += 5;
  } else if (sport === "NBA" || sport === "NHL") {
    // A game can legitimately contain any number of players from either
    // team, so no unique-team count assumption is made here.
    if (knownGames.length === players.length) score += 5;
  } else if (sport === "SOCCER") {
    if (positions.some(position => position.includes("GK")) &&
        positions.some(position => /F|M|MF|D/.test(position))) score += 8;
  }
  return Math.max(0, Math.min(100, score));
}

function showdownGrade(
  players: GradePlayer[],
  sport: string,
  platform: string,
  context?: LineupGradeContext | string,
): LineupGrade {
  const normalizedPlatform = (platform || "draftkings").toLowerCase() as Platform;
  const config = getShowdownConfig(sport, normalizedPlatform);
  const expectedRosterSize = config?.rosterSize ?? (normalizedPlatform === "fanduel" ? 5 : 6);
  const contextCaptainId = typeof context === "object" ? context.captainId : undefined;
  const ids = players.map(player => Number(player.id));
  const markedCaptains = players.filter(isCaptainPlayer);
  const captainByContext = contextCaptainId === undefined
    ? []
    : players.filter(player => Number(player.id) === Number(contextCaptainId));
  const captain = markedCaptains.length === 1
    ? markedCaptains[0]
    : markedCaptains.length === 0 && captainByContext.length === 1
      ? captainByContext[0]
      : null;
  const flexPlayers = captain ? players.filter(player => player !== captain) : [];
  const expectedSlots = config?.slots.map(slot => slot.key.toUpperCase()) ??
    (normalizedPlatform === "fanduel"
      ? ["MVP", "FLEX1", "FLEX2", "FLEX3", "FLEX4"]
      : ["CPT", "FLEX1", "FLEX2", "FLEX3", "FLEX4", "FLEX5"]);
  const actualSlots = players.map(player => String(player.slot || "").trim().toUpperCase());
  const hasValidSlots =
    actualSlots.every(slot => expectedSlots.includes(slot)) &&
    new Set(actualSlots).size === expectedSlots.length &&
    expectedSlots.every(slot => actualSlots.includes(slot));
  const captainSlot = captain ? String(captain.slot || "").trim().toUpperCase() : "";
  const expectedCaptainSlot = config?.captainLabel.toUpperCase() ??
    (normalizedPlatform === "fanduel" ? "MVP" : "CPT");
  const captainSlotValid = !!captain && captainSlot === expectedCaptainSlot;
  const validShape =
    players.length === expectedRosterSize &&
    ids.every(id => Number.isInteger(id) && id > 0) &&
    new Set(ids).size === expectedRosterSize &&
    markedCaptains.length <= 1 &&
    !!captain &&
    flexPlayers.length === expectedRosterSize - 1 &&
    hasValidSlots &&
    captainSlotValid &&
    (!contextCaptainId || Number(captain.id) === Number(contextCaptainId));

  if (!validShape || !captain) {
    return {
      grade: "F",
      score: 0,
      breakdown: [
        { label: "Roster Validity", score: 0, maxScore: 100 },
        { label: "Captain Quality", score: 0, maxScore: 100 },
        { label: "Single-Game Build", score: 0, maxScore: 100 },
        { label: "Salary Efficiency", score: 0, maxScore: 100 },
        { label: "Player Health", score: 0, maxScore: 100 },
      ],
    };
  }

  const platformConfig = getPlatformConfig(sport as Sport, normalizedPlatform);
  const captainSalaryMultiplier = config?.captainSalaryMultiplier ?? (normalizedPlatform === "draftkings" ? 1.5 : 1);
  const captainProjectionMultiplier = config?.captainMultiplier ?? (normalizedPlatform === "fanduel" ? 2 : normalizedPlatform === "draftkings" ? 1.5 : 1);
  const effectiveSalary = (player: GradePlayer, isCaptain: boolean) =>
    (isCaptain
      ? Number(player.salary) * captainSalaryMultiplier
      : Number(player.salary));
  const effectiveProjection = (player: GradePlayer, isCaptain: boolean) =>
    isCaptain
      ? Number(player.projectedPoints) * captainProjectionMultiplier
      : Number(player.projectedPoints);
  const captainProj = Math.max(0, effectiveProjection(captain, true) || 0);
  const flexProjs = flexPlayers.map(player => Math.max(0, Number(effectiveProjection(player, false)) || 0));
  const totalProjection = captainProj + flexProjs.reduce((sum, value) => sum + value, 0);
  const projectionScore = scoreShowdownProjection(totalProjection, sport, normalizedPlatform);

  // Compare captain candidates on their base projection and value. The
  // multiplier applies equally to every possible captain and must not make
  // the selected captain look better merely because it occupies the CPT slot.
  const baseProjection = (player: GradePlayer) => Math.max(0, Number(player.projectedPoints) || 0);
  const baseValue = (player: GradePlayer) =>
    baseProjection(player) / Math.max(Number(player.salary) / 1000, 0.001);
  const maxBaseProjection = Math.max(...players.map(baseProjection), 1);
  const maxBaseValue = Math.max(...players.map(baseValue), 0.001);
  const captainQuality = Math.min(100, (
    (baseProjection(captain) / maxBaseProjection) * 70 +
    (baseValue(captain) / maxBaseValue) * 30
  ));
  const effectiveTotalSalary = effectiveSalary(captain, true) +
    flexPlayers.reduce((sum, player) => sum + effectiveSalary(player, false), 0);
  // Salary is a small component in Showdown grading.  This rewards sensible
  // cap use without treating unused salary as a proxy for lineup quality.
  const salaryScore = Math.min(100, Math.max(0, 55 + (effectiveTotalSalary / platformConfig.salaryCap - 0.85) * 180));
  const healthScore = scorePlayerStatus(players);
  const constructionScore = scoreShowdownConstruction(players, sport);
  const weightedScore =
    projectionScore * 0.50 +
    captainQuality * 0.20 +
    constructionScore * 0.15 +
    salaryScore * 0.05 +
    healthScore * 0.10;

  return {
    grade: scoreToGrade(weightedScore),
    score: Math.round(weightedScore),
    breakdown: [
      { label: "Projected Score", score: Math.round(projectionScore), maxScore: 100 },
      { label: "Captain Quality", score: Math.round(captainQuality), maxScore: 100 },
      { label: "Single-Game Build", score: Math.round(constructionScore), maxScore: 100 },
      { label: "Salary Efficiency", score: Math.round(salaryScore), maxScore: 100 },
      { label: "Player Health", score: Math.round(healthScore), maxScore: 100 },
    ],
  };
}

export const GRADE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  S: { text: "text-yellow-300", bg: "bg-yellow-500/15", border: "border-yellow-500/30" },
  "A+": { text: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  A: { text: "text-green-400", bg: "bg-green-500/15", border: "border-green-500/30" },
  "B+": { text: "text-cyan-400", bg: "bg-cyan-500/15", border: "border-cyan-500/30" },
  B: { text: "text-blue-400", bg: "bg-blue-500/15", border: "border-blue-500/30" },
  C: { text: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30" },
  D: { text: "text-orange-400", bg: "bg-orange-500/15", border: "border-orange-500/30" },
  F: { text: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30" },
};

export function gradeLineup(
  players: GradePlayer[],
  sport: string,
  platform: string,
  totalSalary: number,
  totalProjectedPoints: number | string,
  context?: LineupGradeContext | string,
): LineupGrade {
  if (isShowdownContext(context)) {
    return showdownGrade(players, sport, platform, context);
  }

  const config = getPlatformConfig(sport as Sport, (platform || "draftkings") as Platform);
  const totalProj = Number(totalProjectedPoints);

  const projScore = scoreProjection(totalProj, sport);
  const salaryScore = scoreSalaryEfficiency(totalSalary, config.salaryCap);
  const rosterScore = scoreRosterConstruction(players, sport);
  const ceilingScore = scoreCeilingPotential(players);
  const statusScore = scorePlayerStatus(players);

  const weightedScore =
    projScore * 0.35 +
    salaryScore * 0.20 +
    rosterScore * 0.20 +
    ceilingScore * 0.15 +
    statusScore * 0.10;

  const breakdown: GradeBreakdown[] = [
    { label: "Projected Score", score: Math.round(projScore), maxScore: 100 },
    { label: "Salary Efficiency", score: Math.round(salaryScore), maxScore: 100 },
    { label: "Roster Build", score: Math.round(rosterScore), maxScore: 100 },
    { label: "Ceiling Potential", score: Math.round(ceilingScore), maxScore: 100 },
    { label: "Player Health", score: Math.round(statusScore), maxScore: 100 },
  ];

  return {
    grade: scoreToGrade(weightedScore),
    score: Math.round(weightedScore),
    breakdown,
  };
}
