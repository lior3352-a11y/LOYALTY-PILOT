-- Apply once, explicitly, to the verified US database during a maintenance window.
-- Never run this file automatically on an HTTP request or during Vercel builds.
BEGIN;
SELECT pg_advisory_xact_lock(20260918, 2);
CREATE TABLE IF NOT EXISTS loyalty_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
DO $$ BEGIN
  IF to_regclass('public.loyalty_customer_accounts') IS NULL THEN
    RAISE EXCEPTION 'Expected the current US account schema. Stop and inspect this database.';
  END IF;
  IF EXISTS (SELECT 1 FROM loyalty_customers WHERE business_id IS NULL)
     OR EXISTS (SELECT 1 FROM loyalty_wallets WHERE business_id IS NULL)
     OR EXISTS (SELECT 1 FROM loyalty_wallets w JOIN loyalty_customers c ON c.id=w.customer_id WHERE w.business_id<>c.business_id) THEN
    RAISE EXCEPTION 'Unmapped or cross-business legacy balances require an explicit ownership audit; no automatic reassignment is permitted.';
  END IF;
  IF EXISTS (SELECT 1 FROM loyalty_customers GROUP BY business_id,regexp_replace(phone,'[^0-9]','','g') HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate normalized business phone numbers require manual reconciliation.';
  END IF;
END $$;
ALTER TABLE loyalty_customer_accounts ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
-- Previous releases linked by phone without verifying ownership. Quarantine those links
-- until the owner verifies them. Balances, profiles and transaction records are retained.
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS owner_verified_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_business_normalized_phone_v2
  ON loyalty_customers(business_id, (regexp_replace(phone,'[^0-9]','','g')));
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_wallets_customer_business_key ON loyalty_wallets(customer_id,business_id);
-- Deliberately different names from BOTH incompatible loyalty_customer_sessions tables.
CREATE TABLE IF NOT EXISTS loyalty_us_sessions_v2 (
 token_hash TEXT PRIMARY KEY, account_id BIGINT NOT NULL REFERENCES loyalty_customer_accounts(id) ON DELETE CASCADE,
 auth_version INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS loyalty_us_sessions_v2_account ON loyalty_us_sessions_v2(account_id);
CREATE TABLE IF NOT EXISTS loyalty_us_recovery_v2 (
 purpose TEXT NOT NULL CHECK(purpose IN ('link','verify','reset')),
 token_hash TEXT PRIMARY KEY, customer_id BIGINT NOT NULL UNIQUE REFERENCES loyalty_customers(id) ON DELETE CASCADE,
 account_id BIGINT REFERENCES loyalty_customer_accounts(id) ON DELETE CASCADE,
 business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE,
 issued_by BIGINT NOT NULL REFERENCES loyalty_users(id), expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loyalty_us_approvals_v2 (
 token_hash TEXT PRIMARY KEY, customer_id BIGINT NOT NULL UNIQUE REFERENCES loyalty_customers(id) ON DELETE CASCADE,
 account_id BIGINT NOT NULL REFERENCES loyalty_customer_accounts(id) ON DELETE CASCADE,
 business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL REFERENCES loyalty_us_sessions_v2(token_hash) ON DELETE CASCADE,
 auth_version INTEGER NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount>0), expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS loyalty_us_auth_limits_v2 (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS loyalty_us_security_audit_v2 (
 id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, actor_id BIGINT, account_id BIGINT, customer_id BIGINT, business_id BIGINT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO loyalty_schema_migrations(version) VALUES('20260918-us-security-v2') ON CONFLICT DO NOTHING;
COMMIT;
