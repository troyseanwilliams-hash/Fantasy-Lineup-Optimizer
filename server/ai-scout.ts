
const NEWS_SOURCES: Record<string, Array<{ url: string; type: "injuries" | "news" }>> = {
  NBA: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", type: "injuries" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50", type: "news" },
  ],
  NFL: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", type: "injuries" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50", type: "news" },
  ],
  MLB: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries", type: "injuries" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit=50", type: "news" },
  ],
  NHL: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries", type: "injuries" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=50", type: "news" },
  ],
  GOLF: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=30", type: "news" },
  ],
  SOCCER: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/soccer/news?limit=30", type: "news" },
  ],
};

export const BOOST_WEIGHTS: Record<string, number> = {
  starter_out: 5.0,
  injury_opp: 4.0,
  lineup_promotion: 3.5,
  weather_boost: 2.0,
  matchup_upgrade: 2.0,
  confirmed_starter: 1.5,
  value_spike: 1.5,
  hot_streak: 1.0,
  negative_news: -3.0,
  out: -99.0,
};

export interface ScoutSignal {
  player_name: string;
  signal_type: string;
  reason: string;
  beneficiary_names: string[];
  ownership_delta: number;
  confidence: number;
}

interface SportStatus {
  signal_count: number;
  boost_count: number;
  injury_count: number;
  next_refresh: number;
}

type PlayerInfo = {
  name: string;
  team: string;
  position: string;
  salary: number;
  fppg: string | null;
};

interface ESPNInjury {
  name: string;
  team: string;
  status: string;
  type: string;
  position: string;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
  Accept: "application/json",
};

const INTERVAL_SECS = 1800;
const ACTIVE_SPORTS = ["NBA", "NHL", "GOLF"];

let _lastRun: number = 0;
let _cachedSignals: Record<string, ScoutSignal[]> = {};
let _isRefreshing = false;

function isStale(): boolean {
  return (Date.now() / 1000 - _lastRun) >= INTERVAL_SECS;
}

export function secondsUntilRefresh(): number {
  const elapsed = Date.now() / 1000 - _lastRun;
  return Math.max(0, Math.round(INTERVAL_SECS - elapsed));
}

export function getCachedSignals(sport: string): ScoutSignal[] {
  return _cachedSignals[sport.toUpperCase()] || [];
}

export function isRefreshing(): boolean {
  return _isRefreshing;
}

const OUT_STATUSES = new Set(["out", "injured reserve", "suspension", "not with team", "ir"]);
const LIMITED_STATUSES = new Set(["doubtful", "questionable", "day-to-day", "probable"]);

async function fetchESPNData(sports: string[]): Promise<{
  injuries: Record<string, ESPNInjury[]>;
  headlines: Record<string, string[]>;
}> {
  const injuries: Record<string, ESPNInjury[]> = {};
  const headlines: Record<string, string[]> = {};

  for (const sport of sports) {
    const sources = NEWS_SOURCES[sport] || [];
    injuries[sport] = [];
    headlines[sport] = [];

    for (const source of sources) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(source.url, {
          headers: HEADERS,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn(`[AIScout] ${source.url} → HTTP ${res.status}`);
          continue;
        }

        const json = await res.json() as any;

        if (source.type === "injuries") {
          const injuryTeams = json.season?.injuries || json.injuries || [];
          for (const team of injuryTeams) {
            const teamAbbr = team.team?.abbreviation || team.team?.shortDisplayName || "";
            for (const inj of (team.injuries || [])) {
              const name = inj.athlete?.displayName || inj.athlete?.fullName || "";
              const status = (inj.status || "").toLowerCase().trim();
              const type = inj.details?.type || inj.details?.detail || "";
              const position = inj.athlete?.position?.abbreviation || "";
              if (name) {
                injuries[sport].push({ name, team: teamAbbr, status, type, position });
              }
            }
          }
          console.log(`[AIScout] ${sport} ← injuries (${injuries[sport].length} players)`);
        }

        if (source.type === "news") {
          const articles = json.articles || json.feed || [];
          for (const a of articles.slice(0, 30)) {
            const headline = a.headline || a.title || "";
            const desc = a.description || a.summary || "";
            if (headline) headlines[sport].push(`${headline}. ${desc}`.trim());
          }
          console.log(`[AIScout] ${sport} ← news (${headlines[sport].length} headlines)`);
        }
      } catch (err: any) {
        console.warn(`[AIScout] Failed to fetch ${source.url}: ${err.message}`);
      }
    }
  }

  return { injuries, headlines };
}

function normalizeNameForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function findBeneficiaries(
  outPlayer: { name: string; team: string; position: string },
  allPlayers: PlayerInfo[]
): string[] {
  const teammates = allPlayers.filter(p =>
    p.team === outPlayer.team && p.name !== outPlayer.name
  );

  const samePos = teammates
    .filter(p => {
      const pPositions = p.position.split("/").map(s => s.trim().toUpperCase());
      const outPositions = outPlayer.position.split("/").map(s => s.trim().toUpperCase());
      return pPositions.some(pp => outPositions.includes(pp));
    })
    .sort((a, b) => (parseFloat(b.fppg || "0") - parseFloat(a.fppg || "0")));

  if (samePos.length > 0) return samePos.slice(0, 3).map(p => p.name);

  return teammates
    .sort((a, b) => (parseFloat(b.fppg || "0") - parseFloat(a.fppg || "0")))
    .slice(0, 2)
    .map(p => p.name);
}

function analyzeData(
  espnData: { injuries: Record<string, ESPNInjury[]>; headlines: Record<string, string[]> },
  playersBySport: Record<string, PlayerInfo[]>
): Record<string, ScoutSignal[]> {
  const result: Record<string, ScoutSignal[]> = {};

  for (const sport of Object.keys(playersBySport)) {
    const signals: ScoutSignal[] = [];
    const players = playersBySport[sport];
    const sportInjuries = espnData.injuries[sport] || [];
    const sportHeadlines = espnData.headlines[sport] || [];
    const playerMap = new Map(players.map(p => [normalizeNameForMatch(p.name), p]));

    for (const inj of sportInjuries) {
      const normalizedName = normalizeNameForMatch(inj.name);
      const matchedPlayer = playerMap.get(normalizedName);

      if (OUT_STATUSES.has(inj.status)) {
        signals.push({
          player_name: inj.name,
          signal_type: "out",
          reason: `${inj.name} ruled OUT${inj.type ? ` (${inj.type})` : ""}`,
          beneficiary_names: matchedPlayer
            ? findBeneficiaries({ name: inj.name, team: matchedPlayer.team, position: matchedPlayer.position }, players)
            : findBeneficiaries({ name: inj.name, team: inj.team, position: inj.position }, players),
          ownership_delta: -20,
          confidence: 0.95,
        });

        if (matchedPlayer) {
          const beneficiaries = findBeneficiaries(
            { name: inj.name, team: matchedPlayer.team, position: matchedPlayer.position },
            players
          );
          for (const bName of beneficiaries.slice(0, 2)) {
            const bPlayer = players.find(p => p.name === bName);
            if (bPlayer) {
              signals.push({
                player_name: bName,
                signal_type: "injury_opp",
                reason: `${inj.name} ruled OUT — ${bName} gets expanded role`,
                beneficiary_names: [],
                ownership_delta: Math.min(20, Math.round(parseFloat(matchedPlayer.fppg || "0") / 3)),
                confidence: 0.8,
              });
            }
          }
        }
      } else if (LIMITED_STATUSES.has(inj.status)) {
        if (matchedPlayer) {
          const statusLabel = inj.status.charAt(0).toUpperCase() + inj.status.slice(1);
          signals.push({
            player_name: inj.name,
            signal_type: "negative_news",
            reason: `${inj.name} listed as ${statusLabel}${inj.type ? ` (${inj.type})` : ""} — monitor status`,
            beneficiary_names: findBeneficiaries(
              { name: inj.name, team: matchedPlayer.team, position: matchedPlayer.position },
              players
            ),
            ownership_delta: inj.status === "doubtful" ? -12 : inj.status === "questionable" ? -5 : -2,
            confidence: inj.status === "doubtful" ? 0.8 : 0.6,
          });
        }
      }
    }

    const outNames = new Set(
      sportInjuries.filter(i => OUT_STATUSES.has(i.status)).map(i => normalizeNameForMatch(i.name))
    );
    const questionableNames = new Set(
      sportInjuries.filter(i => LIMITED_STATUSES.has(i.status)).map(i => normalizeNameForMatch(i.name))
    );

    const hotStreakPatterns = [
      /(\w[\w\s.'-]+?) (?:scores?|had|puts up|records?|posts?|tallied?|notch(?:es|ed)?)\s+(\d+)\s+(?:points|pts|goals?|assists?|rebounds|hits|strikeouts)/i,
      /(\w[\w\s.'-]+?) (?:leads?|carries?|powers?|paces?|fuels?|propels?|lifts?|sparks?)/i,
      /(\w[\w\s.'-]+?) (?:has|had|with)\s+(?:a\s+)?(?:triple[- ]double|double[- ]double|career[- ]high|season[- ]high)/i,
    ];

    for (const headline of sportHeadlines) {
      for (const pattern of hotStreakPatterns) {
        const match = pattern.exec(headline);
        if (match) {
          const rawName = match[1].trim();
          const normalizedHL = normalizeNameForMatch(rawName);
          const matchedP = playerMap.get(normalizedHL);
          if (matchedP && !outNames.has(normalizedHL) && !signals.some(s => s.player_name === matchedP.name && s.signal_type === "hot_streak")) {
            signals.push({
              player_name: matchedP.name,
              signal_type: "hot_streak",
              reason: headline.split(".")[0].trim().slice(0, 120),
              beneficiary_names: [],
              ownership_delta: 5,
              confidence: 0.65,
            });
          }
        }
      }
    }

    const avgFppg = players.reduce((s, p) => s + parseFloat(p.fppg || "0"), 0) / Math.max(players.length, 1);
    const valuePlays = players
      .filter(p => {
        const norm = normalizeNameForMatch(p.name);
        return !outNames.has(norm) && !questionableNames.has(norm) && !signals.some(s => s.player_name === p.name);
      })
      .map(p => ({
        player: p,
        value: parseFloat(p.fppg || "0") / Math.max(p.salary / 1000, 1),
        projAboveAvg: parseFloat(p.fppg || "0") - avgFppg,
      }))
      .filter(v => v.value > 4.5 && v.player.salary > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    for (const vp of valuePlays) {
      signals.push({
        player_name: vp.player.name,
        signal_type: "value_spike",
        reason: `${vp.player.name} ($${vp.player.salary.toLocaleString()}) projects ${parseFloat(vp.player.fppg || "0").toFixed(1)} pts — ${vp.value.toFixed(1)}x value`,
        beneficiary_names: [],
        ownership_delta: Math.min(10, Math.round(vp.value)),
        confidence: 0.7,
      });
    }

    result[sport] = signals;
  }

  return result;
}

export async function refreshAll(
  playersBySport: Record<string, PlayerInfo[]>,
  force: boolean = false
): Promise<void> {
  if (!force && !isStale()) {
    console.log(`[AIScout] Cache is fresh (${Math.round(Date.now() / 1000 - _lastRun)}s old) — skipping`);
    return;
  }

  if (_isRefreshing) {
    console.log("[AIScout] Refresh already in-flight — skipping");
    return;
  }

  const active = Object.fromEntries(
    Object.entries(playersBySport).filter(([, players]) => players.length > 0)
  );

  if (Object.keys(active).length === 0) {
    console.warn("[AIScout] refreshAll called with no players — skipping");
    return;
  }

  _isRefreshing = true;
  try {
    console.log(`[AIScout] Analyzing sports: ${Object.keys(active).join(", ")} (rule-based, no API key needed)`);
    const espnData = await fetchESPNData(Object.keys(active));
    const signalsBySport = analyzeData(espnData, active);

    const totalSignals = Object.values(signalsBySport).reduce((s, a) => s + a.length, 0);
    const hadPriorData = Object.values(_cachedSignals).reduce((s, a) => s + a.length, 0) > 0;
    if (totalSignals === 0 && hadPriorData) {
      console.warn("[AIScout] Analysis returned 0 signals but cache has data — keeping stale cache, will retry next cycle");
      return;
    }

    for (const [sport, signals] of Object.entries(signalsBySport)) {
      if (signals.length > 0 || !_cachedSignals[sport]?.length) {
        _cachedSignals[sport] = signals;
      }
      console.log(`[AIScout]   ${sport} → ${signals.length} signals`);
    }

    _lastRun = Date.now() / 1000;
    const total = Object.values(signalsBySport).reduce((s, a) => s + a.length, 0);
    console.log(`[AIScout] Refresh done — ${total} total signals across ${Object.keys(signalsBySport).length} sports`);
  } catch (err: any) {
    console.error(`[AIScout] refreshAll failed: ${err.message}`);
  } finally {
    _isRefreshing = false;
  }
}

export function forceRefreshAll() {
  _lastRun = 0;
}

export function getScoutStatus(): {
  per_sport: Record<string, SportStatus>;
  next_refresh: number;
  is_refreshing: boolean;
} {
  const nextRefresh = secondsUntilRefresh();
  const perSport: Record<string, SportStatus> = {};

  for (const sport of ACTIVE_SPORTS) {
    const signals = _cachedSignals[sport] || [];
    perSport[sport] = {
      signal_count: signals.length,
      boost_count: signals.filter(s =>
        BOOST_WEIGHTS[s.signal_type] !== undefined && BOOST_WEIGHTS[s.signal_type] > 0
      ).length,
      injury_count: signals.filter(s =>
        ["out", "negative_news", "starter_out"].includes(s.signal_type)
      ).length,
      next_refresh: nextRefresh,
    };
  }

  return { per_sport: perSport, next_refresh: nextRefresh, is_refreshing: _isRefreshing };
}

export async function runScoutForAllSports(
  getPlayers: (sport: string) => Promise<PlayerInfo[]>
) {
  const playersBySport: Record<string, PlayerInfo[]> = {};
  for (const sport of ACTIVE_SPORTS) {
    try {
      const players = await getPlayers(sport);
      if (players.length > 0) {
        playersBySport[sport] = players;
      }
    } catch (err: any) {
      console.error(`[AIScout] Failed to get players for ${sport}: ${err.message}`);
    }
  }

  if (Object.keys(playersBySport).length > 0) {
    await refreshAll(playersBySport);
  }
}
