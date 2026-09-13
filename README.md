# LOYALTY US Growth Engine

## What is included
- US marketing homepage
- Self-serve business signup
- Stripe subscription checkout ($29/month)
- Stripe webhook
- Automatic Business ID creation
- Business-specific QR / claim URL
- Customer reward claim flow
- Business dashboard
- Website widget code
- Local JSON persistence for MVP/demo mode

## Run locally
1. Install Node.js 18+
2. Copy `.env.example` to `.env`
3. Run:
   npm install
   npm start
4. Open http://localhost:3000

## Stripe
Create a recurring Stripe Price for $29/month and paste the `price_...` value into:
STRIPE_PRICE_ID

Paste your Stripe secret key into:
STRIPE_SECRET_KEY

Create a webhook endpoint:
https://YOURDOMAIN.com/api/stripe/webhook

Listen for:
checkout.session.completed

Paste the webhook signing secret into:
STRIPE_WEBHOOK_SECRET

If Stripe keys are not configured, the app automatically runs in DEMO MODE and skips payment so the rest of the flow can be tested.

## Production notes
This package is an MVP foundation. Before public launch:
- replace JSON storage with Postgres/Supabase
- add authentication for business dashboard
- add SMS/email verification for customer claims
- add fraud/rate limiting for reward claims
- host QR generation internally or use a production QR library
- add Terms, Privacy Policy, refund/cancellation policy
- configure transactional email/SMS
- connect analytics and ad conversion tracking
