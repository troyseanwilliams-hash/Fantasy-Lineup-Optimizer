import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";
import { getPlatformConfig, ACTIVE_SPORTS, assignPlayersToSlots, type Platform } from "@shared/platform-config";

import { type OptimizationConstraints, type ProOptimizationConstraints, type Player, type Slate, type InsertProp, type InsertAlert, proOptimizationConstraintSchema } from "@shared/schema";
import {
  NBA_SLATE_FEB_19_DK, NBA_PLAYERS_FEB_19_DK,
  NHL_SLATE_FEB_20_DK, NHL_PLAYERS_FEB_20_DK,
  MLB_SLATE_FEB_20_DK, MLB_PLAYERS_FEB_20_DK,
  NFL_SLATE_FEB_20_DK, NFL_PLAYERS_FEB_20_DK,
} from "@shared/seed_data";
import { fetchAllSportsLiveData, getRollingSlateDate } from "./balldontlie";

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

  app.get(api.slates.getPlayers.path, async (req, res) => {
    const slateId = Number(req.params.id);
    const players = await storage.getPlayersBySlate(slateId);
    if (!players) {
       return res.status(404).json({ message: "Slate not found" });
    }
    res.json(players);
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

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;

      if (req.isAuthenticated()) {
        const userId = (req.user as any).claims.sub;
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
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
    const lineups = await storage.getLineups(userId);
    res.json(lineups);
  });

  app.post(api.lineups.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const input = api.lineups.create.input.parse(req.body);
      const userId = (req.user as any).claims.sub;

      const sub = await storage.getSubscription(userId);
      const tier = sub?.tier || "free";
      const maxPerSport = tier === "pro" ? 150 : tier === "star" ? 20 : 1;

      const sportCount = await storage.getLineupCountBySport(userId, input.sport);
      if (sportCount >= maxPerSport) {
        const upgradeMsg = tier === "free"
          ? "Free plan allows 1 saved team per sport. Upgrade to Star for 20 teams or Pro for 150 teams per sport."
          : tier === "star"
          ? "Star plan allows 20 saved teams per sport. Upgrade to Pro for 150 teams per sport."
          : "You've reached the maximum of 150 saved teams per sport.";
        return res.status(403).json({ 
          message: upgradeMsg,
          requiresUpgrade: tier !== "pro"
        });
      }

      const lineup = await storage.createLineup({ ...input, userId });
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
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = Number(req.params.id);
    const lineup = await storage.getLineup(id);
    if (!lineup) return res.sendStatus(404);
    const userId = (req.user as any).claims.sub;
    if (lineup.userId !== userId) return res.sendStatus(403);

    const allPlayers = await storage.getPlayersBySlate(lineup.slateId);
    const rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));
    res.json({ ...lineup, players: rosterPlayers, allPlayers });
  });

  app.patch("/api/lineups/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const id = Number(req.params.id);
    const lineup = await storage.getLineup(id);
    if (!lineup) return res.sendStatus(404);
    const userId = (req.user as any).claims.sub;
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

    const updated = await storage.updateLineup(id, {
      playerIds,
      totalSalary,
      totalProjectedPoints: totalProjectedPoints.toFixed(1),
    });

    res.json({ ...updated, players: rosterPlayers });
  });

  app.delete(api.lineups.delete.path, async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      const id = Number(req.params.id);
      const lineup = await storage.getLineup(id);
      if (!lineup) return res.sendStatus(404);
      const userId = (req.user as any).claims.sub;
      if (lineup.userId !== userId) return res.sendStatus(403);
      await storage.deleteLineup(id);
      res.sendStatus(204);
  });

  app.get("/api/subscription", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
    const sub = await storage.getSubscription(userId);
    const tier = sub?.tier || "free";
    const lineupCount = await storage.getLineupCount(userId);

    const sportCounts: Record<string, number> = {};
    for (const sport of ["NBA", "NHL", "MLB", "NFL"]) {
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
    });
  });

  app.post("/api/admin/seed", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
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
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
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

  const ESPN_NEWS_URLS: Record<string, string> = {
    NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news",
    NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news",
    MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news",
    NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news",
  };

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
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).json({ error: "Failed to fetch news" });
      }
      const data = await response.json() as any;
      const articles = (data.articles || []).map((a: any) => ({
        id: a.dataSourceIdentifier || String(a.links?.web?.href || Math.random()),
        headline: a.headline || "",
        description: a.description || "",
        published: a.published || "",
        type: a.type || "Article",
        imageUrl: a.images?.[0]?.url || null,
        linkUrl: a.links?.web?.href || null,
        categories: (a.categories || []).map((c: any) => c.description || c.type).filter(Boolean),
      }));
      res.json({ sport, articles });
    } catch (err) {
      console.error("News fetch error:", err);
      res.status(500).json({ error: "Failed to fetch news" });
    }
  });

  app.post("/api/optimize/pro", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      const userId = (req.user as any).claims.sub;
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

      const platform = (constraints.platform || slate.platform || "draftkings") as Platform;
      const allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      const pool = allPlayers.map(p => {
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

      const lineupResults = [];
      const usedPlayerSets: Set<string>[] = [];

      for (let i = 0; i < constraints.lineupCount; i++) {
        const perturbedPool = pool.map(p => {
          if (constraints.excludedPlayerIds.includes(p.id)) return p;
          const base = Number(p.projectedPoints);
          const noise = (Math.random() - 0.5) * base * 0.12 * (i > 0 ? 1 : 0);
          return { ...p, projectedPoints: Math.max(0, base + noise).toString() };
        });

        const excluded = [...constraints.excludedPlayerIds];
        if (constraints.useInjuryAdjustments) {
          allPlayers.forEach(p => {
            if (p.injuryStatus === "OUT" && !excluded.includes(p.id)) {
              excluded.push(p.id);
            }
          });
        }

        const modConstraints = { ...constraints, excludedPlayerIds: excluded };
        const result = solveLineup(perturbedPool, modConstraints, slate.sport, platform);

        if (!result.error) {
          const key = result.lineup.map(p => p.id).sort().join(",");
          const isDuplicate = usedPlayerSets.some(s => s.has(key));
          if (!isDuplicate) {
            lineupResults.push({ ...result, platform });
            usedPlayerSets.push(new Set([key]));
          } else if (i < constraints.lineupCount + 5) {
            continue;
          }
        }

        if (lineupResults.length >= constraints.lineupCount) break;
      }

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
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
    const allAlerts = await storage.getAlerts(userId);
    const unreadCount = await storage.getUnreadAlertCount(userId);
    res.json({ alerts: allAlerts, unreadCount });
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
    await storage.markAlertRead(Number(req.params.id), userId);
    res.sendStatus(204);
  });

  app.post("/api/alerts/read-all", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub;
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
    if (req.isAuthenticated()) {
      const userId = (req.user as any).claims.sub;
      const sub = await storage.getSubscription(userId);
      tier = sub?.tier || "free";
    }

    const maxPerSport = tier === "pro" ? 15 : tier === "star" ? 8 : 2;

    const propsBySport: Record<string, typeof sorted> = {};
    for (const prop of sorted) {
      if (!propsBySport[prop.sport]) propsBySport[prop.sport] = [];
      propsBySport[prop.sport].push(prop);
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
      visibleProps.push(...sportProps.slice(0, maxPerSport));
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
  
  const slates = await storage.getSlates();
  const mainSlates = slates.filter(s => s.isMain);
  const allProps: InsertProp[] = [];
  const dateSeed = date.split("-").join("").slice(0, 8);
  
  for (const sport of ACTIVE_SPORTS) {
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

      allProps.push({
        sport,
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        opponent: player.opponent || "",
        propType: propType.type,
        line: line.toString(),
        pick,
        confidence: confidence.toFixed(1),
        gameInfo: player.gameInfo || "",
        isLocked: false,
        createdDate: date,
      });
    }
  }

  allProps.sort((a, b) => Number(b.confidence) - Number(a.confidence));

  const FREE_PICKS = 3;
  for (let i = 0; i < allProps.length; i++) {
    allProps[i].isLocked = i >= FREE_PICKS;
  }

  if (allProps.length > 0) {
    await storage.bulkCreateProps(allProps);
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
  };

  const sportSeeds = ["NBA", "NHL", "MLB", "NFL"].map(sport => {
    const live = liveData.get(sport);
    if (live) {
      return {
        sport,
        dkSlate: { name: `${sport} Main Slate`, startTime: live.slateDate, isMain: true },
        dkPlayers: live.dkPlayers,
        isLive: true,
      };
    }
    const fallback = staticFallbacks[sport];
    return {
      sport,
      dkSlate: fallback.dkSlate,
      dkPlayers: fallback.dkPlayers,
      isLive: false,
    };
  });

  for (const seed of sportSeeds) {
    const slateExists = existingSlates.some(
      s => s.sport === seed.sport && s.platform === "draftkings" && s.isMain
    );

    if (!slateExists) {
      const dkSlate = await storage.createSlate({
        sport: seed.sport,
        platform: "draftkings",
        name: seed.dkSlate.name!,
        startTime: seed.dkSlate.startTime!,
        isMain: true,
      });
      await storage.bulkCreatePlayers(
        seed.dkPlayers.map((p: any) => ({ ...p, slateId: dkSlate.id })) as any
      );

      const source = seed.isLive ? "LIVE DK" : "static";
      console.log(`Seeded database with DK ${seed.sport} main slate (${source})`);
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
};

const INJURY_STATUSES = ["Questionable", "Probable", "Doubtful", "OUT", "Day-to-Day"];
const INJURY_DETAILS: Record<string, string[]> = {
  NBA: ["Right ankle sprain", "Left knee soreness", "Back tightness", "Hamstring strain", "Illness", "Rest - load management"],
  NHL: ["Upper body injury", "Lower body injury", "Undisclosed", "Concussion protocol", "Groin strain"],
  MLB: ["Right shoulder inflammation", "Left oblique strain", "Back spasms", "Knee discomfort", "Wrist soreness"],
  NFL: ["Hamstring injury", "Ankle sprain", "Concussion protocol", "Knee injury", "Shoulder strain", "Illness"],
};

export async function generatePlayerBoostsAndInjuries() {
  const allSlates = await storage.getSlates();
  const mainSlates = allSlates.filter(s => s.isMain);

  for (const slate of mainSlates) {
    const allPlayers = await storage.getPlayersBySlate(slate.id);
    const alreadyBoosted = allPlayers.some(p => p.boostScore !== null);
    if (alreadyBoosted) continue;

    const sport = slate.sport;
    const rand = seededRandom(slate.id * 31 + sport.charCodeAt(0));
    const reasons = BOOST_REASONS[sport] || BOOST_REASONS.NBA;
    const injuries = INJURY_DETAILS[sport] || INJURY_DETAILS.NBA;

    const boosts: { playerId: number; boostScore: string; boostReason: string }[] = [];
    const injuryUpdates: { playerId: number; injuryStatus: string; injuryDetail: string }[] = [];

    const sorted = [...allPlayers].sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints));

    for (let i = 0; i < sorted.length; i++) {
      const player = sorted[i];
      const r = rand();

      if (r < 0.35) {
        const boostAmount = (rand() * 4 + 0.5).toFixed(1);
        const reason = reasons[Math.floor(rand() * reasons.length)];
        boosts.push({ playerId: player.id, boostScore: boostAmount, boostReason: reason });
      } else if (r < 0.45) {
        const boostAmount = (-(rand() * 2 + 0.5)).toFixed(1);
        const reason = "Negative trend: recent decline in performance";
        boosts.push({ playerId: player.id, boostScore: boostAmount, boostReason: reason });
      } else {
        boosts.push({ playerId: player.id, boostScore: "0", boostReason: "" });
      }

      if (rand() < 0.12) {
        const status = INJURY_STATUSES[Math.floor(rand() * INJURY_STATUSES.length)];
        const detail = injuries[Math.floor(rand() * injuries.length)];
        injuryUpdates.push({ playerId: player.id, injuryStatus: status, injuryDetail: detail });
      }
    }

    if (boosts.length > 0) await storage.updatePlayerBoosts(slate.id, boosts);
    if (injuryUpdates.length > 0) await storage.updatePlayerInjuries(injuryUpdates);
    console.log(`Generated boosts/injuries for ${sport} ${slate.platform} slate`);
  }
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
