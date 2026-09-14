import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

const db = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
};
const stripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

async function sessionUser(sql, req, suppliedToken) {
  const header = req.headers.authorization || '';
  const token = suppliedToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token) return null;
  return (await sql`SELECT u.id,u.email,u.role,u.business_id FROM loyalty_sessions s JOIN loyalty_users u ON u.id=s.user_id WHERE s.token=${token} AND s.expires_at>NOW()`).at(0) || null;
}
function businessId(user) {
  if (!user?.business_id) { const error = new Error('Business workspace required'); error.status = 403; throw error; }
  return Number(user.business_id);
}
async function ensureBilling(sql) {
  await sql`CREATE TABLE IF NOT EXISTS loyalty_subscriptions (business_id BIGINT PRIMARY KEY REFERENCES loyalty_businesses(id) ON DELETE CASCADE, trial_start TIMESTAMPTZ NOT NULL, trial_end TIMESTAMPTZ NOT NULL, subscription_status TEXT NOT NULL CHECK (subscription_status IN ('trialing','active','past_due','canceled','expired')), subscription_start TIMESTAMPTZ, next_billing_date TIMESTAMPTZ, stripe_customer_id TEXT UNIQUE, stripe_subscription_id TEXT UNIQUE, plan_name TEXT NOT NULL DEFAULT 'Loyalty US Standard', monthly_price_cents INTEGER NOT NULL DEFAULT 4900, canceled_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS loyalty_payment_history (id BIGSERIAL PRIMARY KEY, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, stripe_invoice_id TEXT UNIQUE NOT NULL, amount_paid_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE INDEX IF NOT EXISTS loyalty_payment_history_business_idx ON loyalty_payment_history(business_id, created_at DESC)`;
}
async function createTrial(sql, id) {
  return (await sql`INSERT INTO loyalty_subscriptions(business_id,trial_start,trial_end,subscription_status) VALUES(${id},NOW(),NOW()+INTERVAL '14 days','trialing') ON CONFLICT (business_id) DO UPDATE SET subscription_status=CASE WHEN loyalty_subscriptions.subscription_status='trialing' AND loyalty_subscriptions.trial_end<NOW() THEN 'expired' ELSE loyalty_subscriptions.subscription_status END,updated_at=NOW() RETURNING *`).at(0);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    const sql = db(); await ensureBilling(sql);
    const { action, ...p } = req.body || {};
    const user = await sessionUser(sql, req, p.access_token);
    const id = businessId(user);
    if (action === 'get_billing') {
      const subscription = await createTrial(sql, id);
      const payments = await sql`SELECT stripe_invoice_id,amount_paid_cents,status,paid_at,created_at FROM loyalty_payment_history WHERE business_id=${id} ORDER BY created_at DESC LIMIT 50`;
      return res.json({ subscription, payments });
    }
    if (action === 'create_subscription') {
      const business = (await sql`SELECT id,name FROM loyalty_businesses WHERE id=${id}`).at(0);
      const subscription = await createTrial(sql, id);
      const client = stripe();
      const customer = subscription.stripe_customer_id ? await client.customers.retrieve(subscription.stripe_customer_id) : await client.customers.create({ name: business.name, metadata: { business_id: String(id) } });
      const created = await client.subscriptions.create({ customer: customer.id, items: [{ price_data: { currency: 'usd', product_data: { name: 'Loyalty US Standard' }, unit_amount: 4900, recurring: { interval: 'month' } } }], trial_period_days: Math.max(0, Math.ceil((new Date(subscription.trial_end).getTime()-Date.now())/86400000)), metadata: { business_id: String(id) } });
      const saved = (await sql`UPDATE loyalty_subscriptions SET stripe_customer_id=${customer.id},stripe_subscription_id=${created.id},subscription_status=${created.status === 'trialing' ? 'trialing' : 'active'},subscription_start=COALESCE(subscription_start,NOW()),next_billing_date=TO_TIMESTAMP(${created.trial_end || created.current_period_end}),updated_at=NOW() WHERE business_id=${id} RETURNING *`).at(0);
      return res.json({ subscription: saved });
    }
    if (action === 'cancel_subscription') {
      const current = (await sql`SELECT stripe_subscription_id FROM loyalty_subscriptions WHERE business_id=${id}`).at(0);
      if (!current?.stripe_subscription_id) return res.status(400).json({ error: 'No Stripe subscription exists' });
      await stripe().subscriptions.update(current.stripe_subscription_id, { cancel_at_period_end: true });
      const saved = (await sql`UPDATE loyalty_subscriptions SET subscription_status='canceled',canceled_at=NOW(),updated_at=NOW() WHERE business_id=${id} RETURNING *`).at(0);
      return res.json({ subscription: saved });
    }
    return res.status(400).json({ error: 'Unknown billing action' });
  } catch (error) { console.error('[v0] Billing API error:', error?.message || error); return res.status(error.status || 500).json({ error: error.status ? error.message : 'Billing operation failed' }); }
}
