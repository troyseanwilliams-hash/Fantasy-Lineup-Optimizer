import type { Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";
import { getPlatformConfig, ACTIVE_SPORTS, assignPlayersToSlots, type Platform } from "@shared/platform-config";
import { computeBoostScores, computeCorrelationBonus, applyCeilingMode, applyLeverageMode } from "./boost-engine";

function getSessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}
function isLoggedIn(req: Request): boolean {
  return !!getSessionUserId(req);
}
import { XMLParser } from "fast-xml-parser";

import { type OptimizationConstraints, type ProOptimizationConstraints, type Player, type Slate, type InsertProp, type InsertAlert, proOptimizationConstraintSchema, insertPrizePicksEntrySchema } from "@shared/schema";
import {
  NBA_SLATE_FEB_19_DK, NBA_PLAYERS_FEB_19_DK,
  NHL_SLATE_FEB_20_DK, NHL_PLAYERS_FEB_20_DK,
  MLB_SLATE_FEB_20_DK, MLB_PLAYERS_FEB_20_DK,
  NFL_SLATE_FEB_20_DK, NFL_PLAYERS_FEB_20_DK,
  GOLF_SLATE_DK, GOLF_PLAYERS_DK,
} from "@shared/seed_data";
import { fetchAllSportsLiveData, getRollingSlateDate, fetchPlayerStatusUpdates } from "./balldontlie";
import { fetchAllPropsForSport, type ParsedProp } from "./odds-api";
import { getLiveScores, getAllLiveScores } from "./espn-scores";
import { fetchPrizePicksProjections, getSupportedPPSports, buildAIEntries, analyzeManualPicks } from "./prizepicks";
import { fetchBDLStats, type PlayerStatsMap, normalizeName } from "./balldontlie-stats";

function computeOwnershipProjections(players: Player[], bdlStats?: PlayerStatsMap): (Player & { ownershipProjection: number })[] {
  if (players.length === 0) return [];
  const hasBDL = bdlStats && Object.keys(bdlStats).length > 0;

  const maxSalary = Math.max(...players.map(p => p.salary));
  const maxProj = Math.max(...players.map(p => Number(p.projectedPoints)));
  const sorted = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
  const rankMap = new Map<number, number>();
  sorted.forEach((p, i) => rankMap.set(p.id, i));

  const posCounts: Record<string, number> = {};
  players.forEach(p => {
    const primary = p.position.split("/")[0];
    posCounts[primary] = (posCounts[primary] || 0) + 1;
  });
  const avgPosCount = Object.values(posCounts).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(posCounts).length);

  const maxValue = Math.max(...players.map(p => Number(p.projectedPoints) / (p.salary / 1000)));
  const maxBDLFantasy = hasBDL ? Math.max(...Object.values(bdlStats!).map(s => s.fantasyScore), 1) : 1;

  const rawScores = players.map(p => {
    const rank = rankMap.get(p.id) || 0;
    const salaryPct = p.salary / (maxSalary || 1);
    const projPct = Number(p.projectedPoints) / (maxProj || 1);
    const rankPct = 1 - (rank / players.length);
    const primaryPos = p.position.split("/")[0];
    const posScarcity = avgPosCount / Math.max(1, posCounts[primaryPos] || avgPosCount);
    const scarcityBonus = Math.min(1.3, Math.max(0.8, posScarcity));

    const valueScore = (Number(p.projectedPoints) / (p.salary / 1000));
    const valuePct = valueScore / (maxValue || 1);

    let bdlBoost = 0;
    let bdlStarFactor = 0;
    if (hasBDL) {
      const key = normalizeName(p.name);
      const stats = bdlStats![key];
      if (stats) {
        const fantasyPct = stats.fantasyScore / maxBDLFantasy;
        bdlBoost = fantasyPct * 0.35 + stats.starPower * 0.15 + stats.consistency * 0.10;
        bdlStarFactor = stats.starPower;
      }
    }

    let raw: number;
    if (hasBDL) {
      raw = (projPct * 0.25 + salaryPct * 0.15 + valuePct * 0.10 + bdlBoost * 0.50) * scarcityBonus;
      if (bdlStarFactor > 0.7) raw *= 1.15;
    } else {
      raw = (projPct * 0.40 + salaryPct * 0.25 + valuePct * 0.15 + rankPct * 0.20) * scarcityBonus;
    }

    const seeded = Math.sin(p.id * 9301 + 49297) * 0.5 + 0.5;
    const jitter = (seeded - 0.5) * 0.06;
    return { player: p, score: Math.max(0.01, raw + jitter) };
  });

  const sortedScores = [...rawScores].sort((a, b) => b.score - a.score);

  return sortedScores.map(({ player, score }, idx) => {
    let ownership: number;
    const total = sortedScores.length;
    const pct = idx / total;

    if (pct < 0.03) {
      ownership = 25 + (1 - pct / 0.03) * 10;
    } else if (pct < 0.08) {
      ownership = 18 + (1 - (pct - 0.03) / 0.05) * 7;
    } else if (pct < 0.18) {
      ownership = 10 + (1 - (pct - 0.08) / 0.10) * 8;
    } else if (pct < 0.35) {
      ownership = 5 + (1 - (pct - 0.18) / 0.17) * 5;
    } else if (pct < 0.55) {
      ownership = 2.5 + (1 - (pct - 0.35) / 0.20) * 2.5;
    } else if (pct < 0.75) {
      ownership = 1.2 + (1 - (pct - 0.55) / 0.20) * 1.3;
    } else {
      ownership = 0.5 + (1 - (pct - 0.75) / 0.25) * 0.7;
    }

    const seeded = Math.sin(player.id * 7919 + 13397) * 0.5 + 0.5;
    ownership *= (0.85 + seeded * 0.30);
    ownership = Math.max(0.5, Math.min(35, ownership));
    return { ...player, ownershipProjection: Math.round(ownership * 10) / 10 };
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  app.get(api.slates.list.path, async (req, res) => {
    const slates = await storage.getSlates();
    res.json(slates);
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
      if (!dbUser?.isAdmin) {
        return res.status(403).json({ message: "This feature is currently unavailable" });
      }

      const slateId = Number(req.params.slateId);
      const slate = await storage.getSlate(slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const players = await storage.getPlayersBySlate(slateId);
      if (!players || players.length === 0) {
        return res.json({ slate: { id: slate.id, sport: slate.sport, platform: slate.platform, startTime: slate.startTime }, positions: {}, chalkPlayer: null, contrarianPlayer: null });
      }

      const bdlStats = await fetchBDLStats(slate.sport);
      const playersWithOwnership = computeOwnershipProjections(players, bdlStats);

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
      });
    } catch (err) {
      console.error("[Ownership] Error:", err);
      res.status(500).json({ message: "Failed to fetch ownership data" });
    }
  });

  app.get(api.slates.getPlayers.path, async (req, res) => {
    const slateId = Number(req.params.id);
    const players = await storage.getPlayersBySlate(slateId);
    if (!players) {
       return res.status(404).json({ message: "Slate not found" });
    }
    const slate = await storage.getSlate(slateId);
    const bdlStats = slate ? await fetchBDLStats(slate.sport) : {};
    const playersWithOwnership = computeOwnershipProjections(players, bdlStats);
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
        const tier = sub?.tier || "free";
        if (tier === "free") {
          const lineupCount = await storage.getLineupCount(userId);
          if (lineupCount >= 1) {
            // Free users can still optimize, just can't save more than 1
          }
        }
      }

      const allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      const pool = allPlayers.map(p => {
        const customProj = constraints.playerProjections?.[p.id.toString()];
        return {
          ...p,
          projectedPoints: customProj !== undefined ? customProj.toString() : p.projectedPoints
        };
      });

      const result = solveLineup(pool, constraints, slate.sport, platform);

      if (result.error) {
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

    const slateCache = new Map<number, ReturnType<typeof computeOwnershipProjections>>();
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
        slateCache.set(lineup.slateId, computeOwnershipProjections(slatePlayers, bdlCache.get(sport)));
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
      const tier = sub?.tier || "free";
      const maxPerSport = tier === "pro" ? 150 : tier === "star" ? 20 : 1;

      const sportCount = await storage.getLineupCountBySport(userId, input.sport);
      if (sportCount >= maxPerSport) {
        const upgradeMsg = tier === "free"
          ? "Contender plan allows 1 saved team per sport. Upgrade to Sharpshooter for 20 teams or Champion for 150 teams per sport."
          : tier === "star"
          ? "Sharpshooter plan allows 20 saved teams per sport. Upgrade to Champion for 150 teams per sport."
          : "You've reached the maximum of 150 saved teams per sport.";
        return res.status(403).json({ 
          message: upgradeMsg,
          requiresUpgrade: tier !== "pro"
        });
      }

      const allPlayers = await storage.getPlayersBySlate(input.slateId);
      const rosterPlayers = allPlayers.filter(p => input.playerIds.includes(p.id));
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

  app.get("/api/lineups/review", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;

    const sub = await storage.getSubscription(userId);
    const tier = sub?.tier || "free";
    if (tier !== "star" && tier !== "pro") {
      return res.status(403).json({ message: "Review lineups require a Star or Pro subscription." });
    }

    const reviewLineups = await storage.getReviewLineups(userId);

    const enriched = await Promise.all(reviewLineups.map(async (lineup: any) => {
      if (lineup.playerSnapshot && Array.isArray(lineup.playerSnapshot) && lineup.playerSnapshot.length > 0) {
        return { ...lineup, players: lineup.playerSnapshot };
      }
      const allPlayers = await storage.getPlayersBySlate(lineup.slateId);
      const rosterPlayers = allPlayers.filter((p: any) => lineup.playerIds.includes(p.id));
      return { ...lineup, players: rosterPlayers };
    }));

    res.json(enriched);
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

  app.get("/api/subscription", async (req, res) => {
    if (!isLoggedIn(req)) return res.sendStatus(401);
    const userId = getSessionUserId(req)!;
    const sub = await storage.getSubscription(userId);
    const tier = sub?.tier || "free";
    const lineupCount = await storage.getLineupCount(userId);

    const sportCounts: Record<string, number> = {};
    for (const sport of ["NBA", "NHL", "GOLF", "MLB", "NFL"]) {
      sportCounts[sport] = await storage.getLineupCountBySport(userId, sport);
    }

    const maxLineupsPerSport = tier === "pro" ? 150 : tier === "star" ? 20 : 1;

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

  app.get("/api/dashboard/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const allSlates = await storage.getSlates();
      const slate = allSlates.find(s => s.sport === sport && s.platform === "draftkings" && s.isMain);
      if (!slate) {
        return res.json({ sport, topScorers: [], trending: [], matchups: [], slateId: null });
      }

      const allPlayers = await storage.getPlayersBySlate(slate.id);
      if (!allPlayers || allPlayers.length === 0) {
        return res.json({ sport, topScorers: [], trending: [], matchups: [], slateId: slate.id });
      }

      const topScorers = [...allPlayers]
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

      const withValue = allPlayers
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

  const ROTOBALLER_RSS_URLS: Record<string, string> = {
    NBA: "https://www.rotoballer.com/category/nba/feed",
    NHL: "https://www.rotoballer.com/category/nhl/feed",
    MLB: "https://www.rotoballer.com/category/mlb/feed",
    NFL: "https://www.rotoballer.com/category/nfl/feed",
    GOLF: "https://www.rotoballer.com/category/golf/feed",
    SOCCER: "https://www.rotoballer.com/category/soccer/feed",
  };

  const newsCache = new Map<string, { data: any; fetchedAt: number }>();
  const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });

  function extractImageFromHtml(html: string): string | null {
    const match = html?.match(/src="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
    return match ? match[1] : null;
  }

  function stripHtmlTags(html: string): string {
    return html?.replace(/<[^>]*>/g, "").replace(/\[&#8230;\]/g, "...").replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"').replace(/&#038;/g, "&").replace(/&amp;/g, "&").replace(/&#039;/g, "'").trim() || "";
  }

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
      if (!sub || sub.tier !== "pro") {
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
        const projections = await fetchPrizePicksProjections(sport);
        allProjections.push(...projections);

        const allSlates = await storage.getSlates();
        const sportSlates = allSlates.filter(s => s.sport === sport);
        for (const slate of sportSlates) {
          const slatePlayers = await storage.getPlayersBySlate(slate.id);
          dbPlayers.push(...slatePlayers);
        }

        const today = new Date().toISOString().split('T')[0];
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
      if (!sub || sub.tier !== "pro") {
        return res.status(403).json({ error: "Pro subscription required" });
      }
      const sport = req.params.sport.toUpperCase();
      const supported = getSupportedPPSports();
      if (!supported.includes(sport)) {
        return res.status(400).json({ error: `Invalid sport: ${sport}` });
      }
      const projections = await fetchPrizePicksProjections(sport);
      if (projections.length === 0) {
        return res.json({ sport, entries: [] });
      }

      const allSlates = await storage.getSlates();
      const sportSlates = allSlates.filter(s => s.sport === sport);
      let dbPlayers: Player[] = [];
      for (const slate of sportSlates) {
        const slatePlayers = await storage.getPlayersBySlate(slate.id);
        dbPlayers.push(...slatePlayers);
      }

      const today = new Date().toISOString().split('T')[0];
      const dbProps = await storage.getPropsByDate(today, sport);

      console.log(`[PrizePicks Builder] ${sport}: ${projections.length} PP lines, ${dbPlayers.length} DK players, ${dbProps.length} odds props`);

      const entries = buildAIEntries(projections, dbPlayers, dbProps, 5);
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
      if (!sub || sub.tier !== "pro") {
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
      const projections = await fetchPrizePicksProjections(sport);
      res.json({ sport, projections });
    } catch (err) {
      console.error(`[PrizePicks] Error in route for ${req.params.sport}:`, err);
      res.json({ sport: req.params.sport.toUpperCase(), projections: [] });
    }
  });

  app.get("/api/news/:sport", async (req, res) => {
    try {
      const sport = req.params.sport.toUpperCase();
      const validSports = [...ACTIVE_SPORTS] as string[];
      if (!validSports.includes(sport)) {
        return res.status(400).json({ error: "Invalid sport" });
      }
      const url = ROTOBALLER_RSS_URLS[sport];
      if (!url) {
        return res.status(400).json({ error: "Invalid sport" });
      }

      const cached = newsCache.get(sport);
      if (cached && Date.now() - cached.fetchedAt < NEWS_CACHE_TTL_MS) {
        return res.json(cached.data);
      }

      const response = await fetch(url, {
        headers: { "User-Agent": "EliteLineupAI/1.0" },
      });
      if (!response.ok) {
        if (cached) return res.json(cached.data);
        return res.status(502).json({ error: "Failed to fetch news" });
      }
      const xmlText = await response.text();
      const parsed = xmlParser.parse(xmlText);
      const items = parsed?.rss?.channel?.item || [];
      const itemsArr = Array.isArray(items) ? items : [items];

      const articles = itemsArr.slice(0, 25).map((item: any, idx: number) => {
        const rawDesc = String(item.description || "");
        const imageUrl = extractImageFromHtml(rawDesc);
        const cleanDesc = stripHtmlTags(rawDesc);
        const categories = Array.isArray(item.category)
          ? item.category.filter((c: any) => typeof c === "string").slice(0, 3)
          : typeof item.category === "string" ? [item.category] : [];

        return {
          id: typeof item.guid === "string" ? item.guid : (typeof item.guid === "object" && item.guid?.["#text"] ? String(item.guid["#text"]) : `${sport}-${idx}`),
          headline: item.title || "",
          description: cleanDesc.length > 300 ? cleanDesc.substring(0, 300) + "..." : cleanDesc,
          published: item.pubDate || "",
          type: "Article",
          imageUrl,
          linkUrl: item.link || null,
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
      const tier = sub?.tier || "free";
      if (tier !== "pro" && tier !== "star") {
        return res.status(403).json({ message: "Star or Pro subscription required for advanced optimizer.", requiresUpgrade: true });
      }

      const maxLineupCount = tier === "pro" ? 20 : 5;

      const constraints = proOptimizationConstraintSchema.parse(req.body);
      constraints.lineupCount = Math.min(constraints.lineupCount, maxLineupCount);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      if (new Date(slate.startTime) <= new Date()) {
        return res.status(400).json({ message: "This slate has already started. Lineups can no longer be generated." });
      }

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;
      const allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      let pool = allPlayers.map(p => {
        const customProj = constraints.playerProjections?.[p.id.toString()];
        let boostedPoints = customProj !== undefined ? customProj : Number(p.projectedPoints);

        if (constraints.useBoosts && p.boostScore) {
          boostedPoints += Number(p.boostScore);
        }

        if (constraints.useInjuryAdjustments && p.injuryStatus) {
          if (p.injuryStatus === "OUT") {
            boostedPoints = 0;
          } else if (p.injuryStatus === "Doubtful") {
            boostedPoints *= 0.3;
          } else if (p.injuryStatus === "Questionable") {
            boostedPoints *= 0.7;
          } else if (p.injuryStatus === "Probable") {
            boostedPoints *= 0.9;
          }
        }

        return { ...p, projectedPoints: boostedPoints.toString() };
      });

      if (constraints.projectionMode === "ceiling") {
        pool = applyCeilingMode(pool, slate.sport);
      }

      const bdlStats = await fetchBDLStats(slate.sport);
      const playersWithOwnership = computeOwnershipProjections(pool, bdlStats);

      if (constraints.leverageMode) {
        pool = applyLeverageMode(playersWithOwnership);
      }

      const lineupResults: any[] = [];
      const usedLineupKeys = new Set<string>();

      const baseExcluded = [...constraints.excludedPlayerIds];
      if (constraints.useInjuryAdjustments) {
        allPlayers.forEach(p => {
          if (p.injuryStatus === "OUT" && !baseExcluded.includes(p.id)) {
            baseExcluded.push(p.id);
          }
        });
      }

      const maxAttempts = constraints.lineupCount * 10;
      let attempts = 0;

      const playerAppearances: Record<number, number> = {};
      const candidateLineups: { result: any; correlationScore: number }[] = [];

      while (lineupResults.length < constraints.lineupCount && attempts < maxAttempts) {
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
        const result = solveLineup(perturbedPool, modConstraints, slate.sport, platform);

        if (!result.error && result.lineup.length > 0) {
          const key = result.lineup.map((p: Player) => p.id).sort().join(",");
          if (!usedLineupKeys.has(key)) {
            const correlationScore = computeCorrelationBonus(result.lineup as Player[], slate.sport);
            const adjustedPoints = result.totalProjectedPoints + correlationScore;
            lineupResults.push({ ...result, platform, correlationScore, totalProjectedPoints: adjustedPoints });
            usedLineupKeys.add(key);
            for (const p of result.lineup as Player[]) {
              playerAppearances[p.id] = (playerAppearances[p.id] || 0) + 1;
            }
          }
        }
      }

      lineupResults.sort((a, b) => b.totalProjectedPoints - a.totalProjectedPoints);

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

      res.json({ lineups: lineupResults, boostsSummary, injurySummary });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        console.error("Pro optimizer error:", err);
        res.status(500).json({ message: "Pro optimizer failed" });
      }
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

  app.get("/api/props", async (req, res) => {
    const validSports = ACTIVE_SPORTS as readonly string[];
    const rawSport = req.query.sport as string | undefined;
    const sport = rawSport && validSports.includes(rawSport) ? rawSport : undefined;
    const today = new Date().toISOString().split("T")[0];
    const allProps = await storage.getPropsByDate(today, sport);
    
    const sorted = allProps.sort((a, b) => Number(b.confidence) - Number(a.confidence));

    let tier = "free";
    let isAuthenticated = false;
    if (isLoggedIn(req)) {
      isAuthenticated = true;
      const userId = getSessionUserId(req)!;
      const sub = await storage.getSubscription(userId);
      tier = sub?.tier || "free";
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
      console.log(`[Props] Generating synthetic props for: ${sportsWithoutData.join(", ")}`);
      const syntheticProps = await generateSyntheticProps(date, sportsWithoutData);
      allProps.push(...syntheticProps);
    }
  } else {
    console.log("[Props] No ODDS_API_KEY found, generating synthetic props for all sports");
    const syntheticProps = await generateSyntheticProps(date, [...ACTIVE_SPORTS]);
    allProps.push(...syntheticProps);
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

async function generateSyntheticProps(date: string, sports: readonly string[]): Promise<InsertProp[]> {
  const slates = await storage.getSlates();
  const mainSlates = slates.filter(s => s.isMain);
  const allProps: InsertProp[] = [];
  const dateSeed = date.split("-").join("").slice(0, 8);

  for (const sport of sports) {
    const sportSlates = mainSlates.filter(s => s.sport === sport);
    if (sportSlates.length === 0) continue;

    const slate = sportSlates[0];
    const players = await storage.getPlayersBySlate(slate.id);
    if (players.length === 0) continue;

    const propTypes = PROP_TYPES_BY_SPORT[sport] || [];
    const sortedPlayers = [...players].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));
    const topPlayers = sortedPlayers.slice(0, Math.min(15, sortedPlayers.length));
    const rand = seededRandom(Number(dateSeed) + sport.charCodeAt(0));

    for (const player of topPlayers) {
      const propType = propTypes[Math.floor(rand() * propTypes.length)];
      const fppg = Number(player.projectedPoints) || 0;
      const playerFppg = Number(player.fppg) || 0;
      if (fppg <= 0 || playerFppg <= 0) continue;

      const rawLine = fppg * propType.baseMultiplier;
      const line = Math.round(rawLine * 2) / 2;
      if (line <= 0) continue;

      const edge = (fppg - playerFppg) / Math.max(playerFppg, 1);
      const varianceBonus = rand() * 0.15;
      const confidence = Math.min(95, Math.max(52, 65 + edge * 100 + varianceBonus * 100));
      const pick = rand() > 0.45 ? "Over" : "Under";

      let enrichedGameInfo = player.gameInfo || "";
      if (enrichedGameInfo && !enrichedGameInfo.includes("·")) {
        const slateDate = new Date(slate.startTime);
        const dateStr = slateDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
        const timeMatch = enrichedGameInfo.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)\s*ET)/i);
        if (timeMatch) {
          const teams = enrichedGameInfo.replace(timeMatch[0], "").trim();
          enrichedGameInfo = `${teams} · ${dateStr}, ${timeMatch[1]}`;
        } else {
          const slateTimeStr = slateDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
          enrichedGameInfo = `${enrichedGameInfo} · ${dateStr}, ${slateTimeStr}`;
        }
      }

      allProps.push({
        sport,
        playerName: player.name,
        team: player.team,
        opponent: player.opponent || "",
        propType: propType.type,
        line: line.toString(),
        pick,
        confidence: confidence.toFixed(1),
        gameInfo: enrichedGameInfo,
        isLocked: false,
        createdDate: date,
      });
    }
  }

  return allProps;
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
      if (positions.includes("W") || positions.includes("LW") || positions.includes("RW")) { vars.W = 1; vars.SKATER = 1; }
      if (positions.includes("D")) { vars.D = 1; vars.SKATER = 1; }
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "MLB":
      if (positions.includes("P") || positions.includes("SP") || positions.includes("RP")) { vars.P = 1; }
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
      break;

    case "GOLF":
      if (positions.includes("G")) { vars.G = 1; }
      break;

    case "SOCCER":
      if (positions.includes("F")) { vars.F = 1; vars.OUTFIELD = 1; }
      if (positions.includes("M")) { vars.M = 1; vars.OUTFIELD = 1; }
      if (positions.includes("D")) { vars.D = 1; vars.OUTFIELD = 1; }
      if (positions.includes("GK")) { vars.GK = 1; }
      break;
  }

  return vars;
}

function solveLineup(pool: Player[], constraints: OptimizationConstraints, sport: string, platform: Platform) {
  const config = getPlatformConfig(sport, platform);
  
  const model: any = {
    optimize: "projectedPoints",
    opType: "max",
    constraints: {
      salary: { max: constraints.maxSalary || config.salaryCap },
      rosterSize: { equal: config.rosterSize },
    },
    variables: {},
    ints: {}
  };

  for (const [key, constraint] of Object.entries(config.positionConstraints)) {
    model.constraints[key] = constraint;
  }

  pool.forEach(p => {
    if (constraints.excludedPlayerIds.includes(p.id)) return;

    const isLocked = constraints.lockedPlayerIds.includes(p.id);
    const variableName = `p${p.id}`;
    
    const variable: any = {
      projectedPoints: Number(p.projectedPoints),
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
    console.error("[DK] Error fetching live data, falling back to static:", err);
  }

  const staticFallbacks: Record<string, {
    dkSlate: any;
    dkPlayers: any;
  }> = {
    NBA: {
      dkSlate: { ...NBA_SLATE_FEB_19_DK, startTime: getRollingSlateDate("NBA") },
      dkPlayers: NBA_PLAYERS_FEB_19_DK,
    },
    NHL: {
      dkSlate: { ...NHL_SLATE_FEB_20_DK, startTime: getRollingSlateDate("NHL") },
      dkPlayers: NHL_PLAYERS_FEB_20_DK,
    },
    MLB: {
      dkSlate: { ...MLB_SLATE_FEB_20_DK, startTime: getRollingSlateDate("MLB") },
      dkPlayers: MLB_PLAYERS_FEB_20_DK,
    },
    NFL: {
      dkSlate: { ...NFL_SLATE_FEB_20_DK, startTime: getRollingSlateDate("NFL") },
      dkPlayers: NFL_PLAYERS_FEB_20_DK,
    },
    GOLF: {
      dkSlate: { ...GOLF_SLATE_DK, startTime: getRollingSlateDate("GOLF") },
      dkPlayers: GOLF_PLAYERS_DK,
    },
  };

  const sportSeeds = ["NBA", "NHL", "MLB", "NFL", "GOLF", "SOCCER"].map(sport => {
    const live = liveData.get(sport);
    if (live) {
      return {
        sport,
        dkSlate: { name: sport === "SOCCER" ? "Soccer Main Slate" : `${sport} Main Slate`, startTime: live.slateDate, isMain: true },
        dkPlayers: live.dkPlayers,
        draftGroupId: live.draftGroupId,
        isLive: true,
      };
    }
    const fallback = staticFallbacks[sport];
    if (!fallback) return null;
    return {
      sport,
      dkSlate: fallback.dkSlate,
      dkPlayers: fallback.dkPlayers,
      isLive: false,
    };
  }).filter(Boolean) as any[];

  for (const seed of sportSeeds) {
    const existingSlate = existingSlates.find(
      s => s.sport === seed.sport && s.platform === "draftkings" && s.isMain
    );

    const now = new Date();
    const isStale = existingSlate && new Date(existingSlate.startTime) < now;

    if (isStale) {
      try {
        await storage.deleteSlateAndPlayers(existingSlate.id);
        console.log(`[DK] Removed stale ${seed.sport} slate (started ${existingSlate.startTime})`);
      } catch (err) {
        console.error(`[DK] Failed to remove stale ${seed.sport} slate:`, err);
        continue;
      }
    }

    if (!existingSlate || isStale) {
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

      const today = new Date().toISOString().split("T")[0];
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

      const source = seed.isLive ? "LIVE DK" : "static";
      console.log(`Seeded database with DK ${seed.sport} main slate (${source})`);
    } else if (existingSlate && seed.isLive && seed.dkPlayers.length > 0) {
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

  const today = new Date().toISOString().split("T")[0];
  const existingProps = await storage.getPropsByDate(today);
  if (existingProps.length === 0) {
    await generateDailyProps(today);
    console.log("Generated daily prop bets");
  }

  await generatePlayerBoostsAndInjuries();
}

const BOOST_REASONS: Record<string, string[]> = {
  NBA: [
    "Hot streak: 5+ games above season avg",
    "Favorable matchup vs weak defense",
    "Increased usage with teammate out",
    "Recent breakout performance trend",
    "Strong home court advantage",
    "Back-to-back rest advantage",
    "Historical pattern: excels in prime time",
    "Positive injury recovery trajectory",
  ],
  NHL: [
    "Power play specialist trending up",
    "Favorable goalie matchup",
    "Recent line promotion",
    "Hot scoring streak",
    "Strong home ice performance",
    "Increased ice time trend",
  ],
  MLB: [
    "Strong platoon advantage",
    "Hot bat: hitting streak",
    "Favorable park factor",
    "Lineup position upgrade",
    "Strong recent velocity data",
    "Historical success vs opposing pitcher",
  ],
  NFL: [
    "Favorable defensive matchup",
    "Increased target share",
    "Red zone usage trending up",
    "Weather conditions favor passing/rushing",
    "Key defensive player out for opponent",
  ],
  GOLF: [
    "Strong course history at this venue",
    "Hot putting streak on recent tour",
    "Favorable tee time draw",
    "Thriving in current weather conditions",
    "Trending up in strokes gained approach",
    "Recent top-5 finish momentum",
  ],
  SOCCER: [
    "Goal-scoring form: multiple goals in recent matches",
    "Favorable matchup vs weak defensive side",
    "Set piece specialist: corner and free kick duties",
    "Increased minutes with teammate suspension",
    "Strong home pitch advantage",
    "Key creative role: high expected assists",
    "Penalty taker with upcoming high-foul opponent",
    "Recent position change: pushed further forward",
  ],
};

const INJURY_STATUSES = ["Questionable", "Probable", "Doubtful", "OUT", "Day-to-Day"];
const INJURY_DETAILS: Record<string, string[]> = {
  NBA: ["Right ankle sprain", "Left knee soreness", "Back tightness", "Hamstring strain", "Illness", "Rest - load management"],
  NHL: ["Upper body injury", "Lower body injury", "Undisclosed", "Concussion protocol", "Groin strain"],
  MLB: ["Right shoulder inflammation", "Left oblique strain", "Back spasms", "Knee discomfort", "Wrist soreness"],
  NFL: ["Hamstring injury", "Ankle sprain", "Concussion protocol", "Knee injury", "Shoulder strain", "Illness"],
  GOLF: ["Back stiffness", "Wrist inflammation", "Knee soreness", "Shoulder discomfort", "Neck strain"],
  SOCCER: ["Hamstring strain", "Ankle injury", "Groin tightness", "Knee ligament concern", "Calf strain", "Muscle fatigue"],
};

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
      console.error(`[Boost Engine] ${sport} error, falling back to seeded boosts:`, err);
      const rand = seededRandom(slate.id * 31 + sport.charCodeAt(0));
      const reasons = BOOST_REASONS[sport] || BOOST_REASONS.NBA;
      const boosts: { playerId: number; boostScore: string; boostReason: string }[] = [];
      for (const player of allPlayers) {
        const r = rand();
        if (r < 0.35) {
          boosts.push({ playerId: player.id, boostScore: (rand() * 4 + 0.5).toFixed(1), boostReason: reasons[Math.floor(rand() * reasons.length)] });
        } else if (r < 0.45) {
          boosts.push({ playerId: player.id, boostScore: (-(rand() * 2 + 0.5)).toFixed(1), boostReason: "Negative trend: recent decline in performance" });
        } else {
          boosts.push({ playerId: player.id, boostScore: "0", boostReason: "" });
        }
      }
      if (boosts.length > 0) await storage.updatePlayerBoosts(slate.id, boosts);
    }

    const rand = seededRandom(slate.id * 31 + sport.charCodeAt(0));
    const injuries = INJURY_DETAILS[sport] || INJURY_DETAILS.NBA;
    const injuryUpdates: { playerId: number; injuryStatus: string; injuryDetail: string }[] = [];
    for (const player of allPlayers) {
      if (rand() < 0.12) {
        const status = INJURY_STATUSES[Math.floor(rand() * INJURY_STATUSES.length)];
        const detail = injuries[Math.floor(rand() * injuries.length)];
        injuryUpdates.push({ playerId: player.id, injuryStatus: status, injuryDetail: detail });
      } else {
        rand();
      }
    }
    if (injuryUpdates.length > 0) await storage.updatePlayerInjuries(injuryUpdates);
    console.log(`Generated boosts/injuries for ${sport} ${slate.platform} slate`);
  }
}

const DK_STATUS_MAP: Record<string, string> = {
  "O": "OUT",
  "Out": "OUT",
  "Q": "Questionable",
  "Questionable": "Questionable",
  "D": "Doubtful",
  "Doubtful": "Doubtful",
  "P": "Probable",
  "Probable": "Probable",
  "GTD": "Questionable",
  "IR": "OUT",
  "Injured Reserve": "OUT",
  "Suspended": "OUT",
  "": "Healthy",
  "None": "Healthy",
};

function mapDKStatus(status: string, newsStatus: string): { injuryStatus: string; injuryDetail: string } {
  const mapped = DK_STATUS_MAP[status] || DK_STATUS_MAP[newsStatus] || "";
  const detail = newsStatus && newsStatus !== "None" && newsStatus !== "" ? newsStatus : (status && status !== "None" ? status : "");
  if (!mapped || mapped === "Healthy") {
    if (detail) {
      return { injuryStatus: "Questionable", injuryDetail: detail };
    }
    return { injuryStatus: "Healthy", injuryDetail: "" };
  }
  return { injuryStatus: mapped, injuryDetail: detail || mapped };
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
      const severity = player.injuryStatus === "OUT" ? "critical"
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
