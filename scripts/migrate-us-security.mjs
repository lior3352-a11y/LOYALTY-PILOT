import pg from 'pg';
import { readFile } from 'node:fs/promises';
// Deliberately do not use DATABASE_URL: the operator must identify the US database.
const connectionString = process.env.US_MIGRATION_DATABASE_URL;
if (!connectionString || process.env.LOYALTY_REGION !== 'us') throw Error('Set US_MIGRATION_DATABASE_URL and LOYALTY_REGION=us explicitly');
const url = new URL(connectionString);
if (url.hostname !== process.env.US_MIGRATION_EXPECTED_HOST || url.pathname.slice(1) !== process.env.US_MIGRATION_EXPECTED_DATABASE) throw Error('US database identity does not match the explicit host/database checks');
let sql = await readFile(new URL('../migrations/20260918-us-security-v2.sql',import.meta.url),'utf8');
const apply = process.argv.includes('--apply');
if (!apply) sql = sql.replace(/COMMIT;\s*$/, 'ROLLBACK;');
const pool = new pg.Pool({connectionString});
try { await pool.query(sql); console.log(apply ? 'US security migration applied.' : 'US security migration dry run passed; all changes rolled back.'); }
finally { await pool.end(); }
