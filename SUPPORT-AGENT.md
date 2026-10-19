# Agent 2 — Loyalty Voice Support

Status: PR source under review. This change does not publish voice support to production.

The US and Israel homepages offer a general AI/FAQ support widget. A visible selector lets visitors choose English or Hebrew independently of the site's market. The browser remembers only that language preference. Recognition and synthesized speech explicitly use en-US or he-IL; replies use the selected language while product facts stay with the current US/Israel site.

Stop cancels browser speech, microphone recognition, and the pending browser request. Closing the panel, Escape, switching language, and leaving the page also stop it. Late results are ignored. Recognition stops after 30 seconds, spoken output after 60 seconds, and provider requests time out after 12 seconds. Stopping the browser cannot guarantee cancellation of a provider request already accepted by the server, and does not refund its reserved quota. Browser voices and speech recognition availability vary by device; text input remains available.

## Server usage limits

Before each paid provider call the server reserves durable atomic PostgreSQL counters in loyalty_support_limits, using DATABASE_URL for US and only ISRAEL_DATABASE_DATABASE_URL/ISRAEL_DATABASE_URL for Israel. Israel refuses a missing dedicated URL or one equal to the shared US URL. No account, reward, or billing tables are read or changed. The counter table is created automatically on the first paid request; schema permission or store failure disables paid calls and uses verified FAQ answers instead. No in-memory counter is used for enforcement. Quotas are shared across instances using that database, including Preview and Production if they share DATABASE_URL. Use an isolated Preview database to keep their quotas separate.

Defaults, configurable only through server environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| LOYALTY_SUPPORT_PER_MINUTE | 5 | Paid requests per client IP, fixed minute |
| LOYALTY_SUPPORT_PER_DAY | 20 | Paid requests per client IP, UTC day |
| LOYALTY_SUPPORT_DAILY_REQUESTS | 100 | Paid requests across the database, UTC day |
| LOYALTY_SUPPORT_RATE_SECRET | DATABASE_URL | Optional stable HMAC secret for IP hashing |

Counters use database time. Each atomic reservation rejects above the cap even under concurrency. Failed provider requests and partially reserved requests still consume quota conservatively. Setting a quota to 0 disables paid calls; valid settings are capped at 10,000. IPs shared by a household/business share the client quota. Raw IPs and chat messages are not stored in the counters. Vercel's overwritten x-forwarded-for header is trusted only when VERCEL=1; other hosts use the connection's remote address.

Limit denial returns 429 with Retry-After and a localized message; the widget remains usable after the delay. Missing credentials or unavailable limiter means free FAQ only. All model requests have at most 1,000 input characters, 220 output tokens and no automatic retry. These are request/token limits, not a guaranteed dollar budget; set provider project spend controls separately. Quota rows contain only an HMAC scope, time bucket and count; old IP rows can be removed by an operator's retention task.

## Configuration and boundaries

- OPENAI_API_KEY is server-only and optional for FAQ mode; LOYALTY_SUPPORT_MODEL retains the existing model selection.
- Exact supported hosts include the four public US/Israel domains, VERCEL_URL, VERCEL_BRANCH_URL and VERCEL_PROJECT_PRODUCTION_URL. Add a required custom Preview alias through the comma-separated LOYALTY_SUPPORT_ALLOWED_HOSTS server variable. Cross-origin requests and unlisted hosts are denied; no wildcard vercel.app permission is granted.
- The assistant discloses AI identity and warns against sharing secrets. It cannot access accounts, balances, payments, or perform account actions. Personal data detected by the filter is not sent to the model.
- Specialist prompts are only general troubleshooting instructions in the same model; no separate specialist, ticketing, phone answering or authenticated handoff is connected.

Validation: node --test tests/*.test.mjs covers API language/site separation, Preview origin checks, validation, quota denial, fail-closed FAQ, privacy ordering and stable counter identity. Additional isolated checks exercised the SQL against PostgreSQL (PGlite), including concurrency/global-cap/reset cases, and widget behavior in JSDOM. Live microphone audio and real-phone/browser layout still require verification on an accessible Preview.
