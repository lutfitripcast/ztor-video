-- Each encode writes to films/{id}/v{version}/ so re-encodes never overwrite immutable, long-cached URLs.
ALTER TABLE films ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
