-- Party tickets (2026-09-25). A ticket is entry to ONE party: the film plays only inside that party, in sync, while it runs.
-- A rental does not substitute for a ticket (user's decision). The host needs no ticket; the host rents the film to screen it.
CREATE TABLE IF NOT EXISTS party_tickets (
  party_id    TEXT NOT NULL REFERENCES parties(id),
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'free',          -- free | purchase | invite
  price_cents INTEGER NOT NULL DEFAULT 0,
  issued_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (party_id, user_id)
);
