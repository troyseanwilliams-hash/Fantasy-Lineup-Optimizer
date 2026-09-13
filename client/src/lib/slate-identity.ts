import type { Slate } from "@shared/schema";

/**
 * The slate list includes a few fields that are derived while the API is
 * enriching a slate (for example `games` and `playerCount`). Keep those
 * fields optional here so the identity helpers can be used with both the
 * database shape and the enriched list shape.
 */
export type SlateListItem = Slate & {
  games?: string[];
  playerCount?: number;
};

export interface SlateIdentitySource {
  id: number;
  name?: string | null;
  label?: string | null;
  sport?: string | null;
  platform?: string | null;
  draftGroupId?: number | null;
  isMain?: boolean | null;
  gameCount?: number | null;
  startTime?: Slate["startTime"] | string | Date | null;
}

/** Exact metadata returned by /api/draftkings/slates/:sport. */
export interface DraftGroupMetadata {
  draftGroupId: number;
  label: string;
  gameCount: number;
  startTime: string | Date;
  isMain: boolean;
  isImported?: boolean;
  slateId?: number | null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function draftGroupId(
  slate: Pick<Slate, "draftGroupId"> | SlateIdentitySource | null | undefined,
): number | null {
  return positiveInteger(slate?.draftGroupId);
}

export function slateRole(
  slate: Pick<Slate, "isMain"> | SlateIdentitySource | null | undefined,
): "Main" | "Alternative" | "Slate" {
  if (slate?.isMain === true) return "Main";
  if (slate?.isMain === false) return "Alternative";
  return "Slate";
}

/**
 * Never substitute a local slate ID for a DraftKings draftGroup ID. They are
 * different identifiers and the distinction matters when two groups start at
 * the same time (for example, a featured 12-game main slate and a 14-game
 * extended slate).
 */
export function formatDraftGroupIdentity(
  slate: Pick<Slate, "platform" | "draftGroupId"> | SlateIdentitySource | null | undefined,
): string {
  const platform = String(slate?.platform || "").toLowerCase();
  const groupId = draftGroupId(slate);
  if (platform === "draftkings") {
    return groupId == null
      ? "DraftKings draftGroupId unavailable"
      : `DraftKings draftGroupId ${groupId}`;
  }
  if (platform === "fanduel") return "FanDuel contest group";
  if (platform === "yahoo") return "Yahoo contest group";
  return "Contest group unavailable";
}

function formatStartTime(startTime: Slate["startTime"] | string | Date | null | undefined): string {
  if (!startTime) return "";
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Human-readable identity used in selected-slate banners and export controls.
 * It deliberately includes both the app slate row ID and the platform group
 * ID, making it obvious which object an export or generated lineup targets.
 */
export function formatSlateIdentity(
  slate: SlateIdentitySource | null | undefined,
): string {
  if (!slate) return "No slate selected";
  const name = String(slate.label || slate.name || "Unnamed slate");
  const role = slateRole(slate);
  const gameCount = Number(slate.gameCount);
  const games = Number.isFinite(gameCount) && gameCount > 0 ? ` · ${gameCount} games` : "";
  const date = formatStartTime(slate.startTime);
  return [
    `${role}: ${name}`,
    `Slate #${slate.id}`,
    formatDraftGroupIdentity(slate),
    date,
    games.replace(/^ ·/, ""),
  ].filter(Boolean).join(" · ");
}

/**
 * Labels for a native select must contain enough information to distinguish
 * alternatives without relying on a star or a game-count heuristic.
 */
export function formatSlateOptionLabel(slate: SlateListItem): string {
  const name = String(slate.label || slate.name || "Unnamed slate");
  const role = slateRole(slate).toUpperCase();
  const gameCount = Number(slate.gameCount);
  const games = Number.isFinite(gameCount) && gameCount > 0 ? ` · ${gameCount} games` : "";
  const date = formatStartTime(slate.startTime);
  return [
    `${role} · ${name}`,
    formatDraftGroupIdentity(slate),
    `Slate #${slate.id}`,
    date,
    games.replace(/^ ·/, ""),
  ].filter(Boolean).join(" · ");
}

export function formatDraftGroupOptionLabel(group: DraftGroupMetadata): string {
  const role = group.isMain ? "MAIN" : "ALTERNATIVE";
  const games = Number(group.gameCount) > 0 ? ` · ${group.gameCount} games` : "";
  const date = formatStartTime(group.startTime);
  return [
    `${role} · ${group.label || "Unnamed DraftKings group"}`,
    `DraftKings draftGroupId ${group.draftGroupId}`,
    date,
    games.replace(/^ ·/, ""),
    group.isImported ? "Imported" : "Not imported",
  ].filter(Boolean).join(" · ");
}

export function draftKingsSlatesPath(sport: string, draftGroupId?: number | string): string {
  const encodedSport = encodeURIComponent(String(sport).toUpperCase());
  if (draftGroupId === undefined) return `/api/draftkings/slates/${encodedSport}`;
  const id = positiveInteger(draftGroupId);
  if (id == null) throw new Error("Cannot target an invalid DraftKings draftGroupId.");
  return `/api/draftkings/slates/${encodedSport}?draftGroupId=${id}`;
}

/**
 * Keep navigation to an explicitly selected slate tied to its local row ID.
 * The backend resolves/loads that row's draftGroupId; callers must not build a
 * URL from a DraftKings group ID.
 */
export function optimizerSlatePath(mode: "standard" | "pro", slateId: number | string): string {
  const id = positiveInteger(slateId);
  if (id == null) throw new Error("Cannot navigate to an invalid slate.");
  return `${mode === "pro" ? "/optimizer-pro" : "/optimizer"}/${id}`;
}

export function slateForId(slates: SlateListItem[] | undefined, id: number | string | null | undefined): SlateListItem | undefined {
  const slateId = positiveInteger(id);
  if (!slateId) return undefined;
  return slates?.find(slate => Number(slate.id) === slateId);
}

/**
 * Available alternatives for a source lineup. The source row is intentionally
 * excluded; selecting a target here is for generating a new roster only.
 * Nothing in this helper mutates or relabels the source lineup.
 */
export function availableSlateTargets(
  slates: SlateListItem[] | undefined,
  source: Pick<Slate, "sport" | "platform" | "id"> | null | undefined,
): SlateListItem[] {
  if (!slates || !source) return [];
  return slates
    .filter(slate =>
      slate.isActive !== false &&
      slate.id !== source.id &&
      slate.sport === source.sport &&
      slate.platform === source.platform &&
      (slate.playerCount === undefined || slate.playerCount > 0),
    )
    .sort((a, b) => {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
}