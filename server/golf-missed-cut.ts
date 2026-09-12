import type { Player, Slate } from "@shared/schema";

/**
 * Golf cut status is deliberately a derived marker.  It is not written to a
 * player row: a DraftKings field is replaced between tournaments and the same
 * database player row must retain its baseline projections and history.
 *
 * The event and draft-group identifiers in the marker are important.  Apart
 * from making a status useful when looking at a response, they prevent a
 * marker accidentally being treated as evidence for a later tournament.
 */
export const GOLF_MISSED_CUT_DETAIL = "Golf missed cut";
export const GOLF_MISSED_CUT_DETAIL_PREFIX = GOLF_MISSED_CUT_DETAIL;

const ESPN_GOLF_SCOREBOARD_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/golf";
const DK_DRAFTABLES_BASE = "https://api.draftkings.com/draftgroups/v1/draftgroups";
const STATUS_TTL_MS = 2 * 60 * 1000;
const NEGATIVE_TTL_MS = 20 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const TARGET_EVENT_DAYS = 6;

type GolfSource = "draftkings" | "espn";

export interface GolfMissedCutStatus {
  source: GolfSource;
  draftKingsPlayerId?: number;
  normalizedName: string;
  name: string;
  eventId: string;
  eventName?: string;
  eventStart?: string;
  eventEnd?: string;
}

export interface GolfMissedCutEvidence {
  statuses: GolfMissedCutStatus[];
  /** A successful provider response was received (even if it had no cuts). */
  providerResponses: number;
  /** Number of provider requests which timed out or returned a failure. */
  providerFailures: number;
  /** Provider/tour keys whose date-scoped request had a transient failure. */
  failedProviders: string[];
}

interface CacheEntry {
  promise: Promise<GolfMissedCutEvidence>;
  expiresAt: number;
  lastSuccessful: GolfMissedCutEvidence | null;
}

const statusCache = new Map<string, CacheEntry>();

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

/**
 * Keep golf names conservative.  We reconcile punctuation/diacritics, but do
 * not use fuzzy or partial matching: a false cut is materially worse than an
 * unknown status.
 */
export function normalizeGolfPlayerName(name: string | null | undefined): string {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isExplicitGolfMissedCutStatus(status: unknown): boolean {
  const value = String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!value) return false;
  // Match only provider's explicit cut labels.  In particular, "post",
  // "active", a position, or an absent status is not a cut.
  return value === "cut" ||
    value === "mc" ||
    value === "missed cut" ||
    value === "status cut" ||
    value === "status mc" ||
    value === "status missed cut";
}

function statusStrings(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(item => statusStrings(item, depth + 1));
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  // Do not inspect arbitrary competitor fields (for example a player's name
  // or score). These are the fields ESPN uses for explicit status labels.
  return [
    record.name,
    record.displayName,
    record.shortDetail,
    record.detail,
    record.description,
    record.abbreviation,
    record.id,
    record.type,
  ].flatMap(item => statusStrings(item, depth + 1));
}

function competitorHasExplicitCutStatus(competitor: Record<string, any>): boolean {
  const status = competitor.status;
  if (typeof status === "string" || typeof status === "number") {
    return isExplicitGolfMissedCutStatus(status);
  }
  return statusStrings(status).some(isExplicitGolfMissedCutStatus);
}

function competitorName(competitor: Record<string, any>): string {
  const athlete = asRecord(competitor.athlete);
  return String(
    athlete.displayName ||
    athlete.fullName ||
    athlete.shortName ||
    competitor.displayName ||
    competitor.fullName ||
    competitor.name ||
    "",
  ).trim();
}

interface DateInterval {
  start: number;
  end: number;
}

function dateOnlyUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function etDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDateOnly(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateOnlyUtc(parsed);
}

function dateKeyToUtc(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function eventInterval(event: Record<string, any>, competition?: Record<string, any>): DateInterval | null {
  const comp = competition || asRecord(event.competitions?.[0]);
  const start =
    parseDateOnly(event.startDate) ??
    parseDateOnly(event.date) ??
    parseDateOnly(comp.startDate) ??
    parseDateOnly(comp.date);
  if (start == null) return null;

  // ESPN usually gives only the tournament's start date. Four rounds and a
  // weather delay fit in six calendar days; use an explicit end date when it
  // is available.
  const end =
    parseDateOnly(event.endDate) ??
    parseDateOnly(comp.endDate) ??
    start + TARGET_EVENT_DAYS * 24 * 60 * 60 * 1000;
  return { start, end: Math.max(start, end) };
}

function targetInterval(slate: Slate): DateInterval {
  const start = dateKeyToUtc(etDateKey(new Date(slate.startTime)));
  return {
    start,
    end: start + TARGET_EVENT_DAYS * 24 * 60 * 60 * 1000,
  };
}

function candidateContainsTargetEvent(candidate: DateInterval, target: DateInterval): boolean {
  // A DK golf Showdown may start on Saturday or Sunday even though the
  // tournament began on Thursday. Keep the candidate start within the target
  // tournament week, while requiring its interval to contain the slate date.
  // This excludes a prior event ending on the slate date and next week's
  // event, both of which can otherwise appear in a date-filtered response.
  const oneDay = 24 * 60 * 60 * 1000;
  const tournamentWeek = 6 * oneDay;
  return candidate.start >= target.start - tournamentWeek &&
    candidate.start <= target.start + oneDay &&
    candidate.end >= target.start;
}

function eventIdentity(event: Record<string, any>, interval: DateInterval): string {
  return String(
    event.id ||
    event.uid ||
    event.competitionId ||
    `${event.name || event.shortName || "golf-event"}-${interval.start}`,
  );
}

function eventName(event: Record<string, any>): string | undefined {
  const value = event.name || event.shortName || event.label;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dateQueryKeys(slate: Slate): string[] {
  const target = dateKeyToUtc(etDateKey(new Date(slate.startTime)));
  const oneDay = 24 * 60 * 60 * 1000;
  // ESPN's scoreboard has historically treated `dates` as an exact event
  // date, not a reliable range. Query the tournament-start week through the
  // day after the slate; event interval matching below remains authoritative.
  return [-3, -2, -1, 0, 1].map(offset => {
    const date = new Date(target + offset * oneDay);
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  });
}

async function fetchWithTimeout(url: string): Promise<{ ok: boolean; payload?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "EliteLineupAI/1.0",
      },
    });
    if (!response.ok) return { ok: false };
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDraftablesWithTimeout(
  draftGroupId: number,
): Promise<{ ok: boolean; payload?: unknown }> {
  return fetchWithTimeout(`${DK_DRAFTABLES_BASE}/${draftGroupId}/draftables`);
}

function draftKingsCutStatuses(
  draftables: Array<Record<string, any>>,
): GolfMissedCutStatus[] {
  const statuses: GolfMissedCutStatus[] = [];
  for (const draftable of draftables) {
    // `status` is the contest's authoritative status. Do not infer a cut
    // from newsStatus, score, roster ordering, or a missing draftable.
    if (
      !isExplicitGolfMissedCutStatus(draftable.status) &&
      !statusStrings(draftable.status).some(isExplicitGolfMissedCutStatus)
    ) continue;
    const name = String(draftable.displayName || `${draftable.firstName || ""} ${draftable.lastName || ""}`).trim();
    const normalizedName = normalizeGolfPlayerName(name);
    if (!normalizedName) continue;
    const eventId = String(
      draftable.competition?.competitionId ||
      draftable.competition?.name ||
      "draft-group",
    );
    statuses.push({
      source: "draftkings",
      draftKingsPlayerId: Number(draftable.draftableId) || undefined,
      normalizedName,
      name,
      eventId,
      eventName: typeof draftable.competition?.name === "string"
        ? draftable.competition.name
        : undefined,
      eventStart: draftable.competition?.startTime,
    });
  }
  return statuses;
}

function allCompetitors(payload: unknown): Array<{ competitor: Record<string, any>; event: Record<string, any>; competition: Record<string, any> }> {
  const root = asRecord(payload);
  const events: Array<Record<string, any>> = [];
  if (Array.isArray(root.events)) {
    events.push(...root.events.map(asRecord));
  } else if (root.event && typeof root.event === "object") {
    events.push(asRecord(root.event));
  } else {
    // Some ESPN responses use a single event-shaped root.
    events.push(root);
  }

  const result: Array<{ competitor: Record<string, any>; event: Record<string, any>; competition: Record<string, any> }> = [];
  for (const event of events) {
    const competitions = Array.isArray(event.competitions)
      ? event.competitions.map(asRecord)
      : [event];
    for (const competition of competitions) {
      const competitors = Array.isArray(competition.competitors)
        ? competition.competitors
        : Array.isArray(competition.leaderboard)
          ? competition.leaderboard
          : [];
      for (const rawCompetitor of competitors) {
        result.push({ competitor: asRecord(rawCompetitor), event, competition });
      }
    }
  }
  return result;
}

function espnCutStatuses(
  payload: unknown,
  target: DateInterval,
  rosterNames: Set<string>,
  league: string,
): GolfMissedCutStatus[] {
  const statuses: GolfMissedCutStatus[] = [];
  const grouped = new Map<string, {
    event: Record<string, any>;
    interval: DateInterval;
    competitors: Array<Record<string, any>>;
    competition: Record<string, any>;
  }>();

  for (const { competitor, event, competition } of allCompetitors(payload)) {
    const interval = eventInterval(event, competition);
    if (!interval || !candidateContainsTargetEvent(interval, target)) continue;
    const eventId = eventIdentity(event, interval);
    const group = grouped.get(eventId) || { event, interval, competitors: [], competition };
    group.competitors.push(competitor);
    grouped.set(eventId, group);
  }

  for (const [eventId, group] of Array.from(grouped.entries())) {
    // A date match alone is insufficient: the response can include adjacent
    // tournaments. Require an exact roster overlap with this DK slate.
    const namesInEvent = group.competitors
      .map(competitorName)
      .map(normalizeGolfPlayerName)
      .filter((name): name is string => Boolean(name));
    if (!namesInEvent.some(name => rosterNames.has(name))) continue;

    for (const competitor of group.competitors) {
      if (!competitorHasExplicitCutStatus(competitor)) continue;
      const name = competitorName(competitor);
      const normalizedName = normalizeGolfPlayerName(name);
      if (!normalizedName || !rosterNames.has(normalizedName)) continue;
      statuses.push({
        source: "espn",
        normalizedName,
        name,
        eventId: `${league}:${eventId}`,
        eventName: eventName(group.event),
        eventStart: new Date(group.interval.start).toISOString(),
        eventEnd: new Date(group.interval.end).toISOString(),
      });
    }
  }
  return statuses;
}

function uniqueStatuses(statuses: GolfMissedCutStatus[]): GolfMissedCutStatus[] {
  const seen = new Set<string>();
  return statuses.filter(status => {
    const key = `${status.source}:${status.draftKingsPlayerId || ""}:${status.normalizedName}:${status.eventId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function golfCacheKey(slate: Slate): string {
  if (slate.draftGroupId) return `dg:${slate.draftGroupId}`;
  return `event:${etDateKey(new Date(slate.startTime))}:${String(slate.name || "").toLowerCase()}`;
}

async function fetchMissedCutEvidence(
  slate: Slate,
  rosterNames: Set<string>,
): Promise<GolfMissedCutEvidence> {
  const target = targetInterval(slate);
  const requestLeagues = ["pga", "lpga", "eur"];
  const statuses: GolfMissedCutStatus[] = [];
  let providerResponses = 0;
  let providerFailures = 0;
  const failedProviders = new Set<string>();

  // DraftKings is the primary current-contest source. Once it explicitly
  // confirms a cut, there is no reason to consult a potentially stale
  // leaderboard and the marker remains scoped to this draft group.
  if (slate.draftGroupId) {
    const dk = await fetchDraftablesWithTimeout(slate.draftGroupId);
    if (dk.ok) {
      providerResponses++;
      const draftables = Array.isArray(dk.payload)
        ? dk.payload
        : Array.isArray(asRecord(dk.payload).draftables)
          ? asRecord(dk.payload).draftables
          : [];
      statuses.push(...draftKingsCutStatuses(draftables as Array<Record<string, any>>));
      if (statuses.length > 0) {
        return {
          statuses: uniqueStatuses(statuses),
          providerResponses,
          providerFailures,
          failedProviders: [],
        };
      }
    } else {
      providerFailures++;
      failedProviders.add("draftkings");
    }
  }

  // DK can be unavailable for historical/non-DK slates, and its field may
  // not expose the final cut status. In those cases query date-scoped ESPN
  // leaderboards across the applicable golf tours.
  const dates = dateQueryKeys(slate);
  const requests: Array<{ league: string; request: Promise<{ ok: boolean; payload?: unknown }> }> = [];
  for (const league of requestLeagues) {
    for (const date of dates) {
      requests.push({
        league,
        request: fetchWithTimeout(`${ESPN_GOLF_SCOREBOARD_BASE}/${league}/scoreboard?dates=${date}`),
      });
    }
  }
  const responses = await Promise.all(requests.map(item => item.request));

  let responseIndex = 0;
  for (const league of requestLeagues) {
    for (const _date of dates) {
      const response = responses[responseIndex++];
      if (!response.ok) {
        providerFailures++;
        failedProviders.add(league);
        continue;
      }
      providerResponses++;
      statuses.push(...espnCutStatuses(response.payload, target, rosterNames, league));
    }
  }

  return {
    statuses: uniqueStatuses(statuses),
    providerResponses,
    providerFailures,
    failedProviders: Array.from(failedProviders),
  };
}

function markerEventId(detail: string): string | null {
  const match = detail.match(/\bevent=([^;\]]+)/i);
  return match?.[1]?.trim() || null;
}

function markerDraftGroupId(detail: string): number | null {
  const match = detail.match(/\bdg=(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function createGolfMissedCutMarker(eventId: string, draftGroupId?: number | null): string {
  const safeEvent = String(eventId || "unknown").replace(/[;\]]/g, "_");
  const dg = draftGroupId ? `;dg=${draftGroupId}` : "";
  return `${GOLF_MISSED_CUT_DETAIL_PREFIX} [event=${safeEvent}${dg}]`;
}

export function isGolfMissedCutMarker(detail: string | null | undefined): boolean {
  return typeof detail === "string" &&
    detail.toLowerCase().startsWith(GOLF_MISSED_CUT_DETAIL_PREFIX.toLowerCase());
}

export function isGolfMissedCutMarkerForDraftGroup(
  player: Pick<Player, "injuryDetail">,
  draftGroupId: number | null | undefined,
): boolean {
  if (!isGolfMissedCutMarker(player.injuryDetail)) return false;
  const markerDg = markerDraftGroupId(player.injuryDetail!);
  // Markers without a DG are used for non-DK slates and must not leak into a
  // different DK contest. A DG-bearing marker likewise never survives a
  // status overlay for a different contest.
  if (markerDg == null) return draftGroupId == null;
  return draftGroupId == null || markerDg === draftGroupId;
}

export function protectGolfMissedCutMarker(
  player: Player,
  draftGroupId?: number | null,
): Player {
  if (!isGolfMissedCutMarkerForDraftGroup(player, draftGroupId)) return player;
  return {
    ...player,
    projectedPoints: "0",
    injuryStatus: "OUT",
    injuryDetail: player.injuryDetail,
    isConfirmedStarter: false,
  };
}

export interface GolfMissedCutEligibility {
  statuses: GolfMissedCutStatus[];
  providerResponses: number;
  providerFailures: number;
}

/**
 * Apply a live missed-cut exclusion without changing the database row. Every
 * status used below came from an explicit DK/ESPN cut label; no leaderboard
 * position, absent competitor, or pre-cut state is inferred.
 */
export async function getGolfMissedCutEvidence(
  slate: Slate,
  players: Player[],
): Promise<GolfMissedCutEvidence> {
  const key = golfCacheKey(slate);
  const now = Date.now();
  const cached = statusCache.get(key);
  if (cached && now < cached.expiresAt) return cached.promise;

  const rosterNames = new Set(
    players.map(player => normalizeGolfPlayerName(player.name)).filter(Boolean),
  );
  const stale = cached?.lastSuccessful || null;
  let entry: CacheEntry;
  const promise = fetchMissedCutEvidence(slate, rosterNames).then(result => {
    if (result.providerResponses > 0) {
      // One tour can answer successfully while the tour that supplied a
      // known cut is timing out. A partial refresh must not erase that
      // same-event explicit evidence; only an all-successful refresh is
      // authoritative for clearing old statuses.
      const failedProviders = new Set(result.failedProviders);
      const staleFromFailedProvider = stale?.statuses.filter(status => {
        if (status.source === "draftkings") return failedProviders.has("draftkings");
        const tour = status.eventId.split(":")[0];
        return failedProviders.has(tour);
      }) || [];
      const refreshed = staleFromFailedProvider.length > 0
        ? {
            ...result,
            statuses: uniqueStatuses([...result.statuses, ...staleFromFailedProvider]),
          }
        : result;
      entry.lastSuccessful = refreshed;
      entry.expiresAt = Date.now() + STATUS_TTL_MS;
      return refreshed;
    }
    // Never turn a provider outage into a "no cuts" confirmation. Keep any
    // explicit statuses observed during the previous successful response.
    entry.expiresAt = Date.now() + NEGATIVE_TTL_MS;
    return stale || result;
  });
  entry = {
    promise,
    expiresAt: now + STATUS_TTL_MS,
    lastSuccessful: stale,
  };
  statusCache.set(key, entry);
  return promise;
}

export async function applyGolfMissedCutEligibility(
  players: Player[],
  slate: Slate,
): Promise<Player[]> {
  if (players.length === 0 || String(slate.sport).toUpperCase() !== "GOLF") return players;
  const evidence = await getGolfMissedCutEvidence(slate, players);
  if (evidence.statuses.length === 0) return players;

  const byDkId = new Set(
    evidence.statuses
      .map(status => status.draftKingsPlayerId)
      .filter((id): id is number => Number.isFinite(id)),
  );
  const byName = new Set(evidence.statuses.map(status => status.normalizedName));

  return players.map(player => {
    const matches = (player.draftKingsPlayerId != null && byDkId.has(player.draftKingsPlayerId)) ||
      byName.has(normalizeGolfPlayerName(player.name));
    if (!matches) return player;

    const status = evidence.statuses.find(candidate =>
      (player.draftKingsPlayerId != null && candidate.draftKingsPlayerId === player.draftKingsPlayerId) ||
      candidate.normalizedName === normalizeGolfPlayerName(player.name),
    )!;
    return protectGolfMissedCutMarker({
      ...player,
      injuryDetail: createGolfMissedCutMarker(status.eventId, slate.draftGroupId),
    }, slate.draftGroupId);
  });
}
export const applyGolfMissedCutOverlay = applyGolfMissedCutEligibility;
export const getGolfMissedCutStatus = getGolfMissedCutEvidence;

export function clearGolfMissedCutEligibilityCache(): void {
  statusCache.clear();
}

export const resetGolfMissedCutEligibilityCache = clearGolfMissedCutEligibilityCache;

// Exposed for focused parser/cache tests without making provider calls.
export const parseGolfESPNCutStatuses = espnCutStatuses;
export const parseGolfDraftKingsCutStatuses = draftKingsCutStatuses;