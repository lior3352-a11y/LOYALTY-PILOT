import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordHash, passwordMatches, requestGuard, customerSession, customerAction, issueSetup, redeem, amountValue } from '../lib/customer-security.js';

const req = headers => ({headers:{'content-type':'application/json',host:'loyalty.example',...headers}});
const response = () => ({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;}});
// State-machine DB double: exercises API control flow, not PostgreSQL execution.
function database() {
  const sessions = new Map(); const calls=[];
  const db = async (strings,...values) => {
    const query = strings.join('?'); calls.push({query,values});
    if (query.startsWith('INSERT INTO loyalty_auth_limits')) return [{attempts:1}];
    if (query.startsWith('INSERT INTO loyalty_customer_sessions')) {sessions.set(values[0],{id:values[1],auth_version:values[2],business_id:7,name:'Alice'});return [];}
    if (query.startsWith('DELETE FROM loyalty_customer_sessions')) {sessions.delete(values[0]);return [];}
    if (query.includes('FROM loyalty_customer_sessions s JOIN')) return sessions.has(values[0]) ? [sessions.get(values[0])] : [];
    if (query.startsWith('SELECT id,password_hash')) return values[0]===7 && values[1]==='050-1234567' ? [{id:11,auth_version:0,password_hash:db.password}] : [];
    if (query.startsWith('SELECT c.id,c.name,w.balance')) return [{id:values[0],business_id:values[1],name:'Alice',balance:50,business_name:'Shop'}];
    if (query.startsWith('SELECT purchase_amount')) return [];
    if (query.startsWith('WITH created')) return [];
    if (query.startsWith('WITH approved')) return [];
    throw Error('Unexpected query: '+query);
  };
  db.calls=calls;return db;
}
test('passwords are salted, validated and never accepted with the wrong password', async () => {
  const a=await passwordHash('correct password 123'),b=await passwordHash('correct password 123');
  assert.notEqual(a,b);assert.equal(await passwordMatches('correct password 123',a),true);
  assert.equal(await passwordMatches('wrong password',a),false);assert.equal(await passwordMatches('anything',null),false);
  await assert.rejects(passwordHash('short'));await assert.rejects(passwordHash('x'.repeat(129)));
});
test('cross-origin and simple form requests cannot use cookie-authenticated actions', () => {
  assert.throws(()=>requestGuard(req({'content-type':'text/plain'})),{status:415});
  assert.throws(()=>requestGuard(req({origin:'https://attacker.example'})),{status:403});
  assert.throws(()=>requestGuard(req({'sec-fetch-site':'cross-site'})),{status:403});
  assert.doesNotThrow(()=>requestGuard(req({origin:'https://loyalty.example'})));
});
test('legacy URL tokens and supplied customer IDs do not authenticate',async()=>{
  const db=database();
  await assert.rejects(customerAction(db,req(),response(),'wallet',{token:'old-wallet-token',customer_id:11}),{status:401});
  assert.equal(db.calls.length,0);
  await assert.rejects(customerSession(db,req({cookie:'__Host-loyalty_customer='+'f'.repeat(64)})),{status:401});
});
test('existing phone registration cannot disclose credentials or reset its password',async()=>{
  const db=database(),res=response();
  await assert.rejects(customerAction(db,req(),res,'register_customer',{business_id:7,name:'Attacker',phone:'050-1234567',password:'attacker password'}),{status:409});
  assert.equal(res.headers['Set-Cookie'],undefined);assert.equal(res.body,undefined);
});
test('login binds reads to authenticated customer; logout revokes replay of the cookie',async()=>{
  const db=database();db.password=await passwordHash('correct password 123');
  await assert.rejects(customerAction(db,req(),response(),'customer_login',{business_id:7,phone:'050-1234567',password:'wrong password'}),{status:401});
  const res=response();await customerAction(db,req(),res,'customer_login',{business_id:7,phone:'050-1234567',password:'correct password 123'});
  const cookie=res.headers['Set-Cookie'];assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.deepEqual(res.body,{ok:true});
  const auth=req({cookie:cookie.split(';')[0]}),wallet=response();
  await customerAction(db,auth,wallet,'wallet',{customer_id:999,business_id:999,token:'another-customer-token'});
  assert.equal(wallet.body.customer.id,11);assert.equal(wallet.body.customer.business_id,7);
  const out=response();await customerAction(db,auth,out,'customer_logout',{});assert.match(out.headers['Set-Cookie'],/Max-Age=0/);
  await assert.rejects(customerAction(db,auth,response(),'wallet',{}),{status:401});
});
test('only an owner can issue legacy account setup; random/expired setup codes fail',async()=>{
  const db=database();await assert.rejects(issueSetup(db,{role:'staff',business_id:7,id:1},'050-1234567'),{status:403});
  await assert.rejects(customerAction(db,req(),response(),'customer_set_password',{setup_token:'invalid',password:'correct password 123'}),{status:400});
});
test('merchant cannot redeem by phone alone or with an invalid approval',async()=>{
  const db=database(),actor={id:2,business_id:7};
  await assert.rejects(redeem(db,actor,{p_phone:'050-1234567',p_redeem_amount:20}),{status:403});
  await assert.rejects(redeem(db,actor,{p_phone:'050-1234567',p_redeem_amount:20,p_approval_code:'a'.repeat(16)}),{status:403});
});
test('fractional precision, negative and oversized redemption amounts fail',()=>{
  for(const n of [-1,0,NaN,Infinity,1.001,10000000000]) assert.throws(()=>amountValue(n),{status:400});
  assert.equal(amountValue(10.25),'10.25');
});
