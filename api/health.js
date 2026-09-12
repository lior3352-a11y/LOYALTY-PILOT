import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ ok: false, database: 'missing DATABASE_URL' });
  }
  try {
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT current_database() AS database, NOW() AS server_time`;
    return res.status(200).json({ ok: true, database: result[0].database, server_time: result[0].server_time });
  } catch (error) {
    console.error('Neon health check failed:', error?.message || error);
    return res.status(500).json({ ok: false, database: 'connection failed' });
  }
}
