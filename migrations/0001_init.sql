-- Option 5B, Phase A schema (proposal steps 3, 6, 8)
CREATE TABLE IF NOT EXISTS films (
  id          TEXT PRIMARY KEY,
  creator_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created',   -- created | uploading | uploaded | queued | encoding | packaged | ready | failed
  source_key  TEXT,                              -- masters/{id}/source.mov in ztor-masters
  upload_id   TEXT,                              -- R2 multipart upload id while uploading
  workflow_id TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Only key IDs live here. Raw keys live in the KEYS KV namespace (Phase A stand-in for the DRM vendor).
CREATE TABLE IF NOT EXISTS film_keys (
  film_id     TEXT NOT NULL REFERENCES films(id),
  label       TEXT NOT NULL,                     -- VIDEO | AUDIO
  key_id      TEXT NOT NULL,                     -- 32 hex chars
  scheme      TEXT NOT NULL DEFAULT 'cbcs',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (film_id, label)
);

-- Step 8: one row per license issued, to reconcile with the vendor invoice later.
CREATE TABLE IF NOT EXISTS licenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  film_id     TEXT NOT NULL,
  device_id   TEXT,
  drm         TEXT NOT NULL,                     -- clearkey | widevine | fairplay | playready
  key_ids     TEXT,                              -- comma-separated key ids returned
  issued_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS licenses_film_time ON licenses(film_id, issued_at);

-- Step 7 stub: who rented what. Phase A fills this by hand for testing.
CREATE TABLE IF NOT EXISTS rentals (
  user_id     TEXT NOT NULL,
  film_id     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, film_id)
);

-- Step 5 telemetry: minutes per step, for the cost check.
CREATE TABLE IF NOT EXISTS encode_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id     TEXT NOT NULL,
  runner      TEXT NOT NULL,                     -- local-mac | cloudflare-container
  step        TEXT NOT NULL,                     -- download | encode | package | upload
  wall_s      REAL,
  cpu_s       REAL,
  bytes       INTEGER,
  detail      TEXT,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
