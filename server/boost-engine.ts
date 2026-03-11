import type { Player, PlayerHistory, WinningLineup } from "@shared/schema";
import { storage } from "./storage";

interface WinningPlayerData {
  name: string;
  team: string;
  position: string;
  salary: number;
  actualPoints: number;
  value: number;
}

function buildWinningFrequencyMap(winningLineups: WinningLineup[]): Map<string, { count: number; avgActual: number; avgValue: number }> {
  const freq = new Map<string, { count: number; totalActual: number; totalValue: number }>();
  for (const wl of winningLineups) {
    const players = (wl.playerData as WinningPlayerData[]) || [];
    const seen = new Set<string>();
    for (const p of players) {
      const key = p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = freq.get(key) || { count: 0, totalActual: 0, totalValue: 0 };
      entry.count++;
      entry.totalActual += (p.actualPoints || 0);
      entry.totalValue += (p.value || 0);
      freq.set(key, entry);
    }
  }
  const result = new Map<string, { count: number; avgActual: number; avgValue: number }>();
  for (const [name, data] of freq) {
    result.set(name, {
      count: data.count,
      avgActual: data.totalActual / data.count,
      avgValue: data.totalValue / data.count,
    });
  }
  return result;
}

interface BoostResult {
  playerId: number;
  boostScore: string;
  boostReason: string;
}

function formatSalary(salary: number): string {
  return `$${(salary / 1000).toFixed(1)}K`;
}

export async function computeBoostScores(
  players: Player[],
  sport: string,
  slateId: number
): Promise<BoostResult[]> {
  if (players.length === 0) return [];

  const activePlayers = players.filter(p => {
    const status = (p.injuryStatus || "").toUpperCase();
    return status !== "OUT" && status !== "IR";
  });
  const outPlayers = players.filter(p => {
    const status = (p.injuryStatus || "").toUpperCase();
    return status === "OUT" || status === "IR";
  });

  const winningLineups = await storage.getWinningLineups(sport, 50);
  const winFreqMap = buildWinningFrequencyMap(winningLineups);
  const totalSlatesAnalyzed = winningLineups.length;

  const history = await storage.getPlayerHistoryBySport(sport, 5000);
  history.sort((a, b) => {
    const dateCompare = (b.slateDate || "").localeCompare(a.slateDate || "");
    if (dateCompare !== 0) return dateCompare;
    return (b.id ?? 0) - (a.id ?? 0);
  });
  const historyByName = new Map<string, PlayerHistory[]>();
  for (const h of history) {
    const existing = historyByName.get(h.playerName) || [];
    existing.push(h);
    historyByName.set(h.playerName, existing);
  }

  const positionGroups = new Map<string, Player[]>();
  for (const p of activePlayers) {
    const primary = p.position.split("/")[0];
    const group = positionGroups.get(primary) || [];
    group.push(p);
    positionGroups.set(primary, group);
  }

  const positionAvgValue = new Map<string, number>();
  const positionAvgProj = new Map<string, number>();
  for (const [pos, group] of positionGroups) {
    const avgVal = group.reduce((sum, p) => sum + Number(p.projectedPoints) / Math.max(1, p.salary / 1000), 0) / group.length;
    const avgProj = group.reduce((sum, p) => sum + Number(p.projectedPoints), 0) / group.length;
    positionAvgValue.set(pos, avgVal);
    positionAvgProj.set(pos, avgProj);
  }

  const sortedBySalary = [...activePlayers].sort((a, b) => b.salary - a.salary);
  const sortedByProj = [...activePlayers].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
  const maxSalary = Math.max(...activePlayers.map(p => p.salary));
  const maxProj = Math.max(...activePlayers.map(p => Number(p.projectedPoints)));

  const positionRankByValue = new Map<string, Map<number, number>>();
  const positionRankByProj = new Map<string, Map<number, number>>();
  for (const [pos, group] of positionGroups) {
    const byValue = [...group].sort((a, b) =>
      (Number(b.projectedPoints) / Math.max(1, b.salary / 1000)) -
      (Number(a.projectedPoints) / Math.max(1, a.salary / 1000))
    );
    const byProj = [...group].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));

    const valRanks = new Map<number, number>();
    const projRanks = new Map<number, number>();
    byValue.forEach((p, i) => valRanks.set(p.id, i + 1));
    byProj.forEach((p, i) => projRanks.set(p.id, i + 1));
    positionRankByValue.set(pos, valRanks);
    positionRankByProj.set(pos, projRanks);
  }

  const teamAvgProj = new Map<string, number>();
  const teamPlayerCounts = new Map<string, number>();
  for (const p of activePlayers) {
    const current = teamAvgProj.get(p.team) || 0;
    teamAvgProj.set(p.team, current + Number(p.projectedPoints));
    teamPlayerCounts.set(p.team, (teamPlayerCounts.get(p.team) || 0) + 1);
  }
  for (const [team, total] of teamAvgProj) {
    teamAvgProj.set(team, total / (teamPlayerCounts.get(team) || 1));
  }

  const results: BoostResult[] = [];

  for (const op of outPlayers) {
    results.push({ playerId: op.id, boostScore: "0", boostReason: "" });
  }

  for (const player of activePlayers) {
    const proj = Number(player.projectedPoints);
    const salary = player.salary;
    if (proj <= 0) {
      results.push({ playerId: player.id, boostScore: "0", boostReason: "" });
      continue;
    }

    let totalBoost = 0;
    const reasons: string[] = [];
    const primary = player.position.split("/")[0];
    const posGroup = positionGroups.get(primary) || [];
    const posCount = posGroup.length;

    const valuePerK = proj / (salary / 1000);
    const posAvg = positionAvgValue.get(primary) || valuePerK;
    const valueRatio = valuePerK / Math.max(0.01, posAvg);
    const valRank = positionRankByValue.get(primary)?.get(player.id) || 0;
    const projRank = positionRankByProj.get(primary)?.get(player.id) || 0;

    if (valueRatio > 1.25) {
      const valuePts = Math.min(3.0, (valueRatio - 1) * 4);
      totalBoost += valuePts;
      const pctAbove = ((valueRatio - 1) * 100).toFixed(0);
      reasons.push(`Elite value: ${valuePerK.toFixed(1)} pts/$K — ${pctAbove}% above ${primary} avg (${posAvg.toFixed(1)} pts/$K), ranked #${valRank} of ${posCount} ${primary}s`);
    } else if (valueRatio > 1.10) {
      const valuePts = Math.min(1.5, (valueRatio - 1) * 3);
      totalBoost += valuePts;
      reasons.push(`Above-avg value: ${valuePerK.toFixed(1)} pts/$K at ${formatSalary(salary)}, ranked #${valRank} of ${posCount} ${primary}s`);
    } else if (valueRatio < 0.75) {
      const valuePenalty = Math.max(-2.0, (valueRatio - 1) * 3);
      totalBoost += valuePenalty;
      reasons.push(`Poor value: ${valuePerK.toFixed(1)} pts/$K at ${formatSalary(salary)} — ${((1 - valueRatio) * 100).toFixed(0)}% below ${primary} avg`);
    }

    const playerHist = historyByName.get(player.name);
    if (playerHist && playerHist.length >= 2) {
      const recentHist = playerHist.slice(0, 10);
      const avgHistProj = recentHist.reduce((s, h) => s + Number(h.projectedPoints), 0) / recentHist.length;

      if (avgHistProj > 0) {
        const trendRatio = proj / avgHistProj;
        const projDiff = proj - avgHistProj;

        if (recentHist.length >= 3) {
          const last3 = recentHist.slice(0, 3).map(h => Number(h.projectedPoints));
          let streak = 0;
          for (let i = 0; i < last3.length - 1; i++) {
            if (last3[i] > last3[i + 1]) streak++;
            else break;
          }
          if (streak >= 2) {
            totalBoost += 1.0;
            reasons.push(`Upward streak: projection rose ${streak + 1} consecutive slates (${last3[last3.length - 1].toFixed(1)} → ${last3[0].toFixed(1)} pts)`);
          }

          let downStreak = 0;
          for (let i = 0; i < last3.length - 1; i++) {
            if (last3[i] < last3[i + 1]) downStreak++;
            else break;
          }
          if (downStreak >= 2) {
            totalBoost -= 0.8;
            reasons.push(`Downward trend: projection fell ${downStreak + 1} consecutive slates (${last3[last3.length - 1].toFixed(1)} → ${last3[0].toFixed(1)} pts)`);
          }
        }

        if (trendRatio > 1.10) {
          const trendBoost = Math.min(2.5, (trendRatio - 1) * 8);
          totalBoost += trendBoost;
          reasons.push(`Rising projection: ${proj.toFixed(1)} pts today vs ${avgHistProj.toFixed(1)} avg over ${recentHist.length} slates (+${projDiff.toFixed(1)} pts, +${((trendRatio - 1) * 100).toFixed(0)}%)`);
        } else if (trendRatio < 0.85) {
          const trendPenalty = Math.max(-2.0, (trendRatio - 1) * 6);
          totalBoost += trendPenalty;
          reasons.push(`Declining projection: ${proj.toFixed(1)} pts today vs ${avgHistProj.toFixed(1)} avg over ${recentHist.length} slates (${projDiff.toFixed(1)} pts, ${((trendRatio - 1) * 100).toFixed(0)}%)`);
        }
      }

      const avgHistSalary = recentHist.reduce((s, h) => s + h.salary, 0) / recentHist.length;
      if (avgHistSalary > 0) {
        const salaryChange = salary - avgHistSalary;
        const salaryChangePct = (salaryChange / avgHistSalary) * 100;

        if (salary > avgHistSalary * 1.08 && proj <= avgHistProj * 1.02) {
          totalBoost -= 1.0;
          reasons.push(`Overpriced: salary up ${formatSalary(salaryChange)} (+${salaryChangePct.toFixed(0)}%) from avg ${formatSalary(avgHistSalary)} but projection flat at ${proj.toFixed(1)} pts`);
        } else if (salary < avgHistSalary * 0.92 && proj >= avgHistProj * 0.95) {
          totalBoost += 1.5;
          reasons.push(`Underpriced: salary dropped ${formatSalary(Math.abs(salaryChange))} (${salaryChangePct.toFixed(0)}%) from avg ${formatSalary(avgHistSalary)} while projection holds at ${proj.toFixed(1)} pts`);
        } else if (Math.abs(salaryChangePct) > 5) {
          if (salaryChange > 0) {
            reasons.push(`Salary trending up: ${formatSalary(avgHistSalary)} → ${formatSalary(salary)} (+${salaryChangePct.toFixed(0)}% over ${recentHist.length} slates)`);
          } else {
            reasons.push(`Salary trending down: ${formatSalary(avgHistSalary)} → ${formatSalary(salary)} (${salaryChangePct.toFixed(0)}% over ${recentHist.length} slates)`);
          }
        }
      }

      if (recentHist.length >= 4) {
        const projValues = recentHist.map(h => Number(h.projectedPoints));
        const mean = projValues.reduce((a, b) => a + b, 0) / projValues.length;
        const variance = projValues.reduce((s, v) => s + (v - mean) ** 2, 0) / projValues.length;
        const stdDev = Math.sqrt(variance);
        const cv = stdDev / Math.max(1, mean);

        const floor = Math.max(0, mean - 1.5 * stdDev);
        const ceiling = mean + 1.5 * stdDev;

        if (cv < 0.10 && mean > (positionAvgProj.get(primary) || 0) * 0.9) {
          totalBoost += 1.0;
          reasons.push(`Highly consistent: CV ${(cv * 100).toFixed(0)}% over ${projValues.length} slates — safe floor of ${floor.toFixed(1)} pts (range ${floor.toFixed(1)}-${ceiling.toFixed(1)})`);
        } else if (cv > 0.30) {
          totalBoost -= 0.5;
          reasons.push(`High volatility: CV ${(cv * 100).toFixed(0)}% over ${projValues.length} slates — wide range ${floor.toFixed(1)}-${ceiling.toFixed(1)} pts (risky for cash games)`);
        } else if (projValues.length >= 5) {
          reasons.push(`Projection range: ${floor.toFixed(1)}-${ceiling.toFixed(1)} pts based on ${projValues.length} slates (CV ${(cv * 100).toFixed(0)}%)`);
        }

        if (recentHist.length >= 6) {
          const recent3Avg = projValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
          const olderSlice = projValues.slice(3, 6);
          const older3Avg = olderSlice.reduce((a, b) => a + b, 0) / olderSlice.length;

          if (older3Avg > 0) {
            const momentumPct = ((recent3Avg - older3Avg) / older3Avg) * 100;

            if (momentumPct > 8) {
              totalBoost += 0.8;
              reasons.push(`Positive momentum: recent 3-slate avg ${recent3Avg.toFixed(1)} pts vs prior ${older3Avg.toFixed(1)} pts (+${momentumPct.toFixed(0)}%)`);
            } else if (momentumPct < -8) {
              totalBoost -= 0.5;
              reasons.push(`Negative momentum: recent 3-slate avg ${recent3Avg.toFixed(1)} pts vs prior ${older3Avg.toFixed(1)} pts (${momentumPct.toFixed(0)}%)`);
            }
          }
        }
      }

      if (recentHist.length >= 3) {
        const salaries = recentHist.map(h => h.salary);
        const minHistSalary = Math.min(...salaries);
        const maxHistSalary = Math.max(...salaries);
        if (salary <= minHistSalary && proj >= avgHistProj * 0.9) {
          totalBoost += 1.0;
          reasons.push(`Lowest salary in ${recentHist.length} tracked slates: ${formatSalary(salary)} (range ${formatSalary(minHistSalary)}-${formatSalary(maxHistSalary)}) with projection intact`);
        } else if (salary >= maxHistSalary && proj <= avgHistProj * 1.05) {
          totalBoost -= 0.5;
          reasons.push(`Highest salary in ${recentHist.length} tracked slates: ${formatSalary(salary)} — may be priced at ceiling`);
        }
      }
    }

    const salaryPct = salary / maxSalary;
    const projPct = proj / Math.max(1, maxProj);

    if (salaryPct < 0.20 && projPct > 0.25) {
      totalBoost += 1.5;
      const overallRank = sortedByProj.findIndex(p => p.id === player.id) + 1;
      reasons.push(`Bargain play: ${formatSalary(salary)} (bottom 20% salary) but projected ${proj.toFixed(1)} pts (top ${(projPct * 100).toFixed(0)}%, #${overallRank} overall) — strong GPP leverage`);
    } else if (salaryPct < 0.30 && projPct > 0.35) {
      totalBoost += 0.8;
      reasons.push(`Value play: ${formatSalary(salary)} with ${proj.toFixed(1)} pts projection — efficient salary allocation`);
    }

    if (projRank > 0 && projRank <= 3 && posCount >= 5) {
      totalBoost += 0.5;
      reasons.push(`Top-tier ${primary}: ranked #${projRank} of ${posCount} by projection at the position`);
    }

    if (sport === "NBA" || sport === "NHL") {
      const teamAvg = teamAvgProj.get(player.team) || 0;
      const slateAvg = players.reduce((s, p) => s + Number(p.projectedPoints), 0) / players.length;
      if (teamAvg > slateAvg * 1.15) {
        totalBoost += 0.5;
        const teamCount = teamPlayerCounts.get(player.team) || 0;
        reasons.push(`High-scoring environment: ${player.team} avg ${teamAvg.toFixed(1)} pts/player (${teamCount} rostered) vs slate avg ${slateAvg.toFixed(1)} — game stack potential`);
      }
    }

    if (sport === "NFL") {
      const teamPlayers = players.filter(p => p.team === player.team);
      const hasQB = teamPlayers.some(p => p.position.includes("QB"));
      if (player.position.includes("WR") && hasQB) {
        const qb = teamPlayers.find(p => p.position.includes("QB"));
        if (qb && Number(qb.projectedPoints) > maxProj * 0.5) {
          totalBoost += 0.5;
          reasons.push(`Stack potential: ${player.team} QB ${qb.name} projected ${Number(qb.projectedPoints).toFixed(1)} pts — correlation upside`);
        }
      }
    }

    if (sport === "MLB") {
      const teamBatters = players.filter(p => p.team === player.team && !p.position.includes("SP"));
      if (teamBatters.length >= 4 && !player.position.includes("SP")) {
        const teamBatAvg = teamBatters.reduce((s, p) => s + Number(p.projectedPoints), 0) / teamBatters.length;
        if (teamBatAvg > (maxProj * 0.3)) {
          totalBoost += 0.5;
          reasons.push(`Team stack: ${player.team} has ${teamBatters.length} batters averaging ${teamBatAvg.toFixed(1)} pts — correlated upside in GPP`);
        }
      }
    }

    if (totalSlatesAnalyzed >= 2) {
      const winData = winFreqMap.get(player.name);
      if (winData && winData.count >= 2) {
        const freqPct = (winData.count / totalSlatesAnalyzed) * 100;
        if (freqPct >= 50) {
          totalBoost += 3.0;
          reasons.push(`Optimal regular: appeared in ${winData.count}/${totalSlatesAnalyzed} winning lineups (${freqPct.toFixed(0)}%) — avg ${winData.avgActual.toFixed(1)} actual pts, ${winData.avgValue.toFixed(1)}x value`);
        } else if (freqPct >= 25) {
          totalBoost += 2.0;
          reasons.push(`Winning lineup pick: appeared in ${winData.count}/${totalSlatesAnalyzed} winning lineups (${freqPct.toFixed(0)}%) — avg ${winData.avgActual.toFixed(1)} actual pts`);
        } else {
          totalBoost += 1.0;
          reasons.push(`Past optimal: appeared in ${winData.count}/${totalSlatesAnalyzed} winning lineups — avg ${winData.avgActual.toFixed(1)} actual pts`);
        }
      } else if (winData && winData.count === 1 && winData.avgValue >= 6.0) {
        totalBoost += 0.5;
        reasons.push(`High-value winner: ${winData.avgValue.toFixed(1)}x value in a past optimal lineup (${winData.avgActual.toFixed(1)} actual pts)`);
      }
    }

    const playerHist2 = historyByName.get(player.name);
    if (playerHist2 && playerHist2.length >= 3) {
      const withActuals = playerHist2.filter(h => h.actualPoints != null && Number(h.actualPoints) > 0);
      if (withActuals.length >= 3) {
        const ratios = withActuals.slice(0, 10).map(h => Number(h.actualPoints!) / Math.max(1, Number(h.projectedPoints)));
        const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const beatsProjection = ratios.filter(r => r > 1.0).length;
        const underProjection = ratios.filter(r => r < 0.9).length;
        const consistency = beatsProjection / ratios.length;

        if (avgRatio >= 1.15 && consistency >= 0.6) {
          const accuracyBoost = Math.min(3.0, (avgRatio - 1) * 6);
          totalBoost += accuracyBoost;
          reasons.push(`Consistent outperformer: actual ${((avgRatio - 1) * 100).toFixed(0)}% above projection over ${withActuals.length} games (beat proj ${beatsProjection}/${ratios.length} times)`);
        } else if (avgRatio >= 1.05 && consistency >= 0.5) {
          const accuracyBoost = Math.min(1.5, (avgRatio - 1) * 5);
          totalBoost += accuracyBoost;
          reasons.push(`Above-projection trend: actual +${((avgRatio - 1) * 100).toFixed(0)}% vs proj over ${withActuals.length} games (beat proj ${beatsProjection}/${ratios.length})`);
        } else if (avgRatio <= 0.85 && underProjection >= Math.ceil(ratios.length * 0.6)) {
          const accuracyPenalty = Math.max(-2.5, (avgRatio - 1) * 5);
          totalBoost += accuracyPenalty;
          reasons.push(`Consistent underperformer: actual ${((1 - avgRatio) * 100).toFixed(0)}% below projection over ${withActuals.length} games (missed proj ${underProjection}/${ratios.length} times)`);
        } else if (avgRatio <= 0.92 && underProjection >= Math.ceil(ratios.length * 0.5)) {
          const accuracyPenalty = Math.max(-1.5, (avgRatio - 1) * 4);
          totalBoost += accuracyPenalty;
          reasons.push(`Below-projection trend: actual -${((1 - avgRatio) * 100).toFixed(0)}% vs proj over ${withActuals.length} games (missed proj ${underProjection}/${ratios.length})`);
        }

        if (withActuals.length >= 5) {
          const recentActuals = withActuals.slice(0, 5).map(h => Number(h.actualPoints!));
          const recentActualAvg = recentActuals.reduce((a, b) => a + b, 0) / recentActuals.length;
          if (recentActualAvg > proj * 1.12) {
            totalBoost += 1.0;
            reasons.push(`Hot actual form: avg ${recentActualAvg.toFixed(1)} actual pts over last 5 games vs ${proj.toFixed(1)} projected — trending above expectations`);
          } else if (recentActualAvg < proj * 0.80) {
            totalBoost -= 0.8;
            reasons.push(`Cold actual form: avg ${recentActualAvg.toFixed(1)} actual pts over last 5 games vs ${proj.toFixed(1)} projected — underperforming recently`);
          }
        }
      }
    }

    if (player.opponent) {
      if (projRank <= Math.ceil(posCount * 0.15) && posCount >= 5) {
        reasons.push(`Favorable spot vs ${player.opponent}: top ${Math.ceil((projRank / posCount) * 100)}% projection at ${primary}`);
      }
    }

    totalBoost = Math.round(totalBoost * 10) / 10;
    results.push({
      playerId: player.id,
      boostScore: totalBoost.toString(),
      boostReason: reasons.length > 0 ? reasons.join("; ") : "",
    });
  }

  return results;
}

export function computeCorrelationBonus(
  lineup: Player[],
  sport: string
): number {
  let bonus = 0;

  if (sport === "NFL") {
    const teamPlayers = new Map<string, Player[]>();
    for (const p of lineup) {
      const group = teamPlayers.get(p.team) || [];
      group.push(p);
      teamPlayers.set(p.team, group);
    }

    for (const [, group] of teamPlayers) {
      if (group.length < 2) continue;
      const hasQB = group.some(p => p.position.includes("QB"));
      if (hasQB) {
        const passCatchers = group.filter(p =>
          p.position.includes("WR") || p.position.includes("TE")
        );
        bonus += passCatchers.length * 3.0;

        const rbs = group.filter(p => p.position.includes("RB"));
        bonus += rbs.length * 1.0;
      }
    }

    const gameTeams = new Map<string, string[]>();
    for (const p of lineup) {
      const game = p.gameInfo || "";
      const teams = gameTeams.get(game) || [];
      if (!teams.includes(p.team)) teams.push(p.team);
      gameTeams.set(game, teams);
    }
    for (const [, teams] of gameTeams) {
      if (teams.length >= 2) {
        bonus += 1.5;
      }
    }
  }

  if (sport === "MLB") {
    const teamPlayers = new Map<string, Player[]>();
    for (const p of lineup) {
      const group = teamPlayers.get(p.team) || [];
      group.push(p);
      teamPlayers.set(p.team, group);
    }
    for (const [, group] of teamPlayers) {
      const batters = group.filter(p => !p.position.includes("P") || p.position.includes("SP"));
      if (batters.length >= 3) {
        bonus += (batters.length - 2) * 2.0;
      }
      if (batters.length >= 4) {
        bonus += 2.0;
      }
    }
  }

  if (sport === "NBA") {
    const gameGroups = new Map<string, Player[]>();
    for (const p of lineup) {
      const game = p.gameInfo || p.opponent || "";
      const group = gameGroups.get(game) || [];
      group.push(p);
      gameGroups.set(game, group);
    }
    for (const [, group] of gameGroups) {
      if (group.length >= 3) {
        bonus += (group.length - 2) * 1.5;
      }
    }
  }

  if (sport === "NHL") {
    const teamPlayers = new Map<string, Player[]>();
    for (const p of lineup) {
      const group = teamPlayers.get(p.team) || [];
      group.push(p);
      teamPlayers.set(p.team, group);
    }
    for (const [, group] of teamPlayers) {
      if (group.length >= 2) {
        const hasGoalie = group.some(p => p.position === "G");
        const skaters = group.filter(p => p.position !== "G");
        if (skaters.length >= 2) {
          bonus += (skaters.length - 1) * 1.5;
        }
        if (hasGoalie && skaters.length >= 1) {
          bonus += 1.0;
        }
      }
    }
  }

  return bonus;
}

export function applyCeilingMode(
  players: Player[],
  sport: string
): Player[] {
  const maxSalary = Math.max(...players.map(p => p.salary));
  const maxProj = Math.max(...players.map(p => Number(p.projectedPoints)));

  return players.map(p => {
    const proj = Number(p.projectedPoints);
    const salaryPct = p.salary / maxSalary;
    const projPct = proj / Math.max(1, maxProj);

    let ceilingMultiplier = 1.0;

    if (salaryPct > 0.7 && projPct > 0.7) {
      ceilingMultiplier += 0.08;
    }

    if (salaryPct < 0.3 && projPct > 0.15) {
      const upside = projPct / salaryPct;
      if (upside > 1.5) {
        ceilingMultiplier += 0.12;
      }
    }

    const boostVal = Number(p.boostScore || 0);
    if (boostVal > 2) {
      ceilingMultiplier += 0.05;
    }

    const nameHash = p.name.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    const pseudoRandom = ((Math.abs(nameHash) % 100) / 100);
    ceilingMultiplier += (pseudoRandom - 0.3) * 0.06;

    const ceilingProj = proj * Math.max(0.95, ceilingMultiplier);
    return { ...p, projectedPoints: ceilingProj.toString() };
  });
}

export function applyLeverageMode(
  players: (Player & { ownershipProjection?: number })[],
): Player[] {
  return players.map(p => {
    const proj = Number(p.projectedPoints);
    const own = p.ownershipProjection || 0;

    let leverageMultiplier = 1.0;

    if (own > 30) {
      leverageMultiplier -= (own - 30) * 0.005;
    } else if (own > 20) {
      leverageMultiplier -= (own - 20) * 0.003;
    }

    if (own < 8 && proj > 0) {
      const boostVal = Number(p.boostScore || 0);
      if (boostVal > 1) {
        leverageMultiplier += 0.06;
      }
    }

    if (own < 5 && proj > 0) {
      leverageMultiplier += 0.04;
    }

    leverageMultiplier = Math.max(0.7, Math.min(1.15, leverageMultiplier));
    return { ...p, projectedPoints: (proj * leverageMultiplier).toString() };
  });
}

export async function applyActualAdjustedProjections(
  players: Player[],
  sport: string
): Promise<Player[]> {
  if (players.length === 0) return players;

  const history = await storage.getPlayerHistoryBySport(sport, 5000);
  const historyByName = new Map<string, PlayerHistory[]>();
  for (const h of history) {
    const existing = historyByName.get(h.playerName) || [];
    existing.push(h);
    historyByName.set(h.playerName, existing);
  }

  return players.map(p => {
    const proj = Number(p.projectedPoints);
    if (proj <= 0) return p;

    const hist = historyByName.get(p.name);
    if (!hist || hist.length < 3) return p;

    const withActuals = hist
      .filter(h => h.actualPoints != null && Number(h.actualPoints) > 0)
      .slice(0, 10);

    if (withActuals.length < 3) return p;

    const recencyWeights = withActuals.map((_, i) => Math.pow(0.85, i));
    const totalWeight = recencyWeights.reduce((a, b) => a + b, 0);
    const weightedActualAvg = withActuals.reduce((sum, h, i) =>
      sum + Number(h.actualPoints!) * recencyWeights[i], 0
    ) / totalWeight;

    const gamesPlayed = withActuals.length;
    const blendWeight = Math.min(0.40, 0.15 + (gamesPlayed - 3) * 0.035);

    const adjustedProj = proj * (1 - blendWeight) + weightedActualAvg * blendWeight;
    const capped = Math.max(proj * 0.75, Math.min(proj * 1.30, adjustedProj));
    const rounded = Math.round(capped * 10) / 10;

    return { ...p, projectedPoints: rounded.toString() };
  });
}
