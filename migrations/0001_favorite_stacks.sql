-- Favorite Top Stack persistence.  This migration is intentionally narrow and
-- idempotent; apply it before serving the favorite-stacks endpoints.
CREATE TABLE IF NOT EXISTS favorite_stacks (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  slate_id INTEGER NOT NULL REFERENCES slates(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  game_key TEXT,
  player_ids INTEGER[] NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_favorite_stacks_user_slate
  ON favorite_stacks (user_id, slate_id);