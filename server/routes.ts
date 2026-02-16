import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";
import { getPlatformConfig, type Platform } from "@shared/platform-config";

import { type OptimizationConstraints, type Player, type Slate, type InsertProp } from "@shared/schema";
import {
  NBA_SLATE_FEB_19_DK, NBA_SLATE_FEB_19_FD, NBA_PLAYERS_FEB_19_DK, NBA_PLAYERS_FEB_19_FD,
  NHL_SLATE_FEB_20_DK, NHL_SLATE_FEB_20_FD, NHL_PLAYERS_FEB_20_DK, NHL_PLAYERS_FEB_20_FD,
  MLB_SLATE_FEB_20_DK, MLB_SLATE_FEB_20_FD, MLB_PLAYERS_FEB_20_DK, MLB_PLAYERS_FEB_20_FD,
  NFL_SLATE_FEB_20_DK, NFL_SLATE_FEB_20_FD, NFL_PLAYERS_FEB_20_DK, NFL_PLAYERS_FEB_20_FD,
} from "@shared/seed_data";

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

      if (tier === "pro") {
        const totalCount = await storage.getLineupCount(userId);
        if (totalCount >= 20) {
          return res.status(403).json({ 
            message: "You've reached the maximum of 20 saved lineups.",
            requiresUpgrade: false
          });
        }
      } else {
        const sportCount = await storage.getLineupCountBySport(userId, input.sport);
        if (sportCount >= 1) {
          return res.status(403).json({ 
            message: `Free plan allows 1 saved lineup per sport. Upgrade to Pro for up to 20 lineups.`,
            requiresUpgrade: true
          });
        }
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

    res.json({
      tier,
      status: sub?.status || "active",
      lineupCount,
      maxLineups: tier === "pro" ? 20 : 4,
      sportCounts,
    });
  });

  app.post("/api/admin/seed", async (req, res) => {
    try {
      await seedDatabase();
      res.json({ message: "Database seeded successfully" });
    } catch (err) {
      res.status(500).json({ message: "Seeding failed" });
    }
  });

  app.get("/api/props", async (req, res) => {
    const validSports = ["NBA", "NHL", "MLB", "NFL"];
    const rawSport = req.query.sport as string | undefined;
    const sport = rawSport && validSports.includes(rawSport) ? rawSport : undefined;
    const today = new Date().toISOString().split("T")[0];
    const allProps = await storage.getPropsByDate(today, sport);
    
    const sorted = allProps.sort((a, b) => Number(b.confidence) - Number(a.confidence));

    if (req.isAuthenticated()) {
      const userId = (req.user as any).claims.sub;
      const sub = await storage.getSubscription(userId);
      const tier = sub?.tier || "free";
      if (tier === "pro") {
        return res.json({ props: sorted, tier: "pro", totalCount: sorted.length, freeCount: 3 });
      }
    }

    const freeProps = sorted.filter(p => !p.isLocked).slice(0, 3);
    const lockedCount = sorted.length - freeProps.length;
    res.json({ props: freeProps, tier: "free", totalCount: sorted.length, lockedCount, freeCount: 3 });
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
  
  for (const sport of ["NBA", "NHL", "MLB", "NFL"]) {
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

  const sportSeeds = [
    {
      sport: "NBA",
      dkSlate: NBA_SLATE_FEB_19_DK,
      fdSlate: NBA_SLATE_FEB_19_FD,
      dkPlayers: NBA_PLAYERS_FEB_19_DK,
      fdPlayers: NBA_PLAYERS_FEB_19_FD,
    },
    {
      sport: "NHL",
      dkSlate: NHL_SLATE_FEB_20_DK,
      fdSlate: NHL_SLATE_FEB_20_FD,
      dkPlayers: NHL_PLAYERS_FEB_20_DK,
      fdPlayers: NHL_PLAYERS_FEB_20_FD,
    },
    {
      sport: "MLB",
      dkSlate: MLB_SLATE_FEB_20_DK,
      fdSlate: MLB_SLATE_FEB_20_FD,
      dkPlayers: MLB_PLAYERS_FEB_20_DK,
      fdPlayers: MLB_PLAYERS_FEB_20_FD,
    },
    {
      sport: "NFL",
      dkSlate: NFL_SLATE_FEB_20_DK,
      fdSlate: NFL_SLATE_FEB_20_FD,
      dkPlayers: NFL_PLAYERS_FEB_20_DK,
      fdPlayers: NFL_PLAYERS_FEB_20_FD,
    },
  ];

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
        seed.dkPlayers.map(p => ({ ...p, slateId: dkSlate.id })) as any
      );

      const fdSlate = await storage.createSlate({
        sport: seed.sport,
        platform: "fanduel",
        name: seed.fdSlate.name!,
        startTime: seed.fdSlate.startTime!,
        isMain: true,
      });
      await storage.bulkCreatePlayers(
        seed.fdPlayers.map(p => ({ ...p, slateId: fdSlate.id })) as any
      );

      console.log(`Seeded database with DK and FD ${seed.sport} main slates`);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const existingProps = await storage.getPropsByDate(today);
  if (existingProps.length === 0) {
    await generateDailyProps(today);
    console.log("Generated daily prop bets");
  }
}
