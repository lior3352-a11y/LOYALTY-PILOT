import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export async function testDatabase() {
  let engine, raw, transaction, close;
  if (process.env.SECURITY_TEST_DATABASE_URL) {
    const url = new URL(process.env.SECURITY_TEST_DATABASE_URL);
    if (!['localhost','127.0.0.1','[::1]','postgres'].includes(url.hostname)) throw Error('Tests require a disposable local PostgreSQL database');
    const pool = new pg.Pool({connectionString:url.href});
    raw = async (text, values=[]) => (await pool.query(text, values)).rows;
    transaction = async cb => {
      const client=await pool.connect();
      try {await client.query('BEGIN');const result=await cb(async(text,values=[]) => (await client.query(text,values)).rows);await client.query('COMMIT');return result;}
      catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    };
    await raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    close=()=>pool.end();engine='PostgreSQL (independent connections)';
  } else {
    const db=new PGlite();
    raw=async(text,values=[]) => (await db.query(text,values)).rows;
    raw.exec=text=>db.exec(text);
    transaction=cb=>db.transaction(tx=>cb(async(text,values=[]) => (await tx.query(text,values)).rows));
    close=()=>db.close();engine='PGlite PostgreSQL (serialized connection)';
  }
  const exec = raw.exec || (text=>raw(text));
  const tag=async(strings,...values)=>raw(strings.reduce((s,v,i)=>s+(i?'$'+i:'')+v,''),values);
  tag.queryRows=raw;tag.transactionBlock=transaction;
  const fixture=await readFile(new URL('./fixtures/current-us-schema.sql',import.meta.url),'utf8');
  await exec(fixture);
  const migration=await readFile(new URL('../migrations/20260918-us-security-v2.sql',import.meta.url),'utf8');
  return {db:tag,exec,close,engine,migrate:()=>exec(migration)};
}
