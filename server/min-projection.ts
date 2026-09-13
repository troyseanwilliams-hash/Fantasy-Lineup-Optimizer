/**
 * Per-player projection cutoff helpers.
 *
 * This is deliberately separate from projectedPointsFloor, which is a
 * total-lineup constraint in the LP model. A minProjection cutoff computes
 * eligibility from each player's raw projection plus an explicit request
 * projection (which already includes UI edits/boosts), then applies those
 * player IDs to the adjusted candidate pool.
 */

export type ProjectionCutoffPlayer = {
  id: number;
  name?: string | null;
  position?: string | null;
  projectedPoints?: string | number | null;
};

export type MinProjectionViolation = {
  player: ProjectionCutoffPlayer;
  projection: number;
  minProjection: number;
};

export function numericProjection(player: ProjectionCutoffPlayer): number {
  const projection = Number(player.projectedPoints);
  return Number.isFinite(projection) ? projection : 0;
}

/**
 * Build the deterministic projection input used by all optimizer routes.
 * Request projections are authoritative (they already contain the UI's
 * manual boost); server-only adjustments are intentionally not included.
 */
export function applyExplicitProjections<T extends ProjectionCutoffPlayer>(
  players: T[],
  overrides?: Record<string, number>,
): Array<T & { projectedPoints: string }> {
  return players.map(player => ({
    ...player,
    projectedPoints: String(overrides?.[String(player.id)] ?? numericProjection(player)),
  }));
}

export function isBelowMinProjection(
  player: ProjectionCutoffPlayer,
  minProjection: number | undefined,
): boolean {
  return minProjection !== undefined &&
    Number.isFinite(minProjection) &&
    minProjection > 0 &&
    numericProjection(player) < minProjection;
}

export function findLockedMinProjectionViolation(
  players: ProjectionCutoffPlayer[],
  minProjection: number | undefined,
  lockedPlayerIds: number[],
): MinProjectionViolation | undefined {
  if (minProjection === undefined || !Number.isFinite(minProjection) || minProjection <= 0) {
    return undefined;
  }

  const lockedIds = new Set(lockedPlayerIds);
  for (const player of players) {
    if (!lockedIds.has(player.id) || !isBelowMinProjection(player, minProjection)) continue;
    return {
      player,
      projection: numericProjection(player),
      minProjection,
    };
  }
  return undefined;
}

export function filterByMinProjection<T extends ProjectionCutoffPlayer>(
  players: T[],
  minProjection: number | undefined,
): T[] {
  if (minProjection === undefined || !Number.isFinite(minProjection) || minProjection <= 0) {
    return players;
  }
  return players.filter(player => !isBelowMinProjection(player, minProjection));
}

export function minProjectionLockMessage(
  violation: MinProjectionViolation,
  role = "player",
): string {
  const name = violation.player.name || `#${violation.player.id}`;
  return `Locked ${role} ${name} has an effective projection of ${violation.projection} from the deterministic input, below the minProjection cutoff of ${violation.minProjection}. Remove the lock or lower minProjection.`;
}

/**
 * Position constraints are checked after the cutoff has removed players so a
 * request that removes every candidate for a required slot gets an actionable
 * response rather than a generic infeasibility error.
 */
export function minProjectionRequiredPositionMessage(
  players: ProjectionCutoffPlayer[],
  minProjection: number | undefined,
  positionConstraints: Record<string, { min?: number }>,
): string | undefined {
  if (minProjection === undefined || !Number.isFinite(minProjection) || minProjection <= 0) {
    return undefined;
  }

  for (const [position, constraint] of Object.entries(positionConstraints)) {
    if (!constraint.min || constraint.min <= 0 || position === "FLEX") continue;
    const requiredPositions = position.toUpperCase() === "DST" ? ["DST", "DEF"] : [position.toUpperCase()];
    const hasCandidate = players.some(player =>
      requiredPositions.some(requiredPosition =>
        (player.position || "").toUpperCase().split("/").includes(requiredPosition),
      ),
    );
    if (!hasCandidate) {
      const label = position.toUpperCase() === "DST" ? "DST/DEF" : position;
      return `No ${label} players meet the minProjection cutoff of ${minProjection}. Lower minProjection or relax the ${position} requirement.`;
    }
  }
  return undefined;
}