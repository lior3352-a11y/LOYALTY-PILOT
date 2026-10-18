import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, createHash } from 'node:crypto';
import { createAdminHandler } from '../lib/system-admin.mjs';
const hash = 'test-salt:' + scryptSync('example-test-password', 'test-salt',32).toString('hex');
const rawToken='a'.repeat(64);
const headers={'content-type':'application/json',host:'loyaltyusapp.com',origin:'https://loyaltyusapp.com',cookie:'__Host-loyalty_admin='+rawToken};
function harness({role='admin',validSession=true,attempts=1,expired=false}={}){
 const calls=[];
 const db=async (strings,...values)=>{const sql=strings.join('?');calls.push({sql,values});
  if(sql.includes('RETURNING attempts'))return [{attempts}];
  if(sql.includes('password_hash FROM loyalty_users'))return [{id:1,email:'admin@example.test',role,password_hash:hash}];
  if(sql.includes('FROM loyalty_sessions s JOIN loyalty_users'))return validSession&&!expired?[{id:1,email:'admin@example.test',role}]:[];
  if(sql.includes('to_regclass'))return [{present:true}];
  if(sql.includes('AS count'))return [{count:2}];
  if(sql.includes('AS customer_memberships'))return [{businesses:2,contracted_monthly_cents:4900,collected_cents:4900,collected_month_cents:4900}];
  if(sql.includes('AS total'))return [{total:1,id:1,name:'Business',monthly_price_cents:4900}];
  return [];
 };
 const res={headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}};
 return {calls,res,request:async(body,change={},site='us')=>{await createAdminHandler({connect:()=>db,site})({method:'POST',headers:{...headers,...change},body},res);return res;}};
}
test('admin sign-in uses a hashed session and a strict HTTP-only cookie',async()=>{
 const h=harness();const r=await h.request({action:'login',email:'admin@example.test',password:'example-test-password'});
 assert.equal(r.code,200);assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.equal(r.body.email,'admin@example.test');assert.equal(r.body.token,undefined);
 const raw=r.headers['Set-Cookie'].split(';')[0].split('=')[1],insert=h.calls.find(c=>c.sql.includes('INSERT INTO loyalty_sessions'));
 assert.equal(insert.values[0],createHash('sha256').update(raw).digest('hex'));assert.notEqual(raw,insert.values[0]);
});
test('owner and wrong-password logins cannot create admin sessions',async()=>{
 for(const [role,password]of[['owner','example-test-password'],['admin','wrong']]){const h=harness({role});assert.equal((await h.request({action:'login',email:'admin@example.test',password})).code,401);assert.ok(!h.calls.some(c=>c.sql.includes('INSERT INTO loyalty_sessions')));}
});
test('login throttles before checking credentials',async()=>{const h=harness({attempts:11});assert.equal((await h.request({action:'login',email:'admin@example.test',password:'example-test-password'})).code,429);assert.ok(!h.calls.some(c=>c.sql.includes('password_hash FROM')));});
test('all data and edit actions deny anonymous, expired, and revoked accounts',async()=>{
 for(const action of ['overview','businesses','customers','users','payments','update_business'])for(const config of [{validSession:false},{expired:true},{role:'owner'}]){const h=harness(config);assert.equal((await h.request({action})).code,403);assert.equal(h.calls.length,1);}
 const h=harness();assert.equal((await h.request({action:'overview'},{cookie:''})).code,401);assert.equal(h.calls.length,0);
});
test('cross-origin and non-JSON requests never reach the database',async()=>{
 for(const change of [{origin:'https://other.example'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'}]){const h=harness();assert.ok((await h.request({action:'overview'},change)).code>=400);assert.equal(h.calls.length,0);}
});
test('Israel never reports unconfigured prices as revenue',async()=>{const h=harness();const r=await h.request({action:'overview'},{},'israel');assert.equal(r.body.billing_enabled,false);assert.equal(r.body.overview.collected_cents,null);const b=await h.request({action:'businesses'},{},'israel');assert.equal(b.body.rows[0].monthly_price_cents,null);});
test('business edits validate the id and rate before writes',async()=>{for(const p of [{id:0,name:'A',loyalty_rate:10},{id:1,name:'',loyalty_rate:10},{id:1,name:'A',loyalty_rate:101}]){const h=harness();assert.equal((await h.request({action:'update_business',...p})).code,400);assert.ok(!h.calls.some(c=>c.sql.startsWith('UPDATE')));}});
test('logout revokes the session and clears its cookie',async()=>{const h=harness();const r=await h.request({action:'logout'});assert.equal(r.code,200);assert.match(r.headers['Set-Cookie'],/Max-Age=0/);assert.ok(h.calls.some(c=>c.sql.startsWith('DELETE FROM loyalty_sessions')));});
