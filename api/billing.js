// Israel billing is disabled until an Israeli payment provider and price are configured.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(503).json({ error: 'התשלום לגרסה הישראלית עדיין אינו זמין' });
}
