import type { Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { users, subscriptions, slates, lineups as lineupsTable } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";
import { getPlatformConfig, ACTIVE_SPORTS, assignPlayersToSlots, type Platform } from "@shared/platform-config";
import { computeBoostScores, computeCorrelationBonus, applyCeilingMode, applyLeverageMode, applyActualAdjustedProjections, applyWinningLineupAdjustment } from "./boost-engine";
import { getHistoricalProfile, applyHistoricalAdjustments } from "./historical-adjustments";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}

import { type OptimizationConstraints, type ProOptimizationConstraints, type Player, type Slate, type InsertProp, type InsertAlert, proOptimizationConstraintSchema, insertPrizePicksEntrySchema } from "@shared/schema";
import { fetchAllSportsLiveData, fetchPlayerStatusUpdates, mapDKStatus, fetchLivePlayerStatuses, fetchAvailableDKSlates, fetchDKSlateByDraftGroup, fetchDraftables, isPlayerConfirmedStarter, parseEasternTime, getEasternToday } from "./balldontlie";
import { fetchAllPropsForSport, type ParsedProp } from "./odds-api";
import { getLiveScores, getAllLiveScores, fetchESPNStarters } from "./espn-scores";
import { fetchPrizePicksProjections, getSupportedPPSports, buildAIEntries, analyzeManualPicks, generateProjectionsFromPlayers, getLineMovements } from "./prizepicks";
import { fetchBDLStats, type PlayerStatsMap, normalizeName } from "./balldontlie-stats";
import { refreshRecentlyPlayed, getRecentlyPlayedCache, normalizePlayerName } from "./espn-activity";
import { calculateOwnership, computeOwnershipForPlayers, type ContestType } from "./ownership-engine";
import { getCachedSignals, getScoutStatus, refreshAll, forceRefreshAll, secondsUntilRefresh, triggerLazyRefreshIfStale } from "./ai-scout";
import { runSimulations, detectStack, scoreLineupsAcrossSims } from "./simulation-engine";
import { buildVegasContext } from "./vegas-client";
import { buildDvPContext, applyDvPToProjections, buildOpponentMap } from "./dvp-client";
import { fetchStartingLineups, getStartingLineupsData, clearLineupsCache } from "./lineups-ingest";
import { projectionAccuracyRouter } from "./projection-accuracy-route";


function starRatingMinProjection(starRating: number): number {
  if (starRating <= 1) return 0;
  if (starRating === 2) return 15;
  if (starRating === 3) return 25;
  if (starRating === 4) return 35;
  return 45;
}

const YAHOO_OUT_STATUSES = new Set(["INJ", "O", "OUT", "IR", "SUS", "NA"]);
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

type ScoutSignalMap = Map<string, { signal_type: string; boost_weight: number }>;

function buildScoutMap(sport: string): ScoutSignalMap {
  const signals = getCachedSignals(sport);
  const map: ScoutSignalMap = new Map();
  for (const sig of signals) {
    const key = sig.player_name.toLowerCase();
    const existing = map.get(key);
    if (!existing || Math.abs(sig.boost_weight) > Math.abs(existing.boost_weight)) {
      map.set(key, { signal_type: sig.signal_type, boost_weight: sig.boost_weight });
    }
  }
  return map;
}

function applyScoutToProjection(pts: number, playerName: string, scoutMap: ScoutSignalMap, hasCustomProjection?: boolean): number {
  if (hasCustomProjection) return pts;
  const sig = scoutMap.get(playerName.toLowerCase());
  if (!sig) return pts;
  if (sig.signal_type === "out") return 0;
  const pct = sig.boost_weight * 0.015;
  const clamped = Math.max(-0.15, Math.min(0.15, pct));
  return Math.round(pts * (1 + clamped) * 10) / 10;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get(api.slates.list.path, async (req, res) => {
    try {
      const allSlates = await storage.getSlates();
      const graceCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const active = allSlates
        .filter(s => s.isActive !== false && new Date(s.startTime) > graceCutoff)
        .sort((a, b) => {
          if (a.sport === b.sport && a.platform === b.platform) {
            if (a.isMain && !b.isMain) return -1;
            if (!a.isMain && b.isMain) return 1;
          }
          return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
        })
        .map(s => ({
          ...s,
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
    players = players.filter(p => !isPlayerUnavailable(p.injuryStatus));
    if (slate && isDK) {
      await refreshRecentlyPlayed(slate.sport);
      const { inactiveIds: inactiveIdList } = await getInactivePlayerIds(players, slate.sport);
      const inactiveIds = new Set(inactiveIdList);
      if (inactiveIds.size > 0) {
        players = players.filter(p => !inactiveIds.has(p.id));
      }
    }
    const bdlStats = slate ? await fetchBDLStats(slate.sport) : {};
    const ownershipResults = slate ? await calculateOwnership(players, slate.sport, "gpp_large", bdlStats) : [];
    const playersWithOwnership = computeOwnershipForPlayers(players, ownershipResults);
    res.json(playersWithOwnership);
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

  app.get("/api/player-overrides/:slateId", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not logged in" });
    const dbUser = await storage.getUser(userId);
    if (!dbUser) return res.status(401).json({ message: "User not found" });
    const sub = await storage.getSubscription(userId);
    const isAdmin = dbUser.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier === "free") return res.status(403).json({ message: "Sharpshooter or Champion required" });
    const slateId = parseInt(req.params.slateId);
    if (isNaN(slateId)) return res.status(400).json({ message: "Invalid slate ID" });
    const overrides = await storage.getPlayerOverrides(userId, slateId);
    res.json(overrides);
  });

  const playerOverrideBodySchema = z.object({
    customProjection: z.number().min(0).max(500).nullable().optional(),
    boostPercent: z.number().int().refine(v => [0, 5, 10, 15, 20].includes(v), { message: "Boost must be 0, 5, 10, 15, or 20" }).default(0),
    isExcluded: z.boolean().default(false),
    isLocked: z.boolean().default(false),
    notes: z.string().max(200).nullable().optional(),
  });

  app.put("/api/player-overrides/:slateId/:playerId", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not logged in" });
    const dbUser = await storage.getUser(userId);
    if (!dbUser) return res.status(401).json({ message: "User not found" });
    const sub = await storage.getSubscription(userId);
    const isAdmin = dbUser.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier === "free") return res.status(403).json({ message: "Sharpshooter or Champion required" });
    const slateId = parseInt(req.params.slateId);
    const playerId = parseInt(req.params.playerId);
    if (isNaN(slateId) || isNaN(playerId)) return res.status(400).json({ message: "Invalid IDs" });
    const parsed = playerOverrideBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
    const { customProjection, boostPercent, isExcluded, isLocked, notes } = parsed.data;
    const override = await storage.upsertPlayerOverride({
      userId,
      slateId,
      playerId,
      customProjection: customProjection != null ? customProjection.toString() : null,
      boostPercent: boostPercent || 0,
      isExcluded: isExcluded || false,
      isLocked: isLocked || false,
      notes: notes || null,
    });
    res.json(override);
  });

  app.delete("/api/player-overrides/:slateId/:playerId", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not logged in" });
    const slateId = parseInt(req.params.slateId);
    const playerId = parseInt(req.params.playerId);
    if (isNaN(slateId) || isNaN(playerId)) return res.status(400).json({ message: "Invalid IDs" });
    await storage.deletePlayerOverride(userId, slateId, playerId);
    res.json({ success: true });
  });

  app.delete("/api/player-overrides/:slateId", async (req, res) => {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Not logged in" });
    const slateId = parseInt(req.params.slateId);
    if (isNaN(slateId)) return res.status(400).json({ message: "Invalid slate ID" });
    await storage.deletePlayerOverridesByUser(userId, slateId);
    res.json({ success: true });
  });

  app.post(api.optimizer.optimize.path, async (req, res) => {
    try {
      const constraints = api.optimizer.optimize.input.parse(req.body);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;

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
          userOverrides = await storage.getPlayerOverrides(overrideUserId, constraints.slateId);
        }
      }
      const overrideMap = new Map(userOverrides.map(o => [o.playerId, o]));

      const overrideExcluded = userOverrides.filter(o => o.isExcluded).map(o => o.playerId);
      const overrideLocked = userOverrides.filter(o => o.isLocked).map(o => o.playerId);
      const mergedLocked = [...new Set([...constraints.lockedPlayerIds, ...overrideLocked])];

      const autoExcluded = allPlayers
        .filter(p => isPlayerOut(p.injuryStatus) && !mergedLocked.includes(p.id))
        .map(p => p.id);
      const isDKOpt = slate.platform === "draftkings";
      const { inactiveIds: inactiveExcluded } = isDKOpt ? await getInactivePlayerIds(allPlayers, slate.sport) : { inactiveIds: [] };
      const filteredInactive = inactiveExcluded.filter(id => !mergedLocked.includes(id));
      const mergedExclusions = [...new Set([...constraints.excludedPlayerIds, ...autoExcluded, ...filteredInactive, ...overrideExcluded])];

      const scoutMap = buildScoutMap(slate.sport);
      const useBoosts = constraints.useBoosts !== false;

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
          const boostPct = Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015));
          proj = Math.round(proj * (1 + boostPct) * 10) / 10;
        }
        proj = applyScoutToProjection(proj, p.name, scoutMap, customProj !== undefined);
        if (isPlayerOut(p.injuryStatus)) proj = 0;
        else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") proj = proj * 0.75;
        else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") proj = proj * 0.9;
        return { ...p, projectedPoints: proj.toString() };
      });

      pool = await applyActualAdjustedProjections(pool, slate.sport);
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

      const salaryFilteredPool = (constraints.playerMinSalary || constraints.playerMaxSalary)
        ? pool.filter(p => {
            if (mergedLocked.includes(p.id)) return true;
            if (constraints.playerMinSalary && p.salary < constraints.playerMinSalary) return false;
            if (constraints.playerMaxSalary && p.salary > constraints.playerMaxSalary) return false;
            return true;
          })
        : pool;

      const contestType = constraints.contestType || "cash";
      const result = solveLineup(salaryFilteredPool, { ...constraints, lockedPlayerIds: mergedLocked, excludedPlayerIds: mergedExclusions, contestType }, slate.sport, platform);

      if (result.error) {
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

      res.json({ ...result, platform });

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
    const userId = getSessionUserId(req)!;
    const lineups = await storage.getLineups(userId);

    const slateCache = new Map<number, (Player & { ownershipProjection: number })[]>();
    const slatePlayerIdCache = new Map<number, Set<number>>();
    const bdlCache = new Map<string, PlayerStatsMap>();
    const enriched = await Promise.all(lineups.map(async (lineup: any) => {
      if (!slateCache.has(lineup.slateId)) {
        const slatePlayers = await storage.getPlayersBySlate(lineup.slateId);
        const slate = await storage.getSlate(lineup.slateId);
        const sport = slate?.sport || "NBA";
        if (!bdlCache.has(sport)) {
          bdlCache.set(sport, await fetchBDLStats(sport));
        }
        const ownershipResults = await calculateOwnership(slatePlayers, sport, "gpp_large", bdlCache.get(sport));
        slateCache.set(lineup.slateId, computeOwnershipForPlayers(slatePlayers, ownershipResults));
        slatePlayerIdCache.set(lineup.slateId, new Set(slatePlayers.map(p => p.id)));
      }
      const allWithOwn = slateCache.get(lineup.slateId)!;
      const playerIdSet = slatePlayerIdCache.get(lineup.slateId)!;
      const rosterOwn = allWithOwn
        .filter(p => lineup.playerIds.includes(p.id))
        .reduce((sum, p) => sum + p.ownershipProjection, 0);
      const resolvedCount = lineup.playerIds.filter((id: number) => playerIdSet.has(id)).length;
      const isOrphaned = resolvedCount < lineup.playerIds.length;
      return { ...lineup, totalOwnership: Math.round(rosterOwn * 10) / 10, isOrphaned };
    }));

    res.json(enriched);
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

    res.json({ ...lineup, players: rosterPlayers, allPlayers, isOrphaned });
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
    for (const id of ids) {
      const lineup = await storage.getLineup(Number(id));
      if (lineup && lineup.userId === userId) {
        await storage.deleteLineup(Number(id));
        deleted++;
      }
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

    const results: { id: number; status: string; error?: string }[] = [];

    const slateCache = new Map<number, { slate: any; pool: Player[]; allPlayers: Player[]; baseExcluded: number[]; platform: Platform }>();
    const usedLineupKeys = new Set<string>();
    const playerAppearances: Record<number, number> = {};
    const totalCount = ids.length;
    const globalMaxExposure = typeof req.body.globalMaxExposure === "number" ? req.body.globalMaxExposure : 80;
    const projFloor = typeof req.body.projFloor === "number" && req.body.projFloor > 0 ? req.body.projFloor : null;
    const minSalary = typeof req.body.minSalary === "number" ? req.body.minSalary : undefined;
    const maxSalary = typeof req.body.maxSalary === "number" ? req.body.maxSalary : undefined;

    for (const id of ids) {
      const lineup = await storage.getLineup(Number(id));
      if (!lineup || lineup.userId !== userId) {
        results.push({ id, status: "skipped", error: "Not found or not yours" });
        continue;
      }

      let cached = slateCache.get(lineup.slateId);
      if (!cached) {
        const slate = await storage.getSlate(lineup.slateId);
        if (!slate) {
          results.push({ id, status: "skipped", error: "Slate no longer available" });
          continue;
        }
        if (new Date(slate.startTime) <= new Date()) {
          results.push({ id, status: "skipped", error: "Slate already started" });
          continue;
        }

        const platform = (lineup.platform || "draftkings") as Platform;
        let allPlayers = await storage.getPlayersBySlate(lineup.slateId);
        if (allPlayers.length === 0) {
          results.push({ id, status: "skipped", error: "No players in slate" });
          continue;
        }

        if (slate.platform === "draftkings") {
          allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
        }

        const useBoosts = req.body.useBoosts !== false;
        const useCeilingMode = req.body.ceilingMode === true;
        const useLeverageMode = req.body.leverageMode === true;
        const regenScoutMap = buildScoutMap(slate.sport);

        let pool = allPlayers.map(p => {
          let pts = Number(p.projectedPoints);
          if (p.isConfirmedStarter) {
            pts = Math.round(pts * 1.05 * 10) / 10;
          }
          if (useBoosts && p.boostScore) {
            const boostPct = Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015));
            pts = Math.round(pts * (1 + boostPct) * 10) / 10;
          }
          pts = applyScoutToProjection(pts, p.name, regenScoutMap);
          if (isPlayerOut(p.injuryStatus)) pts = 0;
          else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") pts *= 0.75;
          else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") pts *= 0.9;
          return { ...p, projectedPoints: pts.toString() };
        });

        pool = await applyActualAdjustedProjections(pool, slate.sport);
        pool = await applyWinningLineupAdjustment(pool, slate.sport);

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

        const MAX_POOL_SIZE = 150;
        const excludedSet = new Set(baseExcluded);
        const eligiblePool = pool.filter(p => !excludedSet.has(p.id));
        if (eligiblePool.length > MAX_POOL_SIZE) {
          const sorted = [...eligiblePool].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
          const trimmed = sorted.slice(0, MAX_POOL_SIZE);
          console.log(`[BulkGenerate] Trimmed eligible pool from ${eligiblePool.length} to ${trimmed.length} for ${slate.sport}`);
          pool = [...trimmed, ...pool.filter(p => excludedSet.has(p.id))];
        }

        const eligibleCount = pool.filter(p => !new Set(baseExcluded).has(p.id) && Number(p.projectedPoints) > 0).length;
        console.log(`[BulkGenerate] ${slate.sport} slate ${slate.id}: ${allPlayers.length} total, ${baseExcluded.length} excluded, ${eligibleCount} eligible with proj > 0, minSal=${minSalary ?? 'none'}, maxSal=${maxSalary ?? 'none'}`);

        cached = { slate, pool, allPlayers, baseExcluded, platform };
        slateCache.set(lineup.slateId, cached);
      }

      const { slate, pool, baseExcluded, platform } = cached;
      const iteration = results.filter(r => r.status === "updated").length;
      const maxAttempts = 10;
      let updated = false;

      for (let attempt = 0; attempt < maxAttempts && !updated; attempt++) {
        const noiseScale = (iteration + attempt) === 0 ? 0 : Math.min(0.10 + (iteration + attempt) * 0.04, 0.40);
        const perturbedPool = pool.map(p => {
          if (baseExcluded.includes(p.id)) return p;
          const base = Number(p.projectedPoints);
          const noise = (iteration + attempt) === 0 ? 0 : (Math.random() - 0.5) * base * noiseScale;
          return { ...p, projectedPoints: Math.max(0, base + noise).toString() };
        });

        const iterationExcluded = [...baseExcluded];
        if (totalCount > 3) {
          for (const p of pool) {
            if (iterationExcluded.includes(p.id)) continue;
            const appearances = playerAppearances[p.id] || 0;
            const currentExposure = totalCount > 0 ? (appearances / totalCount) * 100 : 0;
            if (currentExposure >= globalMaxExposure) {
              iterationExcluded.push(p.id);
            }
          }
        }

        const salaryFilteredPool = (minSalary || maxSalary)
          ? perturbedPool.filter(p => {
              if (iterationExcluded.includes(p.id)) return true;
              if (minSalary && p.salary < minSalary) return false;
              if (maxSalary && p.salary > maxSalary) return false;
              return true;
            })
          : perturbedPool;

        const bulkContestType = req.body.contestType === "gpp" ? "gpp" : "cash";
        const solveResult = solveLineup(
          salaryFilteredPool,
          { slateId: lineup.slateId, platform, lockedPlayerIds: [], excludedPlayerIds: iterationExcluded, maxSalary: undefined, minSalary: undefined, playerProjections: {}, contestType: bulkContestType } as any,
          slate.sport,
          platform
        );

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

        await storage.updateLineup(Number(id), {
          playerIds,
          totalSalary: solveResult.totalSalary,
          totalProjectedPoints: origTotalPts.toFixed(1),
          playerSnapshot,
        });

        results.push({ id, status: "updated" });
        updated = true;
      }

      if (!updated) {
        results.push({ id, status: "failed", error: "Could not generate a unique lineup" });
      }
    }

    const updatedCount = results.filter(r => r.status === "updated").length;
    res.json({ results, updated: updatedCount, total: ids.length });
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

    const maxSims = isAdmin ? 1500 : tier === "pro" ? 500 : 200;
    const numSims = isAdmin ? 1500 : Math.min(Math.max(Number(rawNumSims) || 200, 50), maxSims);
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
          if (allPlayers.length === 0) { results.push({ id, status: "skipped", error: "No players in slate" }); continue; }

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
            Promise.race([buildVegasContext(pool, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
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
    const { ids, sortBy, useBoosts, ceilingMode, leverageMode, contestType: rawContestType, globalMaxExposure, projFloor, minSalary, maxSalary } = req.body;
    const simContestType = rawContestType === "gpp" ? "gpp" : "cash";
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "No lineup IDs provided" });

    const validSortKeys = ["p90", "p75", "composite", "median", "avg"];
    const sortKey = validSortKeys.includes(sortBy) ? sortBy : "composite";

    const sub = await storage.getSubscription(userId);
    const dbUser = await storage.getUser(userId);
    const isAdmin = dbUser?.isAdmin === true;
    const tier = isAdmin ? "pro" : (sub?.tier || "free");
    if (tier !== "pro" && tier !== "star") {
      return res.status(403).json({ message: "Sharpshooter or Champion subscription required.", requiresUpgrade: true });
    }

    const tierSims = isAdmin ? 1500 : tier === "pro" ? 500 : 200;
    const numSims = tierSims;
    const startTime = Date.now();
    const MAX_RUNTIME_MS = isAdmin ? 90000 : 45000;

    console.log(`[SimRegen] Starting: ${ids.length} lineups, ${numSims} sims (tier=${tier}), sortBy=${sortKey}, contest=${simContestType}, boosts=${useBoosts}, ceiling=${ceilingMode}, leverage=${leverageMode}, exposure=${globalMaxExposure}, projFloor=${projFloor}, minSal=${minSalary}, maxSal=${maxSalary}`);

    try {
      const slateGroups = new Map<number, number[]>();
      const lineupOwnership = new Map<number, any>();

      const results: { id: number; status: string; error?: string }[] = [];

      for (const id of ids) {
        const lineup = await storage.getLineup(Number(id));
        if (!lineup || lineup.userId !== userId) {
          results.push({ id: Number(id), status: "skipped", error: "Not found or not yours" });
          continue;
        }
        lineupOwnership.set(Number(id), lineup);
        const group = slateGroups.get(lineup.slateId) || [];
        group.push(Number(id));
        slateGroups.set(lineup.slateId, group);
      }

      for (const [slateId, lineupIds] of slateGroups) {
        const slate = await storage.getSlate(slateId);
        if (!slate) {
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "Slate not found" }));
          continue;
        }

        const platform = (lineupOwnership.get(lineupIds[0])?.platform || "draftkings") as Platform;
        let allPlayers = await storage.getPlayersBySlate(slateId);
        if (allPlayers.length === 0) {
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "No players in slate" }));
          continue;
        }

        if (slate.platform === "draftkings") {
          allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
        }

        const applyBoosts = useBoosts !== false;
        const useCeilingMode = ceilingMode === true;
        const useLeverageMode = leverageMode === true;
        const scoutMap = buildScoutMap(slate.sport);
        let pool = allPlayers.map(p => {
          let pts = Number(p.projectedPoints);
          if (p.isConfirmedStarter) pts = Math.round(pts * 1.05 * 10) / 10;
          if (applyBoosts && p.boostScore) {
            const boostPct = Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015));
            pts = Math.round(pts * (1 + boostPct) * 10) / 10;
          }
          pts = applyScoutToProjection(pts, p.name, scoutMap, false);
          if (isPlayerOut(p.injuryStatus)) pts = 0;
          else if (p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") pts *= 0.75;
          else if (p.injuryStatus === "Probable" || p.injuryStatus === "DTD") pts *= 0.9;
          return { ...p, projectedPoints: pts.toString() };
        });

        pool = await applyActualAdjustedProjections(pool, slate.sport);
        pool = await applyWinningLineupAdjustment(pool, slate.sport);

        const regenProfile = await getHistoricalProfile(slate.sport);
        if (regenProfile.ready) {
          pool = applyHistoricalAdjustments(pool, regenProfile);
        }

        if (useCeilingMode) {
          try {
            pool = applyCeilingMode(pool, slate.sport);
          } catch (ceilErr: any) {
            console.warn(`[SimRegen] Ceiling mode failed, skipping: ${ceilErr.message}`);
          }
        }

        if (useLeverageMode) {
          try {
            const bdlStats = await fetchBDLStats(slate.sport);
            const ownershipResults = await calculateOwnership(pool, slate.sport, "gpp_large", bdlStats);
            const playersWithOwnership = computeOwnershipForPlayers(pool, ownershipResults);
            pool = applyLeverageMode(playersWithOwnership);
          } catch (levErr: any) {
            console.warn(`[SimRegen] Leverage mode failed, skipping: ${levErr.message}`);
          }
        }

        const baseExcluded = allPlayers
          .filter(p => isPlayerOut(p.injuryStatus))
          .map(p => p.id);
        const isDK = slate.platform === "draftkings";
        const { inactiveIds } = isDK ? await getInactivePlayerIds(allPlayers, slate.sport) : { inactiveIds: [] };
        baseExcluded.push(...inactiveIds.filter(id => !baseExcluded.includes(id)));

        const excludedSet = new Set(baseExcluded);
        pool = pool.filter(p => !excludedSet.has(p.id));

        const simProjFloor = typeof projFloor === "number" && projFloor > 0 ? projFloor : null;
        const simMinSalary = typeof minSalary === "number" ? minSalary : undefined;
        const simMaxSalary = typeof maxSalary === "number" ? maxSalary : undefined;

        if (simMinSalary || simMaxSalary) {
          pool = pool.filter(p => {
            if (simMinSalary && p.salary < simMinSalary) return false;
            if (simMaxSalary && p.salary > simMaxSalary) return false;
            return true;
          });
        }

        const projOverrides: Record<number, number> = {};
        for (const p of pool) projOverrides[p.id] = Number(p.projectedPoints) ?? 0;

        const opponentMap = buildOpponentMap(pool);
        const [vegasContext, dvpContext] = await Promise.all([
          Promise.race([buildVegasContext(pool, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
          Promise.race([buildDvPContext(opponentMap, slate.sport), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
        ]);

        const dvpAdjusted = dvpContext
          ? applyDvPToProjections(pool, projOverrides, opponentMap, dvpContext, slate.sport)
          : projOverrides;

        const sims = runSimulations(pool, slate.sport, numSims, dvpAdjusted, vegasContext ?? undefined);
        console.log(`[SimRegen] Ran ${sims.length} sims for ${slate.sport} slate ${slateId}, pool: ${pool.length} players`);

        const config = getPlatformConfig(slate.sport, platform);
        const lineupMap = new Map<string, { lineup: Player[]; frequency: number; simScores: number[] }>();
        let processedSims = 0;

        for (let i = 0; i < sims.length; i++) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) {
            console.log(`[SimRegen] Time cap reached after ${i} sims`);
            break;
          }
          processedSims++;

          const sim = sims[i];
          const simPool = pool.map(p => {
            const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
            const noise = simProj * (Math.random() * 0.06 - 0.03);
            return { ...p, projectedPoints: Math.max(0, simProj + noise).toString() };
          });

          const result = solveLineup(
            simPool,
            { slateId, lockedPlayerIds: [], excludedPlayerIds: [], lineupCount: 1, maxSalary: config.salaryCap, contestType: simContestType } as OptimizationConstraints,
            slate.sport,
            platform
          );
          if (result.error || result.lineup.length === 0) continue;

          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          const existing = lineupMap.get(key);
          if (existing) {
            existing.frequency++;
            existing.simScores.push(result.totalProjectedPoints);
          } else {
            lineupMap.set(key, { lineup: result.lineup as Player[], frequency: 1, simScores: [result.totalProjectedPoints] });
          }
        }

        if (lineupMap.size === 0) {
          lineupIds.forEach(id => results.push({ id, status: "skipped", error: "No feasible lineups from sims" }));
          continue;
        }

        const scoredCandidates = Array.from(lineupMap.entries()).map(([key, data]) => {
          const allSimScores = sims.map(sim =>
            data.lineup.reduce((sum, p) => sum + (sim.projections[p.id] || 0), 0)
          ).sort((a, b) => a - b);

          const n = allSimScores.length;
          const avg = allSimScores.reduce((a, b) => a + b, 0) / n;
          const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
          const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
          const med = allSimScores[Math.floor(n * 0.50)] ?? avg;
          const simDenom = processedSims || sims.length;
          const composite = avg * 0.35 + p75 * 0.35 + p90 * 0.20 + (data.frequency / simDenom) * 100 * 0.10;

          return { key, lineup: data.lineup, frequency: data.frequency,
            avgSimScore: Math.round(avg * 10) / 10, medianScore: Math.round(med * 10) / 10,
            p75Score: Math.round(p75 * 10) / 10, p90Score: Math.round(p90 * 10) / 10,
            compositeScore: Math.round(composite * 10) / 10,
            freqPct: Math.round((data.frequency / simDenom) * 1000) / 10,
            totalSalary: data.lineup.reduce((s, p) => s + p.salary, 0),
          };
        });

        if (simProjFloor) {
          const origMapForFloor = new Map(allPlayers.map(op => [op.id, op]));
          const beforeCount = scoredCandidates.length;
          const filtered = scoredCandidates.filter(c => {
            const totalOrigPts = c.lineup.reduce((sum, p) => sum + Number(origMapForFloor.get(p.id)?.projectedPoints ?? p.projectedPoints ?? 0), 0);
            return totalOrigPts >= simProjFloor;
          });
          if (filtered.length > 0) {
            scoredCandidates.length = 0;
            scoredCandidates.push(...filtered);
          }
          if (beforeCount !== scoredCandidates.length) {
            console.log(`[SimRegen] ProjFloor ${simProjFloor}: filtered ${beforeCount} -> ${scoredCandidates.length} candidates`);
          }
        }

        const sortFn: Record<string, (a: typeof scoredCandidates[0], b: typeof scoredCandidates[0]) => number> = {
          p90: (a, b) => b.p90Score - a.p90Score,
          p75: (a, b) => b.p75Score - a.p75Score,
          composite: (a, b) => b.compositeScore - a.compositeScore,
          median: (a, b) => b.medianScore - a.medianScore,
          avg: (a, b) => b.avgSimScore - a.avgSimScore,
        };
        scoredCandidates.sort(sortFn[sortKey] || sortFn.composite);

        const origMap = new Map(allPlayers.map(op => [op.id, op]));

        for (let i = 0; i < lineupIds.length && i < scoredCandidates.length; i++) {
          const candidate = scoredCandidates[i];
          const lineupId = lineupIds[i];
          const playerIds = candidate.lineup.map(p => p.id);
          const playerSnapshot = candidate.lineup.map(p => {
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

          const simData = {
            avgSimScore: candidate.avgSimScore, medianScore: candidate.medianScore,
            p75Score: candidate.p75Score, p90Score: candidate.p90Score,
            compositeScore: candidate.compositeScore, freqPct: candidate.freqPct,
          };
          await db.update(lineupsTable).set({
            playerIds, totalSalary: candidate.totalSalary,
            totalProjectedPoints: origTotalPts.toFixed(1),
            playerSnapshot, simData,
          }).where(eq(lineupsTable.id, lineupId));

          results.push({ id: lineupId, status: "updated" });
        }

        for (let i = scoredCandidates.length; i < lineupIds.length; i++) {
          results.push({ id: lineupIds[i], status: "skipped", error: "Not enough sim candidates" });
        }
      }

      const updatedCount = results.filter(r => r.status === "updated").length;
      console.log(`[SimRegen] Completed: ${updatedCount}/${ids.length} lineups regenerated by ${sortKey}, ${numSims} sims, ${Date.now() - startTime}ms`);
      res.json({ results, updated: updatedCount, total: ids.length, simsRun: numSims, sortBy: sortKey });
    } catch (err: any) {
      console.error("[SimRegen] Error:", err);
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
    let { slateId } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ message: "No entries provided." });
    }
    if (!sport) {
      return res.status(400).json({ message: "Sport is required." });
    }

    if (!slateId) {
      const allSlates = await storage.getSlates();
      const dkSlate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isMain)
        || allSlates.find(s => s.sport === sport && s.platform === "draftkings");
      if (dkSlate) {
        slateId = dkSlate.id;
        console.log(`[DK Import] Auto-detected DK ${sport} slate ${slateId} (${dkSlate.name})`);
      } else {
        return res.status(400).json({ message: `No DraftKings ${sport} slate found. Try again after DK data refreshes.` });
      }
    }

    const slate = await storage.getSlate(slateId);
    if (!slate) return res.status(400).json({ message: "Slate not found." });
    if (slate.sport !== sport) {
      return res.status(400).json({ message: `Slate sport (${slate.sport}) does not match provided sport (${sport}).` });
    }
    if (slate.platform !== "draftkings") {
      return res.status(400).json({ message: "Only DraftKings slates are supported for import." });
    }

    let allPlayers = await storage.getPlayersBySlate(slateId);
    let dkIdMap = new Map<number, typeof allPlayers[0]>();
    let nameMap = new Map<string, typeof allPlayers[0]>();
    for (const p of allPlayers) {
      if (p.draftKingsPlayerId) dkIdMap.set(p.draftKingsPlayerId, p);
      if (p.name) nameMap.set(p.name.toLowerCase().trim(), p);
    }

    const firstEntry = entries[0];
    const firstDkIds: number[] = firstEntry?.dkPlayerIds || [];
    const localMatchCount = firstDkIds.filter(id => dkIdMap.has(id)).length;

    if (localMatchCount < firstDkIds.length / 2) {
      console.log(`[DK Import] Local slate mismatch (${localMatchCount}/${firstDkIds.length} matched). Searching for correct draft group...`);
      try {
        const availableSlates = await fetchAvailableDKSlates(sport);
        let foundDraftGroup: number | null = null;

        for (const avSlate of availableSlates) {
          try {
            const draftables = await fetchDraftables(avSlate.draftGroupId);
            const draftableIds = new Set(draftables.map(d => d.draftableId));
            const matchCount = firstDkIds.filter(id => draftableIds.has(id)).length;
            if (matchCount >= firstDkIds.length / 2) {
              foundDraftGroup = avSlate.draftGroupId;
              console.log(`[DK Import] Found matching draft group ${avSlate.draftGroupId} (${matchCount}/${firstDkIds.length} players match)`);

              const slateData = await fetchDKSlateByDraftGroup(sport, avSlate.draftGroupId);
              if (slateData && slateData.dkPlayers.length > 0) {
                const newSlate = await storage.createSlate({
                  sport,
                  platform: "draftkings",
                  name: `${sport} ${avSlate.label || `DG ${avSlate.draftGroupId}`}`,
                  startTime: avSlate.startTime ? parseEasternTime(avSlate.startTime) : new Date(),
                  isMain: false,
                  draftGroupId: avSlate.draftGroupId,
                });
                const createdPlayers = await storage.bulkCreatePlayers(
                  slateData.dkPlayers.map((p: any) => ({ ...p, slateId: newSlate.id })) as any
                );
                console.log(`[DK Import] Created slate ${newSlate.id} with ${createdPlayers.length} players for DG ${avSlate.draftGroupId}`);

                allPlayers = createdPlayers;
                dkIdMap = new Map();
                nameMap = new Map();
                for (const p of allPlayers) {
                  if (p.draftKingsPlayerId) dkIdMap.set(p.draftKingsPlayerId, p);
                  if (p.name) nameMap.set(p.name.toLowerCase().trim(), p);
                }
                req.body.slateId = newSlate.id;
              }
              break;
            }
          } catch (err) {
            console.error(`[DK Import] Error checking DG ${avSlate.draftGroupId}:`, err);
          }
        }
        if (!foundDraftGroup) {
          console.log(`[DK Import] Could not find matching draft group among ${availableSlates.length} available slates`);
        }
      } catch (err) {
        console.error("[DK Import] Error searching for draft group:", err);
      }
    }

    const importSlateId = req.body.slateId;

    const config = getPlatformConfig(sport, "draftkings" as Platform);
    const maxPerSport = isAdmin ? 500 : 300;
    const currentCount = await storage.getLineupCountBySport(userId, sport);
    const availableSlots = maxPerSport - currentCount;
    if (availableSlots <= 0) {
      return res.status(403).json({ message: `You've reached the maximum of ${maxPerSport} saved teams per sport.` });
    }

    const results: { entryId: string; status: string; lineupId?: number; error?: string }[] = [];
    let imported = 0;

    for (const entry of entries) {
      if (imported >= availableSlots) {
        results.push({ entryId: entry.entryId, status: "skipped", error: "Lineup limit reached." });
        continue;
      }

      const rawDkPlayerIds: number[] = entry.dkPlayerIds || [];
      const entryPlayerNames: string[] = entry.playerNames || [];
      const matchedPlayers: typeof allPlayers = [];
      const missingNames: string[] = [];
      const seenPlayerIds = new Set<number>();

      for (let i = 0; i < rawDkPlayerIds.length; i++) {
        const dkId = rawDkPlayerIds[i];
        let p = dkIdMap.get(dkId);
        if (!p && entryPlayerNames[i]) {
          p = nameMap.get(entryPlayerNames[i].toLowerCase().trim());
        }
        if (p && !seenPlayerIds.has(p.id)) {
          seenPlayerIds.add(p.id);
          matchedPlayers.push(p);
        } else if (!p) {
          missingNames.push(entryPlayerNames[i] || `DK#${dkId}`);
        }
      }

      if (matchedPlayers.length !== config.rosterSize) {
        results.push({
          entryId: entry.entryId,
          status: "failed",
          error: `Matched ${matchedPlayers.length}/${config.rosterSize} players. Could not find: ${missingNames.join(", ")}`,
        });
        continue;
      }

      const totalSalary = matchedPlayers.reduce((s, p) => s + p.salary, 0);
      if (totalSalary > config.salaryCap) {
        results.push({ entryId: entry.entryId, status: "failed", error: `Salary $${totalSalary.toLocaleString()} exceeds cap.` });
        continue;
      }

      const slotResult = assignPlayersToSlots(matchedPlayers, config.slots, sport);
      const unfilledSlots = config.slots.filter(s => !slotResult[s]);
      if (unfilledSlots.length > 0) {
        results.push({ entryId: entry.entryId, status: "failed", error: `Cannot fill slots: ${unfilledSlots.join(", ")}` });
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
      const contestLabel = entry.contestName ? entry.contestName.substring(0, 50) : null;

      try {
        const lineup = await storage.createLineup({
          userId,
          slateId: importSlateId,
          sport,
          platform: "draftkings",
          totalSalary,
          totalProjectedPoints,
          playerIds: matchedPlayers.map(p => p.id),
          name: contestLabel ? `DK: ${contestLabel}` : `DK Import #${entry.entryId}`,
          playerSnapshot,
          dkEntryId: entry.entryId || null,
          dkContestName: entry.contestName || null,
          dkContestId: entry.contestId || null,
          dkEntryFee: entry.entryFee || null,
        });
        results.push({ entryId: entry.entryId, status: "imported", lineupId: lineup.id });
        imported++;
      } catch (err: any) {
        results.push({ entryId: entry.entryId, status: "failed", error: err.message || "Database error" });
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

  app.post("/api/subscription/portal", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;

    try {
      const { createPortalSession } = await import("./stripe");
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const returnUrl = `${protocol}://${host}/pricing`;

      const url = await createPortalSession(userId, returnUrl);
      res.json({ url });
    } catch (err: any) {
      console.error("[stripe] Portal error:", err);
      res.status(500).json({ message: err.message || "Failed to create portal session" });
    }
  });

  app.post("/api/stripe/webhook", async (req, res) => {
    try {
      const { stripe, handleWebhookEvent } = await import("./stripe");
      if (!stripe) return res.status(500).json({ message: "Stripe not configured" });

      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;
      if (webhookSecret) {
        if (!sig) {
          return res.status(400).json({ message: "Missing stripe-signature header" });
        }
        try {
          event = stripe.webhooks.constructEvent(
            (req as any).rawBody,
            sig,
            webhookSecret
          );
        } catch (err: any) {
          console.error("[stripe] Webhook signature verification failed:", err.message);
          return res.status(400).json({ message: "Webhook signature verification failed" });
        }
      } else if (process.env.NODE_ENV === "production") {
        console.error("[stripe] STRIPE_WEBHOOK_SECRET not set in production — rejecting webhook");
        return res.status(500).json({ message: "Webhook secret not configured" });
      } else {
        console.warn("[stripe] No webhook secret set — accepting unverified event in development");
        event = req.body;
      }

      await handleWebhookEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      console.error("[stripe] Webhook error:", err);
      res.status(500).json({ message: "Webhook processing failed" });
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
      const { sport, draftGroupId, name } = req.body;
      if (!sport || !draftGroupId) {
        return res.status(400).json({ message: "sport and draftGroupId are required" });
      }

      const existingSlates = await storage.getSlates();
      const alreadyExists = existingSlates.find(s => s.draftGroupId === draftGroupId && s.sport === sport);
      if (alreadyExists) {
        return res.status(409).json({ message: "This slate has already been imported", slateId: alreadyExists.id });
      }

      const slateData = await fetchDKSlateByDraftGroup(sport, draftGroupId);
      if (!slateData || slateData.dkPlayers.length === 0) {
        return res.status(404).json({ message: "No player data found for this DraftKings slate" });
      }

      const slateName = name || `${sport} Slate ${draftGroupId}`;
      const newSlate = await storage.createSlate({
        sport,
        platform: "draftkings",
        name: slateName,
        startTime: slateData.slateDate,
        isMain: false,
        draftGroupId: draftGroupId,
      });

      const createdPlayers = await storage.bulkCreatePlayers(
        slateData.dkPlayers.map((p: any) => ({ ...p, slateId: newSlate.id })) as any
      );

      const today = getEasternToday();
      try {
        const historyRecords = createdPlayers.map(p => ({
          playerName: p.name,
          team: p.team,
          sport,
          position: p.position,
          salary: p.salary,
          projectedPoints: p.projectedPoints,
          slateDate: today,
          slateId: newSlate.id,
          draftKingsPlayerId: p.draftKingsPlayerId,
        }));
        await storage.bulkInsertPlayerHistory(historyRecords);
      } catch (err) {
        console.error(`[History] Failed to save ${sport} snapshots for new slate:`, err);
      }

      console.log(`[Admin] Added ${sport} slate "${slateName}" (DG ${draftGroupId}) with ${createdPlayers.length} players`);
      res.json({
        slate: newSlate,
        playerCount: createdPlayers.length,
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
      const lineups = await storage.getWinningLineups(sport, 90);

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
      const lineups = await storage.getWinningLineups(sport, limit);
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
      const slate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isMain && s.isActive !== false);
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
          gameInfo: p.gameInfo,
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
        gameInfo: p.gameInfo,
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
        gameInfo: p.gameInfo,
        valueScore: p.valueScore.toFixed(2),
        direction: "down" as const,
      }));

      const trending = [...trendingUp, ...trendingDown];

      const gameMap = new Map<string, typeof allPlayers>();
      for (const p of allPlayers) {
        const key = p.gameInfo || "unknown";
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
        const slate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isActive !== false);
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
            const boostPct = p.boostScore ? Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015)) : 0;
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

        const games = new Set(players.map(p => p.gameInfo).filter(Boolean));

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
            gameInfo: p.gameInfo || "",
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

  const ESPN_NEWS_URLS: Record<string, string> = {
    NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news",
    NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news",
    MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news",
    NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
    GOLF: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/news",
    SOCCER: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news",
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
      const validSports = ["NBA", "NHL", "MLB", "NFL", "GOLF"];
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
      const tournamentParts = (players[0]?.gameInfo || "Tournament").split(" - ");
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

      const maxLineupCount = isAdmin ? 150 : tier === "pro" ? 20 : 5;

      const constraints = proOptimizationConstraintSchema.parse(req.body);
      constraints.lineupCount = Math.min(constraints.lineupCount, maxLineupCount);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;
      let allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      if (slate.platform === "draftkings") {
        allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
      }

      const proUserOverrides = await storage.getPlayerOverrides(userId, constraints.slateId);
      const proOverrideMap = new Map(proUserOverrides.map(o => [o.playerId, o]));
      const proOverrideExcluded = proUserOverrides.filter(o => o.isExcluded).map(o => o.playerId);
      const proOverrideLocked = proUserOverrides.filter(o => o.isLocked).map(o => o.playerId);
      constraints.lockedPlayerIds = [...new Set([...constraints.lockedPlayerIds, ...proOverrideLocked])];
      constraints.excludedPlayerIds = [...new Set([...constraints.excludedPlayerIds, ...proOverrideExcluded])];

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
          const boostPct = Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015));
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
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

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
      let attempts = 0;
      const SOLVER_TIMEOUT = 45000;

      const playerAppearances: Record<number, number> = {};
      const candidateLineups: { result: any; correlationScore: number }[] = [];

      while (lineupResults.length < constraints.lineupCount && attempts < maxAttempts) {
        if (Date.now() - proStartTime > SOLVER_TIMEOUT) {
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
            const effectiveLimit = playerLimit ?? constraints.globalMaxExposure;
            if (effectiveLimit !== undefined && currentExposure >= effectiveLimit) {
              iterationExcluded.push(p.id);
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

        const modConstraints = { ...constraints, excludedPlayerIds: iterationExcluded };
        const solveStart = Date.now();
        const result = solveLineup(perturbedPool, modConstraints, slate.sport, platform);
        console.log(`[ProOptimizer] Solve attempt ${attempts} took ${Date.now() - solveStart}ms, feasible: ${!result.error}`);

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
      }

      lineupResults.sort((a, b) => {
        const ptsDiff = b.totalProjectedPoints - a.totalProjectedPoints;
        if (ptsDiff !== 0) return ptsDiff;
        return (b.correlationScore || 0) - (a.correlationScore || 0);
      });

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

      const message = lineupResults.length === 0
        ? constraints.projectedPointsFloor
          ? `No lineups could reach the ${constraints.projectedPointsFloor}-point floor. Try lowering it or relaxing other constraints.`
          : "Could not generate any feasible lineups with the current constraints."
        : undefined;

      res.json({ lineups: lineupResults, boostsSummary, injurySummary, message });
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
    slateId:              z.number(),
    platform:             z.enum(["draftkings", "fanduel", "yahoo"]).default("draftkings"),
    lockedPlayerIds:      z.array(z.number()).default([]),
    excludedPlayerIds:    z.array(z.number()).default([]),
    playerProjections:    z.record(z.string(), z.number()).optional(),
    playerMinSalary:      z.number().optional(),
    playerMaxSalary:      z.number().optional(),
    lineupCount:          z.number().min(1).max(2000).default(20),
    numSims:              z.number().min(50).max(1000).default(200),
    globalMaxExposure:    z.number().min(1).max(100).optional(),
    enforceGameStack:     z.boolean().default(false),
    minStackSize:         z.number().min(2).max(5).default(2),
    stackGameKey:         z.string().optional(),
    minStarRating:        z.number().min(0).max(5).default(0),
    sortMetric:           z.enum(["composite", "p90", "p75", "median", "avg"]).default("composite"),
    useBoosts:            z.boolean().default(true),
    ceilingMode:          z.boolean().default(false),
    leverageMode:         z.boolean().default(false),
  });

  app.post("/api/optimize/sim", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);

    const startTime = Date.now();
    const MAX_RUNTIME_MS = 30_000;

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
      const maxSims = isAdmin ? 1500 : tier === "pro" ? 500 : 200;
      input.numSims = isAdmin ? 1500 : Math.min(input.numSims, maxSims);

      const slate = await storage.getSlate(input.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });
      if (slate.isActive === false) return res.status(410).json({ message: "This slate has ended." });

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const sport = slate.sport;
      const platform = (input.platform || slate.platform || "draftkings") as Platform;
      const config = getPlatformConfig(sport, platform);

      let allPlayers = await storage.getPlayersBySlate(input.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      if (slate.platform === "draftkings") {
        allPlayers = await applyLiveDKStatuses(allPlayers, slate.draftGroupId, slate.sport);
      }

      const proScoutMap = buildScoutMap(slate.sport);
      const applyBoosts = input.useBoosts !== false;
      const useCeilingMode = input.ceilingMode === true;
      const useLeverageMode = input.leverageMode === true;

      let pool = allPlayers.map(p => {
        let boostedPoints = Number(p.projectedPoints);

        if (p.isConfirmedStarter) {
          boostedPoints = Math.round(boostedPoints * 1.05 * 10) / 10;
        }
        if (applyBoosts && p.boostScore) {
          const boostPct = Math.max(-0.15, Math.min(0.15, Number(p.boostScore) * 0.015));
          boostedPoints = Math.round(boostedPoints * (1 + boostPct) * 10) / 10;
        }
        boostedPoints = applyScoutToProjection(boostedPoints, p.name, proScoutMap, false);

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
      pool = await applyWinningLineupAdjustment(pool, slate.sport);

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

      pool = pool.filter(p => !input.excludedPlayerIds.includes(p.id));
      pool = pool.filter(p => !isPlayerOut(p.injuryStatus));
      if (input.playerMinSalary) pool = pool.filter(p => p.salary >= input.playerMinSalary!);
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
          projOverrides[Number(pid)] = v;
        }
      }
      for (const p of pool) {
        if (projOverrides[p.id] === undefined) {
          projOverrides[p.id] = Number(p.projectedPoints) ?? 0;
        }
      }

      if (input.stackGameKey) {
        const stackKey = input.stackGameKey.trim().toUpperCase();
        let matchedCount = 0;
        for (const p of pool) {
          const gi = p.gameInfo || "";
          const teams = gi.match(/^([A-Z0-9]+)\s*[@vs.]+\s*([A-Z0-9]+)/i);
          if (teams) {
            const key = [teams[1].toUpperCase(), teams[2].toUpperCase()].sort().join("-");
            if (key === stackKey) {
              const pid = p.id;
              projOverrides[pid] = (projOverrides[pid] ?? Number(p.projectedPoints)) * 1.15;
              matchedCount++;
            }
          }
        }
        console.log(`[SimOptimizer] Manual stack target: ${stackKey} — boosted ${matchedCount} players by 15%`);
      }

      console.log(`[SimOptimizer] Starting ${input.numSims} sims for ${sport} slate ${input.slateId}, pool: ${pool.length} players, requesting ${input.lineupCount} lineups`);

      const opponentMap = buildOpponentMap(pool);

      const [vegasContext, dvpContext] = await Promise.all([
        Promise.race([
          buildVegasContext(pool, sport),
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
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

      const sims = runSimulations(pool, sport, input.numSims, dvpAdjustedOverrides, vegasContext ?? undefined);

      const lineupMap = new Map<string, {
        lineup:    Player[];
        frequency: number;
        simScores: number[];
      }>();

      for (let i = 0; i < sims.length; i++) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          console.log(`[SimOptimizer] Time cap reached after ${i} sims`);
          break;
        }

        const sim = sims[i];

        const simConstraints = {
          slateId: input.slateId,
          lockedPlayerIds: input.lockedPlayerIds,
          excludedPlayerIds: input.excludedPlayerIds,
          lineupCount: 1,
          maxSalary: config.salaryCap,
        } as OptimizationConstraints;

        const simPool = pool.map(p => {
          const simProj = sim.projections[p.id] ?? Number(p.projectedPoints) ?? 0;
          const noise = simProj * (Math.random() * 0.06 - 0.03);
          return {
            ...p,
            projectedPoints: Math.max(0, simProj + noise).toString(),
          };
        });

        const result = solveLineup(simPool, simConstraints, sport, platform);
        if (result.error || result.lineup.length === 0) continue;

        const key = result.lineup.map((p: Player) => p.id).sort().join(",");
        const existing = lineupMap.get(key);
        if (existing) {
          existing.frequency++;
          existing.simScores.push(result.totalProjectedPoints);
        } else {
          lineupMap.set(key, {
            lineup:    result.lineup as Player[],
            frequency: 1,
            simScores: [result.totalProjectedPoints],
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

      const uniqueLineups = Array.from(lineupMap.entries()).map(([key, data]) => {
        const allSimScores = sims.map(sim =>
          data.lineup.reduce((sum, p) => sum + (sim.projections[p.id] || 0), 0)
        ).sort((a, b) => a - b);

        const n   = allSimScores.length;
        const avg = allSimScores.reduce((a, b) => a + b, 0) / n;
        const p75 = allSimScores[Math.floor(n * 0.75)] ?? avg;
        const p90 = allSimScores[Math.floor(n * 0.90)] ?? avg;
        const med = allSimScores[Math.floor(n * 0.50)] ?? avg;

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

      const metricKey = {
        composite: "compositeScore",
        p90:       "p90Score",
        p75:       "p75Score",
        median:    "medianScore",
        avg:       "avgSimScore",
      }[input.sortMetric] as keyof typeof uniqueLineups[0];
      uniqueLineups.sort((a, b) => (b[metricKey] as number) - (a[metricKey] as number));

      const playerAppearances: Record<number, number> = {};
      const selected: typeof uniqueLineups = [];
      const targetCount = Math.min(input.lineupCount, uniqueLineups.length);

      for (const lu of uniqueLineups) {
        if (selected.length >= targetCount) break;

        let violatesExposure = false;
        if (input.globalMaxExposure !== undefined && selected.length > 0) {
          for (const p of lu.lineup) {
            const appearances = (playerAppearances[p.id] || 0) + 1;
            const pct = (appearances / targetCount) * 100;
            if (pct > input.globalMaxExposure) { violatesExposure = true; break; }
          }
        }
        if (violatesExposure) continue;

        selected.push(lu);
        for (const p of lu.lineup) {
          playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
        }
      }

      if (selected.length < targetCount) {
        for (const lu of uniqueLineups) {
          if (selected.length >= targetCount) break;
          if (!selected.find(s => s.key === lu.key)) selected.push(lu);
        }
      }

      const elapsedMs = Date.now() - startTime;

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
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 5, 10));
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
        const gi = player.gameInfo.replace(/\s*@\s*\d.*/, "").replace(/\s*\d+:\d+.*/, "");
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
        const apiProps = await fetchAllPropsForSport(sport, 3, playerTeamMap);
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

const SPORT_MIN_SALARY: Record<string, number> = {
  NBA: 3000, NHL: 2500, MLB: 2000, NFL: 3000, GOLF: 5000, SOCCER: 2000,
};

const INACTIVE_VALUE_THRESHOLD = 6.0;

async function getInactivePlayerIds(players: Player[], sport: string): Promise<{ inactiveIds: number[]; zeroPointCount: number }> {
  const minSalary = SPORT_MIN_SALARY[sport] || 3000;
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

  const outPlayersByTeamPos = new Map<string, string[]>();
  for (const p of players) {
    if (isPlayerOut(p.injuryStatus)) {
      const positions = p.position.split("/");
      for (const pos of positions) {
        const key = `${p.team}_${pos}`;
        if (!outPlayersByTeamPos.has(key)) outPlayersByTeamPos.set(key, []);
        outPlayersByTeamPos.get(key)!.push(p.name);
      }
    }
  }

  let zeroPointCount = 0;
  for (const p of players) {
    if (isPlayerOut(p.injuryStatus) || p.injuryStatus === "Questionable" || p.injuryStatus === "GTD") continue;

    if (zeroPointNames.has(p.name.toLowerCase())) {
      inactiveIds.push(p.id);
      zeroPointCount++;
      continue;
    }

    const fppg = Number(p.fppg) || 0;
    const valuePer1K = fppg > 0 ? (fppg * 1000) / p.salary : 0;

    if (valuePer1K >= 7.0) {
      inactiveIds.push(p.id);
      continue;
    }

    if (recentlyPlayed && recentlyPlayed.size > 0) {
      const normalized = normalizePlayerName(p.name);
      if (!recentlyPlayed.has(normalized)) {
        inactiveIds.push(p.id);
        continue;
      }
    }

    if (p.salary <= minSalary * 1.1 && valuePer1K >= INACTIVE_VALUE_THRESHOLD) {
      const positions = p.position.split("/");
      const hasOutTeammate = positions.some(pos => {
        const key = `${p.team}_${pos}`;
        return outPlayersByTeamPos.has(key);
      });

      if (!hasOutTeammate) {
        inactiveIds.push(p.id);
        continue;
      }
    }
  }

  if (inactiveIds.length > 0) {
    console.log(`[Inactive Filter] ${sport}: Excluded ${inactiveIds.length} inactive/non-recent players from pool (${zeroPointCount} zero-point)`);
  }

  return { inactiveIds, zeroPointCount };
}

function solveLineup(pool: Player[], constraints: OptimizationConstraints, sport: string, platform: Platform) {
  const config = getPlatformConfig(sport, platform);
  const contestType = (constraints as any).contestType || "cash";
  
  const model: any = {
    optimize: "projectedPoints",
    opType: "max",
    constraints: {
      salary: { max: constraints.maxSalary || config.salaryCap, ...(constraints.minSalary ? { min: constraints.minSalary } : {}) },
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

  pool.forEach(p => {
    if (constraints.excludedPlayerIds.includes(p.id)) return;

    const isLocked = constraints.lockedPlayerIds.includes(p.id);
    const variableName = `p${p.id}`;
    
    let projectedPoints = Number(p.projectedPoints);
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
      salary: p.salary,
      rosterSize: 1,
      ...buildPositionVariables(p.position, sport),
    };

    model.variables[variableName] = variable;
    model.ints[variableName] = 1;

    model.constraints[`bound_${variableName}`] = { max: 1 };
    variable[`bound_${variableName}`] = 1;

    if (isLocked) {
      model.constraints[`lock_${variableName}`] = { equal: 1 };
      variable[`lock_${variableName}`] = 1;
    }
  });

  const result: any = solver.Solve(model);

  if (!result.feasible) {
    return { error: "Could not find a feasible lineup with these constraints.", lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }

  const selectedPlayerIds = Object.keys(result)
    .filter(k => k.startsWith('p') && result[k] > 0.5)
    .map(k => Number(k.substring(1)));

  const selectedPlayers = pool.filter(p => selectedPlayerIds.includes(p.id));

  if (selectedPlayers.length !== config.rosterSize) {
    return { error: `Roster size mismatch: got ${selectedPlayers.length}, need ${config.rosterSize}`, lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
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
    totalProjectedPoints: totalPoints
  };
}

export async function seedDatabase(forceRefresh = false) {
  if (forceRefresh) {
    await storage.clearAllSlatesAndPlayers();
    console.log("Cleared existing slates and players for refresh");
  }

  const existingSlates = await storage.getSlates();

  let liveData = new Map<string, any>();
  try {
    liveData = await fetchAllSportsLiveData();
    for (const [sport, data] of Array.from(liveData.entries())) {
      console.log(`[DK] Live ${sport}: ${data.dkPlayers.length} DK players, ${data.games.length} games`);
    }
  } catch (err) {
    console.error("[DK] Error fetching live data:", err);
  }

  const sportSeeds = ["NBA", "NHL", "MLB", "NFL", "GOLF", "SOCCER"].map(sport => {
    const live = liveData.get(sport);
    if (live && live.dkPlayers.length > 0) {
      return {
        sport,
        dkSlate: { name: sport === "SOCCER" ? "Soccer Main Slate" : `${sport} Main Slate`, startTime: live.slateDate, isMain: true },
        dkPlayers: live.dkPlayers,
        draftGroupId: live.draftGroupId,
      };
    }
    console.log(`[DK] ${sport}: No live DK data available, skipping`);
    return null;
  }).filter(Boolean) as any[];

  for (const seed of sportSeeds) {
    const existingSlate = existingSlates.find(
      s => s.sport === seed.sport && s.platform === "draftkings" && s.isMain
    );

    const now = new Date();
    let isStale = false;
    let existingPlayerCount = 0;
    if (existingSlate) {
      const slatePlayers = await storage.getPlayersBySlate(existingSlate.id);
      existingPlayerCount = slatePlayers.length;
      let latestGameStart = new Date(existingSlate.startTime);

      const slateStartET = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date(existingSlate.startTime));
      const [sMonth, sDay, sYear] = slateStartET.split("/");
      const slateDateStr = `${sYear}-${sMonth}-${sDay}`;

      for (const p of slatePlayers) {
        if (p.gameInfo) {
          const timeMatch = p.gameInfo.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i);
          if (timeMatch) {
            const [, hourStr, minStr, ampm] = timeMatch;
            let hour = parseInt(hourStr);
            if (ampm.toUpperCase() === "PM" && hour !== 12) hour += 12;
            if (ampm.toUpperCase() === "AM" && hour === 12) hour = 0;
            const gameET = parseEasternTime(`${slateDateStr}T${String(hour).padStart(2, "0")}:${minStr}:00`);
            if (gameET > latestGameStart) latestGameStart = gameET;
          }
        }
      }

      const STALE_BUFFER_MS = 3 * 3600000;
      isStale = (latestGameStart.getTime() + STALE_BUFFER_MS) < now.getTime();
      if (!isStale && new Date(existingSlate.startTime) < now) {
        console.log(`[DK] ${seed.sport} slate still active — last game at ${latestGameStart.toISOString()}, not stale until ${new Date(latestGameStart.getTime() + STALE_BUFFER_MS).toISOString()}`);
      }
    }
    const draftGroupChanged = existingSlate && seed.draftGroupId && existingSlate.draftGroupId !== seed.draftGroupId;

    if (draftGroupChanged && !isStale) {
      console.log(`[DK] ${seed.sport} draft group changed (${existingSlate!.draftGroupId} → ${seed.draftGroupId}) but current slate still active — skipping replacement`);
    }

    const shouldReplace = isStale || (draftGroupChanged && isStale);

    if (shouldReplace) {
      await storage.deleteSlateAndPlayers(existingSlate!.id);
      console.log(`[DK] Removed ${draftGroupChanged ? "outdated" : "stale"} ${seed.sport} slate (DG ${existingSlate!.draftGroupId} → ${seed.draftGroupId})`);
    }

    if (existingSlate && !shouldReplace && existingPlayerCount > 0) {
      continue;
    }

    if (existingSlate && !shouldReplace && existingPlayerCount === 0 && seed.dkPlayers.length > 0) {
      await storage.deletePlayersBySlate(existingSlate.id);
      const updatedSlate = await storage.updateSlateData(existingSlate.id, {
        name: seed.dkSlate.name!,
        startTime: seed.dkSlate.startTime!,
        draftGroupId: seed.draftGroupId || null,
      });
      const createdPlayers = await storage.bulkCreatePlayers(
        seed.dkPlayers.map((p: any) => ({ ...p, slateId: existingSlate.id })) as any
      );
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
      await storage.deletePlayersBySlate(existingSlate!.id);
      const updatedSlate = await storage.updateSlateData(existingSlate!.id, {
        name: seed.dkSlate.name!,
        startTime: seed.dkSlate.startTime!,
        draftGroupId: seed.draftGroupId || null,
      });
      const createdPlayers = await storage.bulkCreatePlayers(
        seed.dkPlayers.map((p: any) => ({ ...p, slateId: existingSlate!.id })) as any
      );
      console.log(`[DK] Repopulated stale ${seed.sport} slate ${existingSlate!.id} with ${createdPlayers.length} players`);

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
          slateId: existingSlate!.id,
          draftKingsPlayerId: p.draftKingsPlayerId,
        }));
        await storage.bulkInsertPlayerHistory(historyRecords);
        console.log(`[History] Saved ${historyRecords.length} ${seed.sport} player snapshots`);
      } catch (err) {
        console.error(`[History] Failed to save ${seed.sport} snapshots:`, err);
      }
    } else if (!existingSlate || shouldReplace) {
      const dkSlate = await storage.createSlate({
        sport: seed.sport,
        platform: "draftkings",
        name: seed.dkSlate.name!,
        startTime: seed.dkSlate.startTime!,
        isMain: true,
        draftGroupId: seed.draftGroupId || null,
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

  const today = getEasternToday();
  const existingProps = await storage.getPropsByDate(today);
  if (existingProps.length === 0) {
    await generateDailyProps(today);
    console.log("Generated daily prop bets");
  }

  await generatePlayerBoostsAndInjuries();

  const graceCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const deactivated = await db
    .update(slates)
    .set({ isActive: false })
    .where(and(lt(slates.startTime, graceCutoff), eq(slates.isActive, true)));
  const deactivatedCount = (deactivated as any)?.rowCount ?? 0;
  if (deactivatedCount > 0) console.log(`[Seed] Deactivated ${deactivatedCount} stale slate(s) after refresh`);
}

export async function generatePlayerBoostsAndInjuries() {
  const allSlates = await storage.getSlates();
  const mainSlates = allSlates.filter(s => s.isMain);

  for (const slate of mainSlates) {
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

    console.log(`Generated boosts for ${sport} ${slate.platform} slate`);
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
}
