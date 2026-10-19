# Agent 2 — Loyalty Voice Support

Status: MVP source code; not deployed.
Channels: website text plus browser speech input/output on US and Israeli sites. Phone answering requires a telephony provider, phone number, credentials, consent disclosures, and additional setup; it is not enabled by this patch.
Locale routing: US domain responds in English; Israel domain responds in Hebrew.
Scope: onboarding, QR use, rewards, product benefits, basic business setup and general troubleshooting.
Identity/security: disclose that this is AI; do not request passwords, payment data, or verification codes. No account lookup, balance changes, refunds, or account actions are wired. Personal account matters get a clear limitation and safe next step.
Fallback/handoff: verified FAQ answers when no model is configured; when uncertain or the user describes an account-specific issue, explain limitation. SpecialistHandoff is a routing signal only; no second AI service or ticketing system is connected yet.
LLM: server-side OpenAI Responses API only when OPENAI_API_KEY is configured; key stays server-side. Model can be overridden with LOYALTY_SUPPORT_MODEL. No tools are exposed to the model. Responses use store:false and capped tokens.
Known limits: browser speech support varies by browser/device; voice is browser-synthesized. Account verification, authenticated support specialist, actual telephony, observability, abuse rate limiting and production deployment remain follow-up steps.