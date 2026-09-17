import { neon } from '@neondatabase/serverless';
import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const sql = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
};
const hashPassword = (password, salt = randomUUID()) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const verifyPassword = (password, stored) => {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
};
const normalizePhone = value => String(value || '').replace(/[^0-9]/g, '');

async function ensureSchema(db) {
  await db`CREATE TABLE IF NOT EXISTS loyalty_businesses (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, loyalty_rate NUMERIC(6,2) NOT NULL DEFAULT 10, qr_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`ALTER TABLE loyalty_businesses ADD COLUMN IF NOT EXISTS phone TEXT`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, wallet_token TEXT NOT NULL UNIQUE, business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_wallets (customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, balance NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (customer_id, business_id))`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_transactions (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, purchase_amount NUMERIC(12,2) NOT NULL, earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'earn', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','owner','manager','staff')), business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`ALTER TABLE loyalty_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ`;
  await db`ALTER TABLE loyalty_users ADD COLUMN IF NOT EXISTS terms_version TEXT`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_sessions (token TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES loyalty_users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_business_settings (business_id BIGINT PRIMARY KEY REFERENCES loyalty_businesses(id) ON DELETE CASCADE, settings JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_rewards (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, name TEXT NOT NULL, points_cost NUMERIC(12,2) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_subscriptions (business_id BIGINT PRIMARY KEY REFERENCES loyalty_businesses(id) ON DELETE CASCADE, trial_start TIMESTAMPTZ NOT NULL, trial_end TIMESTAMPTZ NOT NULL, subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing','active','past_due','canceled','expired')), subscription_start TIMESTAMPTZ, next_billing_date TIMESTAMPTZ, stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE, plan_name TEXT NOT NULL DEFAULT 'Loyalty US Standard', monthly_price_cents INTEGER NOT NULL DEFAULT 4900, canceled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_payment_history (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, stripe_invoice_id TEXT UNIQUE NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE INDEX IF NOT EXISTS loyalty_payment_history_business_idx ON loyalty_payment_history(business_id, created_at DESC)`;

  await db`CREATE TABLE IF NOT EXISTS loyalty_customer_accounts (
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
  )`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customer_sessions (
    token TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES loyalty_customer_accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await db`ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES loyalty_customer_accounts(id) ON DELETE SET NULL`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_account_business_key ON loyalty_customers(account_id, business_id) WHERE account_id IS NOT NULL`;
  await db`CREATE INDEX IF NOT EXISTS loyalty_customer_sessions_account_idx ON loyalty_customer_sessions(account_id, expires_at)`;

  await db`ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE`;
  await db`ALTER TABLE loyalty_wallets ADD COLUMN IF NOT EXISTS business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE CASCADE`;
  await db`DO $$ DECLARE first_business BIGINT; BEGIN SELECT id INTO first_business FROM loyalty_businesses ORDER BY id LIMIT 1; IF first_business IS NULL AND EXISTS (SELECT 1 FROM loyalty_customers WHERE business_id IS NULL) THEN INSERT INTO loyalty_businesses(name, qr_token) VALUES ('Legacy workspace', md5(clock_timestamp()::text || random()::text)) RETURNING id INTO first_business; END IF; IF first_business IS NOT NULL THEN UPDATE loyalty_customers c SET business_id = w.business_id FROM loyalty_wallets w WHERE w.customer_id = c.id AND c.business_id IS NULL; UPDATE loyalty_customers SET business_id = first_business WHERE business_id IS NULL; UPDATE loyalty_wallets SET business_id = first_business WHERE business_id IS NULL; END IF; END $$`;
  await db`DO $$ DECLARE c RECORD; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='loyalty_customers'::regclass AND contype='u' AND conname <> 'loyalty_customers_wallet_token_key' LOOP EXECUTE format('ALTER TABLE loyalty_customers DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP; END $$`;
  await db`DO $$ DECLARE c RECORD; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='loyalty_wallets'::regclass AND contype='p' LOOP EXECUTE format('ALTER TABLE loyalty_wallets DROP CONSTRAINT IF EXISTS %I', c.conname); END LOOP; END $$`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_business_phone_key ON loyalty_customers(business_id, phone)`;
  await db`CREATE UNIQUE INDEX IF NOT EXISTS loyalty_wallets_customer_business_key ON loyalty_wallets(customer_id, business_id)`;
  await db`CREATE INDEX IF NOT EXISTS loyalty_transactions_business_created_idx ON loyalty_transactions(business_id, created_at DESC)`;
  await db`CREATE INDEX IF NOT EXISTS loyalty_customers_business_created_idx ON loyalty_customers(business_id, created_at DESC)`;
}

async function sessionUser(db, req, suppliedToken) {
  const header = req.headers.authorization || '';
  const token = suppliedToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token) return null;
  return (await db`SELECT u.id,u.email,u.role,u.business_id FROM loyalty_sessions s JOIN loyalty_users u ON u.id=s.user_id WHERE s.token=${token} AND s.expires_at>NOW()`).at(0) || null;
}
async function customerSession(db, req, suppliedToken) {
  const header = req.headers.authorization || '';
  const token = suppliedToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token) return null;
  const account = (await db`SELECT a.id,a.first_name,a.last_name,a.phone,a.email,a.address,a.city,a.state,a.postal_code,a.birth_date,a.created_at
    FROM loyalty_customer_sessions s JOIN loyalty_customer_accounts a ON a.id=s.account_id
    WHERE s.token=${token} AND s.expires_at>NOW()`).at(0) || null;
  return account ? { token, account } : null;
}
function requireBusiness(user) {
  if (!user?.business_id) { const error = new Error('Business workspace required'); error.status = 403; throw error; }
  return Number(user.business_id);
}
async function ensureCustomerMembership(db, account, businessId) {
  if (!businessId) return null;
  const business = (await db`SELECT id,name,loyalty_rate FROM loyalty_businesses WHERE id=${businessId}`).at(0);
  if (!business) { const error = new Error('Business not found'); error.status = 404; throw error; }
  let membership = (await db`SELECT id,wallet_token FROM loyalty_customers WHERE account_id=${account.id} AND business_id=${businessId}`).at(0);
  if (!membership) {
    const phoneKey = normalizePhone(account.phone);
    const legacy = (await db`SELECT id,wallet_token FROM loyalty_customers WHERE business_id=${businessId} AND regexp_replace(phone,'[^0-9]','','g')=${phoneKey} LIMIT 1`).at(0);
    if (legacy) {
      membership = (await db`UPDATE loyalty_customers SET account_id=${account.id},name=${`${account.first_name} ${account.last_name}`},phone=${account.phone} WHERE id=${legacy.id} RETURNING id,wallet_token`).at(0);
    } else {
      membership = (await db`INSERT INTO loyalty_customers(name,phone,business_id,wallet_token,account_id) VALUES(${`${account.first_name} ${account.last_name}`},${account.phone},${businessId},${randomUUID()},${account.id}) RETURNING id,wallet_token`).at(0);
    }
  }
  await db`INSERT INTO loyalty_wallets(customer_id,business_id) VALUES(${membership.id},${businessId}) ON CONFLICT (customer_id,business_id) DO NOTHING`;
  return { ...membership, business };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const db = sql(); await ensureSchema(db);
    const { action, ...p } = req.body || {};

    if (action === 'register_customer_account') {
      const firstName=String(p.first_name||'').trim(), lastName=String(p.last_name||'').trim();
      const phone=String(p.phone||'').trim(), phoneKey=normalizePhone(phone), email=String(p.email||'').trim().toLowerCase();
      const password=String(p.password||''), address=String(p.address||'').trim(), city=String(p.city||'').trim(), state=String(p.state||'').trim(), postalCode=String(p.postal_code||'').trim();
      const birthDate=p.birth_date ? String(p.birth_date) : null;
      if (!firstName||!lastName||phoneKey.length<7||!email||!email.includes('@')||!address||!city||!state||!postalCode) return res.status(400).json({error:'Please complete all required account details'});
      if (password.length<8) return res.status(400).json({error:'Password must be at least 8 characters'});
      if (p.terms_accepted!==true) return res.status(400).json({error:'Terms of Service and Privacy Policy acceptance is required'});
      if ((await db`SELECT 1 FROM loyalty_customer_accounts WHERE email=${email} OR phone_key=${phoneKey} LIMIT 1`).length) return res.status(409).json({error:'An account with this email or mobile number already exists'});
      const account=(await db`INSERT INTO loyalty_customer_accounts(first_name,last_name,phone,phone_key,email,password_hash,address,city,state,postal_code,birth_date,terms_accepted_at,terms_version)
        VALUES(${firstName},${lastName},${phone},${phoneKey},${email},${hashPassword(password)},${address},${city},${state},${postalCode},${birthDate},NOW(),'2026-09-17')
        RETURNING id,first_name,last_name,phone,email,address,city,state,postal_code,birth_date,created_at`).at(0);
      if (Number(p.business_id||0)) await ensureCustomerMembership(db, account, Number(p.business_id));
      const token=randomUUID();
      await db`INSERT INTO loyalty_customer_sessions(token,account_id,expires_at) VALUES(${token},${account.id},NOW()+INTERVAL '30 days')`;
      return res.status(201).json({access_token:token,account});
    }

    if (action === 'customer_login') {
      const login=String(p.login||'').trim(), password=String(p.password||'');
      const email=login.toLowerCase(), phoneKey=normalizePhone(login);
      const account=(await db`SELECT id,first_name,last_name,phone,email,address,city,state,postal_code,birth_date,password_hash,created_at FROM loyalty_customer_accounts WHERE email=${email} OR phone_key=${phoneKey} LIMIT 1`).at(0);
      if (!account || !verifyPassword(password,account.password_hash)) return res.status(401).json({error:'Invalid email/mobile number or password'});
      if (Number(p.business_id||0)) await ensureCustomerMembership(db,account,Number(p.business_id));
      const token=randomUUID();
      await db`INSERT INTO loyalty_customer_sessions(token,account_id,expires_at) VALUES(${token},${account.id},NOW()+INTERVAL '30 days')`;
      delete account.password_hash;
      return res.json({access_token:token,account});
    }

    if (action === 'customer_logout') {
      const session=await customerSession(db,req,p.access_token);
      if (session) await db`DELETE FROM loyalty_customer_sessions WHERE token=${session.token}`;
      return res.json({ok:true});
    }

    if (action === 'customer_account') {
      const session=await customerSession(db,req,p.access_token);
      if (!session) return res.status(401).json({error:'Customer session expired. Please sign in again.'});
      const account=session.account;
      const businesses=await db`SELECT c.id customer_id,b.id business_id,b.name business_name,b.loyalty_rate,w.balance,w.updated_at
        FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id JOIN loyalty_businesses b ON b.id=c.business_id
        WHERE c.account_id=${account.id} ORDER BY b.name`;
      const transactions=await db`SELECT t.purchase_amount,t.earned_amount,t.type,t.created_at,b.name business_name
        FROM loyalty_transactions t JOIN loyalty_customers c ON c.id=t.customer_id JOIN loyalty_businesses b ON b.id=t.business_id
        WHERE c.account_id=${account.id} ORDER BY t.created_at DESC LIMIT 100`;
      return res.json({account,businesses,transactions});
    }

    if (action === 'login') {
      const email = String(p.email || '').trim().toLowerCase(), password = String(p.password || '');
      const user = (await db`SELECT id,email,role,business_id,password_hash FROM loyalty_users WHERE email=${email}`).at(0);
      if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
      const token = randomUUID();
      await db`INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES(${token},${user.id},NOW()+INTERVAL '30 days')`;
      return res.json({ token, access_token: token, email: user.email, role: user.role, business_id: user.business_id });
    }
    if (action === 'register_business') {
      const name = String(p.name || '').trim(), email = String(p.email || '').trim().toLowerCase(), password = String(p.password || ''), phone = String(p.phone || '').trim();
      if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Business name, email, and an 8 character password are required' });
      if (p.terms_accepted !== true) return res.status(400).json({ error: 'Terms of Service acceptance is required' });
      if ((await db`SELECT 1 FROM loyalty_users WHERE email=${email}`).length) return res.status(409).json({ error: 'An account with this email already exists' });
      const business = (await db`INSERT INTO loyalty_businesses(name,phone,qr_token) VALUES(${name},${phone || null},${randomUUID()}) RETURNING id,name,phone,loyalty_rate,qr_token`).at(0);
      await db`INSERT INTO loyalty_business_settings(business_id) VALUES(${business.id})`;
      await db`INSERT INTO loyalty_subscriptions(business_id,trial_start,trial_end,subscription_status) VALUES(${business.id},NOW(),NOW()+INTERVAL '14 days','trialing')`;
      const user = (await db`INSERT INTO loyalty_users(email,password_hash,role,business_id,terms_accepted_at,terms_version) VALUES(${email},${hashPassword(password)},'owner',${business.id},NOW(),'2026-09-17') RETURNING id,email,role,business_id,terms_accepted_at,terms_version`).at(0);
      const token = randomUUID(); await db`INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES(${token},${user.id},NOW()+INTERVAL '30 days')`;
      return res.status(201).json({ token, access_token: token, user, business });
    }
    if (action === 'public_business') {
      const businessId = Number(p.business_id || 0);
      if (!businessId) return res.status(400).json({ error: 'Business is required' });
      const business = (await db`SELECT id,name,loyalty_rate FROM loyalty_businesses WHERE id=${businessId}`).at(0);
      if (!business) return res.status(404).json({ error: 'Business not found' });
      return res.json({ business });
    }
    if (action === 'create_user') {
      const actor = await sessionUser(db, req, p.access_token); const businessId = requireBusiness(actor);
      if (!['admin','owner'].includes(actor.role)) return res.status(403).json({ error: 'Not allowed' });
      const email = String(p.email || '').trim().toLowerCase(), password = String(p.password || ''), role = String(p.role || 'staff');
      if (!email || password.length < 8 || !['owner','manager','staff'].includes(role)) return res.status(400).json({ error: 'Invalid user details' });
      const user = (await db`INSERT INTO loyalty_users(email,password_hash,role,business_id) VALUES(${email},${hashPassword(password)},${role},${businessId}) RETURNING id,email,role,business_id`).at(0);
      return res.json({ user });
    }
    if (action === 'merchant_rpc') {
      const actor = await sessionUser(db, req, p.access_token); const businessId = requireBusiness(actor);
      const name = String(p.name || ''), payload = p.payload || {};
      const business = (await db`SELECT id,name,loyalty_rate,qr_token FROM loyalty_businesses WHERE id=${businessId}`).at(0);
      if (name.includes('business_profile')) return res.json(business);
      if (name.includes('business_dashboard')) { const row=(await db`SELECT COALESCE(SUM(purchase_amount),0) sales,COALESCE(SUM(CASE WHEN type='earn' THEN earned_amount ELSE 0 END),0) earned,COALESCE(SUM(CASE WHEN type='redeem' THEN -earned_amount ELSE 0 END),0) redeemed,COUNT(*)::int transactions,COUNT(DISTINCT customer_id)::int customers FROM loyalty_transactions WHERE business_id=${businessId} AND created_at>=CURRENT_DATE`).at(0); const balance=(await db`SELECT COALESCE(SUM(balance),0) total FROM loyalty_wallets WHERE business_id=${businessId}`).at(0); return res.json({sales_today:row.sales,earned_today:row.earned,redeemed_today:row.redeemed,transactions_today:row.transactions,customers_today:row.customers,total_balance:balance.total,total_customer_balance:balance.total}); }
      if (name.includes('business_customers')) return res.json(await db`SELECT c.id customer_id,c.name,c.phone,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id WHERE c.business_id=${businessId} ORDER BY c.created_at DESC`);
      if (name.includes('business_transactions') || name.includes('loyalty_history')) { const limit=Math.min(100,Math.max(1,Number(payload.p_limit||20))); return res.json(await db`SELECT t.id transaction_id,c.name,c.phone,t.purchase_amount,t.earned_amount,t.type,t.created_at FROM loyalty_transactions t JOIN loyalty_customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE t.business_id=${businessId} ORDER BY t.created_at DESC LIMIT ${limit}`); }
      if (name.includes('redeem_loyalty_balance')) { const amount=Number(payload.p_redeem_amount),phoneKey=normalizePhone(payload.p_phone||''); if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Invalid amount'}); const c=(await db`SELECT c.id,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=${businessId} WHERE regexp_replace(c.phone,'[^0-9]','','g')=${phoneKey} AND c.business_id=${businessId}`).at(0); if(!c||Number(c.balance)<amount)return res.status(400).json({error:'Insufficient balance or invalid amount'}); const u=(await db`UPDATE loyalty_wallets SET balance=balance-${amount},updated_at=NOW() WHERE customer_id=${c.id} AND business_id=${businessId} AND balance>=${amount} RETURNING balance`).at(0); await db`INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount,type) VALUES(${c.id},${businessId},0,${-amount},'redeem')`; return res.json({redeemed_amount:amount,balance:u.balance}); }
      if (name.includes('create_loyalty_transaction')) { const amount=Number(payload.p_purchase_amount),phoneKey=normalizePhone(payload.p_phone||''); const c=(await db`SELECT c.id,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=${businessId} WHERE regexp_replace(c.phone,'[^0-9]','','g')=${phoneKey} AND c.business_id=${businessId}`).at(0); if(!c||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Customer or amount is invalid'}); const earned=Math.round(amount*Number(business.loyalty_rate))/100; const u=(await db`UPDATE loyalty_wallets SET balance=balance+${earned},updated_at=NOW() WHERE customer_id=${c.id} AND business_id=${businessId} RETURNING balance`).at(0); const tx=(await db`INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount) VALUES(${c.id},${businessId},${amount},${earned}) RETURNING id`).at(0); return res.json({transaction_id:tx.id,earned_amount:earned,balance:u.balance}); }
      return res.status(400).json({error:'Unsupported merchant operation'});
    }
    if (action === 'create_business') { const actor=await sessionUser(db,req,p.access_token); if(actor?.role!=='admin')return res.status(403).json({error:'Not allowed'}); const name=String(p.name||'').trim(),rate=Number(p.loyalty_rate??10); if(!name||!Number.isFinite(rate)||rate<0||rate>100)return res.status(400).json({error:'Invalid business details'}); const business=(await db`INSERT INTO loyalty_businesses(name,loyalty_rate,qr_token) VALUES(${name},${rate},${randomUUID()}) RETURNING id,name,loyalty_rate,qr_token`).at(0); await db`INSERT INTO loyalty_business_settings(business_id) VALUES(${business.id})`; return res.json({business}); }
    if (action === 'register_customer') { const phone=String(p.phone||'').trim(),name=String(p.name||'').trim(),businessId=Number(p.business_id||0); if(!name||!phone||!businessId)return res.status(400).json({error:'Name, phone, and business are required'}); const business=(await db`SELECT id FROM loyalty_businesses WHERE id=${businessId}`).at(0); if(!business)return res.status(409).json({error:'Business not found'}); const phoneKey=normalizePhone(phone); const existing=(await db`SELECT wallet_token FROM loyalty_customers WHERE business_id=${businessId} AND regexp_replace(phone,'[^0-9]','','g')=${phoneKey}`).at(0); if(existing)return res.json({token:existing.wallet_token}); const customer=(await db`INSERT INTO loyalty_customers(name,phone,business_id,wallet_token) VALUES(${name},${phone},${businessId},${randomUUID()}) RETURNING id,wallet_token`).at(0); await db`INSERT INTO loyalty_wallets(customer_id,business_id) VALUES(${customer.id},${businessId})`; return res.json({token:customer.wallet_token}); }
    if (action === 'wallet') { const token=String(p.token||''); const c=(await db`SELECT c.id,c.name,c.wallet_token,w.balance,b.name business_name,b.loyalty_rate,w.business_id FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id JOIN loyalty_businesses b ON b.id=w.business_id WHERE c.wallet_token=${token}`).at(0); if(!c)return res.status(404).json({error:'Wallet not found'}); const transactions=await db`SELECT purchase_amount,earned_amount,type,created_at FROM loyalty_transactions WHERE customer_id=${c.id} AND business_id=${c.business_id} ORDER BY created_at DESC LIMIT 100`; return res.json({customer:c,transactions}); }
    return res.status(400).json({error:'Unknown action'});
  } catch(error) {
    console.error('[v0] Neon API error:',error?.message||error);
    return res.status(error.status || 500).json({error:error.status ? error.message : 'Database operation failed'});
  }
}
