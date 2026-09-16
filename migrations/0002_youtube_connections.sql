CREATE TABLE IF NOT EXISTS "youtube_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel_id" text,
  "channel_title" text,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "token_expires_at" timestamp,
  "scopes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "youtube_connections_user_id_unique"
  ON "youtube_connections" ("user_id");