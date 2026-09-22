-- Disposable test fixture reproducing the prior US schema; never a deployment migration.
CREATE TABLE IF NOT EXISTS loyalty_businesses (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, loyalty_rate NUMERIC(6,2) NOT NULL DEFAULT 10, qr_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE loyalty_businesses ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE TABLE IF NOT EXISTS loyalty_customers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, wallet_token TEXT NOT NULL UNIQUE, business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_wallets (customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, balance NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (customer_id, business_id));
CREATE TABLE IF NOT EXISTS loyalty_transactions (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, purchase_amount NUMERIC(12,2) NOT NULL, earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'earn', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','owner','manager','staff')), business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE loyalty_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE loyalty_users ADD COLUMN IF NOT EXISTS terms_version TEXT;
CREATE TABLE IF NOT EXISTS loyalty_sessions (token TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES loyalty_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_business_settings (business_id BIGINT PRIMARY KEY REFERENCES loyalty_businesses(id) ON DELETE CASCADE, settings JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_rewards (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, name TEXT NOT NULL, points_cost NUMERIC(12,2) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_subscriptions (business_id BIGINT PRIMARY KEY REFERENCES loyalty_businesses(id) ON DELETE CASCADE, trial_start TIMESTAMPTZ NOT NULL, trial_end TIMESTAMPTZ NOT NULL, subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing','active','past_due','canceled','expired')), subscription_start TIMESTAMPTZ, next_billing_date TIMESTAMPTZ, stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE, plan_name TEXT NOT NULL DEFAULT 'Loyalty US Standard', monthly_price_cents INTEGER NOT NULL DEFAULT 4900, canceled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS loyalty_payment_history (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, stripe_invoice_id TEXT UNIQUE NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS loyalty_payment_history_business_idx ON loyalty_payment_history(business_id, created_at DESC);
CREATE TABLE IF NOT EXISTS loyalty_customer_accounts (
    id BIGSERIAL PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    phone_key TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    birth_date DATE,
    terms_accepted_at TIMESTAMPTZ NOT NULL,
    terms_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
CREATE TABLE IF NOT EXISTS loyalty_customer_sessions (
    token TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES loyalty_customer_accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES loyalty_customer_accounts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_account_business_key ON loyalty_customers(account_id, business_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_customer_sessions_account_idx ON loyalty_customer_sessions(account_id, expires_at);
ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE;
ALTER TABLE loyalty_wallets ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE;
DO $$ DECLARE first_business BIGINT; BEGIN SELECT id INTO first_business FROM loyalty_businesses ORDER BY id LIMIT 1; IF first_business IS NULL AND EXISTS (SELECT 1 FROM loyalty_customers WHERE business_id IS NULL) THEN INSERT INTO loyalty_businesses(name, qr_token) VALUES ('Legacy workspace', md5(clock_timestamp()::text || random()::text)) RETURNING id INTO first_business; END IF; IF first_business IS NOT NULL THEN UPDATE loyalty_customers c SET business_id = w.business_id FROM loyalty_wallets w WHERE w.customer_id = c.id AND c.business_id IS NULL; UPDATE loyalty_customers SET business_id = first_business WHERE business_id IS NULL; UPDATE loyalty_wallets SET business_id = first_business WHERE business_id IS NULL; END IF; END $$;
DO $$ DECLARE c RECORD; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='loyalty_customers'::regclass AND contype='u' AND conname <> 'loyalty_customers_wallet_token_key' LOOP EXECUTE format('ALTER TABLE loyalty_customers DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP; END $$;
DO $$ DECLARE c RECORD; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='loyalty_wallets'::regclass AND contype='p' LOOP EXECUTE format('ALTER TABLE loyalty_wallets DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_business_phone_key ON loyalty_customers(business_id, phone);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_wallets_customer_business_key ON loyalty_wallets(customer_id, business_id);
CREATE INDEX IF NOT EXISTS loyalty_transactions_business_created_idx ON loyalty_transactions(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_customers_business_created_idx ON loyalty_customers(business_id, created_at DESC);
