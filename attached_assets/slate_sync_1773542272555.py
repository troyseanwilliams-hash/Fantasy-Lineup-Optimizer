"""
EliteLineup.com — Slate Sync Service

Every hour:
  1. Pulls fresh slates from DraftKings for all active sports
  2. Calls scout.refresh_all() — ONE Claude call for all sports combined
  3. Applies signals to players and upserts to DB
  4. Deactivates slates whose start_time has passed (is_active = FALSE)
     — this is what clears old slates from the optimizer dropdown

STALE SLATE RULES
─────────────────
A slate is deactivated (is_active = FALSE) when:
  • Its start_time is more than SLATE_GRACE_HOURS (default 3) hours in the past

Deactivated slates and their players are kept in the DB so saved lineups
that reference them don't break.  They're just filtered out of the
optimizer and showdown slate picker.
"""

import os, time, logging, threading
from datetime import datetime, timezone, timedelta
from typing import Optional

from dk_client import DraftKingsClient, DKSlate, DKPlayer
from ai_scout import AIScout

logger = logging.getLogger(__name__)

ACTIVE_SPORTS     = ["NBA", "NFL", "MLB", "NHL", "GOLF"]
SYNC_INTERVAL     = 3600   # seconds between full syncs
SYNC_ON_START     = True
SLATE_GRACE_HOURS = 3      # keep a slate active this many hours after start_time


class SlateSyncService:
    """
    Usage:
        sync = SlateSyncService(db=your_db_connection)
        sync.start()
    """

    def __init__(
        self,
        db=None,
        dk_client: Optional[DraftKingsClient] = None,
        ai_scout: Optional[AIScout] = None,
    ):
        self.db    = db
        self.dk    = dk_client or DraftKingsClient()
        self.scout = ai_scout  or AIScout()
        self._thread: Optional[threading.Thread] = None
        self._stop_evt = threading.Event()
        self._status: dict = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self):
        if self._thread and self._thread.is_alive():
            logger.warning("SlateSyncService already running")
            return
        self._stop_evt.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="SlateSync")
        self._thread.start()
        logger.info("SlateSyncService started")

    def stop(self):
        self._stop_evt.set()
        if self._thread:
            self._thread.join(timeout=10)

    def force_sync(self, sport: Optional[str] = None):
        """Immediate out-of-band sync — called from POST /api/scout/refresh."""
        sports = [sport.upper()] if sport else ACTIVE_SPORTS
        self.dk.invalidate()
        self._run_sync(sports=sports, force_scout=True)

    def get_status(self) -> dict:
        return {
            "sports":        self._status,
            "next_run_in":   self.scout.seconds_until_refresh(),
            "is_refreshing": self.scout.is_refreshing(),
        }

    # ── Internal: loop ────────────────────────────────────────────────────────

    def _loop(self):
        if SYNC_ON_START:
            self._run_sync()
        while not self._stop_evt.wait(SYNC_INTERVAL):
            self._run_sync()

    # ── Internal: core sync ───────────────────────────────────────────────────

    def _run_sync(self, sports: Optional[list[str]] = None, force_scout: bool = False):
        sports = sports or ACTIVE_SPORTS

        # Step 1 — collect player pools from DraftKings
        slates_by_sport:  dict[str, list[DKSlate]]  = {}
        players_by_sport: dict[str, list[DKPlayer]] = {}

        for sport in sports:
            logger.info("Fetching DK slates for %s...", sport)
            try:
                draft_group_ids = self.dk.get_draft_group_ids(sport)
            except Exception as e:
                logger.error("Failed to get DK draft groups for %s: %s", sport, e)
                continue

            sport_slates:  list[DKSlate]  = []
            sport_players: list[DKPlayer] = []

            for dgid in draft_group_ids[:3]:
                try:
                    slate = self.dk.build_slate(dgid, sport)
                    sport_slates.append(slate)
                    sport_players.extend(slate.players)
                except Exception as e:
                    logger.error("Failed to build slate %s for %s: %s", dgid, sport, e)

            if sport_players:
                slates_by_sport[sport]  = sport_slates
                players_by_sport[sport] = sport_players

        if not players_by_sport:
            logger.warning("No players fetched — skipping scout refresh")
        else:
            # Step 2 — one Claude call for all sports
            self.scout.refresh_all(players_by_sport, force=force_scout)

            # Step 3 — apply signals and upsert
            for sport, slates in slates_by_sport.items():
                enriched = self.scout.apply_to_players(players_by_sport[sport], sport)
                for slate in slates:
                    self._upsert_slate(slate, enriched)
                self._status[sport] = {
                    "last_sync":    datetime.now(timezone.utc).isoformat(),
                    "slate_count":  len(slates),
                    "player_count": len(enriched),
                }
                logger.info("Upserted %s: %d players across %d slates",
                            sport, len(enriched), len(slates))

        # Step 4 — deactivate expired slates (runs every cycle regardless)
        self._deactivate_old_slates()

    # ── Internal: stale slate cleanup ─────────────────────────────────────────

    def _deactivate_old_slates(self):
        """
        Mark slates as inactive once their games have started (+ grace period).
        Called at the end of every sync cycle so the optimizer never shows
        slates from previous days.
        """
        if not self.db:
            logger.debug("[DRY RUN] Would deactivate slates older than %dh", SLATE_GRACE_HOURS)
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=SLATE_GRACE_HOURS)
        try:
            self.db.execute("""
                UPDATE slates
                SET    is_active = FALSE,
                       updated_at = NOW()
                WHERE  start_time < %(cutoff)s
                  AND  is_active = TRUE
            """, {"cutoff": cutoff})
            affected = self.db.rowcount
            self.db.commit()
            if affected:
                logger.info("Deactivated %d stale slate(s) (start_time < %s)",
                            affected, cutoff.strftime("%Y-%m-%d %H:%M UTC"))
        except Exception as e:
            logger.error("Failed to deactivate old slates: %s", e)

    # ── Internal: DB upsert ───────────────────────────────────────────────────

    def _upsert_slate(self, slate: DKSlate, players: list[DKPlayer]):
        if not self.db:
            logger.debug(
                "[DRY RUN] Slate %d (%s): %d players — top boosts: %s",
                slate.draft_group_id, slate.sport, len(players),
                [(p.display_name, round(p.ai_boost, 1))
                 for p in sorted(players, key=lambda x: -x.ai_boost)[:5]],
            )
            return

        self.db.execute("""
            INSERT INTO slates
                (draft_group_id, sport, game_type, name, start_time,
                 salary_cap, platform, is_main, is_active, created_at, updated_at)
            VALUES
                (%(dgid)s, %(sport)s, %(game_type)s, %(name)s, %(start_time)s,
                 %(salary_cap)s, 'draftkings', TRUE, TRUE, NOW(), NOW())
            ON CONFLICT (draft_group_id)
            DO UPDATE SET
                updated_at = NOW(),
                salary_cap = EXCLUDED.salary_cap,
                start_time = EXCLUDED.start_time,
                is_active  = TRUE   -- re-activate if DK returns it again
        """, {
            "dgid":       slate.draft_group_id,
            "sport":      slate.sport,
            "game_type":  slate.game_type,
            "name":       f"DK {slate.sport} {slate.game_type} {slate.starts_at}",
            "start_time": slate.starts_at or "NOW()",
            "salary_cap": slate.salary_cap,
        })
        row = self.db.fetchone()
        slate_id = (row or {}).get("id")
        if not slate_id:
            return

        for p in players:
            injury_display = DraftKingsClient.STATUS_MAP.get(p.status or "", p.status)
            self.db.execute("""
                INSERT INTO players
                    (slate_id, name, position, team, salary,
                     projected_points, fppg, game_info,
                     injury_status, dk_player_id,
                     boost_score, boost_reason, ownership_projection,
                     tags, player_image, created_at, updated_at)
                VALUES
                    (%(slate_id)s, %(name)s, %(pos)s, %(team)s, %(salary)s,
                     %(proj)s, %(fppg)s, %(game_info)s,
                     %(injury)s, %(dk_id)s,
                     %(boost)s, %(reason)s, %(own)s,
                     %(tags)s, %(img)s, NOW(), NOW())
                ON CONFLICT (slate_id, dk_player_id)
                DO UPDATE SET
                    projected_points     = EXCLUDED.projected_points,
                    injury_status        = EXCLUDED.injury_status,
                    boost_score          = EXCLUDED.boost_score,
                    boost_reason         = EXCLUDED.boost_reason,
                    ownership_projection = EXCLUDED.ownership_projection,
                    tags                 = EXCLUDED.tags,
                    updated_at           = NOW()
            """, {
                "slate_id": slate_id,
                "name":     p.display_name,
                "pos":      p.position,
                "team":     p.team_abbreviation,
                "salary":   p.salary,
                "proj":     round(p.ai_projection or p.points_per_contest, 2),
                "fppg":     round(p.points_per_contest, 2),
                "game_info": p.game_info,
                "injury":   injury_display,
                "dk_id":    p.dk_player_id,
                "boost":    round(p.ai_boost, 2),
                "reason":   p.boost_reason,
                "own":      round(p.ownership_projection, 1),
                "tags":     ",".join(p.tags),
                "img":      p.player_image,
            })

        self.db.commit()
        logger.debug("Upserted %d players for slate %d", len(players), slate_id)
