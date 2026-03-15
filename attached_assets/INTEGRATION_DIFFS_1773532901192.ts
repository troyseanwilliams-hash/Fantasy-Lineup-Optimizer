/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTEGRATION DIFFS FOR Optimizer.tsx and ProOptimizer.tsx
 * Apply these exact changes to wire the AI Scout into your existing pages.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All changes are marked with:
 *   // ── SCOUT ADD ──  (new lines to insert)
 *   // ── SCOUT MERGE ──  (modify an existing line)
 *   // ── SCOUT REMOVE ──  (delete this line)
 */


// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZER.TSX  CHANGES
// ═══════════════════════════════════════════════════════════════════════════

/*
──────────────────────────────────────────────────────────
STEP 1: Add imports at the top of Optimizer.tsx
──────────────────────────────────────────────────────────
After the existing imports block, add:
*/
// ── SCOUT ADD ──
// import { ScoutPanel, ScoutStatusBar } from "@/components/ScoutPanel";
// import { useScoutBoosts } from "@/hooks/useScoutBoosts";


/*
──────────────────────────────────────────────────────────
STEP 2: Add hook inside the Optimizer() component
──────────────────────────────────────────────────────────
Place this after your existing useState declarations (around line 74).
*/
// ── SCOUT ADD ──
/*
const scoutHook = useScoutBoosts({ sport, players: players ?? [] });
*/


/*
──────────────────────────────────────────────────────────
STEP 3: Merge scout projections into handleOptimize
──────────────────────────────────────────────────────────
Find your handleOptimize function (line ~306). The existing code builds
`mergedProjections` from customProjections + boosts. After those lines,
add the scout merge BEFORE the optimizeMutation.mutate call:
*/
// ── SCOUT ADD (insert before optimizeMutation.mutate) ──
/*
// Merge AI Scout boosts (lower priority than user-set custom projections)
if (scoutHook.hasScoutBoosts) {
  for (const [pid, scoutProj] of Object.entries(scoutHook.scoutProjections)) {
    if (!(pid in mergedProjections)) {
      // Only apply scout boost if user hasn't already set a custom projection
      mergedProjections[pid] = scoutProj;
    }
  }
}
*/


/*
──────────────────────────────────────────────────────────
STEP 4: Add ScoutStatusBar above the player table header
──────────────────────────────────────────────────────────
Find the "LEFT: Player Pool" section (around line 549).
Immediately BEFORE the "Top Bar" div, insert:
*/
// ── SCOUT ADD ──
/*
<ScoutStatusBar sport={sport} />
*/


/*
──────────────────────────────────────────────────────────
STEP 5: Add ScoutPanel above the player list
──────────────────────────────────────────────────────────
Find the player table section (after the filter row, around line 790).
Insert before the <table> or player list container:
*/
// ── SCOUT ADD ──
/*
<div className="px-3 pt-2">
  <ScoutPanel
    sport={sport}
    players={players}
    onBoostApply={(projections) => {
      // Merge scout projections into customProjections state
      setCustomProjections(prev => ({ ...projections, ...prev }));
    }}
  />
</div>
*/


/*
──────────────────────────────────────────────────────────
STEP 6: Add "AI Boosted" indicator in player rows
──────────────────────────────────────────────────────────
In the player table row rendering (around line 870-900 in your file),
find where injuryStatus badge is rendered. After it, add:
*/
// ── SCOUT ADD (inside player row, after injury badge) ──
/*
{(player as any).boostScore > 0 && (
  <span
    className="inline-flex items-center gap-0.5 text-[9px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1"
    title={(player as any).boostReason || "AI boosted"}
  >
    <Zap className="w-2.5 h-2.5" />
    +{Number((player as any).boostScore).toFixed(1)}
  </span>
)}
{(player as any).tags?.includes("inj-opp") && (
  <span className="inline-flex items-center gap-0.5 text-[9px] font-black text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1">
    <AlertTriangle className="w-2.5 h-2.5" />
    Inj Opp
  </span>
)}
*/


// ═══════════════════════════════════════════════════════════════════════════
// PROOPTIMIZER.TSX  CHANGES
// ═══════════════════════════════════════════════════════════════════════════

/*
──────────────────────────────────────────────────────────
STEP 1: Add imports at the top of ProOptimizer.tsx
──────────────────────────────────────────────────────────
*/
// ── SCOUT ADD ──
// import { ScoutPanel, ScoutStatusBar } from "@/components/ScoutPanel";
// import { useScoutBoosts } from "@/hooks/useScoutBoosts";


/*
──────────────────────────────────────────────────────────
STEP 2: Add hook inside ProOptimizer() component
──────────────────────────────────────────────────────────
After the existing useState declarations (around line 116).
For ProOptimizer, we enable autoApply since pro users expect boosts on by default.
*/
// ── SCOUT ADD ──
/*
const scoutHook = useScoutBoosts({
  sport,
  players: players ?? [],
  autoApply: useBoosts,      // tied to the existing "Use AI Boosts" toggle
  minConfidence: 0.75,       // slightly higher bar for Pro
});
*/


/*
──────────────────────────────────────────────────────────
STEP 3: Merge scout projections in handleOptimize
──────────────────────────────────────────────────────────
In your handleOptimize function (line ~447), after building `projections`,
add before optimizeMutation.mutate:
*/
// ── SCOUT ADD (in handleOptimize, before optimizeMutation.mutate) ──
/*
// Layer in AI Scout boosts — only for fields not already custom-set
if (useBoosts && scoutHook.hasScoutBoosts) {
  for (const [pid, scoutProj] of Object.entries(scoutHook.scoutProjections)) {
    if (!(pid in projections)) {
      projections[pid] = scoutProj;
    }
  }
}
// Merge ownership deltas for leverage/fade calculations
const mergedOwnership: Record<string, number> = {};
if (leverageMode && Object.keys(scoutHook.ownershipDeltas).length > 0) {
  for (const [pid, delta] of Object.entries(scoutHook.ownershipDeltas)) {
    const player = players?.find(p => String(p.id) === pid);
    if (player) {
      const baseOwn = (player as any).ownershipProjection ?? 10;
      mergedOwnership[pid] = Math.max(1, Math.min(99, baseOwn + delta));
    }
  }
}
*/


/*
──────────────────────────────────────────────────────────
STEP 4: Add ScoutStatusBar above the pro player pool
──────────────────────────────────────────────────────────
Same as Optimizer — add directly before the "LEFT: Player Pool" div.
*/
// ── SCOUT ADD ──
/*
<ScoutStatusBar sport={sport} />
*/


/*
──────────────────────────────────────────────────────────
STEP 5: Replace the existing "AI Boosts" summary panel
──────────────────────────────────────────────────────────
The ProOptimizer already has an "AI Boosts Summary" panel (around line 2045).
REPLACE the entire {boostedPlayers.length > 0 && (...)} block with:
*/
// ── SCOUT MERGE (replace existing AI Boosts panel) ──
/*
{(boostedPlayers.length > 0 || scoutHook.signals.length > 0) && (
  <div data-testid="boosts-summary-panel">
    <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2 mb-3">
      <TrendingUp className="w-4 h-4 text-emerald-400" />
      AI Boosts
      {scoutHook.hasScoutBoosts && (
        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[9px] font-black ml-1">
          {scoutHook.boostedPlayerCount} active
        </Badge>
      )}
    </h3>
    <ScoutPanel
      sport={sport}
      players={players}
      compact
      onBoostApply={scoutHook.applyScoutBoosts}
    />
    {boostedPlayers.length > 0 && (
      <Card className="bg-slate-800/60 border-slate-700/50 p-3 mt-2">
        <div className="space-y-2">
          {boostedPlayers.map((bp) => (
            <div key={bp.playerId} className="flex items-center gap-2" data-testid={`boost-row-${bp.playerId}`}>
              <span className={`text-[11px] font-black ${bp.boostScore > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {bp.boostScore > 0 ? "+" : ""}{bp.boostScore.toFixed(1)}
              </span>
              <span className="text-sm font-bold text-white flex-1 truncate">{bp.playerName}</span>
              <span className="text-[11px] text-slate-400 truncate max-w-[180px]">{bp.boostReason}</span>
            </div>
          ))}
        </div>
      </Card>
    )}
  </div>
)}
*/


/*
──────────────────────────────────────────────────────────
STEP 6: Add ownership_delta to ownershipProjection in filteredPlayers
──────────────────────────────────────────────────────────
In the filteredPlayers useMemo (around line 280), find:
  const own = (p as any).ownershipProjection ?? 0;
Replace with:
*/
// ── SCOUT MERGE ──
/*
const baseOwn = (p as any).ownershipProjection ?? 0;
const ownDelta = scoutHook.ownershipDeltas[String(p.id)] ?? 0;
const own = Math.max(1, Math.min(99, baseOwn + ownDelta));
*/
