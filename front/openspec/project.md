# agents-agency — Project Context

## Overview

AI agent agency SaaS. Clients create and configure AI agents via a multi-step wizard, deploy them across channels (widget, API, Telegram, WhatsApp), assign skills from a marketplace, and define automations that map to n8n workflows.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript 5, Tailwind CSS 3, React 18 |
| Backend | Express 4, TypeScript 5, tsx (dev), ESM modules |
| ORM | Prisma 7 + adapter-pg (PostgreSQL driver) |
| Database | PostgreSQL 3AStudioDB (port 5433), pgvector extension |
| Validation | Zod 3 |
| AI | OpenAI SDK 4 (gpt models, embeddings for RAG) |
| Tests (front) | Playwright 1.60 (E2E only, baseURL port 3100) |
| Tests (back) | Vitest 2, node environment |

## Architecture

```
agents-agency/
├── front/              # Next.js 14 App Router
│   ├── app/            # Route segments (pages + layouts)
│   ├── components/     # Shared UI components
│   │   └── agent-wizard/  # Wizard steps (ChannelStep, SkillsStep, …)
│   ├── hooks/          # Custom React hooks
│   ├── tests/          # Playwright E2E specs
│   └── openspec/       # SDD specs (this directory)
└── back/               # Express API
    ├── src/
    │   ├── index.ts    # Server entry point
    │   └── lib/        # Business logic, Prisma client, scraper
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrate-*.sql  # Manual SQL migrations
    └── tests/          # Vitest unit tests
```

## Domain Models (Prisma)

- **Client** — agency client (razonSocial, CIF, sector)
- **Agent** — AI agent (channel, systemPrompt, model, temperature, widgetConfig)
- **KnowledgeChunk** — RAG embeddings (vector 1536) linked to Agent
- **Skill** — marketplace item (type: SKILL|AGENT|EXTENSION|PLUGIN|MCP, use, tools JSON)
- **AgentSkill** — many-to-many Agent ↔ Skill
- **Integration** — OAuth token store (provider, accessToken, refreshToken, expiresAt, metadata)
- **Automation** — trigger (new_email|new_slack_message|schedule) + config JSON → n8n workflow source
- **AutomationRun** — execution log (status: ok|error|skipped, toolCalls JSON)
- **Conversation / Message** — chat history per channel
- **Lead** — captured lead from conversation
- **SystemConfig** — global UI config (theme, colors, favicon, sidebarLogo base64)
- **Budget / BudgetLine** — agency quotes (quoteNumber AD-YYYY-NNN, status: draft|sent|accepted|rejected)

## Conventions

- UI copy: **Spanish**. Code, identifiers, API field names, comments: **English**.
- Files: max 500 lines.
- PKs: `cuid()`.
- Schema migrations: manual SQL files at `back/prisma/migrate-*.sql`, applied with `prisma db push`.
- Imports: `@/` alias maps to `back/src/` in the backend.

## Testing Capabilities

**Strict TDD**: enabled

| Layer | Available | Tool | Command |
|---|---|---|---|
| Unit | Back only | Vitest 2 | `cd back && npm test` |
| Integration | No | — | — |
| E2E | Front only | Playwright 1.60 | `cd front && npx playwright test` |
| Type check | Both | tsc --noEmit | `npm run typecheck` |

## Completed Roadmap Phases

| # | Phase | Status | Date | Details |
|---|---|---|---|---|
| P1 | telegram-whatsapp-bots | ✅ Archived | 2026-06-12 | Real Telegram bots (BotFather token + webhook) and WhatsApp (Meta Cloud API). ChannelConnection model, AES-256-GCM credential encryption, webhooks for receive/send messages. |
| P2 | oauth-integrations | ✅ Archived | 2026-06-12 | Real OAuth flows for Google (Calendar + Gmail unified), Slack, Notion with encrypted token store, refresh token rotation, and reauth_required state. Service→provider mapping for automations. |
| P3 | n8n-automations | ✅ Archived | 2026-06-12 | n8n REST client (noop mode), workflow generation (schedule/webhook triggers), lifecycle (create/activate/deactivate/delete). Endpoint `/api/automations/:id/execute` authenticated by shared secret. |
| P4 | skills-execution-flow | ✅ Archived | 2026-06-12 | Skill→tools catalog, capability resolution, E2E booking flow (calendar). Honest system prompts for missing integrations. buildSkillStatus for UI state. |
| P5 | ecommerce-flow-improvements | ✅ Archived | 2026-06-12 | RAG recommendations with source citations, lead intent capture, human handoff with business hours + Slack notification, order status placeholder API, encrypted ecommerce config. |
| P6 | landing-builder | ✅ Archived | 2026-06-12 | Conversational vibe coding: ~10-question decálogo (DEFAULT_MODEL) → prompt master skill lookup → multi-file code generation (STRONG_MODEL) → embedded Monaco IDE with live preview → mobile scaffold (Expo/Flutter) → zip download. Model `LandingProject`. |
| P7 | stats-dashboard | ✅ Archived | 2026-06-12 | Aggregate business intelligence: KPI cards, interactive charts (recharts), monthly series, billing breakdown by status, top agents. Single parametrized endpoint `GET /api/stats` (P7 baseline: 12 fixed months, no filters). Dashboard `/estadisticas`. *Note: spec/design artifacts missing from this change.* |
| P8 | interactive-stats-market-studies | ✅ Archived | 2026-06-12 | Extended stats with retrocompatible parametric API (granularity, range, filters, drill-down) + AI-generated market studies (STRONG_MODEL, editable sections, section-level regeneration, Google Places prospect discovery, CSV export). Model `MarketStudy`. Merged into `specs/stats.md`. |
| P9 | market-study-pro | ✅ Archived | 2026-06-12 | Market study enhancements: website analyzer + chatbot detection, opportunity scoring heuristic, competitor analysis via Places + web scraping, global success score (1-5), recommended options with scores, professional tables with star ratings and filter buttons. Merged into `specs/stats.md`. |
| P10 | knowledge-file-ingestion | ✅ Archived | 2026-06-16 | Agent RAG knowledge base ingestion via file/zip upload. Multipart `POST /api/knowledge/:agentId/files` (multer memoryStorage). Formats: PDF, DOCX, TXT, MD, HTML, CSV. Zip safety (50MB uncompressed, 200 entries), duplicate policy (ask/overwrite/suffix), per-extension parser dispatch, frontend upload UI with per-file progress. |
| P11 | crm-contacts-and-polish | ✅ Archived | 2026-06-17 | Stats rework (day granularity, continuous zero-filled series, toolbar filters, periodFormat). Market study pro v2 (geo anchoring, haversine radius post-filter, competitor emails, scraper timeout). Spain-2026 pricing. CRM: `ContactType`/`ContactedStatus` enums, `ProspectContact` model (pc-NN code, soft-delete), `/api/contacts` router (CRUD + pending-count + convert-to-clients), enriched `/api/clients` (codCliente, direccion, hasInvoices), auto `ProspectContact` on Lead + admin notify via n8n webhook. Front: clients table (invoice icon → `/facturacion?clientId`), `/contactos` page, Sidebar pending badge, favicon precedence fix. Idempotent additive SQL `back/prisma/migrate-crm-contacts.sql`; DB already migrated. 368 back tests green, front typecheck clean, build OK. |

---

## Known Technical Debt

| Priority | Area | Task | Effort | Notes |
|---|---|---|---|---|
| P3 | Testing | Supertest for `/execute` endpoint auth | 12h | Currently only inline asserts; needs real handler exercise via supertest. |
| P3 | Testing | Unit test for `runAutomation` with mocks | 12h | Verify gap from sdd-verify; mock runAgent and Prisma. |
| P3 | Testing | Playwright for channel connection flow | 16h | Out-of-scope P1; deferred to integration phase. |
| P4 | Testing | Playwright for skills panel state display | 12h | Mock data; integration test. |
| P5 | Testing | Playwright for ecommerce config & leads panel | 16h | Mock data; integration test. |
| P6 | Testing | Playwright E2E for landing builder flow | 16h | Conversational decálogo → generation → editing; requires mock OpenAI. Deferred from P6 apply. |
| P7 | Testing | Stats SQL unit tests (date_trunc edge cases) | 8h | Complex aggregations with multiple filters; drill-down query edge cases. |
| P7 | Testing | Stats snapshot regression (P7 vs P8 baseline) | 6h | Ensure `/api/stats` without params remains byte-identical as P8/P9 add filters. |
| P7 | Spec/Design | Missing spec.md and design.md artifacts | N/A | P7 missing SDD artifacts (archived with partial record). Baseline preserved in `specs/stats.md`. |
| P8 | Testing | Drill-down query integration test | 8h | Verify `/api/stats/drilldown` returns correct period breakdown with active filters. |
| P8 | Testing | Market study snapshot test (malformed JSON fallback) | 6h | Verify section placeholder when LLM returns broken JSON. |
| P9 | Testing | Website analyzer false negatives (chatbot detection) | 4h | Heuristic covers common platforms; document limitations; consider custom chat implementations. |
| P9 | Testing | Competitor scraping reliability (timeout/blocks) | 6h | Sites may block or timeout; `unverified` flag helps; recommend manual review workflow. |
| P9 | Operations | Places API quota monitoring | 4h | Cap configured at 30 requests/study; actual costs and quota limits need production tracking. |
| Back | Refactor | ✅ Resolved (2026-06-17) | — | `routes/automations.ts` + `cronRouter` already extracted; `index.ts` is 251 lines, fully router-based (channels, landing, market-studies, contacts, auth, public, agents, ai, sectors, skills, integrations, automations, knowledge, cron). |
| Back | Refactor | Consolidate stats aggregation logic | 4h | `stats.ts` has complex `$queryRaw` fragments; extract helper functions for testability. |
| Front | Chatbot Conversational | Refine chat model and context window | 12h | Current chatbot uses mini models; upgrade to mid-tier for multi-turn conversations. |

---

## Current SDD State

- **Phases 1-11**: Fully specified, implemented, verified, and archived (P1-P9 on 2026-06-12; P10 knowledge-file-ingestion on 2026-06-16; P11 crm-contacts-and-polish on 2026-06-17).
- **P11 specs**: new `specs/crm.md` (CRM contacts/clients/UI/favicon/catalog, as-built) + `specs/stats.md` P11 delta (day granularity, period formatting, market-study v2).
- **Specs merged**: 7 consolidated spec files in `specs/`:
  - P1-P5: channels.md, integrations.md, automations.md, skills.md, ecommerce.md (existing).
  - **P6 (new)**: landing-builder.md (conversational code generation, IDE, mobile scaffold).
  - **P7-P9 (consolidated)**: stats.md (parametric dashboard + market studies + competitive analysis).
- **Changes archived**: All 9 change folders moved to `changes/archive/2026-06-12-{name}/` with artifact history.
- **Special notes**:
  - P7 stats-dashboard missing spec/design artifacts (partial archive recorded).
  - P8 + P9 merged into single consolidated `specs/stats.md` covering both interactively and market-study-pro.
- **Build status**: ✅ Back 207 tests, ✅ Front build clean, ✅ Typechecks pass.
- **Next frontier**: P10+ roadmap (to be initiated in future cycles).
- **Active work areas**: Deferred Playwright E2E, stats SQL edge cases, chatbot conversational model upgrade.
