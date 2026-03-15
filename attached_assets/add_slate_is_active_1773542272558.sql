-- Migration: add is_active flag to slates
-- Run once against your database before deploying the updated slate_sync.py

-- 1. Add the column (default TRUE so existing slates stay visible)
ALTER TABLE slates ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. Index so the optimizer/showdown slate queries stay fast
CREATE INDEX IF NOT EXISTS idx_slates_active ON slates (sport, platform, is_active);

-- 3. Immediately mark anything whose start_time is more than 24 hours ago as inactive
--    (safe to run multiple times — idempotent)
UPDATE slates
SET    is_active = FALSE
WHERE  start_time < NOW() - INTERVAL '24 hours'
  AND  is_active = TRUE;
