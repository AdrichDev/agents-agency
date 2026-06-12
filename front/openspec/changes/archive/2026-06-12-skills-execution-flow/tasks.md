[ARCHIVED TASKS]

Change: skills-execution-flow (P4)
Archive date: 2026-06-12
Status: VERIFIED ✅

All implementation tasks completed:
- [x] Skill catalog: SKILL_USE_TO_PROVIDER + NAME_OVERRIDES in skill-capabilities.ts
- [x] Capability resolution: capabilitiesForSkills (executable/missing/informational)
- [x] buildSkillStatus: state per skill for UI (executable/requires_connection/informational)
- [x] runAgent integration: toolsForSkillProviders union + dedup
- [x] Honest system prompt: skills operatives vs. pending connections
- [x] Booking E2E: startIso/endIso validation (ISO 8601, end > start)
- [x] Confirmation guidance: system prompt booking checklist (date/hour/name/contact)
- [x] Lead-flow reuse: contextFacts injected, no re-ask name/email
- [x] Endpoint: GET /api/agents/:id includes skillStatus
- [x] Frontend: badges (Ejecutable/Conecta {provider}/Informativa), CTA to integrations
- [x] Tests: 28 new tests in skill-capabilities.test.ts, 128 total all green
- [x] Build: cd back && npm test (all green), cd front && npm run build (clean)

Technical debt:
- [ ] Playwright for skills panel state display (deferred to P5)

Dependencies:
- Requires P3 (n8n automations for context)
- Requires P2 (oauth integrations for provider connection)
