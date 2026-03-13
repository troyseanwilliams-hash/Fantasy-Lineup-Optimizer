import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // email is required for credential-based auth.
  // OAuth-only users (no password) will still have an email from their provider.
  email: varchar("email").unique().notNull(),
  // Nullable: OAuth-only users authenticate via provider and have no local password.
  password: varchar("password"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  salutation: varchar("salutation"),
  phone: varchar("phone"),
  smsConsent: boolean("sms_consent").default(false),
  emailConsent: boolean("email_consent").default(false),
  onboardingComplete: boolean("onboarding_complete").default(false),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  // Note: updatedAt is kept current via the set_updated_at trigger (see migration below).
  // Do NOT rely on defaultNow() alone — it only fires on insert.
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

/*
 * ============================================================
 * REQUIRED MIGRATION — run this after applying schema changes
 * ============================================================
 *
 * This trigger keeps `updated_at` current on every UPDATE.
 * Without it, `updated_at` is set once on insert and never changes.
 *
 * Also configures connect-pg-simple session pruning to prevent
 * the sessions table from growing indefinitely.
 *
 * -- Shared trigger function (create once, reuse across tables)
 * CREATE OR REPLACE FUNCTION set_updated_at()
 * RETURNS TRIGGER AS $$
 * BEGIN
 *   NEW.updated_at = NOW();
 *   RETURN NEW;
 * END;
 * $$ LANGUAGE plpgsql;
 *
 * -- Apply to users
 * CREATE TRIGGER users_updated_at
 *   BEFORE UPDATE ON users
 *   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 *
 * -- Apply to subscriptions (same issue exists there)
 * CREATE TRIGGER subscriptions_updated_at
 *   BEFORE UPDATE ON subscriptions
 *   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 *
 * -- Apply to player_overrides (same issue exists there)
 * CREATE TRIGGER player_overrides_updated_at
 *   BEFORE UPDATE ON player_overrides
 *   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 *
 * -- Session pruning: also configure in your Express session setup:
 * --   new pgSession({ pruneSessionInterval: 60 * 15 })
 * -- This prunes expired sessions every 15 minutes automatically.
 * ============================================================
 */
