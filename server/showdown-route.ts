import { Router } from "express";
import type { Request } from "express";
import { storage } from "./storage";
import { z } from "zod";
import solver from "javascript-lp-solver";
import { getShowdownConfig, getEffectiveSalary, getShowdownProjectedPoints, type Platform } from "@shared/platform-config";
import type { Player } from "@shared/schema";
import { getCachedSignals } from "./ai-scout";
import { runSimulations, detectStack } from "./simulation-engine";
import { applyOutperformerMode } from "./boost-engine";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

export const showdownRouter = Router();

showdownRouter.get("/api/showdown/slates", async (req, res) => {
  try {
    const sport            = (req.query.sport as string || "NBA").toUpperCase();
    const requestedPlatform = (req.query.platform as string || "draftkings").toLowerCase();

    const allSlates = await storage.getSlates();

    const graceCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const filtered = allSlates
      .filter(s =>
        s.sport    === sport &&
        s.platform === requestedPlatform &&
        s.isActive !== false &&
        new Date(s.startTime) > graceCutoff
      )
      .sort((a, b) => {
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return  1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      })
      .map(s => ({
        id:           s.id,
        sport:        s.sport,
        platform:     s.platform,
        gameType:     s.gameType  || "Classic",
        label:        s.label     || s.sport,
        startTime:    s.startTime,
        isMain:       s.isMain,
        gameCount:    s.gameCount    || 0,
        contestCount: s.contestCount || 0,
        salaryCap:    s.salaryCap    || 50000,
      }));

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
    if (slate.isActive === false) {
      return res.status(410).json({ message: "This slate has ended and is no longer available." });
    }

    const players = await storage.getPlayersBySlate(slateId);

    const gameMap: Record<string, Player[]> = {};
    for (const p of players) {
      const game = p.gameInfo || p.opponent || "Unknown";
      if (!gameMap[game]) gameMap[game] = [];
      gameMap[game].push(p);
    }

    res.json({
      slate: {
        id:           slate.id,
        sport:        slate.sport,
        platform:     slate.platform,
        gameType:     slate.gameType  || "Classic",
        label:        slate.label     || slate.sport,
        startTime:    slate.startTime,
        isMain:       slate.isMain,
        gameCount:    slate.gameCount    || 0,
        contestCount: slate.contestCount || 0,
        salaryCap:    slate.salaryCap    || 50000,
        isActive:     slate.isActive,
      },
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
  outperformerMode: z.boolean().default(false),
  useBoosts: z.boolean().default(false),
  globalMaxExposure: z.number().min(1).max(100).optional(),
  playerProjections: z.record(z.string(), z.number()).optional(),
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  perPlayerMaxExposure: z.record(z.string(), z.number()).optional(),
  ownershipOverrides: z.record(z.string(), z.number()).optional(),
  fadedPlayerIds: z.array(z.number()).default([]),
});

showdownRouter.post("/api/showdown/optimize", async (req, res) => {
  try {
    const input = showdownOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) {
      return res.status(410).json({ message: "This slate has ended. Please select a current slate." });
    }

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    // Hard excludes: OUT/Questionable + user-excluded
    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    const YAHOO_OUT = new Set(["INJ", "O", "OUT", "IR", "SUS", "NA"]);
    pool = pool.filter(p => {
      const s = (p.injuryStatus || "").toUpperCase().trim();
      return !YAHOO_OUT.has(s) && s !== "QUESTIONABLE" && s !== "GTD" && s !== "DOUBTFUL";
    });

    // Salary filter
    if (input.playerMinSalary !== undefined) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary !== undefined) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    if (input.gameFilter) {
      pool = pool.filter(p => p.gameInfo === input.gameFilter || p.opponent === input.gameFilter);
    }

    if (pool.length < config.rosterSize) {
      return res.status(400).json({ message: "Not enough eligible players for a showdown lineup." });
    }

    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, proj] of Object.entries(input.playerProjections)) {
        projOverrides[Number(pid)] = proj;
      }
    }

    const scoutSignals = getCachedSignals(input.sport);
    const scoutMap = new Map<string, number>();
    for (const sig of scoutSignals) {
      const key = sig.player_name.toLowerCase();
      if (!scoutMap.has(key) || Math.abs(sig.boost_weight) > Math.abs(scoutMap.get(key)!)) {
        scoutMap.set(key, sig.boost_weight);
      }
    }

    if (input.outperformerMode) {
      pool = await applyOutperformerMode(pool, input.sport);
    }

    const FADE_MULTIPLIER = 0.5;
    const fadedSet = new Set(input.fadedPlayerIds);

    function getEffectiveProjection(p: Player): number {
      const hasCustom = projOverrides[p.id] !== undefined;
      let base = projOverrides[p.id] ?? Number(p.projectedPoints) ?? 0;
      if (!hasCustom) {
        const scoutWeight = scoutMap.get(p.name.toLowerCase());
        if (scoutWeight !== undefined) {
          const pct = Math.max(-0.15, Math.min(0.15, scoutWeight * 0.015));
          base = Math.round(base * (1 + pct) * 10) / 10;
        }
      }
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

const showdownSimSchema = z.object({
  slateId: z.number(),
  platform: z.enum(["draftkings", "fanduel", "yahoo"]).default("draftkings"),
  sport: z.string().default("NBA"),
  lockedCaptainId: z.number().optional(),
  lockedFlexIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  lineupCount: z.number().min(1).max(1000).default(20),
  numSims: z.number().min(50).max(1000).default(200),
  gameFilter: z.string().optional(),
  projectionMode: z.enum(["balanced", "ceiling"]).default("balanced"),
  leverageMode: z.boolean().default(false),
  outperformerMode: z.boolean().default(false),
  useBoosts: z.boolean().default(false),
  globalMaxExposure: z.number().min(1).max(100).optional(),
  playerProjections: z.record(z.string(), z.number()).optional(),
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  perPlayerMaxExposure: z.record(z.string(), z.number()).optional(),
  ownershipOverrides: z.record(z.string(), z.number()).optional(),
  fadedPlayerIds: z.array(z.number()).default([]),
});

showdownRouter.post("/api/showdown/optimize/sim", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);
  const userId = getSessionUserId(req)!;

  try {
    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");

    if (tier === "free") {
      return res.status(403).json({ message: "Sim Mode requires a Sharpshooter or Champion subscription.", requiresUpgrade: true });
    }

    const maxSims = isAdmin ? 1000 : tier === "pro" ? 500 : 200;
    const maxLineups = isAdmin ? 2000 : tier === "pro" ? 1000 : 400;

    const input = showdownSimSchema.parse(req.body);
    input.numSims = Math.min(input.numSims, maxSims);
    input.lineupCount = Math.min(input.lineupCount, maxLineups);

    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) {
      return res.status(410).json({ message: "This slate has ended. Please select a current slate." });
    }

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    const YAHOO_OUT = new Set(["INJ", "O", "OUT", "IR", "SUS", "NA"]);
    pool = pool.filter(p => {
      const s = (p.injuryStatus || "").toUpperCase().trim();
      return !YAHOO_OUT.has(s) && s !== "QUESTIONABLE" && s !== "GTD" && s !== "DOUBTFUL";
    });

    if (input.playerMinSalary !== undefined) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary !== undefined) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    if (input.gameFilter) {
      pool = pool.filter(p => p.gameInfo === input.gameFilter || p.opponent === input.gameFilter);
    }

    if (pool.length < config.rosterSize) {
      return res.status(400).json({ message: "Not enough eligible players for a showdown lineup." });
    }

    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, proj] of Object.entries(input.playerProjections)) {
        projOverrides[Number(pid)] = proj;
      }
    }

    const scoutSignals = getCachedSignals(input.sport);
    const scoutMap = new Map<string, number>();
    for (const sig of scoutSignals) {
      const key = sig.player_name.toLowerCase();
      if (!scoutMap.has(key) || Math.abs(sig.boost_weight) > Math.abs(scoutMap.get(key)!)) {
        scoutMap.set(key, sig.boost_weight);
      }
    }

    if (input.outperformerMode) {
      pool = await applyOutperformerMode(pool, input.sport);
    }

    const FADE_MULTIPLIER = 0.5;
    const fadedSet = new Set(input.fadedPlayerIds);

    for (const p of pool) {
      if (projOverrides[p.id] !== undefined) continue;
      let base = Number(p.projectedPoints) ?? 0;
      const scoutWeight = scoutMap.get(p.name.toLowerCase());
      if (scoutWeight !== undefined) {
        const pct = Math.max(-0.15, Math.min(0.15, scoutWeight * 0.015));
        base = Math.round(base * (1 + pct) * 10) / 10;
      }
      if (input.projectionMode === "ceiling") {
        base = base * (base >= 25 ? 1.12 : base >= 15 ? 1.05 : 1.0);
      }
      if (input.leverageMode) {
        const own = (input.ownershipOverrides?.[String(p.id)] ?? Number((p as any).ownershipProjection) ?? 20) / 100;
        base = base * (1 - own * 0.08);
      }
      if (fadedSet.has(p.id)) base *= FADE_MULTIPLIER;
      projOverrides[p.id] = Math.max(0, base);
    }

    const startTime = Date.now();
    const MAX_RUNTIME_MS = 30_000;

    console.log(`[ShowdownSim] Starting ${input.numSims} sims for ${input.sport} slate ${input.slateId}, pool: ${pool.length} players, requesting ${input.lineupCount} lineups`);

    const sims = runSimulations(pool, input.sport, input.numSims, projOverrides);

    const flexCount = config.rosterSize - 1;

    const lineupMap = new Map<string, {
      captain: any;
      flexPlayers: any[];
      frequency: number;
    }>();

    for (let i = 0; i < sims.length; i++) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[ShowdownSim] Time cap reached after ${i} sims`);
        break;
      }

      const sim = sims[i];

      const simPool = pool.map(p => ({
        ...p,
        projectedPoints: (sim.projections[p.id] ?? projOverrides[p.id] ?? Number(p.projectedPoints) ?? 0).toString(),
      }));

      let captainId: number;
      if (input.lockedCaptainId) {
        captainId = input.lockedCaptainId;
      } else {
        const sorted = [...simPool].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
        captainId = sorted[0].id;
      }

      const captain = simPool.find(p => p.id === captainId);
      if (!captain) continue;

      const captainSalary = getEffectiveSalary(captain.salary, true, config);
      const remainingSalary = config.salaryCap - captainSalary;

      const flexPool = simPool.filter(p => {
        if (p.id === captainId) return false;
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
          projectedPoints: Number(p.projectedPoints),
          salary: p.salary,
          rosterSize: 1,
          [`bound_${vName}`]: 1,
        };
        model.ints[vName] = 1;
        model.constraints[`bound_${vName}`] = { max: 1 };

        if (input.lockedFlexIds.includes(p.id)) {
          model.constraints[`lock_${vName}`] = { equal: 1 };
          model.variables[vName][`lock_${vName}`] = 1;
        }
      });

      const result: any = solver.Solve(model);
      if (!result.feasible) continue;

      const flexIds = Object.keys(result)
        .filter(k => k.startsWith("p") && result[k] > 0.5)
        .map(k => Number(k.substring(1)));

      const flexPlayers = flexPool.filter(p => flexIds.includes(p.id));
      if (flexPlayers.length !== flexCount) continue;

      const key = [captainId, ...flexIds.sort()].join("-");

      const existing = lineupMap.get(key);
      if (existing) {
        existing.frequency++;
      } else {
        const captainObj = pool.find(p => p.id === captainId)!;
        const captainProj = getShowdownProjectedPoints(projOverrides[captainId] ?? Number(captainObj.projectedPoints), true, config);
        lineupMap.set(key, {
          captain: {
            ...captainObj,
            effectiveSalary: captainSalary,
            effectiveProjection: captainProj,
            isCaptain: true,
          },
          flexPlayers: flexPlayers.map(fp => {
            const orig = pool.find(p => p.id === fp.id)!;
            return {
              ...orig,
              effectiveSalary: orig.salary,
              effectiveProjection: projOverrides[orig.id] ?? Number(orig.projectedPoints),
              isCaptain: false,
            };
          }),
          frequency: 1,
        });
      }
    }

    if (lineupMap.size === 0) {
      return res.status(200).json({
        lineups: [],
        message: "No feasible lineups found in simulations. Try relaxing constraints.",
        simsRun: sims.length,
        config: {
          captainLabel: config.captainLabel,
          flexLabel: config.flexLabel,
          captainMultiplier: config.captainMultiplier,
          salaryCap: config.salaryCap,
          rosterSize: config.rosterSize,
        },
      });
    }

    const uniqueLineups = Array.from(lineupMap.entries()).map(([key, data]) => {
      const allPlayerIds = [data.captain.id, ...data.flexPlayers.map((p: any) => p.id)];

      const allSimScores = sims.map(sim => {
        let total = 0;
        const captProj = sim.projections[data.captain.id] ?? projOverrides[data.captain.id] ?? Number(data.captain.projectedPoints);
        total += getShowdownProjectedPoints(captProj, true, config);
        for (const fp of data.flexPlayers) {
          total += sim.projections[fp.id] ?? projOverrides[fp.id] ?? Number(fp.projectedPoints);
        }
        return total;
      }).sort((a, b) => a - b);

      const n = allSimScores.length;
      const avg = allSimScores.reduce((a, b) => a + b, 0) / n;
      const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
      const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
      const med = allSimScores[Math.floor(n * 0.50)] ?? avg;

      const composite = avg * 0.35 + p75 * 0.35 + p90 * 0.20 + (data.frequency / sims.length) * 100 * 0.10;

      const totalSalary = data.captain.effectiveSalary + data.flexPlayers.reduce((s: number, p: any) => s + p.effectiveSalary, 0);
      const totalProj = data.captain.effectiveProjection + data.flexPlayers.reduce((s: number, p: any) => s + p.effectiveProjection, 0);

      const allLineupPlayers = [data.captain, ...data.flexPlayers];
      const stack = detectStack(allLineupPlayers as Player[]);

      return {
        captain: data.captain,
        flexPlayers: data.flexPlayers,
        totalSalary,
        totalProjectedPoints: Math.round(totalProj * 100) / 100,
        key,
        frequency: data.frequency,
        freqPct: Math.round((data.frequency / sims.length) * 1000) / 10,
        avgSimScore: Math.round(avg * 10) / 10,
        medianScore: Math.round(med * 10) / 10,
        p75Score: Math.round(p75 * 10) / 10,
        p90Score: Math.round(p90 * 10) / 10,
        compositeScore: Math.round(composite * 10) / 10,
        stackedGame: stack.game,
        stackCount: stack.count,
        stackTeams: stack.teams,
      };
    });

    uniqueLineups.sort((a, b) => b.compositeScore - a.compositeScore);

    const playerAppearances: Record<number, number> = {};
    const selected: typeof uniqueLineups = [];

    for (const lu of uniqueLineups) {
      if (selected.length >= input.lineupCount) break;

      let violatesExposure = false;
      if (input.globalMaxExposure !== undefined && selected.length > 0) {
        const allIds = [lu.captain.id, ...lu.flexPlayers.map((p: any) => p.id)];
        for (const pid of allIds) {
          const appearances = (playerAppearances[pid] || 0) + 1;
          const pct = (appearances / (selected.length + 1)) * 100;
          if (pct > input.globalMaxExposure) { violatesExposure = true; break; }
        }
      }
      if (violatesExposure) continue;

      selected.push(lu);
      const allIds = [lu.captain.id, ...lu.flexPlayers.map((p: any) => p.id)];
      for (const pid of allIds) {
        playerAppearances[pid] = (playerAppearances[pid] || 0) + 1;
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[ShowdownSim] Completed: ${sims.length} sims, ${lineupMap.size} unique lineups, selected ${selected.length}, ${elapsedMs}ms`);

    res.json({
      lineups: selected,
      simsRun: sims.length,
      uniqueCount: lineupMap.size,
      elapsedMs,
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
    console.error("Showdown sim error:", err);
    res.status(500).json({ message: "Showdown sim optimizer failed" });
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
