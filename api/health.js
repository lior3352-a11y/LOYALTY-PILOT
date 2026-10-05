import { neon } from '@neondatabase/serverless';

const ISRAEL_SCHEMA = 'loyalty_israel';
const withIsraelSchema = value => {
  const url = new URL(value);
  const existing = url.searchParams.get('options');
  const schemaOption = '-c search_path=' + ISRAEL_SCHEMA;
  url.searchParams.set('options', existing ? existing + ' ' + schemaOption : schemaOption);
  return url.toString();
};
const israelDatabaseUrl = () => {
  if (process.env.ISRAEL_DATABASE_URL && process.env.ISRAEL_DATABASE_URL !== process.env.DATABASE_URL) return { url: process.env.ISRAEL_DATABASE_URL, mode: 'dedicated' };
  if (process.env.DATABASE_URL) return { url: withIsraelSchema(process.env.DATABASE_URL), mode: 'schema' };
  return null;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const dbConfig = israelDatabaseUrl();
  if (!dbConfig) return res.status(500).json({ ok: false, database: 'Israel database not configured' });
  try {
    const sql = neon(dbConfig.url);
    await sql`CREATE SCHEMA IF NOT EXISTS loyalty_israel`;
    const result = await sql`SELECT current_database() AS database, current_schema() AS schema, NOW() AS server_time`;
    return res.status(200).json({ ok: true, mode: dbConfig.mode, database: result[0].database, schema: result[0].schema, server_time: result[0].server_time });
  } catch (error) {
    console.error('Neon health check failed:', error?.message || error);
    return res.status(500).json({ ok: false, database: 'connection failed' });
  }
}