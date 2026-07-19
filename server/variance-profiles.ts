// Empirical variance profiles for the Monte Carlo engine.
//
// Instead of assuming a fixed coefficient of variation per position, we
// measure it: player_history stores both the projection we published and the
// actual points scored. The dispersion of actual/projected ratios per
// position (and projection tier) IS the real-world variance of our own
// projections — exactly what the simulator should be sampling from.
//
// Sync read / async refresh: the sim engine is synchronous, so profiles live
// in an in-memory cache. The first getEmpiricalCV() call for a sport kicks
// off a background refresh; until it lands, callers fall back to the static
// table. Refreshes every 12h thereafter.

import { db } from "./db";
import { playerHistory, toNum } from "@shared/schema";
import { and, eq, gte, isNotNull } from "drizzle-orm";

// Projection tiers: variance differs a lot between studs and punts.
type Tier = "low" | "mid" | "high";
function tierOf(proj: number): Tier {
  if (proj >= 18) return "high";
  if (proj >= 9) return "mid";
  return "low";
}

const MIN_SAMPLES_TIER = 40; // per position+tier bucket
const MIN_SAMPLES_POS = 80; // position-only fallback bucket
const REFRESH_MS = 12 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 120;
const CV_FLOOR = 0.15;
const CV_CEIL = 0.85;
// Guard rail: blend empirical with the static prior so a weird data window
// can't swing the sim wildly.
const EMPIRICAL_WEIGHT = 0.7;

interface SportProfiles {
  byPosTier: Map<string, number>; // "QB|high" -> cv
  byPos: Map<string, number>; // "QB" -> cv
  fetchedAt: number;
  refreshing: boolean;
}

const cache = new Map<string, SportProfiles>();

function std(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const v = values.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (values.length - 1);
  return Math.sqrt(v);
}

async function refreshProfiles(sport: string): Promise<void> {
  const entry = cache.get(sport);
  if (entry) entry.refreshing = true;
  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = await db
      .select({
        position: playerHistory.position,
        projectedPoints: playerHistory.projectedPoints,
        actualPoints: playerHistory.actualPoints,
      })
      .from(playerHistory)
      .where(
        and(
          eq(playerHistory.sport, sport),
          gte(playerHistory.slateDate, since),
          isNotNull(playerHistory.actualPoints),
        ),
      )
      .limit(50000);

    // Ratio samples per bucket. Ratios capped to [0, 4] to keep one fluke
    // game from dominating a bucket's variance.
    const tierSamples = new Map<string, number[]>();
    const posSamples = new Map<string, number[]>();
    for (const r of rows) {
      const proj = toNum(r.projectedPoints);
      const actual = toNum(r.actualPoints);
      if (proj < 4) continue; // ratios explode on tiny projections
      const ratio = Math.min(4, Math.max(0, actual / proj));
      const pos = r.position?.split("/")[0]?.toUpperCase() ?? "UTIL";
      const tKey = `${pos}|${tierOf(proj)}`;
      (tierSamples.get(tKey) ?? tierSamples.set(tKey, []).get(tKey)!).push(ratio);
      (posSamples.get(pos) ?? posSamples.set(pos, []).get(pos)!).push(ratio);
    }

    const byPosTier = new Map<string, number>();
    for (const [key, samples] of tierSamples) {
      if (samples.length < MIN_SAMPLES_TIER) continue;
      const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
      if (mean <= 0.2) continue;
      // CV of outcomes around the projection: std of ratios normalized by
      // mean ratio (projection bias is handled elsewhere — boost engine).
      byPosTier.set(key, Math.min(CV_CEIL, Math.max(CV_FLOOR, std(samples, mean) / mean)));
    }
    const byPos = new Map<string, number>();
    for (const [pos, samples] of posSamples) {
      if (samples.length < MIN_SAMPLES_POS) continue;
      const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
      if (mean <= 0.2) continue;
      byPos.set(pos, Math.min(CV_CEIL, Math.max(CV_FLOOR, std(samples, mean) / mean)));
    }

    cache.set(sport, { byPosTier, byPos, fetchedAt: Date.now(), refreshing: false });
    console.log(
      `[VarianceProfiles] ${sport}: ${byPosTier.size} pos+tier buckets, ${byPos.size} pos buckets from ${rows.length} history rows`,
    );
  } catch (err) {
    console.error(`[VarianceProfiles] refresh failed for ${sport} (non-fatal):`, err);
    const e = cache.get(sport);
    if (e) e.refreshing = false;
    else cache.set(sport, { byPosTier: new Map(), byPos: new Map(), fetchedAt: Date.now(), refreshing: false });
  }
}

/**
 * Empirical CV for a position + projection, blended 70/30 with the caller's
 * static prior. Returns the prior untouched until history has loaded.
 * Synchronous — safe to call inside the sim hot loop.
 */
export function getEmpiricalCV(
  sport: string,
  position: string,
  projection: number,
  staticPrior: number,
): number {
  const sportKey = sport.toUpperCase();
  const entry = cache.get(sportKey);

  // Kick off (or refresh) in the background; never block the sim.
  if (!entry || (Date.now() - entry.fetchedAt > REFRESH_MS && !entry.refreshing)) {
    if (!entry) {
      cache.set(sportKey, { byPosTier: new Map(), byPos: new Map(), fetchedAt: 0, refreshing: true });
    }
    void refreshProfiles(sportKey);
  }
  if (!entry) return staticPrior;

  const pos = position?.split("/")[0]?.toUpperCase() ?? "UTIL";
  const empirical =
    entry.byPosTier.get(`${pos}|${tierOf(projection)}`) ?? entry.byPos.get(pos);
  if (empirical == null) return staticPrior;

  return EMPIRICAL_WEIGHT * empirical + (1 - EMPIRICAL_WEIGHT) * staticPrior;
}
