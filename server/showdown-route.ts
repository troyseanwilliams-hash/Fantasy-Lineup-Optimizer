import { Router } from "express";
import type { Request } from "express";
import { storage } from "./storage";
import { z } from "zod";
import solver from "javascript-lp-solver";
import { getShowdownConfig, getEffectiveSalary, getShowdownProjectedPoints, type Platform } from "@shared/platform-config";
import type { Player } from "@shared/schema";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

export const showdownRouter = Router();

showdownRouter.get("/api/showdown/slates", async (req, res) => {
  try {
    const sport = (req.query.sport as string || "NBA").toUpperCase();
    const allSlates = await storage.getSlates();
    const filtered = allSlates.filter(s =>
      s.sport === sport &&
      s.platform === "draftkings"
    );
    res.json(filtered);
  } catch (err) {
    console.error("Showdown slates error:", err);
    res.status(500).json({ message: "Failed to fetch showdown slates" });
  }
});

showdownRouter.get("/api/showdown/players/:slateId", async (req, res) => {
  try {
    const slateId = Number(req.params.slateId);
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });

    const players = await storage.getPlayersBySlate(slateId);

    const gameMap: Record<string, Player[]> = {};
    for (const p of players) {
      const game = p.gameInfo || p.opponent || "Unknown";
      if (!gameMap[game]) gameMap[game] = [];
      gameMap[game].push(p);
    }

    res.json({
      slate: { id: slate.id, sport: slate.sport, platform: slate.platform, startTime: slate.startTime },
      games: gameMap,
      players,
    });
  } catch (err) {
    console.error("Showdown players error:", err);
    res.status(500).json({ message: "Failed to fetch showdown players" });
  }
});

const showdownOptimizeSchema = z.object({
  slateId: z.number(),
  platform: z.enum(["draftkings", "fanduel"]).default("draftkings"),
  sport: z.string().default("NBA"),
  lockedCaptainId: z.number().optional(),
  lockedFlexIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  lineupCount: z.number().min(1).max(20).default(1),
  gameFilter: z.string().optional(),
});

showdownRouter.post("/api/showdown/optimize", async (req, res) => {
  try {
    const input = showdownOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    pool = pool.filter(p => p.injuryStatus !== "OUT" && p.injuryStatus !== "Questionable");

    if (input.gameFilter) {
      pool = pool.filter(p => p.gameInfo === input.gameFilter || p.opponent === input.gameFilter);
    }

    if (pool.length < config.rosterSize) {
      return res.status(400).json({ message: "Not enough eligible players for a showdown lineup." });
    }

    const flexCount = config.rosterSize - 1;
    const lineups: any[] = [];
    const usedKeys = new Set<string>();

    function solveShowdown(captainId: number, lockedFlexIds: number[], excludeFromResult: Set<string>): any | null {
      const captain = pool.find(p => p.id === captainId);
      if (!captain) return null;

      const captainSalary = getEffectiveSalary(captain.salary, true, config);
      const captainProj = getShowdownProjectedPoints(Number(captain.projectedPoints), true, config);
      const remainingSalary = config.salaryCap - captainSalary;

      const flexPool = pool.filter(p => p.id !== captainId);

      const model: any = {
        optimize: "projectedPoints",
        opType: "max",
        constraints: {
          salary: { max: remainingSalary },
          rosterSize: { equal: flexCount },
        },
        variables: {},
        ints: {},
      };

      flexPool.forEach(p => {
        const vName = `p${p.id}`;
        model.variables[vName] = {
          projectedPoints: Number(p.projectedPoints),
          salary: p.salary,
          rosterSize: 1,
          [`bound_${vName}`]: 1,
        };
        model.ints[vName] = 1;
        model.constraints[`bound_${vName}`] = { max: 1 };

        if (lockedFlexIds.includes(p.id)) {
          model.constraints[`lock_${vName}`] = { equal: 1 };
          model.variables[vName][`lock_${vName}`] = 1;
        }
      });

      const result: any = solver.Solve(model);
      if (!result.feasible) return null;

      const flexIds = Object.keys(result)
        .filter(k => k.startsWith("p") && result[k] > 0.5)
        .map(k => Number(k.substring(1)));

      const flexPlayers = flexPool.filter(p => flexIds.includes(p.id));
      if (flexPlayers.length !== flexCount) return null;

      const key = [captainId, ...flexIds.sort()].join("-");
      if (excludeFromResult.has(key)) return null;

      const totalSalary = captainSalary + flexPlayers.reduce((s, p) => s + p.salary, 0);
      const totalProj = captainProj + flexPlayers.reduce((s, p) => s + Number(p.projectedPoints), 0);

      return {
        captain: {
          ...captain,
          effectiveSalary: captainSalary,
          effectiveProjection: captainProj,
          isCaptain: true,
        },
        flexPlayers: flexPlayers.map(p => ({
          ...p,
          effectiveSalary: p.salary,
          effectiveProjection: Number(p.projectedPoints),
          isCaptain: false,
        })),
        totalSalary,
        totalProjectedPoints: Math.round(totalProj * 100) / 100,
        key,
      };
    }

    if (input.lockedCaptainId) {
      for (let i = 0; i < input.lineupCount && i < 20; i++) {
        const result = solveShowdown(input.lockedCaptainId, input.lockedFlexIds, usedKeys);
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
          if (lineups.length < input.lineupCount) {
            input.excludedPlayerIds.push(
              result.flexPlayers[result.flexPlayers.length - 1].id
            );
            pool = pool.filter(p => !input.excludedPlayerIds.includes(p.id));
          }
        } else {
          break;
        }
      }
    } else {
      const candidates = [...pool]
        .sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints))
        .slice(0, Math.min(pool.length, 30));

      for (const candidate of candidates) {
        if (lineups.length >= input.lineupCount) break;
        const result = solveShowdown(candidate.id, input.lockedFlexIds, usedKeys);
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
        }
      }

      lineups.sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);
      lineups.splice(input.lineupCount);
    }

    if (lineups.length === 0) {
      return res.status(400).json({ message: "Could not generate any feasible showdown lineups." });
    }

    res.json({ lineups, config: { captainLabel: config.captainLabel, flexLabel: config.flexLabel, captainMultiplier: config.captainMultiplier, salaryCap: config.salaryCap, rosterSize: config.rosterSize } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0].message });
    }
    console.error("Showdown optimize error:", err);
    res.status(500).json({ message: "Showdown optimizer failed" });
  }
});

showdownRouter.post("/api/showdown/save", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);
  const userId = getSessionUserId(req)!;

  try {
    const { slateId, sport, platform, captainId, flexIds, totalSalary, totalProjectedPoints, playerSnapshot } = req.body;

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");

    const maxPerSport = isAdmin ? 500 : tier === "pro" ? 300 : tier === "star" ? 20 : 1;
    const sportCount = await storage.getLineupCountBySport(userId, sport);
    if (sportCount >= maxPerSport) {
      return res.status(403).json({
        message: `You've reached the maximum of ${maxPerSport} saved lineups per sport.`,
        requiresUpgrade: !isAdmin && tier !== "pro",
      });
    }

    const allPlayerIds = [captainId, ...flexIds];
    const lineup = await storage.createLineup({
      userId,
      slateId,
      sport,
      platform: platform || "draftkings",
      playerIds: allPlayerIds,
      totalSalary: totalSalary.toString(),
      totalProjectedPoints: totalProjectedPoints.toString(),
      status: "active",
      playerSnapshot: playerSnapshot || null,
    });

    res.status(201).json(lineup);
  } catch (err) {
    console.error("Showdown save error:", err);
    res.status(500).json({ message: "Failed to save showdown lineup" });
  }
});
