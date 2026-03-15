"""
EliteLineup.com — Scout API Routes

All endpoints are READ-ONLY against the AIScout cache.
The only write path is POST /api/scout/refresh, which delegates to
SlateSyncService.force_sync() and returns immediately.
No endpoint ever calls Claude directly.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Dependency injection ──────────────────────────────────────────────────────
# Override these in main.py once you have the real singletons.

def get_sync_service():
    raise HTTPException(500, "SlateSyncService not configured")

def get_scout():
    raise HTTPException(500, "AIScout not configured")


# ── GET /api/scout/status ─────────────────────────────────────────────────────

@router.get("/api/scout/status")
async def scout_status(sync=Depends(get_sync_service)):
    """
    Returns the single shared refresh countdown and per-sport signal counts.
    The countdown is the same for every sport — there is one Claude call
    per hour covering all sports.
    """
    status = sync.get_status()
    scout  = sync.scout

    # seconds_until_refresh() is now a single shared value, not per-sport
    next_refresh = scout.seconds_until_refresh()

    per_sport = {}
    for sport in ["NBA", "NFL", "MLB", "NHL", "GOLF"]:
        signals = scout.get_cached_signals(sport)   # cache read — no Claude call
        per_sport[sport] = {
            "signal_count":  len(signals),
            "boost_count":   sum(1 for s in signals
                                 if (s.get("signal_type", "") in
                                     ("starter_out", "injury_opp", "lineup_promotion",
                                      "weather_boost", "matchup_upgrade",
                                      "confirmed_starter", "value_spike", "hot_streak"))),
            "injury_count":  sum(1 for s in signals
                                 if s.get("signal_type") in ("out", "negative_news")),
            "next_refresh":  next_refresh,   # same value for every sport
        }

    return {
        "last_sync":     status.get("sports", {}),
        "next_refresh":  next_refresh,
        "is_refreshing": scout.is_refreshing(),
        "per_sport":     per_sport,
    }


# ── GET /api/scout/signals/:sport ─────────────────────────────────────────────

@router.get("/api/scout/signals/{sport}")
async def get_signals(sport: str, scout=Depends(get_scout)):
    """
    Returns cached signals for a sport.
    This is a pure cache read — never triggers a Claude call.
    The frontend sets staleTime = 3_600_000 so it only calls this once per hour.
    """
    sport = sport.upper()
    signals = scout.get_cached_signals(sport)   # cache read only
    return {
        "sport":                sport,
        "count":                len(signals),
        "signals":              signals,
        "seconds_until_refresh": scout.seconds_until_refresh(),
    }


# ── POST /api/scout/refresh ───────────────────────────────────────────────────

@router.post("/api/scout/refresh")
async def force_refresh(
    body: dict,
    background_tasks: BackgroundTasks,
    sync=Depends(get_sync_service),
):
    """
    Admin "Scan Now" button.  Queues a forced sync in the background so the
    response returns immediately.  The sync will call scout.refresh_all()
    with force=True, bypassing the 1-hour gate.
    """
    sport = body.get("sport")   # optional — None means all sports
    background_tasks.add_task(sync.force_sync, sport)
    return {"status": "refresh_queued", "sport": sport or "ALL"}


# ── Express.js equivalent ────────────────────────────────────────────────────
"""
// routes/scout.ts
import { Router } from 'express';
import { slateSyncService, aiScout } from '../services';

const router = Router();

router.get('/api/scout/status', async (req, res) => {
  const status      = slateSyncService.getStatus();
  const nextRefresh = aiScout.secondsUntilRefresh();   // shared value
  const perSport: Record<string, any> = {};
  for (const sport of ['NBA', 'NFL', 'MLB', 'NHL', 'GOLF']) {
    const signals = aiScout.getCachedSignals(sport);   // cache read only
    perSport[sport] = {
      signalCount:  signals.length,
      nextRefresh,
    };
  }
  res.json({ lastSync: status.sports, nextRefresh, perSport });
});

router.get('/api/scout/signals/:sport', (req, res) => {
  const sport   = req.params.sport.toUpperCase();
  const signals = aiScout.getCachedSignals(sport);    // cache read only
  res.json({ sport, count: signals.length, signals,
             secondsUntilRefresh: aiScout.secondsUntilRefresh() });
});

router.post('/api/scout/refresh', requireAdmin, async (req, res) => {
  const { sport } = req.body;
  slateSyncService.forceSync(sport).catch(console.error);
  res.json({ status: 'refresh_queued', sport: sport || 'ALL' });
});

export default router;
"""
