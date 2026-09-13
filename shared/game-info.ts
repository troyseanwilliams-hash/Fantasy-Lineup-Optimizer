/**
 * DraftKings lifecycle timestamps are persisted in gameInfo so expiration can
 * still use the provider's original competition start time after a slate has
 * been refreshed. They are storage metadata, not part of the user-facing
 * matchup string.
 */
const DK_START_MARKER = /\s*\[DK_START:[^\]]+\]\s*$/i;
const TIME_RE = /(?:\s+)(\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*ET)?|TBD|TBA)$/i;
const MATCHUP_RE = /^(.+?)\s*(?:@|vs\.?)\s*(.+)$/i;

export interface ParsedGameInfo {
  /** Original persisted value, including any lifecycle metadata. */
  raw: string;
  /** Safe value for rendering, filtering, and display parsing. */
  display: string;
  /** Matchup without its trailing time, normalized to `AWAY @ HOME`. */
  matchup: string;
  away: string | null;
  home: string | null;
  time: string | null;
}

export function sanitizeGameInfo(gameInfo: string | null | undefined): string {
  return String(gameInfo || "").replace(DK_START_MARKER, "").trim();
}

export function getDraftKingsStartMarker(gameInfo: string | null | undefined): string | null {
  const match = String(gameInfo || "").match(/\[DK_START:([^\]]+)\]\s*$/i);
  return match?.[1] || null;
}

export function parseGameInfo(gameInfo: string | null | undefined): ParsedGameInfo {
  const raw = String(gameInfo || "");
  const display = sanitizeGameInfo(raw);
  const timeMatch = display.match(TIME_RE);
  const time = timeMatch?.[1]?.trim() || null;
  const matchupDisplay = (timeMatch ? display.slice(0, timeMatch.index) : display)
    .replace(/[·|]\s*$/, "")
    .trim();
  const matchup = matchupDisplay.match(MATCHUP_RE);
  if (!matchup) {
    return {
      raw,
      display,
      matchup: matchupDisplay,
      away: null,
      home: null,
      time,
    };
  }
  return {
    raw,
    display,
    matchup: `${matchup[1].trim()} @ ${matchup[2].trim()}`,
    away: matchup[1].trim() || null,
    home: matchup[2].trim() || null,
    time,
  };
}
