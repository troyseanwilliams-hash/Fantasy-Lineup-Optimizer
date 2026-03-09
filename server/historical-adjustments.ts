import { storage } from "./storage";
import type { Player } from "@shared/schema";

interface SalaryRangeProfile {
  range: string;
  minSalary: number;
  maxSalary: number;
  avgActual: number;
  avgValue: number;
  count: number;
  multiplier: number;
}

interface PositionProfile {
  position: string;
  avgActual: number;
  avgProjected: number;
  accuracyRatio: number;
  frequency: number;
  multiplier: number;
}

interface HistoricalProfile {
  sport: string;
  slatesAnalyzed: number;
  salaryProfiles: SalaryRangeProfile[];
  positionProfiles: PositionProfile[];
  avgProjectionAccuracy: number;
  optimalSalaryUtilization: number;
  topPlayerNames: Set<string>;
  ready: boolean;
}

const MIN_SLATES_REQUIRED = 10;
const MAX_ADJUSTMENT = 0.12;
const profileCache = new Map<string, { profile: HistoricalProfile; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

const SALARY_RANGES = [
  { range: "budget", min: 0, max: 4000 },
  { range: "value", min: 4000, max: 6000 },
  { range: "mid", min: 6000, max: 8000 },
  { range: "premium", min: 8000, max: 10000 },
  { range: "elite", min: 10000, max: 99999 },
];

export async function getHistoricalProfile(sport: string): Promise<HistoricalProfile> {
  const cached = profileCache.get(sport);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  const lineups = await storage.getWinningLineups(sport, 90);

  if (lineups.length < MIN_SLATES_REQUIRED) {
    const emptyProfile: HistoricalProfile = {
      sport,
      slatesAnalyzed: lineups.length,
      salaryProfiles: [],
      positionProfiles: [],
      avgProjectionAccuracy: 1.0,
      optimalSalaryUtilization: 100,
      topPlayerNames: new Set(),
      ready: false,
    };
    return emptyProfile;
  }

  const allPlayerData = lineups.flatMap(l => (l.playerData as any[]) || []);
  const allInsights = lineups.map(l => l.insights as any).filter(Boolean);

  const salaryBuckets: Record<string, { totalActual: number; totalValue: number; count: number }> = {};
  for (const r of SALARY_RANGES) {
    salaryBuckets[r.range] = { totalActual: 0, totalValue: 0, count: 0 };
  }

  for (const p of allPlayerData) {
    const salary = Number(p.salary) || 0;
    const actual = Number(p.actualPoints) || 0;
    const value = Number(p.value) || 0;
    for (const r of SALARY_RANGES) {
      if (salary >= r.min && salary < r.max) {
        salaryBuckets[r.range].totalActual += actual;
        salaryBuckets[r.range].totalValue += value;
        salaryBuckets[r.range].count++;
        break;
      }
    }
  }

  const overallAvgValue = allPlayerData.length > 0
    ? allPlayerData.reduce((s: number, p: any) => s + (Number(p.value) || 0), 0) / allPlayerData.length
    : 1;

  const salaryProfiles: SalaryRangeProfile[] = SALARY_RANGES.map(r => {
    const bucket = salaryBuckets[r.range];
    if (bucket.count === 0) {
      return { range: r.range, minSalary: r.min, maxSalary: r.max, avgActual: 0, avgValue: 0, count: 0, multiplier: 1.0 };
    }
    const avgActual = bucket.totalActual / bucket.count;
    const avgValue = bucket.totalValue / bucket.count;
    const rawMultiplier = overallAvgValue > 0 ? avgValue / overallAvgValue : 1;
    const multiplier = Math.max(1 - MAX_ADJUSTMENT, Math.min(1 + MAX_ADJUSTMENT, rawMultiplier));
    return { range: r.range, minSalary: r.min, maxSalary: r.max, avgActual, avgValue, count: bucket.count, multiplier };
  });

  const positionBuckets: Record<string, { totalActual: number; totalProjected: number; count: number; appearances: number }> = {};
  for (const p of allPlayerData) {
    const pos = (p.position || "").split("/")[0];
    if (!pos) continue;
    if (!positionBuckets[pos]) {
      positionBuckets[pos] = { totalActual: 0, totalProjected: 0, count: 0, appearances: 0 };
    }
    positionBuckets[pos].totalActual += Number(p.actualPoints) || 0;
    positionBuckets[pos].totalProjected += Number(p.projectedPoints) || 0;
    positionBuckets[pos].count++;
    positionBuckets[pos].appearances++;
  }

  const totalAppearances = allPlayerData.length || 1;
  const positionProfiles: PositionProfile[] = Object.entries(positionBuckets).map(([pos, data]) => {
    const avgActual = data.totalActual / data.count;
    const avgProjected = data.totalProjected / data.count;
    const accuracyRatio = avgProjected > 0 ? avgActual / avgProjected : 1;
    const frequency = data.appearances / totalAppearances;
    const clampedRatio = Math.max(1 - MAX_ADJUSTMENT, Math.min(1 + MAX_ADJUSTMENT, accuracyRatio));
    return { position: pos, avgActual, avgProjected, accuracyRatio, frequency, multiplier: clampedRatio };
  });

  const avgProjectionAccuracy = allInsights.length > 0
    ? allInsights.reduce((s: number, i: any) => s + (i.avgProjectionRatio || 1), 0) / allInsights.length
    : 1;

  const optimalSalaryUtilization = allInsights.length > 0
    ? allInsights.reduce((s: number, i: any) => s + (i.salaryUtilization || 100), 0) / allInsights.length
    : 100;

  const playerFrequency: Record<string, number> = {};
  for (const p of allPlayerData) {
    const name = (p.name || "").toLowerCase();
    playerFrequency[name] = (playerFrequency[name] || 0) + 1;
  }
  const minAppearancesForTop = Math.max(2, Math.floor(lineups.length * 0.15));
  const topPlayerNames = new Set(
    Object.entries(playerFrequency)
      .filter(([, count]) => count >= minAppearancesForTop)
      .map(([name]) => name)
  );

  const profile: HistoricalProfile = {
    sport,
    slatesAnalyzed: lineups.length,
    salaryProfiles,
    positionProfiles,
    avgProjectionAccuracy,
    optimalSalaryUtilization,
    topPlayerNames,
    ready: true,
  };

  profileCache.set(sport, { profile, cachedAt: Date.now() });
  return profile;
}

export function applyHistoricalAdjustments(
  players: Player[],
  profile: HistoricalProfile
): Player[] {
  if (!profile.ready) return players;

  const posMap = new Map(profile.positionProfiles.map(p => [p.position, p]));
  const salaryMap = profile.salaryProfiles;

  return players.map(p => {
    let pts = Number(p.projectedPoints);
    if (pts <= 0) return p;

    let adjustment = 1.0;

    const primaryPos = p.position.split("/")[0];
    const posProfile = posMap.get(primaryPos);
    if (posProfile) {
      const posWeight = 0.6;
      adjustment *= 1 + (posProfile.multiplier - 1) * posWeight;
    }

    const salaryProfile = salaryMap.find(r => p.salary >= r.minSalary && p.salary < r.maxSalary);
    if (salaryProfile && salaryProfile.count > 0) {
      const salaryWeight = 0.4;
      adjustment *= 1 + (salaryProfile.multiplier - 1) * salaryWeight;
    }

    adjustment = Math.max(1 - MAX_ADJUSTMENT, Math.min(1 + MAX_ADJUSTMENT, adjustment));

    const adjusted = Math.round(pts * adjustment * 100) / 100;
    return { ...p, projectedPoints: adjusted.toString() };
  });
}

export function clearProfileCache(sport?: string) {
  if (sport) {
    profileCache.delete(sport);
  } else {
    profileCache.clear();
  }
}
