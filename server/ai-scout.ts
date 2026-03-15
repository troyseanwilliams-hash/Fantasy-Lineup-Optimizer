
// ── News Sources ──────────────────────────────────────────────────────────────
// These are free, public, bot-friendly endpoints that don't require an API key.
// RotoWire RSS feeds are public. ESPN injury API returns JSON directly.
// Replaced HTML scraping (which gets bot-blocked) with structured feeds.

const NEWS_SOURCES: Record<string, Array<{ url: string; type: "rss" | "json" | "html" }>> = {
  NBA: [
    { url: "https://www.rotowire.com/basketball/rss/news.php", type: "rss" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", type: "json" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50", type: "json" },
  ],
  NFL: [
    { url: "https://www.rotowire.com/football/rss/news.php", type: "rss" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", type: "json" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50", type: "json" },
  ],
  MLB: [
    { url: "https://www.rotowire.com/baseball/rss/news.php", type: "rss" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries", type: "json" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit=50", type: "json" },
  ],
  NHL: [
    { url: "https://www.rotowire.com/hockey/rss/news.php", type: "rss" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries", type: "json" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=50", type: "json" },
  ],
  GOLF: [
    { url: "https://www.rotowire.com/golf/rss/news.php", type: "rss" },
    { url: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/news?limit=30", type: "json" },
  ],
  SOCCER: [
    { url: "https://site.api.espn.com/apis/site/v2/sports/soccer/news?limit=30", type: "json" },
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

const INTERVAL_SECS = 1800; // 30 minutes — max 2 calls/hour, well within Gemini free tier (1,500/day)
const ACTIVE_SPORTS = ["NBA", "NHL", "GOLF"];

let _lastRun: number = 0;
let _cachedSignals: Record<string, ScoutSignal[]> = {};
let _newsCache: Record<string, string> = {};
let _newsTtl: Record<string, number> = {};
let _isRefreshing = false;
let _geminiCallCount = 0;
let _geminiCallCountResetTime = Date.now();

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
    const sources = NEWS_SOURCES[sport] || [];
    const chunks: string[] = [];

    for (const source of sources) {
      const cacheKey = source.url;
      if (_newsCache[cacheKey] && Date.now() / 1000 < (_newsTtl[cacheKey] || 0)) {
        chunks.push(_newsCache[cacheKey]);
        continue;
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(source.url, {
          headers: { ...HEADERS, "Accept": "application/json, text/xml, text/html" },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn(`[AIScout] ${source.url} → HTTP ${res.status}`);
          continue;
        }

        let text = "";

        if (source.type === "json") {
          // ESPN public API — extract headlines and injury details from JSON
          const json = await res.json() as any;

          // ESPN news format
          const articles = json.articles || json.feed || [];
          const newsLines = articles.slice(0, 30).map((a: any) => {
            const headline = a.headline || a.title || "";
            const desc = a.description || a.summary || "";
            return `${headline}. ${desc}`.trim();
          }).filter(Boolean);

          // ESPN injuries format
          const injuries = json.season?.injuries || json.injuries || [];
          const injuryLines = injuries.slice(0, 40).flatMap((team: any) =>
            (team.injuries || []).map((inj: any) => {
              const name = inj.athlete?.displayName || inj.athlete?.fullName || "";
              const status = inj.status || "";
              const detail = inj.details?.returnDate ? ` (return: ${inj.details.returnDate})` : "";
              const type = inj.details?.type || inj.details?.detail || "";
              return name ? `${name} [${status}] ${type}${detail}` : "";
            }).filter(Boolean)
          );

          text = [...injuryLines, ...newsLines].join("\n");
        } else if (source.type === "rss") {
          // RotoWire RSS — strip XML tags to get clean text
          const raw = await res.text();
          // Extract title and description from each <item>
          const items: string[] = [];
          const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
          let match;
          while ((match = itemRegex.exec(raw)) !== null && items.length < 40) {
            const item = match[1];
            const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/i.exec(item) || /<title>(.*?)<\/title>/i.exec(item))?.[1] || "";
            const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/i.exec(item) || /<description>(.*?)<\/description>/i.exec(item))?.[1] || "";
            const clean = `${title}. ${desc}`.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (clean.length > 10) items.push(clean);
          }
          text = items.join("\n");
        } else {
          // Plain HTML fallback (last resort)
          const raw = await res.text();
          text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
        }

        if (text.length > 50) {
          _newsCache[cacheKey] = text;
          _newsTtl[cacheKey] = Date.now() / 1000 + 1800;
          chunks.push(text);
          console.log(`[AIScout] ${sport} ← ${source.url.split("/").slice(-2).join("/")} (${text.length} chars)`);
        }
      } catch (err: any) {
        console.warn(`[AIScout] Failed to fetch ${source.url}: ${err.message}`);
      }
    }

    result[sport] = chunks.join("\n\n---\n\n");
    if (!result[sport]) {
      console.warn(`[AIScout] No news fetched for ${sport} — Claude will analyse player list only`);
      result[sport] = `No recent news available for ${sport}. Analyse player pool for value based on salaries and projections.`;
    }
  }

  return result;
}

async function callGemini(
  newsBySport: Record<string, string>,
  playersBySport: Record<string, PlayerInfo[]>
): Promise<Record<string, ScoutSignal[]>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[AIScout] No GEMINI_API_KEY set — skipping analysis");
    return {};
  }

  const now = Date.now();
  if (now - _geminiCallCountResetTime > 3600000) {
    _geminiCallCount = 0;
    _geminiCallCountResetTime = now;
  }
  if (_geminiCallCount >= 2) {
    const minsLeft = Math.ceil((3600000 - (now - _geminiCallCountResetTime)) / 60000);
    console.log(`[AIScout] Rate limit: already made ${_geminiCallCount} Gemini calls this hour. Next window in ${minsLeft}m`);
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
No markdown, no commentary, no extra text. Pure JSON only.
Example:
{
  "NBA": [{"player_name":"Jaylen Brown","signal_type":"injury_opp","reason":"Tatum ruled out","beneficiary_names":[],"ownership_delta":15,"confidence":0.9}],
  "NFL": [],
  "MLB": []
}`;

  try {
    // Use gemini-2.0-flash — free tier: 1,500 req/day, 15 req/min
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    // Retry up to 3 times with exponential backoff on 429 (rate limit)
    _geminiCallCount++;
    console.log(`[AIScout] Gemini API call #${_geminiCallCount} this hour`);

    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const waitMs = attempt * 30000; // 30s, then 60s
        console.log(`[AIScout] Gemini 429 — waiting ${waitMs / 1000}s before retry ${attempt + 1}/3`);
        await new Promise(r => setTimeout(r, waitMs));
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.3 },
        }),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        lastError = `429 rate limit${retryAfter ? ` (retry-after: ${retryAfter}s)` : ""}`;
        console.warn(`[AIScout] Gemini ${lastError} on attempt ${attempt + 1}`);
        continue; // retry
      }

      if (!res.ok) {
        const err = await res.text();
        console.error(`[AIScout] Gemini API error ${res.status}: ${err.slice(0, 200)}`);
        return {};
      }

      const data = await res.json() as any;
      let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
      // Strip any accidental markdown fences
      raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

      const parsed: Record<string, ScoutSignal[]> = JSON.parse(raw);
      const totalSignals = Object.values(parsed).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`[AIScout] Gemini returned ${totalSignals} signals across ${Object.keys(parsed).length} sports`);

      return Object.fromEntries(
        Object.keys(playersBySport).map(sport => [sport, parsed[sport] || []])
      );
    }

    // All retries exhausted
    console.error(`[AIScout] Gemini gave up after 3 attempts — last error: ${lastError}`);
    console.error(`[AIScout] Check: aistudio.google.com → API keys → View quota`);
    return {};
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
  gemini_calls_this_hour: number;
  gemini_calls_max: number;
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

  if (Date.now() - _geminiCallCountResetTime > 3600000) {
    _geminiCallCount = 0;
    _geminiCallCountResetTime = Date.now();
  }

  return { per_sport: perSport, next_refresh: nextRefresh, is_refreshing: _isRefreshing, gemini_calls_this_hour: _geminiCallCount, gemini_calls_max: 2 };
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
