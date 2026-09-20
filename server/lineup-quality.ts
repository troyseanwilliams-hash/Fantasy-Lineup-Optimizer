/** Quality is a hard eligibility rule, never a preference traded for diversity. */
export const LINEUP_QUALITY_RATIO = 0.9;

/** Stagnation is measured, not inferred from a single duplicate solve. */
export function createQualityConvergence(window = 80) {
  let best = 0;
  let qualified = 0;
  let stagnant = 0;
  return (bestProjection: number, qualifiedCount: number) => {
    if (bestProjection > best + 1e-9 || qualifiedCount > qualified) stagnant = 0;
    else stagnant++;
    best = Math.max(best, bestProjection);
    qualified = qualifiedCount;
    return stagnant >= window;
  };
}

export function qualityFloor(baseline: number, explicitFloor?: number | null): number {
  if (!Number.isFinite(baseline) || baseline < 0) throw new Error("Invalid deterministic lineup baseline.");
  if (explicitFloor != null && (!Number.isFinite(explicitFloor) || explicitFloor < 0)) {
    throw new Error("Projected points floor must be a finite non-negative number.");
  }
  return Math.max(baseline * LINEUP_QUALITY_RATIO, explicitFloor ?? 0);
}

export function projectionTotal(
  lineup: { id: number }[],
  pool: { id: number; projectedPoints?: unknown }[],
): number {
  const projections = new Map(pool.map(p => [p.id, Number(p.projectedPoints)]));
  return lineup.reduce((sum, player) => {
    const value = projections.get(player.id);
    if (value === undefined || !Number.isFinite(value)) throw new Error(`Missing deterministic projection for player ${player.id}.`);
    return sum + value;
  }, 0);
}

export function qualityReport(projections: number[], baseline: number, explicitFloor: number | undefined,
  considered: number, requested: number, stoppingReason: string) {
  return {
    baselineProjection: baseline,
    baselineStatus: "best_found" as const,
    relativeThreshold: LINEUP_QUALITY_RATIO,
    effectiveFloor: qualityFloor(baseline, explicitFloor),
    candidatesConsidered: considered,
    qualifiedCandidates: projections.length,
    uniqueVariants: projections.length,
    requestedCount: requested,
    generatedCount: projections.length,
    stoppingReason,
    projectionRange: projections.length ? { min: Math.min(...projections), max: Math.max(...projections) } : null,
  };
}