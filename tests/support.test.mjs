import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHandler } from '../api/support.js';
import { createSupportLimiter } from '../lib/support-limits.mjs';

function harness(options = {}) {
  const calls = [];
  const handler = createSupportHandler({
    env: { OPENAI_API_KEY: 'test-only-placeholder', VERCEL_BRANCH_URL: 'loyalty-il-git-test.example.test' },
    reserve: async () => ({ allowed: true }),
    fetcher: async (url, init) => { calls.push(JSON.parse(init.body)); return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Test answer'}]}]})}; },
    ...options
  });
  return { calls, async request(body, headers = {}, method = 'POST') {
    const res = {code:200, headers:{}, setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
    await handler({method,headers:{host:'loyaltyusapp.com',origin:'https://loyaltyusapp.com',...headers},body},res);return res;
  }};
}

test('explicit language is respected on both sites and pricing stays with the site', async () => {
  const h = harness();
  const israel = await h.request({message:'How does QR work?',lang:'en'}, {host:'loyaltyapp.company',origin:'https://loyaltyapp.company'});
  assert.equal(israel.data.language,'en'); assert.match(h.calls[0].instructions,/Site: Loyalty Israel\. Reply only in English/);
  assert.ok(!h.calls[0].instructions.includes('$49 per month'));
  const us = await h.request({message:'איך סורקים QR?',lang:'he'});
  assert.equal(us.data.language,'he'); assert.match(h.calls[1].instructions,/Site: Loyalty US\. Reply only in Hebrew/);
  assert.ok(h.calls[1].instructions.includes('$49 per month'));
  assert.equal(h.calls[1].max_output_tokens,220); assert.equal(h.calls[1].store,false);
});
test('branch alias is allowed explicitly; foreign origins/hosts and malformed origins denied', async () => {
  const h = harness(); const body={message:'QR',lang:'he'};
  assert.equal((await h.request(body,{host:'loyalty-il-git-test.example.test',origin:'https://loyalty-il-git-test.example.test'})).code,200);
  for (const headers of [{origin:'https://evil.example'},{origin:'bad-url'},{origin:'http://loyaltyusapp.com'},{host:'other.vercel.app',origin:'https://other.vercel.app'}]) assert.equal((await h.request(body,headers)).code,403);
  assert.equal(h.calls.length,1);
});
test('invalid JSON shapes and oversized inputs never reach provider', async () => {
  const h = harness();
  for (const body of [null,[],{},'{',{message:12},{message:'x'.repeat(1001)}]) assert.equal((await h.request(body)).code,400);
  assert.equal((await h.request({}, {}, 'GET')).code,405); assert.equal(h.calls.length,0);
});
test('rate denial returns 429 and Retry-After before any paid call', async () => {
  const h = harness({reserve:async()=>({allowed:false,retryAfter:60})});
  const r = await h.request({message:'QR',lang:'he'});
  assert.equal(r.code,429); assert.equal(r.headers['Retry-After'],'60'); assert.equal(r.data.language,'he'); assert.equal(h.calls.length,0);
});
test('unavailable/missing limit store fails closed to free FAQ, including thrown failures', async () => {
  for (const reserve of [async()=>({allowed:false,unavailable:true}),async()=>{throw Error('DB offline');}]) {
    const h = harness({reserve}); const r=await h.request({message:'QR',lang:'en'});
    assert.equal(r.code,200); assert.equal(r.data.source,'verified_faq'); assert.equal(h.calls.length,0);
  }
});
test('private data is blocked before quota or provider; no key uses free FAQ', async () => {
  const h = harness({reserve:async()=>{throw Error('must not reserve');}});
  assert.equal((await h.request({message:'email user@example.test',lang:'en'})).data.source,'privacy_filter');assert.equal(h.calls.length,0);
  const free = harness({env:{},reserve:async()=>{throw Error('must not reserve');}});
  assert.equal((await free.request({message:'QR',lang:'he'})).data.source,'verified_faq');assert.equal(free.calls.length,0);
});
test('limiter needs a trusted address and secret; counters share a stable HMAC identity', async () => {
  let queries=[];
  const sql=async(strings,...values)=>{queries.push({text:strings.join('?'),values});return [{used:1}];};
  const env={VERCEL:'1',LOYALTY_SUPPORT_RATE_SECRET:'test-secret'};
  const reserve=createSupportLimiter({env,getSql:async()=>sql});
  assert.equal((await reserve({headers:{'x-forwarded-for':'nonsense'}})).unavailable,true);
  assert.equal(queries.length,0);
  assert.equal((await reserve({headers:{'x-forwarded-for':'192.0.2.2'}})).allowed,true);
  assert.equal(queries.length,4);assert.ok(!JSON.stringify(queries).includes('192.0.2.2'));
  assert.deepEqual(queries.slice(1).map(q=>q.values.at(-1)),[5,20,100]);
  const other=createSupportLimiter({env,getSql:async()=>sql});
  const key=queries[1].values[0];await other({headers:{'x-forwarded-for':'192.0.2.2'}});
  assert.equal(queries[5].values[0],key);
});
test('zero global quota blocks provider and rejected reservations are not retried', async () => {
  let inserts=0;
  const reserve=createSupportLimiter({env:{VERCEL:'1',LOYALTY_SUPPORT_RATE_SECRET:'test',LOYALTY_SUPPORT_DAILY_REQUESTS:'0'},getSql:async()=>async(strings)=>{if(strings.join('').includes('INSERT'))inserts++;return [{used:1}];}});
  assert.equal((await reserve({headers:{'x-forwarded-for':'192.0.2.2'}})).allowed,false);assert.equal(inserts,2);
});
test('Israel quotas use only the dedicated Israel database', async () => {
  const { supportDatabaseUrl } = await import('../lib/support-limits.mjs');
  const req = {headers:{host:'loyaltyapp.company'}};
  assert.equal(supportDatabaseUrl(req,{DATABASE_URL:'us-only'}),undefined);
  assert.equal(supportDatabaseUrl(req,{DATABASE_URL:'shared',ISRAEL_DATABASE_URL:'shared'}),undefined);
  assert.equal(supportDatabaseUrl(req,{DATABASE_URL:'us-only',ISRAEL_DATABASE_URL:'israel-only'}),'israel-only');
  assert.equal(supportDatabaseUrl({headers:{host:'loyaltyusapp.com'}},{DATABASE_URL:'us-only',ISRAEL_DATABASE_URL:'israel-only'}),'us-only');
});
