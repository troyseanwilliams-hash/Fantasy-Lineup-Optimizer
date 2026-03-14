// ============================================================
// server/routes/ingest.ts
//
// Admin-only API routes for triggering FanDuel and Yahoo
// data ingestion. These routes are mounted at /api/ingest.
//
// AUTH GUARD:
//   Every route requires one of:
//     1. Active session with an admin user (req.session.userId → user.isAdmin)
//     2. ADMIN_INGEST_KEY header match (for cron/automation callers)
//
// ROUTES:
//   POST /api/ingest/fanduel/:sport       — Ingest a single FD sport
//   POST /api/ingest/fanduel/all          — Ingest all FD sports
//   POST /api/ingest/yahoo/:sport         — Ingest a single Yahoo sport
//   POST /api/ingest/yahoo/all            — Ingest all Yahoo sports
//   POST /api/ingest/yahoo/csv            — Import Yahoo CSV (multipart)
//   GET  /api/ingest/status               — Check data-source config status
//
// CRON SCHEDULER:
//   startIngestScheduler() sets up a daily 5 AM ET cron job
//   that ingests all FD + Yahoo data automatically.
// ============================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import cron from "node-cron";
import { storage } from "../storage";
import { ingestFanDuelSlate, ingestAllFanDuelSlates, type FDSport } from "../fanduel-ingest";
import { ingestYahooSlate, ingestAllYahooSlates, ingestYahooCSV, type YahooSport } from "../yahoo-ingest";

// ── Multer setup (memory storage for CSV upload) ──────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" ||
        file.mimetype === "application/csv" ||
        file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

// ── Auth middleware ────────────────────────────────────────────────────────────

async function requireAdminOrKey(req: Request, res: Response, next: NextFunction) {
  // Path 1: ADMIN_INGEST_KEY header (for cron / external automation)
  const ingestKey = process.env.ADMIN_INGEST_KEY;
  const headerKey = req.headers["x-ingest-key"] as string | undefined;

  if (ingestKey && headerKey === ingestKey) {
    return next();
  }

  // Path 2: Session-based admin check (matches existing app auth pattern)
  const userId = (req.session as any)?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const user = await storage.getUser(userId);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Auth check failed" });
  }
}

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_FD_SPORTS: FDSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];
const VALID_YAHOO_SPORTS: YahooSport[] = ["NBA", "NFL", "MLB", "NHL", "GOLF"];

function isValidFDSport(s: string): s is FDSport {
  return VALID_FD_SPORTS.includes(s.toUpperCase() as FDSport);
}

function isValidYahooSport(s: string): s is YahooSport {
  return VALID_YAHOO_SPORTS.includes(s.toUpperCase() as YahooSport);
}

// ── Router ────────────────────────────────────────────────────────────────────

export const ingestRouter = Router();

// All ingest routes require admin or API key
ingestRouter.use(requireAdminOrKey);

// ── FanDuel ─────────────────────────────────────────────────────────────────

ingestRouter.post("/fanduel/all", async (_req: Request, res: Response) => {
  try {
    const results = await ingestAllFanDuelSlates();
    res.json({ success: true, results });
  } catch (err: any) {
    console.error("[Ingest Route] FD all failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

ingestRouter.post("/fanduel/:sport", async (req: Request, res: Response) => {
  const sport = req.params.sport?.toUpperCase();

  if (!isValidFDSport(sport)) {
    return res.status(400).json({
      error: `Invalid sport: ${sport}. Valid: ${VALID_FD_SPORTS.join(", ")}`,
    });
  }

  try {
    const result = await ingestFanDuelSlate(sport as FDSport);
    res.json(result);
  } catch (err: any) {
    console.error(`[Ingest Route] FD ${sport} failed:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Yahoo ───────────────────────────────────────────────────────────────────

ingestRouter.post("/yahoo/all", async (_req: Request, res: Response) => {
  try {
    const results = await ingestAllYahooSlates();
    res.json({ success: true, results });
  } catch (err: any) {
    console.error("[Ingest Route] Yahoo all failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

ingestRouter.post("/yahoo/csv", upload.single("file"), async (req: Request, res: Response) => {
  const sport = (req.body?.sport || req.query?.sport || "NBA").toString().toUpperCase();

  if (!isValidYahooSport(sport)) {
    return res.status(400).json({
      error: `Invalid sport: ${sport}. Valid: ${VALID_YAHOO_SPORTS.join(", ")}`,
    });
  }

  const file = (req as any).file;
  if (!file || !file.buffer) {
    return res.status(400).json({ error: "No CSV file uploaded. Use multipart field name 'file'." });
  }

  try {
    const csvText = file.buffer.toString("utf-8");
    const result = await ingestYahooCSV(csvText, sport as YahooSport);
    res.json(result);
  } catch (err: any) {
    console.error(`[Ingest Route] Yahoo CSV failed:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

ingestRouter.post("/yahoo/:sport", async (req: Request, res: Response) => {
  const sport = req.params.sport?.toUpperCase();

  if (!isValidYahooSport(sport)) {
    return res.status(400).json({
      error: `Invalid sport: ${sport}. Valid: ${VALID_YAHOO_SPORTS.join(", ")}`,
    });
  }

  try {
    const result = await ingestYahooSlate(sport as YahooSport);
    res.json(result);
  } catch (err: any) {
    console.error(`[Ingest Route] Yahoo ${sport} failed:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Status check ────────────────────────────────────────────────────────────

ingestRouter.get("/status", async (_req: Request, res: Response) => {
  res.json({
    fanduel: {
      sessionCookie: !!process.env.FD_SESSION_COOKIE,
      sportsDataKey: !!process.env.SPORTSDATA_API_KEY,
      configured: !!(process.env.FD_SESSION_COOKIE || process.env.SPORTSDATA_API_KEY),
    },
    yahoo: {
      clientId: !!process.env.YAHOO_CLIENT_ID,
      clientSecret: !!process.env.YAHOO_CLIENT_SECRET,
      accessToken: !!process.env.YAHOO_ACCESS_TOKEN,
      configured: !!(process.env.YAHOO_ACCESS_TOKEN || (process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET)),
    },
    adminIngestKey: !!process.env.ADMIN_INGEST_KEY,
  });
});

// ── Cron Scheduler ──────────────────────────────────────────────────────────

export function startIngestScheduler() {
  // Daily at 5 AM Eastern — ingest FD + Yahoo data for all sports
  cron.schedule("0 5 * * *", async () => {
    console.log("[Ingest Cron] Starting daily FD + Yahoo ingestion…");

    try {
      const fdResults = await ingestAllFanDuelSlates();
      for (const [sport, result] of Object.entries(fdResults)) {
        console.log(`[Ingest Cron] FD ${sport}: ${result.message}`);
      }
    } catch (err: any) {
      console.error("[Ingest Cron] FD ingestion failed:", err.message);
    }

    try {
      const yahooResults = await ingestAllYahooSlates();
      for (const [sport, result] of Object.entries(yahooResults)) {
        console.log(`[Ingest Cron] Yahoo ${sport}: ${result.message}`);
      }
    } catch (err: any) {
      console.error("[Ingest Cron] Yahoo ingestion failed:", err.message);
    }

    console.log("[Ingest Cron] Daily ingestion complete.");
  }, {
    timezone: "America/New_York",
  });

  console.log("[Ingest Cron] Scheduled daily FD + Yahoo ingestion at 5 AM ET");
}
