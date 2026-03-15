"""
EliteLineup.com — DraftKings API Client
Fetches live slates, player pools, and injury statuses directly from DK.
"""

import os, time, logging, requests
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DK_BASE       = "https://api.draftkings.com"
DK_CONTESTS   = f"{DK_BASE}/contests/v1/contests"
DK_DRAFTABLES = f"{DK_BASE}/lineups/v1/draftables"
DK_RULES      = f"{DK_BASE}/lineups/v1/gamerules"


@dataclass
class DKPlayer:
    player_id: int
    display_name: str
    first_name: str
    last_name: str
    position: str
    salary: int
    team_abbreviation: str
    status: Optional[str]
    points_per_contest: float
    news_status: str
    player_image: str
    competition_id: int
    competition_name: str
    game_info: str
    dk_player_id: str
    # Populated by AI Scout layer:
    ai_boost: float = 0.0
    ai_projection: float = 0.0
    boost_reasons: list = field(default_factory=list)
    value_score: float = 0.0
    tags: list = field(default_factory=list)
    boost_reason: str = ""
    ownership_projection: float = 0.0


@dataclass
class DKSlate:
    draft_group_id: int
    sport: str
    game_type: str
    starts_at: str
    players: list
    salary_cap: int
    positions: list


class DraftKingsClient:
    """Thin, cached wrapper around the DK public API."""

    STATUS_MAP = {
        "O": "OUT", "Q": "Questionable", "D": "Doubtful",
        "IR": "OUT", "P": "Probable", "DTD": "Day-to-Day",
    }

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("DK_API_KEY", "")
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "EliteLineup/1.0 (elitelineup.com)",
            "Accept": "application/json",
        })
        if self.api_key:
            self.session.headers["Authorization"] = f"Bearer {self.api_key}"
        self._cache: dict = {}
        self._cache_ttl: dict = {}

    def _get(self, url: str, params: dict = None, cache_secs: int = 120) -> dict:
        key = f"{url}:{params}"
        if key in self._cache and time.time() < self._cache_ttl.get(key, 0):
            return self._cache[key]
        r = self.session.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        self._cache[key] = data
        self._cache_ttl[key] = time.time() + cache_secs
        return data

    def invalidate(self, url_prefix: str = ""):
        stale = [k for k in self._cache if url_prefix in k]
        for k in stale:
            del self._cache[k]
            self._cache_ttl.pop(k, None)

    # --- Slate discovery ------------------------------------------------

    def get_contests(self, sport: str = "NBA") -> list:
        data = self._get(DK_CONTESTS, params={"sport": sport})
        return data.get("Contests", [])

    def get_draft_group_ids(self, sport: str = "NBA") -> list:
        contests = self.get_contests(sport)
        seen, ids = set(), []
        for c in contests:
            dgid = c.get("draftGroupId")
            if dgid and dgid not in seen:
                seen.add(dgid)
                ids.append(dgid)
        return ids

    # --- Player pool ----------------------------------------------------

    def get_draftables(self, draft_group_id: int) -> dict:
        return self._get(f"{DK_DRAFTABLES}/{draft_group_id}", cache_secs=180)

    def get_game_rules(self, draft_group_id: int) -> dict:
        return self._get(f"{DK_RULES}/{draft_group_id}", cache_secs=600)

    def build_slate(self, draft_group_id: int, sport: str = "NBA") -> DKSlate:
        raw   = self.get_draftables(draft_group_id)
        rules = self.get_game_rules(draft_group_id)
        draftables       = raw.get("draftables", [])
        draft_group_info = raw.get("draftGroup", {})

        salary_cap, positions = 50000, []
        if rules:
            for r in rules.get("gameRules", {}).get("rosterRequirements", []):
                positions.extend([r["rosterSlotId"]] * r.get("count", 1))
            salary_cap = rules.get("gameRules", {}).get("salaryCap", {}).get("minValue", 50000)

        players = []
        for d in draftables:
            try:
                comp = d.get("competition", {})
                attrs = d.get("draftStatAttributes") or [{}]
                players.append(DKPlayer(
                    player_id         = d["playerId"],
                    display_name      = d["displayName"],
                    first_name        = d["firstName"],
                    last_name         = d["lastName"],
                    position          = d.get("rosterSlotId", "UTIL"),
                    salary            = int(d.get("salary", 0)),
                    team_abbreviation = d.get("teamAbbreviation", ""),
                    status            = d.get("status"),
                    points_per_contest= float(attrs[0].get("value", 0)),
                    news_status       = d.get("newsStatus", ""),
                    player_image      = d.get("playerImageFull", ""),
                    competition_id    = comp.get("competitionId", 0),
                    competition_name  = comp.get("name", ""),
                    game_info         = (
                        f"{comp.get('awayTeam',{}).get('abbreviation','?')} @ "
                        f"{comp.get('homeTeam',{}).get('abbreviation','?')} "
                        f"{comp.get('startTime','')}"
                    ),
                    dk_player_id = str(d.get("draftableId", d["playerId"])),
                ))
            except Exception as e:
                logger.warning("Skipping draftable %s: %s", d.get("playerId"), e)

        return DKSlate(
            draft_group_id = draft_group_id,
            sport          = sport,
            game_type      = draft_group_info.get("gameType", "Classic"),
            starts_at      = draft_group_info.get("startTimeSuffix", ""),
            players        = players,
            salary_cap     = salary_cap,
            positions      = positions,
        )

    def get_injury_statuses(self, draft_group_id: int) -> dict:
        """Return {player_id: display_status} for all injured players."""
        result = {}
        for d in self.get_draftables(draft_group_id).get("draftables", []):
            s = d.get("status")
            if s:
                result[d["playerId"]] = self.STATUS_MAP.get(s, s)
        return result
