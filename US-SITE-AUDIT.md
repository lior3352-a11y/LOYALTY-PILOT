# Loyalty US source audit — 2026-10-19

Scope: all 12 US HTML documents in this checkout, excluding the Israel-prefixed pages and the merchant test fixture. Admin and CRM remain Hebrew owner-only tools; public US pages are English. This is a **source and local-test audit**, not a certification of the deployed site.

## Corrected

- Customer registration/sign-in: white labels on dark cards, lighter supporting copy, readable business notice, and clickable Terms/Privacy links.
- Shared US dark theme: white business form labels/headings and consent copy, lighter legal links, and readable merchant/customer nested panels.
- Homepage Customer Sign In: now explicitly selects the login tab.
- Sales page: replaced remaining Hebrew and the Israeli shekel offer with English and the existing US 30-day/$49 offer; sharing URLs now use the current site rather than legacy GitHub Pages.
- Service worker: API, non-GET, Authorization and cross-origin requests bypass cache handling. Failed server responses are not cached. Activation removes only prior Loyalty caches rather than unrelated caches.

## Verified locally

- 23 Node tests passed, including existing admin/reset tests, customer support handler tests with mocked providers/SQL, and two service-worker boundary tests.
- Syntax checked: seven inline JavaScript blocks and the modified standalone JavaScript/modules.
- Twelve HTML pages have no duplicate IDs or broken same-page fragment links. Referenced local files exist. `/_vercel/insights/script.js` is platform-provided and is not treated as a missing source file.
- No whitespace errors in the patch.

## Still unverified

- The cloud browser did not receive permission to navigate to the live US domain. No alternate network path was used to bypass that decision.
- No desktop/mobile visual rendering or computed contrast measurement of the edited pages. The supplied screenshot confirms the original dark-label defect only.
- No real account created, login/reset submitted, purchase recorded, reward earned/redeemed, or admin data changed. Existing automated tests use test inputs and mocked databases.
- No real QR decoded/scanned; the sales SVG QR still needs a target check. External campaign images and platform analytics availability were not fetched.
- No live AI/audio request; Hebrew/English voice quality, microphone permission handling and shared budget SQL concurrency remain unverified. Support is not production-ready until its documented configuration and checks are complete.
- Vercel deployment access previously returned 403. No merge or production deployment was performed.

Next release gate: obtain authorized browser/deployment access, visually test desktop/mobile, verify the QR destination and real customer flows in a test environment, then complete support activation and bounded live voice tests before publishing.
