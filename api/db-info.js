import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.ENABLE_DB_INFO !== 'true') return res.status(404).json({ ok: false });
  if (!process.env.DATABASE_URL) return res.status(500).json({ ok: false });
  try {
    const sql = neon(process.env.DATABASE_URL);
    const columns = await sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;
    return res.status(200).json({ ok: true, columns });
  } catch (error) {
    console.error(error?.message || error);
    return res.status(500).json({ ok: false });
  }
}
