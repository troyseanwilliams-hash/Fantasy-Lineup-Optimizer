import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import solver from "javascript-lp-solver";

import { type OptimizationConstraints, type Player, type Slate } from "@shared/schema";
import { NBA_SLATE_FEB_19, NBA_PLAYERS_FEB_19 } from "@shared/seed_data";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth setup MUST be first
  await setupAuth(app);
  registerAuthRoutes(app);

  // --- Slates ---
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
      
      // Force slateId to match URL (security/integrity)
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


  // --- Optimizer ---
  app.post(api.optimizer.optimize.path, async (req, res) => {
    try {
      const constraints = api.optimizer.optimize.input.parse(req.body);
      const slate = await storage.getSlate(constraints.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const allPlayers = await storage.getPlayersBySlate(constraints.slateId);
      
      if (allPlayers.length === 0) {
        return res.status(400).json({ message: "No players found for this slate" });
      }

      // Apply custom projections if provided
      const pool = allPlayers.map(p => {
        const customProj = constraints.playerProjections?.[p.id.toString()];
        return {
          ...p,
          projectedPoints: customProj !== undefined ? customProj.toString() : p.projectedPoints
        };
      });

      // Use Linear Programming solver for optimal lineup
      const result = solveLineup(pool, constraints, slate.sport);

      if (result.error) {
        return res.status(400).json(result);
      }

      res.json(result);

    } catch (err) {
       if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        console.error(err);
        res.status(500).json({ message: "Optimizer failed" });
      }
    }
  });

  // --- Lineups ---
  app.get(api.lineups.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userId = (req.user as any).claims.sub; // From Replit Auth
    const lineups = await storage.getLineups(userId);
    res.json(lineups);
  });

  app.post(api.lineups.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const input = api.lineups.create.input.parse(req.body);
      const userId = (req.user as any).claims.sub;
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
      
      // Verify ownership
      const userId = (req.user as any).claims.sub;
      if (lineup.userId !== userId) return res.sendStatus(403);
      
      await storage.deleteLineup(id);
      res.sendStatus(204);
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

// Optimization logic using Linear Programming
function solveLineup(pool: Player[], constraints: OptimizationConstraints, sport: string) {
  const model: any = {
    optimize: "projectedPoints",
    opType: "max",
    constraints: {
      salary: { max: constraints.maxSalary || 50000 },
      rosterSize: { equal: sport === 'NBA' ? 8 : 9 },
    },
    variables: {},
    ints: {}
  };

  // Add positional constraints
  if (sport === 'NBA') {
    // DraftKings NBA: PG, SG, SF, PF, C, G, F, Util
    model.constraints.PG = { min: 1 };
    model.constraints.SG = { min: 1 };
    model.constraints.SF = { min: 1 };
    model.constraints.PF = { min: 1 };
    model.constraints.C = { min: 1 };
    model.constraints.G = { min: 1 }; // G = PG or SG
    model.constraints.F = { min: 1 }; // F = SF or PF
  } else {
    // NFL: QB, RB, RB, WR, WR, WR, TE, FLEX, DST
    model.constraints.QB = { equal: 1 };
    model.constraints.RB = { min: 2 };
    model.constraints.WR = { min: 3 };
    model.constraints.TE = { min: 1 };
    model.constraints.DST = { equal: 1 };
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

    // Position handling
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

    if (isLocked) {
      model.constraints[variableName] = { equal: 1 };
      model.variables[variableName][variableName] = 1;
    }
  });

  const result = solver.Solve(model);

  if (!result.feasible) {
    return { error: "Could not find a feasible lineup with these constraints.", lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }

  const selectedPlayerIds = Object.keys(result)
    .filter(k => k.startsWith('p') && result[k] === 1)
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

// --- SEED DATA ---
export async function seedDatabase() {
  const existingSlates = await storage.getSlates();
  const nbaSlateExists = existingSlates.some(s => s.name === "NBA Feb 19 Main Slate");

  if (!nbaSlateExists) {
    // NFL Slate (keep existing or update)
    const nflSlate = await storage.createSlate({
      sport: "NFL",
      name: "NFL Main Slate",
      startTime: new Date(Date.now() + 86400000)
    });

    const nflPositions = ["QB", "RB", "WR", "TE", "DST"];
    const nflPlayers: any[] = [];
    for (let i = 1; i <= 40; i++) {
      const pos = nflPositions[i % 5];
      const salary = 3000 + Math.floor(Math.random() * 60) * 100;
      const fppg = (5 + Math.random() * 20).toFixed(1);
      nflPlayers.push({
        slateId: nflSlate.id,
        name: `NFL Player ${i}`,
        team: "TEAM",
        position: pos,
        salary,
        fppg,
        projectedPoints: fppg,
        opponent: "OPP",
        gameInfo: "TEAM @ OPP"
      });
    }
    await storage.bulkCreatePlayers(nflPlayers);

    // Current Real NBA Slate for Feb 19
    const nbaSlate = await storage.createSlate({
      sport: "NBA",
      name: NBA_SLATE_FEB_19.name,
      startTime: NBA_SLATE_FEB_19.startTime
    });

    const playersWithSlate = NBA_PLAYERS_FEB_19.map(p => ({
      ...p,
      slateId: nbaSlate.id
    }));
    await storage.bulkCreatePlayers(playersWithSlate as any);

    console.log("Seeded database with Feb 19 NBA slate and sample NFL data");
  }
}
