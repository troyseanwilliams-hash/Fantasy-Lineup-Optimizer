export interface ShowdownSnapshotPlayer {
  id?: number;
  name?: string;
  slot?: string;
  isCaptain?: boolean;
  draftKingsPlayerId?: number | null;
  fanDuelPlayerId?: number | null;
  [key: string]: unknown;
}

export interface ShowdownLineupSnapshot {
  platform: string;
  playerSnapshot?: ShowdownSnapshotPlayer[] | null;
}

function isCaptain(player: ShowdownSnapshotPlayer): boolean {
  return player.isCaptain === true || player.slot === "CPT" || player.slot === "MVP";
}

function flexOrder(player: ShowdownSnapshotPlayer, fallback: number): number {
  const match = player.slot?.match(/^FLEX(\d+)$/i);
  return match ? Number(match[1]) : fallback;
}

/**
 * Returns a saved Showdown snapshot in upload/display slot order.
 * The server stores the captain first, but sorting by the explicit FLEX number
 * also protects the vault if JSON array order changes.
 */
export function normalizeShowdownSnapshot(
  lineup: Pick<ShowdownLineupSnapshot, "playerSnapshot">,
): ShowdownSnapshotPlayer[] {
  if (!Array.isArray(lineup.playerSnapshot)) return [];

  const captainIndex = lineup.playerSnapshot.findIndex(isCaptain);
  if (captainIndex < 0) return [];

  const captain = lineup.playerSnapshot[captainIndex];
  const flexPlayers = lineup.playerSnapshot
    .filter((_, index) => index !== captainIndex)
    .map((player, index) => ({ player, index }))
    .sort((a, b) => flexOrder(a.player, a.index + 1) - flexOrder(b.player, b.index + 1))
    .map(({ player }) => player);

  return [captain, ...flexPlayers];
}

export function isShowdownLineup(lineup: Pick<ShowdownLineupSnapshot, "playerSnapshot">): boolean {
  return normalizeShowdownSnapshot(lineup).length > 0;
}

export function formatShowdownExportPlayer(player: ShowdownSnapshotPlayer | undefined, platform: string): string {
  if (!player) return "";
  if (platform === "draftkings" && player.draftKingsPlayerId) {
    return `${player.name || ""} (${player.draftKingsPlayerId})`;
  }
  if (platform === "fanduel" && player.fanDuelPlayerId) {
    return `${player.name || ""}:${player.fanDuelPlayerId}`;
  }
  return player.name || "";
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function buildShowdownCSV(lineups: ShowdownLineupSnapshot[]): string {
  if (lineups.length === 0) return "";

  const firstSnapshot = normalizeShowdownSnapshot(lineups[0]);
  if (firstSnapshot.length === 0) return "";

  // DraftKings validates the upload header against roster-slot labels, not
  // the internal slot keys used by our saved snapshots.  FLEX1/FLEX2/etc.
  // are useful internal identifiers, but every flex column in a DraftKings
  // Showdown upload must be named simply FLEX.
  const headers = firstSnapshot.map((player, index) => {
    if (lineups[0].platform === "draftkings") {
      return index === 0 ? "CPT" : "FLEX";
    }
    return player.slot || (index === 0 ? "MVP" : `UTIL${index}`);
  });
  const rows = lineups.map(lineup => {
    const snapshot = normalizeShowdownSnapshot(lineup);
    return headers.map((_, index) => formatShowdownExportPlayer(snapshot[index], lineup.platform));
  });

  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
}

export function getShowdownDisplayData(
  lineup: Pick<ShowdownLineupSnapshot, "playerSnapshot">,
): { slots: string[]; assignments: Record<string, ShowdownSnapshotPlayer> } | null {
  const snapshot = normalizeShowdownSnapshot(lineup);
  if (snapshot.length === 0) return null;

  const slots = snapshot.map((player, index) =>
    player.slot || (index === 0 ? "CPT" : `FLEX${index}`),
  );
  const assignments: Record<string, ShowdownSnapshotPlayer> = {};
  snapshot.forEach((player, index) => {
    assignments[slots[index]] = player;
  });

  return { slots, assignments };
}