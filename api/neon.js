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

async function ensureSchema(db) {
  await db`CREATE TABLE IF NOT EXISTS loyalty_businesses (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, loyalty_rate NUMERIC(6,2) NOT NULL DEFAULT 10, qr_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, wallet_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_wallets (customer_id BIGINT PRIMARY KEY REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, balance NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_transactions (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, purchase_amount NUMERIC(12,2) NOT NULL, earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'earn', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_users (id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','owner','manager','staff')), business_id BIGINT REFERENCES loyalty_businesses(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const db = sql(); await ensureSchema(db);
    const { action, ...p } = req.body || {};
    if (action === 'login') {
      const email = String(p.email || '').trim().toLowerCase(), password = String(p.password || '');
      const user = (await db`SELECT id, email, role, business_id, password_hash FROM loyalty_users WHERE email=${email}`)[0];
      if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
      return res.json({ token: randomUUID(), email: user.email, role: user.role, business_id: user.business_id });
    }
    if (action === 'create_user') {
      const email = String(p.email || '').trim().toLowerCase(), password = String(p.password || ''), role = String(p.role || 'owner');
      const businessId = p.business_id ? Number(p.business_id) : null;
      if (!email || password.length < 8 || !['admin','owner','manager','staff'].includes(role)) return res.status(400).json({ error: 'Invalid user details' });
      const user = (await db`INSERT INTO loyalty_users (email,password_hash,role,business_id) VALUES (${email},${hashPassword(password)},${role},${businessId}) RETURNING id,email,role,business_id`)[0];
      return res.json({ user });
    }
    if (action === 'merchant_rpc') {
      const name = String(p.name || ''), payload = p.payload || {};
      const businessId = Number(payload.business_id || 0);
      const business = (await db`SELECT id, name, loyalty_rate, qr_token FROM loyalty_businesses WHERE id=${businessId}`).at(0);
      if (!business) return res.status(404).json({ error: 'Business not found' });
      if (name.includes('business_profile')) return res.json(business);
      if (name.includes('business_dashboard')) { const row=(await db`SELECT COALESCE(SUM(purchase_amount),0) sales,COALESCE(SUM(CASE WHEN type='earn' THEN earned_amount ELSE 0 END),0) earned,COALESCE(SUM(CASE WHEN type='redeem' THEN -earned_amount ELSE 0 END),0) redeemed,COUNT(*)::int transactions,COUNT(DISTINCT customer_id)::int customers FROM loyalty_transactions WHERE business_id=${business.id} AND created_at>=CURRENT_DATE`).at(0); const balance=(await db`SELECT COALESCE(SUM(balance),0) total FROM loyalty_wallets WHERE business_id=${business.id}`).at(0); return res.json({sales_today:row.sales,earned_today:row.earned,redeemed_today:balance?row.redeemed:0,transactions_today:row.transactions,customers_today:row.customers,total_balance:balance.total}); }
      if (name.includes('business_customers')) return res.json(await db`SELECT c.id customer_id,c.name,c.phone,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id WHERE w.business_id=${business.id} ORDER BY c.created_at DESC`);
      if (name.includes('business_transactions')) return res.json(await db`SELECT t.id transaction_id,c.name,c.phone,t.purchase_amount,t.earned_amount,t.type,t.created_at FROM loyalty_transactions t JOIN loyalty_customers c ON c.id=t.customer_id WHERE t.business_id=${business.id} ORDER BY t.created_at DESC LIMIT 100`);
      if (name.includes('redeem_loyalty_balance')) { const amount=Number(payload.p_redeem_amount),phone=String(payload.p_phone||''); if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Invalid amount'}); const c=(await db`SELECT c.id,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id WHERE c.phone=${phone} AND w.business_id=${business.id}`).at(0); if(!c||Number(c.balance)<amount)return res.status(400).json({error:'Insufficient balance or invalid amount'}); const u=(await db`UPDATE loyalty_wallets SET balance=balance-${amount},updated_at=NOW() WHERE customer_id=${c.id} AND balance>=${amount} RETURNING balance`).at(0); if(!u)return res.status(400).json({error:'Insufficient balance'}); await db`INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount,type) VALUES(${c.id},${business.id},0,${-amount},'redeem')`; return res.json({redeemed_amount:amount,balance:u.balance}); }
      if (name.includes('create_loyalty_transaction')) { const amount=Number(payload.p_purchase_amount),phone=String(payload.p_phone||''); const c=(await db`SELECT c.id,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id WHERE c.phone=${phone} AND w.business_id=${business.id}`).at(0); if(!c||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Customer or amount is invalid'}); const earned=Math.round(amount*Number(business.loyalty_rate))/100; const u=(await db`UPDATE loyalty_wallets SET balance=balance+${earned},updated_at=NOW() WHERE customer_id=${c.id} RETURNING balance`).at(0); const tx=(await db`INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount) VALUES(${c.id},${business.id},${amount},${earned}) RETURNING id`).at(0); return res.json({transaction_id:tx.id,earned_amount:earned,balance:u.balance}); }
      return res.status(400).json({error:'Unsupported merchant operation'});
    }
    if (action === 'admin_rpc') {
      const name=String(p.name||''), payload=p.payload||{};
      if(name==='is_system_admin') return res.json(true);
      if(name==='get_system_admin_businesses_secure') return res.json(await db`SELECT b.id business_id,b.name,b.loyalty_rate,COUNT(DISTINCT t.id)::int transactions_count,COUNT(DISTINCT w.customer_id)::int users_count FROM loyalty_businesses b LEFT JOIN loyalty_transactions t ON t.business_id=b.id LEFT JOIN loyalty_wallets w ON w.business_id=b.id GROUP BY b.id ORDER BY b.id`);
      if(name==='get_system_business_users_secure') return res.json(await db`SELECT u.id user_id,u.email,u.role,u.business_id FROM loyalty_users u WHERE u.business_id IS NOT NULL ORDER BY u.email`);
      if(name==='update_system_business_secure'){const id=Number(payload.p_business_id),n=String(payload.p_name||'').trim(),rate=Number(payload.p_loyalty_rate);if(!id||!n||!Number.isFinite(rate)||rate<0||rate>100)return res.status(400).json({error:'Invalid business details'});await db`UPDATE loyalty_businesses SET name=${n},loyalty_rate=${rate} WHERE id=${id}`;return res.json(true)}
      if(name==='link_system_user_to_business_secure'){await db`UPDATE loyalty_users SET business_id=${Number(payload.p_business_id)},role=${String(payload.p_role||'staff')} WHERE email=${String(payload.p_email||'').trim().toLowerCase()}`;return res.json(true)}
      if(name==='unlink_system_user_secure'){await db`UPDATE loyalty_users SET business_id=NULL WHERE id=${Number(payload.p_user_id)}`;return res.json(true)}
      return res.status(400).json({error:'Unsupported admin operation'});
    }
    if(action==='create_business'){const name=String(p.name||'').trim(),rate=Number(p.loyalty_rate??10);if(!name||!Number.isFinite(rate)||rate<0||rate>100)return res.status(400).json({error:'Invalid business details'});const business=(await db`INSERT INTO loyalty_businesses(name,loyalty_rate,qr_token) VALUES(${name},${rate},${randomUUID()}) RETURNING id,name,loyalty_rate,qr_token`).at(0);return res.json({business})}
    if(action==='register_customer'){const phone=String(p.phone||'').trim(),name=String(p.name||'').trim(),businessId=Number(p.business_id||0);if(!name||!phone)return res.status(400).json({error:'Name and phone are required'});const existing=(await db`SELECT wallet_token FROM loyalty_customers WHERE phone=${phone}`).at(0);if(existing)return res.json({token:existing.wallet_token});if(!businessId)return res.status(400).json({error:'A business is required'});const business=(await db`SELECT id FROM loyalty_businesses WHERE id=${businessId}`).at(0);if(!business)return res.status(409).json({error:'Business not found'});const customer=(await db`INSERT INTO loyalty_customers(name,phone,wallet_token) VALUES(${name},${phone},${randomUUID()}) RETURNING id,wallet_token`).at(0);await db`INSERT INTO loyalty_wallets(customer_id,business_id) VALUES(${customer.id},${business.id})`;return res.json({token:customer.wallet_token})}
    if(action==='wallet'){const token=String(p.token||''),c=(await db`SELECT c.name,c.wallet_token,w.balance,b.name business_name,b.loyalty_rate FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id JOIN loyalty_businesses b ON b.id=w.business_id WHERE c.wallet_token=${token}`).at(0);if(!c)return res.status(404).json({error:'Wallet not found'});const transactions=await db`SELECT purchase_amount,earned_amount,type,created_at FROM loyalty_transactions WHERE customer_id=(SELECT id FROM loyalty_customers WHERE wallet_token=${token}) ORDER BY created_at DESC LIMIT 100`;return res.json({customer:c,transactions})}
    return res.status(400).json({error:'Unknown action'});
  } catch(error) { console.error('[v0] Neon API error:',error?.message||error); return res.status(500).json({error:'Database operation failed'}); }
}
