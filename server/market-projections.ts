// Market-implied projection blending.
//
// Sportsbook player-prop lines are the sharpest public forecast available —
// books move them with information we can't model. This module converts the
// prop lines we already ingest (The Odds API → props table) into implied
// DraftKings fantasy points and blends them into player projections with a
// coverage-based weight: the more markets we have for a player, the more we
// trust the market number.
//
// v1 covers NFL (draft/season focus). Other sports pass through untouched.

import { db } from "./db";
import { props, toNum, type Player } from "@shared/schema";
import { and, eq, gte } from "drizzle-orm";

// DK NFL scoring applied to prop lines (a line ≈ the market's median outcome,
// which we use as expectation — a small bias we accept for v1).
// propType values are the display names written by odds-api.ts.
const NFL_MARKET_POINTS: Record<string, (line: number) => number> = {
  "Pass Yards": (l) => l * 0.04,
  "Pass TDs": (l) => l * 4,
  "Rush Yards": (l) => l * 0.1,
  "Rec Yards": (l) => l * 0.1,
  Receptions: (l) => l * 1.0,
};

// Prop markets don't cover everything (no rush/rec TD market in our feed, no
// INTs, no bonuses). Scale the covered component up by the typical share of
// fantasy points the covered stats represent for the position, so the implied
// total is comparable to a full projection.
//   QB: pass yds + pass TDs ≈ 82% of a QB line (missing rushing, INT drag nets out)
//   RB: yards + receptions ≈ 78% (missing TDs)
//   WR/TE: yards + receptions ≈ 80% (missing TDs)
const POSITION_COVERAGE: Record<string, number> = {
  QB: 0.82,
  RB: 0.78,
  WR: 0.80,
  TE: 0.80,
};

// Blend weight by number of distinct markets backing the implied number.
function marketWeight(numMarkets: number): number {
  if (numMarkets >= 3) return 0.45;
  if (numMarkets === 2) return 0.30;
  return 0.18;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MarketBlendResult {
  blended: number;
  playersWithMarkets: number;
}

/**
 * Blends market-implied projections into `projectedPoints` for players with
 * prop coverage. Mutation mirrors applyActualAdjustedProjections: returns a
 * new array with updated projectedPoints. Safe no-op on error or non-NFL.
 */
export async function applyMarketProjectionBlend(
  players: Player[],
  sport: string,
): Promise<Player[]> {
  if (sport.toUpperCase() !== "NFL" || players.length === 0) return players;

  try {
    // Props refresh hourly; anything from the last 36h is current enough.
    const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(props)
      .where(and(eq(props.sport, "NFL"), gte(props.createdDate, since)));
    if (rows.length === 0) return players;

    // Latest line per player+market.
    const byPlayer = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const key = normalizeName(r.playerName);
      const line = toNum(r.line);
      if (line <= 0) continue;
      const markets = byPlayer.get(key) ?? new Map<string, number>();
      markets.set(r.propType, line); // later rows overwrite → latest wins
      byPlayer.set(key, markets);
    }

    let blendedCount = 0;
    const result = players.map((p) => {
      const base = toNum(p.projectedPoints);
      if (base <= 0) return p;
      const pos = p.position?.split("/")[0]?.toUpperCase() ?? "";
      const coverage = POSITION_COVERAGE[pos];
      if (!coverage) return p; // K/DST: no useful prop coverage

      const markets = byPlayer.get(normalizeName(p.name));
      if (!markets || markets.size === 0) return p;

      let covered = 0;
      let numMarkets = 0;
      for (const [propType, line] of markets) {
        const fn = NFL_MARKET_POINTS[propType];
        if (!fn) continue;
        covered += fn(line);
        numMarkets++;
      }
      if (numMarkets === 0) return p;

      const implied = covered / coverage;

      // Sanity guard: a wildly divergent implied number usually means a name
      // collision or a partial slate line — don't let it poison the pool.
      if (implied < base * 0.4 || implied > base * 2.0) return p;

      const w = marketWeight(numMarkets);
      const blended = (1 - w) * base + w * implied;
      blendedCount++;

      return {
        ...p,
        projectedPoints: blended.toFixed(2),
        // Surfaced for UI/debugging without schema changes.
        marketImpliedPoints: implied.toFixed(2),
        marketBlendWeight: w,
      } as Player;
    });

    if (blendedCount > 0) {
      console.log(`[MarketBlend] NFL: blended prop-implied projections for ${blendedCount} players`);
    }
    return result;
  } catch (err) {
    console.error("[MarketBlend] failed (non-fatal, using base projections):", err);
    return players;
  }
}
