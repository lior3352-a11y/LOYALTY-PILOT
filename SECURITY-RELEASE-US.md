# English US account security v2

Based on `main` commit `26ddb28a2995e245aeae00791593319cafcba4fe`, retaining the full personal-registration form and white styling. This supersedes the English security candidate based on `7535543`; do not merge the Hebrew PR #8 to obtain these changes.

## What changes

- Customer passwords remain compatible with the current salted scrypt hashes and the existing 8-character form minimum; new and existing password inputs are capped at 128 characters. Expiring customer sessions are stored only as hashes in new, versioned tables and carried by Secure/HttpOnly/SameSite=Strict host cookies. Legacy localStorage and URL tokens do not authenticate.
- Removed the old phone-to-wallet-token API and automatic phone-based takeover of existing memberships. Brand-new memberships start with zero rewards; an existing balance is only linked with an owner-verified single-use token and authenticated matching account.
- Existing memberships were linked by insecure phone matching. The migration retains balances, profiles and transaction history, but requires owner verification before exposing existing memberships to customer accounts. Merchant records remain available. No customers are automatically assigned to a first business.
- Customer and merchant/admin logout revoke server sessions; network failure does not pretend logout succeeded. Password reset invalidates all current customer sessions and associated approvals. Customer pages clear private data on navigation, reject delayed responses after logout, and propagate logout between tabs.
- Five-minute single-use redemption approvals are bound to the authenticated account, its verified membership, business, session/version and exact amount. Account-row locks serialize approval, logout, reset and redemption. Debit, transaction logging and approval consumption run in one database transaction; failures roll back all three.
- No schema changes run in `/api/neon` requests. `migrations/20260918-us-security-v2.sql` is explicit, transactional, repeatable, and refuses ambiguous legacy ownership/duplicate normalized phones. It deliberately leaves either legacy `loyalty_customer_sessions` shape untouched, using `loyalty_us_*_v2` tables instead.
- The legacy Supabase proxy is disabled for US, even if an old enable flag remains. For other environments it requires an explicit opt-in. These changes do not inspect or change the remote Supabase RLS configuration.

## Existing screens and security interactions

HTML layouts, form fields and page CSS are preserved. The existing global black/gold style injector is skipped only on the private signup page, so its already-defined white design is actually visible. Existing controls now use secure endpoints. Necessary confirmation flows use native browser dialogs:

- Customer: select a business row in **My Rewards**, enter the amount, and give the resulting code to the cashier. The merchant's existing **Redeem reward** button requests that code.
- Owner: select a row under **Customers**, independently verify identity in person, then hand the one-time recovery link to that customer. Never treat knowledge of a phone number as identity proof; never send links automatically.
- The recovery link removes its secret fragment from browser history immediately and expires in 15 minutes. For an unlinked legacy membership, the customer signs in/creates their full account before consuming it. For a single-business account, it uses the existing sign-in form to set a new password.
- For a multi-business account, owner-issued links can verify only that owner's membership and require an existing authenticated customer session. An individual merchant cannot reset the global password. Lost-password recovery for multi-business or no-business accounts still needs an independently verified support/channel workflow; this release intentionally does not grant merchants that cross-business power or invent an email/SMS delivery service.

## Validation commands

`pnpm test` runs the API and migration against PGlite's PostgreSQL engine by default. This executes real SQL but serializes transactions on one embedded connection; it does not prove independent-connection races.

For a disposable local PostgreSQL database, set `SECURITY_TEST_DATABASE_URL` and run `pnpm test`. **The fixture resets that test database's public schema.** Remote hosts are rejected. GitHub Actions provisions PostgreSQL 17, runs these tests with independent connections, then runs the browser suite. No production credentials are used.

`pnpm exec playwright install chromium` and `pnpm test:browser` exercise the actual API and SQL through local HTTPS at mobile/desktop widths, including old service-worker cache cleanup, owner recovery and logout replay. The browser suite uses a temporary self-signed test certificate and never calls the production site. An optional locally supplied Chromium executable is supported for constrained test environments.

## Production gates and rollout

1. Verify the exact US domain, Vercel project, production branch, immutable commit and database host/name from authenticated configuration. Both Vercel projects previously built the same commits; GitHub success statuses alone do not establish isolation. Do not change a production branch shared with the Israeli project.
2. Protect/remove old deployment URLs that still expose the insecure APIs and their access to the US database. Separate and scope US/Israel and Preview/Production database credentials. A preview must use a disposable Neon branch, never the production database.
3. Take a recoverable database snapshot. On an isolated Neon branch with representative US schema/data, run the migration dry run, inspect the existing-membership verification requirement, then apply and test it. Resolve ambiguous phone/business ownership explicitly. Never copy customer data between countries to make the migration pass.
4. Migration tool: set `LOYALTY_REGION=us`, `US_MIGRATION_DATABASE_URL`, `US_MIGRATION_EXPECTED_HOST`, and `US_MIGRATION_EXPECTED_DATABASE`. Run `pnpm migrate:us-security` for a rollback-only dry run; add `-- --apply` only for the explicitly identified database when ready. Do not put credentials in PRs, logs or code.
5. In a controlled US maintenance window, apply the verified migration and deploy frontend/backend together. Set `LOYALTY_REGION=us` and `LOYALTY_US_SECURITY_V2=true` for this candidate only after migration. Until both flags and the migration marker exist, the API returns maintenance rather than silently reverting to insecure authentication.
6. On the exact intended US hostname, test signup with all current fields, login, cookie properties, failed/successful logout, second-tab/back navigation, installed service workers, approved and duplicate redemptions, wrong-business/amount/expired tokens, recovery, insufficient balance and transaction rollback. Complete the equivalent Neon concurrency checks. Confirm live pages remain English and registration stays white.
7. Confirm merchant/admin token revocation and independently audit any legacy Supabase deployment still reachable outside this US proxy. Merchant/admin auth still uses existing bearer tokens in localStorage; cookie migration for merchant authentication is not included.
8. Release only after gates pass. If rollback is needed, put customer operations into maintenance and use a security-compatible build. Do not restore a prior vulnerable app or a stale snapshot that would resurrect spent balances/session credentials. Keep the snapshot for reconciliation and retain the audit records.

No production migration, domain mapping or Vercel environment change is performed by these scripts automatically.

## Local results for this candidate

- 17 tests passed against the embedded PostgreSQL engine, including real transaction rollback on a deliberately failed redemption log.
- Browser flows passed at 390px and 1280px using real local HTTPS API calls and SQL: white signup, secure cookies, old service-worker cache removal, one-time redemption, owner-assisted recovery, merchant/customer replay denial, cross-tab logout and back navigation.
- Inline JavaScript parses and existing page CSS is unchanged.
- Independent-connection PostgreSQL results must be checked on this PR’s workflow run. Real Neon/Vercel production configuration and live-domain acceptance remain separate gates.
