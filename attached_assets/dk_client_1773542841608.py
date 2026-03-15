"""
EliteLineup.com — DraftKings API Client

Fetches ALL draft groups for the day across every sport, not just the main
slate.  Each draft group maps to exactly one player pool — players are
always returned scoped to their draft_group_id so there is never any
cross-slate bleed.

Key changes vs the previous version
────────────────────────────────────
• get_all_draft_groups(sport) — hits the DK draft group listing endpoint
  directly instead of inferring IDs from the contests list.  Returns rich
  metadata (game type, starts_at, contest count) for every slate of the day.

• DKSlate now carries game_count, contest_count, and is_main so the UI
  can show meaningful labels ("NBA Classic · 8 games · 7:05 PM ET").

• build_slate() stores each player with its draft_group_id so the upsert
  can guarantee players belong to the correct slate.

• All player fetches are keyed by draft_group_id — changing slate in the
  UI triggers a fresh fetch of that slate's exact player pool.
"""

import os, time, logging, requests
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DK_BASE            = "https://api.draftkings.com"
DK_DRAFT_GROUPS    = f"{DK_BASE}/lineups/v1/draftgroups"   # all groups for a sport/date
DK_DRAFTABLES      = f"{DK_BASE}/lineups/v1/draftables"    # player pool for a group
DK_RULES           = f"{DK_BASE}/lineups/v1/gamerules"     # salary cap + positions
DK_CONTESTS        = f"{DK_BASE}/contests/v1/contests"     # fallback for contest counts


@dataclass
class DKPlayer:
    player_id:          int
    display_name:       str
    first_name:         str
    last_name:          str
    position:           str
    salary:             int
    team_abbreviation:  str
    status:             Optional[str]
    points_per_contest: float
    news_status:        str
    player_image:       str
    competition_id:     int
    competition_name:   str
    game_info:          str
    dk_player_id:       str
    draft_group_id:     int = 0   # which slate this player belongs to
    # Populated by AI Scout:
    ai_boost:             float = 0.0
    ai_projection:        float = 0.0
    boost_reasons:        list  = field(default_factory=list)
    value_score:          float = 0.0
    tags:                 list  = field(default_factory=list)
    boost_reason:         str   = ""
    ownership_projection: float = 0.0


@dataclass
class DKSlate:
    draft_group_id: int
    sport:          str
    game_type:      str      # "Classic", "Showdown Captain Mode", "Tiers", etc.
    starts_at:      str      # ISO string from DK
    players:        list     # list[DKPlayer] — scoped to this draft group only
    salary_cap:     int
    positions:      list
    game_count:     int  = 0
    contest_count:  int  = 0
    is_main:        bool = False   # True for the primary Classic slate of the day
    label:          str  = ""      # pre-built UI label: "Classic · 8 games · 7:05 PM"


class DraftKingsClient:
    """Thin, cached wrapper around the public DraftKings API."""

    STATUS_MAP = {
        "O":   "OUT",
        "Q":   "Questionable",
        "D":   "Doubtful",
        "IR":  "OUT",
        "P":   "Probable",
        "DTD": "Day-to-Day",
    }

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("DK_API_KEY", "")
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "EliteLineup/1.0 (elitelineup.com)",
            "Accept":     "application/json",
        })
        if self.api_key:
            self.session.headers["Authorization"] = f"Bearer {self.api_key}"
        self._cache:     dict = {}
        self._cache_ttl: dict = {}

    # ── HTTP with caching ─────────────────────────────────────────────────────

    def _get(self, url: str, params: dict = None, cache_secs: int = 120) -> dict:
        key = f"{url}:{params}"
        if key in self._cache and time.time() < self._cache_ttl.get(key, 0):
            return self._cache[key]
        r = self.session.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        self._cache[key]     = data
        self._cache_ttl[key] = time.time() + cache_secs
        return data

    def invalidate(self, url_prefix: str = ""):
        stale = [k for k in self._cache if url_prefix in k]
        for k in stale:
            del self._cache[k]
            self._cache_ttl.pop(k, None)

    # ── Slate discovery ───────────────────────────────────────────────────────

    def get_all_draft_groups(self, sport: str = "NBA") -> list[dict]:
        """
        Return every draft group available today for `sport`.
        Each dict contains:
          draft_group_id, game_type, starts_at, game_count, contest_count

        Uses the DK draft groups endpoint first; falls back to parsing the
        contests list if that endpoint is unavailable.
        """
        try:
            data   = self._get(DK_DRAFT_GROUPS, params={"sport": sport}, cache_secs=300)
            groups = data.get("draftGroups", [])
            if groups:
                result = []
                for g in groups:
                    dgid = g.get("draftGroupId")
                    if not dgid:
                        continue
                    result.append({
                        "draft_group_id": dgid,
                        "game_type":      g.get("gameType", {}).get("name", "Classic"),
                        "starts_at":      g.get("startTimeSuffix") or g.get("minStartTime", ""),
                        "game_count":     g.get("gameCount", 0),
                        "contest_count":  g.get("contestCount", 0),
                    })
                logger.info("DK draft groups for %s: %d found", sport, len(result))
                return result
        except Exception as e:
            logger.warning("DK draft groups endpoint failed (%s), falling back to contests", e)

        # Fallback: derive draft group IDs from the contests list
        return self._draft_groups_from_contests(sport)

    def _draft_groups_from_contests(self, sport: str) -> list[dict]:
        """Fallback: extract unique draftGroupIds from the contests endpoint."""
        try:
            data     = self._get(DK_CONTESTS, params={"sport": sport}, cache_secs=300)
            contests = data.get("Contests", [])
            seen, result = set(), []
            for c in contests:
                dgid = c.get("draftGroupId")
                if dgid and dgid not in seen:
                    seen.add(dgid)
                    result.append({
                        "draft_group_id": dgid,
                        "game_type":      c.get("gameType", "Classic"),
                        "starts_at":      c.get("startTimeSuffix", ""),
                        "game_count":     c.get("gameCount", 0),
                        "contest_count":  1,
                    })
            logger.info("Fallback draft groups for %s: %d found", sport, len(result))
            return result
        except Exception as e:
            logger.error("Failed to get draft groups for %s: %s", sport, e)
            return []

    # Keep the old method name so existing callers don't break immediately
    def get_draft_group_ids(self, sport: str = "NBA") -> list[int]:
        return [g["draft_group_id"] for g in self.get_all_draft_groups(sport)]

    # ── Player pool ───────────────────────────────────────────────────────────

    def get_draftables(self, draft_group_id: int) -> dict:
        return self._get(f"{DK_DRAFTABLES}/{draft_group_id}", cache_secs=180)

    def get_game_rules(self, draft_group_id: int) -> dict:
        return self._get(f"{DK_RULES}/{draft_group_id}", cache_secs=600)

    def build_slate(self, draft_group_id: int, sport: str = "NBA",
                    group_meta: Optional[dict] = None) -> DKSlate:
        """
        Build a DKSlate for a single draft group.
        Players are tagged with draft_group_id so they can never be confused
        with players from another slate.

        group_meta — optional dict from get_all_draft_groups() so we don't
        need to re-fetch the draft group listing just for game_count etc.
        """
        raw              = self.get_draftables(draft_group_id)
        rules            = self.get_game_rules(draft_group_id)
        draftables       = raw.get("draftables", [])
        draft_group_info = raw.get("draftGroup", {})

        # Salary cap + position requirements from game rules
        salary_cap, positions = 50_000, []
        if rules:
            for r in (rules.get("gameRules", {}) or {}).get("rosterRequirements", []):
                positions.extend([r["rosterSlotId"]] * r.get("count", 1))
            salary_cap = (
                (rules.get("gameRules", {}) or {})
                .get("salaryCap", {})
                .get("minValue", 50_000)
            )

        # Game type — prefer the metadata we already have, fall back to the
        # draftGroup object inside the draftables response
        game_type  = (group_meta or {}).get("game_type") \
                     or draft_group_info.get("gameType", "Classic")
        starts_at  = (group_meta or {}).get("starts_at") \
                     or draft_group_info.get("startTimeSuffix", "")
        game_count = (group_meta or {}).get("game_count", 0)

        players = []
        for d in draftables:
            try:
                comp  = d.get("competition", {})
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
                        f"{comp.get('awayTeam', {}).get('abbreviation', '?')} @ "
                        f"{comp.get('homeTeam', {}).get('abbreviation', '?')} "
                        f"{comp.get('startTime', '')}"
                    ),
                    dk_player_id   = str(d.get("draftableId", d["playerId"])),
                    draft_group_id = draft_group_id,   # ← slate binding
                ))
            except Exception as e:
                logger.warning("Skipping draftable %s: %s", d.get("playerId"), e)

        # Determine is_main: the Classic slate with the most games is the main
        is_main = game_type.lower() in ("classic",) and game_count >= 1

        label = _build_slate_label(game_type, game_count, starts_at)

        return DKSlate(
            draft_group_id = draft_group_id,
            sport          = sport,
            game_type      = game_type,
            starts_at      = starts_at,
            players        = players,
            salary_cap     = salary_cap,
            positions      = positions,
            game_count     = game_count,
            contest_count  = (group_meta or {}).get("contest_count", 0),
            is_main        = is_main,
            label          = label,
        )

    def get_injury_statuses(self, draft_group_id: int) -> dict:
        result = {}
        for d in self.get_draftables(draft_group_id).get("draftables", []):
            s = d.get("status")
            if s:
                result[d["playerId"]] = self.STATUS_MAP.get(s, s)
        return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_slate_label(game_type: str, game_count: int, starts_at: str) -> str:
    """
    Build a human-readable slate label for the UI dropdown.
    Examples:
      "Classic · 8 games · 7:05 PM ET"
      "Showdown · BOS @ NYK · 7:30 PM ET"
      "Tiers · 4 games · 1:00 PM ET"
    """
    parts = [game_type]
    if game_count > 1:
        parts.append(f"{game_count} games")
    if starts_at:
        # starts_at from DK is often "ET 7:05 PM" or an ISO string — normalise
        time_part = starts_at.strip()
        if "T" in time_part:
            # ISO: "2025-03-14T23:05:00.0000000"
            try:
                from datetime import datetime, timezone
                dt = datetime.fromisoformat(time_part.split(".")[0])
                time_part = dt.strftime("%-I:%M %p ET")
            except Exception:
                pass
        parts.append(time_part)
    return " · ".join(parts)
