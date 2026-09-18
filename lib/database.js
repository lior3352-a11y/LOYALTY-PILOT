import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import WebSocket from 'ws';
neonConfig.webSocketConstructor = WebSocket;

export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const db = neon(process.env.DATABASE_URL);
  db.queryRows = (text, values = []) => db.query(text, values);
  db.transactionBlock = async callback => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await callback(async (text, values = []) => (await client.query(text, values)).rows);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client?.release();
      await pool.end();
    }
  };
  return db;
}
