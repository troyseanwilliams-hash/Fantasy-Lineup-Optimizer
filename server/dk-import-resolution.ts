import type { Slate } from "@shared/schema";

export type DKImportContestLookup =
  | { status: "resolved"; draftGroupId: number }
  | { status: "unknown" }
  | { status: "ambiguous" }
  | { status: "unavailable" };

export type DKImportSlateResolution =
  | { status: "resolved"; slate: Slate }
  | { status: "missing-contest-id" }
  | { status: "invalid-contest-id" }
  | { status: "unknown-contest" }
  | { status: "ambiguous-contest" }
  | { status: "unavailable-contest" }
  | { status: "missing-local-slate" }
  | { status: "ambiguous-local-slate" };

/**
 * Entry CSVs carry contest IDs as strings.  Do not coerce arbitrary values
 * (for example an empty string or a decimal) into an ID: an import without a
 * provider identity must fail closed.
 */
export function normalizeDKContestId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const contestId = Number(normalized);
  return Number.isSafeInteger(contestId) && contestId > 0 ? contestId : null;
}

/**
 * Match one entry to one local slate using the contest's live DraftKings
 * draft-group identity.  This deliberately does not inspect player overlap:
 * athletes can occur in both a main and an extended slate, so overlap is not
 * evidence that two entries belong to the same slate.
 */
export function resolveDKImportSlate(
  contestIdValue: unknown,
  contestLookups: ReadonlyMap<number, DKImportContestLookup>,
  localSlates: readonly Slate[],
  sport: string,
): DKImportSlateResolution {
  if (contestIdValue == null || String(contestIdValue).trim() === "") {
    return { status: "missing-contest-id" };
  }

  const contestId = normalizeDKContestId(contestIdValue);
  if (contestId == null) return { status: "invalid-contest-id" };

  const lookup = contestLookups.get(contestId);
  if (!lookup || lookup.status === "unknown") return { status: "unknown-contest" };
  if (lookup.status === "ambiguous") return { status: "ambiguous-contest" };
  if (lookup.status === "unavailable") return { status: "unavailable-contest" };

  const candidates = localSlates.filter(slate =>
    slate.sport === sport &&
    slate.platform === "draftkings" &&
    slate.draftGroupId === lookup.draftGroupId,
  );
  if (candidates.length === 0) return { status: "missing-local-slate" };
  if (candidates.length !== 1) return { status: "ambiguous-local-slate" };
  return { status: "resolved", slate: candidates[0] };
}

export function describeDKImportSlateResolution(resolution: DKImportSlateResolution): string {
  switch (resolution.status) {
    case "missing-contest-id":
      return "Contest ID is required; the entry's slate could not be identified.";
    case "invalid-contest-id":
      return "Contest ID is invalid; the entry's slate could not be identified.";
    case "unknown-contest":
      return "Contest ID was not found in the live DraftKings lobby.";
    case "ambiguous-contest":
      return "Contest ID matched multiple DraftKings contests.";
    case "unavailable-contest":
      return "DraftKings lobby identity is unavailable for this contest.";
    case "missing-local-slate":
      return "No local slate exists for this DraftKings contest.";
    case "ambiguous-local-slate":
      return "Multiple local slates share this DraftKings draft group.";
    case "resolved":
      return "";
  }
}