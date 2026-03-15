/**
 * EliteLineup.com — Optimizer Routes
 *
 * Changes vs previous version
 * ────────────────────────────
 * 1. All-slates-of-day: /api/slates now filters is_active=true, sorts main first.
 * 2. projectedPointsFloor: adds a `min` constraint on the projectedPoints row
 *    in the LP model. The solver returns infeasible if the pool can't hit the
 *    floor → lineup is skipped → fewer than requested lineups (or 0) returned.
 *    0 lineups is a 200, not a 400, with a human-readable message.
 */

import { Router } from "express";
import type { Request } from "express";
import { storage } from "./storage";
import { z } from "zod";
import solver from "javascript-lp-solver";
import { getPlatformConfig, assignPlayersToSlots, type Platform, type Sport } from "@shared/platform-config";
import type { Player, Slate } from "@shared/schema";
import {
  runSimulations,
  scoreLineupsAcrossSims,
  detectStack,
  type SimResult,
} from "./simulation-engine";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

export const optimizerRouter = Router();

// ── GET /api/slates ───────────────────────────────────────────────────────────
// Returns all active slates for the day, sorted main-first then by start time.
// Deactivated slates (is_active = false) are never returned.

optimizerRouter.get("/api/slates", async (req, res) => {
  try {
    const allSlates = await storage.getSlates();
    const active = allSlates
      .filter(s => s.isActive !== false)
      .sort((a, b) => {
        // Main slate first within each sport+platform group
        if (a.sport === b.sport && a.platform === b.platform) {
          if (a.isMain && !b.isMain) return -1;
          if (!a.isMain && b.isMain) return 1;
        }
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      })
      .map(s => ({
        ...s,
        // Expose label and metadata from dk_client so the UI can show rich names
        label:        (s as any).label        ?? s.name,
        gameType:     (s as any).gameType     ?? "Classic",
        gameCount:    (s as any).gameCount    ?? 0,
        contestCount: (s as any).contestCount ?? 0,
      }));
    res.json(active);
  } catch (err) {
    console.error("Slates error:", err);
    res.status(500).json({ message: "Failed to fetch slates" });
  }
});

// ── GET /api/slates/:id/players ───────────────────────────────────────────────

optimizerRouter.get("/api/slates/:id/players", async (req, res) => {
  try {
    const slateId = Number(req.params.id);
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });
    const players = await storage.getPlayersBySlate(slateId);
    res.json(players);
  } catch (err) {
    console.error("Players error:", err);
    res.status(500).json({ message: "Failed to fetch players" });
  }
});

// ── Shared schema fields ──────────────────────────────────────────────────────

const baseOptimizeFields = {
  slateId:              z.number(),
  platform:             z.enum(["draftkings", "fanduel", "yahoo"]).default("draftkings"),
  lockedPlayerIds:      z.array(z.number()).default([]),
  excludedPlayerIds:    z.array(z.number()).default([]),
  playerProjections:    z.record(z.string(), z.number()).optional(),
  playerMinSalary:      z.number().optional(),
  playerMaxSalary:      z.number().optional(),
  projectedPointsFloor: z.number().min(0).optional(),
  // Cash = safe high-floor lineups; GPP = differentiated high-ceiling lineups
  contestType:          z.enum(["cash", "gpp"]).default("cash"),
};

const optimizeSchema = z.object({
  ...baseOptimizeFields,
});

const proOptimizeSchema = z.object({
  ...baseOptimizeFields,
  lineupCount:       z.number().min(1).max(150).default(1),
  useBoosts:         z.boolean().default(false),
  leverageMode:      z.boolean().default(false),
  projectionMode:    z.enum(["balanced", "ceiling"]).default("balanced"),
  exposureLimits:    z.record(z.string(), z.number()).optional(),
  globalMaxExposure: z.number().min(1).max(100).optional(),
});

// ── Simulation optimizer schema ────────────────────────────────────────────
// Uses Monte Carlo game-script sampling instead of fixed median projections.
const simOptimizeSchema = z.object({
  ...baseOptimizeFields,
  lineupCount:        z.number().min(1).max(150).default(20),
  numSims:            z.number().min(50).max(1000).default(200),
  correlationStrength:z.number().min(0).max(1).default(1.0),  // 0 = no correlation, 1 = full
  globalMaxExposure:  z.number().min(1).max(100).optional(),
  enforceGameStack:   z.boolean().default(false),  // force at least 2 players from same game
  minStackSize:       z.number().min(2).max(5).default(2),
});

// ── Shared LP solve helper ────────────────────────────────────────────────────

interface SolveOptions {
  pool:                 Player[];
  config:               ReturnType<typeof getPlatformConfig>;
  sport:                Sport;
  lockedPlayerIds:      number[];
  projOverrides:        Record<number, number>;
  projectedPointsFloor?: number;
  leverageMode:         boolean;
  projectionMode:       "balanced" | "ceiling";
  contestType:          "cash" | "gpp";
  ownershipOverrides?:  Record<string, number>;
  excludeKeys:          Set<string>;
  playerAppearances:    Record<number, number>;
  totalLineupsSoFar:    number;
  globalMaxExposure?:   number;
  perPlayerExposure?:   Record<string, number>;
}

function getEffectiveProjection(
  p: Player,
  projOverrides: Record<number, number>,
  projectionMode: "balanced" | "ceiling",
  leverageMode: boolean,
  contestType: "cash" | "gpp",
  ownershipOverrides?: Record<string, number>,
): number {
  const base = projOverrides[p.id] ?? Number(p.projectedPoints) ?? 0;
  let proj = base;

  if (contestType === "cash") {
    // Cash: reward consistency. Players with low variance / high floor get a
    // small bonus; this pulls the solver toward safe, predictable picks.
    // We approximate floor as FPPG — if projected >= FPPG they're a safe play.
    const fppg = Number((p as any).fppg) || base;
    const floorRatio = fppg > 0 ? base / fppg : 1;
    if (floorRatio >= 1.0) {
      proj = base * 1.03; // slight nudge for high-floor plays
    }
    // Ignore ceiling/projection mode for cash — keep it balanced
  } else {
    // GPP: apply ceiling multiplier to reward upside
    proj = projectionMode === "ceiling"
      ? base * (base >= 30 ? 1.12 : base >= 20 ? 1.06 : 1.02)
      : base;
  }

  if (leverageMode) {
    // Leverage: down-weight chalk (high ownership) players
    const own = Number(ownershipOverrides?.[String(p.id)] ?? (p as any).ownershipProjection ?? 20) / 100;
    // GPP leverage is more aggressive than cash leverage
    const leverageFactor = contestType === "gpp" ? 0.12 : 0.05;
    proj = proj * (1 - own * leverageFactor);
  }

  return Math.max(0, proj);
}

function solveLineup(opts: SolveOptions): { lineup: Player[]; totalSalary: number; totalProjectedPoints: number; key: string } | null {
  const { pool, config, sport, lockedPlayerIds, projOverrides, projectedPointsFloor,
          leverageMode, projectionMode, contestType, ownershipOverrides, excludeKeys,
          playerAppearances, totalLineupsSoFar, globalMaxExposure, perPlayerExposure } = opts;

  const model: any = {
    optimize: "projectedPoints",
    opType:   "max",
    constraints: {
      salary:     { max: config.salaryCap },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints:      {},
  };

  // ── Floor constraint ───────────────────────────────────────────────────────
  // Adding `projectedPoints: { min: floor }` as a named constraint forces the
  // solver to return infeasible if the selected players can't collectively
  // reach the floor. This naturally produces 0 results when the floor is too high.
  if (projectedPointsFloor && projectedPointsFloor > 0) {
    model.constraints.projectedPoints = { min: projectedPointsFloor };
  }

  // Position constraints
  const positionCounts: Record<string, number> = {};
  config.slots.forEach(slot => {
    const pos = slot.replace(/\d+$/, "");
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
  });
  Object.entries(positionCounts).forEach(([pos, count]) => {
    model.constraints[`pos_${pos}`] = { equal: count };
  });

  const eligiblePool = pool.filter(p => {
    // Exposure cap
    if (globalMaxExposure !== undefined && totalLineupsSoFar > 0) {
      const pct = ((playerAppearances[p.id] || 0) + 1) / (totalLineupsSoFar + 1) * 100;
      if (pct > globalMaxExposure) return false;
    }
    if (perPlayerExposure?.[String(p.id)] !== undefined && totalLineupsSoFar > 0) {
      const cap = perPlayerExposure[String(p.id)];
      const pct = ((playerAppearances[p.id] || 0) + 1) / (totalLineupsSoFar + 1) * 100;
      if (pct > cap) return false;
    }
    return true;
  });

  eligiblePool.forEach(p => {
    const effProj = getEffectiveProjection(p, projOverrides, projectionMode, leverageMode, contestType, ownershipOverrides);
    const vName = `p${p.id}`;

    model.variables[vName] = {
      projectedPoints: effProj,
      salary:          p.salary,
      rosterSize:      1,
      [`bound_${vName}`]: 1,
    };

    // Position membership
    const positions = p.position.split("/");
    positions.forEach(pos => {
      if (model.constraints[`pos_${pos}`]) {
        model.variables[vName][`pos_${pos}`] = 1;
      }
      // FLEX / UTIL slot
      if (model.constraints["pos_FLEX"]) model.variables[vName]["pos_FLEX"] = 1;
      if (model.constraints["pos_UTIL"])  model.variables[vName]["pos_UTIL"]  = 1;
    });

    model.ints[vName]                   = 1;
    model.constraints[`bound_${vName}`] = { max: 1 };

    if (lockedPlayerIds.includes(p.id)) {
      model.constraints[`lock_${vName}`]      = { equal: 1 };
      model.variables[vName][`lock_${vName}`] = 1;
    }
  });

  const result: any = solver.Solve(model);
  if (!result.feasible) return null;

  const selectedIds = Object.keys(result)
    .filter(k => k.startsWith("p") && result[k] > 0.5)
    .map(k => Number(k.substring(1)));

  if (selectedIds.length !== config.rosterSize) return null;

  const lineup = eligiblePool.filter(p => selectedIds.includes(p.id));
  const key = [...selectedIds].sort().join("-");
  if (excludeKeys.has(key)) return null;

  const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
  const totalProj   = lineup.reduce((s, p) => s + getEffectiveProjection(p, projOverrides, projectionMode, leverageMode, contestType, ownershipOverrides), 0);

  // Post-solve float guard: ensure the floor is strictly met
  if (projectedPointsFloor && totalProj < projectedPointsFloor) return null;

  return {
    lineup,
    totalSalary,
    totalProjectedPoints: Math.round(totalProj * 100) / 100,
    key,
  };
}

// ── POST /api/optimize ────────────────────────────────────────────────────────

optimizerRouter.post("/api/optimize", async (req, res) => {
  try {
    const input = optimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });

    const sport = slate.sport as Sport;
    const config = getPlatformConfig(sport, input.platform as Platform);
    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    let pool = allPlayers
      .filter(p => !input.excludedPlayerIds.includes(p.id))
      .filter(p => p.injuryStatus !== "OUT");
    if (input.playerMinSalary) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, v] of Object.entries(input.playerProjections)) projOverrides[Number(pid)] = v;
    }

    const excludeKeys = new Set<string>();
    const result = solveLineup({
      pool, config, sport,
      lockedPlayerIds:      input.lockedPlayerIds,
      projOverrides,
      projectedPointsFloor: input.projectedPointsFloor,
      leverageMode:         false,
      projectionMode:       "balanced",
      contestType:          input.contestType ?? "cash",
      excludeKeys,
      playerAppearances:    {},
      totalLineupsSoFar:    0,
    });

    if (!result) {
      const msg = input.projectedPointsFloor
        ? `No lineup could reach the ${input.projectedPointsFloor}-point floor.`
        : "Could not generate a feasible lineup with the current constraints.";
      return res.status(200).json({ lineup: null, message: msg });
    }

    res.json({ lineup: result.lineup, totalSalary: result.totalSalary, totalProjectedPoints: result.totalProjectedPoints });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("Optimize error:", err);
    res.status(500).json({ message: "Optimization failed" });
  }
});

// ── POST /api/optimize/pro ────────────────────────────────────────────────────

optimizerRouter.post("/api/optimize/pro", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);

  try {
    const input = proOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });

    const sport = slate.sport as Sport;
    const config = getPlatformConfig(sport, input.platform as Platform);
    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    let pool = allPlayers
      .filter(p => !input.excludedPlayerIds.includes(p.id))
      .filter(p => p.injuryStatus !== "OUT");
    if (input.playerMinSalary) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, v] of Object.entries(input.playerProjections)) projOverrides[Number(pid)] = v;
    }

    const lineups: any[] = [];
    const excludeKeys = new Set<string>();
    const playerAppearances: Record<number, number> = {};

    for (let i = 0; i < input.lineupCount; i++) {
      const result = solveLineup({
        pool, config, sport,
        lockedPlayerIds:      input.lockedPlayerIds,
        projOverrides,
        projectedPointsFloor: input.projectedPointsFloor,
        leverageMode:         input.leverageMode,
        projectionMode:       input.projectionMode,
        contestType:          input.contestType ?? "cash",
        excludeKeys,
        playerAppearances,
        totalLineupsSoFar:    lineups.length,
        globalMaxExposure:    input.globalMaxExposure,
        perPlayerExposure:    input.exposureLimits,
      });

      if (!result) continue; // floor not met or infeasible — skip this slot

      lineups.push({
        lineup:               result.lineup,
        totalSalary:          result.totalSalary,
        totalProjectedPoints: result.totalProjectedPoints,
      });
      excludeKeys.add(result.key);

      for (const p of result.lineup) {
        playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
      }
    }

    // 0 lineups is not an error when a floor was set — return 200 + message
    const message = lineups.length === 0
      ? input.projectedPointsFloor
        ? `No lineups could reach the ${input.projectedPointsFloor}-point floor. Try lowering it or relaxing other constraints.`
        : "Could not generate any feasible lineups with the current constraints."
      : undefined;

    const boostsSummary = allPlayers
      .filter(p => p.boostScore && Number(p.boostScore) !== 0)
      .map(p => ({ playerId: p.id, playerName: p.name, boostScore: Number(p.boostScore), boostReason: p.boostReason || "" }))
      .sort((a, b) => Math.abs(b.boostScore) - Math.abs(a.boostScore))
      .slice(0, 10);

    const injurySummary = allPlayers
      .filter(p => p.injuryStatus && p.injuryStatus !== "Healthy")
      .map(p => ({ playerId: p.id, playerName: p.name, status: p.injuryStatus || "", detail: (p as any).injuryDetail || "" }));

    res.json({ lineups, boostsSummary, injurySummary, message });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("Pro optimize error:", err);
    res.status(500).json({ message: "Pro optimization failed" });
  }
});

// ── Sim lineup solver (single LP call against a sim's projections) ────────────

function solveSimLineup(
  pool:             Player[],
  config:           ReturnType<typeof getPlatformConfig>,
  sport:            Sport,
  simProjections:   Record<number, number>,
  lockedPlayerIds:  number[],
  excludeKeys:      Set<string>,
  enforceGameStack: boolean,
  minStackSize:     number,
): { lineup: Player[]; totalSalary: number; totalProj: number; key: string } | null {

  const model: any = {
    optimize: "projectedPoints",
    opType:   "max",
    constraints: {
      salary:     { max: config.salaryCap },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints:      {},
  };

  // Position constraints
  const positionCounts: Record<string, number> = {};
  config.slots.forEach(slot => {
    const pos = slot.replace(/\d+$/, "");
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
  });
  Object.entries(positionCounts).forEach(([pos, count]) => {
    model.constraints[`pos_${pos}`] = { equal: count };
  });

  // Game stack constraint — force at least minStackSize players from same game
  // We implement this as a "team game exposure" auxiliary variable.
  // For each unique game, track how many players from that game are selected.
  // Then add a constraint: max(game_count_i) >= minStackSize (soft — modeled via
  // a slack variable that gets included in the objective).
  // Simplified: we just add it as a soft preference via bonus projections
  // when enforceGameStack is false, and as a hard constraint when true.
  // Hard game-stack constraint is complex in ILP — we'll use the soft approach
  // (correlation already drives natural stacking) and save hard constraint for
  // future work.

  pool.forEach(p => {
    const simProj = simProjections[p.id] ?? Number(p.projectedPoints) ?? 0;
    const vName = `p${p.id}`;

    model.variables[vName] = {
      projectedPoints: Math.max(0, simProj),
      salary:          p.salary,
      rosterSize:      1,
      [`bound_${vName}`]: 1,
    };

    const positions = p.position.split("/");
    positions.forEach(pos => {
      if (model.constraints[`pos_${pos}`]) {
        model.variables[vName][`pos_${pos}`] = 1;
      }
      if (model.constraints["pos_FLEX"]) model.variables[vName]["pos_FLEX"] = 1;
      if (model.constraints["pos_UTIL"]) model.variables[vName]["pos_UTIL"] = 1;
    });

    model.ints[vName]                   = 1;
    model.constraints[`bound_${vName}`] = { max: 1 };

    if (lockedPlayerIds.includes(p.id)) {
      model.constraints[`lock_${vName}`]      = { equal: 1 };
      model.variables[vName][`lock_${vName}`] = 1;
    }
  });

  const result: any = solver.Solve(model);
  if (!result.feasible) return null;

  const selectedIds = Object.keys(result)
    .filter(k => k.startsWith("p") && result[k] > 0.5)
    .map(k => Number(k.substring(1)));

  if (selectedIds.length !== config.rosterSize) return null;

  const lineup = pool.filter(p => selectedIds.includes(p.id));
  const key = [...selectedIds].sort().join("-");
  if (excludeKeys.has(key)) return null;

  const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
  const totalProj   = lineup.reduce((s, p) => s + (simProjections[p.id] ?? Number(p.projectedPoints) ?? 0), 0);

  return { lineup, totalSalary, totalProj: Math.round(totalProj * 100) / 100, key };
}

// ── POST /api/optimize/sim ────────────────────────────────────────────────────
// Simulation-based optimizer. Runs N Monte Carlo game-script sims, solves the
// LP against each sim's projections, deduplicates results, scores each unique
// lineup across ALL sims, and returns the top K by composite ceiling score.
//
// This is the SaberSim approach: lineup diversity and stacking emerge naturally
// from correlated player projections rather than from explicit rules.

optimizerRouter.post("/api/optimize/sim", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);

  const startTime = Date.now();
  const MAX_RUNTIME_MS = 30_000; // 30 second hard cap

  try {
    const input = simOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });

    const sport  = slate.sport as Sport;
    const config = getPlatformConfig(sport, input.platform as Platform);

    let allPlayers = await storage.getPlayersBySlate(input.slateId);
    let pool = allPlayers
      .filter(p => !input.excludedPlayerIds.includes(p.id))
      .filter(p => p.injuryStatus !== "OUT");
    if (input.playerMinSalary) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    // Build projection overrides
    const projOverrides: Record<number, number> = {};
    if (input.playerProjections) {
      for (const [pid, v] of Object.entries(input.playerProjections)) {
        projOverrides[Number(pid)] = v;
      }
    }
    // Apply locked player projections from override map
    for (const p of pool) {
      if (projOverrides[p.id] === undefined) {
        projOverrides[p.id] = Number(p.projectedPoints) ?? 0;
      }
    }

    // ── Run N simulations ─────────────────────────────────────────────────────
    const sims = runSimulations(pool, sport, input.numSims, projOverrides);

    // ── LP solve against each sim ─────────────────────────────────────────────
    // Track unique lineups and their frequency
    const lineupMap = new Map<string, {
      lineup:    Player[];
      frequency: number;
      simScores: number[];
    }>();

    const globalExcludeKeys = new Set<string>();

    for (let i = 0; i < sims.length; i++) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log(`[SimOptimizer] Time cap reached after ${i} sims`);
        break;
      }

      const sim = sims[i];

      const result = solveSimLineup(
        pool,
        config,
        sport,
        sim.projections,
        input.lockedPlayerIds,
        new Set(),   // don't exclude globally within sim loop — want frequency data
        input.enforceGameStack,
        input.minStackSize,
      );

      if (!result) continue;

      const existing = lineupMap.get(result.key);
      if (existing) {
        existing.frequency++;
        existing.simScores.push(result.totalProj);
      } else {
        lineupMap.set(result.key, {
          lineup:    result.lineup,
          frequency: 1,
          simScores: [result.totalProj],
        });
      }
    }

    if (lineupMap.size === 0) {
      return res.status(200).json({
        lineups: [],
        message: "No feasible lineups found in simulations. Try relaxing constraints.",
        simsRun: sims.length,
      });
    }

    // ── Score each unique lineup across ALL sims ───────────────────────────────
    const uniqueLineups = Array.from(lineupMap.entries()).map(([key, data]) => {
      // Score this lineup in every single sim (not just the sims it won)
      const allSimScores = sims.map(sim =>
        data.lineup.reduce((sum, p) => sum + (sim.projections[p.id] || 0), 0)
      ).sort((a, b) => a - b);

      const n   = allSimScores.length;
      const avg = allSimScores.reduce((a, b) => a + b, 0) / n;
      const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
      const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
      const med = allSimScores[Math.floor(n * 0.50)] ?? avg;

      // Composite: GPP-weighted toward ceiling
      const composite = avg * 0.35 + p75 * 0.35 + p90 * 0.20 + (data.frequency / sims.length) * 100 * 0.10;

      const stack = detectStack(data.lineup);

      return {
        lineup:       data.lineup,
        key,
        frequency:    data.frequency,
        freqPct:      Math.round((data.frequency / sims.length) * 1000) / 10,
        avgSimScore:  Math.round(avg * 10) / 10,
        medianScore:  Math.round(med * 10) / 10,
        p75Score:     Math.round(p75 * 10) / 10,
        p90Score:     Math.round(p90 * 10) / 10,
        compositeScore: Math.round(composite * 10) / 10,
        totalSalary:  data.lineup.reduce((s, p) => s + p.salary, 0),
        stackedGame:  stack.game,
        stackCount:   stack.count,
        stackTeams:   stack.teams,
      };
    });

    // Sort by composite score (captures both ceiling and consistency)
    uniqueLineups.sort((a, b) => b.compositeScore - a.compositeScore);

    // ── Enforce diversity: exposure caps ──────────────────────────────────────
    const playerAppearances: Record<number, number> = {};
    const selected: typeof uniqueLineups = [];

    for (const lu of uniqueLineups) {
      if (selected.length >= input.lineupCount) break;

      // Check global max exposure
      let violatesExposure = false;
      if (input.globalMaxExposure !== undefined && selected.length > 0) {
        for (const p of lu.lineup) {
          const appearances = (playerAppearances[p.id] || 0) + 1;
          const pct = (appearances / (selected.length + 1)) * 100;
          if (pct > input.globalMaxExposure) { violatesExposure = true; break; }
        }
      }
      if (violatesExposure) continue;

      selected.push(lu);
      for (const p of lu.lineup) {
        playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
      }
    }

    // If exposure filtering was too strict, fill with next-best lineups
    if (selected.length < input.lineupCount && input.globalMaxExposure === undefined) {
      for (const lu of uniqueLineups) {
        if (selected.length >= input.lineupCount) break;
        if (!selected.find(s => s.key === lu.key)) selected.push(lu);
      }
    }

    const elapsedMs = Date.now() - startTime;

    // Ownership distribution across selected lineups
    const ownershipMap: Record<number, number> = {};
    for (const lu of selected) {
      for (const p of lu.lineup) {
        ownershipMap[p.id] = (ownershipMap[p.id] || 0) + 1;
      }
    }
    const exposureSummary = Object.entries(ownershipMap)
      .map(([id, count]) => {
        const player = pool.find(p => p.id === Number(id));
        return {
          playerId: Number(id),
          playerName: player?.name || "Unknown",
          position: player?.position || "",
          team: player?.team || "",
          appearances: count,
          exposurePct: Math.round((count / selected.length) * 100),
        };
      })
      .sort((a, b) => b.exposurePct - a.exposurePct);

    res.json({
      lineups:         selected,
      simsRun:         sims.length,
      uniqueLineups:   lineupMap.size,
      elapsedMs,
      exposureSummary,
      // How many distinct games are represented (diversity indicator)
      gamesRepresented: new Set(
        selected.flatMap(lu => lu.stackedGame ? [lu.stackedGame] : [])
      ).size,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("[SimOptimizer] Error:", err);
    res.status(500).json({ message: "Simulation optimization failed" });
  }
});
