[ARCHIVED TASKS]

Change: n8n-automations (P3)
Archive date: 2026-06-12
Status: VERIFIED ✅

All implementation tasks completed:
- [x] Schema: n8nWorkflowId String?, syncStatus implicit
- [x] n8n client: REST (noop mode if no N8N_BASE_URL)
- [x] Workflow builder: buildWorkflow for schedule/new_email/new_slack_message triggers
- [x] HTTP Request nodo: POST /api/automations/:id/execute with X-Automation-Secret
- [x] Lifecycle: create (createWorkflow), toggle enabled (activate/deactivate), delete (deleteWorkflow)
- [x] Endpoint: POST /api/automations/:id/execute authenticated by secret
- [x] Docker-compose: n8n service optional/commented with setup instructions
- [x] Frontend: badges (⚙️ n8n / 🕐 internal / ⚠ Error sync), Reintentar button
- [x] Tests: 100/100 vitest tests, builder + client + auth
- [x] Build: cd back && npm test (all green), cd front && npm run build (clean)

Technical debt (VERIFY GAPs):
- [ ] runAutomation unit test with mocks (W2 — currently only asserts)
- [ ] Supertest for /execute auth (W1 — currently only inline simulations)
- [ ] Playwright for create automation & state (W3 — deferred to P4)

Note: cron skip logic verified; skip condition correct even without perfect test coverage.

Dependencies:
- Requires P2 (crypto.ts, service-map.ts)
