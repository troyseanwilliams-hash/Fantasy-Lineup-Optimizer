import type { Express, Request, Response } from "express";
import { randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  contestResults,
  referralCodes,
  referralRedemptions,
  type Player,
  type Slate,
  type Subscription,
} from "@shared/schema";
import { getPlatformConfig, type Platform } from "@shared/platform-config";
import { getDraftKingsStartMarker, sanitizeGameInfo } from "@shared/game-info";
import { PASSES, isPassId } from "@shared/plans";
import { parseEasternTime } from "./balldontlie";

function sessionUserId(req: Request): string | null {
  return (req.session as any)?.userId || null;
}

/** Returns a message when a single-sport plan does not cover `sport`, otherwise null. */
export function sportScopeViolation(sub: Subscription | undefined | null, sport: string): string | null {
  const scope = sub?.sportScope;
  if (!scope) return null;
  if (scope.toUpperCase() === String(sport).toUpperCase()) return null;
  return `Your ${scope} plan covers ${scope} only. Upgrade to Sharpshooter to use ${sport}.`;
}

interface Access {
  userId: string;
  isAdmin: boolean;
  tier: string;
}

async function loadAccess(req: Request): Promise<Access | null> {
  const userId = sessionUserId(req);
  if (!userId) return null;
  const [sub, user] = await Promise.all([storage.getSubscription(userId), storage.getUser(userId)]);
  const isAdmin = user?.isAdmin === true;
  return { userId, isAdmin, tier: isAdmin ? "pro" : sub?.tier || "free" };
}

/** Champion-only features (tracker, late swap). */
async function requireChampion(req: Request, res: Response): Promise<Access | null> {
  const access = await loadAccess(req);
  if (!access) {
    res.sendStatus(401);
    return null;
  }
  if (access.tier !== "pro") {
    res.status(403).json({ message: "This tool is part of the Champion plan.", requiresUpgrade: true });
    return null;
  }
  return access;
}

// ---------------------------------------------------------------------------
// Referral codes
// ---------------------------------------------------------------------------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function getOrCreateReferralCode(userId: string): Promise<string> {
  const [existing] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
  if (existing) return existing.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const inserted = await db.insert(referralCodes).values({ userId, code }).onConflictDoNothing().returning();
    if (inserted.length > 0) return inserted[0].code;
    // Either our code collided or another request created this user's row first.
    const [again] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
    if (again) return again.code;
  }
  throw new Error("Could not create referral code");
}

// ---------------------------------------------------------------------------
// Tracker CSV rows
// ---------------------------------------------------------------------------
const money = z.number().finite().min(0).max(1_000_000);

const trackerRowSchema = z.object({
  entryKey: z.string().min(1).max(120),
  sport: z.string().max(20).default("OTHER"),
  gameType: z.string().max(60).nullish(),
  contestName: z.string().max(300).nullish(),
  contestDate: z.string().max(40).nullish(),
  entryFee: money,
  winnings: money,
  place: z.number().int().min(0).max(100_000_000).nullish(),
  points: z.number().finite().nullish(),
  contestEntries: z.number().int().min(0).max(100_000_000).nullish(),
});

const importSchema = z.object({ rows: z.array(trackerRowSchema).min(1).max(5000) });

const manualSchema = z.object({
  sport: z.string().max(20).default("OTHER"),
  contestName: z.string().max(300).default("Manual entry"),
  contestDate: z.string().max(40).nullish(),
  entryFee: money,
  winnings: money,
});

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ---------------------------------------------------------------------------
// Late swap helpers
// ---------------------------------------------------------------------------
function playerGameStart(player: Player, slate: Slate): Date | null {
  const marker = getDraftKingsStartMarker(player.gameInfo);
  if (marker) {
    try {
      const exact = parseEasternTime(marker);
      if (Number.isFinite(exact.getTime())) return exact;
    } catch {
      // fall through to the display-time parser
    }
  }
  const match = String(player.gameInfo || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i);
  if (!match) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(slate.startTime));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  let hour = Number(match[1]);
  if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  const start = parseEasternTime(`${get("year")}-${get("month")}-${get("day")}T${String(hour).padStart(2, "0")}:${match[2]}:00`);
  return Number.isFinite(start.getTime()) ? start : null;
}

function isOut(player: Player): boolean {
  return /\bout\b/i.test(String(player.injuryStatus || ""));
}

function trimPlayer(p: Player, locked: boolean, start: Date | null) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.position,
    salary: p.salary,
    projectedPoints: Number(p.projectedPoints),
    opponent: p.opponent,
    game: sanitizeGameInfo(p.gameInfo),
    injuryStatus: p.injuryStatus,
    locked,
    gameStart: start ? start.toISOString() : null,
  };
}

export function registerRevenueRoutes(app: Express): void {
  // ── One-time passes ────────────────────────────────────────────────────────
  app.post("/api/subscription/pass-checkout", async (req, res) => {
    const userId = sessionUserId(req);
    if (!userId) return res.sendStatus(401);
    const passId = req.body?.passId;
    if (!isPassId(passId)) return res.status(400).json({ message: "Unknown pass" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    try {
      const { createPassCheckoutSession } = await import("./stripe");
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const baseUrl = `${protocol}://${req.headers.host}`;
      const url = await createPassCheckoutSession(
        userId,
        user.email || "",
        passId,
        `${baseUrl}/pricing?pass_success=${PASSES[passId].id}`,
        `${baseUrl}/pricing?canceled=true`,
      );
      res.json({ url });
    } catch (err: any) {
      console.error("[pass] checkout error:", err);
      res.status(400).json({ message: err?.message || "Could not start checkout" });
    }
  });

  // ── Referrals ──────────────────────────────────────────────────────────────
  app.get("/api/referral", async (req, res) => {
    const userId = sessionUserId(req);
    if (!userId) return res.sendStatus(401);
    try {
      const code = await getOrCreateReferralCode(userId);
      const rows = await db.select({
        status: referralRedemptions.status,
        count: sql<number>`count(*)::int`,
      }).from(referralRedemptions).where(eq(referralRedemptions.referrerId, userId)).groupBy(referralRedemptions.status);
      const stats = { pending: 0, rewarded: 0 };
      for (const r of rows) {
        if (r.status === "pending") stats.pending = r.count;
        if (r.status === "rewarded") stats.rewarded = r.count;
      }
      res.json({ code, ...stats });
    } catch (err) {
      console.error("[referral] load failed:", err);
      res.status(500).json({ message: "Could not load referral info" });
    }
  });

  app.post("/api/referral/redeem", async (req, res) => {
    const userId = sessionUserId(req);
    if (!userId) return res.sendStatus(401);
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6,12}$/.test(code)) return res.status(400).json({ message: "Invalid code" });
    try {
      const [owner] = await db.select().from(referralCodes).where(eq(referralCodes.code, code));
      if (!owner) return res.status(404).json({ message: "Referral code not found" });
      if (owner.userId === userId) return res.status(400).json({ message: "You cannot use your own code" });

      const sub = await storage.getSubscription(userId);
      if (sub?.stripeSubscriptionId) {
        return res.status(400).json({ message: "Referral codes are for new subscribers only" });
      }
      const inserted = await db.insert(referralRedemptions)
        .values({ referrerId: owner.userId, referredId: userId })
        .onConflictDoNothing()
        .returning();
      res.json({ ok: true, alreadyRedeemed: inserted.length === 0 });
    } catch (err) {
      console.error("[referral] redeem failed:", err);
      res.status(500).json({ message: "Could not apply referral code" });
    }
  });

  // ── Bankroll tracker (Champion) ────────────────────────────────────────────
  app.get("/api/tracker", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    const rows = await db.select().from(contestResults)
      .where(eq(contestResults.userId, access.userId))
      .orderBy(desc(contestResults.contestDate))
      .limit(5000);
    res.json({
      rows: rows.map(r => ({
        id: r.id,
        sport: r.sport,
        gameType: r.gameType,
        contestName: r.contestName,
        contestDate: r.contestDate ? r.contestDate.toISOString() : null,
        entryFee: Number(r.entryFee),
        winnings: Number(r.winnings),
        place: r.place,
        points: r.points == null ? null : Number(r.points),
        contestEntries: r.contestEntries,
        source: r.source,
      })),
    });
  });

  app.post("/api/tracker/import", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid import data" });
    }
    try {
      const values = parsed.data.rows.map(r => ({
        userId: access.userId,
        entryKey: r.entryKey,
        sport: r.sport.toUpperCase(),
        gameType: r.gameType ?? null,
        contestName: r.contestName ?? null,
        contestDate: parseDate(r.contestDate),
        entryFee: String(r.entryFee),
        winnings: String(r.winnings),
        place: r.place ?? null,
        points: r.points == null ? null : String(r.points),
        contestEntries: r.contestEntries ?? null,
        source: "dk_csv",
      }));
      let inserted = 0;
      for (let i = 0; i < values.length; i += 500) {
        const chunk = values.slice(i, i + 500);
        const done = await db.insert(contestResults).values(chunk).onConflictDoNothing().returning({ id: contestResults.id });
        inserted += done.length;
      }
      res.json({ received: values.length, inserted, duplicates: values.length - inserted });
    } catch (err) {
      console.error("[tracker] import failed:", err);
      res.status(500).json({ message: "Import failed" });
    }
  });

  app.post("/api/tracker/entry", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    const parsed = manualSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid entry" });
    }
    const d = parsed.data;
    const [row] = await db.insert(contestResults).values({
      userId: access.userId,
      entryKey: `manual-${randomUUID()}`,
      sport: d.sport.toUpperCase(),
      contestName: d.contestName,
      contestDate: parseDate(d.contestDate) ?? new Date(),
      entryFee: String(d.entryFee),
      winnings: String(d.winnings),
      source: "manual",
    }).returning({ id: contestResults.id });
    res.json({ ok: true, id: row.id });
  });

  app.delete("/api/tracker/:id", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });
    await db.delete(contestResults).where(and(eq(contestResults.id, id), eq(contestResults.userId, access.userId)));
    res.json({ ok: true });
  });

  app.delete("/api/tracker", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    await db.delete(contestResults).where(eq(contestResults.userId, access.userId));
    res.json({ ok: true });
  });

  // ── Late swap (Champion) ───────────────────────────────────────────────────
  // Keeps every player whose game has started and re-optimizes only the open slots.
  app.post("/api/late-swap", async (req, res) => {
    const access = await requireChampion(req, res);
    if (!access) return;
    try {
      const lineupId = Number(req.body?.lineupId);
      if (!Number.isInteger(lineupId)) return res.status(400).json({ message: "lineupId is required" });

      const lineup = await storage.getLineup(lineupId);
      if (!lineup || lineup.userId !== access.userId) return res.status(404).json({ message: "Lineup not found" });
      const slate = await storage.getSlate(lineup.slateId);
      if (!slate) return res.status(404).json({ message: "Slate not found" });

      const platform = (lineup.platform || slate.platform || "draftkings") as Platform;
      const config = getPlatformConfig(slate.sport, platform);
      if (lineup.playerIds.length !== config.rosterSize) {
        return res.status(400).json({ message: "Late swap supports classic lineups only." });
      }

      const players = await storage.getPlayersBySlate(slate.id);
      const byId = new Map(players.map(p => [p.id, p]));
      const current = lineup.playerIds.map(id => byId.get(id));
      if (current.some(p => !p)) {
        return res.status(400).json({ message: "Some players in this lineup are no longer on the slate." });
      }
      const currentPlayers = current as Player[];

      const now = Date.now();
      const startOf = new Map<number, Date | null>(players.map(p => [p.id, playerGameStart(p, slate)]));
      const hasStarted = (p: Player) => {
        const s = startOf.get(p.id);
        return !!s && s.getTime() <= now;
      };

      const lockedIds = currentPlayers.filter(hasStarted).map(p => p.id);
      const lockedSet = new Set(lockedIds);
      const openSlots = currentPlayers.length - lockedIds.length;

      const baseProjection = currentPlayers.reduce((sum, p) => sum + Number(p.projectedPoints), 0);
      const baseSalary = currentPlayers.reduce((sum, p) => sum + p.salary, 0);
      const originalView = currentPlayers.map(p => trimPlayer(p, lockedSet.has(p.id), startOf.get(p.id) ?? null));

      if (openSlots === 0) {
        return res.json({
          message: "Every game in this lineup has started, so there is nothing left to swap.",
          original: originalView,
          suggested: originalView,
          swaps: [],
          projectionBefore: baseProjection,
          projectionAfter: baseProjection,
          gain: 0,
          lockedCount: lockedIds.length,
        });
      }

      const excludedPlayerIds = players
        .filter(p => !lockedSet.has(p.id) && (hasStarted(p) || isOut(p)))
        .map(p => p.id);

      const { solveLineup } = await import("./routes");
      const result: any = solveLineup(
        players,
        {
          slateId: slate.id,
          platform,
          lockedPlayerIds: lockedIds,
          excludedPlayerIds,
          playerProjections: {},
          contestType: "cash",
          outperformerMode: false,
          deterministicObjective: true,
        } as any,
        slate.sport,
        platform,
        undefined,
        { deadline: Date.now() + 12_000, timeoutMs: 8_000 } as any,
      );

      if (result.error || !Array.isArray(result.lineup) || result.lineup.length !== config.rosterSize) {
        return res.status(400).json({
          message: result.error || "No valid swap exists with the players still available.",
        });
      }

      const suggestedPlayers: Player[] = result.lineup;
      const currentIds = new Set(currentPlayers.map(p => p.id));
      const suggestedIds = new Set(suggestedPlayers.map(p => p.id));
      const outgoing = currentPlayers.filter(p => !suggestedIds.has(p.id));
      const incoming = suggestedPlayers.filter(p => !currentIds.has(p.id));

      // Pair each outgoing player with an incoming one at the same position where possible.
      const remaining = [...incoming];
      const swaps = outgoing.map(out => {
        const idx = remaining.findIndex(p => p.position === out.position);
        const pick = idx >= 0 ? remaining.splice(idx, 1)[0] : remaining.shift();
        return {
          out: trimPlayer(out, false, startOf.get(out.id) ?? null),
          in: pick ? trimPlayer(pick, false, startOf.get(pick.id) ?? null) : null,
        };
      });

      const afterProjection = suggestedPlayers.reduce((sum, p) => sum + Number(p.projectedPoints), 0);
      res.json({
        message: swaps.length === 0 ? "Your open slots are already the best available options." : undefined,
        original: originalView,
        suggested: suggestedPlayers.map(p => trimPlayer(p, lockedSet.has(p.id), startOf.get(p.id) ?? null)),
        swaps,
        projectionBefore: baseProjection,
        projectionAfter: afterProjection,
        gain: afterProjection - baseProjection,
        salaryBefore: baseSalary,
        salaryAfter: suggestedPlayers.reduce((sum, p) => sum + p.salary, 0),
        lockedCount: lockedIds.length,
      });
    } catch (err) {
      console.error("[late-swap] failed:", err);
      res.status(500).json({ message: "Late swap failed" });
    }
  });
}
