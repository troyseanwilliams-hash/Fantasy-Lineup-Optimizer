"""
EliteLineup.com — Slate Sync Service
Runs on a background thread. Every hour it:
  1. Pulls fresh slates from DraftKings for all active sports
  2. Upserts players into the DB (preserving custom projections)
  3. Runs the AI Scout to enrich players with boost scores
  4. Updates the player pool so the optimizer picks up fresh data

Designed to slot into your existing Express/Python backend.
"""

import os, time, logging, threading
from datetime import datetime, timezone
from typing import Optional

from dk_client import DraftKingsClient, DKSlate, DKPlayer
from ai_scout import AIScout

logger = logging.getLogger(__name__)

ACTIVE_SPORTS = ["NBA", "NFL", "MLB", "NHL", "GOLF"]
SYNC_INTERVAL = 3600   # 1 hour in seconds
SYNC_ON_START = True   # run immediately on startup


class SlateSyncService:
    """
    Drop this into your main server startup.
    Usage:
        sync = SlateSyncService(db=your_db_connection)
        sync.start()   # non-blocking, runs in background thread
    """

    def __init__(self, db=None, dk_client: Optional[DraftKingsClient] = None,
                 ai_scout: Optional[AIScout] = None):
        self.db        = db
        self.dk        = dk_client or DraftKingsClient()
        self.scout     = ai_scout  or AIScout()
        self._thread: Optional[threading.Thread] = None
        self._stop_evt = threading.Event()
        self._status: dict = {}   # sport -> last sync time + counts

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Start background sync thread (non-blocking)."""
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
        """Trigger an immediate out-of-band sync (e.g. from /api/scout/refresh)."""
        sports = [sport] if sport else ACTIVE_SPORTS
        for s in sports:
            self.dk.invalidate()
            self.scout.force_refresh(s)
            self._sync_sport(s)

    def get_status(self) -> dict:
        return {
            "sports": self._status,
            "next_run_in": self.scout.seconds_until_refresh("NBA"),
        }

    # ------------------------------------------------------------------
    # Internal: loop
    # ------------------------------------------------------------------

    def _loop(self):
        if SYNC_ON_START:
            self._sync_all()
        while not self._stop_evt.wait(SYNC_INTERVAL):
            self._sync_all()

    def _sync_all(self):
        for sport in ACTIVE_SPORTS:
            try:
                self._sync_sport(sport)
            except Exception as e:
                logger.error("Sync failed for %s: %s", sport, e)

    def _sync_sport(self, sport: str):
        logger.info("Syncing %s slates from DraftKings...", sport)
        try:
            draft_group_ids = self.dk.get_draft_group_ids(sport)
        except Exception as e:
            logger.error("Failed to get DK draft groups for %s: %s", sport, e)
            return

        synced_players = 0
        for dgid in draft_group_ids[:3]:  # limit to 3 slates per sport to avoid rate limits
            try:
                slate = self.dk.build_slate(dgid, sport)
                enriched = self.scout.run(slate.players, sport)
                self._upsert_slate(slate, enriched)
                synced_players += len(enriched)
            except Exception as e:
                logger.error("Failed to sync draft group %s: %s", dgid, e)

        self._status[sport] = {
            "last_sync": datetime.now(timezone.utc).isoformat(),
            "slate_count": len(draft_group_ids),
            "player_count": synced_players,
        }
        logger.info("Synced %s: %d players across %d slates", sport, synced_players, len(draft_group_ids))

    # ------------------------------------------------------------------
    # Internal: DB upsert
    # ------------------------------------------------------------------

    def _upsert_slate(self, slate: DKSlate, players: list[DKPlayer]):
        """
        Write slate + enriched players to your DB.
        Adapt the SQL to match your schema — this mirrors the EliteLineup
        `slates` and `players` tables inferred from the optimizer code.
        """
        if not self.db:
            logger.debug("No DB connection — dry run for draft_group %d", slate.draft_group_id)
            self._dry_run_log(slate, players)
            return

        # --- Upsert slate -----------------------------------------------
        self.db.execute("""
            INSERT INTO slates
                (draft_group_id, sport, game_type, name, start_time,
                 salary_cap, platform, is_main, created_at, updated_at)
            VALUES
                (%(dgid)s, %(sport)s, %(game_type)s, %(name)s, %(start_time)s,
                 %(salary_cap)s, 'draftkings', TRUE, NOW(), NOW())
            ON CONFLICT (draft_group_id)
            DO UPDATE SET
                updated_at   = NOW(),
                salary_cap   = EXCLUDED.salary_cap,
                start_time   = EXCLUDED.start_time
            RETURNING id
        """, {
            "dgid":       slate.draft_group_id,
            "sport":      slate.sport,
            "game_type":  slate.game_type,
            "name":       f"DK {slate.sport} {slate.game_type} {slate.starts_at}",
            "start_time": slate.starts_at or "NOW()",
            "salary_cap": slate.salary_cap,
        })
        row = self.db.fetchone()
        slate_id = row["id"] if row else None

        if not slate_id:
            return

        # --- Upsert players ---------------------------------------------
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

    @staticmethod
    def _dry_run_log(slate: DKSlate, players: list[DKPlayer]):
        logger.info(
            "[DRY RUN] Slate %d (%s): %d players — top boosts: %s",
            slate.draft_group_id, slate.sport, len(players),
            [(p.display_name, round(p.ai_boost, 1)) for p in sorted(players, key=lambda x: -x.ai_boost)[:5]]
        )
