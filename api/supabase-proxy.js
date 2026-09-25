// The Israel application uses its own Neon database; legacy Supabase access is closed.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'Legacy data endpoint is unavailable' });
}
