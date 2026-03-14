import { pgTable, text, serial, integer, boolean, timestamp, numeric, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

// ============================================================
// NUMERIC HELPER
// Drizzle maps `numeric` columns to `string` in TypeScript.
// Always use toNum() when doing math on these fields to avoid
// silent string concatenation bugs.
// ============================================================
export const toNum = (v: string | null | undefined, fallback = 0): number =>
  v != null && v !== "" ? parseFloat(v) : fallback;

// ============================================================
// CONTEST WINNER TYPE
// Used to type the contestWinnerData jsonb column on lineups.
// ============================================================
export interface ContestWinnerData {
  contestId: string;
  contestName: string;
  rank: number;
  totalEntrants: number;
  prize: number;
  winningScore: number;
  settledAt: string; // ISO timestamp string
}

// --- SLATES ---
export const slates = pgTable("slates", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  platform: text("platform").notNull().default("draftkings"),
  name: text("name").notNull(),
  startTime: timestamp("start_time").notNull(),
  isMain: boolean("is_main").notNull().default(true),
  draftGroupId: integer("draft_group_id"),
});

export const insertSlateSchema = createInsertSchema(slates).omit({ id: true });
export type Slate = typeof slates.$inferSelect;
export type InsertSlate = z.infer<typeof insertSlateSchema>;

// --- PLAYERS ---
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  slateId: integer("slate_id").notNull().references(() => slates.id),
  name: text("name").notNull(),
  team: text("team").notNull(),
  position: text("position").notNull(),
  salary: integer("salary").notNull(),
  // numeric columns — use toNum() for all arithmetic
  fppg: numeric("fppg").notNull(),
  projectedPoints: numeric("projected_points").notNull(),
  opponent: text("opponent"),
  gameInfo: text("game_info"),
  injuryStatus: text("injury_status"),
  injuryDetail: text("injury_detail"),
  // boostScore: a multiplier (e.g. 1.15 = 15% boost).
  // See also playerOverrides.boostPercent — kept as integer % there for user input,
  // but stored here as the computed multiplier for optimizer consumption.
  boostScore: numeric("boost_score"),
  boostReason: text("boost_reason"),
  draftKingsPlayerId: integer("draftkings_player_id"),
  isConfirmedStarter: boolean("is_confirmed_starter").default(false),
});

export const insertPlayerSchema = createInsertSchema(players).omit({ id: true });
export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

// --- LINEUPS ---
export const lineups = pgTable("lineups", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  slateId: integer("slate_id").notNull().references(() => slates.id),
  sport: text("sport").notNull(),
  platform: text("platform").notNull().default("draftkings"),
  totalSalary: integer("total_salary").notNull(),
  // numeric column — use toNum() for arithmetic
  totalProjectedPoints: numeric("total_projected_points").notNull(),
  // Array of player IDs. A GIN index is required for efficient player lookups:
  //   CREATE INDEX idx_lineup_player_ids ON lineups USING GIN (player_ids);
  // See migration note at the bottom of this file.
  playerIds: integer("player_ids").array().notNull(),
  name: text("name"),
  status: text("status").notNull().default("active"),
  reviewedAt: timestamp("reviewed_at"),
  // Typed snapshot of player data at lineup creation time.
  playerSnapshot: jsonb("player_snapshot").$type<Player[]>(),
  // Typed contest result data, populated after contest settlement.
  contestWinnerData: jsonb("contest_winner_data").$type<ContestWinnerData>(),
  dkEntryId: text("dk_entry_id"),
  dkContestName: text("dk_contest_name"),
  dkContestId: text("dk_contest_id"),
  dkEntryFee: text("dk_entry_fee"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLineupSchema = createInsertSchema(lineups).omit({ id: true, createdAt: true, reviewedAt: true });
export type Lineup = typeof lineups.$inferSelect;
export type InsertLineup = z.infer<typeof insertLineupSchema>;

// --- SUBSCRIPTIONS ---
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id).unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  tier: text("tier").notNull().default("free"),
  status: text("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end"),
  graceEndsAt: timestamp("grace_ends_at"),
  createdAt: timestamp("created_at").defaultNow(),
  // Note: kept current via the subscriptions_updated_at trigger. See migration note.
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// --- PROP BETS ---
export const props = pgTable("props", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  playerId: integer("player_id").references(() => players.id),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  opponent: text("opponent"),
  propType: text("prop_type").notNull(),
  // numeric columns — use toNum() for arithmetic
  line: numeric("line").notNull(),
  pick: text("pick").notNull(),
  confidence: numeric("confidence").notNull(),
  gameInfo: text("game_info"),
  isLocked: boolean("is_locked").notNull().default(false),
  createdDate: date("created_date").notNull().defaultNow(),
});

export const insertPropSchema = createInsertSchema(props).omit({ id: true });
export type Prop = typeof props.$inferSelect;
export type InsertProp = z.infer<typeof insertPropSchema>;

// --- PRIZEPICKS ENTRIES (VAULT) ---
export const prizePicksEntries = pgTable("prizepicks_entries", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  sport: text("sport").notNull(),
  picks: jsonb("picks").$type<Array<{
    projectionId: string;
    playerName: string;
    team: string;
    statType: string;
    line: number;
    pick: "more" | "less";
    confidence: number;
    reasoning: string;
    imageUrl: string | null;
  }>>().notNull(),
  multiplier: integer("multiplier").notNull(),
  wager: numeric("wager"),
  potentialPayout: numeric("potential_payout"),
  label: text("label"),
  overallConfidence: integer("overall_confidence"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPrizePicksEntrySchema = createInsertSchema(prizePicksEntries).omit({ id: true, createdAt: true });
export type PrizePicksEntry = typeof prizePicksEntries.$inferSelect;
export type InsertPrizePicksEntry = z.infer<typeof insertPrizePicksEntrySchema>;

// --- ALERTS ---
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  lineupId: integer("lineup_id").references(() => lineups.id),
  playerId: integer("player_id").references(() => players.id),
  playerName: text("player_name").notNull(),
  sport: text("sport").notNull(),
  type: text("type").notNull().default("injury"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull().default("info"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true });
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;

// --- PLAYER HISTORY (for algorithm learning) ---
export const playerHistory = pgTable("player_history", {
  id: serial("id").primaryKey(),
  playerName: text("player_name").notNull(),
  team: text("team").notNull(),
  sport: text("sport").notNull(),
  position: text("position").notNull(),
  salary: integer("salary").notNull(),
  // numeric columns — use toNum() for arithmetic
  projectedPoints: numeric("projected_points").notNull(),
  actualPoints: numeric("actual_points"),
  slateDate: date("slate_date").notNull(),
  slateId: integer("slate_id"),
  draftKingsPlayerId: integer("draftkings_player_id"),
  ownership: numeric("ownership"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPlayerHistorySchema = createInsertSchema(playerHistory).omit({ id: true, createdAt: true });
export type PlayerHistory = typeof playerHistory.$inferSelect;
export type InsertPlayerHistory = z.infer<typeof insertPlayerHistorySchema>;

// --- WINNING LINEUP ANALYSIS ---
export const winningLineups = pgTable("winning_lineups", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  slateId: integer("slate_id"),
  slateDate: date("slate_date").notNull(),
  draftGroupId: integer("draft_group_id"),
  // numeric columns — use toNum() for arithmetic
  totalActualPoints: numeric("total_actual_points").notNull(),
  totalSalary: integer("total_salary").notNull(),
  salaryCap: integer("salary_cap").notNull(),
  playerData: jsonb("player_data").notNull(),
  insights: jsonb("insights"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWinningLineupSchema = createInsertSchema(winningLineups).omit({ id: true, createdAt: true });
export type WinningLineup = typeof winningLineups.$inferSelect;
export type InsertWinningLineup = z.infer<typeof insertWinningLineupSchema>;

// --- PLAYER OVERRIDES ---
export const playerOverrides = pgTable("player_overrides", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  slateId: integer("slate_id").notNull().references(() => slates.id),
  playerId: integer("player_id").notNull().references(() => players.id),
  // numeric column — use toNum() for arithmetic
  customProjection: numeric("custom_projection"),
  // boostPercent: integer percentage entered by the user (e.g. 15 = 15% boost).
  // The optimizer converts this to a multiplier (1.15) before applying it,
  // which is then stored as players.boostScore for optimizer consumption.
  boostPercent: integer("boost_percent").notNull().default(0),
  isExcluded: boolean("is_excluded").notNull().default(false),
  isLocked: boolean("is_locked").notNull().default(false),
  notes: text("notes"),
  // Note: kept current via the player_overrides_updated_at trigger. See migration note.
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPlayerOverrideSchema = createInsertSchema(playerOverrides).omit({ id: true, updatedAt: true });
export type PlayerOverride = typeof playerOverrides.$inferSelect;
export type InsertPlayerOverride = z.infer<typeof insertPlayerOverrideSchema>;

// --- LINEUP SCORES (live scoring per lineup) ---
export const lineupScores = pgTable("lineup_scores", {
  id: serial("id").primaryKey(),
  lineupId: integer("lineup_id").notNull().references(() => lineups.id),
  userId: text("user_id").notNull().references(() => users.id),
  sport: text("sport").notNull(),
  totalLivePoints: numeric("total_live_points").notNull().default("0"),
  totalProjectedPoints: numeric("total_projected_points").notNull().default("0"),
  percentComplete: integer("percent_complete").notNull().default(0),
  playerScores: jsonb("player_scores").$type<Array<{
    playerId: number;
    playerName: string;
    position: string;
    team: string;
    salary: number;
    livePoints: number;
    projectedPoints: number;
    gameStatus: string;
    gameStartTime: string;
  }>>(),
  contestRank: integer("contest_rank"),
  contestEntries: integer("contest_entries"),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLineupScoreSchema = createInsertSchema(lineupScores).omit({ id: true, createdAt: true, lastUpdated: true });
export type LineupScore = typeof lineupScores.$inferSelect;
export type InsertLineupScore = z.infer<typeof insertLineupScoreSchema>;

// --- ALERT DELIVERIES (tracks SMS/email sends to prevent duplicates) ---
export const alertDeliveries = pgTable("alert_deliveries", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull().references(() => alerts.id),
  userId: text("user_id").notNull().references(() => users.id),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  externalId: text("external_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const insertAlertDeliverySchema = createInsertSchema(alertDeliveries).omit({ id: true, sentAt: true });
export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type InsertAlertDelivery = z.infer<typeof insertAlertDeliverySchema>;

// --- NOTIFICATION PREFERENCES (per-user channel and alert type settings) ---
export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id).unique(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  phoneNumber: text("phone_number"),
  injuryAlerts: boolean("injury_alerts").notNull().default(true),
  scoringMilestones: boolean("scoring_milestones").notNull().default(true),
  preGameReminders: boolean("pre_game_reminders").notNull().default(true),
  preGameMinutes: integer("pre_game_minutes").notNull().default(60),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertNotificationPreferenceSchema = createInsertSchema(notificationPreferences).omit({ id: true, updatedAt: true });
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = z.infer<typeof insertNotificationPreferenceSchema>;

// --- PERFORMANCE SNAPSHOTS (daily per-user lineup vs optimal vs field stats) ---
export const performanceSnapshots = pgTable("performance_snapshots", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  sport: text("sport").notNull(),
  slateId: integer("slate_id").references(() => slates.id),
  slateDate: date("slate_date").notNull(),
  userScore: numeric("user_score").notNull().default("0"),
  optimalScore: numeric("optimal_score").notNull().default("0"),
  fieldAvgScore: numeric("field_avg_score").notNull().default("0"),
  projectionAccuracy: numeric("projection_accuracy"),
  salaryUtilization: numeric("salary_utilization"),
  boostHitRate: numeric("boost_hit_rate"),
  lineupCount: integer("lineup_count").notNull().default(0),
  bestLineupId: integer("best_lineup_id").references(() => lineups.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPerformanceSnapshotSchema = createInsertSchema(performanceSnapshots).omit({ id: true, createdAt: true });
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type InsertPerformanceSnapshot = z.infer<typeof insertPerformanceSnapshotSchema>;

// --- OPTIMIZATION TYPES ---
export const optimizationConstraintSchema = z.object({
  slateId: z.number(),
  platform: z.enum(["draftkings", "fanduel"]).optional(),
  lockedPlayerIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  // Total lineup salary bounds (applied to the sum of all player salaries).
  totalMinSalary: z.number().optional(),
  totalMaxSalary: z.number().optional(),
  // Per-player salary filter (excludes individual players outside this range).
  playerMinSalary: z.number().optional(),
  playerMaxSalary: z.number().optional(),
  playerProjections: z.record(z.string(), z.number()).optional(),
});

export type OptimizationConstraints = z.infer<typeof optimizationConstraintSchema>;

export const optimizeResponseSchema = z.object({
  lineup: z.array(z.custom<Player>()),
  totalSalary: z.number(),
  totalProjectedPoints: z.number(),
  platform: z.enum(["draftkings", "fanduel"]).optional(),
  error: z.string().optional(),
});

export type OptimizeResponse = z.infer<typeof optimizeResponseSchema>;

export const proOptimizationConstraintSchema = optimizationConstraintSchema.extend({
  lineupCount: z.number().min(1).max(150).default(1),
  useBoosts: z.boolean().default(true),
  // Removed .optional() — .default(true) already handles undefined.
  useInjuryAdjustments: z.boolean().default(true),
  exposureLimits: z.record(z.string(), z.number()).optional(),
  globalMaxExposure: z.number().min(10).max(100).optional(),
  leverageMode: z.boolean().default(false),
  projectionMode: z.enum(["balanced", "ceiling"]).default("balanced"),
});

export type ProOptimizationConstraints = z.infer<typeof proOptimizationConstraintSchema>;

export const proOptimizeResponseSchema = z.object({
  lineups: z.array(optimizeResponseSchema),
  boostsSummary: z.array(z.object({
    playerId: z.number(),
    playerName: z.string(),
    boostScore: z.number(),
    boostReason: z.string(),
  })).optional(),
  injurySummary: z.array(z.object({
    playerId: z.number(),
    playerName: z.string(),
    status: z.string(),
    detail: z.string(),
  })).optional(),
});

export type ProOptimizeResponse = z.infer<typeof proOptimizeResponseSchema>;

/*
 * ============================================================
 * REQUIRED MIGRATIONS — add these to your migrations directory
 * ============================================================
 *
 * 1. GIN index for efficient player lookups across lineups:
 *
 *    CREATE INDEX idx_lineup_player_ids ON lineups USING GIN (player_ids);
 *
 *    Without this, querying "which lineups contain player X?" requires
 *    a full table scan. Required for injury alerts and ownership tracking.
 *
 * 2. updated_at trigger (if not already added from auth.ts migration):
 *
 *    CREATE OR REPLACE FUNCTION set_updated_at()
 *    RETURNS TRIGGER AS $$
 *    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
 *    $$ LANGUAGE plpgsql;
 *
 *    CREATE TRIGGER subscriptions_updated_at
 *      BEFORE UPDATE ON subscriptions
 *      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 *
 *    CREATE TRIGGER player_overrides_updated_at
 *      BEFORE UPDATE ON player_overrides
 *      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 *
 * 3. props.created_date column rename (date → timestamp):
 *
 *    ALTER TABLE props
 *      RENAME COLUMN created_date TO created_at;
 *    ALTER TABLE props
 *      ALTER COLUMN created_at TYPE timestamp USING created_at::timestamp;
 *    ALTER TABLE props
 *      ALTER COLUMN created_at SET DEFAULT NOW();
 *
 * ============================================================
 */
