import { neon } from '@neondatabase/serverless';
import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };
const readBody = async (req) => { const chunks=[]; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks); };
export default async function handler(req,res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'POST required' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).json({ error:'Stripe webhook is not configured' });
  try {
    const raw = await readBody(req);
    const event = new Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    const sql = neon(process.env.DATABASE_URL);
    const object = event.data.object;
    const businessId = Number(object.metadata?.business_id || 0);
    if (businessId) {
      const status = event.type === 'invoice.payment_failed' ? 'past_due' : event.type === 'customer.subscription.deleted' ? 'canceled' : event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created' ? (object.status === 'trialing' ? 'trialing' : object.status === 'active' ? 'active' : object.status === 'past_due' ? 'past_due' : object.status === 'canceled' ? 'canceled' : 'expired') : null;
      if (status) await sql`UPDATE loyalty_subscriptions SET subscription_status=${status},stripe_customer_id=COALESCE(${object.customer || null},stripe_customer_id),stripe_subscription_id=COALESCE(${object.id || null},stripe_subscription_id),next_billing_date=COALESCE(TO_TIMESTAMP(${object.current_period_end || object.trial_end || null}),next_billing_date),updated_at=NOW() WHERE business_id=${businessId}`;
      if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') { const paidAt = event.type === 'invoice.paid' ? new Date() : null; await sql`INSERT INTO loyalty_payment_history(business_id,stripe_invoice_id,amount_paid_cents,status,paid_at) VALUES(${businessId},${object.id},${Number(object.amount_paid || 0)},${event.type === 'invoice.paid' ? 'paid' : 'failed'},${paidAt}) ON CONFLICT (stripe_invoice_id) DO UPDATE SET amount_paid_cents=EXCLUDED.amount_paid_cents,status=EXCLUDED.status,paid_at=EXCLUDED.paid_at`; }
    }
    return res.json({ received:true });
  } catch (error) { console.error('[v0] Stripe webhook error:', error?.message || error); return res.status(400).json({ error:'Invalid webhook' }); }
}
