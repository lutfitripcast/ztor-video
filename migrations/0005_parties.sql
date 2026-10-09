-- Watch party (2026-09-24). Additive only: nothing in films / rentals / licenses changes.
-- A party binds one host to one film's protected-URL version. Live state (clock, roster, pins) lives in the
-- PartyRoom Durable Object; these tables are the durable record and the chat archive.
CREATE TABLE IF NOT EXISTS parties (
  id          TEXT PRIMARY KEY,
  film_id     TEXT NOT NULL REFERENCES films(id),
  host_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'live',            -- live | ended
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS parties_film ON parties(film_id, created_at);

CREATE TABLE IF NOT EXISTS party_members (
  party_id        TEXT NOT NULL REFERENCES parties(id),
  user_id         TEXT NOT NULL,
  role            TEXT NOT NULL,                        -- host | viewer
  joins           INTEGER NOT NULL DEFAULT 1,
  first_joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_joined_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (party_id, user_id)
);

-- Chat archive, flushed from the Durable Object in batches (every few seconds), not per message.
CREATE TABLE IF NOT EXISTS party_messages (
  party_id    TEXT NOT NULL,
  seq         INTEGER NOT NULL,                         -- per-party sequence assigned by the Durable Object
  user_id     TEXT NOT NULL,
  text        TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (party_id, seq)
);

-- Host actions worth keeping: pin, unpin, kick, mute, unmute, slow, end. (Playback clock changes are not logged.)
CREATE TABLE IF NOT EXISTS party_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id    TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_id   TEXT,
  detail      TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS party_actions_party ON party_actions(party_id, id);
