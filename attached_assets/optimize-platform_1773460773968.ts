// ============================================================
// server/routes/optimize-platform.ts
//
// Platform-aware LP optimizer. Replaces the hardcoded DK-only
// logic in the existing /api/optimize endpoint.
//
// CHANGES FROM THE ORIGINAL:
//
//   1. Platform detected from the slate record, not hardcoded
//   2. Salary cap, roster size, and position constraints all
//      sourced from getPlatformConfig(sport, platform)
//   3. aggregateConstraints (G/F for NBA, SKATER for NHL,
//      HITTER for MLB, etc.) applied to the LP model so that
//      FD and Yahoo roster rules are enforced correctly
//   4. Salary range brackets in insights use % of cap, not
//      fixed DK dollar tiers ($4K/$6K/$8K)
//   5. Projection mode and leverage mode apply correctly
//      regardless of salary scale
//   6. The platform field on saved lineups now accepts "yahoo"
//
// MOUNT:
//   Replace your existing optimizer route registration with:
//     app.use(optimizePlatformRouter);
//   and remove the old /api/optimize handler.
// ============================================================

import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import solver from "javascript-lp-solver";
import { storage } from "./storage";
import { getPlatformConfig } from "@shared/platform-config";
import type { Player } from "@shared/schema";

export const optimizePlatformRouter = Router();

// ── Request schema ────────────────────────────────────────────────────────────

const optimizeSchema = z.object({
  slateId: z.number(),
  // Platform is now optional — if omitted we detect it from the slate record.
  // Accept all three platforms explicitly.
  platform: z.enum(["draftkings", "fanduel", "yahoo"]).optional(),
  lockedPlayerIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  // Per-player projection overrides from custom inputs / AI boosts
  playerProjections: z.record(z.string(), z.number()).optional(),
  // Salary filter (uses the player's primary salary for this slate's platform)
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  // Optimizer behavior flags
  projectionMode: z.enum(["balanced", "ceiling"]).default("balanced"),
  leverageMode: z.boolean().default(false),
  useBoosts: z.boolean().default(false),
  globalMaxExposure: z.number().min(10).max(100).optional(),
});

type OptimizeInput = z.infer<typeof optimizeSchema>;

// ── Position variables builder ────────────────────────────────────────────────
// Mirrors the one in winning-lineup-agent.ts but extended for FD/Yahoo positions

function buildPositionVariables(
  position: string,
  sport: string,
  platform: string
): Record<string, number> {
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
      // Yahoo uses LW/RW; DK/FD use W
      if (positions.includes("W") || positions.includes("LW") || positions.includes("RW")) {
        vars.W = 1; vars.SKATER = 1;
        // For Yahoo platform which has separate LW/RW slots
        if (positions.includes("LW")) vars.LW = 1;
        if (positions.includes("RW")) vars.RW = 1;
      }
      if (positions.includes("D")) { vars.D = 1; vars.SKATER = 1; }
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "MLB":
      // Yahoo uses SP slot; DK uses P
      if (positions.includes("P") || positions.includes("SP") || positions.includes("RP")) {
        vars.P = 1;
        if (platform === "yahoo") vars.SP = 1;
      }
      if (positions.includes("C")) { vars.C = 1; vars.HITTER = 1; }
      if (positions.includes("1B")) { vars["1B"] = 1; vars.HITTER = 1; }
      if (positions.includes("2B")) { vars["2B"] = 1; vars.HITTER = 1; }
      if (positions.includes("3B")) { vars["3B"] = 1; vars.HITTER = 1; }
      if (positions.includes("SS")) { vars.SS = 1; vars.HITTER = 1; }
      if (positions.includes("OF")) { vars.OF = 1; vars.HITTER = 1; }
      break;

    case "NFL":
      if (positions.includes("QB")) { vars.QB = 1; }
      if (positions.includes("RB")) { vars.RB = 1; vars.FLEX = 1; }
      if (positions.includes("WR")) { vars.WR = 1; vars.FLEX = 1; }
      if (positions.includes("TE")) { vars.TE = 1; vars.FLEX = 1; }
      if (positions.includes("DST") || positions.includes("DEF")) {
        vars.DST = 1; vars.DEF = 1;
      }
      // Yahoo NFL kicker
      if (positions.includes("K") || positions.includes("PK")) { vars.K = 1; }
      break;

    case "GOLF":
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "SOCCER":
      if (positions.includes("F")) { vars.F = 1; vars.OUTFIELD = 1; }
      if (positions.includes("M") || positions.includes("MF")) {
        vars.M = 1; vars.MF = 1; vars.OUTFIELD = 1;
      }
      if (positions.includes("D")) { vars.D = 1; vars.OUTFIELD = 1; }
      if (positions.includes("GK")) { vars.GK = 1; }
      break;
  }

  return vars;
}

// ── Projection modifier for leverage mode ────────────────────────────────────
// Leverage mode down-weights high-ownership players and up-weights contrarians.
// Ownership is approximated from salary tier: higher salary → higher ownership.

function applyLeverage(
  baseProj: number,
  salary: number,
  salaryCap: number,
  leverageMode: boolean,
  projectionMode: "balanced" | "ceiling"
): number {
  let proj = baseProj;

  if (leverageMode) {
    // Approximate ownership from salary tier (0–1 scale)
    const salaryPct = salary / salaryCap;
    // High salary (~top 20% of cap) gets a 5% penalty; low salary gets a 5% bonus
    const leverageFactor = salaryPct > 0.2 ? 0.95 : salaryPct < 0.1 ? 1.05 : 1.0;
    proj = proj * leverageFactor;
  }

  if (projectionMode === "ceiling") {
    // Ceiling mode: add a small bonus to high-variance plays (lower salary)
    // This mimics targeting boom-or-bust players for GPP
    const salaryPct = salary / salaryCap;
    if (salaryPct < 0.12) proj *= 1.08; // low-salary dart plays get a boost
  }

  return Math.round(proj * 100) / 100;
}

// ── Main optimizer ────────────────────────────────────────────────────────────

async function runOptimizer(input: OptimizeInput): Promise<{
  lineup: Player[];
  totalSalary: number;
  totalProjectedPoints: number;
  platform: string;
  error?: string;
}> {
  // ── Load slate to detect platform ─────────────────────────────────────────
  const slate = await storage.getSlate(input.slateId);
  if (!slate) throw new Error(`Slate ${input.slateId} not found`);

  // Platform from request body takes precedence; fall back to slate's platform
  const platform = input.platform || (slate.platform as "draftkings" | "fanduel" | "yahoo") || "draftkings";
  const sport = slate.sport;

  // ── Load platform config ───────────────────────────────────────────────────
  let config: ReturnType<typeof getPlatformConfig>;
  try {
    config = getPlatformConfig(sport, platform);
  } catch {
    throw new Error(`Platform "${platform}" not supported for sport "${sport}"`);
  }

  // ── Load and filter players ────────────────────────────────────────────────
  const allPlayers = await storage.getPlayersBySlate(input.slateId);

  const pool = allPlayers.filter(p => {
    if (input.excludedPlayerIds.includes(p.id)) return false;
    if (p.injuryStatus === "OUT") return false;
    if (input.playerMinSalary !== undefined && p.salary < input.playerMinSalary) return false;
    if (input.playerMaxSalary !== undefined && p.salary > input.playerMaxSalary) return false;
    return true;
  });

  if (pool.length < config.rosterSize) {
    return {
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
      platform,
      error: `Not enough eligible players (${pool.length}) for ${platform} ${sport} (need ${config.rosterSize})`,
    };
  }

  // ── Build LP model ─────────────────────────────────────────────────────────
  const model: any = {
    optimize: "projectedPoints",
    opType: "max",
    constraints: {
      salary:     { max: config.salaryCap },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints: {},
  };

  // Position constraints (named slots: PG min 1, C max 2, etc.)
  for (const [key, constraint] of Object.entries(config.positionConstraints)) {
    model.constraints[key] = constraint;
  }

  // Aggregate constraints (G/F for NBA, SKATER for NHL, HITTER for MLB, etc.)
  // These are in config.aggregateConstraints in the extended platform-config
  const agg = (config as any).aggregateConstraints as Record<string, { min?: number; max?: number }> | undefined;
  if (agg) {
    for (const [key, constraint] of Object.entries(agg)) {
      model.constraints[key] = constraint;
    }
  }

  // Build variables for each eligible player
  for (const p of pool) {
    const vName = `p${p.id}`;

    // Effective projection: custom override → boost → leverage/ceiling adjustment
    const baseProj = input.playerProjections?.[String(p.id)] ?? Number(p.projectedPoints);
    const boostedProj = input.useBoosts && Number(p.boostScore) > 0
      ? Math.round((baseProj * (1 + Number(p.boostScore) / 10)) * 100) / 100
      : baseProj;
    const effectiveProj = applyLeverage(boostedProj, p.salary, config.salaryCap, input.leverageMode, input.projectionMode);

    const posVars = buildPositionVariables(p.position, sport, platform);

    model.variables[vName] = {
      projectedPoints: effectiveProj,
      salary: p.salary,
      rosterSize: 1,
      [`bound_${vName}`]: 1,
      ...posVars,
    };
    model.ints[vName] = 1;
    model.constraints[`bound_${vName}`] = { max: 1 };

    // Locked players are forced in (equal: 1)
    if (input.lockedPlayerIds.includes(p.id)) {
      model.constraints[`lock_${vName}`] = { equal: 1 };
      model.variables[vName][`lock_${vName}`] = 1;
    }
  }

  // ── Solve ─────────────────────────────────────────────────────────────────
  const result: any = solver.Solve(model);

  if (!result.feasible) {
    return {
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
      platform,
      error: `No feasible ${platform} ${sport} lineup found. Try relaxing locked players or salary filter.`,
    };
  }

  const selectedIds = Object.keys(result)
    .filter(k => k.startsWith("p") && result[k] > 0.5)
    .map(k => Number(k.substring(1)));

  const lineup = pool.filter(p => selectedIds.includes(p.id));

  if (lineup.length !== config.rosterSize) {
    return {
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
      platform,
      error: `Roster size mismatch: ${lineup.length}/${config.rosterSize}`,
    };
  }

  const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
  const totalProjectedPoints = Math.round(
    lineup.reduce((s, p) => {
      const base = input.playerProjections?.[String(p.id)] ?? Number(p.projectedPoints);
      return s + base;
    }, 0) * 100
  ) / 100;

  return { lineup, totalSalary, totalProjectedPoints, platform };
}

// ── Route handler ─────────────────────────────────────────────────────────────

optimizePlatformRouter.post("/api/optimize", async (req: Request, res) => {
  try {
    const input = optimizeSchema.parse(req.body);
    const result = await runOptimizer(input);

    if (result.error) {
      return res.status(400).json({ message: result.error });
    }

    return res.json({
      lineup: result.lineup,
      totalSalary: result.totalSalary,
      totalProjectedPoints: result.totalProjectedPoints,
      platform: result.platform,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
    }
    console.error("[Optimizer] Error:", err.message);
    return res.status(500).json({ message: err.message || "Optimization failed" });
  }
});

// ── Pro multi-lineup route ────────────────────────────────────────────────────

const proOptimizeSchema = optimizeSchema.extend({
  lineupCount: z.number().min(1).max(150).default(1),
  exposureLimits: z.record(z.string(), z.number()).optional(),
});

optimizePlatformRouter.post("/api/optimize/pro", async (req: Request, res) => {
  try {
    const input = proOptimizeSchema.parse(req.body);
    const lineupCount = input.lineupCount;
    const lineups: any[] = [];
    const playerExposure: Record<number, number> = {};
    const excludedSoFar = new Set<number>(input.excludedPlayerIds);

    for (let i = 0; i < lineupCount; i++) {
      // Apply exposure limits: exclude players who've hit their cap
      const dynamicExclusions = [...excludedSoFar];
      if (input.globalMaxExposure !== undefined) {
        const maxAllowed = Math.ceil((input.globalMaxExposure / 100) * lineupCount);
        for (const [pid, count] of Object.entries(playerExposure)) {
          if (count >= maxAllowed) dynamicExclusions.push(Number(pid));
        }
      }
      if (input.exposureLimits) {
        for (const [pid, limitPct] of Object.entries(input.exposureLimits)) {
          const maxAllowed = Math.ceil((limitPct / 100) * lineupCount);
          const current = playerExposure[Number(pid)] || 0;
          if (current >= maxAllowed) dynamicExclusions.push(Number(pid));
        }
      }

      const result = await runOptimizer({
        ...input,
        lineupCount: 1,
        excludedPlayerIds: dynamicExclusions,
      });

      if (result.error || result.lineup.length === 0) {
        // Stop if we can't generate more unique lineups
        break;
      }

      // Track player exposure
      for (const p of result.lineup) {
        playerExposure[p.id] = (playerExposure[p.id] || 0) + 1;
      }

      lineups.push({
        lineup: result.lineup,
        totalSalary: result.totalSalary,
        totalProjectedPoints: result.totalProjectedPoints,
        platform: result.platform,
      });

      // Force variety: exclude the lowest-salary non-locked player from next iteration
      const nonLocked = result.lineup.filter(p => !input.lockedPlayerIds.includes(p.id));
      if (nonLocked.length > 0) {
        const lowestSalaryPlayer = nonLocked.reduce((a, b) => a.salary < b.salary ? a : b);
        excludedSoFar.add(lowestSalaryPlayer.id);
      }
    }

    if (lineups.length === 0) {
      return res.status(400).json({ message: "Could not generate any feasible lineups with the given constraints." });
    }

    return res.json({ lineups });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" });
    }
    console.error("[ProOptimizer] Error:", err.message);
    return res.status(500).json({ message: err.message || "Optimization failed" });
  }
});
