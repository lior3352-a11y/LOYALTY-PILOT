import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const COOKIE = '__Host-loyalty_admin';
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const readCookie = req => String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
const cookie = (res, token, age) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);
export function guard(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'JSON required');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied');
  if (req.headers.origin) {
    let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid origin'); }
    if (origin.protocol !== 'https:' || origin.host !== req.headers.host) fail(403, 'Invalid origin');
  }
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = String(stored || '').split(':');
  const actual = await derive(password, salt || 'invalid-admin-account', 32);
  const expected = Buffer.from(hash || '', 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
async function limitLogin(db, key, maximum) {
  const row = (await db`INSERT INTO loyalty_admin_limits(key,attempts,expires_at) VALUES(${digest(key)},1,NOW()+INTERVAL '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN loyalty_admin_limits.expires_at<NOW() THEN 1 ELSE loyalty_admin_limits.attempts+1 END,expires_at=CASE WHEN loyalty_admin_limits.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE loyalty_admin_limits.expires_at END RETURNING attempts`).at(0);
  if (row.attempts > maximum) fail(429, 'Too many attempts. Try again in 15 minutes');
}
export function createAdminHandler({ connect, site }) {
  if (!['us', 'israel'].includes(site)) throw new Error('Explicit admin site required');
  const meta = { site, billing_enabled: site === 'us', currency: site === 'us' ? 'USD' : null };
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    try {
      guard(req);
      const db = connect();
      const { action, ...p } = req.body || {};
      if (action === 'login') {
        const email = String(p.email || '').trim().toLowerCase();
        if (!email || email.length > 254 || typeof p.password !== 'string' || p.password.length > 128) fail(401, 'Invalid admin credentials');
        await db`CREATE TABLE IF NOT EXISTS loyalty_admin_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
        await limitLogin(db, 'email:' + email, 10);
        await limitLogin(db, 'ip:' + (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'), 50);
        const user = (await db`SELECT id,email,role,password_hash FROM loyalty_users WHERE email=${email}`).at(0);
        const valid = await passwordMatches(p.password, user?.password_hash);
        if (!valid || user?.role !== 'admin') fail(401, 'Invalid admin credentials');
        const token = randomBytes(32).toString('hex');
        await db`INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES(${digest(token)},${user.id},NOW()+INTERVAL '8 hours')`;
        cookie(res, token, 28800);
        return res.json({ ok: true, email: user.email, ...meta });
      }
      const token = readCookie(req);
      if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Admin sign-in required');
      const admin = (await db`SELECT u.id,u.email,u.role FROM loyalty_sessions s JOIN loyalty_users u ON u.id=s.user_id WHERE s.token=${digest(token)} AND s.expires_at>NOW() AND u.role='admin'`).at(0);
      if (!admin || admin.role !== 'admin') fail(403, 'Admin access required');
      if (action === 'logout') {
        await db`DELETE FROM loyalty_sessions WHERE token=${digest(token)}`;
        cookie(res, '', 0); return res.json({ ok: true });
      }
      if (action === 'session') return res.json({ email: admin.email, ...meta });
      const page = Math.max(1, Math.min(100000, Math.trunc(Number(p.page)) || 1));
      const size = 50, offset = (page - 1) * size;
      const q = String(p.q || '').trim().slice(0, 200), search = '%' + q.toLowerCase() + '%';
      if (action === 'overview') {
        const row = (await db`SELECT
          (SELECT COUNT(*)::int FROM loyalty_businesses) AS businesses,
          (SELECT COUNT(*)::int FROM loyalty_users) AS business_users,
          (SELECT COUNT(*)::int FROM loyalty_customers) AS customer_memberships,
          (SELECT COUNT(*)::int FROM loyalty_businesses WHERE created_at>=NOW()-INTERVAL '7 days') AS new_businesses_7d,
          (SELECT COUNT(*)::int FROM loyalty_customers WHERE created_at>=NOW()-INTERVAL '7 days') AS new_memberships_7d,
          (SELECT COUNT(*)::int FROM loyalty_subscriptions WHERE subscription_status='active') AS active_subscriptions,
          (SELECT COUNT(*)::int FROM loyalty_subscriptions WHERE subscription_status='trialing' AND trial_end>=NOW()) AS trials,
          (SELECT COUNT(*)::int FROM loyalty_subscriptions WHERE subscription_status='past_due') AS past_due,
          (SELECT COUNT(*)::int FROM loyalty_subscriptions WHERE subscription_status='expired' OR (subscription_status='trialing' AND trial_end<NOW())) AS expired,
          (SELECT COALESCE(SUM(monthly_price_cents),0) FROM loyalty_subscriptions WHERE subscription_status='active') AS contracted_monthly_cents,
          (SELECT COALESCE(SUM(amount_paid_cents),0) FROM loyalty_payment_history WHERE status='paid') AS collected_cents,
          (SELECT COALESCE(SUM(amount_paid_cents),0) FROM loyalty_payment_history WHERE status='paid' AND paid_at>=DATE_TRUNC('month',NOW())) AS collected_month_cents`).at(0);
        const accountTable = (await db`SELECT to_regclass('loyalty_customer_accounts') IS NOT NULL AS present`).at(0).present;
        const accounts = accountTable ? Number((await db`SELECT COUNT(*)::int AS count FROM loyalty_customer_accounts`).at(0).count) : null;
        return res.json({ ...meta, overview: { ...row, customer_accounts: accounts, ...(site === 'israel' ? { contracted_monthly_cents: null, collected_cents: null, collected_month_cents: null } : {}) } });
      }
      if (action === 'businesses') {
        const status = String(p.status || '');
        const rows = await db`WITH records AS (SELECT b.id,b.name,b.phone,b.loyalty_rate,b.created_at,
          (SELECT COUNT(*)::int FROM loyalty_customers c WHERE c.business_id=b.id) AS customers,
          (SELECT COUNT(*)::int FROM loyalty_transactions t WHERE t.business_id=b.id) AS transactions,
          (SELECT MAX(created_at) FROM loyalty_transactions t WHERE t.business_id=b.id) AS last_activity,
          (SELECT string_agg(email,', ' ORDER BY email) FROM loyalty_users u WHERE u.business_id=b.id AND role IN ('owner','admin')) AS owner_emails,
          CASE WHEN s.subscription_status='trialing' AND s.trial_end<NOW() THEN 'expired' ELSE COALESCE(s.subscription_status,'unconfigured') END AS subscription_status,
          s.trial_end,s.next_billing_date,s.monthly_price_cents
          FROM loyalty_businesses b LEFT JOIN loyalty_subscriptions s ON s.business_id=b.id)
          SELECT *,COUNT(*) OVER()::int AS total FROM records WHERE (${q}='' OR lower(name||' '||COALESCE(phone,'')||' '||COALESCE(owner_emails,'')) LIKE ${search}) AND (${status}='' OR subscription_status=${status}) ORDER BY created_at DESC,id DESC LIMIT ${size} OFFSET ${offset}`;
        const total = rows.length ? rows[0].total : Number((await db`SELECT COUNT(*)::int AS total FROM loyalty_businesses b LEFT JOIN loyalty_subscriptions s ON s.business_id=b.id WHERE (${q}='' OR lower(b.name||' '||COALESCE(b.phone,'')||' '||COALESCE((SELECT string_agg(email,', ' ORDER BY email) FROM loyalty_users u WHERE u.business_id=b.id AND role IN ('owner','admin')),'')) LIKE ${search}) AND (${status}='' OR CASE WHEN s.subscription_status='trialing' AND s.trial_end<NOW() THEN 'expired' ELSE COALESCE(s.subscription_status,'unconfigured') END=${status})`).at(0).total);
        return res.json({ ...meta, rows: rows.map(({total: _, ...r}) => ({ ...r, monthly_price_cents: site === 'us' ? r.monthly_price_cents : null })), total, page, page_size: size });
      }
      if (action === 'customers') {
        // Account and QR-only records have different schemas. Aggregate wallets and
        // activity separately so multiple transactions cannot inflate balances.
        const hasAccounts = (await db`SELECT to_regclass('loyalty_customer_accounts') IS NOT NULL AS present`).at(0).present;
        const records = hasAccounts ? await db`WITH records AS (
          SELECT 'account:'||a.id AS key,a.first_name||' '||a.last_name AS name,a.phone,a.email,a.created_at,
            (SELECT b.name FROM loyalty_customers c JOIN loyalty_businesses b ON b.id=c.business_id WHERE c.account_id=a.id ORDER BY c.created_at,c.id LIMIT 1) AS source_business,
            (SELECT string_agg(DISTINCT b.name,', ') FROM loyalty_customers c JOIN loyalty_businesses b ON b.id=c.business_id WHERE c.account_id=a.id) AS businesses,
            (SELECT COALESCE(SUM(w.balance),0) FROM loyalty_wallets w JOIN loyalty_customers c ON c.id=w.customer_id AND c.business_id=w.business_id WHERE c.account_id=a.id) AS reward_balance,
            (SELECT MAX(t.created_at) FROM loyalty_transactions t JOIN loyalty_customers c ON c.id=t.customer_id AND c.business_id=t.business_id WHERE c.account_id=a.id) AS last_activity
          FROM loyalty_customer_accounts a
          UNION ALL
          SELECT 'qr:'||c.id,c.name,c.phone,NULL,c.created_at,b.name,b.name,
            (SELECT COALESCE(SUM(balance),0) FROM loyalty_wallets w WHERE w.customer_id=c.id AND w.business_id=c.business_id),
            (SELECT MAX(t.created_at) FROM loyalty_transactions t WHERE t.customer_id=c.id AND t.business_id=c.business_id)
          FROM loyalty_customers c LEFT JOIN loyalty_businesses b ON b.id=c.business_id WHERE c.account_id IS NULL)
          SELECT *,COUNT(*) OVER()::int AS total FROM records WHERE (${q}='' OR lower(COALESCE(name,'')||' '||COALESCE(phone,'')||' '||COALESCE(email,'')||' '||COALESCE(businesses,'')) LIKE ${search}) ORDER BY created_at DESC,key LIMIT ${size} OFFSET ${offset}` : await db`SELECT 'qr:'||c.id AS key,c.name,c.phone,NULL AS email,c.created_at,b.name AS source_business,b.name AS businesses,
            (SELECT COALESCE(SUM(balance),0) FROM loyalty_wallets w WHERE w.customer_id=c.id AND w.business_id=c.business_id) AS reward_balance,
            (SELECT MAX(t.created_at) FROM loyalty_transactions t WHERE t.customer_id=c.id AND t.business_id=c.business_id) AS last_activity,COUNT(*) OVER()::int AS total
          FROM loyalty_customers c LEFT JOIN loyalty_businesses b ON b.id=c.business_id
          WHERE (${q}='' OR lower(COALESCE(c.name,'')||' '||COALESCE(c.phone,'')||' '||COALESCE(b.name,'')) LIKE ${search}) ORDER BY c.created_at DESC,c.id DESC LIMIT ${size} OFFSET ${offset}`;
        return res.json({ ...meta, rows: records.map(({total: _, ...r}) => r), total: records[0]?.total ?? null, page, page_size: size });
      }
      if (action === 'payments') {
        const rows = await db`SELECT p.id,b.name AS business_name,p.amount_paid_cents,p.status,p.paid_at,p.created_at,COUNT(*) OVER()::int AS total FROM loyalty_payment_history p JOIN loyalty_businesses b ON b.id=p.business_id WHERE (${q}='' OR lower(b.name||' '||p.status) LIKE ${search}) ORDER BY p.created_at DESC,p.id DESC LIMIT ${size} OFFSET ${offset}`;
        return res.json({ ...meta, rows: rows.map(({total: _, ...r}) => r), total: rows[0]?.total ?? null, page, page_size: size });
      }
      if (action === 'users') {
        const rows = await db`SELECT u.id,u.email,u.role,u.created_at,b.name AS business_name,COUNT(*) OVER()::int AS total FROM loyalty_users u LEFT JOIN loyalty_businesses b ON b.id=u.business_id WHERE (${q}='' OR lower(u.email||' '||COALESCE(b.name,'')) LIKE ${search}) ORDER BY u.created_at DESC,u.id DESC LIMIT ${size} OFFSET ${offset}`;
        return res.json({ ...meta, rows: rows.map(({total: _, ...r}) => r), total: rows[0]?.total ?? null, page, page_size: size });
      }
      if (action === 'update_business') {
        const id = Number(p.id), name = String(p.name || '').trim(), rate = Number(p.loyalty_rate);
        if (!Number.isSafeInteger(id) || id<=0 || !name || name.length>200 || !Number.isFinite(rate) || rate<0 || rate>100) fail(400,'Invalid business details');
        const business = (await db`UPDATE loyalty_businesses SET name=${name},loyalty_rate=${rate} WHERE id=${id} RETURNING id,name,loyalty_rate`).at(0);
        if (!business) fail(404,'Business not found');
        return res.json({ business });
      }
      fail(400,'Unknown admin action');
    } catch (error) {
      if (!error.status) console.error('[admin] Operation failed');
      return res.status(error.status || 500).json({ error: error.status ? error.message : 'Admin operation failed' });
    }
  };
}
