import { neon } from '@neondatabase/serverless';

const sql = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
};

async function ensureSchema(db) {
  await db`CREATE TABLE IF NOT EXISTS loyalty_businesses (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, loyalty_rate NUMERIC(6,2) NOT NULL DEFAULT 10, qr_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customers (id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, wallet_token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_wallets (customer_id BIGINT PRIMARY KEY REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, balance NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_transactions (id BIGSERIAL PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, purchase_amount NUMERIC(12,2) NOT NULL, earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'earn', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  const rows = await db`SELECT id FROM loyalty_businesses ORDER BY id LIMIT 1`;
  if (!rows.length) await db`INSERT INTO loyalty_businesses (name, loyalty_rate, qr_token) VALUES ('קפה העיר', 12, ${crypto.randomUUID()})`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const db = sql(); await ensureSchema(db);
    const { action, ...p } = req.body || {};
    if (action === 'admin_rpc') {
      const name = String(p.name || ''), payload = p.payload || {};
      if (name === 'is_system_admin') return res.json(true);
      if (name === 'get_system_admin_businesses_secure') {
        const businesses = await db`SELECT b.id AS business_id, b.name, b.loyalty_rate, COUNT(DISTINCT t.id)::int AS transactions_count, COUNT(DISTINCT w.customer_id)::int AS users_count FROM loyalty_businesses b LEFT JOIN loyalty_transactions t ON t.business_id=b.id LEFT JOIN loyalty_wallets w ON w.business_id=b.id GROUP BY b.id ORDER BY b.id`;
        return res.json(businesses);
      }
      if (name === 'get_system_business_users_secure') return res.json([]);
      if (name === 'update_system_business_secure') {
        const id = Number(payload.p_business_id), nameValue = String(payload.p_name || '').trim(), rate = Number(payload.p_loyalty_rate);
        if (!id || !nameValue || !Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ error: 'Invalid business details' });
        await db`UPDATE loyalty_businesses SET name=${nameValue}, loyalty_rate=${rate} WHERE id=${id}`; return res.json(true);
      }
      return res.status(400).json({ error: 'Unsupported admin operation' });
    }
    if (action === 'create_business') {
      const name = String(p.name || '').trim(), rate = Number(p.loyalty_rate ?? 10);
      if (!name || !Number.isFinite(rate) || rate < 0 || rate > 100) return res.status(400).json({ error: 'Invalid business details' });
      const business = (await db`INSERT INTO loyalty_businesses (name, loyalty_rate, qr_token) VALUES (${name}, ${rate}, ${crypto.randomUUID()}) RETURNING id, name, loyalty_rate, qr_token`)[0];
      return res.json({ business });
    }
    if (action === 'register_customer') {
      const phone = String(p.phone || '').trim(), name = String(p.name || '').trim();
      if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
      const existing = await db`SELECT c.*, w.balance FROM loyalty_customers c LEFT JOIN loyalty_wallets w ON w.customer_id=c.id WHERE c.phone=${phone}`;
      if (existing.length) return res.json({ token: existing[0].wallet_token });
      const token = crypto.randomUUID(); const business = (await db`SELECT id FROM loyalty_businesses ORDER BY id LIMIT 1`)[0];
      const customer = (await db`INSERT INTO loyalty_customers (name, phone, wallet_token) VALUES (${name}, ${phone}, ${token}) RETURNING id, wallet_token`)[0];
      await db`INSERT INTO loyalty_wallets (customer_id, business_id) VALUES (${customer.id}, ${business.id})`;
      return res.json({ token: customer.wallet_token });
    }
    if (action === 'wallet') {
      const c = (await db`SELECT c.name, c.wallet_token, w.balance, b.name AS business_name, b.loyalty_rate FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id JOIN loyalty_businesses b ON b.id=w.business_id WHERE c.wallet_token=${String(p.token || '')}`)[0];
      if (!c) return res.status(404).json({ error: 'Wallet not found' });
      const transactions = await db`SELECT purchase_amount, earned_amount, type, created_at FROM loyalty_transactions WHERE customer_id=(SELECT id FROM loyalty_customers WHERE wallet_token=${String(p.token || '')}) ORDER BY created_at DESC LIMIT 100`;
      return res.json({ customer: c, transactions });
    }
    if (action === 'earn') {
      const amount = Number(p.amount); if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
      const c = (await db`SELECT c.id, w.business_id, b.loyalty_rate FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id JOIN loyalty_businesses b ON b.id=w.business_id WHERE c.phone=${String(p.phone || '')}`)[0];
      if (!c) return res.status(404).json({ error: 'Customer not found' });
      const earned = Math.round(amount * Number(c.loyalty_rate) / 100 * 100) / 100;
      await db`UPDATE loyalty_wallets SET balance=balance+${earned}, updated_at=NOW() WHERE customer_id=${c.id}`;
      await db`INSERT INTO loyalty_transactions (customer_id,business_id,purchase_amount,earned_amount) VALUES (${c.id},${c.business_id},${amount},${earned})`;
      return res.json({ earned });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) { console.error('[v0] Neon API error:', error?.message || error); return res.status(500).json({ error: 'Database operation failed' }); }
}
