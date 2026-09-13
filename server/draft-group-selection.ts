export interface LiveDraftGroupSelection {
  draftGroupId: number;
  isMain: boolean;
}

/**
 * The NFL endpoint must fail closed when DraftKings has not marked a
 * featured/unsuffixed group. Picking the first lobby row can silently target
 * SNF, MNF, or an extended pool. Other sports retain their historical first
 * available fallback because their live selector does not use the NFL marker.
 */
export function selectLiveDraftGroup<T extends LiveDraftGroupSelection>(
  available: T[],
  sport: string,
  requestedDraftGroupId: number | null,
): T | undefined {
  if (requestedDraftGroupId !== null) {
    return available.find(slate => slate.draftGroupId === requestedDraftGroupId);
  }
  return available.find(slate => slate.isMain) ||
    (sport.toUpperCase() === "NFL" ? undefined : available[0]);
}

export interface LocalSlateIdentity {
  id: number;
  isActive: boolean | null;
}

export function selectNewestLocalSlate<T extends LocalSlateIdentity>(
  slates: T[],
): T | undefined {
  return [...slates].sort((a, b) =>
    Number(a.isActive === false) - Number(b.isActive === false) ||
    b.id - a.id,
  )[0];
}