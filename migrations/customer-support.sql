-- Apply once to a dedicated support database, shared by US and Israel.
-- Never point SUPPORT_DATABASE_URL at either customer database.
CREATE TABLE IF NOT EXISTS loyalty_support_budget (
  id text PRIMARY KEY,
  limit_cents integer NOT NULL CHECK (limit_cents BETWEEN 0 AND 1000),
  reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0)
);
INSERT INTO loyalty_support_budget (id, limit_cents)
VALUES ('loyalty-support-trial', 1000) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS loyalty_support_sessions (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  last_active timestamptz NOT NULL,
  busy_until timestamptz
);
CREATE INDEX IF NOT EXISTS loyalty_support_session_expiry ON loyalty_support_sessions(expires_at);
