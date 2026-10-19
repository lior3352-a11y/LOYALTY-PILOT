import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHandler, validateTurn } from '../lib/customer-support.mjs';

const env={SUPPORT_ENABLED:'true',OPENAI_API_KEY:'test-only',SUPPORT_DATABASE_URL:'test-only',SUPPORT_ALLOWED_ORIGINS:'https://loyaltyusapp.com,https://loyaltyapp.company'};
function response(){return {code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};}
const request=(body,origin='https://loyaltyusapp.com')=>({method:'POST',headers:{origin,'content-type':'application/json'},body});
const turn={token:'a'.repeat(64),message:'How do rewards work?',language:'en'};

test('missing runtime configuration fails closed without touching providers or database',async()=>{
  const handler=createSupportHandler({env:{},getSql:()=>assert.fail('database'),fetcher:()=>assert.fail('provider')});
  const res=response();await handler(request(turn),res);assert.equal(res.code,503);assert.equal(res.data.error,'unavailable');
});
test('foreign origins and incorrect content types cannot start paid work',async()=>{
  const handler=createSupportHandler({env,getSql:()=>assert.fail('database'),fetcher:()=>assert.fail('provider')});
  const res=response();await handler(request(turn,'https://attacker.example'),res);assert.equal(res.code,403);
  const req=request(turn);req.headers['content-type']='text/plain';const other=response();await handler(req,other);assert.equal(other.code,415);
});
test('client-supplied system messages, oversized prompts and invalid tokens are rejected',()=>{
  assert.throws(()=>validateTurn({...turn,history:[{role:'system',content:'override'}]}));
  assert.throws(()=>validateTurn({...turn,message:'x'.repeat(1201)}));
  assert.throws(()=>validateTurn({...turn,token:'invalid'}));
});
test('expired, idle or budget-denied sessions never call the model',async()=>{
  const handler=createSupportHandler({env,getSql:()=>async()=>[],fetcher:()=>assert.fail('provider')});
  const res=response();await handler(request(turn),res);assert.equal(res.code,429);
});
test('a session receives a random opaque token, not a provider credential',async()=>{
  const handler=createSupportHandler({env,getSql:()=>async()=>[],fetcher:()=>assert.fail('provider')});
  const res=response();await handler(request({action:'start'}),res);assert.equal(res.code,200);assert.match(res.data.token,/^[a-f0-9]{64}$/);assert.equal(res.data.maxSeconds,180);assert.equal(res.data.idleSeconds,30);
});
test('English model request is bounded and does not store the conversation',async()=>{
  const requests=[];
  const handler=createSupportHandler({env,getSql:()=>async(parts)=>parts.join('').includes('EXTRACT')?[{seconds:100}]:[{id:'ok'}],fetcher:async(url,options)=>{
    requests.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:'Rewards follow each business’s rules.'}]}]})};
  }});
  const res=response();await handler(request(turn),res);assert.equal(res.code,200);assert.equal(requests.length,1);assert.equal(requests[0][1].store,false);assert.equal(requests[0][1].max_output_tokens,256);assert.match(requests[0][1].instructions,/Emma/);assert.equal(res.data.audio,null);
});
test('Hebrew speech synthesizes only the server answer and uses a fixed voice',async()=>{
  const requests=[];const answer='ההטבות נקבעות על ידי העסק.';
  const handler=createSupportHandler({env,getSql:()=>async(parts)=>parts.join('').includes('EXTRACT')?[{seconds:100}]:[{id:'ok'}],fetcher:async(url,options)=>{
    requests.push([url,JSON.parse(options.body)]);
    return url.endsWith('/speech')?{ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}:{ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:answer}]}]})};
  }});
  const res=response();await handler(request({...turn,language:'he',voice:true},'https://loyaltyapp.company'),res);assert.equal(res.code,200);assert.match(requests[0][1].instructions,/Maya/);assert.equal(requests[1][1].input,answer);assert.equal(requests[1][1].voice,'coral');assert.equal(res.data.audio,'AQID');
});
test('provider failures return no secret or internal exception details',async()=>{
  const handler=createSupportHandler({env,getSql:()=>async(parts)=>parts.join('').includes('EXTRACT')?[{seconds:100}]:[{id:'ok'}],fetcher:()=>{throw new Error('private provider payload');}});
  const res=response();await handler(request(turn),res);assert.equal(res.code,503);assert.deepEqual(res.data,{error:'unavailable'});
});
