[ARCHIVED TASKS]

Change: oauth-integrations (P2)
Archive date: 2026-06-12
Status: VERIFIED ✅

All implementation tasks completed:
- [x] Google unified: Provider google with Calendar + Gmail scopes
- [x] Token encryption: encrypt/decrypt accessToken + refreshToken (crypto.ts)
- [x] Notion provider: authUrl, tokenUrl, no refresh token, no expiration
- [x] Refresh automático: getValidToken with rotation (Google), conditional retry (Slack/Notion)
- [x] Migration: idempotent encrypt-tokens.ts script with backup
- [x] Service mapping: SERVICE_TO_PROVIDER table in service-map.ts
- [x] UI state: IntegrationsPanel with connected/reauth_required/disconnected
- [x] Automations integration: engine.ts validates provider connected
- [x] Tests: 78 tests, 9 suites, all green
- [x] Build: cd back && npm test (all green), cd front && npm run build (clean)

Technical debt:
- [ ] Supertest for /execute endpoint auth (P3 — currently only inline asserts)

Dependencies:
- Requires P1 (crypto.ts from telegram-whatsapp-bots)
