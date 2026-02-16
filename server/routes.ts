import type { Express } from "express";
import type { Server } from "http";
import { createServer } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";

// Optimization logic (simple greedy + random sort for MVP, in a real app use ILP solver)
// Since we don't have 'javascript-lp-solver' installed yet, I'll write a simple heuristic.
import { type OptimizationConstraints, type Player } from "@shared/schema";

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

      // Simple Constraint Solver (Heuristic for MVP)
      // In a real production app, use 'javascript-lp-solver'
      const result = solveLineup(pool, constraints);

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

  // Initialize seed data
  await seedDatabase();

  return httpServer;
}

// --- Simple Heuristic Solver ---
// NOTE: This is a placeholder. Real DFS optimization requires Knapsack/ILP solvers.
// We'll filter, sort by value (Points/Salary), and fill slots.
function solveLineup(pool: Player[], constraints: OptimizationConstraints) {
  // 1. Filter excluded players
  let available = pool.filter(p => !constraints.excludedPlayerIds.includes(p.id));
  
  // 2. Separate locked players
  const locked = available.filter(p => constraints.lockedPlayerIds.includes(p.id));
  available = available.filter(p => !constraints.lockedPlayerIds.includes(p.id));

  // 3. Define Roster Spots (Example: NFL Classic)
  // For MVP generic, we'll try to just maximize points under salary cap
  // Assuming a generic roster size of 9 for now (DK NFL Style)
  // QB, RB, RB, WR, WR, WR, TE, FLEX, DST
  // NOTE: A proper solver needs strict positional requirements.
  
  // Let's implement a simplified "Generic Flex" optimization for MVP demo
  // We just want highest points for < $50,000 salary with 9 players.
  
  const SALARY_CAP = constraints.maxSalary || 50000;
  const ROSTER_SIZE = 9;
  
  let currentLineup = [...locked];
  let currentSalary = currentLineup.reduce((sum, p) => sum + p.salary, 0);
  
  if (currentSalary > SALARY_CAP) {
    return { error: "Locked players exceed salary cap", lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }
  
  // Sort remaining by Value (Points / Salary) to greedy fill
  // Add some randomness to avoid identical lineups every time if value is close
  available.sort((a, b) => {
      const valA = Number(a.projectedPoints) / a.salary;
      const valB = Number(b.projectedPoints) / b.salary;
      return valB - valA; // Descending
  });

  for (const player of available) {
    if (currentLineup.length >= ROSTER_SIZE) break;
    if (currentSalary + player.salary <= SALARY_CAP) {
      currentLineup.push(player);
      currentSalary += player.salary;
    }
  }

  if (currentLineup.length < ROSTER_SIZE) {
     return { error: "Could not fill roster with valid players under cap.", lineup: [], totalSalary: 0, totalProjectedPoints: 0 };
  }

  const totalPoints = currentLineup.reduce((sum, p) => sum + Number(p.projectedPoints), 0);
  
  return {
    lineup: currentLineup,
    totalSalary: currentSalary,
    totalProjectedPoints: totalPoints
  };
}

// --- SEED DATA ---
export async function seedDatabase() {
    const existingSlates = await storage.getSlates();
    if (existingSlates.length === 0) {
        const slate = await storage.createSlate({
            sport: "NFL",
            name: "Week 1 Main Slate",
            startTime: new Date(Date.now() + 86400000) // Tomorrow
        });
        
        // Seed some players
        const teams = ["KC", "BUF", "PHI", "DAL", "SF", "CIN"];
        const positions = ["QB", "RB", "WR", "TE", "DST"];
        
        const players: any[] = [];
        
        // Generate 50 dummy players
        for(let i=1; i<=50; i++) {
            const pos = positions[Math.floor(Math.random() * positions.length)];
            const team = teams[Math.floor(Math.random() * teams.length)];
            const salary = 3000 + Math.floor(Math.random() * 60) * 100; // 3000 - 9000
            const fppg = 5 + Math.random() * 20;
            
            players.push({
                slateId: slate.id,
                name: `Player ${i} (${pos})`,
                team: team,
                position: pos,
                salary: salary,
                fppg: fppg.toFixed(1),
                projectedPoints: (fppg * (0.9 + Math.random() * 0.2)).toFixed(1), // +/- 10% of FPPG
                opponent: "OPP",
                gameInfo: `${team} vs OPP`
            });
        }
        
        await storage.bulkCreatePlayers(players);
        console.log("Seeded database with slate and players");
    }
}
