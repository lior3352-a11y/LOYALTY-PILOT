import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const COOKIE = '__Host-loyalty_customer';
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
const secret = () => randomBytes(32).toString('hex');
export function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'Use a password of 12–128 characters');
  const salt = secret();
  return `${salt}:${(await derive(password, salt, 32)).toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = String(stored || '').split(':');
  const actual = await derive(password, salt || 'invalid-account-timing-salt', 32);
  const bytes = Buffer.from(expected || '', 'hex');
  return bytes.length === actual.length && timingSafeEqual(bytes, actual);
}
export function requestGuard(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail(415, 'JSON required');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid origin'); }
    if (origin.protocol !== 'https:' || origin.host !== req.headers.host) fail(403, 'Invalid origin');
  }
}
export async function schema(db) {
  await db`ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await db`ALTER TABLE loyalty_customers ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customer_sessions (token_hash TEXT PRIMARY KEY, customer_id BIGINT NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE, auth_version INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_customer_setup (customer_id BIGINT PRIMARY KEY REFERENCES loyalty_customers(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_redemption_approvals (customer_id BIGINT PRIMARY KEY REFERENCES loyalty_customers(id) ON DELETE CASCADE, business_id BIGINT NOT NULL REFERENCES loyalty_businesses(id) ON DELETE CASCADE, token_hash TEXT NOT NULL, session_hash TEXT NOT NULL REFERENCES loyalty_customer_sessions(token_hash) ON DELETE CASCADE, amount NUMERIC(12,2) NOT NULL CHECK(amount>0), expires_at TIMESTAMPTZ NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS loyalty_auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
}
export async function rateLimit(db, key, limit = 15) {
  const row = (await db`INSERT INTO loyalty_auth_limits(key,attempts,expires_at) VALUES(${digest(key)},1,NOW()+INTERVAL '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN loyalty_auth_limits.expires_at<NOW() THEN 1 ELSE loyalty_auth_limits.attempts+1 END,expires_at=CASE WHEN loyalty_auth_limits.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE loyalty_auth_limits.expires_at END RETURNING attempts`).at(0);
  if (row.attempts > limit) fail(429, 'Too many attempts. Try again in 15 minutes');
}
export function sessionToken(req) {
  return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
async function startSession(db, res, customer) {
  const token = secret();
  await db`INSERT INTO loyalty_customer_sessions(token_hash,customer_id,auth_version,expires_at) VALUES(${digest(token)},${customer.id},${customer.auth_version},NOW()+INTERVAL '12 hours')`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
}
export async function customerSession(db, req) {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Please sign in');
  const customer = (await db`SELECT c.id,c.name,c.phone,c.business_id,c.auth_version FROM loyalty_customer_sessions s JOIN loyalty_customers c ON c.id=s.customer_id AND c.auth_version=s.auth_version WHERE s.token_hash=${digest(token)} AND s.expires_at>NOW()`).at(0);
  if (!customer) fail(401, 'Please sign in');
  return customer;
}
export function amountValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 9999999999.99 || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001) fail(400, 'Invalid amount');
  return n.toFixed(2);
}

export async function customerAction(db, req, res, action, p) {
  if (!['register_customer','customer_login','customer_logout','customer_set_password','customer_approve_redemption','wallet'].includes(action)) return false;
  if (['register_customer','customer_login','customer_set_password'].includes(action)) {
    // Vercel supplies this header; the account limit remains effective if it is absent.
    await rateLimit(db, 'ip:' + (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'), 100);
    await rateLimit(db, `customer:${p.business_id}:${String(p.phone || '').trim()}`, 15);
  }
  if (action === 'register_customer') {
    const phone = String(p.phone || '').trim(), name = String(p.name || '').trim(), business = Number(p.business_id);
    if (!name || name.length > 120 || !/^[+\d][\d ()-]{6,24}$/.test(phone) || !Number.isSafeInteger(business) || business <= 0) fail(400, 'Name, phone and business are required');
    const hash = await passwordHash(p.password);
    const rows = await db`WITH created AS (INSERT INTO loyalty_customers(name,phone,business_id,wallet_token,password_hash) SELECT ${name},${phone},id,${secret()},${hash} FROM loyalty_businesses WHERE id=${business} ON CONFLICT(business_id,phone) DO NOTHING RETURNING id,auth_version,business_id), balance AS (INSERT INTO loyalty_wallets(customer_id,business_id) SELECT id,business_id FROM created RETURNING customer_id) SELECT created.* FROM created JOIN balance ON balance.customer_id=created.id`;
    if (!rows.length) fail(409, 'Unable to register. If you already joined, sign in or ask the business to verify your identity and restore access');
    await startSession(db, res, rows[0]); res.status(201).json({ ok: true }); return true;
  }
  if (action === 'customer_login') {
    const customer = (await db`SELECT id,password_hash,auth_version FROM loyalty_customers WHERE business_id=${Number(p.business_id) || 0} AND phone=${String(p.phone || '').trim()}`).at(0);
    const valid = await passwordMatches(p.password, customer?.password_hash);
    if (!customer || !valid) fail(401, 'Invalid sign-in details. For an older account or a forgotten password, ask the business to verify your identity and restore access');
    await startSession(db, res, customer); res.json({ ok: true }); return true;
  }
  if (action === 'customer_set_password') {
    if (!/^[a-f0-9]{64}$/.test(String(p.setup_token || ''))) fail(400, 'Invalid or expired setup code');
    const hash = await passwordHash(p.password);
    const customer = (await db`WITH consumed AS (DELETE FROM loyalty_customer_setup WHERE token_hash=${digest(p.setup_token)} AND expires_at>NOW() RETURNING customer_id), updated AS (UPDATE loyalty_customers c SET password_hash=${hash},auth_version=auth_version+1 FROM consumed WHERE c.id=consumed.customer_id RETURNING c.id,c.auth_version) SELECT * FROM updated`).at(0);
    if (!customer) fail(400, 'Invalid or expired setup code');
    await startSession(db, res, customer); res.json({ ok: true }); return true;
  }
  if (action === 'customer_logout') {
    await db`DELETE FROM loyalty_customer_sessions WHERE token_hash=${digest(sessionToken(req))}`;
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true }); return true;
  }
  const c = await customerSession(db, req);
  if (action === 'wallet') {
    const customer = (await db`SELECT c.id,c.name,w.balance,b.name business_name,b.loyalty_rate,b.id business_id FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id JOIN loyalty_businesses b ON b.id=c.business_id WHERE c.id=${c.id} AND c.business_id=${c.business_id}`).at(0);
    if (!customer) fail(404, 'Account not found');
    const transactions = await db`SELECT purchase_amount,earned_amount,type,created_at FROM loyalty_transactions WHERE customer_id=${c.id} AND business_id=${c.business_id} ORDER BY created_at DESC LIMIT 100`;
    res.json({ customer, transactions }); return true;
  }
  await rateLimit(db, 'approve:' + c.id, 20);
  const amount = amountValue(p.amount), code = randomBytes(8).toString('hex');
  const approved = await db`INSERT INTO loyalty_redemption_approvals(customer_id,business_id,token_hash,session_hash,amount,expires_at) SELECT customer_id,business_id,${digest(code)},${digest(sessionToken(req))},${amount},NOW()+INTERVAL '5 minutes' FROM loyalty_wallets WHERE customer_id=${c.id} AND business_id=${c.business_id} AND balance>=${amount} ON CONFLICT(customer_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,session_hash=EXCLUDED.session_hash,amount=EXCLUDED.amount,expires_at=EXCLUDED.expires_at RETURNING customer_id`;
  if (!approved.length) fail(400, 'Insufficient points');
  res.json({ code, amount, expires_in: 300 }); return true;
}

export async function issueSetup(db, actor, phone) {
  if (!actor || !['owner','admin'].includes(actor.role) || !actor.business_id) fail(403, 'Business owner required');
  await rateLimit(db, 'setup:' + actor.id, 20);
  const token = secret();
  const rows = await db`INSERT INTO loyalty_customer_setup(customer_id,token_hash,expires_at) SELECT id,${digest(token)},NOW()+INTERVAL '15 minutes' FROM loyalty_customers WHERE phone=${String(phone || '').trim()} AND business_id=${actor.business_id} ON CONFLICT(customer_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at RETURNING customer_id`;
  if (!rows.length) fail(404, 'Customer not found');
  return { setup_token: token, expires_in: 900 };
}
export async function redeem(db, actor, payload) {
  const amount = amountValue(payload.p_redeem_amount);
  await rateLimit(db, 'redeem:' + actor.id, 30);
  const code = String(payload.p_approval_code || '').replace(/[ -]/g, '').toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(code)) fail(403, 'A current customer approval code is required');
  const row = (await db`WITH approved AS (DELETE FROM loyalty_redemption_approvals a USING loyalty_customers c,loyalty_customer_sessions s WHERE a.customer_id=c.id AND c.business_id=${actor.business_id} AND c.phone=${String(payload.p_phone || '').trim()} AND a.business_id=c.business_id AND a.token_hash=${digest(code)} AND a.amount=${amount} AND a.expires_at>NOW() AND s.token_hash=a.session_hash AND s.customer_id=c.id AND s.auth_version=c.auth_version AND s.expires_at>NOW() RETURNING a.customer_id,a.business_id,a.amount), debited AS (UPDATE loyalty_wallets w SET balance=w.balance-a.amount,updated_at=NOW() FROM approved a WHERE w.customer_id=a.customer_id AND w.business_id=a.business_id AND w.balance>=a.amount RETURNING w.customer_id,w.business_id,w.balance,a.amount), logged AS (INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount,type) SELECT customer_id,business_id,0,-amount,'redeem' FROM debited RETURNING customer_id) SELECT d.balance,d.amount redeemed_amount FROM debited d JOIN logged l ON l.customer_id=d.customer_id`).at(0);
  if (!row) fail(403, 'Invalid, expired or already used approval, or insufficient points');
  return row;
}
