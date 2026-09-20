import { validateExposureBounds, type ExposureBounds } from "./lineup-exposure";

/** Explicit floors are hard; automatic quality heuristics cannot erase a constrained batch. */
export function filterSimProjectionCandidates<T>(candidates: T[], projection: (candidate: T) => number,
  options: { count: number; explicitFloor?: number | null; automaticFloor: number; constrained: boolean }): T[] {
  if (options.explicitFloor && options.explicitFloor > 0) {
    return candidates.filter(c => projection(c) >= options.explicitFloor!);
  }
  if (options.constrained || options.automaticFloor <= 0) return candidates;
  const filtered = candidates.filter(c => projection(c) >= options.automaticFloor);
  return filtered.length >= options.count ? filtered : candidates;
}

/**
 * Temporary search constraints only. Final selection still proves batch bounds.
 * Count unique candidates, not repeated wins by the same projected lineup.
 */
export function createSimExposureSearch(bounds: ExposureBounds, count: number) {
  validateExposureBounds(bounds);
  let turn = 0;
  let minimumTurn = 0;
  return <T extends { lockedPlayerIds: number[]; excludedPlayerIds: number[] }>(
    base: T, poolIds: number[], candidates: Iterable<{ lineup: { id: number }[] }>,
  ): T => {
    const usage = new Map<number, number>();
    let size = 0;
    for (const candidate of candidates) {
      size++;
      for (const id of new Set(candidate.lineup.map(p => p.id))) usage.set(id, (usage.get(id) || 0) + 1);
    }
    const maximum = (id: number) => Math.min(bounds.globalMaxExposure ?? 100, bounds.exposureLimits?.[id] ?? 100);
    const locks = [...base.lockedPlayerIds];
    const targets = Object.entries(bounds.minExposureLimits || {})
      .filter(([id, pct]) => pct > 0 && !locks.includes(Number(id)) &&
        (usage.get(Number(id)) || 0) < Math.ceil(Math.max(count, size + 1) * pct / 100));
    // Avoid locking all minima together: individually feasible targets may
    // compete for a roster slot. Cycle one target at a time.
    if (targets.length) locks.push(Number(targets[minimumTurn++ % targets.length][0]));
    const pressure = size && turn % 4 !== 0 ? poolIds.filter(id =>
      !locks.includes(id) && maximum(id) > 0 && maximum(id) < 100 &&
      (usage.get(id) || 0) / size >= maximum(id) / 100)
      .sort((a, b) => ((usage.get(b) || 0) / size - maximum(b) / 100) -
        ((usage.get(a) || 0) / size - maximum(a) / 100) || a - b) : [];
    // Rotate equal-pressure players and vary exclusion width to avoid repeating
    // one incompatible temporary combination until the request times out.
    const width = turn % 2 === 0 ? pressure.length : 1 + turn % 3;
    turn++;
    const offset = pressure.length ? Math.floor(turn / 3) % pressure.length : 0;
    const omit = [...pressure.slice(offset), ...pressure.slice(0, offset)].slice(0, width);
    return { ...base, lockedPlayerIds: locks, excludedPlayerIds: Array.from(new Set([
      ...base.excludedPlayerIds, ...poolIds.filter(id => Math.floor(count * maximum(id) / 100 + 1e-9) === 0), ...omit,
    ])) };
  };
}