import solver from "javascript-lp-solver";
import { storage } from "./storage";
import { getEasternToday } from "./balldontlie";
import { fetchActualPointsForDate } from "./actual-points";
import { getPlatformConfig, ACTIVE_SPORTS } from "@shared/platform-config";
import { clearProfileCache } from "./historical-adjustments";
import type { Player, InsertWinningLineup } from "@shared/schema";

const WIN_AGENT_SPORTS = ACTIVE_SPORTS.filter(s => !["GOLF", "SOCCER"].includes(s));

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
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PlayerWithActual extends Player {
  actualPoints: number;
}

function solveOptimalLineup(pool: PlayerWithActual[], sport: string, platform: "draftkings" | "fanduel" | "yahoo" = "draftkings"): {
  lineup: PlayerWithActual[];
  totalSalary: number;
  totalActualPoints: number;
  error?: string;
} {
  const config = getPlatformConfig(sport, platform);

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
  if (config.aggregateConstraints) {
    for (const [key, constraint] of Object.entries(config.aggregateConstraints)) {
      model.constraints[key] = constraint;
    }
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

function computeInsights(lineup: PlayerWithActual[], pool: PlayerWithActual[], sport: string, platform: "draftkings" | "fanduel" | "yahoo" = "draftkings") {
  const config = getPlatformConfig(sport, platform);
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

  const capQuarter = config.salaryCap / 4;
  const salaryRanges = { low: 0, mid: 0, high: 0, premium: 0 };
  for (const p of lineup) {
    if (p.salary < capQuarter)           salaryRanges.low++;
    else if (p.salary < capQuarter * 2)  salaryRanges.mid++;
    else if (p.salary < capQuarter * 3)  salaryRanges.high++;
    else                                  salaryRanges.premium++;
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

export async function analyzeCompletedSlate(sport: string, slateDate: string, platform: "draftkings" | "fanduel" | "yahoo" = "draftkings", force: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    const existing = await storage.getWinningLineupBySlateDate(sport, slateDate, platform);
    if (existing && !force) {
      return { success: false, message: `${sport}/${platform} slate for ${slateDate} already analyzed` };
    }

    // filter history by platform so FD/Yahoo analysis doesn't use DK salaries
    const history = await storage.getPlayerHistoryBySport(sport, 10000);
    const allSlateRecords = history.filter(h => h.slateDate === slateDate && (h.platform === platform || !h.platform));

    const actualPointsMap = await fetchActualPointsForDate(sport, slateDate);

    if (actualPointsMap.size === 0) {
      return { success: false, message: `No actual points data available for ${sport} on ${slateDate}` };
    }

    const pool: PlayerWithActual[] = [];
    let matchCount = 0;

    if (allSlateRecords.length > 0) {
      const deduped = new Map<string, typeof allSlateRecords[0]>();
      for (const h of allSlateRecords) {
        const key = `${h.playerName}_${h.team}_${h.position}`;
        if (!deduped.has(key) || h.id > deduped.get(key)!.id) {
          deduped.set(key, h);
        }
      }
      const slatePlayers = Array.from(deduped.values());
      console.log(`[WinningAgent] ${sport} ${slateDate}: ${allSlateRecords.length} total records, ${slatePlayers.length} unique players after dedup`);

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
          fanDuelPlayerId: null,
          yahooPlayerId: null,
          fanDuelSalary: null,
          yahooSalary: null,
          isConfirmedStarter: false,
          actualPoints: actualPts,
        });
      }

      console.log(`[WinningAgent] ${sport} ${slateDate}: Matched ${matchCount}/${slatePlayers.length} players with actual points`);

      if (batchUpdates.length > 0) {
        await storage.batchUpdatePlayerHistoryActualPoints(sport, slateDate, batchUpdates);
        console.log(`[WinningAgent] ${sport} ${slateDate}: Updated ${batchUpdates.length} player history records with actual points`);
      }
    } else {
      console.log(`[WinningAgent] ${sport}/${platform} ${slateDate}: No player history — building pool from ESPN box scores + archived slate salaries`);

      const allSlates = await storage.getSlates();
      const salaryLookup = new Map<string, { salary: number; position: string; fppg: string }>();

      // Prefer slates whose startTime matches slateDate (even if deactivated) — these
      // have the salaries that were actually live that day. Only fall back to the current
      // isMain slate when no dated match exists.
      const datedSlates = allSlates.filter(s => {
        if (s.sport !== sport || s.platform !== platform) return false;
        const slateDay = new Date(s.startTime).toISOString().split("T")[0];
        return slateDay === slateDate;
      });
      const candidateSlates = datedSlates.length > 0
        ? datedSlates
        : allSlates.filter(s => s.sport === sport && s.platform === platform && s.isMain);

      for (const candidateSlate of candidateSlates) {
        const candidatePlayers = await storage.getPlayersBySlate(candidateSlate.id);
        for (const p of candidatePlayers) {
          const key = normalizeName(p.name);
          if (!salaryLookup.has(key)) {
            salaryLookup.set(key, { salary: p.salary, position: p.position, fppg: p.fppg ?? "0" });
          }
        }
      }

      if (salaryLookup.size === 0) {
        console.warn(`[WinningAgent] ${sport}/${platform} ${slateDate}: No salary data found for this date — projections will use estimated salaries`);
      }

      const config = getPlatformConfig(sport, platform);
      let autoId = 900000;

      for (const [normalizedName, actual] of actualPointsMap) {
        const salaryInfo = salaryLookup.get(normalizedName);
        const defaultSalary = platform === "yahoo"
          ? Math.round(config.salaryCap / config.rosterSize)
          : Math.round(config.salaryCap / config.rosterSize / 1000) * 1000;
        const salary = salaryInfo?.salary ?? defaultSalary;
        const defaultPositions: Record<string, string> = {
          NBA: "SF", NHL: "W", MLB: "OF", NFL: "WR", GOLF: "G", SOCCER: "M",
        };
        const position = salaryInfo?.position ?? (defaultPositions[sport] || "UTIL");

        matchCount++;
        pool.push({
          id: autoId++,
          slateId: candidateSlates[0]?.id || 0,
          name: actual.playerName,
          team: actual.team,
          position,
          salary,
          fppg: salaryInfo?.fppg ?? String(actual.points),
          projectedPoints: salaryInfo?.fppg ?? String(actual.points),
          opponent: "",
          gameInfo: "",
          injuryStatus: null,
          injuryDetail: null,
          boostScore: "0",
          boostReason: null,
          draftKingsPlayerId: null,
          fanDuelPlayerId: null,
          yahooPlayerId: null,
          fanDuelSalary: null,
          yahooSalary: null,
          isConfirmedStarter: false,
          actualPoints: actual.points,
        });
      }

      console.log(`[WinningAgent] ${sport} ${slateDate}: Built ESPN-based pool with ${matchCount} players (${salaryLookup.size} salary matches from current slate)`);
    }

    const config = getPlatformConfig(sport, platform);
    if (matchCount < config.rosterSize) {
      return { success: false, message: `Only matched ${matchCount} players with actual data — need at least ${config.rosterSize} for ${sport}` };
    }

    const eligiblePool = pool.filter(p => p.actualPoints > 0);
    const result = solveOptimalLineup(eligiblePool, sport, platform);

    if (result.error) {
      return { success: false, message: `LP solver error: ${result.error}` };
    }

    const insights = computeInsights(result.lineup, pool, sport, platform);

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

    const record: InsertWinningLineup = {
      sport,
      platform,
      slateId: (allSlateRecords.length > 0 ? allSlateRecords[0]?.slateId : null) || null,
      slateDate,
      draftGroupId: null,
      totalActualPoints: result.totalActualPoints,
      totalSalary: result.totalSalary,
      salaryCap: config.salaryCap,
      playerData,
      insights,
    };

    if (existing && force) {
      await storage.deleteWinningLineup(existing.id);
      console.log(`[WinningAgent] Force mode: replaced existing ${sport}/${platform} ${slateDate} record id=${existing.id}`);
    }
    await storage.createWinningLineup(record);
    clearProfileCache(sport);
    console.log(
      `[WinningAgent] Stored optimal lineup for ${sport}/${platform} ${slateDate}: ` +
      `${result.totalActualPoints} pts, $${result.totalSalary} salary (historical profile cache cleared)`
    );

    return {
      success: true,
      message: `Analyzed ${sport}/${platform} ${slateDate}: ${result.totalActualPoints} pts optimal lineup (${matchCount} players matched)`,
    };
  } catch (err: any) {
    console.error(`[WinningAgent] Error analyzing ${sport}/${platform} ${slateDate}:`, err);
    return { success: false, message: err.message || "Unknown error" };
  }
}

export async function runNightlyAnalysis(): Promise<string[]> {
  const results: string[] = [];
  const sports = WIN_AGENT_SPORTS;
  const platforms: Array<"draftkings" | "fanduel" | "yahoo"> = ["draftkings", "fanduel", "yahoo"];

  const todayET = getEasternToday();
  const baseDate = new Date(todayET + "T12:00:00Z");

  // Analyze last 2 days to catch any missing data
  const dates: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  console.log(`[WinningAgent] Starting nightly analysis for dates: ${dates.join(", ")}`);

  for (const dateStr of dates) {
    const dateResults: Promise<{ sport: string; platform: string; message: string }>[] = [];

    for (const sport of sports) {
      for (const platform of platforms) {
        dateResults.push(
          (async () => {
            try {
              // Check if already analyzed to avoid reprocessing
              const existing = await storage.getWinningLineupBySlateDate(sport, dateStr, platform);
              if (existing) {
                return { sport, platform, message: `${sport}/${platform}: already analyzed` };
              }

              const result = await analyzeCompletedSlate(sport, dateStr, platform);
              return { sport, platform, message: `${sport}/${platform}: ${result.message}` };
            } catch (err: any) {
              const msg = err.message || String(err);
              console.error(`[WinningAgent] ${sport}/${platform} ${dateStr} failed:`, msg);
              return { sport, platform, message: `${sport}/${platform}: Error - ${msg}` };
            }
          })()
        );
      }
    }

    // Run all sport/platform combos in parallel for this date
    const dateResultsSettled = await Promise.allSettled(dateResults);
    for (const r of dateResultsSettled) {
      if (r.status === "fulfilled") {
        results.push(r.value.message);
      } else {
        results.push(`Error: ${(r as PromiseRejectedResult).reason?.message}`);
      }
    }

    // Small delay between dates to avoid overwhelming ESPN API
    await new Promise(res => setTimeout(res, 500));
  }

  console.log(`[WinningAgent] Nightly analysis complete (${results.length} combos processed):`, results.slice(0, 10));
  return results;
}

export async function runNightlyDKBackfill(): Promise<string[]> {
  const results: string[] = [];
  const sports = WIN_AGENT_SPORTS;
  const platform = "draftkings" as const;

  const todayET = getEasternToday();
  const baseDate = new Date(todayET + "T12:00:00Z");

  const dates: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  let filled = 0;
  let skipped = 0;

  console.log(`[WinningAgent] DK backfill: checking ${dates.length} days × ${sports.length} sports`);

  for (const dateStr of dates) {
    const dateResults = await Promise.allSettled(
      sports.map(async (sport) => {
        const existing = await storage.getWinningLineupBySlateDate(sport, dateStr, platform);
        if (existing) {
          skipped++;
          return `${dateStr} ${sport}: exists`;
        }
        const result = await analyzeCompletedSlate(sport, dateStr, platform);
        if (result.success) {
          filled++;
          return `${dateStr} ${sport}: FILLED — ${result.message}`;
        }
        return `${dateStr} ${sport}: ${result.message}`;
      })
    );

    for (const r of dateResults) {
      const msg = r.status === "fulfilled" ? r.value : `Error: ${(r as PromiseRejectedResult).reason?.message}`;
      if (!msg.includes("exists")) results.push(msg);
    }

    await new Promise(res => setTimeout(res, 300));
  }

  console.log(`[WinningAgent] DK backfill complete — filled:${filled} skipped:${skipped}`);
  if (filled > 0) {
    results.unshift(`Filled ${filled} missing DK winning lineups`);
  }
  return results;
}

/**
 * runBackfill
 *
 * Fills in any missing winning lineup records for the past `daysBack` days
 * across every active sport and platform. Skips combos that already have a
 * record (unless force=true). Runs dates sequentially so the DB isn't hammered,
 * but processes sport × platform combos in parallel within each date.
 *
 * Called by POST /api/admin/backfill-winning-lineups
 */
export async function runBackfill(
  daysBack = 7,
  force = false,
  onProgress?: (msg: string) => void,
): Promise<{ attempted: number; succeeded: number; skipped: number; failed: number; results: string[] }> {
  const platforms: Array<"draftkings" | "fanduel" | "yahoo"> = ["draftkings", "fanduel", "yahoo"];
  const sports = WIN_AGENT_SPORTS;

  const todayET = getEasternToday();
  const baseDate = new Date(todayET + "T12:00:00Z");

  // Build the list of dates to check: yesterday back to daysBack days ago.
  // We skip today because games may not have finished yet.
  const dates: string[] = [];
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const allResults: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`[WinningAgent] Starting backfill for last ${daysBack} days (${dates[dates.length - 1]} → ${dates[0]}) force=${force}`);

  for (const dateStr of dates) {
    // Run all sport×platform combos for this date in parallel — they're independent
    const combos = sports.flatMap(sport =>
      platforms.map(platform => ({ sport, platform }))
    );

    const dateResults = await Promise.allSettled(
      combos.map(async ({ sport, platform }) => {
        attempted++;

        // Check for existing record before attempting (unless force)
        if (!force) {
          const existing = await storage.getWinningLineupBySlateDate(sport, dateStr, platform);
          if (existing) {
            skipped++;
            return `${dateStr} ${sport}/${platform}: skipped (already exists)`;
          }
        }

        const result = await analyzeCompletedSlate(sport, dateStr, platform, force);
        if (result.success) {
          succeeded++;
        } else if (result.message.includes("already analyzed")) {
          skipped++;
        } else {
          failed++;
        }
        return `${dateStr} ${sport}/${platform}: ${result.message}`;
      })
    );

    for (const r of dateResults) {
      const msg = r.status === "fulfilled" ? r.value : `Error: ${(r as PromiseRejectedResult).reason?.message}`;
      allResults.push(msg);
      onProgress?.(msg);
      if (r.status === "rejected") failed++;
    }

    // Small pause between dates so we don't overwhelm ESPN's API
    await new Promise(res => setTimeout(res, 500));
  }

  console.log(`[WinningAgent] Backfill complete — attempted:${attempted} succeeded:${succeeded} skipped:${skipped} failed:${failed}`);

  return { attempted, succeeded, skipped, failed, results: allResults };
}
