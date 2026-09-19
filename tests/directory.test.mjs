import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/neon.js';
import {testDatabase} from './database.mjs';
process.env.LOYALTY_REGION='us';process.env.LOYALTY_US_SECURITY_V2='true';
test('directory protects owner writes and exposes only opted-in matching public stores',async t=>{
 const f=await testDatabase();t.after(f.close);await f.migrate();const q=f.db.queryRows;
 await q("INSERT INTO loyalty_businesses(id,name,qr_token) VALUES(1,'First','secret1'),(2,'Second','secret2')");
 await q("INSERT INTO loyalty_users(id,email,password_hash,role,business_id) VALUES(1,'owner@test','hash','owner',1),(2,'staff@test','hash','staff',1)");
 await q("INSERT INTO loyalty_sessions(token,user_id,expires_at) VALUES('owner',1,NOW()+INTERVAL '1 day'),('staff',2,NOW()+INTERVAL '1 day')");
 await q("INSERT INTO loyalty_business_settings(business_id,settings) VALUES(1,'{\"unrelated\":42}'),(2,'{}')");
 const h=createHandler(()=>f.db);
 async function call(body){const r={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this},json(v){this.body=v;return this}};await h({method:'POST',headers:{host:'test','content-type':'application/json'},body},r);return r;}
 const profile={action:'directory_profile_save',city:'Huntington',state:'ny',address:'1 Main St',listed:true,business_id:2};
 assert.equal((await call(profile)).statusCode,403);
 assert.equal((await call({...profile,access_token:'staff'})).statusCode,403);
 assert.equal((await call({...profile,access_token:'owner'})).statusCode,200);
 assert.equal((await q('SELECT settings FROM loyalty_business_settings WHERE business_id=1'))[0].settings.unrelated,42);
 assert.deepEqual((await q('SELECT settings FROM loyalty_business_settings WHERE business_id=2'))[0].settings,{});
 const search={action:'directory_search',city:'huntington',state:'NY'};
 let r=await call(search);assert.equal(r.body.businesses.length,1);assert.equal(r.body.businesses[0].qr_token,undefined);assert.equal(r.body.businesses[0].address,'1 Main St');
 assert.equal((await call({...search,state:'CA'})).body.businesses.length,0);
 assert.equal((await call({...search,city:"' OR 1=1 --"})).body.businesses.length,0);
 assert.equal((await call({...search,offset:-1})).statusCode,400);
 await call({...profile,access_token:'owner',listed:false});assert.equal((await call(search)).body.businesses.length,0);
});
