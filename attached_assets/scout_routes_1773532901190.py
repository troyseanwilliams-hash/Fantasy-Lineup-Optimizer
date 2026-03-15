"""
EliteLineup.com — Scout API Routes
Mount these onto your existing server (FastAPI example shown).
Express.js equivalents are included as comments throughout.

New endpoints added:
  GET  /api/scout/status          — refresh timer, signal counts per sport
  GET  /api/scout/signals/:sport  — all current AI signals for a sport
  POST /api/scout/refresh         — force immediate re-scrape
  GET  /api/slates/:id/players    — EXTENDED: now includes boost fields
  POST /api/optimize              — EXTENDED: auto-applies AI boosts
  POST /api/optimize/pro          — EXTENDED: auto-applies AI boosts + ownership
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Dependency injection — replace with your actual service instances
# ---------------------------------------------------------------------------

def get_sync_service():
    """
    Returns the SlateSyncService singleton.
    In your main.py:
        from slate_sync import SlateSyncService
        _sync = SlateSyncService(db=get_db())
        _sync.start()
        app.dependency_overrides[get_sync_service] = lambda: _sync
    """
    raise HTTPException(500, "SlateSyncService not configured")

def get_scout():
    raise HTTPException(500, "AIScout not configured")


# ---------------------------------------------------------------------------
# GET /api/scout/status
# Express: router.get('/api/scout/status', (req, res) => ...)
# ---------------------------------------------------------------------------

@router.get("/api/scout/status")
async def scout_status(sync=Depends(get_sync_service)):
    """
    Returns refresh countdown, last sync times, and signal counts per sport.
    Used by the ScoutStatusBar component to drive the countdown timer.
    """
    status = sync.get_status()
    scout  = sync.scout

    per_sport = {}
    for sport in ["NBA", "NFL", "MLB", "NHL", "GOLF"]:
        signals = scout.get_cached_signals(sport)
        per_sport[sport] = {
            "signal_count":  len(signals),
            "boost_count":   sum(1 for s in signals if "boost" in s.get("signal_type", "") or "injury" in s.get("signal_type", "")),
            "injury_count":  sum(1 for s in signals if s.get("signal_type") in ("out", "negative_news")),
            "next_refresh":  scout.seconds_until_refresh(sport),
        }

    return {
        "last_sync":    status.get("sports", {}),
        "next_refresh": status.get("next_run_in", 3600),
        "per_sport":    per_sport,
    }


# ---------------------------------------------------------------------------
# GET /api/scout/signals/:sport
# Express: router.get('/api/scout/signals/:sport', ...)
# ---------------------------------------------------------------------------

@router.get("/api/scout/signals/{sport}")
async def get_signals(sport: str, scout=Depends(get_scout)):
    """
    Returns the raw signal list for a sport.
    The ScoutPanel component renders these as the news ticker + boost cards.
    """
    sport = sport.upper()
    signals = scout.get_cached_signals(sport)
    return {
        "sport":   sport,
        "count":   len(signals),
        "signals": signals,
        "seconds_until_refresh": scout.seconds_until_refresh(sport),
    }


# ---------------------------------------------------------------------------
# POST /api/scout/refresh
# Express: router.post('/api/scout/refresh', requireAdmin, ...)
# ---------------------------------------------------------------------------

@router.post("/api/scout/refresh")
async def force_refresh(
    body: dict,
    background_tasks: BackgroundTasks,
    sync=Depends(get_sync_service),
):
    """
    Trigger an immediate out-of-band scrape.
    Called by the "Scan Now" button in the optimizer UI.
    Runs in background so the response returns immediately.
    """
    sport = body.get("sport")   # optional — omit to refresh all sports
    background_tasks.add_task(sync.force_sync, sport)
    return {"status": "refresh_queued", "sport": sport or "ALL"}


# ---------------------------------------------------------------------------
# Extended player endpoint — adds boost fields to existing response
# Mount this BEFORE your existing /api/slates/:id/players route, or merge
# ---------------------------------------------------------------------------

@router.get("/api/slates/{slate_id}/players/enriched")
async def get_enriched_players(slate_id: int, db=None):
    """
    Returns players with all AI Scout fields included.
    The base Optimizer and ProOptimizer already read boostScore, boostReason,
    ownershipProjection, tags, and injuryStatus from the player schema —
    this endpoint ensures those fields are populated from the Scout data.

    Your existing /api/slates/:id/players SELECT should include:
        boost_score          AS "boostScore",
        boost_reason         AS "boostReason",
        ownership_projection AS "ownershipProjection",
        tags,
        injury_status        AS "injuryStatus"
    If your existing query already returns those, no change needed —
    the sync service writes them automatically on each refresh.
    """
    if not db:
        raise HTTPException(500, "DB not configured")

    rows = db.fetch("""
        SELECT
            p.id,
            p.name,
            p.position,
            p.team,
            p.salary,
            p.projected_points   AS "projectedPoints",
            p.fppg,
            p.game_info          AS "gameInfo",
            p.injury_status      AS "injuryStatus",
            p.dk_player_id       AS "draftKingsPlayerId",
            p.boost_score        AS "boostScore",
            p.boost_reason       AS "boostReason",
            p.ownership_projection AS "ownershipProjection",
            p.tags,
            p.player_image       AS "playerImage"
        FROM players p
        WHERE p.slate_id = %(slate_id)s
        ORDER BY p.projected_points DESC
    """, {"slate_id": slate_id})

    # Parse tags from comma-separated string to array
    for row in rows:
        if isinstance(row.get("tags"), str):
            row["tags"] = [t for t in row["tags"].split(",") if t]

    return rows


# ---------------------------------------------------------------------------
# Optimize endpoint extensions — auto-inject AI boosts
# Your existing /api/optimize POST handler calls the LP solver.
# Wrap it with this middleware to auto-merge Scout boosts before solving.
# ---------------------------------------------------------------------------

def inject_scout_boosts(constraints: dict, players: list, scout) -> dict:
    """
    Middleware helper — call this inside your existing optimize handler
    BEFORE passing constraints to the LP solver.

    Usage in your existing optimize route:
        from scout_routes import inject_scout_boosts
        constraints = inject_scout_boosts(constraints, players, scout)
        result = optimizer.solve(constraints)
    """
    if not constraints.get("useBoosts", True):
        return constraints

    sport = constraints.get("sport", "NBA")
    signals = scout.get_cached_signals(sport)
    if not signals:
        return constraints

    # Build a name -> boost map from signals
    boost_map: dict[str, float] = {}
    for sig in signals:
        from ai_scout import BOOST_WEIGHTS
        weight = BOOST_WEIGHTS.get(sig.get("signal_type", ""), 0.0) * float(sig.get("confidence", 0.8))
        name = sig.get("player_name", "").lower()
        boost_map[name] = boost_map.get(name, 0.0) + weight

    # Merge with any user-supplied custom projections
    custom = dict(constraints.get("playerProjections") or {})
    for player in players:
        pid = str(player["id"])
        player_name = player.get("name", "").lower()
        scout_boost = boost_map.get(player_name, 0.0)
        if scout_boost != 0.0:
            base = float(custom.get(pid) or player.get("projectedPoints") or 0)
            custom[pid] = round(base + scout_boost, 2)

    constraints = {**constraints, "playerProjections": custom}
    return constraints


# ---------------------------------------------------------------------------
# Express.js equivalent (Node/TypeScript) — paste into your routes file
# ---------------------------------------------------------------------------
"""
// routes/scout.ts  (Express + TypeScript)
import { Router } from 'express';
import { slateSyncService, aiScout } from '../services';

const router = Router();

// GET /api/scout/status
router.get('/api/scout/status', async (req, res) => {
  const status = slateSyncService.getStatus();
  const perSport: Record<string, any> = {};
  for (const sport of ['NBA', 'NFL', 'MLB', 'NHL', 'GOLF']) {
    const signals = aiScout.getCachedSignals(sport);
    perSport[sport] = {
      signalCount:  signals.length,
      boostCount:   signals.filter(s => s.signal_type.includes('boost') || s.signal_type.includes('injury')).length,
      injuryCount:  signals.filter(s => ['out','negative_news'].includes(s.signal_type)).length,
      nextRefresh:  aiScout.secondsUntilRefresh(sport),
    };
  }
  res.json({ lastSync: status.sports, nextRefresh: status.nextRunIn, perSport });
});

// GET /api/scout/signals/:sport
router.get('/api/scout/signals/:sport', (req, res) => {
  const sport = req.params.sport.toUpperCase();
  const signals = aiScout.getCachedSignals(sport);
  res.json({ sport, count: signals.length, signals, secondsUntilRefresh: aiScout.secondsUntilRefresh(sport) });
});

// POST /api/scout/refresh
router.post('/api/scout/refresh', requireAdmin, async (req, res) => {
  const { sport } = req.body;
  slateSyncService.forceSync(sport).catch(console.error);  // fire and forget
  res.json({ status: 'refresh_queued', sport: sport || 'ALL' });
});

export default router;
"""
