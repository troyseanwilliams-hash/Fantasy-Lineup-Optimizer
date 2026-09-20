import type { Player } from "@shared/schema";

/**
 * The value ESPN uses for a player who is on a practice squad.  Keep this
 * marker stable: it is intentionally not written to the player row, and is
 * also used by the live DK status overlay to avoid clearing this derived
 * exclusion.
 */
export const NFL_PRACTICE_SQUAD_DETAIL = "ESPN practice squad";
export const PRACTICE_SQUAD_INJURY_DETAIL = NFL_PRACTICE_SQUAD_DETAIL;

const ESPN_ROSTER_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams";
const ROSTER_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;
const TEAM_MAP_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * This is the same ESPN proTeamId mapping used by the NFL draft feed.  It
 * means a normal DFS abbreviation does not require a team-directory request
 * before its roster can be fetched.  The directory is still consulted once
 * for an abbreviation added by a provider in the future.
 */
const ESPN_TEAM_IDS: Record<string, string> = {
  ARI: "22",
  ATL: "1",
  BAL: "33",
  BUF: "2",
  CAR: "29",
  CHI: "3",
  CIN: "4",
  CLE: "5",
  DAL: "6",
  DEN: "7",
  DET: "8",
  GB: "9",
  HOU: "34",
  IND: "11",
  JAX: "30",
  KC: "12",
  LV: "13",
  LAC: "24",
  LAR: "14",
  MIA: "15",
  MIN: "16",
  NE: "17",
  NO: "18",
  NYG: "19",
  NYJ: "20",
  PHI: "21",
  PIT: "23",
  SF: "25",
  SEA: "26",
  TB: "27",
  TEN: "10",
  WAS: "28",
};

export { normalizeNFLTeam } from "./nfl-team";
import { normalizeNFLTeam } from "./nfl-team";

/**
 * Name normalization deliberately keeps suffix tokens.  We only use the
 * suffix-free form as a fallback when it identifies one (and only one)
 * player on that team's roster.  This handles "Theo Wease Jr." versus
 * "Theo Wease Jr" without making two same-team players with the same base
 * name indistinguishable.
 */
export function normalizeNFLPlayerName(name: string | null | undefined): string {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // The server's TypeScript target is ES5; keep this regex compatible with
    // that target after folding accented Latin characters above.
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export const normalizeNFLName = normalizeNFLPlayerName;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "vi"]);

function withoutNameSuffix(name: string): string {
  const parts = name.split(" ");
  if (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) {
    return parts.slice(0, -1).join(" ");
  }
  return name;
}

function nameSuffix(name: string): string | null {
  const last = name.split(" ").pop() || "";
  return NAME_SUFFIXES.has(last) ? last : null;
}

function namesMatchWithOptionalSuffix(left: string, right: string): boolean {
  if (left === right) return true;
  const leftBase = withoutNameSuffix(left);
  const rightBase = withoutNameSuffix(right);
  if (leftBase !== rightBase) return false;
  const leftSuffix = nameSuffix(left);
  const rightSuffix = nameSuffix(right);
  // A missing suffix may be reconciled, but two different explicit suffixes
  // (e.g. Jr versus III) must not be treated as the same athlete.
  return !leftSuffix || !rightSuffix || leftSuffix === rightSuffix;
}

export type NFLRosterStatus = "practice-squad" | "active" | "unknown";

export interface NFLRosterEntry {
  name: string;
  normalizedName: string;
  status: NFLRosterStatus;
}

export interface ParsedNFLRoster {
  entries: NFLRosterEntry[];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function explicitRosterStatus(item: Record<string, any>): NFLRosterStatus {
  const status = asRecord(item.status);
  const statusType = String(status.type || status.name || "").trim().toLowerCase();
  const statusId = String(status.id ?? "").trim().toLowerCase();

  // ESPN's current feed uses both of these values.  Do not infer practice
  // squad solely from the surrounding group/position.
  if (
    statusId === "29" ||
    statusType === "practice-squad" ||
    statusType === "practice squad" ||
    statusType === "practicesquad"
  ) {
    return "practice-squad";
  }

  // These are explicit positive roster statuses.  Unknown/missing statuses
  // must remain unknown; absence from this feed is never an exclusion signal.
  if (
    statusType === "active" ||
    statusType === "active-roster" ||
    statusType === "active roster" ||
    statusType === "elevated" ||
    statusType === "standard"
  ) {
    return "active";
  }
  if (["1", "active"].includes(statusId)) return "active";

  return "unknown";
}

function itemName(item: Record<string, any>): string {
  if (typeof item.fullName === "string") return item.fullName;
  if (typeof item.displayName === "string") return item.displayName;
  if (typeof item.name === "string") return item.name;
  const athlete = asRecord(item.athlete);
  return String(athlete.fullName || athlete.displayName || athlete.name || "");
}

/**
 * Pure parser for the ESPN roster response.  Group position is intentionally
 * not enough to classify an athlete: only an explicit positive status on the
 * item can make an athlete practice squad or active.
 */
export function parseNFLRoster(payload: unknown): ParsedNFLRoster {
  const root = asRecord(payload);
  const groups = Array.isArray(root.athletes) ? root.athletes : [];
  const entries: NFLRosterEntry[] = [];

  for (const rawGroup of groups) {
    const group = asRecord(rawGroup);
    const items = Array.isArray(group.items) ? group.items : [];
    for (const rawItem of items) {
      const item = asRecord(rawItem);
      const name = itemName(item);
      const normalizedName = normalizeNFLPlayerName(name);
      if (!normalizedName) continue;
      entries.push({ name, normalizedName, status: explicitRosterStatus(item) });
    }
  }

  return { entries };
}
export const parseESPNNFLRoster = parseNFLRoster;

export function rosterStatusForPlayer(
  roster: ParsedNFLRoster,
  playerName: string,
): NFLRosterStatus {
  const normalized = normalizeNFLPlayerName(playerName);
  if (!normalized) return "unknown";

  const exact = roster.entries.filter(entry => entry.normalizedName === normalized);
  if (exact.length > 0) {
    // A duplicate should never promote an explicit practice squad entry to
    // active.  Prefer the most restrictive explicit status.
    if (exact.some(entry => entry.status === "practice-squad")) return "practice-squad";
    if (exact.some(entry => entry.status === "active")) return "active";
    return "unknown";
  }

  const suffixMatches = roster.entries.filter(
    entry => namesMatchWithOptionalSuffix(normalized, entry.normalizedName),
  );
  // Never choose arbitrarily when suffix stripping creates an ambiguity.
  if (suffixMatches.length !== 1) return "unknown";
  return suffixMatches[0].status;
}

// Alias useful to callers/tests that describe the operation as matching.
export const matchNFLRosterStatus = rosterStatusForPlayer;
export const getNFLRosterStatus = rosterStatusForPlayer;

interface RosterCacheEntry {
  promise: Promise<ParsedNFLRoster | null>;
  expiresAt: number;
  lastSuccessful: ParsedNFLRoster | null;
}

let teamMapPromise: Promise<Map<string, string>> | null = null;
let teamMapExpiresAt = 0;
const rosterPromiseCache = new Map<string, RosterCacheEntry>();

function parseTeamDirectory(payload: unknown): Map<string, string> {
  const root = asRecord(payload);
  const firstLeague = Array.isArray(root.leagues) ? asRecord(root.leagues[0]) : {};
  const firstSport = Array.isArray(root.sports) ? asRecord(root.sports[0]) : {};
  const sportLeagues = Array.isArray(firstSport.leagues) ? firstSport.leagues : [];
  const firstSportLeague = asRecord(sportLeagues[0]);
  const teams: unknown[] =
    (Array.isArray(root.teams) && root.teams) ||
    (Array.isArray(firstLeague.teams) && firstLeague.teams) ||
    (Array.isArray(firstSportLeague.teams)
      ? firstSportLeague.teams
      : []);
  const result = new Map<string, string>();

  for (const rawEntry of teams) {
    const entry = asRecord(rawEntry);
    const team = asRecord(entry.team || entry);
    const id = String(team.id || "").trim();
    const abbreviation = normalizeNFLTeam(team.abbreviation || team.abbrev);
    if (id && abbreviation) result.set(abbreviation, id);
  }
  return result;
}

async function fetchTeamDirectory(): Promise<Map<string, string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${ESPN_ROSTER_URL}?limit=50`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`ESPN team directory HTTP ${response.status}`);
    return parseTeamDirectory(await response.json());
  } catch (error) {
    console.error("[NFLRoster] ESPN team directory fetch failed:", error);
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

async function getTeamId(team: string): Promise<string | null> {
  const canonical = normalizeNFLTeam(team);
  if (!canonical) return null;

  const staticId = ESPN_TEAM_IDS[canonical];
  if (staticId) return staticId;

  if (!teamMapPromise || Date.now() >= teamMapExpiresAt) {
    teamMapPromise = fetchTeamDirectory();
    teamMapExpiresAt = Date.now() + TEAM_MAP_TTL_MS;
  }
  const discovered = await teamMapPromise;
  return discovered.get(canonical) || null;
}

async function fetchRoster(team: string): Promise<ParsedNFLRoster | null> {
  const teamId = await getTeamId(team);
  if (!teamId) {
    console.warn(`[NFLRoster] No ESPN team ID for ${team}; eligibility remains unknown`);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${ESPN_ROSTER_URL}/${teamId}/roster`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`ESPN roster HTTP ${response.status}`);
    return parseNFLRoster(await response.json());
  } catch (error) {
    console.error(`[NFLRoster] ESPN roster fetch failed for ${normalizeNFLTeam(team)}:`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Return a cached promise, not just a cached result.  Concurrent optimizer
 * requests for the same team therefore share one in-flight request.  Failed
 * fetches receive a short negative TTL and leave all players eligible/
 * unknown rather than dropping a team.
 */
export function getNFLRoster(team: string): Promise<ParsedNFLRoster | null> {
  const canonical = normalizeNFLTeam(team);
  const now = Date.now();
  const cached = rosterPromiseCache.get(canonical);
  if (cached && now < cached.expiresAt) return cached.promise;

  const staleRoster = cached?.lastSuccessful || null;
  let entry: RosterCacheEntry;
  const promise = fetchRoster(canonical).then(result => {
    if (result !== null) {
      entry.lastSuccessful = result;
      entry.expiresAt = Date.now() + ROSTER_TTL_MS;
      return result;
    }

    // A transient outage must not turn a known practice-squad player into a
    // playable row. Keep the last successful roster for a short retry window.
    // Teams with no successful roster remain unknown (null), as before.
    entry.expiresAt = Date.now() + NEGATIVE_TTL_MS;
    return staleRoster;
  });
  entry = {
    promise,
    // The promise always resolves (fetchRoster handles errors). A null
    // lastSuccessful value is the negative cache case.
    expiresAt: now + ROSTER_TTL_MS,
    lastSuccessful: staleRoster,
  };
  rosterPromiseCache.set(canonical, entry);
  return promise;
}

export const fetchNFLRoster = getNFLRoster;

export interface NFLRosterEligibility {
  status: NFLRosterStatus;
  matched: boolean;
}

/**
 * Keep the derived marker authoritative when another live provider overlays a
 * player.  In particular, a DK "Healthy" response must not clear it.
 */
export function protectNFLPracticeSquadMarker(player: Player): Player {
  if (player.injuryDetail !== NFL_PRACTICE_SQUAD_DETAIL) return player;
  return {
    ...player,
    projectedPoints: "0",
    fppg: "0",
    injuryStatus: "OUT",
    injuryDetail: NFL_PRACTICE_SQUAD_DETAIL,
    isConfirmedStarter: false,
  };
}

export async function getNFLRosterEligibility(
  team: string,
  playerName: string,
): Promise<NFLRosterEligibility> {
  const roster = await getNFLRoster(team);
  if (!roster) return { status: "unknown", matched: false };
  const normalized = normalizeNFLPlayerName(playerName);
  const status = rosterStatusForPlayer(roster, playerName);
  return {
    status,
    matched: roster.entries.some(entry =>
      namesMatchWithOptionalSuffix(normalized, entry.normalizedName),
    ),
  };
}

function isNFLDefense(position: string | null | undefined): boolean {
  return String(position || "")
    .toUpperCase()
    .split("/")
    .some(positionPart => positionPart === "DST" || positionPart === "DEF");
}

/**
 * Apply the live practice-squad exclusion without mutating or persisting any
 * player.  Grouping by the player's team is important: a duplicate name on a
 * different NFL team cannot be excluded by another team's roster.
 */
export async function applyNFLRosterEligibility(players: Player[]): Promise<Player[]> {
  if (players.length === 0) return players;

  const byTeam = new Map<string, Player[]>();
  for (const player of players) {
    // DST rows do not represent athletes and must remain in every NFL pool.
    if (isNFLDefense(player.position)) continue;
    const team = normalizeNFLTeam(player.team);
    if (!team) continue;
    const teamPlayers = byTeam.get(team) || [];
    teamPlayers.push(player);
    byTeam.set(team, teamPlayers);
  }

  const rosters = new Map<string, ParsedNFLRoster | null>();
  await Promise.all(Array.from(byTeam.keys()).map(async team => {
    rosters.set(team, await getNFLRoster(team));
  }));

  return players.map(player => {
    if (isNFLDefense(player.position)) return player;
    const team = normalizeNFLTeam(player.team);
    const roster = rosters.get(team);
    if (!roster || rosterStatusForPlayer(roster, player.name) !== "practice-squad") {
      return player;
    }
    return protectNFLPracticeSquadMarker({
      ...player,
      injuryDetail: NFL_PRACTICE_SQUAD_DETAIL,
    });
  });
}
export const applyNFLPracticeSquadOverlay = applyNFLRosterEligibility;

// Test/support hook. It does not alter production behavior and permits tests
// to isolate cache semantics without waiting five minutes.
export function clearNFLRosterEligibilityCache(): void {
  rosterPromiseCache.clear();
  teamMapPromise = null;
  teamMapExpiresAt = 0;
}

export const resetNFLRosterEligibilityCache = clearNFLRosterEligibilityCache;