/**
 * Add these two routes to your existing admin router file.
 * They sit alongside your existing POST /api/admin/analyze-slate route.
 *
 * Import runBackfill at the top of that file:
 *   import { analyzeCompletedSlate, runBackfill } from "./winning-lineup-agent";
 */

// ── POST /api/admin/backfill-winning-lineups ──────────────────────────────────
// Fills in missing winning lineup records for the last N days across all
// active sports and platforms. Skips combos that already have a record
// unless force=true is passed. Admin-only.

adminRouter.post("/api/admin/backfill-winning-lineups", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);

  const userId = getSessionUserId(req)!;
  const dbUser = await storage.getUser(userId);
  if (!dbUser?.isAdmin) return res.sendStatus(403);

  const days  = typeof req.body.days  === "number" ? Math.min(Math.max(req.body.days, 1), 30) : 7;
  const force = req.body.force === true;

  console.log(`[Admin] Backfill requested: last ${days} days, force=${force} by userId=${userId}`);

  try {
    const summary = await runBackfill(days, force);
    res.json(summary);
  } catch (err: any) {
    console.error("[Admin] Backfill error:", err);
    res.status(500).json({ message: err.message || "Backfill failed" });
  }
});

// ── POST /api/admin/analyze-slate (updated to accept platform) ────────────────
// Pass platform in the request body alongside sport and date.
// If your existing route doesn't already handle platform, replace it with this:

adminRouter.post("/api/admin/analyze-slate", async (req, res) => {
  if (!isLoggedIn(req)) return res.sendStatus(401);

  const userId = getSessionUserId(req)!;
  const dbUser = await storage.getUser(userId);
  if (!dbUser?.isAdmin) return res.sendStatus(403);

  const { sport, date, platform = "draftkings", force = false } = req.body;
  if (!sport || !date) return res.status(400).json({ message: "sport and date are required" });

  try {
    const result = await analyzeCompletedSlate(sport, date, platform, force);
    res.json(result);
  } catch (err: any) {
    console.error("[Admin] Analyze slate error:", err);
    res.status(500).json({ message: err.message || "Analysis failed" });
  }
});
