import solver from "javascript-lp-solver";
import { storage } from "./storage";
import { fetchActualPointsForDate } from "./actual-points";
import { getPlatformConfig, assignPlayersToSlots } from "@shared/platform-config";
import { clearProfileCache } from "./historical-adjustments";
import type { Player, InsertWinningLineup } from "@shared/schema";

function buildPositionVariables(position: string, sport: string): Record<string, number> {
  const vars: Record<string, number> = {};
  const positions = position.split("/");

  switch (sport) {
    case "NBA":
      if (positions.includes("PG")) { vars.PG = 1; vars.G = 1; }
      if (positions.includes("SG")) { vars.SG = 1; vars.G = 1; }
      if (positions.includes("SF")) { vars.SF = 1; vars.F = 1; }
      if (positions.includes("PF")) { vars.PF = 1; vars.F = 1; }
      if (positions.includes("C")) { vars.C = 1; }
      break;

    case "NHL":
      if (positions.includes("C")) { vars.C = 1; vars.SKATER = 1; }
      if (positions.includes("W") || positions.includes("LW") || positions.includes("RW")) { vars.W = 1; vars.SKATER = 1; }
      if (positions.includes("D")) { vars.D = 1; vars.SKATER = 1; }
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "MLB":
      if (positions.includes("P") || positions.includes("SP") || positions.includes("RP")) { vars.P = 1; }
      if (positions.includes("C")) { vars.C = 1; }
      if (positions.includes("1B")) { vars["1B"] = 1; }
      if (positions.includes("2B")) { vars["2B"] = 1; }
      if (positions.includes("3B")) { vars["3B"] = 1; }
      if (positions.includes("SS")) { vars.SS = 1; }
      if (positions.includes("OF")) { vars.OF = 1; }
      break;

    case "NFL":
      if (positions.includes("QB")) { vars.QB = 1; }
      if (positions.includes("RB")) { vars.RB = 1; vars.FLEX = 1; }
      if (positions.includes("WR")) { vars.WR = 1; vars.FLEX = 1; }
      if (positions.includes("TE")) { vars.TE = 1; vars.FLEX = 1; }
      if (positions.includes("DST")) { vars.DST = 1; }
      break;

    case "GOLF":
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "SOCCER":
      if (positions.includes("F")) { vars.F = 1; vars.OUTFIELD = 1; }
      if (positions.includes("M")) { vars.M = 1; vars.OUTFIELD = 1; }
      if (positions.includes("D")) { vars.D = 1; vars.OUTFIELD = 1; }
      if (positions.includes("GK")) { vars.GK = 1; }
      break;
  }

  return vars;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/['']/g, "").replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

interface PlayerWithActual extends Player {
  actualPoints: number;
}

function solveOptimalLineup(pool: PlayerWithActual[], sport: string): {
  lineup: PlayerWithActual[];
  totalSalary: number;
  totalActualPoints: number;
  error?: string;
} {
  const config = getPlatformConfig(sport, "draftkings");

  const model: any = {
    optimize: "actualPoints",
    opType: "max",
    constraints: {
      salary: { max: config.salaryCap },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints: {},
  };

  for (const [key, constraint] of Object.entries(config.positionConstraints)) {
    model.constraints[key] = constraint;
  }

  pool.forEach(p => {
    const variableName = `p${p.id}`;
    const variable: any = {
      actualPoints: p.actualPoints,
      salary: p.salary,
      rosterSize: 1,
      ...buildPositionVariables(p.position, sport),
    };

    model.variables[variableName] = variable;
    model.ints[variableName] = 1;
    model.constraints[`bound_${variableName}`] = { max: 1 };
    variable[`bound_${variableName}`] = 1;
  });

  const result: any = solver.Solve(model);

  if (!result.feasible) {
    return { error: "Could not find feasible optimal lineup", lineup: [], totalSalary: 0, totalActualPoints: 0 };
  }

  const selectedIds = Object.keys(result)
    .filter(k => k.startsWith("p") && result[k] > 0.5)
    .map(k => Number(k.substring(1)));

  const selectedPlayers = pool.filter(p => selectedIds.includes(p.id));

  if (selectedPlayers.length !== config.rosterSize) {
    return { error: `Roster size mismatch: ${selectedPlayers.length}/${config.rosterSize}`, lineup: [], totalSalary: 0, totalActualPoints: 0 };
  }

  const totalSalary = selectedPlayers.reduce((sum, p) => sum + p.salary, 0);
  const totalActualPoints = selectedPlayers.reduce((sum, p) => sum + p.actualPoints, 0);

  return { lineup: selectedPlayers, totalSalary, totalActualPoints: Math.round(totalActualPoints * 100) / 100 };
}

function computeInsights(lineup: PlayerWithActual[], pool: PlayerWithActual[], sport: string) {
  const config = getPlatformConfig(sport, "draftkings");
  const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
  const totalActualPoints = lineup.reduce((s, p) => s + p.actualPoints, 0);
  const totalProjectedPoints = lineup.reduce((s, p) => s + Number(p.projectedPoints), 0);

  const avgSalary = Math.round(totalSalary / lineup.length);
  const salaryUtilization = Math.round((totalSalary / config.salaryCap) * 1000) / 10;
  const salaryEfficiency = Math.round((totalActualPoints / (totalSalary / 1000)) * 100) / 100;

  const positionBreakdown: Record<string, { count: number; avgSalary: number; avgActual: number; avgProjected: number }> = {};
  for (const p of lineup) {
    const mainPos = p.position.split("/")[0];
    if (!positionBreakdown[mainPos]) {
      positionBreakdown[mainPos] = { count: 0, avgSalary: 0, avgActual: 0, avgProjected: 0 };
    }
    positionBreakdown[mainPos].count++;
    positionBreakdown[mainPos].avgSalary += p.salary;
    positionBreakdown[mainPos].avgActual += p.actualPoints;
    positionBreakdown[mainPos].avgProjected += Number(p.projectedPoints);
  }
  for (const pos of Object.keys(positionBreakdown)) {
    const pb = positionBreakdown[pos];
    pb.avgSalary = Math.round(pb.avgSalary / pb.count);
    pb.avgActual = Math.round((pb.avgActual / pb.count) * 100) / 100;
    pb.avgProjected = Math.round((pb.avgProjected / pb.count) * 100) / 100;
  }

  const salaryRanges = { low: 0, mid: 0, high: 0, premium: 0 };
  for (const p of lineup) {
    if (p.salary < 4000) salaryRanges.low++;
    else if (p.salary < 6000) salaryRanges.mid++;
    else if (p.salary < 8000) salaryRanges.high++;
    else salaryRanges.premium++;
  }

  const projectionAccuracy = lineup.map(p => ({
    name: p.name,
    projected: Number(p.projectedPoints),
    actual: p.actualPoints,
    diff: Math.round((p.actualPoints - Number(p.projectedPoints)) * 100) / 100,
    ratio: Number(p.projectedPoints) > 0 ? Math.round((p.actualPoints / Number(p.projectedPoints)) * 100) / 100 : 0,
  }));

  const avgProjectionRatio = projectionAccuracy.length > 0
    ? Math.round((projectionAccuracy.reduce((s, p) => s + p.ratio, 0) / projectionAccuracy.length) * 100) / 100
    : 0;

  const valuePlays = lineup
    .map(p => ({ name: p.name, salary: p.salary, actual: p.actualPoints, value: Math.round((p.actualPoints / (p.salary / 1000)) * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  const boostAnalysis = lineup.map(p => ({
    name: p.name,
    boostScore: Number(p.boostScore) || 0,
    boostReason: p.boostReason || "",
    actualPoints: p.actualPoints,
    outperformed: p.actualPoints > Number(p.projectedPoints),
  }));

  const boostedPlayers = boostAnalysis.filter(p => p.boostScore > 0);
  const boostHitRate = boostedPlayers.length > 0
    ? Math.round((boostedPlayers.filter(p => p.outperformed).length / boostedPlayers.length) * 100)
    : 0;

  const poolAvgActual = pool.length > 0 ? pool.reduce((s, p) => s + p.actualPoints, 0) / pool.length : 0;
  const lineupAvgActual = totalActualPoints / lineup.length;
  const outperformanceMultiple = poolAvgActual > 0 ? Math.round((lineupAvgActual / poolAvgActual) * 100) / 100 : 0;

  return {
    totalActualPoints: Math.round(totalActualPoints * 100) / 100,
    totalProjectedPoints: Math.round(totalProjectedPoints * 100) / 100,
    avgSalary,
    salaryUtilization,
    salaryEfficiency,
    salaryRanges,
    positionBreakdown,
    projectionAccuracy,
    avgProjectionRatio,
    valuePlays,
    boostAnalysis,
    boostHitRate,
    outperformanceMultiple,
    poolSize: pool.length,
    poolAvgActual: Math.round(poolAvgActual * 100) / 100,
  };
}

export async function analyzeCompletedSlate(sport: string, slateDate: string): Promise<{ success: boolean; message: string }> {
  try {
    const existing = await storage.getWinningLineupBySlateDate(sport, slateDate);
    if (existing) {
      return { success: false, message: `${sport} slate for ${slateDate} already analyzed` };
    }

    const history = await storage.getPlayerHistoryBySport(sport, 10000);
    const allSlateRecords = history.filter(h => h.slateDate === slateDate);

    if (allSlateRecords.length === 0) {
      return { success: false, message: `No player history found for ${sport} on ${slateDate}` };
    }

    const deduped = new Map<string, typeof allSlateRecords[0]>();
    for (const h of allSlateRecords) {
      const key = h.draftKingsPlayerId ? `dk_${h.draftKingsPlayerId}` : `${h.playerName}_${h.team}_${h.position}_${h.salary}`;
      if (!deduped.has(key) || h.id > deduped.get(key)!.id) {
        deduped.set(key, h);
      }
    }
    const slatePlayers = Array.from(deduped.values());
    console.log(`[WinningAgent] ${sport} ${slateDate}: ${allSlateRecords.length} total records, ${slatePlayers.length} unique players after dedup`);

    const actualPointsMap = await fetchActualPointsForDate(sport, slateDate);

    if (actualPointsMap.size === 0) {
      return { success: false, message: `No actual points data available for ${sport} on ${slateDate}` };
    }

    const pool: PlayerWithActual[] = [];
    let matchCount = 0;

    const batchUpdates: Array<{ playerName: string; actualPoints: string }> = [];

    for (const h of slatePlayers) {
      const normalized = normalizeName(h.playerName);
      const actual = actualPointsMap.get(normalized);
      const actualPts = actual ? actual.points : 0;

      if (actual) {
        matchCount++;
        batchUpdates.push({ playerName: h.playerName, actualPoints: String(actualPts) });
      }

      pool.push({
        id: h.id,
        slateId: h.slateId || 0,
        name: h.playerName,
        team: h.team,
        position: h.position,
        salary: h.salary,
        fppg: h.projectedPoints,
        projectedPoints: h.projectedPoints,
        opponent: "",
        gameInfo: "",
        injuryStatus: null,
        injuryDetail: null,
        boostScore: "0",
        boostReason: null,
        draftKingsPlayerId: h.draftKingsPlayerId,
        actualPoints: actualPts,
      });
    }

    console.log(`[WinningAgent] ${sport} ${slateDate}: Matched ${matchCount}/${slatePlayers.length} players with actual points`);

    if (batchUpdates.length > 0) {
      await storage.batchUpdatePlayerHistoryActualPoints(sport, slateDate, batchUpdates);
      console.log(`[WinningAgent] ${sport} ${slateDate}: Updated ${batchUpdates.length} player history records with actual points`);
    }

    if (matchCount < 10) {
      return { success: false, message: `Only matched ${matchCount} players with actual data — not enough for analysis` };
    }

    const eligiblePool = pool.filter(p => p.actualPoints > 0);
    const result = solveOptimalLineup(eligiblePool, sport);

    if (result.error) {
      return { success: false, message: `LP solver error: ${result.error}` };
    }

    const insights = computeInsights(result.lineup, pool, sport);

    const playerData = result.lineup.map(p => ({
      name: p.name,
      position: p.position,
      team: p.team,
      salary: p.salary,
      projectedPoints: Number(p.projectedPoints),
      actualPoints: p.actualPoints,
      value: Math.round((p.actualPoints / (p.salary / 1000)) * 100) / 100,
      boostScore: Number(p.boostScore) || 0,
    }));

    const config = getPlatformConfig(sport, "draftkings");

    const record: InsertWinningLineup = {
      sport,
      slateId: slatePlayers[0]?.slateId || null,
      slateDate,
      draftGroupId: null,
      totalActualPoints: String(result.totalActualPoints),
      totalSalary: result.totalSalary,
      salaryCap: config.salaryCap,
      playerData,
      insights,
    };

    await storage.createWinningLineup(record);
    clearProfileCache(sport);
    console.log(`[WinningAgent] Stored optimal lineup for ${sport} ${slateDate}: ${result.totalActualPoints} pts, $${result.totalSalary} salary (historical profile cache cleared)`);

    return { success: true, message: `Analyzed ${sport} ${slateDate}: ${result.totalActualPoints} pts optimal lineup (${matchCount} players matched)` };
  } catch (err: any) {
    console.error(`[WinningAgent] Error analyzing ${sport} ${slateDate}:`, err);
    return { success: false, message: err.message || "Unknown error" };
  }
}

export async function runNightlyAnalysis(): Promise<string[]> {
  const results: string[] = [];
  const sports = ["NBA", "NHL", "MLB", "NFL"];

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  console.log(`[WinningAgent] Starting nightly analysis for ${dateStr}`);

  for (const sport of sports) {
    try {
      const result = await analyzeCompletedSlate(sport, dateStr);
      results.push(`${sport}: ${result.message}`);
    } catch (err: any) {
      results.push(`${sport}: Error - ${err.message}`);
    }
  }

  console.log(`[WinningAgent] Nightly analysis complete:`, results);
  return results;
}
