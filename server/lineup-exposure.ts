import { z } from "zod";
import { solveWithBudget, validatedIntegralResult } from "./solver-guard";

export interface ExposureBounds {
  globalMaxExposure?: number;
  globalMinExposure?: number;
  exposureLimits?: Record<string, number>;
  minExposureLimits?: Record<string, number>;
  lockedPlayerIds?: number[];
}

function fail(message: string): never {
  throw new z.ZodError([{ code: "custom", path: ["exposureLimits"], message }]);
}

export function mergeExposureMinimums(...maps: Array<Record<string, number> | undefined>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const map of maps) for (const [id, value] of Object.entries(map || {})) result[id] = Math.max(result[id] ?? 0, value);
  return result;
}

export function mergeExposureMaximums(...maps: Array<Record<string, number> | undefined>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const map of maps) for (const [id, value] of Object.entries(map || {})) result[id] = Math.min(result[id] ?? 100, value);
  return result;
}

export function validateExposureBounds(bounds: ExposureBounds): void {
  for (const value of [bounds.globalMaxExposure, bounds.globalMinExposure, ...Object.values(bounds.exposureLimits || {}), ...Object.values(bounds.minExposureLimits || {})]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)) fail("Exposure percentages must be finite numbers from 0 to 100.");
  }
  for (const id of bounds.lockedPlayerIds || []) {
    if (maximum(bounds, id) < 100) fail(`Locked player ${id} requires 100% exposure, conflicting with its ${maximum(bounds, id)}% maximum. No lineups were saved.`);
  }
  for (const [id, min] of Object.entries(bounds.minExposureLimits || {})) {
    if (min > maximum(bounds, Number(id))) fail(`Player ${id} minimum exposure exceeds its maximum. No lineups were saved.`);
  }
}

const maximum = (b: ExposureBounds, id: number) => Math.min(b.globalMaxExposure ?? 100, b.exposureLimits?.[id] ?? 100);

/** Global minimum applies only to used players; explicit minima also require absent players. */
export function assertLineupExposures<T>(lineups: T[], ids: (lineup: T) => number[], bounds: ExposureBounds): void {
  validateExposureBounds(bounds);
  const counts = new Map<number, number>();
  for (const lineup of lineups) {
    const members = new Set(ids(lineup));
    for (const id of bounds.lockedPlayerIds || []) if (!members.has(id)) fail(`Locked player ${id} is missing from a lineup.`);
    for (const id of members) counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const id of new Set([...counts.keys(), ...Object.keys(bounds.minExposureLimits || {}).map(Number)])) {
    const used = counts.get(id) || 0;
    const min = Math.max(bounds.minExposureLimits?.[id] ?? 0, used ? bounds.globalMinExposure ?? 0 : 0);
    if (used > Math.floor(lineups.length * maximum(bounds, id) / 100 + 1e-9) ||
        used < Math.ceil(lineups.length * min / 100 - 1e-9)) fail(`Final batch violates exposure requirements for player ${id}. No lineups were saved.`);
  }
}

/** Ranked candidate subset, with limits recomputed at every actual batch size.
 * Preset mode validates and returns the entire accepted engine set, never reselects.
 */
export function selectExposureLineups<T>(ranked: T[], ids: (lineup: T) => number[], bounds: ExposureBounds,
  options: { count: number; deadline?: number; requireFull?: boolean; preservePortfolio?: boolean }): T[] {
  validateExposureBounds(bounds);
  if (options.preservePortfolio) {
    if (options.requireFull && ranked.length !== options.count) fail("Regeneration requires the full requested portfolio; no lineups were saved.");
    assertLineupExposures(ranked, ids, bounds);
    return ranked;
  }
  const candidates = ranked.filter(c => (bounds.lockedPlayerIds || []).every(id => ids(c).includes(id)));
  const constrained = (bounds.globalMaxExposure ?? 100) < 100 || (bounds.globalMinExposure ?? 0) > 0 ||
    Object.values(bounds.exposureLimits || {}).some(x => x < 100) || Object.values(bounds.minExposureLimits || {}).some(x => x > 0);
  if (!constrained) {
    if (options.requireFull && candidates.length < options.count) fail("Regeneration could not fill the requested batch. No lineups were saved.");
    return candidates.slice(0, options.count);
  }
  const allIds = new Set([...candidates.flatMap(ids), ...Object.keys(bounds.minExposureLimits || {}).map(Number)]);
  const deadline = options.deadline ?? Date.now() + 5000;
  let attempts = 0;
  for (let size = Math.min(options.count, candidates.length); size >= (options.requireFull ? options.count : 1) && attempts++ < 50; size--) {
    if (Date.now() >= deadline) break;
    const model: any = { optimize: "rank", opType: "max", constraints: { size: { equal: size } }, variables: {}, ints: {} };
    for (const id of allIds) {
      const explicit = Math.ceil(size * (bounds.minExposureLimits?.[id] ?? 0) / 100 - 1e-9);
      const conditional = Math.ceil(size * (bounds.globalMinExposure ?? 0) / 100 - 1e-9);
      model.constraints[`e${id}`] = { min: explicit, max: Math.floor(size * maximum(bounds, id) / 100 + 1e-9) };
      if (conditional > 0) {
        model.constraints[`lo${id}`] = { min: 0 };
        model.constraints[`hi${id}`] = { max: 0 };
        model.constraints[`yb${id}`] = { max: 1 };
        model.variables[`y${id}`] = { [`lo${id}`]: -conditional, [`hi${id}`]: -size, [`yb${id}`]: 1 };
        model.ints[`y${id}`] = 1;
      }
    }
    candidates.forEach((candidate, i) => {
      const v: Record<string, number> = { size: 1, rank: candidates.length - i, [`b${i}`]: 1 };
      for (const id of new Set(ids(candidate))) {
        v[`e${id}`] = 1;
        if (model.constraints[`lo${id}`]) { v[`lo${id}`] = 1; v[`hi${id}`] = 1; }
      }
      model.variables[`c${i}`] = v;
      model.constraints[`b${i}`] = { max: 1 };
      model.ints[`c${i}`] = 1;
    });
    const { result } = solveWithBudget(model, { deadline, timeoutMs: 2000 });
    if (!validatedIntegralResult(result, model)) continue;
    const selected = candidates.filter((_, i) => result[`c${i}`] > 0.5);
    if (selected.length !== size) continue;
    assertLineupExposures(selected, ids, bounds);
    return selected;
  }
  fail("No batch satisfying hard exposure limits was found within the candidate/search time budget. This does not prove infeasibility. Expand the pool or review exposures; no lineups were saved.");
}