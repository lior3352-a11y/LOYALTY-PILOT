# Customer account security — release candidate

This change replaces unauthenticated phone-to-wallet-token lookup with password-protected customer accounts. Existing balances are retained; legacy accounts require the business owner to verify identity in person and hand the customer a short-lived, single-use password setup link. A phone number or an old wallet URL never establishes ownership. The same owner-assisted flow handles forgotten passwords; no email/SMS provider has been configured.

Customer sessions use hashed, revocable server records and Secure/HttpOnly/SameSite cookies. Password reset changes the account version so previous sessions and redemption approvals stop working. Checkout requires a five-minute customer approval bound to the account, business, session and exact amount. A single SQL statement consumes the approval, deducts the balance and logs the redemption. Merchant/admin logout now revokes its server token. Sensitive API requests bypass service-worker caching. Customer history uses text nodes rather than unescaped HTML.

## Separate deployments

GitHub reports that both `loyalty-pilot` and `loyalty_us_fullstack_starter` deployed commit `47e3fe1d69923d0f08cd656c9bd7cc843b3ddc5f`, the Hebrew localization. Both currently track the same source. This is why Hebrew changes can reach the US project.

Two independent release candidates are provided: `security/he-customer-auth` preserves the Hebrew source; `security/us-customer-auth` applies the same security changes to the last identified English source `753554323d25fa83bea7fd686ab6397086153d4b`. Configure the correct production branch for each Vercel project before promoting either candidate. Do not merge the English language restoration into a branch still shared by both production projects. Verify whether DATABASE_URL values point to separate databases; do not move or copy customer data as part of deployment.

## Verification

`npm test` runs eight backend control-flow/security tests using a database double. They cover salted password verification, request origin protection, legacy-token rejection, duplicate-phone registration rejection, session-bound customer reads, logout token replay, recovery role restrictions and missing/invalid redemption approvals. JavaScript files and inline HTML scripts were syntax-checked in both language variants.

The tests do not execute PostgreSQL. Browser tests are included in `tests/browser-security.cjs`, but were not run successfully here because Chromium is unavailable. Live production URLs could not be read in this environment. No production change or migration has been applied.

## Required release checks

- Run the API against an isolated Neon branch with representative existing schema/data. Verify schema compatibility, password setup, password reset invalidation, signup, login, logout, expiration and old-token denial.
- Test simultaneous redemption requests and confirm exactly one deduction and one transaction. Test wrong amount, wrong business, expiration, logout and password-reset invalidation, and insufficient balances. PostgreSQL semantics and atomicity require actual database tests.
- Run desktop and mobile browser tests for both languages. Test a second tab, browser back and old installed service workers. The new frontend and backend must be deployed together.
- Verify legacy Supabase configuration/RLS independently if that legacy service remains configured; it is not used by the new Neon customer flow. Existing merchant sessions still use bearer tokens in localStorage; this patch adds server revocation but does not migrate merchant authentication to cookies.
- Assign the correct Vercel production branches and verify each production URL, database connection and language before accepting customer traffic. Use the owner-assisted identity verification workflow for existing customers; do not distribute setup links without verification.
