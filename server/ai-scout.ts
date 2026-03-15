
const NEWS_SOURCES: Record<string, string[]> = {
  NBA: [
    "https://www.rotowire.com/basketball/news.php",
    "https://www.cbssports.com/nba/injuries/",
    "https://www.espn.com/nba/injuries",
  ],
  NFL: [
    "https://www.rotowire.com/football/news.php",
    "https://www.cbssports.com/nfl/injuries/",
    "https://www.espn.com/nfl/injuries",
  ],
  MLB: [
    "https://www.rotowire.com/baseball/news.php",
    "https://www.cbssports.com/mlb/injuries/",
  ],
  NHL: [
    "https://www.rotowire.com/hockey/news.php",
    "https://www.cbssports.com/nhl/injuries/",
  ],
  GOLF: [
    "https://www.rotowire.com/golf/news.php",
    "https://www.pgatour.com/news",
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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
  Accept: "text/html,application/xhtml+xml",
};

const INTERVAL_SECS = 3600;
const ACTIVE_SPORTS = ["NBA", "NHL", "GOLF"];

let _lastRun: number = 0;
let _cachedSignals: Record<string, ScoutSignal[]> = {};
let _newsCache: Record<string, string> = {};
let _newsTtl: Record<string, number> = {};
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

async function fetchAllNews(sports: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const sport of sports) {
    const urls = NEWS_SOURCES[sport] || [];
    const chunks: string[] = [];

    for (const url of urls) {
      if (_newsCache[url] && Date.now() / 1000 < (_newsTtl[url] || 0)) {
        chunks.push(_newsCache[url]);
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) continue;
        let text = await res.text();
        text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
        _newsCache[url] = text;
        _newsTtl[url] = Date.now() / 1000 + 1800;
        chunks.push(text);
      } catch (err: any) {
        console.warn(`[AIScout] Failed to fetch ${url}: ${err.message}`);
      }
    }

    result[sport] = chunks.join("\n\n---\n\n");
  }

  return result;
}

async function callGemini(
  newsBySport: Record<string, string>,
  playersBySport: Record<string, PlayerInfo[]>
): Promise<Record<string, ScoutSignal[]>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[AIScout] No GEMINI_API_KEY set — skipping Gemini analysis");
    return {};
  }

  const sportSections: string[] = [];
  for (const sport of Object.keys(playersBySport)) {
    const playerList = playersBySport[sport]
      .slice(0, 150)
      .map(p => `  - ${p.name} (${p.team}, ${p.position}, $${p.salary.toLocaleString()}, proj=${p.fppg || "0"})`)
      .join("\n");
    const newsText = (newsBySport[sport] || "").slice(0, 6000);
    sportSections.push(
      `=== ${sport} ===\n\n<news_${sport}>\n${newsText}\n</news_${sport}>\n\n<players_${sport}>\n${playerList}\n</players_${sport}>`
    );
  }

  const prompt = `You are an expert DFS analyst for EliteLineup.com.
Current time (UTC): ${new Date().toISOString().slice(0, 16)}

Below are injury/news reports and player pools for every active DFS sport today.
Analyse each sport and produce signals for ALL sports in one response.

${sportSections.join("\n\n")}

For every player whose DFS projection should be adjusted, produce a signal with:
  - "sport":             one of ${JSON.stringify(Object.keys(playersBySport))}
  - "player_name":       exact name from that sport's player list
  - "signal_type":       one of ${JSON.stringify(Object.keys(BOOST_WEIGHTS))}
  - "reason":            1-sentence UI explanation
  - "beneficiary_names": players who benefit if this one is out/limited (may be [])
  - "ownership_delta":   integer -30 to +30
  - "confidence":        0.0 to 1.0

Flag up to 5 VALUE PLAYS per sport (signal_type "injury_opp" or "value_spike").

Return a single JSON object — sport names as keys, arrays of signal objects as values.
No markdown, no commentary.
Example:
{
  "NBA": [{"player_name":"Jaylen Brown","signal_type":"injury_opp","reason":"Tatum ruled out","beneficiary_names":[],"ownership_delta":15,"confidence":0.9}],
  "NFL": [],
  "MLB": []
}`;

  try {
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000, temperature: 0.3 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[AIScout] Gemini API error ${res.status}: ${err.slice(0, 200)}`);
      return {};
    }

    const data = await res.json() as any;
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    raw = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    const parsed: Record<string, ScoutSignal[]> = JSON.parse(raw);

    const totalSignals = Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`[AIScout] Gemini returned ${totalSignals} signals across ${Object.keys(parsed).length} sports`);

    return Object.fromEntries(
      Object.keys(playersBySport).map(sport => [sport, parsed[sport] || []])
    );
  } catch (err: any) {
    console.error(`[AIScout] Gemini analysis failed: ${err.message}`);
    return {};
  }
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
    console.log(`[AIScout] One Gemini call for sports: ${Object.keys(active).join(", ")}`);
    const newsBySport = await fetchAllNews(Object.keys(active));
    const signalsBySport = await callGemini(newsBySport, active);

    if (Object.keys(signalsBySport).length === 0) {
      console.warn("[AIScout] Gemini returned no data — keeping stale cache, will retry next cycle");
      return;
    }

    for (const [sport, signals] of Object.entries(signalsBySport)) {
      _cachedSignals[sport] = signals;
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
