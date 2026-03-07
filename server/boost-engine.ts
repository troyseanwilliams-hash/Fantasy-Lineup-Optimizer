import type { Player, PlayerHistory } from "@shared/schema";
import { storage } from "./storage";

interface BoostResult {
  playerId: number;
  boostScore: string;
  boostReason: string;
}

export async function computeBoostScores(
  players: Player[],
  sport: string,
  slateId: number
): Promise<BoostResult[]> {
  if (players.length === 0) return [];

  const history = await storage.getPlayerHistoryBySport(sport, 2000);
  const historyByName = new Map<string, PlayerHistory[]>();
  for (const h of history) {
    const existing = historyByName.get(h.playerName) || [];
    existing.push(h);
    historyByName.set(h.playerName, existing);
  }

  const positionGroups = new Map<string, Player[]>();
  for (const p of players) {
    const primary = p.position.split("/")[0];
    const group = positionGroups.get(primary) || [];
    group.push(p);
    positionGroups.set(primary, group);
  }

  const positionAvgValue = new Map<string, number>();
  for (const [pos, group] of positionGroups) {
    const avgVal = group.reduce((sum, p) => sum + Number(p.projectedPoints) / Math.max(1, p.salary / 1000), 0) / group.length;
    positionAvgValue.set(pos, avgVal);
  }

  const maxSalary = Math.max(...players.map(p => p.salary));
  const maxProj = Math.max(...players.map(p => Number(p.projectedPoints)));

  const results: BoostResult[] = [];

  for (const player of players) {
    const proj = Number(player.projectedPoints);
    const salary = player.salary;
    if (proj <= 0) {
      results.push({ playerId: player.id, boostScore: "0", boostReason: "" });
      continue;
    }

    let totalBoost = 0;
    const reasons: string[] = [];

    const valuePerK = proj / (salary / 1000);
    const primary = player.position.split("/")[0];
    const posAvg = positionAvgValue.get(primary) || valuePerK;
    const valueRatio = valuePerK / Math.max(0.01, posAvg);
    if (valueRatio > 1.25) {
      const valuePts = Math.min(3.0, (valueRatio - 1) * 4);
      totalBoost += valuePts;
      reasons.push(`Value +${valuePts.toFixed(1)} (${valuePerK.toFixed(1)}x vs ${posAvg.toFixed(1)}x avg)`);
    } else if (valueRatio < 0.75) {
      const valuePenalty = Math.max(-2.0, (valueRatio - 1) * 3);
      totalBoost += valuePenalty;
      reasons.push(`Low value ${valuePenalty.toFixed(1)}`);
    }

    const playerHist = historyByName.get(player.name);
    if (playerHist && playerHist.length >= 3) {
      const recentHist = playerHist.slice(0, 10);
      const avgHistProj = recentHist.reduce((s, h) => s + Number(h.projectedPoints), 0) / recentHist.length;

      if (avgHistProj > 0) {
        const trendRatio = proj / avgHistProj;
        if (trendRatio > 1.10) {
          const trendBoost = Math.min(2.5, (trendRatio - 1) * 8);
          totalBoost += trendBoost;
          reasons.push(`Rising +${trendBoost.toFixed(1)} (proj ${proj.toFixed(1)} vs avg ${avgHistProj.toFixed(1)})`);
        } else if (trendRatio < 0.85) {
          const trendPenalty = Math.max(-2.0, (trendRatio - 1) * 6);
          totalBoost += trendPenalty;
          reasons.push(`Declining ${trendPenalty.toFixed(1)}`);
        }
      }

      const avgHistSalary = recentHist.reduce((s, h) => s + h.salary, 0) / recentHist.length;
      if (salary > avgHistSalary * 1.08 && proj <= avgHistProj * 1.02) {
        const overpriced = -1.0;
        totalBoost += overpriced;
        reasons.push(`Overpriced ${overpriced.toFixed(1)} (salary up, proj flat)`);
      } else if (salary < avgHistSalary * 0.92 && proj >= avgHistProj * 0.95) {
        const underpriced = 1.5;
        totalBoost += underpriced;
        reasons.push(`Underpriced +${underpriced.toFixed(1)} (salary down, proj stable)`);
      }

      if (recentHist.length >= 5) {
        const projValues = recentHist.slice(0, 5).map(h => Number(h.projectedPoints));
        const mean = projValues.reduce((a, b) => a + b, 0) / projValues.length;
        const variance = projValues.reduce((s, v) => s + (v - mean) ** 2, 0) / projValues.length;
        const cv = Math.sqrt(variance) / Math.max(1, mean);
        if (cv < 0.10 && mean > posAvg * 0.9) {
          totalBoost += 1.0;
          reasons.push(`Consistent +1.0 (CV ${(cv * 100).toFixed(0)}%)`);
        } else if (cv > 0.30) {
          totalBoost -= 0.5;
          reasons.push(`Volatile -0.5 (CV ${(cv * 100).toFixed(0)}%)`);
        }
      }
    }

    const salaryPct = salary / maxSalary;
    const projPct = proj / Math.max(1, maxProj);
    if (salaryPct < 0.20 && projPct > 0.25) {
      totalBoost += 1.5;
      reasons.push(`Bargain +1.5`);
    }

    if (sport === "NBA" || sport === "NHL") {
      const sameTeamPlayers = players.filter(p => p.team === player.team);
      const avgTeamProj = sameTeamPlayers.reduce((s, p) => s + Number(p.projectedPoints), 0) / sameTeamPlayers.length;
      if (avgTeamProj > (maxProj * 0.5)) {
        totalBoost += 0.5;
        reasons.push(`Strong team env +0.5`);
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
