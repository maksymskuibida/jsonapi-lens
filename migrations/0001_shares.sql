-- Share metadata. Deliberately holds nothing about the document itself: no
-- label, no type names, no size breakdown. Everything descriptive is inside the
-- encrypted blob in R2, so this table cannot leak what was shared.
CREATE TABLE IF NOT EXISTS shares (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,
  -- NULL means "forever": no expiry.
  expires_at   INTEGER,
  -- Ciphertext length, for the cleanup sweep's accounting only.
  bytes        INTEGER NOT NULL
);

-- The sweep scans by expiry, so index it.
CREATE INDEX IF NOT EXISTS shares_expires_at ON shares (expires_at)
  WHERE expires_at IS NOT NULL;
