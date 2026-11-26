// Contrarian value plays: players who project well for their position and price but are
// projected to be lightly owned, with a boost for "sneaky" spots against weak defenses.
// Pure function over data the ownership route already has, so it is cheap and testable.

import type { Player } from "@shared/schema";
import type { OwnershipResult } from "./ownership-engine";
import type { DvPContext } from "./dvp-client";

export interface ContrarianPlay {
  playerId: number;
  name: string;
  team: string;
  opponent: string | null;
  position: string;
  salary: number;
  projectedPoints: number;
  adjustedPoints: number;
  ownership: number;
  value: number;            // projected points per $1k
  positionRank: number;     // 1 = best adjusted projection at the position
  positionCount: number;
  matchupMultiplier: number | null; // >1 = weak defense for this position
  tag: "matchup" | "value" | "upside";
  reason: string;
  score: number;
}

// Questionable / game-time players look low-owned only because the ownership model suppresses
// them for injury risk, so they are not real contrarian plays.
const OUT = new Set(["OUT", "INJ", "O", "IR", "SUS", "NA", "DOUBTFUL", "D", "QUESTIONABLE", "Q", "GTD"]);
const MAX_OWNERSHIP = 10;       // never call a >10% player contrarian
const MATCHUP_SNEAKY = 1.04;    // DvP multiplier that counts as a soft spot

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function findContrarianPlays(
  players: Player[],
  ownership: OwnershipResult[],
  opts: {
    dvp?: DvPContext | null;
    opponentMap?: Map<string, string>;
    perPosition?: number;
  } = {},
): Record<string, ContrarianPlay[]> {
  const perPosition = opts.perPosition ?? 3;
  const ownById = new Map(ownership.map(o => [o.playerId, o.projectedOwnership]));
  const groups = new Map<string, Player[]>();

  for (const p of players) {
    if (OUT.has((p.injuryStatus || "").toUpperCase().trim())) continue;
    if (!(Number(p.projectedPoints) > 0) || !(p.salary > 0)) continue;
    const pos = p.position.split("/")[0];
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos)!.push(p);
  }

  const result: Record<string, ContrarianPlay[]> = {};

  for (const [pos, group] of Array.from(groups.entries())) {
    if (group.length < 6) continue; // too few players to call anyone contrarian

    const rows = group.map(p => {
      const proj = Number(p.projectedPoints) || 0;
      const team = (p.team || "").toUpperCase();
      const opp = (opts.opponentMap?.get(team) || p.opponent || "").toUpperCase() || null;
      const mult = opp && opts.dvp ? opts.dvp.get(`${opp}:${pos.toUpperCase()}`) ?? null : null;
      const adjusted = mult ? proj * Math.max(0.9, Math.min(1.12, mult)) : proj;
      return {
        p, proj, adjusted, opp, mult,
        own: ownById.get(p.id) ?? 0.5,
        value: proj / Math.max(p.salary / 1000, 0.1),
      };
    });

    const byAdjusted = [...rows].sort((a, b) => b.adjusted - a.adjusted);
    const rank = new Map(byAdjusted.map((r, i) => [r.p.id, i + 1]));
    const medProj = median(rows.map(r => r.adjusted)) || 1;
    const medValue = median(rows.map(r => r.value)) || 1;
    const medOwn = median(rows.map(r => r.own));
    const ownCap = Math.min(MAX_OWNERSHIP, Math.max(3, medOwn));
    const projFloor = medProj * 1.05;

    const picks: ContrarianPlay[] = [];
    for (const r of rows) {
      if (r.own > ownCap) continue;
      const strongProj = r.adjusted >= projFloor;
      const strongValue = r.value >= medValue * 1.12;
      const softSpot = (r.mult ?? 1) >= MATCHUP_SNEAKY;
      if (!(strongProj || (strongValue && r.adjusted >= medProj))) continue;

      const projRatio = r.adjusted / medProj;
      const valueRatio = r.value / medValue;
      const score = (projRatio * Math.sqrt(valueRatio)) / Math.pow(r.own + 1, 0.7);

      const tag: ContrarianPlay["tag"] = softSpot ? "matchup" : strongValue ? "value" : "upside";
      const parts = [
        `#${rank.get(r.p.id)} of ${rows.length} ${pos}s by projection`,
        `${r.own.toFixed(1)}% owned`,
      ];
      if (strongValue) parts.push(`${r.value.toFixed(1)} pts per $1k`);
      if (softSpot && r.opp) {
        parts.push(`${r.opp} defense allows ${Math.round(((r.mult as number) - 1) * 100)}% more than average to ${pos}`);
      }

      picks.push({
        playerId: r.p.id,
        name: r.p.name,
        team: r.p.team,
        opponent: r.opp,
        position: pos,
        salary: r.p.salary,
        projectedPoints: Math.round(r.proj * 10) / 10,
        adjustedPoints: Math.round(r.adjusted * 10) / 10,
        ownership: Math.round(r.own * 10) / 10,
        value: Math.round(r.value * 100) / 100,
        positionRank: rank.get(r.p.id) ?? 0,
        positionCount: rows.length,
        matchupMultiplier: r.mult,
        tag,
        reason: parts.join(" · "),
        score: Math.round(score * 1000) / 1000,
      });
    }

    picks.sort((a, b) => b.score - a.score);
    if (picks.length > 0) result[pos] = picks.slice(0, perPosition);
  }

  return result;
}
