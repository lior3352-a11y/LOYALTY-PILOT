# Loyalty Israel deployment gate

The `israel` branch is the Hebrew candidate. Do not use the US Vercel project or US Neon tables for it.

## Implemented safeguards

- Data API uses `ISRAEL_DATABASE_URL` when configured. Until a dedicated Israel database is provisioned, it may use the existing Vercel `DATABASE_URL` only with the isolated PostgreSQL schema `loyalty_israel`.
- US Stripe billing and webhook endpoints return an unavailable response; the merchant dashboard does not offer subscription controls.
- The legacy Supabase proxy is closed.
- The English US theme injector is removed from the Hebrew pages.

## Before a full public commercial deployment

1. Create a separate Neon project/database for Israel and configure **only** its URL as `ISRAEL_DATABASE_URL` in the Israel Vercel project.
2. Review automatic schema setup against the Israel database/schema. Never run Hebrew data into US tables.
3. Review the Hebrew `terms.html`, `privacy.html`, and `accessibility.html` with qualified Israeli counsel before paid commercial use.
4. Set an Israeli payment provider and approved ILS pricing before enabling billing. Stripe billing remains disabled.
5. Test sign-up, authentication, QR, rewards, redemption, and persistence on the separate preview URL.
6. Connect the Vercel-owned `loyaltyapp.app` domain only after the checks above pass.

Temporary operational note, 2026-10-05: `DATABASE_URL` is enabled for preview on `loyalty-il` and Hebrew data is isolated in schema `loyalty_israel` until the dedicated `ISRAEL_DATABASE_URL` is added.

The GitHub Pages root and `loyaltyusapp.com` serve the English version.