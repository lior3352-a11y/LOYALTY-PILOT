# Customer text and voice support

Draft implementation. **Not deployed or activated.** US: Emma in English. Israel: Maya in Hebrew.

The launcher opens an accessible dialog. Voice capture begins only after an explicit Speak click; typed messages remain available without microphone support. Browser SpeechRecognition transcribes the question and the server synthesizes the generated answer using OpenAI. This is a turn-based voice conversation, not an always-on realtime audio connection. The UI discloses AI and browser speech processing. No passwords, account lookups or customer database access.

## Activation prerequisites

- Verify each Vercel production project and branch; retain its existing landing page and data configuration.
- Configure server-only `OPENAI_API_KEY`, `SUPPORT_ENABLED=true`, `SUPPORT_ALLOWED_ORIGINS` (exact comma-separated HTTPS origins), and `SUPPORT_DATABASE_URL`.
- Both deployments MUST use the **same dedicated support database**, separate from both customer databases. Apply `migrations/customer-support.sql` there once. Never reseed/reset the trial ledger during deployments.
- The shared ledger reserves a conservative 25 US cents per answer before any provider request, atomically, without refunds on failures. Its total reservation limit is $10 across both websites. Reservations are a protective allowance, **not a report of actual provider spend**. It can stop service before $10 is actually spent. This cap covers this feature only, not other users of the same API key. Confirm fixed model pricing and request bounds before activation; do not change models without reviewing the reservation.
- Three-minute server session expiry, server rejection after 30 seconds of inactivity, one request per session in flight, bounded request/output lengths, client microphone cutoff after 15 seconds per question, close/background cleanup. There is no paid open audio connection while idle. A request accepted before expiry has a provider timeout bounded by remaining session time.
- GET `/api/support` reports unavailable unless all required configuration exists. Missing database tables/provider errors fail closed. Do not label AI as operational based on this presence check alone.

## Verification required before release

Run `node --test tests/customer-support.test.mjs` and JS syntax checks. Then test on actual desktop Chrome and mobile Safari/Chrome: English/Hebrew routing, keyboard/focus, microphone permissions, no-supported-recognition text fallback, audio playback, close/background/expiry, network failures, shared ledger exhaustion/concurrent requests, and approved live model calls. Validate generated answers and Hebrew voice quality with the owner. Tests with stubbed providers do not verify live voice or actual billing. The ledger stores session hashes/times and reservation totals, not transcripts; delete expired session rows regularly. Account-wide provider spend and tax are separate.
