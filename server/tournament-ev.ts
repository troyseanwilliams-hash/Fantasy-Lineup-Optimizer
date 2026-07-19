// Tournament EV engine.
//
// Ranking GPP lineups by projected points optimizes the wrong thing: in a
// top-heavy payout structure what matters is P(finishing near the top of the
// FIELD) × payout. This module:
//   1. Simulates a realistic opponent field by sampling lineups from our
//      projected ownership (chalk appears often, punts rarely).
//   2. Scores every candidate against that field across the same Monte Carlo
//      sims the optimizer already ran.
//   3. Maps each simulated finish through a parametric GPP payout curve,
//      with a duplication penalty for chalk-heavy builds (identical lineups
//      split top prizes).
// EV is expressed as a multiple of entry fee (1.0 = break-even).

import type { Player } from "@shared/schema";
import { getPlatformConfig, type Platform } from "@shared/platform-config";

export interface OwnedPlayer extends Player {
  ownershipProjection: number; // percent, e.g. 22.5
}

// ── Payout curve ─────────────────────────────────────────────────────────────
// finishFrac = share of the field that beat you (0 = outright win).
// Multiples approximate a large-field DK GPP with ~20% cashing.
const PAYOUT_CURVE: { frac: number; mult: number }[] = [
  { frac: 0.001, mult: 500 },
  { frac: 0.005, mult: 100 },
  { frac: 0.01, mult: 40 },
  { frac: 0.03, mult: 12 },
  { frac: 0.05, mult: 6 },
  { frac: 0.10, mult: 3 },
  { frac: 0.15, mult: 2 },
  { frac: 0.20, mult: 1.5 },
];

function payoutMultiple(finishFrac: number): number {
  for (const step of PAYOUT_CURVE) {
    if (finishFrac <= step.frac) return step.mult;
  }
  return 0;
}

// ── Slot eligibility ─────────────────────────────────────────────────────────

function slotAllows(slot: string, position: string): boolean {
  const pos = position.toUpperCase();
  // Slots are numbered in platform config ("RB2", "WR3") — strip the suffix.
  const s = slot.toUpperCase().replace(/\d+$/, "");
  if (s === "FLEX") return ["RB", "WR", "TE"].includes(pos);
  if (s === "SFLX" || s === "SUPERFLEX") return ["QB", "RB", "WR", "TE"].includes(pos);
  if (s === "UTIL") return true;
  if (s === "G") return pos === "PG" || pos === "SG" || pos === "G";
  if (s === "F") return pos === "SF" || pos === "PF" || pos === "F";
  // Multi-position players ("RB/WR") match on any of their positions.
  return pos.split("/").some((p) => p.trim() === s);
}

// ── Field generation ─────────────────────────────────────────────────────────

/**
 * Samples `fieldSize` opponent lineups weighted by projected ownership,
 * respecting roster slots and the salary cap (accepts 85–100% cap usage,
 * which matches real field behavior). Returns arrays of player ids.
 */
export function generateFieldLineups(
  pool: OwnedPlayer[],
  sport: string,
  platform: string,
  fieldSize: number,
): number[][] {
  let config;
  try {
    config = getPlatformConfig(sport as any, platform as Platform);
  } catch {
    return []; // unsupported sport/platform combo — EV silently unavailable
  }
  const { slots, salaryCap } = config;

  // Per-slot candidate lists with cumulative ownership weights for O(log n)
  // weighted sampling.
  const slotCandidates = new Map<string, { players: OwnedPlayer[]; cumWeights: number[] }>();
  for (const slot of Array.from(new Set(slots))) {
    const eligible = pool.filter(
      (p) => slotAllows(slot, p.position ?? "") && Number(p.projectedPoints) > 0,
    );
    if (eligible.length === 0) continue;
    const cumWeights: number[] = [];
    let acc = 0;
    for (const p of eligible) {
      // Ownership floor keeps punts possible; ^1.15 sharpens chalk slightly.
      acc += Math.pow(Math.max(0.3, p.ownershipProjection), 1.15);
      cumWeights.push(acc);
    }
    slotCandidates.set(slot, { players: eligible, cumWeights });
  }
  if (slotCandidates.size === 0) return [];

  function sampleFromSlot(slot: string, used: Set<number>): OwnedPlayer | null {
    const c = slotCandidates.get(slot);
    if (!c) return null;
    const total = c.cumWeights[c.cumWeights.length - 1]!;
    for (let attempt = 0; attempt < 12; attempt++) {
      const roll = Math.random() * total;
      let lo = 0, hi = c.cumWeights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (c.cumWeights[mid]! < roll) lo = mid + 1;
        else hi = mid;
      }
      const p = c.players[lo]!;
      if (!used.has(p.id)) return p;
    }
    // Weighted sampling kept colliding — take any unused eligible player.
    return c.players.find((p) => !used.has(p.id)) ?? null;
  }

  const field: number[][] = [];
  const minSalary = salaryCap * 0.85;
  let guard = 0;

  while (field.length < fieldSize && guard < fieldSize * 40) {
    guard++;
    const used = new Set<number>();
    const picks: { slot: string; player: OwnedPlayer }[] = [];
    let ok = true;

    for (const slot of slots) {
      const p = sampleFromSlot(slot, used);
      if (!p) { ok = false; break; }
      used.add(p.id);
      picks.push({ slot, player: p });
    }
    if (!ok) continue;

    // Repair pass: swap the most expensive pick for a cheaper eligible
    // alternative until the lineup fits under the cap (mirrors how real
    // entrants pivot down when they can't afford their first choice).
    let salary = picks.reduce((s, x) => s + x.player.salary, 0);
    for (let swap = 0; swap < picks.length && salary > salaryCap; swap++) {
      picks.sort((a, b) => b.player.salary - a.player.salary);
      const target = picks[swap];
      if (!target) break;
      const c = slotCandidates.get(target.slot);
      if (!c) continue;
      const cheaper = c.players
        .filter((p) => !used.has(p.id) && p.salary < target.player.salary)
        .sort((a, b) => b.ownershipProjection - a.ownershipProjection)
        .slice(0, 6);
      if (cheaper.length === 0) continue;
      const replacement = cheaper[Math.floor(Math.random() * cheaper.length)]!;
      used.delete(target.player.id);
      used.add(replacement.id);
      salary += replacement.salary - target.player.salary;
      target.player = replacement;
    }
    if (salary > salaryCap || salary < minSalary) continue;
    field.push(picks.map((x) => x.player.id));
  }

  return field;
}

// ── EV scoring ───────────────────────────────────────────────────────────────

export interface TournamentEVResult {
  evScore: number; // mean payout as multiple of entry (dupe-adjusted)
  winPct: number; // % of sims finishing in the top 0.1% of the field
  cashPct: number; // % of sims finishing in the cashing top 20%
  dupeFactor: number; // estimated prize split from duplicated builds
}

type SimProj = Record<number, number> | number[];

/**
 * Scores candidate lineups against the simulated field across all sims.
 * `simProjArrays` is the per-sim projection lookup the sim optimizer already
 * builds (player id → simulated points).
 */
export function computeTournamentEV(
  candidates: { key: string; pids: number[]; ownSum?: number; ownProduct?: number }[],
  fieldLineups: number[][],
  simProjArrays: SimProj[],
  fieldSizeAssumed = 50000,
): Map<string, TournamentEVResult> {
  const out = new Map<string, TournamentEVResult>();
  const nSims = simProjArrays.length;
  const nField = fieldLineups.length;
  if (nSims === 0 || nField === 0) return out;

  // Pre-score the field per sim (sorted ascending for binary search).
  const fieldScores: Float64Array[] = [];
  for (let si = 0; si < nSims; si++) {
    const proj = simProjArrays[si]!;
    const scores = new Float64Array(nField);
    for (let fi = 0; fi < nField; fi++) {
      const ids = fieldLineups[fi]!;
      let t = 0;
      for (let k = 0; k < ids.length; k++) t += (proj as any)[ids[k]!] || 0;
      scores[fi] = t;
    }
    scores.sort();
    fieldScores.push(scores);
  }

  const winThresholdFrac = 0.001;
  const cashThresholdFrac = 0.20;

  for (const cand of candidates) {
    // Duplication estimate: expected copies of this exact lineup in a real
    // field ≈ fieldSize × Π(ownership_i). The raw product understates dupes
    // for chalky builds (ownership isn't independent), so a calibration
    // multiplier keeps the penalty meaningful. v1 heuristic — refine against
    // real contest data later.
    let ownProduct = cand.ownProduct;
    if (ownProduct == null) ownProduct = 0;
    const expectedDupes = fieldSizeAssumed * ownProduct * 25;
    const dupeFactor = 1 + Math.max(0, expectedDupes);

    let paySum = 0;
    let wins = 0;
    let cashes = 0;

    for (let si = 0; si < nSims; si++) {
      const proj = simProjArrays[si]!;
      let score = 0;
      for (let k = 0; k < cand.pids.length; k++) score += (proj as any)[cand.pids[k]!] || 0;

      // Fraction of the field that beat this score.
      const scores = fieldScores[si]!;
      let lo = 0, hi = nField;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (scores[mid]! <= score) lo = mid + 1;
        else hi = mid;
      }
      const beatenBy = nField - lo;
      const finishFrac = beatenBy / (nField + 1);

      let mult = payoutMultiple(finishFrac);
      // Top prizes get split across duplicates; min-cash barely does.
      if (mult > 2) mult = mult / dupeFactor;
      paySum += mult;
      if (finishFrac <= winThresholdFrac) wins++;
      if (finishFrac <= cashThresholdFrac) cashes++;
    }

    out.set(cand.key, {
      evScore: Math.round((paySum / nSims) * 100) / 100,
      winPct: Math.round((wins / nSims) * 1000) / 10,
      cashPct: Math.round((cashes / nSims) * 1000) / 10,
      dupeFactor: Math.round(dupeFactor * 100) / 100,
    });
  }

  return out;
}
