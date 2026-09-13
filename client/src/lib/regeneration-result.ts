export interface RegenerationOutcome {
  sourceLineupId: number | null;
  newLineupId: number | null;
  status: string;
  error?: string;
}

export interface RegenerationSummary {
  outcomes: RegenerationOutcome[];
  cloned: number;
  updated: number;
  failed: number;
  skipped: number;
  newLineupIds: number[];
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Cross-slate regeneration clones a new lineup instead of changing the
 * source row's slateId. Keep this response normalization tolerant of the
 * legacy updated response while the backend rollout is in progress.
 *
 * Canonical backend result fields:
 *   sourceLineupId, newLineupId, status, error
 */
export function summarizeRegeneration(data: any): RegenerationSummary {
  const rawResults: unknown[] = Array.isArray(data?.results) ? data.results : [];
  const outcomes = rawResults.map((result: any): RegenerationOutcome => {
    const status = String(result?.status || "unknown").toLowerCase();
    const sourceValue = result?.sourceLineupId
      ?? result?.sourceId
      ?? result?.originalLineupId
      ?? (status === "cloned" || status === "clone" || status === "created" ? result?.id : null);
    const newValue = result?.newLineupId
      ?? result?.createdLineupId
      ?? result?.cloneId
      ?? result?.lineupId
      ?? ((status === "cloned" || status === "clone" || status === "created") &&
        (result?.sourceLineupId != null || result?.sourceId != null || result?.originalLineupId != null)
        ? result?.id
        : null);
    const sourceLineupId = positiveId(sourceValue);
    const newLineupId = positiveId(newValue);
    return {
      sourceLineupId,
      newLineupId,
      status,
      error: typeof result?.error === "string" ? result.error : undefined,
    };
  });
  const countByStatus = (statuses: Set<string>) => outcomes.filter(outcome => statuses.has(outcome.status)).length;
  const cloned = Number(data?.cloned ?? data?.created ?? countByStatus(new Set(["cloned", "clone", "created"]))) || 0;
  const updated = Number(data?.updated ?? countByStatus(new Set(["updated"]))) || 0;
  const skipped = Number(data?.skipped ?? countByStatus(new Set(["skipped"]))) || 0;
  const explicitFailed = Number(data?.failed);
  const failed = explicitFailed > 0 ? explicitFailed : countByStatus(new Set(["failed", "error"])) ||
    Math.max(0, outcomes.length - cloned - updated - skipped);
  const resultIds = outcomes
    .map(outcome => outcome.newLineupId)
    .filter((id): id is number => id !== null);
  const topLevelIds = [
    ...(Array.isArray(data?.newLineupIds) ? data.newLineupIds : []),
    ...(Array.isArray(data?.createdLineupIds) ? data.createdLineupIds : []),
    ...(Array.isArray(data?.clonedLineupIds) ? data.clonedLineupIds : []),
  ]
    .map(Number)
    .filter((id: number) => Number.isSafeInteger(id) && id > 0);
  const newLineupIds = Array.from(new Set([...resultIds, ...topLevelIds]));
  return { outcomes, cloned, updated, failed, skipped, newLineupIds };
}