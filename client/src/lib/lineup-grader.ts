import { getPlatformConfig, type Platform, type Sport } from "@shared/platform-config";

interface GradePlayer {
  id: number;
  name: string;
  team: string;
  position: string;
  salary: number;
  projectedPoints: string | number;
  injuryStatus?: string | null;
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

const PROJECTION_THRESHOLDS: Record<string, { elite: number; great: number; good: number; avg: number }> = {
  NBA: { elite: 290, great: 270, good: 250, avg: 230 },
  NHL: { elite: 38, great: 34, good: 30, avg: 26 },
  MLB: { elite: 110, great: 95, good: 80, avg: 65 },
  NFL: { elite: 170, great: 155, good: 140, avg: 125 },
  GOLF: { elite: 90, great: 80, good: 70, avg: 60 },
  SOCCER: { elite: 55, great: 48, good: 40, avg: 32 },
};

function scoreProjection(totalProj: number, sport: string): number {
  const t = PROJECTION_THRESHOLDS[sport] || PROJECTION_THRESHOLDS.NBA;
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
): LineupGrade {
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
