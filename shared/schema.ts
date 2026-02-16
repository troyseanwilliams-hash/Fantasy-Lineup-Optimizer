import { pgTable, text, serial, integer, boolean, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

// --- SLATES ---
export const slates = pgTable("slates", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  platform: text("platform").notNull().default("draftkings"),
  name: text("name").notNull(),
  startTime: timestamp("start_time").notNull(),
  isMain: boolean("is_main").notNull().default(true),
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
  fppg: numeric("fppg").notNull(),
  projectedPoints: numeric("projected_points").notNull(),
  opponent: text("opponent"),
  gameInfo: text("game_info"),
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
  totalProjectedPoints: numeric("total_projected_points").notNull(),
  playerIds: integer("player_ids").array().notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLineupSchema = createInsertSchema(lineups).omit({ id: true, createdAt: true });
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
  createdAt: timestamp("created_at").defaultNow(),
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

// --- OPTIMIZATION TYPES ---
export const optimizationConstraintSchema = z.object({
  slateId: z.number(),
  platform: z.enum(["draftkings", "fanduel"]).optional(),
  lockedPlayerIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  minSalary: z.number().optional(),
  maxSalary: z.number().optional(),
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
