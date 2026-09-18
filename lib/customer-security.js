import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const COOKIE = '__Host-loyalty_customer';
export const digest = value => createHash('sha256').update(String(value)).digest('hex');
const secret = () => randomBytes(32).toString('hex');
export const normalizePhone = value => String(value || '').replace(/[^0-9]/g, '');
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400, 'Use a password of 8–128 characters');
  const salt = secret();
  return `${salt}:${(await derive(password, salt, 32)).toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = String(stored || '').split(':');
  const actual = await derive(password, salt || 'invalid-account-timing-salt', 32);
  const expected = Buffer.from(hash || '', 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function requestGuard(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) fail(415, 'JSON required');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site request denied');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid origin'); }
    if (origin.protocol !== 'https:' || origin.host !== req.headers.host) fail(403, 'Invalid origin');
  }
}
export async function securityReady(db) {
  if (process.env.LOYALTY_REGION !== 'us' || process.env.LOYALTY_US_SECURITY_V2 !== 'true') fail(503, 'Account security maintenance. Please try again later.');
  try {
    if (!(await db.queryRows("SELECT 1 FROM loyalty_schema_migrations WHERE version='20260918-us-security-v2'")).length) throw Error();
  } catch { fail(503, 'Account security migration is required'); }
}
export async function rateLimit(db, key, limit = 15) {
  const [row] = await db.queryRows(`INSERT INTO loyalty_us_auth_limits_v2(key,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes')
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN loyalty_us_auth_limits_v2.expires_at<NOW() THEN 1 ELSE loyalty_us_auth_limits_v2.attempts+1 END,
    expires_at=CASE WHEN loyalty_us_auth_limits_v2.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE loyalty_us_auth_limits_v2.expires_at END RETURNING attempts`, [digest(key)]);
  if (row.attempts > limit) fail(429, 'Too many attempts. Try again in 15 minutes');
}
export function sessionToken(req) {
  return String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
}
function setCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? 43200 : 0}`);
}
async function startSession(q, account) {
  const token = secret();
  await q("INSERT INTO loyalty_us_sessions_v2(token_hash,account_id,auth_version,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '12 hours')", [digest(token), account.id, account.auth_version]);
  return token;
}
// Every security mutation first locks the account, then checks its current session.
// Reset, logout, membership linking and redemption therefore serialize on the same row.
async function lockedSession(q, req) {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'Please sign in');
  const [session] = await q('SELECT account_id FROM loyalty_us_sessions_v2 WHERE token_hash=$1', [digest(token)]);
  if (!session) fail(401, 'Please sign in');
  const [account] = await q('SELECT * FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [session.account_id]);
  const valid = await q('SELECT 1 FROM loyalty_us_sessions_v2 WHERE token_hash=$1 AND account_id=$2 AND auth_version=$3 AND expires_at>NOW()', [digest(token), account?.id, account?.auth_version]);
  if (!account || !valid.length) fail(401, 'Please sign in');
  return account;
}
export function amountValue(value) {
  if (!['string','number'].includes(typeof value)) fail(400, 'Invalid amount');
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 9999999999.99 || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001) fail(400, 'Invalid amount');
  return n.toFixed(2);
}
function businessId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail(400, 'Business is required');
  return n;
}
function safeAccount(a) {
  const { id,first_name,last_name,phone,email,address,city,state,postal_code,birth_date,created_at } = a;
  return { id,first_name,last_name,phone,email,address,city,state,postal_code,birth_date,created_at };
}
async function audit(q, event, actor, account, customer, business) {
  await q('INSERT INTO loyalty_us_security_audit_v2(event,actor_id,account_id,customer_id,business_id) VALUES($1,$2,$3,$4,$5)', [event,actor ?? null,account ?? null,customer ?? null,business ?? null]);
}
async function joinBusiness(q, account, business) {
  if (!business) return;
  const id = businessId(business);
  if (!(await q('SELECT 1 FROM loyalty_businesses WHERE id=$1', [id])).length) fail(404, 'Business not found');
  const [existing] = await q("SELECT id,account_id,owner_verified_at FROM loyalty_customers WHERE business_id=$1 AND regexp_replace(phone,'[^0-9]','','g')=$2 FOR UPDATE", [id,normalizePhone(account.phone)]);
  // Never attach or overwrite an existing balance using a phone match.
  if (existing) {
    if (String(existing.account_id) !== String(account.id) || !existing.owner_verified_at) return { verification_required: true };
    return;
  }
  const [member] = await q('INSERT INTO loyalty_customers(name,phone,business_id,wallet_token,account_id,owner_verified_at) VALUES($1,$2,$3,$4,$5,NOW()) RETURNING id', [`${account.first_name} ${account.last_name}`,account.phone,id,secret(),account.id]);
  await q('INSERT INTO loyalty_wallets(customer_id,business_id) VALUES($1,$2)', [member.id,id]);
}
export async function customerAction(db, req, res, action, p) {
  if (['register_customer','wallet'].includes(action)) fail(410, 'This account link is no longer supported. Please sign in.');
  if (!['register_customer_account','customer_login','customer_logout','customer_account','customer_approve_redemption','customer_recovery_info','customer_complete_recovery'].includes(action)) return false;
  if (['register_customer_account','customer_login','customer_complete_recovery','customer_recovery_info'].includes(action)) {
    await rateLimit(db, 'ip:' + (req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown'), 100);
    if (action === 'customer_login') {
      const login = String(p.login || '').trim();
      const key = login.includes('@') ? login.toLowerCase() : normalizePhone(login);
      await rateLimit(db, 'login:' + key);
    }
    if (action.includes('recovery')) await rateLimit(db, 'recovery:' + digest(p.setup_token || ''), 15);
  }
  if (action === 'register_customer_account') {
    const fields = ['first_name','last_name','phone','email','address','city','state','postal_code'];
    const a = Object.fromEntries(fields.map(k => [k,String(p[k] || '').trim()]));
    a.email = a.email.toLowerCase();
    const phoneKey = normalizePhone(a.phone);
    if (fields.some(k => !a[k] || a[k].length > 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) || phoneKey.length < 7 || phoneKey.length > 15) fail(400, 'Please complete all required account details');
    if (p.terms_accepted !== true) fail(400, 'Terms of Service acceptance is required');
    if (p.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.birth_date)) fail(400, 'Invalid date of birth');
    const hash = await passwordHash(p.password);
    let result;
    try {
      result = await db.transactionBlock(async q => {
        const [account] = await q(`INSERT INTO loyalty_customer_accounts(first_name,last_name,phone,phone_key,email,password_hash,address,city,state,postal_code,birth_date,terms_accepted_at,terms_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),'2026-09-17') RETURNING *`, [a.first_name,a.last_name,a.phone,phoneKey,a.email,hash,a.address,a.city,a.state,a.postal_code,p.birth_date || null]);
        const join = await joinBusiness(q, account, p.business_id);
        return { token: await startSession(q, account), account: safeAccount(account), ...join };
      });
    } catch (error) { if (error.code === '23505') fail(409, 'An account with these details already exists. Sign in or ask your business owner for verified recovery.'); throw error; }
    setCookie(res, result.token); delete result.token; res.status(201).json({ ok: true, ...result }); return true;
  }
  if (action === 'customer_login') {
    const login = String(p.login || '').trim();
    const [initial] = await db.queryRows(login.includes('@') ? 'SELECT * FROM loyalty_customer_accounts WHERE email=$1' : 'SELECT * FROM loyalty_customer_accounts WHERE phone_key=$1', [login.includes('@') ? login.toLowerCase() : normalizePhone(login)]);
    if (!await passwordMatches(p.password, initial?.password_hash) || !initial) fail(401, 'Invalid email/mobile number or password. For recovery, ask your business owner to verify your identity.');
    const result = await db.transactionBlock(async q => {
      const [account] = await q('SELECT * FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [initial.id]);
      if (!account || account.password_hash !== initial.password_hash) fail(401, 'Please sign in again');
      const join = await joinBusiness(q, account, p.business_id);
      return { token: await startSession(q, account), account: safeAccount(account), ...join };
    });
    setCookie(res, result.token); delete result.token; res.json({ ok: true, ...result }); return true;
  }
  if (action === 'customer_logout') {
    await db.transactionBlock(async q => {
      const hash = digest(sessionToken(req));
      const [s] = await q('SELECT account_id FROM loyalty_us_sessions_v2 WHERE token_hash=$1', [hash]);
      if (s) await q('SELECT id FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [s.account_id]);
      await q('DELETE FROM loyalty_us_sessions_v2 WHERE token_hash=$1', [hash]);
    });
    setCookie(res, ''); res.json({ ok: true }); return true;
  }
  if (action === 'customer_recovery_info') {
    if (!/^[a-f0-9]{64}$/.test(String(p.setup_token || ''))) fail(400, 'Invalid or expired recovery link');
    const [r] = await db.queryRows('SELECT purpose FROM loyalty_us_recovery_v2 WHERE token_hash=$1 AND expires_at>NOW()', [digest(p.setup_token)]);
    if (!r) fail(400, 'Invalid or expired recovery link');
    res.json({ mode: r.purpose === 'reset' ? 'reset' : 'link' }); return true;
  }
  if (action === 'customer_complete_recovery') {
    const result = await completeRecovery(db, req, p);
    if (result.token) setCookie(res, result.token);
    res.json({ ok: true }); return true;
  }
  if(action === 'customer_approve_redemption') await rateLimit(db, 'approval:' + digest(sessionToken(req)), 20);
  const result = await db.transactionBlock(async q => {
    const a = await lockedSession(q, req);
    if (action === 'customer_account') {
      const businesses = await q(`SELECT c.id customer_id,b.id business_id,b.name business_name,b.loyalty_rate,w.balance,w.updated_at
        FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id JOIN loyalty_businesses b ON b.id=c.business_id
        WHERE c.account_id=$1 AND c.owner_verified_at IS NOT NULL ORDER BY b.name`, [a.id]);
      const transactions = await q(`SELECT t.purchase_amount,t.earned_amount,t.type,t.created_at,b.name business_name
        FROM loyalty_transactions t JOIN loyalty_customers c ON c.id=t.customer_id AND c.business_id=t.business_id JOIN loyalty_businesses b ON b.id=t.business_id
        WHERE c.account_id=$1 AND c.owner_verified_at IS NOT NULL ORDER BY t.created_at DESC LIMIT 100`, [a.id]);
      const pending = await q('SELECT 1 FROM loyalty_customers WHERE account_id=$1 AND owner_verified_at IS NULL LIMIT 1', [a.id]);
      return { account: safeAccount(a), businesses, transactions, verification_required: !!pending.length };
    }
    // Account lock also serializes code generation with reset and logout.
    const business = businessId(p.business_id), amount = amountValue(p.amount);
    const [c] = await q('SELECT c.id FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=c.business_id WHERE c.account_id=$1 AND c.business_id=$2 AND c.owner_verified_at IS NOT NULL AND w.balance>=$3', [a.id,business,amount]);
    if (!c) fail(400, 'Insufficient rewards or owner verification required');
    const code = randomBytes(8).toString('hex');
    await q(`INSERT INTO loyalty_us_approvals_v2(token_hash,customer_id,account_id,business_id,session_hash,auth_version,amount,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW()+INTERVAL '5 minutes') ON CONFLICT(customer_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,session_hash=EXCLUDED.session_hash,auth_version=EXCLUDED.auth_version,amount=EXCLUDED.amount,expires_at=EXCLUDED.expires_at`, [digest(code),c.id,a.id,business,digest(sessionToken(req)),a.auth_version,amount]);
    return { code, amount, expires_in: 300 };
  });
  res.json(result); return true;
}

export async function issueRecovery(db, actor, p) {
  if (!actor || !['owner','admin'].includes(actor.role) || !actor.business_id) fail(403, 'Business owner required');
  if (p.identity_verified !== true) fail(400, 'Verify the customer identity in person first');
  await rateLimit(db, 'owner-recovery:' + actor.id, 20);
  return db.transactionBlock(async q => {
    const [initial] = await q('SELECT id,account_id FROM loyalty_customers WHERE id=$1 AND business_id=$2', [p.customer_id,actor.business_id]);
    if (!initial) fail(404, 'Customer not found');
    if (initial.account_id) await q('SELECT id FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [initial.account_id]);
    const [c] = await q('SELECT * FROM loyalty_customers WHERE id=$1 AND business_id=$2 FOR UPDATE', [initial.id,actor.business_id]);
    if (String(c.account_id) !== String(initial.account_id)) fail(409, 'Account changed. Retry verification.');
    // A merchant must never be able to reset a global account with other businesses.
    const multiBusiness = c.account_id && (await q('SELECT 1 FROM loyalty_customers WHERE account_id=$1 AND business_id<>$2 LIMIT 1', [c.account_id,actor.business_id])).length;
    const purpose = !c.account_id ? 'link' : multiBusiness ? 'verify' : 'reset';
    const token = secret();
    await q(`INSERT INTO loyalty_us_recovery_v2(token_hash,customer_id,account_id,business_id,issued_by,purpose,expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '15 minutes')
      ON CONFLICT(customer_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,account_id=EXCLUDED.account_id,purpose=EXCLUDED.purpose,issued_by=EXCLUDED.issued_by,expires_at=EXCLUDED.expires_at`, [digest(token),c.id,c.account_id,actor.business_id,actor.id,purpose]);
    await audit(q, 'owner_recovery_issued', actor.id, c.account_id, c.id, actor.business_id);
    return { setup_token: token, expires_in: 900 };
  });
}
async function completeRecovery(db, req, p) {
  if (!/^[a-f0-9]{64}$/.test(String(p.setup_token || ''))) fail(400, 'Invalid or expired recovery link');
  const [initial] = await db.queryRows('SELECT * FROM loyalty_us_recovery_v2 WHERE token_hash=$1 AND expires_at>NOW()', [digest(p.setup_token)]);
  if (!initial) fail(400, 'Invalid or expired recovery link');
  const resetting = initial.purpose === 'reset';
  const hash = resetting ? await passwordHash(p.password) : null;
  return db.transactionBlock(async q => {
    let account;
    if (resetting) [account] = await q('SELECT * FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [initial.account_id]);
    else account = await lockedSession(q, req);
    const [c] = await q('SELECT * FROM loyalty_customers WHERE id=$1 AND business_id=$2 FOR UPDATE', [initial.customer_id,initial.business_id]);
    const [r] = await q('SELECT * FROM loyalty_us_recovery_v2 WHERE token_hash=$1 AND expires_at>NOW() FOR UPDATE', [digest(p.setup_token)]);
    if (!account || !c || !r || String(c.account_id) !== String(initial.account_id) || String(r.account_id) !== String(initial.account_id)) fail(400, 'Invalid or expired recovery link');
    const owner = await q("SELECT 1 FROM loyalty_users WHERE id=$1 AND business_id=$2 AND role IN ('owner','admin')", [r.issued_by,r.business_id]);
    if (!owner.length) fail(403, 'Recovery authorization is no longer valid');
    if (resetting) {
      if ((await q('SELECT 1 FROM loyalty_customers WHERE account_id=$1 AND business_id<>$2 LIMIT 1', [account.id,r.business_id])).length) fail(403, 'Multi-business account recovery requires independent support verification');
      [account] = await q('UPDATE loyalty_customer_accounts SET password_hash=$1,auth_version=auth_version+1,updated_at=NOW() WHERE id=$2 RETURNING *', [hash,account.id]);
      await q('DELETE FROM loyalty_us_sessions_v2 WHERE account_id=$1', [account.id]);
    } else if ((initial.account_id && String(initial.account_id) !== String(account.id)) || normalizePhone(account.phone) !== normalizePhone(c.phone)) fail(403, 'Sign in to the verified customer account');
    await q('UPDATE loyalty_customers SET account_id=$1,owner_verified_at=NOW() WHERE id=$2', [account.id,c.id]);
    await q('DELETE FROM loyalty_us_recovery_v2 WHERE token_hash=$1', [digest(p.setup_token)]);
    await audit(q, 'owner_recovery_completed', r.issued_by, account.id, c.id, r.business_id);
    return { token: resetting ? await startSession(q, account) : null };
  });
}
export async function redeem(db, actor, p) {
  if (!actor?.business_id) fail(403, 'Business workspace required');
  const amount = amountValue(p.p_redeem_amount), code = String(p.p_approval_code || '').replace(/[ -]/g, '').toLowerCase();
  await rateLimit(db, 'redeem:' + actor.id, 30);
  if (!/^[a-f0-9]{16}$/.test(code)) fail(403, 'A current customer approval code is required');
  return db.transactionBlock(async q => {
    const [initial] = await q('SELECT account_id FROM loyalty_us_approvals_v2 WHERE token_hash=$1 AND business_id=$2', [digest(code),actor.business_id]);
    if (!initial) fail(403, 'Invalid or already used approval');
    const [a] = await q('SELECT id,auth_version FROM loyalty_customer_accounts WHERE id=$1 FOR UPDATE', [initial.account_id]);
    const [approval] = await q(`SELECT r.* FROM loyalty_us_approvals_v2 r
      JOIN loyalty_us_sessions_v2 s ON s.token_hash=r.session_hash AND s.account_id=r.account_id AND s.auth_version=r.auth_version
      JOIN loyalty_customers c ON c.id=r.customer_id AND c.account_id=r.account_id AND c.business_id=r.business_id
      WHERE r.token_hash=$1 AND r.business_id=$2 AND r.amount=$3 AND r.auth_version=$4 AND r.expires_at>NOW() AND s.expires_at>NOW()
      AND c.owner_verified_at IS NOT NULL AND regexp_replace(c.phone,'[^0-9]','','g')=$5 FOR UPDATE OF r`, [digest(code),actor.business_id,amount,a?.auth_version,normalizePhone(p.p_phone)]);
    if (!approval) fail(403, 'Invalid, expired or already used approval');
    const [wallet] = await q('UPDATE loyalty_wallets SET balance=balance-$1,updated_at=NOW() WHERE customer_id=$2 AND business_id=$3 AND balance>=$1 RETURNING balance', [amount,approval.customer_id,actor.business_id]);
    if (!wallet) fail(400, 'Insufficient rewards');
    await q("INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount,type) VALUES($1,$2,0,-$3::numeric,'redeem')", [approval.customer_id,actor.business_id,amount]);
    await q('DELETE FROM loyalty_us_approvals_v2 WHERE token_hash=$1', [digest(code)]);
    return { balance: wallet.balance, redeemed_amount: amount };
  });
}
