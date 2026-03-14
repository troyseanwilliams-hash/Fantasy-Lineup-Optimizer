// ============================================================
// server/routes/ingest.ts
//
// Admin endpoints for triggering FanDuel and Yahoo slate
// ingestion. Mount in your main Express app:
//
//   import { ingestRouter } from "./routes/ingest";
//   app.use(ingestRouter);
//
// ENDPOINTS:
//
//   POST /api/admin/ingest/fanduel              Trigger FD ingest for all sports
//   POST /api/admin/ingest/fanduel/:sport       Trigger FD ingest for one sport
//   POST /api/admin/ingest/yahoo                Trigger Yahoo ingest for all sports
//   POST /api/admin/ingest/yahoo/:sport         Trigger Yahoo ingest for one sport
//   POST /api/admin/ingest/yahoo/:sport/csv     Upload Yahoo CSV for a sport
//   POST /api/admin/ingest/all                  Trigger all platforms (DK + FD + Yahoo)
//   GET  /api/admin/ingest/status               Last ingest results per platform/sport
//
// SECURITY:
//   All routes require admin (isAdmin === true on the session user).
//   An ADMIN_INGEST_KEY env var is also accepted as a bearer
//   token for server-to-server calls from cron jobs.
//
// SCHEDULED REFRESH:
//   Call startIngestScheduler() once at server startup to
//   automatically refresh slates at configurable intervals.
//   Defaults: every 4 hours during the day, once at midnight.
// ============================================================

import { Router, Request, Response } from "express";
import multer from "multer";
import {
  ingestFanDuelSlate,
  ingestAllFanDuelSlates,
  type FDSport,
} from "../fanduel-ingest";
import {
  ingestYahooSlate,
  ingestAllYahooSlates,
  ingestYahooCSV,
  type YahooSport,
} from "../yahoo-ingest";
import { storage } from "../storage";

export const ingestRouter = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireAdminOrKey(req: Request, res: Response, next: Function) {
  // Session-based admin check
  const user = (req as any).user;
  if (user?.isAdmin === true) return next();

  // Bearer token for server-to-server / cron calls
  const key = process.env.ADMIN_INGEST_KEY;
  if (key) {
    const auth = req.headers.authorization || "";
    if (auth === `Bearer ${key}`) return next();
  }

  return res.status(401).json({ message: "Admin access required" });
}

// ── Status tracking — in-memory last-run log ─────────────────────────────────

interface IngestStatus {
  platform: string;
  sport: string;
  lastRun: string;
  success: boolean;
  message: string;
  playerCount?: number;
  slateId?: number;
}

const ingestStatusLog: IngestStatus[] = [];

function recordStatus(status: Omit<IngestStatus, "lastRun">) {
  const entry: IngestStatus = { ...status, lastRun: new Date().toISOString() };
  const existing = ingestStatusLog.findIndex(
    s => s.platform === status.platform && s.sport === status.sport
  );
  if (existing >= 0) ingestStatusLog[existing] = entry;
  else ingestStatusLog.push(entry);
}

// ── Multer for CSV uploads ────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_FD_SPORTS: FDSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];
const VALID_YAHOO_SPORTS: YahooSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];

function isValidFDSport(s: string): s is FDSport {
  return VALID_FD_SPORTS.includes(s.toUpperCase() as FDSport);
}

function isValidYahooSport(s: string): s is YahooSport {
  return VALID_YAHOO_SPORTS.includes(s.toUpperCase() as YahooSport);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/admin/ingest/status
ingestRouter.get("/api/admin/ingest/status", requireAdminOrKey, (_req, res) => {
  res.json({
    log: ingestStatusLog,
    env: {
      hasFdSessionCookie: !!process.env.FD_SESSION_COOKIE,
      hasSportsDataKey: !!process.env.SPORTSDATA_API_KEY,
      hasYahooClientId: !!process.env.YAHOO_CLIENT_ID,
      hasYahooAccessToken: !!process.env.YAHOO_ACCESS_TOKEN,
    },
  });
});

// POST /api/admin/ingest/fanduel — all FD sports
ingestRouter.post("/api/admin/ingest/fanduel", requireAdminOrKey, async (_req, res) => {
  console.log("[IngestRoute] Triggered: ingest all FanDuel slates");
  try {
    const results = await ingestAllFanDuelSlates();
    for (const [sport, r] of Object.entries(results)) {
      recordStatus({ platform: "fanduel", sport, success: r.success, message: r.message });
    }
    res.json({ results });
  } catch (err: any) {
    console.error("[IngestRoute] FanDuel all-sport ingest error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ingest/fanduel/:sport — single FD sport
ingestRouter.post("/api/admin/ingest/fanduel/:sport", requireAdminOrKey, async (req, res) => {
  const raw = req.params.sport.toUpperCase();
  if (!isValidFDSport(raw)) {
    return res.status(400).json({ message: `Invalid sport. Must be one of: ${VALID_FD_SPORTS.join(", ")}` });
  }
  const sport = raw as FDSport;
  console.log(`[IngestRoute] Triggered: ingest FanDuel ${sport}`);
  try {
    const result = await ingestFanDuelSlate(sport);
    recordStatus({ platform: "fanduel", sport, ...result });
    res.json(result);
  } catch (err: any) {
    console.error(`[IngestRoute] FanDuel ${sport} ingest error:`, err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ingest/yahoo — all Yahoo sports
ingestRouter.post("/api/admin/ingest/yahoo", requireAdminOrKey, async (_req, res) => {
  console.log("[IngestRoute] Triggered: ingest all Yahoo slates");
  try {
    const results = await ingestAllYahooSlates();
    for (const [sport, r] of Object.entries(results)) {
      recordStatus({ platform: "yahoo", sport, success: r.success, message: r.message });
    }
    res.json({ results });
  } catch (err: any) {
    console.error("[IngestRoute] Yahoo all-sport ingest error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ingest/yahoo/:sport — single Yahoo sport
ingestRouter.post("/api/admin/ingest/yahoo/:sport", requireAdminOrKey, async (req, res) => {
  const raw = req.params.sport.toUpperCase();
  if (!isValidYahooSport(raw)) {
    return res.status(400).json({ message: `Invalid sport. Must be one of: ${VALID_YAHOO_SPORTS.join(", ")}` });
  }
  const sport = raw as YahooSport;
  console.log(`[IngestRoute] Triggered: ingest Yahoo ${sport}`);
  try {
    const result = await ingestYahooSlate(sport);
    recordStatus({ platform: "yahoo", sport, ...result });
    res.json(result);
  } catch (err: any) {
    console.error(`[IngestRoute] Yahoo ${sport} ingest error:`, err.message);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/ingest/yahoo/:sport/csv — upload Yahoo CSV for a sport
ingestRouter.post(
  "/api/admin/ingest/yahoo/:sport/csv",
  requireAdminOrKey,
  upload.single("file"),
  async (req, res) => {
    const raw = req.params.sport.toUpperCase();
    if (!isValidYahooSport(raw)) {
      return res.status(400).json({ message: `Invalid sport` });
    }
    const sport = raw as YahooSport;

    if (!req.file) {
      return res.status(400).json({ message: "No CSV file uploaded. Use multipart/form-data with field name 'file'." });
    }

    const csvText = req.file.buffer.toString("utf-8");
    console.log(`[IngestRoute] Yahoo ${sport} CSV upload: ${req.file.originalname} (${req.file.size} bytes)`);

    try {
      const result = await ingestYahooCSV(csvText, sport);
      recordStatus({ platform: "yahoo", sport, ...result });
      res.json(result);
    } catch (err: any) {
      console.error(`[IngestRoute] Yahoo ${sport} CSV ingest error:`, err.message);
      res.status(500).json({ message: err.message });
    }
  }
);

// POST /api/admin/ingest/all — trigger all platforms
ingestRouter.post("/api/admin/ingest/all", requireAdminOrKey, async (_req, res) => {
  console.log("[IngestRoute] Triggered: ingest all platforms");
  try {
    const [fdResults, yahooResults] = await Promise.allSettled([
      ingestAllFanDuelSlates(),
      ingestAllYahooSlates(),
    ]);

    if (fdResults.status === "fulfilled") {
      for (const [sport, r] of Object.entries(fdResults.value)) {
        recordStatus({ platform: "fanduel", sport, success: r.success, message: r.message });
      }
    }
    if (yahooResults.status === "fulfilled") {
      for (const [sport, r] of Object.entries(yahooResults.value)) {
        recordStatus({ platform: "yahoo", sport, success: r.success, message: r.message });
      }
    }

    res.json({
      fanduel: fdResults.status === "fulfilled" ? fdResults.value : { error: (fdResults as any).reason?.message },
      yahoo: yahooResults.status === "fulfilled" ? yahooResults.value : { error: (yahooResults as any).reason?.message },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ── Scheduled auto-refresh ────────────────────────────────────────────────────

let schedulerStarted = false;

/**
 * Call once at server startup to auto-refresh FD + Yahoo slates.
 *
 * Schedule:
 *   - Every 4 hours between 8 AM – midnight ET (when slates are live)
 *   - Once at 6 AM ET (pre-lock projections refresh)
 *
 * Override with:
 *   INGEST_INTERVAL_MS — polling interval in ms (default: 4 * 60 * 60 * 1000)
 */
export function startIngestScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = parseInt(process.env.INGEST_INTERVAL_MS || "") ||
    4 * 60 * 60 * 1000; // 4 hours

  console.log(`[IngestScheduler] Started — refreshing FD + Yahoo every ${intervalMs / 60000} minutes`);

  const runIngest = async () => {
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = nowET.getHours();

    // Only ingest during active DFS hours (6 AM – midnight ET)
    if (hour < 6 || hour >= 24) {
      console.log(`[IngestScheduler] Skipping off-hours ingest (ET hour: ${hour})`);
      return;
    }

    console.log(`[IngestScheduler] Running scheduled ingest at ${nowET.toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`);

    const [fdResults, yahooResults] = await Promise.allSettled([
      ingestAllFanDuelSlates(),
      ingestAllYahooSlates(),
    ]);

    if (fdResults.status === "fulfilled") {
      for (const [sport, r] of Object.entries(fdResults.value)) {
        recordStatus({ platform: "fanduel", sport, success: r.success, message: r.message });
        if (!r.success) console.warn(`[IngestScheduler] FD ${sport}: ${r.message}`);
      }
    }
    if (yahooResults.status === "fulfilled") {
      for (const [sport, r] of Object.entries(yahooResults.value)) {
        recordStatus({ platform: "yahoo", sport, success: r.success, message: r.message });
        if (!r.success) console.warn(`[IngestScheduler] Yahoo ${sport}: ${r.message}`);
      }
    }
  };

  // Run once immediately on startup (non-blocking)
  runIngest().catch(err => console.error("[IngestScheduler] Startup ingest error:", err.message));

  // Then on interval
  setInterval(() => {
    runIngest().catch(err => console.error("[IngestScheduler] Scheduled ingest error:", err.message));
  }, intervalMs);
}
