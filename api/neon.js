import { database } from '../lib/database.js';
import { randomUUID } from 'node:crypto';
import { passwordHash, passwordMatches, normalizePhone, requestGuard, securityReady, rateLimit, customerAction, issueRecovery, redeem } from '../lib/customer-security.js';

async function sessionUser(db, req, suppliedToken) {
  const header = req.headers.authorization || '';
  const token = suppliedToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token) return null;
  return (await db`SELECT u.id,u.email,u.role,u.business_id FROM loyalty_sessions s JOIN loyalty_users u ON u.id=s.user_id WHERE s.token=${token} AND s.expires_at>NOW()`).at(0) || null;
}
function requireBusiness(user) {
  if (!user?.business_id) { const error = new Error('Business workspace required'); error.status = 403; throw error; }
  return Number(user.business_id);
}
export function createHandler(connect = database) { return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  try {
    requestGuard(req);
    const db = connect(); await securityReady(db);
    const { action, ...p } = req.body || {};

    if (await customerAction(db, req, res, action, p)) return;
    if (action === 'logout') {
      const header = req.headers.authorization || '';
      const token = p.access_token || (header.startsWith('Bearer ') ? header.slice(7) : '');
      await db`DELETE FROM loyalty_sessions WHERE token=${token}`;
      return res.json({ ok: true });
    }
    if (action === 'customer_setup') {
      const actor = await sessionUser(db, req, p.access_token);
      return res.json(await issueRecovery(db, actor, p));
    }
    if (action === 'login') {
      const email = String(p.email || '').trim().toLowerCase(), password = String(p.password || '');
      await rateLimit(db, 'merchant:' + email);
      const user = (await db`SELECT id,email,role,business_id,password_hash FROM loyalty_users WHERE email=${email}`).at(0);
      if (!user || !await passwordMatches(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
      const token = randomUUID();
      await db`INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES(${token},${user.id},NOW()+INTERVAL '30 days')`;
      return res.json({ token, access_token: token, email: user.email, role: user.role, business_id: user.business_id });
    }
    if (action === 'register_business') {
      const name = String(p.name || '').trim(), email = String(p.email || '').trim().toLowerCase(), password = String(p.password || ''), phone = String(p.phone || '').trim();
      if (!name || !email || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Business name, email, and an 8 character password are required' });
      if (p.terms_accepted !== true) return res.status(400).json({ error: 'Terms of Service acceptance is required' });
      if ((await db`SELECT 1 FROM loyalty_users WHERE email=${email}`).length) return res.status(409).json({ error: 'An account with this email already exists' });
      const business = (await db`INSERT INTO loyalty_businesses(name,phone,qr_token) VALUES(${name},${phone || null},${randomUUID()}) RETURNING id,name,phone,loyalty_rate,qr_token`).at(0);
      await db`INSERT INTO loyalty_business_settings(business_id) VALUES(${business.id})`;
      await db`INSERT INTO loyalty_subscriptions(business_id,trial_start,trial_end,subscription_status) VALUES(${business.id},NOW(),NOW()+INTERVAL '14 days','trialing')`;
      const user = (await db`INSERT INTO loyalty_users(email,password_hash,role,business_id,terms_accepted_at,terms_version) VALUES(${email},${await passwordHash(password)},'owner',${business.id},NOW(),'2026-09-17') RETURNING id,email,role,business_id,terms_accepted_at,terms_version`).at(0);
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
      if (!email || password.length < 8 || password.length > 128 || !['owner','manager','staff'].includes(role)) return res.status(400).json({ error: 'Invalid user details' });
      const user = (await db`INSERT INTO loyalty_users(email,password_hash,role,business_id) VALUES(${email},${await passwordHash(password)},${role},${businessId}) RETURNING id,email,role,business_id`).at(0);
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
      if (name === 'redeem_loyalty_balance' || name === 'redeem_loyalty_balance_secure') return res.json(await redeem(db, actor, payload));
      if (name.includes('create_loyalty_transaction')) { const amount=Number(payload.p_purchase_amount),phoneKey=normalizePhone(payload.p_phone||''); const c=(await db`SELECT c.id,w.balance FROM loyalty_customers c JOIN loyalty_wallets w ON w.customer_id=c.id AND w.business_id=${businessId} WHERE regexp_replace(c.phone,'[^0-9]','','g')=${phoneKey} AND c.business_id=${businessId}`).at(0); if(!c||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'Customer or amount is invalid'}); const earned=Math.round(amount*Number(business.loyalty_rate))/100; const u=(await db`UPDATE loyalty_wallets SET balance=balance+${earned},updated_at=NOW() WHERE customer_id=${c.id} AND business_id=${businessId} RETURNING balance`).at(0); const tx=(await db`INSERT INTO loyalty_transactions(customer_id,business_id,purchase_amount,earned_amount) VALUES(${c.id},${businessId},${amount},${earned}) RETURNING id`).at(0); return res.json({transaction_id:tx.id,earned_amount:earned,balance:u.balance}); }
      return res.status(400).json({error:'Unsupported merchant operation'});
    }
    if (action === 'create_business') { const actor=await sessionUser(db,req,p.access_token); if(actor?.role!=='admin')return res.status(403).json({error:'Not allowed'}); const name=String(p.name||'').trim(),rate=Number(p.loyalty_rate??10); if(!name||!Number.isFinite(rate)||rate<0||rate>100)return res.status(400).json({error:'Invalid business details'}); const business=(await db`INSERT INTO loyalty_businesses(name,loyalty_rate,qr_token) VALUES(${name},${rate},${randomUUID()}) RETURNING id,name,loyalty_rate,qr_token`).at(0); await db`INSERT INTO loyalty_business_settings(business_id) VALUES(${business.id})`; return res.json({business}); }
    return res.status(400).json({error:'Unknown action'});
  } catch(error) {
    console.error('[v0] Neon API error:',error?.message||error);
    return res.status(error.status || 500).json({error:error.status ? error.message : 'Database operation failed'});
  }
}; }
export default createHandler();
