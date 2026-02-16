import { pgTable, text, serial, integer, boolean, timestamp, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

// --- SLATES ---
export const slates = pgTable("slates", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(), // 'NFL', 'NBA', 'MLB', 'NHL'
  name: text("name").notNull(),   // 'Main Slate', 'Late Night'
  startTime: timestamp("start_time").notNull(),
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
  position: text("position").notNull(), // 'QB', 'RB', 'WR', 'TE', 'DST', 'PG', 'SG', etc.
  salary: integer("salary").notNull(),
  fppg: numeric("fppg").notNull(), // Fantasy Points Per Game (Average)
  projectedPoints: numeric("projected_points").notNull(), // The stat we optimize for
  opponent: text("opponent"),
  gameInfo: text("game_info"), // 'GB @ CHI 1:00PM'
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
  totalSalary: integer("total_salary").notNull(),
  totalProjectedPoints: numeric("total_projected_points").notNull(),
  playerIds: integer("player_ids").array().notNull(), // Store IDs of players in the lineup
  name: text("name"), // Optional user-given name
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLineupSchema = createInsertSchema(lineups).omit({ id: true, createdAt: true });
export type Lineup = typeof lineups.$inferSelect;
export type InsertLineup = z.infer<typeof insertLineupSchema>;

// --- OPTIMIZATION TYPES ---
// These aren't database tables, but shared types for the API
export const optimizationConstraintSchema = z.object({
  slateId: z.number(),
  lockedPlayerIds: z.array(z.number()).default([]),
  excludedPlayerIds: z.array(z.number()).default([]),
  minSalary: z.number().optional(),
  maxSalary: z.number().optional(),
  playerProjections: z.record(z.string(), z.number()).optional(), // Map playerId -> Custom Projection
});

export type OptimizationConstraints = z.infer<typeof optimizationConstraintSchema>;

export const optimizeResponseSchema = z.object({
  lineup: z.array(z.custom<Player>()),
  totalSalary: z.number(),
  totalProjectedPoints: z.number(),
  error: z.string().optional(),
});

export type OptimizeResponse = z.infer<typeof optimizeResponseSchema>;
