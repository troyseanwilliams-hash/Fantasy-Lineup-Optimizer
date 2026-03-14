-- ============================================================
-- migration_platform_pricing.sql
--
-- Adds per-platform player ID and salary columns so a player
-- record can carry pricing from all three DFS platforms.
-- Also updates all platform enum constraints to include "yahoo".
--
-- Run after deploying the updated schema.ts:
--   npx drizzle-kit generate && npx drizzle-kit migrate
-- OR run this SQL directly against your database.
-- ============================================================

-- ── New columns on players table ─────────────────────────────────────────────

-- FanDuel player ID (integer, same scale as draftKingsPlayerId)
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS fanduel_player_id INTEGER;

-- Yahoo player ID (text — Yahoo uses string IDs like "nba.p.5479")
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS yahoo_player_id TEXT;

-- Per-platform salary overrides.
-- When NULL, the primary `salary` column is used (which equals the slate's
-- platform salary). When populated, these let a single player record carry
-- all three platforms' prices for cross-platform comparison views.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS fanduel_salary INTEGER;

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS yahoo_salary INTEGER;

-- ── Index for FD/Yahoo player lookups ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_players_fanduel_id ON players(fanduel_player_id)
  WHERE fanduel_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_players_yahoo_id ON players(yahoo_player_id)
  WHERE yahoo_player_id IS NOT NULL;

-- ── Verify slates.platform column accepts "yahoo" ────────────────────────────
-- The column is TEXT with no CHECK constraint in the current schema, so no
-- ALTER needed. If your DB has an enum constraint, update it here:
--
--   ALTER TYPE platform_enum ADD VALUE IF NOT EXISTS 'yahoo';
--
-- Or if using a check constraint:
--   ALTER TABLE slates DROP CONSTRAINT IF EXISTS slates_platform_check;
--   ALTER TABLE slates ADD CONSTRAINT slates_platform_check
--     CHECK (platform IN ('draftkings', 'fanduel', 'yahoo'));
--
--   ALTER TABLE lineups DROP CONSTRAINT IF EXISTS lineups_platform_check;
--   ALTER TABLE lineups ADD CONSTRAINT lineups_platform_check
--     CHECK (platform IN ('draftkings', 'fanduel', 'yahoo'));

-- ── Informational comment on salary semantics ─────────────────────────────────
-- salary         = the primary salary for this player on this slate's platform
--                  (always set; used by the optimizer)
-- fanduel_salary = FD salary for cross-platform display (optional)
-- yahoo_salary   = Yahoo salary for cross-platform display (optional)
--
-- Ingestion:
--   fanduel-ingest.ts populates salary + fanduel_player_id on FD slates
--   yahoo-ingest.ts   populates salary + yahoo_player_id   on Yahoo slates
--   The cross-platform salary fields are populated when a player matcher
--   runs post-ingest to link the same player across platforms.

-- ── Player matcher: populate cross-platform salaries ─────────────────────────
-- After ingesting FD and Yahoo slates, run this query to backfill
-- fanduel_salary and yahoo_salary on DK player records (and vice versa)
-- by matching on normalized player name + team + date.
--
-- Example: populate fanduel_salary on DK players for today's NBA slate
--
-- UPDATE dk_players AS dk
-- SET fanduel_salary = fd.salary,
--     fanduel_player_id = fd.fanduel_player_id
-- FROM (
--   SELECT p.name, p.team, p.salary, p.fanduel_player_id
--   FROM players p
--   JOIN slates s ON p.slate_id = s.id
--   WHERE s.platform = 'fanduel'
--     AND s.sport = 'NBA'
--     AND DATE(s.start_time AT TIME ZONE 'America/New_York') = CURRENT_DATE
-- ) fd
-- JOIN slates s ON dk.slate_id = s.id
-- WHERE lower(trim(dk.name)) = lower(trim(fd.name))
--   AND dk.team = fd.team
--   AND s.platform = 'draftkings'
--   AND s.sport = 'NBA'
--   AND DATE(s.start_time AT TIME ZONE 'America/New_York') = CURRENT_DATE;
