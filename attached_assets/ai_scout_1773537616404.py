"""
EliteLineup.com — AI Scout Engine

ONE CLAUDE CALL PER HOUR — ALL ACTIVE SPORTS IN ONE PROMPT
───────────────────────────────────────────────────────────
SlateSyncService calls `scout.refresh_all(players_by_sport)` once per hour.
That is the only place a Claude call is made.  Every API endpoint and
frontend hook calls `get_cached_signals(sport)` — they read from the cache
and never trigger Claude themselves.

A single threading.Lock prevents concurrent refreshes (e.g. a manual
"Scan Now" arriving while the scheduled cycle is mid-flight).

Usage (main.py)
───────────────
    scout = AIScout()
    sync  = SlateSyncService(db=get_db(), ai_scout=scout)
    sync.start()   # calls scout.refresh_all() every hour in background

    # scout_routes.py dependency:
    def get_scout():
        return scout   # same singleton — cache reads only
"""

import os, re, time, json, logging, threading
from datetime import datetime, timezone
from typing import Optional
import requests
from anthropic import Anthropic

logger = logging.getLogger(__name__)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"
INTERVAL_SECS   = 3600   # 1 hour

ACTIVE_SPORTS = ["NBA", "NFL", "MLB", "NHL", "GOLF"]

NEWS_SOURCES: dict[str, list[str]] = {
    "NBA": [
        "https://www.rotowire.com/basketball/news.php",
        "https://www.cbssports.com/nba/injuries/",
        "https://www.espn.com/nba/injuries",
    ],
    "NFL": [
        "https://www.rotowire.com/football/news.php",
        "https://www.cbssports.com/nfl/injuries/",
        "https://www.espn.com/nfl/injuries",
    ],
    "MLB": [
        "https://www.rotowire.com/baseball/news.php",
        "https://www.cbssports.com/mlb/injuries/",
    ],
    "NHL": [
        "https://www.rotowire.com/hockey/news.php",
        "https://www.cbssports.com/nhl/injuries/",
    ],
    "GOLF": [
        "https://www.rotowire.com/golf/news.php",
        "https://www.pgatour.com/news",
    ],
}

BOOST_WEIGHTS: dict[str, float] = {
    "starter_out":       +5.0,
    "injury_opp":        +4.0,
    "lineup_promotion":  +3.5,
    "weather_boost":     +2.0,
    "matchup_upgrade":   +2.0,
    "confirmed_starter": +1.5,
    "value_spike":       +1.5,
    "hot_streak":        +1.0,
    "negative_news":     -3.0,
    "out":              -99.0,
}

_HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
    "Accept": "text/html,application/xhtml+xml",
}


class AIScout:
    """
    One Claude call per hour covering all active sports at once.

    The only public mutating method is refresh_all() — called exclusively
    by SlateSyncService.  Everything else is a cache read.
    """

    def __init__(self, anthropic_client: Optional[Anthropic] = None):
        self._client = anthropic_client or Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

        # Single lock — only one Claude call can be in-flight at any time
        self._refresh_lock = threading.Lock()

        # sport -> list[signal dict]
        self._cached_signals: dict[str, list] = {}
        # Epoch of last successful refresh (one timestamp shared by all sports)
        self._last_run: float = 0.0

        # Raw HTML cache (30-min TTL, independent of the Claude cycle)
        self._news_cache: dict[str, str]   = {}
        self._news_ttl:   dict[str, float] = {}

    # ──────────────────────────────────────────────────────────────────────────
    # Called by SlateSyncService only
    # ──────────────────────────────────────────────────────────────────────────

    def refresh_all(self, players_by_sport: dict[str, list], force: bool = False):
        """
        Refresh signal caches for every sport that has players.
        Makes exactly ONE Claude call regardless of how many sports are active.

        Parameters
        ----------
        players_by_sport : { "NBA": [DKPlayer, ...], "NFL": [...], ... }
            Only sports present in this dict are included in the prompt.
        force : bool
            Skip the 1-hour gate (used by POST /api/scout/refresh).
        """
        if not force and not self._is_stale():
            logger.debug("Scout cache is fresh (%.0fs old) — skipping", time.time() - self._last_run)
            return

        with self._refresh_lock:
            # Double-check: another thread may have refreshed while we waited
            if not force and not self._is_stale():
                logger.debug("Scout refreshed while waiting for lock — skipping")
                return

            active = {s: p for s, p in players_by_sport.items() if p}
            if not active:
                logger.warning("refresh_all called with no players — skipping")
                return

            logger.info("Scout: one Claude call for sports %s", list(active.keys()))
            try:
                news_by_sport    = self._fetch_all_news(list(active.keys()))
                signals_by_sport = self._call_claude(news_by_sport, active)

                for sport, signals in signals_by_sport.items():
                    self._cached_signals[sport] = signals
                    logger.info("  %s → %d signals", sport, len(signals))

                self._last_run = time.time()
                logger.info(
                    "Scout refresh done — %d total signals across %d sports",
                    sum(len(v) for v in signals_by_sport.values()),
                    len(signals_by_sport),
                )
            except Exception as e:
                logger.error("Scout refresh_all failed: %s", e)
                # Keep stale signals rather than serving empty results

    def apply_to_players(self, players: list, sport: str) -> list:
        """
        Write cached boost scores / tags into DKPlayer objects in-place.
        Called by SlateSyncService after refresh_all() to persist to DB.
        Never triggers a Claude call.
        """
        self._apply_signals(players, self._cached_signals.get(sport, []), sport)
        return players

    # ──────────────────────────────────────────────────────────────────────────
    # Read-only — called by API endpoints and frontend hooks
    # ──────────────────────────────────────────────────────────────────────────

    def get_cached_signals(self, sport: str) -> list:
        """Return cached signals. Never triggers a Claude call."""
        return self._cached_signals.get(sport.upper(), [])

    def seconds_until_refresh(self) -> int:
        """Seconds until the next scheduled Claude call."""
        return max(0, int(INTERVAL_SECS - (time.time() - self._last_run)))

    def is_refreshing(self) -> bool:
        """True if a Claude call is currently in-flight."""
        return self._refresh_lock.locked()

    # ──────────────────────────────────────────────────────────────────────────
    # Internal
    # ──────────────────────────────────────────────────────────────────────────

    def _is_stale(self) -> bool:
        return (time.time() - self._last_run) >= INTERVAL_SECS

    def _fetch_all_news(self, sports: list[str]) -> dict[str, str]:
        """Scrape news for every sport. Returns { sport: combined_text }."""
        session = requests.Session()
        session.headers.update(_HTTP_HEADERS)
        result: dict[str, str] = {}

        for sport in sports:
            chunks: list[str] = []
            for url in NEWS_SOURCES.get(sport, []):
                if url in self._news_cache and time.time() < self._news_ttl.get(url, 0):
                    chunks.append(self._news_cache[url])
                    continue
                try:
                    r = session.get(url, timeout=12)
                    r.raise_for_status()
                    text = re.sub(r"<[^>]+>", " ", r.text)
                    text = re.sub(r"\s+", " ", text).strip()[:8000]
                    self._news_cache[url] = text
                    self._news_ttl[url]   = time.time() + 1800
                    chunks.append(text)
                except Exception as e:
                    logger.warning("Failed to fetch %s: %s", url, e)
            result[sport] = "\n\n---\n\n".join(chunks)

        return result

    def _call_claude(
        self,
        news_by_sport: dict[str, str],
        players_by_sport: dict[str, list],
    ) -> dict[str, list]:
        """
        THE only place the Anthropic API is called.
        Bundles all sports into one prompt; splits the response back out.
        """
        sport_sections: list[str] = []
        for sport, players in players_by_sport.items():
            player_list = "\n".join(
                f"  - {p.display_name} ({p.team_abbreviation}, {p.position}, "
                f"${p.salary:,}, proj={p.points_per_contest:.1f})"
                for p in players[:150]
            )
            news_text = news_by_sport.get(sport, "")[:6000]
            sport_sections.append(
                f"=== {sport} ===\n\n"
                f"<news_{sport}>\n{news_text}\n</news_{sport}>\n\n"
                f"<players_{sport}>\n{player_list}\n</players_{sport}>"
            )

        prompt = f"""You are an expert DFS analyst for EliteLineup.com.
Current time (UTC): {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}

Below are injury/news reports and player pools for every active DFS sport today.
Analyse each sport and produce signals for ALL sports in one response.

{chr(10).join(sport_sections)}

For every player whose DFS projection should be adjusted, produce a signal with:
  - "sport":             one of {list(players_by_sport.keys())}
  - "player_name":       exact name from that sport's player list
  - "signal_type":       one of {list(BOOST_WEIGHTS.keys())}
  - "reason":            1-sentence UI explanation
  - "beneficiary_names": players who benefit if this one is out/limited (may be [])
  - "ownership_delta":   integer -30 to +30
  - "confidence":        0.0 to 1.0

Flag up to 5 VALUE PLAYS per sport (signal_type "injury_opp" or "value_spike").

Return a single JSON object — sport names as keys, arrays of signal objects as values.
No markdown, no commentary.
Example:
{{
  "NBA": [{{"player_name":"Jaylen Brown","signal_type":"injury_opp","reason":"Tatum ruled out","beneficiary_names":[],"ownership_delta":15,"confidence":0.9}}],
  "NFL": [],
  "MLB": []
}}
"""

        response = self._client.messages.create(
            model      = ANTHROPIC_MODEL,
            max_tokens = 4000,
            messages   = [{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$",        "", raw)
        parsed: dict = json.loads(raw)

        # Ensure every requested sport has an entry even if Claude returned nothing
        return {sport: parsed.get(sport, []) for sport in players_by_sport}

    def _apply_signals(self, players: list, signals: list, sport: str):
        name_map = {p.display_name.lower(): p for p in players}

        for p in players:
            p.ai_boost             = 0.0
            p.boost_reasons        = []
            p.tags                 = []
            p.boost_reason         = ""
            p.ownership_projection = max(5.0, p.points_per_contest / 2.0)

        for sig in signals:
            name       = sig.get("player_name", "").lower()
            sig_type   = sig.get("signal_type", "")
            confidence = float(sig.get("confidence", 0.8))
            reason     = sig.get("reason", "")
            own_delta  = int(sig.get("ownership_delta", 0))

            target = name_map.get(name)
            if target:
                weight = BOOST_WEIGHTS.get(sig_type, 0.0) * confidence
                target.ai_boost      += weight
                target.boost_reasons.append(reason)
                target.ownership_projection = max(1.0, target.ownership_projection + own_delta)
                self._apply_tags(target, sig_type)

            for bname in sig.get("beneficiary_names", []):
                bp = name_map.get(bname.lower())
                if bp:
                    bp.ai_boost += BOOST_WEIGHTS.get("injury_opp", 4.0) * confidence
                    bp.boost_reasons.append(f"Beneficiary: {reason}")
                    bp.ownership_projection = max(1.0, bp.ownership_projection + (own_delta * 0.5))
                    self._apply_tags(bp, "injury_opp")

        for p in players:
            p.boost_reason  = p.boost_reasons[0] if p.boost_reasons else ""
            p.ai_projection = max(0.0, (p.points_per_contest or 1.0) + p.ai_boost)
            p.value_score   = round(p.ai_projection / (p.salary / 1000), 2) if p.salary > 0 else 0.0

    @staticmethod
    def _apply_tags(player, signal_type: str):
        tag_map = {
            "starter_out":       "inj-opp",
            "injury_opp":        "inj-opp",
            "lineup_promotion":  "boost",
            "weather_boost":     "boost",
            "matchup_upgrade":   "boost",
            "confirmed_starter": "boost",
            "value_spike":       "value",
            "hot_streak":        "hot",
            "negative_news":     "fade",
            "out":               "out",
        }
        tag = tag_map.get(signal_type)
        if tag and tag not in player.tags:
            player.tags.append(tag)
