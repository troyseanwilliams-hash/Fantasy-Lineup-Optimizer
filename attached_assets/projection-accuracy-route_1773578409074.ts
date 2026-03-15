/**
 * Projection Accuracy Routes
 *
 * Mines player-level accuracy data from the winning_lineups table
 * (stored as insights.projectionAccuracy JSON per slate).
 *
 * Add to your main router file:
 *   import { projectionAccuracyRouter } from "./projection-accuracy-route";
 *   app.use(projectionAccuracyRouter);
 */

import { Router } from "express";
import { storage } from "./storage";

export const projectionAccuracyRouter = Router();

// ── In-process cache so we don't re-aggregate on every request ───────────────
interface PlayerAccuracy {
  playerName:      string;
  sport:           string;
  slatesAnalyzed:  number;
  hitRate:         number;   // pct of slates player beat their projection
  avgDelta:        number;   // avg (actual - projected) in fantasy points
  avgRatio:        number;   // avg (actual / projected) ratio
  lastUpdated:     string;
}

const accuracyCache = new Map<string, { data: PlayerAccuracy[]; timestamp: number }>();
const ACCURACY_CACHE_TTL = 10 * 60 * 1000; // 10 min

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

async function buildAccuracyIndex(sport: string): Promise<PlayerAccuracy[]> {
  const cacheKey = `acc_${sport}`;
  const cached = accuracyCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < ACCURACY_CACHE_TTL) {
    return cached.data;
  }

  // Pull all winning lineups for this sport — they contain projectionAccuracy
  // in their insights JSON (populated by the winning lineup agent).
  const allLineups = await storage.getWinningLineupsBySport(sport);

  // Aggregate per player across all slates
  const playerMap = new Map<string, {
    name: string;
    slates: number;
    hits: number;       // slates where actual > projected
    totalDelta: number;
    totalRatio: number;
  }>();

  for (const lineup of allLineups) {
    const insights = lineup.insights as any;
    const projAccuracy: Array<{
      name: string;
      projected: number;
      actual: number;
      diff: number;
      ratio: number;
    }> = insights?.projectionAccuracy || [];

    for (const entry of projAccuracy) {
      // Skip entries with no real data
      if (!entry.projected || entry.projected === 0) continue;

      const key = normalizeName(entry.name);
      const existing = playerMap.get(key) || {
        name: entry.name,
        slates: 0,
        hits: 0,
        totalDelta: 0,
        totalRatio: 0,
      };

      existing.slates++;
      if (entry.actual > entry.projected) existing.hits++;
      existing.totalDelta += entry.diff;
      existing.totalRatio += entry.ratio;
      playerMap.set(key, existing);
    }
  }

  const results: PlayerAccuracy[] = [];
  for (const [, data] of playerMap) {
    if (data.slates < 2) continue; // Need at least 2 data points to be meaningful
    results.push({
      playerName:     data.name,
      sport,
      slatesAnalyzed: data.slates,
      hitRate:        Math.round((data.hits / data.slates) * 100),
      avgDelta:       Math.round((data.totalDelta / data.slates) * 10) / 10,
      avgRatio:       Math.round((data.totalRatio / data.slates) * 100) / 100,
      lastUpdated:    new Date().toISOString(),
    });
  }

  // Sort by most slates analyzed (most reliable data first)
  results.sort((a, b) => b.slatesAnalyzed - a.slatesAnalyzed);

  accuracyCache.set(cacheKey, { data: results, timestamp: Date.now() });
  return results;
}

// ── GET /api/projection-accuracy/:sport ──────────────────────────────────────
// Returns the full accuracy index for a sport.
// Used by the optimizer to populate hit-rate badges in the player table.

projectionAccuracyRouter.get("/api/projection-accuracy/:sport", async (req, res) => {
  try {
    const sport = req.params.sport.toUpperCase();
    const data = await buildAccuracyIndex(sport);
    res.json({ sport, players: data, count: data.length });
  } catch (err) {
    console.error("[ProjectionAccuracy] Error:", err);
    res.status(500).json({ message: "Failed to build accuracy index" });
  }
});

// ── GET /api/projection-accuracy/:sport/:playerName ───────────────────────────
// Single-player lookup. Useful for hover cards.

projectionAccuracyRouter.get("/api/projection-accuracy/:sport/:playerName", async (req, res) => {
  try {
    const sport      = req.params.sport.toUpperCase();
    const playerName = decodeURIComponent(req.params.playerName);
    const data       = await buildAccuracyIndex(sport);

    const normalized = normalizeName(playerName);
    const match = data.find(p => normalizeName(p.playerName) === normalized)
               || data.find(p => normalizeName(p.playerName).includes(normalized.split(" ").slice(-1)[0]));

    if (!match) return res.status(404).json({ message: "No accuracy data for this player" });
    res.json(match);
  } catch (err) {
    console.error("[ProjectionAccuracy] Error:", err);
    res.status(500).json({ message: "Failed to look up player accuracy" });
  }
});

// ── POST /api/projection-accuracy/cache/clear ─────────────────────────────────
// Admin endpoint — forces a rebuild on next request.

projectionAccuracyRouter.post("/api/projection-accuracy/cache/clear", async (req, res) => {
  accuracyCache.clear();
  res.json({ message: "Accuracy cache cleared" });
});
