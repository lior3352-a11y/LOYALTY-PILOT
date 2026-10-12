import { neon } from '@neondatabase/serverless';

// Read metadata only from the dedicated Israel database.
const israelDatabaseUrl = () => {
  const dedicatedUrl = process.env.ISRAEL_DATABASE_DATABASE_URL || process.env.ISRAEL_DATABASE_URL;
  if (!dedicatedUrl || dedicatedUrl === process.env.DATABASE_URL) return null;
  return dedicatedUrl;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.ENABLE_DB_INFO !== 'true') return res.status(404).json({ ok: false });
  const url = israelDatabaseUrl();
  if (!url) return res.status(500).json({ ok: false });
  try {
    const sql = neon(url);
    const columns = await sql`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position
    `;
    return res.status(200).json({ ok: true, columns });
  } catch (error) {
    console.error(error?.message || error);
    return res.status(500).json({ ok: false });
  }
}