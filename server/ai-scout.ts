
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
    { url: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/news?limit=30", type: "news" },
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
  /**
   * Explicit projection boost in DFS points.
   * When present, useScoutBoosts.ts should use `boost_value * confidence`
   * instead of the generic BOOST_WEIGHTS lookup.
   *
   * NOTE: Update useScoutBoosts.ts weight calculation from:
   *   sig.source === "admin" && sig.boost_value !== undefined ? ...
   * to:
   *   sig.boost_value !== undefined ? ...
   * so AI-computed boosts also flow through correctly.
   */
  boost_value?: number;
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
const ACTIVE_SPORTS = ["NHL", "NFL", "MLB", "GOLF", "SOCCER"];

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

let _lazyRefreshScheduled = false;

export function triggerLazyRefreshIfStale(getPlayers: (sport: string) => Promise<PlayerInfo[]>): void {
  if (!isStale() || _isRefreshing || _lazyRefreshScheduled) return;
  _lazyRefreshScheduled = true;
  setTimeout(async () => {
    try {
      const playersBySport: Record<string, PlayerInfo[]> = {};
      for (const sport of ACTIVE_SPORTS) {
        try {
          const players = await getPlayers(sport);
          if (players.length > 0) playersBySport[sport] = players;
        } catch {}
      }
      if (Object.keys(playersBySport).length > 0) {
        await refreshAll(playersBySport, true);
        console.log("[AIScout] Lazy background refresh completed");
      }
    } catch (err: any) {
      console.error("[AIScout] Lazy background refresh failed:", err.message);
    } finally {
      _lazyRefreshScheduled = false;
    }
  }, 100);
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

// ── Smart Minutes Redistribution ─────────────────────────────────────────────
// When a starter is OUT, instead of applying a flat injury_opp boost we
// compute the actual projected minutes/usage gained by each beneficiary and
// translate that to a DFS point boost.
//
// Three-level allocation:
//   Primary (same pos, same team):   55% of redistributed minutes
//   Secondary (adj pos, same team):  25%
//   Tertiary (any teammate):         15%
//
// absorbFactor: backups are less efficient per minute than starters
// (smaller role, not the same playmaker — discount their per-minute rate)

const AVG_FPPM: Record<string, number> = {
  NBA:  1.35,   // ~1.35 DFS pts per minute for average NBA player
  NFL:  1.20,   // approximate — heavily skewed by position
  MLB:  0.0,    // MLB doesn't use minutes model — use raw fppg fraction
  NHL:  0.45,   // NHL players score less per minute
};

const ABSORB_FACTOR: Record<string, number> = {
  NBA:  0.68,   // backup absorbs 68% as efficiently as starter per minute
  NFL:  0.62,
  NHL:  0.72,
  MLB:  0.55,
};

const MAX_MINUTES: Record<string, number> = {
  NBA:  36,
  NHL:  22,
  NFL:  999,  // NFL uses snap %, not pure minutes
};

function estimateMinutes(fppg: number, sport: string): number {
  const fppm = AVG_FPPM[sport] || 1.0;
  if (fppm <= 0) return 20;
  return Math.max(6, Math.min(MAX_MINUTES[sport] || 36, fppg / fppm));
}

function computeInjuryBoost(
  outPlayer:    { fppg: string | null; position: string },
  beneficiary:  { fppg: string | null },
  allocation:   number,   // 0–1, fraction of out player's minutes going to this beneficiary
  sport:        string,
): number {
  const outFppg  = parseFloat(outPlayer.fppg || "0");
  const benFppg  = parseFloat(beneficiary.fppg || "0");
  if (outFppg <= 0 || benFppg <= 0) return 0;

  const absorb  = ABSORB_FACTOR[sport.toUpperCase()] || 0.65;

  // MLB: use raw fppg fraction instead of minutes model
  if (sport.toUpperCase() === "MLB") {
    return Math.round(outFppg * allocation * absorb * 10) / 10;
  }

  const outMinutes = estimateMinutes(outFppg, sport.toUpperCase());
  const benMinutes = estimateMinutes(benFppg, sport.toUpperCase());
  const maxMore    = (MAX_MINUTES[sport.toUpperCase()] || 36) - benMinutes;

  // Minutes they gain from this injury
  const rawAlloc   = outMinutes * allocation;
  // Cap: can't absorb more than what they currently play (fatigue model)
  const gained     = Math.min(rawAlloc, maxMore, benMinutes);

  if (gained <= 0 || benMinutes <= 0) return 0;

  const benFppm    = benFppg / benMinutes;   // beneficiary's pts/minute
  const boost      = gained * benFppm * absorb;
  return Math.round(boost * 10) / 10;
}

function ownershipDeltaFromBoost(boost: number): number {
  if (boost >= 8) return 22;
  if (boost >= 5) return 16;
  if (boost >= 3) return 12;
  if (boost >= 1) return 7;
  return 3;
}

// Adjacent positions eligible for usage absorption
const ADJ_POSITIONS: Record<string, string[]> = {
  // NBA
  PG: ["PG","SG","G"],  SG: ["SG","PG","G"],
  SF: ["SF","PF","F"],  PF: ["PF","SF","F"],  C: ["C","PF","F"],
  // NFL
  QB: ["QB"],  RB: ["RB","WR"],  WR: ["WR","TE","RB"],  TE: ["TE","WR"],
  // NHL
  C: ["C","W","LW","RW"], W: ["W","C","LW","RW"],
  LW: ["LW","W","C","RW"], RW: ["RW","W","C","LW"],
  D: ["D"],  G: ["G"],
  // MLB
  SP: ["SP","RP"],  RP: ["RP","SP"],
  OF: ["OF"],  "1B": ["1B","OF"],  "2B": ["2B","3B","SS"],
  "3B": ["3B","2B"],  SS: ["SS","2B"],  C: ["C"],
};

interface BeneficiarySignal {
  name:          string;
  boost_value:   number;
  ownership_delta: number;
  reason:        string;
  allocation:    "primary" | "secondary" | "tertiary";
}

function computeSmartRedistribution(
  outPlayer: { name: string; team: string; position: string; fppg: string | null },
  pool:      PlayerInfo[],
  sport:     string,
): BeneficiarySignal[] {
  const outFppg  = parseFloat(outPlayer.fppg || "0");
  const outPos   = outPlayer.position.split("/")[0].toUpperCase();
  const adjPos   = ADJ_POSITIONS[outPos] || [outPos];

  const teammates = pool.filter(p =>
    p.team === outPlayer.team && p.name !== outPlayer.name
  ).sort((a, b) => parseFloat(b.fppg || "0") - parseFloat(a.fppg || "0"));

  // Split: same position = primary, adjacent = secondary, any teammate = tertiary
  const primary   = teammates.filter(p => {
    const pp = p.position.split("/").map(s => s.toUpperCase());
    return pp.some(x => adjPos.slice(0, 1).includes(x));  // exact same positions
  }).slice(0, 2);

  const alreadyPrimary = new Set(primary.map(p => p.name));

  const secondary = teammates.filter(p => {
    if (alreadyPrimary.has(p.name)) return false;
    const pp = p.position.split("/").map(s => s.toUpperCase());
    return pp.some(x => adjPos.includes(x));
  }).slice(0, 2);

  const alreadyUsed = new Set([...primary, ...secondary].map(p => p.name));

  const tertiary = teammates.filter(p => !alreadyUsed.has(p.name)).slice(0, 1);

  const signals: BeneficiarySignal[] = [];

  const ALLOC = { primary: 0.55, secondary: 0.25, tertiary: 0.15 } as const;

  for (const [tier, players] of [
    ["primary",   primary]   as const,
    ["secondary", secondary] as const,
    ["tertiary",  tertiary]  as const,
  ]) {
    const alloc = ALLOC[tier] / Math.max(players.length, 1);
    for (const ben of players) {
      const boost = computeInjuryBoost(outPlayer, ben, alloc, sport);
      if (boost <= 0) continue;
      signals.push({
        name:            ben.name,
        boost_value:     boost,
        ownership_delta: ownershipDeltaFromBoost(boost),
        allocation:      tier,
        reason:          `${outPlayer.name} (${outPlayer.position}) OUT — ${ben.name} gains ~${boost.toFixed(1)} projected pts via usage redistribution`,
      });
    }
  }

  // If minutes model produced nothing useful, fall back to flat rank-based boost
  if (signals.length === 0) {
    const topTeammates = teammates.slice(0, 2);
    for (const t of topTeammates) {
      const flatBoost = Math.max(1.0, outFppg * 0.12);
      signals.push({
        name:            t.name,
        boost_value:     Math.round(flatBoost * 10) / 10,
        ownership_delta: ownershipDeltaFromBoost(flatBoost),
        allocation:      "primary",
        reason:          `${outPlayer.name} OUT — ${t.name} absorbs usage`,
      });
    }
  }

  return signals;
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
        // Determine the player's info for redistribution
        const outInfo = matchedPlayer
          ? { name: inj.name, team: matchedPlayer.team, position: matchedPlayer.position, fppg: matchedPlayer.fppg }
          : { name: inj.name, team: inj.team,          position: inj.position,           fppg: null };

        // Smart minutes redistribution — computes actual projection boost per beneficiary
        const redistribution = computeSmartRedistribution(outInfo, players, sport);
        const beneficiaryNames = redistribution.map(r => r.name);

        signals.push({
          player_name:       inj.name,
          signal_type:       "out",
          reason:            `${inj.name} ruled OUT${inj.type ? ` (${inj.type})` : ""}`,
          beneficiary_names: beneficiaryNames,
          ownership_delta:   -20,
          confidence:        0.95,
        });

        // Create one injury_opp signal per beneficiary with the computed boost_value
        for (const ben of redistribution) {
          signals.push({
            player_name:       ben.name,
            signal_type:       "injury_opp",
            reason:            ben.reason,
            beneficiary_names: [],
            ownership_delta:   ben.ownership_delta,
            confidence:        0.80,
            boost_value:       ben.boost_value,
          });
        }
      } else if (LIMITED_STATUSES.has(inj.status)) {
        if (matchedPlayer) {
          const statusLabel = inj.status.charAt(0).toUpperCase() + inj.status.slice(1);
          // For doubtful players, pre-compute beneficiary boosts at reduced confidence
          const redistribution = inj.status === "doubtful"
            ? computeSmartRedistribution(
                { name: inj.name, team: matchedPlayer.team, position: matchedPlayer.position, fppg: matchedPlayer.fppg },
                players,
                sport
              )
            : [];

          signals.push({
            player_name: inj.name,
            signal_type: "negative_news",
            reason: `${inj.name} listed as ${statusLabel}${inj.type ? ` (${inj.type})` : ""} — monitor status`,
            beneficiary_names: redistribution.map(r => r.name),
            ownership_delta: inj.status === "doubtful" ? -12 : inj.status === "questionable" ? -5 : -2,
            confidence: inj.status === "doubtful" ? 0.8 : 0.6,
          });

          // Add tentative boosts for doubtful (lower confidence)
          if (inj.status === "doubtful") {
            for (const ben of redistribution.slice(0, 2)) {
              signals.push({
                player_name:       ben.name,
                signal_type:       "injury_opp",
                reason:            `${inj.name} listed Doubtful — ${ben.name} may gain ~${ben.boost_value.toFixed(1)} pts if confirmed out`,
                beneficiary_names: [],
                ownership_delta:   Math.round(ben.ownership_delta * 0.5),
                confidence:        0.55,
                boost_value:       Math.round(ben.boost_value * 0.5 * 10) / 10,  // half boost at half confidence
              });
            }
          }
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
