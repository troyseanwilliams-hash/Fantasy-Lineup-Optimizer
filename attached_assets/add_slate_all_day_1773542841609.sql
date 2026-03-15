-- Migration: full slate metadata for all-slates-of-day support
-- Run once before deploying the updated slate_sync.py and dk_client.py

-- 1. New columns on slates table
ALTER TABLE slates
  ADD COLUMN IF NOT EXISTS label          TEXT,
  ADD COLUMN IF NOT EXISTS game_count     INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contest_count  INT  NOT NULL DEFAULT 0;

-- 2. Backfill label for existing rows (best-effort from existing data)
UPDATE slates
SET label = CONCAT(game_type, ' · ', TO_CHAR(start_time AT TIME ZONE 'America/New_York', 'HH:MI AM'), ' ET')
WHERE label IS NULL;

-- 3. Add draft_group_id column to players if it doesn't exist
--    (players are already scoped to a slate via slate_id; this is for
--     debugging / admin queries — optional but useful)
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS draft_group_id INT;

-- 4. Index to support the per-sport, per-platform active-slate query fast
DROP INDEX IF EXISTS idx_slates_active;
CREATE INDEX IF NOT EXISTS idx_slates_active
  ON slates (sport, platform, is_active, start_time DESC);
