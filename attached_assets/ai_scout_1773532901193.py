"""
EliteLineup.com — AI Scout Engine
Scrubs the web every hour for injuries, lineup news, and value plays.
Applies boost scores and tags directly to DKPlayer objects so the
optimizer picks them up automatically via boostScore / boostReason fields.
"""

import os, re, time, logging, asyncio
from datetime import datetime, timezone
from typing import Optional
import requests
from anthropic import Anthropic

logger = logging.getLogger(__name__)

ANTHROPIC_MODEL = "claude-sonnet-4-20250514"

# News sources scraped for each sport
NEWS_SOURCES = {
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

# How much to boost a player's projected points per signal tier
BOOST_WEIGHTS = {
    "starter_out":       +5.0,   # a teammate starter ruled out
    "injury_opp":        +4.0,   # direct beneficiary of an injury
    "lineup_promotion":  +3.5,   # moved up in batting order / minutes bump
    "weather_boost":     +2.0,   # favorable weather (NFL/MLB)
    "matchup_upgrade":   +2.0,   # opponent key defender out
    "confirmed_starter": +1.5,   # starter confirmed after questionable tag
    "value_spike":       +1.5,   # salary down, usage trending up
    "hot_streak":        +1.0,   # 3+ game hot streak
    "negative_news":     -3.0,   # bad news (limited, dnp risk)
    "out":               -99.0,  # confirmed out — remove from pool
}

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; EliteLineupBot/1.0; +https://elitelineup.com)",
    "Accept": "text/html,application/xhtml+xml",
}


class AIScout:
    """
    Hourly web scraper + Claude analysis pipeline.
    Call `scout.run(players, sport)` to enrich a list of DKPlayer objects
    with ai_boost, boost_reasons, tags, ownership_projection, and boost_reason.
    """

    def __init__(self, anthropic_client: Optional[Anthropic] = None):
        self.client = anthropic_client or Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self._last_run: dict[str, float] = {}   # sport -> epoch
        self._cached_signals: dict[str, list] = {}  # sport -> signal list
        self._news_cache: dict[str, str] = {}
        self._news_ttl: dict[str, float] = {}
        self.INTERVAL_SECS = 3600  # 1 hour

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(self, players: list, sport: str) -> list:
        """
        Enrich players in-place and return the list.
        Uses cached signals if last run was <1 hour ago.
        """
        if self._should_refresh(sport):
            raw_news = self._fetch_news(sport)
            signals  = self._analyze_with_claude(raw_news, players, sport)
            self._cached_signals[sport] = signals
            self._last_run[sport] = time.time()
            logger.info("AI Scout refresh complete for %s: %d signals", sport, len(signals))
        else:
            signals = self._cached_signals.get(sport, [])

        self._apply_signals(players, signals, sport)
        return players

    def force_refresh(self, sport: str):
        """Force an immediate re-scrape (called from API endpoint)."""
        self._last_run.pop(sport, None)

    def seconds_until_refresh(self, sport: str) -> int:
        last = self._last_run.get(sport, 0)
        elapsed = time.time() - last
        return max(0, int(self.INTERVAL_SECS - elapsed))

    def get_cached_signals(self, sport: str) -> list:
        return self._cached_signals.get(sport, [])

    # ------------------------------------------------------------------
    # Internal: refresh gate
    # ------------------------------------------------------------------

    def _should_refresh(self, sport: str) -> bool:
        last = self._last_run.get(sport, 0)
        return (time.time() - last) >= self.INTERVAL_SECS

    # ------------------------------------------------------------------
    # Internal: web scraping
    # ------------------------------------------------------------------

    def _fetch_news(self, sport: str) -> str:
        urls    = NEWS_SOURCES.get(sport, [])
        chunks  = []
        session = requests.Session()
        session.headers.update(_HEADERS)

        for url in urls:
            cache_key = url
            if cache_key in self._news_cache and time.time() < self._news_ttl.get(cache_key, 0):
                chunks.append(self._news_cache[cache_key])
                continue
            try:
                r = session.get(url, timeout=12)
                r.raise_for_status()
                # Strip HTML tags, keep readable text
                text = re.sub(r"<[^>]+>", " ", r.text)
                text = re.sub(r"\s+", " ", text).strip()
                text = text[:8000]   # cap per source
                self._news_cache[cache_key] = text
                self._news_ttl[cache_key]   = time.time() + 1800  # 30 min cache for raw HTML
                chunks.append(text)
                logger.debug("Fetched %d chars from %s", len(text), url)
            except Exception as e:
                logger.warning("Failed to fetch %s: %s", url, e)

        return "\n\n---\n\n".join(chunks)

    # ------------------------------------------------------------------
    # Internal: Claude analysis
    # ------------------------------------------------------------------

    def _analyze_with_claude(self, news_text: str, players: list, sport: str) -> list:
        """
        Ask Claude to identify which players are affected by today's news
        and return structured boost signals.
        """
        player_list = "\n".join(
            f"- {p.display_name} ({p.team_abbreviation}, {p.position}, ${p.salary:,}, proj={p.points_per_contest:.1f})"
            for p in players[:200]   # limit context size
        )

        prompt = f"""You are an expert DFS analyst for EliteLineup.com.
Today's sport: {sport}
Current time (UTC): {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}

Here is raw news/injury data scraped from Rotowire, ESPN, and CBS Sports:

<news>
{news_text[:12000]}
</news>

Here are the players on today's DraftKings slate:

<players>
{player_list}
</players>

Analyze the news and identify every player who should have their DFS projection adjusted.
For each affected player, output a JSON array of signal objects. Each object must have:
  - "player_name": exact name matching the player list above
  - "signal_type": one of {list(BOOST_WEIGHTS.keys())}
  - "reason": 1-sentence human-readable explanation (shown in the UI)
  - "beneficiary_names": list of player names who BENEFIT if this player is out/limited (optional)
  - "ownership_delta": integer -30 to +30 (how much their ownership % should shift)
  - "confidence": 0.0 to 1.0 (how certain you are about this signal)

Also flag the top 5 VALUE PLAYS — players whose salary is low but injury news upgrades them significantly. Mark these with signal_type "injury_opp" or "value_spike".

Return ONLY valid JSON array, no markdown fences, no commentary.
Example: [{{"player_name":"Jaylen Brown","signal_type":"injury_opp","reason":"Tatum ruled out — Brown takes over primary ball-handler role","beneficiary_names":[],"ownership_delta":15,"confidence":0.9}}]
"""

        try:
            response = self.client.messages.create(
                model      = ANTHROPIC_MODEL,
                max_tokens = 2000,
                messages   = [{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            # Strip accidental markdown fences
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            import json
            signals = json.loads(raw)
            logger.info("Claude returned %d signals for %s", len(signals), sport)
            return signals
        except Exception as e:
            logger.error("Claude analysis failed: %s", e)
            return []

    # ------------------------------------------------------------------
    # Internal: apply signals to player objects
    # ------------------------------------------------------------------

    def _apply_signals(self, players: list, signals: list, sport: str):
        """Mutate DKPlayer objects with boost scores, tags, and reasons."""
        # Build a lookup for fast name matching (lowercase)
        name_map = {p.display_name.lower(): p for p in players}

        # Reset all boosts before applying
        for p in players:
            p.ai_boost      = 0.0
            p.boost_reasons = []
            p.tags          = []
            p.boost_reason  = ""
            p.ownership_projection = max(5.0, p.points_per_contest / 2.0)

        for sig in signals:
            player_name = sig.get("player_name", "").lower()
            signal_type = sig.get("signal_type", "")
            reason      = sig.get("reason", "")
            confidence  = float(sig.get("confidence", 0.8))
            own_delta   = int(sig.get("ownership_delta", 0))

            # Apply to primary player
            target = name_map.get(player_name)
            if target:
                weight = BOOST_WEIGHTS.get(signal_type, 0.0) * confidence
                target.ai_boost      += weight
                target.boost_reasons.append(reason)
                target.ownership_projection = max(1.0, target.ownership_projection + own_delta)
                self._apply_tags(target, signal_type)

            # Apply beneficiary boosts
            for bname in sig.get("beneficiary_names", []):
                bplayer = name_map.get(bname.lower())
                if bplayer:
                    bplayer.ai_boost += BOOST_WEIGHTS.get("injury_opp", 4.0) * confidence
                    bplayer.boost_reasons.append(f"Beneficiary: {reason}")
                    bplayer.ownership_projection = max(1.0, bplayer.ownership_projection + (own_delta * 0.5))
                    self._apply_tags(bplayer, "injury_opp")

        # Finalize: set boost_reason and compute value_score
        for p in players:
            p.boost_reason = p.boost_reasons[0] if p.boost_reasons else ""
            base_proj = p.points_per_contest or 1.0
            p.ai_projection = max(0.0, base_proj + p.ai_boost)
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
