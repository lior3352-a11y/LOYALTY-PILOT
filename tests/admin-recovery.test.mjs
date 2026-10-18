import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAdminHandler,passwordMatches} from '../lib/system-admin.mjs';
function harness({expired=false,role='admin',attempts=1}={}){
 let consumed=false;const queries=[];let savedHash;
 const db=async(strings,...values)=>{const sql=strings.join('?');queries.push({sql,values});if(sql.includes('RETURNING attempts'))return[{attempts}];if(sql.includes('WITH consumed AS')){if(expired||role!=='admin'||consumed)return[];consumed=true;savedHash=values[1];return[{email:'owner@example.invalid'}];}return[];};
 const request=async body=>{const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};await createAdminHandler({connect:()=>db,site:'israel'})({method:'POST',headers:{'content-type':'application/json',host:'loyaltyapp.company',origin:'https://loyaltyapp.company'},body},res);return res;};
 return{request,queries,get savedHash(){return savedHash;}};
}
const body={action:'reset_password',code:'c'.repeat(64),password:'a-new-test-password-2026'};
test('reset consumes a hashed code, salts the new password and revokes sessions without signing in',async()=>{const h=harness();const r=await h.request(body);assert.equal(r.code,200);assert.equal(r.body.ok,true);assert.equal(r.body.token,undefined);assert.match(r.headers['Set-Cookie'],/Max-Age=0/);assert.ok(await passwordMatches(body.password,h.savedHash));assert.ok(!await passwordMatches('wrong-password',h.savedHash));const q=h.queries.find(q=>q.sql.includes('WITH consumed AS'));assert.equal(q.values[0],createHash('sha256').update(body.code).digest('hex'));assert.match(q.sql,/expires_at>NOW\(\)/);assert.match(q.sql,/u.role='admin'/);assert.match(q.sql,/DELETE FROM loyalty_sessions/);});
test('a consumed code cannot reset a password again',async()=>{const h=harness();assert.equal((await h.request(body)).code,200);assert.equal((await h.request(body)).code,400);});
test('expired codes and accounts without admin privilege cannot reset',async()=>{for(const config of[{expired:true},{role:'owner'}])assert.equal((await harness(config).request(body)).code,400);});
test('invalid codes and weak or oversized passwords are rejected before queries',async()=>{for(const p of[{...body,code:'bad'},{...body,password:'short'},{...body,password:'x'.repeat(129)}]){const h=harness();assert.equal((await h.request(p)).code,400);assert.equal(h.queries.length,0);}});
test('reset attempts are rate limited before password update',async()=>{const h=harness({attempts:11});assert.equal((await h.request(body)).code,429);assert.ok(!h.queries.some(q=>q.sql.includes('WITH consumed AS')));});
