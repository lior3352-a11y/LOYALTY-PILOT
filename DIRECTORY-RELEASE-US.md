# US local business directory

This candidate is based on security/us-accounts-v2, not the shared production branch. Review and satisfy SECURITY-RELEASE-US.md before deployment. No production data or settings were changed.

Consumers open stores.html without an account or QR and search an exact city/town plus a two-letter US state code. Results are paginated (20 per page), contain only public business information, and link to the existing join flow. This version is city-based, not GPS or radius-based; other countries are outside this first increment.

Owners open Manage store listing in merchant.html, enter their public address, city and state, and explicitly enable their listing. Existing stores remain hidden until configured. Owner-scoped writes ignore supplied business IDs and preserve other settings. Data lives in the existing loyalty_business_settings.settings.directory JSON field; no directory migration or sample records are required. An enabled listing stays visible until its owner disables it; subscription status does not control listing visibility in this increment.

Validation: node --check passed for modified/new JavaScript. Added PostgreSQL-backed tests in tests/directory.test.mjs; run node --test tests/directory.test.mjs after installing dependencies. Dependency installation was unavailable in this environment, so these SQL tests have not run. Browser validation was attempted but blocked by a missing Chromium executable. Before release run SQL tests, the existing security suite, and mobile/desktop browser acceptance against isolated US Neon data, including pagination, empty/error states, owner save/unlist and unauthenticated browsing.
