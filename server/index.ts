import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, seedDatabase, generateDailyProps } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cron from "node-cron";
import { storage } from "./storage";
import { fetchPrizePicksProjections, getSupportedPPSports } from "./prizepicks";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { users } from "@shared/models/auth";
import { subscriptions } from "@shared/schema";
import { eq, and, ne, isNull, isNotNull } from "drizzle-orm";

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
          await seedDatabase();
          log("Startup seed check completed", "cron");
          const ppSports = getSupportedPPSports();
          for (const sport of ppSports) {
            try {
              const projs = await fetchPrizePicksProjections(sport);
              if (projs.length > 0) log(`PrizePicks ${sport}: cached ${projs.length} projections`, "cron");
            } catch {}
          }
          log("PrizePicks cache pre-warm completed", "cron");
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
          const today = new Date().toISOString().split("T")[0];
          await generateDailyProps(today);
          const ppSports = getSupportedPPSports();
          for (const sport of ppSports) {
            try {
              const projs = await fetchPrizePicksProjections(sport);
              if (projs.length > 0) log(`PrizePicks ${sport}: refreshed ${projs.length} projections`, "cron");
            } catch {}
          }
          log("Scheduled seed data refresh + props + PrizePicks completed", "cron");
        } catch (err) {
          console.error("Scheduled seed refresh failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled hourly seed refresh at :30 past each hour (EST)", "cron");

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
          log("2 AM vault reset completed", "cron");
        } catch (err) {
          console.error("2 AM vault reset failed:", err);
        }
      }, {
        timezone: "America/New_York",
      });
      log("Scheduled 2 AM ET vault reset cron job", "cron");
    },
  );
})();
