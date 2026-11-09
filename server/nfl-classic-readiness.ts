import type { Player } from "@shared/schema";
import type { NflPortfolioSettings } from "@shared/nfl-portfolio";
import { CLASSIC_POSITION_CAPS, classicMinimum, hasRole, rushingQualified, type ClassicLogic } from "@shared/nfl-classic-logic";

const unavailable = /^(OUT|O|INJ|INACTIVE|IR|PUP|EXEMPT|SUSPENDED|SUS|DOUBTFUL|NA)$/i;
export const classicPos = (p: Pick<Player, "position">) => p.position.toUpperCase().split("/")[0];
export function validateClassicEvidence(pool: Player[], classic: ClassicLogic | undefined, slateId?: number, startTime?: Date): Player[] {
  pool = pool.filter(p => !/no longer listed|retired/i.test(p.injuryDetail || ""));
  if (!classic) throw new Error("NFL Classic now requires DFS Army projections/ownership and full-pool availability, role and weather inputs. Import Classic inputs in NFL GPP Strategy. Legacy Sim controls remain available above these rules.");
  if (slateId !== undefined && classic.slateId !== slateId) throw new Error("Classic inputs belong to a different slate. Import data for this exact slate.");
  const missing = pool.filter(p => !classic.players[String(p.id)]);
  if (missing.length) throw new Error(`Full-list availability check incomplete: missing inputs for ${missing.length} players (${missing.slice(0, 5).map(p => p.name).join(", ")}). Include inactive/IR/PUP/exempt players too; missing is not active.`);
  const now = Date.now();
  const appData = classic.projectionSource === "App data";
  const nearLock = startTime && startTime.getTime() - now < 90 * 60_000;
  const eligible: Player[] = [];
  for (const p of pool) {
    const e = classic.players[String(p.id)];
    const statusAge = now - Date.parse(e.statusCheckedAt ?? ""), weatherAge = now - Date.parse(e.weatherCheckedAt ?? "");
    if (!appData && (!Number.isFinite(statusAge) || statusAge < -300_000 || statusAge > (nearLock ? 30 * 60_000 : 6 * 3600_000))) throw new Error(`${p.name}: availability review is stale. Refresh the full inactive/IR/PUP/exempt list${nearLock ? " within 30 minutes near lock" : " within six hours"}.`);
    if (!appData && (!Number.isFinite(weatherAge) || weatherAge < -300_000 || weatherAge > 6 * 3600_000)) throw new Error(`${p.name}: weather review is missing or stale. Review each game; rain alone does not exclude players.`);
    if (unavailable.test(e.status) || unavailable.test(p.injuryStatus || "") || /practice squad|retired|no longer listed/i.test(p.injuryDetail || "")) continue;
    const position = classicPos(p);
    if (position !== "DST" && e.projection < 4) continue;
    if (position === "RB" && e.roadUnderdogSpread >= 10) continue;
    if (position === "DST") {
      if (!appData && ![e.opponentImpliedTotal, e.opponentSackRate, e.opponentFumbleRate, e.opponentIntRate].every(v => v !== undefined && Number.isFinite(v))) throw new Error(`${p.name}: supply opponent implied total, sack, fumble and interception rates from the Defense Cheat Sheet.`);
      if (e.opponentImpliedTotal! > 21) continue;
      if (p.salary < 2500 && !e.eliteTurnoverMatchup) continue;
    }
    eligible.push({ ...p, projectedPoints: String(e.projection) });
  }
  return eligible;
}
export function classicExposureBounds(pool: Player[], s: NflPortfolioSettings, base: any) {
  const c = s.classic!;
  const anchors = Object.entries(c.anchors);
  if ((c.projectionSource !== "App data" && anchors.length < 2) || anchors.length > 3) throw new Error("Choose two or three role-verified weekly anchors (35–45%) for the anchors-plus-spray identity.");
  const maximum = new Map<number, number>(), minimum = new Map<number, number>();
  for (const p of pool) {
    const e = c.players[String(p.id)], position = classicPos(p);
    const anchor = c.anchors[String(p.id)];
    if (anchor && c.projectionSource !== "App data" && !hasRole(e)) throw new Error(`${p.name}: an anchor needs two or three recent game logs and a verified producing/opening role.`);
    let cap = anchor ?? CLASSIC_POSITION_CAPS[position] ?? 25;
    // Proactive concentration trim also applies to explicitly selected anchors.
    if (e.topDefense) cap = Math.min(cap, 30);
    maximum.set(p.id, Math.min(cap, base.globalMaxExposure ?? 100, base.exposureLimits?.[p.id] ?? 100));
    minimum.set(p.id, Math.max(anchor ? Math.min(anchor, e.topDefense ? 30 : anchor) : 0,
      classicMinimum(e, position),
      position === "QB" && e.valueTier && hasRole(e) ? e.ownership + 1 : 0,
      base.minExposureLimits?.[p.id] ?? 0, base.globalMinExposure ?? 0));
  }
  for (const [id] of anchors) if (!pool.some(p => String(p.id) === id)) throw new Error("A selected anchor is excluded, unavailable, below the projection floor, or outside this slate.");
  for (const p of pool) if (minimum.get(p.id)! > maximum.get(p.id)!) throw new Error(`${p.name}: the required role/anchor minimum exceeds an explicit maximum. Adjust the conflicting control; caps will not be relaxed.`);
  return { maximum, minimum, nakedQbIds: pool.filter(p => classicPos(p) === "QB" && rushingQualified(c.players[String(p.id)])).map(p => p.id) };
}
