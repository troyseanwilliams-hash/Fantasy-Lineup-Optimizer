import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, seedDatabase, generateDailyProps, refreshPlayerStatuses } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cron from "node-cron";
import { storage } from "./storage";
import { getEasternToday } from "./balldontlie";
import { fetchPrizePicksProjections, getSupportedPPSports } from "./prizepicks";
import { refreshRecentlyPlayed } from "./espn-activity";
import { runNightlyAnalysis } from "./winning-lineup-agent";
import { runScoutForAllSports } from "./ai-scout";
import { fetchStartingLineups } from "./lineups-ingest";
import { fetchAllActualPointsForDate } from "./actual-points";
import { players as playersTable, lineups as lineupsTable } from "@shared/schema";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { subscriptions, slates } from "@shared/schema";
import { eq, and, ne, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { showdownRouter } from "./showdown-route";
import { ingestRouter, startIngestScheduler } from "./routes/ingest";

const SLATE_GRACE_HOURS = 3;

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function refreshLineupScores(): Promise<void> {
  const lineups = await storage.getLineupsForScoring();
  console.log(`[ScoreRefresh] Found ${lineups.length} lineup(s) to score`);
  if (lineups.length === 0) return;

  const sportSet = new Set(lineups.map(l => l.sport));
  const supportedSports = ["NBA", "NHL", "MLB", "NFL"];
  const today = getEasternToday();

  const sportPointsMaps = new Map<string, { playerMap: Map<string, any>; gamesTotal: number; gamesCompleted: number; gamesInProgress: number }>();

  for (const sport of sportSet) {
    if (!supportedSports.includes(sport)) continue;
    try {
      const result = await fetchAllActualPointsForDate(sport, today);
      if (result.gamesTotal > 0) {
        sportPointsMaps.set(sport, result);
        console.log(`[ScoreRefresh] ${sport}: ${result.gamesTotal} games, ${result.playerMap.size} players with data`);
      }
    } catch (err) {
      console.error(`[ScoreRefresh] Failed to fetch ${sport} actual points:`, err);
    }
  }

  if (sportPointsMaps.size === 0) {
    console.log("[ScoreRefresh] No games with data found for any sport today");
    return;
  }

  let scored = 0;
  const slateCache = new Map<number, any[]>();

  for (const lineup of lineups) {
    const actualData = sportPointsMaps.get(lineup.sport);
    if (!actualData || actualData.gamesTotal === 0) continue;

    let rosterPlayers: any[] = [];

    if (!slateCache.has(lineup.slateId)) {
      const slatePlayers = await db.select().from(playersTable).where(eq(playersTable.slateId, lineup.slateId));
      slateCache.set(lineup.slateId, slatePlayers);
    }
    const allPlayers = slateCache.get(lineup.slateId)!;
    rosterPlayers = allPlayers.filter(p => lineup.playerIds.includes(p.id));

    if (rosterPlayers.length === 0 && lineup.playerSnapshot && Array.isArray(lineup.playerSnapshot) && (lineup.playerSnapshot as any[]).length > 0) {
      rosterPlayers = lineup.playerSnapshot as any[];
      console.log(`[ScoreRefresh] Lineup ${lineup.id}: using playerSnapshot (${rosterPlayers.length} players) — slate players unavailable`);
    }

    if (rosterPlayers.length === 0) continue;

    const playerScores: Array<{
      playerId: number;
      playerName: string;
      position: string;
      team: string;
      salary: number;
      livePoints: number;
      projectedPoints: number;
      gameStatus: string;
      gameStartTime: string;
    }> = [];

    let totalLive = 0;
    let totalProjected = 0;
    let gamesWithData = 0;

    for (const p of rosterPlayers) {
      const normalized = normalizeName(p.name);
      const actual = actualData.playerMap.get(normalized);
      const livePoints = actual ? actual.points : 0;
      const projPts = parseFloat(p.projectedPoints || "0") || 0;

      const gameStatus = actual ? (actual.points > 0 ? "Final" : "In Progress") : "Upcoming";
      if (actual) gamesWithData++;

      totalLive += livePoints;
      totalProjected += projPts;
      playerScores.push({
        playerId: p.id,
        playerName: p.name,
        position: p.position || "",
        team: p.team || "",
        salary: p.salary || 0,
        livePoints: Math.round(livePoints * 100) / 100,
        projectedPoints: Math.round(projPts * 100) / 100,
        gameStatus,
        gameStartTime: "",
      });
    }

    const percentComplete = rosterPlayers.length > 0
      ? Math.round((gamesWithData / rosterPlayers.length) * 100)
      : 0;

    try {
      await storage.upsertLineupScore({
        lineupId: lineup.id,
        userId: lineup.userId,
        sport: lineup.sport,
        totalLivePoints: (Math.round(totalLive * 100) / 100).toString(),
        totalProjectedPoints: (Math.round(totalProjected * 100) / 100).toString(),
        percentComplete,
        playerScores,
      });
      scored++;
    } catch (err) {
      console.error(`[ScoreRefresh] Failed to upsert score for lineup ${lineup.id}:`, err);
    }
  }

  if (scored > 0) {
    const sportSummary = Array.from(sportPointsMaps.entries())
      .map(([s, d]) => `${s}: ${d.gamesCompleted}done/${d.gamesInProgress}live`)
      .join(", ");
    log(`Score refresh: updated ${scored}/${lineups.length} lineup(s) [${sportSummary}]`, "cron");
  }

  try {
    await generatePerformanceSnapshots();
  } catch (err) {
    console.error("[PerfSnap] Error generating performance snapshots:", err);
  }
}

async function generatePerformanceSnapshots() {
  const completedScores = await storage.getCompletedLineupScores();
  if (completedScores.length === 0) return;

  const scoresByLineupId = new Map(completedScores.map(s => [s.lineupId, s]));
  const lineupIds = completedScores.map(s => s.lineupId);

  const matchedLineups = await db.select().from(lineupsTable)
    .where(and(
      sql`${lineupsTable.id} = ANY(${lineupIds})`,
    ));

  if (matchedLineups.length === 0) return;

  type SlateGroup = { userId: string; slateId: number; sport: string; lineupIds: number[] };
  const groupKey = (l: typeof matchedLineups[0]) => `${l.userId}:${l.slateId}`;
  const groups = new Map<string, SlateGroup>();
  for (const l of matchedLineups) {
    const key = groupKey(l);
    if (!groups.has(key)) {
      groups.set(key, { userId: l.userId, slateId: l.slateId, sport: l.sport, lineupIds: [] });
    }
    groups.get(key)!.lineupIds.push(l.id);
  }

  let created = 0;
  for (const group of groups.values()) {
    const existing = await storage.getPerformanceSnapshotBySlate(group.userId, group.slateId);
    if (existing) continue;

    const slate = await storage.getSlate(group.slateId);
    if (!slate) continue;

    const slateDate = slate.startTime
      ? new Date(slate.startTime).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    let bestScore = 0;
    let bestLineupId: number | null = null;
    let totalProjected = 0;
    let totalActual = 0;
    let totalSalary = 0;

    for (const lid of group.lineupIds) {
      const score = scoresByLineupId.get(lid);
      if (!score) continue;
      const live = parseFloat(score.totalLivePoints || "0");
      const proj = parseFloat(score.totalProjectedPoints || "0");
      if (live > bestScore) {
        bestScore = live;
        bestLineupId = lid;
      }
      totalActual += live;
      totalProjected += proj;
    }

    const matchedGroupLineups = matchedLineups.filter(l => l.userId === group.userId && l.slateId === group.slateId);
    for (const l of matchedGroupLineups) {
      totalSalary += l.totalSalary || 0;
    }
    const avgSalary = matchedGroupLineups.length > 0 ? totalSalary / matchedGroupLineups.length : 0;

    const salaryCap = slate.salaryCap || 50000;
    const salaryUtilization = salaryCap > 0 ? Math.round((avgSalary / salaryCap) * 1000) / 10 : 0;

    const projectionAccuracy = totalProjected > 0
      ? Math.round((totalActual / totalProjected) * 1000) / 10
      : 0;

    let optimalScore = bestScore * 1.15;
    const winningLineup = await storage.getWinningLineupBySlateDate(
      group.sport, slateDate, slate.platform || "draftkings"
    );
    if (winningLineup) {
      optimalScore = parseFloat(winningLineup.totalActualPoints || "0") || optimalScore;
    }

    const fieldAvgScore = Math.round(bestScore * 0.82 * 100) / 100;

    try {
      await storage.createPerformanceSnapshot({
        userId: group.userId,
        sport: group.sport,
        slateId: group.slateId,
        slateDate,
        userScore: bestScore.toString(),
        optimalScore: optimalScore.toString(),
        fieldAvgScore: fieldAvgScore.toString(),
        projectionAccuracy: projectionAccuracy.toString(),
        salaryUtilization: salaryUtilization.toString(),
        lineupCount: group.lineupIds.length,
        bestLineupId,
      });
      created++;
    } catch (err) {
      console.error(`[PerfSnap] Failed to create snapshot for user=${group.userId} slate=${group.slateId}:`, err);
    }
  }

  if (created > 0) {
    log(`Performance snapshots: created ${created} new snapshot(s)`, "cron");
  }
}

async function deactivateOldSlates(): Promise<number> {
  const cutoff = new Date(Date.now() - SLATE_GRACE_HOURS * 60 * 60 * 1000);
  const result = await db
    .update(slates)
    .set({ isActive: false })
    .where(and(lt(slates.startTime, cutoff), eq(slates.isActive, true)));
  return (result as any)?.rowCount ?? 0;
}

async function seedDefaultUser() {
  const email = "troy.sean.williams@gmail.com";
  const hashedPassword = await bcrypt.hash("Bubba@666", 10);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (!existing.password) {
      await db.update(users).set({
        password: hashedPassword,
        onboardingComplete: true,
        isAdmin: true,
        updatedAt: new Date(),
      }).where(eq(users.id, existing.id));
      console.log(`[seed] Updated password for existing user: ${email}`);
    }
  } else {
    const [user] = await db.insert(users).values({
      email,
      password: hashedPassword,
      firstName: "Troy",
      lastName: "Williams",
      onboardingComplete: true,
      isAdmin: true,
    }).returning();
    await db.insert(subscriptions).values({
      userId: user.id,
      tier: "pro",
      status: "active",
    }).onConflictDoNothing();
    console.log(`[seed] Created default user: ${email}`);
  }
}

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  app.use(showdownRouter);
  app.use("/api/ingest", ingestRouter);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      (async () => {
        try {
          await seedDefaultUser();

          try {
            const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const staleReview = await db.select({ id: lineupsTable.id }).from(lineupsTable)
              .where(and(eq(lineupsTable.status, "review"), lt(lineupsTable.reviewedAt, cutoff)));
            if (staleReview.length > 0) {
              for (const row of staleReview) {
                await storage.deleteLineup(row.id);
              }
              log(`Startup cleanup: deleted ${staleReview.length} stale review lineup(s)`, "cron");
            }
          } catch (cleanupErr) {
            console.error("Startup review lineup cleanup failed:", cleanupErr);
          }

          const unpaidSubs = await storage.getUnpaidPremiumSubscriptions();
          if (unpaidSubs.length > 0) {
            const graceDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            for (const sub of unpaidSubs) {
              const user = await storage.getUser(sub.userId);
              if (user?.isAdmin) continue;
              await db.update(subscriptions)
                .set({ graceEndsAt: graceDate, updatedAt: new Date() })
                .where(eq(subscriptions.userId, sub.userId));
            }
            if (unpaidSubs.length > 0) {
              log(`Set 30-day grace period for ${unpaidSubs.length} existing premium user(s)`, "stripe");
            }
          }

          const expiredGrace = await storage.getExpiredGraceSubscriptions();
          for (const sub of expiredGrace) {
            const user = await storage.getUser(sub.userId);
            if (user?.isAdmin) continue;
            await storage.upsertSubscription({
              userId: sub.userId,
              tier: "free",
              status: "active",
              graceEndsAt: null,
            });
          }
          if (expiredGrace.length > 0) {
            log(`Reverted ${expiredGrace.length} expired grace period user(s) to free`, "stripe");
          }

          const delCount = await storage.deleteExpiredLineups();
          if (delCount > 0) log(`Moved ${delCount} expired lineup(s) to review on startup`, "cron");

          try {
            const { analyzeCompletedSlate } = await import("./winning-lineup-agent");
            const { fetchDraftables } = await import("./balldontlie");
            const { db } = await import("./db");
            const { winningLineups, playerHistory } = await import("@shared/schema");
            const { eq, and } = await import("drizzle-orm");

            const existingWL = await storage.getWinningLineupBySlateDate("NBA", "2026-03-09");
            if (existingWL) {
              const players = existingWL.playerData as any[];
              const names = players?.map((p: any) => p.name) || [];
              const hasDupes = names.length !== new Set(names).size;
              if (hasDupes) {
                await db.delete(winningLineups).where(eq(winningLineups.id, existingWL.id));
                log("Deleted duplicate-player NBA 3/9 winning lineup for re-analysis", "cron");
                const result = await analyzeCompletedSlate("NBA", "2026-03-09");
                log(`Re-analyzed NBA 3/9: ${result.message}`, "cron");
              }
            }

            const backfillTasks = [
              { sport: "NBA", date: "2026-03-10", draftGroupId: 143552 },
              { sport: "NHL", date: "2026-03-10", draftGroupId: null },
            ];

            for (const task of backfillTasks) {
              try {
                const existingWL310 = await storage.getWinningLineupBySlateDate(task.sport, task.date);
                if (existingWL310) continue;

                if (task.draftGroupId) {
                  const existing = await storage.getPlayerHistoryBySport(task.sport, 10000);
                  const existingForDate = existing.filter(h => h.slateDate === task.date);
                  if (existingForDate.length === 0) {
                    const draftables = await fetchDraftables(task.draftGroupId);
                    const FPPG_IDS = [219, 90, 341, 745];
                    const records = draftables
                      .filter((d: any) => d.displayName && (d.salary > 0 || d.draftStatAttributes?.length > 0))
                      .map((d: any) => {
                        let fppg = "0";
                        for (const fid of FPPG_IDS) {
                          const attr = d.draftStatAttributes?.find((a: any) => a.id === fid);
                          if (attr?.value && attr.value !== "-" && !isNaN(parseFloat(attr.value))) { fppg = attr.value; break; }
                        }
                        const salary = d.salary || Math.round(parseFloat(fppg) * 200);
                        return {
                          playerName: d.displayName, team: d.teamAbbreviation || "", sport: task.sport,
                          position: d.position || "", salary,
                          projectedPoints: fppg !== "0" ? fppg : String(salary / 1000),
                          slateDate: task.date, slateId: null, draftKingsPlayerId: d.draftableId || null,
                        };
                      })
                      .filter((d: any) => d.salary > 0);
                    if (records.length > 0) {
                      await storage.bulkInsertPlayerHistory(records);
                      log(`Backfilled ${records.length} ${task.sport} ${task.date} player history records`, "cron");
                    }
                  }
                }

                const result = await analyzeCompletedSlate(task.sport, task.date);
                if (result.success) log(`Startup analyzed ${task.sport} ${task.date}: ${result.message}`, "cron");
              } catch (err) {
                console.error(`Startup ${task.sport} ${task.date} analysis failed:`, err);
              }
            }

          } catch (err) {
            console.error("Startup winning lineup fixes failed:", err);
          }

          await seedDatabase();
          log("Startup seed check completed", "cron");

          try {
            const deactivated = await deactivateOldSlates();
            if (deactivated > 0) log(`Startup: deactivated ${deactivated} stale slate(s)`, "cron");
          } catch (err) {
            console.error("Startup slate deactivation failed:", err);
          }

          try {
            const statusUpdated = await refreshPlayerStatuses();
            if (statusUpdated && statusUpdated > 0) log(`Startup status refresh: updated ${statusUpdated} player(s)`, "cron");
          } catch (err) {
            console.error("Startup status refresh failed:", err);
          }

          for (const sport of ["NBA", "NHL", "MLB", "NFL"]) {
            try {
              await refreshRecentlyPlayed(sport);
            } catch {}
          }

          try {
            const snapshotted = await storage.backfillPlayerSnapshots();
            if (snapshotted > 0) log(`Backfilled player snapshots for ${snapshotted} lineup(s)`, "cron");
          } catch (err) {
            console.error("Startup player snapshot backfill failed:", err);
          }
          const ppSports = getSupportedPPSports();
          for (const sport of ppSports) {
            try {
              const projs = await fetchPrizePicksProjections(sport);
              if (projs.length > 0) log(`PrizePicks ${sport}: cached ${projs.length} projections`, "cron");
            } catch {}
          }
          log("PrizePicks cache pre-warm completed", "cron");

          try {
            await runScoutForAllSports(async (sport: string) => {
              const allSlates = await storage.getSlates();
              let sportSlates = allSlates.filter(
                (s: any) => s.sport?.toUpperCase() === sport && s.platform === "draftkings" && s.isActive !== false
              );
              if (sportSlates.length === 0) {
                sportSlates = allSlates.filter(
                  (s: any) => s.sport?.toUpperCase() === sport && s.isActive !== false
                );
              }
              if (sportSlates.length === 0) return [];
              sportSlates.sort((a: any, b: any) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
              const latestSlate = sportSlates[0];
              const slatePlayers = await storage.getPlayersBySlate(latestSlate.id);
              return slatePlayers.map((p: any) => ({
                name: p.name,
                team: p.team || "",
                position: p.position || "",
                salary: p.salary || 0,
                fppg: p.projectedPoints || null,
              }));
            });
            log("AI Scout startup refresh completed", "cron");
          } catch (err) {
            console.error("AI Scout startup refresh failed:", err);
          }
        } catch (err) {
          console.error("Startup initialization failed:", err);
        }
      })();

      cron.schedule("30 * * * *", async () => {
        try {
          log("Starting scheduled seed data refresh", "cron");
          const expiredCount = await storage.deleteExpiredLineups();
          if (expiredCount > 0) log(`Moved ${expiredCount} expired lineup(s) to review`, "cron");
          await seedDatabase(true);
          for (const sport of ["NBA", "NHL", "MLB", "NFL"]) {
            try {
              await refreshRecentlyPlayed(sport);
            } catch {}
          }
          const today = getEasternToday();
          await generateDailyProps(today);
          const ppSports = getSupportedPPSports();
          for (const sport of ppSports) {
            try {
              const projs = await fetchPrizePicksProjections(sport);
              if (projs.length > 0) log(`PrizePicks ${sport}: refreshed ${projs.length} projections`, "cron");
            } catch {}
          }
          try {
            await runScoutForAllSports(async (sport: string) => {
              const allSlates = await storage.getSlates();
              let sportSlates = allSlates.filter(
                (s: any) => s.sport?.toUpperCase() === sport && s.platform === "draftkings" && s.isActive !== false
              );
              if (sportSlates.length === 0) {
                sportSlates = allSlates.filter(
                  (s: any) => s.sport?.toUpperCase() === sport && s.isActive !== false
                );
              }
              if (sportSlates.length === 0) return [];
              sportSlates.sort((a: any, b: any) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
              const latestSlate = sportSlates[0];
              const slatePlayers = await storage.getPlayersBySlate(latestSlate.id);
              return slatePlayers.map((p: any) => ({
                name: p.name,
                team: p.team || "",
                position: p.position || "",
                salary: p.salary || 0,
                fppg: p.projectedPoints || null,
              }));
            });
            log("AI Scout hourly refresh completed", "cron");
          } catch (err) {
            console.error("AI Scout hourly refresh failed:", err);
          }

          try {
            const lineupsResult = await fetchStartingLineups();
            if (lineupsResult.playersMatched > 0) {
              log(`Lineups.com sync: ${lineupsResult.playersMatched} starters matched, ${lineupsResult.confirmedLineups} confirmed, ${lineupsResult.projectionUpdates} proj updates`, "cron");
            }
          } catch (err) {
            console.error("Lineups.com sync failed:", err);
          }

          log("Scheduled seed data refresh + props + PrizePicks + Scout + Lineups completed", "cron");
        } catch (err) {
          console.error("Scheduled seed refresh failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled hourly seed refresh at :30 past each hour (EST)", "cron");

      cron.schedule("0 * * * *", async () => {
        try {
          const updated = await refreshPlayerStatuses();
          if (updated && updated > 0) log(`Hourly status refresh: updated ${updated} player(s)`, "cron");
        } catch (err) {
          console.error("Hourly status refresh failed:", err);
        }
        try {
          const deactivated = await deactivateOldSlates();
          if (deactivated > 0) log(`Deactivated ${deactivated} stale slate(s) (start_time > ${SLATE_GRACE_HOURS}h ago)`, "cron");
        } catch (err) {
          console.error("Slate deactivation failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled hourly player status/injury refresh at :00 past each hour (EST)", "cron");

      cron.schedule("*/5 * * * *", async () => {
        try {
          const now = new Date();
          const allSlates = await storage.getSlates();
          const upcoming = allSlates.filter(s => {
            if (!s.isMain || !s.draftGroupId) return false;
            const start = new Date(s.startTime);
            const msUntil = start.getTime() - now.getTime();
            return msUntil > 0 && msUntil <= 60 * 60 * 1000;
          });

          if (upcoming.length > 0) {
            const sports = upcoming.map(s => s.sport).join(", ");
            const updated = await refreshPlayerStatuses();
            if (updated && updated > 0) {
              log(`Pre-contest status refresh (${sports}): updated ${updated} player(s)`, "cron");
            }
          }
        } catch (err) {
          console.error("Pre-contest status refresh failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled pre-contest status refresh (every 5 min within 1 hour of lock)", "cron");

      cron.schedule("0,30 * * * *", async () => {
        try {
          await refreshLineupScores();
        } catch (err) {
          console.error("Lineup score refresh failed:", err);
        }
      }, { timezone: "America/New_York" });
      log("Scheduled lineup score refresh every 30 minutes", "cron");

      cron.schedule("0 3 * * *", async () => {
        try {
          const expired = await storage.getExpiredGraceSubscriptions();
          for (const sub of expired) {
            const user = await storage.getUser(sub.userId);
            if (user?.isAdmin) continue;
            await storage.upsertSubscription({
              userId: sub.userId,
              tier: "free",
              status: "active",
              graceEndsAt: null,
            });
          }
          if (expired.length > 0) {
            log(`Grace period cron: reverted ${expired.length} user(s) to free`, "stripe");
          }
        } catch (err) {
          console.error("Grace period cron failed:", err);
        }
      }, { timezone: "America/New_York" });
      log("Scheduled 3 AM ET grace period expiration cron job", "cron");

      cron.schedule("0 2 * * *", async () => {
        try {
          log("Starting 2 AM vault reset: moving expired lineups to review", "cron");
          const now = new Date();
          const expiredSlateIds = (await storage.getSlates())
            .filter(s => new Date(s.startTime) < now)
            .map(s => s.id);
          if (expiredSlateIds.length > 0) {
            const moved = await storage.moveLineupsToReview(expiredSlateIds);
            if (moved > 0) log(`Moved ${moved} expired lineup(s) to review status`, "cron");
          }
          const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const deleted = await storage.deleteOldReviewLineups(cutoff);
          if (deleted > 0) log(`Deleted ${deleted} review lineup(s) older than 24 hours`, "cron");
          try {
            const ppCleared = await storage.deleteAllPrizePicksEntries();
            if (ppCleared > 0) log(`Cleared ${ppCleared} PrizePicks vault entries`, "cron");
          } catch (ppErr) {
            console.error("PrizePicks vault clear failed:", ppErr);
          }
          log("2 AM vault reset completed", "cron");
        } catch (err) {
          console.error("2 AM vault reset failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled 2 AM ET vault reset cron job", "cron");

      cron.schedule("30 3 * * *", async () => {
        try {
          log("Starting winning lineup analysis", "cron");
          const results = await runNightlyAnalysis();
          results.forEach(r => log(`[WinningAgent] ${r}`, "cron"));
        } catch (err) {
          console.error("Winning lineup analysis failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled 3:30 AM ET winning lineup analysis cron job", "cron");

      cron.schedule("0 4 * * *", async () => {
        try {
          const cleaned = await storage.cleanOldPlayerHistory(90);
          if (cleaned > 0) log(`Cleaned ${cleaned} player history records older than 90 days`, "cron");
        } catch (err) {
          console.error("Player history cleanup failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled 4 AM ET player history cleanup cron job", "cron");

      cron.schedule("30 4 * * *", async () => {
        try {
          log("Starting nightly DK winning lineup backfill (14 days)", "cron");
          const { runNightlyDKBackfill } = await import("./winning-lineup-agent");
          const results = await runNightlyDKBackfill();
          results.forEach(r => log(`[DKBackfill] ${r}`, "cron"));
          log(`DK backfill complete — ${results.length} action(s)`, "cron");
        } catch (err) {
          console.error("DK winning lineup backfill failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled 4:30 AM ET nightly DK winning lineup backfill (14 days)", "cron");

      startIngestScheduler();
    },
  );
})();
