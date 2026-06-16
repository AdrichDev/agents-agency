# specs/

Main specs directory. Each domain capability has its own spec file.

Structure: `specs/{capability}.md`

Populated by `sdd-archive` when changes are merged into main specs.

---

## Index of Main Specs

| Capability | Source Change | Status | Last Updated |
|---|---|---|---|
| [channels.md](./channels.md) | P1: telegram-whatsapp-bots | archived | 2026-06-12 |
| [integrations.md](./integrations.md) | P2: oauth-integrations | archived | 2026-06-12 |
| [automations.md](./automations.md) | P3: n8n-automations | archived | 2026-06-12 |
| [skills.md](./skills.md) | P4: skills-execution-flow | archived | 2026-06-12 |
| [ecommerce.md](./ecommerce.md) | P5: ecommerce-flow-improvements | archived | 2026-06-12 |
| [landing-builder.md](./landing-builder.md) | P6: landing-builder | archived | 2026-06-12 |
| [stats.md](./stats.md) | P7+P8+P9: stats-dashboard, interactive-stats-market-studies, market-study-pro | archived | 2026-06-12 |
| [knowledge-ingestion.md](./knowledge-ingestion.md) | knowledge-file-ingestion | archived | 2026-06-16 |

---

## Spec Coverage Summary

- **Channels**: Telegram & WhatsApp bots, ChannelConnection model, credential encryption, webhooks, UI integration.
- **Integrations**: OAuth (Google unified, Slack, Notion), token encryption & refresh, service mapping, UI state.
- **Automations**: n8n workflow generation, REST client (noop mode), lifecycle (create/toggle/delete), endpoint /execute.
- **Skills**: Skill→tools catalog, capability resolution, booking E2E (calendar), honest prompts for missing integrations.
- **Ecommerce**: RAG recommendations with sources, lead intent, human handoff, order status (generic API), business hours.
- **Landing Builder** (P6): Conversational vibe coding, decálogo questionnaire, prompt master integration, multi-file code generation, embedded IDE with Monaco, mobile scaffold generation (Expo/Flutter), zip download.
- **Stats Dashboard + Market Studies** (P7+P8+P9): Aggregated analytics with parametric API & filters, drill-down, market study AI generation with editable sections, Google Places prospect discovery, competitor analysis, success scoring, professional table UI with star ratings.
- **Knowledge Ingestion**: Agent RAG knowledge base ingestion via URL/text (existing) + new file/zip upload; supported formats (PDF, DOCX, TXT, MD, HTML, CSV); zip safety limits (50MB uncompressed, 200 entries); duplicate policy (ask/overwrite/suffix); multipart endpoint `POST /api/knowledge/:agentId/files` with multer memoryStorage.

All specs include implementation status and technical debt notes.
