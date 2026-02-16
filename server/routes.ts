import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";
import { getPlatformConfig, type Platform } from "@shared/platform-config";

import { type OptimizationConstraints, type Player, type Slate } from "@shared/schema";
import { NBA_SLATE_FEB_19_DK, NBA_SLATE_FEB_19_FD, NBA_PLAYERS_FEB_19_DK, NBA_PLAYERS_FEB_19_FD } from "@shared/seed_data";

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
      const lineupCount = await storage.getLineupCount(userId);
      const maxLineups = tier === "pro" ? 20 : 1;

      if (lineupCount >= maxLineups) {
        return res.status(403).json({ 
          message: tier === "free" 
            ? "Free plan allows 1 saved lineup. Upgrade to Pro for up to 20 lineups." 
            : "You've reached the maximum of 20 saved lineups.",
          requiresUpgrade: tier === "free"
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
    const lineupCount = await storage.getLineupCount(userId);
    res.json({
      tier: sub?.tier || "free",
      status: sub?.status || "active",
      lineupCount,
      maxLineups: (sub?.tier === "pro") ? 20 : 1,
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

  return httpServer;
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
    };

    if (sport === 'NBA') {
      if (p.position.includes('PG')) { variable.PG = 1; variable.G = 1; }
      if (p.position.includes('SG')) { variable.SG = 1; variable.G = 1; }
      if (p.position.includes('SF')) { variable.SF = 1; variable.F = 1; }
      if (p.position.includes('PF')) { variable.PF = 1; variable.F = 1; }
      if (p.position.includes('C')) { variable.C = 1; }
    } else {
      variable[p.position] = 1;
    }

    model.variables[variableName] = variable;
    model.ints[variableName] = 1;

    model.constraints[`bound_${variableName}`] = { max: 1 };
    variable[`bound_${variableName}`] = 1;

    if (isLocked) {
      model.constraints[`lock_${variableName}`] = { equal: 1 };
      variable[`lock_${variableName}`] = 1;
    }
  });

  const result = solver.Solve(model);

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

export async function seedDatabase() {
  const existingSlates = await storage.getSlates();
  const dkSlateExists = existingSlates.some(s => s.name === "NBA Main Slate" && s.platform === "draftkings");

  if (!dkSlateExists) {
    const dkSlate = await storage.createSlate({
      sport: "NBA",
      platform: "draftkings",
      name: "NBA Main Slate",
      startTime: new Date("2026-02-19T19:00:00-05:00"),
      isMain: true,
    });

    const dkPlayers = NBA_PLAYERS_FEB_19_DK.map(p => ({
      ...p,
      slateId: dkSlate.id
    }));
    await storage.bulkCreatePlayers(dkPlayers as any);

    const fdSlate = await storage.createSlate({
      sport: "NBA",
      platform: "fanduel",
      name: "NBA Main Slate",
      startTime: new Date("2026-02-19T19:00:00-05:00"),
      isMain: true,
    });

    const fdPlayers = NBA_PLAYERS_FEB_19_FD.map(p => ({
      ...p,
      slateId: fdSlate.id
    }));
    await storage.bulkCreatePlayers(fdPlayers as any);

    console.log("Seeded database with DK and FD NBA main slates");
  }
}
