// Never accept US Stripe events in the Israel deployment.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'Stripe is not used for Israel billing' });
}
