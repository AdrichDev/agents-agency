[ARCHIVED TASKS]

Change: ecommerce-flow-improvements (P5)
Archive date: 2026-06-12
Status: VERIFIED ✅

All implementation tasks completed:
- [x] RAG: System prompt block (if KnowledgeChunks exist), source citation
- [x] Intent: INTENT_TOOL (record_lead_intent), metadata.leadIntent in Conversation
- [x] Handoff: HANDOFF_TOOL (request_human_handoff), metadata.handoff + Lead.status, Slack notification (graceful degradation)
- [x] Business hours: isWithinBusinessHours (Intl, fallback 24/7), ecommerceConfig storage
- [x] Order status: fetchOrderStatus (generic HTTP Bearer), ECOMMERCE_TOOL (get_order_status)
- [x] Schema: Agent.ecommerceConfig Json @default("{}"), SQL migration idempotent
- [x] Backend API: PATCH /api/agents/:id/ecommerce-config, GET /api/agents/:id/leads, GET /api/agents/:id (masked)
- [x] Frontend: LeadsPanel.tsx, EcommerceConfigPanel.tsx
- [x] Tests: Full vitest coverage, all green
- [x] Build: cd back && npm test (all green), cd front && npm run build (clean)

Technical debt:
- [ ] Playwright for ecommerce config & leads panel (deferred to P6)

CRITICAL FIX (applied by orchestrator):
- GET /api/agents/:id must NOT expose ecommerceConfig.apiKey in plain. Mask it.
- Status: FIXED ✅
