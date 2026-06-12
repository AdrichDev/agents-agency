[ARCHIVED TASKS]

This task log has been completed and archived. All tasks marked [x] verified in sdd-apply and sdd-verify.

Archive date: 2026-06-12
Original location: front/openspec/changes/telegram-whatsapp-bots/tasks.md

Final status: VERIFIED ✅

Summary of work:
- Schema: ChannelConnection model + migration SQL (CREATE TABLE, unique index, FK cascade)
- Crypto: AES-256-GCM encryption/decryption (crypto.ts)
- Telegram: Bot API client (getMe, setWebhook, deleteWebhook, sendMessage), update handler with idempotence by update_id
- WhatsApp: Meta Graph API client (verifyWebhook, sendMessage), event parser, message dedup by message.id
- Routes: 8 endpoints (POST connect, GET status, DELETE for both providers, POST/GET webhooks)
- Frontend: ChannelConnectPanel.tsx with state UI (disconnected/pending/active/error)
- Tests: 51/51 vitest unit tests (crypto, parsers, dedup, HMAC)
- Build: ✅ cd back && npm test (all green), cd front && npm run build (clean)

Technical debt (deferred):
- P3: Playwright e2e for channel connection flow (out-of-scope P1)
- P3: Skip cron with supertest real in test auth /execute
