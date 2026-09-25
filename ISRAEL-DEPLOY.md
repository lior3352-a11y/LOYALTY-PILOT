# Loyalty Israel deployment gate

The `israel` branch is the Hebrew candidate. Do not use the US Vercel project or US Neon connection for it.

## Implemented safeguards

- Data API requires `ISRAEL_DATABASE_URL` with no `DATABASE_URL` fallback and rejects an identical value when both are present.
- US Stripe billing and webhook endpoints return an unavailable response; the merchant dashboard does not offer subscription controls.
- The legacy Supabase proxy is closed.
- The English US theme injector is removed from the Hebrew pages.

## Before a public deployment

1. Create a separate Neon project/database for Israel and configure **only** its URL as `ISRAEL_DATABASE_URL` in a separate Vercel project.
2. Review automatic schema setup against the new, empty database. Never run it against the US database.
3. Replace the English `terms.html` and `accessibility.html` with reviewed Israel-specific Hebrew pages; add a Hebrew privacy policy. The business sign-up currently links to US terms and must not be advertised yet.
4. Set an Israeli payment provider and approved ILS pricing before enabling billing. Stripe billing remains disabled.
5. Test sign-up, authentication, QR, rewards, redemption, and persistence on the separate preview URL.
6. Connect the Vercel-owned `loyaltyapp.app` domain only after the checks above pass.

The GitHub Pages root and `loyaltyusapp.com` serve the English version.
