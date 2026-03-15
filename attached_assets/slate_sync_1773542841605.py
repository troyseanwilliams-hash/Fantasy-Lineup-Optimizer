"""
EliteLineup.com — Slate Sync Service

Loads ALL DraftKings slates for the day (Classic, Showdown, Tiers, etc.).
Players are stored with their draft_group_id so the optimizer always
serves the correct player pool for the selected slate.

Key changes
───────────
• Removed the [:3] cap — every draft group returned by DK is synced.
• Players are upserted with ON CONFLICT (slate_id, dk_player_id) so
  changing a slate in the UI and re-fetching always returns that slate's
  exact pool, never a mix from other slates.
• _deactivate_old_slates() runs every cycle to clear finished slates.
"""

import os, time, logging, threading
from datetime import datetime, timezone, timedelta
from typing import Optional

from dk_client import DraftKingsClient, DKSlate, DKPlayer
from ai_scout import AIScout

logger = logging.getLogger(__name__)

ACTIVE_SPORTS     = ["NBA", "NFL", "MLB", "NHL", "GOLF"]
SYNC_INTERVAL     = 3600
SYNC_ON_START     = True
SLATE_GRACE_HOURS = 3   # keep a slate active this many hours after start_time


class SlateSyncService:

    def __init__(
        self,
        db=None,
        dk_client: Optional[DraftKingsClient] = None,
        ai_scout:  Optional[AIScout]          = None,
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
        sports = [sport.upper()] if sport else ACTIVE_SPORTS
        self.dk.invalidate()
        self._run_sync(sports=sports, force_scout=True)

    def get_status(self) -> dict:
        return {
            "sports":        self._status,
            "next_run_in":   self.scout.seconds_until_refresh(),
            "is_refreshing": self.scout.is_refreshing(),
        }

    # ── Loop ──────────────────────────────────────────────────────────────────

    def _loop(self):
        if SYNC_ON_START:
            self._run_sync()
        while not self._stop_evt.wait(SYNC_INTERVAL):
            self._run_sync()

    # ── Core sync ─────────────────────────────────────────────────────────────

    def _run_sync(self, sports: Optional[list[str]] = None, force_scout: bool = False):
        sports = sports or ACTIVE_SPORTS

        # Step 1 — fetch ALL draft groups and their players from DK
        # slates_by_sport  : { sport: [DKSlate, ...] }
        # players_by_sport : { sport: [DKPlayer, ...] }  (all players, all slates)
        slates_by_sport:  dict[str, list[DKSlate]]  = {}
        players_by_sport: dict[str, list[DKPlayer]] = {}

        for sport in sports:
            logger.info("Fetching all DK draft groups for %s...", sport)
            try:
                groups = self.dk.get_all_draft_groups(sport)
            except Exception as e:
                logger.error("Failed to list draft groups for %s: %s", sport, e)
                continue

            if not groups:
                logger.warning("No draft groups returned for %s", sport)
                continue

            sport_slates:  list[DKSlate]  = []
            sport_players: list[DKPlayer] = []

            for group_meta in groups:
                dgid = group_meta["draft_group_id"]
                try:
                    slate = self.dk.build_slate(dgid, sport, group_meta=group_meta)
                    sport_slates.append(slate)
                    # Players already carry draft_group_id from build_slate()
                    sport_players.extend(slate.players)
                    logger.debug("  Built slate %d (%s) — %d players",
                                 dgid, slate.label, len(slate.players))
                except Exception as e:
                    logger.error("Failed to build slate %d for %s: %s", dgid, sport, e)

            if sport_slates:
                slates_by_sport[sport]  = sport_slates
                players_by_sport[sport] = sport_players
                logger.info("%s: %d slates, %d total players",
                            sport, len(sport_slates), len(sport_players))

        if not players_by_sport:
            logger.warning("No players fetched — skipping scout refresh")
        else:
            # Step 2 — one Claude call for all sports combined
            self.scout.refresh_all(players_by_sport, force=force_scout)

            # Step 3 — apply signals and upsert each slate individually
            # Players are upserted scoped to their slate via (slate_id, dk_player_id)
            # so there is no cross-slate bleed.
            for sport, slates in slates_by_sport.items():
                total_players = 0
                for slate in slates:
                    # apply_to_players reads from the scout cache — no extra Claude call
                    enriched = self.scout.apply_to_players(slate.players, sport)
                    self._upsert_slate(slate, enriched)
                    total_players += len(enriched)

                self._status[sport] = {
                    "last_sync":    datetime.now(timezone.utc).isoformat(),
                    "slate_count":  len(slates),
                    "player_count": total_players,
                }
                logger.info("Upserted %s: %d players across %d slates",
                            sport, total_players, len(slates))

        # Step 4 — deactivate finished slates (runs every cycle)
        self._deactivate_old_slates()

    # ── Stale slate cleanup ───────────────────────────────────────────────────

    def _deactivate_old_slates(self):
        if not self.db:
            logger.debug("[DRY RUN] Would deactivate slates older than %dh", SLATE_GRACE_HOURS)
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=SLATE_GRACE_HOURS)
        try:
            self.db.execute("""
                UPDATE slates
                SET    is_active  = FALSE,
                       updated_at = NOW()
                WHERE  start_time < %(cutoff)s
                  AND  is_active  = TRUE
            """, {"cutoff": cutoff})
            affected = self.db.rowcount
            self.db.commit()
            if affected:
                logger.info("Deactivated %d stale slate(s) (start_time < %s)",
                            affected, cutoff.strftime("%Y-%m-%d %H:%M UTC"))
        except Exception as e:
            logger.error("Failed to deactivate old slates: %s", e)

    # ── DB upsert ─────────────────────────────────────────────────────────────

    def _upsert_slate(self, slate: DKSlate, players: list[DKPlayer]):
        if not self.db:
            logger.debug(
                "[DRY RUN] Slate %d (%s) — %d players | top boosts: %s",
                slate.draft_group_id, slate.label, len(players),
                [(p.display_name, round(p.ai_boost, 1))
                 for p in sorted(players, key=lambda x: -x.ai_boost)[:3]],
            )
            return

        # Upsert slate row — includes label, game_type, game_count for the UI
        self.db.execute("""
            INSERT INTO slates
                (draft_group_id, sport, game_type, name, label,
                 start_time, salary_cap, platform, is_main, is_active,
                 game_count, contest_count, created_at, updated_at)
            VALUES
                (%(dgid)s, %(sport)s, %(game_type)s, %(name)s, %(label)s,
                 %(start_time)s, %(salary_cap)s, 'draftkings', %(is_main)s, TRUE,
                 %(game_count)s, %(contest_count)s, NOW(), NOW())
            ON CONFLICT (draft_group_id)
            DO UPDATE SET
                updated_at     = NOW(),
                salary_cap     = EXCLUDED.salary_cap,
                start_time     = EXCLUDED.start_time,
                label          = EXCLUDED.label,
                game_count     = EXCLUDED.game_count,
                contest_count  = EXCLUDED.contest_count,
                is_main        = EXCLUDED.is_main,
                is_active      = TRUE
            RETURNING id
        """, {
            "dgid":          slate.draft_group_id,
            "sport":         slate.sport,
            "game_type":     slate.game_type,
            "name":          f"DK {slate.sport} {slate.game_type} {slate.starts_at}",
            "label":         slate.label,
            "start_time":    slate.starts_at or "NOW()",
            "salary_cap":    slate.salary_cap,
            "is_main":       slate.is_main,
            "game_count":    slate.game_count,
            "contest_count": slate.contest_count,
        })
        row      = self.db.fetchone()
        slate_id = (row or {}).get("id")
        if not slate_id:
            return

        # Upsert players — keyed on (slate_id, dk_player_id)
        # A player in two different slates gets two separate rows, one per slate.
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
        logger.debug("Upserted %d players for slate %d (%s)",
                     len(players), slate_id, slate.label)
