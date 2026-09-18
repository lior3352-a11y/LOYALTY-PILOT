import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHandler} from '../api/neon.js';
import {passwordHash} from '../lib/customer-security.js';
import {testDatabase} from './database.mjs';
process.env.LOYALTY_REGION='us';process.env.LOYALTY_US_SECURITY_V2='true';
const f=await testDatabase(),q=f.db.queryRows;
await q("INSERT INTO loyalty_businesses(id,name,qr_token) VALUES(1,'Test store','store')");
await q("INSERT INTO loyalty_users(email,password_hash,role,business_id) VALUES('owner@example.test',$1,'owner',1)",[await passwordHash('merchant password')]);
await f.migrate();
const tmp=await mkdtemp(path.join(tmpdir(),'loyalty-browser-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',tmp+'/key.pem','-out',tmp+'/cert.pem','-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
const root=path.resolve(new URL('..',import.meta.url).pathname),handler=createHandler(()=>f.db);
const server=createServer({key:await readFile(tmp+'/key.pem'),cert:await readFile(tmp+'/cert.pem')},async(req,res)=>{
 try {
  const url=new URL(req.url,'https://localhost');
  if(url.pathname==='/api/neon'){
   let body='';for await(const c of req)body+=c;req.body=JSON.parse(body||'{}');
   res.status=s=>{res.statusCode=s;return res;};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
   await handler(req,res);return;
  }
  if(url.pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Not used by this test"}');return;}
  const filename=path.resolve(root,'.'+url.pathname);
  if(!filename.startsWith(root+path.sep))throw Error('Invalid file');
  const data=await readFile(filename);const ext=path.extname(filename);
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[ext]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch(e){res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='https://127.0.0.1:'+server.address().port;
let browser;
try {
 let options={headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox','--ignore-certificate-errors']};
 if(process.env.SECURITY_CHROMIUM_NPM==='true'){
  const {default:binary}=await import('@sparticuz/chromium');options={...options,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--ignore-certificate-errors'],executablePath:process.env.SECURITY_CHROMIUM_PATH || await binary.executablePath()};
 }
 browser=await chromium.launch(options);
 for(const width of [390,1280]){
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  console.log(width,'signup');await page.goto(base+'/join.html?business_id=1');
  assert.equal(await page.locator('#signupCard').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  // Old cache is removed by the replacement worker; real fetch/API remains in use.
  await page.evaluate(async()=>{const cache=await caches.open('loyalty-pilot-v12');await cache.put('/stale-account',new Response('private old data'));const r=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service worker was not ready')),10000))]);await r.unregister();});
  console.log(width,'old cache');await page.reload();
  await page.waitForFunction(async()=>!(await caches.keys()).includes('loyalty-pilot-v12'));
  const email=`browser${width}@example.test`,phone='212555'+width;
  for(const [id,value] of Object.entries({firstName:'Browser',lastName:'User',phone,email,password:'correct password',confirmPassword:'correct password',address:'1 Test St',city:'New York',state:'NY',zip:'10001'}))await page.locator('#'+id).fill(value);
  await page.locator('#terms').check();await page.locator('#signupBtn').click();await page.waitForURL('**/customer.html');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('connected'));
  const cookies=await context.cookies();const session=cookies.find(c=>c.name==='__Host-loyalty_customer');assert(session?.secure&&session.httpOnly&&session.sameSite==='Strict');
  assert.equal(await page.evaluate(()=>localStorage.getItem('loyalty_customer_access_token')),null);
  assert.equal(await page.locator('#profile').textContent().then(t=>t.includes('1 Test St')),true);
  await q('UPDATE loyalty_wallets SET balance=100 WHERE customer_id IN (SELECT c.id FROM loyalty_customers c JOIN loyalty_customer_accounts a ON a.id=c.account_id WHERE a.email=$1)',[email]);
  await page.evaluate(()=>refresh());
  console.log(width,'approval');let code;page.once('dialog',d=>d.accept('10'));const codeDialog=new Promise(resolve=>{page.on('dialog',function capture(d){if(d.message().startsWith('Give this code')){code=d.defaultValue();page.off('dialog',capture);d.dismiss();resolve();}});});
  await page.locator('[data-business="1"]').click();await codeDialog;assert.match(code,/^[a-f0-9-]{19}$/);
  const merchant=await browser.newContext({ignoreHTTPSErrors:true}),pos=await merchant.newPage();await pos.goto(base+'/merchant.html');
  await pos.locator('#email').fill('owner@example.test');await pos.locator('#password').fill('merchant password');await pos.locator('#loginBtn').click();await pos.waitForFunction(()=>!document.getElementById('merchantArea').classList.contains('hidden'));
  await pos.locator('#redeemPhone').fill(phone);await pos.locator('#redeemAmount').fill('10');pos.once('dialog',d=>d.accept(code));await pos.locator('#redeemBtn').click();await pos.waitForFunction(()=>document.getElementById('redeemResult').textContent.includes('Reward redeemed'));
  const merchantToken=await pos.evaluate(()=>localStorage.getItem('loyalty_merchant_access_token'));
  // Recovery must use the logged-in owner's token and the existing customer row.
  console.log(width,'recovery');let recoveryUrl;pos.once('dialog',d=>d.accept());const recoveryDialog=new Promise(resolve=>{pos.on('dialog',function capture(d){if(d.message().startsWith('Give this one-time')){recoveryUrl=d.defaultValue();pos.off('dialog',capture);d.dismiss();resolve();}});});
  const customerId=(await q('SELECT c.id FROM loyalty_customers c JOIN loyalty_customer_accounts a ON a.id=c.account_id WHERE a.email=$1',[email]))[0].id;
  await pos.locator(`[data-recovery-customer="${customerId}"]`).click();await recoveryDialog;
  await pos.getByRole('button',{name:'Log out',exact:true}).click();await pos.waitForURL('**/merchant.html');
  const replay=await pos.request.post(base+'/api/neon',{data:{action:'merchant_rpc',name:'business_customers',access_token:merchantToken},headers:{Origin:base}});assert.equal(replay.status(),403);
  const reset=await context.newPage();await reset.goto(recoveryUrl);await reset.waitForFunction(()=>document.getElementById('loginBtn').textContent==='Set new password');
  await reset.locator('#loginPassword').fill('new correct password');await reset.locator('#loginBtn').click();await reset.waitForURL('**/customer.html');
  const oldSessionReplay=await context.request.post(base+'/api/neon',{data:{action:'customer_account'},headers:{Origin:base,Cookie:`${session.name}=${session.value}`}});assert.equal(oldSessionReplay.status(),401);
  const second=await context.newPage();await second.goto(base+'/customer.html');await second.waitForFunction(()=>document.getElementById('status').textContent.includes('connected'));
  await reset.getByRole('button',{name:'Log out',exact:true}).click();await reset.waitForURL('**/join.html?mode=login');await second.waitForURL('**/join.html?mode=login');
  await reset.goBack();await reset.waitForURL('**/join.html*');
  assert.equal(await reset.locator('#profile').count(),0);
  assert.deepEqual(errors,[]);await merchant.close();await context.close();
  console.log(`PASS ${width}px: white signup, real cookie auth, old cache purge, approval + redemption, owner recovery, token replay denial, cross-tab logout and back navigation`);
 }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await f.close();await rm(tmp,{recursive:true,force:true});}
