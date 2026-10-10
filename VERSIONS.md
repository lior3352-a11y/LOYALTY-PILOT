# LOYALTY versions

This repository currently contains two product variants. Keep their public URLs, deployments, and data separate.

| Variant | Language and market | Source | Current public entry point |
| --- | --- | --- | --- |
| Loyalty US | English, United States | `main` | `https://loyaltyusapp.com/` |
| Loyalty Israel | Hebrew, Israel | `israel` (copied from the September 17 Hebrew candidate; review pending) | **No verified public Hebrew URL yet** |

`https://lior3352-a11y.github.io/LOYALTY-PILOT/` serves the repository's `main` branch, whose landing page is English. It is **not** the Hebrew entry point. `loyalty-pilot` on Vercel also deploys `main` to production. Do not send either URL as a Hebrew link.

## Publishing the Hebrew variant

1. Review the `israel` branch against subsequent US changes and maintain it independently. Preserve the Hebrew UI and `lang="he" dir="rtl"` while incorporating only relevant fixes.
2. Create a separate Vercel project with its production branch set to the Israel branch. Give it a distinct, verified URL. Do not repoint the US project or the GitHub Pages root.
3. Configure a separate production database for Israel. The Hebrew candidate still includes US Stripe billing (`usd`, `Loyalty US Standard`, 4900 cents) and automatic schema changes; keep billing disabled until an Israel provider and price are implemented. Check legal copy, authentication, and QR URLs before inviting users.
4. Test business signup, customer signup and sign in, rewards, redemption, and persistence on the Hebrew production URL. Record that URL here only after those checks pass.

The English production deployment and customer data must remain isolated throughout this work.
