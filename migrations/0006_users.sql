-- Accounts and roles (2026-09-24). Additive. Roles: admin | host | user.
-- The first account ever registered becomes admin (bootstrap); afterwards only an admin changes roles.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,                       -- PBKDF2-SHA256, 100,000 iterations, hex
  salt          TEXT NOT NULL,                       -- 16 random bytes, hex
  role          TEXT NOT NULL DEFAULT 'user',        -- admin | host | user
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,                       -- sha256 of the cookie value, hex
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id, expires_at);
