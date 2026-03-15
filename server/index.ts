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
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { subscriptions, slates } from "@shared/schema";
import { eq, and, ne, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { showdownRouter } from "./showdown-route";
import { ingestRouter, startIngestScheduler } from "./routes/ingest";

const SLATE_GRACE_HOURS = 3;

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

          const snapshotted = await storage.backfillPlayerSnapshots();
          if (snapshotted > 0) log(`Backfilled player snapshots for ${snapshotted} lineup(s)`, "cron");
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
              const sportSlates = allSlates.filter(
                (s: any) => s.sport?.toUpperCase() === sport && s.platform === "draftkings" && s.isActive !== false
              );
              if (sportSlates.length === 0) return [];
              const latestSlate = sportSlates[sportSlates.length - 1];
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
              const sportSlates = allSlates.filter(
                (s: any) => s.sport?.toUpperCase() === sport && s.platform === "draftkings" && s.isActive !== false
              );
              if (sportSlates.length === 0) return [];
              const latestSlate = sportSlates[sportSlates.length - 1];
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

      startIngestScheduler();
    },
  );
})();
