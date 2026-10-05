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
  if (process.env.ISRAEL_DATABASE_URL && process.env.ISRAEL_DATABASE_URL !== process.env.DATABASE_URL) return process.env.ISRAEL_DATABASE_URL;
  if (process.env.DATABASE_URL) return withIsraelSchema(process.env.DATABASE_URL);
  return null;
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
      WHERE table_schema = 'loyalty_israel'
      ORDER BY table_name, ordinal_position
    `;
    return res.status(200).json({ ok: true, columns });
  } catch (error) {
    console.error(error?.message || error);
    return res.status(500).json({ ok: false });
  }
}