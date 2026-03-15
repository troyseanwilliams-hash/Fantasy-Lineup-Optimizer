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
    const requestedPlatform = (req.query.platform as string || "draftkings").toLowerCase();
    const filtered = allSlates.filter(s =>
      s.sport === sport &&
      s.platform === requestedPlatform
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
  platform: z.enum(["draftkings", "fanduel", "yahoo"]).default("draftkings"),
  sport: z.string().default("NBA"),
  lockedCaptainId: z.number().optional(),
  lockedFlexIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  lineupCount: z.number().min(1).max(20).default(1),
  gameFilter: z.string().optional(),
  projectionMode: z.enum(["balanced", "ceiling"]).default("balanced"),
  leverageMode: z.boolean().default(false),
  useBoosts: z.boolean().default(false),
  globalMaxExposure: z.number().min(1).max(100).optional(),
  // Merged projection overrides (custom + scout boosts pre-merged by client)
  playerProjections: z.record(z.string(), z.number()).optional(),
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  // Per-player settings (new)
  perPlayerMaxExposure: z.record(z.string(), z.number()).optional(),
  ownershipOverrides: z.record(z.string(), z.number()).optional(),
  fadedPlayerIds: z.array(z.number()).default([]),
});

showdownRouter.post("/api/showdown/optimize", async (req, res) => {
  try {
    const input = showdownOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    // Hard excludes: OUT/Questionable + user-excluded
    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    pool = pool.filter(p => p.injuryStatus !== "OUT" && p.injuryStatus !== "Questionable");

    // Salary filter
    if (input.playerMinSalary !== undefined) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary !== undefined) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    if (input.gameFilter) {
      pool = pool.filter(p => p.gameInfo === input.gameFilter || p.opponent === input.gameFilter);
    }

    if (pool.length < config.rosterSize) {
      return res.status(400).json({ message: "Not enough eligible players for a showdown lineup." });
    }

    // Build an effective projection lookup (already merged by client: custom + scout)
    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, proj] of Object.entries(input.playerProjections)) {
        projOverrides[Number(pid)] = proj;
      }
    }

    // Faded players get a downweight factor applied to their projection
    const FADE_MULTIPLIER = 0.5;
    const fadedSet = new Set(input.fadedPlayerIds);

    function getEffectiveProjection(p: Player): number {
      const base = projOverrides[p.id] ?? Number(p.projectedPoints) ?? 0;
      // Ceiling mode: scale by variance proxy (boost above-average projections)
      let proj = input.projectionMode === "ceiling"
        ? base * (base >= 25 ? 1.12 : base >= 15 ? 1.05 : 1.0)
        : base;
      // Leverage mode: penalise high-ownership players slightly
      if (input.leverageMode) {
        const own = (input.ownershipOverrides?.[String(p.id)] ?? Number((p as any).ownershipProjection) ?? 20) / 100;
        proj = proj * (1 - own * 0.08); // up to ~8% haircut at 100% ownership
      }
      // Faded players
      if (fadedSet.has(p.id)) proj *= FADE_MULTIPLIER;
      return Math.max(0, proj);
    }

    const flexCount = config.rosterSize - 1;
    const lineups: any[] = [];
    const usedKeys = new Set<string>();

    // Tracker for per-player exposure across generated lineups
    const playerAppearances: Record<number, number> = {};

    function isPlayerCapped(playerId: number, tentativeTotal: number): boolean {
      // Global cap
      if (input.globalMaxExposure !== undefined) {
        const pct = ((playerAppearances[playerId] || 0) + 1) / tentativeTotal * 100;
        if (pct > input.globalMaxExposure) return true;
      }
      // Per-player cap
      const perCap = input.perPlayerMaxExposure?.[String(playerId)];
      if (perCap !== undefined) {
        const pct = ((playerAppearances[playerId] || 0) + 1) / tentativeTotal * 100;
        if (pct > perCap) return true;
      }
      return false;
    }

    function solveShowdown(
      captainId: number,
      lockedFlexIds: number[],
      excludeFromResult: Set<string>,
      targetLineupIndex: number,
    ): any | null {
      const captain = pool.find(p => p.id === captainId);
      if (!captain) return null;

      const captainSalary = getEffectiveSalary(captain.salary, true, config);
      const captainProj   = getShowdownProjectedPoints(getEffectiveProjection(captain), true, config);
      const remainingSalary = config.salaryCap - captainSalary;

      // Flex pool: exclude captain, hard-excluded, and exposure-capped players
      const flexPool = pool.filter(p => {
        if (p.id === captainId) return false;
        if (input.globalMaxExposure !== undefined && isPlayerCapped(p.id, targetLineupIndex)) return false;
        if (input.perPlayerMaxExposure?.[String(p.id)] !== undefined && isPlayerCapped(p.id, targetLineupIndex)) return false;
        return true;
      });

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
          projectedPoints: getEffectiveProjection(p),
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
      const totalProj   = captainProj   + flexPlayers.reduce((s, p) => s + getEffectiveProjection(p), 0);

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
          effectiveProjection: getEffectiveProjection(p),
          isCaptain: false,
        })),
        totalSalary,
        totalProjectedPoints: Math.round(totalProj * 100) / 100,
        key,
      };
    }

    function recordAppearances(lineup: any) {
      playerAppearances[lineup.captain.id] = (playerAppearances[lineup.captain.id] || 0) + 1;
      for (const p of lineup.flexPlayers) {
        playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
      }
    }

    if (input.lockedCaptainId) {
      for (let i = 0; i < input.lineupCount && i < 20; i++) {
        const result = solveShowdown(input.lockedCaptainId, input.lockedFlexIds, usedKeys, i + 1);
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
          recordAppearances(result);
        } else {
          break;
        }
      }
    } else {
      const candidates = [...pool]
        .sort((a, b) => getEffectiveProjection(b) - getEffectiveProjection(a))
        .slice(0, Math.min(pool.length, 30));

      for (const candidate of candidates) {
        if (lineups.length >= input.lineupCount) break;
        const result = solveShowdown(candidate.id, input.lockedFlexIds, usedKeys, lineups.length + 1);
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
          recordAppearances(result);
        }
      }

      lineups.sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);
      lineups.splice(input.lineupCount);
    }

    if (lineups.length === 0) {
      return res.status(400).json({ message: "Could not generate any feasible showdown lineups." });
    }

    res.json({
      lineups,
      config: {
        captainLabel: config.captainLabel,
        flexLabel: config.flexLabel,
        captainMultiplier: config.captainMultiplier,
        salaryCap: config.salaryCap,
        rosterSize: config.rosterSize,
      },
    });
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
      platform: (["draftkings","fanduel","yahoo"].includes(platform) ? platform : "draftkings") as string,
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
