require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });

function slug(value = 'business') {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'business';
}
function businessId() { return `biz_${crypto.randomBytes(5).toString('hex')}`; }
function mapBusiness(row) {
  if (!row) return null;
  return {
    id: row.business_id,
    name: row.business_name,
    category: row.category || 'general',
    email: row.email,
    status: row.status || 'active',
    reward: Number(row.reward || 5),
    slug: row.slug || slug(row.business_name),
    qrUrl: row.qr_url,
    stripeCustomerId: row.stripe_customer_id || '',
    subscriptionId: row.subscription_id || '',
    createdAt: row.created_at
  };
}
async function getBusiness(id) {
  const { rows } = await pool.query('SELECT * FROM businesses WHERE business_id = $1 LIMIT 1', [id]);
  return mapBusiness(rows[0]);
}

async function getDashboardData(id) {
  const business = await getBusiness(id);
  if (!business) return null;
  const [customers, points, transactions, reward, returnRate] = await Promise.all([
    pool.query('SELECT COUNT(DISTINCT customer_id)::int AS count FROM wallets WHERE business_id = $1', [id]),
    pool.query('SELECT COALESCE(SUM(points_earned), 0)::int AS total FROM transactions WHERE business_id = $1', [id]),
    pool.query('SELECT customer_phone, points_earned, created_at FROM transactions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 8', [id]),
    pool.query('SELECT reward_value FROM rewards WHERE business_id = $1 ORDER BY id LIMIT 1', [id]),
    pool.query('SELECT COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE visits > 1) / NULLIF(COUNT(*), 0)), 0)::int AS percent FROM (SELECT customer_id, COUNT(*) AS visits FROM transactions t JOIN customers c ON c.phone = t.customer_phone WHERE t.business_id = $1 GROUP BY customer_id) visits', [id])
  ]);
  return {
    business,
    metrics: {
      customers: customers.rows[0].count,
      points: points.rows[0].total,
      transactions: transactions.rows.length,
      reward: Number(reward.rows[0]?.reward_value ?? business.reward),
      returnRate: returnRate.rows[0].percent,
      rewardsClaimed: transactions.rows.length
    },
    transactions: transactions.rows.map((row) => ({ phone: row.customer_phone, amount: Number(row.points_earned), createdAt: row.created_at }))
  };
}
async function ensureReward(client, id, points) {
  const existing = await client.query('SELECT id, reward_value FROM rewards WHERE business_id = $1 ORDER BY id LIMIT 1', [id]);
  if (existing.rows[0]) return existing.rows[0];
  const created = await client.query('INSERT INTO rewards (business_id, customer_phone, reward_name, reward_value, status) VALUES ($1, NULL, $2, $3, $4) RETURNING id, reward_value', [id, 'Welcome reward', points, 'active']);
  return created.rows[0];
}

app.use(express.static(`${__dirname}/public`));

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_x');
    let event = req.body;
    if (process.env.STRIPE_WEBHOOK_SECRET) event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const existing = await pool.query('SELECT business_id FROM businesses WHERE email = $1 LIMIT 1', [s.customer_details?.email || '']);
      if (!existing.rows[0]) await createBusiness({ businessName: s.metadata?.businessName || 'New Business', category: s.metadata?.category, email: s.customer_details?.email || '', status: 'active', stripeCustomerId: s.customer, subscriptionId: s.subscription });
    }
    res.json({ received: true });
  } catch (err) { console.error(err); res.status(400).send(`Webhook Error: ${err.message}`); }
});

app.use(express.json());

async function createBusiness({ businessName, category, email, status = 'demo-active', stripeCustomerId = '', subscriptionId = '' }) {
  const id = businessId();
  const businessSlug = `${slug(businessName)}-${id.slice(-4)}`;
  const qrUrl = `${BASE_URL}/claim.html?biz=${encodeURIComponent(id)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`INSERT INTO businesses (business_id, business_name, category, email, qr_url, slug, status, reward, stripe_customer_id, subscription_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING *`, [id, businessName, category || 'general', email, qrUrl, businessSlug, status, 5, stripeCustomerId || null, subscriptionId || null]);
    await ensureReward(client, id, 5);
    await client.query(`INSERT INTO subscriptions (business_id, stripe_customer_id, stripe_subscription_id, status) VALUES ($1, $2, $3, $4) ON CONFLICT (business_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_subscription_id = EXCLUDED.stripe_subscription_id, status = EXCLUDED.status`, [id, stripeCustomerId || null, subscriptionId || null, status]);
    await client.query('COMMIT');
    const business = mapBusiness({ ...inserted.rows[0], category, status, reward: 5, slug: businessSlug, stripe_customer_id: stripeCustomerId, subscription_id: subscriptionId });
    return business;
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
}

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { businessName, category, email } = req.body;
    if (!businessName || !email) return res.status(400).json({ error: 'Business name and email are required' });
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID || process.env.STRIPE_SECRET_KEY.includes('replace_me') || process.env.STRIPE_PRICE_ID.includes('replace_me')) {
      const biz = await createBusiness({ businessName, category, email });
      return res.json({ demo: true, url: `/success.html?biz=${encodeURIComponent(biz.id)}` });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], customer_email: email, allow_promotion_codes: true, success_url: `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${BASE_URL}/signup.html?cancelled=1`, metadata: { businessName, category: category || 'general' } });
    res.json({ url: session.url });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/business/:id', async (req, res) => {
  try { const biz = await getBusiness(req.params.id); if (!biz) return res.status(404).json({ error: 'Business not found' }); res.json(biz); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dashboard/:id', async (req, res) => {
  try {
    const dashboard = await getDashboardData(req.params.id);
    if (!dashboard) return res.status(404).json({ error: 'Business not found' });
    res.json(dashboard);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/business-by-session/:sessionId', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('replace_me')) return res.status(400).json({ error: 'Stripe not configured' });
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const result = await pool.query('SELECT * FROM businesses WHERE email = $1 LIMIT 1', [session.customer_details?.email || '']);
    const biz = result.rows[0] ? mapBusiness(result.rows[0]) : await createBusiness({ businessName: session.metadata?.businessName || 'New Business', category: session.metadata?.category, email: session.customer_details?.email || '', status: 'active', stripeCustomerId: session.customer, subscriptionId: session.subscription });
    res.json(biz);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/claim', async (req, res) => {
  const { businessId, phone, reward = 5 } = req.body;
  if (!businessId || !phone) return res.status(400).json({ error: 'Missing fields' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bizResult = await client.query('SELECT * FROM businesses WHERE business_id = $1 LIMIT 1', [businessId]);
    const biz = mapBusiness(bizResult.rows[0]);
    if (!biz) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Business not found' }); }
    const customerResult = await client.query('INSERT INTO customers (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, phone', [phone]);
    const customer = customerResult.rows[0];
    const rewardRow = await ensureReward(client, businessId, Number(reward));
    const wallet = await client.query(`INSERT INTO wallets (customer_id, business_id, balance) VALUES ($1, $2, $3) ON CONFLICT (customer_id, business_id) DO UPDATE SET balance = wallets.balance + EXCLUDED.balance, updated_at = NOW() RETURNING balance`, [customer.id, businessId, Number(reward)]);
    await client.query('INSERT INTO transactions (business_id, customer_phone, points_earned, reward_amount, purchase_amount, created_at) VALUES ($1, $2, $3, $4, $5, NOW())', [businessId, phone, Number(reward), Number(reward), 0]);
    await client.query('COMMIT');
    res.json({ ok: true, wallet: { businessName: biz.name, balance: Number(wallet.rows[0].balance), history: [{ type: 'earn', amount: Number(reward), ts: new Date().toISOString() }] } });
  } catch (err) { await client.query('ROLLBACK'); console.error(err); res.status(500).json({ error: err.message }); } finally { client.release(); }
});

app.get('/api/wallet/:phone', async (req, res) => {
  try {
    const customer = await pool.query('SELECT id, phone, created_at FROM customers WHERE phone = $1 LIMIT 1', [req.params.phone]);
    if (!customer.rows[0]) return res.json({ phone: req.params.phone, wallets: {} });
    const wallets = await pool.query(`SELECT w.business_id, w.balance, b.business_name, w.updated_at FROM wallets w JOIN businesses b ON b.business_id = w.business_id WHERE w.customer_id = $1 ORDER BY w.updated_at DESC`, [customer.rows[0].id]);
    const history = await pool.query('SELECT business_id, points_earned, created_at FROM transactions WHERE customer_phone = $1 ORDER BY created_at DESC', [req.params.phone]);
    const grouped = {};
    for (const wallet of wallets.rows) grouped[wallet.business_id] = { businessName: wallet.business_name, balance: Number(wallet.balance), history: history.rows.filter(item => item.business_id === wallet.business_id).map(item => ({ type: 'earn', amount: Number(item.points_earned), ts: item.created_at })) };
    res.json({ phone: customer.rows[0].phone, wallets: grouped, createdAt: customer.rows[0].created_at });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`LOYALTY running on ${BASE_URL}`));
