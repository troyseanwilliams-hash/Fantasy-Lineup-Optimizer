import type { Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { registerPlayerConfiguration, configurationExpiry, resolveConfigurationOverrides } from "./player-configuration";
import { selectExposureLineups, assertLineupExposures, validateExposureBounds, mergeExposureMinimums, mergeExposureMaximums } from "./lineup-exposure";
import { createSimExposureSearch, filterSimProjectionCandidates } from "./sim-exposure-search";
import { db } from "./db";
import { users, subscriptions, slates, lineups as lineupsTable, signupEvents, supportTickets, draftTeams, type FavoriteStack } from "@shared/schema";
import { eq, and, lt, sql, desc, gte, inArray } from "drizzle-orm";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { getPlatformConfig, ACTIVE_SPORTS, WORLD_CUP_ENABLED, assignPlayersToSlots, type Platform } from "@shared/platform-config";
import { parseGameInfo, sanitizeGameInfo } from "@shared/game-info";
import { computeBoostScores, computeCorrelationBonus, applyCeilingMode, applyLeverageMode, applyActualAdjustedProjections, applyWinningLineupAdjustment, applyOutperformerMode } from "./boost-engine";
import { getHistoricalProfile, applyHistoricalAdjustments } from "./historical-adjustments";
import { applyMarketProjectionBlend } from "./market-projections";
import { generateFieldLineups, computeTournamentEV, type TournamentEVResult } from "./tournament-ev";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

import { type OptimizationConstraints, type ProOptimizationConstraints, type Player, type Slate, type Lineup, type InsertProp, type InsertAlert, proOptimizationConstraintSchema, insertPrizePicksEntrySchema } from "@shared/schema";
import { fetchAllSportsLiveData, fetchPlayerStatusUpdates, mapDKStatus, fetchLivePlayerStatuses, fetchAvailableDKSlates, fetchAvailableDKShowdowns, fetchDKSlateByDraftGroup, fetchDraftables, isPlayerConfirmedStarter, parseEasternTime, getEasternToday, resolveDKContestDraftGroups, isClassicDKDraftGroup, type DKContestIdentityResult } from "./balldontlie";
import { fetchAllPropsForSport, type ParsedProp } from "./odds-api";
import { getLiveScores, getAllLiveScores, fetchESPNStarters } from "./espn-scores";
import { fetchPrizePicksProjections, getSupportedPPSports, buildAIEntries, analyzeManualPicks, generateProjectionsFromPlayers, getLineMovements } from "./prizepicks";
import { fetchBDLStats, normalizeName } from "./balldontlie-stats";
import { refreshRecentlyPlayed, getRecentlyPlayedCache, normalizePlayerName } from "./espn-activity";
import { calculateOwnership, computeOwnershipForPlayers, type ContestType } from "./ownership-engine";
import { getCachedSignals, getScoutStatus, refreshAll, forceRefreshAll, secondsUntilRefresh, triggerLazyRefreshIfStale } from "./ai-scout";
import { runSimulations, detectStack, scoreLineupsAcrossSims } from "./simulation-engine";
import { addSimGameStacks, addSimStackAlternatives, stackGameKey as getStackGameKey, type SimStackAlternative } from "./sim-game-stacks";
import { addNFLQuarterbackStacks } from "./nfl-qb-stacks";
import { generateNflPortfolio as generateNflPortfolioEngine, addNflPortfolioConstraints, regenerationNflSettings } from "./nfl-portfolio";
import { nflPortfolioSettingsSchema, type NflPortfolioSettings, type NflPortfolioLineupPolicy, type NflPortfolioReport } from "@shared/nfl-portfolio";
import { buildVegasContext } from "./vegas-client";
import { buildDvPContext, applyDvPToProjections, buildOpponentMap } from "./dvp-client";
import { fetchStartingLineups, getStartingLineupsData, clearLineupsCache } from "./lineups-ingest";
import { projectionAccuracyRouter } from "./projection-accuracy-route";
import { deactivateExpiredSlates, getLatestGameStart } from "./slate-lifecycle";
import { solveWithBudget, validatedIntegralResult, remainingSolverTime, yieldToEventLoop, type SolverBudget } from "./solver-guard";
import { createLineupEnrichmentLoader } from "./lineups-enrichment";
import { NFL_PRACTICE_SQUAD_DETAIL, protectNFLPracticeSquadMarker } from "./nfl-roster-eligibility";
import {
  isGolfMissedCutMarker,
  isGolfMissedCutMarkerForDraftGroup,
  protectGolfMissedCutMarker,
} from "./golf-missed-cut";
import {
  ExportResolutionError,
  resolvePlayersForExport,
  type ExportDraftable,
} from "./export-player-resolver";
import {
  applyExplicitProjections,
  filterByMinProjection,
  findLockedMinProjectionViolation,
  minProjectionLockMessage,
  minProjectionRequiredPositionMessage,
} from "./min-projection";
import { reconcileClassicMainIdentity, shouldCloneRegeneratedLineup } from "./lineup-regeneration";
import { selectLiveDraftGroup, selectNewestLocalSlate } from "./draft-group-selection";
import {
  describeDKImportSlateResolution,
  normalizeDKContestId,
  resolveDKImportSlate,
  type DKImportContestLookup,
} from "./dk-import-resolution";


async function loadOverridesWithCrossRef(
  userId: string,
  effectiveSlateId: number,
  originalSlateId: number | null,
  altSlatePlayers: Player[]
): Promise<{ overrides: any[]; overrideMap: Map<number, any>; excluded: Set<number>; locked: Set<number>; exposureMap: Record<string, { min?: number; max?: number }> }> {
  // Clone resolution may change the target slate, never the configuration scope.
  const target = await storage.getSlate(effectiveSlateId);
  if (!target || configurationExpiry(target, altSlatePlayers).isExpired) {
    throw new z.ZodError([{ code: "custom", path: ["slateId"], message: "This slate has expired. Generation is unavailable." }]);
  }
  const overrides = resolveConfigurationOverrides(await storage.getPlayerOverrides(userId, effectiveSlateId), altSlatePlayers);

  const overrideMap = new Map(overrides.map(o => [o.playerId, o]));
  const excluded = new Set(overrides.filter(o => o.isExcluded).map(o => o.playerId));
  const locked = new Set(overrides.filter(o => o.isLocked).map(o => o.playerId));
  const exposureMap: Record<string, { min?: number; max?: number }> = {};
  for (const o of overrides) {
    if (o.minExposure != null || o.maxExposure != null) {
      exposureMap[o.playerId.toString()] = { min: o.minExposure ?? undefined, max: o.maxExposure ?? undefined };
    }
  }
  return { overrides, overrideMap, excluded, locked, exposureMap };
}

async function cloneRegeneratedLineup(
  source: Lineup,
  targetSlateId: number,
  payload: {
    playerIds: number[];
    totalSalary: number;
    totalProjectedPoints: string;
    playerSnapshot?: any;
    simData?: any;
  },
  executor: any = db,
): Promise<Lineup> {
  const insert: any = {
    userId: source.userId,
    slateId: targetSlateId,
    sport: source.sport,
    platform: source.platform || "draftkings",
    totalSalary: payload.totalSalary,
    totalProjectedPoints: payload.totalProjectedPoints,
    playerIds: payload.playerIds,
    name: source.name,
    status: "active",
    playerSnapshot: payload.playerSnapshot,
    // A regenerated row is not the submitted DraftKings entry itself.
    // Contest identifiers therefore stay attached only to the source row.
    dkEntryId: null,
    dkContestName: null,
    dkContestId: null,
    dkEntryFee: null,
  };
  if (payload.simData !== undefined) insert.simData = payload.simData;
  const [lineup] = await executor.insert(lineupsTable).values(insert).returning();
  return lineup;
}

function starRatingMinProjection(starRating: number): number {
  if (starRating <= 1) return 0;
  if (starRating === 2) return 15;
  if (starRating === 3) return 25;
  if (starRating === 4) return 35;
  return 45;
}

const YAHOO_OUT_STATUSES = new Set(["INJ", "O", "OUT", "IR", "SUS", "NA"]);
const RETIRED_PLAYER_DETAIL = "No longer listed in the current contest player pool";
function isPlayerOut(injuryStatus: string | null): boolean {
  if (!injuryStatus) return false;
  const s = injuryStatus.toUpperCase().trim();
  return s === "OUT" || s === "IR" || s === "DOUBTFUL" || YAHOO_OUT_STATUSES.has(s);
}
function isPlayerUnavailable(injuryStatus: string | null): boolean {
  if (!injuryStatus) return false;
  const s = injuryStatus.toUpperCase().trim();
  return isPlayerOut(injuryStatus) || s === "QUESTIONABLE" || s === "GTD";
}

function normalizeStackGameKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().toUpperCase().split("-");
  if (parts.length !== 2 || parts.some(part => !/^[A-Z0-9]+$/.test(part))) return null;
  return parts.sort().join("-");
}

function isClassicSlate(slate: Slate): boolean {
  return (slate.gameType || "Classic").trim().toLowerCase() === "classic";
}

export function validateNflPortfolioContext(settings: NflPortfolioSettings | undefined, slate: Slate, platform: string, contestType: string): void {
  if (settings?.enabled && (slate.sport.toUpperCase() !== "NFL" || platform !== "draftkings" || slate.platform !== "draftkings" || !isClassicSlate(slate) || contestType !== "gpp")) {
    throw new z.ZodError([{ code: "custom", path: ["nflPortfolio"], message: "NFL portfolio strategy requires NFL DraftKings Classic GPP." }]);
  }
}

async function generateNflPortfolio(options: Parameters<typeof generateNflPortfolioEngine>[0]) {
  try {
    return await generateNflPortfolioEngine(options);
  } catch (error) {
    throw new z.ZodError([{ code: "custom", path: ["nflPortfolio"], message: error instanceof Error ? error.message : "NFL portfolio generation failed." }]);
  }
}

async function portfolioOwnership(pool: Player[], settings: NflPortfolioSettings, automaticScoringOnly = false): Promise<Map<number, number> | undefined> {
  if (settings.ownershipMode === "off" && !automaticScoringOnly) return undefined;
  if (settings.ownershipMode === "provided") return new Map(Object.entries(settings.ownershipOverrides).map(([id, pct]) => [Number(id), pct]));
  try {
    const results = await calculateOwnership(pool, "NFL", "gpp_large");
    // Automatic structure keeps ownership constraints OFF. Only the confirmed
    // supplied slate gets the blended map for scoring; other slates are unchanged.
    if (settings.ownershipMode === "off" && !results.some(p => p.ownershipSource === "supplied")) return undefined;
    const ownership = new Map(results.map(p => [p.playerId, p.projectedOwnership]));
    for (const [id, value] of Object.entries(settings.ownershipOverrides)) ownership.set(Number(id), value);
    return ownership;
  } catch (error) {
    console.warn("[NFL Portfolio] Ownership calculation unavailable.", error);
    return undefined; // Engine reports unavailable ownership; never invent estimates.
  }
}

export function scorePortfolioSims(
  candidates: Array<{ lineup: Player[] }>,
  sims: ReturnType<typeof runSimulations>,
  metric: string,
  pool?: Player[],
  ownership?: Map<number, number>,
  evResults?: Map<string, TournamentEVResult>,
): number[] {
  const entries = candidates.map(c => ({ playerIds: c.lineup.map(p => p.id), key: c.lineup.map(p => p.id).sort().join(",") }));
  const scored = scoreLineupsAcrossSims(entries, sims);
  if (metric === "ev") {
    if (!pool || !ownership || !pool.every(p => Number.isFinite(ownership.get(p.id)))) {
      throw new Error("EV portfolio scoring requires complete explicit estimated or provided ownership. Choose another simulation metric or provide ownership.");
    }
    const field = generateFieldLineups(pool.map(p => ({ ...p, ownershipProjection: ownership.get(p.id)! })), "NFL", "draftkings", 800);
    if (field.length >= 100) {
      const ev = computeTournamentEV(entries.map(e => ({
        key: e.key, pids: e.playerIds,
        ownProduct: e.playerIds.reduce((n, id) => n * Math.min(0.6, Math.max(0.002, ownership.get(id)! / 100)), 1),
      })), field, sims.map(s => s.projections));
      if (entries.some(e => !Number.isFinite(ev.get(e.key)?.evScore))) {
        throw new Error("EV portfolio scoring did not return a valid score for every candidate.");
      }
      for (const [key, value] of ev) evResults?.set(key, value);
      return entries.map(e => ev.get(e.key)!.evScore);
    }
    throw new Error("EV portfolio scoring could not generate a sufficient field sample. Choose another simulation metric or relax the pool constraints.");
  }
  return scored.map((c, index) => {
    if (metric === "p90") return c.p90Score;
    if (metric === "p75") return c.p75Score;
    if (metric === "avg") return c.avgSimScore;
    if (metric === "median") {
      const totals = sims.map(s => entries[index].playerIds.reduce((sum, id) => sum + (s.projections[id] || 0), 0)).sort((a, b) => a - b);
      return totals[Math.floor(totals.length * 0.5)] ?? 0;
    }
    return c.avgSimScore * 0.35 + c.p75Score * 0.35 + c.p90Score * 0.20;
  });
}

const SIM_STACK_SUPPORTED_CLASSIC_SPORTS = new Set(["NFL", "MLB", "NBA", "NHL", "SOCCER"]);

export const simRegenerateRestrictionSchema = z.object({
  nflPortfolio: nflPortfolioSettingsSchema.optional(),
  flexAllowedPositions: z.array(z.enum(["RB", "WR", "TE"])).min(1).optional(),
  stackGameKeys: z.array(z.string()).max(32).optional(),
}).strict();

export function validateSimRegenerateRestrictions(
  input: z.infer<typeof simRegenerateRestrictionSchema>,
  slate: Slate,
  players: Player[],
): { flexAllowedPositions?: ("RB" | "WR" | "TE")[]; stackGameKeys?: string[]; nflPortfolio?: NflPortfolioSettings } {
  const sport = slate.sport.trim().toUpperCase();
  const classic = isClassicSlate(slate);

  if (input.flexAllowedPositions !== undefined && (sport !== "NFL" || !classic)) {
    throw new Error("FLEX position restrictions are supported only for NFL Classic slates.");
  }

  let stackGameKeys: string[] | undefined;
  if (input.stackGameKeys !== undefined) {
    if (input.stackGameKeys.length > 0 && (!classic || !SIM_STACK_SUPPORTED_CLASSIC_SPORTS.has(sport))) {
      throw new Error("Selected game stacks are supported only for NFL, MLB, NBA, NHL, and SOCCER Classic slates.");
    }
    const normalized = input.stackGameKeys.map(key => normalizeStackGameKey(key));
    if (normalized.some(key => !key)) {
      throw new Error("Selected stack games must use a canonical TEAM-TEAM game key.");
    }
    stackGameKeys = Array.from(new Set(normalized.filter((key): key is string => Boolean(key))));
    const actualGameKeys = new Set(players.map(player => getStackGameKey(player.gameInfo)).filter(Boolean));
    if (stackGameKeys.some(key => !actualGameKeys.has(key))) {
      throw new Error("A selected stack game is not in every affected slate. Clear your game selections and try again.");
    }
  }

  return {
    ...(input.nflPortfolio ? { nflPortfolio: input.nflPortfolio } : {}),
    flexAllowedPositions: input.flexAllowedPositions,
    stackGameKeys,
  };
}

export function buildSimRegenerateSolverConstraints(
  slateId: number,
  lockedPlayerIds: number[],
  salaryCap: number,
  contestType: "cash" | "gpp",
  restrictions: ReturnType<typeof validateSimRegenerateRestrictions>,
): OptimizationConstraints & { stackGameKeys?: string[]; maxSalary?: number } {
  return {
    slateId,
    lockedPlayerIds,
    excludedPlayerIds: [],
    flexAllowedPositions: restrictions.flexAllowedPositions,
    lineupCount: 1,
    maxSalary: salaryCap,
    contestType,
    ...(restrictions.nflPortfolio ? { nflPortfolio: restrictions.nflPortfolio } : {}),
    stackGameKeys: restrictions.stackGameKeys,
  } as unknown as OptimizationConstraints & { stackGameKeys?: string[]; maxSalary?: number };
}

export function simRegenerationRuntimeMs(lineupCount: number): number {
  return Math.min(90_000, Math.max(35_000, 20_000 + Math.max(0, lineupCount) * 250));
}

function serializeFavoriteStack(stack: FavoriteStack) {
  return {
    id: stack.id,
    slateId: stack.slateId,
    kind: stack.kind as "game" | "players",
    name: stack.name,
    gameKey: stack.gameKey,
    playerIds: stack.playerIds || [],
  };
}

type ScoutSignalMap = Map<string, { signal_type: string; boost_value: number }>;

function buildScoutMap(sport: string): ScoutSignalMap {
  const signals = getCachedSignals(sport);
  const map: ScoutSignalMap = new Map();
  for (const sig of signals) {
    const key = sig.player_name.toLowerCase();
    const existing = map.get(key);
    const boostValue = sig.signal_type === "out" ? 0 : Number(sig.boost_value);
    if (!Number.isFinite(boostValue)) continue;
    if (!existing || Math.abs(boostValue) > Math.abs(existing.boost_value)) {
      map.set(key, { signal_type: sig.signal_type, boost_value: boostValue });
    }
  }
  return map;
}

function applyScoutToProjection(pts: number, playerName: string, scoutMap: ScoutSignalMap, hasCustomProjection?: boolean): number {
  if (hasCustomProjection) return pts;
  const sig = scoutMap.get(playerName.toLowerCase());
  if (!sig) return pts;
  if (sig.signal_type === "out") return 0;
  const pct = sig.boost_value * 0.015;
  const clamped = Math.max(-0.15, Math.min(0.15, pct));
  return Math.round(pts * (1 + clamped) * 10) / 10;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerPlayerConfiguration(app, storage);

  const SITE_URL = "https://fantasy-lineup-optimizer.replit.app";
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /optimizer/\nDisallow: /optimizer-pro/\nDisallow: /api/\n\nSitemap: ${SITE_URL}/sitemap.xml`
    );
  });

  app.get("/sitemap.xml", (_req, res) => {
    const pages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/pricing", priority: "0.9", changefreq: "weekly" },
      { loc: "/about", priority: "0.8", changefreq: "monthly" },
      { loc: "/lineup-builder", priority: "0.9", changefreq: "weekly" },
      { loc: "/prop-insights", priority: "0.9", changefreq: "weekly" },
      { loc: "/sim-guide", priority: "0.7", changefreq: "monthly" },
      { loc: "/track-record", priority: "0.7", changefreq: "daily" },
      { loc: "/login", priority: "0.6", changefreq: "monthly" },
      { loc: "/terms", priority: "0.3", changefreq: "yearly" },
      { loc: "/privacy", priority: "0.3", changefreq: "yearly" },
    ];
    const urls = pages.map(p =>
      `  <url>\n    <loc>${SITE_URL}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join("\n");
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
    );
  });

  app.get("/api/slates/:id/resolve", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid slate ID" });
      }
      const original = await storage.getSlate(id);
      if (!original) return res.status(404).json({ message: "Slate not found" });
      // Saved configuration links are historical identities, not live-target
      // selectors. Regeneration retains its separate source-clone resolution.
      return res.json(original);
    } catch (err) {
      console.error("Slate resolution error:", err);
      return res.status(500).json({ message: "Failed to resolve slate" });
    }
  });

  app.get(api.slates.list.path, async (req, res) => {
    try {
      const allSlates = await storage.getSlates();
      const graceCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const active = allSlates
        .filter(s => s.isActive !== false)
        .sort((a, b) => {
          if (a.sport === b.sport && a.platform === b.platform) {
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
          }
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        });

      const enriched = await Promise.all(active.map(async (s) => {
        const players = await storage.getPlayersBySlate(s.id);
        const gameSet = new Set<string>();
        for (const p of players) {
          if (p.gameInfo) {
            const displayGameInfo = sanitizeGameInfo(p.gameInfo);
            const vsMatch = displayGameInfo.match(/^(\w{2,5})\s+vs\s+(\w{2,5})\s/i);
            if (vsMatch) {
              gameSet.add(`${vsMatch[1]}v${vsMatch[2]}`);
              continue;
            }
            const atMatch = displayGameInfo.match(/^(\w{2,5})\s*@\s*(\w{2,5})\s/);
            if (atMatch) {
              gameSet.add(`${atMatch[1]}@${atMatch[2]}`);
            }
          }
        }
        const storedGC = (s as any).gameCount ?? 0;
        return {
          ...s,
          label:        (s as any).label        ?? s.name,
          gameType:     (s as any).gameType     ?? "Classic",
          gameCount:    gameSet.size || storedGC,
          contestCount: (s as any).contestCount ?? 0,
          playerCount:  players.length,
          games:        Array.from(gameSet).sort(),
        };
      }));
      res.json(enriched);
    } catch (err) {
      console.error("Slates error:", err);
      res.status(500).json({ message: "Failed to fetch slates" });
    }
  });

  const favoriteStackBodySchema = z.object({
    kind: z.enum(["game", "players"]),
    name: z.string().trim().min(1).max(80),
    gameKey: z.string().trim().nullable().optional(),
    playerIds: z.array(z.number().int().positive()).optional(),
  }).strict();

  app.get("/api/slates/:slateId/favorite-stacks", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const slateId = Number(req.params.slateId);
    if (!Number.isSafeInteger(slateId) || slateId <= 0) {
      return res.status(400).json({ message: "Invalid slate ID" });
    }
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (!isClassicSlate(slate)) {
      return res.status(400).json({ message: "Favorite stacks are available only for classic slates." });
    }
    const stacks = await storage.getFavoriteStacks(userId, slateId);
    return res.json(stacks.map(serializeFavoriteStack));
  });

  app.post("/api/slates/:slateId/favorite-stacks", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const slateId = Number(req.params.slateId);
    if (!Number.isSafeInteger(slateId) || slateId <= 0) {
      return res.status(400).json({ message: "Invalid slate ID" });
    }

    const parsed = favoriteStackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid favorite stack" });
    }
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (!isClassicSlate(slate)) {
      return res.status(400).json({ message: "Favorite stacks are available only for classic slates." });
    }

    const input = parsed.data;
    const currentPlayers = await storage.getPlayersBySlate(slateId);
    let gameKey: string | null = null;
    let playerIds: number[] = [];

    if (input.kind === "game") {
      gameKey = normalizeStackGameKey(input.gameKey);
      if (!gameKey) {
        return res.status(400).json({ message: "A valid canonical game key is required for a game favorite." });
      }
      if (input.playerIds && input.playerIds.length > 0) {
        return res.status(400).json({ message: "Game favorites cannot include player IDs." });
      }
      const slateGameKeys = new Set(currentPlayers.map(player => getStackGameKey(player.gameInfo)).filter(Boolean));
      if (!slateGameKeys.has(gameKey)) {
        return res.status(400).json({ message: "That game is not in the selected slate." });
      }
    } else {
      const requestedIds = input.playerIds || [];
      if (requestedIds.length < 2 || requestedIds.length > 5) {
        return res.status(400).json({ message: "Player favorites must contain 2 to 5 players." });
      }
      if (new Set(requestedIds).size !== requestedIds.length) {
        return res.status(400).json({ message: "Player favorites cannot contain duplicate players." });
      }
      const playersById = new Map(currentPlayers.map(player => [player.id, player]));
      const selectedPlayers = requestedIds.map(id => playersById.get(id));
      if (selectedPlayers.some(player => !player)) {
        return res.status(400).json({ message: "Every selected player must be from the current slate. Refresh the player pool and try again." });
      }
      const selectedGameKeys = new Set(selectedPlayers.map(player => getStackGameKey(player!.gameInfo)));
      if (selectedGameKeys.size !== 1 || selectedGameKeys.has("")) {
        return res.status(400).json({ message: "Player favorites must use players from one game in the current slate." });
      }
      const selectedGameKey = selectedGameKeys.values().next().value as string;
      if (input.gameKey != null && normalizeStackGameKey(input.gameKey) !== selectedGameKey) {
        return res.status(400).json({ message: "The supplied game key does not match the selected players' game." });
      }
      // Keep the canonical game key as useful additive metadata for player
      // favorites too; the exact player IDs remain the source of truth.
      gameKey = selectedGameKey;
      playerIds = [...requestedIds].sort((a, b) => a - b);
    }

    const created = await storage.createFavoriteStack({
      userId,
      slateId,
      kind: input.kind,
      name: input.name,
      gameKey,
      playerIds,
    });
    return res.status(201).json(serializeFavoriteStack(created));
  });

  app.delete("/api/slates/:slateId/favorite-stacks/:id", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const slateId = Number(req.params.slateId);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(slateId) || slateId <= 0 || !Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid favorite stack ID" });
    }
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (!isClassicSlate(slate)) {
      return res.status(400).json({ message: "Favorite stacks are available only for classic slates." });
    }
    const deleted = await storage.deleteFavoriteStack(userId, slateId, id);
    if (!deleted) return res.status(404).json({ message: "Favorite stack not found" });
    return res.sendStatus(204);
  });

  // DraftKings publishes several independent groups for the same kickoff.
  // This endpoint gives the optimizer/UI the live featured target and keeps
  // every alternate group addressable by its own draftGroupId.  A caller may
  // pass ?draftGroupId=... to target an explicitly selected alternative.
  app.get("/api/draftkings/slates/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const available = await fetchAvailableDKSlates(sport);
      const existingSlates = await storage.getSlates();
      const requestedDraftGroupId = req.query.draftGroupId == null
        ? null
        : Number(req.query.draftGroupId);
      if (requestedDraftGroupId !== null &&
          (!Number.isSafeInteger(requestedDraftGroupId) || requestedDraftGroupId <= 0)) {
        return res.status(400).json({ message: "draftGroupId must be a positive integer" });
      }

      const selected = selectLiveDraftGroup(available, sport, requestedDraftGroupId);
      if (!selected) {
        return res.status(404).json({
          message: requestedDraftGroupId === null
            ? `No live DraftKings ${sport} classic slates found`
            : `DraftGroup ${requestedDraftGroupId} is not a live ${sport} classic slate`,
        });
      }

      const withLocalSlate = (metadata: typeof selected) => {
        const local = selectNewestLocalSlate(existingSlates
          .filter(s =>
            s.sport === sport &&
            s.platform === "draftkings" &&
            s.draftGroupId === metadata.draftGroupId,
          ));
        return { ...metadata, slateId: local?.id ?? null, isImported: Boolean(local) };
      };
      const target = withLocalSlate(selected);
      const slates = available.map(withLocalSlate);
      res.json({
        sport,
        platform: "draftkings",
        target,
        targetDraftGroupId: selected.draftGroupId,
        targetContest: selected.contestId == null ? null : {
          id: selected.contestId,
          name: selected.contestName,
          path: selected.contestPath,
          url: selected.contestUrl,
          entryFee: selected.contestEntryFee,
          prizePool: selected.contestPrizePool,
        },
        alternatives: slates.filter(s => s.draftGroupId !== selected.draftGroupId),
        slates,
        apiPath: `/api/draftkings/slates/${encodeURIComponent(sport)}`,
        targetPath: `/api/draftkings/slates/${encodeURIComponent(sport)}?draftGroupId=${selected.draftGroupId}`,
      });
    } catch (err: any) {
      console.error(`[DK] Error fetching ${req.params.sport} slate metadata:`, err);
      res.status(500).json({ message: err.message || "Failed to fetch DraftKings slate metadata" });
    }
  });

  app.post(api.slates.create.path, async (req, res) => {
    try {
      const input = api.slates.create.input.parse(req.body);
      const slate = await storage.createSlate(input);
      res.status(201).json(slate);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Resolve provider IDs only for the current export.  This endpoint is
  // intentionally read-only: saved lineup snapshots must retain their
  // historical contest IDs.
  app.post(api.exports.resolvePlayers.path, async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);

    try {
      const input = api.exports.resolvePlayers.input.parse(req.body);
      const slate = await storage.getSlate(input.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const players = await storage.getPlayersBySlate(slate.id);
      let draftables: ExportDraftable[] | undefined;
      if ((slate.platform || "").toLowerCase() === "draftkings") {
        if (!slate.draftGroupId) {
          return res.status(400).json({
            message: "The selected DraftKings slate has no current contest group.",
          });
        }
        try {
          draftables = await fetchDraftables(slate.draftGroupId);
        } catch (error) {
          console.error("[Export] DraftKings contest lookup failed:", error);
          return res.status(503).json({
            message: "The current DraftKings contest player pool is unavailable. Try again.",
          });
        }
      }

      const resolvedPlayers = resolvePlayersForExport({
        slate,
        players,
        playerIds: input.playerIds,
        captainId: input.captainId,
        draftables,
      });

      return res.json({
        slate: {
          id: slate.id,
          sport: slate.sport,
          platform: slate.platform,
          draftGroupId: slate.draftGroupId,
          gameType: slate.gameType || "Classic",
          label: slate.label || slate.name,
          name: slate.name,
        },
        players: resolvedPlayers,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      if (error instanceof ExportResolutionError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("[Export] Player resolution failed:", error);
      return res.status(500).json({ message: "Failed to resolve export players" });
    }
  });

  app.get("/api/ownership/:slateId", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro") {
        return res.status(403).json({ message: "Upgrade to Champion to access ownership projections" });
      }

      const slateId = Number(req.params.slateId);
      const slate = await storage.getSlate(slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const contestType = (req.query.contestType as ContestType) || "gpp_large";
      const players = await storage.getPlayersBySlate(slateId);
      if (!players || players.length === 0) {
        return res.json({ slate: { id: slate.id, sport: slate.sport, platform: slate.platform, startTime: slate.startTime }, positions: {}, chalkPlayer: null, contrarianPlayer: null, contestType, empty: true });
      }
      const bdlStats = await fetchBDLStats(slate.sport);
      const ownershipResults = await calculateOwnership(players, slate.sport, contestType, bdlStats);
      const playersWithOwnership = computeOwnershipForPlayers(players, ownershipResults);

      const positionGroups: Record<string, typeof playersWithOwnership> = {};
      for (const p of playersWithOwnership) {
        const primaryPos = p.position.split("/")[0];
        if (!positionGroups[primaryPos]) positionGroups[primaryPos] = [];
        positionGroups[primaryPos].push(p);
      }

      for (const pos of Object.keys(positionGroups)) {
        positionGroups[pos].sort((a, b) => b.ownershipProjection - a.ownershipProjection);
        positionGroups[pos] = positionGroups[pos].slice(0, 5);
      }

      const allSorted = [...playersWithOwnership].sort((a, b) => b.ownershipProjection - a.ownershipProjection);
      const chalkPlayer = allSorted[0] || null;
      const contrarian = allSorted.filter(p => Number(p.projectedPoints) >= (Number(allSorted[0]?.projectedPoints || 0) * 0.5)).pop() || null;

      res.json({
        slate: { id: slate.id, sport: slate.sport, platform: slate.platform, startTime: slate.startTime },
        positions: positionGroups,
        chalkPlayer,
        contrarianPlayer: contrarian,
        contestType,
      });
    } catch (err) {
      console.error("[Ownership] Error:", err);
      res.status(500).json({ message: "Failed to fetch ownership data" });
    }
  });

  app.get("/api/ownership/:slateId/projections", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier === "free") {
        return res.status(403).json({ message: "Upgrade to access ownership projections" });
      }

      const slateId = Number(req.params.slateId);
      const contestType = (req.query.contestType as ContestType) || "gpp_large";
      const slate = await storage.getSlate(slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const players = await storage.getPlayersBySlate(slateId);
      if (!players || players.length === 0) {
        return res.json({ slate: { id: slate.id, sport: slate.sport, platform: slate.platform }, contestType, players: [] });
      }

      const bdlStats = await fetchBDLStats(slate.sport);
      const results = await calculateOwnership(players, slate.sport, contestType, bdlStats);

      res.json({
        slate: { id: slate.id, sport: slate.sport, platform: slate.platform },
        contestType,
        players: results,
      });
    } catch (err) {
      console.error("[Ownership Projections] Error:", err);
      res.status(500).json({ message: "Failed to fetch ownership projections" });
    }
  });

  app.get(api.slates.getPlayers.path, async (req, res) => {
    const slateId = Number(req.params.id);
    let players = await storage.getPlayersBySlate(slateId);
    if (!players) {
       return res.status(404).json({ message: "Slate not found" });
    }
    const slate = await storage.getSlate(slateId);
    const isDK = !slate || slate.platform === "draftkings";
    if (slate && isDK) {
      players = await applyLiveDKStatuses(players, slate.draftGroupId, slate.sport);
    }
    players = players.filter(p => !isPlayerOut(p.injuryStatus));
    const bdlStats = slate ? await fetchBDLStats(slate.sport) : {};
    const ownershipResults = slate ? await calculateOwnership(players, slate.sport, "gpp_large", bdlStats) : [];
    const playersWithOwnership = computeOwnershipForPlayers(players, ownershipResults);

    const playerNames = playersWithOwnership.map((p: any) => p.name).filter(Boolean);
    if (playerNames.length > 0) {
      try {
        const historyRows = await storage.getRecentPlayerHistory(playerNames);
        const actualMap = new Map<string, { actualPoints: number; gamesTracked: number }>();
        for (const h of historyRows) {
          const existing = actualMap.get(h.playerName);
          if (!existing) {
            actualMap.set(h.playerName, { actualPoints: Number(h.actualPoints), gamesTracked: 1 });
          } else if (existing.gamesTracked < 5) {
            actualMap.set(h.playerName, {
              actualPoints: (existing.actualPoints * existing.gamesTracked + Number(h.actualPoints)) / (existing.gamesTracked + 1),
              gamesTracked: existing.gamesTracked + 1,
            });
          }
        }
        for (const p of playersWithOwnership) {
          const actual = actualMap.get((p as any).name);
          if (actual) {
            (p as any).recentActualAvg = Math.round(actual.actualPoints * 10) / 10;
            (p as any).gamesTracked = actual.gamesTracked;
          }
        }
      } catch (err) {
        console.error("[Players] history enrichment error:", err);
      }
    }

    // Add the canonical sorted pair used by saved stacks without changing
    // the existing player response contract.
    res.json(playersWithOwnership.map((player: any) => ({
      ...player,
      gameKey: getStackGameKey(player.gameInfo),
    })));
  });

  app.get("/api/players/all/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const platform = (req.query.platform as string) || "draftkings";
      const allSlates = await storage.getSlates();
      const sportSlates = allSlates
        .filter(s => s.sport === sport && s.platform === platform && s.isActive !== false);

      if (sportSlates.length === 0) {
        return res.json({ players: [], mainSlateId: null });
      }

      const mainSlate = sportSlates.find(s => s.isMain) || sportSlates[0];
      const seen = new Map<string, any>();

      const mainSlatePlayers = await storage.getPlayersBySlate(mainSlate.id);
      const boostByDkId = new Map<number, { boostScore: string | null; boostReason: string | null }>();
      const boostByNameTeam = new Map<string, { boostScore: string | null; boostReason: string | null }>();
      for (const p of mainSlatePlayers) {
        if (p.boostScore !== null) {
          if (p.draftKingsPlayerId) boostByDkId.set(p.draftKingsPlayerId, { boostScore: p.boostScore, boostReason: p.boostReason });
          boostByNameTeam.set(`${p.name}-${p.team}`.toLowerCase(), { boostScore: p.boostScore, boostReason: p.boostReason });
        }
      }

      for (const slate of sportSlates) {
        let players = slate.id === mainSlate.id
          ? mainSlatePlayers
          : await storage.getPlayersBySlate(slate.id);
        const isDK = slate.platform === "draftkings";
        if (isDK && slate.id !== mainSlate.id) {
          players = await applyLiveDKStatuses(players, slate.draftGroupId, slate.sport);
        } else if (isDK && slate.id === mainSlate.id) {
          players = await applyLiveDKStatuses(mainSlatePlayers, slate.draftGroupId, slate.sport);
        }
        players = players.filter(p => !isPlayerOut(p.injuryStatus));
        for (const p of players) {
          const key = p.draftKingsPlayerId
            ? `dk-${p.draftKingsPlayerId}`
            : `${p.name}-${p.team}`.toLowerCase();
          const existing = seen.get(key);

          let enriched = { ...p, _fromSlateId: slate.id, _isMainSlate: slate.id === mainSlate.id };
          if (enriched.boostScore === null && slate.id !== mainSlate.id) {
            const boost = (p.draftKingsPlayerId ? boostByDkId.get(p.draftKingsPlayerId) : null)
              || boostByNameTeam.get(`${p.name}-${p.team}`.toLowerCase());
            if (boost) {
              enriched = { ...enriched, boostScore: boost.boostScore, boostReason: boost.boostReason };
            }
          }

          if (!existing) {
            seen.set(key, enriched);
          } else if (slate.id === mainSlate.id && !existing._isMainSlate) {
            seen.set(key, enriched);
          }
        }
      }

      const merged = Array.from(seen.values()).map(({ _fromSlateId, _isMainSlate, ...p }) => ({
        ...p,
        slateId: mainSlate.id,
      }));

      res.json({ players: merged, mainSlateId: mainSlate.id });
    } catch (err: any) {
      console.error("[AllPlayers] Error:", err);
      res.status(500).json({ message: "Failed to fetch all players" });
    }
  });

  app.post(api.players.bulkCreate.path, async (req, res) => {
     try {
      const slateId = Number(req.params.id);
      const input = api.players.bulkCreate.input.parse(req.body);
      const playersWithSlate = input.map(p => ({ ...p, slateId }));
      const created = await storage.bulkCreatePlayers(playersWithSlate);
      res.status(201).json(created);
    } catch (err) {
       if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  async function applyLiveDKStatuses(players: Player[], draftGroupId: number | null, sport?: string): Promise<Player[]> {
    if (!draftGroupId) return players;
    let draftables: Awaited<ReturnType<typeof fetchDraftables>> = [];
    try {
      draftables = await fetchDraftables(draftGroupId);
    } catch {
      return players;
    }
    if (draftables.length === 0) return players;

    const liveStatuses = new Map<number, string>();
    const liveStarters = new Set<number>();
    for (const d of draftables) {
      if (!d.draftableId) continue;
      const mapped = mapDKStatus(d.status || "", d.newsStatus || "");
      if (mapped.injuryStatus !== "Healthy") {
        liveStatuses.set(d.draftableId, mapped.injuryStatus);
      }
      if (isPlayerConfirmedStarter(d)) {
        liveStarters.add(d.draftableId);
      }
    }

    let espnStarters = new Set<string>();
    if (sport && liveStarters.size === 0) {
      try {
        espnStarters = await fetchESPNStarters(sport);
      } catch {}
    }

    if (liveStatuses.size === 0 && liveStarters.size === 0 && espnStarters.size === 0) return players;
    return players.map(p => {
      // Practice-squad status is a derived ESPN roster exclusion.  DK's
      // healthy/empty status must never clear its marker (or restore it into
      // a playable row) while that roster overlay is in effect.
      if (p.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL) {
        return protectNFLPracticeSquadMarker(p);
      }
      if (isGolfMissedCutMarkerForDraftGroup(p, draftGroupId)) {
        return protectGolfMissedCutMarker(p, draftGroupId);
      }
      if (p.injuryDetail === RETIRED_PLAYER_DETAIL) {
        return { ...p, injuryStatus: "OUT", projectedPoints: "0", fppg: "0", isConfirmedStarter: false };
      }
      if (!p.draftKingsPlayerId) return p;
      let updated = { ...p };
      const isDKStarter = liveStarters.has(p.draftKingsPlayerId);
      const isESPNStarter = espnStarters.size > 0 && espnStarters.has((p.name || "").toLowerCase().trim());
      updated.isConfirmedStarter = isDKStarter || isESPNStarter;
      const liveStatus = liveStatuses.get(p.draftKingsPlayerId);
      if (liveStatus) {
        updated.injuryStatus = liveStatus;
        updated.injuryDetail = liveStatus;
      } else if (isPlayerOut(p.injuryStatus) || p.injuryStatus === "Questionable" || p.injuryStatus === "Doubtful" || p.injuryStatus === "Probable" || p.injuryStatus === "GTD" || p.injuryStatus === "DTD") {
        if (!liveStatuses.has(p.draftKingsPlayerId)) {
          updated.injuryStatus = null;
          updated.injuryDetail = null;
        }
      }
      return updated;
    });
  }

  app.post(api.optimizer.optimize.path, async (req, res) => {
    const optimizeStartTime = Date.now();
    const optimizeDeadline = optimizeStartTime + 26_000;
    try {
      const constraints = api.optimizer.optimize.input.parse(req.body);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      if (slate.isActive === false || new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;
      validateNflPortfolioContext(constraints.nflPortfolio, slate, platform, constraints.contestType);

      if (isLoggedIn(req)) {
        const userId = getSessionUserId(req)!;
        const sub = await storage.getSubscription(userId);
        const optUser = await storage.getUser(userId);
        const tier = optUser?.isAdmin ? "pro" : (sub?.tier || "free");
        if (tier === "free") {
          const lineupCount = await storage.getLineupCount(userId);
          if (lineupCount >= 1) {
            // Free users can still optimize, just can't save more than 1
          }
        }
      }

      let allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      if (slate.platform === "draftkings") {
        allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
      }

      let userOverrides: any[] = [];
      if (isLoggedIn(req)) {
        const overrideUserId = getSessionUserId(req)!;
        const overrideSub = await storage.getSubscription(overrideUserId);
        const overrideUser = await storage.getUser(overrideUserId);
        const overrideTier = overrideUser?.isAdmin ? "pro" : (overrideSub?.tier || "free");
        if (overrideTier !== "free") {
          userOverrides = resolveConfigurationOverrides(await storage.getPlayerOverrides(overrideUserId, constraints.slateId), allPlayers);
        }
      }
      const overrideMap = new Map(userOverrides.map(o => [o.playerId, o]));
      constraints.playerProjections = {
        ...constraints.playerProjections,
        ...Object.fromEntries(userOverrides.filter(o => o.customProjection != null).map(o => [o.playerId, Number(o.customProjection)])),
      };
      validateExposureBounds(req.body);
      const normalBounds = {
        globalMaxExposure: req.body.globalMaxExposure,
        globalMinExposure: req.body.globalMinExposure,
        exposureLimits: mergeExposureMaximums(req.body.exposureLimits, Object.fromEntries(userOverrides.filter(o => o.maxExposure != null).map(o => [o.playerId, o.maxExposure]))),
        minExposureLimits: mergeExposureMinimums(req.body.minExposureLimits, Object.fromEntries(userOverrides.filter(o => o.minExposure != null).map(o => [o.playerId, o.minExposure]))),
      };

      // With denominator one any maximum below 100 allows zero appearances.
      const overrideExcluded = [
        ...userOverrides.filter(o => o.isExcluded).map(o => o.playerId),
        ...allPlayers.filter(p => Math.min(normalBounds.globalMaxExposure ?? 100, normalBounds.exposureLimits[p.id] ?? 100) < 100).map(p => p.id),
      ];
      const overrideLocked = [
        ...userOverrides.filter(o => o.isLocked).map(o => o.playerId),
        ...Object.entries(normalBounds.minExposureLimits).filter(([, min]) => min > 0).map(([id]) => Number(id)),
      ];
      const mergedLocked = [...new Set([...constraints.lockedPlayerIds, ...overrideLocked])];
      validateExposureBounds({ ...normalBounds, lockedPlayerIds: mergedLocked });
      if (mergedLocked.some(id => overrideExcluded.includes(id))) {
        return res.status(400).json({ message: "A required player is excluded or capped below 100%. Use batch generation for fractional exposure caps." });
      }

      const autoExcluded = allPlayers
        .filter(p => isPlayerOut(p.injuryStatus) && !mergedLocked.includes(p.id))
        .map(p => p.id);
      const isDKOpt = slate.platform === "draftkings";
      const { inactiveIds: inactiveExcluded } = isDKOpt ? await getInactivePlayerIds(allPlayers, slate.sport) : { inactiveIds: [] };
      const filteredInactive = inactiveExcluded.filter(id => !mergedLocked.includes(id));
      const mergedExclusions = [...new Set([...constraints.excludedPlayerIds, ...autoExcluded, ...filteredInactive, ...overrideExcluded])];

      const standardMinProjectionInput = applyExplicitProjections(
        allPlayers,
        constraints.playerProjections,
      );
      const standardMinProjectionViolation = findLockedMinProjectionViolation(
        standardMinProjectionInput,
        constraints.minProjection,
        mergedLocked,
      );
      if (standardMinProjectionViolation) {
        return res.status(400).json({
          message: minProjectionLockMessage(standardMinProjectionViolation),
        });
      }
      const standardMinProjectionEligibleIds = constraints.minProjection !== undefined && constraints.minProjection > 0
        ? new Set(filterByMinProjection(standardMinProjectionInput, constraints.minProjection).map(p => p.id))
        : undefined;

      const scoutMap = buildScoutMap(slate.sport);
      const useBoosts = req.body.useBoosts !== false;

      let pool = allPlayers.map(p => {
        const override = overrideMap.get(p.id);
        const customProj = constraints.playerProjections?.[p.id.toString()]
          ?? (override?.customProjection != null ? Number(override.customProjection) : undefined);
        let proj = customProj !== undefined ? Number(customProj) : Number(p.projectedPoints);
        if (override?.boostPercent && override.boostPercent > 0) {
          proj = Math.round(proj * (1 + override.boostPercent / 100) * 10) / 10;
        }
        if (p.isConfirmedStarter) {
          proj = Math.round(proj * 1.05 * 10) / 10;
        }
        if (useBoosts && p.boostScore) {
          const boostPct = Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008));
          proj = Math.round(proj * (1 + boostPct) * 10) / 10;
        }
        proj = applyScoutToProjection(proj, p.name, scoutMap, customProj !== undefined);
        if (isPlayerOut(p.injuryStatus)) proj = 0;
        else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") proj = proj * 0.75;
        else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") proj = proj * 0.9;
        return { ...p, projectedPoints: proj.toString() };
      });

      pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyMarketProjectionBlend(pool, slate.sport);
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

      if (constraints.outperformerMode) {
        pool = await applyOutperformerMode(pool, slate.sport);
      }
      // Projection/market/scout transforms must not restore points to a
      // confirmed missed-cut marker (the marker is a hard derived status).
      pool = pool.map(p => protectGolfMissedCutMarker(p, slate.draftGroupId));

      // Eligibility is decided from raw projections plus explicit request
      // projections. Apply those IDs to the fully adjusted pool only after
      // all server-only score transforms have completed.
      if (standardMinProjectionEligibleIds) {
        pool = pool.filter(p => standardMinProjectionEligibleIds.has(p.id));
      }

      const salaryFilteredPool = (constraints.playerMinSalary || constraints.playerMaxSalary)
        ? pool.filter(p => {
            if (mergedLocked.includes(p.id)) return true;
            // The player minimum salary is intended to avoid cheap skill
            // players.  NFL DST/DEF is intentionally exempt so a cheap
            // defense remains available to complete the roster.
            if (constraints.playerMinSalary && !isDefense(p.position) && p.salary < constraints.playerMinSalary) return false;
            if (constraints.playerMaxSalary && p.salary > constraints.playerMaxSalary) return false;
            return true;
          })
        : pool;

      const standardRequiredPositionMessage = minProjectionRequiredPositionMessage(
        salaryFilteredPool.filter(p => !mergedExclusions.includes(p.id)),
        constraints.minProjection,
        getPlatformConfig(slate.sport, platform).positionConstraints,
      );
      if (standardRequiredPositionMessage) {
        return res.status(400).json({ message: standardRequiredPositionMessage });
      }

      const contestType = constraints.contestType || "cash";
      let ownershipByPlayerId: Map<number, number> | undefined;
      if (!constraints.nflPortfolio?.enabled && slate.sport.toUpperCase() === "NFL" && contestType === "gpp") {
        try {
          const ownership = await calculateOwnership(salaryFilteredPool, "NFL", "gpp_large");
          ownershipByPlayerId = new Map(ownership.map(p => [p.playerId, p.projectedOwnership]));
        } catch (error) {
          console.warn("[NFL Optimizer] Ownership calculation unavailable; using projection-based GPP scoring.", error);
        }
      }
      await yieldToEventLoop();
      if (constraints.nflPortfolio?.enabled) {
        const ownershipMap = await portfolioOwnership(salaryFilteredPool, constraints.nflPortfolio);
        const portfolio = await generateNflPortfolio({
          pool: salaryFilteredPool, settings: constraints.nflPortfolio, count: 1,
          baseConstraints: { ...constraints, ...normalBounds, minProjection: undefined, lockedPlayerIds: mergedLocked, excludedPlayerIds: mergedExclusions },
          ownershipMap, deadline: optimizeDeadline,
          solve: (candidatePool, candidateConstraints) => solveLineup(candidatePool, candidateConstraints, slate.sport, platform, candidateConstraints.ownershipMap ?? ownershipMap, { deadline: optimizeDeadline, timeoutMs: 2000 }),
        });
        assertLineupExposures(portfolio.lineups, c => c.lineup.map((p: Player) => p.id), { ...normalBounds, lockedPlayerIds: mergedLocked });
        return res.json({ ...(portfolio.lineups[0] ?? { lineup: [], totalSalary: 0, totalProjectedPoints: 0 }), platform, nflPortfolioReport: portfolio.report, partial: portfolio.report.partial });
      }
      const result = solveLineup(
        salaryFilteredPool,
        {
          ...constraints,
          minProjection: undefined,
          lockedPlayerIds: mergedLocked,
          excludedPlayerIds: mergedExclusions,
          contestType,
        },
        slate.sport,
        platform,
        ownershipByPlayerId,
        { deadline: optimizeDeadline, timeoutMs: 2_000 },
      );

      if (result.error) {
        if ((normalBounds.globalMaxExposure ?? 100) < 100 || Object.values(normalBounds.exposureLimits).some(max => max < 100)) {
          return res.status(400).json({ message: "No single lineup satisfies the saved exposure caps. Sub-100% caps allow zero appearances in a one-lineup batch. Use Pro Normal or Pro Sim batch generation.", ...result });
        }
        if (constraints.projectedPointsFloor) {
          return res.json({
            lineup: [],
            totalSalary: 0,
            totalProjectedPoints: 0,
            platform,
            message: `No lineups could reach the ${constraints.projectedPointsFloor}-point floor. Try lowering it or relaxing other constraints.`,
          });
        }
        return res.status(400).json(result);
      }

      assertLineupExposures([result], c => c.lineup.map(p => p.id), { ...normalBounds, lockedPlayerIds: mergedLocked });
      res.json({
        ...result,
        platform,
        partial: !!result.timedOut,
        message: result.timedOut
          ? "Partial results: returned a validated lineup before the solver time budget was reached."
          : undefined,
      });

    } catch (err) {
       if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        console.error(err);
        res.status(500).json({ message: "Optimizer failed" });
      }
    }
  });

  app.get(api.lineups.list.path, async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    try {
      const userId = getSessionUserId(req)!;
      const lineups = await storage.getLineups(userId);
      const enrichmentLoader = createLineupEnrichmentLoader({
        getPlayersBySlate: storage.getPlayersBySlate.bind(storage),
        getSlate: storage.getSlate.bind(storage),
        fetchBDLStats,
        calculateOwnership,
        computeOwnershipForPlayers,
      });
      const enriched = await Promise.all(lineups.map(async (lineup: any) => {
        const { allWithOwnership, playerIdSet, gameType } =
          await enrichmentLoader.getSlateEnrichment(lineup.slateId);
        const rosterOwn = allWithOwnership
          .filter(p => lineup.playerIds.includes(p.id))
          .reduce((sum, p) => sum + p.ownershipProjection, 0);
        const resolvedCount = lineup.playerIds.filter((id: number) => playerIdSet.has(id)).length;
        const isOrphaned = resolvedCount < lineup.playerIds.length;
        return {
          ...lineup,
          gameType,
          isShowdown: gameType?.toLowerCase() === "showdown",
          totalOwnership: Math.round(rosterOwn * 10) / 10,
          isOrphaned,
        };
      }));

      const snapshotNames = new Set<string>();
      for (const lu of enriched) {
        const snap = lu.playerSnapshot && Array.isArray(lu.playerSnapshot) ? lu.playerSnapshot as any[] : [];
        for (const p of snap) { if (p.name) snapshotNames.add(p.name); }
      }
      if (snapshotNames.size > 0) {
        try {
          const historyRows = await storage.getRecentPlayerHistory(Array.from(snapshotNames));
          const actualMap = new Map<string, { actualPoints: number; gamesTracked: number }>();
          for (const h of historyRows) {
            const existing = actualMap.get(h.playerName);
            if (!existing) {
              actualMap.set(h.playerName, { actualPoints: Number(h.actualPoints), gamesTracked: 1 });
            } else if (existing.gamesTracked < 5) {
              actualMap.set(h.playerName, {
                actualPoints: (existing.actualPoints * existing.gamesTracked + Number(h.actualPoints)) / (existing.gamesTracked + 1),
                gamesTracked: existing.gamesTracked + 1,
              });
            }
          }
          for (const lu of enriched) {
            const snap = lu.playerSnapshot && Array.isArray(lu.playerSnapshot) ? lu.playerSnapshot as any[] : [];
            for (const p of snap) {
              const actual = actualMap.get(p.name);
              if (actual) {
                (p as any).recentActualAvg = Math.round(actual.actualPoints * 10) / 10;
                (p as any).gamesTracked = actual.gamesTracked;
              }
            }
          }
        } catch (err) {
          console.error("[Lineups] snapshot enrichment error:", err);
        }
      }

      return res.json(enriched);
    } catch (err) {
      console.error("[Lineups] failed to load lineups:", err);
      return res.status(500).json({ message: "Failed to fetch lineups" });
    }
  });

  app.post(api.lineups.create.path, async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    try {
      const input = api.lineups.create.input.parse(req.body);
      const userId = getSessionUserId(req)!;

      const sub = await storage.getSubscription(userId);
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const tier = isAdmin ? "pro" : (sub?.tier || "free");

      {
        const maxPerSport = isAdmin ? 500 : tier === "pro" ? 300 : tier === "star" ? 20 : 1;
        const sportCount = await storage.getLineupCountBySport(userId, input.sport);
        if (sportCount >= maxPerSport) {
          const upgradeMsg = isAdmin
            ? "You've reached the admin maximum of 500 saved teams per sport."
            : tier === "free"
            ? "Contender plan allows 1 saved team per sport. Delete your existing lineup to save a new one, or upgrade to Sharpshooter for 20 teams or Champion for 300 teams per sport."
            : tier === "star"
            ? "Sharpshooter plan allows 20 saved teams per sport. Upgrade to Champion for 300 teams per sport."
            : "You've reached the maximum of 300 saved teams per sport.";
          return res.status(403).json({ 
            message: upgradeMsg,
            requiresUpgrade: !isAdmin && tier !== "pro"
          });
        }
      }

      const allPlayers = await storage.getPlayersBySlate(input.slateId);
      const rosterPlayers = allPlayers.filter(p => input.playerIds.includes(p.id));
      const missedCutPlayer = rosterPlayers.find(p => isGolfMissedCutMarkerForDraftGroup(p, null));
      if (missedCutPlayer) {
        return res.status(400).json({
          message: `Golfer ${missedCutPlayer.name} has missed the cut and cannot be saved.`,
        });
      }

      const slate = await storage.getSlate(input.slateId);
      if (!slate) {
        return res.status(400).json({ message: "Slate not found" });
      }
      const config = getPlatformConfig(slate.sport, input.platform as Platform);
      if (rosterPlayers.length !== config.rosterSize) {
        return res.status(400).json({ message: `Roster must have exactly ${config.rosterSize} players` });
      }
      const totalSalary = rosterPlayers.reduce((s, p) => s + p.salary, 0);
      if (totalSalary > config.salaryCap) {
        return res.status(400).json({ message: `Total salary $${totalSalary.toLocaleString()} exceeds cap of $${config.salaryCap.toLocaleString()}` });
      }
      const slotResult = assignPlayersToSlots(rosterPlayers, config.slots, slate.sport);
      const unfilledSlots = config.slots.filter(s => !slotResult[s]);
      if (unfilledSlots.length > 0) {
        return res.status(400).json({ message: `Cannot fill all roster slots. Missing: ${unfilledSlots.map(s => s.replace(/\d+$/, "")).join(", ")}` });
      }

      const playerSnapshot = rosterPlayers.map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        position: p.position,
        salary: p.salary,
        fppg: p.fppg,
        projectedPoints: p.projectedPoints,
        opponent: p.opponent,
         gameInfo: p.gameInfo,
        draftKingsPlayerId: p.draftKingsPlayerId,
        boostScore: p.boostScore,
        boostReason: p.boostReason,
      }));

      const lineup = await storage.createLineup({ ...input, userId, playerSnapshot });
      res.status(201).json(lineup);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });
  
  app.get("/api/lineups/review", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "star" && tier !== "pro") {
      return res.status(403).json({ message: "Review lineups require a Star or Pro subscription." });
    }

    const reviewLineups = await storage.getReviewLineups(userId);

    const sportCache = new Map<string, { history: any[]; winLineups: any[] }>();

    const enriched = await Promise.all(reviewLineups.map(async (lineup: any) => {
      let players: any[];
      if (lineup.playerSnapshot && Array.isArray(lineup.playerSnapshot) && lineup.playerSnapshot.length > 0) {
        players = lineup.playerSnapshot;
      } else {
        const allPlayers = await storage.getPlayersBySlate(lineup.slateId);
        players = allPlayers.filter((p: any) => lineup.playerIds.includes(p.id));
      }

      try {
        const sport = lineup.sport;
        if (!sportCache.has(sport)) {
          const history = await storage.getPlayerHistoryBySport(sport, 5000);
          const winLineups = await storage.getWinningLineups(sport, 50);
          sportCache.set(sport, { history, winLineups });
        }
        const { history, winLineups } = sportCache.get(sport)!;
        const playerNames = players.map((p: any) => p.name);

        const actualByName = new Map<string, { actualPoints: number; gamesTracked: number }>();
        for (const h of history) {
          if (!playerNames.includes(h.playerName)) continue;
          if (h.actualPoints == null || Number(h.actualPoints) <= 0) continue;
          const existing = actualByName.get(h.playerName);
          if (!existing) {
            actualByName.set(h.playerName, { actualPoints: Number(h.actualPoints), gamesTracked: 1 });
          } else if (existing.gamesTracked < 5) {
            actualByName.set(h.playerName, {
              actualPoints: (existing.actualPoints * existing.gamesTracked + Number(h.actualPoints)) / (existing.gamesTracked + 1),
              gamesTracked: existing.gamesTracked + 1,
            });
          }
        }

        const winFreq = new Map<string, { count: number; avgActual: number }>();
        for (const wl of winLineups) {
          const wPlayers = (wl.playerData as any[]) || [];
          const seen = new Set<string>();
          for (const wp of wPlayers) {
            if (!playerNames.includes(wp.name) || seen.has(wp.name)) continue;
            seen.add(wp.name);
            const entry = winFreq.get(wp.name) || { count: 0, avgActual: 0 };
            entry.avgActual = (entry.avgActual * entry.count + (wp.actualPoints || 0)) / (entry.count + 1);
            entry.count++;
            winFreq.set(wp.name, entry);
          }
        }

        const totalSlates = winLineups.length;
        players = players.map((p: any) => {
          const enriched = { ...p };
          const actual = actualByName.get(p.name);
          if (actual) {
            enriched.recentActualAvg = Math.round(actual.actualPoints * 10) / 10;
            enriched.gamesTracked = actual.gamesTracked;
          }
          const wf = winFreq.get(p.name);
          if (wf && wf.count >= 1 && totalSlates >= 2) {
            enriched.winLineupCount = wf.count;
            enriched.winLineupTotal = totalSlates;
            enriched.winAvgActual = Math.round(wf.avgActual * 10) / 10;
          }
          return enriched;
        });
      } catch (err) {
        console.error("[ReviewLineup] enrichment error:", err);
      }

      return { ...lineup, players };
    }));

    res.json(enriched);
  });

  app.get("/api/lineups/:id", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const id = Number(req.params.id);
    const lineup = await storage.getLineup(id);
    if (!lineup) return res.sendStatus(404);
    const userId = getSessionUserId(req)!;
    if (lineup.userId !== userId) return res.sendStatus(403);

    const allPlayers = await storage.getPlayersBySlate(lineup.slateId);
    const slate = await storage.getSlate(lineup.slateId);
    let rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
    const isOrphaned = rosterPlayers.length < lineup.playerIds.length;
    if (isOrphaned && lineup.playerSnapshot && Array.isArray(lineup.playerSnapshot) && (lineup.playerSnapshot as any[]).length > 0) {
      rosterPlayers = lineup.playerSnapshot as any;
    }

    try {
      const sport = lineup.sport;
      const playerNames = rosterPlayers.map((p: any) => p.name);
      const history = await storage.getPlayerHistoryBySport(sport, 5000);
      const winningLineups = await storage.getWinningLineups(sport, 50);

      const actualByName = new Map<string, { actualPoints: number; gamesTracked: number }>();
      for (const h of history) {
        if (!playerNames.includes(h.playerName)) continue;
        if (h.actualPoints == null || Number(h.actualPoints) <= 0) continue;
        const existing = actualByName.get(h.playerName);
        if (!existing) {
          actualByName.set(h.playerName, { actualPoints: Number(h.actualPoints), gamesTracked: 1 });
        } else if (existing.gamesTracked < 5) {
          actualByName.set(h.playerName, {
            actualPoints: (existing.actualPoints * existing.gamesTracked + Number(h.actualPoints)) / (existing.gamesTracked + 1),
            gamesTracked: existing.gamesTracked + 1,
          });
        }
      }

      const winFreq = new Map<string, { count: number; avgActual: number; avgValue: number }>();
      for (const wl of winningLineups) {
        const wPlayers = (wl.playerData as any[]) || [];
        const seen = new Set<string>();
        for (const wp of wPlayers) {
          if (!playerNames.includes(wp.name) || seen.has(wp.name)) continue;
          seen.add(wp.name);
          const entry = winFreq.get(wp.name) || { count: 0, avgActual: 0, avgValue: 0 };
          entry.avgActual = (entry.avgActual * entry.count + (wp.actualPoints || 0)) / (entry.count + 1);
          entry.avgValue = (entry.avgValue * entry.count + (wp.value || 0)) / (entry.count + 1);
          entry.count++;
          winFreq.set(wp.name, entry);
        }
      }

      const totalSlates = winningLineups.length;

      rosterPlayers = rosterPlayers.map((p: any) => {
        const enriched = { ...p };
        const actual = actualByName.get(p.name);
        if (actual) {
          enriched.recentActualAvg = Math.round(actual.actualPoints * 10) / 10;
          enriched.gamesTracked = actual.gamesTracked;
        }
        const wf = winFreq.get(p.name);
        if (wf && wf.count >= 1 && totalSlates >= 2) {
          enriched.winLineupCount = wf.count;
          enriched.winLineupTotal = totalSlates;
          enriched.winAvgActual = Math.round(wf.avgActual * 10) / 10;
          enriched.winAvgValue = Math.round(wf.avgValue * 10) / 10;
          if (!enriched.boostScore && !enriched.boostReason) {
            const freqPct = (wf.count / totalSlates) * 100;
            const reasons: string[] = [];
            if (freqPct >= 50) {
              enriched.boostScore = "3.0";
              reasons.push(`Optimal regular: appeared in ${wf.count}/${totalSlates} winning lineups (${freqPct.toFixed(0)}%) — avg ${wf.avgActual.toFixed(1)} actual pts`);
            } else if (freqPct >= 25) {
              enriched.boostScore = "2.0";
              reasons.push(`Winning lineup pick: appeared in ${wf.count}/${totalSlates} winning lineups (${freqPct.toFixed(0)}%) — avg ${wf.avgActual.toFixed(1)} actual pts`);
            } else if (wf.count >= 2) {
              enriched.boostScore = "1.0";
              reasons.push(`Past optimal: appeared in ${wf.count}/${totalSlates} winning lineups — avg ${wf.avgActual.toFixed(1)} actual pts`);
            }
            if (reasons.length > 0) enriched.boostReason = reasons.join("; ");
          }
        }
        return enriched;
      });
    } catch (err) {
      console.error("[LineupDetail] enrichment error:", err);
    }

    const gameType = slate?.gameType || null;
    res.json({
      ...lineup,
      gameType,
      isShowdown: gameType?.toLowerCase() === "showdown",
      players: rosterPlayers,
      allPlayers,
      isOrphaned,
    });
  });

  app.patch("/api/lineups/:id", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const id = Number(req.params.id);
    const lineup = await storage.getLineup(id);
    if (!lineup) return res.sendStatus(404);
    const userId = getSessionUserId(req)!;
    if (lineup.userId !== userId) return res.sendStatus(403);

    const { playerIds } = req.body;
    if (!Array.isArray(playerIds) || playerIds.length === 0) {
      return res.status(400).json({ message: "playerIds array required" });
    }

    const allPlayers = await storage.getPlayersBySlate(lineup.slateId);
    const rosterPlayers = allPlayers.filter(p => playerIds.includes(p.id));
    const missedCutPlayer = rosterPlayers.find(p => isGolfMissedCutMarkerForDraftGroup(p, null));
    if (missedCutPlayer) {
      return res.status(400).json({
        message: `Golfer ${missedCutPlayer.name} has missed the cut and cannot be saved.`,
      });
    }

    if (rosterPlayers.length !== playerIds.length) {
      return res.status(400).json({ message: "One or more player IDs are invalid for this slate" });
    }

    const slate = await storage.getSlate(lineup.slateId);
    if (!slate) return res.status(400).json({ message: "Slate not found" });

    const config = getPlatformConfig(slate.sport, lineup.platform as Platform);
    if (rosterPlayers.length !== config.rosterSize) {
      return res.status(400).json({ message: `Roster must have exactly ${config.rosterSize} players` });
    }

    const totalSalary = rosterPlayers.reduce((s, p) => s + p.salary, 0);
    if (totalSalary > config.salaryCap) {
      return res.status(400).json({ message: `Total salary $${totalSalary.toLocaleString()} exceeds cap of $${config.salaryCap.toLocaleString()}` });
    }

    const slotResult = assignPlayersToSlots(rosterPlayers, config.slots, slate.sport);
    const unfilledSlots = config.slots.filter(s => !slotResult[s]);
    if (unfilledSlots.length > 0) {
      return res.status(400).json({ message: `Cannot fill all roster slots. Missing: ${unfilledSlots.map(s => s.replace(/\d+$/, "")).join(", ")}` });
    }

    const totalProjectedPoints = rosterPlayers.reduce((s, p) => s + Number(p.projectedPoints), 0);

    const playerSnapshot = rosterPlayers.map(p => ({
      id: p.id, name: p.name, team: p.team, position: p.position,
      salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
      opponent: p.opponent, gameInfo: p.gameInfo,
      draftKingsPlayerId: p.draftKingsPlayerId,
      boostScore: p.boostScore, boostReason: p.boostReason,
    }));

    const updated = await storage.updateLineup(id, {
      playerIds,
      totalSalary,
      totalProjectedPoints: totalProjectedPoints.toFixed(1),
      playerSnapshot,
    });

    res.json({ ...updated, players: rosterPlayers });
  });

  app.delete(api.lineups.delete.path, async (req, res) => {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const id = Number(req.params.id);
      const lineup = await storage.getLineup(id);
      if (!lineup) return res.sendStatus(404);
      const userId = getSessionUserId(req)!;
      if (lineup.userId !== userId) return res.sendStatus(403);
      await storage.deleteLineup(id);
      res.sendStatus(204);
  });

  app.post("/api/lineups/bulk-delete", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No lineup IDs provided" });
    let deleted = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        const lineup = await storage.getLineup(Number(id));
        if (!lineup) {
          errors.push(`Lineup ${id}: not found`);
          continue;
        }
        if (lineup.userId !== userId) {
          errors.push(`Lineup ${id}: forbidden`);
          continue;
        }
        await storage.deleteLineup(Number(id));
        deleted++;
      } catch (err: any) {
        errors.push(`Lineup ${id}: ${err.message}`);
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ deleted, errors });
    }
    res.json({ deleted });
  });

  app.post("/api/lineups/bulk-generate", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "No lineup IDs provided" });

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "pro" && tier !== "star") {
      return res.status(403).json({ message: "Sharpshooter or Champion subscription required.", requiresUpgrade: true });
    }

    const bulkStartTime = Date.now();
    const bulkSolveDeadline = bulkStartTime + 26_000;
    let bulkTimedOut = false;
    const results: { id: number; status: string; error?: string }[] = [];
    const pendingBulk: Array<{ slateId: number; playerIds: number[]; persist: () => Promise<void> }> = [];

    const slateCache = new Map<number, { slate: any; pool: Player[]; allPlayers: Player[]; baseExcluded: number[]; platform: Platform; lockedOverrideIds: number[]; overrideExposure: Record<string, { min?: number; max?: number }> }>();
    const usedLineupKeys = new Set<string>();
    const playerAppearances: Record<number, number> = {};
    const totalCount = ids.length;
    const globalMaxExposure = typeof req.body.globalMaxExposure === "number" ? req.body.globalMaxExposure : 80;
    const globalMinExposureBulk = typeof req.body.globalMinExposure === "number" ? req.body.globalMinExposure : undefined;
    try {
      validateExposureBounds({
        globalMaxExposure: req.body.globalMaxExposure ?? globalMaxExposure,
        globalMinExposure: req.body.globalMinExposure,
        exposureLimits: req.body.exposureLimits, minExposureLimits: req.body.minExposureLimits,
      });
    } catch (error) {
      return res.status(400).json({ message: error instanceof z.ZodError ? error.errors[0].message : "Invalid exposure settings" });
    }
    const projFloor = typeof req.body.projFloor === "number" && req.body.projFloor > 0 ? req.body.projFloor : null;
    const minSalary = typeof req.body.minSalary === "number" ? req.body.minSalary : undefined;
    const maxSalary = typeof req.body.maxSalary === "number" ? req.body.maxSalary : undefined;
    const overrideSlateId = typeof req.body.slateId === "number" ? req.body.slateId : null;
    const preserveSourceSlateId = req.body.preserveSourceSlateId === true;
    const requestedDraftGroupId = req.body.draftGroupId == null ? null : Number(req.body.draftGroupId);
    if (requestedDraftGroupId !== null &&
        (!Number.isSafeInteger(requestedDraftGroupId) || requestedDraftGroupId <= 0)) {
      return res.status(400).json({ message: "draftGroupId must be a positive integer" });
    }
    let requestedTargetSlate: Slate | undefined;
    if (overrideSlateId !== null) {
      requestedTargetSlate = await storage.getSlate(overrideSlateId);
      if (!requestedTargetSlate) {
        return res.status(400).json({ message: "Target slate not found" });
      }
      if (requestedDraftGroupId !== null &&
          requestedTargetSlate.draftGroupId !== requestedDraftGroupId) {
        return res.status(400).json({
          message: `Submitted draftGroupId ${requestedDraftGroupId} does not match target slate ${overrideSlateId} (DG ${requestedTargetSlate.draftGroupId ?? "unknown"})`,
        });
      }
    } else if (requestedDraftGroupId !== null) {
      return res.status(400).json({ message: "draftGroupId requires a target slateId" });
    }
    const origSlatePerGroup = new Map<number, number>();

    for (const id of ids) {
      if (Date.now() >= bulkSolveDeadline) {
        bulkTimedOut = true;
        for (const remainingId of ids.slice(results.length)) {
          results.push({ id: Number(remainingId), status: "skipped", error: "Partial results: bulk solver time budget reached." });
        }
        break;
      }
      const lineup = await storage.getLineup(Number(id));
      if (!lineup || lineup.userId !== userId) {
        results.push({ id, status: "skipped", error: "Not found or not yours" });
        continue;
      }

      const effectiveSlateId = overrideSlateId || lineup.slateId;
      if (overrideSlateId && !origSlatePerGroup.has(effectiveSlateId)) {
        origSlatePerGroup.set(effectiveSlateId, lineup.slateId);
      }
      if (overrideSlateId) {
        const overrideSlate = await storage.getSlate(overrideSlateId);
        if (overrideSlate && (overrideSlate.sport !== lineup.sport || overrideSlate.platform !== (lineup.platform || "draftkings"))) {
          results.push({ id, status: "skipped", error: "Override slate sport/platform does not match lineup" });
          continue;
        }
      }
      let cached = slateCache.get(effectiveSlateId);
      if (!cached) {
        const slate = await storage.getSlate(effectiveSlateId);
        if (!slate) {
          results.push({ id, status: "skipped", error: "Slate no longer available" });
          continue;
        }
        if (slate.isActive === false || new Date(slate.startTime) <= new Date()) {
          results.push({ id, status: "skipped", error: "Slate already started" });
          continue;
        }

        const platform = (lineup.platform || "draftkings") as Platform;
        let allPlayers = await storage.getPlayersBySlate(effectiveSlateId);
        if (allPlayers.length === 0) {
          results.push({ id, status: "skipped", error: "Slate data was refreshed. Generate new lineups from the current slate first." });
          continue;
        }

        if (slate.platform === "draftkings") {
          allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
        }

        const useBoosts = req.body.useBoosts !== false;
        const useCeilingMode = req.body.ceilingMode === true;
        const useLeverageMode = req.body.leverageMode === true;
        const regenScoutMap = buildScoutMap(slate.sport);

        const { overrideMap: bulkOverrideMap, excluded: bulkOverrideExcluded, locked: bulkOverrideLocked, exposureMap: bulkCrossRefExposure } = await loadOverridesWithCrossRef(userId, effectiveSlateId, overrideSlateId ? (origSlatePerGroup.get(effectiveSlateId) ?? null) : null, allPlayers);

        let pool = allPlayers
          .filter(p => !bulkOverrideExcluded.has(p.id))
          .map(p => {
          const override = bulkOverrideMap.get(p.id);
          let pts = override?.customProjection != null ? Number(override.customProjection) : Number(p.projectedPoints);
          if (override?.boostPercent && override.boostPercent > 0) {
            pts = Math.round(pts * (1 + override.boostPercent / 100) * 10) / 10;
          }
          if (p.isConfirmedStarter) {
            pts = Math.round(pts * 1.05 * 10) / 10;
          }
          if (useBoosts && p.boostScore) {
            const boostPct = Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008));
            pts = Math.round(pts * (1 + boostPct) * 10) / 10;
          }
          pts = applyScoutToProjection(pts, p.name, regenScoutMap, override?.customProjection != null);
          if (isPlayerOut(p.injuryStatus)) pts = 0;
          else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") pts *= 0.75;
          else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") pts *= 0.9;
          return { ...p, projectedPoints: pts.toString() };
        });

        pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyMarketProjectionBlend(pool, slate.sport);
        pool = await applyWinningLineupAdjustment(pool, slate.sport);

        if (req.body.outperformerMode === true) {
          pool = await applyOutperformerMode(pool, slate.sport);
        }

        const regenProfile = await getHistoricalProfile(slate.sport);
        if (regenProfile.ready) {
          pool = applyHistoricalAdjustments(pool, regenProfile);
        }

        if (useCeilingMode) {
          pool = applyCeilingMode(pool, slate.sport);
        }

        const bdlStats = await fetchBDLStats(slate.sport);
        const ownershipResults = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStats);
        const playersWithOwnership = computeOwnershipForPlayers(pool, ownershipResults);
        if (useLeverageMode) {
          pool = applyLeverageMode(playersWithOwnership);
        }

        const bulkContestMode = req.body.contestType === "gpp" ? "gpp" : "cash";
        const baseExcluded = allPlayers
          .filter(p => isPlayerOut(p.injuryStatus) || (bulkContestMode === "gpp" && isPlayerUnavailable(p.injuryStatus)))
          .map(p => p.id);
        const isDKBulk = slate.platform === "draftkings";
        const { inactiveIds: bulkInactiveExcluded } = isDKBulk ? await getInactivePlayerIds(allPlayers, slate.sport) : { inactiveIds: [] };
        const filteredBulkInactive = bulkInactiveExcluded.filter(id => !baseExcluded.includes(id));
        baseExcluded.push(...filteredBulkInactive);

        const excludedSet = new Set(baseExcluded);
        pool = pool.filter(p => !excludedSet.has(p.id));

        const eligibleCount = pool.filter(p => Number(p.projectedPoints) > 0).length;
        console.log(`[BulkGenerate] ${slate.sport} slate ${slate.id}: ${allPlayers.length} total, ${baseExcluded.length} excluded, ${eligibleCount} eligible with proj > 0, minSal=${minSalary ?? 'none'}, maxSal=${maxSalary ?? 'none'}`);

        cached = { slate, pool, allPlayers, baseExcluded, platform, lockedOverrideIds: [...bulkOverrideLocked], overrideExposure: bulkCrossRefExposure };
        slateCache.set(effectiveSlateId, cached);
      }

      const { slate, pool, baseExcluded, platform, lockedOverrideIds, overrideExposure } = cached;
      const iteration = pendingBulk.length;
      const maxAttempts = 10;
      let updated = false;

      for (let attempt = 0; attempt < maxAttempts && !updated; attempt++) {
        if (Date.now() >= bulkSolveDeadline) {
          bulkTimedOut = true;
          break;
        }
        const noiseScale = (iteration + attempt) === 0 ? 0 : Math.min(0.10 + (iteration + attempt) * 0.04, 0.40);
        const perturbedPool = pool.map(p => {
          const base = Number(p.projectedPoints);
          const noise = (iteration + attempt) === 0 ? 0 : (Math.random() - 0.5) * base * noiseScale;
          return { ...p, projectedPoints: Math.max(0, base + noise).toString() };
        });

        const iterationExcluded: number[] = [];
        if (totalCount > 3) {
          for (const p of pool) {
            const appearances = playerAppearances[p.id] || 0;
            const currentExposure = totalCount > 0 ? (appearances / totalCount) * 100 : 0;
            const playerMaxExp = overrideExposure[p.id.toString()]?.max;
            const effectiveMax = Math.min(playerMaxExp ?? 100, globalMaxExposure);
            if (currentExposure >= effectiveMax) {
              iterationExcluded.push(p.id);
            }
          }
        }

        const bulkMinLocks: number[] = [];
        const hasAnyMin = (globalMinExposureBulk && globalMinExposureBulk > 0) || Object.values(overrideExposure).some(v => v.min != null && v.min > 0);
        if (hasAnyMin && iteration > 0) {
          for (const p of pool) {
            if (iterationExcluded.includes(p.id)) continue;
            if (lockedOverrideIds.includes(p.id)) continue;
            const appearances = playerAppearances[p.id] || 0;
            const playerMinExp = overrideExposure[p.id.toString()]?.min;
            const effectiveMin = playerMinExp ?? (globalMinExposureBulk && appearances > 0 ? globalMinExposureBulk : undefined);
            if (effectiveMin === undefined || effectiveMin <= 0) continue;
            const remaining = totalCount - iteration;
            const neededApp = Math.ceil((effectiveMin / 100) * totalCount);
            if (appearances < neededApp && (appearances + remaining) <= neededApp) {
              bulkMinLocks.push(p.id);
            }
          }
        }

        const lockedSet = new Set([...lockedOverrideIds, ...bulkMinLocks]);
        const salaryFilteredPool = (minSalary || maxSalary)
          ? perturbedPool.filter(p => {
              if (lockedSet.has(p.id)) return true;
              if (minSalary && !isDefense(p.position) && p.salary < minSalary) return false;
              if (maxSalary && p.salary > maxSalary) return false;
              return true;
            })
          : perturbedPool;

        const bulkContestType = req.body.contestType === "gpp" ? "gpp" : "cash";
        await yieldToEventLoop();
        const solveResult = solveLineup(
          salaryFilteredPool,
          { slateId: effectiveSlateId, platform, lockedPlayerIds: [...new Set([...lockedOverrideIds, ...bulkMinLocks])], excludedPlayerIds: iterationExcluded, maxSalary: undefined, minSalary: undefined, playerProjections: {}, contestType: bulkContestType } as any,
          slate.sport,
          platform,
          undefined,
          { deadline: bulkSolveDeadline, timeoutMs: 2_000 },
        );
        if (solveResult.timedOut) bulkTimedOut = true;

        if (solveResult.error || !solveResult.lineup || solveResult.lineup.length === 0) {
          if (attempt === 0) console.log(`[BulkGenerate] Solver failed for lineup ${id} attempt ${attempt}: ${solveResult.error || 'empty result'}, pool=${salaryFilteredPool.length}, excluded=${iterationExcluded.length}`);
          continue;
        }

        const lineupKey = solveResult.lineup.map((p: any) => p.id).sort((a: number, b: number) => a - b).join(",");
        if (usedLineupKeys.has(lineupKey)) continue;

        const playerIds = solveResult.lineup.map((p: any) => p.id);
        const { allPlayers: origPlayers } = cached;
        const origMap = new Map(origPlayers.map((op: any) => [op.id, op]));
        const playerSnapshot = solveResult.lineup.map((p: any) => {
          const orig = origMap.get(p.id) || p;
          return {
            id: p.id, name: orig.name, team: orig.team, position: orig.position,
            salary: orig.salary, fppg: orig.fppg, projectedPoints: orig.projectedPoints,
            opponent: orig.opponent, gameInfo: orig.gameInfo,
            draftKingsPlayerId: orig.draftKingsPlayerId,
            boostScore: orig.boostScore, boostReason: orig.boostReason,
          };
        });

        const origTotalPts = playerSnapshot.reduce((sum: number, p: any) => sum + Number(p.projectedPoints), 0);

        if (projFloor && origTotalPts < projFloor) continue;

        usedLineupKeys.add(lineupKey);

        for (const p of solveResult.lineup as Player[]) {
          playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
        }
        const correlationScore = computeCorrelationBonus(solveResult.lineup as Player[], slate.sport);

        const updatePayload: any = {
          playerIds,
          totalSalary: solveResult.totalSalary,
          totalProjectedPoints: origTotalPts.toFixed(1),
          playerSnapshot,
        };
        const targetSlateId = effectiveSlateId;
        const persist = async () => {
        if (shouldCloneRegeneratedLineup(
          lineup.slateId,
          targetSlateId,
          preserveSourceSlateId,
        )) {
          const cloned = await cloneRegeneratedLineup(lineup, targetSlateId, updatePayload);
          results.push({
            id: Number(id),
            sourceLineupId: Number(id),
            newLineupId: cloned.id,
            status: "cloned",
          } as any);
        } else {
          if (overrideSlateId) updatePayload.slateId = overrideSlateId;
          await storage.updateLineup(Number(id), updatePayload);
          results.push({ id: Number(id), status: "updated" });
        }
        };
        pendingBulk.push({ slateId: targetSlateId, playerIds, persist });
        updated = true;
      }

      if (!updated) {
        results.push({ id, status: "failed", error: "Could not generate a unique lineup" });
      }
    }

    try {
      for (const [slateId, cached] of slateCache) {
        const batch = pendingBulk.filter(c => c.slateId === slateId);
        if (!batch.length) continue;
        assertLineupExposures(batch, c => c.playerIds, {
          globalMaxExposure, globalMinExposure: globalMinExposureBulk, lockedPlayerIds: cached.lockedOverrideIds,
          exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(cached.overrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), req.body.exposureLimits),
          minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(cached.overrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), req.body.minExposureLimits),
        });
      }
    } catch (error) {
      return res.status(400).json({ message: error instanceof z.ZodError ? error.errors[0].message : "Final batch failed exposure validation. No lineups were saved." });
    }
    for (const candidate of pendingBulk) await candidate.persist();
    const updatedCount = results.filter(r => r.status === "updated").length;
    const clonedCount = results.filter(r => r.status === "cloned").length;
    const newLineupIds = results
      .map((result: any) => result.newLineupId)
      .filter((id: any): id is number => Number.isSafeInteger(id));
    res.json({
      results,
      updated: updatedCount,
      cloned: clonedCount,
      created: clonedCount,
      newLineupIds,
      total: ids.length,
      partial: bulkTimedOut,
      message: bulkTimedOut
        ? `Partial results: updated ${updatedCount} of ${ids.length} lineups before the solver time budget was reached.`
        : undefined,
    });
  });

  app.post("/api/lineups/sim-score", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const { ids, numSims: rawNumSims } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "No lineup IDs provided" });

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "pro" && tier !== "star") {
      return res.status(403).json({ message: "Sharpshooter or Champion subscription required for simulation scoring.", requiresUpgrade: true });
    }

    const maxSims = isAdmin ? 750 : tier === "pro" ? 500 : 200;
    const numSims = Math.min(Math.max(Number(rawNumSims) || 200, 50), maxSims);
    const startTime = Date.now();

    try {
      const slateSimCache = new Map<number, ReturnType<typeof runSimulations>>();
      const slatePoolCache = new Map<number, Player[]>();
      const results: { id: number; status: string; simData?: any; error?: string }[] = [];

      for (const id of ids) {
        const lineup = await storage.getLineup(Number(id));
        if (!lineup || lineup.userId !== userId) {
          results.push({ id, status: "skipped", error: "Not found or not yours" });
          continue;
        }

        let sims = slateSimCache.get(lineup.slateId);
        let pool = slatePoolCache.get(lineup.slateId);
        if (!sims || !pool) {
          const slate = await storage.getSlate(lineup.slateId);
          if (!slate) { results.push({ id, status: "skipped", error: "Slate not found" }); continue; }

          let allPlayers = await storage.getPlayersBySlate(lineup.slateId);
          if (allPlayers.length === 0) { results.push({ id, status: "skipped", error: "Slate data was refreshed. Generate new lineups from the current slate first." }); continue; }

          if (slate.platform === "draftkings") {
            allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
          }

          const scoutMap = buildScoutMap(slate.sport);
          pool = allPlayers.map(p => {
            let pts = Number(p.projectedPoints);
            if (p.isConfirmedStarter) pts = Math.round(pts * 1.05 * 10) / 10;
            pts = applyScoutToProjection(pts, p.name, scoutMap, false);
            if (isPlayerOut(p.injuryStatus)) pts = 0;
            else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") pts *= 0.75;
            else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") pts *= 0.9;
            return { ...p, projectedPoints: pts.toString() };
          });

          const projOverrides: Record<number, number> = {};
          for (const p of pool) projOverrides[p.id] = Number(p.projectedPoints) ?? 0;

          const opponentMap = buildOpponentMap(pool);
          const [vegasContext, dvpContext] = await Promise.all([
            Promise.race([buildVegasContext(pool, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 8000))]),
            Promise.race([buildDvPContext(opponentMap, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
          ]);

          const dvpAdjusted = dvpContext
            ? applyDvPToProjections(pool, projOverrides, opponentMap, dvpContext, slate.sport)
            : projOverrides;

          sims = runSimulations(pool, slate.sport, numSims, dvpAdjusted, vegasContext ?? undefined);
          slateSimCache.set(lineup.slateId, sims);
          slatePoolCache.set(lineup.slateId, pool);
          console.log(`[SimScore] Ran ${sims.length} sims for ${slate.sport} slate ${lineup.slateId}, pool: ${pool.length} players`);
        }

        const allSimScores = sims.map(sim =>
          lineup.playerIds.reduce((sum: number, pid: number) => sum + (sim.projections[pid] || 0), 0)
        ).sort((a, b) => a - b);

        const n = allSimScores.length;
        const avg = allSimScores.reduce((a, b) => a + b, 0) / n;
        const med = allSimScores[Math.floor(n * 0.50)] ?? avg;
        const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
        const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
        const composite = avg * 0.39 + p75 * 0.39 + p90 * 0.22;

        const simData = {
          avgSimScore: Math.round(avg * 10) / 10,
          medianScore: Math.round(med * 10) / 10,
          p75Score: Math.round(p75 * 10) / 10,
          p90Score: Math.round(p90 * 10) / 10,
          compositeScore: Math.round(composite * 10) / 10,
        };

        await db.update(lineupsTable).set({ simData }).where(eq(lineupsTable.id, Number(id)));
        results.push({ id, status: "scored", simData });
      }

      const scoredCount = results.filter(r => r.status === "scored").length;
      console.log(`[SimScore] Completed: ${scoredCount}/${ids.length} lineups scored, ${numSims} sims, ${Date.now() - startTime}ms`);
      res.json({ results, scored: scoredCount, total: ids.length, simsRun: numSims });
    } catch (err: any) {
      console.error("[SimScore] Error:", err);
      res.status(500).json({ message: err.message || "Simulation scoring failed" });
    }
  });

  app.post("/api/lineups/sim-regenerate", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const restrictionInput = simRegenerateRestrictionSchema.safeParse({
      nflPortfolio: req.body.nflPortfolio,
      flexAllowedPositions: req.body.flexAllowedPositions,
      stackGameKeys: req.body.stackGameKeys,
    });
    if (!restrictionInput.success) {
      return res.status(400).json({
        message: restrictionInput.error.errors[0]?.message || "Invalid simulation regeneration restrictions.",
      });
    }
    const { ids, sortBy, useBoosts, ceilingMode, leverageMode, outperformerMode, contestType: rawContestType, globalMaxExposure, globalMinExposure, minExposureLimits, projFloor, minSalary, maxSalary, slateId: bodySlateId, draftGroupId: bodyDraftGroupId } = req.body;
    try {
      const exposureInput = z.object({
        globalMaxExposure: z.number().finite().min(0).max(100).optional(),
        globalMinExposure: z.number().finite().min(0).max(100).optional(),
        minExposureLimits: z.record(z.number().finite().min(0).max(100)).optional(),
        exposureLimits: z.record(z.number().finite().min(0).max(100)).optional(),
      }).parse(req.body);
      validateExposureBounds(exposureInput);
    } catch (error) {
      return res.status(400).json({ message: error instanceof z.ZodError ? error.errors[0].message : "Invalid exposure settings" });
    }
    const simContestType = rawContestType === "gpp" ? "gpp" : "cash";
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "No lineup IDs provided" });
    const overrideSlateId = typeof bodySlateId === "number" ? bodySlateId : null;
    const preserveSourceSlateId = req.body.preserveSourceSlateId === true;
    const requestedDraftGroupId = bodyDraftGroupId == null ? null : Number(bodyDraftGroupId);
    if (requestedDraftGroupId !== null &&
        (!Number.isSafeInteger(requestedDraftGroupId) || requestedDraftGroupId <= 0)) {
      return res.status(400).json({ message: "draftGroupId must be a positive integer" });
    }
    if (overrideSlateId !== null) {
      const requestedTargetSlate = await storage.getSlate(overrideSlateId);
      if (!requestedTargetSlate) {
        return res.status(400).json({ message: "Target slate not found" });
      }
      try {
        validateNflPortfolioContext(restrictionInput.data.nflPortfolio, requestedTargetSlate, requestedTargetSlate.platform, simContestType);
      } catch (error) {
        return res.status(400).json({ message: error instanceof z.ZodError ? error.errors[0].message : "Invalid NFL portfolio target." });
      }
      if (requestedDraftGroupId !== null &&
          requestedTargetSlate.draftGroupId !== requestedDraftGroupId) {
        return res.status(400).json({
          message: `Submitted draftGroupId ${requestedDraftGroupId} does not match target slate ${overrideSlateId} (DG ${requestedTargetSlate.draftGroupId ?? "unknown"})`,
        });
      }
    } else if (requestedDraftGroupId !== null) {
      return res.status(400).json({ message: "draftGroupId requires a target slateId" });
    }

    const validSortKeys = ["p90", "p75", "composite", "median", "avg"];
    const sortKey = validSortKeys.includes(sortBy) ? sortBy : "composite";

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "pro" && tier !== "star") {
      return res.status(403).json({ message: "Sharpshooter or Champion subscription required.", requiresUpgrade: true });
    }

    const tierSims = isAdmin ? 750 : tier === "pro" ? 500 : 200;
    const startTime = Date.now();
    const LP_BUDGET_MS = 20000;
    // Large strict NFL portfolios need substantially more unique candidates
    // than requested lineups before exact structure/exposure selection. A
    // fixed small-batch budget can stop a valid 193-lineup search prematurely.
    const MAX_RUNTIME_MS = simRegenerationRuntimeMs(ids.length);
    const solverDeadline = startTime + MAX_RUNTIME_MS - 3_000;
    let simRegenTimedOut = false;
    let projectionFloorPartial = false;

    console.log(`[SimRegen] Starting: ${ids.length} lineups, max ${tierSims} sims (tier=${tier}), sortBy=${sortKey}, contest=${simContestType}, boosts=${useBoosts}, ceiling=${ceilingMode}, leverage=${leverageMode}, opm=${outperformerMode}, maxExp=${globalMaxExposure}, minExp=${globalMinExposure}, projFloor=${projFloor}, minSal=${minSalary}, maxSal=${maxSalary}, overrideSlate=${overrideSlateId}`);

    try {
      const slateGroups = new Map<number, number[]>();
      const lineupOwnership = new Map<number, any>();
      let totalSimsRun = 0;
      const origSlatePerSimGroup = new Map<number, number>();
      const nflPortfolioReports: Array<{ slateId: number; report: NflPortfolioReport }> = [];
      const pendingPortfolioWrites: Array<(executor: any) => Promise<any>> = [];
      let hasConstrainedResim = !!restrictionInput.data.nflPortfolio?.enabled ||
        (globalMaxExposure ?? 100) < 100 || (globalMinExposure ?? 0) > 0 ||
        Object.values(req.body.exposureLimits || {}).some(value => Number(value) < 100) ||
        Object.values(minExposureLimits || {}).some(value => Number(value) > 0);

      const results: { id: number; status: string; error?: string }[] = [];

      for (const id of ids) {
        if (Date.now() >= solverDeadline) {
          simRegenTimedOut = true;
          break;
        }
        const lineup = await storage.getLineup(Number(id));
        if (!lineup || lineup.userId !== userId) {
          results.push({ id: Number(id), status: "skipped", error: "Not found or not yours" });
          continue;
        }
        lineupOwnership.set(Number(id), lineup);
        const effectiveSlateId = overrideSlateId || lineup.slateId;
        if (overrideSlateId && !origSlatePerSimGroup.has(effectiveSlateId)) {
          origSlatePerSimGroup.set(effectiveSlateId, lineup.slateId);
        }
        if (overrideSlateId) {
          const overrideSlate = await storage.getSlate(overrideSlateId);
          if (overrideSlate && (overrideSlate.sport !== lineup.sport || overrideSlate.platform !== (lineup.platform || "draftkings"))) {
            results.push({ id: Number(id), status: "skipped", error: "Override slate sport/platform does not match lineup" });
            continue;
          }
        }
        const group = slateGroups.get(effectiveSlateId) || [];
        group.push(Number(id));
        slateGroups.set(effectiveSlateId, group);
      }

      // Validate every resolved target before projection work or lineup
      // mutations. Mixed-source requests must not apply one slate's games to
      // another target that does not actually contain them.
      const preflightTargets = new Map<number, {
        slate: Slate;
        players: Player[];
        restrictions: ReturnType<typeof validateSimRegenerateRestrictions>;
      }>();
      for (const [slateId, lineupIds] of slateGroups) {
        const slate = await storage.getSlate(slateId);
        if (restrictionInput.data.nflPortfolio?.enabled &&
            (!slate || slate.isActive === false || new Date(slate.startTime).getTime() <= Date.now())) {
          return res.status(400).json({ message: "NFL portfolio regeneration requires every target slate to exist, be active, and not have started.", slateId });
        }
        if (!slate) continue;
        const players = await storage.getPlayersBySlate(slateId);
        const automaticStructure = slate.sport.toUpperCase() === "NFL" && slate.platform === "draftkings" &&
          (lineupOwnership.get(lineupIds[0])?.platform || "draftkings") === "draftkings" && isClassicSlate(slate) && simContestType === "gpp";
        const targetInput = automaticStructure
          ? { ...restrictionInput.data, nflPortfolio: {
              ...(restrictionInput.data.nflPortfolio?.enabled ? restrictionInput.data.nflPortfolio : regenerationNflSettings(players)),
              rbMinSalary: Math.max(4500, restrictionInput.data.nflPortfolio?.enabled ? restrictionInput.data.nflPortfolio.rbMinSalary : 4500),
              allowLockedCheapRb: false,
            } } : restrictionInput.data;
        hasConstrainedResim ||= automaticStructure;
        if (targetInput.nflPortfolio?.enabled && players.length === 0) {
          return res.status(400).json({ message: "NFL portfolio target has no available player pool.", slateId });
        }
        try {
          validateNflPortfolioContext(restrictionInput.data.nflPortfolio, slate, lineupOwnership.get(lineupIds[0])?.platform || "draftkings", simContestType);
          preflightTargets.set(slateId, {
            slate,
            players,
            restrictions: validateSimRegenerateRestrictions(targetInput, slate, players),
          });
        } catch (error: any) {
          return res.status(400).json({
            message: error?.message || `Invalid restrictions for target slate ${slateId}.`,
            slateId,
            lineupIds,
          });
        }
      }

      for (const [slateId, lineupIds] of slateGroups) {
        const preflightTarget = preflightTargets.get(slateId);
        const slate = preflightTarget?.slate ?? await storage.getSlate(slateId);
        if (!slate) {
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "Slate not found" }));
          continue;
        }

        const platform = (lineupOwnership.get(lineupIds[0])?.platform || "draftkings") as Platform;
        validateNflPortfolioContext(restrictionInput.data.nflPortfolio, slate, platform, simContestType);
        const simRegenRestrictions: ReturnType<typeof validateSimRegenerateRestrictions> = preflightTarget?.restrictions ??
          validateSimRegenerateRestrictions(restrictionInput.data, slate, []);
        let allPlayers = preflightTarget?.players ?? await storage.getPlayersBySlate(slateId);
        if (allPlayers.length === 0) {
          console.log(`[SimRegen] Slate ${slateId} has no players — likely refreshed. Skipping ${lineupIds.length} lineups.`);
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "Slate data was refreshed. Generate new lineups from the current slate first." }));
          continue;
        }

        if (slate.platform === "draftkings") {
          allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
        }

        const applyBoosts = useBoosts !== false;
        const useCeilingMode = ceilingMode === true;
        const useLeverageMode = leverageMode === true;
        const useOutperformerMode = outperformerMode === true;
        const scoutMap = buildScoutMap(slate.sport);

        const { overrideMap: simRegenOverrideMap, excluded: simRegenExcluded, locked: simRegenLocked, exposureMap: simRegenOverrideExposure } = await loadOverridesWithCrossRef(userId, slateId, overrideSlateId ? (origSlatePerSimGroup.get(slateId) ?? null) : null, allPlayers);
        hasConstrainedResim ||= Object.values(simRegenOverrideExposure).some(value => (value.max ?? 100) < 100 || (value.min ?? 0) > 0);
        validateExposureBounds({
          globalMaxExposure, globalMinExposure, lockedPlayerIds: [...simRegenLocked],
          exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), req.body.exposureLimits),
          minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), minExposureLimits),
        });

        let pool = allPlayers
          .filter(p => !simRegenExcluded.has(p.id))
          .map(p => {
          const override = simRegenOverrideMap.get(p.id);
          let pts = override?.customProjection != null ? Number(override.customProjection) : Number(p.projectedPoints);
          if (override?.boostPercent && override.boostPercent > 0) {
            pts = Math.round(pts * (1 + override.boostPercent / 100) * 10) / 10;
          }
          if (p.isConfirmedStarter) pts = Math.round(pts * 1.05 * 10) / 10;
          if (applyBoosts && p.boostScore) {
            const boostPct = Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008));
            pts = Math.round(pts * (1 + boostPct) * 10) / 10;
          }
          pts = applyScoutToProjection(pts, p.name, scoutMap, override?.customProjection != null);
          if (isPlayerOut(p.injuryStatus)) pts = 0;
          else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") pts *= 0.75;
          else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") pts *= 0.9;
          return { ...p, projectedPoints: pts.toString() };
        });

        pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyMarketProjectionBlend(pool, slate.sport);
        pool = await applyWinningLineupAdjustment(pool, slate.sport);

        if (useOutperformerMode) {
          try {
            pool = await applyOutperformerMode(pool, slate.sport);
          } catch (opErr: any) {
            throw new z.ZodError([{ code: "custom", path: ["outperformerMode"], message:
              `Outperformer Mode could not be applied: ${opErr?.message || "projection adjustment failed"}. No lineups were saved.` }]);
          }
        }

        const regenProfile = await getHistoricalProfile(slate.sport);
        if (regenProfile.ready) {
          pool = applyHistoricalAdjustments(pool, regenProfile);
        }

        if (useCeilingMode) {
          try {
            pool = applyCeilingMode(pool, slate.sport);
          } catch (ceilErr: any) {
            throw new z.ZodError([{ code: "custom", path: ["ceilingMode"], message:
              `Ceiling Mode could not be applied: ${ceilErr?.message || "projection adjustment failed"}. No lineups were saved.` }]);
          }
        }

        if (useLeverageMode) {
          try {
            const bdlStats = await fetchBDLStats(slate.sport);
            const ownershipResults = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStats);
            const playersWithOwnership = computeOwnershipForPlayers(pool, ownershipResults);
            pool = applyLeverageMode(playersWithOwnership);
          } catch (levErr: any) {
            throw new z.ZodError([{ code: "custom", path: ["leverageMode"], message:
              `Leverage Mode could not be applied: ${levErr?.message || "ownership adjustment failed"}. No lineups were saved.` }]);
          }
        }

        pool = pool.filter(p => !isPlayerOut(p.injuryStatus));

        const isDKRegen = slate.platform === "draftkings";
        if (isDKRegen) {
          const { inactiveIds: regenInactiveIds } = await getInactivePlayerIds(allPlayers, slate.sport);
          pool = pool.filter(p => !regenInactiveIds.includes(p.id));
        }

        const simProjFloor = typeof projFloor === "number" && projFloor > 0 ? projFloor : null;
        const simMinSalary = typeof minSalary === "number" ? minSalary : undefined;
        const simMaxSalary = typeof maxSalary === "number" ? maxSalary : undefined;

        if (simMinSalary || simMaxSalary) {
          pool = pool.filter(p => {
            if (simRegenLocked.has(p.id)) return true;
            if (simMinSalary && !isDefense(p.position) && p.salary < simMinSalary) return false;
            if (simMaxSalary && p.salary > simMaxSalary) return false;
            return true;
          });
        }

        const projOverrides: Record<number, number> = {};
        for (const p of pool) projOverrides[p.id] = Number(p.projectedPoints) ?? 0;

        const opponentMap = buildOpponentMap(pool);
        const [vegasContext, dvpContext] = await Promise.all([
          Promise.race([buildVegasContext(pool, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 8000))]),
          Promise.race([buildDvPContext(opponentMap, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
        ]);

        const dvpAdjusted = dvpContext
          ? applyDvPToProjections(pool, projOverrides, opponentMap, dvpContext, slate.sport)
          : projOverrides;

        const config = getPlatformConfig(slate.sport, platform);
        const lineupMap = new Map<string, { lineup: Player[]; frequency: number; simScores: number[] }>();

        const positionGroups = new Map<string, Player[]>();
        for (const p of pool) {
          for (const pos of p.position.split("/")) {
            const group = positionGroups.get(pos) || [];
            group.push(p);
            positionGroups.set(pos, group);
          }
        }
        const minExpPlayers: { id: number; pct: number }[] = [];
        for (const [pid, exp] of Object.entries(simRegenOverrideExposure)) {
          if (exp.min && exp.min > 0) {
            minExpPlayers.push({ id: Number(pid), pct: exp.min });
          }
        }
        if (minExposureLimits) {
          for (const [pid, pct] of Object.entries(minExposureLimits)) {
            if (typeof pct === "number" && pct > 0 && !minExpPlayers.find(p => p.id === Number(pid))) {
              minExpPlayers.push({ id: Number(pid), pct });
            }
          }
        }

        const keepIds = new Set<number>();
        for (const p of pool) { if (simRegenLocked.has(p.id)) keepIds.add(p.id); }
        for (const mp of minExpPlayers) keepIds.add(mp.id);
        // A reduced LP pool must retain every currently eligible player from
        // each selected game. Otherwise pruning can manufacture an
        // infeasible stack even though the full target pool can satisfy it.
        for (const gameKey of simRegenRestrictions.stackGameKeys ?? []) {
          for (const player of pool) {
            if (getStackGameKey(player.gameInfo) === gameKey) keepIds.add(player.id);
          }
        }
        const topPerPos = slate.sport === "GOLF" ? 50 : 20;
        const cheapReserve = 5;
        for (const [, players] of positionGroups) {
          players.sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
          for (let i = 0; i < Math.min(players.length, topPerPos); i++) keepIds.add(players[i].id);
          const bySalary = [...players].sort((a, b) => a.salary - b.salary);
          for (let i = 0; i < Math.min(bySalary.length, cheapReserve); i++) keepIds.add(bySalary[i].id);
        }
        let lpPool = pool.filter(p => keepIds.has(p.id));
        console.log(`[SimRegen] Pool trimmed: ${pool.length} → ${lpPool.length} players for LP solving`);

        function getSimLocks(simIndex: number, totalSims: number): number[] {
          return [...simRegenLocked];
        }

        const regenExposureBounds = {
          globalMaxExposure, globalMinExposure, lockedPlayerIds: Array.from(simRegenLocked),
          exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), req.body.exposureLimits),
          minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), minExposureLimits),
        };
        const exposureSearch = createSimExposureSearch(regenExposureBounds, lineupIds.length);
        const candidateDeadline = solverDeadline - 5000;
        const simRegenConstraints = (lockedPlayerIds: number[]) => {
          const base = buildSimRegenerateSolverConstraints(
            slateId,
            lockedPlayerIds,
            config.salaryCap,
            simContestType,
            simRegenRestrictions,
          );
          return simRegenRestrictions.nflPortfolio?.enabled ? base :
            exposureSearch(base, lpPool.map(p => p.id), lineupMap.values());
        };

        const preset = simRegenRestrictions.nflPortfolio?.enabled ? simRegenRestrictions.nflPortfolio : undefined;
        const portfolioSims = preset ? runSimulations(pool, slate.sport, tierSims, dvpAdjusted, vegasContext ?? undefined) : [];
        if (preset) {
          const ownershipMap = await portfolioOwnership(pool, preset, !restrictionInput.data.nflPortfolio?.enabled);
          const portfolio = await generateNflPortfolio({
            pool, settings: preset, count: lineupIds.length,
            strictStructure: true, structureOnly: !restrictionInput.data.nflPortfolio?.enabled,
            baseConstraints: {
              ...simRegenConstraints([...simRegenLocked]),
              globalMaxExposure, globalMinExposure, projectedPointsFloor: simProjFloor || undefined,
              exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), req.body.exposureLimits),
              minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), minExposureLimits),
            },
            ownershipMap, vegasGames: vegasContext ? [...vegasContext.games.values()].filter(game => game.source !== "fallback") : undefined,
            deadline: solverDeadline,
            solve: (candidatePool, candidateConstraints) => solveLineup(candidatePool, candidateConstraints, slate.sport, platform, candidateConstraints.ownershipMap ?? ownershipMap, { deadline: solverDeadline, timeoutMs: 100 }),
            scoreCandidates: candidates => scorePortfolioSims(candidates, portfolioSims, sortKey, pool, ownershipMap),
          });
          nflPortfolioReports.push({ slateId, report: portfolio.report });
          for (const candidate of portfolio.lineups) lineupMap.set(candidate.lineup.map((p: Player) => p.id).sort().join(","), { lineup: candidate.lineup, frequency: 1, simScores: [] });
        }
        const baselineResult = preset ? { totalProjectedPoints: 0, timedOut: false } : solveLineup(
          lpPool,
          simRegenConstraints([...simRegenLocked]),
          slate.sport, platform,
          undefined,
          { deadline: solverDeadline, timeoutMs: 2_000 },
        );
        if (baselineResult.timedOut) simRegenTimedOut = true;
        const baselineTotal = baselineResult.totalProjectedPoints || 0;
        const autoFloor = baselineTotal > 0 ? Math.round(baselineTotal * 0.85 * 10) / 10 : 0;
        console.log(`[SimRegen] Baseline optimal: ${baselineTotal.toFixed(1)} pts, auto floor: ${autoFloor}`);

        const CALIBRATION_BATCH = 10;
        const calibrationSims = preset ? portfolioSims : runSimulations(pool, slate.sport, CALIBRATION_BATCH, dvpAdjusted, vegasContext ?? undefined);

        const calStart = Date.now();
        let calibrationAttempts = 0;
        for (let i = 0; !preset && i < calibrationSims.length; i++) {
          if (Date.now() >= candidateDeadline) {
            simRegenTimedOut = true;
            break;
          }
          const sim = calibrationSims[i];
          const simPool = lpPool.map(p => {
            const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
            const baseProj = Number(p.projectedPoints) ?? 0;
            const blended = simProj * 0.7 + baseProj * 0.3;
            const noise = blended * (Math.random() * 0.06 - 0.03);
            return { ...p, projectedPoints: Math.max(0, blended + noise).toString() };
          });
          const simLocks = getSimLocks(i, 200);
          await yieldToEventLoop();
          calibrationAttempts++;
          const result = solveLineup(
            simPool,
            simRegenConstraints(simLocks),
            slate.sport, platform,
            undefined,
            { deadline: candidateDeadline, timeoutMs: 2_000 },
          );
          if (result.timedOut) simRegenTimedOut = true;
          if (result.error || result.lineup.length === 0) continue;
          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          const existing = lineupMap.get(key);
          if (existing) { existing.frequency++; existing.simScores.push(result.totalProjectedPoints); }
          else { lineupMap.set(key, { lineup: result.lineup as Player[], frequency: 1, simScores: [result.totalProjectedPoints] }); }
        }
        const calElapsed = Date.now() - calStart;
        const msPerSolve = Math.max(1, calElapsed / Math.max(1, calibrationAttempts));

        if (!preset && lineupMap.size === 0 && lpPool.length < pool.length) {
          console.log(`[SimRegen] Trimmed pool infeasible, falling back to full pool (${pool.length} players)`);
          lpPool = pool;
          for (let i = 0; i < calibrationSims.length; i++) {
            if (Date.now() >= candidateDeadline) {
              simRegenTimedOut = true;
              break;
            }
            const sim = calibrationSims[i];
            const simPool = lpPool.map(p => {
              const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
              const baseProj = Number(p.projectedPoints) ?? 0;
              const blended = simProj * 0.7 + baseProj * 0.3;
              const noise = blended * (Math.random() * 0.06 - 0.03);
              return { ...p, projectedPoints: Math.max(0, blended + noise).toString() };
            });
            const fbLocks = getSimLocks(i, 200);
            await yieldToEventLoop();
            const result = solveLineup(
              simPool,
              simRegenConstraints(fbLocks),
              slate.sport,
              platform,
              undefined,
              { deadline: candidateDeadline, timeoutMs: 2_000 },
            );
            if (result.timedOut) simRegenTimedOut = true;
            if (result.error || result.lineup.length === 0) continue;
            const key = result.lineup.map((p: Player) => p.id).sort().join(",");
            const existing = lineupMap.get(key);
            if (existing) { existing.frequency++; existing.simScores.push(result.totalProjectedPoints); }
            else { lineupMap.set(key, { lineup: result.lineup as Player[], frequency: 1, simScores: [result.totalProjectedPoints] }); }
          }
        }

        const remainingBudget = Math.max(0, LP_BUDGET_MS - calElapsed);
        const adaptiveSims = preset ? 0 : Math.min(tierSims - CALIBRATION_BATCH, Math.max(40, Math.floor(remainingBudget / msPerSolve)));
        const totalTargetSims = CALIBRATION_BATCH + adaptiveSims;

        const remainingSims = runSimulations(pool, slate.sport, adaptiveSims, dvpAdjusted, vegasContext ?? undefined);
        const allSims = [...calibrationSims, ...remainingSims];
        if (minExpPlayers.length > 0) {
          console.log(`[SimRegen] Min exposure locks: ${minExpPlayers.map(p => `${p.id}@${p.pct}%`).join(", ")}`);
        }
        console.log(`[SimRegen] ${slate.sport} slate ${slateId}: lpPool=${lpPool.length}, ${msPerSolve.toFixed(0)}ms/solve, adaptive=${totalTargetSims} sims (tier max ${tierSims})`);
        totalSimsRun += preset ? portfolioSims.length : totalTargetSims;

        let actualSimsSolved = CALIBRATION_BATCH;
        for (let i = CALIBRATION_BATCH; !preset && i < allSims.length; i++) {
          if (Date.now() >= candidateDeadline) {
            simRegenTimedOut = true;
            console.log(`[SimRegen] Hard time cap reached after ${actualSimsSolved} sims`);
            break;
          }
          const sim = allSims[i];
          const simPool = lpPool.map(p => {
            const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
            const baseProj = Number(p.projectedPoints) ?? 0;
            const blended = simProj * 0.7 + baseProj * 0.3;
            const noise = blended * (Math.random() * 0.06 - 0.03);
            return { ...p, projectedPoints: Math.max(0, blended + noise).toString() };
          });
          const mainLocks = getSimLocks(i, totalTargetSims);
          await yieldToEventLoop();
          const result = solveLineup(
            simPool,
            simRegenConstraints(mainLocks),
            slate.sport, platform,
            undefined,
            { deadline: candidateDeadline, timeoutMs: 2_000 },
          );
          if (result.timedOut) simRegenTimedOut = true;
          actualSimsSolved++;
          if (result.error || result.lineup.length === 0) continue;
          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          const existing = lineupMap.get(key);
          if (existing) { existing.frequency++; existing.simScores.push(result.totalProjectedPoints); }
          else { lineupMap.set(key, { lineup: result.lineup as Player[], frequency: 1, simScores: [result.totalProjectedPoints] }); }
        }

        if (lineupMap.size === 0) {
          if (preset) {
            return res.status(400).json({ message: "A target slate produced no valid NFL portfolio candidates. No regenerated lineups were saved.", slateId });
          }
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "No feasible lineups from sims" }));
          continue;
        }

        // Rare exposure alternatives must not be discarded by frequency.
        const candidateLimit = hasConstrainedResim ? lineupMap.size : Math.max(lineupIds.length * 5, 60);
        let candidateEntries = Array.from(lineupMap.entries());
        if (!preset && candidateEntries.length > candidateLimit) {
          candidateEntries.sort((a, b) => b[1].frequency - a[1].frequency);
          candidateEntries = candidateEntries.slice(0, candidateLimit);
        }
        console.log(`[SimRegen] Scoring ${candidateEntries.length} of ${lineupMap.size} candidates (limit ${candidateLimit})`);

        const simProjectionArrays = allSims.map(sim => sim.projections);
        const numSimsActual = simProjectionArrays.length;

        const origMap = new Map(allPlayers.map(op => [op.id, op]));
        const boostedMap = new Map(pool.map(bp => [bp.id, bp]));
        const scoredCandidates = candidateEntries.map(([key, data]) => {
          const playerIds = data.lineup.map(p => p.id);
          const allSimScores = new Float64Array(numSimsActual);
          for (let si = 0; si < numSimsActual; si++) {
            const proj = simProjectionArrays[si];
            let total = 0;
            for (let pi = 0; pi < playerIds.length; pi++) {
              total += proj[playerIds[pi]] || 0;
            }
            allSimScores[si] = total;
          }
          allSimScores.sort();

          const n = numSimsActual;
          let sum = 0;
          for (let i = 0; i < n; i++) sum += allSimScores[i];
          const avg = sum / n;
          const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
          const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
          const med = allSimScores[Math.floor(n * 0.50)] ?? avg;
          const composite = avg * 0.35 + p75 * 0.35 + p90 * 0.20 + (data.frequency / n) * 100 * 0.10;

          return { key, lineup: data.lineup, frequency: data.frequency,
            avgSimScore: Math.round(avg * 10) / 10, medianScore: Math.round(med * 10) / 10,
            p75Score: Math.round(p75 * 10) / 10, p90Score: Math.round(p90 * 10) / 10,
            compositeScore: Math.round(composite * 10) / 10,
            freqPct: Math.round((data.frequency / n) * 1000) / 10,
            totalSalary: data.lineup.reduce((s, p) => s + p.salary, 0),
            deterministicProjectedPoints: data.lineup.reduce((sum, p) =>
              sum + Number(boostedMap.get(p.id)?.projectedPoints ?? 0), 0),
          };
        });

        // The baseline-derived floor is only a quality heuristic. It must not
        // delete the alternatives needed to satisfy a hard exposure batch.
        const effectiveFloor = simProjFloor || (hasConstrainedResim ? 0 : autoFloor);
        if (effectiveFloor > 0) {
          const beforeCount = scoredCandidates.length;
          const filtered = filterSimProjectionCandidates(scoredCandidates, c => c.deterministicProjectedPoints,
            { count: lineupIds.length, explicitFloor: simProjFloor, automaticFloor: autoFloor, constrained: hasConstrainedResim });
          if (filtered !== scoredCandidates) {
            scoredCandidates.length = 0;
            scoredCandidates.push(...filtered);
          }
          if (beforeCount !== scoredCandidates.length) {
            console.log(`[SimRegen] ProjFloor ${effectiveFloor.toFixed(1)} (auto=${autoFloor}): filtered ${beforeCount} -> ${scoredCandidates.length} candidates`);
          }
          if (preset && simProjFloor && beforeCount !== scoredCandidates.length) {
            const reportEntry = nflPortfolioReports.find(entry => entry.slateId === slateId);
            if (reportEntry) {
              reportEntry.report.generatedCount = scoredCandidates.length;
              reportEntry.report.partial = scoredCandidates.length < lineupIds.length;
              const criterion = `Projected points floor (${simProjFloor})`;
              reportEntry.report.limitingCriteria ||= [];
              if (!reportEntry.report.limitingCriteria.includes(criterion)) reportEntry.report.limitingCriteria.push(criterion);
            }
          }
          if (simProjFloor && scoredCandidates.length === 0) {
            return res.status(400).json({
              message: `No regenerated lineup met the ${simProjFloor} projected points floor. No regenerated lineups were saved.`,
              slateId,
            });
          }
          if (simProjFloor && scoredCandidates.length < lineupIds.length) projectionFloorPartial = true;
        }

        const sortFn: Record<string, (a: typeof scoredCandidates[0], b: typeof scoredCandidates[0]) => number> = {
          p90: (a, b) => b.p90Score - a.p90Score,
          p75: (a, b) => b.p75Score - a.p75Score,
          composite: (a, b) => b.compositeScore - a.compositeScore,
          median: (a, b) => b.medianScore - a.medianScore,
          avg: (a, b) => b.avgSimScore - a.avgSimScore,
        };
        scoredCandidates.sort(sortFn[sortKey] || sortFn.composite);

        const selectedCandidates = selectExposureLineups(scoredCandidates, c => c.lineup.map(p => p.id), {
          globalMaxExposure, globalMinExposure, lockedPlayerIds: Array.from(simRegenLocked),
          exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), req.body.exposureLimits),
          minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simRegenOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), minExposureLimits),
        }, { count: lineupIds.length, deadline: solverDeadline + 2000, requireFull: hasConstrainedResim && !preset, preservePortfolio: !!preset });

        for (let i = 0; i < lineupIds.length && i < selectedCandidates.length; i++) {
          const candidate = selectedCandidates[i];
          const lineupId = lineupIds[i];
          const playerIds = candidate.lineup.map(p => p.id);
          const playerSnapshot = candidate.lineup.map(p => {
            const orig = origMap.get(p.id) || p;
            const boosted = boostedMap.get(p.id);
            return {
              id: p.id, name: orig.name, team: orig.team, position: orig.position,
              salary: orig.salary, fppg: orig.fppg,
              projectedPoints: boosted ? boosted.projectedPoints : orig.projectedPoints,
              opponent: orig.opponent, gameInfo: orig.gameInfo,
              draftKingsPlayerId: orig.draftKingsPlayerId,
              boostScore: orig.boostScore, boostReason: orig.boostReason,
            };
          });

          const totalPts = candidate.deterministicProjectedPoints;
          if (simProjFloor && totalPts < simProjFloor) {
            throw new Error(`Regenerated lineup failed the ${simProjFloor} projected points floor before persistence`);
          }

          const simData = {
            avgSimScore: candidate.avgSimScore, medianScore: candidate.medianScore,
            p75Score: candidate.p75Score, p90Score: candidate.p90Score,
            compositeScore: candidate.compositeScore, freqPct: candidate.freqPct,
          };
          const simUpdatePayload: any = {
            playerIds, totalSalary: candidate.totalSalary,
            totalProjectedPoints: totalPts.toFixed(1),
            playerSnapshot, simData,
          };
          const sourceLineup = lineupOwnership.get(lineupId)!;
          const persist = async (executor: any) => {
          if (shouldCloneRegeneratedLineup(
            sourceLineup.slateId,
            slateId,
            preserveSourceSlateId,
          )) {
            const cloned = await cloneRegeneratedLineup(sourceLineup, slateId, simUpdatePayload, executor);
            return {
              id: lineupId,
              sourceLineupId: lineupId,
              newLineupId: cloned.id,
              status: "cloned",
            };
          } else {
            if (overrideSlateId) simUpdatePayload.slateId = overrideSlateId;
            await executor.update(lineupsTable).set(simUpdatePayload).where(eq(lineupsTable.id, lineupId));
            return { id: lineupId, status: "updated" };
          }
          };
          pendingPortfolioWrites.push(persist);
        }

        for (let i = selectedCandidates.length; i < lineupIds.length; i++) {
          results.push({ id: lineupIds[i], status: "skipped", error: "Not enough sim candidates" });
        }
      }

      // Nothing is written until every target has generated and validated its
      // candidates. Recheck all target kickoffs immediately before committing.
      {
        if (hasConstrainedResim) {
          const unexpectedSkip = results.find(r => r.status === "skipped" &&
            r.error !== "Not found or not yours" && r.error !== "Not enough sim candidates");
          if (unexpectedSkip) {
            return res.status(400).json({ message: "Regeneration could not fill every requested lineup. No regenerated lineups were saved." });
          }
          for (const [targetSlateId, lineupIds] of slateGroups) {
            const skipped = results.filter(r => lineupIds.includes(r.id) && r.status === "skipped" && r.error === "Not enough sim candidates").length;
            if (!skipped) continue;
            const report = nflPortfolioReports.find(entry => entry.slateId === targetSlateId)?.report;
            if (!report?.partial || report.generatedCount <= 0 || skipped !== lineupIds.length - report.generatedCount) {
              return res.status(400).json({ message: "Regeneration could not fill every requested lineup. No regenerated lineups were saved.", slateId: targetSlateId });
            }
          }
        }
        for (const slateId of slateGroups.keys()) {
          const target = await storage.getSlate(slateId);
          const automaticStructure = !restrictionInput.data.nflPortfolio?.enabled && nflPortfolioReports.some(entry => entry.slateId === slateId);
          if (!target || target.isActive === false || (automaticStructure
            ? configurationExpiry(target, preflightTargets.get(slateId)?.players ?? []).isExpired
            : new Date(target.startTime).getTime() <= Date.now())) {
            return res.status(400).json({ message: "A target slate closed during NFL portfolio regeneration. No regenerated lineups were saved.", slateId });
          }
        }
      }
      const committedResults = await db.transaction(async executor => {
        const statuses: any[] = [];
        for (const persist of pendingPortfolioWrites) statuses.push(await persist(executor));
        return statuses;
      });
      results.push(...committedResults);
      const updatedCount = results.filter(r => r.status === "updated").length;
      const clonedCount = results.filter(r => r.status === "cloned").length;
      const newLineupIds = results
        .map((result: any) => result.newLineupId)
        .filter((id: any): id is number => Number.isSafeInteger(id));
      const totalElapsed = Date.now() - startTime;
      console.log(`[SimRegen] Completed: ${updatedCount}/${ids.length} lineups regenerated by ${sortKey}, ${totalElapsed}ms`);
      res.json({
        results,
        updated: updatedCount,
        cloned: clonedCount,
        created: clonedCount,
        newLineupIds,
        total: ids.length,
        simsRun: totalSimsRun || tierSims,
        ...(nflPortfolioReports.length ? { nflPortfolioReports } : {}),
        sortBy: sortKey,
        partial: projectionFloorPartial || simRegenTimedOut || Date.now() >= solverDeadline || nflPortfolioReports.some(entry => entry.report.partial),
        message: nflPortfolioReports.some(entry => entry.report.partial)
          ? `Due to active constraints, regenerated ${updatedCount} of ${ids.length} requested lineups. Every returned lineup satisfies the configured rules; modify the limiting criteria in the NFL GPP report to generate more.`
          : projectionFloorPartial
          ? `Partial results: regenerated ${updatedCount} of ${ids.length} requested lineups that met the projected points floor.`
          : simRegenTimedOut || Date.now() >= solverDeadline
          ? `Partial results: regenerated ${updatedCount} of ${ids.length} lineups before the solver time budget was reached.`
          : undefined,
      });
    } catch (err: any) {
      console.error("[SimRegen] Error:", err);
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message || "Sim regeneration failed" });
    }
  });

  app.post("/api/lineups/import-dk", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "pro") {
      return res.status(403).json({ message: "DK Entries import is a Champion-only feature." });
    }

    const { entries, sport } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: "No entries provided." });
    }
    if (!sport) {
      return res.status(400).json({ message: "Sport is required." });
    }
    const normalizedSport = String(sport).trim().toUpperCase();
    const config = getPlatformConfig(normalizedSport, "draftkings" as Platform);
    if (!config) {
      return res.status(400).json({ message: `Unsupported DraftKings sport: ${normalizedSport}.` });
    }

    // Contest identity is authoritative for imports.  A caller-provided
    // slateId is intentionally ignored: choosing the first local slate (or
    // trusting a client-selected slate) can silently assign a mixed CSV to
    // the wrong player pool.
    let localSlates = await storage.getSlates();
    const contestIds = entries
      .map(entry => normalizeDKContestId(entry?.contestId))
      .filter((id): id is number => id !== null);
    let liveContestResults: Map<number, DKContestIdentityResult>;
    try {
      liveContestResults = await resolveDKContestDraftGroups(normalizedSport, contestIds);
    } catch (error) {
      console.error("[DK Import] Contest identity lookup failed:", error);
      liveContestResults = new Map(
        contestIds.map(contestId => [contestId, { status: "unavailable" as const }]),
      );
    }

    const contestLookups = new Map<number, DKImportContestLookup>();
    for (const contestId of contestIds) {
      const result = liveContestResults.get(contestId);
      if (!result || result.status !== "resolved") {
        contestLookups.set(contestId, result
          ? { status: result.status }
          : { status: "unavailable" });
      } else {
        contestLookups.set(contestId, {
          status: "resolved",
          draftGroupId: result.identity.draftGroupId,
        });
      }
    }

    type SlatePlayers = {
      players: Player[];
      byDraftKingsId: Map<number, Player | null>;
    };
    const playersBySlate = new Map<number, SlatePlayers>();
    const slateByDraftGroup = new Map<number, Slate>();

    const loadSlatePlayers = async (slate: Slate): Promise<SlatePlayers> => {
      const cached = playersBySlate.get(slate.id);
      if (cached) return cached;

      const slatePlayers = await storage.getPlayersBySlate(slate.id);
      // A duplicate provider ID in one local slate is ambiguous.  Retaining
      // null in the map makes every entry using it fail instead of selecting
      // whichever row happened to be returned last.
      const byDraftKingsId = new Map<number, Player | null>();
      for (const player of slatePlayers) {
        if (!player.draftKingsPlayerId) continue;
        if (byDraftKingsId.has(player.draftKingsPlayerId)) {
          byDraftKingsId.set(player.draftKingsPlayerId, null);
        } else {
          byDraftKingsId.set(player.draftKingsPlayerId, player);
        }
      }
      const loaded = { players: slatePlayers, byDraftKingsId };
      playersBySlate.set(slate.id, loaded);
      return loaded;
    };

    const ensureSlateForContest = async (
      contestId: number,
      draftGroupId: number,
    ): Promise<{ slate?: Slate; players?: SlatePlayers; error?: string }> => {
      const liveContest = liveContestResults.get(contestId);
      if (!liveContest || liveContest.status !== "resolved") {
        return { error: "DraftKings contest identity is unavailable; refusing to import this entry." };
      }
      if (liveContest.identity.draftGroupId !== draftGroupId) {
        return { error: "DraftKings contest identity changed during import; refusing to import this entry." };
      }
      if (!isClassicDKDraftGroup(normalizedSport, liveContest.identity.draftGroup)) {
        return { error: "Contest does not identify a supported DraftKings classic slate." };
      }

      const fetchExactSlateData = async (): Promise<Awaited<ReturnType<typeof fetchDKSlateByDraftGroup>>> => {
        try {
          return await fetchDKSlateByDraftGroup(normalizedSport, draftGroupId, {
            startTime: liveContest.identity.draftGroup.StartDateEst,
          });
        } catch (error) {
          console.error(`[DK Import] Error loading DraftGroup ${draftGroupId}:`, error);
          return null;
        }
      };

      const prepareExistingSlate = async (
        existingSlate: Slate,
      ): Promise<{ slate?: Slate; players?: SlatePlayers; error?: string }> => {
        if (existingSlate.gameType?.toLowerCase() === "showdown") {
          return { error: "Contest resolves to a DraftKings Showdown slate, which classic import does not support." };
        }
        const existingPlayers = await loadSlatePlayers(existingSlate);
        const hasProviderIds = existingPlayers.players.some(player =>
          Number.isSafeInteger(player.draftKingsPlayerId) && Number(player.draftKingsPlayerId) > 0,
        );
        if (existingPlayers.players.length > 0 && hasProviderIds) {
          slateByDraftGroup.set(draftGroupId, existingSlate);
          return { slate: existingSlate, players: existingPlayers };
        }

        // A slate row can survive a failed startup/import while its player
        // pool is empty.  Repair only that exact live draft group; never
        // populate it from a different group or from player-name overlap.
        const slateData = await fetchExactSlateData();
        if (
          !slateData ||
          slateData.sport !== normalizedSport ||
          slateData.draftGroupId !== draftGroupId ||
          slateData.dkPlayers.length === 0
        ) {
          return { error: "DraftKings player pool for this contest is unavailable; refusing to import this entry." };
        }
        let repairedPlayers: Player[];
        try {
          repairedPlayers = await storage.bulkCreatePlayers(
            slateData.dkPlayers.map(player => ({ ...player, slateId: existingSlate.id })),
          );
        } catch (error: any) {
          return {
            error: error?.message || "Could not repair the empty DraftKings player pool for this entry.",
          };
        }
        if (repairedPlayers.length === 0) {
          return { error: "DraftKings player pool for this contest is empty; refusing to import this entry." };
        }
        playersBySlate.delete(existingSlate.id);
        const loadedRepairedPlayers = await loadSlatePlayers(existingSlate);
        slateByDraftGroup.set(draftGroupId, existingSlate);
        return { slate: existingSlate, players: loadedRepairedPlayers };
      };

      const cachedSlate = slateByDraftGroup.get(draftGroupId);
      if (cachedSlate) return prepareExistingSlate(cachedSlate);

      const resolution = resolveDKImportSlate(
        contestId,
        contestLookups,
        localSlates,
        normalizedSport,
      );
      if (resolution.status === "ambiguous-local-slate") {
        return { error: describeDKImportSlateResolution(resolution) };
      }
      if (resolution.status === "resolved") {
        return prepareExistingSlate(resolution.slate);
      }
      if (resolution.status !== "missing-local-slate") {
        return { error: describeDKImportSlateResolution(resolution) };
      }

      // The initial all-slates read can race a startup sync.  Recheck the
      // exact provider identity through storage immediately before creating
      // anything so a just-created slate is reused rather than duplicated.
      try {
        const justCreatedSlate = await storage.getSlateByDraftGroup(
          normalizedSport,
          "draftkings",
          draftGroupId,
        );
        if (justCreatedSlate) {
          localSlates = localSlates.some(slate => slate.id === justCreatedSlate.id)
            ? localSlates
            : [...localSlates, justCreatedSlate];
          return prepareExistingSlate(justCreatedSlate);
        }
      } catch (error) {
        console.error(`[DK Import] Error rechecking DraftGroup ${draftGroupId} before create:`, error);
        return { error: "Could not verify the local DraftKings slate identity; refusing to import this entry." };
      }

      const slateData = await fetchExactSlateData();
      if (
        !slateData ||
        slateData.sport !== normalizedSport ||
        slateData.draftGroupId !== draftGroupId ||
        slateData.dkPlayers.length === 0
      ) {
        return { error: "DraftKings player pool for this contest is unavailable; refusing to import this entry." };
      }

      const newSlate = await storage.createSlate({
        sport: normalizedSport,
        platform: "draftkings",
        name: `${normalizedSport} ${liveContest.identity.draftGroup.DraftGroupTag || "DraftKings"} (${liveContest.identity.draftGroup.GameCount} games)`,
        startTime: parseEasternTime(liveContest.identity.draftGroup.StartDateEst),
        isMain: false,
        draftGroupId,
        gameType: liveContest.identity.draftGroup.GameType || "Classic",
        label: liveContest.identity.draftGroup.ContestStartTimeSuffix || null,
        gameCount: liveContest.identity.draftGroup.GameCount,
        contestCount: 1,
      });
      let createdPlayers: Player[];
      try {
        createdPlayers = await storage.bulkCreatePlayers(
          slateData.dkPlayers.map(player => ({ ...player, slateId: newSlate.id })),
        );
      } catch (error) {
        try {
          await storage.deleteSlateAndPlayers(newSlate.id);
        } catch (cleanupError) {
          console.error(`[DK Import] Failed to clean up empty slate ${newSlate.id}:`, cleanupError);
        }
        throw error;
      }
      if (createdPlayers.length === 0) {
        // No lineup references the new slate yet, so this cleanup preserves
        // the fail-closed behavior without leaving an unusable identity.
        await storage.deleteSlateAndPlayers(newSlate.id);
        return { error: "DraftKings player pool for this contest is empty; refusing to import this entry." };
      }

      localSlates = [...localSlates, newSlate];
      slateByDraftGroup.set(draftGroupId, newSlate);
      const loadedPlayers = await loadSlatePlayers(newSlate);
      console.log(`[DK Import] Created slate ${newSlate.id} with ${createdPlayers.length} players for DG ${draftGroupId}`);
      return {
        slate: newSlate,
        players: loadedPlayers,
      };
    };

    const maxPerSport = isAdmin ? 500 : 300;
    const currentCount = await storage.getLineupCountBySport(userId, normalizedSport);
    const availableSlots = maxPerSport - currentCount;
    if (availableSlots <= 0) {
      return res.status(403).json({ message: `You've reached the maximum of ${maxPerSport} saved teams per sport.` });
    }

    const results: { entryId: string; status: string; lineupId?: number; error?: string }[] = [];
    let imported = 0;

    for (const entry of entries) {
      if (imported >= availableSlots) {
        results.push({ entryId: String(entry.entryId ?? ""), status: "skipped", error: "Lineup limit reached." });
        continue;
      }

      const rawDkPlayerIds: number[] = Array.isArray(entry.dkPlayerIds) ? entry.dkPlayerIds : [];
      const entryPlayerNames: string[] = entry.playerNames || [];
      const entryId = String(entry.entryId ?? "");
      const contestId = normalizeDKContestId(entry.contestId);
      const contestResolution = resolveDKImportSlate(
        entry.contestId,
        contestLookups,
        localSlates,
        normalizedSport,
      );
      // A live contest can legitimately have no local slate yet; ensureSlate
      // imports that exact group below.  Reject every other non-resolved
      // identity before touching the player pool.
      if (
        contestResolution.status !== "resolved" &&
        contestResolution.status !== "missing-local-slate"
      ) {
        results.push({
          entryId,
          status: "failed",
          error: describeDKImportSlateResolution(contestResolution),
        });
        continue;
      }
      if (contestId === null) {
        results.push({
          entryId,
          status: "failed",
          error: "Contest ID is invalid; the entry's slate could not be identified.",
        });
        continue;
      }

      const liveContest = liveContestResults.get(contestId);
      if (!liveContest || liveContest.status !== "resolved") {
        results.push({
          entryId,
          status: "failed",
          error: "DraftKings contest identity is unavailable; refusing to import this entry.",
        });
        continue;
      }
      let slateResult: Awaited<ReturnType<typeof ensureSlateForContest>>;
      try {
        slateResult = await ensureSlateForContest(contestId, liveContest.identity.draftGroupId);
      } catch (error: any) {
        console.error(`[DK Import] Could not prepare slate for contest ${contestId}:`, error);
        results.push({
          entryId,
          status: "failed",
          error: error?.message || "Could not prepare the DraftKings slate for this entry.",
        });
        continue;
      }
      if (!slateResult.slate || !slateResult.players) {
        results.push({
          entryId,
          status: "failed",
          error: slateResult.error || "Could not resolve the DraftKings slate for this entry.",
        });
        continue;
      }

      const matchedPlayers: Player[] = [];
      const missingNames: string[] = [];
      const seenPlayerIds = new Set<number>();
      const duplicateProviderIds = new Set<number>();

      for (let i = 0; i < rawDkPlayerIds.length; i++) {
        const dkId = rawDkPlayerIds[i];
        const p = Number.isSafeInteger(dkId) ? slateResult.players.byDraftKingsId.get(dkId) : undefined;
        if (p === null) {
          duplicateProviderIds.add(dkId);
        } else if (p && !seenPlayerIds.has(p.id)) {
          seenPlayerIds.add(p.id);
          matchedPlayers.push(p);
        } else if (!p) {
          missingNames.push(entryPlayerNames[i] || `DK#${dkId}`);
        }
      }

      if (matchedPlayers.length !== config.rosterSize || duplicateProviderIds.size > 0) {
        const duplicateDetail = duplicateProviderIds.size > 0
          ? ` Ambiguous DraftKings player IDs: ${Array.from(duplicateProviderIds).join(", ")}.`
          : "";
        results.push({
          entryId,
          status: "failed",
          error: `Matched ${matchedPlayers.length}/${config.rosterSize} players. Could not find: ${missingNames.join(", ") || "one or more players"}.${duplicateDetail}`,
        });
        continue;
      }

      const totalSalary = matchedPlayers.reduce((s, p) => s + p.salary, 0);
      if (totalSalary > config.salaryCap) {
        results.push({ entryId, status: "failed", error: `Salary $${totalSalary.toLocaleString()} exceeds cap.` });
        continue;
      }

      const slotResult = assignPlayersToSlots(matchedPlayers, config.slots, normalizedSport);
      const unfilledSlots = config.slots.filter(s => !slotResult[s]);
      if (unfilledSlots.length > 0) {
        results.push({ entryId, status: "failed", error: `Cannot fill slots: ${unfilledSlots.join(", ")}` });
        continue;
      }

      const playerSnapshot = matchedPlayers.map(p => ({
        id: p.id, name: p.name, team: p.team, position: p.position,
        salary: p.salary, fppg: p.fppg, projectedPoints: p.projectedPoints,
        opponent: p.opponent, gameInfo: p.gameInfo,
        draftKingsPlayerId: p.draftKingsPlayerId,
        boostScore: p.boostScore, boostReason: p.boostReason,
      }));

      const totalProjectedPoints = matchedPlayers.reduce((s, p) => s + Number(p.projectedPoints || 0), 0).toFixed(1);
      const contestLabel = (entry.contestName || liveContest.identity.contestName || "").substring(0, 50) || null;

      try {
        const lineup = await storage.createLineup({
          userId,
          slateId: slateResult.slate.id,
          sport: normalizedSport,
          platform: "draftkings",
          totalSalary,
          totalProjectedPoints,
          playerIds: matchedPlayers.map(p => p.id),
          name: contestLabel ? `DK: ${contestLabel}` : `DK Import #${entry.entryId}`,
          playerSnapshot: playerSnapshot as any,
          dkEntryId: entryId || null,
          dkContestName: entry.contestName || null,
          dkContestId: contestId ? String(contestId) : null,
          dkEntryFee: entry.entryFee || null,
        });
        results.push({ entryId, status: "imported", lineupId: lineup.id });
        imported++;
      } catch (err: any) {
        results.push({ entryId, status: "failed", error: err.message || "Database error" });
      }
    }

    res.json({ imported, total: entries.length, results });
  });

  app.get("/api/subscription", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    const lineupCount = await storage.getLineupCount(userId);

    const sportCounts: Record<string, number> = {};
    for (const sport of ["NBA", "NHL", "GOLF", "MLB", "NFL"]) {
      sportCounts[sport] = await storage.getLineupCountBySport(userId, sport);
    }

    const maxLineupsPerSport = isAdmin ? 500 : tier === "pro" ? 300 : tier === "star" ? 20 : 1;

    res.json({
      tier,
      status: sub?.status || "active",
      lineupCount,
      maxLineups: maxLineupsPerSport,
      maxLineupsPerSport,
      sportCounts,
      graceEndsAt: sub?.graceEndsAt?.toISOString() || null,
      stripeSubscriptionId: sub?.stripeSubscriptionId || null,
      currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() || null,
      draftAccess: isAdmin || tier === "pro" || sub?.draftAccess === true,
    });
  });

  app.post("/api/subscription/checkout", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { tier, billing } = req.body;
    if (!tier || !["star", "pro"].includes(tier)) {
      return res.status(400).json({ message: "Invalid tier" });
    }
    const billingCycle = billing === "annual" ? "annual" : "monthly";

    try {
      const { createCheckoutSession } = await import("./stripe");
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const url = await createCheckoutSession(
        userId,
        user.email || "",
        tier,
        billingCycle,
        `${baseUrl}/pricing?success=true`,
        `${baseUrl}/pricing?canceled=true`
      );
      res.json({ url });
    } catch (err: any) {
      console.error("[stripe] Checkout error:", err);
      res.status(500).json({ message: err.message || "Failed to create checkout session" });
    }
  });

  app.post("/api/subscription/create-intent", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { tier, billing } = req.body;
    if (!tier || !["star", "pro"].includes(tier)) {
      return res.status(400).json({ message: "Invalid tier" });
    }
    const billingCycle = billing === "annual" ? "annual" : "monthly";

    try {
      const { createSubscriptionWithIntent } = await import("./stripe");
      const result = await createSubscriptionWithIntent(
        userId,
        user.email || "",
        tier,
        billingCycle
      );
      res.json(result);
    } catch (err: any) {
      console.error("[stripe] Create intent error:", err);
      res.status(500).json({ message: err.message || "Failed to create subscription" });
    }
  });

  app.post("/api/subscription/draft-hub-checkout", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    try {
      const { createDraftHubCheckoutSession } = await import("./stripe");
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const url = await createDraftHubCheckoutSession(
        userId,
        user.email || "",
        `${baseUrl}/pricing?draft_hub_success=true`,
        `${baseUrl}/pricing?canceled=true`
      );
      res.json({ url });
    } catch (err: any) {
      console.error("[stripe] Draft Hub checkout error:", err);
      res.status(500).json({ message: err.message || "Failed to create Draft Hub checkout" });
    }
  });

  app.post("/api/subscription/portal", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;

    try {
      const { createPortalSession } = await import("./stripe");
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const returnUrl = `${protocol}://${host}/pricing`;

      const dbUser = await storage.getUser(userId);
      const email = dbUser?.email || "";
      const url = await createPortalSession(userId, email, returnUrl);
      res.json({ url });
    } catch (err: any) {
      console.error("[stripe] Portal error:", err);
      res.status(500).json({ message: err.message || "Failed to create portal session" });
    }
  });

  app.post("/api/admin/set-tier", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    const { email, tier } = req.body;
    if (!email || !["free", "star", "pro"].includes(tier)) {
      return res.status(400).json({ message: "Valid email and tier (free, star, pro) required" });
    }
    try {
      const allUsers = await db.select().from(users).where(eq(users.email, email));
      if (allUsers.length === 0) return res.status(404).json({ message: "User not found" });
      const targetUser = allUsers[0];
      await storage.upsertSubscription({
        userId: targetUser.id,
        tier,
        status: "active",
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
        graceEndsAt: null,
      });
      res.json({ message: `Updated ${email} to ${tier} tier`, userId: targetUser.id });
    } catch (err) {
      console.error("[Admin] Set tier error:", err);
      res.status(500).json({ message: "Failed to update tier" });
    }
  });

  // ── Tutorial preference ────────────────────────────────────────────────────
  // Account-level "don't show the tutorial again" (checkbox on the overlay).
  app.post("/api/user/tutorial-preference", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const tutUserId = getSessionUserId(req)!;
    const disabled = req.body?.disabled === true;
    try {
      await db.update(users).set({ tutorialDisabled: disabled }).where(eq(users.id, tutUserId));
      res.json({ ok: true, tutorialDisabled: disabled });
    } catch (err) {
      console.error("[Tutorial] preference update failed:", err);
      res.status(500).json({ message: "Failed to save preference" });
    }
  });

  // ── Saved draft teams (Draft Hub "My Teams") ───────────────────────────────
  app.post("/api/draft-teams", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const dtUserId = getSessionUserId(req)!;
    // Saving is a paid feature: Champion, Draft Hub purchasers, or admin —
    // same gate as the Live Draft / Mock Draft tools that produce the teams.
    const dtUser = await storage.getUser(dtUserId);
    const dtSub = await storage.getSubscription(dtUserId);
    const dtIsAdmin = dtUser?.isAdmin === true;
    const dtHasAccess = dtIsAdmin || dtSub?.tier === "pro" || dtSub?.draftAccess === true;
    if (!dtHasAccess) {
      return res.status(403).json({
        message: "Saving teams requires the Draft Hub or a Champion subscription.",
        requiresUpgrade: true,
      });
    }
    try {
      const body = z
        .object({
          name: z.string().min(1).max(120),
          source: z.enum(["mock", "live"]).default("mock"),
          format: z.enum(["ppr", "half", "standard"]).default("ppr"),
          numTeams: z.number().int().min(2).max(20).default(12),
          userSlot: z.number().int().min(1).max(20).default(1),
          rounds: z.number().int().min(1).max(30).default(14),
          grade: z.string().max(3).default("—"),
          projectedPoints: z.number().min(0).max(9999).default(0),
          leagueRank: z.number().int().min(1).max(20).optional(),
          valuePicks: z.number().int().min(0).max(50).default(0),
          players: z
            .array(
              z.object({
                round: z.number().int(),
                overall: z.number().int(),
                name: z.string().max(80),
                team: z.string().max(6),
                position: z.string().max(6),
                adp: z.number().optional(),
              }),
            )
            .min(1)
            .max(40),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid team" });
      }
      const [team] = await db
        .insert(draftTeams)
        .values({
          userId: dtUserId,
          name: body.data.name,
          source: body.data.source,
          format: body.data.format,
          numTeams: body.data.numTeams,
          userSlot: body.data.userSlot,
          rounds: body.data.rounds,
          grade: body.data.grade,
          projectedPoints: String(body.data.projectedPoints),
          leagueRank: body.data.leagueRank ?? null,
          valuePicks: body.data.valuePicks,
          players: body.data.players,
        })
        .returning();
      res.json({ team });
    } catch (err) {
      console.error("[DraftTeams] save error:", err);
      res.status(500).json({ message: "Failed to save team" });
    }
  });

  app.get("/api/draft-teams", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const dtUserId = getSessionUserId(req)!;
    try {
      const teams = await db
        .select()
        .from(draftTeams)
        .where(eq(draftTeams.userId, dtUserId))
        .orderBy(desc(draftTeams.createdAt))
        .limit(100);
      res.json({ teams });
    } catch (err) {
      console.error("[DraftTeams] list error:", err);
      res.status(500).json({ message: "Failed to load teams" });
    }
  });

  app.delete("/api/draft-teams/:id", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const dtUserId = getSessionUserId(req)!;
    try {
      const id = parseInt(req.params.id, 10);
      const [deleted] = await db
        .delete(draftTeams)
        .where(and(eq(draftTeams.id, id), eq(draftTeams.userId, dtUserId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Team not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[DraftTeams] delete error:", err);
      res.status(500).json({ message: "Failed to delete team" });
    }
  });

  // ── Support tickets ────────────────────────────────────────────────────────
  // Anyone can file (logged-out visitors include their email); admins triage.
  app.post("/api/support", async (req, res) => {
    try {
      const body = z
        .object({
          email: z.string().email(),
          subject: z.string().min(3).max(150),
          message: z.string().min(10).max(4000),
          category: z.enum(["general", "billing", "bug", "data", "feature"]).default("general"),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid input" });
      }
      const ticketUserId = isLoggedIn(req) ? getSessionUserId(req) : null;
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: ticketUserId,
          email: body.data.email.toLowerCase().trim(),
          subject: body.data.subject.trim(),
          message: body.data.message.trim(),
          category: body.data.category,
        })
        .returning();
      res.json({ ok: true, ticketId: ticket!.id });
    } catch (err) {
      console.error("[Support] Create ticket error:", err);
      res.status(500).json({ message: "Failed to submit ticket. Please email support directly." });
    }
  });

  app.get("/api/admin/support", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const supUserId = getSessionUserId(req)!;
    const supAdmin = await storage.getUser(supUserId);
    if (!supAdmin?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const status = String(req.query.status ?? "all");
      const rows = await db
        .select()
        .from(supportTickets)
        .where(status === "all" ? undefined : eq(supportTickets.status, status))
        .orderBy(desc(supportTickets.createdAt))
        .limit(300);
      res.json({ tickets: rows });
    } catch (err) {
      console.error("[Support] List error:", err);
      res.status(500).json({ message: "Failed to load tickets" });
    }
  });

  app.patch("/api/admin/support/:id", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const supUserId = getSessionUserId(req)!;
    const supAdmin = await storage.getUser(supUserId);
    if (!supAdmin?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const body = z
        .object({
          status: z.enum(["open", "in_progress", "resolved"]).optional(),
          adminNotes: z.string().max(4000).optional(),
        })
        .safeParse(req.body);
      if (!body.success) return res.status(400).json({ message: "Invalid input" });
      const [updated] = await db
        .update(supportTickets)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(supportTickets.id, parseInt(req.params.id, 10)))
        .returning();
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      res.json({ ticket: updated });
    } catch (err) {
      console.error("[Support] Update error:", err);
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  // ── Admin: signup funnel visibility ────────────────────────────────────────
  // Who tried to sign up and failed, who signed up but never subscribed, who
  // started checkout and bailed. Powers the "User Funnel" tab in Admin.
  app.get("/api/admin/funnel", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const funnelUserId = getSessionUserId(req)!;
    const funnelAdmin = await storage.getUser(funnelUserId);
    if (!funnelAdmin?.isAdmin) return res.status(403).json({ message: "Admin access required" });

    try {
      const days = Math.min(90, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const events = await db
        .select()
        .from(signupEvents)
        .where(gte(signupEvents.createdAt, since))
        .orderBy(desc(signupEvents.createdAt))
        .limit(2000);

      // Summary counts by event type.
      const summary: Record<string, number> = {};
      for (const e of events) summary[e.eventType] = (summary[e.eventType] ?? 0) + 1;

      // Group events by email to find drop-offs.
      const byEmail = new Map<string, typeof events>();
      for (const e of events) {
        if (!e.email) continue;
        const list = byEmail.get(e.email) ?? [];
        list.push(e);
        byEmail.set(e.email, list);
      }
      const failedSignups: { email: string; attempts: number; lastReason: string | null; lastSeen: Date | null }[] = [];
      const abandonedCheckouts: { email: string; startedAt: Date | null; detail: string | null }[] = [];
      for (const [email, list] of Array.from(byEmail.entries())) {
        const succeeded = list.some((e) => e.eventType === "signup_success");
        const attempted = list.some((e) => e.eventType === "signup_attempt" || e.eventType === "signup_error");
        if (attempted && !succeeded) {
          const lastError = list.find((e) => e.eventType === "signup_error" || e.eventType === "signup_duplicate");
          failedSignups.push({
            email,
            attempts: list.filter((e) => e.eventType === "signup_attempt").length,
            lastReason: lastError?.errorReason ?? null,
            lastSeen: list[0]?.createdAt ?? null, // events are desc-ordered
          });
        }
        const started = list.find((e) => e.eventType === "checkout_started");
        const completed = list.some((e) => e.eventType === "checkout_completed");
        if (started && !completed) {
          abandonedCheckouts.push({ email, startedAt: started.createdAt, detail: started.errorReason });
        }
      }

      // Registered users in the window with no active paid subscription.
      const recentUsers = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          createdAt: users.createdAt,
          tier: subscriptions.tier,
          status: subscriptions.status,
        })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(gte(users.createdAt, since))
        .orderBy(desc(users.createdAt))
        .limit(500);
      const unconvertedUsers = recentUsers.filter(
        (u) => !u.tier || u.tier === "free" || u.status !== "active",
      );

      res.json({
        days,
        summary,
        failedSignups: failedSignups.slice(0, 100),
        abandonedCheckouts: abandonedCheckouts.slice(0, 100),
        unconvertedUsers: unconvertedUsers.slice(0, 200),
        recentEvents: events.slice(0, 100),
      });
    } catch (err) {
      console.error("[Admin] Funnel error:", err);
      res.status(500).json({ message: "Failed to load funnel data" });
    }
  });

  app.post("/api/admin/seed", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      await seedDatabase();
      res.json({ message: "Database seeded successfully" });
    } catch (err) {
      res.status(500).json({ message: "Seeding failed" });
    }
  });

  app.post("/api/admin/refresh-data", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      await seedDatabase(true);
      await generatePlayerBoostsAndInjuries();
      res.json({ message: "Data refreshed with latest from Ball Don't Lie API" });
    } catch (err) {
      console.error("Refresh failed:", err);
      res.status(500).json({ message: "Refresh failed" });
    }
  });

  app.get("/api/admin/dk-slates/:sport", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const sport = req.params.sport.toUpperCase();
      const available = await fetchAvailableDKSlates(sport);
      const existingSlates = await storage.getSlates();
      const existingDraftGroupIds = new Set(
        existingSlates
          .filter(s => s.draftGroupId && s.sport === sport)
          .map(s => s.draftGroupId)
      );
      const result = available.map(s => ({
        ...s,
        alreadyImported: existingDraftGroupIds.has(s.draftGroupId),
        slateId: existingSlates.find(existing =>
          existing.sport === sport &&
          existing.platform === "draftkings" &&
          existing.draftGroupId === s.draftGroupId,
        )?.id ?? null,
      }));
      res.json(result);
    } catch (err: any) {
      console.error("[Admin] Error fetching DK slates:", err);
      res.status(500).json({ message: err.message || "Failed to fetch DK slates" });
    }
  });

  app.patch("/api/admin/fix-slate-time/:id", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    const slateId = Number(req.params.id);
    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(404).json({ message: "Slate not found" });
    if (!slate.draftGroupId) return res.status(400).json({ message: "Slate has no draft group ID" });
    try {
      const availableSlates = await fetchAvailableDKSlates(slate.sport);
      const match = availableSlates.find(s => s.draftGroupId === slate.draftGroupId);
      if (match && match.startTime) {
        const correctedTime = parseEasternTime(match.startTime);
        await db.update(slates).set({ startTime: correctedTime }).where(eq(slates.id, slateId));
        return res.json({ message: `Updated slate ${slateId} start time to ${correctedTime.toISOString()}`, startTime: correctedTime });
      }
      return res.status(404).json({ message: "Could not find matching DK slate to correct time" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/add-dk-slate", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
       const requestedSport = String(req.body?.sport || "").toUpperCase();
       const draftGroupId = Number(req.body?.draftGroupId);
       const name = req.body?.name;
       if (!requestedSport || !Number.isSafeInteger(draftGroupId) || draftGroupId <= 0) {
        return res.status(400).json({ message: "sport and draftGroupId are required" });
      }

      const existingSlates = await storage.getSlates();
       const alreadyExists = existingSlates.find(s =>
         s.draftGroupId === draftGroupId && s.sport === requestedSport && s.platform === "draftkings");
      if (alreadyExists) {
        return res.status(409).json({ message: "This slate has already been imported", slateId: alreadyExists.id });
      }

        let liveMetadata: Awaited<ReturnType<typeof fetchAvailableDKSlates>>[number] | undefined;
       try {
         liveMetadata = (await fetchAvailableDKSlates(requestedSport))
           .find(metadata => metadata.draftGroupId === Number(draftGroupId));
       } catch {
         // Player data is still authoritative for an explicitly requested
         // group; metadata enrichment is best effort for this admin path.
       }
        const slateData = await fetchDKSlateByDraftGroup(requestedSport, draftGroupId, {
          startTime: liveMetadata?.startTime,
        });
       if (!slateData || slateData.dkPlayers.length === 0) {
         return res.status(404).json({ message: "No player data found for this DraftKings slate" });
       }

       const slateName = name || liveMetadata?.label || `${requestedSport} Slate ${draftGroupId}`;
      const newSlate = await storage.createSlate({
         sport: requestedSport,
        platform: "draftkings",
        name: slateName,
        startTime: slateData.slateDate,
        isMain: false,
        draftGroupId: draftGroupId,
         gameType: "Classic",
         label: liveMetadata?.label,
         gameCount: liveMetadata?.gameCount ?? slateData.games.length,
         contestCount: liveMetadata?.contestCount ?? 0,
      });

      const createdPlayers = await storage.bulkCreatePlayers(
         slateData.dkPlayers.map((p: any) => ({ ...p, slateId: newSlate.id })) as any
      );

       const today = getEasternToday();
      try {
        const historyRecords = createdPlayers.map(p => ({
          playerName: p.name,
          team: p.team,
           sport: requestedSport,
          position: p.position,
          salary: p.salary,
          projectedPoints: p.projectedPoints,
          slateDate: today,
          slateId: newSlate.id,
          draftKingsPlayerId: p.draftKingsPlayerId,
        }));
        await storage.bulkInsertPlayerHistory(historyRecords);
      } catch (err) {
         console.error(`[History] Failed to save ${requestedSport} snapshots for new slate:`, err);
      }

       console.log(`[Admin] Added ${requestedSport} slate "${slateName}" (DG ${draftGroupId}) with ${createdPlayers.length} players`);
      res.json({
        slate: newSlate,
        playerCount: createdPlayers.length,
         draftGroup: liveMetadata ?? {
           draftGroupId: Number(draftGroupId),
           contestId: slateData.contestId,
           contestName: slateData.contestName,
           contestPath: slateData.contestPath,
           contestUrl: slateData.contestUrl,
         },
        message: `Imported ${createdPlayers.length} players for ${slateName}`,
      });
    } catch (err: any) {
      console.error("[Admin] Error adding DK slate:", err);
      res.status(500).json({ message: err.message || "Failed to add slate" });
    }
  });

  app.get("/api/winning-lineups/:sport/insights", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro") {
        return res.status(403).json({ message: "Upgrade to Champion to access winning lineup insights" });
      }

      const sport = req.params.sport.toUpperCase();
      const platform = (req.query.platform as string) || undefined;
      const lineups = await storage.getWinningLineups(sport, 90, platform);

      if (lineups.length === 0) {
        return res.json({ sport, count: 0, aggregated: null });
      }

      const allInsights = lineups.map(l => l.insights as any).filter(Boolean);
      const allPlayerData = lineups.flatMap(l => (l.playerData as any[]) || []);

      const avgTotalPoints = allInsights.length > 0
        ? Math.round(allInsights.reduce((s: number, i: any) => s + (i.totalActualPoints || 0), 0) / allInsights.length * 100) / 100
        : 0;

      const avgSalaryUtil = allInsights.length > 0
        ? Math.round(allInsights.reduce((s: number, i: any) => s + (i.salaryUtilization || 0), 0) / allInsights.length * 10) / 10
        : 0;

      const avgProjectionRatio = allInsights.length > 0
        ? Math.round(allInsights.reduce((s: number, i: any) => s + (i.avgProjectionRatio || 0), 0) / allInsights.length * 100) / 100
        : 0;

      const avgSalaryEfficiency = allInsights.length > 0
        ? Math.round(allInsights.reduce((s: number, i: any) => s + (i.salaryEfficiency || 0), 0) / allInsights.length * 100) / 100
        : 0;

      const salaryBuckets: Record<string, { count: number; avgActual: number }> = {
        "3000-4999": { count: 0, avgActual: 0 },
        "5000-6999": { count: 0, avgActual: 0 },
        "7000-8999": { count: 0, avgActual: 0 },
        "9000+": { count: 0, avgActual: 0 },
      };

      for (const p of allPlayerData) {
        const salary = p.salary || 0;
        const actual = p.actualPoints || 0;
        let bucket: string;
        if (salary < 5000) bucket = "3000-4999";
        else if (salary < 7000) bucket = "5000-6999";
        else if (salary < 9000) bucket = "7000-8999";
        else bucket = "9000+";
        salaryBuckets[bucket].count++;
        salaryBuckets[bucket].avgActual += actual;
      }
      for (const b of Object.keys(salaryBuckets)) {
        if (salaryBuckets[b].count > 0) {
          salaryBuckets[b].avgActual = Math.round((salaryBuckets[b].avgActual / salaryBuckets[b].count) * 100) / 100;
        }
      }

      const posFrequency: Record<string, number> = {};
      for (const p of allPlayerData) {
        const pos = (p.position || "").split("/")[0];
        posFrequency[pos] = (posFrequency[pos] || 0) + 1;
      }

      const topPlayers = Object.entries(
        allPlayerData.reduce((acc: Record<string, { count: number; totalActual: number }>, p: any) => {
          const name = p.name || "Unknown";
          if (!acc[name]) acc[name] = { count: 0, totalActual: 0 };
          acc[name].count++;
          acc[name].totalActual += p.actualPoints || 0;
          return acc;
        }, {})
      )
        .map(([name, data]) => ({ name, ...data, avgActual: Math.round((data.totalActual / data.count) * 100) / 100 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      res.json({
        sport,
        count: lineups.length,
        aggregated: {
          avgTotalPoints,
          avgSalaryUtil,
          avgProjectionRatio,
          avgSalaryEfficiency,
          salaryBuckets,
          posFrequency,
          topPlayers,
        },
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to compute insights" });
    }
  });

  app.get("/api/winning-lineups-availability", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const rows = await db.execute(sql`
        SELECT sport, platform, COUNT(*)::int as count
        FROM winning_lineups
        GROUP BY sport, platform
        ORDER BY sport, platform
      `);
      const data = (rows.rows || rows) as { sport: string; platform: string; count: number }[];
      res.json(data);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch availability" });
    }
  });

  app.get("/api/winning-lineups/:sport", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro") {
        return res.status(403).json({ message: "Upgrade to Champion to access winning lineup analysis" });
      }

      const sport = req.params.sport.toUpperCase();
      const limit = parseInt(req.query.limit as string) || 30;
      const platform = (req.query.platform as string) || undefined;
      const lineups = await storage.getWinningLineups(sport, limit, platform);
      res.json(lineups);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch winning lineups" });
    }
  });

  app.post("/api/admin/analyze-slate", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const { sport, date, platform = "draftkings", force = false } = req.body;
      if (!sport || !date) return res.status(400).json({ message: "sport and date required" });

      const { analyzeCompletedSlate } = await import("./winning-lineup-agent");
      const result = await analyzeCompletedSlate(sport.toUpperCase(), date, platform, force);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Analysis failed" });
    }
  });

  app.post("/api/admin/backfill-winning-lineups", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const days = typeof req.body.days === "number" ? Math.min(Math.max(req.body.days, 1), 30) : 7;
      const force = req.body.force === true;

      console.log(`[Admin] Backfill requested: last ${days} days, force=${force} by userId=${userId}`);

      const { runBackfill } = await import("./winning-lineup-agent");
      const summary = await runBackfill(days, force);
      res.json(summary);
    } catch (err: any) {
      console.error("[Admin] Backfill error:", err);
      res.status(500).json({ message: err.message || "Backfill failed" });
    }
  });

  app.post("/api/admin/backfill-and-analyze", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      if (!dbUser?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const { sport, date, draftGroupId } = req.body;
      if (!sport || !date || !draftGroupId) return res.status(400).json({ message: "sport, date, and draftGroupId required" });

      const sportUpper = sport.toUpperCase();
      const { fetchDraftables } = await import("./balldontlie");
      const draftables = await fetchDraftables(Number(draftGroupId));
      if (!draftables || draftables.length === 0) {
        return res.status(404).json({ message: `No draftables found for DraftGroup ${draftGroupId}` });
      }

      const existingHistory = await storage.getPlayerHistoryBySport(sportUpper, 10000);
      const existingForDate = existingHistory.filter(h => h.slateDate === date);

      if (existingForDate.length > 0) {
        const { analyzeCompletedSlate } = await import("./winning-lineup-agent");
        const result = await analyzeCompletedSlate(sportUpper, date);
        return res.json({ backfilled: 0, analysis: result });
      }

      const slates = await storage.getSlates();
      const slate = slates.find(s => s.draftGroupId === Number(draftGroupId));
      const slateId = slate?.id || null;

      const historyRecords = draftables
        .filter(d => d.displayName && (d.salary > 0 || d.draftStatAttributes?.length > 0))
        .map(d => {
          const FPPG_IDS = [219, 90, 341, 745];
          let fppg = "0";
          for (const fid of FPPG_IDS) {
            const attr = d.draftStatAttributes?.find((a: any) => a.id === fid);
            if (attr?.value && attr.value !== "-" && !isNaN(parseFloat(attr.value))) {
              fppg = attr.value;
              break;
            }
          }
          const salary = d.salary || Math.round(parseFloat(fppg) * 200);
          return {
            playerName: d.displayName,
            team: d.teamAbbreviation || "",
            sport: sportUpper,
            position: d.position || "",
            salary,
            projectedPoints: fppg !== "0" ? fppg : String(salary / 1000),
            slateDate: date,
            slateId,
            draftKingsPlayerId: d.draftableId || null,
          };
        })
        .filter(d => d.salary > 0);

      await storage.bulkInsertPlayerHistory(historyRecords);
      console.log(`[Admin] Backfilled ${historyRecords.length} player history records for ${sportUpper} ${date} (DG ${draftGroupId})`);

      const { analyzeCompletedSlate } = await import("./winning-lineup-agent");
      const result = await analyzeCompletedSlate(sportUpper, date);
      res.json({ backfilled: historyRecords.length, analysis: result });
    } catch (err: any) {
      console.error("Backfill and analyze failed:", err);
      res.status(500).json({ message: err.message || "Backfill and analysis failed" });
    }
  });

  app.get("/api/dashboard/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const allSlates = await storage.getSlates();
      const slate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isMain && s.isActive !== false)
        || allSlates.find(s => s.sport === sport && s.platform === "fanduel" && s.isMain && s.isActive !== false)
        || allSlates.find(s => s.sport === sport && s.platform === "yahoo" && s.isMain && s.isActive !== false);
      if (!slate) {
        return res.json({ sport, topScorers: [], trending: [], matchups: [], slateId: null });
      }

      const allPlayers = await storage.getPlayersBySlate(slate.id);
      if (!allPlayers || allPlayers.length === 0) {
        return res.json({ sport, topScorers: [], trending: [], matchups: [], slateId: slate.id });
      }

      const { inactiveIds: dashInactiveIds } = await getInactivePlayerIds(allPlayers, sport);
      const dashInactiveSet = new Set(dashInactiveIds);
      const activePlayers = allPlayers.filter(p => !dashInactiveSet.has(p.id));

      const topScorers = [...activePlayers]
        .sort((a, b) => parseFloat(b.projectedPoints || "0") - parseFloat(a.projectedPoints || "0"))
        .slice(0, 8)
        .map(p => ({
          id: p.id,
          name: p.name,
          position: p.position,
          team: p.team,
          salary: p.salary,
          projectedPoints: p.projectedPoints,
          fppg: p.fppg,
          opponent: p.opponent,
         gameInfo: sanitizeGameInfo(p.gameInfo),
        }));

      const withValue = activePlayers
        .filter(p => p.salary && p.salary > 0 && parseFloat(p.projectedPoints || "0") > 0)
        .map(p => ({
          ...p,
          valueScore: parseFloat(p.projectedPoints || "0") / (p.salary / 1000),
        }));

      const sortedByValue = [...withValue].sort((a, b) => b.valueScore - a.valueScore);
      const trendingUp = sortedByValue.slice(0, 5).map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        salary: p.salary,
        projectedPoints: p.projectedPoints,
        fppg: p.fppg,
        opponent: p.opponent,
        gameInfo: sanitizeGameInfo(p.gameInfo),
        valueScore: p.valueScore.toFixed(2),
        direction: "up" as const,
      }));

      const sortedByValueAsc = [...withValue]
        .filter(p => p.salary >= 4000)
        .sort((a, b) => a.valueScore - b.valueScore);
      const trendingDown = sortedByValueAsc.slice(0, 3).map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        salary: p.salary,
        projectedPoints: p.projectedPoints,
        fppg: p.fppg,
        opponent: p.opponent,
        gameInfo: sanitizeGameInfo(p.gameInfo),
        valueScore: p.valueScore.toFixed(2),
        direction: "down" as const,
      }));

      const trending = [...trendingUp, ...trendingDown];

      const gameMap = new Map<string, typeof allPlayers>();
      for (const p of allPlayers) {
         const key = sanitizeGameInfo(p.gameInfo) || "unknown";
        if (!gameMap.has(key)) gameMap.set(key, []);
        gameMap.get(key)!.push(p);
      }

      const matchups = Array.from(gameMap.entries())
        .filter(([key]) => key !== "unknown")
        .map(([gameInfo, gamePlayers]) => {
          const avgProj = gamePlayers.reduce((sum, p) => sum + parseFloat(p.projectedPoints || "0"), 0) / gamePlayers.length;
          const topPlayer = [...gamePlayers].sort((a, b) => parseFloat(b.projectedPoints || "0") - parseFloat(a.projectedPoints || "0"))[0];
          return {
            gameInfo,
            playerCount: gamePlayers.length,
            avgProjection: avgProj.toFixed(1),
            topPlayer: topPlayer ? {
              id: topPlayer.id,
              name: topPlayer.name,
              position: topPlayer.position,
              team: topPlayer.team,
              salary: topPlayer.salary,
              projectedPoints: topPlayer.projectedPoints,
            } : null,
          };
        })
        .sort((a, b) => parseFloat(b.avgProjection) - parseFloat(a.avgProjection))
        .slice(0, 6);

      res.json({ sport, slateId: slate.id, topScorers, trending, matchups });
    } catch (err) {
      console.error("Dashboard data error:", err);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  });

  app.get("/api/landing-data", async (_req, res) => {
    try {
      const allSlates = await storage.getSlates();
      const sportData: Record<string, {
        playerCount: number;
        gameCount: number;
        topPlayers: Array<{
          name: string; team: string; position: string; salary: number;
          projectedPoints: string; boostedPoints: string; opponent: string;
          gameInfo: string; boostScore: string; injuryStatus: string | null;
          valueScore: string;
        }>;
      }> = {};

      const scoutSignals: Record<string, string[]> = {};

      for (const sport of ["NBA", "NHL", "NFL", "MLB", "GOLF", "SOCCER"]) {
        const slate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isMain && s.isActive !== false)
          || allSlates.find(s => s.sport === sport && s.platform === "fanduel" && s.isMain && s.isActive !== false)
          || allSlates.find(s => s.sport === sport && s.platform === "yahoo" && s.isMain && s.isActive !== false);
        if (!slate) continue;

        const players = await storage.getPlayersBySlate(slate.id);
        if (!players || players.length === 0) continue;

        const signals = getCachedSignals(sport);
        const outNames = new Set(
          signals
            .filter(s => s.signal_type === "out" || s.signal_type === "starter_out")
            .map(s => s.player_name.toLowerCase())
        );
        const boostNames = new Map(
          signals
            .filter(s => s.signal_type === "injury_opp" || s.signal_type === "hot_streak" || s.signal_type === "value_spike")
            .map(s => [s.player_name.toLowerCase(), s])
        );

        if (signals.length > 0) {
          scoutSignals[sport] = signals
            .filter(s => s.signal_type !== "out" && s.confidence >= 0.6)
            .slice(0, 3)
            .map(s => s.reason);
        }

        const boostedPlayers = players
          .filter(p => parseFloat(p.projectedPoints || "0") > 0)
          .filter(p => !outNames.has(p.name.toLowerCase()))
          .map(p => {
            const baseProj = parseFloat(p.projectedPoints || "0");
            const boostPct = p.boostScore ? Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008)) : 0;
            let boosted = baseProj * (1 + boostPct);

            const scoutSig = boostNames.get(p.name.toLowerCase());
            if (scoutSig) {
              const scoutBoost = scoutSig.signal_type === "injury_opp" ? 0.08
                : scoutSig.signal_type === "hot_streak" ? 0.04
                : 0.03;
              boosted *= (1 + scoutBoost);
            }

            const valueScore = p.salary > 0 ? boosted / (p.salary / 1000) : 0;

            return {
              ...p,
              boostedPoints: boosted,
              valueScore,
            };
          })
          .sort((a, b) => b.boostedPoints - a.boostedPoints);

        const games = new Set(players.map(p => sanitizeGameInfo(p.gameInfo)).filter(Boolean));

        sportData[sport] = {
          playerCount: players.length,
          gameCount: games.size,
          topPlayers: boostedPlayers.slice(0, 5).map(p => ({
            name: p.name,
            team: p.team || "",
            position: p.position || "",
            salary: p.salary || 0,
            projectedPoints: p.projectedPoints || "0",
            boostedPoints: p.boostedPoints.toFixed(1),
            opponent: p.opponent || "",
            gameInfo: sanitizeGameInfo(p.gameInfo),
            boostScore: p.boostScore || "0",
            injuryStatus: p.injuryStatus || null,
            valueScore: p.valueScore.toFixed(2),
          })),
        };
      }

      const activeSports = Object.keys(sportData);
      const totalPlayers = Object.values(sportData).reduce((s, d) => s + d.playerCount, 0);
      const totalGames = Object.values(sportData).reduce((s, d) => s + d.gameCount, 0);

      res.json({
        sports: sportData,
        activeSports,
        totalPlayers,
        totalGames,
        scoutSignals,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Landing data error:", err);
      res.json({ sports: {}, activeSports: [], totalPlayers: 0, totalGames: 0, lastUpdated: new Date().toISOString() });
    }
  });

  app.get("/api/worldcup", async (_req, res) => {
    if (!WORLD_CUP_ENABLED) return res.status(404).json({ error: "World Cup features are disabled" });
    try {
      const today = getEasternToday();
      const allSlates = await storage.getSlates();
      const slate = allSlates.find(s => s.sport === "SOCCER" && s.platform === "draftkings" && s.isMain && s.isActive !== false)
        || allSlates.find(s => s.sport === "SOCCER" && s.isMain && s.isActive !== false)
        || allSlates.find(s => s.sport === "SOCCER" && s.isActive !== false);

      if (!slate) {
        return res.json({ league: "FIFA World Cup", matchCount: 0, totalPicks: 0, matches: [] });
      }

      const players = await storage.getPlayersBySlate(slate.id);
      const soccerProps = await storage.getPropsByDate(today, "SOCCER");

      const signals = getCachedSignals("SOCCER");
      const outNames = new Set(
        signals
          .filter(s => s.signal_type === "out" || s.signal_type === "starter_out")
          .map(s => s.player_name.toLowerCase())
      );

      const matchKey = (a?: string, b?: string) =>
        [(a || "").toUpperCase(), (b || "").toUpperCase()].sort().join("__");

      const parseTimeToMinutes = (t: string): number => {
        const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!m) return 9999;
        let hr = parseInt(m[1], 10) % 12;
        if (/PM/i.test(m[3])) hr += 12;
        return hr * 60 + parseInt(m[2], 10);
      };

      interface WCPick {
        id: string;
        playerName: string;
        team: string;
        opponent: string;
        propType: string;
        line: string;
        pick: string;
        confidence: number;
        source: "market" | "model";
      }
      interface WCMatch {
        key: string;
        teams: [string, string];
        time: string;
        timeRank: number;
        players: typeof players;
        picks: WCPick[];
      }
      const matchMap = new Map<string, WCMatch>();

      for (const p of players) {
        if (!p.gameInfo) continue;
        const parsedGame = parseGameInfo(p.gameInfo);
        const teams = [parsedGame.away, parsedGame.home].filter((team): team is string => Boolean(team));
        if (teams.length < 2) continue;
        const key = matchKey(teams[0], teams[1]);
        if (!matchMap.has(key)) {
          const time = parsedGame.time || "";
          matchMap.set(key, {
            key,
            teams: [teams[0].toUpperCase(), teams[1].toUpperCase()],
            time,
            timeRank: parseTimeToMinutes(time),
            players: [],
            picks: [],
          });
        }
        matchMap.get(key)!.players.push(p);
      }

      // Attach real market prop picks (The Odds API) to their match
      for (const prop of soccerProps) {
        const key = matchKey(prop.team, prop.opponent || "");
        const match = matchMap.get(key);
        if (!match) continue;
        const opponent = prop.opponent || match.teams.find(t => t !== (prop.team || "").toUpperCase()) || "";
        match.picks.push({
          id: `mkt-${prop.id}`,
          playerName: prop.playerName,
          team: prop.team,
          opponent,
          propType: prop.propType,
          line: String(prop.line),
          pick: prop.pick,
          confidence: Number.isFinite(Number(prop.confidence)) ? Math.round(Number(prop.confidence)) : 70,
          source: "market",
        });
      }

      // Guarantee every match shows good picks: supplement with model value picks
      const MIN_PICKS = 3;
      for (const match of matchMap.values()) {
        if (match.picks.length >= MIN_PICKS) continue;
        const usedNames = new Set(match.picks.map(p => p.playerName.toLowerCase()));
        const candidates = match.players
          .filter(p =>
            parseFloat(p.projectedPoints || "0") > 0 &&
            !outNames.has(p.name.toLowerCase()) &&
            !usedNames.has(p.name.toLowerCase())
          )
          .map(p => {
            const baseProj = parseFloat(p.projectedPoints || "0");
            const boostPct = p.boostScore ? Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008)) : 0;
            return { player: p, boosted: baseProj * (1 + boostPct) };
          })
          .sort((a, b) => b.boosted - a.boosted);

        let rank = 0;
        for (const c of candidates) {
          if (match.picks.length >= MIN_PICKS) break;
          const opponent = c.player.opponent || match.teams.find(t => t !== (c.player.team || "").toUpperCase()) || "";
          match.picks.push({
            id: `mdl-${c.player.id}`,
            playerName: c.player.name,
            team: c.player.team || "",
            opponent,
            propType: "Projected Points",
            line: c.boosted.toFixed(1),
            pick: "Top Play",
            confidence: Math.max(60, 74 - rank * 4),
            source: "model",
          });
          rank++;
        }
      }

      const matches = Array.from(matchMap.values())
        .map(m => ({
          teams: m.teams,
          label: `${m.teams[0]} vs ${m.teams[1]}`,
          time: m.time,
          timeRank: m.timeRank,
          picks: m.picks.sort((a, b) => b.confidence - a.confidence).slice(0, 4),
        }))
        .filter(m => m.picks.length > 0)
        .sort((a, b) => a.timeRank - b.timeRank)
        .map(({ timeRank, ...rest }) => rest);

      res.json({
        league: "FIFA World Cup",
        matchCount: matches.length,
        totalPicks: matches.reduce((s, m) => s + m.picks.length, 0),
        matches,
      });
    } catch (err) {
      console.error("World Cup data error:", err);
      res.json({ league: "FIFA World Cup", matchCount: 0, totalPicks: 0, matches: [] });
    }
  });

  const ESPN_NEWS_URLS: Record<string, string> = {
    NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news",
    NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news",
    MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news",
    NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
    GOLF: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/news",
  };

  const newsCache = new Map<string, { data: any; fetchedAt: number }>();
  const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;


  app.get("/api/scores", async (_req, res) => {
    try {
      const scores = await getAllLiveScores();
      res.json(scores);
    } catch (err) {
      console.error("Error fetching all scores:", err);
      res.status(500).json({ error: "Failed to fetch scores" });
    }
  });

  app.get("/api/scores/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const validSports = ["NHL", "MLB", "NFL", "GOLF", "SOCCER"];
      if (!validSports.includes(sport)) {
        return res.status(400).json({ error: `Invalid sport: ${sport}. Valid: ${validSports.join(", ")}` });
      }
      const scores = await getLiveScores(sport);
      res.json(scores);
    } catch (err) {
      console.error(`Error fetching ${req.params.sport} scores:`, err);
      res.status(500).json({ error: "Failed to fetch scores" });
    }
  });

  // ── NFL Draft Rankings ────────────────────────────────────────────────────
  app.get("/api/nfl/draft-rankings", async (req, res) => {
    try {
      const { getDraftRankings } = await import("./nfl-draft");
      const force = req.query.refresh === "1";
      const players = await getDraftRankings(force);
      res.json({ players, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error("Error fetching NFL draft rankings:", err);
      res.status(500).json({ error: "Failed to fetch draft rankings" });
    }
  });

  // Rank movement history: last N daily snapshots for risers/fallers + sparklines.
  app.get("/api/nfl/draft-rankings/history", async (req, res) => {
    try {
      const { getRankHistory } = await import("./nfl-draft");
      const days = parseInt(String(req.query.days ?? "14"), 10) || 14;
      const history = await getRankHistory(days);
      res.json({ history });
    } catch (err) {
      console.error("Error fetching draft rank history:", err);
      res.status(500).json({ error: "Failed to fetch rank history" });
    }
  });

  app.post("/api/prizepicks/analyze", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const ppUser = await storage.getUser(userId);
      const ppIsAdmin = ppUser?.isAdmin === true;
      if (!ppIsAdmin && (!sub || sub.tier !== "pro")) {
        return res.status(403).json({ error: "Pro subscription required" });
      }

      const { picks } = req.body;
      if (!Array.isArray(picks) || picks.length < 1) {
        return res.status(400).json({ error: "At least 1 pick is required" });
      }

      const sports = new Set(picks.map((p: any) => (p.league || p.sport || "NBA").toUpperCase()));
      let allProjections: any[] = [];
      let dbPlayers: Player[] = [];
      let dbProps: any[] = [];

      for (const sport of sports) {
        let projections = await fetchPrizePicksProjections(sport);

        const allSlates = await storage.getSlates();
        const sportSlates = allSlates.filter(s => s.sport === sport && s.platform === "draftkings" && s.isActive !== false);
        for (const slate of sportSlates) {
          const slatePlayers = await storage.getPlayersBySlate(slate.id);
          dbPlayers.push(...slatePlayers);
        }

        if (projections.length === 0) {
          const seen = new Set<string>();
          const uniquePlayers = dbPlayers.filter(p => {
            if (seen.has(p.name)) return false;
            seen.add(p.name);
            return true;
          });
          projections = generateProjectionsFromPlayers(uniquePlayers, sport);
        }
        allProjections.push(...projections);

        const today = getEasternToday();
        const sportProps = await storage.getPropsByDate(today, sport);
        dbProps.push(...sportProps);
      }

      const result = analyzeManualPicks(picks, allProjections, dbPlayers, dbProps);
      res.json(result);
    } catch (err) {
      console.error("[PrizePicks Analyze] Error:", err);
      res.status(500).json({ error: "Failed to analyze picks" });
    }
  });

  // National-team names/codes used to filter the SOCCER feed to World Cup fixtures.
  const WC_NATIONS = new Set<string>([
    "argentina","brazil","france","england","spain","germany","portugal","netherlands","holland",
    "belgium","croatia","italy","uruguay","colombia","mexico","usa","united states","canada","japan",
    "south korea","korea republic","korea","australia","morocco","senegal","ghana","nigeria","cameroon",
    "egypt","tunisia","algeria","ivory coast","cote d'ivoire","ecuador","peru","chile","paraguay",
    "denmark","switzerland","poland","serbia","austria","ukraine","wales","scotland","turkey","turkiye",
    "iran","saudi arabia","qatar","costa rica","panama","honduras","jamaica","new zealand","norway",
    "sweden","czechia","czech republic","hungary","greece","russia","south africa","cape verde",
    "jordan","uzbekistan","new caledonia","curacao","haiti","bolivia","venezuela","slovenia","slovakia",
    "romania","ireland","northern ireland","iceland","finland","mali","dr congo","angola","zambia",
    // 3-letter FIFA codes
    "arg","bra","fra","eng","esp","ger","por","ned","bel","cro","ita","uru","col","mex","can","jpn",
    "kor","aus","mar","sen","gha","nga","cmr","egy","tun","alg","civ","ecu","per","chi","par","den",
    "sui","pol","srb","aut","ukr","wal","sco","tur","irn","ksa","qat","crc","pan","hon","jam","nzl",
    "nor","swe","cze","hun","gre","rsa","cpv","jor","uzb",
  ]);
  const isWorldCupProjection = (p: any) => {
    const team = String(p.team || "").toLowerCase().trim();
    const info = sanitizeGameInfo(p.gameInfo).toLowerCase();
    return WC_NATIONS.has(team) || /world cup|fifa|\bwc\b/.test(info);
  };
  // Fetch SOCCER projections (live feed → DB fallback) filtered to World Cup fixtures.
  async function getWorldCupProjections(): Promise<{ projections: any[]; soccerCount: number; dbPlayers: Player[] }> {
    let projections = await fetchPrizePicksProjections("SOCCER");
    const allSlates = await storage.getSlates();
    const soccerSlates = allSlates.filter(s => s.sport === "SOCCER" && s.platform === "draftkings" && s.isActive !== false);
    let dbPlayers: Player[] = [];
    for (const slate of soccerSlates) {
      const slatePlayers = await storage.getPlayersBySlate(slate.id);
      dbPlayers.push(...slatePlayers);
    }
    const seen = new Set<string>();
    dbPlayers = dbPlayers.filter(p => {
      if (seen.has(p.name)) return false;
      seen.add(p.name);
      return true;
    });
    if (projections.length === 0) {
      projections = generateProjectionsFromPlayers(dbPlayers, "SOCCER");
    }
    return { projections: projections.filter(isWorldCupProjection), soccerCount: projections.length, dbPlayers };
  }

  // World Cup auto-build: builds AI entries from World Cup–filtered SOCCER projections.
  app.get("/api/prizepicks/build/worldcup", async (req, res) => {
    if (!WORLD_CUP_ENABLED) return res.status(404).json({ error: "World Cup features are disabled" });
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const wcUser = await storage.getUser(userId);
      if (wcUser?.isAdmin !== true && (!sub || sub.tier !== "pro")) {
        return res.status(403).json({ error: "Pro subscription required" });
      }
      const { projections, dbPlayers } = await getWorldCupProjections();
      if (projections.length === 0) return res.json({ sport: "WORLDCUP", entries: [] });
      const wcPlayerNames = new Set(projections.map((p: any) => p.playerName));
      const wcPlayers = dbPlayers.filter(p => wcPlayerNames.has(p.name));
      const entries = buildAIEntries(projections, wcPlayers);
      res.json({ sport: "WORLDCUP", entries });
    } catch (err) {
      console.error("[PrizePicks WorldCup Builder] Error:", err);
      res.status(500).json({ error: "Failed to build entries" });
    }
  });

  app.get("/api/prizepicks/build/:sport", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const ppUser2 = await storage.getUser(userId);
      const ppIsAdmin2 = ppUser2?.isAdmin === true;
      if (!ppIsAdmin2 && (!sub || sub.tier !== "pro")) {
        return res.status(403).json({ error: "Pro subscription required" });
      }
      const sport = req.params.sport.toUpperCase();
      const supported = getSupportedPPSports();
      if (!supported.includes(sport)) {
        return res.status(400).json({ error: `Invalid sport: ${sport}` });
      }
      let projections = await fetchPrizePicksProjections(sport);

      const allSlates = await storage.getSlates();
      const sportSlates = allSlates.filter(s => s.sport === sport && s.platform === "draftkings" && s.isActive !== false);
      let dbPlayers: Player[] = [];
      for (const slate of sportSlates) {
        const slatePlayers = await storage.getPlayersBySlate(slate.id);
        dbPlayers.push(...slatePlayers);
      }

      if (projections.length === 0) {
        const seen = new Set<string>();
        const uniquePlayers = dbPlayers.filter(p => {
          if (seen.has(p.name)) return false;
          seen.add(p.name);
          return true;
        });
        projections = generateProjectionsFromPlayers(uniquePlayers, sport);
      }

      if (projections.length === 0) {
        return res.json({ sport, entries: [] });
      }

      console.log(`[PrizePicks Builder] ${sport}: ${projections.length} projections, ${dbPlayers.length} DK players`);

      const entries = buildAIEntries(projections, dbPlayers);
      res.json({ sport, entries });
    } catch (err) {
      console.error(`[PrizePicks Builder] Error for ${req.params.sport}:`, err);
      res.status(500).json({ error: "Failed to build entries" });
    }
  });

  app.get("/api/prizepicks/vault/entries", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const entries = await storage.getPrizePicksEntries(userId);
      res.json({ entries });
    } catch (err) {
      console.error("[PP Vault] Error fetching entries:", err);
      res.status(500).json({ error: "Failed to fetch entries" });
    }
  });

  app.post("/api/prizepicks/vault/entries", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const ppUser3 = await storage.getUser(userId);
      const ppIsAdmin3 = ppUser3?.isAdmin === true;
      if (!ppIsAdmin3 && (!sub || sub.tier !== "pro")) {
        return res.status(403).json({ error: "Pro subscription required" });
      }

      const count = await storage.getPrizePicksEntryCount(userId);
      const maxEntries = 50;
      if (count >= maxEntries) {
        return res.status(400).json({ error: `Maximum ${maxEntries} saved entries reached. Delete some entries to save new ones.` });
      }

      const { sport, picks, multiplier, wager, potentialPayout, label, overallConfidence } = req.body;
      if (!sport || !picks || !Array.isArray(picks) || picks.length < 2) {
        return res.status(400).json({ error: "Invalid entry data: need sport and at least 2 picks" });
      }

      const parsed = insertPrizePicksEntrySchema.safeParse({
        userId,
        sport,
        picks,
        multiplier,
        wager: wager?.toString() || null,
        potentialPayout: potentialPayout?.toString() || null,
        label: label || null,
        overallConfidence: overallConfidence || null,
        status: "active",
      });
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      }

      const entry = await storage.createPrizePicksEntry(parsed.data);
      res.json(entry);
    } catch (err) {
      console.error("[PP Vault] Error saving entry:", err);
      res.status(500).json({ error: "Failed to save entry" });
    }
  });

  app.delete("/api/prizepicks/vault/entries/:id", async (req, res) => {
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid entry ID" });
      await storage.deletePrizePicksEntry(id, userId);
      res.json({ success: true });
    } catch (err) {
      console.error("[PP Vault] Error deleting entry:", err);
      res.status(500).json({ error: "Failed to delete entry" });
    }
  });

  // World Cup projections: SOCCER feed filtered to national-team (FIFA) fixtures.
  // Same live→DB fallback as /api/prizepicks/:sport, then filtered to World Cup.
  // Registered BEFORE /api/prizepicks/:sport so the literal path wins.
  app.get("/api/prizepicks/worldcup", async (_req, res) => {
    if (!WORLD_CUP_ENABLED) return res.status(404).json({ error: "World Cup features are disabled" });
    try {
      const { projections: worldCup, soccerCount } = await getWorldCupProjections();
      const movements = getLineMovements("SOCCER");
      const lineMovements: Record<string, any> = {};
      for (const [id, m] of movements) {
        if (worldCup.some(p => p.id === id)) lineMovements[id] = m;
      }
      res.json({
        league: "FIFA World Cup",
        projections: worldCup,
        hasWorldCup: worldCup.length > 0,
        soccerCount,
        lineMovements,
      });
    } catch (err) {
      console.error("[PrizePicks WorldCup] Error:", err);
      res.json({ league: "FIFA World Cup", projections: [], hasWorldCup: false, soccerCount: 0, lineMovements: {} });
    }
  });

  app.get("/api/prizepicks/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const supported = getSupportedPPSports();
      if (!supported.includes(sport)) {
        return res.status(400).json({ error: `Invalid sport: ${sport}. Valid: ${supported.join(", ")}` });
      }
      let projections = await fetchPrizePicksProjections(sport);
      if (projections.length === 0) {
        const allSlates = await storage.getSlates();
        const activeSlates = allSlates.filter(s => s.sport === sport && s.platform === "draftkings" && s.isActive !== false);
        let dbPlayers: Player[] = [];
        for (const slate of activeSlates) {
          const slatePlayers = await storage.getPlayersBySlate(slate.id);
          dbPlayers.push(...slatePlayers);
        }
        const seen = new Set<string>();
        dbPlayers = dbPlayers.filter(p => {
          if (seen.has(p.name)) return false;
          seen.add(p.name);
          return true;
        });
        projections = generateProjectionsFromPlayers(dbPlayers, sport);
        if (projections.length > 0) {
          console.log(`[PrizePicks] Generated ${projections.length} projections from ${dbPlayers.length} DB players for ${sport}`);
        }
      }
      const movements = getLineMovements(sport);
      const lineMovements: Record<string, any> = {};
      for (const [id, m] of movements) {
        lineMovements[id] = m;
      }
      res.json({ sport, projections, lineMovements });
    } catch (err) {
      console.error(`[PrizePicks] Error in route for ${req.params.sport}:`, err);
      res.json({ sport: req.params.sport.toUpperCase(), projections: [], lineMovements: {} });
    }
  });

  app.get("/api/news/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const validSports = [...ACTIVE_SPORTS] as string[];
      if (!validSports.includes(sport)) {
        return res.status(400).json({ error: "Invalid sport" });
      }
      const url = ESPN_NEWS_URLS[sport];
      if (!url) {
        return res.status(400).json({ error: "Invalid sport" });
      }

      const cached = newsCache.get(sport);
      if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL_MS) {
        return res.json(cached.data);
      }

      const response = await fetch(`${url}?limit=25`, {
        headers: { "User-Agent": "EliteLineupAI/1.0" },
      });
      if (!response.ok) {
        if (cached) return res.json(cached.data);
        return res.status(502).json({ error: "Failed to fetch news" });
      }
      const data = await response.json();
      const espnArticles = Array.isArray(data.articles) ? data.articles : [];

      const articles = espnArticles.map((item: any, idx: number) => {
        const imageUrl = item.images?.[0]?.url || null;
        const description = item.description || "";
        const categories = (item.categories || [])
          .map((c: any) => c.description)
          .filter((c: any) => typeof c === "string" && c.length > 0)
          .slice(0, 3);

        return {
          id: item.links?.web?.href || `${sport}-${idx}`,
          headline: item.headline || "",
          description: description.length > 300 ? description.substring(0, 300) + "..." : description,
          published: item.published || "",
          type: item.type || "Article",
          imageUrl,
          linkUrl: item.links?.web?.href || null,
          categories,
        };
      });

      const result = { sport, articles };
      newsCache.set(sport, { data: result, fetchedAt: Date.now() });
      res.json(result);
    } catch (err) {
      console.error("News fetch error:", err);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  app.get("/api/news/golf/enhanced", async (req, res) => {
    try {
      const cached = newsCache.get("GOLF_ENHANCED");
      if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL_MS) {
        return res.json(cached.data);
      }

      const [newsRes, scoreboardRes] = await Promise.all([
        fetch(`${ESPN_NEWS_URLS.GOLF}?limit=25`, { headers: { "User-Agent": "EliteLineupAI/1.0" } }).catch(() => null),
        fetch("https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard", { headers: { "User-Agent": "EliteLineupAI/1.0" } }).catch(() => null),
      ]);

      const articles: any[] = [];
      if (newsRes?.ok) {
        const newsData = await newsRes.json();
        const espnArticles = Array.isArray(newsData.articles) ? newsData.articles : [];
        for (let idx = 0; idx < espnArticles.length; idx++) {
          const item = espnArticles[idx];
          articles.push({
            id: item.links?.web?.href || `GOLF-${idx}`,
            headline: item.headline || "",
            description: (item.description || "").substring(0, 300),
            published: item.published || "",
            type: item.type || "Article",
            imageUrl: item.images?.[0]?.url || null,
            linkUrl: item.links?.web?.href || null,
            categories: (item.categories || []).map((c: any) => c.description).filter((c: any) => typeof c === "string" && c.length > 0).slice(0, 3),
          });
        }
      }

      const tournaments: any[] = [];
      if (scoreboardRes?.ok) {
        const sbData = await scoreboardRes.json();
        const events = Array.isArray(sbData.events) ? sbData.events : [];
        for (const event of events) {
          const comp = event.competitions?.[0];
          const competitors = comp?.competitors || [];
          const status = event.status?.type?.name || "";
          const isLive = status === "STATUS_IN_PROGRESS";
          const isFinal = status === "STATUS_FINAL";
          const top10 = competitors.slice(0, 10);
          let currentPos = 1;
          const leaderboard = top10.map((c: any, i: number) => {
            if (i > 0 && c.score !== top10[i - 1].score) currentPos = i + 1;
            return {
              position: currentPos,
              playerName: c.athlete?.displayName || "Unknown",
              score: c.score || "E",
              rounds: (c.linescores || []).filter((l: any) => l.value != null).map((l: any) => l.value),
              country: c.athlete?.flag?.alt || "",
            };
          });

          tournaments.push({
            name: event.name || event.shortName || "Tournament",
            date: event.date || "",
            status: isLive ? "live" : isFinal ? "final" : "upcoming",
            fieldSize: competitors.length,
            leaderboard,
            purse: comp?.purse?.value ? `$${(comp.purse.value / 1000000).toFixed(1)}M` : null,
          });
        }
      }

      if (articles.length === 0 && tournaments.length === 0 && cached) {
        return res.json(cached.data);
      }

      const result = { sport: "GOLF", articles, tournaments };
      newsCache.set("GOLF_ENHANCED", { data: result, fetchedAt: Date.now() });
      res.json(result);
    } catch (err) {
      console.error("Enhanced golf news error:", err);
      const cached = newsCache.get("GOLF_ENHANCED");
      if (cached) return res.json(cached.data);
      res.status(500).json({ error: "Failed to fetch golf news" });
    }
  });

  app.get("/api/golf-analysis/:slateId", async (req, res) => {
    try {
      const slateId = Number(req.params.slateId);
      const slate = await storage.getSlate(slateId);
      if (!slate || slate.sport !== "GOLF") {
        return res.status(404).json({ message: "Golf slate not found" });
      }

      const players = await storage.getPlayersBySlate(slateId);
      if (players.length === 0) {
        return res.status(400).json({ message: "No players found" });
      }

      const rand = seededRandom(slateId * 73 + 42);
      const tournamentParts = sanitizeGameInfo(players[0]?.gameInfo || "Tournament").split(" - ");
      const tournamentName = tournamentParts[0] || "Tournament";
      const courseName = tournamentParts[1] || "";

      const weatherConditions = [
        { condition: "Sunny", temp: "72°F", wind: "8 mph SW", humidity: "45%", icon: "sun" },
        { condition: "Partly Cloudy", temp: "68°F", wind: "12 mph NW", humidity: "55%", icon: "cloud-sun" },
        { condition: "Overcast", temp: "65°F", wind: "15 mph N", humidity: "62%", icon: "cloud" },
        { condition: "Windy", temp: "70°F", wind: "22 mph SE", humidity: "40%", icon: "wind" },
        { condition: "Light Rain", temp: "63°F", wind: "10 mph E", humidity: "78%", icon: "cloud-rain" },
      ];
      const weatherIdx = Math.floor(rand() * weatherConditions.length);
      const weather = weatherConditions[weatherIdx];

      const rounds = [
        { round: "Round 1", day: "Thursday", time: "7:00 AM - 2:30 PM", conditions: weather.condition },
        { round: "Round 2", day: "Friday", time: "7:00 AM - 2:30 PM", conditions: weatherConditions[Math.floor(rand() * weatherConditions.length)].condition },
        { round: "Round 3", day: "Saturday", time: "8:00 AM - 3:00 PM", conditions: weatherConditions[Math.floor(rand() * weatherConditions.length)].condition },
        { round: "Round 4", day: "Sunday", time: "9:00 AM - 4:00 PM", conditions: weatherConditions[Math.floor(rand() * weatherConditions.length)].condition },
      ];

      const courseTraits = [
        "Bermuda greens", "Bentgrass fairways", "Par 72", "7,500 yards",
        "Elevation changes", "Water hazards on 6 holes", "Narrow fairways",
        "Fast greens (12+ Stimpmeter)", "Dog-leg holes", "Strategic bunkering",
      ];
      const selectedTraits: string[] = [];
      const traitsCopy = [...courseTraits];
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor(rand() * traitsCopy.length);
        selectedTraits.push(traitsCopy.splice(idx, 1)[0]);
      }

      const keyStats = [
        "Strokes Gained: Approach", "Strokes Gained: Off-the-Tee",
        "Strokes Gained: Putting", "Driving Accuracy", "Greens in Regulation",
        "Scrambling %", "Birdie Average", "Par 5 Scoring",
      ];
      const topStats: string[] = [];
      const statsCopy = [...keyStats];
      for (let i = 0; i < 3; i++) {
        const idx = Math.floor(rand() * statsCopy.length);
        topStats.push(statsCopy.splice(idx, 1)[0]);
      }

      const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));

      const playerAnalysis = sorted.map((p, idx) => {
        const r = rand;
        const courseFit = Math.min(99, Math.max(45, Math.round(85 - idx * 1.2 + (r() * 20 - 10))));
        const historicalRank = Math.min(players.length, Math.max(1, Math.round(idx + 1 + (r() * 8 - 4))));
        const recentForm = Math.min(99, Math.max(40, Math.round(80 - idx * 1.0 + (r() * 24 - 12))));
        const weatherAdj = Math.round((r() * 4 - 2) * 10) / 10;

        const ownershipProj = Math.max(1, Math.round(
          idx < 3 ? 25 - idx * 5 + (r() * 8 - 4) :
          idx < 10 ? 14 - idx * 0.8 + (r() * 6 - 3) :
          Math.max(1, 8 - idx * 0.3 + (r() * 4 - 2))
        ));

        const algoScore = Math.round(
          (Number(p.projectedPoints) * 0.35) +
          (courseFit * 0.25) +
          (recentForm * 0.20) +
          ((100 - ownershipProj) * 0.10) +
          (weatherAdj * 2) +
          (r() * 5 - 2.5)
        );

        const sgApproach = Math.round((r() * 3 - 0.5) * 100) / 100;
        const sgPutting = Math.round((r() * 2.5 - 0.3) * 100) / 100;
        const sgOffTee = Math.round((r() * 2.8 - 0.4) * 100) / 100;

        return {
          playerId: p.id,
          name: p.name,
          team: p.team,
          salary: p.salary,
          projectedPoints: Number(p.projectedPoints),
          courseFitScore: courseFit,
          historicalRank,
          recentFormScore: recentForm,
          weatherAdjustment: weatherAdj,
          ownershipProjection: ownershipProj,
          algoScore,
          sgApproach,
          sgPutting,
          sgOffTee,
        };
      });

      playerAnalysis.sort((a, b) => b.algoScore - a.algoScore);

      const topAlgoPicks = playerAnalysis.slice(0, 6);
      const valuePlays = [...playerAnalysis]
        .sort((a, b) => (b.algoScore / (b.salary / 1000)) - (a.algoScore / (a.salary / 1000)))
        .slice(0, 5);
      const contrarian = [...playerAnalysis]
        .filter(p => p.ownershipProjection <= 8 && p.courseFitScore >= 65)
        .sort((a, b) => b.algoScore - a.algoScore)
        .slice(0, 4);

      res.json({
        tournament: { name: tournamentName, course: courseName, fieldSize: players.length },
        weather,
        rounds,
        courseProfile: { traits: selectedTraits, keyStats: topStats },
        topAlgoPicks,
        valuePlays,
        contrarianPicks: contrarian,
        playerAnalysis,
      });
    } catch (err) {
      console.error("Golf analysis error:", err);
      res.status(500).json({ error: "Failed to generate golf analysis" });
    }
  });

  app.post("/api/optimize/pro", async (req, res) => {
    const proSolveDeadline = Date.now() + 26_000;
    try {
      if (!isLoggedIn(req)) return res.sendStatus(401);
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro" && tier !== "star") {
        return res.status(403).json({ message: "Star or Pro subscription required for advanced optimizer.", requiresUpgrade: true });
      }

      const maxLineupCount = isAdmin ? 150 : tier === "pro" ? 150 : tier === "star" ? 20 : 3;

      const constraints = proOptimizationConstraintSchema.parse(req.body);
      constraints.lineupCount = Math.min(constraints.lineupCount, maxLineupCount);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;
      validateNflPortfolioContext(constraints.nflPortfolio, slate, platform, constraints.contestType);
      let allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      if (slate.platform === "draftkings") {
        allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
      }

      const proUserOverrides = resolveConfigurationOverrides(await storage.getPlayerOverrides(userId, constraints.slateId), allPlayers);
      if (configurationExpiry(slate, allPlayers).isExpired) return res.status(409).json({ message: "This slate has expired." });
      constraints.playerProjections = {
        ...constraints.playerProjections,
        ...Object.fromEntries(proUserOverrides.filter(o => o.customProjection != null).map(o => [o.playerId, Number(o.customProjection)])),
      };
      const proOverrideMap = new Map(proUserOverrides.map(o => [o.playerId, o]));
      const proOverrideExcluded = proUserOverrides.filter(o => o.isExcluded).map(o => o.playerId);
      const proOverrideLocked = proUserOverrides.filter(o => o.isLocked).map(o => o.playerId);
      constraints.lockedPlayerIds = [...new Set([...constraints.lockedPlayerIds, ...proOverrideLocked])];
      constraints.excludedPlayerIds = [...new Set([...constraints.excludedPlayerIds, ...proOverrideExcluded])];

      const proMinProjectionInput = applyExplicitProjections(
        allPlayers,
        constraints.playerProjections,
      );
      const proMinProjectionViolation = findLockedMinProjectionViolation(
        proMinProjectionInput,
        constraints.minProjection,
        constraints.lockedPlayerIds,
      );
      if (proMinProjectionViolation) {
        return res.status(400).json({
          message: minProjectionLockMessage(proMinProjectionViolation),
        });
      }
      const proMinProjectionEligibleIds = constraints.minProjection !== undefined && constraints.minProjection > 0
        ? new Set(filterByMinProjection(proMinProjectionInput, constraints.minProjection).map(p => p.id))
        : undefined;

      for (const o of proUserOverrides) {
        const pid = o.playerId.toString();
        if (o.maxExposure != null) {
          if (!constraints.exposureLimits) constraints.exposureLimits = {};
          constraints.exposureLimits[pid] = Math.min(constraints.exposureLimits[pid] ?? 100, o.maxExposure);
        }
        if (o.minExposure != null) {
          if (!constraints.minExposureLimits) constraints.minExposureLimits = {};
          constraints.minExposureLimits[pid] = Math.max(constraints.minExposureLimits[pid] ?? 0, o.minExposure);
        }
      }

      const proScoutMap = buildScoutMap(slate.sport);

      let pool = allPlayers.map(p => {
        const override = proOverrideMap.get(p.id);
        const customProj = constraints.playerProjections?.[p.id.toString()]
          ?? (override?.customProjection != null ? Number(override.customProjection) : undefined);
        let boostedPoints = customProj !== undefined ? customProj : Number(p.projectedPoints);

        if (override?.boostPercent && override.boostPercent > 0) {
          boostedPoints = Math.round(boostedPoints * (1 + override.boostPercent / 100) * 10) / 10;
        }

        if (p.isConfirmedStarter) {
          boostedPoints = Math.round(boostedPoints * 1.05 * 10) / 10;
        }

        if (constraints.useBoosts && p.boostScore) {
          const boostPct = Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008));
          boostedPoints = Math.round(boostedPoints * (1 + boostPct) * 10) / 10;
        }
        boostedPoints = applyScoutToProjection(boostedPoints, p.name, proScoutMap, customProj !== undefined);

        if (isPlayerOut(p.injuryStatus)) {
          boostedPoints = 0;
        } else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") {
          boostedPoints *= 0.75;
        } else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") {
          boostedPoints *= 0.9;
        }

        return { ...p, projectedPoints: boostedPoints.toString() };
      });

      pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyMarketProjectionBlend(pool, slate.sport);
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

      if (constraints.outperformerMode) {
        pool = await applyOutperformerMode(pool, slate.sport);
        console.log(`[ProOptimizer] Applied outperformer mode for ${slate.sport}`);
      }
      pool = pool.map(p => protectGolfMissedCutMarker(p, slate.draftGroupId));

      const historicalProfile = await getHistoricalProfile(slate.sport);
      if (historicalProfile.ready) {
        pool = applyHistoricalAdjustments(pool, historicalProfile);
        console.log(`[ProOptimizer] Applied historical adjustments from ${historicalProfile.slatesAnalyzed} analyzed slates for ${slate.sport}`);
      }

      if (constraints.projectionMode === "ceiling") {
        pool = applyCeilingMode(pool, slate.sport);
      }

      if (constraints.minStarRating > 0) {
        const minProj = starRatingMinProjection(constraints.minStarRating);
        const lockedSet = new Set(constraints.lockedPlayerIds);
        const beforeCount = pool.length;
        pool = pool.filter(p => lockedSet.has(p.id) || Number(p.projectedPoints) >= minProj);
        console.log(`[ProOptimizer] Star filter ${constraints.minStarRating}★ (≥${minProj}pts) removed ${beforeCount - pool.length} players`);
      }

      pool = pool.map(p => protectGolfMissedCutMarker(p, slate.draftGroupId));

      console.log(`[ProOptimizer] Starting for ${slate.sport}, ${allPlayers.length} players (${allPlayers.filter(p => isPlayerOut(p.injuryStatus) || p.injuryStatus === "Questionable" || p.injuryStatus === "GTD").length} OUT/Q excluded), ${constraints.lineupCount} lineups requested`);
      const proStartTime = Date.now();

      const bdlStats = await fetchBDLStats(slate.sport);
      console.log(`[ProOptimizer] BDL fetch completed in ${Date.now() - proStartTime}ms`);
      const proOwnershipResults = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStats);
      const playersWithOwnership = computeOwnershipForPlayers(pool, proOwnershipResults);

      if (constraints.leverageMode) {
        pool = applyLeverageMode(playersWithOwnership);
      }

      const lineupResults: any[] = [];
      const usedLineupKeys = new Set<string>();

      const baseExcluded = [...constraints.excludedPlayerIds];
      allPlayers.forEach(p => {
        if (isPlayerOut(p.injuryStatus) && !baseExcluded.includes(p.id)) {
          baseExcluded.push(p.id);
        }
      });
      const isDKPro = slate.platform === "draftkings";
      const { inactiveIds: proInactiveExcluded } = isDKPro ? await getInactivePlayerIds(allPlayers, slate.sport) : { inactiveIds: [] };
      const filteredProInactive = proInactiveExcluded.filter(id => !constraints.lockedPlayerIds.includes(id) && !baseExcluded.includes(id));
      baseExcluded.push(...filteredProInactive);

      if (constraints.playerMinSalary || constraints.playerMaxSalary) {
        const lockedSet = new Set(constraints.lockedPlayerIds);
        pool = pool.filter(p => {
          if (lockedSet.has(p.id)) return true;
          if (constraints.playerMinSalary && p.salary < constraints.playerMinSalary) return false;
          if (constraints.playerMaxSalary && p.salary > constraints.playerMaxSalary) return false;
          return true;
        });
      }

      // Eligibility comes from raw projections plus explicit request
      // projections; apply the resulting IDs after Pro's score adjustments.
      if (proMinProjectionEligibleIds) {
        pool = pool.filter(p => proMinProjectionEligibleIds.has(p.id));
      }
      const proRequiredPositionMessage = minProjectionRequiredPositionMessage(
        pool.filter(p => !baseExcluded.includes(p.id)),
        constraints.minProjection,
        getPlatformConfig(slate.sport, platform).positionConstraints,
      );
      if (proRequiredPositionMessage) {
        return res.status(400).json({ message: proRequiredPositionMessage });
      }

      const MAX_POOL_SIZE = 150;
      const excludedSet = new Set(baseExcluded);
      const eligiblePool = pool.filter(p => !excludedSet.has(p.id));
      if (eligiblePool.length > MAX_POOL_SIZE) {
        const lockedSet = new Set(constraints.lockedPlayerIds);
        const locked = eligiblePool.filter(p => lockedSet.has(p.id));
        const unlocked = eligiblePool.filter(p => !lockedSet.has(p.id));
        unlocked.sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
        const trimmed = [...locked, ...unlocked.slice(0, MAX_POOL_SIZE - locked.length)];
        console.log(`[ProOptimizer] Trimmed eligible pool from ${eligiblePool.length} to ${trimmed.length} players`);
        pool = [...trimmed, ...pool.filter(p => excludedSet.has(p.id))];
      }

      const maxAttempts = constraints.lineupCount * 10;
      validateExposureBounds(constraints);
      let nflPortfolioReport: NflPortfolioReport | undefined;
      if (constraints.nflPortfolio?.enabled) {
        const ownershipMap = await portfolioOwnership(pool, constraints.nflPortfolio);
        const portfolio = await generateNflPortfolio({
          pool, settings: constraints.nflPortfolio, count: constraints.lineupCount,
          baseConstraints: { ...constraints, minProjection: undefined, excludedPlayerIds: baseExcluded },
          ownershipMap, deadline: proSolveDeadline,
          solve: (candidatePool, candidateConstraints) => solveLineup(candidatePool, candidateConstraints, slate.sport, platform, candidateConstraints.ownershipMap ?? ownershipMap, { deadline: proSolveDeadline, timeoutMs: 2000 }),
        });
        lineupResults.push(...portfolio.lineups);
        nflPortfolioReport = portfolio.report;
      }
      let attempts = 0;
      let proTimedOut = false;

      const playerAppearances: Record<number, number> = {};
      const candidateLineups: { result: any; correlationScore: number }[] = [];

      const proCandidateTarget = constraints.globalMaxExposure !== undefined || constraints.globalMinExposure !== undefined || constraints.exposureLimits || constraints.minExposureLimits
        ? constraints.lineupCount * 3 : constraints.lineupCount;
      while (!constraints.nflPortfolio?.enabled && lineupResults.length < proCandidateTarget && attempts < maxAttempts) {
        if (Date.now() >= proSolveDeadline) {
          proTimedOut = true;
          console.log(`[ProOptimizer] Timeout after ${attempts} attempts, ${lineupResults.length} lineups found`);
          break;
        }
        attempts++;
        const iteration = lineupResults.length;
        const noiseScale = iteration === 0 ? 0 : Math.min(0.10 + iteration * 0.04, 0.40);

        const perturbedPool = pool.map(p => {
          if (baseExcluded.includes(p.id)) return p;
          const base = Number(p.projectedPoints);
          const noise = iteration === 0 ? 0 : (Math.random() - 0.5) * base * noiseScale;
          return { ...p, projectedPoints: Math.max(0, base + noise).toString() };
        });

        const iterationExcluded = [...baseExcluded];

        if (lineupResults.length > 0) {
          for (const p of pool) {
            if (constraints.lockedPlayerIds.includes(p.id)) continue;
            if (iterationExcluded.includes(p.id)) continue;
            const appearances = playerAppearances[p.id] || 0;
            const currentExposure = (appearances / constraints.lineupCount) * 100;
            const playerLimit = constraints.exposureLimits?.[p.id.toString()];
            const effectiveLimit = Math.min(playerLimit ?? 100, constraints.globalMaxExposure ?? 100);
            if (effectiveLimit !== undefined && currentExposure >= effectiveLimit) {
              iterationExcluded.push(p.id);
            }
          }
        }

        const minExposureLocks: number[] = [];
        if (lineupResults.length > 0) {
          for (const p of pool) {
            if (iterationExcluded.includes(p.id)) continue;
            if (constraints.lockedPlayerIds.includes(p.id)) continue;
            const playerMinLimit = constraints.minExposureLimits?.[p.id.toString()];
            const appearances = playerAppearances[p.id] || 0;
            const effectiveMin = playerMinLimit ?? (constraints.globalMinExposure !== undefined && appearances > 0 ? constraints.globalMinExposure : undefined);
            if (effectiveMin === undefined || effectiveMin <= 0) continue;
            const remaining = constraints.lineupCount - lineupResults.length;
            const neededAppearances = Math.ceil((effectiveMin / 100) * constraints.lineupCount);
            if (appearances < neededAppearances && (appearances + remaining) <= neededAppearances) {
              minExposureLocks.push(p.id);
            }
          }
        }

        if (iteration > 0 && lineupResults.length > 0) {
          const prevLineup = lineupResults[lineupResults.length - 1];
          const prevPlayers = (prevLineup.lineup || []) as Player[];
          const nonLockedPrev = prevPlayers.filter(
            p => !constraints.lockedPlayerIds.includes(p.id)
          );
          if (nonLockedPrev.length > 0) {
            const excludeCount = Math.min(
              1 + Math.floor(iteration / 3),
              Math.ceil(nonLockedPrev.length / 3)
            );
            const shuffled = nonLockedPrev.sort(() => Math.random() - 0.5);
            for (let e = 0; e < excludeCount; e++) {
              if (!iterationExcluded.includes(shuffled[e].id)) {
                iterationExcluded.push(shuffled[e].id);
              }
            }
          }
        }

        const combinedLocks = [...new Set([...constraints.lockedPlayerIds, ...minExposureLocks])];
        // minProjection was applied to the deterministic pool above. Do not
        // re-apply it to this iteration's random perturbation.
        const modConstraints = {
          ...constraints,
          minProjection: undefined,
          excludedPlayerIds: iterationExcluded,
          lockedPlayerIds: combinedLocks,
        };
        await yieldToEventLoop();
        const solveStart = Date.now();
        const result = solveLineup(
          perturbedPool,
          modConstraints,
          slate.sport,
          platform,
          undefined,
          { deadline: proSolveDeadline, timeoutMs: 2_000 },
        );
        console.log(`[ProOptimizer] Solve attempt ${attempts} took ${Date.now() - solveStart}ms, feasible: ${!result.error}`);
        if (result.timedOut) proTimedOut = true;

        if (!result.error && result.lineup.length > 0) {
          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          if (!usedLineupKeys.has(key)) {
            const correlationScore = computeCorrelationBonus(result.lineup as Player[], slate.sport);
            lineupResults.push({ ...result, platform, correlationScore });
            usedLineupKeys.add(key);
            for (const p of result.lineup as Player[]) {
              playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
            }
          }
        }
        if (Date.now() >= proSolveDeadline) {
          proTimedOut = true;
          break;
        }
      }

      lineupResults.sort((a, b) => {
        const ptsDiff = b.totalProjectedPoints - a.totalProjectedPoints;
        if (ptsDiff !== 0) return ptsDiff;
        return (b.correlationScore || 0) - (a.correlationScore || 0);
      });

      const finalProLineups = selectExposureLineups(lineupResults, c => c.lineup.map((p: Player) => p.id), constraints, {
        count: constraints.lineupCount, deadline: proSolveDeadline + 2000, preservePortfolio: !!nflPortfolioReport,
      });
      lineupResults.splice(0, lineupResults.length, ...finalProLineups);

      const boostsSummary = allPlayers
        .filter(p => p.boostScore && Number(p.boostScore) !== 0)
        .map(p => ({
          playerId: p.id,
          playerName: p.name,
          boostScore: Number(p.boostScore),
          boostReason: p.boostReason || "",
        }))
        .sort((a, b) => b.boostScore - a.boostScore)
        .slice(0, 15);

      const injurySummary = allPlayers
        .filter(p => p.injuryStatus && p.injuryStatus !== "Healthy")
        .map(p => ({
          playerId: p.id,
          playerName: p.name,
          status: p.injuryStatus || "",
          detail: p.injuryDetail || "",
        }));

      const partialResults = lineupResults.length < constraints.lineupCount || proTimedOut || Date.now() >= proSolveDeadline;
      const message = lineupResults.length === 0
        ? constraints.projectedPointsFloor
          ? `No lineups could reach the ${constraints.projectedPointsFloor}-point floor. Try lowering it or relaxing other constraints.`
          : proTimedOut || Date.now() >= proSolveDeadline
            ? "Solver time budget reached before a validated lineup was generated."
            : "Could not generate any feasible lineups with the current constraints."
        : partialResults
          ? `Partial results: generated ${lineupResults.length} of ${constraints.lineupCount} requested lineups within the candidate/search budget and hard exposure limits. All percentages use the returned batch size.`
          : undefined;

      res.json({ lineups: lineupResults, boostsSummary, injurySummary, message, partial: partialResults || !!nflPortfolioReport?.partial, ...(nflPortfolioReport ? { nflPortfolioReport } : {}) });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        console.error("Pro optimizer error:", err);
        res.status(500).json({ message: "Pro optimizer failed" });
      }
    }
  });

  const simOptimizeSchema = z.object({
    nflPortfolio: nflPortfolioSettingsSchema.optional(),
    contestType: z.enum(["cash", "gpp"]).default("cash"),
    slateId:              z.number(),
    platform:             z.enum(["draftkings", "fanduel", "yahoo"]).default("draftkings"),
    lockedPlayerIds:      z.array(z.number()).default([]),
    excludedPlayerIds:    z.array(z.number()).default([]),
    flexAllowedPositions: z.array(z.enum(["RB", "WR", "TE"])).min(1).optional(),
    playerProjections:    z.record(z.string(), z.number()).optional(),
    minProjection:        z.number().finite().min(0).optional(),
    playerMinSalary:      z.number().optional(),
    playerMaxSalary:      z.number().optional(),
    lineupCount:          z.number().min(1).max(2000).default(20),
    numSims:              z.number().min(50).max(1000).default(200),
    globalMaxExposure:    z.number().finite().min(0).max(100).optional(),
    globalMinExposure:    z.number().finite().min(0).max(100).optional(),
    minExposureLimits:    z.record(z.string(), z.number().finite().min(0).max(100)).optional(),
    exposureLimits:       z.record(z.string(), z.number().finite().min(0).max(100)).optional(),
    enforceGameStack:     z.boolean().default(false),
    minStackSize:         z.number().min(2).max(5).default(2),
    stackGameKey:         z.string().optional(),
    stackGameKeys:        z.array(z.string().regex(/^[A-Z0-9]+-[A-Z0-9]+$/)).max(32).optional(),
    favoriteStackIds:     z.array(z.number().int().positive()).max(64).default([]),
    minStarRating:        z.number().min(0).max(5).default(0),
    sortMetric:           z.enum(["composite", "p90", "p75", "median", "avg", "ev"]).default("composite"),
    useBoosts:            z.boolean().default(true),
    ceilingMode:          z.boolean().default(false),
    leverageMode:         z.boolean().default(false),
    outperformerMode:     z.boolean().default(false),
  });

  app.post("/api/optimize/sim", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);

    const startTime = Date.now();
    const MAX_RUNTIME_MS = 30_000;
    // Leave time for candidate scoring and serialization. A synchronous MIP
    // solve cannot be cancelled from outside the solver, so every attempt
    // also receives the remaining absolute deadline below.
    const RESPONSE_RESERVE_MS = 4_000;
    const solverDeadline = startTime + MAX_RUNTIME_MS - RESPONSE_RESERVE_MS;
    let simTimedOut = false;

    try {
      const userId = getSessionUserId(req)!;
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro" && tier !== "star") {
        return res.status(403).json({ message: "Sharpshooter or Champion subscription required for simulation mode.", requiresUpgrade: true });
      }

      const input = simOptimizeSchema.parse(req.body);
      const maxLineupCount = isAdmin ? 2000 : tier === "pro" ? 1000 : 400;
      input.lineupCount = Math.min(input.lineupCount, maxLineupCount);
      const maxSims = isAdmin ? 750 : tier === "pro" ? 500 : 200;
      input.numSims = Math.min(input.numSims, maxSims);

      const slate = await storage.getSlate(input.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });
      if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });

      if (input.favoriteStackIds.length > 0 && !isClassicSlate(slate)) {
        return res.status(400).json({ message: "Favorite stacks are available only for classic slates." });
      }

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const sport = slate.sport;
      const platform = (input.platform || slate.platform || "draftkings") as Platform;
      validateNflPortfolioContext(input.nflPortfolio, slate, platform, input.contestType);
      const config = getPlatformConfig(sport, platform);

      let allPlayers = await storage.getPlayersBySlate(input.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      let selectedFavoriteStacks: FavoriteStack[] = [];
      if (input.favoriteStackIds.length > 0) {
        if (new Set(input.favoriteStackIds).size !== input.favoriteStackIds.length) {
          return res.status(400).json({ message: "favoriteStackIds cannot contain duplicates." });
        }
        const favoriteStacks = await storage.getFavoriteStacks(userId, input.slateId);
        const favoriteById = new Map(favoriteStacks.map(stack => [stack.id, stack]));
        selectedFavoriteStacks = input.favoriteStackIds.map(id => favoriteById.get(id)).filter(Boolean) as FavoriteStack[];
        if (selectedFavoriteStacks.length !== input.favoriteStackIds.length) {
          return res.status(400).json({ message: "One or more selected favorite stacks are not saved for this slate. Refresh your favorites and try again." });
        }

        const currentPlayerIds = new Set(allPlayers.map(player => player.id));
        const currentGameKeys = new Set(allPlayers.map(player => getStackGameKey(player.gameInfo)).filter(Boolean));
        for (const favorite of selectedFavoriteStacks) {
          if (favorite.kind === "game") {
            const gameKey = normalizeStackGameKey(favorite.gameKey);
            if (!gameKey || !currentGameKeys.has(gameKey)) {
              return res.status(400).json({ message: `Favorite stack "${favorite.name}" no longer matches a game in this slate. Refresh your favorites.` });
            }
          } else {
            const stalePlayer = (favorite.playerIds || []).find(playerId => !currentPlayerIds.has(playerId));
            if (stalePlayer !== undefined) {
              return res.status(400).json({ message: `Favorite stack "${favorite.name}" contains a stale player for this slate. Re-save the stack from the current player pool.` });
            }
            const favoritePlayers = (favorite.playerIds || []).map(playerId => allPlayers.find(player => player.id === playerId)!);
            const favoriteGames = new Set(favoritePlayers.map(player => getStackGameKey(player.gameInfo)));
            const favoriteGameKey = favoriteGames.values().next().value as string | undefined;
            if (favoritePlayers.length < 2 ||
                favoritePlayers.length > 5 ||
                new Set(favorite.playerIds || []).size !== favoritePlayers.length ||
                favoriteGames.size !== 1 ||
                favoriteGames.has("") ||
                (favorite.gameKey != null && normalizeStackGameKey(favorite.gameKey) !== favoriteGameKey)) {
              return res.status(400).json({ message: `Favorite stack "${favorite.name}" no longer contains a valid one-game player group. Re-save the stack from the current player pool.` });
            }
          }
        }
      }
      const lockedGolfMissedCut = allPlayers.find(p =>
        input.lockedPlayerIds.includes(p.id) &&
        isGolfMissedCutMarkerForDraftGroup(p, slate.draftGroupId),
      );
      if (lockedGolfMissedCut) {
        return res.status(400).json({
          message: `Locked player ${lockedGolfMissedCut.name} has missed the golf cut and cannot be used.`,
        });
      }

      if (slate.platform === "draftkings") {
        allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
      }

      const proScoutMap = buildScoutMap(slate.sport);
      const applyBoosts = input.useBoosts !== false;
      const useCeilingMode = input.ceilingMode === true;
      const useLeverageMode = input.leverageMode === true;
      const useOutperformerMode = input.outperformerMode === true;

      const simUserOverrides = resolveConfigurationOverrides(await storage.getPlayerOverrides(userId, input.slateId), allPlayers);
      if (configurationExpiry(slate, allPlayers).isExpired) return res.status(409).json({ message: "This slate has expired." });
      input.playerProjections = {
        ...input.playerProjections,
        ...Object.fromEntries(simUserOverrides.filter(o => o.customProjection != null).map(o => [o.playerId, Number(o.customProjection) * (1 + (o.boostPercent || 0) / 100)])),
      };
      const simUserOverrideMap = new Map(simUserOverrides.map(o => [o.playerId, o]));
      const simOverrideExposure: Record<string, { min?: number; max?: number }> = {};
      for (const o of simUserOverrides) {
        if (o.isExcluded) input.excludedPlayerIds.push(o.playerId);
        if (o.isLocked && !input.lockedPlayerIds.includes(o.playerId)) input.lockedPlayerIds.push(o.playerId);
        if (o.minExposure != null || o.maxExposure != null) {
          simOverrideExposure[o.playerId.toString()] = { min: o.minExposure ?? undefined, max: o.maxExposure ?? undefined };
        }
      }

      validateExposureBounds({
        globalMaxExposure: input.globalMaxExposure, globalMinExposure: input.globalMinExposure,
        lockedPlayerIds: input.lockedPlayerIds,
        exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), input.exposureLimits),
        minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), input.minExposureLimits),
      });
      const simMinProjectionInput = applyExplicitProjections(
        allPlayers,
        input.playerProjections,
      );
      const simMinProjectionViolation = findLockedMinProjectionViolation(
        simMinProjectionInput,
        input.minProjection,
        input.lockedPlayerIds,
      );
      if (simMinProjectionViolation) {
        return res.status(400).json({
          message: minProjectionLockMessage(simMinProjectionViolation),
        });
      }
      const simMinProjectionEligibleIds = input.minProjection !== undefined && input.minProjection > 0
        ? new Set(filterByMinProjection(simMinProjectionInput, input.minProjection).map(p => p.id))
        : undefined;

      let pool = allPlayers.map(p => {
        const override = simUserOverrideMap.get(p.id);
        let boostedPoints = override?.customProjection != null ? Number(override.customProjection) : Number(p.projectedPoints);

        if (override?.boostPercent && override.boostPercent > 0) {
          boostedPoints = Math.round(boostedPoints * (1 + override.boostPercent / 100) * 10) / 10;
        }
        if (p.isConfirmedStarter) {
          boostedPoints = Math.round(boostedPoints * 1.05 * 10) / 10;
        }
        if (applyBoosts && p.boostScore) {
          const boostPct = Math.max(-0.08, Math.min(0.08, Number(p.boostScore) * 0.008));
          boostedPoints = Math.round(boostedPoints * (1 + boostPct) * 10) / 10;
        }
        boostedPoints = applyScoutToProjection(boostedPoints, p.name, proScoutMap, override?.customProjection != null);

        if (isPlayerOut(p.injuryStatus)) {
          boostedPoints = 0;
        } else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") {
          boostedPoints *= 0.75;
        } else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") {
          boostedPoints *= 0.9;
        }

        return { ...p, projectedPoints: boostedPoints.toString() };
      });

      pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyMarketProjectionBlend(pool, slate.sport);
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

      if (useOutperformerMode) {
        try {
          pool = await applyOutperformerMode(pool, slate.sport);
        } catch (opErr: any) {
          console.warn(`[SimOptimizer] Outperformer mode failed, skipping: ${opErr.message}`);
        }
      }
      pool = pool.map(p => protectGolfMissedCutMarker(p, slate.draftGroupId));

      const simProfile = await getHistoricalProfile(slate.sport);
      if (simProfile.ready) {
        pool = applyHistoricalAdjustments(pool, simProfile);
      }

      if (useCeilingMode) {
        try {
          pool = applyCeilingMode(pool, slate.sport);
        } catch (ceilErr: any) {
          console.warn(`[SimOptimizer] Ceiling mode failed, skipping: ${ceilErr.message}`);
        }
      }

      if (useLeverageMode) {
        try {
          const bdlStats = await fetchBDLStats(slate.sport);
          const ownershipResults = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStats);
          const playersWithOwnership = computeOwnershipForPlayers(pool, ownershipResults);
          pool = applyLeverageMode(playersWithOwnership);
        } catch (levErr: any) {
          console.warn(`[SimOptimizer] Leverage mode failed, skipping: ${levErr.message}`);
        }
      }

      pool = pool.map(p => protectGolfMissedCutMarker(p, slate.draftGroupId));
      pool = pool.filter(p => !input.excludedPlayerIds.includes(p.id));
      pool = pool.filter(p => !isPlayerOut(p.injuryStatus));

      const isDKSim = slate.platform === "draftkings";
      if (isDKSim) {
        const { inactiveIds: simInactiveIds } = await getInactivePlayerIds(allPlayers, sport);
        const lockedSet = new Set(input.lockedPlayerIds);
        pool = pool.filter(p => lockedSet.has(p.id) || !simInactiveIds.includes(p.id));
      }

      if (input.playerMinSalary) {
        pool = pool.filter(p => isDefense(p.position) || p.salary >= input.playerMinSalary!);
      }
      if (input.playerMaxSalary) pool = pool.filter(p => p.salary <= input.playerMaxSalary!);

      if (input.minStarRating > 0) {
        const minProj = starRatingMinProjection(input.minStarRating);
        const lockedSet = new Set(input.lockedPlayerIds);
        const beforeCount = pool.length;
        pool = pool.filter(p => lockedSet.has(p.id) || Number(p.projectedPoints) >= minProj);
        console.log(`[SimOptimizer] Star filter ${input.minStarRating}★ (≥${minProj}pts) removed ${beforeCount - pool.length} players`);
      }

      const projOverrides: Record<number, number> = {};
      if (input.playerProjections) {
        for (const [pid, v] of Object.entries(input.playerProjections)) {
          const saved = simUserOverrideMap.get(Number(pid));
          projOverrides[Number(pid)] = saved?.customProjection == null
            ? v * (1 + (saved?.boostPercent || 0) / 100) : v;
        }
      }
      for (const p of pool) {
        if (projOverrides[p.id] === undefined) {
          projOverrides[p.id] = Number(p.projectedPoints) ?? 0;
        }
      }
      // Eligibility comes from raw projections plus explicit request
      // projections; apply those IDs after all deterministic Sim adjustments.
      if (simMinProjectionEligibleIds) {
        pool = pool.filter(p => simMinProjectionEligibleIds.has(p.id));
      }
      const simRequiredPositionMessage = minProjectionRequiredPositionMessage(
        pool,
        input.minProjection,
        config.positionConstraints,
      );
      if (simRequiredPositionMessage) {
        return res.status(400).json({ message: simRequiredPositionMessage });
      }

      const requestedGameKeyInputs = Array.from(new Set(input.stackGameKeys ??
        (input.stackGameKey ? [input.stackGameKey.trim().toUpperCase()] : [])));
      const normalizedRequestedGameKeys = requestedGameKeyInputs.map(key => normalizeStackGameKey(key));
      if (normalizedRequestedGameKeys.some(key => !key)) {
        return res.status(400).json({ message: "Selected stack games must use a canonical TEAM-TEAM game key." });
      }
      const requestedGameKeys = normalizedRequestedGameKeys.filter((key): key is string => Boolean(key));
      const slateGames = new Set(allPlayers.map(p => getStackGameKey(p.gameInfo)));
      if (requestedGameKeys.some(key => !slateGames.has(key))) {
        return res.status(400).json({ message: "A selected stack game is not in this slate. Clear your game selections and try again." });
      }
      const stackAlternatives: SimStackAlternative[] = [];
      const seenGameAlternatives = new Set<string>();
      const seenPlayerAlternatives = new Set<string>();
      for (const gameKey of requestedGameKeys) {
        if (seenGameAlternatives.has(gameKey)) continue;
        seenGameAlternatives.add(gameKey);
        stackAlternatives.push({ kind: "game", gameKey });
      }
      for (const favorite of selectedFavoriteStacks) {
        if (favorite.kind === "game") {
          const gameKey = normalizeStackGameKey(favorite.gameKey)!;
          if (seenGameAlternatives.has(gameKey)) continue;
          seenGameAlternatives.add(gameKey);
          stackAlternatives.push({
            kind: "game",
            gameKey,
            id: favorite.id,
            name: favorite.name,
          });
        } else {
          const playerIds = Array.from(favorite.playerIds || []).sort((a, b) => a - b);
          const playerKey = playerIds.join(",");
          if (seenPlayerAlternatives.has(playerKey)) continue;
          seenPlayerAlternatives.add(playerKey);
          stackAlternatives.push({
            kind: "players",
            gameKey: favorite.gameKey || undefined,
            playerIds,
            id: favorite.id,
            name: favorite.name,
          });
        }
      }
      const stackGameKeys = stackAlternatives
        .filter((alternative): alternative is SimStackAlternative & { kind: "game"; gameKey: string } =>
          alternative.kind === "game" && Boolean(alternative.gameKey),
        )
        .map(alternative => alternative.gameKey);

      const simPosGroups = new Map<string, Player[]>();
      for (const p of pool) {
        for (const pos of p.position.split("/")) {
          const g = simPosGroups.get(pos) || [];
          g.push(p);
          simPosGroups.set(pos, g);
        }
      }
      const simKeepIds = new Set<number>();
      for (const pid of input.lockedPlayerIds) simKeepIds.add(pid);
      for (const [id, pct] of Object.entries(mergeExposureMinimums(
        Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])),
        input.minExposureLimits,
      ))) if (pct > 0) simKeepIds.add(Number(id));
      // Keep every player that can satisfy a selected alternative in the
      // reduced LP pool.  Excluded/inactive players are not reintroduced;
      // their exact-player selector remains infeasible instead of receiving a
      // silent substitute.
      for (const alternative of stackAlternatives) {
        if (alternative.kind === "players") {
          for (const pid of alternative.playerIds || []) {
            if (pool.some(player => player.id === pid)) simKeepIds.add(pid);
          }
        } else {
          for (const player of pool) {
            if (getStackGameKey(player.gameInfo) === alternative.gameKey) simKeepIds.add(player.id);
          }
        }
      }
      const simTopPerPos = sport === "GOLF" ? 50 : 20;
      const simCheapReserve = 5;
      for (const [, players] of simPosGroups) {
        players.sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
        for (let i = 0; i < Math.min(players.length, simTopPerPos); i++) simKeepIds.add(players[i].id);
        const bySalary = [...players].sort((a, b) => a.salary - b.salary);
        for (let i = 0; i < Math.min(bySalary.length, simCheapReserve); i++) simKeepIds.add(bySalary[i].id);
      }
      let lpSimPool = pool.filter(p => simKeepIds.has(p.id));
      console.log(`[SimOptimizer] Pool trimmed: ${pool.length} → ${lpSimPool.length} players for LP solving`);

      console.log(`[SimOptimizer] Starting ${input.numSims} sims for ${sport} slate ${input.slateId}, pool: ${pool.length} players, requesting ${input.lineupCount} lineups`);

      const opponentMap = buildOpponentMap(pool);

      const [vegasContext, dvpContext] = await Promise.all([
        Promise.race([
          buildVegasContext(pool, sport),
          new Promise<null>(r => setTimeout(() => r(null), 8000)),
        ]),
        Promise.race([
          buildDvPContext(opponentMap, sport),
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]),
      ]);

      if (vegasContext) {
        console.log(`[SimOpt] Vegas: ${vegasContext.games.size} games, avg total ${vegasContext.slateAvgTotal.toFixed(1)}, source: ${vegasContext.source}`);
      } else {
        console.log(`[SimOpt] Vegas context unavailable — using flat variance`);
      }

      const dvpAdjustedOverrides = dvpContext
        ? applyDvPToProjections(pool, projOverrides, opponentMap, dvpContext, sport)
        : projOverrides;

      const vegasApplied = vegasContext !== null;
      const dvpApplied   = dvpContext !== null;

      const LP_BUDGET_MS = 18000;
      const SIM_CAL_BATCH = 10;
      const calSims = runSimulations(pool, sport, input.nflPortfolio?.enabled ? input.numSims : SIM_CAL_BATCH, dvpAdjustedOverrides, vegasContext ?? undefined);
      const lineupMap = new Map<string, {
        lineup:    Player[];
        frequency: number;
        simScores: number[];
        stackChoiceIndex?: number;
      }>();

      const simConstraintsBase = {
        ...(input.nflPortfolio?.enabled ? input : {}),
        slateId: input.slateId,
        lockedPlayerIds: input.lockedPlayerIds,
        excludedPlayerIds: input.excludedPlayerIds,
        flexAllowedPositions: input.flexAllowedPositions,
        lineupCount: 1,
        maxSalary: config.salaryCap,
        stackGameKeys,
        stackAlternatives,
      } as unknown as OptimizationConstraints & {
        stackGameKeys?: string[];
        stackAlternatives?: SimStackAlternative[];
        maxSalary?: number;
        minSalary?: number;
      };
      const simExposureSearch = createSimExposureSearch({
        globalMaxExposure: input.globalMaxExposure, globalMinExposure: input.globalMinExposure,
        lockedPlayerIds: input.lockedPlayerIds,
        exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), input.exposureLimits),
        minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), input.minExposureLimits),
      }, input.lineupCount);
      const simCandidateDeadline = solverDeadline - 5000;
      const simSearchConstraints = () => simExposureSearch(simConstraintsBase, lpSimPool.map(p => p.id), lineupMap.values());

      let nflPortfolioReport: NflPortfolioReport | undefined;
      const portfolioEvResults = new Map<string, TournamentEVResult>();
      if (input.nflPortfolio?.enabled) {
        const ownershipMap = await portfolioOwnership(pool, input.nflPortfolio);
        const portfolio = await generateNflPortfolio({
          pool, settings: input.nflPortfolio, count: input.lineupCount,
          baseConstraints: { ...simConstraintsBase, minProjection: undefined,
            stackGameKeys: stackAlternatives.some(choice => choice.kind === "players") ? [] : stackGameKeys,
            exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), input.exposureLimits),
            minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), input.minExposureLimits),
          },
          ownershipMap, vegasGames: vegasContext ? [...vegasContext.games.values()].filter(game => game.source !== "fallback") : undefined,
          deadline: solverDeadline,
          solve: (candidatePool, candidateConstraints) => solveLineup(candidatePool, candidateConstraints, sport, platform, candidateConstraints.ownershipMap ?? ownershipMap, { deadline: solverDeadline, timeoutMs: 2000 }),
          scoreCandidates: candidates => scorePortfolioSims(candidates, calSims, input.sortMetric, pool, ownershipMap, portfolioEvResults),
        });
        nflPortfolioReport = portfolio.report;
        for (const candidate of portfolio.lineups) {
          const ids = new Set(candidate.lineup.map((p: Player) => p.id));
          const qb = candidate.lineup.find((p: Player) => p.position.split("/").includes("QB"));
          const stackChoiceIndex = stackAlternatives.findIndex(choice => choice.kind === "players"
            ? (choice.playerIds || []).every(id => ids.has(id))
            : !!qb && getStackGameKey(qb.gameInfo) === choice.gameKey);
          lineupMap.set(candidate.lineup.map((p: Player) => p.id).sort().join(","), {
            lineup: candidate.lineup, frequency: 1, simScores: [],
            stackChoiceIndex: stackChoiceIndex >= 0 ? stackChoiceIndex : undefined,
          });
        }
      }

      const calT0 = Date.now();
      let calibrationAttempts = 0;
      for (let i = 0; !input.nflPortfolio?.enabled && i < calSims.length; i++) {
        if (Date.now() >= simCandidateDeadline) {
          simTimedOut = true;
          break;
        }
        const sim = calSims[i];
        const simPool = lpSimPool.map(p => {
          const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
          const noise = simProj * (Math.random() * 0.06 - 0.03);
          return { ...p, projectedPoints: Math.max(0, simProj + noise).toString() };
        });
        await yieldToEventLoop();
        calibrationAttempts++;
        const result = solveLineup(
          simPool,
          simSearchConstraints(),
          sport,
          platform,
          undefined,
          { deadline: simCandidateDeadline, timeoutMs: 2_000 },
        );
        if (result.timedOut) simTimedOut = true;
        if (result.error || result.lineup.length === 0) continue;
        const key = result.lineup.map((p: Player) => p.id).sort().join(",");
        const existing = lineupMap.get(key);
        if (existing) {
          existing.frequency++;
          existing.simScores.push(result.totalProjectedPoints);
          if (existing.stackChoiceIndex == null && result.stackChoiceIndex != null) existing.stackChoiceIndex = result.stackChoiceIndex;
        } else {
          lineupMap.set(key, {
            lineup: result.lineup as Player[],
            frequency: 1,
            simScores: [result.totalProjectedPoints],
            stackChoiceIndex: result.stackChoiceIndex,
          });
        }
      }
      const calMs = Date.now() - calT0;
      const msPerLP = Math.max(1, calMs / Math.max(1, calibrationAttempts));

      if (!input.nflPortfolio?.enabled && lineupMap.size === 0 && lpSimPool.length < pool.length) {
        console.log(`[SimOptimizer] Trimmed pool infeasible, falling back to full pool (${pool.length} players)`);
        lpSimPool = pool;
        for (let i = 0; i < calSims.length; i++) {
          if (Date.now() >= simCandidateDeadline) {
            simTimedOut = true;
            break;
          }
          const sim = calSims[i];
          const simPool = lpSimPool.map(p => {
            const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
            const noise = simProj * (Math.random() * 0.06 - 0.03);
            return { ...p, projectedPoints: Math.max(0, simProj + noise).toString() };
          });
          await yieldToEventLoop();
          const result = solveLineup(
            simPool,
            simSearchConstraints(),
            sport,
            platform,
            undefined,
            { deadline: simCandidateDeadline, timeoutMs: 2_000 },
          );
          if (result.timedOut) simTimedOut = true;
          if (result.error || result.lineup.length === 0) continue;
          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          const existing = lineupMap.get(key);
          if (existing) {
            existing.frequency++;
            existing.simScores.push(result.totalProjectedPoints);
            if (existing.stackChoiceIndex == null && result.stackChoiceIndex != null) existing.stackChoiceIndex = result.stackChoiceIndex;
          } else {
            lineupMap.set(key, {
              lineup: result.lineup as Player[],
              frequency: 1,
              simScores: [result.totalProjectedPoints],
              stackChoiceIndex: result.stackChoiceIndex,
            });
          }
        }
      }

      const simBudgetLeft = Math.max(0, LP_BUDGET_MS - calMs);
      const adaptiveCount = input.nflPortfolio?.enabled ? 0 : Math.min(input.numSims - SIM_CAL_BATCH, Math.max(40, Math.floor(simBudgetLeft / msPerLP)));
      const totalSimTarget = SIM_CAL_BATCH + adaptiveCount;
      console.log(`[SimOptimizer] Adaptive: ${msPerLP.toFixed(0)}ms/solve, lpPool=${lpSimPool.length}, target=${totalSimTarget} sims (tier max ${input.numSims})`);

      const remainingSims = runSimulations(pool, sport, adaptiveCount, dvpAdjustedOverrides, vegasContext ?? undefined);
      const sims = [...calSims, ...remainingSims];

      for (let i = SIM_CAL_BATCH; !input.nflPortfolio?.enabled && i < sims.length; i++) {
        if (Date.now() >= simCandidateDeadline) {
          simTimedOut = true;
          console.log(`[SimOptimizer] Time cap reached after ${i} sims`);
          break;
        }
        const sim = sims[i];
        const simPool = lpSimPool.map(p => {
          const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
          const noise = simProj * (Math.random() * 0.06 - 0.03);
          return { ...p, projectedPoints: Math.max(0, simProj + noise).toString() };
        });
        await yieldToEventLoop();
        const result = solveLineup(
          simPool,
          simSearchConstraints(),
          sport,
          platform,
          undefined,
          { deadline: simCandidateDeadline, timeoutMs: 2_000 },
        );
        if (result.timedOut) simTimedOut = true;
        if (result.error || result.lineup.length === 0) continue;
        const key = result.lineup.map((p: Player) => p.id).sort().join(",");
        const existing = lineupMap.get(key);
        if (existing) {
          existing.frequency++;
          existing.simScores.push(result.totalProjectedPoints);
          if (existing.stackChoiceIndex == null && result.stackChoiceIndex != null) existing.stackChoiceIndex = result.stackChoiceIndex;
        } else {
          lineupMap.set(key, {
            lineup: result.lineup as Player[],
            frequency: 1,
            simScores: [result.totalProjectedPoints],
            stackChoiceIndex: result.stackChoiceIndex,
          });
        }
      }

      if (lineupMap.size === 0) {
        const partial = simTimedOut || Date.now() >= solverDeadline;
        return res.status(200).json({
          lineups: [],
          ...(nflPortfolioReport ? { nflPortfolioReport } : {}),
          message: stackAlternatives.length
            ? "No feasible lineups satisfy your selected stacks. Check player locks, exclusions, player status, salary/FLEX filters, or select another stack."
            : partial
              ? "Partial results: the solver time budget expired before a validated lineup was generated."
              : "No feasible lineups found in simulations. Try relaxing constraints.",
          simsRun: sims.length,
          partial,
        });
      }

      const simProjArrays = sims.map(s => s.projections);
      const nSims = simProjArrays.length;

      const uniqueLineups = Array.from(lineupMap.entries()).map(([key, data]) => {
        const pids = data.lineup.map(p => p.id);
        const allSimScores = new Float64Array(nSims);
        for (let si = 0; si < nSims; si++) {
          const proj = simProjArrays[si];
          let total = 0;
          for (let pi = 0; pi < pids.length; pi++) total += proj[pids[pi]] || 0;
          allSimScores[si] = total;
        }
        allSimScores.sort();

        const n   = nSims;
        let sumV = 0;
        for (let i = 0; i < n; i++) sumV += allSimScores[i];
        const avg = sumV / n;
        const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
        const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
        const med = allSimScores[Math.floor(n * 0.50)] ?? avg;

        const composite = avg * 0.35 + p75 * 0.35 + p90 * 0.20 + (data.frequency / nSims) * 100 * 0.10;
        const stack = detectStack(data.lineup);

        return {
          lineup:       data.lineup,
          key,
          frequency:    data.frequency,
          freqPct:      Math.round((data.frequency / nSims) * 1000) / 10,
          avgSimScore:  Math.round(avg * 10) / 10,
          medianScore:  Math.round(med * 10) / 10,
          p75Score:     Math.round(p75 * 10) / 10,
          p90Score:     Math.round(p90 * 10) / 10,
          compositeScore: Math.round(composite * 10) / 10,
          totalSalary:  data.lineup.reduce((s, p) => s + p.salary, 0),
          stackedGame:  stack.game,
          stackCount:   stack.count,
          stackTeams:   stack.teams,
          stackChoice:  data.stackChoiceIndex == null ? undefined : stackAlternatives[data.stackChoiceIndex] || undefined,
        };
      });

      // Tournament EV: score candidates against a simulated opponent field
      // sampled from projected ownership, mapped through a GPP payout curve
      // with a duplication penalty. Only computed when requested.
      if (input.sortMetric === "ev" && input.nflPortfolio?.enabled) {
        for (const lu of uniqueLineups as any[]) {
          const ev = portfolioEvResults.get(lu.key);
          if (!ev) throw new Error("EV portfolio result is missing its candidate score.");
          Object.assign(lu, ev);
        }
      }
      if (input.sortMetric === "ev" && !input.nflPortfolio?.enabled) {
        try {
          const bdlStatsEV = await fetchBDLStats(slate.sport).catch(() => undefined);
          const ownershipResultsEV = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStatsEV);
          const ownedPoolEV = computeOwnershipForPlayers(pool, ownershipResultsEV);
          const ownByIdEV = new Map(ownedPoolEV.map(p => [p.id, p.ownershipProjection]));
          const EV_FIELD_SIZE = 800;
          const fieldLineups = generateFieldLineups(ownedPoolEV, slate.sport, slate.platform, EV_FIELD_SIZE);
          if (fieldLineups.length >= 100) {
            const evCandidates = uniqueLineups.map(lu => {
              let ownProduct = 1;
              for (const p of lu.lineup) {
                ownProduct *= Math.min(0.6, Math.max(0.002, (ownByIdEV.get(p.id) ?? 0.5) / 100));
              }
              return { key: lu.key, pids: lu.lineup.map(p => p.id), ownProduct };
            });
            const evMap = computeTournamentEV(evCandidates, fieldLineups, simProjArrays as any);
            for (const lu of uniqueLineups as any[]) {
              const ev = evMap.get(lu.key);
              if (ev) {
                lu.evScore = ev.evScore;
                lu.winPct = ev.winPct;
                lu.cashPct = ev.cashPct;
                lu.dupeFactor = ev.dupeFactor;
              } else {
                lu.evScore = 0;
              }
            }
            console.log(`[TournamentEV] Scored ${evCandidates.length} candidates vs ${fieldLineups.length}-lineup simulated field`);
          } else {
            console.warn(`[TournamentEV] Field generation too sparse (${fieldLineups.length}) — falling back to composite sort`);
          }
        } catch (err) {
          console.error("[TournamentEV] failed (falling back to composite):", err);
        }
      }

      const metricKey = ({
        composite: "compositeScore",
        p90:       "p90Score",
        p75:       "p75Score",
        median:    "medianScore",
        avg:       "avgSimScore",
        ev:        "evScore",
      } as Record<string, string>)[input.sortMetric] ?? "compositeScore";
      uniqueLineups.sort((a, b) =>
        (((b as any)[metricKey] ?? b.compositeScore) as number) - (((a as any)[metricKey] ?? a.compositeScore) as number));

      const selected = selectExposureLineups(uniqueLineups, c => c.lineup.map(p => p.id), {
        globalMaxExposure: input.globalMaxExposure, globalMinExposure: input.globalMinExposure,
        lockedPlayerIds: input.lockedPlayerIds,
        exposureLimits: mergeExposureMaximums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.max != null).map(([id, v]) => [id, v.max!])), input.exposureLimits),
        minExposureLimits: mergeExposureMinimums(Object.fromEntries(Object.entries(simOverrideExposure).filter(([, v]) => v.min != null).map(([id, v]) => [id, v.min!])), input.minExposureLimits),
      }, { count: input.lineupCount, deadline: solverDeadline + 2000, preservePortfolio: !!nflPortfolioReport });
      const elapsedMs = Date.now() - startTime;
      const partial = selected.length < input.lineupCount || simTimedOut || Date.now() >= solverDeadline || !!nflPortfolioReport?.partial;
      const partialMessage = partial
        ? `Partial results: generated ${selected.length} of ${input.lineupCount} requested lineups within the candidate/search budget and hard exposure limits. All percentages use the returned batch size.`
        : undefined;

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

      console.log(`[SimOptimizer] Completed: ${sims.length} sims, ${lineupMap.size} unique lineups, ${selected.length} selected, ${elapsedMs}ms`);

      res.json({
        lineups:         selected,
        ...(nflPortfolioReport ? { nflPortfolioReport } : {}),
        simsRun:         sims.length,
        uniqueLineups:   lineupMap.size,
        elapsedMs,
        exposureSummary,
        gamesRepresented: new Set(
          selected.flatMap(lu => lu.stackedGame ? [lu.stackedGame] : [])
        ).size,
        context: {
          vegasApplied,
          vegasSource:      vegasContext?.source ?? null,
          vegasGamesFound:  vegasContext?.games.size ?? 0,
          slateAvgTotal:    vegasContext ? Math.round(vegasContext.slateAvgTotal * 10) / 10 : null,
          dvpApplied,
          dvpTeamsFound:    dvpContext ? dvpContext.size / 8 : 0,
        },
        favoriteStacks: selectedFavoriteStacks.map(serializeFavoriteStack),
        partial,
        message: partialMessage,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("[SimOptimizer] Error:", err);
      res.status(500).json({ message: "Simulation optimization failed" });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const allAlerts = await storage.getAlerts(userId);
    const unreadCount = await storage.getUnreadAlertCount(userId);
    res.json({ alerts: allAlerts, unreadCount });
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    await storage.markAlertRead(Number(req.params.id), userId);
    res.sendStatus(204);
  });

  app.post("/api/alerts/read-all", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    await storage.markAllAlertsRead(userId);
    res.sendStatus(204);
  });

  app.get("/api/players/:name/history", async (req, res) => {
    try {
      const sport = (req.query.sport as string || "NBA").toUpperCase();
      const playerName = decodeURIComponent(req.params.name);
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 30));
      const history = await storage.getPlayerHistoryByName(playerName, sport, limit);
      res.json(history);
    } catch (err) {
      console.error("Player history error:", err);
      res.status(500).json({ message: "Failed to fetch player history" });
    }
  });

  app.get("/api/lineup-scores", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const scores = await storage.getLineupScores(userId);
      res.json(scores);
    } catch (err) {
      console.error("Lineup scores error:", err);
      res.status(500).json({ message: "Failed to fetch lineup scores" });
    }
  });

  const scoreRefreshCooldowns = new Map<number, number>();
  app.post("/api/lineup-scores/refresh", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const now = Date.now();
    const lastRefresh = scoreRefreshCooldowns.get(userId) || 0;
    if (now - lastRefresh < 60_000) {
      return res.status(429).json({ message: "Please wait at least 60 seconds between refreshes" });
    }
    scoreRefreshCooldowns.set(userId, now);
    try {
      const { refreshLineupScores } = await import("./index");
      await refreshLineupScores();
      const scores = await storage.getLineupScores(userId);
      res.json({ message: "Scores refreshed", scores });
    } catch (err: any) {
      console.error("Manual score refresh error:", err);
      res.status(500).json({ message: err.message || "Score refresh failed" });
    }
  });

  app.get("/api/lineup-scores/:lineupId", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const score = await storage.getLineupScore(Number(req.params.lineupId));
      if (!score) return res.status(404).json({ message: "Score not found" });
      if (score.userId !== userId) return res.sendStatus(403);
      res.json(score);
    } catch (err) {
      console.error("Lineup score error:", err);
      res.status(500).json({ message: "Failed to fetch lineup score" });
    }
  });

  app.get("/api/notification-preferences", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const prefs = await storage.getNotificationPreferences(userId);
      res.json(prefs || {
        emailEnabled: true,
        smsEnabled: false,
        phoneNumber: null,
        injuryAlerts: true,
        scoringMilestones: true,
        preGameReminders: true,
        preGameMinutes: 60,
      });
    } catch (err) {
      console.error("Notification prefs error:", err);
      res.status(500).json({ message: "Failed to fetch notification preferences" });
    }
  });

  app.put("/api/notification-preferences", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const { emailEnabled, smsEnabled, phoneNumber, injuryAlerts, scoringMilestones, preGameReminders, preGameMinutes } = req.body;
      const result = await storage.upsertNotificationPreferences({
        userId,
        emailEnabled: emailEnabled ?? true,
        smsEnabled: smsEnabled ?? false,
        phoneNumber: phoneNumber || null,
        injuryAlerts: injuryAlerts ?? true,
        scoringMilestones: scoringMilestones ?? true,
        preGameReminders: preGameReminders ?? true,
        preGameMinutes: preGameMinutes ?? 60,
      });
      res.json(result);
    } catch (err) {
      console.error("Notification prefs update error:", err);
      res.status(500).json({ message: "Failed to update notification preferences" });
    }
  });

  app.get("/api/performance", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const sport = req.query.sport as string | undefined;
      const snapshots = await storage.getPerformanceSnapshots(userId, sport);
      res.json(snapshots);
    } catch (err) {
      console.error("Performance error:", err);
      res.status(500).json({ message: "Failed to fetch performance data" });
    }
  });

  app.get("/api/performance/today", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const lineups = await storage.getLineups(userId);
      const scores = await storage.getLineupScores(userId);
      const scoreMap = new Map(scores.map(s => [s.lineupId, s]));

      type SportSummary = {
        sport: string;
        lineupCount: number;
        bestProjected: number;
        bestActual: number;
        avgProjected: number;
        avgSalaryUtil: number;
        hasLiveScores: boolean;
      };
      const bySport: Record<string, SportSummary> = {};

      for (const lineup of lineups) {
        if (!bySport[lineup.sport]) {
          bySport[lineup.sport] = {
            sport: lineup.sport,
            lineupCount: 0,
            bestProjected: 0,
            bestActual: 0,
            avgProjected: 0,
            avgSalaryUtil: 0,
            hasLiveScores: false,
          };
        }
        const s = bySport[lineup.sport];
        s.lineupCount++;
        const proj = parseFloat(lineup.totalProjectedPoints || "0");
        s.avgProjected += proj;
        if (proj > s.bestProjected) s.bestProjected = proj;

        const slate = await storage.getSlate(lineup.slateId);
        const cap = slate?.salaryCap || 50000;
        s.avgSalaryUtil += cap > 0 ? (lineup.totalSalary || 0) / cap : 0;

        const score = scoreMap.get(lineup.id);
        if (score) {
          const live = parseFloat(score.totalLivePoints || "0");
          if (live > s.bestActual) s.bestActual = live;
          if (live > 0) s.hasLiveScores = true;
        }
      }

      const sportSummaries = Object.values(bySport).map(s => ({
        ...s,
        avgProjected: s.lineupCount > 0 ? Math.round((s.avgProjected / s.lineupCount) * 10) / 10 : 0,
        bestProjected: Math.round(s.bestProjected * 10) / 10,
        bestActual: Math.round(s.bestActual * 10) / 10,
        avgSalaryUtil: s.lineupCount > 0 ? Math.round((s.avgSalaryUtil / s.lineupCount) * 1000) / 10 : 0,
      }));

      const lineupIdSet = new Set(lineups.map(l => l.id));
      const scoredCount = scores.filter(s => lineupIdSet.has(s.lineupId)).length;

      res.json({
        totalLineups: lineups.length,
        sportSummaries,
        totalScored: scoredCount,
      });
    } catch (err) {
      console.error("Today performance error:", err);
      res.status(500).json({ message: "Failed to fetch today's performance" });
    }
  });

  app.get("/api/performance/aggregate", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const aggregate = await storage.getAggregatePerformance(userId);
      res.json(aggregate);
    } catch (err) {
      console.error("Aggregate performance error:", err);
      res.status(500).json({ message: "Failed to fetch aggregate performance" });
    }
  });

  app.get("/api/track-record", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const sub = await storage.getSubscription(userId);
      const trackUser = await storage.getUser(userId);
      const tier = trackUser?.isAdmin ? "pro" : (sub?.tier || "free");

      const allLineups = await storage.getAllLineups(userId);
      const savedCount = allLineups.length;
      const vaultLineups = allLineups.filter(l => l.status === "active" || l.status === "review");
      const sportCounts: Record<string, number> = {};
      for (const l of allLineups) {
        sportCounts[l.sport] = (sportCounts[l.sport] || 0) + 1;
      }

      const aggregate = await storage.getAggregatePerformance(userId);
      const snapshots = await storage.getPerformanceSnapshots(userId);
      const recentSnapshots = snapshots.slice(0, 10);

      res.json({
        tier,
        totalLineups: savedCount,
        activeLineups: vaultLineups.length,
        sportBreakdown: sportCounts,
        performance: aggregate,
        recentPerformance: recentSnapshots,
      });
    } catch (err) {
      console.error("Track record error:", err);
      res.status(500).json({ message: "Failed to fetch track record" });
    }
  });

  app.get("/api/content-access", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    try {
      const sub = await storage.getSubscription(userId);
      const contentUser = await storage.getUser(userId);
      const tier = contentUser?.isAdmin ? "pro" : (sub?.tier || "free");
      const features: Record<string, { unlocked: boolean; requiredTier: string }> = {
        standardOptimizer: { unlocked: true, requiredTier: "free" },
        proOptimizer: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        bulkRegenerate: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        playerConfig: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        ownershipHeatmap: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        winningLineupAgent: { unlocked: tier === "pro", requiredTier: "pro" },
        dkImport: { unlocked: tier === "pro", requiredTier: "pro" },
        liveScoreTracker: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        performanceDashboard: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
        notificationPreferences: { unlocked: tier === "star" || tier === "pro", requiredTier: "star" },
      };
      res.json({ tier, features });
    } catch (err) {
      console.error("Content access error:", err);
      res.status(500).json({ message: "Failed to fetch content access" });
    }
  });

  app.get("/api/props", async (req, res) => {
    const validSports = ACTIVE_SPORTS as readonly string[];
    const rawSport = req.query.sport as string | undefined;
    const sport = rawSport && validSports.includes(rawSport) ? rawSport : undefined;
    const today = getEasternToday();
    const allProps = await storage.getPropsByDate(today, sport);
    
    const sorted = allProps.sort((a, b) => Number(b.confidence) - Number(a.confidence));

    let tier = "free";
    let isAuthenticated = false;
    if (isLoggedIn(req)) {
      isAuthenticated = true;
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      const propsUser = await storage.getUser(userId);
      tier = propsUser?.isAdmin ? "pro" : (sub?.tier || "free");
    }

    const maxPerSport = !isAuthenticated ? 0 : tier === "pro" ? 15 : tier === "star" ? 5 : 2;

    const propsBySport: Record<string, typeof sorted> = {};
    for (const prop of sorted) {
      if (!propsBySport[prop.sport]) propsBySport[prop.sport] = [];
      propsBySport[prop.sport].push(prop);
    }

    if (!isAuthenticated) {
      const freeProps: typeof sorted = [];
      for (const sportKey of Object.keys(propsBySport)) {
        const sportProps = propsBySport[sportKey];
        if (sportProps.length > 0) {
          freeProps.push(sportProps[0]);
        }
      }
      const lockedCount = sorted.length - freeProps.length;
      return res.json({ props: freeProps, tier: "guest", totalCount: sorted.length, lockedCount, maxPerSport: 1 });
    }

    if (tier === "pro") {
      const limitedProps: typeof sorted = [];
      for (const sportKey of Object.keys(propsBySport)) {
        limitedProps.push(...propsBySport[sportKey].slice(0, maxPerSport));
      }
      return res.json({ props: limitedProps, tier, totalCount: sorted.length, maxPerSport });
    }

    const visibleProps: typeof sorted = [];
    let lockedCount = 0;
    for (const sportKey of Object.keys(propsBySport)) {
      const sportProps = propsBySport[sportKey];
      const selected = sportProps.slice(0, maxPerSport);
      const hasGold = selected.some(p => Number(p.confidence) >= 78);
      if (!hasGold) {
        const goldPick = sportProps.find(p => Number(p.confidence) >= 78);
        if (goldPick && selected.length > 0) {
          selected[selected.length - 1] = goldPick;
          selected.sort((a, b) => Number(b.confidence) - Number(a.confidence));
        }
      }
      visibleProps.push(...selected);
      lockedCount += Math.max(0, sportProps.length - maxPerSport);
    }

    res.json({ props: visibleProps, tier, totalCount: sorted.length, lockedCount, maxPerSport });
  });

  app.get("/api/active-sports", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const allSlates = await storage.getSlates();
      const activeSports = [...new Set(
        allSlates
          .filter((s: any) => s.isActive !== false && s.sport)
          .map((s: any) => s.sport.toUpperCase())
      )].sort();
      res.json(activeSports);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scout/status", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (!isAdmin && tier !== "star" && tier !== "pro") {
        return res.status(403).json({ message: "AI Scout is a Sharpshooter / Champion feature.", requiresUpgrade: true });
      }
      res.json(getScoutStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/scout/signals/:sport", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const sub = await storage.getSubscription(userId);
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (!isAdmin && tier !== "star" && tier !== "pro") {
        return res.status(403).json({ message: "AI Scout is a Sharpshooter / Champion feature.", requiresUpgrade: true });
      }

      const sport = (req.params.sport || "NBA").toUpperCase();
      const signals = getCachedSignals(sport);

      triggerLazyRefreshIfStale(async (s: string) => {
        const allSlates = await storage.getSlates();
        let sportSlates = allSlates.filter(
          (sl: any) => sl.sport?.toUpperCase() === s && sl.platform === "draftkings" && sl.isActive !== false
        );
        if (sportSlates.length === 0) {
          sportSlates = allSlates.filter(
            (sl: any) => sl.sport?.toUpperCase() === s && sl.isActive !== false
          );
        }
        if (sportSlates.length === 0) return [];
        sportSlates.sort((a: any, b: any) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
        const latestSlate = sportSlates[0];
        const slatePlayers = await storage.getPlayersBySlate(latestSlate.id);
        return slatePlayers.map((p: any) => ({
          name: p.name,
          team: p.team || "",
          position: p.position || "",
          salary: p.salary || 0,
          fppg: p.projectedPoints || null,
        }));
      });

      res.json({
        sport,
        count: signals.length,
        signals,
        seconds_until_refresh: secondsUntilRefresh(),
      });
    } catch (err: any) {
      console.error(`[AIScout] Error fetching signals for ${req.params.sport}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scout/refresh", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const dbUser = await storage.getUser(userId);
      const isAdmin = dbUser?.isAdmin === true;
      if (!isAdmin) return res.status(403).json({ error: "Admin only" });

      forceRefreshAll();

      const allSlates = await storage.getSlates();
      const playersBySport: Record<string, Array<{ name: string; team: string; position: string; salary: number; fppg: string | null }>> = {};

      for (const sport of ["NBA", "NHL", "GOLF", "NFL", "MLB", "SOCCER"]) {
        let sportSlates = allSlates.filter(
          (s: any) => s.sport?.toUpperCase() === sport && s.platform === "draftkings" && s.isActive !== false
        );
        if (sportSlates.length === 0) {
          sportSlates = allSlates.filter(
            (s: any) => s.sport?.toUpperCase() === sport && s.isActive !== false
          );
        }
        if (sportSlates.length > 0) {
          sportSlates.sort((a: any, b: any) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
          const latestSlate = sportSlates[0];
          const slatePlayers = await storage.getPlayersBySlate(latestSlate.id);
          if (slatePlayers.length > 0) {
            playersBySport[sport] = slatePlayers.map((p: any) => ({
              name: p.name,
              team: p.team || "",
              position: p.position || "",
              salary: p.salary || 0,
              fppg: p.projectedPoints || null,
            }));
          }
        }
      }

      refreshAll(playersBySport, true).catch((err: any) =>
        console.error("[AIScout] Background refresh failed:", err.message)
      );

      res.json({ status: "refresh_queued", sport: req.body?.sport || "ALL" });
    } catch (err: any) {
      console.error(`[AIScout] Error refreshing:`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/starting-lineups/nba", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const dbUser = await storage.getUser(userId);
      const sub = await storage.getSubscription(userId);
      const isAdmin = dbUser?.isAdmin === true;
      const tier = isAdmin ? "pro" : (sub?.tier || "free");
      if (tier !== "pro" && tier !== "star") {
        return res.status(403).json({ error: "Sharpshooter or Champion tier required", requiresUpgrade: true });
      }

      const data = await getStartingLineupsData();
      if (!data) return res.status(502).json({ error: "Unable to fetch starting lineups" });
      res.json(data);
    } catch (err: any) {
      console.error("[Lineups] Error:", err.message);
      res.status(500).json({ error: "Failed to fetch starting lineups" });
    }
  });

  app.post("/api/starting-lineups/sync", async (req, res) => {
    try {
      const userId = getSessionUserId(req);
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const dbUser = await storage.getUser(userId);
      if (!dbUser?.isAdmin) return res.status(403).json({ error: "Admin only" });

      clearLineupsCache();
      const result = await fetchStartingLineups();
      res.json(result);
    } catch (err: any) {
      console.error("[Lineups] Sync error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.use(projectionAccuracyRouter);

  return httpServer;
}

const PROP_TYPES_BY_SPORT: Record<string, { type: string; baseMultiplier: number; unit: string }[]> = {
  NBA: [
    { type: "Points", baseMultiplier: 0.45, unit: "pts" },
    { type: "Rebounds", baseMultiplier: 0.18, unit: "reb" },
    { type: "Assists", baseMultiplier: 0.22, unit: "ast" },
    { type: "Pts+Reb+Ast", baseMultiplier: 0.85, unit: "PRA" },
    { type: "3-Pointers", baseMultiplier: 0.08, unit: "3PM" },
  ],
  NHL: [
    { type: "Points", baseMultiplier: 0.55, unit: "pts" },
    { type: "Shots on Goal", baseMultiplier: 0.75, unit: "SOG" },
    { type: "Saves", baseMultiplier: 2.5, unit: "saves" },
    { type: "Goals", baseMultiplier: 0.2, unit: "goals" },
  ],
  MLB: [
    { type: "Strikeouts", baseMultiplier: 0.65, unit: "K" },
    { type: "Hits+Runs+RBI", baseMultiplier: 0.55, unit: "H+R+RBI" },
    { type: "Total Bases", baseMultiplier: 0.45, unit: "TB" },
    { type: "Hits", baseMultiplier: 0.3, unit: "hits" },
  ],
  NFL: [
    { type: "Pass Yards", baseMultiplier: 5.0, unit: "yds" },
    { type: "Rush Yards", baseMultiplier: 1.5, unit: "yds" },
    { type: "Receptions", baseMultiplier: 0.3, unit: "rec" },
    { type: "Pass TDs", baseMultiplier: 0.12, unit: "TDs" },
    { type: "Rec Yards", baseMultiplier: 1.2, unit: "yds" },
  ],
  GOLF: [
    { type: "Birdies", baseMultiplier: 0.25, unit: "birdies" },
    { type: "Bogey-Free Rounds", baseMultiplier: 0.08, unit: "rounds" },
    { type: "Top 10 Finish", baseMultiplier: 0.12, unit: "T10" },
    { type: "Eagles", baseMultiplier: 0.04, unit: "eagles" },
    { type: "Under Par Holes", baseMultiplier: 0.35, unit: "holes" },
  ],
  SOCCER: [
    { type: "Shots", baseMultiplier: 0.6, unit: "shots" },
    { type: "Shots on Target", baseMultiplier: 0.3, unit: "SOT" },
    { type: "Tackles", baseMultiplier: 0.45, unit: "tackles" },
    { type: "Passes", baseMultiplier: 3.5, unit: "passes" },
    { type: "Goals+Assists", baseMultiplier: 0.15, unit: "G+A" },
  ],
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

async function generateFallbackPropsFromDK(sports: string[], date: string): Promise<InsertProp[]> {
  const props: InsertProp[] = [];
  const allSlates = await storage.getSlates();
  const dateSeed = date.split("-").join("");
  const rng = seededRandom(parseInt(dateSeed, 10));

  for (const sport of sports) {
    if (sport === "GOLF") continue;
    const propTypes = PROP_TYPES_BY_SPORT[sport];
    if (!propTypes || propTypes.length === 0) continue;

    const slate = allSlates.find(s => s.sport === sport && s.isMain)
      || allSlates.filter(s => s.sport === sport).sort((a, b) => b.id - a.id)[0];
    if (!slate) continue;

    const players = await storage.getPlayersBySlate(slate.id);
    if (players.length === 0) continue;

    const eligible = players
      .filter(p => {
        const proj = parseFloat(p.projectedPoints || p.fppg || "0");
        return proj > 0 && !isPlayerOut(p.injuryStatus);
      })
      .sort((a, b) => parseFloat(b.projectedPoints || b.fppg || "0") - parseFloat(a.projectedPoints || a.fppg || "0"));

    const topPlayers = eligible.slice(0, Math.min(30, eligible.length));
    if (topPlayers.length === 0) continue;

    const PICKS_PER_SPORT = 5;
    const usedPlayers = new Set<string>();

    for (let i = 0; i < PICKS_PER_SPORT && i < topPlayers.length; i++) {
      let playerIdx = Math.floor(rng() * topPlayers.length);
      let attempts = 0;
      while (usedPlayers.has(topPlayers[playerIdx].name) && attempts < topPlayers.length) {
        playerIdx = (playerIdx + 1) % topPlayers.length;
        attempts++;
      }
      if (usedPlayers.has(topPlayers[playerIdx].name)) continue;

      const player = topPlayers[playerIdx];
      usedPlayers.add(player.name);

      const pos = (player.position || "").toUpperCase();
      let validPropTypes = propTypes;
      if (sport === "NHL") {
        const isGoalie = pos.includes("G") && !pos.includes("C") && !pos.includes("W") && !pos.includes("D");
        validPropTypes = isGoalie
          ? propTypes.filter(pt => pt.type === "Saves")
          : propTypes.filter(pt => pt.type !== "Saves");
        if (validPropTypes.length === 0) validPropTypes = propTypes;
      } else if (sport === "MLB") {
        const isPitcher = pos.includes("P") || pos.includes("SP") || pos.includes("RP");
        validPropTypes = isPitcher
          ? propTypes.filter(pt => pt.type === "Strikeouts")
          : propTypes.filter(pt => pt.type !== "Strikeouts");
        if (validPropTypes.length === 0) validPropTypes = propTypes;
      }

      const propType = validPropTypes[Math.floor(rng() * validPropTypes.length)];
      const proj = parseFloat(player.projectedPoints || player.fppg || "0");
      const rawLine = proj * propType.baseMultiplier;
      const variance = 0.85 + rng() * 0.3;
      const line = Math.round(rawLine * variance * 2) / 2;

      if (line <= 0) continue;

      const edgeRoll = rng();
      const pick = edgeRoll > 0.5 ? "Over" : "Under";
      const confidence = Math.round(60 + rng() * 30);

      let opponentFromGameInfo: string | null = null;
      if (player.gameInfo) {
        const gi = sanitizeGameInfo(player.gameInfo).replace(/\s*@\s*\d.*/, "").replace(/\s*\d+:\d+.*/, "");
        const parts = gi.split(/\s+(?:vs|@)\s+/).map(t => t.trim()).filter(Boolean);
        opponentFromGameInfo = parts.find(t => t !== player.team) || null;
      }

      props.push({
        sport,
        playerName: player.name,
        team: player.team,
        opponent: player.opponent || opponentFromGameInfo || "OPP",
        propType: propType.type,
        line: line.toString(),
        pick,
        confidence: confidence.toString(),
        gameInfo: player.gameInfo || `${player.team} game`,
        isLocked: false,
        createdDate: date,
      });
    }
  }

  return props;
}

export async function generateDailyProps(date: string) {
  await storage.clearPropsByDate(date);
  
  const allProps: InsertProp[] = [];
  const apiKey = process.env.ODDS_API_KEY;

  if (apiKey) {
    console.log("[Props] Fetching real prop data from The Odds API...");
    const sportsFetched: string[] = [];

    const allPlayers = await storage.getAllPlayers();
    const playerTeamMap = new Map<string, string>();
    for (const p of allPlayers) {
      playerTeamMap.set(p.name.toLowerCase(), p.team);
    }

    for (const sport of ACTIVE_SPORTS) {
      if (sport === "GOLF") continue;
      try {
        const maxEvents = sport === "SOCCER" ? 12 : 3;
        const apiProps = await fetchAllPropsForSport(sport, maxEvents, playerTeamMap);
        if (apiProps.length > 0) {
          sportsFetched.push(sport);
          for (const p of apiProps) {
            let gameInfoWithTime = p.gameInfo;
            if (p.commenceTime) {
              const d = new Date(p.commenceTime);
              const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
              const timeStr = dateStr + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
              gameInfoWithTime = `${p.gameInfo} · ${timeStr}`;
            }
            allProps.push({
              sport: p.sport,
              playerName: p.playerName,
              team: p.team,
              opponent: p.opponent,
              propType: p.propType,
              line: p.line,
              pick: p.pick,
              confidence: p.confidence,
              gameInfo: gameInfoWithTime,
              isLocked: false,
              createdDate: date,
            });
          }
          console.log(`[Props] Got ${apiProps.length} real props for ${sport}`);
        } else {
          console.log(`[Props] No API props for ${sport}, will use fallback`);
        }
      } catch (err) {
        console.error(`[Props] Error fetching ${sport} from Odds API:`, err);
      }
    }

    const sportsWithoutData = ACTIVE_SPORTS.filter(s => !sportsFetched.includes(s));
    if (sportsWithoutData.length > 0) {
      console.log(`[Props] No API data for: ${sportsWithoutData.join(", ")} — generating from DK projections`);
      const fallbackProps = await generateFallbackPropsFromDK(sportsWithoutData, date);
      allProps.push(...fallbackProps);
      if (fallbackProps.length > 0) {
        console.log(`[Props] Generated ${fallbackProps.length} fallback props from DK data`);
      }
    }
  } else {
    console.log("[Props] No ODDS_API_KEY found, generating from DK projections");
    const fallbackSports = ACTIVE_SPORTS.filter(s => s !== "GOLF");
    const fallbackProps = await generateFallbackPropsFromDK(fallbackSports, date);
    allProps.push(...fallbackProps);
    if (fallbackProps.length > 0) {
      console.log(`[Props] Generated ${fallbackProps.length} fallback props from DK data`);
    }
  }

  allProps.sort((a, b) => Number(b.confidence) - Number(a.confidence));

  const FREE_PICKS = 3;
  for (let i = 0; i < allProps.length; i++) {
    allProps[i].isLocked = i >= FREE_PICKS;
  }

  if (allProps.length > 0) {
    await storage.bulkCreateProps(allProps);
    console.log(`[Props] Saved ${allProps.length} props for ${date}`);
  }
}

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
      if (positions.includes("W") || positions.includes("LW") || positions.includes("RW")) {
        vars.W = 1; vars.SKATER = 1;
        if (positions.includes("LW")) vars.LW = 1;
        if (positions.includes("RW")) vars.RW = 1;
      }
      if (positions.includes("D")) { vars.D = 1; vars.SKATER = 1; }
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "MLB":
      if (positions.includes("P") || positions.includes("SP") || positions.includes("RP")) {
        vars.P = 1;
        vars.SP = 1;
      }
      if (positions.includes("C")) { vars.C = 1; vars["C/1B"] = 1; vars.HITTER = 1; }
      if (positions.includes("1B")) { vars["1B"] = 1; vars["C/1B"] = 1; vars.HITTER = 1; }
      if (positions.includes("2B")) { vars["2B"] = 1; vars.HITTER = 1; }
      if (positions.includes("3B")) { vars["3B"] = 1; vars.HITTER = 1; }
      if (positions.includes("SS")) { vars.SS = 1; vars.HITTER = 1; }
      if (positions.includes("OF") || positions.includes("LF") || positions.includes("CF") || positions.includes("RF")) { vars.OF = 1; vars.HITTER = 1; }
      break;

    case "NFL":
      if (positions.includes("QB")) { vars.QB = 1; }
      if (positions.includes("RB")) { vars.RB = 1; vars.FLEX = 1; }
      if (positions.includes("WR")) { vars.WR = 1; vars.FLEX = 1; }
      if (positions.includes("TE")) { vars.TE = 1; vars.FLEX = 1; }
      if (positions.includes("DST") || positions.includes("DEF")) { vars.DST = 1; vars.DEF = 1; }
      if (positions.includes("K") || positions.includes("PK")) { vars.K = 1; }
      break;

    case "GOLF":
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "SOCCER":
      if (positions.includes("F")) { vars.F = 1; vars.OUTFIELD = 1; }
      if (positions.includes("M") || positions.includes("MF")) { vars.M = 1; vars.MF = 1; vars.OUTFIELD = 1; }
      if (positions.includes("D")) { vars.D = 1; vars.OUTFIELD = 1; }
      if (positions.includes("GK")) { vars.GK = 1; }
      break;
  }

  return vars;
}

async function getInactivePlayerIds(players: Player[], sport: string): Promise<{ inactiveIds: number[]; zeroPointCount: number }> {
  const inactiveIds: number[] = [];

  let recentlyPlayed = getRecentlyPlayedCache(sport);
  if (!recentlyPlayed && ["NBA", "NHL", "MLB", "NFL"].includes(sport)) {
    recentlyPlayed = await refreshRecentlyPlayed(sport);
  }

  let zeroPointNames: Set<string> = new Set();
  try {
    const names = await storage.getZeroPointPlayerNames(sport, 3);
    zeroPointNames = new Set(names.map(n => n.toLowerCase()));
    if (zeroPointNames.size > 0) {
      console.log(`[Zero-Point Filter] ${sport}: Found ${zeroPointNames.size} players with 0 actual pts in last 3+ appearances`);
    }
  } catch (err) {
    console.error(`[Zero-Point Filter] Error fetching zero-point players:`, err);
  }

  let zeroPointCount = 0;
  let notRecentCount = 0;
  const recentCoverage = recentlyPlayed && players.length > 0
    ? players.filter(p => recentlyPlayed!.has(normalizePlayerName(p.name))).length / players.length
    : 0;
  const useRecentActivity =
    sport !== "NFL" &&
    recentlyPlayed &&
    recentlyPlayed.size > 0 &&
    recentCoverage >= 0.7;
  if (recentlyPlayed && recentlyPlayed.size > 0 && !useRecentActivity) {
    const reason = sport === "NFL"
      ? "NFL activity feeds do not reliably include every required roster position"
      : `only ${Math.round(recentCoverage * 100)}% of this slate appears in the available history`;
    console.log(`[Inactive Filter] ${sport}: Skipping recently-played filter because ${reason}`);
  }
  for (const p of players) {
    if (isPlayerOut(p.injuryStatus) || p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") continue;

    if (zeroPointNames.has(p.name.toLowerCase())) {
      inactiveIds.push(p.id);
      zeroPointCount++;
      continue;
    }

    if (useRecentActivity) {
      const normalized = normalizePlayerName(p.name);
      if (!recentlyPlayed!.has(normalized)) {
        inactiveIds.push(p.id);
        notRecentCount++;
        continue;
      }
    }
  }

  if (inactiveIds.length > 0) {
    console.log(`[Inactive Filter] ${sport}: Excluded ${inactiveIds.length} players (${zeroPointCount} zero-point, ${notRecentCount} not played in last 7 days)`);
  }

  return { inactiveIds, zeroPointCount };
}

function normalizeGameKey(gameInfo: string | null | undefined): string {
  return sanitizeGameInfo(gameInfo)
    .replace(/[·|-]?\s*\d{1,2}:\d{2}\s*(AM|PM)\s*ET.*$/i, "")
    .trim()
    .toUpperCase();
}

function isBringBackCandidate(position: string): boolean {
  const positions = position.toUpperCase().split("/");
  return positions.includes("RB") || positions.includes("WR") || positions.includes("TE");
}

function isDefense(position: string): boolean {
  const positions = position.toUpperCase().split("/");
  return positions.includes("DST") || positions.includes("DEF");
}

function nflTournamentScore(player: Player, ownership: number | undefined): number {
  const projection = Math.max(0, Number(player.projectedPoints) || 0);
  const primaryPosition = player.position.toUpperCase().split("/")[0];
  const ceilingMultipliers: Record<string, number> = {
    QB: 0.10,
    RB: 0.16,
    WR: 0.22,
    TE: 0.20,
    DST: 0.18,
    DEF: 0.18,
  };
  const ceilingBonus = projection * (ceilingMultipliers[primaryPosition] || 0.12);

  // Keep median projection dominant while rewarding comparable lower-owned plays.
  // The logarithm limits the penalty on legitimate high-projection chalk.
  const ownershipPenalty = ownership == null
    ? 0
    : Math.log1p(Math.max(0, ownership)) * 0.72;

  return projection + ceilingBonus - ownershipPenalty;
}

export function solveLineup(
  pool: Player[],
  constraints: OptimizationConstraints & {
    nflPortfolioLineupPolicy?: NflPortfolioLineupPolicy;
    stackGameKeys?: string[];
    stackAlternatives?: SimStackAlternative[];
    maxSalary?: number;
    minSalary?: number;
  },
  sport: string,
  platform: Platform,
  ownershipByPlayerId?: Map<number, number>,
  solverBudget?: SolverBudget,
) {
  const config = getPlatformConfig(sport, platform);
  const contestType = (constraints as any).contestType || "cash";
  const isNFLClassic =
    sport.toUpperCase() === "NFL" &&
    config.rosterSize === 9 &&
    config.slots.includes("FLEX");
  const flexAllowedPositions = isNFLClassic && constraints.flexAllowedPositions?.length
    ? constraints.flexAllowedPositions
    : undefined;
  const disallowedFlexPositions = flexAllowedPositions
    ? (["RB", "WR", "TE"] as const).filter(position => !flexAllowedPositions.includes(position))
    : [];
  const practiceSquadPlayers = pool.filter(
    p => p.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL,
  );
  const lockedPracticeSquad = practiceSquadPlayers.filter(
    p => constraints.lockedPlayerIds.includes(p.id),
  );
  if (lockedPracticeSquad.length > 0) {
    return {
      error: `Locked player ${lockedPracticeSquad[0].name} is on an ESPN practice squad and cannot be used.`,
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
    };
  }
  const golfMissedCutPlayers = pool.filter(p => isGolfMissedCutMarker(p.injuryDetail));
  const lockedGolfMissedCut = golfMissedCutPlayers.filter(
    p => constraints.lockedPlayerIds.includes(p.id),
  );
  if (lockedGolfMissedCut.length > 0) {
    return {
      error: `Locked player ${lockedGolfMissedCut[0].name} has missed the golf cut and cannot be used.`,
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
    };
  }

  const lockedMinProjectionViolation = findLockedMinProjectionViolation(
    pool,
    constraints.minProjection,
    constraints.lockedPlayerIds,
  );
  if (lockedMinProjectionViolation) {
    return {
      error: minProjectionLockMessage(lockedMinProjectionViolation),
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
    };
  }

  // This is a hard exclusion independent of user exclusions, custom
  // projections, or lock state.  An unlocked marker is simply omitted;
  // a locked marker above is an explicit infeasibility error.
  const cutoffPool = filterByMinProjection(pool, constraints.minProjection);
  const availablePool = cutoffPool.filter(
    p => !constraints.excludedPlayerIds.includes(p.id) &&
      p.injuryDetail !== NFL_PRACTICE_SQUAD_DETAIL &&
      !isGolfMissedCutMarker(p.injuryDetail),
  );
  const requiredPositionMessage = minProjectionRequiredPositionMessage(
    availablePool,
    constraints.minProjection,
    config.positionConstraints,
  );
  if (requiredPositionMessage) {
    return {
      error: requiredPositionMessage,
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
    };
  }

  // The model represents FLEX through aggregate position counts rather than
  // explicit slot variables.  Restricting FLEX therefore means capping each
  // disallowed position at its required base-slot count: required RB/WR/TE
  // players remain eligible, while no additional player of that position can
  // occupy FLEX.  Do not filter these players from the pool because their
  // base slots are still required.
  const flexPositionMaxConstraints = disallowedFlexPositions.map(position => {
    const positionConstraint = config.positionConstraints[position];
    const baseSlots = positionConstraint?.equal ?? positionConstraint?.min ?? 0;
    const lockedCount = availablePool.filter(
      p => constraints.lockedPlayerIds.includes(p.id) &&
        p.position.toUpperCase().split("/").some(candidate => candidate.trim() === position),
    ).length;
    return {
      position,
      baseSlots,
      lockedCount,
      constraintName: `nfl_flex_max_${position}`,
    };
  });
  const infeasibleFlexRestriction = flexPositionMaxConstraints.find(
    restriction => restriction.lockedCount > restriction.baseSlots,
  );
  if (infeasibleFlexRestriction) {
    const { position, lockedCount, baseSlots } = infeasibleFlexRestriction;
    return {
      error: `FLEX restriction allows at most ${baseSlots} ${position} base slot${baseSlots === 1 ? "" : "s"}, but ${lockedCount} locked ${position} players were requested.`,
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
    };
  }

  const availableGameCount = new Set(
    availablePool.map(p => normalizeGameKey(p.gameInfo)).filter(Boolean),
  ).size;
  const isNflClassicGpp =
    sport.toUpperCase() === "NFL" &&
    contestType === "gpp" &&
    config.rosterSize === 9 &&
    availableGameCount >= 4;
  
  const model: any = {
    optimize: isNflClassicGpp ? "tournamentScore" : "projectedPoints",
    opType: "max",
    constraints: {
      salary: {
        max: constraints.nflPortfolio?.enabled ? Math.min(constraints.totalMaxSalary ?? config.salaryCap, constraints.maxSalary ?? config.salaryCap) : constraints.maxSalary || config.salaryCap,
        ...(constraints.nflPortfolio?.enabled && constraints.totalMinSalary !== undefined ? { min: constraints.totalMinSalary } : constraints.minSalary ? { min: constraints.minSalary } : {}),
      },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints: {}
  };

  if (constraints.projectedPointsFloor && constraints.projectedPointsFloor > 0) {
    model.constraints.projectedPoints = { min: constraints.projectedPointsFloor };
  }

  for (const [key, constraint] of Object.entries(config.positionConstraints)) {
    model.constraints[key] = constraint;
  }
  if (config.aggregateConstraints) {
    for (const [key, constraint] of Object.entries(config.aggregateConstraints)) {
      model.constraints[key] = constraint;
    }
  }
  for (const { constraintName, baseSlots } of flexPositionMaxConstraints) {
    model.constraints[constraintName] = { max: baseSlots };
  }

  const gameMap = new Map<string, string[]>();

  availablePool.forEach(p => {
    if (constraints.excludedPlayerIds.includes(p.id)) return;

    const isLocked = constraints.lockedPlayerIds.includes(p.id);
    const variableName = `p${p.id}`;
    
    const rawProjectedPoints = Number(p.projectedPoints);
    let projectedPoints = rawProjectedPoints;
    if (contestType === "cash") {
      const fppg = Number((p as any).fppg) || projectedPoints;
      if (fppg > 0 && projectedPoints >= fppg) {
        projectedPoints = projectedPoints * 1.03;
      }
    } else if (contestType === "gpp") {
      if (projectedPoints >= 30) projectedPoints = projectedPoints * 1.12;
      else if (projectedPoints >= 20) projectedPoints = projectedPoints * 1.06;
      else if (projectedPoints > 0) projectedPoints = projectedPoints * 1.02;
    }
    
    const variable: any = {
      projectedPoints,
      ...(isNflClassicGpp
        ? { tournamentScore: nflTournamentScore(p, ownershipByPlayerId?.get(p.id)) }
        : {}),
      salary: p.salary,
      rosterSize: 1,
      ...buildPositionVariables(p.position, sport),
    };
    for (const { position, constraintName } of flexPositionMaxConstraints) {
      if (variable[position]) variable[constraintName] = 1;
    }

    model.variables[variableName] = variable;
    model.ints[variableName] = 1;

    model.constraints[`bound_${variableName}`] = { max: 1 };
    variable[`bound_${variableName}`] = 1;

    if (isLocked) {
      model.constraints[`lock_${variableName}`] = { equal: 1 };
      variable[`lock_${variableName}`] = 1;
    }

    const gameKey = normalizeGameKey(p.gameInfo);
    if (gameKey) {
      if (!gameMap.has(gameKey)) gameMap.set(gameKey, []);
      gameMap.get(gameKey)!.push(variableName);
    }
  });

  const gameKeys = Array.from(gameMap.keys());
  const portfolioPolicy = constraints.nflPortfolio?.enabled && isNFLClassic && platform === "draftkings" && contestType === "gpp"
    ? constraints.nflPortfolioLineupPolicy : undefined;
  if (portfolioPolicy) {
    addNflPortfolioConstraints(model, availablePool, portfolioPolicy, ownershipByPlayerId);
    const playerAlternatives = constraints.stackAlternatives?.flatMap(choice => choice.kind === "players" ? [choice] :
      availablePool.filter(p => p.position.split("/").includes("QB") && getStackGameKey(p.gameInfo) === choice.gameKey)
        .map(qb => ({ kind: "players" as const, playerIds: [qb.id] })));
    if (playerAlternatives?.length) addSimStackAlternatives(model, availablePool, playerAlternatives, sport);
  } else if (constraints.stackAlternatives?.length) {
    addNFLQuarterbackStacks(model, availablePool, sport);
    addSimStackAlternatives(model, availablePool, constraints.stackAlternatives, sport);
  } else {
    addNFLQuarterbackStacks(model, availablePool, sport);
    addSimGameStacks(model, availablePool, constraints.stackGameKeys ?? [], sport);
  }

  if (isNflClassicGpp || portfolioPolicy) {
    const selectablePlayers = availablePool.filter(p => model.variables[`p${p.id}`]);
    const quarterbacks = selectablePlayers.filter(p => p.position.toUpperCase().split("/").includes("QB"));

    for (const qb of quarterbacks) {
      const qbVariable = `p${qb.id}`;
      const opponent = (qb.opponent || "").trim().toUpperCase();
      const bringBacks = opponent
        ? selectablePlayers.filter(
            p => p.team.trim().toUpperCase() === opponent && isBringBackCandidate(p.position),
          )
        : [];
      if (!portfolioPolicy && bringBacks.length > 0) {
        const bringBackConstraint = `nfl_bringback_qb_${qb.id}`;
        model.constraints[bringBackConstraint] = { max: 0 };
        model.variables[qbVariable][bringBackConstraint] = 1;
        for (const opponentPlayer of bringBacks) {
          model.variables[`p${opponentPlayer.id}`][bringBackConstraint] = -1;
        }
      }

      const opposingDefenses = opponent
        ? selectablePlayers.filter(
            p => p.team.trim().toUpperCase() === opponent && isDefense(p.position),
          )
        : [];
      for (const defense of opposingDefenses) {
        const conflictConstraint = `nfl_qb_dst_conflict_${qb.id}_${defense.id}`;
        model.constraints[conflictConstraint] = { max: 1 };
        model.variables[qbVariable][conflictConstraint] = 1;
        model.variables[`p${defense.id}`][conflictConstraint] = 1;
      }
    }
  }

  if (gameKeys.length >= 2) {
    model.constraints["minGames"] = { min: 2 };
    let gi = 0;
    for (const [gameKey, playerVars] of gameMap.entries()) {
      const indicatorName = `game_${gi}`;
      model.variables[indicatorName] = { minGames: 1 };
      model.ints[indicatorName] = 1;
      model.constraints[`bound_${indicatorName}`] = { max: 1 };
      model.variables[indicatorName][`bound_${indicatorName}`] = 1;
      const linkName = `gamelink_${gi}`;
      model.constraints[linkName] = { max: 0 };
      model.variables[indicatorName][linkName] = -config.rosterSize;
      for (const pv of playerVars) {
        model.variables[pv][linkName] = 1;
      }
      gi++;
    }
  }

  const guardedSolve = solveWithBudget(model, solverBudget);
  const result = validatedIntegralResult(guardedSolve.result, model);
  let solveTimedOut = guardedSolve.timedOut;

  if (!result) {
    return {
      error: guardedSolve.timedOut
        ? "Solver timed out before finding a validated feasible lineup."
        : "Could not find a feasible lineup with these constraints.",
      lineup: [],
      totalSalary: 0,
      totalProjectedPoints: 0,
      timedOut: guardedSolve.timedOut,
      solveTimeMs: guardedSolve.elapsedMs,
    };
  }

  const selectedPlayerIds = Object.keys(result)
    .filter(k => k.startsWith('p') && result[k] > 0.5)
    .map(k => Number(k.substring(1)));
  const stackChoiceIndex = constraints.stackAlternatives?.length
    ? Object.keys(result)
      .map(key => key.match(/^sim_stack_(\d+)$/))
      .find(match => match && result[match[0]] > 0.5)?.[1]
    : undefined;

  let selectedPlayers = availablePool.filter(p => selectedPlayerIds.includes(p.id));

  if (selectedPlayers.length !== config.rosterSize) {
    return { error: `Roster size mismatch: got ${selectedPlayers.length}, need ${config.rosterSize}`, lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }

  if (gameKeys.length >= 2) {
    const selectedGames = new Set<string>();
    for (const p of selectedPlayers) {
      const gk = normalizeGameKey(p.gameInfo);
      if (gk) selectedGames.add(gk);
    }
    let satisfiesGameConstraint = selectedGames.size >= 2;
    if (selectedGames.size < 2) {
      const retryModel = JSON.parse(JSON.stringify(model));
      const maxFromAnyGame = config.rosterSize - 1;
      for (const [gameKey, playerVars] of gameMap.entries()) {
        const capName = `cap_game_${gameKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
        retryModel.constraints[capName] = { max: maxFromAnyGame };
        for (const pv of playerVars) {
          if (retryModel.variables[pv]) {
            retryModel.variables[pv][capName] = 1;
          }
        }
      }
      const retryBudget = solverBudget
        ? { ...solverBudget, timeoutMs: Math.min(solverBudget.timeoutMs ?? guardedSolve.timeoutMs, remainingSolverTime(solverBudget)) }
        : undefined;
      const guardedRetry = solveWithBudget(retryModel, retryBudget);
      const retryResult = validatedIntegralResult(guardedRetry.result, retryModel);
      solveTimedOut = solveTimedOut || guardedRetry.timedOut;
      if (guardedRetry.timedOut) {
        // Keep the first incumbent only if it already passed validation;
        // otherwise the caller receives the explicit timeout error below.
        if (!retryResult) {
          return {
            error: "Solver timed out before the minimum two-game lineup constraint could be validated.",
            lineup: [],
            totalSalary: 0,
            totalProjectedPoints: 0,
            timedOut: true,
            solveTimeMs: guardedRetry.elapsedMs,
          };
        }
      }
      if (retryResult) {
        const retryIds = Object.keys(retryResult)
          .filter(k => k.startsWith('p') && retryResult[k] > 0.5)
          .map(k => Number(k.substring(1)));
        const retryPlayers = pool.filter(p => retryIds.includes(p.id));
        if (retryPlayers.length === config.rosterSize) {
          const retryGames = new Set<string>();
          for (const p of retryPlayers) {
            const gk = normalizeGameKey(p.gameInfo);
            if (gk) retryGames.add(gk);
          }
          if (retryGames.size >= 2) {
            selectedPlayers = retryPlayers;
            satisfiesGameConstraint = true;
          }
        }
      }
      if (!satisfiesGameConstraint) {
        return {
          error: "Could not validate the minimum two-game lineup constraint.",
          lineup: [],
          totalSalary: 0,
          totalProjectedPoints: 0,
        };
      }
    }
  }

  const slotAssignment = assignPlayersToSlots(selectedPlayers, config.slots, sport);
  const assignedCount = Object.values(slotAssignment).filter(Boolean).length;
  if (assignedCount < config.rosterSize) {
    return { error: "Could not assign all players to valid roster positions. Try adjusting your player pool.", lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }

  const totalSalary = selectedPlayers.reduce((sum, p) => sum + p.salary, 0);
  const totalPoints = selectedPlayers.reduce((sum, p) => sum + Number(p.projectedPoints), 0);

  return {
    lineup: selectedPlayers,
    totalSalary,
    totalProjectedPoints: totalPoints,
    stackChoiceIndex: stackChoiceIndex == null ? undefined : Number(stackChoiceIndex),
    timedOut: solveTimedOut,
    solveTimeMs: guardedSolve.elapsedMs,
  };
}

export async function seedDatabase(forceRefresh = false) {
  if (forceRefresh) {
    console.log("[Seed] Force refresh requested; preserving slate and lineup references while updating data in place");
  }

  let existingSlates = await storage.getSlates();
  let liveData = new Map<string, any>();
  try {
    liveData = await fetchAllSportsLiveData();
    for (const [sport, data] of Array.from(liveData.entries())) {
      console.log(`[DK] Live ${sport}: ${data.dkPlayers.length} DK players, ${data.games.length} games`);
    }
  } catch (err) {
    console.error("[DK] Error fetching live data:", err);
  }

  const sportSeeds = ["NHL", "MLB", "NFL", "GOLF", "SOCCER"].map(sport => {
    const live = liveData.get(sport);
    if (live && live.dkPlayers.length > 0) {
      return {
        sport,
        dkSlate: {
          name: live.label || (sport === "SOCCER" ? "Soccer Main Slate" : `${sport} Main Slate`),
          label: live.label,
          startTime: live.slateDate,
          isMain: true,
          gameType: live.gameType || "Classic",
          gameCount: live.gameCount || live.games.length,
          contestCount: live.contestId ? 1 : 0,
        },
        dkPlayers: live.dkPlayers,
        draftGroupId: live.draftGroupId,
      };
    }
    console.log(`[DK] ${sport}: No live DK data available, skipping`);
    return null;
  }).filter(Boolean) as any[];

  const duplicateClassicMainIds: number[] = [];
  for (const seed of sportSeeds) {
    const activeMains = existingSlates
      .filter(s =>
        s.sport === seed.sport &&
        s.platform === "draftkings" &&
        s.isActive !== false &&
        s.isMain &&
        s.gameType?.toLowerCase() !== "showdown"
      )
      .sort((a, b) => {
        const aMatchesLive = a.draftGroupId === seed.draftGroupId ? 1 : 0;
        const bMatchesLive = b.draftGroupId === seed.draftGroupId ? 1 : 0;
        return bMatchesLive - aMatchesLive || b.id - a.id;
      });
    duplicateClassicMainIds.push(...activeMains.slice(1).map(s => s.id));
  }
  if (duplicateClassicMainIds.length > 0) {
    await db.update(slates)
      .set({ isActive: false, isMain: false })
      .where(inArray(slates.id, duplicateClassicMainIds));
    console.log(`[Seed] Deactivated ${duplicateClassicMainIds.length} duplicate DraftKings classic main slates`);
    existingSlates = await storage.getSlates();
  }

  for (const seed of sportSeeds) {
    let existingSlate = existingSlates.find(
      s =>
        s.sport === seed.sport &&
        s.platform === "draftkings" &&
        s.isMain &&
        s.gameType?.toLowerCase() !== "showdown"
    );
    const targetSlate = existingSlates.find(
      s =>
        s.sport === seed.sport &&
        s.platform === "draftkings" &&
        s.draftGroupId === seed.draftGroupId &&
        s.isActive !== false &&
        s.gameType?.toLowerCase() !== "showdown"
    ) || existingSlates.find(
      s =>
        s.sport === seed.sport &&
        s.platform === "draftkings" &&
        s.draftGroupId === seed.draftGroupId &&
        s.gameType?.toLowerCase() !== "showdown"
    );

    const mainTransition = reconcileClassicMainIdentity(
      [existingSlate, targetSlate]
        .filter((slate, index, all): slate is NonNullable<typeof slate> =>
          Boolean(slate) && all.findIndex(candidate => candidate?.id === slate?.id) === index,
        )
        .map(slate => ({
          id: slate.id,
          draftGroupId: slate.draftGroupId,
          isMain: slate.isMain,
        })),
      seed.draftGroupId,
    );

    // DraftKings can publish a new featured group on the same ET calendar day
    // as an existing extended/alternate group.  Main status is an identity
    // decision, not a date rollover decision: promote the exact target group
    // when it is already imported, or demote the wrong main and create the
    // featured group below.  Never delete the old rows here; saved lineups
    // retain their original slate and player IDs.
    if (mainTransition.promoteSlateId !== null && targetSlate) {
      if (mainTransition.demoteSlateId !== null) {
        await db.update(slates)
          .set({ isMain: false })
          .where(eq(slates.id, mainTransition.demoteSlateId));
        if (existingSlate?.id === mainTransition.demoteSlateId) existingSlate.isMain = false;
        console.log(`[DK] Demoted wrong ${seed.sport} main slate ${mainTransition.demoteSlateId}`);
      }
      await db.update(slates)
        .set({ isMain: true, isActive: true })
        .where(eq(slates.id, mainTransition.promoteSlateId));
      targetSlate.isMain = true;
      targetSlate.isActive = true;
      existingSlate = targetSlate;
      console.log(`[DK] Promoted ${seed.sport} featured slate ${targetSlate.id} (DG ${seed.draftGroupId})`);
    } else if (mainTransition.createTarget && mainTransition.demoteSlateId !== null) {
      await db.update(slates)
        .set({ isMain: false })
        .where(eq(slates.id, mainTransition.demoteSlateId));
      if (existingSlate?.id === mainTransition.demoteSlateId) existingSlate.isMain = false;
      console.log(`[DK] Demoted wrong ${seed.sport} main slate ${mainTransition.demoteSlateId}; creating DG ${seed.draftGroupId}`);
      existingSlate = undefined;
    }

    const now = new Date();
    let isStale = false;
    let existingPlayerCount = 0;
    const draftGroupChanged = existingSlate && seed.draftGroupId && existingSlate.draftGroupId !== seed.draftGroupId;
    if (existingSlate) {
      const slatePlayers = await storage.getPlayersBySlate(existingSlate.id);
      existingPlayerCount = slatePlayers.length;
      // New DraftKings rows carry the exact competition timestamp. Prefer
      // them so an older row without a persisted cross-day date cannot expire
      // a Sun-Mon slate on Sunday night.
      const lifecyclePlayers = !draftGroupChanged && seed.dkPlayers.length > 0
        ? seed.dkPlayers
        : slatePlayers;
      const latestGameStart = getLatestGameStart(existingSlate, lifecyclePlayers as any);

      const STALE_BUFFER_MS = 3 * 3600000;
      isStale = (latestGameStart.getTime() + STALE_BUFFER_MS) < now.getTime();
      if (!isStale && new Date(existingSlate.startTime) < now) {
        console.log(`[DK] ${seed.sport} slate still active — last game at ${latestGameStart.toISOString()}, not stale until ${new Date(latestGameStart.getTime() + STALE_BUFFER_MS).toISOString()}`);
      }
    }
    if (draftGroupChanged && !isStale) {
      console.log(`[DK] ${seed.sport} draft group changed (${existingSlate!.draftGroupId} → ${seed.draftGroupId}) but current slate still active — skipping replacement`);
    }

    if (existingSlate && !isStale && existingSlate.isActive === false) {
      await db.update(slates).set({ isActive: true }).where(eq(slates.id, existingSlate.id));
      existingSlate.isActive = true;
      console.log(`[DK] Reactivated ongoing ${seed.sport} slate ${existingSlate.id}`);
    }

    const shouldReplace =
      isStale;

    if (shouldReplace) {
      await storage.deleteSlateAndPlayers(existingSlate!.id);
      console.log(`[DK] Removed ${draftGroupChanged ? "outdated" : "stale"} ${seed.sport} slate (DG ${existingSlate!.draftGroupId} → ${seed.draftGroupId})`);
    }

    if (existingSlate && !shouldReplace && existingPlayerCount > 0) {
      if ((forceRefresh || seed.sport === "NFL") && !draftGroupChanged) {
        await storage.updateSlateData(existingSlate.id, {
          name: seed.dkSlate.name!,
          label: seed.dkSlate.label,
          startTime: seed.dkSlate.startTime!,
          draftGroupId: seed.draftGroupId || null,
          gameType: seed.dkSlate.gameType || "Classic",
          gameCount: seed.dkSlate.gameCount || 0,
          contestCount: seed.dkSlate.contestCount || 0,
        });
        const refreshed = await storage.refreshPlayersByDraftKingsId(
          existingSlate.id,
          seed.dkPlayers.map((player: any) => ({ ...player, slateId: existingSlate.id })) as any,
        );
        console.log(`[DK] Refreshed ${refreshed.updated}, inserted ${refreshed.inserted}, and retired ${refreshed.retired} ${seed.sport} players in place for slate ${existingSlate.id}`);
      }
      continue;
    }

    if (existingSlate && !shouldReplace && existingPlayerCount === 0 && seed.dkPlayers.length > 0) {
      const { oldIdToDkId } = await storage.deletePlayersBySlate(existingSlate.id);
      const updatedSlate = await storage.updateSlateData(existingSlate.id, {
        name: seed.dkSlate.name!,
        startTime: seed.dkSlate.startTime!,
        draftGroupId: seed.draftGroupId || null,
      });
      const createdPlayers = await storage.bulkCreatePlayers(
        seed.dkPlayers.map((p: any) => ({ ...p, slateId: existingSlate.id })) as any
      );
      const migratedOverrides = await storage.migratePlayerOverrides(existingSlate.id, oldIdToDkId);
      if (migratedOverrides > 0) console.log(`[DK] Migrated ${migratedOverrides} player overrides for ${seed.sport} slate ${existingSlate.id}`);
      console.log(`[DK] Repopulated empty ${seed.sport} slate ${existingSlate.id} with ${createdPlayers.length} players`);

      const today = getEasternToday();
      try {
        const historyRecords = createdPlayers.map(p => ({
          playerName: p.name,
          team: p.team,
          sport: seed.sport,
          position: p.position,
          salary: p.salary,
          projectedPoints: p.projectedPoints,
          slateDate: today,
          slateId: existingSlate.id,
          draftKingsPlayerId: p.draftKingsPlayerId,
        }));
        await storage.bulkInsertPlayerHistory(historyRecords);
        console.log(`[History] Saved ${historyRecords.length} ${seed.sport} player snapshots`);
      } catch (err) {
        console.error(`[History] Failed to save ${seed.sport} snapshots:`, err);
      }
      continue;
    }

    const slateWasRemoved = shouldReplace && existingSlate;
    const staleSlateStillExists = slateWasRemoved && (await storage.getSlate(existingSlate?.id as number)) !== undefined;

    if (staleSlateStillExists) {
      await db.update(slates)
        .set({ isActive: false, isMain: false })
        .where(eq(slates.id, existingSlate!.id));
      console.log(`[DK] Preserved stale ${seed.sport} slate ${existingSlate!.id} for saved lineup history`);
    }

    if (!existingSlate || shouldReplace) {
      const dkSlate = await storage.createSlate({
        sport: seed.sport,
        platform: "draftkings",
        name: seed.dkSlate.name!,
        label: seed.dkSlate.label,
        startTime: seed.dkSlate.startTime!,
        isMain: true,
        draftGroupId: seed.draftGroupId || null,
        gameType: seed.dkSlate.gameType || "Classic",
        gameCount: seed.dkSlate.gameCount || 0,
        contestCount: seed.dkSlate.contestCount || 0,
      });
      const createdPlayers = await storage.bulkCreatePlayers(
        seed.dkPlayers.map((p: any) => ({ ...p, slateId: dkSlate.id })) as any
      );

      const today = getEasternToday();
      try {
        const historyRecords = createdPlayers.map(p => ({
          playerName: p.name,
          team: p.team,
          sport: seed.sport,
          position: p.position,
          salary: p.salary,
          projectedPoints: p.projectedPoints,
          slateDate: today,
          slateId: dkSlate.id,
          draftKingsPlayerId: p.draftKingsPlayerId,
        }));
        await storage.bulkInsertPlayerHistory(historyRecords);
        console.log(`[History] Saved ${historyRecords.length} ${seed.sport} player snapshots`);
      } catch (err) {
        console.error(`[History] Failed to save ${seed.sport} snapshots:`, err);
      }

      console.log(`Seeded database with DK ${seed.sport} main slate (LIVE DK)`);
    } else if (existingSlate && seed.dkPlayers.length > 0) {
      const existingPlayers = await storage.getPlayersBySlate(existingSlate.id);
      const needsDraftGroupId = !existingSlate.draftGroupId && seed.draftGroupId;

      if (needsDraftGroupId) {
        await storage.updateSlateDraftGroupId(existingSlate.id, seed.draftGroupId);
        console.log(`[DK] Updated ${seed.sport} slate draftGroupId to ${seed.draftGroupId}`);
      }

      if (existingPlayers.length === 0) {
        const createdPlayers = await storage.bulkCreatePlayers(
          seed.dkPlayers.map((p: any) => ({ ...p, slateId: existingSlate.id })) as any
        );
        console.log(`[DK] Inserted ${createdPlayers.length} ${seed.sport} players with DK IDs (slate had 0 players)`);
      } else {
        const missingDkIds = existingPlayers.filter(p => !p.draftKingsPlayerId);
        if (missingDkIds.length > 0) {
          let updatedCount = 0;
          for (const existing of missingDkIds) {
            const match = seed.dkPlayers.find((p: any) =>
              p.name === existing.name && p.team === existing.team
            );
            if (match?.draftKingsPlayerId) {
              await storage.updatePlayerDraftKingsId(existing.id, match.draftKingsPlayerId);
              updatedCount++;
            }
          }
          console.log(`[DK] Updated ${updatedCount}/${missingDkIds.length} ${seed.sport} players with DK IDs`);
        }
      }
    }
  }

  // Showdown contests are separate DraftKings draft groups from classic slates.
  // Keep every one of today's NFL single-game slates available to the Showdown
  // Builder without replacing the upcoming Sunday main slate used by the
  // regular optimizer.
  try {
    const todayShowdowns = await fetchAvailableDKShowdowns("NFL");
    const currentShowdowns = (await storage.getSlates()).filter(
      s => s.sport === "NFL" && s.platform === "draftkings" && s.gameType === "Showdown",
    );

    for (const showdown of todayShowdowns) {
      const showdownData = await fetchDKSlateByDraftGroup("NFL", showdown.draftGroupId, {
        showdown: true,
        startTime: showdown.startTime,
      });
      if (showdownData && showdownData.dkPlayers.length > 0) {
        const existing = currentShowdowns.find(s => s.draftGroupId === showdown.draftGroupId);
        const gameLabel = showdownData.games[0]
          ? `${showdownData.games[0].away}@${showdownData.games[0].home}`
          : "Single Game";
        const startLabel = parseEasternTime(showdown.startTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
          timeZoneName: "short",
        });
        const variantLabel = showdown.contestStartTimeSuffix?.trim();
        const showdownLabel = `NFL Showdown — ${gameLabel} · ${startLabel}${variantLabel ? ` ${variantLabel}` : ""}`;

        if (existing) {
          await db.update(slates)
            .set({
              name: showdownLabel,
              label: showdownLabel,
              startTime: showdownData.slateDate,
              isMain: false,
              isActive: true,
              gameCount: showdownData.games.length,
              contestCount: showdown.contestCount,
            })
            .where(eq(slates.id, existing.id));
          existing.isMain = false;
          existing.isActive = true;
          existing.name = showdownLabel;
          existing.label = showdownLabel;
        }
        const existingPlayers = existing ? await storage.getPlayersBySlate(existing.id) : [];
        const needsProjectionRefresh = existingPlayers.some(player =>
          player.salary <= 6000 && Number(player.projectedPoints) > 20,
        );

        if (!existing || existingPlayers.length === 0 || needsProjectionRefresh) {
          let showdownSlate = existing;

          if (!showdownSlate) {
            showdownSlate = await storage.createSlate({
              sport: "NFL",
              platform: "draftkings",
              name: showdownLabel,
              label: showdownLabel,
              startTime: showdownData.slateDate,
              isMain: false,
              draftGroupId: showdown.draftGroupId,
              gameType: "Showdown",
              gameCount: showdownData.games.length,
              salaryCap: 50000,
            });
          }
          if (existingPlayers.length > 0) {
            const refreshed = await storage.refreshPlayersByDraftKingsId(
              showdownSlate.id,
              showdownData.dkPlayers.map(player => ({ ...player, slateId: showdownSlate.id })),
            );
            console.log(`[DK] Refreshed ${refreshed.updated}, inserted ${refreshed.inserted}, and retired ${refreshed.retired} NFL Showdown players in place`);
          } else {
            await storage.bulkCreatePlayers(
              showdownData.dkPlayers.map(player => ({ ...player, slateId: showdownSlate.id })),
            );
          }
          console.log(`[DK] Seeded today's NFL Showdown ${gameLabel} with ${showdownData.dkPlayers.length} players`);
        }
      }
    }
  } catch (err) {
    console.error("[DK] Failed to seed today's NFL Showdown slates:", err);
  }

  const refreshedSlates = await storage.getSlates();
  for (const sport of ACTIVE_SPORTS) {
    try {
      const availableSlates = await fetchAvailableDKSlates(sport);
      if (availableSlates.length <= 1) continue;

      const existingDkSlates = refreshedSlates.filter(
        s => s.sport === sport && s.platform === "draftkings" && s.isActive !== false
      );
      const existingDgIds = new Set(existingDkSlates.map(s => s.draftGroupId).filter(Boolean));

      for (const avSlate of availableSlates) {
        if (existingDgIds.has(avSlate.draftGroupId)) {
          const existing = existingDkSlates.find(s => s.draftGroupId === avSlate.draftGroupId);
          if (existing) {
            const players = await storage.getPlayersBySlate(existing.id);
            if (players.length > 0 && sport !== "NFL") continue;
          }
        }

        const mainSlateForSport = existingDkSlates.find(
          s => s.isMain && s.gameType?.toLowerCase() !== "showdown",
        );
        const isMain = mainSlateForSport?.draftGroupId === avSlate.draftGroupId;
        if (isMain) continue;

        try {
          const slateData = await fetchDKSlateByDraftGroup(sport, avSlate.draftGroupId, {
            startTime: avSlate.startTime,
          });
          if (!slateData || slateData.dkPlayers.length === 0) {
            console.log(`[DK] No draftables for ${sport} alt slate DG ${avSlate.draftGroupId}`);
            continue;
          }

          const existingEntry = existingDkSlates.find(s => s.draftGroupId === avSlate.draftGroupId);
          let slateId: number;

          if (existingEntry) {
            await storage.updateSlateData(existingEntry.id, {
              name: avSlate.label,
              label: avSlate.label,
              startTime: slateData.slateDate ? new Date(slateData.slateDate) : undefined,
              gameType: "Classic",
              gameCount: avSlate.gameCount,
              contestCount: avSlate.contestCount,
            });
            slateId = existingEntry.id;
          } else {
            const newSlate = await storage.createSlate({
              sport,
              platform: "draftkings",
              name: avSlate.label,
              label: avSlate.label,
              startTime: slateData.slateDate || new Date().toISOString(),
              isMain: false,
              draftGroupId: avSlate.draftGroupId,
              gameType: "Classic",
              gameCount: avSlate.gameCount,
              contestCount: avSlate.contestCount,
            });
            slateId = newSlate.id;
          }

          const incomingPlayers = slateData.dkPlayers.map((p: any) => ({ ...p, slateId }));
          if (existingEntry) {
            await storage.refreshPlayersByDraftKingsId(slateId, incomingPlayers);
          } else {
            await storage.bulkCreatePlayers(incomingPlayers);
          }
          const createdPlayers = await storage.getPlayersBySlate(slateId);
          console.log(`[DK] Loaded ${sport} alt slate DG ${avSlate.draftGroupId} (${avSlate.label}) with ${createdPlayers.length} players`);

          const today2 = getEasternToday();
          try {
            const historyRecords = createdPlayers.map(p => ({
              playerName: p.name, team: p.team, sport,
              position: p.position, salary: p.salary,
              projectedPoints: p.projectedPoints,
              slateDate: today2, slateId,
              draftKingsPlayerId: p.draftKingsPlayerId,
            }));
            await storage.bulkInsertPlayerHistory(historyRecords);
          } catch (err) {
            console.error(`[History] Failed to save ${sport} alt slate snapshots:`, err);
          }
        } catch (err) {
          console.error(`[DK] Error loading ${sport} alt slate DG ${avSlate.draftGroupId}:`, err);
        }
      }
    } catch (err) {
      console.error(`[DK] Error discovering ${sport} alt slates:`, err);
    }
  }

  const lifecycleSlates = await storage.getSlates();
  const staleNonMain = lifecycleSlates.filter(
    s => s.platform === "draftkings" && !s.isMain && s.isActive !== false,
  );
  for (const stale of staleNonMain) {
    const stalePlayers = await storage.getPlayersBySlate(stale.id);
    const latestGameStart = getLatestGameStart(stale, stalePlayers);
    if (latestGameStart.getTime() + 3 * 3600000 >= Date.now()) continue;
    await db.update(slates).set({ isActive: false }).where(eq(slates.id, stale.id));
    console.log(`[DK] Deactivated expired alternate slate ${stale.id} after latest game ${latestGameStart.toISOString()}`);
  }

  const today = getEasternToday();
  const existingProps = await storage.getPropsByDate(today);
  if (existingProps.length === 0) {
    await generateDailyProps(today);
    console.log("Generated daily prop bets");
  }

  await generatePlayerBoostsAndInjuries();

  const deactivatedCount = await deactivateExpiredSlates(3);
  if (deactivatedCount > 0) console.log(`[Seed] Deactivated ${deactivatedCount} stale slate(s) after refresh`);
}

export async function generatePlayerBoostsAndInjuries() {
  const allSlates = await storage.getSlates();
  const boostSlates = allSlates.filter(s =>
    s.isActive !== false && (
      (s.platform === "draftkings") ||
      (s.platform !== "draftkings" && s.isMain)
    )
  );

  for (const slate of boostSlates) {
    const allPlayers = await storage.getPlayersBySlate(slate.id);
    const alreadyBoosted = allPlayers.some(p => p.boostScore !== null);
    if (alreadyBoosted) continue;

    const sport = slate.sport;

    try {
      const boosts = await computeBoostScores(allPlayers, sport, slate.id);
      if (boosts.length > 0) await storage.updatePlayerBoosts(slate.id, boosts);
      console.log(`[Boost Engine] ${sport}: computed data-driven boosts for ${boosts.filter(b => Number(b.boostScore) !== 0).length}/${boosts.length} players`);
    } catch (err) {
      console.error(`[Boost Engine] ${sport} error, no boosts applied:`, err);
    }

    console.log(`Generated boosts for ${sport} ${slate.platform}${slate.isMain ? " main" : " alt"} slate`);
  }
}


export async function refreshPlayerStatuses() {
  const allSlates = await storage.getSlates();
  const activeSlates = allSlates.filter(s => s.isMain && s.draftGroupId && new Date(s.startTime) > new Date());

  if (activeSlates.length === 0) {
    console.log("[Status] No active slates with draft groups to refresh");
    return;
  }

  let totalUpdated = 0;
  for (const slate of activeSlates) {
    try {
      const statusMap = await fetchPlayerStatusUpdates(slate.draftGroupId!);
      if (statusMap.size === 0) continue;

      const players = await storage.getPlayersBySlate(slate.id);
      const updates: { playerId: number; injuryStatus: string; injuryDetail: string }[] = [];

      for (const player of players) {
        if (player.injuryDetail === RETIRED_PLAYER_DETAIL) continue;
        // Practice-squad is intentionally a live derived overlay. Persisting
        // it would lose the player's baseline projections before ESPN reports
        // a later active/elevated status.
        if (player.injuryDetail === NFL_PRACTICE_SQUAD_DETAIL) continue;
        // Golf missed-cut status is also derived. Never persist its marker
        // while refreshing DK's ordinary injury/status columns.
        if (isGolfMissedCutMarker(player.injuryDetail)) continue;
        if (!player.draftKingsPlayerId) continue;
        const dkStatus = statusMap.get(player.draftKingsPlayerId);
        if (!dkStatus) continue;

        const { injuryStatus, injuryDetail } = mapDKStatus(dkStatus.status, dkStatus.newsStatus);

        const currentStatus = player.injuryStatus || "Healthy";
        const currentDetail = player.injuryDetail || "";
        if (injuryStatus !== currentStatus || injuryDetail !== currentDetail) {
          updates.push({ playerId: player.id, injuryStatus, injuryDetail });
        }
      }

      if (updates.length > 0) {
        await storage.updatePlayerInjuries(updates);
        totalUpdated += updates.length;
        console.log(`[Status] ${slate.sport}: Updated ${updates.length} player statuses from DK`);
      }
    } catch (err) {
      console.error(`[Status] Failed to refresh ${slate.sport} statuses:`, err);
    }
  }

  if (totalUpdated > 0) {
    await checkInjuryAlerts();
  }

  return totalUpdated;
}

export async function checkInjuryAlerts() {
  const allActiveLineups = await storage.getAllActiveLineups();
  if (allActiveLineups.length === 0) return;

  const slateCache = new Map<number, Slate>();
  const playerCache = new Map<number, Player[]>();

  for (const lineup of allActiveLineups) {
    if (!slateCache.has(lineup.slateId)) {
      const slate = await storage.getSlate(lineup.slateId);
      if (slate) slateCache.set(lineup.slateId, slate);
    }
    if (!playerCache.has(lineup.slateId)) {
      const players = await storage.getPlayersBySlate(lineup.slateId);
      playerCache.set(lineup.slateId, players);
    }

    const slate = slateCache.get(lineup.slateId);
    const allPlayers = playerCache.get(lineup.slateId) || [];
    if (!slate) continue;

    const rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
    const injuredPlayers = rosterPlayers.filter(p => p.injuryStatus && p.injuryStatus !== "Healthy" && p.injuryStatus !== "Probable");

    const newAlerts: InsertAlert[] = [];
    for (const player of injuredPlayers) {
      const severity = isPlayerOut(player.injuryStatus) ? "critical"
        : player.injuryStatus === "Doubtful" ? "warning"
        : "info";

      newAlerts.push({
        userId: lineup.userId,
        lineupId: lineup.id,
        playerId: player.id,
        playerName: player.name,
        sport: slate.sport,
        type: "injury",
        title: `${player.name} - ${player.injuryStatus}`,
        message: `${player.name} (${player.team}) is listed as ${player.injuryStatus}: ${player.injuryDetail || "No details"}. This affects your ${slate.sport} ${slate.platform} lineup.`,
        severity,
        isRead: false,
      });
    }

    if (newAlerts.length > 0) {
      await storage.bulkCreateAlerts(newAlerts);
    }
  }

  app.post("/api/admin/cleanup-review-lineups", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const dbUser = await storage.getUser(userId);
    if (!dbUser?.isAdmin) return res.sendStatus(403);

    const { sport, hoursOld = 2 } = req.body;
    if (!sport) return res.status(400).json({ error: "sport is required" });

    const cutoff = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    const toDelete = await db.select({ id: lineups.id }).from(lineups)
      .where(
        and(
          eq(lineups.status, "review"),
          eq(lineups.sport, sport),
          lt(lineups.reviewedAt, cutoff)
        )
      );

    let deleted = 0;
    for (const row of toDelete) {
      await storage.deleteLineup(row.id);
      deleted++;
    }

    res.json({ deleted, sport, hoursOld });
  });
}
