"""
EliteLineup.com — Scout API Routes

PAYWALL
───────
GET /api/scout/signals/:sport  → requires star or pro tier (or admin)
GET /api/scout/status          → requires star or pro tier (or admin)
POST /api/scout/refresh        → requires admin

Free users receive 403 with { requiresUpgrade: true } so the frontend
can redirect to the upgrade flow.

All endpoints are cache reads — no endpoint ever calls Claude directly.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from typing import Optional
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Dependency injection ──────────────────────────────────────────────────────

def get_sync_service():
    raise HTTPException(500, "SlateSyncService not configured")

def get_scout():
    raise HTTPException(500, "AIScout not configured")

def get_db():
    raise HTTPException(500, "DB not configured")


# ── Auth helpers ──────────────────────────────────────────────────────────────

async def _get_user_tier(request: Request, db=None) -> tuple[str | None, bool]:
    """
    Returns (tier, is_admin).
    tier is one of: "free" | "star" | "pro" | None (not logged in)

    Replace the body of this function with your actual session/auth lookup.
    The pattern mirrors the Express helpers in showdown-route.ts:
        const sub    = await storage.getSubscription(userId)
        const dbUser = await storage.getUser(userId)
        const isAdmin = dbUser?.isAdmin === true
        const tier    = isAdmin ? "pro" : (sub?.tier || "free")
    """
    user_id = getattr(request.state, "user_id", None)  # set by your auth middleware
    if not user_id:
        return None, False
    if db is None:
        return "free", False
    try:
        db_user = await db.get_user(user_id)
        is_admin = getattr(db_user, "is_admin", False) is True
        if is_admin:
            return "pro", True
        sub  = await db.get_subscription(user_id)
        tier = getattr(sub, "tier", "free") or "free"
        return tier, False
    except Exception:
        return "free", False


def _require_scout_access(tier: str | None, is_admin: bool):
    """
    Raise 401 if not logged in.
    Raise 403 with requiresUpgrade=True if on free tier.
    Star and pro (and admin) pass through.
    """
    if tier is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not is_admin and tier not in ("star", "pro"):
        raise HTTPException(
            status_code=403,
            detail={
                "message": "AI Scout is a Star / Pro feature. Upgrade to unlock.",
                "requiresUpgrade": True,
            },
        )


def _require_admin(tier: str | None, is_admin: bool):
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin only")


# ── GET /api/scout/status ─────────────────────────────────────────────────────

@router.get("/api/scout/status")
async def scout_status(
    request: Request,
    sync=Depends(get_sync_service),
    db=Depends(get_db),
):
    tier, is_admin = await _get_user_tier(request, db)
    _require_scout_access(tier, is_admin)

    status       = sync.get_status()
    scout        = sync.scout
    next_refresh = scout.seconds_until_refresh()

    per_sport = {}
    for sport in ["NBA", "NFL", "MLB", "NHL", "GOLF"]:
        signals = scout.get_cached_signals(sport)
        per_sport[sport] = {
            "signal_count":  len(signals),
            "boost_count":   sum(1 for s in signals if s.get("signal_type") in (
                "starter_out", "injury_opp", "lineup_promotion",
                "weather_boost", "matchup_upgrade", "confirmed_starter",
                "value_spike", "hot_streak",
            )),
            "injury_count":  sum(1 for s in signals
                                 if s.get("signal_type") in ("out", "negative_news")),
            "next_refresh":  next_refresh,
        }

    return {
        "last_sync":     status.get("sports", {}),
        "next_refresh":  next_refresh,
        "is_refreshing": scout.is_refreshing(),
        "per_sport":     per_sport,
    }


# ── GET /api/scout/signals/:sport ─────────────────────────────────────────────

@router.get("/api/scout/signals/{sport}")
async def get_signals(
    sport: str,
    request: Request,
    scout=Depends(get_scout),
    db=Depends(get_db),
):
    tier, is_admin = await _get_user_tier(request, db)
    _require_scout_access(tier, is_admin)

    sport   = sport.upper()
    signals = scout.get_cached_signals(sport)
    return {
        "sport":                 sport,
        "count":                 len(signals),
        "signals":               signals,
        "seconds_until_refresh": scout.seconds_until_refresh(),
    }


# ── POST /api/scout/refresh — admin only ─────────────────────────────────────

@router.post("/api/scout/refresh")
async def force_refresh(
    body: dict,
    request: Request,
    background_tasks: BackgroundTasks,
    sync=Depends(get_sync_service),
    db=Depends(get_db),
):
    tier, is_admin = await _get_user_tier(request, db)
    _require_admin(tier, is_admin)

    sport = body.get("sport")
    background_tasks.add_task(sync.force_sync, sport)
    return {"status": "refresh_queued", "sport": sport or "ALL"}


# ── Express.js equivalent ─────────────────────────────────────────────────────
"""
// routes/scout.ts
import { Router } from 'express';
import { storage } from './storage';
import { slateSyncService, aiScout } from '../services';

const router = Router();

async function getAuthContext(req) {
  const userId = (req.session as any)?.userId;
  if (!userId) return { tier: null, isAdmin: false };
  const [dbUser, sub] = await Promise.all([
    storage.getUser(userId),
    storage.getSubscription(userId),
  ]);
  const isAdmin = dbUser?.isAdmin === true;
  const tier    = isAdmin ? 'pro' : (sub?.tier || 'free');
  return { tier, isAdmin };
}

function requireScoutAccess(tier, isAdmin, res): boolean {
  if (!tier)                              { res.sendStatus(401); return false; }
  if (!isAdmin && !['star','pro'].includes(tier)) {
    res.status(403).json({ message: 'AI Scout is a Star / Pro feature.', requiresUpgrade: true });
    return false;
  }
  return true;
}

router.get('/api/scout/status', async (req, res) => {
  const { tier, isAdmin } = await getAuthContext(req);
  if (!requireScoutAccess(tier, isAdmin, res)) return;

  const nextRefresh = aiScout.secondsUntilRefresh();
  const perSport: Record<string, any> = {};
  for (const sport of ['NBA', 'NFL', 'MLB', 'NHL', 'GOLF']) {
    const signals = aiScout.getCachedSignals(sport);
    perSport[sport] = { signalCount: signals.length, nextRefresh };
  }
  res.json({ nextRefresh, isRefreshing: aiScout.isRefreshing(), perSport });
});

router.get('/api/scout/signals/:sport', async (req, res) => {
  const { tier, isAdmin } = await getAuthContext(req);
  if (!requireScoutAccess(tier, isAdmin, res)) return;

  const sport   = req.params.sport.toUpperCase();
  const signals = aiScout.getCachedSignals(sport);
  res.json({ sport, count: signals.length, signals,
             secondsUntilRefresh: aiScout.secondsUntilRefresh() });
});

router.post('/api/scout/refresh', async (req, res) => {
  const { isAdmin } = await getAuthContext(req);
  if (!isAdmin) return res.sendStatus(403);
  const { sport } = req.body;
  slateSyncService.forceSync(sport).catch(console.error);
  res.json({ status: 'refresh_queued', sport: sport || 'ALL' });
});

export default router;
"""
