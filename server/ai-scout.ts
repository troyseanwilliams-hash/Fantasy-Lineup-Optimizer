
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

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
  Accept: "text/html,application/xhtml+xml",
};

const INTERVAL_SECS = 3600;

let _lastRun: Record<string, number> = {};
let _cachedSignals: Record<string, ScoutSignal[]> = {};
let _newsCache: Record<string, string> = {};
let _newsTtl: Record<string, number> = {};

function shouldRefresh(sport: string): boolean {
  const last = _lastRun[sport] || 0;
  return (Date.now() / 1000 - last) >= INTERVAL_SECS;
}

export function secondsUntilRefresh(sport: string): number {
  const last = _lastRun[sport] || 0;
  const elapsed = Date.now() / 1000 - last;
  return Math.max(0, Math.round(INTERVAL_SECS - elapsed));
}

export function getCachedSignals(sport: string): ScoutSignal[] {
  return _cachedSignals[sport] || [];
}

export function forceRefresh(sport: string) {
  delete _lastRun[sport];
}

async function fetchNews(sport: string): Promise<string> {
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

  return chunks.join("\n\n---\n\n");
}

async function analyzeWithGemini(
  newsText: string,
  playerList: string,
  sport: string
): Promise<ScoutSignal[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("[AIScout] No GEMINI_API_KEY set — skipping Gemini analysis");
    return [];
  }

  const prompt = `You are an expert DFS analyst for EliteLineup.com.
Today's sport: ${sport}
Current time (UTC): ${new Date().toISOString().slice(0, 16)}

Here is raw news/injury data scraped from Rotowire, ESPN, and CBS Sports:

<news>
${newsText.slice(0, 12000)}
</news>

Here are the players on today's DraftKings slate:

<players>
${playerList}
</players>

Analyze the news and identify every player who should have their DFS projection adjusted.
For each affected player, output a JSON array of signal objects. Each object must have:
  - "player_name": exact name matching the player list above
  - "signal_type": one of ${JSON.stringify(Object.keys(BOOST_WEIGHTS))}
  - "reason": 1-sentence human-readable explanation (shown in the UI)
  - "beneficiary_names": list of player names who BENEFIT if this player is out/limited (optional)
  - "ownership_delta": integer -30 to +30 (how much their ownership % should shift)
  - "confidence": 0.0 to 1.0 (how certain you are about this signal)

Also flag the top 5 VALUE PLAYS — players whose salary is low but injury news upgrades them significantly. Mark these with signal_type "injury_opp" or "value_spike".

Return ONLY valid JSON array, no markdown fences, no commentary.
Example: [{"player_name":"Jaylen Brown","signal_type":"injury_opp","reason":"Tatum ruled out — Brown takes over primary ball-handler role","beneficiary_names":[],"ownership_delta":15,"confidence":0.9}]`;

  try {
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.3 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[AIScout] Gemini API error ${res.status}: ${err.slice(0, 200)}`);
      return [];
    }

    const data = await res.json() as any;
    let raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "[]";
    raw = raw.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
    const signals: ScoutSignal[] = JSON.parse(raw);
    console.log(`[AIScout] Gemini returned ${signals.length} signals for ${sport}`);
    return signals;
  } catch (err: any) {
    console.error(`[AIScout] Gemini analysis failed: ${err.message}`);
    return [];
  }
}

export async function runScout(
  sport: string,
  players: Array<{ name: string; team: string; position: string; salary: number; fppg: string | null }>
): Promise<ScoutSignal[]> {
  if (!shouldRefresh(sport)) {
    return _cachedSignals[sport] || [];
  }

  console.log(`[AIScout] Running scout for ${sport}...`);
  const newsText = await fetchNews(sport);

  if (!newsText || newsText.length < 100) {
    console.log(`[AIScout] Insufficient news data for ${sport}`);
    _lastRun[sport] = Date.now() / 1000;
    return _cachedSignals[sport] || [];
  }

  const playerList = players
    .slice(0, 200)
    .map(p => `- ${p.name} (${p.team}, ${p.position}, $${p.salary.toLocaleString()}, proj=${p.fppg || "0"})`)
    .join("\n");

  const signals = await analyzeWithGemini(newsText, playerList, sport);
  _cachedSignals[sport] = signals;
  _lastRun[sport] = Date.now() / 1000;

  return signals;
}

export function getScoutStatus(): {
  per_sport: Record<string, SportStatus>;
  next_refresh: number;
} {
  const perSport: Record<string, SportStatus> = {};
  for (const sport of ["NBA", "NFL", "MLB", "NHL", "GOLF"]) {
    const signals = _cachedSignals[sport] || [];
    perSport[sport] = {
      signal_count: signals.length,
      boost_count: signals.filter(s =>
        BOOST_WEIGHTS[s.signal_type] !== undefined && BOOST_WEIGHTS[s.signal_type] > 0
      ).length,
      injury_count: signals.filter(s =>
        ["out", "negative_news", "starter_out"].includes(s.signal_type)
      ).length,
      next_refresh: secondsUntilRefresh(sport),
    };
  }
  return { per_sport: perSport, next_refresh: secondsUntilRefresh("NBA") };
}

export async function runScoutForAllSports(
  getPlayers: (sport: string) => Promise<Array<{ name: string; team: string; position: string; salary: number; fppg: string | null }>>
) {
  for (const sport of ["NBA", "NFL", "MLB", "NHL", "GOLF"]) {
    try {
      const players = await getPlayers(sport);
      if (players.length > 0) {
        await runScout(sport, players);
      }
    } catch (err: any) {
      console.error(`[AIScout] Failed for ${sport}: ${err.message}`);
    }
  }
}
