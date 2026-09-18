import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHandler} from '../api/neon.js';
import {passwordHash,passwordMatches,requestGuard,digest,amountValue} from '../lib/customer-security.js';
import {testDatabase} from './database.mjs';
process.env.LOYALTY_REGION='us';process.env.LOYALTY_US_SECURITY_V2='true';
const request=(body,cookie='',headers={})=>({method:'POST',headers:{host:'loyalty.test','content-type':'application/json',origin:'https://loyalty.test',cookie,...headers},body});
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(body){this.body=body;return this;}});
const profile=(n)=>({first_name:'Alice',last_name:'Test',phone:'212555'+String(n).padStart(4,'0'),email:`alice${n}@example.test`,password:'correct password',address:'1 Test St',city:'New York',state:'NY',postal_code:'10001',terms_accepted:true});

test('password hashing and request/amount validation',async()=>{
 const a=await passwordHash('correct password'),b=await passwordHash('correct password');assert.notEqual(a,b);
 assert(await passwordMatches('correct password',a));assert.equal(await passwordMatches('wrong',a),false);
 await assert.rejects(passwordHash('short'));await assert.rejects(passwordHash('x'.repeat(129)));
 for(const v of [-1,0,Infinity,1.001,{},true])assert.throws(()=>amountValue(v));
 assert.equal(amountValue('10.25'),'10.25');
 assert.throws(()=>requestGuard(request({},'',{origin:'https://evil.test'})),{status:403});
 assert.throws(()=>requestGuard(request({},'',{'content-type':'text/plain'})),{status:415});
});

test('US security API against actual SQL',async t=>{
 const f=await testDatabase();t.after(f.close);t.diagnostic(f.engine);
 const q=f.db.queryRows;
 await q("INSERT INTO loyalty_businesses(id,name,qr_token) VALUES(1,'Test store','b1'),(2,'Other store','b2')");
 const merchantHash=await passwordHash('merchant password');
 await q("INSERT INTO loyalty_users(id,email,password_hash,role,business_id) VALUES(1,'owner@example.test',$1,'owner',1),(2,'other@example.test',$1,'owner',2),(3,'staff@example.test',$1,'staff',1)",[merchantHash]);
 await q("INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES('owner',1,NOW()+INTERVAL '1 day'),('other',2,NOW()+INTERVAL '1 day'),('staff',3,NOW()+INTERVAL '1 day')");
 // Old per-account table must survive migration; the security code must not use it.
 await q("INSERT INTO loyalty_customers(id,name,phone,business_id,wallet_token) VALUES(100,'Legacy customer','2125550099',1,'old-wallet-secret')");
 await q('INSERT INTO loyalty_wallets(customer_id,business_id,balance) VALUES(100,1,70)');
 await f.migrate();await f.migrate();
 const handler=createHandler(()=>f.db);
 async function call(action,p={},cookie='',headers={}){const r=response();await handler(request({action,...p},cookie,headers),r);return r;}
 function cookie(r){return r.headers['Set-Cookie']?.split(';')[0]||'';}
 async function register(n,business=1){const r=await call('register_customer_account',{...profile(n),business_id:business});assert.equal(r.statusCode,201,JSON.stringify(r.body));return {cookie:cookie(r),id:r.body.account.id,...profile(n)};}
 async function member(a,business=1){return (await q('SELECT * FROM loyalty_customers WHERE account_id=$1 AND business_id=$2',[a.id,business]))[0];}
 async function credit(a,amount=100,business=1){const c=await member(a,business);await q('UPDATE loyalty_wallets SET balance=$1 WHERE customer_id=$2 AND business_id=$3',[amount,c.id,business]);return c;}
 async function approval(a,amount=10,business=1){const r=await call('customer_approve_redemption',{business_id:business,amount},a.cookie);assert.equal(r.statusCode,200,JSON.stringify(r.body));return r.body.code;}
 async function redeem(a,code,amount=10,token='owner'){return call('merchant_rpc',{access_token:token,name:'redeem_loyalty_balance',payload:{p_phone:a.phone,p_redeem_amount:amount,p_approval_code:code}});}
 let a;
 await t.test('migration preserves legacy balances and incompatible session table',async()=>{
  assert.equal(Number((await q('SELECT balance FROM loyalty_wallets WHERE customer_id=100'))[0].balance),70);
  const cols=await q("SELECT column_name FROM information_schema.columns WHERE table_name='loyalty_customer_sessions'");
  assert(cols.some(c=>c.column_name==='account_id'));assert(!cols.some(c=>c.column_name==='token_hash'));
 });
 await t.test('registration preserves full profile, uses hashed cookie session and ignores bearer credentials',async()=>{
  a=await register(1);await credit(a);
  const r=await call('customer_account',{},a.cookie);assert.equal(r.body.account.address,'1 Test St');assert.equal(r.body.account.password_hash,undefined);
  assert.match(a.cookie,/^__Host-loyalty_customer=[a-f0-9]{64}$/);
  const stored=(await q('SELECT token_hash FROM loyalty_us_sessions_v2 WHERE account_id=$1',[a.id]))[0].token_hash;
  assert.equal(stored,digest(a.cookie.split('=')[1]));
  assert.equal((await call('customer_account',{access_token:a.cookie.split('=')[1]})).statusCode,401);
 });
 await t.test('legacy phone/token bypasses are rejected without data disclosure',async()=>{
  assert.equal((await call('register_customer',{phone:'2125550099',business_id:1,name:'Attacker'})).statusCode,410);
  assert.equal((await call('wallet',{token:'old-wallet-secret'})).statusCode,410);
  assert.equal((await call('customer_account',{account_id:a.id})).statusCode,401);
 });
 await t.test('phone matching never takes over a legacy balance; owner links it once',async()=>{
  const legacy=await register(99);
  assert.equal((await q('SELECT account_id FROM loyalty_customers WHERE id=100'))[0].account_id,null);
  assert.equal((await call('customer_account',{},legacy.cookie)).body.businesses.length,0);
  assert.equal((await call('customer_setup',{access_token:'staff',customer_id:100,identity_verified:true})).statusCode,403);
  assert.equal((await call('customer_setup',{access_token:'other',customer_id:100,identity_verified:true})).statusCode,404);
  assert.equal((await call('customer_setup',{access_token:'owner',customer_id:100})).statusCode,400);
  const setup=await call('customer_setup',{access_token:'owner',customer_id:100,identity_verified:true});assert.equal(setup.statusCode,200);
  const p={setup_token:setup.body.setup_token};
  assert.equal((await call('customer_complete_recovery',p,a.cookie)).statusCode,403);
  assert.equal((await call('customer_complete_recovery',p,legacy.cookie)).statusCode,200);
  assert.equal((await call('customer_complete_recovery',p,legacy.cookie)).statusCode,400);
  assert.equal(Number((await call('customer_account',{},legacy.cookie)).body.businesses[0].balance),70);
 });
 await t.test('wrong business, amount and missing code cannot redeem',async()=>{
  const code=await approval(a);
  assert.equal((await redeem(a,'')).statusCode,403);assert.equal((await redeem(a,code,11)).statusCode,403);
  assert.equal((await redeem(a,code,10,'other')).statusCode,403);
  assert.equal((await redeem(a,code)).statusCode,200);
  assert.equal((await redeem(a,code)).statusCode,403);
 });
 await t.test('simultaneous redemption consumes one approval and logs exactly once',async()=>{
  const c=await credit(a);const before=Number((await q("SELECT COUNT(*) n FROM loyalty_transactions WHERE customer_id=$1 AND type='redeem'",[c.id]))[0].n);
  const code=await approval(a,20);const results=await Promise.all([redeem(a,code,20),redeem(a,code,20)]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,403]);
  assert.equal(Number((await q('SELECT balance FROM loyalty_wallets WHERE customer_id=$1',[c.id]))[0].balance),80);
  assert.equal(Number((await q("SELECT COUNT(*) n FROM loyalty_transactions WHERE customer_id=$1 AND type='redeem'",[c.id]))[0].n),before+1);
 });
 await t.test('insufficient balance rolls back code consumption and transaction log',async()=>{
  const code=await approval(a,30);const c=await credit(a,5);
  assert.equal((await redeem(a,code,30)).statusCode,400);
  assert.equal((await q('SELECT 1 FROM loyalty_us_approvals_v2 WHERE token_hash=$1',[digest(code)])).length,1);
  await credit(a,100);
 });
 await t.test('a failed transaction log rolls back the debit and preserves approval',async()=>{
  const c=await credit(a,100),code=await approval(a,12);
  await f.exec("CREATE FUNCTION test_reject_redemption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='redeem' THEN RAISE EXCEPTION 'test log failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_log_failure BEFORE INSERT ON loyalty_transactions FOR EACH ROW EXECUTE FUNCTION test_reject_redemption();");
  assert.equal((await redeem(a,code,12)).statusCode,500);
  assert.equal(Number((await q('SELECT balance FROM loyalty_wallets WHERE customer_id=$1',[c.id]))[0].balance),100);
  assert.equal((await q('SELECT 1 FROM loyalty_us_approvals_v2 WHERE token_hash=$1',[digest(code)])).length,1);
  await f.exec('DROP TRIGGER test_log_failure ON loyalty_transactions; DROP FUNCTION test_reject_redemption();');
 });
 await t.test('expired approvals and sessions fail',async()=>{
  const code=await approval(a);await q("UPDATE loyalty_us_approvals_v2 SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",[digest(code)]);
  assert.equal((await redeem(a,code)).statusCode,403);
  const b=await register(2);await q("UPDATE loyalty_us_sessions_v2 SET expires_at=NOW()-INTERVAL '1 second' WHERE account_id=$1",[b.id]);
  assert.equal((await call('customer_account',{},b.cookie)).statusCode,401);
 });
 await t.test('password recovery invalidates every prior session and approval',async()=>{
  const c=await member(a);const old=a.cookie;const code=await approval(a);
  const setup=await call('customer_setup',{access_token:'owner',customer_id:c.id,identity_verified:true});
  const reset=await call('customer_complete_recovery',{setup_token:setup.body.setup_token,password:'new correct password'});
  assert.equal(reset.statusCode,200,JSON.stringify(reset.body));a.cookie=cookie(reset);
  assert.equal((await call('customer_account',{},old)).statusCode,401);
  assert.equal((await redeem(a,code)).statusCode,403);
  assert.equal((await call('customer_complete_recovery',{setup_token:setup.body.setup_token,password:'another password'})).statusCode,400);
  assert.equal((await call('customer_login',{login:a.email,password:'correct password'})).statusCode,401);
  assert.equal((await call('customer_login',{login:a.email,password:'new correct password'})).statusCode,200);
 });
 await t.test('business owner cannot reset a multi-business global account',async()=>{
  await call('customer_login',{login:a.email,password:'new correct password',business_id:2});
  const c=await member(a);
  const setup=await call('customer_setup',{access_token:'owner',customer_id:c.id,identity_verified:true});assert.equal(setup.statusCode,200);
  assert.equal((await call('customer_recovery_info',{setup_token:setup.body.setup_token})).body.mode,'link');
  assert.equal((await call('customer_complete_recovery',{setup_token:setup.body.setup_token,password:'attacker password'})).statusCode,401);
  assert.equal((await call('customer_complete_recovery',{setup_token:setup.body.setup_token},a.cookie)).statusCode,200);
 });
 await t.test('logout rejects replay and revokes all approvals from that session',async()=>{
  const code=await approval(a);const r=await call('customer_logout',{},a.cookie);assert.equal(r.statusCode,200);assert.match(r.headers['Set-Cookie'],/Max-Age=0/);
  assert.equal((await call('customer_account',{},a.cookie)).statusCode,401);assert.equal((await redeem(a,code)).statusCode,403);
 });
 await t.test('merchant logout is server-side and replay fails',async()=>{
  assert.equal((await call('logout',{access_token:'owner'})).statusCode,200);
  assert.equal((await call('merchant_rpc',{access_token:'owner',name:'business_customers'})).statusCode,403);
 });
 await t.test('unsafe origins fail and authentication is rate limited',async()=>{
  assert.equal((await call('customer_login',{login:a.email,password:'bad'},'',{origin:'https://evil.test'})).statusCode,403);
  let r;for(let i=0;i<16;i++)r=await call('customer_login',{login:'absent@example.test',password:'bad'});
  assert.equal(r.statusCode,429);
 });
 await t.test('API paths do not perform schema writes and release requires explicit US enablement',async()=>{
  const source=await readFile(new URL('../api/neon.js',import.meta.url),'utf8');assert.doesNotMatch(source,/CREATE TABLE|ALTER TABLE|DROP CONSTRAINT|first_business/);
  process.env.LOYALTY_REGION='il';assert.equal((await call('public_business',{business_id:1})).statusCode,503);process.env.LOYALTY_REGION='us';
 });
});
