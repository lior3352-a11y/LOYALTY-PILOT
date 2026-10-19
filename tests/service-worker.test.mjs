import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../sw.js', import.meta.url),'utf8');
function worker() {
  const handlers={},writes=[],requests=[];
  const context={URL,self:{location:{origin:'https://loyaltyusapp.com'},addEventListener:(event,fn)=>handlers[event]=fn},
    caches:{open:async()=>({put:async(...args)=>writes.push(args)}),match:async()=>undefined},
    fetch:async req=>{requests.push(req);return {ok:false,status:500,clone(){return this;}};}};
  vm.runInNewContext(code,context);return {handlers,writes,requests};
}
test('API, POST, cross-origin and Authorization requests never enter the offline cache handler',()=>{
  for(const [method,url,authorization] of [
    ['GET','https://loyaltyusapp.com/api/neon',false],['POST','https://loyaltyusapp.com/api/support',false],
    ['GET','https://third-party.example/image.jpg',false],['GET','https://loyaltyusapp.com/customer.html',true],
  ]){const w=worker();w.handlers.fetch({request:{method,url,headers:{has:()=>authorization}},respondWith:()=>assert.fail('intercepted'),waitUntil:()=>assert.fail('cache write')});assert.equal(w.requests.length,0);}
});
test('server error pages are not saved as the next offline page',async()=>{
  const w=worker();let pending;
  w.handlers.fetch({request:{method:'GET',url:'https://loyaltyusapp.com/join.html',mode:'navigate',headers:{has:()=>false}},respondWith:p=>pending=p,waitUntil:()=>assert.fail('cached error')});
  const result=await pending;assert.equal(result.status,500);assert.equal(w.writes.length,0);
});
