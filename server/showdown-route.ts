import { Router } from "express";
import type { Request } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { getShowdownConfig, getEffectiveSalary, getShowdownProjectedPoints, type Platform } from "@shared/platform-config";
import type { Player } from "@shared/schema";
import { sanitizeGameInfo } from "@shared/game-info";
import { getCachedSignals } from "./ai-scout";
import { runSimulations, detectStack } from "./simulation-engine";
import { applyOutperformerMode } from "./boost-engine";
import { getLatestGameStart } from "./slate-lifecycle";
import { addNFLQuarterbackStacks } from "./nfl-qb-stacks";
import { solveWithBudget, validatedIntegralResult, yieldToEventLoop } from "./solver-guard";
import { NFL_PRACTICE_SQUAD_DETAIL } from "./nfl-roster-eligibility";
import {
  isGolfMissedCutMarkerForDraftGroup,
} from "./golf-missed-cut";
import {
  applyExplicitProjections,
  filterByMinProjection,
  findLockedMinProjectionViolation,
  minProjectionLockMessage,
} from "./min-projection";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

export function computeAuthoritativeShowdownTotals(
  captain: Player,
  flexPlayers: Player[],
  config: ReturnType<typeof getShowdownConfig>,
): { totalSalary: number; totalProjectedPoints: string } {
  if (!config) throw new Error("Showdown configuration is required.");
  const captainSalary = getEffectiveSalary(captain.salary, true, config);
  const captainProjection = getShowdownProjectedPoints(Number(captain.projectedPoints || 0), true, config);
  const totalSalary = captainSalary + flexPlayers.reduce((sum, player) => sum + player.salary, 0);
  const totalProjectedPoints = Math.round((
    captainProjection +
    flexPlayers.reduce((sum, player) => sum + Number(player.projectedPoints || 0), 0)
  ) * 100) / 100;
  return { totalSalary, totalProjectedPoints: totalProjectedPoints.toFixed(2) };
}

export function isValidAuthoritativeShowdownTotals(
  totals: { totalSalary: number; totalProjectedPoints: string },
  salaryCap: number,
): boolean {
  const projection = Number(totals.totalProjectedPoints);
  return Number.isFinite(totals.totalSalary) &&
    totals.totalSalary >= 0 &&
    totals.totalSalary <= salaryCap &&
    Number.isFinite(projection) &&
    projection >= 0;
}

export const showdownRouter = Router();

const YAHOO_OUT_STATUSES = new Set(["INJ", "O", "OUT", "IR", "SUS", "NA"]);
function isPlayerOut(injuryStatus: string | null): boolean {
  if (!injuryStatus) return false;
  const status = injuryStatus.toUpperCase().trim();
  return YAHOO_OUT_STATUSES.has(status) || status === "DOUBTFUL";
}

type ExposureMap = Record<string, number> | undefined;

export function captainMinExposureCount(percent: number | undefined, lineupCount: number): number {
  if (!percent || percent <= 0 || lineupCount <= 0) return 0;
  return Math.min(lineupCount, Math.ceil((percent / 100) * lineupCount));
}

export function captainMaxExposureCount(percent: number | undefined, lineupCount: number): number {
  if (!percent || percent <= 0 || lineupCount <= 0) return lineupCount;
  return Math.max(0, Math.min(lineupCount, Math.floor((percent / 100) * lineupCount)));
}

function overallMaxExposureCount(percent: number | undefined, lineupCount: number): number {
  if (percent === undefined || lineupCount <= 0) return lineupCount;
  if (percent <= 0) return 0;
  return Math.max(0, Math.min(lineupCount, Math.floor((percent / 100) * lineupCount)));
}

function positiveCaptainExposure(map: ExposureMap, playerId: number): number | undefined {
  const value = map?.[String(playerId)];
  return value !== undefined && value > 0 ? value : undefined;
}

function validateCaptainExposureInputs(
  playerIds: Set<number>,
  lineupCount: number,
  minimums: ExposureMap,
  maximums: ExposureMap,
  globalMaxExposure?: number,
  perPlayerMaxExposure?: ExposureMap,
  lockedCaptainId?: number,
): string | null {
  const configuredIds = new Set([
    ...Object.keys(minimums || {}),
    ...Object.keys(maximums || {}),
  ].map(Number));
  for (const playerId of configuredIds) {
    if (!Number.isInteger(playerId) || !playerIds.has(playerId)) {
      return "Captain exposure settings contain a player who is not eligible for this slate.";
    }
    const min = positiveCaptainExposure(minimums, playerId);
    const max = positiveCaptainExposure(maximums, playerId);
    const minCount = captainMinExposureCount(min, lineupCount);
    const maxCount = captainMaxExposureCount(max, lineupCount);
    if (minCount > maxCount) {
      return "A player's minimum captain exposure cannot exceed their maximum captain exposure.";
    }
    const overallCapacities = [
      globalMaxExposure === undefined ? lineupCount : overallMaxExposureCount(globalMaxExposure, lineupCount),
      perPlayerMaxExposure?.[String(playerId)] === undefined
        ? lineupCount
        : overallMaxExposureCount(perPlayerMaxExposure[String(playerId)], lineupCount),
    ];
    if (minCount > Math.min(...overallCapacities)) {
      return "A player's minimum captain exposure exceeds their overall maximum exposure.";
    }
    if (lockedCaptainId !== undefined && playerId !== lockedCaptainId && min !== undefined) {
      return "A locked captain conflicts with another player's minimum captain exposure.";
    }
  }
  const required = Array.from(configuredIds).reduce(
    (sum, playerId) => sum + captainMinExposureCount(positiveCaptainExposure(minimums, playerId), lineupCount),
    0,
  );
  if (required > lineupCount) {
    return "Combined minimum captain exposures exceed the requested lineup count.";
  }
  const totalCaptainCapacity = Array.from(playerIds).reduce(
    (sum, playerId) => sum + captainMaxExposureCount(
      positiveCaptainExposure(maximums, playerId),
      lineupCount,
    ),
    0,
  );
  if (totalCaptainCapacity < lineupCount) {
    return "Combined maximum captain exposures cannot fill the requested lineup count.";
  }
  if (lockedCaptainId !== undefined) {
    const lockedMax = positiveCaptainExposure(maximums, lockedCaptainId);
    if (lockedMax !== undefined && captainMaxExposureCount(lockedMax, lineupCount) < lineupCount) {
      return "The locked captain conflicts with that player's maximum captain exposure.";
    }
    const lockedOverallCapacity = Math.min(
      globalMaxExposure === undefined ? lineupCount : overallMaxExposureCount(globalMaxExposure, lineupCount),
      perPlayerMaxExposure?.[String(lockedCaptainId)] === undefined
        ? lineupCount
        : overallMaxExposureCount(perPlayerMaxExposure[String(lockedCaptainId)], lineupCount),
    );
    if (lockedOverallCapacity < lineupCount) {
      return "The locked captain conflicts with the overall player exposure limit.";
    }
  }
  return null;
}

function validateFlexExposureInputs(
  playerIds: Set<number>,
  lineupCount: number,
  flexCount: number,
  minimums: ExposureMap,
  maximums: ExposureMap,
  captainMinimums: ExposureMap,
  globalMaxExposure: number | undefined,
  perPlayerMaxExposure: ExposureMap,
  lockedCaptainId: number | undefined,
  lockedFlexIds: number[],
): string | null {
  if (lockedCaptainId !== undefined && lockedFlexIds.includes(lockedCaptainId)) {
    return "The same player cannot be locked as both captain and FLEX.";
  }
  if (new Set(lockedFlexIds).size !== lockedFlexIds.length || lockedFlexIds.length > flexCount) {
    return "Locked FLEX players exceed the available FLEX slots.";
  }
  const configuredIds = new Set([
    ...Object.keys(minimums || {}),
    ...Object.keys(maximums || {}),
  ].map(Number));
  for (const playerId of configuredIds) {
    if (!Number.isInteger(playerId) || !playerIds.has(playerId)) {
      return "FLEX exposure settings contain a player who is not eligible for this slate.";
    }
    const minCount = captainMinExposureCount(positiveCaptainExposure(minimums, playerId), lineupCount);
    const maxCount = captainMaxExposureCount(positiveCaptainExposure(maximums, playerId), lineupCount);
    if (minCount > maxCount) {
      return "A player's minimum FLEX exposure cannot exceed their maximum FLEX exposure.";
    }
    const overallCapacity = Math.min(
      globalMaxExposure === undefined ? lineupCount : overallMaxExposureCount(globalMaxExposure, lineupCount),
      perPlayerMaxExposure?.[String(playerId)] === undefined
        ? lineupCount
        : overallMaxExposureCount(perPlayerMaxExposure[String(playerId)], lineupCount),
    );
    const captainMinimum = captainMinExposureCount(
      positiveCaptainExposure(captainMinimums, playerId),
      lineupCount,
    );
    if (minCount + captainMinimum > overallCapacity) {
      return "A player's minimum captain and FLEX exposures exceed their overall maximum exposure.";
    }
    if (lockedCaptainId === playerId && minCount > 0) {
      return "The locked captain conflicts with that player's minimum FLEX exposure.";
    }
  }
  const lockedFlexSet = new Set(lockedFlexIds);
  for (const playerId of lockedFlexSet) {
    if (positiveCaptainExposure(captainMinimums, playerId) !== undefined) {
      return "A locked FLEX player conflicts with that player's minimum captain exposure.";
    }
    const max = positiveCaptainExposure(maximums, playerId);
    if (max !== undefined && captainMaxExposureCount(max, lineupCount) < lineupCount) {
      return "A locked FLEX player conflicts with that player's maximum FLEX exposure.";
    }
    const overallCapacity = Math.min(
      globalMaxExposure === undefined ? lineupCount : overallMaxExposureCount(globalMaxExposure, lineupCount),
      perPlayerMaxExposure?.[String(playerId)] === undefined
        ? lineupCount
        : overallMaxExposureCount(perPlayerMaxExposure[String(playerId)], lineupCount),
    );
    if (overallCapacity < lineupCount) {
      return "A locked FLEX player conflicts with the overall player exposure limit.";
    }
  }
  const requiredFlexSlots = Array.from(configuredIds).reduce(
    (sum, playerId) => sum + captainMinExposureCount(
      positiveCaptainExposure(minimums, playerId),
      lineupCount,
    ),
    0,
  );
  if (requiredFlexSlots > flexCount * lineupCount) {
    return "Combined minimum FLEX exposures exceed the available FLEX slots.";
  }
  const totalFlexCapacity = Array.from(playerIds).reduce((sum, playerId) => {
    if (lockedCaptainId === playerId) return sum;
    return sum + captainMaxExposureCount(
      positiveCaptainExposure(maximums, playerId),
      lineupCount,
    );
  }, 0);
  if (totalFlexCapacity < flexCount * lineupCount) {
    return "Combined maximum FLEX exposures cannot fill the requested lineup count.";
  }
  return null;
}

showdownRouter.get("/api/showdown/slates", async (req, res) => {
  try {
    const sport            = (req.query.sport as string || "NBA").toUpperCase();
    const requestedPlatform = (req.query.platform as string || "draftkings").toLowerCase();

    const allSlates = await storage.getSlates();

    const candidates = allSlates
      .filter(s =>
        s.sport    === sport &&
        s.platform === requestedPlatform &&
        s.gameType?.toLowerCase() === "showdown" &&
        s.isActive !== false
      )
      .sort((a, b) => {
        const aIsShowdown = a.gameType?.toLowerCase() === "showdown";
        const bIsShowdown = b.gameType?.toLowerCase() === "showdown";
        if (aIsShowdown && !bIsShowdown) return -1;
        if (!aIsShowdown && bIsShowdown) return 1;
        if (a.isMain && !b.isMain) return -1;
        if (!a.isMain && b.isMain) return  1;
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });

    const filtered = [];
    for (const s of candidates) {
      const players = await storage.getPlayersBySlate(s.id);
      const latestGameStart = getLatestGameStart(s, players);
      if (latestGameStart.getTime() + 3 * 60 * 60 * 1000 < Date.now()) continue;

      filtered.push({
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
      });
    }

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

    const players = (await storage.getPlayersBySlate(slateId))
      .filter(player => !isPlayerOut(player.injuryStatus));

    const gameMap: Record<string, Player[]> = {};
    for (const p of players) {
      const game = sanitizeGameInfo(p.gameInfo) || p.opponent || "Unknown";
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
  minProjection: z.number().finite().min(0).optional(),
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  perPlayerMaxExposure: z.record(z.string(), z.number()).optional(),
  perPlayerCaptainMinExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerCaptainMaxExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerFlexMinExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerFlexMaxExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  ownershipOverrides: z.record(z.string(), z.number()).optional(),
  fadedPlayerIds: z.array(z.number()).default([]),
});

showdownRouter.post("/api/showdown/optimize", async (req, res) => {
  const requestStartTime = Date.now();
  const solverDeadline = requestStartTime + 26_000;
  let solverTimedOut = false;
  try {
    const input = showdownOptimizeSchema.parse(req.body);
    const slate = await storage.getSlate(input.slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (slate.isActive === false) {
      return res.status(410).json({ message: "This slate has ended. Please select a current slate." });
    }
    input.sport = slate.sport;
    input.platform = slate.platform as typeof input.platform;

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    const lockedPracticeSquad = [
      input.lockedCaptainId,
      ...input.lockedFlexIds,
    ].some(playerId => allPlayers.some(
      player => player.id === playerId && player.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL,
    ));
    if (lockedPracticeSquad) {
      return res.status(400).json({
        message: "A practice-squad player cannot be locked into a Showdown lineup.",
      });
    }
    const lockedGolfMissedCut = [
      input.lockedCaptainId,
      ...input.lockedFlexIds,
    ].some(playerId => allPlayers.some(
      player => player.id === playerId &&
        isGolfMissedCutMarkerForDraftGroup(player, slate.draftGroupId),
    ));
    if (lockedGolfMissedCut) {
      return res.status(400).json({
        message: "A golfer who missed the cut cannot be locked into a Showdown lineup.",
      });
    }

    const showdownMinProjectionInput = applyExplicitProjections(
      allPlayers,
      input.playerProjections,
    );
    const showdownLockedIds = [
      ...(input.lockedCaptainId !== undefined ? [input.lockedCaptainId] : []),
      ...input.lockedFlexIds,
    ];
    const showdownMinProjectionViolation = findLockedMinProjectionViolation(
      showdownMinProjectionInput,
      input.minProjection,
      showdownLockedIds,
    );
    if (showdownMinProjectionViolation) {
      const role = input.lockedCaptainId === showdownMinProjectionViolation.player.id
        ? "captain"
        : "player";
      return res.status(400).json({
        message: minProjectionLockMessage(showdownMinProjectionViolation, role),
      });
    }
    const showdownMinProjectionEligibleIds = input.minProjection !== undefined && input.minProjection > 0
      ? new Set(filterByMinProjection(showdownMinProjectionInput, input.minProjection).map(p => p.id))
      : undefined;

    // Hard excludes: OUT/Questionable + user-excluded
    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    pool = pool.filter(p => !isPlayerOut(p.injuryStatus) &&
      p.injuryStatus?.toUpperCase().trim() !== "QUESTIONABLE" &&
      p.injuryStatus?.toUpperCase().trim() !== "GTD");

    // Salary filter
    if (input.playerMinSalary !== undefined) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary !== undefined) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    if (input.gameFilter) {
      pool = pool.filter(p => sanitizeGameInfo(p.gameInfo) === input.gameFilter || p.opponent === input.gameFilter);
    }
    if (pool.length < config.rosterSize && !(input.minProjection !== undefined && input.minProjection > 0)) {
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
      const boostValue = sig.signal_type === "out" ? 0 : Number(sig.boost_value);
      if (!Number.isFinite(boostValue)) continue;
      if (!scoutMap.has(key) || Math.abs(boostValue) > Math.abs(scoutMap.get(key)!)) {
        scoutMap.set(key, boostValue);
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
      if (input.useBoosts && !hasCustom) {
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

    // Eligibility is decided from raw flex projections plus explicit request
    // projections; apply those IDs after Showdown's server-only adjustments.
    // Do not use captainProj here: the CPT multiplier is only applied after
    // this eligibility decision.
    if (showdownMinProjectionEligibleIds) {
      pool = pool.filter(p => showdownMinProjectionEligibleIds.has(p.id));
    }
    if (pool.length < config.rosterSize) {
      return res.status(400).json({
        message: input.minProjection !== undefined && input.minProjection > 0
          ? `Not enough eligible players meet the minProjection cutoff of ${input.minProjection}. Lower minProjection or relax other constraints.`
          : "Not enough eligible players for a showdown lineup.",
      });
    }

    const flexCount = config.rosterSize - 1;
    const captainExposureError = validateCaptainExposureInputs(
      new Set(pool.map(player => player.id)),
      input.lineupCount,
      input.perPlayerCaptainMinExposure,
      input.perPlayerCaptainMaxExposure,
      input.globalMaxExposure,
      input.perPlayerMaxExposure,
      input.lockedCaptainId,
    );
    if (captainExposureError) {
      return res.status(400).json({ message: captainExposureError });
    }
    const flexExposureError = validateFlexExposureInputs(
      new Set(pool.map(player => player.id)),
      input.lineupCount,
      flexCount,
      input.perPlayerFlexMinExposure,
      input.perPlayerFlexMaxExposure,
      input.perPlayerCaptainMinExposure,
      input.globalMaxExposure,
      input.perPlayerMaxExposure,
      input.lockedCaptainId,
      input.lockedFlexIds,
    );
    if (flexExposureError) {
      return res.status(400).json({ message: flexExposureError });
    }
    const requiredFlexByLineup = Array.from(
      { length: input.lineupCount },
      () => [...input.lockedFlexIds],
    );
    for (const [playerIdRaw, percent] of Object.entries(input.perPlayerFlexMinExposure || {})) {
      if (percent <= 0) continue;
      const playerId = Number(playerIdRaw);
      if (input.lockedFlexIds.includes(playerId)) continue;
      const required = captainMinExposureCount(percent, input.lineupCount);
      const alreadyRequired = requiredFlexByLineup.filter(ids => ids.includes(playerId)).length;
      for (let index = alreadyRequired; index < required; index++) {
        const target = requiredFlexByLineup
          .map((ids, lineupIndex) => ({ ids, lineupIndex }))
          .filter(entry => entry.ids.length < flexCount && !entry.ids.includes(playerId))
          .sort((a, b) => a.ids.length - b.ids.length || a.lineupIndex - b.lineupIndex)[0];
        if (!target) {
          return res.status(400).json({
            message: "Could not schedule all minimum FLEX exposures across the requested lineups.",
          });
        }
        target.ids.push(playerId);
      }
    }

    const lineups: any[] = [];
    const usedKeys = new Set<string>();

    // Tracker for per-player exposure across generated lineups
    const playerAppearances: Record<number, number> = {};
    const captainAppearances: Record<number, number> = {};
    const flexAppearances: Record<number, number> = {};

    function canUseCaptain(playerId: number): boolean {
      const max = positiveCaptainExposure(input.perPlayerCaptainMaxExposure, playerId);
      if (
        max !== undefined &&
        (captainAppearances[playerId] || 0) >= captainMaxExposureCount(max, input.lineupCount)
      ) return false;
      return !isPlayerCapped(playerId);
    }

    function isPlayerCapped(playerId: number): boolean {
      // Global cap
      if (input.globalMaxExposure !== undefined) {
        if (
          (playerAppearances[playerId] || 0) + 1 >
          overallMaxExposureCount(input.globalMaxExposure, input.lineupCount)
        ) return true;
      }
      // Per-player cap
      const perCap = input.perPlayerMaxExposure?.[String(playerId)];
      if (perCap !== undefined) {
        if (
          (playerAppearances[playerId] || 0) + 1 >
          overallMaxExposureCount(perCap, input.lineupCount)
        ) return true;
      }
      return false;
    }

    function isFlexCapped(playerId: number): boolean {
      const max = positiveCaptainExposure(input.perPlayerFlexMaxExposure, playerId);
      return max !== undefined &&
        (flexAppearances[playerId] || 0) >= captainMaxExposureCount(max, input.lineupCount);
    }

    const solveShowdown = async (
      captainId: number,
      lockedFlexIds: number[],
      excludeFromResult: Set<string>,
      targetLineupIndex: number,
    ): Promise<any | null> => {
      const captain = pool.find(p => p.id === captainId);
      if (!captain) return null;
      if (lockedFlexIds.includes(captainId)) return null;

      const captainSalary = getEffectiveSalary(captain.salary, true, config);
      const captainProj   = getShowdownProjectedPoints(getEffectiveProjection(captain), true, config);
      const remainingSalary = config.salaryCap - captainSalary;

      // Flex pool: exclude captain, hard-excluded, and exposure-capped players
      const flexPool = pool.filter(p => {
        if (p.id === captainId) return false;
        if (!lockedFlexIds.includes(p.id) && isFlexCapped(p.id)) return false;
        if (input.globalMaxExposure !== undefined && isPlayerCapped(p.id)) return false;
        if (input.perPlayerMaxExposure?.[String(p.id)] !== undefined && isPlayerCapped(p.id)) return false;
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
      const excludedFlexSets = Array.from(excludeFromResult)
        .map(key => key.split("-").map(Number))
        .filter(ids => ids[0] === captainId)
        .map(ids => new Set(ids.slice(1)));
      excludedFlexSets.forEach((_, index) => {
        model.constraints[`exclude_lineup_${index}`] = { max: flexCount - 1 };
      });

      flexPool.forEach(p => {
        const vName = `p${p.id}`;
        model.variables[vName] = {
          projectedPoints: getEffectiveProjection(p),
          salary: p.salary,
          rosterSize: 1,
          [`bound_${vName}`]: 1,
        };
        excludedFlexSets.forEach((ids, index) => {
          if (ids.has(p.id)) model.variables[vName][`exclude_lineup_${index}`] = 1;
        });
        model.ints[vName] = 1;
        model.constraints[`bound_${vName}`] = { max: 1 };

        if (lockedFlexIds.includes(p.id)) {
          model.constraints[`lock_${vName}`] = { equal: 1 };
          model.variables[vName][`lock_${vName}`] = 1;
        }
      });

      addNFLQuarterbackStacks(model, flexPool, input.sport, captain);
      await yieldToEventLoop();
      const guardedSolve = solveWithBudget(model, { deadline: solverDeadline, timeoutMs: 2_000 });
      if (guardedSolve.timedOut) solverTimedOut = true;
      const result = validatedIntegralResult(guardedSolve.result, model);
      if (!result) return null;

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
    };

    function recordAppearances(lineup: any) {
      playerAppearances[lineup.captain.id] = (playerAppearances[lineup.captain.id] || 0) + 1;
      captainAppearances[lineup.captain.id] = (captainAppearances[lineup.captain.id] || 0) + 1;
      for (const p of lineup.flexPlayers) {
        playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
        flexAppearances[p.id] = (flexAppearances[p.id] || 0) + 1;
      }
    }

    if (input.lockedCaptainId) {
      for (let i = 0; i < input.lineupCount && i < 20; i++) {
        if (Date.now() >= solverDeadline) {
          solverTimedOut = true;
          break;
        }
        const result = await solveShowdown(
          input.lockedCaptainId,
          requiredFlexByLineup[lineups.length],
          usedKeys,
          i + 1,
        );
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
          recordAppearances(result);
        } else {
          if (solverTimedOut) break;
          break;
        }
      }
    } else {
      const rankedCandidates = [...pool]
        .sort((a, b) => getEffectiveProjection(b) - getEffectiveProjection(a))
        .slice(0, Math.min(pool.length, 30));
      const requiredCandidateIds = new Set(
        Object.entries(input.perPlayerCaptainMinExposure || {})
          .filter(([, percent]) => percent > 0)
          .map(([playerId]) => Number(playerId)),
      );
      const candidates = [
        ...rankedCandidates,
        ...pool.filter(player =>
          requiredCandidateIds.has(player.id) &&
          !rankedCandidates.some(candidate => candidate.id === player.id),
        ),
      ];

      const requiredCaptainIds = candidates.flatMap(candidate =>
        Array(captainMinExposureCount(
          positiveCaptainExposure(input.perPlayerCaptainMinExposure, candidate.id),
          input.lineupCount,
        )).fill(candidate.id),
      );
      const captainQueue = [
        ...requiredCaptainIds,
        ...Array.from({ length: input.lineupCount * Math.max(candidates.length, 1) }, (_, index) =>
          candidates[index % candidates.length]?.id,
        ).filter((id): id is number => id !== undefined),
      ];

      for (const candidateId of captainQueue) {
        if (lineups.length >= input.lineupCount) break;
        if (Date.now() >= solverDeadline) {
          solverTimedOut = true;
          break;
        }
        if (!canUseCaptain(candidateId)) continue;
        const result = await solveShowdown(
          candidateId,
          requiredFlexByLineup[lineups.length],
          usedKeys,
          lineups.length + 1,
        );
        if (result) {
          lineups.push(result);
          usedKeys.add(result.key);
          recordAppearances(result);
        }
        if (solverTimedOut) break;
      }

      lineups.sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);
      lineups.splice(input.lineupCount);
    }

    const unmetCaptainMinimum = Object.entries(input.perPlayerCaptainMinExposure || {}).find(([playerId, percent]) =>
      percent > 0 &&
      (captainAppearances[Number(playerId)] || 0) < captainMinExposureCount(percent, input.lineupCount),
    );
    if (unmetCaptainMinimum) {
      return res.status(400).json({
        message: "Could not satisfy all minimum captain exposures with the current player pool and constraints.",
      });
    }
    const unmetFlexMinimum = Object.entries(input.perPlayerFlexMinExposure || {}).find(([playerId, percent]) =>
      percent > 0 &&
      (flexAppearances[Number(playerId)] || 0) < captainMinExposureCount(percent, input.lineupCount),
    );
    if (unmetFlexMinimum) {
      return res.status(400).json({
        message: "Could not satisfy all minimum FLEX exposures with the current player pool and constraints.",
      });
    }
    const hasCaptainExposureSettings = Object.values(input.perPlayerCaptainMinExposure || {}).some(value => value > 0) ||
      Object.values(input.perPlayerCaptainMaxExposure || {}).some(value => value > 0);
    const hasFlexExposureSettings = Object.values(input.perPlayerFlexMinExposure || {}).some(value => value > 0) ||
      Object.values(input.perPlayerFlexMaxExposure || {}).some(value => value > 0);
    const hasAnyExposureSettings = hasCaptainExposureSettings ||
      hasFlexExposureSettings ||
      input.globalMaxExposure !== undefined ||
      Object.keys(input.perPlayerMaxExposure || {}).length > 0;
    if (hasAnyExposureSettings && lineups.length < input.lineupCount) {
      return res.status(400).json({
        message: "Captain or FLEX exposure limits could not produce the requested number of unique lineups.",
      });
    }

    if (lineups.length === 0) {
      return res.status(solverTimedOut ? 200 : 400).json({
        lineups: [],
        partial: solverTimedOut,
        message: solverTimedOut
          ? "Partial results: the solver time budget expired before a validated showdown lineup was generated."
          : "Could not generate any feasible showdown lineups.",
      });
    }

    res.json({
      lineups,
      partial: solverTimedOut,
      message: solverTimedOut
        ? `Partial results: generated ${lineups.length} of ${input.lineupCount} requested showdown lineups before the solver time budget was reached.`
        : undefined,
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
  minProjection: z.number().finite().min(0).optional(),
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  perPlayerMaxExposure: z.record(z.string(), z.number()).optional(),
  perPlayerCaptainMinExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerCaptainMaxExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerFlexMinExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
  perPlayerFlexMaxExposure: z.record(z.string(), z.number().min(0).max(100)).optional(),
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
    input.sport = slate.sport;
    input.platform = slate.platform as typeof input.platform;

    const config = getShowdownConfig(input.sport, input.platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${input.sport} on ${input.platform}` });

    const allPlayers = await storage.getPlayersBySlate(input.slateId);

    const lockedPracticeSquad = [
      input.lockedCaptainId,
      ...input.lockedFlexIds,
    ].some(playerId => allPlayers.some(
      player => player.id === playerId && player.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL,
    ));
    if (lockedPracticeSquad) {
      return res.status(400).json({
        message: "A practice-squad player cannot be locked into a Showdown simulation.",
      });
    }
    const lockedGolfMissedCut = [
      input.lockedCaptainId,
      ...input.lockedFlexIds,
    ].some(playerId => allPlayers.some(
      player => player.id === playerId &&
        isGolfMissedCutMarkerForDraftGroup(player, slate.draftGroupId),
    ));
    if (lockedGolfMissedCut) {
      return res.status(400).json({
        message: "A golfer who missed the cut cannot be locked into a Showdown simulation.",
      });
    }

    const showdownSimMinProjectionInput = applyExplicitProjections(
      allPlayers,
      input.playerProjections,
    );
    const showdownSimLockedIds = [
      ...(input.lockedCaptainId !== undefined ? [input.lockedCaptainId] : []),
      ...input.lockedFlexIds,
    ];
    const showdownSimMinProjectionViolation = findLockedMinProjectionViolation(
      showdownSimMinProjectionInput,
      input.minProjection,
      showdownSimLockedIds,
    );
    if (showdownSimMinProjectionViolation) {
      const role = input.lockedCaptainId === showdownSimMinProjectionViolation.player.id
        ? "captain"
        : "player";
      return res.status(400).json({
        message: minProjectionLockMessage(showdownSimMinProjectionViolation, role),
      });
    }
    const showdownSimMinProjectionEligibleIds = input.minProjection !== undefined && input.minProjection > 0
      ? new Set(filterByMinProjection(showdownSimMinProjectionInput, input.minProjection).map(p => p.id))
      : undefined;

    let pool = allPlayers.filter(p => !input.excludedPlayerIds.includes(p.id));
    pool = pool.filter(p => !isPlayerOut(p.injuryStatus) &&
      p.injuryStatus?.toUpperCase().trim() !== "QUESTIONABLE" &&
      p.injuryStatus?.toUpperCase().trim() !== "GTD");

    if (input.playerMinSalary !== undefined) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
    if (input.playerMaxSalary !== undefined) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

    if (input.gameFilter) {
      pool = pool.filter(p => sanitizeGameInfo(p.gameInfo) === input.gameFilter || p.opponent === input.gameFilter);
    }
    if (pool.length < config.rosterSize && !(input.minProjection !== undefined && input.minProjection > 0)) {
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
      const boostValue = sig.signal_type === "out" ? 0 : Number(sig.boost_value);
      if (!Number.isFinite(boostValue)) continue;
      if (!scoutMap.has(key) || Math.abs(boostValue) > Math.abs(scoutMap.get(key)!)) {
        scoutMap.set(key, boostValue);
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
      const scoutWeight = input.useBoosts ? scoutMap.get(p.name.toLowerCase()) : undefined;
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

    // Eligibility is decided from raw projections plus explicit request
    // projections before runSimulations samples variance or applies CPT.
    if (showdownSimMinProjectionEligibleIds) {
      pool = pool.filter(p => showdownSimMinProjectionEligibleIds.has(p.id));
    }
    if (pool.length < config.rosterSize) {
      return res.status(400).json({
        message: input.minProjection !== undefined && input.minProjection > 0
          ? `Not enough eligible players meet the minProjection cutoff of ${input.minProjection}. Lower minProjection or relax other constraints.`
          : "Not enough eligible players for a showdown lineup.",
      });
    }

    const flexCount = config.rosterSize - 1;
    const captainExposureError = validateCaptainExposureInputs(
      new Set(pool.map(player => player.id)),
      input.lineupCount,
      input.perPlayerCaptainMinExposure,
      input.perPlayerCaptainMaxExposure,
      input.globalMaxExposure,
      input.perPlayerMaxExposure,
      input.lockedCaptainId,
    );
    if (captainExposureError) {
      return res.status(400).json({ message: captainExposureError });
    }
    const flexExposureError = validateFlexExposureInputs(
      new Set(pool.map(player => player.id)),
      input.lineupCount,
      flexCount,
      input.perPlayerFlexMinExposure,
      input.perPlayerFlexMaxExposure,
      input.perPlayerCaptainMinExposure,
      input.globalMaxExposure,
      input.perPlayerMaxExposure,
      input.lockedCaptainId,
      input.lockedFlexIds,
    );
    if (flexExposureError) {
      return res.status(400).json({ message: flexExposureError });
    }

    const startTime = Date.now();
    const MAX_RUNTIME_MS = 30_000;
    const RESPONSE_RESERVE_MS = 4_000;
    const solverDeadline = startTime + MAX_RUNTIME_MS - RESPONSE_RESERVE_MS;
    let simTimedOut = false;

    const simulationRunCount = Math.max(
      input.numSims,
      Math.min(2000, input.lineupCount * 4),
    );
    console.log(`[ShowdownSim] Starting ${simulationRunCount} sims for ${input.sport} slate ${input.slateId}, pool: ${pool.length} players, requesting ${input.lineupCount} lineups`);

    const sims = runSimulations(pool, input.sport, simulationRunCount, projOverrides);
    const candidateGenerationCount = (required: number) =>
      required + Math.min(required * 2, Math.max(0, input.numSims - input.lineupCount));
    const requiredCaptainSchedule = pool.flatMap(player =>
      Array(candidateGenerationCount(captainMinExposureCount(
        positiveCaptainExposure(input.perPlayerCaptainMinExposure, player.id),
        input.lineupCount,
      ))).fill(player.id),
    );
    const requiredFlexSchedule = Array.from(
      { length: sims.length },
      () => [...input.lockedFlexIds],
    );
    for (const [playerIdRaw, percent] of Object.entries(input.perPlayerFlexMinExposure || {})) {
      if (percent <= 0) continue;
      const playerId = Number(playerIdRaw);
      if (input.lockedFlexIds.includes(playerId)) continue;
      const required = captainMinExposureCount(percent, input.lineupCount);
      const generationRequired = candidateGenerationCount(required);
      const alreadyRequired = requiredFlexSchedule
        .slice(0, input.lineupCount)
        .filter(ids => ids.includes(playerId)).length;
      for (let index = alreadyRequired; index < generationRequired; index++) {
        const target = requiredFlexSchedule
          .map((ids, lineupIndex) => ({ ids, lineupIndex }))
          .filter(entry =>
            entry.ids.length < flexCount &&
            !entry.ids.includes(playerId) &&
            input.lockedCaptainId !== playerId &&
            requiredCaptainSchedule[entry.lineupIndex] !== playerId
          )
          .sort((a, b) => a.ids.length - b.ids.length || a.lineupIndex - b.lineupIndex)[0];
        if (!target) {
          return res.status(400).json({
            message: "Could not schedule all minimum FLEX exposures for simulation.",
          });
        }
        target.ids.push(playerId);
      }
    }

    const lineupMap = new Map<string, {
      captain: any;
      flexPlayers: any[];
      frequency: number;
    }>();

    for (let i = 0; i < sims.length; i++) {
      if (Date.now() >= solverDeadline) {
        simTimedOut = true;
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
      } else if (requiredCaptainSchedule[i] !== undefined) {
        captainId = requiredCaptainSchedule[i];
      } else {
        const sorted = [...simPool].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
        captainId = sorted[0].id;
      }

      const captain = simPool.find(p => p.id === captainId);
      if (!captain) continue;
      if (requiredFlexSchedule[i].includes(captainId)) continue;

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

        if (requiredFlexSchedule[i].includes(p.id)) {
          model.constraints[`lock_${vName}`] = { equal: 1 };
          model.variables[vName][`lock_${vName}`] = 1;
        }
      });

      addNFLQuarterbackStacks(model, flexPool, input.sport, captain);
      await yieldToEventLoop();
      const guardedSolve = solveWithBudget(model, { deadline: solverDeadline, timeoutMs: 2_000 });
      if (guardedSolve.timedOut) simTimedOut = true;
      const result = validatedIntegralResult(guardedSolve.result, model);
      if (!result) continue;

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

    const hasCaptainExposureSettings = Object.values(input.perPlayerCaptainMinExposure || {}).some(value => value > 0) ||
      Object.values(input.perPlayerCaptainMaxExposure || {}).some(value => value > 0);
    const hasFlexExposureSettings = Object.values(input.perPlayerFlexMinExposure || {}).some(value => value > 0) ||
      Object.values(input.perPlayerFlexMaxExposure || {}).some(value => value > 0);
    const hasAnyExposureSettings = hasCaptainExposureSettings ||
      hasFlexExposureSettings ||
      input.globalMaxExposure !== undefined ||
      Object.keys(input.perPlayerMaxExposure || {}).length > 0;

    if (lineupMap.size === 0) {
      if (hasAnyExposureSettings) {
        return res.status(400).json({
          message: "Exposure limits could not produce any feasible simulated lineups.",
        });
      }
      const partial = simTimedOut || Date.now() >= solverDeadline;
      return res.status(200).json({
        lineups: [],
        message: partial
          ? "Partial results: the solver time budget expired before a validated showdown lineup was generated."
          : "No feasible lineups found in simulations. Try relaxing constraints.",
        simsRun: sims.length,
        partial,
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

    let selected: typeof uniqueLineups;
    if (hasAnyExposureSettings) {
      const portfolioModel: any = {
        optimize: "score",
        opType: "max",
        constraints: {
          lineupCount: { equal: input.lineupCount },
        },
        variables: {},
        ints: {},
      };
      const addRoleConstraints = (prefix: string, minimums: ExposureMap, maximums: ExposureMap) => {
        for (const [playerId, percent] of Object.entries(minimums || {})) {
          if (percent > 0) {
            portfolioModel.constraints[`${prefix}_min_${playerId}`] = {
              min: captainMinExposureCount(percent, input.lineupCount),
            };
          }
        }
        for (const [playerId, percent] of Object.entries(maximums || {})) {
          if (percent > 0) {
            portfolioModel.constraints[`${prefix}_max_${playerId}`] = {
              max: captainMaxExposureCount(percent, input.lineupCount),
            };
          }
        }
      };
      addRoleConstraints("captain", input.perPlayerCaptainMinExposure, input.perPlayerCaptainMaxExposure);
      addRoleConstraints("flex", input.perPlayerFlexMinExposure, input.perPlayerFlexMaxExposure);
      for (const player of pool) {
        if (input.globalMaxExposure !== undefined) {
          portfolioModel.constraints[`global_${player.id}`] = {
            max: overallMaxExposureCount(input.globalMaxExposure, input.lineupCount),
          };
        }
        const playerMax = input.perPlayerMaxExposure?.[String(player.id)];
        if (playerMax !== undefined) {
          portfolioModel.constraints[`overall_${player.id}`] = {
            max: overallMaxExposureCount(playerMax, input.lineupCount),
          };
        }
      }
      uniqueLineups.forEach((lineup, index) => {
        const variableName = `l${index}`;
        const variable: Record<string, number> = {
          score: lineup.compositeScore,
          lineupCount: 1,
          [`bound_${variableName}`]: 1,
          [`captain_min_${lineup.captain.id}`]: 1,
          [`captain_max_${lineup.captain.id}`]: 1,
        };
        for (const player of lineup.flexPlayers) {
          variable[`flex_min_${player.id}`] = 1;
          variable[`flex_max_${player.id}`] = 1;
        }
        for (const player of [lineup.captain, ...lineup.flexPlayers]) {
          variable[`global_${player.id}`] = 1;
          variable[`overall_${player.id}`] = 1;
        }
        portfolioModel.variables[variableName] = variable;
        portfolioModel.ints[variableName] = 1;
        portfolioModel.constraints[`bound_${variableName}`] = { max: 1 };
      });
      await yieldToEventLoop();
      const portfolioSolve = solveWithBudget(portfolioModel, {
        deadline: startTime + MAX_RUNTIME_MS,
        timeoutMs: RESPONSE_RESERVE_MS,
      });
      const portfolioResult = validatedIntegralResult(portfolioSolve.result, portfolioModel);
      if (!portfolioResult) {
        return res.status(400).json({
          message: "Captain, FLEX, or overall exposure limits could not produce a complete simulated lineup portfolio.",
        });
      }
      selected = uniqueLineups.filter((_, index) => portfolioResult[`l${index}`] > 0.5);
      if (selected.length !== input.lineupCount) {
        return res.status(400).json({
          message: "Exposure limits could not produce the requested number of simulated lineups.",
        });
      }
    } else {
      selected = uniqueLineups.slice(0, input.lineupCount);
    }

    const elapsedMs = Date.now() - startTime;
    const partial = simTimedOut || Date.now() >= solverDeadline;
    if (!partial && selected.length !== input.lineupCount) {
      return res.status(400).json({
        message: `Only ${selected.length} distinct simulated lineups could be built. Relax locks, exposure limits, or the minimum projection and try again.`,
      });
    }
    console.log(`[ShowdownSim] Completed: ${sims.length} sims, ${lineupMap.size} unique lineups, selected ${selected.length}, ${elapsedMs}ms`);

    res.json({
      lineups: selected,
      partial,
      message: partial
        ? `Partial results: generated ${selected.length} of ${input.lineupCount} requested showdown lineups before the solver time budget was reached.`
        : undefined,
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
    const {
      slateId,
      sport,
      platform,
      captainId,
      flexIds,
    } = req.body;
    const slate = await storage.getSlate(Number(slateId));
    if (
      !slate ||
      slate.sport !== sport ||
      slate.platform !== platform ||
      slate.gameType?.trim().toLowerCase() !== "showdown"
    ) {
      return res.status(400).json({ message: "The selected Showdown slate is no longer available." });
    }

    const config = getShowdownConfig(sport, platform as Platform);
    if (!config) return res.status(400).json({ message: `Showdown not supported for ${sport} on ${platform}` });

    const slatePlayers = await storage.getPlayersBySlate(Number(slateId));
    const playerById = new Map(slatePlayers.map(player => [player.id, player]));
    const normalizedCaptainId = Number(captainId);
    const captain = Number.isInteger(normalizedCaptainId) ? playerById.get(normalizedCaptainId) : undefined;
    const flexPlayerIds = Array.isArray(flexIds) ? flexIds.map(Number) : [];
    if (
      !captain ||
      flexPlayerIds.length !== config.rosterSize - 1 ||
      flexPlayerIds.some(id => !Number.isInteger(id) || id <= 0) ||
      new Set(flexPlayerIds).size !== flexPlayerIds.length
    ) {
      return res.status(400).json({ message: "Invalid Showdown roster. Select one captain and the required flex players." });
    }
    if (flexPlayerIds.some(id => id === captain.id || !playerById.has(id))) {
      return res.status(400).json({ message: "Every saved Showdown player must belong to the selected slate." });
    }
    if (
      captain.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL ||
      flexPlayerIds.some(id => playerById.get(id)!.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL)
    ) {
      return res.status(400).json({ message: "Practice-squad players cannot be saved in a Showdown lineup." });
    }
    if (
      isGolfMissedCutMarkerForDraftGroup(captain, slate.draftGroupId) ||
      flexPlayerIds.some(id => isGolfMissedCutMarkerForDraftGroup(playerById.get(id)!, slate.draftGroupId))
    ) {
      return res.status(400).json({ message: "Golfers who missed the cut cannot be saved in a Showdown lineup." });
    }

    // The client snapshot is display metadata only.  Totals and effective CPT
    // values must always be recomputed from the canonical slate player rows so
    // a forged total/effectiveProjection cannot be persisted.
    const flexPlayers = flexPlayerIds.map(id => playerById.get(id)!);
    const authoritativeTotals = computeAuthoritativeShowdownTotals(captain, flexPlayers, config);
    if (!isValidAuthoritativeShowdownTotals(authoritativeTotals, config.salaryCap)) {
      return res.status(400).json({ message: "This Showdown lineup exceeds the salary cap or contains invalid projections." });
    }
    const captainSalary = getEffectiveSalary(captain.salary, true, config);
    const captainProjection = getShowdownProjectedPoints(Number(captain.projectedPoints || 0), true, config);
    const savedSnapshot = [
      {
        ...captain,
        slot: config.captainLabel,
        isCaptain: true,
        effectiveSalary: captainSalary,
        effectiveProjection: captainProjection,
      },
      ...flexPlayerIds.map((id, index) => {
        const player = playerById.get(id)!;
        return {
          ...player,
          slot: `${config.flexLabel}${index + 1}`,
          isCaptain: false,
          effectiveSalary: player.salary,
          effectiveProjection: Number(player.projectedPoints || 0),
        };
      }),
    ];

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

    const allPlayerIds = [captain.id, ...flexPlayerIds];
    const lineup = await storage.createLineup({
      userId,
      slateId: Number(slateId),
      sport,
      platform: (["draftkings","fanduel","yahoo"].includes(platform) ? platform : "draftkings") as string,
      playerIds: allPlayerIds,
      totalSalary: authoritativeTotals.totalSalary,
      totalProjectedPoints: authoritativeTotals.totalProjectedPoints,
      status: "active",
      playerSnapshot: savedSnapshot,
    });

    res.status(201).json(lineup);
  } catch (err) {
    console.error("Showdown save error:", err);
    res.status(500).json({ message: "Failed to save showdown lineup" });
  }
});
